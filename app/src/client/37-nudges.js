/* Nudge chimes: a few short sounds made right here in the browser (no sound files to download). Browsers only play
   sound on a page that has been touched or clicked since it opened, so a wall screen needs one tap after it starts
   (a kiosk browser can be told to allow it). Each plays twice, about 3 seconds in all. */
const CHIMES = { chime: 'Chime', bell: 'Bell', dingdong: 'Ding-dong', marimba: 'Marimba', birds: 'Birds', alarm: 'Gentle alarm' };
let chimeCtx = null;
function chimeAudio() {
  try { chimeCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (chimeCtx.state === 'suspended') chimeCtx.resume().catch(() => {}); return chimeCtx; } catch { return null; }
}
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { chimeAudio(); }, { once: true, passive: true }));   // the first tap unlocks sound on this screen
function chimeTone(ac, at, freq, dur, { type = 'sine', vol = 0.25, to = null, overtones = [] } = {}) {
  const g = ac.createGain(); g.connect(ac.destination);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  for (const [mult, v] of [[1, 1], ...overtones]) {
    const o = ac.createOscillator(), og = ac.createGain(); o.type = type; o.frequency.setValueAtTime(freq * mult, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to * mult, at + dur * 0.6);
    og.gain.value = v; o.connect(og); og.connect(g); o.start(at); o.stop(at + dur + 0.05);
  }
}
function chimePlay(kind, times = 2) {
  if (!CHIMES[kind]) return false;
  const ac = chimeAudio(); if (!ac || ac.state !== 'running') return false;
  const bell = [[2.0, 0.35], [3.0, 0.15], [4.2, 0.08]];
  for (let r = 0; r < times; r++) {
    const t = ac.currentTime + 0.05 + r * 1.6;
    if (kind === 'chime') { chimeTone(ac, t, 880, 1.1, { overtones: [[2, 0.2]] }); chimeTone(ac, t + 0.22, 1318.5, 1.2, { overtones: [[2, 0.2]] }); }
    else if (kind === 'bell') chimeTone(ac, t, 523.25, 1.5, { vol: 0.3, overtones: bell });
    else if (kind === 'dingdong') { chimeTone(ac, t, 659.25, 0.9, { vol: 0.3, overtones: bell }); chimeTone(ac, t + 0.45, 523.25, 1.1, { vol: 0.3, overtones: bell }); }
    else if (kind === 'marimba') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => chimeTone(ac, t + i * 0.12, f, 0.45, { vol: 0.28, overtones: [[4, 0.1]] }));
    else if (kind === 'birds') [0, 0.18, 0.5, 0.66].forEach((d, i) => chimeTone(ac, t + d, 2600 + i * 180, 0.14, { vol: 0.12, to: 3600 + i * 200 }));
    else if (kind === 'alarm') [0, 0.3, 0.6].forEach((d) => chimeTone(ac, t + d, 740, 0.2, { type: 'triangle', vol: 0.22 }));
  }
  return true;
}
/* ---- Nudges: your home's own reminders (78-nudges.js). A card on the Alerts tab to add and change them,
   and the card that lights up every screen when one is due. ---- */
