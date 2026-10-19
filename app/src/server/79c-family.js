/* ======================================================================
 * Family board - the things a family keeps on the fridge, on every screen:
 *  - Lists: shopping and to-do lists everyone shares. Our own lists, or Home Assistant's to-do lists (todo.*),
 *    two-way: an item added or checked here is added or checked in Home Assistant, and the other way round.
 *    Home Assistant is reached over its websocket (todo.get_items / add_item / update_item / remove_item).
 *  - Chores with stars: per-person chores that repeat every day, on chosen weekdays, or once a week. Tap to
 *    say it's done; each chore is worth stars; the tally starts again at the start of every week.
 *  - Routines: morning and evening chores in order, with a picture each - a big-tap screen for kids.
 *  - Meals: the week's dinners (with a recipe link), today's on the Today widget; copy last week in one tap.
 *  - Outside: your own weather station - an outdoor temperature sensor and a rain sensor from Home Assistant,
 *    Shelly or YoLink replace the forecast's "now" (weatherNow in 20-weather.js asks famOutside here), and
 *    "It started raining" can go up as an alert.
 *  - Status chips: what the wall-panel status bar shows - "3 lights on", "Garage open", "18° outside".
 * Kept in DATA_DIR/family.json (owner-only file). The demo starts with a sample family; its changes stay in
 * memory and are gone after a restart.
 *   GET  /api/family                         what the screens show (people, lists with items, today's chores, stars, meals)
 *   GET  /api/family/setup                   the settings, names to suggest, Home Assistant to-do lists not added yet
 *   PUT  /api/family/settings                week start, outside sensors, rain alert, status chips (members and up)
 *   PUT  /api/family/people                  the family (members and up)
 *   POST /api/family/lists, PUT|DELETE /api/family/lists/:id
 *   POST /api/family/lists/:id/items, PUT|DELETE /api/family/lists/:id/items/:item, POST /api/family/lists/:id/clear
 *   POST /api/family/chores, PUT|DELETE /api/family/chores/:id, POST /api/family/chores/:id/done, PUT /api/family/order
 *   GET  /api/family/meals?from=, PUT /api/family/meals/:date, POST /api/family/meals/copy
 *   GET  /api/family/chips                   the status chips, worked out now
 * ====================================================================== */
const FAM_FILE = path.join(DATA_DIR, 'family.json');
const FAM_ICONS = ['star', 'tooth', 'bed', 'shirt', 'book', 'backpack', 'broom', 'dish', 'bath', 'moon', 'sun', 'apple', 'toy', 'paw', 'plant', 'trash', 'laundry', 'music', 'cart', 'meal', 'list', 'home', 'school', 'heart', 'bike', 'pill', 'water', 'check'];
const FAM_COLORS = ['#5eb8ff', '#8b7bff', '#34d399', '#fbbf24', '#fb923c', '#f43f5e', '#ec4899', '#22d3ee', '#a3e635', '#94a3b8'];
const FAM_REPEAT = ['daily', 'days', 'weekly'];
const FAM_CHIP_COUNTS = ['lights', 'doors', 'windows', 'unlocked', 'people', 'media', 'plugs'];
const FAM_YMD = /^\d{4}-\d{2}-\d{2}$/;
const famDefaults = () => ({ people: [], lists: [], chores: [], done: {}, meals: {}, weekStart: 0, outside: { temp: null, rain: null, rainAlert: false }, chips: [] });
const fam = { d: famDefaults(), demo: false, rain: { wet: null, at: 0 } };

/* ---- dates: plain "YYYY-MM-DD" days in the house's own time zone, counted in UTC (daylight saving never moves a day) ---- */
const famMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const famYmdOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const famAdd = (s, n) => famYmdOf(famMs(s) + n * 86400_000);
const famDow = (s) => new Date(famMs(s)).getUTCDay();
function famToday(ms = Date.now(), tz = houseTz()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
  catch { return famYmdOf(ms); }
}
/** The first day of the week `ymd` is in (weekStart 0 = Sunday, 1 = Monday). */
const famWeekOf = (ymd, ws = 0) => famAdd(ymd, -((famDow(ymd) - ws + 7) % 7));

