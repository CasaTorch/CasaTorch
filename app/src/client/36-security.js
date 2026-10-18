/* ======================================================================
 * Security Center (src/server/45-security.js): the video wall, doors and
 * locks, the alarm and safety sensors, devices on the home network with the
 * open-port check, a security checklist, and recent security events.
 * Included in Basic. Network monitoring (Pi-hole, UniFi, Meraki) stays on
 * the Network tab.
 * ====================================================================== */
const SEC = { wallEdit: false, wallKey: null, wallCard: null };
const sevDot = { critical: 'bad', warning: 'warn', notice: 'warn', info: '', ok: 'good' };
async function secAct(d, action, value) {
  try { await post(`/api/devices/${encodeURIComponent(d.id)}/${action}`, value != null ? { value } : {}); } catch (e) { toast(e.message, 4000); }
}

/* ---- the video wall ---- */
function wallCard(cams, wall, redraw) {
  const w = { cols: 0, order: [], hidden: [], live: false, ...(wall || {}) };
  const save = async () => { try { await post('/api/security/wall', w, 'PUT'); } catch (e) { toast(e.message); } };
  const ordered = [...cams].sort((a, b) => { const ia = w.order.indexOf(a.id), ib = w.order.indexOf(b.id); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.name.localeCompare(b.name); });
  const shown = ordered.filter((d) => !w.hidden.includes(d.id));
  const cols = w.cols || (shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : shown.length <= 9 ? 3 : 4);
  const grid = el('div', { class: 'wall', style: `--cols:${cols}` });
  const tile = (d) => {
    if (w.live && d.stream) {
      const img = el('img', { alt: d.name, role: 'button', tabindex: 0, src: `${d.stream}${d.stream.includes('?') ? '&' : '?'}t=${Date.now()}`, onerror: () => img.replaceWith(camView(d)) });
      return el('div', { class: 'cam live', onclick: () => camModal(d) }, img, el('div', { class: 'cap' }, el('span', {}, d.name), el('span', { class: 'tiny livebadge' }, 'LIVE')));
    }
    return camView(d);
  };
  grid.append(...shown.map(tile));
  const pick = el('div', { class: 'seg' }, ...[[0, T('Auto')], [1, '1'], [2, '2×2'], [3, '3×3'], [4, '4×4']].map(([v, l]) => el('button', { class: w.cols === v ? 'on' : null, onclick: () => { w.cols = v; save().then(redraw); } }, l)));
  const full = el('button', { class: 'btn small', title: T('Full screen'), onclick: () => { const box = card.querySelector('.wall'); (box.requestFullscreen || box.webkitRequestFullscreen)?.call(box); } }, icon('expand', 14), T('Full screen'));
  const liveBtn = cams.some((d) => d.stream) ? el('button', { class: `btn small${w.live ? ' primary' : ''}`, title: T('Live video where the camera has it, instead of pictures every few seconds'), onclick: () => { w.live = !w.live; save().then(redraw); } }, w.live ? T('Live video: on') : T('Live video: off')) : null;
  const editBtn = el('button', { class: `btn small${SEC.wallEdit ? ' primary' : ''}`, onclick: () => { SEC.wallEdit = !SEC.wallEdit; redraw(); } }, icon(SEC.wallEdit ? 'check' : 'edit', 14), SEC.wallEdit ? T('Done') : T('Arrange'));
  const card = el('div', { class: 'card wide' }, el('div', { class: 'row between wrap', style: 'gap:8px;margin-bottom:12px' }, el('h2', { style: 'margin:0' }, icon('camera', 15), T('Video wall')), el('div', { class: 'row wrap', style: 'gap:6px' }, pick, liveBtn, editBtn, full)));
  if (!cams.length) { card.append(el('p', { class: 'muted' }, T('No cameras yet. Add Frigate, Reolink, any camera with a picture address, Ring (Pro) or cameras in Home Assistant from Connect.')), el('a', { class: 'btn small', href: '#connect' }, T('Connect a camera'))); return card; }
  if (SEC.wallEdit) {
    const list = el('div', { class: 'wall-edit' }, ...ordered.map((d, i) => el('div', { class: 'row', style: 'gap:8px;padding:6px 0;border-top:1px solid var(--line)' },
      el('input', { type: 'checkbox', checked: !w.hidden.includes(d.id), style: 'width:auto', 'aria-label': T('Show {name}', { name: d.name }), onchange: (e) => { w.hidden = e.target.checked ? w.hidden.filter((x) => x !== d.id) : [...w.hidden, d.id]; save().then(redraw); } }),
      el('span', { class: 'grow' }, d.name, srcName(d.source || d.provider) ? el('span', { class: 'tiny muted' }, ` · ${srcName(d.source || d.provider)}`) : null),
      el('button', { class: 'btn small ghost', 'aria-label': T('Move up'), disabled: i === 0 ? true : null, onclick: () => { const o = ordered.map((x) => x.id); [o[i - 1], o[i]] = [o[i], o[i - 1]]; w.order = o; save().then(redraw); } }, '↑'),
      el('button', { class: 'btn small ghost', 'aria-label': T('Move down'), disabled: i === ordered.length - 1 ? true : null, onclick: () => { const o = ordered.map((x) => x.id); [o[i + 1], o[i]] = [o[i], o[i + 1]]; w.order = o; save().then(redraw); } }, '↓'))));
    card.append(el('p', { class: 'small muted', style: 'margin-top:0' }, T('Pick which cameras are on the wall and their order. Every screen in the home uses this wall.')), list);
  } else card.append(shown.length ? grid : el('p', { class: 'muted' }, T('Every camera is hidden - press Arrange to show some.')));
  return card;
}

