/* ======================================================================
 * Accounts and sign-in.
 *
 *  - People live in data/users.json (owner-only file). Passwords: scrypt.
 *    Roles: owner > admin (settings) > member (can switch things) > viewer
 *    (can only look). Nobody signs themselves up: the owner adds people and
 *    sends them an invite link; "Sign in with Google" only works for people
 *    the owner added (matched by a verified e-mail) - Google never creates
 *    an account.
 *  - Two-step sign-in: TOTP (RFC 6238, any authenticator app) with ten
 *    one-time recovery codes. The owner can require it for everyone.
 *    Authenticator secrets are encrypted at rest (AES-256-GCM; the key is
 *    data/secret.key, kept apart so a copied users.json alone is useless).
 *  - Sessions: random 256-bit tokens in an HttpOnly SameSite=Lax cookie.
 *    Only a SHA-256 of each token is stored. Signed out after 30 days without
 *    use (wall panels: 1 year). Everyone can see and end their sessions.
 *  - Brute force: 5 tries per account and screen in 15 minutes, 30 per screen;
 *    the answer never says whether the account exists. Codes can't be reused.
 *  - Anything that changes something must come from this site (Origin check),
 *    on top of SameSite cookies.
 *  - Audit log: data/audit.log - sign-ins, failures and every account or
 *    security change, readable by admins in Settings > Security.
 * ====================================================================== */
const USERS_FILE = path.join(DATA_DIR, 'users.json'), SESS_FILE = path.join(DATA_DIR, 'sessions.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const TERMS_VERSION = '2026-10-15';
const ROLES = ['viewer', 'member', 'admin', 'owner'], rank = (r) => ROLES.indexOf(r);
const IDLE_DAYS = 30, PANEL_DAYS = 365, APP_DAYS = 120;   // the CasaTorch app: signed in for 120 days of not being used (Face ID guards it on the phone)
const idleDays = (kind) => (kind === 'panel' ? PANEL_DAYS : kind === 'app' ? APP_DAYS : IDLE_DAYS);
const writeSecretJson = (file, obj) => writeFileSafe(file, JSON.stringify(obj, null, 2), 0o600);
const readJsonFile = (file, dflt) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; } };
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newId = () => crypto.randomBytes(9).toString('base64url');
const clientIp = (req) => {
  const sock = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  // Secure access (42-remote.js) arrives from cloudflared on this box: the visitor's address is in CF-Connecting-IP.
  if (/^(127\.|::1$)/.test(sock) && config.remote?.hostname && String(req.headers.host || '').toLowerCase().startsWith(String(config.remote.hostname).toLowerCase())) return String(req.headers['cf-connecting-ip'] || sock).slice(0, 64);
  return sock;
};

