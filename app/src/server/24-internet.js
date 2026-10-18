/* ======================================================================
 * Internet - what every home gets, with no router access: public IP and
 * country (Cloudflare's trace page), the internet provider (RIPEstat, the RIPE
 * NCC's free public data API: which network owns that address - no key, no
 * account, asked at most every 6 hours), latency to the router and two
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
setInterval(() => { if (isConfigured() && !isDemo() && config.network?.speedtest !== false) speedTest().catch(() => {}); }, 4 * 3600_000).unref?.();   // the setting is read each time, so a change works without a restart
/* Public address, country and provider. ipinfo.io's token-less API (used before 0.8.1) is IPinfo's "legacy" tier;
   its current free tier needs a per-user token, so CasaTorch now uses sources that need none: Cloudflare's trace
   page (address and country, every 30 minutes) and RIPEstat (the network that owns the address, cached 6 hours per
   address). Credit: "Provider data: RIPEstat (RIPE NCC)". */
const ISP_CREDIT = { text: 'Provider data: RIPEstat (RIPE NCC)', href: 'https://stat.ripe.net/' };
async function ispInfo() {
  const tr = await cached('cftrace', 30 * 60_000, async () => { const t = (await getText('https://1.1.1.1/cdn-cgi/trace', { timeout: 6000 })).text; const g = (k) => (t.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1] || null; return { ip: g('ip'), loc: g('loc') }; });
  const ip = tr?.ip && /^[0-9a-f:.]{3,45}$/i.test(tr.ip) ? tr.ip : null;
  let country = null; try { country = tr?.loc && /^[A-Z]{2}$/.test(tr.loc) && tr.loc !== 'XX' ? new Intl.DisplayNames(['en'], { type: 'region' }).of(tr.loc) : null; } catch { /* no ICU data */ }
  let asn = null, provider = null;
  if (ip) {
    const o = await cached(`isp:${ip}`, 6 * 3600_000, async () => {
      const ni = await getJSON(`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}&sourceapp=casatorch`, { timeout: 8000 });
      const a = Number(ni?.data?.asns?.[0]) || null; if (!a) return { asn: null, name: null };
      const ov = await getJSON(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${a}&sourceapp=casatorch`, { timeout: 8000 });
      const holder = String(ov?.data?.holder || '').trim();   // e.g. "EXAMPLE-NET - Example Internet, Inc."
      return { asn: a, name: (holder.includes(' - ') ? holder.split(' - ').slice(1).join(' - ') : holder).slice(0, 80) || null };
    }).catch(() => null);
    asn = o?.asn || null; provider = o?.name || null;
  }
  return { ip, country, asn, provider };
}
async function internetNow() {
  const gw = gatewayIp();
  const [isp, cf, google, router] = await Promise.all([
    ispInfo().catch((e) => ({ error: String(e.message) })),
    tcpMs('1.1.1.1'), tcpMs('8.8.8.8'), gw ? tcpMs(gw, 80, 1500) : Promise.resolve(null),
  ]);
  const online = cf != null || google != null;
  return {
    online, publicIp: isp.ip || null, provider: isp.provider || null, city: isp.country || null, credit: isp.provider ? ISP_CREDIT : null,
    latencyMs: { cloudflare: cf && Math.round(cf), google: google && Math.round(google), router: router && Math.round(router) }, gateway: gw,
    lanDevices: lanDevices(), host: os.hostname(), speed: speed.last,
  };
}
app.get('/api/internet', async (_req, res) => { if (isDemo()) return res.json(demoFixture('internet')); try { res.json(await internetNow()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
/* By hand: the demo shows its sample result, and a test that just ran is shown again (each one moves about 33 MB). */
app.post('/api/internet/speedtest', async (_req, res) => {
  if (isDemo()) return res.json(demoFixture('internet')?.speed || null);
  if (speed.last?.at && !speed.last.error && Date.now() - Date.parse(speed.last.at) < 60_000) return res.json(speed.last);
  res.json(await speedTest());
});
