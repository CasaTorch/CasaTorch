/* ======================================================================
 * Energy: a page of tiles (06-pagegrid.js) drawn from /api/energy/overview (35e-energy.js).
 * CasaTorch suggests the tiles from what the house has (a house with solar gets the power flow, one with
 * smart plugs gets the top consumers); you can add, remove, resize and move any of them.
 * Colors follow the job: the grid is blue, solar yellow, the battery aqua, an EV violet, energy sent back
 * magenta - the same everywhere on the page, light and dark (--en-* in app.css). Charts are plain SVG.
 * ====================================================================== */
Object.assign(ICONS, {
  battery: 'M3 7h15v10H3zM21 10v4M6 10v4M9.5 10v4',
  tower: 'M12 3 7 21M12 3l5 18M8.5 15h7M9.6 10h4.8M5 8h14M4 21h16',
  leaf: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19c3-4 6-7 10-9',
});
const enW = (w) => (w == null || !Number.isFinite(w) ? '-' : Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(Math.abs(w) >= 10_000 ? 0 : 1)} kW` : `${Math.round(w)} W`);
const enK = (k) => (k == null || !Number.isFinite(k) ? '-' : k >= 100 ? `${Math.round(k)} kWh` : k >= 10 ? `${k.toFixed(1)} kWh` : `${k.toFixed(k < 1 ? 2 : 1)} kWh`);
const enMoney = (d, v, digits) => (v == null || !Number.isFinite(v) ? null : new Intl.NumberFormat(dateLoc(), { style: 'currency', currency: d.currency || 'USD', maximumFractionDigits: digits ?? (Math.abs(v) >= 100 ? 0 : 2), minimumFractionDigits: digits ?? (Math.abs(v) >= 100 ? 0 : 2) }).format(v));
const enHour = (h) => fmt(new Date(2000, 0, 1, h).toISOString(), { hour: 'numeric', timeZone: undefined });
const enDay = (key, o = { weekday: 'short' }) => fmt(`${key}T12:00:00Z`, { ...o, timeZone: 'UTC' });
const enCur = (c) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).formatToParts(0).find((x) => x.type === 'currency')?.value || '$'; } catch { return '$'; } };
const enPut = (b, ...k) => b.replaceChildren(...k.flat().filter((x) => x != null && x !== false && x !== ''));
const enData = (ctx) => ctx.data?.en || {};
/* A stat: small label, a big number, a line under it. */
const enStat = (label, value, sub, cls = '') => el('div', { class: `en-stat ${cls}` }, el('div', { class: 'en-lbl' }, label), el('div', { class: 'en-val' }, value), sub ? el('div', { class: 'en-sub' }, sub) : null);
const enEmpty = (text, link, label) => el('div', { class: 'en-empty' }, el('div', { class: 'small muted' }, text), link ? el('a', { class: 'btn small', href: link }, label) : null);
const enDelta = (pct, goodWhenDown = true) => { if (pct == null) return null; const up = pct > 0, good = goodWhenDown ? !up : up; return el('span', { class: `en-delta ${pct === 0 ? '' : good ? 'good' : 'bad'}` }, `${up ? '▲' : pct < 0 ? '▼' : '•'} ${Math.abs(pct)}%`); };
const enTitleOf = (d) => d?.name || '';

/* ---- live power now ---- */
pageTile({ id: 'en-now', page: 'energy', title: 'Using now', icon: 'bolt', blurb: 'What the house uses this minute, the last hour, and what it costs', size: [3, 2], min: [2, 2], max: [12, 6], render(b, ctx, { w, h, narrow }) {
  const d = enData(ctx), n = d.now || {}, use = n.useW, perHour = d.rate && use != null ? use / 1000 * d.rate : null;
  const live = (d.live || []).map(([, v]) => v);
  const top = (d.devices || []).filter((x) => x.w >= 1).slice(0, Math.max(0, h - 2) * 2);
  enPut(b, 
    el('div', { class: 'en-now' }, el('div', { class: `en-hero${narrow || w <= 3 ? ' sm' : ''}` }, use == null ? '-' : Math.abs(use) >= 1000 ? (use / 1000).toFixed(1) : Math.round(use), el('small', {}, use != null && Math.abs(use) >= 1000 ? ' kW' : ' W')), el('span', { class: 'pill live-dot' }, el('i'), T('Live'))),
    el('div', { class: 'en-sub' }, perHour != null ? T('{hour} an hour · {day} a day at this pace', { hour: enMoney(d, perHour, perHour < 1 ? 2 : 2), day: enMoney(d, perHour * 24) }) : n.from ? T('From {meter}', { meter: n.from }) : T('Add your electricity price to see the cost')),
    live.length > 4 ? el('div', { class: 'en-spark-wrap' }, pgSpark(live, { w: 300, h: h >= 3 ? 56 : 30, cls: 'en-grid-c', label: T('The last hour') }), h >= 3 ? el('div', { class: 'en-axis' }, el('span', {}, T('1 h ago')), el('span', {}, T('now'))) : null) : null,
    h >= 3 && top.length ? el('div', { class: 'en-mini-list' }, top.map((x) => el('div', { class: 'row between' }, el('span', { class: 'ellipsis' }, x.name), el('b', { class: 'num' }, enW(x.w))))) : null);
} });

/* ---- where the power comes from and goes, right now ---- */
const EN_FLOW_WIDE = { pos: { solar: [250, 50], grid: [62, 158], home: [430, 158], battery: [250, 266], ev: [560, 158] }, box: [620, 340],
  paths: { 'solar-home': 'M250,86 Q250,158 392,158', 'solar-battery': 'M250,86 L250,230', 'solar-grid': 'M250,86 Q250,158 98,158', 'grid-home': 'M98,158 L392,158', 'grid-battery': 'M98,158 Q250,158 250,230', 'battery-home': 'M250,230 Q250,158 392,158', 'home-ev': 'M468,158 L524,158' } };
const EN_FLOW_TALL = { pos: { solar: [190, 50], grid: [52, 160], home: [328, 160], battery: [190, 270], ev: [328, 290] }, box: [400, 372],
  paths: { 'solar-home': 'M190,86 Q190,160 290,160', 'solar-battery': 'M190,86 L190,234', 'solar-grid': 'M190,86 Q190,160 88,160', 'grid-home': 'M88,160 L290,160', 'grid-battery': 'M88,160 Q190,160 190,234', 'battery-home': 'M190,234 Q190,160 290,160', 'home-ev': 'M328,198 L328,254' } };
/* How the live readings split into flows: the sun serves the house first, then the battery, then goes back out. */
function enSplitFlows(n) {
  const S = Math.max(0, n.solarW || 0), B = n.battery?.w || 0, H = Math.max(0, n.useW || 0), G = n.gridW;
  const s2h = Math.min(S, H), rest = S - s2h, s2b = Math.min(rest, Math.max(0, -B)), s2g = Math.max(0, rest - s2b);
  const b2h = Math.max(0, Math.min(B, H - s2h)), g2b = Math.max(0, -B - s2b), gi = G != null ? Math.max(0, G) : Math.max(0, H - s2h - b2h);
  return { 'solar-home': s2h, 'solar-battery': s2b, 'solar-grid': s2g, 'battery-home': b2h, 'grid-battery': Math.min(g2b, gi), 'grid-home': Math.max(0, gi - Math.min(g2b, gi)), 'home-ev': Math.max(0, n.evW || 0) };
}
pageTile({ id: 'en-flow', page: 'energy', phoneFull: true, title: 'Power flow', icon: 'bolt', blurb: 'Grid, solar, battery, home and car - live, with the energy moving between them', size: [6, 5], min: [3, 3], max: [12, 8], render(b, ctx, { h, w, narrow }) {
  const d = enData(ctx), n = d.now || {}, L = !narrow && w >= 5 ? EN_FLOW_WIDE : EN_FLOW_TALL, EN_FLOW_POS = L.pos;
  const nodes = { home: true, grid: n.gridW != null || n.useW != null, solar: n.solarW != null, battery: !!n.battery, ev: n.evW != null };
  const f = enSplitFlows(n), key = `${L === EN_FLOW_WIDE}:${Object.entries(nodes).filter(([, v]) => v).map(([k]) => k).join(',')}`;
  const C = { solar: 'var(--en-solar)', grid: 'var(--en-grid)', battery: 'var(--en-batt)', home: 'var(--text)', ev: 'var(--en-ev)' };
  const paths = L.paths;
  const speed = (wv) => (wv >= 5000 ? 1.1 : wv >= 2000 ? 1.6 : wv >= 700 ? 2.3 : wv >= 150 ? 3.2 : 4.4);
  const label = { solar: T('Solar'), grid: T('Grid'), home: T('Home'), battery: T('Battery'), ev: T('Car') };
  const sub = {
    solar: n.solarW > 20 ? T('producing') : T('resting'),
    grid: n.gridW == null ? '' : n.gridW < -20 ? T('sending back') : n.gridW > 20 ? T('buying') : T('idle'),
    home: n.selfPct != null ? T('{n}% self-powered', { n: n.selfPct }) : T('using'),
    battery: n.battery?.w > 20 ? T('discharging') : n.battery?.w < -20 ? T('charging') : n.battery?.pct >= 97 ? T('full') : T('standing by'),
    ev: n.evW > 20 ? T('charging') : T('not charging'),
  };
  const value = { solar: enW(n.solarW), grid: enW(n.gridW == null ? null : Math.abs(n.gridW)), home: enW(n.useW), battery: n.battery?.pct != null ? `${n.battery.pct}%` : enW(Math.abs(n.battery?.w || 0)), ev: enW(n.evW) };
  // the same picture stays on screen between refreshes: only the numbers and the moving dots change
  if (b._flowKey !== key || !b.firstChild) {
    const uid = `f${Math.random().toString(36).slice(2, 7)}`, svg = svgEl('svg', { viewBox: `0 0 ${L === EN_FLOW_WIDE && !nodes.ev ? 500 : L.box[0]} ${L.box[1]}`, class: 'en-flow', role: 'img' });
    for (const [k, p] of Object.entries(paths)) { const [a, z] = k.split('-'); if (!nodes[a] || !nodes[z]) continue; svg.append(svgEl('path', { id: `${uid}-${k}`, d: p, class: 'en-edge', 'data-k': k, style: `--c:${C[a === 'home' ? 'ev' : a]}` })); }
    svg.append(svgEl('g', { class: 'en-dots' }));
    for (const [k, on] of Object.entries(nodes)) {
      if (!on) continue;
      const [x, y] = EN_FLOW_POS[k], r = k === 'home' ? 38 : 36, side = k === 'solar' ? 1 : k === 'battery' ? (L === EN_FLOW_TALL ? -1 : 1) : 0;
      const g = svgEl('g', { class: `en-node n-${k}`, transform: `translate(${x},${y})`, style: `--c:${C[k]}` },
        svgEl('circle', { r, class: 'en-ring' }),
        svgEl('path', { d: ICONS[{ solar: 'sun', grid: 'tower', home: 'home', battery: 'battery', ev: 'car' }[k]], transform: 'translate(-12,-25)', class: 'en-ic' }),
        svgEl('text', { y: 16, class: 'en-nv', 'text-anchor': 'middle' }),
        svgEl('text', { x: side ? side * (r + 12) : 0, y: side ? -3 : r + 18, class: 'en-nl', 'text-anchor': side > 0 ? 'start' : side < 0 ? 'end' : 'middle' }),
        svgEl('text', { x: side ? side * (r + 12) : 0, y: side ? 13 : r + 33, class: 'en-ns', 'text-anchor': side > 0 ? 'start' : side < 0 ? 'end' : 'middle' }));
      svg.append(g);
    }
    b._flowKey = key; b._uid = uid; b._speeds = {};
    enPut(b, el('div', { class: 'en-flow-wrap' }, svg), el('div', { class: 'en-flow-foot' }));
  }
  const svg = b.querySelector('svg'), uid = b._uid, dots = svg.querySelector('.en-dots'), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const k of Object.keys(nodes)) { const g = svg.querySelector(`.n-${k}`); if (!g) continue; g.querySelector('.en-nv').textContent = value[k]; g.querySelector('.en-nl').textContent = label[k]; g.querySelector('.en-ns').textContent = sub[k]; }
  for (const e of svg.querySelectorAll('.en-edge')) {
    const k = e.dataset.k, wv = f[k] || 0, on = wv > 15; e.classList.toggle('on', on);
    const s = on && !still ? speed(wv) : 0;
    if (b._speeds[k] === s) continue;
    b._speeds[k] = s;
    dots.querySelectorAll(`[data-k="${k}"]`).forEach((x) => x.remove());
    if (!s) continue;
    for (let i = 0; i < 3; i++) {
      const c = svgEl('circle', { r: 4, class: 'en-dot', 'data-k': k, style: e.getAttribute('style') });
      c.append(svgEl('animateMotion', { dur: `${s}s`, repeatCount: 'indefinite', begin: `${(-s * i / 3).toFixed(2)}s` }, svgEl('mpath', { href: `#${uid}-${k}` })));
      dots.append(c);
    }
  }
  svg.setAttribute('aria-label', Object.keys(nodes).filter((k) => nodes[k]).map((k) => `${label[k]} ${value[k]} ${sub[k]}`).join(', '));
  const foot = b.querySelector('.en-flow-foot');
  foot.replaceChildren(...(h >= 4 ? [n.selfPct != null ? el('span', { class: 'chip-stat' }, el('i', { style: 'background:var(--en-solar)' }), T('{n}% from your own power', { n: n.selfPct })) : null,
    n.gridW != null ? el('span', { class: 'chip-stat' }, el('i', { style: `background:${n.gridW < 0 ? 'var(--en-export)' : 'var(--en-grid)'}` }), n.gridW < 0 ? T('Sending {w} back to the grid', { w: enW(-n.gridW) }) : T('Buying {w} from the grid', { w: enW(n.gridW) })) : null].filter(Boolean) : []));
} });

