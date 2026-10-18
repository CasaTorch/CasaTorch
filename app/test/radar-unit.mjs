/* Unit tests for the rain radar's tile proxy (src/server/24r-radar.js): the tile math, what it will and won't
   fetch, and the made-up demo rain. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import http from 'node:http';

export default async function radarTests(t) {
  const R = globalThis.__casatorchRadar, H = globalThis.__casatorch, RM = globalThis.__casatorchRemote;
  const SF = { lat: 37.7749, lon: -122.4194 };

  t('radar: tile math (Web Mercator) and back', () => {
    assert.deepEqual(R.radarTileOf(0, 0, 1), { x: 1, y: 1 });
    const sf = R.radarTileOf(SF.lat, SF.lon, 7);
    assert.equal(Math.floor(sf.x), 20); assert.equal(Math.floor(sf.y), 49);
    const back = R.radarLonLatOf(sf.x, sf.y, 7);
    assert.ok(Math.abs(back.lat - SF.lat) < 1e-9 && Math.abs(back.lon - SF.lon) < 1e-9);
    assert.ok(Math.abs(R.radarTileOf(89.9, 0, 3).y) < 1e-6, 'clamped at the poles');
  });
  t('radar: only tiles near home, known kinds, allowed zooms', () => {
    const A = (k, z, x, y, h = SF) => R.radarAllowed(k, z, x, y, h), r = R.RADAR_RADIUS;
    assert.equal(A('radar', 7, 20, 49), true); assert.equal(A('base', 7, 20, 49), true);
    assert.equal(A('radar', 7, 20 + r, 49 - r), true, 'the edge of the area');
    assert.equal(A('radar', 7, 20 + r + 1, 49), false, 'one tile too far east');
    assert.equal(A('base', 7, 20, 49 + r + 1), false, 'one tile too far south');
    assert.equal(A('radar', 8, 41, 98), false, 'radar stops at zoom 7');
    assert.equal(A('base', 9, 82, 197), true); assert.equal(A('base', 10, 164, 395), false, 'no street-level map');
    assert.equal(A('base', 3, 1, 3), false, 'not the whole world');
    assert.equal(A('satellite', 7, 20, 49), false); assert.equal(A('radar', 7, 20.5, 49), false); assert.equal(A('radar', 7, -1, 49), false); assert.equal(A('radar', 7, 20, 128), false);
    assert.equal(A('radar', 7, 20, 49, null), false, 'no home, nothing');
    assert.equal(A('radar', 5, 0, 17, { lat: -17.7, lon: 179.9 }), true, 'across the date line (Fiji: tile 31 and tile 0 are neighbors)');
  });
  t('radar: upstream addresses are only the providers\' hosts', () => {
    const U = R.radarUrlAllowed;
    for (const ok of ['https://api.rainviewer.com/public/weather-maps.json', 'https://tilecache.rainviewer.com/v2/radar/abc/256/7/20/49/2/1_1.png', 'https://tile.openstreetmap.org/7/20/49.png']) assert.equal(U(ok), true, ok);
    for (const bad of ['http://tile.openstreetmap.org/7/20/49.png', 'https://tile.openstreetmap.org.evil.example/7/20/49.png', 'https://evil.example/?u=https://tile.openstreetmap.org/', 'https://user:pw@tile.openstreetmap.org/1/1/1.png',   // scrub-ok (a user name in a URL, not an e-mail)
      'https://tile.openstreetmap.org:8443/1/1/1.png', 'https://a.tile.openstreetmap.org/1/1/1.png', 'https://192.168.1.20/x.png', 'file:///etc/passwd', 'not a url']) assert.equal(U(bad), false, bad);
  });
  t('radar: RainViewer\'s frame list is checked', () => {
    const j = { host: 'https://tilecache.rainviewer.com', generated: 1792281900, radar: { past: [{ time: 1792281600, path: '/v2/radar/0d4f1c' }, { time: 1792281000, path: '/v2/radar/a1b2' }, { time: 1792281300, path: '/v2/radar/../../x' }, { time: 'x', path: '/v2/radar/q' }], nowcast: [] } };
    const f = R.radarParseMaps(j);
    assert.deepEqual(f.past.map((x) => x.time), [1792281000, 1792281600], 'bad paths and times dropped, oldest first');
    assert.throws(() => R.radarParseMaps({ ...j, host: 'https://evil.example' }), /unexpected radar host/);
    assert.throws(() => R.radarParseMaps({ ...j, radar: { past: [] } }), /no radar frames/);
    assert.equal(R.radarTileUrl('radar', 7, 20, 49, f.past[1]), 'https://tilecache.rainviewer.com/v2/radar/0d4f1c/256/7/20/49/2/1_1.png');
    assert.equal(R.radarTileUrl('base', 7, 20, 49), 'https://tile.openstreetmap.org/7/20/49.png');
    assert.equal(R.radarTileUrl('radar', 7, 20, 49, { time: 1792281600, path: '/v2/radar/../x' }), null);
  });
  t('radar: map tiles are kept a week to 30 days', () => {
    const h = (cc) => new Headers(cc ? { 'cache-control': cc } : {});
    assert.equal(R.radarKeepFor(h('max-age=3600')), 7 * 86400_000);
    assert.equal(R.radarKeepFor(h('max-age=1209600')), 14 * 86400_000);
    assert.equal(R.radarKeepFor(h('max-age=99999999')), 30 * 86400_000);
    assert.equal(R.radarKeepFor(h()), 7 * 86400_000);
  });
  t('radar: outline clipping', () => {
    const sq = R.radarClipRing([[0, 0], [10, 0], [10, 10], [0, 10]], [2, 2, 5, 5]);
    assert.deepEqual(sq.map((p) => p.join(',')).sort(), ['2,2', '2,5', '5,2', '5,5']);
    assert.deepEqual(R.radarClipRing([[0, 0], [1, 0], [1, 1]], [5, 5, 6, 6]), []);
    const lines = R.radarClipLine([[0, 0], [3, 3], [4, 4], [9, 9], [3.5, 3.5]], [2, 2, 5, 5]);
    assert.equal(lines.length, 2); assert.deepEqual(lines[0], [[0, 0], [3, 3], [4, 4], [9, 9]]);
    const o = R.radarOutlineFor(SF, 7);
    assert.ok(o.land.length > 0 && o.states.length > 0, 'land and state lines near San Francisco');
    assert.ok(o.box[0] < SF.lon && o.box[2] > SF.lon && o.box[1] < SF.lat && o.box[3] > SF.lat);
  });
  t('radar: demo rain - a real PNG, and the front arrives after the newest frame', () => {
    const png = R.radarSynthTile(7, 20, 49, 0);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 256); assert.equal(png.readUInt32BE(20), 256);
    assert.equal(png.subarray(-4).readUInt32BE(0), 0xae426082, 'IEND checksum');
    assert.ok(R.radarSynthDbz(SF.lat, SF.lon, 0) < 20, 'dry at home at the newest frame');
    assert.ok(R.radarSynthDbz(SF.lat, SF.lon, 50) >= 20, 'raining at home later');
  });
  await t('radar: the tile route refuses anything outside the home\'s area', async () => {
    const restore = RM.patchConfig({ location: { name: 'Test', lat: SF.lat, lon: SF.lon } });
    const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
    const get = (p) => new Promise((ok, bad) => { http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (r) => { r.resume(); r.on('end', () => ok(r.statusCode)); }).on('error', bad); });
    try {
      for (const p of ['/api/radar/tile/base/7/60/49', '/api/radar/tile/radar/9/82/197?f=1', '/api/radar/tile/osm/7/20/49', '/api/radar/tile/base/7/20/49x', '/api/radar/tile/base/12/655/1583']) {
        const s = await get(p); assert.ok(s === 403 || s === 401, `${p} -> ${s}`);
      }
    } finally { srv.close(); restore(); }
  });
}
