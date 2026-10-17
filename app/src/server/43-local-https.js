/* ======================================================================
 * Secure address at home: https on the home network, straight to this box.
 *
 * casatorch.com gives this CasaTorch a name (lan-xxxxxxxx.casatorch.com)
 * that points at its home-network address, e.g. 192.168.1.20. CasaTorch then
 * gets a real certificate for that name from Let's Encrypt (free, trusted by
 * every browser) and answers https on port 8443. Browsers in the house reach
 * it directly - nothing goes out to the internet - and it keeps working when
 * the internet is down (until the certificate renewal is due, 30 days ahead).
 *
 * The certificate's private key is made here and never leaves this box;
 * casatorch.com only creates the DNS records (the name, and the one-off value
 * Let's Encrypt checks to see the name is ours - functions/api/local.js).
 * Renewal is automatic. If the box's home-network address changes, the name
 * follows it. The plain http address keeps working and sends browsers on to
 * https (03-https-redirect.js).
 *
 * On by default: it starts by itself the first time CasaTorch runs - before setup, so even setup's
 * password page is encrypted for anyone setting up from another device. An owner can turn it off.
 * Stored in DATA_DIR/tls: state.json (the name, its secret, on/off), account.pem (Let's Encrypt account),
 * key.pem, cert.pem. Not in config.json, so it can start before setup without making CasaTorch look set up.
 * ====================================================================== */
