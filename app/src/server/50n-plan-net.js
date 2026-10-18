/* ======================================================================
 * 3D Home: your network on the plan, and a vacuum's map to trace over.
 *
 *   GET /api/floorplan/network     what can be placed and how it is: Wi-Fi access points and other network
 *                                  gear (UniFi / Meraki, from the Network tab), the servers you watch, and
 *                                  the internet "modem" (online or not, plus a summary of your app tests)
 *   PUT /api/floorplan/net-pins    where each one sits: [{ ref, floor, pos: [x, y, z] }]
 *   GET /api/floorplan/vacuum-maps            Home Assistant camera/image entities that are a vacuum's map
 *                                             (Valetudo, Roborock, Xiaomi / Dreame map extractors), with the
 *                                             scale when the entity's attributes give one
 *   GET /api/floorplan/vacuum-maps/image?entity=...   that picture (the token stays on the box)
 *
 * Only reading: nothing here changes anything on the network, a server or a vacuum.
 * ====================================================================== */
const FPN_REF = /^(modem|mon:[\w-]{1,40}|net:[\w-]{1,40}:[^\u0000-\u001f]{1,100})$/;
/** What a piece of network gear is, from its type, model and name. */
function fpnKind(d) {
  const t = String(d.type || '').toLowerCase(), m = String(d.model || ''), n = String(d.name || '');
  if (Array.isArray(d.features) && d.features.includes('accessPoint')) return 'ap';
  if (t === 'wireless' || /^(U6|U7|UAP|UAL|UAC|E7|UK-|UWB|ULR|MR\d|CW\d)/i.test(m) || /\b(AP|access point|wi-?fi)\b/i.test(n)) return 'ap';
  if (t === 'appliance' || t === 'cellulargateway' || /^(UDM|UDR|UXG|USG|UCG|UX\b|MX\d|Z\d)/i.test(m) || /\b(dream|gateway|router|firewall)\b/i.test(n)) return 'gateway';
  if (t === 'switch' || /^(USW|US-|MS\d)/i.test(m) || /\bswitch\b/i.test(n)) return 'switch';
  return 'device';
}
/* UniFi: how many devices each access point has connected (the clients list says which device each one is on). */
async function fpnUnifiClients(s) {
  return cached(`fpn:unifi:${s.id}`, 120_000, async () => {
    const b = `${String(s.url || '').replace(/\/+$/, '')}/proxy/network/integration/v1`, H = { 'X-API-Key': secretOf(s.secret) || '' };
    const list = (j) => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : []);
    const sites = list(await netRequest(`${b}/sites?limit=50`, { headers: H }));
    const site = sites.find((x) => x.id === s.site) || sites.find((x) => /default/i.test(`${x.internalReference || ''} ${x.name || ''}`)) || sites[0]; if (!site) return { byName: {} };
    const devs = list(await netRequest(`${b}/sites/${encodeURIComponent(site.id)}/devices?limit=200`, { headers: H })), counts = {};
    for (let off = 0; off < 1000; off += 200) {
      const page = await netRequest(`${b}/sites/${encodeURIComponent(site.id)}/clients?limit=200&offset=${off}`, { headers: H }), rows = list(page);
      for (const c of rows) if (c.uplinkDeviceId) counts[c.uplinkDeviceId] = (counts[c.uplinkDeviceId] || 0) + 1;
      if (rows.length < 200) break;
    }
    const byName = {}; for (const d of devs) byName[d.name || d.model || d.macAddress] = { clients: counts[d.id] ?? 0, features: d.features || null };
    return { byName };
  });
}
const FPN_DEMO_CLIENTS = { 'Living Room AP': 23, 'Upstairs AP': 17, 'Garage AP': 0 };
async function fpnThings(d) {
  const placed = new Set((d.netPins || []).map((p) => p.ref)), out = [];
  const sources = isDemo() ? DEMO_NET : netSources().map(netView);
  for (const s of sources) {
    if (!['unifi', 'meraki'].includes(s.kind)) continue;
    let per = null;
    if (s.kind === 'unifi' && !isDemo() && (s.devices || []).some((x) => placed.has(`net:${s.id}:${x.name}`))) { const raw = netSources().find((x) => x.id === s.id); per = raw ? await fpnUnifiClients(raw).catch(() => null) : null; }
    for (const x of (s.devices || []).slice(0, 200)) {
      const p = per?.byName?.[x.name], kind = fpnKind({ ...x, features: p?.features });
      const clients = isDemo() ? FPN_DEMO_CLIENTS[x.name] ?? null : p ? p.clients : null;
      out.push({ ref: `net:${s.id}:${String(x.name).slice(0, 100)}`, name: x.name, kind, source: s.kindName || s.kind, model: x.model || null, online: s.ok === false ? null : !!x.online, clients: x.online === false ? 0 : clients });
    }
  }
  const mons = isDemo() ? DEMO_MON.map(([name, target, ms], i) => ({ id: `demo${i}`, name, target, up: ms != null, down: ms == null, ms }))
    : proStatus().pro ? monitorsCfg().map((m) => monView(m, mon.state[m.id])) : [];
  for (const m of mons) out.push({ ref: `mon:${m.id}`, name: m.name, kind: 'server', source: 'Server monitor', online: m.down ? false : m.up == null ? null : !!m.up, ms: m.ms ?? null });
  return { list: out, sources };
}
async function fpnInternet() {
  const i = isDemo() ? demoFixture('internet') : await cached('fpn:internet', 30_000, internetNow).catch(() => null);
  if (!i) return null;
  return { online: i.online !== false, provider: i.provider || null, ms: i.latencyMs?.cloudflare ?? i.latencyMs?.google ?? null, routerMs: i.latencyMs?.router ?? null, down: i.speed?.downMbps ?? null, up: i.speed?.upMbps ?? null };
}
function fpnTests() {
  try {
    const list = isDemo() ? atDemo().tests : atCfg().map((t) => atView(t));
    if (!list.length) return null;
    const down = list.filter((t) => t.down), slow = list.filter((t) => !t.down && t.slow);
    return { total: list.length, ok: list.length - down.length - slow.length, slow: slow.length, down: down.length, names: [...down, ...slow].slice(0, 4).map((t) => ({ name: t.name, down: !!t.down, culprit: t.culprit?.who || null })) };
  } catch { return null; }
}
/* The demo house has its network placed already: the internet box and the NAS by the network rack in the office,
   two access points and the one that is offline. */
