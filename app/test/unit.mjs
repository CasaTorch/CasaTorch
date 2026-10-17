/* Unit tests for the parts that read other people's data formats. Run: node test/unit.mjs */
import assert from 'node:assert/strict';
import * as fsMod from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const require_ = (m) => (m === 'fs' ? fsMod : req(m));
process.env.CASATORCH_TEST = '1'; process.env.CASATORCH_DATA_DIR = '/tmp/casatorch-unit';
await import('../server.js');
const H = globalThis.__casatorch;
let n = 0; const t = (name, fn) => { const r = fn(); const ok = () => { n++; console.log('ok', name); }; return r?.then ? r.then(ok) : ok(); };
const TZ = 'America/Los_Angeles';

t('ics: zoned time to UTC (PDT)', () => assert.equal(new Date(H.zonedToUtc(2026, 10, 20, 9, 0, 0, TZ)).toISOString(), '2026-10-20T16:00:00.000Z'));
t('ics: zoned time to UTC (PST)', () => assert.equal(new Date(H.zonedToUtc(2026, 12, 1, 9, 0, 0, TZ)).toISOString(), '2026-12-01T17:00:00.000Z'));
const ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Soccer practice', 'DTSTART;TZID=America/Los_Angeles:20261005T180000', 'DTEND;TZID=America/Los_Angeles:20261005T193000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z', 'EXDATE;TZID=America/Los_Angeles:20261021T180000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Trash day', 'DTSTART;VALUE=DATE:20261001', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Dentist with a very long', '  folded title', 'DTSTART:20261023T163000Z', 'DURATION:PT45M', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a', 'RECURRENCE-ID;TZID=America/Los_Angeles:20261026T180000', 'SUMMARY:Soccer practice (moved)', 'DTSTART;TZID=America/Los_Angeles:20261027T170000', 'DTEND;TZID=America/Los_Angeles:20261027T183000', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');
const evs = H.parseIcs(ICS, TZ);
t('ics: four events parsed, folded line joined', () => { assert.equal(evs.length, 4); assert.equal(evs[2].title, 'Dentist with a very long folded title'); });
const occ = H.expandEvents(evs, Date.parse('2026-10-18T00:00:00Z'), Date.parse('2026-11-04T00:00:00Z'), TZ);
const soccer = occ.filter((e) => e.title.startsWith('Soccer'));
t('ics: weekly BYDAY, EXDATE skipped, moved instance replaces original', () => {
  assert.deepEqual(soccer.map((e) => e.start), ['2026-10-20T01:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-29T01:00:00.000Z', '2026-11-03T02:00:00.000Z']);
  assert.equal(soccer[1].title, 'Soccer practice (moved)');
});
t('ics: evening event keeps its local day across DST (Nov 2 Mon 6pm PST = 02:00Z)', () => assert.ok(soccer.some((e) => e.start === '2026-11-03T02:00:00.000Z')));
t('ics: all-day weekly', () => assert.deepEqual(occ.filter((e) => e.title === 'Trash day').map((e) => e.start.slice(0, 10)), ['2026-10-22', '2026-10-29']));
t('ics: duration', () => assert.equal(occ.find((e) => e.title.startsWith('Dentist')).end, '2026-10-23T17:15:00.000Z'));

const MET = { properties: { meta: { updated_at: '2026-10-13T20:00:00Z' }, timeseries: Array.from({ length: 30 }, (_, i) => ({ time: new Date(Date.parse('2026-10-13T20:00:00Z') + i * 3600_000).toISOString(),
  data: { instant: { details: { air_temperature: 15 + (i % 10), wind_speed: 3, relative_humidity: 60 } }, next_1_hours: { summary: { symbol_code: 'partlycloudy_day' }, details: { precipitation_amount: 0.1 } } } })) } };
t('weather: now/hours/days in °F', () => { const w = H.weatherView(MET, TZ); assert.equal(w.now.temp, 59); assert.equal(w.now.words, 'Partly cloudy'); assert.equal(w.hours.length, 12); assert.ok(w.days.length >= 2); assert.equal(w.now.wind, 7); });

const EV = { id: '401', date: '2026-10-18T20:25Z', status: { type: { state: 'in', shortDetail: 'Q3 4:12' } }, competitions: [{ competitors: [
  { homeAway: 'home', score: '17', team: { id: '25', displayName: 'San Francisco 49ers', shortDisplayName: '49ers', abbreviation: 'SF', logo: 'x' } },
  { homeAway: 'away', score: '10', team: { id: '26', displayName: 'Seattle Seahawks', shortDisplayName: 'Seahawks', abbreviation: 'SEA' } }], broadcasts: [{ names: ['FOX'] }] }] };
t('sports: game view', () => { const g = H.gameView(EV, 'nfl'); assert.equal(g.state, 'in'); assert.equal(g.home.abbr, 'SF'); assert.equal(g.home.score, '17'); assert.equal(g.broadcast, 'FOX'); });
t('sports: schedule score objects', () => { const e = structuredClone(EV); e.competitions[0].competitors[0].score = { displayValue: '24' }; assert.equal(H.gameView(e, 'nfl').home.score, '24'); });

