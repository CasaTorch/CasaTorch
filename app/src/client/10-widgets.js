/* ---- Home widgets. render(body, ctx, { w, h, narrow }) draws for that size. ---- */
function wxIcon(sym) {
  const s = String(sym || '');
  if (/thunder/.test(s)) return '⛈️'; if (/snow|sleet/.test(s)) return '❄️'; if (/rain|shower/.test(s)) return '\u{1F327}️';
  if (/fog/.test(s)) return '\u{1F32B}️'; if (/partlycloudy|fair/.test(s)) return /night/.test(s) ? '☁️' : '⛅'; if (/cloudy/.test(s)) return '☁️';
  if (/clearsky/.test(s)) return /night/.test(s) ? '\u{1F319}' : '☀️'; return '·';
}
const dayName = (ymd) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${ymd}T12:00:00Z`));
const fits = (h, per, head = 46) => Math.max(1, Math.floor((h * ROW_PX + (h - 1) * GAP_PX - head) / per));
const empty = (text, link, label) => el('div', { class: 'allclear' }, el('div', {}, el('div', { class: 'small' }, text), link ? el('a', { class: 'btn small', href: link, style: 'margin-top:10px' }, label) : null));

widget({ id: 'clock', title: 'Clock', icon: 'clock', bare: true, min: [2, 1], size: [4, 2], render(b, ctx, { w, h }) {
  const now = new Date().toISOString(), hr = Number(fmt(now, { hour: 'numeric', hour12: false }));
  const greet = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const wx = ctx.data.home?.weather?.now;
  b.replaceChildren(el('div', { style: 'margin:auto 0' },
    h >= 2 && w >= 3 ? el('div', { class: 'muted small', style: 'margin-bottom:6px' }, `${greet}${ctx.data.home?.house ? ` · ${ctx.data.home.house}` : ''}`) : null,
    el('div', { class: 'clock-big', style: h === 1 ? 'font-size:36px' : null }, fmt(now, { hour: 'numeric', minute: '2-digit' })),
    h >= 2 ? el('div', { class: 'row', style: 'margin-top:8px;gap:12px' }, el('span', { class: 'muted' }, fmt(now, { weekday: 'long', month: 'long', day: 'numeric' })), wx && w >= 4 ? el('span', { class: 'muted' }, `${wxIcon(wx.symbol)} ${wx.temp}°`) : null) : null));
} });

widget({ id: 'weather', title: 'Weather', icon: 'sun', min: [2, 2], size: [5, 4], render(b, ctx, { w, h }) {
  const wx = ctx.data.home?.weather;
  if (!wx || wx.error || !wx.now) return b.replaceChildren(empty(wx?.error ? 'Weather is not loading right now.' : 'Add your town in setup to see the weather.'));
  const today = wx.days?.[0];
  const parts = [el('div', { class: 'wx-now' }, el('span', { class: 'wx-ic', style: w <= 2 ? 'font-size:30px' : null }, wxIcon(wx.now.symbol)),
    el('div', {}, el('div', { class: 'big', style: w <= 2 ? 'font-size:34px' : null }, `${wx.now.temp}°`), w >= 3 ? el('div', { class: 'muted small' }, `${wx.now.words}${today ? ` · H ${today.hi}° L ${today.lo}°` : ''}`) : null),
    w >= 5 ? el('div', { class: 'small muted', style: 'margin-left:auto;text-align:right' }, wx.place || '', el('br'), `Wind ${wx.now.wind ?? '-'} ${wx.units === 'C' ? 'km/h' : 'mph'} · ${wx.now.humidity ?? '-'}%`) : null)];
  if (h >= 3 && w >= 3) parts.push(el('div', { class: 'hours' }, (wx.hours || []).slice(0, Math.max(3, Math.floor(w * 1.1))).map((x) => el('div', {}, fmt(x.at, { hour: 'numeric' }), el('i', {}, wxIcon(x.symbol)), el('b', {}, `${x.temp}°`)))));
  if (h >= 5 || (h >= 4 && w >= 4)) {
    const days = (wx.days || []).slice(0, Math.min(7, fits(h - 3, 32, 0) + 1));
    const lo = Math.min(...days.map((d) => d.lo)), hi = Math.max(...days.map((d) => d.hi));
    parts.push(el('ul', { class: 'list days' }, days.map((d) => el('li', {}, el('b', {}, dayName(d.date)), el('span', {}, wxIcon(d.symbol)),
      w >= 5 ? el('div', { style: 'padding:0 12px;align-self:center' }, el('div', { class: 'temp-bar', style: `margin-left:${((d.lo - lo) / Math.max(1, hi - lo)) * 100}%;width:${((d.hi - d.lo) / Math.max(1, hi - lo)) * 100}%` })) : el('span', { class: 'muted small ellipsis' }, d.words || ''),
      el('span', { class: 'num' }, `${d.hi}° `, el('span', { class: 'muted' }, `${d.lo}°`))))));
  }
  if (h >= 4) parts.push(el('div', { class: 'tiny faint', style: 'margin-top:auto' }, wx.credit || ''));
  b.replaceChildren(...parts);
} });

widget({ id: 'calendar', title: 'Coming up', icon: 'calendar', min: [3, 2], size: [4, 4],
  headerExtra: () => el('button', { class: 'btn ghost small', title: 'Add an event', 'aria-label': 'Add an event', onclick: () => eventEditor(null, () => show(current)) }, icon('plus')),
  render(b, ctx, { w, h }) {
    const cal = ctx.data.home?.calendar;
    const ev = (cal?.events || []).filter((e) => Date.parse(e.end || e.start) > Date.now()).slice(0, fits(h, 52));
    if (!ev.length) return b.replaceChildren(empty('Nothing coming up.', '#calendar', 'Open the calendar'));
    b.replaceChildren(...ev.map((e) => el('div', { class: 'ev' }, el('span', { class: 'bar', style: `background:${safeColor(e.color)}` }),
      el('div', { class: 'grow' }, el('div', { class: 'ellipsis' }, e.title), el('div', { class: 'when' }, e.allDay ? `${fmt(e.start, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · all day` : fmtWhen(e.start), w >= 4 && e.calendar ? ` · ${e.calendar}` : '')))));
  } });

function gameRow(g, w) {
  const side = (t, o) => el('div', { class: 'team' }, t.logo && w >= 3 ? el('img', { src: t.logo, alt: '', loading: 'lazy' }) : null, el('span', { class: `ellipsis${g.state === 'post' && !t.winner && o.winner ? ' lost' : ''}` }, w >= 4 ? t.name || t.abbr : t.abbr || t.name));
  const sc = (t, o) => el('div', { class: `score${g.state === 'post' && !t.winner && o.winner ? ' lost' : ''}` }, g.state === 'pre' ? '' : t.score ?? '');
  return el('div', { class: 'game' }, side(g.away, g.home), sc(g.away, g.home), side(g.home, g.away), sc(g.home, g.away),
    el('div', { class: 'tiny muted', style: 'grid-column:1/-1;margin-top:2px' }, el('span', { class: `pill${g.state === 'in' ? ' live' : ''}` }, g.state === 'in' ? 'LIVE' : g.state === 'post' ? 'Final' : fmtWhen(g.start)), ` ${g.leagueName || ''}${g.state === 'in' ? ` · ${g.detail}` : ''}${g.broadcast && w >= 4 ? ` · ${g.broadcast}` : ''}`));
}
widget({ id: 'sports', title: 'Your teams', icon: 'trophy', min: [2, 2], size: [3, 4], render(b, ctx, { w, h }) {
  const sp = ctx.data.home?.sports;
  if (!sp) return b.replaceChildren(empty('Pick your teams in setup.'));
  const games = (sp.games || []).slice(0, fits(h, 84));
  b.replaceChildren(...(games.length ? games.map((g) => gameRow(g, w)) : [empty('No games this week.')]));
} });

widget({ id: 'news', title: 'Headlines', icon: 'news', min: [3, 2], size: [4, 4], render(b, ctx, { w, h }) {
  const n = ctx.data.home?.news;
  if (!n) return b.replaceChildren(empty('Pick news sources in setup.'));
  const items = (n.items || []).slice(0, fits(h, w >= 5 ? 50 : 62));
  b.replaceChildren(...(items.length ? [el('ul', { class: 'list' }, items.map((i) => el('li', { style: 'display:block' }, el('a', { href: safeHref(i.link), target: '_blank', rel: 'noopener noreferrer', style: 'color:inherit;text-decoration:none;display:block' }, el('div', { class: w >= 5 ? 'ellipsis' : null }, i.title), el('div', { class: 'tiny muted' }, `${i.source}${i.at ? ` · ${ago(i.at)}` : ''}`)))))] : [empty('Headlines are not loading right now.')]));
} });

widget({ id: 'internet', title: 'Internet', icon: 'wifi', min: [2, 2], size: [3, 2], render(b, ctx, { w, h }) {
  const n = ctx.data.home?.internet;
  if (!n || n.error) return b.replaceChildren(el('div', { class: 'muted' }, 'Checking...'));
  const parts = [el('div', { class: 'row' }, el('span', { class: `dot ${n.online ? 'good' : 'bad'}` }), el('b', {}, n.online ? 'Online' : 'Down'), w >= 3 ? el('span', { class: 'muted small ellipsis' }, n.provider || '') : null)];
  if (n.speed) parts.push(el('div', { class: 'row', style: 'gap:22px;margin-top:10px' }, el('div', { class: 'stat' }, el('span', { class: 'big', style: 'font-size:30px' }, Math.round(n.speed.downMbps)), el('span', { class: 'lbl' }, 'Mbps down')), w >= 3 ? el('div', { class: 'stat' }, el('span', { class: 'big', style: 'font-size:30px' }, Math.round(n.speed.upMbps)), el('span', { class: 'lbl' }, 'Mbps up')) : null));
  if (h >= 3) parts.push(el('dl', { class: 'kv small', style: 'margin-top:14px' }, el('dt', {}, 'Ping'), el('dd', {}, `${n.latencyMs?.cloudflare ?? '-'} ms`), el('dt', {}, 'Devices'), el('dd', {}, n.lanDevices ?? '-'), el('dt', {}, 'Public IP'), el('dd', {}, n.publicIp || '-')));
  b.replaceChildren(...parts);
} });

widget({ id: 'today', title: 'Today', icon: 'list', min: [2, 2], size: [3, 2], render(b, ctx, { h }) {
  const d = ctx.data.home || {};
  const items = [d.note ? el('div', { style: 'margin-bottom:8px' }, d.note) : null, ...(d.reminders || []).slice(0, fits(h, 34)).map((r) => el('div', { class: 'row', style: 'padding:4px 0' }, el('span', { class: 'dot warn' }), el('span', { class: 'grow ellipsis' }, r.title), r.at ? el('span', { class: 'tiny muted' }, hm(r.at)) : null))].filter(Boolean);
  b.replaceChildren(...(items.length ? items : [empty('No reminders today.')]));
} });

widget({ id: 'alerts', title: 'Alerts', icon: 'bell', min: [2, 2], size: [3, 2], render(b, ctx, { h }) {
  const now = ctx.data.alerts?.now || [];
  if (!now.length) return b.replaceChildren(el('div', { class: 'allclear' }, el('div', {}, icon('checkc'), el('div', { style: 'margin-top:6px' }, 'All clear'))));
  b.replaceChildren(...now.slice(0, fits(h, 66)).map((a) => el('a', { href: '#alerts', class: `alert ${a.severity}` }, el('div', { class: 'grow' }, el('div', { class: 'ellipsis' }, a.title), el('div', { class: 'tiny muted' }, a.since ? `since ${fmtWhen(a.since)}` : a.source || '')))));
} });

widget({ id: 'energy', title: 'Energy', icon: 'bolt', min: [2, 2], size: [3, 3], render(b, ctx, { w, h }) {
  const ds = (ctx.data.devices?.devices || []).filter((d) => typeof d.powerW === 'number' && !d.pairedTo).sort((a, c) => c.powerW - a.powerW);
  const total = ctx.data.devices?.power?.watts ?? ds.reduce((s, d) => s + d.powerW, 0), rate = ctx.data.settings?.energy?.ratePerKwh;
  if (!ds.length) return b.replaceChildren(empty('No power-metering plugs yet.'));
  const parts = [el('div', { class: 'row', style: 'gap:22px;align-items:flex-end' }, el('div', { class: 'stat' }, el('span', { class: 'big' }, Math.round(total), el('span', { style: 'font-size:18px;color:var(--muted)' }, ' W')), el('span', { class: 'lbl' }, 'using now')),
    rate && (w >= 4 || h >= 3) ? el('div', { class: 'stat' }, el('span', { style: 'font-size:22px;font-weight:700' }, `$${(total / 1000 * 24 * rate).toFixed(2)}`), el('span', { class: 'lbl' }, 'a day at this rate')) : null)];
  if (h >= 3) { const max = ds[0].powerW || 1; parts.push(el('div', { class: 'bars', style: 'margin-top:14px' }, ds.slice(0, fits(h - 1, 26, 30)).map((d) => el('div', { class: 'bar-row', style: w < 4 ? 'grid-template-columns:1fr 50px' : null }, el('span', { class: 'ellipsis small' }, d.name), w >= 4 ? el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(d.powerW / max) * 100}%` })) : null, el('span', { class: 'small num', style: 'text-align:right' }, `${Math.round(d.powerW)} W`))))); }
  b.replaceChildren(...parts);
} });

