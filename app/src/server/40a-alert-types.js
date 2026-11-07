/* ======================================================================
 * Alert types - which alerts CasaTorch raises at all (Settings › Alerts).
 *
 * Every alert CasaTorch can raise belongs to one type, in one group (Safety, Security, Devices, Network & internet,
 * Home, System). A type is on or off; some have "how important" (the severity it is raised with) and their own
 * thresholds (minutes, a percentage, a temperature). Off means off everywhere: not raised, not in anyone's inbox,
 * not pushed, not counted on the Alerts tab, and gone from the history views. Where an alert that is on goes
 * (phones, sounds, quiet hours) is still decided by the rules in 40r-alert-rules.js.
 *
 * Safety (water, smoke/gas/CO, freezing) is on by default and turning it off needs a confirm. Security notices
 * about sign-ins, password resets and Secure Remote Access can't be turned off. Nothing here can switch a device:
 * alerts only notify.
 *
 * Kept in config.alerts.types: { v: 1, <type>: { on, level, <threshold>: n } }. Only an owner or admin changes it.
 * ====================================================================== */
const ALERT_GROUPS = Object.freeze([['safety', 'Safety'], ['security', 'Security'], ['devices', 'Devices'], ['network', 'Network & internet'], ['home', 'Home'], ['system', 'System']]);
const ALERT_LEVELS = Object.freeze(['critical', 'warning', 'notice']);
const tMin = (def, min = 1, max = 240) => ({ key: 'min', label: 'After', unit: 'min', min, max, def });
/* Order matters: the first type whose pattern matches an alert's id wins. Temperatures are in °C (the page shows °F where the home uses it). */
const ALERT_TYPES = Object.freeze([
  { id: 'leak', group: 'safety', label: 'Water leak', desc: 'A leak sensor finds water.', re: /^leak:/, on: true, safety: true },
  { id: 'smoke', group: 'safety', label: 'Smoke, gas or CO', desc: 'A smoke, gas or carbon monoxide alarm goes off.', re: /^smoke:/, on: true, safety: true },
  { id: 'temp', group: 'safety', label: 'Freezing or very hot', desc: 'A room gets near freezing or very hot.', re: /^temp:/, on: true, safety: true,
    nums: [{ key: 'low', label: 'Below', unit: '°C', min: -10, max: 15, def: 3 }, { key: 'high', label: 'Above', unit: '°C', min: 25, max: 60, def: 35 }] },
  { id: 'dooropen', group: 'security', label: 'Door or garage left open', desc: 'A door, gate or garage door stays open.', re: /^dooropen:/, on: true, level: 'warning', nums: [tMin(15, 2)] },
  { id: 'doorbell', group: 'security', label: 'Someone at the door', desc: 'The doorbell rings.', re: /^ring:[^:]+:doorbell:/, kind: 'doorbell', on: true },
  { id: 'motion', group: 'security', label: 'Motion on a camera', desc: 'A camera sees motion. It is still on the timeline when off.', re: /^ring:[^:]+:motion:/, kind: 'motion', on: false },
  { id: 'camoff', group: 'security', label: 'Camera offline', desc: 'A camera stops answering.', re: /^camoff:/, on: true, level: 'warning', nums: [tMin(10)] },
  { id: 'ports', group: 'security', label: 'Risky open ports', desc: 'A device on your network has a risky service open.', re: /^port:/, on: true },
  { id: 'signin', group: 'security', label: 'Sign-ins and password resets', desc: 'A new device signs in, or a password is reset. Always on.', re: /^(signin|login|owner-reset|owner-reset-done|remote):/, source: 'sign-in', on: true, locked: true },
  { id: 'offline', group: 'devices', label: 'Device offline', desc: 'A device stops answering.', re: /^offline:/, on: true, level: 'warning', nums: [tMin(30)] },
  { id: 'battery', group: 'devices', label: 'Low battery', desc: 'A sensor or lock runs low.', re: /^battery:/, on: true, level: 'notice', nums: [{ key: 'pct', label: 'Below', unit: '%', min: 5, max: 50, def: 15 }] },
  { id: 'internet', group: 'network', label: 'Internet down', desc: 'Your home loses the internet.', re: /^internet(:|$)/, on: true, level: 'critical', nums: [tMin(5, 1, 60)] },
  { id: 'newdev', group: 'network', label: 'New device on the network', desc: 'A device CasaTorch hasn\'t seen joins your network.', re: /^newdev:/, on: false, level: 'notice' },
  { id: 'apptest', group: 'network', label: 'Apps slow or down', desc: 'An app or website you test is slow or not answering.', re: /^apptest:/, on: true, level: 'warning', pro: true },
  { id: 'netgear', group: 'network', label: 'Network gear offline', desc: 'A router, switch or access point drops off.', re: /^(netdev|netsrc):/, on: true, level: 'warning', pro: true },
  { id: 'servers', group: 'network', label: 'Your servers', desc: 'A server you watch is down, or its certificate is expiring.', re: /^(server|cert):/, on: true, level: 'warning', pro: true },
  { id: 'dnsoff', group: 'network', label: 'Ad blocking off', desc: 'Pi-hole or AdGuard Home stops blocking.', re: /^dnsoff:/, on: true, pro: true },
  { id: 'fridge', group: 'home', label: 'Fridge or freezer too warm', desc: 'A fridge or freezer sensor reads too warm.', re: /^fridge:/, on: true, level: 'warning',
    nums: [{ key: 'fridge', label: 'Fridge above', unit: '°C', min: 2, max: 15, def: 8 }, { key: 'freezer', label: 'Freezer above', unit: '°C', min: -25, max: 0, def: -12 }, tMin(30, 5)] },
  { id: 'rain', group: 'home', label: 'Rain', desc: 'It starts raining, or a window is open in the rain.', re: /^(rain|rainopen):/, on: true },
  { id: 'appliance', group: 'home', label: 'Appliance finished', desc: 'The washer, dryer or dishwasher is done.', re: /^hh-app-/, on: true },
  { id: 'household', group: 'home', label: 'Bins, mail and plants', desc: 'Household reminders sent to phones.', re: /^hh-/, on: true },
  { id: 'reminders', group: 'home', label: 'Reminders', desc: 'Your reminders sent to phones.', re: /^nudge:/, on: true },
  { id: 'health', group: 'system', label: 'Something needs a look', desc: 'A check in Settings › Health fails.', re: /^(health|health-ok):/, on: true },
  { id: 'disk', group: 'system', label: 'Disk almost full', desc: 'Space for CasaTorch runs low.', re: /^disk:/, on: true, level: 'warning', nums: [{ key: 'pct', label: 'Under', unit: '% free', min: 2, max: 30, def: 10 }] },
  { id: 'report', group: 'system', label: 'Weekly home report', desc: 'Your weekly report is ready.', re: /^report:/, kind: 'report', on: true, pro: true },
]);
const ALERT_TYPE = Object.fromEntries(ALERT_TYPES.map((x) => [x.id, x]));

