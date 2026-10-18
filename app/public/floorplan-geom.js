/* CasaTorch 3D Home - the drawing's geometry, with no three.js and no page in it, so the editor, the 3D builder
   and the unit tests (test/floorplan-geom-unit.mjs) all share one copy.
   Plan units are meters on the ground: x to the right, y down the screen (y becomes z in 3D).

   A drawn floor's plan (version 2):
     rooms:    [{ id, name, pts: [[x, y], ...], floorMat?: 'wood'|'tile'|'carpet'|'concrete', wallColor?: '#hex', edgeColors?: { edgeIndex: '#hex' } }]
     walls:    [{ id, a: [x, y], b: [x, y], thick?: m, color?: '#hex' }]          (walls drawn on their own, not a room's sides)
     openings: [{ id, floorId, wall?: wallId | room?: roomId + edge: i, side: 'start'|'end', fromEdge: m, t: m, width, height, sill, kind, swing }]
     stairs:   [{ id, shape: 'straight'|'L'|'U'|'spiral', x, y, rot: deg, width, len, len2?, dia?, turn: 'left'|'right' }]
     roof:     { on?: bool (unset = only the top floor), type: 'flat'|'gable'|'hip', pitch: deg, overhang: m }
     thickExt, thickInt: wall thickness in meters; bg, bgW, bgOpacity, bgRot (deg), bgX, bgY (m): the traced picture.
   Plans saved before version 2 (rooms as x/y/w/h boxes, walls as [x1, y1, x2, y2]) are read as they are and
   converted the first time they are opened: nothing in them is dropped. */

export const PLAN_V = 2;
export const OPENING_KINDS = {
  door: { w: 0.9, h: 2.05, sill: 0, label: 'Door' },
  double: { w: 1.5, h: 2.05, sill: 0, label: 'Double door' },
  slider: { w: 1.8, h: 2.1, sill: 0, label: 'Sliding door' },
  bifold: { w: 1.6, h: 2.05, sill: 0, label: 'Bifold door' },
  garage: { w: 2.5, h: 2.15, sill: 0, label: 'Garage door' },
  window: { w: 1.2, h: 1.2, sill: 0.9, label: 'Window' },
  skylight: { w: 0.8, h: 1.2, sill: 0, label: 'Roof window' },
};
export const STAIR_SHAPES = { straight: 'Straight', L: 'L-shaped', U: 'U-shaped', spiral: 'Spiral' };
export const ROOF_TYPES = { flat: 'Flat', gable: 'Gable', hip: 'Hip' };
export const FLOOR_MATS = { wood: 'Wood', tile: 'Tile', carpet: 'Carpet', concrete: 'Concrete' };
export const WALL_COLORS = ['#f4f1ea', '#e9e1d3', '#d8d2c8', '#c9ccd1', '#a9b8a0', '#a7c4dc', '#2f4a6d', '#c87756', '#ecd27a', '#3d4249'];
export const THICK = { ext: 0.25, int: 0.12 };

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
let idSeq = 0;
export const uid = (p) => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/* ---------- small vector helpers on [x, y] ---------- */
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/* The closest point on segment a-b to p: { pt, t (0..1), d } */
export function nearestOnSeg(p, a, b) {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 < 1e-12 ? 0 : clamp(dot(sub(p, a), ab) / L2, 0, 1), pt = lerp2(a, b, t);
  return { pt, t, d: dist(p, pt) };
}
/* Where segments a-b and c-d cross: { pt, t, u } (fractions along each) or null. */
export function segCross(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? { pt: lerp2(a, b, t), t, u } : null;
}

