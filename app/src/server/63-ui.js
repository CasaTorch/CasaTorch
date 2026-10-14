/* ======================================================================
 * Look & feel, shared by every screen in the house: light/dark, colors,
 * where the menu sits, the status bar, and the household's own names for
 * menu items and devices. config.ui (the demo keeps its own in memory).
 * ====================================================================== */
const UI_DEFAULTS = { theme: 'dark', accent: '#5eb8ff', accent2: '#8b7bff', nav: 'left', statusBar: 'panel', panelAsk: true, tabs: {}, deviceNames: {} };
let demoUi = null;
const uiPrefs = () => ({ ...UI_DEFAULTS, ...((isDemo() ? demoUi : config.ui) || {}) });
const HEX = /^#[0-9a-f]{6}$/i;
app.get('/api/ui', (_req, res) => res.json(uiPrefs()));
app.put('/api/ui', express.json({ limit: '128kb' }), (req, res) => {
  const b = req.body || {}, cur = uiPrefs(), next = { ...cur };
  if (b.reset) { if (isDemo()) demoUi = null; else { const { ui, ...rest } = config; saveConfig(rest); } return res.json(uiPrefs()); }
  if (['dark', 'light', 'auto'].includes(b.theme)) next.theme = b.theme;
  if (HEX.test(b.accent || '')) next.accent = b.accent;
  if (HEX.test(b.accent2 || '')) next.accent2 = b.accent2;
  if (['left', 'right', 'top', 'bottom'].includes(b.nav)) next.nav = b.nav;
  if (['panel', 'always', 'off'].includes(b.statusBar)) next.statusBar = b.statusBar;
  if (typeof b.panelAsk === 'boolean') next.panelAsk = b.panelAsk;
  if (b.tabs && typeof b.tabs === 'object') next.tabs = Object.fromEntries(Object.entries(b.tabs).filter(([k]) => /^[a-z0-9]{1,20}$/.test(k)).slice(0, 30).map(([k, v]) => [k, { label: String(v?.label || '').trim().slice(0, 24) || null, hidden: k !== 'settings' && !!v?.hidden }]));
  if (b.deviceNames && typeof b.deviceNames === 'object') next.deviceNames = Object.fromEntries(Object.entries(b.deviceNames).filter(([k, v]) => /^[\w.:-]{1,120}$/.test(k) && String(v || '').trim()).slice(0, 1000).map(([k, v]) => [k, String(v).trim().slice(0, 60)]));
  if (isDemo()) demoUi = next; else saveConfig({ ...config, ui: next });
  res.json(next);
});

/* The status bar: everything CasaTorch runs or talks to, and whether it's OK right now. */
app.get('/api/connections', async (_req, res) => {
  const items = [];
  const add = (id, name, state, detail) => items.push({ id, name, state, detail: detail || null });   // state: ok | warn | down | off
  if (isDemo()) {
    const inet = demoFixture('internet');
    add('internet', 'Internet', 'ok', `${Math.round(inet.speed.downMbps)} Mbps`); add('ha', 'Home Assistant', 'ok', '412 entities'); add('hue', 'Hue', 'ok', '3 lights'); add('shelly', 'Shelly', 'ok', '2 of 2');
    add('cameras', 'Cameras', 'ok', '3'); add('yolink', 'YoLink', 'warn', 'low battery'); add('weather', 'Weather', 'ok'); add('calendar', 'Calendars', 'ok', '3'); add('sports', 'Scores', 'ok'); add('news', 'News', 'ok'); add('ai', 'Assistant', 'ok', 'demo');
    return res.json({ items, at: nowIso() });
  }
  const settle = async (p) => { try { return await p; } catch (err) { return { error: String(err.message || err) }; } };
  const [dev, inet, wx, cal] = await Promise.all([settle(allDevices()), settle(internetNow()), config.location ? settle(weatherNow()) : null, (config.calendars || []).length ? settle(calendarEvents(3)) : null]);
  add('internet', 'Internet', inet?.online ? 'ok' : 'down', inet?.online ? (inet.speed ? `${Math.round(inet.speed.downMbps)} Mbps` : inet.provider) : 'offline');
  const errs = new Map((dev?.errors || []).map((e) => [e.provider, e.error]));
  const devs = dev?.devices || [];
  const prov = (id, name, on, list) => { if (!on) return; const ds = devs.filter(list); const bad = ds.filter((d) => d.online === false).length; add(id, name, errs.has(id) ? 'down' : bad ? 'warn' : 'ok', errs.get(id) || (bad ? `${ds.length - bad} of ${ds.length} online` : `${ds.length}`)); };
  prov('ha', 'Home Assistant', !!config.homeAssistant?.url, (d) => d.provider === 'ha');
  prov('hue', 'Hue', !!config.hue?.username, (d) => d.provider === 'hue');
  prov('shelly', 'Shelly', (config.shelly || []).length, (d) => d.provider === 'shelly');
  prov('yolink', 'YoLink', !!config.yolink?.uaid, (d) => d.provider === 'yolink');
  prov('ring', 'Ring', !!config.ring?.refreshToken, (d) => d.provider === 'ring');
  prov('cameras', 'Cameras', (config.cameras || []).length, (d) => d.provider === 'camera');
  if (config.location) add('weather', 'Weather', wx?.now ? 'ok' : 'warn', wx?.now ? null : 'not loading');
  if (cal) add('calendar', 'Calendars', cal.errors?.length ? 'warn' : 'ok', cal.errors?.length ? `${cal.errors.length} not loading` : null);
  if ((config.sports?.teams || []).length) add('sports', 'Scores', 'ok');
  if ((config.news?.feeds || []).length) add('news', 'News', 'ok');
  add('ai', 'Assistant', config.ai?.model ? 'ok' : 'off', config.ai?.model ? config.ai.provider : 'not set up');
  res.json({ items, at: nowIso() });
});
