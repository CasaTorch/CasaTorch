/* ======================================================================
 * The Home screen layout: which widgets, in what order, how big, and each
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
  if (req.body?.reset) { homeLayout = null; try { fs.unlinkSync(LAYOUT_FILE); } catch { /* none */ } return res.json({ ok: true }); }
  const clean = cleanTiles(req.body?.tiles); if (!clean) return res.status(400).json({ error: 'bad layout' });
  homeLayout = { tiles: clean, savedAt: nowIso() };
  if (!isDemo()) writeFileSafe(LAYOUT_FILE, JSON.stringify(homeLayout), 0o600);
  res.json({ ok: true });
});
/* "Just this screen": not under /api/layout, so people who can switch things (not only admins) can arrange their own screen. */
app.put('/api/screen-layout/:sid', express.json({ limit: '256kb' }), (req, res) => {
  const sid = screenId(req.params.sid); if (!sid) return res.status(400).json({ error: 'bad screen' });
  if (req.body?.off) delete screenLayouts[sid];
  else {
    const clean = cleanTiles(req.body?.tiles); if (!clean) return res.status(400).json({ error: 'bad layout' });
    screenLayouts[sid] = { tiles: clean, at: nowIso() };
    const ids = Object.keys(screenLayouts);   // at most 50 screens: the ones not used for longest go first
    if (ids.length > 50) for (const k of ids.sort((a, b) => String(screenLayouts[a].at).localeCompare(String(screenLayouts[b].at))).slice(0, ids.length - 50)) delete screenLayouts[k];
  }
  if (!isDemo()) writeFileSafe(SCREENS_FILE, JSON.stringify(screenLayouts), 0o600);
  res.json({ ok: true });
});

/* ======================================================================
 * Page layouts: Energy, Cameras, Controls, Alerts (and any page built on the page grid, 06-pagegrid.js).
 * Each page is a grid of that page's tiles. Until someone arranges a page, CasaTorch suggests one from what the
 * house has (suggestPageTiles below) - so a house with solar gets the power-flow tile, one with Frigate gets
 * Detections - and the suggestion follows new devices by itself. Once arranged, a layout is kept:
 *   data/page-layouts.json  { house: { <page>: L }, users: { <user id>: { <page>: L } }, screens: { <screen id>: { <page>: L } } }
 *   L = { tiles: [tile], seen: [tile ids suggested when it was saved], at }
 * Which one shows: this screen's, else yours, else the house's, else the suggestion.
 * The house's is changed by admins; yours by you (when sign-in is on); a screen's by anyone who can switch things.
 * ====================================================================== */
const PAGE_LAYOUT_FILE = path.join(DATA_DIR, 'page-layouts.json');
const PAGES = ['energy', 'cameras', 'controls', 'alerts', 'network'];
let pageLayouts = { house: {}, users: {}, screens: {} };
try { const j = JSON.parse(fs.readFileSync(PAGE_LAYOUT_FILE, 'utf8')); if (j && typeof j === 'object') pageLayouts = { house: j.house || {}, users: j.users || {}, screens: j.screens || {} }; } catch { /* none yet */ }
const savePageLayouts = () => { if (!isDemo()) writeFileSafe(PAGE_LAYOUT_FILE, JSON.stringify(pageLayouts), 0o600); };
const cleanSeen = (v) => (Array.isArray(v) ? v.filter((x) => /^[a-z0-9-]{1,30}(:[\w.-]{1,60})?$/.test(String(x))).slice(0, 80).map(String) : []);

/* The suggested layout for a page, from facts about the house (pageFacts). Pure: the same facts give the same layout.
   Sizes are in 12ths of a desktop row (w) and rows of 78 px (h); auto-height pages ignore h. */
