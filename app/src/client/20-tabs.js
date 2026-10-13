/* ---- Alerts ---- */
tab({ id: 'alerts', label: 'Alerts', async render(main) {
  const draw = async () => {
    const a = await api('/api/alerts');
    const now = el('div', { class: 'card' }, el('h2', {}, 'Right now'));
    if (!a.now?.length) now.append(el('div', { class: 'row' }, el('span', { class: 'dot good' }), 'All clear.'));
    for (const x of a.now || []) now.append(el('div', { class: `alert ${x.severity}` }, el('div', {}, el('b', {}, x.title), el('div', { class: 'small muted' }, `${x.source || ''}${x.since ? ` · since ${fmtWhen(x.since)}` : ''}`))));
    const past = el('div', { class: 'card' }, el('h2', {}, 'Recent'));
    if (!a.recent?.length) past.append(el('p', { class: 'muted' }, 'Nothing yet.'));
    past.append(el('ul', { class: 'list' }, (a.recent || []).slice(0, 50).map((x) => el('li', {}, el('span', { class: `dot ${x.severity === 'ok' ? 'good' : x.severity === 'critical' ? 'bad' : 'warn'}` }), el('div', { class: 'grow' }, x.title), el('span', { class: 'small muted' }, fmtWhen(x.at))))));
    main.replaceChildren(el('h1', {}, 'Alerts'), el('div', { class: 'grid wide' }, now, past));
  };
  await draw(); return draw;
} });

/* ---- Controls: everything that switches, plus sensors ---- */
const CAN_TOGGLE = new Set(['light', 'switch', 'plug', 'media']);
function devCard(d, after) {
  const cls = ['dev', d.online === false && 'offline', (d.water || d.smoke) && 'alarm', d.playing && 'playing', !d.playing && d.on && 'on'].filter(Boolean).join(' ');
  const meta = [d.on != null && d.kind !== 'sensor' ? (d.on ? 'On' : 'Off') : null, d.brightness ? `${d.brightness}%` : null, d.powerW != null ? `${Math.round(d.powerW)} W` : null,
    d.playing ? (d.title || 'Playing') : null, d.tempC != null ? `${S.units === 'C' ? d.tempC.toFixed(1) : (d.tempC * 9 / 5 + 32).toFixed(0)}°` : null, d.targetC != null ? `set ${S.units === 'C' ? d.targetC.toFixed(1) : (d.targetC * 9 / 5 + 32).toFixed(0)}\u00B0` : null,
    d.humidity != null ? `${d.humidity}%` : null, d.open != null ? (d.open ? 'Open' : 'Closed') : null, d.water != null ? (d.water ? 'WATER!' : 'Dry') : null, d.locked != null ? (d.locked ? 'Locked' : 'Unlocked') : null,
    d.battery != null ? `battery ${d.battery}%` : null, d.online === false ? 'offline' : null].filter(Boolean).join(' · ');
  const b = el('button', { class: cls, title: CAN_TOGGLE.has(d.kind) ? 'Tap to switch' : d.name }, el('span', { class: 'ic' }, devIcon(d)), el('div', { style: 'min-width:0' }, el('div', { class: 'ellipsis' }, d.name), el('div', { class: 'meta' }, meta)));
  if (CAN_TOGGLE.has(d.kind) && d.online !== false) b.onclick = async () => {
    try { await post(`/api/devices/${encodeURIComponent(d.id)}/${d.kind === 'media' ? 'play_pause' : 'toggle'}`); if (d.kind === 'media') d.playing = !d.playing; else d.on = !d.on; b.replaceWith(devCard(d, after)); after?.(); }
    catch (err) { toast(err.message); }
  };
  return b;
}
const GROUPS = [['Lights', (d) => d.kind === 'light'], ['Plugs & switches', (d) => d.kind === 'plug' || d.kind === 'switch'], ['Media', (d) => d.kind === 'media'], ['Climate', (d) => d.kind === 'climate'], ['Locks', (d) => d.kind === 'lock'], ['Sensors', (d) => d.kind === 'sensor']];
tab({ id: 'controls', label: 'Controls', async render(main) {
  const draw = async () => {
    const { devices = [], errors = [] } = await api('/api/devices');
    const out = [el('h1', {}, 'Controls')];
    for (const [name, f] of GROUPS) { const ds = devices.filter(f); if (ds.length) out.push(el('h2', { style: 'margin-top:18px' }, name), el('div', { class: 'devs' }, ds.map((d) => devCard(d)))); }
    if (!devices.filter((d) => d.kind !== 'camera').length) out.push(el('div', { class: 'card empty' }, 'No devices yet. Connect Hue, Shelly, YoLink or Home Assistant in setup.'));
    for (const e of errors) out.push(el('p', { class: 'small muted' }, `${e.provider}: ${e.error}`));
    main.replaceChildren(...out);
  };
  await draw(); return draw;
} });

