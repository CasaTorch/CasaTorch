/* ======================================================================
 * Household: the small chores a home keeps for you.
 *  - Bins: trash, recycling, organics, paper, glass, yard waste. Each has a pickup schedule (every week on a day,
 *    every 2 weeks from a date, or a monthly pattern), or comes from Home Assistant (a waste-collection sensor
 *    with the next date) or from the city's calendar link. A holiday can skip or move one pickup, or slide the
 *    rest of that week a day later. The evening before (7 PM unless you pick another time) a reminder goes up
 *    on every screen - "Take out the recycling tonight" - until someone taps "Done - it's out".
 *  - Mail: a mailbox sensor in Home Assistant (door, flap, contact or vibration). The first opening means post
 *    arrived; the next one (or a tap) means it was collected.
 *  - Plants: Home Assistant plant cards or soil-moisture sensors, with a "thirsty below" level.
 *  - Laundry & dishes: the washer, dryer and dishwasher - from a time-left sensor, a status sensor, or a smart
 *    plug's power (running above a few watts, done after it has stayed below for some minutes).
 * Reminders go up through the Reminders system (78-nudges.js: /api/nudges/active, Done, 10 more minutes) and,
 * with Pro and when chosen, to phones. Dates are the house's own (its time zone), never this computer's.
 *
 * Kept in DATA_DIR/household.json (the city calendar link sealed, like every other secret).
 *   GET  /api/household            what the screens (and the 3D home) show - see hhView()
 *   GET  /api/household/setup      the settings, what Home Assistant has that looks right, and its entities
 *   PUT  /api/household/setup      change them (members and up)
 *   POST /api/household/ical       read a city calendar link: which bins it has
 *   POST /api/household/bins/:id/out, /mail/collected, /plants/watered, /laundry/:id/emptied
 * ====================================================================== */
const HH_FILE = path.join(DATA_DIR, 'household.json');
const HH_BIN_ICONS = ['trash', 'recycling', 'organics', 'paper', 'glass', 'yard'];
const HH_COLORS = ['#6b7280', '#1f2937', '#2563eb', '#0891b2', '#16a34a', '#65a30d', '#eab308', '#ea580c', '#92400e', '#dc2626', '#7c3aed'];
const HH_REPEAT = ['weekly', 'biweekly', 'every4', 'monthly'];
const HH_KINDS = ['washer', 'dryer', 'dishwasher'];
const HH_MAIL_GRACE = 2 * 60_000;   // a delivery can rattle the box for a minute or two: that's still the one delivery
const HH_SHOW_MIN = 60;             // a reminder stays up on the screens an hour unless someone answers it
const hhDefaults = () => ({ bins: [], changes: [], ical: null, remind: { time: '19:00', flash: true, push: false }, mail: { entity: null, reset: 'door', remind: true, push: false },
  plants: { list: [], threshold: 20, time: '09:00', remind: true }, apps: [], appsRemind: true, appsPush: false });
const hh = { cfg: hhDefaults(), st: { bins: {}, mail: {}, apps: {}, plants: {}, fired: {}, active: [] }, ext: {}, extAt: 0, demo: false };
(function hhLoad() {
  try {
    const d = JSON.parse(fs.readFileSync(HH_FILE, 'utf8'));
    hh.cfg = { ...hhDefaults(), ...(d.cfg || {}) };
    for (const k of ['remind', 'mail', 'plants']) hh.cfg[k] = { ...hhDefaults()[k], ...(d.cfg?.[k] || {}) };
    hh.st = { ...hh.st, ...(d.st || {}) };
  } catch { /* first run */ }
})();
let hhSaveT = null;
const hhSave = (now = false) => {
  if (hh.demo) return;
  clearTimeout(hhSaveT);
  const go = () => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileSafe(HH_FILE, JSON.stringify({ cfg: hh.cfg, st: hh.st }, null, 1), 0o600); } catch (e) { console.warn('household: could not save', e.message); } };
  if (now) go(); else hhSaveT = setTimeout(go, 1500);
};

/* ---- dates: plain "YYYY-MM-DD" days, counted in UTC so a daylight-saving change never moves a pickup ---- */
const HH_YMD = /^\d{4}-\d{2}-\d{2}$/;
const hhPad = (n) => String(n).padStart(2, '0');
const ymdMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const ymdAdd = (s, n) => ymdOf(ymdMs(s) + n * 86400_000);
const ymdDiff = (a, b) => Math.round((ymdMs(b) - ymdMs(a)) / 86400_000);
const ymdDow = (s) => new Date(ymdMs(s)).getUTCDay();
/* The house's date, time and weekday at that moment, in its own time zone. */
function hhLocal(ms, tz) {
  let p;
  try { p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); }
  catch { return hhLocal(ms, 'UTC'); }
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, dow: ymdDow(date) };
}
/* That day and time in the house, as a moment (for "the reminder is at 7 PM the evening before"). */
const hhAt = (ymd, hm, tz) => zonedToUtc(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5), 0, tz);

/* A bin's regular pickups from..to (both days included), before any holiday changes. */
function hhRawDates(bin, from, to) {
  const out = [];
  if (bin.repeat === 'monthly') {
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    for (let i = 0; i < 16; i++) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      let day = null;
      if (bin.mday) day = Math.min(bin.mday, last);
      else {
        const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), dow = bin.dow ?? 1;
        if (bin.nth === -1) { const lastDow = new Date(Date.UTC(y, m - 1, last)).getUTCDay(); day = last - ((lastDow - dow + 7) % 7); }
        else { day = 1 + ((dow - firstDow + 7) % 7) + ((bin.nth || 1) - 1) * 7; if (day > last) day = null; }
      }
      const d = day ? `${y}-${hhPad(m)}-${hhPad(day)}` : null;
      if (d && d > to) break;
      if (d && d >= from && (!bin.start || d >= bin.start)) out.push(d);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  const weeks = bin.repeat === 'biweekly' ? 2 : bin.repeat === 'every4' ? 4 : 1, dow = bin.dow ?? 1;
  let d = ymdAdd(from, (dow - ymdDow(from) + 7) % 7);
  if (weeks > 1 && bin.start) { const span = 7 * weeks, k = ((ymdDiff(bin.start, d) % span) + span) % span; if (k) d = ymdAdd(d, span - k); }
  for (; d <= to; d = ymdAdd(d, 7 * weeks)) if (!bin.start || d >= bin.start) out.push(d);
  return out;
}
/* Holiday changes: one pickup skipped or moved (for one bin or all), or a holiday week - that day and the rest
   of its week (to Saturday) a day later, as most cities do. */