/* ---- doors, locks, the alarm and safety sensors ---- */
function doorsCard(devs, redraw) {
  const locks = devs.filter((d) => d.kind === 'lock'), doors = devs.filter((d) => d.open != null && d.kind !== 'cover' && d.kind !== 'lock'), garages = devs.filter((d) => d.kind === 'cover' && d.risky);
  const unlocked = locks.filter((d) => d.locked === false), open = [...doors, ...garages].filter((d) => d.open);
  const row = (d, state, bad, extra) => el('div', { class: `secrow${bad ? ' bad' : ''}` }, el('span', { class: 'ic' }, icon(devIconName(d), 16)), el('span', { class: 'grow ellipsis' }, d.name), el('span', { class: `pill${bad ? ' warn' : ' good'}` }, state), extra || null);
  const card = el('div', { class: 'card' }, el('div', { class: 'row between', style: 'margin-bottom:8px' }, el('h2', { style: 'margin:0' }, icon('lock', 15), T('Doors & locks')),
    unlocked.length ? el('button', { class: 'btn small primary', onclick: async (e) => { e.target.disabled = true; try { const r = await post('/api/security/lock-all', {}); toast(r.failed?.length ? T('Locked {locked}; couldn\'t lock {join}', { locked: r.locked, join: r.failed.join(', ') }) : T('Locked {locked}', { locked: r.locked })); } catch (err) { toast(err.message); } setTimeout(redraw, 1500); } }, T('Lock all ({n})', { n: unlocked.length })) : null));
  if (!locks.length && !doors.length && !garages.length) { card.append(el('p', { class: 'muted' }, T('No locks or door sensors yet. They come in from Home Assistant, YoLink, Shelly and others - see Connect.'))); return card; }
  card.append(el('div', { class: 'small muted', style: 'margin-bottom:6px' }, [unlocked.length ? T('{n} unlocked', { n: unlocked.length }) : locks.length ? T('All locked') : '', open.length ? T('{n} open', { n: open.length }) : doors.length + garages.length ? T('All closed') : ''].filter(Boolean).join(' · ')),
    ...locks.map((d) => row(d, d.locked ? T('Locked') : d.locked === false ? T('Unlocked') : T('Unknown'), d.locked === false, d.locked === false ? el('button', { class: 'btn small', onclick: async () => { await secAct(d, 'lock'); setTimeout(redraw, 1200); } }, T('Lock')) : null)),
    ...garages.map((d) => row(d, d.open ? T('Open|state') : T('Closed'), d.open, d.open ? el('button', { class: 'btn small', onclick: async () => { await secAct(d, 'close'); setTimeout(redraw, 1500); } }, T('Close')) : null)),
    ...doors.map((d) => row(d, d.open ? T('Open|state') : T('Closed'), d.open)),
    el('p', { class: 'tiny faint', style: 'margin:10px 0 0' }, T('CasaTorch can lock and close, never unlock or open.')));
  return card;
}
function alarmCard(devs, redraw) {
  const alarms = devs.filter((d) => d.kind === 'alarm'), safety = devs.filter((d) => d.smoke != null || d.water != null);
  const cams = devs.filter((d) => d.kind === 'camera'), off = cams.filter((d) => d.online === false);
  const card = el('div', { class: 'card' }, el('h2', {}, icon('shield', 15), T('Alarm & safety')));
  for (const a of alarms) { const box = el('div', { class: 'secalarm' }); box.append(el('b', {}, a.name), ...window.CasaControls.build(a, { units: S.units, act: (x, v) => { secAct(a, x, v); setTimeout(redraw, 1500); } })); card.append(box); }
  const bad = safety.filter((d) => d.smoke || d.water), low = safety.filter((d) => d.battery != null && d.battery <= 20);
  if (safety.length) card.append(el('div', { class: `secrow${bad.length ? ' bad' : ''}` }, el('span', { class: 'ic' }, icon('fire', 16)), el('span', { class: 'grow' }, T('{n} smoke and leak sensors', { n: safety.length })), el('span', { class: `pill ${bad.length ? 'warn' : 'good'}` }, bad.length ? T(bad.length > 1 ? '{n} alarms' : '{n} alarm', { n: bad.length }) : T('All clear'))),
    ...bad.map((d) => el('div', { class: 'small', style: 'color:var(--bad);margin:2px 0 0 34px' }, `${d.name}: ${d.smoke ? T('smoke') : T('water')}`)),
    ...low.map((d) => el('div', { class: 'small muted', style: 'margin:2px 0 0 34px' }, `${d.name}: ${T('battery {n}%', { n: Math.round(d.battery) })}`)));
  if (cams.length) card.append(el('div', { class: `secrow${off.length ? ' bad' : ''}` }, el('span', { class: 'ic' }, icon('camera', 16)), el('span', { class: 'grow' }, T('{n} cameras', { n: cams.length })), el('span', { class: `pill ${off.length ? 'warn' : 'good'}` }, off.length ? T('{n} not answering', { n: off.length }) : T('All online'))));
  if (!alarms.length && !safety.length && !cams.length) card.append(el('p', { class: 'muted' }, T('No alarm, smoke or leak sensors yet. They come in from Home Assistant, YoLink, Shelly and others.')));
  else if (!alarms.length) card.append(el('p', { class: 'tiny faint', style: 'margin:10px 0 0' }, T('An alarm system in Home Assistant shows up here too. CasaTorch can arm it, never disarm it.')));
  return card;
}

