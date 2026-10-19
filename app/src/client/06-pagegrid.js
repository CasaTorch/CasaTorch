/* ======================================================================
 * The page grid: every page as a grid of tiles you can add, remove, resize and drag around. ONE system for every
 * page - Home, Controls, Cameras, Security, Alerts, Energy, Network: the same Edit button, the same bar while
 * editing, the same gallery, the same handles (makeGrid in 05-grid.js does the dragging and sizing).
 *
 *  - Smart defaults: until someone arranges a page, the server suggests a layout from what the house has
 *    (suggestPageTiles in 60-layout.js): solar gets the power-flow tile, Frigate gets Detections, Home Assistant
 *    areas get a tile per room, a house with only lights gets just lights. The suggestion follows new devices by
 *    itself; once a page is arranged, new suggestions are offered in one tap ("New for your home").
 *  - Edit: Edit (or press and hold a tile) - drag to move, drag the corner to resize, the sliders button for a
 *    tile's size (Small, Medium, Large, Extra large), name and options, x to remove; "Add" opens the page's
 *    gallery. "Reset to suggested" goes back to CasaTorch's layout.
 *  - Whose layout: Everyone (admins), every phone / every tablet / every computer (admins), Just me (when sign-in
 *    is on), or This screen (the kitchen tablet). Saved on the box: /api/page-layout/<page>.
 *  - Size-adaptive: a tile shows more as it grows - S: the key number or state; M: + a sparkline or controls;
 *    L: + a chart; XL: + a table or details. sizeTier() decides; render() gets it as size.tier, and the tile
 *    carries data-tier="s|m|l|xl" so CSS can hide detail too (.pg-m-up, .pg-l-up, .pg-xl-up).
 *
 * THE API (stable - the Network page and others build on it):
 *   pageTile({ id, page, title, icon, blurb, size: [w, h], min, max, render(body, ctx, size), options?, multi?, askFirst?,
 *              live?, bare?, auto?, phoneFull?, pro? })
 *      Ids start with the page's own prefix ('net-', 'sec-'...). ctx.data is what the page's load() returned;
 *      ctx.refresh() reloads it. size = { w, h, narrow (phone), span, cols, tier ('s'|'m'|'l'|'xl') }.
 *      Strings through T(). body._t is the tile ({ id, w, h, title?, device?, opts? }); optsOf(body._t) its options.
 *   pageGrid(main, { page, title, sub?, load: async () => data, auto?, actions?: [nodes], before?: [nodes],
 *                    gallery?: ({ tiles, ctx, suggested, onPick }) => void, onAdded?: (id, added) => void,
 *                    addLabel?, emptyText? }) -> refresh()
 *      auto: true sizes tiles to their content (lists, camera walls) - sizes are then widths only.
 *   pageCtx(main) - the ctx of the grid on a page. sizeTier(size) - the tier for a size.
 *   pgEmpty(text, href?, label?) - the empty state ("Set this up" link). pgSkel(lines?) - a loading skeleton.
 *   pgSpark(vals, opts), pgLine(vals, opts) - a sparkline / a line chart with axis and tooltip. chartTip().
 *   Server side: add the page to PAGES in 60-layout.js, its facts to pageFacts(), its default tiles to suggestPageTiles().
 * ====================================================================== */
const PAGE_TILES = {};   // page -> [tile ids]
const AUTO_PRESETS = [['s', 'Small', [4, 1]], ['m', 'Medium', [6, 1]], ['l', 'Large', [8, 1]], ['xl', 'Extra large', [12, 1]]];
function pageTile(def) {
  const auto = def.auto;
  widget({ ...(auto ? { min: [4, 1], max: [12, 1], size: [6, 1], presets: AUTO_PRESETS } : {}), ...def, hidden: true, cat: def.page });
  (PAGE_TILES[def.page] ||= []).push(def.id);
}
const pageTilesOf = (page) => (PAGE_TILES[page] || []).map((id) => WIDGETS[id]).filter(Boolean);
/* "The same tile" across layouts - matches pageTileKey() in 60-layout.js. */
const tileKey = (t) => `${String(t.id).split(':')[0]}${t.device ? `@${t.device}` : ''}${t.opts?.group ? `#${t.opts.group}` : ''}${t.opts?.area != null && t.opts?.area !== '' ? `~${t.opts.area}` : ''}`;
const cloneTiles = (list) => (list || []).filter((t) => wOf(t)).map((t) => JSON.parse(JSON.stringify(t)));
/* Multi tiles in a suggestion arrive without their own id ("en-dev"): each gets one, so they can be moved apart. */
const ownIds = (list) => list.map((t) => (wOf(t)?.multi && !String(t.id).includes(':') ? { ...t, id: `${t.id}:${Math.random().toString(36).slice(2, 8)}` } : t));