/* ---------- polygons ---------- */
export const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
export function roomPts(r) {
  if (Array.isArray(r?.pts) && r.pts.length >= 3) return r.pts;
  return rectPts(num(r?.x, 0), num(r?.y, 0), num(r?.w, 1), num(r?.h, 1));
}
export function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function centroid(pts) {
  const A = polyArea(pts);
  if (Math.abs(A) < 1e-9) { const n = pts.length || 1; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length], f = p[0] * q[1] - q[0] * p[1]; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; }
  return [cx / (6 * A), cy / (6 * A)];
}
export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
/* A rectangle with its sides along x and y (so typing a width keeps it a rectangle). */
export function isAxisRect(pts) {
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; if (Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6) return false; }
  return true;
}
/* Grow a polygon outward by d (miter joins, capped): roof overhangs. */
export function offsetPoly(pts, d) {
  const ccw = polyArea(pts) > 0, n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p = pts[i], p1 = pts[(i + 1) % n];
    const e0 = norm(sub(p, p0)), e1 = norm(sub(p1, p));
    const n0 = ccw ? [e0[1], -e0[0]] : [-e0[1], e0[0]], n1 = ccw ? [e1[1], -e1[0]] : [-e1[1], e1[0]];   // outward normals
    let m = [n0[0] + n1[0], n0[1] + n1[1]]; const ml = Math.hypot(m[0], m[1]);
    if (ml < 1e-9) m = n0; else m = [m[0] / ml, m[1] / ml];
    const k = d / Math.max(0.35, dot(m, n0));
    out.push([p[0] + m[0] * k, p[1] + m[1] * k]);
  }
  return out;
}
const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/* ---------- reading any plan (old or new) ---------- */
export function normalizePlan(p0) {
  const p = JSON.parse(JSON.stringify(p0 || {}));
  const ids = new Set(), fresh = (pre, id) => { let v = typeof id === 'string' && id && !ids.has(id) ? id : uid(pre); while (ids.has(v)) v = uid(pre); ids.add(v); return v; };
  const roomAt = [], wallAt = [];   // list position -> id (a plan imported from a file names walls and rooms by number)
  p.rooms = (Array.isArray(p.rooms) ? p.rooms : []).map((r, i) => {
    const out = { ...r, id: fresh('r', r.id), name: String(r.name || ''), pts: roomPts(r).map((q) => [r3(num(q[0], 0)), r3(num(q[1], 0))]) };
    delete out.x; delete out.y; delete out.w; delete out.h; roomAt[i] = out.id;
    return out;
  }).filter((r) => r.pts.length >= 3);
  p.walls = (Array.isArray(p.walls) ? p.walls : []).map((w, i) => { const out = Array.isArray(w) ? { id: fresh('w'), a: [w[0], w[1]], b: [w[2], w[3]] } : { ...w, id: fresh('w', w.id), a: [...(w.a || [0, 0])], b: [...(w.b || [0, 0])] }; wallAt[i] = out.id; return out; })
    .filter((w) => [...w.a, ...w.b].every(Number.isFinite) && dist(w.a, w.b) >= 0.02);
  p.openings = (Array.isArray(p.openings) ? p.openings : []).map((o) => {
    const out = { ...OPENING_DEFAULTS(o.kind), ...o, id: fresh('o', o.id) };
    if (['in', 'out'].includes(out.swing)) { out.opens = out.swing; out.swing = 'left'; }
    if (Number.isInteger(o.wall) || Number.isInteger(o.room)) {   // imported: measured from the wall's start to the opening's middle
      if (Number.isInteger(o.wall)) out.wall = wallAt[o.wall]; else out.room = roomAt[o.room];
      const h = hostLine(p, out), mid = num(o.wall != null ? o.t ?? o.fromEdge : o.fromEdge ?? o.t, 0);
      if (h) placeOpening(out, h.len, mid - out.width / 2);
    } else if (o.side == null && o.fromEdge == null && Number.isFinite(o.t)) { out.side = 'start'; out.fromEdge = o.t; }   // only t: measured from the start
    return out;
  });   // one whose wall is gone is kept (the editor offers to remove it)
  p.stairs = (Array.isArray(p.stairs) ? p.stairs : []).map((s) => ({ shape: 'straight', rot: 0, width: 1, len: 3, turn: 'right', ...s, id: fresh('s', s.id) }));
  p.thickExt = clamp(num(p.thickExt, THICK.ext), 0.05, 0.6); p.thickInt = clamp(num(p.thickInt, THICK.int), 0.05, 0.6);
  if (p.roof && typeof p.roof !== 'object') delete p.roof;
  p.v = PLAN_V;
  return p;
}
const OPENING_DEFAULTS = (kind) => { const k = OPENING_KINDS[kind] ? kind : 'door', d = OPENING_KINDS[k]; return { kind: k, width: d.w, height: d.h, sill: d.sill, swing: 'left', side: 'start', fromEdge: 0.4 }; };
export function newOpening(kind, extra = {}) { return { ...OPENING_DEFAULTS(kind), ...extra, id: uid('o') }; }

/* ---------- the line an opening sits on ---------- */
/* ref: { wall: id } or { room: id, edge: i } -> { a, b, len } (or null when that wall or room is gone) */
export function hostLine(plan, ref) {
  if (ref.wall) { const w = plan.walls.find((x) => x.id === ref.wall); return w ? { a: w.a, b: w.b, len: dist(w.a, w.b) } : null; }
  const r = plan.rooms.find((x) => x.id === ref.room); if (!r) return null;
  const pts = r.pts, i = ref.edge | 0; if (i < 0 || i >= pts.length) return null;
  const a = pts[i], b = pts[(i + 1) % pts.length]; return { a, b, len: dist(a, b) };
}
/* Where an opening starts and ends along its wall (meters from the wall's start), kept from the edge the person measured. */
export function openingSpan(o, len) {
  const w = Math.min(o.width, len), fe = clamp(num(o.fromEdge, 0), 0, Math.max(0, len - w));
  const t0 = o.side === 'end' ? len - fe - w : fe;
  return { t0, t1: t0 + w };
}
/* Placed (or dragged) so it starts t0 from the wall's start: it is then kept measured from whichever end it is nearer. */
export function placeOpening(o, len, t0) {
  const w = Math.min(o.width, len), s = clamp(t0, 0, Math.max(0, len - w)), fromEnd = len - s - w;
  if (fromEnd < s) { o.side = 'end'; o.fromEdge = r2(fromEnd); } else { o.side = 'start'; o.fromEdge = r2(s); }
  o.t = r2(openingSpan(o, len).t0);
  return o;
}
/* Distance to each end of the wall (what the dimension labels show). */
export function openingGaps(o, len) { const { t0, t1 } = openingSpan(o, len); return { before: r2(t0), after: r2(len - t1) }; }
/* The opening's centre and direction on the plan. */
export function openingFrame(plan, o) {
  const h = hostLine(plan, o); if (!h || h.len < 1e-6) return null;
  const { t0, t1 } = openingSpan(o, h.len), dir = [(h.b[0] - h.a[0]) / h.len, (h.b[1] - h.a[1]) / h.len];
  return { a: lerp2(h.a, h.b, t0 / h.len), b: lerp2(h.a, h.b, t1 / h.len), c: lerp2(h.a, h.b, (t0 + t1) / 2 / h.len), dir, len: h.len, t0, t1, host: h };
}

/* ---------- walls: every room side and drawn wall, with shared sides merged into one ---------- */
/* Each source segment: { a, b, room?: id, edge?: i, inLeft?: bool (room is on its left), wall?: id, thick?, color?, colorL?, colorR? } */
export function sourceSegments(plan) {
  const out = [];
  for (const r of plan.rooms || []) {
    const pts = r.pts || roomPts(r), ccw = polyArea(pts) > 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]; if (dist(a, b) < 0.02) continue;
      out.push({ a, b, room: r.id, edge: i, inLeft: ccw, color: r.edgeColors?.[i] || r.wallColor || null });
    }
  }
  for (const w of plan.walls || []) if (dist(w.a, w.b) >= 0.02) out.push({ a: w.a, b: w.b, wall: w.id, thick: w.thick, color: w.color || null });
  return out;
}
const ANG_TOL = 0.01, OFF_TOL = 0.03;
/* The line a segment lies on, in one direction (angle in [0, pi)). */
function lineOf(a, b) {
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang < 0) ang += Math.PI; if (ang >= Math.PI - 1e-9) ang -= Math.PI;
  const d = [Math.cos(ang), Math.sin(ang)], n = [-d[1], d[0]];
  return { ang, d, n, off: dot(a, n) };
}
/* Merge: one wall for every stretch of line, however many rooms share it. Returns
   [{ a, b, len, ext (outside wall), thick, left, right (room ids on each side), colorL, colorR, walls: [ids], rooms: [ids] }] */
