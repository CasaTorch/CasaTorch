/* ---- Settings ---- */
const PRO_FEATURES = [   // [name, what, ships now?]
  ['3D Home', 'Your home as a live, tappable 3D plan - from a LiDAR scan, or drawn in the app.', true], ['Ask the house', 'Ask questions about your home; it lines up switches for you to confirm with a tap.', true], ['Ring (Labs)', 'Ring doorbells and cameras without Home Assistant.', true],
  ['Network monitoring', 'UniFi and Cisco Meraki: every device online or offline and how many are connected; Pi-hole and AdGuard Home: what they block. Alerts when something drops off.', true], ['Server monitor', 'Your NAS, servers and self-hosted apps: up or down, response time and certificates, with an alert when one stops.', true], ['Weekly report', 'Every Monday: energy and what it cost, what stays on all night, alerts and the internet - with tips, written by your own AI if you connect one.', true], ['Away from home', 'Secure remote access and phone alerts - no port forwarding.'], ['Smart alerts', 'Doorbell and motion only when nobody\'s home, and critical alerts that repeat until someone taps "Got it".', true],
  ['Energy history', '2 years of daily energy and cost instead of 7 days, and what each metered device used.', true], ['Self-healing', 'Restarts stuck integrations and tells you what it fixed.'], ['Multi-home, theme packs, cloud backup', ''],
];
const AI_PROVIDERS = [['none', 'Not connected'], ['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI'], ['ollama', 'Ollama - runs on your own network'], ['compatible', 'Other OpenAI-compatible server (LM Studio, vLLM...)']];
function aiCard(s) {
  const ai = s.ai || {};
  const prov = el('select', {}, AI_PROVIDERS.map(([v, l]) => el('option', { value: v, selected: (ai.provider || 'none') === v }, l)));
  const key = el('input', { type: 'password', autocomplete: 'off', placeholder: ai.hasKey ? 'Saved - leave empty to keep it' : 'Paste your API key' });
  const url = el('input', { type: 'url', value: ai.url || '', placeholder: 'http://192.168.1.50:11434' });
  const model = el('select', {}, ai.model ? el('option', { value: ai.model }, ai.model) : el('option', { value: '' }, 'Press "Find models" first'));
  const keyF = el('label', { class: 'field' }, el('span', {}, 'API key'), key), urlF = el('label', { class: 'field' }, el('span', {}, 'Server address'), url);
  const help = el('p', { class: 'small muted' });
  const msg = el('div', { class: 'small' });
  const sync = () => {
    const p = prov.value; keyF.hidden = !['anthropic', 'openai', 'compatible'].includes(p); urlF.hidden = !['ollama', 'compatible'].includes(p);
    help.textContent = { anthropic: 'Get a key at console.anthropic.com > API keys. Anthropic bills you directly for what you use - typically a fraction of a cent per question. Not included in CasaTorch Pro.', openai: 'Get a key at platform.openai.com > API keys. OpenAI bills you directly for what you use (a ChatGPT Plus subscription does not include API use). Not included in CasaTorch Pro.', ollama: 'Free and private: install Ollama on a PC or Mac at home, run "ollama pull llama3.1", and enter its address. Nothing leaves your network.', compatible: 'Any server that speaks the OpenAI API. Enter its base address (ending in /v1).', none: 'Pick an AI to answer questions about your home.' }[p];
  };
  prov.onchange = () => { model.replaceChildren(el('option', { value: '' }, 'Press "Find models" first')); sync(); }; sync();
  const find = el('button', { class: 'btn' }, 'Find models');
  find.onclick = async () => { msg.textContent = 'Checking...'; try { const r = await post('/api/settings/ai/models', { provider: prov.value, apiKey: key.value, url: url.value }); model.replaceChildren(...r.models.map((m) => el('option', { value: m, selected: m === r.suggested }, m))); msg.textContent = `Found ${r.models.length} models.`; msg.style.color = 'var(--good)'; } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--bad)'; } };
  const save = el('button', { class: 'btn primary' }, 'Save');
  save.onclick = async () => { try { await post('/api/settings/ai', { provider: prov.value, model: model.value, apiKey: key.value, url: url.value }, 'PUT'); S.settings = await api('/api/settings'); toast('Saved - try the Ask tab'); } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--bad)'; } };
  return el('div', { class: 'card' }, el('h2', {}, icon('spark', 15), 'Ask the house', el('span', { class: 'pill pro' }, 'PRO')), el('label', { class: 'field' }, el('span', {}, 'AI'), prov), help, keyF, urlF,
    el('label', { class: 'field' }, el('span', {}, 'Model'), model), el('div', { class: 'row wrap' }, find, save), msg);
}