/* @tier:start */
/** How much a tile of this size shows: 's' (the key number or state), 'm' (+ sparkline or controls), 'l' (+ a chart),
    'xl' (+ a table or details). w in 12ths of a desktop row, h in rows; auto pages size by width only. A half-width
    tile on a phone shows at most 'm'. Pure, so it can be tested. */
function sizeTier({ w = 4, h = 2, auto = false, narrow = false, span = 4 } = {}) {
  let t;
  if (auto) t = w >= 12 ? 'xl' : w >= 8 ? 'l' : w >= 6 ? 'm' : 's';
  else { const area = w * h; t = area <= 6 || (w <= 2) ? 's' : area <= 12 || h <= 2 ? 'm' : area < 40 ? 'l' : 'xl'; }
  if (narrow && span <= 2 && (t === 'l' || t === 'xl')) t = 'm';
  return t;
}
const TIER_RANK = { s: 0, m: 1, l: 2, xl: 3 };
/** At least this tier? atLeast(size, 'l') */
const atLeast = (size, tier) => TIER_RANK[size?.tier || 'm'] >= TIER_RANK[tier];
/* @tier:end */

/* What kind of screen this is, for "every phone" / "every tablet" / "every computer" layouts: the device, not the window. */
function screenForm() {
  try {
    const s = Math.min(screen.width || innerWidth, screen.height || innerHeight);
    if (s < 600) return 'phone';
    if (matchMedia('(pointer: coarse)').matches) return 'tablet';
  } catch { /* old browser */ }
  return 'desktop';
}
const FORM_NAMES = { phone: 'Every phone', tablet: 'Every tablet', desktop: 'Every computer' };
const SCOPE_ORDER = { house: 0, form: 1, user: 2, screen: 3 };

