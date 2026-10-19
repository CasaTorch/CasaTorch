/* ---- Household (78h-household.js): bin night, the mail, thirsty plants and the laundry. The Home widget,
   the Settings section (Settings › Household), and the picture each bin gets on its reminder. ---- */
Object.assign(ICONS, {
  recycling: 'M20 12a8 8 0 0 1-13.7 5.7M4 12a8 8 0 0 1 13.7-5.7M18 3v4h-4M6 21v-4h4',
  organics: 'M12 7.5c-1.2-1.6-3.2-2.3-5-1.8C4.3 6.4 3.5 9.6 4.4 12.8 5.4 16.4 7.9 20 10.4 20c.7 0 1.1-.4 1.6-.4s.9.4 1.6.4c2.5 0 5-3.6 6-7.2.9-3.2.1-6.4-2.6-7.1-1.8-.5-3.8.2-5 1.8zM12 7.5c0-2 .8-3.6 2.8-4.5',
  paper: 'M6 3h9l4 4v14H6zM15 3v4h4M9 11h7M9 14.5h7M9 18h4',
  glass: 'M10 2h4M10.5 2v4.8L8 10.2V21h8V10.2l-2.5-3.4V2M8 14h8',
  yard: 'M5 19C5 10.5 10 5.5 20 4c-1.2 10-6.2 15-15 15zM5 19l8-8',
  mailbox: 'M4 20V11a4 4 0 0 1 8 0v9zM12 20h8v-9a4 4 0 0 0-4-4H8M15 12V4h3v2.5h-3M7 13h2',
  washer: 'M5 3h14v18H5zM5 7h14M8 5h.01M11 5h.01M12 18.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM9.6 14.6c.8-.8 1.6-.8 2.4 0s1.6.8 2.4 0',
  dryer: 'M5 3h14v18H5zM5 7h14M8 5h.01M11 5h.01M12 18.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12v2.5l1.6 1',
  dishwasher: 'M5 3h14v18H5zM5 7h14M8 5h3M15 5h1M8 11h8M9 11v6M12 11v6M15 11v6',
});
const HH_BIN_NAMES = { trash: 'Trash', recycling: 'Recycling', organics: 'Organics', paper: 'Paper', glass: 'Glass', yard: 'Yard waste' };
const HH_KIND_NAMES = { washer: 'Washer', dryer: 'Dryer', dishwasher: 'Dishwasher' };
const HH_DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hhDay = (ymd, o = { weekday: 'short', month: 'short', day: 'numeric' }) => (ymd ? dtf('en-US', { timeZone: 'UTC', ...o }).format(new Date(`${ymd}T12:00:00Z`)) : '');
/* White or near-black on a bin's color, whichever reads. */
const hhInk = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff'; const n = parseInt(m[1], 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.62 ? '#14161a' : '#fff'; };
const hhChip = (ic, color, size = 'sm') => el('span', { class: `hh-chipic ${size}`, style: `background:${safeColor(color, '#6b7280')};color:${hhInk(color)}`, 'aria-hidden': 'true' }, icon(ic || 'trash'));
document.head.append(el('style', {}, `
.hh-chipic { display: grid; place-items: center; flex: none; border-radius: 10px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.hh-chipic.sm { width: 34px; height: 34px; } .hh-chipic.sm svg { width: 19px; height: 19px; } .hh-chipic.xs { width: 26px; height: 26px; border-radius: 8px; } .hh-chipic.xs svg { width: 15px; height: 15px; }
.hh-rows { display: grid; gap: 6px; min-width: 0; } .hh-row { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 6px 8px; border-radius: 12px; background: var(--surface-2); }
.hh-row.hot { background: color-mix(in srgb, var(--warn) 12%, var(--surface-2)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 35%, transparent); }
.hh-row .grow { min-width: 0; } .hh-row b { display: block; font-size: 14px; } .hh-row .sub { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hh-outbtn { flex: none; border: 0; border-radius: 999px; padding: 6px 11px; font: inherit; font-size: 12.5px; font-weight: 650; cursor: pointer; background: var(--accent); color: #06101e; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.hh-outbtn svg { width: 14px; height: 14px; } .hh-outbtn.done { background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--good); }
.hh-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; } .hh-c { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 10px 5px 6px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); font: inherit; font-size: 12.5px; cursor: default; white-space: nowrap; }
.hh-c > span:last-child { overflow: hidden; text-overflow: ellipsis; } .hh-c svg { width: 15px; height: 15px; flex: none; } button.hh-c { cursor: pointer; } .hh-c.hot { border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 12%, var(--surface-2)); }
.hh-c.good { color: var(--good); } .hh-c.run svg { color: var(--accent); } .hh-c.hot svg { color: var(--warn); }
.hh-card h2 { display: flex; align-items: center; gap: 8px; } .hh-list { display: grid; gap: 8px; margin: 10px 0; }
.hh-item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font: inherit; color: inherit; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface-2); cursor: pointer; min-width: 0; }
.hh-item:disabled { cursor: default; } .hh-item:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 40%, transparent); } .hh-item .grow { min-width: 0; } .hh-item .chev { color: var(--faint); flex: none; }
.hh-sug { border-radius: 14px; padding: 10px 12px; margin: 10px 0; background: color-mix(in srgb, var(--accent) 9%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); }
.hh-sug .row { min-width: 0; } .hh-sugrow { display: flex; align-items: center; gap: 10px; padding: 6px 0; min-width: 0; } .hh-sugrow + .hh-sugrow { border-top: 1px solid var(--line); }
.hh-kinds { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; max-width: 420px; } .hh-kinds.three { grid-template-columns: repeat(3, 1fr); max-width: 260px; }
.hh-kinds button { display: grid; justify-items: center; gap: 4px; padding: 8px 2px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); font: inherit; font-size: 11px; cursor: pointer; }
.hh-kinds button svg { width: 22px; height: 22px; } .hh-kinds button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); }
.hh-colors { display: flex; flex-wrap: wrap; gap: 8px; } .hh-colors button { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
.hh-colors button.on { border-color: var(--text); } .hh-set { display: grid; gap: 4px; margin: 12px 0; } .hh-set > .lbl { font-size: 13px; color: var(--muted); }
.hh-inline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; } .hh-inline input[type=time], .hh-inline input[type=number] { width: auto; min-width: 110px; }
.hh-note { font-size: 12.5px; color: var(--muted); margin: 4px 0 0; } .hh-sep { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
.hh-item > svg, .hh-sugrow > svg { width: 20px; height: 20px; flex: none; color: var(--muted); } .hh-card .check { text-align: left; } .hh-card .check input[type=checkbox] { width: 18px; height: 18px; flex: none; padding: 0; margin-top: 2px; }
.hh-card h2 svg { width: 16px; height: 16px; flex: none; }
@media (max-width: 520px) { .hh-kinds { grid-template-columns: repeat(3, 1fr); } .hh-item { padding: 9px 10px; } }
`));

