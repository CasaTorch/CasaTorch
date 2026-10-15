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
    yolink: { uaid: 'ua-1', secret: 'ys-2' }, hue: { host: '10.0.0.5', username: 'hue-user' }, cameras: [{ id: 'c1', name: 'Porch', username: 'admin', password: 'pw!' }], meraki: { apiKey: '' } };
  const disk = H.sealConfig(c), text = JSON.stringify(disk);
  for (const secret of ['eyJhbGciOi.secret', 'rt-123', 'sk-ant-xyz', 'ys-2', 'hue-user', 'pw!']) assert.ok(!text.includes(secret), `${secret} left in the clear`);
  for (const plain of ['http://ha.local:8123', 'ua-1', '10.0.0.5', 'Porch', 'anthropic']) assert.ok(text.includes(plain), `${plain} should stay readable`);
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

console.log(`\n${n} passed`);
process.exit(0);