function hhApplyChanges(dates, bin, changes = [], holidays = true) {
  const out = new Map();
  for (const d of dates) {
    let x = d;
    const one = changes.find((c) => c.date === d && (!c.bin || c.bin === bin.id));
    if (one) { if (!one.to) continue; x = one.to; }
    else if (holidays) { const h = changes.find((c) => c.holiday && d >= c.holiday && ymdDiff(c.holiday, d) <= 6 - ymdDow(c.holiday)); if (h) x = ymdAdd(d, h.days || 1); }
    if (!out.has(x)) out.set(x, x === d ? null : d);
  }
  return [...out].sort((a, b) => a[0].localeCompare(b[0])).map(([date, from]) => ({ date, from }));
}
/* The next pickups from today: [{ date, from (the regular day, when this one moved) }]. */
function hhBinDates(bin, today, changes = [], ext = null) {
  if (bin.source === 'schedule' || !bin.source) return hhApplyChanges(hhRawDates(bin, ymdAdd(today, -7), ymdAdd(today, 120)), bin, changes).filter((x) => x.date >= today).slice(0, 8);
  return hhApplyChanges((ext?.dates || []).filter((d) => d >= ymdAdd(today, -1)), bin, changes, false).filter((x) => x.date >= today).slice(0, 8);   // the city already moves its own holidays
}
/* When to put it out: the pickup is today, tomorrow (out tonight), the day after (out tomorrow night), or later. */
const hhBinState = (days) => (days == null ? 'none' : days <= 0 ? 'today' : days === 1 ? 'tonight' : days === 2 ? 'tomorrow' : 'later');

/* ---- reading Home Assistant ---- */
const HH_ON = /^(on|open|opened|detected|true|wet|active|motion|vibration|1)$/i, HH_OFF = /^(off|closed|clear|false|dry|inactive|idle|0)$/i;
const HH_IDLE = /^(off|idle|stop|stopped|standby|ready|finish|finished|end|ended|complete|completed|done|none|power_?off|inactive|fertig|aus|bereit|false|0|-|)$/i;
const HH_GONE = /^(unavailable|unknown)$/i;
const hhName = (s) => String(s?.attributes?.friendly_name || String(s?.entity_id || '').split('.')[1]?.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || '').slice(0, 60);
const hhNum = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
/* A date written any of the ways waste-collection sensors write them: 2026-10-20, 2026-10-20T06:00:00+02:00,
   20.10.2026, 2026/10/20, "Tue, Oct 20 2026". Gives the day in the house's time zone (or null). */
function hhDateOf(v, tz) {
  const s = String(v ?? '').trim(); if (!s || s.length > 60) return null;
  let m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); if (m) return `${m[3]}-${hhPad(m[2])}-${hhPad(m[1])}`;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) || (/[a-z]{3}/i.test(s) && /\b\d{4}\b/.test(s))) {
    const local = s.match(/^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/);   // no zone given: it's already the house's time
    if (local) return local[1];
    const t = Date.parse(s); if (Number.isFinite(t)) return hhLocal(t, tz).date;
  }
  return null;
}
/* Every upcoming day a waste sensor knows about. Lenient on purpose: the state may be a date, "in 3 days",
   "Tomorrow" or a number of days; the attributes may hold dates as values ("next_date": ...) or as keys
   (waste_collection_schedule's "upcoming" list: {"20.10.2026": "Recycling"}). With `match`, only the dates
   whose label has that word (one sensor for several bins). */