/* ---- today, 7 days, 30 days ---- */
pageTile({ id: 'en-usage', page: 'energy', title: 'Energy used', icon: 'calendar', blurb: 'Today, the last 7 days and the last 30 days - with what it cost', size: [3, 2], min: [2, 2], max: [12, 4], render(b, ctx, { w, h, narrow }) {
  const d = enData(ctx), u = d.usage || {};
  const cell = (key, label) => { const x = u[key]; return enStat(label, x ? enK(x.kwh) : key === 'd30' && u.d30Locked ? el('span', { class: 'pill pro' }, 'Pro') : '-', x?.cost != null ? enMoney(d, x.cost) : key === 'd30' && u.d30Locked ? T('Pro keeps 2 years') : null); };
  if ((w >= 6 && !narrow) || (narrow && w >= 4)) return enPut(b, el('div', { class: 'en-cols3' }, cell('today', T('Today')), cell('d7', T('7 days')), cell('d30', T('30 days'))), u.from === 'ha' ? el('div', { class: 'en-foot' }, T('From Home Assistant\'s Energy dashboard')) : null);
  b._span ||= 'today';
  const seg = el('div', { class: 'seg seg-mini en-seg' }, [['today', T('Today')], ['d7', T('7 d')], ['d30', T('30 d')]].map(([k, l]) => el('button', { class: b._span === k ? 'on' : '', onclick: () => { b._span = k; this.render(b, ctx, { w, h, narrow }); } }, l)));
  const labels = { today: T('Today so far'), d7: T('Last 7 days'), d30: T('Last 30 days') };
  enPut(b, seg, cell(b._span, labels[b._span]));
} });

