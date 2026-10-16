/* ======================================================================
 * The tour: a one-minute look around the dashboard. Offered the first time
 * someone opens CasaTorch in a browser (and straight after setup), never on
 * a wall panel; anyone can take it again from Settings > Help & services.
 * It walks the menu as this house has it - hidden sections are skipped,
 * renamed ones keep their new names - opening each section as it goes.
 * ====================================================================== */
const TOUR_KEY = 'casatorch-tour';
const TOUR_TEXT = {
  home: 'Your day at a glance: weather, calendar, reminders and the devices you care about. "Edit layout" moves and resizes tiles; "Add widget" adds more.',
  alerts: 'Leaks, smoke, low batteries, devices that stop answering, and the doorbell. Turn on phone alerts in Settings so they reach you away from this screen.',
  controls: 'Lights, plugs, fans, thermostats, blinds and scenes in one place. For safety, CasaTorch never unlocks doors, opens garage doors or gates, or disarms alarms.',
  cameras: 'A fresh picture from every camera. Tap one to watch it live.',
  calendar: 'Your linked calendars side by side, plus a household calendar everyone here can add to.',
  photos: 'Upload photos for the photo reel on your Home screen.',
  energy: 'What the house is using right now, from any plug or meter that reports power.',
  network: 'Is the internet up, and how fast? Connect your router or ad blocker to see more.',
  house3d: 'Your home in 3D - draw it or import a phone scan - with devices shown live where they are.',
  ask: 'Ask questions in plain words, like "is anything left on?" or "when is trash day?"',
  connect: 'Add the brands you own. Anything Home Assistant supports shows up here too once Home Assistant is connected.',
  settings: 'Colors and layout, people and sign-in, phone alerts, backups - and this tour, any time.',
};
const tourStore = {
  get() { try { return localStorage.getItem(TOUR_KEY); } catch { return 'unavailable'; } },
  set(v) { try { localStorage.setItem(TOUR_KEY, v); } catch { /* private window */ } },
};

/* After boot: offer the tour once per browser, or always right after setup (?tour). */
function tourOffer() {
  const url = new URL(location.href), asked = url.searchParams.has('tour');
  if (asked) { url.searchParams.delete('tour'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
  if (isPanel() || (!asked && tourStore.get())) return;
  tourStore.set('offered');
  const house = S.settings?.house?.name;
  const m = modal(el('div', { class: 'tour-offer' },
    el('div', { class: 'tour-mark', 'aria-hidden': 'true' }, icon('spark', 28)),
    el('h3', { id: 'tourOfferTitle' }, S.status?.demo ? 'Welcome to the CasaTorch demo' : house ? `Welcome to ${house}` : 'Welcome to CasaTorch'),
    el('p', { class: 'muted' }, S.status?.demo ? 'This is a sample house, so you can try everything. Want a one-minute look around first?' : 'Your dashboard is ready. Want a one-minute look around, so you know where everything is?'),
    el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' },
      el('button', { class: 'btn ghost', onclick: () => { m.remove(); toast('You can take the tour any time from Settings.', 3500); } }, 'Maybe later'),
      el('button', { class: 'btn primary', id: 'tourStart', onclick: () => { m.remove(); tour(); } }, 'Show me around'))));
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'tourOfferTitle');
  setTimeout(() => $('#tourStart')?.focus(), 50);
}

