/* Unit tests for the parts that read other people's data formats. Run: node test/unit.mjs */
import assert from 'node:assert/strict';
process.env.CASATORCH_TEST = '1'; process.env.CASATORCH_DATA_DIR = '/tmp/casatorch-unit';
await import('../server.js');
const H = globalThis.__casatorch;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
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

console.log(`\n${n} passed`);
process.exit(0);
