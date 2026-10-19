/* Unit tests for the Network page's model (74m-meraki-api.js, 74n-net-model.js, 74o-net-demo.js): the polite Meraki
   client against a stand-in Meraki (fake-meraki.mjs) - pages through Link headers, waits out a 429, retries a 500,
   never follows a next-page link to another host - the whole model from one key, the map (reported and estimated
   links), kinds and states, the suggested layout, public addresses kept from non-admins, and the network tests'
   ping parsing and limits (77-apptests.js). Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import { startFakeMeraki } from './fake-meraki.mjs';

export default async function networkTests(t) {
  const N = globalThis.__casatorchNet, AT = globalThis.__casatorchAT;

  t('network: kinds from Meraki product types, models and UniFi features', () => {
    assert.equal(N.netTypeOf({ productType: 'appliance' }), 'appliance');
    assert.equal(N.netTypeOf({ productType: 'cellularGateway' }), 'cellular');
    for (const [m, k] of [['MX67', 'appliance'], ['Z3', 'appliance'], ['MS120-8LP', 'switch'], ['MR44', 'wireless'], ['CW9166', 'wireless'], ['MV12W', 'camera'], ['MT10', 'sensor'], ['MG21', 'cellular'], ['UDM-Pro', 'appliance'], ['USW-24-PoE', 'switch'], ['U7-Pro', 'wireless'], ['XYZ', 'other']]) assert.equal(N.netTypeOf({ model: m }), k, m);
    assert.equal(N.netTypeOf({ model: 'Thing', features: ['accessPoint', 'switching'] }), 'wireless');
  });
  t('network: states map to online, alerting, offline, dormant, unknown', () => {
    for (const [s, k] of [['online', 'online'], ['ONLINE', 'online'], ['alerting', 'alerting'], ['PENDING_ADOPTION', 'alerting'], ['UPDATING', 'alerting'], ['offline', 'offline'], ['CONNECTION_INTERRUPTED', 'offline'], ['dormant', 'dormant'], [null, 'unknown'], ['weird', 'unknown']]) assert.equal(N.netStatusOf(s), k, String(s));
  });
  t('network: Link next pages only to the same Meraki address', () => {
    const b = 'https://api.meraki.com/api/v1';
    assert.equal(N.mkNext('<https://api.meraki.com/api/v1/organizations/1/devices?startingAfter=Q>; rel=next, <https://api.meraki.com/api/v1/x>; rel=first', b), 'https://api.meraki.com/api/v1/organizations/1/devices?startingAfter=Q');
    assert.equal(N.mkNext('<https://evil.example.com/api/v1/organizations?x=1>; rel=next', b), null);
    assert.equal(N.mkNext('<https://api.meraki.com/other/path>; rel=next', b), null);
    assert.equal(N.mkNext('<https://api.meraki.com/api/v1/a>; rel=prev', b), null);
    assert.equal(N.mkNext('', b), null);
  });
  t('network: Retry-After in seconds or as a date, capped at a minute; backoff when missing', () => {
    assert.equal(N.mkRetryAfter('2', 0), 2000); assert.equal(N.mkRetryAfter('600', 0), 60_000); assert.equal(N.mkRetryAfter(undefined, 2), 4000);
    const d = N.mkRetryAfter(new Date(Date.now() + 3000).toUTCString(), 0); assert.ok(d > 1500 && d <= 3000, String(d));
  });
  await t('network: the rate limit spaces calls on one organization (10 a second -> 9 gaps of 100 ms)', async () => {
    const lane = `test:${Math.random()}`, t0 = Date.now();
    await Promise.all(Array.from({ length: 10 }, () => N.mkWait(lane, 10)));
    const took = Date.now() - t0; assert.ok(took >= 850 && took < 1600, `${took} ms`);
    const other = Date.now(); await N.mkWait(`test:${Math.random()}`, 10); assert.ok(Date.now() - other < 50, 'another organization is not held up');
  });
  await t('network: the whole model from one Meraki key - pages, a 429 waited out, a 500 retried, no foreign next page', async () => {
    const fake = await startFakeMeraki({ retryAfter: 1 });
    process.env.CASATORCH_MERAKI_BASE = fake.base;
    try {
      const s = { id: `t${Date.now()}`, name: 'Meraki', kind: 'meraki' }, t0 = Date.now();
      const m = await N.netDeepMeraki(s, 'mk-test');
      assert.ok(Date.now() - t0 >= 900, 'waited for Retry-After');
      const st = fake.hits.filter((h) => h.startsWith('GET /organizations/O1/devices/statuses'));
      assert.equal(st.length, 1 + 4, 'one 429, then 4 pages of 2');
      assert.ok(st.some((h) => h.includes('startingAfter=S-AP2')), 'followed the Link header');
      assert.equal(m.devices.length, 7);
      assert.deepEqual(m.devices.map((d) => d.type).sort(), ['appliance', 'cellular', 'switch', 'switch', 'wireless', 'wireless', 'wireless']);
      assert.equal(m.devices.find((d) => d.id === 'S-AP2').status, 'offline');
      assert.equal(fake.hits.filter((h) => h.startsWith('GET /networks/N1/clients')).length, 2, 'the 500 was tried again once');
      assert.equal(m.clients.total, 2); assert.equal(m.clients.wired, 1); assert.equal(m.clients.top[0].name, 'TV');
      assert.deepEqual(m.clients.byBand, [['2.4', 2], ['5', 7], ['6', 2]]);
      assert.equal(m.devices.find((d) => d.id === 'S-AP1').clients, 1);
      const w1 = m.uplinks.find((u) => u.iface === 'wan1'); assert.equal(w1.status, 'active'); assert.equal(w1.lat, 12); assert.equal(w1.loss, 1);
      assert.equal(m.uplinks.find((u) => u.iface === 'wan2').via, 'S-MG', 'the LLDP link says the cellular gateway feeds WAN 2');
      assert.ok(!JSON.stringify(m).includes('secret-should-not-be-kept'), 'nothing kept that the page doesn\'t need');
      assert.equal(m.license, null, 'per-device licensing: no overview, no error');
      assert.equal(m.wifi.aps.find((a) => a.id === 'S-AP1').radios.find((r) => r.band === '2.4').util, 42);
      assert.equal(m.ports.length, 2); assert.ok(m.ports[0].ports.find((p) => p.id === '8').uplink); assert.equal(m.ports[0].ports[0].watts, 2);
      assert.equal(m.events[0].text, 'Port 3 went down');
      assert.deepEqual(m.firmware.map((f) => [f.product, f.next]), [['switch', 'MS 17.1'], ['wireless', null]]);
      assert.ok(!fake.hits.some((h) => h.includes('evil')), 'a next page on another host is never asked');
      // cached: asking again within the minute costs nothing
      const before = fake.hits.length; await N.netDeepMeraki(s, 'mk-test'); assert.equal(fake.hits.length, before);
      await assert.rejects(N.netDeepMeraki({ id: 'bad', name: 'x' }, 'wrong'), /refused/);
      // the map: reported links, then the likely parent for the rest
      const tp = N.netTopology(m), by = Object.fromEntries(tp.nodes.map((n) => [n.id, n]));
      assert.equal(by['S-MX'].parent, 'internet'); assert.equal(by['S-MS1'].parent, 'S-MX'); assert.equal(by['S-MS2'].parent, 'S-MS1'); assert.equal(by['S-AP2'].parent, 'S-MS2');
      assert.equal(by['S-AP1'].parent, 'S-MS2', 'an access point with no reported link goes under the access switch');
      assert.equal(tp.inferred, 2);
      assert.ok(tp.edges.some((e) => e.kind === 'wan2' && !e.tree), 'the cellular backup is a side link');
      assert.equal(tp.edges.find((e) => e.b === 'S-AP2').status, 'offline'); assert.equal(tp.edges.find((e) => e.a === 'internet' && e.b === 'S-MX').label, 'WAN 1');
    } finally { delete process.env.CASATORCH_MERAKI_BASE; await fake.close(); }
  });
  t('network: a map with no gateway hangs from the top switch; nothing is ever left off', () => {
    const tp = N.netTopology({ devices: [{ id: 'a', name: 'AP', type: 'wireless', status: 'online' }, { id: 's', name: 'SW', type: 'switch', status: 'online' }, { id: 'x', name: 'Box', type: 'other', status: 'offline' }], uplinks: [], links: [] });
    const by = Object.fromEntries(tp.nodes.map((n) => [n.id, n]));
    assert.equal(by.s.parent, 'internet'); assert.equal(by.a.parent, 's'); assert.equal(by.x.parent, 's');
    assert.ok(tp.nodes.every((n) => n.layer != null));
  });
  t('network: public addresses only for admins', () => {
    const m = N.netDemoModel(), masked = N.netMaskModel(m, false), shown = N.netMaskModel(m, true);
    assert.ok(masked.uplinks.every((u) => !u.publicIp && !u.gateway && !u.dns.length));
    assert.equal(shown.uplinks[0].publicIp, '203.0.113.24');   // scrub-ok
    assert.ok(!('names' in masked));
  });
  t('network: the suggested layout follows what is connected', () => {
    const ids = (l) => l.map((x) => x.id);
    const none = N.netSuggest({ rich: false, pro: false });
    assert.ok(ids(none).includes('net-start') && ids(none).includes('net-apptests') && !ids(none).includes('net-ports'));
    const demo = N.netSuggest({ rich: true, pro: true, ...N.netModelFacts(N.netDemoModel()), dns: true, security: true });
    for (const id of ['net-internet', 'net-devices', 'net-wifi', 'net-topo', 'net-events', 'net-clients', 'net-ports', 'net-apptests', 'net-dns', 'net-health', 'net-sources']) assert.ok(ids(demo).includes(id), id);
    assert.equal(new Set(ids(demo)).size, demo.length, 'no tile twice');
    for (const x of demo) assert.ok(x.w >= 1 && x.w <= 12 && x.h >= 1);
  });
  t('network: the demo is rich and uses only documentation and home addresses', () => {
    const m = N.netDemoModel(), h = N.netDemoHistory(), s = JSON.stringify(m);
    assert.ok(m.devices.length >= 10 && m.events.length >= 8 && m.ports.length === 2 && m.wifi.aps.length === 4);
    for (const ip of s.match(/\b\d{1,3}(\.\d{1,3}){3}\b/g)) assert.ok(/^(192\.168\.1\.|203\.0\.113\.|198\.51\.100\.|8\.8\.8\.8)/.test(ip), ip);
    assert.equal(h.inet.length, 288); assert.ok(h.up['dm-mx:wan1'].length === 288);
    assert.equal(N.netTopology(m).inferred, 0, 'the demo reports every link');
  });
  t('network tests: ping output from Linux, a Mac and Windows', () => {
    const lin = AT.atParsePing('64 bytes from 192.168.1.20: icmp_seq=1 ttl=64 time=0.512 ms\n64 bytes from 192.168.1.20: icmp_seq=2 ttl=64 time=0.61 ms\n--- stats ---\n5 packets transmitted, 2 received, 60% packet loss, time 4005ms');   // scrub-ok
    assert.deepEqual(lin, { rtts: [0.512, 0.61], loss: 60 });
    const win = AT.atParsePing('Reply from 8.8.8.8: bytes=32 time=14ms TTL=117\nReply from 8.8.8.8: bytes=32 time<1ms TTL=117\n    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),');
    assert.deepEqual(win, { rtts: [14, 1], loss: 0 });
  });
  t('network tests: Pro only, checked hosts and ports, your own limits', () => {
    assert.equal(AT.atMake({ kind: 'ping', host: 'nas.local' }, [], false).status, 402);
    const ok = AT.atMake({ kind: 'tcp', host: 'NAS.local', port: 445 }, [], true).test; assert.deepEqual([ok.kind, ok.host, ok.port, ok.custom], ['tcp', 'nas.local', 445, true]);
    assert.equal(AT.atMake({ kind: 'tcp', host: 'nas.local', port: 70000 }, [], true).status, 400);
    assert.equal(AT.atMake({ kind: 'ping', host: '-oProxy=x' }, [], true).status, 400, 'nothing that looks like an option');
    assert.equal(AT.atMake({ kind: 'ping', host: '169.254.169.254' }, [], true).status, 400, 'never the cloud metadata address');
    assert.equal(AT.atMake({ kind: 'dnsq', host: 'example.com', server: 'not-an-ip' }, [], true).status, 400);
    assert.equal(AT.atMake({ kind: 'tcp', host: 'nas.local', port: 445 }, [ok], true).status, 400, 'no duplicates');
    assert.deepEqual(AT.atLimits({ slowMs: 80, lossPct: 5 }, true), { slowMs: 80, lossPct: 5 });
    assert.deepEqual(AT.atLimits({ slowMs: 2, lossPct: 500 }, true), {}); assert.deepEqual(AT.atLimits({ slowMs: 80 }, false), {});
    assert.ok(AT.atOver({ slowMs: 80 }, { ok: true, total: 120, loss: 0 })); assert.ok(!AT.atOver({ slowMs: 80 }, { ok: true, total: 40, loss: 0 }));
    assert.ok(AT.atOver({ lossPct: 5 }, { ok: true, total: 4, loss: 20 }));
  });
}
