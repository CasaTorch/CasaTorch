/* ======================================================================
 * The Home screen grid: tiles you can drag around, resize from the corner,
 * add and remove. Each widget draws itself for the size it's given - a
 * small weather tile is just the temperature; a big one adds the hours and
 * the week. Layout is saved on the box (/api/layout), so every screen in
 * the house shows the same Home.
 * ====================================================================== */
const WIDGETS = {};
const widget = (w) => { WIDGETS[w.id] = { min: [2, 2], max: [12, 8], ...w }; };
const DEFAULT_LAYOUT = [   // packs edge to edge on a 12-column screen
  { id: 'clock', w: 4, h: 2 }, { id: 'weather', w: 5, h: 4 }, { id: 'alerts', w: 3, h: 2 },
  { id: 'internet', w: 4, h: 2 }, { id: 'energy', w: 3, h: 2 },
  { id: 'calendar', w: 4, h: 4 }, { id: 'sports', w: 3, h: 4 }, { id: 'photos', w: 5, h: 4 },
  { id: 'lights', w: 5, h: 3 }, { id: 'today', w: 3, h: 3 }, { id: 'news', w: 4, h: 3 },
  { id: 'ask', w: 6, h: 3 }, { id: 'camera', w: 6, h: 3 },
];
const ROW_PX = 78, GAP_PX = 14;
function gridCols(grid) { const w = grid.clientWidth || window.innerWidth; return window.innerWidth <= 760 ? 1 : w >= 1050 ? 12 : 8; }
const toSpan = (w, cols) => (cols === 12 ? w : cols === 1 ? 1 : Math.max(2, Math.min(cols, Math.round(w * cols / 12))));
const fromSpan = (s, cols) => (cols === 12 ? s : Math.max(1, Math.min(12, Math.round(s * 12 / cols))));