async function pageGrid(main, o) {
  const { page } = o, sid = screenId(), form = screenForm();
  const getLay = () => api(`/api/page-layout/${page}?form=${form}${sid ? `&screen=${sid}` : ''}`).catch(() => ({ suggested: o.fallback || [] }));
  const [data, lay, me] = await Promise.all([o.load(), getLay(), S.me ? Promise.resolve(S.me) : api('/api/auth/me').catch(() => null)]);
  if (me) S.me = me;
  if (!main.isConnected && main.dataset.drawn) return null;
  const ctx = { data, page, refresh: null };
  const role = me?.user?.role || 'viewer', panel = !!me?.user?.panel;
  const admin = ['admin', 'owner'].includes(role) && !panel;
  const can = { house: admin, form: admin, user: !!lay.canUser, screen: ['member', 'admin', 'owner'].includes(role) && !!sid };
  let scope = lay.screen ? 'screen' : lay.user ? 'user' : lay.form ? 'form' : 'house';
  const saved = () => lay[scope];
  const suggested = () => ownIds(cloneTiles(lay.suggested));
  /* What shows when a scope has nothing of its own: the next wider one, else the suggestion. */
  const inherited = (k) => { for (const x of ['screen', 'user', 'form', 'house'].slice(['screen', 'user', 'form', 'house'].indexOf(k) + 1)) if (lay[x]) return cloneTiles(lay[x].tiles); return suggested(); };
  let tiles = saved() ? cloneTiles(saved().tiles) : suggested();
  const writable = () => can[scope];
  let saveT = null;
  const save = () => {
    if (!writable()) return;
    lay[scope] = { tiles: JSON.parse(JSON.stringify(tiles)), seen: (lay.suggested || []).map(tileKey) };
    clearTimeout(saveT);
    saveT = setTimeout(() => post(`/api/page-layout/${page}`, { scope, screen: sid, form, tiles, seen: lay[scope].seen }, 'PUT').catch((e) => toast(T('Layout not saved: {message}', { message: e.message }))), 400);
    drawNote();
  };
  // ---- the bar while editing ----
  const editBtn = el('button', { class: 'btn pg-edit' }, icon('edit'), el('span', { class: 'hide-phone' }, T('Edit')));
  const addBtn = el('button', { class: 'btn primary pg-add' }, icon('plus'), el('span', { class: 'hide-phone' }, T(o.addLabel || 'Add')));
  const bar = el('div', { class: 'editbar pg-bar' });
  const note = el('div', { class: 'pg-note' });
  let g = null;
  const firstWritable = () => ['house', 'form', 'user', 'screen'].find((k) => can[k]);
  const setEdit = (on) => {
    if (on && !writable()) {
      const k = firstWritable(); if (!k) { toast(T('Your account can look at this page, but not change it.')); return; }
      scope = k; lay[k] = { tiles: JSON.parse(JSON.stringify(tiles)) };   // starts from what's on screen
      toast(k === 'user' ? T('Your changes are kept for you only.') : T('Your changes are kept on this screen only.'));
    }
    document.body.classList.toggle('editing-on', on); g?.setEditing(on);
    editBtn.replaceChildren(icon(on ? 'check' : 'edit'), el('span', { class: on ? '' : 'hide-phone' }, on ? T('Done') : T('Edit'))); editBtn.classList.toggle('primary', on);
    drawBar();
  };
  editBtn.onclick = () => setEdit(!document.body.classList.contains('editing-on'));
  const scopeName = (k) => ({ house: T('Everyone'), form: T(FORM_NAMES[form]), user: T('Just me'), screen: T('This screen') })[k];
  const drawBar = () => {
    const opts = ['house', 'form', 'user', 'screen'].filter((k) => can[k] || k === scope);
    const seg = opts.length > 1 ? el('div', { class: 'seg seg-mini', role: 'group', 'aria-label': T('Who sees this layout') },
      opts.map((k) => el('button', { type: 'button', class: scope === k ? 'on' : '', disabled: !can[k] || null, onclick: () => switchScope(k) }, scopeName(k)))) : null;
    const who = { house: T('Everyone sees this layout.'), form: T('Every screen of this kind shows this layout.'), user: T('Only you see this layout.'), screen: T('Only this screen shows this layout.') }[scope];
    bar.replaceChildren(icon('grip', 18),
      el('div', { class: 'grow', style: 'min-width:0' }, el('div', {}, T('Drag a tile to move it, drag its corner to resize, or tap '), icon('sliders', 14), T(' for its size and options.')),
        el('div', { class: 'tiny muted' }, who)),
      seg, el('button', { class: 'btn small', onclick: () => addBtn.click() }, icon('plus', 14), T('Add')), el('button', { class: 'btn small', onclick: resetToSuggested }, icon('reset'), T('Reset to suggested')));
  };
  async function switchScope(k) {
    if (k === scope || !can[k]) return;
    if (SCOPE_ORDER[k] > SCOPE_ORDER[scope]) { scope = k; save(); toast(k === 'user' ? T('This page now keeps a layout just for you.') : k === 'form' ? T('Screens of this kind now share their own layout.') : T('This screen now keeps its own layout.')); }
    else {   // back to a wider one: the narrower layout is let go
      await post(`/api/page-layout/${page}`, { scope, screen: sid, form, reset: true }, 'PUT').catch(() => {});
      lay[scope] = null;
      for (const x of Object.keys(SCOPE_ORDER)) if (SCOPE_ORDER[x] > SCOPE_ORDER[k] && lay[x] && can[x]) { await post(`/api/page-layout/${page}`, { scope: x, screen: sid, form, reset: true }, 'PUT').catch(() => {}); lay[x] = null; }
      scope = k; tiles.splice(0, tiles.length, ...(saved() ? cloneTiles(saved().tiles) : inherited(k))); await g.build();
    }
    drawBar(); drawNote();
  }
  async function resetToSuggested() {
    tiles.splice(0, tiles.length, ...suggested());
    if (writable()) { await post(`/api/page-layout/${page}`, { scope, screen: sid, form, reset: true }, 'PUT').catch(() => {}); lay[scope] = null; }
    await g.build(); drawNote(); toast(T('Back to the suggested layout'));
  }
  /* Under the title: anything new the house can now show. */
  function drawNote() {
    const have = new Set(tiles.map(tileKey)), seen = new Set(saved()?.seen || []);
    const fresh = saved() ? (lay.suggested || []).filter((t) => !have.has(tileKey(t)) && !seen.has(tileKey(t)) && wOf(t)) : [];
    const kids = [];
    if (fresh.length && writable()) {
      const titles = [...new Set(fresh.map((t) => t.title || t.opts?.area || T(wOf(t).title)))].slice(0, 4).join(', ');
      kids.push(el('div', { class: 'callout pg-new' }, icon('spark'), el('div', { class: 'grow' }, el('b', {}, T('New for your home: ')), titles),
        el('button', { class: 'btn small primary', onclick: () => { for (const t of ownIds(cloneTiles(fresh))) g.add(String(t.id).split(':')[0], t); save(); drawNote(); } }, T('Add')),
        el('button', { class: 'btn small ghost', onclick: () => { save(); drawNote(); } }, T('Not now'))));
    }
    note.replaceChildren(...kids);
  }
  // ---- the gallery ----
  const onPick = (id, init) => {
    main.querySelector('.pg-empty')?.remove();
    const added = g.add(id, init);
    if (o.onAdded) o.onAdded(id, added);
    else if (wOf(added.t)?.askFirst) customizeTile(added.t, ctx, () => added.repaint());
  };
  addBtn.onclick = () => {
    if (!writable() && !firstWritable()) return toast(T('Your account can look at this page, but not change it.'));
    if (!document.body.classList.contains('editing-on')) setEdit(true);
    if (o.gallery) o.gallery({ tiles, ctx, suggested: lay.suggested || [], onPick });
    else tileGallery(page, tiles, lay.suggested || [], ctx, o.auto, onPick);
  };
  // ---- the page ----
  setTop(o.title, o.sub || '', [...(o.actions || []), addBtn, editBtn]);
  main.replaceChildren(bar, note, ...(o.before || []));
  main.dataset.drawn = '1';
  drawBar(); drawNote();
  g = makeGrid(main, { tiles, ctx, auto: !!o.auto, onSave: save, onEdit: setEdit, onCustomize: (t, done) => customizeTile(t, ctx, done) });
  const gridEl = main.querySelector('.grid'); gridEl?.classList.add('pagegrid', `pg-${page}`, ...(o.auto ? ['autorows'] : [])); if (gridEl) gridEl._ctx = ctx;
  if (!tiles.length) main.append(el('div', { class: 'card pg-empty' }, pgEmpty(o.emptyText || T('Nothing on this page yet.'), null, null), el('button', { class: 'btn small primary', onclick: () => addBtn.click() }, icon('plus'), T('Add a tile'))));
  await g.build();
  ctx.refresh = async () => { ctx.data = await o.load(); if (main.isConnected) await g.refresh(); };
  ctx.rebuild = () => g.build();
  ctx.grid = g;
  return ctx.refresh;
}

