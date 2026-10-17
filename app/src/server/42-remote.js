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
 *
 * It checks itself: once the tunnel is up, CasaTorch opens its own address
 * from the outside (out through the internet, back in through Cloudflare) with
 * a one-time code only it knows, and Settings says "Working from anywhere"
 * only when that came back. It checks again every 15 minutes and after the
 * computer wakes from sleep. When something's wrong it says exactly what, and
 * fixes what it can by itself: the download is retried, a network that blocks
 * Cloudflare's fast (QUIC/UDP) connection gets the plain one (HTTP/2 over TCP),
 * a tunnel that stopped answering is restarted, a key casatorch.com no longer
 * accepts is renewed (Repair).
 * ====================================================================== */
import { spawn, execFile } from 'node:child_process';

const REMOTE_URL = process.env.CASATORCH_REMOTE_URL || 'https://casatorch.com/api/remote';
const CFD_VERSION = '2026.10.0';
const CFD_BASE = process.env.CASATORCH_CFD_BASE || 'https://github.com/cloudflare/cloudflared/releases/download';   // tests point this at a fake
const CFD_FILES = {
  'linux-x64': ['cloudflared-linux-amd64', 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db'],
  'linux-arm64': ['cloudflared-linux-arm64', 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08'],
  'linux-arm': ['cloudflared-linux-arm', '1dbe8e4ec17e74bb7f49cf91db6a4903bd0f9fe41984556c7503e40b765fd099'],
  'darwin-arm64': ['cloudflared-darwin-arm64.tgz', 'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70'],
  'darwin-x64': ['cloudflared-darwin-amd64.tgz', '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f'],
  'win32-x64': ['cloudflared-windows-amd64.exe', '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'],
};
const BIN_DIR = path.join(DATA_DIR, 'bin'), BIN = path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
/* How long to wait before giving up on a way of connecting (shorter in the tests). */
const RT = process.env.CASATORCH_REMOTE_FAST === '1' ? { fallback: 2500, blocked: 3000, recheck: 1500, dl: 50, boot: 300 } : { fallback: 30_000, blocked: 45_000, recheck: 3000, dl: 4000, boot: 3000 };
const remote = {
  state: 'off', why: null, code: null, proc: null, since: null, restarts: 0, homeIps: { v4: null, v6: null, at: 0 },
  conns: new Set(), protocol: null, log: [], lastError: null, check: { ok: null, at: null, code: null, ms: null }, nonce: null,
  checking: null, busy: null, dnsTries: 0, kickAt: 0, repairAt: 0, timers: {},
};
const remoteSupported = () => !!CFD_FILES[`${process.platform}-${process.arch}`] || fs.existsSync(BIN);

/* ---- what went wrong, in words (and what fixes it) ---- */
const REMOTE_WHY = {
  unsupported: ['Secure access isn\'t available on this kind of computer yet.', null, null],
  download: ['Couldn\'t download the secure-access helper from Cloudflare.', 'Check this CasaTorch can reach the internet. It keeps trying by itself.', 'repair'],
  checksum: ['The secure-access helper didn\'t pass its safety check, so it wasn\'t installed.', 'That usually means the download was cut off. Try again in a few minutes.', 'repair'],
  helper: ['The secure-access helper couldn\'t start on this computer.', 'Try again. If it keeps happening, restart CasaTorch.', 'repair'],
  offline: ['This CasaTorch can\'t reach the internet right now.', 'Secure access reconnects by itself as soon as the internet is back.', 'check'],
  blocked: ['Your network blocks the connection secure access needs.', 'CasaTorch tried both ways Cloudflare offers. Allow outgoing connections on port 7844 (TCP and UDP) in your router or firewall, then check again.', 'check'],
  edgedns: ['This network can\'t look up Cloudflare\'s servers.', 'Check the DNS settings in your router (or Pi-hole / AdGuard Home), then check again.', 'check'],
  token: ['casatorch.com no longer accepts this CasaTorch\'s secure-access key.', 'Repair gets a fresh key. The address stays the same.', 'repair'],
  dns: ['The address is still being published.', 'This usually takes a minute or two after turning it on. CasaTorch checks again by itself.', 'check'],
  tunnel: ['Cloudflare can\'t reach this CasaTorch.', 'The connection dropped. CasaTorch reconnects by itself; Repair starts it fresh.', 'repair'],
  unreachable: ['The secure address didn\'t answer when CasaTorch tried it.', 'CasaTorch tries again by itself. If it stays like this, use Repair.', 'repair'],
  mismatch: ['The secure address answered, but not as this CasaTorch.', 'Repair sets the address up again for this CasaTorch.', 'repair'],
  service: ['casatorch.com couldn\'t set up the address right now.', 'Try again in a few minutes.', 'repair'],
};
const FIX_LABEL = { repair: 'Repair', check: 'Check again' };
/** Settings › Secure access, in plain words: { status, title, detail, fix } - from the state alone (no clock, no I/O), for the unit tests. */
function remoteView({ on, state, code, check, anywhere, why }) {
  if (!on) return { status: 'off', title: 'Off', detail: null, fix: null };
  if (code && REMOTE_WHY[code]) {
    const [title, detail, fix] = REMOTE_WHY[code];
    return { status: code === 'dns' ? 'checking' : 'problem', code, title, detail: code === 'service' && why ? `${why}. ${detail}` : detail, fix: fix ? { action: fix, label: FIX_LABEL[fix] } : null };
  }
  if (state === 'error') return { status: 'problem', code: 'other', title: why || 'Not working', detail: 'Repair sets it up again. The address stays the same.', fix: { action: 'repair', label: FIX_LABEL.repair } };
  if (state === 'downloading') return { status: 'starting', title: 'Getting ready…', detail: 'Downloading the secure-access helper (once, about 20 MB).', fix: null };
  if (state === 'connecting') return check?.ok ? { status: 'starting', title: 'Reconnecting…', detail: 'The connection to Cloudflare dropped; it comes back by itself.', fix: null } : { status: 'starting', title: 'Connecting…', detail: null, fix: null };
  if (state === 'connected' && check?.ok) return { status: 'working', title: anywhere ? 'Working from anywhere' : 'Working on your home Wi-Fi', detail: anywhere ? null : 'Using it from anywhere is part of Pro.', fix: null };
  if (state === 'connected') return { status: 'checking', title: 'Checking it works from outside…', detail: 'CasaTorch is opening its own address through the internet.', fix: null };
  return { status: 'starting', title: 'Starting…', detail: null, fix: null };
}
/** What the self-test's answer means (no I/O, for the unit tests). */
function remoteCheckResult({ error, status, json, nonce, homeId }) {
  if (error) {
    const c = String(error.cause?.code || error.code || ''), m = String(error.cause?.message || error.message || '');
    if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME/.test(c) || /getaddrinfo/.test(m)) return { ok: false, code: 'dns' };
    if (/CERT|SSL|TLS|ERR_TLS/i.test(c)) return { ok: false, code: 'dns' };   // the certificate for a brand-new name can lag a moment behind its DNS
    return { ok: false, code: 'unreachable' };
  }
  if ([502, 503, 504, 530].includes(status)) return { ok: false, code: 'tunnel' };   // Cloudflare is there, the tunnel isn't (error 1033)
  if (status === 200 && json?.casatorch === true && json.home?.id === homeId && nonce && json.check === nonce) return { ok: true, code: 'ok' };
  if (status === 200 && json?.casatorch === true) return { ok: false, code: 'mismatch' };
  return { ok: false, code: 'unreachable' };
}
/** One line from cloudflared: what it says about the connection (no I/O, for the unit tests). */
function remoteLineKind(t) {
  if (/Unauthorized|invalid token|tunnel not found|Invalid tunnel secret|token is not valid|tunnel credentials.*(invalid|not)/i.test(t)) return 'token';
  if (/Unregistered tunnel connection|Connection terminated|connection.*(lost|closed).*connIndex/i.test(t)) return 'dropped';   // before "registered": it's in "Unregistered"
  if (/\bRegistered tunnel connection|Connection [\w-]+ registered/i.test(t)) return 'registered';
  if (/edge discovery|lookup .*argotunnel|SRV record/i.test(t)) return 'edgedns';
  if (/quic/i.test(t) && /(fail|timeout|timed out|no recent network activity|error)/i.test(t)) return 'quic';
  if (/7844|Unable to establish connection|dial tcp|i\/o timeout|connection refused/i.test(t) && /(ERR|error|fail|timeout|refused)/i.test(t)) return 'dial';
  return null;
}
const connIndexOf = (t) => (t.match(/connIndex=(\d+)/) || [])[1] ?? '0';
const remoteMask = (t) => { const tok = config.remote?.token; let s = String(t); if (tok) s = s.split(tok).join('***'); return logMask(s).replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, 'x.x.x.x').slice(0, 300); };
function remoteProblem(code, raw) {
  remote.code = code; remote.why = REMOTE_WHY[code]?.[0] || String(raw || code);
  remote.lastError = { at: nowIso(), code, text: remoteMask(raw || remote.why) };
  if (code !== 'dns') console.warn(`Secure access: ${remote.why}${raw ? ` (${remoteMask(raw)})` : ''}`);
}
const remoteClear = (...codes) => { if (!codes.length || codes.includes(remote.code)) { remote.code = null; remote.why = null; } };
const later = (name, ms, fn) => { clearTimeout(remote.timers[name]); remote.timers[name] = setTimeout(fn, ms); remote.timers[name].unref?.(); };

