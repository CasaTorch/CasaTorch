/* ======================================================================
 * Settings › Alerts: what each kind of alert does - in the app, on your
 * phones, its sound, reminders - as one simple table, with an "Advanced"
 * sheet per kind and per device. "My phones" is each person's own; an admin
 * also sets the household's defaults. The server decides (40r-alert-rules.js);
 * this page only shows and changes the rules.
 * Also here: the actions on an alert (Got it, snooze, mark resolved, mute
 * the device), "Alerts for this device" on a device's sheet, and wall panels
 * saying an alert out loud when its rule says so.
 * ====================================================================== */
const AR = { data: null, scope: 'mine' };
const arSoundLabel = { auto: 'Automatic', urgent: 'Urgent', normal: 'Normal', silent: 'Silent' };
const arPanelLabel = { show: 'Show', announce: 'Show and say it out loud', off: 'Don\'t show' };
const arPresenceLabel = { any: 'Always', away: 'Only when nobody\'s home', home: 'Only when someone\'s home' };
const arRepeatLabel = (n) => (n ? T('Every {n} min', { n }) : T('Off'));
const arHoursLabel = (h) => (h < 24 ? T(h === 1 ? '{n} hour' : '{n} hours', { n: h }) : h === 168 ? T('1 week') : T(h === 24 ? '{n} day' : '{n} days', { n: h / 24 }));
const arWhy = { 'phone-level': 'This phone\'s "Send" level leaves it out', 'not-this-phone': 'Not picked for this phone', off: 'Push is off', 'safety-floor': 'Safety alerts always go', snoozed: 'Snoozed', muted: 'Muted', 'no-repeat': 'No reminders', 'presence-needs-pro': 'Only when away/home needs Pro', 'someone-home': 'Someone is home', 'nobody-home': 'Nobody is home', 'quiet-hours': 'Held by quiet hours', 'breaks-quiet': 'Breaks through quiet hours', digest: 'Saved for the daily summary', 'repeat-needs-pro': 'Reminders for this kind need Pro', cleared: 'Cleared' };

async function arLoad() { AR.data = await api('/api/alerts/rules'); if (!AR.data.admin) AR.scope = 'mine'; return AR.data; }
const arKind = (id) => AR.data?.kinds.find((k) => k.id === id);
/** Save a rule change; a safety alert being turned off asks first and says what that risks. */
async function arSave(body, { safety = false } = {}) {
  const url = `/api/alerts/rules/${AR.scope === 'house' ? 'house' : 'mine'}`;
  try { await post(url, body, 'PUT'); }
  catch (err) {
    if (!err.body?.needsConfirm) { toast(err.message, 5000); return false; }
    if (!confirm(T('Turn this safety alert off? You could miss a water leak, smoke or a freezing pipe while it is off. It still shows in the app and on wall panels.'))) return false;
    try { await post(url, { ...body, rule: { ...(body.rule || {}), confirm: true } }, 'PUT'); } catch (e) { toast(e.message, 5000); return false; }
  }
  toast(T('Saved')); await arLoad(); return true;
}
const arEff = (k) => { const e = AR.data.effective[k] || {}; return AR.scope === 'house' ? e.house || e : e; };
const arSwitch = (on, onchange, { label, disabled = false, title } = {}) => el('label', { class: 'ar-sw', title: title || null }, el('input', { type: 'checkbox', role: 'switch', checked: on ? true : null, disabled: disabled ? true : null, 'aria-label': label || null, onchange }), el('i'));
const arSelect = (value, opts, onchange, label) => el('select', { class: 'ar-sel', 'aria-label': label || null, onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => el('option', { value: String(v), selected: String(v) === String(value) ? true : null }, l)));

