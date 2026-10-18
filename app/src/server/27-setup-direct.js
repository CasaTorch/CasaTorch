/* ======================================================================
 * Setup wizard, part 2: everything that works WITHOUT Home Assistant.
 * Town lookup for the weather, calendar/feed tests, team lists, Hue
 * pairing, Shelly/YoLink/Reolink/snapshot-camera tests, Ring (Pro Labs)
 * sign-in. Lives under /api/setup, so it closes with the wizard (05-setup.js).
 * ====================================================================== */
app.get('/api/setup/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);   // OpenStreetMap's Nominatim, used as its policy asks (placeSearch, 61-widgets.js)
  if (q.length < PLACE_MIN) return res.json({ places: [], credit: PLACE_CREDIT });
  if (overLimit(`geocode:${clientIp(req)}`, 20, 60_000)) return res.status(429).json({ error: 'slow down - try again in a minute' });
  try { res.json({ places: await placeSearch(q), credit: PLACE_CREDIT }); }
  catch (err) { res.status(502).json({ error: `town search is not answering (${err.message}) - you can type the latitude and longitude instead` }); }
});
app.get('/api/setup/sports/leagues', (_req, res) => res.json({ leagues: Object.entries(LEAGUES).map(([id, l]) => ({ id, name: l.name })) }));
app.get('/api/setup/sports/teams', async (req, res) => { try { res.json(await sportsTeams(String(req.query.league || ''))); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
app.get('/api/setup/news/defaults', (req, res) => {
  const loc = { name: String(req.query.town || '').slice(0, 80), cc: String(req.query.cc || '').toUpperCase().slice(0, 2) }, lang = String(req.query.lang || 'en').slice(0, 5);
  const ctx = { town: homeTown(loc), cc: homeCountry(loc) || 'US', lang };
  res.json({ feeds: NEWS_DEFAULTS, smart: GN_KINDS.map(([id, label]) => { const f = gnFeed(id, ctx); return f ? { id, label, name: f.name } : null; }).filter(Boolean) });
});

const hostOk = (h) => /^[\w.-]{1,253}(:\d{1,5})?$/.test(String(h || '').trim());
Object.assign(TESTS, {
  async calendar({ url }) {
    const u = String(url || '').trim().replace(/^webcal:/i, 'https:'); if (badUrl(u)) throw new Error('paste the calendar\'s secret address (it starts with https:// or webcal://)');
    const { text } = await getText(u, { timeout: 15000 });
    const ev = parseIcs(text, houseTz());
    if (!ev.length && !/BEGIN:VCALENDAR/.test(text)) throw new Error('that link is not a calendar (.ics) address');
    return { ok: true, message: `Calendar found - ${ev.length} event${ev.length === 1 ? '' : 's'}` };
  },
  async feed({ url }) {
    const u = String(url || '').trim(); if (badUrl(u)) throw new Error('the address should start with http:// or https://');
    const f = parseFeed((await getText(u, { timeout: 12000 })).text).items || [];
    if (!f.length) throw new Error('no headlines found - is that an RSS or Atom feed?');
    return { ok: true, message: `${f.length} headlines - newest: "${f[0].title.slice(0, 60)}"` };
  },
  async shelly({ hosts }) {
    const list = String(hosts || '').split(/[\s,]+/).filter(Boolean);
    if (!list.length || !list.every(hostOk)) throw new Error('enter each Shelly\'s IP address, separated by spaces or commas');
    const found = [];
    for (const h of list) { const j = await getJSON(`http://${h}/shelly`, { timeout: 5000 }).catch(() => null); found.push(j ? `${h} (${j.model || j.type || 'Shelly'})` : `${h} - no answer`); }
    const bad = found.filter((x) => x.includes('no answer'));
    if (bad.length === found.length) throw new Error(`none answered: ${list.join(', ')}`);
    return { ok: true, message: `Found ${found.length - bad.length} of ${found.length}: ${found.join(', ')}` };
  },
  async yolink({ uaid, secret }) {
    const r = await fetch('https://api.yosmart.com/open/yolink/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: String(uaid || '').trim(), client_secret: String(secret || '').trim() }), signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error('YoLink refused those - check the UAID and Secret Key');
    return { ok: true, message: 'Connected to YoLink' };
  },
  async reolink(c) {
    if (!hostOk(c.host)) throw new Error('enter the camera\'s IP address');
    await CAMERA_SNAPSHOT.reolink({ ...c, host: String(c.host).trim() });
    return { ok: true, message: 'Got a picture from the camera' };
  },
  async snapshot(c) {
    if (badUrl(String(c.snapshotUrl || ''))) throw new Error('the snapshot address should start with http:// or https://');
    const img = await CAMERA_SNAPSHOT.snapshot(c);
    return { ok: true, message: `Got a picture (${Math.round(img.buf.length / 1024)} KB)` };
  },
});

/* Philips Hue without Home Assistant: find the bridge, press its button, pair. */
/* The bridge announces itself on the network (mDNS) - that works without the internet; Philips' own list is asked too. */
app.get('/api/setup/hue/discover', async (_req, res) => res.json({ bridges: await DISCOVERERS.hue().catch(() => []) }));
app.post('/api/setup/hue/pair', async (req, res) => {
  const host = String(req.body?.host || '').trim();
  if (!hostOk(host)) return res.status(400).json({ ok: false, error: 'enter the bridge\'s IP address' });
  if (isDemo()) { draft.hue = { host, username: 'demo' }; return res.json({ ok: true, message: 'Paired (demo)' }); }
  try {
    const r = await huePair(host);
    if (!r.ok) return res.json(r);
    draft.hue = { host, username: r.username };
    const lights = await getJSON(`http://${host}/api/${r.username}/lights`, { timeout: 6000 }).catch(() => ({}));
    res.json({ ok: true, message: `Paired - ${Object.keys(lights || {}).length} lights` });
  } catch (err) { res.json({ ok: false, error: `could not reach a Hue bridge at ${host} (${err.message})` }); }
});
app.get('/api/setup/draft', (_req, res) => res.json({ hue: draft.hue ? { host: draft.hue.host } : null, ring: !!draft.ring }));
