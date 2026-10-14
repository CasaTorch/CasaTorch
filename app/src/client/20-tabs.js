/* ---- Alerts ---- */
tab({ id: 'alerts', label: 'Alerts', icon: 'bell', async render(main) {
  const draw = async () => {
    const a = await api('/api/alerts');
    const now = el('div', { class: 'card' }, el('h2', {}, 'Right now'));
    if (!a.now?.length) now.append(el('div', { class: 'row' }, el('span', { class: 'dot good' }), 'All clear - nothing needs you.'));
    for (const x of a.now || []) now.append(el('div', { class: `alert ${x.severity}` }, el('div', {}, el('b', {}, x.title), el('div', { class: 'small muted' }, `${x.source || ''}${x.since ? ` · since ${fmtWhen(x.since)}` : ''}`))));
    const past = el('div', { class: 'card' }, el('h2', {}, 'Recent'));
    past.append(a.recent?.length ? el('ul', { class: 'list' }, a.recent.slice(0, 50).map((x) => el('li', {}, el('span', { class: `dot ${x.severity === 'ok' ? 'good' : x.severity === 'critical' ? 'bad' : 'warn'}` }), el('div', { class: 'grow' }, x.title), el('span', { class: 'small muted' }, fmtWhen(x.at))))) : el('p', { class: 'muted' }, 'Nothing yet.'));
    main.replaceChildren(el('div', { class: 'cards' }, now, past));
  };
  await draw(); return draw;
} });

/* ---- Controls: everything that switches, plus sensors ---- */
const GROUPS = [['Lights', (d) => d.kind === 'light'], ['Plugs & switches', (d) => d.kind === 'plug' || d.kind === 'switch'], ['Fans', (d) => d.kind === 'fan'], ['Media', (d) => d.kind === 'media'],
  ['Climate', (d) => d.kind === 'climate'], ['Blinds, doors & covers', (d) => d.kind === 'cover'], ['Locks & alarm', (d) => d.kind === 'lock' || d.kind === 'alarm'], ['Scenes & scripts', (d) => d.kind === 'action'],
  ['Vacuums', (d) => d.kind === 'vacuum'], ['People', (d) => d.kind === 'presence'], ['Sensors', (d) => d.kind === 'sensor'], ['Everything else', (d) => d.kind === 'value']];
tab({ id: 'controls', label: 'Controls', icon: 'sliders', async render(main) {
  let query = '';
  const search = el('input', { type: 'search', placeholder: 'Search everything - lights, sensors, Home Assistant entities…', style: 'max-width:520px' });
  let devicesCache = [];
  const paint = (devices, errors = []) => {
    const t = query.toLowerCase(), list = devices.filter((d) => d.kind !== 'camera' && (!t || `${d.name} ${d.id} ${d.domain || ''}`.toLowerCase().includes(t)));
    const out = [el('div', { class: 'row wrap', style: 'margin-bottom:6px' }, search, el('span', { class: 'small muted' }, `${list.length} of ${devices.filter((d) => d.kind !== 'camera').length}`))];
    for (const [name, f] of GROUPS) {
      const ds = list.filter(f); if (!ds.length) continue;
      const grid = el('div', { class: 'devs' }, ds.slice(0, name === 'Everything else' && !t ? 60 : 500).map((d) => devButton(d)));
      if (name === 'Everything else' && !t && ds.length > 12) out.push(el('details', {}, el('summary', { class: 'section-title', style: 'cursor:pointer' }, `${name} (${ds.length})`), grid));
      else out.push(el('div', { class: 'section-title' }, `${name} (${ds.length})`), grid);
    }
    if (!devices.filter((d) => d.kind !== 'camera').length) out.push(el('div', { class: 'card empty' }, 'No devices yet. Connect Hue, Shelly, YoLink or Home Assistant in setup.'));
    else if (!list.length) out.push(el('p', { class: 'muted' }, 'Nothing matches that search.'));
    for (const e of errors) out.push(el('p', { class: 'small muted' }, `${e.provider}: ${e.error}`));
    const focused = document.activeElement === search; main.replaceChildren(...out); if (focused) { search.focus(); }
  };
  search.oninput = () => { query = search.value; paint(devicesCache); };
  const draw = async () => {
    const { devices = [], errors = [] } = await api('/api/devices'); devicesCache = devices;
    setTop(tabLabel({ id: 'controls', label: 'Controls' }), `${devices.filter((d) => d.provider === 'ha').length ? 'Includes everything from Home Assistant' : ''}`, [el('button', { class: 'btn', onclick: () => renameDevices(devices, draw) }, icon('edit'), 'Rename devices')]);
    paint(devices, errors);
  };
  await draw(); return draw;
} });

