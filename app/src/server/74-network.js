/* ======================================================================
 * Network monitoring (Pro): your network gear and DNS filters, read-only.
 *
 *   Pi-hole (v6, or v5 with an API token)  - queries, blocked, protection on/off
 *   AdGuard Home                            - the same
 *   UniFi Network (local Integration API)   - every UniFi device online/offline, clients
 *   Cisco Meraki (Dashboard API)            - every device's status, clients
 *
 * An admin adds a source in the Network tab with the address and a key or
 * password; the secret is sealed on disk like every other one and never goes
 * back to the browser. CasaTorch reads each source every 2 minutes (Meraki
 * every 5) and raises alerts when a network device goes offline or a DNS
 * filter's protection is switched off. It never changes anything on them.
 *
 * Home gear often uses its own (self-signed) certificate. For addresses on
 * the home network only (private IPs, .local, plain host names), CasaTorch
 * accepts it; anything on the internet must have a real certificate.
 * ====================================================================== */
import http from 'node:http';
const NET_KINDS = { pihole: 'Pi-hole', adguard: 'AdGuard Home', unifi: 'UniFi', meraki: 'Cisco Meraki' };
const MERAKI_BASES = { us: 'https://api.meraki.com/api/v1', ca: 'https://api.meraki.ca/api/v1', in: 'https://api.meraki.in/api/v1', cn: 'https://api.meraki.cn/api/v1' };
const netState = {};   // id -> { at, ok, error, fails, summary, devices }
const netSources = () => (Array.isArray(config.network?.sources) ? config.network.sources : []);
/** True only for addresses on the home network: private, link-local or loopback IPs (RFC 1918, 169.254/16,
 *  IPv6 ULA fc00::/7 and fe80::/10), names that can't exist on the internet (.local, .lan, .home, .internal,
 *  .home.arpa, .localdomain) and plain one-word host names. Used to decide where a self-made certificate is
 *  accepted (here, and in the setup tests in 05-setup.js); everything else must have a real certificate. */
function isLanHost(host) {
  let h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h) return false;
  const m4 = h.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const [a, b, c, d] = m4.slice(1).map(Number); if ([a, b, c, d].some((n) => n > 255)) return false;
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  if (h.includes(':')) {   // IPv6 literal
    if (!/^[0-9a-f:.%a-z]+$/.test(h)) return false;
    if (h === '::1') return true;
    return /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
  }
  if (!/^[a-z0-9.-]+$/.test(h) || /^[\d.]+$/.test(h)) return false;
  return /\.(local|lan|home|internal|localdomain|home\.arpa)$/.test(h) || /^[a-z0-9-]+$/.test(h);
}

