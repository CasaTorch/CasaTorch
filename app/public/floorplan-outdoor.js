/* Outdoor and furniture for the 3D home: the Outdoor and Furniture tabs of the editor, and the household things that
   show what's going on (bins with a "Tonight" tag, a mailbox that glows when the post came, plants that droop when
   they're thirsty, a washer that says "23 min").
   - Ground surfaces (lawn, terrace, path, driveway with a slope, flower bed, gravel, a pool with real depth) are drawn
     as a rectangle or a free shape: tap the corners, tap the first corner again (or press Enter) to close, then drag
     the corners to adjust. Fences and hedges are lines with a height. These live in plan.yard (floorplan-yard.js draws them).
   - Things you place - furniture, bins, a mailbox, plant pots, awnings, strip lights - live in plan.items:
     [{ id, kind, floor (a floor's id, or null for outside), pos: [x, z], y (height above the floor), rot, w, d, h,
        color, style, grp (moved together), binId / plantId / laundryId / mail, coverId / deviceId, tilt }].
     Each built piece carries userData { itemId, kind } so the live view can light it up or move it.
   Our own models (floorplan-furniture.js), no model files. Shown only: nothing here controls a device. */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FURN, FURN_GROUPS, AWNINGS, BIN_COLORS, Palette, buildFurniture, setAwning, sizeOf } from './floorplan-furniture.js';
import { batchStatic, unbatch } from './floorplan-batch.js';   // QA: still furniture merged per floor while only looking

const T = (s, v) => (typeof window !== 'undefined' && window.T ? window.T(s, v) : String(s).split('|')[0].replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));

/* ================= geometry helpers (pure; unit-tested in test/outdoor-unit.mjs) ================= */
/* Ground kinds as stored (older plans used these names) -> [label, color]. */
export const AREA_KINDS = { grass: ['Lawn', '#4f7d3a'], patio: ['Terrace', '#a39382'], path: ['Path', '#c9c2b8'], driveway: ['Driveway', '#5f6670'], garden: ['Flower bed', '#5a3c2a'], gravel: ['Gravel', '#b3aca2'], pool: ['Pool', '#2fa4d6'] };
export const AREA_ITEM_KIND = { grass: 'lawn', patio: 'terrace', path: 'path', driveway: 'driveway', garden: 'bed', gravel: 'gravel', pool: 'pool' };
export const LINE_KINDS = { fence: ['Fence', '#8a6a4c', 1.2], hedge: ['Hedge', '#3f7a3a', 1.4] };
const r2 = (v) => Math.round(v * 100) / 100 || 0;   // (never -0)
export const snap = (v, step = 0.05) => r2(Math.round(v / step) * step);
/* Shoelace area in the x/z plane: positive when the corners go one way round, negative the other. */
export function signedArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; }
export const polyArea = (pts) => Math.abs(signedArea(pts));
export function pathLength(pts, closed = false) { let s = 0; const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += Math.hypot(q[0] - p[0], q[1] - p[1]); } return s; }
export function pointInPoly([x, z], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; }
  return inside;
}
/* A rectangle from two opposite corners (null when it would be thinner than 10 cm). */
export function rectPts(a, b) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
  if (x1 - x0 < 0.1 || z1 - z0 < 0.1) return null;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map((p) => p.map(r2));
}
/* Tapping near the first corner closes a free shape (at least 3 corners). */
export const closesAt = (pts, p, tol = 0.35) => pts.length >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= tol;
/* Drop corners that sit on top of the one before (a double tap), and a last corner that repeats the first. */
export function cleanPoly(pts, closed = true) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) out.push([r2(p[0]), r2(p[1])]); }
  if (closed && out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.01) out.pop();
  return out;
}
/* A sloped surface (a driveway that climbs to the garage): the first side drawn is the low side; the far side is
   `rise` metres higher. Returns the height at any point. */
export function slopeFn(pts, rise) {
  if (!rise || pts.length < 3) return () => 0;
  const [a, b] = pts, ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
  let nx = -ez / L, nz = ex / L; const dist = (p) => (p[0] - a[0]) * nx + (p[1] - a[1]) * nz;
  let far = Math.max(...pts.map(dist)); if (far <= 1e-6) { nx = -nx; nz = -nz; far = Math.max(...pts.map(dist)); }
  if (far <= 1e-6) return () => 0;
  return (x, z) => rise * Math.max(0, Math.min(1, dist([x, z]) / far));
}
/* A pool's shell: its inner walls (each with the normal pointing into the water), the floor depth and the water line. */
export function poolShell(pts, depth = 1.4) {
  const ccw = signedArea(pts) > 0, d = Math.max(0.3, Math.min(3, depth || 1.4));
  const walls = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length], ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1;
    const n = ccw ? [-ez / L, ex / L] : [ez / L, -ex / L];   // inward, toward the middle of the pool
    return { a: p, b: q, len: L, n };
  });
  return { walls, depth: d, waterY: -0.12, floorY: -d, ccw };
}
/* The stone edge around a pool: one slab per side, set outside the water. */
export function copingPieces(pts, width = 0.3) {
  const { walls } = poolShell(pts);
  return walls.map((w) => ({ cx: (w.a[0] + w.b[0]) / 2 - w.n[0] * width / 2, cz: (w.a[1] + w.b[1]) / 2 - w.n[1] * width / 2, len: w.len + width * 2, ang: Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]), width }));
}
/* Fence posts: one at every corner and evenly between, never further apart than `spacing`. */
export function fencePosts(pts, spacing = 2) {
  const out = [];
  pts.forEach((p, i) => {
    if (i === 0) out.push([r2(p[0]), r2(p[1])]);
    if (i === pts.length - 1) return;
    const q = pts[i + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / spacing - 1e-9));
    for (let k = 1; k <= n; k++) out.push([r2(p[0] + (q[0] - p[0]) * k / n), r2(p[1] + (q[1] - p[1]) * k / n)]);
  });
  return out;
}
/* Turn a point around a center (degrees, the same way an item's rot turns it). */
export function rotateAround([x, z], [cx, cz], degs) {
  const a = -degs * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - cx, dz = z - cz;
  return [r2(cx + dx * c - dz * s), r2(cz + dx * s + dz * c)];
}
/* A new corner in the middle of side i (between corner i and the next). */
export function insertCorner(pts, i) { const p = pts[i], q = pts[(i + 1) % pts.length]; const out = pts.map((x) => [...x]); out.splice(i + 1, 0, [r2((p[0] + q[0]) / 2), r2((p[1] + q[1]) / 2)]); return out; }
/* The footprint of an item (its four corners on the ground), for box select and the dimension readout. */
export function footprint(it) {
  const [w, d] = sizeOf(it), a = -(it.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), [x, z] = it.pos;
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]);
}

