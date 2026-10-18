/* Unit tests for the parts that read other people's data formats. Run: node test/unit.mjs */
import assert from 'node:assert/strict';
import http from 'node:http';
import * as fsMod from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const require_ = (m) => (m === 'fs' ? fsMod : req(m));
process.env.CASATORCH_TEST = '1'; process.env.CASATORCH_DATA_DIR = '/tmp/casatorch-unit';
/* push.json from an older version: web-push keys in plain text (sealed at start, 41-notify.js). */
const OLD_SUB = { id: 'a1', user: 'local', endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') }, level: 'important' };
fsMod.mkdirSync('/tmp/casatorch-unit', { recursive: true }); fsMod.writeFileSync('/tmp/casatorch-unit/push.json', JSON.stringify({ vapid: null, subs: [OLD_SUB] }));
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
  for (const h of ['169.254.1.2', '[fd12:3456::1]', 'fe80::1', '[::1]', 'nas.lan', 'router.internal', 'NAS.LOCAL.']) assert.ok(H.isLanHost(h), h);   // scrub-ok: example addresses
  for (const h of ['10.example.com', '192.168.1.1.example.com', 'fcbarcelona.com', 'fd.example.org', '2001:db8::1', '[2606:4700::1]', '100.64.0.1', '300.1.1.1', '', 'evil.com/x.local']) assert.ok(!H.isLanHost(h), h || '(empty)');
});
t('push: web-push keys from an older push.json are sealed on disk, and still open', () => {
  const disk = JSON.parse(fsMod.readFileSync('/tmp/casatorch-unit/push.json', 'utf8')), k = disk.subs[0].keys;
  assert.match(k.p256dh, /^v1\./); assert.match(k.auth, /^v1\./);
  assert.equal(H.unseal(k.p256dh), OLD_SUB.keys.p256dh); assert.equal(H.unseal(k.auth), OLD_SUB.keys.auth);
  assert.equal(disk.subs[0].endpoint, OLD_SUB.endpoint);
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

t('App tests: reads traceroute (Linux, Mac), tracepath, tracert and mtr into hops with min/avg/max and loss', () => {
  const A = globalThis.__casatorchAT;
  // Linux traceroute -n -q 3: three probes a hop, a silent hop, split routes, an annotation
  const lin = 'traceroute to example.com (203.0.113.10), 24 hops max, 60 byte packets\n 1  192.168.1.1  0.512 ms  0.4 ms  0.6 ms\n 2  100.92.0.1  8.1 ms  9.0 ms *\n 3  * * *\n 4  198.51.100.1  10.4 ms 198.51.100.9  12.0 ms  11.0 ms\n 5  203.0.113.10  20.1 ms !H  19.9 ms  20.0 ms\n';   // scrub-ok: documentation addresses
  const L = A.atParseTrace(lin, 'traceroute').hops;
  assert.deepEqual(L.map((h) => [h.n, h.ip, h.sent, h.loss]), [[1, '192.168.1.1', 3, 0], [2, '100.92.0.1', 3, 33], [3, null, 3, 100], [4, '198.51.100.9', 3, 0], [5, '203.0.113.10', 3, 0]]);   // scrub-ok
  assert.deepEqual([L[0].min, L[0].avg, L[0].max], [0.4, 0.5, 0.6]); assert.deepEqual(L[3].ips, ['198.51.100.9', '198.51.100.1']);   // scrub-ok
  // macOS traceroute: same layout, different header
  const mac = 'traceroute to example.com (203.0.113.10), 64 hops max, 52 byte packets\n 1  192.168.1.1  2.345 ms  1.879 ms  1.770 ms\n 2  * * *\n 3  10.0.0.1  9.104 ms  8.901 ms *\n';   // scrub-ok
  assert.deepEqual(A.atParseTrace(mac, 'traceroute').hops.map((h) => [h.n, h.ip, h.loss, h.min]), [[1, '192.168.1.1', 0, 1.77], [2, null, 100, null], [3, '10.0.0.1', 33, 8.9]]);   // scrub-ok
  // Linux traceroute --mtu prints F=
  assert.equal(A.atParseTrace(' 1  192.168.1.1  0.173 ms F=1400  0.080 ms  0.050 ms\n', 'traceroute').mtu, 1400);   // scrub-ok
  // Windows tracert -d, English and German
  const win = '\nTracing route to example.com [203.0.113.10]\nover a maximum of 24 hops:\n\n  1    <1 ms    <1 ms    <1 ms  192.168.1.1\n  2     9 ms     *       10 ms  198.51.100.1\n  3     *        *        *     Request timed out.\n  4    21 ms    20 ms    22 ms  203.0.113.10\n\nTrace complete.\n';   // scrub-ok
  assert.deepEqual(A.atParseTrace(win, 'tracert').hops.map((h) => [h.n, h.ip, h.loss, h.avg]), [[1, '192.168.1.1', 0, 0.5], [2, '198.51.100.1', 33, 9.5], [3, null, 100, null], [4, '203.0.113.10', 0, 21]]);   // scrub-ok
  assert.equal(A.atParseTrace('  3     *        *        *     Zeitüberschreitung der Anforderung.\n', 'tracert').hops[0].loss, 100);
  // tracepath: one line a probe, the path MTU along the way
  const tp = ' 1?: [LOCALHOST]                      pmtu 1500\n 1:  192.168.1.1                                           0.611ms\n 1:  192.168.1.1                                           0.401ms\n 2:  no reply\n 3:  198.51.100.1                                          11.204ms pmtu 1492\n     Resume: pmtu 1492 hops 3 back 3\n';   // scrub-ok
  const P = A.atParseTrace(tp, 'tracepath');
  assert.deepEqual(P.hops.map((h) => [h.n, h.ip, h.sent, h.min, h.max]), [[1, '192.168.1.1', 2, 0.4, 0.61], [2, null, 1, null, null], [3, '198.51.100.1', 1, 11.2, 11.2]]); assert.equal(P.mtu, 1492);   // scrub-ok
  // mtr -j
  const mtr = JSON.stringify({ report: { hubs: [{ count: 1, host: '192.168.1.1', 'Loss%': 0, Snt: 5, Avg: 0.6, Best: 0.4, Wrst: 1.1 }, { count: 2, host: '???', 'Loss%': 100, Snt: 5 }, { count: 3, host: '198.51.100.1', 'Loss%': 20, Snt: 5, Avg: 10.4, Best: 9.6, Wrst: 12.9 }] } });   // scrub-ok
  assert.deepEqual(A.atParseTrace(mtr, 'mtr').hops, [{ n: 1, ip: '192.168.1.1', sent: 5, loss: 0, min: 0.4, avg: 0.6, max: 1.1 }, { n: 2, ip: null, sent: 5, loss: 100, min: null, avg: null, max: null }, { n: 3, ip: '198.51.100.1', sent: 5, loss: 20, min: 9.6, avg: 10.4, max: 12.9 }]);   // scrub-ok
  assert.deepEqual(A.atParseTrace('not json', 'mtr').hops, []);
});
t('App tests: whose network each hop is (names, then network numbers), and the network directory\'s answers', () => {
  const A = globalThis.__casatorchAT;
  const hops = H.atZones([{ ip: '192.168.1.1' }, { ip: '100.92.0.1' }, { ip: '198.51.100.1', name: 'a.isp-one.net' }, { ip: null }, { ip: '198.51.100.9', name: 'b.isp-one.net' }, { ip: '203.0.113.5', name: 'x.transit.example' }, { ip: '203.0.113.7' }]);   // scrub-ok
  assert.deepEqual(hops.map((h) => h.zone), ['home', 'provider', 'provider', 'provider', 'provider', 'internet', 'internet']);
  const byAsn = A.atZones([{ ip: '192.168.1.1' }, { ip: '100.92.0.1' }, { ip: '198.51.100.1', asn: 64500 }, { ip: null }, { ip: '203.0.113.5', asn: 64501 }, { ip: '203.0.113.9', asn: 64510 }], { destAsn: 64510 });   // scrub-ok
  assert.deepEqual(byAsn.map((h) => h.zone), ['home', 'provider', 'provider', 'provider', 'internet', 'app']);
  assert.deepEqual(A.atParseOrigin('64500 | 198.51.100.0/24 | US | arin | 2001-01-01'), { asn: 64500, prefix: '198.51.100.0/24', cc: 'US' });   // scrub-ok
  assert.equal(A.atParseAsName('64500 | US | arin | 2001-01-01 | EXAMPLE-NET - Example Broadband, US'), 'Example Broadband');
  assert.equal(A.atRevName('198.51.100.7'), '7.100.51.198.origin.asn.cymru.com');   // scrub-ok
  assert.ok(A.atRevName('2001:db8::1').startsWith('1.0.0.0.0.0.0.0') && A.atRevName('2001:db8::1').endsWith('8.b.d.0.1.0.0.2.origin6.asn.cymru.com'));
  assert.equal(A.atPathKey({ hops: [{ zone: 'home', ip: '192.168.1.1' }, { ip: '198.51.100.1', asn: 64500 }, { ip: '198.51.100.2', asn: 64500 }, { ip: '203.0.113.5', asn: 64501 }] }), 'home>AS64500>AS64501');   // scrub-ok
  assert.equal(H.atParseUrl('zoom.us').url, 'https://zoom.us/');
  for (const bad of ['-oProxy=x', 'ftp://a.b', 'https://u:p@a.b/', 'https://a..b/']) assert.equal(H.atParseUrl(bad), null, bad);
});
t('App tests: the likely culprit - Wi-Fi/router, provider, a network in between, or the app itself', () => {
  const A = globalThis.__casatorchAT;
  const hop = (n, zone, avg, loss = 0, extra = {}) => ({ n, ip: `198.51.100.${n}`, zone, sent: 5, loss, min: avg == null ? null : avg * 0.9, avg, max: avg == null ? null : avg * 1.2, ...extra });   // scrub-ok
  const dest = (avg, loss = 0) => ({ ip: '203.0.113.10', zone: 'app', dest: true, sent: 5, avg, min: avg == null ? null : avg * 0.9, loss });   // scrub-ok
  const path = (hops, d) => ({ hops, dest: d });
  // loss from the router onwards: the home
  let c = A.atCulprit(path([hop(1, 'home', 3, 40), hop(2, 'provider', 12, 40), hop(3, 'internet', 20, 40)], dest(25, 40)), { slow: true });
  assert.deepEqual([c.who, c.kind, c.hop], ['home', 'loss', 1]);
  // loss only at a router in the middle (it doesn't bother answering traces), none at the app: not a culprit
  c = A.atCulprit(path([hop(1, 'home', 1), hop(2, 'provider', 10, 60), hop(3, 'internet', 20)], dest(25, 0)), { slow: false });
  assert.equal(c.who, null);
  // slower than usual from the provider's hop 3 onwards (the usual from earlier traces)
  const base = { hops: { '198.51.100.1': 1, '198.51.100.2': 9, '198.51.100.3': 11, '198.51.100.4': 20 }, dest: 24 };   // scrub-ok
  c = A.atCulprit(path([hop(1, 'home', 1), hop(2, 'provider', 9.5), hop(3, 'provider', 82), hop(4, 'internet', 90)], dest(95)), { slow: true, base });
  assert.deepEqual([c.who, c.kind, c.hop, c.ms], ['provider', 'delay', 3, 71]);
  assert.equal(A.atCulpritText(c, 'Zoom'), 'Likely cause: your internet provider - the slowdown starts at hop 3, about 71 ms more than usual.');
  // a network in between, named
  c = A.atCulprit(path([hop(1, 'home', 1), hop(2, 'provider', 9), hop(3, 'provider', 11), hop(4, 'internet', 80, 0, { org: 'Example Transit' })], dest(85)), { slow: true, base });
  assert.deepEqual([c.who, c.hop, c.org], ['internet', 4, 'Example Transit']);
  // the network is fine, but the app takes long to answer
  c = A.atCulprit(path([hop(1, 'home', 1), hop(2, 'provider', 9)], dest(24)), { slow: true, base, run: { connect: 20, wait: 2400 }, med: { wait: 300 } });
  assert.deepEqual([c.who, c.kind], ['app', 'answer']);
  // nothing beyond the router answers and every app is down: the provider (or the line to it)
  c = A.atCulprit(path([{ n: 1, ip: '192.168.1.1', zone: 'home', sent: 5, loss: 0, avg: 1 }, { n: 2, ip: null, zone: 'provider', sent: 5, loss: 100 }], dest(null, 100)), { down: true, run: { connect: null }, othersDown: 0, othersUp: 0 });   // scrub-ok
  assert.deepEqual([c.who, c.kind, c.hop], ['provider', 'stops', 1]);
  // several apps down at once, the router answers: the provider
  c = A.atCulprit(path([{ n: 1, ip: '192.168.1.1', zone: 'home', sent: 5, loss: 0, avg: 1 }], dest(null, 100)), { down: true, run: {}, othersDown: 3, othersUp: 0 });   // scrub-ok
  assert.deepEqual([c.who, c.kind], ['provider', 'many']);
  // others are fine and the path reaches the app's network: the app itself
  c = A.atCulprit(path([hop(1, 'home', 1), hop(2, 'provider', 9), hop(3, 'app', 20)], dest(null, 100)), { down: true, run: { connect: null }, othersDown: 0, othersUp: 4 });
  assert.equal(c.who, 'app');
  // the name couldn't be looked up
  assert.equal(A.atCulprit(null, { down: true, run: { errKind: 'dns' } }).who, 'dns');
  // slow means well past the usual: twice the median and half a second more
  assert.ok(A.atIsSlow(1400, 400) && !A.atIsSlow(700, 300) && !A.atIsSlow(900, 600));
});
t('App tests: setup suggests apps for the country, and turns the answers into tests', () => {
  const A = globalThis.__casatorchAT;
  const us = A.atSuggest('US', 'en'), gb = A.atSuggest('GB', 'en'), de = A.atSuggest('', 'de');
  assert.ok(us.picks.includes('router') && us.picks.includes('dns') && us.picks.includes('zoom') && us.picks.length <= 8);
  assert.ok(gb.picks.includes('iplayer')); assert.equal(de.cc, 'DE'); assert.ok(de.picks.includes('ard') && de.picks.includes('teams'));
  assert.ok(!A.atSuggest('CN', 'zh').picks.includes('google'));
  const tests = A.atFromSetup({ want: 'yes', picks: ['router', 'netflix', 'nope'], custom: [{ name: 'Bank', url: 'bank.example.com' }, { url: '-bad' }], every: 15, alert: 'yes' }, []);
  assert.deepEqual(tests.map((x) => x.preset || x.url), ['router', 'netflix', 'https://bank.example.com/']);
  assert.ok(tests.every((x) => x.every === 15 && x.alert === true)); assert.equal(tests[0].kind, 'router');
  assert.equal(A.atFromSetup({ want: 'no' }, undefined), undefined);
  const kept = [{ id: 'k1', preset: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/' }];
  assert.equal(A.atFromSetup({ want: 'no' }, kept), kept);
  assert.equal(A.atFromSetup({ want: 'yes', picks: ['netflix'] }, kept)[0].id, 'k1', 'running setup again keeps the history');
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

/* ---- encryption at rest and in transit (security agent's block) ---- */
{
  const S = globalThis.__casatorchSec, nodeCrypto = req('node:crypto'), os = req('node:os'), pathM = req('node:path');
  const tmpDir = () => fsMod.mkdtempSync(pathM.join(os.tmpdir(), 'ct-sec-'));
  t('crypto: seal is AES-256-GCM with a fresh 96-bit nonce, and any change to a sealed value is refused', () => {
    const a = H.seal('hunter2-token'), b = H.seal('hunter2-token'), [v, iv, enc, tag] = a.split('.');
    assert.equal(v, 'v1'); assert.equal(Buffer.from(iv, 'base64url').length, 12); assert.equal(Buffer.from(tag, 'base64url').length, 16);
    assert.notEqual(a, b, 'same text, different nonce'); assert.ok(!a.includes('hunter2'));
    assert.equal(H.unseal(a), 'hunter2-token');
    const flip = (s) => (s[0] === 'A' ? `B${s.slice(1)}` : `A${s.slice(1)}`);
    assert.equal(H.unseal([v, iv, flip(enc), tag].join('.')), null, 'ciphertext changed'); assert.equal(H.unseal([v, flip(iv), enc, tag].join('.')), null, 'nonce changed');
    assert.equal(H.unseal('v2.x.y.z'), null); assert.equal(H.unseal(''), null);
  });
  t('crypto: every secret in config.json is sealed on disk, nothing else is, and it opens back', () => {
    const cfg = { house: { name: 'Home' }, homeAssistant: { url: 'http://homeassistant.local:8123', token: 'ha-long-lived' }, ring: { refreshToken: 'ring-rt' }, hue: { bridge: '192.168.1.30', username: 'hue-user' },   // scrub-ok: example
      network: { meraki: { apiKey: 'mk' }, dns: { kind: 'pihole', url: 'http://192.168.1.2', key: 'dns-pw' } }, yolink: { uaid: 'yl-id', secret: 'yl-s' }, calendars: [{ name: 'Family', url: 'https://calendar.example/private/abc.ics' }],   // scrub-ok: example
      cameras: [{ id: 'c1', name: 'Porch', username: 'admin', password: 'cam-pw', snapshotUrl: 'http://admin:cam-pw@192.168.1.40/snap.jpg' }], remote: { token: 'tunnel', secret: 'rs' }, license: 'payload.sig', ai: { apiKey: 'sk-x' } };   // scrub-ok: example
    const disk = H.sealConfig(cfg), text = JSON.stringify(disk);
    for (const s of ['ha-long-lived', 'ring-rt', 'hue-user', 'mk', 'dns-pw', 'yl-id', 'yl-s', 'private/abc', 'cam-pw', 'tunnel', 'payload.sig', 'sk-x']) assert.ok(!text.includes(s.length < 5 ? `"${s}"` : s), `${s} is sealed`);   // a short one can turn up by chance inside a sealed value
    assert.equal(disk.house.name, 'Home'); assert.equal(disk.homeAssistant.url, 'http://homeassistant.local:8123'); assert.equal(disk.cameras[0].username, 'admin');
    assert.deepEqual(H.openConfig(disk), cfg);
    assert.deepEqual(H.sealConfig(disk), disk, 'sealing twice changes nothing');
  });
  t('crypto: the key file is made owner-only, is never overwritten, and a damaged one is kept aside', () => {
    const d = tmpDir(), f = pathM.join(d, 'secret.key');
    const k1 = S.loadKeyFile(f); assert.equal(k1.length, 32);
    if (process.platform !== 'win32') assert.equal(fsMod.statSync(f).mode & 0o777, 0o600);
    assert.ok(S.loadKeyFile(f).equals(k1), 'the same key comes back');
    if (process.platform !== 'win32') { fsMod.chmodSync(f, 0o644); S.loadKeyFile(f); assert.equal(fsMod.statSync(f).mode & 0o777, 0o600, 'a loose key file is tightened'); }
    fsMod.writeFileSync(f, 'not a key');
    const k2 = S.loadKeyFile(f); assert.equal(k2.length, 32); assert.ok(!k2.equals(k1));
    const aside = fsMod.readdirSync(d).filter((x) => x.startsWith('secret.key.damaged-'));
    assert.equal(aside.length, 1); assert.equal(fsMod.readFileSync(pathM.join(d, aside[0]), 'utf8'), 'not a key', 'the damaged file is kept as it was');
    assert.ok(!fsMod.readdirSync(d).some((x) => x.endsWith('.tmp')), 'no temp files left');
    if (process.platform !== 'win32' && process.getuid?.() !== 0) { fsMod.chmodSync(f, 0o000); assert.throws(() => S.loadKeyFile(f), /can't read its key file/); fsMod.chmodSync(f, 0o600); assert.ok(S.loadKeyFile(f).equals(k2), 'unreadable is not replaced'); }
    fsMod.rmSync(d, { recursive: true, force: true });
  });
  t('crypto: the data folder is tightened to owner-only (files 0600, folders 0700), bin/ and links left alone', () => {
    if (process.platform === 'win32') return;
    const d = tmpDir(); fsMod.mkdirSync(pathM.join(d, 'photos'), { mode: 0o755 }); fsMod.mkdirSync(pathM.join(d, 'bin'), { mode: 0o755 });
    for (const [p, m] of [['power-baseline.json', 0o644], ['photos/a.jpg', 0o644], ['bin/cloudflared', 0o755], ['ok.json', 0o600]]) { fsMod.writeFileSync(pathM.join(d, p), 'x'); fsMod.chmodSync(pathM.join(d, p), m); }
    fsMod.chmodSync(pathM.join(d, 'photos'), 0o755); fsMod.chmodSync(pathM.join(d, 'bin'), 0o755);
    const outside = pathM.join(tmpDir(), 'elsewhere.txt'); fsMod.writeFileSync(outside, 'x'); fsMod.chmodSync(outside, 0o644); fsMod.symlinkSync(outside, pathM.join(d, 'link'));
    assert.equal(S.tightenDataModes(d), 3);
    const mode = (p) => fsMod.statSync(pathM.join(d, p)).mode & 0o777;
    assert.equal(mode('power-baseline.json'), 0o600); assert.equal(mode('photos/a.jpg'), 0o600); assert.equal(mode('photos'), 0o700);
    assert.equal(mode('bin/cloudflared'), 0o755, 'the helper program still runs'); assert.equal(fsMod.statSync(outside).mode & 0o777, 0o644, 'a link is not followed');
    assert.equal(S.tightenDataModes(d), 0, 'nothing left to do');
    fsMod.rmSync(d, { recursive: true, force: true });
  });
  t('logs: secrets are masked (tokens, passwords, sign-ins inside addresses, long keys); ordinary text is not', () => {
    const m = S.logMask;
    assert.equal(m('camera rtsp://admin:s3cret@192.168.1.40:554/stream failed'), 'camera rtsp://***:***@192.168.1.40:554/stream failed');   // scrub-ok: example
    assert.ok(!m('Authorization: Bearer abc.def-123').includes('abc.def'));
    assert.ok(!m('Basic YWRtaW46cGFzcw==').includes('YWRtaW46'));
    assert.ok(!m('{"refreshToken":"rt-123","password":"pw-9"}').match(/rt-123|pw-9/));
    assert.ok(!m('GET /x?api_key=k-77&token=t-88').match(/k-77|t-88/));
    assert.ok(!m(`key ${'A'.repeat(48)}`).includes('A'.repeat(20)));
    assert.equal(m('Secure address at home: name ready, getting the certificate'), 'Secure address at home: name ready, getting the certificate');
  });
  t('passwords: scrypt with a random salt, checked in constant time; a damaged hash is a wrong password, not a crash', () => {
    const h = S.hashSecret('Correct-horse-9'), [kind, salt, hash] = h.split('$');
    assert.equal(kind, 'scrypt'); assert.equal(salt.length, 32); assert.equal(hash.length, 64); assert.notEqual(S.hashSecret('Correct-horse-9'), h, 'salted');
    assert.equal(S.verifySecret(h, 'Correct-horse-9'), true); assert.equal(S.verifySecret(h, 'correct-horse-9'), false);
    assert.equal(S.verifySecret(`scrypt$${salt}$abcd`, 'Correct-horse-9'), false); assert.equal(S.verifySecret('plain-text', 'plain-text'), false);
    const rc = S.rcHash('a1b2c-3d4e5'); assert.ok(rc.startsWith('rc1$') && !rc.includes('a1b2c')); assert.ok(S.rcMatch(rc, 'a1b2c-3d4e5')); assert.ok(!S.rcMatch(rc, 'a1b2c-3d4e6'));
  });
  t('cookies: HttpOnly and SameSite always, Secure over https', () => {
    assert.equal(S.cookieFlags({ secure: true }), 'Path=/; HttpOnly; SameSite=Lax; Secure');
    assert.equal(S.cookieFlags({ secure: false }), 'Path=/; HttpOnly; SameSite=Lax');
  });
  t('phone alerts: sealed for one phone (AES-256-GCM), signed with Ed25519, and the outside tag gives nothing away', () => {
    const phoneKey = nodeCrypto.randomBytes(32), pd = { key: H.seal(phoneKey.toString('base64')) }, other = { key: H.seal(nodeCrypto.randomBytes(32).toString('base64')) };
    const msg = { title: 'Water leak', body: 'Kitchen sensor is wet', tag: 'water:kitchen', sev: 'critical' };
    const s = S.sealFor(pd, msg), all = Buffer.from(s.d, 'base64'), iv = Buffer.from(s.iv, 'base64');
    assert.equal(iv.length, 12); assert.ok(!all.toString('latin1').includes('Water'));
    const dc = nodeCrypto.createDecipheriv('aes-256-gcm', phoneKey, iv); dc.setAuthTag(all.subarray(-16));
    const open = JSON.parse(Buffer.concat([dc.update(all.subarray(0, -16)), dc.final()]).toString('utf8')); assert.equal(open.title, 'Water leak'); assert.equal(open.tag, 'water:kitchen');
    const tg = S.pushTagFor(pd, msg.tag);
    assert.match(tg, /^[A-Za-z0-9_-]{22}$/); assert.ok(!/water|kitchen/i.test(tg));
    assert.equal(S.pushTagFor(pd, msg.tag), tg, 'same alert, same tag (so it replaces the old one)'); assert.notEqual(S.pushTagFor(other, msg.tag), tg, 'another phone, another tag'); assert.equal(S.pushTagFor(pd, ''), '');
    const k = S.relayKey(), body = '{"home":"x"}', sig = nodeCrypto.sign(null, Buffer.from(body), k.priv);
    const pub = nodeCrypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(k.pub, 'base64')]), format: 'der', type: 'spki' });
    assert.ok(nodeCrypto.verify(null, Buffer.from(body), pub, sig)); assert.ok(!nodeCrypto.verify(null, Buffer.from('{"home":"y"}'), pub, sig));
  });
  await t('headers: CSP, no sniffing, no framing by strangers, COOP, no-store on the API, no x-powered-by', async () => {
    const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/health`), h = (k) => r.headers.get(k) || '';
      assert.match(h('content-security-policy'), /default-src 'self'/); assert.match(h('content-security-policy'), /object-src 'none'/); assert.match(h('content-security-policy'), /frame-ancestors 'self'/);
      assert.equal(h('x-content-type-options'), 'nosniff'); assert.equal(h('referrer-policy'), 'same-origin'); assert.equal(h('cross-origin-opener-policy'), 'same-origin-allow-popups');   // Home Assistant's sign-in window reports back through window.opener
      assert.equal(h('cache-control'), 'no-store'); assert.equal(r.headers.get('x-powered-by'), null); assert.equal(r.headers.get('strict-transport-security'), null, 'HSTS only over https');
      const bad = await new Promise((ok, no) => req('node:http').get({ host: '127.0.0.1', port: srv.address().port, path: '/api/health', headers: { Host: 'evil.example.com' } }, (x) => { x.resume(); ok(x.statusCode); }).on('error', no));
      assert.equal(bad, 421, 'a stranger name is refused');
    } finally { srv.close(); }
  });
}

/* ---- setup and self-healing (05b-setup-net.js, 00b-heal.js, 79-doctor.js) ---- */
const SU = globalThis.__casatorchSetup;
t('setup: addresses are tidied the way people type them', () => {
  const ha = (x) => SU.normalizeAddress(x, { defaultPort: 8123 }).url;
  assert.equal(ha('homeassistant.local'), 'http://homeassistant.local:8123');
  assert.equal(ha('192.168.1.20'), 'http://192.168.1.20:8123');   // scrub-ok: example
  assert.equal(ha(' http//192.168.1.20:8123/ '), 'http://192.168.1.20:8123');   // scrub-ok: example
  assert.equal(ha('HTTP://HomeAssistant.local:8123/lovelace/0'), 'http://homeassistant.local:8123', 'a pasted dashboard link');
  assert.equal(ha('https:\\\\ha.example.com'), 'https://ha.example.com', 'backslashes, no port added to https');
  assert.equal(ha('htp://10.0.0.5'), 'http://10.0.0.5:8123');
  assert.equal(ha('192.168.1.20:8443'), 'https://192.168.1.20:8443', 'a secure port means https');   // scrub-ok: example
  assert.equal(ha('"http://ha:8123"'), 'http://ha:8123');
  for (const bad of ['', 'ftp://x', 'hello world', 'http://user:pw@x', 'http://x:99999']) assert.ok(SU.normalizeAddress(bad).error, bad);
  assert.equal(SU.normalizeAddress('webcal://cal.example.com/a/b.ics?x=1', { defaultScheme: 'https', keepPath: true }).url, 'https://cal.example.com/a/b.ics?x=1', 'calendar links keep their path');
  assert.equal(SU.cleanHost('http://192.168.1.40/status'), '192.168.1.40');   // scrub-ok: example
  assert.equal(SU.cleanToken(' Bearer abc.def\n'), 'abc.def');
  const fx = SU.tidyTestBody('frigate', { url: '192.168.1.10' });   // scrub-ok: example
  assert.equal(fx.body.url, 'http://192.168.1.10:5000'); assert.equal(fx.fixed.url, 'http://192.168.1.10:5000');   // scrub-ok: example
  assert.equal(SU.tidyTestBody('shelly', { hosts: 'http://192.168.1.40/, 192.168.1.41' }).body.hosts, '192.168.1.40 192.168.1.41');   // scrub-ok: example
  assert.ok(SU.tidyTestBody('unifi', { url: 'not an address' }).error);
});
t('setup: every network error becomes one plain sentence and a fix', () => {
  const e = (code, extra = {}) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) }, extra);
  const ha = { what: 'Home Assistant', url: 'http://homeassistant.local:8123' };
  assert.equal(SU.friendlyError(e('ENOTFOUND'), ha).code, 'dns'); assert.match(SU.friendlyError(e('ENOTFOUND'), ha).fix, /number address/);
  assert.match(SU.friendlyError(e('ECONNREFUSED'), { what: 'Home Assistant', url: 'http://192.168.1.20:8124' }).error, /port 8124/);   // scrub-ok: example
  assert.equal(SU.friendlyError(e('DEPTH_ZERO_SELF_SIGNED_CERT'), ha).code, 'cert-self');
  assert.equal(SU.friendlyError(e('CERT_NOT_YET_VALID'), ha).code, 'clock', 'a certificate "from the future" means our clock is wrong');
  assert.equal(SU.friendlyError(e('CERT_HAS_EXPIRED'), ha).code, 'cert-expired');
  assert.equal(SU.friendlyError(e('ERR_SSL_WRONG_VERSION_NUMBER'), ha).code, 'not-https');
  assert.equal(SU.friendlyError(e('EHOSTUNREACH'), ha).code, 'unreachable');
  assert.match(SU.friendlyError(Object.assign(new Error('HTTP 401'), { status: 401 }), ha).error, /token/);
  assert.equal(SU.friendlyError(Object.assign(new Error('HTTP 404'), { status: 404 }), ha).code, 'wrong-thing');
  assert.equal(SU.friendlyError(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), ha).code, 'timeout');
  for (const r of [e('ENOTFOUND'), e('ECONNREFUSED'), e('CERT_HAS_EXPIRED')].map((x) => SU.friendlyError(x, ha))) assert.ok(r.error && r.fix && !/[A-Z]{4,}_/.test(r.error + r.fix), 'no error codes shown to people');
  assert.ok(SU.isTransient(e('ECONNRESET')) && SU.isTransient({ status: 503 }) && !SU.isTransient(e('ECONNREFUSED')) && !SU.isTransient({ status: 401 }));
  const tok = `x.${Buffer.from(JSON.stringify({ exp: 1600000000 })).toString('base64url')}.y`;
  assert.equal(SU.jwtInfo(tok).exp, 1600000000); assert.equal(SU.jwtInfo('nope'), null);
  assert.equal(SU.clockSkewMs('Sat, 17 Oct 2026 10:00:00 GMT', Date.parse('2026-10-17T10:12:00Z')), 12 * 60_000);
});
await t('setup: a blip is tried again, a "no" is not', async () => {
  let n = 0; assert.equal(await SU.withRetry(async () => { if (++n < 3) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); return 'ok'; }, { base: 1 }), 'ok'); assert.equal(n, 3);
  let m = 0; await assert.rejects(SU.withRetry(async () => { m++; throw Object.assign(new Error('no'), { status: 401 }); }, { base: 1 })); assert.equal(m, 1);
});
t('setup: mDNS questions and answers (with name compression)', () => {
  const q = SU.mdnsQuery('_home-assistant._tcp.local'); assert.equal(q.readUInt16BE(4), 1); assert.ok(q.includes(Buffer.from('_home-assistant')));
  const lab = (n) => Buffer.concat([...n.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
  const rr = (name, type, data) => { const h = Buffer.alloc(10); h.writeUInt16BE(type, 0); h.writeUInt16BE(1, 2); h.writeUInt16BE(data.length, 8); return Buffer.concat([name, h, data]); };
  const head = Buffer.alloc(12); head.writeUInt16BE(0x8400, 2); head.writeUInt16BE(4, 6);
  const svc = lab('_home-assistant._tcp.local'), inst = Buffer.concat([Buffer.from([4]), Buffer.from('Home'), Buffer.from([0xc0, 12])]);   // "Home" + pointer to the service name
  const srv = Buffer.alloc(6); srv.writeUInt16BE(8123, 4);
  const pkt = Buffer.concat([head, rr(svc, 12, inst), rr(inst, 33, Buffer.concat([srv, lab('ha.local')])), rr(lab('ha.local'), 1, Buffer.from([192, 168, 1, 20])), rr(inst, 16, Buffer.concat([Buffer.from([25]), Buffer.from('base_url=http://ha:8123/x')]))]);   // scrub-ok: example
  const r = SU.mdnsParse(pkt);
  assert.equal(r.find((x) => x.type === 12).data, 'Home._home-assistant._tcp.local');
  assert.deepEqual(r.find((x) => x.type === 33).data, { port: 8123, target: 'ha.local' });
  assert.equal(r.find((x) => x.type === 1).data, '192.168.1.20');   // scrub-ok: example
  assert.equal(r.find((x) => x.type === 16).data.base_url, 'http://ha:8123/x');
  assert.deepEqual(SU.mdnsParse(Buffer.from([1, 2, 3])), [], 'a broken packet is ignored');
});
t('self-healing: settings history keeps the newest ten and one a day for two weeks', () => {
  const now = Date.parse('2026-10-17T12:00:00Z'), ids = [];
  for (let d = 0; d < 20; d++) for (let h = 0; h < 3; h++) { const t0 = new Date(now - d * 86400_000 - h * 3600_000); ids.push(`${t0.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-auto`); }
  const gone = new Set(SU.settingsPrune(ids, now)), kept = ids.filter((x) => !gone.has(x));
  assert.ok(ids.slice(0, 10).every((x) => kept.includes(x)), 'the newest ten');
  assert.equal(new Set(kept.map((x) => x.slice(0, 8))).size, 15, 'one per day for 14 days (plus today)');
  assert.ok(kept.length < 30 && gone.size > 0);
});
t('self-healing: a damaged settings file is put aside and the last good copy used; a copy can be put back', () => {
  const dir = '/tmp/casatorch-unit-heal', hist = `${dir}/hist`; fsMod.rmSync(dir, { recursive: true, force: true }); fsMod.mkdirSync(dir, { recursive: true });
  const src = (f) => `${dir}/${f}`, opts = { dir: hist, source: src };
  fsMod.writeFileSync(src('config.json'), JSON.stringify({ house: { name: 'One' } })); fsMod.writeFileSync(src('users.json'), '{"list":[]}');
  const a = SU.settingsSnapshot('start', opts); assert.ok(a);
  assert.equal(SU.settingsSnapshot('auto', opts), null, 'nothing changed: no new copy');
  fsMod.writeFileSync(src('config.json'), '{"house": {"na');   // a save cut off half way
  assert.equal(SU.settingsSnapshot('auto', opts), null, 'a broken file is never kept as good');
  const r = SU.healFile('config.json', opts);
  assert.equal(r.from, a); assert.equal(JSON.parse(fsMod.readFileSync(src('config.json'), 'utf8')).house.name, 'One');
  assert.ok(fsMod.readdirSync(dir).some((f) => f.startsWith('config.json.damaged-')), 'the damaged file is kept');
  assert.equal(SU.healFile('config.json', opts), null, 'a good file is left alone');
  fsMod.writeFileSync(src('config.json'), JSON.stringify({ house: { name: 'Two' } }));
  SU.settingsRestore(a, opts);
  assert.equal(JSON.parse(fsMod.readFileSync(src('config.json'), 'utf8')).house.name, 'One');
  assert.ok(SU.settingsHistory(hist).some((id) => id.endsWith('-before-putting-back')), 'what was there is saved first');
  assert.throws(() => SU.settingsRestore('../../etc', opts));
});

/* A damaged config.json with no settings history: CasaTorch doesn't start (no setup wizard), shows a recovery
   page, says why in the log, and leaves the file alone. A real start, in its own process (00b-heal.js). */
await t('self-healing: a damaged settings file with no good copy stops CasaTorch with a recovery page, never setup', async () => {
  const { spawn } = await import('node:child_process'), net = await import('node:net'), url = await import('node:url');
  const dir = '/tmp/casatorch-unit-broken'; fsMod.rmSync(dir, { recursive: true, force: true }); fsMod.mkdirSync(dir, { recursive: true });
  const broken = '{"house": {"name": "One", "time'; fsMod.writeFileSync(`${dir}/config.json`, broken);
  const port = await new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  const env = { ...process.env, CASATORCH_DATA_DIR: dir, PORT: String(port), HTTPS_PORT: '0', CASATORCH_MDNS: '0' }; delete env.CASATORCH_TEST; delete env.CASATORCH_DEMO;
  const child = spawn(process.execPath, [url.fileURLToPath(new URL('../server.js', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (c) => { log += c; }); child.stderr.on('data', (c) => { log += c; });
  try {
    let r = null;
    for (let i = 0; i < 60 && !r; i++) { await new Promise((ok) => setTimeout(ok, 150)); r = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' }).catch(() => null); }
    assert.ok(r, `it answers (log: ${log})`);
    assert.equal(r.status, 503); const html = await r.text();
    assert.match(html, /can't open its settings/); assert.doesNotMatch(html, /setup\.html/);
    const s = await fetch(`http://127.0.0.1:${port}/setup.html`, { redirect: 'manual' }); assert.equal(s.status, 503, 'no setup wizard');
    const api = await fetch(`http://127.0.0.1:${port}/api/setup/status`); assert.equal(api.status, 503); assert.equal((await api.json()).recovery, true);
    assert.match(log, /settings file is damaged/); assert.match(log, /not starting/);
    assert.equal(fsMod.readFileSync(`${dir}/config.json`, 'utf8'), broken, 'the damaged file is left as it was');
    assert.ok(fsMod.readdirSync(dir).some((f) => f.startsWith('config.json.damaged-')), 'and a copy is kept');
  } finally { child.kill(); }
});

/* Secure access (42-remote.js, 02-remote-gate.js): the words for each state, the self-test, cloudflared's lines, the Basic gate. */
const RM = globalThis.__casatorchRemote;
t('secure access: each state in plain words, with the right fix', () => {
  const V = (o) => RM.remoteView({ on: true, state: 'connected', code: null, check: { ok: true }, anywhere: true, ...o });
  assert.equal(RM.remoteView({ on: false }).status, 'off');
  assert.equal(V({ state: 'downloading' }).title, 'Getting ready…');
  assert.equal(V({ state: 'connecting', check: { ok: null } }).title, 'Connecting…');
  assert.equal(V({ state: 'connecting' }).title, 'Reconnecting…', 'it worked before: the connection came back by itself');
  assert.equal(V({ check: { ok: null } }).status, 'checking');
  assert.deepEqual([V({}).status, V({}).title], ['working', 'Working from anywhere']);
  assert.equal(V({ anywhere: false }).title, 'Working on your home Wi-Fi'); assert.match(V({ anywhere: false }).detail, /part of Pro/);
  for (const [code, fix] of [['token', 'repair'], ['tunnel', 'repair'], ['mismatch', 'repair'], ['download', 'repair'], ['blocked', 'check'], ['edgedns', 'check'], ['offline', 'check']]) {
    const v = V({ code }); assert.equal(v.status, 'problem', code); assert.equal(v.fix.action, fix, code); assert.ok(v.title && v.detail, code);
  }
  assert.match(V({ code: 'blocked' }).detail, /port 7844/);
  assert.equal(V({ code: 'dns' }).status, 'checking', 'a brand-new name: still checking, not broken');
  assert.match(V({ code: 'service', why: 'casatorch.com is busy' }).detail, /^casatorch\.com is busy\. /);
  assert.equal(V({ state: 'error', code: null, why: 'Something odd' }).fix.action, 'repair');
  for (const [, [title, detail]] of Object.entries(RM.REMOTE_WHY)) assert.ok(!/[A-Z]{3,}_|Error:|undefined/.test(title + (detail || '')), title);
});
t('secure access: what the self-test answer means', () => {
  const R = RM.remoteCheckResult, e = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  const home = { id: 'h1' }, good = { casatorch: true, home, check: 'n0nce' };
  assert.deepEqual(R({ status: 200, json: good, nonce: 'n0nce', homeId: 'h1' }), { ok: true, code: 'ok' });
  assert.equal(R({ status: 200, json: { ...good, check: undefined }, nonce: 'n0nce', homeId: 'h1' }).code, 'mismatch', 'answered, but not to our code');
  assert.equal(R({ status: 200, json: { ...good, home: { id: 'other' } }, nonce: 'n0nce', homeId: 'h1' }).code, 'mismatch', 'another CasaTorch');
  assert.equal(R({ error: e('ENOTFOUND') }).code, 'dns'); assert.equal(R({ error: e('EAI_AGAIN') }).code, 'dns');
  assert.equal(R({ error: Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) }).code, 'unreachable');
  assert.equal(R({ error: e('ECONNREFUSED') }).code, 'unreachable');
  for (const s of [502, 530]) assert.equal(R({ status: s, json: null }).code, 'tunnel', `Cloudflare ${s}`);
  assert.equal(R({ status: 403, json: { needsPro: true } }).code, 'unreachable');
});
t('secure access: cloudflared\'s log lines', () => {
  const K = RM.remoteLineKind;
  assert.equal(K('2026-10-17T12:00:00Z INF Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.200.13 location=sjc01 protocol=quic'), 'registered');
  assert.equal(K('ERR Register tunnel error from server side error="Unauthorized: Invalid tunnel secret" connIndex=0'), 'token');
  assert.equal(K('ERR Failed to dial a quic connection error="failed to dial to edge with quic: timeout: no recent network activity" connIndex=0'), 'quic');
  assert.equal(K('ERR Unable to establish connection with Cloudflare edge error="DialContext error: dial tcp 198.41.192.7:7844: i/o timeout"'), 'dial');
  assert.equal(K('ERR edge discovery: error looking up Cloudflare edge IPs: the DNS query failed error="lookup _v2-origintunneld._tcp.argotunnel.com"'), 'edgedns');
  assert.equal(K('INF Unregistered tunnel connection connIndex=1'), 'dropped');
  assert.equal(K('INF Starting tunnel tunnelID=abc'), null);
  const restore = RM.patchConfig({ remote: { token: 'eyJhIjoiYmMifQsecretTOKENvalue' } });
  try { const m = RM.remoteMask('token eyJhIjoiYmMifQsecretTOKENvalue at 198.41.192.7'); assert.ok(!m.includes('secretTOKEN') && !m.includes('198.41')); } finally { restore(); }
});
await t('secure access: Basic, away from home - JSON for the app, a page for browsers; at home, Pro and the self-test get through', async () => {
  const restore = RM.patchConfig({ remote: { on: true, hostname: 'home-test.casatorch.test' }, setupAt: '2020-01-01T00:00:00.000Z', license: undefined });
  const H0 = { ...H.remote.homeIps }; H.remote.homeIps = { v4: '198.51.100.7', v6: null, at: Date.now() };
  const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
  const get = (p, ip, headers = {}) => new Promise((ok, bad) => { const rq = http.get({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: 'home-test.casatorch.test', 'cf-connecting-ip': ip, ...headers } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => ok({ status: r.statusCode, type: r.headers['content-type'] || '', body: b })); }); rq.on('error', bad); });
  try {
    const a = await get('/api/app/hello', '203.0.113.50');
    assert.equal(a.status, 403); assert.match(a.type, /json/); assert.deepEqual(JSON.parse(a.body), { error: 'You\'re away from home. Using CasaTorch from anywhere is part of Pro.', away: true, needsPro: true });
    const pg = await get('/', '203.0.113.50', { accept: 'text/html' }); assert.equal(pg.status, 403); assert.match(pg.type, /html/); assert.match(pg.body, /away from home/);
    assert.equal((await get('/api/app/hello', '198.51.100.7')).status, 200, 'from home: fine');
    H.remote.nonce = 'q1w2e3r4t5y6u7i8';
    const self = await get('/api/app/hello', '203.0.113.50', { 'x-casatorch-check': 'q1w2e3r4t5y6u7i8' });
    assert.equal(self.status, 200); assert.equal(JSON.parse(self.body).check, 'q1w2e3r4t5y6u7i8', 'the self-test is recognized');
    assert.equal((await get('/api/app/hello', '203.0.113.50', { 'x-casatorch-check': 'q1w2e3r4t5y6u7i9' })).status, 403, 'a wrong code is not');
    H.remote.nonce = null;
    assert.equal((await get('/api/app/hello', '203.0.113.50', { 'x-casatorch-check': 'q1w2e3r4t5y6u7i8' })).status, 403, 'nor an old one');
  } finally { H.remote.nonce = null; H.remote.homeIps = H0; srv.close(); restore(); }
});

/* Household (78h-household.js): bin schedules in the house's own time zone, holidays, waste sensors, the mailbox, appliances. */
{
  const HH = globalThis.__casatorchHousehold;
  const bin = (x) => ({ id: 'aaaaaaaaaa', source: 'schedule', ...x });
  t('household: weekly on Tuesdays', () => assert.deepEqual(HH.hhRawDates(bin({ repeat: 'weekly', dow: 2 }), '2026-10-17', '2026-11-04'), ['2026-10-20', '2026-10-27', '2026-11-03']));
  t('household: every 2 weeks keeps to its start week', () => {
    const b = bin({ repeat: 'biweekly', dow: 4, start: '2026-10-08' });
    assert.deepEqual(HH.hhRawDates(b, '2026-10-17', '2026-11-30'), ['2026-10-22', '2026-11-05', '2026-11-19']);
    assert.deepEqual(HH.hhRawDates(b, '2026-10-01', '2026-10-20'), ['2026-10-08'], 'nothing before the first pickup');
  });
  t('household: monthly - first Monday, last Friday, the 31st in a short month', () => {
    assert.deepEqual(HH.hhRawDates(bin({ repeat: 'monthly', nth: 1, dow: 1 }), '2026-10-17', '2027-01-10'), ['2026-11-02', '2026-12-07', '2027-01-04']);
    assert.deepEqual(HH.hhRawDates(bin({ repeat: 'monthly', nth: -1, dow: 5 }), '2026-10-01', '2026-12-31'), ['2026-10-30', '2026-11-27', '2026-12-25']);
    assert.deepEqual(HH.hhRawDates(bin({ repeat: 'monthly', mday: 31 }), '2027-01-15', '2027-04-30'), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });
  t('household: a holiday week slides the holiday and the rest of its week a day later', () => {
    const b = bin({ repeat: 'weekly', dow: 4 }), mon = bin({ id: 'bbbbbbbbbb', repeat: 'weekly', dow: 1 });
    const ch = [{ holiday: '2026-11-26', days: 1 }];   // Thanksgiving (Thursday)
    assert.deepEqual(HH.hhBinDates(b, '2026-11-20', ch).slice(0, 3), [{ date: '2026-11-27', from: '2026-11-26' }, { date: '2026-12-03', from: null }, { date: '2026-12-10', from: null }]);
    assert.equal(HH.hhBinDates(mon, '2026-11-20', ch)[0].date, '2026-11-23', 'Monday, before the holiday: unchanged');
    const xmas = [{ holiday: '2026-12-21', days: 1 }];   // a Monday holiday moves Thursday too
    assert.equal(HH.hhBinDates(b, '2026-12-20', xmas)[0].date, '2026-12-25');
  });
  t('household: skip one pickup, or move one (for one bin or all)', () => {
    const b = bin({ repeat: 'weekly', dow: 2 });
    assert.equal(HH.hhBinDates(b, '2026-10-17', [{ date: '2026-10-20', to: null }])[0].date, '2026-10-27');
    assert.deepEqual(HH.hhBinDates(b, '2026-10-17', [{ date: '2026-10-20', to: '2026-10-21', bin: 'aaaaaaaaaa' }])[0], { date: '2026-10-21', from: '2026-10-20' });
    assert.equal(HH.hhBinDates(b, '2026-10-17', [{ date: '2026-10-20', to: '2026-10-21', bin: 'cccccccccc' }])[0].date, '2026-10-20', 'a change for another bin');
  });
  t('household: tonight / tomorrow / later', () => assert.deepEqual([0, 1, 2, 5, null].map(HH.hhBinState), ['today', 'tonight', 'tomorrow', 'later', 'none']));
  t('household: the house\'s own date, not this computer\'s (late evening in Los Angeles is tomorrow in UTC)', () => {
    const L = HH.hhLocal(Date.parse('2026-10-20T05:30:00Z'), 'America/Los_Angeles');
    assert.deepEqual(L, { date: '2026-10-19', time: '22:30', dow: 1 });
    assert.equal(HH.hhLocal(Date.parse('2026-10-20T05:30:00Z'), 'Europe/Berlin').date, '2026-10-20');
  });
  t('household: 7 PM the evening before, across daylight-saving changes', () => {
    assert.equal(new Date(HH.hhAt('2026-11-01', '19:00', 'America/Los_Angeles')).toISOString(), '2026-11-02T03:00:00.000Z', 'Nov 1: standard time (UTC-8)');
    assert.equal(new Date(HH.hhAt('2026-10-31', '19:00', 'America/Los_Angeles')).toISOString(), '2026-11-01T02:00:00.000Z', 'the day before: daylight time (UTC-7)');
    assert.equal(new Date(HH.hhAt('2026-03-08', '19:00', 'America/Los_Angeles')).toISOString(), '2026-03-09T02:00:00.000Z', 'spring forward');
    assert.equal(new Date(HH.hhAt('2026-10-25', '19:00', 'Europe/Berlin')).toISOString(), '2026-10-25T18:00:00.000Z', 'Berlin after its change');
    const b = bin({ repeat: 'weekly', dow: 1 });   // Mondays: same weekday both sides of the change
    assert.deepEqual(HH.hhRawDates(b, '2026-10-25', '2026-11-10'), ['2026-10-26', '2026-11-02', '2026-11-09']);
  });
  t('household: waste-collection sensors in their many formats', () => {
    const tz = 'America/Los_Angeles', today = '2026-10-17';
    const S = (state, attributes = {}, id = 'sensor.waste_recycling') => ({ entity_id: id, state, attributes });
    assert.deepEqual(HH.hhWasteDates(S('2026-10-20', { device_class: 'date' }), today, tz), ['2026-10-20']);
    assert.deepEqual(HH.hhWasteDates(S('in 3 days'), today, tz), ['2026-10-20']);
    assert.deepEqual(HH.hhWasteDates(S('Tomorrow'), today, tz), ['2026-10-18']);
    assert.deepEqual(HH.hhWasteDates(S('3', { unit_of_measurement: 'days' }), today, tz), ['2026-10-20']);
    assert.deepEqual(HH.hhWasteDates(S('2026-10-21T06:00:00+00:00', { device_class: 'timestamp' }), today, tz), ['2026-10-20'], 'a moment: the house\'s day');
    assert.deepEqual(HH.hhWasteDates(S('2', { daysTo: 2, types: ['Recycling'], next_date: '2026-10-19' }), today, tz), ['2026-10-19']);
    const upcoming = S('in 3 days', { '20.10.2026': 'Recycling', '23.10.2026': 'Trash', '03.11.2026': 'Recycling' }, 'sensor.waste_collection');
    assert.deepEqual(HH.hhWasteDates(upcoming, today, tz, 'recycling'), ['2026-10-20', '2026-11-03'], 'one sensor, several bins');
    assert.deepEqual(HH.hhWasteDates(S('x', { Recycling: '2026-10-20', Trash: '2026-10-23' }), today, tz, 'trash'), ['2026-10-23']);
    assert.deepEqual(HH.hhWasteDates({ entity_id: 'calendar.waste', state: 'off', attributes: { message: 'Yard waste', start_time: '2026-10-22 00:00:00' } }, today, tz), ['2026-10-22']);
    assert.deepEqual(HH.hhWasteDates(S('2026-10-01'), today, tz), [], 'a date gone by');
  });
  t('household: suggestions from Home Assistant', () => {
    const st = [
      { entity_id: 'sensor.recycling_pickup', state: '2026-10-20', attributes: { friendly_name: 'Recycling pickup', device_class: 'date' } },
      { entity_id: 'binary_sensor.mailbox_flap', state: 'off', attributes: { friendly_name: 'Mailbox flap', device_class: 'opening' } },
      { entity_id: 'sensor.email_unread', state: '4', attributes: { friendly_name: 'Unread e-mail' } },
      { entity_id: 'plant.monstera', state: 'ok', attributes: { moisture: 33 } },
      { entity_id: 'sensor.basil_soil_moisture', state: '12', attributes: { unit_of_measurement: '%', device_class: 'moisture' } },
      { entity_id: 'sensor.bathroom_humidity', state: '55', attributes: { unit_of_measurement: '%', device_class: 'humidity' } },
      { entity_id: 'sensor.washing_machine_plug_power', state: '3.1', attributes: { unit_of_measurement: 'W', device_class: 'power' } },
      { entity_id: 'sensor.washing_machine_remaining_time', state: '0', attributes: { unit_of_measurement: 'min' } },
      { entity_id: 'sensor.dishwasher_operation_state', state: 'Ready', attributes: {} },
    ];
    const s = HH.hhSuggest(st, '2026-10-17', 'UTC');
    assert.deepEqual(s.bins.map((x) => [x.entity, x.icon, x.next]), [['sensor.recycling_pickup', 'recycling', '2026-10-20']]);
    assert.deepEqual(s.mail.map((x) => x.entity), ['binary_sensor.mailbox_flap']);
    assert.deepEqual(s.plants.map((x) => x.entity), ['plant.monstera', 'sensor.basil_soil_moisture']);
    assert.deepEqual(s.apps.map((x) => [x.kind, x.entity, x.mode, x.remaining]), [['washer', 'sensor.washing_machine_plug_power', 'power', 'sensor.washing_machine_remaining_time'], ['dishwasher', 'sensor.dishwasher_operation_state', 'state', null]]);
  });
  t('household: a washer on a smart plug - running above the watts, done after 5 quiet minutes', () => {
    const app = { mode: 'power', onW: 8, offMin: 5 }, st = { phase: 'idle' }, m = 60_000, T0 = Date.parse('2026-10-17T10:00:00Z');
    assert.equal(HH.hhAppStep(st, app, { power: 2 }, T0), null);
    assert.equal(HH.hhAppStep(st, app, { power: 300 }, T0 + 10_000), null, 'a blip is not a start');
    assert.equal(HH.hhAppStep(st, app, { power: 450 }, T0 + 80_000), 'started'); assert.equal(st.phase, 'running');
    assert.equal(HH.hhAppStep(st, app, { power: 1 }, T0 + 30 * m), null, 'soaking: below, but not long enough');
    assert.equal(HH.hhAppStep(st, app, { power: 1 }, T0 + 33 * m), null);
    assert.equal(HH.hhAppStep(st, app, { power: 200 }, T0 + 34 * m), null, 'spinning again'); assert.equal(st.belowSince, null);
    assert.equal(HH.hhAppStep(st, app, { power: 1.5 }, T0 + 50 * m), null);
    assert.equal(HH.hhAppStep(st, app, { power: 1.5 }, T0 + 55 * m), 'done'); assert.equal(st.phase, 'done'); assert.equal(st.doneAt, new Date(T0 + 50 * m).toISOString(), 'done when it went quiet');
    assert.equal(HH.hhAppStep(st, app, { power: 1 }, T0 + 60 * m), null); assert.equal(st.phase, 'done', 'stays done until emptied');
    assert.equal(HH.hhAppStep(st, app, { power: 1 }, T0 + 13 * 3600_000), null); assert.equal(st.phase, 'idle', 'not news half a day later');
  });
  t('household: appliances with a status or a time-left sensor', () => {
    const st = { phase: 'idle' }, app = { mode: 'state' };
    assert.equal(HH.hhAppStep(st, app, { text: 'Ready' }, 1), null);
    assert.equal(HH.hhAppStep(st, app, { text: 'Run' }, 2), 'started');
    assert.equal(HH.hhAppStep(st, app, { text: 'unavailable' }, 3), null); assert.equal(st.phase, 'running', 'offline for a moment is not done');
    assert.equal(HH.hhAppStep(st, app, { text: 'Finished' }, 4), 'done');
    const r = { phase: 'idle' }, rem = { mode: 'remaining' };
    assert.equal(HH.hhAppStep(r, rem, { remainingMin: 0 }, 1), null);
    assert.equal(HH.hhAppStep(r, rem, { remainingMin: 42 }, 2), 'started');
    assert.equal(HH.hhAppStep(r, rem, { remainingMin: 0 }, 3), 'done');
    const now = Date.parse('2026-10-17T10:00:00Z');
    assert.equal(HH.hhMinutes({ state: '23', attributes: { unit_of_measurement: 'min' } }, now), 23);
    assert.equal(HH.hhMinutes({ state: '1.5', attributes: { unit_of_measurement: 'h' } }, now), 90);
    assert.equal(HH.hhMinutes({ state: '0:23:00', attributes: {} }, now), 23);
    assert.equal(HH.hhMinutes({ state: '2026-10-17T10:23:00Z', attributes: { device_class: 'timestamp' } }, now), 23);
  });
  t('household: the mailbox - first opening is post, the next (after a couple of minutes) is collected', () => {
    const st = {}, cfg = { reset: 'door' }, at = (m) => new Date(Date.parse('2026-10-17T10:00:00Z') + m * 60_000).toISOString();
    assert.equal(HH.hhMailStep(st, cfg, { state: 'off', last_changed: at(0) }, 0), null, 'first look');
    assert.equal(HH.hhMailStep(st, cfg, { state: 'on', last_changed: at(60) }, 0), 'arrived'); assert.equal(st.at, at(60));
    assert.equal(HH.hhMailStep(st, cfg, { state: 'off', last_changed: at(60.1) }, 0), null, 'flap closes');
    assert.equal(HH.hhMailStep(st, cfg, { state: 'off', last_changed: at(60.5) }, 0), null, 'rattled again within the minute (missed between looks): still the delivery');
    assert.equal(HH.hhMailStep(st, cfg, { state: 'on', last_changed: at(300) }, 0), 'collected'); assert.equal(st.state, 'empty');
    const tap = {}; HH.hhMailStep(tap, { reset: 'tap' }, { state: 'off', last_changed: at(0) }, 0); HH.hhMailStep(tap, { reset: 'tap' }, { state: 'on', last_changed: at(1) }, 0);
    assert.equal(HH.hhMailStep(tap, { reset: 'tap' }, { state: 'on', last_changed: at(90) }, 0), null); assert.equal(tap.state, 'post', 'only a tap clears it');
  });
  t('household: thirsty plants', () => {
    assert.deepEqual(HH.hhPlantOf({ entity_id: 'sensor.basil', state: '12', attributes: {} }, 20), { moisture: 12, thirsty: true, gone: false });
    assert.equal(HH.hhPlantOf({ entity_id: 'plant.monstera', state: 'ok', attributes: { moisture: 33 } }, 20).thirsty, false);
    assert.equal(HH.hhPlantOf({ entity_id: 'plant.cactus', state: 'problem', attributes: { problem: 'moisture low' } }, 20).thirsty, true);
  });
  t('household: bin settings are checked (and every 2 weeks starts on its weekday)', () => {
    const b = HH.hhCleanBin({ name: ' Recycling ', icon: 'recycling', color: '#2563eb', repeat: 'biweekly', dow: 4, start: '2026-10-19' });
    assert.equal(b.name, 'Recycling'); assert.equal(b.start, '2026-10-22');
    assert.throws(() => HH.hhCleanBin({ name: '' }), /name/);
    assert.equal(HH.hhCleanBin({ name: 'x', icon: '<script>', color: 'red' }).icon, 'trash');
    assert.throws(() => HH.hhCleanBin({ name: 'x', source: 'ha', entity: 'light.kitchen' }), /sensor/);
  });
  t('household: setup\'s trash-day answer becomes a weekly Trash bin (once; skipping adds nothing)', () => {
    const was = HH.hh.cfg.bins; HH.hh.cfg.bins = [];
    try {
      HH.hhFromSetup(''); assert.equal(HH.hh.cfg.bins.length, 0);
      HH.hhFromSetup('2'); assert.deepEqual(HH.hh.cfg.bins.map((b) => [b.name, b.repeat, b.dow]), [['Trash', 'weekly', 2]]);
      HH.hhFromSetup('4'); assert.equal(HH.hh.cfg.bins[0].dow, 2, 'bins already set up stay as they are');
    } finally { HH.hh.cfg.bins = was; }
  });
  t('household: a city calendar becomes bins, one per kind of pickup', () => {
    const occ = [{ title: 'Garbage & Recycling', start: '2026-10-20T00:00:00.000Z', allDay: true }, { title: 'Garbage', start: '2026-10-27T00:00:00.000Z', allDay: true }, { title: 'Yard waste', start: '2026-10-22T15:00:00.000Z', allDay: false }];
    assert.deepEqual(HH.hhIcalKinds(occ, 'America/Los_Angeles').map((k) => [k.title, k.count, k.next, k.icon]), [['Garbage', 2, '2026-10-20', 'trash'], ['Recycling', 1, '2026-10-20', 'recycling'], ['Yard waste', 1, '2026-10-22', 'yard']]);
  });
}

await (await import('./radar-unit.mjs')).default(t);   // the rain radar's tile proxy (radar-unit.mjs)
console.log(`\n${n} passed`);
process.exit(0);
