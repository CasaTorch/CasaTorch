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
function alertRaise(a0) {
  if (!alertTypeAllows(a0)) return;   // turned off in Settings › Alerts: not kept, not pushed (40a-alert-types.js)
  const a = alertTypeLevel(a0);
  alerts.events.unshift({ at: nowIso(), ...a });
  alerts.events = alerts.events.slice(0, 300);
  saveAlerts();
  if (!isDemo()) notify(a).catch(() => {});   // phones: web app alerts and/or the Home Assistant app
}
/* An alert about one person's sign-ins (42g-edge-gate.js: forUser) is for that person and the owners only - in the app,
   in the inbox and on phones. Every other alert is for the whole household, as before. */
const alertForReq = (a, req, signIn = signInOn()) => !a?.forUser || !signIn || req?.user?.id === a.forUser || req?.user?.role === 'owner';
const alertForTarget = (a, t) => !a?.forUser || (!!t?.user && (t.user === a.forUser || userById(t.user)?.role === 'owner'));
/* Safety is never paywalled: water (leak), smoke (smoke, gas and carbon monoxide sensors map to smoke), freezing/very
   hot (temp) alerts and their repeats work the same on Basic as on Pro. Only the comfort extras (repeats for other
   critical alerts, "only when nobody's home") are Pro. Tested in test/unit.mjs. */
const SAFETY_ALERT_KINDS = Object.freeze(['leak', 'smoke', 'temp']);
const isSafetyAlert = (id) => SAFETY_ALERT_KINDS.includes(String(id || '').split(':')[0]);
/* Does this alert go out again until someone taps "Got it"? Critical ones every 10 minutes unless Settings › Alerts
   says otherwise (alertDecide in 40r-alert-rules.js); snoozed or acknowledged ones don't. */