async function toggleDevice(d) { await post(`/api/devices/${encodeURIComponent(d.id)}/toggle`); if (d.kind === 'media') d.playing = !d.playing; else d.on = !d.on; }
const TOGGLES = new Set(['light', 'switch', 'plug', 'media', 'fan']);
const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
function devMeta(d, compact) {
  if (d.kind === 'presence') return d.home ? 'Home' : pretty(d.state === 'not_home' ? 'Away' : d.state);
  if (d.kind === 'value') return `${d.value ?? '-'}${d.unit ? ` ${d.unit}` : ''}`;
  if (d.kind === 'alarm') return pretty(d.state);
  if (d.kind === 'vacuum' || d.kind === 'action') return d.kind === 'action' ? (d.domain === 'scene' ? 'Scene' : d.domain === 'script' ? 'Script' : 'Button') : pretty(d.state);
  if (d.kind === 'cover') return `${d.open ? 'Open' : pretty(d.state)}${d.position != null && d.open ? ` · ${d.position}%` : ''}`;
  return [d.on != null && !['sensor', 'climate'].includes(d.kind) ? (d.kind === 'media' ? (d.playing ? (d.title || 'Playing') : d.on ? 'Paused' : 'Off') : d.on ? 'On' : 'Off') : null, d.brightness && d.on ? `${d.brightness}%` : null, d.percent && d.on ? `${d.percent}%` : null,
    d.powerW != null ? `${Math.round(d.powerW)} W` : null, d.tempC != null ? tempOf(d.tempC) : null, d.targetC != null ? `set ${tempOf(d.targetC)}` : null, d.humidity != null ? `${d.humidity}%` : null,
    d.open != null ? (d.open ? 'Open' : 'Closed') : null, d.water != null ? (d.water ? 'WATER!' : 'Dry') : null, d.motion != null ? (d.motion ? 'Motion' : 'Clear') : null, d.smoke != null ? (d.smoke ? 'SMOKE!' : 'Clear') : null,
    d.locked != null ? (d.locked ? 'Locked' : 'Unlocked') : null, d.battery != null && !compact ? `battery ${d.battery}%` : null, d.online === false ? 'offline' : null].filter(Boolean).join(' · ');
}
/* Devices with more than on/off (dimming, colour, speed, volume, thermostats, blinds, locks, alarms...)
   open a sheet with every control (public/device-controls.js, shared with the 3D Home). */
