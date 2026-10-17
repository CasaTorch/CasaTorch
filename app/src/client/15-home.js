/* ---- Home: the tile grid ---- */
async function homeData() {
  const [home, alerts, devices, settings] = await Promise.all([api('/api/home'), api('/api/alerts').catch(() => null), api('/api/devices').catch(() => null), api('/api/settings').catch(() => S.settings)]);
  return { home, alerts, devices, settings };
}
/* Add a widget. Two shelves: the built-in widgets, and "Rooms & devices" - filled automatically from
   everything CasaTorch can see, including every Home Assistant entity and area. Nothing to configure:
   add a light, a sensor or a whole room to Home in one tap. New entities are marked New. */
const SEEN_KEY = 'casatorch.seenDevices';
const seenDevices = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
const markSeen = (ids) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-3000))); } catch { /* private window */ } };
function newDeviceCount(devices) { const seen = seenDevices(); return seen.size ? devices.filter((d) => !seen.has(d.id)).length : 0; }
const KIND_GROUPS = [['all', 'All'], ['ha', 'Home Assistant'], ['light', 'Lights & switches'], ['sensor', 'Sensors'], ['climate', 'Climate'], ['camera', 'Cameras'], ['media', 'Media'], ['other', 'Everything else']];
const inGroup = (d, g) => g === 'all' || (g === 'ha' ? d.provider === 'ha' : g === 'light' ? ['light', 'switch', 'plug', 'fan'].includes(d.kind) : g === 'sensor' ? ['sensor', 'value'].includes(d.kind) : g === 'other' ? !['light', 'switch', 'plug', 'fan', 'sensor', 'value', 'climate', 'camera', 'media'].includes(d.kind) : d.kind === g);
function widgetPicker(have, onPick, { devices = [], tiles = [], start = 'widgets' } = {}) {
  const list = Object.values(WIDGETS).filter((w) => !w.hidden && (w.multi || !have.has(w.id)));
  const seen = seenDevices(), firstLook = !seen.size, onHome = new Set(tiles.map((t) => t.device).filter(Boolean)), roomsOnHome = new Set(tiles.map((t) => t.area).filter(Boolean));
  const fromHa = devices.filter((d) => d.provider === 'ha').length;
  const pick = (id, init) => { m.remove(); markSeen(new Set([...seen, ...devices.map((d) => d.id)])); onPick(id, init); };
  const widgetsPane = list.length ? el('div', { class: 'picker' }, list.map((w) => el('button', { onclick: () => pick(w.id) }, icon(w.icon), el('div', {}, el('b', {}, w.title, w.pro ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'PRO') : null), el('div', { class: 'tiny muted' }, WIDGET_BLURB[w.id] || ''))))) : el('p', { class: 'muted' }, 'Every widget is already on your Home screen.');
  let group = 'all';
  const q = el('input', { type: 'search', placeholder: 'Search rooms, devices and Home Assistant entities…', 'aria-label': 'Search devices' });
  const chips = el('div', { class: 'chips' });
  const body = el('div', { class: 'dev-pick' });
  const devRow = (d) => el('div', { class: 'pick-row' }, el('span', { class: 'ic' }, icon(devIconName(d))),
    el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'ellipsis' }, d.name, !firstLook && !seen.has(d.id) ? el('span', { class: 'pill good', style: 'margin-left:6px' }, 'New') : null),
      el('div', { class: 'tiny muted ellipsis' }, [devMeta(d, true), d.provider === 'ha' ? `Home Assistant · ${d.id.slice(3)}` : pretty(d.provider)].filter(Boolean).join(' · '))),
    onHome.has(d.id) ? el('span', { class: 'tiny faint' }, 'On Home') : null,
    el('button', { class: 'btn small', onclick: () => pick('device', { device: d.id, title: d.name, ...(d.kind === 'camera' ? { w: 4, h: 3 } : {}) }) }, icon('plus'), 'Add'));
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const match = (d) => inGroup(d, group) && (!t || `${d.name} ${d.id} ${d.area || ''} ${d.kind}`.toLowerCase().includes(t));
    chips.replaceChildren(...KIND_GROUPS.filter(([g]) => g === 'all' || devices.some((d) => inGroup(d, g))).map(([g, label]) => el('button', { class: `chip${g === group ? ' on' : ''}`, onclick: () => { group = g; draw(); } }, label, el('span', { class: 'faint' }, ` ${devices.filter((d) => inGroup(d, g)).length}`))));
    const shown = devices.filter(match);
    const areas = [...new Set(devices.map((d) => d.area).filter(Boolean))].sort().filter((a) => !t || a.toLowerCase().includes(t) || shown.some((d) => d.area === a));
    const out = [];
    if (areas.length && group === 'all') out.push(el('h4', {}, 'Rooms'), el('div', { class: 'room-picks' }, areas.map((a) => { const n = devices.filter((d) => d.area === a).length; return el('button', { class: 'room-pick', onclick: () => pick('room', { area: a, title: a }) }, icon('home'), el('div', { style: 'min-width:0' }, el('b', { class: 'ellipsis' }, a), el('div', { class: 'tiny muted' }, roomsOnHome.has(a) ? `${n} devices · on Home` : `${n} devices`))); })));
    const byArea = new Map(); for (const d of shown) { const k = d.area || ''; if (!byArea.has(k)) byArea.set(k, []); byArea.get(k).push(d); }
    for (const [a, ds] of [...byArea].sort(([x], [y]) => (!x) - (!y) || x.localeCompare(y))) out.push(el('h4', {}, a || (areas.length ? 'Not in a room' : 'Devices')), ...ds.slice(0, 400).map(devRow));
    if (!shown.length && !(areas.length && group === 'all')) out.push(el('p', { class: 'muted small' }, devices.length ? 'Nothing matches.' : 'No devices yet. Connect your gear or Home Assistant on the Connect tab and everything shows up here by itself.'));
    body.replaceChildren(...out);
  };
  q.oninput = draw;
  const devPane = el('div', {}, el('div', { class: 'callout small' }, icon('spark'), el('div', {}, fromHa ? `${fromHa} Home Assistant entities are ready to add - anything new in Home Assistant appears here automatically.` : 'Every device CasaTorch can see is ready to add. Connect Home Assistant and all of its entities and rooms appear here automatically.', ' ', el('a', { href: '#connect', onclick: () => m.remove() }, 'Connect more'))), q, chips, body);
  const panes = { widgets: widgetsPane, devices: devPane };
  const tabsEl = el('div', { class: 'seg', role: 'tablist' });
  const holder = el('div', { style: 'margin-top:14px' });
  const fresh = firstLook ? 0 : newDeviceCount(devices);
  const choose = (k) => { tabsEl.replaceChildren(el('button', { class: k === 'widgets' ? 'on' : '', role: 'tab', onclick: () => choose('widgets') }, 'Widgets'), el('button', { class: k === 'devices' ? 'on' : '', role: 'tab', onclick: () => choose('devices') }, 'Rooms & devices', el('span', { class: 'pill', style: 'margin-left:6px' }, devices.length), fresh ? el('span', { class: 'pill good', style: 'margin-left:4px' }, `${fresh} new`) : null)); holder.replaceChildren(panes[k]); if (k === 'devices') { draw(); setTimeout(() => q.focus(), 30); } };
  const m = modal(el('div', {}, tabsEl, holder), { title: 'Add a widget', wide: true });
  choose(start);
}
const WIDGET_BLURB = { clock: 'Big time and date', weather: 'Now, the next hours, the week', calendar: 'What\'s next on your calendars', sports: 'Scores and next games', news: 'Headlines from your sources', internet: 'Online, speed, ping', today: 'Reminders and the house note',
  alerts: 'What needs you', energy: 'Watts now and what it costs', lights: 'Tap to switch lights and plugs', camera: 'Live snapshots', photos: 'Your photos on a slow loop', entities: 'A group of devices or Home Assistant entities you pick - add as many as you like', ask: 'Ask anything about your home', house3d: 'Your LiDAR floor plan, live' };
