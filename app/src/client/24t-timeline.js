/* ---- Timeline: everything that happened at the doors and cameras, in one list (72t-timeline.js) ----
   Frigate's events, doorbell presses, motion, the alarm and the locks, and Cisco Meraki camera counts, newest first
   and grouped by day. Filters: what kind, which camera, who (when Frigate or the lock says). Tap an event for its
   clip (Frigate) or its picture. Basic shows the last 24 hours, Pro 30 days. Opened from Cameras and Security
   (and from a doorbell alert); it isn't on the bar itself. */
const TL_KINDS = [['doorbell', 'bell', 'Doorbell'], ['motion', 'camera', 'Motion'], ['detection', 'user', 'Detections'], ['alarm', 'alarm', 'Alarm'], ['lock', 'lock', 'Locks']];
const TL_RANGES = [[24, 'Last 24 h'], [72, '3 days'], [168, '7 days'], [720, '30 days']];
const TL_ALARM = { armed_away: 'Armed away', armed_home: 'Armed home', armed_night: 'Armed night', armed_vacation: 'Armed (vacation)', armed_custom_bypass: 'Armed (custom)', disarmed: 'Disarmed', triggered: 'Triggered!' };
const TL_LOCK = { locked: 'Locked', unlocked: 'Unlocked', jammed: 'Jammed', open: 'Open|state' };
/** The event in words, in the home's language: [title, line under it]. */
function tlWords(e) {
  const where = e.camera || e.name || '';
  const by = e.person && e.type !== 'detection' ? T('by {person}', { person: e.person }) : null;
  if (e.type === 'doorbell') return [T('Someone rang the doorbell'), where];
  if (e.type === 'motion') return [T('Motion'), where];
  if (e.type === 'detection') { const what = detName(e.label || 'object'); return [e.person ? `${T(what)} · ${e.person}` : T(what), [where, e.score ? T('{n}% sure', { n: e.score }) : null].filter(Boolean).join(' · ')]; }
  if (e.type === 'lock') return [`${e.name || T('Lock')}: ${T(TL_LOCK[e.state] || pretty(e.state))}`, by];
  if (e.type === 'alarm') return [`${e.name || T('Alarm')}: ${T(TL_ALARM[e.state] || pretty(e.state))}`, by];
  return [pretty(e.type), where];
}
const tlIcon = (e) => (e.type === 'detection' && e.label === 'car' ? 'car' : (TL_KINDS.find(([k]) => k === e.type) || [])[1] || 'dotc');
/** "Today", "Yesterday", or the date, for a day heading (the home's time zone). */
function tlDayLabel(iso, now = Date.now()) {
  const k = dayKey(iso);
  if (k === dayKey(new Date(now).toISOString())) return T('Today');
  if (k === dayKey(new Date(now - 86400_000).toISOString())) return T('Yesterday');
  return fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' });
}
/** Events grouped by day, in order. Pure apart from the time zone. */
function tlByDay(events) {
  const out = []; let cur = null;
  for (const e of events) { const k = dayKey(e.at); if (!cur || cur.key !== k) out.push(cur = { key: k, label: tlDayLabel(e.at), list: [] }); cur.list.push(e); }
  return out;
}
/* One event, opened: the clip plays (Frigate), else its picture; who, where and when under it. */
function tlOpen(e) {
  const [title, line] = tlWords(e);
  const media = e.clip
    ? el('video', { class: 'tl-media', src: e.clip, controls: true, autoplay: true, muted: true, playsinline: true, preload: 'metadata', poster: e.picture || e.thumb || null, 'aria-label': title })
    : e.picture || e.thumb ? el('img', { class: 'tl-media', src: e.picture || e.thumb, alt: [title, line].filter(Boolean).join(' - ') }) : null;
  if (media?.tagName === 'VIDEO') media.addEventListener('error', () => { if (!media.isConnected) return; const img = e.picture || e.thumb ? el('img', { class: 'tl-media', src: e.picture || e.thumb, alt: title }) : null; media.replaceWith(el('div', {}, img, el('p', { class: 'small bad', role: 'alert' }, T('The clip didn\'t load. Frigate may have removed it.')))); });
  modal(el('div', {}, media || el('p', { class: 'small muted' }, T('No picture for this one.')),
    el('div', { class: 'small muted', style: 'margin-top:10px' }, [line, fmtWhen(e.at)].filter(Boolean).join(' · ')),
    e.zones?.length ? el('div', { class: 'tiny muted', style: 'margin-top:4px' }, `${T('Zones')}: ${e.zones.map(pretty).join(', ')}`) : null,
    e.cameraId ? el('div', { class: 'row', style: 'margin-top:12px' }, el('a', { class: 'btn small', href: '#cameras' }, icon('camera', 16), T('Open Cameras'))) : null), { wide: !!media, title });
}
function tlRow(e) {
  const [title, line] = tlWords(e), pic = e.thumb || e.picture;
  const openable = !!(e.clip || pic);
  return el(openable ? 'button' : 'div', { class: 'tl-row', type: openable ? 'button' : null, onclick: openable ? () => tlOpen(e) : null },
    el('span', { class: 'tl-time' }, fmtTime(e.at)),
    pic ? el('img', { class: 'tl-thumb', loading: 'lazy', alt: '', src: pic }) : el('span', { class: `tl-ic tl-${e.type}`, 'aria-hidden': 'true' }, icon(tlIcon(e), 18)),
    el('span', { class: 'tl-txt' }, el('b', {}, title), line ? el('span', { class: 'tiny muted' }, line) : null),
    e.clip ? el('span', { class: 'tl-play', title: T('Play the clip'), 'aria-label': T('Play the clip') }, icon('play', 14)) : null);
}
/** A way to the timeline, for the Cameras and Security pages. */
const timelineBtn = () => el('a', { class: 'btn', href: '#timeline' }, icon('list'), T('Timeline'));
tab({ id: 'timeline', label: 'Timeline', icon: 'list', nav: false, async render(main) {
  const st = { hours: 24, type: null, camera: null, person: null };
  try { Object.assign(st, JSON.parse(sessionStorage.getItem('casatorch-tl') || '{}')); } catch { /* fresh */ }
  const body = el('div', { class: 'tl' });
  main.append(body);
  let seq = 0;
  const draw = async () => {
    const my = ++seq;
    const q = new URLSearchParams({ hours: String(st.hours) }); for (const k of ['type', 'camera', 'person']) if (st[k]) q.set(k, st[k]);
    let d;
    try { d = await api(`/api/timeline?${q}`); } catch (err) {
      if (my !== seq || !body.isConnected) return;
      body.replaceChildren(loadFail(err)); return;
    }
    if (my !== seq || !body.isConnected) return;
    try { sessionStorage.setItem('casatorch-tl', JSON.stringify(st)); } catch { /* private window */ }
    if (st.hours > d.maxHours) st.hours = d.maxHours;
    setTop(T('Timeline'), d.total === 1 ? T('1 event') : T('{n} events', { n: d.total }), [el('a', { class: 'btn', href: '#cameras' }, icon('camera'), T('Cameras')), el('a', { class: 'btn', href: '#security' }, icon('shield'), T('Security'))]);
    const range = el('div', { class: 'seg', role: 'group', 'aria-label': T('How far back') }, TL_RANGES.map(([h, t]) => {
      const locked = h > d.maxHours;
      return el('button', { class: st.hours === h ? 'on' : '', 'aria-pressed': String(st.hours === h), title: locked ? T('Pro keeps 30 days') : null, onclick: () => { if (locked) { location.hash = '#settings/pro'; return; } st.hours = h; draw(); } }, T(t), locked ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'Pro') : null);
    }));
    const chip = (key, val, label, n, ic) => el('button', { class: `chip${st[key] === val ? ' on' : ''}`, 'aria-pressed': String(st[key] === val), onclick: () => { st[key] = st[key] === val ? null : val; draw(); } }, ic ? icon(ic, 14) : null, label, n != null ? el('b', {}, String(n)) : null);
    const kinds = el('div', { class: 'chips', role: 'group', 'aria-label': T('Kind') }, TL_KINDS.filter(([k]) => d.types[k] || st.type === k).map(([k, ic, label]) => chip('type', k, T(label), d.types[k], ic)));
    const pickOf = (key, all, label, anyLabel) => (all.length > 1 || st[key] ? el('label', { class: 'tl-pick' }, el('span', { class: 'tiny muted' }, T(label)),
      el('select', { onchange: (e) => { st[key] = e.target.value || null; draw(); } }, el('option', { value: '' }, T(anyLabel)), ...all.map((x) => el('option', { value: x, selected: st[key] === x ? true : null }, x)))) : null);
    const filters = el('div', { class: 'tl-filters' }, range, el('div', { class: 'row wrap', style: 'gap:10px;align-items:flex-end' }, pickOf('camera', d.cameras, 'Camera', 'All cameras'), pickOf('person', d.people, 'Person', 'Everyone')), kinds);
    const errs = (d.errors || []).length ? el('div', { class: 'card tl-err', role: 'alert' }, el('div', { class: 'row', style: 'gap:10px;align-items:center' }, icon('info', 18),
      el('div', { class: 'grow small' }, T('Frigate didn\'t answer, so its events are missing: {error}', { error: d.errors[0].error })), el('button', { class: 'btn small', onclick: () => { NET.reset?.(); draw(); } }, icon('reset', 16), T('Try again')))) : null;
    const days = tlByDay(d.events);
    const list = days.length ? days.map((g) => el('section', { class: 'tl-day' }, el('h2', { class: 'tl-dayh' }, g.label, el('span', { class: 'tiny muted' }, String(g.list.length))), el('div', { class: 'tl-list' }, g.list.map(tlRow))))
      : [el('div', { class: 'card tl-empty' }, el('b', {}, st.type || st.camera || st.person ? T('Nothing matches these filters.') : T('Nothing happened in this time.')),
        el('p', { class: 'small muted' }, d.frigate ? T('Doorbell presses, motion, the alarm, locks and what your cameras see show up here as they happen.') : T('Doorbell presses, motion, the alarm and locks show up here as they happen. Connect Frigate to add what your cameras see, with clips.')),
        st.type || st.camera || st.person ? el('button', { class: 'btn small', onclick: () => { st.type = st.camera = st.person = null; draw(); } }, T('Show everything')) : null)];
    const more = !d.pro && d.events.length ? el('p', { class: 'small muted tl-more' }, T('Basic shows the last 24 hours. Pro keeps 30 days.'), ' ', el('a', { href: '#settings/pro' }, T('Get Pro'))) : null;
    body.replaceChildren(...[filters, errs, ...list, d.total > d.events.length ? el('p', { class: 'tiny muted' }, T('Showing the newest {n}.', { n: d.events.length })) : null, more].filter(Boolean));
  };
  await draw();
  return () => draw();   // the page's own refresh (every minute while it's open)
} });