/** The type of an alert (a type id), or null for anything no type covers (those always show). Pure. */
function alertTypeOf(a) {
  if (a?.alertType && Object.hasOwn(ALERT_TYPE, a.alertType)) return a.alertType;
  const id = alertBaseId(String(a?.id || '').replace(/^cleared:/, ''));
  for (const x of ALERT_TYPES) if (x.re.test(id)) return x.id;
  for (const x of ALERT_TYPES) if ((x.kind && a?.kind === x.kind) || (x.source && a?.source === x.source)) return x.id;
  return null;
}

/** The first time: what an install had before types existed. Pure: returns the types to keep, or null when done already.
    "New device on the network" goes off unless someone turned watching back on by hand (security.watch === true);
    low batteries follow the old setup answer; safety alerts are on. */
function alertTypesMigrate(cfg) {
  const have = cfg?.alerts?.types;
  if (have && typeof have === 'object' && have.v >= 1) return null;
  const out = { ...(have && typeof have === 'object' ? have : {}), v: 1 };
  const old = Array.isArray(cfg?.sensors?.alertOn) && cfg.sensors.alertOn.length ? cfg.sensors.alertOn : null;
  if (!out.newdev) out.newdev = { on: cfg?.security?.watch === true };
  if (old && !old.includes('battery') && !out.battery) out.battery = { on: false };
  return out;
}
/** Write the migration once (a set-up box, not the demo). */
function alertTypesEnsure() {
  if (!isConfigured() || isDemo()) return;
  const next = alertTypesMigrate(config); if (!next) return;
  try { saveConfig({ ...config, alerts: { ...(config.alerts || {}), types: next } }); } catch { /* next time */ }
}
setTimeout(() => { alertTypesEnsure(); }, 1000).unref?.();

