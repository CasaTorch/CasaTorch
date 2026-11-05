/* ======================================================================
 * Camera walls, new cameras, and "Add to Frigate" (the server side is 29h-camauto.js).
 *
 *  - Camera walls: a row of chips on the Cameras tab and on Security's video wall - "All cameras" (always every
 *    camera) and the household's own walls, each its cameras in order, a layout (Auto grid, 1 big + small, 2×2,
 *    3×3, 4×4) and names on or off. Admins make, rename, copy, delete and order them; everyone signed in sees the
 *    same walls on every screen and in the phone apps. Each screen remembers the wall it showed last. Every tile is
 *    camView (10-widgets.js): live where it can be through camPlay, small streams in the grid, the main streams in
 *    full screen (up to four cameras) - never a pile of MJPEG connections. A camera that's gone is just skipped.
 *  - New cameras: "New camera: <name>" on every screen, with Hide and Open.
 *  - Add to Frigate (the owner): a camera Frigate doesn't have yet goes into Frigate's settings, checked by Frigate
 *    first; then a restart when the owner says so, and "Undo the last change".
 * ====================================================================== */
const CW_LAYOUTS = [['auto', 'Auto grid'], ['big', '1 big + small'], ['2x2', '2×2'], ['3x3', '3×3'], ['4x4', '4×4']];
const cwKey = (page) => `casatorch-camwall-${page}`;
const cwLast = (page) => { try { return localStorage.getItem(cwKey(page)) || 'all'; } catch { return 'all'; } };
const cwRemember = (page, id) => { try { localStorage.setItem(cwKey(page), id); } catch { /* a private window: this screen just forgets */ } };
const cwCanEdit = (ctx) => !!ctx.data.walls?.canEdit;
const cwWalls = (ctx) => (Array.isArray(ctx.data.walls?.walls) ? ctx.data.walls.walls : []);
const cwLoad = () => api('/api/camera-walls').catch(() => ({ walls: [], canEdit: false }));
async function cwSave(ctx, walls) {
  try {
    const r = await post('/api/camera-walls', { walls }, 'PUT');
    ctx.data.walls = { ...(ctx.data.walls || {}), walls: r.walls };
    if (r.demo) toast(T('The demo doesn\'t save changes.'));
    return r.walls;
  } catch (e) { toast(e.message); return null; }
}
const cwNewId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => x.toString(16).padStart(2, '0')).join('');

/* ---- full screen: the wall fills the screen (iPhone: inside the page), the main streams for up to four cameras ---- */
function cwRole(box, full) {
  const tiles = [...box.querySelectorAll('.cam')].map((w) => w.__cam).filter(Boolean), main = full && tiles.length <= 4;
  for (const c of tiles) {
    const r = main ? 'full' : 'tile';
    if ((c.role || 'tile') === r) continue;
    c.role = r; if (c.live) { camLive(c, false); camLive(c, camLiveOk(c)); }
  }
}
function cwFull(box) {
  if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
  if (box.classList.contains('cw-max')) { box.classList.remove('cw-max'); cwRole(box, false); return; }
  const max = () => { box.classList.add('cw-max'); cwRole(box, true); };
  const go = box.requestFullscreen || box.webkitRequestFullscreen;
  if (go && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) { try { const p = go.call(box); if (p?.catch) p.catch(max); return; } catch { /* below */ } }
  max();
}
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { const fs = document.fullscreenElement || document.webkitFullscreenElement; for (const b of document.querySelectorAll('.cw-body')) cwRole(b, fs === b); });

/**
 * A wall tile with its chips: camWallsBody(b, ctx, size, page, allRender). allRender(body, ctx, size) draws "All cameras"
 * (the page's own wall). ctx.data.walls: what /api/camera-walls answered.
 */
