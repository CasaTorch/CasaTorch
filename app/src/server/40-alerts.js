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
/* Written only when something changed: the conditions are looked at every minute, and rewriting the same file
   1,440 times a day wears out the SD card a Raspberry Pi runs from. */
let alertsSaved = '';
const saveAlerts = () => { try { const j = JSON.stringify(alerts); if (j === alertsSaved) return; writeFileSafe(ALERTS_FILE, j, 0o600); alertsSaved = j; } catch { /* next time */ } };
function alertRaise(a) {
  alerts.events.unshift({ at: nowIso(), ...a });
  alerts.events = alerts.events.slice(0, 300);
  saveAlerts();
  if (!isDemo()) notify(a).catch(() => {});   // phones: web app alerts and/or the Home Assistant app
}
/* Safety is never paywalled: water (leak), smoke (smoke, gas and carbon monoxide sensors map to smoke), freezing/very
   hot (temp) alerts and their repeats work the same on Basic as on Pro. Only the comfort extras (repeats for other
   critical alerts, "only when nobody's home") are Pro. Tested in test/unit.mjs. */
const SAFETY_ALERT_KINDS = Object.freeze(['leak', 'smoke', 'temp']);
const isSafetyAlert = (id) => SAFETY_ALERT_KINDS.includes(String(id || '').split(':')[0]);
/* Does this critical alert go out again until someone taps "Got it"? */
const alertRepeats = (a, pro = proStatus().pro) => a?.severity === 'critical' && !a.acked && config.alerts?.repeat !== false && (pro || isSafetyAlert(a.id));
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
  if (typeof monitorAlerts === 'function') for (const m of monitorAlerts()) add(m.id, m);   // the server monitor (Pro)
  if (typeof networkAlerts === 'function') for (const m of networkAlerts()) add(m.id, m);   // network monitoring (Pro)
  if (typeof securityAlerts === 'function') for (const m of securityAlerts()) add(m.id, m);
  if (typeof appTestAlerts === 'function') for (const m of appTestAlerts()) add(m.id, m);
  if (typeof rainWindowAlerts === 'function') for (const m of await rainWindowAlerts()) add(m.id, m);   // a window open while it rains (50l-live3d.js)   // app tests (Pro)   // Security Center: new devices, risky open ports
  if (offline.length > 10) add('offline:more', { severity: 'notice', title: `${offline.length - 10} more devices are not responding`, source: 'casatorch' });
  const net = await internetNow().catch(() => null);
  if (net && !net.online) add('internet', { severity: 'critical', title: 'The internet is down', source: 'internet' });
  const now = nowIso();
  /* Fewer false alarms: a new alert must still be there a minute later before it counts (a sensor that
     blinks offline for a moment, or the internet dropping for a few seconds, doesn't wake anyone up).
     Water and smoke are the exception - those go out straight away. */
  const pending = (alerts.pending ||= {}), seen = new Set(Object.keys(found));
  for (const id of Object.keys(pending)) if (!seen.has(id)) delete pending[id];   // gone again: it was a blip
  for (const id of seen) {
    if (alerts.open[id] || /^(leak|smoke):/.test(id)) continue;
    if (pending[id]) { delete pending[id]; continue; }   // still there a minute later: it counts
    pending[id] = now; delete found[id];
  }
  for (const [id, a] of Object.entries(found)) { const o = alerts.open[id]; found[id] = { ...a, since: o?.since || now, ...(o?.acked ? { acked: o.acked } : {}), pushes: o?.pushes || 0, lastPush: o?.lastPush || null }; }
  for (const id of Object.keys(alerts.open)) if (!found[id]) alertRaise({ id: `cleared:${id}`, severity: 'ok', title: `Cleared: ${alerts.open[id].title}`, source: alerts.open[id].source });
  for (const id of Object.keys(found)) if (!alerts.open[id]) { alertRaise({ ...found[id], id: `${id}:${now}` }); found[id].pushes = 1; found[id].lastPush = now; }
  /* Smart alerts: a critical alert nobody has acknowledged goes out again every 10 minutes, up to 6 times
     (water and smoke on every edition, everything else with Pro). */
  if (!isDemo()) {
    const pro = proStatus().pro;
    for (const a of Object.values(found)) {
      if (!alertRepeats(a, pro) || (a.pushes || 0) >= 6 || !a.lastPush || Date.now() - Date.parse(a.lastPush) < 10 * 60_000) continue;
      a.pushes = (a.pushes || 0) + 1; a.lastPush = now;
      notify({ ...a, id: `${a.id}:repeat`, title: `Still happening: ${a.title}`, body: 'Open CasaTorch and tap "Got it" to stop these reminders.' }).catch(() => {});
    }
  }
  alerts.open = found; saveAlerts();
}
setInterval(() => { if (isConfigured() && !isDemo()) alertConditions().catch(() => {}); }, 60_000).unref?.();
app.get('/api/alerts', (req, res, next) => {
  if (isDemo()) return next();
  const rank = { critical: 0, warning: 1, notice: 2, info: 3, ok: 4 };
  res.json({ now: Object.values(alerts.open).sort((a, b) => rank[a.severity] - rank[b.severity]).map(({ pushes, lastPush, ...a }) => ({ ...a, repeating: alertRepeats(a) })), recent: alerts.events.slice(0, 100) });
});
/* "Got it": stops the reminders for this alert. It stays on the list until the problem clears. */
app.post('/api/alerts/:id/ack', requireRole('member'), (req, res) => {
  const a = Object.hasOwn(alerts.open, req.params.id) ? alerts.open[req.params.id] : null; if (!a) return res.status(404).json({ error: 'That alert has already cleared.' });
  a.acked = { by: req.user?.name || req.user?.username || 'someone', at: nowIso() }; saveAlerts();
  if (typeof audit === 'function' && req.user) audit(req, 'alert-acknowledged', { alert: a.title });
  res.json({ ok: true, acked: a.acked });
});