/** One type's settings: its defaults, under what is saved. Pure (stored: config.alerts.types). */
function alertTypeCfg(id, stored = config.alerts?.types) {
  const x = ALERT_TYPE[id]; if (!x) return { on: true };
  const s = stored && typeof stored === 'object' && stored[id] && typeof stored[id] === 'object' ? stored[id] : {};
  const out = { on: x.locked ? true : typeof s.on === 'boolean' ? s.on : x.on };
  if (x.level) out.level = ALERT_LEVELS.includes(s.level) ? s.level : x.level;
  for (const n of x.nums || []) out[n.key] = Number.isFinite(s[n.key]) ? Math.min(n.max, Math.max(n.min, s[n.key])) : n.def;
  return out;
}
const alertTypeOn = (id, stored) => alertTypeCfg(id, stored).on;
const alertTypeNum = (id, key, stored) => alertTypeCfg(id, stored)[key];
/** Is this alert allowed out? Anything no type covers always is. */
const alertTypeAllows = (a, stored) => { const t = alertTypeOf(a); return !t || alertTypeOn(t, stored); };
/** The alert as it goes out: the severity "how important" picked (never a "Cleared" one). */
function alertTypeLevel(a, stored) {
  const t = alertTypeOf(a); if (!t || !ALERT_TYPE[t].level || a?.severity === 'ok') return a;
  const lv = alertTypeCfg(t, stored).level; return lv && lv !== a.severity ? { ...a, severity: lv } : a;
}
/** Minutes a condition must last before it counts (0: as before - seen twice, a minute apart). */
const alertHoldMin = (id, stored) => { const t = alertTypeOf({ id }); return t && ALERT_TYPE[t].nums?.some((n) => n.key === 'min') ? alertTypeCfg(t, stored).min : 0; };

/** A change from Settings › Alerts. Throws a plain sentence (needsConfirm for a safety alert being turned off). Pure. */
function alertTypePatch(stored, body) {
  const b = body && typeof body === 'object' ? body : {}, x = ALERT_TYPE[String(b.id || '')];
  if (!x) throw new Error('Unknown kind of alert.');
  const cur = { ...(stored?.[x.id] && typeof stored[x.id] === 'object' ? stored[x.id] : {}) };
  if (b.on != null) {
    if (typeof b.on !== 'boolean') throw new Error('Pick on or off.');
    if (x.locked && !b.on) throw new Error('This alert is always on.');
    if (x.safety && !b.on && b.confirm !== true) throw Object.assign(new Error('This is a safety alert. Turning it off means you could miss a leak, smoke or a freezing pipe.'), { needsConfirm: true });
    cur.on = b.on;
  }
  if (b.level != null) { if (!x.level || !ALERT_LEVELS.includes(b.level)) throw new Error('Pick how important.'); cur.level = b.level; }
  if (b.nums != null) {
    if (typeof b.nums !== 'object') throw new Error('Pick a number.');
    for (const [k, v] of Object.entries(b.nums)) {
      const n = (x.nums || []).find((y) => y.key === k), num = Number(v);
      if (!n || v === '' || v === null || !Number.isFinite(num)) throw new Error('Pick a number.');
      if (num < n.min || num > n.max) throw new Error(`Pick a number from ${n.min} to ${n.max}.`);
      cur[k] = Math.round(num * 10) / 10;
    }
  }
  return { ...(stored && typeof stored === 'object' ? stored : {}), v: 1, [x.id]: cur };
}
/** Owners and admins change these; everyone else sees them. */
const alertTypesCanEdit = (req, signIn = signInOn()) => !signIn || ['owner', 'admin'].includes(req?.user?.role);

