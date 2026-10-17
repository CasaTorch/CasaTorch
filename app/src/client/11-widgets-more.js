/* ======================================================================
 * More Home widgets: stocks, world clocks, countdowns, notes, the sun and
 * moon, a kitchen timer, doors & locks, the doorbell, what's playing, the
 * thermostat, batteries, today's nudges, and the Smart Stack (several
 * widgets in one spot, taking turns). Each one has its own options in
 * Customize.
 * ====================================================================== */
const wMoney = (v, cur) => { try { return new Intl.NumberFormat('en-US', { style: cur ? 'currency' : 'decimal', currency: cur || undefined, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : Math.abs(v) < 1 ? 4 : 2 }).format(v); } catch { return String(Math.round(v * 100) / 100); } };
/* A small line chart (no library): green when up, red when down. */
function sparkline(vals, { w = 120, h = 34, up } = {}) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('preserveAspectRatio', 'none'); s.setAttribute('class', 'spark'); s.setAttribute('aria-hidden', 'true');
  const v = (vals || []).filter(Number.isFinite); if (v.length < 2) return s;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - lo) / span) * (h - 4)).toFixed(1)}`);
  const color = (up ?? v.at(-1) >= v[0]) ? 'var(--good)' : 'var(--bad)';
  s.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return s;
}
const STOCK_SUGGEST = [['^GSPC', 'S&P 500'], ['^DJI', 'Dow'], ['^IXIC', 'Nasdaq'], ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'Nvidia'], ['GOOGL', 'Alphabet'], ['AMZN', 'Amazon'], ['TSLA', 'Tesla'], ['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum'], ['EURUSD=X', 'Euro']];
const NICE_SYM = Object.fromEntries(STOCK_SUGGEST);
widget({ id: 'stocks', title: 'Stocks', icon: 'gauge', cat: 'info', multi: true, blurb: 'Stocks, indexes, crypto and currencies with a small chart', keywords: 'market shares bitcoin crypto finance', min: [2, 2], size: [4, 3],
  options: [
    { key: 'symbols', type: 'symbols', label: 'Symbols', suggest: STOCK_SUGGEST, help: 'Any symbol Yahoo Finance knows: AAPL, ^GSPC (S&P 500), BTC-USD, EURUSD=X. Up to 12.' },
    { key: 'range', type: 'select', label: 'Chart', default: '1d', choices: [['1d', 'Today'], ['5d', '5 days'], ['1mo', 'A month'], ['6mo', '6 months'], ['1y', 'A year']] },
    { key: 'show', type: 'select', label: 'Change as', default: 'pct', choices: [['pct', 'Percent'], ['abs', 'Price change']] },
  ],
  async render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), syms = o.symbols?.length ? o.symbols : ['^GSPC', 'AAPL', 'MSFT'], range = o.range || '1d';
    const r = await wget(`/api/w/stocks?s=${encodeURIComponent(syms.join(','))}&range=${range}`, range === '1d' ? 120_000 : 30 * 60_000).catch((err) => ({ error: err.message }));
    if (r.error) return b.replaceChildren(empty('Quotes are not loading right now.'));
    const qs = (r.quotes || []).filter((q) => !q.error);
    if (!qs.length) return b.replaceChildren(empty('No quotes for those symbols.'));
    const chg = (q) => (q.change == null ? '' : o.show === 'abs' ? `${q.change >= 0 ? '+' : ''}${wMoney(q.change)}` : `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`);
    const label = (q) => NICE_SYM[q.symbol] || q.symbol;
    if (w <= 3 && h <= 2 || qs.length === 1) {   // one big quote
      const q = qs[0], up = (q.change ?? 0) >= 0;
      return b.replaceChildren(el('div', { class: 'stk-one' }, el('div', { class: 'row', style: 'gap:8px' }, el('b', {}, label(q)), el('span', { class: `stk-chg ${up ? 'up' : 'down'}` }, chg(q))),
        el('div', { class: 'big', style: 'font-size:30px' }, wMoney(q.price)), h >= 2 ? sparkline(q.spark, { w: 200, h: 40 }) : null, h >= 3 ? el('div', { class: 'tiny muted ellipsis' }, q.name) : null));
    }
    const rows = qs.slice(0, fits(h, 44));
    b.replaceChildren(el('div', { class: 'stk-list' }, rows.map((q) => { const up = (q.change ?? 0) >= 0; return el('div', { class: 'stk-row', title: q.name }, el('div', { style: 'min-width:0' }, el('b', { class: 'ellipsis' }, label(q)), w >= 4 ? el('div', { class: 'tiny muted ellipsis' }, q.name) : null), w >= 4 ? sparkline(q.spark, { w: 90, h: 28 }) : el('span'), el('div', { style: 'text-align:right' }, el('div', { class: 'num' }, wMoney(q.price)), el('div', { class: `stk-chg ${up ? 'up' : 'down'}` }, chg(q)))); })),
      h >= 4 ? el('div', { class: 'tiny faint', style: 'margin-top:auto' }, r.credit || '') : '');
  } });

widget({ id: 'worldclock', title: 'World clock', icon: 'clock', cat: 'time', multi: true, live: true, blurb: 'The time in other cities, day or night', keywords: 'time zone city travel', min: [2, 2], size: [4, 2],
  options: [{ key: 'zones', type: 'zones', label: 'Cities', help: 'Up to 8.' }, { key: 'h24', type: 'toggle', label: '24-hour time', text: 'Use 24-hour time' }],
  render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), zones = o.zones?.length ? o.zones : [{ tz: 'America/New_York', label: 'New York' }, { tz: 'Europe/London', label: 'London' }, { tz: 'Asia/Tokyo', label: 'Tokyo' }];
    clearInterval(b._tick);
    const draw = () => {
      if (!b.isConnected && b._drawn) return clearInterval(b._tick);
      b._drawn = true;
      const now = new Date(), here = S.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const offset = (tz) => { const p = (z) => new Date(now.toLocaleString('en-US', { timeZone: z })); const d = Math.round((p(tz) - p(here)) / 3600_000); return d === 0 ? 'Same time' : `${d > 0 ? '+' : ''}${d} h`; };
      const shown = zones.slice(0, Math.max(1, Math.min(8, w >= 6 ? zones.length : fits(h, 46))));
      b.replaceChildren(el('div', { class: `wc ${w >= 6 && h <= 2 ? 'wc-row' : ''}` }, shown.map((z) => {
        let hr = 12; try { hr = Number(new Intl.DateTimeFormat('en-US', { timeZone: z.tz, hour: 'numeric', hourCycle: 'h23' }).format(now)); } catch { /* bad zone */ }
        const day = hr >= 6 && hr < 19;
        let t = '-'; try { t = new Intl.DateTimeFormat('en-US', { timeZone: z.tz, hour: 'numeric', minute: '2-digit', hourCycle: o.h24 ? 'h23' : 'h12' }).format(now); } catch { /* bad zone */ }
        return w <= 2 ? el('div', { class: 'wc-small' }, el('div', { class: 'tiny muted ellipsis' }, `${day ? '☀️' : '\u{1F319}'} ${z.label || zoneCity(z.tz)}`), el('b', { class: 'num wc-t' }, t)) : el('div', { class: 'wc-city' }, el('span', { class: 'wc-dot', title: day ? 'Day' : 'Night' }, day ? '☀️' : '\u{1F319}'), el('div', { style: 'min-width:0' }, el('div', { class: 'ellipsis' }, z.label || zoneCity(z.tz)), el('div', { class: 'tiny muted' }, offset(z.tz))), el('b', { class: 'num wc-t' }, t));
      })));
    };
    draw(); b._tick = setInterval(draw, 15_000);
  } });

widget({ id: 'countdown', title: 'Countdown', icon: 'calendar', cat: 'personal', multi: true, live: true, askFirst: true, blurb: 'Days until a trip, a birthday, the big game', keywords: 'days until event vacation', min: [2, 2], size: [3, 2],
  options: [{ key: 'what', type: 'text', label: 'What', placeholder: 'Hawaii trip', max: 40 }, { key: 'when', type: 'datetime', label: 'When' }, { key: 'emoji', type: 'select', label: 'Picture', default: '\u{1F389}', choices: [['\u{1F389}', '\u{1F389} Party'], ['✈️', '✈️ Trip'], ['\u{1F382}', '\u{1F382} Birthday'], ['\u{1F384}', '\u{1F384} Holiday'], ['\u{1F3C8}', '\u{1F3C8} Game'], ['\u{1F393}', '\u{1F393} Graduation'], ['\u{1F48D}', '\u{1F48D} Wedding'], ['\u{1F476}', '\u{1F476} Baby'], ['\u{1F3D6}️', '\u{1F3D6}️ Vacation']] }],
  render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), when = o.when ? Date.parse(o.when) : NaN;
    clearInterval(b._tick);
    if (!Number.isFinite(when)) return b.replaceChildren(empty('Pick a date: tap Edit layout, then customize this widget.'));
    const draw = () => {
      if (!b.isConnected && b._drawn) return clearInterval(b._tick);
      b._drawn = true;
      const ms = when - Date.now(), past = ms < 0, a = Math.abs(ms);
      const d = Math.floor(a / 86400_000), hr = Math.floor((a % 86400_000) / 3600_000), mi = Math.floor((a % 3600_000) / 60_000);
      const big = d >= 2 ? `${d}` : d === 1 ? `1 day ${hr} h` : `${hr} h ${mi} min`;
      b.replaceChildren(el('div', { class: 'cd' }, el('div', { class: 'cd-emoji' }, o.emoji || '\u{1F389}'),
        el('div', { style: 'min-width:0' }, el('div', { class: 'cd-big' }, past && a < 86400_000 ? 'Today!' : big, d >= 2 ? el('span', { class: 'cd-unit' }, past ? ' days ago' : ' days') : null),
          el('div', { class: 'muted ellipsis' }, `${past ? 'since' : 'until'} ${o.what || 'the big day'}`), h >= 3 ? el('div', { class: 'tiny muted' }, fmt(new Date(when).toISOString(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) : null)));
    };
    draw(); b._tick = setInterval(draw, 30_000);
  } });

widget({ id: 'note', title: 'Note', icon: 'edit', cat: 'personal', multi: true, askFirst: true, blurb: 'A note for everyone - Wi-Fi password, chores, a welcome', keywords: 'sticky message text', min: [2, 1], size: [3, 2],
  options: [{ key: 'text', type: 'textarea', label: 'Note', placeholder: 'Guest Wi-Fi: …', max: 400 }, { key: 'big', type: 'select', label: 'Text size', default: 'auto', choices: [['auto', 'Fit the widget'], ['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] }, { key: 'align', type: 'select', label: 'Align', default: 'left', choices: [['left', 'Left'], ['center', 'Center']] }],
  render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), txt = String(o.text || '').trim();
    if (!txt) return b.replaceChildren(empty('Write a note: tap Edit layout, then customize this widget.'));
    const area = w * h, len = txt.length;
    const size = o.big === 's' ? 15 : o.big === 'm' ? 20 : o.big === 'l' ? 28 : Math.max(14, Math.min(34, Math.round(Math.sqrt((area * 2600) / Math.max(20, len)))));
    b.replaceChildren(el('div', { class: 'note-txt', style: `font-size:${size}px;text-align:${o.align === 'center' ? 'center' : 'left'}` }, txt));
  } });

widget({ id: 'sun', title: 'Sun & moon', icon: 'sun', cat: 'time', blurb: 'Sunrise, sunset, daylight and the moon', keywords: 'sunrise sunset golden hour moon phase', min: [2, 2], size: [4, 2],
  async render(b, ctx, { w, h }) {
    const s = await wget('/api/w/sun', 20 * 60_000).catch((err) => ({ error: err.message }));
    if (s.error) return b.replaceChildren(empty(s.error));
    const t = (iso) => (iso ? fmtTime(iso) : '-');
    const dayLen = s.dayMs != null ? `${Math.floor(s.dayMs / 3600_000)} h ${Math.round((s.dayMs % 3600_000) / 60_000)} min` : (s.polar === 'day' ? 'Sun all day' : 'No sunrise today');
    const change = s.changeMs != null ? `${s.changeMs >= 0 ? '+' : '−'}${Math.abs(Math.round(s.changeMs / 60_000 * 10) / 10)} min` : '';
    // the sun's path today, and where it is now
    const now = Date.now(), rise = Date.parse(s.sunrise), set = Date.parse(s.sunset), f = Number.isFinite(rise) && Number.isFinite(set) ? Math.max(0, Math.min(1, (now - rise) / (set - rise))) : null;
    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); arc.setAttribute('viewBox', '0 0 200 70'); arc.setAttribute('class', 'sun-arc'); arc.setAttribute('aria-hidden', 'true');
    const x = 10 + 180 * (f ?? 0), y = 62 - Math.sin(Math.PI * (f ?? 0)) * 52, up = f != null && now > rise && now < set;
    arc.innerHTML = `<line x1="0" y1="62" x2="200" y2="62" stroke="currentColor" opacity=".25"/><path d="M10 62 Q100 -42 190 62" fill="none" stroke="currentColor" stroke-dasharray="3 4" opacity=".45"/>${f != null ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${up ? '#fbbf24' : '#64748b'}"/>` : ''}`;
    const moon = s.moon;
    const moonSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); moonSvg.setAttribute('viewBox', '0 0 40 40'); moonSvg.setAttribute('class', 'moon'); moonSvg.setAttribute('aria-hidden', 'true');
    const ph = moon.fraction, lit = Math.cos(ph * 2 * Math.PI), rx = Math.abs(lit) * 16, waxing = ph < 0.5;
    moonSvg.innerHTML = `<circle cx="20" cy="20" r="16" fill="#1e293b"/><path d="M20 4 A16 16 0 0 ${waxing ? 1 : 0} 20 36 A${rx.toFixed(2)} 16 0 0 ${(lit > 0) === waxing ? 0 : 1} 20 4" fill="#e2e8f0"/>`;
    const parts = [el('div', { class: 'sun-row' }, el('div', {}, el('div', { class: 'tiny muted' }, 'Sunrise'), el('b', { class: 'num' }, t(s.sunrise))), w >= 3 ? arc : null, el('div', { style: 'text-align:right' }, el('div', { class: 'tiny muted' }, 'Sunset'), el('b', { class: 'num' }, t(s.sunset))))];
    if (h >= 2) parts.push(el('div', { class: 'row small muted', style: 'gap:12px;flex-wrap:wrap;margin-top:8px' }, el('span', {}, `${dayLen}${change ? ` (${change})` : ''}`), w >= 4 && s.goldenHour ? el('span', {}, `Golden hour ${t(s.goldenHour)}`) : null,
      el('span', { class: 'row', style: 'gap:6px' }, moonSvg, `${moon.name}${w >= 4 ? ` · ${moon.illumination}%` : ''}`)));
    if (h >= 3) parts.push(el('div', { class: 'tiny muted', style: 'margin-top:6px' }, `First light ${t(s.dawn)} · last light ${t(s.dusk)} · full moon ${fmt(moon.nextFull, { month: 'short', day: 'numeric' })}`));
    b.replaceChildren(...parts);
  } });

