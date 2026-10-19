/* ======================================================================
 * The Network page's picture of your network (Pro), built from a Meraki or UniFi key alone.
 *
 * Every 5 minutes (Meraki) or 2 (UniFi), after the quick status read in 74-network.js, CasaTorch reads the
 * rest, read-only, and makes one model the page draws from:
 *   devices    every gateway, switch, access point, camera, sensor and cellular gateway, with its status
 *   uplinks    WAN 1, WAN 2 and cellular: status, addresses, loss and latency (kept as 24 hours of history)
 *   links      who is plugged into whom (Meraki: LLDP/CDP link-layer topology; UniFi: each device's uplink)
 *   clients    how many, wired or Wi-Fi, by network name (SSID), band and access point, and the top users
 *   wifi       each access point's radios: channel, width and how busy the channel is
 *   ports      each switch's ports: up or down, speed, PoE, errors
 *   events     the latest events; firmware and license status
 * Then netTopology() turns devices and links into the map: internet, gateway, switches, access points and
 * client counts, in layers. Links that Meraki or UniFi didn't report are estimated from device types and
 * marked so.
 *
 * Kept in memory (and 24 hours of uplink and latency history in data/network-history.json). Public addresses
 * are only sent to admins (never to wall panels or viewers), and the page shows them masked until tapped.
 * ====================================================================== */
const NH_FILE = path.join(DATA_DIR, 'network-history.json'), NH_KEEP = 288, NH_STEP = 5 * 60_000;
let nh = { v: 1, inet: [], up: {}, speed: [], clients: [] };
try { const j = JSON.parse(fs.readFileSync(NH_FILE, 'utf8')); if (j?.v === 1) nh = { ...nh, ...j }; } catch { /* first run */ }
let nhDirty = false;
const nhSave = () => { if (!nhDirty || isDemo()) return; nhDirty = false; try { writeFileSafe(NH_FILE, JSON.stringify(nh), 0o600); } catch { nhDirty = true; } };
setInterval(nhSave, 15 * 60_000).unref?.();
process.on('exit', () => { try { nhSave(); } catch { /* best effort */ } });
/* One point a 5-minute step: a second reading in the same step replaces the first. */
function nhPush(list, point, keep = NH_KEEP) {
  const step = Math.floor(point[0] / NH_STEP);
  if (list.length && Math.floor(list[list.length - 1][0] / NH_STEP) === step) list[list.length - 1] = point; else list.push(point);
  if (list.length > keep) list.splice(0, list.length - keep);
  nhDirty = true;
  return list;
}
/* The internet's latency every 5 minutes (one connection to Cloudflare, Google as a fallback) and each new speed test. */
setInterval(async () => {
  if (!isConfigured() || isDemo()) return;
  const ms = (await tcpMs('1.1.1.1')) ?? (await tcpMs('8.8.8.8'));
  nhPush(nh.inet, [Date.now(), ms == null ? null : Math.round(ms * 10) / 10]);
  const s = typeof speed === 'object' ? speed.last : null;
  if (s?.downMbps != null && !nh.speed.some((x) => x[0] === Date.parse(s.at))) { nh.speed.push([Date.parse(s.at), s.downMbps, s.upMbps]); if (nh.speed.length > 90) nh.speed.shift(); nhDirty = true; }
}, NH_STEP).unref?.();

/* ---- kinds and states, the same words for Meraki and UniFi ---- */
const NET_TYPES = ['appliance', 'cellular', 'switch', 'wireless', 'camera', 'sensor', 'other'];
/** The kind of device: Meraki's productType when there is one, else the model (MX, MS, MR, MV, MT, MG) or UniFi's
 *  features and model. */
function netTypeOf(d = {}) {
  const pt = String(d.productType || d.type || '').toLowerCase(), m = String(d.model || ''), f = (d.features || []).map((x) => String(x).toLowerCase());
  if (pt === 'appliance' || pt === 'securityappliance') return 'appliance';
  if (pt === 'cellulargateway' || pt === 'cellular') return 'cellular';
  if (['switch', 'wireless', 'camera', 'sensor'].includes(pt)) return pt;
  if (/^(MX|Z\d|VMX)/i.test(m) || /^(UDM|UDR|UXG|UCG|USG|UDW|UX\b|UX7|EFG)/i.test(m) || f.includes('gateway')) return 'appliance';
  if (/^MG/i.test(m)) return 'cellular';
  if (/^(MS|C9\d{3}|USW|US-|USL|ECS)/i.test(m) || (f.includes('switching') && !f.includes('accesspoint'))) return 'switch';
  if (/^(MR|CW9|U6|U7|UAP|UAL|UAC|E7|UK-|UWB|ULR|BZ)/i.test(m) || f.includes('accesspoint')) return 'wireless';
  if (/^MV/i.test(m)) return 'camera';
  if (/^MT/i.test(m)) return 'sensor';
  return 'other';
}
/** Online, alerting (up but something needs a look), offline, dormant (Meraki: not used for a while) or unknown. */
function netStatusOf(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/[\s-]/g, '_');
  if (['online', 'up', 'connected', 'active'].includes(s)) return 'online';
  if (['alerting', 'pending_adoption', 'adopting', 'updating', 'getting_ready', 'provisioning', 'upgrading'].includes(s)) return 'alerting';
  if (['offline', 'down', 'disconnected', 'connection_interrupted', 'isolated', 'failed', 'deleting'].includes(s)) return 'offline';
  if (s === 'dormant') return 'dormant';
  return 'unknown';
}
const netUp = (st) => st === 'online' || st === 'alerting';
const netRound = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
const netAvg = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const NET_IFACE = { wan1: 'WAN 1', wan2: 'WAN 2', wan3: 'WAN 3', cellular: 'Cellular' };