function camWallsBody(b, ctx, size, page, allRender) {
  const walls = cwWalls(ctx), all = (ctx.data.devices || []).filter((d) => d.kind === 'camera');
  let cur = cwLast(page); if (cur !== 'all' && !walls.some((w) => w.id === cur)) cur = 'all';
  const wall = walls.find((w) => w.id === cur);
  if (!b._cw) b._cw = { head: el('div', { class: 'cw-head' }), body: el('div', { class: 'cw-body' }) };
  const { head, body } = b._cw, redraw = () => { head._k = null; camWallsBody(b, ctx, size, page, allRender); };
  body._t = b._t;
  const hk = JSON.stringify([cur, walls.map((w) => [w.id, w.name]), cwCanEdit(ctx), size.tier, page]);
  if (head._k !== hk) { head._k = hk; head.replaceChildren(...cwChips(ctx, page, walls, cur, body, redraw)); }
  head.hidden = !walls.length && !cwCanEdit(ctx);
  if (b.firstChild !== head || b.lastChild !== body || b.childNodes.length !== 2) b.replaceChildren(head, body);
  if (body._mode !== cur) { body._mode = cur; body._key = null; body.replaceChildren(); }   // another wall: drawn afresh
  if (!wall) return allRender(body, ctx, size);
  cwWall(body, ctx, size, wall, all, () => cwEdit(ctx, wall, redraw, page));
}
function cwChips(ctx, page, walls, cur, body, redraw) {
  const pick = (id) => { cwRemember(page, id); redraw(); };
  const chips = el('div', { class: 'seg seg-mini cw-chips', role: 'tablist', 'aria-label': T('Camera walls') },
    [['all', T('All cameras')], ...walls.map((w) => [w.id, w.name])].map(([id, label]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(id === cur), class: id === cur ? 'on' : null, onclick: () => pick(id) }, label)));
  const edit = cwCanEdit(ctx), w = walls.find((x) => x.id === cur);
  const tools = el('div', { class: 'row cw-tools' },
    edit && w ? el('button', { type: 'button', class: 'btn small ghost', title: T('Edit this wall'), 'aria-label': T('Edit this wall'), onclick: () => cwEdit(ctx, w, redraw, page) }, icon('edit', 14)) : null,
    edit && walls.length > 1 ? el('button', { type: 'button', class: 'btn small ghost', title: T('Arrange walls'), 'aria-label': T('Arrange walls'), onclick: () => cwManage(ctx, redraw, page) }, icon('sliders', 14)) : null,
    edit ? el('button', { type: 'button', class: 'btn small ghost', title: T('New wall'), onclick: () => cwEdit(ctx, null, redraw, page) }, icon('plus', 14), el('span', { class: 'hide-phone' }, T('New wall'))) : null,
    w || page !== 'security' ? el('button', { type: 'button', class: 'btn small', title: T('Full screen'), 'aria-label': T('Full screen'), onclick: () => cwFull(body) }, icon('expand', 14), el('span', { class: 'hide-phone' }, T('Full screen'))) : null);
  return [chips, tools];
}
/** One custom wall: its cameras in order (any that are gone are skipped), in its layout. */
function cwWall(body, ctx, size, wall, all, onEdit) {
  const byId = new Map(all.map((d) => [d.id, d])), n = { '2x2': 2, '3x3': 3, '4x4': 4 }[wall.layout], most = { s: 1, m: 2, l: 3, xl: 4 }[size.tier || 'xl'];
  let cams = wall.cams.map((id) => byId.get(id)).filter(Boolean);
  const more = n ? Math.max(0, cams.length - n * n) : 0; if (n) cams = cams.slice(0, n * n);
  const key = JSON.stringify([wall.id, wall.layout, wall.names, cams.map((d) => d.id), size.tier]);
  if (body._key === key && body.firstChild) return;
  body._key = key;
  const exit = el('button', { type: 'button', class: 'cw-exit btn small', 'aria-label': T('Close full screen'), onclick: () => cwFull(body) }, icon('x', 16));
  if (!cams.length) return pgPut(body, pgEmpty(wall.cams.length ? T('None of this wall\'s cameras are here right now.') : T('This wall has no cameras yet.'), null, null), cwCanEdit(ctx) ? el('button', { class: 'btn small', onclick: onEdit }, icon('edit', 14), T('Pick cameras')) : null);
  const cols = Math.max(1, Math.min(most, wall.layout === 'big' ? (cams.length > 1 ? 3 : 1) : n || camCols(cams.length, size)));
  const grid = el('div', { class: `cams cw-grid cw-${wall.layout}${wall.names ? ' cw-names' : ''}`, style: `--cam-cols:${cols}` }, cams.map((d) => camView(d, { live: true })));
  pgPut(body, grid, more ? el('p', { class: 'tiny muted', style: 'margin:6px 0 0' }, T('{n} more on this wall don\'t fit this layout.', { n: more })) : null, exit);
}

