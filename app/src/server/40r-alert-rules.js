/* ======================================================================
 * Alert rules - what each alert does, for each person and each phone.
 *
 * Every alert has a kind (water, smoke, doorbell, a device not responding...)
 * and a severity tier (critical / important / info). Rules come in layers,
 * later ones winning:  the kind's built-in default  <  the household's rule
 * for the kind  <  the household's rule for the room  <  ... for the device
 * <  this person's rule for the kind  <  this person's rule for the device.
 *
 * alertDecide() turns one alert + those layers + the moment (house time,
 * who is home, mutes) into: show it in the app?  push it to this phone?
 * which sound?  repeat every how many minutes?  hold it for the daily
 * summary?  what wall panels do. It is pure (no clock, no files) and unit
 * tested in test/alert-rules-unit.mjs.
 *
 * Nothing changes until someone changes a rule: a kind nobody touched
 * follows the settings CasaTorch had before (each phone's "Send" level,
 * quiet hours, "doorbell and motion only when nobody's home", repeating
 * critical alerts every 10 minutes).
 *
 * Safety floor: water, smoke/gas/CO and freezing/very hot always show in the
 * app, always break through quiet hours, ignore "only when away" and the
 * daily summary, and their pushes can only be turned off (or muted) with an
 * explicit confirm that says what that risks. Safety is never Pro.
 * ====================================================================== */
const ALERT_KINDS = Object.freeze([
  { id: 'water', label: 'Water leaks', icon: 'drop', safety: true, tier: 'critical', re: /^leak:/, sample: 'Water detected: Kitchen sink sensor' },
  { id: 'smoke', label: 'Smoke, gas & CO', icon: 'fire', safety: true, tier: 'critical', re: /^smoke:/, sample: 'Smoke alarm: Hallway' },
  { id: 'temp', label: 'Freezing or very hot', icon: 'thermo', safety: true, tier: 'important', re: /^temp:/, sample: 'Garage freezer is very hot' },
  { id: 'security', label: 'Security & sign-in', icon: 'shield', tier: 'important', re: /^(newdev|port|owner-reset|owner-reset-done|signin|login):/, sample: 'New device on your network: Phone' },
  { id: 'doorbell', label: 'Doorbell', icon: 'bell', tier: 'important', sample: 'Someone at the Front door' },
  { id: 'motion', label: 'Motion', icon: 'user', tier: 'info', sample: 'Motion at the Driveway' },
  { id: 'detection', label: 'People & vehicles on camera', icon: 'camera', tier: 'info', coming: true, re: /^(detect|frigate-event):/, sample: 'Person at the Driveway' },
  { id: 'offline', label: 'Devices not responding', icon: 'plug', tier: 'important', re: /^(offline|server|netdev|netsrc):/, sample: 'Porch camera is not responding' },
  { id: 'battery', label: 'Low batteries', icon: 'gauge', tier: 'info', re: /^battery:/, sample: 'Low battery (12%): Back door sensor' },
  { id: 'network', label: 'Internet & app tests', icon: 'wifi', tier: 'critical', re: /^(internet|apptest|dnsoff|cert)(:|$)/, sample: 'The internet is down' },
  { id: 'energy', label: 'Energy (high or unusual use)', icon: 'bolt', tier: 'info', coming: true, re: /^energy:/, sample: 'Unusually high energy use' },
  { id: 'weather', label: 'Rain & open windows', icon: 'drop', tier: 'important', re: /^(rain|rainopen):/, sample: 'Kitchen window is open and it\'s raining' },
  { id: 'household', label: 'Household (bins, mail, plants, laundry)', icon: 'trash', tier: 'info', reminder: true, re: /^hh-/, sample: 'Take out the trash tonight' },
  { id: 'reminders', label: 'Reminders', icon: 'clock', tier: 'info', reminder: true, re: /^nudge:/, sample: 'Reminder from your home' },
  { id: 'system', label: 'CasaTorch health & reports', icon: 'checkc', tier: 'important', re: /^(health|health-ok|report):/, sample: '1 thing needs a look: Weather' },
  { id: 'updates', label: 'Updates', icon: 'download', tier: 'info', coming: true, re: /^update:/, sample: 'A new version is ready' },
  { id: 'other', label: 'Everything else', icon: 'bell', tier: 'info', sample: 'Something happened at home' },
]);
const ALERT_KIND = Object.fromEntries(ALERT_KINDS.map((k) => [k.id, k]));
const ALERT_TIERS = ['critical', 'important', 'info'];
/* The severities alerts are raised with, in three tiers people understand. */
const alertTier = (sev) => (sev === 'critical' ? 'critical' : sev === 'warning' || sev === 'event' ? 'important' : sev === 'ok' ? null : 'info');
const ALERT_SOUNDS = ['auto', 'urgent', 'normal', 'silent'];
const ALERT_PANEL = ['show', 'announce', 'off'];
const ALERT_PRESENCE = ['any', 'away', 'home'];
const ALERT_REPEATS = [0, 5, 10, 15, 30, 60];
const ALERT_MUTE_HOURS = [1, 2, 4, 8, 12, 24, 72, 168];

