/* ======================================================================
 * App tests: how well the apps you use answer from your home, and the path
 * your traffic takes to reach them.
 *
 * A test is a web address - one of the common apps below, or (Pro) any
 * website - or one of two checks inside the home: the router, and how fast
 * names are looked up (DNS). Every few minutes CasaTorch opens a fresh
 * connection from this box and times each step: finding the address (DNS),
 * connecting, the secure handshake, the app's answer, and the download. It
 * also sends five quick connection probes for latency, jitter and loss.
 *
 * Every 15 minutes (and straight away when a test starts failing) it traces
 * the path hop by hop with the computer's own tools - mtr, traceroute or
 * tracepath on Linux, traceroute on a Mac, tracert on Windows - none of which
 * need special rights. Each hop gets its round trip (min / avg / max over
 * several probes), its loss, its name (reverse DNS) and who runs it (the
 * network's number and name, asked over ordinary DNS from a public
 * directory, cached for a week; can be turned off). From that and the hop's
 * usual numbers it works out where trouble starts: your home (Wi-Fi or
 * router), your internet provider, a network in between, or the app itself.
 *
 * Everything runs from this box straight to the app: nothing goes through
 * casatorch.com. It only looks - the requests are what a browser opening the
 * page would send, without signing in. History (24 hours of tests, 7 days by
 * the hour, path and MTU changes, and every distinct path seen this week for the merged path graph) is kept in
 * data/apptests.json.
 *
 * Basic: the built-in apps, up to 8 tests. Pro: your own websites, up to 30
 * tests, every minute if you like, and one alert when an app is down or slow,
 * with the likely culprit.
 * ====================================================================== */
import dnsCb from 'node:dns';
const AT_EVERY = [1, 5, 15], AT_PATH_EVERY = 15 * 60_000, AT_KEEP = 1440, AT_BASIC_MAX = 8, AT_PRO_MAX = 30, AT_FILE = path.join(DATA_DIR, 'apptests.json');
const AT_GROUPS = ['home', 'calls', 'work', 'stream', 'gaming', 'everyday'];
const AT_PRESETS = [
  // [id, name, group, url, short, countries (pre-picked there; regional ones only shown there)]
  ['router', 'Your router', 'home', 'router:', 'R'],
  ['dns', 'Name lookups (DNS)', 'home', 'dns:', 'D'],
  ['zoom', 'Zoom', 'calls', 'https://zoom.us/', 'Z'],
  ['teams', 'Microsoft Teams', 'calls', 'https://teams.microsoft.com/', 'T'],
  ['meet', 'Google Meet', 'calls', 'https://meet.google.com/', 'M'],
  ['webex', 'Webex', 'calls', 'https://www.webex.com/', 'W'],
  ['whatsapp', 'WhatsApp Web', 'calls', 'https://web.whatsapp.com/', 'W'],
  ['m365', 'Microsoft 365 sign-in', 'work', 'https://login.microsoftonline.com/', 'M'],
  ['outlook', 'Outlook', 'work', 'https://outlook.office365.com/owa/', 'O'],
  ['sharepoint', 'SharePoint and OneDrive', 'work', 'https://{tenant}.sharepoint.com/', 'S'],
  ['gmail', 'Gmail', 'work', 'https://mail.google.com/', 'G'],
  ['gdrive', 'Google Drive', 'work', 'https://drive.google.com/', 'D'],
  ['slack', 'Slack', 'work', 'https://slack.com/api/api.test', 'S'],
  ['salesforce', 'Salesforce', 'work', 'https://login.salesforce.com/', 'S'],
  ['github', 'GitHub', 'work', 'https://github.com/', 'G'],
  ['youtube', 'YouTube', 'stream', 'https://www.youtube.com/generate_204', 'Y'],
  ['netflix', 'Netflix', 'stream', 'https://www.netflix.com/', 'N'],
  ['disney', 'Disney+', 'stream', 'https://www.disneyplus.com/', 'D'],
  ['prime', 'Prime Video', 'stream', 'https://www.primevideo.com/', 'P'],
  ['spotify', 'Spotify', 'stream', 'https://open.spotify.com/', 'S'],
  ['twitch', 'Twitch', 'stream', 'https://www.twitch.tv/', 'T'],
  ['iplayer', 'BBC iPlayer', 'stream', 'https://www.bbc.co.uk/iplayer', 'B', ['GB']],
  ['ard', 'ARD Mediathek', 'stream', 'https://www.ardmediathek.de/', 'A', ['DE']],
  ['francetv', 'france.tv', 'stream', 'https://www.france.tv/', 'F', ['FR']],
  ['rtve', 'RTVE Play', 'stream', 'https://www.rtve.es/play/', 'R', ['ES']],
  ['raiplay', 'RaiPlay', 'stream', 'https://www.raiplay.it/', 'R', ['IT']],
  ['npo', 'NPO Start', 'stream', 'https://npo.nl/start', 'N', ['NL']],
  ['svtplay', 'SVT Play', 'stream', 'https://www.svtplay.se/', 'S', ['SE']],
  ['tvp', 'TVP VOD', 'stream', 'https://vod.tvp.pl/', 'T', ['PL']],
  ['tver', 'TVer', 'stream', 'https://tver.jp/', 'T', ['JP']],
  ['hotstar', 'JioHotstar', 'stream', 'https://www.hotstar.com/', 'J', ['IN']],
  ['globoplay', 'Globoplay', 'stream', 'https://globoplay.globo.com/', 'G', ['BR']],
  ['cbcgem', 'CBC Gem', 'stream', 'https://gem.cbc.ca/', 'C', ['CA']],
  ['iview', 'ABC iview', 'stream', 'https://iview.abc.net.au/', 'A', ['AU']],
  ['bilibili', 'Bilibili', 'stream', 'https://www.bilibili.com/', 'B', ['CN']],
  ['xbox', 'Xbox', 'gaming', 'https://www.xbox.com/', 'X'],
  ['playstation', 'PlayStation', 'gaming', 'https://www.playstation.com/', 'P'],
  ['steam', 'Steam', 'gaming', 'https://store.steampowered.com/', 'S'],
  ['nintendo', 'Nintendo', 'gaming', 'https://www.nintendo.com/', 'N'],
  ['google', 'Google Search', 'everyday', 'https://www.google.com/generate_204', 'G'],
  ['icloud', 'iCloud', 'everyday', 'https://www.icloud.com/', 'i'],
  ['amazon', 'Amazon', 'everyday', 'https://www.amazon.com/', 'A'],
  ['facebook', 'Facebook', 'everyday', 'https://www.facebook.com/', 'F'],
  ['naver', 'Naver', 'everyday', 'https://www.naver.com/', 'N', ['KR']],
  ['baidu', 'Baidu', 'everyday', 'https://www.baidu.com/', 'B', ['CN']],
].map(([id, name, group, url, short, cc]) => ({ id, name, group, url, short, cc: cc || null, kind: id === 'router' || id === 'dns' ? id : 'web' }));
const atPreset = (id) => AT_PRESETS.find((p) => p.id === id) || null;
const atCfg = () => (Array.isArray(config.appTests) ? config.appTests : []);
const atMax = () => (proStatus().pro ? AT_PRO_MAX : AT_BASIC_MAX);
const atKind = (t) => t.kind || atPreset(t.preset)?.kind || 'web';
const atOwnersOn = () => config.appTestsOwners !== false;
const at = { state: {}, busy: new Set(), tools: undefined, toolBad: {}, own: {}, asn: {}, dirty: false };   // state: id -> { runs, hours, traces, changes, last, path, pathAt, fails, slow }

/* ---- kept across restarts: history, paths and the "who runs this network" answers ---- */
try {
  const j = JSON.parse(fs.readFileSync(AT_FILE, 'utf8'));
  if (j?.v === 1) { at.state = j.state || {}; at.own = j.own || {}; at.asn = j.asn || {}; }
} catch { /* first run */ }
function atSave() {
  if (!at.dirty) return; at.dirty = false;
  const state = {};
  for (const [id, st] of Object.entries(at.state)) state[id] = { ...st, runs: (st.runs || []).slice(-288) };
  const old = Date.now() - 7 * 86400_000, keep = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.at > old));
  try { writeFileSafe(AT_FILE, JSON.stringify({ v: 1, state, own: keep(at.own), asn: keep(at.asn) }), 0o600); } catch { at.dirty = true; }
}
setInterval(atSave, 30 * 60_000).unref?.();   // up to a few MB with many tests: every 30 minutes (and as CasaTorch stops) spares an SD card
process.on('exit', () => { try { atSave(); } catch { /* best effort */ } });

/* A host we're willing to hand to traceroute: letters, digits, dots and dashes, never starting with a dash. */
const atHostOk = (h) => /^(?!-)[a-z0-9.-]{1,253}$/i.test(h) && !h.includes('..');
function atParseUrl(raw) {
  const s = String(raw || '').trim();
  let u; try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if ((!atHostOk(host) && !net.isIP(host)) || blockedUrl(u.toString())) return null;
  return { url: u.toString(), host };
}

/* ---- one run: a fresh connection, each step timed ---- */
function atHttp(url) {
  return new Promise((done) => {
    const u = new URL(url), mod = u.protocol === 'https:' ? https : http;
    const t0 = process.hrtime.bigint(), ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
    const r = { ok: false, status: null, ip: null, dns: null, connect: null, tls: null, wait: null, download: null, total: null, bytes: 0, error: null, errKind: null, phase: 'dns' };
    let tDns = null, tConn = null, tTls = null, tFirst = null, finished = false;
    const finish = (err, kind) => {
      if (finished) return; finished = true;
      r.total = Math.round(ms());
      if (err) { r.error = err; r.errKind = kind || r.phase; r.ok = false; } else { r.ok = r.status != null && r.status < 500; if (!r.ok) { r.error = `it answered with an error (${r.status})`; r.errKind = 'answer'; } }
      for (const k of ['dns', 'connect', 'tls', 'wait', 'download']) if (r[k] != null) r[k] = Math.round(r[k] * 10) / 10;
      done(r);
    };
    const lookup = (host, opts, cb) => dnsCb.lookup(host, opts, (e, addr, fam) => {
      tDns = ms(); r.dns = tDns; if (!e) { r.ip = Array.isArray(addr) ? addr[0]?.address : addr; r.phase = 'connect'; } cb(e, addr, fam);
    });
    const req = mod.request(url, { method: 'GET', agent: false, lookup, timeout: 15_000, headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } }, (res) => {
      tFirst = ms(); r.wait = tFirst - (tTls ?? tConn ?? tDns ?? 0); r.status = res.statusCode; r.phase = 'download';
      res.on('data', (c) => { r.bytes += c.length; if (r.bytes > 1_000_000) { r.download = ms() - tFirst; req.destroy(); finish(null); } });
      res.on('end', () => { r.download = ms() - tFirst; finish(null); });
      res.on('error', () => { r.download = ms() - tFirst; finish(null); });
    });
    req.on('socket', (s) => {
      if (net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) { tDns = 0; r.dns = 0; r.ip = u.hostname; r.phase = 'connect'; }
      s.on('connect', () => { tConn = ms(); r.connect = tConn - (tDns ?? 0); r.phase = u.protocol === 'https:' ? 'tls' : 'wait'; });
      s.on('secureConnect', () => { tTls = ms(); r.tls = tTls - (tConn ?? tDns ?? 0); r.phase = 'wait'; });
    });
    req.on('timeout', () => { req.destroy(); finish(`no answer in 15 seconds (${r.phase})`); });
    req.on('error', (e) => {
      const c = String(e?.code || '');
      if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return finish('its name could not be found (DNS)', 'dns');
      finish(c === 'ECONNREFUSED' ? 'it refused the connection' : c === 'ECONNRESET' ? 'the connection was dropped' : /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altname/i.test(c + e?.message) ? 'its certificate is not valid'
        : c === 'ETIMEDOUT' || c === 'EHOSTUNREACH' || c === 'ENETUNREACH' ? 'it could not be reached' : String(e?.message || 'failed').slice(0, 80), /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altname/i.test(c + e?.message) ? 'answer' : null);
    });
    req.end();
  });
}
/* A round trip with no special rights: a TCP connection. A "connection refused" is an answer too (the device is there),
   which is how the router is timed - it may not run a web page, but it always answers. */
