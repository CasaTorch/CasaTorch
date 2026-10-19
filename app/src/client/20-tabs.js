/* ---- Alerts, Controls and Cameras: pages of tiles you can arrange (24-pages.js) ---- */
tab({ id: 'alerts', label: 'Alerts', icon: 'bell', render: (main) => alertsPage(main) });
tab({ id: 'controls', label: 'Controls', icon: 'sliders', render: (main) => controlsPage(main) });
tab({ id: 'cameras', label: 'Cameras', icon: 'camera', render: (main) => camerasPage(main) });

/* Detections (Frigate): what your cameras saw - counts by kind and camera, by hour, and the latest events with
   thumbnails. Every number is one of Frigate's own events, with Frigate's confidence score. Updates every minute. */
const DET_ICON = { person: '🧍', car: '🚗', dog: '🐕', cat: '🐈', bird: '🐦', package: '📦', bicycle: '🚲', motorcycle: '🏍', truck: '🚚', bus: '🚌', license_plate: '🔢', face: '🙂', bear: '🐻', deer: '🦌', horse: '🐎' };
const detName = (l) => String(l || '').replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());
function detectionsCard() {
  const card = el('div', { class: 'card det', style: 'margin-top:14px' });
  const st = { hours: 24, label: null, camera: null };
  const draw = async () => {
    if (!card.isConnected && card.dataset.drawn) return;
    let d; try { d = await api(`/api/frigate/events?hours=${st.hours}${st.label ? `&label=${st.label}` : ''}${st.camera ? `&camera=${st.camera}` : ''}`); } catch (e) { d = { frigate: true, error: e.message }; }
    card.dataset.drawn = '1';
    if (!d.frigate) { card.remove(); return; }
    const range = el('div', { class: 'seg' }, [[24, 'Last 24 h'], [72, '3 days'], [168, '7 days']].map(([h, t]) => el('button', { class: st.hours === h ? 'on' : '', onclick: () => { st.hours = h; draw(); } }, T(t))));
    const head = el('div', { class: 'row between wrap', style: 'gap:10px;margin-bottom:12px' }, el('div', {}, el('h2', { style: 'margin:0' }, T('Detections')), el('div', { class: 'small muted' }, `${d.total === 1 ? T('From Frigate · 1 event') : T('From Frigate · {n} events', { n: d.total ?? 0 })}${st.label ? ` · ${detName(st.label)}` : ''}${st.camera ? ` · ${detName(st.camera)}` : ''}`)), range);
    if (d.error) return card.replaceChildren(head, el('p', { class: 'small bad' }, d.error));
    const chip = (key, val, n, label) => el('button', { class: `chip${st[key] === val ? ' on' : ''}`, onclick: () => { st[key] = st[key] === val ? null : val; draw(); } }, label, el('b', {}, String(n)));
    const labels = Object.entries(d.byLabel || {}).sort((a, b) => b[1] - a[1]), camsN = Object.entries(d.byCamera || {}).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...(d.byHour || [])), nowH = new Date().getHours();
    const hours = el('div', { class: 'dethours', role: 'img', 'aria-label': T('Detections by hour of day') }, (d.byHour || []).map((n, h) => el('div', { class: `dh${h === nowH ? ' now' : ''}`, title: `${hm(`${h}:00`)}: ${n}` }, el('i', { style: `height:${Math.round(n / max * 100)}%` }), h % 6 === 0 ? el('small', {}, hm(`${h}:00`).replace(':00', '')) : null)));
    const list = (d.recent || []).map((e) => {
      const [sid, id] = e.id.split(':'), dur = e.end ? Math.max(1, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 1000)) : null;
      return el('button', { class: 'detrow', onclick: () => modal(el('div', {}, el('img', { class: 'cam-full', alt: T('{what} at {camera}', { what: detName(e.label), camera: detName(e.camera) }), src: `/api/frigate/events/${sid}/${encodeURIComponent(id)}/snapshot` }),
        el('div', { class: 'small muted', style: 'margin-top:8px' }, `${detName(e.label)}${e.subLabel ? ` (${e.subLabel})` : ''} · ${detName(e.camera)} · ${fmtWhen(e.start)}${dur ? ` · ${dur < 60 ? `${dur} s` : `${Math.round(dur / 60)} min`}` : ` · ${T('still going')}`}${e.score ? ` · ${T('{n}% sure', { n: e.score })}` : ''}${e.zones.length ? ` · ${e.zones.map(detName).join(', ')}` : ''}`)), { wide: true, title: detName(e.label) }) },
        el('img', { loading: 'lazy', alt: '', src: `/api/frigate/events/${sid}/${encodeURIComponent(id)}/thumbnail` }),
        el('div', { class: 'grow', style: 'min-width:0' }, el('b', {}, `${DET_ICON[e.label] || '•'} ${detName(e.label)}${e.subLabel ? ` · ${e.subLabel}` : ''}`), el('div', { class: 'tiny muted ellipsis' }, `${detName(e.camera)} · ${fmtWhen(e.start)}${e.zones.length ? ` · ${e.zones.map(detName).join(', ')}` : ''}`)),
        e.score ? el('span', { class: `pill ${e.score >= 80 ? 'good' : ''}`, title: T('How sure Frigate was') }, `${e.score}%`) : null);
    });
    card.replaceChildren(...[head,
      labels.length ? el('div', { class: 'chips' }, labels.map(([l, n]) => chip('label', l, n, `${DET_ICON[l] || ''} ${detName(l)} `))) : null,
      camsN.length > 1 ? el('div', { class: 'chips' }, camsN.map(([c, n]) => chip('camera', c, n, `${detName(c)} `))) : null,
      d.total ? el('div', {}, el('div', { class: 'tiny muted', style: 'margin:10px 0 4px' }, T('By hour of day')), hours) : null,
      list.length ? el('div', { class: 'detlist' }, list) : el('p', { class: 'muted' }, T('Nothing detected in this time.')),
      d.errors?.length ? el('p', { class: 'tiny bad' }, T('Some of Frigate didn\'t answer: {error}', { error: d.errors[0] })) : null].filter(Boolean));
  };
  draw();
  const t = setInterval(() => { if (!card.isConnected && card.dataset.drawn) { clearInterval(t); return; } if (!document.hidden) draw(); }, 60_000);
  return card;
}