/** The kind of an alert: from its kind field, else its id ("leak:...", "ring:cam:doorbell:..."). */
function alertKindOf(a) {
  if (a?.alertKind && Object.hasOwn(ALERT_KIND, a.alertKind)) return a.alertKind;
  const id = String(a?.id || '').replace(/^cleared:/, ''), k = a?.kind;
  if (k === 'doorbell' || /^ring:[^:]+:doorbell:/.test(id)) return 'doorbell';
  if (k === 'motion' || /^ring:[^:]+:motion:/.test(id)) return 'motion';
  if (k === 'detection') return 'detection';
  if (k === 'report') return 'system';
  for (const K of ALERT_KINDS) if (K.re && K.re.test(id)) return K.id;
  if (a?.source === 'sign-in') return 'security';
  return 'other';
}
/** The device an alert is about (for per-device rules and "Mute this device"), or null. */
function alertDeviceOf(a) {
  if (a?.device) return String(a.device);
  const id = String(a?.id || '').replace(/^cleared:/, '').replace(/:repeat$/, '').replace(/:\d{4}-\d\d-\d\dT[\d:.]+Z$/, '');
  let m = /^(leak|smoke|battery|offline|temp|rainopen):(.+)$/.exec(id); if (m && m[2] !== 'more') return m[2];
  m = /^ring:([^:]+):(doorbell|motion):/.exec(String(a?.id || '')); if (m) return `ring:${m[1]}`;
  return null;
}
/** The alert's open id without the time a history entry adds ("leak:x:2026-...Z" -> "leak:x"). */
const alertBaseId = (id) => String(id || '').replace(/:repeat$/, '').replace(/:\d{4}-\d\d-\d\dT[\d:.]+Z$/, '');

/* Quiet hours: "22-7" (10 PM to 7 AM) or "22:30-06:15"; "none" for none. Across midnight when the start is later. */
function quietParse(spec) {
  const m = /^(\d{1,2})(?::(\d\d))?-(\d{1,2})(?::(\d\d))?$/.exec(String(spec || ''));
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2] || 0), b = Number(m[3]) * 60 + Number(m[4] || 0);
  return a < 1440 && b <= 1440 && a !== b ? [a, b] : null;
}
function quietIn(spec, h, min = 0) {
  const q = quietParse(spec); if (!q) return false;
  const t = h * 60 + min, [a, b] = q;
  return a > b ? t >= a || t < b : t >= a && t < b;
}
const quietOk = (s) => s === 'none' || !!quietParse(s);

/* The built-in rule for a kind: what CasaTorch did before rules existed (legacy = the old settings). */
function alertBaseRule(kind, legacy = {}) {
  // reminders (Reminders, Household) go at the time you picked: quiet hours don't hold them back unless a rule says so
  return { app: true, push: null, phones: 'all', sound: 'auto', repeat: null, quiet: ALERT_KIND[kind]?.reminder ? 'ignore' : 'follow', presence: legacy.awayOnly && (kind === 'doorbell' || kind === 'motion') ? 'away' : 'any', digest: false, panel: 'show' };
}
const LEVEL_SEVS = { critical: ['critical'], important: ['critical', 'warning', 'event'], all: ['critical', 'warning', 'event', 'notice', 'info'] };
const levelAllows = (level, sev) => (Object.hasOwn(LEVEL_SEVS, level) ? LEVEL_SEVS[level] : LEVEL_SEVS.important).includes(sev);
const ruleSev = (a) => (a?.kind === 'doorbell' || /^ring:[^:]+:doorbell:/.test(a?.id || '') ? 'event' : a?.severity || 'info');   // the same as sevOf (41-notify.js)