const atReach = (host, port, timeout = 1500) => new Promise((ok) => {
  const t0 = process.hrtime.bigint(), s = net.connect({ host, port, timeout }), ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
  const end = (v) => { s.destroy(); ok(v == null ? null : Math.round(v * 100) / 100); };
  s.on('connect', () => end(ms())); s.on('timeout', () => end(null)); s.on('error', (e) => end(e?.code === 'ECONNREFUSED' ? ms() : null));
});
/* Five quick probes: latency, jitter (how much it wobbles) and loss. */
async function atProbe(ip, port, reach = false) {
  if (!ip) return null;
  const rtts = [];
  for (let i = 0; i < 5; i++) { rtts.push(reach ? await atReach(ip, port) : await tcpMs(ip, port, 2000)); if (i < 4) await new Promise((ok) => setTimeout(ok, 150)); }
  const got = rtts.filter((v) => v != null);
  const jit = got.length > 1 ? got.slice(1).reduce((s, v, i) => s + Math.abs(v - got[i]), 0) / (got.length - 1) : null;
  return { latency: got.length ? Math.round(got.reduce((s, v) => s + v, 0) / got.length * 10) / 10 : null, min: got.length ? Math.round(Math.min(...got) * 10) / 10 : null, max: got.length ? Math.round(Math.max(...got) * 10) / 10 : null,
    jitter: jit == null ? null : Math.round(jit * 10) / 10, loss: Math.round((rtts.length - got.length) / rtts.length * 100) };
}
/* The router: whatever the computer's default route points at, else the first home hop of a traced path. */
function atRouterIp() {
  const gw = typeof gatewayIp === 'function' ? gatewayIp() : null; if (gw) return gw;
  for (const st of Object.values(at.state)) { const h = st.path?.hops?.find((x) => x.ip && atPrivate(x.ip)); if (h) return h.ip; }
  return null;
}
async function atRunRouter() {
  const ip = atRouterIp(); if (!ip) return { ok: false, error: 'the router\'s address could not be found', errKind: 'router' };
  let port = at.routerPort;
  if (!port) for (const p of [53, 80, 443]) if (await atReach(ip, p) != null) { port = at.routerPort = p; break; }
  const p = port ? await atProbe(ip, port, true) : { latency: null, loss: 100, jitter: null };
  return { ok: p.latency != null, ip, total: p.latency, error: p.latency == null ? 'the router didn\'t answer' : null, errKind: p.latency == null ? 'router' : null, ...p };
}
const AT_DNS_NAMES = ['www.wikipedia.org', 'www.google.com', 'www.apple.com', 'www.microsoft.com'];
async function atRunDns() {
  const r = new dnsP.Resolver({ timeout: 3000, tries: 1 }), server = (r.getServers()[0] || '').replace(/^\[|\]$/g, '').replace(/:53$/, '') || null;
  const times = [];
  for (const name of AT_DNS_NAMES.slice(0, 3)) {
    const t0 = process.hrtime.bigint();
    try { await r.resolve4(name); times.push(Number(process.hrtime.bigint() - t0) / 1e6); } catch { times.push(null); }
  }
  const got = times.filter((v) => v != null);
  return { ok: got.length > 0, ip: server, total: got.length ? Math.round(atMedian(got) * 10) / 10 : null, dns: got.length ? Math.round(atMedian(got) * 10) / 10 : null, latency: got.length ? Math.round(Math.min(...got) * 10) / 10 : null,
    min: got.length ? Math.round(Math.min(...got) * 10) / 10 : null, max: got.length ? Math.round(Math.max(...got) * 10) / 10 : null, loss: Math.round((times.length - got.length) / times.length * 100), jitter: null,
    error: got.length ? null : 'names could not be looked up', errKind: got.length ? null : 'dns' };
}
const atHourKey = (iso) => Math.floor(Date.parse(iso) / 3600_000) * 3600_000;
function atAddHour(st, run) {
  const h = atHourKey(run.at), hours = (st.hours ||= []);
  let b = hours[hours.length - 1]; if (!b || b.h !== h) { b = { h, n: 0, ok: 0, lat: 0, latN: 0, loss: 0, lossN: 0, tot: 0, totN: 0 }; hours.push(b); }
  b.n++; if (run.ok) b.ok++;
  if (run.latency != null) { b.lat += run.latency; b.latN++; } if (run.loss != null) { b.loss += run.loss; b.lossN++; } if (run.ok && run.total != null) { b.tot += run.total; b.totN++; }
  while (hours.length && hours[0].h < Date.now() - 7 * 86400_000) hours.shift();
}
async function atRun(t) {
  if (at.busy.has(t.id)) return at.state[t.id]?.last || null;
  at.busy.add(t.id);
  try {
    const kind = atKind(t);
    let r, p = null;
    if (kind === 'router') r = await atRunRouter();
    else if (kind === 'dns') r = await atRunDns();
    else { r = await atHttp(t.url); p = r.ip ? await atProbe(r.ip, new URL(t.url).protocol === 'http:' ? 80 : 443) : null; }
    const run = { at: nowIso(), ok: r.ok, status: r.status ?? null, ip: r.ip ?? null, dns: r.dns ?? null, connect: r.connect ?? null, tls: r.tls ?? null, wait: r.wait ?? null, download: r.download ?? null, total: r.total ?? null, bytes: r.bytes || 0, error: r.error || null, errKind: r.errKind || null,
      latency: p ? p.latency : r.latency ?? null, jitter: p ? p.jitter : r.jitter ?? null, loss: p ? p.loss : r.loss ?? null, lmin: p ? p.min : r.min ?? null, lmax: p ? p.max : r.max ?? null };
    const st = (at.state[t.id] ||= { runs: [], fails: 0 });
    st.runs.push(run); if (st.runs.length > AT_KEEP) st.runs.splice(0, st.runs.length - AT_KEEP);
    st.last = run; st.fails = run.ok ? 0 : (st.fails || 0) + 1;
    const med = atMedian(st.runs.filter((x) => x.ok && Date.now() - Date.parse(x.at) < 86400_000).map((x) => x.total));
    st.slow = run.ok && atIsSlow(run.total, med, kind) ? (st.slow || 0) + 1 : 0;
    atAddHour(st, run); at.dirty = true;
    return run;
  } finally { at.busy.delete(t.id); }
}
/* Slow: well past its usual time - twice the day's median and at least half a second more (a tenth of a second for the home checks). */
const atIsSlow = (v, med, kind = 'web') => v != null && med != null && v > 2 * med && v - med > (kind === 'web' ? 500 : 100);

/* ---- the path: find the tools, run them, read what they print ---- */
const atRunCmd = (cmd, args, timeout) => new Promise((ok) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 512 * 1024 }, (e, so, se) => ok({ err: e, out: String(so || ''), errOut: String(se || '') })));
function atWhich(name) {
  for (const d of ['/usr/sbin', '/usr/bin', '/sbin', '/bin', '/usr/local/sbin', '/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin']) { const p = path.join(d, name); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* not here */ } }
  return null;
}
/* Which tools this computer has, best first. None of them needs special rights. */
async function atTools() {
  if (at.tools !== undefined) return at.tools;
  const list = [];
  if (process.platform === 'win32') {
    const r = await atRunCmd('tracert', ['/?'], 5000); if (/tracert|-d|-h/i.test(r.out + r.errOut)) list.push({ tool: 'tracert', cmd: 'tracert' });
  } else {
    const mtr = atWhich('mtr'); if (mtr) list.push({ tool: 'mtr', cmd: mtr });
    const tr = atWhich('traceroute');
    if (tr) { const v = await atRunCmd(tr, ['--version'], 5000); list.push({ tool: /Modern traceroute/i.test(v.out + v.errOut) ? 'traceroute' : 'traceroute-bsd', cmd: tr }); }
    const tp = atWhich('tracepath'); if (tp) list.push({ tool: 'tracepath', cmd: tp });
  }
  at.tools = list;
  return list;
}
const atArgs = (tool, host) => ({
  mtr: ['-n', '-j', '-c', '5', '-m', '24', host],
  traceroute: ['-n', '-q', '3', '-w', '2', '-m', '24', host],
  'traceroute-bsd': ['-n', '-q', '3', '-w', '2', '-m', '24', host],
  tracepath: ['-n', '-m', '24', host],
  tracert: ['-d', '-h', '24', '-w', '1500', host],
}[tool]);
const atR = (v) => (v == null ? null : Math.round(v * 100) / 100);
function atHopStats(n, ip, rtts, extra = {}) {
  const got = rtts.filter((v) => v != null), sent = rtts.length;
  return { n, ip: got.length ? ip : null, sent, loss: sent ? Math.round((sent - got.length) / sent * 100) : 100,
    min: got.length ? atR(Math.min(...got)) : null, avg: got.length ? atR(got.reduce((s, v) => s + v, 0) / got.length) : null, max: got.length ? atR(Math.max(...got)) : null, ...extra };
}
const AT_IP = /^(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7})$/i;
/* Read a tool's output into hops: { n, ip, sent, loss, min, avg, max } (ip null: that hop didn't answer), plus
   { mtu } for the path when the tool reports it. Exported for tests. */
function atParseTrace(text, tool) {
  const hops = new Map(); let mtu = null;
  if (tool === 'mtr') {
    let j; try { j = JSON.parse(String(text)); } catch { return { hops: [], mtu: null }; }
    for (const h of j?.report?.hubs || []) {
      const n = Number(h.count), ip = AT_IP.test(String(h.host || '')) ? h.host : null, sent = Number(h.Snt) || 0, loss = Math.round(Number(h['Loss%']) || 0);
      if (!n || hops.has(n)) continue;
      hops.set(n, ip && loss < 100 ? { n, ip, sent, loss, min: atR(Number(h.Best)), avg: atR(Number(h.Avg)), max: atR(Number(h.Wrst)) } : { n, ip: null, sent, loss: 100, min: null, avg: null, max: null });
    }
    return { hops: [...hops.values()].sort((a, b) => a.n - b.n), mtu: null };
  }
  const acc = new Map();   // n -> { ips: Map(ip -> count), rtts: [] }
  const take = (n) => { if (!acc.has(n)) acc.set(n, { ips: new Map(), rtts: [] }); return acc.get(n); };
  for (const line of String(text).split(/\r?\n/)) {
    if (tool === 'tracepath') {
      const pm = line.match(/pmtu\s+(\d+)/); if (pm) mtu = Number(pm[1]);
      const m = line.match(/^\s*(\d+)\??:\s+(\S+)(?:\s+(\d+(?:\.\d+)?)ms)?/); if (!m || m[2] === '[LOCALHOST]') continue;
      const a = take(Number(m[1]));
      if (m[2] === 'no') { a.rtts.push(null); continue; }
      if (!AT_IP.test(m[2])) continue;
      if (m[3] != null) { a.ips.set(m[2], (a.ips.get(m[2]) || 0) + 1); a.rtts.push(Number(m[3])); } else a.rtts.push(null);
    } else if (tool === 'tracert') {
      const m = line.match(/^\s*(\d+)\s+(.*)$/); if (!m) continue;
      const a = take(Number(m[1])), cols = [...m[2].matchAll(/(?:(<?\d+)\s*ms|\*)/g)].slice(0, 3);
      if (!cols.length) continue;
      const ip = (m[2].match(/(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:]+)\s*$/i) || [])[1] || null;
      for (const c of cols) a.rtts.push(c[1] == null ? null : c[1].startsWith('<') ? 0.5 : Number(c[1]));
      if (ip && cols.some((c) => c[1] != null)) a.ips.set(ip, (a.ips.get(ip) || 0) + 1);
    } else {   // traceroute (Linux, Mac, BSD): "4  198.51.100.1  10.4 ms  *  10.6 ms", several addresses on one line when routes split
      const m = line.match(/^\s*(\d+)\s+(.*)$/); if (!m) continue;
      const a = take(Number(m[1])); let cur = null;
      const toks = m[2].trim().split(/\s+/);
      for (let i = 0; i < toks.length; i++) {
        const k = toks[i].replace(/^\(|\)$/g, '');
        if (k === '*') a.rtts.push(null);
        else if (AT_IP.test(k) && k.includes('.') || /^[0-9a-f]*:[0-9a-f:]+$/i.test(k) && k.split(':').length > 2) cur = k;
        else if (/^\d+(\.\d+)?$/.test(k) && toks[i + 1] === 'ms') { a.rtts.push(Number(k)); if (cur) a.ips.set(cur, (a.ips.get(cur) || 0) + 1); i++; }
        else if (/^F=(\d+)$/.test(k)) mtu = Number(k.slice(2));
      }
    }
  }
  for (const [n, a] of acc) {
    const ips = [...a.ips.entries()].sort((x, y) => y[1] - x[1]).map(([ip]) => ip);
    hops.set(n, atHopStats(n, ips[0] || null, a.rtts.length ? a.rtts : [null], ips.length > 1 ? { ips } : {}));
  }
  return { hops: [...hops.values()].sort((a, b) => a.n - b.n), mtu };
}
const atPrivate = (ip) => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fc|fd|::1$)/i.test(ip || '');
const atCgnat = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip || '');
const atDomain = (name) => { const p = String(name || '').toLowerCase().split('.').filter(Boolean); if (p.length < 2) return null; const two = p.slice(-2).join('.'); return /^(co|com|net|org|ac|gov|ne|or)\.[a-z]{2}$/.test(two) && p.length > 2 ? p.slice(-3).join('.') : two; };
const atSlowly = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms))]);
async function atReverse(ip) {
  if (!ip || atPrivate(ip)) return null;
  try { return (await atSlowly(dnsP.reverse(ip), 1500))[0] || null; } catch { return null; }
}
/* Who runs a network: the public IP-to-network directory, asked over plain DNS (TXT records), so it's
   the same kind of lookup as any web address. "64500 | 198.51.100.0/24 | US | arin | 2001-01-01", then
   the network's own record "64500 | US | arin | 2001-01-01 | EXAMPLE - Example Broadband, US". */
