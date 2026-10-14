/* ---- Calendar: a month view of every calendar, and the HouseOS calendar you can edit here ---- */
const EV_COLORS = [['#a78bfa', 'Purple'], ['#60a5fa', 'Blue'], ['#34d399', 'Green'], ['#fbbf24', 'Yellow'], ['#fb7185', 'Red'], ['#f472b6', 'Pink'], ['#22d3ee', 'Teal']];
function eventEditor(ev, done, date) {
  const e = ev ? { ...ev } : { title: '', date: date || dayKey(new Date().toISOString()), time: '18:00', minutes: 60, repeat: 'none', color: '#a78bfa', who: '' };
  let allDay = !e.time;
  const f = (label, input) => el('label', { class: 'field' }, el('span', {}, label), input);
  const title = el('input', { value: e.title, placeholder: 'Soccer practice', maxlength: 120 });
  const dateI = el('input', { type: 'date', value: e.date }), timeI = el('input', { type: 'time', value: e.time || '18:00' });
  const dur = el('select', {}, [[30, '30 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']].map(([v, l]) => el('option', { value: v, selected: Number(e.minutes || 60) === v }, l)));
  const days = el('input', { type: 'number', min: 1, max: 60, value: e.days || 1 });
  const rep = el('select', {}, [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']].map(([v, l]) => el('option', { value: v, selected: e.repeat === v }, l)));
  const who = el('input', { value: e.who || '', placeholder: 'Family, Kids, Mom...', maxlength: 40 }), where = el('input', { value: e.where || '', placeholder: 'Optional', maxlength: 120 });
  const color = el('select', {}, EV_COLORS.map(([v, l]) => el('option', { value: v, selected: e.color === v }, l)));
  const timeRow = el('div', { class: 'row' }, el('div', { class: 'grow' }, f('Starts', timeI)), el('div', { class: 'grow' }, f('Length', dur)));
  const dayRow = el('div', {}, f('How many days', days));
  const ad = el('input', { type: 'checkbox', checked: allDay, style: 'width:auto' });
  const sync = () => { timeRow.hidden = allDay; dayRow.hidden = !allDay; }; ad.onchange = () => { allDay = ad.checked; sync(); }; sync();
  const msg = el('div', { class: 'small', style: 'color:var(--bad);min-height:18px' });
  const save = el('button', { class: 'btn primary' }, ev ? 'Save' : 'Add event');
  save.onclick = async () => {
    const body = { title: title.value, date: dateI.value, time: allDay ? null : timeI.value, minutes: Number(dur.value), days: Number(days.value), repeat: rep.value, who: who.value, where: where.value, color: color.value };
    try { if (ev) await post(`/api/mycal/${ev.id}`, body, 'PUT'); else await post('/api/mycal', body); m.remove(); toast(ev ? 'Saved' : 'Added to the calendar'); done?.(); } catch (err) { msg.textContent = err.message; }
  };
  const del = ev ? el('button', { class: 'btn danger', onclick: async () => { await api(`/api/mycal/${ev.id}`, { method: 'DELETE' }); m.remove(); toast('Deleted'); done?.(); } }, 'Delete') : null;
  const m = modal(el('div', {}, f('What', title), el('div', { class: 'row' }, el('div', { class: 'grow' }, f('Date', dateI)), el('label', { class: 'row small', style: 'margin-top:18px' }, ad, 'All day')), timeRow, dayRow,
    el('div', { class: 'row' }, el('div', { class: 'grow' }, f('Repeats', rep)), el('div', { class: 'grow' }, f('Color', color))), el('div', { class: 'row' }, el('div', { class: 'grow' }, f('Whose', who)), el('div', { class: 'grow' }, f('Where', where))),
    msg, el('div', { class: 'row', style: 'justify-content:flex-end' }, del, el('span', { class: 'grow' }), el('button', { class: 'btn ghost', onclick: () => m.remove() }, 'Cancel'), save)), { title: ev ? 'Edit event' : 'New event' });
  setTimeout(() => title.focus(), 50);
}
tab({ id: 'calendar', label: 'Calendar', icon: 'calendar', async render(main) {
  let ym = dayKey(new Date().toISOString()).slice(0, 7);
  const draw = async () => {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)), startDow = first.getUTCDay(), gridStart = new Date(Date.UTC(y, m - 1, 1 - startDow));
    const [{ events = [], errors = [] }, mine] = await Promise.all([api(`/api/calendar?from=${encodeURIComponent(new Date(gridStart.getTime() - 86400_000).toISOString())}&days=45`), api('/api/mycal').catch(() => ({ events: [] }))]);
    const myById = new Map((mine.events || []).map((e) => [e.id, e]));
    const byDay = new Map();
    for (const e of events) { const k = e.allDay ? e.start.slice(0, 10) : dayKey(e.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
    const today = dayKey(new Date().toISOString());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getTime() + i * 86400_000), k = d.toISOString().slice(0, 10), list = byDay.get(k) || [];
      cells.push(el('div', { class: `day${d.getUTCMonth() !== m - 1 ? ' other' : ''}${k === today ? ' today' : ''}`, onclick: (ev) => { if (ev.target.closest('.chip')) return; eventEditor(null, draw, k); } },
        el('span', { class: 'n' }, d.getUTCDate()), ...list.slice(0, 4).map((e) => el('div', { class: 'chip', style: `background:${e.color || 'var(--accent)'}`, title: `${e.title}${e.allDay ? '' : ` - ${fmtTime(e.start)}`}`,
          onclick: () => (e.mine && myById.get(e.id) ? eventEditor(myById.get(e.id), draw) : modal(el('div', {}, el('p', {}, e.allDay ? 'All day' : `${fmtWhen(e.start)} - ${fmtTime(e.end)}`), e.location ? el('p', { class: 'muted' }, e.location) : null, el('p', { class: 'small muted' }, `From ${e.calendar || 'a linked calendar'} - change it there.`)), { title: e.title })) }, e.allDay ? e.title : `${fmtTime(e.start).replace(':00', '')} ${e.title}`)),
        list.length > 4 ? el('span', { class: 'tiny muted' }, `+${list.length - 4} more`) : null));
    }
    const title = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
    const step = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); ym = d.toISOString().slice(0, 7); draw(); };
    setTop('Calendar', 'Your linked calendars plus the HouseOS calendar', [el('button', { class: 'btn primary', onclick: () => eventEditor(null, draw) }, icon('plus'), 'New event')]);
    main.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'row', style: 'margin-bottom:14px' }, el('button', { class: 'btn small', 'aria-label': 'Previous month', onclick: () => step(-1) }, icon('chevl')), el('b', { style: 'font-size:18px;min-width:170px;text-align:center' }, title), el('button', { class: 'btn small', 'aria-label': 'Next month', onclick: () => step(1) }, icon('chevr')), el('button', { class: 'btn small ghost', onclick: () => { ym = today.slice(0, 7); draw(); } }, 'Today')),
      el('div', { class: 'month' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => el('div', { class: 'dow' }, d)), cells),
      el('p', { class: 'small muted', style: 'margin:14px 0 0' }, 'Tap a day to add an event. Events you add here live on your HouseOS box. Google, iCloud and Outlook calendars linked in setup show here too.'),
      ...errors.map((er) => el('p', { class: 'small', style: 'color:var(--warn)' }, `${er.calendar} did not load.`))));
  };
  await draw(); return draw;
} });