const NUDGE_ICON_NAMES = { trash: 'Trash', paw: 'Pets', pill: 'Medicine', bill: 'Bills', plant: 'Plants', cake: 'Birthday', car: 'Car', school: 'School', laundry: 'Laundry', bell: 'Reminder' };
const DOW = { map: (f) => [0, 1, 2, 3, 4, 5, 6].map((i) => f(dowShort(i), i)) };   // the days in the home's language
const nudgeWhen = (n) => {
  const loc = CasaI18n.lang === 'en' ? 'en-US' : CasaI18n.lang, t = hm(n.time), d = n.date ? new Date(`${n.date}T12:00:00Z`) : null, md = d ? dtf(loc, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d) : '';
  const dow = (x) => dtf(loc, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + x, 12)));   // 1 Jan 2023 was a Sunday
  return { once: T('{date} at {t}', { date: d ? dtf(loc, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d) : '', t }), daily: T('Every day at {t}', { t }),
    weekly: T('{days} at {t}', { days: (n.days || []).length === 5 && !n.days.includes(0) && !n.days.includes(6) ? T('Weekdays') : (n.days || []).map(dow).join(', '), t }),
    monthly: T('Every month on the {nth} at {t}', { nth: d ? (CasaI18n.lang === 'en' ? ordinal(d.getUTCDate()) : d.getUTCDate()) : '', t }), yearly: T('Every year on {date} at {t}', { date: md, t }) }[n.repeat] || t;
};
const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th'}`;
const nudgePic = (n, size = 'md') => (n.photo ? el('img', { class: `nudgepic ${size}`, src: `/api/nudges/${encodeURIComponent(n.id)}/photo?t=${n.lastFired || ''}`, alt: '' }) : el('span', { class: `nudgeicon ${size}`, 'aria-hidden': 'true', style: n.color ? `background:${safeColor(n.color)};color:${hhInk(n.color)}` : null }, icon(n.icon || 'bell')));   // a bin's own color (37h-household.js)
/* Pro, shown to Basic: the feature greyed, with what it does and a way to get it. */
/* A Pro card shown to Basic: a faded preview of what it looks like, what it does, and the way to get it. */
function proPanel(text, rows = 3) {
  return el('div', { class: 'propanel' }, el('div', { class: 'propanel-ghost', 'aria-hidden': 'true' }, Array.from({ length: rows }, (_, i) => el('div', { class: 'ghostrow' }, el('i', { class: 'dot' }), el('b', { style: `width:${[46, 62, 38][i % 3]}%` }), el('span', {})))),
    el('p', {}, text), el('div', { class: 'row wrap', style: 'gap:8px' }, el('a', { class: 'btn primary', href: '#settings' }, icon('spark'), T('Unlock with Pro')), el('span', { class: 'small muted' }, T('$5 a month or $49 a year · every new CasaTorch gets a 14-day trial'))));
}
function proUpsell(text) { return el('a', { class: 'proup', href: '#settings', title: T('Part of CasaTorch Pro') }, el('span', { class: 'pill pro' }, 'Pro'), el('span', {}, text), icon('chevr')); }

/* Who's looking (members and up add and change nudges; viewers see them). */
let nudgeMe = null;
const nudgeRole = async () => { nudgeMe ||= await api('/api/auth/me').catch(() => ({})); return nudgeMe?.signIn === false || !nudgeMe?.user ? 'owner' : nudgeMe.user.role; };
/* Reminders: their own page of tiles (06-pagegrid.js; they used to sit on Alerts, as "Nudges"): every reminder,
   today's, and which go to phones. Edit arranges, adds, removes and resizes them, like every other page. */