function hhWasteDates(s, today, tz, match = '') {
  if (!s) return [];
  const found = [], want = String(match || '').trim().toLowerCase(), a = s.attributes || {};
  const add = (d, label = '') => { if (d && d >= today && (!want || String(label).toLowerCase().includes(want))) found.push(d); };
  const rel = (v) => {
    const t = String(v ?? '').trim().toLowerCase();
    if (/^(today|heute|aujourd'hui|hoy|oggi|vandaag|hoje|idag|dzisiaj|bugün)$/.test(t)) return today;
    if (/^(tomorrow|morgen|demain|mañana|domani|amanhã|imorgon|jutro|yarın)$/.test(t)) return ymdAdd(today, 1);
    const n = t.match(/^(?:in\s+)?(\d{1,3})\s*(?:days?|tage?n?|jours?|días?|giorni|dagen?|dias?|dni)?$/);
    return n ? ymdAdd(today, Number(n[1])) : null;
  };
  const label = `${hhName(s)} ${s.entity_id}`;
  const own = s.entity_id.startsWith('calendar.') ? null : hhDateOf(s.state, tz) || (a.unit_of_measurement && !/^days?$/i.test(a.unit_of_measurement) ? null : rel(s.state));
  for (const [k, v] of Object.entries(a)) {
    if (['friendly_name', 'icon', 'unit_of_measurement', 'device_class', 'attribution', 'entity_picture', 'last_reset'].includes(k)) continue;
    if (Array.isArray(v)) { for (const x of v.slice(0, 40)) { if (x && typeof x === 'object') add(hhDateOf(x.date || x.start || x.start_time, tz), `${x.type || x.types || x.summary || x.message || ''}`); else add(hhDateOf(x, tz), want ? '' : k); } continue; }
    if (v && typeof v === 'object') continue;
    const kd = hhDateOf(k, tz);
    if (kd) { add(kd, String(v)); continue; }   // {"20.10.2026": "Recycling"}
    if (/^(days_?to|daysto|days|days_until|days_left)$/i.test(k) && hhNum(v) != null) { add(ymdAdd(today, Math.round(hhNum(v))), want ? label : ''); continue; }
    const vd = hhDateOf(v, tz) || (typeof v === 'string' && /^(next|date|pickup|collection|start)/i.test(k) ? rel(v) : null);
    if (vd) add(vd, /^(next_?date|date|start_?time|next_?pickup|next_?collection|collection_?date|pickup_?date|next|start)$/i.test(k) ? (want ? `${label} ${a.message || a.types || ''}` : '') : k);   // {"Recycling": "2026-10-20"} or {"next_date": ...}
  }
  if (own) add(own, want ? `${label} ${a.types || ''}` : '');
  if (s.entity_id.startsWith('calendar.') && a.start_time) add(hhDateOf(a.start_time, tz), want ? `${a.message || ''} ${label}` : '');
  return [...new Set(found)].sort().slice(0, 12);
}
/* Minutes left, from a "time left" sensor: 23 (min), 1.5 (h), 1380 (s), "0:23:00", or the finish time itself. */
function hhMinutes(s, now) {
  if (!s || HH_GONE.test(s.state)) return null;
  const v = String(s.state).trim(), a = s.attributes || {}, unit = String(a.unit_of_measurement || '').toLowerCase();
  if (a.device_class === 'timestamp' || /^\d{4}-\d{2}-\d{2}T/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? Math.max(0, Math.round((t - now) / 60_000)) : null; }
  const hms = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/); if (hms) return Number(hms[1]) * 60 + Number(hms[2]) + (hms[3] ? Math.round(Number(hms[3]) / 60) : 0);
  const n = hhNum(v); if (n == null) return null;
  return Math.max(0, Math.round(/^h/.test(unit) ? n * 60 : /^s/.test(unit) ? n / 60 : n));
}
const hhWatts = (s) => { if (!s || HH_GONE.test(s.state)) return null; const n = hhNum(s.state); if (n == null) return null; const u = String(s.attributes?.unit_of_measurement || ''); return u === 'kW' ? n * 1000 : n; };

/* One look at an appliance. st: { phase 'idle'|'running'|'done', since, doneAt, aboveSince, belowSince }.
   r: { power (W), text (its status), remainingMin }. Returns 'started' | 'done' | null. */
function hhAppStep(st, app, r, now) {
  const was = st.phase || 'idle';
  let running = null;
  if (app.mode === 'power') {
    if (r.power == null) return null;
    const onW = app.onW || 8, offMs = (app.offMin || 5) * 60_000;
    if (r.power > onW) {
      st.belowSince = null;
      if (was !== 'running') { st.aboveSince ||= now; if (now - st.aboveSince >= 60_000) running = true; }   // a minute above: it really started (not a blip)
    } else {
      st.aboveSince = null;
      if (was === 'running') { st.belowSince ||= now; if (now - st.belowSince >= offMs) running = false; }   // pauses mid-cycle (soaking, the dryer's cool-down) don't count as done
    }
  } else if (app.mode === 'state') {
    if (r.text == null || HH_GONE.test(r.text)) return null;
    running = !HH_IDLE.test(String(r.text).trim());
  } else {
    if (r.remainingMin == null) { if (was === 'running') running = false; else return null; }
    else running = r.remainingMin > 0;
  }
  if (running === true && was !== 'running') { st.phase = 'running'; st.since = new Date(st.aboveSince || now).toISOString(); st.doneAt = null; st.aboveSince = null; return 'started'; }
  if (running === false && was === 'running') { st.phase = 'done'; st.doneAt = new Date(app.mode === 'power' && st.belowSince ? st.belowSince : now).toISOString(); st.belowSince = null; return 'done'; }
  if (was === 'done' && st.doneAt && now - Date.parse(st.doneAt) > 12 * 3600_000) { st.phase = 'idle'; return null; }   // half a day later it isn't news any more
  return null;
}
/* One look at the mailbox. st: { state 'post'|'empty', at, collectedAt, seenAt, seenState }.
   s: the Home Assistant state. Returns 'arrived' | 'collected' | null. */
function hhMailStep(st, cfg, s, now) {
  if (!s || HH_GONE.test(String(s.state))) return null;
  const changed = Date.parse(s.last_changed || '') || now, v = String(s.state);
  if (!HH_ON.test(v) && !HH_OFF.test(v)) {   // a sensor that says what's in the box ("Post", "Empty")
    const full = /mail|post|letter|deliver|arriv|full|yes|present|brief|courrier|correo/i.test(v) && !/no.?(mail|post)|empty|none|leer|vide|vac[ií]o/i.test(v);
    if (full && st.state !== 'post') { st.state = 'post'; st.at = new Date(changed).toISOString(); return 'arrived'; }
    if (!full && st.state === 'post') { st.state = 'empty'; st.collectedAt = new Date(changed).toISOString(); return 'collected'; }
    return null;
  }
  if (st.seenAt == null) { st.seenAt = changed; st.seenState = v; st.state ||= 'empty'; return null; }   // the first look is how things are, not news
  if (changed <= st.seenAt) return null;
  const wasOn = HH_ON.test(st.seenState || ''), isOn = HH_ON.test(v);
  st.seenAt = changed; st.seenState = v;
  if (!isOn && wasOn) return null;   // closing again
  // opened now - or it opened and closed between two looks (a vibration sensor's few seconds)
  if (st.state !== 'post') { st.state = 'post'; st.at = new Date(changed).toISOString(); return 'arrived'; }
  if (cfg.reset !== 'tap' && changed - Date.parse(st.at || 0) >= HH_MAIL_GRACE) { st.state = 'empty'; st.collectedAt = new Date(changed).toISOString(); return 'collected'; }
  return null;
}
/* A plant: { moisture %, thirsty }. Plant cards say "problem" with what's wrong; moisture sensors give a %. */
function hhPlantOf(s, min) {
  if (!s) return { moisture: null, thirsty: false, gone: true };
  const a = s.attributes || {};
  let moisture = s.entity_id.startsWith('plant.') ? hhNum(a.moisture) : hhNum(s.state);
  if (moisture == null && s.entity_id.startsWith('plant.')) for (const [k, v] of Object.entries(a)) if (/moisture/i.test(k) && hhNum(v) != null) { moisture = hhNum(v); break; }
  const low = s.entity_id.startsWith('plant.') && ((s.state === 'problem' && /moist/i.test(String(a.problem || ''))) || Object.entries(a).some(([k, v]) => /moisture_?status/i.test(k) && /low/i.test(String(v))));
  return { moisture: moisture == null ? null : Math.round(moisture), thirsty: moisture != null ? moisture < min : low, gone: HH_GONE.test(String(s.state)) && moisture == null };
}

/* ---- what Home Assistant has that looks like bins, a mailbox, plants and appliances ---- */
const HH_WASTE_RE = /waste|trash|garbage|rubbish|refuse|recycl|compost|organic|yard|glass|paper|cardboard|(^|[^a-z])bins?([^a-z]|$)|collection|pickup|abfall|m[üu]ll|tonne|wertstoff|gelbe|papier|poubelle|d[ée]chet|basura|residuos|rifiuti|afval|kliko|avfall|sopor|odpady|[çc][öo]p/i;
const HH_MAIL_RE = /mail|letter|briefkasten|brievenbus|post_?box|postkasten|bo[iî]te.?aux.?lettres|buz[oó]n|cassetta|skrzynk|brevl[aå]d|posta.?kutusu/i, HH_NOT_MAIL = /e-?mail|imap|gmail|inbox|outlook/i;
const HH_KIND_RE = { washer: /wash(er|ing)?(?!.*dish)|lavadora|waschmaschine|lave.?linge|lavatrice|wasmachine|pralk|tv[aä]ttmaskin|[çc]ama[şs][ıi]r/i, dryer: /dryer|tumble|trockner|secadora|s[eè]che.?linge|asciugatrice|droger|suszark|torktumlare|kurutma/i, dishwasher: /dish|geschirr|lavavajillas|lave.?vaisselle|lavastoviglie|vaatwas|zmywark|diskmaskin|bula[şs][ıi]k/i };
function hhGuessBin(name) {
  const s = String(name || '').toLowerCase();
  if (/recycl|wertstoff|gelb|yellow|plastic|plastik|pmd|recyclage|reciclaje|riciclo|blue/.test(s)) return { icon: 'recycling', color: /gelb|yellow|pmd/.test(s) ? '#eab308' : '#2563eb' };
  if (/organic|compost|food|bio|kitchen|green.?waste|gft|organique|org[aá]nico|umido/.test(s)) return { icon: 'organics', color: '#92400e' };
  if (/paper|cardboard|papier|papel|carta|karton|pap/.test(s)) return { icon: 'paper', color: '#0891b2' };
  if (/glass|glas|verre|vidrio|vetro|cam/.test(s)) return { icon: 'glass', color: '#16a34a' };
  if (/yard|garden|leaf|leaves|grass|brush|tree|garten|jardin|jard[ií]n|verde/.test(s)) return { icon: 'yard', color: '#65a30d' };
  return { icon: 'trash', color: '#6b7280' };
}
function hhSuggest(states, today, tz) {
  const out = { bins: [], mail: [], plants: [], apps: [] };
  for (const s of states) {
    const id = String(s.entity_id || ''), [dom] = id.split('.'), a = s.attributes || {}, name = hhName(s), text = `${id} ${name}`;
    if (['sensor', 'calendar'].includes(dom) && HH_WASTE_RE.test(text) && !/power|energy|kwh/i.test(text)) {
      const dates = hhWasteDates(s, today, tz);
      if (dates.length) out.bins.push({ entity: id, name: name.replace(/\b(next|pickup|collection|schedule|sensor)\b/gi, '').replace(/\s{2,}/g, ' ').trim() || name, next: dates[0], ...hhGuessBin(text) });
    }
    if (['binary_sensor', 'sensor', 'input_boolean'].includes(dom) && HH_MAIL_RE.test(text) && !HH_NOT_MAIL.test(text) && !/battery|signal|linkquality|temperature|voltage|rssi/i.test(text)) out.mail.push({ entity: id, name, state: String(s.state).slice(0, 30), cls: a.device_class || null });
    if (dom === 'plant' || (dom === 'sensor' && a.unit_of_measurement === '%' && (a.device_class === 'moisture' || (/soil|moisture|plant|feucht|humidit[ée] du sol/i.test(text) && a.device_class !== 'humidity')))) out.plants.push({ entity: id, name: name.replace(/\b(soil )?moisture\b/i, '').trim() || name, moisture: hhPlantOf(s, 0).moisture });
  }
  for (const kind of HH_KINDS) {
    const mine = states.filter((s) => { const t = `${s.entity_id} ${hhName(s)}`; return /^(sensor|binary_sensor|switch)\./.test(s.entity_id) && HH_KIND_RE[kind].test(t) && (kind !== 'washer' || !HH_KIND_RE.dishwasher.test(t)) && !/battery|signal|rssi|wifi|energy|kwh|voltage|current|temperature|door|lock/i.test(t); });
    if (!mine.length) continue;
    const power = mine.find((s) => s.entity_id.startsWith('sensor.') && (s.attributes?.device_class === 'power' || /^k?W$/.test(s.attributes?.unit_of_measurement || '')));
    const remaining = mine.find((s) => s.entity_id.startsWith('sensor.') && (/^(min|h|s)$/.test(s.attributes?.unit_of_measurement || '') || s.attributes?.device_class === 'duration' || (s.attributes?.device_class === 'timestamp' && /finish|complet|end|done|remain/i.test(s.entity_id))));
    const status = mine.find((s) => s !== power && s !== remaining && (s.entity_id.startsWith('binary_sensor.') ? /run|operat|activ/i.test(s.entity_id) : hhNum(s.state) == null && !HH_GONE.test(s.state) && /state|status|job|operation|machine|program|phase|run|cycle/i.test(s.entity_id) && s.attributes?.device_class !== 'timestamp'));
    const main = power || status || remaining; if (!main) continue;
    const label = { washer: 'Washer', dryer: 'Dryer', dishwasher: 'Dishwasher' }[kind];
    out.apps.push({ kind, name: label, entity: main.entity_id, mode: main === power ? 'power' : main === status ? 'state' : 'remaining', remaining: remaining && remaining !== main ? remaining.entity_id : null, entityName: hhName(main) });
  }
  out.mail.sort((x, y) => (['door', 'opening', 'vibration'].includes(y.cls) ? 1 : 0) - (['door', 'opening', 'vibration'].includes(x.cls) ? 1 : 0));
  out.bins = out.bins.slice(0, 12); out.mail = out.mail.slice(0, 8); out.plants = out.plants.slice(0, 40);
  return out;
}

/* ---- the city's calendar link ---- */
async function hhIcalEvents(url) {
  const u = String(url || '').replace(/^webcal:/i, 'https:');
  return cached(`hh-ics:${u}`, 6 * 3600_000, async () => ({ events: parseIcs((await getText(u, { timeout: 15_000 })).text, houseTz()) }));
}
const hhIcalDay = (e, tz) => (e.allDay ? String(e.start).slice(0, 10) : hhLocal(Date.parse(e.start), tz).date);
/* The bins a city calendar has: one per kind of pickup ("Recycling", "Yard waste"), with the next date. */
function hhIcalKinds(occ, tz) {
  const by = new Map();
  for (const e of occ) {
    for (const part of String(e.title || '').split(/\s*(?:,|&|\/|\+|\band\b|\bund\b|\bet\b|\by\b)\s*/i).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 40)) {
      const k = part.toLowerCase(); if (!by.has(k)) by.set(k, { title: part, dates: [] });
      by.get(k).dates.push(hhIcalDay(e, tz));
    }
  }
  return [...by.values()].map((x) => ({ title: x.title, count: x.dates.length, next: x.dates.sort()[0], ...hhGuessBin(x.title) })).sort((a, b) => b.count - a.count).slice(0, 10);
}
/* Bins from Home Assistant and the calendar link: looked up every few minutes, not on every screen's question. */
async function hhRefreshExt(force = false) {
  if (hh.demo || (!force && Date.now() - hh.extAt < 5 * 60_000)) return;
  hh.extAt = Date.now();
  const tz = houseTz(), today = hhLocal(Date.now(), tz).date, ext = {};
  const haBins = hh.cfg.bins.filter((b) => b.source === 'ha'), icalBins = hh.cfg.bins.filter((b) => b.source === 'ical');
  if (haBins.length) {
    const states = await haStates().catch(() => null), byId = new Map((states || []).map((s) => [s.entity_id, s]));
    for (const b of haBins) { const s = byId.get(b.entity); ext[b.id] = s ? { dates: hhWasteDates(s, today, tz, b.match) } : { dates: hh.ext[b.id]?.dates || [], error: states ? 'That Home Assistant sensor is gone.' : 'Home Assistant isn\'t answering.' }; }
  }
  if (icalBins.length) {
    const url = hh.cfg.ical ? unseal(hh.cfg.ical) : null;
    try {
      if (!url) throw new Error('Add the calendar link first.');
      const occ = expandEvents((await hhIcalEvents(url)).events, Date.now() - 86400_000, Date.now() + 120 * 86400_000, tz);
      for (const b of icalBins) { const m = String(b.match || b.name).toLowerCase(); ext[b.id] = { dates: [...new Set(occ.filter((e) => String(e.title || '').toLowerCase().includes(m)).map((e) => hhIcalDay(e, tz)))].sort() }; }
    } catch (e) { for (const b of icalBins) ext[b.id] = { dates: hh.ext[b.id]?.dates || [], error: String(e.message || e).slice(0, 120) }; }
  }
  hh.ext = ext;
}