function verifySecret(stored, given) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(given), Buffer.from(salt, 'hex'), 32), want = Buffer.from(hash, 'hex');   // scrypt N=16384, r=8, p=1
  return want.length === got.length && crypto.timingSafeEqual(got, want);   // a damaged hash is a wrong password, not a crash
}
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(32)}`;

/* ---- the audit log: one JSON line per event, trimmed to the last 5,000 ---- */
function audit(req, event, detail = {}) {
  const line = JSON.stringify({ at: nowIso(), event, user: req?.user?.username || detail.user || null, ip: req ? clientIp(req) : null, ...detail });
  try {
    fs.appendFileSync(AUDIT_FILE, `${line}\n`, { mode: 0o600 });
    if (fs.statSync(AUDIT_FILE).size > 2_000_000) { const keep = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').slice(-5000); fs.writeFileSync(AUDIT_FILE, `${keep.join('\n')}\n`, { mode: 0o600 }); }
  } catch { /* never let logging break sign-in */ }
}

/* ---- people ---- */
let users = readJsonFile(USERS_FILE, null);
const saveUsers = () => { if (!isDemo()) writeSecretJson(USERS_FILE, users); };
function ensureUsers() {
  if (Array.isArray(users?.list)) return;
  users = { list: [], policy: { require2fa: false }, google: null, panels: [] };
  // Before accounts existed there was one login in config.json: it becomes the owner.
  if (config.signIn?.username && config.signIn?.password) {
    users.list.push({ id: newId(), username: String(config.signIn.username).toLowerCase(), name: config.signIn.username, email: null, role: 'owner', password: config.signIn.password, createdAt: nowIso(), terms: null });
  }
  if (isConfigured() && !isDemo()) saveUsers();
}
ensureUsers();
const userById = (id) => {
  if (String(id).startsWith('panel:')) { const p = users.panels?.find((x) => `panel:${x.id}` === id); return p ? { id, username: `panel:${p.name}`, name: p.name, role: p.role, panel: true } : null; }
  return users.list.find((u) => u.id === id) || null;
};
const findLogin = (name) => { const n = String(name || '').trim().toLowerCase(); return users.list.find((u) => u.username === n || (u.email && u.email.toLowerCase() === n)) || null; };
const safeUser = (u) => u && ({ id: u.id, username: u.username, name: u.name, email: u.email || null, role: u.role, twoStep: !!u.totp?.on, google: !!u.google?.sub, invited: !!u.invite, createdAt: u.createdAt, lastLogin: u.lastLogin || null, panel: !!u.panel });
const needsTerms = (u) => !u.panel && u.terms?.version !== TERMS_VERSION;
const signInOn = () => isConfigured() && !isDemo() && config.signIn?.enabled !== false && users.list.some((u) => u.password);
/** Called by setup: create or update the owner account. */
/* A second login made in setup (for the owner's phone): an admin, not the owner. */
function authAddUser({ username, passwordHash, name, role = 'admin', acceptedTerms }) {
  ensureUsers();
  const u = String(username).trim().toLowerCase();
  if (users.list.some((x) => x.username === u)) { const x = users.list.find((y) => y.username === u); if (x.role !== 'owner') { x.password = passwordHash; saveUsers(); } return x; }
  const rec = { id: newId(), role: ['admin', 'member'].includes(role) ? role : 'admin', username: u, name: name || username, password: passwordHash, createdAt: nowIso(), email: null, terms: acceptedTerms ? { version: TERMS_VERSION, at: nowIso() } : null };
  users.list.push(rec); saveUsers(); audit(null, 'user-added', { user: u, via: 'setup' });
  return rec;
}
function authSetOwner({ username, passwordHash, acceptedTerms }) {
  ensureUsers();
  const u = String(username).trim().toLowerCase();
  let owner = users.list.find((x) => x.role === 'owner');
  if (!owner) { owner = { id: newId(), role: 'owner', createdAt: nowIso(), email: null, terms: null }; users.list.unshift(owner); }
  Object.assign(owner, { username: u, name: owner.name || username, password: passwordHash || owner.password });
  if (acceptedTerms) owner.terms = { version: TERMS_VERSION, at: nowIso() };
  saveUsers(); audit(null, 'owner-saved', { user: u });
}

/* ---- sessions (only hashes of the tokens are stored) ---- */
let sessions = readJsonFile(SESS_FILE, {});
if (Object.values(sessions).some((s) => !s.userId)) sessions = {};   // the old single-login sessions: sign in again once
let sessDirty = false;
const saveSessions = () => { try { writeSecretJson(SESS_FILE, sessions); sessDirty = false; } catch { /* next time */ } };
setInterval(() => { if (sessDirty) saveSessions(); }, 60_000).unref?.();
process.on('exit', () => { if (sessDirty) saveSessions(); });   // a restart keeps the last minute of "last seen" too
const cookieOf = (req) => (String(req.headers.cookie || '').match(/(?:^|;\s*)casatorch_session=([A-Za-z0-9_-]{20,})/) || [])[1];
const cookieFlags = (req) => `Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`;
/* The phone app may also send its token as "Authorization: Bearer" (only app sessions are accepted that way). */
const bearerOf = (req) => (String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{20,200})$/) || [])[1];
function sessionOf(req) {
  const bt = bearerOf(req), tok = cookieOf(req) || bt; if (!tok) return null;
  const key = sha256(tok), s = sessions[key];
  if (!s || (!cookieOf(req) && s.kind !== 'app')) return null;
  const idle = idleDays(s.kind) * 86400_000;
  if (Date.now() - Date.parse(s.seen) > idle || Date.parse(s.expires) < Date.now()) { delete sessions[key]; sessDirty = true; return null; }
  if (Date.now() - Date.parse(s.seen) > 5 * 60_000) { s.seen = nowIso(); s.ip = clientIp(req); sessDirty = true; }
  return { key, ...s };
}
/** A new session; returns its token (only its hash is kept). */
function issueSession(req, u, { remember = false, kind = 'browser', mfa = false, device = null } = {}) {
  const tok = crypto.randomBytes(32).toString('base64url'), days = kind === 'panel' ? PANEL_DAYS : kind === 'app' ? 400 : remember ? 365 : IDLE_DAYS;
  for (const [k, v] of Object.entries(sessions)) if (Date.parse(v.expires) < Date.now() || Date.now() - Date.parse(v.seen) > idleDays(v.kind) * 86400_000) delete sessions[k];   // expired or unused too long
  sessions[sha256(tok)] = { id: newId(), userId: u.id, kind, mfa, created: nowIso(), seen: nowIso(), expires: new Date(Date.now() + days * 86400_000).toISOString(), ip: clientIp(req), agent: String(device?.name ? `${device.name} (CasaTorch app, ${device.platform || 'phone'})` : req.headers['user-agent'] || '').slice(0, 160), ...(device ? { device } : {}) };
  saveSessions();
  if (!u.panel) { u.lastLogin = nowIso(); saveUsers(); }
  return { tok, days };
}
function startSession(req, res, u, opts = {}) {
  const { tok, days } = issueSession(req, u, opts);
  res.setHeader('Set-Cookie', `casatorch_session=${tok}; ${cookieFlags(req)}; Max-Age=${days * 86400}`);
}
const endSessionsOf = (userId, exceptKey) => { for (const [k, v] of Object.entries(sessions)) if (v.userId === userId && k !== exceptKey) delete sessions[k]; saveSessions(); };

/* ---- brute-force limits ---- */
const tries = new Map();
function limited(key, max, windowMs = 15 * 60_000) { const now = Date.now(), list = (tries.get(key) || []).filter((t) => now - t < windowMs); if (list.length) tries.set(key, list); else tries.delete(key); return list.length >= max; }   // only keys with recent failures are kept
const failed = (...keys) => { for (const k of keys) tries.set(k, [...(tries.get(k) || []), Date.now()]); };
setInterval(() => { const now = Date.now(); for (const [k, v] of tries) if (!v.some((t) => now - t < 15 * 60_000)) tries.delete(k); }, 10 * 60_000).unref?.();

/* ---- TOTP (RFC 6238: SHA-1, 6 digits, 30 s) ---- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32enc = (buf) => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const b32dec = (s) => { let bits = ''; for (const ch of String(s).replace(/[\s=]/g, '').toUpperCase()) { const v = B32.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
function totpAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32dec(secret)).update(msg).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
/** A code from the app, accepted once, one step either side for clock drift. */
function totpOk(secret, code, lastStep = 0) {
  const c = String(code || '').replace(/\D/g, ''); if (c.length !== 6) return 0;
  const now = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) { const step = now + d; if (step <= lastStep) continue; if (crypto.timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(c))) return step; }
  return 0;
}
const recoveryCodes = () => Array.from({ length: 10 }, () => { const r = crypto.randomBytes(5).toString('hex'); return `${r.slice(0, 5)}-${r.slice(5)}`; });
/* Recovery codes are stored with a slow, salted hash, so a stolen users.json can't be turned back into codes. */
const rcHash = (code) => { const salt = crypto.randomBytes(12).toString('base64url'); return `rc1$${salt}$${crypto.scryptSync(String(code), salt, 32, { N: 16384 }).toString('base64url')}`; };
const rcMatch = (stored, code) => {
  if (!String(stored).startsWith('rc1$')) return stored === sha256(code);   // codes made before 0.4.3
  const [, salt, h] = String(stored).split('$');
  const a = crypto.scryptSync(String(code), salt, 32, { N: 16384 }), b = Buffer.from(h, 'base64url');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
async function totpEnrolment(u) {
  const secret = b32enc(crypto.randomBytes(20)), label = encodeURIComponent(`CasaTorch (${config.house?.name || 'home'}):${u.username}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=CasaTorch&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri, qr: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
}
/* A second step for a signed-in user: their authenticator code or one recovery code (used up). */
function secondFactorOk(u, code) {
  if (!u.totp?.on) return false;
  const c = String(code || '').trim().toLowerCase();
  if (/^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)) {
    const i = (u.totp.recovery || []).findIndex((h) => rcMatch(h, c)); if (i < 0) return false;
    u.totp.recovery.splice(i, 1); saveUsers(); return 'recovery';
  }
  const step = totpOk(unseal(u.totp.secret), c, u.totp.lastStep || 0); if (!step) return false;
  u.totp.lastStep = step; saveUsers(); return 'totp';
}

