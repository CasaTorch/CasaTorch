/* ======================================================================
 * Alerts - the "right now" list, in plain words, with when it started.
 * Two kinds: events pushed by integrations (a doorbell press: alertRaise),
 * and conditions found by looking at devices and the internet each minute
 * (a leak, a low battery, the internet down). A condition alert stays until
 * the condition clears; its "since" is when it was first seen.
 * ====================================================================== */
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const alerts = { events: [], open: {} };
try { Object.assign(alerts, JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'))); } catch { /* first run */ }
const saveAlerts = () => { try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts)); } catch { /* next time */ } };
function alertRaise(a) {
  alerts.events.unshift({ at: nowIso(), ...a });
  alerts.events = alerts.events.slice(0, 300);
  saveAlerts();
}
async function alertConditions() {
  const found = {};
  const add = (id, x) => { found[id] = { id, ...x }; };
  const want = new Set(config.sensors?.alertOn || ['leak', 'smoke', 'battery']);
  const { devices } = await allDevices();
  for (const d of devices) {
    if (d.water && want.has('leak')) add(`leak:${d.id}`, { severity: 'critical', title: `Water detected: ${d.name}`, source: d.provider });
    if (d.smoke && want.has('smoke')) add(`smoke:${d.id}`, { severity: 'critical', title: `Smoke alarm: ${d.name}`, source: d.provider });
    if (d.battery != null && d.battery <= 15 && want.has('battery')) add(`battery:${d.id}`, { severity: 'notice', title: `Low battery (${d.battery}%): ${d.name}`, source: d.provider });
    if (d.online === false) add(`offline:${d.id}`, { severity: 'warning', title: `${d.name} is not responding`, source: d.provider });
    if (want.has('temp') && d.tempC != null && (d.tempC < 3 || d.tempC > 35)) add(`temp:${d.id}`, { severity: 'warning', title: `${d.name} is ${d.tempC < 3 ? 'near freezing' : 'very hot'}`, source: d.provider });
  }
  const net = await internetNow().catch(() => null);
  if (net && !net.online) add('internet', { severity: 'critical', title: 'The internet is down', source: 'internet' });
  const now = nowIso();
  for (const [id, a] of Object.entries(found)) found[id] = { ...a, since: alerts.open[id]?.since || now };
  for (const id of Object.keys(alerts.open)) if (!found[id]) alertRaise({ id: `cleared:${id}`, severity: 'ok', title: `Cleared: ${alerts.open[id].title}`, source: alerts.open[id].source });
  for (const id of Object.keys(found)) if (!alerts.open[id]) alertRaise({ ...found[id], id: `${id}:${now}` });
  alerts.open = found; saveAlerts();
}
setInterval(() => { if (isConfigured() && !isDemo()) alertConditions().catch(() => {}); }, 60_000).unref?.();
app.get('/api/alerts', (req, res, next) => {
  if (isDemo()) return next();
  const rank = { critical: 0, warning: 1, notice: 2, info: 3, ok: 4 };
  res.json({ now: Object.values(alerts.open).sort((a, b) => rank[a.severity] - rank[b.severity]), recent: alerts.events.slice(0, 100) });
});
