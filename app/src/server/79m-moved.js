/* ======================================================================
 * Gear that moved: Home Assistant, a Hue bridge or a Shelly that got a new address from the router (after a power
 * cut, a new router or a lease that ran out) is found again by itself - nobody has to look up the address, sign in
 * or pair again.
 *
 * While each one answers, Health (79-doctor.js) remembers what it is: Home Assistant's own id (which it announces on
 * the network), the Hue bridge's id and the Shelly's hardware id - none of them a secret. When one stops answering, CasaTorch looks on the home network with the same finders
 * as setup and "New devices found" (mDNS; for Hue also the bridge list) and asks each home address it finds only its
 * public "who are you" page. The Hue key and the Home Assistant token are never sent anywhere until the id there
 * matches (Home Assistant: only addresses announcing that same id are tried). A match: the new
 * address is saved, Health turns green again and "Fixed by itself" says so. A Shelly keeps its device ids (its
 * tiles, rooms and alert rules) because they stay named after the address it was added at ("tag").
 * At most one look for each kind every 10 minutes; only private home-network addresses are taken.
 * ====================================================================== */
const MOVED = { at: {} };
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
const movedNote = (kind) => {
  healNote(`${kind}-moved`, kind === 'hue' ? 'Your Hue bridge got a new address on your network, so CasaTorch found it there and carries on.' : 'A Shelly got a new address on your network, so CasaTorch found it there and carries on.');
  if (typeof audit === 'function') audit(null, 'device-moved', { device: kind });
};
/** The Hue bridge stopped answering: is the same bridge at another home address? Answers { from, to } or null. */
async function movedFollowHue({ find = () => DISCOVERERS.hue(), ask = (ip) => getJSON(`http://${ip}/api/0/config`, { timeout: 3000 }) } = {}) {
  const h = config.hue, id = movedId(h?.bridgeid); if (!h?.host || !id) return null;
  const ips = [...new Set(await Promise.resolve().then(find).catch(() => []))].filter((ip) => ip !== h.host && discAddrOk('hue', ip)).slice(0, 8);
  const seen = await Promise.all(ips.map(async (ip) => ({ addr: ip, id: (await Promise.resolve().then(() => ask(ip)).catch(() => null))?.bridgeid })));
  const m = movedMatch([{ host: h.host, id }], seen)[0]; if (!m) return null;
  saveConfig({ ...config, hue: { ...config.hue, host: m.to } });
  movedNote('hue');
  return m;
}
/** Shellys that stopped answering (their addresses): are they at other home addresses? Answers [{ from, to }]. */
async function movedFollowShelly(downHosts, { find = () => DISCOVERERS.shelly(), ask = (ip) => getJSON(`http://${ip}/shelly`, { timeout: 3000 }), found = () => Object.values(disc.items).filter((it) => it.kind === 'shelly').map((it) => discHost(it.addr)) } = {}) {
  const list = config.shelly || [], down = list.filter((s) => (downHosts || []).includes(s.host) && movedId(s.hwid)).map((s) => ({ host: s.host, id: s.hwid }));
  if (!down.length) return [];
  const have = new Set(list.map((s) => s.host));
  const ips = [...new Set([...(await Promise.resolve().then(find).catch(() => [])), ...found()])].filter((ip) => !have.has(ip) && discAddrOk('shelly', ip)).slice(0, 32);
  const seen = await Promise.all(ips.map(async (ip) => ({ addr: ip, id: (await Promise.resolve().then(() => ask(ip)).catch(() => null))?.mac })));
  const moves = movedMatch(down, seen); if (!moves.length) return [];
  saveConfig({ ...config, shelly: list.map((s) => { const m = moves.find((x) => x.from === s.host); return m ? { ...s, host: m.to, tag: s.tag || s.host } : s; }) });
  movedNote('shelly');
  return moves;
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
/** It stopped answering: is it announcing itself at another home address? Its token goes only to that address. */
async function movedFollowHa({ find = () => mdnsBrowse('_home-assistant._tcp.local'), works = async (url, token) => (await fetch(`${url}/api/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: 'manual' })).status === 200 } = {}) {
  const h = haMoveable(); if (!h?.uuid) return null;
  const host = discHost(h.url), cand = haAnnounced(await Promise.resolve().then(find).catch(() => [])).filter((x) => x.uuid === h.uuid && discHost(x.url) !== host && discAddrOk('homeassistant', x.url));
  for (const c of cand.slice(0, 4)) {
    if (!(await Promise.resolve().then(() => works(c.url, h.token)).catch(() => false))) continue;
    saveConfig({ ...config, homeAssistant: { ...config.homeAssistant, url: c.url } });
    healNote('ha-moved', 'Home Assistant got a new address on your network, so CasaTorch found it there and carries on.');
    if (typeof audit === 'function') audit(null, 'device-moved', { device: 'homeassistant' });
    if (typeof doctorKick === 'function') doctorKick('ha');
    return { from: h.url, to: c.url };
  }
  return null;
}
if (process.env.CASATORCH_TEST === '1') {
  globalThis.__casatorchMoved = {
    MOVED, huePairWait, movedId, movedMatch, haAnnounced, movedLearnHa, movedFollowHa, movedDue, movedLearnHue, movedLearnShelly, movedFollowHue, movedFollowShelly, HEAL,
    cfg: () => config, setCfg: (c) => saveConfig(c),
    /** put the settings file back as it was before a test (or take it away again) */
    keep: () => { try { return fs.readFileSync(CONFIG_FILE, 'utf8'); } catch { return null; } },
    restore: (text) => { if (text == null) fs.rmSync(CONFIG_FILE, { force: true }); else fs.writeFileSync(CONFIG_FILE, text, { mode: 0o600 }); loadConfig(); },
  };
}