tab({ id: 'home', label: 'Home', icon: 'home', async render(main) {
  const ctx = { data: await homeData() };
  const saved = (await api('/api/layout').catch(() => ({}))).layout?.tiles;
  const tiles = (saved || DEFAULT_LAYOUT).filter((t) => WIDGETS[t.id.split(':')[0]]).map((t) => ({ ...t }));
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => post('/api/layout', { tiles }, 'PUT').catch((e) => toast(`Layout not saved: ${e.message}`)), 400); };
  const editBtn = el('button', { class: 'btn' }, icon('edit'), T('Edit layout'));
  const addBtn = el('button', { class: 'btn primary' }, icon('plus'), T('Add widget'));
  const setEdit = (on) => { document.body.classList.toggle('editing-on', on); grid.classList.toggle('editing', on); editBtn.replaceChildren(icon(on ? 'check' : 'edit'), on ? T('Done') : T('Edit layout')); editBtn.classList.toggle('primary', on); };
  editBtn.onclick = () => setEdit(!grid.classList.contains('editing'));
  const panelBtn = el('button', { class: 'btn', title: 'Wall-screen mode for this screen', onclick: () => setPanel(true) }, icon('expand'), T('Panel mode'));
  setTop(tabLabel({ id: 'home', label: 'Home' }), fmt(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }), [addBtn, editBtn, panelBtn]);
  const bar = el('div', { class: 'editbar' }, icon('grip', 18), el('span', { class: 'grow' }, 'Drag a tile by its handle to move it. Drag the corner to resize - tiles show more as they grow.'),
    el('button', { class: 'btn small', onclick: async () => { await post('/api/layout', { reset: true }, 'PUT'); show('home'); } }, icon('reset'), 'Reset'));
  main.append(bar);
  const g = makeGrid(main, { tiles, ctx, onSave: save });
  const grid = main.querySelector('.grid');
  addBtn.onclick = () => widgetPicker(new Set(tiles.map((t) => t.id.split(':')[0])), (id, init) => { const added = g.add(id, init); if (id === 'entities') pickDevices([], (ids) => { added.t.ids = ids; added.repaint(); }); else setEdit(true); addBtn.querySelector('.dot-count')?.remove(); }, { devices: ctx.data.devices?.devices || [], tiles });
  const fresh = newDeviceCount(ctx.data.devices?.devices || []);
  if (fresh) addBtn.append(el('span', { class: 'dot-count', title: `${fresh} new devices to add` }, fresh));
  if (!seenDevices().size) markSeen(new Set((ctx.data.devices?.devices || []).map((d) => d.id)));
  await g.build();
  return async () => { ctx.data = await homeData(); g.refresh(); };
} });
