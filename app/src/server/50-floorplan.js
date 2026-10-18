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
 *   { floors: [{ id, name, kind: scan|drawn, file?, plan?: { rooms, walls, openings, stairs, roof, bg, bgW, bgOpacity, ... (50d-drawplan.js) }, level, heightM, rotationY, scale, offset: [x,z] }],
 *       + rooms?: [{ name, color, pos: [x, z] }], paint?: { item: '#hex' }, look?: auto|styled|original
 *     pins:   [{ deviceId, floor, pos: [x, y, z], label?, color? }], style?: { theme, colors: { theme: { key: '#hex' } } } }
 * ====================================================================== */
const FP_DIR = path.join(DATA_DIR, 'floorplan');
const FP_HEX = /^#[0-9a-f]{6}$/i;
const fin = (v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
const FP_FILE = path.join(FP_DIR, 'floorplan.json');
const FP_MAX = 60;   // floors (and rooms scanned one at a time); each can be a big .glb on disk
fs.mkdirSync(FP_DIR, { recursive: true, mode: 0o700 });
const fpRead = () => { try { return JSON.parse(fs.readFileSync(FP_FILE, 'utf8')); } catch { return { floors: [], pins: [] }; } };
let demoFp = null;   // the demo can be edited, but only in memory
const fpWrite = (d) => { if (isDemo()) { demoFp = d; return; } writeFileSafe(FP_FILE, JSON.stringify(d, null, 2), 0o600); };
const DEMO_FP = path.join(APP_DIR, '..', 'demo', 'floorplan');
/* The dark look was once called "neon"; plans saved then are read as "night". */
const fpTheme = (d) => { if (d?.style?.theme === 'neon' || d?.style?.theme === 'blueprint') d.style.theme = 'night'; if (d?.style?.colors?.neon) { d.style.colors.night ||= d.style.colors.neon; delete d.style.colors.neon; } if (d?.view?.theme === 'neon') d.view.theme = 'night'; return d; };
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
  if (d.floors.length >= FP_MAX) return res.status(400).json({ error: `Up to ${FP_MAX} floors and rooms - remove one first.` });
  writeFileSafe(path.join(FP_DIR, `${id}.glb`), buf, 0o600);
  const level = fin(req.query.level, 0, 9) ? Math.round(Number(req.query.level)) : Math.min(9, d.floors.reduce((m, f) => Math.max(m, (f.level || 0) + 1), 0));   // a room of an existing floor says which; otherwise the next one up
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
  if (b.rooms === null) delete f.rooms;   // back to the rooms found in the scan (Undo)
  if (Array.isArray(b.rooms)) f.rooms = b.rooms.filter((r) => Array.isArray(r?.pos) && r.pos.length === 2 && r.pos.every((v) => fin(v, -1000, 1000))).slice(0, 60)
    .map((r) => ({ name: String(r.name || 'Room').slice(0, 30), color: FP_HEX.test(r.color) ? r.color : '#38bdf8', pos: r.pos.map((v) => +(+v).toFixed(2)) }));
  if (Array.isArray(b.hiddenParts)) f.hiddenParts = [...new Set(b.hiddenParts.filter((k) => typeof k === 'string' && k.length && k.length <= 120))].slice(0, 2000);
  if (b.paint && typeof b.paint === 'object') f.paint = Object.fromEntries(Object.entries(b.paint).filter(([k, v]) => k.length <= 120 && FP_HEX.test(v)).slice(0, 800));
  fpWrite(d); res.json({ ok: true, floor: f });
});
app.delete('/api/floorplan/floors/:id', requirePro, (req, res) => {
  if (fpData().floors.find((x) => x.id === req.params.id)?.scans?.length) rpSnapshot('before-delete', { force: true });   // its photo-real scans stay restorable (50b-plan-backup.js keeps them as hard links)
  const d = fpData(), gone = d.floors.find((x) => x.id === req.params.id); d.floors = d.floors.filter((x) => x !== gone); d.pins = d.pins.filter((p) => p.floor !== req.params.id);
  // The demo's edits live only in memory, so its uploads go with them (the sample floors are in demo/, never touched).
  if (isDemo() && /^f[0-9a-z]+(-[0-9a-z]+)?\.glb$/.test(gone?.file || '')) fs.rm(path.join(FP_DIR, gone.file), { force: true }, () => {});
  fpWrite(d); res.json({ ok: true });   // the .glb stays on disk until a cleanup; nothing is lost by a mis-tap
  if (gone?.scans?.length) scanSweep();   // its photo-real scan files go now (50s-scan.js); a restore point still has them
});
/* Replace a floor's model: rooms scanned one at a time and joined in the editor come back as one .glb.
   The parts' turns and sizes are baked into it, so the floor's own turn and size start again from zero. */