/* ---- devices on the home network, and the open-port check ---- */
function lanCard(s, redraw) {
  const card = el('div', { class: 'card wide' });
  const head = el('div', { class: 'row between wrap', style: 'gap:8px;margin-bottom:8px' }, el('h2', { style: 'margin:0' }, icon('wifi', 15), T('Devices on your network')),
    el('div', { class: 'row', style: 'gap:6px' }, el('span', { class: 'tiny muted' }, s.scanning ? T('Checking now…') : s.scanAt ? T('Looked {ago}', { ago: ago(s.scanAt) }) : ''), el('button', { class: 'btn small', onclick: async () => { try { await post('/api/security/scan', {}); toast(T('Checking your network - about a minute')); setTimeout(redraw, 60_000); } catch (e) { toast(e.message); } } }, T('Check now'))));
  card.append(head);
  if (!s.watch) { card.append(el('p', { class: 'muted' }, T('Watching for new devices is turned off.')), el('button', { class: 'btn small', onclick: async () => { await post('/api/security/settings', { watch: true }, 'PUT').catch((e) => toast(e.message)); redraw(); } }, T('Turn on'))); return card; }
  if (s.available === false) { card.append(el('p', { class: 'muted' }, T('CasaTorch can\'t see your home network from where it\'s running (for example inside Docker without host networking). Run it with host networking to use this.'))); return card; }
  if (!s.devices.length) { card.append(el('p', { class: 'muted' }, s.scanAt ? T('No devices found yet.') : T('The first look at your network happens a minute after CasaTorch starts. The devices it finds then are taken as yours; anything that joins later shows up here as new.'))); return card; }
  const fresh = s.devices.filter((d) => !d.known), risky = s.devices.filter((d) => d.ports.some((p) => !p.expected));
  card.append(el('p', { class: 'small muted', style: 'margin-top:0' }, `${T('{n} devices', { n: s.devices.length })}${fresh.length ? ` · ${T('{n} new', { n: fresh.length })}` : ''}${risky.length ? ` · ${T('{n} with something to look at', { n: risky.length })}` : ''}. ${T('Ports checked {when}.', { when: s.portsAt ? ago(s.portsAt) : T('soon') })}`));
  const list = el('div', { class: 'lanlist' });
  for (const d of s.devices.slice(0, 120)) {
    const name = d.name || d.host || (d.privateMac ? T('Phone or tablet (private address)') : T('Unknown device'));
    const row = el('div', { class: `landev${d.known ? '' : ' new'}` },
      el('div', { class: 'row', style: 'gap:10px;align-items:center' }, el('span', { class: `dot ${d.known ? (d.ports.some((p) => !p.expected && p.level === 'warning') ? 'warn' : 'good') : 'warn'}` }),
        el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'ellipsis' }, el('b', {}, name), d.known ? null : el('span', { class: 'pill warn', style: 'margin-left:8px' }, T('New'))),
          el('div', { class: 'tiny muted ellipsis' }, `${d.ip} · ${d.mac}${d.host && d.name ? ` · ${d.host}` : ''} · ${T('first seen {ago}', { ago: ago(d.firstSeen) })}`)),
        !d.known ? el('button', { class: 'btn small primary', onclick: async () => { const n = prompt(T('What is it? (optional - e.g. "Sam\'s phone")'), ''); await post(`/api/security/devices/${encodeURIComponent(d.mac)}`, { known: true, ...(n ? { name: n } : {}) }).catch((e) => toast(e.message)); redraw(); } }, T('It\'s mine')) : el('button', { class: 'btn small ghost', title: T('Name it'), 'aria-label': T('Name {name}', { name }), onclick: async () => { const n = prompt(T('Name this device'), d.name || ''); if (n == null) return; await post(`/api/security/devices/${encodeURIComponent(d.mac)}`, { name: n }).catch((e) => toast(e.message)); redraw(); } }, icon('edit', 14))),
      ...d.ports.map((p) => el('div', { class: `portrow${p.expected ? ' ok' : ` ${p.level}`}` }, el('div', {}, el('b', {}, T(p.name)), el('span', { class: 'tiny muted' }, ` (${T('port {port}', { port: p.port })})`), p.expected ? el('span', { class: 'tiny muted' }, T(' · marked as expected')) : null, el('div', { class: 'small muted' }, T(p.how))),
        el('button', { class: 'btn small ghost', onclick: async () => { await post('/api/security/expected', { mac: d.mac, port: p.port, expected: !p.expected }).catch((e) => toast(e.message)); redraw(); } }, p.expected ? T('Watch it again') : T('I use this')))));
    list.append(row);
  }
  card.append(list, el('p', { class: 'tiny faint', style: 'margin:10px 0 0' }, T('CasaTorch looks only at your home network, and only checks a short list of risky services. Nothing about these devices leaves this CasaTorch.')));
  return card;
}