/* ---- the table ---- */
function arMatrix(redraw) {
  const d = AR.data, rows = [];
  const head = el('div', { class: 'ar-row ar-head', role: 'row' }, el('span', { role: 'columnheader' }, T('Kind of alert')), el('span', { role: 'columnheader' }, T('In app')), el('span', { role: 'columnheader' }, T('Push')), el('span', { role: 'columnheader' }, T('Sound')), el('span', { role: 'columnheader' }, T('Repeat')), el('span'));
  for (const k of d.kinds) {
    const e = arEff(k.id), name = el('div', { class: 'ar-name', role: 'rowheader' }, el('span', { class: 'ar-ic' }, icon(k.icon, 16)), el('span', { class: 'grow', style: 'min-width:0' }, el('b', {}, T(k.label)),
      k.safety ? el('span', { class: 'pill ar-safe' }, T('Safety')) : null, k.coming ? el('span', { class: 'pill' }, T('Coming')) : null));
    if (k.reminder) {   // each reminder says whether it goes to phones (Household, Reminders); the rules here fine-tune that (40r-alert-rules.js)
      const save = (rule) => arSave({ kind: k.id, rule }).then((ok) => ok && redraw());
      name.querySelector('.grow').append(el('div', { class: 'tiny muted' }, T('Each reminder also says whether it goes to phones:'), ' ', el('a', { href: k.id === 'household' ? '#settings/household' : '#reminders' }, k.id === 'household' ? T('Household') : T('Reminders'))));
      rows.push(el('div', { class: 'ar-row', role: 'row' }, name,
        el('span', { class: 'ar-cell', 'data-l': T('In app') }, el('span', { class: 'tiny muted' }, T('On screens'))),
        el('span', { class: 'ar-cell', 'data-l': T('Push') }, arSwitch(e.push, (ev) => save({ push: ev.target.checked ? null : false }), { label: `${T(k.label)}: ${T('Push')}` })),
        el('span', { class: 'ar-cell', 'data-l': T('Sound') }, arSelect(e.rule?.sound || 'auto', d.sounds.map((x) => [x, T(arSoundLabel[x])]), (v) => save({ sound: v }), `${T(k.label)}: ${T('Sound')}`)),
        el('span', { class: 'ar-cell', 'data-l': T('Repeat') }, el('span', { class: 'tiny muted' }, '-')),
        el('span', { class: 'ar-cell ar-more' }, el('button', { class: 'btn small ghost', 'aria-label': `${T('Advanced')}: ${T(k.label)}`, onclick: () => arKindSheet(k.id, redraw) }, el('span', { class: 'hide-phone' }, T('Advanced')), icon('chevr', 14)))));
      continue;
    }
    const save = (rule) => arSave({ kind: k.id, rule }, { safety: k.safety }).then((ok) => ok && redraw());
    const repOpts = [['', T('Automatic')], ...d.repeats.map((n) => [n, arRepeatLabel(n)])];
    const repLocked = !d.pro && !k.safety;
    rows.push(el('div', { class: 'ar-row', role: 'row' }, name,
      el('span', { class: 'ar-cell', 'data-l': T('In app') }, arSwitch(e.app, (ev) => save({ app: ev.target.checked }), { label: `${T(k.label)}: ${T('In app')}`, disabled: k.safety, title: k.safety ? T('Safety alerts always show in the app') : null })),
      el('span', { class: 'ar-cell', 'data-l': T('Push') }, arSwitch(e.push, (ev) => save({ push: ev.target.checked, ...(ev.target.checked ? { digest: false } : {}) }), { label: `${T(k.label)}: ${T('Push')}` }), e.digest ? el('span', { class: 'tiny muted' }, T('daily')) : null),
      el('span', { class: 'ar-cell', 'data-l': T('Sound') }, arSelect(e.rule?.sound || 'auto', d.sounds.map((s) => [s, T(arSoundLabel[s])]), (v) => save({ sound: v }), `${T(k.label)}: ${T('Sound')}`)),
      el('span', { class: 'ar-cell', 'data-l': T('Repeat') }, repLocked ? el('span', { class: 'pill pro', title: T('Reminders until someone taps "Got it" are part of Smart alerts (Pro). Safety alerts repeat on every edition.') }, 'Pro')
        : arSelect(e.rule?.repeat ?? '', repOpts, (v) => save({ repeat: v === '' ? null : Number(v) }), `${T(k.label)}: ${T('Repeat')}`)),
      el('span', { class: 'ar-cell ar-more' }, el('button', { class: 'btn small ghost', 'aria-label': `${T('Advanced')}: ${T(k.label)}`, onclick: () => arKindSheet(k.id, redraw) }, el('span', { class: 'hide-phone' }, T('Advanced')), icon('chevr', 14)))));
  }
  return el('div', { class: 'ar-matrix', role: 'table', 'aria-label': T('Alerts') }, head, ...rows);
}