const atRevName = (ip) => {
  if (net.isIPv4(ip)) return `${ip.split('.').reverse().join('.')}.origin.asn.cymru.com`;
  const parts = ip.split('::'), head = parts[0] ? parts[0].split(':') : [], tail = parts[1] ? parts[1].split(':') : [];
  const full = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail].map((g) => g.padStart(4, '0')).join('');
  return `${full.split('').reverse().join('.')}.origin6.asn.cymru.com`;
};
function atParseOrigin(txt) { const f = String(txt || '').split('|').map((s) => s.trim()); const asn = Number(String(f[0] || '').split(/\s+/)[0]); return asn ? { asn, prefix: f[1] || null, cc: /^[A-Z]{2}$/.test(f[2] || '') ? f[2] : null } : null; }
function atParseAsName(txt) {
  const f = String(txt || '').split('|').map((s) => s.trim()), raw = f[4] || '';
  let name = raw.includes(' - ') ? raw.slice(raw.indexOf(' - ') + 3) : raw;
  name = name.replace(/,\s*[A-Z]{2}$/, '').trim();
  return name || raw || null;
}
async function atOwner(ip) {
  if (!ip || atPrivate(ip) || atCgnat(ip) || !atOwnersOn()) return null;
  const hit = at.own[ip]; if (hit && Date.now() - hit.at < 7 * 86400_000) return hit.asn ? { asn: hit.asn, cc: hit.cc, prefix: hit.prefix, org: at.asn[hit.asn]?.name || null } : null;
  let o = null;
  try { o = atParseOrigin((await atSlowly(dnsP.resolveTxt(atRevName(ip)), 2000))[0]?.join('')); } catch { o = null; }
  at.own[ip] = { at: Date.now(), ...(o || {}) }; at.dirty = true;
  if (!o) return null;
  if (!at.asn[o.asn] || Date.now() - at.asn[o.asn].at > 7 * 86400_000) {
    try { at.asn[o.asn] = { at: Date.now(), name: atParseAsName((await atSlowly(dnsP.resolveTxt(`AS${o.asn}.asn.cymru.com`), 2000))[0]?.join('')) }; } catch { at.asn[o.asn] = { at: Date.now() - 6 * 86400_000, name: null }; }
  }
  return { ...o, org: at.asn[o.asn]?.name || null };
}
/* Who each hop belongs to: your home (the private addresses first), your internet provider, networks in between
   ("internet"), and the app's own network. With network numbers: the provider is the first public network, the app's
   is the destination's. Without them: worked out from the hops' names (an estimate). Silent hops take their neighbor's. */
function atZones(hops, { ispAsn = null, destAsn = null } = {}) {
  let i = 0;
  for (; i < hops.length && (hops[i].ip == null || atPrivate(hops[i].ip)); i++) if (hops[i].ip) hops[i].zone = 'home';
  for (let k = 0; k < i; k++) hops[k].zone ||= 'home';
  if (hops.slice(i).some((h) => h.asn)) {
    const isp = ispAsn || hops.slice(i).find((h) => h.asn)?.asn;
    let left = false;
    for (; i < hops.length; i++) {
      const h = hops[i];
      if (h.ip == null) { h.zone = null; continue; }
      if (!h.asn) h.zone = left ? 'internet' : 'provider';
      else if (h.asn === isp && !left) h.zone = 'provider';
      else if (destAsn && h.asn === destAsn) { h.zone = 'app'; left = true; }
      else { h.zone = 'internet'; left = true; }
    }
    for (let k = 0; k < hops.length; k++) if (!hops[k].zone) {
      const prev = hops.slice(0, k).reverse().find((h) => h.zone)?.zone, next = hops.slice(k + 1).find((h) => h.ip)?.zone;
      hops[k].zone = prev === 'home' && next ? next : prev || next || 'provider';
    }
    return hops;
  }
  let isp = null;
  for (; i < hops.length; i++) {
    const h = hops[i]; if (h.ip == null) { h.zone = isp === false ? 'internet' : 'provider'; continue; }
    const d = atDomain(h.name);
    if (atCgnat(h.ip)) { h.zone = 'provider'; continue; }
    if (isp === false) { h.zone = 'internet'; continue; }
    if (isp == null) { isp = d || ''; h.zone = 'provider'; continue; }
    if (d && isp && d !== isp) { isp = false; h.zone = 'internet'; continue; }
    if (d && !isp) isp = d;
    h.zone = 'provider';
  }
  return hops;
}
const atIspAsn = async () => { try { return (await ispInfo()).asn || null; } catch { return null; } };   // 24-internet.js
async function atRunTools(host) {
  const tools = (await atTools()).filter((x) => (at.toolBad[x.tool] || 0) < 3);
  if (!tools.length) return { hops: [], mtu: null, tool: null };
  const main = tools[0].tool === 'tracepath' || tools.length === 1 ? tools[0] : tools.find((x) => x.tool !== 'tracepath');
  const mtuTool = main.tool === 'mtr' ? tools.find((x) => x.tool === 'tracepath') : null;
  const [r, m] = await Promise.all([atRunCmd(main.cmd, atArgs(main.tool, host), 90_000), mtuTool ? atRunCmd(mtuTool.cmd, atArgs('tracepath', host), 60_000) : null]);
  const parsed = atParseTrace(r.out, main.tool === 'traceroute-bsd' ? 'traceroute' : main.tool);
  if (!parsed.hops.some((h) => h.ip)) {   // didn't work here (no rights in this container, say): try the next one, and stop asking this one after three misses
    at.toolBad[main.tool] = (at.toolBad[main.tool] || 0) + 1;
    const rest = tools.filter((x) => x !== main && x.tool !== 'mtr');
    for (const x of rest) { const r2 = await atRunCmd(x.cmd, atArgs(x.tool, host), 90_000); const p2 = atParseTrace(r2.out, x.tool === 'traceroute-bsd' ? 'traceroute' : x.tool); if (p2.hops.some((h) => h.ip)) return { ...p2, tool: x.tool }; }
    return { ...parsed, tool: main.tool };
  }
  at.toolBad[main.tool] = 0;
  return { ...parsed, mtu: parsed.mtu ?? (m ? atParseTrace(m.out, 'tracepath').mtu : null), tool: main.tool };
}
/* Where the path goes for a test: the app's host, the DNS server when it's out on the internet, nothing for the router. */
function atTarget(t) {
  const kind = atKind(t);
  if (kind === 'router') return null;
  if (kind === 'dns') { const ip = at.state[t.id]?.last?.ip; return ip && !atPrivate(ip) && net.isIP(ip) ? ip : null; }
  return atParseUrl(t.url)?.host || null;
}
async function atTrace(t) {
  const host = atTarget(t), tools = await atTools();
  if (!host) return { at: nowIso(), hops: [], none: atKind(t) === 'router' || atKind(t) === 'dns' ? 'home' : 'bad' };
  if (!tools.length) return { at: nowIso(), hops: [], none: 'tool' };
  const { hops: raw, mtu, tool } = await atRunTools(host);
  let hops = raw;
  while (hops.length && hops[hops.length - 1].ip == null) hops.pop();   // the silent tail: the app's network not answering traces
  const st = at.state[t.id] || {}, destIp = st.last?.ip || (net.isIP(host) ? host : null);
  await Promise.all(hops.map(async (h) => { const [name, own] = await Promise.all([atReverse(h.ip), atOwner(h.ip)]); h.name = name; if (own) Object.assign(h, { asn: own.asn, org: own.org, cc: own.cc }); }));
  const destOwn = await atOwner(destIp);
  atZones(hops, { ispAsn: await atIspAsn(), destAsn: destOwn?.asn || null });
  // The app itself: its own hop when it answered the trace, otherwise the connection probes of the latest test.
  let dest = { ip: destIp, name: host, asn: destOwn?.asn || null, org: destOwn?.org || null, cc: destOwn?.cc || null, zone: 'app', dest: true };
  const lastHop = hops[hops.length - 1];
  if (lastHop && destIp && lastHop.ip === destIp) { hops.pop(); Object.assign(dest, { n: lastHop.n, sent: lastHop.sent, loss: lastHop.loss, min: lastHop.min, avg: lastHop.avg, max: lastHop.max, from: 'trace' }); }
  else if (st.last) Object.assign(dest, { sent: 5, loss: st.last.loss, min: st.last.lmin ?? st.last.latency, avg: st.last.latency, max: st.last.lmax ?? st.last.latency, from: 'probe' });
  return { at: nowIso(), hops, dest, mtu, tool };
}
/* Same route or a new one: compared by whose networks it crosses (and how many hops), not by every router's
   address - big networks spread traffic over many equal routers, and that isn't a change you'd care about. */
const atPathKey = (p) => {
  const seq = []; for (const h of p?.hops || []) { const k = h.asn ? `AS${h.asn}` : h.zone === 'home' ? 'home' : null; if (k && seq[seq.length - 1] !== k) seq.push(k); }
  return seq.length ? seq.join('>') : (p?.hops || []).filter((h) => h.ip).map((h) => h.ip.split('.').slice(0, 3).join('.')).join('>');
};
const atOwners = (p) => { const o = []; for (const h of p?.hops || []) { const n = h.org || (h.asn ? `AS${h.asn}` : null); if (n && !o.includes(n)) o.push(n); } return o; };
async function atTracePath(t) {
  if (at.busy.has(`path:${t.id}`)) return null;
  at.busy.add(`path:${t.id}`);
  try {
    const p = await atTrace(t), st = (at.state[t.id] ||= { runs: [], fails: 0 });
    if (p.hops.length) {
      atNoteChange(st, st.path?.hops?.length ? st.path : null, p);
      atRecord(st, p);   // the day trace by trace, the week in hourly and six-hourly sums (the path graph)
      st.path = p;
    } else if (!st.path || p.none) st.path = p;
    st.pathAt = Date.now(); at.dirty = true;
    return p;
  } finally { at.busy.delete(`path:${t.id}`); }
}
/* A route change (whose networks it crosses) or a new largest packet size, kept for a week. */
function atNoteChange(st, prev, p) {
  const changes = (st.changes ||= []);
  if (prev && atPathKey(prev) !== atPathKey(p)) changes.push({ at: p.at, kind: 'route', from: atOwners(prev), to: atOwners(p), hopsFrom: prev.hops.length + 1, hopsTo: p.hops.length + 1 });
  if (prev?.mtu && p.mtu && prev.mtu !== p.mtu) changes.push({ at: p.at, kind: 'mtu', mtuFrom: prev.mtu, mtuTo: p.mtu });
  const old = (Date.parse(p.at) || Date.now()) - 7 * 86400_000;
  while (changes.length && (changes.length > 60 || Date.parse(changes[0].at) < old)) changes.shift();
  if (prev && atPathKey(prev) !== atPathKey(p)) { st.prevPath = prev; st.changedAt = p.at; }
}
/* One kept trace as [ip, avg, loss] for each hop that answered, and [avg, loss] for the app - both the current form
   (addresses shared through st.pd) and the older one (written by 0.8.0). */
function atTrHops(st, tr) {
  if (tr.hops) return { hops: tr.hops, dest: tr.dest || [null, null] };
  const s = st.pd?.[tr.pid]?.s || [];
  return { hops: s.map((ip, i) => (ip && tr.h?.[i] ? [ip, tr.h[i][1], tr.h[i][3]] : null)).filter(Boolean), dest: [tr.d?.[2] ?? null, tr.d?.[4] ?? null] };
}
/* Each hop's usual round trip: the median over the last day's traces (needs three). */
function atBaselines(st) {
  const by = new Map(), dest = [];
  for (const raw of (st.traces || []).slice(0, -1)) { const tr = atTrHops(st, raw); for (const [ip, avg] of tr.hops) if (avg != null) { if (!by.has(ip)) by.set(ip, []); by.get(ip).push(avg); } if (tr.dest?.[0] != null) dest.push(tr.dest[0]); }
  const base = {}; for (const [ip, v] of by) if (v.length >= 3) base[ip] = atR(atMedian(v));
  return { hops: base, dest: dest.length >= 3 ? atR(atMedian(dest)) : null };
}

/* ---- the path graph: every trace in a time window merged into one picture ----
   A trace is kept as its addresses hop by hop (null where a hop didn't answer) plus each hop's numbers. Each distinct
   list of addresses is stored once (st.pd, by a short id), so a week costs little: the last 96 traces one by one
   (st.traces), and every trace also added into hourly sums (st.tb) that become six-hourly after two days and go after
   a week. Each address's name, owner, zone and first/last seen: st.hm (at most 300). All of it is written with the
   rest of apptests.json every 30 minutes - never once per trace - which spares an SD card. */
