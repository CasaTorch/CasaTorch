/* ======================================================================
 * Support: so people rarely get stuck, and when they do, help is quick.
 *
 *  - Support file (Settings › Health › Get help): one file with what
 *    support needs - versions, platform, how it was installed, the health
 *    checks, which integrations are set up, timings, the SHAPE of the
 *    settings (names of settings, on/off and counts - never values) and the
 *    recent log. Everything is masked before it leaves: tokens, passwords,
 *    keys, e-mail addresses, the names in this home (people, house, rooms,
 *    cameras), host names and - unless you choose to include them -
 *    IP and MAC addresses. The screen shows exactly what's in it before you
 *    download or copy anything. Nothing is sent anywhere by CasaTorch.
 *  - Troubleshooters: the ten things people get stuck on most, each a list
 *    of real checks (the Health checks plus a few more) that says the fix.
 *  - "I'm locked out" for the owner: a one-time reset code written to a file
 *    in CasaTorch's data folder (and to the system log) - only someone with
 *    access to the box can read it. Home network only, rate limited,
 *    expires after 30 minutes, 5 tries, and recorded in the activity log.
 *  - Activity (Settings › People & sign-in): the audit log with filters.
 *    Kept for a year, at most 5,000 events.
 *  - Getting started on Home: six things that make CasaTorch useful, each
 *    ticked off from what's really set up. Hidden once done or dismissed.
 *  - Updates: which version ran before, how the last update went (the
 *    Linux updater writes .update-status.json) and the 'script' install.
 * ====================================================================== */
const SUP_FILE = path.join(DATA_DIR, 'support.json');
const sup = { checklist: { dismissed: false, seen3d: false, allDoneAt: null }, ...readJsonFile(SUP_FILE, {}) };
const supSave = () => { try { if (!isDemo()) writeFileSafe(SUP_FILE, JSON.stringify(sup), 0o600); } catch { /* the data-folder check reports it */ } };

/* ---------------------------------------------------------------- masking */
const SUP_SECRET_KEY = /pass|secret|token|apikey|api_key|key$|cookie|auth|cred|session|totp|otp|pin$|fingerprint|^ca$|cert|pem|private|uaid|refresh/i;
const SUP_PERSONAL_KEY = /name|title|label|e-?mail|user|host|address|addr|url|street|city|town|zip|postal|phone|ssid|location|place|serial|mac|^ip$|plate|owner|people|person|who|device|camera|room|area|entity|calendar|feed|team/i;
const SUP_SCHEMA_KEY = /^[a-z][a-zA-Z0-9]{0,31}$/;
const SUP_COMMON = new Set(['home', 'house', 'casatorch', 'camera', 'cameras', 'phone', 'panel', 'wall panel', 'owner', 'admin', 'member', 'viewer', 'true', 'false', 'auto', 'none', 'dark', 'light', 'default', 'this device', 'on', 'off', 'yes', 'no', 'local', 'cloud', 'frigate', 'snapshot', 'reolink', 'ring', 'hue', 'shelly', 'yolink', 'kiosk', 'tablet', 'browser', 'null', 'text', 'empty']);
/** The shape of a settings object: setting names, on/off, counts and kinds - never a value. A part keyed by
 *  names or ids (rooms, devices, people) shows only how many entries it has. */
function supShape(v, depth = 0, key = '') {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (SUP_SECRET_KEY.test(key)) return v === '' ? 'empty' : 'set (hidden)';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return v ? 'text' : 'empty';
  if (Array.isArray(v)) return v.length && depth < 2 && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0]) ? { items: v.length, each: supShape(v[0], depth + 1) } : { items: v.length };
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 3) return { entries: keys.length };
    if (keys.length > 40 || keys.some((k) => !SUP_SCHEMA_KEY.test(k))) return { entries: keys.length };   // a map keyed by names or ids
    return Object.fromEntries(keys.map((k) => [k, supShape(v[k], depth + 1, k)]));
  }
  return typeof v;
}
/** Every name, address and secret in this home's settings and accounts - to be masked wherever it shows up. */
function supPrivateStrings(...sources) {
  const names = new Set(), secrets = new Set();
  const walk = (v, key = '', personal = false, secret = false, depth = 0) => {
    if (depth > 8 || v == null) return;
    if (typeof v === 'string') {
      const s = v.trim();
      if (secret && s.length >= 6) secrets.add(s);
      else if (personal && s.length >= 3 && s.length <= 200 && !SUP_COMMON.has(s.toLowerCase()) && !/^(https?:\/\/)?(\d{1,3}\.){3}\d{1,3}(:\d+)?\/?$/.test(s)) {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { try { const h = new URL(s).hostname; if (h && !/^[\d.]+$|^\[/.test(h) && !/^(localhost|supervisor|homeassistant\.local|casatorch\.local)$/i.test(h)) names.add(h); } catch { /* not an address */ } }
        else names.add(s);
      }
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key, personal, secret, depth + 1); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k, personal || SUP_PERSONAL_KEY.test(k), secret || SUP_SECRET_KEY.test(k), depth + 1);
  };
  for (const s of sources) walk(s);
  return { names: [...names].sort((a, b) => b.length - a.length), secrets: [...secrets].sort((a, b) => b.length - a.length) };
}
const supEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Mask a piece of text for sharing. maskIps:false keeps IP addresses (MAC addresses are always masked). */
function supMaskText(text, priv = { names: [], secrets: [] }, { maskIps = true } = {}) {
  let s = logMask(String(text ?? ''));
  for (const x of priv.secrets) s = s.split(x).join('***');
  for (const x of [...priv.secrets]) { const j = JSON.stringify(x).slice(1, -1); if (j !== x) s = s.split(j).join('***'); }
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*\?[^\s"'<>]+/gi, (u) => `${u.split('?')[0]}?‹query›`)   // query strings can carry keys
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '‹email›')
    .replace(/\b[0-9a-f]{2}([:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}\b/gi, '‹mac›')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:casatorch\.com|trycloudflare\.com|cfargotunnel\.com|duckdns\.org|nabu\.casa|ui\.nabu\.casa)\b/gi, (h) => (/^(www\.|docs\.)?casatorch\.com$/i.test(h) ? h : `‹host›.${h.split('.').slice(-2).join('.')}`))
    .replace(/\b(?!casatorch\.local\b|homeassistant\.local\b)[a-z0-9-]+\.(?:local|lan|home\.arpa|internal|localdomain)\b/gi, '‹host›.local')
    .replace(/(\/home\/|\/Users\/|[A-Z]:\\Users\\)[^/\\\s"']+/g, '$1‹user›');
  for (const x of priv.names) { const re = new RegExp(`(^|[^\\p{L}\\p{N}])${supEsc(x)}(?=$|[^\\p{L}\\p{N}])`, 'giu'); s = s.replace(re, '$1‹name›'); }
  if (maskIps) {
    s = s.replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?\b/gi, (m) => (/^\d+(:\d+)*$/.test(m) && m.split(':').length < 4 ? m : '‹ipv6›'))
      .replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (m, a, b) => (a === '127' || m === '0.0.0.0' ? m : a === '10' || (a === '192' && b === '168') || (a === '172' && +b >= 16 && +b <= 31) ? '‹home-ip›' : '‹ip›'));
  }
  return s;
}