const REM_SUB = () => T('Trash night, the dog\'s dinner, bills, medicine, birthdays - on every screen, at the right time');
/** The list of reminders (or ideas to start from) into box. d: /api/nudges; redraw: after a change. */
function nudgesFill(box, d, role, redraw) {
  if (!d) return box.replaceChildren(pgEmpty(T('Reminders are not loading right now.'), null, null));
  const canEdit = !d.demo && role !== 'viewer';
  const head = d.demo ? el('p', { class: 'small muted', style: 'margin:0 0 12px' }, T('This is the demo, so you can look at reminders but not change them.')) : el('span', { hidden: true });
  if (!d.list.length) {
    const ideas = [[T('Trash night'), 'trash', 'weekly', [2], '19:30'], [T('Feed the dog'), 'paw', 'daily', [], '17:30'], [T('Take medicine'), 'pill', 'daily', [], '08:00'], [T('Rent is due'), 'bill', 'monthly', [], '09:00']];
    box.replaceChildren(head, el('div', { class: 'row wrap', style: 'gap:8px' }, el('span', { class: 'small muted' }, T('Ideas:')), ideas.map(([title, ic, repeat, days, time]) => el('button', { class: 'btn small', disabled: canEdit ? null : true, onclick: () => nudgeEditor({ title, icon: ic, repeat, days, time, date: new Date().toISOString().slice(0, 10), flash: true, push: d.pro }, d, redraw, true) }, icon(ic), title))));
  } else {
    const today = new Set(d.today || []);
    box.replaceChildren(head, el('div', { class: 'nudgelist' }, d.list.map((n) => el('button', { class: `nudgerow${n.on ? '' : ' off'}`, disabled: canEdit ? null : true, onclick: () => nudgeEditor(n, d, redraw) },
      nudgePic(n, 'sm'), el('div', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block' }, n.title), el('span', { class: 'small muted' }, n.on ? nudgeWhen(n) : T('Off'))),
      today.has(n.id) && n.on ? el('span', { class: 'pill good' }, T('Today')) : null,
      n.push ? el('span', { class: 'tiny muted', title: T('Sent to phones') }, icon('send')) : null))));
  }
}
pageTile({ id: 'rem-list', page: 'reminders', auto: true, title: 'Your reminders', icon: 'alarm', blurb: 'Every reminder - tap one to change it', size: [12, 1],
  render(b, ctx) { nudgesFill(b, ctx.data.nudges, ctx.data.role, () => ctx.refresh()); } });
pageTile({ id: 'rem-today', page: 'reminders', auto: true, title: 'Today', icon: 'clock', blurb: 'Today\'s reminders, in order', size: [6, 1], render(b, ctx) {
  const d = ctx.data.nudges, today = new Set(d?.today || []), list = (d?.list || []).filter((n) => n.on && today.has(n.id)).sort((a, x) => a.time.localeCompare(x.time));
  const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  b.replaceChildren(list.length ? el('div', { class: 'nudgelist' }, list.map((n) => el('div', { class: `nudgerow${n.time < hhmm ? ' off' : ''}`, style: 'cursor:default' }, nudgePic(n, 'sm'),
    el('div', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block' }, n.title), el('span', { class: 'small muted' }, hm(n.time))), n.push ? el('span', { class: 'tiny muted', title: T('Sent to phones') }, icon('send')) : null)))
    : el('p', { class: 'small muted', style: 'margin:0' }, T('No reminders today.')));
} });
pageTile({ id: 'rem-phones', page: 'reminders', auto: true, title: 'On your phones', icon: 'phone', blurb: 'Which reminders reach phones, and how', size: [6, 1], render(b, ctx) {
  const d = ctx.data.nudges; if (!d) return b.replaceChildren();
  if (!d.pro) return b.replaceChildren(proUpsell(T('Send reminders to everyone\'s phone, wherever they are')));
  const n = d.list.filter((x) => x.push && x.on).length;
  b.replaceChildren(el('p', { class: 'small', style: 'margin:0 0 10px' }, !d.phones ? T('No phones have CasaTorch alerts on yet - turn them on in Settings › Phones & alerts.') : n ? T(n === 1 ? '1 reminder goes to phones.' : '{n} reminders go to phones.', { n }) : T('None of your reminders go to phones yet.')),
    el('div', { class: 'row wrap', style: 'gap:8px' }, el('a', { class: 'btn small', href: '#settings/alerts' }, icon('sliders', 14), T('Fine-tune in Settings › Alerts')), el('a', { class: 'btn small ghost', href: '#settings/phones' }, icon('phone', 14), T('Phones & alerts'))));
} });
tab({ id: 'reminders', label: 'Reminders', icon: 'alarm', after: 'calendar', async render(main) {
  let refresh = null;
  const add = el('button', { class: 'btn', hidden: true, onclick: () => { const d = pageCtx(main)?.data?.nudges; if (d) nudgeEditor(null, d, () => refresh?.()); } }, icon('plus'), el('span', { class: 'hide-phone' }, T('Add a reminder')));
  const load = async () => { const [nudges, role] = await Promise.all([api('/api/nudges').catch(() => null), nudgeRole()]); add.hidden = !(nudges && !nudges.demo && role !== 'viewer'); return { nudges, role }; };
  refresh = await pageGrid(main, { page: 'reminders', auto: true, title: tabLabel({ id: 'reminders', label: T('Reminders') }), sub: REM_SUB(), load, actions: [add], addLabel: 'Add a tile' });
  return refresh;
} });
function nudgeEditor(n, d, redraw, fresh = false) {
  const isNew = !n?.id;
  const v = { title: n?.title || '', icon: n?.icon || 'bell', sound: n ? n.sound || 'none' : 'chime', time: n?.time || '18:00', repeat: n?.repeat || 'weekly', days: [...(n?.days || [])], date: n?.date || new Date().toISOString().slice(0, 10), flash: n?.flash !== false, push: d.pro ? (isNew ? true : !!n?.push) : false, on: n?.on !== false };
  if (v.repeat === 'weekly' && !v.days.length) v.days = [new Date().getDay()];
  let photoFile = null, dropPhoto = false;
  const body = el('div', { class: 'nudgeedit' });
  const msg = el('p', { class: 'small', style: 'min-height:1.2em;margin:6px 0 0' });
  const draw = () => {
    const title = el('input', { value: v.title, maxlength: 60, placeholder: T('Trash night'), oninput: (e) => { v.title = e.target.value; } });
    const icons = el('div', { class: 'nudgeicons', role: 'radiogroup', 'aria-label': T('Picture') }, d.icons.map((k) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v.icon === k && !photoFile && !(n?.photo && !dropPhoto)), 'aria-label': T(NUDGE_ICON_NAMES[k]), title: T(NUDGE_ICON_NAMES[k]), class: v.icon === k && !photoFile && !(n?.photo && !dropPhoto) ? 'on' : '', onclick: () => { v.icon = k; photoFile = null; dropPhoto = true; draw(); } }, icon(k))));
    const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, onchange: (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { toast(T('That picture is over 5 MB.')); return; } photoFile = f; dropPhoto = false; draw(); } });
    const hasPhoto = photoFile || (n?.photo && !dropPhoto);
    const photoRow = el('div', { class: 'row wrap', style: 'gap:8px;margin-top:8px' }, file, el('button', { type: 'button', class: 'btn small', onclick: () => file.click() }, icon('plus'), hasPhoto ? T('Change photo') : T('Or use a photo')),
      hasPhoto ? el('span', { class: 'small good' }, photoFile ? `✓ ${photoFile.name}` : T('✓ Photo')) : null, hasPhoto ? el('button', { type: 'button', class: 'btn small ghost', onclick: () => { photoFile = null; dropPhoto = true; draw(); } }, T('Use an icon')) : null);
    const time = el('input', { type: 'time', value: v.time, required: true, onchange: (e) => { v.time = e.target.value; } });
    const repeat = el('select', { onchange: (e) => { v.repeat = e.target.value; draw(); } }, [['once', 'Once'], ['daily', 'Every day'], ['weekly', 'Days of the week'], ['monthly', 'Every month'], ['yearly', 'Every year']].map(([k, l]) => el('option', { value: k, selected: v.repeat === k ? true : null }, l)));
    const days = v.repeat === 'weekly' ? el('div', { class: 'row wrap', style: 'gap:6px', role: 'group', 'aria-label': T('Days') }, DOW.map((l, i) => el('button', { type: 'button', class: `chipbtn${v.days.includes(i) ? ' on' : ''}`, 'aria-pressed': String(v.days.includes(i)), onclick: () => { v.days = v.days.includes(i) ? v.days.filter((x) => x !== i) : [...v.days, i]; draw(); } }, l))) : null;
    const date = ['once', 'monthly', 'yearly'].includes(v.repeat) ? el('label', { class: 'field' }, el('span', {}, v.repeat === 'once' ? T('Date') : v.repeat === 'monthly' ? T('Starting (it repeats on this day each month)') : T('Date (it repeats every year)')), el('input', { type: 'date', value: v.date, onchange: (e) => { v.date = e.target.value; } })) : null;
    const flash = el('input', { type: 'checkbox', checked: v.flash ? true : null, onchange: (e) => { v.flash = e.target.checked; } });
    const sound = el('select', { 'aria-label': T('Sound'), onchange: (e) => { v.sound = e.target.value; if (v.sound !== 'none') chimePlay(v.sound, 1); } }, [['none', 'No sound'], ...Object.entries(CHIMES)].map(([k, l]) => el('option', { value: k, selected: v.sound === k ? true : null }, l)));
    const soundRow = el('div', { class: 'field' }, el('span', {}, T('Sound')), el('div', { class: 'row', style: 'gap:8px' }, sound, el('button', { type: 'button', class: 'btn small', title: T('Play it'), onclick: () => { if (v.sound !== 'none' && !chimePlay(v.sound, 1)) toast(T('Tap anywhere on this screen once, then try again - browsers only play sound after a tap.')); } }, icon('play'), T('Play'))),
      el('span', { class: 'small muted' }, T('Plays on every screen showing it. A wall screen needs one tap after it starts before it can play sound.')));
    const push = el('input', { type: 'checkbox', checked: v.push ? true : null, disabled: d.pro ? null : true, onchange: (e) => { v.push = e.target.checked; } });
    const on = el('input', { type: 'checkbox', checked: v.on ? true : null, onchange: (e) => { v.on = e.target.checked; } });
    body.replaceChildren(...[
      el('label', { class: 'field' }, el('span', {}, T('Name')), title),
      el('div', { class: 'field' }, el('span', { class: 'small muted' }, T('Picture')), icons, photoRow),
      el('div', { class: 'row wrap', style: 'gap:12px' }, el('label', { class: 'field', style: 'flex:1;min-width:140px' }, el('span', {}, T('Time')), time), el('label', { class: 'field', style: 'flex:2;min-width:180px' }, el('span', {}, T('Repeats')), repeat)),
      days, date, soundRow,
      el('label', { class: 'check' }, flash, el('span', {}, el('b', {}, T('Show it on every screen')), el('span', { class: 'small muted', style: 'display:block' }, T('A card lights up on every CasaTorch screen until someone taps Done.')))),
      el('label', { class: `check${d.pro ? '' : ' locked'}` }, push, el('span', {}, el('b', {}, T('Send it to phones ')), d.pro ? null : el('span', { class: 'pill pro' }, 'Pro'),
        el('span', { class: 'small muted', style: 'display:block' }, d.pro ? (d.phones ? T('To every phone with CasaTorch alerts on, wherever it is - even in quiet hours.') : T('No phones have CasaTorch alerts on yet - turn them on in Settings › Phones & alerts.')) : T('Reach everyone\'s phone wherever they are, even in quiet hours.')),
        d.pro && d.phones ? el('a', { class: 'small', href: '#settings/alerts', onclick: () => $('#modal')?.remove() }, T('Fine-tune in Settings › Alerts')) : null)),
      d.pro ? null : proUpsell(T('Get reminders on your phone with CasaTorch Pro')),
      isNew ? null : el('label', { class: 'check' }, on, el('span', {}, el('b', {}, T('On')))),
      msg].filter(Boolean));
  };
  draw();
  const save = el('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true; msg.textContent = ''; msg.style.color = '';
    try {
      const payload = { title: v.title, icon: v.icon, sound: v.sound, time: v.time, repeat: v.repeat, days: v.days, date: v.date, flash: v.flash, push: v.push, on: v.on };
      const r = isNew ? await post('/api/nudges', payload) : await post(`/api/nudges/${encodeURIComponent(n.id)}`, payload, 'PUT');
      const id = r.nudge.id;
      if (photoFile) { const res = await fetch(`/api/nudges/${encodeURIComponent(id)}/photo`, { method: 'POST', body: photoFile, headers: { 'Content-Type': photoFile.type || 'application/octet-stream' } }); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The photo could not be saved.'); }
      else if (dropPhoto && n?.photo) await api(`/api/nudges/${encodeURIComponent(id)}/photo`, { method: 'DELETE' }).catch(() => {});
      m.remove(); toast(isNew ? T('"{title}" added', { title: r.nudge.title }) : T('Saved')); redraw?.();
    } catch (e) { msg.textContent = e.message; msg.style.color = 'var(--bad)'; save.disabled = false; }
  } }, isNew ? T('Add reminder') : T('Save'));
  const test = isNew ? null : el('button', { class: 'btn', onclick: async () => { try { await post(`/api/nudges/${encodeURIComponent(n.id)}/test`, {}); m.remove(); toast(T('Showing it now')); nudgeCheck(); } catch (e) { toast(e.message); } } }, icon('play'), T('Try it'));
  const del = isNew ? null : el('button', { class: 'btn ghost danger', onclick: async () => { if (!confirm(T('Delete "{title}"?', { title: n.title }))) return; try { await api(`/api/nudges/${encodeURIComponent(n.id)}`, { method: 'DELETE' }); m.remove(); redraw?.(); } catch (e) { toast(e.message); } } }, icon('x'), T('Delete'));
  const m = modal(el('div', {}, body, el('div', { class: 'row between wrap', style: 'gap:8px;margin-top:14px' }, el('div', { class: 'row', style: 'gap:8px' }, del, test), save)), { title: isNew ? (fresh ? T('Add this reminder') : T('Add a reminder')) : T('Change reminder') });
  setTimeout(() => body.querySelector('input')?.focus(), 30);
}