t('rss + atom', () => {
  const rss = '<rss><channel><title>NPR</title><item><title><![CDATA[Big &amp; news]]></title><link>https://example.com/a</link><pubDate>Tue, 13 Oct 2026 18:00:00 GMT</pubDate></item></channel></rss>';
  const atom = '<feed><title>Verge</title><entry><title>Gadget</title><link href="https://example.com/b"/><updated>2026-10-13T17:00:00Z</updated></entry></feed>';
  const a = H.parseFeed(rss), b = H.parseFeed(atom);
  assert.equal(a.items[0].title, 'Big & news'); assert.equal(a.items[0].at, '2026-10-13T18:00:00.000Z'); assert.equal(b.items[0].link, 'https://example.com/b'); assert.equal(b.title, 'Verge');
});
t('home assistant: every kind of entity becomes a device', () => {
  const S = (entity_id, state, attributes = {}) => H.haDevice({ entity_id, state, attributes });
  assert.equal(S('light.k', 'on', { brightness: 255 }).brightness, 100);
  assert.equal(S('switch.p', 'on', { device_class: 'outlet' }).kind, 'plug');
  assert.equal(S('fan.f', 'on', { percentage: 40 }).percent, 40);
  const g = S('cover.garage', 'closed', { device_class: 'garage' }); assert.equal(g.kind, 'cover'); assert.equal(g.risky, true);
  assert.equal(S('cover.blinds', 'open', { current_position: 70 }).position, 70);
  assert.equal(S('scene.movie', 'scening').kind, 'action'); assert.equal(S('script.bed', 'off').kind, 'action'); assert.equal(S('button.ring', 'unknown').kind, 'action');
  assert.equal(S('vacuum.v', 'docked').kind, 'vacuum'); assert.equal(S('alarm_control_panel.a', 'armed_away').armed, true);
  assert.equal(S('person.alex', 'home').home, true);
  assert.equal(S('sensor.p', '1.2', { unit_of_measurement: 'kW' }).powerW, 1200);
  assert.equal(S('sensor.t', '68', { device_class: 'temperature', unit_of_measurement: '\u00B0F' }).tempC, 20);
  const v = S('sensor.aqi', '32', { unit_of_measurement: 'AQI' }); assert.equal(v.kind, 'value'); assert.equal(v.value, '32');
  assert.equal(S('binary_sensor.leak', 'on', { device_class: 'moisture' }).water, true);
  assert.equal(S('binary_sensor.x', 'on', { device_class: 'vibration' }).on, true);
  assert.equal(S('update.core', 'off').kind, 'value');
  assert.equal(S('sun.sun', 'above_horizon'), null);
});

t('totp: RFC 6238 test vector (T=59s -> 287082)', () => assert.equal(H.totpAt(H.b32enc(Buffer.from('12345678901234567890')), 1), '287082'));
t('totp: RFC 6238 test vector (T=1111111109 -> 081804)', () => assert.equal(H.totpAt(H.b32enc(Buffer.from('12345678901234567890')), Math.floor(1111111109 / 30)), '081804'));
t('totp: base32 round trip', () => assert.equal(H.b32dec(H.b32enc(Buffer.from('hello casatorch'))).toString(), 'hello casatorch'));
t('totp: a code is accepted once (no replay)', () => { const sec = H.b32enc(Buffer.from('abcdefghijabcdefghij')), step = Math.floor(Date.now() / 30000), code = H.totpAt(sec, step); const used = H.totpOk(sec, code, 0); assert.ok(used); assert.equal(H.totpOk(sec, code, used), 0); });
t('secrets: sealed at rest and back; tampering is caught', () => { const s = H.seal('JBSWY3DPEHPK3PXP'); assert.notEqual(s, 'JBSWY3DPEHPK3PXP'); assert.equal(H.unseal(s), 'JBSWY3DPEHPK3PXP'); assert.equal(H.unseal(`${s.slice(0, -3)}AAA`), null); });
t('passwords: short, common or username-based ones are refused', () => { assert.ok(H.passwordProblem('short', 'robin')); assert.ok(H.passwordProblem('password123', 'x')); assert.ok(H.passwordProblem('robin-is-great-1', 'robin')); assert.equal(H.passwordProblem('blue kettle on the porch', 'robin'), null); });

t('config: every token, key and password is sealed on disk, nothing else', () => {
  const c = { house: { name: 'Home' }, homeAssistant: { url: 'http://ha.local:8123', token: 'eyJhbGciOi.secret' }, ring: { refreshToken: 'rt-123' }, ai: { provider: 'anthropic', apiKey: 'sk-ant-xyz' },
    yolink: { uaid: 'ua-1', secret: 'ys-2' }, hue: { host: '10.0.0.5', username: 'hue-user' }, cameras: [{ id: 'c1', name: 'Porch', username: 'admin', password: 'pw!', snapshotUrl: 'http://admin:pw2@cam/snap.jpg' }], meraki: { apiKey: '' }, calendars: [{ name: 'Family', url: 'https://calendar.google.com/private-abc/basic.ics' }], network: { dns: { kind: 'pihole', key: 'pihole-pw' } } };
  const disk = H.sealConfig(c), text = JSON.stringify(disk);
  for (const secret of ['eyJhbGciOi.secret', 'rt-123', 'sk-ant-xyz', 'ys-2', 'ua-1', 'hue-user', 'pw!', 'pw2@cam', 'private-abc', 'pihole-pw']) assert.ok(!text.includes(secret), `${secret} left in the clear`);
  for (const plain of ['http://ha.local:8123', '10.0.0.5', 'Porch', 'anthropic', 'Family', 'pihole']) assert.ok(text.includes(plain), `${plain} should stay readable`);
  assert.equal(disk.meraki.apiKey, '');
  assert.deepEqual(H.openConfig(disk), c);
  assert.deepEqual(H.openConfig(H.sealConfig(disk)), c, 'sealing twice is harmless');
});
t('files: safe write replaces the file whole', () => { const f = '/tmp/casatorch-unit/x.json'; H.writeFileSafe(f, '{"a":1}'); H.writeFileSafe(f, '{"a":2}'); assert.equal(JSON.parse(require_('fs').readFileSync(f, 'utf8')).a, 2); });