/* ---- the map: internet -> gateway -> switches -> access points (and cameras, sensors) -> clients ---- */
/** netTopology(model): { nodes: [{ id, name, type, status, model, clients, layer, parent }], edges: [{ a, b, kind, inferred, status, label }],
 *  layers, inferred }. Reported links first (LLDP/CDP, UniFi uplinks); anything still unattached gets the likely parent
 *  for its kind (an access point under a switch, a switch under the gateway), marked inferred. Pure. */
function netTopology(m) {
  const devs = (m?.devices || []).filter((d) => d.type !== 'sensor' || m.sensorsOnMap);
  const byId = new Map(devs.map((d) => [d.id, d]));
  const nodes = [{ id: 'internet', name: 'Internet', type: 'internet', status: (m?.uplinks || []).some((u) => u.status === 'active') || !(m?.uplinks || []).length ? 'online' : 'offline', layer: 0, parent: null }];
  for (const d of devs) nodes.push({ id: d.id, name: d.name, type: d.type, status: d.status, model: d.model || null, clients: d.clients ?? null, net: d.net || null, ip: d.ip || null, fw: d.fw || null, layer: null, parent: null });
  const N = new Map(nodes.map((n) => [n.id, n])), adj = new Map(nodes.map((n) => [n.id, []])), edges = [], seen = new Set();
  const link = (a, b, extra = {}) => {
    if (a === b || !N.has(a) || !N.has(b)) return;
    const k = [a, b].sort().join('|'); if (seen.has(k)) return; seen.add(k);
    adj.get(a).push(b); adj.get(b).push(a); edges.push({ a, b, kind: 'lan', inferred: false, ...extra });
  };
  for (const l of m?.links || []) link(l.a, l.b, { label: l.label || null });
  const rank = { appliance: 1, cellular: 1, switch: 2, wireless: 3, camera: 3, sensor: 4, other: 3 };
  // the internet: to each gateway (each WAN) - a cellular gateway feeding a gateway's WAN 2 sits between them
  const gws = devs.filter((d) => d.type === 'appliance'), cells = devs.filter((d) => d.type === 'cellular');
  for (const g of gws) {
    const ups = (m.uplinks || []).filter((u) => u.dev === g.id && !u.via);
    const st = ups.some((u) => u.status === 'active') ? 'online' : ups.length ? 'offline' : g.status;
    link('internet', g.id, { kind: 'wan', status: st, label: ups.filter((u) => u.status === 'active').map((u) => NET_IFACE[u.iface] || u.iface).join(' + ') || null });
  }
  for (const c of cells) {
    const feeds = gws.find((g) => (m.uplinks || []).some((u) => u.dev === g.id && u.via === c.id)) || (!adj.get(c.id).length ? gws.find((g) => g.net === c.net) : null);
    if (feeds && !adj.get(c.id).includes(feeds.id)) link(c.id, feeds.id, { kind: 'wan2', inferred: !(m.uplinks || []).some((u) => u.via === c.id) });
    const cu = (m.uplinks || []).find((u) => u.dev === c.id);
    link('internet', c.id, { kind: 'cellular', status: cu ? (cu.status === 'active' ? 'online' : cu.status === 'ready' ? 'standby' : 'offline') : c.status });
  }
  // a home with no gateway in it (UniFi switches behind someone else's router): the internet goes to the top switch
  if (!gws.length && !cells.length) {
    const top = devs.filter((d) => d.type === 'switch').sort((a, b) => (adj.get(b.id).length - adj.get(a.id).length) || String(a.name).localeCompare(String(b.name)))[0] || devs.find((d) => d.type !== 'sensor');
    if (top) link('internet', top.id, { kind: 'wan', inferred: true });
  }
  // depth from the internet over the links we have
  const depth = new Map([['internet', 0]]), parent = new Map(), q = ['internet'];
  const bfs = () => { while (q.length) { const id = q.shift(); for (const nb of adj.get(id).slice().sort((x, y) => (rank[N.get(x).type] || 3) - (rank[N.get(y).type] || 3))) if (!depth.has(nb)) { depth.set(nb, depth.get(id) + 1); parent.set(nb, id); q.push(nb); } } };
  bfs();
  // anything not reached: the likely parent for its kind, in the same network
  const pick = (d) => {
    const same = (x) => !d.net || !x.net || x.net === d.net, reached = (x) => depth.has(x.id) && x.id !== d.id && same(x);
    const sw = devs.filter((x) => x.type === 'switch' && reached(x)).sort((a, b) => depth.get(a.id) - depth.get(b.id));
    const gw = devs.filter((x) => x.type === 'appliance' && reached(x));
    if (d.type === 'switch') return gw[0] || sw[0] || null;
    if (d.type === 'sensor') return devs.filter((x) => x.type === 'wireless' && reached(x))[0] || sw[0] || gw[0] || null;
    if (d.type === 'cellular') return null;
    return sw.length ? sw[sw.length - 1] : gw[0] || null;   // access points and cameras: the access switch (the deepest), else the gateway
  };
  for (const pass of [0, 1, 2]) {
    for (const d of devs.slice().sort((a, b) => (rank[a.type] || 3) - (rank[b.type] || 3))) {
      if (depth.has(d.id)) continue;
      const p = pick(d) || (pass === 2 ? { id: 'internet' } : null); if (!p) continue;
      link(p.id, d.id, { inferred: true }); depth.set(d.id, depth.get(p.id) + 1); parent.set(d.id, p.id); q.push(d.id); bfs();
    }
  }
  for (const n of nodes) { n.layer = depth.get(n.id) ?? 1; n.parent = parent.get(n.id) || null; }
  // parents point down the tree; edges that aren't tree edges stay (a cellular backup feeding WAN 2), drawn lighter.
  // A link is as healthy as the device at its far end (an offline access point: its link is red, the switch's others aren't).
  for (const e of edges) {
    const [pa, ch] = depth.get(e.a) <= depth.get(e.b) ? [e.a, e.b] : [e.b, e.a]; e.a = pa; e.b = ch; e.tree = parent.get(ch) === pa;
    const ta = N.get(pa).type, tb = N.get(ch).type;
    if (e.kind === 'lan' && ((ta === 'cellular' && tb === 'appliance') || (ta === 'appliance' && tb === 'cellular'))) e.kind = 'wan2';
    if (!e.status) e.status = N.get(ch).status === 'unknown' ? N.get(pa).status : N.get(ch).status;
  }
  return { nodes, edges, layers: Math.max(1, ...nodes.map((n) => n.layer)) + 1, inferred: edges.filter((e) => e.inferred).length };
}

