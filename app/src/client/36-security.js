/* ======================================================================
 * Security Center (src/server/45-security.js): the video wall, doors and
 * locks, the alarm and safety sensors, devices on the home network with the
 * open-port check, a security checklist, and recent security events.
 * Included in Basic. Network monitoring (Pi-hole, UniFi, Meraki) stays on
 * the Network tab.
 * A page grid like every page (06-pagegrid.js): each part is a tile you can move, resize, remove and add back,
 * and each shows more as it grows. The video wall uses camView/camPlay (10-widgets.js, 10c-camplayer.js) - live
 * video where the camera has it, sharp pictures otherwise, never a pile of MJPEG connections - and shows each
 * camera once, with "Detected cameras" to add back the same camera reached another way.
 * ====================================================================== */
const SEC = { wallEdit: false };
const sevDot = { critical: 'bad', warning: 'warn', notice: 'warn', info: '', ok: 'good' };
async function secAct(d, action, value) {
  try { await post(`/api/devices/${encodeURIComponent(d.id)}/${action}`, value != null ? { value } : {}); } catch (e) { toast(e.message, 4000); }
}

/* ---- the video wall ---- */
function wallBody(b, ctx, size) {
  const cams = (ctx.data.devices || []).filter((d) => d.kind === 'camera'), redraw = () => { b._key = null; ctx.refresh?.().then(() => ctx.rebuild?.()); };
  const w = { cols: 0, order: [], hidden: [], live: false, ...(ctx.data.sec?.wall || {}) };
  const save = async () => { try { await post('/api/security/wall', w, 'PUT'); ctx.data.sec.wall = { ...w }; } catch (e) { toast(e.message); } };
  const ordered = [...cams].sort((a, c) => { const ia = w.order.indexOf(a.id), ic = w.order.indexOf(c.id); return (ia < 0 ? 1e9 : ia) - (ic < 0 ? 1e9 : ic) || a.name.localeCompare(c.name); });
  const shown = ordered.filter((d) => !w.hidden.includes(d.id));
  const key = JSON.stringify([shown.map((d) => d.id), w.cols, w.live, SEC.wallEdit, size.tier, (ctx.data.hiddenCameras || []).length]);
  if (b._key === key && b.firstChild && !b.querySelector('.pg-skel')) return;   // the wall keeps playing while the rest refreshes
  b._key = key;
  if (!cams.length) return pgPut(b, pgEmpty(T('No cameras yet. Add Frigate, Reolink, any camera with a picture address, Ring (Pro) or cameras in Home Assistant from Connect.'), '#connect', T('Set this up')));
  const auto = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : shown.length <= 9 ? 3 : 4;
  const cols = Math.min(w.cols || auto, { s: 1, m: 2, l: 3, xl: 4 }[size.tier || 'xl']);
  const grid = el('div', { class: 'wall', style: `--cols:${cols}` }, shown.map((d) => camView(d, { live: w.live })));
  const pick = el('div', { class: 'seg seg-mini' }, ...[[0, T('Auto')], [1, '1'], [2, '2×2'], [3, '3×3'], [4, '4×4']].map(([v, l]) => el('button', { class: w.cols === v ? 'on' : null, onclick: () => { w.cols = v; save().then(redraw); } }, l)));
  const full = el('button', { class: 'btn small', title: T('Full screen'), onclick: () => { const box = b.querySelector('.wall'); (box?.requestFullscreen || box?.webkitRequestFullscreen)?.call(box); } }, icon('expand', 14), el('span', { class: 'hide-phone' }, T('Full screen')));
  const liveBtn = cams.some((d) => d.stream) ? el('button', { class: `btn small${w.live ? ' primary' : ''}`, title: T('More cameras play live video at once, where the camera has it'), onclick: () => { w.live = !w.live; save().then(redraw); } }, w.live ? T('Live video: on') : T('Live video: off')) : null;
  const editBtn = el('button', { class: `btn small${SEC.wallEdit ? ' primary' : ''}`, onclick: () => { SEC.wallEdit = !SEC.wallEdit; b._key = null; wallBody(b, ctx, size); } }, icon(SEC.wallEdit ? 'check' : 'edit', 14), SEC.wallEdit ? T('Done') : T('Arrange'));
  const tools = el('div', { class: 'row wrap wall-tools', style: 'gap:6px;margin-bottom:10px' }, atLeast(size, 'm') ? pick : null, liveBtn, editBtn, full);
  if (SEC.wallEdit) {
    const list = el('div', { class: 'wall-edit' }, ...ordered.map((d, i) => el('div', { class: 'row', style: 'gap:8px;padding:6px 0;border-top:1px solid var(--line)' },
      el('input', { type: 'checkbox', checked: !w.hidden.includes(d.id), style: 'width:auto', 'aria-label': T('Show {name}', { name: d.name }), onchange: (e) => { w.hidden = e.target.checked ? w.hidden.filter((x) => x !== d.id) : [...w.hidden, d.id]; save(); } }),
      el('span', { class: 'grow' }, d.name, srcName(d.source || d.provider) ? el('span', { class: 'tiny muted' }, ` · ${srcName(d.source || d.provider)}`) : null),
      el('button', { class: 'btn small ghost', 'aria-label': T('Move up'), disabled: i === 0 ? true : null, onclick: () => { const o = ordered.map((x) => x.id); [o[i - 1], o[i]] = [o[i], o[i - 1]]; w.order = o; save().then(() => { b._key = null; wallBody(b, ctx, size); }); } }, '↑'),
      el('button', { class: 'btn small ghost', 'aria-label': T('Move down'), disabled: i === ordered.length - 1 ? true : null, onclick: () => { const o = ordered.map((x) => x.id); [o[i + 1], o[i]] = [o[i], o[i + 1]]; w.order = o; save().then(() => { b._key = null; wallBody(b, ctx, size); }); } }, '↓'))));
    return pgPut(b, tools, el('p', { class: 'small muted', style: 'margin-top:0' }, T('Pick which cameras are on the wall and their order. Every screen in the home uses this wall.')), list,
      (ctx.data.hiddenCameras || []).length ? el('div', { style: 'margin-top:14px' }, el('div', { class: 'tiny muted ctl-sub-h' }, T('Detected cameras')), hiddenCamList(ctx)) : null);
  }
  pgPut(b, tools, shown.length ? grid : el('p', { class: 'muted' }, T('Every camera is hidden - press Arrange to show some.')));
}

