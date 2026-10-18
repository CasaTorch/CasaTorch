/* Furniture and household things for the 3D home - our own simple models, built in code from boxes, rounded boxes
   and cylinders (no model files, nothing copied). Each piece is a handful of parts merged into one shape per material,
   so a whole furnished house stays a few hundred draw calls even on an old wall tablet.
   Sizes are real-world metres: w (side to side), d (front to back), h (height). The front of every piece faces +z.
   Some parts move: a plant's 'leaf' (droops when thirsty), a mailbox 'flag', an awning's 'cover' (follows the
   cover's position), a strip light's 'strip'. Built groups carry userData { itemId, kind }. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* The catalogue: kind -> [name, group, [w, d, h], resizable]. Names are run through T() where shown. */
export const FURN = {
  sofa: ['Sofa', 'living', [2.1, 0.92, 0.84], true], armchair: ['Armchair', 'living', [0.86, 0.86, 0.82]], coffeetable: ['Coffee table', 'living', [1.1, 0.6, 0.42], true],
  tvstand: ['TV stand', 'living', [1.6, 0.42, 0.48], true], tv: ['TV', 'living', [1.24, 0.08, 0.78], true], rug: ['Rug', 'living', [2.0, 1.4, 0.02], true],
  lamp: ['Floor lamp', 'living', [0.4, 0.4, 1.6]], pot: ['Plant pot', 'living', [0.46, 0.46, 1.1], true], shelves: ['Shelves', 'living', [0.9, 0.35, 1.8], true],
  bed2: ['Double bed', 'bedroom', [1.66, 2.12, 1.0], true], bed1: ['Single bed', 'bedroom', [1.0, 2.06, 0.9], true], nightstand: ['Nightstand', 'bedroom', [0.48, 0.4, 0.55]],
  wardrobe: ['Wardrobe', 'bedroom', [1.2, 0.6, 2.1], true],
  dtable: ['Dining table', 'dining', [1.6, 0.9, 0.75], true], chair: ['Chair', 'dining', [0.46, 0.52, 0.88]],
  desk: ['Desk', 'office', [1.4, 0.7, 0.75], true], ochair: ['Office chair', 'office', [0.64, 0.64, 1.05]],
  counter: ['Kitchen counter', 'kitchen', [2.4, 0.62, 0.9], true], island: ['Kitchen island', 'kitchen', [1.8, 0.9, 0.9], true], fridge: ['Fridge', 'kitchen', [0.7, 0.68, 1.85]],
  oven: ['Oven and cooktop', 'kitchen', [0.6, 0.62, 0.9]], sink: ['Sink', 'kitchen', [0.8, 0.62, 0.9]], dishwasher: ['Dishwasher', 'kitchen', [0.6, 0.6, 0.85]],
  washer: ['Washer', 'laundry', [0.6, 0.6, 0.85]], dryer: ['Dryer', 'laundry', [0.6, 0.6, 0.85]],
  toilet: ['Toilet', 'bath', [0.38, 0.68, 0.78]], bath: ['Bathtub', 'bath', [0.76, 1.7, 0.58], true], shower: ['Shower', 'bath', [0.9, 0.9, 2.0], true],
  led: ['Strip light', 'light', [2.0, 0.03, 0.02], true],
  bin: ['Bin', 'outside', [0.58, 0.74, 1.07]], mailbox: ['Mailbox', 'outside', [0.26, 0.5, 1.22]], planter: ['Garden pot', 'outside', [0.6, 0.6, 1.2], true],
  awning: ['Awning', 'outside', [3.0, 2.5, 0.3], true],
};
export const FURN_GROUPS = [['living', 'Living room'], ['bedroom', 'Bedroom'], ['dining', 'Dining'], ['kitchen', 'Kitchen'], ['bath', 'Bathroom'], ['office', 'Office'], ['laundry', 'Laundry'], ['light', 'Lights']];
export const AWNINGS = [['arm', 'Folding-arm'], ['drop', 'Drop-arm'], ['zip', 'Vertical screen'], ['pergola', 'Pergola']];
/* Default bin colors per kind of waste (a bin linked to your household bins takes that bin's own color). */
export const BIN_COLORS = { trash: '#4b5563', recycling: '#2563eb', organics: '#92400e', paper: '#0891b2', glass: '#16a34a', yard: '#65a30d' };
export const sizeOf = (it) => { const d = FURN[it.kind]?.[2] || [1, 1, 1]; return [it.w || d[0], it.d || d[1], it.h || d[2]]; };

