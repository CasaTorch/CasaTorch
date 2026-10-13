/* ======================================================================
 * Internet - what every home gets, with no router access: public IP, the
 * internet provider and city (ipinfo.io), latency to the router and two
 * public DNS services (a TCP connect, no special rights needed), a speed test
 * against Cloudflare's test servers, and the devices this machine can see on
 * the local network (its ARP table, Linux). A UniFi/Meraki key adds the rest.
 * ====================================================================== */
import net from 'node:net';
import os from 'node:os';
const tcpMs = (host, port = 443, timeout = 3000) => new Promise((ok) => {
  const t0 = process.hrtime.bigint(); const s = net.connect({ host, port, timeout });
  const end = (v) => { s.destroy(); ok(v); };
  s.on('connect', () => end(Number(process.hrtime.bigint() - t0) / 1e6)); s.on('timeout', () => end(null)); s.on('error', () => end(null));
});
function gatewayIp() {
  try {   // Linux: the default route
    for (const l of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const f = l.trim().split(/\s+/); if (f[1] === '00000000' && f[2]) { const h = f[2]; return [6, 4, 2, 0].map((i) => parseInt(h.slice(i, i + 2), 16)).join('.'); }
    }
  } catch { /* not Linux */ }
  return null;
}
function lanDevices() {
  try { return fs.readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1).filter((l) => /\s0x2\s/.test(l)).length; } catch { return null; }
}
const speed = { last: null, running: false };
async function speedTest() {
  if (speed.running) return speed.last;
  speed.running = true;
  try {
    const t0 = Date.now(); const r = await fetch('https://speed.cloudflare.com/__down?bytes=25000000', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
    const down = (await r.arrayBuffer()).byteLength; const dSec = (Date.now() - t0) / 1000;
    const body = Buffer.alloc(8_000_000); const t1 = Date.now();
    await fetch('https://speed.cloudflare.com/__up', { method: 'POST', body, headers: { 'User-Agent': UA, 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(60000) });
    const uSec = (Date.now() - t1) / 1000;
    speed.last = { at: nowIso(), downMbps: Math.round((down * 8) / dSec / 1e5) / 10, upMbps: Math.round((body.length * 8) / uSec / 1e5) / 10 };
  } catch (err) { speed.last = { at: nowIso(), error: String(err.message) }; }
  finally { speed.running = false; }
  return speed.last;
}
if (config.network?.speedtest !== false) setInterval(() => { if (isConfigured() && !isDemo()) speedTest().catch(() => {}); }, 4 * 3600_000).unref?.();
async function internetNow() {
  const gw = gatewayIp();
  const [ipinfo, cf, google, router] = await Promise.all([
    cached('ipinfo', 30 * 60_000, () => getJSON('https://ipinfo.io/json')).catch((e) => ({ error: String(e.message) })),
    tcpMs('1.1.1.1'), tcpMs('8.8.8.8'), gw ? tcpMs(gw, 80, 1500) : Promise.resolve(null),
  ]);
  const online = cf != null || google != null;
  return {
    online, publicIp: ipinfo.ip || null, provider: ipinfo.org ? ipinfo.org.replace(/^AS\d+\s+/, '') : null, city: [ipinfo.city, ipinfo.region].filter(Boolean).join(', ') || null,
    latencyMs: { cloudflare: cf && Math.round(cf), google: google && Math.round(google), router: router && Math.round(router) }, gateway: gw,
    lanDevices: lanDevices(), host: os.hostname(), speed: speed.last,
  };
}
app.get('/api/internet', async (_req, res) => { if (isDemo()) return res.json(demoFixture('internet')); try { res.json(await internetNow()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
app.post('/api/internet/speedtest', async (_req, res) => res.json(await speedTest()));
