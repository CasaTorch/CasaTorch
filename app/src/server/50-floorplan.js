/* ======================================================================
 * 3D floor plan - HouseOS Pro.
 *
 * Each floor is either a 3D model from a phone/tablet LiDAR scan (Polycam,
 * Scaniverse, 3D Scanner App - exported as .glb), or a plan drawn in the app
 * (rooms and walls, optionally traced over a floor-plan picture) that HouseOS
 * turns into 3D. No LiDAR device needed for the drawn kind. People
 * place their devices on it by clicking where they are; the plan then shows
 * them live: lights glowing when on, what is playing, watts per plug and for
 * the house, doors, leaks, temperatures, cameras.
 *
 * Stored in data/floorplan/: one .glb per floor + floorplan.json
 *   { floors: [{ id, name, kind: scan|drawn, file?, plan?: { rooms, walls, bg, bgW, bgOpacity }, level, heightM, rotationY, scale, offset: [x,z] }],
 *     pins:   [{ deviceId, floor, pos: [x, y, z], label? }] }
 * ====================================================================== */
const FP_DIR = path.join(DATA_DIR, 'floorplan');
const FP_FILE = path.join(FP_DIR, 'floorplan.json');
fs.mkdirSync(FP_DIR, { recursive: true });
const fpRead = () => { try { return JSON.parse(fs.readFileSync(FP_FILE, 'utf8')); } catch { return { floors: [], pins: [] }; } };
let demoFp = null;   // the demo can be edited, but only in memory
const fpWrite = (d) => { if (isDemo()) { demoFp = d; return; } fs.writeFileSync(`${FP_FILE}.tmp`, JSON.stringify(d, null, 2)); fs.renameSync(`${FP_FILE}.tmp`, FP_FILE); };
const DEMO_FP = path.join(APP_DIR, '..', 'demo', 'floorplan');
const fpData = () => (isDemo() ? (demoFp ||= JSON.parse(fs.readFileSync(path.join(DEMO_FP, 'floorplan.json'), 'utf8'))) : fpRead());
app.use('/vendor/three', express.static(path.join(APP_DIR, 'node_modules', 'three'), { maxAge: '7d' }));