/* ---- the Advanced sheet: one kind, or one device ---- */
function arRuleFields(rule, eff, { safety, save, kindId, tri = false, reminder = false }) {
  const d = AR.data, r = rule || {}, f = [];
  const row = (label, ctl, help) => el('div', { class: 'ar-field' }, el('div', { class: 'grow' }, el('div', {}, label), help ? el('div', { class: 'tiny muted' }, help) : null), ctl);
  /* a device's own rule: Automatic (as its kind says), On or Off */
  const triSel = (k) => arSelect(r[k] == null ? '' : r[k] ? 'on' : 'off', [['', T('As its kind says')], ['on', T('On')], ['off', T('Off')]], (v) => save({ [k]: v === '' ? null : v === 'on' }));
  if (safety) f.push(row(T('Show in the app'), arSwitch(true, () => {}, { disabled: true }), T('Safety alerts always show in the app.')));
  else if (!reminder) f.push(row(T('Show in the app'), tri ? triSel('app') : arSwitch(eff.app, (e) => save({ app: e.target.checked }))));
  if (reminder) f.push(row(T('Push to phones'), arSwitch(eff.push, (e) => save({ push: e.target.checked ? null : false })), T('On: each reminder set to "Send it to phones" goes. Off: none of them do.')));
  else f.push(row(T('Push to phones'), tri ? triSel('push') : arSwitch(eff.push, (e) => save({ push: e.target.checked })), !tri && r.push == null ? T('Automatic: as each phone\'s "Send" level says.') : null));
  const phones = d.targets || [];
  if (phones.length > 1) {
    const picked = Array.isArray(r.phones) ? r.phones : phones.map((p) => p.id);
    f.push(el('div', { class: 'ar-field col' }, el('div', {}, T('Which phones')), el('div', { class: 'ar-phones' }, phones.map((p) => el('label', { class: 'switch-row small' }, el('input', { type: 'checkbox', checked: picked.includes(p.id) ? true : null, onchange: (e) => {
      const next = new Set(picked); if (e.target.checked) next.add(p.id); else next.delete(p.id);
      save({ phones: next.size === phones.length ? 'all' : [...next] });
    } }), el('span', {}, p.name))))));
  }
  f.push(row(T('Sound'), arSelect(r.sound || 'auto', d.sounds.map((s) => [s, T(arSoundLabel[s])]), (v) => save({ sound: v })), T('Urgent: stays on the lock screen and gets through Focus where the phone allows it. Automatic: urgent for critical alerts.')));
  if (reminder) { /* reminders don't repeat; screens show them until someone taps Done */ }
  else if (!d.pro && !safety) f.push(row(T('Repeat until someone taps "Got it"'), el('span', { class: 'pill pro' }, 'Pro')));
  else f.push(row(T('Repeat until someone taps "Got it"'), arSelect(r.repeat ?? '', [['', T('Automatic')], ...d.repeats.map((n) => [n, arRepeatLabel(n)])], (v) => save({ repeat: v === '' ? null : Number(v) })), T('Up to 6 reminders. Automatic: critical alerts every 10 minutes.')));
  f.push(row(T('Quiet hours'), arSelect(r.quiet || (reminder ? 'ignore' : 'follow'), [['follow', T('Wait until quiet hours end')], ['ignore', T('Send during quiet hours too')]], (v) => save({ quiet: v })), safety ? T('Safety alerts always break through quiet hours.') : null));
  if (!safety && !reminder) {
    const pres = arSelect(r.presence || 'any', Object.entries(arPresenceLabel).map(([v, l]) => [v, T(l)]), (v) => save({ presence: v }));
    if (!d.pro || !d.presence) pres.disabled = true;
    f.push(row(T('When'), el('span', { class: 'row', style: 'gap:6px' }, pres, !d.pro ? el('span', { class: 'pill pro' }, 'Pro') : null), d.presence ? T('Uses the people and phones Home Assistant tracks.') : T('Needs people or phones tracked in Home Assistant.')));
    f.push(row(T('Daily summary instead of right away'), arSwitch(!!r.digest, (e) => save({ digest: e.target.checked })), T('One push a day at {time} with everything saved up.', { time: hm(d.house.digestTime) })));
  }
  if (!reminder) f.push(row(T('Wall panels'), arSelect(r.panel || 'show', Object.entries(arPanelLabel).filter(([v]) => !(safety && v === 'off')).map(([v, l]) => [v, T(l)]), (v) => save({ panel: v }))));
  if (kindId) f.push(el('div', { class: 'row wrap', style: 'gap:8px;margin-top:12px' }, arTestButton(kindId),
    el('button', { class: 'btn small ghost', onclick: () => save({ app: null, push: null, phones: null, sound: null, repeat: null, quiet: null, presence: null, digest: null, panel: null }) }, icon('reset', 14), T('Back to automatic'))));
  return f;
}
function arKindSheet(kindId, after) {
  const k = arKind(kindId); if (!k) return;
  const body = el('div', { class: 'ar-sheet' });
  const draw = () => {
    const e = arEff(kindId), rule = (AR.scope === 'house' ? AR.data.house.kinds : AR.data.mine.kinds)[kindId] || {};
    body.replaceChildren(el('p', { class: 'small muted', style: 'margin-top:0' }, AR.scope === 'house' ? T('Household default - each person can change it for their own phones.') : T('Just for you and your phones.')),
      ...arRuleFields(rule, e, { safety: k.safety, kindId, reminder: !!k.reminder, save: async (patch) => { if (await arSave({ kind: kindId, rule: patch }, { safety: k.safety })) { draw(); after?.(); } } }));
  };
  draw();
  modal(body, { title: T(k.label) });
}
/** "Alerts for this device": the device's own rule, on top of its kind's. */
async function arDeviceSheet(dev) {
  if (!AR.data) { try { await arLoad(); } catch (e) { toast(e.message); return; } }
  const safety = dev.safety ?? (dev.icon === 'drop' || dev.icon === 'fire' || dev.water != null || dev.smoke != null);
  const body = el('div', { class: 'ar-sheet' });
  const draw = () => {
    const store = AR.scope === 'house' ? AR.data.house.devices : AR.data.mine.devices, rule = store[dev.id] || {};
    const eff = { app: rule.app !== false, push: rule.push ?? true };
    const scopeSeg = AR.data.admin ? arScopeSeg(draw) : null;
    body.replaceChildren(scopeSeg, el('p', { class: 'small muted' }, T('Changes here apply only to {name}, on top of the rules for its kind of alert.', { name: dev.name })),
      ...arRuleFields(rule, eff, { safety, tri: true, save: async (patch) => { if (await arSave({ device: dev.id, safety, rule: patch }, { safety })) draw(); } }),
      el('div', { class: 'row wrap', style: 'gap:8px;margin-top:12px' }, el('button', { class: 'btn small', onclick: () => arMuteDialog({ device: dev.id, name: dev.name, safety }) }, icon('pause', 14), T('Mute for a while')),
        Object.keys(rule).length ? el('button', { class: 'btn small ghost', onclick: async () => { if (await arSave({ device: dev.id, safety, rule: Object.fromEntries(Object.keys(rule).map((k) => [k, null])) }, { safety })) draw(); } }, icon('reset', 14), T('Back to automatic')) : null));
  };
  draw();
  modal(body, { title: T('Alerts for {name}', { name: dev.name }) });
}
/** "Alerts for this room": the household's rule for everything in one room (a Home Assistant area). */
function arRoomSheet(room, after) {
  const body = el('div', { class: 'ar-sheet' });
  const saveHouse = async (patch) => { const was = AR.scope; AR.scope = 'house'; const ok = await arSave({ room, rule: patch }); AR.scope = was; return ok; };
  const draw = () => {
    const rule = AR.data.house.rooms?.[room] || {};
    body.replaceChildren(el('p', { class: 'small muted', style: 'margin-top:0' }, T('Changes here apply to everything in {room}, on top of the rules for each kind of alert. Safety alerts still always show and break through quiet hours.', { room })),
      ...arRuleFields(rule, { app: rule.app !== false, push: rule.push ?? true }, { safety: false, tri: true, save: async (patch) => { if (await saveHouse(patch)) { draw(); after?.(); } } }),
      Object.keys(rule).length ? el('div', { class: 'row wrap', style: 'gap:8px;margin-top:12px' }, el('button', { class: 'btn small ghost', onclick: async () => { if (await saveHouse(Object.fromEntries(Object.keys(rule).map((k) => [k, null])))) { draw(); after?.(); } } }, icon('reset', 14), T('Back to automatic'))) : null);
  };
  draw();
  modal(body, { title: T('Alerts for {name}', { name: room }) });
}
function arScopeSeg(redraw) {
  const box = el('div', { class: 'seg seg-mini', role: 'tablist' });
  const paint = () => box.replaceChildren(...[['mine', T('My phones')], ['house', T('Household defaults')]].map(([v, l]) => el('button', { class: AR.scope === v ? 'on' : null, role: 'tab', 'aria-selected': String(AR.scope === v), onclick: () => { AR.scope = v; paint(); redraw(); } }, l)));
  paint(); return box;
}

