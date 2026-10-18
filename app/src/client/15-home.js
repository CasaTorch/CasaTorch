/* ---- Home: the widget grid ---- */
async function homeData() {
  const [home, alerts, devices, settings] = await Promise.all([api('/api/home'), api('/api/alerts').catch(() => null), api('/api/devices').catch(() => null), api('/api/settings').catch(() => S.settings)]);
  return { home, alerts, devices, settings };
}
/* This screen's own id, for "Just this screen" layouts. Kept in this browser only. */
const SCREEN_KEY = 'casatorch.screenId';
function screenId() {
  try {
    let v = localStorage.getItem(SCREEN_KEY);
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(v || '')) { v = (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 32); localStorage.setItem(SCREEN_KEY, v); }
    return v;
  } catch { return null; }
}
/* New devices since this screen last looked (shown on the Add button). */
const SEEN_KEY = 'casatorch.seenDevices';
const seenDevices = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
const markSeen = (ids) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-3000))); } catch { /* private window */ } };
function newDeviceCount(devices) { const seen = seenDevices(); return seen.size ? devices.filter((d) => !seen.has(d.id)).length : 0; }
const KIND_GROUPS = [['all', 'All'], ['ha', 'Home Assistant'], ['light', 'Lights & switches'], ['sensor', 'Sensors'], ['climate', 'Climate'], ['camera', 'Cameras'], ['media', 'Media'], ['other', 'Everything else']];
const inGroup = (d, g) => g === 'all' || (g === 'ha' ? d.provider === 'ha' : g === 'light' ? ['light', 'switch', 'plug', 'fan'].includes(d.kind) : g === 'sensor' ? ['sensor', 'value'].includes(d.kind) : g === 'other' ? !['light', 'switch', 'plug', 'fan', 'sensor', 'value', 'climate', 'camera', 'media'].includes(d.kind) : d.kind === g);
/* The widget gallery. Widgets by kind, each with a live preview and its sizes (pick one, and it's added at that size);
   and "Rooms & devices" - filled automatically from everything CasaTorch can see, including every Home Assistant entity
   and area: add a light, a sensor or a whole room in one tap. */
