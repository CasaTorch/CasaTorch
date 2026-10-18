/* Turn whatever a scanning app exported into one .glb for CasaTorch:
   - a .glb                         -> used as is
   - a .gltf (with its .bin and textures picked together, or embedded)
   - a .usdz / .usd (Apple RoomPlan apps, Reality Composer, Object Capture - the free export in many scanners)
   - an .obj (with its .mtl and textures, or inside a .zip) - the free export in most scanning apps
   - a .ply with colors (3D Scanner App, Scaniverse, the CasaTorch app's photo-real scan): a mesh, or a point cloud
   - a .zip from Polycam / Scaniverse / 3D Scanner App holding any of the above
   The conversion happens in the browser (three.js loaders -> GLTFExporter), so the box only ever stores .glb.

   Also here: floor plans from other programs - Sweet Home 3D (.sh3d) and DXF drawings (.dxf) - read into
   CasaTorch's drawn-floor format (rooms as boxes, walls as lines, in meters). These parsers are plain functions
   with no page or 3D parts, so they're tested on their own (test/scan-unit.mjs). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { itemOf } from './floorplan-look.js';

const base = (n) => n.split('/').pop();
// Scans should be in meters; some apps write centimeters - scale down anything absurdly large (no house is 200 m across)
function fitUnits(scene) {
  scene.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  if (Math.max(size.x, size.y, size.z) > 200) scene.scale.multiplyScalar(0.01);
}
/* Which way is up in a .ply: glTF, OBJ and USD say Y; many PLY writers use Z. The axis the most surface faces
   along is the floor-and-ceiling one (a room has more floor and ceiling than any one pair of walls). */
