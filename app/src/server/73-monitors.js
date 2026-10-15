/* ======================================================================
 * Server monitor (Pro): your NAS, servers and self-hosted apps, up or down.
 *
 * An admin adds what to watch in the Network tab: a web address
 * (http://nas.local:5000, https://plex.example.com) or a host and port
 * (192.168.1.20:22). Every minute CasaTorch checks each one from this
 * computer: a web address is up when it answers (any status below 500), a
 * host and port when it accepts a connection. Two misses in a row raise a
 * "not responding" alert (and a phone alert); it clears by itself. For https
 * addresses it also reads the certificate a few times a day and warns two
 * weeks before it expires.
 *
 * It only looks: nothing is restarted or changed. Up to 30 checks; the last
 * 24 hours are kept in memory and daily downtime goes into the history (and
 * the weekly report).
 * ====================================================================== */
import tls from 'node:tls';
const MON_MAX = 30, MON_EVERY = 60_000;
const mon = { state: {} };   // id -> { results: [ms or -1, ...last 1440], fails, lastMs, lastAt, status, error, cert: { days, at } }
const monitorsCfg = () => (Array.isArray(config.monitors) ? config.monitors : []);
function parseTarget(raw) {
  const s = String(raw || '').trim();
  if (/^https?:\/\//i.test(s)) {
    try { const u = new URL(s); if (!u.hostname || u.username || u.password) return null; return { kind: 'http', target: u.toString() }; } catch { return null; }
  }
  const m = s.match(/^(\[[0-9a-f:]+\]|[a-z0-9.-]+):(\d{1,5})$/i);
  if (m && Number(m[2]) > 0 && Number(m[2]) < 65536) return { kind: 'tcp', target: `${m[1]}:${Number(m[2])}`, host: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]) };
  return null;
}
async function checkOne(m) {
  const t0 = Date.now();
  if (m.kind === 'tcp') {
    const p = parseTarget(m.target); const ms = p ? await tcpMs(p.host, p.port, 5000) : null;
    return ms == null ? { up: false, error: 'no connection' } : { up: true, ms: Math.round(ms) };
  }
  try {
    const r = await fetch(m.target, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } });
    r.body?.cancel?.().catch?.(() => {});
    return r.status < 500 ? { up: true, ms: Date.now() - t0, status: r.status } : { up: false, status: r.status, error: `answered ${r.status}` };
  } catch (e) {
    // Home servers often use their own (self-signed) certificate: if the address answers over TLS, it's up.
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altname/i.test(String(e?.cause?.code || e?.cause?.message || ''))) { const c = await certDays(m.target); if (c) return { up: true, ms: Date.now() - t0, note: 'its own certificate' }; }
    return { up: false, error: /timeout|abort/i.test(String(e?.name || e?.message)) ? 'no answer in 8 seconds' : String(e?.cause?.code || e?.message || 'unreachable').slice(0, 60) };
  }
}
const certDays = (url) => new Promise((ok) => {
  let u; try { u = new URL(url); } catch { return ok(null); }
  if (u.protocol !== 'https:') return ok(null);
  const s = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: /^[\d.]+$|:/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, timeout: 6000 }, () => {
    const c = s.getPeerCertificate(); s.end();
    ok(c?.valid_to ? { days: Math.floor((Date.parse(c.valid_to) - Date.now()) / 86400_000), trusted: s.authorized } : null);
  });
  s.on('error', () => ok(null)); s.on('timeout', () => { s.destroy(); ok(null); });
});
let monBusy = false;
async function runMonitors() {
  if (monBusy) return; monBusy = true;
  try {
    const list = monitorsCfg(), now = Date.now(), day = dayOf(now);
    await Promise.all(list.map(async (m) => {
      const st = (mon.state[m.id] ||= { results: [], fails: 0 });
      const r = await checkOne(m);
      st.results.push(r.up ? r.ms : -1); if (st.results.length > 1440) st.results.splice(0, st.results.length - 1440);
      st.fails = r.up ? 0 : st.fails + 1; st.lastAt = new Date(now).toISOString(); st.lastMs = r.up ? r.ms : null; st.status = r.status ?? null; st.error = r.up ? null : r.error;
      if (!r.up) { const d = (hist.days[day] ||= blankDay()); d.monDown ||= {}; d.monDown[m.name] = (d.monDown[m.name] || 0) + MON_EVERY / 60_000; }
      if (m.kind === 'http' && /^https:/i.test(m.target) && (!st.cert || now - Date.parse(st.cert.at) > 6 * 3600_000)) { const c = await certDays(m.target); st.cert = { ...(c || {}), at: new Date(now).toISOString() }; }
    }));
    for (const id of Object.keys(mon.state)) if (!list.some((m) => m.id === id)) delete mon.state[id];
  } finally { monBusy = false; }
}
setInterval(() => { if (isConfigured() && !isDemo() && proStatus().pro && monitorsCfg().length) runMonitors().catch(() => {}); }, MON_EVERY).unref?.();