/* ---- Cameras: snapshots that refresh; tap for a big one ---- */
const snapUrl = (d) => (d.provider === 'ring' ? `/api/ring/${encodeURIComponent(d.id.split(':').slice(1).join(':'))}/snapshot` : `/api/cameras/${encodeURIComponent(d.id.split(':').slice(1).join(':'))}/snapshot`);
tab({ id: 'cameras', label: 'Cameras', async render(main) {
  const { devices = [] } = await api('/api/devices');
  const cams = devices.filter((d) => d.kind === 'camera');
  const imgs = [];
  const grid = el('div', { class: 'cams' }, cams.map((d) => {
    const img = el('img', { alt: d.name, src: `${snapUrl(d)}?t=${Date.now()}`, onclick: () => modal(el('h2', {}, d.name), el('img', { src: `${snapUrl(d)}?t=${Date.now()}`, alt: d.name })) });
    img.onerror = () => { img.alt = `${d.name}: no picture`; };
    imgs.push([img, d]);
    return el('div', { class: 'cam' }, img, el('div', { class: 'row between' }, el('b', {}, d.name), el('span', { class: 'small muted' }, d.source || d.provider)));
  }));
  main.replaceChildren(el('h1', {}, 'Cameras'), cams.length ? grid : el('div', { class: 'card empty' }, 'No cameras yet. Frigate, Reolink, any camera with a snapshot address, and Ring (Pro) can be added in setup.'));
  return () => { for (const [img, d] of imgs) img.src = `${snapUrl(d)}?t=${Date.now()}`; };
} });

/* ---- Network ---- */
tab({ id: 'network', label: 'Network', async render(main) {
  const draw = async () => {
    const n = await api('/api/internet');
    const btn = el('button', { class: 'primary' }, 'Run a speed test');
    btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Testing (about 20 s)...'; try { await post('/api/internet/speedtest'); toast('Speed test done'); await draw(); } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Run a speed test'; } };
    const net = el('div', { class: 'card' }, el('h2', {}, 'Internet'), el('div', { class: 'row' }, el('span', { class: `dot ${n.online ? 'good' : 'bad'}` }), el('b', {}, n.online ? 'Online' : 'Down')),
      el('dl', { class: 'kv', style: 'margin-top:10px' }, el('dt', {}, 'Provider'), el('dd', {}, n.provider || '-'), el('dt', {}, 'Public IP'), el('dd', {}, n.publicIp || '-'), el('dt', {}, 'Location'), el('dd', {}, n.city || '-'),
        el('dt', {}, 'Ping'), el('dd', {}, Object.entries(n.latencyMs || {}).map(([k, v]) => `${k} ${v == null ? '-' : `${v} ms`}`).join(' · '))));
    const sp = el('div', { class: 'card' }, el('h2', {}, 'Speed'), n.speed ? el('div', { class: 'row', style: 'gap:28px' }, el('div', {}, el('div', { class: 'big' }, Math.round(n.speed.downMbps)), el('div', { class: 'muted small' }, 'Mbps down')), el('div', {}, el('div', { class: 'big' }, Math.round(n.speed.upMbps)), el('div', { class: 'muted small' }, 'Mbps up'))) : el('p', { class: 'muted' }, 'No test yet.'),
      el('p', { class: 'small muted' }, n.speed ? `Tested ${fmtWhen(n.speed.at)}. HouseOS tests every 4 hours.` : 'HouseOS tests every 4 hours.'), btn);
    const lan = el('div', { class: 'card' }, el('h2', {}, 'Home network'), el('dl', { class: 'kv' }, el('dt', {}, 'Router'), el('dd', {}, n.gateway || '-'), el('dt', {}, 'Devices seen'), el('dd', {}, n.lanDevices ?? '-'), el('dt', {}, 'This box'), el('dd', {}, n.host || '-')),
      el('p', { class: 'small muted' }, 'Per-device traffic and Wi-Fi detail come from a Meraki or UniFi controller (Settings > Run setup again).'));
    main.replaceChildren(el('h1', {}, 'Network'), el('div', { class: 'grid' }, net, sp, lan));
  };
  await draw(); return draw;
} });

