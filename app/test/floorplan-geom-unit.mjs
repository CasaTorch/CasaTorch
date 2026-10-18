/* Unit tests for the 3D home's drawing geometry (public/floorplan-geom.js): shared-wall merge, doors and windows
   placed from the nearest edge, overlap/gap detection and their fixes, stairs, roofs, and old plans read as new.
   Run from test/unit.mjs. */
import assert from 'node:assert/strict';

export default async function floorplanGeomTests(t) {
  const G = await import('../public/floorplan-geom.js');
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
  const two = () => G.normalizePlan({ rooms: [{ name: 'Kitchen', x: 0, y: 0, w: 4, h: 3 }, { name: 'Living', x: 4, y: 0, w: 5, h: 3 }], walls: [] });

  t('3d draw: an old plan (boxes and [x1,y1,x2,y2] walls) is read as the new kind, nothing lost', () => {
    const p = G.normalizePlan({ rooms: [{ name: 'Hall', x: 1, y: 2, w: 3, h: 4 }], walls: [[0, 0, 5, 0]], bg: 'd1-bg.png', bgW: 12, bgOpacity: 0.4 });
    assert.equal(p.v, G.PLAN_V);
    assert.deepEqual(p.rooms[0].pts, [[1, 2], [4, 2], [4, 6], [1, 6]]); assert.equal(p.rooms[0].name, 'Hall'); assert.ok(p.rooms[0].id);
    assert.deepEqual([p.walls[0].a, p.walls[0].b], [[0, 0], [5, 0]]); assert.ok(p.walls[0].id);
    assert.equal(p.bg, 'd1-bg.png'); assert.equal(p.bgW, 12); assert.equal(p.bgOpacity, 0.4);
    assert.deepEqual(p.openings, []); assert.deepEqual(p.stairs, []);
    const again = G.normalizePlan(p); assert.deepEqual(again.rooms, p.rooms, 'reading it twice changes nothing');
  });

  t('3d draw: two rooms side by side share one wall (no doubled wall), outside walls thicker', () => {
    const W = G.planWalls(two());
    const shared = W.filter((w) => w.left && w.right);
    assert.equal(shared.length, 1); assert.ok(near(shared[0].len, 3, 1e-3)); assert.ok(near(shared[0].a[0], 4, 1e-3) && near(shared[0].b[0], 4, 1e-3));
    assert.equal(shared[0].thick, G.THICK.int); assert.equal(shared[0].ext, false);
    const total = W.reduce((s, w) => s + w.len, 0); assert.ok(near(total, 4 + 5 + 4 + 5 + 3 + 3 + 3, 1e-3), `every stretch once: ${total}`);
    assert.ok(W.filter((w) => w.ext).every((w) => w.thick === G.THICK.ext));
  });
  t('3d draw: a room shorter than its neighbour shares only the common part of the wall', () => {
    const p = G.normalizePlan({ rooms: [{ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 1, w: 3, h: 2 }] });
    const onX4 = G.planWalls(p).filter((w) => near(w.a[0], 4, 1e-3) && near(w.b[0], 4, 1e-3)).sort((a, b) => a.a[1] + a.b[1] - b.a[1] - b.b[1]);
    assert.deepEqual(onX4.map((w) => [w.len, !!(w.left && w.right)]), [[1, false], [2, true], [1, false]]);
  });
  t('3d draw: a drawn wall over a room side is one wall, not two', () => {
    const p = G.normalizePlan({ rooms: [{ x: 0, y: 0, w: 4, h: 3 }], walls: [[0, 0, 4, 0]] });
    const top = G.planWalls(p).filter((w) => near(w.a[1], 0, 1e-3) && near(w.b[1], 0, 1e-3));
    assert.equal(top.length, 1); assert.equal(top[0].walls.length, 1);
  });
  t('3d draw: wall colors per side of a shared wall', () => {
    const p = two(); p.rooms[0].wallColor = '#a9b8a0'; p.rooms[1].wallColor = '#a7c4dc';
    const s = G.planWalls(p).find((w) => w.left && w.right);
    assert.deepEqual([s.colorL, s.colorR].sort(), ['#a7c4dc', '#a9b8a0']);
  });

  t('3d draw: a door 0.4 m from the nearest edge stays 0.4 m from that edge', () => {
    const p = two(), k = p.rooms[0];
    const o = G.newOpening('door', { room: k.id, edge: 0 });   // the 4 m top side of the kitchen
    G.placeOpening(o, 4, 4 - 0.4 - 0.9);   // dropped near the far end
    assert.equal(o.side, 'end'); assert.equal(o.fromEdge, 0.4);
    assert.deepEqual(G.openingGaps(o, 4), { before: 2.7, after: 0.4 });
    assert.deepEqual(G.openingGaps(o, 5), { before: 3.7, after: 0.4 }, 'the wall grows: still 0.4 m from its edge');
    G.placeOpening(o, 4, 0.4); assert.equal(o.side, 'start'); assert.equal(o.fromEdge, 0.4); assert.equal(o.t, 0.4);
    const sp = G.openingSpan({ ...o, fromEdge: 9 }, 4); assert.ok(near(sp.t1, 4), 'never past the end');
  });
  t('3d draw: a wall with a window is cut into pieces around it (below the sill, above, and the sides)', () => {
    const pcs = G.wallPieces(4, 2.6, [{ s0: 1, s1: 2.2, sill: 0.9, height: 1.2 }]);
    assert.deepEqual(pcs.map((p) => [p.s0, p.s1, p.y0, +p.y1.toFixed(2)]), [[0, 1, 0, 2.6], [1, 2.2, 0, 0.9], [1, 2.2, 2.1, 2.6], [2.2, 4, 0, 2.6]]);
    const door = G.wallPieces(3, 2.6, [{ s0: 0.4, s1: 1.3, sill: 0, height: 2.05 }]);
    assert.equal(door.length, 3, 'a door: no piece below it');
  });
  t('3d draw: an opening on a shared wall is found on the merged wall', () => {
    const p = two(), o = G.newOpening('double', { room: p.rooms[1].id, edge: 3 }); G.placeOpening(o, 3, 0.5); p.openings.push(o);
    const s = G.planWalls(p).find((w) => w.left && w.right), on = G.openingsOnWall(s, p);
    assert.equal(on.length, 1); assert.ok(near(on[0].s1 - on[0].s0, 1.5, 1e-3));
  });

  t('3d draw: walls on top of each other are found at the exact spot, and Fix merges them', () => {
    const p = G.normalizePlan({ walls: [[0, 0, 4, 0], [3, 0, 6, 0]] });
    const is = G.findIssues(p).filter((x) => x.kind === 'overlap');
    assert.equal(is.length, 1); assert.deepEqual(is[0].at, [3.5, 0]); assert.equal(is[0].len, 1);
    assert.ok(G.applyFix(p, is[0])); assert.equal(p.walls.length, 1);
    assert.deepEqual([p.walls[0].a, p.walls[0].b].sort((a, b) => a[0] - b[0]), [[0, 0], [6, 0]]);
    assert.equal(G.findIssues(p).length, 0);
  });
  t('3d draw: a wall over a room side keeps only the part that sticks out', () => {
    const p = G.normalizePlan({ rooms: [{ x: 0, y: 0, w: 4, h: 3 }], walls: [[2, 0, 6, 0]] });
    const is = G.findIssues(p).find((x) => x.kind === 'overlap'); assert.ok(is); assert.equal(is.len, 2);
    G.applyFix(p, is); assert.equal(p.walls.length, 1); assert.deepEqual([p.walls[0].a, p.walls[0].b], [[4, 0], [6, 0]]);
  });
  t('3d draw: a wall that stops short (doesn\'t close) is shown where, and Fix joins it', () => {
    const p = G.normalizePlan({ walls: [[0, 0, 4, 0], [4, 0, 4, 3], [4, 3, 0, 3], [0, 3, 0, 0.2]] });
    const is = G.findIssues(p); assert.equal(is.length, 1); assert.equal(is[0].kind, 'gap'); assert.deepEqual(is[0].at, [0, 0.1]);
    G.applyFix(p, is[0]); assert.deepEqual(p.walls[3].b, [0, 0]); assert.equal(G.findIssues(p).length, 0);
  });
  t('3d draw: a wall running a little past another is trimmed', () => {
    const p = G.normalizePlan({ walls: [[0, 0, 4, 0], [2, 3, 2, -0.3]] });
    const is = G.findIssues(p).find((x) => x.kind === 'overshoot'); assert.ok(is); assert.deepEqual(is.at, [2, 0]); assert.equal(is.len, 0.3);
    G.applyFix(p, is); assert.deepEqual(p.walls[1].b, [2, 0]);
  });
  t('3d draw: overlapping rooms are found and pushed apart; touching rooms are fine', () => {
    assert.equal(G.findIssues(two()).length, 0);
    const p = G.normalizePlan({ rooms: [{ name: 'A', x: 0, y: 0, w: 4, h: 3 }, { name: 'B', x: 3.5, y: 0, w: 3, h: 3 }] });
    const is = G.findIssues(p); assert.equal(is.length, 1); assert.equal(is[0].kind, 'rooms'); assert.ok(near(is[0].at[0], 3.75, 0.05)); assert.ok(near(is[0].len, 1.5, 0.1));
    G.applyFix(p, is[0]); assert.equal(G.findIssues(p).length, 0); assert.ok(near(p.rooms[1].pts[0][0], 4, 0.06));
  });
  t('3d draw: two doors on top of each other are spaced apart by Fix', () => {
    const p = G.normalizePlan({ walls: [[0, 0, 6, 0]] }), w = p.walls[0];
    p.openings.push(G.placeOpening(G.newOpening('door', { wall: w.id }), 6, 1), G.placeOpening(G.newOpening('door', { wall: w.id }), 6, 1.5));
    const is = G.findIssues(p); assert.equal(is.length, 1); assert.equal(is[0].kind, 'opening');
    G.applyFix(p, is[0]); assert.equal(G.findIssues(p).length, 0);
  });

  t('3d draw: snapping to 45/90 degrees, magnet to corners, typed length + angle', () => {
    assert.deepEqual(G.snapAngle([0, 0], [3, 0.2]), [3.007, 0]);
    const d = G.snapAngle([0, 0], [2, 2.1]); assert.ok(near(d[0], d[1], 1e-3));
    assert.deepEqual(G.polar([1, 1], 2.5, 90), [1, 3.5]);
    assert.equal(G.angleOf([0, 0], [0, -1]), 270);
    const p = two(); const m = G.magnet([3.93, 0.06], p, 0.15); assert.equal(m.kind, 'corner'); assert.deepEqual(m.pt, [4, 0]);
    const e = G.magnet([2, 0.05], p, 0.15); assert.equal(e.kind, 'edge'); assert.deepEqual(e.pt, [2, 0]);
  });
  t('3d draw: lining a floor up with the one below', () => {
    const below = [[0, 0], [8, 0], [8, 6], [0, 6]], mine = below.map((p) => [p[0] + 0.7, p[1] - 0.4]);
    assert.deepEqual(G.bestAlign(mine, below), { dx: -0.7, dy: 0.4, hits: 4 });
    const f = { offset: [2, 1], rotationY: 90, scale: 1 }, w = G.floorToWorld(f, [3, 0]), back = G.worldToFloor(f, w);
    assert.ok(near(back[0], 3) && near(back[1], 0));
    const turned = G.turnHouse([{ id: 'a', offset: [4, 0], rotationY: 0 }], 90, [0, 0]);
    assert.deepEqual(turned[0].offset.map((v) => Math.round(v * 1000) / 1000), [0, -4]); assert.equal(turned[0].rotationY, 90);
  });
  t('3d draw: rooms from Home Assistant areas (skips ones already drawn)', () => {
    const p = two(); const r = G.roomsFromAreas(['Kitchen', 'Bedroom', 'Office', 'Bedroom', ''], p);
    assert.deepEqual(r.map((x) => x.name), ['Bedroom', 'Office']); assert.ok(r.every((x) => G.polyArea(x.pts) === 9));
    assert.ok(r.every((x) => G.bbox(x.pts).y0 >= 3), 'placed below what is drawn');
  });

  t('3d draw: straight stairs climb the floor height in even steps', () => {
    const s = G.stairSteps({ shape: 'straight', x: 5, y: 5, rot: 0, width: 1, len: 3.2 }, 2.7);
    assert.equal(s.count, 15); assert.ok(near(s.rise, 0.18)); assert.ok(near(s.steps.at(-1).top, 2.7));
    const b = G.bbox(s.outline); assert.ok(near(b.w, 3.2, 1e-3) && near(b.h, 1, 1e-3) && near((b.x0 + b.x1) / 2, 5, 1e-3));
    const turned = G.bbox(G.stairSteps({ shape: 'straight', x: 0, y: 0, rot: 90, width: 1, len: 3.2 }, 2.7).outline); assert.ok(near(turned.w, 1, 1e-3) && near(turned.h, 3.2, 1e-3));
  });
  t('3d draw: L, U and spiral stairs: every riser even, the hole covers every step', () => {
    for (const shape of ['L', 'U', 'spiral']) {
      const s = G.stairSteps({ shape, x: 0, y: 0, rot: 30, width: 0.9, len: 2.6, len2: 1.8, dia: 2, turn: 'left' }, 2.8);
      assert.equal(s.steps.length, s.count, shape);
      s.steps.forEach((st, i) => assert.ok(near(st.top, (i + 1) * (2.8 / s.count), 1e-6), `${shape} step ${i}`));
      const c = s.steps.map((st) => (st.wedge ? [st.c[0] + Math.cos((st.a0 + st.a1) / 2) * st.r1 * 0.6, st.c[1] + Math.sin((st.a0 + st.a1) / 2) * st.r1 * 0.6] : st.c));
      assert.ok(c.every((p) => G.pointInPoly(p, s.outline)), `${shape}: steps inside the hole`);
    }
    const L = G.stairSteps({ shape: 'L', x: 0, y: 0, width: 1, len: 3, len2: 2 }, 2.7); assert.ok(near(Math.abs(G.polyArea(L.outline)), 3 * 1 + 2 * 1, 1e-3));
  });

  t('3d draw: roofs - gable rise from pitch, hip slopes on all four sides, flat', () => {
    const box = { x0: 0, x1: 10, z0: 0, z1: 6 };
    const g = G.roofShape(box, 3, 'gable', 45); assert.ok(near(g.rise, 3)); assert.ok(near(g.heightAt(0.5, 3), 6)); assert.ok(near(g.heightAt(5, 0), 3)); assert.equal(g.tris.length, 6);
    const h = G.roofShape(box, 3, 'hip', 45); assert.ok(near(h.heightAt(0, 3), 3), 'a hip slopes down at the ends too'); assert.ok(near(h.heightAt(5, 3), 6));
    assert.deepEqual(h.ridge.map((p) => p[0]), [3, 7]);
    const sq = G.roofShape({ x0: 0, x1: 6, z0: 0, z1: 6 }, 0, 'hip', 30); assert.ok(near(sq.ridge[0][0], sq.ridge[1][0]), 'a square hip roof comes to a point');
    const f = G.roofShape(box, 3, 'flat'); assert.ok(near(f.heightAt(1, 1), 3.15)); assert.equal(f.tris.length, 2);
    const old = G.roofShape(box, 3, 'gable'); assert.ok(near(old.rise, 1.8), 'no pitch set: the older look (30% of the span)');
    const sl = g.slopeAt(5, 1); assert.equal(sl.nz, -1); assert.ok(near(sl.tilt, Math.PI / 4));
    const rb = G.roofBox(two(), 0.5); assert.deepEqual(rb, { x0: -0.5, x1: 9.5, z0: -0.5, z1: 3.5 });
  });

  const D = globalThis.__casatorchDraw;
  if (D) t('3d draw: the server keeps a new drawing (openings, stairs, roof, paint) and an old one, and drops junk', () => {
    const p = G.normalizePlan({ rooms: [{ name: 'Kitchen', x: 0, y: 0, w: 4, h: 3 }], walls: [[0, 0, 5, 0]] });
    p.rooms[0].floorMat = 'tile'; p.rooms[0].wallColor = '#A9B8A0'; p.rooms[0].edgeColors = { 1: '#ffffff', x: 'red' };
    p.openings.push(G.placeOpening(G.newOpening('bifold', { room: p.rooms[0].id, edge: 0, deviceId: 'ha:binary_sensor.door', noRainAlert: true }), 4, 0.4));
    p.stairs.push({ id: 's1', shape: 'U', x: 2, y: 2, rot: 90, width: 1, len: 2.6, turn: 'left' }); p.roof = { on: true, type: 'hip', pitch: 30, overhang: 0.5 }; p.bgRot = 12;
    const c = D.dpClean({ ...p, evil: '<script>', openings: [...p.openings, { kind: 'portal', wall: 'w1' }, { kind: 'door' }] }, { bg: 'd1-bg.png', bgW: 15 });
    assert.equal(c.rooms[0].floorMat, 'tile'); assert.equal(c.rooms[0].wallColor, '#a9b8a0'); assert.deepEqual(c.rooms[0].edgeColors, { 1: '#ffffff' });
    assert.equal(c.openings.length, 1); assert.equal(c.openings[0].kind, 'bifold'); assert.equal(c.openings[0].fromEdge, 0.4); assert.equal(c.openings[0].noRainAlert, true); assert.equal(c.openings[0].deviceId, 'ha:binary_sensor.door');
    assert.equal(c.stairs[0].shape, 'U'); assert.deepEqual(c.roof, { on: true, type: 'hip', pitch: 30, overhang: 0.5 }); assert.equal(c.bg, 'd1-bg.png'); assert.equal(c.bgRot, 12); assert.equal(c.evil, undefined);
    assert.deepEqual(G.normalizePlan(c).rooms[0].pts, p.rooms[0].pts, 'saved and read back: the same');
    const old = D.dpClean({ rooms: [{ name: 'Hall', x: 1, y: 1, w: 3, h: 2 }], walls: [[0, 0, 4, 0]], bgW: 20 }, { bg: null });
    assert.deepEqual(old.rooms, [{ name: 'Hall', x: 1, y: 1, w: 3, h: 2 }]); assert.deepEqual(old.walls, [[0, 0, 4, 0]]); assert.equal(old.bgW, 20);
  });
  await t('3d draw: built in 3D - every door and window has a leaf to move, walls are cut, the floor above gets the stair hole', async () => {
    const D = await import('../public/floorplan-drawn.js');
    const p = G.normalizePlan({ rooms: [{ name: 'A', x: 0, y: 0, w: 5, h: 4 }, { name: 'B', x: 5, y: 0, w: 3, h: 4 }] });
    p.openings.push(G.placeOpening(G.newOpening('door', { room: p.rooms[0].id, edge: 2, deviceId: 'ha:binary_sensor.front' }), 5, 0.4), G.placeOpening(G.newOpening('double', { room: p.rooms[0].id, edge: 1 }), 4, 1));
    p.openings.push(G.placeOpening(G.newOpening('window', { room: p.rooms[0].id, edge: 0, coverId: 'ha:cover.blind' }), 5, 1), G.placeOpening(G.newOpening('garage', { room: p.rooms[1].id, edge: 0 }), 3, 0.2));
    p.openings.push(G.newOpening('skylight', { x: 2, y: 2 })); p.stairs.push({ id: 's1', shape: 'straight', x: 2.5, y: 2, rot: 0, width: 1, len: 3 });
    const f = { id: 'a', kind: 'drawn', level: 0, heightM: 2.7, plan: p }, g = D.buildDrawnGroup(f, { floors: [f] });
    const ops = g.children.filter((c) => c.userData.openingId);
    assert.equal(ops.length, 4, 'the roof window sits in the roof, not the floor');
    const roof = (await import('../public/floorplan-house.js')).buildPlanRoof(f, [f], 'real');
    const sky = []; roof.traverse((o) => { if (o.userData.kind === 'skylight') sky.push(o); }); assert.equal(sky.length, 1); assert.ok(sky[0].getObjectByName('leaf'));
    assert.ok(sky[0].position.y > 2.7, 'up on the roof');
    for (const o of ops) { assert.ok(o.getObjectByName('leaf'), `${o.userData.kind} has a leaf`); assert.ok([1, -1].includes(o.userData.openDir)); assert.ok(/^(Door|Window) /.test(o.name)); }
    assert.ok(ops.find((o) => o.userData.kind === 'double').getObjectByName('leaf2'));
    assert.ok(ops.find((o) => o.userData.kind === 'window').getObjectByName('cover'), 'a window with a blind has its cover');
    assert.ok(ops.find((o) => o.userData.kind === 'garage').userData.lift > 2);
    const walls = g.children.filter((c) => c.name.startsWith('Wall')); assert.ok(walls.length >= 7, 'one mesh per stretch of wall');
    assert.ok(walls.filter((c) => c.geometry.attributes.position.count > 24).length >= 3, 'walls cut around the openings (the pieces of a stretch merged into one mesh)');
    assert.ok(g.children.some((c) => c.name.startsWith('Stairs')));
    const up = { id: 'b', kind: 'drawn', level: 1, heightM: 2.7, plan: { rooms: [{ x: 0, y: 0, w: 8, h: 4 }] } };
    const slab = D.buildDrawnGroup(up, { floors: [f, up] }).children.find((c) => c.name.startsWith('Floor'));
    assert.equal(slab.geometry.parameters.shapes.holes.length, 1, 'the stairs from below cut the floor');
  });
  t('3d draw: doors from an imported file (walls and rooms by number, measured to the middle) land in the same place', () => {
    const p = G.normalizePlan({ rooms: [{ name: 'A', x: 0, y: 0, w: 4, h: 3 }], walls: [[0, 5, 6, 5]], openings: [{ id: 'o1', room: 0, edge: 0, fromEdge: 1, width: 0.8, kind: 'door' }, { id: 'o2', wall: 0, t: 5, width: 1, kind: 'window', sill: 0.9 }] });
    assert.equal(p.openings[0].room, p.rooms[0].id); assert.deepEqual(G.openingGaps(p.openings[0], 4), { before: 0.6, after: 2.6 });
    assert.equal(p.openings[1].wall, p.walls[0].id); assert.deepEqual(G.openingGaps(p.openings[1], 6), { before: 4.5, after: 0.5 });
  });
}
