/* ======================================================================
 * The page grid: every page as a grid of tiles you can add, remove, resize and drag around - the same
 * mechanics as the Home screen (makeGrid, 05-grid.js), with tiles made for that page. Used by Energy,
 * Cameras, Controls and Alerts.
 *
 *  - Smart defaults: until someone arranges a page, the server suggests a layout from what the house has
 *    (suggestPageTiles in 60-layout.js): solar gets the power-flow tile, Frigate gets Detections, a house
 *    with only lights gets just lights. The suggestion follows new devices by itself; once a page is arranged,
 *    new suggestions are offered in one tap ("New for your home").
 *  - Edit: Edit (or press and hold a tile) - drag to move, drag the corner to resize, the sliders button for
 *    a tile's size (Small, Medium, Large, Extra large), name and options, x to remove; "Add tile" opens the
 *    page's gallery. "Reset to suggested" goes back to CasaTorch's layout.
 *  - Whose layout: Everyone (admins), Just me (when sign-in is on), or This screen (the kitchen tablet).
 *    Saved on the box: /api/page-layout/<page>.
 *
 * Putting another page on it (Network is next):
 *   1. Tiles: pageTile({ id: 'net-wifi', page: 'network', title: 'Wi-Fi', icon: 'wifi', blurb: 'One line for the gallery',
 *        size: [6, 3], min: [3, 2], max: [12, 8], render(body, ctx, size) { ... }, options?, multi?, askFirst?, live? })
 *      Ids start with the page's own prefix. ctx.data is what the page's load() returned; ctx.refresh() reloads it.
 *      size = { w, h, narrow (phone), span, cols } - draw for the room you're given. Strings through T().
 *   2. Server: add the page to PAGES in 60-layout.js, its facts to pageFacts() and its default tiles to suggestPageTiles().
 *   3. The page: render(main) { return pageGrid(main, { page: 'network', title: T('Network'), sub, load: async () => data, auto: false, actions: [] }); }
 *      auto: true sizes tiles to their content (lists, camera walls) - sizes are then widths only.
 * ====================================================================== */
const PAGE_TILES = {};   // page -> [tile ids]
const AUTO_PRESETS = [['s', 'Small', [4, 1]], ['m', 'Medium', [6, 1]], ['l', 'Large', [8, 1]], ['xl', 'Extra large', [12, 1]]];
function pageTile(def) {
  const auto = def.auto;
  widget({ ...(auto ? { min: [4, 1], max: [12, 1], size: [6, 1], presets: AUTO_PRESETS } : {}), ...def, hidden: true, cat: def.page });
  (PAGE_TILES[def.page] ||= []).push(def.id);
}
const pageTilesOf = (page) => (PAGE_TILES[page] || []).map((id) => WIDGETS[id]).filter(Boolean);
const tileKey = (t) => `${String(t.id).split(':')[0]}${t.device ? `@${t.device}` : ''}${t.opts?.group ? `#${t.opts.group}` : ''}`;   // "the same tile" across layouts
const cloneTiles = (list) => (list || []).filter((t) => wOf(t)).map((t) => JSON.parse(JSON.stringify(t)));
/* Multi tiles in a suggestion arrive without their own id ("en-dev"): each gets one, so they can be moved apart. */
const ownIds = (list) => list.map((t) => (wOf(t)?.multi && !String(t.id).includes(':') ? { ...t, id: `${t.id}:${Math.random().toString(36).slice(2, 8)}` } : t));

