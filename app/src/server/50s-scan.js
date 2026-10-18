/* ======================================================================
 * Photo-real scans on the 3D home - CasaTorch Pro.
 *
 * A floor (drawn or scanned) can carry textured 3D scans on top of it:
 * the real walls, floors and furniture as a phone's LiDAR (Polycam,
 * Scaniverse, 3D Scanner App, Apple Object Capture, the CasaTorch app)
 * saw them. The browser turns whatever the app exported (GLB, glTF, USDZ,
 * OBJ+MTL+pictures, PLY with colors) into a .glb, plus a lighter copy for
 * wall tablets, before uploading - so the box only ever stores .glb.
 *
 * Kept in data/floorplan/ as s<id>-full.glb and s<id>-low.glb, listed on
 * the floor in floorplan.json:
 *   floors[].scans: [{ id, name, file, low?, bytes, tris, pos: [x, y, z], rotY (deg), scale, show: real|outline|hidden, pick, room? }]
 * Uploads stream to disk (never held in memory - a Pi has little), and are
 * checked before they're kept: a real glTF binary, complete, self-contained
 * (no links to anything outside the file), with features three.js can read.
 * ====================================================================== */
const SC_MAX_FULL = 250 * 1024 * 1024, SC_MAX_LOW = 60 * 1024 * 1024, SC_PER_FLOOR = 12, SC_TOTAL = 40, SC_MAX_TRIS = 8_000_000;
const SC_FILE = /^s[0-9a-z]{6,16}-(full|low)(-[0-9a-z]{1,10})?\.glb$/;
const SC_EXT_OK = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu', 'KHR_texture_transform', 'EXT_texture_webp', 'EXT_texture_avif',
  'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_pbrSpecularGlossiness', 'KHR_lights_punctual', 'KHR_materials_variants', 'EXT_mesh_gpu_instancing']);
/* What's in a .glb, from its header and JSON part only (the rest is never parsed here).
   head: the file's first bytes (at least 20 + the JSON chunk), size: the whole file's length. Throws a plain-words error. */
