/* Photo-real scans on the 3D home: the real rooms, as a phone's LiDAR saw them, on top of a drawn or scanned floor.
   - Bringing one in: any scan app's export (GLB, glTF, USDZ, OBJ + MTL + pictures, PLY with colors, or a .zip of
     them) is turned into a .glb here in the browser, with a lighter copy (fewer triangles, smaller pictures) for
     wall tablets and old screens, then uploaded to the floor (server: src/server/50s-scan.js).
   - Lining it up: found automatically (the floor in the scan is the lowest big flat surface; its walls are turned
     square with the plan's), then two taps on a corner in the scan and the same corner on the plan, twice, or
     exact numbers.
   - Showing it: as it is (the photo colors, as captured - lit the way the room was, dimmed at night), as a
     see-through outline, or hidden. It never blocks taps on the plan unless "Taps land on it" is on; devices
     (pins) stay on top. The ceiling is cut away so you look in from above, and Dollhouse / Cut lower its near or
     all walls like the plan's.
   The math (floor level, wall direction, two-point fit) is plain functions, tested in test/scan-unit.mjs. */
import * as THREE from 'three';

const fmt = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const T = (s, v) => (globalThis.T ? globalThis.T(s, v) : fmt(s, v));
const V3 = THREE.Vector3, D2R = Math.PI / 180;

/* ---------------- the math ---------------- */
/* Triangles of a model, sampled to at most `max`: [cx, cy, cz, nx, ny, nz, area] per row, in the space the model sits in
   (its parent's - its own turn and size included). Also its points (a point cloud) and the box around it all. */
export function surfaceSample(root, max = 150000) {
  root.updateWorldMatrix(true, true);
  const inv = root.parent ? new THREE.Matrix4().copy(root.parent.matrixWorld).invert() : new THREE.Matrix4(), meshes = [], pts = [];
  root.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o); else if (o.isPoints && o.geometry?.attributes?.position) pts.push(o); });
  const total = meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  const step = Math.max(1, Math.ceil(total / max)), out = [], a = new V3(), b = new V3(), c = new V3(), M = new THREE.Matrix4();
  for (const m of meshes) {
    M.multiplyMatrices(inv, m.matrixWorld);
    const g = m.geometry, p = g.attributes.position, idx = g.index, n = (idx ? idx.count : p.count) / 3;
    for (let t = 0; t < n; t += step) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(M); b.fromBufferAttribute(p, i1).applyMatrix4(M); c.fromBufferAttribute(p, i2).applyMatrix4(M);
      const cy = (a.y + b.y + c.y) / 3, cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
      b.sub(a); c.sub(a); b.cross(c); const area2 = b.length(); if (area2 < 1e-9) continue;
      out.push([cx, cy, cz, b.x / area2, b.y / area2, b.z / area2, area2 / 2 * step]);
    }
  }
  const points = [];
  for (const o of pts) { M.multiplyMatrices(inv, o.matrixWorld); const p = o.geometry.attributes.position, s = Math.max(1, Math.ceil(p.count / max)); for (let i = 0; i < p.count; i += s) points.push(a.fromBufferAttribute(p, i).applyMatrix4(M).toArray()); }
  const box = new THREE.Box3(); for (const t of out) box.expandByPoint(a.set(t[0], t[1], t[2])); for (const q of points) box.expandByPoint(a.fromArray(q));
  return { tris: out, points, box };
}
/* The floor: the lowest large flat surface facing up or down (a scan's triangles may face either way).
   Returns { floor, ceiling } heights in the model's space (ceiling null when the scan has none). */
export function floorLevel(sample, bin = 0.03) {
  const flat = sample.tris.filter((t) => Math.abs(t[4]) > 0.92);
  let ys = flat.map((t) => [t[1], t[6]]);
  if (!ys.length && sample.points.length) ys = sample.points.map((p) => [p[1], 1]);
  if (!ys.length) return { floor: 0, ceiling: null };
  const lo = Math.min(...ys.map((y) => y[0])), hi = Math.max(...ys.map((y) => y[0])), n = Math.max(1, Math.ceil((hi - lo) / bin) + 1), h = new Float64Array(n);
  for (const [y, w] of ys) h[Math.min(n - 1, Math.floor((y - lo) / bin))] += w;
  const sm = Array.from(h, (v, i) => v + (h[i - 1] || 0) + (h[i + 1] || 0)), max = Math.max(...sm), enough = Math.max(max * 0.3, sample.points.length ? 0 : 0.25);
  const at = (i) => { let sw = 0, s = 0; for (const [y, w] of ys) { const k = Math.floor((y - lo) / bin); if (k >= i - 1 && k <= i + 1) { sw += w; s += y * w; } } return sw ? s / sw : lo + i * bin; };
  let f = sm.findIndex((v) => v >= enough); if (f < 0) f = 0;
  let c = -1; for (let i = n - 1; i > f; i--) if (sm[i] >= enough && (i - f) * bin > 1.8) { c = i; break; }
  return { floor: at(f), ceiling: c >= 0 ? at(c) : null };
}
/* Which way the walls run: the angle (radians, in -45°..45°) of the walls' main direction, from the vertical surfaces
   (area-weighted, folded so walls at right angles count together). */
export function wallYaw(sample) {
  let C = 0, Sn = 0;
  for (const t of sample.tris) { if (Math.abs(t[4]) > 0.25) continue; const h = Math.hypot(t[3], t[5]); if (h < 1e-6) continue; const a = 4 * Math.atan2(t[5], t[3]), w = t[6] * h; C += w * Math.cos(a); Sn += w * Math.sin(a); }
  return C === 0 && Sn === 0 ? 0 : Math.atan2(Sn, C) / 4;
}
/* Turn a scan by its walls' angle minus the plan's, folded into -45°..45° (degrees). */
export const squareTurn = (scanYaw, planYaw) => { let d = (scanYaw - planYaw) / D2R; d = ((d + 45) % 90 + 90) % 90 - 45; return Math.round(d * 100) / 100; };
/* Where a placed scan's point lands on the floor: pos + turn(rotY) * scale * p (three.js turns about y). */
export function placePoint(p, place) {
  const t = (place.rotY || 0) * D2R, k = place.scale || 1, c = Math.cos(t), s = Math.sin(t);
  return [place.pos[0] + k * (p[0] * c + p[2] * s), place.pos[1] + k * p[1], place.pos[2] + k * (-p[0] * s + p[2] * c)];
}
/* Two corners tapped in the scan (its own space) and the same two on the plan (the floor's space): the turn, size and
   place that put them together (seen from above). Size changes only with withScale. */