t('alerts: push only to real push services (no sending to typed-in addresses)', () => {
  assert.ok(H.okEndpoint('https://fcm.googleapis.com/fcm/send/x')); assert.ok(H.okEndpoint('https://web.push.apple.com/abc')); assert.ok(H.okEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://127.0.0.1/x', 'not a url']) assert.ok(!H.okEndpoint(bad), bad);
});
t('alerts: a doorbell press counts as important, motion does not', () => { assert.equal(H.sevOf({ id: 'ring:1:doorbell:123', severity: 'notice' }), 'event'); assert.equal(H.sevOf({ id: 'ring:1:motion:123', severity: 'info' }), 'info'); assert.equal(H.sevOf({ severity: 'critical' }), 'critical'); });
await t('alerts: a push message decrypts on the phone it was made for', async () => {
  const { default: webpush } = await import('web-push'), ece = require_('http_ece'), ecdh = require_('crypto').createECDH('prime256v1'); ecdh.generateKeys();
  const auth = require_('crypto').randomBytes(16), v = webpush.generateVAPIDKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const d = webpush.generateRequestDetails(sub, JSON.stringify({ title: 'Water detected' }), { vapidDetails: { subject: 'mailto:test@example.com', publicKey: v.publicKey, privateKey: v.privateKey } });
  const plain = ece.decrypt(d.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth });
  assert.equal(JSON.parse(plain.toString()).title, 'Water detected');
  assert.ok(!d.body.toString('latin1').includes('Water'), 'the push service sees only ciphertext');
});

t('safety: never unlock, open a garage/gate or disarm - even when Home Assistant does not label it', () => {
  const B = H.blocked;
  assert.ok(B({ id: 'ha:lock.front', kind: 'lock', name: 'Front door' }, 'unlock')); assert.ok(!B({ id: 'ha:lock.front', kind: 'lock', name: 'Front door' }, 'lock'));
  assert.ok(B({ id: 'ha:alarm_control_panel.home', kind: 'alarm', name: 'Alarm' }, 'disarm'));
  assert.ok(B({ id: 'ha:cover.garage', kind: 'cover', haClass: 'garage', name: 'Garage' }, 'open')); assert.ok(!B({ id: 'ha:cover.garage', kind: 'cover', haClass: 'garage', name: 'Garage' }, 'close'));
  assert.ok(B({ id: 'ha:cover.thing', kind: 'cover', haClass: null, name: 'Thing' }, 'open'), 'an unlabeled cover could be a garage');
  assert.ok(!B({ id: 'ha:cover.lr_blinds', kind: 'cover', haClass: 'blind', name: 'Living room blinds' }, 'open'));
  assert.ok(B({ id: 'ha:switch.shelly_relay', kind: 'switch', name: 'Garage door opener' }, 'toggle'));
  assert.ok(B({ id: 'ha:script.unlock_front_door', kind: 'action', name: 'Let me in' }, 'run'));
  assert.ok(B({ id: 'ha:scene.disarm_home', kind: 'action', name: 'Home' }, 'run'));
  assert.ok(B({ id: 'ha:siren.hall', domain: 'siren', kind: 'switch', name: 'Siren' }, 'off'));
  assert.ok(!B({ id: 'ha:switch.kitchen_lights', kind: 'switch', name: 'Kitchen lights' }, 'toggle'));
  assert.ok(!B({ id: 'ha:light.front_door_light', kind: 'light', name: 'Front door light' }, 'toggle'), 'a light by the door is just a light');
  assert.ok(!B({ id: 'ha:switch.clock_display', kind: 'switch', name: 'Clock display' }, 'on'), '"clock" is not "lock"');
});

t('power: the house total never counts a plug or a car charger twice', () => {
  const P = (list) => H.housePower(list).watts;
  assert.equal(P([{ id: 'ha:switch.kettle', kind: 'plug', powerW: 1500 }, { id: 'ha:sensor.kettle_power', kind: 'sensor', powerW: 1500, pairedTo: 'ha:switch.kettle' }]), 1500);
  assert.equal(P([{ id: 'ha:sensor.wall_connector_power', kind: 'sensor', powerW: 7200 }, { id: 'ha:sensor.car_charger_power', kind: 'sensor', powerW: 7180 }, { id: 'p', kind: 'plug', powerW: 100 }]), 7300);
  assert.equal(P([{ id: 'ha:sensor.house_power', name: 'House power', kind: 'sensor', powerW: 2400 }, { id: 'p', kind: 'plug', powerW: 100 }]), 2400, 'a whole-house meter wins');
  assert.equal(P([{ id: 'ha:sensor.solar_power', kind: 'sensor', powerW: 3000 }, { id: 'p', kind: 'plug', powerW: 40 }]), 40, 'solar production is not use');
});

