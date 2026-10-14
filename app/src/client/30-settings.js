/* ---- Settings ---- */
const PRO_FEATURES = [   // [name, what, ships now?]
  ['3D Home', 'Your home as a live, tappable 3D plan - from a LiDAR scan, or drawn in the app.', true], ['Ask the house', 'Plain-English questions; it can switch things for you.', true], ['Ring (Labs)', 'Ring doorbells and cameras without Home Assistant.', true],
  ['Away from home', 'Secure remote access and phone alerts - no port forwarding.'], ['Smart alerts', 'Quiet hours, "only if nobody\'s home", fewer false alarms.'],
  ['Energy insights', 'History, cost by device, and a weekly report.'], ['Self-healing', 'Restarts stuck integrations and tells you what it fixed.'], ['History', '2 years instead of 7 days.'], ['Basic support', 'E-mail and Discord help from the CasaTorch team.', true], ['Multi-home, theme packs, cloud backup', ''],
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
  return el('div', { class: 'card' }, el('h2', {}, 'Help & services'),
    el('div', { class: 'row wrap', style: 'margin-bottom:6px' }, link(`${SITE}/discord`, 'Join the Discord', 'btn primary'), link('mailto:support@casatorch.com', 'E-mail support'), link(`${SITE}/docs`, 'Docs')),   // scrub-ok: the public support address
    item('Basic support', 'E-mail and Discord help from the CasaTorch team, and the members-only Pro channel.', 'Included with Pro'),
    item('Service & Developer Access', 'A direct line to a CasaTorch developer: custom features written for your home, hands-on help installing CasaTorch and setting up your wall panels, priority replies. Includes Pro.', '$100 / year', link(`${SITE}/developer`, 'Learn more', 'btn small')),
    item('Home network planning', 'A one-on-one consultation to plan your Wi-Fi, wiring, cameras, sensors and NAS - with a written plan of what to buy and where it goes.', null, link(`${SITE}/network-planning`, 'Book a consultation', 'btn small')),
    item('CasaTorch Box', 'A Raspberry Pi 5 with CasaTorch already installed - for a second home, or a friend. Plug it in and go. A year of Pro included.', null, link(`${SITE}/box`, 'Order a Box', 'btn small')));
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
  return el('div', { class: 'card' }, el('h2', {}, 'Look & feel'),
    row('Mode', seg('theme', [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match device']])),
    row('Colors', el('div', {}, sw, el('div', { class: 'row', style: 'margin-top:10px' }, el('span', { class: 'small muted' }, 'Custom'), a1, a2))),
    row('Menu position', seg('nav', [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']]), 'Phones always use the bar along the bottom when the menu is on a side.'),
    row('Status bar across the top', seg('statusBar', [['panel', 'Panel mode'], ['always', 'Always'], ['off', 'Off']]), 'Shows the time, weather, alerts and everything CasaTorch is connected to.'),
    el('label', { class: 'row small' }, askTog, 'Show the Ask the house bar in panel mode (Pro)'),
    el('div', { class: 'row wrap', style: 'margin-top:14px' }, el('button', { class: 'btn', onclick: () => setPanel(true) }, icon('expand'), 'Panel mode on this screen'), el('button', { class: 'btn ghost', onclick: async () => { await post('/api/ui', { reset: true }, 'PUT'); S.ui = await api('/api/ui'); applyUi(); drawNav(); show('settings'); } }, icon('reset'), 'Reset look')),
    el('p', { class: 'tiny faint' }, 'Tip: open http://<this box>:8090/?panel=1 on a wall tablet to start it in panel mode.'));
}
function menuCard() {
  const tabs = JSON.parse(JSON.stringify(S.ui.tabs || {}));
  const rows = TABS.map((t) => { const cur = tabs[t.id] || {};
    const inp = el('input', { value: cur.label || '', placeholder: t.label, maxlength: 24, oninput: (e) => { tabs[t.id] = { ...(tabs[t.id] || {}), label: e.target.value.trim() || null }; } });
    const vis = el('input', { type: 'checkbox', checked: !cur.hidden, disabled: t.id === 'settings', style: 'width:auto', title: 'Show in the menu', onchange: (e) => { tabs[t.id] = { ...(tabs[t.id] || {}), hidden: !e.target.checked }; } });
    return el('div', { class: 'tab-row' }, icon(t.icon), inp, el('label', { class: 'row tiny muted' }, vis, 'Show')); });
  return el('div', { class: 'card' }, el('h2', {}, 'Menu'), el('p', { class: 'small muted', style: 'margin-top:0' }, 'Rename menu items or hide the ones you don\'t use. Rename Home screen tiles from Edit layout, and devices from Controls.'), ...rows,
    el('button', { class: 'btn primary', style: 'margin-top:12px', onclick: async () => { await saveUi({ tabs }); toast('Menu saved'); setTop(tabLabel(TABS.find((x) => x.id === 'settings'))); } }, 'Save menu'));
}
tab({ id: 'settings', label: 'Settings', icon: 'gear', async render(main) {
  const s = await api('/api/settings'); S.settings = s;
  const p = s.pro || {};
  const status = p.plan === 'trial' ? `Pro trial - ${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left` : p.pro ? `Pro (${p.plan})${p.email ? ` - ${p.email}` : ''}${p.expires ? `, renews ${fmt(p.expires, { dateStyle: 'medium' })}` : ''}` : 'Free';
  const key = el('textarea', { rows: 3, placeholder: 'Paste your CasaTorch license key', spellcheck: 'false', autocomplete: 'off' });
  const saveKey = el('button', { class: 'btn primary' }, 'Save key');
  saveKey.onclick = async () => { try { await post('/api/license', { key: key.value }); toast('Pro is on. Thank you!'); await loadStatus(); show('settings'); } catch (err) { toast(err.message, 4000); } };
  const pro = el('div', { class: 'card', style: 'grid-column:1/-1' }, el('h2', {}, 'CasaTorch Pro'), el('div', { class: 'row between wrap' }, el('b', { style: 'font-size:18px' }, status), el('a', { href: 'https://casatorch.com/pro', target: '_blank', rel: 'noopener' }, '$5/mo, $49/yr or $129 once')),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px 18px;margin:12px 0' }, PRO_FEATURES.map(([t, d, now]) => el('div', { style: 'padding:8px 0;border-top:1px solid var(--line)' }, el('b', {}, t), now ? el('span', { class: 'pill good', style: 'margin-left:6px' }, 'ready') : el('span', { class: 'pill', style: 'margin-left:6px' }, 'coming'), d ? el('div', { class: 'small muted' }, d) : null))),
    el('label', { class: 'field' }, el('span', {}, 'License key'), key), saveKey);

  const hname = el('input', { type: 'text', maxlength: '60', value: s.house?.name || '' });
  const rate = el('input', { type: 'number', step: '0.01', min: '0', value: s.energy?.ratePerKwh ?? '', placeholder: '0.17' });
  const note = el('input', { type: 'text', maxlength: '280', value: s.note || '', placeholder: 'e.g. Plumber coming Thursday 10-12' });
  const saveV = el('button', { class: 'btn' }, 'Save');
  saveV.onclick = async () => { try { await post('/api/settings', { houseName: hname.value, ratePerKwh: rate.value === '' ? 0 : Number(rate.value), note: note.value }, 'PUT'); toast('Saved'); } catch (err) { toast(err.message); } };
  const everyday = el('div', { class: 'card' }, el('h2', {}, 'Everyday'), el('label', { class: 'field' }, el('span', {}, 'Name of your home'), hname), el('label', { class: 'field' }, el('span', {}, 'Electricity rate ($ per kWh)'), rate), el('label', { class: 'field' }, el('span', {}, 'Note on the Home screen'), note), saveV);

  const homeCard = el('div', { class: 'card' }, el('h2', {}, 'Home screen'), el('p', { class: 'small muted', style: 'margin-top:0' }, 'Add widgets, drag them around and resize them right on the Home screen (Edit layout). The layout is saved on this CasaTorch, so every screen in the house matches.'),
    el('div', { class: 'row wrap' }, el('a', { class: 'btn primary', href: '#home', onclick: () => setTimeout(() => $('.top .btn.primary')?.click(), 400) }, icon('plus'), 'Add a widget'), el('button', { class: 'btn', onclick: async () => { await post('/api/layout', { reset: true }, 'PUT'); toast('Home screen reset'); } }, icon('reset'), 'Reset layout'), el('a', { class: 'btn', href: '#photos' }, 'Manage photos'), el('a', { class: 'btn', href: '#calendar' }, 'Calendar')));

  const c = s.connected || {}, yes = (v) => (v ? (typeof v === 'number' ? `${v}` : 'Connected') : '-');
  const conn = el('div', { class: 'card' }, el('h2', {}, 'Connected'), el('dl', { class: 'kv' },
    [['Home Assistant', c.homeAssistant], ['Philips Hue', c.hue], ['Shelly devices', c.shelly], ['Cameras', c.cameras], ['YoLink', c.yolink], ['Ring', c.ring], ['Meraki', c.meraki], ['UniFi', c.unifi]].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, yes(v))]),
    el('dt', {}, 'Weather for'), el('dd', {}, s.location?.name || '-'), el('dt', {}, 'Calendars'), el('dd', {}, [...(s.calendars || []), 'CasaTorch calendar'].join(', ')), el('dt', {}, 'Teams'), el('dd', {}, s.teams?.join(', ') || '-'), el('dt', {}, 'News'), el('dd', {}, s.feeds?.join(', ') || '-')));

  const pw = el('input', { type: 'password', placeholder: 'Your CasaTorch password', autocomplete: 'current-password' });
  const rerun = el('button', { class: 'btn' }, 'Run setup again');
  rerun.onclick = async () => { try { const r = await post('/api/settings/rerun-setup', { password: pw.value }); location.href = r.url; } catch (err) { toast(err.message); } };
  const out = el('button', { class: 'btn ghost' }, 'Sign out');
  out.onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; };
  const acct = el('div', { class: 'card' }, el('h2', {}, 'This CasaTorch'), el('dl', { class: 'kv' }, el('dt', {}, 'House'), el('dd', {}, s.house?.name || '-'), el('dt', {}, 'Time zone'), el('dd', {}, s.house?.timezone || '-'), el('dt', {}, 'Version'), el('dd', {}, s.version)),
    el('p', { class: 'small muted' }, 'Change devices, calendars, teams and news by running setup again. Your existing settings are kept.'),
    s.demo ? null : el('label', { class: 'field' }, el('span', {}, 'Your password (admins only)'), pw),
    el('div', { class: 'row wrap' }, rerun),
    el('p', { class: 'small muted' }, `CasaTorch ${s.version} · open-source core (AGPL-3.0) · `, el('a', { href: 'https://casatorch.com', target: '_blank', rel: 'noopener' }, 'casatorch.com')));
  const security = await securityCards();
  main.replaceChildren(el('div', { class: 'cards' }, ...security, pro, lookCard(), menuCard(), aiCard(s), homeCard, helpCard(), everyday, conn, acct));
  return null;
} });
/* Side-rail order */
const TAB_ORDER = ['home', 'alerts', 'controls', 'cameras', 'calendar', 'photos', 'energy', 'network', 'house3d', 'ask', 'connect', 'settings'];
TABS.sort((a, b) => TAB_ORDER.indexOf(a.id) - TAB_ORDER.indexOf(b.id));
