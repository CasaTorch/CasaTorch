/* ======================================================================
 * App tests: how well the apps you use answer from your home, and the path
 * your traffic takes to reach them.
 *
 * A test is a web address - one of the common apps below, or (Pro) any
 * website. Every few minutes CasaTorch opens a fresh connection to it from
 * this box and times each step: finding the address (DNS), connecting,
 * the secure handshake, the app's answer, and the download. It also sends
 * five quick connection probes for latency, jitter and loss, and every 15
 * minutes it traces the path, hop by hop, from your router through your
 * internet provider to the app.
 *
 * Everything runs from this box straight to the app: nothing goes through
 * casatorch.com. It only looks - the requests are what a browser opening the
 * page would send, without signing in. The path trace uses the computer's own
 * traceroute (tracert on Windows); if there isn't one, the path is skipped.
 *
 * Basic: the built-in apps, up to 8 tests. Pro: your own websites, up to 30
 * tests, every minute if you like, and an alert when an app stops answering.
 * ====================================================================== */
import dnsCb from 'node:dns';
const AT_EVERY = [1, 5, 15], AT_PATH_EVERY = 15 * 60_000, AT_KEEP = 1440, AT_BASIC_MAX = 8, AT_PRO_MAX = 30;
const AT_PRESETS = [
  // [id, name, group, url, short]
  ['m365', 'Microsoft 365 sign-in', 'work', 'https://login.microsoftonline.com/', 'M'],
  ['outlook', 'Outlook', 'work', 'https://outlook.office365.com/owa/', 'O'],
  ['teams', 'Microsoft Teams', 'work', 'https://teams.microsoft.com/', 'T'],
  ['sharepoint', 'SharePoint and OneDrive', 'work', 'https://{tenant}.sharepoint.com/', 'S'],
  ['gmail', 'Gmail', 'work', 'https://mail.google.com/', 'G'],
  ['gdrive', 'Google Drive', 'work', 'https://drive.google.com/', 'D'],
  ['meet', 'Google Meet', 'work', 'https://meet.google.com/', 'M'],
  ['zoom', 'Zoom', 'work', 'https://zoom.us/', 'Z'],
  ['webex', 'Webex', 'work', 'https://www.webex.com/', 'W'],
  ['slack', 'Slack', 'work', 'https://slack.com/api/api.test', 'S'],
  ['salesforce', 'Salesforce', 'work', 'https://login.salesforce.com/', 'S'],
  ['github', 'GitHub', 'work', 'https://github.com/', 'G'],
  ['google', 'Google Search', 'home', 'https://www.google.com/generate_204', 'G'],
  ['youtube', 'YouTube', 'home', 'https://www.youtube.com/generate_204', 'Y'],
  ['netflix', 'Netflix', 'home', 'https://www.netflix.com/', 'N'],
  ['disney', 'Disney+', 'home', 'https://www.disneyplus.com/', 'D'],
  ['spotify', 'Spotify', 'home', 'https://open.spotify.com/', 'S'],
  ['icloud', 'iCloud', 'home', 'https://www.icloud.com/', 'i'],
  ['amazon', 'Amazon', 'home', 'https://www.amazon.com/', 'A'],
  ['facebook', 'Facebook', 'home', 'https://www.facebook.com/', 'F'],
  ['xbox', 'Xbox', 'home', 'https://www.xbox.com/', 'X'],
  ['playstation', 'PlayStation', 'home', 'https://www.playstation.com/', 'P'],
].map(([id, name, group, url, short]) => ({ id, name, group, url, short }));
const atPreset = (id) => AT_PRESETS.find((p) => p.id === id) || null;
const atCfg = () => (Array.isArray(config.appTests) ? config.appTests : []);
const atMax = () => (proStatus().pro ? AT_PRO_MAX : AT_BASIC_MAX);
const at = { state: {}, busy: new Set(), traceTool: undefined };   // id -> { runs: [...], last, path, prevPath, pathAt, fails }

