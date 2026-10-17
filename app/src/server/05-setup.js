/* ======================================================================
 * Setup wizard - the server side (the screens are public/setup.html).
 *
 * The questions and the supported gear live in catalog/setup.json. This file
 * answers four kinds of request while setup is open:
 *
 *   tests        "is this address and key right?" for Home Assistant, Frigate,
 *                Meraki, UniFi, Pi-hole, AdGuard - before anything is saved.
 *   HA flows     adding an integration to Home Assistant the way its own UI
 *                does: CasaTorch starts the integration's config flow, shows the
 *                questions Home Assistant asks (its own field list - e.g. the
 *                power companies Opower supports), and passes the answers back.
 *                Passwords typed into these go to Home Assistant only; CasaTorch
 *                never writes them anywhere.
 *   finish       writes data/config.json (owner-only) and closes the wizard.
 *
 * Open only while CasaTorch is not set up (or CASATORCH_SETUP=1). Once finished,
 * every /api/setup route answers 403.
 * ====================================================================== */
const SETUP_CATALOG = path.join(APP_DIR, 'catalog', 'setup.json');
let setupReopened = 0;   // when Settings > Run setup again was pressed (09-settings.js); open for 30 minutes
const setupOpen = () => !isConfigured() || isDemo() || Date.now() - setupReopened < 30 * 60_000 || process.env.CASATORCH_SETUP === '1';
/* Once CasaTorch is set up, the wizard is only for a signed-in owner or admin - these routes run before the
   sign-in gate, so they check for themselves (and refuse requests from other sites, like the rest of the API). */
function setupCaller(req) {
  if (!isConfigured() || isDemo() || !signInOn()) return { ok: true, user: null };
  const s = sessionOf(req), u = s && userById(s.userId);
  if (!u || u.panel || rank(u.role) < rank('admin')) return { ok: false };
  if (!['GET', 'HEAD'].includes(req.method)) {
    const site = req.headers['sec-fetch-site'], origin = req.headers.origin;
    if (site && !['same-origin', 'none'].includes(site)) return { ok: false };
    if (origin) { try { if (new URL(origin).host !== req.headers.host) return { ok: false }; } catch { return { ok: false }; } }
  }
  return { ok: true, user: u };
}
const draft = { ha: null, hue: null, ring: null };   // what the wizard has proven so far (memory only)

app.use('/api/setup', express.json({ limit: '64kb' }), (req, res, next) => {
  if (req.path === '/state') return next();
  const who = setupCaller(req); if (!who.ok) return res.status(403).json({ error: 'Sign in as an owner or admin to change setup.' });
  req.setupUser = who.user;
  if (!setupOpen()) return res.status(403).json({ error: 'CasaTorch is already set up. To change it, open Settings > Run setup again, or Connect in the dashboard.' });
  next();
});
app.get('/api/setup/state', (_req, res) => res.json({ open: setupOpen(), configured: isConfigured(), demo: isDemo(), ha: draft.ha ? { url: draft.ha.url, version: draft.ha.version } : null }));
app.get('/api/setup/catalog', (_req, res) => res.sendFile(SETUP_CATALOG));