/* ---- Meraki: everything, read-only, through mkGet (rate-limited, cached) ---- */
const MK_TTL = { orgs: 3600_000, nets: 1800_000, inv: 1800_000, status: 110_000, uplinks: 110_000, loss: 110_000, clients: 600_000, bands: 600_000, util: 600_000, ports: 280_000, ap: 1800_000, topo: 1800_000, events: 280_000, fw: 6 * 3600_000, lic: 6 * 3600_000 };
async function netDeepMeraki(s, secret) {
  const G = (p, ttl, o = {}) => mkGet(s, secret, p, { ttl, lane, ...o });
  let lane = `key:${s.id}`;
  const orgs = await G('/organizations', MK_TTL.orgs);
  const org = (Array.isArray(orgs) ? orgs : []).find((o) => o.id === s.org) || (Array.isArray(orgs) ? orgs[0] : null);
  if (!org) throw new Error('no Meraki organizations were found for this key');
  lane = `org:${org.id}`;
  const O = `/organizations/${encodeURIComponent(org.id)}`, notes = [];
  const opt = (p, ttl, o) => G(p, ttl, { optional: true, ...o }).catch((e) => { if (e.status === 401 || e.status === 403) throw e; notes.push(p.split('?')[0].replace(O, '').slice(1)); return null; });
  const [nets, inv, st, upl, cell, loss, util, lic] = await Promise.all([
    G(`${O}/networks?perPage=100`, MK_TTL.nets, { pages: 3 }),
    opt(`${O}/devices?perPage=500`, MK_TTL.inv, { pages: 4 }),
    G(`${O}/devices/statuses?perPage=500`, MK_TTL.status, { pages: 4 }),
    opt(`${O}/appliance/uplink/statuses?perPage=100`, MK_TTL.uplinks, { pages: 2 }),
    opt(`${O}/cellularGateway/uplink/statuses?perPage=100`, MK_TTL.uplinks, { pages: 2 }),
    opt(`${O}/devices/uplinksLossAndLatency?timespan=300`, MK_TTL.loss),
    opt(`${O}/wireless/devices/channelUtilization/byDevice?timespan=3600&perPage=100`, MK_TTL.util, { pages: 2 }),
    opt(`${O}/licenses/overview`, MK_TTL.lic),
  ]);
  const invBy = new Map((inv || []).map((d) => [d.serial, d])), netName = new Map((nets || []).map((n) => [n.id, n.name]));
  const devices = (st || []).slice(0, 500).map((d) => {
    const i = invBy.get(d.serial) || {};
    return { id: d.serial, serial: d.serial, name: d.name || i.name || d.model || d.serial, model: d.model || i.model || null, type: netTypeOf({ productType: d.productType || i.productType, model: d.model || i.model }),
      status: netStatusOf(d.status), net: d.networkId || i.networkId || null, ip: d.lanIp || null, mac: d.mac || null, fw: i.firmware || null, clients: null };
  });
  const D = new Map(devices.map((d) => [d.id, d]));
  // uplinks: status and addresses, then loss and latency (the last 5 minutes, averaged) into the history
  const uplinks = [];
  for (const a of upl || []) for (const u of a.uplinks || []) uplinks.push({ dev: a.serial, iface: u.interface, status: String(u.status || '').toLowerCase(), ip: u.ip || null, publicIp: u.publicIp || null, gateway: u.gateway || null, dns: [u.primaryDns, u.secondaryDns].filter(Boolean), by: u.ipAssignedBy || null });
  for (const c of cell || []) for (const u of c.uplinks || []) uplinks.push({ dev: c.serial, iface: 'cellular', status: String(u.status || '').toLowerCase(), ip: u.ip || null, publicIp: u.publicIp || null, provider: u.provider || null, kind: u.connectionType || null, signal: u.signalStat ? { rsrp: n0(u.signalStat.rsrp), rsrq: n0(u.signalStat.rsrq) } : null });
  const now = Date.now();
  for (const l of loss || []) {
    const ts = (l.timeSeries || []).filter((x) => x.latencyMs != null || x.lossPercent != null);
    const u = uplinks.find((x) => x.dev === l.serial && x.iface === l.uplink); if (!u) continue;
    u.loss = netRound(netAvg(ts.map((x) => x.lossPercent))); u.lat = netRound(netAvg(ts.map((x) => x.latencyMs))); u.target = l.ip || null;
    nhPush((nh.up[`${l.serial}:${l.uplink}`] ||= []), [now, u.loss, u.lat]);
  }
  // per network: clients, Wi-Fi bands, the link-layer map, events, firmware
  const wantNets = (nets || []).filter((n) => devices.some((d) => d.net === n.id)).slice(0, 5);
  const per = await Promise.all(wantNets.map(async (n) => {
    const P = `/networks/${encodeURIComponent(n.id)}`, types = new Set((n.productTypes || []).filter((x) => ['appliance', 'switch', 'wireless', 'cellularGateway', 'camera'].includes(x)));
    const [clients, topo, fw, b24, b5, b6, ...ev] = await Promise.all([
      opt(`${P}/clients?timespan=86400&perPage=1000`, MK_TTL.clients, { pages: 3 }),
      opt(`${P}/topology/linkLayer`, MK_TTL.topo),
      opt(`${P}/firmwareUpgrades`, MK_TTL.fw),
      ...(types.has('wireless') ? ['2.4', '5', '6'].map((b) => opt(`${P}/wireless/clientCountHistory?timespan=3600&resolution=300&band=${b}`, MK_TTL.bands)) : [null, null, null]),
      ...[...types].filter((t) => t !== 'camera').map((t) => opt(`${P}/events?productType=${t}&perPage=20`, MK_TTL.events)),
    ]);
    const last = (h) => { const v = (Array.isArray(h) ? h : []).map((x) => x.clientCount).filter((x) => x != null); return v.length ? v[v.length - 1] : null; };
    return { n, clients: clients || [], topo, fw, bands: [['2.4', last(b24)], ['5', last(b5)], ['6', last(b6)]].filter(([, v]) => v != null), events: ev.flatMap((x) => x?.events || []) };
  }));
  // switch ports and access point radios (the first 12 switches and 16 access points)
  const sws = devices.filter((d) => d.type === 'switch').slice(0, 12), aps = devices.filter((d) => d.type === 'wireless').slice(0, 16);
  const [portL, apL] = await Promise.all([
    Promise.all(sws.map((d) => opt(`/devices/${encodeURIComponent(d.serial)}/switch/ports/statuses`, MK_TTL.ports))),
    Promise.all(aps.map((d) => (netUp(d.status) ? opt(`/devices/${encodeURIComponent(d.serial)}/wireless/status`, MK_TTL.ap) : null))),
  ]);
  // clients
  const all = per.flatMap((x) => x.clients), byDev = {}, bySsid = {}, top = [];
  for (const c of all) {
    const online = String(c.status || 'Online').toLowerCase() === 'online', dev = c.recentDeviceSerial || null;
    if (online && dev) byDev[dev] = (byDev[dev] || 0) + 1;
    if (online && c.ssid) bySsid[c.ssid] = (bySsid[c.ssid] || 0) + 1;
    const kb = (Number(c.usage?.sent) || 0) + (Number(c.usage?.recv) || 0);
    top.push({ name: c.description || c.dhcpHostname || c.manufacturer || c.mac || 'Device', kb, down: Number(c.usage?.recv) || 0, up: Number(c.usage?.sent) || 0, ssid: c.ssid || null, dev, wired: /wired/i.test(c.recentDeviceConnection || ''), os: c.os || null, maker: c.manufacturer || null, online });
  }
  for (const d of devices) d.clients = byDev[d.id] ?? (['switch', 'wireless'].includes(d.type) ? 0 : null);
  const onlineC = top.filter((c) => c.online), bandTot = {};
  for (const p of per) for (const [b, v] of p.bands) bandTot[b] = (bandTot[b] || 0) + v;
  const clients = { total: onlineC.length, seen24h: top.length, wired: onlineC.filter((c) => c.wired).length, wireless: onlineC.filter((c) => !c.wired).length,
    bySsid: Object.entries(bySsid).sort((a, b) => b[1] - a[1]), byBand: Object.entries(bandTot).sort((a, b) => Number(a[0]) - Number(b[0])), top: top.sort((a, b) => b.kb - a.kb).slice(0, 25) };
  if (clients.total) nhPush(nh.clients, [now, clients.total]);
  // Wi-Fi: each access point's radios (channel, width, power from its status; how busy from the org's utilization)
  const utilBy = new Map((util || []).map((u) => [u.serial, u]));
  const wifi = { aps: aps.map((d, i) => {
    const bss = apL[i]?.basicServiceSets || [], u = utilBy.get(d.serial), radios = {};
    for (const x of bss) { if (!x.band) continue; const b = String(x.band).replace(/\s*GHz/i, ''); radios[b] ||= { band: b, ch: x.channel ?? null, width: x.channelWidth ?? null, power: x.power ?? null, ssids: [] }; if (x.ssidName && x.enabled !== false && !radios[b].ssids.includes(x.ssidName)) radios[b].ssids.push(x.ssidName); }
    for (const x of u?.byBand || []) { const b = String(x.band); (radios[b] ||= { band: b, ch: null, width: null, power: null, ssids: [] }).util = netRound(x.total?.percentage ?? x.wifi?.percentage, 0); radios[b].nonWifi = netRound(x.nonWifi?.percentage, 0); }
    return { id: d.id, name: d.name, status: d.status, model: d.model, clients: d.clients, radios: Object.values(radios).sort((a, b) => Number(a.band) - Number(b.band)) };
  }) };
  // switch ports
  const ports = sws.map((d, i) => ({ dev: d.id, name: d.name, model: d.model, status: d.status, ports: (portL[i] || []).slice(0, 60).map((p) => ({
    id: String(p.portId), enabled: p.enabled !== false, up: /connected/i.test(p.status || '') && !/dis/i.test(p.status || ''), uplink: !!p.isUplink, speed: p.speed || null, duplex: p.duplex || null,
    poe: !!p.poe?.isAllocated, watts: p.powerUsageInWh != null ? netRound(p.powerUsageInWh / 24, 1) : null, errors: (p.errors || []).slice(0, 3), warnings: (p.warnings || []).slice(0, 3), clients: p.clientCount ?? null,
    peer: p.lldp?.systemName || p.cdp?.deviceId || null, kb: p.usageInKb?.total ?? null })) }));
  // links from Meraki's link-layer map (LLDP/CDP): device to device only
  const links = [];
  for (const p of per) {
    const nodeDev = new Map((p.topo?.nodes || []).filter((x) => x.device?.serial).map((x) => [x.derivedId, x.device.serial]));
    for (const l of p.topo?.links || []) {
      const [e1, e2] = l.ends || []; if (!e1 || !e2) continue;
      const a = e1.device?.serial || nodeDev.get(e1.node?.derivedId), b = e2.device?.serial || nodeDev.get(e2.node?.derivedId);
      if (a && b && D.has(a) && D.has(b)) links.push({ a, b, label: [e1.discovered?.lldp?.portId || e1.discovered?.cdp?.portId, e2.discovered?.lldp?.portId || e2.discovered?.cdp?.portId].filter(Boolean).join(' - ') || null });
    }
  }
  // a cellular gateway feeding a gateway's WAN port: the LLDP link between them says which WAN
  for (const c of devices.filter((d) => d.type === 'cellular')) {
    const l = links.find((x) => x.a === c.id || x.b === c.id), g = l ? D.get(l.a === c.id ? l.b : l.a) : null;
    if (g?.type === 'appliance') { const w = uplinks.find((u) => u.dev === g.id && u.iface === 'wan2'); if (w) w.via = c.id; }
  }
  // events, newest first
  const events = per.flatMap((p) => p.events.map((e) => ({ at: e.occurredAt, type: e.type || null, text: e.description || e.type || 'Event', dev: e.deviceSerial || null, devName: e.deviceName || null, cat: e.category || null, client: e.clientDescription || null, net: p.n.name })))
    .filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60);
  // firmware per product, license
  const firmware = [];
  for (const p of per) for (const [prod, f] of Object.entries(p.fw?.products || {})) {
    if (!devices.some((d) => d.net === p.n.id && (d.type === prod || (prod === 'cellularGateway' && d.type === 'cellular')))) continue;
    firmware.push({ product: prod === 'cellularGateway' ? 'cellular' : prod, net: p.n.name, current: f.currentVersion?.shortName || f.currentVersion?.firmware || null, next: f.nextUpgrade?.toVersion?.shortName || null, at: f.nextUpgrade?.time || null, latest: f.availableVersions?.length ? f.availableVersions[f.availableVersions.length - 1]?.shortName || null : null });
  }
  const license = lic ? { status: lic.status || null, expires: lic.expirationDate ? (Number.isFinite(Date.parse(String(lic.expirationDate).replace(' UTC', ''))) ? new Date(Date.parse(String(lic.expirationDate).replace(' UTC', ''))).toISOString() : null) : null, counts: lic.licensedDeviceCounts || null } : null;
  return { kind: 'meraki', source: { id: s.id, name: s.name }, at: nowIso(), org: org.name || null, networks: wantNets.map((n) => ({ id: n.id, name: n.name })), devices, uplinks, links, clients, wifi, ports, events, firmware, license, notes: [...new Set(notes)].slice(0, 8), names: Object.fromEntries(netName) };
}