/* The gallery: every tile this page has, with what it shows, a live preview (fixed-size pages), its sizes, and a
   "Suggested" mark on the ones CasaTorch would put here for this house. A search box once there are many. */
function tileGallery(page, tiles, suggested, ctx, auto, onPick) {
  const have = new Set(tiles.map((t) => String(t.id).split(':')[0])), haveKeys = new Set(tiles.map(tileKey)), sugg = new Set(suggested.filter((t) => !haveKeys.has(tileKey(t))).map((t) => String(t.id).split(':')[0]));   // suggested and not here yet
  const all = pageTilesOf(page).filter((w) => w.multi || !have.has(w.id)).sort((a, b) => (sugg.has(b.id) - sugg.has(a.id)));
  const io = 'IntersectionObserver' in window && !auto ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); e.target.__show?.(); } }, { rootMargin: '120px' }) : null;
  const card = (w) => {
    const sizes = presetsFor(w), first = sizes.find(([, , [x, y]]) => x === (w.size?.[0] || 4) && y === (w.size?.[1] || 3)) || sizes[0];
    let chosen = first[2];
    const pv = el('div', { class: 'wg-prev' }, el('div', { class: 'wg-ic' }, icon(w.icon, 28)));
    pv.__show = () => { if (auto || w.noPreview || w.multi) return; const b = previewBox({ id: w.id, w: chosen[0], h: chosen[1], opts: {} }, w, ctx); pv.replaceChildren(b.stage); requestAnimationFrame(b.fit); };
    const sizeBar = el('div', { class: 'seg seg-mini' }, sizes.map(([, label, sz]) => el('button', { type: 'button', class: sz === chosen ? 'on' : '', title: T(label), onclick: (e) => { chosen = sz; [...sizeBar.children].forEach((x) => x.classList.toggle('on', x === e.currentTarget)); pv.__show(); } }, sizeShort(label))));
    const c = el('div', { class: 'wg-card' }, pv,
      el('div', { class: 'wg-meta' }, el('b', {}, T(w.title), w.pro ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'PRO') : null, sugg.has(w.id) ? el('span', { class: 'pill good', style: 'margin-left:6px' }, T('Suggested')) : null), el('div', { class: 'tiny muted' }, w.blurb ? T(w.blurb) : '')),
      sizes.length > 1 ? sizeBar : null,
      el('button', { class: 'btn small primary wg-add', onclick: () => { m.remove(); onPick(w.id, { w: chosen[0], h: chosen[1] }); } }, icon('plus'), T('Add')));
    io ? io.observe(pv) : pv.__show();
    return c;
  };
  const body = el('div', { class: 'wgallery' });
  const q = all.length > 8 ? el('input', { type: 'search', placeholder: T('Search tiles…'), 'aria-label': T('Search tiles'), style: 'margin-bottom:10px' }) : null;
  const draw = () => { const s = (q?.value || '').trim().toLowerCase(), list = all.filter((w) => !s || `${w.title} ${T(w.title)} ${w.blurb || ''} ${w.blurb ? T(w.blurb) : ''}`.toLowerCase().includes(s)); body.replaceChildren(...(list.length ? list.map(card) : [el('p', { class: 'muted' }, all.length ? T('No tile matches.') : T('Every tile is already on this page.'))])); };
  if (q) q.oninput = draw;
  draw();
  const m = modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('Tiles marked Suggested fit what your home has. Add any of them - you can resize and move them after.')), q, body), { title: T('Add a tile'), wide: true });
  m.querySelector('.box')?.classList.add('tall');
  new MutationObserver((_, ob) => { if (!m.isConnected) { io?.disconnect(); ob.disconnect(); } }).observe(document.body, { childList: true });
}
/* "S", "M", "L", "XL" on the size buttons: short in every language. */
const sizeShort = (label) => ({ Small: 'S', Medium: 'M', Large: 'L', 'Extra large': 'XL' })[label] || T(label);

