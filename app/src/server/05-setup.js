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
/* ---- progress: every answer is kept as you go, so a refresh, a closed tab, a crash or a power cut picks up at the same
   step. Kept sealed (AES-256-GCM, like config.json) in data/setup-progress.json; sign-in passwords are never kept (they're
   asked again), and the file is deleted when setup finishes. What setup has proven (Home Assistant, Hue, Ring) comes back too. */
const PROGRESS_FILE = path.join(DATA_DIR, 'setup-progress.json');
const PROGRESS_DAYS = 30;
const dropSignInPasswords = (a) => { const o = JSON.parse(JSON.stringify(a || {})); for (const k of ['account', 'phone']) if (o[k]) { delete o[k].password; delete o[k].password2; } return o; };
function progressRead() {
  try {
    const p = JSON.parse(unseal(fs.readFileSync(PROGRESS_FILE, 'utf8').trim()) || 'null');
    if (!p || Date.now() - Date.parse(p.at) > (p.rerun ? 1 : PROGRESS_DAYS) * 86400_000) return null;   // changing an existing setup: kept for a day
    return p;
  } catch { return null; }
}
function progressWrite(p) { writeFileSafe(PROGRESS_FILE, seal(JSON.stringify(p)), 0o600); }
const progressClear = () => { try { fs.rmSync(PROGRESS_FILE, { force: true }); } catch { /* gone */ } };
/* Started again after a crash or power cut: what setup had proven is still there. */
{ const p = !isDemo() && progressRead(); if (p?.draft) { if (p.draft.ha?.url && p.draft.ha?.token) draft.ha = p.draft.ha; if (p.draft.hue?.username) draft.hue = p.draft.hue; if (p.draft.ring?.refreshToken) draft.ring = p.draft.ring; } }
app.get('/api/setup/progress', (_req, res) => {
  const p = progressRead(); if (!p) return res.json({ progress: null });
  if (!draft.ha && p.draft?.ha?.url) draft.ha = p.draft.ha;   // proven earlier in this run
  if (!draft.hue && p.draft?.hue?.username) draft.hue = p.draft.hue;
  res.json({ progress: { at: p.at, rerun: !!p.rerun, i: p.i, max: p.max, answers: p.answers, added: p.added || [], focus: p.focus || null, ui: p.ui || {}, haOk: !!draft.ha } });
});
app.put('/api/setup/progress', (req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true });
  const b = req.body || {};
  if (!b.answers || typeof b.answers !== 'object') return res.status(400).json({ error: 'nothing to keep' });
  try {
    progressWrite({ at: nowIso(), rerun: isConfigured(), i: Math.max(0, Math.min(99, Number(b.i) || 0)), max: Math.max(0, Math.min(99, Number(b.max) || 0)), answers: dropSignInPasswords(b.answers), added: Array.isArray(b.added) ? b.added.slice(0, 50) : [], focus: b.focus || null, ui: b.ui && typeof b.ui === 'object' ? b.ui : {}, draft: { ha: draft.ha, hue: draft.hue, ring: draft.ring } });
    res.json({ ok: true });
  } catch (err) { res.status(507).json({ error: `Couldn't keep your answers: ${err.code === 'ENOSPC' ? 'the disk is full' : err.message}` }); }
});
app.delete('/api/setup/progress', (_req, res) => { progressClear(); res.json({ ok: true }); });
app.get('/api/setup/state', (_req, res) => res.json({ open: setupOpen(), configured: isConfigured(), demo: isDemo(), ha: draft.ha ? { url: draft.ha.url, version: draft.ha.version } : null }));
app.get('/api/setup/catalog', (_req, res) => res.type('json').send(fs.readFileSync(SETUP_CATALOG)));   // sent (not streamed) so it's compressed: 44 KB becomes about 8

/* ---- talking to things ---- */
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
const badUrl = (u) => !/^https?:\/\/[^\s/]+/i.test(u);
/** fetch that also accepts the self-signed certificates home gear ships with (UniFi, OPNsense) - but only for
 *  addresses on the home network (isLanHost, 74-network.js). An internet address must have a real certificate. */
