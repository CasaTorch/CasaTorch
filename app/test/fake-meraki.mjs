/* A stand-in Meraki Dashboard API for the tests (network-unit.mjs): one organization with a gateway, a cellular
   gateway, two switches and three access points (one offline); pages through Link headers (2 per page), a 429 with
   Retry-After on the first statuses call, a 500 once on the clients, a 400 for licensing (per-device licensing),
   and a next-page link to another host that must never be followed. Only answers the Bearer key "mk-test". */
import http from 'node:http';

export async function startFakeMeraki({ retryAfter = 1 } = {}) {
  const hits = [], once = new Set();
  let base = '';
  const DEV = [
    ['S-MX', 'Gateway', 'MX68', 'appliance', 'online'], ['S-MG', 'LTE', 'MG21', 'cellularGateway', 'online'],
    ['S-MS1', 'Core', 'MS120-8', 'switch', 'online'], ['S-MS2', 'Office', 'MS120-8', 'switch', 'alerting'],
    ['S-AP1', 'Living AP', 'MR44', 'wireless', 'online'], ['S-AP2', 'Garage AP', 'MR36', 'wireless', 'offline'], ['S-AP3', 'Patio AP', 'MR76', 'wireless', 'online'],
  ].map(([serial, name, model, productType, status]) => ({ serial, name, model, productType, status, networkId: 'N1', lanIp: '192.168.1.9' }));   // scrub-ok: test data
  const page = (res, list, url, per = 2) => {
    const u = new URL(url, base), after = u.searchParams.get('startingAfter'), i = after ? list.findIndex((x) => x.serial === after) + 1 : 0, chunk = list.slice(i, i + per);
    const headers = { 'Content-Type': 'application/json' };
    if (i + per < list.length) { u.searchParams.set('startingAfter', chunk[chunk.length - 1].serial); headers.Link = `<${new URL(base).origin}${u.pathname}${u.search}>; rel=next`; }
    res.writeHead(200, headers); res.end(JSON.stringify(chunk));
  };
  const srv = http.createServer((q, res) => {
    const u = new URL(q.url, 'http://x'), p = u.pathname.replace(/^\/api\/v1/, '');
    hits.push(`${q.method} ${p}${u.search}`);
    const J = (code, body, h = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(body)); };
    if (q.headers.authorization !== 'Bearer mk-test') return J(401, { errors: ['Invalid API key'] });
    if (p === '/organizations') return J(200, [{ id: 'O1', name: 'Test Org' }]);
    if (p === '/organizations/O1/networks') return J(200, [{ id: 'N1', name: 'Home', productTypes: ['appliance', 'switch', 'wireless', 'cellularGateway'] }]);
    if (p === '/organizations/O1/devices') return page(res, DEV, q.url);
    if (p === '/organizations/O1/devices/statuses') {
      if (!once.has('429')) { once.add('429'); return J(429, { errors: ['Too many requests'] }, { 'Retry-After': String(retryAfter) }); }
      return page(res, DEV, q.url);
    }
    if (p === '/organizations/O1/appliance/uplink/statuses') return J(200, [{ serial: 'S-MX', networkId: 'N1', uplinks: [{ interface: 'wan1', status: 'active', ip: '203.0.113.5', publicIp: '203.0.113.5', gateway: '203.0.113.1' }, { interface: 'wan2', status: 'ready', ip: '192.168.1.2' }] }]);   // scrub-ok
    if (p === '/organizations/O1/cellularGateway/uplink/statuses') return J(200, [{ serial: 'S-MG', uplinks: [{ interface: 'cellular', status: 'ready', provider: 'Example Mobile', publicIp: '198.51.100.9', iccid: 'secret-should-not-be-kept' }] }]);   // scrub-ok
    if (p === '/organizations/O1/devices/uplinksLossAndLatency') return J(200, [{ serial: 'S-MX', uplink: 'wan1', ip: '8.8.8.8', timeSeries: [{ ts: 't1', lossPercent: 0, latencyMs: 10 }, { ts: 't2', lossPercent: 2, latencyMs: 14 }] }]);
    if (p === '/organizations/O1/wireless/devices/channelUtilization/byDevice') return J(200, [{ serial: 'S-AP1', byBand: [{ band: '2.4', total: { percentage: 41.6 }, nonWifi: { percentage: 3 } }, { band: '5', total: { percentage: 12 } }] }]);
    if (p === '/organizations/O1/licenses/overview') return J(400, { errors: ['Organization uses per-device licensing'] });
    if (p === '/organizations/O1/sensor/readings/latest') return J(200, []);
    if (p === '/networks/N1/clients') {
      if (!once.has('500')) { once.add('500'); return J(500, { errors: ['oops'] }); }
      return J(200, [{ description: 'TV', usage: { sent: 100, recv: 9000 }, ssid: 'Home', recentDeviceSerial: 'S-AP1', recentDeviceConnection: 'Wireless', status: 'Online' },
        { description: 'NAS', usage: { sent: 5000, recv: 1000 }, recentDeviceSerial: 'S-MS1', recentDeviceConnection: 'Wired', status: 'Online' },
        { description: 'Phone', usage: { sent: 10, recv: 20 }, ssid: 'Home', recentDeviceSerial: 'S-AP3', recentDeviceConnection: 'Wireless', status: 'Offline' }],
      { Link: '<https://evil.example.com/api/v1/networks/N1/clients?startingAfter=x>; rel=next' });
    }
    if (p === '/networks/N1/topology/linkLayer') return J(200, { nodes: [{ derivedId: 'd1', device: { serial: 'S-MX' } }, { derivedId: 'd2', device: { serial: 'S-MS1' } }, { derivedId: 'd3', device: { serial: 'S-MS2' } }, { derivedId: 'd4', device: { serial: 'S-AP2' } }, { derivedId: 'd5', device: { serial: 'S-MG' } }],
      links: [{ ends: [{ node: { derivedId: 'd1' } }, { node: { derivedId: 'd2' } }] }, { ends: [{ node: { derivedId: 'd2' } }, { node: { derivedId: 'd3' } }] }, { ends: [{ node: { derivedId: 'd3' } }, { node: { derivedId: 'd4' } }] }, { ends: [{ node: { derivedId: 'd5' } }, { node: { derivedId: 'd1' } }] }] });
    if (p === '/networks/N1/firmwareUpgrades') return J(200, { products: { switch: { currentVersion: { shortName: 'MS 16.9' }, nextUpgrade: { time: '2026-11-01T02:00:00Z', toVersion: { shortName: 'MS 17.1' } } }, wireless: { currentVersion: { shortName: 'MR 30.7' } } } });
    if (p === '/networks/N1/wireless/clientCountHistory') return J(200, [{ clientCount: u.searchParams.get('band') === '5' ? 7 : 2 }]);
    if (p === '/networks/N1/events') return J(200, { events: u.searchParams.get('productType') === 'switch' ? [{ occurredAt: '2026-10-18T10:00:00Z', type: 'port_down', description: 'Port 3 went down', deviceSerial: 'S-MS2', deviceName: 'Office' }] : [] });
    if (/^\/devices\/S-MS\d\/switch\/ports\/statuses$/.test(p)) return J(200, [{ portId: '1', enabled: true, status: 'Connected', speed: '1 Gbps', poe: { isAllocated: true }, powerUsageInWh: 48 }, { portId: '2', enabled: true, status: 'Disconnected' }, { portId: '8', enabled: true, status: 'Connected', isUplink: true, errors: ['CRC align errors'] }]);
    if (/^\/devices\/S-AP\d\/wireless\/status$/.test(p)) return J(200, { basicServiceSets: [{ ssidName: 'Home', band: '2.4 GHz', channel: 6, channelWidth: 20, enabled: true }, { ssidName: 'Home', band: '5 GHz', channel: 36, channelWidth: 80, enabled: true }] });
    J(404, { errors: ['Not found'] });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${srv.address().port}/api/v1`;
  return { base, hits, close: () => new Promise((ok) => srv.close(ok)) };
}
