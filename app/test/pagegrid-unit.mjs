/* Unit tests for the page grid (60-layout.js) and the Energy page's data (35e-energy.js): the suggested layouts that
   CasaTorch builds from what the house has, saving and resetting a page's layout (house, screen), and the energy
   helpers - what a reading is, how live flows split, standby waste, hours by day, rooms. Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export default async function pageGridTests(t) {
  const P = globalThis.__casatorchPages, E = globalThis.__casatorchEnergy, H = globalThis.__casatorch;
  const ids = (list) => list.map((x) => x.id);

  t('page grid: an empty house is suggested how to get started, not a wall of empty charts', () => {
    const s = P.suggestPageTiles('energy', { metered: [], history: 0 });
    assert.deepEqual(ids(s), ['en-start', 'en-now']);
  });
  t('page grid: solar and a battery bring the power flow first, with solar, battery and sources tiles', () => {
    const s = P.suggestPageTiles('energy', { metered: [{ id: 'shelly:a', name: 'Fridge' }], solar: true, battery: true, hours: true, history: 20, pro: true, rate: true, rooms: 3, standby: true });
    assert.equal(s[0].id, 'en-flow');
    for (const id of ['en-now', 'en-usage', 'en-baseload', 'en-bill', 'en-top', 'en-sources', 'en-solar', 'en-battery', 'en-heatmap', 'en-rooms', 'en-week', 'en-standby', 'en-report']) assert.ok(ids(s).includes(id), id);
    assert.ok(!ids(s).includes('en-start'), 'nothing left to set up');
    assert.ok(!ids(s).includes('en-tou') && !ids(s).includes('en-co2'), 'no peak hours or carbon without a price or intensity');
    for (const x of s) { assert.ok(x.w >= 1 && x.w <= 12 && x.h >= 1, `${x.id} size`); }
  });
  t('page grid: plugs only - no flow diagram, the top consumers and one tile per top plug (at most 4)', () => {
    const metered = Array.from({ length: 6 }, (_, i) => ({ id: `ha:switch.p${i}`, name: `Plug ${i}` }));
    const s = P.suggestPageTiles('energy', { metered, history: 2, rate: false });
    assert.ok(!ids(s).includes('en-flow'));
    assert.ok(ids(s).includes('en-top'));
    const devs = s.filter((x) => x.id === 'en-dev');
    assert.deepEqual(devs.map((x) => x.device), ['ha:switch.p0', 'ha:switch.p1', 'ha:switch.p2', 'ha:switch.p3']);
    assert.equal(devs[0].title, 'Plug 0');
    assert.ok(ids(s).includes('en-start'), 'no price yet: the getting-started tile stays');
    assert.ok(!ids(s).includes('en-week') && !ids(s).includes('en-report'), 'not enough history for weeks');
  });
  t('page grid: a known tariff and grid carbon add the peak-hours and carbon tiles', () => {
    const s = P.suggestPageTiles('energy', { metered: [{ id: 'a', name: 'A' }], tariff: true, co2: true, rate: true, history: 10 });
    assert.ok(ids(s).includes('en-tou') && ids(s).includes('en-co2'));
  });
  t('page grid: cameras, controls and alerts suggestions follow the house', () => {
    assert.deepEqual(ids(P.suggestPageTiles('cameras', { cameras: 0 })), ['cam-start']);
    assert.deepEqual(ids(P.suggestPageTiles('cameras', { cameras: 3, frigate: true, hidden: 1 })), ['cam-wall', 'cam-det', 'cam-hidden']);
    assert.deepEqual(ids(P.suggestPageTiles('cameras', { cameras: 2 })), ['cam-wall']);
    const c = P.suggestPageTiles('controls', { groups: { lights: 3, plugs: 2, sensors: 9, locks: 0 } });
    assert.equal(c[0].id, 'ctl-summary');
    assert.deepEqual(c.filter((x) => x.id === 'ctl-group').map((x) => x.opts.group), ['lights', 'plugs', 'sensors']);
    assert.deepEqual(ids(P.suggestPageTiles('controls', { groups: {} })), ['ctl-start']);
    assert.ok(ids(P.suggestPageTiles('alerts', {})).includes('al-now'));
  });
  t('page grid: suggested tiles pass the layout cleaner unchanged (ids, devices, options)', () => {
    const s = P.suggestPageTiles('energy', { metered: [{ id: 'ha:switch.tv_stand', name: 'TV' }], solar: true, hours: true, history: 9, rate: true });
    const c = P.cleanTiles(s);
    assert.equal(c.length, s.length);
    assert.equal(c.find((x) => x.id === 'en-dev').device, 'ha:switch.tv_stand');
    assert.deepEqual(P.cleanSeen(['en-flow', 'en-dev@ha:switch.x', 'BAD ID', 'x'.repeat(80)]), ['en-flow']);
  });

  await t('page grid: layouts are saved per page and per screen, read back, and reset', async () => {
    const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok)); const B = `http://127.0.0.1:${srv.address().port}`;
    const put = (body, page = 'energy') => fetch(`${B}/api/page-layout/${page}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const get = async (q = '', page = 'energy') => (await fetch(`${B}/api/page-layout/${page}${q}`)).json();
    // a set-up box (before setup, nothing but setup may change anything)
    const cfgFile = path.join(process.env.CASATORCH_DATA_DIR, 'config.json'), made = !fs.existsSync(cfgFile);
    if (made) fs.writeFileSync(cfgFile, '{}');
    const undo = globalThis.__casatorchRemote.patchConfig({ house: { name: 'Test house' } });
    try {
      const tiles = [{ id: 'en-now', w: 3, h: 2 }, { id: 'en-dev:ab12cd', w: 3, h: 2, device: 'shelly:fridge' }];
      assert.equal((await put({ scope: 'house', tiles, seen: ['en-now'] })).status, 200);
      let r = await get();
      assert.deepEqual(r.house.tiles, tiles); assert.deepEqual(r.house.seen, ['en-now']); assert.ok(Array.isArray(r.suggested));
      const file = path.join(process.env.CASATORCH_DATA_DIR, 'page-layouts.json');
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).house.energy.tiles, tiles, 'kept on disk');
      // one screen keeps its own, the rest still see the house's
      const sid = 'kitchenTablet01';
      assert.equal((await put({ scope: 'screen', screen: sid, tiles: [{ id: 'en-flow', w: 12, h: 5 }] })).status, 200);
      r = await get(`?screen=${sid}`); assert.equal(r.screen.tiles[0].id, 'en-flow'); assert.equal(r.house.tiles.length, 2);
      r = await get('?screen=otherScreen99'); assert.equal(r.screen, null);
      // other pages are separate
      assert.equal((await get('', 'cameras')).house, null);
      // bad input is refused
      assert.equal((await put({ scope: 'screen', screen: 'x', tiles })).status, 400);
      assert.equal((await put({ scope: 'house', tiles: 'nope' })).status, 400);
      assert.equal((await put({ scope: 'house', tiles }, 'nope')).status, 404);
      assert.equal((await put({ scope: 'user', tiles })).status, 400, 'no sign-in: no per-person layout');
      // reset: back to the suggestion
      assert.equal((await put({ scope: 'screen', screen: sid, reset: true })).status, 200);
      assert.equal((await get(`?screen=${sid}`)).screen, null);
      assert.equal((await put({ scope: 'house', reset: true })).status, 200);
      assert.equal((await get()).house, null);
    } finally { srv.close(); undo(); if (made) fs.rmSync(cfgFile, { force: true }); }
  });

  t('energy: what each reading is - solar, battery, grid, the whole house, an EV charger, or a device', () => {
    const r = (id, name, kind = 'sensor') => E.enRole({ id, name, kind, powerW: 100 });
    assert.equal(r('ha:sensor.solar_power', 'Solar power'), 'solar');
    assert.equal(r('ha:sensor.powerwall_battery_power', 'Powerwall battery power'), 'battery');
    assert.equal(r('ha:sensor.grid_power', 'Grid power'), 'grid');
    assert.equal(r('ha:sensor.house_consumption', 'House consumption'), 'house');
    assert.equal(r('ha:sensor.wall_connector_power', 'Wall connector power'), 'ev');
    assert.equal(r('shelly:fridge', 'Fridge', 'plug'), 'device');
    assert.ok(E.enMetered({ id: 'shelly:fridge', name: 'Fridge', kind: 'plug', powerW: 90 }));
    assert.ok(!E.enMetered({ id: 'ha:sensor.solar_power', name: 'Solar power', kind: 'sensor', powerW: 3000 }), 'solar is not a consumer');
    assert.ok(!E.enMetered({ id: 'shelly:x', name: 'X', kind: 'plug', powerW: 90, pairedTo: 'y' }), 'a plug\'s own sensor is not counted twice');
  });
  t('energy: live flows - the house is grid plus solar plus battery, and nothing made up', () => {
    const devs = [{ id: 'ha:sensor.grid_power', name: 'Grid power', kind: 'sensor', powerW: -500 }, { id: 'ha:sensor.solar_power', name: 'Solar power', kind: 'sensor', powerW: 2500 }];
    const f = E.enFlowsNow(devs, 0);
    assert.equal(f.useW, 2000); assert.equal(f.gridW, -500); assert.equal(f.solarW, 2500); assert.equal(f.selfPct, 100); assert.equal(f.battery, null); assert.equal(f.evW, null);
    const plain = E.enFlowsNow([{ id: 'shelly:a', name: 'A', kind: 'plug', powerW: 300 }], 300);
    assert.equal(plain.useW, 300); assert.equal(plain.solarW, null); assert.equal(plain.gridW, null);
  });
  t('energy: standby waste - an idle draw overnight from a device that uses much more when on, and a plug off but drawing', () => {
    const hours = {}, hk = 500_000;
    for (let k = hk - 96; k <= hk; k++) { const h = new Date(k * 3600_000).getUTCHours(); hours[k] = { w: [0, 1], d: { tv: [(h >= 1 && h < 5 ? 18 : 140) * 60, 60], fridge: [80 * 60, 60] } }; }
    const out = E.enStandby(hours, [{ id: 'tv', name: 'TV', w: 18 }, { id: 'fridge', name: 'Fridge', w: 80 }, { id: 'lamp', name: 'Lamp', w: 3, on: false }], hk, 0.2);
    const tv = out.find((x) => x.id === 'tv');
    assert.ok(tv, 'the TV is found'); assert.equal(tv.why, 'idle'); assert.equal(tv.w, 18); assert.equal(tv.costYear, Math.round(18 * 8.76 * 0.2));
    assert.ok(!out.some((x) => x.id === 'fridge'), 'a fridge that runs all day is not waste');
    assert.equal(out.find((x) => x.id === 'lamp')?.why, 'off');
  });
  t('energy: peak hours wrap past midnight', () => {
    assert.ok(E.inPeak(17, { from: 16, to: 21 })); assert.ok(!E.inPeak(21, { from: 16, to: 21 }));
    assert.ok(E.inPeak(23, { from: 22, to: 6 })); assert.ok(E.inPeak(3, { from: 22, to: 6 })); assert.ok(!E.inPeak(12, { from: 22, to: 6 }));
  });
  t('energy: a device\'s room - its Home Assistant area, else the nearest room to its pin on the 3D Home', () => {
    const fp = { floors: [{ id: 'g', rooms: [{ name: 'Kitchen', pos: [9, 3] }, { name: 'Living room', pos: [3, 3] }] }, { id: 'u', plan: { rooms: [{ name: 'Office', x: 0, y: 0, w: 4, h: 4 }] } }],
      pins: [{ deviceId: 'a', floor: 'g', pos: [8.5, 1, 2.5] }, { deviceId: 'b', floor: 'u', pos: [2, 1, 2] }, { deviceId: 'c', floor: 'g', pos: [40, 1, 40] }] };
    const roomOf = E.enRoomOf(fp);
    assert.equal(roomOf({ id: 'a' }), 'Kitchen'); assert.equal(roomOf({ id: 'b' }), 'Office'); assert.equal(roomOf({ id: 'c' }), null, 'too far from any room');
    assert.equal(roomOf({ id: 'a', area: 'Garage' }), 'Garage');
  });
  t('energy: the demo house has a believable week - solar by day, a battery that stays within 0-100%', () => {
    const devs = [{ id: 'shelly:fridge', name: 'Fridge', kind: 'plug', powerW: 90 }, { id: 'ha:switch.tv_stand', name: 'TV stand', kind: 'plug', powerW: 88 }];
    const d = E.enDemoData(devs, Date.parse('2026-10-18T19:00:00Z'));
    assert.equal(Object.keys(d.hours).length, 24 * 8);
    assert.ok(d.flows.battery.pct >= 0 && d.flows.battery.pct <= 100);
    assert.equal(d.live.length, 60);
    const solar = Object.values(d.hours).map((b) => b.f.s[0] / b.f.s[1]);
    assert.ok(Math.max(...solar) > 1000 && Math.min(...solar) === 0, 'sun by day, none at night');
  });
}