await t('secure access: Basic works from home only (IPv4 exact, IPv6 same network)', async () => {
  H.remote.homeIps = { v4: '198.51.100.7', v6: '2001:db8:aa:bb::1', at: Date.now() };
  assert.ok(await H.fromHome('198.51.100.7')); assert.ok(!(await H.fromHome('198.51.100.8')));
  assert.ok(await H.fromHome('2001:db8:aa:bb:1234::9'), 'another device on the home network');
  assert.ok(!(await H.fromHome('2001:db8:aa:cc::1')), 'a different network');
});

t('weekly report: totals, change, always-on and top device from day records', () => {
  const days = {};
  for (let i = 0; i < 14; i++) {
    const k = H.addDays('2026-10-14', -i);
    days[k] = { wh: i < 7 ? 20_000 : 25_000, peakW: 5000 + i, peakAt: `${k}T02:00:00.000Z`, nightMinW: 300, dev: { 'ev': ['Car charger', i < 7 ? 6000 : 9000], fridge: ['Fridge', 1500] }, alerts: i === 2 ? { warning: 1 } : {}, titles: { 'Doorbell: Front': 1 }, netDownMin: i === 1 ? 30 : 0 };
  }
  const s = H.weekStats(days, '2026-10-14');
  assert.equal(s.from, '2026-10-08'); assert.equal(s.kwh, 140); assert.equal(s.prevKwh, 175); assert.equal(s.changePct, -20);
  assert.equal(s.alwaysOnW, 300); assert.equal(s.topDevices[0].name, 'Car charger'); assert.equal(s.topDevices[0].kwh, 42);
  assert.equal(s.alerts.warning, 1); assert.equal(s.internetDownMin, 30); assert.deepEqual(s.repeatedAlerts, [{ title: 'Doorbell: Front', times: 7 }]);
  const r = H.ruleReport(s);
  assert.match(r.summary, /140 kWh/); assert.match(r.summary, /20% less/); assert.match(r.summary, /internet was down for about 30 minutes/);
  assert.ok(r.tips.some((x) => /300 W stays on/.test(x))); assert.ok(r.tips.some((x) => /came up 7 times/.test(x))); assert.ok(r.tips.length <= 5);
});
t('weekly report: a first week with no earlier data has no comparison', () => {
  const s = H.weekStats({ '2026-10-14': { wh: 9000, dev: {}, alerts: {}, titles: {} } }, '2026-10-14');
  assert.equal(s.daysWithData, 1); assert.equal(s.prevKwh, null); assert.equal(s.changePct, null);
  assert.match(H.ruleReport(s).summary, /9 kWh over its first day of history\./);
});

await t('history: a sample records the day and counts new alerts once', async () => {
  const now = Date.parse('2026-10-14T18:00:00Z');
  H.alerts.events.unshift({ at: new Date(now - 60_000).toISOString(), id: 'leak:x:1', severity: 'critical', title: 'Water detected: Laundry' }, { at: new Date(now - 90_000).toISOString(), id: 'cleared:x', severity: 'ok', title: 'Cleared: x' });
  H.hist.seenAlertAt = null; H.hist.last = null; H.hist.days = {};   // the test data folder survives between runs
  await H.historySample(now);
  await H.historySample(now + 5 * 60_000);
  const day = H.hist.days['2026-10-14'];
  assert.ok(day, 'a record for the house-time day'); assert.equal(day.n, 2);
  assert.equal(day.alerts.critical, 1, 'counted once, cleared ones ignored'); assert.equal(day.titles['Water detected: Laundry'], 1);
});