app.get('/api/floorplan', (_req, res) => res.json({ ...fpData(), pro: proStatus() }));
app.get('/api/floorplan/floors/:id/model', (req, res) => {
  const f = fpData().floors.find((x) => x.id === req.params.id);
  if (!f || !/^[\w-]+\.glb$/.test(f.file)) return res.status(404).end();
  res.setHeader('Content-Type', 'model/gltf-binary');
  const own = path.join(FP_DIR, f.file);
  res.sendFile(fs.existsSync(own) ? own : path.join(DEMO_FP, f.file));
});
/* Upload a floor: the raw .glb as the body. A glTF binary starts with "glTF". */
app.post('/api/floorplan/floors', requirePro, express.raw({ type: '*/*', limit: '300mb' }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.subarray(0, 4).toString() !== 'glTF') return res.status(400).json({ error: 'That is not a .glb file. In your scanning app, export as GLB (binary glTF).' });
  const d = fpData(), id = `f${Date.now().toString(36)}`;
  fs.writeFileSync(path.join(FP_DIR, `${id}.glb`), buf);
  const level = d.floors.length;
  d.floors.push({ id, name: String(req.query.name || `Floor ${level + 1}`).slice(0, 40), file: `${id}.glb`, level, heightM: 3, rotationY: 0, scale: 1, offset: [0, 0] });
  fpWrite(d); res.json({ ok: true, id });
});
app.put('/api/floorplan/floors/:id', requirePro, express.json(), (req, res) => {
  const d = fpData(), f = d.floors.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'no such floor' });
  const b = req.body || {}, num = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : dflt);
  Object.assign(f, { name: b.name ? String(b.name).slice(0, 40) : f.name, level: num(b.level, 0, 9, f.level), heightM: num(b.heightM, 1.5, 10, f.heightM), rotationY: num(b.rotationY, -360, 360, f.rotationY), scale: num(b.scale, 0.01, 100, f.scale),
    offset: Array.isArray(b.offset) ? [num(b.offset[0], -1000, 1000, 0), num(b.offset[1], -1000, 1000, 0)] : f.offset });
  fpWrite(d); res.json({ ok: true, floor: f });
});
app.delete('/api/floorplan/floors/:id', requirePro, (req, res) => {
  const d = fpData(); d.floors = d.floors.filter((x) => x.id !== req.params.id); d.pins = d.pins.filter((p) => p.floor !== req.params.id);
  fpWrite(d); res.json({ ok: true });   // the .glb stays on disk until a cleanup; nothing is lost by a mis-tap
});
/* ---- drawn floors: rooms + walls (meters), optionally over a floor-plan picture ---- */
const fin = (v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
app.post('/api/floorplan/floors/drawn', requirePro, express.json(), (req, res) => {
  const d = fpData(), id = `d${Date.now().toString(36)}`, level = d.floors.length;
  const f = { id, kind: 'drawn', name: String(req.body?.name || `Floor ${level + 1}`).slice(0, 40), level, heightM: 2.7, rotationY: 0, scale: 1, offset: [0, 0], plan: { rooms: [], walls: [], bg: null, bgW: 15, bgOpacity: 0.6 } };
  d.floors.push(f); fpWrite(d); res.json({ ok: true, floor: f });
});
app.put('/api/floorplan/floors/:id/plan', requirePro, express.json({ limit: '1mb' }), (req, res) => {
  const d = fpData(), f = d.floors.find((x) => x.id === req.params.id);
  if (!f || f.kind !== 'drawn') return res.status(404).json({ error: 'no such drawn floor' });
  const b = req.body || {};
  const rooms = (Array.isArray(b.rooms) ? b.rooms : []).filter((r) => [r.x, r.y].every((v) => fin(v, -500, 500)) && fin(r.w, 0.2, 200) && fin(r.h, 0.2, 200)).slice(0, 200)
    .map((r) => ({ name: String(r.name || '').slice(0, 30), x: +(+r.x).toFixed(2), y: +(+r.y).toFixed(2), w: +(+r.w).toFixed(2), h: +(+r.h).toFixed(2) }));
  const walls = (Array.isArray(b.walls) ? b.walls : []).filter((w) => Array.isArray(w) && w.length === 4 && w.every((v) => fin(v, -500, 500))).slice(0, 1000).map((w) => w.map((v) => +(+v).toFixed(2)));
  f.plan = { ...f.plan, rooms, walls, bgW: fin(b.bgW, 1, 500) ? +b.bgW : f.plan.bgW, bgOpacity: fin(b.bgOpacity, 0, 1) ? +b.bgOpacity : f.plan.bgOpacity };
  if (b.name) f.name = String(b.name).slice(0, 40);
  fpWrite(d); res.json({ ok: true, floor: f });
});
const BG_TYPES = [['png', 'image/png', (x) => x.subarray(0, 4).toString('hex') === '89504e47'], ['jpg', 'image/jpeg', (x) => x[0] === 0xff && x[1] === 0xd8], ['webp', 'image/webp', (x) => x.subarray(0, 4).toString() === 'RIFF' && x.subarray(8, 12).toString() === 'WEBP']];
app.post('/api/floorplan/floors/:id/background', requirePro, express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
  const d = fpData(), f = d.floors.find((x) => x.id === req.params.id);
  if (!f || f.kind !== 'drawn') return res.status(404).json({ error: 'no such drawn floor' });
  const t = BG_TYPES.find(([, , ok]) => Buffer.isBuffer(req.body) && ok(req.body));
  if (!t) return res.status(415).json({ error: 'use a PNG, JPEG or WebP picture of the floor plan (for a PDF, take a screenshot of it)' });
  const file = `${f.id}-bg.${t[0]}`; fs.writeFileSync(path.join(FP_DIR, file), req.body, { mode: 0o600 });
  f.plan = { ...f.plan, bg: file }; fpWrite(d); res.json({ ok: true, floor: f });
});
app.get('/api/floorplan/floors/:id/background', (req, res) => {
  const f = fpData().floors.find((x) => x.id === req.params.id);
  if (!f?.plan?.bg || !/^[\w-]+\.(png|jpg|webp)$/.test(f.plan.bg)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.sendFile(path.join(FP_DIR, f.plan.bg));
});
app.put('/api/floorplan/pins', requirePro, express.json({ limit: '1mb' }), (req, res) => {
  const d = fpData(), floors = new Set(d.floors.map((f) => f.id));
  d.pins = (Array.isArray(req.body?.pins) ? req.body.pins : []).filter((p) => floors.has(p.floor) && Array.isArray(p.pos) && p.pos.length === 3 && p.pos.every(Number.isFinite))
    .slice(0, 500).map((p) => ({ deviceId: String(p.deviceId).slice(0, 200), floor: p.floor, pos: p.pos.map((n) => Math.round(n * 1000) / 1000), label: p.label ? String(p.label).slice(0, 40) : null }));
  fpWrite(d); res.json({ ok: true, pins: d.pins.length });
});
/* Live: every placed device's state + the house totals shown on top of the plan. */
app.get('/api/floorplan/live', async (_req, res) => {
  const d = fpData();
  const { devices } = await houseDevices();
  const byId = new Map(devices.map((x) => [x.id, x]));
  const powerW = devices.filter((x) => x.powerW != null).reduce((a, x) => a + x.powerW, 0);
  res.json({
    pins: d.pins.map((p) => ({ ...p, device: byId.get(p.deviceId) || { id: p.deviceId, name: p.label || p.deviceId, online: false } })),
    devices: devices.map((x) => ({ id: x.id, name: x.name, kind: x.kind, provider: x.provider })),
    totals: { powerW: Math.round(powerW), lightsOn: devices.filter((x) => x.kind === 'light' && x.on).length, playing: devices.filter((x) => x.playing).map((x) => ({ name: x.name, title: x.title })), openDoors: devices.filter((x) => x.open).length, leaks: devices.filter((x) => x.water).length },
  });
});