function makeGrid(host, { tiles, ctx, onSave }) {
  const grid = el('div', { class: 'grid' });
  host.append(grid);
  let cols = gridCols(grid);
  const live = new Map();   // tile element -> { t, body, widget }
  function sizeOf(t) { return { w: cols === 1 ? 4 : t.w, h: t.h, narrow: cols === 1 }; }
  function place(node, t) { const span = toSpan(t.w, cols); node.style.gridColumn = `span ${span}`; node.style.gridRow = `span ${t.h}`; node.style.setProperty('--h', t.h); const tag = node.querySelector('.size-tag'); if (tag) tag.textContent = `${span} × ${t.h}`; }
  async function paint(node, force) {
    const L = live.get(node); if (!L) return;
    if (L.widget.live && !force && L.painted) return;
    L.painted = true;
    try { await L.widget.render(L.body, ctx, sizeOf(L.t)); } catch (err) { L.body.replaceChildren(el('div', { class: 'muted small' }, `Could not load: ${err.message}`)); }
  }
  function tileEl(t) {
    const w = WIDGETS[t.id]; if (!w) return null;
    const body = el('div', { class: 'tile-b' });
    const node = el('section', { class: 'tile', 'data-id': t.id, 'aria-label': w.title },
      w.bare ? null : el('div', { class: 'tile-h' }, icon(w.icon), el('span', { class: 'ttl' }, t.title || w.title), w.pro && !isPro() ? el('span', { class: 'pill pro' }, 'PRO') : null, el('span', { class: 'grow' }), w.headerExtra ? w.headerExtra(ctx) : null),
      body,
      el('div', { class: 'tools' }, el('button', { class: 'grip', title: 'Drag to move', 'aria-label': `Move ${w.title}` }, icon('grip')),
        el('button', { title: 'Rename', 'aria-label': `Rename ${w.title}`, onclick: () => renameBox(`Rename "${t.title || w.title}"`, t.title || w.title, w.title, (v) => { t.title = v && v !== w.title ? v : undefined; const ttl = node.querySelector('.ttl'); if (ttl) ttl.textContent = t.title || w.title; onSave(); }) }, icon('edit')), el('button', { title: 'Remove', 'aria-label': `Remove ${w.title}`, onclick: () => { tiles.splice(tiles.indexOf(t), 1); live.delete(node); node.remove(); onSave(); } }, icon('x'))),
      el('div', { class: 'sizer', title: 'Drag to resize' }), el('div', { class: 'size-tag' }));
    live.set(node, { t, body, widget: w });
    place(node, t);
    dragMove(node, t); dragSize(node, t, w);
    return node;
  }
  function dragMove(node, t) {
    const grip = node.querySelector('.grip');
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = node.getBoundingClientRect(), offX = e.clientX - r.left, offY = e.clientY - r.top;
      const ph = el('div', { class: 'tile ph' }); ph.style.gridColumn = node.style.gridColumn; ph.style.gridRow = node.style.gridRow;
      node.before(ph); node.classList.add('dragging'); Object.assign(node.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      let last = null;
      const move = (ev) => {
        node.style.left = `${ev.clientX - offX}px`; node.style.top = `${ev.clientY - offY}px`;
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tile');
        if (!over || over === ph || over === node || !grid.contains(over)) return;
        const o = over.getBoundingClientRect(), after = cols === 1 ? ev.clientY > o.top + o.height / 2 : ev.clientX > o.left + o.width / 2;
        const key = `${over.dataset.id}|${after}`; if (key === last) return; last = key;
        if (after) over.after(ph); else over.before(ph);
        if (ev.clientY < 70) scrollBy(0, -20); else if (ev.clientY > innerHeight - 70) scrollBy(0, 20);
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        ph.replaceWith(node); node.classList.remove('dragging'); Object.assign(node.style, { left: '', top: '', width: '', height: '' });
        const order = [...grid.children].map((n) => live.get(n)?.t).filter(Boolean); tiles.splice(0, tiles.length, ...order); onSave();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
  }
  function dragSize(node, t, w) {
    const sz = node.querySelector('.sizer');
    sz.addEventListener('pointerdown', (e) => {
      if (cols === 1) return;
      e.preventDefault(); sz.setPointerCapture(e.pointerId);
      const r = node.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, colW = (grid.clientWidth - GAP_PX * (cols - 1)) / cols;
      const minS = toSpan(w.min[0], cols), maxS = Math.min(cols, toSpan(w.max[0], cols));
      let timer = null;
      const move = (ev) => {
        const span = Math.max(minS, Math.min(maxS, Math.round((r.width + ev.clientX - x0 + GAP_PX) / (colW + GAP_PX))));
        const h = Math.max(w.min[1], Math.min(w.max[1], Math.round((r.height + ev.clientY - y0 + GAP_PX) / (ROW_PX + GAP_PX))));
        const nw = fromSpan(span, cols);
        if (nw === t.w && h === t.h) return;
        t.w = nw; t.h = h; place(node, t);
        clearTimeout(timer); timer = setTimeout(() => paint(node, true), 120);
      };
      const up = () => { sz.removeEventListener('pointermove', move); sz.removeEventListener('pointerup', up); sz.removeEventListener('pointercancel', up); paint(node, true); onSave(); };
      sz.addEventListener('pointermove', move); sz.addEventListener('pointerup', up); sz.addEventListener('pointercancel', up);
    });
  }
  function build() { live.clear(); grid.replaceChildren(...tiles.map(tileEl).filter(Boolean)); grid.style.setProperty('--cols', cols); return Promise.all([...live.keys()].map((n) => paint(n, true))); }
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!grid.isConnected) return; const c = gridCols(grid); if (c !== cols) { cols = c; build(); } }, 200); });
  return {
    build,
    refresh: () => Promise.all([...live.keys()].map((n) => paint(n, false))),
    add(id) { const w = WIDGETS[id], t = { id, w: w.size?.[0] || 4, h: w.size?.[1] || 3 }; tiles.push(t); const n = tileEl(t); grid.append(n); paint(n, true); n.scrollIntoView({ behavior: 'smooth', block: 'center' }); onSave(); },
  };
}

/* A small "rename" dialog used everywhere (tiles, devices, menu items). Empty = back to the original name. */
function renameBox(title, value, original, done) {
  const input = el('input', { value: value || '', placeholder: original, maxlength: 60 });
  const ok = () => { m.remove(); done(input.value.trim()); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  const m = modal(el('div', {}, input, el('p', { class: 'small muted' }, `Leave empty to use "${original}".`), el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, 'Cancel'), el('button', { class: 'btn primary', onclick: ok }, 'Save'))), { title });
  setTimeout(() => { input.focus(); input.select(); }, 50);
}