/* ---- materials: one shared set per look; a few per piece (its own color, or something that glows) ---- */
const PAL = {
  wood: ['#b48a5e', 0.72], woodDark: ['#5f4634', 0.7], woodLight: ['#d8c1a0', 0.7], fabric: ['#7b8794', 0.96], cushion: ['#8a96a3', 0.97], accent: ['#c9824f', 0.95],
  linen: ['#f2eee8', 0.9], white: ['#f2f2ef', 0.38], front: ['#e9e6e0', 0.45], steel: ['#bfc5cc', 0.32, 0.45], steelDark: ['#7d848c', 0.4, 0.4], chrome: ['#e4e8ec', 0.18, 0.55],
  black: ['#1c1f24', 0.5], glass: ['#12161c', 0.08, 0.3], screen: ['#0b0d12', 0.06, 0.2], ceramic: ['#fbfbf9', 0.18], stone: ['#d7d3cc', 0.42], rubber: ['#202226', 0.9],
  terracotta: ['#b8653d', 0.85], soil: ['#4a3526', 1], leaf: ['#4d8a43', 0.85], leafDark: ['#3a6b34', 0.85], rugEdge: ['#5b6470', 1], gray: ['#9aa2ab', 0.6],
  book0: ['#b45454', 0.8], book1: ['#3f6aa1', 0.8], book2: ['#d4a64a', 0.8], book3: ['#4d7f6a', 0.8], alu: ['#cfd3d8', 0.3, 0.5], awning: ['#d9cfbf', 0.95], post: ['#3b3f45', 0.55],
};
const PAINT = { night: 0.5, blueprint: 0.42, day: 1, real: 1 };
let woodTex = null;
function grainTex() {   // a soft wood grain, drawn once
  if (woodTex || typeof document === 'undefined') return woodTex;
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = c.getContext('2d');
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 46; i++) { const y = Math.random() * 128, v = 170 + Math.random() * 70 | 0; g.strokeStyle = `rgba(${v},${v},${v},0.55)`; g.lineWidth = 0.6 + Math.random() * 1.8; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + Math.sin(x / 19 + i) * 1.6); g.stroke(); }
  woodTex = new THREE.CanvasTexture(c); woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping; woodTex.repeat.set(2, 2); woodTex.colorSpace = THREE.SRGBColorSpace;
  return woodTex;
}
export class Palette {
  constructor(theme) { this.k = PAINT[theme] ?? 0.6; this.m = {}; this.own = []; }
  tint(hex) { return new THREE.Color(hex).multiplyScalar(this.k); }
  get(key) {
    if (this.m[key]) return this.m[key];
    const [c, r, met] = PAL[key] || PAL.gray, wood = /^wood/.test(key);
    const o = { color: this.tint(c), roughness: r, metalness: met || 0 };
    if (wood) o.map = grainTex();
    if (key === 'glass') Object.assign(o, { transparent: true, opacity: 0.35, depthWrite: false });
    return (this.m[key] = new THREE.MeshStandardMaterial(o));
  }
  /* A material only this piece uses (its own color, or one that glows). */
  mine(key, color, extra = {}) { const base = this.get(key), m = base.clone(); if (color) m.color.copy(this.tint(color)); Object.assign(m, extra); this.own.push(m); return m; }
  dispose() { for (const m of [...Object.values(this.m), ...this.own]) m.dispose(); this.m = {}; this.own = []; }
}

/* ---- the kit: parts collected per material, merged into one mesh each ---- */
const KEEP = new Set(['position', 'normal', 'uv']);
function clean(g, flat) {
  let n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (!KEEP.has(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  if (flat) n.computeVertexNormals();
  n.morphAttributes = {}; n.clearGroups();
  return n;
}
export class Kit {
  constructor(P) { this.P = P; this.by = new Map(); }
  mat(m) { return typeof m === 'string' ? this.P.get(m) : m; }
  put(g, m, x = 0, y = 0, z = 0, { rx = 0, ry = 0, rz = 0, flat = false } = {}) {
    if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z);
    const mm = this.mat(m); if (!this.by.has(mm)) this.by.set(mm, []); this.by.get(mm).push(clean(g, flat)); return this;
  }
  /* a box standing on y (its bottom), centered on x/z; r rounds its edges */
  box(m, w, h, d, x = 0, y = 0, z = 0, r = 0, o = {}) {
    const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    const g = rr > 0.003 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d);
    if (o.rx || o.rz || o.ry) { if (o.rx) g.rotateX(o.rx); if (o.rz) g.rotateZ(o.rz); if (o.ry) g.rotateY(o.ry); }
    g.translate(x, y + h / 2, z); return this.put(g, m);
  }
  cyl(m, rt, rb, h, x = 0, y = 0, z = 0, seg = 18, o = {}) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!o.open, o.t0 || 0, o.tl || Math.PI * 2); g.translate(0, h / 2, 0); if (o.sx || o.sz) g.scale(o.sx || 1, 1, o.sz || 1); return this.put(g, m, x, y, z, o); }
  /* merge into a group (one mesh per material) */
  group(shadow = true) {
    const g = new THREE.Group();
    for (const [m, list] of this.by) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false); if (list.length > 1) list.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(geo, m); mesh.castShadow = shadow && !m.transparent; mesh.receiveShadow = true; g.add(mesh);
    }
    this.by = new Map(); return g;
  }
}