t('server monitor: what counts as an address', () => {
  assert.equal(H.parseTarget('http://nas.local:5000').kind, 'http');
  assert.deepEqual(H.parseTarget('192.168.1.20:22'), { kind: 'tcp', target: '192.168.1.20:22', host: '192.168.1.20', port: 22 });
  assert.equal(H.parseTarget('[fd00::5]:53').host, 'fd00::5');
  for (const bad of ['nas.local', 'ftp://x', 'http://user:pw@nas', 'host:99999', '', 'javascript:alert(1)']) assert.equal(H.parseTarget(bad), null, bad);
});
await t('server monitor: up, a server error, and a closed port', async () => {
  const http = req('node:http');
  const srv = http.createServer((q, r) => { r.statusCode = q.url === '/broken' ? 503 : 200; r.end('ok'); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); const port = srv.address().port;
  const up = await H.checkOne({ kind: 'http', target: `http://127.0.0.1:${port}/` });
  const err = await H.checkOne({ kind: 'http', target: `http://127.0.0.1:${port}/broken` });
  const tcp = await H.checkOne({ kind: 'tcp', target: `127.0.0.1:${port}` });
  srv.close();
  const closed = await H.checkOne({ kind: 'tcp', target: `127.0.0.1:${port}` });
  assert.equal(up.up, true); assert.ok(up.ms >= 0);
  assert.equal(err.up, false); assert.equal(err.error, 'answered 503');
  assert.equal(tcp.up, true); assert.equal(closed.up, false);
});

await t('network: Pi-hole v6 and v5, AdGuard, UniFi and Meraki are read correctly; bad keys are clear errors', async () => {
  const http = req('node:http'); const seen = [];
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x'); seen.push(`${q.method} ${u.pathname}`); const J = (code, o) => { r.statusCode = code; r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(o)); };
    let body = ''; q.on('data', (c) => { body += c; }); q.on('end', () => {
      const p = u.pathname;
      if (p.startsWith('/v6/api/auth')) return q.method === 'DELETE' ? J(200, {}) : JSON.parse(body).password === 'pw' ? J(200, { session: { valid: true, sid: 'S1', validity: 300 } }) : J(401, { error: {} });
      if (p === '/v6/api/stats/summary') return q.headers['x-ftl-sid'] === 'S1' ? J(200, { queries: { total: 1000, blocked: 250, percent_blocked: 25 }, clients: { active: 12 }, gravity: { domains_being_blocked: 90000 } }) : J(401, {});
      if (p === '/v6/api/dns/blocking') return J(200, { blocking: 'disabled' });
      if (p === '/v5/api/auth') return J(404, {});
      if (p === '/v5/admin/api.php') return u.searchParams.get('auth') === 'tok' ? J(200, { dns_queries_today: 500, ads_blocked_today: 50, ads_percentage_today: 10, unique_clients: 4, status: 'enabled' }) : J(200, []);
      if (p.startsWith('/ag/control/')) { if (q.headers.authorization !== `Basic ${Buffer.from('admin:pw').toString('base64')}`) return J(401, {}); return p.endsWith('status') ? J(200, { protection_enabled: true, version: 'v0.107' }) : J(200, { num_dns_queries: 200, num_blocked_filtering: 20, top_clients: [{ a: 1 }, { b: 2 }] }); }
      if (p.startsWith('/proxy/network/integration/v1/')) {
        if (q.headers['x-api-key'] !== 'key') return J(401, {});
        if (p.endsWith('/sites')) return J(200, { offset: 0, limit: 50, count: 1, totalCount: 1, data: [{ id: 's1', name: 'Default' }] });
        if (p.endsWith('/devices')) return J(200, { data: [{ name: 'UDM', model: 'UDM-Pro', state: 'ONLINE', ipAddress: '192.168.1.1' }, { name: 'Garage AP', model: 'U6', state: 'OFFLINE' }] });
        if (p.endsWith('/clients')) return J(200, { data: [{}], totalCount: 42 });
      }
      if (p.startsWith('/meraki/')) {
        if (q.headers.authorization !== 'Bearer mk') return J(401, {});
        if (p === '/meraki/organizations') return J(200, [{ id: 'o1', name: 'Home' }]);
        if (p === '/meraki/organizations/o1/devices/statuses') return J(200, [{ name: 'MX', model: 'MX67', status: 'online', lanIp: '10.0.0.1' }, { name: 'MR', model: 'MR36', status: 'offline' }, { name: 'MS', model: 'MS120', status: 'alerting' }]);
      }
      J(404, {});
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); const B = `http://127.0.0.1:${srv.address().port}`;
  process.env.CASATORCH_MERAKI_BASE = `${B}/meraki`;
  try {
    const p6 = await H.NET.pihole({ url: `${B}/v6` }, 'pw');
    assert.deepEqual([p6.summary.queries, p6.summary.blocked, p6.summary.percentBlocked, p6.summary.clients, p6.summary.protection], [1000, 250, 25, 12, false]);
    assert.ok(seen.includes('DELETE /v6/api/auth'), 'the Pi-hole session is closed');
    await assert.rejects(H.NET.pihole({ url: `${B}/v6` }, 'wrong'), /refused/);
    const p5 = await H.NET.pihole({ url: `${B}/v5` }, 'tok'); assert.equal(p5.summary.queries, 500); assert.equal(p5.summary.protection, true);
    await assert.rejects(H.NET.pihole({ url: `${B}/v5` }, 'bad'), /token was refused/);
    const ag = await H.NET.adguard({ url: `${B}/ag`, user: 'admin' }, 'pw'); assert.equal(ag.summary.percentBlocked, 10); assert.equal(ag.summary.clients, 2);
    const uf = await H.NET.unifi({ url: B }, 'key'); assert.deepEqual([uf.summary.site, uf.summary.devices, uf.summary.offline, uf.summary.clients], ['Default', 2, 1, 42]);
    await assert.rejects(H.NET.unifi({ url: B }, 'nope'), /refused/);
    const mk = await H.NET.meraki({}, 'mk'); assert.deepEqual([mk.summary.devices, mk.summary.offline, mk.summary.alerting], [3, 1, 1]); assert.equal(mk.devices.find((d) => d.name === 'MS').online, true);
  } finally { srv.close(); delete process.env.CASATORCH_MERAKI_BASE; }
});
t('network: only home-network addresses may use their own certificate', () => {
  for (const h of ['192.168.1.1', '10.0.0.2', '172.16.5.1', 'unifi.local', 'pihole', 'router.home.arpa']) assert.ok(H.isLanHost(h), h);   // scrub-ok: example addresses
  for (const h of ['api.meraki.com', '8.8.8.8', '172.32.0.1', 'example.com']) assert.ok(!H.isLanHost(h), h);
});

t('bill forecast: this month so far plus the recent average for the days left', () => {
  const days = {}; for (let d = 1; d <= 14; d++) days[`2026-10-${String(d).padStart(2, '0')}`] = { wh: 20000, n: 288 };
  days['2026-10-15'] = { wh: 10000, n: 150 };
  const f = H.billForecast(days, '2026-10-15');
  assert.equal(f.kwhSoFar, 290); assert.equal(f.avgKwhPerDay, 20); assert.equal(f.daysLeft, 16); assert.equal(f.kwh, 620); assert.equal(f.missingDays, 0);
  assert.equal(H.billForecast({ '2026-10-14': { wh: 1000, n: 288 } }, '2026-10-15'), null, 'too little history: no forecast');
});

t('Meraki MT sensors become devices the alerts understand', () => {
  const d = H.mtDevice({ serial: 'Q2XX-1', readings: [{ metric: 'temperature', temperature: { celsius: 2.5, fahrenheit: 36.5 } }, { metric: 'water', water: { present: true } }, { metric: 'door', door: { open: false } }, { metric: 'battery', battery: { percentage: 12 } }, { metric: 'humidity', humidity: { relativePercentage: 40 } }] }, new Map([['Q2XX-1', 'Garage sensor']]));
  assert.deepEqual([d.id, d.name, d.kind, d.tempC, d.water, d.open, d.battery, d.humidity], ['meraki:Q2XX-1', 'Garage sensor', 'sensor', 2.5, true, false, 12, 40]);
});

await t('integrations: one integration() call gives a camera cached pictures, ETags and a Connect card', async () => {
  let calls = 0;
  H.integration({ id: 'testcam', label: 'Test cameras', group: 'cameras', desc: 'x', connected: () => true,
    list: async () => [H.camDevice('testcam', 'c1', { name: 'Porch' })],
    camera: { every: 60_000, known: async (id) => id === 'c1', snapshot: async () => { calls++; return { buf: Buffer.from('fakejpeg'), type: 'image/jpeg' }; } } });
  const d = H.camDevice('testcam', 'c1', { name: 'Porch' });
  assert.equal(d.snapshot, '/api/cam/testcam/c1/snapshot'); assert.equal(d.stream, undefined); assert.equal(d.every, 60_000);
  const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok)); const B = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r1 = await fetch(B + d.snapshot), etag = r1.headers.get('etag'); assert.equal(r1.status, 200); assert.equal(await r1.text(), 'fakejpeg');
    const r2 = await fetch(B + d.snapshot, { headers: { 'If-None-Match': etag } }); assert.equal(r2.status, 304);
    assert.equal(calls, 1, 'the second look came from the cache');
    assert.equal((await fetch(B + '/api/cam/testcam/other/snapshot')).status, 404, 'unknown cameras are refused');
    assert.equal((await fetch(B + '/api/cam/testcam/c1/live')).status, 404, 'no live video unless the integration offers it');
    const reg = await (await fetch(B + '/api/integrations')).json();
    assert.ok(reg.integrations.some((x) => x.id === 'testcam' && x.connected && x.label === 'Test cameras'));
  } finally { srv.close(); }
});