const AT_PD_MAX = 48, AT_HM_MAX = 300, AT_H = 3600_000, AT_6H = 6 * AT_H;
const atSig = (s) => s.map((x) => x || '*').join(',');
const atPid = (s) => crypto.createHash('sha1').update(atSig(s)).digest('hex').slice(0, 8);
const at1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
/* Sums for one address: [fastest, sum of averages, slowest, sum of loss, traces, sum of squared averages, traces with a time]. */
function atAcc(o, k, min, avg, max, loss) {
  const a = (o[k] ||= [null, 0, null, 0, 0, 0, 0]);
  if (avg != null) { a[0] = a[0] == null ? (min ?? avg) : Math.min(a[0], min ?? avg); a[2] = a[2] == null ? (max ?? avg) : Math.max(a[2], max ?? avg); a[1] = at1(a[1] + avg); a[5] = Math.round(a[5] + avg * avg); a[6]++; }
  a[3] = at1(a[3] + (loss ?? 0)); a[4]++;
  return a;
}
const atAccJoin = (a, b) => {
  if (!b) return a; if (!a) return b.slice();
  a[0] = a[0] == null ? b[0] : b[0] == null ? a[0] : Math.min(a[0], b[0]); a[2] = a[2] == null ? b[2] : b[2] == null ? a[2] : Math.max(a[2], b[2]);
  a[1] = at1(a[1] + b[1]); a[3] = at1(a[3] + b[3]); a[4] += b[4]; a[5] += b[5]; a[6] += b[6]; return a;
};
function atBuckJoin(m, b) {
  m.n += b.n; for (const [id, c] of Object.entries(b.p || {})) m.p[id] = (m.p[id] || 0) + c;
  for (const k of ['s', 'd']) for (const [ip, a] of Object.entries(b[k] || {})) m[k][ip] = atAccJoin(m[k][ip], a);
  if (b.mtu) m.mtu = b.mtu; return m;
}
/* Keep one traced path: as a trace (the last 96), in its hour's sums, and its addresses' names. Exported for tests. */
function atRecord(st, p, now = Date.now()) {
  const t = Date.parse(p.at) || now, byN = new Map((p.hops || []).map((h, i) => [h.n || i + 1, h])), last = Math.max(0, ...byN.keys());
  const s = [], h = [], alts = [];
  for (let i = 1; i <= last; i++) {
    const x = byN.get(i); s.push(x?.ip || null); h.push(x?.ip ? [x.min ?? null, x.avg ?? null, x.max ?? null, x.loss ?? 0] : null);
    if (x?.ip && x.ips?.length > 1) for (const ip of x.ips.slice(1, 3)) if (ip !== x.ip) alts.push([i - 1, ip]);   // traffic spread over equal routers: each one is a branch
  }
  if (!s.some(Boolean)) return null;
  const pd = (st.pd ||= {}), pid = atPid(s); pd[pid] = { s, u: t };
  const alt = alts.map(([i, ip]) => { const s2 = s.slice(); s2[i] = ip; const id = atPid(s2); pd[id] = { s: s2, u: t }; return id; });
  const d = p.dest ? [p.dest.ip || null, p.dest.min ?? null, p.dest.avg ?? null, p.dest.max ?? null, p.dest.loss ?? null] : null;
  const tr = { at: p.at, pid, h, d, ...(alt.length ? { alt } : {}), ...(p.mtu ? { mtu: p.mtu } : {}) };
  (st.traces ||= []).push(tr); while (st.traces.length > 96) st.traces.shift();
  const hm = (st.hm ||= {});
  const meta = (ip, x, z) => { const m = (hm[ip] ||= { f: t }); m.l = t; if (x.name) m.nm = x.name; if (z) m.z = z; if (x.asn) { m.a = x.asn; m.o = x.org || m.o || null; m.cc = x.cc || m.cc || null; } if (p.mtu) m.mtu = p.mtu; };
  for (const x of p.hops) if (x.ip) meta(x.ip, x, x.zone);
  for (const [i, ip] of alts) meta(ip, {}, byN.get(i + 1)?.zone);
  if (p.dest?.ip) meta(p.dest.ip, p.dest, 'app');
  const tb = (st.tb ||= []), hk = Math.floor(t / AT_H) * AT_H;
  let b = tb.find((x) => x.h === hk && x.w === AT_H);
  if (!b) { b = { h: hk, w: AT_H, n: 0, p: {}, s: {}, d: {} }; tb.push(b); tb.sort((x, y) => x.h - y.h || x.w - y.w); }
  b.n++; for (const id of [pid, ...alt]) b.p[id] = (b.p[id] || 0) + 1;
  s.forEach((ip, i) => { if (ip && h[i]) atAcc(b.s, ip, ...h[i]); });
  for (const [i, ip] of alts) atAcc(b.s, ip, ...h[i]);
  if (d) atAcc(b.d, d[0] || '?', d[1], d[2], d[3], d[4]);
  if (p.mtu) b.mtu = p.mtu;
  atRollup(st, now);
  return tr;
}
/* Hours older than two days become six-hour sums; a week is the limit; distinct paths and names are capped. */
function atRollup(st, now = Date.now()) {
  const out = [], cut = now - 48 * AT_H, old = now - 7 * 86400_000;
  for (const b of st.tb || []) {
    if (b.h + b.w <= old) continue;
    if (b.h < cut && b.w < AT_6H) {
      const k = Math.floor(b.h / AT_6H) * AT_6H;
      let m = out.find((x) => x.h === k && x.w === AT_6H); if (!m) { m = { h: k, w: AT_6H, n: 0, p: {}, s: {}, d: {} }; out.push(m); }
      atBuckJoin(m, b);
    } else out.push(b);
  }
  st.tb = out.sort((x, y) => x.h - y.h || x.w - y.w);
  const pd = st.pd || {}, used = new Set();
  for (const tr of st.traces || []) { used.add(tr.pid); for (const a of tr.alt || []) used.add(a); }
  for (const b of st.tb) for (const id of Object.keys(b.p)) used.add(id);
  for (const id of Object.keys(pd)) if (!used.has(id)) delete pd[id];
  const ids = Object.keys(pd);
  if (ids.length > AT_PD_MAX) for (const id of ids.sort((x, y) => pd[x].u - pd[y].u).slice(0, ids.length - AT_PD_MAX)) { delete pd[id]; for (const b of st.tb) delete b.p[id]; }
  const hm = st.hm || {}, ips = Object.keys(hm).filter((ip) => { if (hm[ip].l < old) { delete hm[ip]; return false; } return true; });
  if (ips.length > AT_HM_MAX) for (const ip of ips.sort((x, y) => hm[x].l - hm[y].l).slice(0, ips.length - AT_HM_MAX)) delete hm[ip];
}
/* What was seen in a time window: path ids with counts, sums per address and for the app. The kept traces when they
   reach back far enough, else the hourly / six-hourly sums. */
function atObs(st, from, to) {
  const o = { n: 0, p: {}, s: {}, d: {}, mtu: null, first: null, last: null };
  const raw = (st.traces || []).filter((tr) => tr.pid), rawFrom = raw.length ? Date.parse(raw[0].at) : Infinity;
  if (from >= rawFrom - 60_000) {
    for (const tr of raw) {
      const t = Date.parse(tr.at), s = st.pd?.[tr.pid]?.s; if (t < from || t > to || !s) continue;
      o.n++; for (const id of [tr.pid, ...(tr.alt || [])]) if (st.pd[id]) o.p[id] = (o.p[id] || 0) + 1;
      s.forEach((ip, i) => { if (ip && tr.h?.[i]) atAcc(o.s, ip, ...tr.h[i]); });
      for (const id of tr.alt || []) (st.pd[id]?.s || []).forEach((ip, i) => { if (ip && ip !== s[i] && tr.h?.[i]) atAcc(o.s, ip, ...tr.h[i]); });
      if (tr.d) atAcc(o.d, tr.d[0] || '?', tr.d[1], tr.d[2], tr.d[3], tr.d[4]);
      if (tr.mtu) o.mtu = tr.mtu; o.first ??= t; o.last = t;
    }
  } else for (const b of st.tb || []) { if (b.h >= to || b.h + b.w <= from) continue; atBuckJoin(o, b); o.first ??= b.h; o.last = Math.max(o.last || 0, b.h + b.w); }
  return o;
}
/* Merge paths into one graph. paths: [{ s: [ip or null, hop by hop], c: traces, tag?, dk?: the app's node }]. A router is
   one node however many paths cross it (by address); a hop that didn't answer is a "no reply" node between the hops
   around it. s: sums per address, dest: { [dk]: { acc, ips, name, asn, org, cc } }, meta(ip): what's known about it. */
function atMerge(paths, { s = {}, dest = {}, meta = () => ({}), n = null } = {}) {
  const nodes = new Map(), edges = new Map(), total = n || paths.reduce((a, p) => a + p.c, 0) || 1;
  const node = (k, o) => { let x = nodes.get(k); if (!x) { x = { k, c: 0, ns: [], tags: new Set(), ...o }; nodes.set(k, x); } return x; };
  const you = node('you', { kind: 'you', ip: null, zone: 'home' });
  for (const p of paths) {
    const seq = ['you'], dk = p.dk || 'dest';
    p.s.forEach((ip, i) => {
      let k;
      if (ip) { k = seq.includes(ip) ? `${ip}#${i + 1}` : ip; node(k, { kind: 'hop', ip }); }
      else { k = `*${i + 1}:${[...seq].reverse().find((x) => !x.startsWith('*'))}`; node(k, { kind: 'silent', ip: null }); }
      const x = nodes.get(k); x.c += p.c; if (!x.ns.includes(i + 1)) x.ns.push(i + 1); if (p.tag) x.tags.add(p.tag); seq.push(k);
    });
    const dn = node(dk, { kind: 'dest', ip: null }); dn.c += p.c; seq.push(dk);
    you.c += p.c; for (const k of [dk, 'you']) if (p.tag) nodes.get(k).tags.add(p.tag);
    for (let i = 1; i < seq.length; i++) {
      const ek = `${seq[i - 1]}\n${seq[i]}`, e = edges.get(ek) || { a: seq[i - 1], b: seq[i], c: 0, tags: new Set() };
      e.c += p.c; if (p.tag) e.tags.add(p.tag); edges.set(ek, e);
    }
  }
  const fill = (x, a) => {
    if (!a) return;
    x.min = a[6] ? at1(a[0]) : null; x.avg = a[6] ? at1(a[1] / a[6]) : null; x.max = a[6] ? at1(a[2]) : null; x.loss = a[4] ? Math.round(a[3] / a[4]) : null;
    x.jit = a[6] > 1 ? at1(Math.sqrt(Math.max(0, a[5] / a[6] - (a[1] / a[6]) ** 2))) : null;
  };
  for (const x of nodes.values()) {
    x.c = Math.min(x.c, total);   // a trace that saw two routers at one hop counts once
    if (x.kind === 'hop') {
      fill(x, s[x.ip]); const m = meta(x.ip) || {};
      Object.assign(x, { name: m.nm || null, zone: m.z || (atPrivate(x.ip) ? 'home' : 'internet'), asn: m.a || null, org: m.o || null, cc: m.cc || null, f: m.f || null, l: m.l || null, mtu: m.mtu || null });
    } else if (x.kind === 'dest') {
      const d = dest[x.k] || {}; fill(x, d.acc);
      Object.assign(x, { ip: d.ips?.[0] || null, ips: d.ips?.length > 1 ? d.ips : undefined, name: d.name || null, zone: 'app', asn: d.asn || null, org: d.org || null, cc: d.cc || null, f: d.f || null, l: d.l || null, mtu: d.mtu || null });
    }
  }
  for (const e of edges.values()) e.c = Math.min(e.c, total);
  return { n: total, nodes: [...nodes.values()], edges: [...edges.values()] };
}
/* Lay the graph out in columns, left (home) to right (the app): the longest way from home decides a node's column,
   so a branch that skips a hop still rejoins in the right place; long links get waypoints so they don't cut through
   other nodes; nodes in a column are ordered to cross as little as possible (a few up-and-down passes), and the
   busiest path runs straight along the middle. Positions are columns and lanes - the page turns them into pixels
   (sideways on a wide screen, top to bottom on a phone). Exported for tests. */