/* ---- the card that lights up the screens ---- */
const nudgeSeen = new Set();
async function nudgeCheck() {
  if (document.hidden || location.pathname.includes('setup') || !S.status) return;
  const r = await api('/api/nudges/active').catch(() => null);
  const list = r?.active || [];
  const box = document.getElementById('nudgeflash');
  if (!list.length) { box?.remove(); return; }
  const n = list[0];
  if (box?.dataset.id === n.id) return;
  box?.remove();
  const canAct = (await nudgeRole()) !== 'viewer';
  const done = async (how) => { try { await post(`/api/nudges/${encodeURIComponent(n.id)}/${how}`, {}); } catch (e) { toast(e.message); } document.getElementById('nudgeflash')?.remove(); setTimeout(nudgeCheck, 400); };
  const card = el('div', { id: 'nudgeflash', 'data-id': n.id, role: 'alertdialog', 'aria-live': 'assertive', 'aria-label': T('Reminder: {title}', { title: n.title }) },
    el('div', { class: 'nudgecard' }, nudgePic(n, 'lg'), el('div', { class: 'small muted', style: 'letter-spacing:.06em;text-transform:uppercase;font-weight:700' }, `${T('Reminder')} · ${hm(n.time)}`), el('h2', {}, n.msg ? TM(n.title, n.msg, n.vars) : n.title),
      list.length > 1 ? el('p', { class: 'small muted' }, T('and {n} more', { n: list.length - 1 })) : null,
      canAct ? el('div', { class: 'row', style: 'gap:10px;justify-content:center' }, el('button', { class: 'btn primary', onclick: () => done('done') }, icon('check'), n.doneLabel ? T(n.doneLabel) : T('Done')), el('button', { class: 'btn', onclick: () => done('snooze') }, icon('clock'), T('10 more minutes')))
        : el('button', { class: 'btn', onclick: () => card.remove() }, T('Close'))));
  document.body.append(card);
  if (!nudgeSeen.has(`${n.id}${n.at}`)) { nudgeSeen.add(`${n.id}${n.at}`); try { navigator.vibrate?.(200); } catch { /* fine */ } if (n.sound && n.sound !== 'none') chimePlay(n.sound); }
}
setInterval(nudgeCheck, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) nudgeCheck(); });
setTimeout(nudgeCheck, 4000);
