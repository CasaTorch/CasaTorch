/* ======================================================================
 * Connect: the in-app gallery of everything CasaTorch works with
 * (client 28-connect.js). It reads the same catalog as the setup wizard and
 * asks here what is already connected, so each card can say "Connected".
 * Connecting something opens the guided setup at exactly that item - nobody
 * needs a command line.
 * ====================================================================== */
app.get('/api/catalog', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('json').send(fs.readFileSync(SETUP_CATALOG)); });
async function haDomainsNow() {
  const h = config.homeAssistant; if (!h?.url) return [];
  try {
    return (await cached('ha:domains', 60_000, async () => ({ list: [...new Set((await getJSON(`${h.url}/api/config/config_entries/entry`, { headers: { Authorization: `Bearer ${h.token}` } }) || []).map((e) => e.domain))] }))).list || [];
  } catch { return []; }
}
app.get('/api/connections', async (_req, res) => {
  if (isDemo() && process.env.CASATORCH_DEMO_NOHA === '1') return res.json({ demo: true, ha: { connected: false, online: false }, domains: [], direct: ['hue-local', 'shelly-local', 'frigate', 'yolink-cloud', 'calendars', 'sports', 'news'], counts: { hue: 3, shelly: 2, camera: 4, yolink: 1 } });
  if (isDemo()) return res.json({ demo: true, ha: { connected: true, online: true }, domains: ['hue', 'ring', 'zwave_js', 'ecobee', 'enphase_envoy', 'opower'], direct: ['hue-local', 'shelly-local', 'frigate', 'yolink-cloud', 'calendars', 'sports', 'news'], counts: Object.fromEntries(Object.entries((await houseDevices()).devices.reduce((a, d) => ({ ...a, [d.provider]: (a[d.provider] || 0) + 1 }), {}))) });
  const c = config, cams = c.cameras || [], net = c.network || {};
  const direct = [
    cams.some((x) => x.type === 'frigate') && 'frigate', cams.some((x) => x.type === 'reolink') && 'reolink-local', cams.some((x) => x.type === 'snapshot') && 'snapshot',
    c.hue && 'hue-local', (c.shelly || []).length && 'shelly-local', c.yolink && 'yolink-cloud', c.ring && 'ring-labs',
    net.meraki && 'meraki', net.meraki && 'meraki-mt', net.meraki && 'meraki-mv', net.unifi && 'unifi', net.dns?.kind,
    (c.calendars || []).length && 'calendars', (c.sports?.teams || []).length && 'sports', (c.news?.feeds || []).length && 'news', (c.reminders || []).length && 'reminders',
    c.energy && 'energy',
  ].filter(Boolean);
  const [domains, devs] = await Promise.all([haDomainsNow(), houseDevices().catch(() => ({ devices: [] }))]);
  const counts = {}; for (const d of devs.devices) counts[d.provider] = (counts[d.provider] || 0) + 1;
  res.json({ ha: { connected: !!c.homeAssistant?.url, online: domains.length > 0 }, domains, direct, counts });
});

/* Remove a brand that was set up in setup: its settings, addresses and keys are deleted from this CasaTorch. (Brands that
   come through Home Assistant are removed in Home Assistant; network sources and App tests have their own Remove.) */
const REMOVABLE = {
  'hue-local': (c) => { delete c.hue; }, 'shelly-local': (c) => { delete c.shelly; }, 'yolink-cloud': (c) => { delete c.yolink; }, 'ring-labs': (c) => { delete c.ring; },
  frigate: (c) => { c.cameras = (c.cameras || []).filter((x) => x.type !== 'frigate'); }, 'reolink-local': (c) => { c.cameras = (c.cameras || []).filter((x) => x.type !== 'reolink'); },
  snapshot: (c) => { c.cameras = (c.cameras || []).filter((x) => x.type !== 'snapshot'); },
};
app.delete('/api/connections/:id', requireRole('admin'), (req, res) => {
  const fn = Object.hasOwn(REMOVABLE, req.params.id) ? REMOVABLE[req.params.id] : null; if (!fn) return res.status(404).json({ error: 'That one is removed somewhere else (Home Assistant, or its own Remove button).' });
  if (isDemo()) return res.json({ ok: true, demo: true });
  const next = JSON.parse(JSON.stringify(config)); fn(next); saveConfig(next);
  if (typeof audit === 'function') audit(req, 'connection-removed', { id: req.params.id });
  res.json({ ok: true });
});
