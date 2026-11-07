/* ======================================================================
 * Gear that moved: Home Assistant, a Hue bridge or a Shelly that got a new address from the router (after a power
 * cut, a new router or a lease that ran out) is found again - nobody has to look up the address.
 *
 * While each one answers, Health (79-doctor.js) remembers what it is: Home Assistant's own id (which it announces on
 * the network), the Hue bridge's id and the Shelly's hardware id - none of them a secret. When one stops answering,
 * CasaTorch looks on the home network with the same finders as setup and "New devices found" (mDNS; for Hue also the
 * bridge list) and asks each home address it finds only its public "who are you" page.
 *
 * An id a device announces can be copied by any other device on the network, so a matching id is not proof. So:
 *  - Nothing secret is ever sent by itself. When the device has a key, token or password (Home Assistant's token,
 *    the Hue key, a Shelly with a password), the new address is only suggested: Health shows "seems to have moved to
 *    <address> (it was at <address>). Use the new address?" and only a signed-in owner or admin's tap (the Fix it
 *    button, POST /api/doctor/fix, admin only) tries the key there and saves the address - if it's accepted.
 *  - A Shelly without a password (nothing secret to send) is followed by itself, and "Fixed by itself" says so.
 * A Shelly keeps its device ids (its tiles, rooms and alert rules) because they stay named after the address it was
 * added at ("tag"). At most one look for each kind every 10 minutes; only private home-network addresses are taken.
 * ====================================================================== */