const C = () => window.CasaControls;
const hasSheet = (d) => !!C() && d.online !== false && (['climate', 'cover', 'lock', 'alarm', 'vacuum'].includes(d.kind)
  || (d.kind === 'light' && ['brightness', 'color', 'kelvin'].some((x) => C().can(d, x))) || (d.kind === 'fan' && C().can(d, 'percent')) || (d.kind === 'media' && ['volume', 'next'].some((x) => C().can(d, x))));
function deviceSheet(d, onChange) {
  const body = el('div', { class: 'dsheet' });
  let timer = null;
  const draw = () => body.replaceChildren(...C().build(d, { units: S.units, act: send }));
  async function sync() {
    try { const n = (await api('/api/devices')).devices?.find((x) => x.id === d.id); if (n) Object.assign(d, n); } catch { /* keep what we have */ }
    if (body.isConnected) draw(); onChange?.();
  }
  async function send(action, value) {
    draw();
    try { await post(`/api/devices/${encodeURIComponent(d.id)}/${action}`, value != null ? { value } : {}); } catch (err) { toast(err.message, 4000); }
    clearTimeout(timer); timer = setTimeout(sync, 900);
  }
  draw();
  modal(el('div', {}, el('div', { class: 'small muted', style: 'margin:-6px 0 10px' }, [d.area, d.provider === 'ha' ? 'Home Assistant' : pretty(d.provider)].filter(Boolean).join(' · ')), body), { title: d.name });
}
function devButton(d, compact) {
  const cls = ['dev', d.online === false && 'offline', (d.water || d.smoke || d.triggered) && 'alarm', d.playing && 'playing', !d.playing && (d.on || (d.kind === 'presence' && d.home) || (d.kind === 'cover' && d.open)) && !['sensor'].includes(d.kind) && 'on'].filter(Boolean).join(' ');
  const sheet = hasSheet(d), toggles = TOGGLES.has(d.kind) && d.online !== false;
  const act = async (action, label) => { try { await post(`/api/devices/${encodeURIComponent(d.id)}/${action}`); toast(`${d.name}: ${label}`); } catch (err) { toast(err.message, 4000); } };
  const mini = (label, action) => el('button', { class: 'btn small', style: 'padding:3px 9px', onclick: (e) => { e.stopPropagation(); act(action, label); } }, label);
  const extra = sheet ? null : d.kind === 'cover' ? (d.risky ? [mini('Close', 'close')] : [mini('Open', 'open'), mini('Close', 'close')]) : d.kind === 'vacuum' ? [mini('Start', 'start'), mini('Dock', 'dock')] : d.kind === 'action' ? [mini('Run', 'run')] : null;
  const b = el(extra ? 'div' : 'button', { class: cls, role: extra ? 'group' : null, title: d.name }, el('span', { class: 'ic' }, icon(devIconName(d))), el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'ellipsis' }, d.name), el('div', { class: 'meta ellipsis' }, devMeta(d, compact))), extra ? el('div', { class: 'row', style: 'gap:4px;flex:none' }, extra) : null);
  const root = sheet ? el('div', { class: 'dev-wrap' }, b) : b;
  const redraw = () => { if (root.isConnected) root.replaceWith(devButton(d, compact)); };
  if (toggles) b.onclick = async () => { try { await toggleDevice(d); redraw(); } catch (err) { toast(err.message); } };
  else if (sheet) b.onclick = () => deviceSheet(d, redraw);
  if (sheet && toggles) root.append(el('button', { class: 'dev-more', title: T('More controls'), 'aria-label': `${T('More controls')}: ${d.name}`, onclick: () => deviceSheet(d, redraw) }, icon('sliders', 16)));
  return root;
}
/* Pinned devices: any devices you pick - including anything from Home Assistant. You can add several of these tiles. */
function pickDevices(selected, done) {
  const sel = new Set(selected || []);
  api('/api/devices').then(({ devices = [] }) => {
    const q = el('input', { type: 'search', placeholder: 'Search devices and Home Assistant entities…' });
    const list = el('div', { style: 'max-height:55vh;overflow:auto;margin-top:10px' });
    const draw = () => { const t = q.value.toLowerCase(); list.replaceChildren(...devices.filter((d) => !t || `${d.name} ${d.id}`.toLowerCase().includes(t)).slice(0, 300).map((d) => el('label', { class: 'tab-row', style: 'cursor:pointer' }, icon(devIconName(d)), el('div', { style: 'min-width:0' }, el('div', { class: 'ellipsis' }, d.name), el('div', { class: 'tiny faint ellipsis' }, `${d.id} · ${devMeta(d, true)}`)), el('input', { type: 'checkbox', checked: sel.has(d.id), style: 'width:auto', onchange: (e) => { if (e.target.checked) sel.add(d.id); else sel.delete(d.id); } })))); };
    q.oninput = draw; draw();
    const m = modal(el('div', {}, q, list, el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, el('span', { class: 'small muted grow' }, `${devices.length} devices available`), el('button', { class: 'btn ghost', onclick: () => m.remove() }, 'Cancel'), el('button', { class: 'btn primary', onclick: () => { m.remove(); done([...sel]); } }, 'Done'))), { title: 'Choose devices', wide: true });
    setTimeout(() => q.focus(), 50);
  });
}
widget({ id: 'entities', title: 'Pinned devices', icon: 'sliders', multi: true, min: [2, 2], size: [4, 3],
  headerExtra: (ctx, t, saved) => el('button', { class: 'btn ghost small', title: 'Choose devices', 'aria-label': 'Choose devices', onclick: () => pickDevices(t.ids, (ids) => { t.ids = ids; saved(); }) }, icon('gear')),
  render(b, ctx, { w, h }) {
    const all = ctx.data.devices?.devices || [];
    const ds = (b._t?.ids || []).map((id) => all.find((d) => d.id === id)).filter(Boolean);
    if (!ds.length) return b.replaceChildren(empty('Pick any devices or Home Assistant entities to keep here.', null, null), el('div', { style: 'text-align:center' }, el('button', { class: 'btn small primary', onclick: () => pickDevices([], (picked) => { b._t.ids = picked; b._saved(); }) }, 'Choose devices')));
    const perRow = Math.max(1, Math.floor(w / 2));
    b.replaceChildren(el('div', { class: 'switches', style: `grid-template-columns:repeat(${perRow},minmax(0,1fr));overflow:auto` }, ds.map((d) => devButton(d, true))));
  } });
