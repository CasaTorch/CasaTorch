/* ======================================================================
 * Drawn floors: what a saved drawing may hold (PUT /api/floorplan/floors/:id/plan, in 50-floorplan.js).
 * Rooms (boxes from older versions, or any outline), walls (old [x1, y1, x2, y2] or { id, a, b, thick, color }),
 * doors and windows, stairs, the roof, wall thickness, paint and floor materials, and how the traced picture
 * sits (width, fade, turn, shift). Everything is checked and capped; anything else is dropped.
 * The shape is described in public/floorplan-geom.js.
 * ====================================================================== */
const DP_ID = /^[\w-]{1,40}$/;
const DP_OPEN = new Set(['door', 'double', 'slider', 'bifold', 'garage', 'window', 'skylight']);
const DP_MATS = new Set(['wood', 'tile', 'carpet', 'concrete']);
const DP_STAIRS = new Set(['straight', 'L', 'U', 'spiral']);
const DP_ROOF = new Set(['flat', 'gable', 'hip']);
const dpNum = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Math.round(Number(v) * 1000) / 1000 : undefined);
const dpPt = (p) => (Array.isArray(p) && p.length === 2 && p.every((v) => dpNum(v, -500, 500) !== undefined) ? [dpNum(p[0], -500, 500), dpNum(p[1], -500, 500)] : null);
const dpHex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
const dpRef = (v) => (typeof v === 'string' && DP_ID.test(v) ? v : Number.isInteger(v) && v >= 0 && v < 1000 ? v : undefined);   // an id, or (from a file import) a list position
const dpStr = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);
const dpOnly = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
function dpClean(b, old = {}) {
  b = b && typeof b === 'object' ? b : {};
  const rooms = (Array.isArray(b.rooms) ? b.rooms : []).slice(0, 200).map((r) => {
    if (!r || typeof r !== 'object') return null;
    let pts = Array.isArray(r.pts) ? r.pts.slice(0, 200).map(dpPt) : null;
    if (pts && (pts.length < 3 || pts.some((p) => !p))) return null;
    const box = !pts && [r.x, r.y].every((v) => dpNum(v, -500, 500) !== undefined) && dpNum(r.w, 0.2, 200) && dpNum(r.h, 0.2, 200);
    if (!pts && !box) return null;
    const edgeColors = r.edgeColors && typeof r.edgeColors === 'object' ? Object.fromEntries(Object.entries(r.edgeColors).filter(([k, v]) => /^\d{1,3}$/.test(k) && dpHex(v)).slice(0, 200).map(([k, v]) => [k, dpHex(v)])) : undefined;
    return dpOnly({ id: dpRef(r.id), name: String(r.name || '').slice(0, 30), ...(pts ? { pts } : { x: dpNum(r.x, -500, 500), y: dpNum(r.y, -500, 500), w: dpNum(r.w, 0.2, 200), h: dpNum(r.h, 0.2, 200) }),
      floorMat: DP_MATS.has(r.floorMat) ? r.floorMat : undefined, wallColor: dpHex(r.wallColor), edgeColors: edgeColors && Object.keys(edgeColors).length ? edgeColors : undefined });
  }).filter(Boolean);
  const walls = (Array.isArray(b.walls) ? b.walls : []).slice(0, 1000).map((w) => {
    if (Array.isArray(w)) return w.length === 4 && w.every((v) => dpNum(v, -500, 500) !== undefined) ? w.map((v) => dpNum(v, -500, 500)) : null;
    if (!w || typeof w !== 'object') return null;
    const a = dpPt(w.a), bb = dpPt(w.b); if (!a || !bb) return null;
    return dpOnly({ id: dpRef(w.id), a, b: bb, thick: dpNum(w.thick, 0.05, 0.6), color: dpHex(w.color) });
  }).filter(Boolean);
  const openings = (Array.isArray(b.openings) ? b.openings : []).slice(0, 500).map((o) => {
    if (!o || typeof o !== 'object' || !DP_OPEN.has(o.kind)) return null;
    const wall = dpRef(o.wall), room = dpRef(o.room);
    if (o.kind !== 'skylight' && wall === undefined && room === undefined) return null;
    return dpOnly({ id: dpRef(o.id), floorId: dpStr(o.floorId, 40), kind: o.kind, wall, room, edge: Number.isInteger(o.edge) && o.edge >= 0 && o.edge < 200 ? o.edge : undefined,
      side: ['start', 'end'].includes(o.side) ? o.side : undefined, fromEdge: dpNum(o.fromEdge, 0, 200), t: dpNum(o.t, 0, 200),
      width: dpNum(o.width, 0.2, 10) ?? 0.9, height: dpNum(o.height, 0.2, 6), sill: dpNum(o.sill, 0, 5),
      swing: ['left', 'right', 'in', 'out'].includes(o.swing) ? o.swing : undefined, opens: ['in', 'out'].includes(o.opens) ? o.opens : undefined,
      x: dpNum(o.x, -500, 500), y: dpNum(o.y, -500, 500), rot: dpNum(o.rot, -360, 360),
      deviceId: dpStr(o.deviceId, 200), coverId: dpStr(o.coverId, 200), noRainAlert: o.noRainAlert === true ? true : undefined });
  }).filter(Boolean);
  const stairs = (Array.isArray(b.stairs) ? b.stairs : []).slice(0, 50).map((s) => {
    if (!s || typeof s !== 'object' || dpNum(s.x, -500, 500) === undefined || dpNum(s.y, -500, 500) === undefined) return null;
    return dpOnly({ id: dpRef(s.id), shape: DP_STAIRS.has(s.shape) ? s.shape : 'straight', x: dpNum(s.x, -500, 500), y: dpNum(s.y, -500, 500), rot: dpNum(s.rot, -360, 360) ?? 0,
      width: dpNum(s.width, 0.5, 3) ?? 1, len: dpNum(s.len, 1, 12), len2: dpNum(s.len2, 0.5, 12), dia: dpNum(s.dia, 1.2, 4), turn: s.turn === 'left' ? 'left' : 'right' });
  }).filter(Boolean);
  const r = b.roof && typeof b.roof === 'object' ? b.roof : null;
  const roof = r ? dpOnly({ on: typeof r.on === 'boolean' ? r.on : undefined, type: DP_ROOF.has(r.type) ? r.type : 'gable', pitch: dpNum(r.pitch, 3, 70), overhang: dpNum(r.overhang, 0, 2) }) : undefined;
  return dpOnly({ v: Number.isInteger(b.v) && b.v > 0 && b.v < 100 ? b.v : undefined, rooms, walls, openings, stairs, roof,
    thickExt: dpNum(b.thickExt, 0.05, 0.6), thickInt: dpNum(b.thickInt, 0.05, 0.6),
    bg: old.bg ?? null,   // the picture itself only comes in through its own upload
    bgW: dpNum(b.bgW, 1, 500) ?? old.bgW, bgOpacity: dpNum(b.bgOpacity, 0, 1) ?? old.bgOpacity,
    bgRot: dpNum(b.bgRot, -180, 180) ?? old.bgRot, bgX: dpNum(b.bgX, -500, 500) ?? old.bgX, bgY: dpNum(b.bgY, -500, 500) ?? old.bgY });
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchDraw = { dpClean };