const MOVED = { at: {}, pending: {} };   // pending: { [key]: { kind, from, to, at } } - suggestions waiting for an admin's tap (memory only)
const MOVED_GAP = 10 * 60_000;
/** A hardware id in one form to compare: hex digits only, upper case ("00:17:88:..", "001788fffe.."). null when it isn't one. */
const movedId = (v) => { const s = String(v ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase(); return s.length >= 12 && s.length <= 32 ? s : null; };
/** Which device that stopped answering is at which other address. down [{ host, id }], seen [{ addr, id }] -> [{ from, to }].
    One address goes to one device only, and never to the address it already had. Pure. */
function movedMatch(down, seen) {
  const out = [], used = new Set();
  for (const d of down || []) {
    const id = movedId(d?.id); if (!id) continue;
    const hit = (seen || []).find((s) => s && movedId(s.id) === id && s.addr !== d.host && !used.has(s.addr));
    if (hit) { used.add(hit.addr); out.push({ from: d.host, to: hit.addr }); }
  }
  return out;
}
/** Time for another look for this kind? (and counts this one) */
const movedDue = (kind, now = Date.now()) => { if (now - (MOVED.at[kind] || 0) < MOVED_GAP) return false; MOVED.at[kind] = now; return true; };

/* ---- remembering who answered (saved only when it's new) ---- */
function movedLearnHue(j) {
  const id = movedId(j?.bridgeid);
  if (id && config.hue?.host && config.hue.bridgeid !== id) saveConfig({ ...config, hue: { ...config.hue, bridgeid: id } });
}
/** answers: [{ host, id }] from each Shelly's /shelly page. */
function movedLearnShelly(answers) {
  let changed = false;
  const next = (config.shelly || []).map((s) => { const id = movedId((answers || []).find((a) => a.host === s.host)?.id); if (id && s.hwid !== id) { changed = true; return { ...s, hwid: id }; } return s; });
  if (changed) saveConfig({ ...config, shelly: next });
}

/* ---- following ---- */
/** A suggestion for an admin: the key a Health "Use the new address" button sends back (never holds a secret). */
function movedSuggest(key, kind, from, to) {
  MOVED.pending[key] = { kind, from, to, at: nowIso() };
  if (typeof audit === 'function') audit(null, 'device-moved-suggested', { device: kind });
  return MOVED.pending[key];
}
/** The pending suggestion for a key, still about the address this device has now (or null). */
const movedPending = (key, current) => { const p = Object.hasOwn(MOVED.pending, key) ? MOVED.pending[key] : null; return p && p.from === current ? p : null; };
const shellyHasSecret = (s) => !!(s?.password || s?.user || s?.username);
/** The Hue bridge stopped answering: is the same bridge id at another home address? Only its public page is asked
    (no key). Answers the suggestion { from, to } or null; nothing is saved. */
async function movedFollowHue({ find = () => DISCOVERERS.hue(), ask = (ip) => getJSON(`http://${ip}/api/0/config`, { timeout: 3000 }) } = {}) {
  const h = config.hue, id = movedId(h?.bridgeid); if (!h?.host || !id) return null;
  const ips = [...new Set(await Promise.resolve().then(find).catch(() => []))].filter((ip) => ip !== h.host && discAddrOk('hue', ip)).slice(0, 8);
  const seen = await Promise.all(ips.map(async (ip) => ({ addr: ip, id: (await Promise.resolve().then(() => ask(ip)).catch(() => null))?.bridgeid })));
  const m = movedMatch([{ host: h.host, id }], seen)[0]; if (!m) return null;
  movedSuggest('hue', 'hue', m.from, m.to);
  return m;
}
/** Shellys that stopped answering (their addresses): are they at other home addresses? One without a password is
    followed at once (nothing secret is sent); one with a password is only suggested. Answers { moved, suggested }. */
async function movedFollowShelly(downHosts, { find = () => DISCOVERERS.shelly(), ask = (ip) => getJSON(`http://${ip}/shelly`, { timeout: 3000 }), found = () => Object.values(disc.items).filter((it) => it.kind === 'shelly').map((it) => discHost(it.addr)) } = {}) {
  const list = config.shelly || [], down = list.filter((s) => (downHosts || []).includes(s.host) && movedId(s.hwid)).map((s) => ({ host: s.host, id: s.hwid }));
  if (!down.length) return { moved: [], suggested: [] };
  const have = new Set(list.map((s) => s.host));
  const ips = [...new Set([...(await Promise.resolve().then(find).catch(() => [])), ...found()])].filter((ip) => !have.has(ip) && discAddrOk('shelly', ip)).slice(0, 32);
  const seen = await Promise.all(ips.map(async (ip) => ({ addr: ip, id: (await Promise.resolve().then(() => ask(ip)).catch(() => null))?.mac })));
  const all = movedMatch(down, seen), secret = new Set(list.filter(shellyHasSecret).map((s) => s.host));
  const moved = all.filter((m) => !secret.has(m.from)), suggested = all.filter((m) => secret.has(m.from));
  for (const m of suggested) movedSuggest(`shelly:${m.from}`, 'shelly', m.from, m.to);
  if (moved.length) {
    saveConfig({ ...config, shelly: list.map((s) => { const m = moved.find((x) => x.from === s.host); return m ? { ...s, host: m.to, tag: s.tag || s.host } : s; }) });
    healNote('shelly-moved', 'A Shelly got a new address on your network, so CasaTorch found it there and carries on.');
    if (typeof audit === 'function') audit(null, 'device-moved', { device: 'shelly' });
  }
  return { moved, suggested };
}
/* ---- Home Assistant (not the add-on: that one is always at the same place) ---- */
/** Home Assistant's mDNS answers as [{ uuid, url }]: its own announced address, else its number address and port. Pure. */
function haAnnounced(list) {
  return (list || []).map((x) => {
    const uuid = String(x?.txt?.uuid || '').toLowerCase().replace(/-/g, ''), own = x?.txt?.internal_url || x?.txt?.base_url;
    const url = typeof own === 'string' && /^https?:\/\/[^\s/]+$/.test(own.replace(/\/+$/, '')) ? own.replace(/\/+$/, '') : x?.ip ? `http://${x.ip}:${Number(x.port) || 8123}` : null;
    return /^[0-9a-f]{32}$/.test(uuid) && url ? { uuid, url } : null;
  }).filter(Boolean);
}
const haMoveable = () => { const h = config.homeAssistant; return h?.url && h.url !== SUPERVISOR_HA ? h : null; };
/** While it answers: which of the Home Assistants announcing themselves is ours (the one at our address). */
async function movedLearnHa({ find = () => mdnsBrowse('_home-assistant._tcp.local') } = {}) {
  const h = haMoveable(); if (!h || h.uuid) return null;
  const host = discHost(h.url), mine = haAnnounced(await Promise.resolve().then(find).catch(() => [])).find((x) => discHost(x.url) === host);
  if (mine) saveConfig({ ...config, homeAssistant: { ...config.homeAssistant, uuid: mine.uuid } });
  return mine?.uuid || null;
}
/** It stopped answering: is something announcing its id at another home address that answers like Home Assistant
    (its public /api/ page, no token)? Answers the suggestion { from, to } or null; the token is not sent, nothing saved. */
async function movedFollowHa({ find = () => mdnsBrowse('_home-assistant._tcp.local'), isHa = (url) => looksHa(url) } = {}) {
  const h = haMoveable(); if (!h?.uuid) return null;
  const host = discHost(h.url), cand = haAnnounced(await Promise.resolve().then(find).catch(() => [])).filter((x) => x.uuid === h.uuid && discHost(x.url) !== host && discAddrOk('homeassistant', x.url));
  for (const c of cand.slice(0, 4)) {
    if (!(await Promise.resolve().then(() => isHa(c.url)).catch(() => false))) continue;
    movedSuggest('ha', 'ha', h.url, c.url);
    return { from: h.url, to: c.url };
  }
  return null;
}

/* ---- an admin said "Use the new address" (79-doctor.js FIXES['moved-use'], admin only) ----
   Only now is the key, token or password tried at the new address; the address is saved only if it's accepted. */
const MOVED_NAME = { ha: 'Home Assistant', hue: 'The Hue bridge', shelly: 'The Shelly' };
async function movedUse(key, {
  haWorks = async (url, token) => (await fetch(`${url}/api/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: 'manual' })).status === 200,
  hueAsk = (ip, user) => getJSON(`http://${ip}/api/${user}/config`, { timeout: 5000 }),
  shellyAsk = (ip) => getJSON(`http://${ip}/shelly`, { timeout: 5000 }),
} = {}) {
  const k = String(key || ''), stale = () => Object.assign(new Error('That suggestion is out of date. Check again.'), { status: 409 });
  const refused = () => { delete MOVED.pending[k]; return Object.assign(new Error('The device at the new address didn\'t accept CasaTorch\'s key, so nothing was changed.'), { status: 409 }); };
  if (k === 'ha') {
    const h = haMoveable(), p = movedPending('ha', h?.url); if (!p) throw stale();
    if (!(await Promise.resolve().then(() => haWorks(p.to, h.token)).catch(() => false))) throw refused();
    saveConfig({ ...config, homeAssistant: { ...config.homeAssistant, url: p.to } });
    if (typeof doctorKick === 'function') doctorKick('ha');
  } else if (k === 'hue') {
    const h = config.hue, p = movedPending('hue', h?.host); if (!p || !h?.username) throw stale();
    const j = await Promise.resolve().then(() => hueAsk(p.to, h.username)).catch(() => null);
    if (!j || Array.isArray(j) || movedId(j.bridgeid) !== movedId(h.bridgeid)) throw refused();
    saveConfig({ ...config, hue: { ...config.hue, host: p.to } });
  } else if (k.startsWith('shelly:')) {
    const from = k.slice(7), s = (config.shelly || []).find((x) => x.host === from), p = movedPending(k, s?.host); if (!p) throw stale();
    const j = await Promise.resolve().then(() => shellyAsk(p.to)).catch(() => null);   // its public page: still the same Shelly?
    if (movedId(j?.mac) !== movedId(s.hwid)) throw refused();
    saveConfig({ ...config, shelly: config.shelly.map((x) => (x.host === from ? { ...x, host: p.to, tag: x.tag || x.host } : x)) });
  } else throw stale();
  const p = MOVED.pending[k]; delete MOVED.pending[k];
  return { kind: p.kind, from: p.from, to: p.to, name: MOVED_NAME[p.kind] };
}
/** Health's line for a pending suggestion: [sentence, values] and its button. */
const movedCheckExtra = (key, p) => ({ why: 'CasaTorch found the same device at a new address on your network. It sends the device\'s key or password there only after you tap Use the new address.', fix: { action: 'moved-use', id: key, label: 'Use the new address' } });
const movedDetail = (p) => [{ ha: 'Home Assistant seems to have moved to {to} (it was at {from}). Use the new address?', hue: 'The Hue bridge seems to have moved to {to} (it was at {from}). Use the new address?', shelly: 'A Shelly seems to have moved to {to} (it was at {from}). Use the new address?' }[p.kind], { to: p.to, from: p.from }];
if (process.env.CASATORCH_TEST === '1') {
  globalThis.__casatorchMoved = {
    MOVED, huePairWait, movedId, movedMatch, haAnnounced, movedLearnHa, movedFollowHa, movedUse, movedPending, movedDetail, movedDue, movedLearnHue, movedLearnShelly, movedFollowHue, movedFollowShelly, HEAL,
    cfg: () => config, setCfg: (c) => saveConfig(c),
    /** put the settings file back as it was before a test (or take it away again) */
    keep: () => { try { return fs.readFileSync(CONFIG_FILE, 'utf8'); } catch { return null; } },
    restore: (text) => { if (text == null) fs.rmSync(CONFIG_FILE, { force: true }); else fs.writeFileSync(CONFIG_FILE, text, { mode: 0o600 }); loadConfig(); },
  };
}
