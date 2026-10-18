/* Unit tests for 3D Home plan safety (src/server/50b-plan-backup.js: export/import .zip, restore points), the network
   on the plan (src/server/50n-plan-net.js) and the plain math in public/floorplan-net-model.js (Wi-Fi coverage estimate,
   voice "Show me" matcher). Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export default async function planNetTests(t) {
  const PB = globalThis.__casatorchPlan, PN = globalThis.__casatorchPlanNet;
  const M = await import('../public/floorplan-net-model.js');
  const FP = PB.FP_DIR, file = (n) => path.join(FP, n);
  const glb = (tag) => Buffer.concat([Buffer.from('glTF'), Buffer.alloc(16, 2), Buffer.from(tag)]);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40, 7)]);
  const plan = (pins = 2) => ({ floors: [{ id: 'f1', name: 'Ground', file: 'f1.glb', level: 0, rooms: [{ name: 'Kitchen', color: '#38bdf8', pos: [1, 2] }] },
    { id: 'd1', kind: 'drawn', name: 'Upstairs', level: 1, plan: { rooms: [{ name: 'Study', x: 0, y: 0, w: 3, h: 3 }], walls: [], bg: 'd1-bg.png', bgW: 12 } }],
  pins: Array.from({ length: pins }, (_, i) => ({ deviceId: `ha:light.l${i}`, floor: 'f1', pos: [i, 1, 1] })), netPins: [{ ref: 'modem', floor: 'f1', pos: [0, 1, 0] }],
  yard: { areas: [], items: [{ id: 'c1', kind: 'car', pos: [1, 1], bind: { home: 'ha:device_tracker.car' } }] }, openings: [{ id: 'o1', kind: 'door', deviceId: 'ha:binary_sensor.front' }] });
  const setup = (p) => { fs.mkdirSync(FP, { recursive: true }); fs.writeFileSync(file('f1.glb'), glb('one')); fs.writeFileSync(file('d1-bg.png'), png); fs.writeFileSync(file('floorplan.json'), JSON.stringify(p)); };

  t('3D plan: export and import round trip (plan, scans and pictures)', () => {
    setup(plan());
    const zip = PB.pzExport(plan()), names = [...PB.pzRead(zip).keys()].sort();
    assert.deepEqual(names, ['files/d1-bg.png', 'files/f1.glb', 'floorplan.json', 'manifest.json']);
    const r = PB.pzParse(zip);
    assert.deepEqual(r.plan.floors.map((f) => f.id), ['f1', 'd1']); assert.equal(r.plan.pins.length, 2); assert.equal(r.plan.netPins.length, 1);
    assert.ok(r.files.get('f1.glb').equals(glb('one'))); assert.ok(r.files.get('d1-bg.png').equals(png));
    assert.equal(r.summary.rooms, 2); assert.equal(r.summary.files, 2); assert.deepEqual(r.summary.warnings, []);
    fs.rmSync(file('f1.glb')); PB.rpPut(r.plan, r.files);
    assert.ok(fs.readFileSync(file('f1.glb')).equals(glb('one')), 'the scan is back on disk');
    assert.equal(JSON.parse(fs.readFileSync(file('floorplan.json'), 'utf8')).pins.length, 2);
  });
  t('3D plan: a template leaves out every link to a device', () => {
    const tp = PB.pzTemplate(plan());
    assert.equal(tp.pins.length, 0); assert.equal(tp.netPins.length, 0);
    assert.equal(tp.yard.items[0].bind, undefined); assert.equal(tp.openings[0].deviceId, undefined);
    assert.equal(tp.floors[0].rooms[0].name, 'Kitchen', 'rooms stay');
    assert.equal(PB.pzParse(PB.pzExport(plan(), true)).summary.template, true);
  });
  t('3D plan: photo-real scans travel in the .zip and in restore points; household links leave a template', () => {
    const p = plan(1); p.floors[1].scans = [{ id: 'sabc123', name: 'Study', file: 'sabc123-full.glb', low: 'sabc123-low-x1.glb', pos: [0, 0, 0] }, { id: 'sgone99', file: 'sgone99-full.glb', pos: [0, 0, 0] }];
    p.items = [{ id: 'b1', kind: 'bin', binId: 'trash' }, { id: 'p1', kind: 'pot', plantId: 'fern' }, { id: 'w1', kind: 'washer', laundryId: 'washer' }, { id: 'm1', kind: 'mailbox', mail: true }];
    p.live3d = { noRain: ['ha:cover.x'], wedges: { 'cam:1': { yaw: 0, motionId: 'ha:binary_sensor.m' } }, chips: ['weather'], views: { 'f1:0': { p: [1, 1, 1], t: [0, 0, 0] } } };
    setup(p); fs.writeFileSync(file('sabc123-full.glb'), glb('scan')); fs.writeFileSync(file('sabc123-low-x1.glb'), glb('low'));
    const zip = PB.pzExport(p), r = PB.pzParse(zip);
    assert.ok(r.files.get('sabc123-full.glb')?.equals(glb('scan')) && r.files.has('sabc123-low-x1.glb'), 'both copies of the scan are in the .zip');
    assert.deepEqual(r.plan.floors[1].scans.map((s) => s.id), ['sabc123'], 'a scan whose file is missing is left out'); assert.ok(r.summary.warnings.some((w) => /scan/.test(w)));
    const tp = PB.pzTemplate(p);
    assert.ok(tp.items.every((x) => x.binId == null && x.plantId == null && x.laundryId == null && x.mail == null), 'bins, plants, laundry and mail links go');
    assert.equal(tp.live3d.noRain, undefined); assert.equal(tp.live3d.wedges, undefined); assert.ok(tp.live3d.views, 'saved room views stay');
    fs.rmSync(PB.RP_DIR, { recursive: true, force: true });
    const id = PB.rpSnapshot('auto', { now: new Date('2026-10-17T09:00:00Z') }); assert.ok(id);
    fs.rmSync(file('sabc123-full.glb')); PB.rpPut(JSON.parse(PB.rpRead(id)), null);
    assert.ok(fs.readFileSync(file('sabc123-full.glb')).equals(glb('scan')), 'a restore point brings a deleted scan back');
    fs.rmSync(file('sabc123-full.glb')); fs.rmSync(file('sabc123-low-x1.glb')); fs.rmSync(PB.RP_DIR, { recursive: true, force: true });
  });
  t('3D plan: odd, damaged or unsafe .zip files are refused or cleaned', () => {
    assert.throws(() => PB.pzRead(Buffer.from('hello world, not a zip at all')), /not a \.zip/);
    const zip = PB.pzExport(plan()), bad = Buffer.from(zip); bad[60] ^= 0xff;
    assert.throws(() => PB.pzParse(bad), /damaged|not a CasaTorch/);
    const evil = PB.pzWrite([{ name: 'floorplan.json', data: '{"floors":[{"id":"../x","file":"../../etc.glb"},{"id":"ok","name":"Fine","file":"ok.glb","__proto__":{"polluted":1}}],"pins":[]}' },
      { name: 'files/../../evil.glb', data: glb('x') }, { name: 'files/ok.glb', data: Buffer.from('not a glb') }]);
    const r = PB.pzParse(evil);
    assert.equal(r.plan.floors.length, 0, 'bad ids and a fake .glb are left out'); assert.equal(r.files.size, 0); assert.ok(r.summary.warnings.length);
    assert.equal({}.polluted, undefined);
    const bomb = PB.pzWrite([{ name: 'floorplan.json', data: Buffer.alloc(3_000_000, 32) }]);
    assert.throws(() => PB.pzRead(bomb, { entries: 10, total: 1_000_000, json: 1 }), /too big/);
    assert.equal(PB.pzCrc(Buffer.from('123456789')), 0xcbf43926, 'CRC-32 check value');
    assert.equal(PB.pzRead(PB.pzWrite([{ name: 'a.txt', data: 'a'.repeat(5000) }])).get('a.txt').toString(), 'a'.repeat(5000), 'deflated and back');
  });
  t('3D plan: restore points keep the newest 20 and one a day for two weeks', () => {
    const now = Date.parse('2026-10-17T12:00:00Z'), ids = [];
    for (let d = 0; d < 30; d++) for (let h = 0; h < 4; h++) { const t0 = new Date(now - d * 86400_000 - h * 3600_000); ids.push(`${t0.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-auto`); }
    const gone = new Set(PB.rpPrune(ids, now)), kept = ids.filter((x) => !gone.has(x));
    assert.ok([...ids].sort().reverse().slice(0, 20).every((x) => kept.includes(x)), 'the newest 20');
    assert.equal(new Set(kept.map((x) => x.slice(0, 8))).size, 15, 'a day each for two weeks (and today)');
    assert.ok(!kept.some((x) => now - Date.parse(`${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}T00:00:00Z`) > 16 * 86400_000), 'nothing older');
  });
  t('3D plan: a restore point is kept on change only, and brings back a scan that was replaced since', () => {
    fs.rmSync(PB.RP_DIR, { recursive: true, force: true }); setup(plan(1));
    const a = PB.rpSnapshot('auto', { now: new Date('2026-10-17T10:00:00Z') }); assert.ok(a);
    assert.equal(PB.rpSnapshot('auto', { now: new Date('2026-10-17T10:00:05Z') }), null, 'nothing changed');
    fs.writeFileSync(file('floorplan.json'), JSON.stringify(plan(3)));
    const b = PB.rpSnapshot('auto', { now: new Date('2026-10-17T10:01:00Z') }); assert.ok(b && b !== a);
    assert.deepEqual(PB.rpList(), [b, a]); assert.equal(PB.rpInfo(a).pins, 2, 'one device + the internet pin');
    fs.rmSync(file('f1.glb')); fs.writeFileSync(file('f1.glb'), glb('two'));   // the scan replaced (a new file)
    fs.rmSync(file('f1.glb'));
    PB.rpPut(JSON.parse(PB.rpRead(a)), null);
    assert.ok(fs.readFileSync(file('f1.glb')).equals(glb('one')), 'the kept copy comes back');
    assert.equal(JSON.parse(fs.readFileSync(file('floorplan.json'), 'utf8')).pins.length, 1);
    assert.equal(PB.rpRead('../../etc/passwd'), null);
  });

  t('Wi-Fi estimate: distance, walls and floors lower the signal; the levels', () => {
    assert.equal(M.estimateDbm(1), -35); assert.equal(M.estimateDbm(0.2), -35, 'closer than a meter counts as a meter');
    assert.equal(M.estimateDbm(10), -65); assert.equal(M.estimateDbm(10, 2), -73); assert.equal(M.estimateDbm(10, 0, 1), -80);
    assert.equal(M.estimateDbm(10, 50), M.estimateDbm(10, M.WIFI.MAX_WALLS), 'walls are capped');
    assert.deepEqual([-50, -63, -70, -80, null].map(M.wifiLevel), ['strong', 'good', 'fair', 'weak', 'none']);
  });
  t('Wi-Fi estimate: walls crossed, two rooms\' shared wall counted once', () => {
    const walls = [[5, -1, 5, 1], [5.1, -1, 5.1, 1], [8, -1, 8, 1], [20, -1, 20, 1], [0, 3, 10, 3]];
    assert.equal(M.wallsBetween([0, 0], [10, 0], walls), 2);
    assert.equal(M.wallsBetween([0, 0], [4, 0], walls), 0);
  });
  t('Wi-Fi estimate: each room takes its best access point; offline ones are left out', () => {
    const rooms = [{ x: 1, z: 0, level: 0 }, { x: 12, z: 0, level: 0 }, { x: 1, z: 0, level: 1 }];
    const aps = [{ x: 0, z: 0, level: 0, online: true }, { x: 12, z: 1, level: 0, online: false }];
    const r = M.roomCoverage(rooms, aps, { 0: [[6, -2, 6, 2]] });
    assert.equal(r[0].level, 'strong'); assert.equal(r[0].ap, 0);
    assert.equal(r[1].walls, 1); assert.ok(r[1].dbm < -65 && r[1].ap === 0, 'the offline one does not help');
    assert.ok(r[2].dbm < r[0].dbm - 14, 'a floor between');
    assert.deepEqual(M.roomCoverage(rooms, [], {}).map((x) => x.level), ['none', 'none', 'none']);
  });
  t('voice: "show me" flies to a room, floor, device or network pin; everything else goes to the agent', () => {
    const idx = { rooms: [{ name: 'Living room', floor: 'g', i: 0 }, { name: 'Kitchen', floor: 'g', i: 1 }, { name: 'Bedroom 2', floor: 'u', i: 1 }, { name: 'Küche', floor: 'g', i: 4 }, { name: 'キッチン', floor: 'g', i: 5 }],
      floors: [{ id: 'g', name: 'Ground floor', level: 0 }, { id: 'u', name: 'Upstairs', level: 1 }], devices: [{ id: 'd1', name: 'Kitchen lights' }, { id: 'd2', name: 'Front door' }], pins: [{ ref: 'modem', name: 'Internet' }] };
    const m = (s) => M.matchVoice(s, idx), at = (s) => { const r = m(s); return r && [r.kind, r.name || null]; };
    assert.deepEqual(at('Show me the kitchen'), ['room', 'Kitchen']);
    assert.deepEqual(at('show me the living room'), ['room', 'Living room']);
    assert.deepEqual(at('kitchen'), ['room', 'Kitchen'], 'a whole name alone');
    assert.deepEqual(at('show me bedroom two'), ['room', 'Bedroom 2']);
    assert.deepEqual(at('go to upstairs'), ['floor', 'Upstairs']);
    assert.deepEqual(at('downstairs'), ['floor', 'Ground floor']);
    assert.deepEqual(at('where is the front door'), ['device', 'Front door']);
    assert.deepEqual(at('show me the internet'), ['pin', 'Internet']);
    assert.deepEqual(at('show me the whole house'), ['house', null]);
    assert.deepEqual(at('zeig mir die Küche'), ['room', 'Küche']);
    assert.deepEqual(at('キッチンを見せて'), ['room', 'キッチン']);
    for (const s of ['turn on the kitchen lights', 'unlock the front door', 'open the garage', 'what is using power', '']) assert.equal(m(s), null, s);
  });
  t('network on the plan: what each piece of gear is, and vacuum map scale from attributes', () => {
    assert.equal(PN.fpnKind({ model: 'U7-Pro', name: 'Living Room' }), 'ap'); assert.equal(PN.fpnKind({ type: 'wireless', model: 'MR36' }), 'ap');
    assert.equal(PN.fpnKind({ model: 'UDM-Pro' }), 'gateway'); assert.equal(PN.fpnKind({ model: 'MS120-8' }), 'switch'); assert.equal(PN.fpnKind({ model: 'X1', name: 'Printer' }), 'device');
    assert.ok(PN.FPN_REF.test('net:abc123:Upstairs AP') && PN.FPN_REF.test('modem') && PN.FPN_REF.test('mon:demo0') && !PN.FPN_REF.test('ha:light.x'));
    assert.deepEqual(PN.vmScale({ meters_per_pixel: 0.05 }), { mpp: 0.05, how: 'attribute' });
    assert.deepEqual(PN.vmScale({ pixel_size: 5 }), { mpp: 0.05, how: 'pixel size' });
    const xi = PN.vmScale({ calibration_points: [{ vacuum: { x: 25500, y: 25500 }, map: { x: 466, y: 1889 } }, { vacuum: { x: 26500, y: 25500 }, map: { x: 486, y: 1889 } }] });
    assert.ok(Math.abs(xi.mpp - 0.05) < 1e-9, 'Xiaomi: millimeters');
    const va = PN.vmScale({ calibration_points: [{ vacuum: { x: 0, y: 0 }, map: { x: 0, y: 0 } }, { vacuum: { x: 500, y: 0 }, map: { x: 100, y: 0 } }] });
    assert.ok(Math.abs(va.mpp - 0.05) < 1e-9, 'Valetudo: centimeters');
    assert.equal(PN.vmScale({}), null);
  });
}