const FPN_DEMO_PINS = [['modem', 'ground', [0.9, 1.0, 8.2]], ['net:demo-unifi:Living Room AP', 'ground', [3.5, 2.5, 3.6]], ['net:demo-unifi:Upstairs AP', 'upstairs', [6.2, 2.5, 4.2]],
  ['net:demo-unifi:Garage AP', 'ground', [11.2, 2.5, 8.6]], ['mon:demo0', 'ground', [1.6, 0.7, 8.6]], ['mon:demo4', 'top', [10.5, 0.7, 7.5]]];
app.get('/api/floorplan/network', async (_req, res) => {
  const d = fpData();
  if (isDemo() && !Array.isArray(d.netPins)) d.netPins = FPN_DEMO_PINS.filter(([, f]) => d.floors.some((x) => x.id === f)).map(([ref, floor, pos]) => ({ ref, floor, pos }));
  const [{ list, sources }, internet] = await Promise.all([fpnThings(d).catch(() => ({ list: [], sources: [] })), fpnInternet()]);
  const clients = sources.filter((x) => ['unifi', 'meraki'].includes(x.kind)).reduce((s, x) => s + (Number(x.summary?.clients) || 0), 0) || null;   // devices on the network (DNS filters count the same ones again)
  list.unshift({ ref: 'modem', name: 'Internet', kind: 'modem', online: internet ? internet.online : null, internet, tests: fpnTests(), clients });
  res.json({ pins: (d.netPins || []).filter((p) => d.floors.some((f) => f.id === p.floor)), things: list, connected: { network: sources.some((s) => ['unifi', 'meraki'].includes(s.kind)), monitors: list.some((x) => x.kind === 'server') } });
});
app.put('/api/floorplan/net-pins', requirePro, express.json({ limit: '256kb' }), (req, res) => {
  const d = fpData(), floors = new Set(d.floors.map((f) => f.id)), seen = new Set();
  d.netPins = (Array.isArray(req.body?.pins) ? req.body.pins : []).filter((p) => p && typeof p.ref === 'string' && FPN_REF.test(p.ref) && floors.has(p.floor) && Array.isArray(p.pos) && p.pos.length === 3 && p.pos.every((v) => fin(v, -1000, 1000)) && !seen.has(p.ref) && seen.add(p.ref))
    .slice(0, 200).map((p) => ({ ref: p.ref, floor: p.floor, pos: p.pos.map((n) => Math.round(n * 1000) / 1000) }));
  fpWrite(d); res.json({ ok: true, pins: d.netPins });
});

/* ---- a vacuum's map as the picture to trace ---- */
const VM_HINT = /(map|valetudo|roborock|xiaomi|dreame|roomba|vacuum|rockrobo|deebot)/i;
/** Meters per pixel from a map entity's attributes, when they say. Calibration points pair the vacuum's own
 *  coordinates (millimeters for Xiaomi/Roborock/Dreame, centimeters for Valetudo) with the picture's pixels. */
