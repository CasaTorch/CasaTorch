/* ======================================================================
 * Sign-in. Once HouseOS is set up, every page and API needs a session,
 * except the login page itself, setup (which locks itself), and health.
 * Sessions: random 32-byte ids in an HttpOnly cookie, kept in
 * data/sessions.json. "Keep this screen signed in" (wall panels) lasts a
 * year; otherwise 30 days. Five wrong passwords in 15 minutes = 15-minute pause.
 * ====================================================================== */
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
let sessions = {}; try { sessions = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8')); } catch { /* none */ }
const saveSessions = () => { try { fs.writeFileSync(SESS_FILE, JSON.stringify(sessions), { mode: 0o600 }); } catch { /* next time */ } };
const fails = [];
function verifySecret(stored, given) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(given), Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
const cookieOf = (req) => (String(req.headers.cookie || '').match(/(?:^|;\s*)houseos_session=([A-Za-z0-9_-]{20,})/) || [])[1];
function sessionOf(req) {
  const id = cookieOf(req), s = id && sessions[id];
  if (!s || Date.parse(s.expires) < Date.now()) return null;
  return { id, ...s };
}
const signInOn = () => isConfigured() && !isDemo() && config.signIn?.enabled !== false && !!config.signIn?.password;
const OPEN = [/^\/login\.(html|css|js)$/, /^\/api\/login$/, /^\/api\/logout$/, /^\/api\/health$/, /^\/setup\.(html|css|js)$/, /^\/api\/setup\//, /^\/icons\//, /^\/favicon/];
app.use((req, res, next) => {
  if (!signInOn() || OPEN.some((r) => r.test(req.path)) || sessionOf(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'sign in first' });
  res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
});
app.post('/api/login', express.json(), (req, res) => {
  while (fails.length && Date.now() - fails[0] > 15 * 60_000) fails.shift();
  if (fails.length >= 5) return res.status(429).json({ error: 'Too many tries - wait 15 minutes.' });
  const { username, password, remember } = req.body || {};
  if (String(username || '') !== config.signIn?.username || !verifySecret(config.signIn?.password, password || '')) { fails.push(Date.now()); return res.status(401).json({ error: 'Wrong username or password.' }); }
  const id = crypto.randomBytes(32).toString('base64url'), days = remember ? 365 : 30;
  sessions[id] = { user: config.signIn.username, created: nowIso(), expires: new Date(Date.now() + days * 86400_000).toISOString(), agent: String(req.headers['user-agent'] || '').slice(0, 120) };
  for (const [k, v] of Object.entries(sessions)) if (Date.parse(v.expires) < Date.now()) delete sessions[k];
  saveSessions();
  res.setHeader('Set-Cookie', `houseos_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { const id = cookieOf(req); if (id) { delete sessions[id]; saveSessions(); } res.setHeader('Set-Cookie', 'houseos_session=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.2.0' }));
/** The door PIN, for unlocking and other risky actions. */
const pinOk = (pin) => !config.signIn?.pin || verifySecret(config.signIn.pin, pin || '');
