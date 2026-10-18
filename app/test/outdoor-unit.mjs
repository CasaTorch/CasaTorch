/* Unit tests for the 3D home's outdoor and furniture geometry (public/floorplan-outdoor.js) and the checks on what is
   saved (src/server/50i-items.js). Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';

export default async function outdoorTests(t) {
  const G = await import('../public/floorplan-outdoor.js');
  const F = await import('../public/floorplan-furniture.js');
  const I = globalThis.__casatorchItems;
  const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
  const SQ = [[0, 0], [4, 0], [4, 3], [0, 3]], L = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];

  t('outdoor: polygon area either way round, an L-shape, a point inside', () => {
    near(G.polyArea(SQ), 12); near(G.polyArea([...SQ].reverse()), 12); assert.ok(G.signedArea(SQ) > 0 && G.signedArea([...SQ].reverse()) < 0);
    near(G.polyArea(L), 12); assert.equal(G.pointInPoly([1, 1], L), true); assert.equal(G.pointInPoly([3, 3], L), false); assert.equal(G.pointInPoly([5, 1], SQ), false);
    near(G.pathLength(SQ, true), 14); near(G.pathLength(SQ), 11);
  });
  t('outdoor: rectangle from two taps (any two opposite corners), too thin is refused', () => {
    assert.deepEqual(G.rectPts([3, 2], [1, 5]), [[1, 2], [3, 2], [3, 5], [1, 5]]);
    assert.equal(G.rectPts([0, 0], [0.05, 3]), null);
  });
  t('outdoor: a free shape closes on its first corner; double taps and a repeated first corner are dropped', () => {
    assert.equal(G.closesAt([[0, 0], [2, 0]], [0, 0.1]), false, 'needs 3 corners first');
    assert.equal(G.closesAt([[0, 0], [2, 0], [2, 2]], [0.2, 0.1]), true); assert.equal(G.closesAt([[0, 0], [2, 0], [2, 2]], [1, 1]), false);
    assert.deepEqual(G.cleanPoly([[0, 0], [0, 0.004], [2, 0], [2, 2], [0, 0]]), [[0, 0], [2, 0], [2, 2]]);
    assert.deepEqual(G.cleanPoly([[0, 0], [3, 0], [0, 0]], false), [[0, 0], [3, 0], [0, 0]], 'a line may come back to its start');
    near(G.snap(1.234), 1.25); near(G.snap(-0.026), -0.05);
  });
  t('outdoor: pool walls face the water whichever way the corners were drawn; the stone edge sits outside', () => {
    for (const pts of [SQ, [...SQ].reverse(), L]) {
      const s = G.poolShell(pts, 1.6); near(s.depth, 1.6); near(s.floorY, -1.6); assert.ok(s.waterY < 0 && s.waterY > -0.5);
      for (const w of s.walls) { const m = [(w.a[0] + w.b[0]) / 2 + w.n[0] * 0.05, (w.a[1] + w.b[1]) / 2 + w.n[1] * 0.05]; assert.ok(G.pointInPoly(m, pts), `inward normal of ${w.a}->${w.b}`); near(Math.hypot(...w.n), 1); }
      for (const c of G.copingPieces(pts, 0.3)) assert.equal(G.pointInPoly([c.cx, c.cz], pts), false, 'coping is outside the water');
    }
    near(G.poolShell(SQ, 9).depth, 3); near(G.poolShell(SQ, 0).depth, 1.4);
  });
  t('outdoor: a sloped driveway rises from its first side to the far side', () => {
    const up = G.slopeFn(SQ, 0.6); near(up(2, 0), 0); near(up(2, 3), 0.6); near(up(1, 1.5), 0.3);
    const dn = G.slopeFn([[0, 3], [4, 3], [4, 0], [0, 0]], 0.6); near(dn(2, 3), 0); near(dn(2, 0), 0.6);
    near(G.slopeFn(SQ, 0)(2, 3), 0);
  });
  t('outdoor: fence posts at every corner and never more than the spacing apart', () => {
    const p = G.fencePosts([[0, 0], [5, 0], [5, 1]], 2);
    assert.deepEqual(p, [[0, 0], [1.67, 0], [3.33, 0], [5, 0], [5, 1]]);
    for (let i = 1; i < p.length; i++) assert.ok(Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) <= 2.0001);
    assert.equal(G.fencePosts([[0, 0], [2, 0]], 2).length, 2);
  });
  t('outdoor: turning a group keeps its shape; a new corner goes mid-side; an item\'s footprint turns with it', () => {
    assert.deepEqual(G.rotateAround([2, 0], [0, 0], 90), [0, -2]); assert.deepEqual(G.rotateAround([2, 0], [0, 0], 180), [-2, 0]);
    assert.deepEqual(G.insertCorner(SQ, 1), [[0, 0], [4, 0], [4, 1.5], [4, 3], [0, 3]]);
    const fp = G.footprint({ kind: 'sofa', pos: [0, 0], rot: 90, w: 2, d: 1 }), xs = fp.map((q) => q[0]), zs = fp.map((q) => q[1]);
    near(Math.max(...xs) - Math.min(...xs), 1); near(Math.max(...zs) - Math.min(...zs), 2);
  });
  t('furniture: every piece builds from its own parts, a few meshes each, with userData for the live view', () => {
    const P = new F.Palette('real');
    for (const kind of Object.keys(F.FURN)) {
      const o = F.buildFurniture({ id: `x-${kind}`, kind }, P); let meshes = 0; o.traverse((m) => { if (m.isMesh) meshes++; });
      assert.equal(o.userData.itemId, `x-${kind}`); assert.equal(o.userData.kind, kind); assert.ok(meshes >= 1 && meshes <= 12, `${kind}: ${meshes} meshes`);
    }
    const aw = F.buildFurniture({ id: 'a', kind: 'awning', style: 'zip' }, P); F.setAwning(aw, 0.5); near(aw.getObjectByName('cover').scale.y, 1);
    assert.ok(F.buildFurniture({ id: 'p', kind: 'pot' }, P).userData.leaf, 'a plant has leaves that can droop');
    P.dispose();
  });
  t('items: what is saved is checked (kinds, floors, sizes, links) and the yard keeps pool depth and fences', () => {
    const floors = new Set(['g']);
    assert.equal(I.fpCleanItem({ kind: 'spaceship', pos: [0, 0] }, floors), null);
    const a = I.fpCleanItem({ id: 'k1', kind: 'counter', floor: 'nope', pos: [1.234, 2], rot: 45.4, w: 3.456, color: 'red', grp: 'g1', binId: 'x' }, floors);
    assert.deepEqual(a, { id: 'k1', kind: 'counter', floor: null, pos: [1.23, 2], rot: 45, w: 3.46, grp: 'g1' });
    const b = I.fpCleanItem({ kind: 'bin', floor: 'g', pos: [0, 0], binId: 'demotrash0', icon: 'glass', color: '#2563eb' }, floors);
    assert.equal(b.floor, 'g'); assert.equal(b.binId, 'demotrash0'); assert.equal(b.icon, 'glass'); assert.ok(/^[\w-]+$/.test(b.id));
    assert.equal(I.fpCleanItem({ kind: 'awning', pos: [0, 0], style: '<b>', coverId: 'ha:cover.patio' }, floors).style, 'arm');
    assert.deepEqual(I.yardAreaExtras({ kind: 'pool', depth: 9 }), { depth: 1.4 }); assert.deepEqual(I.yardAreaExtras({ kind: 'driveway', rise: 0.456 }), { rise: 0.46 });
    const ln = I.yardLines([{ id: 'f', kind: 'fence', pts: [[0, 0], [3, 0]], h: 9 }, { kind: 'wall', pts: [[0, 0], [1, 1]] }, { kind: 'hedge', pts: [[0, 0]] }]);
    assert.deepEqual(ln, [{ id: 'f', kind: 'fence', pts: [[0, 0], [3, 0]], h: 1.2 }]);
  });
}
