/* CasaTorch 3D Home - a drawn floor raised into 3D: a slab per room (any shape, with holes where stairs come up from the
   floor below), one wall per stretch of wall (rooms that share a side share one wall; outside walls thicker), cut around
   doors and windows, which are built to move (floorplan-openings.js), stairs (floorplan-stairs.js), roof windows, and the
   traced picture underneath. Meshes are named so the 3D view styles them (Wall*, Floor*, Door*, Window*, Stairs*);
   wall paint rides in userData.paint and floor materials in userData.floorTex. Also used by the editor's live preview. */
import * as THREE from 'three';
import { normalizePlan, planWalls, openingsOnWall, wallPieces, openingFrame, stairSteps, floorToWorld, worldToFloor, holesIn, roofBox, roofShape, centroid, pointInPoly, polyArea, dist } from './floorplan-geom.js';
import { buildOpening, buildSkylight } from './floorplan-openings.js';
import { buildStairs } from './floorplan-stairs.js';

export const wallHeight = (f) => Math.max(1.5, Math.min(4, (f.heightM || 2.7) - 0.1));
/* Has this floor a roof? Set per floor; when not set, only the top floor has one (as before). */
export function roofOn(f, floors = []) {
  const on = f.plan?.roof?.on; if (typeof on === 'boolean') return on;
  const used = floors.filter((x) => x.kind !== 'drawn' || x.plan?.rooms?.length || x.plan?.walls?.length);   // an empty drawn floor above doesn't count
  const top = Math.max(...used.map((x) => x.level || 0), f.level || 0); return (f.level || 0) >= top;
}
export function roofParams(f) {
  const r = f.plan?.roof || {}, p = normalizePlan(f.plan), box = roofBox(p, r.overhang ?? 0.35);
  return box && { box, type: r.type || 'gable', pitch: r.pitch, overhang: r.overhang ?? 0.35, plan: p };
}
/* The stairs on the floor below, as holes in this floor's own plan. */
export function holesFromBelow(f, floors = []) {
  const out = [];
  for (const b of floors) {
    if (b.id === f.id || b.kind !== 'drawn' || (b.level || 0) !== (f.level || 0) - 1 || !b.plan?.stairs?.length) continue;
    for (const st of b.plan.stairs) out.push(stairSteps(st, b.heightM || 2.7).outline.map((p) => worldToFloor(f, floorToWorld(b, p))));
  }
  return out;
}