/* ---- mute, snooze, test ---- */
function arMuteDialog({ device, kind, name, safety }) {
  const d = AR.data || {}, hours = d.muteHours || [1, 2, 4, 8, 12, 24, 72, 168];
  const pick = arSelect(4, hours.map((h) => [h, arHoursLabel(h)]), () => {}, T('For how long'));
  const who = d.admin ? arSelect('me', [['me', T('Just my phones')], ['all', T('Everyone')]], () => {}, T('For whom')) : null;
  const go = el('button', { class: 'btn primary', onclick: async () => {
    if (safety && !confirm(T('Mute a safety alert? Pushes stop for the time you picked - you could miss a water leak, smoke or a freezing pipe. It still shows in the app.'))) return;
    try { await post('/api/alerts/mute', { device, kind, name, hours: Number(pick.value), everyone: who?.value === 'all', confirm: !!safety }); toast(T('Muted')); m.remove(); await arLoad().catch(() => {}); arRefresh(); }
    catch (err) { toast(err.message, 5000); }
  } }, icon('pause', 14), T('Mute'));
  const m = modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('No pushes or reminders from this for a while. It still shows in the app.')),
    el('label', { class: 'field' }, el('span', {}, T('For how long')), pick), who ? el('label', { class: 'field' }, el('span', {}, T('For whom')), who) : null, go), { title: T('Mute {name}', { name: name || '' }) });
}
function arTestButton(kindId) {
  return el('button', { class: 'btn small', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await post('/api/alerts/test', { kind: kindId });
      const lines = r.phones.length ? r.phones.map((p) => `${p.name}: ${p.push ? T('sent') : p.digest ? T('saved for the daily summary') : T('not sent')}${p.why.length ? ` (${p.why.map((w) => T(arWhy[w] || w)).join(', ')})` : ''}`) : [T('No phones with alerts on for you yet - turn them on in Settings › Phones & alerts.')];
      if (r.panel === 'announce' && isPanel()) arAnnounce({ title: T('Test'), severity: 'notice', sound: r.sound });
      modal(el('div', {}, el('p', { class: 'small', style: 'margin-top:0' }, r.app ? T('In the app: shown') : T('In the app: not shown')), el('ul', { class: 'list' }, lines.map((l) => el('li', {}, l)))), { title: T('Test sent') });
    } catch (err) { toast(err.message, 5000); }
    b.disabled = false;
  } }, icon('send', 14), T('Send a test of this kind'));
}
let arRefresh = () => {};