/* A kitchen timer: start it on any screen, it rings there (with the chime you pick). */
widget({ id: 'timer', title: 'Timer', icon: 'clock', cat: 'personal', multi: true, live: true, blurb: 'A kitchen timer with a chime', keywords: 'countdown cooking alarm', min: [2, 2], size: [3, 2],
  options: () => [{ key: 'sound', type: 'select', label: 'Sound', default: 'bell', choices: [['none', 'No sound'], ...Object.entries(CHIMES)] }, { key: 'presets', type: 'text', label: 'Quick times (minutes)', placeholder: '1, 5, 10, 15', max: 40 }],   // a function: the chimes are defined further down the page
  render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), presets = String(o.presets || '1, 5, 10, 15').split(/[ ,]+/).map(Number).filter((n) => n > 0 && n <= 600).slice(0, 6);
    const st = b._timer || (b._timer = { end: 0, left: 0, paused: false });
    clearInterval(b._tick);
    const face = el('div', { class: 'tm-face num' }), btns = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:auto' });
    const fmtLeft = (ms) => { const s = Math.ceil(ms / 1000), m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
    const draw = () => {
      if (!b.isConnected && b._drawn) return clearInterval(b._tick);
      b._drawn = true;
      const running = st.end && !st.paused, left = running ? st.end - Date.now() : st.left;
      if (running && left <= 0) { st.end = 0; st.left = 0; b.classList.add('tm-done'); if (o.sound !== 'none' && typeof chimePlay === 'function') chimePlay(o.sound || 'bell', 3); toast('Timer done'); window.CasaNative?.haptic?.('success'); setTimeout(() => b.classList.remove('tm-done'), 8000); }
      face.textContent = st.end || st.left ? fmtLeft(Math.max(0, running ? st.end - Date.now() : st.left)) : '0:00';
      const key = `${!!(st.end || st.left)}|${st.paused}`; if (key === b._tmKey) return; b._tmKey = key;   // buttons only change when the state does (a tap never lands on a button being replaced)
      btns.replaceChildren(...(st.end || st.left ? [el('button', { class: 'btn small', onclick: () => { if (st.paused) { st.end = Date.now() + st.left; st.paused = false; } else { st.left = st.end - Date.now(); st.paused = true; } draw(); } }, st.paused ? 'Resume' : 'Pause'), el('button', { class: 'btn small ghost', onclick: () => { st.end = 0; st.left = 0; st.paused = false; draw(); } }, 'Cancel')]
        : presets.slice(0, w <= 2 ? 2 : w <= 3 ? 4 : 6).map((m) => el('button', { class: 'btn small', onclick: () => { st.end = Date.now() + m * 60_000; st.paused = false; st.left = 0; typeof chimeAudio === 'function' && chimeAudio(); draw(); } }, `${m} min`))));
    };
    b._tmKey = null; b.replaceChildren(el('div', { class: 'tm' }, face, btns));
    draw(); b._tick = setInterval(draw, 500);
  } });