/* ---- reminders, through the Reminders system ---- */
function hhRemind(id, item, push) {
  const now = Date.now();
  hh.st.active = hh.st.active.filter((a) => a.id !== id);
  hh.st.active.push({ id, at: new Date(now).toISOString(), until: new Date(now + HH_SHOW_MIN * 60_000).toISOString(), ...item });
  if (push && proStatus().pro && typeof nudgePush === 'function') nudgePush({ id, title: item.title, time: hhLocal(now, houseTz()).time, sound: item.sound || 'chime' }).catch(() => {});
  hhChanged();
}
const hhClear = (id) => { const n = hh.st.active.length; hh.st.active = hh.st.active.filter((a) => a.id !== id && !a.id.startsWith(`${id}:`)); if (n !== hh.st.active.length) hhChanged(); };
function hhChanged() { hhSave(); if (typeof liveNudge === 'function') liveNudge(); }
/* What /api/nudges/active adds to the screens (78-nudges.js asks). */
function hhActive() {
  const now = Date.now();
  return hh.st.active.filter((a) => Date.parse(a.until) > now && (!a.snoozeUntil || Date.parse(a.snoozeUntil) < now) && a.flash !== false)
    .map((a) => ({ at: a.at, id: a.id, title: a.title, msg: a.msg || null, vars: a.vars || null, icon: a.icon, color: a.color || null, doneLabel: a.doneLabel || null, sound: a.sound || 'chime', photo: false, time: a.time, repeat: 'once', days: [], date: null, flash: true, push: !!a.push, on: true, lastFired: a.at, household: true }));
}
/* Done or 10 more minutes on a household reminder (78-nudges.js asks first). True when it was one of ours. */
function hhAnswer(id, how) {
  if (!/^hh-/.test(String(id))) return false;
  const a = hh.st.active.find((x) => x.id === id);
  if (how === 'snooze') { if (a) { a.snoozeUntil = new Date(Date.now() + 10 * 60_000).toISOString(); a.until = new Date(Math.max(Date.parse(a.until), Date.now() + 20 * 60_000)).toISOString(); hhChanged(); } return true; }
  const [, kind, key] = String(id).match(/^hh-([a-z]+)-?(.*)$/) || [];
  if (kind === 'bin') hhBinOut(key.split(':')[0], true);
  else if (kind === 'mail') hhMailCollected();
  else if (kind === 'plants') hhWatered();
  else if (kind === 'app') hhEmptied(key);
  hhClear(id); return true;
}
function hhBinOut(binId, out) {
  const b = hh.cfg.bins.find((x) => x.id === binId); if (!b) return false;
  const next = hhBinDates(b, hhLocal(Date.now(), houseTz()).date, hh.cfg.changes, hh.ext[b.id])[0]?.date;
  hh.st.bins[b.id] = out && next ? { outFor: next, at: nowIso() } : {};
  if (out) hhClear(`hh-bin-${b.id}`);
  hhChanged(); return true;
}
function hhMailCollected() { hh.st.mail = { ...hh.st.mail, state: 'empty', collectedAt: nowIso() }; hhClear('hh-mail'); hhChanged(); }
function hhWatered() { const d = hhLocal(Date.now(), houseTz()).date; for (const p of hh.cfg.plants.list) hh.st.plants[p.entity] = { wateredOn: d }; hhClear('hh-plants'); hhChanged(); }
function hhEmptied(appId) { const s = hh.st.apps[appId]; if (s) { s.phase = 'idle'; s.doneAt = null; } hhClear(`hh-app-${appId}`); hhChanged(); }
const hhLower = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/* Every 10 seconds: read the sensors, notice changes, and put reminders up at their time. */
async function hhTick() {
  if (hh.demo || !isConfigured()) return;
  const tz = houseTz(), now = Date.now(), L = hhLocal(now, tz), c = hh.cfg;
  hhRefreshExt().catch(() => {});
  let dirty = false;
  // bins: the evening before, at the reminder time (once per pickup - and not if it's already out)
  for (const b of c.bins) {
    const next = hhBinDates(b, L.date, c.changes, hh.ext[b.id])[0]?.date; if (!next || ymdDiff(L.date, next) !== 1 || L.time < (c.remind.time || '19:00')) continue;
    const key = `bin:${b.id}:${next}`;
    if (hh.st.fired[key] || hh.st.bins[b.id]?.outFor === next) continue;
    hh.st.fired[key] = now; dirty = true;
    hhRemind(`hh-bin-${b.id}`, { kind: 'bin', title: `Take out the ${hhLower(b.name)} tonight`, msg: 'Take out the {bin} tonight', vars: { bin: hhLower(b.name) }, icon: b.icon, color: b.color, doneLabel: 'Done - it\'s out', time: c.remind.time, flash: c.remind.flash !== false, push: !!c.remind.push }, !!c.remind.push);
  }
  const needHa = c.mail.entity || c.plants.list.length || c.apps.length;
  const states = needHa && config.homeAssistant?.url ? await haStates().catch(() => null) : null;
  if (states) {
    const byId = new Map(states.map((s) => [s.entity_id, s]));
    if (c.mail.entity) {
      hh.st.mail ||= {};
      const ev = hhMailStep(hh.st.mail, c.mail, byId.get(c.mail.entity), now);
      if (ev) dirty = true;
      if (ev === 'arrived' && c.mail.remind !== false) hhRemind('hh-mail', { kind: 'mail', title: 'The mail is here', msg: 'The mail is here', icon: 'mailbox', color: '#2563eb', doneLabel: 'Got it', time: L.time, flash: true, push: !!c.mail.push }, !!c.mail.push);
      if (ev === 'collected') hhClear('hh-mail');
    }
    for (const app of c.apps) {
      const st = (hh.st.apps[app.id] ||= { phase: 'idle' }), main = byId.get(app.entity), rem = app.remaining ? byId.get(app.remaining) : app.mode === 'remaining' ? main : null;
      const before = JSON.stringify(st);
      const ev = hhAppStep(st, app, { power: app.mode === 'power' ? hhWatts(main) : null, text: app.mode === 'state' ? (main ? String(main.state) : null) : null, remainingMin: hhMinutes(rem, now) }, now);
      st.remainingMin = st.phase === 'running' ? hhMinutes(rem, now) : null;
      if (JSON.stringify(st) !== before) dirty = true;
      if (ev === 'started') hhClear(`hh-app-${app.id}`);
      if (ev === 'done' && c.appsRemind !== false) hhRemind(`hh-app-${app.id}`, { kind: 'app', title: `The ${hhLower(app.name)} is done - time to empty it`, msg: 'The {app} is done - time to empty it', vars: { app: hhLower(app.name) }, icon: app.kind, color: '#0891b2', doneLabel: 'Emptied', time: L.time, flash: true, push: !!c.appsPush }, !!c.appsPush);
    }
    // plants: once a day at their time, when any is thirsty (and nobody watered them today)
    if (c.plants.list.length && c.plants.remind !== false && L.time >= (c.plants.time || '09:00') && !hh.st.fired[`plants:${L.date}`]) {
      const thirsty = c.plants.list.filter((p) => hhPlantOf(byId.get(p.entity), p.min || c.plants.threshold || 20).thirsty && hh.st.plants[p.entity]?.wateredOn !== L.date);
      if (thirsty.length) {
        hh.st.fired[`plants:${L.date}`] = now; dirty = true;
        const names = thirsty.slice(0, 3).map((p) => p.name).join(', ') + (thirsty.length > 3 ? ` +${thirsty.length - 3}` : '');
        hhRemind('hh-plants', { kind: 'plants', title: `Water the plants: ${names}`, msg: 'Water the plants: {names}', vars: { names }, icon: 'plant', color: '#16a34a', doneLabel: 'Watered', time: L.time, flash: true, push: false }, false);
      }
    }
  }
  const n = hh.st.active.length; hh.st.active = hh.st.active.filter((a) => Date.parse(a.until) > now); if (n !== hh.st.active.length) { dirty = true; if (typeof liveNudge === 'function') liveNudge(); }
  for (const [k, t] of Object.entries(hh.st.fired)) if (now - t > 40 * 86400_000) { delete hh.st.fired[k]; dirty = true; }
  if (dirty) hhSave();
}
setInterval(() => { hhTick().catch((e) => console.warn('household:', e.message)); }, 10_000).unref?.();