/* ---- daily bars ---- */
function enColumns(vals, { labels = [], fmtTip, partialLast = false, cls = 'en-grid-c', height = 160, avg = null, unit = 'kWh', compare = null, int = false } = {}) {
  const box = el('div', { class: 'en-cols-chart' }), tip = chartTip();
  const paint = () => {
    const W = Math.max(220, box.clientWidth || 400), H = Math.max(80, box.clientHeight || height), padL = 34, padB = 18, padT = 8, n = vals.length;
    const max = Math.max(0.001, ...vals.map((v) => v || 0), ...(compare || []).map((v) => v || 0)), step = max > 40 ? 20 : max > 20 ? 10 : max > 8 ? 5 : max > 4 || int ? 2 : max > 1 ? 1 : 0.5, top = Math.ceil(max / step) * step;
    const y = (v) => padT + (H - padT - padB) * (1 - v / top), band = (W - padL) / n, bw = Math.min(24, band * (compare ? 0.36 : 0.66));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'en-chart', role: 'img' });
    for (const v of [0, top / 2, top]) svg.append(svgEl('line', { x1: padL, x2: W, y1: y(v), y2: y(v), class: 'gl' }), svgEl('text', { x: padL - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'ax' }, v === 0 ? '0' : `${v}`));
    const bar = (x, v, c) => { const yy = y(v), hh = Math.max(1, y(0) - yy), r = Math.min(4, bw / 2, hh); return svgEl('path', { d: `M${x},${y(0)}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${y(0)}Z`, class: c }); };
    vals.forEach((v, i) => {
      const cx = padL + band * i + band / 2;
      if (compare && compare[i] != null) svg.append(bar(cx - bw - 1, compare[i], 'b-prev'));
      if (v != null) svg.append(bar(compare ? cx + 1 : cx - bw / 2, v, `b-main ${cls}${partialLast && i === n - 1 ? ' partial' : ''}`));
      const hit = svgEl('rect', { x: padL + band * i, y: 0, width: band, height: H - padB, class: 'hit' });
      hit.addEventListener('pointermove', (e) => tip.show(e, fmtTip(i))); hit.addEventListener('pointerleave', () => tip.hide());
      svg.append(hit);
    });
    if (avg) svg.append(svgEl('line', { x1: padL, x2: W, y1: y(avg), y2: y(avg), class: 'avgl' }), svgEl('text', { x: W - 2, y: y(avg) - 4, 'text-anchor': 'end', class: 'ax' }, T('avg {v}', { v: `${avg.toFixed(1)} ${unit}` })));
    const every = Math.ceil(n / Math.max(2, Math.floor((W - padL) / 46)));
    labels.forEach((l, i) => { if (l && (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every)) svg.append(svgEl('text', { x: i === n - 1 && n > 7 ? W - 2 : padL + band * i + band / 2, y: H - 4, 'text-anchor': i === n - 1 && n > 7 ? 'end' : 'middle', class: 'ax' }, l)); });
    svg.setAttribute('aria-label', T('{n} bars, up to {top} {unit}', { n, top, unit }));
    box.replaceChildren(svg);
  };
  let lastW = 0, lastH = 0;
  const ro = new ResizeObserver(() => { if (!box.isConnected) { if (lastW) ro.disconnect(); return; } if (Math.abs(box.clientWidth - lastW) > 3 || Math.abs(box.clientHeight - lastH) > 3) { lastW = box.clientWidth; lastH = box.clientHeight; paint(); } });
  ro.observe(box);
  return box;
}
pageTile({ id: 'en-history', page: 'energy', phoneFull: true, title: 'Day by day', icon: 'calendar', blurb: 'Energy and cost each day - 7 days on Basic, up to 90 on Pro', size: [8, 4], min: [4, 3], max: [12, 8], render(b, ctx, { w }) {
  const d = enData(ctx), all = d.days || [];
  b._span ||= d.pro ? 30 : 7;
  const span = Math.min(b._span, all.length || 7), days = all.slice(-span), have = days.filter((x) => x.kwh != null);
  if (!have.length) return enPut(b, enEmpty(T('CasaTorch notes what the house uses every 5 minutes. The first day shows here tomorrow.')));
  const full = have.filter((x) => !x.partial), avg = full.length ? full.reduce((s, x) => s + x.kwh, 0) / full.length : null, tot = have.reduce((s, x) => s + x.kwh, 0), cost = have.reduce((s, x) => s + (x.cost || 0), 0);
  const seg = el('div', { class: 'seg seg-mini' }, [[7, T('7 d')], [30, T('30 d')], [90, T('90 d')]].map(([v, l]) => el('button', { class: v === b._span ? 'on' : '', disabled: (!d.pro && v > 7) || null, title: !d.pro && v > 7 ? T('Pro keeps 2 years') : null, onclick: () => { b._span = v; this.render(b, ctx, { w }); } }, l)));
  const lab = days.map((x) => (span <= 7 ? enDay(x.date) : enDay(x.date, { month: 'short', day: 'numeric' })));
  enPut(b, 
    el('div', { class: 'en-head' }, el('div', { class: 'en-kpis' }, enStat(T('Total'), enK(tot), cost ? enMoney(d, cost) : null), avg ? enStat(T('A day, on average'), enK(avg), d.rate ? enMoney(d, avg * d.rate) : null) : null), seg),
    enColumns(days.map((x) => x.kwh), { labels: lab, partialLast: true, avg, fmtTip: (i) => { const x = days[i]; return [el('b', {}, enDay(x.date, { weekday: 'short', month: 'short', day: 'numeric' })), el('div', {}, x.kwh == null ? T('no reading') : `${enK(x.kwh)}${x.cost != null ? ` · ${enMoney(d, x.cost)}` : ''}${x.partial ? ` · ${T('so far today')}` : ''}`), x.peakW ? el('div', { class: 'muted' }, T('peak {w}', { w: enW(x.peakW) })) : null]; } }),
    d.pro ? null : el('div', { class: 'en-foot' }, T('Basic keeps 7 days. Pro keeps 2 years.')));
} });