/* Doors & locks at a glance - and "Lock all". CasaTorch never unlocks or opens anything from here. */
widget({ id: 'secure', title: 'Doors & locks', icon: 'lock', cat: 'safety', essential: true, blurb: 'Locks, doors, garage and alarm at a glance', keywords: 'security lock door garage alarm', min: [2, 2], size: [4, 3],
  render(b, ctx, { w, h }) {
    const ds = ctx.data.devices?.devices || [];
    const locks = ds.filter((d) => d.kind === 'lock'), doors = ds.filter((d) => d.open != null && d.kind !== 'cover'), covers = ds.filter((d) => d.kind === 'cover' && d.risky), alarm = ds.find((d) => d.kind === 'alarm');
    const unlocked = locks.filter((d) => d.locked === false), open = [...doors, ...covers].filter((d) => d.open);
    if (!locks.length && !doors.length && !covers.length && !alarm) return b.replaceChildren(empty('No locks, door sensors or garage doors yet.'));
    const ok = !unlocked.length && !open.length;
    const head = el('div', { class: `sec-head ${ok ? 'ok' : 'warn'}` }, icon(ok ? 'shield' : 'lock', 22), el('div', {}, el('b', {}, ok ? 'All secure' : [unlocked.length ? `${unlocked.length} unlocked` : null, open.length ? `${open.length} open` : null].filter(Boolean).join(' · ')), el('div', { class: 'tiny muted' }, alarm ? `Alarm: ${pretty(alarm.state)}` : `${locks.length} lock${locks.length === 1 ? '' : 's'} · ${doors.length + covers.length} door${doors.length + covers.length === 1 ? '' : 's'}`)));
    const rows = [...unlocked, ...open, ...locks.filter((d) => d.locked), ...[...doors, ...covers].filter((d) => !d.open)].slice(0, Math.max(0, fits(h, 34, 96)));
    b.replaceChildren(...[head, h >= 3 ? el('div', { class: 'sec-list' }, rows.map((d) => el('div', { class: 'row', style: 'gap:8px' }, el('span', { class: `dot ${d.locked === false || d.open ? 'warn' : 'good'}` }), el('span', { class: 'grow ellipsis' }, d.name), el('span', { class: 'tiny muted' }, d.kind === 'lock' ? (d.locked ? 'Locked' : 'Unlocked') : d.open ? 'Open' : 'Closed')))) : null,
      unlocked.length ? el('button', { class: 'btn small primary', style: 'margin-top:auto', onclick: async (e) => { e.target.disabled = true; try { const r = await post('/api/security/lock-all', {}); toast(r.failed?.length ? `Locked ${r.locked}; couldn't lock ${r.failed.join(', ')}` : `Locked ${r.locked}`); } catch (err) { toast(err.message); } } }, icon('lock', 14), ` Lock all (${unlocked.length})`) : null].filter(Boolean));
  } });

