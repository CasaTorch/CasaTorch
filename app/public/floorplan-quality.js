/* Wall tablets and slower screens.
   - Quality: Auto (steps down by itself on a slow screen), Old tablet, Normal, High. Kept per screen.
   - A frame-rate readout (add ?fps=1 to the address, or switch it on in Wall tablet settings) with why it is drawing.
   - Night dimming for a wall panel (from sunset to sunrise, or set hours); any touch wakes it for two minutes.
   - A photo screensaver after a few quiet minutes, with the time and the weather. A tap brings the house back.
   - "Show what's happening": a doorbell press, a person seen or a new critical alert flies the panel to that camera or room,
     and it goes back to the whole house 30 seconds later unless someone touches it.
   - Status chips in the bar at the top: the devices or counts you pick ("3 lights on", "Garage open", "18° outside"). */
import { qualityOf, dimNow, happeningOf } from './floorplan-live-core.js';

const TT = (s, v) => (typeof window.T === 'function' ? window.T(s, v) : s);
const LKEY = 'casatorch-3d-qlevel', OKEY = 'casatorch-3d-panel-opts';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

export function createQuality(ctx) {
  const { S, el, renderer } = ctx;
  const P = { level: load(LKEY, 'auto'), opts: { dim: 'off', from: '22:00', to: '07:00', saver: 0, happen: true, fps: false, ...load(OKEY, {}) }, frames: [], ms: [], reason: '', fpsBox: null, fpsAt: 0,
    lastTouch: Date.now(), wokeAt: 0, seen: null, back: null, saverOn: false, saverT: null, photos: null, photoI: 0 };
  const urlFps = new URLSearchParams(location.search).get('fps') === '1';
  const panelOn = () => document.body.classList.contains('panelmode');
  function current() { const Q = ctx.Q; return qualityOf(P.level, devicePixelRatio || 1, P.level === 'auto' ? (Q.i || 0) + (Q.noShadow ? 1 : 0) : 0); }
  function apply() {
    const Q = ctx.Q, q = current();
    if (P.level === 'auto') { Q.locked = false; renderer.setPixelRatio(Q.ratios[Q.i]); }
    else { Q.locked = true; renderer.setPixelRatio(q.ratio); Q.noShadow = !q.shadows; }
    ctx.resize(); ctx.updateSky(); ctx.reshadow();
  }
  function setLevel(l) { P.level = l; store(LKEY, l); if (l === 'auto') { ctx.Q.noShadow = false; ctx.Q.i = 0; try { localStorage.removeItem('casatorch-3d-quality'); } catch { /* fine */ } } apply(); ctx.drawTools(); }
  const LEVELS = [['auto', 'Auto'], ['old', 'Old tablet'], ['normal', 'Normal'], ['high', 'High']];
  const levelSeg = () => el('div', { class: 'seg' }, ...LEVELS.map(([k, label]) => el('button', { type: 'button', class: P.level === k ? 'on' : '', 'aria-pressed': String(P.level === k), onclick: () => { setLevel(k); if (document.getElementById('l3tablet')) settingsPanel(); } }, TT(label))));
  if (P.level !== 'auto') setTimeout(apply, 0);

  /* ---------- frame rate ---------- */
  function frame(now, reason, ms, liveMs = 0) {
    if (!urlFps && !P.opts.fps) { if (P.fpsBox) { P.fpsBox.remove(); P.fpsBox = null; } return; }
    P.frames.push(now); P.ms.push(ms || 0); P.live = (P.live || 0) * 0.9 + liveMs * 0.1; P.reason = reason || P.reason;
    while (P.frames.length && now - P.frames[0] > 1000) { P.frames.shift(); P.ms.shift(); }
    if (now - P.fpsAt < 500) return; P.fpsAt = now;
    if (!P.fpsBox) { P.fpsBox = el('div', { id: 'l3fps', 'aria-live': 'off' }); document.body.append(P.fpsBox); }
    const avg = P.ms.length ? P.ms.reduce((a, b) => a + b, 0) / P.ms.length : 0, q = current();
    P.fpsBox.textContent = `${P.frames.length} fps · ${avg.toFixed(1)} ms (live ${P.live.toFixed(2)} ms) · ${TT(LEVELS.find(([k]) => k === q.level)?.[1] || 'Auto')} · ${P.reason}`;
  }
  /* the loop asks how long to wait between pictures: less while something moves, more when only slow things change */
  const frameMs = (moving) => { const q = current(); return moving ? Math.max(q.frameMs, 16) : q.idleMs; };
  setInterval(() => { if ((urlFps || P.opts.fps) && P.fpsBox && performance.now() - P.fpsAt > 1500) P.fpsBox.textContent = `0 fps · ${TT('resting')}`; }, 1000);

  /* ---------- night dimming, screensaver ---------- */
  const veil = () => document.getElementById('l3veil') || document.body.appendChild(el('div', { id: 'l3veil', 'aria-hidden': 'true' }));
  function sunEl() { const w = S.live?.weather; if (w?.lat == null || !ctx.sunPosition) return null; return ctx.sunPosition(new Date(), w.lat, w.lon).el; }
  function checkDim() {
    const on = panelOn() && dimNow(P.opts.dim, new Date(), sunEl(), P.opts.from, P.opts.to) && Date.now() - P.wokeAt > 120_000 && !P.saverOn;
    if (on !== document.body.classList.contains('l3-dimmed')) { document.body.classList.toggle('l3-dimmed', on); veil(); }
  }
  async function showSaver() {
    if (P.saverOn) return; P.saverOn = true;
    if (!P.photos) try { P.photos = (await (await fetch('/api/photos')).json()).photos || []; } catch { P.photos = []; }
    const a = el('img', { alt: '' }), b = el('img', { alt: '' }), clock = el('b'), wx = el('small');
    const box = el('div', { id: 'l3saver', role: 'button', tabindex: '0', 'aria-label': TT('Tap to show the house') }, a, b, el('div', { class: 'scap' }, clock, wx));
    const hide = () => { clearInterval(P.saverT); P.saverOn = false; box.remove(); P.lastTouch = Date.now(); P.wokeAt = Date.now(); checkDim(); ctx.live.kick?.(); };
    box.addEventListener('pointerdown', (e) => { e.stopPropagation(); hide(); }); box.addEventListener('keydown', hide);
    document.body.append(box);
    let front = a;
    const tickT = () => { const now = new Date(); clock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); const w = S.live?.weather; wx.textContent = [now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }), w?.temp != null ? `${Math.round(w.temp)}° ${w.words || ''}` : ''].filter(Boolean).join(' · '); };
    const next = () => { if (!P.photos.length) return; const ph = P.photos[P.photoI++ % P.photos.length], back = front === a ? b : a; back.onload = () => { back.classList.add('on'); front.classList.remove('on'); front = back; }; back.src = ph.url; };
    tickT(); next(); let n = 0; P.saverT = setInterval(() => { tickT(); if (++n % 3 === 0) next(); }, 4000);
  }
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => {
    P.lastTouch = Date.now();
    if (document.body.classList.contains('l3-dimmed')) { P.wokeAt = Date.now(); checkDim(); }
    if (P.back) { clearTimeout(P.back); P.back = null; }   // someone is using it: no going back by itself
  }, { passive: true, capture: true });
  setInterval(() => {
    checkDim();
    if (panelOn() && P.opts.saver > 0 && !P.saverOn && Date.now() - P.lastTouch > P.opts.saver * 60_000 && document.getElementById('modal')?.hidden !== false) showSaver();
  }, 15_000);

  /* ---------- show what's happening ---------- */
  function onLive() {
    const evs = S.live?.live3d?.events || [];
    if (!P.seen) { P.seen = new Set(evs.map((e) => `${e.id}|${e.at}`)); return; }   // what was already there when the page opened isn't news
    for (const e of evs) {
      const key = `${e.id}|${e.at}`; if (P.seen.has(key)) continue; P.seen.add(key);
      const kind = happeningOf(e); if (!kind || !panelOn() || !P.opts.happen || ctx.replaying?.()) continue;
      happen(kind, e); break;
    }
  }
  function happen(kind, e) {
    const pins = S.live?.pins || [], cams = pins.filter((p) => p.device.kind === 'camera');
    const byDev = e.device && pins.find((p) => p.deviceId === e.device || p.device.parts?.includes(e.device));
    const pin = byDev || (kind === 'doorbell' ? cams.find((p) => /bell|ding/i.test(`${p.label || ''} ${p.device.name} ${p.deviceId}`)) || cams.find((p) => /front|door|porch|entr/i.test(`${p.label || ''} ${p.device.name}`)) : kind === 'person' ? cams.find((p) => p.device.motion || p.device.person) : pins.find((p) => p.device.water || p.device.smoke)) || cams[0];
    if (P.saverOn) document.getElementById('l3saver')?.dispatchEvent(new Event('pointerdown'));
    P.wokeAt = Date.now(); checkDim();
    ctx.toast(e.title || (kind === 'doorbell' ? TT('Someone is at the door') : kind === 'person' ? TT('A person was seen') : TT('Something needs you')));
    if (!pin) return;
    ctx.live.flyToPin(pin);
    if (pin.device.kind === 'camera') setTimeout(() => ctx.cameraModal(pin.device, pin.label || pin.device.name), 800);
    clearTimeout(P.back); const at = Date.now();
    P.back = setTimeout(() => { P.back = null; if (P.lastTouch > at + 900) return; ctx.closeModal(); ctx.resetView(); }, 30_000);
  }

  /* ---------- status chips ---------- */
  function chips() {
    const ids = ctx.live.l3().chips || []; if (!ids.length || !S.live) return [];
    const pins = S.live.pins || [], out = [];
    for (const id of ids) {
      if (id === 'count:lights') { const n = pins.filter((p) => p.device.kind === 'light' && p.device.on).length; out.push([TT('Lights'), TT('{n} on', { n }), n ? 'warm' : '']); continue; }
      if (id === 'count:open') { const n = pins.filter((p) => p.device.open && p.device.kind !== 'cover').length; out.push([TT('Open'), String(n), n ? 'bad' : 'good']); continue; }
      if (id === 'count:motion') { const n = pins.filter((p) => p.device.motion).length; out.push([TT('Motion'), String(n), '']); continue; }
      if (id === 'count:playing') { const n = pins.filter((p) => p.device.playing).length; out.push([TT('Playing'), String(n), n ? 'music' : '']); continue; }
      if (id === 'weather') { const w = S.live.weather; if (w?.temp != null) out.push([TT('Outside'), `${Math.round(w.temp)}°`, '']); continue; }
      const p = pins.find((x) => x.deviceId === id); if (!p) continue;
      const st = ctx.devState(p.device); out.push([p.label || p.device.name, st.val ?? '', st.alarm ? 'bad' : st.act ? 'warm' : '']);
    }
    return out.map(([label, value, tone]) => el('span', { class: `stat l3chip ${tone}` }, el('small', {}, label), value));
  }

  /* ---------- the Wall tablet settings window ---------- */
  function saveOpts(patch) { Object.assign(P.opts, patch); store(OKEY, P.opts); checkDim(); }
  function settingsPanel() {
    const o = P.opts, seg = (opts, val, pick) => el('div', { class: 'seg' }, ...opts.map(([k, label]) => el('button', { type: 'button', class: val === k ? 'on' : '', 'aria-pressed': String(val === k), onclick: () => { pick(k); settingsPanel(); } }, TT(label))));
    const pins = (S.live?.pins || []).filter((p) => !['presence'].includes(p.device.kind)).sort((a, b) => (a.label || a.device.name).localeCompare(b.label || b.device.name));
    const chosen = new Set(ctx.live.l3().chips || []);
    const pick = (id) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: chosen.has(id) ? true : null, onchange: (e) => { const s = new Set(ctx.live.l3().chips || []); if (e.target.checked) s.add(id); else s.delete(id); if (s.size > 8) { e.target.checked = false; ctx.toast(TT('Up to 8 chips')); return; } ctx.live.saveL3({ chips: [...s] }); setTimeout(ctx.drawTotals, 0); } }),
      { 'count:lights': TT('How many lights are on'), 'count:open': TT('How many doors and windows are open'), 'count:motion': TT('Motion right now'), 'count:playing': TT('What is playing'), weather: TT('Outside temperature') }[id] || (() => { const p = pins.find((x) => x.deviceId === id); return p ? (p.label || p.device.name) : id; })());
    const body = el('div', { class: 'box l3tablet', id: 'l3tablet' },
      el('div', { class: 'rhead' }, el('div', {}, el('h2', {}, TT('Wall tablet settings')), el('small', {}, TT('For this screen. Wall panel mode is in View.'))), el('button', { type: 'button', class: 'iconbtn', 'aria-label': TT('Close'), onclick: ctx.closeModal }, '✕')),
      el('h3', {}, TT('Quality')), levelSeg(), el('p', { class: 'note' }, TT('Old tablet keeps it smooth on slow screens: a softer picture, no shadows, gentler animations.')),
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: o.fps || urlFps ? true : null, onchange: (e) => saveOpts({ fps: e.target.checked }) }), TT('Show the frame rate')),
      el('h3', {}, TT('Dim at night')), seg([['off', 'Off'], ['sun', 'From sunset'], ['hours', 'Set hours']], o.dim, (k) => saveOpts({ dim: k })),
      o.dim === 'hours' ? el('div', { class: 'row' }, el('label', {}, TT('From')), el('input', { type: 'time', value: o.from, onchange: (e) => saveOpts({ from: e.target.value }) }), el('label', {}, TT('to')), el('input', { type: 'time', value: o.to, onchange: (e) => saveOpts({ to: e.target.value }) })) : null,
      el('p', { class: 'note' }, TT('Any touch wakes it for two minutes.')),
      el('h3', {}, TT('Photo screensaver')), seg([[0, 'Off'], [5, '5 min'], [10, '10 min'], [30, '30 min']], o.saver, (k) => saveOpts({ saver: k })), el('p', { class: 'note' }, TT('Your photos (the Photo reel), with the time and the weather, after the screen is left alone.')),
      el('h3', {}, TT('Show what\'s happening')), el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: o.happen ? true : null, onchange: (e) => saveOpts({ happen: e.target.checked }) }), TT('A doorbell, a person at a camera or a critical alert flies to that camera or room, then back after 30 seconds')),
      el('h3', {}, TT('Status chips')), el('p', { class: 'note' }, TT('Shown in the bar at the top, on every screen.')),
      el('div', { class: 'chips2' }, ...['count:lights', 'count:open', 'count:motion', 'count:playing', 'weather'].map(pick)), el('div', { class: 'chips2 devs' }, ...pins.map((p) => pick(p.deviceId))));
    ctx.modal(body);
  }
  return {
    current, frame, frameMs, onLive, chips, settingsPanel,
    autoAllowed: () => P.level === 'auto',
    hidden: () => P.saverOn,
    menuRow: () => el('div', { class: 'poprow' }, el('small', {}, TT('Quality')), levelSeg()),
    panel(on) { if (!on) { document.body.classList.remove('l3-dimmed'); if (P.saverOn) document.getElementById('l3saver')?.dispatchEvent(new Event('pointerdown')); } P.lastTouch = Date.now(); checkDim(); },
  };
}