/* ---- top consumers ---- */
pageTile({ id: 'en-top', page: 'energy', phoneFull: true, title: 'Top consumers', icon: 'plug', blurb: 'Every metered plug and device: watts now and energy today', size: [4, 4], min: [3, 3], max: [12, 10], render(b, ctx, { h, w, narrow }) {
  const d = enData(ctx), list = (d.devices || []).slice().sort((a, c) => c.todayKwh - a.todayKwh || c.w - a.w);
  if (!list.length) return enPut(b, enEmpty(T('No smart plugs with power metering yet. Shelly plugs work without Home Assistant; Kasa, Tapo and others through Home Assistant.'), '#connect', T('Connect')));
  const max = Math.max(0.001, ...list.map((x) => x.todayKwh)), rows = Math.max(2, Math.floor((h * 78 + (h - 1) * 14 - 70) / 58));
  enPut(b, el('div', { class: 'en-rank' }, list.slice(0, rows).map((x, i) => el('div', { class: 'en-rk', title: `${x.name}: ${enW(x.w)} ${T('now')} · ${enK(x.todayKwh)} ${T('today')}` },
    el('span', { class: 'en-rk-n' }, i + 1),
    el('div', { class: 'en-rk-m' }, el('div', { class: 'row between', style: 'gap:8px' }, el('span', { class: 'ellipsis' }, x.name), el('span', { class: 'num en-rk-w' }, x.w >= 1 ? el('i', { class: 'live-i' }) : null, enW(x.w))),
      el('div', { class: 'en-track' }, el('i', { class: x.ev ? 'ev' : '', style: `width:${Math.max(1.5, x.todayKwh / max * 100)}%` })),
      el('div', { class: 'tiny muted row between' }, el('span', { class: 'ellipsis' }, x.room || (x.ev ? T('Car charging') : '')), el('span', { class: 'num' }, `${enK(x.todayKwh)}${x.todayCost ? ` · ${enMoney(d, x.todayCost)}` : ''} ${T('today')}`)))))),
  list.length > rows && !(w >= 12 && !narrow) ? el('div', { class: 'en-foot' }, T('{n} more - make this tile taller to see them', { n: list.length - rows })) : null);
} });

/* ---- always on ---- */
pageTile({ id: 'en-baseload', page: 'energy', title: 'Always on', icon: 'clock', blurb: 'What never switches off - fridge, network, standby - and what it costs a year', size: [3, 2], min: [2, 2], max: [8, 4], render(b, ctx, { h }) {
  const d = enData(ctx), x = d.baseload;
  if (!x) return enPut(b, enEmpty(T('Shows after the first night: the lowest the house draws between 1 and 5 AM.')));
  enPut(b, enStat(T('Lowest overnight'), enW(x.w), [x.costYear != null ? T('{money} a year', { money: enMoney(d, x.costYear, 0) }) : T('{kwh} a year', { kwh: enK(x.kwhYear) }), x.sharePct != null ? T('{n}% of what you use', { n: x.sharePct }) : null].filter(Boolean).join(' · ')),
    h >= 3 && x.sharePct != null ? el('div', { class: 'en-meter' }, el('i', { style: `width:${x.sharePct}%` })) : null,
    h >= 3 ? el('div', { class: 'en-foot' }, T('Everything that runs with everyone asleep. Each 10 W less saves about {money} a year.', { money: d.rate ? enMoney(d, 10 * 8.76 * d.rate, 0) : '-' })) : null);
} });

/* ---- the bill this month (Pro) ---- */
pageTile({ id: 'en-bill', page: 'energy', title: 'This month', icon: 'bill', pro: true, blurb: 'The bill so far, where it is heading, and your budget', size: [3, 2], min: [3, 2], max: [12, 4], render(b, ctx, { h, w }) {
  const d = enData(ctx), f = d.forecast;
  if (!d.pro) return enPut(b, el('div', { class: 'en-lock' }, el('span', { class: 'pill pro' }, 'Pro'), el('div', { class: 'small muted' }, T('This month\'s bill forecast, against your budget.')), el('a', { class: 'btn small', href: '#settings/pro' }, T('Unlock with Pro'))));
  if (!f) return enPut(b, enEmpty(T('The forecast needs 3 days of history.')));
  const goal = f.budget && f.cost != null ? f.budget : null, scale = Math.max(f.cost ?? f.kwh, goal || 0) * 1.08, val = f.cost != null ? f.costSoFar : f.kwhSoFar, end = f.cost ?? f.kwh;
  enPut(b, 
    enStat(T('Heading for'), f.cost != null ? enMoney(d, f.cost, 0) : enK(f.kwh), [f.cost != null ? T('{money} so far', { money: enMoney(d, f.costSoFar, 0) }) : T('{kwh} so far', { kwh: enK(f.kwhSoFar) }), goal ? (f.overBudget ? T('over the {money} budget', { money: enMoney(d, goal, 0) }) : T('under the {money} budget', { money: enMoney(d, goal, 0) })) : null].filter(Boolean).join(' · '), f.overBudget ? 'warn' : ''),
    el('div', { class: 'en-goal', role: 'img', 'aria-label': T('So far, the rest of the forecast, and the budget') }, el('i', { class: 'so', style: `width:${val / scale * 100}%` }), el('i', { class: `fc${f.overBudget ? ' over' : ''}`, style: `width:${Math.max(0, end - val) / scale * 100}%` }), goal ? el('b', { style: `left:${goal / scale * 100}%` }) : null),
    h >= 3 || w >= 6 ? el('div', { class: 'en-foot' }, [T('{avg} a day lately', { avg: enK(f.avgKwhPerDay) }), T('{n} days left', { n: f.daysLeft }), f.prevMonthCost != null ? T('last month {money}', { money: enMoney(d, f.prevMonthCost, 0) }) : null].filter(Boolean).join(' · ')) : null);
} });