export function upAxisOf(geo) {
  const p = geo.attributes.position, idx = geo.index, n = idx ? idx.count : p.count, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), sum = [0, 0, 0];
  const step = Math.max(3, Math.floor(n / 3 / 20000) * 3);   // ~20 000 triangles is plenty to tell
  for (let i = 0; i + 2 < n; i += step) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
    b.sub(a); c.sub(a); b.cross(c);   // area-weighted normal
    sum[0] += Math.abs(b.x); sum[1] += Math.abs(b.y); sum[2] += Math.abs(b.z);
  }
  return sum[2] > sum[1] * 1.25 && sum[2] > sum[0] ? 'z' : 'y';
}
function plyObject(buf) {
  return import('three/addons/loaders/PLYLoader.js').then(({ PLYLoader }) => {
    const geo = new PLYLoader().parse(buf), color = !!geo.attributes.color;
    const faces = geo.index ? geo.index.count : 0, root = new THREE.Group();
    let obj;
    if (faces >= 3) {
      if (!geo.attributes.normal) geo.computeVertexNormals();
      obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, color: color ? '#ffffff' : '#c8c2b8' }));
      if (upAxisOf(geo) === 'z') root.rotation.x = -Math.PI / 2;
    } else {
      obj = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.02, vertexColors: color, color: color ? '#ffffff' : '#c8c2b8' }));
    }
    obj.name = 'Scan'; root.add(obj); return root;
  });
}
/* Every file the person picked (and every file inside a picked .zip), by name. */
async function gather(fileList) {
  const files = [...fileList];
  if (!files.length) throw new Error('Choose the file from your scan first.');
  const entries = new Map();
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const z = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [p, data] of Object.entries(z)) if (!p.startsWith('__MACOSX') && !p.endsWith('/') && data.length) entries.set(base(p), new Blob([data]));
    } else entries.set(f.name, f);
  }
  return entries;
}
/* The scan as a three.js scene. glb: the original file when it already was a .glb (sent as is when it's fine). */
export async function loadModel(fileList) {
  const entries = await gather(fileList), names = [...entries.keys()];
  const glb = names.find((n) => /\.glb$/i.test(n));
  if (glb) {
    const blob = entries.get(glb), url = URL.createObjectURL(blob);
    try { const g = await (await gltfLoader()).loadAsync(url); return { scene: g.scene, name: glb.replace(/\.glb$/i, ''), glb: blob }; }
    catch (e) { throw new Error(`Could not read that GLB (${e.message || e}).`); } finally { URL.revokeObjectURL(url); }
  }
  const ply = names.find((n) => /\.ply$/i.test(n));
  if (ply && !names.some((n) => /\.(gltf|obj|usdz|usdc|usda|usd)$/i.test(n))) {
    try { const scene = await plyObject(await entries.get(ply).arrayBuffer()); fitUnits(scene); return { scene, name: ply.replace(/\.ply$/i, '') }; }
    catch (e) { throw new Error(`Could not read that PLY (${e.message || e}). Try exporting the scan as GLB or OBJ instead.`); }
  }
  const usdName = names.find((n) => /\.(usdz|usdc|usda|usd)$/i.test(n));
  if (usdName && !names.some((n) => /\.(gltf|obj)$/i.test(n))) {
    try {
      const { USDLoader } = await import('three/addons/loaders/USDLoader.js');
      const scene = new USDLoader().parse(await entries.get(usdName).arrayBuffer());
      fitUnits(scene); return { scene, name: usdName.replace(/\.[^.]+$/, '') };
    } catch (e) { throw new Error(`Could not read that USDZ (${e.message || e}). Try exporting the scan as GLB or OBJ instead.`); }
  }
  const gltfName = names.find((n) => /\.gltf$/i.test(n)), objName = names.find((n) => /\.obj$/i.test(n));
  if (!gltfName && !objName) throw new Error('No 3D model found. Export your scan as GLB, USDZ, GLTF, OBJ or PLY, then pick the file (or the .zip, or the model together with its .mtl/.bin and image files).');
  const urls = new Map([...entries].map(([n, b]) => [n, URL.createObjectURL(b)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => { if (url.startsWith('data:')) return url; const n = decodeURIComponent(base(url).split('?')[0]); return urls.get(n) || url; });   // a picture named in the .mtl/.gltf: the picked file of that name
  try {
    if (gltfName) return { scene: (await (await gltfLoader(manager)).loadAsync(urls.get(gltfName))).scene, name: gltfName.replace(/\.gltf$/i, '') };
    const [{ OBJLoader }, { MTLLoader }] = await Promise.all([import('three/addons/loaders/OBJLoader.js'), import('three/addons/loaders/MTLLoader.js')]);
    const obj = new OBJLoader(manager), mtlName = names.find((n) => /\.mtl$/i.test(n));
    if (mtlName) { const m = await new MTLLoader(manager).loadAsync(urls.get(mtlName)); m.preload(); obj.setMaterials(m); }
    const scene = await obj.loadAsync(urls.get(objName));
    await waitTextures(scene);
    fitUnits(scene); return { scene, name: objName.replace(/\.obj$/i, '') };
  } catch (e) {
    throw new Error(`Could not read that model (${e.message || e}). If the scan came as several files, select the .gltf, .bin and image files together - or upload the .zip.`);
  } finally { setTimeout(() => { for (const u of urls.values()) URL.revokeObjectURL(u); }, 30_000); }   // pictures may still be decoding
}
/* OBJ pictures load after the model does: wait for them (up to 20 s), so they're in the export. */
function waitTextures(scene) {
  const imgs = []; scene.traverse((o) => { for (const m of [o.material].flat()) if (m?.map && !m.map.image) imgs.push(m.map); });
  if (!imgs.length) return Promise.resolve();
  return new Promise((ok) => { const t0 = Date.now(), tick = () => (imgs.every((t) => t.image) || Date.now() - t0 > 20_000 ? ok() : setTimeout(tick, 100)); tick(); });
}
/* Compressed scans: Draco (decoded by the plain JavaScript decoder, which every browser runs); meshopt and KTX2 when the browser may. */
let gltfBase = null;
export async function gltfLoader(manager) {
  const l = new GLTFLoader(manager);
  gltfBase ||= (async () => {
    const out = {};
    try { const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js'); out.draco = new DRACOLoader().setDecoderPath('/vendor/three/examples/jsm/libs/draco/'); out.draco.decoderConfig = { type: 'js' }; } catch { /* without */ }
    try { const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js'); await MeshoptDecoder.ready; out.meshopt = MeshoptDecoder; } catch { /* this page may not run WebAssembly */ }
    return out;
  })();
  const b = await gltfBase;
  if (b.draco) l.setDRACOLoader(b.draco);
  if (b.meshopt) l.setMeshoptDecoder(b.meshopt);
  return l;
}
export async function toGlb(fileList) {
  const m = await loadModel(fileList);
  if (m.glb) return { blob: m.glb, name: m.name };
  const out = await new GLTFExporter().parseAsync(m.scene, { binary: true });
  return { blob: new Blob([out], { type: 'model/gltf-binary' }), name: m.name };
}

/* Rooms scanned one at a time, joined into one floor: each part's model with the turn, size and place it
   was fitted to, in one .glb. A joined room's names get a short tag so its walls and furniture stay
   separate from the floor's own (hiding or painting one doesn't touch the other); RoomPlan's group and
   room markers keep their names, so walls, doors and rooms are still recognized. Parts hidden on the
   room are left out. */
export async function mergeGlb(parts) {
  const loader = new GLTFLoader(), root = new THREE.Group(); root.name = 'house';
  for (const p of parts) {
    const g = (await loader.loadAsync(p.url)).scene;
    if (p.hidden?.length) {
      const gone = new Set(p.hidden), meshes = []; g.traverse((o) => { if (o.isMesh) meshes.push(o); });
      meshes.forEach((m, i) => { if (gone.has(itemOf(m).name || m.name || `mesh${i}`)) m.parent?.remove(m); });
    }
    if (p.tag) g.traverse((o) => { if (o.name && !/_grp(_\d+)?$/i.test(o.name) && !/^section_grp(_\d+)?$/i.test(o.parent?.name || '')) o.name = `${o.name}_${p.tag}`; });
    const w = new THREE.Group(); w.position.set(p.pos[0], 0, p.pos[1]); w.rotation.y = p.rotY || 0; w.scale.setScalar(p.scale || 1); w.add(g); root.add(w);
  }
  const out = await new GLTFExporter().parseAsync(root, { binary: true });
  return new Blob([out], { type: 'model/gltf-binary' });
}

/* ======================================================================
 * Floor plans from other programs -> drawn floors (the format in floorplan-geom.js / 50d-drawplan.js)
 *   { floors: [{ name, level, heightM, plan: { rooms: [{ name, pts: [[x, y], ...] }], walls: [{ a: [x, y], b: [x, y], thick? }],
 *                openings: [{ kind, wall: n | room: n + edge: e, t | fromEdge, width, height, sill }] }, boxes: [...] }],
 *     notes: [[remark in plain words, with {gaps}, { values }]] for the preview (translated where shown) }
 * Meters; x to the right, y down the page (as in the drawing editor). Openings name their wall or room by its place
 * in these lists and are measured from that wall's start (or the room edge's start) to the opening's middle.
 * A drawn floor raises a wall along every room side (shared sides once), so rooms are moved onto the walls' middles.
 * ====================================================================== */
const r2 = (v) => Math.round(v * 100) / 100;
const PLAN_MAX_WALLS = 1000, PLAN_MAX_ROOMS = 200, PLAN_MAX_PTS = 200;
/* A room's outline as a box, when it is one (or very nearly fills one). */
export function polyToRect(pts) {
  if (!pts || pts.length < 3) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  if (w < 0.3 || h < 0.3) return null;
  return Math.abs(polyArea(pts)) >= w * h * 0.9 ? { x, y, w, h } : null;
}
function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
/* Outline points: no repeats, no points on a straight run, at most 200. */
function tidyPts(pts) {
  let out = pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01; });
  out = out.filter((p, i) => { const a = out[(i - 1 + out.length) % out.length], b = out[(i + 1) % out.length]; return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-4; });
  return out.slice(0, PLAN_MAX_PTS).map((p) => [r2(p[0]), r2(p[1])]);
}
const edgesOfRoom = (r) => r.pts.map((p, i) => [p, r.pts[(i + 1) % r.pts.length]]);
/* Rooms are usually drawn along a wall's inner face; CasaTorch's walls run along the rooms' sides (rooms that share
   a side share one wall). So each room corner moves onto the middle of the wall(s) it sits against - two rooms either
   side of a wall then share it, and the wall keeps its own thickness. */
export function snapRooms(rooms, walls) {
  const lines = walls.map((w) => { const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); return { a: w.a, ux: (w.b[0] - w.a[0]) / (L || 1), uy: (w.b[1] - w.a[1]) / (L || 1), L, reach: (w.thick || 0.12) / 2 + 0.06 }; }).filter((l) => l.L > 0.05);
  const near = (p) => lines.filter((l) => { const t = (p[0] - l.a[0]) * l.ux + (p[1] - l.a[1]) * l.uy, d = Math.abs((p[0] - l.a[0]) * -l.uy + (p[1] - l.a[1]) * l.ux); return d <= l.reach && t >= -l.reach - 0.05 && t <= l.L + l.reach + 0.05; })
    .sort((x, y) => Math.abs((p[0] - x.a[0]) * -x.uy + (p[1] - x.a[1]) * x.ux) - Math.abs((p[0] - y.a[0]) * -y.uy + (p[1] - y.a[1]) * y.ux));
  const onto = (p, l) => { const t = (p[0] - l.a[0]) * l.ux + (p[1] - l.a[1]) * l.uy; return [l.a[0] + l.ux * t, l.a[1] + l.uy * t]; };
  for (const r of rooms) r.pts = r.pts.map((p) => {
    const ls = near(p); if (!ls.length) return p;
    const other = ls.find((l) => Math.abs(l.ux * ls[0].uy - l.uy * ls[0].ux) > 0.2);
    if (!other) return onto(p, ls[0]).map(r2);
    const A = ls[0], B = other, den = A.ux * B.uy - A.uy * B.ux, t = ((B.a[0] - A.a[0]) * B.uy - (B.a[1] - A.a[1]) * B.ux) / den;   // where the two walls' middles cross
    return [r2(A.a[0] + A.ux * t), r2(A.a[1] + A.uy * t)];
  });
  return rooms.map((r) => ({ ...r, pts: tidyPts(r.pts) })).filter((r) => r.pts.length >= 3);
}
/* Two lines drawn for one wall (its two faces, as most CAD drawings do): one wall along the middle, as thick as the gap. */
export function mergeFaces(segs, minGap = 0.04, maxGap = 0.5) {
  const out = [], used = new Array(segs.length).fill(false);
  const info = segs.map(([x1, y1, x2, y2]) => { const L = Math.hypot(x2 - x1, y2 - y1); return { L, ux: (x2 - x1) / (L || 1), uy: (y2 - y1) / (L || 1) }; });
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const [x1, y1, x2, y2] = segs[i], A = info[i];
    let best = -1, bestGap = Infinity, span = null;
    for (let j = i + 1; j < segs.length; j++) {
      if (used[j]) continue;
      const B = info[j]; if (Math.abs(A.ux * B.uy - A.uy * B.ux) > 0.035) continue;   // not parallel (2°)
      const [a1, b1, a2, b2] = segs[j], gap = Math.abs((a1 - x1) * -A.uy + (b1 - y1) * A.ux);
      if (gap < minGap || gap > maxGap || gap >= bestGap) continue;
      const t1 = (a1 - x1) * A.ux + (b1 - y1) * A.uy, t2 = (a2 - x1) * A.ux + (b2 - y1) * A.uy, lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(A.L, Math.max(t1, t2));
      if (hi - lo < Math.min(A.L, B.L) * 0.7) continue;
      best = j; bestGap = gap; span = [lo, hi];
    }
    if (best < 0) { out.push({ a: [x1, y1], b: [x2, y2] }); continue; }
    used[best] = true;
    const [a1, b1] = segs[best], side = Math.sign((a1 - x1) * -A.uy + (b1 - y1) * A.ux), nx = -A.uy * side * bestGap / 2, ny = A.ux * side * bestGap / 2;
    out.push({ a: [x1 + A.ux * span[0] + nx, y1 + A.uy * span[0] + ny], b: [x1 + A.ux * span[1] + nx, y1 + A.uy * span[1] + ny], thick: Math.max(0.05, Math.min(0.6, bestGap)) });
  }
  return out;
}
const tidyWall = (w) => ({ a: [r2(w.a[0]), r2(w.a[1])], b: [r2(w.b[0]), r2(w.b[1])], ...(w.thick ? { thick: r2(Math.max(0.05, Math.min(0.6, w.thick))) } : {}) });
const WALL_LAYER = /wall|mur|wand|muro|parete|muur|[sś]cian|v[aä]gg|duvar|壁|墙|벽/i, ROOM_LAYER = /room|space|area|raum|pi[eè]ce|habitaci|stanza|kamer|pok[oó]j|rum|oda|部屋|房间|방/i;
const DXF_UNITS = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };
export const UNIT_SCALE = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
/* DXF (AutoCAD and most CAD programs, also "export to DXF" in many floor-plan apps): walls from LINE, LWPOLYLINE
   and POLYLINE on wall layers (every layer when none is named like one), rooms from closed boxes on room layers.
   opts.units: 'auto' (from the file, else guessed from the size) or mm / cm / m / in / ft. */