const alertSnoozed = (a, now = Date.now()) => !!a?.snoozed && Date.parse(a.snoozed.until) > now;
const alertRepeatMin = (a, pro = proStatus().pro) => alertDecide(a, { rules: alertRulesHouse(), pro, target: null, device: alertDevCtx(a) }).repeat;
const alertRepeats = (a, pro = proStatus().pro) => !!a && !a.acked && !alertSnoozed(a) && alertRepeatMin(a, pro) > 0;
async function alertConditions() {
  const found = {};
  const add = (id, x) => { found[id] = { id, ...x }; };
  /* Which alerts are on, and their thresholds: Settings › Alerts (40a-alert-types.js). */
  alertTypesEnsure();
  const C = new Map(), cfg = (id) => { if (!C.has(id)) C.set(id, alertTypeCfg(id)); return C.get(id); }, offline = [], camsOff = [];
  const { devices } = await allDevices();
  for (const d of devices) {
    if (d.area) alertDevInfo.set(d.id, { room: d.area, name: d.name });
    if (d.water && cfg('leak').on) add(`leak:${d.id}`, { severity: 'critical', title: `Water detected: ${d.name}`, source: d.provider });
    if (d.smoke && cfg('smoke').on) add(`smoke:${d.id}`, { severity: 'critical', title: `Smoke alarm: ${d.name}`, source: d.provider });
    if (d.battery != null && d.battery <= cfg('battery').pct && cfg('battery').on && !/phone|ipad|tablet|laptop|macbook|watch|car\b|_car_|vehicle|tesla|\bev\b|ups/i.test(`${d.id} ${d.name}`)) add(`battery:${d.id}`, { severity: 'notice', title: `Low battery (${d.battery}%): ${d.name}`, source: d.provider });
    // "Not responding": every device CasaTorch reaches itself, but from Home Assistant only the ones that
    // matter (cameras, locks, thermostats, leak and smoke sensors) - a big Home Assistant always has some
    // unplugged gadget, and that must not bury the real alerts. Cameras are their own type (Security).
    if (d.online === false && d.kind === 'camera') camsOff.push(d);
    else if (d.online === false && (d.provider !== 'ha' || ['lock', 'climate'].includes(d.kind) || d.water != null || d.smoke != null)) offline.push(d);
    // a fridge or freezer has its own limits (Home); it isn't "near freezing"
    if (cfg('temp').on && d.tempC != null && !isFridge(d) && (d.tempC < cfg('temp').low || d.tempC > cfg('temp').high)) add(`temp:${d.id}`, { severity: 'warning', title: `${d.name} is ${d.tempC < cfg('temp').low ? 'near freezing' : 'very hot'}`, source: d.provider });
    for (const f of alertDeviceFinds(d, cfg)) add(f.id, f);   // a door left open, a fridge too warm
  }
  if (cfg('offline').on) for (const d of offline.slice(0, 10)) add(`offline:${d.id}`, { severity: 'warning', title: `${d.name} is not responding`, source: d.provider });
  if (cfg('camoff').on) for (const d of camsOff.slice(0, 10)) add(`camoff:${d.id}`, { severity: 'warning', title: `${d.name} is not responding`, source: d.provider });
  const disk = alertDiskNow(); if (disk) add(disk.id, disk);
  if (typeof monitorAlerts === 'function') for (const m of monitorAlerts()) add(m.id, m);   // the server monitor (Pro)
  if (typeof networkAlerts === 'function') for (const m of networkAlerts()) add(m.id, m);   // network monitoring (Pro)
  if (typeof securityAlerts === 'function') for (const m of securityAlerts()) add(m.id, m);
  if (typeof appTestAlerts === 'function') for (const m of appTestAlerts()) add(m.id, m);
  if (typeof rainWindowAlerts === 'function') for (const m of await rainWindowAlerts()) add(m.id, m);   // a window open while it rains (50l-live3d.js)   // app tests (Pro)   // Security Center: new devices, risky open ports
  if (offline.length > 10 && cfg('offline').on) add('offline:more', { severity: 'notice', title: `${offline.length - 10} more devices are not responding`, source: 'casatorch' });
  const net = await internetNow().catch(() => null);
  if (net && !net.online) add('internet', { severity: 'critical', title: 'The internet is down', source: 'internet' });
  /* Types turned off are left out; "how important" sets the severity. */
  for (const id of Object.keys(found)) { if (!alertTypeAllows(found[id])) delete found[id]; else found[id] = alertTypeLevel(found[id]); }
  /* "Mark resolved": stays off the list while the problem is still there; counts again once it has cleared. */
  const resolved = (alerts.resolved ||= {});
  for (const id of Object.keys(resolved)) { if (found[id]) delete found[id]; else delete resolved[id]; }
  const now = nowIso();
  /* "For longer than N minutes" (a door left open, a device or the internet down): it counts once it has lasted
     that long. Water and smoke never wait. */
  const held = (alerts.held ||= {});
  for (const id of Object.keys(held)) if (!found[id]) delete held[id];
  for (const id of Object.keys(found)) {
    const hm = alertHoldMin(id); if (!hm || alerts.open[id]) { delete held[id]; continue; }
    held[id] ||= now;
    if (Date.now() - Date.parse(held[id]) < hm * 60_000) delete found[id]; else found[id].since = held[id];
  }
  /* Fewer false alarms: a new alert must still be there a minute later before it counts (a sensor that
     blinks offline for a moment, or the internet dropping for a few seconds, doesn't wake anyone up).
     Water and smoke are the exception - those go out straight away. */
  const pending = (alerts.pending ||= {}), seen = new Set(Object.keys(found));
  for (const id of Object.keys(pending)) if (!seen.has(id)) delete pending[id];   // gone again: it was a blip
  for (const id of seen) {
    if (alerts.open[id] || /^(leak|smoke):/.test(id) || alertHoldMin(id)) continue;   // a held one has already lasted
    if (pending[id]) { delete pending[id]; continue; }   // still there a minute later: it counts
    pending[id] = now; delete found[id];
  }
  for (const [id, a] of Object.entries(found)) { const o = alerts.open[id]; found[id] = { ...a, since: o?.since || a.since || now, ...(o?.acked ? { acked: o.acked } : {}), ...(alertSnoozed(o) ? { snoozed: o.snoozed } : {}), ...(o?.flapping ? { flapping: o.flapping } : {}), pushes: o?.pushes || 0, lastPush: o?.lastPush || null }; }
  /* Flap damping (flapStep in 40r-alert-rules.js): something that clears and comes back within 15 minutes is the same
     alert - it reopens without a new push, the history says "on and off" once, and "Cleared" waits until it stays
     cleared. Water and smoke always go out. */
  const flap = (alerts.flap ||= {}), nowMs = Date.now();
  for (const id of Object.keys(alerts.open)) if (!found[id]) {
    const o = alerts.open[id], r = flapStep(flap[id], 'clear', nowMs, isSafetyAlert(id));
    flap[id] = { ...r.st, title: o.title, source: o.source, since: o.since };
    if (r.action === 'clear') alertRaise({ id: `cleared:${id}`, severity: 'ok', title: `Cleared: ${o.title}`, source: o.source });
  }
  for (const id of Object.keys(found)) if (!alerts.open[id]) {
    const was = flap[id], r = flapStep(was, 'raise', nowMs, isSafetyAlert(id)); flap[id] = r.st;
    if (r.action === 'push') { alertRaise({ ...found[id], id: `${id}:${now}` }); found[id].pushes = 1; found[id].lastPush = now; continue; }
    found[id] = { ...found[id], since: was?.since || found[id].since, flapping: r.st.n, pushes: 1, lastPush: now };
    if (r.action === 'note') { alerts.events.unshift({ at: now, ...found[id], id: `${id}:${now}`, title: `${found[id].title} (on and off)`, flapping: true }); alerts.events = alerts.events.slice(0, 300); }
  }
  for (const id of Object.keys(flap)) if (!found[id]) {
    const st = flap[id], r = flapStep(st, 'tick', nowMs);
    if (r.st) flap[id] = { ...st, ...r.st }; else delete flap[id];
    if (r.action === 'clear' && st?.title) alertRaise({ id: `cleared:${id}`, severity: 'ok', title: `Cleared: ${st.title}`, source: st.source });
  }
  for (const id of Object.keys(flap)) if (!flap[id] || !Object.keys(flap[id]).some((k) => k === 'lastClear' || k === 'n')) delete flap[id];
  /* Smart alerts: a critical alert nobody has acknowledged goes out again every 10 minutes (or as Settings › Alerts
     says), up to 6 times (water and smoke on every edition, everything else with Pro). Each phone's own rules
     (quiet hours, "no repeats for me", mutes) still apply to every reminder. */
  if (!isDemo()) {
    const pro = proStatus().pro, max = alertRulesHouse().repeatMax || 6;
    for (const a of Object.values(found)) {
      const every = alertRepeats(a, pro) ? alertRepeatMin(a, pro) : 0;
      if (!every || (a.pushes || 0) >= max || !a.lastPush || Date.now() - Date.parse(a.lastPush) < every * 60_000) continue;
      a.pushes = (a.pushes || 0) + 1; a.lastPush = now;
      notify({ ...a, id: `${a.id}:repeat`, title: `Still happening: ${a.title}`, body: 'Open CasaTorch and tap "Got it" to stop these reminders.' }).catch(() => {});
    }
  }
  alerts.open = found; saveAlerts();
}
setInterval(() => { if (isConfigured() && !isDemo()) alertConditions().catch(() => {}); }, 60_000).unref?.();
/* What this person sees: kinds they turned off "In the app" are left out (safety never is); each alert says its kind,
   its device, and what wall panels do with it (show, or say it out loud). */
