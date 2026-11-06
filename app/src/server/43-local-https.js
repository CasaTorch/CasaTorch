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
 * Only this box can get certificates for its name: CasaTorch sends casatorch.com its
 * Let's Encrypt account address, and casatorch.com puts a CAA record on the name
 * (0 issue "letsencrypt.org; accounturi=<that account>"), so Let's Encrypt refuses
 * anyone else - even someone who could put a check value in DNS. If the account
 * changes (a backup restored on another box), the record follows at the next renewal.
 * Renewal is automatic. If the box's home-network address changes, the name
 * follows it. The plain http address keeps working and sends browsers on to
 * https (03-https-redirect.js).
 *
 * On by default: it starts by itself the first time CasaTorch runs - before setup, so even setup's
 * password page is encrypted for anyone setting up from another device. An owner can turn it off.
 * Stored in DATA_DIR/tls: state.json (the name, its secret, on/off), account.pem (Let's Encrypt account),
 * key.pem, cert.pem. Both private keys (account.pem, key.pem) are sealed with the box's key like every other secret
 * (AES-256-GCM): a copy of the data folder without secret.key can't pose as this box. Not in config.json, so it can start before setup without making CasaTorch look set up.
 * ====================================================================== */
const acmeLib = async () => (await import('acme-client')).default;   // loaded the first time a certificate is made, not at every start
const LOCAL_URL = process.env.CASATORCH_LOCAL_URL || 'https://casatorch.com/api/local';
const ACME_URL = process.env.CASATORCH_ACME_URL || 'https://acme-v02.api.letsencrypt.org/directory';   // acme-client's directory.letsencrypt.production
/* A Let's Encrypt production account address (what casatorch.com accepts for the CAA record), and nothing else. */
const LE_ACCOUNT = /^https:\/\/acme-v02\.api\.letsencrypt\.org\/acme\/acct\/[1-9][0-9]{0,19}$/;
const ltAccountUriOk = (u) => typeof u === 'string' && LE_ACCOUNT.test(u);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const TLS_DIR = path.join(DATA_DIR, 'tls');
const lt = { state: 'off', why: null, server: null, expires: null, busy: false, fails: 0, nextTry: 0 };
const LT_STATE = path.join(TLS_DIR, 'state.json');
function ltConf() {
  try { const c = JSON.parse(fs.readFileSync(LT_STATE, 'utf8')); if (c.secret && SEALED.test(c.secret)) c.secret = unseal(c.secret) || ''; return c; } catch { /* none yet */ }
  if (config.localTls) { const c = config.localTls; ltSaveConf(c); const { localTls: _moved, ...rest } = config; try { saveConfig(rest); } catch { /* fine */ } return c; }   // kept in config.json before 0.4.1
  return null;
}
function ltSaveConf(c) { fs.mkdirSync(TLS_DIR, { recursive: true, mode: 0o700 }); writeFileSafe(LT_STATE, JSON.stringify({ ...c, secret: c.secret ? seal(c.secret) : c.secret }, null, 2), 0o600); }   // the name's secret is sealed on disk
const ltPrivate = (ip) => { const m = String(ip || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); if (!m) return false; const [a, b, c, d] = m.slice(1).map(Number); if ([a, b, c, d].some((x) => x > 255)) return false; return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); };
const ltUrl = (host) => `https://${host}${HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`}`;
async function ltCall(method, body) {
  const r = await fetch(LOCAL_URL, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `casatorch.com answered ${r.status}`);
  return j;
}
/** A private key from the tls folder: sealed on disk (an older plain one is read and sealed on the spot). Throws when
    it's sealed with another box's key (a backup restored elsewhere): then a new one is made. */
function ltReadKey(file, field) {
  const raw = fs.readFileSync(file, 'utf8'), t = raw.trim();
  if (SEALED.test(t)) { const k = unseal(t, field); if (k == null) throw new Error('the saved key does not open on this box'); return k; }
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) throw new Error('not a private key');
  writeFileSafe(file, seal(raw, field), 0o600);
  return raw;
}
const ltWriteKey = (file, pem, field) => writeFileSafe(file, seal(String(pem), field), 0o600);
function ltFiles() { try { return { key: ltReadKey(path.join(TLS_DIR, 'key.pem'), 'tls.key'), cert: fs.readFileSync(path.join(TLS_DIR, 'cert.pem')) }; } catch { return null; } }
const certInfo = (pem) => { try { const x = new crypto.X509Certificate(pem); return { until: new Date(x.validTo), names: String(x.subjectAltName || '') }; } catch { return null; } };

/** The ACME client with this box's account key (made the first time; one that doesn't open here means a new account). */
async function ltAccountClient() {
  fs.mkdirSync(TLS_DIR, { recursive: true, mode: 0o700 });
  const accPath = path.join(TLS_DIR, 'account.pem');
  let accountKey = null; try { accountKey = fs.existsSync(accPath) ? Buffer.from(ltReadKey(accPath, 'tls.account')) : null; } catch { accountKey = null; }
  const acme = await acmeLib();
  if (!accountKey) { accountKey = await acme.crypto.createPrivateKey(); ltWriteKey(accPath, accountKey, 'tls.account'); }
  return { acme, client: new acme.Client({ directoryUrl: ACME_URL, accountKey }) };
}
/** This box's Let's Encrypt account address (registering the account if it's new), or null when there isn't a
    production one to give (another ACME server, or Let's Encrypt can't be reached right now). */
async function ltAccountUriLive(client) {
  try {
    client ||= (await ltAccountClient()).client;
    await Promise.race([client.createAccount({ termsOfServiceAgreed: true }), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 20_000).unref?.())]);
    const u = client.getAccountUrl(); return ltAccountUriOk(u) ? u : null;
  } catch { return null; }
}
/** What to ask casatorch.com for the name: its account goes along only when it's one casatorch.com can put in CAA. */
const ltNameRequest = ({ id, ip, accountUri }) => ({ id, ip, ...(ltAccountUriOk(accountUri) ? { accountUri } : {}) });
/** Before a certificate is asked for: the CAA record must name this account. The PUT to send, or null when it already does
    (or there's no account to name). The address goes along so an older casatorch.com just sees an address update. */
const ltCaaUpdate = (c, accountUri) => (c?.secret && ltAccountUriOk(accountUri) && c.caaUri !== accountUri ? { id: c.id, secret: c.secret, ...(c.ip ? { ip: c.ip } : {}), accountUri } : null);
/* Swapped by the unit tests (no Let's Encrypt there). */
const ltHooks = { accountUri: ltAccountUriLive, issue: (o) => ltIssue(o) };

/* Get (or renew) the certificate. Let's Encrypt asks for a value in DNS; casatorch.com puts it there for us. */
async function ltIssue({ now = false } = {}) {
  const c = ltConf(); if (!c?.hostname || lt.busy) return;
  if (!now && Date.now() < lt.nextTry) return;   // after a failure: wait 1, 2, 4... up to 24 hours

  lt.busy = true; lt.state = lt.server ? lt.state : 'certificate'; lt.why = null;
  try {
    const { acme, client } = await ltAccountClient();
    // the CAA record first: a name bound to an older account (or to none yet) is bound to this one before the order
    const caa = ltCaaUpdate(c, await ltHooks.accountUri(client));
    if (caa) { try { const j = await ltCall('PUT', caa); if (j.caa) ltSaveConf({ ...ltConf(), caaUri: caa.accountUri }); } catch (e) { console.warn(`Secure address at home: couldn't bind the name to this box's certificate account (${e.message})`); } }
    const [key, csr] = await acme.crypto.createCsr({ commonName: c.hostname, altNames: [c.hostname] });
    const cert = await client.auto({
      csr, termsOfServiceAgreed: true, challengePriority: ['dns-01'], skipChallengeVerification: true,
      challengeCreateFn: async (_authz, _challenge, value) => { await ltCall('PATCH', { id: c.id, secret: c.secret, txt: value }); await new Promise((ok) => setTimeout(ok, 20_000)); },   // give DNS a moment
      challengeRemoveFn: async () => { await ltCall('PATCH', { id: c.id, secret: c.secret, txt: null }).catch(() => {}); },
    });
    ltWriteKey(path.join(TLS_DIR, 'key.pem'), key, 'tls.key'); writeFileSafe(path.join(TLS_DIR, 'cert.pem'), cert, 0o600);
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
  // A key that doesn't match its certificate throws here; that must not take CasaTorch down (it gets a new one).
  if (lt.server) { try { lt.server.setSecureContext(files); } catch (e) { lt.state = 'error'; lt.why = `The certificate couldn't be used: ${e.message}`; return; } lt.state = 'ready'; LOCAL_TLS.url = ltUrl(c.hostname); return; }
  let srv; try { srv = https.createServer({ ...files, minVersion: 'TLSv1.2' }, app); } catch (e) { lt.state = 'error'; lt.why = `The certificate couldn't be used: ${e.message}`; return; }
  srv.on('upgrade', camUpgrade);   // live camera video over a WebSocket (29g-camlive.js)
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
  let j, accountUri = null;
  try {
    accountUri = await ltHooks.accountUri();   // the Let's Encrypt account first, so the name is bound to it from the start (CAA)
    j = await ltCall('POST', ltNameRequest({ id, ip, accountUri }));
  } finally { lt.enabling = false; }
  ltSaveConf({ on: true, id, hostname: j.hostname, secret: j.secret, ip, ipAuto: !ipIn, ...(j.caa === true && accountUri ? { caaUri: accountUri } : {}) });
  lt.state = 'certificate'; ltHooks.issue({ now: true });   // about a minute
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
    ip: c.ip || null, detected: ltAddress(), port: HTTPS_PORT, demo: isDemo(), find: findOn() });
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
/** The secure address at home off: its name (and CAA record) deleted at casatorch.com, the certificate deleted here. */
async function ltOffNow() {
  const c = ltConf() || {};
  ltStop(); lt.expires = null; lt.why = null;
  let gone = false;
  if (c.secret) gone = await ltCall('DELETE', { id: c.id, secret: c.secret }).then(() => true, () => false);
  for (const f of ['key.pem', 'cert.pem']) fs.rmSync(path.join(TLS_DIR, f), { force: true });
  ltSaveConf({ on: false, optOut: true, id: c.id });   // stays off until turned on again
  return { had: !!c.secret, gone };
}
app.post('/api/local-https/off', requireRole('admin'), async (_req, res) => { await ltOffNow(); res.json({ ok: true }); });
if (process.env.CASATORCH_TEST !== '1') {
  setTimeout(ltAuto, 3000).unref?.();
  setInterval(ltAuto, 3600_000).unref?.();
  setInterval(ltCheck, 12 * 3600_000).unref?.();
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchTls = { ltReadKey, ltWriteKey, ltFiles, TLS_DIR, ltAccountUriOk, ltNameRequest, ltCaaUpdate, ltEnable, ltConf, ltHooks, LT_STATE };
