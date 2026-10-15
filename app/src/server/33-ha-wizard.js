/* ======================================================================
 * Adding things to Home Assistant from CasaTorch's Connect page, without
 * opening Home Assistant:
 *   - "Found on your network": devices Home Assistant has already discovered
 *     (Hue bridges, Sonos, Chromecasts, printers, TVs...) - usually one click.
 *   - "Add any integration": search everything this Home Assistant can add and
 *     run its own setup questions here (its config flow).
 * Owner/admin only. The Home Assistant key never leaves the CasaTorch.
 * Sign-ins that only Home Assistant can show (Google, some cloud brands) open
 * Home Assistant's own page for that step, and we say so.
 * ====================================================================== */
const haApi = (p, opts = {}) => {
  const h = config.homeAssistant; if (!h?.url) throw Object.assign(new Error('Connect Home Assistant first.'), { status: 409 });
  return getJSON(`${h.url}${p}`, { ...opts, headers: { Authorization: `Bearer ${h.token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, ...(opts.body && typeof opts.body !== 'string' ? { body: JSON.stringify(opts.body) } : {}), timeout: 30000 });
};
/* One question over Home Assistant's WebSocket API (for things REST does not offer, like integration names). */
function haWs(msg, ms = 15000) {
  const h = config.homeAssistant; if (!h?.url) return Promise.reject(new Error('Connect Home Assistant first.'));
  return new Promise((ok, bad) => {
    let ws; try { ws = new WebSocket(`${h.url.replace(/^http/, 'ws')}/api/websocket`); } catch (e) { bad(e); return; }
    const t = setTimeout(() => { try { ws.close(); } catch { /* closed */ } bad(new Error('Home Assistant did not answer')); }, ms);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: h.token }));
      else if (m.type === 'auth_invalid') { clearTimeout(t); ws.close(); bad(new Error('Home Assistant refused the key')); }
      else if (m.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, ...msg }));
      else if (m.id === 1) { clearTimeout(t); ws.close(); m.success ? ok(m.result) : bad(new Error(m.error?.message || 'Home Assistant said no')); }
    };
    ws.onerror = () => { clearTimeout(t); bad(new Error('Could not reach Home Assistant')); };
  });
}
const DISCOVERY = new Set(['zeroconf', 'ssdp', 'dhcp', 'bluetooth', 'homekit', 'mqtt', 'usb', 'hassio', 'integration_discovery', 'discovery', 'import']);
const flowErr2 = (res, err) => res.status(err.status === 409 ? 409 : 502).json({ type: 'error', error: err.status === 404 ? 'Home Assistant does not have that integration (it may need a newer Home Assistant).' : why(err) });
const okId = (id) => /^[\w-]{6,64}$/.test(id), okDomain = (d) => /^[a-z0-9_]{2,64}$/.test(d);

/* What Home Assistant has found on its own and is waiting to add. */
app.get('/api/ha/discovered', requireRole('admin'), async (_req, res) => {
  if (isDemo()) return res.json({ found: DEMO_FOUND.filter((f) => !demoFlows.done.has(f.flowId)) });
  try {
    const ignored = new Set(config.haIgnored || []);
    const flows = (await haApi('/api/config/config_entries/flow')) || [];
    res.json({ found: flows.filter((f) => DISCOVERY.has(f.context?.source)).map((f) => {
      const tp = f.context?.title_placeholders || {}, name = tp.name || tp.title || tp.model || null;
      return { flowId: f.flow_id, domain: f.handler, name, source: f.context.source, key: `${f.handler}:${f.context?.unique_id || name || ''}` };
    }).filter((f) => !ignored.has(f.key)) });
  } catch (err) { flowErr2(res, err); }
});
app.post('/api/ha/discovered/ignore', requireRole('admin'), express.json({ limit: '4kb' }), (req, res) => {
  const key = String(req.body?.key || '').slice(0, 200); if (!key) return res.status(400).json({ error: 'nothing to hide' });
  config.haIgnored = [...new Set([...(config.haIgnored || []), key])].slice(-300); saveConfig(config); res.json({ ok: true });
});
/* Everything this Home Assistant can add, with names, and which are set up already. */
app.get('/api/ha/integrations', requireRole('admin'), async (_req, res) => {
  if (isDemo()) return res.json({ list: DEMO_INTEGRATIONS, have: ['hue', 'ring', 'zwave_js', 'ecobee', 'enphase_envoy', 'opower'] });
  try {
    const list = await cached('ha:integrations', 10 * 60_000, async () => {
      try {
        const d = await haWs({ type: 'integration/descriptions' });
        const out = [];
        for (const src of [d?.core?.integration, d?.custom?.integration]) for (const [domain, v] of Object.entries(src || {})) {
          if (v.config_flow && !['helper', 'virtual', 'entity', 'system'].includes(v.integration_type)) out.push({ domain, name: v.name || pretty(domain), cloud: /cloud/.test(v.iot_class || '') });
          for (const [sub, s] of Object.entries(v.integrations || {})) if (s.config_flow) out.push({ domain: sub, name: s.name || pretty(sub), cloud: /cloud/.test(s.iot_class || '') });
        }
        if (out.length) return { list: out };
      } catch { /* older Home Assistant: fall back to the bare list */ }
      return { list: ((await haApi('/api/config/config_entries/flow_handlers')) || []).map((domain) => ({ domain, name: pretty(domain) })) };
    });
    const have = [...new Set(((await haApi('/api/config/config_entries/entry')) || []).map((e) => e.domain))];
    res.json({ list: list.list.sort((a, b) => a.name.localeCompare(b.name)), have });
  } catch (err) { flowErr2(res, err); }
});
/* Run a setup: start one, look at where a discovered one is, answer it, or stop it. */
app.post('/api/ha/flow', requireRole('admin'), express.json({ limit: '4kb' }), async (req, res) => {
  const domain = String(req.body?.domain || ''); if (!okDomain(domain)) return res.status(400).json({ error: 'bad integration name' });
  if (isDemo()) return res.json(demoFlow(domain));
  try { res.json(flowView(await haApi('/api/config/config_entries/flow', { method: 'POST', body: { handler: domain, show_advanced_options: false } }))); }
  catch (err) { flowErr2(res, err); }
});
app.get('/api/ha/flow/:id', requireRole('admin'), async (req, res) => {
  if (!okId(req.params.id)) return res.status(400).json({ error: 'bad flow' });
  if (isDemo()) return res.json(demoFlow(null, req.params.id));
  try { res.json(flowView(await haApi(`/api/config/config_entries/flow/${req.params.id}`))); }
  catch (err) { flowErr2(res, err); }
});
app.post('/api/ha/flow/:id', requireRole('admin'), express.json({ limit: '32kb' }), async (req, res) => {
  if (!okId(req.params.id)) return res.status(400).json({ error: 'bad flow' });
  if (isDemo()) return res.json(demoFlow(null, req.params.id, req.body?.input || {}));
  try {
    const v = flowView(await haApi(`/api/config/config_entries/flow/${req.params.id}`, { method: 'POST', body: req.body?.input || {} }));
    if (v.type === 'create_entry') { CACHE.delete('ha:states'); CACHE.delete('ha:domains'); }
    res.json(v);
  } catch (err) { flowErr2(res, err); }
});
app.delete('/api/ha/flow/:id', requireRole('admin'), async (req, res) => {
  if (okId(req.params.id) && !isDemo()) { try { await haApi(`/api/config/config_entries/flow/${req.params.id}`, { method: 'DELETE' }); } catch { /* already gone */ } }
  res.json({ ok: true });
});
/* Home Assistant's own page for a step only it can show. */
app.get('/api/ha/flow-link', requireRole('admin'), (req, res) => {
  const h = config.homeAssistant; if (!h?.url) return res.status(409).json({ error: 'Connect Home Assistant first.' });
  res.json({ url: `${h.url}/_my_redirect/config_flow_start?domain=${String(req.query.domain || '').replace(/[^a-z0-9_]/g, '')}` });
});

/* ---- demo: a pretend Home Assistant, so the screens can be tried and photographed ---- */
const DEMO_FOUND = [
  { flowId: 'demo-sonos-1', domain: 'sonos', name: 'Sonos Arc (Living room)', source: 'zeroconf', key: 'sonos:demo' },
  { flowId: 'demo-cast-1', domain: 'cast', name: 'Kitchen display', source: 'zeroconf', key: 'cast:demo' },
  { flowId: 'demo-ipp-1', domain: 'ipp', name: 'Office printer', source: 'zeroconf', key: 'ipp:demo' },
];
const DEMO_INTEGRATIONS = [['august', 'August'], ['cast', 'Google Cast'], ['ecobee', 'ecobee'], ['enphase_envoy', 'Enphase Envoy'], ['hue', 'Philips Hue'], ['ipp', 'Internet Printing Protocol (IPP)'], ['lutron_caseta', 'Lutron Caséta'],
  ['myq', 'myQ'], ['nest', 'Google Nest'], ['opower', 'Opower'], ['ring', 'Ring'], ['roku', 'Roku'], ['shelly', 'Shelly'], ['sonos', 'Sonos'], ['tesla_fleet', 'Tesla Fleet'], ['tessie', 'Tessie'], ['tplink', 'TP-Link Smart Home'],
  ['unifiprotect', 'UniFi Protect'], ['wiz', 'WiZ'], ['zwave_js', 'Z-Wave']].map(([domain, name]) => ({ domain, name }));
const demoFlows = { done: new Set() };
function demoFlow(domain, id, input) {
  const found = DEMO_FOUND.find((f) => f.flowId === id);
  if (found) {
    if (input) { demoFlows.done.add(id); return { flowId: id, domain: found.domain, type: 'create_entry', title: found.name }; }
    return { flowId: id, domain: found.domain, step: 'zeroconf_confirm', type: 'form', fields: [], errors: {}, placeholders: { name: found.name }, last: true };
  }
  if (domain) return { flowId: `demo-${domain}-new`, domain, step: 'user', type: 'form', fields: [{ name: 'host', required: true, type: 'string' }], errors: {}, last: true };
  if (input && !input.host) return { flowId: id, domain: id.replace(/^demo-|-new$/g, ''), step: 'user', type: 'form', fields: [{ name: 'host', required: true, type: 'string' }], errors: { base: 'cannot_connect' }, last: true };
  return { flowId: id, domain: id.replace(/^demo-|-new$/g, ''), type: 'create_entry', title: input?.host || 'Added' };
}