/* One device or entity as a tile of its own. The Add widget screen offers every device and every
   Home Assistant entity automatically - anything new in Home Assistant shows up there on its own. */
function devHeadline(d) {
  if (d.kind === 'camera') return null;
  if (d.tempC != null && d.kind !== 'climate') return tempOf(d.tempC);
  if (d.kind === 'climate') return d.tempC != null ? tempOf(d.tempC) : pretty(d.mode || d.state);
  if (d.powerW != null && d.kind === 'sensor') return `${Math.round(d.powerW)} W`;
  if (d.humidity != null && d.kind === 'sensor') return `${d.humidity}%`;
  if (d.battery != null && d.kind === 'sensor' && d.water == null && d.motion == null && d.open == null) return `${d.battery}%`;
  if (d.kind === 'value') return `${d.value ?? '-'}${d.unit ? ` ${d.unit}` : ''}`;
  if (d.kind === 'lock') return d.locked ? 'Locked' : 'Unlocked';
  if (d.kind === 'presence') return d.home ? 'Home' : 'Away';
  if (d.water != null) return d.water ? 'Water!' : 'Dry';
  if (d.smoke != null) return d.smoke ? 'Smoke!' : 'Clear';
  if (d.motion != null) return d.motion ? 'Motion' : 'Clear';
  if (d.open != null) return d.open ? 'Open' : 'Closed';
  if (d.kind === 'media') return d.playing ? 'Playing' : d.on ? 'Paused' : 'Off';
  if (d.kind === 'action') return d.domain === 'scene' ? 'Scene' : d.domain === 'script' ? 'Script' : 'Button';
  if (d.on != null) return d.on ? (d.brightness ? `On · ${d.brightness}%` : 'On') : 'Off';
  return pretty(d.state || '-');
}
function deviceCard(d, { w, h }) {
  if (d.kind === 'camera') return camView(d);
  const act = async (action, label, value) => { try { await post(`/api/devices/${encodeURIComponent(d.id)}/${action}`, value != null ? { value } : {}); toast(`${d.name}: ${label}`); } catch (err) { toast(err.message, 4000); } };
  const sub = devMeta(d, false), head = devHeadline(d);
  const lit = d.on || d.playing || (d.kind === 'presence' && d.home) || (d.kind === 'cover' && d.open);
  const controls = [];
  if (TOGGLES.has(d.kind) && d.online !== false) controls.push(el('button', { class: `btn small${lit ? ' primary' : ''}`, onclick: async (e) => { try { await toggleDevice(d); e.target.closest('.devcard').replaceWith(deviceCard(d, { w, h })); } catch (err) { toast(err.message); } } }, d.kind === 'media' ? (d.playing ? 'Pause' : 'Play') : d.on ? 'Turn off' : 'Turn on'));
  if (d.kind === 'cover') { if (!d.risky) controls.push(el('button', { class: 'btn small', onclick: () => act('open', 'opening') }, 'Open')); controls.push(el('button', { class: 'btn small', onclick: () => act('close', 'closing') }, 'Close')); }
  if (d.kind === 'action') controls.push(el('button', { class: 'btn small primary', onclick: () => act('run', 'done') }, 'Run'));
  if (d.kind === 'vacuum') controls.push(el('button', { class: 'btn small', onclick: () => act('start', 'starting') }, 'Start'), el('button', { class: 'btn small', onclick: () => act('dock', 'going home') }, 'Dock'));
  if (hasSheet(d)) controls.push(el('button', { class: 'btn small', title: 'Every control for this device', onclick: () => deviceSheet(d) }, icon('sliders', 14), T('More')));
  const dim = d.kind === 'light' && d.on && h >= 3 ? el('input', { type: 'range', min: 1, max: 100, value: d.brightness || 100, 'aria-label': `${d.name} brightness`, style: 'margin-top:10px', onchange: (e) => { d.brightness = Number(e.target.value); act('brightness', `${d.brightness}%`, d.brightness); } }) : null;
  return el('div', { class: `devcard${lit ? ' on' : ''}${d.water || d.smoke || d.triggered ? ' alarm' : ''}${d.online === false ? ' offline' : ''}` },
    el('div', { class: 'row', style: 'gap:12px;align-items:center' }, el('span', { class: 'ic' }, icon(devIconName(d), 22)),
      el('div', { style: 'min-width:0' }, el('div', { class: 'devcard-big ellipsis', style: w <= 2 ? 'font-size:22px' : null }, head || ''), h >= 2 && sub && sub !== head ? el('div', { class: 'small muted ellipsis' }, sub) : null)),
    dim, controls.length && h >= 2 ? el('div', { class: 'row', style: 'gap:6px;margin-top:auto;padding-top:10px;flex-wrap:wrap' }, controls) : null,
    h >= 3 ? el('div', { class: 'tiny faint', style: 'margin-top:8px' }, [d.area, d.provider === 'ha' ? 'Home Assistant' : pretty(d.provider)].filter(Boolean).join(' · ')) : null);
}
widget({ id: 'device', title: 'Device', icon: 'plug', multi: true, hidden: true, min: [2, 1], size: [3, 2], render(b, ctx, size) {
  const d = (ctx.data.devices?.devices || []).find((x) => x.id === b._t?.device);
  if (!d) return b.replaceChildren(empty('This device is not reporting right now. If it was removed from Home Assistant, remove this tile.'));
  b.replaceChildren(deviceCard(d, size));
} });
/* A whole room (a Home Assistant area): every device in it, its temperature and what is on. */
widget({ id: 'room', title: 'Room', icon: 'home', multi: true, hidden: true, min: [2, 2], size: [4, 3], render(b, ctx, { w, h }) {
  const area = b._t?.area, ds = (ctx.data.devices?.devices || []).filter((d) => d.area === area);
  if (!ds.length) return b.replaceChildren(empty(`Nothing is in "${area || 'this room'}" right now.`));
  const temp = ds.find((d) => d.tempC != null && d.kind !== 'climate')?.tempC ?? ds.find((d) => d.tempC != null)?.tempC;
  const on = ds.filter((d) => d.kind === 'light' && d.on).length, lights = ds.filter((d) => d.kind === 'light').length, watts = ds.reduce((s, d) => s + (typeof d.powerW === 'number' && !d.pairedTo ? d.powerW : 0), 0);
  const facts = [temp != null ? el('b', {}, tempOf(temp)) : null, lights ? el('span', {}, `${on}/${lights} lights on`) : null, watts ? el('span', {}, `${Math.round(watts)} W`) : null, el('span', {}, `${ds.length} device${ds.length === 1 ? '' : 's'}`)].filter(Boolean);
  const perRow = Math.max(1, Math.floor(w / 2));
  b.replaceChildren(el('div', { class: 'row small muted', style: 'gap:14px;margin-bottom:10px;flex-wrap:wrap' }, facts),
    el('div', { class: 'switches', style: `grid-template-columns:repeat(${perRow},minmax(0,1fr));overflow:auto` }, ds.filter((d) => d.kind !== 'camera').slice(0, perRow * Math.max(1, fits(h, 66, 80))).map((d) => devButton(d, true))));
} });
widget({ id: 'lights', title: 'Quick switches', icon: 'bulb', min: [2, 2], size: [4, 3], render(b, ctx, { w, h }) {
  const ds = (ctx.data.devices?.devices || []).filter((d) => ['light', 'switch', 'plug', 'media'].includes(d.kind));
  if (!ds.length) return b.replaceChildren(empty('No lights or plugs yet.'));
  const perRow = Math.max(1, Math.floor(w / 2)), rows = fits(h, 66);
  b.replaceChildren(el('div', { class: 'switches', style: `grid-template-columns:repeat(${perRow},minmax(0,1fr))` }, ds.slice(0, perRow * rows).map((d) => devButton(d, true))));
} });