export function mergeSegments(srcs, { ext = THICK.ext, int = THICK.int } = {}) {
  const groups = [];
  for (const s of srcs) {
    const L = lineOf(s.a, s.b);
    let g = groups.find((x) => (Math.abs(x.ang - L.ang) < ANG_TOL || Math.abs(Math.abs(x.ang - L.ang) - Math.PI) < ANG_TOL) && Math.abs(x.off - dot(s.a, x.n)) < OFF_TOL);
    if (!g) { g = { ...L, items: [] }; groups.push(g); }
    let s0 = dot(s.a, g.d), s1 = dot(s.b, g.d); const fwd = s1 >= s0; if (!fwd) [s0, s1] = [s1, s0];
    g.items.push({ s0, s1, src: s, side: s.room ? ((s.inLeft ? fwd : !fwd) ? 'L' : 'R') : null });
  }
  const out = [];
  for (const g of groups) {
    const cuts = [...new Set(g.items.flatMap((i) => [r3(i.s0), r3(i.s1)]))].sort((x, y) => x - y);
    let cur = null;
    const flush = () => { if (cur) { out.push(cur); cur = null; } };
    for (let k = 0; k + 1 < cuts.length; k++) {
      const u0 = cuts[k], u1 = cuts[k + 1]; if (u1 - u0 < 1e-3) continue;
      const mid = (u0 + u1) / 2, on = g.items.filter((i) => i.s0 <= mid && i.s1 >= mid);
      if (!on.length) { flush(); continue; }
      const L = on.find((i) => i.side === 'L'), R = on.find((i) => i.side === 'R'), W = on.filter((i) => i.src.wall);
      const isExt = !!(L || R) && !(L && R) && !W.length;
      const wallColor = W.find((i) => i.src.color)?.src.color || null;
      const thick = Math.max(isExt ? ext : int, ...W.map((i) => num(i.src.thick, int)));
      const key = `${L?.src.room || ''}|${R?.src.room || ''}|${L?.src.color || ''}|${R?.src.color || ''}|${wallColor || ''}|${thick}|${W.map((i) => i.src.wall).join(',')}`;
      if (cur && cur.key === key && Math.abs(cur.u1 - u0) < 1e-6) { cur.u1 = u1; continue; }
      flush();
      cur = { key, u0, u1, d: g.d, n: g.n, off: g.off, ext: isExt, thick, left: L?.src.room || null, right: R?.src.room || null,
        colorL: L?.src.color || wallColor, colorR: R?.src.color || wallColor, walls: W.map((i) => i.src.wall), rooms: [L?.src.room, R?.src.room].filter(Boolean) };
    }
    flush();
  }
  return out.map((c) => {
    const base = [c.n[0] * c.off, c.n[1] * c.off], a = [base[0] + c.d[0] * c.u0, base[1] + c.d[1] * c.u0], b = [base[0] + c.d[0] * c.u1, base[1] + c.d[1] * c.u1];
    return { a: a.map(r3), b: b.map(r3), len: r3(c.u1 - c.u0), d: c.d, n: c.n, ext: c.ext, thick: c.thick, left: c.left, right: c.right, colorL: c.colorL, colorR: c.colorR, walls: c.walls, rooms: c.rooms };
  });
}
export const planWalls = (plan) => mergeSegments(sourceSegments(plan), { ext: plan.thickExt ?? THICK.ext, int: plan.thickInt ?? THICK.int });

/* The openings that sit on a merged wall, as [s0, s1] along it (meters from its a end), with their sill and height. */
export function openingsOnWall(seg, plan) {
  const out = [];
  for (const o of plan.openings || []) {
    if (o.kind === 'skylight') continue;
    const f = openingFrame(plan, o); if (!f) continue;
    if (Math.abs(Math.abs(dot(f.dir, seg.d)) - 1) > 0.002) continue;   // not parallel
    const off = sub(f.c, seg.a); if (Math.abs(cross(seg.d, off)) > 0.04) continue;   // not on this line
    const sc = dot(off, seg.d), half = (f.t1 - f.t0) / 2;
    if (sc < -1e-3 || sc > seg.len + 1e-3) continue;
    out.push({ o, s0: clamp(sc - half, 0, seg.len), s1: clamp(sc + half, 0, seg.len), flip: dot(f.dir, seg.d) < 0 });
  }
  return out.sort((x, y) => x.s0 - y.s0);
}
/* A wall with holes cut for its openings: boxes as { s0, s1, y0, y1 } (along the wall, and up from the floor). */
export function wallPieces(len, H, holes) {
  const out = []; let at = 0;
  for (const h of holes) {
    const s0 = Math.max(at, h.s0), s1 = Math.max(s0, h.s1);
    if (s0 - at > 0.005) out.push({ s0: at, s1: s0, y0: 0, y1: H });
    if (s1 - s0 > 0.005) {
      const sill = clamp(h.sill || 0, 0, H), top = clamp(sill + (h.height || 2), sill, H);
      if (sill > 0.005) out.push({ s0, s1, y0: 0, y1: sill });
      if (H - top > 0.005) out.push({ s0, s1, y0: top, y1: H });
    }
    at = Math.max(at, s1);
  }
  if (len - at > 0.005) out.push({ s0: at, s1: len, y0: 0, y1: H });
  return out;
}