function atLayout(g, { center = false } = {}) {
  const out = new Map(), inn = new Map();
  for (const x of g.nodes) { out.set(x.k, []); inn.set(x.k, []); }
  for (const e of g.edges) { out.get(e.a).push(e); inn.get(e.b).push(e); }
  for (const l of out.values()) l.sort((p, q) => q.c - p.c);
  const mark = new Map(), post = [];   // a routing loop (a router seen before and after another): that link is drawn but not followed
  const visit = (k) => { mark.set(k, 1); for (const e of out.get(k)) { const m = mark.get(e.b); if (m === 1) e.back = true; else if (!m) visit(e.b); } mark.set(k, 2); post.push(k); };
  if (out.has('you')) visit('you'); for (const x of g.nodes) if (!mark.has(x.k)) visit(x.k);
  const col = new Map();
  for (const k of post.reverse()) col.set(k, Math.max(0, ...inn.get(k).filter((e) => !e.back).map((e) => (col.get(e.a) ?? 0) + 1)));
  const lastCol = Math.max(0, ...g.nodes.filter((x) => x.kind !== 'dest').map((x) => col.get(x.k))) + 1;
  for (const x of g.nodes) if (x.kind === 'dest') col.set(x.k, lastCol);
  const items = new Map(), add = (id, c, w) => items.set(id, { id, col: c, w, up: [], down: [] });
  for (const x of g.nodes) add(x.k, col.get(x.k), x.c);
  for (const e of g.edges) {
    const chain = [e.a];
    if (!e.back) for (let c = col.get(e.a) + 1; c < col.get(e.b); c++) { const id = `~${e.a}\n${e.b}\n${c}`; add(id, c, e.c); chain.push(id); }
    chain.push(e.b); e.chain = chain;
    if (!e.back && col.get(e.b) > col.get(e.a)) for (let i = 1; i < chain.length; i++) { items.get(chain[i - 1]).down.push([chain[i], e.c]); items.get(chain[i]).up.push([chain[i - 1], e.c]); }
  }
  const cols = Math.max(1, ...[...items.values()].map((it) => it.col + 1)), layers = Array.from({ length: cols }, () => []);
  const placed = new Set(), walk = (id) => { if (placed.has(id)) return; placed.add(id); const it = items.get(id); layers[it.col].push(id); for (const [d] of it.down.slice().sort((p, q) => q[1] - p[1])) walk(d); };
  walk('you'); for (const id of items.keys()) walk(id);
  const pos = new Map(); layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  const bary = (id, dir) => { let s = 0, w = 0; for (const [o, c] of items.get(id)[dir]) { s += pos.get(o) * c; w += c; } return w ? s / w : pos.get(id); };
  const sweep = (c, dir) => { const b = new Map(layers[c].map((id) => [id, bary(id, dir)])); layers[c].sort((p, q) => b.get(p) - b.get(q)); layers[c].forEach((id, i) => pos.set(id, i)); };
  for (let it = 0; it < 4; it++) { for (let c = 1; c < cols; c++) sweep(c, 'up'); for (let c = cols - 2; c >= 0; c--) sweep(c, 'down'); }
  const main = new Set();
  for (let id = 'you'; id && items.has(id) && !main.has(id);) { main.add(id); id = items.get(id).down.slice().sort((p, q) => q[1] - p[1])[0]?.[0]; }
  const n = g.n || 1;
  for (const l of layers) {
    const m = l.findIndex((id) => main.has(id)), mid = center || m < 0 ? (l.length - 1) / 2 : m;
    l.forEach((id, i) => { items.get(id).y = i - mid; });
    if (!center && l.length === 2 && l.every((id) => items.get(id).w / n >= 0.3)) { items.get(l[0]).y = -0.5; items.get(l[1]).y = 0.5; }   // an even split: a diamond
  }
  for (const x of g.nodes) { const it = items.get(x.k); x.col = it.col; x.y = it.y; }
  for (const e of g.edges) { e.pts = e.chain.map((id) => [items.get(id).col, items.get(id).y]); delete e.chain; }
  const ys = [...items.values()].map((it) => it.y);
  g.layout = { cols, y0: Math.min(0, ...ys), y1: Math.max(0, ...ys) };
  return g;
}
/* What each hop adds: the delay between neighbors (delta latency) on every link, the share of loss that carries on to
   the app (loss at one router only is that router skipping replies), and where trouble starts - loss that carries
   through, or a link much slower than it usually is and staying slower after it. A big jump that's usual (a long
   cable under the sea) is marked as a jump, not as trouble. Exported for tests. */
function atAnalyze(g, { usual = {}, usualDest = null } = {}) {
  const N = new Map(g.nodes.map((x) => [x.k, x])), inn = new Map(), out = new Map();
  for (const x of g.nodes) { inn.set(x.k, []); out.set(x.k, []); }
  for (const e of g.edges) if (!e.back) { inn.get(e.b).push(e); out.get(e.a).push(e); }
  const order = g.nodes.slice().sort((p, q) => p.col - q.col), ref = new Map(), uref = new Map();
  const wmean = (list, f) => { let s = 0, w = 0; for (const e of list) { const v = f(e); if (v != null) { s += v * e.c; w += e.c; } } return w ? s / w : null; };
  for (const x of order) {
    x.usual = x.kind === 'dest' ? usualDest ?? null : x.ip ? usual[x.ip] ?? null : null;
    if (x.kind === 'you') { ref.set(x.k, 0); uref.set(x.k, 0); continue; }
    const up = wmean(inn.get(x.k), (e) => ref.get(e.a)), uup = wmean(inn.get(x.k), (e) => uref.get(e.a));
    ref.set(x.k, x.avg ?? up); uref.set(x.k, x.usual ?? uup);
    x.add = x.avg != null && up != null ? at1(Math.max(0, x.avg - up)) : null;
  }
  for (const e of g.edges) {
    const b = N.get(e.b), ra = ref.get(e.a), ua = uref.get(e.a);
    e.dl = b.avg != null && ra != null ? at1(b.avg - ra) : null; e.udl = b.usual != null && ua != null ? at1(b.usual - ua) : null;
  }
  const below = (k) => { const seen = new Set(), stack = [k]; while (stack.length) for (const e of out.get(stack.pop())) if (!seen.has(e.b)) { seen.add(e.b); stack.push(e.b); } return [...seen].map((id) => N.get(id)); };
  for (const x of g.nodes) {
    if (x.loss == null || x.kind === 'you') continue;
    const later = below(x.k).filter((y) => y.loss != null && (y.avg != null || y.kind === 'dest'));
    x.lossOn = later.length ? Math.min(x.loss, ...later.map((y) => y.loss)) : x.loss;
  }
  let trouble = null;
  const dests = g.nodes.filter((x) => x.kind === 'dest'), endLoss = dests.some((x) => x.loss != null) ? Math.max(...dests.map((x) => x.loss ?? 0)) : null;
  if (dests.length === 1 && endLoss >= 100 && dests[0].avg == null) trouble = { k: dests[0].k, kind: 'down' };
  else if (endLoss == null || endLoss >= 5) {
    const x = order.find((y) => y.kind !== 'you' && (y.lossOn ?? 0) >= 5 && inn.get(y.k).every((e) => (N.get(e.a).lossOn ?? 0) < 5));
    if (x) trouble = { k: x.k, kind: 'loss', loss: x.lossOn };
  }
  for (const e of g.edges.slice().sort((p, q) => N.get(p.a).col - N.get(q.a).col)) {
    if (e.dl == null || e.back) continue;
    const later = [N.get(e.b), ...below(e.b)].filter((y) => y.avg != null), ra = ref.get(e.a);
    if (e.udl != null) {
      const extra = e.dl - e.udl;
      if (extra >= Math.max(20, Math.abs(e.udl) * 0.5) && later.every((y) => y.usual == null || y.avg - y.usual >= extra * 0.6)) { e.bad = true; if (!trouble) trouble = { k: e.b, kind: 'delay', ms: Math.round(extra), from: e.a }; }
    }
    if (e.dl >= 30 && later.every((y) => y.avg >= ra + e.dl * 0.6)) e.jump = true;
  }
  g.trouble = trouble;
  return g;
}
/* Bands by whose network it is, as runs of columns: your home, your internet provider, each network in between (by
   number), and the app's network. A column goes with its busiest node; a column of "no reply" hops with its neighbors. */
function atBands(g) {
  const key = (x) => (x.kind === 'you' || x.zone === 'home' ? 'home' : x.kind === 'dest' || x.zone === 'app' ? 'app' : x.zone === 'provider' ? 'provider' : x.asn ? `AS${x.asn}` : 'internet');
  const byCol = Array.from({ length: g.layout.cols }, () => []);
  for (const x of g.nodes) byCol[x.col].push(x);
  const keys = byCol.map((l) => { const r = l.filter((x) => x.kind !== 'silent').sort((p, q) => q.c - p.c)[0]; return r ? key(r) : null; });
  for (let c = 0; c < keys.length; c++) if (keys[c] == null) {
    const prev = keys.slice(0, c).reverse().find(Boolean), next = keys.slice(c + 1).find(Boolean);
    keys[c] = prev === next ? prev : prev === 'home' && next ? next : prev || next || 'internet';
  }
  const bands = [];
  keys.forEach((k, c) => { const b = bands[bands.length - 1]; if (b && b.key === k) b.c1 = c; else bands.push({ key: k, c0: c, c1: c }); });
  for (const b of bands) {
    const ns = g.nodes.filter((x) => x.col >= b.c0 && x.col <= b.c1), own = ns.filter((x) => x.asn && x.kind !== 'silent').sort((p, q) => q.c - p.c)[0];
    Object.assign(b, { zone: b.key.startsWith('AS') ? 'internet' : b.key, asn: own?.asn || null, org: own?.org || null, hops: ns.filter((x) => x.kind === 'hop' || x.kind === 'silent').length });
    for (const x of ns) if (x.kind === 'silent') x.zone = b.zone;
  }
  return bands;
}
/* Merge, lay out, read: the whole graph for the page. Exported for tests. */
function atGraph(paths, opts = {}) {
  const g = atMerge(paths, opts);
  atLayout(g, opts); atAnalyze(g, opts); g.bands = atBands(g);
  for (const x of g.nodes) { x.tags = [...x.tags]; x.share = Math.round(x.c / g.n * 100) / 100; x.y = Math.round(x.y * 100) / 100; }
  for (const e of g.edges) { e.tags = [...e.tags]; e.share = Math.round(e.c / g.n * 100) / 100; }
  return g;
}
const atPathsOf = (st, o, tag) => Object.entries(o.p).map(([id, c]) => (st.pd?.[id] ? { s: st.pd[id].s, c, tag } : null)).filter(Boolean);
function atDestOf(st, accs, name) {
  let acc = null; const ips = [];
  for (const o of accs) for (const [ip, a] of Object.entries(o.d)) { acc = atAccJoin(acc, a.slice()); if (ip !== '?' && !ips.includes(ip)) ips.push(ip); }
  const m = st.hm?.[ips[0]] || {};
  return { acc, ips, name: name || m.nm || null, asn: m.a || null, org: m.o || null, cc: m.cc || null, f: m.f || null, l: m.l || null, mtu: m.mtu || null };
}
/* The graph for one test over [from, to]; with cmp, merged with the last hour so the page can show what changed. */
function atGraphFor(st, from, to, { cmp = false, now = Date.now(), name = null } = {}) {
  const o = atObs(st, from, to), nowO = cmp ? atObs(st, now - AT_H, now) : null;
  const paths = [...atPathsOf(st, o, cmp ? 'then' : null), ...(nowO ? atPathsOf(st, nowO, 'now') : [])];
  if (!paths.length) return null;
  const meta = (ip) => { const m = st.hm?.[ip] || {}, own = at.own[ip], asn = m.a || own?.asn || null; return { ...m, a: asn, o: m.o || (asn ? at.asn[asn]?.name : null) || null, cc: m.cc || own?.cc || null }; };
  const s = { ...(nowO?.s || {}) }; for (const [ip, a] of Object.entries(o.s)) s[ip] = a;
  const base = atBaselines(st), usual = {};
  for (const b of st.tb || []) for (const [ip, a] of Object.entries(b.s)) if (a[6]) (usual[ip] ||= []).push(a[1] / a[6]);
  for (const ip of Object.keys(usual)) usual[ip] = atR(atMedian(usual[ip]));
  Object.assign(usual, base.hops);
  const g = atGraph(paths, { s, dest: { dest: atDestOf(st, o.n ? [o] : [nowO], name) }, meta, n: o.n + (nowO?.n || 0), usual, usualDest: base.dest });
  return { from, to, traces: o.n, tracesNow: nowO?.n ?? null, distinct: Object.keys(o.p).length, mtu: o.mtu, first: o.first, last: o.last, ...g };
}
/* Paths to all your apps as one tree from home: where they share hops and where they part. When two or more apps are
   in trouble, the furthest hop they all pass through is marked - a shared provider problem shows up there. */