/* ---- the sheet: a wall's name, layout, names on or off, and its cameras (tick to show, drag or arrows to order) ---- */
function cwEdit(ctx, wall, redraw, page) {
  const all = (ctx.data.devices || []).filter((d) => d.kind === 'camera'), isNew = !wall;
  const w = wall ? JSON.parse(JSON.stringify(wall)) : { id: cwNewId(), name: '', cams: all.map((d) => d.id), layout: 'auto', names: true };
  const order = [...w.cams.filter((id) => all.some((d) => d.id === id)), ...all.map((d) => d.id).filter((id) => !w.cams.includes(id))];
  const on = new Set(w.cams);
  const name = el('input', { type: 'text', maxlength: 40, value: w.name, placeholder: T('For example: Outside'), 'aria-label': T('Wall name') });
  let layout = w.layout;
  const seg = el('div', { class: 'seg seg-mini seg-wrap', role: 'group', 'aria-label': T('Layout') });
  const drawSeg = () => seg.replaceChildren(...CW_LAYOUTS.map(([v, l]) => el('button', { type: 'button', class: layout === v ? 'on' : null, 'aria-pressed': String(layout === v), onclick: () => { layout = v; drawSeg(); } }, T(l))));
  drawSeg();
  const names = el('input', { type: 'checkbox', checked: w.names !== false, style: 'width:auto' });
  const list = el('div', { class: 'cw-list' });
  const byId = new Map(all.map((d) => [d.id, d]));
  const move = (i, j) => { if (j < 0 || j >= order.length) return; const [x] = order.splice(i, 1); order.splice(j, 0, x); drawList(); list.querySelectorAll('.cw-row')[j]?.querySelector('.cw-grip')?.focus(); };
  function drawList() {
    list.replaceChildren(...order.map((id, i) => {
      const d = byId.get(id);
      const grip = el('button', { type: 'button', class: 'cw-grip btn small ghost', 'aria-label': T('Drag to move {name}', { name: d.name }), onkeydown: (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); } } }, icon('grip', 16));
      const row = el('div', { class: 'cw-row', 'data-i': i }, grip,
        el('label', { class: 'grow row', style: 'gap:8px;min-width:0' }, el('input', { type: 'checkbox', checked: on.has(id), style: 'width:auto', onchange: (e) => { if (e.target.checked) on.add(id); else on.delete(id); } }), el('span', { class: 'ellipsis' }, d.name, srcName(d.source || d.provider) ? el('span', { class: 'tiny muted' }, ` · ${srcName(d.source || d.provider)}`) : null)),
        el('button', { type: 'button', class: 'btn small ghost', 'aria-label': T('Move up'), disabled: i === 0 || null, onclick: () => move(i, i - 1) }, '↑'),
        el('button', { type: 'button', class: 'btn small ghost', 'aria-label': T('Move down'), disabled: i === order.length - 1 || null, onclick: () => move(i, i + 1) }, '↓'));
      cwDrag(grip, row, list, (to) => move(i, to));
      return row;
    }));
  }
  drawList();
  const msg = el('p', { class: 'small', style: 'min-height:1.2em;color:var(--bad);margin:6px 0' });
  const save = el('button', { class: 'btn primary' }, icon('check', 14), T('Save'));
  const walls = () => cwWalls(ctx);
  save.onclick = async () => {
    const nm = name.value.trim(); if (!nm) { msg.textContent = T('Give the wall a name.'); name.focus(); return; }
    const next = { ...w, name: nm, layout, names: names.checked, cams: order.filter((id) => on.has(id)) };
    const list2 = isNew ? [...walls(), next] : walls().map((x) => (x.id === w.id ? next : x));
    save.disabled = true;
    const r = await cwSave(ctx, list2); save.disabled = false;
    if (!r) return;
    cwRemember(page, (r.find((x) => x.id === next.id) || r[r.length - 1]).id);
    m.remove(); redraw();
  };
  const copy = isNew ? null : el('button', { class: 'btn ghost', onclick: async () => {
    const dupe = { ...w, id: cwNewId(), name: T('{name} copy', { name: w.name }).slice(0, 40) };
    const r = await cwSave(ctx, [...walls(), dupe]); if (!r) return;
    cwRemember(page, r[r.length - 1].id); m.remove(); redraw(); toast(T('Wall copied'));
  } }, T('Duplicate'));
  const del = isNew ? null : el('button', { class: 'btn ghost', style: 'color:var(--bad)', onclick: async () => {
    if (!confirm(T('Delete the wall "{name}"? The cameras stay.', { name: w.name }))) return;
    const r = await cwSave(ctx, walls().filter((x) => x.id !== w.id)); if (!r) return;
    cwRemember(page, 'all'); m.remove(); redraw(); toast(T('Wall deleted'));
  } }, T('Delete'));
  const m = modal(el('div', { class: 'cw-sheet' },
    el('label', { class: 'field' }, el('span', {}, T('Wall name')), name),
    el('div', { class: 'field' }, el('span', {}, T('Layout')), seg),
    el('label', { class: 'switch-row' }, names, el('span', {}, T('Show camera names'))),
    el('div', { class: 'field' }, el('span', {}, T('Cameras')), el('div', { class: 'tiny muted', style: 'margin-bottom:6px' }, T('Tick the ones on this wall. Drag them, or use the arrows, to put them in order.')), all.length ? list : el('p', { class: 'small muted' }, T('No cameras yet.'))),
    msg, el('div', { class: 'row wrap', style: 'gap:8px;justify-content:flex-end' }, del, copy, save)), { title: isNew ? T('New camera wall') : T('Edit "{name}"', { name: w.name }) });
  m.querySelector('.box')?.classList.add('tall');
  if (isNew) setTimeout(() => name.focus(), 60);
}
/** Drag a row by its handle (mouse, finger or pen): it follows the pointer and lands where it's let go. */
function cwDrag(handle, row, list, drop) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault(); handle.setPointerCapture?.(e.pointerId);
    const rows = [...list.querySelectorAll('.cw-row')], from = rows.indexOf(row), y0 = e.clientY;
    let to = from; row.classList.add('cw-dragging');
    const moveTo = (ev) => {
      row.style.transform = `translateY(${ev.clientY - y0}px)`;
      to = from; for (let i = 0; i < rows.length; i++) { if (i === from) continue; const r = rows[i].getBoundingClientRect(), mid = r.top + r.height / 2; if (i < from && ev.clientY < mid) { to = i; break; } if (i > from && ev.clientY > mid) to = i; }
    };
    const end = () => { handle.removeEventListener('pointermove', moveTo); row.classList.remove('cw-dragging'); row.style.transform = ''; if (to !== from) drop(to); };
    handle.addEventListener('pointermove', moveTo);
    handle.addEventListener('pointerup', end, { once: true }); handle.addEventListener('pointercancel', end, { once: true });
  });
}
/* Every wall: their order, and a way to each one's sheet. */
function cwManage(ctx, redraw, page) {
  let walls = [...cwWalls(ctx)];
  const list = el('div', { class: 'cw-list' });
  const commit = async (next) => { const r = await cwSave(ctx, next); if (r) { walls = [...r]; draw(); redraw(); } };
  const draw = () => list.replaceChildren(...walls.map((w, i) => el('div', { class: 'cw-row' },
    el('span', { class: 'grow ellipsis' }, el('b', {}, w.name), el('span', { class: 'tiny muted' }, ` · ${T('{n} cameras', { n: w.cams.length })}`)),
    el('button', { type: 'button', class: 'btn small ghost', 'aria-label': T('Move up'), disabled: i === 0 || null, onclick: () => { const n = [...walls]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; commit(n); } }, '↑'),
    el('button', { type: 'button', class: 'btn small ghost', 'aria-label': T('Move down'), disabled: i === walls.length - 1 || null, onclick: () => { const n = [...walls]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; commit(n); } }, '↓'),
    el('button', { type: 'button', class: 'btn small', onclick: () => { m.remove(); cwEdit(ctx, w, redraw, page); } }, icon('edit', 14), T('Edit')))));
  draw();
  const m = modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('The walls show in this order on every screen.')), list,
    el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, el('button', { class: 'btn', onclick: () => { m.remove(); cwEdit(ctx, null, redraw, page); } }, icon('plus', 14), T('New wall')))), { title: T('Camera walls') });
}

