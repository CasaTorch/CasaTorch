/* Energy helpers the rest of the dashboard uses too (the Alerts page's day columns, the page grid's ctx). The
   Energy page itself (23-energy.js) is its own file, loaded the first time Energy opens (build.mjs CHUNKS). */
Object.assign(ICONS, {
  battery: 'M3 7h15v10H3zM21 10v4M6 10v4M9.5 10v4',
  tower: 'M12 3 7 21M12 3l5 18M8.5 15h7M9.6 10h4.8M5 8h14M4 21h16',
  leaf: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19c3-4 6-7 10-9',
});
const enDay = (key, o = { weekday: 'short' }) => fmt(`${key}T12:00:00Z`, { ...o, timeZone: 'UTC' });
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
/* The ctx a page grid's tiles draw from (kept on the grid element by pageGrid). */
const pageCtx = (main) => main.querySelector('.grid')?._ctx || null;