/* ---- the checklist and recent events ---- */
function checklistCard(items) {
  const done = items.filter((i) => i.ok).length;
  return el('div', { class: 'card' }, el('div', { class: 'row between', style: 'margin-bottom:8px' }, el('h2', { style: 'margin:0' }, icon('checkc', 15), T('Checklist')), el('span', { class: 'pill' }, T('{n} of {total}', { n: done, total: items.length }))),
    el('div', { class: 'meterbar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.round((done / Math.max(1, items.length)) * 100)}%` })),
    ...items.sort((a, b) => Number(a.ok) - Number(b.ok)).map((i) => el('div', { class: `checkrow${i.ok ? ' ok' : ''}` }, el('span', { class: 'ck' }, icon(i.ok ? 'check' : 'dotc', 15)),
      el('div', {}, el('div', {}, i.href && !i.ok ? el('a', { href: i.href }, T(i.title)) : T(i.title)), i.ok ? null : el('div', { class: 'small muted' }, alertTitle(i.how))))));
}
function eventsCard(events) {
  return el('div', { class: 'card' }, el('h2', {}, icon('clock', 15), T('Recent security events')),
    events.length ? el('div', {}, ...events.slice(0, 25).map((e) => el('div', { class: 'evrow' }, el('span', { class: `dot ${sevDot[e.severity] || ''}` }), el('span', { class: 'grow' }, alertTitle(e)), el('span', { class: 'tiny muted', title: fmtWhen(e.at) }, ago(e.at)))))
      : el('p', { class: 'muted' }, T('Nothing yet. Doorbell presses, motion, open doors, leaks, new devices and sign-in trouble show up here.')));
}

tab({ id: 'security', label: 'Security', icon: 'shield', after: 'cameras', async render(main) {
  SEC.wallCard = null; SEC.wallKey = null;   // a new visit: the wall from last time had its live video stopped
  const draw = async () => {
    const [{ devices = [] }, s] = await Promise.all([api('/api/devices'), api('/api/security')]);
    const cams = devices.filter((d) => d.kind === 'camera');
    const issues = devices.filter((d) => d.water || d.smoke || d.triggered).length + devices.filter((d) => d.kind === 'lock' && d.locked === false).length + s.devices.filter((d) => !d.known).length + s.devices.filter((d) => d.ports.some((p) => !p.expected && p.level === 'warning')).length;
    if (!main.isConnected) return;   // left for another page while this was loading
    setTop(T('Security'), issues ? T(issues === 1 ? '{n} thing to look at' : '{n} things to look at', { n: issues }) : T('All clear'), []);
    const key = JSON.stringify([cams.map((d) => [d.id, d.name, !!d.stream]), s.wall, SEC.wallEdit]);
    if (key !== SEC.wallKey || !SEC.wallCard) { SEC.wallKey = key; SEC.wallCard = wallCard(cams, s.wall, draw); }   // the wall keeps playing while the rest refreshes
    main.replaceChildren(el('div', { class: 'cards sec' }, SEC.wallCard, doorsCard(devices, draw), alarmCard(devices, draw), checklistCard(s.checklist), eventsCard(s.events), lanCard(s, draw)));
  };
  await draw();
  return () => { if (!SEC.wallEdit) draw(); };
} });