/* ---- the helper ---- */
async function ensureCloudflared() {
  try { if (fs.existsSync(BIN) && fs.readFileSync(path.join(BIN_DIR, 'VERSION'), 'utf8').trim() === CFD_VERSION) return BIN; } catch { /* no VERSION file: download again */ }
  const f = CFD_FILES[`${process.platform}-${process.arch}`];
  if (!f) throw Object.assign(new Error(`secure access isn't available on this kind of computer (${process.platform}/${process.arch})`), { code: 'unsupported' });
  fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
  remote.state = 'downloading';
  let buf = null, last = null;
  for (let i = 0; i < 3 && !buf; i++) {   // a blip on the way is tried again: after 4 and 16 seconds
    if (i) await sleep(RT.dl * 4 ** (i - 1));
    try {
      const r = await fetch(`${CFD_BASE}/${CFD_VERSION}/${f[0]}`, { signal: AbortSignal.timeout(180_000) });
      if (!r.ok) { last = new Error(`couldn't download the secure-access helper (${r.status})`); if (r.status < 500 && r.status !== 429) break; continue; }
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; }
  }
  if (!buf) throw Object.assign(new Error(`couldn't download the secure-access helper (${last?.cause?.code || last?.message || 'no answer'})`), { code: 'download' });
  if (crypto.createHash('sha256').update(buf).digest('hex') !== f[1]) throw Object.assign(new Error('the secure-access helper failed its safety check - nothing was installed'), { code: 'checksum' });
  if (f[0].endsWith('.tgz')) {
    const tgz = path.join(BIN_DIR, 'cloudflared.tgz'); fs.writeFileSync(tgz, buf);
    await new Promise((ok, bad) => execFile('tar', ['-xzf', tgz, '-C', BIN_DIR], (e) => (e ? bad(e) : ok())));
    fs.rmSync(tgz, { force: true });
  } else fs.writeFileSync(BIN, buf);
  fs.chmodSync(BIN, 0o755);
  fs.writeFileSync(path.join(BIN_DIR, 'VERSION'), CFD_VERSION);
  return BIN;
}