/** The rule for this alert, layered (see the top of this file). ctx.rules: the household's; ctx.user: this person's. */
function alertRuleFor(a, ctx = {}) {
  const kind = alertKindOf(a), H = ctx.rules || {}, U = ctx.user || {}, dev = ctx.device?.id ?? alertDeviceOf(a), room = ctx.device?.room || null;
  const own = (o, k) => (o && Object.hasOwn(o, k) && o[k] && typeof o[k] === 'object' ? o[k] : {});
  const layers = [alertBaseRule(kind, H.legacy || {}), own(H.kinds, kind), room ? own(H.rooms, room) : {}, dev ? own(H.devices, dev) : {}, own(U.kinds, kind), dev ? own(U.devices, dev) : {}];
  const r = {};
  for (const L of layers) for (const [k, v] of Object.entries(L)) if (v !== undefined && v !== null) r[k] = v;
  for (const k of ['push', 'repeat']) if (!layers.slice(1).some((L) => L[k] != null)) r[k] = null;   // nobody set it: the old behavior
  return { kind, device: dev, room, rule: r, layers };
}

/**
 * The decision for one alert. Pure: everything it looks at is in ctx.
 * ctx: { rules, user, target: { id, level, user } | null, hour, minute (house time), home: true|false|null,
 *        pro, now (ms), mutes: [{ scope, device?, kind?, until, confirmed? }], snoozedUntil (ms), isRepeat, isTest, device: { id, room } }
 * Returns { kind, tier, safety, app, push, sound, repeat (minutes, 0 = no), digest, panel, why: [...] }.
 */
function alertDecide(a, ctx = {}) {
  const { kind, device, rule: r } = alertRuleFor(a, ctx);
  const K = ALERT_KIND[kind], sev = ruleSev(a), tier = alertTier(sev), safety = !!K.safety && tier !== 'info', why = [];
  const out = { kind, tier, safety, device, app: true, push: false, sound: 'normal', repeat: 0, digest: false, panel: 'show', why };
  if (tier == null) { why.push('cleared'); return out; }   // "Cleared: ..." stays on screens, never pushed
  const H = ctx.rules || {}, U = ctx.user || {}, now = ctx.now ?? 0, t = ctx.target || null;
  /* in the app and on wall panels */
  out.app = safety ? true : r.app !== false;
  out.panel = ALERT_PANEL.includes(r.panel) ? r.panel : 'show';
  if (safety && out.panel === 'off') { out.panel = 'show'; why.push('safety-floor'); }
  if (!out.app && !safety) out.panel = 'off';
  /* repeat until someone taps "Got it" (non-safety repeats are Pro, as before) */
  let rep = r.repeat == null ? (tier === 'critical' && H.legacy?.repeat !== false ? 10 : 0) : Number(r.repeat) || 0;
  if (rep > 0 && !ctx.pro && !safety) { rep = 0; why.push('repeat-needs-pro'); }
  out.repeat = rep;
  /* sound */
  const snd = ALERT_SOUNDS.includes(r.sound) ? r.sound : 'auto';
  out.sound = snd === 'auto' ? (tier === 'critical' ? 'urgent' : 'normal') : snd;
  if (safety && tier === 'critical' && out.sound === 'silent' && !r.confirmOff) out.sound = 'urgent';
  if (!t) return out;   // no phone asked about: only the app, sound and repeat
  /* push to this phone? */
  let push;
  if (r.push === true || r.push === false) push = r.push;
  else if (K.reminder && a.pushAsked === true) push = true;   // a reminder set to "Send to phones" (78-nudges.js, 78h-household.js) goes, as before, unless a rule here says otherwise
  else { push = levelAllows(t.level, sev); if (!push) why.push('phone-level'); }
  if (push && Array.isArray(r.phones) && !r.phones.includes(t.id)) { push = false; why.push('not-this-phone'); }
  if (r.push === false && !push) why.push('off');
  if (safety && !push && r.push === false && !r.confirmOff) { push = true; why.push('safety-floor'); }   // turned off without the confirm: still goes
  if (!push) return out;
  if (ctx.isRepeat && rep === 0) { why.push('no-repeat'); return out; }
  if (!ctx.isTest) {
    if (ctx.snoozedUntil && ctx.snoozedUntil > now) { why.push('snoozed'); return out; }
    const muted = (ctx.mutes || []).find((m) => m && m.until > now && (m.scope === 'house' || (t.user && m.scope === t.user)) && ((m.device && m.device === device) || (m.kind && m.kind === kind)) && (!safety || m.confirmed));
    if (muted) { why.push('muted'); return out; }
  }
  /* only when away / home (Pro; never for safety; when CasaTorch can't tell who's home it sends) */
  if (!safety && r.presence && r.presence !== 'any') {
    if (!ctx.pro) why.push('presence-needs-pro');
    else if (r.presence === 'away' && ctx.home === true) { why.push('someone-home'); return out; }
    else if (r.presence === 'home' && ctx.home === false) { why.push('nobody-home'); return out; }
  }
  /* quiet hours: this person's own, else the household's; critical breaks through unless they said no; safety always does */
  const spec = U.quietHours && U.quietHours !== 'house' ? U.quietHours : H.quietHours || '22-7';
  if (r.quiet !== 'ignore' && Number.isFinite(ctx.hour) && quietIn(spec, ctx.hour, ctx.minute || 0)) {
    const brk = U.quietBreak != null ? U.quietBreak !== false : H.quietBreak !== false;
    if (!(safety || (tier === 'critical' && brk))) { why.push('quiet-hours'); return out; }
    why.push('breaks-quiet');
  }
  /* the daily summary instead of right away (never for safety) */
  if (r.digest === true && !safety && !ctx.isRepeat) { out.digest = true; why.push('digest'); return out; }
  out.push = true;
  return out;
}

