/* ---- Settings: Pro, everyday values, what's connected, sign out ---- */
const PRO_FEATURES = [   // [name, what, ships now?]
  ['3D Home', 'Your LiDAR scan as a live, tappable floor plan.', true], ['Ring (Labs)', 'Ring doorbells and cameras without Home Assistant.', true],
  ['Away from home', 'Secure remote access and phone alerts - no port forwarding.'], ['Smart alerts', 'Quiet hours, "only if nobody\'s home", fewer false alarms.'],
  ['Energy insights', 'History, cost by device, and a weekly report.'], ['Ask the house', 'Plain-English questions about your home.'],
  ['Self-healing', 'Restarts stuck integrations and tells you what it fixed.'], ['History', '2 years instead of 7 days.'], ['Multi-home, themes, cloud backup, priority support', ''],
];
tab({ id: 'settings', label: 'Settings', async render(main) {
  const s = await api('/api/settings');
  const p = s.pro || {};
  const status = p.plan === 'trial' ? `Pro trial - ${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left` : p.pro ? `Pro (${p.plan})${p.email ? ` - ${p.email}` : ''}${p.expires ? `, renews ${fmt(p.expires, { dateStyle: 'medium' })}` : ''}` : 'Free';
  const key = el('textarea', { rows: 3, placeholder: 'Paste your HouseOS license key', spellcheck: 'false', autocomplete: 'off' });
  const save = el('button', { class: 'primary' }, 'Save key');
  save.onclick = async () => { try { await post('/api/license', { key: key.value }); toast('Pro is on. Thank you!'); await loadStatus(); show('settings'); } catch (err) { toast(err.message, 4000); } };
  const pro = el('div', { class: 'card span2' }, el('h2', {}, 'HouseOS Pro'), el('div', { class: 'row between wrap' }, el('b', {}, status), el('a', { href: 'https://houseos.dev/pro', target: '_blank', rel: 'noopener' }, 'Plans: $5/mo, $49/yr or $129 once')),
    el('div', { class: 'grid', style: 'margin:10px 0;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 14px' }, PRO_FEATURES.map(([t, d, now]) => el('div', { class: 'feature' }, el('b', {}, t), now ? null : el('span', { class: 'pill', style: 'margin-left:6px' }, 'coming'), d ? el('div', { class: 'small muted' }, d) : null))),
    el('label', { class: 'field' }, el('span', {}, 'License key'), key), save);

  const rate = el('input', { type: 'number', step: '0.01', min: '0', value: s.energy?.ratePerKwh ?? '', placeholder: '0.17' });
  const note = el('input', { type: 'text', maxlength: '280', value: s.note || '', placeholder: 'e.g. Plumber coming Thursday 10-12' });
  const saveV = el('button', {}, 'Save');
  saveV.onclick = async () => { try { await post('/api/settings', { ratePerKwh: rate.value === '' ? 0 : Number(rate.value), note: note.value }, 'PUT'); toast('Saved'); } catch (err) { toast(err.message); } };
  const everyday = el('div', { class: 'card' }, el('h2', {}, 'Everyday'), el('label', { class: 'field' }, el('span', {}, 'Electricity rate ($ per kWh)'), rate), el('label', { class: 'field' }, el('span', {}, 'Note on the Home screen'), note), saveV);

  const c = s.connected || {}, yes = (v) => (v ? (typeof v === 'number' ? `${v}` : 'Connected') : '-');
  const conn = el('div', { class: 'card' }, el('h2', {}, 'Connected'), el('dl', { class: 'kv' },
    [['Home Assistant', c.homeAssistant], ['Philips Hue', c.hue], ['Shelly devices', c.shelly], ['Cameras', c.cameras], ['YoLink', c.yolink], ['Ring', c.ring], ['Meraki', c.meraki], ['UniFi', c.unifi]].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, yes(v))]),
    el('dt', {}, 'Weather for'), el('dd', {}, s.location?.name || '-'), el('dt', {}, 'Calendars'), el('dd', {}, s.calendars?.join(', ') || '-'), el('dt', {}, 'Teams'), el('dd', {}, s.teams?.join(', ') || '-'), el('dt', {}, 'News'), el('dd', {}, s.feeds?.join(', ') || '-')));

  const pw = el('input', { type: 'password', placeholder: 'Your HouseOS password', autocomplete: 'current-password' });
  const rerun = el('button', {}, 'Run setup again');
  rerun.onclick = async () => { try { const r = await post('/api/settings/rerun-setup', { password: pw.value }); location.href = r.url; } catch (err) { toast(err.message); } };
  const out = el('button', {}, 'Sign out');
  out.onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; };
  const acct = el('div', { class: 'card' }, el('h2', {}, 'This HouseOS'), el('dl', { class: 'kv' }, el('dt', {}, 'House'), el('dd', {}, s.house?.name || '-'), el('dt', {}, 'Time zone'), el('dd', {}, s.house?.timezone || '-'), el('dt', {}, 'Version'), el('dd', {}, s.version)),
    el('p', { class: 'small muted' }, 'Change devices, calendars, teams and news by running setup again. Your existing settings are kept.'),
    s.demo ? null : el('label', { class: 'field' }, el('span', {}, 'Password (to run setup again)'), pw),
    el('div', { class: 'row wrap' }, rerun, s.signIn ? out : null),
    el('p', { class: 'small muted' }, `HouseOS ${s.version} \u00B7 open-source core (AGPL-3.0) \u00B7 `, el('a', { href: 'https://houseos.dev', target: '_blank', rel: 'noopener' }, 'houseos.dev')));
  main.replaceChildren(el('h1', {}, 'Settings'), el('div', { class: 'grid' }, pro, everyday, conn, acct));
  return null;
} });
