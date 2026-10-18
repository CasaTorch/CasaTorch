/* "Replay the day": scrub back through the last 24 hours (Pro: up to 7 days) and watch the house as it was - lights on and off,
   doors and windows opening, motion, what was playing, the power. View only: nothing can be switched while replaying, and
   people and trackers are never part of it. The history comes from /api/floorplan/replay (Home Assistant's own history for its
   devices, CasaTorch's small record for the rest). Dots on the timeline mark doors opening, alarms and motion at night. */
import { replayFrame, replayDots, powerAt } from './floorplan-live-core.js';

const TT = (s, v) => (typeof window.T === 'function' ? window.T(s, v) : s);
const DOT_WORD = { open: 'Opened', alarm: 'Alarm', motion: 'Motion at night', light: 'Light on' };

export function createReplay(ctx) {
  const { S, el } = ctx;
  const R = { on: false, playing: false, data: null, t: 0, hours: 24, real: null, timeWas: null, timer: null, pend: false, bar: null };
  const fmt = (t) => { const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return `${today ? TT('Today') : d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
  const night = (t) => { const h = new Date(t).getHours(); return h < 6 || h >= 22; };
  function apply() {
    R.pend = false;
    if (!R.on || !R.data) return;
    const f = replayFrame(R.data.series, R.t), base = R.real;
    S.live = { ...base, pins: base.pins.map((p) => (f[p.deviceId] ? { ...p, device: { ...p.device, ...f[p.deviceId], ...(f[p.deviceId].on === false && p.device.kind === 'media' ? { playing: false } : {}) } } : p)), totals: { ...base.totals }, live3d: { ...(base.live3d || {}), events: [], rainOpen: [] } };
    const w = powerAt(R.data.power, R.t); if (w != null) S.live.totals.powerW = Math.round(w);
    S.live.totals.lightsOn = S.live.pins.filter((p) => p.device.kind === 'light' && p.device.on).length;
    S.live.totals.openDoors = S.live.pins.filter((p) => p.device.open && p.device.kind !== 'cover').length;
    S.live.totals.playing = S.live.pins.filter((p) => p.device.playing).map((p) => ({ name: p.label || p.device.name, title: null }));
    S.live.totals.leaks = S.live.pins.filter((p) => p.device.water).length;
    S.timeAt = new Date(R.t);   // the sun and the sky follow the replay
    ctx.drawPins(); ctx.drawTotals(); ctx.updateSky(); ctx.live.kick();
    if (R.bar) { R.bar.querySelector('.when').textContent = fmt(R.t); const r = R.bar.querySelector('input[type=range]'); if (document.activeElement !== r) r.value = String(R.t); }
  }
  const soon = () => { if (!R.pend) { R.pend = true; requestAnimationFrame(apply); } };
  async function load(hours) {
    R.hours = hours;
    try { const r = await fetch(`/api/floorplan/replay?hours=${hours}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); R.data = await r.json(); }
    catch { ctx.toast(TT('Can\'t load the history right now.')); stop(); return; }
    R.t = Math.max(R.data.from, Math.min(R.t || R.data.to - 6 * 3600_000, R.data.to));
    draw(); soon();
  }
  function start() {
    if (R.on) return;
    if (ctx.walking?.()) return;
    R.on = true; R.real = S.live; R.timeWas = S.timeAt || null; R.t = 0;
    ctx.closeCard(); document.body.classList.add('replaying');
    load(R.hours); ctx.drawTools();
  }
  function stop() {
    if (!R.on) return;
    pause(); R.on = false; R.bar?.remove(); R.bar = null;
    document.body.classList.remove('replaying');
    if (R.real) S.live = R.real; R.real = null; S.liveSig = null;
    S.timeAt = R.timeWas; ctx.updateSky();
    ctx.drawPins(); ctx.drawTotals(); ctx.drawTools(); ctx.refresh();
  }
  function pause() { R.playing = false; clearInterval(R.timer); R.timer = null; R.bar?.querySelector('.play')?.replaceChildren('▶'); }
  function play() {
    if (!R.data) return;
    if (R.t >= R.data.to - 60_000) R.t = R.data.from;
    R.playing = true; R.bar?.querySelector('.play')?.replaceChildren('❚❚');
    const per = (R.data.to - R.data.from) / 40;   // the whole window in about 40 seconds
    clearInterval(R.timer); R.timer = setInterval(() => { R.t = Math.min(R.data.to, R.t + per / 8); soon(); if (R.t >= R.data.to) pause(); }, 125);
  }
  function draw() {
    const D = R.data; if (!D) return;
    const span = D.to - D.from, dots = replayDots(D.series, D.kinds, D.from, D.to, night).filter((x) => x.type !== 'light').slice(-160);
    const name = (id) => { const p = (R.real?.pins || []).find((x) => x.deviceId === id); return p ? (p.label || p.device.name) : ''; };
    const spark = el('canvas', { class: 'spark', width: 600, height: 40, 'aria-hidden': 'true' });
    if (D.power?.length > 1) { const g = spark.getContext('2d'), mx = Math.max(500, ...D.power.map((x) => x[1])); g.beginPath(); D.power.forEach(([t, w], i) => { const x = ((t - D.from) / span) * 600, y = 38 - (w / mx) * 34; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.lineTo(600, 40); g.lineTo(0, 40); g.closePath(); g.fillStyle = 'rgba(250,204,21,.22)'; g.fill(); }
    const track = el('div', { class: 'track' }, spark, el('input', { type: 'range', min: D.from, max: D.to, step: 60_000, value: R.t, 'aria-label': TT('Time'), oninput: (e) => { pause(); R.t = Number(e.target.value); soon(); } }),
      ...dots.map((x) => el('button', { type: 'button', class: `rdot ${x.type}`, style: `left:${(((x.t - D.from) / span) * 100).toFixed(2)}%`, title: `${TT(DOT_WORD[x.type])}: ${name(x.id)} · ${fmt(x.t)}`, 'aria-label': `${TT(DOT_WORD[x.type])}: ${name(x.id)}, ${fmt(x.t)}`, onclick: () => { pause(); R.t = x.t; soon(); } })));
    const ranges = [[24, '24 h'], [72, '3 days'], [168, '7 days']];
    const bar = el('div', { id: 'l3replay', role: 'region', 'aria-label': TT('Replay the day') },
      el('div', { class: 'rtop' }, el('b', {}, TT('Replay the day')), el('span', { class: 'when' }, fmt(R.t)), el('small', { class: 'ro' }, TT('View only')),
        el('div', { class: 'seg' }, ...ranges.map(([h, label]) => el('button', { type: 'button', class: R.hours === h ? 'on' : '', disabled: h > D.maxHours ? true : null, title: h > D.maxHours ? TT('Up to 7 days with CasaTorch Pro') : null, onclick: () => load(h) }, TT(label)))),
        el('button', { type: 'button', class: 'tog play', 'aria-label': TT('Play'), onclick: () => (R.playing ? pause() : play()) }, R.playing ? '❚❚' : '▶'),
        el('button', { type: 'button', class: 'tog live', onclick: stop }, TT('Back to live'))),
      track,
      el('div', { class: 'legendrow' }, el('span', { class: 'rdot open' }), el('small', {}, TT('Opened')), el('span', { class: 'rdot motion' }), el('small', {}, TT('Motion at night')), el('span', { class: 'rdot alarm' }), el('small', {}, TT('Alarm')),
        Object.keys(D.series || {}).length ? null : el('small', {}, TT('Nothing recorded yet - CasaTorch keeps a record from now on.'))));
    if (R.bar) R.bar.replaceWith(bar); else document.body.append(bar);
    R.bar = bar;
  }
  addEventListener('keydown', (e) => { if (R.on && e.key === 'Escape') stop(); });
  return {
    on: () => R.on, playing: () => R.playing,
    start, stop,
    button: () => el('button', { type: 'button', class: `tog${R.on ? ' on' : ''}`, title: TT('Scrub through the last 24 hours'), onclick: () => (R.on ? stop() : start()) }, `↺ ${TT('Replay')}`),
  };
}
