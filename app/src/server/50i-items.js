/* ======================================================================
 * 3D home: furniture and things placed in and around the house (Pro).
 *
 *   PUT /api/floorplan/items   { items: [...] }   replaces plan.items
 *
 * An item: { id, kind, floor (a floor's id, or null = outside on the ground), pos: [x, z] (metres), y (height
 * above its floor), rot (degrees), w/d/h (its size, metres), color, style (awnings), grp (moved together), tilt
 * (strip lights on stairs), and links that only SHOW state: binId / plantId / laundryId (Household), mail (the
 * mailbox), coverId (an awning follows its cover), deviceId (a strip light or lamp glows with its light, a TV
 * with its player). Nothing here controls anything. Drawn in the browser by floorplan-outdoor.js.
 * Also: the yard's extras checked here for 50-floorplan.js (a pool's depth, a driveway's slope, fences, hedges).
 * ====================================================================== */
const FP_ITEM_KINDS = new Set(['sofa', 'armchair', 'coffeetable', 'tvstand', 'tv', 'rug', 'lamp', 'pot', 'shelves', 'bed2', 'bed1', 'nightstand', 'wardrobe', 'dtable', 'chair', 'desk', 'ochair',
  'counter', 'island', 'fridge', 'oven', 'sink', 'dishwasher', 'washer', 'dryer', 'toilet', 'bath', 'shower', 'led', 'bin', 'mailbox', 'planter', 'awning']);
const FP_ITEM_MAX = 800;
const fpItemRef = (v, max = 120) => (typeof v === 'string' && v.length <= max && /^[\w.:@-]+$/.test(v) ? v : null);
function fpCleanItem(it, floors) {
  if (!it || !FP_ITEM_KINDS.has(it.kind) || !Array.isArray(it.pos) || it.pos.length !== 2 || !it.pos.every((n) => fin(n, -1000, 1000))) return null;
  const r = (n) => Math.round(n * 100) / 100, o = { id: /^[\w-]{1,24}$/.test(it.id) ? it.id : crypto.randomBytes(5).toString('hex'), kind: it.kind, floor: floors.has(it.floor) ? it.floor : null, pos: it.pos.map((n) => r(+n)) };
  o.rot = fin(it.rot, -360, 360) ? Math.round(+it.rot) : 0;
  if (fin(it.y, 0, 30) && +it.y) o.y = r(+it.y);
  for (const k of ['w', 'd', 'h']) if (fin(it[k], 0.05, 30)) o[k] = r(+it[k]);
  if (FP_HEX.test(it.color)) o.color = it.color;
  if (it.kind === 'awning') o.style = ['arm', 'drop', 'zip', 'pergola'].includes(it.style) ? it.style : 'arm';
  if (it.kind === 'led' && fin(it.tilt, -60, 60) && +it.tilt) o.tilt = Math.round(+it.tilt);
  if (it.kind === 'bin' && ['trash', 'recycling', 'organics', 'paper', 'glass', 'yard'].includes(it.icon)) o.icon = it.icon;
  if (it.kind === 'mailbox' && it.mail === true) o.mail = true;
  const grp = fpItemRef(it.grp, 24); if (grp) o.grp = grp;
  const links = { bin: ['binId'], pot: ['plantId', 'deviceId'], planter: ['plantId'], washer: ['laundryId'], dryer: ['laundryId'], dishwasher: ['laundryId'], awning: ['coverId'], led: ['deviceId'], lamp: ['deviceId'], tv: ['deviceId'] }[it.kind] || [];
  for (const k of links) { const v = fpItemRef(it[k], 200); if (v) o[k] = v; }
  return o;
}
app.put('/api/floorplan/items', requirePro, express.json({ limit: '1mb' }), (req, res) => {
  const d = fpData(), list = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!list) return res.status(400).json({ error: 'Send { items: [...] }.' });
  const floors = new Set((d.floors || []).map((f) => f.id)), seen = new Set();
  d.items = list.slice(0, FP_ITEM_MAX).map((it) => fpCleanItem(it, floors)).filter((it) => it && !seen.has(it.id) && seen.add(it.id));
  fpWrite(d); res.json({ ok: true, items: d.items });
});
/* The yard's extras (used by PUT /api/floorplan/yard in 50-floorplan.js). */
function yardAreaExtras(a) {
  const o = {};
  if (a.kind === 'pool') o.depth = fin(a.depth, 0.3, 3) ? Math.round(a.depth * 10) / 10 : 1.4;
  else if (fin(a.rise, -3, 3) && +a.rise) o.rise = Math.round(a.rise * 100) / 100;
  return o;
}
function yardLines(lines) {
  const pt = (q) => Array.isArray(q) && q.length === 2 && q.every((n) => fin(n, -1000, 1000));
  return (Array.isArray(lines) ? lines : []).filter((l) => ['fence', 'hedge'].includes(l?.kind) && Array.isArray(l.pts) && l.pts.length >= 2 && l.pts.length <= 100 && l.pts.every(pt)).slice(0, 100)
    .map((l) => ({ id: /^[\w-]{1,24}$/.test(l.id) ? l.id : crypto.randomBytes(5).toString('hex'), kind: l.kind, pts: l.pts.map((q) => q.map((n) => Math.round(n * 100) / 100)), h: fin(l.h, 0.3, 3) ? Math.round(l.h * 10) / 10 : l.kind === 'hedge' ? 1.4 : 1.2, ...(FP_HEX.test(l.color) ? { color: l.color } : {}) }));
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchItems = { fpCleanItem, yardAreaExtras, yardLines };