/* ---- this week against the one before ---- */
pageTile({ id: 'en-week-mini', page: 'energy', title: 'vs last week', icon: 'calendar', blurb: 'The last 7 days against the 7 before', size: [3, 2], min: [2, 2], max: [6, 4], render(b, ctx) {
  const d = enData(ctx), wk = d.week;
  if (!wk?.prevKwh) return enPut(b, enEmpty(T('Needs two weeks of history.')));
  enPut(b, enStat(T('Last 7 days'), el('span', {}, enK(wk.thisKwh), ' ', enDelta(wk.pct)), T('{kwh} the week before', { kwh: enK(wk.prevKwh) })),
    pgSpark(wk.this, { w: 200, h: 26, cls: 'en-grid-c', label: T('Last 7 days') }));
} });
pageTile({ id: 'en-week', page: 'energy', phoneFull: true, title: 'This week vs last', icon: 'calendar', blurb: 'Each day side by side with the same day a week earlier', size: [6, 3], min: [4, 3], max: [12, 6], render(b, ctx) {
  const d = enData(ctx), wk = d.week;
  if (!wk) return enPut(b, enEmpty(T('Needs a week of history.')));
  enPut(b, 
    el('div', { class: 'en-head' }, el('div', { class: 'row', style: 'gap:10px;align-items:baseline' }, el('b', { class: 'en-val sm' }, enK(wk.thisKwh)), enDelta(wk.pct), el('span', { class: 'tiny muted' }, wk.prevKwh ? T('vs {kwh}', { kwh: enK(wk.prevKwh) }) : '')),
      el('div', { class: 'en-legend' }, el('span', {}, el('i', { class: 'sw en-grid-bg' }), T('Last 7 days')), el('span', {}, el('i', { class: 'sw prev' }), T('The week before')))),
    enColumns(wk.this, { compare: wk.prev, labels: wk.days.map((k) => enDay(k)), fmtTip: (i) => [el('b', {}, enDay(wk.days[i], { weekday: 'long', month: 'short', day: 'numeric' })), el('div', {}, `${enK(wk.this[i])}${wk.prev[i] != null ? ` · ${T('a week earlier {kwh}', { kwh: enK(wk.prev[i]) })}` : ''}`)] }));
} });

/* ---- where today's energy came from ---- */
pageTile({ id: 'en-sources', page: 'energy', phoneFull: true, title: 'Sources', icon: 'sun', blurb: 'Hour by hour: from the grid, from solar, from the battery - and what went back', size: [8, 4], min: [4, 3], max: [12, 8], render(b, ctx) {
  const d = enData(ctx), s = d.sources;
  if (!s) return enPut(b, enEmpty(T('Shows when Home Assistant\'s Energy dashboard is set up, or solar or a battery reports power.')));
  const n = 24, t = s.totals || {}, tip = chartTip();
  const box = el('div', { class: 'en-cols-chart' });
  const paint = () => {
    const W = Math.max(240, box.clientWidth || 600), H = Math.max(90, box.clientHeight || 160), padL = 30, padB = 18;
    const up = Array.from({ length: n }, (_, i) => (s.import[i] || 0) + (s.solar[i] || 0) + (s.battOut[i] || 0)), down = s.export || [];
    const top = Math.max(0.1, ...up), low = Math.max(0, ...down), share = low ? Math.min(0.4, low / (top + low)) : 0;
    const base = 6 + (H - padB - 6) * (1 - share), yU = (v) => (v / top) * (base - 8), yD = (v) => (low ? (v / low) * (H - padB - base - 4) : 0), band = (W - padL) / n, bw = Math.min(22, band * 0.7);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'en-chart', role: 'img', 'aria-label': T('Energy by hour and where it came from') });
    svg.append(svgEl('line', { x1: padL, x2: W, y1: base, y2: base, class: 'gl' }), svgEl('text', { x: padL - 5, y: 12, 'text-anchor': 'end', class: 'ax' }, top >= 1 ? top.toFixed(1) : top.toFixed(2)), svgEl('text', { x: padL - 5, y: base + 4, 'text-anchor': 'end', class: 'ax' }, '0'));
    for (let i = 0; i < n; i++) {
      const x = padL + band * i + (band - bw) / 2; let y = base;
      for (const [k, c] of [['import', 'en-grid-f'], ['solar', 'en-solar-f'], ['battOut', 'en-batt-f']]) { const hh = yU(s[k]?.[i] || 0); if (hh > 0.4) { y -= hh; svg.append(svgEl('rect', { x, y: y + 1, width: bw, height: Math.max(0.5, hh - 1.5), rx: 2, class: c })); } }
      const e = down[i] || 0; if (e > 0) svg.append(svgEl('rect', { x, y: base + 1.5, width: bw, height: Math.max(0.6, yD(e)), rx: 2, class: 'en-export-f' }));
      const hit = svgEl('rect', { x: padL + band * i, y: 0, width: band, height: H, class: 'hit' });
      hit.addEventListener('pointermove', (ev) => tip.show(ev, [el('b', {}, enHour(i)), ...[['import', T('From the grid')], ['solar', T('Solar')], ['battOut', T('From the battery')], ['export', T('Sent back')]].filter(([k]) => (s[k]?.[i] || 0) > 0.005).map(([k, l]) => el('div', {}, `${l}: ${enK(s[k][i])}`))]));
      hit.addEventListener('pointerleave', () => tip.hide()); svg.append(hit);
      if (i % 6 === 0) svg.append(svgEl('text', { x: padL + band * i + band / 2, y: H - 4, 'text-anchor': 'middle', class: 'ax' }, enHour(i)));
    }
    box.replaceChildren(svg);
  };
  let lw = 0, lh = 0; const ro = new ResizeObserver(() => { if (!box.isConnected) { if (lw) ro.disconnect(); return; } if (Math.abs(box.clientWidth - lw) > 3 || Math.abs(box.clientHeight - lh) > 3) { lw = box.clientWidth; lh = box.clientHeight; paint(); } }); ro.observe(box);
  const lg = (cls, label, v) => el('span', {}, el('i', { class: `sw ${cls}` }), label, v != null ? el('b', {}, ` ${enK(v)}`) : null);
  enPut(b, 
    el('div', { class: 'en-head' }, el('div', { class: 'en-kpis' }, enStat(T('Used today'), enK(t.used)), s.selfPct != null ? enStat(T('Self-powered'), `${s.selfPct}%`) : null), s.from === 'ha' ? el('span', { class: 'pill ha' }, 'Home Assistant') : null),
    box,
    el('div', { class: 'en-legend' }, lg('en-grid-bg', T('Grid'), t.import), s.has?.solar !== false && t.solar != null ? lg('en-solar-bg', T('Solar'), t.solar) : null, s.has?.battery ? lg('en-batt-bg', T('Battery'), t.battOut) : null, t.export ? lg('en-export-bg', T('Sent back'), t.export) : null));
} });