/* JSON over http(s). Home-network addresses may use their own certificate; nothing else may. */
function netRequest(url, { method = 'GET', headers = {}, body, timeout = 10000 } = {}) {
  return new Promise((ok, bad) => {
    let u; try { u = new URL(url); } catch { return bad(new Error('that address isn\'t valid')); }
    if (blockedUrl(u)) return bad(new Error('That address is not allowed.'));   // the same rule as fetch (00-setup.js)
    const mod = u.protocol === 'https:' ? https : http;
    const data = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const r = mod.request(u, { method, timeout, rejectUnauthorized: !isLanHost(u.hostname), headers: { 'User-Agent': UA, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) { r.destroy(); bad(new Error('the answer was too big')); } else chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
        if (res.statusCode === 401 || res.statusCode === 403) return bad(Object.assign(new Error('the key or password was refused'), { status: res.statusCode }));
        if (res.statusCode >= 400) return bad(Object.assign(new Error(`it answered ${res.statusCode}`), { status: res.statusCode }));
        if (j == null) return bad(new Error('it answered, but not with data CasaTorch understands - is this the right address?'));
        ok(j);
      });
    });
    r.on('timeout', () => { r.destroy(); bad(new Error('no answer in 10 seconds')); });
    r.on('error', (e) => bad(new Error(e.code === 'ECONNREFUSED' ? 'connection refused - check the address and port' : e.code === 'ENOTFOUND' ? 'that address wasn\'t found' : /CERT|SELF_SIGNED/.test(e.code || '') ? 'its certificate isn\'t trusted' : String(e.message || e.code).slice(0, 80))));
    if (data) r.write(data); r.end();
  });
}
const base = (u) => String(u || '').trim().replace(/\/+$/, '');
const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/* ---- each kind: read() -> { summary, devices } ---- */
const NET = {
  async pihole(s, secret) {
    const b = base(s.url);
    try {   // Pi-hole v6
      const a = await netRequest(`${b}/api/auth`, { method: 'POST', body: { password: secret || '' } });
      const sid = a?.session?.sid; if (!a?.session?.valid && !sid) throw Object.assign(new Error('the password was refused'), { status: 401 });
      const H = sid ? { 'X-FTL-SID': sid } : {};
      try {
        const [sum, blk] = await Promise.all([netRequest(`${b}/api/stats/summary`, { headers: H }), netRequest(`${b}/api/dns/blocking`, { headers: H }).catch(() => null)]);
        return { summary: { queries: n0(sum?.queries?.total), blocked: n0(sum?.queries?.blocked), percentBlocked: n0(sum?.queries?.percent_blocked), clients: n0(sum?.clients?.active), blocklist: n0(sum?.gravity?.domains_being_blocked), protection: blk ? blk.blocking === 'enabled' : null }, devices: [] };
      } finally { if (sid) await netRequest(`${b}/api/auth`, { method: 'DELETE', headers: H, timeout: 4000 }).catch(() => {}); }   // don't leave sessions behind (Pi-hole limits them)
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const j = await netRequest(`${b}/admin/api.php?summaryRaw&auth=${encodeURIComponent(secret || '')}`);   // Pi-hole v5
    if (j?.dns_queries_today == null) throw new Error('the API token was refused (Settings › API in Pi-hole)');
    return { summary: { queries: n0(j.dns_queries_today), blocked: n0(j.ads_blocked_today), percentBlocked: n0(j.ads_percentage_today), clients: n0(j.unique_clients), blocklist: n0(j.domains_being_blocked), protection: j.status ? j.status === 'enabled' : null }, devices: [] };
  },
  async adguard(s, secret) {
    const b = base(s.url), H = { Authorization: `Basic ${Buffer.from(`${s.user || ''}:${secret || ''}`).toString('base64')}` };
    const [st, stats] = await Promise.all([netRequest(`${b}/control/status`, { headers: H }), netRequest(`${b}/control/stats`, { headers: H })]);
    const q = n0(stats?.num_dns_queries), bl = n0(stats?.num_blocked_filtering);
    return { summary: { queries: q, blocked: bl, percentBlocked: q ? Math.round(bl / q * 1000) / 10 : null, clients: Array.isArray(stats?.top_clients) ? stats.top_clients.length : null, protection: typeof st?.protection_enabled === 'boolean' ? st.protection_enabled : null, version: st?.version || null }, devices: [] };
  },
  async unifi(s, secret) {
    const b = `${base(s.url)}/proxy/network/integration/v1`, H = { 'X-API-Key': secret || '' };
    const list = (j) => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : []);
    const sites = list(await netRequest(`${b}/sites?limit=50`, { headers: H }));
    const site = sites.find((x) => x.id === s.site) || sites.find((x) => /default/i.test(`${x.internalReference || ''} ${x.name || ''}`)) || sites[0];
    if (!site) throw new Error('no UniFi sites were found for this key');
    const [devs, cls] = await Promise.all([netRequest(`${b}/sites/${encodeURIComponent(site.id)}/devices?limit=200`, { headers: H }), netRequest(`${b}/sites/${encodeURIComponent(site.id)}/clients?limit=1`, { headers: H }).catch(() => null)]);
    const devices = list(devs).slice(0, 200).map((d) => ({ name: d.name || d.model || d.macAddress || 'UniFi device', model: d.model || null, ip: d.ipAddress || null, online: String(d.state || '').toUpperCase() === 'ONLINE', state: d.state || null }));
    const clients = n0(cls?.totalCount) ?? (Array.isArray(cls?.data) ? cls.data.length : null);
    return { summary: { site: site.name || null, devices: devices.length, offline: devices.filter((d) => !d.online).length, clients }, devices };
  },
  async meraki(s, secret) {
    const b = process.env.CASATORCH_MERAKI_BASE || MERAKI_BASES[s.region] || MERAKI_BASES.us, H = { Authorization: `Bearer ${secret || ''}` };
    const orgs = await netRequest(`${b}/organizations`, { headers: H });
    const org = (Array.isArray(orgs) ? orgs : []).find((o) => o.id === s.org) || (Array.isArray(orgs) ? orgs[0] : null);
    if (!org) throw new Error('no Meraki organizations were found for this key');
    const st = await netRequest(`${b}/organizations/${encodeURIComponent(org.id)}/devices/statuses?perPage=1000`, { headers: H });
    const devices = (Array.isArray(st) ? st : []).slice(0, 500).map((d) => ({ name: d.name || d.model || d.serial || 'Meraki device', model: d.model || null, ip: d.lanIp || d.publicIp || null, online: d.status === 'online' || d.status === 'alerting', state: d.status || null, alerting: d.status === 'alerting', serial: d.serial || null, type: d.productType || null }));
    return { summary: { orgId: org.id, org: org.name || null, devices: devices.length, offline: devices.filter((d) => d.state === 'offline').length, alerting: devices.filter((d) => d.alerting).length }, devices };
  },
};