export function parseDxf(text, opts = {}) {
  const lines = String(text).split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  let insunits = 0, section = null;
  const ents = []; let cur = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') { section = pairs[i + 1]?.[1]; continue; }
    if (c === 0 && v === 'ENDSEC') { if (cur) ents.push(cur); cur = null; section = null; continue; }
    if (section === 'HEADER' && c === 9 && v === '$INSUNITS') { insunits = parseInt(pairs[i + 1]?.[1], 10) || 0; continue; }
    if (section !== 'ENTITIES') continue;
    if (c === 0) { if (cur) ents.push(cur); cur = { type: v, layer: '', pts: [], flags: 0 }; continue; }
    if (!cur) continue;
    if (c === 8) cur.layer = v;
    else if (c === 70) cur.flags = parseInt(v, 10) || 0;
    else if (c === 10) cur.pts.push([parseFloat(v), 0]);
    else if (c === 20 && cur.pts.length) cur.pts[cur.pts.length - 1][1] = parseFloat(v);
    else if (c === 11) cur.end = [parseFloat(v), 0];
    else if (c === 21 && cur.end) cur.end[1] = parseFloat(v);
  }
  if (cur) ents.push(cur);
  // old-style POLYLINE: its points come as VERTEX entities up to SEQEND
  const shapes = [], notes = [];
  let skipped = 0;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.type === 'LINE' && e.pts[0] && e.end) shapes.push({ layer: e.layer, pts: [e.pts[0], e.end], closed: false });
    else if (e.type === 'LWPOLYLINE' && e.pts.length >= 2) shapes.push({ layer: e.layer, pts: e.pts, closed: !!(e.flags & 1) });
    else if (e.type === 'POLYLINE') {
      const pts = []; let j = i + 1;
      for (; j < ents.length && ents[j].type === 'VERTEX'; j++) if (ents[j].pts[0]) pts.push(ents[j].pts[0]);
      if (pts.length >= 2) shapes.push({ layer: e.layer, pts, closed: !!(e.flags & 1) });
      i = j;
    } else if (['INSERT', 'ARC', 'CIRCLE', 'SPLINE', 'ELLIPSE'].includes(e.type)) skipped++;
  }
  const ok = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const all = shapes.filter((s) => s.pts.every(ok));
  if (!all.length) throw new Error('No lines found in that DXF. Save it with the walls as lines or polylines (not blocks).');
  const layers = [...new Set(all.map((s) => s.layer))], wallLayers = layers.filter((l) => WALL_LAYER.test(l)), roomLayers = layers.filter((l) => ROOM_LAYER.test(l) && !WALL_LAYER.test(l));
  const xs = all.flatMap((s) => s.pts.map((p) => p[0])), ys = all.flatMap((s) => s.pts.map((p) => p[1]));
  const minX = Math.min(...xs), maxY = Math.max(...ys), extent = Math.max(Math.max(...xs) - minX, maxY - Math.min(...ys));
  const k = opts.units && opts.units !== 'auto' ? UNIT_SCALE[opts.units] : DXF_UNITS[insunits] || (extent > 3000 ? 0.001 : extent > 300 ? 0.01 : 1);
  const unitName = Object.entries(UNIT_SCALE).find(([, v]) => v === k)?.[0] || 'm';
  const P = (p) => [(p[0] - minX) * k, (maxY - p[1]) * k];   // CAD drawings have y up; the plan has y down the page
  const rooms = [], segs = [];
  for (const s of all) {
    if (roomLayers.includes(s.layer)) { const pts = s.closed || s.pts.length >= 4 ? tidyPts(s.pts.map(P)) : []; if (pts.length >= 3 && Math.abs(polyArea(pts)) >= 0.5) { rooms.push({ name: '', pts }); continue; } }
    if (wallLayers.length && !wallLayers.includes(s.layer)) continue;
    if (!wallLayers.length && roomLayers.includes(s.layer)) continue;
    const pts = s.pts.map(P); if (s.closed) pts.push(pts[0]);
    for (let i = 0; i + 1 < pts.length; i++) segs.push([...pts[i], ...pts[i + 1]]);
  }
  let walls = mergeFaces(segs.filter(([a, b, c, d]) => Math.hypot(c - a, d - b) >= 0.05));
  walls = walls.map(tidyWall); rooms.splice(0, rooms.length, ...snapRooms(rooms, walls));
  const seen = new Set(); walls = walls.filter((w) => { const key = [...w.a, ...w.b].join(','), rev = [...w.b, ...w.a].join(','); if (seen.has(key) || seen.has(rev)) return false; seen.add(key); return true; });
  if (walls.length > PLAN_MAX_WALLS) { notes.push(['Only the first {max} of {n} walls were kept.', { max: PLAN_MAX_WALLS, n: walls.length }]); walls = walls.slice(0, PLAN_MAX_WALLS); }
  if (wallLayers.length) notes.push(['Walls from the layers: {layers}.', { layers: wallLayers.join(', ') }]);
  else notes.push(['No layer is named like walls, so every line became a wall.', {}]);
  if (skipped) notes.push(['Curves and blocks left out (door swings, furniture symbols): {n}.', { n: skipped }]);
  rooms.forEach((r, i) => { r.name = `Room ${i + 1}`; });
  return { units: unitName, unitsFromFile: !!DXF_UNITS[insunits] && (!opts.units || opts.units === 'auto'), floors: [{ name: 'Ground floor', level: 0, heightM: 2.7, plan: { rooms: rooms.slice(0, PLAN_MAX_ROOMS), walls, openings: [] }, boxes: [] }], notes };
}
/* A tiny XML reader for Home.xml: every element's name, attributes and children. Enough for Sweet Home 3D's
   own file (no DTD, no namespaces needed); anything else in it is ignored. */
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENT[e] ?? m));
export function parseXml(text) {
  const root = { name: '#root', attrs: {}, kids: [] }, stack = [root], re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1 && stack[stack.length - 1].name === m[2]) stack.pop(); continue; }
    const attrs = {}; for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unxml(a[2] ?? a[3]);
    const node = { name: m[2], attrs, kids: [] }; stack[stack.length - 1].kids.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}
