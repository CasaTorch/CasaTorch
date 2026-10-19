/* ======================================================================
 * Your teams, in full: the Scores tile grows with its size, and its drawer has everything.
 *   Tile  S  - the game that matters most right now (live, else the next, else the last)
 *         M  - + each team's last result and next game
 *         L  - + the last results (up to 5) and the next 3 games of one team (tap its name to switch)
 *         XL - + a mini standings table around the team
 *   Drawer   - record, standing and streak; a live game's line score; the last 5 with scores; the next games with
 *              time and TV; the standings of its division (or the whole conference / table) the way the sport counts.
 * From /api/w/team and /api/w/game (22-sports.js): the scores service the server already uses, cached there. Teams show
 * as their abbreviation on their color unless the household turned on logos.
 * ====================================================================== */
const spTeamsOf = async (t) => { const o = optsOf(t || {}); if (Array.isArray(o.teams) && o.teams.length) return o.teams; const r = await wget('/api/w/myteams', 10 * 60_000).catch(() => ({ teams: [] })); return r.teams || []; };
const spMore = (x) => wget(`/api/w/team?league=${encodeURIComponent(x.league)}&id=${encodeURIComponent(x.id)}`, 5 * 60_000);
const spBadge = (x) => (x?.logo ? el('img', { class: 'sp-logo', src: x.logo, alt: '', loading: 'lazy' }) : teamBadge(x || {}));
const spVs = (g) => (g.mine === 'away' ? T('at {team}', { team: g.opp?.abbr || g.opp?.name || '' }) : T('vs {team}', { team: g.opp?.abbr || g.opp?.name || '' }));
const spScore = (g) => { if (!g.mine) return `${g.away.score ?? ''}-${g.home.score ?? ''}`; const me = g[g.mine], them = g[g.mine === 'home' ? 'away' : 'home']; return `${me.score ?? ''}-${them.score ?? ''}`; };
const spRes = (r) => el('span', { class: `sp-res ${r === 'W' ? 'w' : r === 'L' ? 'l' : 't'}` }, T(r === 'W' ? 'W|win' : r === 'L' ? 'L|loss' : 'T|tie'));
/** One past game: W/L, the other team, the score, when. */
const spLastRow = (g, onTap) => el(onTap ? 'button' : 'div', { type: onTap ? 'button' : null, class: 'sp-row', onclick: onTap ? () => onTap(g) : null }, spRes(g.result), el('span', { class: 'grow ellipsis' }, spVs(g)), el('b', { class: 'num' }, spScore(g)), el('span', { class: 'tiny muted' }, fmt(g.start, { month: 'short', day: 'numeric' })));
/** One game to come: when, the other team, where to watch. */
const spNextRow = (g) => el('div', { class: 'sp-row' }, el('span', { class: 'sp-when' }, fmtWhen(g.start)), el('span', { class: 'grow ellipsis' }, spVs(g)), g.broadcast ? el('span', { class: 'pill' }, g.broadcast) : null);
/* What each column means (the header's tooltip). */
const SP_COL_NAMES = { W: 'Wins', L: 'Losses', T: 'Ties', PCT: 'Win percentage', GB: 'Games behind', STRK: 'Streak', OTL: 'Overtime losses', PTS: 'Points', GP: 'Games played', D: 'Draws', GD: 'Goal difference' };
/** The standings table: rank, team and the sport's own columns; your team highlighted. around: rows each side (mini). */
function spTable(st, group, around = null) {
  if (!st || !group?.rows?.length) return null;
  let rows = group.rows;
  if (around != null) { const i = Math.max(0, rows.findIndex((r) => r.mine)), from = Math.max(0, Math.min(rows.length - (around * 2 + 1), i - around)); rows = rows.slice(from, from + around * 2 + 1); }
  const cols = around != null ? st.columns.filter((c) => c.key !== 'streak' && c.key !== 'pointDifferential' && c.key !== 'gamesPlayed' && c.key !== 'ties').slice(0, 3) : st.columns;
  const idx = cols.map((c) => st.columns.findIndex((x) => x.key === c.key));
  return el('div', { class: 'dr-table-wrap' }, el('table', { class: `dr-table sp-table${around != null ? ' mini' : ''}` },
    el('thead', {}, el('tr', {}, el('th', {}, around != null ? '' : group.name), ...cols.map((c) => el('th', { title: SP_COL_NAMES[c.label] ? T(SP_COL_NAMES[c.label]) : null }, T(`${c.label}|standings`))))),
    el('tbody', {}, rows.map((r) => el('tr', { class: r.mine ? 'mine' : null }, el('td', { class: 'team' }, el('span', { class: 'tiny muted num', style: 'width:16px' }, String(r.pos)), spBadge(r), el('span', { class: 'ellipsis' }, r.name), r.clinch ? el('span', { class: 'tiny muted' }, r.clinch) : null), ...idx.map((k) => el('td', {}, r.cells[k])))))));
}

