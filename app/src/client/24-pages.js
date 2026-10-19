/* ======================================================================
 * Alerts, Controls and Cameras as page grids (06-pagegrid.js): each section is a tile you can move, resize
 * (Small to Extra large - these pages size tiles to their content) or remove, and add back from the gallery.
 * CasaTorch suggests the sections from what the house has (60-layout.js).
 * ====================================================================== */
/* A tile's header says what it shows when the tile has no name of its own (a Controls group, one camera). */
const tileHeader = (b, text) => { if (b._t && !b._t.title && text) { const ttl = b.closest('.tile')?.querySelector('.ttl'); if (ttl && ttl.textContent !== text) ttl.textContent = text; } };
const pgPut = (b, ...k) => b.replaceChildren(...k.flat().filter((x) => x != null && x !== false && x !== ''));

/* ---- Alerts ---- */
const alSevDot = (s) => (s === 'ok' ? 'good' : s === 'critical' ? 'bad' : 'warn');
pageTile({ id: 'al-now', page: 'alerts', auto: true, title: 'Right now', icon: 'bell', blurb: 'What needs you at this moment', size: [6, 1], render(b, ctx) {
  const a = ctx.data.alerts || {};
  if (!a.now?.length) return pgPut(b, el('div', { class: 'row' }, el('span', { class: 'dot good' }), T('All clear - nothing needs you.')));
  pgPut(b, (a.now || []).map((x) => el('div', { class: `alert ${x.severity}` }, el('div', { class: 'grow' }, el('b', {}, alertTitle(x)), el('div', { class: 'small muted' }, [srcName(x.source), x.since ? T('since {when}', { when: fmtWhen(x.since) }) : '', x.acked ? T('{name} has it ({time})', { name: x.acked.by, time: fmtTime(x.acked.at) }) : ''].filter(Boolean).join(' · '))),
    x.repeating ? el('button', { class: 'btn small', onclick: async (e) => { e.currentTarget.disabled = true; try { await post(`/api/alerts/${encodeURIComponent(x.id)}/ack`); toast(T('Got it - no more reminders for this one')); ctx.refresh?.(); } catch (err) { toast(err.message); e.target.disabled = false; } } }, icon('check'), T('Got it')) : null)));
} });
pageTile({ id: 'al-recent', page: 'alerts', auto: true, title: 'Recent', icon: 'list', blurb: 'Everything that happened lately, newest first', size: [6, 1],
  options: [{ key: 'n', type: 'select', label: 'How many', numeric: true, choices: [[10, '10'], [25, '25'], [50, '50']], default: 25 }], render(b, ctx) {
    const a = ctx.data.alerts || {}, n = optsOf(b._t || {}).n || 25;
    pgPut(b, a.recent?.length ? el('ul', { class: 'list' }, a.recent.slice(0, n).map((x) => el('li', {}, el('span', { class: `dot ${alSevDot(x.severity)}` }), el('div', { class: 'grow' }, alertTitle(x)), el('span', { class: 'small muted' }, fmtWhen(x.at))))) : el('p', { class: 'muted' }, T('Nothing yet.')));
  } });