widget({ id: 'doorbell', title: 'Doorbell', icon: 'bell', cat: 'safety', multi: true, blurb: 'Your doorbell camera and the last ring', keywords: 'ring front door camera', min: [3, 2], size: [4, 3], noPreview: true,
  options: [{ key: 'cam', type: 'device', label: 'Camera', filter: (d) => d.kind === 'camera', none: 'Find the doorbell for me', empty: 'No cameras yet.' }],
  render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), cams = (ctx.data.devices?.devices || []).filter((d) => d.kind === 'camera');
    const cam = cams.find((d) => d.id === o.cam) || cams.find((d) => d.doorbell) || cams.find((d) => /door|bell|porch|front/i.test(d.name)) || cams[0];
    if (!cam) return b.replaceChildren(empty('No doorbell camera yet.'));
    const rings = [...(ctx.data.alerts?.recent || []), ...(ctx.data.alerts?.now || [])].filter((a) => /doorbell|someone at the/i.test(`${a.kind || ''} ${a.id || ''} ${a.title || ''}`)).sort((a, c) => String(c.at || c.since).localeCompare(String(a.at || a.since)));
    const last = rings[0]?.at || rings[0]?.since;
    b.replaceChildren(...[el('div', { class: 'tile-cams', style: 'grid-template-columns:1fr;grid-template-rows:1fr' }, camView(cam)), h >= 2 ? el('div', { class: 'tiny muted', style: 'margin-top:8px' }, last ? `Last ring ${ago(last)}` : 'No rings lately') : null].filter(Boolean));
  } });