/* ---------- problems in the drawing, each with the exact spot and a fix ---------- */
const GAP = 0.45;
/* -> [{ id, kind: 'overlap'|'gap'|'overshoot'|'rooms'|'opening', at: [x, y], len?, msg, fix }] */
export function findIssues(plan) {
  const out = [], add = (x) => { const id = `${x.kind}:${x.at.map((v) => v.toFixed(2)).join(',')}`; if (!out.some((y) => y.id === id)) out.push({ ...x, id }); };   // one marker per spot (both ends of a gap find it)
  const walls = plan.walls || [], segs = sourceSegments(plan);
  // 1. Two walls on top of each other (or a wall drawn over a room's side).
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    for (const s of segs) {
      if (s.wall === w.id || (s.wall && walls.findIndex((x) => x.id === s.wall) < i)) continue;
      const ov = overlapOf(w.a, w.b, s.a, s.b);
      if (ov && ov.len > 0.05) add({ kind: 'overlap', at: ov.mid, len: r2(ov.len), wall: w.id, other: s.wall || null, room: s.room || null, msg: 'Two walls on top of each other ({len} m)', vars: { len: r2(ov.len) }, fix: 'merge' });
    }
  }
  // 2. A wall that stops just short of another (the outline doesn't close), or runs a little past it.
  const others = (wid) => segs.filter((s) => s.wall !== wid);
  for (const w of [...walls].reverse()) {   // newest first: the wall just drawn is the one that moves
    for (const end of ['b', 'a']) {
      const p = w[end], q = end === 'a' ? w.b : w.a;
      let corner = null, edge = null;
      for (const s of others(w.id)) {
        for (const c of [s.a, s.b]) { const d = dist(p, c); if (d > 0.015 && d < GAP && (!corner || d < corner.d)) corner = { d, pt: c }; }
        const n = nearestOnSeg(p, s.a, s.b); if (n.d > 0.015 && n.d < GAP && n.t > 0.001 && n.t < 0.999 && (!edge || n.d < edge.d)) edge = { d: n.d, pt: n.pt };
      }
      const best = corner && (!edge || corner.d < edge.d + 0.1) ? corner : edge;
      const touching = others(w.id).some((s) => nearestOnSeg(p, s.a, s.b).d <= 0.015);
      if (best && !touching) add({ kind: 'gap', at: lerp2(p, best.pt, 0.5), len: r2(best.d), wall: w.id, end, to: best.pt.map(r3), msg: 'The wall stops {cm} cm short of the next one', vars: { cm: Math.round(best.d * 100) }, fix: 'join' });
      if (touching) continue;
      for (const s of others(w.id)) {   // runs past: crosses another wall with a short tail left over
        const x = segCross(q, p, s.a, s.b); if (!x || x.t < 0.02) continue;
        const tail = dist(x.pt, p); if (tail > 0.015 && tail < GAP) { add({ kind: 'overshoot', at: x.pt.map(r3), len: r2(tail), wall: w.id, end, to: x.pt.map(r3), msg: 'The wall runs {cm} cm past the next one', vars: { cm: Math.round(tail * 100) }, fix: 'trim' }); break; }
      }
    }
  }
  // 3. Rooms drawn on top of each other.
  const rooms = plan.rooms || [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const ov = roomOverlap(rooms[i].pts, rooms[j].pts);
    if (ov && ov.area > 0.04) add({ kind: 'rooms', at: ov.at, len: r2(ov.area), a: rooms[i].id, b: rooms[j].id, push: ov.push, msg: '{a} and {b} overlap ({area} m²)', vars: { a: rooms[i].name, b: rooms[j].name, area: r2(ov.area) }, fix: 'push' });
  }
  // 4. Doors and windows that don't fit their wall, or sit on top of each other.
  const byHost = new Map();
  for (const o of plan.openings || []) {
    if (o.kind === 'skylight') continue;
    const f = openingFrame(plan, o);
    if (!f) { add({ kind: 'opening', at: [0, 0], opening: o.id, msg: 'A door or window lost its wall', fix: 'remove' }); continue; }
    if (o.width > f.len + 1e-6) add({ kind: 'opening', at: f.c.map(r3), opening: o.id, msg: 'Wider than its wall', fix: 'fit' });
    const k = o.wall ? `w:${o.wall}` : `r:${o.room}:${o.edge}`; byHost.set(k, [...(byHost.get(k) || []), { o, f }]);
  }
  for (const list of byHost.values()) {
    list.sort((x, y) => x.f.t0 - y.f.t0);
    for (let i = 1; i < list.length; i++) if (list[i].f.t0 < list[i - 1].f.t1 - 0.01) add({ kind: 'opening', at: lerp2(list[i].f.a, list[i - 1].f.b, 0.5).map(r3), opening: list[i].o.id, after: list[i - 1].o.id, msg: 'Two openings overlap', fix: 'space' });
  }
  return out;
}
/* Where two segments lie on top of each other: { len, mid } or null. */
export function overlapOf(a, b, c, d) {
  const L = dist(a, b); if (L < 1e-6) return null;
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  if (Math.abs(cross(u, sub(c, a))) > OFF_TOL || Math.abs(cross(u, sub(d, a))) > OFF_TOL) return null;
  const t0 = dot(sub(c, a), u), t1 = dot(sub(d, a), u), lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(L, Math.max(t0, t1));
  if (hi - lo <= 0) return null;
  return { len: hi - lo, lo, hi, mid: [a[0] + u[0] * (lo + hi) / 2, a[1] + u[1] * (lo + hi) / 2].map(r3) };
}
/* How much two room outlines share (sampled every 5 cm, so any shape works): { area, at, push: [dx, dy] } */
export function roomOverlap(A, B) {
  const a = bbox(A), b = bbox(B), x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1), y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1);
  if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return null;
  const st = Math.max(0.05, Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000));
  let n = 0, sx = 0, sy = 0, mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity;
  for (let x = x0 + st / 2; x < x1; x += st) for (let y = y0 + st / 2; y < y1; y += st) if (pointInPoly([x, y], A) && pointInPoly([x, y], B)) { n++; sx += x; sy += y; mx0 = Math.min(mx0, x); mx1 = Math.max(mx1, x); my0 = Math.min(my0, y); my1 = Math.max(my1, y); }
  if (!n) return null;
  const ow = mx1 - mx0 + st, oh = my1 - my0 + st, cb = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], ca = [(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2];
  const push = ow <= oh ? [Math.sign(cb[0] - ca[0] || 1) * r2(ow), 0] : [0, Math.sign(cb[1] - ca[1] || 1) * r2(oh)];
  return { area: n * st * st, at: [r3(sx / n), r3(sy / n)], push };
}
/* Fix one problem in place. Returns true when something changed. */
export function applyFix(plan, is) {
  if (is.kind === 'overlap') {
    const w = plan.walls.find((x) => x.id === is.wall); if (!w) return false;
    const other = is.other ? plan.walls.find((x) => x.id === is.other) : null, frames = framesOf(plan, w.id);
    if (other) {   // two drawn walls: one wall from end to end of both
      const L = dist(other.a, other.b), u = [(other.b[0] - other.a[0]) / L, (other.b[1] - other.a[1]) / L];
      const ts = [0, L, dot(sub(w.a, other.a), u), dot(sub(w.b, other.a), u)], lo = Math.min(...ts), hi = Math.max(...ts);
      other.a = [other.a[0] + u[0] * lo, other.a[1] + u[1] * lo].map(r3); other.b = [other.a[0] + u[0] * (hi - lo), other.a[1] + u[1] * (hi - lo)].map(r3);
      other.thick = Math.max(num(other.thick, 0), num(w.thick, 0)) || undefined; other.color ||= w.color;
      rehostOpenings(plan, w.id, frames); plan.walls = plan.walls.filter((x) => x !== w); return true;
    }
    // a wall over a room's side: keep only the parts of the wall that stick out past it
    const r = plan.rooms.find((x) => x.id === is.room); if (!r) return false;
    const segs = sourceSegments({ rooms: [r], walls: [] });
    let parts = [[0, dist(w.a, w.b)]]; const L = dist(w.a, w.b);
    for (const s of segs) { const ov = overlapOf(w.a, w.b, s.a, s.b); if (!ov) continue; parts = parts.flatMap(([p0, p1]) => [[p0, Math.min(p1, ov.lo)], [Math.max(p0, ov.hi), p1]]).filter(([p0, p1]) => p1 - p0 > 0.05); }
    const keep = parts.map(([p0, p1]) => ({ ...w, id: uid('w'), a: lerp2(w.a, w.b, p0 / L).map(r3), b: lerp2(w.a, w.b, p1 / L).map(r3) }));
    plan.walls = plan.walls.flatMap((x) => (x === w ? keep : [x]));
    rehostOpenings(plan, w.id, frames);
    return true;
  }
  if (is.kind === 'gap' || is.kind === 'overshoot') {
    const w = plan.walls.find((x) => x.id === is.wall); if (!w) return false;
    w[is.end] = [...is.to]; return true;
  }
  if (is.kind === 'rooms') {
    const r = plan.rooms.find((x) => x.id === is.b); if (!r) return false;
    r.pts = r.pts.map((p) => [r3(p[0] + is.push[0]), r3(p[1] + is.push[1])]); return true;
  }
  if (is.kind === 'opening') {
    const o = plan.openings.find((x) => x.id === is.opening); if (!o) return false;
    if (is.fix === 'remove') { plan.openings = plan.openings.filter((x) => x !== o); return true; }
    const h = hostLine(plan, o); if (!h) return false;
    if (is.fix === 'fit') { o.width = r2(Math.max(0.3, h.len - 0.1)); placeOpening(o, h.len, 0.05); return true; }
    const prev = plan.openings.find((x) => x.id === is.after), pf = prev && openingFrame(plan, prev);
    if (pf && pf.t1 + 0.1 + o.width <= h.len) placeOpening(o, h.len, pf.t1 + 0.1);
    else if (pf && pf.t0 - 0.1 - o.width >= 0) placeOpening(o, h.len, pf.t0 - 0.1 - o.width);
    else { o.width = r2(Math.max(0.3, (h.len - (prev?.width || 0)) / 2 - 0.1)); placeOpening(o, h.len, h.len - o.width); }
    return true;
  }
  return false;
}
/* Doors and windows on a wall that is going away move to whichever wall or room side now runs under them, staying put. */
function rehostOpenings(plan, fromId, frames) {
  for (const o of plan.openings || []) {
    if (o.wall !== fromId) continue;
    const f = frames.get(o.id); if (!f) continue;
    let host = null;
    for (const w of plan.walls) { if (w.id === fromId) continue; const L = dist(w.a, w.b); if (L > 1e-6 && onLine(f, w.a, w.b)) { host = { ref: { wall: w.id }, a: w.a, b: w.b, L }; break; } }
    if (!host) for (const r of plan.rooms) for (let i = 0; i < r.pts.length && !host; i++) { const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length]; if (onLine(f, a, b)) host = { ref: { room: r.id, edge: i }, a, b, L: dist(a, b) }; }
    if (!host) { o.gone = true; continue; }
    delete o.wall; delete o.room; delete o.edge; Object.assign(o, host.ref);
    const u = [(host.b[0] - host.a[0]) / host.L, (host.b[1] - host.a[1]) / host.L], ta = dot(sub(f.a, host.a), u), tb = dot(sub(f.b, host.a), u);
    if (tb < ta && o.swing) o.swing = { left: 'right', right: 'left' }[o.swing] || o.swing;
    placeOpening(o, host.L, Math.min(ta, tb));
  }
  plan.openings = (plan.openings || []).filter((o) => !o.gone);
}
const onLine = (f, a, b) => { const n = nearestOnSeg(f.c, a, b), L = dist(a, b); return n.d < 0.04 && L > 1e-6 && Math.abs(Math.abs(dot(f.dir, [(b[0] - a[0]) / L, (b[1] - a[1]) / L])) - 1) < 0.002; };
const framesOf = (plan, wid) => new Map((plan.openings || []).filter((o) => o.wall === wid).map((o) => [o.id, openingFrame(plan, o)]));

