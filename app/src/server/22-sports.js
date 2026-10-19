/* ======================================================================
 * Sports - your teams' games and scores. Source: ESPN's public scoreboard
 * JSON (no key). It is unofficial, so everything goes through the three
 * functions below; swapping in another provider (TheSportsDB) means
 * rewriting only these. config.sports.teams: [{ league, id, name, abbr, color }].
 * Scores come from public sources for personal use. Team logos are trademarks of
 * their teams and leagues: they are only passed on when the household turns on
 * Settings › General › "Show team logos from the scores service"
 * (config.sports.showLogos); otherwise teams show as abbreviation + team color.
 * ====================================================================== */
const LEAGUES = {
  nfl: { name: 'NFL', path: 'football/nfl' }, ncaaf: { name: 'College football', path: 'football/college-football' },
  nba: { name: 'NBA', path: 'basketball/nba' }, wnba: { name: 'WNBA', path: 'basketball/wnba' }, ncaab: { name: 'College basketball (men)', path: 'basketball/mens-college-basketball' },
  mlb: { name: 'MLB', path: 'baseball/mlb' }, nhl: { name: 'NHL', path: 'hockey/nhl' },
  mls: { name: 'MLS', path: 'soccer/usa.1' }, nwsl: { name: 'NWSL', path: 'soccer/usa.nwsl' }, epl: { name: 'Premier League', path: 'soccer/eng.1' },
  laliga: { name: 'La Liga', path: 'soccer/esp.1' }, ucl: { name: 'Champions League', path: 'soccer/uefa.champions' },
};
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const SPORTS_DOWN = 'The scores service is not answering CasaTorch right now.';
const sportsLogos = () => config.sports?.showLogos === true;
const withLogo = (t) => { if (sportsLogos() || !t) return t; const { logo: _l, ...rest } = t; return rest; };
const sportsErr = (err) => Object.assign(new Error(err?.status === 403 || err?.status === 401 || err?.status === 429 ? SPORTS_DOWN : String(err?.message || err)), { status: err?.status });
/** All teams in a league, for the setup wizard's team picker. */
async function sportsTeams(league) {
  const L = LEAGUES[league]; if (!L) throw new Error('unknown league');
  const all = await cached(`teams:${league}`, 24 * 3600_000, async () => {
    const j = await getJSON(`${ESPN}/${L.path}/teams?limit=1000`).catch((err) => { throw sportsErr(err); });
    const teams = (j?.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => x.team).filter(Boolean)
      .map((t) => ({ league, id: String(t.id), name: t.displayName, abbr: t.abbreviation, logo: t.logos?.[0]?.href || null, color: t.color ? `#${t.color}` : null }));
    return { teams: teams.sort((a, b) => a.name.localeCompare(b.name)) };
  });
  return { ...all, teams: all.teams.map(withLogo) };
}
/** One game, the way the dashboard shows it. */
function gameView(ev, league) {
  const c = ev?.competitions?.[0]; if (!c) return null;
  const side = (ha) => { const x = (c.competitors || []).find((k) => k.homeAway === ha) || {}; return { id: String(x.team?.id || ''), name: x.team?.shortDisplayName || x.team?.displayName, abbr: x.team?.abbreviation, color: /^[0-9a-f]{6}$/i.test(x.team?.color || '') ? `#${x.team.color}` : null, logo: x.team?.logo || x.team?.logos?.[0]?.href || null, score: x.score?.displayValue ?? x.score ?? null, winner: x.winner === true }; };
  const st = ev.status?.type || c.status?.type || {};
  return { id: String(ev.id), league, leagueName: LEAGUES[league]?.name, start: ev.date, state: st.state || 'pre', detail: st.shortDetail || st.detail || '', home: side('home'), away: side('away'),
    broadcast: c.broadcasts?.[0]?.names?.[0] || c.broadcasts?.[0]?.media?.shortName || c.geoBroadcasts?.[0]?.media?.shortName || null,
    venue: c.venue?.fullName || null, period: c.status?.period ?? ev.status?.period ?? null };
}
/** Today's scoreboard for each league you follow + each team's next game. Live games refresh every minute. */
async function sportsNow(teams = config.sports?.teams || []) {
  if (!teams.length) return { games: [] };
  const games = new Map(); let asked = 0, failed = 0;
  for (const league of [...new Set(teams.map((t) => t.league))]) {
    const L = LEAGUES[league]; if (!L) continue;
    const mine = new Set(teams.filter((t) => t.league === league).map((t) => t.id));
    try {
      asked++;
      const board = await cached(`board:${league}`, 60_000, async () => ({ events: (await getJSON(`${ESPN}/${L.path}/scoreboard`))?.events || [] }));
      for (const ev of board.events) { const g = gameView(ev, league); if (g && (mine.has(g.home.id) || mine.has(g.away.id))) games.set(g.id, g); }
    } catch { failed++; /* the schedules below still answer */ }
    for (const id of mine) {
      try {
        asked++;
        const sch = await cached(`sched:${league}:${id}`, 3 * 3600_000, async () => ({ events: (await getJSON(`${ESPN}/${L.path}/teams/${id}/schedule`))?.events || [] }));
        const views = sch.events.map((e) => gameView(e, league)).filter(Boolean);
        const last = views.filter((g) => g.state === 'post').at(-1), next = views.find((g) => g.state !== 'post');
        for (const g of [last, next]) if (g && !games.has(g.id)) games.set(g.id, g);
      } catch { failed++; /* skip this team this time */ }
    }
  }
  const order = { in: 0, pre: 1, post: 2 };
  const view = (g) => (sportsLogos() ? g : { ...g, home: withLogo(g.home), away: withLogo(g.away) });
  return { ...(asked && failed === asked ? { error: SPORTS_DOWN } : {}), games: [...games.values()].map(view).sort((a, b) => (order[a.state] - order[b.state]) || (a.state === 'post' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start))), credit: 'Scores: ESPN · public source, personal use' };
}
app.get('/api/sports', async (_req, res) => { try { res.json(await sportsNow()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });


/* ---- More for the Scores drawer: a team's standings, its last results and next games, and a game's line score ----
   The same scores service (ESPN's public JSON, CasaTorch's own User-Agent, cached), read by the three parsers below
   so a different provider means rewriting only them. Each answer stands alone: no standings never blanks the games.
   Team logos stay off unless the household turned them on (withLogo) - abbreviation and color otherwise. */
const SPORT_OF = (league) => String(LEAGUES[league]?.path || '').split('/')[0];
/* The columns each sport is read by: [stat name, column label]. */
const STAND_COLS = {
  football: [['wins', 'W'], ['losses', 'L'], ['ties', 'T'], ['winPercent', 'PCT'], ['streak', 'STRK']],
  basketball: [['wins', 'W'], ['losses', 'L'], ['winPercent', 'PCT'], ['gamesBehind', 'GB'], ['streak', 'STRK']],
  baseball: [['wins', 'W'], ['losses', 'L'], ['winPercent', 'PCT'], ['gamesBehind', 'GB'], ['streak', 'STRK']],
  hockey: [['wins', 'W'], ['losses', 'L'], ['otLosses', 'OTL'], ['points', 'PTS'], ['streak', 'STRK']],
  soccer: [['gamesPlayed', 'GP'], ['wins', 'W'], ['ties', 'D'], ['losses', 'L'], ['pointDifferential', 'GD'], ['points', 'PTS']],
};
const statOf = (e, name) => (e?.stats || []).find((x) => x.name === name || x.type === name.toLowerCase());
const statNum = (e, name) => { const s = statOf(e, name); const v = Number(s?.value ?? s?.displayValue); return Number.isFinite(v) ? v : null; };
const pctText = (v) => (v == null ? '-' : v >= 1 ? '1.000' : `.${String(Math.round(v * 1000)).padStart(3, '0')}`);
/** ESPN standings -> the groups (division, conference or league table) in the part of the league your team plays in. */
function standingsView(j, league, teamId) {
  const sport = SPORT_OF(league), cols = STAND_COLS[sport] || STAND_COLS.basketball, id = String(teamId || '');
  const leaves = [];   // [{ group, top }]: groups with a table, and the top-level group (conference) they sit in
  const walk = (g, top, depth) => { if (!g || depth > 5) return; if (g.standings?.entries?.length) leaves.push({ g, top }); for (const c of g.children || []) walk(c, top || c, depth + 1); };
  if (j?.standings?.entries?.length) leaves.push({ g: j, top: j });
  for (const c of j?.children || []) walk(c, c, 1);
  if (!leaves.length) return null;
  const mineLeaf = leaves.find((x) => x.g.standings.entries.some((e) => String(e.team?.id) === id)) || leaves[0];
  const groups = leaves.filter((x) => x.top === mineLeaf.top).map(({ g }) => {
    let rows = g.standings.entries.map((e) => {
      const t = e.team || {};
      return { id: String(t.id || ''), name: t.shortDisplayName || t.displayName || t.name || t.abbreviation || '?', abbr: t.abbreviation || null,
        color: /^[0-9a-f]{6}$/i.test(t.color || '') ? `#${t.color}` : null, logo: t.logos?.[0]?.href || null, mine: String(t.id) === id,
        n: Object.fromEntries(cols.map(([k]) => [k, statNum(e, k)])), seed: statNum(e, 'playoffSeed'), rank: statNum(e, 'rank'),
        streak: statOf(e, 'streak')?.displayValue || null, clinch: statOf(e, 'clincher')?.displayValue || null };
    });
    const key = (r) => (sport === 'soccer' ? [r.rank ?? 99, -(r.n.points ?? 0)] : sport === 'hockey' ? [-(r.n.points ?? 0), -(r.n.wins ?? 0)] : [-(r.n.winPercent ?? 0), -(r.n.wins ?? 0)]);
    rows = rows.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || String(a.name).localeCompare(String(b.name)); });
    if ((sport === 'basketball' || sport === 'baseball') && rows.length && rows.every((r) => r.n.gamesBehind == null)) {   // games behind, worked out when the answer has none
      const L = rows[0]; for (const r of rows) r.n.gamesBehind = ((L.n.wins - r.n.wins) + (r.n.losses - L.n.losses)) / 2;
    }
    rows = rows.map((r, i) => ({ ...withLogo(r), pos: i + 1, cells: cols.map(([k]) => (k === 'streak' ? r.streak || '-' : k === 'winPercent' ? pctText(r.n[k]) : k === 'gamesBehind' ? (r.n[k] ? String(r.n[k]).replace(/\.0$/, '') : '-') : k === 'pointDifferential' && r.n[k] > 0 ? `+${r.n[k]}` : r.n[k] == null ? '-' : String(r.n[k]))) }))
      .map(({ n: _n, ...r }) => r);
    return { name: g.name || g.abbreviation || LEAGUES[league]?.name || '', abbr: g.abbreviation || null, mine: g === mineLeaf.g, rows };
  });
  return { league, leagueName: LEAGUES[league]?.name, sport, conference: mineLeaf.top?.name || null, columns: cols.map(([key, label]) => ({ key, label })), groups };
}
/** A game from one team's side: which side it is, the other team, and W / L / T once it's over. */
function teamSide(g, teamId) {
  const id = String(teamId), mine = g.home.id === id ? 'home' : g.away.id === id ? 'away' : null; if (!mine) return { ...g, mine: null };
  const me = g[mine], them = g[mine === 'home' ? 'away' : 'home'], a = Number(me.score), b = Number(them.score);
  return { ...g, mine, opp: { abbr: them.abbr, name: them.name, color: them.color }, result: g.state === 'post' && Number.isFinite(a) && Number.isFinite(b) ? (me.winner || a > b ? 'W' : them.winner || a < b ? 'L' : 'T') : null };
}
/** A team's schedule -> its last results (newest first) and next games, each with the result from its side. */
function teamScheduleView(j, league, teamId) {
  const id = String(teamId || ''), games = (j?.events || []).map((e) => gameView(e, league)).filter(Boolean).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const all = games.map((g) => teamSide(g, id));
  const t = j?.team || {};
  return { team: { id, name: t.displayName || t.name || null, short: t.shortDisplayName || t.name || null, abbr: t.abbreviation || null, color: /^[0-9a-f]{6}$/i.test(t.color || '') ? `#${t.color}` : null,
      record: t.recordSummary || null, standing: t.standingSummary || null },
    live: all.find((g) => g.state === 'in') || null, last: all.filter((g) => g.state === 'post').reverse().slice(0, 5), next: all.filter((g) => g.state === 'pre').slice(0, 5) };
}
/** A game's summary -> line score by period and a few team numbers side by side. */
function gameSummaryView(j, league) {
  const c = j?.header?.competitions?.[0]; if (!c) return null;
  const st = c.status?.type || {}, box = j.boxscore?.teams || [];
  const teams = ['away', 'home'].map((ha) => { const x = (c.competitors || []).find((k) => k.homeAway === ha) || {}; const t = x.team || {};
    return { side: ha, id: String(t.id || ''), name: t.shortDisplayName || t.displayName || t.name, abbr: t.abbreviation, color: /^[0-9a-f]{6}$/i.test(t.color || '') ? `#${t.color}` : null, score: x.score ?? null, winner: x.winner === true,
      lines: (x.linescores || []).map((l) => l.displayValue ?? l.value ?? '') }; });
  const statsOf = (tid) => box.find((b) => String(b.team?.id) === tid)?.statistics || [];
  const a = statsOf(teams[0].id), h = statsOf(teams[1].id), seen = new Set(), stats = [];
  for (const s of a) { if (stats.length >= 8 || seen.has(s.name)) continue; const o = h.find((x) => x.name === s.name); if (!o || s.displayValue == null) continue; seen.add(s.name); stats.push({ label: s.label || s.abbreviation || s.name, away: String(s.displayValue), home: String(o.displayValue) }); }
  return { id: String(j.header?.id || ''), league, state: st.state || 'pre', detail: st.shortDetail || st.detail || '', start: c.date || null, periods: Math.max(0, ...teams.map((t) => t.lines.length)),
    teams: teams.map(withLogo), stats, venue: j.gameInfo?.venue?.fullName || null, broadcast: c.broadcasts?.[0]?.media?.shortName || null };
}
async function sportsTeamMore(league, id) {
  const L = LEAGUES[league]; if (!L) throw new Error('unknown league');
  const out = { league, leagueName: L.name, credit: 'Scores: ESPN · public source, personal use', at: new Date().toISOString() };
  const [sch, st] = await Promise.allSettled([
    cached(`sched:${league}:${id}`, 3 * 3600_000, async () => (await getJSON(`${ESPN}/${L.path}/teams/${id}/schedule`).catch((err) => { throw sportsErr(err); }))),
    cached(`stand:${league}`, 3600_000, async () => (await getJSON(`https://site.api.espn.com/apis/v2/sports/${L.path}/standings?level=3`).catch((err) => { throw sportsErr(err); }))),
  ]);
  if (sch.status === 'fulfilled') {
    Object.assign(out, teamScheduleView(sch.value, league, id));
    // today's board is fresher for a game going on now (the schedule is kept 3 hours)
    try { const board = await cached(`board:${league}`, 60_000, async () => ({ events: (await getJSON(`${ESPN}/${L.path}/scoreboard`))?.events || [] }));
      const now = board.events.map((e) => gameView(e, league)).find((g) => g && (g.home.id === String(id) || g.away.id === String(id)) && g.state === 'in');
      if (now) out.live = teamSide(now, id);
    } catch { /* the schedule's view stands */ }
  } else out.scheduleError = SPORTS_DOWN;
  if (st.status === 'fulfilled') out.standings = standingsView(st.value, league, id); else out.standingsError = SPORTS_DOWN;
  if (out.live) out.live = { ...out.live, home: withLogo(out.live.home), away: withLogo(out.live.away) };
  for (const k of ['last', 'next']) if (out[k]) out[k] = out[k].map((g) => ({ ...g, home: withLogo(g.home), away: withLogo(g.away) }));
  if (sch.status !== 'fulfilled' && st.status !== 'fulfilled') out.error = SPORTS_DOWN;
  return out;
}
async function sportsGame(league, id) {
  const L = LEAGUES[league]; if (!L) throw new Error('unknown league');
  const first = await cached(`game:${league}:${id}`, 30_000, async () => (await getJSON(`${ESPN}/${L.path}/summary?event=${id}`).catch((err) => { throw sportsErr(err); })));
  const v = gameSummaryView(first, league);
  if (v?.state === 'post') CACHE.set(`game:${league}:${id}`, { at: Date.now() + 6 * 3600_000, ttl: 30_000, value: first });   // a final score doesn't change: kept longer
  return v ? { ...v, credit: 'Scores: ESPN · public source, personal use' } : { error: 'No details for this game.' };
}