/* ---------------------------------------------------------------- the support file */
async function supTimings() {
  const lag = await new Promise((ok) => { const t = process.hrtime.bigint(); setImmediate(() => ok(Number(process.hrtime.bigint() - t) / 1e6)); });
  let write = null; try { const f = path.join(DATA_DIR, `.support-test-${process.pid}`), t = Date.now(); writeFileSafe(f, 'x'.repeat(65536), 0o600); fs.rmSync(f, { force: true }); write = Date.now() - t; } catch { /* the data-folder check says why */ }
  let ha = null; const h = config.homeAssistant;
  if (h?.url && !isDemo()) { const t = Date.now(); try { await fetch(`${h.url}/api/`, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(6000) }); ha = Date.now() - t; } catch { ha = 'no answer'; } }
  return { eventLoopMs: Math.round(lag * 10) / 10, writeDataMs: write, homeAssistantMs: ha };
}
function supAuditSummary(days = 7) {
  const since = Date.now() - days * 86400_000, out = {};
  for (const e of supAuditRead()) if (Date.parse(e.at) >= since) out[e.event] = (out[e.event] || 0) + 1;
  return out;
}
function supIntegrations() {
  const c = config || {}, cams = c.cameras || [], types = {};
  for (const x of cams) types[x.type || 'other'] = (types[x.type || 'other'] || 0) + 1;
  return {
    homeAssistant: c.homeAssistant?.url ? { set: true, viaAddon: c.homeAssistant.url === SUPERVISOR_HA, liveUpdates: typeof LIVE === 'object' ? !!LIVE.ok : null } : false,
    hue: !!c.hue?.host, shelly: (c.shelly || []).length, yolink: !!c.yolink?.uaid, ring: !!c.ring,
    cameras: { count: cams.length, types, pinnedCertificates: cams.filter((x) => x.ca).length },
    secureAccess: c.remote?.on ? { on: true, state: typeof remote === 'object' ? remote.state : null } : false,
    secureAddressAtHome: !!LOCAL_TLS.url,
    alerts: { browsers: typeof push === 'object' ? push.subs.length : null, phones: typeof push === 'object' ? (push.apps || []).length : null, failing: typeof push === 'object' ? [...push.subs, ...(push.apps || [])].filter((s) => s.lastError && !s.lastOk).length : null, homeAssistantApp: c.alerts?.phone === 'homeassistant', quietHours: c.alerts?.quietHours || '22-7' },
    ai: !!(c.ai && Object.keys(c.ai).length), calendars: (c.calendars || []).length, location: !!c.location,
  };
}
function supPeople() {
  const list = Array.isArray(users?.list) ? users.list : [], roles = {};
  for (const u of list) roles[u.role] = (roles[u.role] || 0) + 1;
  const sess = Object.values(typeof sessions === 'object' ? sessions : {});
  return { signIn: signInOn(), accounts: list.length, roles, twoStep: list.filter((u) => u.totp?.on).length, invitesOpen: list.filter((u) => u.invite).length, wallPanels: (users?.panels || []).length, sessions: { open: sess.length, phoneApp: sess.filter((s) => s.kind === 'app').length } };
}
function supUpdateStatus() {
  const st = readJsonFile(path.join(DATA_DIR, '.update-status.json'), null);
  return st && typeof st === 'object' ? { state: String(st.state || ''), from: st.from || null, to: st.to || null, at: st.at || null, message: st.message ? String(st.message).slice(0, 300) : null } : null;
}
/** The support file, masked. Returns { text, data } - the text is exactly what's downloaded and shown. */
async function supportBundle({ maskIps = true, fresh = false } = {}) {
  const t0 = Date.now();
  if (fresh || !DOC.at || Date.now() - Date.parse(DOC.at) > 10 * 60_000) await doctorRun().catch(() => {});
  const doctorMs = Date.now() - t0;
  const u = typeof updateView === 'function' ? updateView() : {};
  const raw = {
    kind: 'casatorch-support-file', format: 1, made: new Date().toISOString(),
    about: 'Made by CasaTorch for support. No passwords, tokens, keys, names or e-mail addresses are in it - they were masked before this file was made.',
    casatorch: { version: VERSION, install: INSTALL, demo: isDemo(), configured: isConfigured(), pro: !!proStatus().pro, plan: proStatus().plan || null },
    system: { ...systemInfo(), arch: os.arch(), osRelease: os.release(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, language: config.house?.lang || 'en' },
    timings: { ...(await supTimings()), healthChecksMs: doctorMs, uptimeSec: Math.round(process.uptime()) },
    health: { checkedAt: DOC.at, checks: DOC.checks.map((c) => ({ id: c.id, group: c.group, status: c.status, detail: c.detail, ...(c.why && c.status !== 'ok' ? { why: c.why } : {}) })), fixedByItself: HEAL.slice(-8).map((h) => ({ at: h.at, what: h.what, detail: h.detail })), settingsCopies: settingsHistory().length },
    integrations: supIntegrations(),
    people: supPeople(),
    updates: { version: u.version, latest: u.latest, available: u.available, check: u.check, auto: u.auto, checked: u.checked, error: u.error, lastUpdate: supUpdateStatus(), previousVersion: supVersions.prev || null },
    activityLast7Days: supAuditSummary(7),
    settingsShape: supShape(config),
    log: LOGBUF.slice(-200).map((l) => `${l.at} ${l.level.toUpperCase()} ${l.text}`),
  };
  const priv = supPrivateStrings(config, { users: (users?.list || []).map((x) => ({ name: x.name, username: x.username, email: x.email, password: x.password, totp: x.totp?.secret, google: x.google?.email })), panels: (users?.panels || []).map((p) => ({ name: p.name })) }, supExtraPrivate());
  const text = supMaskText(JSON.stringify(raw, null, 2), priv, { maskIps });
  let data = null; try { data = JSON.parse(text); } catch { data = null; }
  return { text, data };
}
/* Names kept outside config.json: the family hub's people, nudges' titles - masked too when they exist. */
function supExtraPrivate() {
  const out = {};
  try { if (typeof fam === 'object') out.family = { people: (fam.d?.people || []).map((p) => ({ name: p.name })), lists: (fam.d?.lists || []).map((l) => ({ name: l.name || l.title })) }; } catch { /* not loaded */ }
  try { if (typeof hh === 'object') out.household = { plants: (hh.cfg?.plants || []).map((p) => ({ name: p.name })) }; } catch { /* not loaded */ }
  return out;
}
/** A few lines for a forum post or an e-mail: what it is, what's wrong, what's connected. */
function supportSummary(d) {
  if (!d) return 'CasaTorch support summary could not be made.';
  const ck = d.health?.checks || [], bad = ck.filter((c) => c.status === 'bad'), warn = ck.filter((c) => c.status === 'warn');
  const i = d.integrations || {}, on = [];
  if (i.homeAssistant) on.push(`Home Assistant${i.homeAssistant.liveUpdates ? ' (live)' : ''}`);
  if (i.hue) on.push('Hue'); if (i.shelly) on.push(`Shelly x${i.shelly}`); if (i.yolink) on.push('YoLink'); if (i.ring) on.push('Ring');
  if (i.cameras?.count) on.push(`${i.cameras.count} camera(s): ${Object.entries(i.cameras.types).map(([k, n]) => `${k} x${n}`).join(', ')}`);
  if (i.secureAccess) on.push(`secure access (${i.secureAccess.state || 'on'})`);
  const probs = (d.log || []).filter((l) => / (WARN|ERROR) /.test(l));
  const lines = [
    `CasaTorch ${d.casatorch?.version} - ${d.casatorch?.install}${d.casatorch?.pro ? ' - Pro' : ''} - ${d.system?.platform} - Node ${String(d.system?.node || '').replace(/^v/, '')}`,
    `Running ${Math.round((d.system?.uptimeSec || 0) / 3600)} h - memory ${d.system?.memory?.rssMB} MB - data ${d.system?.dataMB} MB${d.system?.disk ? ` - ${Math.round(d.system.disk.freeBytes / 1073741824)} GB free` : ''}`,
    bad.length + warn.length ? `Health: ${[...bad.map((c) => `${c.id} NOT WORKING (${c.detail})`), ...warn.map((c) => `${c.id} needs a look (${c.detail})`)].join('; ')}` : 'Health: everything OK',
    `Connected: ${on.length ? on.join(', ') : 'nothing yet'}`,
    d.updates?.lastUpdate?.state ? `Last update: ${d.updates.lastUpdate.state}${d.updates.lastUpdate.to ? ` to ${d.updates.lastUpdate.to}` : ''}` : null,
    `Log: ${probs.length} warning(s) or error(s) in the last ${(d.log || []).length} lines${probs.length ? ` - latest: ${probs[probs.length - 1].slice(25, 200)}` : ''}`,
  ].filter(Boolean);
  return lines.join('\n');
}
app.get('/api/support/bundle', requireRole('admin'), async (req, res) => {
  const b = await supportBundle({ maskIps: req.query.ips !== '1', fresh: req.query.fresh === '1' });
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.download === '1') {
    audit(req, 'support-file-made', { ips: req.query.ips === '1' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="casatorch-support-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.send(b.text);
  }
  res.json({ text: b.text, summary: supportSummary(b.data), sections: b.data ? Object.keys(b.data) : [], bytes: Buffer.byteLength(b.text) });
});
app.post('/api/support/bundle/shared', requireRole('admin'), express.json({ limit: '1kb' }), (req, res) => { audit(req, req.body?.how === 'summary' ? 'support-summary-copied' : 'support-file-made', { ips: !!req.body?.ips }); res.json({ ok: true }); });

/* ---------------------------------------------------------------- troubleshooters */
const step = (status, title, detail, extra = {}) => { const [msg, vars] = Array.isArray(detail) ? detail : [detail]; return { status, title, detail: fillMsg(msg, vars), ...(vars ? { msg, vars } : {}), ...extra }; };
const fromCheck = (title, c) => (c ? step(c.status === 'off' ? 'info' : c.status, title, c.msg ? [c.msg, c.vars] : c.detail, { ...(c.why && c.status !== 'ok' ? { why: c.why } : {}), ...(c.fix && c.status !== 'ok' ? { fix: c.fix } : {}) }) : null);
const sameNet = (a, b) => !!a && !!b && a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.');
const GUIDES = {
  async reach(req) {
    const lan = lanAddress(), port = PORT, out = [];
    const url = lan ? `http://${lan}:${port}` : null;
    if (!lan) out.push(step('bad', 'Home-network address', 'CasaTorch can\'t see an address on your home network.', { why: INSTALL === 'docker' ? 'In Docker, use host networking for this container - the install guide shows how.' : 'Check that this computer is connected to your home network by cable or Wi-Fi.' }));
    else out.push(step('ok', 'Home-network address', ['CasaTorch is at {url} on your home network.', { url }]));
    if (url) {
      let ok = false, ms = null; const t = Date.now();
      try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(4000) }); ok = r.ok; ms = Date.now() - t; } catch { ok = false; }
      out.push(ok ? step('ok', 'Answers on that address', ['It answers on that address ({ms} ms).', { ms }]) : step('bad', 'Answers on that address', 'CasaTorch doesn\'t answer on its own home-network address.', { why: INSTALL === 'docker' ? 'Map the port in Docker (8090 on the computer to 8090 in the container), or use host networking.' : 'Something on this computer is blocking it: allow CasaTorch through its firewall.' }));
    }
    const me = String(clientIp(req) || '').replace(/^::ffff:/, '');
    if (/^(127\.|::1$)/.test(me)) out.push(step('info', 'This screen', url ? 'You are on the computer CasaTorch runs on. On your phone, scan the code below or type the address above.' : 'You are on the computer CasaTorch runs on.'));
    else if (lan && /^\d+\.\d+\.\d+\.\d+$/.test(me)) out.push(sameNet(me, lan) ? step('ok', 'This screen', 'This screen is on the same network as CasaTorch.') : step('warn', 'This screen', 'This screen is on a different network than CasaTorch.', { why: 'A guest Wi-Fi, a mesh "isolation" setting or a VPN keeps devices apart. Join the main home Wi-Fi, and turn off the VPN on the phone.' }));
    if (os.platform() === 'win32') out.push(step('warn', 'Windows network type', 'On Windows, other devices can only reach CasaTorch when the network is set to Private.', { why: 'Open Windows Settings › Network & internet › your Wi-Fi or Ethernet, and choose Private network.' }));
    out.push(typeof findOn === 'function' && findOn() ? step('ok', 'casatorch.com/home', 'On your phone, open casatorch.com/home on your home Wi-Fi - it takes you here.') : step('info', 'casatorch.com/home', 'Finding this CasaTorch from casatorch.com/home is turned off.', { fix: { label: 'Turn it on', href: '#settings/updates' } }));
    if (LOCAL_TLS.url) out.push(step('ok', 'Secure address at home', 'Phones can also use the secure address at home (https) - it works on your home Wi-Fi.'));
    out.push(step('info', 'Still not working?', 'Restart the Wi-Fi router and the phone, then try again. Give CasaTorch a fixed address in your router so it never moves.'));
    let qr = null; const best = LOCAL_TLS.url || url;
    try { if (best) qr = await QRCode.toString(best, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch { /* no picture: the address still shows */ }
    return { steps: out, qr, url: best };
  },
  async ha() {
    const h = config.homeAssistant;
    if (!h?.url) return { steps: [step('info', 'Home Assistant', 'Home Assistant isn\'t connected yet.', { fix: { label: 'Connect Home Assistant', href: setupLink('homeassistant') } })] };
    const out = []; const t = Date.now(); let reach = false;
    try { await fetch(`${h.url}/api/`, { signal: AbortSignal.timeout(6000) }); reach = true; } catch (err) { const e = errLine(err, 'Home Assistant', h.url); out.push(step('bad', 'Reaching Home Assistant', e.detail, { why: e.why || 'Check that Home Assistant is running and that its address hasn\'t changed.', fix: { label: 'Try again', action: 'retry', id: 'ha' } })); }
    if (reach) out.push(step('ok', 'Reaching Home Assistant', ['Home Assistant answers ({ms} ms).', { ms: Date.now() - t }]));
    if (reach) { const c = await docHa().catch(() => null); out.push(fromCheck('Its token', c?.status === 'ok' ? { ...c, detail: 'Home Assistant accepts CasaTorch\'s token.', msg: null } : c)); }
    out.push(typeof LIVE === 'object' && LIVE.ok ? step('ok', 'Instant updates', 'Changes from Home Assistant arrive instantly.') : step('warn', 'Instant updates', 'Instant updates are reconnecting - CasaTorch checks every few seconds meanwhile.'));
    if (out.some((s) => s.status === 'bad' && /token/i.test(s.detail))) out.push(step('info', 'The fix', 'A token stops working when it\'s deleted in Home Assistant (your profile › Security › Long-lived access tokens) or Home Assistant was reinstalled. Sign in to Home Assistant again from CasaTorch - nothing else changes.'));
    return { steps: out.filter(Boolean) };
  },
  async cameras() {
    const cams = config.cameras || [], out = [];
    const ha = ((await houseDevices().catch(() => ({ devices: [] }))).devices || []).filter((d) => d.kind === 'camera' && d.provider === 'ha');
    if (!cams.length && !ha.length && !config.ring) return { steps: [step('info', 'Cameras', 'No cameras are connected yet.', { fix: { label: 'Add a camera', href: setupLink('cameras') } })] };
    for (const c of cams.slice(0, 12)) {
      const fn = CAMERA_SNAPSHOT[c.type]; if (!fn) continue;
      const t = Date.now();
      try { const r = await timed(fn(c), 12000, c.name || 'camera'); out.push(step(r?.buf?.length ? 'ok' : 'warn', c.name || 'Camera', r?.buf?.length ? ['Sent a picture ({ms} ms).', { ms: Date.now() - t }] : 'Answered, but sent an empty picture.')); }
      catch (err) {
        const cert = err.code === 'CERT_CHANGED' || /certificate changed/i.test(err.message);
        const e = cert ? { detail: 'Its security certificate changed, so CasaTorch stopped talking to it.', why: null } : err.status === 401 ? { detail: 'It turned down the username or password.', why: 'Enter them again in setup.' } : errLine(err, c.name || 'The camera', c.url || (c.host ? `http://${c.host}` : ''));
        out.push(step('bad', c.name || 'Camera', e.detail, { why: e.why || null, fix: cert ? { label: 'Open the certificate check', guide: 'frigate' } : { label: 'Check its settings', href: setupLink('cameras', c.type === 'frigate' ? 'frigate' : undefined) } }));
      }
    }
    if (ha.length) out.push(step(ha.some((d) => d.online === false) ? 'warn' : 'ok', 'Cameras from Home Assistant', ha.some((d) => d.online === false) ? ['{n} of {total} are unavailable in Home Assistant - check them there first.', { n: ha.filter((d) => d.online === false).length, total: ha.length }] : ['{n} cameras come through Home Assistant.', { n: ha.length }]));
    if (config.ring) out.push(step(proStatus().pro ? 'ok' : 'warn', 'Ring', proStatus().pro ? 'Ring is connected. Battery cameras can take a few seconds to wake up.' : 'Ring cameras are part of Pro.'));
    out.push(step('info', 'Pictures but no live video?', 'Tiles show a fresh picture every few seconds. Live video plays when you tap a Frigate camera or a camera in Home Assistant.'));
    return { steps: out };
  },
  async remote() {
    if (!config.remote?.on) return { steps: [step('info', 'Secure access', 'Secure access is off.', { fix: { label: 'Open Connections', href: '#settings/connections' } })] };
    const out = [fromCheck('Secure access', await docRemote().catch(() => null))].filter(Boolean);
    out.push(proStatus().pro ? step('ok', 'Away from home', 'With Pro, the secure address works from anywhere.') : step('info', 'Away from home', 'On CasaTorch Free the secure address works on your home Wi-Fi. Using it from anywhere is part of Pro.'));
    const n = typeof internetNow === 'function' ? await internetNow().catch(() => null) : null;
    if (n && !n.online) out.push(step('bad', 'Internet', 'The internet is down at home, so secure access can\'t work until it\'s back.'));
    return { steps: out };
  },
  async locked(req) {
    const list = users?.list || [], u = req.user, owners = list.filter((x) => x.role === 'owner' && x.password).length, admins = list.filter((x) => x.role === 'admin' && x.password).length;
    const out = [];
    if (!signInOn()) return { steps: [step('info', 'Sign-in', 'Sign-in is off on this CasaTorch, so nobody can be locked out.')] };
    out.push(step('info', 'Someone else forgot their password', 'An owner or admin resets it in Settings › People & sign-in: they get a new link to choose a password.'));
    if (u?.totp?.on) { const left = u.totp.recovery?.length ?? 0; out.push(step(left > 2 ? 'ok' : 'warn', 'Your recovery codes', left === 1 ? 'You have 1 recovery code left.' : ['You have {n} recovery codes left.', { n: left }], left > 2 ? {} : { why: 'Make new ones in Settings › People & sign-in › Your account, and keep them somewhere safe.' })); }
    out.push(step(owners + admins > 1 ? 'ok' : 'warn', 'More than one admin', owners + admins > 1 ? ['{n} people can reset passwords here.', { n: owners + admins }] : 'Only one person can reset passwords here.', owners + admins > 1 ? {} : { why: 'Make a second person you trust an admin, so one forgotten password never locks the house out.' }));
    out.push(step('info', 'The owner is locked out', 'On the sign-in page, choose "The owner and locked out?". CasaTorch writes a one-time reset code to a file on the box itself - only someone with access to the box can read it. Then pick a new password.'));
    return { steps: out };
  },
  async alerts(req) {
    const out = [], subs = push.subs || [], apps = push.apps || [], haApp = config.alerts?.phone === 'homeassistant' && !!config.homeAssistant?.url;
    const mine = subs.filter((s) => s.user === (req.user?.id || 'local')).length + apps.filter((a) => a.user === (req.user?.id || 'local')).length;
    if (!subs.length && !apps.length && !haApp) out.push(step('bad', 'Phones with alerts on', 'No phone or computer has alerts turned on yet.', { fix: { label: 'Turn on alerts', href: '#settings/phones' } }));
    else out.push(step('ok', 'Phones with alerts on', [haApp ? '{n} device(s) get alerts, and the Home Assistant app too.' : '{n} device(s) get alerts.', { n: subs.length + apps.length }]));
    if (subs.length + apps.length && !mine) out.push(step('warn', 'This person', 'You have no device with alerts on yourself.', { fix: { label: 'Turn on alerts', href: '#settings/phones' } }));
    const broken = [...subs, ...apps].filter((s) => s.lastError && !s.lastOk);
    if (broken.length) out.push(step('bad', 'Devices that stopped answering', ['{n} device(s) didn\'t take the last alert: {names}.', { n: broken.length, names: broken.map((s) => s.name || 'a device').slice(0, 5).join(', ') }], { why: 'On that device, turn alerts off and on again in CasaTorch. On an iPhone, alerts need CasaTorch added to the Home Screen first.' }));
    const q = config.alerts?.quietHours || '22-7';
    if (quietNow()) out.push(step('warn', 'Quiet hours', ['Quiet hours are on right now ({hours}) - only critical alerts go out.', { hours: q }], { fix: { label: 'Change quiet hours', href: '#settings/phones' } }));
    else out.push(step('ok', 'Quiet hours', q === 'none' ? 'Quiet hours are off.' : ['Not in quiet hours now ({hours}).', { hours: q }]));
    if (typeof sentThisHour === 'object' && sentThisHour.n > 30) out.push(step('warn', 'Too many alerts', 'More than 30 alerts this hour - CasaTorch holds back all but critical ones so a flapping sensor can\'t buzz phones all night.'));
    const n = typeof internetNow === 'function' ? await internetNow().catch(() => null) : null;
    if (n) out.push(n.online ? step('ok', 'Internet', 'Online - alerts can reach phones.') : step('bad', 'Internet', 'The internet is down - alerts to phones wait until it\'s back.'));
    out.push(step('info', 'Phone settings', 'On the phone, allow notifications for CasaTorch (or your browser), and turn off battery saving for it. Focus or Do Not Disturb can hold alerts back.'));
    return { steps: out, canTest: mine > 0 };
  },
  async frigate() {
    const cams = (config.cameras || []).filter((c) => c.type === 'frigate');
    if (!cams.length) return { steps: [step('info', 'Frigate', 'No Frigate cameras are connected.')] };
    const seen = new Map(), out = [];
    for (const c of cams) { const b = frigateBase(c); if (!seen.has(b)) seen.set(b, c); }
    for (const [base, c] of seen) {
      if (!/^https:/i.test(base) || !c.fingerprint) { out.push(step('ok', 'Frigate', 'Frigate is reached without a certificate (its open port on your network).')); continue; }
      try {
        const got = await peekCertificate(base);
        const short = (f) => String(f || '').split(':').slice(0, 6).join(':');
        if (got.fingerprint === c.fingerprint) {
          let days = null; try { days = Math.floor((Date.parse(new crypto.X509Certificate(c.ca).validTo) - Date.now()) / 86400_000); } catch { /* not readable */ }
          out.push(step(days != null && days < 21 ? 'warn' : 'ok', 'Frigate\'s certificate', days != null ? ['Same certificate as when you trusted it ({fp}…). It runs out in {n} days.', { fp: short(got.fingerprint), n: days }] : ['Same certificate as when you trusted it ({fp}…).', { fp: short(got.fingerprint) }]));
        } else {
          out.push(step('bad', 'Frigate\'s certificate', ['It changed. Trusted: {old}… Now: {now}…', { old: short(c.fingerprint), now: short(got.fingerprint) }], { why: 'That\'s expected after updating or reinstalling Frigate, or when it made a new certificate. If you didn\'t, something else may be answering at that address - check before you trust it. Then trust the new certificate in setup.', fix: { label: 'Check and trust again', href: setupLink('cameras', 'frigate') } }));
        }
      } catch (err) { const e = errLine(err, 'Frigate', base); out.push(step('bad', 'Reaching Frigate', e.detail, { why: e.why })); }
    }
    return { steps: out };
  },
  async update() {
    const u = updateView(), out = [], st = supUpdateStatus();
    out.push(step('ok', 'This version', ['CasaTorch {version}, installed as {install}.', { version: u.version, install: INSTALL_WORDS[INSTALL] || INSTALL }]));
    if (st && /fail|rolled/.test(st.state)) out.push(step('bad', 'The last update', st.state === 'rolled-back' ? ['Updating to {to} didn\'t work, so CasaTorch went back to {from} by itself.', { to: st.to || '?', from: st.from || u.version }] : ['Updating to {to} didn\'t finish.', { to: st.to || '?' }], { why: st.message || null }));
    else if (st?.state === 'done') out.push(step('ok', 'The last update', ['Updated to {to}.', { to: st.to || u.version }]));
    else if (st && /download|install|check/.test(st.state)) out.push(step('info', 'The last update', ['An update to {to} is in progress.', { to: st.to || '?' }]));
    if (u.error) out.push(step('warn', 'Checking for updates', 'CasaTorch couldn\'t ask casatorch.com right now.', { why: u.error, fix: { label: 'Check now', action: 'check-updates' } }));
    else if (u.available) out.push(step('warn', 'Newest version', ['CasaTorch {latest} is available.', { latest: u.latest }], { why: u.how }));
    else out.push(step('ok', 'Newest version', u.latest ? 'You have the newest version.' : 'Not checked yet.'));
    out.push(fromCheck('Storage space', docStorage()));
    const n = typeof internetNow === 'function' ? await internetNow().catch(() => null) : null;
    if (n) out.push(n.online ? step('ok', 'Internet', 'Online.') : step('bad', 'Internet', 'The internet is down - updates wait until it\'s back.'));
    const before = settingsHistory().filter((id) => /before/.test(id));
    out.push(before.length ? step('ok', 'Copy from before updating', 'A copy of your settings from before the last update is kept. Health › Settings history can put it back.', { fix: { label: 'See saved copies', href: '#settings/health' } }) : step('info', 'Copy from before updating', 'CasaTorch saves a copy of your settings before every update.'));
    out.push(step('info', 'How to update', u.how));
    return { steps: out.filter(Boolean) };
  },
};
const INSTALL_WORDS = { 'ha-addon': 'a Home Assistant add-on', docker: 'Docker', deb: 'a Linux package', 'pi-image': 'a CasaTorch Box / Raspberry Pi', windows: 'Windows', macos: 'a Mac app', script: 'the Linux installer', manual: 'a source install' };
app.post('/api/support/guides/:id', requireRole('admin'), express.json({ limit: '2kb' }), async (req, res) => {
  const fn = Object.hasOwn(GUIDES, req.params.id) ? GUIDES[req.params.id] : null;
  if (!fn) return res.status(404).json({ error: 'That troubleshooter isn\'t here.' });
  if (isDemo() && !['locked', 'alerts', 'update', 'reach'].includes(req.params.id)) return res.json({ demo: true, steps: [step('info', 'Demo', 'The demo has no real devices to check. On your own CasaTorch, this runs real tests.')] });
  try { res.setHeader('Cache-Control', 'no-store'); res.json({ id: req.params.id, at: nowIso(), ...(await timed(fn(req), 45000, 'the troubleshooter')) }); }
  catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});
/* "Send a test alert" from the troubleshooter: to every device of yours that has alerts on. */
app.post('/api/support/test-alert', express.json({ limit: '1kb' }), async (req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true, sent: 0 });
  const me = req.user?.id || 'local';
  if (limited(`testalert:${me}`, 5, 10 * 60_000)) return res.status(429).json({ error: 'That\'s a lot of tests - wait a few minutes.' });
  failed(`testalert:${me}`);
  const msg = { title: 'CasaTorch', body: 'Test alert: alerts reach this device.', tag: 'test', url: '/#alerts', sev: 'info' };
  const subs = push.subs.filter((s) => s.user === me), apps = (push.apps || []).filter((a) => a.user === me);
  let ok = 0, bad = 0;
  if (subs.length) { const k = vapid(); await Promise.allSettled(subs.map(async (s) => { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(msg), { TTL: 600, vapidDetails: { subject: 'mailto:support@casatorch.com', publicKey: k.publicKey, privateKey: k.privateKey } }); ok++; } catch { bad++; } })); }   // scrub-ok: the public support address (VAPID contact)
  if (apps.length) { const r = await appPushSend(apps, msg).catch(() => ({ ok: false })); if (r.ok) ok += apps.length; else bad += apps.length; }
  res.json({ ok: ok > 0, sent: ok, failed: bad });
});