/* ---- the tunnel ---- */
function startTunnel() {
  const token = config.remote?.token; if (!token || remote.proc) return;
  const proto = config.remote?.protocol === 'http2' ? 'http2' : null;
  remote.state = 'connecting'; remote.conns.clear(); remote.protocol = proto || 'auto';
  const seen = { quic: 0, dial: 0, edgedns: 0 };
  let p;
  try { p = spawn(BIN, ['tunnel', '--no-autoupdate', ...(proto ? ['--protocol', proto] : []), 'run'], { env: { ...process.env, TUNNEL_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
  catch (e) { remoteProblem('helper', e.message); remote.state = 'error'; return; }
  remote.proc = p;
  let buf = '';
  const line = (t) => {
    if (!t.trim()) return;
    remote.log.push(`${nowIso().slice(11, 19)} ${remoteMask(t)}`); if (remote.log.length > 40) remote.log.splice(0, remote.log.length - 40);
    const k = remoteLineKind(t);
    if (k === 'registered') {
      const first = !remote.conns.size; remote.conns.add(connIndexOf(t));
      remote.state = 'connected'; remote.since ||= nowIso(); remote.restarts = 0;
      remoteClear('blocked', 'edgedns', 'offline', 'tunnel', 'helper', 'download', 'checksum');
      if (first) later('check', RT.recheck, () => remoteCheck('connected').catch(() => {}));
    } else if (k === 'dropped') {
      remote.conns.delete(connIndexOf(t));
      if (!remote.conns.size && remote.state === 'connected') remote.state = 'connecting';
    } else if (k === 'token') { remoteProblem('token', t); remote.state = 'error'; p.stopped = true; try { p.kill(); } catch { /* gone */ } remoteAutoRepair(); }
    else if (k) { seen[k]++; if (k !== 'quic') remote.lastError = { at: nowIso(), code: k, text: remoteMask(t) }; }
  };
  const read = (d) => { buf += String(d); const parts = buf.split(/\r?\n/); buf = parts.pop(); for (const t of parts) line(t); if (buf.length > 4000) { line(buf); buf = ''; } };
  p.stdout.on('data', read); p.stderr.on('data', read);
  /* Not connected after half a minute: the fast way (QUIC, over UDP) is often what a firewall blocks - use HTTP/2 over TCP from now on. */
  const watch = setTimeout(async () => {
    if (remote.proc !== p || remote.conns.size) return;
    if (!proto) {
      console.warn('Secure access: no connection the fast way (QUIC/UDP) - switching to HTTP/2 over TCP.');
      saveConfig({ ...config, remote: { ...config.remote, protocol: 'http2' } });
      p.kick = true; try { p.kill(); } catch { /* gone */ }
      return;
    }
    // neither way connects: the internet, Cloudflare's names, or port 7844
    const online = await fetch(new URL(REMOTE_URL).origin, { method: 'HEAD', signal: AbortSignal.timeout(6000) }).then(() => true, () => false);
    if (remote.proc !== p || remote.conns.size) return;
    remoteProblem(!online ? 'offline' : seen.edgedns ? 'edgedns' : 'blocked', remote.lastError?.text);
  }, proto ? RT.blocked : RT.fallback);
  watch.unref?.();
  let gone = false;
  const onGone = (why) => {
    if (gone) return; gone = true; clearTimeout(watch);
    if (buf) line(buf);
    if (remote.proc === p) remote.proc = null;
    remote.conns.clear(); remote.since = null;
    if (!config.remote?.on) { remote.state = 'off'; return; }
    if (p.stopped) return;   // stopped on purpose (off, repair, a key that was turned down)
    if (remote.state !== 'error') remote.state = 'connecting';
    if (why) remote.lastError = { at: nowIso(), code: 'helper', text: remoteMask(why) };
    const wait = p.kick ? 200 : Math.min(60_000, 2_000 * 2 ** Math.min(5, remote.restarts++));
    later('restart', wait, () => { if (config.remote?.on && !remote.proc && remote.code !== 'token') startTunnel(); });
  };
  p.on('error', (e) => { if (/ENOENT|EACCES|ENOEXEC/.test(e.code || '')) { remoteProblem('helper', e.message); remote.state = 'error'; } onGone(e.message); });
  p.on('close', (c, sig) => onGone(c ? `the helper stopped (${c})` : sig && !p.stopped && !p.kick ? `the helper was stopped (${sig})` : null));
}
function stopTunnel() {
  const p = remote.proc; remote.proc = null;
  if (p) { p.stopped = true; try { p.kill(); } catch { /* gone */ } }
  for (const t of Object.values(remote.timers)) clearTimeout(t);
  remote.state = 'off'; remote.conns.clear(); remote.since = null;
}
/** The tunnel looks up but doesn't answer (after sleep, say): start the helper again - at most every 5 minutes. */
function remoteKick() {
  if (!remote.proc || Date.now() - remote.kickAt < 5 * 60_000) return false;
  remote.kickAt = Date.now(); console.warn('Secure access: the address stopped answering - restarting the connection.');
  remote.proc.kick = true; try { remote.proc.kill(); } catch { /* gone */ }
  return true;
}
/** casatorch.com turned the key down: get a fresh one by itself, once an hour at most (Repair does it on demand). */
function remoteAutoRepair() {
  if (!config.remote?.secret || Date.now() - remote.repairAt < 3600_000) return;
  remote.repairAt = Date.now();
  later('repair', 1000, () => remoteOn().catch((e) => remoteFailed(e)));
}

/* ---- the self-test: open our own address from the outside ---- */
/** True for the one request CasaTorch is making to itself right now (it carries a one-time code). */
function remoteNonceOk(req) {
  const n = String(req.headers['x-casatorch-check'] || req.query?.check || ''), want = remote.nonce;
  return !!want && n.length === want.length && crypto.timingSafeEqual(Buffer.from(n), Buffer.from(want));
}
async function remoteCheck(reason = 'scheduled') {
  if (remote.checking) return remote.checking;
  remote.checking = (async () => {
    const host = config.remote?.hostname; if (!config.remote?.on || !host || isDemo()) return null;
    const nonce = crypto.randomBytes(12).toString('base64url'), base = process.env.CASATORCH_REMOTE_CHECK_BASE || `https://${host}`, t0 = Date.now();
    remote.nonce = nonce;
    let out;
    try {
      const r = await fetch(`${base}/api/app/hello?check=${nonce}`, { headers: { 'X-CasaTorch-Check': nonce, Accept: 'application/json', 'Cache-Control': 'no-cache' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      out = remoteCheckResult({ status: r.status, json: await r.json().catch(() => null), nonce, homeId: installId() });
    } catch (e) { out = remoteCheckResult({ error: e }); }
    finally { remote.nonce = null; }
    remote.check = { ok: out.ok, code: out.code, at: nowIso(), ms: Date.now() - t0, reason };
    if (out.ok) { remote.dnsTries = 0; remoteClear('dns', 'tunnel', 'unreachable', 'mismatch', 'offline'); return remote.check; }
    if (!config.remote?.on) return remote.check;
    if (out.code === 'dns') {   // a brand-new name takes a moment to reach everyone's DNS: look again after 15 s, 30 s, 1, 2, 4 minutes...
      remote.dnsTries++; remoteProblem('dns', `${host} isn't found yet`);
      later('check', Math.min(5 * 60_000, RT.recheck * 5 * 2 ** Math.min(5, remote.dnsTries - 1)), () => remoteCheck('dns').catch(() => {}));
      if (remote.dnsTries > 12) remoteProblem('unreachable', `${host} still isn't found`);
      return remote.check;
    }
    if (remote.state !== 'connected') return remote.check;   // still connecting: the connection itself says what's wrong
    if (['tunnel', 'unreachable'].includes(out.code) && remoteKick()) return remote.check;   // looked connected, wasn't: once, start it fresh
    remoteProblem(out.code, `the self-test got ${out.code}`);
    return remote.check;
  })().finally(() => { remote.checking = null; });
  return remote.checking;
}
/* Every 15 minutes, and after the computer slept (the clock jumps ahead): the tunnel's connections were cut while it slept. */
let remoteTick = Date.now();
if (process.env.CASATORCH_TEST !== '1') {
  setInterval(() => { if (config.remote?.on && !isDemo()) remoteCheck('15 min').catch(() => {}); }, 15 * 60_000).unref?.();
  setInterval(() => {
    const now = Date.now(), slept = now - remoteTick > 60_000; remoteTick = now;
    if (!slept || !config.remote?.on || isDemo()) return;
    console.log('Secure access: back from sleep - checking the connection.');
    if (!remote.proc && remote.code !== 'token') { later('restart', 500, () => { if (config.remote?.on && !remote.proc) startTunnel(); }); return; }
    later('wake', 20_000, async () => { if (!remote.conns.size) remoteKick(); else await remoteCheck('wake').catch(() => {}); });
  }, 10_000).unref?.();
}

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
async function remoteInfo(req) {
  const r = config.remote || {}, anywhere = !!proStatus().pro;
  const admin = !signInOn() || rank(req?.user?.role) >= rank('admin');
  return {
    on: !!r.on, hostname: r.hostname || null, url: r.hostname ? `https://${r.hostname}` : null, state: r.on ? remote.state : 'off', why: remote.why, since: remote.since,
    view: !r.on && remote.busy ? { status: 'starting', title: remote.state === 'downloading' ? 'Getting ready…' : 'Setting up…', detail: 'Getting this CasaTorch its own address. This takes up to a minute.', fix: null }
      : !r.on && remote.code ? { ...remoteView({ on: true, code: remote.code, why: remote.why }), fix: remoteSupported() ? { action: 'on', label: 'Try again' } : null }
      : remoteView({ on: !!r.on, state: remote.state, code: remote.code, check: remote.check, anywhere, why: remote.why }),
    busy: !!remote.busy,
    check: r.on ? { ok: remote.check.ok, at: remote.check.at, code: remote.check.code } : null, protocol: r.on ? remote.protocol : null,
    anywhere, qr: r.hostname ? await QRCode.toString(`https://${r.hostname}`, { type: 'svg', margin: 1 }) : null, supported: remoteSupported(), demo: isDemo(),
    ...(admin && r.on ? { lastError: remote.lastError } : {}),
  };
}
app.get('/api/remote', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await remoteInfo(req)); });
/** Turn secure access on (or repair it): this home's address and tunnel key from casatorch.com, then the tunnel itself. */
async function remoteOn() {
  if (remote.busy) return remote.busy;
  remote.busy = (async () => {
    await ensureCloudflared();
    const body = { id: installId(), name: config.house?.name || null, port: Number(PORT) || 8090, ...(config.remote?.secret ? { secret: config.remote.secret } : {}) };
    let r;
    try { r = await fetch(REMOTE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }); }
    catch (e) { throw Object.assign(new Error(`casatorch.com couldn't be reached (${e.cause?.code || e.name})`), { code: 'service' }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.hostname || !j.token) throw Object.assign(new Error(j.error || `casatorch.com answered ${r.status}`), { code: 'service' });
    stopTunnel();
    saveConfig({ ...config, remote: { on: true, hostname: j.hostname, token: j.token, secret: j.secret || config.remote?.secret, ...(config.remote?.protocol ? { protocol: config.remote.protocol } : {}) } });
    remote.code = null; remote.why = null; remote.check = { ok: null, at: null, code: null, ms: null }; remote.dnsTries = 0; remote.restarts = 0;
    startTunnel();
    return j.hostname;
  })().finally(() => { remote.busy = null; });
  return remote.busy;
}
function remoteFailed(err) {
  remoteProblem(err.code && REMOTE_WHY[err.code] ? err.code : 'service', err.message);
  if (err.code === 'service') remote.why = String(err.message);
  if (!remote.proc) remote.state = 'error';
}
app.post('/api/remote/on', requireRole('admin'), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  try { await remoteOn(); res.json({ ok: true, hostname: config.remote?.hostname, ...(await remoteInfo(req)) }); }
  catch (err) { remoteFailed(err); res.status(502).json({ error: String(err.message), code: remote.code, view: remoteView({ on: true, code: remote.code, why: remote.why }) }); }
});
/* Repair: the same as turning it on again, with the address it already has (casatorch.com knows it by its secret). */
app.post('/api/remote/repair', requireRole('admin'), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  if (!config.remote?.on) return res.status(409).json({ error: 'Secure access is off.' });
  remote.repairAt = Date.now();
  try { await remoteOn(); if (typeof audit === 'function') audit(req, 'secure-access-repaired'); res.json({ ok: true, ...(await remoteInfo(req)) }); }
  catch (err) { remoteFailed(err); res.status(502).json({ error: String(err.message), ...(await remoteInfo(req)) }); }
});
app.post('/api/remote/check', requireRole('admin'), async (req, res) => {
  if (!config.remote?.on) return res.status(409).json({ error: 'Secure access is off.' });
  if (!remote.proc && remote.code !== 'token' && !isDemo()) { try { await ensureCloudflared(); startTunnel(); } catch (e) { remoteFailed(e); } }
  else if (remote.state === 'connected') await remoteCheck('by you').catch(() => {});
  res.json({ ok: true, ...(await remoteInfo(req)) });
});
app.post('/api/remote/off', requireRole('admin'), async (_req, res) => {
  const r = config.remote || {};
  stopTunnel();
  if (r.secret) await fetch(REMOTE_URL, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: installId(), secret: r.secret }), signal: AbortSignal.timeout(20_000) }).catch(() => {});
  const { remote: _gone, ...rest } = config; saveConfig(rest);
  remote.code = null; remote.why = null; remote.check = { ok: null, at: null, code: null, ms: null }; remote.lastError = null; remote.log = [];
  res.json({ ok: true });
});
/* At start: the helper (downloaded again if it went missing), then the tunnel; a failed download is tried again after 1, 2, 5, 10, then every 30 minutes. */
function remoteBoot(n = 0) {
  if (!config.remote?.on || isDemo() || remote.proc) return;
  ensureCloudflared().then(() => startTunnel(), (e) => {
    remoteFailed(e);
    if (e.code !== 'unsupported') later('boot', [1, 2, 5, 10, 30][Math.min(n, 4)] * 60_000 * (RT.boot / 3000), () => remoteBoot(n + 1));
  });
}
setTimeout(() => remoteBoot(), RT.boot).unref?.();
process.on('exit', () => { try { remote.proc?.kill(); } catch { /* gone */ } });
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchRemote = { remoteView, remoteCheckResult, remoteLineKind, remoteMask, remoteNonceOk, remote, REMOTE_WHY, patchConfig: (p) => { const was = config; config = { ...config, ...p }; return () => { config = was; }; } };
