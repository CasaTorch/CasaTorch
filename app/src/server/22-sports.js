/* ======================================================================
 * Sports - your teams' games and scores. Source: ESPN's public scoreboard
 * JSON (no key). It is unofficial, so everything goes through the three
 * functions below; swapping in another provider (TheSportsDB) means
 * rewriting only these. config.sports.teams: [{ league, id, name, abbr, logo }].
 * ====================================================================== */
const LEAGUES = {
  nfl: { name: 'NFL', path: 'football/nfl' }, ncaaf: { name: 'College football', path: 'football/college-football' },
  nba: { name: 'NBA', path: 'basketball/nba' }, wnba: { name: 'WNBA', path: 'basketball/wnba' }, ncaab: { name: 'College basketball (men)', path: 'basketball/mens-college-basketball' },
  mlb: { name: 'MLB', path: 'baseball/mlb' }, nhl: { name: 'NHL', path: 'hockey/nhl' },
  mls: { name: 'MLS', path: 'soccer/usa.1' }, nwsl: { name: 'NWSL', path: 'soccer/usa.nwsl' }, epl: { name: 'Premier League', path: 'soccer/eng.1' },
  laliga: { name: 'La Liga', path: 'soccer/esp.1' }, ucl: { name: 'Champions League', path: 'soccer/uefa.champions' },
};
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
/** All teams in a league, for the setup wizard's team picker. */
async function sportsTeams(league) {
  const L = LEAGUES[league]; if (!L) throw new Error('unknown league');
  return cached(`teams:${league}`, 24 * 3600_000, async () => {
    const j = await getJSON(`${ESPN}/${L.path}/teams?limit=1000`);
    const teams = (j?.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => x.team).filter(Boolean)
      .map((t) => ({ league, id: String(t.id), name: t.displayName, abbr: t.abbreviation, logo: t.logos?.[0]?.href || null, color: t.color ? `#${t.color}` : null }));
    return { teams: teams.sort((a, b) => a.name.localeCompare(b.name)) };
  });
}
/** One game, the way the dashboard shows it. */
function gameView(ev, league) {
  const c = ev?.competitions?.[0]; if (!c) return null;
  const side = (ha) => { const x = (c.competitors || []).find((k) => k.homeAway === ha) || {}; return { id: String(x.team?.id || ''), name: x.team?.shortDisplayName || x.team?.displayName, abbr: x.team?.abbreviation, logo: x.team?.logo || x.team?.logos?.[0]?.href || null, score: x.score?.displayValue ?? x.score ?? null, winner: x.winner === true }; };
  const st = ev.status?.type || c.status?.type || {};
  return { id: String(ev.id), league, leagueName: LEAGUES[league]?.name, start: ev.date, state: st.state || 'pre', detail: st.shortDetail || st.detail || '', home: side('home'), away: side('away'),
    broadcast: c.broadcasts?.[0]?.names?.[0] || c.geoBroadcasts?.[0]?.media?.shortName || null };
}
/** Today's scoreboard for each league you follow + each team's next game. Live games refresh every minute. */
async function sportsNow() {
  const teams = config.sports?.teams || [];
  if (!teams.length) return { games: [] };
  const games = new Map();
  for (const league of [...new Set(teams.map((t) => t.league))]) {
    const L = LEAGUES[league]; if (!L) continue;
    const mine = new Set(teams.filter((t) => t.league === league).map((t) => t.id));
    try {
      const board = await cached(`board:${league}`, 60_000, async () => ({ events: (await getJSON(`${ESPN}/${L.path}/scoreboard`))?.events || [] }));
      for (const ev of board.events) { const g = gameView(ev, league); if (g && (mine.has(g.home.id) || mine.has(g.away.id))) games.set(g.id, g); }
    } catch { /* the schedules below still answer */ }
    for (const id of mine) {
      try {
        const sch = await cached(`sched:${league}:${id}`, 3 * 3600_000, async () => ({ events: (await getJSON(`${ESPN}/${L.path}/teams/${id}/schedule`))?.events || [] }));
        const views = sch.events.map((e) => gameView(e, league)).filter(Boolean);
        const last = views.filter((g) => g.state === 'post').at(-1), next = views.find((g) => g.state !== 'post');
        for (const g of [last, next]) if (g && !games.has(g.id)) games.set(g.id, g);
      } catch { /* skip this team this time */ }
    }
  }
  const order = { in: 0, pre: 1, post: 2 };
  return { games: [...games.values()].sort((a, b) => (order[a.state] - order[b.state]) || (a.state === 'post' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start))), credit: 'Scores: ESPN' };
}
app.get('/api/sports', async (_req, res) => { try { res.json(await sportsNow()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
