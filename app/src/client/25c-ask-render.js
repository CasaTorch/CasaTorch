/* ---- Home AI Agent answers on screen: Markdown, charts, tables, tiles, device chips, sources and the offer.
   Everything the AI wrote is checked again here (the server checks it first, 70b-ask-format.js) and built as DOM nodes
   from plain text: no HTML from an answer ever reaches the page, links open only http(s), and colors come from the
   theme, never from the AI. Charts are inline SVG. ---- */
const ASK_CHART_KINDS = ['line', 'bar', 'area', 'pie'];
const askS = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').slice(0, max);
const askN = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/* A chart spec the screen will draw, or null. Same limits as the server: 60 points, 3 series (a pie: 6 slices). */
function askChartOk(spec) {
  if (!spec || typeof spec !== 'object' || !ASK_CHART_KINDS.includes(spec.type)) return null;
  const x = (Array.isArray(spec.x) ? spec.x : []).slice(0, spec.type === 'pie' ? 6 : 60).map((v) => askS(v, 24));
  const series = (Array.isArray(spec.series) ? spec.series : []).slice(0, spec.type === 'pie' ? 1 : 3).filter((s) => s && typeof s === 'object')
    .map((s, i) => ({ name: askS(s.name, 40) || `${i + 1}`, values: x.map((_, k) => askN(Array.isArray(s.values) ? s.values[k] : null)) })).filter((s) => s.values.some((v) => v !== null));
  if (!x.length || !series.length) return null;
  if (spec.type === 'pie' && !series[0].values.some((v) => v > 0)) return null;
  return { type: spec.type, title: askS(spec.title, 80), unit: askS(spec.unit, 12), x, series };
}
const askFmtNum = (v) => (v == null ? '-' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
/* Inline Markdown: **bold**, *italic*, `code`, [text](http link) and bare https links - as text nodes and elements. */
function askInline(text) {
  const out = []; const s = askS(text, 8000);
  const RE = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]{1,200})\]\(([^)\s]{1,800})\)|(https?:\/\/[^\s<>()]{3,800}[^\s<>().,;:!?'"])|\*([^*\s][^*]*)\*/g;
  let at = 0, m;
  while ((m = RE.exec(s))) {
    if (m.index > at) out.push(document.createTextNode(s.slice(at, m.index)));
    if (m[1] || m[2]) out.push(el('strong', {}, m[1] || m[2]));
    else if (m[3]) out.push(el('code', {}, m[3]));
    else if (m[4]) { const href = /^https?:/i.test(m[5]) ? safeHref(m[5]) : null; out.push(href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, m[4]) : document.createTextNode(m[4])); }
    else if (m[6]) { const href = safeHref(m[6]); out.push(href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, m[6].replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)) : document.createTextNode(m[6])); }
    else if (m[7]) out.push(el('em', {}, m[7]));
    at = RE.lastIndex;
  }
  if (at < s.length) out.push(document.createTextNode(s.slice(at)));
  return out;
}
/* Block Markdown: headings, bullet and numbered lists, paragraphs. Anything else is plain text. */
function askMd(text) {
  const box = el('div', { class: 'ask-md' }); let list = null, para = [];
  const flush = () => { if (para.length) { const p = el('p'); para.forEach((l, i) => { if (i) p.append(el('br')); p.append(...askInline(l)); }); box.append(p); para = []; } };
  for (const raw of askS(text, 12000).split('\n')) {
    const line = raw.replace(/\s+$/, ''), h = line.match(/^#{1,6}\s+(.*)/), ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d{1,2}[.)]\s+(.*)/);
    if (!line.trim()) { flush(); list = null; continue; }
    if (h) { flush(); list = null; box.append(el('div', { class: 'ask-h' }, ...askInline(h[1].replace(/\*\*/g, '')))); continue; }
    if (ul || ol) { flush(); const tag = ul ? 'ul' : 'ol'; if (!list || list.tagName.toLowerCase() !== tag) { list = el(tag); box.append(list); } list.append(el('li', {}, ...askInline((ul || ol)[1]))); continue; }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) { flush(); list = null; continue; }
    list = null; para.push(line);
  }
  flush();
  return box;
}
const ASK_SVGNS = 'http://www.w3.org/2000/svg';
const askSv = (tag, attrs = {}, text) => { const e = document.createElementNS(ASK_SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v)); if (text != null) e.textContent = String(text); return e; };
/* Round numbers for the y axis: 0, 5, 10, 15... */
function askTicks(lo, hi, n = 4) {
  if (hi === lo) { hi = lo + 1; }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) || mag * 10;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