/* ---- little icons for bins (drawn on a canvas, our own) ---- */
const ICONS = {};
export function binIcon(kind) {
  if (ICONS[kind] || typeof document === 'undefined') return ICONS[kind] || null;
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  const P = (d) => g.stroke(new Path2D(d));
  if (kind === 'recycling') { for (let i = 0; i < 3; i++) { g.save(); g.translate(64, 68); g.rotate(i * 2.094); P('M -30 22 L 0 -30 L 22 8'); P('M 10 2 L 22 8 L 26 -6'); g.restore(); } }
  else if (kind === 'organics' || kind === 'yard') { P('M 30 100 C 30 50 60 26 102 24 C 102 70 78 98 30 100 Z'); P('M 30 100 L 74 54'); if (kind === 'yard') P('M 52 78 L 52 60 M 62 68 L 78 68'); }
  else if (kind === 'paper') { P('M 36 22 H 80 L 96 38 V 106 H 36 Z'); P('M 50 56 H 82 M 50 72 H 82 M 50 88 H 72'); }
  else if (kind === 'glass') { P('M 54 18 H 74 V 40 C 90 48 92 58 92 70 V 108 H 36 V 70 C 36 58 38 48 54 40 Z'); }
  else { P('M 32 36 H 96 M 54 36 V 26 H 74 V 36 M 40 36 L 46 106 H 82 L 88 36'); P('M 58 52 V 92 M 70 52 V 92'); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (ICONS[kind] = t);
}
const STRIPES = {};
function stripeTex(color) {   // classic awning cloth: cream with colored stripes
  const key = color || 'default'; if (STRIPES[key] || typeof document === 'undefined') return STRIPES[key] || null;
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 8 }), g = c.getContext('2d');
  g.fillStyle = '#efe8dc'; g.fillRect(0, 0, 64, 8); g.fillStyle = color || '#2f6f8f'; g.fillRect(0, 0, 16, 8); g.fillRect(32, 0, 16, 8);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return (STRIPES[key] = t);
}
let haloT = null;
function haloTex() {   // a soft round glow for the ground under something that wants attention
  if (haloT || typeof document === 'undefined') return haloT;
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); haloT = new THREE.CanvasTexture(c); return haloT;
}
let washT = null;
function washTex() {   // the soft light a strip throws on the wall: bright at the strip, fading out
  if (washT || typeof document === 'undefined') return washT;
  const c = Object.assign(document.createElement('canvas'), { width: 8, height: 64 }), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 64); washT = new THREE.CanvasTexture(c); return washT;
}
export function halo(size, color) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: haloTex(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.position.y = 0.03; m.renderOrder = 4; m.raycast = () => {}; m.visible = false; m.name = 'halo'; return m;
}

