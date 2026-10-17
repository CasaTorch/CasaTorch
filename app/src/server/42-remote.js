/* ======================================================================
 * Secure access: CasaTorch at its own https address (home-xxxxxxxx.casatorch.com).
 *
 * Why: phones only allow installing a web app and getting its alerts from
 * an https address, and http://casatorch.local:8090 isn't one. This gives
 * every home a real certificate without touching the router: CasaTorch runs
 * Cloudflare's small "cloudflared" program, which keeps an outbound
 * connection open; requests to the address come down that connection.
 *
 * Who gets in: everyone still signs in to CasaTorch as usual. On Basic the
 * address only works from your own home internet connection (phones on your
 * Wi-Fi); with Pro it works from anywhere.
 *
 * cloudflared is downloaded from Cloudflare's GitHub releases the first time,
 * checked against the exact SHA-256 below, and kept in CasaTorch's data folder.
 * ====================================================================== */
import { spawn, execFile } from 'node:child_process';

const REMOTE_URL = process.env.CASATORCH_REMOTE_URL || 'https://casatorch.com/api/remote';
const CFD_VERSION = '2026.10.0';
const CFD_FILES = {
  'linux-x64': ['cloudflared-linux-amd64', 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db'],
  'linux-arm64': ['cloudflared-linux-arm64', 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08'],
  'linux-arm': ['cloudflared-linux-arm', '1dbe8e4ec17e74bb7f49cf91db6a4903bd0f9fe41984556c7503e40b765fd099'],
  'darwin-arm64': ['cloudflared-darwin-arm64.tgz', 'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70'],
  'darwin-x64': ['cloudflared-darwin-amd64.tgz', '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f'],
  'win32-x64': ['cloudflared-windows-amd64.exe', '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'],
};
const BIN_DIR = path.join(DATA_DIR, 'bin'), BIN = path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const remote = { state: 'off', why: null, proc: null, since: null, restarts: 0, homeIps: { v4: null, v6: null, at: 0 } };

async function ensureCloudflared() {
  if (fs.existsSync(BIN) && fs.readFileSync(path.join(BIN_DIR, 'VERSION'), 'utf8').trim() === CFD_VERSION) return BIN;
  const f = CFD_FILES[`${process.platform}-${process.arch}`];
  if (!f) throw new Error(`secure access isn't available on this kind of computer (${process.platform}/${process.arch})`);
  fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
  remote.state = 'downloading';
  const r = await fetch(`https://github.com/cloudflare/cloudflared/releases/download/${CFD_VERSION}/${f[0]}`, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`couldn't download the secure-access helper (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (crypto.createHash('sha256').update(buf).digest('hex') !== f[1]) throw new Error('the secure-access helper failed its safety check - nothing was installed');
  if (f[0].endsWith('.tgz')) {
    const tgz = path.join(BIN_DIR, 'cloudflared.tgz'); fs.writeFileSync(tgz, buf);
    await new Promise((ok, bad) => execFile('tar', ['-xzf', tgz, '-C', BIN_DIR], (e) => (e ? bad(e) : ok())));
    fs.rmSync(tgz, { force: true });
  } else fs.writeFileSync(BIN, buf);
  fs.chmodSync(BIN, 0o755);
  fs.writeFileSync(path.join(BIN_DIR, 'VERSION'), CFD_VERSION);
  return BIN;
}

function startTunnel() {
  const token = config.remote?.token; if (!token || remote.proc) return;
  remote.state = 'connecting'; remote.why = null;
  const p = spawn(BIN, ['tunnel', '--no-autoupdate', 'run'], { env: { ...process.env, TUNNEL_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  remote.proc = p;
  const read = (d) => {
    const t = String(d);
    if (/Registered tunnel connection|Connection [\w-]+ registered/i.test(t)) { remote.state = 'connected'; remote.since ||= nowIso(); remote.restarts = 0; }
    else if (/Unauthorized|invalid token|tunnel not found/i.test(t)) { remote.state = 'error'; remote.why = 'casatorch.com no longer knows this address - turn secure access off and on again'; }
  };
  p.stdout.on('data', read); p.stderr.on('data', read);
  p.on('exit', () => {
    remote.proc = null; remote.since = null;
    if (!config.remote?.on) { remote.state = 'off'; return; }
    if (remote.state !== 'error') remote.state = 'connecting';
    const wait = Math.min(60_000, 2_000 * 2 ** Math.min(5, remote.restarts++));
    setTimeout(() => { if (config.remote?.on && !remote.proc) startTunnel(); }, wait).unref?.();
  });
}
function stopTunnel() { const p = remote.proc; remote.proc = null; if (p) try { p.kill(); } catch { /* gone */ } remote.state = 'off'; }

/* This home's public internet addresses (IPv4, and the IPv6 network), for the Basic "only at home" rule. */
async function homeIps() {
  if (Date.now() - remote.homeIps.at < 10 * 60_000) return remote.homeIps;
  const trace = async (u) => { try { const t = await (await fetch(u, { signal: AbortSignal.timeout(5000) })).text(); return (t.match(/^ip=(.+)$/m) || [])[1] || null; } catch { return null; } };
  const [v4, v6] = await Promise.all([trace('https://1.1.1.1/cdn-cgi/trace'), trace('https://[2606:4700:4700::1111]/cdn-cgi/trace')]);
  remote.homeIps = { v4: v4 || remote.homeIps.v4, v6: v6 || remote.homeIps.v6, at: Date.now() };
  return remote.homeIps;
}
const v6net = (ip) => String(ip || '').toLowerCase().split(':').slice(0, 4).join(':');   // the /64 a home's devices share
async function fromHome(ip) {
  const h = await homeIps();
  return ip.includes(':') ? !!h.v6 && v6net(ip) === v6net(h.v6) : ip === h.v4;
}
/* ---- Settings > Secure access ---- */
app.get('/api/remote', async (_req, res) => {
  const r = config.remote || {};
  res.json({ on: !!r.on, hostname: r.hostname || null, url: r.hostname ? `https://${r.hostname}` : null, state: r.on ? remote.state : 'off', why: remote.why, since: remote.since,
    anywhere: !!proStatus().pro, qr: r.hostname ? await QRCode.toString(`https://${r.hostname}`, { type: 'svg', margin: 1 }) : null, supported: !!CFD_FILES[`${process.platform}-${process.arch}`] });
});
/** Turn secure access on: this home's address and tunnel from casatorch.com, then the tunnel itself. */
async function remoteOn() {
  {
    await ensureCloudflared();
    const body = { id: installId(), name: config.house?.name || null, port: Number(PORT) || 8090, ...(config.remote?.secret ? { secret: config.remote.secret } : {}) };
    const r = await fetch(REMOTE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `casatorch.com answered ${r.status}`);
    stopTunnel();
    saveConfig({ ...config, remote: { on: true, hostname: j.hostname, token: j.token, secret: j.secret } });
    startTunnel();
    return j.hostname;
  }
}
app.post('/api/remote/on', requireRole('admin'), async (_req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  try { res.json({ ok: true, hostname: await remoteOn() }); }
  catch (err) { remote.state = 'error'; remote.why = String(err.message); res.status(502).json({ error: String(err.message) }); }
});
app.post('/api/remote/off', requireRole('admin'), async (_req, res) => {
  const r = config.remote || {};
  stopTunnel();
  if (r.secret) await fetch(REMOTE_URL, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: installId(), secret: r.secret }), signal: AbortSignal.timeout(20_000) }).catch(() => {});
  const { remote: _gone, ...rest } = config; saveConfig(rest);
  res.json({ ok: true });
});
setTimeout(async () => { if (config.remote?.on && !isDemo()) { try { await ensureCloudflared(); startTunnel(); } catch (e) { remote.state = 'error'; remote.why = String(e.message); } } }, 3000).unref?.();
process.on('exit', () => { try { remote.proc?.kill(); } catch { /* gone */ } });
