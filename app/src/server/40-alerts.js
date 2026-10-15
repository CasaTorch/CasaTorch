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
const saveAlerts = () => { try { writeFileSafe(ALERTS_FILE, JSON.stringify(alerts), 0o600); } catch { /* next time */ } };
function alertRaise(a) {
  alerts.events.unshift({ at: nowIso(), ...a });
  alerts.events = alerts.events.slice(0, 300);
  saveAlerts();
  if (!isDemo()) notify(a).catch(() => {});   // phones: web app alerts and/or the Home Assistant app
}
async function alertConditions() {
  const found = {};
  const add = (id, x) => { found[id] = { id, ...x }; };
  const want = new Set(config.sensors?.alertOn || ['leak', 'smoke', 'battery']), offline = [];
  const { devices } = await allDevices();
  for (const d of devices) {
    if (d.water && want.has('leak')) add(`leak:${d.id}`, { severity: 'critical', title: `Water detected: ${d.name}`, source: d.provider });
    if (d.smoke && want.has('smoke')) add(`smoke:${d.id}`, { severity: 'critical', title: `Smoke alarm: ${d.name}`, source: d.provider });
    if (d.battery != null && d.battery <= 15 && want.has('battery') && !/phone|ipad|tablet|laptop|macbook|watch|car\b|_car_|vehicle|tesla|\bev\b|ups/i.test(`${d.id} ${d.name}`)) add(`battery:${d.id}`, { severity: 'notice', title: `Low battery (${d.battery}%): ${d.name}`, source: d.provider });
    // "Not responding": every device CasaTorch reaches itself, but from Home Assistant only the ones that
    // matter (cameras, locks, thermostats, leak and smoke sensors) - a big Home Assistant always has some
    // unplugged gadget, and that must not bury the real alerts.
    if (d.online === false && (d.provider !== 'ha' || ['camera', 'lock', 'climate'].includes(d.kind) || d.water != null || d.smoke != null)) offline.push(d);
    if (want.has('temp') && d.tempC != null && (d.tempC < 3 || d.tempC > 35)) add(`temp:${d.id}`, { severity: 'warning', title: `${d.name} is ${d.tempC < 3 ? 'near freezing' : 'very hot'}`, source: d.provider });
  }
  for (const d of offline.slice(0, 10)) add(`offline:${d.id}`, { severity: 'warning', title: `${d.name} is not responding`, source: d.provider });
  if (offline.length > 10) add('offline:more', { severity: 'notice', title: `${offline.length - 10} more devices are not responding`, source: 'casatorch' });
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