/* ---- sign-in tickets: password OK, now the next step (code, set up 2FA, accept terms) ---- */
const tickets = new Map();
const newTicket = (u, extra = {}) => { const t = { id: crypto.randomBytes(24).toString('base64url'), userId: u.id, passed: new Set(), exp: Date.now() + 10 * 60_000, ...extra }; tickets.set(t.id, t); return t; };
const ticketOf = (id) => { const t = tickets.get(String(id || '')); if (!t || t.exp < Date.now()) { tickets.delete(String(id || '')); return null; } return t; };
setInterval(() => { for (const [k, t] of tickets) if (t.exp < Date.now()) tickets.delete(k); }, 60_000).unref?.();
function nextStep(t, u) {
  if (u.totp?.on && !t.passed.has('mfa') && !t.passed.has('enroll')) return 'mfa';   // a code just used to set it up counts
  // the phone app offers two-step sign-in (strongly encouraged); only a household that requires it makes it a must
  if (!u.totp?.on && (users.policy?.require2fa || (t.app && !t.passed.has('skip2fa')))) return 'enroll';
  if (needsTerms(u) && !t.passed.has('terms')) return 'terms';
  return null;
}
function proceed(req, res, t, { redirect = false } = {}) {
  const u = userById(t.userId); if (!u) return res.status(401).json({ error: 'Sign in again.' });
  const step = nextStep(t, u);
  if (step) return redirect ? res.redirect(`/login.html?ticket=${t.id}&step=${step}`) : res.json({ step, ticket: t.id, name: u.name, terms: TERMS_VERSION });
  tickets.delete(t.id);
  startSession(req, res, u, { remember: t.remember, mfa: t.passed.has('mfa') || t.passed.has('enroll') });
  audit(req, 'signed-in', { user: u.username, via: t.via || 'password', twoStep: u.totp?.on ? true : false });
  return redirect ? res.redirect(t.next || '/') : res.json({ ok: true });
}

/* ---- gate: who may load what ---- */
const OPEN = [/^\/api\/app\/(login|mfa|enroll|terms|claim|hello)$/, /^\/login\.(html|css|js)$/, /^\/(manifest\.webmanifest|sw\.js|apple-touch-icon\.png)$/, /^\/(terms|privacy)\.html$/, /^\/legal\.css$/, /^\/api\/auth\/(login|mfa|enroll|terms|state|invite|panel|google\/start|google\/callback)$/, /^\/api\/health$/, /^\/api\/lang$/, /^\/go-secure\.(html|js)$/, /^\/i18n(\.js|\/[a-z]{2}\.json)$/, /^\/icons\//, /^\/favicon/, /^\/setup\.css$/];
const SETUP_PATHS = [/^\/setup\.(html|js)$/, /^\/setup-ha-done\.(html|js)$/, /^\/api\/setup\//];
/* Changes must come from this site: a page elsewhere can't make your browser switch your lights. */
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (fromApp(req)) return next();   // the phone app (01-security.js)
  const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return res.status(403).json({ error: 'refused: that request did not come from CasaTorch' });
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'refused: that request did not come from CasaTorch' }); } catch { return res.status(403).json({ error: 'refused' }); } }
  next();
});
/* Before setup, only setup itself may change anything. Without this, a settings change from any device on the
   network could make CasaTorch look set up - skipping the setup wizard and leaving it with no sign-in. */