/* A host we're willing to hand to traceroute: letters, digits, dots and dashes, never starting with a dash. */
const atHostOk = (h) => /^(?!-)[a-z0-9.-]{1,253}$/i.test(h) && !h.includes('..');
function atParseUrl(raw) {
  const s = String(raw || '').trim();
  let u; try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!atHostOk(host) && !net.isIP(host)) return null;
  return { url: u.toString(), host };
}

/* ---- one run: a fresh connection, each step timed ---- */
function atHttp(url) {
  return new Promise((done) => {
    const u = new URL(url), mod = u.protocol === 'https:' ? https : http;
    const t0 = process.hrtime.bigint(), ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
    const r = { ok: false, status: null, ip: null, dns: null, connect: null, tls: null, wait: null, download: null, total: null, bytes: 0, error: null, phase: 'dns' };
    let tDns = null, tConn = null, tTls = null, tFirst = null, finished = false;
    const finish = (err) => {
      if (finished) return; finished = true;
      r.total = Math.round(ms());
      if (err) { r.error = err; r.ok = false; } else r.ok = r.status != null && r.status < 500;
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
      finish(c === 'ENOTFOUND' || c === 'EAI_AGAIN' ? 'its name could not be found (DNS)' : c === 'ECONNREFUSED' ? 'it refused the connection'
        : c === 'ECONNRESET' ? 'the connection was dropped' : /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altname/i.test(c + e?.message) ? 'its certificate is not valid'
          : c === 'ETIMEDOUT' || c === 'EHOSTUNREACH' || c === 'ENETUNREACH' ? 'it could not be reached' : String(e?.message || 'failed').slice(0, 80));
    });
    req.end();
  });
}
/* Five quick connection probes to the app's address: latency, jitter (how much it wobbles) and loss. */
async function atProbe(ip, port) {
  if (!ip) return null;
  const rtts = [];
  for (let i = 0; i < 5; i++) { rtts.push(await tcpMs(ip, port, 2000)); if (i < 4) await new Promise((ok) => setTimeout(ok, 150)); }
  const got = rtts.filter((v) => v != null);
  const jit = got.length > 1 ? got.slice(1).reduce((s, v, i) => s + Math.abs(v - got[i]), 0) / (got.length - 1) : null;
  return { latency: got.length ? Math.round(got.reduce((s, v) => s + v, 0) / got.length * 10) / 10 : null, jitter: jit == null ? null : Math.round(jit * 10) / 10, loss: Math.round((rtts.length - got.length) / rtts.length * 100) };
}
async function atRun(t) {
  if (at.busy.has(t.id)) return at.state[t.id]?.last || null;
  at.busy.add(t.id);
  try {
    const r = await atHttp(t.url);
    const p = r.ip ? await atProbe(r.ip, new URL(t.url).protocol === 'http:' ? 80 : 443) : null;
    const run = { at: nowIso(), ok: r.ok, status: r.status, ip: r.ip, dns: r.dns, connect: r.connect, tls: r.tls, wait: r.wait, download: r.download, total: r.total, bytes: r.bytes, error: r.error,
      latency: p?.latency ?? null, jitter: p?.jitter ?? null, loss: p?.loss ?? null };
    const st = (at.state[t.id] ||= { runs: [], fails: 0 });
    st.runs.push(run); if (st.runs.length > AT_KEEP) st.runs.splice(0, st.runs.length - AT_KEEP);
    st.last = run; st.fails = run.ok ? 0 : st.fails + 1;
    return run;
  } finally { at.busy.delete(t.id); }
}

