/* ---- Alerts ---- */
tab({ id: 'alerts', label: 'Alerts', icon: 'bell', async render(main) {
  const draw = async () => {
    const a = await api('/api/alerts');
    const now = el('div', { class: 'card' }, el('h2', {}, 'Right now'));
    if (!a.now?.length) now.append(el('div', { class: 'row' }, el('span', { class: 'dot good' }), 'All clear - nothing needs you.'));
    for (const x of a.now || []) now.append(el('div', { class: `alert ${x.severity}` }, el('div', { class: 'grow' }, el('b', {}, x.title), el('div', { class: 'small muted' }, `${x.source || ''}${x.since ? ` · since ${fmtWhen(x.since)}` : ''}${x.acked ? ` · ${x.acked.by} has it (${fmtTime(x.acked.at)})` : ''}`)),
      x.repeating ? el('button', { class: 'btn small', onclick: async (e) => { e.target.disabled = true; try { await post(`/api/alerts/${encodeURIComponent(x.id)}/ack`); toast('Got it - no more reminders for this one'); draw(); } catch (err) { toast(err.message); e.target.disabled = false; } } }, icon('check'), 'Got it') : null));
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
/* Server monitor (Pro): a row per server or app, with the last hour as a strip of ticks. */
function serversCard(mo, redraw) {
  const card = el('div', { class: 'card servers', style: 'margin-top:14px' });
  const head = el('h2', { style: 'margin:0' }, 'Servers and apps', el('span', { class: 'pill pro' }, 'Pro'));
  if (!mo.pro) {
    card.append(head, el('p', { class: 'muted', style: 'margin-top:10px' }, 'Watch your NAS, servers and self-hosted apps: up or down, how fast they answer, and certificates about to expire - with a phone alert when something stops responding.'), el('a', { class: 'btn primary', href: '#settings' }, 'Unlock with Pro'));
    return card;
  }
  const add = el('button', { class: 'btn small', onclick: () => {
    const name = el('input', { placeholder: 'NAS, Plex, Backup server...', maxlength: 40 });
    const target = el('input', { placeholder: 'http://nas.local:5000  or  192.168.1.20:22' });
    const msg = el('p', { class: 'small', style: 'min-height:1.2em' });
    const save = el('button', { class: 'btn primary', onclick: async () => {
      save.disabled = true; msg.textContent = 'Checking it...';
      try { const r = await post('/api/monitors', { name: name.value, target: target.value }); m.remove(); toast(r.monitor.up ? `${r.monitor.name} is up` : `${r.monitor.name} added - it isn't answering yet`); redraw(); }
      catch (e) { msg.textContent = e.message; msg.style.color = 'var(--bad)'; save.disabled = false; }
    } }, 'Add');
    const m = modal(el('div', {}, el('label', { class: 'field' }, el('span', {}, 'Name'), name), el('label', { class: 'field' }, el('span', {}, 'Web address, or host and port'), target),
      el('p', { class: 'small muted' }, 'A web address is up when it answers. A host and port is up when it accepts a connection (for example 22 for SSH, 445 for file sharing). Checked every minute from this CasaTorch.'), msg, el('div', { class: 'row', style: 'justify-content:flex-end' }, save)), { title: 'Watch a server or app' });
    setTimeout(() => name.focus(), 30);
  } }, icon('plus'), 'Add');
  const rows = mo.monitors.map((x) => {
    const dot = x.down ? 'bad' : x.up ? 'good' : 'warn';
    const strip = el('div', { class: 'tickstrip', 'aria-hidden': 'true' }, (x.recent || []).map((v) => el('i', { class: v < 0 ? 'down' : '' })));
    const del = el('button', { class: 'btn ghost small', 'aria-label': `Stop watching ${x.name}`, onclick: async () => { try { await api(`/api/monitors/${encodeURIComponent(x.id)}`, { method: 'DELETE' }); redraw(); } catch (e) { toast(e.message); } } }, icon('x'));
    return el('div', { class: 'srv' },
      el('span', { class: `dot ${dot}` }),
      el('div', { class: 'grow' }, el('div', { class: 'row wrap', style: 'gap:8px' }, el('b', {}, x.name), x.cert && x.cert.days <= 14 ? el('span', { class: 'pill warn' }, x.cert.days < 0 ? 'certificate expired' : `certificate: ${x.cert.days} d`) : null),
        el('div', { class: 'tiny muted ellipsis' }, x.target)),
      strip,
      el('div', { class: 'srv-num' }, el('b', {}, x.down ? 'Down' : x.ms != null ? `${x.ms} ms` : '-'), el('span', { class: 'tiny muted' }, x.down ? (x.error || '') : x.uptime24h != null ? `${x.uptime24h}% up` : 'checking')),
      mo.demo ? null : del);
  });
  card.append(el('div', { class: 'row between', style: 'margin-bottom:10px' }, head, mo.monitors.length < mo.max ? add : null),
    rows.length ? el('div', { class: 'srvs' }, rows) : el('p', { class: 'muted' }, 'Nothing watched yet. Add your NAS, a media server, Home Assistant or any self-hosted app.'));
  return card;
}
/* Network monitoring (Pro): Pi-hole, AdGuard Home, UniFi, Meraki. */
const NET_HELP = {
  pihole: ['Address', 'http://192.168.1.5', 'Password', 'Pi-hole 6: your web password, or an app password from Settings › Web interface / API. Pi-hole 5: the API token from Settings › API.'],
  adguard: ['Address', 'http://192.168.1.5:3000', 'Password', 'The user name and password you sign in to AdGuard Home with.'],
  unifi: ['Address of your UniFi console', 'https://192.168.1.1', 'API key', 'In UniFi Network: Settings › Control Plane › Integrations › Create API key. Needs UniFi Network 9 or newer on a console (Dream Machine, Cloud Key, UniFi OS Server).'],
  meraki: [null, null, 'API key', 'In the Meraki dashboard: your name (top right) › My profile › API access › Generate new API key. A read-only admin account is enough.'],
};
const fmtN = (v) => (v == null ? '-' : new Intl.NumberFormat('en-US').format(v));
function netSummary(x) {
  const s = x.summary || {};
  if (x.kind === 'pihole' || x.kind === 'adguard') return [`${fmtN(s.queries)} queries`, s.percentBlocked != null ? `${s.percentBlocked}% blocked` : null, s.clients != null ? `${fmtN(s.clients)} clients` : null, s.protection === false ? 'blocking is OFF' : s.protection ? 'blocking on' : null].filter(Boolean).join(' · ');
  return [`${fmtN(s.devices)} device${s.devices === 1 ? '' : 's'}`, s.offline ? `${s.offline} offline` : 'all online', s.alerting ? `${s.alerting} alerting` : null, s.clients != null ? `${fmtN(s.clients)} clients` : null, s.site || s.org ? `(${s.site || s.org})` : null].filter(Boolean).join(' · ');
}
function networkCard(nw, redraw) {
  const card = el('div', { class: 'card netsrc', style: 'margin-top:14px' });
  const head = el('h2', { style: 'margin:0' }, 'Network devices', el('span', { class: 'pill pro' }, 'Pro'));
  if (!nw.pro) {
    card.append(head, el('p', { class: 'muted', style: 'margin-top:10px' }, 'Connect UniFi, Cisco Meraki, Pi-hole or AdGuard Home: every access point and switch online or offline, how many devices are connected, and how much your DNS filter blocks - with an alert when something drops off.'), el('a', { class: 'btn primary', href: '#settings' }, 'Unlock with Pro'));
    return card;
  }
  const add = el('button', { class: 'btn small', onclick: () => {
    const kind = el('select', {}, Object.entries(nw.kinds).map(([v, l]) => el('option', { value: v }, l)));
    const url = el('input', { type: 'url', autocomplete: 'off' }), user = el('input', { autocomplete: 'off', value: 'admin' }), secret = el('input', { type: 'password', autocomplete: 'new-password' });
    const region = el('select', {}, [['us', 'United States and most countries'], ['ca', 'Canada'], ['in', 'India'], ['cn', 'China']].map(([v, l]) => el('option', { value: v }, l)));
    const urlF = el('label', { class: 'field' }, el('span', {}), url), userF = el('label', { class: 'field' }, el('span', {}, 'User name'), user), secF = el('label', { class: 'field' }, el('span', {}), secret), regF = el('label', { class: 'field' }, el('span', {}, 'Dashboard region'), region);
    const help = el('p', { class: 'small muted' }), msg = el('p', { class: 'small', style: 'min-height:1.2em' });
    const sync = () => { const h = NET_HELP[kind.value]; urlF.hidden = !h[0]; if (h[0]) { urlF.firstChild.textContent = h[0]; url.placeholder = h[1]; } secF.firstChild.textContent = h[2]; userF.hidden = kind.value !== 'adguard'; regF.hidden = kind.value !== 'meraki'; help.textContent = h[3]; };
    kind.onchange = sync; sync();
    const save = el('button', { class: 'btn primary', onclick: async () => {
      save.disabled = true; msg.style.color = ''; msg.textContent = 'Connecting...';
      try { const r = await post('/api/network', { kind: kind.value, url: url.value, user: user.value, secret: secret.value, region: region.value }); m.remove(); toast(`${r.source.kindName} connected`); redraw(); }
      catch (e) { msg.textContent = e.message; msg.style.color = 'var(--bad)'; save.disabled = false; }
    } }, 'Connect');
    const m = modal(el('div', {}, el('label', { class: 'field' }, el('span', {}, 'What to connect'), kind), urlF, userF, regF, secF, help,
      el('p', { class: 'tiny muted' }, 'CasaTorch only reads - it never changes your network. The key or password is kept encrypted on this CasaTorch.'), msg, el('div', { class: 'row', style: 'justify-content:flex-end' }, save)), { title: 'Connect your network' });
  } }, icon('plus'), 'Connect');
  const rows = nw.sources.map((x) => {
    const bad = x.ok === false, down = (x.devices || []).filter((d) => !d.online);
    const del = el('button', { class: 'btn ghost small', 'aria-label': `Disconnect ${x.name}`, onclick: async () => { try { await api(`/api/network/${encodeURIComponent(x.id)}`, { method: 'DELETE' }); redraw(); } catch (e) { toast(e.message); } } }, icon('x'));
    const list = (x.devices || []).length ? el('details', { class: 'netdevs' }, el('summary', {}, `${x.devices.length} device${x.devices.length === 1 ? '' : 's'}${down.length ? ` - ${down.length} offline` : ''}`),
      el('div', { class: 'netgrid' }, [...down, ...x.devices.filter((d) => d.online)].map((d) => el('div', { class: 'netdev' }, el('span', { class: `dot ${d.online ? (d.alerting ? 'warn' : 'good') : 'bad'}` }), el('span', { class: 'ellipsis' }, d.name), el('span', { class: 'tiny muted ellipsis' }, [d.model, d.ip].filter(Boolean).join(' · ')))))) : null;
    return el('div', { class: 'netrow' },
      el('div', { class: 'row', style: 'gap:12px' }, el('span', { class: `dot ${bad ? 'bad' : x.summary?.offline || x.summary?.protection === false ? 'warn' : 'good'}` }),
        el('div', { class: 'grow' }, el('div', { class: 'row wrap', style: 'gap:8px' }, el('b', {}, x.name), x.name !== x.kindName ? el('span', { class: 'tiny muted' }, x.kindName) : null),
          el('div', { class: 'small muted' }, bad ? `Can't connect: ${x.error}` : netSummary(x))),
        nw.demo ? null : del),
      list);
  });
  const refresh = el('button', { class: 'btn ghost small', 'aria-label': 'Refresh', onclick: async () => { refresh.disabled = true; try { await post('/api/network/refresh'); redraw(); } catch (e) { toast(e.message); refresh.disabled = false; } } }, icon('reset'));
  card.append(el('div', { class: 'row between', style: 'margin-bottom:10px' }, head, el('div', { class: 'row', style: 'gap:6px' }, nw.sources.length ? refresh : null, add)),
    rows.length ? el('div', { class: 'netrows' }, rows) : el('p', { class: 'muted' }, 'Nothing connected yet. Connect UniFi, Cisco Meraki, Pi-hole or AdGuard Home.'));
  return card;
}
tab({ id: 'network', label: 'Network', icon: 'wifi', async render(main) {
  const draw = async () => {
    const [n, mo, nw] = await Promise.all([api('/api/internet'), api('/api/monitors').catch(() => ({ pro: false, monitors: [], max: 30 })), api('/api/network').catch(() => ({ pro: false, sources: [], kinds: {} }))]);
    mo.demo = nw.demo = !!S.status?.demo;
    const btn = el('button', { class: 'btn primary' }, icon('bolt'), 'Run a speed test');
    btn.onclick = async () => { btn.disabled = true; btn.lastChild.textContent = 'Testing (about 20 s)...'; try { await post('/api/internet/speedtest'); toast('Speed test done'); await draw(); } catch (err) { toast(err.message); btn.disabled = false; } };
    const net = el('div', { class: 'card' }, el('h2', {}, 'Internet'), el('div', { class: 'row' }, el('span', { class: `dot ${n.online ? 'good' : 'bad'}` }), el('b', {}, n.online ? 'Online' : 'Down')),
      el('dl', { class: 'kv', style: 'margin-top:12px' }, el('dt', {}, 'Provider'), el('dd', {}, n.provider || '-'), el('dt', {}, 'Public IP'), el('dd', {}, n.publicIp || '-'), el('dt', {}, 'Location'), el('dd', {}, n.city || '-'),
        el('dt', {}, 'Ping'), el('dd', {}, Object.entries(n.latencyMs || {}).map(([k, v]) => `${k} ${v == null ? '-' : `${v} ms`}`).join(' · '))));
    const sp = el('div', { class: 'card' }, el('h2', {}, 'Speed'), n.speed ? el('div', { class: 'row', style: 'gap:30px' }, el('div', { class: 'stat' }, el('span', { class: 'big' }, Math.round(n.speed.downMbps)), el('span', { class: 'lbl' }, 'Mbps down')), el('div', { class: 'stat' }, el('span', { class: 'big' }, Math.round(n.speed.upMbps)), el('span', { class: 'lbl' }, 'Mbps up'))) : el('p', { class: 'muted' }, 'No test yet.'),
      el('p', { class: 'small muted' }, n.speed ? `Tested ${fmtWhen(n.speed.at)}. CasaTorch tests every 4 hours.` : 'CasaTorch tests every 4 hours.'), btn);
    const lan = el('div', { class: 'card' }, el('h2', {}, 'Home network'), el('dl', { class: 'kv' }, el('dt', {}, 'Router'), el('dd', {}, n.gateway || '-'), el('dt', {}, 'Devices seen'), el('dd', {}, n.lanDevices ?? '-'), el('dt', {}, 'This box'), el('dd', {}, n.host || '-')),
      el('p', { class: 'small muted' }, 'Using UniFi, Cisco Meraki, Pi-hole or AdGuard Home? Connect it below (Pro).'));
    main.replaceChildren(el('div', { class: 'cards' }, net, sp, lan), networkCard(nw, draw), serversCard(mo, draw));
  };
  await draw(); return draw;
} });

/* ---- Energy ---- */
/* Daily energy as bars (today is lighter: it isn't over yet). Plain SVG so it works offline and on old tablets. */
function historyChart(days, money) {
  const box = el('div', { class: 'hist-chart' });
  const paint = () => {
    const W = Math.max(260, box.clientWidth || 600), H = W < 500 ? 150 : 190, padL = 50, padB = 22, padT = 10, n = days.length, max = Math.max(1, ...days.map((d) => d.kwh || 0));
    const top = Math.ceil(max / 5) * 5, bw = (W - padL) / n, y = (v) => padT + (H - padT - padB) * (1 - v / top);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Energy per day for the last ${n} days, up to ${top} kWh`);
    const add = (tag, attrs, text) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.append(e); return e; };
    for (const v of [0, top / 2, top]) { add('line', { x1: padL, x2: W, y1: y(v), y2: y(v), class: 'grid' }); add('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, v === top ? `${v} kWh` : `${v}`); }
    days.forEach((d, i) => {
      if (d.kwh == null) return;
      const x = padL + i * bw + bw * 0.16, h = Math.max(1, y(0) - y(d.kwh));
      const r = add('rect', { x, y: y(d.kwh), width: Math.max(1, bw * 0.68), height: h, rx: Math.min(3, bw * 0.2), class: d.partial ? 'bar partial' : 'bar' });
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = `${fmt(`${d.date}T12:00:00Z`, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}: ${d.kwh} kWh${d.cost != null ? ` (${money(d.cost)})` : ''}${d.partial ? ' so far today' : ''}${d.peakW ? ` · peak ${(d.peakW / 1000).toFixed(1)} kW` : ''}`;
      r.append(t);
    });
    const lab = (i, anchor) => add('text', { x: anchor === 'start' ? padL + i * bw : anchor === 'end' ? padL + (i + 1) * bw : padL + i * bw + bw / 2, y: H - 5, 'text-anchor': anchor, class: 'axis' }, fmt(`${days[i].date}T12:00:00Z`, { month: 'short', day: 'numeric', timeZone: 'UTC' }));
    lab(0, 'start'); lab(n - 1, 'end'); if (n > 10 && W > 420) lab(Math.floor(n / 2), 'middle');
    box.replaceChildren(svg);
  };
  let lastW = 0;
  const ro = new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) > 4) { lastW = box.clientWidth; paint(); } });
  ro.observe(box);
  return box;
}
function reportCard(rep, money, redraw) {
  const card = el('div', { class: 'card report' });
  const head = el('h2', {}, 'Weekly report', el('span', { class: 'pill pro' }, 'Pro'));
  if (!rep.pro) {
    card.append(head, el('p', { class: 'muted' }, 'Every Monday, a short summary of the week: energy and what it cost, what stays on all night, the alerts and the internet - with a few tips. Written by your own AI if you connect one.'), el('a', { class: 'btn primary', href: '#settings' }, 'Unlock with Pro'));
    return card;
  }
  const list = rep.reports || []; let i = 0;
  const body = el('div');
  const makeNow = el('button', { class: 'btn small', onclick: async () => {
    makeNow.disabled = true; makeNow.textContent = 'Writing your report...';
    try { await post('/api/reports/now'); toast('Report ready'); redraw(); } catch (e) { toast(e.message); makeNow.disabled = false; makeNow.textContent = 'Make one now'; }
  } }, 'Make one now');
  const weekly = el('input', { type: 'checkbox', checked: rep.weekly, style: 'width:auto', onchange: async () => { try { await post('/api/reports/settings', { weekly: weekly.checked }, 'PUT'); toast(weekly.checked ? 'You\'ll get a report every Monday morning' : 'Weekly report off'); } catch (e) { weekly.checked = !weekly.checked; toast(e.message); } } });
  const pick = list.length > 1 ? el('select', { style: 'width:auto', 'aria-label': 'Earlier reports', onchange: () => { i = Number(pick.value); show(); } }, list.map((r, k) => el('option', { value: k }, r.title.replace(/^Your week: /, '')))) : null;
  const show = () => {
    const r = list[i];
    if (!r) { body.replaceChildren(el('p', { class: 'muted' }, 'Your first report arrives Monday morning, once CasaTorch has a few days of history. Or make one now.')); return; }
    const s = r.stats, chg = s.changePct;
    const chip = (v, l) => el('div', { class: 'rstat' }, el('b', {}, v), el('span', {}, l));
    body.replaceChildren(...[
      el('div', { class: 'row between wrap' }, el('div', { class: 'rtitle' }, r.title), el('div', { class: 'tiny muted' }, r.by === 'ai' ? 'Written by your AI' : 'Written by CasaTorch', ' · ', ago(r.at))),
      el('p', { class: 'rsum' }, r.summary),
      el('div', { class: 'rstats' }, chip(`${s.kwh} kWh`, s.cost != null ? money(s.cost) : 'this week'), chg != null ? chip(`${chg > 0 ? '+' : ''}${chg}%`, 'vs the week before') : null, s.alwaysOnW ? chip(`${s.alwaysOnW} W`, 'on all night') : null, chip(String((s.alerts.critical || 0) + (s.alerts.warning || 0)), 'warnings or worse')),
      r.tips?.length ? el('ul', { class: 'rtips' }, r.tips.map((t) => el('li', {}, t))) : null,
      s.topDevices?.length ? el('details', { class: 'rmore' }, el('summary', {}, 'Biggest users this week'), el('div', { class: 'bars', style: 'margin-top:10px' }, s.topDevices.map((d) => el('div', { class: 'bar-row' }, el('span', { class: 'ellipsis' }, d.name), el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(d.kwh / s.topDevices[0].kwh) * 100}%` })), el('span', { class: 'num', style: 'text-align:right' }, `${d.kwh} kWh`))))) : null,
      r.note ? el('p', { class: 'tiny muted' }, r.note) : null].filter(Boolean));
  };
  show();
  card.append(el('div', { class: 'row between wrap', style: 'margin-bottom:12px' }, head, el('div', { class: 'row wrap', style: 'gap:8px' }, pick, makeNow)), body,
    el('label', { class: 'row small muted', style: 'margin-top:14px;gap:8px' }, weekly, 'Send it every Monday morning (as a phone alert)'),
    rep.ai ? null : el('p', { class: 'tiny muted', style: 'margin-top:6px' }, 'Connect an AI in Settings > Ask the house and the report is written by it, with tips in plain words.'));
  return card;
}
tab({ id: 'energy', label: 'Energy', icon: 'bolt', async render(main) {
  let span = 30;
  const draw = async () => {
    const [{ devices = [], power }, st, h, rep] = await Promise.all([api('/api/devices'), api('/api/settings').catch(() => ({})), api(`/api/history?days=${Math.max(span, 15)}`).catch(() => null), api('/api/reports').catch(() => ({ pro: false, reports: [] }))]);
    const rate = st.energy?.ratePerKwh, cur = st.energy?.currency || 'USD';
    const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v);
    const ds = devices.filter((d) => typeof d.powerW === 'number' && !d.pairedTo).sort((a, b) => b.powerW - a.powerW);
    const total = power?.watts ?? ds.reduce((s, d) => s + d.powerW, 0), max = Math.max(1, ...ds.map((d) => d.powerW));
    const all = h?.days || [], days = all.slice(-span), have = days.filter((d) => d.kwh != null);
    const full = all.filter((d) => !d.partial), last7 = full.slice(-7).filter((d) => d.kwh != null), prev7 = full.slice(-14, -7).filter((d) => d.kwh != null);
    const sum = (a) => a.reduce((s, d) => s + d.kwh, 0), wk = sum(last7), pw = prev7.length >= 5 ? sum(prev7) : null;
    const spans = h?.pro ? [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']] : [[7, '7 days']];
    const seg = el('div', { class: 'seg' }, spans.map(([v, l]) => el('button', { class: v === Math.min(span, h?.maxDays || 7) ? 'on' : '', onclick: () => { span = v; draw(); } }, l)));
    const histCard = el('div', { class: 'card', style: 'margin-top:14px' },
      el('div', { class: 'row between wrap', style: 'margin-bottom:6px' }, el('h2', { style: 'margin:0' }, 'History'), seg),
      have.length ? el('div', {},
        el('div', { class: 'row wrap', style: 'gap:22px;margin:8px 0 6px' },
          el('div', {}, el('div', { class: 'num', style: 'font-size:22px;font-weight:700' }, `${wk.toFixed(1)} kWh`), el('div', { class: 'tiny muted' }, `${last7.length === 7 ? 'last 7 full days' : `last ${last7.length} full day${last7.length === 1 ? '' : 's'}`}${rate ? ` · ${money(wk * rate)}` : ''}`)),
          pw ? el('div', {}, el('div', { class: 'num', style: 'font-size:22px;font-weight:700' }, `${wk >= pw ? '+' : ''}${Math.round((wk - pw) / pw * 100)}%`), el('div', { class: 'tiny muted' }, 'vs the 7 days before')) : null,
          h.forecast ? el('div', { title: `${h.forecast.kwhSoFar} kWh so far this month; about ${h.forecast.avgKwhPerDay} kWh a day lately${h.forecast.missingDays ? `; ${h.forecast.missingDays} day(s) this month before CasaTorch was running aren't counted` : ''}` },
            el('div', { class: 'num', style: `font-size:22px;font-weight:700${h.forecast.overBudget ? ';color:var(--warn)' : ''}` }, h.forecast.cost != null ? `~${money(h.forecast.cost)}` : `~${h.forecast.kwh} kWh`),
            el('div', { class: 'tiny muted' }, `this month, forecast${h.forecast.budget && h.forecast.cost != null ? ` · budget ${money(h.forecast.budget)}` : ''}${h.forecast.prevMonthCost != null ? ` · last month ${money(h.forecast.prevMonthCost)}` : ''}`)) : null),
        historyChart(days, money),
        h.pro ? null : el('p', { class: 'tiny muted', style: 'margin-top:8px' }, 'Basic keeps 7 days. Pro keeps 2 years.'))
        : el('p', { class: 'muted' }, 'CasaTorch notes what the house uses every 5 minutes. The first day of history shows here tomorrow.'));
    main.replaceChildren(el('div', { class: 'cards' },
      el('div', { class: 'card' }, el('h2', {}, 'Using now'), el('div', { class: 'big' }, `${Math.round(total)} W`), el('div', { class: 'muted small', style: 'margin-top:6px' }, `on ${ds.length} metered device${ds.length === 1 ? '' : 's'}`)),
      el('div', { class: 'card' }, el('h2', {}, 'If it stays like this'), rate ? el('div', {}, el('div', { class: 'big' }, money(total / 1000 * 24 * rate)), el('div', { class: 'muted small', style: 'margin-top:6px' }, `a day · ${money(total / 1000 * 24 * 30 * rate)} a month at ${money(rate)}/kWh`)) : el('p', { class: 'muted' }, 'Add your electricity rate in Settings to see the cost.'))),
    histCard,
    el('div', { style: 'margin-top:14px' }, reportCard(rep, money, draw)),
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
