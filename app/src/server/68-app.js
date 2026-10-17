/* ======================================================================
 * The CasaTorch phone and tablet app (iPhone, iPad, Android).
 *
 * Accounts: there is no CasaTorch cloud account. You sign in to YOUR home -
 * the same people, passwords and roles as the dashboard - and the app keeps a
 * token for this home in the phone's secure storage (Keychain / Android
 * Keystore), behind Face ID / Touch ID / fingerprint. Two-step sign-in is
 * always required for the app (set up during sign-in if it isn't on yet).
 *
 * Two ways in:
 *   - Sign in on the phone: name and password, then the 6-digit code.
 *   - Pair from a screen that's already signed in: Settings › Phones & alerts ›
 *     Add a phone shows a QR code (one use, 10 minutes). The phone scans it.
 *
 * Alerts: the app makes a fresh 256-bit key for this home, registers its push
 * token and that key here, and every alert is encrypted on this CasaTorch
 * (AES-256-GCM) before it leaves. casatorch.com passes the sealed message to
 * Apple / Google (Firebase) to wake the phone; only the phone can read it.
 * casatorch.com never sees what an alert says, and keeps nothing.
 * The relay only accepts messages signed by this CasaTorch's own key.
 * ====================================================================== */
const RELAY_URL = process.env.CASATORCH_PUSH_RELAY || 'https://casatorch.com/api/push/send';
/* CORS for the app's built-in screens (sign-in, pairing): only those two origins, only these paths, never with cookies. */
app.use('/api/app', (req, res, next) => {
  const o = req.headers.origin;
  if (o && APP_ORIGINS.has(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE'); res.setHeader('Access-Control-Max-Age', '600'); }
  if (req.method === 'OPTIONS') return res.status(o && APP_ORIGINS.has(o) ? 204 : 403).end();
  next();
});
/* The addresses this home can be reached at, for the app to keep: the secure one at home, the one from anywhere, the plain one. */
function appAddresses(req) {
  const lan = typeof lanAddress === 'function' ? lanAddress() : null, port = process.env.PORT || 8090;
  return { lan: LOCAL_TLS?.url || null, remote: config.remote?.hostname ? `https://${config.remote.hostname}` : null, plain: lan ? `http://${lan}:${port}` : null, here: `${req.protocol}://${req.headers.host}` };
}
const appHome = (req) => ({ id: installId(), name: config.house?.name || 'Home', version: VERSION, addresses: appAddresses(req), pro: !!proStatus().pro });
const cleanDevice = (d) => ({ name: String(d?.name || 'Phone').replace(/[^\p{L}\p{N} '’._-]/gu, '').trim().slice(0, 40) || 'Phone', platform: ['ios', 'ipados', 'android'].includes(d?.platform) ? d.platform : 'phone', model: String(d?.model || '').slice(0, 40), app: String(d?.app || '').slice(0, 16) });
/* Who's asking, before any sign-in: so the app can show the home's name and check it's a CasaTorch. */
app.get('/api/app/hello', (req, res) => res.json({ casatorch: true, home: { name: config.house?.name || 'Home', version: VERSION }, signIn: signInOn(), configured: isConfigured(), demo: isDemo(), secure: LOCAL_TLS?.url || null, remote: config.remote?.hostname ? `https://${config.remote.hostname}` : null }));   // where to sign in encrypted
app.post('/api/app/hello', (req, res) => res.json({ casatorch: true }));

/* ---- signing in on the phone ---- */
function appProceed(req, res, t) {
  const u = userById(t.userId); if (!u) return res.status(401).json({ error: 'Sign in again.' });
  const step = nextStep(t, u);
  if (step) return res.json({ step, ticket: t.id, name: u.name, terms: TERMS_VERSION, ...(t.recovery && step !== 'enroll' ? { recovery: t.recovery } : {}) });
  tickets.delete(t.id);
  const { tok } = issueSession(req, u, { kind: 'app', mfa: true, device: t.device });
  audit(req, 'signed-in', { user: u.username, via: 'app', device: t.device?.name });
  res.json({ ok: true, token: tok, user: safeUser(u), home: appHome(req), ...(t.recovery ? { recovery: t.recovery } : {}) });
}
app.post('/api/app/login', express.json({ limit: '4kb' }), (req, res) => {
  if (!signInOn()) return res.status(409).json({ error: isDemo() ? 'This is the demo - it has no accounts. Pair with a real CasaTorch.' : 'Set up sign-in on this CasaTorch first (it is set up during setup).' });
  const { username, password } = req.body || {}, ip = clientIp(req), name = String(username || '').trim().toLowerCase();
  if (limited(`ip:${ip}`, 30) || limited(`u:${name}|${ip}`, 5)) { audit(req, 'login-limited', { user: name, via: 'app' }); return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' }); }
  const u = findLogin(name), ok = verifySecret(u?.password || DUMMY_HASH, String(password || ''));
  if (!u || !ok || u.invite || u.panel) { failed(`ip:${ip}`, `u:${name}|${ip}`); audit(req, 'login-failed', { user: name, via: 'app' }); return res.status(401).json({ error: 'Wrong name or password.' }); }
  appProceed(req, res, newTicket(u, { app: true, via: 'app', device: cleanDevice(req.body?.device) }));
});
app.post('/api/app/mfa', express.json({ limit: '4kb' }), (req, res) => {
  const t = ticketOf(req.body?.ticket); if (!t?.app) return res.status(401).json({ error: 'That took too long - sign in again.' });
  const u = userById(t.userId), ip = clientIp(req); if (!u) return res.status(401).json({ error: 'Sign in again.' });
  if (limited(`mfa:${u.id}`, 6) || limited(`ip:${ip}`, 30)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const how = secondFactorOk(u, req.body?.code);
  if (!how) { failed(`mfa:${u.id}`, `ip:${ip}`); audit(req, 'code-failed', { user: u.username, via: 'app' }); return res.status(401).json({ error: 'That code isn\'t right.' }); }
  if (how === 'recovery') audit(req, 'recovery-code-used', { user: u.username, left: u.totp.recovery.length });
  t.passed.add('mfa'); appProceed(req, res, t);
});
/* No two-step sign-in yet: set it up right here (an authenticator app on this or another device). */
app.post('/api/app/enroll', express.json({ limit: '4kb' }), async (req, res) => {
  const t = ticketOf(req.body?.ticket); if (!t?.app) return res.status(401).json({ error: 'That took too long - sign in again.' });
  const u = userById(t.userId); if (!u || nextStep(t, u) !== 'enroll') return res.status(400).json({ error: 'Sign in again.' });
  if (!req.body?.code) { const e = await totpEnrolment(u); t.pending = e.secret; return res.json({ uri: e.uri, qr: e.qr, secret: e.secret }); }
  if (!t.pending || !totpOk(t.pending, req.body.code)) return res.status(400).json({ error: 'That code isn\'t right - check the time on your phone and try again.' });
  const codes = recoveryCodes();
  u.totp = { on: true, secret: seal(t.pending), recovery: codes.map(rcHash), since: nowIso(), lastStep: Math.floor(Date.now() / 30000) };
  saveUsers(); audit(req, '2fa-on', { user: u.username, via: 'app' }); t.passed.add('enroll'); t.recovery = codes;
  appProceed(req, res, t);
});
app.post('/api/app/terms', express.json({ limit: '2kb' }), (req, res) => {
  const t = ticketOf(req.body?.ticket); if (!t?.app) return res.status(401).json({ error: 'Sign in again.' });
  const u = userById(t.userId); if (!u) return res.status(401).json({ error: 'Sign in again.' });
  if (req.body?.accept !== true) return res.status(400).json({ error: 'Please accept the terms to continue.' });
  u.terms = { version: TERMS_VERSION, at: nowIso() }; saveUsers(); t.passed.add('terms'); appProceed(req, res, t);
});

/* ---- pairing with a QR code from a screen that's already signed in ---- */
const pairCodes = new Map();
setInterval(() => { for (const [k, v] of pairCodes) if (v.exp < Date.now()) pairCodes.delete(k); }, 60_000).unref?.();
app.post('/api/app/pair', async (req, res) => {
  if (isDemo()) return res.status(409).json({ error: 'The demo has no accounts - pair your phone with a real CasaTorch.' });
  const u = req.user; if (!u || u.panel) return res.status(403).json({ error: 'Sign in as a person first.' });
  if (!u.totp?.on) return res.status(409).json({ error: 'Turn on two-step sign-in for your account first (Settings › People & sign-in) - the app needs it.', need2fa: true });
  if (!req.session?.mfa) return res.status(409).json({ error: 'Sign out and in again with your two-step code, then add the phone.', needMfa: true });
  if ([...pairCodes.values()].filter((p) => p.userId === u.id).length >= 3) return res.status(429).json({ error: 'Too many open pairing codes - use one or wait 10 minutes.' });
  const raw = Array.from({ length: 10 }, () => CODE_ABC[crypto.randomInt(CODE_ABC.length)]).join('');
  pairCodes.set(raw, { userId: u.id, exp: Date.now() + 10 * 60_000 });
  const a = appAddresses(req), q = new URLSearchParams({ v: '1', n: config.house?.name || 'Home', c: raw, ...(a.lan ? { l: a.lan } : {}), ...(a.remote ? { r: a.remote } : {}), ...(a.plain ? { p: a.plain } : {}), h: a.here });
  const link = `casatorch://pair?${q}`;
  res.json({ code: `${raw.slice(0, 5)}-${raw.slice(5)}`, link, expires: new Date(Date.now() + 10 * 60_000).toISOString(), qr: await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
});
app.post('/api/app/claim', express.json({ limit: '4kb' }), (req, res) => {
  const ip = clientIp(req), code = cleanCode(req.body?.code);
  if (limited(`pair:${ip}`, 10) || limited('pair:all', 60)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const p = pairCodes.get(code);
  if (!p || p.exp < Date.now()) { failed(`pair:${ip}`, 'pair:all'); return res.status(401).json({ error: 'That code didn\'t work - it may have run out. Make a new one in Settings › Phones & alerts.' }); }
  pairCodes.delete(code);
  const u = userById(p.userId); if (!u) return res.status(401).json({ error: 'That account was removed.' });
  const device = cleanDevice(req.body?.device);
  const { tok } = issueSession(req, u, { kind: 'app', mfa: true, device });
  audit(req, 'phone-paired', { user: u.username, device: device.name });
  res.json({ ok: true, token: tok, user: safeUser(u), home: appHome(req) });
});

/* ---- the app, signed in ---- */
const appSession = (req, res) => { if (!req.user || req.session?.kind !== 'app') { res.status(403).json({ error: 'Only the CasaTorch app uses this.' }); return null; } return req.session; };
app.get('/api/app/me', (req, res) => {
  const s = appSession(req, res); if (!s) return;
  const pd = (push.apps || []).find((x) => x.session === s.id);
  res.json({ user: safeUser(req.user), home: appHome(req), device: s.device || null, push: pd ? { on: true, level: pd.level, lastOk: pd.lastOk || null, broken: !!pd.lastError && !pd.lastOk } : { on: false }, relay: !!RELAY_URL });
});
/* The phone's alerts: its push token, which service (Apple through Firebase, or Google), and its own key for this home. */
app.post('/api/app/push', express.json({ limit: '4kb' }), (req, res) => {
  const s = appSession(req, res); if (!s) return;
  const b = req.body || {}, key = Buffer.from(String(b.key || ''), 'base64');
  if (!['ios', 'android'].includes(b.platform) || !/^[\w:.-]{20,4096}$/.test(String(b.token || '')) || key.length !== 32) return res.status(400).json({ error: 'That isn\'t a phone this can send to.' });
  push.apps = (push.apps || []).filter((x) => x.session !== s.id && x.token !== b.token);
  if (push.apps.filter((x) => x.user === req.user.id).length >= 10) return res.status(400).json({ error: 'You already have 10 phones with alerts on - turn one off first.' });
  push.apps.push({ id: crypto.randomBytes(6).toString('hex'), session: s.id, user: req.user.id, platform: b.platform, token: String(b.token), key: seal(key.toString('base64')), level: Object.hasOwn(LEVELS, String(b.level)) ? b.level : 'important', name: s.device?.name || 'Phone', at: nowIso() });
  savePush(); res.json({ ok: true });
});
app.put('/api/app/push', express.json({ limit: '2kb' }), (req, res) => {
  const s = appSession(req, res); if (!s) return;
  const pd = (push.apps || []).find((x) => x.session === s.id); if (!pd) return res.status(404).json({ error: 'Alerts aren\'t on for this phone.' });
  if (Object.hasOwn(LEVELS, String(req.body?.level))) pd.level = req.body.level;
  // the phone's push address changed (Apple and Google rotate them now and then): the app sends the new one
  if (req.body?.token !== undefined) { if (!/^[\w:.-]{20,4096}$/.test(String(req.body.token))) return res.status(400).json({ error: 'That isn\'t a phone this can send to.' }); pd.token = String(req.body.token); delete pd.lastError; }
  savePush(); res.json({ ok: true });
});
app.delete('/api/app/push', (req, res) => { const s = appSession(req, res); if (!s) return; push.apps = (push.apps || []).filter((x) => x.session !== s.id); savePush(); res.json({ ok: true }); });
app.post('/api/app/push/test', async (req, res) => {
  const s = appSession(req, res); if (!s) return;
  const pd = (push.apps || []).find((x) => x.session === s.id); if (!pd) return res.status(404).json({ error: 'Turn on alerts first.' });
  const r = await appPushSend([pd], { title: 'CasaTorch', body: 'Alerts work on this phone.', tag: 'test', url: '/#alerts', sev: 'info' });
  r.ok ? res.json({ ok: true }) : res.status(502).json({ error: r.error || 'The alert couldn\'t be sent.' });
});
/* Signing this phone out: its session and its alerts go. */
app.post('/api/app/signout', (req, res) => {
  const s = appSession(req, res); if (!s) return;
  delete sessions[s.key]; saveSessions(); push.apps = (push.apps || []).filter((x) => x.session !== s.id); savePush();
  audit(req, 'signed-out', { user: req.user.username, via: 'app' }); res.json({ ok: true });
});
/* A session that ends (signed out elsewhere, removed) takes its phone's alerts with it, on the next send. */

/* ---- sending: encrypted here, signed, handed to the relay ---- */
function relayKey() {
  if (!push.relay) { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); push.relay = { pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'), priv: seal(privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')) }; savePush(); }
  return { pub: push.relay.pub, priv: crypto.createPrivateKey({ key: Buffer.from(unseal(push.relay.priv), 'base64'), format: 'der', type: 'pkcs8' }) };
}
function sealFor(pd, msg) {
  const key = Buffer.from(unseal(pd.key), 'base64'), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify({ ...msg, home: config.house?.name || 'Home', hid: installId() })), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('base64'), d: body.toString('base64') };
}
async function appPushSend(list, msg) {
  if (!list.length) return { ok: true };
  const live = new Set(Object.values(sessions).map((s) => s.id));
  const keep = list.filter((pd) => live.has(pd.session));
  if (keep.length !== list.length) { const gone = new Set(list.filter((pd) => !live.has(pd.session)).map((pd) => pd.id)); push.apps = push.apps.filter((x) => !gone.has(x.id)); savePush(); }
  if (!keep.length) return { ok: false, error: 'This phone is signed out.' };
  const k = relayKey();
  const body = JSON.stringify({ home: installId(), pub: k.pub, ts: Date.now(), msgs: keep.map((pd) => ({ p: pd.platform, t: pd.token, ...sealFor(pd, msg), crit: msg.sev === 'critical', tag: String(msg.tag || '').slice(0, 64) })) });
  const sig = crypto.sign(null, Buffer.from(body), k.priv).toString('base64');
  try {
    const r = await fetch(RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CT-Sig': sig }, body, signal: AbortSignal.timeout(15_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { for (const pd of keep) pd.lastError = `relay ${r.status}`; savePush(); return { ok: false, error: j.error || `casatorch.com answered ${r.status}` }; }
    const dead = new Set((j.unregistered || []).map(String));
    for (const pd of keep) { if (dead.has(pd.token)) continue; pd.lastOk = nowIso(); delete pd.lastError; }
    if (dead.size) push.apps = push.apps.filter((x) => !dead.has(x.token));
    savePush(); return { ok: true };
  } catch (e) { for (const pd of keep) pd.lastError = String(e.message || e).slice(0, 80); savePush(); return { ok: false, error: 'casatorch.com couldn\'t be reached to wake the phone.' }; }
}
async function appPushAll(msg) {
  const list = (push.apps || []).filter((pd) => (Object.hasOwn(LEVELS, pd.level) ? LEVELS[pd.level] : LEVELS.important).includes(msg.sev));
  if (list.length && !isDemo()) await appPushSend(list, msg);
}
