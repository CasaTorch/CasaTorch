/* ======================================================================
 * Tap any tile for more. ONE drawer for every tile on every page: a sheet from the bottom on a phone, a panel
 * from the side on a tablet or computer. Same header everywhere - the tile's icon and name, where the numbers come
 * from and when they were updated, a "?" to the guide, the drawer's own actions and Close.
 *
 *  - Opens with a tap anywhere on a tile that isn't one of its own controls (a switch, a slider, a button or a
 *    link inside a tile keep doing what they do), with the small "›" in the tile's corner, or Enter on it. Never
 *    while arranging (Edit).
 *  - Closes with Close, Esc, a tap outside, swiping it away (down on a phone, right on a big screen), or Back.
 *  - The address says what's open (#energy?tile=en-top, #controls?dev=ha:light.kitchen), so a drawer can be
 *    linked to, reloaded, and Back closes it. Focus moves in, Tab stays inside, and returns to the tile after.
 *  - What's inside loads when it opens (through api(): time limits, a retry, the last answer when offline),
 *    is kept for a little while (wget), and shows a skeleton of the same height until it lands - nothing jumps.
 *
 * THE API:
 *   tileDrawer(widgetIds, { title?(a), doc?, sub?(data, a), source?(data), updated?(data), every?, wide?,
 *                           load?(a, signal) -> data, render(body, data, a, d), actions?(data, a, d) -> [nodes] })
 *      a = { t, ctx, w, node, size } (the tile), d = { refresh(), close(), setSub(text), body }.
 *      A tile without one gets the generic drawer: the tile itself at its biggest, plus what it is.
 *   openDrawer({ route: [name, value]?, title, titleOf?(data), icon, doc?, sub?, load?, render, actions?, back?, onClose?, every? })
 *   drawerRoute(name, (value) => void) - what a deep link like #page?name=value opens.
 *   closeDrawer()
 * ====================================================================== */
const TILE_DRAWERS = {};
const DRAWER_ROUTES = {};
function tileDrawer(ids, spec) { for (const id of [].concat(ids)) TILE_DRAWERS[id] = spec; }
function drawerRoute(name, fn) { DRAWER_ROUTES[name] = fn; }

