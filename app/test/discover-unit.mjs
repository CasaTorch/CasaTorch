/* Unit tests for "New devices found" (src/server/29n-discover.js): what comes from the network is cleaned and kept to
   the home network, one suggestion per brand seen by hardware maker, SSDP answers sorted, rooms guessed from names,
   what is connected already left out, and the looks rate-limited. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';

export default async function discoverTests(t) {
  const D = globalThis.__casatorchDiscover, H = globalThis.__casatorch;
  const reset = () => { for (const k of Object.keys(D.disc.items)) delete D.disc.items[k]; };

  t('discover: names from the network lose control, direction and markup characters, and are cut short', () => {
    assert.equal(D.discText('Kitchen‮\u0000 <b>Speaker</b>\n\n'), 'Kitchen bSpeaker/b');
    assert.equal(D.discText('x'.repeat(200)).length, 60);
    assert.equal(D.discText('   ​  '), null);
    assert.equal(D.discText(null), null);
  });

  t('discover: only home-network addresses are kept (no internet, no metadata range, no sign-in in the address)', () => {
    for (const ok of ['192.168.1.40', '10.0.0.9', '172.20.1.2', 'http://frigate.local:5000', 'https://192.168.1.1', 'shelly-plug.local', 'frigate']) assert.ok(D.discAddrOk('shelly', ok), ok);   // scrub-ok: example addresses
    for (const bad of ['192.0.2.10', '8.8.8.8', 'example.com', 'http://example.com:5000', 'http://user:pw@192.168.1.4', '169.254.169.254', 'http://169.254.169.254/latest', 'ftp://192.168.1.4', '192.168.1.4 x', '[fe80::1]', '', null, `192.168.1.${'9'.repeat(300)}`]) assert.ok(!D.discAddrOk('shelly', bad), String(bad));
    assert.ok(!D.discAddrOk('frigate', '127.0.0.1') && D.discAddrOk('go2rtc', 'http://localhost:1984'), 'this computer only for go2rtc');
    assert.ok(D.discAddrOk('device', 'light.porch') && !D.discAddrOk('device', 'light porch<script>'));
  });

  t('discover: a typed address must be private; names that point anywhere else are refused', async () => {
    assert.equal(await D.discLanIp('192.168.1.40'), '192.168.1.40');
    assert.equal(await D.discLanIp('8.8.8.8'), null);
    assert.equal(await D.discLanIp('192.0.2.1'), null);
    assert.equal(await D.discLanIp('127.0.0.1'), null);
    assert.equal(await D.discLanIp('localhost'), null, 'this computer is not a device to add');
    assert.equal(await D.discLanIp('bad name!'), null);
    assert.equal(await D.discLanIp('999.1.1.1'), null);
  });

  t('discover: the room comes from the name (longest Home Assistant area as whole words)', () => {
    const areas = ['Kitchen', 'Living Room', 'Living', 'Den'];
    assert.equal(D.discRoomGuess('Living Room Sonos', areas), 'Living Room');
    assert.equal(D.discRoomGuess('kitchen_speaker', areas), 'Kitchen');
    assert.equal(D.discRoomGuess('Garden speaker', areas), null, '"Garden" does not contain the area "Den" as a word');
    assert.equal(D.discRoomGuess('', areas), null);
  });

  t('discover: SSDP answers - router, Hue bridge, Sonos; anything else ignored', () => {
    assert.equal(D.ssdpKind('HTTP/1.1 200 OK\r\nSERVER: Linux UPnP/1.0 IpBridge/1.60\r\nhue-bridgeid: 001788FFFE000000\r\n'), 'hue');
    assert.equal(D.ssdpKind('HTTP/1.1 200 OK\r\nSERVER: Linux UPnP/1.0 Sonos/80.1 (ZPS1)\r\n'), 'sonos');
    assert.equal(D.ssdpKind('HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n'), 'router');
    assert.equal(D.ssdpKind('HTTP/1.1 200 OK\r\nSERVER: Roku/9.0\r\n'), null);
  });

  t('discover: Ring, Meraki and UniFi gear by hardware maker - one suggestion per brand, with how many', () => {
    const maker = (mac) => ({ '00:b4:63:00:00:01': { raw: 'Ring' }, '00:b4:63:00:00:02': { raw: 'Ring' }, '00:18:0a:00:00:01': { raw: 'Cisco Meraki' }, 'aa:aa:aa:00:00:01': { raw: 'Apple' } })[mac] || null;   // scrub-ok: made-up hardware addresses
    const out = D.discBrands([{ ip: '192.168.1.20', mac: '00:b4:63:00:00:01' }, { ip: '192.168.1.21', mac: '00:b4:63:00:00:02' }, { ip: '192.168.1.30', mac: '00:18:0a:00:00:01' }, { ip: '192.168.1.40', mac: 'aa:aa:aa:00:00:01' }, { ip: 'x', mac: '00:b4:63:00:00:01' }], maker);   // scrub-ok: made-up hardware addresses
    assert.deepEqual(out.map((b) => [b.kind, b.n]).sort(), [['meraki', 1], ['ring', 2]]);
  });

  t('discover: merging a look - cleaned, kept to home addresses, one row per brand, connected gear left out', () => {
    reset();
    const n = D.discMerge([
      { kind: 'shelly', addr: '192.168.1.61', name: 'Shelly\u0007 Plug' },
      { kind: 'shelly', addr: '192.0.2.61', name: 'Internet plug' },
      { kind: 'nope', addr: '192.168.1.62' },
      { kind: 'ring', addr: '192.168.1.20', brand: true, n: 2 }, { kind: 'ring', addr: '192.168.1.21', brand: true, n: 2 },
      { kind: 'sonos', addr: '192.168.1.82', name: 'Kitchen' },
      { kind: 'device', addr: 'light.porch', name: 'Porch light', device: 'light', area: 'Porch' },
      { kind: 'device', addr: 'light.bad id', name: 'x' },
    ]);
    assert.equal(n, 4);
    assert.deepEqual(Object.keys(D.disc.items).sort(), ['device:light.porch', 'ring:brand', 'shelly:192.168.1.61', 'sonos:192.168.1.82']);
    assert.equal(D.disc.items['shelly:192.168.1.61'].name, 'Shelly Plug');
    assert.equal(D.disc.items['device:light.porch'].area, 'Porch');
    const v = D.discView(D.disc.items['ring:brand']);
    assert.equal(v.addr, null, 'a brand row names no single address'); assert.equal(v.how, 'setup'); assert.equal(v.add, 'ring-labs');
    assert.equal(D.discView(D.disc.items['sonos:192.168.1.82']).how, 'ha');
    // seen again: nothing new; the same name doesn't come twice
    assert.equal(D.discMerge([{ kind: 'shelly', addr: '192.168.1.61' }]), 0);
    reset();
  });

  t('discover: "Add by address" looks are limited to 12 a minute', () => {
    D.discIdentifyHits.length = 0;
    const now = Date.now(); let ok = 0;
    for (let i = 0; i < 20; i++) if (D.discIdentifyOk(now + i)) ok++;
    assert.equal(ok, 12);
    assert.ok(D.discIdentifyOk(now + 61_000), 'a minute later it works again');
    D.discIdentifyHits.length = 0;
  });

  await t('discover: the API refuses an internet address and never probes it', async () => {
    const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
    const B = `http://127.0.0.1:${srv.address().port}`;
    try {
      const post = (p, body) => fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify(body) });
      let r = await post('/api/discover/identify', { addr: '8.8.8.8' });
      assert.ok([400, 403, 409].includes(r.status), `status ${r.status}`);
      if (r.status === 400) assert.match((await r.json()).error, /home network/);
      r = await post('/api/discover/identify', { addr: 'http://192.168.1.1/<script>' });
      assert.ok([400, 403, 409].includes(r.status));
      r = await fetch(`${B}/api/discover/count`); assert.ok([200, 401].includes(r.status));
      if (r.status === 200) assert.equal(typeof (await r.json()).n, 'number');
      r = await post('/api/discover/__proto__/add', {}); assert.ok([403, 404, 409].includes(r.status), 'no prototype keys');
    } finally { srv.close(); }
  });
}
