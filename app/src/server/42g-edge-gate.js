/* ======================================================================
 * Secure Remote Access: the edge gate, sign-in alerts, and devices & sessions.
 *
 * The edge gate: Cloudflare checks every request to this home's secure address
 * (home-xxxxxxxx.casatorch.com) before it comes down the tunnel, and lets only
 * approved devices through. Approved means carrying a short-lived ticket this
 * CasaTorch signed with its own Ed25519 key (the one the app alert relay
 * already knows, sealed at rest - relayKey, 68-app.js). The key is registered
 * with casatorch.com when the tunnel is made; after that every change (a
 * removed phone, the lock, allowed countries) goes there as a signed call
 * (gateSync). casatorch.com can only close the address with it, never open it.
 *
 * Tickets (casatorch.com's edge-gate/src/ticket.js checks them the same way):
 *   ct1.<payload>.<signature>, payload = base64url JSON { h, d, k, e, nbf, exp }:
 *   the exact address, the device, the kind (app / browser / self), the
 *   revocation epoch, valid from / until (at most 12 hours). The signature is
 *   Ed25519 over the ASCII "ct1.<payload>".
 *   - the phone apps get a run of tickets covering the next week (each one 12
 *     hours, overlapping) when they sign in, pair, or open the home, and keep
 *     them in the phone's secure storage; a phone away from home for a few
 *     days still gets in, and can renew over its session;
 *   - a browser is approved by the owner, at home ("Approve this browser") or
 *     from the paired app (the browser shows a code, the app scans it); its
 *     ticket is an HttpOnly __Host- cookie, renewed while CasaTorch is open;
 *   - this CasaTorch's own self-test carries a 10-minute ticket ("box"), and
 *     also checks that the address is closed without one (Health).
 * Revoking: a removed phone or browser goes on the revoked list; "Sign every
 * device out of away access" bumps the epoch. Lock remote access and allowed
 * countries are checked at the edge and again here (02-remote-gate.js).
 *
 * Box-side checks (sign-in, two-step, limits, Basic only at home) stay as they
 * are: the gate is an extra layer in front of them, never a replacement.
 * Tickets are never written to a log or the audit log.
 * ====================================================================== */
const GATE_URL = REMOTE_URL.replace(/\/api\/remote$/, '/api/gate');
const GATE_FILE = path.join(DATA_DIR, 'edge-gate.json');
const GATE_LIFE_S = 12 * 3600, GATE_STEP_S = 11 * 3600, GATE_BATCH = 16, GATE_SELF_S = 600, GATE_SKEW_S = 60;   // 16 overlapping 12-hour tickets: a week
const GATE_REVOKE_KEEP_MS = (GATE_STEP_S * GATE_BATCH + GATE_LIFE_S + 3600) * 1000;   // longer than any ticket handed out can live
const GATE_COOKIE = '__Host-ct_gate', DEVICE_COOKIE = 'casatorch_device';
const gate = { st: null, chain: Promise.resolve(), lastSync: null, probe: null, timer: null };
const gateHost = () => String(config.remote?.hostname || '').toLowerCase();
function gateState() {
  if (gate.st) return gate.st;
  let s = null;
  try { s = JSON.parse(unseal(fs.readFileSync(GATE_FILE, 'utf8'), 'edge-gate') ?? 'null'); } catch { s = null; }
  gate.st = { epoch: 1, revoked: [], countries: null, locked: false, browsers: [], registered: null, v: 0, synced: 0, ...(s && typeof s === 'object' ? s : {}) };
  return gate.st;
}
const gateSave = () => { if (isDemo()) return; try { writeFileSafe(GATE_FILE, seal(JSON.stringify(gateState()), 'edge-gate'), 0o600); } catch { /* next change */ } };
const gateRevokedIds = (now = Date.now()) => { const st = gateState(); st.revoked = (st.revoked || []).filter((r) => r && r.until > now); return [...new Set(st.revoked.map((r) => r.d))].slice(-300); };
/** The gate is registered at casatorch.com for this address (else the Worker lets the address through as before). */
const gateActive = () => !!config.remote?.on && !!gateState().registered && gateState().registered.host === gateHost();