/* ---------------------------------------------------------------- owner recovery */
const RECOVER_FILE = path.join(DATA_DIR, 'owner-reset-code');
let recoverPending = null;   // { hash, exp, tries }
const recoverWhere = () => (process.env.SUPERVISOR_TOKEN ? 'addon' : INSTALL === 'docker' || fs.existsSync('/.dockerenv') ? 'docker' : ['deb', 'pi-image', 'script'].includes(INSTALL) ? 'linux' : INSTALL === 'windows' ? 'windows' : INSTALL === 'macos' ? 'macos' : 'computer');
const viaSecureAccess = (req) => !!(config.remote?.hostname && String(req.headers.host || '').toLowerCase().startsWith(String(config.remote.hostname).toLowerCase()));
function recoverOwners() { return (users?.list || []).filter((u) => u.role === 'owner' && !u.panel); }
app.get('/api/auth/recover/state', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!signInOn()) return res.json({ available: false });
  // The code itself is never shown in a browser - not even on the box: a reverse proxy on the same computer looks local too.
  const where = recoverWhere(), local = !!setupTrusted(req) && !viaSecureAccess(req);
  res.json({ available: !viaSecureAccess(req), away: viaSecureAccess(req), where, file: path.basename(RECOVER_FILE), folder: where === 'linux' || (local && !['docker', 'addon'].includes(where)) ? DATA_DIR : null, pending: !!(recoverPending && recoverPending.exp > Date.now()), owners: recoverOwners().length });
});
app.post('/api/auth/recover/start', express.json({ limit: '1kb' }), (req, res) => {
  if (!signInOn()) return res.status(409).json({ error: 'Sign-in is off - just open CasaTorch.' });
  if (viaSecureAccess(req)) return res.status(403).json({ error: 'For safety, resetting the owner\'s password only works on your home network.' });
  const ip = clientIp(req);
  if (limited(`recover:${ip}`, 3, 60 * 60_000) || limited('recover:all', 6, 24 * 3600_000)) return res.status(429).json({ error: 'Too many reset codes asked for. Wait an hour and try again.' });
  failed(`recover:${ip}`, 'recover:all');
  const code = Array.from({ length: 10 }, () => CODE_ABC[crypto.randomInt(CODE_ABC.length)]).join('');
  recoverPending = { hash: sha256(code), exp: Date.now() + 30 * 60_000, tries: 0 };
  const shown = `${code.slice(0, 5)}-${code.slice(5)}`;
  try { writeFileSafe(RECOVER_FILE, `CasaTorch owner reset code: ${shown}\nWorks once, for 30 minutes (until ${new Date(recoverPending.exp).toISOString()}).\nIf you didn't ask for it, delete this file - nothing changes.\n`, 0o600); } catch { /* the system log still has it */ }
  // Straight to the system log (journald, Docker, the add-on log) - not into the in-app log that admins can read.
  try { process.stdout.write(`\n  CasaTorch owner reset code: ${shown}  (asked for on the sign-in page; works once, for 30 minutes)\n\n`); } catch { /* no stdout */ }
  audit(req, 'owner-reset-asked');
  if (typeof alertRaise === 'function') alertRaise({ id: `owner-reset:${Date.now()}`, severity: 'warning', title: 'Someone asked to reset the owner\'s password', body: 'If that wasn\'t you or someone you trust, you can ignore it - the code is only on the box itself.', source: 'sign-in' });
  res.json({ ok: true, where: recoverWhere() });
});
app.post('/api/auth/recover/finish', express.json({ limit: '2kb' }), (req, res) => {
  if (!signInOn()) return res.status(409).json({ error: 'Sign-in is off.' });
  if (viaSecureAccess(req)) return res.status(403).json({ error: 'For safety, resetting the owner\'s password only works on your home network.' });
  const ip = clientIp(req), b = req.body || {};
  if (limited(`recoverfin:${ip}`, 8) || limited('recoverfin:all', 20)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  if (!recoverPending || recoverPending.exp < Date.now()) { failed(`recoverfin:${ip}`, 'recoverfin:all'); return res.status(401).json({ error: 'No reset code is waiting, or it ran out. Ask for a new one.' }); }
  const got = sha256(cleanCode(b.code)), want = recoverPending.hash;
  if (!crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    failed(`recoverfin:${ip}`, 'recoverfin:all'); audit(req, 'owner-reset-failed');
    if (++recoverPending.tries >= 5) { recoverPending = null; try { fs.rmSync(RECOVER_FILE, { force: true }); } catch { /* gone */ } return res.status(401).json({ error: 'That code isn\'t right, and it was tried too often - ask for a new one.' }); }
    return res.status(401).json({ error: 'That code isn\'t right. It\'s 10 letters and numbers, like ABCDE-23456.' });
  }
  const owners = recoverOwners(), name = String(b.username || '').trim().toLowerCase();
  const u = name ? owners.find((x) => x.username.toLowerCase() === name || String(x.email || '').toLowerCase() === name) : owners.length === 1 ? owners[0] : null;
  if (!u) return res.status(400).json({ error: owners.length > 1 && !name ? 'This CasaTorch has more than one owner - type the owner\'s username.' : 'That isn\'t an owner\'s username.', needUser: owners.length > 1 });
  const problem = passwordProblem(b.password, u.username); if (problem) return res.status(400).json({ error: problem });
  u.password = hashSecret(b.password); delete u.invite;
  const twoStepOff = !!(b.turnOff2fa && u.totp?.on); if (twoStepOff) delete u.totp;
  saveUsers(); endSessionsOf(u.id);
  recoverPending = null; try { fs.rmSync(RECOVER_FILE, { force: true }); } catch { /* gone */ }
  audit(req, 'owner-reset', { user: u.username, twoStepOff });
  if (typeof alertRaise === 'function') alertRaise({ id: `owner-reset-done:${Date.now()}`, severity: 'warning', title: 'The owner\'s password was reset with a code from the box', body: twoStepOff ? 'Two-step sign-in was turned off for the owner - turn it on again in Settings › People & sign-in.' : 'Every device signed in as the owner was signed out.', source: 'sign-in' });
  res.json({ ok: true, username: u.username, twoStepOff });
});
OPEN.push(/^\/recover\.(html|js)$/, /^\/api\/auth\/recover\/(state|start|finish)$/);

/* ---------------------------------------------------------------- activity (the audit log) */
const ACT_KINDS = {
  signin: ['signed-in', 'signed-out', 'panel-signed-in', 'google-linked', 'terms-accepted', 'invite-accepted'],
  failed: ['login-failed', 'login-limited', 'code-failed', 'google-unknown', 'google-failed', 'owner-reset-failed'],
  account: ['password-changed', '2fa-on', '2fa-off', '2fa-skipped', 'recovery-codes-new', 'recovery-code-used', 'session-ended', 'other-sessions-ended', 'owner-reset-asked', 'owner-reset'],
  people: ['user-added', 'user-removed', 'user-reset', 'role-changed', 'owner-saved', 'policy-changed', 'google-on', 'google-off', 'panel-link-made', 'panel-link-revoked'],
  pairing: ['phone-paired', 'pairing-code-made', 'alerts-device-on', 'alerts-device-off', 'alerts-phone-on', 'alerts-phone-off'],
  settings: ['settings-changed', 'setup-reopened', 'ai-settings-changed', 'alert-settings-changed', 'security-settings-changed', 'update-settings-changed', 'find-setting-changed', 'safety-exception-changed', 'license-added', 'license-removed', 'connection-removed', 'settings-put-back', 'floorplan-imported'],
  remote: ['secure-access-on', 'secure-access-off', 'secure-access-repaired', 'home-https-on', 'home-https-off'],
  exports: ['backup-made', 'backup-restored', 'floorplan-exported', 'diagnostics-downloaded', 'support-file-made', 'support-summary-copied'],
  system: ['restarted', 'updated', 'alert-acknowledged'],
};
const ACT_KIND_OF = Object.fromEntries(Object.entries(ACT_KINDS).flatMap(([k, list]) => list.map((e) => [e, k])));
const ACT_BAD = new Set(ACT_KINDS.failed);
const ACT_KEEP_DAYS = 365, ACT_KEEP_N = 5000;
function supAuditRead() {
  try { return fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.at && e.event); } catch { return []; }
}
/** Filter activity: kind (a group above, or 'all'), q (words), days, before (an ISO time, for "show more"). Pure (unit-tested). */
function activityFilter(events, { kind = 'all', q = '', days = 0, before = null, limit = 100 } = {}) {
  const since = days > 0 ? Date.now() - days * 86400_000 : 0, words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i], at = Date.parse(e.at);
    if (since && at < since) break;
    if (before && !(at < Date.parse(before))) continue;
    const k = ACT_KIND_OF[e.event] || 'system';
    if (kind !== 'all' && k !== kind) continue;
    if (words.length) { const hay = JSON.stringify(e).toLowerCase(); if (!words.every((w) => hay.includes(w))) continue; }
    out.push({ ...e, kind: k, bad: ACT_BAD.has(e.event) });
  }
  return out;
}
/** Keep a year, and at most 5,000 events. Pure (unit-tested): lines in, lines out. */
function activityTrim(lines, now = Date.now()) {
  const cut = now - ACT_KEEP_DAYS * 86400_000;
  return lines.filter((l) => { try { const at = Date.parse(JSON.parse(l).at); return !(at < cut); } catch { return false; } }).slice(-ACT_KEEP_N);
}
function activityTrimFile() {
  try {
    const lines = fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean), keep = activityTrim(lines);
    if (keep.length !== lines.length) fs.writeFileSync(AUDIT_FILE, keep.length ? `${keep.join('\n')}\n` : '', { mode: 0o600 });
  } catch { /* no log yet */ }
}
if (process.env.CASATORCH_TEST !== '1') { setTimeout(activityTrimFile, 5 * 60_000).unref?.(); setInterval(activityTrimFile, 24 * 3600_000).unref?.(); }
app.get('/api/support/activity', requireRole('admin'), (req, res) => {
  const kind = Object.hasOwn(ACT_KINDS, String(req.query.kind)) ? String(req.query.kind) : 'all';
  const days = Math.min(400, Math.max(0, Number(req.query.days) || 0)), before = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(req.query.before || '')) ? String(req.query.before) : null;
  const all = supAuditRead(), list = activityFilter(all, { kind, q: String(req.query.q || '').slice(0, 80), days, before, limit: 101 });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ events: list.slice(0, 100), more: list.length > 100, total: all.length, oldest: all[0]?.at || null, keepDays: ACT_KEEP_DAYS, keepMax: ACT_KEEP_N, kinds: Object.keys(ACT_KINDS) });
});