/**
 * Flap damping: an alert that clears and comes back within a few minutes is one alert, not a stream.
 * st: what is remembered for that alert; ev: 'raise' | 'clear' | 'tick'. Pure.
 * actions: 'push' (a real new alert), 'silent' (back again: reopen without a push), 'note' (the first time it flaps:
 * one line in the history, no push), 'clear' (say "Cleared"), 'hold' (wait to see if it stays cleared), 'none'.
 */
const FLAP_WINDOW_MS = 15 * 60_000;
function flapStep(st, ev, now, safety = false, win = FLAP_WINDOW_MS) {
  const s = { ...(st || {}) };
  if (ev === 'raise') {
    if (!safety && s.lastClear != null && now - s.lastClear < win) { s.n = (s.n || 0) + 1; delete s.lastClear; s.held = false; return { st: s, action: s.n === 1 ? 'note' : 'silent' }; }
    return { st: {}, action: 'push' };
  }
  if (ev === 'clear') {
    if (!safety && s.n) return { st: { ...s, lastClear: now, held: true }, action: 'hold' };
    return { st: { lastClear: now }, action: 'clear' };
  }
  if (s.lastClear != null && now - s.lastClear >= win) return { st: null, action: s.held ? 'clear' : 'none' };
  return { st: s, action: 'none' };
}

/* ---- the rules on disk (config.alerts.rules for the household, config.alerts.users[id] for each person) ---- */
function alertRulesHouse() {
  const c = config.alerts || {}, r = c.rules || {};
  return { kinds: r.kinds || {}, rooms: r.rooms || {}, devices: r.devices || {}, quietHours: c.quietHours || '22-7', quietBreak: r.quietBreak !== false, digestTime: r.digestTime || '08:00', repeatMax: r.repeatMax || 6,
    legacy: { awayOnly: !!c.awayOnly, repeat: c.repeat !== false } };
}
const alertUserKey = (req) => req?.user?.id || 'local';
const alertRulesUser = (uid) => { const u = config.alerts?.users?.[uid] || {}; return { kinds: u.kinds || {}, devices: u.devices || {}, quietHours: u.quietHours || 'house', quietBreak: u.quietBreak ?? null }; };
/** A rule change from the browser: only known fields with known values. Throws a plain sentence when it can't be saved. */
function cleanRule(patch, { safety = false, pro = true } = {}) {
  const p = patch && typeof patch === 'object' ? patch : {}, out = {};
  const bool = (k) => { if (p[k] === null) out[k] = null; else if (typeof p[k] === 'boolean') out[k] = p[k]; };
  bool('app'); bool('push'); bool('digest');
  if (p.phones === 'all' || p.phones === null) out.phones = null; else if (Array.isArray(p.phones)) out.phones = p.phones.map(String).filter((x) => /^[aw]:[0-9a-f]{6,24}$|^ha$/.test(x)).slice(0, 20);
  for (const [k, list] of [['sound', ALERT_SOUNDS], ['panel', ALERT_PANEL], ['presence', ALERT_PRESENCE], ['quiet', ['follow', 'ignore']]]) if (list.includes(p[k])) out[k] = p[k]; else if (p[k] === null) out[k] = null;
  if (p.repeat === null) out.repeat = null; else if (ALERT_REPEATS.includes(Number(p.repeat)) && p.repeat !== '' && p.repeat !== false) out.repeat = Number(p.repeat);
  if (safety) {
    if (out.app === false) throw new Error('Safety alerts always show in the app.');
    if (out.panel === 'off') throw new Error('Safety alerts always show on wall panels.');
    const silencing = out.push === false || out.sound === 'silent';
    if (silencing && p.confirm !== true) throw Object.assign(new Error('Turning off a safety alert needs a confirm: you could miss a leak, smoke or a freezing pipe.'), { needsConfirm: true });
    if (silencing) out.confirmOff = true; else if (out.push === true || out.push === null) out.confirmOff = null;
    delete out.digest; delete out.presence;
  }
  if (out.presence && out.presence !== 'any' && !pro) throw new Error('"Only when away or home" is part of Smart alerts (Pro).');
  return out;
}
function applyRule(store, key, patch) {
  const cur = { ...(store[key] || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete cur[k]; else cur[k] = v; }
  if (Object.keys(cur).length) store[key] = cur; else delete store[key];
}
function saveAlertRules(mutate) {
  const next = { ...(config.alerts || {}) };
  next.rules = JSON.parse(JSON.stringify(next.rules || {})); next.users = JSON.parse(JSON.stringify(next.users || {}));
  mutate(next);
  saveConfig({ ...config, alerts: next });
}

/* ---- mutes and snoozes (alerts.json: they are short-lived, not settings) ---- */
const alertMutes = (now = Date.now()) => { alerts.mutes = (alerts.mutes || []).filter((m) => m.until > now); return alerts.mutes; };

/* ---- the moment: house time and who's home ---- */
function houseHM(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: typeof houseTz === 'function' ? houseTz() : undefined }).formatToParts(d);
  return { hour: Number(p.find((x) => x.type === 'hour')?.value) % 24, minute: Number(p.find((x) => x.type === 'minute')?.value) };
}
/* Where each device is (its room), from the last look at the devices (40-alerts.js keeps it fresh). */
const alertDevInfo = new Map();
const alertDevCtx = (a) => { const id = alertDeviceOf(a); return id ? { id, room: alertDevInfo.get(id)?.room || null } : null; };
/** Everything alertDecide needs that doesn't depend on the phone. */
async function alertMoment() {
  const hm = houseHM();
  let home = null;
  try { home = typeof someoneHome === 'function' ? (await someoneHome()).v : null; } catch { /* can't tell */ }
  return { rules: alertRulesHouse(), ...hm, home, pro: !!proStatus().pro, now: Date.now(), mutes: alertMutes() };
}
/** The phones and browsers that can get alerts: web app (w:), CasaTorch app (a:), the Home Assistant app (ha). */
function alertTargets() {
  const out = (push.subs || []).map((s) => ({ id: `w:${s.id}`, type: 'web', user: s.user || 'local', level: s.level, name: s.name, ref: s }));
  for (const pd of push.apps || []) out.push({ id: `a:${pd.id}`, type: 'app', user: pd.user, level: pd.level, name: pd.name, ref: pd });
  if (config.alerts?.phone === 'homeassistant' && config.homeAssistant?.url) out.push({ id: 'ha', type: 'ha', user: null, level: 'important', name: 'Home Assistant app' });
  return out;
}