/* ---- Energy: what is drawing power right now and what it costs ---- */
tab({ id: 'energy', label: 'Energy', async render(main) {
  const draw = async () => {
    const [{ devices = [] }, st] = await Promise.all([api('/api/devices'), api('/api/settings').catch(() => ({}))]);
    const rate = st.energy?.ratePerKwh, cur = st.energy?.currency || 'USD';
    const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v);
    const ds = devices.filter((d) => typeof d.powerW === 'number').sort((a, b) => b.powerW - a.powerW);
    const total = ds.reduce((s, d) => s + d.powerW, 0), max = Math.max(1, ...ds.map((d) => d.powerW));
    const head = el('div', { class: 'grid' },
      el('div', { class: 'card' }, el('h2', {}, 'Using now'), el('div', { class: 'big' }, `${Math.round(total)} W`), el('div', { class: 'muted small' }, `on ${ds.length} metered device${ds.length === 1 ? '' : 's'}`)),
      el('div', { class: 'card' }, el('h2', {}, 'If it stays like this'), rate ? el('div', {}, el('div', { class: 'big' }, money(total / 1000 * 24 * rate)), el('div', { class: 'muted small' }, `a day · ${money(total / 1000 * 24 * 30 * rate)} a month at ${money(rate)}/kWh`)) : el('p', { class: 'muted' }, 'Add your electricity rate in Settings to see the cost.')));
    const bars = el('div', { class: 'card' }, el('h2', {}, 'By device'), ds.length ? el('div', { class: 'bars' }, ds.map((d) => el('div', { class: 'bar' }, el('span', { class: 'ellipsis' }, d.name), el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(d.powerW / max) * 100}%` })), el('span', { style: 'text-align:right' }, `${Math.round(d.powerW)} W`)))) : el('p', { class: 'muted' }, 'No smart plugs with power metering yet. Shelly plugs work without Home Assistant; Kasa, Tuya and others through Home Assistant.'));
    main.replaceChildren(el('h1', {}, 'Energy'), head, el('div', { style: 'height:14px' }), bars,
      el('p', { class: 'small muted' }, S.status?.pro?.pro ? 'Pro: daily totals, the weekly report and "what changed" insights build up as HouseOS records history.' : 'Pro adds energy history, the weekly report and "what changed" insights.'));
  };
  await draw(); return draw;
} });

/* ---- 3D Home (Pro): the LiDAR floor plan, live ---- */
tab({ id: 'house3d', label: '3D Home', pro: true, async render(main) {
  const p = S.status?.pro || {};
  if (!p.pro) {
    main.replaceChildren(el('div', { class: 'card hero3d' }, el('div', {}, el('h1', {}, 'Your house, in 3D'),
      el('p', { class: 'muted', style: 'max-width:560px' }, 'Scan each floor with an iPhone or iPad Pro (LiDAR), drop the model into HouseOS, and pin your devices where they really are. Lights glow when they\'re on, speakers pulse when music plays, leaks and open doors flash, and you can tap a pin to switch it.'),
      el('a', { class: 'btn primary', href: '#settings' }, 'Unlock with HouseOS Pro'), ' ', el('a', { class: 'btn', href: '/floorplan.html' }, 'Preview'))));
    return null;
  }
  main.replaceChildren(el('div', { class: 'row between wrap', style: 'margin-bottom:10px' }, el('h1', { style: 'margin:0' }, '3D Home'),
    el('a', { class: 'btn primary', href: '/floorplan.html' }, 'Full screen')),
  el('iframe', { src: '/floorplan.html?embed=1', title: '3D floor plan', style: 'width:100%;height:min(72vh,720px);border:1px solid var(--line);border-radius:14px;background:#05070d' }));
  return null;
} });