/* ---------------------------------------------------------------- getting started */
/** The checklist from what's really set up. Pure (unit-tested): facts in, items out. */
function checklistState(f, s = {}) {
  const items = [
    { id: 'ha', done: !!f.ha, href: f.haHref || '#connect' },
    { id: 'phone', done: !!f.phone, href: '#settings/phones' },
    { id: 'alerts', done: !!f.alerts, href: '#settings/phones' },
    { id: 'backup', done: !!f.backup, href: '#settings/updates' },
    { id: 'town', done: !!f.town, href: '#settings/general' },
    { id: '3d', done: !!(f.plan || s.seen3d), href: '#house3d' },
  ];
  const left = items.filter((i) => !i.done).length;
  // Hidden when dismissed, before setup, in the demo, for people who can't change settings, and a day after the last item was ticked.
  const show = !!f.configured && !f.demo && !!f.admin && !s.dismissed && !(left === 0 && s.allDoneAt && Date.now() - Date.parse(s.allDoneAt) > 86400_000);
  return { show, items, done: items.length - left, total: items.length };
}
function checklistFacts(req) {
  const sess = Object.values(typeof sessions === 'object' ? sessions : {});
  let plan = false; try { plan = (fpData().floors || []).length > 0; } catch { /* no plan */ }
  return {
    configured: isConfigured(), demo: isDemo(), admin: !signInOn() || (req.user && rank(req.user.role) >= rank('admin') && !req.user.panel),
    ha: !!config.homeAssistant?.url, haHref: setupLink('homeassistant'),
    phone: sess.some((x) => x.kind === 'app') || push.subs.length > 0 || (push.apps || []).length > 0,
    alerts: push.subs.length > 0 || (push.apps || []).length > 0 || (config.alerts?.phone === 'homeassistant' && !!config.homeAssistant?.url),
    backup: INSTALL === 'ha-addon' || !!lastBackupAt(),
    town: Number.isFinite(Number(config.location?.lat)) && config.location?.lat != null,
    plan,
  };
}
app.get('/api/support/checklist', (req, res) => {
  const st = checklistState(checklistFacts(req), sup.checklist);
  if (st.done === st.total && !sup.checklist.allDoneAt && st.show) { sup.checklist.allDoneAt = nowIso(); supSave(); }
  res.setHeader('Cache-Control', 'no-store'); res.json(st);
});
app.post('/api/support/checklist', express.json({ limit: '1kb' }), (req, res) => {
  const b = req.body || {};
  if (b.seen === '3d') { if (!sup.checklist.seen3d) { sup.checklist.seen3d = true; supSave(); } return res.json({ ok: true }); }   // anyone who opened the 3D home
  if (signInOn() && !(req.user && rank(req.user.role) >= rank('admin'))) return res.status(403).json({ error: 'Only an admin can do that.' });
  if (typeof b.dismissed === 'boolean') { sup.checklist.dismissed = b.dismissed; supSave(); }
  res.json(checklistState(checklistFacts(req), sup.checklist));
});