/* ---- the models ---- */
const legs4 = (k, m, w, d, h, inset, r = 0.022) => { for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.cyl(m, r, r * 0.8, h, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), 10); };
const BUILD = {
  sofa(k, [w, d, h], it, P, seats) {
    const fab = it.color ? P.mine('fabric', it.color) : 'fabric', cush = it.color ? P.mine('cushion', new THREE.Color(it.color).lerp(new THREE.Color('#ffffff'), 0.12).getStyle()) : 'cushion';
    legs4(k, 'woodDark', w, d, 0.09, 0.1);
    k.box(fab, w, 0.2, d, 0, 0.08, 0, 0.03);
    for (const s of [-1, 1]) k.box(fab, 0.2, h * 0.68 - 0.08, d, s * (w / 2 - 0.1), 0.08, 0, 0.06);
    k.box(fab, w - 0.04, h - 0.08, 0.22, 0, 0.08, -d / 2 + 0.11, 0.06);
    const n = seats || (w > 1.75 ? 3 : w > 1.1 ? 2 : 1), cw = (w - 0.4) / n;
    for (let i = 0; i < n; i++) { const x = -w / 2 + 0.2 + cw * (i + 0.5); k.box(cush, cw - 0.012, 0.16, d - 0.3, x, 0.28, 0.07, 0.05); k.box(cush, cw - 0.03, 0.4, 0.17, x, 0.42, -d / 2 + 0.3, 0.07, { rx: -0.14 }); }
    if (n > 1) k.box('accent', 0.36, 0.34, 0.11, -w / 2 + 0.42, 0.46, -d / 2 + 0.44, 0.05, { rx: -0.3, ry: 0.35 });
  },
  armchair(k, s, it, P) { BUILD.sofa(k, s, it, P, 1); },
  coffeetable(k, [w, d, h]) { k.box('wood', w, 0.04, d, 0, h - 0.04, 0, 0.015); k.box('wood', w - 0.12, 0.02, d - 0.12, 0, 0.12, 0); for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.box('woodDark', 0.04, h - 0.04, 0.04, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)); },
  tvstand(k, [w, d, h]) {
    legs4(k, 'black', w, d, 0.08, 0.06, 0.015); k.box('wood', w, h - 0.08, d, 0, 0.08, 0, 0.01);
    const n = Math.max(1, Math.round(w / 0.55)); for (let i = 0; i < n; i++) k.box('woodLight', w / n - 0.01, h - 0.12, 0.012, -w / 2 + w / n * (i + 0.5), 0.1, d / 2 + 0.004, 0.003);
  },
  tv(k, [w, d, h], it, P) {
    k.box('black', w, h, Math.max(0.03, d * 0.45), 0, 0.06, 0, 0.008);
    const scr = P.mine('screen', null, { emissive: new THREE.Color('#5a7bb5'), emissiveIntensity: 0 }); k.box(scr, w - 0.03, h - 0.03, 0.006, 0, 0.075, Math.max(0.03, d * 0.45) / 2 + 0.002);
    k.box('black', 0.3, 0.012, 0.2, 0, 0, 0); k.box('black', 0.06, 0.08, 0.03, 0, 0.005, -0.01);
    k.glow = scr;
  },
  rug(k, [w, d], it, P) { k.box('rugEdge', w, 0.01, d, 0, 0, 0, 0.004); k.box(P.mine('linen', it.color || '#cdbfa8', { roughness: 1 }), w - 0.16, 0.012, d - 0.16, 0, 0, 0, 0.004); },
  lamp(k, [w, , h], it, P) {
    k.cyl('black', 0.16, 0.17, 0.03, 0, 0, 0, 24); k.cyl('chrome', 0.012, 0.012, h - 0.3, 0, 0.03, 0, 8);
    const shade = P.mine('linen', '#f3e7cf', { side: THREE.DoubleSide, emissive: new THREE.Color('#ffcf85'), emissiveIntensity: 0.05 });
    k.cyl(shade, w * 0.38, w * 0.5, 0.32, 0, h - 0.34, 0, 28, { open: true }); k.glow = shade;
  },
  pot(k, [w, , h], it, P, outdoor) {
    const pot = it.color ? P.mine('terracotta', it.color) : outdoor ? 'gray' : 'terracotta', ph = Math.min(0.42, h * 0.36);
    k.cyl(pot, w * 0.45, w * 0.33, ph, 0, 0, 0, 22); k.cyl(pot, w * 0.48, w * 0.48, 0.04, 0, ph - 0.04, 0, 22); k.cyl('soil', w * 0.43, w * 0.43, 0.012, 0, ph - 0.03, 0, 18);
    k.plant = { y: ph - 0.02, size: Math.max(0.3, h - ph), r: w * 0.5 };
  },
  planter(k, s, it, P) { BUILD.pot(k, s, it, P, true); },
  shelves(k, [w, d, h]) {
    for (const s of [-1, 1]) k.box('wood', 0.025, h, d, s * (w / 2 - 0.0125), 0, 0);
    k.box('woodDark', w - 0.05, h - 0.02, 0.008, 0, 0.01, -d / 2 + 0.004);
    const n = Math.max(2, Math.round(h / 0.36)), gap = (h - 0.02) / n;
    for (let i = 0; i <= n; i++) k.box('wood', w - 0.05, 0.022, d - 0.01, 0, Math.min(h - 0.022, i * gap), 0);
    for (let i = 0; i < n; i++) { let x = -w / 2 + 0.05; for (let j = 0; x < w / 2 - 0.12 && j < 14; j++) { const bw = 0.025 + ((i * 7 + j * 3) % 5) * 0.008, bh = gap * (0.55 + ((i + j * 5) % 4) * 0.09); if ((i + j) % 6 === 5) { x += 0.08; continue; } k.box(`book${(i + j) % 4}`, bw, bh, d * 0.72, x + bw / 2, i * gap + 0.022, 0.01); x += bw + 0.004; } }
  },
  bed2(k, [w, d, h], it, P) {
    const duvet = P.mine('linen', it.color || '#9db3c8', { roughness: 0.95 });
    legs4(k, 'woodDark', w, d, 0.06, 0.08, 0.025);
    k.box('wood', w, 0.25, d, 0, 0.05, 0, 0.02); k.box('linen', w - 0.06, 0.2, d - 0.08, 0, 0.29, 0.02, 0.06);
    k.box(duvet, w - 0.02, 0.07, d * 0.62, 0, 0.45, d / 2 - d * 0.31 - 0.01, 0.03); k.box(duvet, w - 0.02, 0.08, 0.22, 0, 0.46, d / 2 - d * 0.62 - 0.08, 0.035);
    const n = w > 1.25 ? 2 : 1, pw = (w - 0.2) / n; for (let i = 0; i < n; i++) k.box('linen', pw - 0.06, 0.12, 0.36, -w / 2 + 0.1 + pw * (i + 0.5), 0.48, -d / 2 + 0.32, 0.055);
    k.box('fabric', w + 0.04, h, 0.08, 0, 0, -d / 2 - 0.02, 0.03);
  },
  bed1(k, s, it, P) { BUILD.bed2(k, s, it, P); },
  nightstand(k, [w, d, h], it, P) {
    legs4(k, 'woodDark', w, d, 0.06, 0.04, 0.015); k.box('wood', w, h - 0.06, d, 0, 0.06, 0, 0.01);
    for (let i = 0; i < 2; i++) { const fh = (h - 0.1) / 2 - 0.012, y = 0.08 + i * (fh + 0.014); k.box('woodLight', w - 0.04, fh, 0.012, 0, y, d / 2 + 0.003, 0.003); k.cyl('chrome', 0.012, 0.012, 0.02, 0, y + fh / 2, d / 2 + 0.012, 10, { rx: Math.PI / 2 }); }
    k.cyl('ceramic', 0.06, 0.07, 0.16, w * 0.18, h, -d * 0.1, 16); const shade = P.mine('linen', '#f3e7cf', { side: THREE.DoubleSide, emissive: new THREE.Color('#ffcf85'), emissiveIntensity: 0.05 }); k.cyl(shade, 0.09, 0.12, 0.14, w * 0.18, h + 0.16, -d * 0.1, 20, { open: true });
  },
  wardrobe(k, [w, d, h], it, P) {
    const front = it.color ? P.mine('front', it.color) : 'front';
    k.box('woodDark', w - 0.04, 0.06, d - 0.04, 0, 0, -0.01); k.box('white', w, h - 0.06, d - 0.02, 0, 0.06, -0.01, 0.006);
    const n = w > 1.6 ? 3 : w > 0.7 ? 2 : 1, dw = w / n;
    for (let i = 0; i < n; i++) { const x = -w / 2 + dw * (i + 0.5); k.box(front, dw - 0.008, h - 0.08, 0.02, x, 0.07, d / 2 - 0.01, 0.004); k.box('chrome', 0.014, 0.28, 0.022, x + (i % 2 ? -1 : 1) * (dw / 2 - 0.06), h * 0.48, d / 2 + 0.012, 0.004); }
  },
  dtable(k, [w, d, h]) {
    k.box('wood', w, 0.045, d, 0, h - 0.045, 0, 0.012);
    for (const s of [-1, 1]) { k.box('wood', w - 0.2, 0.08, 0.025, 0, h - 0.12, s * (d / 2 - 0.08)); k.box('wood', 0.025, 0.08, d - 0.2, s * (w / 2 - 0.08), h - 0.12, 0); }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.box('wood', 0.07, h - 0.045, 0.07, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 0.01);
  },
  chair(k, [w, d, h], it, P) {
    const pad = it.color ? P.mine('fabric', it.color) : 'cushion';
    for (const [sx, sz] of [[1, 1], [-1, 1]]) k.box('wood', 0.035, 0.43, 0.035, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.05));
    for (const sx of [1, -1]) k.box('wood', 0.035, h, 0.035, sx * (w / 2 - 0.03), 0, -d / 2 + 0.05, 0, { rx: 0.04 });
    k.box('wood', w, 0.045, d - 0.04, 0, 0.43, 0.01, 0.01); k.box(pad, w - 0.05, 0.035, d - 0.1, 0, 0.47, 0.03, 0.015);
    k.box('wood', w - 0.02, 0.2, 0.025, 0, h - 0.26, -d / 2 + 0.06, 0.008, { rx: 0.06 });
  },
  desk(k, [w, d, h]) {
    k.box('wood', w, 0.035, d, 0, h - 0.035, 0, 0.01);
    for (const s of [-1, 1]) k.box('white', 0.03, h - 0.035, d - 0.04, s * (w / 2 - 0.03), 0, 0);
    k.box('white', w - 0.1, 0.34, 0.016, 0, h - 0.4, -d / 2 + 0.06);
    k.box('black', 0.22, 0.012, 0.16, 0, h, -d / 2 + 0.2, 0.004); k.box('black', 0.04, 0.26, 0.03, 0, h, -d / 2 + 0.17); k.box('screen', Math.min(0.62, w * 0.45), 0.36, 0.025, 0, h + 0.12, -d / 2 + 0.2, 0.006);
    k.box('gray', 0.42, 0.015, 0.13, 0, h, 0.08, 0.004); k.box('gray', 0.06, 0.02, 0.1, 0.32, h, 0.1, 0.008);
  },
  ochair(k, [w, d, h], it, P) {
    const fab = it.color ? P.mine('fabric', it.color) : 'black';
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5, g = new THREE.BoxGeometry(w * 0.46, 0.035, 0.05); g.translate(w * 0.23, 0.06, 0); g.rotateY(a); k.put(g, 'black'); const c = new THREE.SphereGeometry(0.03, 10, 8); c.translate(Math.cos(a) * w * 0.44, 0.03, -Math.sin(a) * w * 0.44); k.put(c, 'rubber'); }
    k.cyl('chrome', 0.025, 0.025, 0.32, 0, 0.07, 0, 12); k.box(fab, w * 0.8, 0.08, d * 0.78, 0, 0.42, 0.02, 0.04);
    k.box(fab, w * 0.72, h - 0.55, 0.07, 0, 0.55, -d * 0.36, 0.035, { rx: -0.1 });
    for (const s of [-1, 1]) { k.box('black', 0.03, 0.18, 0.03, s * w * 0.38, 0.48, 0); k.box('black', 0.05, 0.03, d * 0.4, s * w * 0.38, 0.66, 0, 0.012); }
  },
  counter(k, [w, d, h], it, P, sink) {
    const front = it.color ? P.mine('front', it.color) : 'front';
    k.box('woodDark', w - 0.04, 0.1, d - 0.08, 0, 0, -0.04); k.box('white', w, h - 0.14, d - 0.04, 0, 0.1, -0.02);
    k.box('stone', w + 0.01, 0.04, d + 0.01, 0, h - 0.04, 0, 0.005);
    const n = Math.max(1, Math.round(w / 0.6)), dw = w / n;
    for (let i = 0; i < n; i++) { const x = -w / 2 + dw * (i + 0.5); k.box(front, dw - 0.006, h - 0.16, 0.02, x, 0.11, d / 2 - 0.03, 0.004); k.box('chrome', Math.min(0.16, dw * 0.4), 0.012, 0.02, x, h - 0.13, d / 2 - 0.01, 0.004); }
    if (sink) { k.box('steel', 0.56, 0.006, 0.42, 0, h, 0.02, 0.01); k.box('steelDark', 0.48, 0.007, 0.34, 0, h, 0.02, 0.01); k.cyl('chrome', 0.018, 0.022, 0.3, 0, h, -d / 2 + 0.1, 12); k.cyl('chrome', 0.012, 0.012, 0.18, 0, h + 0.29, -d / 2 + 0.1, 10, { rx: Math.PI / 2 }); k.box('chrome', 0.02, 0.07, 0.02, 0.07, h, -d / 2 + 0.1); }
  },
  sink(k, s, it, P) { BUILD.counter(k, s, it, P, true); },
  island(k, [w, d, h], it, P) {
    const front = it.color ? P.mine('front', it.color) : 'front', cd = d - 0.3;
    k.box('woodDark', w - 0.06, 0.1, cd - 0.06, 0, 0, -0.15); k.box('white', w, h - 0.14, cd, 0, 0.1, -0.15);
    k.box('stone', w + 0.06, 0.04, d, 0, h - 0.04, 0, 0.006);
    const n = Math.max(1, Math.round(w / 0.6)), dw = w / n;
    for (let i = 0; i < n; i++) { const x = -w / 2 + dw * (i + 0.5); k.box(front, dw - 0.006, h - 0.16, 0.02, x, 0.11, -d / 2 - 0.006, 0.004); k.box('chrome', Math.min(0.16, dw * 0.4), 0.012, 0.02, x, h - 0.13, -d / 2 - 0.02, 0.004); }
  },
  fridge(k, [w, d, h]) {
    k.box('steel', w, h, d, 0, 0, 0, 0.02); k.box('black', w - 0.01, 0.006, 0.004, 0, h * 0.62, d / 2 + 0.001);
    k.box('chrome', 0.022, 0.36, 0.035, w / 2 - 0.08, h * 0.66, d / 2 + 0.02, 0.008); k.box('chrome', 0.022, 0.5, 0.035, w / 2 - 0.08, h * 0.3, d / 2 + 0.02, 0.008); k.box('black', w - 0.06, 0.06, 0.006, 0, 0.02, d / 2 + 0.002);
  },
  oven(k, [w, d, h]) {
    k.box('steel', w, h - 0.015, d, 0, 0, 0, 0.008); k.box('glass', w - 0.14, 0.34, 0.01, 0, 0.2, d / 2 + 0.004, 0.006); k.box('screen', w - 0.16, 0.32, 0.006, 0, 0.21, d / 2 + 0.001);
    k.box('chrome', w - 0.12, 0.022, 0.03, 0, 0.6, d / 2 + 0.025, 0.008); k.box('black', w, 0.08, 0.02, 0, h - 0.11, d / 2 + 0.002);
    for (let i = 0; i < 4; i++) k.cyl('chrome', 0.014, 0.014, 0.02, -w / 2 + 0.12 + i * (w - 0.24) / 3, h - 0.08, d / 2 + 0.012, 10, { rx: Math.PI / 2 });
    k.box('glass', w - 0.02, 0.012, d - 0.02, 0, h - 0.015, 0, 0.004); k.box('screen', w - 0.04, 0.008, d - 0.04, 0, h - 0.014, 0);
    for (const [x, z, r] of [[-0.14, 0.13, 0.08], [0.14, 0.13, 0.06], [-0.14, -0.13, 0.06], [0.14, -0.13, 0.08]]) { const t = new THREE.TorusGeometry(r, 0.005, 6, 28); t.rotateX(Math.PI / 2); k.put(t, 'steelDark', x * w / 0.6, h, z * d / 0.62); }
  },
  dishwasher(k, [w, d, h]) { k.box('steel', w, h, d, 0, 0, 0, 0.012); k.box('black', w, 0.09, 0.012, 0, h - 0.1, d / 2 + 0.002); k.box('chrome', w - 0.16, 0.02, 0.03, 0, h - 0.17, d / 2 + 0.02, 0.008); },
  washer(k, [w, d, h], it, P, dryer) {
    k.box('white', w, h, d, 0, 0, 0, 0.025); k.box(dryer ? 'gray' : 'front', w - 0.04, 0.1, 0.01, 0, h - 0.13, d / 2 + 0.001, 0.004); k.box('screen', 0.14, 0.045, 0.012, w * 0.12, h - 0.1, d / 2 + 0.002);
    k.cyl('chrome', 0.03, 0.03, 0.02, -w * 0.3, h - 0.08, d / 2 + 0.01, 16, { rx: Math.PI / 2 });
    const ring = new THREE.TorusGeometry(Math.min(w, h) * 0.3, 0.026, 10, 36); k.put(ring, dryer ? 'white' : 'chrome', 0, h * 0.46, d / 2 + 0.012);
    k.cyl(dryer ? 'steelDark' : 'glass', Math.min(w, h) * 0.28, Math.min(w, h) * 0.28, 0.02, 0, h * 0.46, d / 2 + 0.001, 30, { rx: Math.PI / 2 });
  },
  dryer(k, s, it, P) { BUILD.washer(k, s, it, P, true); },
  toilet(k, [w, d, h]) {
    k.cyl('ceramic', 0.13, 0.11, 0.36, 0, 0, 0.08, 20, { sz: 1.35 }); k.cyl('ceramic', w * 0.5, w * 0.4, 0.08, 0, 0.32, 0.1, 24, { sz: 1.28 });
    k.cyl('white', w * 0.5, w * 0.5, 0.025, 0, 0.4, 0.1, 24, { sz: 1.28 });
    k.box('ceramic', w * 0.95, 0.38, 0.17, 0, h - 0.38, -d / 2 + 0.1, 0.03); k.cyl('chrome', 0.025, 0.025, 0.012, 0, h, -d / 2 + 0.1, 14);
  },
  bath(k, [w, d, h]) {
    const t = 0.07; k.box('ceramic', w, 0.12, d, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) { k.box('ceramic', t, h - 0.12, d, s * (w / 2 - t / 2), 0.12, 0, 0.02); k.box('ceramic', w, h - 0.12, t, 0, 0.12, s * (d / 2 - t / 2), 0.02); }
    k.box('stone', w - 2 * t, 0.01, d - 2 * t, 0, 0.12, 0); k.cyl('chrome', 0.016, 0.016, 0.16, 0, h, -d / 2 + 0.05, 10); k.cyl('chrome', 0.012, 0.012, 0.12, 0, h + 0.15, -d / 2 + 0.11, 10, { rx: Math.PI / 2 });
  },
  shower(k, [w, d, h], it, P) {
    k.box('ceramic', w, 0.06, d, 0, 0, 0, 0.015); k.cyl('chrome', 0.03, 0.03, 0.004, 0, 0.06, 0, 14);
    const glass = P.mine('glass', '#c9e2ec', { opacity: 0.22 });
    k.box(glass, w * 0.62, h - 0.06, 0.01, w * 0.19, 0.06, d / 2 - 0.01); k.box(glass, 0.01, h - 0.06, d, w / 2 - 0.01, 0.06, 0);
    k.box('chrome', w, 0.02, 0.02, 0, h - 0.02, d / 2 - 0.01); k.box('chrome', 0.02, 0.02, d, w / 2 - 0.01, h - 0.02, 0);
    k.cyl('chrome', 0.012, 0.012, h - 0.25, -w / 2 + 0.12, 0.2, -d / 2 + 0.05, 10); k.cyl('chrome', 0.1, 0.1, 0.015, -w / 2 + 0.25, h - 0.06, -d / 2 + 0.2, 24); k.box('chrome', 0.02, 0.02, 0.18, -w / 2 + 0.12, h - 0.05, -d / 2 + 0.12);
  },
  bin(k, [w, d, h], it, P) {
    const col = it.color || BIN_COLORS[it.icon] || BIN_COLORS.trash, body = P.mine('front', col, { roughness: 0.55, emissive: new THREE.Color(col), emissiveIntensity: 0 });
    const lid = P.mine('front', new THREE.Color(col).multiplyScalar(0.78).getStyle(), { roughness: 0.5, emissive: new THREE.Color(col), emissiveIntensity: 0 });
    const g = new THREE.CylinderGeometry(0.5, 0.42, 1, 4, 1); g.rotateY(Math.PI / 4); const s = (w / 2) / 0.3536; g.scale(s, h - 0.13, (d / 2) / 0.3536 * 0.92); g.translate(0, 0.07 + (h - 0.13) / 2, 0.01);
    k.put(g, body, 0, 0, 0, { flat: true });
    k.box(lid, w + 0.04, 0.05, d + 0.05, 0, h - 0.06, 0.012, 0.015);
    k.cyl('rubber', 0.016, 0.016, w - 0.08, 0, h - 0.13, -d / 2 - 0.035, 10, { rz: Math.PI / 2 });
    for (const sx of [-1, 1]) k.cyl('rubber', 0.1, 0.1, 0.06, sx * (w / 2 - 0.02), 0.1, -d / 2 + 0.08, 18, { rz: Math.PI / 2 });
    const tex = binIcon(it.icon || 'trash');
    if (tex) { const em = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); P.own.push(em.material); em.position.set(0, h * 0.62, d / 2 * 0.92 - 0.02 + 0.01); em.rotation.x = -0.04; em.name = 'emblem'; k.extra = [em]; }
    k.glow = [body, lid];
  },
  mailbox(k, [w, d, h], it, P) {
    k.box('post', 0.08, h - 0.22, 0.08, 0, 0, -0.04);
    const body = P.mine('steel', it.color || '#3d4f63', { roughness: 0.45, metalness: 0.25, emissive: new THREE.Color('#fbbf24'), emissiveIntensity: 0 });
    k.box(body, w, 0.14, d, 0, h - 0.26, 0); k.cyl(body, w / 2, w / 2, d, 0, h - 0.12, -d / 2, 20, { t0: Math.PI / 2, tl: Math.PI, rx: Math.PI / 2 });
    k.box('black', w * 0.8, 0.012, 0.006, 0, h - 0.2, d / 2 + 0.001);
    k.glow = [body];
  },
  led(k, [w], it, P) {
    k.box('alu', w, 0.016, 0.02, 0, -0.008, -0.01);
    const strip = P.mine('white', '#fff6e0', { emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0.15, roughness: 0.3 });
    k.box(strip, w - 0.01, 0.006, 0.012, 0, -0.013, -0.004); k.glow = strip;
  },
};