/* ---------- drawing helpers ---------- */
/* Keep a line from a to b at a multiple of `step` degrees (45 by default): b moved to the nearest such direction, same length. */
export function snapAngle(a, b, step = 45) {
  const L = dist(a, b); if (L < 1e-9) return [...b];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = (step * Math.PI) / 180, k = Math.round(ang / s) * s;
  return [r3(a[0] + Math.cos(k) * L), r3(a[1] + Math.sin(k) * L)];
}
/* A point a given length and angle (degrees; 0 = right, 90 = down the screen) from a. */
export const polar = (a, len, deg) => [r3(a[0] + Math.cos((deg * Math.PI) / 180) * len), r3(a[1] + Math.sin((deg * Math.PI) / 180) * len)];
export const angleOf = (a, b) => { let d = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; if (d < 0) d += 360; return Math.round(d * 10) / 10; };
/* Magnet: pull p onto a nearby corner (preferred) or wall within tol meters. -> { pt, kind: 'corner'|'edge'|null, ref } */
export function magnet(p, plan, tol, skip) {
  let best = null;
  const segs = sourceSegments(plan).filter((s) => !skip || !skip(s));
  for (const s of segs) for (const c of [s.a, s.b]) { const d = dist(p, c); if (d <= tol && (!best || d < best.d)) best = { pt: [...c], d, kind: 'corner' }; }
  for (const s of plan.extraCorners || []) { const d = dist(p, s); if (d <= tol && (!best || d < best.d)) best = { pt: [...s], d, kind: 'corner' }; }
  if (best) return best;
  for (const s of segs) { const n = nearestOnSeg(p, s.a, s.b); if (n.d <= tol * 0.7 && (!best || n.d < best.d)) best = { pt: n.pt.map(r3), d: n.d, kind: 'edge', seg: s }; }
  return best || { pt: [...p], d: 0, kind: null };
}
/* Guides: x or y lines through corners that p lines up with (within tol). -> { x?: value, y?: value, pt } */
export function alignGuides(p, corners, tol) {
  let gx = null, gy = null;
  for (const c of corners) { if (Math.abs(c[0] - p[0]) <= tol && (gx == null || Math.abs(c[0] - p[0]) < Math.abs(gx - p[0]))) gx = c[0]; if (Math.abs(c[1] - p[1]) <= tol && (gy == null || Math.abs(c[1] - p[1]) < Math.abs(gy - p[1]))) gy = c[1]; }
  return { x: gx, y: gy, pt: [gx ?? p[0], gy ?? p[1]] };
}
export function planCorners(plan) {
  const out = [];
  for (const r of plan.rooms || []) out.push(...r.pts);
  for (const w of plan.walls || []) out.push(w.a, w.b);
  return out;
}
/* Line one floor up with the one below: the shift that puts the most corners on top of each other. -> { dx, dy, hits } */
export function bestAlign(mine, below, tol = 0.08) {
  if (!mine.length || !below.length) return { dx: 0, dy: 0, hits: 0 };
  const A = mine.slice(0, 40), B = below.slice(0, 40);
  let best = { dx: 0, dy: 0, hits: 0, far: Infinity };
  for (const a of A) for (const b of B) {
    const dx = b[0] - a[0], dy = b[1] - a[1]; let hits = 0;
    for (const p of A) if (B.some((q) => Math.abs(q[0] - p[0] - dx) <= tol && Math.abs(q[1] - p[1] - dy) <= tol)) hits++;
    const far = Math.hypot(dx, dy);
    if (hits > best.hits || (hits === best.hits && far < best.far)) best = { dx, dy, hits, far };
  }
  return { dx: r3(best.dx), dy: r3(best.dy), hits: best.hits };
}
/* Move / turn everything on the floor together (rooms, walls, stairs; doors and windows ride on their walls). */
export function transformPlan(plan, fn, turnDeg = 0) {
  for (const r of plan.rooms) r.pts = r.pts.map((p) => fn(p).map(r3));
  for (const w of plan.walls) { w.a = fn(w.a).map(r3); w.b = fn(w.b).map(r3); }
  for (const s of plan.stairs || []) { const q = fn([s.x, s.y]); s.x = r3(q[0]); s.y = r3(q[1]); s.rot = (((s.rot || 0) + turnDeg) % 360 + 360) % 360; }
  for (const o of plan.openings || []) if (o.kind === 'skylight' && Number.isFinite(o.x)) { const q = fn([o.x, o.y]); o.x = r3(q[0]); o.y = r3(q[1]); o.rot = (((o.rot || 0) + turnDeg) % 360 + 360) % 360; }
  return plan;
}
export const shiftFn = (dx, dy) => (p) => [p[0] + dx, p[1] + dy];
export const turnFn = (c, deg) => { const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a); return (p) => [c[0] + (p[0] - c[0]) * co - (p[1] - c[1]) * si, c[1] + (p[0] - c[0]) * si + (p[1] - c[1]) * co]; };
/* A floor's own plan point to the house (world) and back: offset [x, z], rotationY (deg, three.js turn), scale. */
export function floorToWorld(f, p) {
  const s = f.scale || 1, a = ((f.rotationY || 0) * Math.PI) / 180, x = p[0] * s, z = p[1] * s;
  return [x * Math.cos(a) + z * Math.sin(a) + (f.offset?.[0] || 0), -x * Math.sin(a) + z * Math.cos(a) + (f.offset?.[1] || 0)];
}
export function worldToFloor(f, q) {
  const s = f.scale || 1, a = ((f.rotationY || 0) * Math.PI) / 180, x = q[0] - (f.offset?.[0] || 0), z = q[1] - (f.offset?.[1] || 0);
  return [(x * Math.cos(a) - z * Math.sin(a)) / s, (x * Math.sin(a) + z * Math.cos(a)) / s];
}
/* Turn the whole house (every floor) by deg about c (world): each floor's new offset and turn. */
export function turnHouse(floors, deg, c) {
  const a = (deg * Math.PI) / 180;
  return floors.map((f) => { const ox = (f.offset?.[0] || 0) - c[0], oz = (f.offset?.[1] || 0) - c[1];
    return { id: f.id, offset: [r3(c[0] + ox * Math.cos(a) + oz * Math.sin(a)), r3(c[1] - ox * Math.sin(a) + oz * Math.cos(a))], rotationY: ((((f.rotationY || 0) + deg) % 360) + 540) % 360 - 180 }; });
}
/* Rooms from Home Assistant areas: one 3 x 3 m box per area not drawn yet, side by side, sharing walls. */
export function roomsFromAreas(names, plan, size = 3) {
  const have = new Set((plan.rooms || []).map((r) => r.name.trim().toLowerCase()));
  const todo = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].filter((n) => !have.has(n.toLowerCase()));
  const b = (plan.rooms || []).length ? bbox(plan.rooms.flatMap((r) => r.pts)) : { x0: 0, y1: -size };
  const cols = Math.max(1, Math.ceil(Math.sqrt(todo.length))), y0 = (plan.rooms || []).length ? b.y1 + 1 : 0, x0 = (plan.rooms || []).length ? b.x0 : 0;
  return todo.map((name, i) => ({ id: uid('r'), name: name.slice(0, 30), pts: rectPts(x0 + (i % cols) * size, y0 + Math.floor(i / cols) * size, size, size) }));
}

