/* ======================================================================
 * The Home screen layout (the older way - Home now uses page layouts, below, which carry these over and keep
 * them in step): which widgets, in what order, how big, and each
 * widget's own options. Saved on the box, so every screen in the house shows
 * the same Home - or, when someone chooses "Just this screen", a screen
 * (the kitchen tablet, your phone) keeps a layout of its own.
 *   data/layout.json          { tiles: [tile] }            shared (admins change it)
 *   data/screen-layouts.json  { <screen id>: { tiles, at } } per screen (anyone who can switch things)
 *   tile: { id, w (1-12 columns), h (rows), title?, ids?, device?, area?, look?, opts? }
 * ====================================================================== */
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json'), SCREENS_FILE = path.join(DATA_DIR, 'screen-layouts.json');
let homeLayout = null; try { homeLayout = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')); } catch { /* default in the client */ }
let screenLayouts = {}; try { screenLayouts = JSON.parse(fs.readFileSync(SCREENS_FILE, 'utf8')) || {}; } catch { /* none yet */ }
const LOOKS = ['default', 'tint', 'clear', 'solid'];
/* A widget's options: plain values only (text, numbers, yes/no, short lists), a few levels deep, small. */
function cleanOpts(v, depth = 0) {
  if (v == null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.slice(0, 500);
  if (depth >= 3) return undefined;
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => cleanOpts(x, depth + 1)).filter((x) => x !== undefined);
  if (typeof v === 'object') {
    const out = Object.create(null);
    for (const [k, x] of Object.entries(v).slice(0, 30)) { if (!/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(k)) continue; const c = cleanOpts(x, depth + 1); if (c !== undefined) out[k] = c; }
    return { ...out };
  }
  return undefined;
}
function cleanTiles(tiles) {
  if (!Array.isArray(tiles) || tiles.length > 60) return null;
  return tiles.filter((t) => /^[a-z0-9-]{1,30}(:[\w.-]{1,60})?$/.test(String(t?.id))).map((t) => {
    const out = { id: String(t.id), w: Math.max(1, Math.min(12, Math.round(Number(t.w) || 4))), h: Math.max(1, Math.min(10, Math.round(Number(t.h) || 2))) };
    if (t.title) out.title = String(t.title).trim().slice(0, 40);
    if (Array.isArray(t.ids)) out.ids = t.ids.filter((x) => /^[\w.:-]{1,120}$/.test(String(x))).slice(0, 40).map(String);
    if (t.device && /^[\w.:-]{1,120}$/.test(String(t.device))) out.device = String(t.device);
    if (t.area) out.area = String(t.area).slice(0, 80);
    if (LOOKS.includes(t.look) && t.look !== 'default') out.look = t.look;
    if (t.tint && /^#[0-9a-f]{6}$/i.test(String(t.tint))) out.tint = String(t.tint);
    const o = t.opts && typeof t.opts === 'object' ? cleanOpts(t.opts) : undefined;
    if (o && Object.keys(o).length && JSON.stringify(o).length <= 8000) out.opts = o;
    if (t.showWhen && typeof famCleanRule === 'function') { const r = famCleanRule(t.showWhen); if (r) out.showWhen = r; }   // "Show only when..." (79c-family.js)
    return out;
  });
}
const screenId = (v) => (/^[A-Za-z0-9_-]{8,40}$/.test(String(v || '')) ? String(v) : null);
app.get('/api/layout', (req, res) => {
  const sid = screenId(req.query.screen), own = sid ? screenLayouts[sid] : null;
  res.json({ layout: homeLayout, screen: own ? { tiles: own.tiles, at: own.at } : null });
});
app.put('/api/layout', express.json({ limit: '256kb' }), (req, res) => {
  if (req.body?.reset) { homeLayout = null; try { fs.unlinkSync(LAYOUT_FILE); } catch { /* none */ } delete pageLayouts.house.home; savePageLayouts(); return res.json({ ok: true }); }
  const clean = cleanTiles(req.body?.tiles); if (!clean) return res.status(400).json({ error: 'bad layout' });
  homeLayout = { tiles: clean, savedAt: nowIso() };
  if (!isDemo()) writeFileSafe(LAYOUT_FILE, JSON.stringify(homeLayout), 0o600);
  pageLayouts.house.home = { tiles: clean, seen: null, at: homeLayout.savedAt }; savePageLayouts();   // the Home page reads page layouts now (below)
  res.json({ ok: true });
});
/* "Just this screen": not under /api/layout, so people who can switch things (not only admins) can arrange their own screen. */
app.put('/api/screen-layout/:sid', express.json({ limit: '256kb' }), (req, res) => {
  const sid = screenId(req.params.sid); if (!sid) return res.status(400).json({ error: 'bad screen' });
  if (req.body?.off) { delete screenLayouts[sid]; if (pageLayouts.screens[sid]) delete pageLayouts.screens[sid].home; }
  else {
    const clean = cleanTiles(req.body?.tiles); if (!clean) return res.status(400).json({ error: 'bad layout' });
    screenLayouts[sid] = { tiles: clean, at: nowIso() }; (pageLayouts.screens[sid] ||= {}).home = { tiles: clean, seen: null, at: screenLayouts[sid].at };
    const ids = Object.keys(screenLayouts);   // at most 50 screens: the ones not used for longest go first
    if (ids.length > 50) for (const k of ids.sort((a, b) => String(screenLayouts[a].at).localeCompare(String(screenLayouts[b].at))).slice(0, ids.length - 50)) delete screenLayouts[k];
  }
  if (!isDemo()) writeFileSafe(SCREENS_FILE, JSON.stringify(screenLayouts), 0o600);
  savePageLayouts();
  res.json({ ok: true });
});

/* ======================================================================
 * Page layouts: every page built on the page grid (06-pagegrid.js) - Home, Controls, Cameras, Security, Alerts,
 * Energy, Network, Reminders, Family and Household. Each page is a grid of that page's tiles. Until someone arranges a page, CasaTorch suggests one
 * from what the house has (suggestPageTiles below) - so a house with solar gets the power-flow tile, one with
 * Frigate gets Detections, one with Home Assistant areas gets a tile per room - and the suggestion follows new
 * devices by itself. Once arranged, a layout is kept:
 *   data/page-layouts.json  { house: { <page>: L }, forms: { phone|tablet|desktop: { <page>: L } },
 *                             users: { <user id>: { <page>: L } }, screens: { <screen id>: { <page>: L } } }
 *   L = { tiles: [tile], seen: [tile keys suggested when it was saved], at }
 * Which one shows: this screen's, else yours, else the one for this kind of screen (every phone, every wall
 * tablet, every computer), else the house's, else the suggestion.
 * The house's and the per-kind ones are changed by admins; yours by you (when sign-in is on); a screen's by
 * anyone who can switch things.
 * Home used to keep its own files (layout.json, screen-layouts.json, above): they are carried over once, and
 * kept in step, so an older app still shows the same Home.
 * ====================================================================== */
const PAGE_LAYOUT_FILE = path.join(DATA_DIR, 'page-layouts.json');
const PAGES = ['home', 'energy', 'cameras', 'controls', 'security', 'alerts', 'network', 'reminders', 'family', 'household'];
const FORMS = ['phone', 'tablet', 'desktop'];
let pageLayouts = { house: {}, forms: {}, users: {}, screens: {} };
try { const j = JSON.parse(fs.readFileSync(PAGE_LAYOUT_FILE, 'utf8')); if (j && typeof j === 'object') pageLayouts = { house: j.house || {}, forms: j.forms || {}, users: j.users || {}, screens: j.screens || {} }; } catch { /* none yet */ }
const savePageLayouts = () => { if (!isDemo()) writeFileSafe(PAGE_LAYOUT_FILE, JSON.stringify(pageLayouts), 0o600); };
/* "The same tile" across layouts (the page shows "New for your home" for suggested tiles not yet seen): its kind, plus
   the device, the group or the room it is for. Matches tileKey() in 06-pagegrid.js. */
const pageTileKey = (t) => `${String(t.id).split(':')[0]}${t.device ? `@${t.device}` : ''}${t.opts?.group ? `#${t.opts.group}` : ''}${t.opts?.area != null && t.opts?.area !== '' ? `~${t.opts.area}` : ''}`;
const cleanSeen = (v) => (Array.isArray(v) ? v.filter((x) => /^[a-z0-9-]{1,30}(@[\w.:-]{1,120})?(#[\w-]{1,30})?(~[^\u0000-\u001f]{1,80})?$/.test(String(x))).slice(0, 120).map(String) : []);

/* Carry the old Home layouts over (pure: changes `pl`, says whether it did). seen: null = "everything suggested
   the first time it is shown counts as seen", so a carried-over Home doesn't greet anyone with a pile of new tiles. */
function migrateHomeLayouts(pl, home, screens) {
  let changed = false;
  if (Array.isArray(home?.tiles) && home.tiles.length && !pl.house.home) { pl.house.home = { tiles: home.tiles, seen: null, at: home.savedAt || nowIso() }; changed = true; }
  for (const [sid, l] of Object.entries(screens || {})) {
    if (!Array.isArray(l?.tiles) || !l.tiles.length || pl.screens[sid]?.home) continue;
    (pl.screens[sid] ||= {}).home = { tiles: l.tiles, seen: null, at: l.at || nowIso() }; changed = true;
  }
  return changed;
}
if (migrateHomeLayouts(pageLayouts, homeLayout, screenLayouts)) savePageLayouts();

/* The suggested layout for a page, from facts about the house (pageFacts). Pure: the same facts give the same layout.
   Sizes are in 12ths of a desktop row (w) and rows of 78 px (h); auto-height pages ignore h. form: phone | tablet | desktop. */
const CTL_KINDS = { lights: ['light'], plugs: ['plug', 'switch'], climate: ['climate'], fans: ['fan'], media: ['media'], covers: ['cover'], locks: ['lock', 'alarm'], actions: ['action'], vacuums: ['vacuum'], people: ['presence'], sensors: ['sensor'], other: ['value'] };
function suggestPageTiles(page, f = {}, form = 'desktop') {
  const out = [], add = (id, w, h, extra) => out.push({ id, w, h, ...(extra || {}) });
  const phone = form === 'phone';
  if (page === 'home') {
    // the essentials first, then what this house has, then the nice-to-haves (fewer on a phone)
    add('clock', 4, 2); add('weather', 5, 4); add('alerts', 3, 2);
    if (f.metered) add('energy', 3, 2); else add('internet', 3, 2);
    if (f.cameras) add('camera', phone ? 12 : 4, f.cameras > 1 && !phone ? 4 : 3);
    if (f.switchable) add('lights', 5, f.switchable > 6 ? 4 : 3);
    if (f.climate) add('thermostat', 3, 3);
    if (f.secure) add('secure', 4, 3);
    add('calendar', 4, 4);
    if (f.media) add('media', 4, 2);
    add(f.household ? 'household' : 'today', 3, 3);
    if (!phone) { add('news', 4, 3); if (f.metered) add('internet', 3, 2); add('sports', 3, 4); add('photos', 5, 4); }
    if (f.pro) add('ask', 6, 3);
    if (!f.devices && !f.cameras) add('lights', 5, 3);   // nothing connected yet: the switches tile says how to connect
    return out.filter((t, i) => out.findIndex((x) => x.id === t.id) === i);
  }
  if (page === 'energy') {
    const metered = f.metered || [], flow = f.solar || f.battery || f.ev || (f.grid && metered.length);
    if (!metered.length && !f.ha && !f.solar && !f.meter) { add('en-start', 8, 4); add('en-now', 4, 4); return out; }
    if (flow) { add('en-flow', 6, 5); add('en-now', 3, 2); add('en-usage', 3, 2); add('en-baseload', 3, 3); add(f.pro ? 'en-bill' : 'en-week-mini', 3, 3); }
    else { add('en-now', 4, 2); add('en-usage', 4, 2); add('en-baseload', 4, 2); add('en-history', 8, 4); add('en-bill', 4, 2); add('en-week-mini', 4, 2); }
    if (flow) add('en-history', 8, 4);
    if (metered.length) add('en-top', 4, flow ? 4 : 5);
    if (f.solar || f.battery || f.ha) add('en-sources', f.metered?.length ? 8 : 12, 4);
    if (f.solar) add('en-solar', 4, 2);
    if (f.battery) add('en-battery', 4, 2);
    if (f.hours) add('en-heatmap', 8, 4);
    if (f.rooms >= 2) add('en-rooms', 4, 4);
    if (f.history >= 8) add('en-week', 6, 3);
    if (f.tariff) add('en-tou', f.history >= 8 ? 3 : 4, 3);
    if (f.co2) add('en-co2', f.history >= 8 ? 3 : 4, 3);
    if (f.standby) add('en-standby', 6, 3);
    metered.slice(0, phone ? 2 : 4).forEach((d) => add('en-dev', 3, 2, { device: d.id, title: d.name }));
    if (f.pro || f.history >= 3) add('en-report', 6, 5);
    if (!f.rate) add('en-start', 6, 3);
    return out;
  }
  if (page === 'cameras') {
    if (!f.cameras) { add('cam-start', 12, 1); if (f.hidden) add('cam-hidden', 12, 1); return out; }
    add('cam-wall', 12, 1);
    if (f.frigate) add('cam-det', 12, 1);
    if (f.hidden) add('cam-hidden', 12, 1);
    return out;
  }
  if (page === 'controls') {
    const g = f.groups || {}, total = Object.values(g).reduce((s, n) => s + n, 0);
    if (!total) { add('ctl-start', 12, 1); return out; }
    add('ctl-summary', 12, 1);
    const areas = (f.areas || []).filter((a) => a.n > 0);
    const inRooms = areas.reduce((s, a) => s + a.n, 0);
    if (areas.length >= 2 && inRooms >= total * 0.5) {   // Home Assistant rooms: a tile per room, the busy ones wide
      if (g.actions) add('ctl-group', 12, 1, { opts: { group: 'actions' } });
      if (g.climate) add('ctl-climate', 12, 1);
      for (const a of areas.slice(0, 16)) add('ctl-room', a.n > 8 ? 12 : 6, 1, { opts: { area: a.name } });
      if (f.loose) add('ctl-room', f.loose > 8 ? 12 : 6, 1, { opts: { area: '-' } });   // everything not in a room
      return out;
    }
    for (const k of Object.keys(CTL_KINDS)) if (g[k]) add('ctl-group', ['lights', 'sensors', 'other'].includes(k) || g[k] > 8 ? 12 : 6, 1, { opts: { group: k } });
    return out;
  }
  if (page === 'security') {
    if (f.cameras) add('sec-wall', 12, 1); else add('sec-start', 12, 1);
    add('sec-doors', 6, 1); add('sec-alarm', 6, 1); add('sec-events', 6, 1); add('sec-check', 6, 1);
    if (f.hidden) add('sec-hidden', 6, 1);
    add('sec-lan', 12, 1);
    return out;
  }
  if (page === 'alerts') { add('al-now', 6, 1); add('al-week', 6, 1); add('al-recent', 6, 1); add('al-sources', 6, 1); add('al-phones', 12, 1); return out; }
  if (page === 'network') return netSuggest(f);   // from what's connected (74n-net-model.js)
  if (page === 'reminders') { add('rem-today', 6, 1); add('rem-phones', 6, 1); add('rem-list', 12, 1); return out; }
  if (page === 'family') { add('fam-lists', phone ? 12 : 6, 1); add('fam-chores', phone ? 12 : 6, 1); add('fam-meals', 12, 1); add('fam-routines', 12, 1); return out; }
  if (page === 'household') {   // what this house has set up; nothing yet: one tile that says how
    if (!f.configured) { add('hh-start', 12, 1); return out; }
    if (f.bins) add('hh-bins', f.mail || f.plants || f.laundry ? 6 : 12, 1);
    if (f.mail) add('hh-mail', 6, 1);
    if (f.laundry) add('hh-laundry', 6, 1);
    if (f.plants) add('hh-plants', 6, 1);
    return out;
  }
  return out;
}
/* What the page's suggestion is made from - counts and yes/no only. */
async function pageFacts(page) {
  if (page === 'energy') {
    const { devices } = await houseDevices(), days = await histDays(), now = Date.now(), hk = Math.floor(now / 3600_000);
    const metered = devices.filter(enMetered).map((d) => ({ id: d.id, name: d.name, w: d.powerW, ...(isDemo() ? {} : { kwh: (days[dayOf(now)]?.dev?.[d.id]?.[1]) || 0 }) })).sort((a, b) => (b.kwh || 0) - (a.kwh || 0) || b.w - a.w);
    const fl = enFlowsNow(devices, housePower(devices).watts), pr = enPrefs(devices), roomOf = enRoomOf((() => { try { return fpData(); } catch { return null; } })());
    const hours = isDemo() ? 48 : Object.keys(EN.hours).filter((k) => Number(k) > hk - 48).length;
    const ha = !!(await enHa(1));
    return { metered, solar: fl.solarW != null || isDemo(), battery: !!fl.battery || isDemo(), ev: fl.evW != null, grid: fl.gridW != null, meter: !!housePower(devices).from, ha,
      rooms: new Set(devices.filter(enMetered).map(roomOf).filter(Boolean)).size, hours: hours >= 24, history: Object.keys(days).length, pro: !!proStatus().pro || isDemo(),
      rate: !!pr.rate, tariff: !!pr.peak, co2: !!pr.co2, standby: isDemo() || hours >= 72 };
  }
  if (page === 'network') return netPageFacts();   // 74n-net-model.js
  if (page === 'reminders' || page === 'family') return {};
  if (page === 'household') { const v = hhView(); return { configured: !!v.configured, bins: v.bins.length, mail: !!v.mail, plants: v.plants.length, laundry: v.laundry.length }; }   // 78h-household.js
  const r = await houseDevices(), devices = r.devices, n = (f) => devices.filter(f).length;
  if (page === 'cameras') return { cameras: n((d) => d.kind === 'camera'), hidden: (r.hiddenCameras || []).length, frigate: frigateServers().length > 0 };
  if (page === 'security') return { cameras: n((d) => d.kind === 'camera'), hidden: (r.hiddenCameras || []).length };
  if (page === 'controls') return ctlFacts(devices);
  if (page === 'home') {
    return { devices: devices.length, cameras: n((d) => d.kind === 'camera'), switchable: n((d) => ['light', 'switch', 'plug'].includes(d.kind)), climate: n((d) => d.kind === 'climate'),
      secure: n((d) => d.kind === 'lock' || d.kind === 'alarm' || (d.kind === 'cover' && d.risky)), media: n((d) => d.kind === 'media'), metered: n((d) => typeof d.powerW === 'number' && !d.pairedTo),
      household: isDemo(), pro: !!proStatus().pro || isDemo() };
  }
  return {};
}
/** Controls: devices by kind, and by Home Assistant area (rooms with the most first). Pure. */
function ctlFacts(devices) {
  const ds = devices.filter((d) => d.kind !== 'camera'), by = new Map();
  for (const d of ds) if (d.area) by.set(d.area, (by.get(d.area) || 0) + 1);
  return { groups: Object.fromEntries(Object.entries(CTL_KINDS).map(([k, kinds]) => [k, ds.filter((d) => kinds.includes(d.kind)).length])),
    areas: [...by].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)), loose: ds.filter((d) => !d.area && !['presence', 'value', 'action'].includes(d.kind)).length };
}
const pageOf = (p) => (PAGES.includes(String(p)) ? String(p) : null);
const formOf = (f) => (FORMS.includes(String(f)) ? String(f) : null);
app.get('/api/page-layout/:page', async (req, res) => {
  const page = pageOf(req.params.page); if (!page) return res.status(404).json({ error: 'no such page' });
  const sid = screenId(req.query.screen), form = formOf(req.query.form), uid = req.user && !req.user.panel ? req.user.id : null;
  let suggested = []; try { suggested = suggestPageTiles(page, await cached(`page-facts:${page}`, 20_000, () => pageFacts(page)), form || 'desktop'); } catch { /* the page still shows */ }
  const pick = (L) => {   // a carried-over layout counts what is suggested now as seen (see migrateHomeLayouts)
    if (L && L.seen === null) { L.seen = suggested.map(pageTileKey); savePageLayouts(); }
    return L || null;
  };
  res.json({ page, house: pick(pageLayouts.house[page]), form: form ? pick(pageLayouts.forms[form]?.[page]) : null, formName: form, user: uid ? pick(pageLayouts.users[uid]?.[page]) : null,
    screen: sid ? pick(pageLayouts.screens[sid]?.[page]) : null, suggested, canUser: !!uid && signInOn() });
});
/* scope: house (admins) | form (admins: every phone, tablet or computer) | user (you) | screen (this screen).
   { tiles, seen } saves; { reset: true } goes back to the next one down. */
app.put('/api/page-layout/:page', express.json({ limit: '256kb' }), (req, res) => {
  const page = pageOf(req.params.page); if (!page) return res.status(404).json({ error: 'no such page' });
  const scope = String(req.body?.scope || 'house'), role = req.user?.role, admin = !signInOn() || ['owner', 'admin'].includes(role);
  let box;
  if (scope === 'house') { if (!admin) return res.status(403).json({ error: 'Only an admin can change the layout everyone sees.' }); box = pageLayouts.house; }
  else if (scope === 'form') {
    const form = formOf(req.body?.form); if (!form) return res.status(400).json({ error: 'bad form' });
    if (!admin) return res.status(403).json({ error: 'Only an admin can change the layout every phone or tablet sees.' });
    box = (pageLayouts.forms[form] ||= {});
  } else if (scope === 'user') { if (!req.user || req.user.panel) return res.status(400).json({ error: 'Sign in to keep a layout of your own.' }); box = (pageLayouts.users[req.user.id] ||= {}); }
  else if (scope === 'screen') { const sid = screenId(req.body?.screen); if (!sid) return res.status(400).json({ error: 'bad screen' }); box = (pageLayouts.screens[sid] ||= {}); }
  else return res.status(400).json({ error: 'bad scope' });
  let tiles = null;
  if (req.body?.reset) delete box[page];
  else {
    tiles = cleanTiles(req.body?.tiles); if (!tiles) return res.status(400).json({ error: 'bad layout' });
    box[page] = { tiles, seen: cleanSeen(req.body?.seen), at: nowIso() };
  }
  if (page === 'home') homeWriteThrough(scope, req.body?.screen, tiles);
  for (const k of ['users', 'screens']) {   // at most 50 people and 50 screens: the ones not used for longest go first
    const ids = Object.keys(pageLayouts[k]).filter((id) => Object.keys(pageLayouts[k][id] || {}).length || delete pageLayouts[k][id]);
    const last = (id) => Object.values(pageLayouts[k][id]).map((l) => String(l.at)).sort().pop() || '';
    if (ids.length > 50) for (const id of ids.sort((a, b) => last(a).localeCompare(last(b))).slice(0, ids.length - 50)) delete pageLayouts[k][id];
  }
  savePageLayouts();
  res.json({ ok: true });
});
/* Home, kept in step with the old files (an older app on a phone reads /api/layout). */
function homeWriteThrough(scope, screen, tiles) {
  if (isDemo()) return;
  if (scope === 'house') {
    homeLayout = tiles ? { tiles, savedAt: nowIso() } : null;
    if (tiles) writeFileSafe(LAYOUT_FILE, JSON.stringify(homeLayout), 0o600); else { try { fs.unlinkSync(LAYOUT_FILE); } catch { /* none */ } }
  } else if (scope === 'screen') {
    const sid = screenId(screen); if (!sid) return;
    if (tiles) screenLayouts[sid] = { tiles, at: nowIso() }; else delete screenLayouts[sid];
    writeFileSafe(SCREENS_FILE, JSON.stringify(screenLayouts), 0o600);
  }
}

/* ======================================================================
 * Sensor history for tiles: a reading every 5 minutes for the last 24 hours, per device, for the one number each
 * device is about (temperature, humidity, power, a value). Large tiles draw it as a chart, medium ones as a
 * sparkline. Kept in memory and saved now and then (data/sensor-history.json); never leaves this CasaTorch.
 * The demo makes up a believable day from each sensor's reading now.
 * ====================================================================== */
const SH_FILE = path.join(DATA_DIR, 'sensor-history.json'), SH_STEP = 5 * 60_000, SH_N = 288, SH_MAX = 400;
let sensorHist = {};   // id -> { f: field, v: [numbers|null], end: ms of the last slot }
try { const j = JSON.parse(fs.readFileSync(SH_FILE, 'utf8')); if (j && typeof j === 'object') sensorHist = j; } catch { /* none yet */ }
/** The number a device is about, and what it is: [field, value] or null. Pure. */
function shField(d) {
  if (!d || d.kind === 'camera') return null;
  if (Number.isFinite(d.tempC)) return ['tempC', d.tempC];
  if (d.kind === 'sensor' && Number.isFinite(d.humidity)) return ['humidity', d.humidity];
  if (Number.isFinite(d.powerW)) return ['powerW', d.powerW];
  if (d.kind === 'value' && Number.isFinite(Number(d.value)) && d.value !== '' && d.value != null) return ['value', Number(d.value)];
  if (Number.isFinite(d.humidity)) return ['humidity', d.humidity];
  return null;
}
/** Adds one reading per device in the slot for `now` (pure apart from `store`). */
function shRecord(store, devices, now) {
  const slot = Math.floor(now / SH_STEP) * SH_STEP;
  for (const d of devices) {
    const fv = shField(d); if (!fv) continue;
    let e = store[d.id];
    if (!e || e.f !== fv[0]) { if (!e && Object.keys(store).length >= SH_MAX) continue; e = store[d.id] = { f: fv[0], v: [], end: slot }; }
    const gap = Math.min(SH_N, Math.max(0, Math.round((slot - e.end) / SH_STEP)));
    for (let i = 1; i < gap; i++) e.v.push(null);   // missed readings stay empty, not made up
    if (gap === 0 && e.v.length) e.v[e.v.length - 1] = Math.round(fv[1] * 100) / 100; else e.v.push(Math.round(fv[1] * 100) / 100);
    if (e.v.length > SH_N) e.v.splice(0, e.v.length - SH_N);
    e.end = slot;
  }
  return store;
}
/** The demo's day: a gentle daily swing around the reading now, the same every time for the same device. */
function shDemo(d, now) {
  const fv = shField(d); if (!fv) return null;
  const [f, v] = fv, end = Math.floor(now / SH_STEP) * SH_STEP;
  let seed = 0; for (const c of String(d.id)) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const amp = f === 'tempC' ? (/outdoor|outside/i.test(`${d.id} ${d.name}`) ? 5 : 1.4) : f === 'humidity' ? 6 : f === 'powerW' ? Math.max(5, v * 0.5) : Math.max(1, Math.abs(v) * 0.2);
  const vals = Array.from({ length: SH_N }, (_, i) => {
    const t = end - (SH_N - 1 - i) * SH_STEP, h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    const day = Math.sin(((h - 9) / 24) * Math.PI * 2), wob = Math.sin(i * 0.37 + seed % 7) * 0.25 + Math.sin(i * 0.11 + seed % 5) * 0.2;
    let x = v + amp * (day - Math.sin(((new Date(end).getHours() - 9) / 24) * Math.PI * 2)) * 0.6 + amp * wob * 0.4;
    if (f === 'powerW' || f === 'humidity') x = Math.max(0, x);
    return Math.round(x * 10) / 10;
  });
  vals[SH_N - 1] = v;
  return { f, v: vals, end };
}
const shSample = async () => { try { const { devices } = await houseDevices(); shRecord(sensorHist, devices, Date.now()); } catch { /* next time */ } };
if (!isDemo() && process.env.CASATORCH_TEST !== '1') {
  setTimeout(shSample, 30_000).unref?.();
  setInterval(shSample, SH_STEP).unref?.();
  setInterval(() => { try { writeFileSafe(SH_FILE, JSON.stringify(sensorHist), 0o600); } catch { /* next time */ } }, 30 * 60_000).unref?.();
}
/* ?ids=a,b (up to 40): { series: { <id>: { field, step, end, v } } } - devices with nothing yet are left out. */
app.get('/api/device-history', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter((x) => /^[\w.:-]{1,160}$/.test(x)).slice(0, 40);
  const series = {};
  if (isDemo()) { const { devices } = await houseDevices(); for (const id of ids) { const s = shDemo(devices.find((d) => d.id === id), Date.now()); if (s) series[id] = { field: s.f, step: SH_STEP, end: s.end, v: s.v }; } }
  else for (const id of ids) { const e = sensorHist[id]; if (e?.v?.length) series[id] = { field: e.f, step: SH_STEP, end: e.end, v: e.v }; }
  res.json({ series });
});

if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchPages = { suggestPageTiles, pageFacts, ctlFacts, cleanTiles, cleanSeen, pageTileKey, migrateHomeLayouts, pageLayouts: () => pageLayouts, CTL_KINDS, camDedupe, camKeys, shField, shRecord, shDemo };