/* ---------- floor materials: small pictures drawn once, repeated across the floor (one picture per meter or so) ---------- */
const MAT_SIZE = { wood: 1.2, tile: 0.6, carpet: 1, concrete: 2 };
const canvases = {};
function matCanvas(kind) {
  if (canvases[kind]) return canvases[kind];
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 'wood') {
    for (let i = 0; i < 5; i++) { const y = i * 51.2, base = [160, 112, 72].map((v) => v + (rnd() - 0.5) * 30); x.fillStyle = `rgb(${base.join(',')})`; x.fillRect(0, y, 256, 51.2);
      for (let k = 0; k < 14; k++) { x.strokeStyle = `rgba(70,40,20,${0.08 + rnd() * 0.1})`; x.beginPath(); const yy = y + rnd() * 51; x.moveTo(0, yy); x.bezierCurveTo(80, yy + rnd() * 6 - 3, 170, yy + rnd() * 6 - 3, 256, yy); x.stroke(); }
      x.fillStyle = 'rgba(40,24,12,0.55)'; x.fillRect(0, y, 256, 1.5); const j = rnd() * 256; x.fillRect(j, y, 1.5, 51.2); }
  } else if (kind === 'tile') {
    x.fillStyle = '#b9b5ae'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const v = 222 + (rnd() - 0.5) * 14; x.fillStyle = `rgb(${v},${v - 3},${v - 8})`; x.fillRect(i * 128 + 3, j * 128 + 3, 122, 122); }
  } else if (kind === 'carpet') {
    x.fillStyle = '#8c8f96'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const v = 120 + rnd() * 50; x.fillStyle = `rgba(${v},${v + 2},${v + 8},0.5)`; x.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5); }
  } else {
    x.fillStyle = '#a3a3a0'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) { const v = 130 + rnd() * 60; x.fillStyle = `rgba(${v},${v},${v - 2},0.35)`; x.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
    x.strokeStyle = 'rgba(60,60,60,0.35)'; x.strokeRect(0.5, 0.5, 255, 255);
  }
  return (canvases[kind] = c);
}
export function floorTexture(kind) {
  if (!MAT_SIZE[kind]) return null;
  const t = new THREE.CanvasTexture(matCanvas(kind)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.repeat.set(1 / MAT_SIZE[kind], 1 / MAT_SIZE[kind]); t.userData.floorMat = kind; return t;
}

/* ---------- the floor ---------- */
const key = (p) => `${Math.round(p[0] * 10)}_${Math.round(p[1] * 10)}`;
export function buildDrawnGroup(f, { floors = [] } = {}) {
  const g = new THREE.Group(), p = normalizePlan(f.plan), H = wallHeight(f), holes = holesFromBelow(f, floors);
  // slabs: one per room, any shape, holes where stairs come up
  p.rooms.forEach((r, i) => {
    const pts = r.pts; if (pts.length < 3 || Math.abs(polyArea(pts)) < 0.01) return;
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of holesIn(pts, holes)) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false }); geo.rotateX(Math.PI / 2);   // shape y -> z; the slab's top at 0
    const m = new THREE.Mesh(geo); m.name = `Floor ${r.name || i}`; m.userData.cat = 'floor'; m.userData.roomId = r.id;
    if (r.floorMat) { m.userData.floorMat = r.floorMat; m.userData.floorTex = floorTexture(r.floorMat); }
    g.add(m);
  });
  // walls, cut around their doors and windows
  const segs = planWalls(p);
  for (const s of segs) {
    const holesOn = openingsOnWall(s, p).map((h) => ({ ...h, sill: h.o.kind === 'window' ? h.o.sill : 0, height: h.o.height }));
    const pieces = wallPieces(s.len, H, holesOn), ang = -Math.atan2(s.d[1], s.d[0]), T = s.thick, two = (s.colorL || null) !== (s.colorR || null);
    const name = `Wall ${key(s.a)}-${key(s.b)}`;
    for (const pc of pieces) {
      const full = pc.y0 === 0 && pc.y1 >= H - 1e-6, ext0 = full && pc.s0 < 1e-6 ? T / 2 : 0, ext1 = full && pc.s1 > s.len - 1e-6 ? T / 2 : 0;   // the corners filled in
      const len = pc.s1 - pc.s0 + ext0 + ext1, mid = (pc.s0 - ext0 + pc.s1 + ext1) / 2, cx = s.a[0] + s.d[0] * mid, cz = s.a[1] + s.d[1] * mid, h = pc.y1 - pc.y0;
      const add = (thick, off, color, side) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, thick)); m.position.set(cx + s.n[0] * off, pc.y0 + h / 2, cz + s.n[1] * off); m.rotation.y = ang;
        m.name = side ? `${name} ${side}` : name; m.userData.cat = 'wall'; if (color) m.userData.paint = color; g.add(m);
      };
      if (two) { add(T / 2, T / 4, s.colorL, 'a'); add(T / 2, -T / 4, s.colorR, 'b'); } else add(T, 0, s.colorL, null);
    }
  }
  // the doors and windows themselves
  const thickAt = (c) => { let best = p.thickInt, bd = Infinity; for (const s of segs) { const t = Math.max(0, Math.min(s.len, (c[0] - s.a[0]) * s.d[0] + (c[1] - s.a[1]) * s.d[1])), d = Math.hypot(s.a[0] + s.d[0] * t - c[0], s.a[1] + s.d[1] * t - c[1]); if (d < bd) { bd = d; best = s.thick; } } return best; };
  const hasRoof = roofOn(f, floors);
  for (const o of p.openings) {
    if (o.kind === 'skylight') { if (!hasRoof) { const s = buildSkylightFor(f, o, null); if (s) g.add(s); } continue; }   // under a roof they sit in the roof (buildPlanRoof)
    const fr = openingFrame(p, o); if (!fr) continue;
    const w = fr.t1 - fr.t0; if (w < 0.2) continue;
    // which side is "in": toward the room the opening belongs to (or the wall's left for a wall on its own)
    const nrm = [-fr.dir[1], fr.dir[0]], room = o.room ? p.rooms.find((r) => r.id === o.room) : null;
    let inSign = 1;
    if (room) { const probe = [fr.c[0] + nrm[0] * 0.2, fr.c[1] + nrm[1] * 0.2]; inSign = pointInPoly(probe, room.pts) ? 1 : -1; }
    const og = buildOpening(o, { width: w, thick: thickAt(fr.c), inSign });   // after the turn below, the group's +z is nrm
    og.position.set(fr.c[0], 0, fr.c[1]); og.rotation.y = -Math.atan2(fr.dir[1], fr.dir[0]);
    g.add(og);
  }
  // stairs up to the next floor
  for (const st of p.stairs) g.add(buildStairs(st, f.heightM || 2.7));
  return g;
}
/* A roof window: on the roof's slope (roof: roofParams(f)), or flat at ceiling height when the floor has no roof. */
export function buildSkylightFor(f, o, roof) {
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  const H = wallHeight(f); let at = { x: o.x, y: H, z: o.y }, down = [0, 1], tilt = 0;
  if (roof) { const rs = roofShape(roof.box, H + 0.02, roof.type, roof.pitch), sl = rs.slopeAt(o.x, o.y); at.y = roof.type === 'flat' ? H + 0.02 + 0.15 : sl.y; if (sl.tilt) { down = [sl.nx, sl.nz]; tilt = sl.tilt; } }
  const g = buildSkylight(o, at, down, tilt); if (o.rot) g.rotateOnAxis(new THREE.Vector3(0, 1, 0), (o.rot * Math.PI) / 180); return g;
}
/* The room centres (for labels and devices). */
export const roomCentres = (f) => normalizePlan(f.plan).rooms.map((r) => ({ id: r.id, name: r.name, c: centroid(r.pts) }));
export { dist };