const SITE = 'https://casatorch.com';
function helpCard() {
  const link = (href, label, cls = 'btn') => el('a', { class: cls, href, target: '_blank', rel: 'noopener' }, label);
  const item = (title, text, price, action) => el('div', { style: 'padding:12px 0;border-top:1px solid var(--line)' }, el('div', { class: 'row between' }, el('b', {}, title), price ? el('span', { class: 'pill' }, price) : null), el('div', { class: 'small muted', style: 'margin:4px 0 8px' }, text), action);
  return el('div', { class: 'card' }, el('h2', {}, T('Help & services')),
    el('div', { class: 'row wrap', style: 'margin-bottom:6px' }, link('mailto:support@casatorch.com', 'E-mail support', 'btn primary'), link(`${SITE}/docs`, 'Guides'), el('button', { class: 'btn', onclick: () => tour() }, icon('spark'), T('Take the tour'))),   // scrub-ok: the public support address
    item('Help', 'E-mail help from the CasaTorch team - for everyone. A community Discord is opening soon.', 'Included'),
    item('Home network design', 'Wi-Fi, wiring, cameras and sensors planned around your home, from someone with home and business network design experience. A clear, fixed quote first.', null, link('mailto:sales@casatorch.com?subject=Network%20project%20quote', 'Ask for a quote', 'btn small')),   // scrub-ok: the public sales address
    item('CasaTorch Box', 'A small box with CasaTorch already on it - for a second home, or a friend. Box Lite or Box, plug it in and go.', null, link(`${SITE}/box`, 'Order a Box', 'btn small')));
}
/* The home's language: saved for everyone, and this screen switches straight away. */
function langPicker() {
  return el('select', { 'aria-label': T('Language'), style: 'max-width:240px', onchange: async (e) => {
    const l = e.target.value;
    if (!S.status?.demo) { try { await post('/api/settings', { lang: l }, 'PUT'); S.settings = { ...S.settings, house: { ...(S.settings?.house || {}), lang: l } }; } catch (err) { toast(err.message, 4000); e.target.value = CasaI18n.lang; return; } }
    await CasaI18n.use(l); drawNav(); drawBanner(); show(current);
  } }, ...Object.entries(CasaI18n.LANGS).map(([k, n]) => el('option', { value: k, selected: k === CasaI18n.lang ? true : null }, n)));
}
function lookCard() {
  const u = { ...S.ui };
  const seg = (key, opts) => { const box = el('div', { class: 'seg' }); const draw = () => box.replaceChildren(...opts.map(([v, l]) => el('button', { class: u[key] === v ? 'on' : null, onclick: async () => { u[key] = v; draw(); await saveUi({ [key]: v }); } }, l))); draw(); return box; };
  const sw = el('div', { class: 'swatches' });
  const a1 = el('input', { type: 'color', value: u.accent, style: 'width:54px;height:38px;padding:2px' }), a2 = el('input', { type: 'color', value: u.accent2, style: 'width:54px;height:38px;padding:2px' });
  const drawSw = () => sw.replaceChildren(...PALETTES.map(([name, x, y]) => el('button', { class: `swatch${u.accent === x && u.accent2 === y ? ' on' : ''}`, title: name, 'aria-label': `${name} colors`, style: `background:linear-gradient(135deg,${x},${y})`, onclick: async () => { u.accent = x; u.accent2 = y; a1.value = x; a2.value = y; drawSw(); await saveUi({ accent: x, accent2: y }); } })));
  drawSw();
  let t = null; const live = () => { u.accent = a1.value; u.accent2 = a2.value; S.ui = { ...S.ui, accent: u.accent, accent2: u.accent2 }; applyUi(); drawSw(); clearTimeout(t); t = setTimeout(() => saveUi({ accent: u.accent, accent2: u.accent2 }), 500); };
  a1.oninput = live; a2.oninput = live;
  const row = (label, ctl, help) => el('div', { style: 'margin:14px 0' }, el('div', { class: 'small muted', style: 'margin-bottom:6px' }, label), ctl, help ? el('div', { class: 'tiny faint', style: 'margin-top:5px' }, help) : null);
  const askTog = el('input', { type: 'checkbox', checked: u.panelAsk !== false, style: 'width:auto', onchange: (e) => saveUi({ panelAsk: e.target.checked }) });
  return el('div', { class: 'card' }, el('h2', {}, T('Look & feel')),
    row(T('Mode'), seg('theme', [['dark', T('Dark')], ['light', T('Light')], ['auto', T('Match device')]])),
    row('Colors', el('div', {}, sw, el('div', { class: 'row', style: 'margin-top:10px' }, el('span', { class: 'small muted' }, 'Custom'), a1, a2))),
    row('Status bar across the top', seg('statusBar', [['panel', 'Panel mode'], ['always', 'Always'], ['off', 'Off']]), 'Shows the time, weather, alerts and everything CasaTorch is connected to.'),
    el('label', { class: 'row small' }, askTog, 'Show the Ask the house bar in panel mode (Pro)'),
    el('div', { class: 'row wrap', style: 'margin-top:14px' }, el('button', { class: 'btn', onclick: () => setPanel(true) }, icon('expand'), 'Panel mode on this screen'), el('button', { class: 'btn ghost', onclick: async () => { await post('/api/ui', { reset: true }, 'PUT'); S.ui = await api('/api/ui'); applyUi(); drawNav(); show('settings'); } }, icon('reset'), 'Reset look')),
    el('p', { class: 'tiny faint' }, 'Tip: open http://<this box>:8090/?panel=1 on a wall tablet to start it in panel mode.'));
}
/* The main bar: which buttons, in what order, what they're called, how big, and where. Saved for every screen; changes show at once. */
function barCard() {
  const tabs = JSON.parse(JSON.stringify(S.ui.tabs || {}));
  let order = navTabs().map((t) => t.id); for (const t of TABS) if (!order.includes(t.id)) order.push(t.id);
  let saveT = null;
  const commit = () => { order.forEach((id, i) => { tabs[id] = { ...(tabs[id] || {}), order: i }; }); S.ui = { ...S.ui, tabs }; drawNav(); clearTimeout(saveT); saveT = setTimeout(() => saveUi({ tabs }).catch((e) => toast(e.message)), 400); };
  const list = el('div', { class: 'bar-list', role: 'list' });
  const seg = (key, opts) => { const box = el('div', { class: 'seg' }); const draw = () => box.replaceChildren(...opts.map(([v, l]) => el('button', { class: (S.ui[key] ?? opts[0][0]) === v ? 'on' : null, onclick: async () => { S.ui = { ...S.ui, [key]: v }; applyUi(); drawNav(); draw(); await saveUi({ [key]: v }); } }, l))); draw(); return box; };
  const draw = () => list.replaceChildren(...order.map((id, i) => {
    const t = TABS.find((x) => x.id === id); if (!t) return null; const cur = tabs[id] || {};
    const row = el('div', { class: `mb-row${cur.hidden ? ' off' : ''}`, role: 'listitem', 'data-id': id },
      el('button', { class: 'bar-grip', title: 'Drag to reorder', 'aria-label': `Move ${tabLabel(t)}` }, icon('grip', 16)), icon(t.icon),
      el('input', { value: cur.label || '', placeholder: T(t.label), maxlength: 24, 'aria-label': `Name for ${T(t.label)}`, oninput: (e) => { tabs[id] = { ...(tabs[id] || {}), label: e.target.value.trim() || null }; commit(); } }),
      el('button', { class: 'btn small ghost', 'aria-label': 'Move up', disabled: i === 0 || null, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; commit(); draw(); } }, '↑'),
      el('label', { class: 'switch-row', title: id === 'settings' ? 'Settings always stays in the bar' : 'Show in the bar' }, el('input', { type: 'checkbox', checked: !cur.hidden, disabled: id === 'settings' || null, onchange: (e) => { tabs[id] = { ...(tabs[id] || {}), hidden: !e.target.checked }; commit(); draw(); } }), el('span', { class: 'tiny muted' }, cur.hidden ? 'Hidden' : 'Shown')));
    row.querySelector('.bar-grip').addEventListener('pointerdown', (e) => {
      e.preventDefault(); row.classList.add('dragging');
      const move = (ev) => { const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.mb-row'); if (!over || over === row || !list.contains(over)) return; const r = over.getBoundingClientRect(); if (ev.clientY > r.top + r.height / 2) over.after(row); else over.before(row); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); row.classList.remove('dragging'); order = [...list.children].map((n) => n.dataset.id).filter(Boolean); commit(); draw(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    return row;
  }).filter(Boolean));
  draw();
  const rowOf = (label, ctl, help) => el('div', { style: 'margin:12px 0' }, el('div', { class: 'small muted', style: 'margin-bottom:6px' }, label), ctl, help ? el('div', { class: 'tiny faint', style: 'margin-top:5px' }, help) : null);
  return el('div', { class: 'card' }, el('h2', {}, icon('grid', 15), T('Main bar')),
    el('p', { class: 'small muted', style: 'margin-top:0' }, 'Choose the buttons on the main bar, drag them into the order you like and rename them. Every screen in the house gets the same bar.'),
    rowOf('Size', seg('navSize', [['s', 'Compact'], ['m', 'Standard'], ['l', 'Large']])),
    rowOf('Labels', seg('navLabels', [[true, 'Icons and names'], [false, 'Icons only']])),
    rowOf('Where', seg('nav', [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']]), 'On a phone a side bar moves to the bottom, with the first four buttons and More.'),
    list,
    el('div', { class: 'row wrap', style: 'margin-top:12px' }, el('button', { class: 'btn ghost', onclick: async () => { const t2 = {}; for (const [k, v] of Object.entries(tabs)) if (v.label) t2[k] = { label: v.label }; Object.keys(tabs).forEach((k) => delete tabs[k]); Object.assign(tabs, t2); order = TABS.map((t) => t.id); S.ui = { ...S.ui, tabs, navSize: 'm', navLabels: true }; await saveUi({ tabs, navSize: 'm', navLabels: true }); applyUi(); drawNav(); show('settings/appearance'); } }, icon('reset'), 'Default order and size')));
}
function langCard(s) {
  return el('div', { class: 'card' }, el('h2', {}, T('Language & region')),
    el('label', { class: 'field' }, el('span', {}, T('Language')), langPicker()),
    el('p', { class: 'tiny faint' }, [T('The language CasaTorch uses in this home. Everyone here sees it.'), CasaI18n.lang !== 'en' ? ` ${T('Some screens are still in English.')}` : ''].join('')),
    el('dl', { class: 'kv' }, el('dt', {}, 'Time zone'), el('dd', {}, s.house?.timezone || '-'), el('dt', {}, 'Units'), el('dd', {}, S.units === 'C' ? 'Metric (°C)' : 'US (°F)'), el('dt', {}, 'Weather for'), el('dd', {}, s.location?.name || '-')),
    el('p', { class: 'tiny faint' }, 'Time zone, units and your town come from setup - run setup again (Advanced) to change them.'));
}
/* ---- Advanced (admins): how it's running, its log, diagnostics, maintenance ---- */
const bytes = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const dur = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
async function systemCard() {
  const i = await api('/api/system/info').catch(() => null); if (!i) return null;
  const INSTALLS = { 'ha-addon': 'Home Assistant add-on', docker: 'Docker', deb: 'Linux package', 'pi-image': 'Raspberry Pi / CasaTorch Box', windows: 'Windows', macos: 'Mac', manual: 'From source' };
  const memPct = i.memory.hostTotalMB ? Math.round((1 - i.memory.hostFreeMB / i.memory.hostTotalMB) * 100) : null;
  const diskPct = i.disk?.totalBytes ? Math.round((1 - i.disk.freeBytes / i.disk.totalBytes) * 100) : null;
  const meter = (label, pct, text) => el('div', { class: 'bar-row', style: 'grid-template-columns:110px 1fr auto' }, el('span', { class: 'small' }, label), el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${Math.max(2, pct ?? 0)}%;${pct > 90 ? 'background:var(--bad)' : pct > 75 ? 'background:var(--warn)' : ''}` })), el('span', { class: 'small muted num' }, text));
  return el('div', { class: 'card' }, el('h2', {}, icon('info', 15), 'This CasaTorch is running'),
    el('dl', { class: 'kv' }, el('dt', {}, 'Version'), el('dd', {}, i.version), el('dt', {}, 'Installed as'), el('dd', {}, INSTALLS[i.install] || i.install), el('dt', {}, 'Running for'), el('dd', {}, dur(i.uptimeSec)), el('dt', {}, 'System'), el('dd', {}, `${i.platform} · ${i.cpus} cores · Node ${i.node}`),
      el('dt', {}, 'Screens open'), el('dd', {}, i.screensOpen ?? '-'), el('dt', {}, 'Live updates'), el('dd', {}, i.liveHomeAssistant ? 'On - Home Assistant sends changes instantly' : 'Every few seconds')),
    el('div', { class: 'bars', style: 'margin-top:12px' }, meter('CasaTorch', Math.min(100, Math.round(i.memory.rssMB / Math.max(1, i.memory.hostTotalMB) * 100)), `${i.memory.rssMB} MB`), memPct != null ? meter('Memory', memPct, `${memPct}% of ${bytes(i.memory.hostTotalMB)}`) : null, diskPct != null ? meter('Storage', diskPct, `${diskPct}% used · data ${bytes(i.dataMB)}`) : null));
}
async function logCard() {
  const box = el('div', { class: 'logbox', role: 'log', 'aria-live': 'polite' });
  let level = 'all', q = '', timer = null;
  const load = async () => { try { const { lines } = await api(`/api/system/log?level=${level}&q=${encodeURIComponent(q)}`); const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 30; box.replaceChildren(...(lines.length ? lines.map((l) => el('div', { class: `logline ${l.level}` }, el('span', { class: 'when' }, fmt(l.at, { hour: 'numeric', minute: '2-digit', second: '2-digit' })), el('span', { class: 'lvl' }, l.level === 'info' ? '' : l.level), el('span', {}, l.text))) : [el('div', { class: 'small muted' }, 'Nothing here.')])); if (atEnd) box.scrollTop = box.scrollHeight; } catch (e) { box.replaceChildren(el('div', { class: 'small muted' }, e.message)); } };
  const lv = el('div', { class: 'seg seg-mini' }, ...[['all', 'Everything'], ['problems', 'Problems'], ['error', 'Errors']].map(([v, l]) => el('button', { class: v === level ? 'on' : null, onclick: (e) => { level = v; [...lv.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); load(); } }, l)));
  const search = el('input', { type: 'search', placeholder: 'Search the log', style: 'max-width:240px', oninput: (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 250); } });
  const card = el('div', { class: 'card wide' }, el('h2', {}, icon('log', 15), 'Log'), el('p', { class: 'small muted', style: 'margin-top:0' }, 'What CasaTorch has been doing - the last 600 lines, newest at the bottom. Passwords, keys and tokens are masked.'),
    el('div', { class: 'row wrap', style: 'gap:8px;margin-bottom:8px' }, lv, search, el('button', { class: 'btn small', onclick: load }, icon('reset', 14), 'Refresh'), el('a', { class: 'btn small', href: '/api/system/diagnostics', download: '' }, icon('download', 14), 'Diagnostics file')), box,
    el('p', { class: 'tiny faint' }, 'The diagnostics file has the version, how it\'s installed, memory, which kinds of things are set up (not their settings) and the log - safe to send to support@casatorch.com.'));   // scrub-ok: the public support address
  load(); const live = setInterval(() => { if (!card.isConnected) return clearInterval(live); if (!document.hidden) load(); }, 5000);
  return card;
}
function maintCard(s, me) {
  const pw = el('input', { type: 'password', placeholder: 'Your CasaTorch password', autocomplete: 'current-password' });
  const rerun = el('button', { class: 'btn' }, icon('reset', 14), 'Run setup again');
  rerun.onclick = async () => { try { const r = await post('/api/settings/rerun-setup', { password: pw.value }); location.href = sameOrigin(r.url, '/setup.html'); } catch (err) { toast(err.message); } };
  const restart = el('button', { class: 'btn' }, 'Restart CasaTorch');
  restart.onclick = async () => { restart.disabled = true; try { const r = await post('/api/system/restart', {}); toast(r.demo ? 'The demo doesn\'t restart.' : 'Restarting - this page reconnects in a few seconds.', 5000); } catch (e) { toast(e.message, 5000); restart.disabled = false; } };
  return el('div', { class: 'card' }, el('h2', {}, icon('gear', 15), 'Maintenance'),
    el('p', { class: 'small muted', style: 'margin-top:0' }, 'Change your town, time zone, devices, calendars, teams and news by running setup again - everything you have is kept.'),
    s.demo ? null : el('label', { class: 'field' }, el('span', {}, 'Your password'), pw), el('div', { class: 'row wrap' }, rerun, restart),
    el('div', { class: 'row wrap', style: 'margin-top:10px' },
      el('button', { class: 'btn ghost', onclick: async () => { await post('/api/layout', { reset: true }, 'PUT'); toast('Home screen reset to the default'); } }, 'Reset the Home screen'),
      el('button', { class: 'btn ghost', onclick: async () => { await post('/api/ui', { reset: true }, 'PUT'); S.ui = await api('/api/ui'); applyUi(); drawNav(); toast('Look and main bar reset'); } }, 'Reset look & main bar')));
}
tab({ id: 'settings', label: 'Settings', icon: 'gear', async render(main, sub) {
  const [s, me] = await Promise.all([api('/api/settings'), api('/api/auth/me').catch(() => null)]); S.settings = s;
  const admin = !me || me.signIn === false || ['admin', 'owner'].includes(me.user?.role);
  const p = s.pro || {};
  const status = p.plan === 'trial' ? `Pro trial - ${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left` : p.pro ? `Pro (${p.plan})${p.email ? ` - ${p.email}` : ''}${p.expires ? `, renews ${fmt(p.expires, { dateStyle: 'medium' })}` : ''}` : 'Free';
  const key = el('textarea', { rows: 3, placeholder: 'Paste your CasaTorch license key', spellcheck: 'false', autocomplete: 'off' });
  const saveKey = el('button', { class: 'btn primary' }, 'Save key');
  saveKey.onclick = async () => { try { await post('/api/license', { key: key.value }); toast('Pro is on. Thank you!'); await loadStatus(); show('settings'); } catch (err) { toast(err.message, 4000); } };
  const pro = el('div', { class: 'card', style: 'grid-column:1/-1' }, el('h2', {}, T('CasaTorch Pro')), el('div', { class: 'row between wrap' }, el('b', { style: 'font-size:18px' }, status), el('a', { href: 'https://casatorch.com/pro', target: '_blank', rel: 'noopener' }, '$5/mo or $49/yr')),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px 18px;margin:12px 0' }, PRO_FEATURES.map(([t, d, now]) => el('div', { style: 'padding:8px 0;border-top:1px solid var(--line)' }, el('b', {}, t), now ? el('span', { class: 'pill good', style: 'margin-left:6px' }, 'ready') : el('span', { class: 'pill', style: 'margin-left:6px' }, 'coming'), d ? el('div', { class: 'small muted' }, d) : null))),
    el('label', { class: 'field' }, el('span', {}, 'License key'), key), el('div', { class: 'row wrap' }, saveKey, el('span', { class: 'small muted' }, 'or'), el('button', { class: 'btn', onclick: () => claimKey(async () => { await loadStatus(); show('settings'); }) }, 'Get my key by e-mail')),
    el('p', { class: 'small muted' }, 'Bought Pro? "Get my key by e-mail" sends a code to the address you bought with - no copying keys around.'));

  const hname = el('input', { type: 'text', maxlength: '60', value: s.house?.name || '' });
  const rate = el('input', { type: 'number', step: '0.01', min: '0', value: s.energy?.ratePerKwh ?? '', placeholder: '0.17' });
  const note = el('input', { type: 'text', maxlength: '280', value: s.note || '', placeholder: 'e.g. Plumber coming Thursday 10-12' });
  const saveV = el('button', { class: 'btn' }, 'Save');
  saveV.onclick = async () => { try { await post('/api/settings', { houseName: hname.value, ratePerKwh: rate.value === '' ? 0 : Number(rate.value), note: note.value }, 'PUT'); toast('Saved'); } catch (err) { toast(err.message); } };
  const everyday = el('div', { class: 'card' }, el('h2', {}, T('Everyday')), el('label', { class: 'field' }, el('span', {}, 'Name of your home'), hname), el('label', { class: 'field' }, el('span', {}, 'Electricity rate ($ per kWh)'), rate), el('label', { class: 'field' }, el('span', {}, 'Note on the Home screen'), note), saveV);

  const homeCard = el('div', { class: 'card' }, el('h2', {}, 'Home screen'), el('p', { class: 'small muted', style: 'margin-top:0' }, 'Add widgets, drag them around and resize them right on the Home screen (Edit layout). The layout is saved on this CasaTorch, so every screen in the house matches.'),
    el('div', { class: 'row wrap' }, el('a', { class: 'btn primary', href: '#home', onclick: () => setTimeout(() => $('.top .btn.primary')?.click(), 400) }, icon('plus'), 'Add a widget'), el('button', { class: 'btn', onclick: async () => { await post('/api/layout', { reset: true }, 'PUT'); toast('Home screen reset'); } }, icon('reset'), 'Reset layout'), el('a', { class: 'btn', href: '#photos' }, 'Manage photos'), el('a', { class: 'btn', href: '#calendar' }, 'Calendar')));

  const c = s.connected || {}, yes = (v) => (v ? (typeof v === 'number' ? `${v}` : 'Connected') : '-');
  const conn = el('div', { class: 'card' }, el('h2', {}, T('Connected')), el('dl', { class: 'kv' },
    [['Home Assistant', c.homeAssistant], ['Philips Hue', c.hue], ['Shelly devices', c.shelly], ['Cameras', c.cameras], ['YoLink', c.yolink], ['Ring', c.ring]].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, yes(v))]),
    el('dt', {}, 'Weather for'), el('dd', {}, s.location?.name || '-'), el('dt', {}, 'Calendars'), el('dd', {}, [...(s.calendars || []), 'CasaTorch calendar'].join(', ')), el('dt', {}, 'Teams'), el('dd', {}, s.teams?.join(', ') || '-'), el('dt', {}, 'News'), el('dd', {}, s.feeds?.join(', ') || '-')));

  const pw = el('input', { type: 'password', placeholder: 'Your CasaTorch password', autocomplete: 'current-password' });
  const rerun = el('button', { class: 'btn' }, 'Run setup again');
  rerun.onclick = async () => { try { const r = await post('/api/settings/rerun-setup', { password: pw.value }); location.href = sameOrigin(r.url, '/setup.html'); } catch (err) { toast(err.message); } };
  const out = el('button', { class: 'btn ghost' }, 'Sign out');
  out.onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; };
  const acct = el('div', { class: 'card' }, el('h2', {}, T('This CasaTorch')), el('dl', { class: 'kv' }, el('dt', {}, 'House'), el('dd', {}, s.house?.name || '-'), el('dt', {}, 'Time zone'), el('dd', {}, s.house?.timezone || '-'), el('dt', {}, 'Version'), el('dd', {}, s.version)),
    el('div', { class: 'row wrap' }, el('a', { class: 'btn', href: '#settings/advanced' }, 'Run setup again…'), out),
    el('p', { class: 'small muted' }, `CasaTorch ${s.version} · open-source core (AGPL-3.0) · `, el('a', { href: 'https://casatorch.com', target: '_blank', rel: 'noopener' }, 'casatorch.com')));
  conn.append(el('div', { class: 'row wrap', style: 'margin-top:12px' }, el('a', { class: 'btn primary', href: '#connect' }, icon('plus', 14), 'Connect more'), el('a', { class: 'btn', href: '#connect' }, 'Manage connections')));
  /* Sections, like a phone's Settings: a list on the left (the whole page on a phone), one section at a time, and search. */
  const SECTIONS = [
    ['general', 'General', 'home', 'Your home\'s name, language, energy price and this CasaTorch', async () => [acct, langCard(s), everyday]],
    ['appearance', 'Look & main bar', 'palette', 'Dark or light, colors, the main bar and the Home screen', async () => [lookCard(), barCard(), homeCard]],
    ['people', 'People & sign-in', 'user', 'Your account, two-step sign-in, people in the house and the security log', async () => securityCards()],
    ['safety', 'Safety', 'shield', 'What CasaTorch will never switch, and your exceptions', async () => [await safetyCard()], admin],
    ['connections', 'Connections & AI', 'link', 'Home Assistant and your brands, Ask the house, secure access', async () => [conn, aiCard(s), await remoteCard(), await localHttpsCard()]],
    ['phones', 'Phones & alerts', 'phone', 'Alerts on your phones, quiet hours, the app', async () => [await phoneCard()]],
    ['updates', 'Updates & backup', 'download', 'Versions, automatic updates and an encrypted backup', async () => [await updatesCard(), await backupCard(s)]],
    ['pro', 'CasaTorch Pro', 'spark', 'Your plan and license key', async () => [pro]],
    ['help', 'Help', 'help', 'Guides, the tour and getting help', async () => [helpCard()]],
    ['advanced', 'Advanced', 'log', 'How it\'s running, its log, diagnostics and maintenance', async () => [await systemCard(), await logCard(), maintCard(s, me)], admin],
  ].filter((x) => x[5] !== false);
  const built = new Map();
  const cardsOf = async (k) => { if (!built.has(k)) built.set(k, (await SECTIONS.find((x) => x[0] === k)[4]()).flat().filter(Boolean)); return built.get(k); };
  const cur = SECTIONS.some((x) => x[0] === sub) ? sub : null, phone = window.innerWidth <= 760;
  const pick = cur || (phone ? null : 'general');
  const search = el('input', { type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings' });
  const nav = el('nav', { class: 'set-nav', 'aria-label': 'Settings sections' }, search, ...SECTIONS.map(([k, label, ic, blurb]) => el('a', { href: `#settings/${k}`, class: `set-link${k === pick ? ' on' : ''}` }, el('span', { class: 'set-ic' }, icon(ic, 18)), el('span', { class: 'grow', style: 'min-width:0' }, el('b', {}, label), el('small', { class: 'ellipsis' }, blurb)), phone ? icon('chevr', 16) : null)));
  const pane = el('div', { class: 'set-pane' });
  const showSection = async (k) => {
    const [, label, , blurb] = SECTIONS.find((x) => x[0] === k);
    pane.replaceChildren(el('div', { class: 'set-head' }, phone ? el('a', { class: 'btn ghost small', href: '#settings' }, icon('chevl', 14), 'Settings') : null, el('h2', {}, label), el('p', { class: 'small muted' }, blurb)), el('div', { class: 'cards' }, el('div', { class: 'card skeleton' })));
    const cards = await cardsOf(k); if (!pane.isConnected) return;
    pane.lastChild.replaceChildren(...cards);
  };
  let st = null;
  search.oninput = () => { clearTimeout(st); st = setTimeout(async () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { if (pick) showSection(pick); else pane.replaceChildren(); main.classList.toggle('set-searching', false); return; }
    main.classList.add('set-searching');
    const hits = [];
    for (const [k, label] of SECTIONS) for (const c of await cardsOf(k)) if (c.textContent.toLowerCase().includes(q)) hits.push([label, c]);
    pane.replaceChildren(el('div', { class: 'set-head' }, el('h2', {}, `Results for "${search.value.trim()}"`)), hits.length ? el('div', { class: 'cards' }, ...hits.map(([l, c]) => { c.dataset.section = l; return c; })) : el('p', { class: 'muted' }, 'No setting matches - try another word.'));
  }, 200); };
  main.replaceChildren(el('div', { class: `settings${phone ? (pick ? ' set-detail' : ' set-list') : ''}` }, nav, pane));
  if (pick) await showSection(pick);
  return null;
} });
/* Side-rail order */
const TAB_ORDER = ['home', 'alerts', 'controls', 'cameras', 'security', 'calendar', 'photos', 'energy', 'network', 'house3d', 'ask', 'connect', 'settings'];
TABS.sort((a, b) => TAB_ORDER.indexOf(a.id) - TAB_ORDER.indexOf(b.id));

/* "Get my key by e-mail": the e-mail used to buy Pro gets a 6-digit code; the key is saved here. */
function claimKey(done) {
  const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
  const code = el('input', { inputmode: 'numeric', maxlength: '6', placeholder: '6-digit code', autocomplete: 'one-time-code' });
  const msg = el('p', { class: 'small muted' }, 'Use the e-mail address you bought Pro with.');
  const stepB = el('div', { hidden: true }, el('label', { class: 'field' }, el('span', {}, 'Code from the e-mail'), code));
  const send = el('button', { class: 'btn primary' }, 'Send me a code');
  const m = modal(el('div', {}, el('label', { class: 'field' }, el('span', {}, 'E-mail address'), email), stepB, msg, el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, 'Cancel'), send)), { title: 'Get my Pro key' });
  let sent = false;
  send.onclick = async () => {
    send.disabled = true;
    try {
      if (!sent) { await post('/api/license/claim/start', { email: email.value }); sent = true; stepB.hidden = false; send.textContent = 'Get my key'; msg.textContent = 'If that address bought Pro, a code is on its way - check spam too. It works for 15 minutes.'; setTimeout(() => code.focus(), 50); }
      else { const r = await post('/api/license/claim/finish', { email: email.value, code: code.value }); m.remove(); toast(`Pro is on (${r.plan}). Thank you!`, 4000); done?.(r); }
    } catch (err) { msg.textContent = err.message; }
    send.disabled = false;
  };
  setTimeout(() => email.focus(), 50);
}
/* Backup and restore (owner): one encrypted file with everything; restore replaces it all and restarts. */
async function backupCard(s) {
  if (s.demo) return null;
  const me = await api('/api/auth/me').catch(() => null);
  if (me && me.signIn !== false && me.user?.role !== 'owner') return null;
  const pass = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 10 characters' }), pass2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it again' });
  const media = el('input', { type: 'checkbox', checked: true, style: 'width:auto' });
  const msg = el('p', { class: 'small', style: 'min-height:1.2em' });
  const make = el('button', { class: 'btn primary', onclick: async () => {
    msg.style.color = 'var(--bad)';
    if (pass.value.length < 10) { msg.textContent = 'Pick a passphrase of at least 10 characters.'; return; }
    if (pass.value !== pass2.value) { msg.textContent = 'The two passphrases don\'t match.'; return; }
    make.disabled = true; msg.style.color = ''; msg.textContent = 'Making your backup - this can take a minute with photos and 3D scans...';
    try {
      const r = await fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: pass.value, media: media.checked }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The backup couldn\'t be made.');
      const blob = await r.blob(), a = el('a', { href: URL.createObjectURL(blob), download: (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'casatorch-backup.ctbk' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      pass.value = pass2.value = ''; msg.textContent = `Backup saved (${(blob.size / 1048576).toFixed(1)} MB). Keep the passphrase somewhere safe - without it the file can't be opened.`;
    } catch (e) { msg.style.color = 'var(--bad)'; msg.textContent = e.message; }
    make.disabled = false;
  } }, 'Download backup');
  const restore = el('button', { class: 'btn', onclick: () => restoreModal('/api/restore') }, 'Restore from a backup');
  return el('div', { class: 'card' }, el('h2', {}, T('Backup')),
    el('p', { class: 'small muted' }, 'One file with your settings and connections, sign-ins, calendar, floor plans, history and photos - to keep safe, or to move CasaTorch to new hardware. It\'s encrypted with a passphrase you pick; CasaTorch doesn\'t keep the passphrase.'),
    el('label', { class: 'field' }, el('span', {}, 'Passphrase'), pass), el('label', { class: 'field' }, el('span', {}, 'Passphrase again'), pass2),
    el('label', { class: 'row small', style: 'gap:8px;margin:6px 0 10px' }, media, 'Include photos and 3D scans (larger file)'),
    msg, el('div', { class: 'row wrap' }, make, restore));
}
/* Used by Settings (owner) and by setup on a fresh install. */
function restoreModal(url) {
  const file = el('input', { type: 'file', accept: '.ctbk,application/octet-stream' }), pass = el('input', { type: 'password', autocomplete: 'off' });
  const msg = el('p', { class: 'small', style: 'min-height:1.2em' });
  const go = el('button', { class: 'btn primary', onclick: async () => {
    const f = file.files?.[0]; msg.style.color = 'var(--bad)';
    if (!f) { msg.textContent = 'Choose the backup file.'; return; }
    if (!pass.value) { msg.textContent = 'Enter the passphrase.'; return; }
    go.disabled = true; msg.style.color = ''; msg.textContent = 'Checking and restoring...';
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Passphrase': encodeURIComponent(pass.value) }, body: f });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Couldn\'t restore.');
      m.querySelector('.box').replaceChildren(el('h3', {}, 'Restored'), el('p', {}, j.restart === 'manual' ? 'Start CasaTorch again, then sign in with the accounts from the backup.' : 'CasaTorch is restarting. This page reloads in a few seconds - sign in with the accounts from the backup.'));
      if (j.restart !== 'manual') setTimeout(() => { location.href = '/'; }, 8000);
    } catch (e) { msg.style.color = 'var(--bad)'; msg.textContent = e.message; go.disabled = false; }
  } }, 'Restore');
  const m = modal(el('div', {}, el('p', { class: 'small' }, el('b', {}, 'This replaces everything on this CasaTorch'), ' with what\'s in the backup. The current data is kept in a folder named ".before-restore" in case you need it.'),
    el('label', { class: 'field' }, el('span', {}, 'Backup file (.ctbk)'), file), el('label', { class: 'field' }, el('span', {}, 'Passphrase'), pass), msg,
    el('div', { class: 'row', style: 'justify-content:flex-end' }, go)), { title: 'Restore from a backup' });
}
/* Updates: the version, what's newest, and the two switches. */
async function updatesCard() {
  const [u, f] = await Promise.all([api('/api/updates').catch(() => null), api('/api/find').catch(() => null)]);
  if (!u) return el('div');
  const INSTALLS = { 'ha-addon': 'Home Assistant add-on', docker: 'Docker', deb: 'Linux package', 'pi-image': 'Raspberry Pi / CasaTorch Box', windows: 'Windows', macos: 'Mac', manual: 'From source' };
  const sw = (label, on, onchange, hint) => el('label', { class: 'field check', style: 'display:flex;gap:10px;align-items:flex-start' }, el('input', { type: 'checkbox', checked: on, onchange, style: 'width:auto;margin-top:4px' }), el('span', {}, label, hint ? el('span', { class: 'small muted', style: 'display:block' }, hint) : null));
  const save = async (body) => { try { await post('/api/updates', body); toast('Saved'); } catch (err) { toast(err.message); } };
  const checkBtn = el('button', { class: 'btn' }, 'Check now');
  checkBtn.onclick = async () => { checkBtn.disabled = true; try { S.updates = await post('/api/updates', { checkNow: true }); drawBanner(); show('settings'); } catch (err) { toast(err.message); } checkBtn.disabled = false; };
  return el('div', { class: 'card' }, el('h2', {}, T('Updates')),
    el('dl', { class: 'kv' }, el('dt', {}, 'This version'), el('dd', {}, u.version), el('dt', {}, 'Installed as'), el('dd', {}, INSTALLS[u.install] || u.install), el('dt', {}, 'Newest'), el('dd', {}, u.latest ? `${u.latest}${u.available ? ' - available' : ' - you have it'}` : !u.check ? 'not checking' : u.error ? 'could not check right now' : u.checked ? '-' : 'checks within a few minutes of starting')),
    u.available ? el('p', { class: 'small' }, u.how, ' ', el('a', { href: safeHref(u.download), target: '_blank', rel: 'noopener' }, 'Downloads')) : null,
    sw('Check for updates once a day', u.check, (e) => save({ check: e.target.checked }), 'Sends only the version number to casatorch.com.'),
    u.canAuto ? sw('Install updates automatically overnight', u.auto, (e) => save({ auto: e.target.checked })) : null,
    f ? sw('Open this CasaTorch from casatorch.com/home', f.announce, async (e) => { try { await post('/api/find', { announce: e.target.checked }); toast('Saved'); } catch (err) { toast(err.message); } }, `Shares only its home-network address${f.address ? ` (${f.address})` : ''}, and only with browsers on your own internet connection.`) : null,
    el('div', { class: 'row wrap' }, checkBtn));
}