function askChartEl(rawSpec) {
  const spec = askChartOk(rawSpec); if (!spec) return null;
  const fig = el('figure', { class: 'ask-chart' }), unit = spec.unit ? ` ${spec.unit}` : '';
  if (spec.title) fig.append(el('figcaption', {}, spec.title, spec.unit ? el('span', { class: 'faint' }, ` · ${spec.unit}`) : null));
  const tip = el('div', { class: 'ask-tip', hidden: true });
  const W = Math.round(Math.max(320, Math.min(640, (window.innerWidth || 640) - 90))), H = spec.type === 'pie' ? 220 : W < 480 ? 200 : 230;   // drawn at about its real size, so the labels stay readable on a phone
  const svg = askSv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${spec.title || T('Chart')}: ${spec.series.map((s) => s.name).join(', ')}` });
  const showTip = (evt, rows) => { tip.replaceChildren(...rows.map((r, i) => el('div', { class: i ? 'ask-tip-row' : 'ask-tip-head' }, r))); tip.hidden = false; const b = fig.getBoundingClientRect(); tip.style.left = `${Math.min(b.width - 170, Math.max(0, evt.clientX - b.left + 12))}px`; tip.style.top = `${Math.max(0, evt.clientY - b.top - 10)}px`; };
  const hideTip = () => { tip.hidden = true; };
  if (spec.type === 'pie') {
    const vals = spec.series[0].values.map((v) => Math.max(0, v || 0)), total = vals.reduce((s, v) => s + v, 0);
    const cx = W < 480 ? 88 : 120, cy = 110, R = W < 480 ? 74 : 92, r = W < 480 ? 46 : 56; let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (!v) return; const a1 = a0 + (v / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, gap = vals.filter(Boolean).length > 1 ? 0.012 : 0;
      const p = (rad, ang) => `${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`;
      const d = (a1 - a0) >= Math.PI * 2 - 0.001 ? `M ${cx - R} ${cy} a ${R} ${R} 0 1 0 ${R * 2} 0 a ${R} ${R} 0 1 0 ${-R * 2} 0 M ${cx - r} ${cy} a ${r} ${r} 0 1 1 ${r * 2} 0 a ${r} ${r} 0 1 1 ${-r * 2} 0`
        : `M ${p(R, a0 + gap)} A ${R} ${R} 0 ${big} 1 ${p(R, a1 - gap)} L ${p(r, a1 - gap)} A ${r} ${r} 0 ${big} 0 ${p(r, a0 + gap)} Z`;
      const seg = askSv('path', { d, class: `ak s${i}`, 'fill-rule': 'evenodd' });
      seg.addEventListener('pointermove', (e) => showTip(e, [spec.x[i], `${askFmtNum(v)}${unit} · ${Math.round(v / total * 100)}%`])); seg.addEventListener('pointerleave', hideTip);
      svg.append(seg); a0 = a1;
    });
    svg.append(askSv('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'ak-big' }, askFmtNum(total)), askSv('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'ak-lbl' }, spec.unit || T('total')));
    const narrow = W < 480;
    vals.forEach((v, i) => { const y = (narrow ? 22 : 30) + i * (narrow ? 33 : 28), lx = narrow ? 178 : 260; svg.append(askSv('rect', { x: lx, y: y - 10, width: 12, height: 12, rx: 3, class: `ak s${i}` }), askSv('text', { x: lx + 20, y, class: 'ak-lbl' }, `${spec.x[i]}`.slice(0, narrow ? 14 : 24)), askSv('text', narrow ? { x: lx + 20, y: y + 15, class: 'ak-val' } : { x: W - 12, y, 'text-anchor': 'end', class: 'ak-val' }, `${askFmtNum(v)}${unit} · ${total ? Math.round(v / total * 100) : 0}%`)); });
  } else if (spec.type === 'bar' && spec.x.length <= 15 && spec.x.some((x) => x.length * 6.5 > (W - 60) / spec.x.length)) {
    /* names that don't fit under the bars: the bars lie down, one row each, with the name and the value beside it */
    const k = spec.series.length, rowH = 12 + k * 12, LBL = W < 480 ? 104 : 170, VAL = 64, bw = W - LBL - VAL - 8, H2 = spec.x.length * rowH + 8;
    svg.setAttribute('viewBox', `0 0 ${W} ${H2}`);
    const all = spec.series.flatMap((s) => s.values).filter((v) => v !== null), hi = Math.max(0, ...all), lo = Math.min(0, ...all), sx = (v) => LBL + ((v - lo) / (hi - lo || 1)) * bw;
    svg.append(askSv('line', { x1: sx(0), x2: sx(0), y1: 2, y2: H2 - 4, class: 'ak-base' }));
    spec.x.forEach((lab, i) => {
      const y0 = 4 + i * rowH, max = W < 480 ? 15 : 24;
      svg.append(askSv('text', { x: LBL - 8, y: y0 + rowH / 2 + 2, 'text-anchor': 'end', class: 'ak-lbl' }, lab.length > max ? `${lab.slice(0, max - 1)}…` : lab));
      spec.series.forEach((ser, si) => {
        const v = ser.values[i]; if (v === null) return; const a = sx(Math.min(0, v)), b = sx(Math.max(0, v)), y = y0 + 4 + si * 12, w = Math.max(1, b - a), rr = Math.min(4, w / 2);
        svg.append(askSv('path', { d: v >= 0 ? `M ${a} ${y} H ${b - rr} Q ${b} ${y} ${b} ${y + rr} V ${y + 10 - rr} Q ${b} ${y + 10} ${b - rr} ${y + 10} H ${a} Z` : `M ${b} ${y} H ${a + rr} Q ${a} ${y} ${a} ${y + rr} V ${y + 10 - rr} Q ${a} ${y + 10} ${a + rr} ${y + 10} H ${b} Z`, class: `ak s${si}` }));
        svg.append(askSv('text', { x: b + 6, y: y + 9, class: 'ak-val' }, `${askFmtNum(v)}`));
      });
      const hit = askSv('rect', { x: 0, y: y0, width: W, height: rowH, fill: 'transparent' });
      hit.addEventListener('pointermove', (e) => showTip(e, [lab, ...spec.series.map((ser) => `${k > 1 ? `${ser.name}: ` : ''}${askFmtNum(ser.values[i])}${ser.values[i] == null ? '' : unit}`)])); hit.addEventListener('pointerleave', hideTip);
      svg.append(hit);
    });
  } else {
    const L = W < 480 ? 36 : 46, Rp = 12, Tp = 12, B = 30, iw = W - L - Rp, ih = H - Tp - B, n = spec.x.length;
    const all = spec.series.flatMap((s) => s.values).filter((v) => v !== null);
    const lo0 = Math.min(0, ...all), hi0 = Math.max(...all), ticks = askTicks(spec.type === 'bar' || spec.type === 'area' ? Math.min(0, lo0) : Math.min(...all), hi0), lo = ticks[0], hi = ticks.at(-1);
    const y = (v) => Tp + ih - ((v - lo) / (hi - lo || 1)) * ih;
    for (const t of ticks) svg.append(askSv('line', { x1: L, x2: W - Rp, y1: y(t), y2: y(t), class: t === 0 ? 'ak-base' : 'ak-grid' }), askSv('text', { x: L - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'ak-lbl' }, askFmtNum(t)));
    const band = iw / n, xc = (i) => L + band * i + band / 2, every = Math.ceil(n / (W < 480 ? 5 : 8));
    spec.x.forEach((lab, i) => { if (i % every === 0 || i === n - 1 && n <= 16) svg.append(askSv('text', { x: xc(i), y: H - 10, 'text-anchor': 'middle', class: 'ak-lbl' }, lab.length > 12 ? `${lab.slice(0, 11)}…` : lab)); });
    if (spec.type === 'bar') {
      const k = spec.series.length, gw = Math.min(band * 0.72, 26 * k + 2 * (k - 1)), bw = Math.max(2, (gw - 2 * (k - 1)) / k);
      spec.series.forEach((s, si) => s.values.forEach((v, i) => {
        if (v === null) return; const x0 = xc(i) - gw / 2 + si * (bw + 2), y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v)), h = Math.max(1, y1 - y0), rr = Math.min(4, bw / 2, h);
        const d = v >= 0 ? `M ${x0} ${y1} V ${y0 + rr} Q ${x0} ${y0} ${x0 + rr} ${y0} H ${x0 + bw - rr} Q ${x0 + bw} ${y0} ${x0 + bw} ${y0 + rr} V ${y1} Z` : `M ${x0} ${y0} V ${y1 - rr} Q ${x0} ${y1} ${x0 + rr} ${y1} H ${x0 + bw - rr} Q ${x0 + bw} ${y1} ${x0 + bw} ${y1 - rr} V ${y0} Z`;
        svg.append(askSv('path', { d, class: `ak s${si}` }));
      }));
    } else {
      spec.series.forEach((s, si) => {
        const pts = s.values.map((v, i) => (v === null ? null : [xc(i), y(v)]));
        const runs = []; let cur = []; for (const p of pts) { if (p) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } } if (cur.length) runs.push(cur);
        for (const r of runs) {
          if (spec.type === 'area' && r.length > 1) svg.append(askSv('path', { d: `M ${r[0][0]} ${y(Math.max(lo, 0))} ${r.map((p) => `L ${p[0]} ${p[1]}`).join(' ')} L ${r.at(-1)[0]} ${y(Math.max(lo, 0))} Z`, class: `ak-fill s${si}` }));
          svg.append(askSv('path', { d: r.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' '), class: `ak-line s${si}` }));
          if (n <= 16 || r.length === 1) for (const p of r) svg.append(askSv('circle', { cx: p[0], cy: p[1], r: 4, class: `ak-dot s${si}` }));
        }
      });
    }
    const cross = askSv('line', { y1: Tp, y2: Tp + ih, class: 'ak-cross', visibility: 'hidden' }); svg.append(cross);
    const hit = askSv('rect', { x: L, y: Tp, width: iw, height: ih, fill: 'transparent' });
    hit.addEventListener('pointermove', (e) => {
      const b = svg.getBoundingClientRect(), px = (e.clientX - b.left) * (W / b.width), i = Math.max(0, Math.min(n - 1, Math.floor((px - L) / band)));
      cross.setAttribute('x1', xc(i)); cross.setAttribute('x2', xc(i)); cross.setAttribute('visibility', spec.type === 'bar' ? 'hidden' : 'visible');
      showTip(e, [spec.x[i], ...spec.series.map((s) => `${spec.series.length > 1 ? `${s.name}: ` : ''}${askFmtNum(s.values[i])}${s.values[i] == null ? '' : unit}`)]);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    svg.append(hit);
  }
  fig.append(el('div', { class: 'ask-plot' }, svg, tip));
  if (spec.type !== 'pie' && spec.series.length > 1) fig.append(el('div', { class: 'ask-legend' }, spec.series.map((s, i) => el('span', {}, el('i', { class: `ak-key s${i}` }), s.name))));
  // the same numbers as a table, one tap away
  const tableBtn = el('button', { class: 'btn ghost small ask-tbtn', type: 'button' }, icon('list', 14), T('Show as table'));
  tableBtn.onclick = () => { const open = fig.querySelector('.ask-table'); if (open) { open.remove(); tableBtn.lastChild.textContent = T('Show as table'); return; } fig.append(askTableEl({ columns: ['', ...spec.series.map((s) => `${s.name}${unit}`)], rows: spec.x.map((x, i) => [x, ...spec.series.map((s) => askFmtNum(s.values[i]))]) })); tableBtn.lastChild.textContent = T('Hide table'); };
  fig.append(tableBtn);
  return fig;
}
function askTableEl(t) {
  const cols = (Array.isArray(t?.columns) ? t.columns : []).slice(0, 8).map((c) => askS(c, 40)); if (!cols.length) return null;
  const rows = (Array.isArray(t.rows) ? t.rows : []).filter(Array.isArray).slice(0, 40);
  const num = cols.map((_, i) => rows.length && rows.every((r) => /^[-+]?[$€£¥]?\s?[\d.,]+\s?(%|°\w?|[a-zA-Z/]{0,5})?$|^-$/.test(String(r[i] ?? '').trim())));
  return el('div', { class: 'ask-table' }, el('table', {}, el('thead', {}, el('tr', {}, cols.map((c, i) => el('th', { class: num[i] ? 'num' : null }, c)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((_, i) => el('td', { class: num[i] ? 'num' : null }, ...askInline(askS(r[i] ?? '', 120)))))))));
}
const ASK_STATUS_WORD = { good: 'Good', warn: 'Needs a look', bad: 'Problem' };
function askStatsEl(items) {
  const list = (Array.isArray(items) ? items : []).slice(0, 6).filter((s) => s && s.label && s.value); if (!list.length) return null;
  return el('div', { class: 'ask-stats' }, list.map((s) => { const st = ASK_STATUS_WORD[s.status] ? s.status : null; return el('div', { class: `ask-stat${st ? ` st-${st}` : ''}` }, el('div', { class: 'ask-stat-l' }, askS(s.label, 30)), el('div', { class: 'ask-stat-v' }, askS(s.value, 24)), s.sub || st ? el('div', { class: 'ask-stat-s' }, st ? el('span', { class: 'ask-st' }, T(ASK_STATUS_WORD[st])) : null, askS(s.sub || '', 48)) : null); }));
}
/* Device chips with their live state (read again every few seconds while the answer is on screen). */
let askDevCache = { at: 0, p: null };
const askDevices = () => { if (!askDevCache.p || Date.now() - askDevCache.at > 8000) askDevCache = { at: Date.now(), p: api('/api/devices').then((r) => new Map((r.devices || []).map((d) => [d.id, d]))).catch(() => new Map()) }; return askDevCache.p; };
const ASK_KIND_ICON = { light: 'bulb', plug: 'plug', switch: 'plug', media: 'music', fan: 'fan', climate: 'thermo', cover: 'blinds', lock: 'lock', camera: 'camera', sensor: 'gauge', vacuum: 'vacuum', alarm: 'shield', presence: 'user' };
function askStateWords(d) {
  if (!d) return T('Not found');
  if (d.online === false) return T('Offline');
  if (d.kind === 'media') return d.playing ? (d.title ? `${T('Playing')} · ${d.title}` : T('Playing')) : d.on ? T('Paused') : T('Off');
  if (d.kind === 'climate' && d.tempC != null) return `${S.units === 'C' ? Math.round(d.tempC * 10) / 10 : Math.round(d.tempC * 9 / 5 + 32)}°`;
  if (d.kind === 'lock') return d.locked ? T('Locked') : T('Unlocked');
  if (d.open != null) return d.open ? T('Open') : T('Closed');
  if (d.powerW != null && d.kind !== 'light') return `${d.on === false ? `${T('Off')} · ` : ''}${Math.round(d.powerW)} W`;
  if (d.on != null) return d.on ? (d.brightness ? `${T('On')} · ${d.brightness}%` : T('On')) : T('Off');
  return d.state != null ? `${askS(d.state, 30)}${d.unit ? ` ${askS(d.unit, 8)}` : ''}` : '';
}
function askDevicesEl(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((x) => askS(x, 200)).slice(0, 12); if (!list.length) return null;
  const box = el('div', { class: 'ask-devs' });
  const draw = (m) => box.replaceChildren(...list.map((id) => { const d = m.get(id); return el('div', { class: `ask-dev${d?.on || d?.playing ? ' on' : ''}` }, icon(ASK_KIND_ICON[d?.kind] || 'dotc', 16), el('div', {}, el('div', { class: 'ask-dev-n' }, askS(d?.name || id, 60)), el('div', { class: 'ask-dev-s' }, askStateWords(d)))); }));
  // drawn once the states are in (never a row of "Not found" while they load), and kept as they were if a read fails
  const tick = async () => { if (!box.isConnected && box._seen) return; box._seen ||= box.isConnected; const m = await askDevices(); if (m.size || !box.childNodes.length) draw(m); if (box.isConnected || !box._seen) box._t = setTimeout(tick, 10_000); };
  tick();
  return box;
}
function askSourcesEl(sources, from) {
  const web = (Array.isArray(sources) ? sources : []).map((s) => ({ ...s, href: safeHref(s?.url) })).filter((s) => s.href).slice(0, 8);
  const home = (Array.isArray(from) ? from : []).filter((f) => f?.label).slice(0, 8);
  if (!web.length && !home.length) return null;
  return el('div', { class: 'ask-src' },
    home.length ? el('div', { class: 'ask-from' }, icon('home', 13), el('span', {}, `${T('From your home')}: `, home.map((f) => `${askS(f.label, 60)}${f.at ? ` (${fmtTime(f.at)})` : ''}`).join(' · '))) : null,
    web.length ? el('ol', {}, web.map((s) => el('li', {}, el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer nofollow' }, askS(s.title, 120) || s.href), el('span', { class: 'faint' }, ` · ${askS(s.site, 60)}`), s.license && safeHref(s.licenseUrl) ? el('span', { class: 'faint' }, ' · ', el('a', { href: safeHref(s.licenseUrl), target: '_blank', rel: 'noopener noreferrer', class: 'ask-lic' }, askS(s.license, 40))) : null))) : null);
}
/* The whole answer: its blocks, then the sources, then the offer with up to 3 buttons. */
function askAnswerEl(m, { onAsk, compact = false } = {}) {
  const box = el('div', { class: 'ask-ans' });
  for (const b of Array.isArray(m.blocks) ? m.blocks : []) {
    let node = null;
    if (b?.type === 'md') node = askMd(b.text);
    else if (b?.type === 'code') node = el('pre', { class: 'ask-code' }, askS(b.text, 4000));
    else if (b?.type === 'chart') node = askChartEl(b.spec);
    else if (b?.type === 'table') node = askTableEl(b);
    else if (b?.type === 'stats') node = askStatsEl(b.items);
    else if (b?.type === 'devices') node = askDevicesEl(b.ids);
    if (node) box.append(node);
  }
  if (!box.childNodes.length && m.content) box.append(askMd(m.content));
  const src = askSourcesEl(m.sources, m.from); if (src) box.append(src);
  const o = m.offer || {}, acts = (Array.isArray(o.actions) ? o.actions : []).slice(0, 3), asks = (Array.isArray(o.ask) ? o.ask : []).slice(0, Math.max(0, 3 - acts.length));
  const legacy = !m.offer && Array.isArray(m.actions) ? m.actions.slice(0, 3).map((a) => ({ deviceIds: [a.deviceId], action: a.action, label: a.label })) : [];
  if (o.text || acts.length || asks.length || legacy.length) {
    const row = el('div', { class: 'ask-offer' }, o.text ? el('div', { class: 'ask-offer-t' }, askS(o.text, 160)) : null);
    const btns = el('div', { class: 'acts' });
    for (const a of [...acts, ...legacy]) {
      const ids = (Array.isArray(a.deviceIds) ? a.deviceIds : []).map(String).slice(0, 12), action = ['on', 'off', 'toggle'].includes(a.action) ? a.action : null; if (!ids.length || !action) continue;
      const btn = el('button', { class: 'btn small primary', type: 'button' }, icon('check', 14), askS(a.label, 70));
      btn.onclick = async () => {
        btn.disabled = true; let bad = null;
        for (const id of ids) { try { await post(`/api/devices/${encodeURIComponent(id)}/${encodeURIComponent(action)}`); } catch (err) { bad = err.message; } }
        askDevCache = { at: 0, p: null };
        if (bad) { toast(bad); btn.disabled = false; } else btn.replaceChildren(icon('check', 14), T('Done'));
      };
      btns.append(btn);
    }
    for (const q of asks) btns.append(el('button', { class: 'btn small', type: 'button', onclick: () => onAsk?.(askS(q, 90)) }, askS(q, 90)));
    if (btns.childNodes.length) row.append(btns);
    box.append(row);
  }
  if (compact) box.classList.add('compact');
  return box;
}
/* While the answer streams in: the text so far, with any visual still being written shown as a placeholder. */
function askDraftEl(text) {
  const s = String(text || '');
  const shown = s.replace(/```[a-z]*[^\n]*\n[\s\S]*?(```|$)/gi, (b) => (/^```\s*offer/i.test(b) ? '' : '\n\n⋯\n\n')).replace(/```[a-z]*$/i, '');
  return askMd(shown);
}