/* ---- Cameras ---- */
tab({ id: 'cameras', label: 'Cameras', icon: 'camera', async render(main) {
  const { devices = [] } = await api('/api/devices');
  const cams = devices.filter((d) => d.kind === 'camera');
  main.replaceChildren(cams.length ? el('div', { class: 'cams' }, cams.map(camView)) : el('div', { class: 'card empty' }, 'No cameras yet. Frigate, Reolink, any camera with a snapshot address, and Ring (Pro) can be added in setup.'));
  return () => main.querySelectorAll('.cam img').forEach((img, i) => { img.src = `${snapUrl(cams[i])}?t=${Date.now()}`; });
} });

/* ---- Network ---- */
tab({ id: 'network', label: 'Network', icon: 'wifi', async render(main) {
  const draw = async () => {
    const n = await api('/api/internet');
    const btn = el('button', { class: 'btn primary' }, icon('bolt'), 'Run a speed test');
    btn.onclick = async () => { btn.disabled = true; btn.lastChild.textContent = 'Testing (about 20 s)...'; try { await post('/api/internet/speedtest'); toast('Speed test done'); await draw(); } catch (err) { toast(err.message); btn.disabled = false; } };
    const net = el('div', { class: 'card' }, el('h2', {}, 'Internet'), el('div', { class: 'row' }, el('span', { class: `dot ${n.online ? 'good' : 'bad'}` }), el('b', {}, n.online ? 'Online' : 'Down')),
      el('dl', { class: 'kv', style: 'margin-top:12px' }, el('dt', {}, 'Provider'), el('dd', {}, n.provider || '-'), el('dt', {}, 'Public IP'), el('dd', {}, n.publicIp || '-'), el('dt', {}, 'Location'), el('dd', {}, n.city || '-'),
        el('dt', {}, 'Ping'), el('dd', {}, Object.entries(n.latencyMs || {}).map(([k, v]) => `${k} ${v == null ? '-' : `${v} ms`}`).join(' · '))));
    const sp = el('div', { class: 'card' }, el('h2', {}, 'Speed'), n.speed ? el('div', { class: 'row', style: 'gap:30px' }, el('div', { class: 'stat' }, el('span', { class: 'big' }, Math.round(n.speed.downMbps)), el('span', { class: 'lbl' }, 'Mbps down')), el('div', { class: 'stat' }, el('span', { class: 'big' }, Math.round(n.speed.upMbps)), el('span', { class: 'lbl' }, 'Mbps up'))) : el('p', { class: 'muted' }, 'No test yet.'),
      el('p', { class: 'small muted' }, n.speed ? `Tested ${fmtWhen(n.speed.at)}. CasaTorch tests every 4 hours.` : 'CasaTorch tests every 4 hours.'), btn);
    const lan = el('div', { class: 'card' }, el('h2', {}, 'Home network'), el('dl', { class: 'kv' }, el('dt', {}, 'Router'), el('dd', {}, n.gateway || '-'), el('dt', {}, 'Devices seen'), el('dd', {}, n.lanDevices ?? '-'), el('dt', {}, 'This box'), el('dd', {}, n.host || '-')),
      el('p', { class: 'small muted' }, 'Per-device traffic and Wi-Fi detail come from a Meraki or UniFi controller (Settings > Run setup again).'));
    main.replaceChildren(el('div', { class: 'cards' }, net, sp, lan));
  };
  await draw(); return draw;
} });