pageTile({ id: 'al-week', page: 'alerts', auto: true, title: 'This week', icon: 'calendar', blurb: 'How many alerts each day', size: [6, 1], render(b, ctx) {
  const days = (ctx.data.history?.days || []).slice(-7);
  if (!days.some((d) => d.kwh != null || d.alerts)) return pgPut(b, el('p', { class: 'muted small' }, T('Shows after the first day.')));
  const total = days.reduce((s, d) => s + (d.alerts || 0), 0);
  pgPut(b, el('div', { class: 'en-stat' }, el('div', { class: 'en-val sm' }, String(total)), el('div', { class: 'en-sub' }, T('alerts in the last 7 days'))),
    el('div', { style: 'height:150px;display:flex;margin-top:8px' }, enColumns(days.map((d) => d.alerts || 0), { labels: days.map((d) => enDay(d.date)), unit: '', int: true, cls: 'al-c', fmtTip: (i) => [el('b', {}, enDay(days[i].date, { weekday: 'long', month: 'short', day: 'numeric' })), el('div', {}, T('{n} alerts', { n: days[i].alerts || 0 }))] })));
} });
pageTile({ id: 'al-sources', page: 'alerts', auto: true, title: 'Where they come from', icon: 'grid', blurb: 'Which devices and services raise the most alerts', size: [6, 1], render(b, ctx) {
  const by = new Map();
  for (const x of ctx.data.alerts?.recent || []) { if (x.severity === 'ok') continue; const k = srcName(x.source) || T('CasaTorch'); by.set(k, (by.get(k) || 0) + 1); }
  const list = [...by].sort((a, c) => c[1] - a[1]).slice(0, 8), max = Math.max(1, ...list.map(([, n]) => n));
  pgPut(b, list.length ? el('div', { class: 'en-rank' }, list.map(([k, n]) => el('div', { class: 'en-rk-m' }, el('div', { class: 'row between' }, el('span', { class: 'ellipsis' }, k), el('b', { class: 'num' }, n)), el('div', { class: 'en-track' }, el('i', { style: `width:${n / max * 100}%` }))))) : el('p', { class: 'muted small' }, T('Nothing yet.')));
} });
pageTile({ id: 'al-phones', page: 'alerts', auto: true, title: 'Phones & alerts', icon: 'phone', blurb: 'Which alerts reach your phone, and quiet hours', size: [12, 1], render(b) {
  pgPut(b, el('div', { class: 'row between wrap', style: 'gap:10px' }, el('span', { class: 'small muted' }, T('Which alerts reach your phone, and quiet hours:')), el('a', { class: 'btn small', href: '#settings/phones' }, icon('phone'), T('Phones & alerts'))));
} });
async function alertsPage(main) {
  const load = async () => { const [alerts, history] = await Promise.all([api('/api/alerts'), api('/api/history?days=7').catch(() => null)]); return { alerts, history }; };
  return pageGrid(main, { page: 'alerts', auto: true, title: tabLabel({ id: 'alerts', label: T('Alerts') }), load });
}

/* ---- Controls: everything that switches, plus sensors, one tile per kind ---- */
const CTL_GROUPS = { lights: ['Lights', (d) => d.kind === 'light'], plugs: ['Plugs & switches', (d) => d.kind === 'plug' || d.kind === 'switch'], climate: ['Climate', (d) => d.kind === 'climate'], fans: ['Fans', (d) => d.kind === 'fan'],
  media: ['Media', (d) => d.kind === 'media'], covers: ['Blinds, doors & covers', (d) => d.kind === 'cover'], locks: ['Locks & alarm', (d) => d.kind === 'lock' || d.kind === 'alarm'], actions: ['Scenes & scripts', (d) => d.kind === 'action'],
  vacuums: ['Vacuums', (d) => d.kind === 'vacuum'], people: ['People', (d) => d.kind === 'presence'], sensors: ['Sensors', (d) => d.kind === 'sensor'], other: ['Everything else', (d) => d.kind === 'value'] };
const ctlMatch = (ctx) => { const t = (ctx.query || '').toLowerCase(); return (d) => d.kind !== 'camera' && (!t || `${d.name} ${d.id} ${d.domain || ''} ${d.area || ''}`.toLowerCase().includes(t)); };
pageTile({ id: 'ctl-group', page: 'controls', auto: true, multi: true, askFirst: true, title: 'Devices', icon: 'sliders', blurb: 'One kind of device: lights, plugs, climate, sensors...', size: [6, 1],
  options: [{ key: 'group', type: 'select', label: 'Which devices', choices: Object.entries(CTL_GROUPS).map(([k, [l]]) => [k, l]), default: 'lights' }],
  render(b, ctx) {
    const key = optsOf(b._t || {}).group || 'lights', [name, f] = CTL_GROUPS[key] || CTL_GROUPS.lights;
    const ds = (ctx.data.devices || []).filter(ctlMatch(ctx)).filter(f);
    tileHeader(b, `${T(name)} (${ds.length})`);
    if (!ds.length) return pgPut(b, el('p', { class: 'muted small' }, ctx.query ? T('Nothing matches that search.') : T('None of these yet.')));
    const grid = el('div', { class: 'devs' }, ds.slice(0, key === 'other' && !ctx.query ? 60 : 500).map((d) => devButton(d)));
    pgPut(b, key === 'other' && !ctx.query && ds.length > 12 ? el('details', {}, el('summary', { class: 'small muted', style: 'cursor:pointer' }, T('Show all {n}', { n: ds.length })), grid) : grid);
  } });
