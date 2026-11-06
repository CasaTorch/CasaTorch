/* ======================================================================
 * Cleaning up after a removed device or brand: when a brand set up in setup is removed (Connect › Remove), or a
 * camera is taken off, the tiles for its devices go from every page layout (everyone's, every kind of screen, each
 * person's and each screen's), from the old Home files, from camera walls, and their per-device alert rules go too.
 * Only the devices of what was removed are touched: matched by their id (hue:..., shelly:..., camera:<id>), never by
 * what happens to be offline right now.
 * ====================================================================== */
/** Pure: a layout's tiles without the ones for these devices. Tiles showing several devices keep the others. */
function tilesWithout(tiles, gone) {
  if (!Array.isArray(tiles)) return { tiles, n: 0 };
  let n = 0;
  const out = [];
  for (const t of tiles) {
    if (t?.device && gone(String(t.device))) { n++; continue; }
    if (Array.isArray(t?.ids) && t.ids.some((x) => gone(String(x)))) {
      const ids = t.ids.filter((x) => !gone(String(x)));
      n++;
      if (!ids.length && !t.opts) continue;   // a tile that only listed these: gone; one with its own options keeps its place
      out.push({ ...t, ids }); continue;
    }
    out.push(t);
  }
  return { tiles: out, n };
}
/** Take these devices out of everything that names them. cfg: the config about to be saved (alert rules are in it).
    Answers { tiles, walls, rules } (how many of each changed). */
function purgeDevices(gone, cfg = config) {
  const n = { tiles: 0, walls: 0, rules: 0 };
  const pageSet = (pages) => { for (const L of Object.values(pages || {})) { if (!L?.tiles) continue; const r = tilesWithout(L.tiles, gone); if (r.n) { L.tiles = r.tiles; n.tiles += r.n; } } };
  pageSet(pageLayouts.house);
  for (const g of ['forms', 'users', 'screens']) for (const pages of Object.values(pageLayouts[g] || {})) pageSet(pages);
  if (homeLayout?.tiles) { const r = tilesWithout(homeLayout.tiles, gone); if (r.n) homeLayout.tiles = r.tiles; }
  for (const l of Object.values(screenLayouts || {})) if (l?.tiles) { const r = tilesWithout(l.tiles, gone); if (r.n) l.tiles = r.tiles; }
  if (Array.isArray(camWalls)) for (const w of camWalls) { const before = w.cams.length; w.cams = w.cams.filter((x) => !gone(String(x))); if (w.cams.length !== before) n.walls++; }
  const dropKeys = (o) => { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) if (gone(k)) { delete o[k]; n.rules++; } };
  dropKeys(cfg.alerts?.rules?.devices);
  for (const u of Object.values(cfg.alerts?.users || {})) dropKeys(u?.devices);
  if (!isDemo()) {
    if (n.tiles) { savePageLayouts(); try { if (homeLayout) writeFileSafe(LAYOUT_FILE, JSON.stringify(homeLayout), 0o600); writeFileSafe(SCREENS_FILE, JSON.stringify(screenLayouts), 0o600); } catch { /* next save */ } }
    if (n.walls) writeFileSafe(CW_FILE, JSON.stringify({ walls: camWalls, at: nowIso() }));
  }
  if ((n.tiles || n.walls) && typeof liveNudge === 'function') liveNudge();
  return n;
}
/** Which device ids belong to a brand set up in setup (Connect's Remove). cfg: the config before it is removed. */
function devicesOfConnection(id, cfg = config) {
  const pre = { 'hue-local': 'hue:', 'shelly-local': 'shelly:', 'yolink-cloud': 'yolink:', 'ring-labs': 'ring:' }[id];
  if (pre) return (d) => d.startsWith(pre);
  const type = { frigate: 'frigate', 'reolink-local': 'reolink', snapshot: 'snapshot' }[id];
  if (type) { const ids = new Set((cfg.cameras || []).filter((c) => c.type === type).map((c) => `camera:${c.id}`)); return (d) => ids.has(d) || (type === 'frigate' && d.startsWith('camera:frigate-')); }
  return () => false;
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchCleanup = { tilesWithout, purgeDevices, devicesOfConnection };