app.get('/api/alerts', (req, res, next) => {
  if (isDemo()) return next();
  const rank = { critical: 0, warning: 1, notice: 2, info: 3, ok: 4 }, ctx = { rules: alertRulesHouse(), user: alertRulesUser(alertUserKey(req)), pro: !!proStatus().pro, target: null };
  const view = (a) => { if (!alertForReq(a, req) || !alertTypeAllows(a)) return null; const d = alertDecide(a, { ...ctx, device: alertDevCtx(a) }); return d.app && !(req.user?.panel && d.panel === 'off') ? { ...a, kind: a.kind || d.kind, alertKind: d.kind, device: d.device, safety: d.safety, panel: d.panel, sound: d.sound } : null; };
  const now = Object.values(alerts.open).sort((a, b) => rank[a.severity] - rank[b.severity]).map(({ pushes, lastPush, ...a }) => { const v = view(a); return v && { ...v, repeating: alertRepeats(a), ...(alertSnoozed(a) ? {} : { snoozed: undefined }) }; }).filter(Boolean);
  const all = alerts.events.slice(0, 160).map(view), recent = all.filter(Boolean).slice(0, 100);
  res.json({ now, recent, hidden: all.length - all.filter(Boolean).length });
});
/* "Got it": stops the reminders for this alert. It stays on the list until the problem clears. History entries
   (a doorbell press) can be marked "Got it" too. */
app.post('/api/alerts/:id/ack', requireRole('member'), (req, res) => {
  const ev = !Object.hasOwn(alerts.open, req.params.id) ? alerts.events.find((x) => x.id === req.params.id) : null;
  if (ev) { ev.acked = { by: req.user?.name || req.user?.username || 'someone', at: nowIso() }; saveAlerts(); return res.json({ ok: true, acked: ev.acked }); }
  const a = Object.hasOwn(alerts.open, req.params.id) ? alerts.open[req.params.id] : null; if (!a) return res.status(404).json({ error: 'That alert has already cleared.' });
  a.acked = { by: req.user?.name || req.user?.username || 'someone', at: nowIso() }; saveAlerts();
  if (typeof audit === 'function' && req.user) audit(req, 'alert-acknowledged', { alert: a.title });
  res.json({ ok: true, acked: a.acked });
});