/* ---- reminders and household pushes (78-nudges.js, 78h-household.js) go through the same rules ----
   kind: 'reminders' | 'household'. The item itself asked to be sent to phones (pushAsked), so with no rule
   changed it goes to every phone as before; Settings › Alerts can turn it off, pick phones, sound or quiet hours. */
async function alertSendReminder(item, { kind = 'reminders', msg, isTest = false } = {}) {
  const a = { id: kind === 'household' ? String(item.id) : `nudge:${item.id}`, alertKind: kind === 'household' ? 'household' : 'reminders', severity: 'event', pushAsked: true, title: item.title };
  const m = await alertMoment(), dec = new Map(), go = [];
  for (const t of alertTargets()) { const d = alertDecide(a, { ...m, user: t.user ? alertRulesUser(t.user) : {}, target: t, isTest }); dec.set(t, d); if (d.push) go.push(t); else if (d.digest) digestAdd(t.id, a); }
  if (!go.length) return 0;
  return alertSendTo(go, msg, (t) => dec.get(t));
}
/* ---- the daily summary ---- */
function digestAdd(targetId, a) {
  const d = (alerts.digest ||= {}); const list = (d[targetId] ||= []);
  list.push({ at: nowIso(), title: String(a.title || '').slice(0, 120), kind: alertKindOf(a) }); if (list.length > 50) list.splice(0, list.length - 50);
  saveAlerts();
}
async function digestTick() {
  if (!isConfigured() || isDemo() || !alerts.digest) return;
  const { hour, minute } = houseHM(), want = alertRulesHouse().digestTime, [h, m] = String(want).split(':').map(Number);
  const today = new Date().toISOString().slice(0, 10);
  if (hour !== h || minute !== m || alerts.digestSent === today) return;
  alerts.digestSent = today;
  const all = alertTargets(), q = alerts.digest; alerts.digest = {}; saveAlerts();
  await Promise.allSettled(Object.entries(q).map(([tid, list]) => {
    const t = all.find((x) => x.id === tid); if (!t || !list.length) return null;
    const msg = { title: list.length === 1 ? 'Your daily alert summary: 1 alert' : `Your daily alert summary: ${list.length} alerts`, body: list.slice(-3).reverse().map((x) => x.title).join(' · ').slice(0, 200), tag: 'digest', url: '/#alerts', sev: 'info' };
    return alertSendTo([t], msg);
  }));
}
setInterval(() => { digestTick().catch(() => {}); }, 60_000).unref?.();