t('device controls: values are checked before they reach Home Assistant, and the safety rule holds', () => {
  const light = H.haDevice({ entity_id: 'light.lamp', state: 'on', attributes: { brightness: 128, supported_color_modes: ['color_temp', 'hs'], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 } });
  assert.deepEqual(light.can, ['brightness', 'color', 'kelvin']);
  assert.deepEqual(H.haServiceData(light, 'color', '#ff8000'), { rgb_color: [255, 128, 0] });
  assert.throws(() => H.haServiceData(light, 'color', 'red; drop'), /colour|color/);
  assert.deepEqual(H.haServiceData(light, 'brightness', 500), { brightness_pct: 100 });
  const th = H.haDevice({ entity_id: 'climate.hall', state: 'heat', attributes: { current_temperature: 20, temperature: 21, hvac_modes: ['off', 'heat'] } });
  assert.deepEqual(th.can, ['target', 'mode']);
  assert.throws(() => H.haServiceData(th, 'mode', 'rocket'), /mode/);
  assert.ok(H.riskOf({ kind: 'alarm', id: 'ha:alarm_control_panel.home' }).only.includes('arm_away'));
  assert.ok(!H.riskOf({ kind: 'alarm', id: 'ha:alarm_control_panel.home' }).only.includes('disarm'), 'never disarm');
  assert.deepEqual(H.riskOf({ kind: 'lock', id: 'ha:lock.front' }).only, ['lock'], 'never unlock');
});

t('energy card: solar, battery and grid come only from sensors that exist', () => {
  const none = H.energyFlows([{ id: 'ha:sensor.fridge_power', name: 'Fridge', kind: 'sensor', powerW: 90 }], 900);
  assert.equal(none.solarW, null); assert.equal(none.battery, null); assert.equal(none.gridW, null);
  const e = H.energyFlows([{ id: 'ha:sensor.solar_power', name: 'Solar power', kind: 'sensor', powerW: 1500 }, { id: 'ha:sensor.solar_energy_today', name: 'Solar today', kind: 'sensor', powerW: 9 },
    { id: 'ha:sensor.powerwall_charge', name: 'Powerwall', kind: 'sensor', battery: 64 }, { id: 'ha:sensor.grid_power', name: 'Grid power', kind: 'sensor', powerW: 420 }], 1700);
  assert.equal(e.solarW, 1500, 'today/energy totals are not power right now'); assert.equal(e.battery.pct, 64); assert.equal(e.gridW, 420); assert.equal(e.selfPct, 88);
});

