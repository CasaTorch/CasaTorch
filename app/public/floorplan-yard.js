/* The yard around the 3D house: areas you draw (lawn, terrace, path, a driveway that can slope up to the garage,
   flower beds, gravel, a pool with real depth), fences and hedges, and things you place (trees, pines, bushes, cars,
   an EV charger). Trees and cars cast real sun shadows, so the sun on the plan finally knows about the big oak out front.
   A car can be linked to your car's own sensors (Tesla, or any EV Home Assistant knows): it sits in
   the driveway when the car is home, fades out when it's away, and while it charges a glowing cable
   runs from the charger with current flowing into it. Shown only - CasaTorch never controls the car.
   Drawing and editing the ground lives in floorplan-outdoor.js. */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { AREA_KINDS, AREA_ITEM_KIND, LINE_KINDS, slopeFn, poolShell, copingPieces, fencePosts, pointInPoly, polyArea } from './floorplan-outdoor.js';
import { Kit } from './floorplan-furniture.js';
import { RoundedBoxGeometry as RoundedBox } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { batchStatic, unbatch } from './floorplan-batch.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';   // QA: the still parts of the yard merged while only looking
export { AREA_KINDS };

export const ITEM_KINDS = { tree: 'Tree', pine: 'Pine', bush: 'Bush', car: 'Car', charger: 'EV charger' };
const LIFT = { grass: 0.004, gravel: 0.008, garden: 0.012, driveway: 0.008, patio: 0.016, path: 0.02, pool: 0.024 };
const PAINT = { night: 0.5, blueprint: 0.42, day: 1, real: 1 };

/* ---- ground pictures, drawn once in grey and tinted by each area's color (UVs are metres) ---- */
const TEXS = {};
function groundTex(kind) {
  if (TEXS[kind] !== undefined || typeof document === 'undefined') return TEXS[kind] || null;
  const N = 256, c = Object.assign(document.createElement('canvas'), { width: N, height: N }), g = c.getContext('2d'), R = Math.random;
  const noise = (n, lo, hi, w = 2, h = 2) => { for (let i = 0; i < n; i++) { const v = lo + R() * (hi - lo) | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(R() * N, R() * N, 1 + R() * w, 1 + R() * h); } };
  let tile = 1;
  g.fillStyle = '#d4d4d4'; g.fillRect(0, 0, N, N);
  if (kind === 'grass') { tile = 4; g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, N / 2, N); noise(14000, 150, 245, 1.5, 3); }   // mowing stripes, 2 m wide
  else if (kind === 'patio') { tile = 1.2; noise(5000, 175, 235, 3, 3); g.strokeStyle = '#8f8f8f'; g.lineWidth = 3; for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * N / 2, 0); g.lineTo(i * N / 2, N); g.moveTo(0, i * N / 2); g.lineTo(N, i * N / 2); g.stroke(); } }
  else if (kind === 'path') { tile = 0.8; noise(4000, 170, 235); g.strokeStyle = '#8a8a8a'; g.lineWidth = 3; const bh = N / 8; for (let r = 0; r < 8; r++) { g.beginPath(); g.moveTo(0, r * bh); g.lineTo(N, r * bh); g.stroke(); for (let k = 0; k <= 4; k++) { const x = k * N / 4 + (r % 2) * N / 8; g.beginPath(); g.moveTo(x, r * bh); g.lineTo(x, r * bh + bh); g.stroke(); } } }
  else if (kind === 'driveway') { tile = 2; noise(26000, 120, 255, 1.5, 1.5); }
  else if (kind === 'garden') { tile = 1; g.fillStyle = '#a8a8a8'; g.fillRect(0, 0, N, N); noise(9000, 90, 200, 4, 2); }
  else if (kind === 'gravel') { tile = 1; noise(22000, 120, 255, 3, 3); }
  else if (kind === 'tile') { tile = 0.5; g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, N, N); g.strokeStyle = '#b8b8b8'; g.lineWidth = 4; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * N / 4, 0); g.lineTo(i * N / 4, N); g.moveTo(0, i * N / 4); g.lineTo(N, i * N / 4); g.stroke(); } }
  else if (kind === 'hedge') { tile = 1; g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, N, N); for (let i = 0; i < 2600; i++) { const v = 110 + R() * 140 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.ellipse(R() * N, R() * N, 2 + R() * 4, 1 + R() * 3, R() * 3, 0, 6.3); g.fill(); } }
  else if (kind === 'caustic') { tile = 1.6; g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2.2; for (let i = 0; i < 70; i++) { const x = R() * N, y = R() * N, r = 10 + R() * 22; g.beginPath(); for (let a = 0; a <= 6.4; a += 0.7) { const rr = r * (0.75 + R() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.stroke(); } }
  else { TEXS[kind] = null; return null; }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tile, 1 / tile); t.colorSpace = kind === 'caustic' ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 2;
  return (TEXS[kind] = t);
}
/* Box-like shapes get UVs in metres, so a long hedge or fence isn't one stretched picture. */
function metreUV(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]; uv[i * 2] = u; uv[i * 2 + 1] = v; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo;
}
/* Seeing into a pool without cutting a hole in the ground: its inside (walls, floor, water) is drawn first, then its
   opening is drawn into the depth buffer only - so the lawn and the ground drawn after it stay out of the opening,
   while anything standing in front of the pool still covers it. */