/* ---- what the browser gets and changes ---- */
const ruleKindsView = () => ALERT_KINDS.map(({ re, ...k }) => k);
app.get('/api/alerts/rules', async (req, res) => {
  const uid = alertUserKey(req), house = alertRulesHouse(), mine = alertRulesUser(uid), admin = !signInOn() || ['owner', 'admin'].includes(req.user?.role);
  const targets = alertTargets().filter((t) => t.user === uid || (admin && t.type === 'ha')).map((t) => ({ id: t.id, name: t.name, type: t.type, level: t.level }));
  let devices = [];
  try { devices = ((await houseDevices()).devices || []).filter((d) => d.water != null || d.smoke != null || d.battery != null || ['camera', 'lock', 'climate', 'sensor', 'cover'].includes(d.kind)).slice(0, 400).map((d) => ({ id: d.id, name: d.name, room: d.area || null, kind: d.kind, icon: d.water != null ? 'drop' : d.smoke != null ? 'fire' : d.kind === 'camera' ? 'camera' : d.kind === 'lock' ? 'lock' : 'dotc' })); } catch { /* none */ }
  for (const d of devices) if (d.room) alertDevInfo.set(d.id, { room: d.room, name: d.name });
  const people = admin && typeof users === 'object' ? (users.list || []).filter((u) => !u.panel).map((u) => ({ id: u.id, name: u.name || u.username, custom: !!config.alerts?.users?.[u.id] })) : [];
  const mutes = alertMutes().filter((m) => m.scope === 'house' || m.scope === uid).map((m) => ({ ...m, mine: m.scope === uid }));
  /* the matrix: what each kind does for me, right now, on my first phone (or as a phone set to "Important") */
  const moment = { rules: house, user: mine, pro: !!proStatus().pro, now: Date.now(), mutes: [], home: null };
  const sampleTarget = targets.find((t) => t.type !== 'ha') ? { ...targets.find((t) => t.type !== 'ha'), user: uid } : { id: 'w:000000', level: 'important', user: uid };
  const effective = Object.fromEntries(ALERT_KINDS.map((K) => {
    const a = { alertKind: K.id, id: `${K.id}:sample`, severity: K.reminder ? 'event' : K.tier === 'critical' ? 'critical' : K.tier === 'important' ? 'warning' : 'notice', ...(K.reminder ? { pushAsked: true } : {}) };
    const d = alertDecide(a, { ...moment, target: sampleTarget });
    const h = alertDecide(a, { ...moment, user: {}, target: { ...sampleTarget, level: 'important' } });
    return [K.id, { app: d.app, push: d.push || d.digest, digest: d.digest, sound: d.sound, repeat: d.repeat, panel: d.panel, rule: alertRuleFor(a, moment).rule,
      house: { app: h.app, push: h.push || h.digest, digest: h.digest, sound: h.sound, repeat: h.repeat, panel: h.panel, rule: alertRuleFor(a, { ...moment, user: {} }).rule } }];
  }));
  res.json({ kinds: ruleKindsView(), tiers: ALERT_TIERS, sounds: ALERT_SOUNDS, repeats: ALERT_REPEATS, muteHours: ALERT_MUTE_HOURS, admin, pro: !!proStatus().pro, demo: isDemo() || undefined,
    presence: (await someoneHome().catch(() => ({ n: 0 }))).n || 0,
    house: { kinds: house.kinds, rooms: house.rooms, devices: house.devices, quietHours: house.quietHours, quietBreak: house.quietBreak, digestTime: house.digestTime, legacy: house.legacy },
    mine: { kinds: mine.kinds, devices: mine.devices, quietHours: mine.quietHours, quietBreak: mine.quietBreak }, effective, targets, devices, people, mutes });
});
const ruleErr = (res, e) => res.status(400).json({ error: e.message, ...(e.needsConfirm ? { needsConfirm: true } : {}) });
/* The household's defaults (owner/admin): a kind, a room or a device; quiet hours and the summary time. */
app.put('/api/alerts/rules/house', requireRole('admin'), express.json({ limit: '4kb' }), (req, res) => {
  const b = req.body || {};
  try {
    saveAlertRules((next) => {
      const r = next.rules;
      if (b.kind != null) { if (!Object.hasOwn(ALERT_KIND, b.kind)) throw new Error('Unknown kind of alert.'); applyRule((r.kinds ||= {}), b.kind, cleanRule(b.rule, { safety: !!ALERT_KIND[b.kind].safety, pro: !!proStatus().pro })); }
      if (b.device != null) { const id = String(b.device).slice(0, 200); applyRule((r.devices ||= {}), id, cleanRule(b.rule, { safety: !!b.safety, pro: !!proStatus().pro })); }
      if (b.room != null) applyRule((r.rooms ||= {}), String(b.room).slice(0, 80), cleanRule(b.rule, { pro: !!proStatus().pro }));
      if (b.quietHours != null) { if (!quietOk(b.quietHours)) throw new Error('Pick when quiet hours start and end.'); next.quietHours = b.quietHours; }
      if (typeof b.quietBreak === 'boolean') r.quietBreak = b.quietBreak;
      if (b.digestTime != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.digestTime)) throw new Error('Pick a time.'); r.digestTime = b.digestTime; }
      if (b.reset === true) { next.rules = {}; }
    });
  } catch (e) { return ruleErr(res, e); }
  if (typeof audit === 'function' && req.user) audit(req, 'alert-rules-changed', { scope: 'house', what: b.kind || b.device || b.room || (b.reset ? 'reset' : 'times') });
  res.json({ ok: true });
});
/* This person's own: their phones, their quiet hours. */
app.put('/api/alerts/rules/mine', express.json({ limit: '4kb' }), (req, res) => {
  if (req.user?.panel) return res.status(403).json({ error: 'sign in as a person first' });
  const b = req.body || {}, uid = alertUserKey(req);
  try {
    saveAlertRules((next) => {
      const u = (next.users[uid] ||= {});
      if (b.kind != null) { if (!Object.hasOwn(ALERT_KIND, b.kind)) throw new Error('Unknown kind of alert.'); applyRule((u.kinds ||= {}), b.kind, cleanRule(b.rule, { safety: !!ALERT_KIND[b.kind].safety, pro: !!proStatus().pro })); }
      if (b.device != null) applyRule((u.devices ||= {}), String(b.device).slice(0, 200), cleanRule(b.rule, { safety: !!b.safety, pro: !!proStatus().pro }));
      if (b.quietHours != null) { if (b.quietHours !== 'house' && !quietOk(b.quietHours)) throw new Error('Pick when quiet hours start and end.'); u.quietHours = b.quietHours; }
      if (b.quietBreak === null || typeof b.quietBreak === 'boolean') u.quietBreak = b.quietBreak;
      if (b.reset === true) delete next.users[uid];
      else if (!Object.keys(u.kinds || {}).length && !Object.keys(u.devices || {}).length && (!u.quietHours || u.quietHours === 'house') && u.quietBreak == null) delete next.users[uid];
    });
  } catch (e) { return ruleErr(res, e); }
  res.json({ ok: true });
});
/* "Send a test of this kind": what would happen on each of my phones right now, and it goes where the rules let it. */
app.post('/api/alerts/test', express.json({ limit: '1kb' }), async (req, res) => {
  const K = ALERT_KIND[String(req.body?.kind || '')]; if (!K) return res.status(400).json({ error: 'Unknown kind of alert.' });
  if (overLimit(`alerttest:${alertUserKey(req)}`, 20, 10 * 60_000)) return res.status(429).json({ error: 'That\'s a lot of test alerts - wait a few minutes.' });   // each one can buzz your phones
  const uid = alertUserKey(req), a = { alertKind: K.id, id: `${K.id}-test:${Date.now()}`, severity: K.reminder ? 'event' : K.tier === 'critical' ? 'critical' : K.tier === 'important' ? 'warning' : 'notice', title: `Test: ${K.sample}`, ...(K.reminder ? { pushAsked: true } : {}) };
  const m = await alertMoment(), user = alertRulesUser(uid), mine = alertTargets().filter((t) => t.user === uid);
  const app0 = alertDecide(a, { ...m, user, target: null });
  const rows = mine.map((t) => ({ t, d: alertDecide(a, { ...m, user, target: t, isTest: true }) }));
  const go = rows.filter((x) => x.d.push);
  let sent = 0;
  if (!isDemo() && go.length) sent = await alertSendTo(go.map((x) => x.t), { title: a.title, body: 'A test from Settings › Alerts.', tag: `test:${K.id}`, url: '/#settings/alerts', sev: a.severity }, (t) => go.find((x) => x.t === t).d).catch(() => 0);
  res.json({ ok: true, app: app0.app, panel: app0.panel, sound: app0.sound, repeat: app0.repeat, sent, phones: rows.map(({ t, d }) => ({ name: t.name, push: d.push, digest: d.digest, sound: d.sound, why: d.why })) });
});
/* Snooze one alert: no pushes or reminders for a few hours; it stays on screens. */
app.post('/api/alerts/:id/snooze', requireRole('member'), express.json({ limit: '1kb' }), (req, res) => {
  const a = Object.hasOwn(alerts.open, req.params.id) ? alerts.open[req.params.id] : null; if (!a) return res.status(404).json({ error: 'That alert has already cleared.' });
  const hours = Number(req.body?.hours); if (!ALERT_MUTE_HOURS.includes(hours)) return res.status(400).json({ error: 'Pick for how long.' });
  if (ALERT_KIND[alertKindOf(a)].safety && req.body?.confirm !== true) return res.status(400).json({ error: 'Snoozing a safety alert needs a confirm.', needsConfirm: true });
  a.snoozed = { until: new Date(Date.now() + hours * 3600_000).toISOString(), by: req.user?.name || req.user?.username || 'someone' }; saveAlerts();
  if (typeof audit === 'function' && req.user) audit(req, 'alert-snoozed', { alert: a.title, hours });
  res.json({ ok: true, snoozed: a.snoozed });
});
/* "Mark resolved": off the list now; if the problem is still there it stays quiet until it clears and comes back. */
app.post('/api/alerts/:id/resolve', requireRole('member'), (req, res) => {
  const a = Object.hasOwn(alerts.open, req.params.id) ? alerts.open[req.params.id] : null; if (!a) return res.status(404).json({ error: 'That alert has already cleared.' });
  (alerts.resolved ||= {})[req.params.id] = nowIso(); delete alerts.open[req.params.id];
  alertRaise({ id: `cleared:${req.params.id}`, severity: 'ok', title: `Cleared: ${a.title}`, source: a.source, by: req.user?.name || null });
  if (typeof audit === 'function' && req.user) audit(req, 'alert-resolved', { alert: a.title });
  res.json({ ok: true });
});
/* Mute a device or a kind for a while: for me (my phones) or, for an admin, for everyone. */
app.post('/api/alerts/mute', requireRole('member'), express.json({ limit: '1kb' }), (req, res) => {
  const b = req.body || {}, hours = Number(b.hours), uid = alertUserKey(req), admin = !signInOn() || ['owner', 'admin'].includes(req.user?.role);
  if (!ALERT_MUTE_HOURS.includes(hours)) return res.status(400).json({ error: 'Pick for how long.' });
  const kind = b.kind != null ? String(b.kind) : null, device = b.device != null ? String(b.device).slice(0, 200) : null;
  if ((!kind && !device) || (kind && !Object.hasOwn(ALERT_KIND, kind))) return res.status(400).json({ error: 'Pick what to mute.' });
  const scope = b.everyone === true ? 'house' : uid; if (scope === 'house' && !admin) return res.status(403).json({ error: 'Only an admin can do that.' });
  const safety = kind ? !!ALERT_KIND[kind].safety : b.safety === true || Object.values(alerts.open).some((a) => alertDeviceOf(a) === device && ALERT_KIND[alertKindOf(a)].safety);
  if (safety && b.confirm !== true) return res.status(400).json({ error: 'Muting a safety alert needs a confirm: you could miss a leak, smoke or a freezing pipe.', needsConfirm: true });
  const m = { id: crypto.randomBytes(5).toString('hex'), scope, ...(kind ? { kind } : { device }), name: String(b.name || '').slice(0, 80) || null, until: Date.now() + hours * 3600_000, by: req.user?.name || req.user?.username || 'someone', ...(safety ? { confirmed: true } : {}) };
  alertMutes().push(m); if (alerts.mutes.length > 100) alerts.mutes.splice(0, alerts.mutes.length - 100); saveAlerts();
  if (typeof audit === 'function' && req.user) audit(req, 'alert-muted', { what: kind || device, hours, everyone: scope === 'house' });
  res.json({ ok: true, mute: m });
});
app.delete('/api/alerts/mute/:id', requireRole('member'), (req, res) => {
  const uid = alertUserKey(req), admin = !signInOn() || ['owner', 'admin'].includes(req.user?.role);
  const before = alertMutes().length; alerts.mutes = alerts.mutes.filter((m) => !(m.id === req.params.id && (m.scope === uid || admin)));
  if (alerts.mutes.length !== before) saveAlerts();
  res.json({ ok: true });
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchAlertRules = { ALERT_KINDS, alertKindOf, alertDeviceOf, alertBaseId, alertTier, alertRuleFor, alertDecide, quietIn, quietOk, flapStep, cleanRule, applyRule, FLAP_WINDOW_MS };