export function twoPointFit(s1, s2, p1, p2, cur, withScale) {
  const vs = [s2[0] - s1[0], s2[2] - s1[2]], vp = [p2[0] - p1[0], p2[2] - p1[2]], ls = Math.hypot(...vs), lp = Math.hypot(...vp);
  if (ls < 0.05 || lp < 0.05) return null;
  const t = Math.atan2(vs[1], vs[0]) - Math.atan2(vp[1], vp[0]), k = withScale ? lp / ls : cur.scale || 1, c = Math.cos(t), s = Math.sin(t);
  const x = p1[0] - k * (s1[0] * c + s1[2] * s), z = p1[2] - k * (-s1[0] * s + s1[2] * c);
  let deg = t / D2R; deg = ((deg + 180) % 360 + 360) % 360 - 180;
  return { pos: [+x.toFixed(3), cur.pos[1], +z.toFixed(3)], rotY: +deg.toFixed(2), scale: +k.toFixed(5) };
}

/* ---------------- making the upload: full copy + lighter copy ---------------- */
const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
async function exportGlb(root, maxTextureSize) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  root.traverse((o) => { for (const m of [o.material].flat()) if (m?.map && !m.transparent && !m.alphaTest) m.map.userData.mimeType = 'image/jpeg'; });   // photos: JPEG, a fraction of PNG's size
  const out = await new GLTFExporter().parseAsync(root, { binary: true, maxTextureSize, onlyVisible: true });
  return new Blob([out], { type: 'model/gltf-binary' });
}
/* Fewer triangles, same look: meshoptimizer where this page can run it, otherwise grid clustering (vertices in the
   same small cell, with nearly the same picture position, become one). */
async function simplifyGeometry(g, ratio) {
  const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js');
  let geo = g.index ? g : mergeVertices(g, 1e-4);
  const idx = geo.index.array, target = Math.max(3, Math.floor(idx.length * ratio / 3) * 3);
  let out = null;
  try {
    const { MeshoptSimplifier } = await import('three/addons/libs/meshopt_simplifier.module.js');
    await MeshoptSimplifier.ready;
    const pos = geo.attributes.position.array instanceof Float32Array && geo.attributes.position.itemSize === 3 && !geo.attributes.position.isInterleavedBufferAttribute ? geo.attributes.position.array : Float32Array.from({ length: geo.attributes.position.count * 3 }, (_, i) => geo.attributes.position.getComponent(Math.floor(i / 3), i % 3));
    [out] = MeshoptSimplifier.simplify(Uint32Array.from(idx), pos, 3, target, 0.02, []);
  } catch { out = clusterIndices(geo, target); }
  return compact(geo, out);
}
export function clusterIndices(geo, target) {
  const p = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index.array, bb = new THREE.Box3().setFromBufferAttribute(p), A = new V3(), B = new V3(), Cc = new V3();
  let area = 0; for (let t = 0; t < idx.length; t += 3) { A.fromBufferAttribute(p, idx[t]); B.fromBufferAttribute(p, idx[t + 1]).sub(A); Cc.fromBufferAttribute(p, idx[t + 2]).sub(A); area += B.cross(Cc).length() / 2; }
  let cell = Math.max(1e-4, Math.sqrt(2 * area / Math.max(1, target / 3)));   // a grid that leaves about the triangles wanted
  for (let tries = 0; tries < 8; tries++) {
    const map = new Map(), rep = new Int32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const key = `${Math.floor((p.getX(i) - bb.min.x) / cell)},${Math.floor((p.getY(i) - bb.min.y) / cell)},${Math.floor((p.getZ(i) - bb.min.z) / cell)}${uv ? `,${Math.floor(uv.getX(i) * 24)},${Math.floor(uv.getY(i) * 24)}` : ''}`;
      let r = map.get(key); if (r === undefined) { r = i; map.set(key, i); } rep[i] = r;
    }
    const out = [];
    for (let t = 0; t < idx.length; t += 3) { const a = rep[idx[t]], b = rep[idx[t + 1]], c = rep[idx[t + 2]]; if (a !== b && b !== c && a !== c) out.push(a, b, c); }
    if (out.length <= target * 1.3 || tries === 7) return Uint32Array.from(out);
    cell *= 1.5;
  }
  return Uint32Array.from(idx);
}
export function compact(geo, indices) {
  const used = new Map(), order = [];
  for (const i of indices) if (!used.has(i)) { used.set(i, order.length); order.push(i); }
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(geo.attributes)) {
    const arr = new a.array.constructor(order.length * a.itemSize), na = new THREE.BufferAttribute(arr, a.itemSize, a.normalized);
    if (a.isInterleavedBufferAttribute) { for (let j = 0; j < order.length; j++) for (let k = 0; k < a.itemSize; k++) na.setComponent(j, k, a.getComponent(order[j], k)); }   // (normalized values go back the way they came)
    else for (let j = 0; j < order.length; j++) for (let k = 0; k < a.itemSize; k++) arr[j * a.itemSize + k] = a.array[order[j] * a.itemSize + k];   // raw: colors stored as bytes stay bytes
    out.setAttribute(name, na);
  }
  out.setIndex(Array.from(indices, (i) => used.get(i)));
  for (const gr of geo.groups) out.addGroup(0, indices.length, gr.materialIndex);   // (scans are one material per mesh; keep the first)
  if (out.groups.length > 1) { out.clearGroups(); }
  return out;
}
const LOW_TRIS = 150000;
async function lowCopy(root, tris) {
  const low = root.clone(true), ratio = Math.min(1, LOW_TRIS / Math.max(1, tris)), jobs = [];
  low.traverse((o) => {
    if (o.isMesh && ratio < 0.95 && triCount(o.geometry) > 500) jobs.push(simplifyGeometry(o.geometry, ratio).then((g) => { o.geometry = g; }));
    if (o.isPoints && ratio < 0.95) { const g = o.geometry, s = Math.ceil(1 / ratio), keep = []; for (let i = 0; i < g.attributes.position.count; i += s) keep.push(i); o.geometry = compact(g, keep); o.geometry.setIndex(null); }
  });
  await Promise.all(jobs);
  return exportGlb(low, 1024);
}
/* Any scan export -> { full, low, name, tris, info }. */
export async function prepareScan(files, step = () => {}) {
  const { loadModel, useRenderer } = await import('./floorplan-import.js');
  useRenderer(C?.renderer);   // KTX2 pictures in the scan: decoded for this screen
  step(T('Reading the scan…'));
  const m = await loadModel(files), root = m.scene;
  let tris = 0, points = 0, bigTex = 0;
  root.traverse((o) => { if (o.isMesh) tris += triCount(o.geometry); if (o.isPoints) points += o.geometry.attributes.position.count; for (const mt of [o.material].flat()) { const im = mt?.map?.image; if (im) bigTex = Math.max(bigTex, im.width || 0, im.height || 0); } });
  if (!tris && !points) throw new Error(T('That file has no surfaces to show.'));
  step(T('Getting it ready…'));
  const full = m.glb && m.glb.size < 240e6 && bigTex <= 4096 ? m.glb : await exportGlb(root, 4096);
  let low = null;
  if (tris > LOW_TRIS * 1.2 || points > LOW_TRIS * 2 || bigTex > 1024) { step(T('Making a lighter copy for tablets…')); low = await lowCopy(root, tris || points / 2); }
  const sample = surfaceSample(root);
  return { full, low, name: m.name, tris, points, auto: { ...floorLevel(sample), yaw: wallYaw(sample), center: sample.box.getCenter(new V3()).toArray() } };
}