/* (Before setup, only setup may change anything: see 01-security.js.) */
app.use((req, res, next) => {
  if (!signInOn()) return next();
  const s = sessionOf(req), u = s && userById(s.userId);
  if (u && !(users.policy?.require2fa && !u.panel && !u.totp?.on)) { req.user = u; req.session = s; }
  if (OPEN.some((r) => r.test(req.path)) || (req.method === 'OPTIONS' && req.path.startsWith('/api/app/'))) return next();   // (the app's CORS checks, answered in 68-app.js)
  if (SETUP_PATHS.some((r) => r.test(req.path))) { if (!isConfigured() || (req.user && rank(req.user.role) >= rank('admin'))) return next(); }
  else if (req.user) {
    if (needsTerms(req.user) && !/^\/api\/auth\//.test(req.path)) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Please accept the updated terms first.', terms: true });
      return res.redirect('/login.html?step=terms');
    }
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'sign in first' });
  res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
});
/* Roles: viewers look, members switch things, admins change settings. */
const ADMIN_WRITES = [/^\/api\/settings/, /^\/api\/license/, /^\/api\/ui$/, /^\/api\/floorplan\/(?!live)/, /^\/api\/users/, /^\/api\/ai/, /^\/api\/setup\//, /^\/api\/auth\/admin\//, /^\/api\/layout/];
app.use((req, res, next) => {
  if (!req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^\/api\/auth\/(?!admin\/)/.test(req.path.toLowerCase()) || /^\/api\/app\/(push|signout)\b/.test(req.path.toLowerCase())) return next();   // your own phone's alerts and sign-out, whatever your role
  const p = req.path.toLowerCase().replace(/\/+$/, '') || '/';   // Express matches /API/x and /api/x/ too - so must we
  const needs = ADMIN_WRITES.some((re) => re.test(p)) ? 'admin' : 'member';
  if (rank(req.user.role) < rank(needs)) return res.status(403).json({ error: needs === 'admin' ? 'Only an admin can change that.' : 'Your account can look, but not switch things.' });
  next();
});
const requireRole = (role) => (req, res, next) => (!signInOn() || (req.user && rank(req.user.role) >= rank(role)) ? next() : res.status(403).json({ error: 'Only an admin can do that.' }));
const me = (req, res) => { if (!req.user || req.user.panel) { res.status(403).json({ error: 'sign in as a person first' }); return null; } return req.user; };

/* ---- signing in ---- */
app.get('/api/auth/state', (req, res) => res.json({ signIn: signInOn(), google: !!users.google?.clientId, terms: TERMS_VERSION, house: config.house?.name || null }));
app.post('/api/auth/login', express.json({ limit: '4kb' }), (req, res) => {
  const { username, password, remember, next } = req.body || {}, ip = clientIp(req), name = String(username || '').trim().toLowerCase();
  if (limited(`ip:${ip}`, 30) || limited(`u:${name}|${ip}`, 5)) { audit(req, 'login-limited', { user: name }); return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' }); }
  const u = findLogin(name);
  const ok = verifySecret(u?.password || DUMMY_HASH, String(password || ''));   // same work whether or not the account exists
  if (!u || !ok || u.invite) { failed(`ip:${ip}`, `u:${name}|${ip}`); audit(req, 'login-failed', { user: name }); return res.status(401).json({ error: 'Wrong username or password.' }); }
  proceed(req, res, newTicket(u, { remember: !!remember, via: 'password', next: typeof next === 'string' && /^\/(?![\/\\])[^\\]*$/.test(next) ? next : '/' }));
});
app.post('/api/auth/mfa', express.json({ limit: '4kb' }), (req, res) => {
  const t = ticketOf(req.body?.ticket); if (!t) return res.status(401).json({ error: 'That took too long - sign in again.' });
  const u = userById(t.userId), ip = clientIp(req);
  if (!u) { tickets.delete(t.id); return res.status(401).json({ error: 'Sign in again.' }); }   // removed while signing in
  if (limited(`mfa:${u.id}`, 6) || limited(`ip:${ip}`, 30)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const how = secondFactorOk(u, req.body?.code);
  if (!how) { failed(`mfa:${u.id}`, `ip:${ip}`); audit(req, 'code-failed', { user: u.username }); return res.status(401).json({ error: 'That code is not right.' }); }
  if (how === 'recovery') audit(req, 'recovery-code-used', { user: u.username, left: u.totp.recovery.length });
  t.passed.add('mfa'); proceed(req, res, t);
});
/* Two-step sign-in is required here and this person has not set it up yet: do it now. */
app.post('/api/auth/enroll', express.json({ limit: '4kb' }), async (req, res) => {
  const t = ticketOf(req.body?.ticket); if (!t) return res.status(401).json({ error: 'That took too long - sign in again.' });
  const u = userById(t.userId);
  if (!u || nextStep(t, u) !== 'enroll') return res.status(400).json({ error: 'Sign in again.' });   // never a way around a code you already have
  if (!req.body?.code) { const e = await totpEnrolment(u); t.pending = e.secret; return res.json({ uri: e.uri, qr: e.qr, secret: e.secret }); }
  if (!t.pending || !totpOk(t.pending, req.body.code)) return res.status(400).json({ error: 'That code is not right - check the time on your phone and try again.' });
  const codes = recoveryCodes();
  u.totp = { on: true, secret: seal(t.pending), recovery: codes.map(rcHash), since: nowIso(), lastStep: Math.floor(Date.now() / 30000) };
  saveUsers(); audit(req, '2fa-on', { user: u.username }); t.passed.add('enroll'); t.recovery = codes;
  const step = nextStep(t, u);
  if (step) return res.json({ step, ticket: t.id, recovery: codes, terms: TERMS_VERSION });
  tickets.delete(t.id); startSession(req, res, u, { remember: t.remember, mfa: true }); audit(req, 'signed-in', { user: u.username, via: t.via, twoStep: true });
  res.json({ ok: true, recovery: codes });
});
app.post('/api/auth/terms', express.json({ limit: '4kb' }), (req, res) => {
  if (req.body?.accept !== true) return res.status(400).json({ error: 'Please read and accept the terms to use CasaTorch.' });
  const t = req.body?.ticket ? ticketOf(req.body.ticket) : null, u = t ? userById(t.userId) : req.user;
  if (!u || u.panel) return res.status(401).json({ error: 'Sign in again.' });
  u.terms = { version: TERMS_VERSION, at: nowIso() }; saveUsers(); audit(req, 'terms-accepted', { user: u.username, version: TERMS_VERSION });
  if (t) { t.passed.add('terms'); return proceed(req, res, t); }
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => { const tok = cookieOf(req); if (tok) { delete sessions[sha256(tok)]; saveSessions(); } if (req.user) audit(req, 'signed-out'); res.setHeader('Set-Cookie', `casatorch_session=; ${cookieFlags(req)}; Max-Age=0`); res.json({ ok: true }); });
app.post('/api/logout', (req, res) => { const tok = cookieOf(req); if (tok) { delete sessions[sha256(tok)]; saveSessions(); } res.setHeader('Set-Cookie', `casatorch_session=; ${cookieFlags(req)}; Max-Age=0`); res.json({ ok: true }); });
app.get('/api/health', (_req, res) => res.json({ ok: true, version: VERSION, install: INSTALL }));

/* ---- invites: the owner adds someone, they pick their own username and password ---- */
app.get('/api/auth/invite', (req, res) => {
  const u = users.list.find((x) => x.invite && x.invite.hash === sha256(req.query.token || '') && Date.parse(x.invite.exp) > Date.now());
  if (!u) return res.status(404).json({ error: 'This invite link has expired or was already used. Ask for a new one.' });
  res.json({ name: u.name, email: u.email, username: u.username, house: config.house?.name || null, reset: !!u.invite.reset, terms: TERMS_VERSION });
});
app.post('/api/auth/invite', express.json({ limit: '4kb' }), (req, res) => {
  const b = req.body || {}, ip = clientIp(req);
  if (limited(`ip:${ip}`, 30)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  const u = users.list.find((x) => x.invite && x.invite.hash === sha256(b.token || '') && Date.parse(x.invite.exp) > Date.now());
  if (!u) { failed(`ip:${ip}`); return res.status(404).json({ error: 'This invite link has expired or was already used.' }); }
  const name = String(b.username || u.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,40}$/.test(name)) return res.status(400).json({ error: 'Usernames are 3-40 letters, numbers, dots, dashes or @.' });
  if (users.list.some((x) => x !== u && (x.username === name || (x.email && x.email.toLowerCase() === name)))) return res.status(409).json({ error: 'That username is taken.' });
  const pwErr = passwordProblem(b.password, name); if (pwErr) return res.status(400).json({ error: pwErr });
  if (b.accept !== true) return res.status(400).json({ error: 'Please read and accept the terms to use CasaTorch.' });
  Object.assign(u, { username: name, password: hashSecret(b.password), invite: undefined, terms: { version: TERMS_VERSION, at: nowIso() } });
  delete u.invite; saveUsers(); endSessionsOf(u.id); audit(req, 'invite-accepted', { user: name });
  proceed(req, res, newTicket(u, { via: 'invite' }));
});
/* Long, not complicated: 10+ characters, not the username, not a well-known one. */
const COMMON = new Set(['password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'iloveyou12', 'letmein123', 'welcome123', 'casatorch123', 'administrator', 'passw0rd!', 'football12', 'baseball12']);
function passwordProblem(pw, username) {
  const p = String(pw || '');
  if (p.length < 10) return 'Use at least 10 characters - a short sentence works well.';
  if (p.length > 200) return 'That password is too long.';
  if (COMMON.has(p.toLowerCase()) || p.toLowerCase().includes(String(username || '').toLowerCase()) && String(username || '').length > 2) return 'Pick something less easy to guess (not your username or a common password).';
  if (/^(.)\1+$/.test(p)) return 'Pick something less easy to guess.';
  return null;
}

/* ---- me: my account, my 2FA, my sessions ---- */
app.get('/api/auth/me', (req, res) => {
  if (!signInOn()) return res.json({ signIn: false, user: { name: 'Demo', role: 'owner' }, terms: TERMS_VERSION });
  const u = req.user; if (!u) return res.status(401).json({ error: 'sign in first' });
  const mine = Object.entries(sessions).filter(([, s]) => s.userId === u.id).map(([k, s]) => ({ id: s.id, kind: s.kind, created: s.created, seen: s.seen, ip: s.ip, agent: s.agent, current: k === req.session.key }));
  res.json({ signIn: true, user: safeUser(u), recoveryLeft: u.totp?.recovery?.length ?? null, policy: users.policy, google: { configured: !!users.google?.clientId, linked: !!u.google?.sub }, terms: TERMS_VERSION, needsTerms: needsTerms(u), sessions: mine });
});
app.post('/api/auth/password', express.json({ limit: '4kb' }), (req, res) => {
  const u = me(req, res); if (!u) return;
  if (limited(`pw:${u.id}`, 5)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  if (!verifySecret(u.password, req.body?.current || '')) { failed(`pw:${u.id}`); return res.status(403).json({ error: 'Your current password is not right.' }); }
  const err = passwordProblem(req.body?.next, u.username); if (err) return res.status(400).json({ error: err });
  u.password = hashSecret(req.body.next); saveUsers(); endSessionsOf(u.id, req.session.key); audit(req, 'password-changed');
  res.json({ ok: true });
});
app.post('/api/auth/2fa/start', express.json({ limit: '4kb' }), async (req, res) => {
  const u = me(req, res); if (!u) return;
  /* Your password again first: someone using a browser you left signed in can't put two-step sign-in on their own phone and lock you out. */
  if (u.password) {
    if (limited(`pw:${u.id}`, 5)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
    if (!verifySecret(u.password, req.body?.password || '')) { failed(`pw:${u.id}`); return res.status(403).json({ error: 'Your password is not right.' }); }
  }
  const e = await totpEnrolment(u); req.session && (pendingTotp.set(u.id, { secret: e.secret, exp: Date.now() + 10 * 60_000 }));
  res.json({ uri: e.uri, qr: e.qr, secret: e.secret });
});
const pendingTotp = new Map();
app.post('/api/auth/2fa/enable', express.json({ limit: '4kb' }), (req, res) => {
  const u = me(req, res); if (!u) return;
  const p = pendingTotp.get(u.id);
  if (!p || p.exp < Date.now()) return res.status(400).json({ error: 'Start again - that took too long.' });
  if (!totpOk(p.secret, req.body?.code)) return res.status(400).json({ error: 'That code is not right - check the time on your phone and try again.' });
  const codes = recoveryCodes();
  u.totp = { on: true, secret: seal(p.secret), recovery: codes.map(rcHash), since: nowIso(), lastStep: Math.floor(Date.now() / 30000) };
  pendingTotp.delete(u.id); saveUsers(); endSessionsOf(u.id, req.session.key); audit(req, '2fa-on');
  res.json({ ok: true, recovery: codes });
});
app.post('/api/auth/2fa/disable', express.json({ limit: '4kb' }), (req, res) => {
  const u = me(req, res); if (!u) return;
  if (users.policy?.require2fa) return res.status(403).json({ error: 'Two-step sign-in is required on this CasaTorch - an admin can change that.' });
  if (limited(`pw:${u.id}`, 5)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  if (!verifySecret(u.password, req.body?.password || '') || !secondFactorOk(u, req.body?.code)) { failed(`pw:${u.id}`); return res.status(403).json({ error: 'Your password or code is not right.' }); }
  delete u.totp; saveUsers(); audit(req, '2fa-off'); res.json({ ok: true });
});
app.post('/api/auth/2fa/recovery', express.json({ limit: '4kb' }), (req, res) => {
  const u = me(req, res); if (!u) return;
  if (!u.totp?.on) return res.status(400).json({ error: 'Turn on two-step sign-in first.' });
  if (limited(`pw:${u.id}`, 5)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  if (!verifySecret(u.password, req.body?.password || '')) { failed(`pw:${u.id}`); return res.status(403).json({ error: 'Your password is not right.' }); }
  const codes = recoveryCodes(); u.totp.recovery = codes.map(rcHash); saveUsers(); audit(req, 'recovery-codes-new');
  res.json({ ok: true, recovery: codes });
});
app.delete('/api/auth/sessions/:id', (req, res) => {
  if (!req.user) return res.status(401).end();
  const admin = rank(req.user.role) >= rank('admin');
  const hit = Object.entries(sessions).find(([, s]) => s.id === req.params.id && (s.userId === req.user.id || admin));
  if (!hit) return res.status(404).json({ error: 'no such session' });
  delete sessions[hit[0]]; saveSessions(); audit(req, 'session-ended', { of: userById(hit[1].userId)?.username });
  res.json({ ok: true });
});
app.post('/api/auth/sessions/others', (req, res) => { const u = me(req, res); if (!u) return; endSessionsOf(u.id, req.session.key); audit(req, 'other-sessions-ended'); res.json({ ok: true }); });

/* ---- admin: people, policy, Google, wall panels, audit ---- */
/* The address to put in links for other devices (invites, wall panels). At home with the secure address ready:
   that one - it opens on any device in the house, encrypted, and it's where the browser would be moved anyway
   (a link to the plain address would sign a wall panel in there, then lose the sign-in when it moves to https).
   Made on this computer (localhost)? The address other devices can open instead. */
function linkBase(req) {
  let host = String(req.headers.host || '');
  const atHome = /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[\w-]+\.local(:|$))/i.test(host);
  if (atHome && LOCAL_TLS.url) return LOCAL_TLS.url;
  if (/^(localhost|127\.|\[::1\])/i.test(host) && typeof lanAddress === 'function' && lanAddress()) host = `${lanAddress()}:${host.split(':').pop().replace(/\D/g, '') || PORT}`;
  return `${req.protocol}://${host}`;
}
const inviteLink = (req, u, reset = false) => {
  const tok = crypto.randomBytes(24).toString('base64url');
  u.invite = { hash: sha256(tok), exp: new Date(Date.now() + 7 * 86400_000).toISOString(), reset };
  return `${linkBase(req)}/login.html?invite=${tok}`;
};
app.get('/api/users', requireRole('admin'), (_req, res) => res.json({ users: users.list.map(safeUser), panels: (users.panels || []).map(({ id, name, role, createdAt, lastUsed }) => ({ id, name, role, createdAt, lastUsed })), policy: users.policy, google: users.google ? { clientId: users.google.clientId, hasSecret: !!users.google.secret } : null, roles: ROLES }));
app.post('/api/users', requireRole('admin'), express.json({ limit: '4kb' }), (req, res) => {
  const b = req.body || {}, role = ROLES.includes(b.role) ? b.role : 'member';
  if (role === 'owner' && req.user?.role !== 'owner') return res.status(403).json({ error: 'Only the owner can add another owner.' });
  const name = String(b.name || '').trim().slice(0, 60), email = String(b.email || '').trim().toLowerCase().slice(0, 120) || null;
  if (!name) return res.status(400).json({ error: 'Give them a name.' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That e-mail does not look right.' });
  if (email && users.list.some((x) => x.email === email)) return res.status(409).json({ error: 'Someone already has that e-mail.' });
  const base = (email ? email.split('@')[0] : name).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30) || 'user';
  let username = base; for (let i = 2; users.list.some((x) => x.username === username); i++) username = `${base}${i}`;
  const u = { id: newId(), username, name, email, role, password: null, createdAt: nowIso(), terms: null };
  const link = inviteLink(req, u); users.list.push(u); saveUsers(); audit(req, 'user-added', { added: username, role });
  res.json({ ok: true, user: safeUser(u), link });
});
app.put('/api/users/:id', requireRole('admin'), express.json({ limit: '4kb' }), (req, res) => {
  const u = users.list.find((x) => x.id === req.params.id); if (!u) return res.status(404).json({ error: 'no such person' });
  const b = req.body || {};
  if (u.role === 'owner' && req.user && req.user.role !== 'owner' && req.user.id !== u.id) return res.status(403).json({ error: 'Only an owner can change an owner\'s details.' });
  if (b.role && ROLES.includes(b.role) && b.role !== u.role) {
    if ((b.role === 'owner' || u.role === 'owner') && req.user?.role !== 'owner') return res.status(403).json({ error: 'Only the owner can change an owner.' });
    if (u.role === 'owner' && users.list.filter((x) => x.role === 'owner').length < 2) return res.status(400).json({ error: 'There must always be an owner.' });
    audit(req, 'role-changed', { of: u.username, from: u.role, to: b.role }); u.role = b.role;
  }
  if (typeof b.name === 'string' && b.name.trim()) u.name = b.name.trim().slice(0, 60);
  if (typeof b.email === 'string') { const e = b.email.trim().toLowerCase(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: 'That e-mail does not look right.' }); if (e && users.list.some((x) => x !== u && x.email === e)) return res.status(409).json({ error: 'Someone already has that e-mail.' }); u.email = e || null; if (u.google) delete u.google; }
  saveUsers(); res.json({ ok: true, user: safeUser(u) });
});
app.post('/api/users/:id/reset', requireRole('admin'), (req, res) => {
  const u = users.list.find((x) => x.id === req.params.id); if (!u) return res.status(404).json({ error: 'no such person' });
  if (u.role === 'owner' && req.user?.role !== 'owner') return res.status(403).json({ error: 'Only the owner can reset an owner.' });
  if (!users.list.some((x) => x !== u && x.password && (x.role === 'owner' || x.role === 'admin'))) return res.status(400).json({ error: 'That would leave nobody who can sign in and manage CasaTorch. Change your password in Settings › Security instead.' });
  const link = inviteLink(req, u, true); u.password = null; delete u.totp; saveUsers(); endSessionsOf(u.id); audit(req, 'user-reset', { of: u.username });
  res.json({ ok: true, link });
});
app.delete('/api/users/:id', requireRole('admin'), (req, res) => {
  const u = users.list.find((x) => x.id === req.params.id); if (!u) return res.status(404).json({ error: 'no such person' });
  if (u.role === 'owner') return res.status(400).json({ error: 'Make someone else the owner first.' });
  if (u.id === req.user?.id) return res.status(400).json({ error: "You can't remove yourself." });
  users.list = users.list.filter((x) => x !== u); saveUsers(); endSessionsOf(u.id); audit(req, 'user-removed', { removed: u.username });
  res.json({ ok: true });
});
app.put('/api/auth/admin/policy', express.json({ limit: '4kb' }), requireRole('admin'), (req, res) => {
  const want = !!req.body?.require2fa;
  if (want && req.user && !req.user.totp?.on) return res.status(400).json({ error: 'Turn on two-step sign-in for yourself first, so you are not locked out.' });
  users.policy = { ...(users.policy || {}), require2fa: want }; saveUsers(); audit(req, 'policy-changed', { require2fa: want });
  res.json({ ok: true, policy: users.policy });
});
app.put('/api/auth/admin/google', express.json({ limit: '8kb' }), requireRole('admin'), (req, res) => {
  const b = req.body || {};
  if (!b.clientId) { users.google = null; saveUsers(); audit(req, 'google-off'); return res.json({ ok: true }); }
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(String(b.clientId))) return res.status(400).json({ error: 'That is not a Google client ID (it ends in .apps.googleusercontent.com).' });
  users.google = { clientId: String(b.clientId), secret: b.clientSecret ? seal(String(b.clientSecret)) : users.google?.secret || null };
  if (!users.google.secret) return res.status(400).json({ error: 'Paste the client secret too.' });
  saveUsers(); audit(req, 'google-on'); res.json({ ok: true });
});
app.post('/api/auth/admin/panels', express.json({ limit: '4kb' }), requireRole('admin'), (req, res) => {
  const role = req.body?.role === 'member' ? 'member' : 'viewer', name = String(req.body?.name || 'Wall panel').trim().slice(0, 40);
  const tok = crypto.randomBytes(32).toString('base64url'), p = { id: newId(), name, role, hash: sha256(tok), createdAt: nowIso() };
  (users.panels ||= []).push(p); saveUsers(); audit(req, 'panel-link-made', { panel: name, role });
  res.json({ ok: true, link: `${linkBase(req)}/api/auth/panel?token=${tok}` });
});
app.delete('/api/auth/admin/panels/:id', requireRole('admin'), (req, res) => {
  const p = (users.panels || []).find((x) => x.id === req.params.id); if (!p) return res.status(404).json({ error: 'no such panel' });
  users.panels = users.panels.filter((x) => x !== p); saveUsers(); endSessionsOf(`panel:${p.id}`); audit(req, 'panel-link-revoked', { panel: p.name });
  res.json({ ok: true });
});
/* A wall panel opens its link once and stays signed in (as that panel, never as a person). */
app.get('/api/auth/panel', (req, res) => {
  const ip = clientIp(req);
  if (limited(`ip:${ip}`, 30)) return res.status(429).send('Too many tries.');
  const p = (users.panels || []).find((x) => x.hash === sha256(req.query.token || ''));
  if (!p) { failed(`ip:${ip}`); return res.redirect('/login.html?error=panel'); }
  p.lastUsed = nowIso(); saveUsers();
  startSession(req, res, userById(`panel:${p.id}`), { kind: 'panel' }); audit(req, 'panel-signed-in', { panel: p.name });
  res.redirect('/?panel=1');
});
app.get('/api/auth/admin/audit', requireRole('admin'), (_req, res) => {
  let lines = []; try { lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').slice(-300).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* none yet */ }
  res.json({ events: lines });
});
app.get('/api/auth/admin/sessions', requireRole('admin'), (_req, res) => res.json({ sessions: Object.values(sessions).map((s) => ({ id: s.id, user: userById(s.userId)?.name || '?', kind: s.kind, seen: s.seen, created: s.created, ip: s.ip, agent: s.agent })) }));

/* ---- Sign in with Google (OAuth 2.0 authorization code + PKCE) ---- */
const googleStates = new Map();
app.get('/api/auth/google/start', (req, res) => {
  if (!users.google?.clientId) return res.redirect('/login.html?error=google-off');
  const state = crypto.randomBytes(24).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url');
  const redirectUri = `${req.protocol}://${req.headers.host}/api/auth/google/callback`;
  googleStates.set(state, { verifier, redirectUri, remember: req.query.remember === '1', exp: Date.now() + 10 * 60_000 });
  for (const [k, v] of googleStates) if (v.exp < Date.now()) googleStates.delete(k);
  const q = new URLSearchParams({ client_id: users.google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
  res.setHeader('Set-Cookie', `casatorch_gstate=${state}; ${cookieFlags(req)}; Max-Age=600`);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});
app.get('/api/auth/google/callback', async (req, res) => {
  const state = String(req.query.state || ''), st = googleStates.get(state), cookie = (String(req.headers.cookie || '').match(/(?:^|;\s*)casatorch_gstate=([\w-]+)/) || [])[1];
  googleStates.delete(state);
  if (!st || st.exp < Date.now() || cookie !== state || !req.query.code) return res.redirect('/login.html?error=google-state');
  try {
    const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ code: String(req.query.code), client_id: users.google.clientId, client_secret: unseal(users.google.secret) || '', redirect_uri: st.redirectUri, grant_type: 'authorization_code', code_verifier: st.verifier }) }).then((r) => r.json());
    if (!tok.access_token) throw new Error(tok.error_description || tok.error || 'Google said no');
    const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const email = String(info.email || '').toLowerCase();
    const u = users.list.find((x) => x.google?.sub && x.google.sub === info.sub) || (info.email_verified === true ? users.list.find((x) => x.email && x.email === email && !x.google?.sub) : null);
    if (!u || u.invite && !u.password) { audit(req, 'google-unknown', { email }); return res.redirect('/login.html?error=google-unknown'); }
    if (!u.google?.sub) { u.google = { sub: info.sub, email, linked: nowIso() }; saveUsers(); audit(req, 'google-linked', { user: u.username }); }
    res.setHeader('Set-Cookie', `casatorch_gstate=; ${cookieFlags(req)}; Max-Age=0`);
    proceed(req, res, newTicket(u, { remember: st.remember, via: 'google' }), { redirect: true });
  } catch (err) { audit(req, 'google-failed', { why: String(err.message).slice(0, 120) }); res.redirect('/login.html?error=google-failed'); }
});