/* ---------------------------------------------------------------- updates */
HOW_TO_UPDATE.script = 'Run the CasaTorch installer again, the same way you installed it - it updates CasaTorch, keeps your settings and saves a copy of them first. If the new version doesn\'t start, it goes back to the one you had.';
HOW_TO_UPDATE.deb = 'It installs itself overnight, and goes back to the version you had if the new one doesn\'t start. To update now, download the new .deb from casatorch.com/download and open it.';
HOW_TO_UPDATE['pi-image'] = 'It installs itself overnight, and goes back to the version you had if the new one doesn\'t start - nothing to do.';
const SUP_VER_FILE = path.join(DATA_DIR, '.versions.json');
const supVersions = (() => {
  const v = readJsonFile(SUP_VER_FILE, {});
  if (v.now !== VERSION && isConfigured() && !isDemo()) {
    const next = { now: VERSION, prev: v.now || null, since: nowIso() };
    try { writeFileSafe(SUP_VER_FILE, JSON.stringify(next), 0o600); } catch { /* read-only */ }
    if (v.now) setTimeout(() => audit(null, 'updated', { from: v.now, to: VERSION }), 0);
    return next;
  }
  return v;
})();
app.get('/api/support/update-status', (_req, res) => {
  const st = supUpdateStatus();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ version: VERSION, install: INSTALL, previous: supVersions.prev || null, since: supVersions.since || null, last: st, rollback: ['deb', 'pi-image', 'script'].includes(INSTALL), backupFirst: settingsHistory().some((id) => /before/.test(id)) });
});

if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchSupport = { supShape, supPrivateStrings, supMaskText, supportBundle, supportSummary, activityFor, activityFilter, activityTrim, checklistState, GUIDES, ACT_KINDS };