/* ---- New cameras: a notice on every screen, and a card on the Cameras tab ---- */
const CN_HIDDEN = 'casatorch-camnotice-hidden';
const cnHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(CN_HIDDEN) || '[]')); } catch { return new Set(); } };
const cnHide = (id) => { try { localStorage.setItem(CN_HIDDEN, JSON.stringify([...cnHidden(), id].slice(-50))); } catch { /* this screen shows it again next time */ } };
let cnLast = 0, cnT = null;
async function camNoticeCheck(force = false) {
  if (document.hidden || location.pathname.includes('setup') || !S.status || S.status.demo) return;
  if (!force && Date.now() - cnLast < 20_000) { clearTimeout(cnT); cnT = setTimeout(() => camNoticeCheck(true), 20_000 - (Date.now() - cnLast)); return; }
  cnLast = Date.now();
  const r = await api('/api/camera-auto', { global: true }).catch(() => null);
  const hidden = cnHidden(), n = (r?.notices || []).find((x) => !hidden.has(x.id)), box = document.getElementById('camnotice');
  if (!n) { box?.remove(); return; }
  if (box?.dataset.id === n.id) return;
  box?.remove();
  const close = () => { cnHide(n.id); document.getElementById('camnotice')?.remove(); setTimeout(() => camNoticeCheck(true), 300); };
  document.body.append(el('div', { id: 'camnotice', 'data-id': n.id, role: 'status', 'aria-live': 'polite' }, icon('camera', 18),
    el('div', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block' }, T('New camera: {name}', { name: n.name })), el('div', { class: 'tiny muted' }, T('It shows on Cameras and Security now.'))),
    el('button', { class: 'btn small ghost', onclick: close }, T('Hide')),
    el('button', { class: 'btn small primary', onclick: () => { close(); location.hash = `#cameras?cam=${encodeURIComponent(n.dev)}`; } }, T('Open'))));
}
setInterval(() => camNoticeCheck(true), 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) camNoticeCheck(); });
setTimeout(() => camNoticeCheck(true), 5000);

