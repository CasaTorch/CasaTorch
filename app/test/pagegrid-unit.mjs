/* Unit tests for the page grid (60-layout.js) and the Energy page's data (35e-energy.js): the suggested layouts that
   CasaTorch builds from what the house has, saving and resetting a page's layout (house, screen), and the energy
   helpers - what a reading is, how live flows split, standby waste, hours by day, rooms. Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pgSrc = fs.readFileSync(path.join(HERE, '..', 'src', 'client', '06-pagegrid.js'), 'utf8');
const { sizeTier, atLeast } = new Function(`${pgSrc.slice(pgSrc.indexOf('/* @tier:start */'), pgSrc.indexOf('/* @tier:end */'))}; return { sizeTier, atLeast };`)();

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
    assert.deepEqual(P.cleanSeen(['en-flow', 'en-dev@ha:switch.x', 'ctl-group#lights', 'ctl-room~Living room', 'BAD ID', 'x'.repeat(80)]), ['en-flow', 'en-dev@ha:switch.x', 'ctl-group#lights', 'ctl-room~Living room']);
    for (const t of s) assert.deepEqual(P.cleanSeen([P.pageTileKey(t)]), [P.pageTileKey(t)], 'every suggested tile\'s key can be remembered as seen');
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

  t('page grid: Home is suggested from what the house has - cameras, switches, a thermostat, locks - and is shorter on a phone', () => {
    const full = P.suggestPageTiles('home', { devices: 40, cameras: 3, switchable: 12, climate: 1, secure: 2, media: 2, metered: 4, pro: true });
    for (const id of ['clock', 'weather', 'alerts', 'energy', 'camera', 'lights', 'thermostat', 'secure', 'calendar', 'media', 'ask']) assert.ok(ids(full).includes(id), id);
    assert.equal(new Set(ids(full)).size, full.length, 'each widget once');
    const bare = P.suggestPageTiles('home', { devices: 3, switchable: 3 });
    for (const id of ['camera', 'thermostat', 'secure', 'energy', 'ask']) assert.ok(!ids(bare).includes(id), `no ${id} without one`);
    assert.ok(ids(bare).includes('internet'), 'no meter: the internet tile instead');
    const phone = P.suggestPageTiles('home', { devices: 40, cameras: 3, switchable: 12, metered: 4 }, 'phone');
    assert.ok(phone.length < P.suggestPageTiles('home', { devices: 40, cameras: 3, switchable: 12, metered: 4 }, 'desktop').length, 'fewer tiles on a phone');
    assert.ok(!ids(phone).includes('news') && !ids(phone).includes('photos'));
    for (const x of full) assert.ok(x.w >= 1 && x.w <= 12 && x.h >= 1 && x.h <= 10, `${x.id} size`);
    assert.equal(P.cleanTiles(full).length, full.length, 'all pass the cleaner');
  });
  t('page grid: Controls gets a tile per Home Assistant room (busiest first), scenes and climate - or groups by kind without rooms', () => {
    const dev = (id, kind, area, x = {}) => ({ id, kind, name: id, area, ...x });
    const devices = [dev('l1', 'light', 'Kitchen'), dev('l2', 'light', 'Kitchen'), dev('p1', 'plug', 'Kitchen'), dev('l3', 'light', 'Office'), dev('c1', 'climate', 'Hall'), dev('s1', 'action'), dev('x1', 'plug'), dev('cam', 'camera', 'Kitchen')];
    const f = P.ctlFacts(devices);
    assert.deepEqual(f.areas.map((a) => a.name), ['Kitchen', 'Hall', 'Office']);
    assert.equal(f.areas[0].n, 3, 'cameras are not Controls');
    assert.equal(f.loose, 1, 'the plug without a room (scenes have their own tile)');
    const s = P.suggestPageTiles('controls', f);
    assert.equal(s[0].id, 'ctl-summary');
    assert.ok(s.some((x) => x.id === 'ctl-group' && x.opts.group === 'actions'), 'scenes');
    assert.ok(ids(s).includes('ctl-climate'));
    assert.deepEqual(s.filter((x) => x.id === 'ctl-room').map((x) => x.opts.area), ['Kitchen', 'Hall', 'Office', '-']);
    const noRooms = P.suggestPageTiles('controls', P.ctlFacts(devices.map((d) => ({ ...d, area: undefined }))));
    assert.ok(!ids(noRooms).includes('ctl-room'));
    assert.deepEqual(noRooms.filter((x) => x.id === 'ctl-group').map((x) => x.opts.group), ['lights', 'plugs', 'climate', 'actions']);
  });
  t('page grid: Security suggests the wall (or how to add cameras), doors, alarm, events, checklist, network - and detected cameras when some are hidden', () => {
    assert.deepEqual(ids(P.suggestPageTiles('security', { cameras: 2, hidden: 1 })), ['sec-wall', 'sec-doors', 'sec-alarm', 'sec-events', 'sec-check', 'sec-hidden', 'sec-lan']);
    assert.equal(P.suggestPageTiles('security', { cameras: 0 })[0].id, 'sec-start');
  });
  t('page grid: size tiers - Small the key number, Medium + controls, Large + a chart, Extra large + details', () => {
    assert.equal(sizeTier({ w: 3, h: 2 }), 's'); assert.equal(sizeTier({ w: 2, h: 4 }), 's');
    assert.equal(sizeTier({ w: 6, h: 2 }), 'm'); assert.equal(sizeTier({ w: 4, h: 3 }), 'm'); assert.equal(sizeTier({ w: 12, h: 2 }), 'm', 'a wide strip is still medium');
    assert.equal(sizeTier({ w: 6, h: 4 }), 'l'); assert.equal(sizeTier({ w: 8, h: 4 }), 'l');
    assert.equal(sizeTier({ w: 12, h: 4 }), 'xl'); assert.equal(sizeTier({ w: 10, h: 6 }), 'xl');
    assert.deepEqual([4, 6, 8, 12].map((w) => sizeTier({ w, h: 1, auto: true })), ['s', 'm', 'l', 'xl'], 'pages sized to their content go by width');
    assert.equal(sizeTier({ w: 12, h: 4, narrow: true, span: 2 }), 'm', 'half a phone is at most medium');
    assert.equal(sizeTier({ w: 12, h: 4, narrow: true, span: 4 }), 'xl');
    assert.ok(atLeast({ tier: 'xl' }, 'l') && !atLeast({ tier: 'm' }, 'l') && atLeast({}, 'm'));
  });
  t('page grid: old Home layouts are carried over once - the shared one and each screen\'s - and never overwrite a newer one', () => {
    const pl = { house: {}, forms: {}, users: {}, screens: { tabletA0001: { home: { tiles: [{ id: 'clock', w: 4, h: 2 }], seen: [] } } } };
    const home = { tiles: [{ id: 'weather', w: 5, h: 4 }, { id: 'device:ab12', w: 3, h: 2, device: 'hue:1' }], savedAt: '2026-01-01T00:00:00.000Z' };
    const screens = { tabletA0001: { tiles: [{ id: 'news', w: 4, h: 3 }] }, phoneB00002: { tiles: [{ id: 'alerts', w: 3, h: 2 }], at: 'x' }, emptyC0003: { tiles: [] } };
    assert.equal(P.migrateHomeLayouts(pl, home, screens), true);
    assert.deepEqual(pl.house.home.tiles, home.tiles); assert.equal(pl.house.home.seen, null, 'what is suggested on first look counts as seen');
    assert.equal(pl.screens.tabletA0001.home.tiles[0].id, 'clock', 'a screen\'s newer page layout is kept');
    assert.equal(pl.screens.phoneB00002.home.tiles[0].id, 'alerts');
    assert.ok(!pl.screens.emptyC0003, 'nothing to carry');
    assert.equal(P.migrateHomeLayouts(pl, home, screens), false, 'only once');
    assert.equal(P.migrateHomeLayouts({ house: {}, forms: {}, users: {}, screens: {} }, null, {}), false);
  });
  t('cameras: each camera once - Frigate over Home Assistant over the cloud, matched by name, Frigate camera name or address', () => {
    const cam = (id, provider, name, x = {}) => ({ id, provider, name, kind: 'camera', ...x });
    const cams = [cam('camera:fd', 'camera', 'Front Door', { source: 'frigate', frigateCam: 'front_door' }), cam('ha:camera.front_door', 'ha', 'Front door camera'), cam('ha:camera.frigate_yard', 'ha', 'Yard'),
      cam('camera:yard', 'camera', 'Back yard', { source: 'frigate', frigateCam: 'frigate_yard' }), cam('meraki:Q2XX', 'meraki', 'Garage Cam'), cam('ha:camera.garage', 'ha', 'Garage'), cam('ring:1', 'ring', 'Garage'),
      cam('camera:a', 'camera', 'Shed', { source: 'reolink', camHost: '192.168.1.20#0' }), cam('camera:b', 'camera', 'Shed again', { source: 'reolink', camHost: '192.168.1.20#0' }),
      cam('ha:camera.one', 'ha', 'Driveway'), cam('ha:camera.two', 'ha', 'Driveway'), cam('ring:2', 'ring', 'Camera')];   // scrub-ok
    const { show, hidden } = P.camDedupe(cams, {});
    assert.deepEqual([...show].sort(), ['camera:a', 'camera:fd', 'camera:yard', 'ha:camera.one', 'ha:camera.two', 'meraki:Q2XX', 'ring:2'].sort());
    const why = Object.fromEntries(hidden.map((h) => [h.id, h]));
    assert.equal(why['ha:camera.front_door'].of, 'Front Door'); assert.equal(why['ha:camera.frigate_yard'].ofId, 'camera:yard', 'Home Assistant\'s Frigate entity is the Frigate camera');
    assert.equal(why['ha:camera.garage'].ofId, 'meraki:Q2XX'); assert.equal(why['ring:1'].ofId, 'meraki:Q2XX');
    assert.equal(why['camera:b'].ofId, 'camera:a', 'the same address twice');
    assert.ok(!why['ha:camera.two'], 'two cameras of one connection with one name are two cameras');
    // added back: both show; the best one removed: the next one takes its place
    let r = P.camDedupe(cams, { shown: ['ha:camera.front_door'] }); assert.ok(r.show.has('ha:camera.front_door') && r.show.has('camera:fd'));
    r = P.camDedupe(cams, { hidden: ['camera:fd'] }); assert.ok(!r.show.has('camera:fd') && r.show.has('ha:camera.front_door'));
    assert.equal(r.hidden.find((h) => h.id === 'camera:fd').why, 'removed');
  });
  t('sensor history: one number per device, every 5 minutes, gaps left empty, at most a day', () => {
    assert.deepEqual(P.shField({ kind: 'sensor', tempC: 21.5, humidity: 40 }), ['tempC', 21.5]);
    assert.deepEqual(P.shField({ kind: 'sensor', humidity: 40 }), ['humidity', 40]);
    assert.deepEqual(P.shField({ kind: 'plug', powerW: 90 }), ['powerW', 90]);
    assert.deepEqual(P.shField({ kind: 'value', value: '12.5' }), ['value', 12.5]);
    assert.equal(P.shField({ kind: 'value', value: 'Washing' }), null); assert.equal(P.shField({ kind: 'camera' }), null);
    const st = {}, t0 = Date.parse('2026-10-18T10:00:00Z');
    P.shRecord(st, [{ id: 'a', kind: 'sensor', tempC: 20 }], t0);
    P.shRecord(st, [{ id: 'a', kind: 'sensor', tempC: 21 }], t0 + 60_000);   // same slot: replaced
    P.shRecord(st, [{ id: 'a', kind: 'sensor', tempC: 22 }], t0 + 15 * 60_000);   // two slots missed
    assert.deepEqual(st.a.v, [21, null, null, 22]);
    for (let i = 1; i < 400; i++) P.shRecord(st, [{ id: 'a', kind: 'sensor', tempC: 20 + (i % 3) }], t0 + 15 * 60_000 + i * 300_000);
    assert.equal(st.a.v.length, 288, '24 hours');
    const d = P.shDemo({ id: 'ha:sensor.x', kind: 'sensor', tempC: 21 }, t0);
    assert.equal(d.v.length, 288); assert.equal(d.v.at(-1), 21, 'ends at the reading now');
    assert.deepEqual(P.shDemo({ id: 'ha:sensor.x', kind: 'sensor', tempC: 21 }, t0).v, d.v, 'the same every time');
  });
  await t('page grid: Home is kept in step with the old layout files, both ways; per-kind (phone/tablet/computer) layouts', async () => {
    const H2 = globalThis.__casatorch, srv = H2.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok)); const B = `http://127.0.0.1:${srv.address().port}`;
    const cfgFile = path.join(process.env.CASATORCH_DATA_DIR, 'config.json'), made = !fs.existsSync(cfgFile);
    if (made) fs.writeFileSync(cfgFile, '{}');
    const undo = globalThis.__casatorchRemote.patchConfig({ house: { name: 'Test house' } });
    const req = (m, u, body) => fetch(`${B}${u}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    try {
      const tiles = [{ id: 'clock', w: 4, h: 2 }, { id: 'weather', w: 5, h: 4 }];
      assert.equal((await req('PUT', '/api/layout', { tiles })).status, 200);
      let r = await (await req('GET', '/api/page-layout/home')).json();
      assert.deepEqual(r.house.tiles, tiles, 'the old Home save shows on the Home page');
      assert.ok(Array.isArray(r.house.seen), 'seen filled in on first look');
      assert.equal((await req('PUT', '/api/page-layout/home', { scope: 'house', tiles: [{ id: 'alerts', w: 3, h: 2 }] })).status, 200);
      assert.deepEqual((await (await req('GET', '/api/layout')).json()).layout.tiles, [{ id: 'alerts', w: 3, h: 2 }], 'and the other way: an older app sees it');
      assert.equal((await req('PUT', '/api/layout', { reset: true })).status, 200);
      assert.equal((await (await req('GET', '/api/page-layout/home')).json()).house, null, 'Settings > Reset the Home screen resets it');
      // every phone
      assert.equal((await req('PUT', '/api/page-layout/controls', { scope: 'form', form: 'phone', tiles: [{ id: 'ctl-summary', w: 12, h: 1 }] })).status, 200);
      r = await (await req('GET', '/api/page-layout/controls?form=phone')).json();
      assert.equal(r.form.tiles[0].id, 'ctl-summary'); assert.equal(r.house, null);
      assert.equal((await (await req('GET', '/api/page-layout/controls?form=desktop')).json()).form, null, 'computers keep theirs');
      assert.equal((await req('PUT', '/api/page-layout/controls', { scope: 'form', form: 'fridge', tiles: [] })).status, 400);
      assert.equal((await req('PUT', '/api/page-layout/controls', { scope: 'form', form: 'phone', reset: true })).status, 200);
      assert.equal((await (await req('GET', '/api/page-layout/security')).json()).page, 'security');
      assert.deepEqual((await (await req('GET', '/api/device-history?ids=nope:1,bad id')).json()).series, {});
    } finally { srv.close(); undo(); if (made) fs.rmSync(cfgFile, { force: true }); }
  });
}