/* When to put a bin out, in words: Tonight, Tomorrow night, or (later) the day of the pickup. */
function hhWhen(b) {
  if (b.state === 'today') return { pill: T('Today'), sub: T('Pickup today'), hot: true };
  if (b.state === 'tonight') return { pill: T('Tonight'), sub: T('Pickup tomorrow'), hot: true };
  if (b.state === 'tomorrow') return { pill: T('Tomorrow night'), sub: T('Pickup {day}', { day: hhDay(b.next, { weekday: 'long' }) }) };
  if (b.state === 'later') return { pill: null, sub: T('Pickup {day}', { day: hhDay(b.next) }), right: b.days < 7 ? hhDay(b.next, { weekday: 'short' }) : T('in {n} days', { n: b.days }) };
  return { pill: null, sub: b.error ? T(b.error) : T('No pickups coming up') };
}
let hhCanAct = null;
const hhRole = async () => { if (hhCanAct == null) hhCanAct = (await nudgeRole()) !== 'viewer'; return hhCanAct; };
async function hhDo(url, body, okMsg) {
  try { await post(url, body || {}); if (okMsg) toast(okMsg); WCACHE.delete('/api/household'); runRefresh(); setTimeout(nudgeCheck, 300); }
  catch (e) { toast(e.message); }
}

/* One bin: its color, when to put it out, and "It's out" on the evening before (the Home widget and the Household page). */
function hhBinRow(x, w, canAct) {
  const wn = hhWhen(x), small = w <= 2;
  const act = (x.state === 'tonight' || x.state === 'today') && canAct
    ? el('button', { class: `hh-outbtn${x.out ? ' done' : ''}`, 'aria-pressed': String(!!x.out), title: x.out ? T('Tap if it isn\'t out after all') : T('Tap when it\'s at the curb'), onclick: () => hhDo(`/api/household/bins/${encodeURIComponent(x.id)}/out`, { out: !x.out }, x.out ? null : T('Thanks - {bin} is out', { bin: x.name })) }, icon('check'), small ? null : x.out ? T('Out') : T('It\'s out'))
    : x.out ? el('span', { class: 'pill good' }, icon('check', 12), T('Out')) : null;
  return el('div', { class: `hh-row${wn.hot && !x.out ? ' hot' : ''}`, 'data-bin': x.id },
    hhChip(x.icon, x.color, small ? 'xs' : 'sm'),
    el('div', { class: 'grow' }, el('b', { class: 'ellipsis' }, x.name), el('span', { class: 'sub' }, (small ? [wn.pill || wn.sub] : [wn.pill, wn.pill && (act || wn.hot) && w < 5 ? '' : wn.sub, x.movedFrom ? T('moved') : '']).filter(Boolean).join(' · '))),
    act || (wn.right && !small ? el('span', { class: 'small muted', style: 'flex:none' }, wn.right) : null));
}
widget({ id: 'household', title: 'Household', icon: 'trash', cat: 'home', multi: true, blurb: 'Bin night, the mail, thirsty plants and the laundry', keywords: 'trash garbage recycling bins pickup mail mailbox post plants water laundry washer dryer dishwasher chores', min: [2, 2], size: [4, 3],
  options: [{ key: 'parts', type: 'chips', label: 'Show', choices: [['bins', 'Bins'], ['mail', 'Mail'], ['plants', 'Plants'], ['laundry', 'Laundry']], help: 'Pick none for all of them.' }],
  async render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), want = new Set(o.parts || []), show = (k) => !want.size || want.has(k);
    const [d, canAct] = await Promise.all([wget('/api/household', 10_000), hhRole()]);
    if (!d?.configured) return b.replaceChildren(empty(T('Bin night, the mail, plants and laundry - set them up once.'), '#settings/household', T('Set up')));
    const chips = [];   // mail, plants, appliances: one small chip each
    if (show('mail') && d.mail) chips.push(d.mail.state === 'post'
      ? el('button', { class: 'hh-c hot', title: T('Tap when you\'ve collected it'), disabled: canAct ? null : true, onclick: () => hhDo('/api/household/mail/collected', {}, T('Mail collected')) }, icon('mailbox'), el('span', {}, d.mail.at ? T(w <= 3 ? 'Mail · {time}' : 'Mail is here · {time}', { time: fmtTime(d.mail.at) }) : T('Mail is here')))
      : el('span', { class: 'hh-c' }, icon('mailbox'), el('span', {}, T('No mail'))));
    if (show('plants') && d.plants.length) {
      const dry = d.plants.filter((p) => p.thirsty && !p.watered);
      chips.push(dry.length ? el('button', { class: 'hh-c hot', title: dry.map((p) => `${p.name}${p.moisture != null ? ` ${p.moisture}%` : ''}`).join(', '), onclick: () => hhPlantsSheet(d, canAct) }, icon('plant'), el('span', {}, dry.length === 1 ? T('{name} is thirsty', { name: dry[0].name }) : T('{n} plants thirsty', { n: dry.length })))
        : el('button', { class: 'hh-c good', onclick: () => hhPlantsSheet(d, canAct) }, icon('plant'), el('span', {}, T('Plants are fine'))));
    }
    if (show('laundry')) for (const a of d.laundry) {
      if (a.phase === 'running') chips.push(el('span', { class: 'hh-c run' }, icon(a.kind), el('span', {}, a.remainingMin != null ? T(w <= 3 ? '{n} min left' : '{name}: {n} min left', { name: T(a.name), n: a.remainingMin }) : T('{name} is running', { name: T(a.name) }))));
      else if (a.phase === 'done') chips.push(el('button', { class: 'hh-c hot', title: T('Tap when it\'s emptied'), disabled: canAct ? null : true, onclick: () => hhDo(`/api/household/laundry/${encodeURIComponent(a.id)}/emptied`, {}, T('Emptied')) }, icon(a.kind), el('span', {}, T('{name} done', { name: T(a.name) }))));
    }
    const bins = show('bins') ? d.bins.filter((x) => x.next || x.error) : [];
    // room: rows of bins (about 50px each) above the chips (about 34px a line, two to four on a line by width)
    const perLine = w >= 6 ? 4 : w >= 3 ? 2 : 1, avail = h * ROW_PX + (h - 1) * GAP_PX - 46;
    const bins0 = show('bins') ? d.bins.filter((x) => x.next || x.error).length : 0;
    let lines = Math.ceil(chips.length / perLine);
    chips.sort((x, y) => Number(y.classList.contains('hot')) - Number(x.classList.contains('hot')));   // what needs you first
    while (lines > 0 && (bins0 ? 52 : 0) + lines * 34 + 8 > avail) lines--;
    chips.splice(lines * perLine);
    const room = Math.max(bins0 ? 1 : 0, Math.floor((avail - (lines ? lines * 34 + 8 : 0)) / 52));
    const rows = bins.slice(0, room).map((x) => hhBinRow(x, w, canAct));
    if (!rows.length && !chips.length) return b.replaceChildren(empty(T('Nothing to do around the house.')));
    b.replaceChildren(...[rows.length ? el('div', { class: 'hh-rows' }, rows) : null, chips.length ? el('div', { class: 'hh-chips', style: rows.length ? null : 'margin-top:0' }, chips) : null].filter(Boolean));
    // then, measured: while it doesn't fit, drop the last bin (keeping one) or the last chip
    requestAnimationFrame(() => {
      for (let i = 0; i < 20 && b.isConnected && b.scrollHeight > b.clientHeight + 2; i++) {
        const rs = b.querySelectorAll('.hh-row'), cs = b.querySelectorAll('.hh-c');
        if (rs.length > 1 && (rs.length > 2 || !cs.length)) rs[rs.length - 1].remove(); else if (cs.length) cs[cs.length - 1].remove(); else break;
      }
    });
  } });

