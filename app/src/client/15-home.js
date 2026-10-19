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
function widgetPicker(have, onPick, { devices = [], tiles = [], ctx, start = 'widgets', suggested = [] } = {}) {
  const sugg = new Set(suggested.map((t) => String(t.id).split(':')[0]).filter((id) => !have.has(id)));   // suggested and not on Home yet
  const list = Object.values(WIDGETS).filter((w) => !w.hidden && (w.multi || !have.has(w.id))).sort((a, b) => sugg.has(b.id) - sugg.has(a.id));
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
    const sizeBar = el('div', { class: 'seg seg-mini' }, sizes.map(([k, label, sz]) => el('button', { type: 'button', class: sz === chosen ? 'on' : '', title: label, onclick: (e) => { chosen = sz; [...sizeBar.children].forEach((x) => x.classList.toggle('on', x === e.currentTarget)); pv.__show(); } }, sizeShort(label))));
    const c = el('div', { class: 'wg-card' }, pv,
      el('div', { class: 'wg-meta' }, el('b', {}, T(w.title), w.pro ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'PRO') : null, w.isNew ? el('span', { class: 'newtag' }, T('New')) : null, sugg.has(w.id) ? el('span', { class: 'pill good', style: 'margin-left:6px' }, T('Suggested')) : null), el('div', { class: 'tiny muted' }, w.blurb ? T(w.blurb) : '')),
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
/* Home is a page grid like every other page (06-pagegrid.js): the same Edit, the same bar, the same "who sees this
   layout" (everyone, every phone/tablet/computer, just me, this screen), suggested from what the house has. Its
   gallery is the big one: widgets by kind, plus every room and device. Older Home layouts are carried over by the
   server (60-layout.js). */
tab({ id: 'home', label: 'Home', icon: 'home', async render(main) {
  S.me ||= await api('/api/auth/me').catch(() => null);
  const role = S.me?.user?.role || 'viewer';
  const panelBtn = el('button', { class: 'btn hide-phone', title: T('Wall-screen mode for this screen'), onclick: () => setPanel(true) }, icon('expand'), T('Panel mode'));
  const start = el('div');
  if ((['admin', 'owner'].includes(role) && !S.me?.user?.panel) || !S.me?.signIn) supportChecklist(start);   // getting started (39s-support.js)
  let devs = [];
  const refresh = await pageGrid(main, { page: 'home', title: tabLabel({ id: 'home', label: T('Home') }), sub: fmt(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }),
    load: async () => { const d = await homeData(); devs = d.devices?.devices || []; return d; }, fallback: DEFAULT_LAYOUT, actions: [panelBtn], before: [start], addLabel: 'Add widget',
    gallery: ({ tiles, ctx, suggested, onPick }) => widgetPicker(new Set(tiles.map((t) => String(t.id).split(':')[0])), (id, init) => { onPick(id, init); $('.pg-add .dot-count')?.remove(); }, { devices: devs, tiles, ctx, suggested }),
    onAdded: (id, added) => {
      const ctx = pageCtx(main);
      if (id === 'entities') pickDevices([], (ids) => { added.t.ids = ids; added.repaint(); });
      else if (wOf(added.t)?.askFirst && ctx) customizeTile(added.t, ctx, () => added.repaint());
    } });
  const fresh = newDeviceCount(devs), add = $('.pg-add');
  if (fresh && add) add.append(el('span', { class: 'dot-count', title: T('{fresh} new devices to add', { fresh }) }, fresh));
  if (!seenDevices().size) markSeen(new Set(devs.map((d) => d.id)));
  return refresh;
} });