/* ---- doors, locks, the alarm and safety sensors ---- */
function doorsCard(devs, redraw, size = { tier: 'l' }) {
  const locks = devs.filter((d) => d.kind === 'lock'), doors = devs.filter((d) => d.open != null && d.kind !== 'cover' && d.kind !== 'lock'), garages = devs.filter((d) => d.kind === 'cover' && d.risky);
  const unlocked = locks.filter((d) => d.locked === false), open = [...doors, ...garages].filter((d) => d.open);
  const row = (d, state, bad, extra) => el('div', { class: `secrow${bad ? ' bad' : ''}` }, el('span', { class: 'ic' }, icon(devIconName(d), 16)), el('span', { class: 'grow ellipsis' }, d.name), el('span', { class: `pill${bad ? ' warn' : ' good'}` }, state), extra || null);
  const card = el('div', { class: 'sec-body' }, el('div', { class: 'row', style: 'justify-content:flex-end' },
    unlocked.length ? el('button', { class: 'btn small primary', onclick: async (e) => { e.target.disabled = true; try { const r = await post('/api/security/lock-all', {}); toast(r.failed?.length ? T('Locked {locked}; couldn\'t lock {join}', { locked: r.locked, join: r.failed.join(', ') }) : T('Locked {locked}', { locked: r.locked })); } catch (err) { toast(err.message); } setTimeout(redraw, 1500); } }, T('Lock all ({n})', { n: unlocked.length })) : null));
  if (!locks.length && !doors.length && !garages.length) { card.append(pgEmpty(T('No locks or door sensors yet. They come in from Home Assistant, YoLink, Shelly and others - see Connect.'))); return card; }
  card.append(el('div', { class: `sec-sum ${unlocked.length || open.length ? 'warn' : 'ok'}` }, icon(unlocked.length || open.length ? 'lock' : 'shield', 18), [unlocked.length ? T('{n} unlocked', { n: unlocked.length }) : locks.length ? T('All locked') : '', open.length ? T('{n} open', { n: open.length }) : doors.length + garages.length ? T('All closed') : ''].filter(Boolean).join(' · ')));
  if (size.tier === 's') return card;
  card.append(
    ...locks.map((d) => row(d, d.locked ? T('Locked') : d.locked === false ? T('Unlocked') : T('Unknown'), d.locked === false, d.locked === false ? el('button', { class: 'btn small', onclick: async () => { await secAct(d, 'lock'); setTimeout(redraw, 1200); } }, T('Lock')) : null)),
    ...garages.map((d) => row(d, d.open ? T('Open|state') : T('Closed'), d.open, d.open ? el('button', { class: 'btn small', onclick: async () => { await secAct(d, 'close'); setTimeout(redraw, 1500); } }, T('Close')) : null)),
    ...doors.map((d) => row(d, d.open ? T('Open|state') : T('Closed'), d.open)),
    el('p', { class: 'tiny faint', style: 'margin:10px 0 0' }, T('CasaTorch can lock and close, never unlock or open.')));
  return card;
}
function alarmCard(devs, redraw, size = { tier: 'l' }) {
  const alarms = devs.filter((d) => d.kind === 'alarm'), safety = devs.filter((d) => d.smoke != null || d.water != null);
  const cams = devs.filter((d) => d.kind === 'camera'), off = cams.filter((d) => d.online === false);
  const card = el('div', { class: 'sec-body' });
  if (size.tier === 's') { const bad = safety.filter((d) => d.smoke || d.water).length + off.length; card.append(el('div', { class: `sec-sum ${bad ? 'warn' : 'ok'}` }, icon('shield', 18), alarms.length ? `${alarms[0].name}: ${devMeta(alarms[0])}` : bad ? T('{n} things to look at', { n: bad }) : T('All clear'))); return card; }
  for (const a of alarms) { const box = el('div', { class: 'secalarm' }); box.append(el('b', {}, a.name), ...window.CasaControls.build(a, { units: S.units, act: (x, v) => { secAct(a, x, v); setTimeout(redraw, 1500); } })); card.append(box); }
  const bad = safety.filter((d) => d.smoke || d.water), low = safety.filter((d) => d.battery != null && d.battery <= 20);
  if (safety.length) card.append(el('div', { class: `secrow${bad.length ? ' bad' : ''}` }, el('span', { class: 'ic' }, icon('fire', 16)), el('span', { class: 'grow' }, T('{n} smoke and leak sensors', { n: safety.length })), el('span', { class: `pill ${bad.length ? 'warn' : 'good'}` }, bad.length ? T(bad.length > 1 ? '{n} alarms' : '{n} alarm', { n: bad.length }) : T('All clear'))),
    ...bad.map((d) => el('div', { class: 'small', style: 'color:var(--bad);margin:2px 0 0 34px' }, `${d.name}: ${d.smoke ? T('smoke') : T('water')}`)),
    ...low.map((d) => el('div', { class: 'small muted', style: 'margin:2px 0 0 34px' }, `${d.name}: ${T('battery {n}%', { n: Math.round(d.battery) })}`)));
  if (cams.length) card.append(el('div', { class: `secrow${off.length ? ' bad' : ''}` }, el('span', { class: 'ic' }, icon('camera', 16)), el('span', { class: 'grow' }, T('{n} cameras', { n: cams.length })), el('span', { class: `pill ${off.length ? 'warn' : 'good'}` }, off.length ? T('{n} not answering', { n: off.length }) : T('All online'))));
  if (!alarms.length && !safety.length && !cams.length) card.append(pgEmpty(T('No alarm, smoke or leak sensors yet. They come in from Home Assistant, YoLink, Shelly and others.')));
  else if (!alarms.length) card.append(el('p', { class: 'tiny faint', style: 'margin:10px 0 0' }, T('An alarm system in Home Assistant shows up here too. CasaTorch can arm it, never disarm it.')));
  return card;
}