function camNewCard(ctx) {
  const a = ctx.data.auto || {}, devs = new Map((ctx.data.devices || []).map((d) => [d.id, d]));
  const notices = (a.notices || []).filter((n) => devs.has(n.dev)), offers = a.owner ? (a.offers || []) : [];
  const rows = [];
  for (const n of notices) rows.push(el('div', { class: 'row between', style: 'padding:7px 0;gap:10px;border-top:1px solid var(--line)' },
    el('div', { style: 'min-width:0' }, el('b', {}, n.name), el('div', { class: 'tiny muted' }, T('Added {when}', { when: ago(n.at) }))),
    el('button', { class: 'btn small', onclick: () => camDrawer(devs.get(n.dev)) }, T('Open'))));
  if (offers.length && a.frigate) {
    rows.push(el('div', { class: 'tiny muted ctl-sub-h', style: 'margin-top:12px' }, T('Not in Frigate yet')));
    for (const o of offers) {
      const d = devs.get(o.dev) || { id: o.dev, name: o.name, kind: 'camera' };
      rows.push(el('div', { class: 'row between wrap', style: 'padding:7px 0;gap:10px;border-top:1px solid var(--line)' },
        el('div', { style: 'min-width:0' }, el('b', {}, d.name), el('div', { class: 'tiny muted' }, o.source ? T('CasaTorch knows its stream') : T('You\'ll type its stream address'))),
        el('button', { class: 'btn small', onclick: () => camFrigateAdd(d, () => ctx.refresh?.()) }, icon('plus', 14), T('Add to Frigate (detection and recording)'))));
    }
  }
  if (a.owner && a.undo) rows.push(el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'btn small ghost', onclick: () => camFrigateUndo(() => ctx.refresh?.()) }, icon('reset', 14), T('Undo the last change to Frigate'))));
  if (!rows.length) return el('p', { class: 'muted small' }, a.auto === false ? T('New cameras wait under Detected cameras until you add them.') : T('New cameras from Home Assistant and Frigate show up here by themselves.'));
  return el('div', {}, ...rows);
}