/* ---- tickets ---- */
const gateB64u = (b) => Buffer.from(b).toString('base64url');
function gateMake({ d, k, nbf, exp }) {
  const host = gateHost(); if (!host) return null;
  const p = gateB64u(JSON.stringify({ h: host, d, k, e: gateState().epoch, nbf, exp }));
  return `ct1.${p}.${crypto.sign(null, Buffer.from(`ct1.${p}`), relayKey().priv).toString('base64url')}`;
}
/** A phone's run of tickets: now, then one starting every 11 hours, each valid 12 hours (about a week in all). */
function gateAppTickets(d, now = Math.floor(Date.now() / 1000)) {
  const out = [];
  for (let i = 0; i < GATE_BATCH; i++) { const nbf = now - GATE_SKEW_S + i * GATE_STEP_S, exp = nbf + GATE_LIFE_S, t = gateMake({ d, k: 'app', nbf, exp }); if (t) out.push({ t, nbf, exp }); }
  return out;
}
const gateBrowserTicket = (d, now = Math.floor(Date.now() / 1000)) => ({ t: gateMake({ d, k: 'browser', nbf: now - GATE_SKEW_S, exp: now - GATE_SKEW_S + GATE_LIFE_S }), exp: now - GATE_SKEW_S + GATE_LIFE_S });
const gateSelfTicket = (now = Math.floor(Date.now() / 1000)) => gateMake({ d: 'box', k: 'self', nbf: now - GATE_SKEW_S, exp: now + GATE_SELF_S });
const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
/** One of this CasaTorch's own tickets, checked as the edge checks it (for renewing a browser's). Payload or null. */
function gateCheckOwn(t, now = Math.floor(Date.now() / 1000)) {
  const m = /^ct1\.([A-Za-z0-9_-]{20,700})\.([A-Za-z0-9_-]{86})$/.exec(String(t || '')); if (!m) return null;
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(`ct1.${m[1]}`), crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, Buffer.from(relayKey().pub, 'base64')]), format: 'der', type: 'spki' }), Buffer.from(m[2], 'base64url')); } catch { ok = false; }
  if (!ok) return null;
  let p; try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!p || p.h !== gateHost() || ![p.e, p.nbf, p.exp].every(Number.isInteger) || p.exp - p.nbf > GATE_LIFE_S) return null;
  if (now < p.nbf - GATE_SKEW_S || now >= p.exp + GATE_SKEW_S || p.e < gateState().epoch || gateRevokedIds().includes(p.d)) return null;
  return p;
}
const gateCookieOf = (req) => { for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === GATE_COOKIE) return part.slice(i + 1).trim(); } return null; };

