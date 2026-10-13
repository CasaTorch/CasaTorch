/* ======================================================================
 * Setup wizard - the server side (the screens are public/setup.html).
 *
 * The questions and the supported gear live in catalog/setup.json. This file
 * answers four kinds of request while setup is open:
 *
 *   tests        "is this address and key right?" for Home Assistant, Frigate,
 *                Meraki, UniFi, Pi-hole, AdGuard - before anything is saved.
 *   HA flows     adding an integration to Home Assistant the way its own UI
 *                does: HouseOS starts the integration's config flow, shows the
 *                questions Home Assistant asks (its own field list - e.g. the
 *                power companies Opower supports), and passes the answers back.
 *                Passwords typed into these go to Home Assistant only; HouseOS
 *                never writes them anywhere.
 *   agent        a token + install command for each server HouseOS watches.
 *   finish       writes data/config.json (owner-only) and closes the wizard.
 *
 * Open only while HouseOS is not set up (or HOUSEOS_SETUP=1). Once finished,
 * every /api/setup route answers 403.
 * ====================================================================== */
const SETUP_CATALOG = path.join(APP_DIR, 'catalog', 'setup.json');
const setupOpen = () => !isConfigured() || isDemo() || process.env.HOUSEOS_SETUP === '1';
const draft = { ha: null, agents: {} };   // what the wizard has proven so far (memory only)

app.use('/api/setup', express.json({ limit: '64kb' }), (req, res, next) => {
  if (req.path === '/state') return next();
  if (!setupOpen()) return res.status(403).json({ error: 'HouseOS is already set up. Start it with HOUSEOS_SETUP=1 to run setup again.' });
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
  return new Promise((ok, fail) => {
    const req = https.request(url, { method, headers: { Accept: 'application/json', ...headers }, rejectUnauthorized: false, timeout }, (r) => {
      let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } r.statusCode < 300 ? ok(j) : fail(Object.assign(new Error(j?.message || `HTTP ${r.statusCode}`), { status: r.statusCode })); });
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
    catch (err) { if (err.status === 401 || err.status === 403) throw new Error('the token works, but its user is not an administrator - HouseOS needs an admin token to add integrations'); }
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
    return { ok: true, message: `Frigate ${(await r.text()).trim()}${cams.length ? ` with ${cams.length} camera${cams.length === 1 ? '' : 's'}: ${cams.join(', ')}` : ''}` };
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
app.post('/api/setup/test/:kind', async (req, res) => {
  const t = TESTS[req.params.kind];
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

/* ---- the server agent: a token per server, and the command that installs it ---- */
app.post('/api/setup/agent', (req, res) => {
  const address = String(req.body?.address || '').trim();
  if (!/^[\w.-]{1,253}$/.test(address)) return res.status(400).json({ error: 'enter the server\'s IP address or name' });
  const token = draft.agents[address] ||= crypto.randomBytes(24).toString('base64url');
  res.json({ token, command: `docker run -d --name houseos-agent --restart unless-stopped --network host --pid host -v /var/run/docker.sock:/var/run/docker.sock:ro -v /:/host:ro -e HOUSEOS_MODE=agent -e HOUSEOS_AGENT_TOKEN=${token} ghcr.io/houseos/houseos:latest` });
});

/* ---- finish ---- */
/* Answers as saved: the wizard's own bookkeeping (keys starting with _) is dropped. */
const strip = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, strip(v)])) : o);
const hashSecret = (s) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(s), salt, 32).toString('hex')}`; };
app.post('/api/setup/finish', (req, res) => {
  const raw = req.body?.answers || {};
  const a = strip(raw);
  const acct = a.account || {};
  if (!acct.username || String(acct.password || '').length < 8) return res.status(400).json({ error: 'a username and a password of 8+ characters are needed' });
  if (acct.pin && !/^\d{4,8}$/.test(String(acct.pin))) return res.status(400).json({ error: 'the PIN is 4 to 8 digits' });
  const pickId = (step) => (Array.isArray(step?.kinds) ? step.kinds : []);
  const next = {
    version: 1, setupAt: nowIso(), port: PORT,
    house: { name: a.house?.name || 'My House', timezone: a.house?.timezone || 'UTC', units: a.house?.units || 'F', currency: a.house?.currency || 'USD' },
    signIn: { enabled: true, username: String(acct.username), password: hashSecret(acct.password), pin: acct.pin ? hashSecret(acct.pin) : null },
    homeAssistant: draft.ha && a.homeassistant?.uses === 'yes' ? { url: draft.ha.url, token: draft.ha.token } : null,
    cameras: a.cameras?.has === 'yes' ? { kinds: pickId(a.cameras), frigate: a.cameras.frigate || null, detection: a.cameras.detect !== 'no' } : null,
    controls: a.controls?.has === 'yes' ? { kinds: pickId(a.controls), locksNeedPin: a.controls.locksNeedPin !== 'no' } : null,
    sensors: a.sensors?.has === 'yes' ? { kinds: pickId(a.sensors), alertOn: a.sensors.alertOn || [] } : null,
    network: { provider: a.network?.kind || 'other', meraki: a.network?.meraki || a.cameras?.['meraki-mv'] || a.sensors?.['meraki-mt'] || null, unifi: a.network?.unifi || null,
      dns: a.network?.dns && a.network.dns !== 'none' ? { kind: a.network.dns, url: a.network.dnsUrl || null, key: a.network.dnsKey || null } : null, speedtest: a.network?.speedtest !== 'no' },
    energy: a.energy?.track === 'yes' ? { utility: a.energy.utility || null, ratePerKwh: Number(a.energy.rate) || null, budget: Number(a.energy.budget) || null, kinds: pickId(a.energy) } : null,
    servers: a.servers?.has === 'yes' ? [{ kind: a.servers.kind || 'linux', address: a.servers.address, agentToken: draft.agents[a.servers.address] || null }] : [],
    alerts: { phone: a.alerts?.phone === 'ha' ? 'homeassistant' : null, quietHours: a.alerts?.quiet || '22-7' },
    addedToHomeAssistant: Array.isArray(raw._added) ? raw._added.slice(0, 50).map((x) => ({ domain: String(x.domain), title: String(x.title) })) : [],
  };
  try { saveConfig(next); } catch (err) { return res.status(500).json({ error: `could not save the settings: ${err.message}` }); }
  console.log(`  setup: done for "${next.house.name}"`);
  res.json({ ok: true });
});
app.post('/api/setup/demo', (_req, res) => {
  if (isConfigured() && !isDemo()) return res.status(403).json({ error: 'already set up' });
  saveConfig({ demo: true }); res.json({ ok: true });
});