/* ---- what the screens and the 3D home get ---- */
function hhView() {
  const tz = houseTz(), now = Date.now(), L = hhLocal(now, tz);
  if (hh.demo && hhDemoMem.day !== L.date) { hhDemoSetup(); hhDemoMem.day = L.date; }   // the demo's week moves with the calendar
  const c = hh.cfg, rt = c.remind.time || '19:00';
  const st = hh.demo ? hhDemoState(now) : hh.st;
  const bins = c.bins.map((b) => {
    const dates = hhBinDates(b, L.date, c.changes, hh.ext[b.id]), next = dates[0] || null, days = next ? ymdDiff(L.date, next.date) : null;
    return { id: b.id, name: b.name, icon: b.icon, color: b.color, source: b.source || 'schedule', next: next?.date || null, movedFrom: next?.from || null, days, state: hhBinState(days), out: !!next && st.bins[b.id]?.outFor === next.date,
      remindAt: next && days >= 1 ? new Date(hhAt(ymdAdd(next.date, -1), rt, tz)).toISOString() : null, upcoming: dates.slice(0, 4).map((x) => x.date), error: hh.ext[b.id]?.error || null };
  }).sort((a, b) => (a.next || '9999').localeCompare(b.next || '9999'));
  const mail = c.mail.entity ? { state: st.mail?.state === 'post' ? 'post' : 'empty', at: st.mail?.state === 'post' ? st.mail.at || null : null, collectedAt: st.mail?.collectedAt || null, entity: c.mail.entity } : null;
  const byId = hh.demo ? hhDemoStates(now) : hhLastStates;
  const plants = c.plants.list.map((p) => { const v = hhPlantOf(byId.get(p.entity), p.min || c.plants.threshold || 20); return { id: p.entity, name: p.name, moisture: v.moisture, min: p.min || c.plants.threshold || 20, thirsty: v.thirsty, watered: st.plants[p.entity]?.wateredOn === L.date, offline: !!v.gone }; })
    .sort((a, b) => Number(b.thirsty) - Number(a.thirsty) || (a.moisture ?? 100) - (b.moisture ?? 100));
  const laundry = c.apps.map((a) => { const s = st.apps[a.id] || {}; return { id: a.id, name: a.name, kind: a.kind, phase: s.phase || 'idle', remainingMin: s.phase === 'running' ? s.remainingMin ?? null : null, since: s.phase === 'running' ? s.since || null : null, doneAt: s.phase === 'done' ? s.doneAt || null : null }; });
  return { ok: true, demo: hh.demo || undefined, now: new Date(now).toISOString(), tz, today: L.date, remindTime: rt, configured: !!(bins.length || mail || plants.length || laundry.length),
    bins, mail, plants, laundry, counts: { binsTonight: bins.filter((b) => b.state === 'tonight' && !b.out).length, thirsty: plants.filter((p) => p.thirsty && !p.watered).length, done: laundry.filter((a) => a.phase === 'done').length, mail: mail?.state === 'post' ? 1 : 0 } };
}
let hhLastStates = new Map();   // the sensors as last read (the view never waits on Home Assistant)
async function hhReadStates() {
  if (hh.demo || !config.homeAssistant?.url || !hh.cfg.plants.list.length) return;
  const states = await haStates().catch(() => null); if (states) hhLastStates = new Map(states.map((s) => [s.entity_id, s]));
}
setInterval(() => { hhReadStates().catch(() => {}); }, 30_000).unref?.();
setTimeout(() => { hhReadStates().catch(() => {}); hhRefreshExt(true).catch(() => {}); }, 3000).unref?.();

