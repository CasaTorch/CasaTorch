/* The 3D home, live: unit tests for the pure rules (public/floorplan-live-core.js) and the server's replay
   record and "window open while it rains" rule (src/server/50l-live3d.js). Called from unit.mjs. */
import assert from 'node:assert/strict';

export default async function live3dTests(t) {
  const C = await import('../public/floorplan-live-core.js');
  const L = globalThis.__casatorchLive3d;

  t('live3d: approach moves smoothly, never overshoots, snaps at the end', () => {
    let v = 0; const seen = [];
    for (let i = 0; i < 200; i++) { v = C.approach(v, 1, 1 / 60, 4); seen.push(v); }
    assert.ok(seen.every((x, i) => x <= 1 && (i === 0 || x >= seen[i - 1])));
    assert.equal(seen.at(-1), 1);
    assert.ok(C.approach(0, 1, 1 / 60, 4) < 0.1);   // one frame is a small step
    assert.equal(C.approach(NaN, 0.4, 0.016), 0.4);   // first value: straight there
    assert.ok(Math.abs(C.approach(0, 1, 5, 4) - C.approach(0, 1, 0.25, 4)) < 1e-9);   // a long pause (a hidden tab) is capped
  });
  t('live3d: how open - contact, cover position, tilt, states', () => {
    assert.equal(C.openAmount({ open: true }), 1);
    assert.equal(C.openAmount({ open: false }), 0);
    assert.equal(C.openAmount({ position: 40, open: true }), 0.4);
    assert.equal(C.openAmount({ position: '100' }), 1);
    assert.equal(C.openAmount({ tilt: true, open: true }), 0.35);
    assert.equal(C.openAmount({ state: 'opening' }), 1);
    assert.equal(C.openAmount(null), 0);
    assert.equal(C.coverAmount({ position: 25 }), 0.75);   // a blind 25% open covers three quarters of the window
  });
  t('live3d: leaf motion follows the drawn opening (pivot, openDir, slide, lift)', () => {
    const door = C.leafMotion('door', 1, { openDir: -1 });
    assert.ok(Math.abs(door.ry + 1.4) < 1e-9 && door.ry2 === 1.4 && door.dx === 0);
    { const z = C.leafMotion('door', 0, { openDir: 1 }); assert.ok(z.sy === 1 && [z.ry, z.rx, z.dx, z.dy, z.ry2, z.ryPanel2].every((v) => v === 0)); }   // shut: no offset at all
    assert.equal(C.leafMotion('slider', 0.5, { slide: 1.2 }).dx, 0.6);
    { const g = C.leafMotion('garage', 1, { lift: 2 }); assert.ok(Math.abs(g.dy - 1.84) < 1e-9 && Math.abs(g.sy - 0.08) < 1e-9 && Math.abs(g.dy + 2 * g.sy - 2) < 1e-9); }   // rolled up: the top edge stays at the top
    assert.ok(C.leafMotion('skylight', 1, { openDir: -1 }).rx < 0);
    assert.ok(C.leafMotion('window', 1, { tilt: true }).rx < 0 && C.leafMotion('window', 1, { tilt: true }).ry === 0);
    assert.equal(C.leafMotion('bifold', 1, { openDir: 1 }).ryPanel2, -2.6);
    assert.equal(C.leafMotion('door', 7, { openDir: 1 }).ry, 1.4);   // clamped
  });
  t('live3d: heating red, cooling blue (hvac_action first, else a careful guess)', () => {
    assert.equal(C.hvacOf({ kind: 'climate', hvac: 'heating', mode: 'cool' }), 'heating');
    assert.equal(C.hvacOf({ kind: 'climate', mode: 'heat', tempC: 19, targetC: 21 }), 'heating');
    assert.equal(C.hvacOf({ kind: 'climate', mode: 'heat', tempC: 21, targetC: 21 }), 'idle');
    assert.equal(C.hvacOf({ kind: 'climate', mode: 'cool', tempC: 25, targetC: 22 }), 'cooling');
    assert.equal(C.hvacOf({ kind: 'climate', mode: 'off', tempC: 25, targetC: 22 }), 'off');
    assert.equal(C.hvacOf({ kind: 'light' }), null);
    assert.equal(C.liveGlow({ kind: 'climate', hvac: 'heating' })[0], '#ff5a36');
    assert.equal(C.liveGlow({ kind: 'climate', hvac: 'cooling' })[0], '#3b9cff');
    assert.equal(C.liveGlow({ kind: 'climate', hvac: 'idle' }), null);
    assert.equal(C.liveGlow({ kind: 'climate', hvac: 'heating', online: false }), null);
  });
  t('live3d: cooktop and oven glow while on, TVs glow while playing', () => {
    assert.ok(C.liveGlow({ kind: 'plug', name: 'Induction cooktop', powerW: 1800 }));
    assert.equal(C.liveGlow({ kind: 'plug', name: 'Oven', powerW: 2 }), null);
    assert.ok(C.liveGlow({ kind: 'switch', name: 'Oven', on: true }));
    assert.equal(C.liveGlow({ kind: 'light', name: 'Oven light', on: true }), null);
    assert.ok(C.isTv({ kind: 'media', name: 'Loft TV' }) && !C.isTv({ kind: 'media', name: 'Kitchen speaker' }) && C.isTv({ kind: 'media', name: 'x', haClass: 'tv' }));
    assert.ok(C.liveGlow({ kind: 'media', name: 'Bedroom TV', playing: true }));
    assert.equal(C.liveGlow({ kind: 'media', name: 'Bedroom TV', playing: false }), null);
  });
  t('live3d: lamps in their real color unless fixed; fans by speed', () => {
    assert.equal(C.lampColor({ rgb: '#ff0000' }, { color: '#00ff00' }, null, false), '#ff0000');
    assert.equal(C.lampColor({ rgb: '#ff0000' }, { color: '#00ff00' }, null, true), '#00ff00');
    assert.equal(C.lampColor({ kelvin: 2700 }, {}, () => '#ffaa66', false), '#ffaa66');
    assert.equal(C.lampColor({}, {}, null, false), '#ffc477');
    assert.equal(C.fanTurns({ on: false, percent: 80 }), 0);
    assert.ok(C.fanTurns({ on: true, percent: 100 }) > C.fanTurns({ on: true, percent: 20 }));
    assert.ok(C.fanTurns({ on: true }) > 0);
  });
  t('live3d: replay - the state at any moment, dots, power between samples', () => {
    const T0 = 1_000_000;
    const series = { L: [[T0, { on: false }], [T0 + 100, { on: true, brightness: 50 }], [T0 + 300, { on: false }]], D: [[T0 + 50, { open: true }], [T0 + 60, { open: false }]], M: [[T0 + 10, { motion: true }], [T0 + 20, { motion: false }]] };
    assert.equal(C.stateAt(series.L, T0 - 5).on, false);   // before the window: the first known state
    assert.deepEqual(C.stateAt(series.L, T0 + 150), { on: true, brightness: 50 });
    assert.deepEqual(C.stateAt(series.L, T0 + 300), { on: false, brightness: 50 });
    const f = C.replayFrame(series, T0 + 55); assert.equal(f.D.open, true); assert.equal(f.L.on, false); assert.equal(f.M.motion, false);
    const dots = C.replayDots(series, { L: 'light', D: 'sensor', M: 'sensor' }, T0, T0 + 1000, () => true);
    assert.deepEqual(dots.map((d) => [d.id, d.type]), [['M', 'motion'], ['D', 'open'], ['L', 'light']]);
    assert.equal(C.replayDots(series, {}, T0, T0 + 1000, () => false).filter((d) => d.type === 'motion').length, 0);   // daytime motion isn't news
    assert.equal(C.powerAt([[0, 100], [10, 300]], 5), 200);
    assert.equal(C.powerAt([[0, 100], [10, 300]], 99), 300);
    assert.equal(C.powerAt([], 5), null);
  });
  t('live3d: quality levels and night dimming', () => {
    assert.equal(C.qualityOf('old', 2).shadows, false);
    assert.equal(C.qualityOf('old', 2).ratio, 0.75);
    assert.equal(C.qualityOf('high', 3).ratio, 2);
    assert.equal(C.qualityOf('auto', 2, 0).level, 'auto');
    assert.equal(C.qualityOf('auto', 2, 2).shadows, false);   // auto, stepped all the way down: like an old tablet
    const at = (h, m = 0) => { const d = new Date(2026, 9, 17, h, m); return d; };
    assert.equal(C.dimNow('off', at(23), -0.5), false);
    assert.equal(C.dimNow('sun', at(12), -0.3), true);
    assert.equal(C.dimNow('sun', at(23), 0.4), false);
    assert.equal(C.dimNow('sun', at(23), null), true);   // no place set: 21:00 to 07:00
    assert.equal(C.dimNow('hours', at(23, 30), null, '22:00', '07:00'), true);
    assert.equal(C.dimNow('hours', at(7, 0), null, '22:00', '07:00'), false);
    assert.equal(C.dimNow('hours', at(13), null, '12:00', '14:00'), true);
  });
  t('live3d: a sunlight patch is cut to the floor (the rest lands on a wall)', () => {
    const c = C.clipToBox([[2, -1], [4, -1], [4, 1], [2, 1]], [0, 0, 10, 5]);
    assert.deepEqual(c.map((q) => q.map((n) => +n.toFixed(3))), [[4, 0], [4, 1], [2, 1], [2, 0]]);
    assert.deepEqual(C.clipToBox([[-3, -3], [-2, -3], [-2, -2]], [0, 0, 1, 1]), []);
    assert.equal(C.clipToBox([[1, 1], [2, 1], [2, 2], [1, 2]], [0, 0, 5, 5]).length, 4);   // all inside: unchanged
  });
  t('live3d: camera wedge points and what flies a wall panel', () => {
    const pts = C.wedgePoints(0, 90, 5, 4);
    assert.deepEqual(pts[0], [0, 0]); assert.equal(pts.length, 6);
    assert.ok(pts.slice(1).every(([x, z]) => Math.abs(Math.hypot(x, z) - 5) < 1e-9 && x > 0));
    assert.equal(C.happeningOf({ id: 'ring:1:doorbell:123', title: 'Someone at the front door' }), 'doorbell');
    assert.equal(C.happeningOf({ id: 'frigate:x', title: 'Person in the driveway' }), 'person');
    assert.equal(C.happeningOf({ id: 'smoke:x:1', severity: 'critical', title: 'Smoke alarm: Hall' }), 'critical');
    assert.equal(C.happeningOf({ id: 'battery:x', severity: 'notice', title: 'Low battery' }), null);
  });

  if (!L) return;
  t('live3d: the rain rule - open windows only, per-window opt-out, linked openings', () => {
    const devs = [
      { id: 'ha:binary_sensor.office_window', name: 'Office window', open: true, haClass: 'window', provider: 'ha' },
      { id: 'ha:binary_sensor.front_door', name: 'Front door', open: true, haClass: 'door' },
      { id: 'x:patio', name: 'Patio contact', open: true },
      { id: 'x:skylight', name: 'Bathroom skylight', open: true },
      { id: 'x:closed', name: 'Kitchen window', open: false },
      { id: 'x:off', name: 'Loft window', open: true },
    ];
    const plan = { floors: [{ plan: { openings: [{ kind: 'slider', deviceId: 'x:patio' }, { kind: 'door', deviceId: 'x:skylight' }] } }], live3d: { noRain: ['x:off'] } };
    const got = L.rainWindowRule(devs, true, plan).map((a) => a.device).sort();
    assert.deepEqual(got, ['ha:binary_sensor.office_window', 'x:patio']);   // the door stays out; a linked opening's kind wins over its name; opted-out stays out
    assert.equal(L.rainWindowRule(devs, false, plan).length, 0);
    const optOut = { floors: [{ plan: { openings: [{ kind: 'window', deviceId: 'ha:binary_sensor.office_window', noRainAlert: true }] } }] };
    assert.ok(!L.rainWindowRule(devs, true, optOut).some((a) => a.device === 'ha:binary_sensor.office_window'));
    assert.equal(L.l3Raining({ kind: 'rain' }), true); assert.equal(L.l3Raining({ kind: 'partly', rainMm: 0.4 }), true); assert.equal(L.l3Raining({ kind: 'sun', rainMm: 0 }), false);
  });
  t('live3d: the replay record keeps only changes, never people, and folds old days', () => {
    const save = { s: L.L3.s, p: L.L3.p, last: L.L3.last };
    L.L3.s = {}; L.L3.p = []; L.L3.last = {};
    const now = Date.now(), ids = new Set(['l1', 'p1', 'w1']);
    const devs = (on, w) => [{ id: 'l1', kind: 'light', on, brightness: 41 }, { id: 'p1', kind: 'presence', home: true }, { id: 'w1', kind: 'plug', on: true, powerW: w }];
    L.l3Record(devs(true, 100), ids, now - 8 * 86400_000);
    L.l3Record(devs(true, 105), ids, now - 2000);   // nothing changed enough
    L.l3Record(devs(false, 900), ids, now - 1000);
    assert.equal(L.L3.s.p1, undefined);
    assert.deepEqual(L.L3.s.l1.map((c) => c[1]), [{ on: true, brightness: 40 }, { on: false }]);
    assert.equal(L.L3.s.w1.at(-1)[1].powerW, 900);
    assert.ok(L.L3.s.l1[0][0] >= now - 7 * 86400_000 - 5000);   // the 8-day-old change folded into the start of the week
    assert.deepEqual(L.haHistFields('binary_sensor', 'door', 'on'), { open: true });
    assert.deepEqual(L.haHistFields('sensor', 'power', '1.5', 1000), { powerW: 1500 });
    assert.equal(L.haHistFields('light', null, 'unavailable'), null);
    Object.assign(L.L3, save);
  });
  t('live3d: live settings are cleaned (wedges clamped, chips only for placed devices)', () => {
    const o = L.l3Clean({ wedges: { 'camera:a': { yaw: 999, fov: 5, reach: 100, motionId: 'ha:binary_sensor.m' }, 'bad id!': {} }, chips: ['count:lights', 'ha:x', 'evil'], pets: 'dragon', views: { 'f:Room': { p: [1, 2, 3], t: [0, 0, 0] }, bad: { p: [1] } } }, { pins: [{ deviceId: 'ha:x' }] });
    assert.deepEqual(o.wedges['camera:a'], { yaw: 360, fov: 20, reach: 30, motionId: 'ha:binary_sensor.m' });
    assert.equal(o.wedges['bad id!'], undefined);
    assert.deepEqual(o.chips, ['count:lights', 'ha:x']);
    assert.equal(o.pets, null); assert.deepEqual(Object.keys(o.views), ['f:Room']);
  });
}