function atOverview(list) {
  const paths = [], s = {}, dest = {}, metaM = {};
  for (const t of list) {
    const p = t.path; if (!p?.hops?.length) continue;
    const byN = new Map(p.hops.map((h, i) => [h.n || i + 1, h])), arr = [];
    for (let i = 1; i <= Math.max(...byN.keys()); i++) { const h = byN.get(i); arr.push(h?.ip || null); if (h?.ip) { atAcc(s, h.ip, h.min, h.avg, h.max, h.loss); metaM[h.ip] = { nm: h.name, z: h.zone, a: h.asn, o: h.org, cc: h.cc }; } }
    const dk = `dest:${t.id}`, d = p.dest || {}; paths.push({ s: arr, c: 1, tag: t.id, dk });
    dest[dk] = { acc: d.avg != null || d.loss != null ? atAcc({}, 'x', d.min, d.avg, d.max, d.loss) : null, ips: d.ip ? [d.ip] : [], name: t.name, asn: d.asn, org: d.org, cc: d.cc };
  }
  if (paths.length < 2) return null;
  const g = atGraph(paths, { s, dest, meta: (ip) => metaM[ip] || {}, n: paths.length, center: true });
  const ids = paths.map((p) => p.tag), bad = list.filter((t) => ids.includes(t.id) && (t.down || t.slow)).map((t) => t.id);
  const split = g.nodes.filter((x) => x.kind !== 'dest' && x.tags.length === ids.length).sort((p, q) => q.col - p.col)[0] || null;
  // Shared trouble: the furthest hop all the troubled apps pass through - only when the apps that are fine don't pass
  // through it too, or every troubled app's likely culprit is the home or the provider.
  let issue = null;
  const who = (id) => list.find((t) => t.id === id)?.culprit?.who;
  if (bad.length >= 2) {
    const x = g.nodes.filter((y) => y.kind !== 'you' && y.kind !== 'dest' && bad.every((id) => y.tags.includes(id))).sort((p, q) => q.col - p.col)[0], ok = x ? x.tags.filter((id) => !bad.includes(id)) : [];
    if (x && (!ok.length || bad.every((id) => ['home', 'provider'].includes(who(id))))) issue = { k: x.k, apps: bad, ok };
  }
  // and each troubled app's own likely culprit, where it is on the tree
  const marks = bad.map((id) => { const ip = list.find((t) => t.id === id)?.culprit?.ip, x = ip && g.nodes.find((y) => y.ip === ip); return x ? { k: x.k, app: id } : null; }).filter(Boolean);
  for (const x of g.nodes) if (x.kind === 'dest') x.app = x.k.slice(5);
  // bands for the shared part only; after the paths part, each app goes its own way through different networks
  if (split) {
    const sc = split.col, cols = g.layout.cols;
    g.bands = g.bands.filter((b) => b.c0 <= sc).map((b) => ({ ...b, c1: Math.min(b.c1, sc) }));
    if (sc < cols - 1) g.bands.push({ key: 'apps', zone: 'app', c0: sc + 1, c1: cols - 1, asn: null, org: null, hops: g.nodes.filter((x) => x.col > sc && x.kind !== 'dest').length });
  }
  return { ...g, split: split?.k || null, issue, marks, apps: list.filter((t) => ids.includes(t.id)).map((t) => ({ id: t.id, name: t.name, preset: t.preset || null, custom: !!t.custom, short: t.short, down: !!t.down, slow: !!t.slow })) };
}
/* When there's path data, for the strip above the graph: each kept trace, then each hourly / six-hourly sum. */
const atMarks = (st) => ({ traces: (st.traces || []).filter((tr) => tr.pid).map((tr) => Date.parse(tr.at)), buckets: (st.tb || []).map((b) => [b.h, b.w, b.n]) });

/* ---- the likely culprit ----
   Nodes run from the home to the app. Loss counts only when it carries on to the app (a router that doesn't bother
   answering traces drops probes aimed at itself, not your traffic). Delay counts where it starts and stays: a hop
   slower than its usual, and everything after it too - or, before there's a usual, a big jump that stays.
   ctx: { down, slow, run (the latest test), med (the day's medians: wait, connect), othersDown, othersUp }.
   Answer: { who: 'home' | 'provider' | 'internet' | 'app' | 'dns' | null, kind, hop, ms, loss, org, sure }. Exported for tests. */
function atCulprit(path, ctx = {}) {
  const run = ctx.run || {}, hops = path?.hops || [], dest = path?.dest || null;
  const nodes = [...hops, ...(dest && (dest.avg != null || dest.loss != null) ? [{ ...dest, zone: 'app' }] : [])];
  const pick = (who, kind, n = {}, extra = {}) => ({ who, kind, hop: n.n ?? null, org: n.org || null, ip: n.ip || null, sure: true, ...extra });
  if (run.errKind === 'dns' || (ctx.kind === 'dns' && ctx.down)) return pick('dns', 'dns');
  if (ctx.kind === 'router' && ctx.down) return pick('home', 'down');
  if ((ctx.down || ctx.slow) && (ctx.othersDown || 0) >= 2 && !(ctx.othersUp > 0)) {
    const router = hops.find((h) => h.zone === 'home');
    return router && router.ip ? pick('provider', 'many', {}, { sure: false }) : pick('home', 'many', {}, { sure: false });
  }
  const answering = nodes.filter((x) => x.ip && x.loss != null && x.loss < 100 || x.dest && x.avg != null);
  // 1. loss that carries through to the app
  const endLoss = dest?.loss ?? null;
  if (endLoss != null && endLoss >= 10 && endLoss < 100) {
    for (let i = 0; i < answering.length; i++) {
      if (answering[i].loss >= 10 && answering.slice(i).every((x) => x.loss >= 10)) return pick(answering[i].zone, 'loss', answering[i], { loss: answering[i].loss });
    }
  }
  // 2. nothing gets through: where the path stops
  if (ctx.down && (endLoss === 100 || endLoss == null) && run.connect == null && run.errKind !== 'answer') {
    if (!hops.length) return ctx.othersUp > 0 ? pick('app', 'down', {}, { sure: false }) : pick(null, 'unknown');
    const last = [...hops].reverse().find((h) => h.ip);
    if (!last) return pick('home', 'stops', hops[0] || {}, { sure: false });
    if (last.zone === 'home') return pick('provider', 'stops', last, { sure: ctx.othersUp === 0 });
    if (last.zone === 'provider' && !(ctx.othersUp > 0)) return pick('provider', 'stops', last, { sure: false });
    return pick('app', 'down', last, { sure: ctx.othersUp > 0 });
  }
  // 3. delay that starts somewhere and stays
  const base = ctx.base || { hops: {}, dest: null };
  const usual = (x) => (x.dest ? base.dest : base.hops[x.ip]) ?? null;
  const lift = answering.map((x) => (x.avg != null && usual(x) != null ? x.avg - usual(x) : null));
  for (let i = 0; i < answering.length; i++) {
    const u = usual(answering[i]), up = lift[i]; if (up == null || up < Math.max(25, u * 0.5)) continue;
    const later = lift.slice(i + 1).filter((v) => v != null);
    if (!later.length || atMedian(later) >= up * 0.6) return pick(answering[i].zone, 'delay', answering[i], { ms: Math.round(up) });
  }
  if (ctx.slow && !Object.keys(base.hops).length) {
    let prev = 0;
    for (let i = 0; i < answering.length; i++) {
      const x = answering[i]; if (x.avg == null) continue;
      const jump = x.avg - prev;
      if (jump >= 40 && answering.slice(i + 1).every((y) => y.avg == null || y.min == null || y.min >= prev + jump * 0.7)) return pick(x.zone, 'delay', x, { ms: Math.round(jump), sure: false });
      prev = Math.max(prev, x.avg);
    }
  }
  // 4. the network is fine but the app is slow to answer (or answered with an error)
  if (ctx.down || ctx.slow) {
    if (run.errKind === 'answer' || run.errKind === 'wait' || (run.wait != null && ctx.med?.wait != null && run.wait > 2 * ctx.med.wait + 200)) return pick('app', 'answer');
    if (ctx.othersUp > 0) return pick('app', ctx.down ? 'down' : 'answer', {}, { sure: false });
  }
  return pick(null, 'ok');
}
const AT_WHO = { home: 'your Wi-Fi or router', provider: 'your internet provider', internet: 'a network between your provider and the app', app: 'the app itself', dns: 'name lookups (DNS), which your router or internet provider handles' };
function atCulpritText(c, name) {
  if (!c?.who) return '';
  const where = AT_WHO[c.who] + (c.who === 'internet' && c.org ? ` (${c.org})` : '');
  const at_ = c.hop ? ` at hop ${c.hop}` : ' there';
  if (c.kind === 'loss') return `Likely cause: ${where} - traffic is being lost from${c.hop ? ` hop ${c.hop}` : ' there'} on (${c.loss}% loss).`;
  if (c.kind === 'delay') return `Likely cause: ${where} - the slowdown starts${at_}, about ${c.ms} ms more than usual.`;
  if (c.kind === 'stops') return `Likely cause: ${where} - the path stops answering after hop ${c.hop || 1}.`;
  if (c.kind === 'many') return `Likely cause: ${where} - several apps are having trouble at the same time.`;
  if (c.kind === 'answer') return `Likely cause: ${where} - the network to ${name} looks fine, but it's slow to answer.`;
  if (c.kind === 'dns') return `Likely cause: name lookups (DNS) - ${name}'s address couldn't be looked up; that's your router or your internet provider.`;
  return `Likely cause: ${where}.`;
}

/* ---- schedule: every minute, run what's due (three at a time, so they don't crowd each other) ---- */
async function atTick() {
  if (!isConfigured() || isDemo() || atTick.busy) return;
  atTick.busy = true;
  try { await atTickNow(); } finally { atTick.busy = false; }
}
const atActive = () => { const pro = proStatus().pro; return atCfg().filter((t) => pro || !t.custom).slice(0, atMax()); };
async function atTickNow() {
  const now = Date.now(), pro = proStatus().pro, list = atActive();
  const due = list.filter((t) => { const st = at.state[t.id]; const every = (pro ? t.every : Math.max(5, t.every || 5)) * 60_000; return !st?.last || now - Date.parse(st.last.at) >= every - 5000; });
  for (let i = 0; i < due.length; i += 3) await Promise.all(due.slice(i, i + 3).map((t) => atRun(t).catch(() => {})));
  // Paths: a test that just started failing or slowing first (a fresh look at where), then the two most overdue.
  const trouble = list.filter((t) => { const st = at.state[t.id]; return st?.last && atTarget(t) && (st.fails >= 1 || st.slow >= 1) && (!st.pathAt || now - st.pathAt >= 4 * 60_000); });
  const overdue = list.filter((t) => at.state[t.id]?.last && atTarget(t) && !trouble.includes(t) && (!at.state[t.id].pathAt || now - at.state[t.id].pathAt >= AT_PATH_EVERY)).sort((a, b) => (at.state[a.id].pathAt || 0) - (at.state[b.id].pathAt || 0));
  for (const t of [...trouble, ...overdue].slice(0, 2)) await atTracePath(t).catch(() => {});
  for (const id of Object.keys(at.state)) if (!atCfg().some((t) => t.id === id)) { delete at.state[id]; at.dirty = true; }
}
setTimeout(() => { atTick().catch(() => {}); setInterval(() => atTick().catch(() => {}), 60_000).unref?.(); }, 30_000).unref?.();

/* What's going on with one test right now, with the culprit when there's trouble. */
function atNow(t) {
  const st = at.state[t.id] || {}, kind = atKind(t), down = (st.fails || 0) >= 2, slow = (st.slow || 0) >= 2;
  if (!down && !slow) return { down, slow, culprit: null };
  const others = atActive().filter((x) => x.id !== t.id && at.state[x.id]?.last && atKind(x) === 'web');
  const day = (st.runs || []).filter((r) => r.ok && Date.now() - Date.parse(r.at) < 86400_000);
  const culprit = atCulprit(st.path, { down, slow, kind, run: st.last, base: atBaselines(st), med: { wait: atMedian(day.map((r) => r.wait)), connect: atMedian(day.map((r) => r.connect)) },
    othersDown: others.filter((x) => (at.state[x.id].fails || 0) >= 1).length, othersUp: others.filter((x) => at.state[x.id].last.ok).length });
  return { down, slow, culprit };
}
/* Alerts (Pro, read every minute by 40-alerts.js): one per app that's down or has been slow for a while, saying
   what's likely to blame. When several are down and it's the home or the provider, that's one alert, not five. */
function appTestAlerts() {
  if (isDemo() || !proStatus().pro) return [];
  if (typeof alerts === 'object' && alerts.open?.internet) return [];   // the internet is down: that one alert says it all
  const bad = atActive().filter((t) => t.alert !== false).map((t) => ({ t, ...atNow(t) })).filter((x) => x.down || (x.slow && (at.state[x.t.id]?.slow || 0) >= 3));
  const shared = bad.filter((x) => x.down && ['home', 'provider', 'dns'].includes(x.culprit?.who));
  if (shared.length >= 3) {
    const who = shared[0].culprit.who;
    return [{ id: 'apptest:many', severity: 'warning', title: `${shared.length} apps aren't answering from home`, body: `Likely cause: ${AT_WHO[who]}. Affected: ${shared.map((x) => x.t.name).join(', ')}.`, source: 'apptests', url: '/#network' },
      ...bad.filter((x) => !shared.includes(x)).map((x) => atAlertOf(x))];
  }
  return bad.map(atAlertOf);
}
const atAlertOf = ({ t, down, culprit }) => ({ id: `apptest:${t.id}`, severity: down ? 'warning' : 'notice', title: down ? `${t.name} isn't answering from home` : `${t.name} is slow from home`,
  body: atCulpritText(culprit, t.name) || (down ? at.state[t.id]?.last?.error || '' : ''), source: 'apptests', url: '/#network' });