/* ---------------- on the 3D home ---------------- */
/* This module's own few styles (kept here so it doesn't touch the shared stylesheet). */
const CSS = `.scans{margin-top:8px;border-top:1px solid var(--line);padding-top:6px}.scans h4,.scanalign h4{margin:8px 0 4px;font-size:13px}
.scanrow{border:1px solid var(--line);border-radius:10px;padding:6px 8px;margin:6px 0}.scanrow .row{flex-wrap:wrap;gap:6px}
.scanalign .scanstep{font-weight:600;margin:4px 0}.scanalign input[type=number]{width:90px}.chk,.row label.chk{display:flex;gap:6px;align-items:center;font-size:12px;width:auto;flex:1 1 auto;color:inherit}.chk input{width:auto;flex:none;margin:0}
.planimport{max-height:90vh;overflow:auto;width:min(640px,94vw)}.planprev{display:block;width:100%;height:240px;margin-top:6px;background:#0001;border-radius:8px}
.planprev .pr{fill:#38bdf833;stroke:#38bdf8;stroke-width:.04}.planprev .pw{stroke:currentColor;stroke-linecap:round}.planprev .pdoor{stroke:#f59e0b;stroke-width:.14}.planprev .pwin{stroke:#38bdf8;stroke-width:.14}.planprev text{fill:currentColor}
#scanStatus{bottom:120px}`;
let C = null;   // what floorplan.js shares: scene, camera, renderer, S, el, api, toast, kick, reshadow, reload, editor, look, wallsMode, quality
const live = new Map();   // scan id -> { s, F, holder, model, low, U (shader inputs), analysis }
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const tabletLike = () => (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const lowWanted = () => { const q = C?.quality?.() || 'high'; return q === 'low' || (q !== 'high' && tabletLike()); };
export function initScans(ctx) {
  C = ctx;
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  let down = null;
  addEventListener('pointerdown', (e) => { if (e.target === C.renderer.domElement) down = [e.clientX, e.clientY]; }, true);
  addEventListener('click', (e) => {
    const tool = C.S.tool; if (tool?.type !== 'scan-align' || e.target !== C.renderer.domElement) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;   // a drag (turning the view)
    alignTap(e.clientX, e.clientY);
  }, true);
}
const holderOf = (F, s) => {
  const h = new THREE.Group(); h.name = `scan:${s.id}`; h.userData.scan = s.id; h.userData.keep = true;
  h.position.set(...s.pos); h.rotation.y = (s.rotY || 0) * D2R; h.scale.setScalar(s.scale || 1); F.G.add(h); return h;
};
/* Shader inputs per scan: the ceiling cut, the lowered-walls cut (height, and which side is near), and the daylight. */
const makeU = () => ({ uCeil: { value: 1e6 }, uLow: { value: 1e6 }, uNear: { value: new THREE.Vector3(0, 0, -1e6) }, uLight: { value: 1 } });
function cutMaterial(m, U, unlit) {
  /* A scan's walls and floor sit exactly where the plan's do: drawn a hair nearer, so the photo wins (no flicker between the two). */
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = `varying vec3 vScW;\n${sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vScW = (modelMatrix * vec4(transformed, 1.0)).xyz;')}`;
    sh.fragmentShader = `varying vec3 vScW;\nuniform float uCeil, uLow, uLight;\nuniform vec3 uNear;\n${sh.fragmentShader.replace('void main() {', 'void main() {\n  if (vScW.y > uCeil || (vScW.y > uLow && dot(vScW.xz, uNear.xy) > uNear.z)) discard;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${unlit ? '  gl_FragColor.rgb *= uLight;' : '  gl_FragColor.rgb *= max(uLight, 0.35);'}`)}`;
  };
  m.customProgramCacheKey = () => `scan-cut-${unlit ? 1 : 0}`;
  return m;
}
/* The scan in its own colors: unlit (the light is already in the photos), so it looks like the room did. */
function realMaterials(model, U) {
  model.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return;
    const was = o.material, list = [was].flat();
    const made = list.map((m) => {
      if (o.isPoints) return cutMaterial(new THREE.PointsMaterial({ size: m.size || 0.02, vertexColors: !!o.geometry.attributes.color, color: m.color || '#fff', toneMapped: false }), U, true);
      const photo = !!m?.map || !!o.geometry.attributes.color;
      if (!photo) return cutMaterial(new THREE.MeshStandardMaterial({ color: m?.color || '#d8d2c8', roughness: 0.85, side: THREE.DoubleSide }), U, false);
      return cutMaterial(new THREE.MeshBasicMaterial({ map: m.map || null, color: m.map ? '#ffffff' : (m.color || '#ffffff'), vertexColors: !!o.geometry.attributes.color, side: THREE.DoubleSide, toneMapped: false, transparent: !!m.transparent, alphaTest: m.alphaTest || 0 }), U, true);
    });
    o.material = Array.isArray(was) ? made : made[0];
    o.userData.real = o.material;
    for (const m of list) if (m && !made.includes(m)) m.dispose();   // the pictures stay: the new ones use them
  });
}
function ghostMaterial(U) { return cutMaterial(new THREE.MeshBasicMaterial({ color: C.look().edge || '#9aa3ae', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }), U, true); }
function applyShow(L) {
  const show = L.s.show || 'real', tool = C.S.tool, aligning = tool?.type === 'scan-align' && tool.sid === L.s.id, plan = aligning && tool.step % 2 === 1;
  L.holder.visible = show !== 'hidden' || aligning;
  if (!L.model) return;
  const ghost = show === 'outline' || plan || (show === 'hidden' && aligning);
  L.ghost ||= ghostMaterial(L.U);
  L.ghost.color.set(C.look().edge || '#9aa3ae');
  const shadows = !ghost && C.quality?.() !== 'low';
  L.model.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return;
    o.material = ghost && o.isMesh ? L.ghost : o.userData.real;
    o.castShadow = shadows && o.isMesh; o.receiveShadow = false;
    o.userData.floor = L.F.f.id; o.userData.key = `scan:${L.s.id}`;
    const want = L.s.pick && !ghost;
    o.raycast = want ? cutRaycast(o, L) : () => {};
  });
  coverFurniture(L, L.holder.visible && !ghost);
  C.reshadow();
}
/* Where a scan shows as it is, the plan's own simple furniture under it steps aside (the real sofa is in the photo). */
function coverFurniture(L, on) {
  for (const m of L.hid || []) m.visible = m.userData.scanWas ?? true;
  L.hid = [];
  const a = on && L.model && analysisOf(L); if (!a || a.box.isEmpty()) { C.kick(); return; }
  L.holder.updateMatrix();
  const b = a.box, poly = [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.max.x, b.max.z], [b.min.x, b.max.z]].map(([x, z]) => { const p = new V3(x, 0, z).applyMatrix4(L.holder.matrix); return [p.x, p.z]; });
  const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const inv = new THREE.Matrix4().copy(L.F.G.matrixWorld).invert(), c = new V3();
  for (const [, meshes] of L.F.items || []) for (const m of meshes) {
    if (m.userData.cat !== 'furniture' || !m.visible) continue;
    new THREE.Box3().setFromObject(m).getCenter(c).applyMatrix4(inv);
    if (inside(c.x, c.z)) { m.userData.scanWas = m.visible; m.visible = false; L.hid.push(m); }
  }
  C.kick();
}
/* Taps on the scan land where it shows: not on the cut-away ceiling or lowered walls. */
function cutRaycast(o, L) {
  const base = (o.isPoints ? THREE.Points : THREE.Mesh).prototype.raycast;
  return function (rc, hits) { const n = hits.length; base.call(this, rc, hits); for (let i = hits.length - 1; i >= n; i--) { const y = hits[i].point.y, U = L.U; if (y > U.uCeil.value || (y > U.uLow.value && hits[i].point.x * U.uNear.value.x + hits[i].point.z * U.uNear.value.y > U.uNear.value.z)) hits.splice(i, 1); } };
}
async function loadInto(L) {
  const s = L.s, file = lowWanted() && s.low ? s.low : s.file, want = `${file}`;
  if (L.loading === want || L.loaded === want) return;
  L.loading = want;
  try {
    const { gltfLoader } = await import('./floorplan-import.js');
    const g = await (await gltfLoader(undefined, C.renderer)).loadAsync(`/api/floorplan/scan-files/${encodeURIComponent(file)}`);
    if (L.loading !== want || !L.F.G.parent) { disposeModel(g.scene); return; }   // replaced or the floor went away meanwhile
    if (L.model) { L.holder.remove(L.model); disposeModel(L.model); }
    L.model = g.scene; L.loaded = want; L.loading = null;
    L.analysis = null;
    realMaterials(L.model, L.U);
    L.holder.add(L.model); applyShow(L); C.kick();
  } catch { L.loading = null; C.toast(T('Could not load the scan {name}.', { name: s.name })); }
}
function disposeModel(root) {
  root.traverse((o) => { o.geometry?.dispose(); for (const m of [o.material].flat()) { if (!m) continue; m.map?.dispose(); m.dispose(); } if (o.userData.real) for (const m of [o.userData.real].flat()) { m.map?.dispose(); m.dispose(); } });
}
function analysisOf(L) {
  if (!L.model) return null;
  if (!L.analysis) { const sm = surfaceSample(L.model); L.analysis = { ...floorLevel(sm), yaw: wallYaw(sm), box: sm.box }; }   // in the holder's space: what its place, turn and size apply to
  return L.analysis;
}
/* A floor was (re)built: put its scans on it. Hidden scans aren't downloaded until they're shown. */
export function attach(F) {
  if (!C) return;
  for (const [id, L] of live) if (!L.F.G.parent) live.delete(id);   // the old floors are gone (their scans went with them)
  for (const s of F.f.scans || []) {
    const L = { s, F, holder: holderOf(F, s), U: makeU(), model: null };
    live.set(s.id, L);
    if (s.show !== 'hidden') loadInto(L);
  }
  if (F.f.boxes?.length) addBoxes(F);
}
/* Furniture brought in from Sweet Home 3D: simple boxes, colored like the rest of the furniture. */
function addBoxes(F) {
  const g = new THREE.Group(); g.name = 'imported-furniture'; g.userData.keep = true;
  for (const b of F.f.boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), F.mats.furniture); m.position.set(b.x, (b.elev || 0) + b.h / 2, b.y); m.rotation.y = -(b.rot || 0) * D2R;
    m.castShadow = true; m.receiveShadow = true; m.userData.cat = 'furniture'; m.userData.floor = F.f.id; m.userData.key = `box:${b.name}`; m.name = b.name || 'Furniture'; g.add(m);
  }
  F.inner.add(g);
}
/* Every drawn frame: the cuts follow the camera like the plan's walls do (no new objects made per frame). */
const _c = new V3(), _d = new V3();
export function beforeRender(camera) {
  if (!live.size) return;
  const mode = C.wallsMode?.() || 'auto';
  _d.copy(camera.position).sub(C.controls.target).setY(0); if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1); _d.normalize();
  for (const L of live.values()) {
    if (!L.model || !L.holder.visible || !L.F.G.visible) continue;
    const U = L.U, A = L.cut || (L.cut = cutHeights(L)); if (!A) continue;
    L.holder.updateWorldMatrix(true, false);
    const k = L.holder.matrixWorld.elements[5] || 1, y0 = L.holder.matrixWorld.elements[13];   // the turn is about y, so height is just scaled and moved
    U.uCeil.value = y0 + k * A.ceil;
    U.uLight.value = (C.daylight?.() ?? 1) * (L.F.fx?.uDim?.value ?? 1);
    const floorW = y0 + k * A.floor;
    if (mode === 'tall') { U.uLow.value = 1e6; continue; }
    U.uLow.value = floorW + 1.1;
    if (mode === 'cut') { U.uNear.value.set(0, 0, -1e9); continue; }
    _c.copy(L.F.center);
    U.uNear.value.set(_d.x, _d.z, _c.x * _d.x + _c.z * _d.z + L.F.r * 0.2);
  }
}
function cutHeights(L) {
  const a = analysisOf(L); if (!a) return null;
  return { floor: a.floor, ceil: a.ceiling != null ? a.ceiling - 0.1 : a.floor + Math.max(2.2, Math.min(3, (L.F.f.heightM || 3) - 0.3)) };
}
/* After the look changes (theme, quality). */
export function restyle() { for (const L of live.values()) { applyShow(L); if (L.s.show !== 'hidden' && L.loaded && L.loaded !== (lowWanted() && L.s.low ? L.s.low : L.s.file)) loadInto(L); } }

/* ---------------- the floor's scans in the editor (Floors tab) ---------------- */
const busy = { text: '' };
function status(t) {
  busy.text = t;
  let e = document.getElementById('scanStatus');
  if (!t) { e?.remove(); return; }
  if (!e) { e = C.el('div', { id: 'scanStatus', class: 'toast', role: 'status' }); document.body.append(e); }
  e.textContent = t;
}
function uploadBlob(url, method, blob, onPct) {
  return new Promise((ok, bad) => {
    const x = new XMLHttpRequest(); x.open(method, url); x.setRequestHeader('Content-Type', 'model/gltf-binary');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round(e.loaded / e.total * 100)); };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* not JSON */ } if (x.status >= 200 && x.status < 300) ok(j); else bad(Object.assign(new Error(j.error || `HTTP ${x.status}`), { status: x.status })); };
    x.onerror = () => bad(new Error(T('The upload stopped. Check the connection and try again.')));
    x.send(blob);
  });
}
const mb = (n) => Math.max(1, Math.round(n / 1e6));
/* Bring scan files in, onto floor f; then line it up. */
export async function addScan(f, files) {
  const F = C.S.F[f.id];
  try {
    const p = await prepareScan(files, status);
    const sizes = mb(p.full.size + (p.low?.size || 0));
    const r = await uploadBlob(`/api/floorplan/floors/${encodeURIComponent(f.id)}/scans?name=${encodeURIComponent(p.name || 'Scan')}`, 'POST', p.full, (n) => status(T('Uploading the scan ({mb} MB): {pct}%', { mb: sizes, pct: n })));
    if (p.low) await uploadBlob(`/api/floorplan/floors/${encodeURIComponent(f.id)}/scans/${r.scan.id}/low`, 'PUT', p.low, (n) => status(T('Uploading the lighter copy: {pct}%', { pct: n })));
    /* First guess: its floor on the plan's floor, its walls square with the plan's, in the middle of the floor. */
    const place = F ? autoPlace(F, { pos: [0, 0, 0], rotY: 0, scale: 1 }, { floor: p.auto.floor, yaw: p.auto.yaw, center: p.auto.center }) : null;
    if (place) await C.send(`/api/floorplan/floors/${f.id}/scans/${r.scan.id}`, 'PUT', place);
    status('');
    await C.reload();
    startAlign(f.id, r.scan.id);
    C.toast(T('Scan added. Line it up: tap a corner in the scan, then the same corner on the plan.'));
  } catch (e) { status(''); C.toast(e.status === 402 ? T('Photo-real scans are part of CasaTorch Pro.') : T(e.message || String(e))); }
}
function planYaw(F) {
  const sm = { tris: [], points: [] }, inv = new THREE.Matrix4().copy(F.G.matrixWorld).invert();
  for (const m of F.wallMeshes || []) { if (!m.visible || !m.parent) continue; const one = surfaceSample(m, 4000); const M = new THREE.Matrix4().multiplyMatrices(inv, m.parent.matrixWorld), n3 = new THREE.Matrix3().getNormalMatrix(M); for (const t of one.tris) { const n = new V3(t[3], t[4], t[5]).applyMatrix3(n3).normalize(); sm.tris.push([0, 0, 0, n.x, n.y, n.z, t[6]]); } }
  return sm.tris.length ? wallYaw(sm) : 0;
}
/* Floor on floor, walls square, centered on its room (or the floor). a: the scan's own floor height, wall angle, middle. */
function autoPlace(F, cur, a, room) {
  const k = cur.scale || 1, rotY = squareTurn(a.yaw, planYaw(F));
  const r = room && F.rooms.find((x) => x.name === room), tx = r ? r.pos[0] : F.center.x - F.loadOff[0], tz = r ? r.pos[1] : F.center.z - F.loadOff[1];
  const c = placePoint(a.center, { pos: [0, 0, 0], rotY, scale: k });
  return { pos: [+(tx - c[0]).toFixed(3), +((F.floorY || 0) - k * a.floor).toFixed(3), +(tz - c[2]).toFixed(3)], rotY, scale: k };
}
const SHOW = () => [['real', T('Real')], ['outline', T('Outline')], ['hidden', T('Hidden')]];
export function floorCard(f) {
  const el = C.el, put = (s, body) => C.send(`/api/floorplan/floors/${f.id}/scans/${s.id}`, 'PUT', body).then(() => C.reload()).catch((e) => C.toast(e.message));
  const file = el('input', { type: 'file', multiple: true, accept: '.glb,.gltf,.bin,.usdz,.usd,.usdc,.obj,.mtl,.ply,.zip,.png,.jpg,.jpeg,.webp,model/gltf-binary,application/zip', 'aria-label': T('Add a photo-real scan'), onchange: () => { if (file.files.length) addScan(f, [...file.files]); } });
  const N = window.CasaNative;
  const rows = (f.scans || []).map((s) => el('div', { class: 'scanrow' },
    el('div', { class: 'row' }, el('b', {}, s.name), el('small', { class: 'note' }, s.tris ? T('{n}k triangles', { n: Math.round(s.tris / 1000) }) : T('{n}k points', { n: Math.round((s.points || 0) / 1000) }))),
    el('div', { class: 'row' }, el('label', {}, T('Show as')), el('select', { onchange: (e) => put(s, { show: e.target.value }) }, ...SHOW().map(([v, t]) => el('option', { value: v, selected: (s.show || 'real') === v ? true : null }, t)))),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => startAlign(f.id, s.id) }, T('Line up…')),
      el('label', { class: 'chk', title: T('Taps land on the scan: place devices on its real walls. Off: taps go through it to the plan.') }, el('input', { type: 'checkbox', checked: s.pick ? true : null, onchange: (e) => put(s, { pick: e.target.checked }) }), T('Taps land on it')),
      el('button', { type: 'button', class: 'mini', onclick: async () => { if (!confirm(T('Remove the scan {name}?', { name: s.name }))) return; await C.api(`/api/floorplan/floors/${f.id}/scans/${s.id}`, { method: 'DELETE' }).catch((e) => C.toast(e.message)); await C.reload(); } }, T('Remove')))));
  return el('div', { class: 'scans' }, el('h4', {}, T('Photo-real scans')), ...rows,
    N?.hasMesh ? el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => phoneScan(f) }, T('Photo-real scan with this phone'))) : null,
    el('div', { class: 'row' }, el('label', {}, T('Add one')), file),
    el('p', { class: 'note' }, T('A textured scan from Polycam, Scaniverse, 3D Scanner App or Reality Composer: GLB, USDZ, OBJ with its MTL and pictures, PLY with colors, or a .zip of them.')));
}
async function phoneScan(f) {
  const N = window.CasaNative;
  try {
    const r = await N.scanMesh(); if (!r) return;   // cancelled
    await addScan(f, [new File([r.bytes], `${(r.name || 'Photo-real scan').replace(/[^\w .-]/g, '')}.ply`, { type: 'application/octet-stream' })]);
  } catch (e) { C.toast(e.message || T('The scan didn\'t finish.')); }
}

/* ---------------- lining it up ---------------- */
const marks = [];
function mark(p, color) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.renderOrder = 999; m.position.copy(p); C.scene.add(m); marks.push(m); C.kick(); }
function clearMarks() { for (const m of marks.splice(0)) { C.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } C.kick(); }
export function startAlign(floor, sid) {
  const L = live.get(sid); if (!L) return;
  if (L.s.show === 'hidden' && !L.model) loadInto(L);
  C.S.tool = { type: 'scan-align', floor, sid, step: 0, pts: [], undo: [], scale: false };
  clearMarks(); applyShow(L); C.editor();
}
function endAlign() { const t = C.S.tool; C.S.tool = null; clearMarks(); const L = t && live.get(t.sid); if (L) applyShow(L); C.editor(); }
const placeOf = (s) => ({ pos: [...s.pos], rotY: s.rotY || 0, scale: s.scale || 1 });
let saveT = null;
function setPlace(L, place, save = true) {
  const t = C.S.tool; if (t && save) { t.undo.push(placeOf(L.s)); if (t.undo.length > 20) t.undo.shift(); }
  Object.assign(L.s, place);
  L.holder.position.set(...L.s.pos); L.holder.rotation.y = L.s.rotY * D2R; L.holder.scale.setScalar(L.s.scale); L.holder.updateMatrixWorld(true); applyShow(L);
  clearTimeout(saveT); saveT = setTimeout(() => C.send(`/api/floorplan/floors/${L.F.f.id}/scans/${L.s.id}`, 'PUT', placeOf(L.s)).catch((e) => C.toast(e.message)), 400);
  C.editor();
}
function alignTap(cx, cy) {
  const t = C.S.tool, L = live.get(t.sid); if (!L?.model) { C.toast(T('The scan is still loading.')); return; }
  const r = C.renderer.domElement.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, C.camera);
  const onScan = t.step % 2 === 0;
  let hit;
  if (onScan) {
    const list = []; L.model.traverse((o) => { if (o.isMesh) list.push(o); });
    hit = list.flatMap((o) => { const h = []; THREE.Mesh.prototype.raycast.call(o, ray, h); return h; }).filter((h) => h.point.y <= L.U.uCeil.value).sort((a, b) => a.distance - b.distance)[0];
  } else {
    const targets = [], inScan = (o) => { for (let q = o; q; q = q.parent) if (q.userData?.scan) return true; return false; };
    L.F.G.traverse((o) => { if (o.isMesh && o.visible && !inScan(o)) targets.push(o); });
    hit = ray.intersectObjects(targets, false).filter((h) => h.object.material?.opacity !== 0)[0];
  }
  if (!hit) { C.toast(onScan ? T('Tap on the scan.') : T('Tap on the plan.')); return; }
  mark(hit.point, onScan ? '#f59e0b' : '#38bdf8');
  const p = onScan ? L.model.worldToLocal(hit.point.clone()).applyMatrix4(L.model.matrix) : L.F.G.worldToLocal(hit.point.clone());   // scan: its own space; plan: the floor's
  t.pts.push(p.toArray()); t.step++;
  if (t.step === 4) {
    const [s1, p1, s2, p2] = t.pts, fit = twoPointFit(s1, s2, p1, p2, placeOf(L.s), t.scale);
    if (!fit) C.toast(T('Pick two corners further apart.'));
    else setPlace(L, fit);
    t.step = 0; t.pts = []; setTimeout(clearMarks, 900);
  }
  applyShow(L); C.editor();
}
const STEPS = () => [T('1. Tap a corner in the scan.'), T('2. Tap the same corner on the plan.'), T('3. Tap a second corner in the scan, far from the first.'), T('4. Tap that corner on the plan.')];
export function alignPanel() {
  const el = C.el, t = C.S.tool, L = live.get(t.sid);
  if (!L) { C.S.tool = null; return el('div', {}); }
  const s = L.s, num = (label, v, step, on) => el('div', { class: 'row' }, el('label', {}, label), el('input', { type: 'number', step, value: v, onchange: (e) => { const n = Number(e.target.value); if (Number.isFinite(n)) on(n); } }));
  const nudge = (label, fn) => el('button', { type: 'button', class: 'mini', onclick: () => setPlace(L, fn(placeOf(s))) }, label);
  const P = placeOf(s);
  return el('div', { class: 'hint col scanalign' },
    el('b', {}, T('Line up {name}', { name: s.name })),
    el('p', { class: 'note' }, T('Move slowly around the view to see both. Taps on the scan show orange, on the plan blue.')),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => { const a = analysisOf(L); if (!a) { C.toast(T('The scan is still loading.')); return; } setPlace(L, autoPlace(L.F, P, { floor: a.floor, yaw: a.yaw, center: a.box.getCenter(new V3()).toArray() }, s.room)); C.toast(T('Its floor is on the plan\'s floor and its walls are square with the plan.')); } }, T('Automatic')),
      el('select', { title: T('Center it on this room'), onchange: (e) => C.send(`/api/floorplan/floors/${L.F.f.id}/scans/${s.id}`, 'PUT', { room: e.target.value || null }).then(() => { s.room = e.target.value || undefined; }) },
        el('option', { value: '' }, T('The whole floor')), ...L.F.rooms.map((r) => el('option', { value: r.name, selected: s.room === r.name ? true : null }, r.name)))),
    el('h4', {}, T('Two corners')),
    el('p', { class: 'scanstep', 'aria-live': 'polite' }, STEPS()[t.step]),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: t.scale ? true : null, onchange: (e) => { t.scale = e.target.checked; } }), T('Also fix the size (most scans are already true to size)')),
    el('h4', {}, T('Exact numbers')),
    num(T('Across (m)'), P.pos[0], 0.05, (v) => setPlace(L, { ...P, pos: [v, P.pos[1], P.pos[2]] })),
    num(T('Along (m)'), P.pos[2], 0.05, (v) => setPlace(L, { ...P, pos: [P.pos[0], P.pos[1], v] })),
    num(T('Height (m)'), P.pos[1], 0.01, (v) => setPlace(L, { ...P, pos: [P.pos[0], v, P.pos[2]] })),
    num(T('Turn (°)'), P.rotY, 0.5, (v) => setPlace(L, { ...P, rotY: v })),
    num(T('Size'), P.scale, 0.01, (v) => { if (v > 0) setPlace(L, { ...P, scale: v }); }),
    el('div', { class: 'row' }, nudge('⟲ 90°', (p) => ({ ...p, rotY: p.rotY + 90 })), nudge('⟲ 1°', (p) => ({ ...p, rotY: p.rotY + 1 })), nudge('⟳ 1°', (p) => ({ ...p, rotY: p.rotY - 1 })), nudge('↑ 1 cm', (p) => ({ ...p, pos: [p.pos[0], +(p.pos[1] + 0.01).toFixed(3), p.pos[2]] })), nudge('↓ 1 cm', (p) => ({ ...p, pos: [p.pos[0], +(p.pos[1] - 0.01).toFixed(3), p.pos[2]] }))),
    el('div', { class: 'row' }, el('label', {}, T('Show as')), ...SHOW().map(([v, n]) => el('button', { type: 'button', class: `mini${(s.show || 'real') === v ? ' on' : ''}`, onclick: () => { s.show = v; C.send(`/api/floorplan/floors/${L.F.f.id}/scans/${s.id}`, 'PUT', { show: v }).catch((e) => C.toast(e.message)); if (v !== 'hidden' && !L.model) loadInto(L); applyShow(L); C.editor(); } }, n))),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: endAlign }, T('Done')),
      el('button', { type: 'button', class: 'mini', disabled: t.undo.length ? null : true, onclick: () => { const u = t.undo.pop(); if (u) { setPlace(L, u, false); } } }, T('Undo')),
      t.step ? el('button', { type: 'button', class: 'mini', onclick: () => { t.step = 0; t.pts = []; clearMarks(); applyShow(L); C.editor(); } }, T('Start the taps again')) : null));
}

/* ---------------- floor plans from Sweet Home 3D and DXF: preview, then apply (and undo) ---------------- */
function planSvg(plan) {
  const ns = 'http://www.w3.org/2000/svg', pts = [...plan.walls.flatMap((w) => [w.a, w.b]), ...plan.rooms.flatMap((r) => r.pts)];
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'planprev'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', T('Preview of the imported plan'));
  if (!pts.length) return svg;
  const x0 = Math.min(...pts.map((p) => p[0])) - 0.5, y0 = Math.min(...pts.map((p) => p[1])) - 0.5, w = Math.max(...pts.map((p) => p[0])) - x0 + 0.5, h = Math.max(...pts.map((p) => p[1])) - y0 + 0.5;
  svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
  const add = (tag, a) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); svg.append(e); return e; };
  for (const r of plan.rooms) {
    add('polygon', { points: r.pts.map((q) => q.join(',')).join(' '), class: 'pr' });
    const cx = r.pts.reduce((a, q) => a + q[0], 0) / r.pts.length, cy = r.pts.reduce((a, q) => a + q[1], 0) / r.pts.length, wd = Math.max(...r.pts.map((q) => q[0])) - Math.min(...r.pts.map((q) => q[0]));
    const t = add('text', { x: cx, y: cy, 'font-size': Math.max(0.25, Math.min(0.6, wd / 8)), 'text-anchor': 'middle' }); t.textContent = r.name;
  }
  for (const q of plan.walls) add('line', { x1: q.a[0], y1: q.a[1], x2: q.b[0], y2: q.b[1], class: 'pw', 'stroke-width': q.thick || 0.1 });
  for (const o of plan.openings || []) {
    const r = o.wall != null ? plan.walls[o.wall] && [plan.walls[o.wall].a, plan.walls[o.wall].b] : plan.rooms[o.room] && [plan.rooms[o.room].pts[o.edge], plan.rooms[o.room].pts[(o.edge + 1) % plan.rooms[o.room].pts.length]];
    if (!r) continue;
    const L = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) || 1, ux = (r[1][0] - r[0][0]) / L, uy = (r[1][1] - r[0][1]) / L, m = o.t ?? o.fromEdge ?? 0, h = (o.width || 0.9) / 2;
    add('line', { x1: r[0][0] + ux * (m - h), y1: r[0][1] + uy * (m - h), x2: r[0][0] + ux * (m + h), y2: r[0][1] + uy * (m + h), class: o.kind === 'window' ? 'pwin' : 'pdoor' });
  }
  return svg;
}
export async function importPlan(file) {
  const { readPlanFile } = await import('./floorplan-import.js');
  let units = 'auto', res;
  try { res = await readPlanFile(file); } catch (e) { C.toast(T(e.message)); return; }
  const isDxf = /\.dxf$/i.test(file.name), el = C.el, modal = document.getElementById('modal');
  const close = () => { modal.hidden = true; modal.replaceChildren(); };
  const draw = () => {
    const drawn = C.S.plan.floors.filter((f) => f.kind === 'drawn'), into = el('select', {}, el('option', { value: '' }, T('New floors')), ...(res.floors.length === 1 ? drawn.map((f) => el('option', { value: f.id }, T('Replace the drawing of {name}', { name: f.name }))) : []));
    const count = (f) => T('Rooms: {rooms} · Walls: {walls} · Doors and windows: {doors} · Furniture: {boxes}', { rooms: f.plan.rooms.length, walls: f.plan.walls.length, doors: (f.plan.openings || []).length, boxes: f.boxes.length });
    modal.replaceChildren(el('div', { class: 'box planimport', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('Import a floor plan') },
      el('h2', {}, T('Import {file}', { file: file.name })),
      ...res.floors.map((f) => el('div', { class: 'card' }, el('div', {}, el('b', {}, f.name)), el('small', { class: 'note' }, count(f)), planSvg(f.plan))),
      isDxf ? el('div', { class: 'row' }, el('label', {}, T('Units')), el('select', { onchange: async (e) => { units = e.target.value; try { res = (await import('./floorplan-import.js')).parseDxf(await file.text(), { units }); } catch (er) { C.toast(er.message); } draw(); } },
        ...[['auto', T('From the file ({u})', { u: res.units })], ['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'in'], ['ft', 'ft']].map(([v, n]) => el('option', { value: v, selected: v === units ? true : null }, n)))) : null,
      ...res.notes.map(([n, v]) => el('p', { class: 'note' }, T(n, v))),
      el('div', { class: 'row' }, el('label', {}, T('Put it in')), into),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', onclick: () => applyPlan(res, into.value).then(close) }, T('Apply')), el('button', { type: 'button', onclick: close }, T('Cancel')))));
    modal.hidden = false;
  };
  draw();
}
async function applyPlan(res, intoId) {
  const made = [];
  try {
    for (const [i, f] of res.floors.entries()) {
      let id = intoId && i === 0 ? intoId : null;
      if (!id) { const r = await C.send('/api/floorplan/floors/drawn', 'POST', { name: f.name }); id = r.floor.id; made.push(id); }
      const fl = C.S.plan.floors.find((x) => x.id === id);
      await C.send(`/api/floorplan/floors/${id}/plan`, 'PUT', { ...(fl?.plan || {}), name: f.name, rooms: f.plan.rooms, walls: f.plan.walls, openings: f.plan.openings || [], stairs: [] });
      await C.send(`/api/floorplan/floors/${id}`, 'PUT', { level: f.level, heightM: f.heightM });
      await C.send(`/api/floorplan/floors/${id}/boxes`, 'PUT', { boxes: f.boxes }).catch(() => {});
    }
    await C.reload();
    if (made.length) undoToast(made); else C.toast(T('Plan imported. Undo puts the old drawing back.'));
  } catch (e) { C.toast(e.message); await C.reload().catch(() => {}); }
}
function undoToast(ids) {
  const x = C.el('div', { class: 'toast act' }, T('Plan imported as {n} new floors.', { n: ids.length }), ' ',
    C.el('button', { type: 'button', class: 'mini', onclick: async () => { x.remove(); for (const id of ids) await C.api(`/api/floorplan/floors/${id}`, { method: 'DELETE' }).catch(() => {}); await C.reload(); C.toast(T('Import undone.')); } }, T('Undo')));
  document.body.append(x); setTimeout(() => x.remove(), 15000);
}
