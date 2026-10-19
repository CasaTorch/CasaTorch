/* ======================================================================
 * The demo house's network: a made-up Meraki organization, so the Network page shows everything it can.
 * Fictional names only; addresses from the documentation ranges (203.0.113.x, 198.51.100.x) and the
 * usual 192.168.1.x at home. A gateway with fiber on WAN 1 and a cellular backup on WAN 2, two switches,
 * four access points (one offline), a camera and two sensors; 24 hours of made-up history.
 * ====================================================================== */
const NETD_DEV = [
  // id, name, model, type, status, ip, firmware
  ['dm-mx', 'Gateway', 'MX68', 'appliance', 'online', '192.168.1.1', 'MX 18.211.2'],
  ['dm-mg', 'Cellular backup', 'MG21', 'cellular', 'online', '192.168.1.2', 'MG 3.2'],
  ['dm-ms1', 'Core switch', 'MS120-8LP', 'switch', 'online', '192.168.1.3', 'MS 16.9'],
  ['dm-ms2', 'Office switch', 'MS120-8', 'switch', 'alerting', '192.168.1.4', 'MS 16.9'],
  ['dm-ap1', 'Living Room AP', 'MR44', 'wireless', 'online', '192.168.1.11', 'MR 30.7'],
  ['dm-ap2', 'Upstairs AP', 'MR57', 'wireless', 'online', '192.168.1.12', 'MR 30.7'],
  ['dm-ap3', 'Garage AP', 'MR36', 'wireless', 'offline', '192.168.1.13', 'MR 30.7'],
  ['dm-ap4', 'Patio AP', 'MR76', 'wireless', 'online', '192.168.1.14', 'MR 30.7'],
  ['dm-mv', 'Porch camera', 'MV12W', 'camera', 'online', '192.168.1.21', 'MV 5.3'],
  ['dm-mt1', 'Network closet sensor', 'MT10', 'sensor', 'online', null, 'MT 2.4'],
  ['dm-mt2', 'Back door sensor', 'MT20', 'sensor', 'online', null, 'MT 2.4'],
];
const NETD_CLIENTS = { 'dm-ap1': 23, 'dm-ap2': 17, 'dm-ap3': 0, 'dm-ap4': 10, 'dm-ms1': 9, 'dm-ms2': 5 };
const NETD_TOP = [
  // name, GB down, GB up, ssid, device, os
  ['Living room TV', 17.9, 0.5, 'Maple Home', 'dm-ap1', 'Android TV'], ['Work laptop', 6.1, 3.6, 'Maple Home', 'dm-ap2', 'macOS'], ['Gaming PC', 6.4, 0.8, null, 'dm-ms2', 'Windows'],
  ['NAS', 2.2, 4.1, null, 'dm-ms1', 'Linux'], ['Family tablet', 3.9, 0.2, 'Maple Home', 'dm-ap1', 'iPadOS'], ['Phone (iOS)', 2.7, 0.6, 'Maple Home', 'dm-ap2', 'iOS'],
  ['Office desktop', 2.1, 0.9, null, 'dm-ms2', 'Windows'], ['Phone (Android)', 1.8, 0.4, 'Maple Home', 'dm-ap4', 'Android'], ['Porch camera', 0.1, 1.9, null, 'dm-ms1', null],
  ['Smart speaker', 0.9, 0.1, 'Maple IoT', 'dm-ap1', null], ['Game console', 0.8, 0.1, 'Maple Home', 'dm-ap1', null], ['Guest phone', 0.6, 0.1, 'Maple Guest', 'dm-ap4', 'iOS'],
  ['Thermostat', 0.02, 0.01, 'Maple IoT', 'dm-ap2', null], ['Robot vacuum', 0.05, 0.02, 'Maple IoT', 'dm-ap1', null],
];
/* A smooth made-up wobble that stays put for the same 5 minutes. */
const netdWave = (t, base, amp, seed = 1) => base + amp * (Math.sin(t / 3_600_000 * 0.9 + seed) * 0.6 + Math.sin(t / 900_000 * 1.7 + seed * 3) * 0.3 + Math.sin(t / 300_000 * 2.3 + seed * 7) * 0.1);
function netDemoModel(now = Date.now()) {
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  const devices = NETD_DEV.map(([id, name, model, type, status, ip, fw]) => ({ id, serial: id, name, model, type, status, net: 'demo-net', ip, fw, clients: NETD_CLIENTS[id] ?? null }));
  const t5 = Math.floor(now / NH_STEP) * NH_STEP;
  const uplinks = [
    { dev: 'dm-mx', iface: 'wan1', status: 'active', ip: '203.0.113.24', publicIp: '203.0.113.24', gateway: '203.0.113.1', dns: ['198.51.100.53', '198.51.100.54'], provider: 'Example Fiber', loss: 0, lat: netRound(netdWave(t5, 13, 2.5), 1), target: '8.8.8.8' },   // scrub-ok: documentation addresses
    { dev: 'dm-mx', iface: 'wan2', status: 'ready', ip: '192.168.1.2', publicIp: '198.51.100.7', gateway: '192.168.1.2', dns: [], via: 'dm-mg', loss: 0, lat: netRound(netdWave(t5, 41, 6, 2), 1), target: '8.8.8.8' },   // scrub-ok
    { dev: 'dm-mg', iface: 'cellular', status: 'ready', ip: '198.51.100.7', publicIp: '198.51.100.7', provider: 'Example Mobile', kind: 'LTE', signal: { rsrp: -94, rsrq: -10 } },   // scrub-ok
  ];
  const links = [['dm-mx', 'dm-ms1', 'port 3 - port 8'], ['dm-mg', 'dm-mx', 'LAN - WAN 2'], ['dm-ms1', 'dm-ap1', 'port 1'], ['dm-ms1', 'dm-ap2', 'port 2'], ['dm-ms1', 'dm-ms2', 'port 7 - port 8'], ['dm-ms1', 'dm-mv', 'port 4'], ['dm-ms2', 'dm-ap3', 'port 1'], ['dm-ms2', 'dm-ap4', 'port 2']]
    .map(([a, b, label]) => ({ a, b, label }));
  const top = NETD_TOP.map(([name, down, up, ssid, dev, os]) => ({ name, kb: Math.round((down + up) * 1_000_000), down: Math.round(down * 1_000_000), up: Math.round(up * 1_000_000), ssid, dev, wired: !ssid, os, online: true }));
  const clients = { total: 64, seen24h: 71, wired: 14, wireless: 50, bySsid: [['Maple Home', 38], ['Maple IoT', 9], ['Maple Guest', 3]], byBand: [['2.4', 14], ['5', 31], ['6', 5]], top };
  const u = (b, base) => Math.max(1, Math.round(netdWave(t5, base, base * 0.25, b.length)));
  const wifi = { aps: [
    { id: 'dm-ap1', name: 'Living Room AP', status: 'online', model: 'MR44', clients: 23, radios: [{ band: '2.4', ch: 6, width: 20, power: 14, util: u('a1', 42), nonWifi: 6, ssids: ['Maple Home', 'Maple IoT'] }, { band: '5', ch: 36, width: 80, power: 17, util: u('a1x', 22), nonWifi: 1, ssids: ['Maple Home', 'Maple Guest'] }] },
    { id: 'dm-ap2', name: 'Upstairs AP', status: 'online', model: 'MR57', clients: 17, radios: [{ band: '2.4', ch: 1, width: 20, power: 13, util: u('a2', 34), nonWifi: 4, ssids: ['Maple Home', 'Maple IoT'] }, { band: '5', ch: 149, width: 80, power: 18, util: u('a2x', 17), nonWifi: 1, ssids: ['Maple Home'] }, { band: '6', ch: 37, width: 160, power: 18, util: u('a2y', 6), nonWifi: 0, ssids: ['Maple Home'] }] },
    { id: 'dm-ap3', name: 'Garage AP', status: 'offline', model: 'MR36', clients: 0, radios: [] },
    { id: 'dm-ap4', name: 'Patio AP', status: 'online', model: 'MR76', clients: 10, radios: [{ band: '2.4', ch: 11, width: 20, power: 16, util: u('a4', 27), nonWifi: 9, ssids: ['Maple Home', 'Maple Guest'] }, { band: '5', ch: 100, width: 40, power: 18, util: u('a4x', 12), nonWifi: 2, ssids: ['Maple Home', 'Maple Guest'] }] },
  ] };
  const port = (id, up, o = {}) => ({ id: String(id), enabled: o.enabled !== false, up, uplink: !!o.uplink, speed: up ? o.speed || '1 Gbps' : null, duplex: up ? 'full' : null, poe: !!o.poe, watts: o.watts ?? null, errors: o.errors || [], warnings: o.warnings || [], clients: o.clients ?? (up ? 1 : 0), peer: o.peer || null, kb: up ? o.kb ?? 2_400_000 : 0 });
  const ports = [
    { dev: 'dm-ms1', name: 'Core switch', model: 'MS120-8LP', status: 'online', ports: [port(1, true, { poe: true, watts: 9.8, peer: 'Living Room AP' }), port(2, true, { poe: true, watts: 11.2, peer: 'Upstairs AP' }), port(3, true, { speed: '1 Gbps', clients: 1, peer: 'NAS' }), port(4, true, { poe: true, watts: 6.1, peer: 'Porch camera', speed: '100 Mbps' }),
      port(5, true, { clients: 3 }), port(6, false), port(7, true, { peer: 'Office switch' }), port(8, true, { uplink: true, peer: 'Gateway' }), port(9, false, { enabled: false }), port(10, false)] },
    { dev: 'dm-ms2', name: 'Office switch', model: 'MS120-8', status: 'alerting', ports: [port(1, false, { peer: 'Garage AP', warnings: ['No link - the device on this port is off'] }), port(2, true, { peer: 'Patio AP' }), port(3, true, { peer: 'Office desktop' }), port(4, true, { peer: 'Gaming PC' }),
      port(5, true, { speed: '100 Mbps', errors: ['CRC align errors'], peer: 'Printer' }), port(6, false), port(7, false), port(8, true, { uplink: true, peer: 'Core switch' })] },
  ];
  const events = [
    [9, 'Client connected to Upstairs AP', 'wireless', 'dm-ap2', 'Phone (iOS)'], [26, 'Port 5 on Office switch: CRC align errors (cable or port)', 'switch', 'dm-ms2'], [48, 'WAN 1 latency rose to 64 ms for 4 minutes', 'appliance', 'dm-mx'],
    [95, 'New device on Maple IoT: Smart speaker', 'wireless', 'dm-ap1', 'Smart speaker'], [180, 'Garage AP stopped answering', 'wireless', 'dm-ap3'], [182, 'Port 1 on Office switch went down', 'switch', 'dm-ms2'],
    [310, 'Cellular backup signal good (LTE)', 'cellularGateway', 'dm-mg'], [520, 'Firmware upgrade scheduled for switches', 'switch', null], [790, 'DHCP lease renewed for Work laptop', 'appliance', 'dm-mx', 'Work laptop'], [1380, 'Gateway started (planned restart)', 'appliance', 'dm-mx'],
  ].map(([min, text, cat, dev, client]) => ({ at: ago(min), type: null, text, cat, dev, devName: dev ? NETD_DEV.find((d) => d[0] === dev)?.[1] : null, client: client || null, net: 'Home' }));
  const firmware = [
    { product: 'appliance', net: 'Home', current: 'MX 18.211.2', next: null, at: null, latest: 'MX 18.211.2' },
    { product: 'switch', net: 'Home', current: 'MS 16.9', next: 'MS 17.1', at: new Date(now + 3 * 86400_000).toISOString(), latest: 'MS 17.1' },
    { product: 'wireless', net: 'Home', current: 'MR 30.7', next: null, at: null, latest: 'MR 30.7' },
    { product: 'camera', net: 'Home', current: 'MV 5.3', next: null, at: null, latest: 'MV 5.3' },
    { product: 'cellular', net: 'Home', current: 'MG 3.2', next: null, at: null, latest: 'MG 3.2' },
  ];
  const license = { status: 'OK', expires: new Date(now + 287 * 86400_000).toISOString(), counts: { MX: 1, MG: 1, MS: 2, MR: 4, MV: 1, MT: 2 } };
  return { kind: 'meraki', source: { id: 'demo-meraki', name: 'Cisco Meraki' }, at: new Date(now).toISOString(), org: 'Maple Street', networks: [{ id: 'demo-net', name: 'Home' }], devices, uplinks, links, clients, wifi, ports, events, firmware, license, notes: [] };
}
/* 24 hours of made-up history: the internet's latency, each uplink's loss and latency, clients through the day. */
function netDemoHistory(now = Date.now()) {
  const pts = Array.from({ length: NH_KEEP }, (_, i) => Math.floor(now / NH_STEP) * NH_STEP - (NH_KEEP - 1 - i) * NH_STEP);
  const hourOfDay = (t) => new Date(t).getHours() + new Date(t).getMinutes() / 60;
  const spike = (t, at, w = 3) => (Math.abs((now - t) / NH_STEP - at) < w ? 1 : 0);
  return {
    inet: pts.map((t) => [t, netRound(netdWave(t, 10.5, 1.8, 4) + spike(t, 10) * 46, 1)]),
    up: {
      'dm-mx:wan1': pts.map((t) => [t, spike(t, 10) ? 1.6 : spike(t, 140, 1) ? 0.4 : 0, netRound(netdWave(t, 13, 2.5) + spike(t, 10) * 48, 1)]),
      'dm-mx:wan2': pts.map((t) => [t, 0, netRound(netdWave(t, 41, 6, 2), 1)]),
    },
    speed: Array.from({ length: 30 }, (_, i) => { const t = Math.floor(now / (4 * 3600_000)) * 4 * 3600_000 - (29 - i) * 4 * 3600_000; return [t, netRound(netdWave(t, 925, 25, 5), 1), netRound(netdWave(t, 41, 2, 6), 1)]; }),
    clients: pts.map((t) => { const h = hourOfDay(t); return [t, Math.round(34 + 30 * Math.max(0, Math.sin((h - 6) / 24 * 2 * Math.PI) * 0.6 + (h >= 17 && h <= 23 ? 0.45 : 0)) + netdWave(t, 0, 3, 8))]; }),
  };
}
/* The demo's source row on the Network page: the same devices as the model. */
function netDemoSource() { const m = netDemoModel(); return { id: 'demo-meraki', kind: 'meraki', kindName: 'Cisco Meraki', name: 'Cisco Meraki', url: null, region: 'us', ok: true, error: null,
  summary: { org: m.org, devices: m.devices.length, offline: m.devices.filter((d) => d.status === 'offline').length, alerting: m.devices.filter((d) => d.status === 'alerting').length, clients: m.clients.total },
  devices: m.devices.map((d) => ({ name: d.name, model: d.model, ip: d.ip, online: netUp(d.status), alerting: d.status === 'alerting', state: d.status, type: d.type })) }; }
DEMO_NET.push(netDemoSource(), DEMO_PIHOLE);   // the Network page, the Connect page and the 3D home's demo pins all read these
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchNet = { netTopology, netTypeOf, netStatusOf, netDeepMeraki, netSuggest, netMaskModel, netModelFacts, mkGet, mkNext, mkWait, mkRetryAfter, mkLanes, mkCache, netDemoModel, netDemoHistory, nhPush };