/* ---- what the app gets ---- */
const atMedian = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
function atHoursView(st) {
  return (st.hours || []).map((b) => ({ at: new Date(b.h).toISOString(), n: b.n, up: b.n ? Math.round(b.ok / b.n * 1000) / 10 : null, latency: b.latN ? atR(b.lat / b.latN) : null, loss: b.lossN ? Math.round(b.loss / b.lossN * 10) / 10 : null, total: b.totN ? Math.round(b.tot / b.totN) : null }));
}
function atPathView(st) {
  const p = st.path; if (!p) return null;
  const base = atBaselines(st), seen = (ip) => (st.traces || []).filter((tr) => atTrHops(st, tr).hops.some(([x]) => x === ip)).length;
  return { ...p, traces: (st.traces || []).length, hops: (p.hops || []).map((h) => ({ ...h, usual: h.ip ? base.hops[h.ip] ?? null : null, seen: h.ip ? seen(h.ip) : 0 })), dest: p.dest ? { ...p.dest, usual: base.dest } : null };
}
function atView(t, full = false) {
  const st = at.state[t.id] || { runs: [] }, runs = st.runs || [], last = st.last || null, day = runs.filter((r) => Date.now() - Date.parse(r.at) < 86400_000), kind = atKind(t);
  const now = atNow(t);
  const v = { id: t.id, name: t.name, url: kind === 'web' ? t.url : null, kind, preset: t.preset || null, short: t.short || (t.name || '?')[0].toUpperCase(), custom: !!t.custom, every: t.every || 5, alert: t.alert !== false,
    last, down: now.down, failing: (st.fails || 0) >= 1, slow: now.slow, culprit: now.culprit,
    uptime24h: day.length ? Math.round(day.filter((r) => r.ok).length / day.length * 1000) / 10 : null,
    median24h: atMedian(day.filter((r) => r.ok).map((r) => r.total)),
    spark: day.slice(-96).map((r) => (r.ok ? r.total : -1)),
    pathChangedAt: st.changedAt || null, hops: st.path?.hops?.length ? st.path.hops.length + 1 : null };
  if (full) Object.assign(v, { runs: day.map((r) => ({ at: r.at, ok: r.ok, total: r.total, dns: r.dns, connect: r.connect, tls: r.tls, wait: r.wait, download: r.download, latency: r.latency, loss: r.loss, jitter: r.jitter, error: r.error })),
    hours: atHoursView(st), changes: st.changes || [], path: atPathView(st), prevPath: st.prevPath || null });
  return v;
}
async function atTraceInfo() {
  const tools = await atTools();
  return { ok: tools.length > 0, tool: tools[0]?.tool || null, platform: process.platform };
}
const atPresetsOut = (cc) => AT_PRESETS.filter((p) => !p.cc || !cc || p.cc.includes(cc)).map(({ id, name, group, short, kind, cc: c }) => ({ id, name, group, short, kind, regional: !!c, needs: id === 'sharepoint' ? 'tenant' : null }));
const atHomeCc = () => (typeof homeCountry === 'function' ? homeCountry(config.location) : null);
app.get('/api/apptests', async (_req, res) => {
  if (isDemo()) return res.json(atDemo());
  const pro = proStatus().pro;
  res.json({ pro, max: atMax(), basicMax: AT_BASIC_MAX, every: pro ? AT_EVERY : [5, 15], groups: AT_GROUPS, presets: atPresetsOut(atHomeCc()), owners: atOwnersOn(),
    trace: await atTraceInfo(), traceroute: (await atTools()).length > 0, tests: atCfg().map((t) => ({ ...atView(t), paused: !pro && t.custom })),
    overview: atOverview(atActive().filter((t) => atKind(t) === 'web').map((t) => ({ ...t, path: at.state[t.id]?.path, ...atNow(t) }))) });
});
app.get('/api/apptests/:id', (req, res) => {
  if (isDemo()) { const d = atDemo(true).tests.find((t) => t.id === req.params.id); return d ? res.json(d) : res.status(404).json({ error: 'not found' }); }
  const t = atCfg().find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ error: 'That test is gone.' });
  res.json(atView(t, true));
});
/* Make a test from a preset or an address (also used by setup). Returns { test } or { error, status }. */
function atMake(b, list, pro) {
  if (b.preset) {
    const p = atPreset(String(b.preset)); if (!p) return { status: 400, error: 'Pick an app from the list.' };
    let url = p.url, name = p.name;
    if (p.id === 'sharepoint') {
      const tenant = String(b.tenant || '').trim().toLowerCase().replace(/\.sharepoint\.com.*$/, '').replace(/^https?:\/\//, '');
      if (!/^[a-z0-9-]{1,60}$/.test(tenant)) return { status: 400, error: 'Enter your company\'s SharePoint name - the part before .sharepoint.com.' };
      url = p.url.replace('{tenant}', tenant); name = `SharePoint (${tenant})`;
    }
    if (list.some((x) => x.url === url)) return { status: 400, error: `${name} is already tested.` };
    return { test: { id: crypto.randomBytes(5).toString('hex'), preset: p.id, name, url, short: p.short, ...(p.kind !== 'web' ? { kind: p.kind } : {}) } };
  }
  if (!pro) return { status: 402, error: 'Testing your own websites is a CasaTorch Pro feature.' };
  const u = atParseUrl(b.url); if (!u) return { status: 400, error: 'Enter a web address, like https://example.com.' };
  if (list.some((x) => x.url === u.url)) return { status: 400, error: 'That address is already tested.' };
  return { test: { id: crypto.randomBytes(5).toString('hex'), custom: true, name: String(b.name || '').trim().slice(0, 40) || u.host, url: u.url } };
}
app.post('/api/apptests', requireRole('admin'), express.json({ limit: '2kb' }), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const b = req.body || {}, pro = proStatus().pro, list = atCfg();
  if (list.length >= atMax()) return res.status(400).json({ error: pro ? `Up to ${AT_PRO_MAX} tests - remove one first.` : `Up to ${AT_BASIC_MAX} tests on Basic - remove one first, or go Pro for up to ${AT_PRO_MAX}.` });
  const m = atMake(b, list, pro); if (m.error) return res.status(m.status).json({ error: m.error, ...(m.status === 402 ? { upgrade: 'https://casatorch.com/pro' } : {}) });
  const t = m.test, every = Number(b.every); t.every = (pro ? AT_EVERY : [5, 15]).includes(every) ? every : 5;
  saveConfig({ ...config, appTests: [...list, t] });
  await atRun(t).catch(() => {});
  atTracePath(t).catch(() => {});   // takes up to a minute; shows up when it's done
  res.json({ ok: true, test: atView(t) });
});
app.put('/api/apptests/settings', requireRole('admin'), express.json({ limit: '1kb' }), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  if ('owners' in (req.body || {})) saveConfig({ ...config, appTestsOwners: !!req.body.owners });
  res.json({ ok: true, owners: atOwnersOn() });
});
app.put('/api/apptests/:id', requireRole('admin'), express.json({ limit: '1kb' }), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const pro = proStatus().pro, b = req.body || {};
  const list = atCfg().map((t) => {
    if (t.id !== req.params.id) return t;
    const n = { ...t };
    if ('every' in b) { const e = Number(b.every); if (!(pro ? AT_EVERY : [5, 15]).includes(e)) return t; n.every = e; }
    if ('alert' in b) n.alert = !!b.alert;
    if ('name' in b && String(b.name).trim()) n.name = String(b.name).trim().slice(0, 40);
    return n;
  });
  saveConfig({ ...config, appTests: list }); res.json({ ok: true });
});
app.post('/api/apptests/:id/run', requireRole('member'), async (req, res) => {
  if (isDemo()) return res.json(atDemo(true).tests.find((t) => t.id === req.params.id) || {});
  const t = atCfg().find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ error: 'That test is gone.' });
  if (t.custom && !proStatus().pro) return res.status(402).json({ error: 'Testing your own websites is a CasaTorch Pro feature.' });
  await atRun(t);
  if (req.query.path === '1') await atTracePath(t);
  res.json(atView(t, true));
});
app.delete('/api/apptests/:id', requireRole('admin'), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  saveConfig({ ...config, appTests: atCfg().filter((t) => t.id !== req.params.id) }); delete at.state[req.params.id]; at.dirty = true;
  res.json({ ok: true });
});

/* ---- setup: "Want CasaTorch to keep an eye on the apps you use?" ---- */
/* Suggested for where the home is (and its language when the country isn't known yet): the router and DNS, a search,
   video, the country's own TV, and a video-call app. Work apps are there to pick, not pre-picked. */
const AT_LANG_CC = { de: 'DE', fr: 'FR', es: 'ES', it: 'IT', nl: 'NL', sv: 'SE', pl: 'PL', ja: 'JP', ko: 'KR', zh: 'CN', hi: 'IN', pt: 'BR', tr: 'TR' };
function atSuggest(cc, lang) {
  const c = /^[A-Z]{2}$/.test(String(cc || '')) ? cc : AT_LANG_CC[String(lang || '').slice(0, 2)] || 'US';
  const regional = AT_PRESETS.filter((p) => p.cc?.includes(c)).map((p) => p.id);
  const picks = c === 'CN' ? ['router', 'dns', 'baidu', 'bilibili', 'm365'] : ['router', 'dns', c === 'KR' ? 'naver' : 'google', 'youtube', ...(regional.filter((id) => id !== 'naver').slice(0, 1)), 'netflix', ['DE', 'FR', 'NL', 'SE', 'PL', 'IT', 'ES'].includes(c) ? 'teams' : 'zoom'];
  return { cc: c, picks: [...new Set(picks)].slice(0, 7) };
}
app.get('/api/setup/apptests', (req, res) => {
  const s = atSuggest(String(req.query.cc || '').toUpperCase(), String(req.query.lang || ''));
  const pro = proStatus().pro;
  res.json({ ...s, pro, trial: proStatus().plan === 'trial', max: atMax(), basicMax: AT_BASIC_MAX, every: pro ? AT_EVERY : [5, 15], groups: AT_GROUPS, presets: atPresetsOut(s.cc).filter((p) => p.id !== 'sharepoint') });
});
/* Setup's answers into tests: { want, picks, custom: [{ name, url }], every, alert }. Running setup again keeps the
   history of tests still picked; "Not now" leaves things as they are. Called from setupFinish (05-setup.js). */
function atFromSetup(ans, prev) {
  const old = Array.isArray(prev) ? prev : [];
  if (!ans || ans.want !== 'yes') return old.length ? old : undefined;
  const pro = proStatus().pro, every = (pro ? AT_EVERY : [5, 15]).includes(Number(ans.every)) ? Number(ans.every) : 5, alert = ans.alert !== 'no';
  const out = [], max = atMax();
  for (const id of (Array.isArray(ans.picks) ? ans.picks : []).map(String)) {
    if (out.length >= max) break;
    const keep = old.find((t) => t.preset === id); if (keep) { out.push({ ...keep, every, alert }); continue; }
    const m = atMake({ preset: id }, out, pro); if (m.test) out.push({ ...m.test, every, alert });
  }
  for (const c of (Array.isArray(ans.custom) ? ans.custom : []).slice(0, 10)) {
    if (out.length >= max || !c?.url) continue;
    const keep = old.find((t) => t.custom && t.url === atParseUrl(c.url)?.url); if (keep) { out.push({ ...keep, every, alert }); continue; }
    const m = atMake({ url: c.url, name: c.name }, out, pro); if (m.test) out.push({ ...m.test, every, alert });
  }
  for (const t of old) if (t.preset === 'sharepoint' && !out.includes(t) && out.length < max) out.push(t);   // asked for by name in the Network tab, not in setup
  setTimeout(() => atTick().catch(() => {}), 8000).unref?.();   // first results within seconds of finishing
  return out;
}
const atSetupCurrent = () => { const l = atCfg(); return l.length ? { want: 'yes', picks: l.filter((t) => t.preset && t.preset !== 'sharepoint').map((t) => t.preset), custom: l.filter((t) => t.custom).map((t) => ({ name: t.name, url: t.url })), every: l[0].every || 5, alert: l[0].alert === false ? 'no' : 'yes' } : {}; };

/* ---- the demo house: made-up but realistic numbers, the same every load ----
   Documentation addresses (192.0.2.x, 198.51.100.x, 203.0.113.x) and private-use network numbers (64500-65534) only,
   with plainly made-up names. The provider spreads traffic over two routers (a branch that rejoins), one of its routers
   skips trace replies (harmless), Teams goes through a transit network that has started losing traffic, Zoom's route
   moved three hours ago, and Netflix stopped answering half an hour ago. A week of traces is run through the same
   code as real ones (atRecord), so the graph, the strip and the overview are what a real home would see. */