/* ---- Add to Frigate (the owner) ---- */
const cwNeedPw = () => S.me?.signIn !== false;
function cwSnip(label, text) {
  return el('div', { class: 'cw-snip' }, el('div', { class: 'small', style: 'margin-bottom:4px' }, label), el('pre', {}, text),
    el('button', { type: 'button', class: 'btn small', onclick: async () => { try { await supCopy(text); toast(T('Copied')); } catch { toast(text, 8000); } } }, T('Copy')));
}
function cwPasteView(sn) {
  return el('div', {}, el('p', { class: 'small', style: 'margin-top:0' }, T('Frigate gets its camera streams from a go2rtc outside it, so CasaTorch won\'t change Frigate\'s settings for you. Paste these in yourself, then restart go2rtc and Frigate.')),
    sn.go2rtc ? cwSnip(T('1. In go2rtc\'s settings, under streams:'), sn.go2rtc) : null,
    cwSnip(sn.go2rtc ? T('2. In Frigate\'s settings, under cameras:') : T('In Frigate\'s settings, under cameras:'), sn.camera),
    sn.masked ? el('p', { class: 'tiny muted' }, T('Put the camera\'s password where the stars are.')) : null);
}
async function camFrigateAdd(d, done) {
  const body = el('div', {}, el('p', { class: 'small muted' }, T('Checking Frigate…')));
  const m = modal(body, { title: T('Add {name} to Frigate', { name: d.name }) });
  const msg = el('p', { class: 'small', style: 'min-height:1.2em;color:var(--bad);margin:6px 0' });
  const src = el('input', { type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: 400, placeholder: 'rtsp://…', 'aria-label': T('The camera\'s stream address') });
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: T('Your CasaTorch password') });
  const srcField = el('label', { class: 'field' }, el('span', {}, T('The camera\'s stream address')), src, el('span', { class: 'tiny muted' }, T('It starts with rtsp:// - the camera\'s app or settings page shows it.')));
  let pv;
  try { pv = await post('/api/camera-auto/frigate/preview', { dev: d.id }); } catch (e) { body.replaceChildren(el('p', { class: 'small', style: 'color:var(--bad)' }, e.message)); return; }
  if (pv.mode === 'paste') {
    if (pv.snippets) { body.replaceChildren(cwPasteView(pv.snippets)); return; }
    const show = el('button', { class: 'btn primary' }, T('Show what to paste'));
    show.onclick = async () => { msg.textContent = ''; try { const r = await post('/api/camera-auto/frigate/preview', { dev: d.id, source: src.value.trim() }); if (r.snippets) body.replaceChildren(cwPasteView(r.snippets)); } catch (e) { msg.textContent = e.message; } };
    body.replaceChildren(el('p', { class: 'small', style: 'margin-top:0' }, T('Frigate gets its camera streams from a go2rtc outside it. Type this camera\'s stream address and CasaTorch shows you what to paste where.')), srcField, msg, el('div', { class: 'row', style: 'justify-content:flex-end' }, show));
    return;
  }
  const add = el('button', { class: 'btn primary' }, icon('plus', 14), T('Add to Frigate'));
  const restartStep = () => {
    const restart = el('button', { class: 'btn primary' }, T('Restart Frigate'));
    const undo = el('button', { class: 'btn ghost' }, T('Undo the last change'));
    restart.onclick = async () => { restart.disabled = true; msg.textContent = ''; try { await post('/api/camera-auto/frigate/restart', { password: pw.value }); m.remove(); toast(T('Frigate is restarting. The camera shows up in about a minute.'), 5000); done?.(); } catch (e) { msg.textContent = e.message; restart.disabled = false; } };
    undo.onclick = async () => { undo.disabled = true; try { await post('/api/camera-auto/frigate/undo', { password: pw.value }); m.remove(); toast(T('Frigate\'s settings are back as they were.')); done?.(); } catch (e) { msg.textContent = e.message; undo.disabled = false; } };
    body.replaceChildren(el('p', { style: 'margin-top:0' }, el('b', {}, T('Saved in Frigate.'))),
      el('p', { class: 'small muted' }, T('Frigate starts recording and detecting on {name} after a restart. Restart it now? Its video stops for about a minute.', { name: d.name })),
      msg, el('div', { class: 'row wrap', style: 'gap:8px;justify-content:flex-end' }, undo, el('button', { class: 'btn ghost', onclick: () => { m.remove(); done?.(); } }, T('Later')), restart));
  };
  add.onclick = async () => {
    add.disabled = true; msg.textContent = '';
    try {
      const r = await post('/api/camera-auto/frigate/add', { dev: d.id, password: pw.value, ...(pv.needsSource ? { source: src.value.trim() } : {}) });
      if (r.paste) { body.replaceChildren(cwPasteView(r.snippets)); return; }
      restartStep();
    } catch (e) { msg.textContent = e.message; add.disabled = false; }
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
  body.replaceChildren(
    el('p', { class: 'small', style: 'margin-top:0' }, T('CasaTorch adds this camera to Frigate\'s settings, so Frigate records it and spots people, cars and animals. Frigate checks the change before keeping it, and you can undo it.'), ' ', docLink('cameras.frigate', { topic: T('Frigate') })),
    el('dl', { class: 'kv small' }, el('dt', {}, T('Name in Frigate')), el('dd', {}, pv.name)),
    pv.needsSource ? srcField : el('p', { class: 'tiny muted' }, T('CasaTorch already knows this camera\'s stream.')),
    cwNeedPw() ? el('label', { class: 'field' }, el('span', {}, T('Your password')), pw) : null,
    msg, el('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')), add));
  setTimeout(() => (pv.needsSource ? src : pw).focus(), 60);
}
function camFrigateUndo(done) {
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: T('Your CasaTorch password') });
  const msg = el('p', { class: 'small', style: 'min-height:1.2em;color:var(--bad);margin:6px 0' });
  const ok = el('button', { class: 'btn primary' }, T('Undo the last change'));
  const restart = el('button', { class: 'btn primary', hidden: true }, T('Restart Frigate'));
  ok.onclick = async () => { ok.disabled = true; msg.textContent = ''; try { await post('/api/camera-auto/frigate/undo', { password: pw.value }); ok.hidden = true; restart.hidden = false; msg.style.color = ''; msg.textContent = T('Frigate\'s settings are back as they were. Restart Frigate for it to take effect.'); done?.(); } catch (e) { msg.textContent = e.message; ok.disabled = false; } };
  restart.onclick = async () => { restart.disabled = true; try { await post('/api/camera-auto/frigate/restart', { password: pw.value }); m.remove(); toast(T('Frigate is restarting.')); } catch (e) { msg.textContent = e.message; restart.disabled = false; } };
  const m = modal(el('div', {}, el('p', { class: 'small', style: 'margin-top:0' }, T('This puts back Frigate\'s settings as they were before CasaTorch\'s last change.')),
    cwNeedPw() ? el('label', { class: 'field' }, el('span', {}, T('Your password')), pw) : null, msg, el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, ok, restart)), { title: T('Undo the last change to Frigate') });
}