/* The parts that move, kept apart from the merged body. */
function plantLeaves(P, it, spec) {
  const g = new THREE.Group(); g.name = 'leaf'; g.position.y = spec.y;
  const leaf = P.mine('leaf', it.leafColor || null), stem = 'leafDark', k = new Kit(P), n = 11, s = spec.size;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996, up = 0.35 + (i % 4) * 0.13, len = s * (0.42 + (i % 3) * 0.1), tilt = 0.35 + (i % 4) * 0.22;
    const e = new THREE.SphereGeometry(1, 8, 6); e.scale(len * 0.16, 0.012 + len * 0.02, len * 0.36); e.translate(0, 0, len * 0.36); e.rotateX(-tilt); e.translate(0, s * up, 0); e.rotateY(a); k.put(e, leaf, 0, 0, 0, { flat: true });
    const st = new THREE.CylinderGeometry(0.006, 0.008, s * up + 0.02, 5); st.translate(0, (s * up) / 2, 0); st.rotateZ(Math.sin(a) * 0.12); st.rotateX(Math.cos(a) * 0.12); k.put(st, stem);
  }
  g.add(k.group()); g.userData.mat = leaf; return g;
}
function awningParts(P, it, [w, d], style) {
    let stripes = stripeTex(it.color); if (stripes) { stripes = stripes.clone(); stripes.repeat.set(Math.max(1, Math.round(w / 0.5)), 1); stripes.needsUpdate = true; P.own.push(stripes); }   // a stripe pair every ~50 cm
  const g = new THREE.Group(), k = new Kit(P), fab = P.mine('awning', stripes ? '#ffffff' : it.color || null, { side: THREE.DoubleSide, map: stripes }), cover = new THREE.Group(); cover.name = 'cover';
  const ck = new Kit(P);
  if (style === 'pergola') {
    const h = Math.max(2.1, it.h || 2.5);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, 0], [-1, 0]]) k.box('post', 0.1, h, 0.1, sx * (w / 2 - 0.05), 0, sz ? d - 0.05 : 0.05);
    for (const s of [-1, 1]) k.box('post', 0.08, 0.16, d, s * (w / 2 - 0.05), h - 0.16, d / 2);
    k.box('post', w, 0.16, 0.08, 0, h - 0.16, 0.04); k.box('post', w, 0.16, 0.08, 0, h - 0.16, d - 0.04);
    ck.box(fab, w - 0.2, 0.01, 1, 0, 0, 0.5); for (let i = 0; i <= 6; i++) ck.box('alu', w - 0.2, 0.02, 0.03, 0, -0.012, i / 6);
    cover.position.set(0, h - 0.04, 0.08); cover.userData.axis = 'z'; cover.userData.len = d - 0.16;
  } else if (style === 'zip') {
    k.box('alu', w + 0.06, 0.13, 0.13, 0, -0.13, 0.065, 0.02); for (const s of [-1, 1]) k.box('alu', 0.04, 2.0, 0.05, s * (w / 2 + 0.01), -2.13, 0.06);
    const scr = P.mine('glass', '#2d3138', { opacity: 0.82, side: THREE.DoubleSide }); ck.box(scr, w, 1, 0.006, 0, -1, 0); cover.position.set(0, -0.13, 0.06); cover.userData.axis = 'y'; cover.userData.len = 2.0;
  } else if (style === 'drop') {
    k.box('alu', w + 0.06, 0.13, 0.13, 0, -0.13, 0.065, 0.02);
    ck.box(fab, w, 1, 0.006, 0, -1, 0); ck.box('alu', w, 0.03, 0.03, 0, -1.02, 0); for (const s of [-1, 1]) ck.box('alu', 0.025, 1, 0.025, s * (w / 2 - 0.02), -1, 0);
    cover.position.set(0, -0.13, 0.08); cover.userData.axis = 'drop'; cover.userData.len = Math.min(1.4, d);
  } else {   // folding arm: a cassette on the wall, fabric that runs out on two arms
    k.box('alu', w + 0.04, 0.16, 0.2, 0, -0.16, 0.1, 0.03);
    ck.box(fab, w - 0.02, 0.008, 1, 0, 0, 0.5); ck.box('alu', w - 0.02, 0.06, 0.06, 0, -0.03, 1); ck.box(fab, w - 0.02, 0.2, 0.006, 0, -0.2, 1.03);
    for (const s of [-1, 1]) ck.box('alu', 0.04, 0.04, 1, s * (w / 2 - 0.25), -0.12, 0.5, 0.01, { rx: 0.1 });
    cover.position.set(0, -0.1, 0.2); cover.userData.axis = 'z'; cover.userData.len = d; cover.rotation.x = 0.26;
  }
  g.add(k.group()); cover.add(ck.group()); g.add(cover);
  return g;
}
/* How far an awning is out: 0 in, 1 all the way out. */
export function setAwning(o, f) {
  const c = o.getObjectByName('cover'); if (!c) return;
  const e = Math.max(0.02, Math.min(1, f)), L = c.userData.len || 1;
  if (c.userData.axis === 'y') c.scale.set(1, e * L, 1);
  else if (c.userData.axis === 'drop') { c.scale.set(1, L, 1); c.rotation.x = -e * 1.15; }
  else c.scale.set(1, 1, e * L);
  c.visible = f > 0.01 || c.userData.axis === 'drop';
}

