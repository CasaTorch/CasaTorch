/* Photo-real scans and plan imports: the upload check (50s-scan.js), the plan readers (public/floorplan-import.js)
   and the lining-up math (public/floorplan-scan.js). Run from unit.mjs. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';

/* A glTF binary from a JSON part and a binary part. */
function glb(json, bin = Buffer.alloc(0)) {
  let j = Buffer.from(JSON.stringify(json)); j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + (b.length ? 8 + b.length : 0), 8);
  const ch = (n, t) => { const x = Buffer.alloc(8); x.writeUInt32LE(n, 0); x.write(t, 4); return x; };
  return Buffer.concat([head, ch(j.length, 'JSON'), j, ...(b.length ? [ch(b.length, 'BIN\0'), b] : [])]);
}
const TRI = { asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], accessors: [{ count: 3, type: 'VEC3', componentType: 5126 }, { count: 3, type: 'SCALAR', componentType: 5125 }], buffers: [{ byteLength: 48 }] };

export default async function scanTests(t) {
  const SC = globalThis.__casatorchScan;
  await t('scan upload: a real, complete, self-contained .glb is accepted and counted', () => {
    const b = glb(TRI, Buffer.alloc(48));
    const info = SC.scanGlbInfo(b, b.length); assert.equal(info.tris, 1); assert.equal(info.meshes, 1);
  });
  await t('scan upload: not a glb, cut short, links outside, unknown extension, nothing to show - all refused in plain words', () => {
    const b = glb(TRI, Buffer.alloc(48));
    assert.throws(() => SC.scanGlbInfo(Buffer.from('PK\u0003\u0004 not a model at all....'), 26), /not a \.glb/);
    assert.throws(() => SC.scanGlbInfo(b, b.length + 10), /cut short/);
    const ext = glb({ ...TRI, buffers: [{ byteLength: 48, uri: 'https://example.com/x.bin' }] }); assert.throws(() => SC.scanGlbInfo(ext, ext.length), /outside it/);
    const img = glb({ ...TRI, images: [{ uri: '../../etc/passwd' }] }); assert.throws(() => SC.scanGlbInfo(img, img.length), /outside it/);
    const odd = glb({ ...TRI, extensionsRequired: ['ACME_secret_mesh'] }); assert.throws(() => SC.scanGlbInfo(odd, odd.length), /ACME_secret_mesh/);
    const draco = glb({ ...TRI, extensionsRequired: ['KHR_draco_mesh_compression'], extensionsUsed: ['KHR_draco_mesh_compression'] }); assert.equal(SC.scanGlbInfo(draco, draco.length).draco, true);
    const empty = glb({ asset: { version: '2.0' } }); assert.throws(() => SC.scanGlbInfo(empty, empty.length), /nothing to show/);
    const v1 = glb({ asset: { version: '1.0' }, meshes: TRI.meshes, accessors: TRI.accessors }); assert.throws(() => SC.scanGlbInfo(v1, v1.length), /2\.0/);
    const huge = glb({ ...TRI, accessors: [{ count: 30e6, type: 'VEC3' }, { count: 30e6, type: 'SCALAR' }] }); assert.throws(() => SC.scanGlbInfo(huge, huge.length), /million triangles/);
  });
  await t('scan files: only our own names are served', () => {
    assert.ok(SC.SC_FILE.test('smabc1234-full.glb')); assert.ok(SC.SC_FILE.test('smabc1234-low-lk2j3.glb'));
    for (const bad of ['../floorplan.json', 'smabc1234-full.glb/..', 'f1.glb', 'smabc1234-full.gltf', 's-full.glb']) assert.ok(!SC.SC_FILE.test(bad), bad);
  });

  const imp = await import('../public/floorplan-import.js'), scan = await import('../public/floorplan-scan.js');
  await t('DXF: double-line walls become one wall each, millimeters from the file, rooms snapped onto the walls', () => {
    const L = [], p = (c, v) => L.push(String(c), String(v)), line = (lay, a, b, c, d) => { p(0, 'LINE'); p(8, lay); p(10, a); p(20, b); p(11, c); p(21, d); };
    p(0, 'SECTION'); p(2, 'HEADER'); p(9, '$INSUNITS'); p(70, 4); p(0, 'ENDSEC'); p(0, 'SECTION'); p(2, 'ENTITIES');
    line('A-WALL', -60, 0, 5060, 0); line('A-WALL', -60, 120, 5060, 120);   // the bottom wall's two faces (y up in CAD)
    line('A-WALL', -60, 4000, 5060, 4000); line('A-WALL', -60, 3880, 5060, 3880);
    p(0, 'LWPOLYLINE'); p(8, 'ROOMS'); p(90, 4); p(70, 1); for (const [x, y] of [[0, 120], [5000, 120], [5000, 3880], [0, 3880]]) { p(10, x); p(20, y); }
    p(0, 'ARC'); p(8, 'DOOR'); p(10, 0); p(20, 0); p(0, 'ENDSEC'); p(0, 'EOF');
    const r = imp.parseDxf(L.join('\n'));
    assert.equal(r.units, 'mm'); assert.equal(r.unitsFromFile, true);
    const w = r.floors[0].plan.walls; assert.equal(w.length, 2);
    assert.deepEqual(w.map((x) => x.thick), [0.12, 0.12]);
    const ys = w.map((x) => x.a[1]).sort((a, b) => a - b); assert.deepEqual(ys, [0.06, 3.94]);   // y flipped (down the page), along the middle
    const room = r.floors[0].plan.rooms[0]; assert.ok(room.pts.every((q) => ys.includes(q[1])), 'the room sits on the walls\' middles');
    assert.ok(r.notes.some(([n, v]) => /left out/.test(n) && v.n === 1));
    assert.equal(imp.parseDxf(L.join('\n'), { units: 'cm' }).units, 'cm');
    assert.throws(() => imp.parseDxf('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'), /No lines/);
  });
  await t('Sweet Home 3D: levels become floors; walls, rooms, a door in its wall, a window, furniture boxes', async () => {
    const xml = `<?xml version='1.0'?><home wallHeight='250'><level id='a' name='Ground' elevation='0' height='250'/><level id='b' name='Up &amp; over' elevation='260' height='240'/>
      <wall level='a' xStart='0' yStart='0' xEnd='600' yEnd='0' thickness='20'/><wall level='a' xStart='600' yStart='0' xEnd='600' yEnd='400' thickness='20'/>
      <wall level='a' xStart='600' yStart='400' xEnd='0' yEnd='400' thickness='20'/><wall level='a' xStart='0' yStart='400' xEnd='0' yEnd='0' thickness='20'/>
      <room level='a' name='Lounge'><point x='10' y='10'/><point x='590' y='10'/><point x='590' y='390'/><point x='10' y='390'/></room>
      <doorOrWindow level='a' name='Door' x='300' y='400' width='90' depth='20' height='210' elevation='0' angle='0'/>
      <doorOrWindow level='a' name='Fenêtre' x='600' y='200' width='120' depth='20' height='110' elevation='95' angle='1.57'/>
      <pieceOfFurniture level='a' name='Sofa' x='300' y='100' width='200' depth='90' height='80' angle='3.14159'/>
      <wall level='b' xStart='0' yStart='0' xEnd='300' yEnd='0' thickness='15'/><room level='b' name='Bed'><point x='0' y='0'/><point x='300' y='0'/><point x='300' y='300'/></room></home>`;
    const file = { name: 'house.sh3d', arrayBuffer: async () => zipSync({ Home: strToU8('x'), 'Home.xml': strToU8(xml) }).buffer };
    const r = await imp.readPlanFile(file);
    assert.equal(r.floors.length, 2); assert.deepEqual(r.floors.map((f) => f.name), ['Ground', 'Up & over']); assert.deepEqual(r.floors.map((f) => f.heightM), [2.5, 2.4]);
    const g = r.floors[0].plan; assert.equal(g.walls.length, 4); assert.equal(g.walls[0].thick, 0.2);
    assert.deepEqual(g.rooms[0].pts, [[0, 0], [6, 0], [6, 4], [0, 4]]);
    const door = g.openings.find((o) => o.kind === 'door'), win = g.openings.find((o) => o.kind === 'window');
    assert.equal(door.wall, 2); assert.equal(door.t, 3); assert.equal(door.width, 0.9);   // middle of the wall, from its start (600,400)
    assert.equal(win.wall, 1); assert.equal(win.sill, 0.95);
    assert.deepEqual(r.floors[0].boxes.map((b) => [b.name, b.x, b.y, b.rot]), [['Sofa', 3, 1, 180]]);
    await assert.rejects(imp.readPlanFile({ name: 'old.sh3d', arrayBuffer: async () => zipSync({ Home: strToU8('x') }).buffer }), /older|old Sweet Home 3D|5\.3/);
    await assert.rejects(imp.readPlanFile({ name: 'plan.pdf' }), /Sweet Home 3D/);
    assert.throws(() => imp.parseSh3dXml('<html></html>'), /not a Sweet Home 3D/);
  });
  /* A scanned room as a phone saw it: 5 x 4 x 2.5 m, turned 23°, 1.3 m up and off to the side; inward faces. */
  const room = new THREE.Group(), geo = new THREE.BoxGeometry(5, 2.5, 4, 20, 10, 16); geo.translate(0, 1.25, 0); geo.scale(-1, 1, 1);
  const mesh = new THREE.Mesh(geo); room.add(mesh); mesh.position.set(2.1, 1.3, -0.7); mesh.rotation.y = 23 * Math.PI / 180;
  await t('scan: its floor, its ceiling and which way its walls run are found', () => {
    const sm = scan.surfaceSample(room), lv = scan.floorLevel(sm);
    assert.ok(Math.abs(lv.floor - 1.3) < 0.03, `floor ${lv.floor}`); assert.ok(Math.abs(lv.ceiling - 3.8) < 0.03, `ceiling ${lv.ceiling}`);
    assert.ok(Math.abs(scan.wallYaw(sm) * 180 / Math.PI + 23) < 0.5);   // turned +23° about y: its walls face -23°
    assert.ok(Math.abs(scan.squareTurn(scan.wallYaw(sm), 0) + 23) < 0.5, 'turning it back by 23° squares it with the plan');
    assert.equal(scan.squareTurn(80 * Math.PI / 180, 0), -10);
  });
  await t('scan: two corners tapped in the scan and on the plan put it in place', () => {
    const place = { pos: [4, -1.3, 3], rotY: -23, scale: 1 }, s1 = [1, 1.3, 2], s2 = [-3, 1.3, -1];
    const p1 = scan.placePoint(s1, place), p2 = scan.placePoint(s2, place);
    const fit = scan.twoPointFit(s1, s2, p1, p2, { pos: [0, -1.3, 0], rotY: 0, scale: 1 }, false);
    assert.ok(Math.abs(fit.rotY - -23) < 0.01); assert.ok(Math.abs(fit.pos[0] - 4) < 0.01 && Math.abs(fit.pos[2] - 3) < 0.01); assert.equal(fit.pos[1], -1.3);
    const big = scan.twoPointFit(s1, s2, p1, [p1[0] + (p2[0] - p1[0]) * 1.1, 0, p1[2] + (p2[2] - p1[2]) * 1.1], { pos: [0, 0, 0], rotY: 0, scale: 1 }, true);
    assert.ok(Math.abs(big.scale - 1.1) < 1e-3);
    assert.equal(scan.twoPointFit(s1, s1, p1, p2, place, false), null, 'one corner twice is not enough');
  });
  await t('scan: a Z-up PLY is told apart; the lighter copy has far fewer triangles', () => {
    const z = new THREE.BoxGeometry(5, 4, 2.5).toNonIndexed(); assert.equal(imp.upAxisOf(z), 'z');
    assert.equal(imp.upAxisOf(new THREE.BoxGeometry(5, 2.5, 4)), 'y');
    const dense = new THREE.PlaneGeometry(4, 4, 200, 200), out = scan.clusterIndices(dense, dense.index.count / 10);
    assert.ok(out.length / 3 < dense.index.count / 3 / 5, `${out.length / 3} triangles`); assert.ok(out.length > 0);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9], 3)); g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array([200, 100, 50, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 3, true));
    const c = scan.compact(g, [0, 1, 2]); assert.equal(c.attributes.position.count, 3); assert.deepEqual([...c.attributes.color.array.slice(0, 3)], [200, 100, 50], 'colors kept as bytes');
  });
}