/* ---- devices on the home network, and the open-port check ---- */
/* The name to show: what the person called it, what the network calls it, else its maker. */
function lanName(d) {
  const w = d.who || {};
  if (d.name || d.announced) return d.name || d.announced;
  if (d.privateMac) return T('Phone, tablet or computer with a private Wi-Fi address');
  return w.maker ? T('{maker} device', { maker: w.maker.name }) : T('Unknown device');
}
/* "Who is it?": maker, likely kind, names, when it was first seen, what each open port is for - and one tap to say what it is. */
function whoIsItModal(d, s, redraw) {
  const w = d.who || {}, dl = el('dl', { class: 'kv small' }), add = (k, ...v) => dl.append(el('dt', {}, T(k)), el('dd', {}, ...v));
  const save = async (body, msg) => { try { await post(`/api/security/devices/${encodeURIComponent(d.mac)}`, body); if (msg) toast(msg); m.remove(); redraw(); } catch (e) { toast(e.message); } };
  if (w.maker) add('Maker', el('div', {}, w.maker.name), el('div', { class: 'tiny muted' }, T('From the first half of its network address (IEEE list: {ieee}).', { ieee: w.maker.ieee })), w.maker.note ? el('div', { class: 'tiny muted' }, T(w.maker.note)) : null);
  else add('Maker', el('div', {}, d.privateMac ? T('Hidden') : T('Not known')), el('div', { class: 'tiny muted' }, d.privateMac ? T('It uses a private Wi-Fi address: phones, tablets and computers make one up to protect their owner\'s privacy, so the maker can\'t be read from it.') : T('Its network address isn\'t on the public list of makers.')));
  if (w.type && (w.sure || !w.maker || w.maker.kinds.length < 2)) add(w.userType ? 'Kind' : 'Likely', el('div', {}, T(w.typeLabel)), w.why && !w.userType ? el('div', { class: 'tiny muted' }, T(w.why)) : null);
  else if (w.maker?.kinds?.length) add('Could be', el('div', {}, w.maker.kinds.map((k) => T(k)).join(' · ')));
  if (w.names?.length) add('Names it goes by', ...w.names.map((n) => el('div', {}, el('b', {}, n.name), el('span', { class: 'tiny muted' }, ` · ${T(n.from)}${n.extra ? ` (${n.extra})` : ''}`))));
  add('First seen', `${fmtWhen(d.firstSeen)} (${ago(d.firstSeen)})`);
  if (d.lastSeen) add('Last seen', ago(d.lastSeen));
  add('Network address', `${d.ip} · ${d.mac}`);
  if (d.ports.length) add('Open services', ...d.ports.map((p) => el('div', { class: 'portline' }, el('b', {}, T(p.name)), el('span', { class: 'tiny muted' }, ` (${T('port {port}', { port: p.port })})`), el('span', { class: `pill${p.level === 'warning' && !p.expected ? ' warn' : p.level === 'info' || p.expected ? ' good' : ''}`, style: 'margin-left:6px' }, p.expected ? T('You use this') : p.level === 'info' ? T('Normal here') : p.level === 'warning' ? T('Fix this') : T('Check this')),
    p.use ? el('div', { class: 'tiny muted' }, T(p.use)) : null)));
  else add('Open services', el('span', { class: 'muted' }, T('None of the risky ones CasaTorch checks for.')));
  const typeName = w.typeShort ? T(w.typeShort) : null;
  const pick = el('select', { 'aria-label': T('What kind of device is it?'), onchange: (e) => { if (e.target.value) save({ known: true, type: e.target.value === 'auto' ? null : e.target.value }, T('Saved')); } },
    el('option', { value: '' }, T('Something else…')), ...(s.types || []).filter((t) => t.id !== w.type || !w.userType).map((t) => el('option', { value: t.id }, T(t.label))), w.userType ? el('option', { value: 'auto' }, T('Let CasaTorch guess')) : null);
  const acts = el('div', { class: 'acts' },
    w.type && !w.userType ? el('button', { class: 'btn primary', onclick: () => save({ known: true, type: w.type, ...(!d.name && !d.announced ? { name: `${w.maker?.short ? `${w.maker.short} ` : ''}${typeName}` } : {}) }, T('Saved')) }, T('This is my {type}', { type: typeName })) : null,
    el('button', { class: 'btn ghost', onclick: async () => { const n = prompt(T('Name this device'), d.name || ''); if (n == null) return; save({ known: true, name: n }); } }, icon('edit', 14), T('Name it')),
    pick);
  const m = modal(el('div', { class: 'whois' }, dl, acts, el('p', { class: 'tiny faint', style: 'margin:12px 0 0' }, T('Worked out on this CasaTorch from what the device shows on your home network. Nothing is sent anywhere.'))), { title: lanName(d) });
}
function lanCard(s, redraw, size = { tier: 'xl' }) {
  const card = el('div', { class: 'sec-body' });
  const head = el('div', { class: 'row between wrap', style: 'gap:8px;margin-bottom:8px' }, el('span'),
    el('div', { class: 'row', style: 'gap:6px' }, el('span', { class: 'tiny muted' }, s.scanning ? T('Checking now…') : s.scanAt ? T('Looked {ago}', { ago: ago(s.scanAt) }) : ''), el('button', { class: 'btn small', onclick: async () => { try { await post('/api/security/scan', {}); toast(T('Checking your network - about a minute')); setTimeout(redraw, 60_000); } catch (e) { toast(e.message); } } }, T('Check now'))));
  card.append(head);
  if (!s.watch) { card.append(el('p', { class: 'muted' }, T('Watching for new devices is turned off.')), el('button', { class: 'btn small', onclick: async () => { await post('/api/security/settings', { watch: true }, 'PUT').catch((e) => toast(e.message)); redraw(); } }, T('Turn on'))); return card; }
  if (s.available === false) { card.append(el('p', { class: 'muted' }, T('CasaTorch can\'t see your home network from where it\'s running (for example inside Docker without host networking). Run it with host networking to use this.'))); return card; }
  if (!s.devices.length) { card.append(el('p', { class: 'muted' }, s.scanAt ? T('No devices found yet.') : T('The first look at your network happens a minute after CasaTorch starts. The devices it finds then are taken as yours; anything that joins later shows up here as new.'))); return card; }
  const fresh = s.devices.filter((d) => !d.known), risky = s.devices.filter((d) => d.ports.some((p) => !p.expected && p.level !== 'info'));
  card.append(el('p', { class: 'small muted', style: 'margin-top:0' }, `${T('{n} devices', { n: s.devices.length })}${fresh.length ? ` · ${T('{n} new', { n: fresh.length })}` : ''}${risky.length ? ` · ${T('{n} with something to look at', { n: risky.length })}` : ''}. ${T('Ports checked {when}.', { when: s.portsAt ? ago(s.portsAt) : T('soon') })}`));
  if (size.tier === 's') return card;
  const list = el('div', { class: 'lanlist' });
  for (const d of (size.tier === 'm' ? s.devices.filter((x) => !x.known || x.ports.some((p) => !p.expected && p.level === 'warning')) : s.devices).slice(0, size.tier === 'l' ? 40 : 120)) {
    const w = d.who || {}, name = lanName(d), fromName = !!(d.name || d.announced);
    const sub = [fromName && w.maker ? w.maker.name : null, w.sure && w.typeLabel ? T(w.typeLabel) : null, d.ip, T('first seen {ago}', { ago: ago(d.firstSeen) })].filter(Boolean).join(' · ');
    const bad = d.ports.some((p) => !p.expected && p.level === 'warning');
    const row = el('div', { class: `landev${d.known ? '' : ' new'}` },
      el('div', { class: 'row wrap', style: 'gap:8px 10px;align-items:center' }, el('span', { class: `dot ${d.known ? (bad ? 'warn' : 'good') : 'warn'}` }),
        el('div', { class: 'grow', style: 'min-width:0;flex:1 1 200px' }, el('div', { style: 'overflow-wrap:anywhere' }, el('b', {}, name), d.known ? null : el('span', { class: 'pill warn', style: 'margin-left:8px' }, T('New'))),
          el('div', { class: 'tiny muted', style: 'overflow-wrap:anywhere' }, sub)),
        el('div', { class: 'row', style: 'gap:6px;margin-left:auto' }, el('button', { class: 'btn small ghost', onclick: () => whoIsItModal(d, s, redraw) }, T('Who is it?')),
        !d.known ? el('button', { class: 'btn small primary', onclick: async () => { const n = prompt(T('What is it? (optional - e.g. "Sam\'s phone")'), ''); await post(`/api/security/devices/${encodeURIComponent(d.mac)}`, { known: true, ...(n ? { name: n } : {}) }).catch((e) => toast(e.message)); redraw(); } }, T('It\'s mine')) : null)),
      ...(size.tier === 'm' ? [] : d.ports).map((p) => el('div', { class: `portrow${p.expected ? ' ok' : ` ${p.level}`}` }, el('div', {}, el('b', {}, T(p.name)), el('span', { class: 'tiny muted' }, ` (${T('port {port}', { port: p.port })})`), p.expected ? el('span', { class: 'tiny muted' }, T(' · marked as expected')) : p.level === 'info' ? el('span', { class: 'tiny muted' }, T(' · normal for this device')) : null, el('div', { class: 'small muted' }, T(p.how))),
        p.level === 'info' && !p.expected ? null : el('button', { class: 'btn small ghost', onclick: async () => { await post('/api/security/expected', { mac: d.mac, port: p.port, expected: !p.expected }).catch((e) => toast(e.message)); redraw(); } }, p.expected ? T('Watch it again') : T('I use this')))));
    list.append(row);
  }
  card.append(list, el('p', { class: 'tiny faint', style: 'margin:10px 0 0' }, T('CasaTorch looks only at your home network, and only checks a short list of risky services. Nothing about these devices leaves this CasaTorch.')));
  return card;
}

