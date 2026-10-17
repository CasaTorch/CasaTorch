/* ======================================================================
 * 3D floor plan - CasaTorch Pro.
 *
 * Each floor is either a 3D model from a phone/tablet LiDAR scan (Polycam,
 * Scaniverse, 3D Scanner App - exported as .glb), or a plan drawn in the app
 * (rooms and walls, optionally traced over a floor-plan picture) that CasaTorch
 * turns into 3D. No LiDAR device needed for the drawn kind. People
 * place their devices on it by clicking where they are; the plan then shows
 * them live: lights glowing when on, what is playing, watts per plug and for
 * the house, doors, leaks, temperatures, cameras.
 *
 * Stored in data/floorplan/: one .glb per floor + floorplan.json
 *   { floors: [{ id, name, kind: scan|drawn, file?, plan?: { rooms, walls, bg, bgW, bgOpacity }, level, heightM, rotationY, scale, offset: [x,z] }],
 *       + rooms?: [{ name, color, pos: [x, z] }], paint?: { item: '#hex' }, look?: auto|styled|original
 *     pins:   [{ deviceId, floor, pos: [x, y, z], label?, color? }], style?: { theme, colors: { theme: { key: '#hex' } } } }
 * ====================================================================== */
const FP_DIR = path.join(DATA_DIR, 'floorplan');
const FP_HEX = /^#[0-9a-f]{6}$/i;
const fin = (v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
const FP_FILE = path.join(FP_DIR, 'floorplan.json');
fs.mkdirSync(FP_DIR, { recursive: true, mode: 0o700 });
const fpRead = () => { try { return JSON.parse(fs.readFileSync(FP_FILE, 'utf8')); } catch { return { floors: [], pins: [] }; } };
let demoFp = null;   // the demo can be edited, but only in memory
const fpWrite = (d) => { if (isDemo()) { demoFp = d; return; } writeFileSafe(FP_FILE, JSON.stringify(d, null, 2), 0o600); };
const DEMO_FP = path.join(APP_DIR, '..', 'demo', 'floorplan');
/* The dark look was once called "neon"; plans saved then are read as "night". */
const fpTheme = (d) => { if (d?.style?.theme === 'neon') d.style.theme = 'night'; if (d?.style?.colors?.neon) { d.style.colors.night ||= d.style.colors.neon; delete d.style.colors.neon; } if (d?.view?.theme === 'neon') d.view.theme = 'night'; return d; };
const fpData = () => fpTheme(isDemo() ? (demoFp ||= JSON.parse(fs.readFileSync(path.join(DEMO_FP, 'floorplan.json'), 'utf8'))) : fpRead());
/* three.js: compressed (Brotli/gzip, kept in memory) and cached for a week - 2.7 MB becomes about 0.6 MB. */
app.use((req, res, next) => (req.path.startsWith('/vendor/three/') ? staticPacked(req, res, next) : next()));
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
  writeFileSafe(path.join(FP_DIR, `${id}.glb`), buf, 0o600);
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
  if (['auto', 'styled', 'original'].includes(b.look)) f.look = b.look;
  if (Array.isArray(b.rooms)) f.rooms = b.rooms.filter((r) => Array.isArray(r?.pos) && r.pos.length === 2 && r.pos.every((v) => fin(v, -1000, 1000))).slice(0, 60)
    .map((r) => ({ name: String(r.name || 'Room').slice(0, 30), color: FP_HEX.test(r.color) ? r.color : '#38bdf8', pos: r.pos.map((v) => +(+v).toFixed(2)) }));
  if (Array.isArray(b.hiddenParts)) f.hiddenParts = [...new Set(b.hiddenParts.filter((k) => typeof k === 'string' && k.length && k.length <= 120))].slice(0, 2000);
  if (b.paint && typeof b.paint === 'object') f.paint = Object.fromEntries(Object.entries(b.paint).filter(([k, v]) => k.length <= 120 && FP_HEX.test(v)).slice(0, 800));
  fpWrite(d); res.json({ ok: true, floor: f });
});
app.delete('/api/floorplan/floors/:id', requirePro, (req, res) => {
  const d = fpData(); d.floors = d.floors.filter((x) => x.id !== req.params.id); d.pins = d.pins.filter((p) => p.floor !== req.params.id);
  fpWrite(d); res.json({ ok: true });   // the .glb stays on disk until a cleanup; nothing is lost by a mis-tap
});
/* ---- drawn floors: rooms + walls (meters), optionally over a floor-plan picture ---- */
(v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
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
  const file = `${f.id}-bg.${t[0]}`; writeFileSafe(path.join(FP_DIR, file), req.body, 0o600);
  f.plan = { ...f.plan, bg: file }; fpWrite(d); res.json({ ok: true, floor: f });
});
app.get('/api/floorplan/floors/:id/background', (req, res) => {
  const f = fpData().floors.find((x) => x.id === req.params.id);
  if (!f?.plan?.bg || !/^[\w-]+\.(png|jpg|webp)$/.test(f.plan.bg)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.sendFile(path.join(FP_DIR, f.plan.bg));
});
/* How the 3D home looks for everyone: theme (real/night/blueprint/day) and any colors changed per theme. */
app.put('/api/floorplan/style', requirePro, express.json(), (req, res) => {
  const d = fpData(), b = req.body || {}, KEYS = ['bg', 'wall', 'floor', 'furniture', 'edge', 'door', 'window'];
  const colors = {};
  for (const t of ['real', 'night', 'blueprint', 'day']) { const c = b.colors?.[t] ?? (t === 'night' ? b.colors?.neon : null); if (c && typeof c === 'object') { const ok = Object.fromEntries(KEYS.filter((k) => FP_HEX.test(c[k])).map((k) => [k, c[k]])); if (Object.keys(ok).length) colors[t] = ok; } }
  const ex = b.extras || {}, extras = { ...(FP_HEX.test(ex.roof) ? { roof: ex.roof } : {}), ...(FP_HEX.test(ex.flow) ? { flow: ex.flow } : {}), ...(fin(ex.glow, 0.3, 2.5) ? { glow: +ex.glow } : {}) };
  d.style = { theme: ['real', 'night', 'blueprint', 'day'].includes(b.theme) ? b.theme : 'real', colors, extras };
  fpWrite(d); res.json({ ok: true, style: d.style });
});
app.put('/api/floorplan/pins', requirePro, express.json({ limit: '1mb' }), (req, res) => {
  const d = fpData(), floors = new Set(d.floors.map((f) => f.id));
  d.pins = (Array.isArray(req.body?.pins) ? req.body.pins : []).filter((p) => floors.has(p.floor) && Array.isArray(p.pos) && p.pos.length === 3 && p.pos.every(Number.isFinite))
    .slice(0, 500).map((p) => ({ deviceId: String(p.deviceId).slice(0, 200), floor: p.floor, pos: p.pos.map((n) => Math.round(n * 1000) / 1000), label: p.label ? String(p.label).slice(0, 40) : null, color: FP_HEX.test(p.color) ? p.color : null,
      // the power line's bends along the floor, if the owner drew one
      route: Array.isArray(p.route) && p.route.length ? p.route.slice(0, 30).filter((q) => Array.isArray(q) && q.length === 2 && q.every((n) => fin(n, -1000, 1000))).map((q) => q.map((n) => Math.round(n * 100) / 100)) : null }));
  fpWrite(d); res.json({ ok: true, pins: d.pins.length });
});
/* The 3D view's own choices (walls, which floors are hidden, labels, overlays...): kept with the plan so
   every screen and every restart sees the same view. Only known keys, only simple values. */
const VIEW_KEYS = { walls: ['auto', 'tall', 'cut'], stack: ['stacked', 'apart', 'alone'], overlay: ['rooms', 'temp', 'humidity', 'air', 'energy', 'lights', 'presence', 'motion'], labels: ['none', 'key', 'all'], theme: [null, 'real', 'night', 'blueprint', 'day'] };
const VIEW_BOOLS = ['names', 'values', 'cameras', 'roof', 'power', 'sun', 'weatherFx', 'spin', 'yard', 'trail'];
app.put('/api/floorplan/view', requirePro, express.json({ limit: '64kb' }), (req, res) => {
  const d = fpData(), v = req.body?.view || {}, out = {};
  for (const [k, ok] of Object.entries(VIEW_KEYS)) if (ok.includes(v[k] ?? null) && k in v) out[k] = v[k];
  for (const k of VIEW_BOOLS) if (typeof v[k] === 'boolean') out[k] = v[k];
  if (v.hidden && typeof v.hidden === 'object') out.hidden = Object.fromEntries(Object.entries(v.hidden).filter(([id, h]) => d.floors.some((f) => f.id === id) && typeof h === 'boolean').slice(0, 50));
  d.view = out; fpWrite(d); res.json({ ok: true });
});
/* The yard: areas drawn on the ground and things placed on it (trees, bushes, cars, an EV charger).
   A car can be linked to its own sensors - home/away, plugged in, charging power, battery - to show
   where it is and whether it is charging. Showing only: nothing here can control a car. */
const YARD_AREAS = new Set(['grass', 'driveway', 'patio', 'path', 'garden', 'pool']), YARD_ITEMS = new Set(['tree', 'pine', 'bush', 'car', 'charger']), CAR_BINDS = ['home', 'plugged', 'power', 'battery'];
const yid = (v) => (/^[\w-]{1,24}$/.test(v) ? v : crypto.randomBytes(5).toString('hex'));
app.put('/api/floorplan/yard', requirePro, express.json({ limit: '512kb' }), (req, res) => {
  const d = fpData(), b = req.body || {}, pt = (q) => Array.isArray(q) && q.length === 2 && q.every((n) => fin(n, -1000, 1000));
  const areas = (Array.isArray(b.areas) ? b.areas : []).filter((a) => YARD_AREAS.has(a?.kind) && Array.isArray(a.pts) && a.pts.length >= 3 && a.pts.length <= 200 && a.pts.every(pt)).slice(0, 150)
    .map((a) => ({ id: yid(a.id), kind: a.kind, pts: a.pts.map((q) => q.map((n) => Math.round(n * 100) / 100)) }));
  const items = (Array.isArray(b.items) ? b.items : []).filter((it) => YARD_ITEMS.has(it?.kind) && pt(it.pos)).slice(0, 400).map((it) => {
    const o = { id: yid(it.id), kind: it.kind, pos: it.pos.map((n) => Math.round(n * 100) / 100), rot: fin(it.rot, -360, 360) ? Math.round(+it.rot) : 0, scale: fin(it.scale, 0.3, 4) ? +(+it.scale).toFixed(2) : 1 };
    if (it.kind === 'car') Object.assign(o, { name: String(it.name || 'Car').slice(0, 30), color: FP_HEX.test(it.color) ? it.color : '#cfd6df', body: it.body === 'suv' ? 'suv' : 'sedan',
      bind: Object.fromEntries(CAR_BINDS.filter((k) => typeof it.bind?.[k] === 'string' && it.bind[k].length <= 200 && it.bind[k]).map((k) => [k, it.bind[k]])) });
    return o;
  });
  d.yard = { areas, items }; fpWrite(d); res.json({ ok: true, yard: d.yard });
});
/* Where the electrical panel is (the power lines start there) and which side is the front of the house. */
app.put('/api/floorplan/settings', requirePro, express.json(), (req, res) => {
  const d = fpData(), b = req.body || {}, st = { ...(d.settings || {}) };
  if (b.panel === null) delete st.panel;
  else if (b.panel && d.floors.some((f) => f.id === b.panel.floor) && Array.isArray(b.panel.pos) && b.panel.pos.length === 3 && b.panel.pos.every((v) => fin(v, -1000, 1000))) st.panel = { floor: b.panel.floor, pos: b.panel.pos.map((v) => +(+v).toFixed(3)) };
  if ([0, 90, 180, 270].includes(Number(b.frontDeg))) st.frontDeg = Number(b.frontDeg);
  if ([0, 90, 180, 270].includes(Number(b.northDeg))) st.northDeg = Number(b.northDeg);
  d.settings = st; fpWrite(d); res.json({ ok: true, settings: st });
});
/* The weather for the 3D page's control panel, in one small shape (same as the personal dashboard's). */
const fpKind = (sym) => (!sym ? 'cloud' : /thunder/.test(sym) ? 'storm' : /snow|sleet/.test(sym) ? 'snow' : /rain|shower/.test(sym) ? 'rain' : /fog/.test(sym) ? 'fog' : /clearsky/.test(sym) ? (/night/.test(sym) ? 'moon' : 'sun') : /fair|partlycloudy/.test(sym) ? 'partly' : 'cloud');
async function fpWeather() {
  try {
    const w = isDemo() ? JSON.parse(fs.readFileSync(path.join(DEMO_FP, '..', 'fixtures', 'home.json'), 'utf8')).weather : config.location ? await weatherNow() : null;
    if (!w?.now) return null;
    const d0 = w.days?.[0];
    const loc = isDemo() ? { lat: 37.77, lon: -122.42 } : config.location || {};
    const n = w.now, windMs = n.windMs ?? (n.wind != null ? n.wind / (config.house?.units === 'C' ? 3.6 : 2.237) : null);   // older weather (and the demo) has only the display speed
    return { temp: w.now.temp, words: w.now.words, kind: fpKind(w.now.symbol), windMs, gustMs: n.gustMs ?? null, windDir: n.windDir ?? (isDemo() ? 245 : null), place: w.place || null, hi: d0?.hi ?? null, lo: d0?.lo ?? null, tz: houseTz(), lat: loc.lat ?? null, lon: loc.lon ?? null,
      days: (w.days || []).slice(0, 5).map((x) => ({ label: new Date(`${x.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }), hi: x.hi, lo: x.lo, kind: fpKind(x.symbol) })) };
  } catch { return null; }
}
/* Live: every placed device's state + the house totals shown on top of the plan. */
app.get('/api/floorplan/live', async (_req, res) => {
  const d = fpData();
  const [{ devices }, weather] = await Promise.all([houseDevices(), fpWeather()]);
  const byId = new Map(devices.map((x) => [x.id, x]));
  for (const x of devices) { const r = riskOf(x); if (r) x.guarded = r.only; }   // which controls the safety rule allows
  const powerW = housePower(devices).watts;
  res.json({
    pins: d.pins.map((p) => ({ ...p, device: byId.get(p.deviceId) || { id: p.deviceId, name: p.label || p.deviceId, online: false } })), weather,
    devices: devices.map((x) => ({ id: x.id, name: x.name, kind: x.kind, provider: x.provider, ...(x.area ? { area: x.area } : {}), ...(x.home != null ? { pres: 1 } : {}), ...(x.powerW != null ? { pw: 1 } : {}), ...(x.battery != null || /battery/i.test(x.id) ? { bat: 1 } : {}), ...(x.kind === 'sensor' && x.on != null ? { bin: 1 } : {}) })),
    cars: Object.fromEntries((d.yard?.items || []).filter((it) => it.kind === 'car').map((it) => {
      const g = (k) => byId.get(it.bind?.[k]), h = g('home'), p = g('plugged'), w = g('power'), bt = g('battery'), n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
      return [it.id, { home: h ? (h.home ?? h.on ?? null) : null, plugged: p ? !!(p.on ?? p.plugged) : null, powerW: w ? w.powerW ?? null : null, battery: bt ? n(bt.battery ?? bt.value) : null }];
    })),
    energy: energyFlows(devices, Math.round(powerW)),
    totals: { powerW: Math.round(powerW), lightsOn: devices.filter((x) => x.kind === 'light' && x.on).length, playing: devices.filter((x) => x.playing).map((x) => ({ name: x.name, title: x.title })), openDoors: devices.filter((x) => x.open).length, leaks: devices.filter((x) => x.water).length },
  });
});