/* ---- the same empty state and loading skeleton everywhere ---- */
/** An empty state: what's missing in one line, and a one-tap way to set it up. */
function pgEmpty(text, href = '#connect', label = T('Set this up')) {
  return el('div', { class: 'pg-empty-state' }, el('div', { class: 'small muted' }, text), href ? el('a', { class: 'btn small', href }, icon('plus', 14), label) : null);
}
/** A loading skeleton: a few soft bars that shimmer until the tile has drawn. */
function pgSkel(lines = 3) { return el('div', { class: 'pg-skel', 'aria-hidden': 'true' }, Array.from({ length: lines }, (_, i) => el('i', { style: `width:${[70, 92, 54, 80][i % 4]}%` }))); }

/* ---- small chart helpers shared by page tiles (inline SVG, no libraries) ---- */
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, ...kids) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v); for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); return e; }
/* A sparkline: a 2px line with a soft wash under it and a dot at the end. vals: numbers (null = no reading). */
function pgSpark(vals, { w = 120, h = 34, cls = '', label = '', max: top, min: bottom } = {}) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: `spark ${cls}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label });
  if (pts.length < 2) return svg;
  const max = top ?? Math.max(...pts.map(([, v]) => v)), min = bottom ?? 0, X = (i) => (i / (vals.length - 1)) * (w - 4) + 2, Y = (v) => h - 3 - ((v - min) / Math.max(1e-9, max - min)) * (h - 7);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  svg.append(svgEl('path', { d: `${d}L${X(pts.at(-1)[0]).toFixed(1)},${h}L${X(pts[0][0]).toFixed(1)},${h}Z`, class: 'spark-area' }), svgEl('path', { d, class: 'spark-line' }), svgEl('circle', { cx: X(pts.at(-1)[0]), cy: Y(pts.at(-1)[1]), r: 2.6, class: 'spark-dot' }));
  return svg;
}
/** A line chart over time: the lowest and highest reading marked, "24 h ago" to "now" under it, and the reading at the
    pointer. vals: numbers (null = no reading), oldest first; end: ms of the last; step: ms between readings. */
function pgLine(vals, { end = Date.now(), step = 300_000, fmt: f = (v) => String(v), label = '', cls = '', h = 120 } = {}) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 2) return el('div', { class: 'tiny muted pg-line-none' }, T('The chart fills in as readings come in.'));
  const lo = Math.min(...pts.map(([, v]) => v)), hi = Math.max(...pts.map(([, v]) => v)), pad = (hi - lo) * 0.15 || 1;
  const wrap = el('div', { class: `pg-line ${cls}` });
  const spark = pgSpark(vals, { w: 400, h, label, min: lo - pad, max: hi + pad, cls: 'pg-line-svg' });
  const hours = Math.round((vals.length * step) / 3600_000);
  wrap.append(el('div', { class: 'pg-line-y' }, el('span', {}, f(hi)), el('span', {}, f(lo))), spark,
    el('div', { class: 'pg-line-x tiny muted' }, el('span', {}, T('{n} h ago', { n: hours })), el('span', {}, T('now'))));
  const tip = chartTip();
  spark.addEventListener('pointermove', (e) => {
    const r = spark.getBoundingClientRect(), i = Math.max(0, Math.min(vals.length - 1, Math.round(((e.clientX - r.left) / r.width) * (vals.length - 1)))), v = vals[i];
    if (!Number.isFinite(v)) return tip.hide();
    tip.show(e, [el('b', {}, f(v)), el('div', { class: 'tiny' }, fmt(new Date(end - (vals.length - 1 - i) * step).toISOString(), { hour: 'numeric', minute: '2-digit' }))]);
  });
  spark.addEventListener('pointerleave', () => tip.hide());
  return wrap;
}
/* A floating tooltip for charts: one per page, follows the pointer. */
function chartTip() {
  let tip = document.getElementById('charttip');
  if (!tip) { tip = el('div', { id: 'charttip', role: 'status' }); document.body.append(tip); }
  return {
    show(e, html) { tip.replaceChildren(...(Array.isArray(html) ? html : [html])); tip.style.display = 'block'; const r = tip.getBoundingClientRect(), x = Math.min(innerWidth - r.width - 8, Math.max(8, e.clientX - r.width / 2)), y = e.clientY - r.height - 14 < 8 ? e.clientY + 18 : e.clientY - r.height - 14; tip.style.left = `${x}px`; tip.style.top = `${y}px`; },
    hide() { tip.style.display = 'none'; },
  };
}

/* ---- device history for size-adaptive tiles (60-layout.js keeps 24 h of each sensor's number) ---- */
const devHistory = (ids) => (ids.length ? wget(`/api/device-history?ids=${encodeURIComponent(ids.slice(0, 40).join(','))}`, 120_000).then((r) => r.series || {}).catch(() => ({})) : Promise.resolve({}));
/** How to show a device's history numbers. */
const histFmt = (field, d) => (v) => (field === 'tempC' ? tempOf(v) : field === 'humidity' ? `${Math.round(v)}%` : field === 'powerW' ? `${Math.round(v)} W` : `${Math.round(v * 10) / 10}${d?.unit ? ` ${d.unit}` : ''}`);
if (window.__casatorchTest) Object.assign(window.__casatorchTest, { sizeTier });
