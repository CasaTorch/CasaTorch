/* ======================================================================
 * Settings: the Pro key, a few everyday values, and "run setup again".
 * Everything here needs a signed-in session (08-signin.js guards /api).
 * ====================================================================== */
app.post('/api/license', express.json(), (req, res) => {
  const key = String(req.body?.key || '').trim();
  const lic = checkLicenseKey(key);
  if (!lic.valid) return res.status(400).json({ error: lic.why });
  if (isDemo()) return res.json({ ok: true, demo: true, pro: { pro: true, plan: lic.payload.plan, email: lic.payload.email } });
  saveConfig({ ...config, license: key });
  res.json({ ok: true, pro: proStatus() });
});
app.delete('/api/license', (_req, res) => { if (!isDemo()) { const { license, ...rest } = config; saveConfig(rest); } res.json({ ok: true, pro: proStatus() }); });

/* What the Settings tab shows - names and counts only, never keys or passwords. */
app.get('/api/settings', (_req, res) => {
  const c = config;
  res.json({
    demo: isDemo(), version: '0.2.0', pro: proStatus(),
    house: c.house || { name: 'Demo House', timezone: 'America/Los_Angeles', units: 'F' },
    location: c.location ? { name: c.location.name || null } : (isDemo() ? { name: 'Springfield' } : null),
    calendars: (c.calendars || []).map((x) => x.name),
    teams: (c.sports?.teams || []).map((t) => `${t.name || t.id} (${String(t.league).toUpperCase()})`),
    feeds: (c.news?.feeds || []).map((f) => f.name || f.url),
    ...(isDemo() ? { calendars: ['Family', 'Kids', 'House'], teams: ['49ers (NFL)', 'Warriors (NBA)', 'Giants (MLB)'], feeds: ['Local News', 'Weather Desk', 'Tech'] } : {}),
    energy: { ratePerKwh: c.energy?.ratePerKwh ?? (isDemo() ? 0.17 : null), budget: c.energy?.budget ?? null, currency: c.house?.currency || 'USD' },
    note: c.note || null,
    connected: isDemo() ? { homeAssistant: true, hue: true, shelly: 2, cameras: 3, yolink: true, ring: false, meraki: false, unifi: false } : {
      homeAssistant: !!c.homeAssistant?.url, hue: !!c.hue?.username, shelly: (c.shelly || []).length, cameras: Array.isArray(c.cameras) ? c.cameras.length : 0,
      yolink: !!c.yolink?.uaid, ring: !!c.ring?.refreshToken, meraki: !!c.network?.meraki, unifi: !!c.network?.unifi,
    },
    signIn: signInOn(),
    ai: c.ai ? { provider: c.ai.provider, model: c.ai.model, url: c.ai.url || null, hasKey: !!c.ai.apiKey } : null,
  });
});
app.put('/api/settings', express.json(), (req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true });
  const b = req.body || {}, next = { ...config };
  if ('houseName' in b) next.house = { ...(next.house || {}), name: String(b.houseName || '').trim().slice(0, 60) || 'My House' };
  if ('note' in b) next.note = String(b.note || '').slice(0, 280) || null;
  if ('ratePerKwh' in b) { const r = Number(b.ratePerKwh); if (!(r >= 0 && r < 5)) return res.status(400).json({ error: 'the rate is in dollars per kWh, e.g. 0.17' }); next.energy = { ...(next.energy || {}), ratePerKwh: r }; }
  if ('budget' in b) next.energy = { ...(next.energy || {}), budget: Number(b.budget) || null };
  saveConfig(next); res.json({ ok: true });
});
/* Re-open the setup wizard from the app (asks for the password again). */
app.post('/api/settings/rerun-setup', express.json(), (req, res) => {
  if (signInOn() && (!req.user || rank(req.user.role) < rank('admin') || !verifySecret(req.user.password, req.body?.password || ''))) return res.status(403).json({ error: 'that password is not right' });
  setupReopened = true; res.json({ ok: true, url: '/setup.html' });
});
