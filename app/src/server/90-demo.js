/* Demo data: every tab reads /api/<tab>; in demo mode the answer is a fixture
   file (demo/fixtures/<tab>.json). Real providers replace these one by one as
   modules are ported (docs/MODULES.md). */
const FIXTURES = path.join(APP_DIR, '..', 'demo', 'fixtures');
const TABS = ['home', 'alerts', 'controls', 'cameras', 'sensors', 'network', 'servers', 'energy'];
app.get('/api/status', (_req, res) => res.json({ name: 'CasaTorch', version: '0.2.0', house: config.house?.name || null, units: config.house?.units || 'F', demo: isDemo(), configured: isConfigured(), pro: proStatus(), tabs: TABS, at: nowIso() }));
app.get('/api/:tab', (req, res, next) => {
  if (!TABS.includes(req.params.tab)) return next();
  if (!isDemo()) return res.status(501).json({ error: `the ${req.params.tab} tab is not ported yet - run in demo mode (CASATORCH_DEMO=1)` });
  try {
    const j = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${req.params.tab}.json`), 'utf8'));
    if (req.params.tab === 'home' && j.calendar && myEvents.length) j.calendar.events = [...j.calendar.events, ...myCalendarEvents(Date.now() - 6 * 3600_000, Date.now() + 7 * 86400_000)].sort((a, b) => a.start.localeCompare(b.start));
    res.json(j);
  }
  catch { res.json({ demo: true, items: [] }); }
});