let netBusy = false;
async function readNetSource(s) {
  const st = (netState[s.id] ||= { fails: 0 });
  try {
    if (!Object.hasOwn(NET, s.kind)) throw new Error('unknown kind of source');
    const r = await NET[s.kind](s, secretOf(s.secret));
    Object.assign(st, { ok: true, error: null, fails: 0, at: nowIso(), summary: r.summary, devices: r.devices });
  } catch (e) {
    Object.assign(st, { ok: false, error: String(e.message || e).slice(0, 140), fails: st.fails + 1, at: nowIso() });
  }
  return st;
}
async function runNetwork(force = false) {
  if (netBusy) return; netBusy = true;
  try {
    const now = Date.now();
    await Promise.all(netSources().map((s) => {
      const st = netState[s.id], every = s.kind === 'meraki' ? 5 * 60_000 : 2 * 60_000;
      return force || !st?.at || now - Date.parse(st.at) >= every - 5000 ? readNetSource(s) : null;
    }));
    for (const id of Object.keys(netState)) if (!netSources().some((s) => s.id === id)) delete netState[id];
  } finally { netBusy = false; }
}
setInterval(() => { if (isConfigured() && !isDemo() && proStatus().pro && netSources().length) runNetwork().catch(() => {}); }, 60_000).unref?.();

/* Read by the alert check every minute (40-alerts.js). */
function networkAlerts() {
  if (isDemo() || !proStatus().pro) return [];
  const out = [];
  for (const s of netSources()) {
    const st = netState[s.id]; if (!st) continue;
    if (st.fails >= 3) out.push({ id: `netsrc:${s.id}`, severity: 'warning', title: `CasaTorch can't reach ${s.name}`, source: 'network' });
    if (st.ok && st.summary?.protection === false) out.push({ id: `dnsoff:${s.id}`, severity: 'notice', title: `${s.name}: ad and tracker blocking is off`, source: 'network' });
    if (st.ok) for (const d of (st.devices || []).filter((x) => !x.online && x.state !== 'dormant').slice(0, 10)) out.push({ id: `netdev:${s.id}:${d.name}`, severity: 'warning', title: `${d.name} (${NET_KINDS[s.kind]}) is offline`, source: 'network' });
  }
  return out;
}
const netView = (s) => {
  const st = netState[s.id] || {};
  return { id: s.id, kind: s.kind, kindName: NET_KINDS[s.kind], name: s.name, url: s.url || null, region: s.region || null, user: s.user || null, ok: st.ok ?? null, error: st.error || null, at: st.at || null, summary: st.summary || null, devices: (st.devices || []).slice(0, 200) };
};
const DEMO_NET = [
  { id: 'demo-unifi', kind: 'unifi', kindName: 'UniFi', name: 'UniFi', url: 'https://192.168.1.1', ok: true, error: null, summary: { site: 'Default', devices: 6, offline: 1, clients: 58 },
    devices: [['Dream Machine Pro', 'UDM-Pro', true], ['Switch 24 PoE', 'USW-24-PoE', true], ['Living Room AP', 'U7-Pro', true], ['Upstairs AP', 'U7-Pro', true], ['Garage AP', 'U6-Mesh', false], ['Office Switch', 'USW-Flex-Mini', true]].map(([name, model, online], i) => ({ name, model, ip: `192.168.1.${2 + i}`, online, state: online ? 'ONLINE' : 'OFFLINE' })) },
  { id: 'demo-pihole', kind: 'pihole', kindName: 'Pi-hole', name: 'Pi-hole', url: 'http://192.168.1.5', ok: true, error: null, summary: { queries: 41820, blocked: 9204, percentBlocked: 22, clients: 31, blocklist: 168420, protection: true }, devices: [] },
];

