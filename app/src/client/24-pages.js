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
pageTile({ id: 'al-now', page: 'alerts', auto: true, title: 'Right now', icon: 'bell', blurb: 'What needs you at this moment', size: [6, 1], render(b, ctx, size) {
  const a = ctx.data.alerts || {};
  if (size.tier === 's' && a.now?.length) return pgPut(b, el('div', { class: 'en-stat' }, el('div', { class: 'en-val sm' }, String(a.now.length)), el('div', { class: 'en-sub' }, T(a.now.length === 1 ? 'needs you now' : 'need you now'))), el('div', { class: 'small ellipsis' }, alertTitle(a.now[0])));
  if (!a.now?.length) return pgPut(b, el('div', { class: 'row' }, el('span', { class: 'dot good' }), T('All clear - nothing needs you.')));
  pgPut(b, (a.now || []).map((x) => el('div', { class: `alert ${x.severity}` }, el('div', { class: 'grow' }, el('b', {}, alertTitle(x)), el('div', { class: 'small muted' }, [srcName(x.source), x.since ? T('since {when}', { when: fmtWhen(x.since) }) : '', x.acked ? T('{name} has it ({time})', { name: x.acked.by, time: fmtTime(x.acked.at) }) : ''].filter(Boolean).join(' · '))),
    alertActions(x, ctx))));   // Got it, snooze, resolve, mute the device (37a-alert-rules.js)
} });
pageTile({ id: 'al-recent', page: 'alerts', auto: true, title: 'Recent', icon: 'list', blurb: 'Everything that happened lately, newest first', size: [6, 1],
  options: [{ key: 'n', type: 'select', label: 'How many', numeric: true, choices: [[0, 'As many as fit the size'], [10, '10'], [25, '25'], [50, '50']], default: 0 }], render(b, ctx, size) {
    const a = ctx.data.alerts || {}, n = optsOf(b._t || {}).n || { s: 5, m: 10, l: 25, xl: 50 }[size.tier || 'm'];
    pgPut(b, a.recent?.length ? el('ul', { class: 'list' }, a.recent.slice(0, n).map((x) => el('li', { class: S.status?.demo ? null : 'al-tap', role: S.status?.demo ? null : 'button', tabindex: S.status?.demo ? null : '0', onclick: S.status?.demo ? null : () => alertSheet(x, ctx) }, el('span', { class: `dot ${alSevDot(x.severity)}` }), el('div', { class: 'grow' }, alertTitle(x), size.tier === 'xl' && x.source ? el('div', { class: 'tiny muted' }, srcName(x.source)) : null), el('span', { class: 'small muted' }, fmtWhen(x.at))))) : pgEmpty(T('Nothing yet. Alerts from your devices and CasaTorch show up here.'), null, null));
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

/* ---- Controls: rooms (Home Assistant areas), favorites, scenes, climate, and everything by kind ----
   Tap a device to switch it; press and hold it for everything about it (deviceDetails, 10-widgets.js).
   Every tile is size-adaptive: Small is the room or group at a glance, Medium adds the switches, Large the
   sensors, Extra large a table of every reading with its last 24 hours. */
const CTL_GROUPS = { lights: ['Lights', (d) => d.kind === 'light'], plugs: ['Plugs & switches', (d) => d.kind === 'plug' || d.kind === 'switch'], climate: ['Climate', (d) => d.kind === 'climate'], fans: ['Fans', (d) => d.kind === 'fan'],
  media: ['Media', (d) => d.kind === 'media'], covers: ['Blinds, doors & covers', (d) => d.kind === 'cover'], locks: ['Locks & alarm', (d) => d.kind === 'lock' || d.kind === 'alarm'], actions: ['Scenes & scripts', (d) => d.kind === 'action'],
  vacuums: ['Vacuums', (d) => d.kind === 'vacuum'], people: ['People', (d) => d.kind === 'presence'], sensors: ['Sensors', (d) => d.kind === 'sensor'], other: ['Everything else', (d) => d.kind === 'value'] };
const ctlMatch = (ctx) => { const t = (ctx.query || '').toLowerCase(); return (d) => d.kind !== 'camera' && (!t || `${d.name} ${d.id} ${d.domain || ''} ${d.area || ''}`.toLowerCase().includes(t)); };
const ctlDevs = (ctx) => (ctx.data.devices || []).filter(ctlMatch(ctx));
const isReading = (d) => d.kind === 'sensor' || d.kind === 'value';
/* As many as fit the tier, then "Show all". */
function ctlButtons(ds, size, { limit } = {}) {
  const max = limit ?? { s: 4, m: 12, l: 40, xl: 400 }[size.tier || 'm'];
  const grid = el('div', { class: `devs${size.tier === 's' ? ' devs-s' : ''}` }, ds.slice(0, max).map((d) => devButton(d, true)));
  if (ds.length <= max) return grid;
  const more = el('button', { class: 'btn small ghost pg-more', onclick: () => { grid.replaceChildren(...ds.map((d) => devButton(d, true))); more.remove(); } }, T('Show all {n}', { n: ds.length }));
  return el('div', {}, grid, more);
}
/* Every reading with its last 24 hours: name, now, a sparkline, low and high. */
function sensorTable(ds) {
  const tb = el('tbody');
  const table = el('table', { class: 'pg-table' }, el('thead', {}, el('tr', {}, el('th', {}, T('Sensor')), el('th', {}, T('Now')), el('th', { class: 'hide-phone' }, T('Last 24 hours')), el('th', { class: 'hide-phone num' }, T('Low')), el('th', { class: 'hide-phone num' }, T('High')))), tb);
  const rows = new Map(ds.slice(0, 60).map((d) => { const spark = el('td', { class: 'hide-phone' }), lo = el('td', { class: 'hide-phone num muted' }), hi = el('td', { class: 'hide-phone num muted' });
    const tr = el('tr', { onclick: () => deviceDetails(d), style: 'cursor:pointer' }, el('td', {}, el('span', { class: 'row', style: 'gap:8px' }, icon(devIconName(d), 15), el('span', { class: 'ellipsis' }, d.name))), el('td', { class: 'num' }, devHeadline(d) || devMeta(d, true)), spark, lo, hi);
    tb.append(tr); return [d.id, { d, spark, lo, hi }]; }));
  devHistory([...rows.values()].filter((r) => shFieldOf(r.d)).map((r) => r.d.id)).then((sr) => {
    for (const [id, r] of rows) { const s = sr[id]; if (!s) continue; const n = s.v.filter(Number.isFinite); if (n.length < 2) continue; const f = histFmt(s.field, r.d);
      r.spark.replaceChildren(pgSpark(s.v, { w: 140, h: 26, min: Math.min(...n), max: Math.max(...n), label: r.d.name })); r.lo.textContent = f(Math.min(...n)); r.hi.textContent = f(Math.max(...n)); }
  });
  return el('div', { class: 'pg-table-wrap' }, table);
}
/* A room's (or group's) facts in one line: temperature, humidity, lights on, power. */
function roomFacts(ds) {
  const temps = ds.filter((d) => Number.isFinite(d.tempC) && d.kind !== 'climate'), temp = (temps.length ? temps : ds.filter((d) => Number.isFinite(d.tempC)))[0]?.tempC;
  const hum = ds.find((d) => d.kind === 'sensor' && Number.isFinite(d.humidity))?.humidity, lights = ds.filter((d) => d.kind === 'light'), on = lights.filter((d) => d.on).length;
  const watts = ds.reduce((s, d) => s + (typeof d.powerW === 'number' && !d.pairedTo && d.kind !== 'sensor' ? d.powerW : 0), 0);
  return el('div', { class: 'ctl-facts' }, [temp != null ? el('span', { class: 'ctl-fact big' }, icon('thermo', 15), tempOf(temp)) : null, hum != null ? el('span', { class: 'ctl-fact' }, icon('drop', 14), `${Math.round(hum)}%`) : null,
    lights.length ? el('span', { class: `ctl-fact${on ? ' lit' : ''}` }, icon('bulb', 14), T('{n} of {total} on', { n: on, total: lights.length })) : null, watts >= 1 ? el('span', { class: 'ctl-fact' }, icon('bolt', 14), `${Math.round(watts)} W`) : null].filter(Boolean));
}
/* "Lights off" for a room or the whole house: switches off only lights that are on. */
const lightsOffBtn = (ds, ctx) => { const on = ds.filter((d) => d.kind === 'light' && d.on && d.online !== false); return on.length ? el('button', { class: 'btn small', onclick: async (e) => { e.currentTarget.disabled = true; for (const d of on) await toggleDevice(d).catch(() => {}); toast(T('Lights off')); setTimeout(() => ctx.refresh?.(), 900); } }, icon('bulb', 14), T('Lights off ({n})', { n: on.length })) : null; };

pageTile({ id: 'ctl-room', page: 'controls', auto: true, multi: true, askFirst: true, title: 'Room', icon: 'home', blurb: 'One room: its switches, temperature and sensors (Home Assistant areas)', size: [6, 1],
  options: (t, ctx) => [{ key: 'area', type: 'select', label: 'Which room', choices: [...[...new Set((ctx.data.devices || []).map((d) => d.area).filter(Boolean))].sort().map((a) => [a, a]), ['-', 'Not in a room']] }],
  render(b, ctx, size) {
    const area = optsOf(b._t || {}).area, ds = ctlDevs(ctx).filter((d) => (area === '-' ? !d.area && !['action', 'presence'].includes(d.kind) : d.area === area));   // scenes and people have their own tiles
    tileHeader(b, area === '-' ? T('Not in a room') : area || T('Room'));
    if (!area) return pgPut(b, el('p', { class: 'muted small' }, T('Pick a room: tap the sliders while editing.')));
    if (!ds.length) return pgPut(b, el('p', { class: 'muted small' }, ctx.query ? T('Nothing matches that search.') : T('Nothing in this room right now.')));
    const switches = ds.filter((d) => !isReading(d) && d.kind !== 'presence'), readings = ds.filter(isReading);
    pgPut(b, el('div', { class: 'row between wrap', style: 'gap:8px' }, roomFacts(ds), lightsOffBtn(ds, ctx)),
      size.tier !== 's' && switches.length ? ctlButtons(switches, size) : null,
      size.tier === 's' && switches.length ? el('div', { class: 'tiny muted' }, T('{n} things to switch - make the tile bigger to see them', { n: switches.length })) : null,
      size.tier === 'l' && readings.length ? el('div', { class: 'ctl-sub' }, el('div', { class: 'tiny muted ctl-sub-h' }, T('Sensors')), ctlButtons(readings, size, { limit: 12 })) : null,
      size.tier === 'xl' && readings.length ? el('div', { class: 'ctl-sub' }, el('div', { class: 'tiny muted ctl-sub-h' }, T('Sensors')), sensorTable(readings)) : null);
  } });
pageTile({ id: 'ctl-group', page: 'controls', auto: true, multi: true, askFirst: true, title: 'Devices', icon: 'sliders', blurb: 'One kind of device: lights, plugs, climate, sensors...', size: [6, 1],
  options: [{ key: 'group', type: 'select', label: 'Which devices', choices: Object.entries(CTL_GROUPS).map(([k, [l]]) => [k, l]), default: 'lights' }],
  render(b, ctx, size) {
    const key = optsOf(b._t || {}).group || 'lights', [name, f] = CTL_GROUPS[key] || CTL_GROUPS.lights;
    const ds = ctlDevs(ctx).filter(f);
    tileHeader(b, `${T(name)} (${ds.length})`);
    if (!ds.length) return pgPut(b, el('p', { class: 'muted small' }, ctx.query ? T('Nothing matches that search.') : T('None of these yet.')));
    const on = ds.filter((d) => d.on || d.playing || d.open).length;
    const reading = key === 'sensors' || key === 'other';
    pgPut(b, size.tier === 's' && !reading && ['lights', 'plugs', 'fans', 'media', 'covers'].includes(key) ? el('div', { class: 'tiny muted', style: 'margin-bottom:8px' }, T('{n} of {total} on', { n: on, total: ds.length })) : null,
      key === 'lights' && size.tier !== 's' ? el('div', { style: 'margin-bottom:10px' }, lightsOffBtn(ds, ctx)) : null,
      reading && size.tier === 'xl' ? sensorTable(ds) : ctlButtons(ds, size, { limit: key === 'other' && !ctx.query && size.tier !== 'xl' ? 12 : undefined }));
  } });
pageTile({ id: 'ctl-fav', page: 'controls', auto: true, multi: true, askFirst: true, title: 'Favorites', icon: 'spark', blurb: 'The devices you use most, in one place - pick any', size: [6, 1],
  options: [{ key: 'ids', type: 'devices', label: 'Devices', filter: (d) => d.kind !== 'camera' }],
  render(b, ctx, size) {
    const ids = optsOf(b._t || {}).ids || [], all = ctlDevs(ctx), ds = ids.map((id) => all.find((d) => d.id === id)).filter(Boolean);
    if (!ids.length) return pgPut(b, el('p', { class: 'muted small' }, T('Pick your favorite devices: tap the sliders while editing.')));
    pgPut(b, ds.length ? ctlButtons(ds, size) : el('p', { class: 'muted small' }, T('Nothing matches that search.')));
  } });
pageTile({ id: 'ctl-climate', page: 'controls', auto: true, title: 'Climate', icon: 'thermo', blurb: 'Every thermostat: the temperature now, and up or down', size: [12, 1], render(b, ctx, size) {
  const ds = ctlDevs(ctx).filter((d) => d.kind === 'climate');
  if (!ds.length) return pgPut(b, el('p', { class: 'muted small' }, T('No thermostats yet.')));
  const card = (d) => el('div', { class: `ctl-thermo mode-${d.mode || 'off'}` },
    el('div', { class: 'row between', style: 'gap:8px' }, el('b', { class: 'ellipsis' }, d.name), el('span', { class: 'tiny muted' }, T(DEV_MODES[d.mode] || pretty(d.mode || '')))),
    el('div', { class: 'thermo-now' }, tempOf(d.tempC)), d.humidity != null && size.tier !== 's' ? el('div', { class: 'tiny muted' }, T('Humidity {n}%', { n: Math.round(d.humidity) })) : null,
    size.tier !== 's' ? el('div', { class: 'row dev-ctl' }, devControls(d, size.tier, () => ctx.refresh?.())) : null,
    size.tier === 'xl' ? el('div', { class: 'dev-hist', 'data-id': d.id }) : null);
  const box = el('div', { class: 'ctl-thermos' }, ds.map(card));
  pgPut(b, box);
  if (size.tier === 'xl') devHistory(ds.map((d) => d.id)).then((sr) => { for (const d of ds) { const s = sr[d.id]; if (s) box.querySelector(`.dev-hist[data-id="${CSS.escape(d.id)}"]`)?.replaceChildren(pgLine(s.v, { end: s.end, step: s.step, fmt: histFmt(s.field, d), label: d.name, h: 80 })); } });
} });
pageTile({ id: 'ctl-summary', page: 'controls', auto: true, title: 'At a glance', icon: 'home', blurb: 'Lights on, plugs on, doors open, who is home', size: [12, 1], render(b, ctx, size) {
  const ds = ctx.data.devices || [], c = (f) => ds.filter(f).length;
  const chip = (ic, text, n, total, cls = '') => (total ? el('div', { class: `ctl-chip ${cls}` }, icon(ic, 18), el('div', {}, el('b', {}, n), el('span', { class: 'muted' }, ` / ${total}`), el('div', { class: 'tiny muted' }, T(text)))) : null);
  const temps = ds.filter((d) => d.kind === 'climate' && d.domain !== 'water_heater' && !/water heater/i.test(d.name) && Number.isFinite(d.tempC ?? d.current));
  const chips = [chip('bulb', 'lights on', c((d) => d.kind === 'light' && d.on), c((d) => d.kind === 'light')),
    chip('plug', 'plugs on', c((d) => (d.kind === 'plug' || d.kind === 'switch') && d.on), c((d) => d.kind === 'plug' || d.kind === 'switch')),
    chip('door', 'open', c((d) => d.kind === 'cover' && d.open), c((d) => d.kind === 'cover'), c((d) => d.kind === 'cover' && d.open) ? 'warn' : ''),
    chip('lock', 'locked', c((d) => d.kind === 'lock' && d.locked), c((d) => d.kind === 'lock'), c((d) => d.kind === 'lock' && d.locked === false) ? 'warn' : ''),
    chip('user', 'home', c((d) => d.kind === 'presence' && d.home), c((d) => d.kind === 'presence')),
    temps.length ? el('div', { class: 'ctl-chip' }, icon('thermo', 18), el('div', {}, el('b', {}, temps.map((d) => tempOf(d.tempC ?? d.current)).slice(0, 3).join(' · ')), el('div', { class: 'tiny muted' }, T('inside')))) : null].filter(Boolean);
  pgPut(b, el('div', { class: 'ctl-chips' }, size.tier === 's' ? chips.slice(0, 2) : chips),
    atLeast(size, 'l') ? el('div', { class: 'row wrap', style: 'gap:8px;margin-top:12px' }, lightsOffBtn(ds, ctx), ...ds.filter((d) => d.kind === 'action').slice(0, size.tier === 'xl' ? 6 : 3).map((d) => el('button', { class: 'btn small', onclick: () => devAct(d, 'run', T('done')) }, icon('play', 14), d.name))) : null);
} });
pageTile({ id: 'ctl-start', page: 'controls', auto: true, title: 'Get started', icon: 'plug', blurb: 'Connect your first devices', size: [12, 1], render(b) {
  pgPut(b, pgEmpty(T('No devices yet. Connect Hue, Shelly, YoLink or Home Assistant in setup.'), '#connect', T('Set this up')));
} });
async function controlsPage(main) {
  let errors = [];
  const load = async () => { const r = await api('/api/devices'); errors = r.errors || []; return { devices: r.devices || [] }; };
  const search = el('input', { type: 'search', placeholder: T('Search everything - lights, sensors, Home Assistant entities…'), style: 'max-width:520px' }), count = el('span', { class: 'small muted' });
  let qt = null;
  search.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { const ctx = pageCtx(main); if (!ctx) return; ctx.query = search.value.trim(); ctx.rebuild(); counted(); }, 120); };
  const counted = () => { const ctx = pageCtx(main), all = (ctx?.data.devices || []).filter((d) => d.kind !== 'camera'); count.textContent = T('{n} of {total}', { n: all.filter(ctlMatch(ctx || {})).length, total: all.length }); };
  const renameBtn = el('button', { class: 'btn' }, icon('edit'), el('span', { class: 'hide-phone' }, T('Rename devices')));
  const hint = el('span', { class: 'tiny muted hide-phone' }, T('Tap to switch · press and hold for details'));
  const refresh = await pageGrid(main, { page: 'controls', auto: true, title: tabLabel({ id: 'controls', label: T('Controls') }), load, actions: [renameBtn], before: [el('div', { class: 'row wrap', style: 'margin-bottom:12px;gap:10px' }, search, count, hint)] });
  const ctx = pageCtx(main);
  if (ctx?.data.devices.some((d) => d.provider === 'ha')) $('#subtitle').textContent = T('Includes everything from Home Assistant');
  renameBtn.onclick = () => renameDevices(ctx?.data.devices || [], refresh);
  counted();
  if (errors.length) main.append(...errors.map((e) => el('p', { class: 'small muted' }, `${e.provider}: ${e.error}`)));
  return async () => { if (document.activeElement === search) return; await refresh?.(); counted(); };
}

/* ---- Cameras ----
   Each physical camera once, however many ways it arrives (Frigate, Home Assistant, Meraki, Ring...): the server keeps
   the best (30-devices.js camDedupe) and lists the others under "Detected cameras", where any can be added back.
   Every picture is camView (10-widgets.js): sharp stills on their own beat, live video through camPlay where the camera
   has it - never a pile of MJPEG connections. */
const camCanEdit = () => !S.status?.demo && (!S.me?.user?.role || ['owner', 'admin'].includes(S.me.user.role));
async function camVisible(ctx, id, visible) {
  try { await api(`/api/cameras/${encodeURIComponent(id)}/visible`, { method: 'PUT', body: JSON.stringify({ visible }) }); toast(visible ? T('Camera added back') : T('Camera removed - find it under Detected cameras')); await ctx.refresh?.(); }
  catch (e) { toast(e.message); }
}
const camRemoveBtn = (ctx, d) => el('button', { class: 'cam-x', title: T('Remove this camera'), 'aria-label': T('Remove {name}', { name: d.name }), onclick: (e) => { e.stopPropagation(); camVisible(ctx, d.id, false); } }, icon('x', 14));
/* The wall: as many across as the tile's size suits (Small one, Medium two, Large three, Extra large four). */
const camCols = (n, size) => Math.max(1, Math.min(n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, { s: 1, m: 2, l: 3, xl: 4 }[size.tier || 'xl']));
pageTile({ id: 'cam-wall', page: 'cameras', auto: true, title: 'Cameras', icon: 'camera', blurb: 'Every camera, live - or just the ones you pick', size: [12, 1],
  options: [{ key: 'only', type: 'devices', label: 'Which cameras', filter: (d) => d.kind === 'camera', help: 'None picked: every camera.' }],
  render(b, ctx, size) {
    const pick = optsOf(b._t || {}).only, all = (ctx.data.devices || []).filter((d) => d.kind === 'camera'), cams = Array.isArray(pick) && pick.length ? all.filter((d) => pick.includes(d.id)) : all;
    const key = `${cams.map((d) => d.id).join('|')}#${size.tier}`;
    if (b._key === key && b.firstChild) return;   // each picture keeps itself fresh: the wall is only rebuilt when cameras come or go
    b._key = key;
    if (!cams.length) return pgPut(b, pgEmpty(all.length ? T('None of the cameras picked for this tile are here.') : T('All your cameras are hidden.'), null, null));
    pgPut(b, el('div', { class: 'cams', style: `--cam-cols:${camCols(cams.length, size)}` }, cams.map((d) => { const t = camView(d); if (camCanEdit() && !t.querySelector('.cam-x')) t.append(camRemoveBtn(ctx, d)); return t; })));
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
  if (b.firstChild && !b.querySelector('.pg-skel')) return; pgPut(b, detectionsCard());   // keeps itself up to date
} });
/* Detected cameras: the ones removed, and the same camera reached another way - add any back. Shared with Security. */
function hiddenCamList(ctx) {
  const hidden = ctx.data.hiddenCameras || [];
  if (!hidden.length) return el('p', { class: 'muted small' }, T('Every camera is shown.'));
  return el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('Removed ones, and the same camera reached a second way (Frigate, Home Assistant, Meraki, Ring...) - CasaTorch shows each camera once, the fastest way. Add any back if you want both.')),
    el('div', { class: 'list' }, hidden.map((h) => el('div', { class: 'row between', style: 'padding:6px 0;gap:10px' }, el('div', { style: 'min-width:0' }, el('b', {}, h.name), el('div', { class: 'tiny muted' }, `${srcName(h.source)} · ${h.why === 'duplicate' ? T('same camera as "{name}"', { name: h.of }) : T('removed')}`)),
      camCanEdit() ? el('button', { class: 'btn small', onclick: () => camVisible(ctx, h.id, true) }, icon('plus', 14), T('Add back')) : null))));
}
pageTile({ id: 'cam-hidden', page: 'cameras', auto: true, title: 'Detected cameras', icon: 'camera', blurb: 'Cameras you removed, and the same camera seen twice', size: [12, 1], render(b, ctx) { pgPut(b, hiddenCamList(ctx)); } });
pageTile({ id: 'cam-start', page: 'cameras', auto: true, title: 'Add cameras', icon: 'camera', blurb: 'Connect your first camera', size: [12, 1], render(b) {
  pgPut(b, pgEmpty(T('No cameras yet. Add Frigate, Reolink, any camera with a snapshot address, Ring (Pro) or cameras in Home Assistant from Connect.'), '#connect', T('Set this up')));
} });
async function camerasPage(main) {
  S.me ||= await api('/api/auth/me').catch(() => ({}));
  const load = async () => { const r = await api('/api/devices'); return { devices: r.devices || [], hiddenCameras: r.hiddenCameras || [] }; };
  return pageGrid(main, { page: 'cameras', auto: true, title: tabLabel({ id: 'cameras', label: T('Cameras') }), load });
}