function vmScale(a = {}) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const direct = n(a.meters_per_pixel) ?? n(a.metersPerPixel) ?? n(a.mpp);
  if (direct && direct < 2) return { mpp: direct, how: 'attribute' };
  const px = n(a.pixel_size) ?? n(a.pixelSize);   // Valetudo: centimeters per pixel
  if (px && px < 100) return { mpp: px / 100, how: 'pixel size' };
  const cp = Array.isArray(a.calibration_points) ? a.calibration_points.filter((p) => p?.vacuum && p?.map) : [];
  for (let i = 0; i < cp.length; i++) for (let j = i + 1; j < cp.length; j++) {
    const dv = Math.hypot(cp[i].vacuum.x - cp[j].vacuum.x, cp[i].vacuum.y - cp[j].vacuum.y), dm = Math.hypot(cp[i].map.x - cp[j].map.x, cp[i].map.y - cp[j].map.y);
    if (dv > 0 && dm > 0) { const r = dv / dm; return { mpp: r >= 8 ? r / 1000 : r / 100, how: 'calibration' }; }   // over 8 units a pixel can only be millimeters
  }
  return null;
}
const vmSource = (id, a = {}) => { const s = `${id} ${a.friendly_name || ''}`; return /valetudo/i.test(s) ? 'Valetudo' : /roborock|rockrobo/i.test(s) ? 'Roborock' : /xiaomi|mijia|dreame/i.test(s) || a.calibration_points ? 'Xiaomi' : 'map'; };
const VM_DEMO = 'camera.demo_vacuum_map';
async function vmList() {
  if (isDemo()) return [{ entity: VM_DEMO, name: 'Robot vacuum map (sample)', source: 'Valetudo', mpp: 0.05, how: 'pixel size', w: 300, h: 220 }];
  const states = await haStates().catch(() => []);
  return states.filter((s) => /^(camera|image)\.[\w]+$/.test(s.entity_id) && (VM_HINT.test(`${s.entity_id} ${s.attributes?.friendly_name || ''}`) || Array.isArray(s.attributes?.calibration_points)))
    .filter((s) => !/doorbell|driveway|porch|garden|front_door|backyard/i.test(s.entity_id))
    .slice(0, 20).map((s) => { const sc = vmScale(s.attributes); return { entity: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, source: vmSource(s.entity_id, s.attributes), mpp: sc?.mpp ?? null, how: sc?.how || null }; });
}
/* The demo's map: a small house as a vacuum draws it (5 cm a pixel, so 15 x 11 m). */
function vmDemoPng() {
  const W = 300, H = 220, px = Buffer.alloc(W * H * 4);
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; } };
  const rooms = [[10, 10, 150, 120, [125, 176, 230]], [150, 10, 290, 95, [146, 204, 160]], [150, 95, 290, 210, [240, 196, 120]], [10, 120, 150, 210, [196, 160, 220]]];
  for (const [x0, y0, x1, y1, c] of rooms) rect(x0, y0, x1, y1, c);
  for (const [x0, y0, x1, y1] of rooms) { rect(x0, y0, x1, y0 + 3, [70, 78, 92]); rect(x0, y1 - 3, x1, y1, [70, 78, 92]); rect(x0, y0, x0 + 3, y1, [70, 78, 92]); rect(x1 - 3, y0, x1, y1, [70, 78, 92]); }
  for (const [x0, y0, x1, y1] of [[60, 117, 90, 123], [147, 40, 153, 70], [147, 140, 153, 170], [200, 92, 230, 98]]) rect(x0, y0, x1, y1, [235, 238, 242]);   // doorways
  rect(276, 196, 284, 204, [40, 200, 120]);   // the dock
  const raw = Buffer.alloc((W * 4 + 1) * H); for (let y = 0; y < H; y++) px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  const chunk = (t, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(pzCrc(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
app.get('/api/floorplan/vacuum-maps', async (_req, res) => {
  res.json({ connected: isDemo() || !!config.homeAssistant?.url, maps: await vmList().catch(() => []) });
});
app.get('/api/floorplan/vacuum-maps/image', async (req, res) => {
  const ent = String(req.query.entity || '');
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (isDemo() && ent === VM_DEMO) { res.setHeader('Content-Type', 'image/png'); return res.end(vmDemoPng()); }
  const h = config.homeAssistant; if (!h?.url || !/^(camera|image)\.[\w]+$/.test(ent)) return res.status(404).json({ error: 'No such map.' });
  if (!(await vmList().catch(() => [])).some((m) => m.entity === ent)) return res.status(404).json({ error: 'No such map.' });
  try {
    const r = await fetch(`${h.url}/api/${ent.startsWith('image.') ? 'image_proxy' : 'camera_proxy'}/${ent}`, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(502).json({ error: `Home Assistant answered ${r.status}.` });
    const buf = Buffer.from(await r.arrayBuffer()), t = BG_TYPES.find(([, , ok]) => ok(buf));
    if (!t) return res.status(415).json({ error: 'That map is not a PNG, JPEG or WebP picture.' });
    res.setHeader('Content-Type', t[1]); res.end(buf);
  } catch (e) { res.status(502).json({ error: `Home Assistant did not send the map: ${String(e.message || e).slice(0, 80)}` }); }
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchPlanNet = { fpnKind, vmScale, vmSource, FPN_REF };
