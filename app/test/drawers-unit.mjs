/* Unit tests for "tap any tile for more": the scores drawer's parsers (standings, a team's schedule, a game's line
   score) against answers in the scores service's shape (fixtures/scores), the weather drawer's forecast reader, the
   demo's sample scores, and the drawer's routing (the address, what a change of address means, which taps open it).
   Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'scores', n), 'utf8'));
const drSrc = fs.readFileSync(path.join(HERE, '..', 'src', 'client', '06d-drawer.js'), 'utf8');
const R = new Function(`${drSrc.slice(drSrc.indexOf('/* @drroute:start */'), drSrc.indexOf('/* @drroute:end */'))}; return { drParse, drHash, drChange, drTapOpens };`)();

export default async function drawersTests(t) {
  const SP = globalThis.__casatorchSports, F = globalThis.__casatorchForecast;

  /* ---- standings ---- */
  t('scores drawer: NFL standings - your division, sorted by win percentage, your team marked, the rest of the conference', () => {
    const s = SP.standingsView(fx('nfl-standings.json'), 'nfl', '25');
    assert.equal(s.sport, 'football');
    assert.deepEqual(s.columns.map((c) => c.label), ['W', 'L', 'T', 'PCT', 'STRK']);
    assert.equal(s.conference, 'National Football Conference');
    assert.deepEqual(s.groups.map((g) => g.name), ['NFC West', 'NFC East'], 'only the conference your team plays in');
    const west = s.groups.find((g) => g.mine);
    assert.equal(west.name, 'NFC West');
    assert.deepEqual(west.rows.map((r) => r.abbr), ['SF', 'SEA', 'LAR', 'ARI']);
    assert.deepEqual(west.rows.map((r) => r.pos), [1, 2, 3, 4]);
    const sf = west.rows[0];
    assert.equal(sf.mine, true); assert.deepEqual(sf.cells, ['5', '1', '0', '.833', 'W3']); assert.equal(sf.color, '#aa0000');
    assert.equal(sf.logo, undefined, 'logos only when the household turned them on');
    assert.equal(west.rows.filter((r) => r.mine).length, 1);
  });
  t('scores drawer: NBA standings - games behind worked out when the answer has none', () => {
    const s = SP.standingsView(fx('nba-standings.json'), 'nba', '9');
    const west = s.groups.find((g) => g.mine);
    assert.deepEqual(west.rows.map((r) => r.abbr), ['GS', 'LAL', 'PHX']);
    const gb = s.columns.findIndex((c) => c.key === 'gamesBehind');
    assert.deepEqual(west.rows.map((r) => r.cells[gb]), ['-', '1', '6']);
    assert.equal(west.rows[0].cells[s.columns.findIndex((c) => c.key === 'winPercent')], '.738');
  });
  t('scores drawer: soccer table - by rank, with games played, draws, goal difference and points', () => {
    const s = SP.standingsView(fx('epl-standings.json'), 'epl', '364');
    assert.deepEqual(s.columns.map((c) => c.label), ['GP', 'W', 'D', 'L', 'GD', 'PTS']);
    const g = s.groups[0];
    assert.deepEqual(g.rows.map((r) => r.abbr), ['ARS', 'LIV', 'MNC']);
    assert.deepEqual(g.rows[1].cells, ['8', '6', '1', '1', '+10', '19']);
    assert.equal(g.rows[1].mine, true);
    assert.equal(g.rows[2].cells[4], '-2');
  });
  t('scores drawer: no standings in the answer is null, not a crash', () => {
    assert.equal(SP.standingsView({}, 'nfl', '25'), null);
    assert.equal(SP.standingsView(null, 'nfl', '25'), null);
  });

  /* ---- a team's schedule ---- */
  t('scores drawer: a team\'s schedule - last 5 newest first with W / L / T from its side, the live game, the next games with TV', () => {
    const v = SP.teamScheduleView(fx('nfl-schedule-25.json'), 'nfl', '25');
    assert.equal(v.team.record, '5-1'); assert.equal(v.team.standing, '1st in NFC West'); assert.equal(v.team.abbr, 'SF');
    assert.deepEqual(v.last.map((g) => g.id), ['405', '404', '403', '402', '401']);
    assert.deepEqual(v.last.map((g) => g.result), ['W', 'W', 'T', 'L', 'W']);
    assert.equal(v.last[1].mine, 'away'); assert.equal(v.last[1].opp.abbr, 'LAR'); assert.equal(v.last[1].away.score, '31');
    assert.equal(v.live.id, '406'); assert.equal(v.live.mine, 'home'); assert.equal(v.live.detail, 'Q3 4:12');
    assert.deepEqual(v.next.map((g) => g.id), ['407', '408']);
    assert.equal(v.next[0].broadcast, 'NBC'); assert.equal(v.next[1].broadcast, 'FOX'); assert.equal(v.next[0].home.score, null);
  });
  t('scores drawer: an empty schedule has no games, and a game from the other side reads correctly', () => {
    const v = SP.teamScheduleView({ events: [] }, 'nfl', '25');
    assert.deepEqual([v.last, v.next, v.live], [[], [], null]);
    const g = SP.teamSide({ state: 'post', home: { id: '1', abbr: 'A', score: '3' }, away: { id: '2', abbr: 'B', score: '7', winner: true } }, '1');
    assert.equal(g.result, 'L'); assert.equal(g.opp.abbr, 'B');
    assert.equal(SP.teamSide({ state: 'post', home: { id: '1' }, away: { id: '2' } }, '9').mine, null);
  });

  /* ---- a game's line score ---- */
  t('scores drawer: a game\'s line score by period, and the team numbers both sides have', () => {
    const s = SP.gameSummaryView(fx('nfl-summary-406.json'), 'nfl');
    assert.equal(s.state, 'in'); assert.equal(s.periods, 3); assert.equal(s.broadcast, 'NBC'); assert.equal(s.venue, 'Home Field');
    assert.deepEqual(s.teams.map((x) => x.side), ['away', 'home']);
    assert.deepEqual(s.teams[0].lines, ['3', '7', '0']); assert.deepEqual(s.teams[1].lines, ['7', '3', '7']);
    assert.deepEqual(s.stats, [{ label: 'Total Yards', away: '287', home: '342' }, { label: 'Turnovers', away: '2', home: '1' }], 'a number only one side has is left out');
    assert.equal(SP.gameSummaryView({}, 'nfl'), null);
  });

  /* ---- the demo's sample scores ---- */
  t('scores drawer: the demo has plausible standings, results and games - and they agree with each other', () => {
    for (const lg of ['nfl', 'nba', 'mlb']) {
      const d = SP.demoTeamMore(lg);
      assert.ok(d.demo && d.standings && d.last.length === 5 && d.next.length >= 3, lg);
      const row = d.standings.groups.find((g) => g.mine).rows.find((r) => r.mine);
      assert.equal(d.team.record, `${row.cells[0]}-${row.cells[1]}`, `${lg}: the record is the standings' record`);
      assert.ok(d.last.every((g) => ['W', 'L', 'T'].includes(g.result) && Date.parse(g.start) < Date.now()), `${lg}: results are in the past`);
      assert.ok(d.next.every((g) => g.state === 'pre' && g.result === null), `${lg}: games to come have no result`);
      assert.ok(d.next.every((g, i) => i === 0 || g.start >= d.next[i - 1].start), `${lg}: next games in order`);
    }
    const live = SP.demoTeamMore('nfl').live, box = SP.demoGame('nfl', live.id);
    for (const tm of box.teams) assert.equal(tm.lines.reduce((s, v) => s + Number(v), 0), Number(tm.score), 'periods add up to the score');
    assert.ok(SP.myTeams().every((x) => x.league && x.id && !('logo' in x)), 'the teams from Settings, without logos');
  });

  /* ---- the weather drawer ---- */
  t('weather drawer: 48 hours and up to 10 days from the complete forecast, with rain, chance, wind, gusts and UV', () => {
    const t0 = Date.parse('2026-10-13T20:00:00Z');
    const series = [];
    for (let i = 0; i < 60; i++) series.push({ time: new Date(t0 + i * 3600_000).toISOString(), data: { instant: { details: { air_temperature: 10 + (i % 12), wind_speed: 4, wind_speed_of_gust: 9, wind_from_direction: 270, relative_humidity: 70, ultraviolet_index_clear_sky: i % 24 < 10 ? 2 : 0, air_pressure_at_sea_level: 1015.2 } },
      next_1_hours: { summary: { symbol_code: i === 3 ? 'rain' : 'cloudy' }, details: { precipitation_amount: i === 3 ? 1.5 : 0, probability_of_precipitation: i === 3 ? 80 : 5 } } } });
    for (let i = 0; i < 28; i++) series.push({ time: new Date(t0 + (60 + i * 6) * 3600_000).toISOString(), data: { instant: { details: { air_temperature: 8 } }, next_6_hours: { summary: { symbol_code: 'lightrain' }, details: { precipitation_amount: 2, air_temperature_max: 14, air_temperature_min: 5, probability_of_precipitation: 60 } } } });
    const f = F.forecastView({ properties: { meta: { updated_at: '2026-10-13T19:30:00Z' }, timeseries: series } }, 'America/Los_Angeles', 'Testville');
    assert.equal(f.hours.length, 48); assert.equal(f.place, 'Testville'); assert.equal(f.updated, '2026-10-13T19:30:00Z');
    assert.equal(f.hours[3].rainMm, 1.5); assert.equal(f.hours[3].pop, 80); assert.equal(f.hours[0].gust, 20); assert.equal(f.hours[0].windDir, 270);
    assert.equal(f.now.pressure, 1015); assert.ok(f.days.length >= 8 && f.days.length <= 10, `days: ${f.days.length}`);
    const last = f.days.at(-1); assert.equal(last.hi, Math.round(14 * 9 / 5 + 32)); assert.equal(last.pop, 60); assert.ok(last.rainMm >= 2);
    assert.throws(() => F.forecastView({ properties: { timeseries: [] } }, 'UTC'));
  });
  t('weather drawer: the demo forecast agrees with the sample "now" and has a rainy spell', () => {
    const f = F.demoForecast();
    assert.equal(f.hours.length, 48); assert.equal(f.days.length, 10);
    assert.equal(f.hours[0].temp, f.now.temp, 'the chart starts where "now" is');
    assert.ok(f.days.some((d) => d.rainMm > 5) && f.days.every((d) => d.sunrise && d.sunset));
  });

  /* ---- the drawer's routing ---- */
  t('drawer routing: the address says which drawer is open on which page', () => {
    assert.deepEqual(R.drParse('#energy?tile=en-top'), { page: 'energy', name: 'tile', value: 'en-top' });
    assert.deepEqual(R.drParse('#controls?dev=ha%3Alight.kitchen'), { page: 'controls', name: 'dev', value: 'ha:light.kitchen' });
    assert.deepEqual(R.drParse('#settings/people'), { page: 'settings/people', name: null, value: null });
    assert.deepEqual(R.drParse(''), { page: '', name: null, value: null });
    assert.equal(R.drParse('#home?x=1&tile=w').name, 'tile', 'only names of the drawer\'s own shape count');
    assert.equal(R.drHash('home', 'tile', 'weather:ab12'), '#home?tile=weather%3Aab12');
    assert.equal(R.drHash('', null), '#home');
    assert.deepEqual(R.drParse(R.drHash('network', 'nwdev', 'Q2XX-1234 / ap')), { page: 'network', name: 'nwdev', value: 'Q2XX-1234 / ap' }, 'round trip');
  });
  t('drawer routing: opening, closing or switching a drawer is not a new page; another page is', () => {
    assert.equal(R.drChange('#home', '#home?tile=weather'), 'drawer');
    assert.equal(R.drChange('#home?tile=weather', '#home'), 'drawer', 'Back closes the drawer, the page stays');
    assert.equal(R.drChange('#home?tile=weather', '#home?tile=sports'), 'drawer');
    assert.equal(R.drChange('', '#home?tile=clock'), 'drawer', 'an empty address is Home');
    assert.equal(R.drChange('#home?tile=weather', '#energy'), 'page');
    assert.equal(R.drChange('#home', '#energy?tile=en-top'), 'page+drawer');
    assert.equal(R.drChange('#settings/people', '#settings/apps'), 'page');
  });
  t('drawer routing: a tap opens the drawer - not while arranging, not on a control, not when the tap opened its own sheet', () => {
    const base = { editing: false, onControl: false, opened: false, selecting: false };
    assert.equal(R.drTapOpens(base), true);
    for (const k of Object.keys(base)) assert.equal(R.drTapOpens({ ...base, [k]: true }), false, k);
  });
  t('drawer: every tile in the galleries opens a drawer - its own, or the tile at its biggest', () => {
    const cli = fs.readFileSync(path.join(HERE, '..', 'public', 'app.js'), 'utf8');
    for (const id of ['sports', 'weather', 'clock', 'worldclock', 'sun', 'calendar', 'news', 'stocks', 'photos', 'internet', 'alerts', 'today', 'energy', 'camera', 'doorbell', 'device', 'room', 'lights', 'entities', 'thermostat', 'media', 'batteries', 'secure', 'household', 'radar',
      'en-top', 'en-dev', 'en-rooms', 'en-now', 'net-devices', 'net-internet', 'net-speed', 'hh-bins', 'hh-plants', 'rem-today', 'al-now', 'cam-wall', 'sec-wall', 'ctl-room'])
      assert.match(cli, new RegExp(`tileDrawer\\([^)]*'${id}'`), `${id} has its own drawer`);
    for (const id of ['lists', 'chores', 'meals', 'routine']) assert.match(cli, new RegExp(`FAM_DRAWER = \\{[^}]*\\b${id}:`), `${id} opens the family drawer`);
    for (const id of ['net-apptests', 'sec-lan', 'cam-det']) assert.match(cli, new RegExp(`DR_PAGE_OF = \\{[^}]*'${id}'`), `${id} opens at its biggest with its page`);
    assert.match(cli, /function drGeneric\(w\)/, 'and every other tile gets the generic one');
    assert.match(cli, /drawerReady\(\)/, 'pages open a linked drawer once their tiles are drawn');
  });
}