/* ---- repeats and stars (pure: the unit tests call these) ---- */
/** Is chore `c` on the list for day `ymd`? Every day; on chosen weekdays; or once a week (on the list every day until done). */
function famDueOn(c, ymd) {
  const r = FAM_REPEAT.includes(c?.repeat) ? c.repeat : 'daily';
  if (r === 'days') return Array.isArray(c.days) && c.days.includes(famDow(ymd));
  return true;
}
/** Who does chore `c`: each person it's for does their own; nobody picked = anyone (one shared check). */
const famSlots = (c) => (Array.isArray(c.who) && c.who.length ? c.who : ['*']);
const famKey = (c, p) => `${c.id}|${p}`;
/** The record that counts as "done" for this chore, this person, on this day (a weekly chore: any day this week, up to this day). */
function famDoneRec(c, p, ymd, done, ws = 0) {
  if (c.repeat !== 'weekly') return done?.[ymd]?.[famKey(c, p)] || null;
  for (let d = famWeekOf(ymd, ws); d <= ymd; d = famAdd(d, 1)) { const r = done?.[d]?.[famKey(c, p)]; if (r) return { ...r, day: d }; }
  return null;
}
/** Today's chores: what's due, in order, and who has done theirs. */
function famChoresOn(chores, ymd, done, ws = 0) {
  return chores.filter((c) => famDueOn(c, ymd)).sort((a, b) => (a.routine || '').localeCompare(b.routine || '') || (a.order ?? 0) - (b.order ?? 0))
    .map((c) => ({ id: c.id, title: c.title, icon: c.icon, stars: c.stars, routine: c.routine || null, repeat: c.repeat, days: c.days || null, order: c.order ?? 0,
      slots: famSlots(c).map((p) => { const r = famDoneRec(c, p, ymd, done, ws); return { person: p, done: !!r, by: r?.by || null, at: r?.at || null }; }) }));
}
/** Stars per person between two days (inclusive), from what was done - each record keeps the stars it was worth then. */
function famStarsBetween(done, from, to) {
  const out = {};
  for (const [day, recs] of Object.entries(done || {})) {
    if (day < from || day > to) continue;
    for (const r of Object.values(recs || {})) if (r?.by && r.by !== '*') out[r.by] = (out[r.by] || 0) + (Number(r.stars) || 0);
  }
  return out;
}
/** This week's tally (it starts again every week) and last week's, for "Last week: 12 stars". */
function famStars(done, ymd, ws = 0) {
  const w = famWeekOf(ymd, ws);
  return { since: w, week: famStarsBetween(done, w, famAdd(w, 6)), lastWeek: famStarsBetween(done, famAdd(w, -7), famAdd(w, -1)) };
}
/** Mark (or unmark) a chore done for a person on a day. Returns the new `done` map (old days past 70 are let go). */
function famMark(done, c, p, ymd, on, by, now = new Date().toISOString(), ws = 0) {
  const out = { ...done };
  if (c.repeat === 'weekly' && !on) {   // undoing a weekly chore undoes it on whichever day this week it was done
    const r = famDoneRec(c, p, ymd, done, ws); if (r?.day) { out[r.day] = { ...out[r.day] }; delete out[r.day][famKey(c, p)]; }
  } else {
    out[ymd] = { ...(out[ymd] || {}) };
    if (on) out[ymd][famKey(c, p)] = { by: p !== '*' ? p : by || '*', at: now, stars: Number(c.stars) || 0 };
    else delete out[ymd][famKey(c, p)];
  }
  const keep = famAdd(ymd, -70);
  for (const d of Object.keys(out)) if (d < keep || !Object.keys(out[d] || {}).length) delete out[d];
  return out;
}
/** Copy one week's meals onto the next: days that had a meal are copied, days that didn't are left as they are. */
function famCopyWeek(meals, toWeek) {
  const out = { ...meals };
  for (let i = 0; i < 7; i++) { const src = meals[famAdd(toWeek, i - 7)]; if (src?.title) out[famAdd(toWeek, i)] = { ...src }; }
  return out;
}

/* ---- Home Assistant to-do lists, over its websocket ---- */
/** One websocket message for a to-do operation. */
function famTodoCmd(op, entity, a = {}) {
  const base = { type: 'call_service', domain: 'todo', target: { entity_id: entity } };
  if (op === 'list') return { ...base, service: 'get_items', service_data: { status: ['needs_action', 'completed'] }, return_response: true };
  if (op === 'add') return { ...base, service: 'add_item', service_data: { item: String(a.text) } };
  if (op === 'update') return { ...base, service: 'update_item', service_data: { item: String(a.id), ...(a.text != null ? { rename: String(a.text) } : {}), ...(a.done != null ? { status: a.done ? 'completed' : 'needs_action' } : {}) } };
  if (op === 'remove') return { ...base, service: 'remove_item', service_data: { item: [String(a.id)] } };
  if (op === 'clear') return { ...base, service: 'remove_completed_items', service_data: {} };
  throw new Error(`unknown to-do step ${op}`);
}
/** Home Assistant's answer to todo.get_items, as our items. */
function famTodoFromHa(result, entity) {
  const items = result?.response?.[entity]?.items ?? result?.[entity]?.items ?? [];
  return (Array.isArray(items) ? items : []).filter((it) => it && it.summary != null).slice(0, 500).map((it) => ({
    id: String(it.uid || it.summary).slice(0, 200), text: String(it.summary).slice(0, 200), done: it.status === 'completed',
    due: typeof it.due === 'string' ? it.due.slice(0, 25) : null, note: typeof it.description === 'string' && it.description ? it.description.slice(0, 300) : null,
  }));
}
/** Sign in to Home Assistant's websocket, send the commands, collect their results (in order), close. */
function famHaWs(cmds, { url, token, WS = globalThis.WebSocket, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!url || !token) return reject(new Error('Home Assistant is not connected'));
    if (typeof WS !== 'function') return reject(new Error('this Node has no websocket'));
    let ws, finished = false; const results = new Array(cmds.length), got = new Set();
    const end = (err) => { if (finished) return; finished = true; clearTimeout(timer); try { ws?.close(); } catch { /* closing anyway */ } if (err) reject(err); else resolve(results); };
    const timer = setTimeout(() => end(new Error('Home Assistant did not answer')), timeout);
    try { ws = new WS(`${String(url).replace(/^http/i, 'ws').replace(/\/+$/, '')}/api/websocket`); } catch (e) { return end(e); }
    ws.addEventListener('message', (m) => {
      let msg; try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_invalid') end(new Error('Home Assistant turned the token down'));
      else if (msg.type === 'auth_ok') cmds.forEach((c, i) => ws.send(JSON.stringify({ id: i + 1, ...c })));
      else if (msg.type === 'result' && msg.id >= 1 && msg.id <= cmds.length && !got.has(msg.id)) {
        got.add(msg.id); results[msg.id - 1] = msg.success ? { ok: true, result: msg.result } : { ok: false, error: String(msg.error?.message || 'Home Assistant said no') };
        if (got.size === cmds.length) end();
      }
    });
    ws.addEventListener('error', () => end(new Error('could not reach Home Assistant')));
    ws.addEventListener('close', () => end(got.size === cmds.length ? null : new Error('Home Assistant closed the connection')));
  });
}
const FAM_HA = new Map();   // entity -> { at, stamp, items }
const famHaConf = () => ({ url: config.homeAssistant?.url, token: config.homeAssistant?.token });
async function famHaItems(entity) {
  const st = (await haStates().catch(() => [])).find((s) => s.entity_id === entity);
  const stamp = st ? `${st.state}|${st.last_updated || st.last_changed || ''}` : '';
  const hit = FAM_HA.get(entity);
  if (hit && (Date.now() - hit.at < 4000 || (hit.stamp === stamp && stamp && Date.now() - hit.at < 60_000))) return hit.items;
  const [r] = await famHaWs([famTodoCmd('list', entity)], famHaConf());
  if (!r?.ok) throw new Error(r?.error || 'Home Assistant did not send the list');
  const items = famTodoFromHa(r.result, entity);
  FAM_HA.set(entity, { at: Date.now(), stamp, items });
  return items;
}
async function famHaDo(entity, op, a) {
  const [r] = await famHaWs([famTodoCmd(op, entity, a)], famHaConf());
  FAM_HA.delete(entity);
  if (!r?.ok) throw new Error(r?.error || 'Home Assistant said no');
}
/** Home Assistant's to-do lists (todo.*), with how many are still to do. */
async function famHaLists() {
  if (fam.demo) return [{ entity: 'todo.shopping_list', name: 'Shopping List', open: 3 }, { entity: 'todo.hardware_store', name: 'Hardware store', open: 2 }];
  if (!config.homeAssistant?.url) return [];
  return (await haStates().catch(() => [])).filter((s) => /^todo\.[\w-]+$/.test(s.entity_id)).map((s) => ({ entity: s.entity_id, name: String(s.attributes?.friendly_name || s.entity_id.slice(5)).slice(0, 60), open: Number(s.state) || 0 }));
}