function alertTypesView(req) {
  return { admin: alertTypesCanEdit(req), pro: !!proStatus().pro, units: config.house?.units === 'C' ? 'C' : 'F', levels: ALERT_LEVELS,
    groups: ALERT_GROUPS.map(([id, label]) => ({ id, label })),
    types: ALERT_TYPES.map(({ re, kind, source, on, level, nums, ...x }) => {
      const c = alertTypeCfg(x.id);
      return { ...x, on: c.on, def: on, ...(level ? { level: c.level, defLevel: level } : {}), ...(nums ? { nums: nums.map((n) => ({ ...n, value: c[n.key] })) } : {}) };
    }) };
}
app.get('/api/alerts/types', (req, res) => { alertTypesEnsure(); res.json(alertTypesView(req)); });
app.put('/api/alerts/types', requireRole('admin'), express.json({ limit: '2kb' }), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'The demo can\'t change settings.' });
  let next;
  try { next = alertTypePatch(alertTypesMigrate(config) || config.alerts?.types, req.body); }
  catch (e) { return res.status(400).json({ error: e.message, ...(e.needsConfirm ? { needsConfirm: true } : {}) }); }
  try { saveConfig({ ...config, alerts: { ...(config.alerts || {}), types: next } }); } catch (e) { return res.status(500).json({ error: e.message }); }
  const b = req.body || {};
  if (typeof audit === 'function' && req.user) audit(req, 'alert-types-changed', { type: b.id, ...(typeof b.on === 'boolean' ? { on: b.on } : {}), ...(b.level ? { level: b.level } : {}) });
  /* Turned off: it leaves the list now, not at the next minute's look. */
  if (b.on === false) for (const id of Object.keys(alerts.open)) if (alertTypeOf({ id }) === b.id) delete alerts.open[id];
  res.json(alertTypesView(req));
});

/* ---- the conditions the new types look for (40-alerts.js calls these every minute) ---- */
const FRIDGE_RE = /fridge|freezer|refrigerator|kühlschrank|gefrier|frigo|congel|nevera|koelkast|vriezer|kyl|frys/i;
const FREEZER_RE = /freezer|gefrier|congel|vriezer|frys/i;
const isFridge = (d) => FRIDGE_RE.test(`${d.name || ''} ${d.id || ''}`);
/* A door, gate or garage: an opening sensor (not a window) or a garage door / gate / door cover. */
const isDoorLike = (d) => (d.kind === 'sensor' && typeof d.open === 'boolean' && ['door', 'garage_door', 'opening'].includes(d.haClass) && !/window|fenster|fenêtre|ventana|raam/i.test(d.name || ''))
  || (d.kind === 'cover' && d.risky === true);
/** What the device conditions find, for one device. Pure: cfg is alertTypeCfg for each type. */
function alertDeviceFinds(d, cfg = (id) => alertTypeCfg(id)) {
  const out = [];
  if (isDoorLike(d) && d.open === true && d.online !== false && cfg('dooropen').on) out.push({ id: `dooropen:${d.id}`, severity: cfg('dooropen').level, title: `${d.name} has been open for over ${cfg('dooropen').min} min`, msg: '{name} has been open for over {n} min', vars: { name: d.name, n: cfg('dooropen').min }, source: d.provider });
  if (Number.isFinite(d.tempC) && isFridge(d) && cfg('fridge').on) {
    const freezer = FREEZER_RE.test(`${d.name || ''} ${d.id || ''}`), max = freezer ? cfg('fridge').freezer : cfg('fridge').fridge;
    if (d.tempC > max) out.push({ id: `fridge:${d.id}`, severity: cfg('fridge').level, title: `${d.name} is too warm`, msg: '{name} is too warm', vars: { name: d.name }, source: d.provider });
  }
  return out;
}
/** The disk where CasaTorch keeps its data, almost full? Pure. */
function alertDiskFind(st, pct) {
  if (!st || !(st.blocks > 0)) return null;
  const free = (st.bavail / st.blocks) * 100;
  return free < pct ? { id: 'disk:data', severity: 'warning', title: `The disk is almost full (${Math.max(0, Math.floor(free))}% free)`, msg: 'The disk is almost full ({n}% free)', vars: { n: Math.max(0, Math.floor(free)) }, source: 'casatorch', url: '/#settings/health' } : null;
}
function alertDiskNow() { if (!alertTypeOn('disk')) return null; try { return alertDiskFind(fs.statfsSync(DATA_DIR), alertTypeNum('disk', 'pct')); } catch { return null; } }

if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchAlertTypes = { alertRaise, ALERT_TYPES, ALERT_GROUPS, ALERT_LEVELS, alertTypeOf, alertTypesMigrate, alertTypeCfg, alertTypeAllows, alertTypeLevel, alertHoldMin, alertTypePatch, alertTypesCanEdit, alertDeviceFinds, alertDiskFind, isDoorLike, isFridge };