const lanHttps = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && isLanHost(u.hostname); } catch { return false; } };
function getJson(url, { headers = {}, method = 'GET', body, insecure = false, timeout = 10000 } = {}) {
  if (!insecure || !lanHttps(url)) {
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
/* One plain sentence for what went wrong, and one for the fix (05b-setup-net.js). */
const why = (err, ctx = {}) => { const f = friendlyError(err, ctx); return f.fix ? `${f.error} ${f.fix}` : f.error; };

const TESTS = {
  /* Home Assistant: the token must work AND be an admin's, or adding integrations will fail later. The address is
     forgiving: "homeassistant.local", "192.168.1.20" or a pasted dashboard link all find it (05b-setup-net.js). */
  async homeassistant({ url, token }) {
    const base = await haPickUrl(url);
    const tok = cleanToken(token);
    if (!tok) throw userErr('Paste the access token, or use "Sign in with Home Assistant" above.');
    if (tok.length < 40) throw userErr('That token looks too short. A Home Assistant token is a long code (about 180 characters) with two dots in it.', 'In Home Assistant: your profile > Security > Long-lived access tokens > Create token, then copy all of it.');
    const H = { Authorization: `Bearer ${tok}` };
    let cfg;
    try { cfg = await withRetry(() => getJson(`${base.url}/api/config`, { headers: H })); }
    catch (err) {
      if (err.status === 401 || err.status === 403) {
        const exp = jwtInfo(tok)?.exp;
        if (exp && exp * 1000 < Date.now()) throw userErr(`That token expired on ${new Date(exp * 1000).toISOString().slice(0, 10)}.`, 'Make a new long-lived token in Home Assistant (your profile > Security) and paste it - or use "Sign in with Home Assistant", which makes one for you.');
      }
      throw err;
    }
    let entries = [];
    try { entries = await withRetry(() => getJson(`${base.url}/api/config/config_entries/entry`, { headers: H })); }
    catch (err) { if (err.status === 401 || err.status === 403) throw userErr('The token works, but its user is not an administrator - CasaTorch needs an admin token to add integrations.', 'Sign in with an administrator account, or turn on "Administrator" for that user in Home Assistant (Settings > People).'); }
    draft.ha = { url: base.url, token: tok, version: cfg?.version || null };
    const domains = [...new Set((entries || []).map((e) => e.domain))];
    return { ok: true, message: `Connected to Home Assistant ${cfg?.version || ''} at "${cfg?.location_name || 'Home'}"`, version: cfg?.version, timeZone: cfg?.time_zone, units: cfg?.unit_system?.temperature, domains, url: base.url, ...(base.url !== String(url || '').trim() ? { fixed: { url: base.url } } : {}), ...(base.warning ? { warning: base.warning } : {}) };
  },
  frigate: (b) => frigateTest(b),   // 29f-frigate.js
  /* The Home AI Agent: the key (or address) works, and which model to use. */
  async ai({ provider, apiKey, url }) {
    const p = aiOf(provider); if (!p) throw new Error('pick an AI');
    const models = await p.models({ provider, apiKey: String(apiKey || '').trim() || null, url: url ? String(url).trim() : null });
    const model = p.pick(models) || models?.[0];
    if (!model) throw new Error('it answered, but has no models to use');
    return { ok: true, model, message: `Connected - your Home AI Agent will use ${model}` };
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
app.get('/api/setup/ha/find', async (_req, res) => {
  if (process.env.SUPERVISOR_TOKEN) return res.json({ url: SUPERVISOR_HA, all: [SUPERVISOR_HA] });
  const all = await DISCOVERERS.homeassistant().catch(() => []);   // what it announces on the network (mDNS), then the usual names
  res.json({ url: all[0] || null, all });
});
/* Everything setup can find by itself, to fill in (05b-setup-net.js). */
app.get('/api/setup/discover', async (req, res) => res.json(await discoverAll(req.query.fresh === '1')));
const haSignins = new Map();   // state -> { url, origin, exp }
app.post('/api/setup/ha/signin', async (req, res) => {
  let url;
  try { url = (await haPickUrl(req.body?.url)).url; }
  catch (err) { const f = friendlyError(err, { what: 'Home Assistant', url: err.triedUrl || '' }); return res.status(400).json({ error: f.fix ? `${f.error} ${f.fix}` : f.error, msg: f.msg, fixMsg: f.fixMsg, vars: f.vars }); }
  const origin = `${req.protocol}://${req.headers.host}`, state = crypto.randomBytes(18).toString('base64url');
  for (const [k, v] of haSignins) if (v.exp < Date.now()) haSignins.delete(k);
  haSignins.set(state, { url, origin, exp: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({ response_type: 'code', client_id: `${origin}/`, redirect_uri: `${origin}/api/setup/ha/callback`, state });
  res.json({ go: `${url}/auth/authorize?${q}`, url });
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
  const tidy = tidyTestBody(req.params.kind, req.body || {});   // "homeassistant.local" -> http://homeassistant.local:8123 and the like
  if (tidy.error) return res.json({ ok: false, error: tidy.error });
  const fixed = Object.keys(tidy.fixed).length ? { fixed: tidy.fixed } : {};
  try { const r = await withRetry(() => t(tidy.body)); res.json({ ...fixed, ...r, ...(r.fixed || fixed.fixed ? { fixed: { ...fixed.fixed, ...r.fixed } } : {}) }); }   // a blip is tried again before anyone sees it
  catch (err) {
    const f = friendlyError(err, { what: TEST_NAMES[req.params.kind] || 'it', url: err.triedUrl || tidy.body.url || tidy.body.dnsUrl || tidy.body.snapshotUrl || '' });
    if (req.params.kind === 'homeassistant' && err.triedUrl && err.triedUrl !== String(tidy.body.url || '').trim()) fixed.fixed = { url: err.triedUrl };   // show the address as tried
    res.json({ ok: false, error: f.error, fix: f.fix, msg: f.msg, fixMsg: f.fixMsg, vars: f.vars, ...fixed });
  }
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
    news: { picks: [...(c.news?.feeds || []).map((x) => x.gid).filter(Boolean), ...NEWS_DEFAULTS.filter((f) => (c.news?.feeds || []).some((x) => x.url === f.url)).map((f) => f.id)], custom: (c.news?.feeds || []).filter((x) => !x.gid && !NEWS_IDS.has(x.url)) },
    reminders: { list: [], have: typeof ng === 'object' ? ng.list.length : 0 },   // existing ones are changed on the Reminders page; new ones here are added
    // gear: Home Assistant picks come back ticked; direct gear is kept as is unless set up again here
    cameras: c.cameraPrefs || (c.cameras || []).length ? { has: 'yes', kinds: haKinds(c.cameraPrefs?.kinds), detect: c.cameraPrefs?.detection === false ? 'no' : 'yes' } : { has: 'no' },
    controls: c.controls || c.hue || (c.shelly || []).length ? { has: 'yes', kinds: haKinds(c.controls?.kinds) } : { has: 'no' },
    sensors: c.sensors?.kinds || c.yolink ? { has: 'yes', kinds: haKinds(c.sensors?.kinds), alertOn: c.sensors?.alertOn || ['leak', 'smoke', 'battery'] } : { has: 'no' },
    network: { kind: c.network?.provider || undefined, speedtest: c.network?.speedtest === false ? 'no' : 'yes' },
    energy: c.energy ? { track: 'yes', utility: c.energy.utility || 'other', rate: c.energy.ratePerKwh ?? '', budget: c.energy.budget ?? '', kinds: haKinds(c.energy.kinds) } : {},
    alerts: { quiet: c.alerts?.quietHours || '22-7', phone: c.alerts?.phone === 'homeassistant' ? 'ha' : 'no' },   // as saved - not the default
  }, keeps: { homeAssistant: !!c.homeAssistant, hue: !!c.hue, shelly: (c.shelly || []).length, yolink: !!c.yolink, cameras: (c.cameras || []).length, ring: !!c.ring, license: !!c.license } });
});
/* Finish can only run once at a time (a double tap, or a retry while the first is still saving). */
let setupFinishing = false;
app.post('/api/setup/finish', async (req, res) => {
  if (setupFinishing) return res.status(409).json({ error: 'Already saving - one moment.', busy: true });
  setupFinishing = true;
  try { await setupFinish(req, res); } finally { setupFinishing = false; }
});
async function setupFinish(req, res) {
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
  // The phone's own login (setup's "Your phone" step): checked now, made after the owner.
  const ph = a.phone?.how === 'new' ? a.phone : null;
  if (ph) {
    if (!/^[a-zA-Z0-9._@-]{3,40}$/.test(String(ph.username || ''))) return res.status(400).json({ error: 'your phone login: pick a username - 3-40 letters, numbers, dots or dashes' });
    if (String(ph.username).trim().toLowerCase() === String(acct.username).trim().toLowerCase()) return res.status(400).json({ error: 'your phone login needs a different username from the owner login' });
    const e = passwordProblem(ph.password, ph.username); if (e) return res.status(400).json({ error: `your phone login: ${e}` });
  }
  if (acct.terms !== true && owner?.terms?.version !== TERMS_VERSION) return res.status(400).json({ error: 'please read and accept the Terms of Use and Privacy Notice' });
  if (acct.license && !checkLicenseKey(acct.license).valid) return res.status(400).json({ error: `license key: ${checkLicenseKey(acct.license).why}` });
  const picked = (step) => (a[step]?.has === 'yes' || a[step]?.track === 'yes' ? (Array.isArray(a[step].kinds) ? a[step].kinds : []) : []);
  const opt = (step, id) => (picked(step).includes(id) ? a[step][id] || {} : null);
  // devices that work without Home Assistant
  const cams = [];
  const fr = opt('cameras', 'frigate');
  const frT = raw.cameras?.frigate?._test || {};
  // Frigate's own certificate is kept only when the test trusted it - its public part (to pin it) and its fingerprint.
  const frPin = frT.ok && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(String(frT.fingerprint || '')) && /^-----BEGIN CERTIFICATE-----[\sA-Za-z0-9+/=]+-----END CERTIFICATE-----\s*$/.test(String(frT.ca || '')) ? { fingerprint: frT.fingerprint, ca: frT.ca } : {};
  if (fr?.url) for (const cam of (Array.isArray(frT.cameras) ? frT.cameras : []).filter((x) => /^[\w.-]{1,64}$/.test(String(x)))) cams.push({ id: `frigate-${cam}`, name: cam.replace(/[_-]+/g, ' ').replace(/^\w/, (x) => x.toUpperCase()), type: 'frigate', url: String(fr.url).trim().replace(/\/+$/, ''), camera: cam, ...(fr.user ? { user: String(fr.user).trim(), password: String(fr.password || '') } : {}), ...frPin });
  const rl = opt('cameras', 'reolink-local');
  if (rl?.host) cams.push({ id: 'reolink-1', name: rl.name || 'Reolink camera', type: 'reolink', host: String(rl.host).trim(), username: rl.username || 'admin', password: rl.password || '', channel: Number(rl.channel) || 0 });
  const sn = opt('cameras', 'snapshot');
  if (sn?.snapshotUrl) cams.push({ id: 'camera-1', name: sn.name || 'Camera', type: 'snapshot', snapshotUrl: sn.snapshotUrl, username: sn.username || null, password: sn.password || null });
  const shellyHosts = [...new Set(['controls', 'sensors', 'energy'].flatMap((st) => String(opt(st, 'shelly-local')?.hosts || '').split(/[\s,]+/)).filter(Boolean))];
  const yl = opt('controls', 'yolink-cloud')?.uaid ? opt('controls', 'yolink-cloud') : opt('sensors', 'yolink-cloud');
  const gnCtx = { town: homeTown(a.house?.location), cc: homeCountry(a.house?.location) || 'US', lang: a.house?.lang || 'en' };
  const feeds = [...(a.news?.picks || []).filter((id) => /^gn-/.test(id)).map((id) => { const f = gnFeed(id, gnCtx); return f ? { ...f, gid: id } : null; }).filter(Boolean),
    ...NEWS_DEFAULTS.filter((f) => (a.news?.picks || []).includes(f.id)).map(({ name, url }) => ({ name, url })), ...(a.news?.custom || []).filter((f) => f?.url).map((f) => ({ name: f.name || f.url, url: f.url }))];
  const usesHa = a.homeassistant?.uses === 'yes';
  const next = {
    ...prev, version: 2, demo: undefined, setupAt: prev.setupAt || nowIso(), port: PORT,
    house: { name: a.house?.name || 'My House', timezone: a.house?.timezone || 'UTC', units: a.house?.units || 'F', currency: a.house?.currency || 'USD', lang: ['en', 'es', 'de', 'fr', 'pt', 'it', 'nl', 'ja', 'zh', 'ko', 'hi', 'pl', 'sv', 'tr'].includes(a.house?.lang) ? a.house.lang : 'en' },
    location: a.house?.location?.lat != null ? { name: a.house.location.name || null, ...(/^[A-Z]{2}$/.test(String(a.house.location.cc || '')) ? { cc: a.house.location.cc } : {}), lat: Number(a.house.location.lat), lon: Number(a.house.location.lon) } : prev.location || null,
    signIn: { enabled: true },
    license: acct.license || prev.license || undefined,
    myCalendar: a.calendars?.mine !== 'no',
    calendars: (a.calendars?.list || []).filter((c) => c?.url).map((c) => ({ name: c.name || 'Calendar', url: String(c.url).trim(), color: c.color || '#60a5fa' })),
    sports: { teams: (a.sports?.teams || []).slice(0, 30) },
    news: { feeds },
    reminders: undefined,   // one list now: Reminders (78-nudges.js)
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
    // Running setup again keeps what wasn't asked about this time (the UniFi console, the DNS blocker).
    network: { provider: a.network?.kind || 'other', meraki: a.network?.meraki || a.cameras?.['meraki-mv'] || a.sensors?.['meraki-mt'] || null,
      unifi: a.network?.unifi?.apiKey ? a.network.unifi : (a.network?.kind || 'other') === (prev.network?.provider || 'other') ? prev.network?.unifi || null : null,
      dns: a.network?.dns === undefined || (a.network.dns === prev.network?.dns?.kind && !a.network.dnsUrl) ? prev.network?.dns || null : a.network.dns && a.network.dns !== 'none' ? { kind: a.network.dns, url: a.network.dnsUrl || null, key: a.network.dnsKey || null } : null, speedtest: a.network?.speedtest !== 'no' },
    energy: a.energy?.track === 'yes' ? { utility: a.energy.utility && a.energy.utility !== 'other' ? a.energy.utility : null, ratePerKwh: Number(a.energy.rate) || null, budget: Number(a.energy.budget) || null, kinds: picked('energy') } : null,
    ai: aiOf(a.ai?.provider) && raw.ai?._test?.ok && raw.ai._test.model ? { provider: a.ai.provider, model: String(raw.ai._test.model).slice(0, 120), url: a.ai.url ? String(a.ai.url).trim() : null, apiKey: a.ai.apiKey ? String(a.ai.apiKey).trim() : null } : prev.ai || undefined,
    alerts: { phone: a.alerts?.phone === 'ha' && usesHa ? 'homeassistant' : null, quietHours: a.alerts?.quiet || '22-7' },
    // each integration once, however many times setup runs
    addedToHomeAssistant: [...new Map([...(prev.addedToHomeAssistant || []), ...(Array.isArray(raw._added) ? raw._added.slice(0, 50).map((x) => ({ domain: String(x.domain), title: String(x.title) })) : [])].map((x) => [`${x.domain}|${x.title}`, x])).values()].slice(-100),
  };
  // Network monitoring keys entered in setup become Network sources (the same as adding them in the Network tab).
  const mer = [a.network?.kind === 'meraki' && a.network?.meraki, opt('cameras', 'meraki-mv'), opt('sensors', 'meraki-mt')].find((x) => x?.apiKey);
  const uni = a.network?.kind === 'unifi' && a.network?.unifi?.apiKey && a.network.unifi.url ? a.network.unifi : null;
  const srcs = (prev.network?.sources || []).filter((x) => !(mer && x.kind === 'meraki') && !(uni && x.kind === 'unifi'));
  if (mer) srcs.push({ id: crypto.randomBytes(5).toString('hex'), kind: 'meraki', name: 'Cisco Meraki', region: 'us', ...(/^[\w-]+\//.test(String(mer.network || '')) ? { org: String(mer.network).split('/')[0] } : {}), secret: String(mer.apiKey).trim() });
  if (uni) { try { const u = new URL(String(uni.url).trim()); srcs.push({ id: crypto.randomBytes(5).toString('hex'), kind: 'unifi', name: 'UniFi', url: `${u.protocol}//${u.host}`, ...(uni.site ? { site: String(uni.site) } : {}), secret: String(uni.apiKey).trim() }); } catch { /* not an address */ } }
  next.network.sources = srcs.slice(0, 10);
  if (mer) next.network.meraki = null;   // the key lives in its source now (sealed there)
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  if (isConfigured() && !isDemo() && typeof settingsSnapshot === 'function') settingsSnapshot('before-setup-change');   // Settings › Health can put it back
  try { saveConfig(next); } catch (err) { return res.status(500).json({ error: err.code === 'ENOSPC' ? 'The disk is full, so your settings couldn\'t be saved. Free some space (Settings › Health shows how), then press Finish again - your answers are kept.' : err.code === 'EACCES' || err.code === 'EROFS' || err.code === 'EPERM' ? 'CasaTorch isn\'t allowed to save in its data folder. Check the folder\'s permissions (or the NAS share), then press Finish again - your answers are kept.' : `could not save the settings: ${err.message}` }); }
  progressClear();
  if (!isDemo() && typeof settingsSnapshot === 'function') settingsSnapshot('after-setup');
  if (typeof nudgesFromSetup === 'function') nudgesFromSetup((a.reminders?.list || []).filter((r) => r?.title).map((r) => ({ title: r.title, days: Array.isArray(r.days) ? r.days.map(Number) : null, time: r.time || null, icon: r.icon, sound: r.sound })));
  if (!isDemo()) authSetOwner({ username: acct.username, passwordHash: keepPw ? null : hashSecret(acct.password), acceptedTerms: acct.terms === true });
  let pair = null;
  if (!isDemo() && ['new', 'owner'].includes(a.phone?.how)) {
    const who = ph ? authAddUser({ username: ph.username, passwordHash: hashSecret(ph.password), name: ph.name || `${String(ph.username)}`, role: 'admin', acceptedTerms: acct.terms === true }) : users.list.find((x) => x.role === 'owner');
    try { if (who && typeof makePairCode === 'function') pair = await makePairCode(req, who, 30); } catch { /* pair later in Settings › Phones & alerts */ }
  }
  // "Use the app away from home": secure access, switched on in the background (it can take a minute)
  if (!isDemo() && ['new', 'owner'].includes(a.phone?.how) && a.phone?.away !== 'no' && !config.remote?.on && typeof remoteOn === 'function') remoteOn().catch((e) => { if (typeof remote === 'object') { remote.state = 'error'; remote.why = String(e.message); } });
  setupReopened = 0; draft.ring = null; draft.hue = null;
  if (next.ring && typeof ringConnect === 'function' && proStatus().pro) ringConnect();
  console.log(`  setup: done for "${next.house.name}"`);
  res.json({ ok: true, ...(pair ? { pair } : {}) });
}
app.post('/api/setup/demo', (_req, res) => {
  if (isConfigured() && !isDemo()) return res.status(403).json({ error: 'already set up' });
  saveConfig({ demo: true }); res.json({ ok: true });
});