widget({ id: 'media', title: 'Now playing', icon: 'music', cat: 'home', blurb: 'What\'s playing on your speakers and TVs, with play and pause', keywords: 'music speaker sonos tv spotify', min: [2, 2], size: [4, 2],
  options: [{ key: 'ids', type: 'devices', label: 'Speakers & TVs', filter: (d) => d.kind === 'media', empty: 'No speakers or TVs yet.', help: 'Pick none for whatever is playing.' }],
  render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), all = (ctx.data.devices?.devices || []).filter((d) => d.kind === 'media');
    const ds = (o.ids?.length ? all.filter((d) => o.ids.includes(d.id)) : all).sort((a, c) => (c.playing ? 2 : c.on ? 1 : 0) - (a.playing ? 2 : a.on ? 1 : 0));
    if (!ds.length) return b.replaceChildren(empty('No speakers or TVs yet.'));
    const row = (d) => el('div', { class: `np-row${d.playing ? ' playing' : ''}` }, el('span', { class: 'np-ic' }, icon(d.playing ? 'music' : 'play', 18)),
      el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'ellipsis' }, d.playing ? d.title || 'Playing' : d.on ? 'Paused' : 'Off'), el('div', { class: 'tiny muted ellipsis' }, d.name)),
      d.online !== false ? el('button', { class: 'btn small', 'aria-label': `${d.playing ? 'Pause' : 'Play'} ${d.name}`, onclick: async (e) => { try { await toggleDevice(d); const bt = e.currentTarget; if (w >= 4) bt.textContent = d.playing ? 'Pause' : 'Play'; else bt.replaceChildren(icon(d.playing ? 'pause' : 'play', 14)); } catch (err) { toast(err.message); } } }, w >= 4 ? (d.playing ? 'Pause' : 'Play') : icon(d.playing ? 'pause' : 'play', 14)) : null,
      hasSheet(d) && w >= 4 ? el('button', { class: 'btn small ghost', 'aria-label': `More for ${d.name}`, onclick: () => deviceSheet(d) }, icon('sliders', 14)) : null);
    b.replaceChildren(el('div', { class: 'np' }, ds.slice(0, fits(h, 50)).map(row)));
  } });

