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
 * Stored in DATA_DIR/tls: account.pem (Let's Encrypt account), key.pem, cert.pem.
 * ====================================================================== */
import acme from 'acme-client';
const LOCAL_URL = process.env.CASATORCH_LOCAL_URL || 'https://casatorch.com/api/local';
const ACME_URL = process.env.CASATORCH_ACME_URL || acme.directory.letsencrypt.production;
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const TLS_DIR = path.join(DATA_DIR, 'tls');
const lt = { state: 'off', why: null, server: null, expires: null, busy: false };
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
async function ltIssue() {
  const c = config.localTls; if (!c?.hostname || lt.busy) return;
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
      challengeCreateFn: async (_authz, _challenge, value) => { await ltCall('PATCH', { id: installId(), secret: c.secret, txt: value }); await new Promise((ok) => setTimeout(ok, 20_000)); },   // give DNS a moment
      challengeRemoveFn: async () => { await ltCall('PATCH', { id: installId(), secret: c.secret, txt: null }).catch(() => {}); },
    });
    writeFileSafe(path.join(TLS_DIR, 'key.pem'), key, 0o600); writeFileSafe(path.join(TLS_DIR, 'cert.pem'), cert, 0o600);
    ltServe();
  } catch (err) { lt.state = lt.server ? 'ready' : 'error'; lt.why = `Couldn't get the certificate: ${err.message}`; }
  finally { lt.busy = false; }
}
/* Answer https with the certificate we have (a renewal swaps it in without a restart). */
function ltServe() {
  const files = ltFiles(), c = config.localTls; if (!files || !c?.hostname) return;
  const info = certInfo(files.cert); lt.expires = info?.until?.toISOString() || null;
  if (!info || !info.names.includes(c.hostname) || info.until < new Date()) { lt.state = 'error'; lt.why = 'The certificate is missing or out of date - getting a new one.'; return; }
  if (lt.server) { lt.server.setSecureContext(files); lt.state = 'ready'; LOCAL_TLS.url = ltUrl(c.hostname); return; }
  const srv = https.createServer({ ...files, minVersion: 'TLSv1.2' }, app);
  srv.on('error', (e) => { lt.state = 'error'; lt.why = e.code === 'EADDRINUSE' ? `Port ${HTTPS_PORT} is already in use by another program.` : String(e.message); lt.server = null; LOCAL_TLS.url = null; });
  srv.listen(HTTPS_PORT, () => { lt.server = srv; lt.state = 'ready'; lt.why = null; LOCAL_TLS.url = ltUrl(c.hostname); });
}
function ltStop() { try { lt.server?.close(); } catch { /* closed */ } lt.server = null; lt.state = 'off'; LOCAL_TLS.url = null; }
/* Twice a day: renew 30 days before it runs out, and keep the name pointing at this box. */
async function ltCheck() {
  const c = config.localTls; if (!c?.on || isDemo()) return;
  if (c.ipAuto !== false) {
    const ip = lanAddress();
    if (ip && ltPrivate(ip) && ip !== c.ip) { try { await ltCall('PUT', { id: installId(), secret: c.secret, ip }); saveConfig({ ...config, localTls: { ...config.localTls, ip } }); } catch (e) { lt.why = `Couldn't update the address: ${e.message}`; } }
  }
  const info = certInfo(ltFiles()?.cert);
  if (!info || info.until - Date.now() < 30 * 86400_000) await ltIssue();
}

/* ---- Settings > Secure access ---- */
app.get('/api/local-https', requireRole('admin'), (_req, res) => {
  const c = config.localTls || {};
  res.json({ on: !!c.on, hostname: c.hostname || null, url: c.hostname ? ltUrl(c.hostname) : null, state: c.on ? lt.state : 'off', why: lt.why, expires: lt.expires,
    ip: c.ip || null, detected: lanAddress(), port: HTTPS_PORT, demo: isDemo() });
});
app.post('/api/local-https/on', requireRole('admin'), express.json(), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  if (config.localTls?.on) return res.json({ ok: true });
  const ip = String(req.body?.ip || lanAddress() || '');
  if (!ltPrivate(ip)) return res.status(400).json({ error: 'CasaTorch couldn\'t find its home-network address. Enter it (it looks like 192.168.1.20).' });
  try {
    const j = await ltCall('POST', { id: installId(), ip });
    saveConfig({ ...config, localTls: { on: true, hostname: j.hostname, secret: j.secret, ip, ipAuto: !req.body?.ip } });
    lt.state = 'certificate'; res.json({ ok: true, hostname: j.hostname });
    ltIssue();   // about a minute; the card shows progress
  } catch (err) { res.status(502).json({ error: String(err.message) }); }
});
app.post('/api/local-https/ip', requireRole('admin'), express.json(), async (req, res) => {
  const c = config.localTls, ip = String(req.body?.ip || '');
  if (!c?.on) return res.status(400).json({ error: 'Turn it on first.' });
  if (!ltPrivate(ip)) return res.status(400).json({ error: 'That isn\'t a home-network address (it looks like 192.168.1.20).' });
  try { await ltCall('PUT', { id: installId(), secret: c.secret, ip }); saveConfig({ ...config, localTls: { ...c, ip, ipAuto: false } }); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ error: String(err.message) }); }
});
app.post('/api/local-https/off', requireRole('admin'), async (_req, res) => {
  const c = config.localTls || {};
  ltStop(); lt.expires = null; lt.why = null;
  if (c.secret) await ltCall('DELETE', { id: installId(), secret: c.secret }).catch(() => {});
  for (const f of ['key.pem', 'cert.pem']) fs.rmSync(path.join(TLS_DIR, f), { force: true });
  const { localTls: _gone, ...rest } = config; saveConfig(rest);
  res.json({ ok: true });
});
if (process.env.CASATORCH_TEST !== '1') {
  setTimeout(() => { if (config.localTls?.on && !isDemo()) { ltServe(); ltCheck(); } }, 2000).unref?.();
  setInterval(ltCheck, 12 * 3600_000).unref?.();
}