/* ---- solar and battery ---- */
pageTile({ id: 'en-solar', page: 'energy', title: 'Solar', icon: 'sun', blurb: 'What your panels make now and today, and how much went back', size: [4, 2], min: [2, 2], max: [8, 4], render(b, ctx, { w }) {
  const d = enData(ctx), n = d.now || {}, s = d.sources;
  if (n.solarW == null && !s?.totals?.solar) return enPut(b, enEmpty(T('No solar seen yet.')));
  enPut(b, el('div', { class: 'row between', style: 'align-items:flex-start;gap:12px' },
    enStat(T('Now'), enW(n.solarW), s?.totals?.solar != null ? T('{kwh} today', { kwh: enK(s.totals.solar) }) : null),
    w >= 4 && s?.totals?.export ? enStat(T('Sent back'), enK(s.totals.export), d.co2?.savedKg ? T('{kg} kg CO₂ avoided', { kg: d.co2.savedKg }) : null) : null),
  s?.solar ? pgSpark(s.solar, { w: 300, h: 28, cls: 'en-solar-c', label: T('Solar today') }) : null);
} });
pageTile({ id: 'en-battery', page: 'energy', title: 'Home battery', icon: 'battery', blurb: 'Charge, and whether it is filling up or powering the house', size: [4, 2], min: [2, 2], max: [8, 4], render(b, ctx) {
  const d = enData(ctx), x = d.now?.battery;
  if (!x) return enPut(b, enEmpty(T('No home battery seen yet.')));
  const pct = x.pct ?? null, C = 2 * Math.PI * 26;
  const ring = svgEl('svg', { viewBox: '0 0 64 64', class: 'en-ringg', role: 'img', 'aria-label': pct != null ? `${pct}%` : '' }, svgEl('circle', { cx: 32, cy: 32, r: 26, class: 'trk' }), svgEl('circle', { cx: 32, cy: 32, r: 26, class: 'val', 'stroke-dasharray': `${C * (pct || 0) / 100} ${C}`, transform: 'rotate(-90 32 32)' }), svgEl('text', { x: 32, y: 37, 'text-anchor': 'middle' }, pct != null ? `${pct}%` : '-'));
  const state = x.w > 20 ? T('Powering the house: {w}', { w: enW(x.w) }) : x.w < -20 ? T('Charging: {w}', { w: enW(-x.w) }) : pct >= 97 ? T('Full') : T('Standing by');
  const t = d.sources?.totals;
  enPut(b, el('div', { class: 'row', style: 'gap:14px;align-items:center' }, ring, el('div', { style: 'min-width:0' }, el('b', {}, state), t ? el('div', { class: 'en-sub' }, T('{in} in · {out} out today', { in: enK(t.battIn || 0), out: enK(t.battOut || 0) })) : null)));
} });

