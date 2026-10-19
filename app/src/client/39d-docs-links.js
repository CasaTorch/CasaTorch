/* ======================================================================
 * Help where it's needed, and setup's answers where you can change them.
 *
 *  - "Learn more" and "?" links to casatorch.com/docs: the one list of them
 *    is public/docs-links.js (CasaDocs, also used by setup); here are the
 *    app's ways to show them - next to each page's title (setTop), in
 *    Settings' section headers, Health, Connect cards and empty states.
 *    Inside the CasaTorch phone app every docs link opens in the phone's
 *    browser, never inside the app.
 *  - Settings › General › Change your setup: every setup step, each one tap
 *    away - setup opens at that step with the current answers filled in
 *    (focus mode: straight to Review & save), or the Settings page that
 *    already has it. Plus time zone, °F/°C and currency right in Settings.
 * ====================================================================== */
const docUrl = (key) => window.CasaDocs?.url(key) || null;
const docLink = (key, opts) => window.CasaDocs?.link(key, opts) || null;
/* The "?" next to the page title: set by setTop (00-core.js) for the page on screen. */
function docTitleLink(page) {
  const title = $('#title'); if (!title) return;
  let a = $('#titlehelp');
  const href = docUrl(`page.${page}`);
  if (!href) { a?.remove(); return; }
  if (!a) { a = docLink(`page.${page}`, { icon: true }); a.id = 'titlehelp'; title.after(a); }
  a.href = href; a.dataset.doc = `page.${page}`;
  a.setAttribute('aria-label', T('Learn more about {topic} (opens the guide)', { topic: title.textContent || '' }));
}
/* Any docs link in the phone app (also ones written into a page's text): the phone's browser. */
document.addEventListener('click', (e) => {
  const a = e.target?.closest?.('a[href^="https://casatorch.com/docs"]');
  if (!a || a.classList.contains('doclink') || typeof window.CasaNative?.openExternal !== 'function') return;
  e.preventDefault(); window.CasaNative.openExternal(a.href);
});
document.head.append(el('style', {}, `
.doclink{font-size:13px;color:var(--accent);text-decoration:none;white-space:nowrap}
.doclink:hover,.doclink:focus-visible{text-decoration:underline}
.doclink:not(.doclink-q)::after{content:" ↗";font-size:.85em;opacity:.75}
.doclink-q{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--line);color:var(--muted);font-size:12px;font-weight:700;line-height:1;vertical-align:middle;margin-left:8px;flex:none;text-decoration:none!important}
.doclink-q:hover,.doclink-q:focus-visible{color:var(--accent);border-color:var(--accent)}
.top #title{display:inline-block;vertical-align:middle}
#titlehelp{vertical-align:middle;margin-left:10px}
.set-head h2{display:flex;align-items:center;gap:2px}
.chg-list{display:grid;gap:0;margin:6px 0 4px}
.chg-row{display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.chg-row:first-child{border-top:0}
.chg-row .grow{min-width:0}
.chg-row b{display:block;font-size:14px}
.chg-row small{display:block;color:var(--muted);font-size:12px;line-height:1.4}
.chg-hero{border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 7%,transparent)}
.region-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:4px 12px}
.health-doc{margin-top:4px}
`));