/* ---- loading and saving ---- */
function famLoad() {
  if (isDemo()) { fam.d = famDemoData(); fam.demo = true; return; }
  try { const j = JSON.parse(fs.readFileSync(FAM_FILE, 'utf8')); fam.d = { ...famDefaults(), ...j, outside: { ...famDefaults().outside, ...(j.outside || {}) } }; } catch { /* first run */ }
}
let famSaveT = null;
function famSave() {
  if (fam.demo) return;
  clearTimeout(famSaveT);
  famSaveT = setTimeout(() => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileSafe(FAM_FILE, JSON.stringify(fam.d), 0o600); } catch (e) { console.warn('family: could not save', e.message); } }, 600);
}
const famChanged = () => { famSave(); if (typeof liveNudge === 'function') liveNudge(); };

/* ---- checking what people send ---- */
const famId = () => crypto.randomBytes(5).toString('hex');
const famStr = (v, max, what) => { const s = String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); if (what && !s) throw new Error(what); return s; };
const famIcon = (v, d = 'star') => (FAM_ICONS.includes(v) ? v : d);
const famColor = (v, d = FAM_COLORS[0]) => (FAM_COLORS.includes(v) ? v : d);
const famUrl = (v) => { const s = String(v || '').trim(); if (!s) return null; try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href.slice(0, 500) : null; } catch { return null; } };
const famPersonOk = (p) => p === '*' || fam.d.people.some((x) => x.id === p);
function famCleanPerson(p, old = {}) {
  return { id: old.id || (/^[0-9a-f]{10}$/.test(String(p.id || '')) ? String(p.id) : famId()), name: famStr(p.name ?? old.name, 24, 'Give everyone a name.'), color: famColor(p.color, old.color),
    icon: famIcon(p.icon, old.icon || 'star'), goal: Math.max(0, Math.min(500, Math.round(Number(p.goal ?? old.goal) || 0))), reward: famStr(p.reward ?? old.reward ?? '', 60) };
}
function famCleanChore(c, old = {}) {
  const repeat = FAM_REPEAT.includes(c.repeat) ? c.repeat : old.repeat || 'daily';
  const days = repeat === 'days' ? [...new Set((Array.isArray(c.days) ? c.days : old.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : undefined;
  if (repeat === 'days' && !days.length) throw new Error('Pick at least one day.');
  const who = (Array.isArray(c.who) ? c.who : old.who || []).map(String).filter((p) => fam.d.people.some((x) => x.id === p)).slice(0, 12);
  const routine = c.routine === undefined ? old.routine || null : ['morning', 'evening'].includes(c.routine) ? c.routine : null;
  return { id: old.id || famId(), title: famStr(c.title ?? old.title, 60, 'Give the chore a name, like "Feed the cat".'), icon: famIcon(c.icon, old.icon || 'star'),
    stars: Math.max(0, Math.min(5, Math.round(Number(c.stars ?? old.stars ?? 1)))), repeat, ...(days ? { days } : {}), who, routine,
    order: Number.isFinite(Number(c.order)) ? Number(c.order) : old.order ?? fam.d.chores.length };
}
const famListOf = (id) => fam.d.lists.find((l) => l.id === id);
const famDevOk = (v) => (v == null || v === '' ? null : /^[\w-]{1,30}:[\w.:-]{1,160}$/.test(String(v)) ? String(v) : undefined);
function famCleanChip(c) {
  if (c?.kind === 'count' && FAM_CHIP_COUNTS.includes(c.what)) return { kind: 'count', what: c.what };
  if (c?.kind === 'outside') return { kind: 'outside' };
  if (c?.kind === 'device' && famDevOk(c.id)) return { kind: 'device', id: String(c.id), when: c.when === 'active' ? 'active' : 'always' };
  return null;
}

/** A Home widget's "Show only when..." rule, checked (it's worked out in the browser: 38-family.js famRuleOk). */
const FAM_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function famCleanRule(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.conds)) return null;
  const conds = r.conds.slice(0, 6).map((c) => {
    if (c?.type === 'time') return FAM_HHMM.test(c.from) && FAM_HHMM.test(c.to) ? { type: 'time', from: c.from, to: c.to } : null;
    if (c?.type === 'days') { const days = [...new Set((Array.isArray(c.days) ? c.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(); return days.length ? { type: 'days', days } : null; }
    if (c?.type === 'home') { const who = ['anyone', 'nobody'].includes(c.who) ? c.who : famDevOk(c.who); return who ? { type: 'home', who } : null; }
    if (c?.type === 'state') { const id = famDevOk(c.id); if (!id) return null; const op = ['is', 'not', 'above', 'below'].includes(c.op) ? c.op : 'is'; return { type: 'state', id, op, value: String(c.value ?? '').slice(0, 40) }; }
    return null;
  }).filter(Boolean);
  return conds.length ? { mode: r.mode === 'any' ? 'any' : 'all', conds } : null;
}

/* ---- your own weather station ---- */
/** Rain from a sensor: a rain/moisture binary sensor (on = raining), or a rain rate (mm/h or in/h; more than 0 = raining). */
function famRainOf(d) {
  if (!d || d.online === false) return null;
  if (typeof d.water === 'boolean') return { wet: d.water, mm: null };
  if (typeof d.on === 'boolean' && d.kind === 'sensor') return { wet: d.on, mm: null };
  if (d.state === 'on' || d.state === 'off') return { wet: d.state === 'on', mm: null };
  const n = Number(d.value); if (!Number.isFinite(n)) return null;
  const mm = /in/i.test(d.unit || '') ? n * 25.4 : n;
  return { wet: mm > 0, mm: Math.round(mm * 10) / 10 };
}
/** The forecast's "now", with your own sensors' temperature and rain in its place (a new object: the cached forecast is untouched). */
function famApplyOutside(view, temp, rain) {
  if (!view?.now) return view;
  const now = { ...view.now }, from = [];
  if (temp && temp.tempC != null && temp.online !== false) { now.temp = tempOut(temp.tempC); now.tempC = temp.tempC; from.push(temp.name); }
  const r = famRainOf(rain);
  if (r) {
    from.push(rain.name); now.raining = r.wet;
    if (r.mm != null) now.rainMm = r.mm; else if (!r.wet) now.rainMm = 0; else now.rainMm = Math.max(0.5, Number(now.rainMm) || 0);
    const sym = String(now.symbol || '');
    if (r.wet && !/rain|shower|thunder|sleet|snow/.test(sym)) { now.symbol = 'rain'; now.words = 'Rain'; }
    else if (!r.wet && /rain|shower|thunder|sleet/.test(sym)) { now.symbol = 'cloudy'; now.words = 'Cloudy'; }
  }
  return from.length ? { ...view, now: { ...now, station: from.join(' · ') } } : view;
}
async function famOutside(view) {
  const o = fam.d.outside || {};
  if ((!o.temp && !o.rain) || !view?.now) return view;
  try {
    const { devices } = await houseDevices();
    return famApplyOutside(view, o.temp ? devices.find((d) => d.id === o.temp) : null, o.rain ? devices.find((d) => d.id === o.rain) : null);
  } catch { return view; }
}
/* "It started raining": once when the rain sensor goes from dry to wet (and not again within 45 minutes). */
setInterval(async () => {
  const o = fam.d.outside || {}; if (fam.demo || !o.rain || !o.rainAlert) { fam.rain.wet = null; return; }
  try {
    const d = (await houseDevices()).devices.find((x) => x.id === o.rain), r = famRainOf(d); if (!r) return;
    if (r.wet && fam.rain.wet === false && Date.now() - fam.rain.at > 45 * 60_000) { fam.rain.at = Date.now(); alertRaise({ id: `rain:${Date.now()}`, severity: 'notice', title: 'It started raining', source: 'casatorch', msg: 'It started raining' }); }
    fam.rain.wet = r.wet;
  } catch { /* next minute */ }
}, 60_000).unref?.();

/* ---- the status chips ---- */
const famIsPerson = (d) => d.kind === 'presence' && (d.domain === 'person' || /^ha:person\./.test(d.id));
function famDeviceWords(d) {
  if (d.kind === 'cover' || (d.open != null && d.kind === 'sensor')) return d.open ? ['open', true] : ['closed', false];
  if (d.kind === 'lock') return d.locked === false ? ['unlocked', true] : ['locked', false];
  if (d.kind === 'presence') return d.home ? ['home', true] : ['away', false];
  if (d.kind === 'media') return d.playing ? ['playing', true] : d.on ? ['on', true] : ['off', false];
  if (d.tempC != null) return [`${tempOut(d.tempC)}°`, true];
  if (d.humidity != null) return [`${Math.round(d.humidity)}%`, true];
  if (d.powerW != null) return [`${Math.round(d.powerW)} W`, d.powerW > 1];
  if (typeof d.on === 'boolean') return d.on ? ['on', true] : ['off', false];
  if (d.value != null) return [`${String(d.value).slice(0, 16)}${d.unit ? ` ${d.unit}` : ''}`, true];
  return [d.state || '', true];
}
/** The chips, worked out from the devices now. Each is { text (English), msg + vars (to translate), icon, tone }. */
function famChipsOf(chips, devices, wx) {
  const out = [], n = (f) => devices.filter(f).length;
  const isDoor = (d) => d.open === true && ((d.kind === 'cover' && d.risky) || ['door', 'garage_door', 'opening'].includes(d.haClass) || (d.kind === 'sensor' && /door|gate/i.test(d.name) && d.haClass !== 'window'));
  const isWin = (d) => d.open === true && (d.haClass === 'window' || (d.kind === 'sensor' && /window/i.test(d.name)));
  for (const c of chips) {
    if (c.kind === 'outside') { if (wx?.now?.temp != null) out.push({ text: `${wx.now.temp}° outside`, msg: '{t}° outside', vars: { t: wx.now.temp }, icon: 'thermo' }); continue; }
    if (c.kind === 'device') {
      const d = devices.find((x) => x.id === c.id); if (!d) continue;
      const [w, active] = famDeviceWords(d); if (c.when === 'active' && !active) continue;
      const warn = (d.kind === 'cover' && d.risky && d.open) || (d.kind === 'lock' && d.locked === false) || (d.kind === 'sensor' && d.open === true && /door|gate|garage/i.test(`${d.haClass} ${d.name}`));
      out.push({ text: `${d.name} ${w}`, msg: `{name} ${['open', 'closed', 'unlocked', 'locked', 'home', 'away', 'playing', 'on', 'off'].includes(w) ? w : '{v}'}`, vars: { name: d.name, v: w }, icon: d.kind === 'lock' ? 'lock' : d.kind === 'presence' ? 'user' : d.open != null ? 'door' : d.tempC != null ? 'thermo' : d.kind === 'light' ? 'bulb' : 'dotc', tone: warn ? 'warn' : '' });
      continue;
    }
    const W = c.what;
    if (W === 'lights') { const k = n((d) => d.kind === 'light' && d.on); if (k) out.push({ text: `${k} light${k === 1 ? '' : 's'} on`, msg: k === 1 ? '1 light on' : '{n} lights on', vars: { n: k }, icon: 'bulb' }); }
    else if (W === 'plugs') { const k = n((d) => ['plug', 'switch'].includes(d.kind) && d.on); if (k) out.push({ text: `${k} switched on`, msg: '{n} switched on', vars: { n: k }, icon: 'plug' }); }
    else if (W === 'doors') { const k = n(isDoor); if (k) out.push({ text: k === 1 ? `${devices.find(isDoor).name} open` : `${k} doors open`, msg: k === 1 ? '{name} open' : '{n} doors open', vars: { n: k, name: devices.find(isDoor).name }, icon: 'door', tone: 'warn' }); }
    else if (W === 'windows') { const k = n(isWin); if (k) out.push({ text: `${k} window${k === 1 ? '' : 's'} open`, msg: k === 1 ? '1 window open' : '{n} windows open', vars: { n: k }, icon: 'door' }); }
    else if (W === 'unlocked') { const k = n((d) => d.kind === 'lock' && d.locked === false); if (k) out.push({ text: `${k} unlocked`, msg: '{n} unlocked', vars: { n: k }, icon: 'lock', tone: 'warn' }); }
    else if (W === 'media') { const k = n((d) => d.kind === 'media' && d.playing); if (k) out.push({ text: `${k} playing`, msg: '{n} playing', vars: { n: k }, icon: 'music' }); }
    else if (W === 'people') {
      const ppl = devices.filter(famIsPerson); if (!ppl.length) continue;
      const k = ppl.filter((d) => d.home).length;
      out.push(k ? { text: `${k} home`, msg: '{n} home', vars: { n: k }, icon: 'user' } : { text: 'Nobody home', msg: 'Nobody home', icon: 'user' });
    }
  }
  return out.slice(0, 10);
}

/* ---- what the screens get ---- */
const famPublicList = (l) => ({ id: l.id, name: l.name, icon: l.icon, source: l.source, entity: l.entity || null });
async function famListItems(l) {
  if (l.source === 'ha' && !fam.demo) {
    try { return { items: await famHaItems(l.entity) }; } catch (e) { return { items: [], error: String(e.message) }; }
  }
  return { items: (l.items || []).map(({ id, text, done }) => ({ id, text, done: !!done })) };
}
async function famView() {
  const today = famToday(), ws = fam.d.weekStart || 0, wk = famWeekOf(today, ws);
  const lists = await Promise.all(fam.d.lists.map(async (l) => ({ ...famPublicList(l), ...(await famListItems(l)) })));
  const meals = {}; for (let i = 0; i < 14; i++) { const d = famAdd(wk, i), m = fam.d.meals[d]; if (m) meals[d] = m; }
  return { today, weekStart: ws, week: wk, people: fam.d.people, lists, chores: famChoresOn(fam.d.chores, today, fam.d.done, ws), allChores: fam.d.chores,
    stars: famStars(fam.d.done, today, ws), meals, dinner: fam.d.meals[today] || null, tomorrow: fam.d.meals[famAdd(today, 1)] || null, demo: fam.demo, icons: FAM_ICONS, colors: FAM_COLORS };
}
/* Names to offer when adding the family: people with a sign-in, and the people Home Assistant tracks. */
async function famSuggestNames() {
  const have = new Set(fam.d.people.map((p) => p.name.toLowerCase())), out = [];
  const add = (name, from) => { const n = String(name || '').trim().slice(0, 24); if (n && !have.has(n.toLowerCase())) { have.add(n.toLowerCase()); out.push({ name: n, from }); } };
  if (!fam.demo) for (const u of users?.list || []) add(String(u.name || u.username || '').split(/\s+/)[0], 'sign-in');
  for (const d of ((await houseDevices().catch(() => ({ devices: [] }))).devices || []).filter(famIsPerson)) add(d.name, 'home-assistant');
  return out.slice(0, 12);
}

/* ---- the demo family (sample names only) ---- */
function famDemoData() {
  const today = famToday(Date.now(), houseTz()), wk = famWeekOf(today, 0), id = (s) => `d${s}`.padEnd(10, '0').slice(0, 10);
  const people = [{ id: id('mia'), name: 'Mia', color: '#ec4899', icon: 'star', goal: 70, reward: 'Movie night pick' }, { id: id('leo'), name: 'Leo', color: '#34d399', icon: 'bike', goal: 70, reward: 'Pancake Saturday' }, { id: id('alex'), name: 'Alex', color: '#5eb8ff', icon: 'heart', goal: 0, reward: '' }];
  const [mia, leo, alex] = people.map((p) => p.id);
  const ch = (k, title, icon, extra) => ({ id: id(k), title, icon, stars: 1, repeat: 'daily', who: [mia, leo], routine: null, order: 0, ...extra });
  const chores = [
    ch('m1', 'Get dressed', 'shirt', { routine: 'morning', order: 1 }), ch('m2', 'Eat breakfast', 'apple', { routine: 'morning', order: 2 }), ch('m3', 'Brush teeth', 'tooth', { routine: 'morning', order: 3 }), ch('m4', 'Pack your backpack', 'backpack', { routine: 'morning', order: 4, repeat: 'days', days: [1, 2, 3, 4, 5] }),
    ch('e1', 'Tidy your toys', 'toy', { routine: 'evening', order: 1 }), ch('e2', 'Bath or shower', 'bath', { routine: 'evening', order: 2 }), ch('e3', 'Brush teeth', 'tooth', { routine: 'evening', order: 3 }), ch('e4', 'Read a story', 'book', { routine: 'evening', order: 4 }),
    ch('c1', 'Feed the cat', 'paw', { who: [mia], stars: 2 }), ch('c2', 'Set the table', 'dish', { who: [leo], stars: 2, repeat: 'days', days: [1, 3, 5] }), ch('c3', 'Water the plants', 'plant', { who: [], stars: 2, repeat: 'weekly' }),
    ch('c4', 'Take out the recycling', 'trash', { who: [alex], stars: 1, repeat: 'days', days: [4] }), ch('c5', 'Clean your room', 'broom', { stars: 3, repeat: 'weekly' }),
  ];
  let done = {};
  const at = (d, h) => `${d}T${String(h).padStart(2, '0')}:10:00.000Z`;
  for (let i = -9; i <= 0; i++) {   // a believable week and a bit: most morning things done, some evenings missed
    const d = famAdd(today, i);
    for (const c of famChoresOn(chores, d, done, 0)) for (const s of c.slots) {
      const chore = chores.find((x) => x.id === c.id), roll = (c.id.charCodeAt(2) * 7 + i * 13 + s.person.charCodeAt(1)) % 10;
      if (s.done || (i === 0 && (chore.routine === 'evening' || roll > 4)) || roll > 7) continue;
      done = famMark(done, chore, s.person, d, true, s.person === '*' ? mia : null, at(d, chore.routine === 'evening' ? 3 : 15), 0);
    }
  }
  const menu = [['Tacos'], ['Spaghetti and meatballs'], ['Chicken stir-fry'], ['Leftovers'], ['Homemade pizza', null, 'Kids make their own'], ['Fish and chips'], ['Pancakes for dinner'],
    ['Roast chicken and potatoes'], ['Veggie lasagna', 'https://www.example.com/recipes/veggie-lasagna'], ['Tacos'], ['Lentil soup and bread', 'https://www.example.com/recipes/lentil-soup'], ['Burgers on the grill'], ['Homemade pizza', null, 'Kids make their own'], ['Pasta night']];
  const meals = {};
  for (let i = -7; i < 14; i++) { const [title, url = null, note = ''] = menu[(i + 7) % menu.length]; if (i !== 12) meals[famAdd(wk, i)] = { title, url, note }; }

  const item = (text, d = false) => ({ id: famId(), text, done: d, at: new Date().toISOString() });
  return {
    people, chores, done, meals, weekStart: 0, chips: [{ kind: 'count', what: 'lights' }, { kind: 'device', id: 'ha:cover.garage_door', when: 'always' }, { kind: 'count', what: 'doors' }, { kind: 'outside' }, { kind: 'count', what: 'people' }],
    outside: { temp: 'ha:sensor.outdoor_temperature', rain: null, rainAlert: false },
    lists: [
      { id: id('shop'), name: 'Shopping List', icon: 'cart', source: 'ha', entity: 'todo.shopping_list', items: [item('Milk'), item('Bananas'), item('Bread'), item('Eggs', true)] },
      { id: id('todo'), name: 'To do', icon: 'list', source: 'local', items: [item('Call the plumber about the kitchen sink'), item('Sign the school trip form'), item('Return library books', true)] },
      { id: id('party'), name: 'Birthday party', icon: 'heart', source: 'local', items: [item('Balloons'), item('Candles'), item('Order the cake')] },
    ],
  };
}
famLoad();

/* ---- routes ---- */
const famBad = (res, e) => res.status(400).json({ error: String(e.message || e) });
app.get('/api/family', async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await famView()); });
app.get('/api/family/setup', async (_req, res) => {
  const lists = await famHaLists(), used = new Set(fam.d.lists.filter((l) => l.source === 'ha').map((l) => l.entity));
  res.json({ weekStart: fam.d.weekStart || 0, outside: fam.d.outside, chips: fam.d.chips, people: fam.d.people, suggest: await famSuggestNames(), haLists: lists.filter((l) => !used.has(l.entity)), ha: fam.demo || !!config.homeAssistant?.url, demo: fam.demo, icons: FAM_ICONS, colors: FAM_COLORS, counts: FAM_CHIP_COUNTS });
});
app.put('/api/family/settings', requireRole('member'), express.json({ limit: '16kb' }), (req, res) => {
  const b = req.body || {};
  try {
    if (b.weekStart != null) fam.d.weekStart = Number(b.weekStart) === 1 ? 1 : 0;
    if (b.outside) {
      const t = famDevOk(b.outside.temp), r = famDevOk(b.outside.rain); if (t === undefined || r === undefined) throw new Error('Pick a sensor from the list.');
      fam.d.outside = { temp: t, rain: r, rainAlert: !!b.outside.rainAlert };
    }
    if (Array.isArray(b.chips)) fam.d.chips = b.chips.map(famCleanChip).filter(Boolean).slice(0, 10);
  } catch (e) { return famBad(res, e); }
  famChanged(); res.json({ ok: true, weekStart: fam.d.weekStart, outside: fam.d.outside, chips: fam.d.chips });
});
app.put('/api/family/people', requireRole('member'), express.json({ limit: '16kb' }), (req, res) => {
  try {
    const list = (Array.isArray(req.body?.people) ? req.body.people : []).slice(0, 12).map((p) => famCleanPerson(p, fam.d.people.find((x) => x.id === p.id) || {}));
    const ids = new Set(list.map((p) => p.id));
    fam.d.people = list;
    for (const c of fam.d.chores) c.who = (c.who || []).filter((p) => ids.has(p));
  } catch (e) { return famBad(res, e); }
  famChanged(); res.json({ ok: true, people: fam.d.people });
});
/* lists */
app.post('/api/family/lists', requireRole('member'), express.json({ limit: '4kb' }), async (req, res) => {
  const b = req.body || {};
  try {
    if (fam.d.lists.length >= 20) throw new Error('That\'s 20 lists - remove one first.');
    const l = { id: famId(), name: famStr(b.name, 40, 'Give the list a name, like "Groceries".'), icon: famIcon(b.icon, 'list'), source: b.source === 'ha' ? 'ha' : 'local' };
    if (l.source === 'ha') {
      if (!/^todo\.[\w-]{1,120}$/.test(String(b.entity || ''))) throw new Error('Pick the Home Assistant to-do list.');
      if (!(await famHaLists()).some((x) => x.entity === b.entity)) throw new Error('Home Assistant doesn\'t have that list.');
      l.entity = String(b.entity); if (fam.demo) l.items = [];
    } else l.items = [];
    fam.d.lists.push(l); famChanged(); res.json({ ok: true, list: famPublicList(l) });
  } catch (e) { famBad(res, e); }
});
app.put('/api/family/lists/:id', requireRole('member'), express.json({ limit: '4kb' }), (req, res) => {
  const l = famListOf(req.params.id); if (!l) return res.status(404).json({ error: 'That list is gone.' });
  try { if (req.body?.name != null) l.name = famStr(req.body.name, 40, 'Give the list a name.'); if (req.body?.icon) l.icon = famIcon(req.body.icon, l.icon); } catch (e) { return famBad(res, e); }
  if (Array.isArray(req.body?.order)) { const ids = req.body.order.map(String); fam.d.lists.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); }
  famChanged(); res.json({ ok: true });
});
app.delete('/api/family/lists/:id', requireRole('member'), (req, res) => { fam.d.lists = fam.d.lists.filter((l) => l.id !== req.params.id); famChanged(); res.json({ ok: true }); });
app.post('/api/family/lists/:id/items', requireRole('member'), express.json({ limit: '4kb' }), async (req, res) => {
  const l = famListOf(req.params.id); if (!l) return res.status(404).json({ error: 'That list is gone.' });
  let text; try { text = famStr(req.body?.text, 120, 'Type what to add.'); } catch (e) { return famBad(res, e); }
  if (l.source === 'ha' && !fam.demo) { try { await famHaDo(l.entity, 'add', { text }); } catch (e) { return res.status(502).json({ error: `Home Assistant: ${e.message}` }); } return (famChanged(), res.json({ ok: true })); }
  if ((l.items || []).length >= 300) return famBad(res, new Error('That list is full - clear the checked items first.'));
  (l.items ||= []).unshift({ id: famId(), text, done: false, at: new Date().toISOString() }); famChanged(); res.json({ ok: true });
});
app.put('/api/family/lists/:id/items/:item', requireRole('member'), express.json({ limit: '4kb' }), async (req, res) => {
  const l = famListOf(req.params.id); if (!l) return res.status(404).json({ error: 'That list is gone.' });
  const b = req.body || {}; let text = null; try { if (b.text != null) text = famStr(b.text, 120, 'Type the item.'); } catch (e) { return famBad(res, e); }
  if (l.source === 'ha' && !fam.demo) { try { await famHaDo(l.entity, 'update', { id: req.params.item, text, done: b.done == null ? null : !!b.done }); } catch (e) { return res.status(502).json({ error: `Home Assistant: ${e.message}` }); } return (famChanged(), res.json({ ok: true })); }
  const it = (l.items || []).find((x) => x.id === req.params.item); if (!it) return res.status(404).json({ error: 'That item is gone.' });
  if (text != null) it.text = text; if (b.done != null) it.done = !!b.done;
  famChanged(); res.json({ ok: true });
});
app.delete('/api/family/lists/:id/items/:item', requireRole('member'), async (req, res) => {
  const l = famListOf(req.params.id); if (!l) return res.status(404).json({ error: 'That list is gone.' });
  if (l.source === 'ha' && !fam.demo) { try { await famHaDo(l.entity, 'remove', { id: req.params.item }); } catch (e) { return res.status(502).json({ error: `Home Assistant: ${e.message}` }); } return (famChanged(), res.json({ ok: true })); }
  l.items = (l.items || []).filter((x) => x.id !== req.params.item); famChanged(); res.json({ ok: true });
});
app.post('/api/family/lists/:id/clear', requireRole('member'), async (req, res) => {
  const l = famListOf(req.params.id); if (!l) return res.status(404).json({ error: 'That list is gone.' });
  if (l.source === 'ha' && !fam.demo) { try { await famHaDo(l.entity, 'clear'); } catch (e) { return res.status(502).json({ error: `Home Assistant: ${e.message}` }); } return (famChanged(), res.json({ ok: true })); }
  l.items = (l.items || []).filter((x) => !x.done); famChanged(); res.json({ ok: true });
});
/* chores */
app.post('/api/family/chores', requireRole('member'), express.json({ limit: '4kb' }), (req, res) => {
  try { if (fam.d.chores.length >= 120) throw new Error('That\'s a lot of chores - remove some first.'); const c = famCleanChore(req.body || {}); fam.d.chores.push(c); famChanged(); res.json({ ok: true, chore: c }); } catch (e) { famBad(res, e); }
});
app.put('/api/family/chores/:id', requireRole('member'), express.json({ limit: '4kb' }), (req, res) => {
  const i = fam.d.chores.findIndex((c) => c.id === req.params.id); if (i < 0) return res.status(404).json({ error: 'That chore is gone.' });
  try { fam.d.chores[i] = famCleanChore(req.body || {}, fam.d.chores[i]); } catch (e) { return famBad(res, e); }
  famChanged(); res.json({ ok: true, chore: fam.d.chores[i] });
});
app.delete('/api/family/chores/:id', requireRole('member'), (req, res) => { fam.d.chores = fam.d.chores.filter((c) => c.id !== req.params.id); famChanged(); res.json({ ok: true }); });
app.put('/api/family/order', requireRole('member'), express.json({ limit: '8kb' }), (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
  ids.forEach((id, k) => { const c = fam.d.chores.find((x) => x.id === id); if (c) c.order = k + 1; });
  famChanged(); res.json({ ok: true });
});
app.post('/api/family/chores/:id/done', requireRole('member'), express.json({ limit: '1kb' }), (req, res) => {
  const c = fam.d.chores.find((x) => x.id === req.params.id); if (!c) return res.status(404).json({ error: 'That chore is gone.' });
  const today = famToday(), b = req.body || {}, day = FAM_YMD.test(String(b.date || '')) ? String(b.date) : today;
  if (day > today || day < famAdd(today, -1)) return famBad(res, new Error('Only today or yesterday.'));
  const p = String(b.person || '*'); if (!famSlots(c).includes(p) || !famPersonOk(p)) return famBad(res, new Error('That chore is for someone else.'));
  const by = b.by && fam.d.people.some((x) => x.id === b.by) ? String(b.by) : null;
  fam.d.done = famMark(fam.d.done, c, p, day, b.done !== false, by, new Date().toISOString(), fam.d.weekStart || 0);
  famChanged(); res.json({ ok: true, stars: famStars(fam.d.done, today, fam.d.weekStart || 0) });
});
/* meals */
app.get('/api/family/meals', (req, res) => {
  const from = FAM_YMD.test(String(req.query.from || '')) ? String(req.query.from) : famWeekOf(famToday(), fam.d.weekStart || 0);
  const days = Array.from({ length: 7 }, (_, i) => famAdd(from, i));
  res.json({ from, days: days.map((d) => ({ date: d, ...(fam.d.meals[d] || {}) })), lastWeek: days.some((d) => fam.d.meals[famAdd(d, -7)]?.title) });
});
app.put('/api/family/meals/:date', requireRole('member'), express.json({ limit: '4kb' }), (req, res) => {
  const d = String(req.params.date); if (!FAM_YMD.test(d)) return famBad(res, new Error('Pick a day.'));
  const b = req.body || {}, title = famStr(b.title, 80), url = famUrl(b.url), note = famStr(b.note, 120);
  if (b.url && !url) return famBad(res, new Error('The recipe link should start with https://'));
  if (!title && !url && !note) delete fam.d.meals[d]; else fam.d.meals[d] = { title: title || 'Dinner', url, note };
  const keep = famAdd(famToday(), -60); for (const k of Object.keys(fam.d.meals)) if (k < keep) delete fam.d.meals[k];
  famChanged(); res.json({ ok: true, meal: fam.d.meals[d] || null });
});
app.post('/api/family/meals/copy', requireRole('member'), express.json({ limit: '1kb' }), (req, res) => {
  const to = String(req.body?.to || ''); if (!FAM_YMD.test(to)) return famBad(res, new Error('Pick a week.'));
  fam.d.meals = famCopyWeek(fam.d.meals, to); famChanged(); res.json({ ok: true });
});
/* status chips */
app.get('/api/family/chips', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!fam.d.chips.length) return res.json({ chips: [] });
  const [{ devices = [] } = {}, wx] = await Promise.all([houseDevices().catch(() => ({ devices: [] })), fam.d.chips.some((c) => c.kind === 'outside') ? (isDemo() ? famOutside(demoFixture('home')?.weather) : config.location ? weatherNow().catch(() => null) : null) : null]);
  res.json({ chips: famChipsOf(fam.d.chips, devices, wx) });
});
/* The demo's Home: its sample weather, with the demo's outdoor sensor in place of the forecast's "now" (the real
   Home gets this through weatherNow). Runs before 90-demo.js answers from its fixture. */
app.get('/api/home', (req, res, next) => {
  if (!isDemo()) return next();
  const send = res.json.bind(res);
  res.json = (j) => { if (j?.weather?.now) famOutside(j.weather).then((w) => send({ ...j, weather: w })).catch(() => send(j)); else send(j); return res; };
  next();
});

if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchFamily = { famDueOn, famSlots, famDoneRec, famChoresOn, famStars, famStarsBetween, famMark, famWeekOf, famCopyWeek, famTodoCmd, famTodoFromHa, famHaWs, famRainOf, famApplyOutside, famChipsOf, famCleanChore, famCleanChip, famCleanRule, famUrl, fam };