widget({ id: 'thermostat', title: 'Thermostat', icon: 'thermo', cat: 'home', multi: true, blurb: 'The temperature, and up or down a degree', keywords: 'nest ecobee heat cool climate', min: [2, 2], size: [3, 3],
  options: [{ key: 'dev', type: 'device', label: 'Thermostat', filter: (d) => d.kind === 'climate', none: 'The first one', empty: 'No thermostats yet.' }],
  render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), all = (ctx.data.devices?.devices || []).filter((d) => d.kind === 'climate');
    const d = all.find((x) => x.id === o.dev) || all[0];
    if (!d) return b.replaceChildren(empty('No thermostats yet.'));
    const MODE = { heat: 'Heating', cool: 'Cooling', heat_cool: 'Auto', auto: 'Auto', off: 'Off', eco: 'Eco', dry: 'Dry', fan_only: 'Fan' };
    const send = async (action, value) => { try { await post(`/api/devices/${encodeURIComponent(d.id)}/${action}`, { value }); } catch (err) { toast(err.message, 4000); } };
    const step = S.units === 'C' ? 0.5 : 5 / 9;
    const nudge = (k) => { const v = Math.round(((d.targetC ?? d.tempC ?? 20) + k * step) * 100) / 100; d.targetC = v; tgt.textContent = tempOf(v); clearTimeout(b._t2); b._t2 = setTimeout(() => send('target', S.units === 'C' ? Math.round(v * 2) / 2 : v), 700); };
    const tgt = el('b', { class: 'num' }, d.targetC != null ? tempOf(d.targetC) : '-');
    b.replaceChildren(el('div', { class: `thermo-w mode-${d.mode || 'off'}` }, el('div', { class: 'thermo-now' }, tempOf(d.tempC)), el('div', { class: 'small muted' }, `${MODE[d.mode] || pretty(d.mode || '')}${h >= 3 ? ` · ${d.name}` : ''}`),
      d.targetC != null && d.mode !== 'off' && h >= 2 ? el('div', { class: 'thermo-set' }, el('button', { class: 'btn round', 'aria-label': 'Down', onclick: () => nudge(-1) }, '−'), el('div', {}, el('div', { class: 'tiny muted' }, 'Set to'), tgt), el('button', { class: 'btn round', 'aria-label': 'Up', onclick: () => nudge(1) }, '+')) : null));
  } });

