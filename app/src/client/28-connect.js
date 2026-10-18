/* ======================================================================
 * Connect: every brand and service CasaTorch works with, in one gallery -
 * what is connected, what is one click away, and what comes through Home
 * Assistant. "Connect" opens the guided setup at exactly that item, so
 * adding gear is always point-and-click (no command line, no config files).
 * The list is the setup wizard's own catalog: add gear there, it shows here.
 * ====================================================================== */
const CONNECT_GROUPS = [['all', 'All'], ['day', 'Your day'], ['cameras', 'Cameras & doorbells'], ['controls', 'Lights, locks & climate'], ['sensors', 'Sensors'], ['network', 'Network'], ['energy', 'Energy & solar']];
const cleanLabel = (s) => String(s).replace(/\s*\((through|via) Home Assistant\)/i, '').trim();
function connectItems(cat) {
  const byId = new Map(), add = (it, group) => { const have = byId.get(it.key); if (have) { if (!have.groups.includes(group)) have.groups.push(group); for (const k of ['haAdd', 'domain']) have[k] ||= it[k]; have.alsoHa ||= it.alsoHa; have.ids = [...new Set([...have.ids, ...it.ids])]; return; } byId.set(it.key, { ...it, groups: [group] }); };
  const step = (id) => cat.steps.find((s) => s.id === id);
  add({ key: 'calendars', step: 'calendars', label: T('Calendars'), desc: T('Google, iCloud, Outlook - any calendar link, plus CasaTorch\'s own family calendar'), how: 'direct', ids: ['calendars'] }, 'day');
  add({ key: 'sports', step: 'sports', label: T('Your teams'), desc: T('Live scores and next games for NFL, NBA, MLB, NHL, MLS, college and more'), how: 'direct', ids: ['sports'] }, 'day');
  add({ key: 'news', step: 'news', label: T('Headlines'), desc: T('Pick news sources or add any RSS feed'), how: 'direct', ids: ['news'] }, 'day');
  add({ key: 'reminders', label: T('Reminders'), desc: T('Your home\'s reminders: trash night, the dog\'s dinner, bills due'), how: 'direct', href: '#reminders', ids: ['reminders'] }, 'day');
  for (const g of ['cameras', 'controls', 'sensors', 'energy']) {
    const opts = step(g)?.branches?.yes?.pick?.options || [];
    for (const o of opts) {
      if (o.method === 'guide') continue;
      if (opts.some((x) => x.haTwin === o.id)) continue;   // the Home Assistant twin of a direct option: merged into it
      const twin = o.haTwin ? opts.find((x) => x.id === o.haTwin) : null;
      const how = o.method === 'ring' ? 'pro' : ['ha', 'ha-ui'].includes(o.method) ? 'ha' : 'direct';
      add({ key: o.haTwin || o.domain || o.id, step: g, add: o.id, haAdd: twin?.id || null, domain: twin?.domain || o.domain || null, label: cleanLabel(o.label).replace(/\s*\((needs [^)]*)\)/i, ''), desc: o.desc || o.hint || (o.label.match(/\((needs [^)]*)\)/i)?.[1] || '').replace(/^n/, 'N'), how, alsoHa: !!twin, ids: [o.id, twin?.id].filter(Boolean) }, g);
    }
  }
  const util = step('energy')?.branches?.yes?.provider;
  if (util) add({ key: util.domain, step: 'energy', add: 'utility', domain: util.domain, label: T('Your power company'), desc: T('Your real bill and usage from 100+ utilities'), how: 'ha', ids: ['energy'] }, 'energy');
  const net = step('network');
  for (const [v, l] of net?.question?.options || []) {
    if (['isp', 'other'].includes(v)) continue;
    const note = net.branches?.[v]?.note || '';
    add({ key: `net-${v}`, step: 'network', add: v, label: l, desc: /planned|coming/i.test(note) ? T('Coming to Pro - internet status and speed tests work today') : note ? note.replace(/^CasaTorch will /, 'Shows ').replace(/, so CasaTorch shows/, ' - CasaTorch shows') : T('Every device on your network, Wi-Fi health and alerts'), how: /planned|coming/i.test(note) ? 'soon' : 'direct', ids: [v] }, 'network');
  }
  add({ key: 'pihole', step: 'network', add: 'dns:pihole', label: T('Pi-hole'), desc: T('Coming to Pro: ads blocked and devices seen'), how: 'soon', ids: ['pihole'] }, 'network');
  add({ key: 'adguard', step: 'network', add: 'dns:adguard', label: T('AdGuard Home'), desc: T('Coming to Pro: ads blocked and devices seen'), how: 'soon', ids: ['adguard'] }, 'network');
  return [...byId.values()];
}
const hueOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const monogram = (label) => el('span', { class: 'mono', style: `--h:${hueOf(label)}` }, label.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase());
async function startConnect(item, conn) {
  const me = await api('/api/auth/me').catch(() => null);
  const needPw = me && me.signIn !== false, admin = !needPw || ['owner', 'admin'].includes(me.user?.role);
  const viaHa = item.how === 'ha' || (item.alsoHa && conn.ha.connected);
  const toHaFirst = item.how === 'ha' && !conn.ha.connected;
  const step = toHaFirst ? 'homeassistant' : item.step, addId = toHaFirst ? '' : viaHa && item.haAdd ? item.haAdd : item.add || '';
  if (!admin) return modal(el('p', {}, T('Only an owner or admin can connect new gear. Ask them to open Connect on their screen.')), { title: T('Connect {label}', { label: item.label }) });
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: T('Your CasaTorch password') });
  const msg = el('div', { class: 'small', style: 'color:var(--bad);min-height:18px' });
  const go = async () => {
    try { await post('/api/settings/rerun-setup', { password: pw.value }); location.href = `/setup.html?step=${encodeURIComponent(step)}${addId ? `&add=${encodeURIComponent(addId)}` : ''}`; }
    catch (err) { msg.textContent = err.message; }
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const steps = [
    toHaFirst ? T('{label} connects through Home Assistant, so we\'ll connect Home Assistant first - you just sign in with your Home Assistant account.', { label: item.label }) : T(viaHa ? 'The guided setup opens right at {label}, and CasaTorch adds it to Home Assistant for you.' : 'The guided setup opens right at {label}.', { label: item.label }),
    T('Answer a question or two, press Test, and you\'ll see a green check when it works.'),
    T('Save. Everything it brings in is ready under Add widget > Rooms & devices.'),
  ];
  const m = modal(el('div', {}, el('ol', { class: 'connect-steps' }, steps.map((s) => el('li', {}, s))),
    el('p', { class: 'small muted' }, T('Nothing to install and no command line. Your other settings stay exactly as they are.')),
    needPw ? el('label', { class: 'field' }, el('span', {}, T('Confirm it\'s you')), pw) : null, msg,
    el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')), el('button', { class: 'btn primary', onclick: go }, T('Start guided setup')))),
  { title: T('Connect {label}', { label: item.label }) });
  if (needPw) setTimeout(() => pw.focus(), 50);
}
/* ---- Home Assistant's own setup questions, asked here (owner/admin) ---- */
const HA_FIELD = { username: 'Username', password: 'Password', host: 'Address (IP or name)', api_key: 'API key', email: 'E-mail', port: 'Port', pin: 'PIN', code: 'Code', name: 'Name', verify_ssl: 'Check the security certificate' };
const HA_ERR = { invalid_auth: 'Wrong username or password.', cannot_connect: 'Could not reach it - check the address and that it is turned on.', unknown: 'Something went wrong in Home Assistant.', invalid_host: 'That address is not right.', timeout_connect: 'It did not answer in time.' };
const HA_ABORT = { already_configured: 'Already in Home Assistant ✓', already_in_progress: 'Already being set up in Home Assistant - finish it there or try again in a minute.', single_instance_allowed: 'Already in Home Assistant ✓', no_devices_found: 'None found on your network.', not_supported: 'This Home Assistant does not support it.', reauth_successful: 'Signed in again ✓' };
function haFlowModal({ domain, flowId, label }, onDone) {
  const body = el('div', { class: 'haflow' }); let v = null, closed = false;
  const m = modal(body, { title: T('Add {label}', { label }) });
  const obs = new MutationObserver(() => { if (!m.isConnected) { closed = true; obs.disconnect(); if (v?.flowId && !['create_entry', 'abort'].includes(v.type)) api(`/api/ha/flow/${encodeURIComponent(v.flowId)}`, { method: 'DELETE' }).catch(() => {}); } });
  obs.observe(document.body, { childList: true, subtree: true });
  const wait = (t) => body.replaceChildren(el('p', { class: 'muted' }, t));
  const run = async (p) => { try { v = await p; } catch (e) { v = { type: 'error', error: e.message }; } if (!closed) draw(); };
  const send = (input) => { wait(T('Working…')); run(post(`/api/ha/flow/${encodeURIComponent(v.flowId)}`, { input })); };
  function field(f, input) {
    const name = f.name, sel = f.selector || {}, lab = T(HA_FIELD[name] || pretty(name)), req = !!f.required && !f.optional;
    if (f.type === 'constant') return null;
    if (sel.boolean || f.type === 'boolean') { input[name] ??= !!f.default; return el('label', { class: 'field check' }, el('input', { type: 'checkbox', checked: input[name] || null, onchange: (e) => { input[name] = e.target.checked; } }), lab); }
    if (sel.select || f.type === 'select') {
      const raw = sel.select?.options || f.options || [], opts = Array.isArray(raw) ? raw.map((o) => (Array.isArray(o) ? o : typeof o === 'object' ? [o.value, o.label] : [o, o])) : Object.entries(raw);
      input[name] ??= f.default ?? (req ? opts[0]?.[0] : '');
      return el('label', { class: 'field' }, el('span', {}, lab), el('select', { onchange: (e) => { input[name] = e.target.value; } }, ...(req ? [] : [el('option', { value: '' }, '-')]), ...opts.map(([val, t]) => el('option', { value: val, selected: String(input[name]) === String(val) ? true : null }, t))));
    }
    const secret = sel.text?.type === 'password' || /password|secret|token|key/i.test(name), numeric = sel.number || ['integer', 'float'].includes(f.type);
    if (f.default != null) input[name] ??= f.default;
    return el('label', { class: 'field' }, el('span', {}, `${lab}${req ? '' : T(' (optional)')}`), el('input', { type: secret ? 'password' : numeric ? 'number' : 'text', value: input[name] ?? '', autocomplete: secret ? 'new-password' : 'off', oninput: (e) => { input[name] = numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; } }));
  }
  function draw() {
    body.replaceChildren();
    if (v.type === 'error') return body.append(el('p', { class: 'bad' }, `✗ ${v.error}`), el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn', onclick: () => m.remove() }, T('Close'))));
    if (v.type === 'create_entry') { onDone?.(); return body.append(el('p', { class: 'good' }, `✓ ${v.title ? T('Added to Home Assistant: {title}.', { title: v.title }) : T('Added to Home Assistant.')}`), el('p', { class: 'muted small' }, T('Its devices show up in CasaTorch within a minute - add them from Add widget › Rooms & devices.')), el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn primary', onclick: () => m.remove() }, T('Done')))); }
    if (v.type === 'abort') { const ok = (HA_ABORT[v.reason] || '').includes('✓'); if (ok) onDone?.(); return body.append(el('p', { class: ok ? 'good' : 'bad' }, (HA_ABORT[v.reason] ? T(HA_ABORT[v.reason]) : T('Home Assistant stopped: {reason}', { reason: pretty(v.reason) }))), el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn', onclick: () => m.remove() }, T('Close')))); }
    if (v.type === 'external') return body.append(el('p', {}, T('{label} needs you to sign in on its own page. It opens in a new tab - come back here when it says you\'re done.', { label })),
      el('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' }, el('a', { class: 'btn', href: safeHref(v.url), target: '_blank', rel: 'noopener' }, T('Open the sign-in page')), el('button', { class: 'btn primary', onclick: () => send({}) }, T('I\'ve signed in'))));
    if (v.type === 'progress') { wait(T('Home Assistant is working on it…')); setTimeout(() => { if (!closed) run(api(`/api/ha/flow/${encodeURIComponent(v.flowId)}`)); }, 2500); return; }
    if (v.type === 'menu') { const opts = Array.isArray(v.menu) ? v.menu.map((x) => [x, pretty(x)]) : Object.entries(v.menu || {}); return body.append(el('p', {}, T('Choose one:')), el('div', { class: 'col', style: 'gap:8px' }, ...opts.map(([id, t]) => el('button', { class: 'btn', onclick: () => { wait(T('Working…')); run(post(`/api/ha/flow/${encodeURIComponent(v.flowId)}`, { input: { next_step_id: id } })); } }, t)))); }
    const input = {}, fields = (v.fields || []).map((f) => field(f, input)).filter(Boolean), ph = v.placeholders || {};
    if (!fields.length) body.append(el('p', {}, ph.name ? T('Add {name} to Home Assistant?', { name: ph.name }) : T('Add {label} to Home Assistant?', { label })));
    else if (v.step && !['user', 'zeroconf_confirm', 'confirm'].includes(v.step)) body.append(el('p', { class: 'muted small' }, pretty(v.step)));
    for (const [k, e] of Object.entries(v.errors || {})) body.append(el('p', { class: 'bad small' }, `${k === 'base' ? '' : `${T(HA_FIELD[k] || pretty(k))}: `}${T(HA_ERR[e] || pretty(e))}`));
    const msg = el('p', { class: 'bad small' });
    body.append(...fields, msg, el('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' },
      el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')),
      el('button', { class: 'btn primary', onclick: () => {
        const out = {};
        for (const f of v.fields || []) { const val = input[f.name]; if (val === '' || val == null) { if (f.required && !f.optional && f.type !== 'constant') { msg.textContent = T('{field} is needed.', { field: T(HA_FIELD[f.name] || pretty(f.name)) }); return; } continue; } out[f.name] = val; }
        send(out);
      } }, v.last === false ? T('Next') : fields.length ? T('Connect') : T('Add'))));
    body.querySelector('input')?.focus();
  }
  wait(T('Asking Home Assistant…'));
  run(flowId ? api(`/api/ha/flow/${encodeURIComponent(flowId)}`) : post('/api/ha/flow', { domain }));
}
/* "Found on your network" and "Add any Home Assistant integration" - shown when Home Assistant is connected. */
const HA_DOMAIN_NAMES = { ipp: 'Printer', cast: 'Google Cast', dlna_dmr: 'DLNA', upnp: 'UPnP', sonos: 'Sonos', homekit_controller: 'HomeKit', esphome: 'ESPHome', zha: 'Zigbee', mqtt: 'MQTT' };
async function haDiscoveredCard(conn) {
  const box = el('div', { class: 'card ha-found' }), list = el('div', { class: 'ha-found-list' });
  const load = async () => {
    let r; try { r = await api('/api/ha/discovered'); } catch (e) { box.hidden = /admin|403/i.test(e.body?.error || e.message); list.replaceChildren(el('p', { class: 'muted small' }, T('Could not ask Home Assistant: {message}', { message: e.message }))); return; }
    list.replaceChildren(...(r.found.length ? r.found.map((f) => el('div', { class: 'ha-found-row' }, monogram(f.name || f.domain), el('div', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block' }, f.name || pretty(f.domain)), el('small', { class: 'muted' }, `${T(HA_DOMAIN_NAMES[f.domain] || pretty(f.domain))} · ${T('found by Home Assistant')}`)),
      el('button', { class: 'btn small ghost', title: T('Don\'t show this again'), onclick: async () => { await post('/api/ha/discovered/ignore', { key: f.key }).catch(() => {}); load(); } }, T('Hide')),
      el('button', { class: 'btn small primary', onclick: () => haFlowModal({ flowId: f.flowId, domain: f.domain, label: f.name || pretty(f.domain) }, load) }, T('Add'))))
      : [el('p', { class: 'muted small' }, T('Nothing new right now. When Home Assistant spots a new device on your network - a TV, speaker, printer or hub - it shows up here, ready to add.'))]));
  };
  box.append(el('div', { class: 'row wrap', style: 'gap:10px;align-items:center;margin-bottom:8px' }, icon('search', 18), el('b', { class: 'grow' }, T('Found on your network')), el('button', { class: 'btn small', onclick: () => haAnyModal(conn, load) }, icon('plus'), T('Add any Home Assistant integration'))), list);
  load(); return box;
}
async function haAnyModal(conn, after) {
  const q = el('input', { type: 'search', placeholder: T('Search - e.g. Sonos, Tesla, Lutron, Roku'), 'aria-label': T('Search Home Assistant integrations') }), out = el('div', { class: 'ha-any-list' });
  const m = modal(el('div', {}, el('p', { class: 'muted small', style: 'margin-top:0' }, T('Everything your Home Assistant can add. Pick one and answer its questions here - usually an address, or a sign-in.')), q, out), { title: T('Add a Home Assistant integration'), wide: true });
  out.append(el('p', { class: 'muted' }, T('Loading…')));
  let r; try { r = await api('/api/ha/integrations'); } catch (e) { out.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
  const have = new Set(r.have || []);
  const draw = () => {
    const t = q.value.trim().toLowerCase(), hits = r.list.filter((x) => !t || `${x.name} ${x.domain}`.toLowerCase().includes(t)).slice(0, 60);
    out.replaceChildren(...hits.map((x) => el('button', { class: 'ha-any-row', onclick: () => { m.remove(); haFlowModal({ domain: x.domain, label: x.name }, after); } }, monogram(x.name), el('span', { class: 'grow' }, x.name), have.has(x.domain) ? el('span', { class: 'pill' }, T('added')) : null, x.cloud ? el('span', { class: 'pill' }, T('cloud')) : null)),
      hits.length ? null : el('p', { class: 'muted small' }, T('Nothing by that name. Some brands are added through HACS (Home Assistant\'s community store) - that part happens in Home Assistant.')));
  };
  q.oninput = draw; draw(); setTimeout(() => q.focus(), 50);
}
tab({ id: 'connect', label: 'Connect', icon: 'plug', async render(main) {
  setTop(T('Connect'), T('Everything CasaTorch works with - add anything in a few clicks'));
  const [cat, conn, reg] = await Promise.all([api('/api/catalog'), api('/api/connections').catch(() => ({ ha: {}, domains: [], direct: [], counts: {} })), api('/api/integrations').catch(() => ({ integrations: [] }))]);
  // Integrations registered in the app (integration() on the server) show up here by themselves, standing in
  // for any catalog card they replace.
  const replaced = new Set(reg.integrations.flatMap((r) => r.replaces));
  const items = [...connectItems(cat).filter((it) => !replaced.has(it.key)),
    ...reg.integrations.map((r) => ({ key: r.id, label: r.label, desc: r.desc, how: r.how, groups: [r.group], href: r.href, step: r.step, add: r.add, ids: [r.id], connected: r.connected, devices: r.devices }))];
  const isOn = (it) => !!it.connected || it.ids.some((id) => conn.direct.includes(id)) || (it.domain && conn.domains.includes(it.domain));
  const total = Object.values(conn.counts || {}).reduce((s, n) => s + n, 0), fromHa = conn.counts?.ha || 0, live = items.filter(isOn).length;
  const ha = conn.ha?.connected;
  main.append(el('div', { class: 'connect-hero card' },
    el('div', { class: 'ha-mark' }, icon('home', 26)),
    el('div', { class: 'grow' }, el('div', { class: 'connect-hero-title' }, ha ? T('Home Assistant is connected') : T('Got Home Assistant? Connect it once and everything comes with it.')),
      el('p', { class: 'muted', style: 'margin:0' }, ha ? T('{fromHa} entities - every light, sensor, lock, camera and room - are available as widgets automatically. New ones appear on their own.', { fromHa }) : T('Many brands need it - Matter, Zigbee, Z-Wave, ecobee, Nest, Lutron, Kasa, solar and your power company. Connect it once and everything you have in it, every entity and every room, shows up here as ready-made widgets.'))),
    el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, ha ? el('a', { class: 'btn primary', href: '#home', onclick: () => setTimeout(() => toast(T('Press Add widget > Rooms & devices')), 400) }, icon('plus'), T('Add Home Assistant widgets'))
      : el('button', { class: 'btn primary', onclick: () => startConnect({ label: 'Home Assistant', step: 'homeassistant', how: 'direct' }, conn) }, T('Connect Home Assistant')),
      ha ? null : el('a', { class: 'btn', href: 'https://www.home-assistant.io/green', target: '_blank', rel: 'noopener' }, T('Don\'t have it? Home Assistant Green')))));
  main.append(el('div', { class: 'connect-stats' }, el('div', {}, el('b', {}, live), el('span', {}, T('connected'))), el('div', {}, el('b', {}, total), el('span', {}, T('devices'))), el('div', {}, el('b', {}, fromHa), el('span', {}, T('from Home Assistant'))), el('div', {}, el('b', {}, items.length), el('span', {}, T('brands & services built in')))));
  if (ha) main.append(await haDiscoveredCard(conn));
  let group = 'all', filter = 'any';
  const q = el('input', { type: 'search', placeholder: T('Search brands - Ring, Hue, Meraki, ecobee…'), 'aria-label': T('Search integrations') });
  const chips = el('div', { class: 'chips' }), grid = el('div', { class: 'connect-grid' });
  /* Remove a brand set up in setup - asked right on the card (no pop-up), then gone from CasaTorch. */
  const REMOVE_IDS = ['hue-local', 'shelly-local', 'yolink-cloud', 'ring-labs', 'frigate', 'reolink-local', 'snapshot'];
  const removeBtn = (it, conn, redraw) => {
    const id = it.ids.find((x) => REMOVE_IDS.includes(x) && conn.direct.includes(x)); if (!id) return null;
    const wrap = el('span', { class: 'rm' });
    const ask = () => wrap.replaceChildren(el('span', { class: 'small' }, T('Remove {label}? Its settings and keys are deleted from CasaTorch.', { label: it.label })),
      el('button', { class: 'btn small danger', onclick: async () => { try { await api(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }); conn.direct = conn.direct.filter((x) => x !== id); toast(`${it.label} removed`); redraw(); } catch (e) { toast(e.message, 4000); } } }, T('Remove')),
      el('button', { class: 'btn small ghost', onclick: () => wrap.replaceChildren(btn) }, T('Keep')));
    const btn = el('button', { class: 'btn small ghost', onclick: ask }, T('Remove'));
    wrap.append(btn); return wrap;
  };
  const card = (it) => {
    const on = isOn(it);
    const tag = it.how === 'soon' ? el('span', { class: 'pill' }, T('Coming soon')) : it.how === 'pro' ? el('span', { class: 'pill pro' }, 'Pro') : it.how === 'ha' ? el('span', { class: 'pill ha' }, ha ? T('via Home Assistant') : T('needs Home Assistant')) : it.alsoHa ? el('span', { class: 'pill' }, T('Direct or via HA')) : el('span', { class: 'pill' }, T('Direct'));
    return el('div', { class: `connect-card${on ? ' on' : ''}` },
      el('div', { class: 'row', style: 'gap:12px;align-items:center' }, monogram(it.label), el('div', { style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block' }, it.label), el('div', { class: 'row', style: 'gap:6px;margin-top:3px' }, on ? el('span', { class: 'pill good' }, T('✓ Connected')) : null, tag))),
      el('p', { class: 'small muted' }, it.desc ? T(it.desc) : ''),
      it.how === 'soon' ? el('button', { class: 'btn small', disabled: true }, T('Coming soon')) : it.href ? el('a', { class: `btn small${on ? '' : ' primary'}`, href: it.href }, on ? T('Open') : T('Connect')) : el('button', { class: `btn small${on ? '' : ' primary'}`, onclick: () => startConnect(it, conn) }, on ? T('Change') : it.how === 'ha' && !ha ? T('Set up') : T('Connect')),
      on ? removeBtn(it, conn, draw) : null);
  };
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    chips.replaceChildren(...CONNECT_GROUPS.map(([g, l]) => el('button', { class: `chip${g === group ? ' on' : ''}`, onclick: () => { group = g; draw(); } }, T(l))),
      el('span', { class: 'grow' }), ...[['any', 'Everything'], ['on', 'Connected']].map(([f, l]) => el('button', { class: `chip${f === filter ? ' on' : ''}`, onclick: () => { filter = f; draw(); } }, l)));
    const shown = items.filter((it) => (group === 'all' || it.groups.includes(group)) && (filter === 'any' || isOn(it)) && (!t || `${it.label} ${it.desc} ${it.domain || ''}`.toLowerCase().includes(t)));
    shown.sort((a, b) => isOn(b) - isOn(a) || (a.how === 'soon') - (b.how === 'soon'));
    grid.replaceChildren(...shown.map(card), el('div', { class: 'connect-card more' }, el('b', {}, T('Don\'t see yours?')),
      el('p', { class: 'small muted' }, ha ? T('Add it in Home Assistant and it appears in CasaTorch by itself - devices, rooms and all.') : T('Anything Home Assistant supports - over 3,000 brands - works in CasaTorch automatically once Home Assistant is connected.')),
      el('a', { class: 'btn small', href: 'mailto:support@casatorch.com?subject=Please%20add%20an%20integration' }, T('Ask us to add it'))));   // scrub-ok: public support address
  };
  q.oninput = draw; draw();
  main.append(el('div', { class: 'row', style: 'gap:12px;margin:18px 0 12px;flex-wrap:wrap' }, el('div', { style: 'flex:1;min-width:220px;max-width:420px' }, q)), chips, grid);
} });
