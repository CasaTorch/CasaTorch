/* Demo data: every tab reads /api/<tab>; in demo mode the answer is a fixture
   file (demo/fixtures/<tab>.json). */
const FIXTURES = path.join(APP_DIR, '..', 'demo', 'fixtures');
/* The sample data was written on one day; the demo shows it as if it were today: every date moves forward by whole days
   (times of day stay put), and the hourly forecast starts at this hour, so nothing in the demo looks stale. */
const DEMO_DAY0 = (() => { try { return JSON.parse(fs.readFileSync(path.join(FIXTURES, 'home.json'), 'utf8')).weather.days[0].date; } catch { return null; } })();
function demoFresh(j) {
  if (!DEMO_DAY0 || !j) return j;
  const tz = config.house?.timezone || 'America/Los_Angeles', today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const days = Math.round((Date.parse(today) - Date.parse(DEMO_DAY0)) / 86400_000); if (!days) return j;
  const move = (v) => (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(Date.parse(v) + days * 86400_000).toISOString() : /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(Date.parse(v) + days * 86400_000).toISOString().slice(0, 10) : v);
  const walk = (x) => (Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)])) : typeof x === 'string' ? move(x) : x);
  const out = walk(j), hours = out.weather?.hours;
  if (Array.isArray(hours) && hours.length) {
    const h0 = Math.floor(Date.now() / 3600_000) * 3600_000, hourOf = (t) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)));
    out.weather.hours = hours.map((h, k) => { const at = h0 + k * 3600_000, day = hourOf(at) >= 7 && hourOf(at) < 19; return { ...h, at: new Date(at).toISOString(), symbol: String(h.symbol || '').replace(/_(day|night)$/, day ? '_day' : '_night') }; });
    if (out.weather.now?.symbol) out.weather.now.symbol = out.weather.now.symbol.replace(/_(day|night)$/, hourOf(Date.now()) >= 7 && hourOf(Date.now()) < 19 ? '_day' : '_night');
  }
  return out;
}
const TABS = ['home', 'alerts', 'controls', 'cameras', 'sensors', 'network', 'servers', 'energy'];
app.get('/api/status', (_req, res) => res.json({ name: 'CasaTorch', version: VERSION, house: config.house?.name || null, units: config.house?.units || 'F', demo: isDemo(), configured: isConfigured(), pro: proStatus(), tabs: TABS, at: nowIso() }));
app.get('/api/:tab', (req, res, next) => {
  if (!TABS.includes(req.params.tab)) return next();
  if (!isDemo()) return res.status(501).json({ error: `the ${req.params.tab} tab is not ported yet - run in demo mode (CASATORCH_DEMO=1)` });
  try {
    const j = demoFresh(JSON.parse(fs.readFileSync(path.join(FIXTURES, `${req.params.tab}.json`), 'utf8')));
    if (req.params.tab === 'home' && j.calendar && myEvents.length) j.calendar.events = [...j.calendar.events, ...myCalendarEvents(Date.now() - 6 * 3600_000, Date.now() + 7 * 86400_000)].sort((a, b) => a.start.localeCompare(b.start));
    res.json(j);
  }
  catch { res.json({ demo: true, items: [] }); }
});