widget({ id: 'batteries', title: 'Batteries', icon: 'bolt', cat: 'home', blurb: 'Which sensors and locks need new batteries', keywords: 'battery low sensor', min: [2, 2], size: [3, 3],
  options: [{ key: 'below', type: 'select', label: 'Show', numeric: true, default: 100, choices: [[20, 'Only below 20%'], [40, 'Below 40%'], [100, 'All of them, lowest first']] }],
  render(b, ctx, { w, h }) {
    const o = optsOf(b._t || {}), lim = o.below || 100;
    const ds = (ctx.data.devices?.devices || []).filter((d) => typeof d.battery === 'number' && d.battery <= lim).sort((a, c) => a.battery - c.battery);
    if (!ds.length) return b.replaceChildren(el('div', { class: 'allclear' }, el('div', {}, icon('checkc'), el('div', { style: 'margin-top:6px' }, lim < 100 ? 'All batteries are fine' : 'Nothing reports a battery'))));
    b.replaceChildren(el('div', { class: 'bat-list' }, ds.slice(0, fits(h, 32)).map((d) => el('div', { class: 'bat-row' }, el('span', { class: 'ellipsis' }, d.name), el('div', { class: 'track' }, el('div', { class: `fill ${d.battery <= 20 ? 'bad' : d.battery <= 40 ? 'warn' : ''}`, style: `width:${Math.max(3, d.battery)}%` })), el('span', { class: 'num small' }, `${d.battery}%`)))));
  } });

