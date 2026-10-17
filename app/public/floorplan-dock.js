/* The 3D Home's screen, your way.
   Everything around the model is a card - the clock, the weather, sunlight, the house panel, each number on the right
   (power, inside, safety, lights, movement, your cars, your home), and extra cards you can add (cameras, what needs you,
   what's playing, coming up, a note). Arrange puts every card in edit mode:
     - drag a card by its handle to the other side, up or down, or out onto the map, where it floats wherever you drop it;
     - Small / Medium / Large on each card, and how wide each side is;
     - hide a card, or add one back from "Add a card".
   Full screen hides everything but the house (and whichever cards you keep), the controls fade away until you move,
   and the screen stays awake. Kept per screen (this browser), like the rest of the 3D view's settings.
   Shared, file for file, by CasaTorch and the personal dashboard: the page passes in what it knows (its cards). */
const SIZES = [['s', 'S', 'Small'], ['m', 'M', 'Medium'], ['l', 'L', 'Large']];
const WIDTHS = { left: { s: 250, m: 300, l: 380 }, right: { s: 160, m: 200, l: 260 } };
const FLOAT_W = { s: 220, m: 290, l: 380 };
const DEFAULT_LEFT = ['clock', 'weather', 'sun', 'control'];

export function createDock(o) {
  const { el, ic, prefs, savePrefs } = o, T = o.T || ((s) => s);
  const L = () => {
    const d = prefs.dock && typeof prefs.dock === 'object' ? prefs.dock : (prefs.dock = {});
    d.left ||= [...DEFAULT_LEFT]; d.float ||= []; d.hidden ||= []; d.size ||= {}; d.leftW ||= 'm'; d.rightW ||= 'm';
    return d;
  };
  let arranging = false, drag = null;
  const $ = (s) => document.querySelector(s);
  const floats = () => $('#floats') || document.body.appendChild(el('div', { id: 'floats' }));
  const byId = () => { const m = new Map(); for (const c of o.cards()) m.set(c.id, c); return m; };
  /* Where everything goes: the left side, the right side, floating on the map - and anything the page knows about that
     hasn't been placed yet goes to its usual side (unless it's an extra card, which waits in "Add a card"). */
  function placement(defs) {
    const d = L(), seen = new Set([...d.left, ...(d.right || []), ...d.float.map((f) => f.id), ...d.hidden]);
    const left = d.left.filter((id) => defs.has(id) && !d.hidden.includes(id));
    const fresh = [...defs.values()].filter((c) => !seen.has(c.id) && !c.extra);
    for (const c of fresh) if (c.side === 'left') left.push(c.id);
    const right = [...(d.right || []).filter((id) => defs.has(id) && !d.hidden.includes(id)), ...fresh.filter((c) => c.side !== 'left').map((c) => c.id)];
    const fl = d.float.filter((f) => defs.has(f.id) && !d.hidden.includes(f.id));
    return { left, right, float: fl };
  }
  const sizeOf = (id, c) => L().size[id] || c?.size || 'm';
  function wrap(c, where, f) {
    const size = sizeOf(c.id, c);
    let body = null; try { body = c.render(size, where); } catch (err) { body = el('div', { class: 'note' }, String(err.message || err)); }
    if (!body && !arranging) return null;
    const node = el('div', { class: `dcard sz-${size} k-${c.kind || 'panel'}${where === 'float' ? ' float' : ''}`, 'data-id': c.id, style: where === 'float' ? `left:${f.x}%;top:${f.y}%;width:${FLOAT_W[size]}px` : null },
      body || el('div', { class: 'note' }, `${c.title} - nothing to show right now`));
    if (arranging) {
      node.append(el('div', { class: 'dbar' },
        el('button', { type: 'button', class: 'dgrip', title: T('Drag to move'), 'aria-label': `Move ${c.title}` }, ic('grip')),
        el('span', { class: 'dname' }, c.title),
        el('div', { class: 'dsz', role: 'group', 'aria-label': `${c.title} size` }, ...SIZES.map(([k, s, long]) => el('button', { type: 'button', class: size === k ? 'on' : '', title: long, onclick: () => { L().size[c.id] = k; save(); } }, s))),
        el('button', { type: 'button', class: 'dx', title: T('Hide'), 'aria-label': `Hide ${c.title}`, onclick: () => hide(c.id) }, ic('close'))));
      node.querySelector('.dgrip').addEventListener('pointerdown', (e) => startDrag(e, c.id, node));
    }
    return node;
  }
  const save = () => { savePrefs(); draw(); };
  function freeze(p) { const d = L(); d.left = [...p.left]; d.right = [...p.right]; d.float = p.float.map((f) => ({ ...f })); }
  function hide(id) { const p = placement(byId()); freeze(p); const d = L(); d.left = d.left.filter((x) => x !== id); d.right = d.right.filter((x) => x !== id); d.float = d.float.filter((f) => f.id !== id); if (!d.hidden.includes(id)) d.hidden.push(id); save(); }
  function add(id, where = 'right') {
    const p = placement(byId()); freeze(p); const d = L(); d.hidden = d.hidden.filter((x) => x !== id);
    if (where === 'float') d.float.push({ id, x: 38, y: 30 }); else d[where].push(id);
    save();
  }
  function draw() {
    const left = $('#left'), right = $('#tiles') || document.body.appendChild(el('div', { id: 'tiles', role: 'region', 'aria-label': T('Your home at a glance') })), fl = floats();
    const view = o.isView();
    document.body.classList.toggle('arranging', arranging && view);
    if (!view) { right.hidden = true; fl.hidden = true; return; }
    const defs = byId(), p = placement(defs), d = L();
    document.documentElement.style.setProperty('--dock-l', `${WIDTHS.left[d.leftW] || 300}px`);
    document.documentElement.style.setProperty('--dock-r', `${WIDTHS.right[d.rightW] || 200}px`);
    if (o.leftReady?.() !== false) {
      const kids = p.left.map((id) => wrap(defs.get(id), 'left')).filter(Boolean);
      left.hidden = !kids.length && !arranging; left.classList.add('dock');
      left.replaceChildren(...kids, arranging ? el('div', { class: 'ddrop', 'data-side': 'left' }, T('Drop cards here')) : '');
    }
    const rk = p.right.map((id) => wrap(defs.get(id), 'right')).filter(Boolean);
    right.hidden = (!rk.length && !arranging) || o.drawerOpen?.();
    right.classList.add('dock');
    right.replaceChildren(...rk, arranging ? el('div', { class: 'ddrop', 'data-side': 'right' }, T('Drop cards here')) : '', ...(o.extraRight?.() || []));
    fl.hidden = !p.float.length;
    fl.replaceChildren(...p.float.map((f) => wrap(defs.get(f.id), 'float', f)).filter(Boolean));
    drawBar();
  }
  /* The bar across the top while arranging. */
  function drawBar() {
    let bar = $('#arrangebar');
    if (!arranging || !o.isView()) { bar?.remove(); return; }
    if (!bar) { bar = el('div', { id: 'arrangebar', role: 'toolbar', 'aria-label': T('Arrange the 3D screen') }); document.body.append(bar); }
    const d = L(), w = (side) => el('div', { class: 'seg' }, ...SIZES.map(([k, , long]) => el('button', { type: 'button', class: d[`${side}W`] === k ? 'on' : '', onclick: () => { d[`${side}W`] = k; save(); } }, long.replace('Medium', 'Standard'))));
    bar.replaceChildren(el('b', {}, T('Arrange')), el('span', { class: 'note' }, T('Drag cards by their handle - to either side or onto the map.')),
      el('span', { class: 'abgrp' }, el('small', {}, T('Left')), w('left')), el('span', { class: 'abgrp' }, el('small', {}, T('Right')), w('right')),
      el('button', { type: 'button', class: 'mini', onclick: addSheet }, '+ ', T('Add a card')),
      el('button', { type: 'button', class: 'mini', onclick: () => { prefs.dock = {}; save(); } }, T('Reset')),
      el('button', { type: 'button', class: 'mini primary', onclick: () => setArrange(false) }, T('Done')));
  }
  function addSheet() {
    const defs = byId(), p = placement(defs), shown = new Set([...p.left, ...p.right, ...p.float.map((f) => f.id)]);
    const list = [...defs.values()].filter((c) => !shown.has(c.id));
    const box = el('div', { class: 'addsheet' }, el('div', { class: 'rhead' }, el('h2', {}, T('Add a card')), el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Close', onclick: () => box.remove() }, ic('close'))),
      list.length ? null : el('p', { class: 'note' }, T('Every card is on the screen.')),
      ...list.map((c) => el('div', { class: 'addrow' }, ic(c.icon || 'dot'), el('div', { class: 'grow' }, el('b', {}, c.title), c.blurb ? el('small', {}, c.blurb) : null),
        el('button', { type: 'button', class: 'mini', onclick: () => { box.remove(); add(c.id, 'left'); } }, T('Left')),
        el('button', { type: 'button', class: 'mini', onclick: () => { box.remove(); add(c.id, 'right'); } }, T('Right')),
        el('button', { type: 'button', class: 'mini', onclick: () => { box.remove(); add(c.id, 'float'); } }, T('On the map')))));
    $('.addsheet')?.remove(); document.body.append(box);
  }
  /* Dragging: a ghost follows the finger; a line shows where it will land; anywhere that isn't a side floats it there. */
  function startDrag(e, id, node) {
    e.preventDefault();
    const r = node.getBoundingClientRect(), ghost = node.cloneNode(true);
    Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${Math.min(r.height, 220)}px`, zIndex: 60, pointerEvents: 'none', opacity: '.92' });
    ghost.classList.add('dghost'); document.body.append(ghost); node.classList.add('dragsrc');
    const offX = e.clientX - r.left, offY = e.clientY - r.top, mark = el('div', { class: 'dmark' });
    drag = { id, target: null };
    const move = (ev) => {
      ghost.style.left = `${ev.clientX - offX}px`; ghost.style.top = `${ev.clientY - offY}px`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const side = under?.closest('#left.dock, #tiles.dock'), over = under?.closest('.dcard:not(.float)');
      mark.remove();
      if (side) {
        const s = side.id === 'left' ? 'left' : 'right';
        if (over && over !== node && side.contains(over)) { const o2 = over.getBoundingClientRect(), after = ev.clientY > o2.top + o2.height / 2; (after ? over.after(mark) : over.before(mark)); drag.target = { side: s, ref: over.dataset.id, after }; }
        else { side.querySelector('.ddrop')?.before(mark); drag.target = { side: s, ref: null }; }
      } else drag.target = { side: 'float', x: Math.max(0, Math.min(90, ((ev.clientX - offX) / innerWidth) * 100)), y: Math.max(6, Math.min(88, ((ev.clientY - offY) / innerHeight) * 100)) };
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      ghost.remove(); mark.remove(); node.classList.remove('dragsrc');
      const t = drag?.target; drag = null; if (!t) return;
      const p = placement(byId()); freeze(p); const d = L();
      d.left = d.left.filter((x) => x !== id); d.right = d.right.filter((x) => x !== id); d.float = d.float.filter((f) => f.id !== id);
      if (t.side === 'float') d.float.push({ id, x: Math.round(t.x * 10) / 10, y: Math.round(t.y * 10) / 10 });
      else { const arr = d[t.side]; const i = t.ref ? arr.indexOf(t.ref) : -1; if (i < 0) arr.push(id); else arr.splice(t.after ? i + 1 : i, 0, id); }
      save();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  function setArrange(on) { arranging = !!on; if (!on) $('.addsheet')?.remove(); o.onArrange?.(arranging); draw(); }
  return { draw, setArrange, arranging: () => arranging, addSheet };
}

/* Full screen: just the house. Uses the browser's full screen where it can (and the app's, in the CasaTorch app),
   hides the bars, fades the last controls out after a few quiet seconds, keeps the screen awake. */
export function createImmersive(o) {
  const { el, ic } = o, T = o.T || ((s) => s);
  let on = false, idle = null, wake = null;
  const btn = el('div', { id: 'fsctl', hidden: true },
    el('button', { type: 'button', class: 'mini', onclick: () => o.cycleCards?.(), title: T('Which cards to show') }, ic('grid'), el('span', { class: 'fscards' })),
    el('button', { type: 'button', class: 'mini', onclick: () => o.spin?.(), title: T('Turn slowly') }, '⟳'),
    el('button', { type: 'button', class: 'mini primary', onclick: () => set(false), title: T('Leave full screen (Esc)') }, ic('shrink'), T('Exit')));
  document.body.append(btn);
  const wakeUp = () => { document.body.classList.remove('fsidle'); clearTimeout(idle); if (on) idle = setTimeout(() => document.body.classList.add('fsidle'), 3000); };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { if (on) wakeUp(); }, { passive: true });
  async function set(v) {
    if (v === on) return;
    on = v; document.body.classList.toggle('immersive', on); btn.hidden = !on;
    const fsEl = document.documentElement;
    try {
      if (on && !document.fullscreenElement && fsEl.requestFullscreen) await fsEl.requestFullscreen({ navigationUI: 'hide' });
      else if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch { /* not allowed here (an iPhone, or a frame): the page still hides everything else */ }
    try { window.CasaNative?.fullscreen?.(on); } catch { /* not in the app */ }
    if (on) { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* fine */ } } else { try { await wake?.release(); } catch { /* fine */ } wake = null; }
    wakeUp(); if (!on) { clearTimeout(idle); document.body.classList.remove('fsidle'); }
    o.onChange?.(on);
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && on && !document.body.classList.contains('fs-keep')) set(false); });
  addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); set(!on); }
    else if (e.key === 'Escape' && on) set(false);
  });
  document.addEventListener('visibilitychange', async () => { if (!document.hidden && on && !wake) { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* fine */ } } });
  return { set, toggle: () => set(!on), on: () => on, label: (t) => { const s = btn.querySelector('.fscards'); if (s) s.textContent = t; } };
}