pageTile({ id: 'ctl-summary', page: 'controls', auto: true, title: 'At a glance', icon: 'home', blurb: 'Lights on, plugs on, doors open, who is home', size: [12, 1], render(b, ctx) {
  const ds = ctx.data.devices || [], c = (f) => ds.filter(f).length;
  const chip = (ic, text, n, total, cls = '') => (total ? el('div', { class: `ctl-chip ${cls}` }, icon(ic, 18), el('div', {}, el('b', {}, n), el('span', { class: 'muted' }, ` / ${total}`), el('div', { class: 'tiny muted' }, T(text)))) : null);
  const temps = ds.filter((d) => d.kind === 'climate' && Number.isFinite(d.current));
  pgPut(b, el('div', { class: 'ctl-chips' },
    chip('bulb', 'lights on', c((d) => d.kind === 'light' && d.on), c((d) => d.kind === 'light')),
    chip('plug', 'plugs on', c((d) => (d.kind === 'plug' || d.kind === 'switch') && d.on), c((d) => d.kind === 'plug' || d.kind === 'switch')),
    chip('door', 'open', c((d) => d.kind === 'cover' && d.open), c((d) => d.kind === 'cover'), c((d) => d.kind === 'cover' && d.open) ? 'warn' : ''),
    chip('lock', 'locked', c((d) => d.kind === 'lock' && d.locked), c((d) => d.kind === 'lock')),
    chip('user', 'home', c((d) => d.kind === 'presence' && d.home), c((d) => d.kind === 'presence')),
    temps.length ? el('div', { class: 'ctl-chip' }, icon('thermo', 18), el('div', {}, el('b', {}, temps.map((d) => `${Math.round(d.current)}°`).slice(0, 3).join(' · ')), el('div', { class: 'tiny muted' }, T('inside')))) : null));
} });
pageTile({ id: 'ctl-start', page: 'controls', auto: true, title: 'Get started', icon: 'plug', blurb: 'Connect your first devices', size: [12, 1], render(b) {
  pgPut(b, enEmpty(T('No devices yet. Connect Hue, Shelly, YoLink or Home Assistant in setup.'), '#connect', T('Connect')));
} });
async function controlsPage(main) {
  let errors = [];
  const load = async () => { const r = await api('/api/devices'); errors = r.errors || []; return { devices: r.devices || [] }; };
  const search = el('input', { type: 'search', placeholder: T('Search everything - lights, sensors, Home Assistant entities…'), style: 'max-width:520px' }), count = el('span', { class: 'small muted' });
  let qt = null;
  search.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { const ctx = pageCtx(main); if (!ctx) return; ctx.query = search.value.trim(); ctx.rebuild(); counted(); }, 120); };
  const counted = () => { const ctx = pageCtx(main), all = (ctx?.data.devices || []).filter((d) => d.kind !== 'camera'); count.textContent = T('{n} of {total}', { n: all.filter(ctlMatch(ctx || {})).length, total: all.length }); };
  const renameBtn = el('button', { class: 'btn' }, icon('edit'), el('span', { class: 'hide-phone' }, T('Rename devices')));
  const refresh = await pageGrid(main, { page: 'controls', auto: true, title: tabLabel({ id: 'controls', label: T('Controls') }), load, actions: [renameBtn], before: [el('div', { class: 'row wrap', style: 'margin-bottom:12px' }, search, count)] });
  const ctx = pageCtx(main);
  if (ctx?.data.devices.some((d) => d.provider === 'ha')) $('#subtitle').textContent = T('Includes everything from Home Assistant');
  renameBtn.onclick = () => renameDevices(ctx?.data.devices || [], refresh);
  counted();
  if (errors.length) main.append(...errors.map((e) => el('p', { class: 'small muted' }, `${e.provider}: ${e.error}`)));
  return async () => { if (document.activeElement === search) return; await refresh?.(); counted(); };
}