/* The plants, with their moisture - and "Watered" for the ones that asked. */
function hhPlantsSheet(d, canAct) {
  const dry = d.plants.filter((p) => p.thirsty && !p.watered);
  const m = modal(el('div', {},
    el('div', { class: 'hh-list' }, d.plants.map((p) => el('div', { class: 'hh-item', style: 'cursor:default' }, hhChip('plant', p.thirsty && !p.watered ? '#ea580c' : '#16a34a'),
      el('div', { class: 'grow' }, el('b', { class: 'ellipsis', style: 'display:block' }, p.name), el('span', { class: 'small muted' }, [p.moisture != null ? T('Soil {n}%', { n: p.moisture }) : null, p.offline ? T('Not answering') : p.watered ? T('Watered today') : p.thirsty ? T('Thirsty') : T('Fine')].filter(Boolean).join(' · ')))))),
    dry.length && canAct ? el('button', { class: 'btn primary', onclick: async () => { m.remove(); await hhDo('/api/household/plants/watered', {}, T('Watered')); } }, icon('drop'), T('I watered them')) : null), { title: T('Plants') });
}

/* ======================= the Household page =======================
   A page of tiles (06-pagegrid.js), like every other page: the bins, the mail, the plants and the laundry, each a
   tile Edit can move, resize or remove; the server suggests the ones this house has set up (60-layout.js). */
const hhPageEmpty = () => pgEmpty(T('Bin night, the mail, plants and laundry - set them up once.'), '#settings/household', T('Set up'));
pageTile({ id: 'hh-start', page: 'household', auto: true, title: 'Get started', icon: 'trash', blurb: 'Set up bins, the mail, plants and laundry', size: [12, 1], render(b) { b.replaceChildren(hhPageEmpty()); } });
pageTile({ id: 'hh-bins', page: 'household', auto: true, title: 'Bins', icon: 'trash', blurb: 'Every bin and its next pickup - tap "It\'s out" the evening before', size: [6, 1], render(b, ctx) {
  const d = ctx.data.hh, bins = (d?.bins || []).filter((x) => x.next || x.error);
  b.replaceChildren(!d?.configured ? hhPageEmpty() : bins.length ? el('div', { class: 'hh-rows' }, bins.map((x) => hhBinRow(x, 6, ctx.data.canAct))) : pgEmpty(T('No bins set up yet.'), '#settings/household', T('Add a bin')));
} });
pageTile({ id: 'hh-mail', page: 'household', auto: true, title: 'Mail', icon: 'mailbox', blurb: 'Whether the mail is here', size: [6, 1], render(b, ctx) {
  const m = ctx.data.hh?.mail;
  if (!m) return b.replaceChildren(pgEmpty(T('Use a mailbox sensor to know when the mail is here.'), '#settings/household', T('Set up')));
  b.replaceChildren(m.state === 'post'
    ? el('div', { class: 'hh-row hot' }, hhChip('mailbox', '#2563eb'), el('div', { class: 'grow' }, el('b', {}, T('The mail is here')), m.at ? el('span', { class: 'sub' }, fmtTime(m.at)) : null),
      ctx.data.canAct ? el('button', { class: 'hh-outbtn', onclick: () => hhDo('/api/household/mail/collected', {}, T('Mail collected')) }, icon('check'), T('Collected')) : null)
    : el('div', { class: 'hh-row' }, hhChip('mailbox', '#6b7280'), el('div', { class: 'grow' }, el('b', {}, T('No mail')))));
} });
pageTile({ id: 'hh-plants', page: 'household', auto: true, title: 'Plants', icon: 'plant', blurb: 'Soil moisture, and which plants are thirsty', size: [6, 1], render(b, ctx) {
  const list = ctx.data.hh?.plants || [];
  if (!list.length) return b.replaceChildren(pgEmpty(T('Add plant sensors to know when they\'re thirsty.'), '#settings/household', T('Set up')));
  const dry = list.filter((p) => p.thirsty && !p.watered);
  b.replaceChildren(el('div', { class: 'hh-rows' }, list.map((p) => el('div', { class: `hh-row${p.thirsty && !p.watered ? ' hot' : ''}` }, hhChip('plant', p.thirsty && !p.watered ? '#ea580c' : '#16a34a'),
    el('div', { class: 'grow' }, el('b', { class: 'ellipsis' }, p.name), el('span', { class: 'sub' }, [p.moisture != null ? T('Soil {n}%', { n: p.moisture }) : null, p.offline ? T('Not answering') : p.watered ? T('Watered today') : p.thirsty ? T('Thirsty') : T('Fine')].filter(Boolean).join(' · ')))))),
    dry.length && ctx.data.canAct ? el('button', { class: 'btn small primary', style: 'margin-top:10px', onclick: () => hhDo('/api/household/plants/watered', {}, T('Watered')) }, icon('drop'), T('I watered them')) : null);
} });
pageTile({ id: 'hh-laundry', page: 'household', auto: true, title: 'Laundry', icon: 'washer', blurb: 'The washer, dryer and dishwasher', size: [6, 1], render(b, ctx) {
  const list = ctx.data.hh?.laundry || [];
  if (!list.length) return b.replaceChildren(pgEmpty(T('Add your washer, dryer or dishwasher to know when they\'re done.'), '#settings/household', T('Set up')));
  b.replaceChildren(el('div', { class: 'hh-rows' }, list.map((a) => el('div', { class: `hh-row${a.phase === 'done' ? ' hot' : ''}` }, hhChip(a.kind, a.phase === 'running' ? '#2563eb' : '#6b7280'),
    el('div', { class: 'grow' }, el('b', { class: 'ellipsis' }, T(a.name)), el('span', { class: 'sub' }, a.phase === 'running' ? (a.remainingMin != null ? T('{n} min left', { n: a.remainingMin }) : T('Running')) : a.phase === 'done' ? T('Done') : T('Idle'))),
    a.phase === 'done' && ctx.data.canAct ? el('button', { class: 'hh-outbtn', onclick: () => hhDo(`/api/household/laundry/${encodeURIComponent(a.id)}/emptied`, {}, T('Emptied')) }, icon('check'), T('Emptied')) : null))));
} });
tab({ id: 'household', label: 'Household', icon: 'trash', after: 'reminders', async render(main) {
  const load = async () => { WCACHE.delete('/api/household'); const [hh, canAct] = await Promise.all([wget('/api/household', 10_000).catch(() => null), hhRole()]); return { hh, canAct }; };
  return pageGrid(main, { page: 'household', auto: true, title: tabLabel({ id: 'household', label: T('Household') }), sub: T('Bins, the mail, plants and laundry'), load,
    actions: [el('a', { class: 'btn', href: '#settings/household' }, icon('gear', 14), el('span', { class: 'hide-phone' }, T('Household settings')))] });
} });