const walk = (n, fn) => { fn(n); for (const k of n.kids) walk(k, fn); };
const OPEN_KIND = (name, elev) => (/garage/i.test(name) ? 'garage' : /slid|coulis|schiebe|corredera/i.test(name) ? 'slider' : /double|french|doppel/i.test(name) ? 'double' : /window|fen[eê]tre|fenster|ventana|finestra|raam|okno|f[oö]nster|pencere|窓|窗|창/i.test(name) || elev > 0.3 ? 'window' : 'door');
/* Sweet Home 3D: Home.xml (in every .sh3d saved by version 5.3 or later) - its levels become floors, with
   walls, rooms, doors and windows (matched to the wall they sit in), and furniture as simple boxes. */
export function parseSh3dXml(text) {
  const doc = parseXml(text), home = doc.kids.find((k) => k.name === 'home');
  if (!home) throw new Error('That is not a Sweet Home 3D home (no Home.xml inside).');
  const num = (v, d = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d), cm = (v) => num(v) / 100;
  const levels = [], walls = [], rooms = [], pieces = [];
  walk(home, (n) => {
    const a = n.attrs;
    if (n.name === 'level') levels.push({ id: a.id, name: a.name || '', elev: cm(a.elevation), height: cm(a.height) || 2.5, idx: num(a.elevationIndex, levels.length), visible: a.viewable !== 'false' });
    else if (n.name === 'wall') walls.push({ level: a.level || null, x1: cm(a.xStart), y1: cm(a.yStart), x2: cm(a.xEnd), y2: cm(a.yEnd), t: cm(a.thickness) || 0.1, h: cm(a.height) || cm(home.attrs.wallHeight) || 2.5, arc: !!a.arcExtent });
    else if (n.name === 'room') { const pts = n.kids.filter((k) => k.name === 'point').map((k) => [cm(k.attrs.x), cm(k.attrs.y)]); if (pts.length >= 3) rooms.push({ level: a.level || null, name: a.name || '', pts }); }
    else if (n.name === 'doorOrWindow' || n.name === 'pieceOfFurniture') pieces.push({ door: n.name === 'doorOrWindow' || a.doorOrWindow === 'true', level: a.level || null, name: a.name || '', x: cm(a.x), y: cm(a.y), w: cm(a.width), d: cm(a.depth), h: cm(a.height), elev: cm(a.elevation), angle: num(a.angle), visible: a.visible !== 'false' });
  });
  if (!walls.length && !rooms.length) throw new Error('That Sweet Home 3D home has no walls or rooms yet.');
  const all = [...walls.flatMap((w) => [[w.x1, w.y1], [w.x2, w.y2]]), ...rooms.flatMap((r) => r.pts)], minX = Math.min(...all.map((p) => p[0])), minY = Math.min(...all.map((p) => p[1]));
  const lv = levels.length ? [...levels].sort((a, b) => a.elev - b.elev || a.idx - b.idx) : [{ id: null, name: '', height: walls[0]?.h || 2.5 }];
  const notes = []; let arcs = 0, lostOpen = 0;
  const floors = lv.map((L, li) => {
    const mine = (x) => (levels.length ? x.level === L.id || (!x.level && li === 0) : true);
    const wl = walls.filter(mine); arcs += wl.filter((w) => w.arc).length;
    const keep = wl.map((w) => ({ a: [w.x1 - minX, w.y1 - minY], b: [w.x2 - minX, w.y2 - minY], thick: w.t })).filter((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) >= 0.05);
    const fr = snapRooms(rooms.filter(mine).map((r) => ({ name: r.name.slice(0, 30), pts: r.pts.map(([x, y]) => [x - minX, y - minY]) })), keep);
    const plan = { rooms: fr.slice(0, PLAN_MAX_ROOMS).map((r, i) => ({ name: r.name || `Room ${i + 1}`, pts: r.pts })), walls: keep.slice(0, PLAN_MAX_WALLS).map(tidyWall) };
    /* Doors and windows: in the nearest wall (a drawn one or a room's edge), measured from that wall's start to the opening's middle. */
    const cands = [...plan.walls.map((w, i) => ({ ref: { wall: i }, s: [...w.a, ...w.b] })), ...plan.rooms.flatMap((r, i) => edgesOfRoom(r).map(([p, q], e) => ({ ref: { room: i, edge: e }, s: [...p, ...q] })))];
    const openings = [], boxes = [];
    for (const p of pieces.filter(mine)) {
      if (!p.visible) continue;
      const x = p.x - minX, y = p.y - minY;
      if (!p.door) { boxes.push({ name: p.name.slice(0, 40), x: r2(x), y: r2(y), w: r2(Math.max(0.05, p.w)), d: r2(Math.max(0.05, p.d)), h: r2(Math.max(0.05, p.h)), elev: r2(p.elev), rot: Math.round(p.angle * 180 / Math.PI) }); continue; }
      let best = null;
      for (const c of cands) {
        const [a, b, cx, cy] = c.s, L = Math.hypot(cx - a, cy - b); if (L < 0.1) continue;
        const t = ((x - a) * (cx - a) + (y - b) * (cy - b)) / L, dist = Math.abs((x - a) * (cy - b) - (y - b) * (cx - a)) / L;
        if (t < -0.2 || t > L + 0.2 || dist > Math.max(0.35, p.d)) continue;
        if (!best || dist < best.dist - 0.01 || (Math.abs(dist - best.dist) <= 0.01 && c.ref.wall != null)) best = { ...c, t: Math.max(0, Math.min(L, t)), dist };
      }
      if (!best) { lostOpen++; continue; }
      const kind = OPEN_KIND(p.name, p.elev);
      openings.push({ kind, ...best.ref, ...(best.ref.wall != null ? { t: r2(best.t) } : { fromEdge: r2(best.t) }), width: r2(Math.max(0.3, Math.min(10, p.w))), height: r2(Math.max(0.3, Math.min(6, p.h))), sill: kind === 'window' ? r2(Math.max(0, p.elev)) : 0 });
    }
    return { name: (L.name || (lv.length > 1 ? `Floor ${li + 1}` : 'Ground floor')).slice(0, 40), level: li, heightM: r2(Math.max(1.5, Math.min(10, L.height || 2.5))), plan: { ...plan, openings: openings.slice(0, 500) }, boxes: boxes.slice(0, 400) };
  }).filter((f) => f.plan.rooms.length || f.plan.walls.length);
  if (arcs) notes.push(['Curved walls brought in straight: {n}.', { n: arcs }]);
  if (lostOpen) notes.push(['Doors and windows not in any wall, left out: {n}.', { n: lostOpen }]);
  return { units: 'cm', floors, notes };
}
/* A picked plan file -> the floors it holds. */
export async function readPlanFile(file, opts = {}) {
  if (/\.dxf$/i.test(file.name)) return parseDxf(await file.text(), opts);
  if (/\.sh3d$/i.test(file.name) || /\.zip$/i.test(file.name)) {
    let z; try { z = unzipSync(new Uint8Array(await file.arrayBuffer())); } catch { throw new Error('That file is damaged - open it in Sweet Home 3D and save it again.'); }
    const xml = Object.entries(z).find(([p]) => /(^|\/)Home\.xml$/i.test(p));
    if (!xml) throw new Error('That home was saved by an old Sweet Home 3D (before 5.3). Open it in a newer Sweet Home 3D and save it again.');
    return parseSh3dXml(new TextDecoder().decode(xml[1]));
  }
  throw new Error('Pick a Sweet Home 3D home (.sh3d) or a DXF drawing (.dxf).');
}
