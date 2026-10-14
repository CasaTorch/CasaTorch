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
  add({ key: 'calendars', step: 'calendars', label: 'Calendars', desc: 'Google, iCloud, Outlook - any calendar link, plus CasaTorch\'s own family calendar', how: 'direct', ids: ['calendars'] }, 'day');
  add({ key: 'sports', step: 'sports', label: 'Your teams', desc: 'Live scores and next games for NFL, NBA, MLB, NHL, MLS, college and more', how: 'direct', ids: ['sports'] }, 'day');
  add({ key: 'news', step: 'news', label: 'Headlines', desc: 'Pick news sources or add any RSS feed', how: 'direct', ids: ['news'] }, 'day');
  add({ key: 'reminders', step: 'reminders', label: 'Reminders', desc: 'Trash night, medicine, anything that repeats', how: 'direct', ids: ['reminders'] }, 'day');
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
  if (util) add({ key: util.domain, step: 'energy', add: 'utility', domain: util.domain, label: 'Your power company', desc: 'Your real bill and usage from 100+ utilities', how: 'ha', ids: ['energy'] }, 'energy');
  const net = step('network');
  for (const [v, l] of net?.question?.options || []) {
    if (['isp', 'other'].includes(v)) continue;
    const note = net.branches?.[v]?.note || '';
    add({ key: `net-${v}`, step: 'network', add: v, label: l, desc: /planned/i.test(note) ? 'Coming soon - internet status and speed tests work today' : note ? note.replace(/^CasaTorch will /, 'Shows ').replace(/, so CasaTorch shows/, ' - CasaTorch shows') : 'Every device on your network, Wi-Fi health and alerts', how: /planned/i.test(note) ? 'soon' : 'direct', ids: [v] }, 'network');
  }
  add({ key: 'pihole', step: 'network', add: 'dns:pihole', label: 'Pi-hole', desc: 'Ads blocked and devices seen', how: 'direct', ids: ['pihole'] }, 'network');
  add({ key: 'adguard', step: 'network', add: 'dns:adguard', label: 'AdGuard Home', desc: 'Ads blocked and devices seen', how: 'direct', ids: ['adguard'] }, 'network');
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
  if (!admin) return modal(el('p', {}, 'Only an owner or admin can connect new gear. Ask them to open Connect on their screen.'), { title: `Connect ${item.label}` });
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Your CasaTorch password' });
  const msg = el('div', { class: 'small', style: 'color:var(--bad);min-height:18px' });
  const go = async () => {
    try { await post('/api/settings/rerun-setup', { password: pw.value }); location.href = `/setup.html?step=${encodeURIComponent(step)}${addId ? `&add=${encodeURIComponent(addId)}` : ''}`; }
    catch (err) { msg.textContent = err.message; }
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const steps = [
    toHaFirst ? `${item.label} connects through Home Assistant, so we'll connect Home Assistant first (about two minutes - you just paste one key).` : `The guided setup opens right at ${item.label}${viaHa ? ', and CasaTorch adds it to Home Assistant for you' : ''}.`,
    'Answer a question or two, press Test, and you\'ll see a green check when it works.',
    'Save. Everything it brings in is ready under Add widget > Rooms & devices.',
  ];
  const m = modal(el('div', {}, el('ol', { class: 'connect-steps' }, steps.map((s) => el('li', {}, s))),
    el('p', { class: 'small muted' }, 'Nothing to install and no command line. Your other settings stay exactly as they are.'),
    needPw ? el('label', { class: 'field' }, el('span', {}, 'Confirm it\'s you'), pw) : null, msg,
    el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, 'Cancel'), el('button', { class: 'btn primary', onclick: go }, 'Start guided setup'))),
  { title: `Connect ${item.label}` });
  if (needPw) setTimeout(() => pw.focus(), 50);
}
tab({ id: 'connect', label: 'Connect', icon: 'plug', async render(main) {
  setTop('Connect', 'Everything CasaTorch works with - add anything in a few clicks');
  const [cat, conn] = await Promise.all([api('/api/catalog'), api('/api/connections').catch(() => ({ ha: {}, domains: [], direct: [], counts: {} }))]);
  const items = connectItems(cat);
  const isOn = (it) => it.ids.some((id) => conn.direct.includes(id)) || (it.domain && conn.domains.includes(it.domain));
  const total = Object.values(conn.counts || {}).reduce((s, n) => s + n, 0), fromHa = conn.counts?.ha || 0, live = items.filter(isOn).length;
  const ha = conn.ha?.connected;
  main.append(el('div', { class: 'connect-hero card' },
    el('div', { class: 'ha-mark' }, icon('home', 26)),
    el('div', { class: 'grow' }, el('div', { class: 'connect-hero-title' }, ha ? 'Home Assistant is connected' : 'Got Home Assistant? Connect it once and everything comes with it.'),
      el('p', { class: 'muted', style: 'margin:0' }, ha ? `${fromHa} entities - every light, sensor, lock, camera and room - are available as widgets automatically. New ones appear on their own.` : 'Every one of its 3,000+ integrations, every entity and every room shows up in CasaTorch as a ready-made widget. No YAML, no add-ons, no command line.')),
    el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, ha ? el('a', { class: 'btn primary', href: '#home', onclick: () => setTimeout(() => toast('Press Add widget > Rooms & devices'), 400) }, icon('plus'), 'Add Home Assistant widgets')
      : el('button', { class: 'btn primary', onclick: () => startConnect({ label: 'Home Assistant', step: 'homeassistant', how: 'direct' }, conn) }, 'Connect Home Assistant'),
      ha ? null : el('a', { class: 'btn', href: 'https://www.home-assistant.io/green', target: '_blank', rel: 'noopener' }, 'Don\'t have it? Home Assistant Green'))));
  main.append(el('div', { class: 'connect-stats' }, el('div', {}, el('b', {}, live), el('span', {}, 'connected')), el('div', {}, el('b', {}, total), el('span', {}, 'devices')), el('div', {}, el('b', {}, fromHa), el('span', {}, 'from Home Assistant')), el('div', {}, el('b', {}, items.length), el('span', {}, 'brands & services built in'))));
  let group = 'all', filter = 'any';
  const q = el('input', { type: 'search', placeholder: 'Search brands - Ring, Hue, Meraki, ecobee…', 'aria-label': 'Search integrations' });
  const chips = el('div', { class: 'chips' }), grid = el('div', { class: 'connect-grid' });
  const card = (it) => {
    const on = isOn(it);
    const tag = it.how === 'soon' ? el('span', { class: 'pill' }, 'Coming soon') : it.how === 'pro' ? el('span', { class: 'pill pro' }, 'Pro') : it.how === 'ha' ? el('span', { class: 'pill ha' }, ha ? 'via Home Assistant' : 'needs Home Assistant') : it.alsoHa ? el('span', { class: 'pill' }, 'Direct or via HA') : el('span', { class: 'pill' }, 'Direct');
    return el('div', { class: `connect-card${on ? ' on' : ''}` },
      el('div', { class: 'row', style: 'gap:12px;align-items:center' }, monogram(it.label), el('div', { style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block' }, it.label), el('div', { class: 'row', style: 'gap:6px;margin-top:3px' }, on ? el('span', { class: 'pill good' }, '✓ Connected') : null, tag))),
      el('p', { class: 'small muted' }, it.desc || ''),
      it.how === 'soon' ? el('button', { class: 'btn small', disabled: true }, 'Coming soon') : el('button', { class: `btn small${on ? '' : ' primary'}`, onclick: () => startConnect(it, conn) }, on ? 'Change' : it.how === 'ha' && !ha ? 'Set up' : 'Connect'));
  };
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    chips.replaceChildren(...CONNECT_GROUPS.map(([g, l]) => el('button', { class: `chip${g === group ? ' on' : ''}`, onclick: () => { group = g; draw(); } }, l)),
      el('span', { class: 'grow' }), ...[['any', 'Everything'], ['on', 'Connected']].map(([f, l]) => el('button', { class: `chip${f === filter ? ' on' : ''}`, onclick: () => { filter = f; draw(); } }, l)));
    const shown = items.filter((it) => (group === 'all' || it.groups.includes(group)) && (filter === 'any' || isOn(it)) && (!t || `${it.label} ${it.desc} ${it.domain || ''}`.toLowerCase().includes(t)));
    shown.sort((a, b) => isOn(b) - isOn(a) || (a.how === 'soon') - (b.how === 'soon'));
    grid.replaceChildren(...shown.map(card), el('div', { class: 'connect-card more' }, el('b', {}, 'Don\'t see yours?'),
      el('p', { class: 'small muted' }, ha ? 'Add it in Home Assistant and it appears in CasaTorch by itself - devices, rooms and all.' : 'Anything Home Assistant supports - over 3,000 brands - works in CasaTorch automatically once Home Assistant is connected.'),
      el('a', { class: 'btn small', href: 'mailto:support@casatorch.com?subject=Please%20add%20an%20integration' }, 'Ask us to add it')));   // scrub-ok: public support address
  };
  q.oninput = draw; draw();
  main.append(el('div', { class: 'row', style: 'gap:12px;margin:18px 0 12px;flex-wrap:wrap' }, el('div', { style: 'flex:1;min-width:220px;max-width:420px' }, q)), chips, grid);
} });