/* ---- Network: a page of tiles (26-network.js) ---- */
tab({ id: 'network', label: 'Network', icon: 'wifi', render: (main) => networkPage(main) });

/* ---- Energy ---- */
function reportCard(rep, money, redraw) {
  const card = el('div', { class: 'card report' });
  const head = el('h2', {}, T('Weekly report'), el('span', { class: 'pill pro' }, 'Pro'));
  if (!rep.pro) {
    card.append(head, proPanel(T('Every Monday, a short summary of the week: energy and what it cost, what stays on all night, the alerts and the internet - with a few tips. Written by your own AI if you connect one.')));
    return card;
  }
  const list = rep.reports || []; let i = 0;
  const body = el('div');
  const makeNow = el('button', { class: 'btn small', onclick: async () => {
    makeNow.disabled = true; makeNow.textContent = T('Writing your report...');
    try { await post('/api/reports/now'); toast(T('Report ready')); redraw(); } catch (e) { toast(e.message); makeNow.disabled = false; makeNow.textContent = T('Make one now'); }
  } }, T('Make one now'));
  const weekly = el('input', { type: 'checkbox', checked: rep.weekly, style: 'width:auto', onchange: async () => { try { await post('/api/reports/settings', { weekly: weekly.checked }, 'PUT'); toast(weekly.checked ? T('You\'ll get a report every Monday morning') : T('Weekly report off')); } catch (e) { weekly.checked = !weekly.checked; toast(e.message); } } });
  const pick = list.length > 1 ? el('select', { style: 'width:auto', 'aria-label': T('Earlier reports'), onchange: () => { i = Number(pick.value); show(); } }, list.map((r, k) => el('option', { value: k }, r.title.replace(/^Your week: /, '')))) : null;
  const show = () => {
    const r = list[i];
    if (!r) { body.replaceChildren(el('p', { class: 'muted' }, T('Your first report arrives Monday morning, once CasaTorch has a few days of history. Or make one now.'))); return; }
    const s = r.stats, chg = s.changePct;
    const chip = (v, l) => el('div', { class: 'rstat' }, el('b', {}, v), el('span', {}, l));
    body.replaceChildren(...[
      el('div', { class: 'row between wrap' }, el('div', { class: 'rtitle' }, r.title), el('div', { class: 'tiny muted' }, r.by === 'ai' ? T('Written by your AI') : T('Written by CasaTorch'), ' · ', ago(r.at))),
      el('p', { class: 'rsum' }, r.summary),
      el('div', { class: 'rstats' }, chip(`${s.kwh} kWh`, s.cost != null ? money(s.cost) : T('this week')), chg != null ? chip(`${chg > 0 ? '+' : ''}${chg}%`, T('vs the week before')) : null, s.alwaysOnW ? chip(`${s.alwaysOnW} W`, T('on all night')) : null, chip(String((s.alerts.critical || 0) + (s.alerts.warning || 0)), T('warnings or worse'))),
      r.tips?.length ? el('ul', { class: 'rtips' }, r.tips.map((t) => el('li', {}, t))) : null,
      s.topDevices?.length ? el('details', { class: 'rmore' }, el('summary', {}, T('Biggest users this week')), el('div', { class: 'bars', style: 'margin-top:10px' }, s.topDevices.map((d) => el('div', { class: 'bar-row' }, el('span', { class: 'ellipsis' }, d.name), el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(d.kwh / s.topDevices[0].kwh) * 100}%` })), el('span', { class: 'num', style: 'text-align:right' }, `${d.kwh} kWh`))))) : null,
      r.note ? el('p', { class: 'tiny muted' }, r.note) : null].filter(Boolean));
  };
  show();
  card.append(el('div', { class: 'row between wrap', style: 'margin-bottom:12px' }, head, el('div', { class: 'row wrap', style: 'gap:8px' }, pick, makeNow)), body,
    el('label', { class: 'row small muted', style: 'margin-top:14px;gap:8px' }, weekly, T('Send it every Monday morning (as a phone alert)')),
    rep.ai ? null : el('p', { class: 'tiny muted', style: 'margin-top:6px' }, T('Connect an AI in Settings › Connections & AI and the report is written by it, with tips in plain words.')));
  return card;
}
tab({ id: 'energy', label: 'Energy', icon: 'bolt', render: (main) => energyPage(main) });   // a page of tiles (23-energy.js)

/* ---- 3D Home (Pro) ---- */
/* Full screen for the 3D home, in place: the frame fills the screen (the browser's full screen where it's allowed,
   otherwise the whole window - phones and the app), the 3D page drops its own bars, and Exit or Esc come back here.
   The page never navigates away, so there's always a way out. */
function planFull(frame, on) {
  if (!frame?.isConnected || document.body.classList.contains('plan-full') === on) return;
  document.body.classList.toggle('plan-full', on); frame.classList.toggle('full', on);
  try { frame.contentWindow?.postMessage({ casa: 'immersive', on }, location.origin); } catch { /* still loading */ }
  try { window.CasaNative?.fullscreen?.(on); } catch { /* not in the app */ }
  if (on && frame.requestFullscreen && !/iphone|ipad/i.test(navigator.userAgent)) frame.requestFullscreen().catch(() => {});
  else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.casa === 'immersive') planFull(document.querySelector('iframe.plan'), !!e.data.on); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('plan-full')) planFull(document.querySelector('iframe.plan'), false); });
addEventListener('hashchange', () => { if (document.body.classList.contains('plan-full')) { document.body.classList.remove('plan-full'); try { window.CasaNative?.fullscreen?.(false); } catch { /* fine */ } } });
tab({ id: 'house3d', label: '3D Home', short: '3D', icon: 'cube', pro: true, async render(main) {
  if (!isPro()) {
    main.replaceChildren(el('div', { class: 'card hero3d' }, el('h2', { style: 'justify-content:center' }, 'CasaTorch Pro'), el('div', { style: 'font-size:28px;font-weight:700;margin-bottom:10px' }, T('Your house, in 3D')),
      el('p', { class: 'muted', style: 'max-width:560px;margin:0 auto 18px' }, T('Scan each floor with a LiDAR iPhone or iPad Pro - or draw your floors right in CasaTorch on any device - and pin your devices where they really are. Lights glow when on, speakers pulse with music, leaks and open doors flash - tap a pin to switch it.')),
      el('div', { class: 'row', style: 'justify-content:center' }, el('a', { class: 'btn primary', href: '#settings' }, T('Unlock with Pro')), el('a', { class: 'btn', href: '/floorplan.html' }, T('Preview')))));
    return null;
  }
  const frame = el('iframe', { class: 'plan', src: '/floorplan.html?embed=1', title: T('3D floor plan'), allow: 'fullscreen; screen-wake-lock' });
  setTop(T('3D Home'), T('Your LiDAR scan, live'), [el('a', { class: 'btn', href: '/floorplan.html#guide' }, T('Add floors')), el('button', { class: 'btn primary', onclick: () => planFull(frame, true) }, icon('expand'), T('Full screen'))]);
  main.replaceChildren(frame);
  return null;
} });

/* Give devices the names your household uses ("Kitchen island" instead of "hue:7"). Saved on the box, used everywhere - Home, 3D, alerts, Ask. */
function renameDevices(devices, done) {
  const names = { ...(S.ui.deviceNames || {}) };
  const rows = devices.map((d) => { const inp = el('input', { value: names[d.id] || '', placeholder: d.originalName || d.name, maxlength: 60, oninput: (e) => { names[d.id] = e.target.value.trim(); } });
    return el('div', { class: 'tab-row' }, icon(devIconName(d)), inp, el('span', { class: 'tiny faint ellipsis', style: 'max-width:140px' }, d.provider)); });
  const m = modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('Type a new name, or leave a box empty to keep the name from the device.')), el('div', { style: 'max-height:55vh;overflow:auto;padding-right:6px' }, rows),
    el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')),
      el('button', { class: 'btn primary', onclick: async () => { try { await saveUi({ deviceNames: Object.fromEntries(Object.entries(names).filter(([, v]) => v)) }); m.remove(); toast(T('Names saved')); done?.(); } catch (err) { toast(err.message); } } }, T('Save names')))), { title: T('Rename devices'), wide: true });
}