/* ---- checking what people send ---- */
const hhId = () => crypto.randomBytes(5).toString('hex');
const hhEnt = (v, doms = 'sensor|binary_sensor|calendar|input_boolean|input_datetime|plant|switch') => (new RegExp(`^(${doms})\\.[\\w-]{1,120}$`).test(String(v || '')) ? String(v) : null);
const hhTime = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d);
function hhCleanBin(b, old = {}) {
  const name = String(b.name ?? old.name ?? '').trim().slice(0, 40); if (!name) throw new Error('Give the bin a name, like "Recycling".');
  const icon = HH_BIN_ICONS.includes(b.icon) ? b.icon : HH_BIN_ICONS.includes(old.icon) ? old.icon : 'trash';
  const color = HH_COLORS.includes(b.color) ? b.color : HH_COLORS.includes(old.color) ? old.color : '#6b7280';
  const source = ['schedule', 'ha', 'ical'].includes(b.source) ? b.source : old.source || 'schedule';
  const out = { id: old.id || hhId(), name, icon, color, source };
  if (source === 'schedule') {
    out.repeat = HH_REPEAT.includes(b.repeat) ? b.repeat : 'weekly';
    out.dow = Number.isInteger(Number(b.dow)) && Number(b.dow) >= 0 && Number(b.dow) <= 6 ? Number(b.dow) : 1;
    if (out.repeat === 'monthly') {
      if (Number(b.mday) >= 1 && Number(b.mday) <= 31) out.mday = Math.round(Number(b.mday));
      else out.nth = [1, 2, 3, 4, -1].includes(Number(b.nth)) ? Number(b.nth) : 1;
    }
    if (b.start != null && b.start !== '' && !HH_YMD.test(String(b.start))) throw new Error('Pick a date.');
    if (['biweekly', 'every4'].includes(out.repeat)) {
      let s = HH_YMD.test(String(b.start || '')) ? String(b.start) : hhLocal(Date.now(), houseTz()).date;
      s = ymdAdd(s, (out.dow - ymdDow(s) + 7) % 7);   // the first pickup is on its weekday
      out.start = s;
    }
  } else if (source === 'ha') {
    out.entity = hhEnt(b.entity, 'sensor|calendar|input_datetime'); if (!out.entity) throw new Error('Pick the Home Assistant sensor with the next pickup.');
    out.match = String(b.match || '').trim().slice(0, 40);
  } else {
    out.match = String(b.match || name).trim().slice(0, 40);
  }
  return out;
}
function hhCleanChange(c) {
  if (HH_YMD.test(String(c?.holiday || ''))) return { id: c.id && /^[0-9a-f]{10}$/.test(c.id) ? c.id : hhId(), holiday: String(c.holiday), days: [1, 2].includes(Number(c.days)) ? Number(c.days) : 1 };
  if (!HH_YMD.test(String(c?.date || ''))) throw new Error('Pick the pickup to change.');
  const to = c.to ? String(c.to) : null; if (to && !HH_YMD.test(to)) throw new Error('Pick the new day.');
  return { id: c.id && /^[0-9a-f]{10}$/.test(c.id) ? c.id : hhId(), date: String(c.date), to, bin: c.bin && /^[0-9a-f]{10}$/.test(String(c.bin)) ? String(c.bin) : null };
}
function hhCleanApp(a, old = {}) {
  const kind = HH_KINDS.includes(a.kind) ? a.kind : old.kind || 'washer';
  const name = String(a.name ?? old.name ?? { washer: 'Washer', dryer: 'Dryer', dishwasher: 'Dishwasher' }[kind]).trim().slice(0, 30) || 'Washer';
  const entity = hhEnt(a.entity); if (!entity) throw new Error('Pick the Home Assistant sensor for it.');
  const mode = ['power', 'state', 'remaining'].includes(a.mode) ? a.mode : 'power';
  return { id: old.id || (a.id && /^[0-9a-f]{10}$/.test(a.id) ? a.id : hhId()), name, kind, entity, mode, remaining: hhEnt(a.remaining, 'sensor'), onW: Math.max(1, Math.min(500, Math.round(Number(a.onW) || 8))), offMin: Math.max(1, Math.min(30, Math.round(Number(a.offMin) || 5))) };
}
/* The settings as the app shows them (the calendar link stays on the box: only its host is shown). */
function hhSetupView() {
  const c = hh.cfg; let icalHost = null;
  try { const u = c.ical ? unseal(c.ical) : null; if (u) icalHost = new URL(u.replace(/^webcal:/i, 'https:')).hostname; } catch { /* not a link */ }
  return { bins: c.bins, changes: c.changes, remind: c.remind, mail: c.mail, plants: c.plants, apps: c.apps, appsRemind: c.appsRemind !== false, appsPush: !!c.appsPush, ical: !!c.ical, icalHost, icons: HH_BIN_ICONS, colors: HH_COLORS };
}

