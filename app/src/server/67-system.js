/* ======================================================================
 * Settings › Advanced (admins): how this CasaTorch is doing - version, how it
 * was installed, uptime, memory, storage - its log, a diagnostics file to send
 * to support (no secrets in it), and a restart.
 * ====================================================================== */
function dirSize(dir, depth = 0) {
  let n = 0; if (depth > 6) return 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) n += dirSize(p, depth + 1); else if (e.isFile()) { try { n += fs.statSync(p).size; } catch { /* gone */ } } } } catch { /* unreadable */ }
  return n;
}
let sizeMemo = { at: 0, bytes: 0 };
function systemInfo() {
  if (Date.now() - sizeMemo.at > 10 * 60_000) sizeMemo = { at: Date.now(), bytes: dirSize(DATA_DIR) };
  let disk = null; try { const st = fs.statfsSync?.(DATA_DIR); if (st) disk = { freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize }; } catch { /* not supported here */ }
  const m = process.memoryUsage();
  return { version: VERSION, install: INSTALL, node: process.version, platform: `${os.platform()} ${os.arch()}`, uptimeSec: Math.round(process.uptime()), hostUptimeSec: Math.round(os.uptime()),
    memory: { rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576), hostFreeMB: Math.round(os.freemem() / 1048576), hostTotalMB: Math.round(os.totalmem() / 1048576) },
    load: os.loadavg().map((x) => Math.round(x * 100) / 100), cpus: os.cpus().length, dataMB: Math.round(sizeMemo.bytes / 1048576), disk,
    screensOpen: typeof LIVE === 'object' ? LIVE.clients.size : null, liveHomeAssistant: typeof LIVE === 'object' ? LIVE.ok : null, demo: isDemo(), restart: INSTALL === 'manual' ? 'manual' : 'auto' };
}
app.get('/api/system/info', requireRole('admin'), (_req, res) => res.json(systemInfo()));
app.get('/api/system/log', requireRole('admin'), (req, res) => {
  const lvl = String(req.query.level || ''), q = String(req.query.q || '').toLowerCase().slice(0, 80);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ lines: LOGBUF.filter((l) => (!lvl || lvl === 'all' || (lvl === 'problems' ? l.level !== 'info' : l.level === lvl)) && (!q || l.text.toLowerCase().includes(q))).slice(-400) });
});
/* What support needs to help, and nothing more: no settings values, no names, no addresses - only which kinds of things are set up. */
app.get('/api/system/diagnostics', requireRole('admin'), (_req, res) => {
  const kinds = Object.fromEntries(Object.entries(config || {}).map(([k, v]) => [k, Array.isArray(v) ? `${v.length} item(s)` : v && typeof v === 'object' ? 'set' : typeof v]));
  const out = { made: new Date().toISOString(), info: systemInfo(), configured: kinds, log: LOGBUF.slice(-300) };
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Disposition', `attachment; filename="casatorch-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(logMask(JSON.stringify(out, null, 2)));
});
app.post('/api/system/restart', requireRole('admin'), (req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true });
  if (INSTALL === 'manual') return res.status(409).json({ error: 'This copy was started by hand - stop it and start it again where it runs.' });
  if (req.user && typeof audit === 'function') audit(req, 'restarted');
  res.json({ ok: true }); console.log('Restarting at an admin\'s request.');
  setTimeout(() => process.exit(0), 600);   // the service (launchd, systemd, Windows, Docker, Home Assistant) starts it again
});