/* ---------- stairs ---------- */
/* Every step of a staircase, in the plan, climbing height H. Straight, L and U steps are boxes:
   { c: [x, y], w (across), d (along), rot (deg), top }; spiral steps are wedges: { wedge: true, c, r0, r1, a0, a1 (radians), top }.
   Also: outline (the hole cut in the floor above), count, rise, going, arrow ([from, to] for the up-arrow on the plan). */
export function stairSteps(st, H = 2.7) {
  const n = clamp(Math.round(H / 0.18), 3, 40), rise = H / n, w = clamp(num(st.width, 1), 0.5, 3), shape = STAIR_SHAPES[st.shape] ? st.shape : 'straight';
  const side = st.turn === 'left' ? -1 : 1, local = [];
  let outline, arrow, going;
  const box = (u0, u1, v0, v1, k) => local.push({ c: [(u0 + u1) / 2, (v0 + v1) / 2], d: Math.abs(u1 - u0), w: Math.abs(v1 - v0), top: (k + 1) * rise });
  if (shape === 'spiral') {
    const R = clamp(num(st.dia, 1.8), 1.2, 4) / 2, r0 = 0.08, sweep = Math.PI * 2 * 0.9, a = sweep / n;
    for (let k = 0; k < n; k++) local.push({ wedge: true, c: [0, 0], r0, r1: R, a0: side * k * a - Math.PI / 2, a1: side * (k + 1) * a - Math.PI / 2, top: (k + 1) * rise });
    outline = Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * Math.PI * 2) * (R + 0.05), Math.sin((i / 24) * Math.PI * 2) * (R + 0.05)]);
    going = (R * 0.6 * a); arrow = [[R * 0.6 * Math.cos(-Math.PI / 2), R * 0.6 * Math.sin(-Math.PI / 2)], [R * 0.6 * Math.cos(-Math.PI / 2 + side * 1.2), R * 0.6 * Math.sin(-Math.PI / 2 + side * 1.2)]];
  } else if (shape === 'straight') {
    const L = clamp(num(st.len, 3), 1, 12); going = L / n;
    for (let k = 0; k < n; k++) box(k * going, (k + 1) * going, -w / 2, w / 2, k);
    outline = [[0, -w / 2], [L, -w / 2], [L, w / 2], [0, w / 2]]; arrow = [[0.2, 0], [L - 0.2, 0]];
  } else if (shape === 'L') {
    const L1 = clamp(num(st.len, 2.6), w + 0.5, 12), L2 = clamp(num(st.len2, 1.8), 0.5, 12), a = L1 - w;
    const n1 = clamp(Math.round(((n - 1) * a) / (a + L2)), 1, n - 2), n2 = n - 1 - n1, g1 = a / n1, g2 = L2 / n2; going = (g1 + g2) / 2;
    for (let k = 0; k < n1; k++) box(k * g1, (k + 1) * g1, -w / 2, w / 2, k);
    box(a, L1, -w / 2, w / 2, n1);   // the landing at the turn
    for (let k = 0; k < n2; k++) { const v0 = w / 2 + k * g2, v1 = v0 + g2; box(a, L1, side * v0, side * v1, n1 + 1 + k); }
    outline = [[0, -side * w / 2], [L1, -side * w / 2], [L1, side * (w / 2 + L2)], [a, side * (w / 2 + L2)], [a, side * w / 2], [0, side * w / 2]];
    arrow = [[0.2, 0], [a + w / 2, 0], [a + w / 2, side * (w / 2 + L2 - 0.2)]];
  } else {   // U
    const L = clamp(num(st.len, 2.6), w + 0.5, 12), gap = 0.1, a = L - w, n1 = Math.floor((n - 1) / 2), n2 = n - 1 - n1, g1 = a / n1, g2 = a / n2; going = (g1 + g2) / 2;
    const v1a = -side * (w + gap / 2), v1b = -side * gap / 2, v2a = side * gap / 2, v2b = side * (w + gap / 2);
    for (let k = 0; k < n1; k++) box(k * g1, (k + 1) * g1, v1a, v1b, k);
    box(a, L, v1a, v2b, n1);
    for (let k = 0; k < n2; k++) box(a - (k + 1) * g2, a - k * g2, v2a, v2b, n1 + 1 + k);
    outline = [[0, v1a], [L, v1a], [L, v2b], [0, v2b]];
    arrow = [[0.2, (v1a + v1b) / 2], [a + w / 2, (v1a + v1b) / 2], [a + w / 2, (v2a + v2b) / 2], [0.2, (v2a + v2b) / 2]];
  }
  // centre the footprint on (0, 0), then turn and place it
  const bb = bbox(outline), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, rot = num(st.rot, 0), T = turnFn([0, 0], rot), at = (p) => { const q = T([p[0] - cx, p[1] - cy]); return [r3(q[0] + num(st.x, 0)), r3(q[1] + num(st.y, 0))]; };
  const steps = local.map((s) => (s.wedge ? { ...s, c: at(s.c), a0: s.a0 + (rot * Math.PI) / 180, a1: s.a1 + (rot * Math.PI) / 180 } : { ...s, c: at(s.c), rot }));
  return { steps, outline: outline.map(at), count: n, rise: r3(rise), going: r3(going), arrow: arrow.map(at), shape };
}