/* Read by the alert check every minute (40-alerts.js). */
function monitorAlerts() {
  if (isDemo() || !proStatus().pro) return [];
  const out = [];
  for (const m of monitorsCfg()) {
    const st = mon.state[m.id]; if (!st) continue;
    if (st.fails >= 2) out.push({ id: `server:${m.id}`, severity: 'warning', title: `${m.name} is not responding`, source: 'monitor' });
    if (st.cert?.days != null && st.cert.days <= 14) out.push({ id: `cert:${m.id}`, severity: st.cert.days <= 3 ? 'warning' : 'notice', title: st.cert.days < 0 ? `${m.name}: its certificate has expired` : `${m.name}: its certificate expires in ${st.cert.days} day${st.cert.days === 1 ? '' : 's'}`, source: 'monitor' });
  }
  return out;
}
function monView(m, st) {
  const res = st?.results || [], ok = res.filter((x) => x >= 0), last = res.slice(-60);
  return { id: m.id, name: m.name, kind: m.kind, target: m.target, up: st ? st.fails === 0 && res.length > 0 : null, down: (st?.fails || 0) >= 2, ms: st?.lastMs ?? null, error: st?.error || null, checkedAt: st?.lastAt || null,
    uptime24h: res.length ? Math.round(ok.length / res.length * 1000) / 10 : null, avgMs: ok.length ? Math.round(ok.reduce((s, x) => s + x, 0) / ok.length) : null, recent: last, cert: st?.cert?.days != null ? { days: st.cert.days, trusted: !!st.cert.trusted } : null };
}
const DEMO_MON = [['NAS (Synology)', 'http://nas.local:5000', 24, 100], ['Plex', 'http://192.168.1.20:32400/web', 41, 99.7], ['Home Assistant', 'http://homeassistant.local:8123', 18, 100], ['Pi-hole', '192.168.1.5:53', 3, 100], ['Backup server', 'https://backup.example.com', null, 96.2]];
app.get('/api/monitors', (_req, res) => {
  if (isDemo()) return res.json({ pro: true, max: MON_MAX, monitors: DEMO_MON.map(([name, target, ms, up], i) => ({ id: `demo${i}`, name, kind: target.includes('://') ? 'http' : 'tcp', target, up: ms != null, down: ms == null, ms, error: ms == null ? 'no answer in 8 seconds' : null, checkedAt: new Date().toISOString(), uptime24h: up, avgMs: ms, recent: Array.from({ length: 60 }, (_, k) => (ms == null && k > 52 ? -1 : (ms || 30) + ((k * 7) % 9))), cert: target.startsWith('https') ? { days: 61, trusted: true } : null })) });
  if (!proStatus().pro) return res.json({ pro: false, max: MON_MAX, monitors: [] });
  res.json({ pro: true, max: MON_MAX, monitors: monitorsCfg().map((m) => monView(m, mon.state[m.id])) });
});
app.post('/api/monitors', requireRole('admin'), requirePro, express.json({ limit: '2kb' }), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const name = String(req.body?.name || '').trim().slice(0, 40), p = parseTarget(req.body?.target);
  if (!name) return res.status(400).json({ error: 'Give it a name, like "NAS" or "Plex".' });
  if (!p) return res.status(400).json({ error: 'Enter a web address (http://nas.local:5000) or a host and port (192.168.1.20:22).' });
  if (monitorsCfg().length >= MON_MAX) return res.status(400).json({ error: `Up to ${MON_MAX} checks - remove one first.` });
  const m = { id: crypto.randomBytes(5).toString('hex'), name, kind: p.kind, target: p.target };
  saveConfig({ ...config, monitors: [...monitorsCfg(), m] });
  const r = await checkOne(m);   // answer right away with a first result
  const st = (mon.state[m.id] = { results: [r.up ? r.ms : -1], fails: r.up ? 0 : 1, lastAt: nowIso(), lastMs: r.up ? r.ms : null, status: r.status ?? null, error: r.up ? null : r.error });
  res.json({ ok: true, monitor: monView(m, st) });
});
app.delete('/api/monitors/:id', requireRole('admin'), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  saveConfig({ ...config, monitors: monitorsCfg().filter((m) => m.id !== req.params.id) }); delete mon.state[req.params.id];
  res.json({ ok: true });
});