/* ---- telling casatorch.com (signed; one at a time, in order) ---- */
function gateSync({ handoff = null, grace } = {}) {
  const run = async () => {
    const r = config.remote, host = gateHost();
    if (!r?.on || !host || !r.secret || isDemo()) return { ok: false, skipped: true };
    const k = relayKey(), st = gateState();
    /* Pro from anywhere is checked at the edge too: the Pro key (casatorch.com keeps only whether it is still good, never
       the key) and this home's internet addresses, so without Pro the address still answers at home (Basic). */
    const h = typeof homeIps === 'function' ? await homeIps().catch(() => null) : null;
    const home = h ? { v4: h.v4 || null, v6: h.v6 || null } : null, lic = typeof config.license === 'string' && config.license.trim() ? config.license.trim() : null;
    for (let attempt = 0; attempt < 2; attempt++) {
      st.v = Math.max(Date.now(), (st.v || 0) + 1);
      const body = JSON.stringify({ id: installId(), secret: r.secret, hostname: host, pub: k.pub, ts: Date.now(), v: st.v, ...(grace != null ? { grace } : {}),
        state: { epoch: st.epoch, revoked: gateRevokedIds(), countries: st.countries?.length ? st.countries : null, locked: !!st.locked }, ...(handoff ? { handoff } : {}), ...(lic ? { key: lic } : {}), ...(home ? { home } : {}) });
      const sig = crypto.sign(null, Buffer.from(body), k.priv).toString('base64');
      let res, j = {};
      try { res = await fetch(GATE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CT-Sig': sig }, body, signal: AbortSignal.timeout(15_000) }); j = await res.json().catch(() => ({})); }
      catch (e) { gate.lastSync = { at: nowIso(), ok: false, error: `casatorch.com couldn't be reached (${e.cause?.code || e.name})` }; gateSave(); gateRetry(); return { ok: false, error: gate.lastSync.error }; }
      if (res.ok && j.active) {
        // casatorch.com never lowers the epoch (this box may have lost its own record of it: a backup restored on new
        // hardware, a key that no longer opens edge-gate.json): take on the one in place, so new tickets get through
        if (Number.isInteger(j.epoch) && j.epoch > st.epoch && j.epoch <= 2 ** 31) st.epoch = j.epoch;
        st.registered = { host, pub: k.pub, at: st.registered?.host === host ? st.registered.at : nowIso() }; st.synced = st.v; st.graceUntil = j.graceUntil || null; st.homeSent = home ? `${home.v4}|${home.v6}` : null; gate.lastSync = { at: nowIso(), ok: true, ...(j.pro && typeof j.pro === 'object' ? { anywhere: j.pro.anywhere !== false } : {}) }; gateSave(); return { ok: true };
      }
      if (res.status === 409 && j.stale && attempt === 0) continue;   // casatorch.com has a newer one (this box's clock went back): once more, newer
      gate.lastSync = { at: nowIso(), ok: false, error: String(j.error || `casatorch.com answered ${res.status}`).slice(0, 160) }; gateSave();
      if (res.status >= 500 || res.status === 429) gateRetry();
      return { ok: false, error: gate.lastSync.error, status: res.status };
    }
    return { ok: false };
  };
  const p = gate.chain.then(run, run);
  gate.chain = p.catch(() => {});
  return p;
}
function gateRetry() { clearTimeout(gate.timer); gate.timer = setTimeout(() => { if (config.remote?.on && gateState().synced !== gateState().v) gateSync().catch(() => {}); }, process.env.CASATORCH_REMOTE_FAST === '1' ? 2000 : 10 * 60_000); gate.timer.unref?.(); }
/** A change to who may come in: saved, then sent to casatorch.com. */
function gateChange(fn) { const st = gateState(); fn(st); gateSave(); return gateSync(); }
function gateRevoke(ids) { const until = Date.now() + GATE_REVOKE_KEEP_MS; return gateChange((st) => { for (const d of [].concat(ids).filter(Boolean)) st.revoked.push({ d: String(d), until }); }); }
/* At start, and after an update that brought the gate: register (or catch up) once the tunnel's settings are there. */
setTimeout(() => { if (config.remote?.on && !isDemo() && (!gateActive() || gateState().synced !== gateState().v)) gateSync({ grace: true }).catch(() => {}); }, process.env.CASATORCH_REMOTE_FAST === '1' ? 500 : 8000).unref?.();
if (process.env.CASATORCH_TEST !== '1') setInterval(() => { if (config.remote?.on && !isDemo() && gateState().synced !== gateState().v) gateSync().catch(() => {}); }, 60 * 60_000).unref?.();
/* Without Pro the edge lets the address answer only from this home's internet address: when that changes (a new address
   from the provider), casatorch.com is told, at most once every 20 minutes. */
async function gateHomeWatch() {
  if (!config.remote?.on || isDemo() || !gateActive() || proStatus().pro || typeof homeIps !== 'function') return;
  const h = await homeIps().catch(() => null); if (!h || (!h.v4 && !h.v6)) return;
  if (`${h.v4 || null}|${h.v6 || null}` !== gateState().homeSent) await gateSync();
}
if (process.env.CASATORCH_TEST !== '1') setInterval(() => { gateHomeWatch().catch(() => {}); }, 20 * 60_000).unref?.();

/* ---- where a request comes from: at home, or the city and country Cloudflare saw ---- */
function gateWhere(req) {
  const remoteReq = typeof viaTunnel === 'function' && (viaTunnel(req) || (!!req.headers['cf-connecting-ip'] && String(req.headers.host || '').toLowerCase() === gateHost()));
  if (!remoteReq) return { home: true };
  const country = /^[A-Z]{2}$/.test(String(req.headers['cf-ipcountry'] || '').toUpperCase()) ? String(req.headers['cf-ipcountry']).toUpperCase() : null;
  const city = String(req.headers['cf-ipcity'] || '').replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 40) || null;
  return { home: false, country, city };
}
const gateIsRemote = (req) => gateWhere(req).home === false;
/** "Austin, United States" in the home's language; null at home. */
function gateWhereText(w, lang = config.house?.lang || 'en') {
  if (!w || w.home) return null;
  let country = w.country && !['XX', 'T1'].includes(w.country) ? w.country : null;
  try { if (country) country = new Intl.DisplayNames([lang, 'en'], { type: 'region' }).of(country) || country; } catch { /* the code then */ }
  return [w.city, country].filter(Boolean).join(', ') || (w.country === 'T1' ? 'Tor' : '?');
}
/* Box-side lock and allowed countries, for a request that came through the secure address (02-remote-gate.js).
   'locked' | 'country' | null. The one thing that gets through a lock is the owner turning it off from the paired app. */
function gateBoxRefuse(req) {
  const st = gateState();
  if (st.locked && !(req.method === 'POST' && req.path === '/api/gate/unlock')) return 'locked';
  if (st.countries?.length && !st.countries.includes(String(req.headers['cf-ipcountry'] || '').toUpperCase())) return 'country';
  return null;
}

/* ---- sign-in alerts: a new phone paired, a sign-in from a new device, any sign-in from away ---- */
const gateWhen = () => { try { return new Intl.DateTimeFormat(config.house?.lang || 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: houseTz() }).format(new Date()); } catch { return nowIso().slice(0, 16).replace('T', ' '); } };
const gateDeviceName = (req, device) => (device?.name ? `${device.name}${device.platform && device.platform !== 'phone' ? ` (${{ ios: 'iPhone', ipados: 'iPad', android: 'Android' }[device.platform] || device.platform})` : ''}` : (typeof browserLabel === 'function' ? browserLabel(req.headers['user-agent']) : 'a browser'));
function browserLabel(ua = '') {
  ua = String(ua);
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'a device';
  const br = /CasaTorchApp/.test(ua) ? 'CasaTorch app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  return `${br} on ${os}`;
}
const GATE_MSG = {
  pairedHome: 'New phone paired: {device} for {person}, at home, {when}',
  pairedAway: 'New phone paired: {device} for {person}, from {where}, {when}',
  newHome: 'New sign-in on a new device: {person} on {device}, at home, {when}',
  newAway: 'New sign-in on a new device: {person} on {device}, from {where}, {when}',
  away: 'Sign-in from away: {person} on {device}, from {where}, {when}',
};
const fillGate = (m, v) => m.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
/** An alert in the inbox and on phones (Security & sign-in), for that person and the owners. */
function gateNotice(kind, req, u, device) {
  if (!u || u.panel || isDemo()) return null;
  const w = gateWhere(req), vars = { person: u.name || u.username, device: gateDeviceName(req, device), where: gateWhereText(w), when: gateWhen() };
  const msg = GATE_MSG[kind === 'paired' ? (w.home ? 'pairedHome' : 'pairedAway') : kind === 'new' ? (w.home ? 'newHome' : 'newAway') : 'away'];
  const a = { id: `signin:${kind}:${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`, severity: 'warning', source: 'sign-in', title: fillGate(msg, vars), msg, vars,
    body: 'Not you? Open Settings › Devices & sessions and sign it out.', url: '/#settings/devices', forUser: u.id };
  if (typeof alertRaise === 'function') alertRaise(a);
  return a;
}
/** Called for every new session (08-signin.js, 68-app.js): is it a device this person hasn't used before, or from away? */
function gateSignedIn(req, res, u, { kind = 'browser', device = null } = {}) {
  if (!u || u.panel || kind === 'panel') return;
  let key = null;
  if (kind === 'app') key = sha256(`app|${device?.name || ''}|${device?.platform || ''}|${device?.model || ''}`);
  else {
    let dc = (String(req.headers.cookie || '').match(/(?:^|;\s*)casatorch_device=([A-Za-z0-9_-]{22,64})/) || [])[1];
    if (!dc && res) { dc = crypto.randomBytes(18).toString('base64url'); res.append?.('Set-Cookie', `${DEVICE_COOKIE}=${dc}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${2 * 365 * 86400}${req.secure ? '; Secure' : ''}`); }
    key = dc ? sha256(`browser|${dc}`) : null;
  }
  const seen = Array.isArray(u.seenDevices) ? u.seenDevices : [];
  const isNew = !!key && !seen.includes(key);
  if (isNew) { u.seenDevices = [...seen.filter((x) => x !== key), key].slice(-40); saveUsers(); }
  if (isNew) gateNotice('new', req, u, device);
  else if (gateIsRemote(req)) gateNotice('away', req, u, device);
}