const PUNCH = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });   // always nearer than the lawn's own offset
/* A little seeded random, so a flower bed looks the same every time it's built. */
const seeded = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };

/* ---- shared, cached geometry (one tree shape for every tree) ---- */
const G = {};
const geo = (k, make) => (G[k] ||= make());
const _tm = new THREE.Matrix4();
function carBody(suv) {
  const s = new THREE.Shape(), h = suv ? 1.12 : 1;
  const p = suv ? [[-2.35, .32], [2.35, .32], [2.42, .82], [1.75, .95], [1.0, 1.62], [-2.05, 1.66], [-2.38, 1.2], [-2.42, .9]]
    : [[-2.35, .3], [2.35, .3], [2.42, .74], [1.6, .86], [.72, 1.4 * h], [-.9, 1.42 * h], [-1.9, .96], [-2.4, .86]];
  s.moveTo(...p[0]); for (const q of p.slice(1)) s.lineTo(...q); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.76, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 2 }); g.translate(0, 0, -.88); return g;
}
function carGlass(suv) {
  const s = new THREE.Shape(), p = suv ? [[1.62, .98], [.98, 1.56], [-1.95, 1.6], [-2.24, 1.2], [-2.2, .98]] : [[1.45, .9], [.7, 1.36], [-.86, 1.38], [-1.76, .98]];
  s.moveTo(...p[0]); for (const q of p.slice(1)) s.lineTo(...q); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.84, bevelEnabled: false }); g.translate(0, 0, -.92); return g;
}

function makeTree(kind, mats) {
  const g = new THREE.Group();
  if (kind === 'pine') {
    const trunk = new THREE.Mesh(geo('ptrunk', () => new THREE.CylinderGeometry(.12, .16, 1.2, 7).translate(0, .6, 0)), mats.bark); g.add(trunk);
    [[1.5, 1.5, 1.1], [1.15, 1.35, 2.0], [.8, 1.2, 2.8]].forEach(([r, h, y], i) => g.add(new THREE.Mesh(geo(`cone${i}`, () => new THREE.ConeGeometry(r, h, 8).translate(0, y, 0)), mats.pine)));
  } else if (kind === 'bush') {
    g.add(new THREE.Mesh(geo('bush', () => new THREE.IcosahedronGeometry(.6, 1).scale(1, .72, 1).translate(0, .4, 0)), mats.leaf));
  } else {
    g.add(new THREE.Mesh(geo('trunk', () => new THREE.CylinderGeometry(.14, .2, 2.2, 7).translate(0, 1.1, 0)), mats.bark));
    [[0, 3.0, 0, 1.35], [.75, 2.6, .3, 1.0], [-.65, 2.7, -.35, 1.05], [.1, 2.5, -.8, .9]].forEach(([x, y, z, r], i) => g.add(new THREE.Mesh(geo(`can${i}`, () => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z)), mats.leaf)));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
function makeCar(it, mats) {
  const g = new THREE.Group(), suv = it.body === 'suv';
  const paint = new THREE.MeshStandardMaterial({ color: it.color || '#cfd6df', roughness: .35, metalness: .4, transparent: true });
  const body = new THREE.Mesh(geo(suv ? 'suvBody' : 'carBody', () => carBody(suv)), paint);
  const glass = new THREE.Mesh(geo(suv ? 'suvGlass' : 'carGlass', () => carGlass(suv)), mats.glass.clone()), tire = mats.tire.clone();
  g.add(body, glass);
  /* QA: the four wheels are one shape (one draw instead of four) */
  g.add(new THREE.Mesh(geo('wheels4', () => mergeGeometries([[1.45, .86], [1.45, -.86], [-1.45, .86], [-1.45, -.86]].map(([x, z]) => new THREE.CylinderGeometry(.34, .34, .24, 16).rotateX(Math.PI / 2).translate(x, .34, z)))), tire));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.paint = paint; g.userData.port = new THREE.Vector3(-2.2, .82, .95);   // rear left, where most EVs (Tesla included) plug in
  return g;
}
function makeCharger(mats) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(geo('cpost', () => new THREE.BoxGeometry(.12, 1.1, .12).translate(0, .55, 0)), mats.tire);
  const box = new THREE.Mesh(geo('cbox', () => new THREE.BoxGeometry(.32, .42, .14).translate(0, 1.15, 0)), mats.charger);
  g.add(post, box); g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.plug = new THREE.Vector3(0, 1.05, .1);
  return g;
}