const AT_DEMO_HOP = (ip, name, asn, org, zone, ms, extra = {}) => ({ ip, name, asn, org, cc: asn ? 'US' : null, zone, ms, ...extra });   // scrub-ok: demo
const AT_DEMO_NET = {
  home: AT_DEMO_HOP('192.168.1.1', null, null, null, 'home', 0.6),   // scrub-ok: demo
  isp: [AT_DEMO_HOP('198.51.100.1', 'lo0.bras1.example-broadband.net', 64500, 'Example Broadband', 'provider', 8.9, { skips: true }),   // scrub-ok: demo
    [AT_DEMO_HOP('198.51.100.17', 'be-10.agg1.example-broadband.net', 64500, 'Example Broadband', 'provider', 10.2), AT_DEMO_HOP('198.51.100.21', 'be-11.agg2.example-broadband.net', 64500, 'Example Broadband', 'provider', 11.4)],   // scrub-ok: demo
    AT_DEMO_HOP('198.51.100.5', 'core1.example-broadband.net', 64500, 'Example Broadband', 'provider', 12.1), null],   // scrub-ok: demo
};
const AT_DEMO_TR = (ip, name, ms) => AT_DEMO_HOP(ip, name, 64501, 'Transit Example', 'internet', ms);
const AT_DEMO_TESTS = {
  'demo-m365': { preset: 'm365', base: 38, seed: 11, tail: [AT_DEMO_TR('203.0.113.40', 'ae25-0.icr01.transit-example.net', 14.8), AT_DEMO_HOP('203.0.113.77', null, 64510, 'Example Cloud', 'app', 15.9)],   // scrub-ok: demo
    dest: ['203.0.113.10', 64510, 'Example Cloud', 16.8] },   // scrub-ok: demo
  'demo-teams': { preset: 'teams', base: 41, seed: 23, slow: true, bad: { since: 50 * 60_000, from: 0, ms: 58, loss: 14 },
    tail: [AT_DEMO_TR('203.0.113.41', 'ae26-0.icr02.transit-example.net', 15.2), AT_DEMO_TR('203.0.113.45', 'ae3-0.icr02.transit-example.net', 15.9), AT_DEMO_HOP('203.0.113.78', null, 64510, 'Example Cloud', 'app', 16.4)],   // scrub-ok: demo
    dest: ['203.0.113.12', 64510, 'Example Cloud', 17.2] },   // scrub-ok: demo
  'demo-zoom': { preset: 'zoom', base: 52, seed: 37, changeAt: 3 * 3600_000 + 60_000, mtuAt: 4 * 86400_000,
    tail: [AT_DEMO_HOP('198.51.100.9', 'xe-0-1-0.edge3.example-backbone.net', 64502, 'Example Backbone', 'internet', 21.7), AT_DEMO_HOP('198.51.100.33', null, 64511, 'Example Video', 'app', 23.4)],   // scrub-ok: demo
    old: [AT_DEMO_TR('203.0.113.40', 'ae25-0.icr01.transit-example.net', 14.8), AT_DEMO_TR('203.0.113.52', 'ae7-0.icr03.transit-example.net', 19.8), AT_DEMO_HOP('203.0.113.90', null, 64511, 'Example Video', 'app', 24.9)],   // scrub-ok: demo
    dest: ['198.51.100.200', 64511, 'Example Video', 24.3] },   // scrub-ok: demo
  'demo-google': { preset: 'google', base: 22, seed: 41, tail: [AT_DEMO_HOP('192.0.2.14', null, 64512, 'Example Search', 'app', 13.1)], dest: ['192.0.2.80', 64512, 'Example Search', 13.6] },   // scrub-ok: demo
  'demo-netflix': { preset: 'netflix', base: 30, seed: 53, down: true, tail: [AT_DEMO_HOP('198.51.100.71', 'ipv4.example-cdn.net', 64513, 'Example Streaming', 'app', 16.6)], dest: ['198.51.100.240', 64513, 'Example Streaming', 17.4] },   // scrub-ok: demo
};
const atDemoRand = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
/* One made-up trace at time t (k: how many traces ago). */
function atDemoTrace(cfg, t, k, now) {
  const rnd = atDemoRand(cfg.seed * 7919 + k * 104729 + 1), hr = new Date(t).getHours(), ev = hr >= 19 && hr <= 23 ? 2.5 : 0;
  const bad = cfg.bad && now - t < cfg.bad.since, down = cfg.down && now - t < 35 * 60_000;
  const hop = (x, n, lift = 0, loss = 0) => {
    const j = rnd(), avg = at1(x.ms * (1 + j * 0.07) + (x.ms > 2 ? ev : 0) + lift);
    return { n, ip: x.ip, name: x.name, asn: x.asn, org: x.org, cc: x.cc, zone: x.zone, sent: 10, loss: x.skips ? 20 + Math.round(rnd() * 4) * 10 : loss, min: at1(Math.max(0.2, avg * 0.9 - j)), avg, max: at1(avg * 1.22 + 1 + j * 3) };
  };
  const [ispA, branch, core] = AT_DEMO_NET.isp, tail = cfg.old && now - t > cfg.changeAt ? cfg.old : cfg.tail;
  const hops = [hop(AT_DEMO_NET.home, 1), hop(ispA, 2), hop(branch[k % 5 < 3 ? 0 : 1], 3), hop(core, 4), { n: 5, ip: null, sent: 10, loss: 100, min: null, avg: null, max: null }];
  tail.forEach((x, i) => hops.push(bad && i >= cfg.bad.from ? hop(x, 6 + i, cfg.bad.ms, cfg.bad.loss) : hop(x, 6 + i)));
  const [ip, asn, org, ms] = cfg.dest, j = rnd(), dAvg = down ? null : at1(ms * (1 + j * 0.06) + ev + (bad ? cfg.bad.ms : 0));
  const dest = { ip, name: new URL(atPreset(cfg.preset).url).hostname, asn, org, cc: 'US', zone: 'app', dest: true, sent: 5, from: 'probe', loss: down ? 100 : bad ? cfg.bad.loss : 0,
    min: dAvg == null ? null : at1(dAvg * 0.92), avg: dAvg, max: dAvg == null ? null : at1(dAvg * 1.2 + 1) };
  return { at: new Date(t).toISOString(), tool: 'mtr', mtu: cfg.mtuAt && now - t > cfg.mtuAt ? 1492 : 1500, hops, dest };
}
const atDemoCache = new Map();
/* A week of made-up traces for one demo test, kept for five minutes. */
function atDemoState(id) {
  const cfg = AT_DEMO_TESTS[id]; if (!cfg) return null;
  const c = atDemoCache.get(id); if (c && Date.now() - c.made < 5 * 60_000) return c.st;
  const now = Date.now(), st = { runs: [] }; let prev = null;
  for (let k = 7 * 96 - 1; k >= 0; k--) { const t = now - 4 * 60_000 - k * 15 * 60_000, p = atDemoTrace(cfg, t, k, now); atNoteChange(st, prev, p); atRecord(st, p, t); prev = p; }
  st.path = prev; atDemoCache.set(id, { made: now, st });
  return st;
}
function atDemo(full = false) {
  const mk = (id) => {
    const cfg = AT_DEMO_TESTS[id], p = atPreset(cfg.preset), { base } = cfg, rnd = atDemoRand(id.length * 7919 + base), now = Date.now(), st = atDemoState(id);
    const runs = Array.from({ length: 288 }, (_, i) => {
      const bad = cfg.down && i > 280, slow = cfg.slow && i > 278, j = rnd(), dns = 4 + j * 6, connect = base * 0.32 + j * 4 + (slow ? 70 : 0), tls = base * 0.38 + j * 5 + (slow ? 80 : 0), wait = base * 0.9 + j * 30 + (i > 150 && i < 170 ? 120 : 0) + (slow ? 300 : 0), download = 6 + j * 20;
      return { at: new Date(now - (287 - i) * 300_000).toISOString(), ok: !bad, total: bad ? 15000 : Math.round(dns + connect + tls + wait + download), dns: Math.round(dns * 10) / 10, connect: bad ? null : Math.round(connect * 10) / 10, tls: bad ? null : Math.round(tls * 10) / 10, wait: bad ? null : Math.round(wait * 10) / 10, download: bad ? null : Math.round(download * 10) / 10,
        latency: bad ? null : Math.round((base * 0.32 + j * 3 + (slow ? 70 : 0)) * 10) / 10, jitter: bad ? null : Math.round(j * 30) / 10, loss: bad ? 100 : slow ? 14 : j > 0.97 ? 20 : 0, error: bad ? 'no answer in 15 seconds (connect)' : null, errKind: bad ? 'connect' : null };
    });
    const last = runs[runs.length - 1];
    const hours = Array.from({ length: 168 }, (_, i) => { const r = rnd(), hr = new Date(now - (167 - i) * 3600_000).getHours(), evening = hr >= 19 && hr <= 23;
      return { at: new Date(Math.floor(now / 3600_000) * 3600_000 - (167 - i) * 3600_000).toISOString(), n: 12, up: cfg.down && i > 166 ? 50 : i === 70 ? 91.7 : 100, latency: atR(base * 0.33 + r * 3 + (evening ? 6 : 0) + (cfg.slow && i > 166 ? 60 : 0)), loss: i === 70 ? 8.3 : cfg.slow && i > 166 ? 12 : r > 0.95 ? 1.7 : 0, total: Math.round(base * 2.6 + r * 40 + (evening ? 30 : 0)) }; });
    const down = !!cfg.down, slow = !!cfg.slow, path = atPathView(st);
    const culprit = down || slow ? atCulprit(st.path, { down, slow, kind: 'web', run: last, base: atBaselines(st), med: { wait: atMedian(runs.map((r) => r.wait)) }, othersDown: 0, othersUp: 4 }) : null;
    const v = { id, name: p.name, url: p.url, kind: 'web', preset: cfg.preset, short: p.short, custom: false, every: 5, alert: true, last: { ...last, ip: cfg.dest[0], status: down ? null : 200 }, down, failing: down, slow, culprit,
      uptime24h: down ? 97.6 : 100, median24h: atMedian(runs.filter((r) => r.ok).map((r) => r.total)), spark: runs.slice(-96).map((r) => (r.ok ? r.total : -1)), pathChangedAt: st.changedAt || null, hops: path.hops.length + 1 };
    return full ? { ...v, runs, hours, changes: st.changes || [], path, prevPath: st.prevPath || null } : { ...v, _path: st.path };
  };
  const tests = Object.keys(AT_DEMO_TESTS).map(mk);
  const overview = full ? null : atOverview(tests.map((t) => ({ ...t, path: t._path })));
  for (const t of tests) delete t._path;
  return { pro: true, max: AT_PRO_MAX, basicMax: AT_BASIC_MAX, every: AT_EVERY, demo: true, owners: true, groups: AT_GROUPS, trace: { ok: true, tool: 'mtr', platform: 'linux' }, traceroute: true, presets: atPresetsOut('US'), tests, overview };
}
/* The merged path for a time window: ?from&to (ms; default the last hour), &cmp=1 to compare with the last hour. */
app.get('/api/apptests/:id/graph', (req, res) => {
  const demo = isDemo(), id = String(req.params.id);
  const t = demo ? (AT_DEMO_TESTS[id] ? { id, url: atPreset(AT_DEMO_TESTS[id].preset).url, kind: 'web' } : null) : atCfg().find((x) => x.id === id);
  if (!t) return res.status(404).json({ error: 'That test is gone.' });
  const st = (demo ? atDemoState(id) : at.state[t.id]) || {}, now = Date.now(), q = req.query, host = atKind(t) === 'web' ? atParseUrl(t.url)?.host || null : null;
  let to = Math.min(now, Number(q.to) || now), from = Number(q.from) || to - AT_H;
  from = Math.max(now - 7 * 86400_000, Math.min(from, to - 10 * 60_000));
  const opts = { cmp: q.cmp === '1', now, name: host };
  let g = atGraphFor(st, from, to, opts);
  if (!g && !q.from && st.traces?.length) { to = Date.parse(st.traces[st.traces.length - 1].at) + 1000; from = to - AT_H; g = atGraphFor(st, from, to, opts); }   // nothing in the last hour (CasaTorch was off, say): the hour up to the latest trace
  res.json({ from, to, now, graph: g, marks: atMarks(st), changes: st.changes || [] });
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchAT = { atParseTrace, atZones, atCulprit, atCulpritText, atPathKey, atParseOrigin, atParseAsName, atRevName, atSuggest, atFromSetup, atIsSlow, atBaselines,
  atRecord, atObs, atMerge, atLayout, atAnalyze, atGraph, atGraphFor, atOverview, atDemoState, atDemo };