/* ---- Settings › Cameras ---- */
async function camerasSettingsCards(me) {
  const a = await api('/api/camera-auto').catch(() => ({}));
  const admin = !me || me.signIn === false || ['admin', 'owner'].includes(me.user?.role);
  const tog = el('input', { type: 'checkbox', checked: a.auto !== false, disabled: !admin || a.demo || null, style: 'width:auto;margin-top:3px', onchange: async (e) => {
    try { await post('/api/settings/cameras', { showNew: e.target.checked }, 'PUT'); toast(e.target.checked ? T('New cameras show up by themselves') : T('New cameras wait under Detected cameras')); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
  } });
  const card = el('div', { class: 'card' }, el('h2', {}, T('New cameras'), docLink('settings.cameras', { icon: true, topic: T('Cameras') })),
    el('label', { class: 'row', style: 'gap:10px;align-items:flex-start' }, tog, el('span', {}, el('b', {}, T('Show new cameras automatically')),
      el('div', { class: 'small muted' }, T('A camera added to Home Assistant or Frigate shows up on Cameras and Security by itself, and every screen says so. Off: it waits under Detected cameras until you add it.')))),
    el('p', { class: 'small muted' }, T('Live video takes the fastest way there is: through Frigate when Frigate has the camera too, otherwise through Home Assistant. Each camera\'s details say which.')));
  const out = [card];
  if (a.owner && a.undo) out.push(el('div', { class: 'card' }, el('h2', {}, T('Frigate')), el('p', { class: 'small muted', style: 'margin-top:0' }, T('CasaTorch keeps Frigate\'s settings as they were before each of its last changes (up to 5), sealed on this box.')),
    el('button', { class: 'btn', onclick: () => camFrigateUndo(() => {}) }, icon('reset', 14), T('Undo the last change to Frigate'))));
  return out;
}