/* ---- Settings › Devices & sessions ---- */
const isOwner = (req) => !signInOn() || req.user?.role === 'owner';
const gateView = () => {
  const st = gateState(), r = config.remote || {};
  return { on: !!r.on, hostname: r.hostname || null, active: gateActive(), probe: gate.probe, locked: !!st.locked, countries: st.countries || [], graceUntil: st.graceUntil || null,
    lastSync: gate.lastSync ? { at: gate.lastSync.at, ok: gate.lastSync.ok, ...(gate.lastSync.ok ? {} : { error: gate.lastSync.error }) } : null, epoch: st.epoch };
};
app.get('/api/access', (req, res) => {
  if (signInOn() && (!req.user || req.user.panel)) return res.status(403).json({ error: 'Sign in as a person first.' });
  const owner = isOwner(req), uid = req.user?.id;
  const list = Object.entries(sessions).filter(([, s]) => owner || s.userId === uid).map(([k, s]) => ({ id: s.id, user: s.userId, person: userById(s.userId)?.name || '?', kind: s.kind,
    name: s.device?.name || null, platform: s.device?.platform || null, agent: s.agent, created: s.created, seen: s.seen, where: s.where || null, current: k === req.session?.key }));
  const browsers = (gateState().browsers || []).filter((b) => owner || b.user === uid).map((b) => ({ id: b.id, user: b.user, person: userById(b.user)?.name || '?', name: b.name, at: b.at, seen: b.seen || null, by: b.by || null }));
  res.json({ owner, me: uid || null, gate: gateView(), sessions: list, browsers });
});
function endSession(key, s, req) {
  delete sessions[key]; saveSessions();
  if (s.kind === 'app') { push.apps = (push.apps || []).filter((x) => x.session !== s.id); savePush(); }
  audit(req, s.kind === 'app' ? 'phone-removed' : 'session-ended', { of: userById(s.userId)?.username, device: s.device?.name });
}
app.delete('/api/access/sessions/:id', (req, res) => {
  if (!req.user || req.user.panel) return res.status(403).json({ error: 'Sign in as a person first.' });
  const hit = Object.entries(sessions).find(([, s]) => s.id === req.params.id && (s.userId === req.user.id || isOwner(req)));
  if (!hit) return res.status(404).json({ error: 'That device isn\'t signed in any more.' });
  endSession(hit[0], hit[1], req);
  if (hit[1].kind === 'app') gateRevoke(hit[1].id).catch(() => {});   // its edge tickets stop working too
  res.json({ ok: true });
});
app.post('/api/access/others', (req, res) => {
  if (!req.user || req.user.panel || !req.session) return res.status(403).json({ error: 'Sign in as a person first.' });
  const gone = [];
  for (const [k, s] of Object.entries(sessions)) if (s.userId === req.user.id && k !== req.session.key) { endSession(k, s, req); if (s.kind === 'app') gone.push(s.id); }
  const mine = gateCheckOwn(gateCookieOf(req))?.d;
  const st = gateState();
  for (const b of st.browsers || []) if (b.user === req.user.id && b.id !== mine) gone.push(b.id);
  st.browsers = (st.browsers || []).filter((b) => !(b.user === req.user.id && b.id !== mine));
  if (req.session.kind === 'app') { /* this phone stays */ }
  audit(req, 'other-sessions-ended');
  if (gone.length) gateRevoke(gone).catch(() => {}); else gateSave();
  res.json({ ok: true, revoked: gone.length });
});
app.delete('/api/access/browsers/:id', (req, res) => {
  if (!req.user || req.user.panel) return res.status(403).json({ error: 'Sign in as a person first.' });
  const st = gateState(), b = (st.browsers || []).find((x) => x.id === req.params.id && (x.user === req.user.id || isOwner(req)));
  if (!b) return res.status(404).json({ error: 'That browser isn\'t approved any more.' });
  st.browsers = st.browsers.filter((x) => x !== b);
  audit(req, 'browser-approval-removed', { of: userById(b.user)?.username, device: b.name });
  gateRevoke(b.id).catch(() => {});
  res.json({ ok: true });
});