/* ---- UniFi (local Integration API): devices with their uplinks and ports, clients, gateway throughput ---- */
async function netDeepUnifi(s, secret) {
  const b = `${base(s.url)}/proxy/network/integration/v1`, H = { 'X-API-Key': secret || '' };
  const list = (j) => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : []);
  const get = (p, ttl) => cached(`unifi:${s.id}:${p}`, ttl, () => netRequest(`${b}${p}`, { headers: H }));
  const sites = list(await get('/sites?limit=50', 3600_000));
  const site = sites.find((x) => x.id === s.site) || sites.find((x) => /default/i.test(`${x.internalReference || ''} ${x.name || ''}`)) || sites[0];
  if (!site) throw new Error('no UniFi sites were found for this key');
  const S = `/sites/${encodeURIComponent(site.id)}`;
  const raw = list(await get(`${S}/devices?limit=200`, 100_000)).slice(0, 200);
  const det = await Promise.all(raw.slice(0, 40).map((d) => get(`${S}/devices/${encodeURIComponent(d.id)}`, 600_000).catch(() => null)));
  const stats = await Promise.all(raw.slice(0, 40).map((d) => (String(d.state).toUpperCase() === 'ONLINE' ? get(`${S}/devices/${encodeURIComponent(d.id)}/statistics/latest`, 100_000).catch(() => null) : null)));
  const cl = [];
  for (let off = 0; off < 1000; off += 200) { const page = await get(`${S}/clients?limit=200&offset=${off}`, 300_000).catch(() => null), rows = list(page); cl.push(...rows); if (rows.length < 200) break; }
  const byDev = {}; for (const c of cl) if (c.uplinkDeviceId) byDev[c.uplinkDeviceId] = (byDev[c.uplinkDeviceId] || 0) + 1;
  const devices = raw.map((d, i) => ({ id: d.id, name: d.name || d.model || 'UniFi device', model: d.model || null, type: netTypeOf({ model: d.model, features: d.features || det[i]?.features }), status: netStatusOf(d.state), net: site.id, ip: d.ipAddress || null, mac: d.macAddress || null,
    fw: det[i]?.firmwareVersion || d.firmwareVersion || null, fwUpdate: !!(det[i]?.firmwareUpdatable ?? d.firmwareUpdatable), clients: byDev[d.id] ?? null, uptime: stats[i]?.uptimeSec ?? null, cpu: stats[i]?.cpuUtilizationPct ?? null, mem: stats[i]?.memoryUtilizationPct ?? null }));
  const links = [];
  raw.forEach((d, i) => { const up = det[i]?.uplink?.deviceId; if (up && devices.some((x) => x.id === up)) links.push({ a: up, b: d.id }); });
  const gw = devices.find((d) => d.type === 'appliance'), gi = gw ? raw.findIndex((d) => d.id === gw.id) : -1;
  const uplinks = gw ? [{ dev: gw.id, iface: 'wan1', status: netUp(gw.status) ? 'active' : 'failed', ip: null, publicIp: null, rxBps: stats[gi]?.uplink?.rxRateBps ?? null, txBps: stats[gi]?.uplink?.txRateBps ?? null }] : [];
  const wifi = { aps: devices.filter((d) => d.type === 'wireless').slice(0, 16).map((d) => { const i = raw.findIndex((x) => x.id === d.id);
    return { id: d.id, name: d.name, status: d.status, model: d.model, clients: d.clients, radios: (det[i]?.interfaces?.radios || []).map((r) => ({ band: String(r.frequencyGHz ?? '').replace(/\.0$/, ''), ch: r.channel ?? null, width: r.channelWidthMHz ?? null, retries: (stats[i]?.interfaces?.radios || []).find((x) => x.frequencyGHz === r.frequencyGHz)?.txRetriesPct ?? null, std: r.wlanStandard || null })) }; }) };
  const ports = devices.filter((d) => d.type === 'switch' || (d.type === 'appliance' && det[raw.findIndex((x) => x.id === d.id)]?.interfaces?.ports?.length)).slice(0, 12).map((d) => { const i = raw.findIndex((x) => x.id === d.id);
    return { dev: d.id, name: d.name, model: d.model, status: d.status, ports: (det[i]?.interfaces?.ports || []).slice(0, 60).map((p) => ({ id: String(p.idx), enabled: true, up: String(p.state).toUpperCase() === 'UP', uplink: false, speed: p.speedMbps ? (p.speedMbps >= 1000 ? `${p.speedMbps / 1000} Gbps` : `${p.speedMbps} Mbps`) : null, poe: !!(p.poe?.enabled && String(p.poe?.state).toUpperCase() === 'UP'), errors: [], warnings: [], clients: null, peer: null })) }; });
  const wired = cl.filter((c) => String(c.type).toUpperCase() === 'WIRED').length, wl = cl.filter((c) => String(c.type).toUpperCase() === 'WIRELESS').length;
  const clients = { total: cl.length, wired, wireless: wl, bySsid: [], byBand: [], top: [] };
  if (cl.length) nhPush(nh.clients, [Date.now(), cl.length]);
  const firmware = devices.filter((d) => d.fwUpdate).map((d) => ({ product: d.type, dev: d.name, current: d.fw, next: null, at: null, latest: null, update: true }));
  return { kind: 'unifi', source: { id: s.id, name: s.name }, at: nowIso(), org: site.name || null, networks: [{ id: site.id, name: site.name || 'Default' }], devices, uplinks, links, clients, wifi, ports, events: [], firmware, license: null, notes: [] };
}

