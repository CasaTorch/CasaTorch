/* Demo data: every tab reads /api/<tab>; in demo mode the answer is a fixture
   file (demo/fixtures/<tab>.json). Real providers replace these one by one as
   modules are ported (docs/MODULES.md). */
const FIXTURES = path.join(APP_DIR, '..', 'demo', 'fixtures');
const TABS = ['home', 'alerts', 'controls', 'cameras', 'sensors', 'network', 'servers', 'energy'];
app.get('/api/status', (_req, res) => res.json({ name: 'HouseOS', version: '0.1.0', demo: isDemo(), configured: isConfigured(), tabs: TABS, at: nowIso() }));
app.get('/api/:tab', (req, res, next) => {
  if (!TABS.includes(req.params.tab)) return next();
  if (!isDemo()) return res.status(501).json({ error: `the ${req.params.tab} tab is not ported yet - run in demo mode (HOUSEOS_DEMO=1)` });
  try { res.json(JSON.parse(fs.readFileSync(path.join(FIXTURES, `${req.params.tab}.json`), 'utf8'))); }
  catch { res.json({ demo: true, items: [] }); }
});
