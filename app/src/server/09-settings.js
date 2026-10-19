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

/* The home's language (English unless the household picked another in setup or Settings). Public: the
   sign-in page uses it too. */
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'it', 'nl', 'ja', 'zh', 'ko', 'hi', 'pl', 'sv', 'tr'];
app.get('/api/lang', (_req, res) => res.json({ lang: isDemo() ? null : LANGS.includes(config.house?.lang) ? config.house.lang : 'en' }));   // the demo keeps whatever each browser picked
/* What the Settings tab shows - names and counts only, never keys or passwords. */
app.get('/api/settings', (_req, res) => {
  const c = config;
  res.json({
    demo: isDemo(), version: VERSION, install: INSTALL, pro: proStatus(), security: { allowedHosts: config.security?.allowedHosts || [] },
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
  if ('lang' in b) { if (!LANGS.includes(b.lang)) return res.status(400).json({ error: 'that language isn\'t available yet' }); next.house = { ...(next.house || {}), lang: b.lang }; }
  if ('note' in b) next.note = String(b.note || '').slice(0, 280) || null;
  // asked in setup's "Your home" step, changed here too (Settings › General › Language & region)
  if ('timezone' in b) { const z = String(b.timezone || ''); try { if (!/^[A-Za-z_+\-/0-9]{1,64}$/.test(z)) throw new Error(); new Intl.DateTimeFormat('en-US', { timeZone: z }); } catch { return res.status(400).json({ error: 'that time zone isn\'t known' }); } next.house = { ...(next.house || {}), timezone: z }; }
  if ('units' in b) { if (!['F', 'C'].includes(b.units)) return res.status(400).json({ error: 'pick °F or °C' }); next.house = { ...(next.house || {}), units: b.units }; }
  if ('currency' in b) { if (!/^[A-Z]{3}$/.test(String(b.currency || ''))) return res.status(400).json({ error: 'pick a currency' }); next.house = { ...(next.house || {}), currency: b.currency }; }
  if ('allowedHosts' in b) {   // extra names CasaTorch answers to (01-security.js), like a reverse proxy's
    const list = String(b.allowedHosts || '').split(/[\s,]+/).map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[:/].*$/, '')).filter(Boolean);
    if (list.some((h) => !/^(?!-)[a-z0-9.-]{1,253}$/.test(h))) return res.status(400).json({ error: 'Enter names only, like dash.example.com.' });
    next.security = { ...(next.security || {}), allowedHosts: [...new Set(list)].slice(0, 10) };
  }
  if ('ratePerKwh' in b) { const r = Number(b.ratePerKwh); if (!(r >= 0 && r < 5)) return res.status(400).json({ error: 'the rate is in dollars per kWh, e.g. 0.17' }); next.energy = { ...(next.energy || {}), ratePerKwh: r }; }
  if ('budget' in b) next.energy = { ...(next.energy || {}), budget: Number(b.budget) || null };
  saveConfig(next); res.json({ ok: true });
});
/* Re-open the setup wizard from the app (asks for the password again). */
app.post('/api/settings/rerun-setup', express.json(), asyncRoute(async (req, res) => {
  if (signInOn() && req.user && limited(`pw:${req.user.id}`, 5)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  if (signInOn() && (!req.user || rank(req.user.role) < rank('admin') || !await verifySecretAsync(req.user.password, req.body?.password || ''))) { if (req.user) failed(`pw:${req.user.id}`); return res.status(403).json({ error: 'that password is not right' }); }
  setupReopened = Date.now(); res.json({ ok: true, url: '/setup.html' });
}));
