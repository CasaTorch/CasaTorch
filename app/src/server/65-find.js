/* ======================================================================
 * Find my CasaTorch. Every 20 minutes CasaTorch tells casatorch.com the
 * address it has on your home network (for example http://192.168.1.50:8090),
 * with a random id and its version - no names, nothing about your home.
 * casatorch.com keeps it for an hour and shows it only to browsers coming
 * from the same home internet connection, at casatorch.com/find. That is
 * the fallback when http://casatorch.local:8090 doesn't open.
 * Settings > Updates > "Help me find this CasaTorch" turns it off.
 * ====================================================================== */
const FIND_URL = new URL(process.env.CASATORCH_FIND_URL || 'https://casatorch.com/api/find');
const findOn = () => config.find?.announce !== false;
function lanAddress() {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).map((a) => ({ name, ...a })))
    .filter((a) => a.family === 'IPv4' && !a.internal && !/^(docker|br-|veth|virbr|vEthernet|utun|tun|tailscale|zt|wg)/i.test(a.name));
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 9);
  return all.map((a) => a.address).filter((ip) => rank(ip) < 9).sort((a, b) => rank(a) - rank(b))[0] || null;
}
function installId() {
  if (config.installId) return config.installId;
  const id = crypto.randomBytes(9).toString('base64url');
  try { saveConfig({ ...config, installId: id }); } catch { /* read-only: a new id next start */ }
  return id;
}
/* Sent over IPv4 and IPv6 separately, so a phone that reaches casatorch.com either way finds it. */
const postFamily = (body, family) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const req = https.request({ hostname: FIND_URL.hostname, port: FIND_URL.port || 443, path: FIND_URL.pathname, method: 'POST', family, timeout: 8000,
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
setTimeout(() => announce().catch(() => {}), 20_000).unref?.();
setInterval(() => announce().catch(() => {}), 20 * 60_000).unref?.();
app.get('/api/find', (_req, res) => res.json({ announce: findOn(), address: lanAddress() ? `http://${lanAddress()}:${PORT}` : null }));
app.post('/api/find', requireRole('admin'), express.json(), (req, res) => {
  saveConfig({ ...config, find: { announce: !!req.body?.announce } });
  if (req.body?.announce) announce().catch(() => {});
  res.json({ announce: findOn() });
});