/* ---- the checklist and recent events ---- */
function checklistCard(items, size = { tier: 'l' }) {
  const done = items.filter((i) => i.ok).length;
  return el('div', { class: 'sec-body' }, el('div', { class: 'row between', style: 'margin-bottom:8px' }, el('span', { class: 'small muted' }, T('Security checklist')), el('span', { class: 'pill' }, T('{n} of {total}', { n: done, total: items.length }))),
    el('div', { class: 'meterbar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.round((done / Math.max(1, items.length)) * 100)}%` })),
    ...items.sort((a, b) => Number(a.ok) - Number(b.ok)).slice(0, size.tier === 's' ? 0 : size.tier === 'm' ? 4 : 99).map((i) => el('div', { class: `checkrow${i.ok ? ' ok' : ''}` }, el('span', { class: 'ck' }, icon(i.ok ? 'check' : 'dotc', 15)),
      el('div', {}, el('div', {}, i.href && !i.ok ? el('a', { href: i.href }, T(i.title)) : T(i.title)), i.ok ? null : el('div', { class: 'small muted' }, alertTitle(i.how))))));
}
function eventsCard(events, size = { tier: 'l' }) {
  return el('div', { class: 'sec-body' },
    events.length ? el('div', {}, ...events.slice(0, { s: 3, m: 8, l: 15, xl: 25 }[size.tier || 'l']).map((e) => el('div', { class: 'evrow' }, el('span', { class: `dot ${sevDot[e.severity] || ''}` }), el('span', { class: 'grow' }, alertTitle(e)), el('span', { class: 'tiny muted', title: fmtWhen(e.at) }, ago(e.at)))))
      : pgEmpty(T('Nothing yet. Doorbell presses, motion, open doors, leaks, new devices and sign-in trouble show up here.'), null, null));
}

/* ---- the page ---- */
const secData = (ctx) => ctx.data.sec || { devices: [], checklist: [], events: [], wall: {} };
pageTile({ id: 'sec-wall', page: 'security', auto: true, title: 'Video wall', icon: 'camera', blurb: 'Every camera at once, live where it can be', size: [12, 1], render: (b, ctx, size) => wallBody(b, ctx, size) });
pageTile({ id: 'sec-doors', page: 'security', auto: true, title: 'Doors & locks', icon: 'lock', blurb: 'Locks, doors and the garage - and Lock all', size: [4, 1], render: (b, ctx, size) => pgPut(b, doorsCard(ctx.data.devices || [], () => ctx.refresh?.(), size)) });
pageTile({ id: 'sec-alarm', page: 'security', auto: true, title: 'Alarm & safety', icon: 'shield', blurb: 'The alarm, smoke and leak sensors, cameras online', size: [4, 1], render: (b, ctx, size) => pgPut(b, alarmCard(ctx.data.devices || [], () => ctx.refresh?.(), size)) });
pageTile({ id: 'sec-check', page: 'security', auto: true, title: 'Checklist', icon: 'checkc', blurb: 'What would make your home safer, step by step', size: [4, 1], render: (b, ctx, size) => pgPut(b, checklistCard(secData(ctx).checklist || [], size)) });
pageTile({ id: 'sec-events', page: 'security', auto: true, title: 'Recent security events', icon: 'clock', blurb: 'Doorbell, motion, doors, leaks, new devices, sign-in trouble', size: [6, 1], render: (b, ctx, size) => pgPut(b, eventsCard(secData(ctx).events || [], size)) });
pageTile({ id: 'sec-lan', page: 'security', auto: true, title: 'Devices on your network', icon: 'wifi', blurb: 'Who is on your home network, and risky open services', size: [12, 1], render: (b, ctx, size) => pgPut(b, lanCard(secData(ctx), () => ctx.refresh?.(), size)) });
pageTile({ id: 'sec-hidden', page: 'security', auto: true, title: 'Detected cameras', icon: 'camera', blurb: 'Cameras you removed, and the same camera seen twice', size: [6, 1], render: (b, ctx) => pgPut(b, hiddenCamList(ctx)) });
pageTile({ id: 'sec-start', page: 'security', auto: true, title: 'Add cameras', icon: 'camera', blurb: 'Connect your first camera', size: [12, 1], render: (b) => pgPut(b, pgEmpty(T('No cameras yet. Add Frigate, Reolink, any camera with a picture address, Ring (Pro) or cameras in Home Assistant from Connect.'), '#connect', T('Set this up'))) });
tab({ id: 'security', label: 'Security', icon: 'shield', after: 'cameras', async render(main) {
  SEC.wallEdit = false;
  S.me ||= await api('/api/auth/me').catch(() => ({}));
  const load = async () => { const [r, sec] = await Promise.all([api('/api/devices'), api('/api/security')]); return { devices: r.devices || [], hiddenCameras: r.hiddenCameras || [], sec }; };
  const sub = (ctx) => { const devices = ctx.data.devices, s = secData(ctx);
    const issues = devices.filter((d) => d.water || d.smoke || d.triggered).length + devices.filter((d) => d.kind === 'lock' && d.locked === false).length + s.devices.filter((d) => !d.known).length + s.devices.filter((d) => d.ports.some((p) => !p.expected && p.level === 'warning')).length;
    return issues ? T(issues === 1 ? '{n} thing to look at' : '{n} things to look at', { n: issues }) : T('All clear'); };
  const refresh = await pageGrid(main, { page: 'security', auto: true, title: tabLabel({ id: 'security', label: T('Security') }), load });
  const ctx = pageCtx(main); if (ctx) $('#subtitle').textContent = sub(ctx);
  return async () => { if (SEC.wallEdit) return; await refresh?.(); const c = pageCtx(main); if (c && main.isConnected) $('#subtitle').textContent = sub(c); };
} });