/* ---- talking to things ---- */
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
const badUrl = (u) => !/^https?:\/\/[^\s/]+/i.test(u);
/** fetch that also accepts the self-signed certificates home gear ships with (UniFi, OPNsense). */
function getJson(url, { headers = {}, method = 'GET', body, insecure = false, timeout = 10000 } = {}) {
  if (!insecure || !url.startsWith('https:')) {
    return fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) })
      .then(async (r) => { const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* text */ } if (!r.ok) throw Object.assign(new Error(j?.message || j?.error || `HTTP ${r.status}`), { status: r.status, body: j }); return j; });
  }
  if (blockedUrl(url)) return Promise.reject(new TypeError('That address is not allowed.'));   // the same rule as fetch (00-setup.js)
  return new Promise((ok, fail) => {
    const req = https.request(url, { method, headers: { Accept: 'application/json', ...headers }, rejectUnauthorized: false, timeout }, (r) => {
      let t = ''; r.on('data', (c) => { t += c; if (t.length > 8 * 1024 * 1024) { req.destroy(); fail(new Error('the answer was too big')); } }); r.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } r.statusCode < 300 ? ok(j) : fail(Object.assign(new Error(j?.message || `HTTP ${r.statusCode}`), { status: r.statusCode })); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out'))); req.on('error', fail); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
const why = (err) => {
  const m = String(err?.cause?.code || err?.message || err);
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'that address could not be found on your network';
  if (/ECONNREFUSED/.test(m)) return 'nothing answered at that address and port';
  if (/timed out|TimeoutError|aborted/i.test(m)) return 'it did not answer in time';
  if (err?.status === 401 || err?.status === 403) return 'it refused the key or token';
  if (/certificate|SELF_SIGNED/i.test(m)) return 'its security certificate is not trusted';
  return m;
};

const TESTS = {
  /* Home Assistant: the token must work AND be an admin's, or adding integrations will fail later. */
  async homeassistant({ url, token }) {
    url = clean(url);
    if (badUrl(url)) throw new Error('the address should start with http:// or https://');
    const H = { Authorization: `Bearer ${String(token || '').trim()}` };
    const cfg = await getJson(`${url}/api/config`, { headers: H });
    let entries = [];
    try { entries = await getJson(`${url}/api/config/config_entries/entry`, { headers: H }); }
    catch (err) { if (err.status === 401 || err.status === 403) throw new Error('the token works, but its user is not an administrator - CasaTorch needs an admin token to add integrations'); }
    draft.ha = { url, token: String(token).trim(), version: cfg?.version || null };
    const domains = [...new Set((entries || []).map((e) => e.domain))];
    return { ok: true, message: `Connected to Home Assistant ${cfg?.version || ''} at "${cfg?.location_name || 'Home'}"`, version: cfg?.version, timeZone: cfg?.time_zone, units: cfg?.unit_system?.temperature, domains };
  },
  async frigate({ url }) {
    url = clean(url); if (badUrl(url)) throw new Error('the address should start with http:// or https://');
    const r = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    const stats = await getJson(`${url}/api/stats`).catch(() => null);
    const cams = stats?.cameras ? Object.keys(stats.cameras) : [];
    const ver = (await r.text()).trim().slice(0, 40); return { ok: true, cameras: cams, message: `Frigate ${/^[\w.+-]+$/.test(ver) ? ver : ''}${cams.length ? ` with ${cams.length} camera${cams.length === 1 ? '' : 's'}: ${cams.join(', ')}` : ''}` };
  },
  /* Meraki: the key, then which network - the answer feeds a follow-up question. */
  async meraki({ apiKey }) {
    const H = { 'X-Cisco-Meraki-API-Key': String(apiKey || '').trim() };
    const orgs = await getJson('https://api.meraki.com/api/v1/organizations', { headers: H });
    const nets = [];
    for (const o of (orgs || []).slice(0, 10)) for (const n of (await getJson(`https://api.meraki.com/api/v1/organizations/${o.id}/networks`, { headers: H }).catch(() => [])) || []) nets.push([`${o.id}/${n.id}`, `${n.name} (${o.name})`]);
    if (!nets.length) throw new Error('the key works but can see no networks');
    return { ok: true, message: `Found ${nets.length} network${nets.length === 1 ? '' : 's'}`, choose: { id: 'network', label: 'Which network is your home?', options: nets } };
  },
  /* UniFi Network's local API (key from Settings > Control Plane > Integrations). */
  async unifi({ url, apiKey }) {
    url = clean(url); if (badUrl(url)) throw new Error('the address should start with https://');
    const sites = await getJson(`${url}/proxy/network/integration/v1/sites`, { headers: { 'X-API-KEY': String(apiKey || '').trim() }, insecure: true });
    const list = sites?.data || [];
    return { ok: true, message: `Connected to UniFi - ${list.length} site${list.length === 1 ? '' : 's'}`, ...(list.length > 1 ? { choose: { id: 'site', label: 'Which site is your home?', options: list.map((s) => [s.id, s.name]) } } : { site: list[0]?.id }) };
  },
  async pihole({ dnsUrl, dnsKey }) {
    const url = clean(dnsUrl); if (badUrl(url)) throw new Error('the address should start with http:// or https://');
    const r = await getJson(`${url}/api/auth`, { method: 'POST', body: { password: String(dnsKey || '') }, insecure: true });   // Pi-hole v6
    if (!r?.session?.valid) throw new Error('Pi-hole refused that password');
    return { ok: true, message: 'Connected to Pi-hole' };
  },
  async adguard({ dnsUrl, dnsKey }) {
    const url = clean(dnsUrl); if (badUrl(url)) throw new Error('the address should start with http:// or https://');
    const [u, p] = String(dnsKey || '').includes(':') ? String(dnsKey).split(':') : ['admin', String(dnsKey || '')];
    const s = await getJson(`${url}/control/status`, { headers: { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` }, insecure: true });
    return { ok: true, message: `Connected to AdGuard Home ${s?.version || ''}`.trim() };
  },
};
/* ---- Home Assistant without copying a token ----
   1. Find it: try the addresses Home Assistant uses out of the box.
   2. "Sign in with Home Assistant": its own login page opens (in a small window), the person signs in
      there, Home Assistant hands back a one-time code, and CasaTorch turns that into a long-lived token
      named "CasaTorch" (visible - and removable - in Home Assistant under Profile > Security). */
const HA_GUESSES = ['http://homeassistant.local:8123', 'http://homeassistant:8123', 'http://home-assistant.local:8123'];
async function looksLikeHa(url) {
  try { const r = await fetch(`${url}/api/`, { signal: AbortSignal.timeout(3500), redirect: 'manual' }); return r.status === 401 || r.status === 200; } catch { return false; }
}
app.get('/api/setup/ha/find', async (_req, res) => {
  const hits = await Promise.all(HA_GUESSES.map(async (u) => ((await looksLikeHa(u)) ? u : null)));
  res.json({ url: hits.find(Boolean) || null });
});
const haSignins = new Map();   // state -> { url, origin, exp }
app.post('/api/setup/ha/signin', async (req, res) => {
  const url = clean(req.body?.url);
  if (badUrl(url)) return res.status(400).json({ error: 'The address should start with http:// or https://' });
  if (!(await looksLikeHa(url))) return res.status(400).json({ error: `Home Assistant didn't answer at ${url}. Check the address (it usually ends in :8123).` });
  const origin = `${req.protocol}://${req.headers.host}`, state = crypto.randomBytes(18).toString('base64url');
  for (const [k, v] of haSignins) if (v.exp < Date.now()) haSignins.delete(k);
  haSignins.set(state, { url, origin, exp: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({ response_type: 'code', client_id: `${origin}/`, redirect_uri: `${origin}/api/setup/ha/callback`, state });
  res.json({ go: `${url}/auth/authorize?${q}` });
});
function haWsAt(url, token, msg) {
  return new Promise((ok, bad) => {
    let ws; try { ws = new WebSocket(`${url.replace(/^http/, 'ws')}/api/websocket`); } catch (e) { bad(e); return; }
    const t = setTimeout(() => { try { ws.close(); } catch { /* closed */ } bad(new Error('Home Assistant did not answer')); }, 15000);
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (m.type === 'auth_invalid') { clearTimeout(t); ws.close(); bad(new Error('Home Assistant refused the sign-in')); }
      else if (m.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, ...msg }));
      else if (m.id === 1) { clearTimeout(t); ws.close(); m.success ? ok(m.result) : bad(new Error(m.error?.message || 'Home Assistant said no')); } };
    ws.onerror = () => { clearTimeout(t); bad(new Error('Could not reach Home Assistant')); };
  });
}
let haSigninResult = null;
app.get('/api/setup/ha/callback', async (req, res) => {
  const s = haSignins.get(String(req.query.state || '')); haSignins.delete(String(req.query.state || ''));
  const done = (ok, msg) => res.redirect(`/setup-ha-done.html?ok=${ok ? 1 : 0}&msg=${encodeURIComponent(msg || '')}`);
  if (!s || s.exp < Date.now() || !req.query.code) return done(false, 'That sign-in expired - try again.');
  try {
    const r = await fetch(`${s.url}/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), client_id: `${s.origin}/` }), signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.access_token) throw new Error('Home Assistant did not accept the sign-in');
    const token = await haWsAt(s.url, j.access_token, { type: 'auth/long_lived_access_token', client_name: `CasaTorch (${new Date().toISOString().slice(0, 10)})`, lifespan: 3650 });
    haSigninResult = await TESTS.homeassistant({ url: s.url, token });
    done(true, haSigninResult.message);
  } catch (err) { haSigninResult = { ok: false, error: why(err) }; done(false, haSigninResult.error); }
});
app.get('/api/setup/ha/signin-result', (_req, res) => { const r = haSigninResult; haSigninResult = null; res.json(r ? { ...r, url: draft.ha?.url || null } : { ok: false, error: 'no sign-in yet' }); });
app.post('/api/setup/test/:kind', async (req, res) => {
  const t = Object.hasOwn(TESTS, req.params.kind) ? TESTS[req.params.kind] : null;   // only the tests above, never Object's own properties
  if (!t) return res.status(404).json({ ok: false, error: 'unknown test' });
  try { res.json(await t(req.body || {})); } catch (err) { res.json({ ok: false, error: why(err) }); }
});

/* ---- adding integrations to Home Assistant (its own config flows) ---- */
function haCall(p, opts = {}) {
  if (!draft.ha) throw Object.assign(new Error('connect Home Assistant first'), { status: 409 });
  return getJson(`${draft.ha.url}${p}`, { ...opts, headers: { Authorization: `Bearer ${draft.ha.token}` }, timeout: 30000 });
}
/* Home Assistant's answer, trimmed to what the screen needs: a form (its own
   field list), a menu, done, stopped, or "finish this in Home Assistant". */
function flowView(f) {
  if (!f) return { type: 'abort', reason: 'no answer' };
  const base = { flowId: f.flow_id, domain: f.handler, step: f.step_id, type: f.type };
  if (f.type === 'form') return { ...base, fields: f.data_schema || [], errors: f.errors || {}, placeholders: f.description_placeholders || null, last: f.last_step ?? null };
  if (f.type === 'menu') return { ...base, menu: f.menu_options };
  if (f.type === 'create_entry') return { ...base, title: f.title || f.result?.title, entryId: f.result?.entry_id || null };
  if (f.type === 'abort') return { ...base, reason: f.reason };
  if (f.type === 'external' || f.type === 'external_step') return { ...base, type: 'external', url: f.url };
  if (f.type === 'progress' || f.type === 'show_progress') return { ...base, type: 'progress', progress: f.progress_action || null };
  return base;
}
const flowErr = (res, err) => res.status(err.status === 409 ? 409 : 502).json({ type: 'error', error: err.status === 404 ? 'Home Assistant does not have that integration (it may need a newer Home Assistant, or HACS)' : why(err) });
app.post('/api/setup/ha/flow', async (req, res) => {
  const domain = String(req.body?.domain || '');
  if (!/^[a-z0-9_]{2,64}$/.test(domain)) return res.status(400).json({ error: 'bad integration name' });
  try { res.json(flowView(await haCall('/api/config/config_entries/flow', { method: 'POST', body: { handler: domain, show_advanced_options: false } }))); }
  catch (err) { flowErr(res, err); }
});
app.post('/api/setup/ha/flow/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!/^[\w-]{6,64}$/.test(id)) return res.status(400).json({ error: 'bad flow' });
  try { res.json(flowView(await haCall(`/api/config/config_entries/flow/${id}`, { method: 'POST', body: req.body?.input || {} }))); }
  catch (err) { flowErr(res, err); }
});
app.delete('/api/setup/ha/flow/:id', async (req, res) => {
  try { await haCall(`/api/config/config_entries/flow/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' }); } catch { /* already gone */ }
  res.json({ ok: true });
});
/* Integrations whose sign-in only Home Assistant can show (Google, Yale): a
   link straight to that integration's setup in Home Assistant. */
app.get('/api/setup/ha/link', (req, res) => {
  if (!draft.ha) return res.status(409).json({ error: 'connect Home Assistant first' });
  const d = String(req.query.domain || '').replace(/[^a-z0-9_]/g, '');
  res.json({ url: `${draft.ha.url}/_my_redirect/config_flow_start?domain=${d}` });
});
app.get('/api/setup/ha/domains', async (_req, res) => {
  try { res.json({ domains: [...new Set((await haCall('/api/config/config_entries/entry') || []).map((e) => e.domain))] }); }
  catch (err) { flowErr(res, err); }
});

/* ---- finish ---- */
/* Answers as saved: the wizard's own bookkeeping (keys starting with _) is dropped. */
const strip = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, strip(v)])) : o);
const hashSecret = (s) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(s), salt, 32).toString('hex')}`; };
/* Run again from Settings: the wizard starts from what is saved (never passwords or keys). */
const DIRECT_KINDS = new Set(['frigate', 'reolink-local', 'snapshot', 'ring-labs', 'hue-local', 'shelly-local', 'yolink-cloud', 'meraki-mv', 'meraki-mt']);
const haKinds = (k) => (Array.isArray(k) ? k.filter((x) => !DIRECT_KINDS.has(x)) : []);
app.get('/api/setup/current', async (_req, res) => {
  if (!isConfigured() || isDemo()) return res.json({ answers: null });
  const c = config;
  let ha = null;
  if (c.homeAssistant?.url) {   // already connected: carry it into this run without asking for the token again
    draft.ha = { ...c.homeAssistant };
    const entries = await haCall('/api/config/config_entries/entry').catch(() => null);
    ha = { ok: true, message: entries ? `Connected to Home Assistant at ${c.homeAssistant.url}` : `Saved: ${c.homeAssistant.url} (not answering right now)`, domains: [...new Set((entries || []).map((e) => e.domain))] };
  }
  const NEWS_IDS = new Set(NEWS_DEFAULTS.map((f) => f.url));
  res.json({ rerun: true, ha, answers: {
    house: { ...(c.house || {}), location: c.location || null },
    homeassistant: c.homeAssistant?.url ? { uses: 'yes', url: c.homeAssistant.url } : { uses: 'no' },
    account: { username: users.list.find((x) => x.role === 'owner')?.username || c.signIn?.username || 'admin' },
    calendars: { mine: c.myCalendar === false ? 'no' : 'yes', list: (c.calendars || []).map(({ name, url, color }) => ({ name, url, color })) },
    sports: { teams: c.sports?.teams || [] },
    news: { picks: NEWS_DEFAULTS.filter((f) => (c.news?.feeds || []).some((x) => x.url === f.url)).map((f) => f.id), custom: (c.news?.feeds || []).filter((x) => !NEWS_IDS.has(x.url)) },
    reminders: { list: c.reminders || [] },
    // gear: Home Assistant picks come back ticked; direct gear is kept as is unless set up again here
    cameras: c.cameraPrefs || (c.cameras || []).length ? { has: 'yes', kinds: haKinds(c.cameraPrefs?.kinds), detect: c.cameraPrefs?.detection === false ? 'no' : 'yes' } : { has: 'no' },
    controls: c.controls || c.hue || (c.shelly || []).length ? { has: 'yes', kinds: haKinds(c.controls?.kinds) } : { has: 'no' },
    sensors: c.sensors?.kinds || c.yolink ? { has: 'yes', kinds: haKinds(c.sensors?.kinds), alertOn: c.sensors?.alertOn || ['leak', 'smoke', 'battery'] } : { has: 'no' },
    network: { kind: c.network?.provider || undefined, speedtest: c.network?.speedtest === false ? 'no' : 'yes' },
    energy: c.energy ? { track: 'yes', utility: c.energy.utility || 'other', rate: c.energy.ratePerKwh ?? '', budget: c.energy.budget ?? '' } : {},
    alerts: { quiet: c.alerts?.quietHours || '22-7' },
  }, keeps: { homeAssistant: !!c.homeAssistant, hue: !!c.hue, shelly: (c.shelly || []).length, yolink: !!c.yolink, cameras: (c.cameras || []).length, ring: !!c.ring, license: !!c.license } });
});
app.post('/api/setup/finish', (req, res) => {
  const raw = req.body?.answers || {};
  const a = strip(raw);
  const prev = isDemo() ? {} : config;   // run again: anything not answered now is kept
  const acct = a.account || {};
  ensureUsers();
  const owner = users.list.find((x) => x.role === 'owner');
  // Running setup again never changes the owner's password unless the owner is the one doing it.
  if (isConfigured() && owner?.password && acct.password && req.setupUser && req.setupUser.id !== owner.id) delete acct.password;
  const keepPw = !acct.password && !!owner?.password;
  if (!acct.username || !/^[a-zA-Z0-9._@-]{3,40}$/.test(String(acct.username))) return res.status(400).json({ error: 'pick a username: 3-40 letters, numbers, dots or dashes' });
  if (!keepPw) { const pwErr = passwordProblem(acct.password, acct.username); if (pwErr) return res.status(400).json({ error: pwErr }); }
  if (acct.terms !== true && owner?.terms?.version !== TERMS_VERSION) return res.status(400).json({ error: 'please read and accept the Terms of Use and Privacy Notice' });
  if (acct.license && !checkLicenseKey(acct.license).valid) return res.status(400).json({ error: `license key: ${checkLicenseKey(acct.license).why}` });
  const picked = (step) => (a[step]?.has === 'yes' || a[step]?.track === 'yes' ? (Array.isArray(a[step].kinds) ? a[step].kinds : []) : []);
  const opt = (step, id) => (picked(step).includes(id) ? a[step][id] || {} : null);
  // devices that work without Home Assistant
  const cams = [];
  const fr = opt('cameras', 'frigate');
  if (fr?.url) for (const cam of (Array.isArray(raw.cameras?.frigate?._test?.cameras) ? raw.cameras.frigate._test.cameras : [])) cams.push({ id: `frigate-${cam}`, name: cam.replace(/[_-]+/g, ' ').replace(/^\w/, (x) => x.toUpperCase()), type: 'frigate', url: String(fr.url).replace(/\/+$/, ''), camera: cam });
  const rl = opt('cameras', 'reolink-local');
  if (rl?.host) cams.push({ id: 'reolink-1', name: rl.name || 'Reolink camera', type: 'reolink', host: String(rl.host).trim(), username: rl.username || 'admin', password: rl.password || '', channel: Number(rl.channel) || 0 });
  const sn = opt('cameras', 'snapshot');
  if (sn?.snapshotUrl) cams.push({ id: 'camera-1', name: sn.name || 'Camera', type: 'snapshot', snapshotUrl: sn.snapshotUrl, username: sn.username || null, password: sn.password || null });
  const shellyHosts = [...new Set(['controls', 'sensors', 'energy'].flatMap((st) => String(opt(st, 'shelly-local')?.hosts || '').split(/[\s,]+/)).filter(Boolean))];
  const yl = opt('controls', 'yolink-cloud')?.uaid ? opt('controls', 'yolink-cloud') : opt('sensors', 'yolink-cloud');
  const feeds = [...NEWS_DEFAULTS.filter((f) => (a.news?.picks || []).includes(f.id)).map(({ name, url }) => ({ name, url })), ...(a.news?.custom || []).filter((f) => f?.url).map((f) => ({ name: f.name || f.url, url: f.url }))];
  const usesHa = a.homeassistant?.uses === 'yes';
  const next = {
    ...prev, version: 2, demo: undefined, setupAt: prev.setupAt || nowIso(), port: PORT,
    house: { name: a.house?.name || 'My House', timezone: a.house?.timezone || 'UTC', units: a.house?.units || 'F', currency: a.house?.currency || 'USD', lang: ['en', 'es', 'de', 'fr', 'pt', 'it', 'nl'].includes(a.house?.lang) ? a.house.lang : 'en' },
    location: a.house?.location?.lat != null ? { name: a.house.location.name || null, lat: Number(a.house.location.lat), lon: Number(a.house.location.lon) } : prev.location || null,
    signIn: { enabled: true },
    license: acct.license || prev.license || undefined,
    myCalendar: a.calendars?.mine !== 'no',
    calendars: (a.calendars?.list || []).filter((c) => c?.url).map((c) => ({ name: c.name || 'Calendar', url: String(c.url).trim(), color: c.color || '#60a5fa' })),
    sports: { teams: (a.sports?.teams || []).slice(0, 30) },
    news: { feeds },
    reminders: (a.reminders?.list || []).filter((r) => r?.title).map((r) => ({ title: r.title, days: Array.isArray(r.days) ? r.days.map(Number) : null, time: r.time || null })),
    homeAssistant: draft.ha && usesHa ? { url: draft.ha.url, token: draft.ha.token } : usesHa ? prev.homeAssistant || null : null,
    // Cameras set up again in this run replace that kind (Frigate, Reolink, snapshot); the other kinds stay as they were.
    cameras: [...(prev.cameras || []).filter((c) => !cams.some((n) => n.type === c.type)), ...cams],
    cameraPrefs: a.cameras?.has === 'yes' ? { kinds: picked('cameras'), detection: a.cameras.detect !== 'no' } : null,
    hue: draft.hue || prev.hue || null,
    shelly: shellyHosts.length ? shellyHosts.map((host) => ({ host })) : prev.shelly || [],
    yolink: yl?.uaid ? { uaid: String(yl.uaid).trim(), secret: String(yl.secret || '').trim() } : prev.yolink || null,
    ring: draft.ring || prev.ring || undefined,
    controls: a.controls?.has === 'yes' ? { kinds: picked('controls') } : null,
    sensors: a.sensors?.has === 'yes' ? { kinds: picked('sensors'), alertOn: a.sensors.alertOn || [] } : { alertOn: ['leak', 'smoke', 'battery'] },
    network: { provider: a.network?.kind || 'other', meraki: a.network?.meraki || a.cameras?.['meraki-mv'] || a.sensors?.['meraki-mt'] || null, unifi: a.network?.unifi || null,
      dns: a.network?.dns && a.network.dns !== 'none' ? { kind: a.network.dns, url: a.network.dnsUrl || null, key: a.network.dnsKey || null } : null, speedtest: a.network?.speedtest !== 'no' },
    energy: a.energy?.track === 'yes' ? { utility: a.energy.utility && a.energy.utility !== 'other' ? a.energy.utility : null, ratePerKwh: Number(a.energy.rate) || null, budget: Number(a.energy.budget) || null, kinds: picked('energy') } : null,
    alerts: { phone: a.alerts?.phone === 'ha' && usesHa ? 'homeassistant' : null, quietHours: a.alerts?.quiet || '22-7' },
    addedToHomeAssistant: [...(prev.addedToHomeAssistant || []), ...(Array.isArray(raw._added) ? raw._added.slice(0, 50).map((x) => ({ domain: String(x.domain), title: String(x.title) })) : [])],
  };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  try { saveConfig(next); } catch (err) { return res.status(500).json({ error: `could not save the settings: ${err.message}` }); }
  if (typeof nudgesFromSetup === 'function') nudgesFromSetup(next.reminders);
  if (!isDemo()) authSetOwner({ username: acct.username, passwordHash: keepPw ? null : hashSecret(acct.password), acceptedTerms: acct.terms === true });
  setupReopened = 0; draft.ring = null; draft.hue = null;
  if (next.ring && typeof ringConnect === 'function' && proStatus().pro) ringConnect();
  console.log(`  setup: done for "${next.house.name}"`);
  res.json({ ok: true });
});
app.post('/api/setup/demo', (_req, res) => {
  if (isConfigured() && !isDemo()) return res.status(403).json({ error: 'already set up' });
  saveConfig({ demo: true }); res.json({ ok: true });
});