app.put('/api/floorplan/floors/:id/model', requirePro, express.raw({ type: '*/*', limit: '300mb' }), (req, res) => {
  const buf = req.body, d = fpData(), f = d.floors.find((x) => x.id === req.params.id);
  if (!f || f.kind === 'drawn') return res.status(404).json({ error: 'no such scanned floor' });
  if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.subarray(0, 4).toString() !== 'glTF') return res.status(400).json({ error: 'That is not a .glb file.' });
  const file = `${f.id}-${Date.now().toString(36)}.glb`;
  writeFileSafe(path.join(FP_DIR, file), buf, 0o600);
  const old = f.file; Object.assign(f, { file, rotationY: 0, scale: 1 }); fpWrite(d);
  if (/^[\w-]+\.glb$/.test(old || '') && old !== file) fs.rm(path.join(FP_DIR, old), { force: true }, () => {});
  res.json({ ok: true, floor: f });
});
/* ---- drawn floors: rooms + walls (meters), optionally over a floor-plan picture ---- */
app.post('/api/floorplan/floors/drawn', requirePro, express.json(), (req, res) => {
  const d = fpData(), id = `d${Date.now().toString(36)}`, level = d.floors.length;
  if (d.floors.length >= FP_MAX) return res.status(400).json({ error: `Up to ${FP_MAX} floors and rooms - remove one first.` });
  const f = { id, kind: 'drawn', name: String(req.body?.name || `Floor ${level + 1}`).slice(0, 40), level, heightM: 2.7, rotationY: 0, scale: 1, offset: [0, 0], plan: { rooms: [], walls: [], bg: null, bgW: 15, bgOpacity: 0.6 } };
  d.floors.push(f); fpWrite(d); res.json({ ok: true, floor: f });
});
app.put('/api/floorplan/floors/:id/plan', requirePro, express.json({ limit: '1mb' }), (req, res) => {
  const d = fpData(), f = d.floors.find((x) => x.id === req.params.id);
  if (!f || f.kind !== 'drawn') return res.status(404).json({ error: 'no such drawn floor' });
  const b = req.body || {};
  f.plan = dpClean(b, f.plan || {});   // rooms, walls, doors and windows, stairs, roof, paint (50d-drawplan.js)
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
/* How the 3D home looks for everyone: theme (real/night/day) and any colors changed per theme. */
app.put('/api/floorplan/style', requirePro, express.json(), (req, res) => {
  const d = fpData(), b = req.body || {}, KEYS = ['bg', 'wall', 'floor', 'furniture', 'edge', 'door', 'window'];
  const colors = {};
  for (const t of ['real', 'night', 'day']) { const c = b.colors?.[t] ?? (t === 'night' ? b.colors?.neon : null); if (c && typeof c === 'object') { const ok = Object.fromEntries(KEYS.filter((k) => FP_HEX.test(c[k])).map((k) => [k, c[k]])); if (Object.keys(ok).length) colors[t] = ok; } }
  const ex = b.extras || {}, extras = { ...(FP_HEX.test(ex.roof) ? { roof: ex.roof } : {}), ...(FP_HEX.test(ex.flow) ? { flow: ex.flow } : {}), ...(fin(ex.glow, 0.3, 2.5) ? { glow: +ex.glow } : {}) };
  d.style = { theme: ['real', 'night', 'day'].includes(b.theme) ? b.theme : b.theme === 'blueprint' ? 'night' : 'real', colors, extras };
  fpWrite(d); res.json({ ok: true, style: d.style });
});
app.put('/api/floorplan/pins', requirePro, express.json({ limit: '1mb' }), (req, res) => {
  const d = fpData(), floors = new Set(d.floors.map((f) => f.id));
  d.pins = (Array.isArray(req.body?.pins) ? req.body.pins : []).filter((p) => floors.has(p.floor) && Array.isArray(p.pos) && p.pos.length === 3 && p.pos.every(Number.isFinite))
    .slice(0, 500).map((p) => ({ deviceId: String(p.deviceId).slice(0, 200), floor: p.floor, pos: p.pos.map((n) => Math.round(n * 1000) / 1000), label: p.label ? String(p.label).slice(0, 40) : null, color: FP_HEX.test(p.color) ? p.color : null,
      // the power line's bends along the floor, if the owner drew one
      route: Array.isArray(p.route) && p.route.length ? p.route.slice(0, 30).filter((q) => Array.isArray(q) && q.length === 2 && q.every((n) => fin(n, -1000, 1000))).map((q) => q.map((n) => Math.round(n * 100) / 100)) : null,
      // an outdoor flood light: which way it shines (degrees), how wide (degrees) and how far (meters)
      beam: p.beam && typeof p.beam === 'object' && [[p.beam.aim, -360, 360], [p.beam.spread, 10, 170], [p.beam.reach, 1, 40]].every(([v, lo, hi]) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi)
        ? { aim: Math.round(Number(p.beam.aim)), spread: Math.round(Number(p.beam.spread)), reach: Math.round(Number(p.beam.reach) * 10) / 10 } : null }));
  fpWrite(d); res.json({ ok: true, pins: d.pins.length });
});
/* The 3D view's own choices (walls, which floors are hidden, labels, overlays...): kept with the plan so
   every screen and every restart sees the same view. Only known keys, only simple values. */
const VIEW_KEYS = { lines: ['off', 'energy', 'always'], walls: ['auto', 'tall', 'cut'], stack: ['stacked', 'apart', 'alone'], overlay: ['rooms', 'temp', 'humidity', 'air', 'energy', 'lights', 'presence', 'motion'], labels: ['none', 'key', 'all'], theme: [null, 'real', 'night', 'blueprint', 'day'] };
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
const YARD_AREAS = new Set(['grass', 'driveway', 'patio', 'path', 'garden', 'pool', 'gravel']), YARD_ITEMS = new Set(['tree', 'pine', 'bush', 'car', 'charger']), CAR_BINDS = ['home', 'plugged', 'power', 'battery'];
const yid = (v) => (/^[\w-]{1,24}$/.test(v) ? v : crypto.randomBytes(5).toString('hex'));
app.put('/api/floorplan/yard', requirePro, express.json({ limit: '512kb' }), (req, res) => {
  const d = fpData(), b = req.body || {}, pt = (q) => Array.isArray(q) && q.length === 2 && q.every((n) => fin(n, -1000, 1000));
  const areas = (Array.isArray(b.areas) ? b.areas : []).filter((a) => YARD_AREAS.has(a?.kind) && Array.isArray(a.pts) && a.pts.length >= 3 && a.pts.length <= 200 && a.pts.every(pt)).slice(0, 150)
    .map((a) => ({ id: yid(a.id), kind: a.kind, pts: a.pts.map((q) => q.map((n) => Math.round(n * 100) / 100)), ...yardAreaExtras(a) }));   // OUTDOOR: pool depth, slope (50i-items.js)
  const items = (Array.isArray(b.items) ? b.items : []).filter((it) => YARD_ITEMS.has(it?.kind) && pt(it.pos)).slice(0, 400).map((it) => {
    const o = { id: yid(it.id), kind: it.kind, pos: it.pos.map((n) => Math.round(n * 100) / 100), rot: fin(it.rot, -360, 360) ? Math.round(+it.rot) : 0, scale: fin(it.scale, 0.3, 4) ? +(+it.scale).toFixed(2) : 1 };
    if (it.kind === 'car') Object.assign(o, { name: String(it.name || 'Car').slice(0, 30), color: FP_HEX.test(it.color) ? it.color : '#cfd6df', body: it.body === 'suv' ? 'suv' : 'sedan',
      bind: Object.fromEntries(CAR_BINDS.filter((k) => typeof it.bind?.[k] === 'string' && it.bind[k].length <= 200 && it.bind[k]).map((k) => [k, it.bind[k]])) });
    return o;
  });
  const seen = Array.isArray(b.seen) ? [...new Set(b.seen.filter((k) => typeof k === 'string' && /^[\w:.-]{1,120}$/.test(k)))].slice(0, 30) : d.yard?.seen || [];   // cars already parked once (a removed one stays removed)
  d.yard = { areas, items, seen, lines: yardLines(b.lines) }; fpWrite(d); res.json({ ok: true, yard: d.yard });   // OUTDOOR: + fences and hedges
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
    return { temp: w.now.temp, words: w.now.words, kind: fpKind(w.now.symbol), windMs, gustMs: n.gustMs ?? null, windDir: n.windDir ?? (isDemo() ? 245 : null), cloudPct: n.cloud ?? null, rainMm: n.rainMm ?? null, place: w.place || null, hi: d0?.hi ?? null, lo: d0?.lo ?? null, tz: houseTz(), lat: loc.lat ?? null, lon: loc.lon ?? null,
      days: (w.days || []).slice(0, 5).map((x) => ({ label: new Date(`${x.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }), hi: x.hi, lo: x.lo, kind: fpKind(x.symbol) })) };
  } catch { return null; }
}
/* One device on the 3D home per real device. Home Assistant splits a dishwasher into its switch, its LED, its power and
   energy readings, a plug into its switch and power sensor, a multi-sensor into motion, temperature and light level. On the
   plan they are one device: switched through its main part, showing every reading of the others. Pins saved on any part
   move to the device (the next save stores them that way). */
const FP_RANK = ['camera', 'climate', 'light', 'media', 'plug', 'switch', 'fan', 'vacuum'];
const FP_ALONE = new Set(['cover', 'lock', 'alarm', 'presence']);   // garage doors, gates, locks and alarms always keep their own pin and their safe controls
const FP_MINOR = /\b(led|leds|indicator|ring light|status light|night light|child lock|lock ?out|beep|buzzer|sound|display|backlight|auto ?off|power[- ]on (behaviou?r|state)|restart|reboot|identify|firmware|update|overheat|overload|overpower|signal|rssi|wifi|linkquality|uptime)\b/i;
const FP_READ = ['powerW', 'energyKWh', 'tempC', 'humidity', 'battery', 'co2', 'lux'];
const FP_ANY = ['motion', 'open', 'water', 'smoke'];
function fpWords(names) {   // the words every part's name starts with: "Dishwasher LED" + "Dishwasher power" -> "Dishwasher"
  const ws = names.map((n) => String(n || '').trim().split(/\s+/)); let k = 0;
  while (ws.every((w) => w[k] && w[k].toLowerCase() === ws[0][k].toLowerCase())) k++;
  return ws[0].slice(0, k).join(' ');
}
function fpGroup(list) {
  const groups = new Map(), alias = new Map(), out = [];
  for (const x of list) { if (!x.dev || FP_ALONE.has(x.kind)) { out.push(x); continue; } if (!groups.has(x.dev)) groups.set(x.dev, []); groups.get(x.dev).push(x); }
  for (const parts of groups.values()) {
    if (parts.length === 1) { out.push(parts[0]); continue; }
    const score = (x) => { const r = FP_RANK.indexOf(x.kind); return (r < 0 ? 50 : r) + (FP_MINOR.test(x.name || '') ? 100 : 0); };
    const main = [...parts].sort((a, b) => score(a) - score(b))[0];
    const g = { ...main, name: main.dname || fpWords(parts.map((x) => x.name)) || main.name, parts: parts.map((x) => x.id) };
    for (const x of parts) {
      if (x === main) continue;
      alias.set(x.id, main.id);
      for (const k of FP_READ) if (g[k] == null && x[k] != null) g[k] = x[k];
      for (const k of FP_ANY) if (x[k] === true) g[k] = true; else if (g[k] == null && x[k] != null) g[k] = x[k];
    }
    if (['plug', 'switch'].includes(g.kind) && g.on === false && g.powerW != null) g.powerW = 0;   // off draws nothing, whatever a slow sensor last said
    out.push(g);
  }
  return { list: out, alias };
}
/* ---- your usual power use: right now, compared with the same hour on the same day of the week ----
   Every minute the house's power is noted; at the end of each hour that hour's average is folded into two running
   averages - this weekday at this hour (the last ~6 weeks), and any day at this hour (the last ~2 weeks, used until
   there's enough of the first). Kept in DATA_DIR/power-baseline.json, only numbers, nothing else. "Normal" allows
   15% (at least 150 W) above usual; "above" up to 60% (at least 400 W) more; beyond that, "high". */
const PB_FILE = path.join(DATA_DIR, 'power-baseline.json');
const PB = (() => { try { const j = JSON.parse(fs.readFileSync(PB_FILE, 'utf8')); return { b: j.b || {}, cur: j.cur || null }; } catch { return { b: {}, cur: null }; } })();
let pbSavedAt = 0;
const pbKey = (t = new Date()) => ({ wk: `${t.getDay()}-${t.getHours()}`, hr: `*-${t.getHours()}`, hour: Math.floor(t.getTime() / 3_600_000) });
function pbSave(force) { if (!force && Date.now() - pbSavedAt < 600_000) return; pbSavedAt = Date.now(); try { writeFileSafe(PB_FILE, JSON.stringify(PB), 0o600); } catch { /* next time */ } }
function pbRecord(w) {
  if (!Number.isFinite(w) || w < 0 || w > 200_000) return;
  const k = pbKey(), c = PB.cur;
  if (c && c.hour !== k.hour) {
    if (c.count >= 10) for (const key of [c.wk, c.hr]) { const b = (PB.b[key] ||= { avg: 0, n: 0 }); b.n = Math.min(b.n + 1, key.startsWith('*') ? 14 : 6); b.avg = Math.round(b.avg + (c.sum / c.count - b.avg) / b.n); }
    PB.cur = null; pbSave(true);
  }
  if (!PB.cur) PB.cur = { ...k, sum: 0, count: 0 };
  PB.cur.sum += w; PB.cur.count += 1; pbSave(false);
}
function pbLevel(w) {
  const k = pbKey(), wk = PB.b[k.wk], hr = PB.b[k.hr];
  const base = wk?.n >= 2 ? wk : hr?.n >= 2 ? hr : wk?.n ? wk : hr?.n ? hr : null;
  if (!base || !Number.isFinite(w)) return { level: 'learning' };
  const usual = base.avg, diff = w - usual;
  const level = diff <= Math.max(150, usual * 0.15) ? (usual - w > Math.max(150, usual * 0.2) ? 'low' : 'normal') : diff <= Math.max(400, usual * 0.6) ? 'above' : 'high';
  return { level, usual, sameDay: base === wk };
}
if (!isDemo()) setInterval(async () => { try { if (isConfigured()) { const { devices } = await houseDevices(); pbRecord(housePower(devices).watts); } } catch { /* next minute */ } }, 60_000).unref?.();
/* Live: every placed device's state + the house totals shown on top of the plan. */
app.get('/api/floorplan/live', async (_req, res) => {
  const d = fpData();
  const [{ devices }, weather] = await Promise.all([houseDevices(), fpWeather()]);
  const byId = new Map(devices.map((x) => [x.id, x]));
  for (const x of devices) { const r = riskOf(x); if (r) x.guarded = r.only; }   // which controls the safety rule allows
  const G = fpGroup(devices), gById = new Map(G.list.map((x) => [x.id, x])), main = (id) => G.alias.get(id) || id, seenPin = new Set();
  const hp = housePower(devices), powerW = hp.watts;
  res.json(fpLiveExtra({   // + the live view's extras (50l-live3d.js)
    pins: d.pins.map((p) => ({ ...p, deviceId: main(p.deviceId) })).filter((p) => !seenPin.has(p.deviceId) && seenPin.add(p.deviceId))   // one pin per device, even if two of its parts were placed
      .map((p) => ({ ...p, device: gById.get(p.deviceId) || byId.get(p.deviceId) || { id: p.deviceId, name: p.label || p.deviceId, online: false } })), weather,
    devices: G.list.map((x) => ({ id: x.id, name: x.name, kind: x.kind, provider: x.provider, ...(x.area ? { area: x.area } : {}), ...(x.dev ? { dev: x.dev } : {}), ...(x.home != null ? { pres: 1 } : {}), ...(x.powerW != null ? { pw: 1 } : {}), ...(x.battery != null || /battery/i.test(x.id) ? { bat: 1 } : {}), ...(x.kind === 'sensor' && x.on != null ? { bin: 1 } : {}), ...(x.haClass && (x.kind === 'sensor' || x.kind === 'cover') ? { haClass: x.haClass } : {}) })),   // haClass: a door's contact or a curtain, for the drawing editor's links
    parts: devices.map((x) => ({ id: x.id, name: x.name, kind: x.kind, provider: x.provider, ...(x.area ? { area: x.area } : {}), ...(x.dev ? { dev: x.dev } : {}), ...(x.home != null ? { pres: 1 } : {}), ...(x.powerW != null ? { pw: 1 } : {}), ...(x.battery != null || /battery/i.test(x.id) ? { bat: 1 } : {}), ...(x.kind === 'sensor' && x.on != null ? { bin: 1 } : {}) })),   // every part, for linking a car's sensors
    cars: Object.fromEntries((d.yard?.items || []).filter((it) => it.kind === 'car').map((it) => {
      const g = (k) => byId.get(it.bind?.[k]), h = g('home'), p = g('plugged'), w = g('power'), bt = g('battery'), n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
      return [it.id, { home: h ? (h.home ?? h.on ?? null) : null, plugged: p ? !!(p.on ?? p.plugged) : null, powerW: w ? w.powerW ?? null : null, battery: bt ? n(bt.battery ?? bt.value) : null }];
    })),
    energy: energyFlows(devices, Math.round(powerW)),
    totals: { powerW: Math.round(powerW), from: hp.from || null, parts: (hp.parts || []).slice(0, 30), vs: isDemo() ? { level: 'above', usual: 6400, sameDay: true } : pbLevel(powerW), lightsOn: devices.filter((x) => x.kind === 'light' && x.on).length, playing: devices.filter((x) => x.playing).map((x) => ({ name: x.name, title: x.title })), openDoors: devices.filter((x) => x.open).length, leaks: devices.filter((x) => x.water).length },
  }, d, devices));
});