async function pageGrid(main, o) {
  const { page } = o, sid = screenId();
  const getLay = () => api(`/api/page-layout/${page}${sid ? `?screen=${sid}` : ''}`).catch(() => ({ suggested: [] }));
  const [data, lay, me] = await Promise.all([o.load(), getLay(), S.me ? Promise.resolve(S.me) : api('/api/auth/me').catch(() => null)]);
  if (me) S.me = me;
  if (!main.isConnected && main.dataset.drawn) return null;
  const ctx = { data, page, refresh: null };
  const role = me?.user?.role || 'viewer', panel = !!me?.user?.panel;
  const can = { house: ['admin', 'owner'].includes(role) && !panel, user: !!lay.canUser, screen: ['member', 'admin', 'owner'].includes(role) && !!sid };
  let scope = lay.screen ? 'screen' : lay.user ? 'user' : 'house';
  const saved = () => lay[scope];
  const suggested = () => ownIds(cloneTiles(lay.suggested));
  let tiles = saved() ? cloneTiles(saved().tiles) : suggested();
  const writable = () => can[scope];
  let saveT = null;
  const save = () => {
    if (!writable()) return;
    lay[scope] = { tiles: JSON.parse(JSON.stringify(tiles)), seen: (lay.suggested || []).map(tileKey) };
    clearTimeout(saveT);
    saveT = setTimeout(() => post(`/api/page-layout/${page}`, { scope, screen: sid, tiles, seen: lay[scope].seen }, 'PUT').catch((e) => toast(T('Layout not saved: {message}', { message: e.message }))), 400);
    drawNote();
  };
  // ---- the bar while editing ----
  const editBtn = el('button', { class: 'btn' }, icon('edit'), T('Edit'));
  const addBtn = el('button', { class: 'btn primary' }, icon('plus'), T('Add tile'));
  const bar = el('div', { class: 'editbar pg-bar' });
  const note = el('div', { class: 'pg-note' });
  let g = null;
  const firstWritable = () => ['house', 'user', 'screen'].find((k) => can[k]);
  const setEdit = (on) => {
    if (on && !writable()) {
      const k = firstWritable(); if (!k) { toast(T('Your account can look at this page, but not change it.')); return; }
      scope = k; lay[k] = { tiles: JSON.parse(JSON.stringify(tiles)) };   // starts from what's on screen
      toast(k === 'user' ? T('Your changes are kept for you only.') : T('Your changes are kept on this screen only.'));
    }
    document.body.classList.toggle('editing-on', on); g?.setEditing(on);
    editBtn.replaceChildren(icon(on ? 'check' : 'edit'), on ? T('Done') : T('Edit')); editBtn.classList.toggle('primary', on);
    drawBar();
  };
  editBtn.onclick = () => setEdit(!document.body.classList.contains('editing-on'));
  const drawBar = () => {
    const names = { house: T('Everyone'), user: T('Just me'), screen: T('This screen') };
    const opts = ['house', 'user', 'screen'].filter((k) => can[k] || k === scope);
    const seg = opts.length > 1 ? el('div', { class: 'seg seg-mini', role: 'group', 'aria-label': T('Who sees this layout') },
      opts.map((k) => el('button', { type: 'button', class: scope === k ? 'on' : '', disabled: !can[k] || null, onclick: () => switchScope(k) }, names[k]))) : null;
    bar.replaceChildren(icon('grip', 18),
      el('div', { class: 'grow', style: 'min-width:0' }, el('div', {}, T('Drag a tile to move it, drag its corner to resize, or tap '), icon('sliders', 14), T(' for its size and options.')),
        el('div', { class: 'tiny muted' }, scope === 'house' ? T('Everyone sees this layout.') : scope === 'user' ? T('Only you see this layout.') : T('Only this screen shows this layout.'))),
      seg, el('button', { class: 'btn small', onclick: resetToSuggested }, icon('reset'), T('Reset to suggested')));
  };
  async function switchScope(k) {
    if (k === scope || !can[k]) return;
    const narrower = (x) => ({ house: 0, user: 1, screen: 2 })[x];
    if (narrower(k) > narrower(scope)) { scope = k; save(); toast(k === 'user' ? T('This page now keeps a layout just for you.') : T('This screen now keeps its own layout.')); }
    else {   // back to a wider one: the narrower layout is let go
      await post(`/api/page-layout/${page}`, { scope, screen: sid, reset: true }, 'PUT').catch(() => {});
      lay[scope] = null; scope = k; tiles.splice(0, tiles.length, ...(saved() ? cloneTiles(saved().tiles) : suggested())); await g.build();
    }
    drawBar(); drawNote();
  }
  async function resetToSuggested() {
    tiles.splice(0, tiles.length, ...suggested());
    if (writable()) { await post(`/api/page-layout/${page}`, { scope, screen: sid, reset: true }, 'PUT').catch(() => {}); lay[scope] = null; }
    await g.build(); drawNote(); toast(T('Back to the suggested layout'));
  }
  /* Under the title: suggested or arranged - and anything new the house can now show. */
  function drawNote() {
    const have = new Set(tiles.map(tileKey)), seen = new Set(saved()?.seen || []);
    const fresh = saved() ? (lay.suggested || []).filter((t) => !have.has(tileKey(t)) && !seen.has(tileKey(t)) && wOf(t)) : [];
    const kids = [];
    if (fresh.length && writable()) {
      const titles = [...new Set(fresh.map((t) => t.title || T(wOf(t).title)))].slice(0, 4).join(', ');
      kids.push(el('div', { class: 'callout pg-new' }, icon('spark'), el('div', { class: 'grow' }, el('b', {}, T('New for your home: ')), titles),
        el('button', { class: 'btn small primary', onclick: () => { for (const t of ownIds(cloneTiles(fresh))) g.add(String(t.id).split(':')[0], t); save(); drawNote(); } }, T('Add')),
        el('button', { class: 'btn small ghost', onclick: () => { save(); drawNote(); } }, T('Not now'))));
    }
    note.replaceChildren(...kids);
  }
  // ---- the gallery: this page's tiles ----
  addBtn.onclick = () => {
    if (!writable() && !firstWritable()) return toast(T('Your account can look at this page, but not change it.'));
    if (!document.body.classList.contains('editing-on')) setEdit(true);
    tileGallery(page, tiles, lay.suggested || [], ctx, o.auto, (id, init) => {
      main.querySelector('.pg-empty')?.remove();
      const added = g.add(id, init);
      if (wOf(added.t)?.askFirst) customizeTile(added.t, ctx, () => added.repaint());
    });
  };
  // ---- the page ----
  setTop(o.title, o.sub || '', [...(o.actions || []), addBtn, editBtn]);
  main.replaceChildren(bar, note, ...(o.before || []));
  main.dataset.drawn = '1';
  drawBar(); drawNote();
  g = makeGrid(main, { tiles, ctx, onSave: save, onEdit: setEdit, onCustomize: (t, done) => customizeTile(t, ctx, done) });
  const gridEl = main.querySelector('.grid'); gridEl?.classList.add('pagegrid', `pg-${page}`, ...(o.auto ? ['autorows'] : [])); if (gridEl) gridEl._ctx = ctx;
  if (!tiles.length) main.append(el('div', { class: 'card empty pg-empty' }, T('Nothing on this page yet.'), ' ', el('button', { class: 'btn small', onclick: () => addBtn.click() }, icon('plus'), T('Add tile'))));
  await g.build();
  ctx.refresh = async () => { ctx.data = await o.load(); if (main.isConnected) await g.refresh(); };
  ctx.rebuild = () => g.build();
  return ctx.refresh;
}