/* ---- Photos: upload for the Photo reel ---- */
tab({ id: 'photos', label: 'Photos', icon: 'camera', async render(main) {
  const input = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const status = el('span', { class: 'small muted' });
  async function upload(files) {
    let ok = 0; const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    for (const [i, f] of list.entries()) {
      status.textContent = `Uploading ${i + 1} of ${list.length}...`;
      try { const r = await fetch('/api/photos', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error); ok++; } catch (err) { toast(`${f.name}: ${err.message}`, 4000); }
    }
    status.textContent = ''; if (ok) toast(`Added ${ok} photo${ok === 1 ? '' : 's'}`); draw();
  }
  input.onchange = () => upload(input.files);
  setTop('Photos', 'For the Photo reel on your Home screen', [el('button', { class: 'btn primary', onclick: () => input.click() }, icon('plus'), 'Upload photos')]);
  const draw = async () => {
    const { photos = [] } = await api('/api/photos');
    const drop = el('div', { class: 'card', style: 'border-style:dashed;text-align:center;padding:30px;cursor:pointer', onclick: () => input.click() }, el('div', { style: 'font-weight:600;margin-bottom:4px' }, 'Drop photos here, or tap to choose'), el('div', { class: 'small muted' }, 'JPEG, PNG, WebP, GIF or HEIC, up to 30 MB each. They stay on your HouseOS box.'), status);
    drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; }; drop.ondragleave = () => { drop.style.borderColor = ''; };
    drop.ondrop = (e) => { e.preventDefault(); drop.style.borderColor = ''; upload(e.dataTransfer.files); };
    const grid = el('div', { style: 'display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-top:14px' }, photos.map((p) => el('div', { style: 'position:relative;border-radius:14px;overflow:hidden;aspect-ratio:1;background:#000' },
      el('img', { src: p.url, alt: '', loading: 'lazy', style: 'width:100%;height:100%;object-fit:cover;cursor:zoom-in', onclick: () => modal(el('img', { src: p.url, alt: '' }), { wide: true }) }),
      p.demo ? null : el('button', { class: 'btn small', style: 'position:absolute;top:6px;right:6px;padding:4px 8px', 'aria-label': 'Remove photo', onclick: async () => { await api(`/api/photos/${p.id}`, { method: 'DELETE' }); draw(); } }, icon('x')))));
    main.replaceChildren(input, drop, photos.length ? grid : el('p', { class: 'muted', style: 'text-align:center' }, 'No photos yet.'));
  };
  await draw(); return null;
} });
