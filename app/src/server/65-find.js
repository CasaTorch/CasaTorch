/* ======================================================================
 * Find my CasaTorch. Every 10 minutes CasaTorch tells casatorch.com the
 * address it has on your home network (for example http://192.168.1.50:8090),
 * with a random id and its version - no names, nothing about your home.
 * casatorch.com keeps it for 30 minutes and shows it only to browsers coming
 * from the same home internet connection, at casatorch.com/home and /find.
 * When CasaTorch shuts down it takes the entry back straight away, so the
 * page never sends anyone to a CasaTorch that's switched off.
 * Settings › Updates & backup › "Help me find this CasaTorch" turns it off.
 * ====================================================================== */
const FIND_URL = new URL(process.env.CASATORCH_FIND_URL || 'https://casatorch.com/api/find');
const findOn = () => config.find?.announce !== false;
function lanAddress() {
  const fixed = String(process.env.CASATORCH_LAN_IP || '').trim(); if (/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(\.\d+)?$/.test(fixed)) return fixed;   // Docker with port mapping
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).map((a) => ({ name, ...a })))
    .filter((a) => a.family === 'IPv4' && !a.internal && !/^(docker|br-|veth|virbr|vEthernet|utun|tun|tailscale|zt|wg)/i.test(a.name));
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 9);
  return all.map((a) => a.address).filter((ip) => rank(ip) < 9).sort((a, b) => rank(a) - rank(b))[0] || null;
}
/* A random id for this CasaTorch (Find my CasaTorch, secure access). Kept in its own file, not config.json:
   writing config.json before setup would make CasaTorch look set up and skip the setup wizard. */
const INSTALL_ID_FILE = path.join(DATA_DIR, 'install-id');
let installIdMemo = null;
function installId() {
  if (installIdMemo) return installIdMemo;
  try { const v = fs.readFileSync(INSTALL_ID_FILE, 'utf8').trim(); if (/^[A-Za-z0-9_-]{8,40}$/.test(v)) return (installIdMemo = v); } catch { /* none yet */ }
  const id = config.installId || crypto.randomBytes(9).toString('base64url');   // kept in config.json before 0.4.2
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileSafe(INSTALL_ID_FILE, id, 0o600); } catch { /* read-only: a new id next start */ }
  return (installIdMemo = id);
}
/* Sent over IPv4 and IPv6 separately, so a phone that reaches casatorch.com either way finds it. */
const postFamily = (body, family, method = 'POST', timeout = 8000) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const req = https.request({ hostname: FIND_URL.hostname, port: FIND_URL.port || 443, path: FIND_URL.pathname, method, family, timeout,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': UA } }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
  req.end(data);
});
async function announce() {
  if (isDemo() || !findOn() || process.env.CASATORCH_TEST === '1') return;
  const ip = lanAddress(); if (!ip) return;
  const body = { id: installId(), url: `http://${ip}:${PORT}`, version: VERSION, setup: !isConfigured() };
  await Promise.all([postFamily(body, 4), postFamily(body, 6)]);
}
setTimeout(() => announce().catch(() => {}), 5_000).unref?.();
setInterval(() => announce().catch(() => {}), 10 * 60_000).unref?.();
/* Shutting down (Stop, an update, the computer going off): take the entry back first - a few seconds at most. */
let findLeaving = false;
async function findWithdraw(sig) {
  if (findLeaving) return; findLeaving = true;
  if (!isDemo() && findOn() && process.env.CASATORCH_TEST !== '1' && installIdMemo) {   // only if it announced
    const body = { id: installIdMemo };
    await Promise.race([Promise.all([postFamily(body, 4, 'DELETE', 3000), postFamily(body, 6, 'DELETE', 3000)]), new Promise((ok) => setTimeout(ok, 3500))]);
  }
  process.exit(sig === 'SIGINT' ? 130 : 0);
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { findWithdraw(sig); });
app.get('/api/find', (_req, res) => res.json({ announce: findOn(), address: lanAddress() ? `http://${lanAddress()}:${PORT}` : null }));
app.post('/api/find', requireRole('admin'), express.json(), (req, res) => {
  saveConfig({ ...config, find: { announce: !!req.body?.announce } });
  if (req.body?.announce) announce().catch(() => {});
  else for (const f of [4, 6]) postFamily({ id: installId() }, f, 'DELETE');   // off: gone from the page now
  res.json({ announce: findOn() });
});