/* ---- the path: traceroute, then names and "whose network is this" ---- */
async function atTraceTool() {
  if (at.traceTool !== undefined) return at.traceTool;
  const has = (cmd, args) => new Promise((ok) => execFile(cmd, args, { timeout: 5000, windowsHide: true }, (e, out, err) => ok(!e || /usage|traceroute|tracepath|tracert/i.test(String(out) + String(err)))));
  if (process.platform === 'win32') at.traceTool = (await has('tracert', ['/?'])) ? 'tracert' : null;
  else if (await has('traceroute', ['--help']) || fs.existsSync('/usr/sbin/traceroute')) at.traceTool = fs.existsSync('/usr/sbin/traceroute') && process.platform === 'darwin' ? '/usr/sbin/traceroute' : 'traceroute';
  else if (await has('tracepath', ['-V'])) at.traceTool = 'tracepath';
  else at.traceTool = null;
  return at.traceTool;
}
/* Read the tool's output into hops: { n, ip, ms } (ip null = that hop didn't answer). Exported for tests. */
function atParseTrace(text, tool) {
  const hops = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (tool === 'tracert') {
      const m = line.match(/^\s*(\d+)\s+(.*)$/); if (!m) continue;
      const times = [...m[2].matchAll(/(<?\d+)\s*ms/g)].map((x) => (x[1].startsWith('<') ? 0.5 : Number(x[1])));
      const ip = (m[2].match(/(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:]+)\s*$/i) || [])[1] || null;
      hops.set(Number(m[1]), { n: Number(m[1]), ip: times.length ? ip : null, ms: times.length ? Math.min(...times) : null });
    } else if (tool === 'tracepath') {
      const m = line.match(/^\s*(\d+)\??:\s+(\S+)\s+(?:(\d+(?:\.\d+)?)ms)?/); if (!m || m[2] === '[LOCALHOST]') continue;
      const n = Number(m[1]), ip = m[2] === 'no' ? null : m[2], v = m[3] != null ? Number(m[3]) : null;
      const old = hops.get(n); if (!old || (old.ip == null && ip)) hops.set(n, { n, ip, ms: v });
    } else {
      const m = line.match(/^\s*(\d+)\s+(.*)$/); if (!m) continue;
      const ip = (m[2].match(/(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:]{2,})/i) || [])[1] || null;
      const t = m[2].match(/(\d+(?:\.\d+)?)\s*ms/);
      hops.set(Number(m[1]), { n: Number(m[1]), ip, ms: ip && t ? Number(t[1]) : null });
    }
  }
  return [...hops.values()].sort((a, b) => a.n - b.n);
}
const atPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fc|fd)/i.test(ip || '');
const atCgnat = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip || '');
const atDomain = (name) => { const p = String(name || '').toLowerCase().split('.').filter(Boolean); if (p.length < 2) return null; const two = p.slice(-2).join('.'); return /^(co|com|net|org|ac|gov|ne|or)\.[a-z]{2}$/.test(two) && p.length > 2 ? p.slice(-3).join('.') : two; };
async function atReverse(ip) {
  if (!ip || atPrivate(ip)) return null;
  try { return (await Promise.race([dnsP.reverse(ip), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 1500))]))[0] || null; } catch { return null; }
}
/* Who each hop belongs to. Your home is the private addresses; your internet provider is the run of hops after
   that which share a name (an estimate - providers don't label their routers consistently); then the internet. */
