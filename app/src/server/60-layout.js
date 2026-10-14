/* ======================================================================
 * The Home screen layout: which tiles, in what order, how big. Saved on the
 * box (data/layout.json) so every screen in the house shows the same thing.
 *   { tiles: [{ id, w (1-12 columns), h (rows), opts? }] }
 * ====================================================================== */
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
let homeLayout = null; try { homeLayout = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')); } catch { /* default in the client */ }
app.get('/api/layout', (_req, res) => res.json({ layout: homeLayout }));
app.put('/api/layout', express.json({ limit: '64kb' }), (req, res) => {
  const tiles = req.body?.tiles;
  if (req.body?.reset) { homeLayout = null; try { fs.unlinkSync(LAYOUT_FILE); } catch { /* none */ } return res.json({ ok: true }); }
  if (!Array.isArray(tiles) || tiles.length > 60) return res.status(400).json({ error: 'bad layout' });
  const clean = tiles.filter((t) => /^[a-z0-9-]{1,30}(:[\w.-]{1,60})?$/.test(String(t?.id))).map((t) => ({ id: String(t.id), w: Math.max(1, Math.min(12, Math.round(Number(t.w) || 4))), h: Math.max(1, Math.min(10, Math.round(Number(t.h) || 2))) }));
  homeLayout = { tiles: clean, savedAt: nowIso() };
  if (!isDemo()) { const tmp = `${LAYOUT_FILE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(homeLayout), { mode: 0o600 }); fs.renameSync(tmp, LAYOUT_FILE); }
  res.json({ ok: true });
});