/* The gallery: every tile this page has, with what it shows, a live preview (fixed-size pages), its sizes, and a
   "Suggested" mark on the ones CasaTorch would put here for this house. */
function tileGallery(page, tiles, suggested, ctx, auto, onPick) {
  const have = new Set(tiles.map((t) => String(t.id).split(':')[0])), sugg = new Set(suggested.map((t) => t.id));
  const list = pageTilesOf(page).filter((w) => w.multi || !have.has(w.id)).sort((a, b) => (sugg.has(b.id) - sugg.has(a.id)));
  const io = 'IntersectionObserver' in window && !auto ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); e.target.__show?.(); } }, { rootMargin: '120px' }) : null;
  const card = (w) => {
    const sizes = presetsFor(w), first = sizes.find(([, , [x, y]]) => x === (w.size?.[0] || 4) && y === (w.size?.[1] || 3)) || sizes[0];
    let chosen = first[2];
    const pv = el('div', { class: 'wg-prev' }, el('div', { class: 'wg-ic' }, icon(w.icon, 28)));
    pv.__show = () => { if (auto || w.noPreview || w.multi) return; const b = previewBox({ id: w.id, w: chosen[0], h: chosen[1], opts: {} }, w, ctx); pv.replaceChildren(b.stage); requestAnimationFrame(b.fit); };
    const sizeBar = el('div', { class: 'seg seg-mini' }, sizes.map(([, label, sz]) => el('button', { type: 'button', class: sz === chosen ? 'on' : '', title: T(label), onclick: (e) => { chosen = sz; [...sizeBar.children].forEach((x) => x.classList.toggle('on', x === e.currentTarget)); pv.__show(); } }, T(label).replace(T('Extra large'), 'XL'))));
    const c = el('div', { class: 'wg-card' }, pv,
      el('div', { class: 'wg-meta' }, el('b', {}, T(w.title), w.pro ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'PRO') : null, sugg.has(w.id) ? el('span', { class: 'pill good', style: 'margin-left:6px' }, T('Suggested')) : null), el('div', { class: 'tiny muted' }, w.blurb ? T(w.blurb) : '')),
      sizes.length > 1 ? sizeBar : null,
      el('button', { class: 'btn small primary wg-add', onclick: () => { m.remove(); onPick(w.id, { w: chosen[0], h: chosen[1] }); } }, icon('plus'), T('Add')));
    io ? io.observe(pv) : pv.__show();
    return c;
  };
  const body = el('div', { class: 'wgallery' }, list.length ? list.map(card) : el('p', { class: 'muted' }, T('Every tile is already on this page.')));
  const m = modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('Tiles marked Suggested fit what your home has. Add any of them - you can resize and move them after.')), body), { title: T('Add a tile'), wide: true });
  m.querySelector('.box')?.classList.add('tall');
  new MutationObserver((_, ob) => { if (!m.isConnected) { io?.disconnect(); ob.disconnect(); } }).observe(document.body, { childList: true });
}

/* ---- small chart helpers shared by page tiles (inline SVG, no libraries) ---- */
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, ...kids) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v); for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); return e; }
/* A sparkline: a 2px line with a soft wash under it and a dot at the end. vals: numbers (null = no reading). */
function pgSpark(vals, { w = 120, h = 34, cls = '', label = '', max: top } = {}) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: `spark ${cls}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label });
  if (pts.length < 2) return svg;
  const max = top ?? Math.max(...pts.map(([, v]) => v)), min = 0, X = (i) => (i / (vals.length - 1)) * (w - 4) + 2, Y = (v) => h - 3 - ((v - min) / Math.max(1e-9, max - min)) * (h - 7);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  svg.append(svgEl('path', { d: `${d}L${X(pts.at(-1)[0]).toFixed(1)},${h}L${X(pts[0][0]).toFixed(1)},${h}Z`, class: 'spark-area' }), svgEl('path', { d, class: 'spark-line' }), svgEl('circle', { cx: X(pts.at(-1)[0]), cy: Y(pts.at(-1)[1]), r: 2.6, class: 'spark-dot' }));
  return svg;
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
