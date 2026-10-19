/* ======================================================================
 * What each Home tile shows when you tap it (the drawer is 06d-drawer.js): the weather's 48 hours and 10 days,
 * the clocks' time zones and the sun, the week's agenda, more headlines, a stock's chart, the photos, your
 * teams' standings and games, the cameras live with what they saw, and every device with its controls and
 * its last 24 hours. Everything loads when the drawer opens and is kept a few minutes (wget).
 * ====================================================================== */
const drDay = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
const drKpi = (k, v, s) => el('div', { class: 'dr-kpi' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v ?? '-'), s ? el('div', { class: 's' }, s) : null);
const drOpenPage = (href, label) => el('a', { class: 'btn small dr-open-page', href, onclick: () => closeDrawer() }, icon('chevr', 14), label);
const drEmpty = (text, href, label) => el('div', { class: 'dr-fail' }, icon('info', 22), el('div', { class: 'small muted' }, text), href ? el('a', { class: 'btn small', href, onclick: () => closeDrawer() }, label) : null);
const drCompass = (deg) => (deg == null ? '' : T(`${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8]}|compass`));
const drRain = (mm, units) => (mm == null ? '-' : units === 'C' ? `${Math.round(mm * 10) / 10} mm` : `${(mm / 25.4).toFixed(mm > 0 && mm < 2.54 ? 2 : 1)} in`);

/** A chart over time: lines (temperature, speed...) on top, bars (rain, counts...) along the bottom, the reading at the
    pointer, labels under it. xs: ms; lines: [{ v, cls, fmt, label }]; bars: { v, cls, fmt, label }; mark: ms of "now". */