/* ---------- roofs ---------- */
/* A roof over a box (x0..x1, z0..z1, already grown by the overhang) with its eaves at height y.
   type: flat | gable | hip; pitch in degrees (undefined: the older look, a rise of 30% of the span, up to 2.4 m).
   -> { tris: [[x, y, z] x 3, ...], rise, ridge: [[x, y, z], [x, y, z]], heightAt(x, z), slopeAt(x, z) -> { y, nx, nz } } */
export function roofShape(box, y, type = 'gable', pitchDeg, thick = 0.15) {
  const { x0, x1, z0, z1 } = box, alongX = x1 - x0 >= z1 - z0, span = alongX ? z1 - z0 : x1 - x0, long = alongX ? x1 - x0 : z1 - z0;
  const tan = pitchDeg == null ? Math.min(2.4, span * 0.3) / (span / 2) : Math.tan((clamp(pitchDeg, 3, 70) * Math.PI) / 180);
  const rise = type === 'flat' ? thick : (span / 2) * tan, tris = [], T = (a, b, c) => tris.push([a, b, c]);
  const P = (u, v, h) => (alongX ? [x0 + u, y + h, z0 + v] : [x0 + v, y + h, z0 + u]);   // u along the ridge, v across
  let ridge;
  if (type === 'flat') {
    const a = P(0, 0, rise), b = P(long, 0, rise), c = P(long, span, rise), d = P(0, span, rise);
    T(a, b, c); T(a, c, d);
    ridge = [a, c];
  } else {
    const inset = type === 'hip' ? Math.min(span / 2, long / 2) : 0, r0 = P(inset, span / 2, rise), r1 = P(long - inset, span / 2, rise);
    const e00 = P(0, 0, 0), e10 = P(long, 0, 0), e11 = P(long, span, 0), e01 = P(0, span, 0);
    T(e00, e10, r1); T(e00, r1, r0);   // the two long slopes
    T(e11, e01, r0); T(e11, r0, r1);
    T(e01, e00, r0); T(e10, e11, r1);   // the ends: sloped on a hip roof, upright gable triangles otherwise (the ridge then ends right above the edge)
    ridge = [r0, r1];
  }
  const heightAt = (x, z) => {
    const u = alongX ? x - x0 : z - z0, v = alongX ? z - z0 : x - x0;
    if (type === 'flat') return y + rise;
    const dv = Math.min(v, span - v), du = type === 'hip' ? Math.min(u, long - u) : Infinity;
    return y + Math.max(0, Math.min(dv, du)) * tan;
  };
  const slopeAt = (x, z) => {
    const u = alongX ? x - x0 : z - z0, v = alongX ? z - z0 : x - x0, h = heightAt(x, z);
    if (type === 'flat') return { y: h, nx: 0, nz: 0, tilt: 0 };
    const dv = Math.min(v, span - v), du = type === 'hip' ? Math.min(u, long - u) : Infinity;
    let dirU = 0, dirV = 0;   // the way down the slope
    if (du < dv) dirU = u < long / 2 ? -1 : 1; else dirV = v < span / 2 ? -1 : 1;
    return { y: h, nx: alongX ? dirU : dirV, nz: alongX ? dirV : dirU, tilt: Math.atan(tan) };
  };
  return { tris, rise, ridge, heightAt, slopeAt, alongX, tan };
}
/* The roof's box for a drawn floor: the outline of its rooms and walls, grown by the overhang. */
export function roofBox(plan, overhang = 0.35) {
  const pts = planCorners(plan); if (!pts.length) return null;
  const b = bbox(pts), o = clamp(num(overhang, 0.35), 0, 2);
  return { x0: b.x0 - o, x1: b.x1 + o, z0: b.y0 - o, z1: b.y1 + o };
}