export class Yard {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); this.group.name = 'yard'; scene.add(this.group); this.cars = []; this.labels = []; this.trees = []; this.y = 0; }
  clear() {
    for (const l of this.labels) { l.parent?.remove(l); l.element.remove(); }
    this.labels = []; this.cars = []; this.trees = []; this.charger = null;   // a yard without a charger draws no cable to the old one
    /* Free each build's own shapes and materials; the tree and car shapes are shared by every build and stay. */
    const shared = new Set(Object.values(G)), mats = new Set(Object.values(this.mats || {}));   // (the pool opening's material is shared too: kept)
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((x) => { if ((x.isMesh || x.isLine) && !shared.has(x.geometry)) x.geometry.dispose(); if (x.isInstancedMesh) x.dispose(); if (x.material) mats.add(x.material); }); }
    for (const m of mats) if (m !== PUNCH) m.dispose();
    this.mats = null; this.pools = [];
  }
  /* yard: { areas: [{ kind, pts: [[x, z]...] }], items: [{ id, kind, pos: [x, z], rot, scale, ... }] }; y: ground height (world) */
  build(yard, y, theme, el) {
    this.clear(); this.y = y;
    const k = PAINT[theme] ?? .6, tint = (hex) => new THREE.Color(hex).multiplyScalar(k);
    const mats = {
      bark: new THREE.MeshStandardMaterial({ color: tint('#6b4a32'), roughness: .95 }), leaf: new THREE.MeshStandardMaterial({ color: tint('#3f7f3a'), roughness: .9, flatShading: true }),
      pine: new THREE.MeshStandardMaterial({ color: tint('#2f5d3a'), roughness: .9, flatShading: true }), glass: new THREE.MeshStandardMaterial({ color: '#0d1420', roughness: .15, metalness: .6, transparent: true }),
      tire: new THREE.MeshStandardMaterial({ color: '#16181c', roughness: .8, transparent: true }), charger: new THREE.MeshStandardMaterial({ color: '#e8ecf2', roughness: .4, emissive: '#38bdf8', emissiveIntensity: .25 }),
    };
    this.mats = mats;
    /* QA: one material per kind of ground, edge, fence or flower, shared by every area of that kind (the merge in batch() then makes one draw of them all) */
    const cache = new Map(); this.shared = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
    this.pools = []; const low = !!this.lowQuality?.();   // an old tablet: plain colors on big ground areas, fewer flowers
    for (const a of yard?.areas || []) {
      if (!AREA_KINDS[a.kind] || (a.pts || []).length < 3) continue;
      const tag = { itemId: a.id, kind: AREA_ITEM_KIND[a.kind], yardArea: a.id }, base = y + (LIFT[a.kind] || .01);
      if (a.kind === 'pool') { this.group.add(this.pool(a, base, tint, theme, tag)); continue; }
      const s = new THREE.Shape(a.pts.map(([x, z]) => new THREE.Vector2(x, -z))), geo = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), up = slopeFn(a.pts, a.rise || 0);
      if (a.rise) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, up(p.getX(i), p.getZ(i))); geo.computeVertexNormals(); }
      const m = new THREE.Mesh(geo, this.shared(`area:${a.kind}`, () => new THREE.MeshStandardMaterial({ color: tint(AREA_KINDS[a.kind][1]), map: low ? null : groundTex(a.kind), roughness: a.kind === 'patio' ? .8 : .95, polygonOffset: true, polygonOffsetFactor: -1 })));
      m.position.y = base; m.receiveShadow = true; m.userData = { ...tag }; this.group.add(m);
      if (a.rise) {   // the raised edge of a sloped driveway, so it doesn't float
        const pos = []; a.pts.forEach((p, i) => { const q = a.pts[(i + 1) % a.pts.length], hp = up(p[0], p[1]), hq = up(q[0], q[1]); if (hp < 0.02 && hq < 0.02) return; pos.push(p[0], 0, p[1], q[0], 0, q[1], q[0], hq, q[1], p[0], 0, p[1], q[0], hq, q[1], p[0], hp, p[1]); });
        if (pos.length) { const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.computeVertexNormals(); const sk = new THREE.Mesh(sg, this.shared('skirt', () => new THREE.MeshStandardMaterial({ color: tint('#8b8f96'), roughness: .9, side: THREE.DoubleSide }))); sk.position.y = base - 0.002; sk.receiveShadow = true; sk.castShadow = true; sk.userData = { ...tag }; this.group.add(sk); }
      }
      if (a.kind === 'garden') this.flowers(a, base, tint, low);
      if (theme !== 'day') { const e = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(a.pts.map(([x, z]) => new THREE.Vector3(x, up(x, z), z))), this.shared(`edge:${a.kind}`, () => new THREE.LineBasicMaterial({ color: tint(AREA_KINDS[a.kind][1]).multiplyScalar(2.2), transparent: true, opacity: .6 }))); e.position.y = m.position.y + .005; e.raycast = () => {}; this.group.add(e); }
    }
    for (const ln of yard?.lines || []) {
      if (!LINE_KINDS[ln.kind] || (ln.pts || []).length < 2) continue;
      const o = ln.kind === 'hedge' ? this.hedge(ln, tint) : this.fence(ln, tint);
      o.position.y = y; o.userData = { itemId: ln.id, kind: ln.kind, yardLine: ln.id }; this.group.add(o);
    }
    for (const it of yard?.items || []) {
      if (!ITEM_KINDS[it.kind]) continue;
      let o = it.kind === 'car' ? makeCar(it, mats) : it.kind === 'charger' ? makeCharger(mats) : makeTree(it.kind, mats);
      if (!['car', 'charger'].includes(it.kind)) { const inner = o; o = new THREE.Group(); o.add(inner); this.trees.push({ o, inner, kind: it.kind, ph: Math.random() * 6.283, ph2: Math.random() * 6.283, f: 0.55 + Math.random() * 0.35, leaves: inner.children.slice(1) }); }
      o.position.set(it.pos[0], y, it.pos[1]); o.rotation.y = THREE.MathUtils.degToRad(it.rot || 0); if (it.kind !== 'car' && it.kind !== 'charger') o.scale.setScalar(it.scale || 1);
      o.userData.yard = { item: it.id }; this.group.add(o); o.updateMatrixWorld(true);
      if (it.kind === 'car') {
        const lab = new CSS2DObject(el('div', { class: 'carlab' })); lab.position.set(0, 2.1, 0); o.add(lab); this.labels.push(lab);
        this.cars.push({ it, o, lab });
      }
      if (it.kind === 'charger') this.charger = o;
    }
    this.instTrees();
    return this;
  }
  /* QA: every tree, pine and bush is drawn as instances - one draw per shape (trunk, each canopy ball, each cone) for the
     whole yard instead of four or five per tree. The tree groups stay (hidden) for picking and for the wind, which
     turns them as before; syncTrees() copies their pose into the instances. */
  instTrees() {
    this.treeInst = [];
    if (this.trees.length < 2) return;
    const by = new Map();
    for (const tr of this.trees) tr.inner.traverse((m) => { if (!m.isMesh) return; const k = `${m.geometry.uuid}|${m.material.uuid}`; if (!by.has(k)) by.set(k, { geo: m.geometry, mat: m.material, parts: [] }); by.get(k).parts.push({ tr, m }); });
    for (const b of by.values()) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.parts.length); im.castShadow = true; im.receiveShadow = true; im.raycast = () => {}; im.userData.treeInst = true; im.name = 'trees';
      this.group.add(im); this.treeInst.push({ im, parts: b.parts });
    }
    for (const tr of this.trees) { tr.inner.visible = false; tr.inner.updateMatrix(); for (const m of tr.leaves) m.updateMatrix(); }
    this.syncTrees();
    for (const { im } of this.treeInst) im.computeBoundingSphere();
  }
  syncTrees() {
    if (!this.treeInst?.length) return;
    for (const { im, parts } of this.treeInst) { parts.forEach(({ tr, m }, i) => { _tm.multiplyMatrices(tr.o.matrix, tr.inner.matrix).multiply(m.matrix); im.setMatrixAt(i, _tm); }); im.instanceMatrix.needsUpdate = true; }
  }
  /* QA: while only looking, merge the still parts (ground, edges, flower beds, fences, hedges) - see floorplan-batch.js. */
  batch(on) {
    if (!on) return unbatch(this.group);
    return batchStatic(this.group, (o) => !o.userData.yard && o.userData.depth == null && !o.userData.treeInst);
  }
  /* A pool you can look into: tiled walls and floor down to its depth, water a little below the stone edge. */
  pool(a, base, tint, theme, tag) {
    const g = new THREE.Group(), sh = poolShell(a.pts, a.depth ?? 1.4), d = sh.depth, shape = new THREE.Shape(a.pts.map(([x, z]) => new THREE.Vector2(x, -z))), flat = () => new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    g.position.y = base; g.userData = { ...tag, depth: d };
    const punch = new THREE.Mesh(flat(), PUNCH); punch.renderOrder = -5; punch.position.y = 0.002; punch.userData = { ...tag }; g.add(punch);
    const pos = [], nrm = [], uv = []; let u0 = 0;
    for (const w of sh.walls) {
      const [x1, z1] = w.a, [x2, z2] = w.b, n = [w.n[0], 0, w.n[1]], u1 = u0 + w.len;
      if (sh.ccw) { pos.push(x1, 0, z1, x2, -d, z2, x2, 0, z2, x1, 0, z1, x1, -d, z1, x2, -d, z2); uv.push(u0, 0, u1, -d, u1, 0, u0, 0, u0, -d, u1, -d); }   // wound to face the water
      else { pos.push(x1, 0, z1, x2, 0, z2, x2, -d, z2, x1, 0, z1, x2, -d, z2, x1, -d, z1); uv.push(u0, 0, u1, 0, u1, -d, u0, 0, u1, -d, u0, -d); }
      for (let i = 0; i < 6; i++) nrm.push(...n); u0 = u1;
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const tile = new THREE.MeshStandardMaterial({ color: tint('#9ad8e8'), map: groundTex('tile'), roughness: .35 });
    const walls = new THREE.Mesh(wg, tile); walls.renderOrder = -7; walls.receiveShadow = true; walls.raycast = () => {}; g.add(walls);
    const floorMat = tile.clone(); floorMat.color = tint('#63c3df'); if (this.high) { floorMat.emissiveMap = groundTex('caustic'); floorMat.emissive = new THREE.Color('#d8f6ff'); floorMat.emissiveIntensity = 0.4; }   // the shimmer: best quality only
    const fl = new THREE.Mesh(flat(), floorMat); fl.position.y = -d; fl.renderOrder = -7; fl.receiveShadow = true; fl.raycast = () => {}; g.add(fl);
    /* blended, but drawn with the solid things (custom blending keeps it out of the see-through pass, which comes too late) */
    const water = new THREE.Mesh(flat(), new THREE.MeshStandardMaterial({ color: tint('#3ab4dd'), opacity: .55, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, roughness: .04, metalness: .15, depthWrite: false, emissive: '#0e7490', emissiveIntensity: theme === 'day' || theme === 'real' ? .1 : .45 }));
    water.position.y = sh.waterY; water.renderOrder = -6; water.raycast = () => {}; g.add(water);
    const k = new Kit(null), stone = new THREE.MeshStandardMaterial({ color: tint('#e6e0d6'), map: groundTex('patio'), roughness: .8 });
    for (const c of copingPieces(a.pts, .3)) { const b = new THREE.BoxGeometry(c.len, .05, c.width); b.rotateY(-c.ang); b.translate(c.cx, .025, c.cz); k.put(metreUV(b), stone); }
    const cop = k.group(); cop.traverse((o) => { o.userData = { ...tag }; }); g.add(cop);
    this.pools.push(floorMat);
    return g;
  }
  /* Flowers and low plants scattered over a bed (the same every time). */
  flowers(a, base, tint, low) {
    const rnd = seeded(a.id || a.pts.join()), xs = a.pts.map((p) => p[0]), zs = a.pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const n = Math.max(3, Math.min(low ? 50 : 160, Math.round(polyArea(a.pts) * (low ? 2 : 6)))), spots = [];
    for (let t = 0; spots.length < n && t < n * 8; t++) { const p = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)]; if (pointInPoly(p, a.pts)) spots.push(p); }
    if (!spots.length) return;
    /* merged into one shape per color (no instancing: fewer shader variants for an old tablet to compile) */
    const k = new Kit(null), leaf = this.shared('fleaf', () => new THREE.MeshStandardMaterial({ color: tint('#3f7f3a'), roughness: .9 })), cols = low ? ['#f472b6', '#fde047'] : ['#e11d48', '#f59e0b', '#a855f7', '#f472b6', '#fde047', '#ffffff'], bloom = cols.map((c) => this.shared(`bloom:${c}`, () => new THREE.MeshStandardMaterial({ color: tint(c), roughness: .7 })));
    for (const [x, z] of spots) {
      const s = 0.7 + rnd() * 0.6, a = rnd() * 6.28, l = new THREE.IcosahedronGeometry(0.16, 0); l.scale(s, s * 0.8, s); l.rotateY(a); k.put(l, leaf, x, base + 0.1 * s, z, { flat: true });
      const b = new THREE.IcosahedronGeometry(0.06 * s, 0); k.put(b, bloom[(rnd() * cols.length) | 0], x + (rnd() - 0.5) * 0.08, base + 0.2 * s, z + (rnd() - 0.5) * 0.08, { flat: true });
    }
    const g = k.group(); g.traverse((o) => { o.raycast = () => {}; }); this.group.add(g);
  }
  /* A board fence: posts at the corners and every ~1.8 m, horizontal boards with small gaps, a top rail. */
  fence(ln, tint) {
    const h = Math.max(0.3, Math.min(3, ln.h || 1.2)), k = new Kit(null), wood = this.shared(`fence:${ln.color || ''}`, () => new THREE.MeshStandardMaterial({ color: tint(ln.color || LINE_KINDS.fence[1]), map: groundTex('garden'), roughness: .85 })), post = this.shared('post', () => new THREE.MeshStandardMaterial({ color: tint('#5b4636'), roughness: .8 }));
    const put = (g, m, x, yy, z, ang = 0) => { g.rotateY(-ang); g.translate(x, yy, z); k.put(metreUV(g), m); };
    for (const [x, z] of fencePosts(ln.pts, 1.8)) put(new THREE.BoxGeometry(0.09, h + 0.06, 0.09), post, x, (h + 0.06) / 2, z);
    for (let i = 0; i < ln.pts.length - 1; i++) {
      const [x1, z1] = ln.pts[i], [x2, z2] = ln.pts[i + 1], len = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1), mx = (x1 + x2) / 2, mz = (z1 + z2) / 2; if (len < 0.05) continue;
      const n = Math.max(2, Math.round((h - 0.1) / 0.15));
      for (let j = 0; j < n; j++) put(new THREE.BoxGeometry(len, 0.11, 0.022), wood, mx, 0.1 + j * (h - 0.2) / (n - 1) + 0.055, mz, ang);
      put(new THREE.BoxGeometry(len + 0.08, 0.04, 0.08), post, mx, h + 0.02, mz, ang);
    }
    return k.group();
  }
  /* A clipped hedge: one rounded block per side, overlapping at the corners. */
  hedge(ln, tint) {
    const h = Math.max(0.3, Math.min(3, ln.h || 1.4)), k = new Kit(null), leaf = this.shared(`hedge:${ln.color || ''}`, () => new THREE.MeshStandardMaterial({ color: tint(ln.color || LINE_KINDS.hedge[1]), map: groundTex('hedge'), roughness: .95 }));
    for (let i = 0; i < ln.pts.length - 1; i++) {
      const [x1, z1] = ln.pts[i], [x2, z2] = ln.pts[i + 1], len = Math.hypot(x2 - x1, z2 - z1); if (len < 0.05) continue;
      const g = new RoundedBox(len + 0.55, h, 0.7); g.rotateY(-Math.atan2(z2 - z1, x2 - x1)); g.translate((x1 + x2) / 2, h / 2, (z1 + z2) / 2); k.put(metreUV(g), leaf);
    }
    return k.group();
  }
  /* The light dancing on a pool's floor - only on the best picture quality. Returns true while it moves. */
  shimmer(t) {
    if (!this.pools?.length || !this.high || !this.group.visible) return false;
    const c = TEXS.caustic; if (!c) return false;
    c.offset.set(Math.sin(t * 0.17) * 0.35 + t * 0.012, Math.cos(t * 0.13) * 0.3); return true;
  }
  /* Wind: every tree leans with the real wind and sways, harder in gusts; pines are stiffer, bushes barely move.
     windMs: metres per second; toward: the direction the wind blows TO, as a world-space unit vector. */
  wind(t, windMs, toward) {
    if (!this.trees.length) return;
    const w = Math.max(0, Math.min(30, windMs || 0)), base = Math.min(0.16, w * 0.0085), gust = 0.65 + 0.35 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.3);
    for (const tr of this.trees) {
      const stiff = tr.kind === 'pine' ? 0.55 : tr.kind === 'bush' ? 0.35 : 1, a = base * stiff;
      const sway = a * (0.55 + 0.45 * gust) + a * 0.35 * Math.sin(t * tr.f * (1 + w / 12) + tr.ph) + a * 0.12 * Math.sin(t * tr.f * 2.7 + tr.ph2);
      const ang = Math.atan2(toward.x, toward.z) - tr.o.rotation.y;   // the wind in this tree's own frame
      tr.inner.rotation.x = sway * Math.cos(ang); tr.inner.rotation.z = -sway * Math.sin(ang); tr.inner.updateMatrix();
      const flutter = Math.min(0.06, w * 0.004);   // leaves shiver on top of the lean
      tr.leaves.forEach((m, i) => { m.rotation.x = flutter * Math.sin(t * (3.1 + i) + tr.ph + i); m.rotation.z = flutter * Math.sin(t * (2.6 + i * 0.7) + tr.ph2); m.updateMatrix(); });
    }
    this.syncTrees();
  }
  /* QA: worth animating? Only with a real breeze; below 2 m/s the sway is under a degree and not worth a frame. */
  swaying(windMs) { return this.trees.length > 0 && (windMs || 0) >= 2; }
  get box() { return new THREE.Box3().setFromObject(this.group); }
  set visible(v) { this.group.visible = v; for (const l of this.labels) l.visible = v; }
  /* Live car states -> how each car looks; returns power lines for the charging cables (drawn by PowerNet). */
  live(states, el, fmtW) {
    const lines = [];
    for (const c of this.cars) {
      const s = states?.[c.it.id] || {}, away = s.home === false, charging = !away && (s.powerW ?? 0) > 50, plugged = !away && (s.plugged || charging);
      c.o.traverse((x) => { if (x.isMesh) { x.material.opacity = away ? .14 : 1; x.material.depthWrite = !away; x.castShadow = !away; } });
      const bits = [s.battery != null ? `${Math.round(s.battery)}%` : null, away ? 'Away' : charging ? `Charging ${fmtW(s.powerW)}` : plugged ? 'Plugged in' : null].filter(Boolean);
      c.lab.element.replaceChildren(...[el('b', {}, c.it.name || 'Car'), bits.length ? el('small', {}, bits.join(' · ')) : null].filter(Boolean));
      c.lab.element.className = `carlab${charging ? ' charging' : ''}${away ? ' away' : ''}`;
      if (plugged && this.charger) {
        const a = this.charger.localToWorld(this.charger.userData.plug.clone()), b = c.o.localToWorld(c.o.userData.port.clone()), gy = this.y + .03;
        lines.push({ on: charging, watts: s.powerW || 0, color: charging ? '#34d399' : null, pts: [a, new THREE.Vector3(a.x, gy, a.z), new THREE.Vector3(b.x, gy, b.z), b] });
      }
    }
    return lines;
  }
}