import acme from 'acme-client';
const LOCAL_URL = process.env.CASATORCH_LOCAL_URL || 'https://casatorch.com/api/local';
const ACME_URL = process.env.CASATORCH_ACME_URL || acme.directory.letsencrypt.production;
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const TLS_DIR = path.join(DATA_DIR, 'tls');
const lt = { state: 'off', why: null, server: null, expires: null, busy: false, fails: 0, nextTry: 0 };
const LT_STATE = path.join(TLS_DIR, 'state.json');
function ltConf() {
  try { return JSON.parse(fs.readFileSync(LT_STATE, 'utf8')); } catch { /* none yet */ }
  if (config.localTls) { const c = config.localTls; ltSaveConf(c); const { localTls: _moved, ...rest } = config; try { saveConfig(rest); } catch { /* fine */ } return c; }   // kept in config.json before 0.4.1
  return null;
}
function ltSaveConf(c) { fs.mkdirSync(TLS_DIR, { recursive: true, mode: 0o700 }); writeFileSafe(LT_STATE, JSON.stringify(c, null, 2), 0o600); }
const ltPrivate = (ip) => { const m = String(ip || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); if (!m) return false; const [a, b, c, d] = m.slice(1).map(Number); if ([a, b, c, d].some((x) => x > 255)) return false; return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); };
const ltUrl = (host) => `https://${host}${HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`}`;
async function ltCall(method, body) {
  const r = await fetch(LOCAL_URL, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `casatorch.com answered ${r.status}`);
  return j;
}
function ltFiles() { try { return { key: fs.readFileSync(path.join(TLS_DIR, 'key.pem')), cert: fs.readFileSync(path.join(TLS_DIR, 'cert.pem')) }; } catch { return null; } }
const certInfo = (pem) => { try { const x = new crypto.X509Certificate(pem); return { until: new Date(x.validTo), names: String(x.subjectAltName || '') }; } catch { return null; } };

/* Get (or renew) the certificate. Let's Encrypt asks for a value in DNS; casatorch.com puts it there for us. */
async function ltIssue({ now = false } = {}) {
  const c = ltConf(); if (!c?.hostname || lt.busy) return;
  if (!now && Date.now() < lt.nextTry) return;   // after a failure: wait 1, 2, 4... up to 24 hours

  lt.busy = true; lt.state = lt.server ? lt.state : 'certificate'; lt.why = null;
  try {
    fs.mkdirSync(TLS_DIR, { recursive: true, mode: 0o700 });
    const accPath = path.join(TLS_DIR, 'account.pem');
    let accountKey = fs.existsSync(accPath) ? fs.readFileSync(accPath) : null;
    if (!accountKey) { accountKey = await acme.crypto.createPrivateKey(); fs.writeFileSync(accPath, accountKey, { mode: 0o600 }); }
    const client = new acme.Client({ directoryUrl: ACME_URL, accountKey });
    const [key, csr] = await acme.crypto.createCsr({ commonName: c.hostname, altNames: [c.hostname] });
    const cert = await client.auto({
      csr, termsOfServiceAgreed: true, challengePriority: ['dns-01'], skipChallengeVerification: true,
      challengeCreateFn: async (_authz, _challenge, value) => { await ltCall('PATCH', { id: c.id, secret: c.secret, txt: value }); await new Promise((ok) => setTimeout(ok, 20_000)); },   // give DNS a moment
      challengeRemoveFn: async () => { await ltCall('PATCH', { id: c.id, secret: c.secret, txt: null }).catch(() => {}); },
    });
    writeFileSafe(path.join(TLS_DIR, 'key.pem'), key, 0o600); writeFileSafe(path.join(TLS_DIR, 'cert.pem'), cert, 0o600);
    lt.fails = 0; lt.nextTry = 0;
    ltServe();
  } catch (err) {
    lt.fails++; lt.nextTry = Date.now() + Math.min(24, 2 ** (lt.fails - 1)) * 3600_000;
    lt.state = lt.server ? 'ready' : 'error'; lt.why = `Couldn't get the certificate: ${err.message}`;
    console.warn(`Secure address at home: ${lt.why} (trying again in ${Math.min(24, 2 ** (lt.fails - 1))} h)`);
  }
  finally { lt.busy = false; }
}
/* Answer https with the certificate we have (a renewal swaps it in without a restart). */
function ltServe() {
  const files = ltFiles(), c = ltConf(); if (!files || !c?.hostname) return;
  const info = certInfo(files.cert); lt.expires = info?.until?.toISOString() || null;
  if (!info || !info.names.includes(c.hostname) || info.until < new Date()) { lt.state = 'error'; lt.why = 'The certificate is missing or out of date - getting a new one.'; return; }
  if (lt.server) { lt.server.setSecureContext(files); lt.state = 'ready'; LOCAL_TLS.url = ltUrl(c.hostname); return; }
  const srv = https.createServer({ ...files, minVersion: 'TLSv1.2' }, app);
  srv.on('error', (e) => { lt.state = 'error'; lt.why = e.code === 'EADDRINUSE' ? `Port ${HTTPS_PORT} is already in use by another program.` : String(e.message); lt.server = null; LOCAL_TLS.url = null; });
  srv.listen(HTTPS_PORT, () => { lt.server = srv; lt.state = 'ready'; lt.why = null; LOCAL_TLS.url = ltUrl(c.hostname); console.log(`Secure address at home: ${LOCAL_TLS.url}`); });
}
function ltStop() { try { lt.server?.close(); } catch { /* closed */ } lt.server = null; lt.state = 'off'; LOCAL_TLS.url = null; }
/* Turn it on: a name from casatorch.com pointing at this box, then the certificate. */
/* The address to point the name at. CASATORCH_LAN_IP wins (Docker with port mapping, where CasaTorch only sees
   Docker's own inner address). Inside a container whose only address looks like Docker's inner network,
   we'd rather not guess: it says so in Settings and waits for the address to be entered. */