/* ---------- holes in a floor (for the stairs from below) ---------- */
export function isConvex(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length], z = cross(sub(b, a), sub(c, b)); if (Math.abs(z) < 1e-9) continue; if (!s) s = Math.sign(z); else if (Math.sign(z) !== s) return false; } return true; }
/* The part of `subject` inside the convex polygon `clip` (Sutherland-Hodgman). */
export function clipPoly(subject, clip) {
  const ccw = polyArea(clip) > 0, inside = (p, a, b) => (ccw ? 1 : -1) * cross(sub(b, a), sub(p, a)) >= -1e-9;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], pin = inside(p, a, b), qin = inside(q, a, b);
      if (pin) out.push(p);
      if (pin !== qin) { const r = sub(q, p), s = sub(b, a), den = cross(r, s); if (Math.abs(den) > 1e-12) { const t = cross(sub(a, p), s) / den; out.push(lerp2(p, q, t)); } }
    }
  }
  return out.length >= 3 && Math.abs(polyArea(out)) > 1e-4 ? out : null;
}
/* The holes a room's floor needs for stairs coming up from below (each already in this floor's own plan). */
export function holesIn(roomPtsList, holes) {
  const conv = isConvex(roomPtsList);
  return holes.map((h) => {
    if (h.every((p) => pointInPoly(p, roomPtsList))) return h;
    if (conv) return clipPoly(h, roomPtsList);
    if (h.some((p) => pointInPoly(p, roomPtsList))) return null;   // an odd-shaped room the stairs only partly reach: left whole
    return null;
  }).filter(Boolean).map((h) => (h.every((p) => pointInPoly(p, roomPtsList) || nearEdge(p, roomPtsList)) ? shrink(h, 0.01) : h));
}
const nearEdge = (p, pts) => pts.some((a, i) => nearestOnSeg(p, a, pts[(i + 1) % pts.length]).d < 0.011);
const shrink = (h, d) => { const c = centroid(h); return h.map((p) => { const v = sub(p, c), l = Math.hypot(v[0], v[1]) || 1; return [p[0] - (v[0] / l) * d, p[1] - (v[1] / l) * d]; }); };