t('secure address at home: only home-network addresses, and the plain address hands browsers over', () => {
  for (const ip of ['192.168.1.20', '10.0.0.5', '172.16.4.2', '172.31.255.1']) assert.ok(H.ltPrivate(ip), ip);   // scrub-ok: example private addresses
  for (const ip of ['8.8.8.8', '172.32.0.1', '127.0.0.1', '192.168.1.300', 'lan', '']) assert.ok(!H.ltPrivate(ip), ip);   // scrub-ok: examples
  const req = (o = {}) => ({ method: 'GET', path: '/', secure: false, socket: { remoteAddress: '192.168.1.30' }, headers: { 'sec-fetch-dest': 'document', ...(o.headers || {}) }, ...o });   // scrub-ok
  H.LOCAL_TLS.url = null; assert.ok(!H.wantsSecure(req()), 'not until it is ready');
  H.LOCAL_TLS.url = 'https://lan-abc.casatorch.com:8443';
  assert.ok(H.wantsSecure(req()), 'a page opened over http goes to https');
  assert.ok(!H.wantsSecure(req({ secure: true })), 'already https');
  assert.ok(!H.wantsSecure(req({ socket: { remoteAddress: '127.0.0.1' } })), 'this computer itself is left alone');
  assert.ok(!H.wantsSecure(req({ path: '/api/status' })), 'API calls are not redirected');
  assert.ok(!H.wantsSecure(req({ headers: { 'sec-fetch-dest': 'image' } })), 'only pages');
  assert.ok(!H.wantsSecure(req({ headers: { cookie: 'a=1; ct_plain=1' } })), 'a browser that could not reach it stays on http');
  H.LOCAL_TLS.url = null;
});

t('Security Center: reads the neighbor table on Linux, Mac and Windows, and explains risky ports', () => {
  const linux = 'IP address       HW type     Flags       HW address            Mask     Device\n192.168.1.1      0x1         0x2         3c:22:fb:10:00:01     *        eth0\n192.168.1.9      0x1         0x0         00:00:00:00:00:00     *        eth0\n';   // scrub-ok: sample
  assert.deepEqual(H.parseNeighbors(linux, 'linux'), [{ ip: '192.168.1.1', mac: '3c:22:fb:10:00:01' }]);   // scrub-ok
  const mac = '? (192.168.1.20) at 0:11:32:aa:0:2 on en0 ifscope [ethernet]\n? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]\n';   // scrub-ok
  assert.deepEqual(H.parseNeighbors(mac, 'darwin'), [{ ip: '192.168.1.20', mac: '00:11:32:aa:00:02' }], 'short Mac hex padded; multicast dropped');   // scrub-ok
  const win = '  192.168.1.41          9c-8e-cd-00-00-04     dynamic\n  192.168.1.255         ff-ff-ff-ff-ff-ff     static\n';   // scrub-ok
  assert.deepEqual(H.parseNeighbors(win, 'win32'), [{ ip: '192.168.1.41', mac: '9c:8e:cd:00:00:04' }]);   // scrub-ok
  assert.equal(H.portInfo(23).level, 'warning'); assert.equal(H.portInfo(445).level, 'notice');
  assert.ok(H.securityChecklist().some((i) => i.id === 'https'));
});

t('App tests: reads traceroute, tracepath and tracert, and sorts hops into home, provider and internet', () => {
  const lin = 'traceroute to example.com (203.0.113.10), 24 hops max, 60 byte packets\n 1  192.168.1.1  0.512 ms\n 2  100.92.0.1  8.1 ms\n 3  *\n 4  198.51.100.1  10.4 ms\n';   // scrub-ok: documentation addresses
  assert.deepEqual(H.atParseTrace(lin, 'traceroute'), [{ n: 1, ip: '192.168.1.1', ms: 0.512 }, { n: 2, ip: '100.92.0.1', ms: 8.1 }, { n: 3, ip: null, ms: null }, { n: 4, ip: '198.51.100.1', ms: 10.4 }]);   // scrub-ok
  const win = '\nTracing route to example.com [203.0.113.10]\n\n  1    <1 ms    <1 ms    <1 ms  192.168.1.1\n  2     9 ms     8 ms    10 ms  198.51.100.1\n  3     *        *        *     Request timed out.\n';   // scrub-ok
  assert.deepEqual(H.atParseTrace(win, 'tracert'), [{ n: 1, ip: '192.168.1.1', ms: 0.5 }, { n: 2, ip: '198.51.100.1', ms: 8 }, { n: 3, ip: null, ms: null }]);   // scrub-ok
  const tp = ' 1?: [LOCALHOST]                      pmtu 1500\n 1:  192.168.1.1                                           0.611ms\n 2:  no reply\n 3:  198.51.100.1                                          11.204ms\n';   // scrub-ok
  assert.deepEqual(H.atParseTrace(tp, 'tracepath'), [{ n: 1, ip: '192.168.1.1', ms: 0.611 }, { n: 2, ip: null, ms: null }, { n: 3, ip: '198.51.100.1', ms: 11.204 }]);   // scrub-ok
  const hops = H.atZones([{ ip: '192.168.1.1' }, { ip: '100.92.0.1' }, { ip: '198.51.100.1', name: 'a.isp-one.net' }, { ip: null }, { ip: '198.51.100.9', name: 'b.isp-one.net' }, { ip: '203.0.113.5', name: 'x.transit.example' }, { ip: '203.0.113.7' }]);   // scrub-ok
  assert.deepEqual(hops.map((h) => h.zone), ['home', 'provider', 'provider', 'provider', 'provider', 'internet', 'internet']);
  assert.equal(H.atParseUrl('zoom.us').url, 'https://zoom.us/');
  for (const bad of ['-oProxy=x', 'ftp://a.b', 'https://u:p@a.b/', 'https://a..b/']) assert.equal(H.atParseUrl(bad), null, bad);
});