const inContainer = (() => { try { return fs.existsSync('/.dockerenv') || /docker|containerd|kubepods/.test(fs.readFileSync('/proc/1/cgroup', 'utf8')); } catch { return false; } })();
function ltAddress() {
  const env = String(process.env.CASATORCH_LAN_IP || '').trim(); if (env) return ltPrivate(env) ? env : null;
  const ip = lanAddress();
  if (ip && inContainer && /^(172\.(1[7-9]|2\d|3[01])\.|192\.168\.65\.)/.test(ip)) return null;
  return ip;
}
async function ltEnable(ipIn) {
  const ip = ipIn || ltAddress();
  if (!ltPrivate(ip)) throw new Error('CasaTorch couldn\'t find its home-network address. Enter it (it looks like 192.168.1.20).');
  if (lt.enabling) throw new Error('It\'s already setting itself up - give it a minute.');
  const id = ltConf()?.id || crypto.randomBytes(9).toString('base64url');
  lt.enabling = true;
  let j; try { j = await ltCall('POST', { id, ip }); } finally { lt.enabling = false; }
  ltSaveConf({ on: true, id, hostname: j.hostname, secret: j.secret, ip, ipAuto: !ipIn });
  lt.state = 'certificate'; ltIssue({ now: true });   // about a minute
  return j.hostname;
}
/* Twice a day: renew 30 days before it runs out, and keep the name pointing at this box. */
async function ltCheck() {
  const c = ltConf(); if (!c?.on || isDemo()) return;
  if (c.ipAuto !== false) {
    const ip = ltAddress();
    if (ip && ltPrivate(ip) && ip !== c.ip) { try { await ltCall('PUT', { id: c.id, secret: c.secret, ip }); ltSaveConf({ ...c, ip }); } catch (e) { lt.why = `Couldn't update the address: ${e.message}`; } }
  }
  const info = certInfo(ltFiles()?.cert);
  if (!info || info.until - Date.now() < 30 * 86400_000) await ltIssue();
}
/* On by default: the first time CasaTorch runs (and every hour until it works, e.g. while the internet is
   down), unless an owner turned it off. */
async function ltAuto() {
  if (isDemo() || process.env.CASATORCH_LOCAL_HTTPS === 'off') return;
  const c = ltConf();
  if (c?.on) { ltServe(); return ltCheck(); }
  if (c?.optOut || lt.busy) return;
  try { await ltEnable(); console.log('Secure address at home: name ready, getting the certificate'); } catch (e) { if (lt.why !== String(e.message)) console.warn(`Secure address at home: ${e.message}`); lt.why = String(e.message); }
}

/* ---- Settings > Secure address at home ---- */
app.get('/api/local-https', requireRole('admin'), (_req, res) => {
  const c = ltConf() || {};
  res.json({ on: !!c.on, optOut: !!c.optOut, auto: !c.on && !c.optOut && !isDemo() && process.env.CASATORCH_LOCAL_HTTPS !== 'off', hostname: c.hostname || null, url: c.hostname ? ltUrl(c.hostname) : null, state: c.on ? lt.state : 'off', why: lt.why, expires: lt.expires,
    ip: c.ip || null, detected: ltAddress(), port: HTTPS_PORT, demo: isDemo() });
});
app.post('/api/local-https/on', requireRole('admin'), express.json(), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  if (ltConf()?.on) return res.json({ ok: true });
  const ip = req.body?.ip ? String(req.body.ip) : null;
  if (ip && !ltPrivate(ip)) return res.status(400).json({ error: 'That isn\'t a home-network address (it looks like 192.168.1.20).' });
  try { res.json({ ok: true, hostname: await ltEnable(ip) }); } catch (err) { res.status(502).json({ error: String(err.message) }); }
});
app.post('/api/local-https/ip', requireRole('admin'), express.json(), async (req, res) => {
  const c = ltConf(), ip = String(req.body?.ip || '');
  if (!c?.on) return res.status(400).json({ error: 'Turn it on first.' });
  if (!ltPrivate(ip)) return res.status(400).json({ error: 'That isn\'t a home-network address (it looks like 192.168.1.20).' });
  try { await ltCall('PUT', { id: c.id, secret: c.secret, ip }); ltSaveConf({ ...c, ip, ipAuto: false }); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ error: String(err.message) }); }
});
app.post('/api/local-https/off', requireRole('admin'), async (_req, res) => {
  const c = ltConf() || {};
  ltStop(); lt.expires = null; lt.why = null;
  if (c.secret) await ltCall('DELETE', { id: c.id, secret: c.secret }).catch(() => {});
  for (const f of ['key.pem', 'cert.pem']) fs.rmSync(path.join(TLS_DIR, f), { force: true });
  ltSaveConf({ on: false, optOut: true, id: c.id });   // stays off until turned on again
  res.json({ ok: true });
});
if (process.env.CASATORCH_TEST !== '1') {
  setTimeout(ltAuto, 3000).unref?.();
  setInterval(ltAuto, 3600_000).unref?.();
  setInterval(ltCheck, 12 * 3600_000).unref?.();
}