/* ======================= Settings › Household ======================= */
async function householdCards() {
  const host = el('div', { style: 'display:contents' });
  const draw = async () => {
    let d;
    try { d = await api('/api/household/setup'); d.view = await api('/api/household').catch(() => ({})); } catch (e) { host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'small muted' }, e.message))); return; }
    const canEdit = !d.demo && (await hhRole());
    const save = async (patch, msg = T('Saved')) => { try { const r = await post('/api/household/setup', patch, 'PUT'); Object.assign(d, r); WCACHE.delete('/api/household'); if (msg) toast(msg); return true; } catch (e) { toast(e.message, 4000); return false; } };
    const ctx = { d, canEdit, save, redraw: draw };
    host.replaceChildren(...[...(await Promise.all([hhBinsCard(ctx), hhMailCard(ctx), hhPlantsCard(ctx), hhLaundryCard(ctx)])),
      d.demo ? el('div', { class: 'card', style: 'grid-column:1/-1' }, el('p', { class: 'small muted', style: 'margin:0' }, T('This is the demo: everything here is a sample, and changes aren\'t saved.'))) : null].filter(Boolean));
  };
  await draw();
  return [host];
}
const hhHead = (ic, title, text, extra) => el('div', { class: 'row between wrap', style: 'gap:10px' }, el('div', { style: 'min-width:0;flex:1' }, el('h2', { style: 'margin:0' }, icon(ic, 16), title), text ? el('p', { class: 'small muted', style: 'margin:4px 0 0' }, text) : null), extra || null);
const hhNeedHa = () => el('div', { class: 'hh-sug' }, el('div', { class: 'small' }, T('This uses a sensor in Home Assistant. Connect Home Assistant first.')), el('a', { class: 'btn small', href: '#connect', style: 'margin-top:8px' }, T('Connect Home Assistant')));
/* A list of Home Assistant entities to pick from: the likely ones first. */
function hhEntSelect(d, value, keep, suggested = [], onchange) {
  const sug = new Set(suggested), all = d.entities.filter(keep), lab = (e) => `${e.name} · ${e.state}${e.unit ? ` ${e.unit}` : ''}`;
  const opt = (e) => el('option', { value: e.id, selected: e.id === value ? true : null }, lab(e));
  const top = all.filter((e) => sug.has(e.id)), rest = all.filter((e) => !sug.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (value && !all.some((e) => e.id === value)) rest.unshift({ id: value, name: value, state: T('not found') });
  return el('select', { onchange: (e) => onchange?.(e.target.value) }, el('option', { value: '' }, T('Choose…')),
    top.length ? el('optgroup', { label: T('Suggested') }, top.map(opt)) : null, el('optgroup', { label: top.length ? T('Everything else') : T('Sensors') }, rest.slice(0, 1500).map(opt)));
}
const hhSchedule = (b) => {
  if (b.source === 'ha') return T('From Home Assistant');
  if (b.source === 'ical') return T('From the city calendar');
  const day = T(HH_DOW_LONG[b.dow ?? 1]);
  if (b.repeat === 'biweekly') return T('Every other {day}', { day });
  if (b.repeat === 'every4') return T('Every 4 weeks on {day}', { day });
  if (b.repeat === 'monthly') return b.mday ? T('Every month on the {n}', { n: ordinal(b.mday) }) : T('The {nth} {day} of the month', { nth: T({ 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', '-1': 'last' }[b.nth] || 'first'), day });
  return T('Every {day}', { day });
};

/* ---- Bins ---- */
async function hhBinsCard({ d, canEdit, save, redraw }) {
  const view = d.view || { bins: [] }, next = new Map((view.bins || []).map((b) => [b.id, b]));
  const add = canEdit ? el('button', { class: 'btn small primary', onclick: () => hhBinEditor(null, d, save, redraw) }, icon('plus'), T('Add a bin')) : null;
  const card = el('div', { class: 'card hh-card', style: 'grid-column:1/-1' }, hhHead('trash', T('Bins'), T('Your pickup days, a reminder the evening before, and the next pickups on the Home screen.'), add));
  if (d.suggest?.bins?.length && canEdit) card.append(el('div', { class: 'hh-sug' }, el('div', { class: 'small', style: 'font-weight:600;margin-bottom:2px' }, T('Found in Home Assistant')),
    d.suggest.bins.map((s) => el('div', { class: 'hh-sugrow' }, hhChip(s.icon, s.color, 'xs'), el('div', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block;font-size:14px' }, s.name), el('span', { class: 'small muted' }, T('Next pickup {day}', { day: hhDay(s.next) }))),
      el('button', { class: 'btn small', onclick: async () => { if (await save({ bins: [...d.bins, { name: s.name, icon: s.icon, color: s.color, source: 'ha', entity: s.entity }] }, T('Added'))) redraw(); } }, icon('plus'), T('Add'))))));
  if (d.bins.length) {
    card.append(el('div', { class: 'hh-list' }, d.bins.map((b) => { const v = next.get(b.id); return el('button', { class: 'hh-item', disabled: canEdit ? null : true, onclick: () => hhBinEditor(b, d, save, redraw) }, hhChip(b.icon, b.color),
      el('div', { class: 'grow' }, el('b', { class: 'ellipsis', style: 'display:block' }, b.name), el('span', { class: 'small muted' }, hhSchedule(b), v?.next ? ` · ${T('next {day}', { day: hhDay(v.next) })}` : v?.error ? ` · ${T(v.error)}` : '')),
      canEdit ? el('span', { class: 'chev' }, icon('chevr')) : null); })));
  } else {
    const ideas = [['Trash', 'trash', '#6b7280'], ['Recycling', 'recycling', '#2563eb'], ['Yard waste', 'yard', '#65a30d'], ['Organics', 'organics', '#92400e']];
    card.append(el('div', { class: 'row wrap', style: 'gap:8px;margin:10px 0' }, el('span', { class: 'small muted' }, T('Start with:')), ideas.map(([name, ic, color]) => el('button', { class: 'btn small', disabled: canEdit ? null : true, onclick: () => hhBinEditor({ name: T(name), icon: ic, color, source: 'schedule', repeat: 'weekly', dow: 2 }, d, save, redraw) }, icon(ic), T(name)))));
  }
  // the city's calendar link
  card.append(el('div', { class: 'hh-item', style: 'cursor:default' }, icon('calendar'), el('div', { class: 'grow' }, el('b', { style: 'display:block' }, T('Your city\'s pickup calendar')),
    el('span', { class: 'small muted' }, d.ical ? T('Linked: {host}', { host: d.icalHost || '-' }) : T('Many cities publish one (an iCal or webcal link). Paste it and CasaTorch finds the bins in it.'))),
  canEdit ? el('button', { class: 'btn small', onclick: () => hhIcalSheet(d, save, redraw) }, d.ical ? T('Change') : T('Add link')) : null));
  // the reminder
  const r = d.remind;
  const time = el('input', { type: 'time', value: r.time, disabled: canEdit ? null : true, 'aria-label': T('Reminder time'), onchange: (e) => save({ remind: { ...r, time: e.target.value } }) });
  const flash = el('input', { type: 'checkbox', checked: r.flash !== false ? true : null, disabled: canEdit ? null : true, onchange: (e) => save({ remind: { ...r, flash: e.target.checked } }) });
  const pushBox = el('input', { type: 'checkbox', checked: r.push ? true : null, disabled: canEdit && d.pro ? null : true, onchange: (e) => save({ remind: { ...r, push: e.target.checked } }) });
  card.append(el('hr', { class: 'hh-sep' }), el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Reminder the evening before')), el('div', { class: 'hh-inline' }, time, el('span', { class: 'small muted' }, T('"Take out the recycling tonight" - until someone taps "Done - it\'s out".')))),
    el('label', { class: 'check' }, flash, el('span', {}, el('b', {}, T('Show it on every screen')))),
    el('label', { class: `check${d.pro ? '' : ' locked'}` }, pushBox, el('span', {}, el('b', {}, T('Send it to phones')), ' ', d.pro ? null : el('span', { class: 'pill pro' }, 'Pro'), el('span', { class: 'small muted', style: 'display:block' }, d.pro ? (d.phones ? T('To every phone with CasaTorch alerts on.') : T('No phones have CasaTorch alerts on yet - turn them on in Settings › Phones & alerts.')) : T('Reach everyone\'s phone, wherever they are.')))));
  // holidays
  const binName = (id) => d.bins.find((b) => b.id === id)?.name || T('All bins');
  card.append(el('hr', { class: 'hh-sep' }), hhHead('calendar', T('Holidays'), T('Skip or move a pickup, or a holiday week when every pickup slides a day.'), canEdit && d.bins.length ? el('button', { class: 'btn small', onclick: () => hhChangeSheet(d, save, redraw) }, icon('plus'), T('Skip or move a pickup')) : null),
    d.changes.length ? el('div', { class: 'hh-list' }, d.changes.map((c) => el('div', { class: 'hh-item', style: 'cursor:default' }, icon(c.holiday ? 'calendar' : 'clock'),
      el('div', { class: 'grow' }, el('b', { style: 'display:block' }, c.holiday ? T('Holiday week of {day}', { day: hhDay(c.holiday) }) : c.to ? T('{day} moves to {to}', { day: hhDay(c.date), to: hhDay(c.to) }) : T('No pickup {day}', { day: hhDay(c.date) })),
        el('span', { class: 'small muted' }, c.holiday ? T('That day and the rest of its week: a day later') : binName(c.bin))),
      canEdit ? el('button', { class: 'btn small ghost', 'aria-label': T('Remove'), onclick: async () => { if (await save({ changes: d.changes.filter((x) => x.id !== c.id) }, T('Removed'))) redraw(); } }, icon('x')) : null))) : el('p', { class: 'hh-note' }, T('No changes - every pickup is on its usual day.')));
  return card;
}
function hhBinEditor(b, d, save, redraw) {
  const isNew = !b?.id;
  const v = { name: b?.name || '', icon: b?.icon || 'trash', color: b?.color || '#6b7280', source: b?.source || 'schedule', repeat: b?.repeat || 'weekly', dow: b?.dow ?? 2, start: b?.start || new Date().toISOString().slice(0, 10), nth: b?.nth ?? 1, mday: b?.mday || null, entity: b?.entity || '', match: b?.match || '' };
  const body = el('div', {}), msg = el('p', { class: 'small', style: 'min-height:1.2em;margin:6px 0 0;color:var(--bad)' });
  const seg = (opts, cur, set) => el('div', { class: 'seg', role: 'group' }, opts.map(([k, l, off]) => el('button', { type: 'button', class: cur === k ? 'on' : null, 'aria-pressed': String(cur === k), disabled: off ? true : null, onclick: () => { set(k); draw(); } }, l)));
  const draw = () => {
    const parts = [
      el('label', { class: 'field' }, el('span', {}, T('Name')), el('input', { value: v.name, maxlength: 40, placeholder: T('Recycling'), oninput: (e) => { v.name = e.target.value; } })),
      el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Kind')), el('div', { class: 'hh-kinds', role: 'radiogroup' }, d.icons.map((k) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v.icon === k), class: v.icon === k ? 'on' : null, onclick: () => { const wasDefault = !v.name || Object.values(HH_BIN_NAMES).some((n) => T(n) === v.name); v.icon = k; if (wasDefault) v.name = T(HH_BIN_NAMES[k]); draw(); } }, icon(k), T(HH_BIN_NAMES[k]))))),
      el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Color')), el('div', { class: 'hh-colors', role: 'radiogroup' }, d.colors.map((c) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v.color === c), 'aria-label': c, class: v.color === c ? 'on' : null, style: `background:${c}`, onclick: () => { v.color = c; draw(); } })))),
      el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Pickup days')), seg([['schedule', T('Schedule')], ['ha', T('Home Assistant'), !d.ha], ['ical', T('City calendar')]], v.source, (k) => { v.source = k; })),
    ];
    if (v.source === 'schedule') {
      parts.push(el('label', { class: 'field' }, el('span', {}, T('How often')), el('select', { onchange: (e) => { v.repeat = e.target.value; draw(); } }, [['weekly', T('Every week')], ['biweekly', T('Every 2 weeks')], ['every4', T('Every 4 weeks')], ['monthly', T('Once a month')]].map(([k, l]) => el('option', { value: k, selected: v.repeat === k ? true : null }, l)))));
      if (v.repeat === 'monthly') {
        parts.push(el('label', { class: 'field' }, el('span', {}, T('Which day')), el('select', { onchange: (e) => { const x = e.target.value; if (x === 'date') { v.mday = v.mday || 1; } else { v.mday = null; v.nth = Number(x); } draw(); } },
          [[1, T('The first')], [2, T('The second')], [3, T('The third')], [4, T('The fourth')], [-1, T('The last')], ['date', T('The same date each month')]].map(([k, l]) => el('option', { value: k, selected: (k === 'date' ? !!v.mday : !v.mday && v.nth === k) ? true : null }, l)))));
      }
      if (v.repeat === 'monthly' && v.mday) parts.push(el('label', { class: 'field' }, el('span', {}, T('Day of the month')), el('input', { type: 'number', min: 1, max: 31, value: v.mday, style: 'max-width:120px', oninput: (e) => { v.mday = Number(e.target.value) || 1; } })));
      else parts.push(el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Pickup day')), el('div', { class: 'row wrap', style: 'gap:6px', role: 'radiogroup' }, DOW.map((l, i) => el('button', { type: 'button', role: 'radio', class: `chipbtn${v.dow === i ? ' on' : ''}`, 'aria-checked': String(v.dow === i), onclick: () => { v.dow = i; draw(); } }, T(l))))));
      if (['biweekly', 'every4'].includes(v.repeat)) parts.push(el('label', { class: 'field' }, el('span', {}, T('The next pickup (or any one you know)')), el('input', { type: 'date', value: v.start, style: 'max-width:200px', onchange: (e) => { v.start = e.target.value; } })));
    } else if (v.source === 'ha') {
      const keep = (e) => /^(sensor|calendar|input_datetime)\./.test(e.id);
      parts.push(el('label', { class: 'field' }, el('span', {}, T('The sensor with the next pickup')), hhEntSelect(d, v.entity, keep, (d.suggest?.bins || []).map((s) => s.entity), (x) => { v.entity = x; })),
        el('label', { class: 'field' }, el('span', {}, T('Only pickups named (when one sensor has several bins)')), el('input', { value: v.match, maxlength: 40, placeholder: T('Optional - for example "Recycling"'), oninput: (e) => { v.match = e.target.value; } })),
        el('p', { class: 'hh-note' }, T('Works with Waste Collection Schedule and any sensor or calendar that has the next date.')));
    } else {
      parts.push(d.ical ? null : el('p', { class: 'hh-note' }, T('Add your city\'s calendar link first (under Bins).')),
        el('label', { class: 'field' }, el('span', {}, T('Pickups named')), el('input', { value: v.match || v.name, maxlength: 40, placeholder: T('Recycling'), oninput: (e) => { v.match = e.target.value; } })));
    }
    parts.push(msg);
    body.replaceChildren(...parts.filter(Boolean));
  };
  draw();
  const others = d.bins.filter((x) => x.id !== b?.id);
  const ok = el('button', { class: 'btn primary', onclick: async () => {
    msg.textContent = '';
    const bin = { ...(b?.id ? { id: b.id } : {}), name: v.name, icon: v.icon, color: v.color, source: v.source, repeat: v.repeat, dow: v.dow, start: v.start, ...(v.repeat === 'monthly' ? (v.mday ? { mday: v.mday } : { nth: v.nth }) : {}), entity: v.entity, match: v.match };
    ok.disabled = true;
    try { const r = await post('/api/household/setup', { bins: isNew ? [...d.bins, bin] : d.bins.map((x) => (x.id === b.id ? bin : x)) }, 'PUT'); Object.assign(d, r); WCACHE.delete('/api/household'); m.remove(); toast(isNew ? T('Added') : T('Saved')); redraw(); }
    catch (e) { msg.textContent = e.message; ok.disabled = false; }
  } }, isNew ? T('Add bin') : T('Save'));
  const del = isNew ? null : el('button', { class: 'btn ghost danger', onclick: async () => { if (!confirm(T('Remove "{name}"?', { name: b.name }))) return; if (await save({ bins: others }, T('Removed'))) { m.remove(); redraw(); } } }, icon('x'), T('Remove'));
  const m = modal(el('div', {}, body, el('div', { class: 'row between wrap', style: 'gap:8px;margin-top:14px' }, el('span', {}, del), ok)), { title: isNew ? T('Add a bin') : T('Change bin') });
}
function hhIcalSheet(d, save, redraw) {
  const url = el('input', { type: 'url', placeholder: 'https://…/pickups.ics', autocomplete: 'off', 'aria-label': T('Calendar link') });
  const out = el('div', {}), msg = el('p', { class: 'small', style: 'min-height:1.2em;margin:6px 0 0' });
  const find = el('button', { class: 'btn primary', onclick: async () => {
    msg.textContent = T('Reading the calendar…'); msg.style.color = ''; find.disabled = true;
    try {
      const r = await post('/api/household/ical', url.value.trim() ? { url: url.value.trim() } : {});
      if (url.value.trim() && !(await save({ ical: url.value.trim() }, null))) throw new Error(T('The link could not be saved.'));
      msg.textContent = T('Found {n} kinds of pickup. Add the ones you have:', { n: r.kinds.length });
      out.replaceChildren(el('div', { class: 'hh-list' }, r.kinds.map((k) => {
        const have = d.bins.some((b) => b.source === 'ical' && String(b.match).toLowerCase() === k.title.toLowerCase());
        const btn = el('button', { class: 'btn small', disabled: have ? true : null, onclick: async () => { btn.disabled = true; if (await save({ bins: [...d.bins, { name: k.title, icon: k.icon, color: k.color, source: 'ical', match: k.title }] }, T('Added'))) { btn.textContent = T('Added'); redraw(); } else btn.disabled = false; } }, have ? T('Added') : T('Add'));
        return el('div', { class: 'hh-item', style: 'cursor:default' }, hhChip(k.icon, k.color, 'xs'), el('div', { class: 'grow' }, el('b', { class: 'ellipsis', style: 'display:block' }, k.title), el('span', { class: 'small muted' }, T('Next pickup {day}', { day: hhDay(k.next) }))), btn);
      })));
    } catch (e) { msg.textContent = e.message; msg.style.color = 'var(--bad)'; }
    find.disabled = false;
  } }, T('Find bins'));
  const unlink = d.ical ? el('button', { class: 'btn ghost', onclick: async () => { if (await save({ ical: null, bins: d.bins.filter((b) => b.source !== 'ical') }, T('Removed'))) { m.remove(); redraw(); } } }, T('Remove the link')) : null;
  const m = modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('Your city or waste company\'s website usually has an "Add to calendar", iCal or webcal link for your street. Copy it and paste it here.')),
    d.ical ? el('p', { class: 'small' }, T('Linked: {host}. Paste a new link to change it, or leave it empty to read the one you have.', { host: d.icalHost || '-' })) : null,
    el('label', { class: 'field' }, el('span', {}, T('Calendar link')), url), msg, out, el('div', { class: 'row between wrap', style: 'gap:8px;margin-top:12px' }, el('span', {}, unlink), find)), { title: T('City pickup calendar') });
  setTimeout(() => url.focus(), 30);
}
function hhChangeSheet(d, save, redraw) {
  const v = { kind: 'one', date: new Date().toISOString().slice(0, 10), to: '', bin: '', skip: true, days: 1 };
  const body = el('div', {});
  const draw = () => {
    const seg = el('div', { class: 'seg' }, [['one', T('One pickup')], ['holiday', T('Holiday week')]].map(([k, l]) => el('button', { type: 'button', class: v.kind === k ? 'on' : null, 'aria-pressed': String(v.kind === k), onclick: () => { v.kind = k; draw(); } }, l)));
    const parts = [seg];
    if (v.kind === 'one') {
      parts.push(el('label', { class: 'field' }, el('span', {}, T('Bin')), el('select', { onchange: (e) => { v.bin = e.target.value; } }, el('option', { value: '' }, T('All bins')), d.bins.map((b) => el('option', { value: b.id, selected: v.bin === b.id ? true : null }, b.name)))),
        el('label', { class: 'field' }, el('span', {}, T('The pickup on')), el('input', { type: 'date', value: v.date, style: 'max-width:200px', onchange: (e) => { v.date = e.target.value; } })),
        el('div', { class: 'seg', style: 'margin:4px 0' }, [[true, T('Skip it')], [false, T('Move it')]].map(([k, l]) => el('button', { type: 'button', class: v.skip === k ? 'on' : null, onclick: () => { v.skip = k; draw(); } }, l))),
        v.skip ? null : el('label', { class: 'field' }, el('span', {}, T('To')), el('input', { type: 'date', value: v.to, style: 'max-width:200px', onchange: (e) => { v.to = e.target.value; } })));
    } else {
      parts.push(el('label', { class: 'field' }, el('span', {}, T('The holiday')), el('input', { type: 'date', value: v.date, style: 'max-width:200px', onchange: (e) => { v.date = e.target.value; } })),
        el('p', { class: 'hh-note' }, T('Pickups that day and later that week come a day later - the way most cities handle holidays.')));
    }
    body.replaceChildren(...parts.filter(Boolean));
  };
  draw();
  const ok = el('button', { class: 'btn primary', onclick: async () => {
    const c = v.kind === 'holiday' ? { holiday: v.date, days: 1 } : { date: v.date, to: v.skip ? null : v.to || null, bin: v.bin || null };
    if (v.kind === 'one' && !v.skip && !v.to) { toast(T('Pick the new day.')); return; }
    if (await save({ changes: [...d.changes, c] }, T('Saved'))) { m.remove(); redraw(); }
  } }, T('Save'));
  const m = modal(el('div', {}, body, el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, ok)), { title: T('Skip or move a pickup') });
}

/* ---- Mail ---- */
function hhMailCard({ d, canEdit, save, redraw }) {
  const card = el('div', { class: 'card hh-card' }, hhHead('mailbox', T('Mail'), T('A sensor on the mailbox: "The mail is here" when it opens, cleared when it opens again (or with a tap).')));
  if (!d.ha) { card.append(hhNeedHa()); return card; }
  const mcfg = d.mail;
  const set = async (p) => { if (await save({ mail: { ...mcfg, ...p } })) redraw(); };
  if (!mcfg.entity && d.suggest?.mail?.length && canEdit) {
    const s = d.suggest.mail[0];
    card.append(el('div', { class: 'hh-sug' }, el('div', { class: 'hh-sugrow' }, icon('mailbox'), el('div', { class: 'grow', style: 'min-width:0' }, el('b', { class: 'ellipsis', style: 'display:block;font-size:14px' }, s.name), el('span', { class: 'small muted' }, T('Looks like your mailbox'))),
      el('button', { class: 'btn small primary', onclick: () => set({ entity: s.entity }) }, T('Use it')))));
  }
  const keep = (e) => /^(binary_sensor|sensor|input_boolean)\./.test(e.id);
  const sel = hhEntSelect(d, mcfg.entity || '', keep, (d.suggest?.mail || []).map((s) => s.entity), (x) => set({ entity: x || null })); if (!canEdit) sel.disabled = true;
  card.append(el('label', { class: 'field' }, el('span', {}, T('Mailbox sensor')), sel));
  if (mcfg.entity) {
    card.append(el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Collected when')), el('div', { class: 'seg' }, [['door', T('It opens again')], ['tap', T('Someone taps')]].map(([k, l]) => el('button', { type: 'button', class: mcfg.reset === k ? 'on' : null, disabled: canEdit ? null : true, onclick: () => set({ reset: k }) }, l)))),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: mcfg.remind !== false ? true : null, disabled: canEdit ? null : true, onchange: (e) => set({ remind: e.target.checked }) }), el('span', {}, el('b', {}, T('Show "The mail is here" on every screen')))),
      el('label', { class: `check${d.pro ? '' : ' locked'}` }, el('input', { type: 'checkbox', checked: mcfg.push ? true : null, disabled: canEdit && d.pro ? null : true, onchange: (e) => set({ push: e.target.checked }) }), el('span', {}, el('b', {}, T('Send it to phones')), ' ', d.pro ? null : el('span', { class: 'pill pro' }, 'Pro'))));
  }
  return card;
}

/* ---- Plants ---- */
function hhPlantsCard({ d, canEdit, save, redraw }) {
  const card = el('div', { class: 'card hh-card' }, hhHead('plant', T('Plants'), T('Plant sensors in Home Assistant. Below the level you pick, a plant is thirsty.')));
  if (!d.ha) { card.append(hhNeedHa()); return card; }
  const p = d.plants, have = new Map(p.list.map((x) => [x.entity, x]));
  const live = new Map((d.view?.plants || []).map((x) => [x.id, x.moisture]));
  const set = async (patch, again = true) => { if (await save({ plants: { ...p, ...patch } }) && again) redraw(); };
  const cands = [...p.list.map((x) => ({ entity: x.entity, name: x.name, moisture: live.get(x.entity) ?? null })), ...(d.suggest?.plants || [])];
  if (!cands.length) card.append(el('p', { class: 'small muted' }, T('No plant sensors found in Home Assistant yet. Plant cards (plant.…) and soil-moisture sensors show up here.')));
  else card.append(el('div', { class: 'hh-list' }, cands.map((c) => el('label', { class: 'hh-item' }, el('input', { type: 'checkbox', checked: have.has(c.entity) ? true : null, disabled: canEdit ? null : true, style: 'width:18px;height:18px;flex:none;accent-color:var(--accent)',
    onchange: (e) => set({ list: e.target.checked ? [...p.list, { entity: c.entity, name: c.name }] : p.list.filter((x) => x.entity !== c.entity) }) }), icon('plant'),
  el('div', { class: 'grow' }, el('b', { class: 'ellipsis', style: 'display:block' }, c.name), el('span', { class: 'small muted' }, c.moisture != null ? T('Soil {n}%', { n: c.moisture }) : c.entity))))));
  if (p.list.length) {
    card.append(el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Thirsty below')), el('div', { class: 'hh-inline' }, el('input', { type: 'number', min: 1, max: 90, value: p.threshold, disabled: canEdit ? null : true, 'aria-label': T('Thirsty below'), onchange: (e) => set({ threshold: Number(e.target.value) }, false) }), el('span', { class: 'small muted' }, T('% soil moisture (plant cards also use their own limits)')))),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: p.remind !== false ? true : null, disabled: canEdit ? null : true, onchange: (e) => set({ remind: e.target.checked }, false) }), el('span', {}, el('b', {}, T('A reminder when any is thirsty, at')), ' ')),
      el('div', { class: 'hh-inline', style: 'margin-left:28px' }, el('input', { type: 'time', value: p.time, disabled: canEdit ? null : true, 'aria-label': T('Plant reminder time'), onchange: (e) => set({ time: e.target.value }, false) })));
  }
  return card;
}

/* ---- Laundry & dishes ---- */
function hhLaundryCard({ d, canEdit, save, redraw }) {
  const add = canEdit && d.ha ? el('button', { class: 'btn small', onclick: () => hhAppEditor(null, d, save, redraw) }, icon('plus'), T('Add')) : null;
  const card = el('div', { class: 'card hh-card' }, hhHead('washer', T('Laundry & dishes'), T('"Washer: 23 min left", "Dryer done" - from a time-left sensor, a status, or a smart plug\'s power.'), add));
  if (!d.ha) { card.append(hhNeedHa()); return card; }
  if (d.suggest?.apps?.length && canEdit) card.append(el('div', { class: 'hh-sug' }, el('div', { class: 'small', style: 'font-weight:600;margin-bottom:2px' }, T('Found in Home Assistant')),
    d.suggest.apps.map((s) => el('div', { class: 'hh-sugrow' }, icon(s.kind), el('div', { class: 'grow', style: 'min-width:0' }, el('b', { style: 'display:block;font-size:14px' }, T(s.name)), el('span', { class: 'small muted ellipsis', style: 'display:block' }, `${s.entityName} · ${T({ power: 'power', state: 'status', remaining: 'time left' }[s.mode])}`)),
      el('button', { class: 'btn small', onclick: async () => { if (await save({ apps: [...d.apps, { name: T(s.name), kind: s.kind, entity: s.entity, mode: s.mode, remaining: s.remaining }] }, T('Added'))) redraw(); } }, icon('plus'), T('Add'))))));
  if (d.apps.length) card.append(el('div', { class: 'hh-list' }, d.apps.map((a) => el('button', { class: 'hh-item', disabled: canEdit ? null : true, onclick: () => hhAppEditor(a, d, save, redraw) }, icon(a.kind),
    el('div', { class: 'grow' }, el('b', { class: 'ellipsis', style: 'display:block' }, a.name), el('span', { class: 'small muted' }, a.mode === 'power' ? T('Running above {w} W', { w: a.onW }) : a.mode === 'state' ? T('From its status') : T('From its time left'))), canEdit ? el('span', { class: 'chev' }, icon('chevr')) : null))));
  else if (!d.suggest?.apps?.length) card.append(el('p', { class: 'small muted' }, T('Nothing found yet. Add one and pick its sensor - a smart plug\'s power works for any machine.')));
  if (d.apps.length) card.append(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: d.appsRemind ? true : null, disabled: canEdit ? null : true, onchange: (e) => save({ appsRemind: e.target.checked }) }), el('span', {}, el('b', {}, T('A reminder to empty it when it\'s done')))),
    el('label', { class: `check${d.pro ? '' : ' locked'}` }, el('input', { type: 'checkbox', checked: d.appsPush ? true : null, disabled: canEdit && d.pro ? null : true, onchange: (e) => save({ appsPush: e.target.checked }) }), el('span', {}, el('b', {}, T('Send it to phones')), ' ', d.pro ? null : el('span', { class: 'pill pro' }, 'Pro'))));
  return card;
}
function hhAppEditor(a, d, save, redraw) {
  const isNew = !a?.id;
  const v = { name: a?.name || T('Washer'), kind: a?.kind || 'washer', entity: a?.entity || '', mode: a?.mode || 'power', remaining: a?.remaining || '', onW: a?.onW || 8, offMin: a?.offMin || 5 };
  const body = el('div', {}), msg = el('p', { class: 'small', style: 'min-height:1.2em;margin:6px 0 0;color:var(--bad)' });
  const draw = () => {
    const keep = v.mode === 'power' ? (e) => /^sensor\./.test(e.id) && (e.cls === 'power' || /^k?W$/.test(e.unit || '')) : v.mode === 'remaining' ? (e) => /^sensor\./.test(e.id) && (/^(min|h|s)$/.test(e.unit || '') || ['duration', 'timestamp'].includes(e.cls)) : (e) => /^(sensor|binary_sensor|switch)\./.test(e.id);
    body.replaceChildren(...[
      el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('Which')), el('div', { class: 'hh-kinds three', role: 'radiogroup' }, Object.keys(HH_KIND_NAMES).map((k) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v.kind === k), class: v.kind === k ? 'on' : null, onclick: () => { if (Object.values(HH_KIND_NAMES).some((n) => T(n) === v.name)) v.name = T(HH_KIND_NAMES[k]); v.kind = k; draw(); } }, icon(k), T(HH_KIND_NAMES[k]))))),
      el('label', { class: 'field' }, el('span', {}, T('Name')), el('input', { value: v.name, maxlength: 30, oninput: (e) => { v.name = e.target.value; } })),
      el('div', { class: 'hh-set' }, el('span', { class: 'lbl' }, T('How CasaTorch knows it\'s running')), el('div', { class: 'seg' }, [['power', T('Power')], ['state', T('Status')], ['remaining', T('Time left')]].map(([k, l]) => el('button', { type: 'button', class: v.mode === k ? 'on' : null, 'aria-pressed': String(v.mode === k), onclick: () => { v.mode = k; draw(); } }, l)))),
      el('label', { class: 'field' }, el('span', {}, v.mode === 'power' ? T('Power sensor (a smart plug works)') : v.mode === 'state' ? T('Status sensor') : T('Time-left sensor')), hhEntSelect(d, v.entity, keep, [], (x) => { v.entity = x; })),
      v.mode === 'power' ? el('div', { class: 'hh-inline' }, el('label', { class: 'field', style: 'margin:0' }, el('span', {}, T('Running above (W)')), el('input', { type: 'number', min: 1, max: 500, value: v.onW, oninput: (e) => { v.onW = Number(e.target.value); } })),
        el('label', { class: 'field', style: 'margin:0' }, el('span', {}, T('Done after quiet for (min)')), el('input', { type: 'number', min: 1, max: 30, value: v.offMin, oninput: (e) => { v.offMin = Number(e.target.value); } }))) : null,
      v.mode !== 'remaining' ? el('label', { class: 'field' }, el('span', {}, T('Time-left sensor (optional, for "23 min left")')), hhEntSelect(d, v.remaining, (e) => /^sensor\./.test(e.id) && (/^(min|h|s)$/.test(e.unit || '') || ['duration', 'timestamp'].includes(e.cls)), [], (x) => { v.remaining = x; })) : null,
      msg].filter(Boolean));
  };
  draw();
  const ok = el('button', { class: 'btn primary', onclick: async () => {
    msg.textContent = ''; ok.disabled = true;
    const app = { ...(a?.id ? { id: a.id } : {}), ...v, remaining: v.remaining || null };
    try { const r = await post('/api/household/setup', { apps: isNew ? [...d.apps, app] : d.apps.map((x) => (x.id === a.id ? app : x)) }, 'PUT'); Object.assign(d, r); WCACHE.delete('/api/household'); m.remove(); toast(isNew ? T('Added') : T('Saved')); redraw(); }
    catch (e) { msg.textContent = e.message; ok.disabled = false; }
  } }, isNew ? T('Add') : T('Save'));
  const del = isNew ? null : el('button', { class: 'btn ghost danger', onclick: async () => { if (await save({ apps: d.apps.filter((x) => x.id !== a.id) }, T('Removed'))) { m.remove(); redraw(); } } }, icon('x'), T('Remove'));
  const m = modal(el('div', {}, body, el('div', { class: 'row between wrap', style: 'gap:8px;margin-top:14px' }, el('span', {}, del), ok)), { title: isNew ? T('Add an appliance') : T('Change appliance') });
}

/* The demo's Home shows the Household widget (in place of "Today"): S.status is watched so the swap is made the
   moment the app knows it's the demo, before the Home screen is first drawn. */
(() => {
  let st = S.status;
  Object.defineProperty(S, 'status', { configurable: true, enumerable: true, get: () => st, set: (x) => {
    st = x;
    if (x?.demo && !DEFAULT_LAYOUT.some((t) => t.id === 'household')) { const i = DEFAULT_LAYOUT.findIndex((t) => t.id === 'today'); if (i >= 0) DEFAULT_LAYOUT.splice(i, 1, { id: 'household', w: DEFAULT_LAYOUT[i].w, h: DEFAULT_LAYOUT[i].h }); }
  } });
})();
