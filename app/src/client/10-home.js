/* ---- Home: weather, what's next, your teams, headlines, the internet, reminders ---- */
function wxIcon(sym) {
  const s = String(sym || '');
  if (/thunder/.test(s)) return '⛈'; if (/snow|sleet/.test(s)) return '❄'; if (/rain|shower/.test(s)) return '\u{1F327}';
  if (/fog/.test(s)) return '\u{1F32B}'; if (/partlycloudy|fair/.test(s)) return /night/.test(s) ? '☁' : '⛅'; if (/cloudy/.test(s)) return '☁';
  if (/clearsky/.test(s)) return /night/.test(s) ? '\u{1F319}' : '☀'; return '·';
}
const hm = (t) => { const [h, m] = String(t).split(':').map(Number); return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : t; };
const dayName = (ymd) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${ymd}T12:00:00Z`));
function alertStrip(now) {
  if (!now?.length) return null;
  return el('div', { class: 'strip' }, now.slice(0, 3).map((a) => el('a', { href: '#alerts', class: `alert ${a.severity}`, style: 'text-decoration:none;color:inherit' },
    el('div', { class: 'grow' }, el('b', {}, a.title), el('div', { class: 'small muted' }, `${a.source || ''}${a.since ? ` · since ${fmtWhen(a.since)}` : ''}`)))),
  now.length > 3 ? el('a', { href: '#alerts', class: 'small' }, `+${now.length - 3} more`) : null);
}
function weatherCard(w) {
  const c = el('div', { class: 'card span2' }, el('h2', {}, `Weather${w?.place ? ` · ${w.place}` : ''}`));
  if (!w || w.error) { c.append(el('p', { class: 'muted' }, w?.error ? 'Weather is not loading right now - it will try again shortly.' : 'Add your town in Settings to see the weather.')); return c; }
  c.append(el('div', { class: 'row wrap', style: 'gap:18px' },
    el('div', { class: 'row' }, el('span', { class: 'wx', style: 'font-size:46px' }, wxIcon(w.now?.symbol)), el('div', {}, el('div', { class: 'big' }, `${w.now?.temp}°`), el('div', { class: 'muted' }, w.now?.words || ''))),
    el('div', { class: 'small muted' }, `Wind ${w.now?.wind ?? '-'} ${w.units === 'C' ? 'km/h' : 'mph'}`, el('br'), `Humidity ${w.now?.humidity ?? '-'}%`),
    el('div', { class: 'hours', style: 'flex:1' }, (w.hours || []).map((h) => el('div', {}, el('span', { class: 'muted' }, fmt(h.at, { hour: 'numeric' })), el('span', { class: 'wx', style: 'display:block;font-size:18px;margin:2px 0' }, wxIcon(h.symbol)), el('b', {}, `${h.temp}°`))))));
  c.append(el('ul', { class: 'list days', style: 'margin-top:10px' }, (w.days || []).map((d) => el('li', {}, el('b', {}, dayName(d.date)), el('span', { class: 'wx' }, wxIcon(d.symbol)), el('span', { class: 'muted small ellipsis' }, `${d.words || ''}${d.rainMm ? ` · ${d.rainMm} mm` : ''}`), el('span', {}, `${d.hi}° / `, el('span', { class: 'muted' }, `${d.lo}°`))))));
  c.append(el('div', { class: 'small muted', style: 'margin-top:6px' }, w.credit || ''));
  return c;
}
function agendaCard(cal) {
  const c = el('div', { class: 'card' }, el('h2', {}, 'Coming up'));
  if (!cal) { c.append(el('p', { class: 'muted' }, 'Add a calendar link (Google, iCloud, Outlook) in setup to see what\'s next.')); return c; }
  const ev = (cal.events || []).filter((e) => Date.parse(e.end || e.start) > Date.now()).slice(0, 8);
  if (!ev.length) c.append(el('p', { class: 'muted' }, 'Nothing on the calendar this week.'));
  c.append(el('ul', { class: 'list' }, ev.map((e) => el('li', {}, el('span', { class: 'dot', style: `background:${e.color || 'var(--accent)'}` }),
    el('div', { class: 'grow' }, el('div', { class: 'ellipsis' }, e.title), el('div', { class: 'small muted' }, e.allDay ? `${fmt(e.start, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · all day` : fmtWhen(e.start), e.calendar ? ` · ${e.calendar}` : ''))))));
  for (const er of cal.errors || []) c.append(el('div', { class: 'small muted' }, `${er.calendar || 'A calendar'} did not load.`));
  return c;
}
function gameRow(g) {
  const side = (t, other) => el('div', { class: 'row', style: 'gap:6px' }, t.logo ? el('img', { src: t.logo, alt: '', width: 20, height: 20, loading: 'lazy' }) : null, el('span', { class: g.state === 'post' && !t.winner && other.winner ? 'muted' : '' }, t.name || t.abbr));
  const score = (t, o) => el('div', { class: `score${g.state === 'post' && !t.winner && o.winner ? ' lost' : ''}` }, g.state === 'pre' ? '' : t.score ?? '');
  return el('div', { class: 'game' }, side(g.away, g.home), score(g.away, g.home), side(g.home, g.away), score(g.home, g.away),
    el('div', { class: 'small muted', style: 'grid-column:1/-1' }, el('span', { class: `pill ${g.state === 'in' ? 'live' : g.state === 'post' ? 'final' : ''}` }, g.state === 'in' ? 'LIVE' : g.state === 'post' ? 'Final' : fmtWhen(g.start)), ` ${g.leagueName || ''}${g.state === 'in' ? ` · ${g.detail}` : ''}${g.broadcast ? ` · ${g.broadcast}` : ''}`));
}
function sportsCard(sp) {
  const c = el('div', { class: 'card' }, el('h2', {}, 'Your teams'));
  if (!sp) { c.append(el('p', { class: 'muted' }, 'Pick your teams in setup to see scores and next games here.')); return c; }
  if (sp.error) { c.append(el('p', { class: 'muted' }, 'Scores are not loading right now.')); return c; }
  (sp.games || []).slice(0, 6).forEach((g) => c.append(gameRow(g)));
  if (!(sp.games || []).length) c.append(el('p', { class: 'muted' }, 'No games this week.'));
  c.append(el('div', { class: 'small muted', style: 'margin-top:6px' }, sp.credit || ''));
  return c;
}
function newsCard(n) {
  const c = el('div', { class: 'card' }, el('h2', {}, 'Headlines'));
  if (!n) { c.append(el('p', { class: 'muted' }, 'Pick news sources in setup.')); return c; }
  if (!(n.items || []).length) c.append(el('p', { class: 'muted' }, n.error || (n.errors || []).length ? 'Headlines are not loading right now.' : 'No headlines yet.'));
  c.append(el('ul', { class: 'list' }, (n.items || []).slice(0, 8).map((i) => el('li', {}, el('div', { class: 'grow' }, el('a', { href: i.link, target: '_blank', rel: 'noopener noreferrer', style: 'color:inherit;text-decoration:none' }, i.title), el('div', { class: 'small muted' }, `${i.source}${i.at ? ` · ${ago(i.at)}` : ''}`))))));
  return c;
}
function internetCard(n) {
  const c = el('div', { class: 'card' }, el('h2', {}, 'Internet'));
  if (!n || n.error) { c.append(el('p', { class: 'muted' }, 'Checking...')); return c; }
  c.append(el('div', { class: 'row' }, el('span', { class: `dot ${n.online ? 'good' : 'bad'}` }), el('b', {}, n.online ? 'Online' : 'Down'), el('span', { class: 'muted small' }, n.provider || '')));
  if (n.speed) c.append(el('div', { class: 'row', style: 'margin-top:8px;gap:20px' }, el('div', {}, el('div', { class: 'big', style: 'font-size:28px' }, Math.round(n.speed.downMbps)), el('div', { class: 'small muted' }, 'Mbps down')), el('div', {}, el('div', { class: 'big', style: 'font-size:28px' }, Math.round(n.speed.upMbps)), el('div', { class: 'small muted' }, 'Mbps up'))));
  c.append(el('div', { class: 'small muted', style: 'margin-top:6px' }, `Ping ${n.latencyMs?.cloudflare ?? '-'} ms · ${n.lanDevices ?? '?'} devices on the network`));
  return c;
}
function todayCard(h) {
  const c = el('div', { class: 'card' }, el('h2', {}, 'Today'));
  if (h.note) c.append(el('p', { style: 'margin:0 0 8px' }, h.note));
  if (h.reminders?.length) c.append(el('ul', { class: 'list' }, h.reminders.map((r) => el('li', {}, el('span', { class: 'dot warn' }), el('div', { class: 'grow' }, r.title), r.at ? el('span', { class: 'muted small' }, hm(r.at)) : null))));
  if (!h.note && !h.reminders?.length) c.append(el('p', { class: 'muted' }, 'No reminders today.'));
  return c;
}
tab({ id: 'home', label: 'Home', async render(main) {
  const draw = async () => {
    const [h, a] = await Promise.all([api('/api/home'), api('/api/alerts').catch(() => null)]);
    const g = el('div', { class: 'grid' }, weatherCard(h.weather), agendaCard(h.calendar), sportsCard(h.sports), internetCard(h.internet), todayCard(h), newsCard(h.news));
    main.replaceChildren(...[alertStrip(a?.now), g].filter(Boolean));
  };
  await draw(); return draw;
} });
