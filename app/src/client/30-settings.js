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
  return el('div', { class: 'card' }, el('h2', {}, 'Help & services'),
    el('div', { class: 'row wrap', style: 'margin-bottom:6px' }, link('mailto:support@casatorch.com', 'E-mail support', 'btn primary'), link(`${SITE}/docs`, 'Guides'), el('button', { class: 'btn', onclick: () => tour() }, icon('spark'), 'Take the tour')),   // scrub-ok: the public support address
    item('Help', 'E-mail help from the CasaTorch team - for everyone. A community Discord is opening soon.', 'Included'),
    item('Home network design', 'Wi-Fi, wiring, cameras and sensors planned around your home, from someone with home and enterprise network design experience (Cisco Catalyst, Cisco Meraki). A clear, fixed quote first.', null, link('mailto:sales@casatorch.com?subject=Network%20project%20quote', 'Ask for a quote', 'btn small')),   // scrub-ok: the public sales address
    item('CasaTorch Box', 'A small box with CasaTorch already on it - for a second home, or a friend. Box Lite or Box, plug it in and go.', null, link(`${SITE}/box`, 'Order a Box', 'btn small')));
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
  const pro = el('div', { class: 'card', style: 'grid-column:1/-1' }, el('h2', {}, 'CasaTorch Pro'), el('div', { class: 'row between wrap' }, el('b', { style: 'font-size:18px' }, status), el('a', { href: 'https://casatorch.com/pro', target: '_blank', rel: 'noopener' }, '$5/mo or $49/yr')),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px 18px;margin:12px 0' }, PRO_FEATURES.map(([t, d, now]) => el('div', { style: 'padding:8px 0;border-top:1px solid var(--line)' }, el('b', {}, t), now ? el('span', { class: 'pill good', style: 'margin-left:6px' }, 'ready') : el('span', { class: 'pill', style: 'margin-left:6px' }, 'coming'), d ? el('div', { class: 'small muted' }, d) : null))),
    el('label', { class: 'field' }, el('span', {}, 'License key'), key), el('div', { class: 'row wrap' }, saveKey, el('span', { class: 'small muted' }, 'or'), el('button', { class: 'btn', onclick: () => claimKey(async () => { await loadStatus(); show('settings'); }) }, 'Get my key by e-mail')),
    el('p', { class: 'small muted' }, 'Bought Pro? "Get my key by e-mail" sends a code to the address you bought with - no copying keys around.'));

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
    [['Home Assistant', c.homeAssistant], ['Philips Hue', c.hue], ['Shelly devices', c.shelly], ['Cameras', c.cameras], ['YoLink', c.yolink], ['Ring', c.ring]].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, yes(v))]),
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
  const updates = await updatesCard(), phone = await phoneCard(), safety = await safetyCard(), secure = await remoteCard(), backup = await backupCard(s);
  main.replaceChildren(el('div', { class: 'cards' }, ...security, safety, secure, phone, pro, updates, backup, lookCard(), menuCard(), aiCard(s), homeCard, helpCard(), everyday, conn, acct));
  return null;
} });
/* Side-rail order */
const TAB_ORDER = ['home', 'alerts', 'controls', 'cameras', 'calendar', 'photos', 'energy', 'network', 'house3d', 'ask', 'connect', 'settings'];
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
  return el('div', { class: 'card' }, el('h2', {}, 'Backup'),
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
  return el('div', { class: 'card' }, el('h2', {}, 'Updates'),
    el('dl', { class: 'kv' }, el('dt', {}, 'This version'), el('dd', {}, u.version), el('dt', {}, 'Installed as'), el('dd', {}, INSTALLS[u.install] || u.install), el('dt', {}, 'Newest'), el('dd', {}, u.latest ? `${u.latest}${u.available ? ' - available' : ' - you have it'}` : !u.check ? 'not checking' : u.error ? 'could not check right now' : u.checked ? '-' : 'checks within a few minutes of starting')),
    u.available ? el('p', { class: 'small' }, u.how, ' ', el('a', { href: u.download, target: '_blank', rel: 'noopener' }, 'Downloads')) : null,
    sw('Check for updates once a day', u.check, (e) => save({ check: e.target.checked }), 'Sends only the version number to casatorch.com.'),
    u.canAuto ? sw('Install updates automatically overnight', u.auto, (e) => save({ auto: e.target.checked })) : null,
    f ? sw('Help me find this CasaTorch at casatorch.com/find', f.announce, async (e) => { try { await post('/api/find', { announce: e.target.checked }); toast('Saved'); } catch (err) { toast(err.message); } }, `Shares only its home-network address${f.address ? ` (${f.address})` : ''}, and only with browsers on your own internet connection.`) : null,
    el('div', { class: 'row wrap' }, checkBtn));
}