/* ---- the tile ---- */
async function sportsTile(b, ctx, size) {
  const o = optsOf(b._t || {}), tier = size.tier || sizeTier(size), mine = Array.isArray(o.teams) && o.teams.length;
  const sp = mine ? await wget(`/api/w/sports?t=${o.teams.map((x) => `${x.league}:${x.id}`).join(',')}`, 60_000).catch((err) => ({ error: err.message })) : ctx.data.home?.sports;
  if (!sp) return b.replaceChildren(empty(T('Pick your teams: tap Edit layout, then customize this widget.')));
  let games = sp.games || [];
  if (o.liveOnly) { const live = games.filter((g) => g.state === 'in'); games = live.length ? live : games.filter((g) => g.state === 'pre').slice(0, 1); }
  if (!games.length && (tier === 's' || tier === 'm')) return b.replaceChildren(empty(sp.error ? T('Scores are not loading right now.') : T('No games this week.')));
  if (tier === 's') return b.replaceChildren(gameRow(games[0], size.w));
  if (tier === 'm' || size.preview) return b.replaceChildren(...games.slice(0, fits(size.h, 84)).map((g) => gameRow(g, size.w)));
  // L and XL: one team in depth (tap a name to switch); the others' games stay one tap away in the drawer
  const teams = await spTeamsOf(b._t);
  if (!teams.length) return b.replaceChildren(...games.slice(0, fits(size.h, 84)).map((g) => gameRow(g, size.w)));
  b._sp = Math.min(b._sp || 0, teams.length - 1);
  const team = teams[b._sp];
  const d = await spMore(team).catch((err) => ({ error: err.message }));
  if (!b.isConnected && !size.preview && b._drawn) return;
  b._drawn = true;
  const pick = teams.length > 1 ? el('div', { class: 'sp-pick', role: 'group', 'aria-label': T('Team') }, teams.map((x, i) => el('button', { type: 'button', class: `chip${i === b._sp ? ' on' : ''}`, title: x.name, 'aria-pressed': String(i === b._sp), onclick: () => { b._sp = i; sportsTile(b, ctx, size); } }, x.abbr || x.name, teams.some((y, k) => k !== i && y.abbr === x.abbr) ? el('span', { class: 'tiny muted' }, String(x.league).toUpperCase()) : null))) : null;
  if (d.error && !d.last) return b.replaceChildren(...[pick, ...games.slice(0, fits(size.h - 1, 84)).map((g) => gameRow(g, size.w))].filter(Boolean));
  const h = size.h * ROW_PX + (size.h - 1) * GAP_PX - 40 - (pick ? 34 : 0);
  const head = el('div', { class: 'sp-head' }, spBadge(d.team || team), el('div', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block' }, d.team?.name || team.name), el('span', { class: 'tiny muted ellipsis' }, [d.team?.record, d.team?.standing].filter(Boolean).join(' · '))));
  const parts = [pick, head];
  let room = h - 50;
  if (d.live) { parts.push(gameRow(d.live, size.w)); room -= 84; }
  const xl = tier === 'xl' && d.standings && size.w >= 6;
  const cols = xl ? el('div', { class: 'sp-cols' }) : null;
  const lastN = Math.max(1, Math.min(5, Math.floor((xl ? room : room * 0.55) / 30) - 1)), nextN = Math.max(1, Math.min(3, Math.floor((xl ? room : room * 0.45) / 30) - 1));
  const games2 = el('div', {}, d.last?.length ? [el('div', { class: 'tiny muted sp-sub' }, T('Last results')), ...d.last.slice(0, lastN).map((g) => spLastRow(g))] : null,
    d.next?.length ? [el('div', { class: 'tiny muted sp-sub' }, T('Next games')), ...d.next.slice(0, nextN).map(spNextRow)] : null);
  if (xl) { const grp = d.standings.groups.find((g) => g.mine) || d.standings.groups[0]; cols.append(games2, el('div', {}, el('div', { class: 'tiny muted sp-sub' }, grp?.name || T('Standings')), spTable(d.standings, grp, 2))); parts.push(cols); }
  else parts.push(games2);
  b.replaceChildren(...parts.filter(Boolean));
}

/* ---- the drawer ---- */
tileDrawer('sports', {
  doc: 'setup.sports', every: 60_000,
  source: (d) => (d?.cur?.credit ? T(d.cur.credit) : ''), updated: (d) => d?.cur?.at,
  async load(a) {
    const teams = await spTeamsOf(a.t);
    a._i = Math.min(a._i || 0, Math.max(0, teams.length - 1));
    const cur = teams.length ? await spMore(teams[a._i]).catch((err) => ({ error: err.message })) : null;
    return { teams, cur };
  },
  render(b, { teams, cur }, a, dr) {
    if (!teams.length) return b.append(drEmpty(T('Pick your teams in Settings, or customize this tile.'), '#settings', T('Settings')));
    if (teams.length > 1) b.append(el('div', { class: 'sp-pick' }, teams.map((x, i) => el('button', { type: 'button', class: `chip${i === a._i ? ' on' : ''}`, onclick: () => { a._i = i; dr.refresh(); } }, teamBadge(x), ' ', x.name || x.abbr))));
    const d = cur || {};
    if (d.error && !d.last && !d.standings) return b.append(drEmpty(T('Scores are not loading right now.')));
    const me = d.team || teams[a._i];
    const grp = d.standings?.groups?.find((g) => g.mine), myRow = grp?.rows.find((r) => r.mine);
    const streak = myRow && d.standings.columns.findIndex((c) => c.key === 'streak') >= 0 ? myRow.cells[d.standings.columns.findIndex((c) => c.key === 'streak')] : null;
    const box = el('div', { class: 'sp-box' });   // a game's line score opens here
    const showGame = async (g) => {
      box.replaceChildren(drSkel(2));
      const s = await wget(`/api/w/game?league=${encodeURIComponent(g.league || d.league)}&id=${encodeURIComponent(g.id)}`, g.state === 'in' ? 25_000 : 3600_000).catch((err) => ({ error: err.message }));
      if (!box.isConnected) return;
      box.replaceChildren(spLineScore(s, g));
      box.scrollIntoView({ block: 'nearest', behavior: drReduce() ? 'auto' : 'smooth' });
    };
    b.append(
      el('div', { class: 'sp-hero' }, spBadge(me), el('div', { class: 'grow' }, el('div', { class: 'sp-name' }, me.name || me.abbr), el('div', { class: 'small muted' }, [d.leagueName, d.team?.standing].filter(Boolean).join(' · '))),
        el('div', { class: 'dr-kpis sp-kpis' }, drKpi(T('Record'), d.team?.record || (myRow ? `${myRow.cells[0]}-${myRow.cells[1]}` : '-')), streak && streak !== '-' ? drKpi(T('Streak'), streak) : null)),
      d.live ? drSection(el('span', { class: 'row', style: 'gap:6px' }, el('span', { class: 'pill live' }, T('LIVE')), T('Now playing')), gameRow(d.live, 6), el('div', { class: 'sp-live' })) : null,
      d.last?.length ? drSection(T('Last {n} results', { n: d.last.length }), el('div', { class: 'sp-list' }, d.last.map((g) => spLastRow(g, showGame))), box) : null,
      d.next?.length ? drSection(T('Coming up'), el('div', { class: 'sp-list' }, d.next.map(spNextRow))) : d.scheduleError ? drSection(T('Coming up'), el('p', { class: 'small muted' }, T('The schedule isn\'t loading right now.'))) : null,
      d.standings ? spStandings(d.standings) : drSection(T('Standings'), el('p', { class: 'small muted', style: 'margin:0' }, d.standingsError ? T('Standings aren\'t loading right now.') : T('No standings for this league right now.'))),
      el('p', { class: 'tiny muted', style: 'margin:0' }, d.credit ? T(d.credit) : ''));
    if (d.live) { const host = b.querySelector('.sp-live'); wget(`/api/w/game?league=${encodeURIComponent(d.live.league || d.league)}&id=${encodeURIComponent(d.live.id)}`, 25_000).then((s) => { if (host.isConnected) host.replaceChildren(spLineScore(s, d.live)); }).catch(() => {}); }
  },
});
/** Standings in the drawer: your division (or group), or every group of the conference. */
function spStandings(st) {
  const holder = el('div');
  const draw = (k) => holder.replaceChildren(...st.groups.filter((g) => k === 'all' || g.mine).map((g) => el('div', { style: 'margin-bottom:12px' }, spTable(st, g))));
  draw('mine');
  return drSection(el('span', { class: 'grow' }, T('Standings')), st.groups.length > 1 ? drSeg([['mine', st.groups.find((g) => g.mine)?.name || T('Division')], ['all', st.conference || T('Conference')]], 'mine', draw) : null, holder);
}
/** A game's line score: each period, the total, and a few team numbers side by side. */
function spLineScore(s, g) {
  if (!s || s.error || !s.teams) return el('p', { class: 'small muted' }, T('No details for this game.'));
  const n = s.periods || 0, per = (i) => (s.league === 'mlb' ? String(i + 1) : s.league === 'nhl' ? (i < 3 ? String(i + 1) : 'OT') : ['nfl', 'ncaaf', 'nba', 'wnba'].includes(s.league) ? (i < 4 ? `Q${i + 1}` : 'OT') : String(i + 1));
  return el('div', { class: 'sp-ls' }, el('div', { class: 'row between tiny muted', style: 'margin-bottom:6px' }, el('span', {}, [s.state === 'in' ? T('LIVE') : s.state === 'post' ? T('Final') : fmtWhen(s.start), s.detail && s.state !== 'post' ? s.detail : null].filter(Boolean).join(' · ')), el('span', {}, [s.venue, s.broadcast].filter(Boolean).join(' · '))),
    n ? el('div', { class: 'dr-table-wrap' }, el('table', { class: 'dr-table' }, el('thead', {}, el('tr', {}, el('th', {}, ''), ...Array.from({ length: n }, (_, i) => el('th', {}, per(i))), el('th', {}, T('Total')))),
      el('tbody', {}, s.teams.map((t) => el('tr', { class: g?.mine && t.side === g.mine ? 'mine' : null }, el('td', { class: 'team' }, teamBadge(t), el('span', {}, t.abbr || t.name)), ...Array.from({ length: n }, (_, i) => el('td', {}, t.lines[i] ?? '')), el('td', {}, el('b', {}, t.score ?? ''))))))) : null,
    s.stats?.length ? el('div', { class: 'dr-table-wrap', style: 'margin-top:10px' }, el('table', { class: 'dr-table sp-stats' }, el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, s.teams[0].abbr || ''), el('th', {}, s.teams[1].abbr || ''))),
      el('tbody', {}, s.stats.map((x) => el('tr', {}, el('td', {}, T(x.label)), el('td', {}, x.away), el('td', {}, x.home)))))) : null);
}
