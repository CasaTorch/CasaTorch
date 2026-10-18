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