/* Build one piece. Returns a Group (front +z, standing on y = 0) with userData { itemId, kind, glow, leaf... }. */
export function buildFurniture(it, P) {
  const k = new Kit(P), size = sizeOf(it), root = new THREE.Group();
  if (it.kind === 'awning') root.add(awningParts(P, it, size, it.style || 'arm'));
  else { const b = BUILD[it.kind]; if (!b) return null; b(k, size, it, P); root.add(k.group(!['rug', 'led'].includes(it.kind))); }
  for (const e of k.extra || []) root.add(e);
  if (k.plant) { const lf = plantLeaves(P, it, k.plant); root.add(lf); root.userData.leaf = lf; }
  if (it.kind === 'led') {
    const tex = washTex(), m = new THREE.Mesh(new THREE.PlaneGeometry(size[0] + 0.3, 0.6), new THREE.MeshBasicMaterial({ map: tex, color: '#ffd9a0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(0, -0.02, -0.03); m.raycast = () => {}; m.name = 'strip'; m.renderOrder = 4; P.own.push(m.material); root.add(m); root.userData.wash = m;
  }
  if (['bin', 'mailbox', 'washer', 'dryer'].includes(it.kind)) { const hl = halo(Math.max(size[0], size[1]) * 2.6, it.kind === 'mailbox' ? '#fbbf24' : '#ffd27a'); P.own.push(hl.material); root.add(hl); root.userData.halo = hl; }
  if (it.kind === 'mailbox') {
    const f = new THREE.Group(); f.name = 'flag'; f.position.set(size[0] / 2 + 0.012, size[2] - 0.2, 0.05);
    const fk = new Kit(P); fk.box(P.mine('front', '#dc2626'), 0.012, 0.03, 0.2, 0, -0.015, -0.1); fk.box(P.mine('front', '#dc2626'), 0.012, 0.1, 0.07, 0, -0.015, -0.2); f.add(fk.group());
    root.add(f); root.userData.flag = f;
  }
  root.userData.itemId = it.id; root.userData.kind = it.kind; root.userData.glow = [k.glow].flat().filter(Boolean);
  if (it.kind === 'awning') setAwning(root, it.style === 'pergola' ? 1 : 0.85);
  return root;
}