app.get('/api/network', (_req, res) => {
  if (isDemo()) return res.json({ pro: true, kinds: NET_KINDS, sources: DEMO_NET.map((x) => ({ ...x, at: nowIso() })) });
  if (!proStatus().pro) return res.json({ pro: false, kinds: NET_KINDS, sources: [] });
  res.json({ pro: true, kinds: NET_KINDS, sources: netSources().map(netView) });
});
app.post('/api/network', requireRole('admin'), requirePro, express.json({ limit: '4kb' }), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const b = req.body || {}, kind = String(b.kind || '');
  if (!Object.hasOwn(NET, kind)) return res.status(400).json({ error: 'Pick what to connect.' });
  if (netSources().length >= 10) return res.status(400).json({ error: 'Up to 10 network sources - remove one first.' });
  const s = { id: crypto.randomBytes(5).toString('hex'), kind, name: String(b.name || NET_KINDS[kind]).trim().slice(0, 40) || NET_KINDS[kind] };
  if (kind !== 'meraki') {
    let u; try { u = new URL(String(b.url || '').trim()); } catch { /* checked below */ }
    if (!u || !/^https?:$/.test(u.protocol) || u.username || u.password) return res.status(400).json({ error: `Enter ${NET_KINDS[kind]}'s address, like ${kind === 'unifi' ? 'https://192.168.1.1' : 'http://192.168.1.5'}.` });
    s.url = `${u.protocol}//${u.host}`;
  } else s.region = MERAKI_BASES[b.region] ? b.region : 'us';
  if (kind === 'adguard') s.user = String(b.user || '').slice(0, 80);
  const secret = String(b.secret || '');
  if (!secret && kind !== 'pihole') return res.status(400).json({ error: kind === 'adguard' ? 'Enter the AdGuard Home password.' : 'Paste the API key.' });
  // Check it works before saving, so a typo shows up now rather than as an alert later.
  try { const r = await NET[kind](s, secret); s.secret = secret ? seal(secret) : null; saveConfig({ ...config, network: { ...(config.network || {}), sources: [...netSources(), s] } }); netState[s.id] = { ok: true, fails: 0, at: nowIso(), summary: r.summary, devices: r.devices }; res.json({ ok: true, source: netView(s) }); }
  catch (e) { res.status(400).json({ error: `${NET_KINDS[kind]}: ${String(e.message || e)}` }); }
});
app.delete('/api/network/:id', requireRole('admin'), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  saveConfig({ ...config, network: { ...(config.network || {}), sources: netSources().filter((s) => s.id !== req.params.id) } }); delete netState[req.params.id];
  res.json({ ok: true });
});
app.post('/api/network/refresh', requireRole('member'), async (_req, res) => {
  if (isDemo() || !proStatus().pro) return res.json({ ok: true });
  await runNetwork(true).catch(() => {}); res.json({ ok: true });
});
/* On the Connect page: connected here, in the Network tab. */
const netHas = (kind) => () => (isDemo() ? ['unifi', 'pihole'].includes(kind) : netSources().some((s) => s.kind === kind));   // the demo house has UniFi and Pi-hole
integration({ id: 'net-unifi', label: 'UniFi', group: 'network', how: 'pro', href: '#network', replaces: ['net-unifi'], desc: 'Every UniFi access point, switch and gateway online or offline, and how many devices are connected.', connected: netHas('unifi') });
integration({ id: 'net-meraki', label: 'Cisco Meraki', group: 'network', how: 'pro', href: '#network', replaces: ['net-meraki'], desc: 'Every Meraki device\'s status, with alerts. Also brings in Meraki cameras and sensors.', connected: netHas('meraki') });
integration({ id: 'pihole', label: 'Pi-hole', group: 'network', how: 'pro', href: '#network', replaces: ['pihole'], desc: 'Queries, how much is blocked, and an alert if blocking is switched off.', connected: netHas('pihole') });
integration({ id: 'adguard', label: 'AdGuard Home', group: 'network', how: 'pro', href: '#network', replaces: ['adguard'], desc: 'Queries, how much is blocked, and an alert if blocking is switched off.', connected: netHas('adguard') });
integration({ id: 'meraki-mv', label: 'Cisco Meraki MV cameras', group: 'cameras', how: 'pro', href: '#network', replaces: ['meraki-mv'], desc: 'Pictures from your Meraki cameras. Connect Cisco Meraki in the Network tab and they appear.', connected: () => netHas('meraki')() && merakiDevs('camera').length > 0 });
integration({ id: 'meraki-mt', label: 'Cisco Meraki MT sensors', group: 'sensors', how: 'pro', href: '#network', replaces: ['meraki-mt'], desc: 'Temperature, humidity, leaks, doors and batteries, with alerts. Connect Cisco Meraki in the Network tab.', connected: () => netHas('meraki')() && merakiDevs('sensor').length > 0 });
integration({ id: 'servers', label: 'Your servers and apps', group: 'network', how: 'pro', href: '#network', desc: 'NAS, Plex, Home Assistant, any self-hosted app: up or down, response time and certificates.', connected: () => isDemo() || (config.monitors || []).length > 0 });