/* ---- run after each quick read (74-network.js) ---- */
const netDeepBusy = new Set();
async function netDeepRead(s) {
  if (netDeepBusy.has(s.id) || !['meraki', 'unifi'].includes(s.kind) || !proStatus().pro) return;
  netDeepBusy.add(s.id);
  const st = (netState[s.id] ||= { fails: 0 });
  try { st.deep = await (s.kind === 'meraki' ? netDeepMeraki : netDeepUnifi)(s, secretOf(s.secret)); st.deepError = null; }
  catch (e) { st.deepError = String(e.message || e).slice(0, 140); }
  finally { netDeepBusy.delete(s.id); }
}
/* The richest source: Meraki first, then UniFi. */
const netMainSource = () => netSources().filter((s) => ['meraki', 'unifi'].includes(s.kind)).sort((a, b) => (a.kind === 'meraki' ? 0 : 1) - (b.kind === 'meraki' ? 0 : 1))[0] || null;

/* Alerts beyond "a device is offline" (74-network.js): a WAN down while another carries the house, a license running out. */
function netModelAlerts() {
  if (isDemo() || !proStatus().pro) return [];
  const out = [];
  for (const s of netSources()) {
    const m = netState[s.id]?.deep; if (!m) continue;
    const name = (id) => m.devices.find((d) => d.id === id)?.name || id;
    for (const u of m.uplinks || []) if (u.status === 'failed') out.push({ id: `netwan:${s.id}:${u.dev}:${u.iface}`, severity: 'warning', title: `${name(u.dev)}: ${NET_IFACE[u.iface] || u.iface} is down`, body: m.uplinks.some((x) => x.status === 'active') ? 'The house is online through another connection.' : '', source: 'network', url: '/#network' });
    const exp = m.license?.expires ? Math.round((Date.parse(m.license.expires) - Date.now()) / 86400_000) : null;
    if (exp != null && exp <= 30) out.push({ id: `netlic:${s.id}`, severity: exp <= 7 ? 'warning' : 'notice', title: exp < 0 ? `${s.name}: the license has expired` : `${s.name}: the license ends in ${exp} days`, source: 'network', url: '/#network' });
  }
  return out;
}