/* @drroute:start */
/** #energy?tile=en-top -> { page: 'energy', name: 'tile', value: 'en-top' } (no drawer: name null). */
function drParse(hash) {
  const s = String(hash || '').replace(/^#/, ''), i = s.indexOf('?');
  const page = i < 0 ? s : s.slice(0, i);
  let name = null, value = null;
  if (i >= 0) for (const [k, v] of new URLSearchParams(s.slice(i + 1))) { if (/^[a-z]{2,8}$/.test(k)) { name = k; value = v; break; } }
  return { page, name, value };
}
/** The address of a page with (or without) a drawer open on it. */
const drHash = (page, name, value) => `#${page || 'home'}${name ? `?${name}=${encodeURIComponent(String(value))}` : ''}`;
/** What a change of address means: 'drawer' (the same page - only the drawer opened, closed or changed), 'page+drawer'
    (another page with a drawer open on it) or 'page'. An empty address is Home. */
function drChange(oldHash, newHash) {
  const a = drParse(oldHash), b = drParse(newHash);
  if ((a.page || 'home') === (b.page || 'home')) return 'drawer';
  return b.name ? 'page+drawer' : 'page';
}
/** Does a tap open the tile's drawer? Not while arranging, not on the tile's own controls, not when the tap already
    opened something of its own (a camera's full view, a device's controls), and not when text is being selected. */
const drTapOpens = ({ editing, onControl, opened, selecting }) => !editing && !onControl && !opened && !selecting;
/* @drroute:end */

/* What counts as a control inside a tile: these keep their own tap. */
const DR_CONTROLS = 'a[href], button, input, select, textarea, label, summary, video, audio, iframe, [role=button], [role=link], [role=tab], [role=slider], [role=switch], [role=checkbox], [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex="-1"]), .dev, .dev-wrap, .tools, .sizer, .rd, .stack-dots, .hh-c, .nw-ip, .chip, .seg, .al-tap, .cam';
const DR = { el: null, route: null, pushed: false, ctl: null, pending: null, ignore: 0, timer: null, opts: null };
const drCurPage = () => drParse(location.hash).page || 'home';
const drReduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* A link from outside (or a reload) with a drawer in it: the page opens first, the drawer once its tiles are drawn. */
{
  const p = drParse(location.hash);
  if (p.name) { DR.pending = p; history.replaceState(null, '', p.page ? `#${p.page}` : location.pathname + location.search); }
}
/* Before the pages' own listener (00-core.js shows the page on every change of address): a drawer opening or closing
   isn't a new page, so the page stays as it is - no redraw, no flash. */
addEventListener('hashchange', (e) => {
  let was = ''; try { was = new URL(e.oldURL).hash; } catch { /* fine */ }
  const kind = drChange(was, location.hash);
  if (kind === 'drawer') { e.stopImmediatePropagation(); drSync(); return; }
  if (DR.el) closeDrawer({ fromHash: true });
  if (kind === 'page+drawer') {
    e.stopImmediatePropagation();
    const p = drParse(location.hash); DR.pending = p;
    history.replaceState(null, '', `#${p.page}`);
    show(p.page);
  }
});
function drSync() {
  const p = drParse(location.hash);
  if (DR.ignore) { DR.ignore--; if (!p.name) return; }
  if (!p.name) { if (DR.el) closeDrawer({ fromHash: true }); return; }
  if (DR.route && DR.route[0] === p.name && DR.route[1] === p.value) return;
  drOpenRoute(p.name, p.value);
}
function drOpenRoute(name, value) {
  const f = DRAWER_ROUTES[name];
  if (!f) return false;
  try { return f(value, { fromHash: true }) !== false; } catch { return false; }
}
/** Called by a page once its tiles are drawn (06-pagegrid.js): a drawer the address asked for opens now. */
function drawerReady() {
  const p = DR.pending; if (!p) return;
  if ((p.page || 'home') !== drCurPage()) return;
  DR.pending = null;
  if (drOpenRoute(p.name, p.value)) history.replaceState(null, '', drHash(p.page, p.name, p.value));
}

/* ---- the drawer itself ---- */
const drSkel = (lines = 6) => el('div', { class: 'dr-skel', 'aria-hidden': 'true' }, el('i', { class: 'dr-skel-hero' }), el('i', { class: 'dr-skel-chart' }), Array.from({ length: lines }, (_, i) => el('i', { class: 'dr-skel-line', style: `width:${[92, 76, 84, 60, 88, 70][i % 6]}%` })));
function drFail(err, retry) {
  const off = !navigator.onLine || err?.retry || NET.status().offline;
  return el('div', { class: 'dr-fail', role: 'alert' }, icon(off ? 'wifi' : 'info', 22), el('b', {}, off ? T('Can\'t reach your home right now') : T('This didn\'t load')),
    el('div', { class: 'small muted' }, off ? T('It opens by itself once the connection is back.') : err?.message || ''), el('button', { class: 'btn small', onclick: retry }, icon('reset'), T('Try again')));
}
/** A section inside a drawer: a small heading and what's under it. */
const drSection = (title, ...kids) => el('section', { class: 'dr-sec' }, title ? el('h3', { class: 'dr-h' }, title) : null, ...kids.flat().filter((x) => x != null && x !== false));
/** Label / value pairs. */
const drFacts = (rows) => { const r = rows.filter(([, v]) => v != null && v !== '' && v !== false); return r.length ? el('dl', { class: 'kv small dr-kv' }, r.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null; };
/** A row of small segment buttons; pick(k) is called with the key chosen. */
function drSeg(items, cur, pick) {
  const box = el('div', { class: 'seg seg-mini dr-seg', role: 'group' });
  const draw = (k) => box.replaceChildren(...items.map(([key, label]) => el('button', { type: 'button', class: key === k ? 'on' : '', 'aria-pressed': String(key === k), onclick: () => { draw(key); pick(key); } }, label)));
  draw(cur); return box;
}

function openDrawer(o) {
  clearInterval(DR.timer); DR.timer = null;
  DR.ctl?.abort();
  const ctl = new AbortController(); DR.ctl = ctl;
  const reuse = !!DR.el?.isConnected;
  if (reuse) { try { DR.opts?.onClose?.(); } catch { /* its own problem */ } }   // the drawer it replaces lets go of what it held (a live camera)
  DR.opts = o;
  let root = DR.el;
  if (!reuse) {
    DR.back = o.back || document.activeElement;
    root = el('div', { id: 'drawer', class: `dr${o.wide ? ' dr-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dr-title' },
      el('div', { class: 'dr-scrim', onclick: () => closeDrawer() }),
      el('aside', { class: 'dr-panel', tabindex: '-1' }, el('div', { class: 'dr-grab', 'aria-hidden': 'true' }), el('header', { class: 'dr-head' }), el('div', { class: 'dr-body' })));
    document.body.append(root); DR.el = root;
    document.documentElement.classList.add('dr-lock');
    drKeys(root); drSwipe(root);
    if (!drReduce()) { root.classList.add('dr-in'); requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('dr-in'))); }
  } else root.classList.toggle('dr-wide', !!o.wide);
  const panel = root.querySelector('.dr-panel'), head = root.querySelector('.dr-head'), body = root.querySelector('.dr-body');
  // ---- the header ----
  const sub = el('div', { class: 'dr-sub tiny muted', 'aria-live': 'polite' }, typeof o.sub === 'string' ? o.sub : '');
  const acts = el('div', { class: 'dr-acts' });
  const doc = o.doc && typeof docLink === 'function' ? docLink(o.doc, { icon: true }) : null;
  if (doc) doc.classList.add('dr-doc');
  head.replaceChildren(el('span', { class: 'dr-ic' }, icon(o.icon || 'info', 20)),
    el('div', { class: 'dr-tt' }, el('h2', { id: 'dr-title' }, o.title || ''), sub), acts, doc,
    el('button', { type: 'button', class: 'dr-x', 'aria-label': T('Close'), title: T('Close'), onclick: () => closeDrawer() }, icon('x', 18)));
  const d = {
    body, signal: ctl.signal,
    setSub: (text) => { sub.textContent = text || ''; },
    close: () => closeDrawer(),
    refresh: () => run(true),
  };
  const setHead = (data) => {
    if (typeof o.titleOf === 'function') { const tt = o.titleOf(data); if (tt) head.querySelector('#dr-title').textContent = tt; }
    const parts = [typeof o.sub === 'function' ? o.sub(data) : o.sub, o.source?.(data)].filter(Boolean);
    const at = o.updated?.(data);
    if (at && Date.parse(at)) parts.push(T('Updated {when}', { when: ago(at) || T('just now') }));
    sub.textContent = parts.join(' · ');
    const a = typeof o.actions === 'function' ? o.actions(data, d) : o.actions;
    acts.replaceChildren(...(a || []).filter(Boolean));
  };
  // ---- what's inside: a skeleton until it lands; a refresh keeps what's there until the new answer is in ----
  let busy = false;
  async function run(quiet = false) {
    if (busy || ctl.signal.aborted) return; busy = true;
    if (!quiet) { body.replaceChildren(drSkel()); body.setAttribute('aria-busy', 'true'); }
    try {
      const data = o.load ? await o.load(ctl.signal) : null;
      if (ctl.signal.aborted || DR.ctl !== ctl) return;
      const keep = quiet ? body.scrollTop : 0;
      const fresh = el('div', { class: 'dr-content' });
      fresh.append = (...k) => Element.prototype.append.apply(fresh, k.flat().filter((x) => x != null && x !== false && x !== ''));   // a missing part is just left out
      await o.render(fresh, data, d);
      if (ctl.signal.aborted || DR.ctl !== ctl) return;
      body.replaceChildren(fresh); body.scrollTop = keep;
      setHead(data);
    } catch (err) {
      if (ctl.signal.aborted || err?.aborted) return;
      if (!quiet) body.replaceChildren(drFail(err, () => run()));
    } finally { busy = false; body.removeAttribute('aria-busy'); }
  }
  setHead(null);
  // ---- the address ----
  if (o.route) {
    const h = drHash(drCurPage(), o.route[0], o.route[1]);
    if (!o.fromHash && location.hash !== h) {
      if (reuse && DR.route) history.replaceState(history.state, '', h);
      else { history.pushState({ ctDrawer: 1 }, '', h); DR.pushed = true; }
    }
    DR.route = [o.route[0], String(o.route[1])];
  } else DR.route = null;
  if (!reuse) requestAnimationFrame(() => { if (root.isConnected && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true }); });
  run();
  if (o.every) DR.timer = setInterval(() => { if (!document.hidden && DR.ctl === ctl && !$('#modal')) run(true); }, o.every);
  return d;
}
function closeDrawer({ fromHash = false } = {}) {
  const root = DR.el; if (!root) return;
  clearInterval(DR.timer); DR.timer = null;
  DR.ctl?.abort(); DR.ctl = null;
  const o = DR.opts || {}, route = DR.route, back = DR.back;
  DR.el = null; DR.route = null; DR.opts = null;
  document.documentElement.classList.remove('dr-lock');
  if (drReduce()) root.remove(); else { root.classList.add('dr-out'); setTimeout(() => root.remove(), 220); }
  if (back?.isConnected) back.focus?.({ preventScroll: true });
  try { o.onClose?.(); } catch { /* its own problem */ }
  if (!fromHash && route) {
    if (DR.pushed && history.state?.ctDrawer) { DR.ignore++; history.back(); }
    else history.replaceState(null, '', drHash(drCurPage()));
  }
  DR.pushed = false;
}
/* Esc closes it (a sheet opened from inside it closes first), and Tab stays inside it. */
function drKeys(root) {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const panel = root.querySelector('.dr-panel');
    const f = [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent || x === document.activeElement);
    if (!f.length) { e.preventDefault(); panel.focus(); return; }
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !DR.el || $('#modal') || document.querySelector('.rd-full, .camv-max')) return;
  e.preventDefault(); closeDrawer();
}, true);
/* Swipe it away: down on a phone (from its top), right on a bigger screen (from its header). */
function drSwipe(root) {
  const panel = root.querySelector('.dr-panel');
  let s = null;
  panel.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button, a, input, select, textarea')) return;
    const phone = innerWidth <= 760, body = root.querySelector('.dr-body');
    const fromTop = e.target.closest('.dr-head, .dr-grab') || (phone && e.pointerType === 'touch' && body.scrollTop <= 0 && body.contains(e.target) && !e.target.closest('.dr-noswipe, svg, canvas, .cam, .camv, input[type=range]'));
    if (!fromTop) return;
    s = { x: e.clientX, y: e.clientY, t: Date.now(), phone, id: e.pointerId, on: false, d: 0 };
  });
  panel.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const d = s.phone ? e.clientY - s.y : e.clientX - s.x, across = s.phone ? Math.abs(e.clientX - s.x) : Math.abs(e.clientY - s.y);
    if (!s.on) { if (d > 8 && d > across) { s.on = true; try { panel.setPointerCapture?.(e.pointerId); } catch { /* a pointer the browser no longer tracks */ } panel.classList.add('dr-drag'); } else if (across > 12 || d < -8) { s = null; return; } else return; }
    s.d = Math.max(0, d); panel.style.transform = s.phone ? `translateY(${s.d}px)` : `translateX(${s.d}px)`;
    e.preventDefault();
  });
  const end = () => {
    if (!s) return;
    const fast = s.d / Math.max(1, Date.now() - s.t) > 0.6, far = s.d > (s.phone ? 110 : 120);
    panel.classList.remove('dr-drag');
    if (s.on && (far || (fast && s.d > 30))) { panel.style.transform = ''; closeDrawer(); } else panel.style.transform = '';
    s = null;
  };
  panel.addEventListener('pointerup', end); panel.addEventListener('pointercancel', end);
}

/* ---- tiles: the "›" in each tile's corner, and a tap anywhere that isn't a control ---- */
function drDecorate(node) {
  if (node._dr || node.classList.contains('ph') || !node.dataset.id) return;
  const w = wOf({ id: node.dataset.id }); if (!w) return;
  node._dr = true;
  const name = () => node.getAttribute('aria-label') || T(w.title);
  const b = el('button', { type: 'button', class: 'tile-open', title: T('More'), 'aria-label': T('More about {title}', { title: name() }), onclick: (e) => { e.stopPropagation(); drOpenTile(node); } }, icon('chevr', 15));
  const head = node.querySelector(':scope > .tile-h');
  if (head) head.append(b); else { b.classList.add('bare'); node.append(b); }
}
{
  const seen = (n) => {
    if (n.nodeType !== 1) return;
    if (n.tagName === 'SECTION' && n.classList.contains('tile')) { if (n.parentElement?.classList.contains('grid')) drDecorate(n); return; }
    if (n.classList.contains('grid') || n.classList.contains('view-next') || n.classList.contains('view-in') || n.dataset?.page) n.querySelectorAll('.grid > section.tile').forEach(drDecorate);
  };
  const start = () => { const v = $('#view'); if (!v) return; new MutationObserver((rs) => { for (const r of rs) for (const n of r.addedNodes) seen(n); }).observe(v, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
let drModalAtDown = false, drDownAt = null;
document.addEventListener('pointerdown', (e) => { drModalAtDown = !!$('#modal'); drDownAt = [e.clientX, e.clientY]; }, true);
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button > 0) return;
  const tile = e.target.closest?.('#view .grid > section.tile');
  if (!tile || tile.classList.contains('ph') || !tile.isConnected) return;
  const ctl = e.target.closest(DR_CONTROLS);
  const opens = drTapOpens({
    editing: document.body.classList.contains('editing-on') || tile.parentElement?.classList.contains('editing'),
    onControl: !!(ctl && ctl !== tile && tile.contains(ctl) && !ctl.classList.contains('tile-open')),
    opened: (!!$('#modal') && !drModalAtDown) || !!document.querySelector('.rd-full'),
    selecting: !!String(getSelection?.() || '').trim() || (drDownAt && e.detail > 0 && Math.hypot(e.clientX - drDownAt[0], e.clientY - drDownAt[1]) > 12),   // a swipe (a Smart Stack turning) isn't a tap
  });
  if (opens) drOpenTile(tile);
});

/** The tile's drawer: its own when it has one, the generic one otherwise. */
function drOpenTile(node, { fromHash = false, virtual = null } = {}) {
  const tb = node?.querySelector(':scope > .tile-b'), t = virtual || tb?._t, w = t && wOf(t);
  if (!w) return false;
  const ctx = node?.parentElement?._ctx || $('#view .grid')?._ctx || { data: {} }, size = node ? ctx.grid?.sizeOf?.(t) || { tier: node.dataset.tier || 'm' } : { tier: 'xl', w: 12, h: 6 };
  const a = { t, ctx, w, node: node || el('section'), size };
  const spec = TILE_DRAWERS[w.id];
  if (spec?.custom) return spec.custom(a, { fromHash }) !== false;   // a tile whose "more" is its own full view (the rain radar)
  const name = t.title || spec?.title?.(a) || node?.querySelector('.ttl')?.textContent || T(w.title);
  const base = spec || drGeneric(w);
  const act = (data, d) => [...(base.actions ? base.actions(data, a, d) || [] : []), drCustomizeBtn(a)];
  openDrawer({ route: ['tile', t.id], fromHash, title: name, icon: w.icon, wide: base.wide, every: base.every,
    doc: base.doc || drDocFor(w), back: node ? node.querySelector('.tile-open') || node : null,
    sub: base.sub ? (data) => base.sub(data, a) : '', source: base.source, updated: base.updated,
    load: base.load ? (signal) => base.load(a, signal) : null, render: (body, data, d) => base.render(body, data, a, d), actions: act });
  return true;
}
drawerRoute('tile', (id) => {
  const grid = $('#view .grid'); if (!grid) return false;
  const tiles = [...grid.querySelectorAll(':scope > section.tile')];
  const node = tiles.find((n) => n.dataset.id === id) || tiles.find((n) => String(n.dataset.id).split(':')[0] === String(id).split(':')[0]);
  if (node) return drOpenTile(node, { fromHash: true });
  // a link to a tile this screen's layout doesn't have (another layout, a phone): the same drawer, with the tile's defaults
  const base = String(id).split(':')[0];
  return WIDGETS[base] && (TILE_DRAWERS[base] || !WIDGETS[base].hidden) ? drOpenTile(null, { fromHash: true, virtual: { id, w: WIDGETS[base].size?.[0] || 4, h: WIDGETS[base].size?.[1] || 3, opts: {} } }) : false;
});
/* The guide for a tile: its own topic where there is one, else the page's. */
const DR_DOCS = { sports: 'setup.sports', news: 'setup.news', calendar: 'setup.calendars', energy: 'page.energy', camera: 'page.cameras', doorbell: 'page.cameras', household: 'page.household', lists: 'page.family', chores: 'page.family', routine: 'page.family', meals: 'page.family', alerts: 'settings.alerts', photos: 'page.photos', ask: 'page.ask', house3d: 'page.house3d', secure: 'page.security' };
function drDocFor(w) {
  const k = DR_DOCS[w.id] || (w.cat && w.hidden ? `page.${w.cat}` : null) || `page.${current || 'home'}`;
  return typeof docUrl === 'function' && docUrl(k) ? k : typeof docUrl === 'function' && docUrl(`page.${current}`) ? `page.${current}` : 'page.home';
}
/* "Customize" for people who can change the layout: the tile's own sliders (size, name, look and options). */
function drCustomizeBtn(a) {
  const role = S.me?.user?.role;
  if (S.me?.user?.panel || (role && !['owner', 'admin', 'member'].includes(role))) return null;
  const has = a.w.options || (presetsFor(a.w).length > 1);
  const btn = a.node.querySelector('.tools button[title]:not(.grip):not(.rm)');
  if (!has || !btn) return null;
  return el('button', { type: 'button', class: 'btn small ghost', title: T('Customize'), 'aria-label': T('Customize'), onclick: () => { closeDrawer(); setTimeout(() => btn.click(), 60); } }, icon('sliders', 15));
}
/* The generic drawer: the tile itself with room to show everything it has, what it is, and its options at a glance. */
function drGeneric(w) {
  return {
    render(body, data, a) {
      const bw = Math.max(300, (DR.el?.querySelector('.dr-body')?.clientWidth || 520) - 4);
      const cols = Math.max(4, Math.min(12, Math.floor((bw + GAP_PX) / 100))), h = 6;
      const tb = el('div', { class: 'tile-b' }); tb._t = a.t; tb._saved = () => {};
      const fixed = a.w.bare || a.w.noPreview || ['photos', 'radar', 'camera', 'doorbell', 'house3d'].includes(a.w.id);
      const frame = el('section', { class: `tile dr-tile${fixed ? ' dr-fixed' : ''}`, 'data-tier': 'xl', style: `--h:${h}` }, a.w.bare ? null : el('div', { class: 'tile-h' }, icon(a.w.icon), el('span', { class: 'ttl' }, a.t.title || T(a.w.title))), tb);
      body.append(frame);
      Promise.resolve().then(() => a.w.render(tb, a.ctx, { w: cols, h, narrow: false, span: cols, cols: 12, tier: 'xl', drawer: true }))
        .catch((err) => tb.replaceChildren(el('div', { class: 'muted small' }, T('Could not load: {message}', { message: err.message }))));
      if (a.w.blurb) body.append(drSection(T('About this tile'), el('p', { class: 'small muted', style: 'margin:0' }, T(a.w.blurb))));
    },
  };
}
if (window.__casatorchTest) Object.assign(window.__casatorchTest, { drParse, drHash, drChange, drTapOpens });