/* ---- the demo: three teams with plausible standings, results and games (made up, around today) ---- */
const DEMO_SPORTS = {
  nfl: { me: '25', group: 'NFC West', conf: 'National Football Conference', teams: [['25', '49ers', 'SF', 'aa0000', 5, 1], ['26', 'Seahawks', 'SEA', '002244', 4, 2], ['14', 'Rams', 'LAR', '003594', 3, 3], ['22', 'Cardinals', 'ARI', '97233f', 1, 5]],
    others: [['NFC East', [['21', 'Eagles', 'PHI', '004c54', 5, 1], ['6', 'Cowboys', 'DAL', '002a5c', 3, 3], ['28', 'Commanders', 'WSH', '5a1414', 3, 3], ['19', 'Giants', 'NYG', '0b2265', 2, 4]]]] },
  nba: { me: '9', group: 'Pacific', conf: 'Western Conference', teams: [['9', 'Warriors', 'GS', '1d428a', 3, 1], ['13', 'Lakers', 'LAL', '552583', 3, 1], ['21', 'Suns', 'PHX', '1d1160', 2, 2], ['12', 'Clippers', 'LAC', 'c8102e', 1, 3], ['23', 'Kings', 'SAC', '5a2d81', 1, 3]], others: [] },
  mlb: { me: '26', group: 'NL West', conf: 'National League', teams: [['19', 'Dodgers', 'LAD', '005a9c', 93, 69], ['26', 'Giants', 'SF', 'fd5a1e', 88, 74], ['25', 'Padres', 'SD', '2f241d', 85, 77], ['29', 'Diamondbacks', 'ARI', 'aa182c', 80, 82], ['27', 'Rockies', 'COL', '33006f', 61, 101]], others: [] },
};
const demoTeam = (league) => { const L = DEMO_SPORTS[league]; const t = L?.teams.find((x) => x[0] === L.me); return t ? { league, id: t[0], name: t[1], abbr: t[2], color: `#${t[3]}` } : null; };
function demoStandings(league) {
  const L = DEMO_SPORTS[league]; if (!L) return null;
  const entry = ([id, name, abbr, color, w, l], i) => ({ team: { id, shortDisplayName: name, displayName: name, abbreviation: abbr, color },
    stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'ties', value: 0 }, { name: 'winPercent', value: w / Math.max(1, w + l) }, { name: 'streak', displayValue: i % 2 ? `L${1 + (i % 2)}` : `W${2 + i}` },
      { name: 'otLosses', value: 0 }, { name: 'points', value: w * 2 }] });
  return standingsView({ children: [{ name: L.conf, children: [{ name: L.group, standings: { entries: L.teams.map(entry) } }, ...L.others.map(([n, ts]) => ({ name: n, standings: { entries: ts.map(entry) } }))] }] }, league, L.me);
}
function demoTeamMore(league) {
  const L = DEMO_SPORTS[league], me = demoTeam(league); if (!L || !me) return { error: 'unknown team' };
  const fx = (demoFixture('home')?.sports?.games || []).filter((g) => g.league === league), day = 86400_000, now = Date.now();
  const opp = L.teams.filter((t) => t[0] !== L.me).concat(...L.others.map(([, ts]) => ts));
  const mk = (i, at, state, my, their, home) => { const o = opp[i % opp.length], meSide = { id: me.id, name: me.name, abbr: me.abbr, color: me.color, score: state === 'pre' ? null : String(my), winner: state === 'post' && my > their };
    const themSide = { id: o[0], name: o[1], abbr: o[2], color: `#${o[3]}`, score: state === 'pre' ? null : String(their), winner: state === 'post' && their > my };
    return { id: `demo-${league}-${i}-${state}`, league, leagueName: LEAGUES[league].name, start: new Date(at).toISOString(), state, detail: state === 'post' ? 'Final' : '', home: home ? meSide : themSide, away: home ? themSide : meSide,
      broadcast: state === 'pre' ? ['FOX', 'ESPN', 'NBC', 'TNT', 'CBS'][i % 5] : null }; };
  const scores = { nfl: [[24, 17], [31, 20], [13, 16], [27, 10], [20, 14]], nba: [[118, 109], [104, 111], [121, 115], [99, 96], [112, 120]], mlb: [[5, 3], [2, 4], [7, 1], [3, 2], [6, 5]] }[league];
  const gap = league === 'nfl' ? 7 * day : league === 'nba' ? 2 * day : day;
  const fromFx = fx.map((g) => ({ ...g, home: { ...g.home, id: g.home.abbr === me.abbr ? me.id : g.home.abbr, color: g.home.abbr === me.abbr ? me.color : null }, away: { ...g.away, id: g.away.abbr === me.abbr ? me.id : g.away.abbr, color: null } }));
  let last = scores.map(([a, b], i) => mk(i, now - (i + 1) * gap - 3 * 3600_000, 'post', a, b, i % 2 === 0));
  const at = { nfl: 20.42, nba: 3, mlb: 2.08 }[league] * 3600_000;   // the usual start time (UTC): Sunday afternoon, a weeknight
  const live0 = fx.find((g) => g.state === 'in');   // football: a week after the game on now, same kickoff
  let next = [1, 2, 3, 4].map((i) => mk(i + 2, live0 && league === 'nfl' ? Date.parse(live0.start) + i * gap : Math.floor((now + i * gap) / day) * day + at, 'pre', 0, 0, i % 2 === 1));
  const live = fromFx.find((g) => g.state === 'in') || null;
  const fxPost = fromFx.filter((g) => g.state === 'post'), fxPre = fromFx.filter((g) => g.state === 'pre');
  if (fxPost.length) last = [...fxPost, ...last].slice(0, 5);
  if (fxPre.length) next = [...fxPre, ...next].slice(0, 5);
  last.sort((x, y) => String(y.start).localeCompare(String(x.start))); next.sort((x, y) => String(x.start).localeCompare(String(y.start)));
  const side = (g) => teamSide(g, me.id);
  const st = demoStandings(league), row = st.groups.find((g) => g.mine)?.rows.find((r) => r.mine);
  return { team: { id: me.id, name: me.name, short: me.name, abbr: me.abbr, color: me.color, record: row ? `${row.cells[0]}-${row.cells[1]}` : null, standing: row ? `${['1st', '2nd', '3rd', '4th', '5th'][row.pos - 1]} in ${L.group}` : null },
    live: live ? side(live) : null, last: last.map(side), next: next.map(side), standings: st, league, leagueName: LEAGUES[league].name, credit: 'Sample scores in the demo', at: new Date().toISOString(), demo: true };
}
function demoGame(league, id) {
  const fx = (demoFixture('home')?.sports?.games || []).find((g) => g.id === id && g.league === league);
  const per = { nfl: 4, nba: 4, mlb: 9, nhl: 3 }[league] || 2;
  const split = (total, n, seed) => { const out = Array(n).fill(0); let left = Number(total) || 0; for (let i = 0; i < n && left > 0; i++) { const v = i === n - 1 ? left : Math.min(left, Math.round((left / (n - i)) * (0.6 + ((seed + i * 7) % 5) / 6))); out[i] = v; left -= v; } return out.map(String); };
  const g = fx || { state: 'post', detail: 'Final', home: { name: 'Home', abbr: 'HOM', score: '3' }, away: { name: 'Away', abbr: 'AWY', score: '2' } };
  const plays = (total, n, seed) => { const out = Array(n).fill(0); let left = Number(total) || 0; const ps = []; while (left >= 7) { ps.push(7); left -= 7; } while (left >= 3) { ps.push(3); left -= 3; } if (left) ps.push(left); ps.forEach((p, i) => { out[(i * (n === 4 ? 3 : 1) + seed) % n] += p; }); return out.map(String); };
  const done = g.state === 'post' ? per : g.state === 'in' ? Math.min(per, Number(/Q(\d)/.exec(g.detail || '')?.[1]) || Math.ceil(per / 2)) : 0;
  const teams = ['away', 'home'].map((ha, k) => ({ side: ha, id: g[ha].abbr, name: g[ha].name, abbr: g[ha].abbr, color: null, score: g[ha].score, winner: !!g[ha].winner, lines: done ? (league === 'nfl' || league === 'ncaaf' ? plays(g[ha].score, done, k) : split(g[ha].score, done, k * 3 + 1)) : [] }));
  const stats = league === 'nfl' ? [['Total yards', '287', '342'], ['Passing', '201', '228'], ['Rushing', '86', '114'], ['Turnovers', '2', '1'], ['Possession', '13:48', '16:12']] : league === 'nba' ? [['Field goals', '41-88', '44-86'], ['3-pointers', '12-35', '15-38'], ['Rebounds', '42', '47'], ['Assists', '24', '29']] : [['Hits', '7', '9'], ['Errors', '1', '0'], ['Left on base', '6', '5']];
  return { id, league, state: g.state, detail: g.detail || '', start: g.start || null, periods: done, teams, stats: done ? stats.map(([label, away, home]) => ({ label, away, home })) : [], venue: null, broadcast: g.broadcast || null, credit: 'Sample scores in the demo' };
}
/** The teams the household follows (Settings), for the Scores tile and drawer. */
const myTeams = () => (isDemo() ? ['nfl', 'nba', 'mlb'].map(demoTeam) : (config.sports?.teams || []).map((t) => withLogo({ league: t.league, id: String(t.id), name: t.name, abbr: t.abbr || null, color: t.color || null })));
app.get('/api/w/myteams', (_req, res) => res.json({ teams: myTeams() }));
app.get('/api/w/team', async (req, res) => {
  const league = String(req.query.league || ''), id = String(req.query.id || '');
  if (!LEAGUES[league] || !/^\d{1,8}$/.test(id)) return res.status(400).json({ error: 'Pick a league and a team.' });
  if (isDemo()) return res.json(DEMO_SPORTS[league] ? demoTeamMore(league) : { error: SPORTS_DOWN });
  try { res.json(await sportsTeamMore(league, id)); } catch (err) { res.status(502).json({ error: String(err.message) }); }
});
app.get('/api/w/game', async (req, res) => {
  const league = String(req.query.league || ''), id = String(req.query.id || '');
  if (!LEAGUES[league] || !/^[\w-]{1,40}$/.test(id)) return res.status(400).json({ error: 'Pick a game.' });
  if (isDemo()) return res.json(demoGame(league, id));
  if (!/^\d{1,14}$/.test(id)) return res.status(400).json({ error: 'Pick a game.' });
  try { res.json(await sportsGame(league, id)); } catch (err) { res.status(502).json({ error: String(err.message) }); }
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchSports = { gameView, withLogo, sportsErr, sportsTeams, sportsNow, SPORTS_DOWN, standingsView, teamScheduleView, teamSide, gameSummaryView, demoTeamMore, demoGame, myTeams };