const snapUrl = (d) => (d.snapshot ? d.snapshot : d.provider === 'ha' ? `/api/ha/camera/${encodeURIComponent(d.id.slice(3))}` : `/api/${d.provider === 'ring' ? 'ring' : 'cameras'}/${encodeURIComponent(d.id.split(':').slice(1).join(':'))}/snapshot`);
/* Camera tiles: one lasting element per camera, so a dashboard refresh never blanks the picture. Each one
   asks for a newer picture on its own beat (the CasaTorch keeps them ready, so the answer is instant),
   sends If-None-Match so an unchanged picture costs nothing, decodes the new one off-screen and only then
   swaps it in. Cameras that are scrolled away, or in a tab nobody is looking at, pause. */
const CAMS = new Map();
const camEvery = (d) => Math.max(1000, d.every || (d.provider === 'ring' ? 4000 : d.provider === 'ha' ? 3000 : 2000));   // the integration's own pace
const camSeen = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { for (const e of es) { const c = e.target.__cam; if (c) c.visible = e.isIntersecting; } }) : null;
async function camFetch(c, force = false) {
  if (c.busy || (!force && (!c.visible || document.hidden))) return;
  c.busy = true; c.last = Date.now();
  try {
    const r = await fetch(snapUrl(c.d), { cache: 'no-store', headers: c.etag ? { 'If-None-Match': c.etag } : {} });
    const age = Number(r.headers.get('X-Snapshot-Age') || 0);
    c.age.textContent = age > 15 ? (age > 120 ? `${Math.round(age / 60)} min ago` : `${age} s ago`) : '';
    if (r.status === 304) { c.wrap.classList.remove('cam-err'); return; }
    if (!r.ok) throw new Error('no picture');
    const url = URL.createObjectURL(await r.blob()), tmp = new Image(); tmp.src = url;
    await (tmp.decode ? tmp.decode() : new Promise((ok, no) => { tmp.onload = ok; tmp.onerror = no; }));
    const old = c.url; c.img.src = url; c.url = url; c.etag = r.headers.get('ETag'); c.wrap.classList.remove('cam-err', 'cam-wait');
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
  } catch { c.wrap.classList.add('cam-err'); c.wrap.classList.remove('cam-wait'); }
  finally { c.busy = false; }
}
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of CAMS) {
    if (c.wrap.isConnected) { c.gone = 0; if (now - c.last >= camEvery(c.d)) camFetch(c); continue; }
    // a camera no page shows any more (another tab, or it was removed): after a minute, let its picture go
    if (!c.gone) c.gone = now; else if (now - c.gone > 60_000 && !c.busy) { camSeen?.unobserve(c.wrap); if (c.url) URL.revokeObjectURL(c.url); CAMS.delete(id); }
  }
}, 400);
document.addEventListener('visibilitychange', () => { if (!document.hidden) for (const c of CAMS.values()) if (c.wrap.isConnected) camFetch(c); });
function camView(d) {
  let c = CAMS.get(d.id);
  if (!c) {
    const img = el('img', { alt: d.name, decoding: 'async' }), age = el('span', { class: 'cam-age' }), name = el('span', {}, d.name);
    const wrap = el('div', { class: 'cam cam-wait', onclick: () => camModal(c.d) }, img, el('div', { class: 'cap' }, name, el('span', { class: 'tiny muted' }, `${d.source || d.provider}${d.stream ? ' · live on tap' : ''}`)), age);
    c = { d, img, age, name, wrap, visible: true, last: 0, etag: null, url: null, busy: false }; wrap.__cam = c; CAMS.set(d.id, c);
    camSeen?.observe(wrap); camFetch(c, true);
  }
  c.d = d; c.name.textContent = d.name; c.img.alt = d.name;
  return c.wrap;
}
/* Full screen: live video where the camera has it (Frigate), otherwise a new picture every second. */
function camModal(d) {
  const img = el('img', { alt: d.name, class: 'cam-full' }), note = el('div', { class: 'tiny muted', style: 'margin-top:8px' }, d.stream ? 'Live video' : 'A new picture every second');
  const m = modal(el('div', {}, img, note), { wide: true, title: d.name });
  let started = false;
  const stills = () => { if (started) return; started = true; let etag = null; const tick = async () => { if (!m.isConnected) return; try { const r = await fetch(snapUrl(d), { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} }); if (r.ok && m.isConnected) { const u = URL.createObjectURL(await r.blob()), t = new Image(); t.src = u; await t.decode().catch(() => {}); const o = img.src; img.src = u; etag = r.headers.get('ETag'); if (o.startsWith('blob:')) URL.revokeObjectURL(o); } } catch { /* next tick */ } setTimeout(tick, 1000); }; tick(); };
  if (d.stream) { img.src = `${d.stream}${d.stream.includes('?') ? '&' : '?'}t=${Date.now()}`; img.onerror = () => { if (!m.isConnected) return; note.textContent = 'Live video unavailable - showing pictures'; stills(); }; }
  else stills();
  // closing the window stops a live stream at once
  new MutationObserver((_, o) => { if (!m.isConnected) { img.onerror = null; const u = img.src; img.removeAttribute('src'); if (u.startsWith('blob:')) URL.revokeObjectURL(u); o.disconnect(); } }).observe(document.body, { childList: true });
}
widget({ id: 'camera', title: 'Cameras', icon: 'camera', min: [3, 2], size: [4, 3], render(b, ctx, { w, h }) {
  const cams = (ctx.data.devices?.devices || []).filter((d) => d.kind === 'camera');
  if (!cams.length) return b.replaceChildren(empty('No cameras yet.'));
  const across = w >= 8 ? 2 : 1, down = h >= 6 ? 2 : 1;
  b.replaceChildren(el('div', { class: 'tile-cams', style: `grid-template-columns:repeat(${across},1fr);grid-template-rows:repeat(${down},1fr)` }, cams.slice(0, across * down).map(camView)));
} });