/* Smart Stack: several widgets in one spot. They take turns, or swipe / tap the dots to flip through. */
widget({ id: 'stack', title: 'Smart Stack', icon: 'list', cat: 'essentials', essential: true, multi: true, blurb: 'Several widgets in one spot, taking turns', keywords: 'rotate carousel', min: [2, 2], size: [4, 3],
  options: [{ key: 'items', type: 'widgets', label: 'Widgets in the stack', help: 'Up to 8. Each one is drawn at the stack\'s size.' }, { key: 'every', type: 'select', label: 'Take turns', numeric: true, default: 10, choices: [[0, 'Only when I swipe'], [6, 'Every 6 seconds'], [10, 'Every 10 seconds'], [20, 'Every 20 seconds'], [60, 'Every minute']] }],
  async render(b, ctx, size) {
    const o = optsOf(b._t || {}), items = (o.items?.length ? o.items : [{ id: 'weather' }, { id: 'calendar' }, { id: 'stocks' }]).filter((x) => WIDGETS[x.id] && x.id !== 'stack');
    clearInterval(b._rot);
    if (!items.length) return b.replaceChildren(empty('Pick widgets for this stack: tap Edit layout, then customize it.'));
    b._i = (b._i || 0) % items.length;
    const view = el('div', { class: 'stack-view' }), dots = el('div', { class: 'stack-dots', role: 'tablist' });
    const go = async (i, dir = 1) => {
      b._i = (i + items.length) % items.length;
      const it = items[b._i], w = WIDGETS[it.id], sub = el('div', { class: 'tile-b' });   // a fresh box each turn: the last widget's own timers stop with it
      sub._t = { id: it.id, opts: it.opts || {} }; sub._saved = () => {};
      view.classList.remove('in-l', 'in-r'); void view.offsetWidth; view.classList.add(dir > 0 ? 'in-r' : 'in-l');
      dots.replaceChildren(...items.map((x, k) => el('button', { type: 'button', class: k === b._i ? 'on' : '', 'aria-label': WIDGETS[x.id]?.title || x.id, onclick: () => go(k, k > b._i ? 1 : -1) })));
      view.replaceChildren(el('div', { class: 'stack-title' }, icon(w.icon, 13), w.title), sub);
      try { await w.render(sub, ctx, { ...size, h: Math.max(1, size.h) }); } catch (err) { sub.replaceChildren(el('div', { class: 'muted small' }, err.message)); }
    };
    b.replaceChildren(view, items.length > 1 ? dots : '');
    // swipe
    let x0 = null;
    view.onpointerdown = (e) => { x0 = e.clientX; };
    view.onpointerup = (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) go(b._i + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); };
    await go(b._i);
    if (o.every !== 0 && items.length > 1 && !size.preview) b._rot = setInterval(() => { if (!b.isConnected) return clearInterval(b._rot); if (document.hidden || document.body.classList.contains('editing-on') || b.matches(':hover')) return; go(b._i + 1); }, (o.every || 10) * 1000);
  } });