function atZones(hops) {
  let i = 0;
  for (; i < hops.length && (hops[i].ip == null || atPrivate(hops[i].ip)); i++) if (hops[i].ip) hops[i].zone = 'home';
  for (let k = 0; k < i; k++) hops[k].zone ||= 'home';
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
async function atTrace(t) {
  const tool = await atTraceTool(), host = atParseUrl(t.url)?.host;
  if (!tool || !host) return { at: nowIso(), hops: [], error: tool ? 'bad address' : 'No traceroute on this computer, so the path can\'t be shown.' };
  const args = tool === 'tracert' ? ['-d', '-h', '24', '-w', '1500', host] : tool === 'tracepath' ? ['-n', '-m', '24', host] : ['-n', '-q', '1', '-w', '2', '-m', '24', host];
  const out = await new Promise((ok) => execFile(tool, args, { timeout: 90_000, windowsHide: true, maxBuffer: 256 * 1024 }, (_e, so) => ok(String(so || ''))));
  let hops = atParseTrace(out, tool === 'tracert' ? 'tracert' : tool === 'tracepath' ? 'tracepath' : 'traceroute');
  // Trailing silent hops past the last one that answered are the app's network not answering traces - drop them.
  while (hops.length && hops[hops.length - 1].ip == null) hops.pop();
  await Promise.all(hops.map(async (h) => { h.name = await atReverse(h.ip); }));
  atZones(hops);
  const st = at.state[t.id] || {};
  const dest = st.last?.ip || null;
  if (hops.length && dest && hops[hops.length - 1].ip === dest) hops.pop();   // shown as the app itself
  return { at: nowIso(), hops, dest: { ip: dest, ms: st.last?.latency ?? null, name: host } };
}
const atPathKey = (p) => (p?.hops || []).filter((h) => h.ip).map((h) => h.ip).join('>');
async function atTracePath(t) {
  if (at.busy.has(`path:${t.id}`)) return null;
  at.busy.add(`path:${t.id}`);
  try {
    const p = await atTrace(t), st = (at.state[t.id] ||= { runs: [], fails: 0 });
    if (st.path && p.hops.length && atPathKey(st.path) !== atPathKey(p)) { st.prevPath = st.path; st.changedAt = p.at; }
    st.path = p; st.pathAt = Date.now();
    return p;
  } finally { at.busy.delete(`path:${t.id}`); }
}

/* ---- schedule: every minute, run what's due (three at a time, so they don't crowd each other) ---- */
async function atTick() {
  if (!isConfigured() || isDemo() || atTick.busy) return;
  atTick.busy = true;
  try { await atTickNow(); } finally { atTick.busy = false; }
}
async function atTickNow() {
  const now = Date.now(), pro = proStatus().pro, list = atCfg().filter((t) => pro || !t.custom).slice(0, atMax());
  const due = list.filter((t) => { const st = at.state[t.id]; const every = (pro ? t.every : Math.max(5, t.every || 5)) * 60_000; return !st?.last || now - Date.parse(st.last.at) >= every - 5000; });
  for (let i = 0; i < due.length; i += 3) await Promise.all(due.slice(i, i + 3).map((t) => atRun(t).catch(() => {})));
  // Paths: the two most overdue each minute, so a long list never ties the box up.
  const paths = list.filter((t) => at.state[t.id]?.last && (!at.state[t.id].pathAt || now - at.state[t.id].pathAt >= AT_PATH_EVERY)).sort((a, b) => (at.state[a.id].pathAt || 0) - (at.state[b.id].pathAt || 0)).slice(0, 2);
  for (const t of paths) await atTracePath(t).catch(() => {});
  for (const id of Object.keys(at.state)) if (!atCfg().some((t) => t.id === id)) delete at.state[id];
}
setTimeout(() => { atTick().catch(() => {}); setInterval(() => atTick().catch(() => {}), 60_000).unref?.(); }, 30_000).unref?.();

/* Alerts (Pro, read every minute by 40-alerts.js): an app that stopped answering. */
function appTestAlerts() {
  if (isDemo() || !proStatus().pro) return [];
  return atCfg().filter((t) => t.alert !== false && (at.state[t.id]?.fails || 0) >= 2)
    .map((t) => ({ id: `apptest:${t.id}`, severity: 'warning', title: `${t.name} isn't answering from home (${at.state[t.id].last?.error || 'error'})`, source: 'apptests' }));
}

/* ---- what the app gets ---- */
const atMedian = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
function atView(t, full = false) {
  const st = at.state[t.id] || { runs: [] }, runs = st.runs, last = st.last || null, day = runs.filter((r) => Date.now() - Date.parse(r.at) < 86400_000);
  const v = { id: t.id, name: t.name, url: t.url, preset: t.preset || null, short: t.short || (t.name || '?')[0].toUpperCase(), custom: !!t.custom, every: t.every || 5, alert: t.alert !== false,
    last, down: (st.fails || 0) >= 2, failing: (st.fails || 0) >= 1,
    uptime24h: day.length ? Math.round(day.filter((r) => r.ok).length / day.length * 1000) / 10 : null,
    median24h: atMedian(day.filter((r) => r.ok).map((r) => r.total)),
    spark: day.slice(-96).map((r) => (r.ok ? r.total : -1)),
    pathChangedAt: st.changedAt || null, hops: st.path ? st.path.hops.length + 1 : null };
  if (full) Object.assign(v, { runs: day.map((r) => ({ at: r.at, ok: r.ok, total: r.total, dns: r.dns, connect: r.connect, tls: r.tls, wait: r.wait, download: r.download, latency: r.latency, loss: r.loss, jitter: r.jitter, error: r.error })), path: st.path || null, prevPath: st.prevPath || null });
  return v;
}
app.get('/api/apptests', async (_req, res) => {
  if (isDemo()) return res.json(atDemo());
  const pro = proStatus().pro;
  res.json({ pro, max: atMax(), basicMax: AT_BASIC_MAX, every: pro ? AT_EVERY : [5, 15], presets: AT_PRESETS.map(({ id, name, group, short }) => ({ id, name, group, short, needs: id === 'sharepoint' ? 'tenant' : null })),
    traceroute: (await atTraceTool()) != null, tests: atCfg().map((t) => ({ ...atView(t), paused: !pro && t.custom })) });
});
app.get('/api/apptests/:id', (req, res) => {
  if (isDemo()) { const d = atDemo(true).tests.find((t) => t.id === req.params.id); return d ? res.json(d) : res.status(404).json({ error: 'not found' }); }
  const t = atCfg().find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ error: 'That test is gone.' });
  res.json(atView(t, true));
});
app.post('/api/apptests', requireRole('admin'), express.json({ limit: '2kb' }), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const b = req.body || {}, pro = proStatus().pro, list = atCfg();
  if (list.length >= atMax()) return res.status(400).json({ error: pro ? `Up to ${AT_PRO_MAX} tests - remove one first.` : `Up to ${AT_BASIC_MAX} tests on Basic - remove one first, or go Pro for up to ${AT_PRO_MAX}.` });
  let t;
  if (b.preset) {
    const p = atPreset(String(b.preset)); if (!p) return res.status(400).json({ error: 'Pick an app from the list.' });
    let url = p.url, name = p.name;
    if (p.id === 'sharepoint') {
      const tenant = String(b.tenant || '').trim().toLowerCase().replace(/\.sharepoint\.com.*$/, '').replace(/^https?:\/\//, '');
      if (!/^[a-z0-9-]{1,60}$/.test(tenant)) return res.status(400).json({ error: 'Enter your company\'s SharePoint name - the part before .sharepoint.com.' });
      url = p.url.replace('{tenant}', tenant); name = `SharePoint (${tenant})`;
    }
    if (list.some((x) => x.url === url)) return res.status(400).json({ error: `${name} is already tested.` });
    t = { id: crypto.randomBytes(5).toString('hex'), preset: p.id, name, url, short: p.short };
  } else {
    if (!pro) return res.status(402).json({ error: 'Testing your own websites is a CasaTorch Pro feature.', upgrade: 'https://casatorch.com/pro' });
    const u = atParseUrl(b.url); if (!u) return res.status(400).json({ error: 'Enter a web address, like https://example.com.' });
    const name = String(b.name || '').trim().slice(0, 40) || u.host;
    if (list.some((x) => x.url === u.url)) return res.status(400).json({ error: 'That address is already tested.' });
    t = { id: crypto.randomBytes(5).toString('hex'), custom: true, name, url: u.url };
  }
  const every = Number(b.every); t.every = (pro ? AT_EVERY : [5, 15]).includes(every) ? every : 5;
  saveConfig({ ...config, appTests: [...list, t] });
  await atRun(t).catch(() => {});
  atTracePath(t).catch(() => {});   // takes up to a minute; shows up when it's done
  res.json({ ok: true, test: atView(t) });
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
  saveConfig({ ...config, appTests: atCfg().filter((t) => t.id !== req.params.id) }); delete at.state[req.params.id];
  res.json({ ok: true });
});