/* Setup's one bin question ("Trash pickup day"): a weekly Trash bin, unless bins are already set up. */
function hhFromSetup(day) {
  const d = Number(day); if (hh.demo || day === '' || day == null || !Number.isInteger(d) || d < 0 || d > 6 || hh.cfg.bins.length) return;
  hh.cfg.bins = [{ id: hhId(), name: 'Trash', icon: 'trash', color: '#6b7280', source: 'schedule', repeat: 'weekly', dow: d }]; hhSave(true);
}
/* ---- routes ---- */
const hhNotDemo = (res) => { res.status(400).json({ error: 'Not in the demo.' }); return false; };
app.get('/api/household', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(hhView()); });
app.get('/api/household/setup', async (_req, res) => {
  const base = { ...hhSetupView(), ha: !!config.homeAssistant?.url || hh.demo, pro: !!proStatus().pro, phones: push.subs.length + (config.alerts?.phone === 'homeassistant' ? 1 : 0), demo: hh.demo || undefined };
  if (hh.demo) return res.json({ ...base, suggest: { bins: [], mail: [], plants: [], apps: [] }, entities: [...hhDemoStates(Date.now()).values()].map((s) => ({ id: s.entity_id, name: hhName(s), state: String(s.state).slice(0, 24), unit: s.attributes?.unit_of_measurement || null, cls: s.attributes?.device_class || null })) });
  const states = config.homeAssistant?.url ? await haStates().catch(() => []) : [];
  const tz = houseTz(), today = hhLocal(Date.now(), tz).date, sug = hhSuggest(states, today, tz), c = hh.cfg;
  // what's already set up isn't suggested again
  sug.bins = sug.bins.filter((x) => !c.bins.some((b) => b.entity === x.entity)); sug.plants = sug.plants.filter((x) => !c.plants.list.some((p) => p.entity === x.entity)); sug.apps = sug.apps.filter((x) => !c.apps.some((a) => a.kind === x.kind || a.entity === x.entity));
  if (c.mail.entity) sug.mail = [];
  const entities = states.filter((s) => /^(sensor|binary_sensor|plant|calendar|input_boolean|input_datetime|switch)\./.test(s.entity_id)).slice(0, 3000)
    .map((s) => ({ id: s.entity_id, name: hhName(s), state: String(s.state).slice(0, 24), unit: s.attributes?.unit_of_measurement || null, cls: s.attributes?.device_class || null }));
  res.json({ ...base, suggest: sug, entities });
});
app.put('/api/household/setup', requireRole('member'), express.json({ limit: '64kb' }), (req, res) => {
  if (hh.demo) return hhNotDemo(res);
  const b = req.body || {}, c = hh.cfg;
  try {
    const next = { ...c };
    if (Array.isArray(b.bins)) { if (b.bins.length > 12) throw new Error('Up to 12 bins.'); next.bins = b.bins.map((x) => hhCleanBin(x || {}, c.bins.find((o) => o.id === x?.id) || {})); }
    if (Array.isArray(b.changes)) { const today = hhLocal(Date.now(), houseTz()).date; next.changes = b.changes.slice(0, 40).map(hhCleanChange).filter((x) => (x.holiday ? ymdAdd(x.holiday, 7) : (x.to && x.to > x.date ? x.to : x.date)) >= today); }
    if (b.remind && typeof b.remind === 'object') next.remind = { time: hhTime(b.remind.time, c.remind.time || '19:00'), flash: b.remind.flash !== false, push: !!b.remind.push && !!proStatus().pro };
    if (b.mail && typeof b.mail === 'object') { next.mail = { entity: b.mail.entity ? hhEnt(b.mail.entity, 'binary_sensor|sensor|input_boolean') : null, reset: b.mail.reset === 'tap' ? 'tap' : 'door', remind: b.mail.remind !== false, push: !!b.mail.push && !!proStatus().pro }; if (b.mail.entity && !next.mail.entity) throw new Error('Pick the mailbox sensor.'); if (next.mail.entity !== c.mail.entity) hh.st.mail = {}; }
    if (b.plants && typeof b.plants === 'object') {
      const list = (Array.isArray(b.plants.list) ? b.plants.list : c.plants.list).slice(0, 40).map((p) => ({ entity: hhEnt(p?.entity, 'plant|sensor'), name: String(p?.name || '').trim().slice(0, 40), ...(Number(p?.min) >= 1 && Number(p?.min) <= 90 ? { min: Math.round(Number(p.min)) } : {}) })).filter((p) => p.entity);
      for (const p of list) p.name ||= p.entity.split('.')[1].replace(/_/g, ' ');
      next.plants = { list, threshold: Math.max(1, Math.min(90, Math.round(Number(b.plants.threshold) || c.plants.threshold || 20))), time: hhTime(b.plants.time, c.plants.time || '09:00'), remind: b.plants.remind !== false };
    }
    if (Array.isArray(b.apps)) { if (b.apps.length > 6) throw new Error('Up to 6 appliances.'); next.apps = b.apps.map((x) => hhCleanApp(x || {}, c.apps.find((o) => o.id === x?.id) || {})); for (const id of Object.keys(hh.st.apps)) if (!next.apps.some((a) => a.id === id)) delete hh.st.apps[id]; }
    if ('appsRemind' in b) next.appsRemind = b.appsRemind !== false;
    if ('appsPush' in b) next.appsPush = !!b.appsPush && !!proStatus().pro;
    if ('ical' in b) {
      if (!b.ical) next.ical = null;
      else { const u = String(b.ical).trim().replace(/^webcal:/i, 'https:'); if (!/^https?:\/\/[^\s]{4,1500}$/i.test(u)) throw new Error('That doesn\'t look like a calendar link.'); next.ical = seal(u); }
    }
    for (const id of Object.keys(hh.st.bins)) if (!next.bins.some((x) => x.id === id)) delete hh.st.bins[id];
    hh.st.active = hh.st.active.filter((a) => !a.id.startsWith('hh-bin-') || next.bins.some((x) => a.id === `hh-bin-${x.id}`));
    hh.cfg = next; hhSave(true); hh.extAt = 0; hhRefreshExt(true).then(() => { if (typeof liveNudge === 'function') liveNudge(); }).catch(() => {}); hhReadStates().catch(() => {});
    res.json({ ok: true, ...hhSetupView() });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
/* Read a city calendar link: the kinds of pickup in it (so each can become a bin with one tap). */
app.post('/api/household/ical', requireRole('member'), express.json({ limit: '4kb' }), async (req, res) => {
  if (hh.demo) return hhNotDemo(res);
  if (limited(`hh-ics:${req.ip}`, 20, 60_000)) return res.status(429).json({ error: 'Slow down a little.' });
  const raw = req.body?.url ? String(req.body.url).trim() : (hh.cfg.ical ? unseal(hh.cfg.ical) : '');
  const u = String(raw || '').replace(/^webcal:/i, 'https:');
  if (!/^https?:\/\/[^\s]{4,1500}$/i.test(u)) return res.status(400).json({ error: 'That doesn\'t look like a calendar link.' });
  try {
    const tz = houseTz(), occ = expandEvents((await hhIcalEvents(u)).events, Date.now() - 86400_000, Date.now() + 120 * 86400_000, tz);
    if (!occ.length) return res.status(400).json({ error: 'That calendar has no pickups in the next four months.' });
    res.json({ kinds: hhIcalKinds(occ, tz) });
  } catch (e) { res.status(400).json({ error: 'That calendar link didn\'t work. Check it opens in a browser.', detail: String(e.message || e).slice(0, 120) }); }
});
app.post('/api/household/bins/:id/out', requireRole('member'), express.json({ limit: '1kb' }), (req, res) => {
  const out = req.body?.out !== false;
  if (hh.demo) { const b = hh.cfg.bins.find((x) => x.id === req.params.id); if (!b) return res.status(404).json({ error: 'That bin is gone.' }); const next = hhBinDates(b, hhLocal(Date.now(), houseTz()).date, hh.cfg.changes)[0]?.date; hhDemoMem.bins[b.id] = out ? { outFor: next } : {}; return res.json({ ok: true }); }
  if (!hhBinOut(req.params.id, out)) return res.status(404).json({ error: 'That bin is gone.' });
  res.json({ ok: true });
});
app.post('/api/household/mail/collected', requireRole('member'), (_req, res) => { if (hh.demo) { hhDemoMem.mail = true; return res.json({ ok: true }); } hhMailCollected(); res.json({ ok: true }); });
app.post('/api/household/plants/watered', requireRole('member'), (_req, res) => { if (hh.demo) { hhDemoMem.watered = hhLocal(Date.now(), houseTz()).date; return res.json({ ok: true }); } hhWatered(); res.json({ ok: true }); });
app.post('/api/household/laundry/:id/emptied', requireRole('member'), (req, res) => { if (hh.demo) { hhDemoMem.emptied[req.params.id] = Date.now(); return res.json({ ok: true }); } hhEmptied(String(req.params.id)); res.json({ ok: true }); });

/* ---- the demo: a believable week (trash tonight, yard waste tomorrow night, recycling next week), post that
   came this morning, two thirsty plants, the washer running and the dryer done. Taps last until the hour turns. ---- */
const hhDemoMem = { bins: {}, mail: false, watered: null, emptied: {}, hour: -1, day: null };
function hhDemoSetup() {
  hh.demo = true;
  const tz = houseTz(), L = hhLocal(Date.now(), tz), dow = (n) => ymdDow(ymdAdd(L.date, n));
  hh.cfg = { ...hhDefaults(),
    bins: [
      { id: 'demotrash0', name: 'Trash', icon: 'trash', color: '#6b7280', source: 'schedule', repeat: 'weekly', dow: dow(1) },
      { id: 'demoyard00', name: 'Yard waste', icon: 'yard', color: '#65a30d', source: 'schedule', repeat: 'weekly', dow: dow(2) },
      { id: 'demorecyc0', name: 'Recycling', icon: 'recycling', color: '#2563eb', source: 'schedule', repeat: 'biweekly', dow: dow(1), start: ymdAdd(L.date, 8) },
    ],
    mail: { entity: 'binary_sensor.mailbox_door', reset: 'door', remind: true, push: false },
    plants: { list: [{ entity: 'plant.monstera', name: 'Monstera' }, { entity: 'sensor.basil_soil_moisture', name: 'Basil' }, { entity: 'sensor.fiddle_leaf_fig_moisture', name: 'Fiddle-leaf fig' }], threshold: 20, time: '09:00', remind: true },
    apps: [{ id: 'demowasher', name: 'Washer', kind: 'washer', entity: 'sensor.washer_power', mode: 'power', remaining: 'sensor.washer_time_left', onW: 8, offMin: 5 },
      { id: 'demodryer0', name: 'Dryer', kind: 'dryer', entity: 'sensor.dryer_power', mode: 'power', remaining: null, onW: 8, offMin: 5 },
      { id: 'demodishw0', name: 'Dishwasher', kind: 'dishwasher', entity: 'sensor.dishwasher_status', mode: 'state', remaining: null, onW: 8, offMin: 5 }] };
}
function hhDemoState(now) {
  const h = Math.floor(now / 3600_000); if (h !== hhDemoMem.hour) Object.assign(hhDemoMem, { bins: {}, mail: false, watered: null, emptied: {}, hour: h });
  const cyc = (now / 60_000) % 40, washLeft = Math.max(1, Math.round(40 - cyc)), L = hhLocal(now, houseTz());
  return { bins: hhDemoMem.bins, mail: hhDemoMem.mail ? { state: 'empty', collectedAt: new Date(now).toISOString() } : { state: 'post', at: new Date(now - 2 * 3600_000 - 17 * 60_000).toISOString() },
    plants: hhDemoMem.watered === L.date ? { 'plant.monstera': { wateredOn: L.date }, 'sensor.basil_soil_moisture': { wateredOn: L.date } } : {},
    apps: { demowasher: { phase: 'running', since: new Date(now - (55 - washLeft) * 60_000).toISOString(), remainingMin: washLeft }, demodryer0: hhDemoMem.emptied.demodryer0 ? { phase: 'idle' } : { phase: 'done', doneAt: new Date(now - 14 * 60_000).toISOString() }, demodishw0: { phase: 'idle' } } };
}
function hhDemoStates(now) {
  const S = (entity_id, state, attributes) => [entity_id, { entity_id, state, attributes, last_changed: new Date(now - 3600_000).toISOString() }];
  return new Map([S('binary_sensor.mailbox_door', 'off', { friendly_name: 'Mailbox door', device_class: 'door' }), S('plant.monstera', 'problem', { friendly_name: 'Monstera', moisture: 18, problem: 'moisture low' }),
    S('sensor.basil_soil_moisture', '12', { friendly_name: 'Basil soil moisture', unit_of_measurement: '%', device_class: 'moisture' }), S('sensor.fiddle_leaf_fig_moisture', '41', { friendly_name: 'Fiddle-leaf fig moisture', unit_of_measurement: '%', device_class: 'moisture' }),
    S('sensor.washer_power', '412', { friendly_name: 'Washer power', unit_of_measurement: 'W', device_class: 'power' }), S('sensor.washer_time_left', '23', { friendly_name: 'Washer time left', unit_of_measurement: 'min' }),
    S('sensor.dryer_power', '1.2', { friendly_name: 'Dryer power', unit_of_measurement: 'W', device_class: 'power' }), S('sensor.dishwasher_status', 'Off', { friendly_name: 'Dishwasher status' })]);
}
if (isDemo()) hhDemoSetup();

if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchHousehold = { hhLocal, hhAt, hhRawDates, hhApplyChanges, hhBinDates, hhBinState, hhWasteDates, hhMinutes, hhAppStep, hhMailStep, hhPlantOf, hhSuggest, hhIcalKinds, hhCleanBin, hhCleanChange, hhDateOf, hhActive, hhAnswer, hhView, hhFromSetup, hh, ymdAdd, ymdDiff };