/* ---- Cameras ---- */
const camCanEdit = () => !S.status?.demo && (!S.me?.user?.role || ['owner', 'admin'].includes(S.me.user.role));
async function camVisible(ctx, id, visible) {
  try { await api(`/api/cameras/${encodeURIComponent(id)}/visible`, { method: 'PUT', body: JSON.stringify({ visible }) }); toast(visible ? T('Camera added back') : T('Camera removed - find it under Detected cameras')); await ctx.refresh?.(); }
  catch (e) { toast(e.message); }
}
pageTile({ id: 'cam-wall', page: 'cameras', auto: true, title: 'Cameras', icon: 'camera', blurb: 'Every camera, live - or just the ones you pick', size: [12, 1],
  options: [{ key: 'only', type: 'devices', label: 'Which cameras', filter: (d) => d.kind === 'camera', help: 'None picked: every camera.' }],
  render(b, ctx) {
    const pick = optsOf(b._t || {}).only, all = (ctx.data.devices || []).filter((d) => d.kind === 'camera'), cams = Array.isArray(pick) && pick.length ? all.filter((d) => pick.includes(d.id)) : all;
    const key = cams.map((d) => d.id).join('|');
    if (b._key === key && b.firstChild) return;   // each picture keeps itself fresh: the wall is only rebuilt when cameras come or go
    b._key = key;
    if (!cams.length) return pgPut(b, el('p', { class: 'muted small' }, T('All your cameras are hidden.')));
    pgPut(b, el('div', { class: 'cams' }, cams.map((d) => { const t = camView(d); if (camCanEdit() && !t.querySelector('.cam-x')) t.append(el('button', { class: 'cam-x', title: T('Remove this camera'), 'aria-label': T('Remove {name}', { name: d.name }), onclick: (e) => { e.stopPropagation(); camVisible(ctx, d.id, false); } }, icon('x', 14))); return t; })));
  } });
pageTile({ id: 'cam-one', page: 'cameras', auto: true, multi: true, askFirst: true, title: 'One camera', icon: 'camera', blurb: 'A single camera, as big as you like', size: [6, 1],
  options: [{ key: 'device', type: 'device', label: 'Which camera', filter: (d) => d.kind === 'camera' }], render(b, ctx) {
    const id = b._t?.device || optsOf(b._t || {}).device, d = (ctx.data.devices || []).find((x) => x.id === id);
    if (!d) return pgPut(b, el('p', { class: 'muted small' }, T('Pick a camera: tap the sliders while editing.')));
    tileHeader(b, d.name);
    if (b._key === d.id && b.firstChild) return; b._key = d.id;
    pgPut(b, el('div', { class: 'cams one' }, camView(d)));
  } });
pageTile({ id: 'cam-det', page: 'cameras', auto: true, bare: true, title: 'Detections', icon: 'user', blurb: 'What your cameras saw - people, cars, animals, packages (Frigate)', size: [12, 1], render(b) {
  if (b.firstChild) return; pgPut(b, detectionsCard());   // keeps itself up to date
} });
pageTile({ id: 'cam-hidden', page: 'cameras', auto: true, title: 'Detected cameras not shown', icon: 'camera', blurb: 'Cameras you removed, and the same camera seen twice', size: [12, 1], render(b, ctx) {
  const hidden = ctx.data.hiddenCameras || [];
  if (!hidden.length) return pgPut(b, el('p', { class: 'muted small' }, T('Every camera is shown.')));
  pgPut(b, el('p', { class: 'small muted', style: 'margin-top:0' }, T('Removed ones, and the same camera reached a second way (through Home Assistant) - CasaTorch shows the faster direct one. Add any back if you want both.')),
    el('div', { class: 'list' }, hidden.map((h) => el('div', { class: 'row between', style: 'padding:6px 0' }, el('div', {}, el('b', {}, h.name), el('div', { class: 'tiny muted' }, `${h.source} · ${h.why === 'duplicate' ? T('same camera as "{name}"', { name: h.of }) : T('removed')}`)),
      camCanEdit() ? el('button', { class: 'btn small', onclick: () => camVisible(ctx, h.id, true) }, icon('plus', 14), T('Add back')) : null))));
} });
pageTile({ id: 'cam-start', page: 'cameras', auto: true, title: 'Add cameras', icon: 'camera', blurb: 'Connect your first camera', size: [12, 1], render(b) {
  pgPut(b, enEmpty(T('No cameras yet. Add Frigate, Reolink, any camera with a snapshot address, Ring (Pro) or cameras in Home Assistant from Connect.'), '#connect', T('Connect')));
} });
async function camerasPage(main) {
  S.me ||= await api('/api/auth/me').catch(() => ({}));
  const load = async () => { const r = await api('/api/devices'); return { devices: r.devices || [], hiddenCameras: r.hiddenCameras || [] }; };
  return pageGrid(main, { page: 'cameras', auto: true, title: tabLabel({ id: 'cameras', label: T('Cameras') }), load });
}