widget({ id: 'photos', title: 'Photo reel', icon: 'camera', bare: true, live: true, min: [2, 2], size: [5, 4], async render(b) {
  const { photos = [] } = await api('/api/photos').catch(() => ({}));
  clearInterval(b._reel);
  if (!photos.length) { b.parentElement.style.padding = ''; return b.replaceChildren(el('div', { class: 'allclear' }, el('div', {}, icon('camera'), el('div', { style: 'margin:8px 0' }, 'Your photos, on a slow loop'), el('a', { class: 'btn small primary', href: '#photos' }, 'Add photos')))); }
  const order = [...photos].sort(() => Math.random() - 0.5);
  const mk = () => el('img', { alt: '', style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity 1.4s' });
  let front = mk(), back = mk(), i = 0; front.src = order[0].url; back.style.opacity = 0;
  /* Sample photos carry their photographer and license; your own photos show nothing over them. */
  const credit = el('a', { class: 'photo-credit', target: '_blank', rel: 'noopener' });
  const label = (p) => { credit.hidden = !p.credit; credit.textContent = p.credit ? `Sample photo · ${p.credit}` : ''; const src = safeHref(p.source); if (src) credit.href = src; else credit.removeAttribute('href'); };
  label(order[0]);
  b.replaceChildren(el('div', { style: 'position:absolute;inset:0;overflow:hidden;background:#000' }, front, back, credit)); b.parentElement.style.padding = '0';
  if (order.length > 1) b._reel = setInterval(() => { if (!b.isConnected) return clearInterval(b._reel); i = (i + 1) % order.length; const p = order[i]; back.onload = () => { back.style.opacity = 1; front.style.opacity = 0; [front, back] = [back, front]; label(p); }; back.src = p.url; }, 9000);
} });

widget({ id: 'ask', title: 'Ask the house', icon: 'spark', pro: true, live: true, min: [3, 2], size: [5, 3], render(b) {
  if (!isPro()) return b.replaceChildren(empty('Ask anything about your home - included with Pro.', '#settings', 'See Pro'));
  b.replaceChildren(askBox({ compact: true }));
} });

widget({ id: 'house3d', title: '3D Home', icon: 'cube', pro: true, live: true, min: [4, 3], size: [6, 5], render(b) {
  if (!isPro()) return b.replaceChildren(empty('Your LiDAR scan as a live floor plan - included with Pro.', '#house3d', 'Learn more'));
  b.replaceChildren(el('iframe', { src: '/floorplan.html?embed=1', title: '3D floor plan', style: 'flex:1;border:0;border-radius:14px;background:#05070d;width:100%' }));
} });