const WIDGET_CATS = [['all', 'All widgets'], ['essentials', 'Essentials'], ['home', 'Home & devices'], ['safety', 'Cameras & safety'], ['time', 'Time & weather'], ['info', 'News, money & sports'], ['personal', 'Personal']];
function widgetPicker(have, onPick, { devices = [], tiles = [], ctx, start = 'widgets' } = {}) {
  const list = Object.values(WIDGETS).filter((w) => !w.hidden && (w.multi || !have.has(w.id)));
  const seen = seenDevices(), firstLook = !seen.size, onHome = new Set(tiles.map((t) => t.device).filter(Boolean)), roomsOnHome = new Set(tiles.map((t) => t.area).filter(Boolean));
  const fromHa = devices.filter((d) => d.provider === 'ha').length;
  const pick = (id, init) => { m.remove(); markSeen(new Set([...seen, ...devices.map((d) => d.id)])); onPick(id, init); };
  // ---- widgets ----
  let cat = 'all';
  const wq = el('input', { type: 'search', placeholder: T('Search widgets…'), 'aria-label': T('Search widgets') });
  const catBar = el('div', { class: 'chips' });
  const cards = el('div', { class: 'wgallery' });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); e.target.__show?.(); } }, { rootMargin: '120px' }) : null;
  const card = (w) => {
    const sizes = presetsFor(w), first = sizes.find(([, , [x, y]]) => x === (w.size?.[0] || 4) && y === (w.size?.[1] || 3)) || sizes[0];
    let chosen = first[2];
    const pv = el('div', { class: 'wg-prev' }, el('div', { class: 'wg-ic' }, icon(w.icon, 28)));
    const paint = () => { const t = { id: w.id, w: chosen[0], h: chosen[1], opts: {} }; const b = previewBox(t, w, ctx); pv.replaceChildren(b.stage); requestAnimationFrame(b.fit); };
    pv.__show = () => { if (!w.noPreview && !w.live) paint(); };
    const sizeBar = el('div', { class: 'seg seg-mini' }, sizes.map(([k, label, sz]) => el('button', { type: 'button', class: sz === chosen ? 'on' : '', title: label, onclick: (e) => { chosen = sz; [...sizeBar.children].forEach((x) => x.classList.toggle('on', x === e.currentTarget)); pv.__show(); } }, label.replace('Extra large', 'XL'))));
    const c = el('div', { class: 'wg-card' }, pv,
      el('div', { class: 'wg-meta' }, el('b', {}, T(w.title), w.pro ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'PRO') : null, w.isNew ? el('span', { class: 'newtag' }, T('New')) : null), el('div', { class: 'tiny muted' }, w.blurb ? T(w.blurb) : '')),
      sizes.length > 1 ? sizeBar : null,
      el('button', { class: 'btn small primary wg-add', onclick: () => pick(w.id, { w: chosen[0], h: chosen[1] }) }, icon('plus'), T('Add')));
    io ? io.observe(pv) : pv.__show();
    return c;
  };
  const drawWidgets = () => {
    const q = wq.value.trim().toLowerCase();
    const shown = list.filter((w) => (cat === 'all' || w.cat === cat || (cat === 'essentials' && w.essential)) && (!q || `${w.title} ${T(w.title)} ${w.blurb || ''} ${w.keywords || ''}`.toLowerCase().includes(q)));
    catBar.replaceChildren(...WIDGET_CATS.filter(([k]) => k === 'all' || list.some((w) => w.cat === k || (k === 'essentials' && w.essential))).map(([k, label]) => el('button', { class: `chip${k === cat ? ' on' : ''}`, onclick: () => { cat = k; drawWidgets(); } }, label)));
    cards.replaceChildren(...(shown.length ? shown.map(card) : [el('p', { class: 'muted' }, list.length ? T('No widget matches.') : T('Every widget is already on your Home screen.'))]));
  };
  wq.oninput = drawWidgets;
  const widgetsPane = el('div', {}, el('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, wq), el('div', { style: 'margin:10px 0 4px' }, catBar), cards);
  // ---- rooms & devices ----
  let group = 'all';
  const q = el('input', { type: 'search', placeholder: T('Search rooms, devices and Home Assistant entities…'), 'aria-label': T('Search devices') });
  const chips = el('div', { class: 'chips' });
  const body = el('div', { class: 'dev-pick' });
  const devRow = (d) => el('div', { class: 'pick-row' }, el('span', { class: 'ic' }, icon(devIconName(d))),
    el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'ellipsis' }, d.name, !firstLook && !seen.has(d.id) ? el('span', { class: 'pill good', style: 'margin-left:6px' }, T('New')) : null),
      el('div', { class: 'tiny muted ellipsis' }, [devMeta(d, true), d.provider === 'ha' ? `Home Assistant · ${d.id.slice(3)}` : pretty(d.provider)].filter(Boolean).join(' · '))),
    onHome.has(d.id) ? el('span', { class: 'tiny faint' }, T('On Home')) : null,
    el('button', { class: 'btn small', onclick: () => pick('device', { device: d.id, title: d.name, ...(d.kind === 'camera' ? { w: 4, h: 3 } : {}) }) }, icon('plus'), T('Add')));
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const match = (d) => inGroup(d, group) && (!t || `${d.name} ${d.id} ${d.area || ''} ${d.kind}`.toLowerCase().includes(t));
    chips.replaceChildren(...KIND_GROUPS.filter(([g]) => g === 'all' || devices.some((d) => inGroup(d, g))).map(([g, label]) => el('button', { class: `chip${g === group ? ' on' : ''}`, onclick: () => { group = g; draw(); } }, T(label), el('span', { class: 'faint' }, ` ${devices.filter((d) => inGroup(d, g)).length}`))));
    const shown = devices.filter(match);
    const areas = [...new Set(devices.map((d) => d.area).filter(Boolean))].sort().filter((a) => !t || a.toLowerCase().includes(t) || shown.some((d) => d.area === a));
    const out = [];
    if (areas.length && group === 'all') out.push(el('h4', {}, 'Rooms'), el('div', { class: 'room-picks' }, areas.map((a) => { const n = devices.filter((d) => d.area === a).length; return el('button', { class: 'room-pick', onclick: () => pick('room', { area: a, title: a }) }, icon('home'), el('div', { style: 'min-width:0' }, el('b', { class: 'ellipsis' }, a), el('div', { class: 'tiny muted' }, roomsOnHome.has(a) ? T('{n} devices · on Home', { n }) : T('{n} devices', { n })))); })));
    const byArea = new Map(); for (const d of shown) { const k = d.area || ''; if (!byArea.has(k)) byArea.set(k, []); byArea.get(k).push(d); }
    for (const [a, ds] of [...byArea].sort(([x], [y]) => (!x) - (!y) || x.localeCompare(y))) out.push(el('h4', {}, a || (areas.length ? T('Not in a room') : T('Devices'))), ...ds.slice(0, 400).map(devRow));
    if (!shown.length && !(areas.length && group === 'all')) out.push(el('p', { class: 'muted small' }, devices.length ? T('Nothing matches.') : T('No devices yet. Connect your gear or Home Assistant on the Connect tab and everything shows up here by itself.')));
    body.replaceChildren(...out);
  };
  q.oninput = draw;
  const devPane = el('div', {}, el('div', { class: 'callout small' }, icon('spark'), el('div', {}, fromHa ? T('{n} Home Assistant entities are ready to add - anything new in Home Assistant appears here automatically.', { n: fromHa }) : T('Every device CasaTorch can see is ready to add. Connect Home Assistant and all of its entities and rooms appear here automatically.'), ' ', el('a', { href: '#connect', onclick: () => m.remove() }, 'Connect more'))), q, chips, body);
  const panes = { widgets: widgetsPane, devices: devPane };
  const tabsEl = el('div', { class: 'seg', role: 'tablist' });
  const holder = el('div', { style: 'margin-top:14px' });
  const fresh = firstLook ? 0 : newDeviceCount(devices);
  const choose = (k) => { tabsEl.replaceChildren(el('button', { class: k === 'widgets' ? 'on' : '', role: 'tab', 'aria-selected': String(k === 'widgets'), onclick: () => choose('widgets') }, T('Widgets')), el('button', { class: k === 'devices' ? 'on' : '', role: 'tab', 'aria-selected': String(k === 'devices'), onclick: () => choose('devices') }, T('Rooms & devices'), el('span', { class: 'pill', style: 'margin-left:6px' }, devices.length), fresh ? el('span', { class: 'pill good', style: 'margin-left:4px' }, `${fresh} new`) : null)); holder.replaceChildren(panes[k]); if (k === 'devices') { draw(); setTimeout(() => q.focus(), 30); } else drawWidgets(); };
  const m = modal(el('div', {}, tabsEl, holder), { title: T('Add a widget'), wide: true });
  m.querySelector('.box')?.classList.add('tall');
  new MutationObserver((_, o) => { if (!m.isConnected) { io?.disconnect(); o.disconnect(); } }).observe(document.body, { childList: true });
  choose(start);
}
tab({ id: 'home', label: 'Home', icon: 'home', async render(main) {
  const sid = screenId();
  const [data, lay, me] = await Promise.all([homeData(), api(`/api/layout${sid ? `?screen=${sid}` : ''}`).catch(() => ({})), api('/api/auth/me').catch(() => null)]);
  const ctx = { data };
  const role = me?.user?.role || 'viewer', panel = !!me?.user?.panel;
  const canShared = ['admin', 'owner'].includes(role) && !panel, canScreen = ['member', 'admin', 'owner'].includes(role);
  let own = !!lay.screen;   // this screen has its own layout
  const pickTiles = () => ((own ? lay.screen.tiles : lay.layout?.tiles) || DEFAULT_LAYOUT).filter((t) => wOf(t)).map((t) => JSON.parse(JSON.stringify(t)));
  let tiles = pickTiles();
  let saveT = null;
  const writable = () => (own ? canScreen : canShared);
  const save = () => {
    if (!writable()) return;
    clearTimeout(saveT);
    saveT = setTimeout(() => (own ? post(`/api/screen-layout/${sid}`, { tiles }, 'PUT') : post('/api/layout', { tiles }, 'PUT')).catch((e) => toast(T('Layout not saved: {message}', { message: e.message }))), 400);
  };
  const editBtn = el('button', { class: 'btn' }, icon('edit'), T('Edit layout'));
  const addBtn = el('button', { class: 'btn primary' }, icon('plus'), T('Add widget'));
  let g = null;
  const setEdit = (on) => {
    if (on && !writable()) { if (canScreen && sid) return askOwn(); toast(T('Your account can look at Home, but not change it.')); return; }
    document.body.classList.toggle('editing-on', on); g?.setEditing(on);
    editBtn.replaceChildren(icon(on ? 'check' : 'edit'), on ? T('Done') : T('Edit layout')); editBtn.classList.toggle('primary', on);
    drawBar();
  };
  editBtn.onclick = () => setEdit(!document.body.classList.contains('editing-on'));
  const panelBtn = el('button', { class: 'btn hide-phone', title: T('Wall-screen mode for this screen'), onclick: () => setPanel(true) }, icon('expand'), T('Panel mode'));
  setTop(tabLabel({ id: 'home', label: T('Home') }), fmt(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }), [addBtn, editBtn, panelBtn]);
  const whose = el('span', { class: 'tiny muted' });
  const bar = el('div', { class: 'editbar' });
  const drawBar = () => {
    whose.textContent = own ? T('This screen has its own layout.') : T('Every screen in the house shows this layout.');
    const scope = canScreen && sid ? el('div', { class: 'seg seg-mini', role: 'group', 'aria-label': T('Who sees this layout') },
      el('button', { type: 'button', class: own ? '' : 'on', disabled: !canShared || null, title: canShared ? '' : T('Only an admin can change the layout every screen shows'), onclick: () => switchOwn(false) }, T('Every screen')),
      el('button', { type: 'button', class: own ? 'on' : '', onclick: () => switchOwn(true) }, T('Just this screen'))) : null;
    bar.replaceChildren(icon('grip', 18), el('div', { class: 'grow', style: 'min-width:0' }, el('div', {}, T('Drag a widget to move it, drag its corner to resize, or tap '), icon('sliders', 14), T(' to customize it.')), whose), scope,
      el('button', { class: 'btn small', onclick: resetLayout }, icon('reset'), T('Reset')));
  };
  async function resetLayout() {
    if (own) { tiles.splice(0, tiles.length, ...(lay.layout?.tiles || DEFAULT_LAYOUT).filter((t) => wOf(t)).map((t) => JSON.parse(JSON.stringify(t)))); save(); }
    else { await post('/api/layout', { reset: true }, 'PUT'); lay.layout = null; tiles.splice(0, tiles.length, ...DEFAULT_LAYOUT.map((t) => ({ ...t }))); }
    await g.build();
  }
  async function switchOwn(on) {
    if (on === own) return;
    if (on) { own = true; lay.screen = { tiles: JSON.parse(JSON.stringify(tiles)) }; save(); toast(T('This screen now keeps its own layout.')); }
    else {
      if (!canShared) return;
      await post(`/api/screen-layout/${sid}`, { off: true }, 'PUT').catch(() => {});
      own = false; lay.screen = null; tiles.splice(0, tiles.length, ...pickTiles()); await g.build(); toast(T('This screen shows the shared layout again.'));
    }
    drawBar();
  }
  function askOwn() {
    const m = modal(el('div', {}, el('p', {}, T('Only an admin can change the layout every screen shows. You can give this screen a layout of its own - your changes stay on this screen.')),
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Not now')), el('button', { class: 'btn primary', onclick: () => { m.remove(); own = true; lay.screen = { tiles: JSON.parse(JSON.stringify(tiles)) }; save(); setEdit(true); } }, T('Customize this screen')))), { title: T('Customize Home') });
  }
  main.append(bar); drawBar();
  if (canShared || !me?.signIn) supportChecklist(main);   // getting started (39s-support.js)
  g = makeGrid(main, { tiles, ctx, onSave: save, onEdit: setEdit, onCustomize: (t, done) => customizeTile(t, ctx, done) });
  addBtn.onclick = () => {
    if (!writable() && !(canScreen && sid)) return toast(T('Your account can look at Home, but not change it.'));
    if (!writable()) return askOwn();
    widgetPicker(new Set(tiles.map((t) => String(t.id).split(':')[0])), (id, init) => {
      const added = g.add(id, init);
      if (id === 'entities') pickDevices([], (ids) => { added.t.ids = ids; added.repaint(); });
      else if (wOf(added.t)?.askFirst) customizeTile(added.t, ctx, () => added.repaint());
      setEdit(true); addBtn.querySelector('.dot-count')?.remove();
    }, { devices: ctx.data.devices?.devices || [], tiles, ctx });
  };
  const fresh = newDeviceCount(ctx.data.devices?.devices || []);
  if (fresh) addBtn.append(el('span', { class: 'dot-count', title: T('{fresh} new devices to add', { fresh }) }, fresh));
  if (!seenDevices().size) markSeen(new Set((ctx.data.devices?.devices || []).map((d) => d.id)));
  await g.build();
  return async () => { ctx.data = await homeData(); g.refresh(); };
} });
