/* ---- Home: the tile grid ---- */
async function homeData() {
  const [home, alerts, devices, settings] = await Promise.all([api('/api/home'), api('/api/alerts').catch(() => null), api('/api/devices').catch(() => null), api('/api/settings').catch(() => S.settings)]);
  return { home, alerts, devices, settings };
}
function widgetPicker(have, onPick) {
  const list = Object.values(WIDGETS).filter((w) => !have.has(w.id));
  const m = modal(list.length ? el('div', { class: 'picker' }, list.map((w) => el('button', { onclick: () => { m.remove(); onPick(w.id); } }, icon(w.icon), el('div', {}, el('b', {}, w.title, w.pro ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'PRO') : null), el('div', { class: 'tiny muted' }, WIDGET_BLURB[w.id] || ''))))) : el('p', { class: 'muted' }, 'Every widget is already on your Home screen.'), { title: 'Add a widget', wide: true });
}
const WIDGET_BLURB = { clock: 'Big time and date', weather: 'Now, the next hours, the week', calendar: 'What\'s next on your calendars', sports: 'Scores and next games', news: 'Headlines from your sources', internet: 'Online, speed, ping', today: 'Reminders and the house note',
  alerts: 'What needs you', energy: 'Watts now and what it costs', lights: 'Tap to switch lights and plugs', camera: 'Live snapshots', photos: 'Your photos on a slow loop', ask: 'Ask anything about your home', house3d: 'Your LiDAR floor plan, live' };
tab({ id: 'home', label: 'Home', icon: 'home', async render(main) {
  const ctx = { data: await homeData() };
  const saved = (await api('/api/layout').catch(() => ({}))).layout?.tiles;
  const tiles = (saved || DEFAULT_LAYOUT).filter((t) => WIDGETS[t.id]).map((t) => ({ ...t }));
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => post('/api/layout', { tiles }, 'PUT').catch((e) => toast(`Layout not saved: ${e.message}`)), 400); };
  const editBtn = el('button', { class: 'btn' }, icon('edit'), 'Edit layout');
  const addBtn = el('button', { class: 'btn primary' }, icon('plus'), 'Add widget');
  const setEdit = (on) => { document.body.classList.toggle('editing-on', on); grid.classList.toggle('editing', on); editBtn.replaceChildren(icon(on ? 'check' : 'edit'), on ? 'Done' : 'Edit layout'); editBtn.classList.toggle('primary', on); };
  editBtn.onclick = () => setEdit(!grid.classList.contains('editing'));
  setTop('Home', fmt(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }), [addBtn, editBtn]);
  const bar = el('div', { class: 'editbar' }, icon('grip', 18), el('span', { class: 'grow' }, 'Drag a tile by its handle to move it. Drag the corner to resize - tiles show more as they grow.'),
    el('button', { class: 'btn small', onclick: async () => { await post('/api/layout', { reset: true }, 'PUT'); show('home'); } }, icon('reset'), 'Reset'));
  main.append(bar);
  const g = makeGrid(main, { tiles, ctx, onSave: save });
  const grid = main.querySelector('.grid');
  addBtn.onclick = () => widgetPicker(new Set(tiles.map((t) => t.id)), (id) => { g.add(id); setEdit(true); });
  await g.build();
  return async () => { ctx.data = await homeData(); g.refresh(); };
} });