/* ---- tickets for this device ---- */
const gateCookie = (t, exp) => `${GATE_COOKIE}=${t}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(60, exp - Math.floor(Date.now() / 1000))}`;
app.post('/api/gate/ticket', (req, res) => {
  if (!req.user || req.user.panel || !req.session) return res.status(403).json({ error: 'Sign in as a person first.' });
  if (!gateActive()) return res.json({ active: false });
  if (req.session.kind === 'app') return res.json({ active: true, host: gateHost(), tickets: gateAppTickets(req.session.id) });
  // a browser: only one the owner approved, renewing its own ticket at the secure address (where the cookie lives)
  const p = gateCheckOwn(gateCookieOf(req)), st = gateState(), b = p && p.k === 'browser' ? (st.browsers || []).find((x) => x.id === p.d) : null;
  if (!b || String(req.headers.host || '').toLowerCase() !== gateHost()) return res.json({ active: true, approved: false });
  if (!b.user) b.user = req.user.id;
  b.seen = nowIso(); gateSave();
  const t = gateBrowserTicket(b.id);
  res.setHeader('Set-Cookie', gateCookie(t.t, t.exp));
  res.json({ active: true, approved: true, exp: t.exp });
});
/** A browser device the owner approved: its id, kept with who it's for and who approved it. */
function gateNewBrowser(req, { name, user }) {
  const st = gateState(), b = { id: `b${crypto.randomBytes(9).toString('base64url')}`, user: user || null, name: String(name || 'Browser').slice(0, 60), at: nowIso(), by: req.user?.name || req.user?.username || null };
  st.browsers = [...(st.browsers || []), b].slice(-50); gateSave();
  return b;
}
app.post('/api/gate/approve-here', requireRole('owner'), (req, res) => {
  if (!gateActive()) return res.status(409).json({ error: 'The edge gate isn\'t on yet - turn on Secure Remote Access first.' });
  if (overLimit(`gateapprove:${req.user?.id || 'local'}`, 20, 10 * 60_000)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
  const b = gateNewBrowser(req, { name: browserLabel(req.headers['user-agent']), user: req.user?.id });
  audit(req, 'browser-approved', { device: b.name, via: 'here' });
  res.json({ ok: true, action: `https://${gateHost()}/__ct_gate/set`, ticket: gateBrowserTicket(b.id).t });
});
/* From the paired app: the browser's page shows casatorch://approve?c=<request>&k=<hash of its secret>; the app scans it. */
app.post('/api/gate/approve', requireRole('owner'), express.json({ limit: '2kb' }), asyncRoute(async (req, res) => {
  if (!gateActive()) return res.status(409).json({ error: 'The edge gate isn\'t on yet - turn on Secure Remote Access first.' });
  if (overLimit(`gateapprove:${req.user?.id || 'local'}`, 20, 10 * 60_000)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
  const m = /^casatorch:\/\/approve\?c=([0-9a-f]{32})&k=([0-9a-f]{32})$/.exec(String(req.body?.code || '').trim());
  if (!m) return res.status(400).json({ error: 'That isn\'t a CasaTorch approval code. Scan the code on the browser\'s page.' });
  const b = gateNewBrowser(req, { name: String(req.body?.name || '').trim() || 'Browser (approved from the app)', user: null });
  const r = await gateSync({ handoff: { c: sha256(m[1]), s: m[2], t: gateBrowserTicket(b.id).t } });
  if (!r.ok) { gateState().browsers = gateState().browsers.filter((x) => x !== b); gateSave(); return res.status(502).json({ error: r.error || 'casatorch.com couldn\'t be reached. Try again.' }); }
  audit(req, 'browser-approved', { device: b.name, via: 'app' });
  res.json({ ok: true });
}));
/* ---- the owner's shields: allowed countries, Lock remote access, everyone out ---- */
app.post('/api/gate/settings', requireRole('owner'), express.json({ limit: '4kb' }), asyncRoute(async (req, res) => {
  const b = req.body || {}, st = gateState();
  if (b.countries !== undefined) {
    const list = b.countries == null ? [] : Array.isArray(b.countries) ? b.countries.map((c) => String(c).trim().toUpperCase()) : null;
    if (!list || list.length > 80 || !list.every((c) => /^[A-Z]{2}$/.test(c))) return res.status(400).json({ error: 'Pick countries from the list.' });
    st.countries = [...new Set(list)].sort();
    audit(req, 'remote-countries', { countries: st.countries.join(' ') || 'any' });
  }
  if (b.locked === true && !st.locked) { st.locked = true; audit(req, 'remote-locked'); }
  if (b.locked === false && st.locked) return res.status(400).json({ error: 'Turn the lock off with "Unlock".' });
  gateSave();
  const r = await gateSync();
  res.json({ ok: true, synced: !!r.ok, ...(r.ok || r.skipped ? {} : { warning: r.error }), gate: gateView() });
}));
/* Unlocking: at home, or from the paired app (the app asks for Face ID / the fingerprint first). Never from a browser away. */
app.post('/api/gate/unlock', requireRole('owner'), asyncRoute(async (req, res) => {
  if (gateIsRemote(req) && req.session?.kind !== 'app') return res.status(403).json({ error: 'Unlock at home, or from the CasaTorch app on your phone.' });
  const st = gateState(); st.locked = false; gateSave(); audit(req, 'remote-unlocked', { via: req.session?.kind === 'app' ? 'app' : 'home' });
  const r = await gateSync();
  res.json({ ok: true, synced: !!r.ok, ...(r.ok || r.skipped ? {} : { warning: r.error }), gate: gateView() });
}));
app.post('/api/gate/revoke-all', requireRole('owner'), asyncRoute(async (req, res) => {
  const r = await gateChange((st) => { st.epoch += 1; st.browsers = []; });
  audit(req, 'remote-access-reset');
  res.json({ ok: true, synced: !!r.ok, ...(r.ok || r.skipped ? {} : { warning: r.error }), gate: gateView() });
}));
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchGate = { gate, gateState, gateMake, gateAppTickets, gateBrowserTicket, gateSelfTicket, gateCheckOwn, gateWhere, gateWhereText, gateBoxRefuse, gateNotice, gateSignedIn, browserLabel, GATE_MSG, gateRevokedIds, gateSync, gateActive, alertForReq, alertForTarget };