/* ================= the editor and the live household (browser only) ================= */
const V3 = THREE.Vector3, deg = THREE.MathUtils.degToRad;
const r2v = (v) => Math.round(v * 100) / 100 || 0;
const fmt = (m) => `${(Math.round(m * 100) / 100).toFixed(2)} m`;
const newId = () => Math.random().toString(36).slice(2, 10);
const OUTSIDE = new Set(['bin', 'mailbox', 'planter', 'awning']);
const COLORED = new Set(['sofa', 'armchair', 'bed1', 'bed2', 'rug', 'wardrobe', 'counter', 'island', 'sink', 'pot', 'planter', 'chair', 'ochair', 'mailbox', 'awning', 'bin']);
const ICONS = {
  grass: 'M3 20h18M5 20c0-4 1-7 2-9M9 20c0-5 1-9 3-12M13 20c0-4 1-6 3-8M17 20c0-3 1-5 2-6', patio: 'M3 5h18v14H3zM3 12h18M9 5v14M15 5v14',
  path: 'M6 20a2.5 1.2 0 1 0 5 0 2.5 1.2 0 1 0-5 0M11 14a2.5 1.2 0 1 0 5 0 2.5 1.2 0 1 0-5 0M8 8a2.5 1.2 0 1 0 5 0 2.5 1.2 0 1 0-5 0', driveway: 'M4 21l4-18M20 21L16 3M12 5v3M12 11v3M12 17v3',
  garden: 'M12 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM12 10v10M12 16c-3 0-5-2-5-4M12 18c3 0 5-2 5-4M4 20h16', gravel: 'M6 16h.5M10 18h.5M14 15h.5M18 18h.5M8 12h.5M16 11h.5M12 13h.5M4 21h16',
  pool: 'M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2-1.5 4.5-1.5S19 17 21 17M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2-1.5 4.5-1.5S19 21 21 21M8 14V5a2 2 0 0 1 4 0M16 14V5a2 2 0 0 0-4 0M8 8h8M8 11h8',
  fence: 'M5 21V6l2-3 2 3v15M15 21V6l2-3 2 3v15M3 10h18M3 16h18', hedge: 'M3 20h18M4 20v-6a4 4 0 0 1 4-4 4 4 0 0 1 8 0 4 4 0 0 1 4 4v6',
  bin: 'M6 7h12l-1 13H7zM5 7h14M10 4h4v3M9 20v1M15 20v1', mailbox: 'M4 11a4 4 0 0 1 8 0v6H4zM8 7h8a4 4 0 0 1 4 4v6h-8M8 17v4M15 7V3h3', planter: 'M7 13h10l-1.5 8h-7zM12 13V8M12 8c0-3 3-5 6-5 0 3-3 5-6 5zM12 10C12 7 9 5 6 5c0 3 3 5 6 5',
  pot: 'M7 13h10l-1.5 8h-7zM12 13V8M12 8c0-3 3-5 6-5 0 3-3 5-6 5zM12 10C12 7 9 5 6 5c0 3 3 5 6 5',
  awning: 'M3 4h18M4 4l-1 6h18l-1-6M3 10c0 1.5 1.5 2 3 2s3-.5 3-2c0 1.5 1.5 2 3 2s3-.5 3-2c0 1.5 1.5 2 3 2s3-.5 3-2', led: 'M3 15h18M5 15v2M9 15v2M13 15v2M17 15v2M6 11l-1-2M12 10V8M18 11l1-2',
  sofa: 'M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h18v5H3zM5 16v2M19 16v2', armchair: 'M6 11V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M4 11h16v5H4zM6 16v2M18 16v2',
  coffeetable: 'M3 10h18M5 10v6M19 10v6M7 14h10', tvstand: 'M3 13h18v6H3zM9 13v6M15 13v6', tv: 'M3 5h18v11H3zM9 20h6M12 16v4', rug: 'M4 6h16v12H4zM7 9h10v6H7z',
  lamp: 'M8 3h8l2 6H6zM12 9v11M8 21h8', shelves: 'M5 3v18M19 3v18M5 8h14M5 13h14M5 18h14M8 5v3M10 10v3', bed2: 'M3 18V7M3 14h18v4M21 18v-6a2 2 0 0 0-2-2h-8v4M6 11h3',
  bed1: 'M5 18V7M5 14h14v4M19 18v-5a2 2 0 0 0-2-2h-5v3', nightstand: 'M5 8h14v12H5zM5 14h14M11 11h2M11 17h2', wardrobe: 'M5 3h14v18H5zM12 3v18M10 11v2M14 11v2',
  dtable: 'M3 9h18M6 9v11M18 9v11', chair: 'M7 3v18M7 12h10v9M7 12V3', desk: 'M3 9h18M5 9v11M19 9v11M13 9v11M13 14h6', ochair: 'M8 4h8v8H8zM6 13h12M12 13v5M7 21l5-3 5 3',
  counter: 'M3 9h18v11H3zM3 12h18M9 12v8M15 12v8', island: 'M3 9h18v4H3zM5 13v7M19 13v7', fridge: 'M6 3h12v18H6zM6 10h12M9 6v2M9 13v3', oven: 'M4 3h16v18H4zM4 8h16M7 11h10v7H7zM8 5.5h.5M12 5.5h.5M16 5.5h.5',
  sink: 'M3 11h18M5 11v9h14v-9M12 11V6a2 2 0 0 1 4 0', dishwasher: 'M5 3h14v18H5zM5 7h14M8 5h.5', washer: 'M5 3h14v18H5zM5 7h14M12 15m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0', dryer: 'M5 3h14v18H5zM5 7h14M12 15m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0M10 14c1-1 3 1 4 0',
  toilet: 'M7 3h6v6H7zM5 9h12a4 4 0 0 1-4 5H9v7h6', bath: 'M3 12h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 12V5a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2', shower: 'M4 21V7a4 4 0 0 1 8 0M12 7h4M17 10v.5M14 12v.5M17 14v.5M20 12v.5',
  select: 'M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M10 10l6 2-3 1-1 3z', wall: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v5M15 9v5M9 14v6',
  dot: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
};
const STYLE = `
#left .tabs { flex-wrap: wrap; } #left .tabs button { flex: 1 1 auto; padding-left: 6px; padding-right: 6px; }   /* six tabs now: wrap instead of cutting the last one off */
.odgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 7px; margin: 6px 0 10px; }
.odbig { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-height: 70px; padding: 9px 4px; border-radius: 12px; border: 1px solid var(--line); background: color-mix(in srgb, var(--text) 5%, transparent); color: var(--text); font: inherit; font-size: 12.5px; line-height: 1.15; text-align: center; cursor: pointer; transition: border-color .15s, background .15s, transform .1s; }
.odbig:hover { border-color: var(--hl); } .odbig:active { transform: scale(.97); } .odbig.on { border-color: var(--hl); background: color-mix(in srgb, var(--hl) 18%, transparent); }
.odbig .odic svg, .odrow .odic svg { width: 26px; height: 26px; display: block; } .odrow .odic svg { width: 18px; height: 18px; }
.odbig .odsw { width: 30px; height: 6px; border-radius: 3px; background: var(--rc, #888); }
.odrow { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.odrow:hover { background: color-mix(in srgb, var(--text) 5%, transparent); } .odrow.on { border-color: var(--hl); background: color-mix(in srgb, var(--hl) 12%, transparent); }
.odrow .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .odrow small { color: var(--muted); }
.odsel { border: 1px solid var(--hl); border-radius: 12px; padding: 10px; margin: 8px 0 12px; display: grid; gap: 8px; background: color-mix(in srgb, var(--hl) 7%, transparent); }
.odsel .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; } .odsel label { min-width: 74px; color: var(--muted); font-size: 12px; }
.odsel input[type=number] { width: 64px; } .odsel select { max-width: 190px; }
.odcats { display: flex; flex-wrap: wrap; gap: 5px; margin: 4px 0; } .odcats .mini { border-radius: 999px; } .odcats .mini.on { background: var(--hl); color: var(--hl-ink); border-color: var(--hl); }
.odtag { padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; color: #111827; background: #fde68a; box-shadow: 0 2px 10px rgba(0,0,0,.25); transform: translateY(-4px); }
.odtag.soon { background: #e2e8f0; } .odtag.out, .odtag.done { background: #86efac; } .odtag.run { background: #bae6fd; } .odtag.thirsty { background: #fcd34d; } .odtag.mail { background: #fde68a; }
.oddim { padding: 1px 6px; border-radius: 6px; font-size: 11px; font-weight: 600; color: #111827; background: rgba(253, 230, 138, .95); white-space: nowrap; pointer-events: none; }
.odbox { position: fixed; border: 1.5px dashed #fbbf24; background: rgba(251, 191, 36, .1); pointer-events: none; z-index: 50; }
.odcard { position: fixed; z-index: 60; transform: translate(-50%, calc(-100% - 12px)); min-width: 190px; max-width: 260px; padding: 10px 12px; border-radius: 14px; background: var(--panel-solid, #0e1424); color: var(--text); border: 1px solid var(--line-2, rgba(148,163,184,.3)); box-shadow: var(--shadow); display: grid; gap: 6px; font-size: 13px; }
.odcard small { color: var(--muted); } .odcard .row { display: flex; gap: 6px; }
`;
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); return e; };
const svgIc = (k) => { const s = el('span', { class: 'odic', 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[k] || ICONS.dot}"/></svg>`; return s; };
const kelvinHex = (k) => { const t = Math.max(0, Math.min(1, ((k || 2700) - 2200) / 4300)); return `#${new THREE.Color('#ffb46b').lerp(new THREE.Color('#e6eeff'), t).getHexString()}`; };
const nameOf = (it) => T(FURN[it.kind]?.[0] || it.kind);

let ACTIVE = null;
/* The live view (or anyone) passes GET /api/household here on each refresh: bins light up the night before pickup with a
   "Tonight" tag ("Tomorrow" the evening before that, "Out ✓" once they're out), the mailbox glows and raises its flag when
   the post came, a thirsty plant droops and pales, a washer or dryer shows its minutes left or "Done". */
export function updateHousehold(state) { ACTIVE?.household(state); }

export function createOutdoor(scene, yard, getCtx) {
  let C0 = null; const C = () => (C0 ||= getCtx());
  const groups = new Map(), built = new Map(), ray = new THREE.Raycaster(), wr = new THREE.Raycaster(), ndc = new THREE.Vector2(), tmp = new V3();
  wr.far = 6;
  const over = new THREE.Group(); over.name = 'outdoor-editing'; scene.add(over);
  const handles = new THREE.Group(); over.add(handles);
  const wallG = new THREE.Group(); over.add(wallG);
  const st = { sel: new Set(), shape: 'rect', cat: 'living', pick: null, clip: [], hh: null, hhAt: 0, hhBusy: false, down: null, dragged: false, prevCam: null, lastTap: null, devSig: '' };
  let P = null, preview = null, card = null;
  yard.lowQuality = () => C().low?.();   // the yard asks when it builds
  if (typeof document !== 'undefined' && !document.getElementById('od-style')) document.head.append(el('style', { id: 'od-style' }, STYLE));

  const items = () => C().S.plan?.items || [];
  const itemOf = (id) => items().find((x) => x.id === id);
  const shown = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  const rayAt = (cx, cy) => { const r = C().canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, C().camera); return ray; };
  const ground = (e) => rayAt(e.clientX, e.clientY).ray.intersectPlane(new THREE.Plane(new V3(0, 1, 0), -C().groundY()), new V3());
  const onTab = () => { const S = C().S; return S.mode === 'edit' && (S.tab === 'yard' || S.tab === 'furniture'); };

  /* ---------- building ---------- */
  function boxOf(o) {   // QA: matrices first - a piece placed a moment ago drew its outline at the house's corner
    o.updateWorldMatrix(true, true); const b = new THREE.Box3(); o.traverse((x) => { if (x.isMesh && x.name !== 'halo' && x.name !== 'strip' && x.visible) b.expandByObject(x); }); return b; }
  function build() {
    const c = C(), S = c.S;
    for (const g of groups.values()) { scene.remove(g); g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); if (o.isCSS2DObject) o.element.remove(); }); }
    groups.clear(); built.clear(); P?.dispose(); P = new Palette(c.curTheme());
    for (const it of items()) {
      const F = it.floor ? S.F[it.floor] : null; if (it.floor && !F) continue;
      const key = it.floor || ''; let g = groups.get(key); if (!g) { g = new THREE.Group(); g.name = `items:${key || 'outside'}`; groups.set(key, g); scene.add(g); }
      const o = buildFurniture(it, P); if (!o) continue;
      o.position.set(it.pos[0], it.y || 0, it.pos[1]); o.rotation.y = deg(it.rot || 0); if (it.kind === 'led' && it.tilt) o.rotation.z = deg(it.tilt);
      if (it.binId || it.mail || it.plantId || it.laundryId) { const tag = new CSS2DObject(el('div', { class: 'odtag' })); tag.position.set(0, sizeOf(it)[2] + 0.3, 0); tag.visible = false; o.add(tag); o.userData.tag = tag; }
      g.add(o); built.set(it.id, { o, it });
    }
    for (const m of yard.pools || []) m.emissiveIntensity = c.high() ? 0.4 : 0; yard.high = c.high();
    sync(); if (st.hh) household(st.hh); devices(c.S.live?.devices || [], true); drawSel(); if (st.pick) showHandles(); if (S.tool?.type === 'od-wallview') drawWall();
    batch(S.mode === 'view');
    c.reshadow();
  }
  /* QA: in the 3D view the pieces that never change are merged, one mesh per material per floor (floorplan-batch.js);
     anything that lights up, moves or shows a tag (bins, the mailbox, plants, awnings, lamps, strip lights, TVs) stays its own. */
  const isStill = (it) => !(it.binId || it.mail || it.plantId || it.laundryId || it.coverId || it.deviceId) && !['awning', 'led', 'lamp', 'tv'].includes(it.kind);
  function batch(on) {
    let changed = false;
    for (const g of groups.values()) {
      if (on) { batchStatic(g, (root) => { const b = built.get(root.userData.itemId); return !!b && isStill(b.it) && !root.userData.tag; }); changed = true; }
      else changed = unbatch(g) || changed;
    }
    if (changed) { C().reshadow(); }
  }
  /* Follow the floors: stacked, pulled apart, hidden, or only the one you picked. */
  function sync() {
    const c = C(), S = c.S;
    for (const [key, g] of groups) {
      if (!key) { g.position.set(0, c.groundY(), 0); g.visible = yard.group.visible; }
      else { const F = S.F[key]; if (!F) { g.visible = false; continue; } g.position.set(F.G.position.x, F.G.position.y + F.floorY, F.G.position.z); g.visible = F.G.visible; }
      g.traverse((o) => { if (o.isCSS2DObject) o.visible = g.visible && !!o.userData.on; });
    }
    if (S.tool?.type !== 'od-wallview' && st.prevCam) { c.controls.enableRotate = true; restoreNear(); st.prevCam = null; clearWall(); }   // left the wall view some other way
    if (!onTab() && (st.sel.size || st.pick)) { st.sel.clear(); st.pick = null; drawSel(); showHandles(); }
  }

  /* ---------- live: household and devices ---------- */
  function setTag(b, text, cls) { const t = b.o.userData.tag; if (!t) return; t.userData.on = !!text; t.element.textContent = text || ''; t.element.className = `odtag${cls ? ` ${cls}` : ''}`; t.visible = !!text && shown(b.o.parent || b.o); }
  function glow(b, k, color) { for (const m of b.o.userData.glow || []) { if (m.emissive) { if (color) m.emissive.set(color); m.emissiveIntensity = k; } } const h = b.o.userData.halo; if (h) { h.visible = k > 0; h.material.opacity = k > 0 ? 0.6 : 0; if (color) h.material.color.set(color); } }
  function household(state) {
    st.hh = state; if (!state || !P) return;
    for (const b of built.values()) {
      const it = b.it;
      if (it.kind === 'bin' && it.binId) {
        const x = (state.bins || []).find((q) => q.id === it.binId); if (!x) { setTag(b, ''); glow(b, 0); continue; }
        if (x.color && b.o.userData.glow?.[0]) { const want = P.tint(x.color); b.o.userData.glow[0].color.copy(want); b.o.userData.glow[1]?.color.copy(want.clone().multiplyScalar(0.78)); }
        const due = x.state === 'tonight' || x.state === 'today';
        if (x.out && (due || x.state === 'tomorrow')) { setTag(b, T('Out ✓'), 'out'); glow(b, 0); }
        else if (x.state === 'tonight') { setTag(b, T('Tonight'), ''); glow(b, 0.07, '#fbbf24'); }
        else if (x.state === 'today') { setTag(b, T('Today'), ''); glow(b, 0.06, '#fbbf24'); }
        else if (x.state === 'tomorrow') { setTag(b, T('Tomorrow'), 'soon'); glow(b, 0); }
        else { setTag(b, ''); glow(b, 0); }
      } else if (it.kind === 'mailbox' && it.mail) {
        const post = state.mail?.state === 'post'; setTag(b, post ? T('Mail') : '', 'mail'); glow(b, post ? 0.16 : 0, '#fbbf24');
        const f = b.o.userData.flag; if (f) f.rotation.x = post ? Math.PI / 2 : 0;
      } else if ((it.kind === 'pot' || it.kind === 'planter') && it.plantId) {
        const p = (state.plants || []).find((q) => q.id === it.plantId), dry = !!p && p.thirsty && !p.watered, lf = b.o.userData.leaf;
        if (lf) { lf.rotation.set(dry ? 0.12 : 0, 0, dry ? 0.24 : 0); lf.scale.set(1, dry ? 0.88 : 1, 1); const m = lf.userData.mat; if (m) { m.userData.base ||= m.color.clone(); m.color.copy(m.userData.base); if (dry) m.color.lerp(P.tint('#b59a45'), 0.5); } }
        setTag(b, dry ? `${T('Thirsty')}${p.moisture != null ? ` · ${Math.round(p.moisture)}%` : ''}` : '', 'thirsty');
      } else if (['washer', 'dryer', 'dishwasher'].includes(it.kind) && it.laundryId) {
        const a = (state.laundry || []).find((q) => q.id === it.laundryId);
        if (a?.phase === 'running') { setTag(b, a.remainingMin != null ? T('{n} min', { n: a.remainingMin }) : T('Running'), 'run'); glow(b, 0); }
        else if (a?.phase === 'done') { setTag(b, T('Done'), 'done'); glow(b, 0.3, '#86efac'); }
        else { setTag(b, ''); glow(b, 0); }
      }
    }
    C().kick();
  }
  /* Awnings follow their cover's position, strip lights and lamps glow in their light's color, a TV glows while it plays. */
  function devices(devs, force) {
    const by = new Map(devs.map((d) => [d.id, d])), sig = [];
    for (const b of built.values()) {
      const it = b.it, d = by.get(it.coverId || it.deviceId); if (!d) continue;
      if (it.kind === 'awning' && it.coverId) { const f = (d.position ?? (d.open ? 100 : 0)) / 100; b.o.userData.awnTarget = f; if (b.o.userData.awnAt == null) { b.o.userData.awnAt = f; setAwning(b.o, f); } sig.push(f); }
      else if (it.kind === 'led' || it.kind === 'lamp') {
        const on = !!d.on, k = on ? 0.35 + 0.65 * ((d.brightness ?? 100) / 100) : 0, col = d.rgb || (d.kelvin ? kelvinHex(d.kelvin) : '#ffd39a');
        for (const m of b.o.userData.glow || []) { m.emissive.set(on ? col : '#000000'); m.emissiveIntensity = on ? (it.kind === 'led' ? 1.6 : 0.9) * k : 0.05; }
        const w = b.o.userData.wash; if (w) { w.material.color.set(col); w.material.opacity = 0.55 * k; w.visible = on; }
        sig.push(on, k, col);
      } else if (it.kind === 'tv') { const on = d.kind === 'media' ? !!(d.playing || d.on) : !!d.on; for (const m of b.o.userData.glow || []) m.emissiveIntensity = on ? 0.55 : 0; sig.push(on); }
    }
    const s = sig.join(); if (force || s !== st.devSig) { st.devSig = s; C().kick(); }
  }
  async function live() {
    const c = C(); devices(c.S.live?.devices || []);
    const need = items().some((it) => it.binId || it.mail || it.plantId || it.laundryId) || onTab();
    if (!need || st.hhBusy || Date.now() - st.hhAt < 20_000) return;
    st.hhBusy = true;
    try { const r = await fetch('/api/household', { cache: 'no-store' }); if (r.ok) { st.hhAt = Date.now(); household(await r.json()); } }
    catch { /* offline: keep the last state */ } finally { st.hhBusy = false; }
  }
  const awnMoving = () => { for (const b of built.values()) { const u = b.o.userData; if (u.awnTarget != null && Math.abs((u.awnAt ?? u.awnTarget) - u.awnTarget) > 0.002) return true; } return false; };
  let lastT = 0;
  function tick(now) {
    const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
    for (const b of built.values()) { const u = b.o.userData; if (u.awnTarget == null || u.awnAt == null || Math.abs(u.awnAt - u.awnTarget) < 0.002) continue; u.awnAt += Math.sign(u.awnTarget - u.awnAt) * Math.min(Math.abs(u.awnTarget - u.awnAt), dt * 0.35); setAwning(b.o, u.awnAt); C().reshadow(); }
    const hi = C().high(); if (yard.high !== hi) { yard.high = hi; for (const m of yard.pools || []) m.emissiveIntensity = hi ? 0.4 : 0; }
    yard.shimmer?.(now / 1000); wallNear();
  }
  const moving = () => awnMoving() || !!(yard.high && yard.pools?.length && yard.group.visible);

  /* ---------- selection, readout ---------- */
  const selBoxes = [];
  function drawSel() {
    for (const b of selBoxes) { over.remove(b); b.geometry.dispose(); b.material.dispose(); } selBoxes.length = 0;
    for (const id of st.sel) { const b = built.get(id); if (!b || !shown(b.o)) continue; const h = new THREE.Box3Helper(boxOf(b.o).expandByScalar(0.02), 0xfbbf24); h.material.depthTest = false; h.renderOrder = 60; h.raycast = () => {}; over.add(h); selBoxes.push(h); }
    C().kick();
  }
  function selectWithGroup(it, add) { if (!add) st.sel.clear(); if (it.grp) for (const x of items()) if (x.grp === it.grp) st.sel.add(x.id); st.sel.add(it.id); }
  const dimLine = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3)), new THREE.LineBasicMaterial({ color: '#fbbf24', depthTest: false }));
  dimLine.renderOrder = 61; dimLine.visible = false; dimLine.frustumCulled = false; dimLine.raycast = () => {}; over.add(dimLine);
  const dimLabs = typeof document === 'undefined' ? [] : Array.from({ length: 5 }, () => { const l = new CSS2DObject(el('div', { class: 'oddim' })); l.visible = false; over.add(l); return l; });
  function readout(id) {
    const b = built.get(id), it = itemOf(id); if (!b || !it) return;
    const [w, d, h] = sizeOf(it), o = b.o, pos = dimLine.geometry.attributes.position;
    o.updateMatrixWorld(true);
    dimLabs[0].position.copy(o.localToWorld(new V3(0, h + 0.2, 0))); dimLabs[0].element.textContent = `${fmt(w)} × ${fmt(d)}`; dimLabs[0].visible = true;
    const F = it.floor && C().S.F[it.floor], walls = F ? F.wallMeshes.filter((m) => m.visible && m.userData.cat !== 'opening') : [];
    const ctr = o.localToWorld(new V3(0, Math.min(1.1, Math.max(0.3, h / 2)), 0));
    [[1, 0, w / 2], [-1, 0, w / 2], [0, 1, d / 2], [0, -1, d / 2]].forEach(([dx, dz, half], i) => {
      const lab = dimLabs[i + 1], dir = new V3(dx, 0, dz).applyAxisAngle(new V3(0, 1, 0), o.rotation.y);
      wr.set(ctr, dir); const hit = walls.length ? wr.intersectObjects(walls, false)[0] : null;
      if (!hit || hit.distance - half < -0.05) { lab.visible = false; for (let k = 0; k < 6; k++) pos.array[i * 6 + k] = 0; return; }
      const a = ctr.clone().addScaledVector(dir, half); pos.array.set([a.x, a.y, a.z, hit.point.x, hit.point.y, hit.point.z], i * 6);
      lab.position.copy(a).lerp(hit.point, 0.5); lab.element.textContent = fmt(Math.max(0, hit.distance - half)); lab.visible = true;
    });
    pos.needsUpdate = true; dimLine.visible = true;
  }
  function clearReadout() { dimLine.visible = false; for (const l of dimLabs) l.visible = false; C().kick(); }

  /* ---------- picking ---------- */
  function pickItem(e) {
    const cur = C().curF(), gs = [...groups].filter(([k, g]) => g.visible && (!cur || !k || k === cur.f.id)).map(([, g]) => g); if (!gs.length) return null;
    for (const h of rayAt(e.clientX, e.clientY).intersectObjects(gs, true)) {
      if (!h.object.isMesh || !shown(h.object)) continue; let o = h.object; while (o && !o.userData.itemId) o = o.parent;
      const b = o && built.get(o.userData.itemId); if (b) return { ...b, point: h.point, distance: h.distance };
    }
    return null;
  }
  function pickArea(e) {
    if (!yard.group.visible) return null;
    for (const h of rayAt(e.clientX, e.clientY).intersectObject(yard.group, true)) { let o = h.object; while (o && !o.userData.yardArea && !o.userData.yardLine && !o.userData.yard && o !== yard.group) o = o.parent; if (o?.userData.yard) return null; /* a tree or a car: not the ground under it */ if (o?.userData.yardArea) return { type: 'area', id: o.userData.yardArea }; if (o?.userData.yardLine) return { type: 'line', id: o.userData.yardLine }; }
    return null;
  }
  function floorHit(e) {
    const c = C(), cur = c.curF(), Fs = Object.values(c.S.F).filter((F) => F.G.visible && (!cur || F === cur));
    const h = rayAt(e.clientX, e.clientY).intersectObjects(Fs.map((F) => F.G), true).find((x) => x.object.isMesh && x.object.visible && x.object.material?.opacity !== 0 && !(x.point.y > (x.object.material?.clippingPlanes?.[0]?.constant ?? Infinity)));
    const F = h && c.S.F[h.object.userData.floor]; if (!F) return null;
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new V3(0, 1, 0);
    return { F, h, n, local: F.G.worldToLocal(h.point.clone()), wall: Math.abs(n.y) < 0.5 };
  }

  /* ---------- saving ---------- */
  let saveTimer = null;
  async function saveItems(list, quiet) {
    const c = C(); c.S.plan.items = list; build(); if (!quiet) c.editor();
    try { await c.send('/api/floorplan/items', 'PUT', { items: list }); } catch (e) { c.proErr(e); }
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveItems(items(), true), 400); };
  const listCopy = () => items().map((x) => ({ ...x, pos: [...x.pos] }));

  /* ---------- dragging things (and whole groups) ---------- */
  function pressItem(e, hit) {
    const c = C(), it = itemOf(hit.it.id); if (!it) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) { if (st.sel.has(it.id)) st.sel.delete(it.id); else selectWithGroup(it, true); }
    else if (!st.sel.has(it.id)) { if (e.altKey) { st.sel.clear(); st.sel.add(it.id); } else selectWithGroup(it, false); }   // Alt: just this one, not its group
    drawSel();
    const wv = c.S.tool?.type === 'od-wallview' ? c.S.tool : null;
    const plane = wv ? new THREE.Plane().setFromNormalAndCoplanarPoint(wv.n, hit.point) : new THREE.Plane(new V3(0, 1, 0), -hit.o.getWorldPosition(tmp).y);
    const start = rayAt(e.clientX, e.clientY).ray.intersectPlane(plane, new V3()); if (!start) return;
    const moving = [...st.sel].map((id) => built.get(id)).filter(Boolean).map((b) => ({ b, p0: b.o.position.clone() }));
    let moved = false; const x0 = e.clientX, y0 = e.clientY, w = new V3();
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      if (!moved) { moved = true; c.controls.enabled = false; document.body.classList.add('dragging'); }
      if (!rayAt(ev.clientX, ev.clientY).ray.intersectPlane(plane, w)) return;
      const step = ev.altKey ? 0.01 : 0.05;
      if (wv) { const dt = snap(w.clone().sub(start).dot(wv.t), step), dy = snap(w.y - start.y, step); for (const m of moving) m.b.o.position.set(m.p0.x + wv.t.x * dt, Math.max(0, m.p0.y + dy), m.p0.z + wv.t.z * dt); drawWall(true); }
      else { const dx = snap(w.x - start.x, step), dz = snap(w.z - start.z, step); for (const m of moving) m.b.o.position.set(m.p0.x + dx, m.p0.y, m.p0.z + dz); }
      drawSel(); readout(it.id); c.kick();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      c.controls.enabled = true; document.body.classList.remove('dragging'); clearReadout();
      if (!moved) { c.editor(); return; }
      st.dragged = true; setTimeout(() => { st.dragged = false; }, 0);
      for (const m of moving) { const x = itemOf(m.b.it.id); if (x) { x.pos = [r2v(m.b.o.position.x), r2v(m.b.o.position.z)]; x.y = r2v(m.b.o.position.y); } }
      saveItems(items());
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  /* ---------- the selected things: turn, align, copy, group ---------- */
  const selected = () => items().filter((x) => st.sel.has(x.id));
  function center(list) { const c = [0, 0]; for (const x of list) { c[0] += x.pos[0] / list.length; c[1] += x.pos[1] / list.length; } return c; }
  function turn(by) { const list = selected(); if (!list.length) return; const c = center(list); for (const x of list) { x.pos = rotateAround(x.pos, c, by); x.rot = ((((x.rot || 0) + by) % 360) + 540) % 360 - 180; } saveItems(items()); }
  function remove() { const n = st.sel.size; if (!n) return; const list = items().filter((x) => !st.sel.has(x.id)); st.sel.clear(); saveItems(list); C().toast(n > 1 ? T('Removed {n} pieces.', { n }) : T('Removed.')); }
  function copy() { st.clip = selected().map((x) => ({ ...x, pos: [...x.pos] })); if (st.clip.length) C().toast(st.clip.length > 1 ? T('Copied {n} pieces.', { n: st.clip.length }) : T('Copied.')); }
  function paste(src = st.clip) {
    if (!src.length) return; const c = C(), F = c.edFloor(), grps = new Map(), list = listCopy(); st.sel.clear();
    for (const x of src) { const n = { ...x, pos: [r2v(x.pos[0] + 0.5), r2v(x.pos[1] + 0.5)], id: newId() }; if (x.grp) { if (!grps.has(x.grp)) grps.set(x.grp, newId()); n.grp = grps.get(x.grp); } if (x.floor && F && x.floor !== F.f.id && c.S.F[x.floor] == null) n.floor = F.f.id; list.push(n); st.sel.add(n.id); }
    saveItems(list);
  }
  function group(on) { const list = selected(); if (!list.length) return; const g = on ? newId() : null; for (const x of list) { if (g) x.grp = g; else delete x.grp; } saveItems(items()); C().toast(on ? T('Grouped - they move together now.') : T('Ungrouped.')); }
  /* Against the wall: turn the first selected piece's back to the nearest wall and slide it (and the rest of the selection) to touch it. */
  function alignToWall() {
    const list = selected(), first = list[0], b = first && built.get(first.id), c = C(); if (!b) return;
    const F = first.floor && c.S.F[first.floor]; if (!F) { c.toast(T('Only for things inside the house.')); return; }
    const walls = F.wallMeshes.filter((m) => m.visible && m.userData.cat !== 'opening'), [, d, h] = sizeOf(first), ctr = b.o.localToWorld(new V3(0, Math.min(1.1, Math.max(0.3, h / 2)), 0));
    let best = null; wr.far = 5; for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; wr.set(ctr, new V3(Math.sin(a), 0, Math.cos(a))); const hit = walls.length ? wr.intersectObjects(walls, false)[0] : null; if (hit && (!best || hit.distance < best.distance)) best = hit; } wr.far = 6;
    if (!best) { c.toast(T('No wall close by.')); return; }
    const n = (best.face ? best.face.normal.clone().transformDirection(best.object.matrixWorld) : best.point.clone().sub(ctr).negate()).setY(0).normalize();
    if (n.dot(ctr.clone().sub(best.point)) < 0) n.negate();   // the side of the wall the piece is on
    const want = Math.round(Math.atan2(n.x, n.z) * 180 / Math.PI), by = want - (first.rot || 0), pivot = [...first.pos];
    for (const x of list) { x.pos = rotateAround(x.pos, pivot, by); x.rot = ((((x.rot || 0) + by) % 360) + 540) % 360 - 180; }
    const hitL = F.G.worldToLocal(best.point.clone()), gap = (first.pos[0] - hitL.x) * n.x + (first.pos[1] - hitL.z) * n.z, shift = d / 2 + 0.01 - gap;
    for (const x of list) x.pos = [r2v(x.pos[0] + n.x * shift), r2v(x.pos[1] + n.z * shift)];
    saveItems(items());
  }

  /* ---------- drawing on the ground ---------- */
  function clearPreview() { if (preview) { over.remove(preview); preview.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); preview = null; } C().kick(); }
  function drawPreview(cursor) {
    clearPreview(); const t = C().S.tool; if (!t || !/^od-(area|line)$/.test(t.type)) return;
    const y = C().groundY() + 0.06, pts = [...t.pts]; if (cursor) pts.push([cursor.x, cursor.z]);
    let line = pts; if (t.type === 'od-area' && t.shape === 'rect' && t.pts.length === 1 && cursor) line = rectPts(t.pts[0], [cursor.x, cursor.z]) || pts;
    preview = new THREE.Group(); if (!line.length) return;
    const v = line.map(([x, z]) => new V3(x, y, z)); if (t.type === 'od-area' && line.length > 2) v.push(v[0]);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: '#f472b6', depthTest: false })); l.renderOrder = 62;
    const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(t.pts.map(([x, z]) => new V3(x, y, z))), new THREE.PointsMaterial({ color: '#ffffff', size: 9, sizeAttenuation: false, depthTest: false })); dots.renderOrder = 63;
    preview.add(l, dots); over.add(preview); C().kick();
  }
  function finishShape() {
    const c = C(), t = c.S.tool; if (!t) return;
    const pts = cleanPoly(t.pts, t.type === 'od-area'), yd = c.yardData(); yd.lines ||= [];
    if (t.type === 'od-area') { if (pts.length < 3) { c.toast(T('Tap at least 3 corners.')); return; } const a = { id: newId(), kind: t.kind, pts }; if (t.kind === 'pool') a.depth = 1.4; yd.areas.push(a); st.pick = { type: 'area', id: a.id }; }
    else { if (pts.length < 2) { c.toast(T('Tap at least 2 points.')); return; } const ln = { id: newId(), kind: t.kind, pts, h: LINE_KINDS[t.kind][2] }; yd.lines.push(ln); st.pick = { type: 'line', id: ln.id }; }
    c.S.tool = null; clearPreview(); c.saveYard(yd);
  }
  function toolClick(e, t) {
    const c = C();
    if (t.type === 'od-area' || t.type === 'od-line') {
      const g = ground(e); if (!g) return; const p = [snap(g.x), snap(g.z)];
      const px = (q) => { const v = new V3(q[0], c.groundY(), q[1]).project(c.camera), r = c.canvas.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top]; };
      const near = (q) => { const [x, y] = px(q); return Math.hypot(x - e.clientX, y - e.clientY) < 22; };
      if (t.type === 'od-area' && t.shape === 'rect') { if (!t.pts.length) t.pts.push(p); else { const r = rectPts(t.pts[0], p); if (!r) { c.toast(T('Make it a little bigger.')); return; } t.pts = r; finishShape(); return; } }
      else if (t.type === 'od-area' && t.pts.length >= 3 && (near(t.pts[0]) || closesAt(t.pts, p, 0.2))) { finishShape(); return; }
      else if (t.type === 'od-line' && t.pts.length >= 2 && near(t.pts[t.pts.length - 1])) { finishShape(); return; }
      else if (t.pts.length < 200) t.pts.push(p);
      drawPreview(); c.editor(); return;
    }
    if (t.type === 'od-place') { place(e, t); return; }
    if (t.type === 'od-wall') { const fh = floorHit(e); if (!fh?.wall) { c.toast(T('Tap a wall.')); return; } enterWall(fh); }
  }
  function place(e, t) {
    const c = C(), kind = t.kind, [, d, h] = sizeOf({ kind }), outside = ['bin', 'mailbox', 'planter'].includes(kind) || (kind === 'awning' && t.style === 'pergola');
    const it = { id: newId(), kind, floor: null, pos: [0, 0], rot: 0, y: 0, ...(kind === 'awning' ? { style: t.style || 'arm' } : {}), ...(kind === 'bin' ? { icon: 'trash' } : {}), ...(kind === 'mailbox' ? { mail: true } : {}) };
    const faceCam = (x, z) => { const cp = c.camera.position; return Math.round(Math.atan2(cp.x - x, cp.z - z) * 12 / Math.PI) * 15; };
    if (outside) { const g = ground(e); if (!g) return; it.pos = [snap(g.x), snap(g.z)]; it.rot = faceCam(g.x, g.z); }
    else {
      const fh = floorHit(e);
      if (!fh) { c.toast(kind === 'awning' ? T('Tap the wall it hangs on.') : T('Tap a floor of the house.')); return; }
      const { F, local, n, wall } = fh; it.floor = F.f.id;
      if (kind === 'awning' && !wall) { c.toast(T('Tap the wall it hangs on.')); return; }
      if (wall) {
        const nl = new V3(n.x, 0, n.z).normalize(), back = kind === 'awning' || kind === 'led' ? 0.005 : d / 2 + 0.01;
        it.pos = [r2v(local.x + nl.x * back), r2v(local.z + nl.z * back)]; it.rot = Math.round(Math.atan2(nl.x, nl.z) * 180 / Math.PI);
        const up = local.y - F.floorY; if (kind === 'awning' || kind === 'led') it.y = r2v(Math.max(0.05, up)); else if (kind === 'tv' || kind === 'shelves') it.y = r2v(Math.max(0, up - h / 2));
      } else { const wp = F.G.localToWorld(local.clone()); it.pos = [snap(local.x), snap(local.z)]; it.rot = kind === 'rug' ? 0 : faceCam(wp.x, wp.z); }
    }
    const list = listCopy(); list.push(it); st.sel = new Set([it.id]); c.S.tool = t.again ? t : null; saveItems(list);
  }

  /* ---------- corners of a drawn area or line: drag them, add one in the middle of a side, double-tap to remove ---------- */
  function picked() { const y = C().S.plan?.yard || {}; return st.pick?.type === 'area' ? (y.areas || []).find((a) => a.id === st.pick.id) : st.pick?.type === 'line' ? (y.lines || []).find((l) => l.id === st.pick.id) : null; }
  const HM = { c: null, m: null };
  function showHandles(pts) {
    handles.children.slice().forEach((o) => { handles.remove(o); o.geometry.dispose(); });
    const s = picked(); if (!s || !onTab() || C().S.tab !== 'yard') { C().kick(); return; }
    pts ||= s.pts; const closed = st.pick.type === 'area', y = C().groundY() + 0.08, k = Math.max(0.6, Math.min(2.4, C().camera.position.distanceTo(C().controls.target) / 22));
    HM.c ||= new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }); HM.m ||= new THREE.MeshBasicMaterial({ color: '#5eb8ff', depthTest: false });
    pts.forEach(([x, z], i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.13 * k, 14, 10), HM.c); m.position.set(x, y, z); m.renderOrder = 64; m.userData.h = { kind: 'corner', i }; handles.add(m); });
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const p = pts[i], q = pts[(i + 1) % pts.length], m = new THREE.Mesh(new THREE.SphereGeometry(0.08 * k, 10, 8), HM.m); m.position.set((p[0] + q[0]) / 2, y, (p[1] + q[1]) / 2); m.renderOrder = 64; m.userData.h = { kind: 'mid', i }; handles.add(m); }
    const v = pts.map(([x, z]) => new V3(x, y - 0.02, z)); if (closed) v.push(v[0]);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: '#fbbf24', depthTest: false })); l.renderOrder = 63; l.raycast = () => {}; handles.add(l);
    C().kick();
  }
  function pickHandle(e) { if (!handles.children.length) return null; const h = rayAt(e.clientX, e.clientY).intersectObjects(handles.children.filter((o) => o.isMesh), false)[0]; return h ? h.object.userData.h : null; }
  function dragHandle(e, hd) {
    const c = C(), s = picked(); if (!s) return; const closed = st.pick.type === 'area', min = closed ? 3 : 2;
    let pts = s.pts.map((p) => [...p]), idx = hd.i; const now = performance.now();
    if (hd.kind === 'corner' && st.lastTap?.i === hd.i && now - st.lastTap.t < 380) { st.lastTap = null; if (pts.length > min) { pts.splice(idx, 1); savePts(pts); } else c.toast(T('It needs at least {n} corners.', { n: min })); return; }
    st.lastTap = hd.kind === 'corner' ? { i: hd.i, t: now } : null;
    if (hd.kind === 'mid') { pts = insertCorner(pts, hd.i); idx = hd.i + 1; }
    let moved = hd.kind === 'mid'; const x0 = e.clientX, y0 = e.clientY;
    c.controls.enabled = false;
    const move = (ev) => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; moved = true; const g = ground(ev); if (!g) return; pts[idx] = [snap(g.x, ev.altKey ? 0.01 : 0.05), snap(g.z, ev.altKey ? 0.01 : 0.05)]; showHandles(pts); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); c.controls.enabled = true; if (moved) { st.dragged = true; setTimeout(() => { st.dragged = false; }, 0); savePts(pts); } };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  function savePts(pts) { const c = C(), yd = c.yardData(), list = st.pick.type === 'area' ? yd.areas : (yd.lines ||= []), s = list.find((x) => x.id === st.pick.id); if (!s) return; s.pts = cleanPoly(pts, st.pick.type === 'area'); c.saveYard(yd); }

  /* ---------- box select ---------- */
  function startBox(e) {
    const c = C(), x0 = e.clientX, y0 = e.clientY, box = el('div', { class: 'odbox' }); document.body.append(box); c.controls.enabled = false;
    const set = (ev) => { const x = Math.min(x0, ev.clientX), y = Math.min(y0, ev.clientY); Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(ev.clientX - x0)}px`, height: `${Math.abs(ev.clientY - y0)}px` }); };
    const up = (ev) => {
      removeEventListener('pointermove', set); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); box.remove(); c.controls.enabled = true;
      const x1 = Math.min(x0, ev.clientX), x2 = Math.max(x0, ev.clientX), y1 = Math.min(y0, ev.clientY), y2 = Math.max(y0, ev.clientY), r = c.canvas.getBoundingClientRect(), cur = c.curF();
      if (!ev.shiftKey) st.sel.clear();
      for (const b of built.values()) { if (!shown(b.o) || (cur && b.it.floor && b.it.floor !== cur.f.id)) continue; const v = b.o.getWorldPosition(new V3()).project(c.camera); const sx = (v.x + 1) / 2 * r.width + r.left, sy = (1 - v.y) / 2 * r.height + r.top; if (v.z < 1 && sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) st.sel.add(b.it.id); }
      c.S.tool = null; st.dragged = true; setTimeout(() => { st.dragged = false; }, 0); drawSel(); c.editor();
      if (st.sel.size) c.toast(T('{n} selected - drag one to move them all.', { n: st.sel.size }));
    };
    addEventListener('pointermove', set); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  /* ---------- wall view: one wall straight on, with its measurements ---------- */
  function enterWall(fh) {
    const c = C(), { F, h } = fh, n = fh.n.clone().setY(0).normalize(), cam = c.camera;
    if (n.dot(cam.position.clone().sub(h.point)) < 0) n.negate();
    const t = new V3(n.z, 0, -n.x), p = h.point.clone(), base = F.G.position.y + F.floorY, top = base + Math.max(2, (F.f.heightM || 2.8) - 0.1);
    /* this room's stretch of the wall: look along it both ways from where you tapped, and across the room for its depth */
    const walls = F.wallMeshes.filter((m) => m.visible && m.userData.cat !== 'opening'), o = p.clone().addScaledVector(n, 0.25).setY(base + 1.2), far = (dir, dflt) => { wr.set(o, dir); const x = walls.length ? wr.intersectObjects(walls, false)[0] : null; return x ? x.distance : dflt; };
    wr.far = 14; let a = -far(t.clone().negate(), 3), b = far(t, 3); const depth = far(n, 6) + 0.25; wr.far = 6;
    if (b - a < 0.6) { a = -2; b = 2; }
    const mid = p.clone().addScaledVector(t, (a + b) / 2); mid.y = base + (top - base) / 2;
    const tan = Math.tan(deg(cam.fov / 2)), dist = Math.max(2.2, ((b - a) / 2 + 0.6) / (tan * Math.max(0.3, cam.aspect)), ((top - base) / 2 + 0.6) / tan);
    if (!st.prevCam) st.prevCam = { pos: cam.position.clone(), target: c.controls.target.clone(), near: cam.near };
    c.S.tool = { type: 'od-wallview', floor: F.f.id, p, n, t, a, b, base, top, depth };
    c.controls.enableRotate = false; c.flyTo(mid, mid.clone().addScaledVector(n, dist));
    drawWall(); c.editor();
  }
  /* In the wall view, whatever stands between you and the room (the wall across from it, the next room) is cut away. */
  function wallNear() {
    const c = C(), W = c.S.tool, cam = c.camera; if (W?.type !== 'od-wallview') return;
    const dw = (cam.position.x - W.p.x) * W.n.x + (cam.position.z - W.p.z) * W.n.z, near = Math.max(0.1, Math.min(dw - W.depth + 0.15, dw - 0.6));
    if (Math.abs(cam.near - near) > 0.01) { cam.near = near; cam.updateProjectionMatrix(); c.kick(); }
  }
  function restoreNear() { const c = C(); if (st.prevCam?.near != null && c.camera.near !== st.prevCam.near) { c.camera.near = st.prevCam.near; c.camera.updateProjectionMatrix(); } }
  function clearWall() { wallG.children.slice().forEach((o) => { wallG.remove(o); if (o.isCSS2DObject) o.element.remove(); o.geometry?.dispose(); o.material?.dispose(); }); }
  function exitWall() { const c = C(); clearWall(); restoreNear(); c.controls.enableRotate = true; if (st.prevCam) c.flyTo(st.prevCam.target, st.prevCam.pos); st.prevCam = null; if (c.S.tool?.type === 'od-wallview') c.S.tool = null; c.editor(); c.kick(); }
  function drawWall(live) {
    clearWall(); const c = C(), W = c.S.tool; if (W?.type !== 'od-wallview') return;
    const segs = [], lab = (txt, at) => { const l = new CSS2DObject(el('div', { class: 'oddim' }, txt)); l.position.copy(at); wallG.add(l); };
    const at = (s, y) => W.p.clone().addScaledVector(W.t, s).addScaledVector(W.n, 0.03).setY(y);
    const line = (s1, y1, s2, y2) => { segs.push(at(s1, y1), at(s2, y2)); };
    const yT = W.top + 0.12; line(W.a, yT, W.b, yT); line(W.a, yT - 0.08, W.a, yT + 0.08); line(W.b, yT - 0.08, W.b, yT + 0.08); lab(fmt(W.b - W.a), at((W.a + W.b) / 2, yT + 0.12));
    const list = [];
    for (const bl of built.values()) {
      const it = bl.it; if (it.floor !== W.floor) continue;
      const [, d, h] = sizeOf(it), o = bl.o, cw = o.getWorldPosition(new V3()), off = (cw.x - W.p.x) * W.n.x + (cw.z - W.p.z) * W.n.z; if (off < -0.2 || off > d / 2 + 0.5) continue;
      const F = c.S.F[it.floor], fp = footprint({ ...it, pos: [o.position.x, o.position.z] }).map((q) => F.G.localToWorld(new V3(q[0], 0, q[1]))).map((q) => (q.x - W.p.x) * W.t.x + (q.z - W.p.z) * W.t.z);
      const lo = Math.min(...fp), hi = Math.max(...fp); if (hi < W.a - 0.05 || lo > W.b + 0.05) continue;
      list.push({ lo: Math.max(lo, W.a), hi: Math.min(hi, W.b), y0: W.base + o.position.y, y1: W.base + o.position.y + h });
    }
    list.sort((x, y) => x.lo - y.lo);
    /* one row of chained measurements above the pieces: gap, piece, gap, piece... to the end of the wall */
    const rowY = Math.min(W.top - 0.12, Math.max(W.base + 0.6, ...list.map((x) => x.y1)) + 0.22); let prev = W.a;
    for (const x of list) {
      if (x.lo - prev > 0.03) { line(prev, rowY, x.lo, rowY); lab(fmt(x.lo - prev), at((prev + x.lo) / 2, rowY + 0.09)); }
      line(x.lo, rowY, x.hi, rowY); line(x.lo, rowY - 0.05, x.lo, rowY + 0.05); line(x.hi, rowY - 0.05, x.hi, rowY + 0.05); lab(fmt(x.hi - x.lo), at((x.lo + x.hi) / 2, rowY - 0.1));
      if (x.y0 > W.base + 0.02) { line((x.lo + x.hi) / 2, W.base, (x.lo + x.hi) / 2, x.y0); lab(fmt(x.y0 - W.base), at((x.lo + x.hi) / 2 + 0.06, (W.base + x.y0) / 2)); }
      prev = Math.max(prev, x.hi);
    }
    if (list.length && W.b - prev > 0.03) { line(prev, rowY, W.b, rowY); lab(fmt(W.b - prev), at((prev + W.b) / 2, rowY + 0.09)); }
    const g = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color: '#fbbf24', depthTest: false })); g.renderOrder = 62; g.raycast = () => {}; wallG.add(g);
    if (!live) C().kick();
  }

  /* ---------- furnish a room ---------- */
  const ROOM_TYPES = [['living', 'Living room'], ['bedroom', 'Bedroom'], ['kids', 'Kids\' room'], ['kitchen', 'Kitchen'], ['dining', 'Dining room'], ['office', 'Office'], ['bathroom', 'Bathroom'], ['laundry', 'Laundry']];
  const guessType = (name) => { const n = String(name || '').toLowerCase(); return /kitchen/.test(n) ? 'kitchen' : /kid|nursery|child/.test(n) ? 'kids' : /bed|master|guest|sleep/.test(n) ? 'bedroom' : /bath|wc|toilet|shower|powder/.test(n) ? 'bathroom' : /office|study|den|work/.test(n) ? 'office' : /dining/.test(n) ? 'dining' : /laundry|utility|wash/.test(n) ? 'laundry' : 'living'; };
  /* The room's walls, found by looking out from its middle in four directions (works for scans and drawn floors). */
  function roomFrame(F, i) {
    const r = F.rooms[i], [x, z] = r.pos, c = F.G.localToWorld(new V3(x, F.floorY + 1.0, z)), walls = F.wallMeshes.filter((m) => m.visible && m.userData.cat !== 'opening'), d = {};
    wr.far = 9; for (const [k, dx, dz] of [['px', 1, 0], ['nx', -1, 0], ['pz', 0, 1], ['nz', 0, -1]]) {
      wr.set(c, new V3(dx, 0, dz)); const h = walls.length ? wr.intersectObjects(walls, false)[0] : null; let lim = h ? h.distance - 0.07 : 2;
      for (const [j, q] of F.rooms.entries()) { if (j === i) continue; const ax = (q.pos[0] - x) * dx + (q.pos[1] - z) * dz, side = Math.abs((q.pos[0] - x) * dz + (q.pos[1] - z) * dx); if (ax > 0.5 && side < ax) lim = Math.min(lim, ax / 2); }   // a doorway: stop halfway to the next room
      d[k] = Math.max(0.9, lim);
    } wr.far = 6;
    return { x0: x - d.nx, x1: x + d.px, z0: z - d.nz, z1: z + d.pz };
  }
  function layoutFor(type, fr) {
    const W = fr.x1 - fr.x0, D = fr.z1 - fr.z0, cx = (fr.x0 + fr.x1) / 2, cz = (fr.z0 + fr.z1) / 2, out = [], add = (kind, x, z, rot = 0, more = {}) => out.push({ kind, pos: [r2v(x), r2v(z)], rot, ...more });
    const S = (k) => FURN[k][2];
    if (type === 'living') {
      const sw = Math.min(2.2, Math.max(1.4, W - 1.0)); add('sofa', cx, fr.z0 + S('sofa')[1] / 2 + 0.05, 0, { w: r2v(sw) });
      if (D > 3) { add('rug', cx, fr.z0 + 1.55, 0, { w: r2v(Math.min(2.6, W - 0.8)), d: r2v(Math.min(1.8, D - 2.2)) }); add('coffeetable', cx, fr.z0 + 1.5); }
      add('tvstand', cx, fr.z1 - 0.24, 180, { w: r2v(Math.min(1.8, W - 1.2)) }); add('tv', cx, fr.z1 - 0.24, 180, { y: 0.48 });
      if (W > 3.2) add('armchair', fr.x0 + 0.55, cz + 0.3, 90); add('lamp', fr.x0 + 0.3, fr.z0 + 0.3); add('pot', fr.x1 - 0.35, fr.z0 + 0.35);
    } else if (type === 'bedroom') {
      const bw = W < 2.8 ? 1.4 : 1.66; add('bed2', cx, fr.z0 + 1.08, 0, { w: bw });
      for (const s of [-1, 1]) if (W > bw + 1.0) add('nightstand', cx + s * (bw / 2 + 0.3), fr.z0 + 0.22);
      if (D > 3.4) add('rug', cx, fr.z0 + 1.6, 0, { w: r2v(Math.min(2.6, W - 0.6)), d: 1.8 });
      if (W > 3.0 && D > 3.2) add('wardrobe', fr.x1 - 0.32, fr.z1 - 0.7, -90, { w: r2v(Math.min(1.6, D - 2.4)) });
      add('pot', fr.x0 + 0.35, fr.z1 - 0.35);
    } else if (type === 'kids') {
      add('bed1', fr.x0 + 0.52, fr.z0 + 1.05); if (W > 2.4) add('nightstand', fr.x0 + 1.32, fr.z0 + 0.22);
      add('desk', fr.x1 - 0.72, fr.z1 - 0.37, 180, { w: 1.2 }); add('ochair', fr.x1 - 0.72, fr.z1 - 1.05);
      if (D > 2.8) add('shelves', fr.x1 - 0.2, fr.z0 + 0.6, -90); if (W > 2.6 && D > 2.6) add('rug', cx, cz, 0, { w: 1.6, d: 1.1 });
    } else if (type === 'kitchen') {
      const L = Math.min(W - 0.06, 5); let run = [['fridge', 0.7], ['counter', 0], ['oven', 0.6], ['counter', 0], ['sink', 0.8], ['dishwasher', 0.6]];
      let fixed = run.reduce((s, [, w]) => s + w, 0); if (L - fixed < 0.6) { run = run.filter(([k]) => k !== 'dishwasher'); fixed -= 0.6; } if (L - fixed < 0.5) { run = run.filter(([k]) => k !== 'fridge'); fixed -= 0.7; }
      const rest = Math.max(0, L - fixed), fills = [rest * 0.4, rest * 0.6]; let x = fr.x0 + 0.03, fi = 0; const grp = newId();
      for (const [k, w0] of run) { const w = w0 || fills[fi++]; if (w < 0.3) continue; add(k, x + w / 2, fr.z0 + FURN[k][2][1] / 2 + 0.02, 0, { ...(k === 'counter' ? { w: r2v(w) } : {}), grp }); x += w; }
      if (W >= 3.4 && D >= 3.8) add('island', cx, fr.z0 + 2.2, 0, { w: r2v(Math.min(2.2, W - 1.8)) });
      else if (D >= 3.0) { add('dtable', cx, fr.z1 - 1.0, 0, { w: 1.2, d: 0.8 }); for (const s of [-1, 1]) add('chair', cx + s * 0.3, fr.z1 - 1.0 + s * 0.6, s > 0 ? 180 : 0); }
    } else if (type === 'dining') {
      const tw = r2v(Math.min(2.2, Math.max(1.0, W - 1.8))); add('rug', cx, cz, 0, { w: r2v(Math.min(W - 0.4, tw + 1.4)), d: r2v(Math.min(D - 0.4, 2.6)) }); add('dtable', cx, cz, 0, { w: tw });
      const n = Math.max(1, Math.floor(tw / 0.62)); for (let i = 0; i < n; i++) { const x = cx - tw / 2 + tw / n * (i + 0.5); add('chair', x, cz + 0.68, 180); add('chair', x, cz - 0.68, 0); }
      if (W - tw > 1.8) { add('chair', cx - tw / 2 - 0.32, cz, 90); add('chair', cx + tw / 2 + 0.32, cz, -90); }
      add('pot', fr.x1 - 0.35, fr.z0 + 0.35);
    } else if (type === 'office') {
      add('desk', cx, fr.z0 + 0.37, 0); add('ochair', cx, fr.z0 + 1.05, 180); if (W > 2.6) add('shelves', fr.x1 - 0.2, cz, -90); add('pot', fr.x0 + 0.35, fr.z1 - 0.35); add('lamp', fr.x0 + 0.3, fr.z0 + 0.3);
    } else if (type === 'bathroom') {
      if (W * D >= 5.5) add('bath', fr.x1 - 0.4, fr.z0 + 0.87); else add('shower', fr.x1 - 0.47, fr.z0 + 0.47);
      add('toilet', fr.x0 + 0.42, fr.z0 + 0.36); if (W > 2.3) add('sink', fr.x0 + 1.2, fr.z0 + 0.33, 0, { w: 0.7 }); else add('sink', cx, fr.z1 - 0.33, 180, { w: 0.6 });
    } else if (type === 'laundry') {
      add('washer', fr.x0 + 0.33, fr.z0 + 0.32); add('dryer', fr.x0 + 0.95, fr.z0 + 0.32); if (W > 2.3) add('counter', fr.x0 + 1.65, fr.z0 + 0.33, 0, { w: 0.8 }); if (D > 2.2) add('shelves', cx, fr.z1 - 0.2, 180);
    }
    return out;
  }
  function furnish(F, i, type) {
    const c = C(), fr = roomFrame(F, i), list = listCopy(); st.sel.clear();
    for (const x of layoutFor(type, fr)) { const it = { id: newId(), floor: F.f.id, y: 0, ...x }; list.push(it); st.sel.add(it.id); }
    saveItems(list); c.toast(T('{room} is furnished. Drag pieces to where they really are.', { room: F.rooms[i]?.name || T('The room') }));
  }

  /* ---------- the household card (in the 3D view: tap a bin, the mailbox, a plant or the washer) ---------- */
  function closeCard() { card?.remove(); card = null; }
  function openCard(e, b) {
    closeCard(); const it = itemOf(b.it.id), hh = st.hh; if (!it || !hh) return false;
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => { if (!r.ok) throw new Error(r.status === 403 ? T('Ask someone in the household with more access.') : T('That didn\'t work - try again.')); st.hhAt = 0; closeCard(); live(); }).catch((x) => C().toast(x.message));
    const btn = (label, fn) => el('button', { type: 'button', class: 'mini', onclick: fn }, label);
    let body = null;
    if (it.kind === 'bin' && it.binId) { const x = (hh.bins || []).find((q) => q.id === it.binId); if (!x) return false; body = [el('b', {}, x.name), el('small', {}, x.out ? T('It\'s out.') : x.state === 'tonight' ? T('Put it out tonight.') : x.state === 'tomorrow' ? T('Goes out tomorrow night.') : x.next ? T('Next pickup {date}', { date: new Date(`${x.next}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }) : ''), x.state === 'tonight' || x.state === 'today' ? el('div', { class: 'row' }, btn(x.out ? T('Not out yet') : T('It\'s out'), () => post(`/api/household/bins/${encodeURIComponent(x.id)}/out`, { out: !x.out }))) : null]; }
    else if (it.kind === 'mailbox' && it.mail && hh.mail) { const p = hh.mail.state === 'post'; body = [el('b', {}, T('Mailbox')), el('small', {}, p ? T('Mail\'s here.') : T('No new mail.')), p ? el('div', { class: 'row' }, btn(T('Got it'), () => post('/api/household/mail/collected'))) : null]; }
    else if ((it.kind === 'pot' || it.kind === 'planter') && it.plantId) { const p = (hh.plants || []).find((q) => q.id === it.plantId); if (!p) return false; const dry = p.thirsty && !p.watered; body = [el('b', {}, p.name), el('small', {}, `${dry ? T('Thirsty') : T('Fine')}${p.moisture != null ? ` · ${Math.round(p.moisture)}%` : ''}`), dry ? el('div', { class: 'row' }, btn(T('Watered'), () => post('/api/household/plants/watered'))) : null]; }
    else if (it.laundryId) { const a = (hh.laundry || []).find((q) => q.id === it.laundryId); if (!a) return false; body = [el('b', {}, a.name), el('small', {}, a.phase === 'running' ? (a.remainingMin != null ? T('{n} min left', { n: a.remainingMin }) : T('Running')) : a.phase === 'done' ? T('Done') : T('Not running')), a.phase === 'done' ? el('div', { class: 'row' }, btn(T('Emptied'), () => post(`/api/household/laundry/${encodeURIComponent(a.id)}/emptied`))) : null]; }
    if (!body) return false;
    card = el('div', { class: 'odcard', role: 'dialog', style: `left:${e.clientX}px;top:${e.clientY}px` }, ...body); document.body.append(card);
    const r = card.getBoundingClientRect(), x = Math.max(r.width / 2 + 8, Math.min(innerWidth - r.width / 2 - 8, e.clientX));   // keep it on the screen
    card.style.left = `${x}px`; if (r.top < 8) card.style.transform = 'translate(-50%, 16px)';
    return true;
  }

  /* ---------- pointer and keys (taken before the main 3D page sees them, only when they're ours) ---------- */
  if (typeof window !== 'undefined') {
    addEventListener('pointerdown', (e) => {
      const c = C(); if (card && !card.contains(e.target)) closeCard();
      if (e.target !== c.canvas) return; st.down = [e.clientX, e.clientY];
      if (e.button !== 0 || !onTab()) return;
      const t = c.S.tool;
      if (t?.type === 'od-box') { e.stopImmediatePropagation(); startBox(e); return; }
      if (t && t.type !== 'od-wallview') return;   // tap tools arrive as clicks; someone else's tool: theirs
      const hd = c.S.tab === 'yard' && !t ? pickHandle(e) : null; if (hd) { e.stopImmediatePropagation(); dragHandle(e, hd); return; }
      const hit = pickItem(e); if (hit) { e.stopImmediatePropagation(); pressItem(e, hit); }
    }, true);
    addEventListener('pointermove', (e) => { const t = C0 && C().S.tool; if (!t || !/^od-(area|line)$/.test(t.type) || !t.pts.length || e.target !== C().canvas) return; const g = ground(e); if (g) drawPreview(g); });
    addEventListener('click', (e) => {
      if (!C0) return; const c = C(); if (e.target !== c.canvas) return;
      if (st.dragged || (st.down && Math.hypot(e.clientX - st.down[0], e.clientY - st.down[1]) > 6)) { if (st.dragged) e.stopImmediatePropagation(); return; }
      if (c.S.mode === 'view') { const b = pickItem(e); if (b && openCard(e, b)) e.stopImmediatePropagation(); return; }
      if (!onTab()) return;
      const t = c.S.tool;
      if (t?.type?.startsWith('od-')) { if (t.type !== 'od-wallview') { e.stopImmediatePropagation(); toolClick(e, t); } return; }
      if (t) return;
      if (pickItem(e)) { e.stopImmediatePropagation(); return; }
      if (c.S.tab === 'yard') { const a = pickArea(e); if (a) { st.pick = a; st.sel.clear(); drawSel(); showHandles(); c.editor(); e.stopImmediatePropagation(); return; } }
      if (st.sel.size || st.pick) { st.sel.clear(); st.pick = null; drawSel(); showHandles(); c.editor(); }
    }, true);
    addEventListener('keydown', (e) => {
      if (!C0 || !onTab() || typing()) return; const c = C(), t = c.S.tool, k = e.key, mod = e.ctrlKey || e.metaKey;
      if (t && /^od-(area|line)$/.test(t.type)) {
        if (k === 'Enter') { e.preventDefault(); finishShape(); } else if (k === 'Escape') { c.S.tool = null; clearPreview(); c.editor(); } else if (k === 'Backspace') { e.preventDefault(); t.pts.pop(); drawPreview(); c.editor(); }
        return;
      }
      if (k === 'Escape') { if (t?.type === 'od-wallview') exitWall(); else if (t?.type?.startsWith('od-')) { c.S.tool = null; c.editor(); } else if (st.sel.size || st.pick) { st.sel.clear(); st.pick = null; drawSel(); showHandles(); c.editor(); } return; }
      if (mod && k.toLowerCase() === 'v') { e.preventDefault(); paste(); return; }
      if (!st.sel.size && st.pick && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); const y = c.yardData(); if (st.pick.type === 'line') y.lines = (y.lines || []).filter((q) => q.id !== st.pick.id); else y.areas = y.areas.filter((q) => q.id !== st.pick.id); st.pick = null; showHandles(); c.saveYard(y); return; }
      if (!st.sel.size) return;
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); remove(); }
      else if (mod && k.toLowerCase() === 'c') { e.preventDefault(); copy(); }
      else if (mod && k.toLowerCase() === 'd') { e.preventDefault(); paste(selected()); }
      else if (!mod && k.toLowerCase() === 'r') { e.preventDefault(); turn(e.shiftKey ? -90 : 90); }
      else if (k.startsWith('Arrow')) {
        e.preventDefault(); const s = e.altKey ? 0.01 : 0.05, f = c.camera.getWorldDirection(new V3()).setY(0).normalize(), r = new V3().crossVectors(f, new V3(0, 1, 0));
        const v = k === 'ArrowUp' ? f : k === 'ArrowDown' ? f.negate() : k === 'ArrowRight' ? r : r.negate(), dx = Math.abs(v.x) > Math.abs(v.z) ? Math.sign(v.x) * s : 0, dz = dx ? 0 : Math.sign(v.z) * s;
        for (const x of selected()) x.pos = [r2v(x.pos[0] + dx), r2v(x.pos[1] + dz)]; build(); saveSoon();
      }
    });
  }

  /* ---------- the editor panels ---------- */
  const big = (icon, label, on, onclick, sw) => el('button', { type: 'button', class: `odbig${on ? ' on' : ''}`, onclick }, sw ? el('i', { class: 'odsw', style: `--rc:${sw}` }) : null, svgIc(icon), el('span', {}, label));
  const segEl = (opts, v, pick) => el('div', { class: 'seg' }, ...opts.map(([k, n]) => el('button', { type: 'button', class: k === v ? 'on' : '', onclick: () => pick(k) }, T(n))));
  const num = (label, v, min, max, step, set) => el('span', { class: 'row' }, el('label', {}, label), el('input', { type: 'number', min, max, step, value: v, 'aria-label': label, onchange: (e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set(Math.max(min, Math.min(max, n))); } }));
  const tool = (t) => { const c = C(); c.S.tool = t; clearPreview(); c.editor(); };
  function selPanel() {
    const list = selected(), c = C(); if (!list.length) return null;
    const one = list.length === 1 ? list[0] : null, apply = (fn, quick) => { fn(); if (quick) { build(); saveSoon(); } else saveItems(items()); };
    const btn = (label, fn, title) => el('button', { type: 'button', class: 'mini', title: title || null, onclick: fn }, label);
    const hh = st.hh || {}, devs = c.S.live?.devices || [];
    const pick = (label, opts, cur, set) => el('span', { class: 'row' }, el('label', {}, label), el('select', { onchange: (e) => set(e.target.value || null) }, el('option', { value: '' }, T('Not linked')), ...opts.map(([v, n]) => el('option', { value: v, selected: v === cur ? true : null }, n))));
    const kids = [el('b', {}, one ? nameOf(one) : T('{n} pieces selected', { n: list.length }))];
    if (one) {
      const [w, d, h] = sizeOf(one), resizable = FURN[one.kind]?.[3];
      if (resizable) kids.push(el('div', { class: 'row' }, num(T('Width'), w, 0.1, 12, 0.05, (v) => apply(() => { one.w = v; })), one.kind !== 'tv' && one.kind !== 'led' ? num(T('Depth'), d, 0.1, 12, 0.05, (v) => apply(() => { one.d = v; })) : null, ['tv', 'shelves', 'wardrobe', 'planter', 'pot', 'shower', 'awning'].includes(one.kind) ? num(T('Height'), h, 0.1, 4, 0.05, (v) => apply(() => { one.h = v; })) : null));
      kids.push(el('div', { class: 'row' }, num(T('Off the floor'), one.y || 0, 0, 6, 0.05, (v) => apply(() => { one.y = v; })), COLORED.has(one.kind) && !(one.kind === 'bin' && one.binId) ? el('span', { class: 'row' }, el('label', {}, T('Color')), el('input', { type: 'color', value: one.color || '#8a96a3', oninput: (e) => apply(() => { one.color = e.target.value; }, true) })) : null));
      if (one.kind === 'awning') { kids.push(segEl(AWNINGS, one.style || 'arm', (v) => apply(() => { one.style = v; }))); kids.push(pick(T('Follows'), devs.filter((x) => x.kind === 'cover').map((x) => [x.id, x.name]), one.coverId, (v) => apply(() => { if (v) one.coverId = v; else delete one.coverId; }))); }
      if (one.kind === 'led' || one.kind === 'lamp') kids.push(pick(T('Light'), devs.filter((x) => x.kind === 'light').map((x) => [x.id, x.name]), one.deviceId, (v) => apply(() => { if (v) one.deviceId = v; else delete one.deviceId; })));
      if (one.kind === 'led') kids.push(el('span', { class: 'row' }, el('label', {}, T('Slope')), el('input', { type: 'range', min: -45, max: 45, step: 1, value: one.tilt || 0, 'aria-label': T('Slope'), oninput: (e) => apply(() => { one.tilt = Number(e.target.value); }, true) })));
      if (one.kind === 'tv') kids.push(pick(T('Plays on'), devs.filter((x) => x.kind === 'media').map((x) => [x.id, x.name]), one.deviceId, (v) => apply(() => { if (v) one.deviceId = v; else delete one.deviceId; })));
      if (one.kind === 'bin') {
        kids.push(pick(T('Household bin'), (hh.bins || []).map((x) => [x.id, x.name]), one.binId, (v) => apply(() => { if (v) { const x = (hh.bins || []).find((q) => q.id === v); one.binId = v; if (x) { one.icon = x.icon; one.color = x.color; } } else delete one.binId; })));
        if (!(hh.bins || []).length) kids.push(el('p', { class: 'note' }, T('Set up your bins in Household first - then each bin here shows "Tonight" when it goes out.')));
      }
      if (one.kind === 'mailbox') kids.push(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: one.mail ? true : null, onchange: (e) => apply(() => { if (e.target.checked) one.mail = true; else delete one.mail; }) }), T('Glows when the mail comes')));
      if (one.kind === 'pot' || one.kind === 'planter') kids.push(pick(T('Plant sensor'), (hh.plants || []).map((x) => [x.id, x.name]), one.plantId, (v) => apply(() => { if (v) one.plantId = v; else delete one.plantId; })));
      if (['washer', 'dryer', 'dishwasher'].includes(one.kind)) kids.push(pick(T('Shows'), (hh.laundry || []).map((x) => [x.id, x.name]), one.laundryId, (v) => apply(() => { if (v) one.laundryId = v; else delete one.laundryId; })));
    }
    kids.push(el('div', { class: 'row' }, btn('⟲ 15°', () => turn(-15), T('Turn left')), btn('⟳ 15°', () => turn(15), T('Turn right')), btn('⟳ 90°', () => turn(90), T('Turn a quarter (R)')),
      list.some((x) => x.floor) ? btn(T('Against the wall'), alignToWall) : null));
    kids.push(el('div', { class: 'row' }, btn(T('Copy'), copy, 'Ctrl+C'), btn(T('Duplicate'), () => paste(list), 'Ctrl+D'), list.length > 1 ? btn(T('Group'), () => group(true)) : null, list.some((x) => x.grp) ? btn(T('Ungroup'), () => group(false)) : null, btn(T('Remove'), remove, 'Delete')));   // QA: "Remove" everywhere in the editor
    return el('div', { class: 'odsel' }, ...kids);
  }
  const itemRow = (it) => el('div', { class: `odrow${st.sel.has(it.id) ? ' on' : ''}`, onclick: (e) => { if (!e.shiftKey) st.sel.clear(); selectWithGroup(it, true); drawSel(); C().editor(); } }, svgIc(it.kind), el('span', { class: 'grow' }, nameOf(it)),
    el('small', {}, it.binId ? (st.hh?.bins || []).find((b) => b.id === it.binId)?.name || '' : it.plantId ? (st.hh?.plants || []).find((b) => b.id === it.plantId)?.name || '' : it.laundryId ? (st.hh?.laundry || []).find((b) => b.id === it.laundryId)?.name || '' : it.grp ? T('in a group') : ''));
  function hint() {
    const c = C(), t = c.S.tool; if (!t?.type?.startsWith('od-')) { if (st.prevCam) { c.controls.enableRotate = true; restoreNear(); st.prevCam = null; clearWall(); } return null; }
    const cancel = el('button', { type: 'button', class: 'mini', onclick: () => { c.S.tool = null; clearPreview(); c.editor(); } }, T('Cancel'));
    if (t.type === 'od-area') {
      return el('div', { class: 'hint col' }, el('b', {}, T('Drawing: {what}', { what: T(AREA_KINDS[t.kind][0]) })), segEl([['rect', 'Rectangle'], ['free', 'Free shape']], t.shape, (v) => { t.shape = v; st.shape = v; t.pts = []; drawPreview(); c.editor(); }),
        el('p', { class: 'note' }, t.shape === 'rect' ? (t.pts.length ? T('Now tap the opposite corner.') : T('Tap one corner on the ground.')) : T('Tap the corners on the ground, one after another. Tap the first corner again (or press Enter) to finish. {n} so far.', { n: t.pts.length })),
        el('div', { class: 'row' }, t.shape === 'free' ? el('button', { type: 'button', class: 'mini primary', disabled: t.pts.length >= 3 ? null : true, onclick: finishShape }, T('Finish')) : null, el('button', { type: 'button', class: 'mini', disabled: t.pts.length ? null : true, onclick: () => { t.pts.pop(); drawPreview(); c.editor(); } }, T('Undo last corner')), cancel));
    }
    if (t.type === 'od-line') return el('div', { class: 'hint col' }, el('b', {}, T('Drawing: {what}', { what: T(LINE_KINDS[t.kind][0]) })), el('p', { class: 'note' }, T('Tap along where it runs. Tap the last point again (or press Enter) to finish. {n} so far.', { n: t.pts.length })),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', disabled: t.pts.length >= 2 ? null : true, onclick: finishShape }, T('Finish')), el('button', { type: 'button', class: 'mini', disabled: t.pts.length ? null : true, onclick: () => { t.pts.pop(); drawPreview(); c.editor(); } }, T('Undo last point')), cancel));
    if (t.type === 'od-place') return el('div', { class: 'hint' }, el('b', {}, t.kind === 'awning' ? T((AWNINGS.find(([k]) => k === (t.style || 'arm')) || AWNINGS[0])[1]) : nameOf(t)), ' ', (t.kind === 'awning' && t.style !== 'pergola') || t.kind === 'led' ? T('Tap the wall it goes on.') : OUTSIDE.has(t.kind) ? T('Tap the ground to put it there.') : T('Tap the floor to put it there - or a wall to stand it against that wall.'), cancel);
    if (t.type === 'od-box') return el('div', { class: 'hint' }, T('Drag a box around the pieces you want. Hold Shift to add to what you have.'), cancel);
    if (t.type === 'od-wall') return el('div', { class: 'hint' }, T('Tap the wall you want to see straight on.'), cancel);
    if (t.type === 'od-wallview') return el('div', { class: 'hint col' }, el('b', {}, T('Wall view · {len}', { len: fmt(t.b - t.a) })), el('p', { class: 'note' }, T('Drag pieces along the wall, or up to hang them. Zoom with the wheel or two fingers.')), selPanel(), el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: exitWall }, T('Done'))));
    return null;
  }
  function panelYard(legacy) {
    const c = C(), yd = c.S.plan?.yard || {}, sel = picked(), outside = items().filter((x) => !x.floor || OUTSIDE.has(x.kind));
    const startArea = (k) => { st.pick = null; showHandles(); tool({ type: 'od-area', kind: k, shape: st.shape, pts: [] }); };
    const areaRow = (a, isLine) => {
      const on = sel && sel.id === a.id, K = isLine ? LINE_KINDS[a.kind] : AREA_KINDS[a.kind]; if (!K) return null;
      const info = isLine ? fmt(pathLength(a.pts)) : `${Math.round(polyArea(a.pts) * 10) / 10} m²`;
      const row = el('div', { class: `odrow${on ? ' on' : ''}`, onclick: () => { st.pick = on ? null : { type: isLine ? 'line' : 'area', id: a.id }; st.sel.clear(); drawSel(); showHandles(); c.editor(); } }, svgIc(a.kind), el('span', { class: 'grow' }, T(K[0])), el('small', {}, info));
      if (!on) return row;
      const yd2 = () => c.yardData(), upd = (fn, soon) => { const y = yd2(), x = (isLine ? y.lines : y.areas).find((q) => q.id === a.id); if (!x) return; fn(x); if (soon) { c.S.plan.yard = y; c.buildYard(); c.saveYardSoon(y); } else c.saveYard(y); };
      const rng = (label, v, min, max, step, key, unit) => el('span', { class: 'row' }, el('label', {}, label), el('input', { type: 'range', min, max, step, value: v, 'aria-label': label, oninput: (e) => { e.target.nextSibling.textContent = `${e.target.value}${unit}`; upd((x) => { x[key] = Number(e.target.value); }, true); } }), el('small', {}, `${v}${unit}`));
      return el('div', {}, row, el('div', { class: 'odsel' },
        el('p', { class: 'note' }, T('Drag the white dots to move corners, a blue dot to add one; double-tap a corner to remove it.')),
        !isLine ? el('span', { class: 'row' }, el('label', {}, T('Kind')), el('select', { onchange: (e) => upd((x) => { x.kind = e.target.value; if (x.kind === 'pool') x.depth ??= 1.4; }) }, ...Object.entries(AREA_KINDS).map(([k, [n]]) => el('option', { value: k, selected: k === a.kind ? true : null }, T(n))))) : null,
        a.kind === 'pool' ? rng(T('Depth'), a.depth ?? 1.4, 0.4, 3, 0.1, 'depth', ' m') : null,
        !isLine && a.kind !== 'pool' ? rng(T('Slope up'), a.rise || 0, 0, 1.5, 0.05, 'rise', ' m') : null,
        !isLine && a.kind !== 'pool' && a.rise ? el('p', { class: 'note' }, T('The first side you drew is the low side.')) : null,
        isLine ? rng(T('Height'), a.h || LINE_KINDS[a.kind][2], 0.3, 3, 0.1, 'h', ' m') : null,
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => { const y = yd2(); if (isLine) y.lines = (y.lines || []).filter((q) => q.id !== a.id); else y.areas = y.areas.filter((q) => q.id !== a.id); st.pick = null; showHandles(); c.saveYard(y); } }, T('Remove')))));
    };
    return el('div', {},
      el('h3', {}, T('Draw on the ground')),
      el('p', { class: 'note' }, T('Pick what to draw, then tap its corners on the ground.')),
      segEl([['rect', 'Rectangle'], ['free', 'Free shape']], st.shape, (v) => { st.shape = v; c.editor(); }),
      el('div', { class: 'odgrid' }, ...Object.entries(AREA_KINDS).map(([k, [n, col]]) => big(k, T(n), false, () => startArea(k), col))),
      el('h3', {}, T('Fences and hedges')),
      el('div', { class: 'odgrid' }, ...Object.entries(LINE_KINDS).map(([k, [n, col]]) => big(k, T(n), false, () => { st.pick = null; showHandles(); tool({ type: 'od-line', kind: k, pts: [] }); }, col))),
      (yd.areas || []).length || (yd.lines || []).length ? el('div', {}, ...(yd.areas || []).map((a) => areaRow(a, false)), ...(yd.lines || []).map((l) => areaRow(l, true))) : null,
      el('h3', {}, T('Put outside')),
      el('div', { class: 'odgrid' }, big('bin', T('Bin'), false, () => tool({ type: 'od-place', kind: 'bin' })), big('mailbox', T('Mailbox'), false, () => tool({ type: 'od-place', kind: 'mailbox' })), big('planter', T('Garden pot'), false, () => tool({ type: 'od-place', kind: 'planter' })),
        ...AWNINGS.map(([s, n]) => big('awning', T(n), false, () => tool({ type: 'od-place', kind: 'awning', style: s }))), big('led', T('Strip light'), false, () => tool({ type: 'od-place', kind: 'led' }))),
      selected().some((x) => !x.floor || OUTSIDE.has(x.kind)) ? selPanel() : null,
      outside.length ? el('div', {}, ...outside.map(itemRow)) : null,
      legacy);
  }
  function panelFurniture() {
    const c = C(), F = c.edFloor(), here = items().filter((x) => x.floor && F && x.floor === F.f.id && !OUTSIDE.has(x.kind));
    const floors = Object.values(c.S.F);
    const rooms = F ? F.rooms.map((r, i) => [i, r.name || `${T('Room')} ${i + 1}`]) : [];
    st.room = Math.min(st.room ?? 0, Math.max(0, rooms.length - 1)); const rName = rooms[st.room]?.[1];
    st.rtype = st.rtypeFor === `${F?.f.id}:${st.room}` ? st.rtype : guessType(rName); st.rtypeFor = `${F?.f.id}:${st.room}`;
    return el('div', {},
      selPanel(),
      floors.length > 1 ? el('div', { class: 'row' }, el('label', {}, T('Floor')), el('select', { onchange: (e) => { c.pickFloor(e.target.value); c.editor(); } }, ...floors.map((x) => el('option', { value: x.f.id, selected: x === F ? true : null }, x.f.name)))) : null,
      rooms.length ? el('div', {}, el('h3', {}, T('Furnish a room')),
        el('div', { class: 'row' }, el('label', {}, T('Room')), el('select', { 'aria-label': T('Room'), onchange: (e) => { st.room = Number(e.target.value); c.editor(); } }, ...rooms.map(([i, n]) => el('option', { value: i, selected: i === st.room ? true : null }, n)))),   // QA: labelled (two look-alike menus before)
        el('div', { class: 'row' }, el('label', {}, T('Furnish as')), el('select', { 'aria-label': T('Furnish as'), onchange: (e) => { st.rtype = e.target.value; } }, ...ROOM_TYPES.map(([k, n]) => el('option', { value: k, selected: k === st.rtype ? true : null }, T(n))))),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => F && furnish(F, st.room, st.rtype) }, T('Furnish'))),
        el('p', { class: 'note' }, T('Lays out a starting set against the room\'s walls. Move, turn or delete anything after.'))) : el('p', { class: 'note' }, T('Name your rooms in the Rooms tab to furnish them in one tap.')),
      el('h3', {}, T('Add furniture')),
      el('div', { class: 'odcats' }, ...FURN_GROUPS.map(([k, n]) => el('button', { type: 'button', class: `mini${st.cat === k ? ' on' : ''}`, 'aria-pressed': st.cat === k ? 'true' : 'false', onclick: () => { st.cat = k; c.editor(); } }, T(n)))),
      el('div', { class: 'odgrid' }, ...Object.entries(FURN).filter(([, v]) => v[1] === st.cat).map(([k, v]) => big(k, T(v[0]), c.S.tool?.kind === k, () => tool({ type: 'od-place', kind: k })))),
      el('div', { class: 'row wrap' }, el('button', { type: 'button', class: 'mini', onclick: () => tool({ type: 'od-box' }) }, svgIc('select'), ' ', T('Select several')), el('button', { type: 'button', class: 'mini', onclick: () => tool({ type: 'od-wall' }) }, svgIc('wall'), ' ', T('Wall view')),
        st.clip.length ? el('button', { type: 'button', class: 'mini', onclick: () => paste() }, T('Paste')) : null),
      el('p', { class: 'note' }, T('Tap a piece to pick it (Shift-tap for more), drag to move. Grouped pieces move together - like a whole kitchen.')),
      here.length ? el('div', {}, el('h3', {}, T('On this floor')), ...here.map(itemRow)) : null);
  }

  /* QA: for "What can I add?" - every piece and every outdoor thing, with the tab it lives on and how to start it. */
  function catalog() {
    const grpName = (g) => (FURN_GROUPS.find(([k]) => k === g) || [])[1] || '';
    const furn = Object.entries(FURN).filter(([, v]) => v[1] !== 'outside').map(([k, v]) => ({ group: 'Furniture', tab: 'furniture', label: T(v[0]), iconFn: () => svgIc(k), words: `${grpName(v[1])} ${k} furniture`, run: () => tool({ type: 'od-place', kind: k }) }));
    const areas = Object.entries(AREA_KINDS).map(([k, [n]]) => ({ group: 'Outdoor', tab: 'yard', label: T(n), iconFn: () => svgIc(k), words: `ground area draw ${k}`, run: () => { st.pick = null; showHandles(); tool({ type: 'od-area', kind: k, shape: st.shape, pts: [] }); } }));
    const lines = Object.entries(LINE_KINDS).map(([k, [n]]) => ({ group: 'Outdoor', tab: 'yard', label: T(n), iconFn: () => svgIc(k), words: 'border boundary line', run: () => { st.pick = null; showHandles(); tool({ type: 'od-line', kind: k, pts: [] }); } }));
    const things = [['bin', 'Bin', 'trash garbage recycling compost bin day'], ['mailbox', 'Mailbox', 'post letters mail'], ['planter', 'Garden pot', 'plant flower planter'], ['led', 'Strip light', 'led light strip']]
      .map(([k, n, w]) => ({ group: 'Outdoor', tab: 'yard', label: T(n), iconFn: () => svgIc(k), words: w, run: () => tool({ type: 'od-place', kind: k }) }));
    const awn = AWNINGS.map(([sty, n]) => ({ group: 'Outdoor', tab: 'yard', label: T(n), iconFn: () => svgIc('awning'), words: 'awning shade sun blind pergola', run: () => tool({ type: 'od-place', kind: 'awning', style: sty }) }));
    return [...furn, ...areas, ...lines, ...things, ...awn];
  }

  const api = { build, sync, live, tick, moving, hint, panelYard, panelFurniture, household, devices, exitWall, batch, catalog, get selection() { return [...st.sel]; } };
  ACTIVE = api;
  return api;
}