function tour() {
  $('#modal')?.remove(); $('#tour')?.remove();
  tourStore.set('taken');
  const startTab = current;
  const navLinks = [...document.querySelectorAll('.nav a[data-tab]')].filter((a) => TOUR_TEXT[a.dataset.tab]);
  const steps = [
    { title: 'A quick look around', text: 'Each part of CasaTorch has its own place in the menu. Use Next or the arrow keys; Esc ends the tour.' },
    ...navLinks.map((a) => { const t = TABS.find((x) => x.id === a.dataset.tab); return { tab: t.id, target: a, title: tabLabel(t) + (t.pro && !isPro() ? ' (Pro)' : ''), text: TOUR_TEXT[t.id] }; }),
    { title: 'You\'re all set', text: S.status?.demo ? 'When you\'re ready, set up your own house from the bar at the top.' : 'Start by connecting the things you own - the Connect page shows what works and how.', end: true },
  ];
  let i = 0;
  const spot = el('div', { class: 'tour-spot' });
  const title = el('h3', { id: 'tourTitle' }), text = el('p'), count = el('span', { class: 'small muted' });
  const back = el('button', { class: 'btn ghost small', onclick: () => go(i - 1) }, 'Back');
  const next = el('button', { class: 'btn primary small', onclick: () => (steps[i].end ? finish(true) : go(i + 1)) });
  const card = el('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tourTitle', 'aria-live': 'polite' },
    el('div', { class: 'row between' }, count, el('button', { class: 'btn ghost small', 'aria-label': 'End the tour', onclick: () => finish(false) }, icon('x'))),
    title, text, el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, back, next));
  const root = el('div', { id: 'tour' }, spot, card);
  document.body.append(root);

  function place() {
    const s = steps[i], pad = 6, m = 12, vw = innerWidth, vh = innerHeight;
    const r = s.target?.isConnected ? s.target.getBoundingClientRect() : null;
    if (!r || !r.width) { spot.hidden = true; root.classList.add('dim'); card.style.left = `${Math.max(m, (vw - card.offsetWidth) / 2)}px`; card.style.top = `${Math.max(m, (vh - card.offsetHeight) / 2)}px`; return; }
    root.classList.remove('dim'); spot.hidden = false;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16;
    const room = { right: vw - r.right, left: r.left, below: vh - r.bottom, above: r.top };
    let x, y;
    if (room.right >= cw + gap + m) { x = r.right + gap; y = r.top + r.height / 2 - ch / 2; }
    else if (room.left >= cw + gap + m) { x = r.left - gap - cw; y = r.top + r.height / 2 - ch / 2; }
    else if (room.below >= ch + gap + m) { y = r.bottom + gap; x = r.left + r.width / 2 - cw / 2; }
    else { y = r.top - gap - ch; x = r.left + r.width / 2 - cw / 2; }
    card.style.left = `${Math.min(Math.max(m, x), vw - cw - m)}px`; card.style.top = `${Math.min(Math.max(m, y), vh - ch - m)}px`;
  }
  function go(n) {
    if (n < 0 || n >= steps.length) return;
    i = n; const s = steps[i];
    if (s.tab && s.tab !== current) location.hash = s.tab;   // open the section behind the tour
    s.target?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    count.textContent = `${i + 1} of ${steps.length}`; title.textContent = s.title; text.textContent = s.text;
    back.style.display = i === 0 ? 'none' : ''; next.textContent = s.end ? (S.status?.demo ? 'Done' : 'Go to Connect') : i === 0 ? 'Start' : 'Next';
    requestAnimationFrame(place); next.focus({ preventScroll: true });
  }
  function finish(toConnect) {
    root.remove(); removeEventListener('resize', place); removeEventListener('scroll', place, true); document.removeEventListener('keydown', keys, true);
    const to = toConnect && !S.status?.demo && TABS.some((t) => t.id === 'connect') ? 'connect' : startTab || 'home';
    if (to !== current) location.hash = to;
  }
  function keys(e) {
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
    else if (e.key === 'ArrowRight' && !steps[i].end) go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Tab') { const f = [...card.querySelectorAll('button')].filter((b) => b.offsetParent); const k = f.indexOf(document.activeElement); if (e.shiftKey ? k <= 0 : k === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); } }   // keep focus in the card
  }
  addEventListener('resize', place); addEventListener('scroll', place, true); document.addEventListener('keydown', keys, true);
  go(0);
}