t('security: only home names reach CasaTorch (no DNS rebinding), and cloud metadata is never fetched', () => {
  for (const h of ['localhost:8090', '127.0.0.1:8090', '192.168.1.20:8090', '[::1]:8090', 'casatorch:8090', 'casatorch.local:8090', 'nas.lan', 'homehub', 'box.home.arpa']) assert.ok(H.hostAllowed(h), h);   // scrub-ok: examples
  for (const h of ['evil.example.com', 'attacker.com:8090', '', 'lan-zzzzzzzz.casatorch.com:8443']) assert.ok(!H.hostAllowed(h), h);
  for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://metadata.google.internal/', 'http://100.100.100.200/']) assert.ok(H.blockedUrl(u), u);
  for (const u of ['http://192.168.1.5:5000/api/version', 'https://zoom.us/']) assert.ok(!H.blockedUrl(u), u);   // scrub-ok
});

t('nudges: once, daily, days of the week, monthly (short months too) and yearly', () => {
  const h = (date, dow) => ({ date, dow, day: Number(date.slice(8)), md: date.slice(5) });
  const n = (o) => ({ on: true, time: '09:00', ...o });
  assert.ok(H.nudgeOnDay(n({ repeat: 'once', date: '2026-10-20' }), h('2026-10-20', 2)));
  assert.ok(!H.nudgeOnDay(n({ repeat: 'once', date: '2026-10-20' }), h('2026-10-21', 3)));
  assert.ok(H.nudgeOnDay(n({ repeat: 'weekly', days: [2] }), h('2026-10-20', 2)) && !H.nudgeOnDay(n({ repeat: 'weekly', days: [2] }), h('2026-10-21', 3)));
  assert.ok(H.nudgeOnDay(n({ repeat: 'monthly', date: '2026-01-31' }), h('2026-02-28', 6)), 'the 31st falls on the last day of February');
  assert.ok(!H.nudgeOnDay(n({ repeat: 'monthly', date: '2026-01-31' }), h('2026-03-30', 1)));
  assert.ok(H.nudgeOnDay(n({ repeat: 'yearly', date: '2020-03-22' }), h('2026-03-22', 0)));
  assert.ok(!H.nudgeOnDay(n({ repeat: 'daily', on: false }), h('2026-03-22', 0)), 'off is off');
});

t('3D: one device per real device; garage doors and locks keep their own pin', () => {
  const g = H.fpGroup([
    { id: 'ha:switch.dishwasher', dev: 'd1', kind: 'plug', name: 'Dishwasher', on: true },
    { id: 'ha:switch.dishwasher_led', dev: 'd1', kind: 'switch', name: 'Dishwasher LED', on: true },
    { id: 'ha:sensor.dishwasher_power', dev: 'd1', kind: 'sensor', name: 'Dishwasher power', powerW: 1180 },
    { id: 'ha:sensor.hall_temp', dev: 'd2', kind: 'sensor', name: 'Hall sensor temperature', tempC: 21 },
    { id: 'ha:binary_sensor.hall_motion', dev: 'd2', kind: 'sensor', name: 'Hall sensor motion', motion: true },
    { id: 'ha:cover.garage', dev: 'd3', kind: 'cover', name: 'Garage door', open: false },
    { id: 'ha:light.garage', dev: 'd3', kind: 'light', name: 'Garage light', on: false },
    { id: 'ha:light.lamp', kind: 'light', name: 'Lamp' },
  ]);
  const dw = g.list.find((x) => x.id === 'ha:switch.dishwasher');
  assert.equal(g.list.filter((x) => /dishwasher/.test(x.id)).length, 1); assert.equal(dw.name, 'Dishwasher'); assert.equal(dw.powerW, 1180);
  assert.equal(g.alias.get('ha:switch.dishwasher_led'), 'ha:switch.dishwasher', 'a pin on the LED moves to the dishwasher');
  const hall = g.list.filter((x) => x.dev === 'd2'); assert.equal(hall.length, 1); assert.equal(hall[0].name, 'Hall sensor'); assert.equal(hall[0].motion, true); assert.equal(hall[0].tempC, 21);
  assert.ok(g.list.some((x) => x.id === 'ha:cover.garage') && g.list.some((x) => x.id === 'ha:light.garage'), 'the garage door stands alone');
  assert.equal(g.list.length, 5);
});

console.log(`\n${n} passed`);
process.exit(0);
