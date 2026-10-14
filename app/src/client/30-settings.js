/* ---- Settings ---- */
const PRO_FEATURES = [   // [name, what, ships now?]
  ['3D Home', 'Your LiDAR scan as a live, tappable floor plan.', true], ['Ask the house', 'Plain-English questions; it can switch things for you.', true], ['Ring (Labs)', 'Ring doorbells and cameras without Home Assistant.', true],
  ['Away from home', 'Secure remote access and phone alerts - no port forwarding.'], ['Smart alerts', 'Quiet hours, "only if nobody\'s home", fewer false alarms.'],
  ['Energy insights', 'History, cost by device, and a weekly report.'], ['Self-healing', 'Restarts stuck integrations and tells you what it fixed.'], ['History', '2 years instead of 7 days.'], ['Multi-home, themes, cloud backup, priority support', ''],
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
    help.textContent = { anthropic: 'Get a key at console.anthropic.com > API keys. You pay Anthropic per question (usually well under a cent).', openai: 'Get a key at platform.openai.com > API keys. You pay OpenAI per question.', ollama: 'Free and private: install Ollama on a PC or Mac at home, run "ollama pull llama3.1", and enter its address. Nothing leaves your network.', compatible: 'Any server that speaks the OpenAI API. Enter its base address (ending in /v1).', none: 'Pick an AI to answer questions about your home.' }[p];
  };
  prov.onchange = () => { model.replaceChildren(el('option', { value: '' }, 'Press "Find models" first')); sync(); }; sync();
  const find = el('button', { class: 'btn' }, 'Find models');
  find.onclick = async () => { msg.textContent = 'Checking...'; try { const r = await post('/api/settings/ai/models', { provider: prov.value, apiKey: key.value, url: url.value }); model.replaceChildren(...r.models.map((m) => el('option', { value: m, selected: m === r.suggested }, m))); msg.textContent = `Found ${r.models.length} models.`; msg.style.color = 'var(--good)'; } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--bad)'; } };
  const save = el('button', { class: 'btn primary' }, 'Save');
  save.onclick = async () => { try { await post('/api/settings/ai', { provider: prov.value, model: model.value, apiKey: key.value, url: url.value }, 'PUT'); S.settings = await api('/api/settings'); toast('Saved - try the Ask tab'); } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--bad)'; } };
  return el('div', { class: 'card' }, el('h2', {}, icon('spark', 15), 'Ask the house', el('span', { class: 'pill pro' }, 'PRO')), el('label', { class: 'field' }, el('span', {}, 'AI'), prov), help, keyF, urlF,
    el('label', { class: 'field' }, el('span', {}, 'Model'), model), el('div', { class: 'row wrap' }, find, save), msg);
}
tab({ id: 'settings', label: 'Settings', icon: 'gear', async render(main) {
  const s = await api('/api/settings'); S.settings = s;
  const p = s.pro || {};
  const status = p.plan === 'trial' ? `Pro trial - ${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left` : p.pro ? `Pro (${p.plan})${p.email ? ` - ${p.email}` : ''}${p.expires ? `, renews ${fmt(p.expires, { dateStyle: 'medium' })}` : ''}` : 'Free';
  const key = el('textarea', { rows: 3, placeholder: 'Paste your HouseOS license key', spellcheck: 'false', autocomplete: 'off' });
  const saveKey = el('button', { class: 'btn primary' }, 'Save key');
  saveKey.onclick = async () => { try { await post('/api/license', { key: key.value }); toast('Pro is on. Thank you!'); await loadStatus(); show('settings'); } catch (err) { toast(err.message, 4000); } };
  const pro = el('div', { class: 'card', style: 'grid-column:1/-1' }, el('h2', {}, 'HouseOS Pro'), el('div', { class: 'row between wrap' }, el('b', { style: 'font-size:18px' }, status), el('a', { href: 'https://gethouseos.com/pro', target: '_blank', rel: 'noopener' }, '$5/mo, $49/yr or $129 once')),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px 18px;margin:12px 0' }, PRO_FEATURES.map(([t, d, now]) => el('div', { style: 'padding:8px 0;border-top:1px solid var(--line)' }, el('b', {}, t), now ? el('span', { class: 'pill good', style: 'margin-left:6px' }, 'ready') : el('span', { class: 'pill', style: 'margin-left:6px' }, 'coming'), d ? el('div', { class: 'small muted' }, d) : null))),
    el('label', { class: 'field' }, el('span', {}, 'License key'), key), saveKey);

  const rate = el('input', { type: 'number', step: '0.01', min: '0', value: s.energy?.ratePerKwh ?? '', placeholder: '0.17' });
  const note = el('input', { type: 'text', maxlength: '280', value: s.note || '', placeholder: 'e.g. Plumber coming Thursday 10-12' });
  const saveV = el('button', { class: 'btn' }, 'Save');
  saveV.onclick = async () => { try { await post('/api/settings', { ratePerKwh: rate.value === '' ? 0 : Number(rate.value), note: note.value }, 'PUT'); toast('Saved'); } catch (err) { toast(err.message); } };
  const everyday = el('div', { class: 'card' }, el('h2', {}, 'Everyday'), el('label', { class: 'field' }, el('span', {}, 'Electricity rate ($ per kWh)'), rate), el('label', { class: 'field' }, el('span', {}, 'Note on the Home screen'), note), saveV);

  const homeCard = el('div', { class: 'card' }, el('h2', {}, 'Home screen'), el('p', { class: 'small muted', style: 'margin-top:0' }, 'Add widgets, drag them around and resize them right on the Home screen (Edit layout). The layout is saved on this HouseOS, so every screen in the house matches.'),
    el('div', { class: 'row wrap' }, el('a', { class: 'btn primary', href: '#home', onclick: () => setTimeout(() => $('.top .btn.primary')?.click(), 400) }, icon('plus'), 'Add a widget'), el('button', { class: 'btn', onclick: async () => { await post('/api/layout', { reset: true }, 'PUT'); toast('Home screen reset'); } }, icon('reset'), 'Reset layout'), el('a', { class: 'btn', href: '#photos' }, 'Manage photos'), el('a', { class: 'btn', href: '#calendar' }, 'Calendar')));

  const c = s.connected || {}, yes = (v) => (v ? (typeof v === 'number' ? `${v}` : 'Connected') : '-');
  const conn = el('div', { class: 'card' }, el('h2', {}, 'Connected'), el('dl', { class: 'kv' },
    [['Home Assistant', c.homeAssistant], ['Philips Hue', c.hue], ['Shelly devices', c.shelly], ['Cameras', c.cameras], ['YoLink', c.yolink], ['Ring', c.ring], ['Meraki', c.meraki], ['UniFi', c.unifi]].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, yes(v))]),
    el('dt', {}, 'Weather for'), el('dd', {}, s.location?.name || '-'), el('dt', {}, 'Calendars'), el('dd', {}, [...(s.calendars || []), 'HouseOS calendar'].join(', ')), el('dt', {}, 'Teams'), el('dd', {}, s.teams?.join(', ') || '-'), el('dt', {}, 'News'), el('dd', {}, s.feeds?.join(', ') || '-')));

  const pw = el('input', { type: 'password', placeholder: 'Your HouseOS password', autocomplete: 'current-password' });
  const rerun = el('button', { class: 'btn' }, 'Run setup again');
  rerun.onclick = async () => { try { const r = await post('/api/settings/rerun-setup', { password: pw.value }); location.href = r.url; } catch (err) { toast(err.message); } };
  const out = el('button', { class: 'btn ghost' }, 'Sign out');
  out.onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; };
  const acct = el('div', { class: 'card' }, el('h2', {}, 'This HouseOS'), el('dl', { class: 'kv' }, el('dt', {}, 'House'), el('dd', {}, s.house?.name || '-'), el('dt', {}, 'Time zone'), el('dd', {}, s.house?.timezone || '-'), el('dt', {}, 'Version'), el('dd', {}, s.version)),
    el('p', { class: 'small muted' }, 'Change devices, calendars, teams and news by running setup again. Your existing settings are kept.'),
    s.demo ? null : el('label', { class: 'field' }, el('span', {}, 'Password (to run setup again)'), pw),
    el('div', { class: 'row wrap' }, rerun, s.signIn ? out : null),
    el('p', { class: 'small muted' }, `HouseOS ${s.version} · open-source core (AGPL-3.0) · `, el('a', { href: 'https://gethouseos.com', target: '_blank', rel: 'noopener' }, 'gethouseos.com')));
  main.replaceChildren(el('div', { class: 'cards' }, pro, aiCard(s), homeCard, everyday, conn, acct));
  return null;
} });
/* Side-rail order */
const TAB_ORDER = ['home', 'alerts', 'controls', 'cameras', 'calendar', 'photos', 'energy', 'network', 'house3d', 'ask', 'settings'];
TABS.sort((a, b) => TAB_ORDER.indexOf(a.id) - TAB_ORDER.indexOf(b.id));
