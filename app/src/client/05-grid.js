/* ======================================================================
 * The Home screen grid. Widgets you add, arrange and size however you like:
 *  - Edit: tap Edit layout, or press and hold any widget (like a phone's
 *    home screen). Then drag a widget from anywhere on it, drag its corner
 *    to resize, or use the keyboard (arrows move, Shift+arrows resize).
 *  - Customize: every widget has its own options (which city, which stocks,
 *    which teams, which cameras...), a name, a size (Small, Medium, Large,
 *    Extra large) and a look (standard, tinted, clear, solid), with a live
 *    preview while you choose.
 *  - Each widget draws itself for the size it's given - a small weather
 *    widget is just the temperature; a big one adds the hours and the week.
 *  - On a phone the grid is four columns: a Small widget sits two to a row.
 * Layout is saved on the box (/api/layout), so every screen in the house
 * shows the same Home, unless a screen is set to "Just this screen".
 * ====================================================================== */
const WIDGETS = {};
/* A widget: { id, title, icon, cat, blurb, min [w,h], max [w,h], size [w,h] (when added), options: [field] | (t) => [field],
   render(body, ctx, size), live (draws once and keeps itself up to date), bare (no header), multi (can be added more than once),
   hidden (not in the gallery), pro, headerExtra, noPreview }. size = { w (in 12ths of a desktop row), h, narrow, span, cols }. */
const widget = (w) => { WIDGETS[w.id] = { min: [2, 2], max: [12, 8], cat: 'info', ...w }; };
const DEFAULT_LAYOUT = [   // packs edge to edge on a 12-column screen
  { id: 'clock', w: 4, h: 2 }, { id: 'weather', w: 5, h: 4 }, { id: 'alerts', w: 3, h: 2 },
  { id: 'internet', w: 4, h: 2 }, { id: 'energy', w: 3, h: 2 },
  { id: 'calendar', w: 4, h: 4 }, { id: 'sports', w: 3, h: 4 }, { id: 'photos', w: 5, h: 4 },
  { id: 'lights', w: 5, h: 3 }, { id: 'today', w: 3, h: 3 }, { id: 'news', w: 4, h: 3 },
  { id: 'ask', w: 6, h: 3 }, { id: 'camera', w: 6, h: 3 },
];
const ROW_PX = 78, GAP_PX = 14;
const PHONE = () => window.innerWidth <= 760;
function gridCols(grid) { const w = grid.clientWidth || window.innerWidth; return PHONE() || w < 720 ? 4 : w >= 1050 ? 12 : 8; }   // a tablet held upright lays out like a big phone: nothing squeezed into thirds
const toSpan = (w, cols) => (cols === 12 ? w : cols === 4 ? (w <= 4 ? 2 : 4) : Math.max(2, Math.min(cols, Math.round(w * cols / 12))));
const fromSpan = (s, cols) => (cols === 12 ? s : cols === 4 ? (s <= 2 ? 3 : 6) : Math.max(1, Math.min(12, Math.round(s * 12 / cols))));
/* The sizes you can pick, like a phone's widget sizes - clamped to what each widget can be. */
const SIZE_PRESETS = [['s', 'Small', [3, 2]], ['m', 'Medium', [6, 2]], ['l', 'Large', [6, 4]], ['xl', 'Extra large', [12, 4]]];
function presetsFor(w) {
  const seen = new Set(), out = [];
  for (const [k, label, [pw, ph]] of (w.presets || SIZE_PRESETS)) {   // w.presets: a page tile's own sizes (06-pagegrid.js)
    const sz = [Math.max(w.min[0], Math.min(w.max[0], pw)), Math.max(w.min[1], Math.min(w.max[1], ph))], key = sz.join('x');
    if (!seen.has(key)) { seen.add(key); out.push([k, label, sz]); }
  }
  return out;
}
const LOOK_NAMES = [['default', 'Standard'], ['tint', 'Tinted'], ['clear', 'Clear'], ['solid', 'Solid']];
const TINTS = ['#5eb8ff', '#8b7bff', '#34d399', '#fbbf24', '#fb923c', '#f43f5e', '#ec4899', '#94a3b8'];
const optsOf = (t) => (t.opts && typeof t.opts === 'object' ? t.opts : (t.opts = {}));
const wOf = (t) => WIDGETS[String(t.id).split(':')[0]];
/* Small, shared fetch cache for widgets that load their own data (stocks, the weather elsewhere, the sun): every widget asking
   for the same answer within its time-to-live gets the same promise. */