/* ---- Energy ---- */
tab({ id: 'energy', label: 'Energy', icon: 'bolt', async render(main) {
  const draw = async () => {
    const [{ devices = [] }, st] = await Promise.all([api('/api/devices'), api('/api/settings').catch(() => ({}))]);
    const rate = st.energy?.ratePerKwh, cur = st.energy?.currency || 'USD';
    const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v);
    const ds = devices.filter((d) => typeof d.powerW === 'number').sort((a, b) => b.powerW - a.powerW);
    const total = ds.reduce((s, d) => s + d.powerW, 0), max = Math.max(1, ...ds.map((d) => d.powerW));
    main.replaceChildren(el('div', { class: 'cards' },
      el('div', { class: 'card' }, el('h2', {}, 'Using now'), el('div', { class: 'big' }, `${Math.round(total)} W`), el('div', { class: 'muted small', style: 'margin-top:6px' }, `on ${ds.length} metered device${ds.length === 1 ? '' : 's'}`)),
      el('div', { class: 'card' }, el('h2', {}, 'If it stays like this'), rate ? el('div', {}, el('div', { class: 'big' }, money(total / 1000 * 24 * rate)), el('div', { class: 'muted small', style: 'margin-top:6px' }, `a day · ${money(total / 1000 * 24 * 30 * rate)} a month at ${money(rate)}/kWh`)) : el('p', { class: 'muted' }, 'Add your electricity rate in Settings to see the cost.'))),
    el('div', { class: 'card', style: 'margin-top:14px' }, el('h2', {}, 'By device'), ds.length ? el('div', { class: 'bars' }, ds.map((d) => el('div', { class: 'bar-row' }, el('span', { class: 'ellipsis' }, d.name), el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(d.powerW / max) * 100}%` })), el('span', { class: 'num', style: 'text-align:right' }, `${Math.round(d.powerW)} W`)))) : el('p', { class: 'muted' }, 'No smart plugs with power metering yet. Shelly plugs work without Home Assistant; Kasa, Tapo and others through Home Assistant.')));
  };
  await draw(); return draw;
} });

/* ---- 3D Home (Pro) ---- */
tab({ id: 'house3d', label: '3D Home', short: '3D', icon: 'cube', pro: true, async render(main) {
  if (!isPro()) {
    main.replaceChildren(el('div', { class: 'card hero3d' }, el('h2', { style: 'justify-content:center' }, 'CasaTorch Pro'), el('div', { style: 'font-size:28px;font-weight:700;margin-bottom:10px' }, 'Your house, in 3D'),
      el('p', { class: 'muted', style: 'max-width:560px;margin:0 auto 18px' }, 'Scan each floor with a LiDAR iPhone or iPad Pro - or draw your floors right in CasaTorch on any device - and pin your devices where they really are. Lights glow when on, speakers pulse with music, leaks and open doors flash - tap a pin to switch it.'),
      el('div', { class: 'row', style: 'justify-content:center' }, el('a', { class: 'btn primary', href: '#settings' }, 'Unlock with Pro'), el('a', { class: 'btn', href: '/floorplan.html' }, 'Preview'))));
    return null;
  }
  setTop('3D Home', 'Your LiDAR scan, live', [el('a', { class: 'btn', href: '/floorplan.html#guide' }, 'Add floors'), el('a', { class: 'btn primary', href: '/floorplan.html' }, icon('expand'), 'Full screen')]);
  main.replaceChildren(el('iframe', { class: 'plan', src: '/floorplan.html?embed=1', title: '3D floor plan' }));
  return null;
} });

/* Give devices the names your household uses ("Kitchen island" instead of "hue:7"). Saved on the box, used everywhere - Home, 3D, alerts, Ask. */
function renameDevices(devices, done) {
  const names = { ...(S.ui.deviceNames || {}) };
  const rows = devices.map((d) => { const inp = el('input', { value: names[d.id] || '', placeholder: d.originalName || d.name, maxlength: 60, oninput: (e) => { names[d.id] = e.target.value.trim(); } });
    return el('div', { class: 'tab-row' }, icon(devIconName(d)), inp, el('span', { class: 'tiny faint ellipsis', style: 'max-width:140px' }, d.provider)); });
  const m = modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, 'Type a new name, or leave a box empty to keep the name from the device.'), el('div', { style: 'max-height:55vh;overflow:auto;padding-right:6px' }, rows),
    el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: async () => { try { await saveUi({ deviceNames: Object.fromEntries(Object.entries(names).filter(([, v]) => v)) }); m.remove(); toast('Names saved'); done?.(); } catch (err) { toast(err.message); } } }, 'Save names'))), { title: 'Rename devices', wide: true });
}