/* ---- the Settings section ---- */
async function alertRulesCards() {
  try { await arLoad(); } catch (e) { return [el('div', { class: 'card' }, el('p', { class: 'muted' }, e.message))]; }
  const main = el('div', { class: 'card ar-card' }), times = el('div', { class: 'card' }), devs = el('div', { class: 'card' }), rooms = el('div', { class: 'card' }), mutes = el('div', { class: 'card' });
  const draw = () => {
    const d = AR.data;
    main.replaceChildren(el('div', { class: 'row between wrap', style: 'gap:10px' }, el('h2', { style: 'margin:0' }, icon('bell', 15), T('What each alert does')), d.admin ? arScopeSeg(draw) : null),
      el('p', { class: 'small muted' }, AR.scope === 'house' ? T('The household\'s defaults. Each person can change them for their own phones.') : T('For you and your phones. Water, smoke and freezing always show and always break through quiet hours.')),
      arMatrix(draw),
      el('p', { class: 'tiny muted' }, T('Automatic keeps what CasaTorch did before: each phone\'s "Send" level, and critical alerts repeating every 10 minutes.')));
    drawTimes(); drawDevs(); drawRooms(); drawMutes();
  };
  arRefresh = () => { if (main.isConnected) draw(); };
  const drawTimes = () => {
    const d = AR.data, q = (spec) => (spec === 'none' ? ['', ''] : String(spec).split('-').map((x) => (x.includes(':') ? x.padStart(5, '0') : `${String(x).padStart(2, '0')}:00`)));
    const qEditor = (spec, onSave, allowHouse) => {
      const mode = arSelect(spec === 'house' ? 'house' : spec === 'none' ? 'none' : 'custom', [...(allowHouse ? [['house', T('Same as the household')]] : []), ['custom', T('From… to…')], ['none', T('No quiet hours')]], (v) => { box.hidden = v !== 'custom'; if (v !== 'custom') onSave(v); });
      const [a, b] = q(spec === 'house' ? d.house.quietHours : spec);
      const from = el('input', { type: 'time', value: a || '22:00', 'aria-label': T('From') }), to = el('input', { type: 'time', value: b || '07:00', 'aria-label': T('To') });
      const ok = el('button', { class: 'btn small', onclick: () => onSave(`${from.value}-${to.value}`) }, T('Save'));
      const box = el('span', { class: 'row', style: 'gap:6px' }, from, el('span', { class: 'muted' }, '–'), to, ok); box.hidden = !(spec !== 'house' && spec !== 'none');
      return el('div', { class: 'row wrap', style: 'gap:8px' }, mode, box);
    };
    const mineQ = qEditor(d.mine.quietHours, (v) => arSaveScoped('mine', { quietHours: v }), true);
    const brk = arSwitch(d.mine.quietBreak ?? d.house.quietBreak, (e) => arSaveScoped('mine', { quietBreak: e.target.checked }), { label: T('Critical alerts break through quiet hours') });
    times.replaceChildren(el('h2', {}, icon('clock', 15), T('Quiet hours & daily summary')),
      el('div', { class: 'ar-field col' }, el('div', {}, T('My quiet hours')), mineQ),
      el('div', { class: 'ar-field' }, el('div', { class: 'grow' }, el('div', {}, T('Critical alerts break through quiet hours')), el('div', { class: 'tiny muted' }, T('Like the internet going down. Water, smoke and freezing always break through.'))), brk),
      d.admin ? el('div', { class: 'ar-field col' }, el('div', {}, T('Household quiet hours')), qEditor(d.house.quietHours, (v) => arSaveScoped('house', { quietHours: v }), false)) : null,
      d.admin ? el('div', { class: 'ar-field' }, el('div', { class: 'grow' }, el('div', {}, T('Daily summary at')), el('div', { class: 'tiny muted' }, T('For kinds set to "Daily summary instead of right away".'))),
        el('input', { type: 'time', value: d.house.digestTime, style: 'max-width:130px', onchange: (e) => arSaveScoped('house', { digestTime: e.target.value }) })) : null);
  };
  const arSaveScoped = async (scope, body) => { const was = AR.scope; AR.scope = scope; const ok = await arSave(body); AR.scope = was; if (ok) draw(); };
  const drawDevs = () => {
    const d = AR.data, over = AR.scope === 'house' ? d.house.devices : d.mine.devices, byId = new Map(d.devices.map((x) => [x.id, x]));
    const list = Object.keys(over).map((id) => byId.get(id) || { id, name: id });
    const search = el('input', { type: 'search', placeholder: T('Find a device, camera or sensor'), 'aria-label': T('Find a device, camera or sensor') });
    const hits = el('div', { class: 'ar-hits' });
    search.oninput = () => { const q = search.value.trim().toLowerCase(); hits.replaceChildren(...(q ? d.devices.filter((x) => `${x.name} ${x.room || ''}`.toLowerCase().includes(q)).slice(0, 8) : []).map((x) => el('button', { class: 'btn small ghost ar-hit', onclick: () => arDeviceSheet(x).then(() => {}) }, icon(x.icon, 14), x.name, x.room ? el('span', { class: 'tiny muted' }, ` · ${x.room}`) : null))); };
    devs.replaceChildren(el('h2', {}, icon('sliders', 15), T('Devices and cameras')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, T('Give one device its own rules - say, no pushes from the garage freezer, or only the front door camera when nobody\'s home.')),
      list.length ? el('div', { class: 'list' }, list.map((x) => el('div', { class: 'row between', style: 'padding:6px 0;gap:8px' }, el('span', { class: 'row', style: 'gap:8px;min-width:0' }, icon(x.icon || 'dotc', 14), el('span', { class: 'ellipsis' }, x.name)), el('button', { class: 'btn small', onclick: () => arDeviceSheet(x) }, T('Edit'))))) : el('p', { class: 'small muted' }, T('No device has its own rules yet.')),
      d.devices.length ? el('div', {}, search, hits) : el('p', { class: 'small muted' }, T('Devices show here once they are connected.')));
  };
  /* A whole room (Home Assistant areas): household defaults only, on top of each kind's rule; a device's own rule wins. */
  const drawRooms = () => {
    const d = AR.data;
    if (!d.admin) { rooms.hidden = true; return; }
    const set = d.house.rooms || {}, known = [...new Set([...d.devices.map((x) => x.room).filter(Boolean), ...Object.keys(set)])].sort((a, b) => a.localeCompare(b));
    const pick = arSelect('', [['', T('Pick a room…')], ...known.filter((r) => !set[r]).map((r) => [r, r])], (v) => { if (v) arRoomSheet(v, () => { arLoad().then(drawRooms).catch(() => {}); }); }, T('Room'));
    rooms.replaceChildren(el('h2', {}, icon('home', 15), T('Rooms')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, T('Give a whole room its own rules - say, no pushes from anything in the garage at night. A device\'s own rule wins over its room\'s. Rooms are household defaults.')),
      Object.keys(set).length ? el('div', { class: 'list' }, Object.keys(set).sort((a, b) => a.localeCompare(b)).map((r) => el('div', { class: 'row between', style: 'padding:6px 0;gap:8px' }, el('span', { class: 'row', style: 'gap:8px;min-width:0' }, icon('home', 14), el('span', { class: 'ellipsis' }, r)),
        el('button', { class: 'btn small', onclick: () => arRoomSheet(r, () => { arLoad().then(drawRooms).catch(() => {}); }) }, T('Edit'))))) : el('p', { class: 'small muted' }, T('No room has its own rules yet.')),
      known.length ? pick : el('p', { class: 'small muted' }, T('Rooms show here once your devices are in Home Assistant areas.')));
  };
  const drawMutes = () => {
    const d = AR.data;
    const kindPick = arSelect('doorbell', d.kinds.filter((k) => !k.reminder).map((k) => [k.id, T(k.label)]), () => {}, T('Kind of alert'));
    mutes.replaceChildren(el('h2', {}, icon('pause', 15), T('Muted for now')),
      d.mutes.length ? el('div', { class: 'list' }, d.mutes.map((m) => el('div', { class: 'row between', style: 'padding:6px 0;gap:8px' }, el('div', { style: 'min-width:0' }, el('b', {}, m.kind ? T(arKind(m.kind)?.label || m.kind) : m.name || m.device), el('div', { class: 'tiny muted' }, `${m.scope === 'house' ? T('Everyone') : T('Just my phones')} · ${T('until {when}', { when: fmtWhen(new Date(m.until).toISOString()) })}`)),
        (m.mine || d.admin) ? el('button', { class: 'btn small ghost', onclick: async () => { try { await api(`/api/alerts/mute/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); await arLoad(); drawMutes(); toast(T('Unmuted')); } catch (e) { toast(e.message); } } }, T('Unmute')) : null))) : el('p', { class: 'small muted', style: 'margin-top:0' }, T('Nothing is muted.')),
      el('div', { class: 'row wrap', style: 'gap:8px' }, kindPick, el('button', { class: 'btn small', onclick: () => { const k = arKind(kindPick.value); arMuteDialog({ kind: k.id, name: T(k.label), safety: k.safety }); } }, icon('pause', 14), T('Mute a kind for a while'))));
  };
  draw();
  return [main, times, devs, rooms, mutes];
}

/* ---- on an alert (the Alerts page): Got it, and More: snooze, mark resolved, mute the device, its rules ---- */
function alertActions(x, ctx) {
  if (S.status?.demo) return null;
  const done = (msg) => { toast(msg); ctx?.refresh?.(); };
  const ack = !x.acked ? el('button', { class: 'btn small', onclick: async (e) => { e.currentTarget.disabled = true; try { await post(`/api/alerts/${encodeURIComponent(x.id)}/ack`); done(x.repeating ? T('Got it - no more reminders for this one') : T('Got it')); } catch (err) { toast(err.message); e.target.disabled = false; } } }, icon('check'), T('Got it')) : null;
  const more = el('button', { class: 'btn small ghost', 'aria-label': T('More for this alert'), onclick: () => alertSheet(x, ctx) }, '•••');
  return el('span', { class: 'row', style: 'gap:6px;flex:none' }, ack, more);
}
function alertSheet(x, ctx) {
  const done = (msg) => { toast(msg); m.remove(); ctx?.refresh?.(); };
  const hoursSel = arSelect(1, [1, 4, 8, 24].map((h) => [h, arHoursLabel(h)]), () => {}, T('For how long'));
  const open = x.since != null;   // on the list right now (history entries have only "at")
  const kind = x.alertKind ? { id: x.alertKind, label: arKind(x.alertKind)?.label } : null;
  const body = el('div', { class: 'ar-sheet' },
    el('p', { class: 'small muted', style: 'margin-top:0' }, [srcName(x.source), x.since ? T('since {when}', { when: fmtWhen(x.since) }) : x.at ? fmtWhen(x.at) : '', x.snoozed ? T('snoozed until {when}', { when: fmtWhen(x.snoozed.until) }) : '', x.flapping ? T('on and off') : ''].filter(Boolean).join(' · ')),
    open ? el('div', { class: 'ar-field' }, el('div', { class: 'grow' }, el('div', {}, T('Snooze')), el('div', { class: 'tiny muted' }, T('No pushes or reminders for this alert for a while.'))), el('span', { class: 'row', style: 'gap:6px' }, hoursSel, el('button', { class: 'btn small', onclick: async () => {
      const body2 = { hours: Number(hoursSel.value) };
      if (x.safety) { if (!confirm(T('Snooze a safety alert? You won\'t be reminded about it until the snooze ends.'))) return; body2.confirm = true; }
      try { await post(`/api/alerts/${encodeURIComponent(x.id)}/snooze`, body2); done(T('Snoozed')); } catch (err) { toast(err.message, 5000); }
    } }, T('Snooze')))) : null,
    open ? el('div', { class: 'ar-field' }, el('div', { class: 'grow' }, el('div', {}, T('Mark resolved')), el('div', { class: 'tiny muted' }, T('Takes it off the list. If the problem is still there, it stays quiet until it clears and happens again.'))),
      el('button', { class: 'btn small', onclick: async () => { try { await post(`/api/alerts/${encodeURIComponent(x.id)}/resolve`); done(T('Marked resolved')); } catch (err) { toast(err.message); } } }, icon('checkc', 14), T('Resolve'))) : null,
    !x.acked && !open ? el('div', { class: 'ar-field' }, el('div', { class: 'grow' }, T('Got it')), el('button', { class: 'btn small', onclick: async () => { try { await post(`/api/alerts/${encodeURIComponent(x.id)}/ack`); done(T('Got it')); } catch (err) { toast(err.message); } } }, icon('check', 14), T('Got it'))) : null,
    el('div', { class: 'row wrap', style: 'gap:8px;margin-top:12px' },
      x.device ? el('button', { class: 'btn small', onclick: () => { m.remove(); arMuteDialog({ device: x.device, name: alertTitle(x), safety: x.safety }); } }, icon('pause', 14), T('Mute this device')) : null,
      x.device ? el('button', { class: 'btn small', onclick: () => { m.remove(); arDeviceSheet({ id: x.device, name: alertTitle(x), safety: x.safety }); } }, icon('sliders', 14), T('Alerts for this device')) : null,
      kind?.label ? el('button', { class: 'btn small ghost', onclick: async () => { m.remove(); try { if (!AR.data) await arLoad(); arKindSheet(kind.id); } catch (e) { toast(e.message); } } }, icon('bell', 14), T('Rules for {kind}', { kind: T(kind.label) })) : null));
  const m = modal(body, { title: alertTitle(x) });
}
/** On a device's sheet: a link to its own alert rules. */
function alertDeviceLink(d) {
  if (S.status?.demo === true && !d?.id) return null;
  return el('button', { class: 'btn small ghost', style: 'margin-top:10px', onclick: () => { $('#modal')?.remove(); arDeviceSheet({ id: d.id, name: d.name, water: d.water, smoke: d.smoke }); } }, icon('bell', 14), T('Alerts for this device'));
}

/* ---- wall panels: say it out loud when the rule says "Show and say it out loud" ---- */
function arAnnounce(x) {
  const urgent = x.safety || x.sound === 'urgent';
  if (typeof chimePlay === 'function') chimePlay(urgent ? 'alarm' : 'chime', urgent ? 3 : 1);
  try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(alertTitle(x)); u.lang = (window.CasaI18n?.lang || 'en'); setTimeout(() => speechSynthesis.speak(u), urgent ? 2200 : 900); } } catch { /* no voice here */ }
}
const arSeen = { ids: null };
async function arPanelWatch() {
  if (!isPanel() || document.hidden) return;
  const a = await api('/api/alerts', { global: true }).catch(() => null); if (!a?.now) return;
  const ids = new Set(a.now.map((x) => x.id));
  if (arSeen.ids) for (const x of a.now) if (!arSeen.ids.has(x.id) && x.panel === 'announce') arAnnounce(x);
  arSeen.ids = ids;
}
setInterval(() => { arPanelWatch().catch(() => {}); }, 20_000);