/* ---- what the page gets ---- */
/* Only an admin (or the owner when sign-in is off) sees public addresses; wall panels and viewers never get them. */
const netCanSeeIps = (req) => !req.user?.panel && (!signInOn() || ['owner', 'admin'].includes(req.user?.role));
function netMaskModel(m, canIp) {
  if (!m) return null;
  const out = JSON.parse(JSON.stringify(m)); delete out.names;
  if (!canIp) for (const u of out.uplinks || []) { u.publicIp = null; u.ip = u.ip && isLanHost(u.ip) ? u.ip : null; u.gateway = null; u.dns = []; u.target = null; }
  return out;
}
function netHistoryView(m, demo = false) {
  const h = demo ? netDemoHistory() : nh, up = {};
  for (const u of m?.uplinks || []) { const k = `${u.dev}:${u.iface}`; if (h.up[k]) up[k] = h.up[k]; }
  return { inet: h.inet.slice(-NH_KEEP), speed: h.speed.slice(-60), clients: h.clients.slice(-NH_KEEP), up };
}
app.get('/api/network/overview', (req, res) => {
  const canIp = isDemo() || netCanSeeIps(req);
  if (isDemo()) { const m = netDemoModel(); return res.json({ pro: true, demo: true, canIp, at: nowIso(), source: { id: 'demo-meraki', kind: 'meraki', name: 'Cisco Meraki', ok: true }, model: netMaskModel(m, canIp), topo: netTopology(m), history: netHistoryView(m, true) }); }
  const pro = !!proStatus().pro, s = pro ? netMainSource() : null, st = s ? netState[s.id] : null, m = st?.deep || null;
  res.json({ pro, demo: false, canIp, at: nowIso(), source: s ? { id: s.id, kind: s.kind, name: s.name, ok: st?.ok ?? null, error: st?.error || st?.deepError || null, reading: !m && !st?.deepError } : null,
    model: netMaskModel(m, canIp), topo: m ? netTopology(m) : null, history: pro ? netHistoryView(m) : { inet: nh.inet.slice(-NH_KEEP), speed: nh.speed.slice(-60), clients: [], up: {} } });
});
/* The page's suggested tiles (60-layout.js asks): from what is connected. Counts and yes/no only. */
async function netPageFacts() {
  if (isDemo()) { const m = netDemoModel(); return { pro: true, rich: true, ...netModelFacts(m), dns: true, tests: 6, monitors: 5, security: true }; }
  const pro = !!proStatus().pro, s = pro ? netMainSource() : null, m = s ? netState[s.id]?.deep : null;
  return { pro, rich: !!s, ...netModelFacts(m), dns: netSources().some((x) => ['pihole', 'adguard'].includes(x.kind)), tests: (typeof atCfg === 'function' ? atCfg() : []).length,
    monitors: (config.monitors || []).length, security: typeof sec === 'object' ? !!sec.available : false };
}
function netModelFacts(m) {
  if (!m) return { aps: 0, switches: 0, devices: 0, events: false, firmware: false, clientsTop: false, uplinks: 0 };
  return { aps: m.devices.filter((d) => d.type === 'wireless').length, switches: (m.ports || []).filter((p) => p.ports.length).length, devices: m.devices.length, events: (m.events || []).length > 0,
    firmware: (m.firmware || []).length > 0 || !!m.license, clientsTop: (m.clients?.top || []).length > 0, uplinks: (m.uplinks || []).length };
}
/** Sizes in 12ths of a desktop row (w) and rows of 78 px (h). Pure: the same facts give the same layout. */
function netSuggest(f = {}) {
  const out = [], add = (id, w, h) => out.push({ id, w, h });
  if (!f.rich) {
    add('net-internet', 4, 3); add('net-speed', 4, 3); add('net-topo', 4, 3);
    add('net-apptests', 8, 4); add(f.security ? 'net-security' : 'net-start', 4, 4);
    if (f.dns) add('net-dns', 4, 3);
    add('net-start', f.dns ? 8 : 12, 3);
    if (f.pro || f.monitors) add('net-servers', 6, 4);
    add('net-sources', 6, 4);
    return out.filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);
  }
  add('net-internet', 4, 3); add('net-devices', 4, 3); add(f.aps ? 'net-wifi' : 'net-speed', 4, 3);
  add('net-topo', 8, 6); add(f.events ? 'net-events' : 'net-security', 4, 6);
  if (f.clientsTop) add('net-clients', 4, 4);
  if (f.switches) add('net-ports', 4, 4);
  add('net-apptests', f.clientsTop && f.switches ? 4 : 8, 4);
  if (f.aps) add('net-speed', 4, 2);
  if (f.dns) add('net-dns', 4, 2);
  if (f.events && f.security) add('net-security', 4, 2);
  if (f.firmware) add('net-health', 6, 3);
  if (f.pro || f.monitors) add('net-servers', 6, 3);
  add('net-sources', f.firmware ? 12 : 6, 3);
  return out;
}