/* ---- the demo house: made-up but realistic numbers, the same every load ---- */
function atDemo(full = false) {
  const seedRand = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const mk = (id, preset, base, hopsTail, down = false) => {
    const p = atPreset(preset), rnd = seedRand(id.length * 7919 + base);
    const runs = Array.from({ length: 288 }, (_, i) => {
      const bad = down && i > 280, j = rnd(), dns = 4 + j * 6, connect = base * 0.32 + j * 4, tls = base * 0.38 + j * 5, wait = base * 0.9 + j * 30 + (i > 150 && i < 170 ? 120 : 0), download = 6 + j * 20;
      return { at: new Date(Date.now() - (287 - i) * 300_000).toISOString(), ok: !bad, total: bad ? 15000 : Math.round(dns + connect + tls + wait + download), dns: Math.round(dns * 10) / 10, connect: Math.round(connect * 10) / 10, tls: Math.round(tls * 10) / 10, wait: Math.round(wait * 10) / 10, download: Math.round(download * 10) / 10,
        latency: bad ? null : Math.round((base * 0.32 + j * 3) * 10) / 10, jitter: bad ? null : Math.round(j * 30) / 10, loss: bad ? 100 : j > 0.97 ? 20 : 0, error: bad ? 'no answer in 15 seconds (wait)' : null };
    });
    const last = runs[runs.length - 1], day = runs;
    const home = [{ n: 1, ip: '192.168.1.1', ms: 0.6, name: null, zone: 'home' }];
    const isp = [{ n: 2, ip: '100.92.0.1', ms: 8.9, name: null, zone: 'provider' }, { n: 3, ip: '198.51.100.1', ms: 10.4, name: 'po-302-1210-rur02.example-isp.net', zone: 'provider' }, { n: 4, ip: '198.51.100.5', ms: 12.1, name: 'be-36-ar01.example-isp.net', zone: 'provider' }, { n: 5, ip: null, ms: null, name: null, zone: 'provider' }];   // scrub-ok: documentation-style demo hops
    const tail = hopsTail.map((h, k) => ({ n: 6 + k, ip: h[0], ms: h[1], name: h[2], zone: 'internet' }));
    const path = { at: new Date(Date.now() - 4 * 60_000).toISOString(), hops: [...home, ...isp, ...tail], dest: { ip: last.ip || '203.0.113.10', ms: last.latency, name: new URL(p.url).hostname } };
    const v = { id, name: p.name, url: p.url, preset, short: p.short, custom: false, every: 5, alert: true, last: { ...last, ip: '203.0.113.10', status: down ? null : 200 }, down, failing: down,
      uptime24h: down ? 97.6 : 100, median24h: atMedian(day.filter((r) => r.ok).map((r) => r.total)), spark: day.slice(-96).map((r) => (r.ok ? r.total : -1)), pathChangedAt: preset === 'zoom' ? new Date(Date.now() - 3 * 3600_000).toISOString() : null, hops: path.hops.length + 1 };
    return full ? { ...v, runs: day, path, prevPath: null } : v;
  };
  const tests = [
    mk('demo-m365', 'm365', 38, [['203.0.113.40', 14.8, 'ae25-0.icr01.example-transit.net'], ['203.0.113.77', 15.9, null]]),   // scrub-ok: demo
    mk('demo-teams', 'teams', 41, [['203.0.113.41', 15.2, 'ae26-0.icr02.example-transit.net']]),   // scrub-ok: demo
    mk('demo-zoom', 'zoom', 52, [['198.51.100.9', 21.7, 'xe-0-1-0.edge3.example-backbone.net'], ['198.51.100.33', 23.4, null]]),   // scrub-ok: demo
    mk('demo-google', 'google', 22, [['192.0.2.14', 13.1, null]]),   // scrub-ok: demo
    mk('demo-netflix', 'netflix', 30, [['198.51.100.71', 16.6, 'ipv4.example-cdn.net']], true),   // scrub-ok: demo
  ];
  return { pro: true, max: AT_PRO_MAX, basicMax: AT_BASIC_MAX, every: AT_EVERY, demo: true, traceroute: true, presets: AT_PRESETS.map(({ id, name, group, short }) => ({ id, name, group, short, needs: id === 'sharepoint' ? 'tenant' : null })), tests };
}