const CTL_KINDS = { lights: ['light'], plugs: ['plug', 'switch'], climate: ['climate'], fans: ['fan'], media: ['media'], covers: ['cover'], locks: ['lock', 'alarm'], actions: ['action'], vacuums: ['vacuum'], people: ['presence'], sensors: ['sensor'], other: ['value'] };
function suggestPageTiles(page, f = {}) {
  const out = [], add = (id, w, h, extra) => out.push({ id, w, h, ...(extra || {}) });
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
    metered.slice(0, 4).forEach((d) => add('en-dev', 3, 2, { device: d.id, title: d.name }));
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
    for (const k of Object.keys(CTL_KINDS)) if (g[k]) add('ctl-group', ['lights', 'sensors', 'other'].includes(k) || g[k] > 8 ? 12 : 6, 1, { opts: { group: k } });
    return out;
  }
  if (page === 'alerts') { add('al-now', 6, 1); add('al-week', 6, 1); add('al-recent', 6, 1); add('al-sources', 6, 1); add('al-phones', 12, 1); return out; }
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
  if (page === 'cameras') { const r = await houseDevices(); return { cameras: r.devices.filter((d) => d.kind === 'camera').length, hidden: (r.hiddenCameras || []).length, frigate: frigateServers().length > 0 }; }
  if (page === 'controls') { const { devices } = await houseDevices(); return { groups: Object.fromEntries(Object.entries(CTL_KINDS).map(([k, kinds]) => [k, devices.filter((d) => kinds.includes(d.kind)).length])) }; }
  return {};
}
const pageOf = (p) => (PAGES.includes(String(p)) ? String(p) : null);
app.get('/api/page-layout/:page', async (req, res) => {
  const page = pageOf(req.params.page); if (!page) return res.status(404).json({ error: 'no such page' });
  const sid = screenId(req.query.screen), uid = req.user && !req.user.panel ? req.user.id : null;
  let suggested = []; try { suggested = suggestPageTiles(page, await cached(`page-facts:${page}`, 20_000, () => pageFacts(page))); } catch { /* the page still shows */ }
  res.json({ page, house: pageLayouts.house[page] || null, user: uid ? pageLayouts.users[uid]?.[page] || null : null, screen: sid ? pageLayouts.screens[sid]?.[page] || null : null, suggested, canUser: !!uid && signInOn() });
});
/* scope: house (admins) | user (you) | screen (this screen). { tiles, seen } saves; { reset: true } goes back to the next one down. */
app.put('/api/page-layout/:page', express.json({ limit: '256kb' }), (req, res) => {
  const page = pageOf(req.params.page); if (!page) return res.status(404).json({ error: 'no such page' });
  const scope = String(req.body?.scope || 'house'), role = req.user?.role;
  let box;
  if (scope === 'house') { if (signInOn() && !['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Only an admin can change the layout everyone sees.' }); box = pageLayouts.house; }
  else if (scope === 'user') { if (!req.user || req.user.panel) return res.status(400).json({ error: 'Sign in to keep a layout of your own.' }); box = (pageLayouts.users[req.user.id] ||= {}); }
  else if (scope === 'screen') { const sid = screenId(req.body?.screen); if (!sid) return res.status(400).json({ error: 'bad screen' }); box = (pageLayouts.screens[sid] ||= {}); }
  else return res.status(400).json({ error: 'bad scope' });
  if (req.body?.reset) delete box[page];
  else {
    const tiles = cleanTiles(req.body?.tiles); if (!tiles) return res.status(400).json({ error: 'bad layout' });
    box[page] = { tiles, seen: cleanSeen(req.body?.seen), at: nowIso() };
  }
  for (const k of ['users', 'screens']) {   // at most 50 people and 50 screens: the ones not used for longest go first
    const ids = Object.keys(pageLayouts[k]).filter((id) => Object.keys(pageLayouts[k][id] || {}).length || delete pageLayouts[k][id]);
    const last = (id) => Object.values(pageLayouts[k][id]).map((l) => String(l.at)).sort().pop() || '';
    if (ids.length > 50) for (const id of ids.sort((a, b) => last(a).localeCompare(last(b))).slice(0, ids.length - 50)) delete pageLayouts[k][id];
  }
  savePageLayouts();
  res.json({ ok: true });
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchPages = { suggestPageTiles, pageFacts, cleanTiles, cleanSeen, pageLayouts: () => pageLayouts, CTL_KINDS };