/* ---- the week, hour by hour ---- */
pageTile({ id: 'en-heatmap', page: 'energy', phoneFull: true, title: 'Hour by hour', icon: 'grid', blurb: 'The last 7 days as a heatmap - when the house uses the most', size: [8, 4], min: [4, 3], max: [12, 8], render(b, ctx, { narrow }) {
  const d = enData(ctx), heat = d.heat;
  if (!heat) return enPut(b, enEmpty(T('Fills in hour by hour as CasaTorch runs - a full picture after a week.')));
  const all = heat.flatMap((x) => x.hours).filter((v) => v != null), max = Math.max(0.01, ...all), tip = chartTip();
  const avg = Array.from({ length: 24 }, (_, h) => { const v = heat.map((x) => x.hours[h]).filter((y) => y != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : 0; });
  const busiest = avg.indexOf(Math.max(...avg));
  const grid = el('div', { class: 'en-heat', role: 'img', 'aria-label': T('Energy for each hour of the last 7 days') });
  grid.append(el('span'));
  for (let h = 0; h < 24; h++) grid.append(el('span', { class: 'hh' }, h % (narrow ? 6 : 3) === 0 ? enHour(h).replace(/:00/, '') : ''));
  for (const day of heat) {
    grid.append(el('span', { class: 'hd' }, enDay(day.date)));
    day.hours.forEach((v, h) => {
      const step = v == null ? -1 : Math.min(5, Math.floor(Math.sqrt(v / max) * 6));
      const c = el('span', { class: `hc s${step}` });
      c.addEventListener('pointermove', (e) => tip.show(e, [el('b', {}, `${enDay(day.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${enHour(h)}`), el('div', {}, v == null ? T('no reading') : `${enK(v)}${d.rate ? ` · ${enMoney(d, v * d.rate)}` : ''}`)]));
      c.addEventListener('pointerleave', () => tip.hide());
      grid.append(c);
    });
  }
  enPut(b, grid, el('div', { class: 'en-foot row between' }, el('span', {}, T('Busiest hour: {hour}', { hour: enHour(busiest) })), el('span', { class: 'en-scale' }, T('less'), ...[0, 1, 2, 3, 4, 5].map((k) => el('i', { class: `hc s${k}` })), T('more'))));
} });

/* ---- by room ---- */
pageTile({ id: 'en-rooms', page: 'energy', phoneFull: true, title: 'By room', icon: 'home', blurb: 'Energy today per room, from Home Assistant areas or your 3D Home', size: [4, 4], min: [3, 3], max: [12, 8], render(b, ctx, { h }) {
  const d = enData(ctx), rooms = (d.rooms || []).filter((r) => r.n);
  if (!rooms.length) return enPut(b, enEmpty(T('Put devices in rooms (areas in Home Assistant, or pins on the 3D Home) to see this.')));
  const max = Math.max(0.001, ...rooms.map((r) => r.todayKwh)), tot = rooms.reduce((s, r) => s + r.todayKwh, 0), rows = Math.max(2, Math.floor((h * 78 + (h - 1) * 14 - 40) / 56));
  enPut(b, el('div', { class: 'en-rank' }, rooms.slice(0, rows).map((r) => el('div', { class: 'en-rk' },
    el('div', { class: 'en-rk-m' }, el('div', { class: 'row between', style: 'gap:8px' }, el('span', { class: 'ellipsis' }, r.name || (r.ev ? T('Car charging') : T('Not in a room'))), el('span', { class: 'num' }, enK(r.todayKwh), el('span', { class: 'muted' }, tot ? ` · ${Math.round(r.todayKwh / tot * 100)}%` : ''))),
      el('div', { class: 'en-track' }, el('i', { style: `width:${Math.max(1.5, r.todayKwh / max * 100)}%` })),
      el('div', { class: 'tiny muted' }, T('{w} now · {n} devices', { w: enW(r.w), n: r.n })))))));
} });

/* ---- peak and off-peak ---- */
pageTile({ id: 'en-tou', page: 'energy', phoneFull: true, title: 'Peak hours', icon: 'clock', blurb: 'How much you use when power costs the most', size: [3, 3], min: [3, 2], max: [8, 4], render(b, ctx) {
  const d = enData(ctx), x = d.tariff;
  if (!x) return enPut(b, enEmpty(T('Add your peak hours in Energy settings.')));
  const span = T('{from} to {to}', { from: enHour(x.from), to: enHour(x.to) });
  enPut(b, 
    el('div', { class: 'row between', style: 'gap:8px' }, el('span', { class: `pill ${x.now === 'peak' ? 'warn' : 'good'}` }, x.now === 'peak' ? T('Peak price now') : T('Off-peak now')), el('span', { class: 'tiny muted' }, span)),
    enStat(T('Used at peak, last 7 days'), x.peakPct != null ? `${x.peakPct}%` : '-', x.peakKwh != null ? T('{kwh} of {total}', { kwh: enK(x.peakKwh), total: enK(x.totalKwh) }) : null),
    x.peakPct != null ? el('div', { class: 'en-meter warnm' }, el('i', { style: `width:${x.peakPct}%` })) : null,
    x.shiftSaves ? el('div', { class: 'en-foot' }, T('Moving a quarter of it to cheaper hours saves about {money} a week.', { money: enMoney(d, x.shiftSaves) })) : null);
} });

/* ---- carbon ---- */
pageTile({ id: 'en-co2', page: 'energy', phoneFull: true, title: 'Carbon', icon: 'leaf', blurb: 'An estimate of the CO₂ behind the power you buy', size: [3, 3], min: [2, 2], max: [8, 4], render(b, ctx) {
  const d = enData(ctx), x = d.co2;
  if (!x) return enPut(b, enEmpty(T('Add your grid\'s carbon intensity in Energy settings.')));
  enPut(b, enStat(T('Today, about'), `${x.todayKg} kg`, T('CO₂ at {g} g per kWh', { g: x.gPerKwh })),
    el('div', { class: 'en-kpis', style: 'margin-top:8px' }, x.weekKg != null ? enStat(T('7 days'), `${x.weekKg} kg`, null, 'sm') : null, x.savedKg ? enStat(T('Avoided by solar'), `${x.savedKg} kg`, null, 'sm good') : null),
    el('div', { class: 'en-foot' }, x.from === 'set' ? T('From the carbon intensity you set.') : x.from === 'demo' ? T('Sample figure in the demo.') : T('From {sensor}', { sensor: x.from })));
} });

/* ---- standby waste ---- */
pageTile({ id: 'en-standby', page: 'energy', phoneFull: true, title: 'Standby waste', icon: 'plug', blurb: 'Devices that keep drawing power when nobody uses them - and what it costs', size: [6, 3], min: [3, 2], max: [12, 6], render(b, ctx) {
  const d = enData(ctx), list = d.standby || [];
  if (!list.length) return enPut(b, el('div', { class: 'allclear' }, el('div', {}, icon('checkc'), el('div', { class: 'small muted', style: 'margin-top:6px' }, T('Nothing wasteful found. CasaTorch checks every metered plug overnight.')))));
  const tot = list.reduce((s, x) => s + (x.costYear || 0), 0);
  enPut(b, el('div', { class: 'en-tips' }, list.map((x) => el('div', { class: 'en-tip' }, el('span', { class: 'en-tip-ic' }, icon('plug', 16)),
    el('div', { class: 'grow' }, el('div', {}, x.why === 'off' ? T('{name} draws {w} while switched off', { name: x.name, w: enW(x.w) }) : T('{name} draws {w} when nobody uses it', { name: x.name, w: enW(x.w) })),
      el('div', { class: 'tiny muted' }, x.costYear != null ? T('About {money} a year. A smart plug schedule that switches it off overnight would save most of it.', { money: enMoney(d, x.costYear, 0) }) : T('About {kwh} a year.', { kwh: enK(x.kwhYear) }))),
    x.costYear != null ? el('b', { class: 'num' }, `${enMoney(d, x.costYear, 0)}/${T('yr')}`) : null))),
  tot && list.length > 1 ? el('div', { class: 'en-foot' }, T('Together: about {money} a year.', { money: enMoney(d, tot, 0) })) : null);
} });

/* ---- one device ---- */
pageTile({ id: 'en-dev', page: 'energy', title: 'Device', icon: 'plug', multi: true, askFirst: true, blurb: 'One plug or device: watts now, the last 24 hours, and today', size: [3, 2], min: [2, 2], max: [8, 4],
  options: [{ key: 'device', type: 'device', label: 'Which device', filter: (x) => typeof x.powerW === 'number', empty: 'No metered devices yet.' }],
  render(b, ctx, { h }) {
    const d = enData(ctx), id = b._t?.device || optsOf(b._t || {}).device, x = (d.devices || []).find((y) => y.id === id);
    if (!x) return enPut(b, enEmpty(id ? T('This device isn\'t reporting power right now.') : T('Pick a device: tap the sliders while editing.')));
    if (b._t && !b._t.title && x.name) { const ttl = b.closest('.tile')?.querySelector('.ttl'); if (ttl) ttl.textContent = x.name; }
    enPut(b, el('div', { class: 'row between', style: 'align-items:flex-end;gap:8px' }, enStat(x.room || T('Now'), enW(x.w), `${enK(x.todayKwh)} ${T('today')}${x.todayCost ? ` · ${enMoney(d, x.todayCost)}` : ''}`), x.on === false ? el('span', { class: 'pill' }, T('Off')) : null),
      pgSpark(x.spark || [], { w: 300, h: h >= 3 ? 60 : 30, cls: x.ev ? 'en-ev-c' : 'en-grid-c', label: T('The last 24 hours') }));
  } });

/* ---- the weekly report (Pro) ---- */
pageTile({ id: 'en-report', page: 'energy', phoneFull: true, title: 'Weekly report', icon: 'news', pro: true, blurb: 'Every Monday: the week in a few sentences, with tips', size: [6, 5], min: [4, 3], max: [12, 10], noPreview: true, bare: true, render(b, ctx) {
  const d = enData(ctx), money = (v) => enMoney(d, v);
  const card = reportCard(ctx.data?.reports || { pro: false, reports: [] }, money, () => ctx.refresh?.());
  card.classList.remove('card'); card.classList.add('en-report');
  enPut(b, card);
} });

/* ---- getting more from this page ---- */
pageTile({ id: 'en-start', page: 'energy', phoneFull: true, title: 'Get the most from Energy', icon: 'spark', blurb: 'What to connect for more on this page', size: [8, 4], min: [4, 3], max: [12, 8], render(b, ctx) {
  const d = enData(ctx), metered = (d.devices || []).length;
  const step = (done, title, text, href, label) => el('div', { class: `en-step${done ? ' done' : ''}` }, el('span', { class: 'en-step-ic' }, icon(done ? 'check' : 'plus', 16)), el('div', { class: 'grow' }, el('b', {}, title), el('div', { class: 'tiny muted' }, text)), !done && href ? el('a', { class: 'btn small', href, onclick: href === '#energy-settings' ? (e) => { e.preventDefault(); energySettings(ctx); } : null }, label) : null);
  enPut(b, el('div', { class: 'en-steps' },
    step(metered > 0, T('Smart plugs that measure power'), metered ? T('{n} reporting', { n: metered }) : T('Shelly plugs work without Home Assistant; Kasa, Tapo and others through Home Assistant.'), '#connect', T('Connect')),
    step(!!d.rate, T('Your electricity price'), d.rate ? T('{money} per kWh', { money: enMoney(d, d.rate, 3) }) : T('So every number shows what it costs.'), '#energy-settings', T('Set price')),
    step(!!d.ha || d.now?.solarW != null, T('Solar, battery and your meter'), T('Through Home Assistant\'s Energy dashboard - CasaTorch reads it as it is.'), '#connect', T('Connect')),
    step(!!d.tariff, T('Peak hours'), T('If your power costs more at some hours.'), '#energy-settings', T('Add'))));
} });

/* Energy settings: price, budget, peak hours, the grid's carbon. Admins only. */
function energySettings(ctx) {
  const st = S.settings?.energy || {}, d = enData(ctx), e = d.tariff || {};
  const inp = (attrs) => el('input', { type: 'number', step: 'any', min: 0, style: 'max-width:160px', ...attrs });
  const rate = inp({ value: st.ratePerKwh ?? '', placeholder: '0.17' }), budget = inp({ value: st.budget ?? '', placeholder: '150' });
  const hourSel = (v) => el('select', { style: 'width:auto' }, el('option', { value: '' }, '-'), Array.from({ length: 24 }, (_, h) => el('option', { value: h, selected: v === h || null }, enHour(h))));
  const from = hourSel(d.demo ? null : e.from ?? null), to = hourSel(d.demo ? null : e.to ?? null), peak = inp({ value: d.demo ? '' : e.peakRate ?? '', placeholder: '0.38' });
  const co2 = inp({ value: d.demo ? '' : d.co2?.from === 'set' ? d.co2.gPerKwh : '', placeholder: '380' });
  const msg = el('p', { class: 'small', style: 'min-height:1.2em' });
  const field = (label, node, help) => el('label', { class: 'field' }, el('span', {}, label), node, help ? el('span', { class: 'tiny muted' }, help) : null);
  const save = el('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true; msg.textContent = '';
    try {
      const body = { ratePerKwh: rate.value === '' ? null : Number(rate.value), budget: budget.value === '' ? null : Number(budget.value), co2gPerKwh: co2.value === '' ? null : Number(co2.value), peak: from.value !== '' && to.value !== '' ? { from: Number(from.value), to: Number(to.value), rate: peak.value === '' ? null : Number(peak.value) } : null };
      await post('/api/energy/prefs', body, 'PUT'); S.settings = await api('/api/settings').catch(() => S.settings); m.remove(); toast(T('Energy settings saved')); ctx.refresh?.();
    } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--bad)'; save.disabled = false; }
  } }, T('Save'));
  const m = modal(el('div', {},
    field(T('Electricity price ({cur} per kWh)', { cur: enCur(S.settings?.energy?.currency) }), rate),
    field(T('Monthly budget'), budget, T('The bill forecast shows how this month compares.')),
    el('div', { class: 'field' }, el('span', {}, T('Peak hours (if power costs more then)')), el('div', { class: 'row wrap', style: 'gap:8px' }, from, el('span', { class: 'muted' }, T('to')), to, peak), el('span', { class: 'tiny muted' }, T('Start, end, and the peak price per kWh.'))),
    field(T('Grid carbon intensity (g CO₂ per kWh)'), co2, T('Your utility\'s figure, or about 380 for the US average. A Home Assistant carbon sensor is used by itself.')),
    d.demo ? el('p', { class: 'small muted' }, T('The demo uses sample prices; settings can\'t be saved here.')) : null,
    msg, el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')), save)), { title: T('Energy settings') });
  if (d.demo) save.disabled = true;
}

async function energyPage(main) {
  const load = async () => { const [en, reports] = await Promise.all([api('/api/energy/overview'), api('/api/reports').catch(() => ({ pro: false, reports: [] }))]); return { en, reports }; };
  const role = (S.me ||= await api('/api/auth/me').catch(() => ({})))?.user?.role;
  const settingsBtn = !role || ['owner', 'admin'].includes(role) ? el('button', { class: 'btn', title: T('Energy settings'), onclick: () => energySettings(pageCtx(main) || {}) }, icon('gear'), el('span', { class: 'hide-phone' }, T('Energy settings'))) : null;
  return pageGrid(main, { page: 'energy', title: tabLabel({ id: 'energy', label: T('Energy') }), sub: T('Live, and everything your meters and plugs have seen'), load, actions: [settingsBtn].filter(Boolean) });
}
/* The ctx a page grid's tiles draw from (kept on the grid element by pageGrid). */
const pageCtx = (main) => main.querySelector('.grid')?._ctx || null;