/* ---- Settings › General › Change your setup ---- */
/* What each step covers, in a few words (a step setup gains later shows its own intro), and where Settings has it already. */
const CHG_STEPS = {
  house: ['Your home', 'Name, town, time zone, °F or °C, currency'],
  account: ['Your login', 'Username, password and Pro key'],
  protect: ['Two-step sign-in', 'A code from your phone after your password', '#settings/people'],
  phone: ['Your phone', 'The CasaTorch app\'s login and pairing', '#settings/phones'],
  calendars: ['Calendars', 'The CasaTorch calendar and linked calendars'],
  sports: ['Your teams', 'Live scores and next games'],
  news: ['Headlines', 'Local, national and world news, topics and feeds'],
  reminders: ['Reminders', 'Trash night, medicine, bills - change them on the Reminders page', '#reminders'],
  ai: ['Your Home AI Agent', 'Claude, OpenAI or an AI on your own computer', '#settings/connections'],
  homeassistant: ['Home Assistant', 'Its address and sign-in'],
  cameras: ['Cameras', 'Frigate, Reolink, Ring, snapshot cameras and more'],
  controls: ['Lights, locks and climate', 'Hue, Shelly, YoLink and what comes through Home Assistant'],
  sensors: ['Sensors', 'Which sensors, and which alert you right away'],
  network: ['Network', 'UniFi or Meraki, speed tests'],
  apptests: ['App tests', 'Which apps are tested, how often, and alerts'],
  energy: ['Energy', 'Your power company or price per kWh, budget, meters'],
  alerts: ['Alerts', 'Quiet hours and the Home Assistant phone app', '#settings/phones'],
};
/* Re-open setup (your password once, like Run setup again) - at one step, or all of it. */
async function chgOpen(pw, step, s, msg) {
  if (s?.demo) { location.href = step ? `/setup.html?step=${encodeURIComponent(step)}` : '/setup.html'; return; }
  try {
    const r = await post('/api/settings/rerun-setup', { password: pw.value });
    location.href = step ? `/setup.html?step=${encodeURIComponent(step)}` : sameOrigin(r.url, '/setup.html');
  } catch (e) { msg.textContent = e.message; msg.hidden = false; pw.focus(); }
}
async function changeSetupCard(s, me) {
  if (me?.signIn && !['admin', 'owner'].includes(me.user?.role)) return null;
  const cat = await api('/api/catalog').catch(() => null);
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: T('Your CasaTorch password'), 'aria-label': T('Your CasaTorch password') });
  const msg = el('p', { class: 'small', style: 'color:var(--bad);margin:6px 0 0', role: 'alert', hidden: true });
  const needPw = !s?.demo && me?.signIn !== false;
  const go = (step) => { if (needPw && !pw.value) { msg.textContent = T('Type your password first - it keeps setup for you alone.'); msg.hidden = false; pw.focus(); return; } chgOpen(pw, step, s, msg); };
  const steps = (cat?.steps || []).map((st) => {
    const [title, what, href] = CHG_STEPS[st.id] || [st.title, String(st.intro || '').split(/(?<=\.)\s/)[0]];
    return el('div', { class: 'chg-row' }, el('div', { class: 'grow' }, el('b', {}, T(title)), el('small', {}, T(what || ''))),
      href ? el('a', { class: 'btn small', href }, T('Open')) : el('button', { class: 'btn small', onclick: () => go(st.id) }, T('Change')));
  });
  return el('div', { class: 'card chg-hero', id: 'change-setup', style: 'grid-column:1/-1' },
    el('h2', { style: 'display:flex;align-items:center' }, icon('reset', 15), T('Change your setup'), docLink('settings.change', { icon: true, topic: T('Change your setup') })),
    el('p', { class: 'small muted', style: 'margin-top:0' }, T('Everything you answered in setup, in one place. Pick a step: setup opens right there with your current answers filled in, and everything else stays as it is.')),
    needPw ? el('label', { class: 'field', style: 'max-width:340px' }, el('span', {}, T('Your password')), pw) : null, msg,
    el('div', { class: 'chg-list' }, steps.length ? steps : [el('p', { class: 'small muted' }, T('Couldn\'t load the setup steps - try again in a moment.'))]),
    el('div', { class: 'row wrap', style: 'margin-top:10px;gap:8px' }, el('button', { class: 'btn primary', onclick: () => go(null) }, icon('reset', 14), T('Change everything')),
      el('span', { class: 'small muted' }, T('Walks through every step again, with your answers filled in.'))));
}
/* Settings › General › Language & region: time zone, °F/°C and currency right here; the town through setup (it's looked up there). */
function regionRows(s) {
  const h = s.house || {}, demo = !!s.demo;
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [h.timezone || 'UTC'];
  if (h.timezone && !zones.includes(h.timezone)) zones.unshift(h.timezone);
  const tz = el('select', { 'aria-label': T('Time zone') }, zones.map((z) => el('option', { value: z, selected: z === h.timezone ? true : null }, tzPretty(z))));
  const units = el('select', { 'aria-label': T('Temperature') }, [['F', '°F'], ['C', '°C']].map(([v, l]) => el('option', { value: v, selected: (h.units || 'F') === v ? true : null }, l)));
  const cur = el('select', { 'aria-label': T('Currency') }, el('option', { value: h.currency || 'USD', selected: true }, h.currency || 'USD'));
  api('/api/catalog').then((cat) => {
    const opts = cat?.steps?.find((x) => x.id === 'house')?.fields?.find((f) => f.id === 'currency')?.options || [];
    if (opts.length) cur.replaceChildren(...opts.map(([v, l]) => el('option', { value: v, selected: v === (h.currency || 'USD') ? true : null }, T(l))));
  }).catch(() => {});
  const save = el('button', { class: 'btn' }, T('Save'));
  save.onclick = async () => {
    if (demo) { toast(T('The demo doesn\'t change anything.')); return; }
    save.disabled = true;
    try { await post('/api/settings', { timezone: tz.value, units: units.value, currency: cur.value }, 'PUT'); S.settings = { ...S.settings, house: { ...(S.settings?.house || {}), timezone: tz.value, units: units.value, currency: cur.value } }; S.units = units.value; toast(T('Saved')); }
    catch (e) { toast(e.message, 4000); }
    save.disabled = false;
  };
  const f = (label, ctl) => el('label', { class: 'field' }, el('span', {}, label), ctl);
  return [el('div', { class: 'region-grid' }, f(T('Time zone'), tz), f(T('Temperature'), units), f(T('Currency'), cur)),
    el('div', { class: 'row wrap', style: 'gap:8px;align-items:center' }, save,
      el('span', { class: 'small muted' }, `${T('Weather for')}: ${s.location?.name || '-'}`),
      el('a', { class: 'btn small ghost', href: '#settings/general', onclick: (e) => { e.preventDefault(); $('#change-setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, T('Change the town')))];
}