const WCACHE = new Map();
function wget(url, ttl = 60_000) {
  const hit = WCACHE.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.p;
  const p = api(url).catch((err) => { if (hit?.ok) return hit.value; throw err; });
  const entry = { at: Date.now(), p, ok: false, value: null }; WCACHE.set(url, entry);
  p.then((v) => { entry.ok = true; entry.value = v; }).catch(() => WCACHE.delete(url));
  if (WCACHE.size > 80) WCACHE.delete(WCACHE.keys().next().value);
  return p;
}
function tileClass(t) { return ['tile', t.look && t.look !== 'default' ? `look-${t.look}` : null].filter(Boolean).join(' '); }
function applyLook(node, t) {
  node.className = `${tileClass(t)}${node.classList.contains('dragging') ? ' dragging' : ''}`;
  if (t.look === 'tint') node.style.setProperty('--tint', safeColor(t.tint, 'var(--accent)')); else node.style.removeProperty('--tint');
}

let gridOff = null;   // the last grid's listeners (only one Home grid is on the page at a time)
function makeGrid(host, { tiles, ctx, onSave, onEdit, onCustomize, auto = false }) {
  const grid = el('div', { class: 'grid', role: 'list' });
  host.append(grid);
  let cols = gridCols(grid);
  const live = new Map();   // tile element -> { t, body, widget }
  const editing = () => grid.classList.contains('editing');
  const spanOf = (t) => (cols === 4 && wOf(t)?.phoneFull ? 4 : toSpan(t.w, cols));   // phoneFull: a page tile that takes the whole row on a phone (06-pagegrid.js)
  /* tier: how much the widget shows at this size (sizeTier, 06-pagegrid.js) - S the key number, XL the details */
  function sizeOf(t) { const span = spanOf(t), narrow = cols === 4; return { w: narrow ? (span <= 2 ? 2 : 4) : t.w, h: t.h, narrow, span, cols, tier: sizeTier({ w: t.w, h: t.h, auto, narrow, span }) }; }
  function place(node, t) { const span = spanOf(t); node.style.gridColumn = `span ${span}`; node.style.gridRow = `span ${t.h}`; node.style.setProperty('--h', t.h); const tier = sizeOf(t).tier; node.dataset.tier = tier; const tag = node.querySelector('.size-tag'); if (tag) tag.textContent = `${tier.toUpperCase()} · ${span} × ${t.h}`; }
  async function paint(node, force) {
    const L = live.get(node); if (!L) return;
    if (typeof famShowWhen === 'function' && L.t.showWhen) {   // "Show only when..." (38-family.js): hidden tiles collapse; nothing runs inside one
      const off = !famShowWhen(L.t, ctx); node.classList.toggle('cond-off', off); node.dataset.hiddenNow = off ? T('Hidden now') : '';
      if (off && !editing()) { if (L.painted) { L.body.replaceChildren(); L.painted = false; } return; }
    } else node.classList.remove('cond-off');
    if (L.widget.live && !force && L.painted) return;
    if (L.busy && !force) return;   // still drawing the last one: a live refresh can skip a beat
    L.painted = true; L.busy = true;
    try { await L.widget.render(L.body, ctx, sizeOf(L.t)); } catch (err) { L.body.replaceChildren(el('div', { class: 'muted small' }, T('Could not load: {message}', { message: err.message }))); }
    finally { L.busy = false; }
  }
  const save = () => onSave();
  function remove(node, t) { const i = tiles.indexOf(t); if (i >= 0) tiles.splice(i, 1); live.delete(node); node.remove(); save(); }
  function tileEl(t) {
    const w = wOf(t); if (!w) return null;
    const body = el('div', { class: 'tile-b' }, pgSkel());   // a soft skeleton until it has drawn
    body._t = t; body._saved = () => { save(); paint(node, true); };
    const head = w.bare ? null : el('div', { class: 'tile-h' }, icon(w.icon), el('span', { class: 'ttl' }, t.title || T(w.title)), w.pro && !isPro() ? el('span', { class: 'pill pro' }, 'PRO') : null, el('span', { class: 'grow' }), w.headerExtra ? w.headerExtra(ctx, t, () => { save(); paint(node, true); }) : null);
    const node = el('section', { class: tileClass(t), 'data-id': t.id, role: 'listitem', 'aria-label': t.title || T(w.title) },
      head, body,
      el('div', { class: 'tools' },
        el('button', { class: 'grip', title: T('Drag to move'), 'aria-label': T('Move {title}', { title: t.title || T(w.title) }) }, icon('grip')),
        el('button', { title: T('Customize'), 'aria-label': T('Customize {title}', { title: t.title || T(w.title) }), onclick: () => onCustomize(t, () => { applyLook(node, t); place(node, t); const ttl = node.querySelector('.ttl'); if (ttl) ttl.textContent = t.title || T(w.title); node.setAttribute('aria-label', t.title || T(w.title)); save(); paint(node, true); }) }, icon('sliders')),
        el('button', { class: 'rm', title: T('Remove'), 'aria-label': T('Remove {title}', { title: t.title || T(w.title) }), onclick: () => remove(node, t) }, icon('x'))),
      el('div', { class: 'sizer', title: T('Drag to resize') }), el('div', { class: 'size-tag' }));
    applyLook(node, t);
    live.set(node, { t, body, widget: w });
    place(node, t);
    dragMove(node, t); dragSize(node, t, w); holdToEdit(node); keys(node, t, w);
    return node;
  }
  /* Press and hold a widget to start arranging (like a phone). Moving the finger first means scrolling, not holding. */
  function holdToEdit(node) {
    let timer = null, x0 = 0, y0 = 0;
    const cancel = () => { clearTimeout(timer); timer = null; };
    node.addEventListener('pointerdown', (e) => {
      if (editing() || e.button > 0 || e.target.closest('button, a, input, select, textarea, .tools, .dev, .dev-wrap')) return;   // a device holds for its own details
      x0 = e.clientX; y0 = e.clientY;
      timer = setTimeout(() => { timer = null; try { navigator.vibrate?.(12); } catch { /* not on this device */ } window.CasaNative?.haptic?.('medium'); onEdit(true); node.classList.add('wiggle-pop'); setTimeout(() => node.classList.remove('wiggle-pop'), 300); }, 550);
    });
    node.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(ev, cancel);
    node.addEventListener('contextmenu', (e) => { if (!editing() && !e.target.closest('a, input, textarea')) e.preventDefault(); });
  }
  /* While arranging, a widget is dragged from anywhere on it (or its handle). A small move starts the drag, so the buttons still work. */
  function dragMove(node, t) {
    node.addEventListener('pointerdown', (e) => {
      if (!editing() || e.button > 0 || e.target.closest('.tools button:not(.grip), .sizer')) return;
      const sx = e.clientX, sy = e.clientY; let started = false;
      const r0 = node.getBoundingClientRect();
      let ph = null, last = null, offX = 0, offY = 0;
      const begin = () => {
        started = true; const r = node.getBoundingClientRect(); offX = sx - r.left; offY = sy - r.top;
        ph = el('div', { class: 'tile ph' }); ph.style.gridColumn = node.style.gridColumn; ph.style.gridRow = node.style.gridRow;
        node.before(ph); node.classList.add('dragging'); Object.assign(node.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r0.width}px`, height: `${r0.height}px` });
      };
      const move = (ev) => {
        if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; begin(); }
        ev.preventDefault();
        node.style.left = `${ev.clientX - offX}px`; node.style.top = `${ev.clientY - offY}px`;
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tile');
        if (ev.clientY < 70) scrollBy(0, -18); else if (ev.clientY > innerHeight - 70) scrollBy(0, 18);
        if (!over || over === ph || over === node || !grid.contains(over)) return;
        const o = over.getBoundingClientRect(), after = ev.clientX > o.left + o.width / 2 || (ev.clientY > o.top + o.height * 0.75);
        const key = `${over.dataset.id}|${after}`; if (key === last) return; last = key;
        if (after) over.after(ph); else over.before(ph);
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (!started) return;
        ph.replaceWith(node); node.classList.remove('dragging'); Object.assign(node.style, { left: '', top: '', width: '', height: '' });
        const order = [...grid.children].map((n) => live.get(n)?.t).filter(Boolean); tiles.splice(0, tiles.length, ...order); save();
      };
      addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
  }
  function dragSize(node, t, w) {
    const sz = node.querySelector('.sizer');
    sz.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); sz.setPointerCapture(e.pointerId);
      const r = node.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, colW = (grid.clientWidth - GAP_PX * (cols - 1)) / cols;
      const minS = toSpan(w.min[0], cols), maxS = Math.min(cols, toSpan(w.max[0], cols));
      let timer = null;
      const move = (ev) => {
        const span = Math.max(minS, Math.min(maxS, Math.round((r.width + ev.clientX - x0 + GAP_PX) / (colW + GAP_PX))));
        const h = Math.max(w.min[1], Math.min(w.max[1], Math.round((r.height + ev.clientY - y0 + GAP_PX) / (ROW_PX + GAP_PX))));
        const nw = fromSpan(span, cols);
        if (nw === t.w && h === t.h) return;
        if (cols !== 4 || span !== toSpan(t.w, cols)) t.w = nw;
        t.h = h; place(node, t);
        clearTimeout(timer); timer = setTimeout(() => paint(node, true), 120);
      };
      const up = () => { sz.removeEventListener('pointermove', move); sz.removeEventListener('pointerup', up); sz.removeEventListener('pointercancel', up); paint(node, true); save(); };
      sz.addEventListener('pointermove', move); sz.addEventListener('pointerup', up); sz.addEventListener('pointercancel', up);
    });
  }
  /* Keyboard: while arranging, arrows move a widget, Shift+arrows resize it, Delete removes it, Enter customizes it. */
  function keys(node, t, w) {
    node.addEventListener('keydown', (e) => {
      if (!editing() || e.target !== node) return;
      const i = tiles.indexOf(t);
      if (e.shiftKey && /^Arrow/.test(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowRight') t.w = Math.min(w.max[0], t.w + 1); else if (e.key === 'ArrowLeft') t.w = Math.max(w.min[0], t.w - 1);
        else if (e.key === 'ArrowDown') t.h = Math.min(w.max[1], t.h + 1); else t.h = Math.max(w.min[1], t.h - 1);
        place(node, t); paint(node, true); save(); return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && i > 0) { e.preventDefault(); tiles.splice(i, 1); tiles.splice(i - 1, 0, t); node.previousElementSibling?.before(node); node.focus(); save(); }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && i < tiles.length - 1) { e.preventDefault(); tiles.splice(i, 1); tiles.splice(i + 1, 0, t); node.nextElementSibling?.after(node); node.focus(); save(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const next = node.nextElementSibling || node.previousElementSibling; remove(node, t); next?.focus?.(); }
      else if (e.key === 'Enter') { e.preventDefault(); node.querySelector('.tools button[title="Customize"]')?.click(); }
    });
  }
  function setEditing(on) { grid.classList.toggle('editing', on); for (const n of live.keys()) { if (on) n.setAttribute('tabindex', '0'); else n.removeAttribute('tabindex'); if (n.classList.contains('cond-off')) paint(n, true); } }
  function build() { live.clear(); grid.replaceChildren(...tiles.map(tileEl).filter(Boolean)); grid.style.setProperty('--cols', cols); setEditing(editing()); return Promise.all([...live.keys()].map((n) => paint(n, true))); }
  let rt = null;
  // one listener per visit to Home, gone once this grid is off the page
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (!grid.isConnected) { gridOff?.(); return; } const c = gridCols(grid); if (c !== cols) { cols = c; build(); } }, 200); };
  gridOff?.(); window.addEventListener('resize', onResize); gridOff = () => window.removeEventListener('resize', onResize);
  return {
    build, setEditing, sizeOf,
    refresh: () => Promise.all([...live.keys()].map((n) => paint(n, false))),
    add(id, init = {}) {
      const w = WIDGETS[id], t = { w: w.size?.[0] || 4, h: w.size?.[1] || 3, ...init, id: w.multi ? `${id}:${Math.random().toString(36).slice(2, 8)}` : id };
      tiles.push(t); const n = tileEl(t); grid.append(n); if (editing()) n.setAttribute('tabindex', '0'); paint(n, true);
      n.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); n.classList.add('wiggle-pop'); setTimeout(() => n.classList.remove('wiggle-pop'), 400);
      save(); return { t, node: n, repaint: () => { save(); paint(n, true); } };
    },
  };
}

/* A small "rename" dialog used everywhere (devices, menu items). Empty = back to the original name. */
function renameBox(title, value, original, done) {
  const input = el('input', { value: value || '', placeholder: original, maxlength: 60 });
  const ok = () => { m.remove(); done(input.value.trim()); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  const m = modal(el('div', {}, input, el('p', { class: 'small muted' }, T('Leave empty to use "{original}".', { original })), el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')), el('button', { class: 'btn primary', onclick: ok }, T('Save')))), { title });
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

/* ---- Customize a widget: name, size, look and its own options, with a live preview ---- */
function previewBox(t, w, ctx) {
  // drawn at desktop size, then scaled to fit the sheet - so you see exactly what the wall screen will show
  const colW = 86, pw = Math.round(t.w * colW + (t.w - 1) * GAP_PX), ph = Math.round(t.h * ROW_PX + (t.h - 1) * GAP_PX);
  const body = el('div', { class: 'tile-b' }); body._t = t; body._saved = () => {};
  const node = el('section', { class: tileClass(t), style: `width:${pw}px;height:${ph}px` }, w.bare ? null : el('div', { class: 'tile-h' }, icon(w.icon), el('span', { class: 'ttl' }, t.title || T(w.title))), body);
  if (t.look === 'tint') node.style.setProperty('--tint', safeColor(t.tint, 'var(--accent)'));
  const stage = el('div', { class: 'wprev' }, node);
  const fit = () => { const avail = Math.max(200, stage.clientWidth - 8), s = Math.min(1, avail / pw, 340 / ph); node.style.transform = `scale(${s})`; stage.style.height = `${Math.round(ph * s) + 8}px`; };
  requestAnimationFrame(fit);
  const p = w.noPreview ? Promise.resolve(body.replaceChildren(el('div', { class: 'allclear' }, el('div', {}, icon(w.icon), el('div', { class: 'small muted', style: 'margin-top:6px' }, w.blurb ? T(w.blurb) : ''))))) : Promise.resolve(w.render(body, ctx, { w: t.w, h: t.h, narrow: false, span: t.w, cols: 12, preview: true, tier: sizeTier({ w: t.w, h: t.h, auto: w.max?.[1] === 1 }) })).catch((err) => body.replaceChildren(el('div', { class: 'muted small' }, err.message)));
  return { stage, ready: p, fit };
}
function customizeTile(t, ctx, done) {
  const w = wOf(t); if (!w) return;
  const before = JSON.stringify(t);
  const holder = el('div', { class: 'wprev-holder' });
  let pv = null, pt = null;
  const repaint = () => { clearTimeout(pt); pt = setTimeout(() => { pv = previewBox(t, w, ctx); holder.replaceChildren(pv.stage); requestAnimationFrame(() => pv.fit()); }, 120); };
  const fields = el('div', { class: 'wopts' });
  const section = (label, ...kids) => el('div', { class: 'wopt' }, el('label', { class: 'wopt-l' }, T(label)), ...kids);
  const draw = () => {
    const out = [];
    out.push(section(T('Name'), el('input', { value: t.title || '', placeholder: T(w.title), maxlength: 40, oninput: (e) => { t.title = e.target.value.trim() || undefined; repaint(); } })));
    out.push(section(T('Size'), el('div', { class: 'seg seg-wrap' }, presetsFor(w).map(([k, label, [pw, ph]]) => el('button', { type: 'button', class: t.w === pw && t.h === ph ? 'on' : '', onclick: () => { t.w = pw; t.h = ph; draw(); repaint(); } }, T(label)))),
      el('div', { class: 'tiny muted', style: 'margin-top:6px' }, T('Or drag a widget\'s corner while arranging for any size in between.'))));
    out.push(section(T('Look'), el('div', { class: 'seg seg-wrap' }, LOOK_NAMES.map(([k, label]) => el('button', { type: 'button', class: (t.look || 'default') === k ? 'on' : '', onclick: () => { t.look = k === 'default' ? undefined : k; draw(); repaint(); } }, T(label)))),
      t.look === 'tint' ? el('div', { class: 'swatches' }, TINTS.map((c) => el('button', { type: 'button', class: `swatch${(t.tint || TINTS[0]) === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': T('Tint {c}', { c }), onclick: () => { t.tint = c; draw(); repaint(); } }))) : null));
    const opts = typeof w.options === 'function' ? w.options(t, ctx) : w.options || [];
    for (const f of opts) { const node = optField(f, t, ctx, () => { repaint(); if (f.redraw) draw(); }); if (node) out.push(section(f.label, node, f.help ? el('div', { class: 'tiny muted', style: 'margin-top:6px' }, T(f.help)) : null)); }
    if (typeof famCondField === 'function') out.push(section(T('Show only when…'), famCondField(t, ctx, repaint)));   // conditional widgets (38-family.js)
    fields.replaceChildren(...out);
  };
  draw(); repaint();
  const cancel = () => { Object.keys(t).forEach((k) => delete t[k]); Object.assign(t, JSON.parse(before)); m.remove(); };
  const m = modal(el('div', { class: 'wcustom' }, holder, fields, el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px;gap:8px' },
    el('button', { class: 'btn ghost', onclick: cancel }, T('Cancel')), el('button', { class: 'btn primary', onclick: () => { m.remove(); done(); } }, T('Done')))), { title: T('Customize {title}', { title: T(w.title) }), wide: true });
  m.addEventListener('click', (e) => { if (e.target === m) { e.stopImmediatePropagation(); } }, true);   // a stray tap outside doesn't throw your changes away
}
/* One option field. f: { key, type, label, ...}. Types: select, toggle, text, textarea, number, date, datetime, place, symbols,
   teams, zones, devices, device, widgets, calendars, chips (multi-choice from a list). Values go in t.opts[key]. */
function optField(f, t, ctx, changed) {
  const o = optsOf(t), val = o[f.key] ?? f.default;
  const set = (v) => { if (v === undefined || v === '' || (Array.isArray(v) && !v.length && f.default === undefined)) delete o[f.key]; else o[f.key] = v; changed(); };
  switch (f.type) {
    case 'select': return el('select', { onchange: (e) => set(f.numeric ? Number(e.target.value) : e.target.value) }, f.choices.map(([v, l]) => el('option', { value: v, selected: String(val) === String(v) || null }, T(String(l)))));
    case 'toggle': return el('label', { class: 'switch-row' }, el('input', { type: 'checkbox', checked: !!val, onchange: (e) => set(e.target.checked) }), el('span', {}, T(f.text || 'On')));
    case 'text': return el('input', { value: val || '', placeholder: f.placeholder ? T(f.placeholder) : '', maxlength: f.max || 80, oninput: (e) => set(e.target.value) });
    case 'textarea': return el('textarea', { rows: f.rows || 4, maxlength: f.max || 400, placeholder: f.placeholder ? T(f.placeholder) : '', oninput: (e) => set(e.target.value) }, val || '');
    case 'number': return el('div', { class: 'row', style: 'gap:8px' }, el('input', { type: 'number', value: val ?? '', min: f.min, max: f.max, step: f.step || 1, style: 'max-width:140px', oninput: (e) => { const n = Number(e.target.value); set(e.target.value === '' ? undefined : Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, n))); } }), f.suffix ? el('span', { class: 'muted small' }, T(f.suffix)) : null);
    case 'date': return el('input', { type: 'date', value: val || '', onchange: (e) => set(e.target.value) });
    case 'datetime': return el('input', { type: 'datetime-local', value: val || '', onchange: (e) => set(e.target.value) });
    case 'chips': {
      const cur = new Set(Array.isArray(val) ? val : []);
      return el('div', { class: 'chips' }, f.choices.map(([v, l]) => el('button', { type: 'button', class: `chip${cur.has(v) ? ' on' : ''}`, onclick: (e) => { if (cur.has(v)) cur.delete(v); else cur.add(v); e.currentTarget.classList.toggle('on'); set([...cur]); } }, T(String(l)))));
    }
    case 'place': {
      const out = el('div', { class: 'place-pick' });
      const show = () => {
        const q = el('input', { type: 'search', placeholder: T('Search for a town or city…'), 'aria-label': T('Search for a place') }), list = el('div', { class: 'pick-list' });
        // One search when you press Find or Enter (OpenStreetMap's search asks apps not to search while you type).
        const find = async () => { const s = q.value.trim(); if (s.length < 3) return list.replaceChildren(); try { const { places = [], credit } = await api(`/api/w/places?q=${encodeURIComponent(s)}`); list.replaceChildren(...places.map((p) => el('button', { type: 'button', class: 'pick-item', onclick: () => { set({ name: p.name, lat: p.lat, lon: p.lon }); show(); } }, icon('home', 14), p.name))); if (!places.length) list.replaceChildren(el('div', { class: 'tiny muted' }, T('Nothing found.'))); if (credit) list.append(placeCredit(credit)); } catch (err) { list.replaceChildren(el('div', { class: 'tiny muted' }, err.message)); } };
        q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } };
        const curv = o[f.key];
        out.replaceChildren(el('div', { class: 'row', style: 'gap:8px;margin-bottom:8px' }, el('b', { class: 'grow' }, curv?.name || f.homeLabel || T('Your home')), curv ? el('button', { type: 'button', class: 'btn small ghost', onclick: () => { set(undefined); show(); } }, T('Use home')) : null), el('div', { class: 'row', style: 'gap:8px' }, el('div', { class: 'grow' }, q), el('button', { type: 'button', class: 'btn small', onclick: find }, T('Find'))), list);
      };
      show(); return out;
    }
    case 'symbols': {
      const cur = Array.isArray(val) ? [...val] : [];
      const box = el('div');
      const draw = () => {
        const inp = el('input', { placeholder: T('Add a symbol: AAPL, ^GSPC, BTC-USD, EURUSD=X…'), 'aria-label': T('Add a symbol'), maxlength: 15, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(inp.value); } } });
        const add = (s) => { s = String(s || '').trim().toUpperCase(); if (!/^[\^A-Z0-9][A-Z0-9.=\-^]{0,14}$/.test(s) || cur.includes(s) || cur.length >= 12) return; cur.push(s); set([...cur]); draw(); };
        box.replaceChildren(el('div', { class: 'chips' }, cur.map((s, i) => el('span', { class: 'chip on' }, s, el('button', { type: 'button', class: 'chip-x', 'aria-label': T('Remove {s}', { s }), onclick: () => { cur.splice(i, 1); set([...cur]); draw(); } }, '×')))),
          el('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, inp, el('button', { type: 'button', class: 'btn small', onclick: () => add(inp.value) }, T('Add'))),
          el('div', { class: 'chips', style: 'margin-top:8px' }, (f.suggest || []).filter(([s]) => !cur.includes(s)).map(([s, l]) => el('button', { type: 'button', class: 'chip', onclick: () => add(s) }, `+ ${l}`))));
      };
      draw(); return box;
    }
    case 'teams': {
      const cur = Array.isArray(val) ? [...val] : [];
      const box = el('div');
      const draw = async () => {
        const league = el('select', { 'aria-label': T('League') }, el('option', { value: '' }, T('Pick a league…')));
        const teamSel = el('select', { 'aria-label': T('Team'), disabled: true }, el('option', { value: '' }, T('Then a team')));
        const chips = el('div', { class: 'chips' }, cur.length ? cur.map((x, i) => el('span', { class: 'chip on' }, x.logo ? el('img', { src: x.logo, alt: '', style: 'width:16px;height:16px;margin-right:4px' }) : null, x.name, el('button', { type: 'button', class: 'chip-x', 'aria-label': T('Remove {name}', { name: x.name }), onclick: () => { cur.splice(i, 1); set([...cur]); draw(); } }, '×'))) : el('span', { class: 'tiny muted' }, T('No teams picked - shows the teams from Settings.')));
        box.replaceChildren(chips, el('div', { class: 'row', style: 'gap:8px;margin-top:8px;flex-wrap:wrap' }, league, teamSel));
        try { const { leagues = [] } = await wget('/api/w/leagues', 3600_000); league.append(...leagues.map((l) => el('option', { value: l.id }, l.name))); } catch { /* offline */ }
        league.onchange = async () => {
          teamSel.disabled = true; teamSel.replaceChildren(el('option', { value: '' }, T('Loading…')));
          try { const { teams = [] } = await wget(`/api/w/teams?league=${encodeURIComponent(league.value)}`, 3600_000); teamSel.replaceChildren(el('option', { value: '' }, T('Pick a team…')), ...teams.map((x) => el('option', { value: x.id }, x.name))); teamSel.disabled = false; teamSel._teams = teams; } catch (err) { teamSel.replaceChildren(el('option', { value: '' }, err.message)); }
        };
        teamSel.onchange = () => { const x = (teamSel._teams || []).find((y) => y.id === teamSel.value); if (!x || cur.some((c) => c.league === x.league && c.id === x.id) || cur.length >= 12) return; cur.push({ league: x.league, id: x.id, name: x.name, logo: x.logo }); set([...cur]); draw(); };
      };
      draw(); return box;
    }
    case 'zones': {
      const cur = Array.isArray(val) ? [...val] : [];
      let all = []; try { all = Intl.supportedValuesOf('timeZone'); } catch { all = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney']; }
      const box = el('div');
      const draw = () => {
        const q = el('input', { type: 'search', placeholder: T('Add a city: London, Tokyo, Chicago…'), 'aria-label': T('Add a city') }), list = el('div', { class: 'pick-list' });
        q.oninput = () => { const s = q.value.trim().toLowerCase().replace(/\s+/g, '_'); list.replaceChildren(...(s.length < 2 ? [] : all.filter((z) => z.toLowerCase().includes(s)).slice(0, 8).map((z) => el('button', { type: 'button', class: 'pick-item', onclick: () => { if (!cur.some((c) => c.tz === z) && cur.length < 8) { cur.push({ tz: z, label: zoneCity(z) }); set([...cur]); } draw(); } }, zoneCity(z), el('span', { class: 'tiny muted', style: 'margin-left:auto' }, z))))); };
        box.replaceChildren(el('div', { class: 'chips' }, cur.map((c, i) => el('span', { class: 'chip on' }, c.label, el('button', { type: 'button', class: 'chip-x', 'aria-label': T('Remove {label}', { label: c.label }), onclick: () => { cur.splice(i, 1); set([...cur]); draw(); } }, '×')))), el('div', { style: 'margin-top:8px' }, q), list);
      };
      draw(); return box;
    }
    case 'devices': case 'device': {
      const all = (Array.isArray(ctx.data.devices) ? ctx.data.devices : ctx.data.devices?.devices || []).filter(f.filter || (() => true));   // Home keeps the whole /api/devices answer, pages the list
      if (f.type === 'device') return all.length ? el('select', { onchange: (e) => set(e.target.value || undefined) }, el('option', { value: '' }, f.none || T('Pick one…')), all.map((d) => el('option', { value: d.id, selected: val === d.id || null }, `${d.name}${d.area ? ` · ${d.area}` : ''}`))) : el('div', { class: 'tiny muted' }, f.empty || T('Nothing to pick yet.'));
      const cur = new Set(Array.isArray(val) ? val : []);
      if (!all.length) return el('div', { class: 'tiny muted' }, f.empty || T('Nothing to pick yet.'));
      return el('div', { class: 'pick-checks' }, all.slice(0, 200).map((d) => el('label', { class: 'pick-check' }, el('input', { type: 'checkbox', checked: cur.has(d.id), onchange: (e) => { if (e.target.checked) cur.add(d.id); else cur.delete(d.id); set([...cur]); } }), el('span', { class: 'ellipsis' }, d.name), d.area ? el('span', { class: 'tiny muted' }, d.area) : null)));
    }
    case 'calendars': {
      const names = [...new Set((ctx.data.home?.calendar?.events || []).map((e) => e.calendar).filter(Boolean))];
      if (!names.length) return el('div', { class: 'tiny muted' }, T('Every calendar is shown.'));
      const cur = new Set(Array.isArray(val) ? val : []);
      const box = el('div');
      const draw = () => box.replaceChildren(el('div', { class: 'chips' }, names.map((n) => el('button', { type: 'button', class: `chip${!cur.size || cur.has(n) ? ' on' : ''}`, onclick: () => {
        if (!cur.size) names.forEach((x) => cur.add(x));
        if (cur.has(n)) cur.delete(n); else cur.add(n);
        if (cur.size === names.length || !cur.size) cur.clear();   // all (or none) = every calendar
        set([...cur]); draw();
      } }, n))), el('div', { class: 'tiny muted', style: 'margin-top:6px' }, T('Tap to show or hide a calendar.')));
      draw(); return box;
    }
    case 'widgets': {
      const cur = Array.isArray(val) ? val.map((x) => ({ ...x })) : [];
      const box = el('div');
      const pickable = Object.values(WIDGETS).filter((x) => !x.hidden && !x.multi && !['stack', 'photos', 'house3d', 'ask', 'camera', 'doorbell', 'timer'].includes(x.id));
      const draw = () => {
        box.replaceChildren(el('ol', { class: 'stack-list' }, cur.map((x, i) => el('li', {}, icon(WIDGETS[x.id]?.icon || 'dotc', 16), el('span', { class: 'grow' }, WIDGETS[x.id]?.title ? T(WIDGETS[x.id].title) : x.id),
          el('button', { type: 'button', class: 'btn small ghost', disabled: i === 0 || null, 'aria-label': T('Move up'), onclick: () => { [cur[i - 1], cur[i]] = [cur[i], cur[i - 1]]; set(cur.map((y) => ({ ...y }))); draw(); } }, '↑'),
          el('button', { type: 'button', class: 'btn small ghost', 'aria-label': T('Remove'), onclick: () => { cur.splice(i, 1); set(cur.map((y) => ({ ...y }))); draw(); } }, '×')))),
        cur.length < 8 ? el('select', { onchange: (e) => { if (e.target.value) { cur.push({ id: e.target.value }); set(cur.map((y) => ({ ...y }))); draw(); } } }, el('option', { value: '' }, T('+ Add a widget to the stack')), pickable.map((x) => el('option', { value: x.id }, T(x.title)))) : null);
      };
      draw(); return box;
    }
    default: return null;
  }
}
const zoneCity = (z) => String(z).split('/').pop().replace(/_/g, ' ');
/* The OpenStreetMap credit under town-search results (the server sends the text and link). */
function placeCredit(c) { return el('a', { class: 'tiny muted', style: 'display:block;margin-top:6px', href: /^https:\/\//.test(c?.href || '') ? c.href : 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, String(c?.text || '© OpenStreetMap contributors')); }