function scanGlbInfo(head, size) {
  if (!Buffer.isBuffer(head) || head.length < 20 || head.toString('latin1', 0, 4) !== 'glTF') throw new Error('That is not a .glb file.');
  if (head.readUInt32LE(4) !== 2) throw new Error('That .glb is an old glTF version (only glTF 2.0 is supported).');
  if (head.readUInt32LE(8) !== size) throw new Error('That .glb is cut short - the upload or the export didn\'t finish.');
  const jsonLen = head.readUInt32LE(12);
  if (head.readUInt32LE(16) !== 0x4e4f534a || jsonLen > 64 * 1024 * 1024 || 20 + jsonLen > size) throw new Error('That .glb is damaged.');
  if (head.length < 20 + jsonLen) throw new Error('need more');
  let j; try { j = JSON.parse(head.toString('utf8', 20, 20 + jsonLen)); } catch { throw new Error('That .glb is damaged.'); }
  if (!j || typeof j !== 'object' || String(j.asset?.version || '').split('.')[0] !== '2') throw new Error('That .glb is not glTF 2.0.');
  const outside = (u) => typeof u === 'string' && !u.startsWith('data:');
  if ((j.buffers || []).some((b) => outside(b?.uri)) || (j.images || []).some((im) => outside(im?.uri))) throw new Error('That model points to files outside it. Export it as one .glb (binary glTF) with everything inside.');
  const bad = (j.extensionsRequired || []).filter((e) => !SC_EXT_OK.has(e));
  if (bad.length) throw new Error(`That model needs ${bad.join(', ')}, which the 3D home can't show. Export it again without it.`);
  const acc = j.accessors || [];
  let tris = 0, points = 0;
  for (const m of j.meshes || []) for (const p of m?.primitives || []) {
    const mode = p?.mode ?? 4, n = acc[p?.indices ?? -1]?.count ?? acc[p?.attributes?.POSITION ?? -1]?.count ?? 0;
    if (mode === 4) tris += Math.floor(n / 3); else if (mode === 5 || mode === 6) tris += Math.max(0, n - 2); else if (mode === 0) points += n;
  }
  if (!tris && !points) throw new Error('That model has nothing to show (no surfaces in it).');
  if (tris > SC_MAX_TRIS) throw new Error(`That scan has ${(tris / 1e6).toFixed(1)} million triangles - too many for a home screen. Export it at a lower detail (under 8 million).`);
  const used = new Set(j.extensionsUsed || []);
  return { tris, points, meshes: (j.meshes || []).length, textures: (j.images || []).length, draco: used.has('KHR_draco_mesh_compression'), meshopt: used.has('EXT_meshopt_compression'), ktx2: used.has('KHR_texture_basisu') };
}
/* Stream the request body to a temporary file, stopping at max bytes. Resolves to its size. */
function scanReceive(req, file, max) {
  return new Promise((ok, bad) => {
    let n = 0, done = false;
    const out = fs.createWriteStream(file, { mode: 0o600 });
    const fail = (e) => { if (done) return; done = true; req.unpipe?.(out); out.destroy(); fs.rm(file, { force: true }, () => {}); bad(e); };
    req.on('data', (c) => { n += c.length; if (n > max) { fail(Object.assign(new Error(`That file is over ${Math.round(max / 1048576)} MB. Export the scan at a lower detail or with smaller pictures.`), { status: 413 })); req.resume(); } });
    req.on('aborted', () => fail(new Error('The upload stopped.')));
    req.on('error', fail); out.on('error', fail);
    out.on('finish', () => { if (!done) { done = true; ok(n); } });
    req.pipe(out);
  });
}
function scanReadHead(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const first = Buffer.alloc(Math.min(20, size)); fs.readSync(fd, first, 0, first.length, 0);
    const want = first.length >= 16 ? Math.min(size, 20 + first.readUInt32LE(12)) : first.length;
    if (want > 64 * 1024 * 1024 + 20) return first;
    const head = Buffer.alloc(want); fs.readSync(fd, head, 0, want, 0); return head;
  } finally { fs.closeSync(fd); }
}
const scanFreeBytes = () => { try { const st = fs.statfsSync?.(FP_DIR); return st ? st.bavail * st.bsize : Infinity; } catch { return Infinity; } };
const scanFiles = (d) => new Set(d.floors.flatMap((f) => (f.scans || []).flatMap((s) => [s.file, s.low].filter(Boolean))));
/* Scan files nobody lists any more (a floor removed, a scan replaced, the demo restarted): gone. */
function scanSweep() {
  try {
    const keep = scanFiles(fpData());
    for (const n of fs.readdirSync(FP_DIR)) if ((SC_FILE.test(n) && !keep.has(n)) || /^s[0-9a-z]+-up\.\d+\.tmp$/.test(n)) fs.rm(path.join(FP_DIR, n), { force: true }, () => {});
  } catch { /* next time */ }
}
setTimeout(scanSweep, 5000).unref?.();
const scanOf = (req) => { const d = fpData(), f = d.floors.find((x) => x.id === req.params.id), s = f?.scans?.find((x) => x.id === req.params.sid); return { d, f, s }; };
const scanNum = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : dflt);
async function scanUpload(req, res, max, onOk) {
  const tmp = path.join(FP_DIR, `s${crypto.randomBytes(5).toString('hex')}-up.${process.pid}.tmp`);
  try {
    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > max) return res.status(413).json({ error: `That file is over ${Math.round(max / 1048576)} MB. Export the scan at a lower detail or with smaller pictures.` });
    if (scanFreeBytes() < (Number.isFinite(len) ? len : max) + 300 * 1048576) return res.status(507).json({ error: 'Not enough free space on your CasaTorch for this scan.' });
    const size = await scanReceive(req, tmp, max);
    const info = scanGlbInfo(scanReadHead(tmp, size), size);
    await onOk(tmp, size, info);
  } catch (e) {
    fs.rm(tmp, { force: true }, () => {});
    if (!res.headersSent) res.status(e.status || 400).json({ error: e.message === 'need more' ? 'That .glb is damaged.' : e.message || 'That upload didn\'t work.' });
  }
}
/* A new scan on a floor: the full-detail .glb as the body. ?name= */
app.post('/api/floorplan/floors/:id/scans', requirePro, (req, res) => {
  const d0 = fpData(), f0 = d0.floors.find((x) => x.id === req.params.id);
  if (!f0) return res.status(404).json({ error: 'no such floor' });
  if ((f0.scans || []).length >= SC_PER_FLOOR) return res.status(400).json({ error: `Up to ${SC_PER_FLOOR} scans on one floor - remove one first.` });
  if (d0.floors.reduce((n, f) => n + (f.scans || []).length, 0) >= SC_TOTAL) return res.status(400).json({ error: `Up to ${SC_TOTAL} scans in the house - remove one first.` });
  scanUpload(req, res, SC_MAX_FULL, (tmp, size, info) => {
    const d = fpData(), f = d.floors.find((x) => x.id === req.params.id);
    if (!f) throw Object.assign(new Error('no such floor'), { status: 404 });
    const id = `s${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`, file = `${id}-full.glb`;
    fs.renameSync(tmp, path.join(FP_DIR, file));
    const s = { id, name: String(req.query.name || 'Scan').replace(/[\u0000-\u001f]/g, '').slice(0, 40) || 'Scan', file, bytes: size, tris: info.tris, points: info.points || 0, pos: [0, 0, 0], rotY: 0, scale: 1, show: 'real', pick: false };
    (f.scans ||= []).push(s); fpWrite(d); res.json({ ok: true, scan: s, info });
  });
});
/* The lighter copy for wall tablets and old screens (made by the browser that uploaded the scan). */
app.put('/api/floorplan/floors/:id/scans/:sid/low', requirePro, (req, res) => {
  if (!scanOf(req).s) return res.status(404).json({ error: 'no such scan' });
  scanUpload(req, res, SC_MAX_LOW, (tmp, size, info) => {
    const { d, s } = scanOf(req); if (!s) throw Object.assign(new Error('no such scan'), { status: 404 });
    const file = `${s.id}-low-${Date.now().toString(36)}.glb`; fs.renameSync(tmp, path.join(FP_DIR, file));
    Object.assign(s, { low: file, lowBytes: size, lowTris: info.tris }); fpWrite(d); res.json({ ok: true, scan: s });
  });
});
/* Where it sits and how it shows: place (m, on the floor), turn (degrees), size, real / outline / hidden, and whether taps land on it. */
app.put('/api/floorplan/floors/:id/scans/:sid', requirePro, express.json({ limit: '16kb' }), (req, res) => {
  const { d, s } = scanOf(req), b = req.body || {};
  if (!s) return res.status(404).json({ error: 'no such scan' });
  if (typeof b.name === 'string' && b.name.trim()) s.name = b.name.replace(/[\u0000-\u001f]/g, '').slice(0, 40);
  if (Array.isArray(b.pos) && b.pos.length === 3) s.pos = b.pos.map((v, i) => +scanNum(v, -1000, 1000, s.pos[i]).toFixed(3));
  if (b.rotY != null) s.rotY = +scanNum(b.rotY, -720, 720, s.rotY).toFixed(2);
  if (b.scale != null) s.scale = +scanNum(b.scale, 0.001, 1000, s.scale).toFixed(5);
  if (['real', 'outline', 'hidden'].includes(b.show)) s.show = b.show;
  if (typeof b.pick === 'boolean') s.pick = b.pick;
  if (b.room === null) delete s.room; else if (typeof b.room === 'string') s.room = b.room.slice(0, 30);
  fpWrite(d); res.json({ ok: true, scan: s });
});
app.delete('/api/floorplan/floors/:id/scans/:sid', requirePro, (req, res) => {
  const { d, f, s } = scanOf(req);
  if (!s) return res.status(404).json({ error: 'no such scan' });
  f.scans = f.scans.filter((x) => x !== s); if (!f.scans.length) delete f.scans;
  fpWrite(d); scanSweep(); res.json({ ok: true });
});
/* Furniture brought in with a plan from Sweet Home 3D: plain boxes (meters; x, y on the plan, rot in degrees). */
app.put('/api/floorplan/floors/:id/boxes', requirePro, express.json({ limit: '256kb' }), (req, res) => {
  const d = fpData(), f = d.floors.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'no such floor' });
  const ok = (v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi, r = (v) => Math.round(Number(v) * 100) / 100;
  const boxes = (Array.isArray(req.body?.boxes) ? req.body.boxes : []).filter((b) => ok(b?.x, -500, 500) && ok(b?.y, -500, 500) && ok(b?.w, 0.02, 20) && ok(b?.d, 0.02, 20) && ok(b?.h, 0.02, 10)).slice(0, 400)
    .map((b) => ({ name: String(b.name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 40), x: r(b.x), y: r(b.y), w: r(b.w), d: r(b.d), h: r(b.h), elev: ok(b.elev, 0, 10) ? r(b.elev) : 0, rot: ok(b.rot, -720, 720) ? Math.round(Number(b.rot)) : 0 }));
  if (boxes.length) f.boxes = boxes; else delete f.boxes;
  fpWrite(d); res.json({ ok: true, boxes: boxes.length });
});
/* The files: the name changes whenever the content does, so a screen keeps its copy (no download on every visit). */
app.get('/api/floorplan/scan-files/:file', (req, res) => {
  const n = req.params.file;
  if (!SC_FILE.test(n) || !scanFiles(fpData()).has(n)) return res.status(404).end();
  const p = path.join(FP_DIR, n);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Content-Type', 'model/gltf-binary'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(p, { cacheControl: false, lastModified: true, etag: true });
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchScan = { scanGlbInfo, scanSweep, SC_FILE };
