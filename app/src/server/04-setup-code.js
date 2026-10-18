/* ======================================================================
 * The setup code: only the owner can set up a new CasaTorch.
 *
 * Before setup, anyone on the home network could open the box and finish
 * setup first. Now setup needs proof you're the owner, and for most people
 * that proof is automatic:
 *  - Opening setup on the computer CasaTorch runs on (the Mac or Windows app
 *    opens it there by itself): no code.
 *  - Opening it from Home Assistant (the add-on's Open Web UI - Home
 *    Assistant has already signed you in): no code.
 *  - Anywhere else (your phone, another computer, Docker from another
 *    machine, the Pi): an 8-letter setup code. It is shown on the computer
 *    CasaTorch runs on (with a QR code to scan with your phone, which opens
 *    setup with the code filled in), in the Docker / add-on log, and for a
 *    Box on the card in the box. Entering it once lets that browser finish
 *    setup.
 * The code lives in DATA_DIR/setup-code (owner-only) and is deleted when
 * setup is finished. Wrong codes are rate limited.
 * ====================================================================== */
const SETUP_CODE_FILE = path.join(DATA_DIR, 'setup-code');
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L - easy to read off a screen or a card
let setupCodeMemo = null;
const setupCookieKey = crypto.randomBytes(32);   // proofs last until this CasaTorch restarts (enter the code again after a restart)
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;
function setupCode() {
  if (isConfigured() || isDemo()) { if (setupCodeMemo !== false) { setupCodeMemo = false; fs.rm(SETUP_CODE_FILE, { force: true }, () => {}); } return null; }   // set up: the code is gone for good
  if (setupCodeMemo) return setupCodeMemo;
  for (const src of [() => fs.readFileSync(SETUP_CODE_FILE, 'utf8'), () => process.env.CASATORCH_SETUP_CODE, () => fs.readFileSync('/boot/casatorch-setup-code', 'utf8'), () => fs.readFileSync('/boot/firmware/casatorch-setup-code', 'utf8')]) {
    try { const v = cleanCode(src()); if (/^[A-Z2-9]{8}$/.test(v)) { setupCodeMemo = v; break; } } catch { /* not there */ }
  }
  if (!setupCodeMemo) setupCodeMemo = Array.from({ length: 8 }, () => CODE_ABC[crypto.randomInt(CODE_ABC.length)]).join('');
  try { if (!fs.existsSync(SETUP_CODE_FILE)) writeFileSafe(SETUP_CODE_FILE, `${setupCodeMemo}\n`, 0o600); } catch { /* read-only data folder: the code still works until a restart */ }
  return setupCodeMemo;
}
/* Proof without a code: the same computer, or Home Assistant's own signed-in panel. */
function setupTrusted(req) {
  const sock = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const proxied = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers.forwarded || req.headers['x-casatorch-internal'];   // a proxy, or CasaTorch's own request to itself
  if (/^(127\.|::1$)/.test(sock) && !proxied) return 'this computer';
  if (process.env.SUPERVISOR_TOKEN && sock === '172.30.32.2' && req.headers['x-ingress-path']) return 'Home Assistant';   // scrub-ok: Home Assistant Supervisor's fixed ingress address
  return null;
}
const setupProof = () => crypto.createHmac('sha256', setupCookieKey).update(`setup:${setupCode() || ''}`).digest('base64url');
function setupProven(req) {
  if (!setupCode() || setupTrusted(req)) return true;
  const c = String(req.headers.cookie || '').match(/(?:^|;\s*)ct_setup=([\w-]+)/)?.[1] || '';
  const want = setupProof();
  return c.length === want.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(want));
}
function setupWhere() {   // where this CasaTorch's owner finds the code
  if (process.env.SUPERVISOR_TOKEN) return 'addon';
  if (fs.existsSync('/.dockerenv') || process.env.CASATORCH_DOCKER) return 'docker';
  let model = ''; try { model = fs.readFileSync('/proc/device-tree/model', 'utf8'); } catch { /* not a Pi */ }
  return process.env.CASATORCH_INSTALL === 'pi-image' || /raspberry/i.test(model) ? 'pi' : 'computer';
}
/* Tell the setup page whether it needs the code (and never the code itself, unless this is the computer CasaTorch runs on). */
app.get('/api/setup/code', async (req, res) => {
  const code = setupCode();
  if (!code) return res.json({ needed: false });
  const trusted = setupTrusted(req);
  if (!trusted) return res.json({ needed: !setupProven(req), how: setupWhere() });
  // On the computer itself: the code and a QR code that opens setup on a phone with the code filled in.
  const lan = typeof lanAddress === 'function' ? lanAddress() : null, port = process.env.PORT || 8090;
  const base = LOCAL_TLS.url || (lan ? `http://${lan}:${port}` : null);
  const url = base ? `${base}/setup.html?code=${fmtCode(code)}` : null;
  let qr = null; try { if (url) qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch { /* no QR: the code still shows */ }
  res.json({ needed: false, trusted, code: fmtCode(code), url, qr });
});
app.post('/api/setup/code', express.json({ limit: '2kb' }), (req, res) => {
  const code = setupCode(); if (!code) return res.json({ ok: true });
  const ip = typeof clientIp === 'function' ? clientIp(req) : req.ip;
  if (limited(`setupcode:${ip}`, 8) || limited('setupcode:all', 60)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const got = cleanCode(req.body?.code);
  if (got.length !== code.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(code))) return failed(`setupcode:${ip}`, 'setupcode:all'), res.status(403).json({ error: 'That code isn\'t right. Check it and try again - it\'s 8 letters and numbers, like ABCD-2345.' });
  res.setHeader('Set-Cookie', setupCookie(req));
  res.json({ ok: true });
});
/* "Allow this device": set up on a phone or another computer without typing the code. That device asks; the computer
   CasaTorch runs on (or Home Assistant's own panel) shows who's asking with a two-digit number, and only there can it
   be allowed. Requests expire after 5 minutes; at most 5 wait at once, and 5 an hour from one address. */
const setupAsks = new Map();
const setupCookie = (req) => `ct_setup=${setupProof()}; Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`;
function askWhat(ua) {
  ua = String(ua || '');
  const dev = /iPhone/.test(ua) ? 'An iPhone' : /iPad/.test(ua) ? 'An iPad' : /Android/.test(ua) ? 'An Android phone or tablet' : /Macintosh/.test(ua) ? 'A Mac' : /Windows/.test(ua) ? 'A Windows computer' : /Linux|CrOS/.test(ua) ? 'A computer' : 'A device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${dev} (${br})` : dev;
}
const askSweep = () => { const now = Date.now(); for (const [k, a] of setupAsks) if (now - a.at > 5 * 60_000) setupAsks.delete(k); };
app.post('/api/setup/ask', (req, res) => {
  if (!setupCode()) return res.json({ done: true });
  askSweep();
  const ip = typeof clientIp === 'function' ? clientIp(req) : req.ip;
  if (limited(`setupask:${ip}`, 5, 60 * 60_000) || setupAsks.size >= 5) return res.status(429).json({ error: 'Too many requests are waiting. Use the setup code instead, or try again in a few minutes.' });
  failed(`setupask:${ip}`);   // every ask counts toward the 5 an hour
  const a = { id: crypto.randomBytes(18).toString('base64url'), what: askWhat(req.headers['user-agent']), num: String(crypto.randomInt(10, 100)), at: Date.now(), ok: null };
  setupAsks.set(a.id, a);
  res.json({ id: a.id, num: a.num });
});
app.get('/api/setup/ask/:id', (req, res) => {   // the asking device waits here
  const a = setupAsks.get(String(req.params.id)); if (!a) return res.status(404).json({ error: 'That request ran out. Ask again.' });
  if (a.ok === true) { setupAsks.delete(a.id); res.setHeader('Set-Cookie', setupCookie(req)); return res.json({ ok: true }); }
  if (a.ok === false) { setupAsks.delete(a.id); return res.json({ denied: true }); }
  res.json({ waiting: true });
});
app.get('/api/setup/asks', (req, res) => {   // only the computer CasaTorch runs on (or Home Assistant's panel) sees who's asking
  if (!setupTrusted(req)) return res.status(403).json({ error: 'Only on the computer CasaTorch runs on.' });
  askSweep(); res.json({ asks: [...setupAsks.values()].filter((a) => a.ok === null).map(({ id, what, num }) => ({ id, what, num })) });
});
app.post('/api/setup/asks/:id', express.json({ limit: '1kb' }), (req, res) => {
  if (!setupTrusted(req)) return res.status(403).json({ error: 'Only on the computer CasaTorch runs on.' });
  const a = setupAsks.get(String(req.params.id)); if (!a) return res.status(404).json({ error: 'That request ran out.' });
  a.ok = req.body?.allow === true; res.json({ ok: true });
});
/* Everything else in setup (and claiming a Pro license during setup) needs the proof. */
app.use('/api', (req, res, next) => {
  if (!setupCode()) return next();
  if (!/^\/(setup|license\/claim)\//.test(req.path) || /^\/setup\/(state|code|ask|ask\/[\w-]+)$/.test(req.path)) return next();
  if (setupProven(req)) return next();
  res.status(401).json({ error: 'Enter the setup code first.', needCode: true });
});
/* Before setup there is no sign-in yet, so reading is gated too: without the proof (or this computer / Home
   Assistant's panel), only what the setup and sign-in pages need before the code is entered answers. Otherwise
   anyone on the network could read the log (which shows the setup code), diagnostics or settings and take the
   box over by finishing setup first. */
const PRESETUP_OPEN = /^\/(health|lang|auth\/state|app\/hello|local-https\/(target|ping)|setup\/(state|code|ask|ask\/[\w-]+|asks|asks\/[\w-]+))$/;
app.use('/api', (req, res, next) => {
  if (!setupCode() || PRESETUP_OPEN.test(req.path) || setupProven(req)) return next();
  res.status(401).json({ error: 'Enter the setup code first.', needCode: true });
});
/* Say where to find it, where only the owner can see it: the log of the CasaTorch app, the container or the add-on. */
setTimeout(() => {
  const code = setupCode(); if (!code) return;
  // straight to the system log (stdout), not the in-app log that Settings › Advanced shows
  process.stdout.write(`\n  CasaTorch setup code: ${fmtCode(code)}\n  (Needed to set up from a phone or another computer. Setting up on this computer doesn't need it.)\n`);
}, 1500);