function drChart({ xs, lines = [], bars = null, height = 170, xLabel = (ms) => fmt(new Date(ms).toISOString(), { hour: 'numeric' }), mark = null, label = '' }) {
  const box = el('div', { class: 'dr-chart-box', style: `min-height:${height}px` }), tip = chartTip(), n = xs.length;
  const paint = () => {
    const W = Math.max(260, box.clientWidth || 480), H = height, padL = 36, padR = 6, padT = 10, padB = 20, plotH = H - padT - padB;
    const all = lines.flatMap((l) => l.v).filter(Number.isFinite);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'dr-chart', role: 'img', 'aria-label': label });
    const X = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
    if (bars) {
      const bmax = Math.max(0.0001, ...bars.v.filter(Number.isFinite)), bh = plotH * (lines.length ? 0.38 : 1), bw = Math.max(2, Math.min(16, (W - padL - padR) / n * 0.6));
      bars.v.forEach((v, i) => { if (!(v > 0)) return; const h = (v / bmax) * bh; svg.append(svgEl('rect', { x: X(i) - bw / 2, y: padT + plotH - h, width: bw, height: Math.max(1, h), rx: 1.5, class: bars.cls || 'bar' })); });
    }
    if (all.length > 1) {
      const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.12 || 1, y0 = lo - pad, y1 = hi + pad;
      const Y = (v) => padT + plotH * (1 - (v - y0) / (y1 - y0));
      for (const v of [lo, hi]) svg.append(svgEl('line', { x1: padL, x2: W - padR, y1: Y(v), y2: Y(v), class: 'gl' }), svgEl('text', { x: padL - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'ax' }, lines[0].fmt ? lines[0].fmt(v) : String(Math.round(v))));
      lines.forEach((l, k) => {
        const pts = l.v.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v)); if (pts.length < 2) return;
        const d = pts.map(([i, v], j) => `${j ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
        if (k === 0) svg.append(svgEl('path', { d: `${d}L${X(pts.at(-1)[0]).toFixed(1)},${padT + plotH}L${X(pts[0][0]).toFixed(1)},${padT + plotH}Z`, class: 'ar' }));
        svg.append(svgEl('path', { d, class: `ln ${l.cls || ''}` }));
      });
    }
    if (mark != null && n > 1 && mark >= xs[0] && mark <= xs[n - 1]) { const i = (mark - xs[0]) / (xs[n - 1] - xs[0]) * (n - 1); svg.append(svgEl('line', { x1: X(i), x2: X(i), y1: padT, y2: padT + plotH, class: 'now' })); }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - padL) / 54))));
    for (let i = 0; i < n; i += every) svg.append(svgEl('text', { x: X(i), y: H - 5, 'text-anchor': i === 0 ? 'start' : 'middle', class: 'ax' }, xLabel(xs[i])));
    const hit = svgEl('rect', { x: padL, y: 0, width: W - padL, height: H, class: 'hit' });
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) * (W / r.width) - padL) / (W - padL - padR) * (n - 1))));
      tip.show(e, [el('b', {}, fmt(new Date(xs[i]).toISOString(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })), ...lines.map((l) => (Number.isFinite(l.v[i]) ? el('div', {}, `${l.label ? `${l.label}: ` : ''}${l.fmt ? l.fmt(l.v[i]) : l.v[i]}`) : null)), bars && Number.isFinite(bars.v[i]) ? el('div', {}, `${bars.label ? `${bars.label}: ` : ''}${bars.fmt ? bars.fmt(bars.v[i]) : bars.v[i]}`) : null].filter(Boolean));
    });
    hit.addEventListener('pointerleave', () => tip.hide());
    svg.append(hit);
    box.replaceChildren(svg);
  };
  let lw = 0;
  const ro = new ResizeObserver(() => { if (!box.isConnected) { if (lw) ro.disconnect(); return; } if (Math.abs(box.clientWidth - lw) > 3) { lw = box.clientWidth; paint(); } });
  ro.observe(box);
  return box;
}

/* ---- Weather: now in detail, 48 hours, 10 days, rain, wind, UV, sunrise and sunset, the radar ---- */
const wxQuery = (o) => (o.place?.lat != null ? `?lat=${o.place.lat}&lon=${o.place.lon}&name=${encodeURIComponent(o.place.name || '')}` : '');
tileDrawer('weather', {
  doc: 'page.home',
  source: (f) => (f?.credit ? T(f.credit) : ''), updated: (f) => f?.updated,
  sub: (f) => f?.place || '',
  load: (a) => Promise.all([wget(`/api/w/forecast${wxQuery(optsOf(a.t))}`, 15 * 60_000), optsOf(a.t).place ? null : wget('/api/w/sun', 20 * 60_000).catch(() => null)]).then(([f, sun]) => ({ ...f, sun })),
  actions: () => [typeof radarFull === 'function' ? el('button', { class: 'btn small', onclick: () => radarFull({}) }, icon('drop', 14), el('span', { class: 'hide-phone' }, T('Rain radar'))) : null],
  render(b, f) {
    if (!f || f.error || !f.now) return b.append(drEmpty(f?.error ? T(f.error) : T('Weather is not loading right now.')));
    const u = f.units, wu = f.windUnit === 'km/h' ? 'km/h' : T('mph'), today = f.days?.[0];
    const hours = f.hours || [], xs = hours.map((h) => Date.parse(h.at));
    b.append(
      el('div', { class: 'row', style: 'gap:14px;align-items:center' }, el('span', { style: 'font-size:46px;line-height:1' }, wxIcon(f.now.symbol)),
        el('div', { class: 'grow' }, el('div', { class: 'dr-big' }, `${f.now.temp}°`), el('div', { class: 'muted' }, [wxWord(f.now.words), today ? T('H {hi}° L {lo}°', { hi: today.hi, lo: today.lo }) : null].filter(Boolean).join(' · ')))),
      el('div', { class: 'dr-kpis' },
        drKpi(T('Wind'), f.now.wind != null ? `${f.now.wind} ${wu}` : '-', [drCompass(f.now.windDir), f.now.gust != null ? T('gusts {n}', { n: f.now.gust }) : null].filter(Boolean).join(' · ')),
        drKpi(T('Humidity'), f.now.humidity != null ? `${f.now.humidity}%` : '-', f.now.dewPoint != null ? T('dew point {t}°', { t: f.now.dewPoint }) : null),
        drKpi(T('UV index'), f.now.uv != null ? String(f.now.uv) : '-', f.now.uv != null ? T(f.now.uv >= 8 ? 'Very high' : f.now.uv >= 6 ? 'High' : f.now.uv >= 3 ? 'Moderate' : 'Low') : null),
        drKpi(T('Rain next hour'), drRain(hours[0]?.rainMm, u), hours[0]?.pop != null ? T('{n}% chance', { n: hours[0].pop }) : null),
        f.now.pressure != null ? drKpi(T('Pressure'), `${f.now.pressure} hPa`, null) : null,
        f.now.cloud != null ? drKpi(T('Clouds'), `${f.now.cloud}%`, null) : null),
      hours.length > 2 ? drSection(T('Next 48 hours'), drChart({ xs, lines: [{ v: hours.map((h) => h.temp), fmt: (v) => `${Math.round(v)}°`, label: T('Temperature') }], bars: { v: hours.map((h) => h.rainMm || 0), cls: 'bar2', fmt: (v) => drRain(v, u), label: T('Rain') }, label: T('Temperature and rain, the next 48 hours'), mark: Date.now() }),
        el('div', { class: 'dr-hours' }, hours.slice(0, 48).map((h) => el('div', { class: 'dr-hour' }, el('span', { class: 'tiny muted' }, fmt(h.at, { hour: 'numeric' })), el('i', {}, wxIcon(h.symbol)), el('b', {}, `${h.temp}°`), el('span', { class: 'tiny dr-pop' }, h.pop != null && h.pop >= 10 ? `${h.pop}%` : h.rainMm ? drRain(h.rainMm, u) : ''))))) : null,
      hours.some((h) => h.wind != null) ? drSection(T('Wind'), drChart({ xs, height: 120, lines: [{ v: hours.map((h) => h.wind), fmt: (v) => `${Math.round(v)} ${wu}`, label: T('Wind') }, { v: hours.map((h) => h.gust), cls: 'ln-dash', fmt: (v) => `${Math.round(v)} ${wu}`, label: T('Gusts') }], label: T('Wind and gusts, the next 48 hours') })) : null,
      hours.some((h) => h.uv > 0) ? drSection(T('UV index'), drChart({ xs, height: 100, lines: [{ v: hours.map((h) => h.uv), cls: 'ln-uv', fmt: (v) => (Math.round(v * 10) / 10).toString(), label: T('UV index') }], label: T('UV index, the next 48 hours') })) : null,
      f.days?.length ? drSection(T('{n} days', { n: f.days.length }), drDays(f.days, u)) : null,
      f.sun && !f.sun.error ? drSection(T('Sun'), drFacts([[T('Sunrise'), f.sun.sunrise ? fmtTime(f.sun.sunrise) : null], [T('Sunset'), f.sun.sunset ? fmtTime(f.sun.sunset) : null], [T('Daylight'), f.sun.dayMs != null ? T('{h} h {m} min', { h: Math.floor(f.sun.dayMs / 3600_000), m: Math.round((f.sun.dayMs % 3600_000) / 60_000) }) : null], [T('Moon'), f.sun.moon ? `${f.sun.moon.name} · ${f.sun.moon.illumination}%` : null]])) : null);
  },
});
function drDays(days, u) {
  const lo = Math.min(...days.map((d) => d.lo)), hi = Math.max(...days.map((d) => d.hi));
  return el('div', { class: 'dr-list' }, days.map((d, i) => el('div', { class: 'dr-row dr-day' },
    el('b', { class: 'dr-day-n' }, i === 0 ? T('Today') : dayName(d.date)), el('span', { class: 'dr-day-i', title: wxWord(d.words) }, wxIcon(d.symbol)),
    el('div', { class: 'grow' }, el('div', { class: 'dr-tbar' }, el('i', { style: `margin-left:${((d.lo - lo) / Math.max(1, hi - lo)) * 100}%;width:${Math.max(4, ((d.hi - d.lo) / Math.max(1, hi - lo)) * 100)}%` })),
      el('div', { class: 'tiny muted ellipsis' }, [wxWord(d.words), d.rainMm ? `${drRain(d.rainMm, u)}${d.pop != null ? ` (${d.pop}%)` : ''}` : null, d.wind != null ? `${T('wind')} ${d.wind}` : null, d.uv ? `UV ${d.uv}` : null, d.sunrise && d.sunset ? `☀ ${fmtTime(d.sunrise)}–${fmtTime(d.sunset)}` : null].filter(Boolean).join(' · '))),
    el('span', { class: 'num' }, `${d.hi}° `, el('span', { class: 'muted' }, `${d.lo}°`)))));
}

/* ---- Clocks and the sun ---- */
function drZones(zones) {
  const now = new Date(), here = S.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const p = (z) => new Date(now.toLocaleString('en-US', { timeZone: z }));
  return el('div', { class: 'dr-list' }, zones.map((z) => {
    let ok = true; try { new Intl.DateTimeFormat('en-US', { timeZone: z.tz }); } catch { ok = false; }
    if (!ok) return null;
    const hr = Number(new Intl.DateTimeFormat('en-US', { timeZone: z.tz, hour: 'numeric', hourCycle: 'h23' }).format(now)), diff = Math.round((p(z.tz) - p(here)) / 3600_000 * 2) / 2;
    return el('div', { class: 'dr-row' }, el('span', { style: 'font-size:20px' }, hr >= 6 && hr < 19 ? '☀️' : '\u{1F319}'),
      el('div', { class: 'grow' }, el('b', { class: 'ellipsis', style: 'display:block' }, z.label || zoneCity(z.tz)), el('span', { class: 'tiny muted' }, `${dtf(dateLoc(), { timeZone: z.tz, weekday: 'long', month: 'short', day: 'numeric' }).format(now)} · ${diff === 0 ? T('Same time') : `${diff > 0 ? '+' : ''}${diff} h`} · ${z.tz}`)),
      el('b', { class: 'num', style: 'font-size:20px' }, dtf(dateLoc(), { timeZone: z.tz, hour: 'numeric', minute: '2-digit' }).format(now)));
  }).filter(Boolean));
}
function drSunFacts(s) {
  if (!s || s.error) return null;
  const t = (iso) => (iso ? fmtTime(iso) : '-');
  return drFacts([[T('First light'), t(s.dawn)], [T('Sunrise'), t(s.sunrise)], [T('Midday'), t(s.noon)], [T('Golden hour'), t(s.goldenHour)], [T('Sunset'), t(s.sunset)], [T('Last light'), t(s.dusk)],
    [T('Daylight'), s.dayMs != null ? `${T('{h} h {m} min', { h: Math.floor(s.dayMs / 3600_000), m: Math.round((s.dayMs % 3600_000) / 60_000) })}${s.changeMs != null ? ` (${s.changeMs >= 0 ? '+' : '−'}${Math.abs(Math.round(s.changeMs / 6000) / 10)} min)` : ''}` : null],
    [T('Sunrise tomorrow'), s.tomorrowSunrise ? t(s.tomorrowSunrise) : null], [T('Moon'), s.moon ? `${s.moon.name} · ${s.moon.illumination}%` : null], [T('Next full moon'), s.moon?.nextFull ? drDay(s.moon.nextFull) : null], [T('Next new moon'), s.moon?.nextNew ? drDay(s.moon.nextNew) : null]]);
}
const drSunDays = (f) => (f?.days?.some((d) => d.sunrise) ? el('div', { class: 'dr-list' }, f.days.filter((d) => d.sunrise).map((d, i) => el('div', { class: 'dr-row' }, el('b', { style: 'width:64px' }, i === 0 ? T('Today') : dayName(d.date)), el('span', { class: 'grow small muted' }, `☀ ${fmtTime(d.sunrise)}`), el('span', { class: 'small muted' }, `☾ ${fmtTime(d.sunset)}`), el('span', { class: 'tiny muted num', style: 'width:76px;text-align:right' }, T('{h} h {m} min', { h: Math.floor((Date.parse(d.sunset) - Date.parse(d.sunrise)) / 3600_000), m: Math.round(((Date.parse(d.sunset) - Date.parse(d.sunrise)) % 3600_000) / 60_000) }))))) : null);
tileDrawer(['clock', 'worldclock'], {
  every: 15_000,
  load: (a) => wget('/api/w/sun', 20 * 60_000).catch(() => null),
  render(b, sun, a) {
    const o = optsOf(a.t), zones = a.w.id === 'worldclock' ? (o.zones?.length ? o.zones : [{ tz: 'America/New_York', label: T('New York') }, { tz: 'Europe/London', label: T('London') }, { tz: 'Asia/Tokyo', label: T('Tokyo') }]) : [];
    const here = S.tz || Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), 0, 1), doy = Math.floor((Date.parse(`${dayKey(now.toISOString())}T00:00:00Z`) - start) / 86400_000) + 1;
    const wk = (() => { const d = new Date(`${dayKey(now.toISOString())}T00:00:00Z`), day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - first) / 86400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7); })();
    b.append(
      el('div', {}, el('div', { class: 'dr-big' }, fmt(now.toISOString(), { hour: 'numeric', minute: '2-digit' })), el('div', { class: 'muted' }, fmt(now.toISOString(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))),
      drFacts([[T('Time zone'), here], [T('Week'), String(wk)], [T('Day of the year'), String(doy)]]),
      drSection(T('Around the world'), drZones([{ tz: here, label: T('Here') }, ...zones, ...(zones.length ? [] : [{ tz: 'UTC', label: 'UTC' }])])),
      sun && !sun.error ? drSection(T('Sun & moon'), drSunFacts(sun)) : null);
  },
});
tileDrawer('sun', {
  source: () => T('Worked out here from your town'),
  load: () => Promise.all([wget('/api/w/sun', 20 * 60_000), wget('/api/w/forecast', 15 * 60_000).catch(() => null)]).then(([sun, f]) => ({ sun, f })),
  render(b, { sun, f }) {
    if (!sun || sun.error) return b.append(drEmpty(T(sun?.error || 'Add your town in Settings to see the sun and moon.'), '#settings', T('Settings')));
    b.append(drSection(T('Today'), drSunFacts(sun)), drSunDays(f) ? drSection(T('The next days'), drSunDays(f)) : null);
  },
});

/* ---- Coming up: the week, day by day ---- */
tileDrawer('calendar', {
  doc: 'setup.calendars',
  load: (a) => wget('/api/calendar?days=7', 60_000).catch(() => ({ events: a.ctx.data?.home?.calendar?.events || [] })),
  actions: () => [typeof eventEditor === 'function' ? el('button', { class: 'btn small primary', onclick: () => eventEditor(null, () => { WCACHE.delete('/api/calendar?days=7'); DR.el && openDrawerAgain(); }) }, icon('plus', 14), el('span', { class: 'hide-phone' }, T('Add an event'))) : null],
  render(b, data, a) {
    const o = optsOf(a.t), cals = new Set(o.cals || []), now = Date.now(), until = now + 7 * 86400_000;
    const ev = (data?.events || []).filter((e) => Date.parse(e.end || e.start) > now && Date.parse(e.start) < until && (!cals.size || cals.has(e.calendar))).sort((x, y) => String(x.start).localeCompare(String(y.start)));
    if (!ev.length) return b.append(drEmpty(T('Nothing on your calendars this week.'), '#calendar', T('Open the calendar')));
    const days = new Map();
    for (const e of ev) { const k = e.allDay ? String(e.start).slice(0, 10) : dayKey(e.start); if (!days.has(k)) days.set(k, []); days.get(k).push(e); }
    const today = dayKey(new Date().toISOString()), tom = dayKey(new Date(Date.now() + 86400_000).toISOString());
    const dayTitle = (k) => (k === today ? T('Today') : k === tom ? T('Tomorrow') : fmt(`${k}T12:00:00Z`, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }));
    const evRow = (e) => el('div', { class: 'dr-row' }, el('span', { class: 'bar', style: `width:4px;align-self:stretch;border-radius:3px;background:${safeColor(e.color)}` }),
      el('div', { class: 'grow' }, el('b', { class: 'ellipsis', style: 'display:block' }, e.title), el('span', { class: 'tiny muted' }, [e.allDay ? T('all day') : `${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}`, e.location, e.calendar].filter(Boolean).join(' · '))));
    for (const [k, list] of [...days].sort(([x], [y]) => x.localeCompare(y))) b.append(drSection(dayTitle(k), el('div', { class: 'dr-list' }, list.map(evRow))));
    b.append(drOpenPage('#calendar', T('Open the calendar')));
  },
});
/** Draw the open drawer again (after something inside it changed what it shows). */
function openDrawerAgain() { const o = DR.opts; if (o) openDrawer({ ...o, fromHash: true }); }

/* ---- Headlines: more from every source, with the publisher and the time ---- */
tileDrawer('news', {
  doc: 'setup.news', updated: (d) => d?.at,
  load: () => wget('/api/news/more', 10 * 60_000),
  render(b, d, a) {
    const want = new Set(optsOf(a.t).sources || []), srcs = (d?.sources || []).filter((s) => !want.size || want.has(s.name));
    if (!srcs.length) return b.append(drEmpty(T('Pick news sources in Settings.'), '#settings', T('Settings')));
    const list = el('div', { class: 'dr-list' });
    const draw = (k) => {
      const items = (k === '*' ? srcs.flatMap((s) => s.items.map((i) => ({ ...i, source: s.name }))).sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 60) : (srcs.find((s) => s.name === k)?.items || []).map((i) => ({ ...i, source: k })));
      const err = k !== '*' && srcs.find((s) => s.name === k)?.error;
      list.replaceChildren(...(items.length ? items.map((i) => el('a', { class: 'dr-row dr-news', href: safeHref(i.link), target: '_blank', rel: 'noopener noreferrer' },
        el('div', { class: 'grow' }, el('div', {}, i.title), el('div', { class: 'tiny muted' }, [i.publisher || i.source, i.at ? ago(i.at) : null].filter(Boolean).join(' · '))))) : [el('p', { class: 'small muted' }, err ? T('This source isn\'t answering right now.') : T('Nothing here right now.'))]));
    };
    b.append(srcs.length > 1 ? drSeg([['*', T('All')], ...srcs.map((s) => [s.name, s.name])], '*', draw) : null, list);
    draw(srcs.length > 1 ? '*' : srcs[0].name);
  },
});

/* ---- Stocks: each symbol's chart over a day, a week, a month or a year, with its range ---- */
tileDrawer('stocks', {
  load: () => null,
  render(b, _x, a) {
    const o = optsOf(a.t), syms = o.symbols?.length ? o.symbols : ['^GSPC', 'AAPL', 'MSFT'];
    let sym = syms[0], range = '1d';
    const holder = el('div');
    const draw = async () => {
      holder.replaceChildren(drSkel(3));
      const r = await wget(`/api/w/stocks?s=${encodeURIComponent(sym)}&range=${range}`, range === '1d' ? 120_000 : 30 * 60_000).catch((err) => ({ error: err.message }));
      const q = r.quotes?.[0];
      if (!holder.isConnected) return;
      if (r.error || !q || q.error) return holder.replaceChildren(drEmpty(T('Quotes are not loading right now.')));
      const up = (q.change ?? 0) >= 0, vals = (q.spark || []).filter(Number.isFinite), n = vals.length, spanMs = { '1d': 6.5 * 3600_000, '5d': 5 * 86400_000, '1mo': 30 * 86400_000, '6mo': 182 * 86400_000, '1y': 365 * 86400_000 }[range];
      const end = q.at ? Date.parse(q.at) : Date.now(), xs = vals.map((_, i) => end - (n - 1 - i) * (spanMs / Math.max(1, n - 1)));
      holder.replaceChildren(
        el('div', {}, el('div', { class: 'muted small' }, `${q.name || q.symbol}${q.exchange ? ` · ${q.exchange}` : ''}`), el('div', { class: 'row', style: 'gap:12px;align-items:baseline' }, el('div', { class: 'dr-big' }, wMoney(q.price, q.currency)), el('span', { class: `stk-chg ${up ? 'up' : 'down'}` }, q.change == null ? '' : `${up ? '+' : ''}${wMoney(q.change)} (${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%)`))),
        n > 1 ? drChart({ xs, lines: [{ v: vals, cls: up ? 'ln-up' : 'ln-down', fmt: (v) => wMoney(v), label: q.symbol }], height: 180, xLabel: (ms) => (range === '1d' ? fmt(new Date(ms).toISOString(), { hour: 'numeric' }) : fmt(new Date(ms).toISOString(), { month: 'short', day: 'numeric' })), label: T('Price over time') }) : null,
        el('div', { class: 'dr-kpis' }, drKpi(T('Low'), n ? wMoney(Math.min(...vals)) : '-'), drKpi(T('High'), n ? wMoney(Math.max(...vals)) : '-'), drKpi(range === '1d' ? T('Previous close') : T('At the start'), q.prev != null ? wMoney(q.prev) : '-'), drKpi(T('Currency'), q.currency || '-')),
        el('div', { class: 'tiny muted' }, [r.credit ? T(r.credit) : null, q.at ? T('Updated {when}', { when: ago(q.at) }) : null, q.note ? T(q.note) : null].filter(Boolean).join(' · ')));
    };
    b.append(syms.length > 1 ? drSeg(syms.map((s) => [s, NICE_SYM[s] || s]), sym, (k) => { sym = k; draw(); }) : null,
      drSeg([['1d', T('Day')], ['5d', T('Week')], ['1mo', T('Month')], ['6mo', T('6 months')], ['1y', T('Year')]], range, (k) => { range = k; draw(); }), holder);
    draw();
  },
});

/* ---- Photos: the whole gallery ---- */
tileDrawer('photos', {
  wide: true, doc: 'page.photos',
  load: () => api('/api/photos').catch(() => ({ photos: [] })),
  render(b, { photos = [] }) {
    if (!photos.length) return b.append(drEmpty(T('Your photos, on a slow loop'), '#photos', T('Add photos')));
    const big = el('img', { class: 'dr-photo-big', alt: '', src: photos[0].url });
    const cap = el('div', { class: 'tiny muted' });
    const pick = (p) => { big.src = p.url; cap.textContent = p.credit ? T('Sample photo · {credit}', { credit: p.credit }) : ''; };
    pick(photos[0]);
    b.append(el('div', {}, big, cap), el('div', { class: 'dr-photos' }, photos.slice(0, 200).map((p) => el('button', { type: 'button', class: 'dr-thumb', 'aria-label': T('Show this photo'), onclick: () => pick(p) }, el('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async' })))),
      drOpenPage('#photos', T('Manage photos')));
  },
});

/* ---- Internet: online, speed and ping, with their history ---- */
tileDrawer(['internet', 'net-internet', 'net-speed'], {
  doc: 'health.internet', updated: (d) => d?.inet?.speed?.at,
  load: () => Promise.all([api('/api/internet').catch(() => null), api('/api/network/overview').catch(() => null)]).then(([inet, ov]) => ({ inet, ov })),
  actions: (_d, a, d) => [el('button', { class: 'btn small', disabled: S.me?.user && !['member', 'admin', 'owner'].includes(S.me.user.role) ? true : null, onclick: async (e) => { const bt = e.currentTarget; bt.disabled = true; toast(T('Testing (about 20 s)...')); try { await post('/api/internet/speedtest'); toast(T('Speed test done')); d.refresh(); } catch (err) { toast(err.message); } bt.disabled = false; } }, icon('bolt', 14), el('span', { class: 'hide-phone' }, T('Run a speed test')))],
  render(b, { inet, ov }) {
    const n = inet || {};
    if (!inet) return b.append(drEmpty(T('Checking…')));
    const sp = (ov?.history?.speed || []).filter((x) => x[1] != null), lat = (ov?.history?.inet || []).filter((x) => x[1] != null);
    b.append(
      el('div', { class: 'row', style: 'gap:12px' }, el('span', { class: `dot ${n.online ? 'good' : 'bad'}` }), el('div', { class: 'grow' }, el('b', { style: 'font-size:20px' }, n.online ? T('Online') : T('Down')), el('div', { class: 'tiny muted' }, [n.provider, n.city].filter(Boolean).join(' · ')))),
      el('div', { class: 'dr-kpis' }, drKpi(T('Download'), n.speed?.downMbps != null ? `${Math.round(n.speed.downMbps)} Mbps` : '-', n.speed?.at ? fmtWhen(n.speed.at) : null), drKpi(T('Upload'), n.speed?.upMbps != null ? `${Math.round(n.speed.upMbps)} Mbps` : '-'),
        ...Object.entries(n.latencyMs || {}).map(([k, v]) => drKpi(T('Ping {to}', { to: { cloudflare: 'Cloudflare', google: 'Google', router: T('router') }[k] || k }), v != null ? `${v} ms` : '-'))),
      lat.length > 3 ? drSection(T('Ping, the last 24 hours'), drChart({ xs: lat.map((x) => x[0]), lines: [{ v: lat.map((x) => x[1]), fmt: (v) => `${Math.round(v)} ms`, label: T('Ping') }], height: 130, label: T('Ping, the last 24 hours') })) : null,
      sp.length > 1 ? drSection(T('Speed tests'), drChart({ xs: sp.map((x) => x[0]), lines: [{ v: sp.map((x) => x[1]), fmt: (v) => `${Math.round(v)} Mbps`, label: T('Download') }, { v: sp.map((x) => x[2]), cls: 'ln-dash', fmt: (v) => `${Math.round(v)} Mbps`, label: T('Upload') }], height: 140, xLabel: (ms) => fmt(new Date(ms).toISOString(), { month: 'short', day: 'numeric' }), label: T('Speed tests') }),
        el('div', { class: 'dr-list' }, sp.slice(-8).reverse().map((x) => el('div', { class: 'dr-row' }, el('span', { class: 'grow small' }, fmtWhen(new Date(x[0]).toISOString())), el('span', { class: 'num small' }, `↓ ${Math.round(x[1])} · ↑ ${x[2] != null ? Math.round(x[2]) : '-'} Mbps`))))) : drSection(T('Speed tests'), el('p', { class: 'small muted', style: 'margin:0' }, T('CasaTorch tests every 4 hours. The history fills in from here.'))),
      drFacts([[T('Devices'), n.lanDevices != null ? String(n.lanDevices) : null], [T('Gateway'), n.gateway], [T('Public IP'), n.publicIp && S.me?.user?.role !== 'viewer' ? (typeof nwIp === 'function' ? nwIp(n.publicIp) : n.publicIp) : null]]),
      drOpenPage('#network', T('Open Network')));
  },
});

/* ---- Devices: every control, the last 24 hours, the details, its alert rules, and the rest of its room ---- */
/** All devices the page on show already has (no extra request), else the house's list. */
async function drDevices() {
  const data = $('#view .grid')?._ctx?.data;
  const list = Array.isArray(data?.devices) ? data.devices : data?.devices?.devices;
  if (list?.length) return list;
  return (await api('/api/devices').catch(() => ({}))).devices || [];
}
function drHistChart(s, d, height = 150) {
  const vals = s.v || [], xs = vals.map((_, i) => s.end - (vals.length - 1 - i) * s.step);
  return drChart({ xs, lines: [{ v: vals, fmt: histFmt(s.field, d), label: d.name }], height, label: T('The last 24 hours') });
}
function deviceDrawer(d, { fromHash = false } = {}) {
  if (d.kind === 'camera') return camDrawer(d, null, { fromHash });
  let dev = d;
  return openDrawer({
    route: ['dev', d.id], fromHash, title: d.name, icon: devIconName(d), doc: d.kind === 'camera' ? 'page.cameras' : 'page.controls',
    sub: () => [dev.area, dev.provider === 'ha' ? 'Home Assistant' : srcName(dev.source || dev.provider) || pretty(dev.provider)].filter(Boolean).join(' · '),
    async load() {
      const all = await drDevices(), fresh = all.find((x) => x.id === d.id); if (fresh) dev = Object.assign(d, fresh);
      const sr = shFieldOf(dev) ? await devHistory([dev.id]) : {};
      return { hist: sr[dev.id] || null, room: dev.area ? all.filter((x) => x.area === dev.area && x.id !== dev.id && x.kind !== 'camera') : [] };
    },
    render(b, { hist, room }, dr) {
      const sync = () => setTimeout(async () => { try { const n = (await api('/api/devices')).devices?.find((x) => x.id === dev.id); if (n) Object.assign(dev, n); } catch { /* keep */ } if (b.isConnected) dr.refresh(); }, 900);
      const controls = C() && hasSheet(dev) ? el('div', { class: 'dsheet' }, ...C().build(dev, { units: S.units, act: async (act, v) => { await devAct(dev, act, null, v); sync(); } }))
        : el('div', { class: 'row wrap', style: 'gap:6px' }, devControls(dev, 'xl', () => sync()).filter((x) => !x.title));
      b.append(
        el('div', { class: 'row', style: 'gap:14px;align-items:center' }, el('span', { class: 'ic big' }, icon(devIconName(dev), 28)), el('div', { class: 'grow' }, el('div', { class: 'dr-big', style: 'font-size:30px' }, devHeadline(dev) || ''), el('div', { class: 'small muted' }, devMeta(dev, false))),
          dev.online === false ? el('span', { class: 'pill' }, T('offline')) : null),
        dev.online === false ? el('p', { class: 'small muted', style: 'margin:0' }, T('This device isn\'t answering right now, so its controls are hidden.')) : drSection(T('Controls'), controls),
        hist ? drSection(T('The last 24 hours'), drHistChart(hist, dev)) : shFieldOf(dev) ? drSection(T('The last 24 hours'), el('p', { class: 'small muted', style: 'margin:0' }, T('The chart fills in as readings come in.'))) : null,
        drSection(T('Details'), devFacts(dev, hist)),
        typeof alertDeviceLink === 'function' && !S.status?.demo ? el('div', {}, alertDeviceLink(dev)) : null,
        room.length ? drSection(T('Also in {room}', { room: dev.area }), el('div', { class: 'switches dr-switches' }, room.slice(0, 24).map((x) => devButton(x, true)))) : null);
    },
  });
}
drawerRoute('dev', (id) => { drDevices().then((all) => { const d = all.find((x) => x.id === id); if (d) (d.kind === 'camera' ? camDrawer(d, null, { fromHash: true }) : deviceDrawer(d, { fromHash: true })); }); });
/* A device tile and a thermostat open the device's own drawer. */
tileDrawer(['device', 'thermostat'], {
  custom(a, { fromHash }) {
    const all = Array.isArray(a.ctx.data?.devices) ? a.ctx.data.devices : a.ctx.data?.devices?.devices || [];
    const o = optsOf(a.t), d = a.w.id === 'device' ? all.find((x) => x.id === a.t.device) : all.find((x) => x.id === o.dev) || all.find((x) => x.kind === 'climate');
    if (!d) return false;
    const st = d.kind === 'camera' ? camDrawer(d, null, { fromHash, route: ['tile', a.t.id] }) : deviceDrawer(d, { fromHash });
    return !!st;
  },
});
/* Lists of devices (Quick switches, Pinned devices, a room, Now playing, Batteries, Doors & locks): every one of them, with
   their facts; tap one to switch it, press and hold for its own drawer. */
function drDeviceList(b, ds, ctx, { title = null, readings = true } = {}) {
  const switches = ds.filter((d) => !isReading(d) && d.kind !== 'camera'), rd = ds.filter(isReading);
  b.append(el('div', { class: 'row between wrap', style: 'gap:8px' }, roomFacts(ds), lightsOffBtn(ds, ctx)),
    switches.length ? drSection(title, el('div', { class: 'switches dr-switches' }, switches.map((d) => devButton(d, true))), el('div', { class: 'tiny muted' }, T('Tap to switch · press and hold for details'))) : null,
    readings && rd.length ? drSection(T('Sensors'), sensorTable(rd)) : null);
}
tileDrawer(['lights', 'entities', 'room', 'media', 'batteries', 'secure', 'sec-doors', 'ctl-room', 'ctl-group', 'ctl-fav', 'ctl-climate', 'ctl-summary'], {
  doc: 'page.controls',
  load: () => drDevices(),
  render(b, all, a) {
    const o = optsOf(a.t), id = a.w.id;
    let ds = all;
    if (id === 'lights') { const kinds = new Set(o.kinds?.length ? o.kinds : ['light', 'switch', 'plug', 'media']); ds = all.filter((d) => kinds.has(d.kind) && (!o.area || d.area === o.area)); }
    else if (id === 'entities') ds = (a.t.ids || []).map((x) => all.find((d) => d.id === x)).filter(Boolean);
    else if (id === 'room') ds = all.filter((d) => d.area === a.t.area);
    else if (id === 'media') ds = all.filter((d) => d.kind === 'media' && (!o.ids?.length || o.ids.includes(d.id)));
    else if (id === 'batteries') ds = all.filter((d) => typeof d.battery === 'number').sort((x, y) => x.battery - y.battery);
    else if (id === 'ctl-room') ds = all.filter((d) => (o.area === '-' ? !d.area : d.area === o.area) && d.kind !== 'camera');
    else if (id === 'ctl-group') ds = all.filter((CTL_GROUPS[o.group || 'lights'] || CTL_GROUPS.lights)[1]);
    else if (id === 'ctl-fav') ds = (o.ids || []).map((x) => all.find((d) => d.id === x)).filter(Boolean);
    else if (id === 'ctl-climate') ds = all.filter((d) => d.kind === 'climate');
    else if (id === 'ctl-summary') ds = all.filter((d) => d.kind !== 'camera');
    else if (id === 'secure' || id === 'sec-doors') ds = all.filter((d) => d.kind === 'lock' || (d.open != null && d.kind !== 'cover') || (d.kind === 'cover' && d.risky) || d.kind === 'alarm');
    if (!ds.length) return b.append(drEmpty(T('Nothing here yet.'), '#connect', T('Set this up')));
    if (id === 'batteries') return b.append(el('div', { class: 'dr-list' }, ds.map((d) => el('button', { type: 'button', class: 'dr-row dr-rowbtn', onclick: () => deviceDrawer(d) }, el('span', { class: 'grow ellipsis' }, d.name, d.area ? el('span', { class: 'tiny muted' }, ` · ${d.area}`) : null), el('div', { class: 'track', style: 'width:90px' }, el('div', { class: `fill ${d.battery <= 20 ? 'bad' : d.battery <= 40 ? 'warn' : ''}`, style: `width:${Math.max(3, d.battery)}%` })), el('b', { class: 'num small', style: 'width:42px;text-align:right' }, `${d.battery}%`)))),
      el('p', { class: 'tiny muted', style: 'margin:0' }, T('Lowest first. Tap one for its history and details.')));
    if (id === 'secure' || id === 'sec-doors') return b.append(typeof doorsCard === 'function' ? el('div', {}, doorsCard(all, () => {}, { tier: 'xl' })) : null, drSection(T('Every lock and door'), el('div', { class: 'switches dr-switches' }, ds.map((d) => devButton(d, true)))), el('p', { class: 'tiny muted' }, T('CasaTorch never unlocks or opens anything from here.')));
    drDeviceList(b, ds, a.ctx);
  },
});

/* ---- Cameras: live, with what they saw ---- */
function camDrawer(d, onClose, { fromHash = false, route = null } = {}) {
  let stage = null;
  return openDrawer({
    route: route || ['cam', d.id], fromHash, title: d.name, icon: 'camera', wide: true, doc: 'page.cameras',
    sub: () => [srcName(d.source || d.provider), d.stream ? T('live') : T('a new picture every second')].filter(Boolean).join(' · '),
    async load() {
      const [ev, alerts, all] = await Promise.all([d.frigateCam ? api(`/api/frigate/events?hours=24&camera=${encodeURIComponent(d.frigateCam)}`).catch(() => null) : null, api('/api/alerts').catch(() => null), drDevices()]);
      return { ev, alerts, cams: all.filter((x) => x.kind === 'camera') };
    },
    render(b, { ev, alerts, cams }) {
      stage?.stop(); stage = camStage(d);
      const name = String(d.name || '').toLowerCase();
      const acts = [...(alerts?.now || []), ...(alerts?.recent || [])].filter((x) => name && String(x.title || '').toLowerCase().includes(name)).sort((x, y) => String(y.at || y.since).localeCompare(String(x.at || x.since))).slice(0, 12);
      const det = ev?.frigate && ev.recent?.length ? el('div', { class: 'detlist' }, ev.recent.slice(0, 20).map((e) => { const [sid, id] = e.id.split(':');
        return el('div', { class: 'detrow' }, el('img', { loading: 'lazy', alt: '', src: `/api/frigate/events/${sid}/${encodeURIComponent(id)}/thumbnail` }), el('div', { class: 'grow', style: 'min-width:0' }, el('b', {}, `${typeof DET_ICON !== 'undefined' && DET_ICON[e.label] || '•'} ${typeof detName === 'function' ? detName(e.label) : e.label}`), el('div', { class: 'tiny muted' }, `${fmtWhen(e.start)}${e.score ? ` · ${e.score}%` : ''}`))); })) : null;
      const hours = ev?.frigate ? (() => { const byH = Array(24).fill(0); for (const e of ev.recent || []) byH[new Date(e.start).getHours()]++; const max = Math.max(1, ...byH); return el('div', { class: 'dethours', role: 'img', 'aria-label': T('Detections by hour of day') }, byH.map((n, h) => el('div', { class: 'dh', title: `${hm(`${h}:00`)}: ${n}` }, el('i', { style: `height:${(n / max) * 100}%` })))); })() : null;
      b.append(stage.node,
        cams.length > 1 ? el('div', { class: 'sp-pick' }, cams.map((c) => el('button', { type: 'button', class: `chip${c.id === d.id ? ' on' : ''}`, onclick: () => { if (c.id !== d.id) { stage?.stop(); camDrawer(c, onClose); } } }, c.name))) : null,
        det ? drSection(T('What it saw (24 h)'), hours, det) : null,
        !det && acts.length ? drSection(T('Activity'), el('div', { class: 'dr-list' }, acts.map((x) => el('div', { class: 'dr-row' }, el('span', { class: `dot ${alSevDot(x.severity)}` }), el('span', { class: 'grow' }, alertTitle(x)), el('span', { class: 'tiny muted' }, fmtWhen(x.at || x.since)))))) : null,
        !det && !acts.length ? drSection(T('Activity'), el('p', { class: 'small muted', style: 'margin:0' }, ev?.frigate ? T('Nothing detected in this time.') : T('With Frigate, what this camera saw - people, cars, animals - shows here, hour by hour.'))) : null,
        drSection(T('Details'), drFacts([[T('From'), srcName(d.source || d.provider) || pretty(d.provider)], [T('Room'), d.area], [T('Live video'), d.stream ? T('Yes') : T('Pictures every second')], [T('Doorbell'), d.doorbell ? T('Yes') : null]])));
    },
    onClose: () => { stage?.stop(); stage = null; onClose?.(); onClose = null; },
  });
}
drawerRoute('cam', (id) => { drDevices().then((all) => { const d = all.find((x) => x.id === id && x.kind === 'camera'); if (d) camDrawer(d, null, { fromHash: true }); }); });
tileDrawer(['camera', 'doorbell', 'cam-one', 'cam-wall', 'sec-wall'], {
  custom(a, { fromHash }) {
    const all = (Array.isArray(a.ctx.data?.devices) ? a.ctx.data.devices : a.ctx.data?.devices?.devices || []).filter((x) => x.kind === 'camera'), o = optsOf(a.t);
    const d = a.w.id === 'doorbell' ? all.find((x) => x.id === o.cam) || all.find((x) => x.doorbell) || all.find((x) => /door|bell|porch|front/i.test(x.name)) || all[0]
      : a.w.id === 'cam-one' ? all.find((x) => x.id === (a.t.device || o.device)) : all.find((x) => (o.ids || o.only || []).includes(x.id)) || all[0];
    if (!d) return false;
    camDrawer(d, null, { fromHash, route: ['tile', a.t.id] });
    return true;
  },
});

/* ---- Alerts: what needs you, with what you can do about it; everything that happened ---- */
tileDrawer(['alerts', 'al-now', 'al-recent', 'al-sources'], {
  doc: 'settings.alerts', every: 30_000,
  load: () => api('/api/alerts'),
  actions: () => [el('a', { class: 'btn small', href: '#settings/alerts', onclick: () => closeDrawer() }, icon('sliders', 14), el('span', { class: 'hide-phone' }, T('Alert rules')))],
  render(b, a, _t, dr) {
    const ctx = { refresh: () => dr.refresh() };
    b.append(
      drSection(T('Right now'), a.now?.length ? el('div', { class: 'dr-list' }, a.now.map((x) => el('div', { class: `alert ${x.severity}` }, el('div', { class: 'grow' }, el('b', {}, alertTitle(x)), el('div', { class: 'small muted' }, [srcName(x.source), x.since ? T('since {when}', { when: fmtWhen(x.since) }) : '', x.acked ? T('{name} has it ({time})', { name: x.acked.by, time: fmtTime(x.acked.at) }) : ''].filter(Boolean).join(' · '))), typeof alertActions === 'function' ? alertActions(x, ctx) : null)))
        : el('div', { class: 'row' }, el('span', { class: 'dot good' }), T('All clear - nothing needs you.'))),
      a.recent?.length ? drSection(T('Recent'), el('div', { class: 'dr-list' }, a.recent.slice(0, 50).map((x) => el(S.status?.demo ? 'div' : 'button', { type: S.status?.demo ? null : 'button', class: 'dr-row dr-rowbtn', onclick: S.status?.demo || typeof alertSheet !== 'function' ? null : () => alertSheet(x, ctx) }, el('span', { class: `dot ${alSevDot(x.severity)}` }), el('div', { class: 'grow' }, alertTitle(x), x.source ? el('div', { class: 'tiny muted' }, srcName(x.source)) : null), el('span', { class: 'tiny muted' }, fmtWhen(x.at)))))) : null,
      drOpenPage('#alerts', T('Open Alerts')));
  },
});

/* ---- Today and reminders ---- */
tileDrawer(['today', 'rem-today', 'rem-list'], {
  doc: 'page.reminders',
  load: (a) => api('/api/nudges').catch(() => ({ list: [], today: [], fallback: a.ctx.data?.home?.reminders || [] })),
  render(b, d, a) {
    const today = new Set(d.today || []), list = (d.list || []).filter((n) => n.on !== false), now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const todays = list.filter((n) => today.has(n.id)).sort((x, y) => String(x.time).localeCompare(String(y.time)));
    const note = a.ctx.data?.home?.note;
    b.append(note ? drSection(T('House note'), el('p', { style: 'margin:0' }, note)) : null,
      drSection(T('Today'), todays.length || d.fallback?.length ? el('div', { class: 'dr-list' }, (todays.length ? todays : d.fallback).map((n) => el('div', { class: `dr-row${n.time && n.time < hhmm ? ' muted' : ''}` }, el('span', { class: 'dot warn' }), el('span', { class: 'grow' }, n.title), n.time || n.at ? el('span', { class: 'small muted num' }, hm(n.time || n.at)) : null)))
        : el('p', { class: 'small muted', style: 'margin:0' }, T('No reminders today.'))),
      list.length ? drSection(T('Every reminder'), el('div', { class: 'dr-list' }, list.map((n) => el('div', { class: 'dr-row' }, el('span', { class: 'grow' }, n.title), el('span', { class: 'tiny muted' }, typeof nudgeWhen === 'function' ? nudgeWhen(n) : hm(n.time)))))) : null,
      drOpenPage('#reminders', T('Open Reminders')));
  },
});

/* ---- The rest: tiles whose own full view is their "more" ---- */
tileDrawer('radar', { custom(a) { if (typeof radarFull !== 'function') return false; const o = optsOf(a.t); radarFull({ zoom: o.zoom || 7, autoplay: o.play !== false, title: a.t.title || null }); return true; } });
/* Tiles that live on their own page: the tile at its biggest, plus the way to that page. */
const DR_PAGE_OF = { 'net-apptests': ['#apptests', 'Open App tests', 'page.apptests'], 'rem-phones': ['#reminders', 'Open Reminders', 'page.reminders'], 'al-week': ['#alerts', 'Open Alerts', 'settings.alerts'], 'al-phones': ['#settings/phones', 'Phones & alerts', 'settings.phones'],
  'sec-check': ['#security', 'Open Security', 'page.security'], 'sec-events': ['#security', 'Open Security', 'page.security'], 'sec-lan': ['#security', 'Open Security', 'page.security'], 'sec-alarm': ['#security', 'Open Security', 'page.security'],
  'cam-det': ['#cameras', 'Open Cameras', 'page.cameras'], ask: ['#ask', 'Open your Home AI Agent', 'page.ask'], house3d: ['#house3d', 'Open 3D Home', 'page.house3d'] };
for (const [id, [href, label, doc]] of Object.entries(DR_PAGE_OF)) {
  const g = drGeneric({ id });
  tileDrawer(id, { doc, wide: ['sec-lan', 'net-apptests', 'cam-det'].includes(id), render(b, data, a, d) { g.render(b, data, a, d); if (!(href.slice(1) === current)) b.append(drOpenPage(href, T(label))); } });
}
