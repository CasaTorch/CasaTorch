/* ======================================================================
 * Setup's "Protect your CasaTorch" step: two-step sign-in, right after the
 * owner login is chosen (strongly recommended, "Not now" allowed).
 *
 * The owner account doesn't exist until Finish, so the authenticator secret
 * made here waits for it: sealed (AES-256-GCM, like config.json) in
 * data/setup-2fa.json (owner-only), so a refresh or a power cut mid-setup
 * doesn't lose it, and moved onto the owner at Finish (setup2faAttach, called
 * from 05-setup.js). Recovery codes are shown once and kept only as salted
 * scrypt hashes. The TOTP itself is 08-signin.js's (totpEnrolment, totpOk,
 * recoveryCodes, rcHashAllAsync) - nothing is done twice here.
 *
 * Running setup again (Settings › Change your setup): the step is about the
 * signed-in person's own login and turns it on straight away, like Settings ›
 * People & sign-in does. Every route is under /api/setup, so it is open only
 * while setup is, and only with the setup code (04-setup-code.js) or as a
 * signed-in owner or admin (05-setup.js).
 * ====================================================================== */
const SETUP_2FA_FILE = path.join(DATA_DIR, 'setup-2fa.json');
let setup2fa = (() => {
  if (isDemo()) return null;
  try { const j = JSON.parse(unseal(fs.readFileSync(SETUP_2FA_FILE, 'utf8').trim(), 'setup-2fa') || 'null'); return j?.secret && Date.now() - Date.parse(j.at) < 30 * 86400_000 ? j : null; }
  catch { return null; }
})();
function setup2faSave(v) {
  setup2fa = v;
  if (!v) { try { fs.rmSync(SETUP_2FA_FILE, { force: true }); } catch { /* gone */ } return; }
  writeFileSafe(SETUP_2FA_FILE, seal(JSON.stringify(v), 'setup-2fa'), 0o600);
}
/* The person this step is for: the signed-in admin when setup runs again, else the owner being made now. */
const setup2faRerun = (req) => isConfigured() && !isDemo() && !!req.setupUser;
const SETUP_2FA_WRONG = 'That code isn\'t right - check the time on your phone is set automatically, then type the newest code.';

app.get('/api/setup/2fa', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (isDemo()) return res.json({ on: false, demo: true });
  if (setup2faRerun(req)) return res.json({ on: !!req.setupUser.totp?.on, rerun: true, recoveryLeft: req.setupUser.totp?.recovery?.length ?? null });
  res.json({ on: !!setup2fa?.on, started: !!setup2fa && !setup2fa.on });
});
app.post('/api/setup/2fa/start', asyncRoute(async (req, res) => {
  if (isDemo()) return res.status(409).json({ error: 'The demo has no accounts - set up two-step sign-in on your own CasaTorch.' });
  if (overLimit('setup2fa:start', 20)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const rerun = setup2faRerun(req);
  if (rerun && req.setupUser.totp?.on) return res.json({ on: true });
  const name = rerun ? req.setupUser.username : String(req.body?.username || '').trim().toLowerCase();
  const e = await totpEnrolment({ username: /^[a-z0-9._@-]{3,40}$/.test(name) ? name : 'owner' });
  if (rerun) pendingTotp.set(req.setupUser.id, { secret: e.secret, exp: Date.now() + 10 * 60_000 });   // the same waiting room Settings uses (08-signin.js)
  else setup2faSave({ at: nowIso(), secret: e.secret, on: false });
  res.json({ uri: e.uri, qr: e.qr, secret: e.secret });
}));
app.post('/api/setup/2fa/verify', asyncRoute(async (req, res) => {
  if (isDemo()) return res.status(409).json({ error: 'The demo has no accounts.' });
  if (limited('setup2fa:code', 10)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const rerun = setup2faRerun(req), u = rerun ? req.setupUser : null;
  const p = rerun ? pendingTotp.get(u.id) : setup2fa;
  if (!p?.secret || (rerun && p.exp < Date.now())) return res.status(400).json({ error: 'That took a while - press "Start again" for a fresh QR code.', restart: true });
  const step = totpOk(p.secret, req.body?.code);
  if (!step) { failed('setup2fa:code'); return res.status(400).json({ error: SETUP_2FA_WRONG }); }
  const codes = recoveryCodes(), hashes = await rcHashAllAsync(codes);
  if (rerun) {
    u.totp = { on: true, secret: seal(p.secret), recovery: hashes, since: nowIso(), lastStep: step };
    pendingTotp.delete(u.id); saveUsers(); endSessionsOf(u.id, sessionOf(req)?.key); audit(req, '2fa-on', { via: 'setup' });
  } else setup2faSave({ ...p, on: true, recovery: hashes, lastStep: step });
  res.json({ ok: true, recovery: codes });
}));
/* The codes are shown once. Lost them before Finish (a refresh)? A fresh set replaces them. */
app.post('/api/setup/2fa/codes', asyncRoute(async (req, res) => {
  if (setup2faRerun(req) || !setup2fa?.on) return res.status(400).json({ error: 'Turn on two-step sign-in first.' });
  if (overLimit('setup2fa:codes', 10)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const codes = recoveryCodes(); setup2faSave({ ...setup2fa, recovery: await rcHashAllAsync(codes) });
  res.json({ ok: true, recovery: codes });
}));
/* Changed your mind before Finish: forget the authenticator secret. (After Finish it's turned off in Settings, with a code.) */
app.delete('/api/setup/2fa', (req, res) => {
  if (setup2faRerun(req)) return res.status(400).json({ error: 'Turn it off in Settings › People & sign-in.' });
  setup2faSave(null); res.json({ ok: true });
});
/** Finish (05-setup.js): the owner just made gets the two-step sign-in set up in this run. */
function setup2faAttach() {
  const p = setup2fa; if (!p) return false;
  setup2faSave(null);
  const owner = users.list.find((x) => x.role === 'owner');
  if (!p.on || !owner || owner.totp?.on) return false;
  owner.totp = { on: true, secret: seal(p.secret), recovery: p.recovery || [], since: nowIso(), lastStep: p.lastStep || 0 };
  saveUsers(); audit(null, '2fa-on', { user: owner.username, via: 'setup' });
  return true;
}
