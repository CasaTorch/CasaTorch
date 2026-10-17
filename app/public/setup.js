/* CasaTorch setup wizard. The questions come from /api/setup/catalog
   (app/catalog/setup.json); this file only knows how to ask them.
   Integrations are added to Home Assistant by running that integration's own
   setup ("config flow"): Home Assistant sends its questions, we show them. */
const W = { cat: null, steps: [], i: 0, a: {}, ha: null, haDomains: [], added: [], tests: {}, flows: {}, rerun: false, keeps: {}, hue: null, ring: null };
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
/* Talking to CasaTorch. A blip (Wi-Fi, CasaTorch restarting) is tried again with a growing pause before anyone sees
   an error; if CasaTorch restarted and wants the setup code again, it's asked for and the request carries on. */
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
function netNote(on) { const m = $('#navmsg'); if (!m) return; if (on) { m.dataset.net = '1'; m.textContent = T('Reconnecting to CasaTorch…'); } else if (m.dataset.net) { delete m.dataset.net; m.textContent = ''; } }
const api = async (url, opts = {}) => {
  for (let n = 0; ; n++) {
    let r;
    try { r = await fetch(url, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
    catch {
      if (opts.noRetry || n >= 3) { netNote(false); throw new Error(T('Can\'t reach CasaTorch right now - check this device\'s Wi-Fi, then try again. Your answers are kept.')); }
      netNote(true); await wait([800, 2000, 4500][n]); continue;
    }
    netNote(false);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.needCode && n < 2) { await regate(); continue; }
    if ([502, 503, 504].includes(r.status) && !opts.noRetry && n < 3) { await wait([800, 2000, 4500][n]); continue; }
    if (!r.ok && !('ok' in j) && !j.type) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j });
    return j;
  }
};
/* CasaTorch restarted (a power cut, an update): the setup code is asked again, then setup carries on where it was. */
function regate() { W.gate ||= (async () => { await setupCodeGate(); W.gate = null; if (W.ready) go(); })(); return W.gate; }

/* ---------- progress: kept on CasaTorch as you go, so a refresh, a closed tab or a power cut picks up right here ---------- */
let saveT = null, lastSaved = '';
function progressBody() {
  return { answers: W.a, i: W.i, max: W.max || 0, added: W.added, focus: W.focus || null,
    ui: { hue: W.hue?.paired ? { host: W.hue.host, paired: true, msg: W.hue.msg } : W.hue?.host ? { host: W.hue.host } : null, ring: W.ring?.step === 'done' ? { step: 'done' } : null, ha: W.ha && !W.rerun ? W.ha : null } };
}
function saveProgress(now = false) {
  if (!W.ready || W.done || W.demo || W.linked) return;   // opened from Connect for one item: a short visit of its own
  clearTimeout(saveT);
  const run = () => {
    let body; try { body = JSON.stringify(progressBody()); } catch { return; }
    if (body === lastSaved) return;
    lastSaved = body;
    fetch('/api/setup/progress', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 }).then((r) => { if (!r.ok) lastSaved = ''; }).catch(() => { lastSaved = ''; });
  };
  if (now) run(); else saveT = setTimeout(run, 700);
}
addEventListener('input', () => saveProgress()); addEventListener('change', () => saveProgress());
addEventListener('pagehide', () => saveProgress(true)); document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(true); });
function resumeBar() {
  let bar = $('#resume');
  if (!bar) { bar = el('div', { id: 'resume', class: 'resume', role: 'status' }); $('#page').before(bar); }
  if (!W.resumed || W.i === 0) { bar.replaceChildren(); return; }
  const pw = !W.rerun && !W.a.account?.password ? ` ${T('For your safety, passwords aren\'t kept - you\'ll type your login password again before Finish.')}` : '';
  bar.replaceChildren(el('span', {}, el('b', {}, T('Welcome back.')), ` ${T('You\'re right where you left off.')}${pw}`),
    el('button', { type: 'button', class: 'small ghost', onclick: async () => { if (!confirm(T('Start setup again from the beginning? What you\'ve typed so far is cleared.'))) return; W.done = true; await api('/api/setup/progress', { method: 'DELETE' }).catch(() => {}); location.replace(location.pathname); } }, T('Start over')));
}
/* ---------- found on your network: filled in for you (still yours to change) ---------- */
function prefillFound(store, find) {
  const got = W.found?.[find?.from]; if (!find || !got?.length) return null;
  store._found ||= {};
  if (!(find.field in store._found) && !store[find.field]) store._found[find.field] = store[find.field] = find.join ? got.join(find.join) : got[0];
  return store._found[find.field] && store[find.field] === store._found[find.field] ? el('div', { class: 'found' }, '✓ ', T('Found on your network and filled in - check it\'s right.')) : null;
}
const ans = (stepId) => (W.a[stepId] ||= {});
const pretty = (s) => String(s).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/* ---------- fields ---------- */
function visible(f, store) {
  if (f.showIf) for (const [k, vals] of Object.entries(f.showIf)) if (!vals.includes(store[k])) return false;
  if (f.showIfStep) for (const [k, vals] of Object.entries(f.showIfStep)) { const [s, q] = k.split('.'); if (!vals.includes(W.a[s]?.[q])) return false; }
  return true;
}
function fieldEl(f, store, onChange) {
  if (CUSTOM[f.type]) return CUSTOM[f.type](f, store);
  if (store[f.id] === undefined && f.default !== undefined) store[f.id] = Array.isArray(f.default) ? [...f.default] : f.default;
  if (f.type === 'timezone' && !store[f.id]) store[f.id] = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const id = `f-${f.id}-${Math.random().toString(36).slice(2, 7)}`;
  const set = (v) => { store[f.id] = v; if (f.id === 'units' || f.id === 'currency') store[`_${f.id}Set`] = true; onChange?.(); };
  let input;
  if (f.type === 'choice') {
    input = el('select', { id, onchange: (e) => set(e.target.value) }, ...f.options.map(([v, l]) => el('option', { value: v, selected: store[f.id] === v }, T(l))));
  } else if (f.type === 'multi') {
    const cur = new Set(store[f.id] || []);
    return el('div', { class: 'field' }, el('label', {}, T(f.label)), el('div', { class: 'opts' }, ...f.options.map(([v, l]) => {
      const b = el('button', { type: 'button', class: `opt${cur.has(v) ? ' on' : ''}`, onclick: () => { cur.has(v) ? cur.delete(v) : cur.add(v); store[f.id] = [...cur]; b.classList.toggle('on'); } }, T(l));
      return b;
    })));
  } else if (f.type === 'consent') {
    return el('div', { class: 'field' }, el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: store[f.id] === true, onchange: (e) => set(e.target.checked) }),
      el('span', {}, T(f.label), ' ', el('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, T('Terms')), ' · ', el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, T('Privacy')))));
  } else if (f.type === 'textarea') {
    input = el('textarea', { id, rows: 3, spellcheck: 'false', oninput: (e) => set(e.target.value.trim()) }, store[f.id] || '');
  } else if (f.type === 'timezone') {
    const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [store[f.id]]);
    input = el('select', { id, onchange: (e) => set(e.target.value) }, ...zones.map((z) => el('option', { value: z, selected: z === store[f.id] }, z)));
  } else {
    const type = f.type === 'password' || f.type === 'pin' ? 'password' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text';
    input = el('input', { id, type, value: store[f.id] ?? '', placeholder: f.placeholder || null, step: f.step || null, inputmode: f.type === 'pin' ? 'numeric' : null, autocomplete: type === 'password' ? 'new-password' : 'off', oninput: (e) => set(e.target.value) });
  }
  return el('div', { class: 'field' }, el('label', { for: id }, T(f.label), f.required || ['choice', 'multi', 'timezone'].includes(f.type) || /optional/i.test(f.label) ? '' : ` ${T('(optional)')}`), input, f.help ? el('div', { class: 'help' }, T(f.help)) : null);
}
/* A field that others depend on (showIf) redraws the page when it changes. */
function fieldsEl(fields, store, rerender) {
  const drivers = new Set((fields || []).flatMap((g) => Object.keys(g.showIf || {})));
  return (fields || []).filter((f) => visible(f, store)).map((f) => fieldEl(f, store, drivers.has(f.id) ? rerender : null));
}


/* ---------- the "your day" questions: town, calendars, teams, headlines, reminders ---------- */
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const COLORS = [['#60a5fa', 'Blue'], ['#34d399', 'Green'], ['#fbbf24', 'Yellow'], ['#f87171', 'Red'], ['#c084fc', 'Purple'], ['#f472b6', 'Pink']];
const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ');
const CURRENCY_OF = { US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CN: 'CNY', KR: 'KRW', IN: 'INR', PL: 'PLN', SE: 'SEK', NO: 'NOK', DK: 'DKK', TR: 'TRY', CH: 'CHF', MX: 'MXN', BR: 'BRL', ZA: 'ZAR', SG: 'SGD', HK: 'HKD', AE: 'AED', IL: 'ILS', ...Object.fromEntries(EURO.map((c) => [c, 'EUR'])) };
const REM_ICONS = [['bell', '🔔 Reminder'], ['trash', '🗑 Trash'], ['paw', '🐾 Pets'], ['pill', '💊 Medicine'], ['bill', '🧾 Bills'], ['plant', '🪴 Plants'], ['cake', '🎂 Birthday'], ['car', '🚗 Car'], ['school', '🎒 School'], ['laundry', '🧺 Laundry']];
const REM_SOUNDS = [['chime', 'Chime'], ['bell', 'Bell'], ['dingdong', 'Ding-dong'], ['marimba', 'Marimba'], ['birds', 'Birds'], ['alarm', 'Gentle alarm'], ['none', 'No sound']];
const CUSTOM = {
  location(f, store) {
    const box = el('div', { class: 'field' }, el('label', {}, T(f.label)));
    const cur = store[f.id];
    const q = el('input', { type: 'text', placeholder: T('Town, ZIP code, or latitude, longitude'), value: '' });
    const results = el('div', { class: 'results' });
    // The country also sets sensible defaults for °F/°C and the currency (still yours to change).
    const pick = (p) => { store[f.id] = p; if (p.cc) { if (!store._unitsSet) store.units = ['US', 'LR', 'MM', 'BS', 'KY', 'PW', 'FM', 'MH'].includes(p.cc) ? 'F' : 'C'; if (!store._currencySet && CURRENCY_OF[p.cc]) store.currency = CURRENCY_OF[p.cc]; } go(); };
    const find = async () => {
      const ll = q.value.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
      if (ll) { pick({ name: `${ll[1]}, ${ll[2]}`, lat: Number(ll[1]), lon: Number(ll[2]) }); return; }
      results.replaceChildren(el('div', { class: 'note' }, T('Looking...')));
      try { const r = await api(`/api/setup/geocode?q=${encodeURIComponent(q.value)}`); results.replaceChildren(...(r.places.length ? r.places.map((p) => el('button', { type: 'button', class: 'small', onclick: () => pick(p) }, p.name)) : [el('div', { class: 'note' }, T('No match - try the nearest bigger town.'))])); }
      catch (e) { results.replaceChildren(el('div', { class: 'err' }, e.message)); }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    if (cur?.lat != null) box.append(el('div', { class: 'ok' }, `✓ ${cur.name || `${cur.lat}, ${cur.lon}`}`));
    box.append(el('div', { class: 'row' }, el('div', { style: 'flex:1;min-width:180px' }, q), el('button', { type: 'button', class: 'small', onclick: find }, T('Find')),
      navigator.geolocation ? el('button', { type: 'button', class: 'small', onclick: () => navigator.geolocation.getCurrentPosition((g) => pick({ name: T('This location'), lat: Math.round(g.coords.latitude * 1e4) / 1e4, lon: Math.round(g.coords.longitude * 1e4) / 1e4 }), () => results.replaceChildren(el('div', { class: 'note' }, T('The browser did not share a location - search instead.')))) }, T('Use this device\'s location')) : null), results);
    if (f.help) box.append(el('div', { class: 'help' }, T(f.help)));
    return box;
  },
  calendars(f, store) {
    const list = store[f.id] ||= [];
    const box = el('div', {});
    list.forEach((c, k) => box.append(el('div', { class: 'item' },
      el('div', { class: 'grid2' }, fieldEl({ id: 'name', label: 'Name', type: 'text', placeholder: 'Family', required: true }, c), fieldEl({ id: 'color', label: 'Color', type: 'choice', options: COLORS, default: COLORS[k % COLORS.length][0] }, c)),
      fieldEl({ id: 'url', label: 'Private iCal link', type: 'url', placeholder: 'https://calendar.google.com/calendar/ical/.../basic.ics', required: true }, c),
      el('div', { class: 'row' }, testEl('calendar', c, 'Check it'), el('button', { type: 'button', class: 'small', onclick: () => { list.splice(k, 1); go(); } }, 'Remove')))));
    box.append(el('button', { type: 'button', class: 'small', onclick: () => { list.push({ name: list.length ? '' : 'Family', url: '' }); go(); } }, list.length ? 'Add another calendar' : 'Add a calendar'));
    return box;
  },
  teams(f, store) {
    const teams = store[f.id] ||= [];
    const box = el('div', {});
    box.append(el('div', { class: 'chips' }, ...teams.map((t, k) => el('span', { class: 'chip' }, `${t.name} · ${String(t.league).toUpperCase()}`, el('button', { type: 'button', 'aria-label': `Remove ${t.name}`, onclick: () => { teams.splice(k, 1); go(); } }, '×')))));
    const league = el('select', {}, el('option', { value: '' }, 'League...'));
    const team = el('select', { disabled: true }, el('option', { value: '' }, 'Team...'));
    let list = [];
    api('/api/setup/sports/leagues').then((r) => league.append(...r.leagues.map((l) => el('option', { value: l.id }, l.name)))).catch(() => {});
    league.onchange = async () => {
      team.replaceChildren(el('option', { value: '' }, 'Loading...')); team.disabled = true;
      try { list = (await api(`/api/setup/sports/teams?league=${league.value}`)).teams || []; team.replaceChildren(el('option', { value: '' }, 'Team...'), ...list.map((t) => el('option', { value: t.id }, t.name))); team.disabled = false; }
      catch (e) { team.replaceChildren(el('option', { value: '' }, `Could not load teams: ${e.message}`)); }
    };
    const add = el('button', { type: 'button', class: 'small', onclick: () => { const t = list.find((x) => x.id === team.value); if (!t || teams.some((x) => x.league === league.value && x.id === t.id)) return; teams.push({ league: league.value, id: t.id, name: t.name, abbr: t.abbr || null, logo: t.logo || null }); go(); } }, 'Add team');
    box.append(el('div', { class: 'grid2' }, league, team), el('div', { class: 'row', style: 'margin-top:8px' }, add), el('p', { class: 'note' }, 'Scores come from ESPN\'s public scoreboard.'));
    return box;
  },
  feeds(f, store) {
    // Which headlines: local, national and world first (from where you live, in your language), then topics and named sources.
    const picks = new Set(store[f.id] ||= []);
    const custom = store.custom ||= [];
    const toggle = (id, b) => { picks.has(id) ? picks.delete(id) : picks.add(id); store[f.id] = [...picks]; b.classList.toggle('on'); };
    const chip = (id, label) => { const b = el('button', { type: 'button', class: `opt${picks.has(id) ? ' on' : ''}`, onclick: () => toggle(id, b) }, label); return b; };
    const box = el('div', {}), top = el('div', { class: 'opts big' }), topics = el('div', { class: 'opts' }), groups = el('div', {});
    const loc = W.a.house?.location, cc = loc?.cc || (/,\s*([A-Z]{2})$/.exec(loc?.name || '')?.[1] || '');
    box.append(el('label', {}, T('Which headlines?')), top, el('label', { style: 'margin-top:14px' }, T('Topics')), topics, groups);
    api(`/api/setup/news/defaults?town=${encodeURIComponent(loc?.name || '')}&cc=${cc}&lang=${encodeURIComponent(W.a.house?.lang || CasaI18n.lang || 'en')}`).then((r) => {
      if (!store._seeded && !picks.size) { for (const id of ['gn-local', 'gn-national', 'gn-world']) if (r.smart.some((x) => x.id === id)) picks.add(id); store[f.id] = [...picks]; store._seeded = true; }
      for (const s of r.smart) (['gn-local', 'gn-national', 'gn-world'].includes(s.id) ? top : topics).append(chip(s.id, s.id === 'gn-local' ? `${T('Local')} · ${s.name.replace(/^Local - /, '')}` : s.id === 'gn-national' ? `${T('National')} · ${s.name.replace(/^Top stories - /, '')}` : T(s.label)));
      if (!loc?.name) top.append(el('div', { class: 'note' }, T('Local headlines need your town (first page).')));
      const byGroup = {}; for (const d of r.feeds) (byGroup[d.group || 'More'] ||= []).push(d);
      for (const [g, list] of Object.entries(byGroup)) groups.append(el('label', { style: 'margin-top:14px' }, T(g)), el('div', { class: 'opts' }, ...list.map((d) => chip(d.id, d.name))));
    }).catch(() => {});
    custom.forEach((c, k) => box.append(el('div', { class: 'item' }, el('div', { class: 'grid2' }, fieldEl({ id: 'name', label: 'Name', type: 'text', required: true }, c), fieldEl({ id: 'url', label: 'RSS or Atom feed address', type: 'url', required: true }, c)), el('div', { class: 'row' }, testEl('feed', c, T('Check it')), el('button', { type: 'button', class: 'small', onclick: () => { custom.splice(k, 1); go(); } }, T('Remove'))))));
    box.append(el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { type: 'button', class: 'small', onclick: () => { custom.push({ name: '', url: '' }); go(); } }, T('Add any feed (a local paper, a blog...)'))));
    return box;
  },
  reminders(f, store) {
    const list = store[f.id] ||= [];
    const box = el('div', {});
    list.forEach((r, k) => {
      const days = new Set(r.days ||= [0, 1, 2, 3, 4, 5, 6]);
      box.append(el('div', { class: 'item' }, fieldEl({ id: 'title', label: 'Reminder', type: 'text', placeholder: T('Trash night - bins out'), required: true }, r),
        el('div', { class: 'grid2' }, fieldEl({ id: 'icon', label: 'Icon', type: 'choice', default: 'bell', options: REM_ICONS }, r), fieldEl({ id: 'sound', label: 'Sound on the screens', type: 'choice', default: 'chime', options: REM_SOUNDS }, r)),
        el('div', { class: 'row' }, el('div', { class: 'days' }, ...DAYS.map((d, n) => { const b = el('button', { type: 'button', class: days.has(n) ? 'on' : '', 'aria-label': T(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n]), onclick: () => { days.has(n) ? days.delete(n) : days.add(n); r.days = [...days].sort(); b.classList.toggle('on'); } }, d); return b; })),
          el('input', { type: 'time', value: r.time || '', style: 'width:auto', oninput: (e) => { r.time = e.target.value; } }), el('button', { type: 'button', class: 'small', onclick: () => { list.splice(k, 1); go(); } }, T('Remove')))));
    });
    if (store.have) box.prepend(el('p', { class: 'note' }, store.have === 1 ? T('You have 1 reminder - change it on the Reminders page. Add more here.') : T('You have {n} reminders - change them on the Reminders page. Add more here.', { n: store.have })));
    box.append(el('div', { class: 'row' }, el('button', { type: 'button', class: 'small', onclick: () => { list.push({ title: '', days: [0, 1, 2, 3, 4, 5, 6] }); go(); } }, T('Add a reminder')),
      list.length ? null : el('button', { type: 'button', class: 'small', onclick: () => { list.push({ title: T('Trash night - bins out'), days: [2], time: '20:00' }); go(); } }, T('Example: trash night'))));
    return box;
  },
};

/* ---------- Home Assistant: find it, then sign in on its own page - no token to copy ---------- */
function haSigninEl(sub) {
  const box = el('div', { class: 'card' });
  const msg = el('div', { class: 'note' });
  if (sub._signedIn && W.ha) { box.append(el('div', { class: 'ok' }, `✓ ${W.ha.message}`), el('p', { class: 'note' }, 'CasaTorch made its own access token in Home Assistant (named "CasaTorch"). You can see or remove it there under Profile > Security.'),
    el('button', { type: 'button', class: 'small', onclick: () => { sub._signedIn = false; W.ha = null; go(); } }, 'Use a different Home Assistant')); return box; }
  if (!sub.url && !sub._looked && W.found?.homeassistant?.[0]) { sub.url = W.found.homeassistant[0]; sub._looked = true; msg.textContent = T('Found Home Assistant on your network at {url}.', { url: sub.url }); }
  const url = el('input', { type: 'url', placeholder: 'http://homeassistant.local:8123', value: sub.url || '', 'aria-label': 'Home Assistant address', oninput: (e) => { sub.url = e.target.value.trim(); } });
  const find = el('button', { type: 'button', class: 'small', onclick: async () => {
    find.disabled = true; msg.textContent = T('Looking on your network…');
    const r = await api('/api/setup/ha/find').catch(() => ({}));
    if (r.url) { sub.url = r.url; url.value = r.url; msg.textContent = (r.all || []).length > 1 ? T('Found {n}: {list}. The first is filled in.', { n: r.all.length, list: r.all.join(', ') }) : T('Found it at {url}.', { url: r.url }); } else msg.textContent = T('Couldn\'t find it by itself - type its address (the one you open Home Assistant with). Just the name or number is fine, like 192.168.1.20.');
    find.disabled = false; saveProgress();
  } }, 'Find it');
  if (!sub.url && !sub._looked) { sub._looked = true; setTimeout(() => { if (find.isConnected && !sub.url) find.click(); }, 50); }   // look once by itself
  const go2 = el('button', { type: 'button', class: 'primary', onclick: async () => {
    if (!sub.url) { msg.textContent = 'Type the address first, or press Find it.'; return; }
    const win = window.open('about:blank', 'ha-signin', 'width=520,height=720');
    try {
      const r = await api('/api/setup/ha/signin', { body: { url: sub.url } });
      if (r.url && r.url !== sub.url) { sub.url = r.url; url.value = r.url; }
      saveProgress(true);
      if (win) win.location = r.go; else location.href = r.go;
      msg.textContent = 'Sign in to Home Assistant in the window that opened…';
    } catch (e) { win?.close(); msg.textContent = e.message; }
  } }, 'Sign in with Home Assistant');
  box.append(el('h3', {}, 'Connect with your Home Assistant sign-in'), el('p', { class: 'note' }, 'Sign in with an administrator account. CasaTorch never sees your password.'),
    el('div', { class: 'row' }, url, find), el('div', { class: 'row', style: 'margin-top:10px' }, go2), msg,
    el('p', { class: 'note', style: 'margin-top:12px' }, 'Or paste an access token instead:'));
  return box;
}
addEventListener('message', async (e) => {
  if (e.origin !== location.origin || typeof e.data?.casatorchHa !== 'boolean') return;
  const r = await api('/api/setup/ha/signin-result').catch(() => null);
  const store = ans('homeassistant'), sub = branchStore(W.steps.find((s) => s.id === 'homeassistant'), store);
  if (r?.ok) { W.ha = r; W.haDomains = r.domains || []; store.uses = 'yes'; sub.url = r.url; sub._signedIn = true; sub._test = r; }
  else $('#navmsg').textContent = r?.error || 'Home Assistant sign-in didn\'t finish.';
  go();
});

/* ---------- connection tests ---------- */
function testEl(kind, store, label = T('Test connection')) {
  const out = el('div', { class: 'note' });
  const show = (r) => {
    out.replaceChildren(r.ok ? el('span', { class: 'ok' }, `✓ ${r.message || T('Connected')}`) : el('span', { class: 'err' }, `✗ ${r.error}`));
    if (!r.ok && r.fix) out.append(el('div', { class: 'fix' }, el('b', {}, T('How to fix:')), ' ', T(r.fix)));
    if (r.ok && r.warning) out.append(el('div', { class: 'warn' }, `⚠ ${T(r.warning)}`));
    if (r.fixedNote) out.append(el('div', { class: 'note' }, r.fixedNote));
    // a device with its own certificate (Frigate's secure port): show its fingerprint and trust exactly that one
    if (!r.ok && r.needTrust && r.fingerprint) {
      out.append(el('div', { class: 'trust' }, el('div', { class: 'small' }, T('Certificate fingerprint (SHA-256):')), el('code', { class: 'fp' }, r.fingerprint),
        el('button', { type: 'button', class: 'small primary', onclick: () => { store.trust = r.fingerprint; btn.click(); } }, T('Trust this certificate'))));
    }
    if (r.ok && r.choose) {
      if (store[r.choose.id] === undefined) store[r.choose.id] = r.choose.options[0][0];
      out.append(fieldEl({ id: r.choose.id, label: T(r.choose.label), type: 'choice', options: r.choose.options }, store));
    }
  };
  const btn = el('button', { type: 'button', class: 'small', onclick: async () => {
    btn.disabled = true; out.replaceChildren(T('Checking…'));
    try {
      const body = Object.fromEntries(Object.entries(store).filter(([k]) => !k.startsWith('_')));
      const r = await api(`/api/setup/test/${kind}`, { body });
      // the address as it should be written ("homeassistant.local" -> http://homeassistant.local:8123): put in the box
      const fixes = Object.entries(r.fixed || {}).filter(([k, v]) => store[k] !== v);
      for (const [k, v] of fixes) store[k] = v;
      if (fixes.length) r.fixedNote = T('We tidied the address for you: {url}', { url: fixes.map(([, v]) => v).join(', ') });
      store._test = r;
      if (kind === 'homeassistant' && r.ok) { W.ha = r; W.haDomains = r.domains || []; }
      if (fixes.length) { go(); return; }
      show(r);
    } catch (e) { show({ ok: false, error: e.message }); }
    btn.disabled = false;
  } }, label);
  if (store._test) show(store._test);
  return el('div', { class: 'row' }, btn, out);
}

/* ---------- Home Assistant config flows ---------- */
const FIELD_LABELS = { username: 'Username', password: 'Password', host: 'Address', api_key: 'API key', utility: 'Power company', totp_secret: 'Authenticator secret', code: 'Verification code', '2fa': 'Verification code', email: 'E-mail', port: 'Port', verify_ssl: 'Check the security certificate', pin: 'PIN', name: 'Name' };
const ERRORS = { invalid_auth: 'Wrong username or password.', cannot_connect: 'Could not reach it.', unknown: 'Something went wrong in Home Assistant.', invalid_host: 'That address is not right.', invalid_code: 'That code is not right.', timeout_connect: 'It did not answer in time.' };
const ABORTS = { already_configured: 'Already set up in Home Assistant ✓', single_instance_allowed: 'Already set up in Home Assistant ✓', reauth_successful: 'Signed in again ✓', no_devices_found: 'No devices of this kind were found on your network.', not_supported: 'Not supported by this Home Assistant.' };
const okAbort = (r) => (ABORTS[r] || '').includes('✓');
/* Home Assistant describes each question (its "data schema"); turn that into one of our fields. */
function schemaField(s) {
  const name = s.name, label = FIELD_LABELS[name] || pretty(name), required = !!s.required && !s.optional;
  const sel = s.selector || {};
  if (sel.select || s.type === 'select') {
    const raw = sel.select?.options || s.options || [];
    const opts = Array.isArray(raw) ? raw.map((o) => (Array.isArray(o) ? o : typeof o === 'object' ? [o.value, o.label] : [o, o])) : Object.entries(raw);
    return { id: name, label, type: 'choice', options: required ? opts : [['', '-'], ...opts], default: s.default ?? (required ? opts[0]?.[0] : ''), required };
  }
  if (sel.boolean || s.type === 'boolean') return { id: name, label, type: 'bool', default: s.default ?? false };
  if (s.type === 'multi_select') return { id: name, label, type: 'multi', options: Object.entries(s.options || {}), default: s.default || [] };
  if (sel.number || s.type === 'integer' || s.type === 'float') return { id: name, label, type: 'number', default: s.default, required };
  if (s.type === 'constant') return null;
  const pw = sel.text?.type === 'password' || /password|secret|token|key/i.test(name);
  return { id: name, label, type: pw ? 'password' : 'text', default: s.default, required };
}
/* Runs one integration's setup in a panel; done(title) when Home Assistant has it. */
function flowEl(domain, hint, done, extra) {
  const box = el('div', { class: 'flow' });
  const state = W.flows[domain] ||= { view: null, input: {} };
  function render() {
    const v = state.view; box.replaceChildren();
    if (!v) return;
    if (v.type === 'error') { box.append(el('div', { class: 'err' }, `✗ ${v.error}`), el('button', { type: 'button', class: 'small', onclick: start }, 'Try again')); return; }
    if (v.type === 'create_entry') { box.append(el('div', { class: 'ok' }, `✓ Added to Home Assistant${v.title ? `: ${v.title}` : ''}`)); return; }
    if (v.type === 'abort') { box.append(el('div', { class: okAbort(v.reason) ? 'ok' : 'warn' }, ABORTS[v.reason] || `Home Assistant stopped: ${pretty(v.reason)}`)); if (!okAbort(v.reason)) box.append(el('button', { type: 'button', class: 'small', onclick: start }, 'Try again')); return; }
    if (v.type === 'external') { box.append(el('p', { class: 'note' }, 'Finish signing in on the page that opens, then come back.'), el('div', { class: 'row' }, el('a', { href: /^https?:\/\//i.test(String(v.url || '')) ? v.url : null, target: '_blank', rel: 'noopener' }, 'Open the sign-in page'), el('button', { type: 'button', class: 'small', onclick: () => send({}) }, 'I\'ve signed in'))); return; }
    if (v.type === 'progress') { box.append(el('p', { class: 'note' }, 'Home Assistant is working on it…')); setTimeout(() => { if (box.isConnected) send({}); }, 3000); return; }   // stop asking once this panel is gone
    if (v.type === 'menu') {
      const opts = Array.isArray(v.menu) ? v.menu.map((m) => [m, pretty(m)]) : Object.entries(v.menu || {});
      box.append(el('p', { class: 'q' }, 'Choose one:'), el('div', { class: 'opts' }, ...opts.map(([id, l]) => el('button', { type: 'button', class: 'opt', onclick: () => send({ next_step_id: id }) }, l))));
      return;
    }
    const fields = (v.fields || []).map(schemaField).filter(Boolean);
    const input = state.input;
    if (hint) box.append(el('p', { class: 'note' }, T(hint)));
    if (v.step && v.step !== 'user') box.append(el('p', { class: 'note' }, `Next: ${pretty(v.step)}`));
    for (const [k, e] of Object.entries(v.errors || {})) box.append(el('div', { class: 'err' }, `${k === 'base' ? '' : `${FIELD_LABELS[k] || pretty(k)}: `}${ERRORS[e] || pretty(e)}`));
    for (const f of fields) {
      if (f.type === 'bool') { if (input[f.id] === undefined) input[f.id] = !!f.default; box.append(el('label', { class: 'field check' }, el('input', { type: 'checkbox', checked: input[f.id], onchange: (e) => { input[f.id] = e.target.checked; } }), f.label)); }
      else box.append(fieldEl(f, input));
    }
    const msg = el('div', { class: 'err' });
    box.append(msg, el('div', { class: 'row' },
      el('button', { type: 'button', class: 'primary', onclick: () => {
        const out = {};
        for (const f of fields) {
          let val = input[f.id];
          if (val === '' || val == null) { if (f.required) { msg.textContent = `${f.label} is needed.`; return; } continue; }
          if (f.type === 'number') val = Number(val);
          out[f.id] = val;
        }
        state.input = {}; send(out);
      } }, v.last === false ? 'Next' : 'Connect'),
      extra ? extra(cancel) : null,
      el('button', { type: 'button', class: 'small', onclick: cancel }, 'Cancel')));
  }
  async function start() { box.replaceChildren(el('p', { class: 'note' }, 'Asking Home Assistant…')); try { state.view = await api('/api/setup/ha/flow', { body: { domain } }); } catch (e) { state.view = { type: 'error', error: e.message }; } after(); }
  async function send(input) { const id = state.view?.flowId; box.replaceChildren(el('p', { class: 'note' }, 'Working…')); try { state.view = await api(`/api/setup/ha/flow/${id}`, { body: { input } }); } catch (e) { state.view = { type: 'error', error: e.message }; } after(); }
  function cancel() { const id = state.view?.flowId; if (id) api(`/api/setup/ha/flow/${id}`, { method: 'DELETE' }).catch(() => {}); state.view = null; state.input = {}; go(); }
  function after() {
    const v = state.view;
    if (v?.type === 'create_entry' || (v?.type === 'abort' && okAbort(v.reason))) {
      if (!W.added.some((x) => x.domain === domain)) W.added.push({ domain, title: v.title || domain });
      if (done) { done(v.title || domain); return; }
    }
    render();
  }
  return { el: box, start, render };
}

/* Gear CasaTorch reaches itself vs. through Home Assistant: of each pair, show one. */
const needsHa = (o) => o.method === 'ha' || o.method === 'ha-ui';
function shownOptions(list) {
  return list.filter((o) => {
    if (o.haTwin && list.some((x) => x.id === o.haTwin)) return !W.ha;   // direct option with an HA twin
    if (list.some((x) => x.haTwin === o.id)) return !!W.ha;              // HA option with a direct twin
    return true;
  });
}
function badge(o) {
  if (o.method === 'ring') return el('span', { class: 'badge pro' }, 'Pro · Labs');
  if (needsHa(o)) return el('span', { class: 'badge ha' }, W.ha ? 'via Home Assistant' : 'needs Home Assistant');
  if (o.method === 'direct' || o.method === 'hue') return el('span', { class: 'badge direct' }, 'no Home Assistant needed');
  return null;
}
function hueEl(card) {
  const st = W.hue ||= { host: '', msg: null };
  if (st.paired) { card.append(el('div', { class: 'ok' }, `✓ ${st.msg}`)); return card; }
  if (!st.host && !st.looked && W.found?.hue?.length) { st.host = W.found.hue[0]; st.looked = true; st.msg = T('Found your Hue bridge at {ip}.', { ip: st.host }); }
  const host = el('input', { type: 'text', placeholder: '192.168.1.20', value: st.host, oninput: (e) => { st.host = e.target.value.trim(); } });
  const out = el('div', { class: 'note' }, st.msg || '');
  card.append(el('p', { class: 'note' }, '1. Enter the bridge\'s address (or press Find). 2. Press the round button on top of the Hue bridge. 3. Within 30 seconds, press Pair.'),
    el('div', { class: 'row' }, el('div', { style: 'flex:1;min-width:160px' }, host),
      el('button', { type: 'button', class: 'small', onclick: async () => { out.textContent = 'Looking...'; const r = await api('/api/setup/hue/discover').catch(() => ({ bridges: [] })); if (r.bridges[0]) { st.host = r.bridges[0]; host.value = st.host; out.textContent = `Found ${r.bridges.join(', ')}`; } else out.textContent = 'Not found automatically - look in your router\'s client list for "Philips-hue".'; } }, 'Find'),
      el('button', { type: 'button', class: 'primary', onclick: async () => { out.textContent = 'Pairing...'; const r = await api('/api/setup/hue/pair', { body: { host: st.host } }).catch((e) => ({ ok: false, error: e.message })); if (r.ok) { st.paired = true; st.msg = r.message; go(); } else out.replaceChildren(el('span', { class: 'err' }, `✗ ${r.error}`)); } }, 'Pair')), out);
  return card;
}
function ringEl(card) {
  const st = W.ring ||= { email: '', step: 'login' };
  if (st.step === 'done') { card.append(el('div', { class: 'ok' }, '✓ Signed in to Ring. Your Ring password was not saved - only a sign-in token.')); return card; }
  card.append(el('p', { class: 'note' }, 'Ring has no official API. CasaTorch signs in the way the Ring app does (the method Homebridge and ring-mqtt use). It works today, but Ring could change it - that\'s why it\'s "Labs". Included with Pro and the free trial.'));
  const out = el('div', {});
  const send = async (body) => {
    out.replaceChildren(el('div', { class: 'note' }, 'Talking to Ring...'));
    try { const r = await api('/api/setup/ring/login', { body }); if (r.ok) { st.step = 'done'; go(); return; } if (r.needsCode) { st.step = 'code'; st.prompt = r.prompt; go(); return; } out.replaceChildren(el('div', { class: 'err' }, r.error || 'Ring did not accept that')); }
    catch (e) { out.replaceChildren(el('div', { class: 'err' }, /Pro feature/.test(e.message) ? 'Ring needs CasaTorch Pro (the trial has ended).' : e.message)); }
  };
  if (st.step === 'code') {
    const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456' });
    card.append(el('div', { class: 'field' }, el('label', {}, st.prompt || 'Enter the code Ring sent you'), code), el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', onclick: () => send({ code: code.value }) }, 'Verify'), el('button', { type: 'button', class: 'small', onclick: () => { st.step = 'login'; go(); } }, 'Start over')), out);
    return card;
  }
  const email = el('input', { type: 'email', value: st.email, autocomplete: 'off', oninput: (e) => { st.email = e.target.value; } }), pw = el('input', { type: 'password', autocomplete: 'off' });
  card.append(el('div', { class: 'field' }, el('label', {}, 'Ring e-mail'), email), el('div', { class: 'field' }, el('label', {}, 'Ring password'), pw, el('div', { class: 'help' }, 'Sent to Ring once to get a sign-in token; never saved.')),
    el('button', { type: 'button', class: 'primary', onclick: () => send({ email: st.email, password: pw.value }) }, 'Sign in to Ring'), out);
  return card;
}

/* One picked option of a "pick all that apply" list: how it gets set up. */
function setupFor(stepId, opt) {
  const store = ans(stepId);
  const card = el('div', { class: 'card' }, el('h3', {}, T(opt.label), badge(opt)));
  // Already in Home Assistant (Frigate's own integration, say): it comes in from there; connecting it here too is faster, and CasaTorch shows each camera once.
  if (opt.method === 'direct' && W.haDomains?.includes(opt.id)) card.append(el('div', { class: 'ok' }, `✓ ${T('Already in your Home Assistant - its cameras come in from there.')}`),
    el('p', { class: 'note' }, T('Connect it here as well for faster live video and detection stats. Each camera still shows once: CasaTorch keeps the direct one and lists the other under Cameras › Detected cameras.')));
  if (opt.method === 'hue') return hueEl(card);
  if (opt.method === 'ring') return ringEl(card);
  if (opt.method === 'ha' || opt.method === 'ha-ui') {
    if (!W.ha) { card.append(el('div', { class: 'warn' }, 'Needs Home Assistant. Connect it in the Home Assistant step, or add this later from Settings.')); return card; }
    const added = W.added.find((x) => x.domain === opt.domain);
    if (W.haDomains.includes(opt.domain) || added) { card.append(el('div', { class: 'ok' }, added ? `✓ Added to Home Assistant: ${added.title}` : '✓ Already in Home Assistant')); return card; }
    if (opt.method === 'ha-ui') {
      card.append(el('p', { class: 'note' }, T(opt.hint || 'This one signs in on a page only Home Assistant can show.')),
        el('button', { type: 'button', class: 'small', onclick: async () => { const r = await api(`/api/setup/ha/link?domain=${encodeURIComponent(opt.domain)}`); window.open(r.url, '_blank', 'noopener'); } }, 'Set it up in Home Assistant'));
      return card;
    }
    const f = flowEl(opt.domain, opt.hint, () => go());
    if (W.flows[opt.domain]?.view) f.render();
    else card.append(el('button', { type: 'button', class: 'small', onclick: (e) => { e.target.remove(); f.start(); } }, 'Add to Home Assistant'));
    card.append(f.el);
    return card;
  }
  if (opt.method === 'direct') {
    const sub = store[opt.id] ||= {};
    const found = prefillFound(sub, opt.find);
    if (found) card.append(found);
    card.append(...fieldsEl(opt.fields, sub, go));
    if (opt.test) card.append(testEl(opt.test, sub));
    return card;
  }
  if (opt.method === 'guide') card.append(el('pre', {}, W.cat.guides[opt.guide] || ''));
  return card;
}

/* ---------- how your data is kept (short; the same promise everywhere in setup) ---------- */
function safeNote(compact = false) {
  const lines = [
    [T('Stays here'), T('Everything you enter is stored on this CasaTorch - not in any CasaTorch cloud. casatorch.com never sees your devices, keys or data.')],
    [T('Sealed'), T('Passwords, API keys and tokens are encrypted with AES-256-GCM, using a key made on this device that never leaves it.')],
    [T('Hashed'), T('Sign-in passwords are stored only as scrypt hashes (salted) - not even CasaTorch can read them back.')],
    [T('Private on the wire'), T('Phones and screens connect over HTTPS (TLS) on your home network; phone alerts are end-to-end encrypted.')],
  ];
  return el('details', { class: 'card safe', open: compact ? null : true }, el('summary', {}, '🔒 ', T('Your data stays yours')),
    el('ul', {}, lines.map(([b, t]) => el('li', {}, el('b', {}, b), ' - ', t))));
}

/* After setup: the phone login's one-use QR code, for the CasaTorch app to scan. */
function pairDone(p) {
  $('#progress').replaceChildren(); $('#back').hidden = true;
  $('#next').textContent = T('Open my dashboard'); $('#next').onclick = () => { location.href = W.rerun ? '/' : '/?tour'; };
  $('#page').replaceChildren(el('h1', {}, T('Now your phone')),
    el('p', { class: 'intro' }, T('Open the CasaTorch app on your phone, tap "Scan a code", and point it at this. Your phone signs in as {user} - no typing.', { user: p.user })),
    el('div', { class: 'pairbox' }, (() => { const q = el('div', { class: 'qr' }); if (/^\s*<svg[\s>]/.test(p.qr || '')) q.innerHTML = p.qr; return q; })(), el('div', {}, el('div', { class: 'note' }, T('Or type this code in the app:')), el('div', { class: 'paircode' }, p.code),
      el('div', { class: 'note' }, T('Works once, for 30 minutes. Phone on your home Wi-Fi.')))),
    el('p', { class: 'note' }, T('No app yet? Add a phone later in Settings › Phones & alerts.')), safeNote(true));
  scrollTo(0, 0);
}

/* ---------- pages ---------- */
function welcome() {
  if (W.rerun) { const k = Object.entries(W.keeps).filter(([, v]) => v).map(([n]) => n); return [langRow(), el('h1', {}, T('Change your setup')), el('p', { class: 'intro' }, k.length ? T('Your current answers are filled in. Anything you don\'t change is kept, including what\'s already connected ({list}).', { list: k.join(', ') }) : T('Your current answers are filled in. Anything you don\'t change is kept.'))]; }
  const step = (n, t, d) => el('div', { class: 'wstep' }, el('span', { class: 'wnum' }, n), el('div', {}, el('b', {}, T(t)), el('div', { class: 'note' }, T(d))));
  return [langRow(), el('h1', {}, T('Welcome to CasaTorch')), whereRow(),
    el('p', { class: 'intro' }, T('One screen for the smart home you already have: lights, cameras, sensors, calendars and more. CasaTorch runs here on your own hardware, and your settings stay here.')),
    ...(window.CasaTour ? [window.CasaTour.card()] : []),   // "See what's possible" film (setup-tour.js)
    el('div', { class: 'wsteps' },
      step('1', 'The everyday things', 'Your town for the weather, calendars, sports teams, headlines and reminders.'),
      step('2', 'Your devices', 'Hue, Shelly, YoLink, Frigate, Reolink and Ring (Pro) connect directly. Thousands more come in through Home Assistant, if you use it.'),
      step('3', 'Your dashboard', 'Then a one-minute tour of where everything is. Change anything later in Settings.')),
    el('p', { class: 'note' }, T('About 10 to 20 minutes. Every step can be skipped and added later.')),
    el('p', { class: 'note' }, `${T('Stuck at any point? E-mail')} `, el('a', { href: 'mailto:support@casatorch.com' }, 'support@casatorch.com'), T(' - a real person answers.')),   // scrub-ok: public support address
    safeNote(),
    phoneCard(),
    el('div', { class: 'card' }, el('h3', {}, T('Just looking?')), el('p', { class: 'note' }, T('See CasaTorch with a sample house, including the 3D floor plan. No setup needed.')),
      el('button', { type: 'button', class: 'small', onclick: async () => { await api('/api/setup/demo', { body: {} }); location.href = '/?tour'; } }, T('Try the demo'))),
    restoreBox()];
}
/* First, with the language: where the home is - weather, time zone, °F/°C and currency follow from it. */
function whereRow() {
  W.a.house ||= {};
  const box = CUSTOM.location({ id: 'location', label: T('Where is your home?'), help: T('Only the town\'s map position is saved - rounded, never your street address.') }, W.a.house);
  box.classList.add('card'); return box;
}
/* The first question: which language CasaTorch speaks in this home (this browser's language when CasaTorch speaks it). */
function langRow() {
  const cur = W.a.house?.lang || (CasaI18n.lang !== 'en' ? CasaI18n.lang : CasaI18n.guess());
  if (cur !== CasaI18n.lang) CasaI18n.use(cur).then((changed) => { if (changed) go(); });
  if (!W.a.house?.lang) W.a.house = { ...(W.a.house || {}), lang: cur };
  const sel = el('select', { 'aria-label': T('Language'), onchange: async (e) => { W.a.house = { ...(W.a.house || {}), lang: e.target.value }; await CasaI18n.use(e.target.value); go(); } },
    ...Object.entries(CasaI18n.LANGS).map(([k, n]) => el('option', { value: k, selected: k === cur ? true : null }, n)));
  return el('div', { class: 'langrow' }, el('label', {}, `${T('Choose your language')}:`), sel);
}
/* Moving from another CasaTorch: restore its backup instead of setting up again. */
function restoreBox() {
  const file = el('input', { type: 'file', accept: '.ctbk,application/octet-stream' }), pass = el('input', { type: 'password', autocomplete: 'off', placeholder: 'The backup\'s passphrase' });
  const msg = el('p', { class: 'note' });
  const go = el('button', { type: 'button', class: 'small', onclick: async () => {
    const f = file.files?.[0]; if (!f || !pass.value) { msg.textContent = 'Choose the backup file and enter its passphrase.'; return; }
    go.disabled = true; msg.textContent = 'Checking and restoring...';
    try {
      const r = await fetch('/api/setup/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Passphrase': encodeURIComponent(pass.value) }, body: f });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Couldn\'t restore.');
      msg.textContent = j.restart === 'manual' ? 'Restored. Start CasaTorch again, then sign in with the accounts from the backup.' : 'Restored. CasaTorch is restarting - this page reloads in a few seconds.';
      if (j.restart !== 'manual') setTimeout(() => { location.href = '/'; }, 8000);
    } catch (e) { msg.textContent = e.message; go.disabled = false; }
  } }, T('Restore'));
  return el('details', { class: 'card' }, el('summary', {}, el('b', {}, T('Moving from another CasaTorch?')), ' ', T('Restore its backup')),
    el('p', { class: 'note' }, 'Use a backup file from Settings › Backup on your old CasaTorch. Everything comes across: settings, connections, sign-ins, floor plans and history.'),
    el('label', {}, 'Backup file (.ctbk) ', file), el('label', {}, 'Passphrase ', pass), go, msg);
}
/* Where a step's branch keeps its answers: the network step keeps each kind's own (meraki, unifi). */
const branchStore = (step, store) => (step.id === 'network' && step.branches?.[store.kind]?.fields ? (store[store.kind] ||= {}) : store);
function stepPage(step) {
  const store = ans(step.id);
  const out = [el('h1', {}, T(step.title))];
  if (W.focus?.step === step.id) out.push(el('div', { class: 'focus-note' }, el('b', {}, W.focus.label ? T('Adding {name}', { name: T(W.focus.label) }) : T('Picking up where you left off')), el('span', {}, ` - ${T('follow the card below. When you see a green check, press "Review & save". Everything else in your setup stays as it is.')}`)));
  if (step.intro) out.push(el('p', { class: 'intro' }, T(step.intro)));
  if (step.question) {
    const q = step.question;
    out.push(el('div', { class: 'q' }, T(q.label)), el('div', { class: 'opts' }, ...q.options.map(([v, l]) => el('button', { type: 'button', class: `opt${store[q.id] === v ? ' on' : ''}`, onclick: () => { if (store[q.id] !== v && step.id === 'ai') { delete store._test; delete store.apiKey; } store[q.id] = v; go(); } }, T(l)))));
    const br = step.branches?.[store[q.id]];
    if (br) {
      if (br.note) out.push(el('p', { class: 'note' }, T(br.note)));
      if (br.guide) out.push(el('pre', {}, W.cat.guides[br.guide] || ''));
      const sub = branchStore(step, store);
      // Questions that follow a pick (alerts for people? a budget?) come after it.
      const late = !!(br.pick || br.provider);
      if (step.id === 'homeassistant' && store[q.id] === 'yes') out.push(haSigninEl(sub));
      if (br.find) { const f = prefillFound(sub, br.find); if (f) out.push(f); }
      if (br.fields && !late && !(step.id === 'homeassistant' && sub._signedIn)) out.push(...fieldsEl(br.fields, sub, go));
      if (br.test && !(step.id === 'homeassistant' && sub._signedIn)) out.push(testEl(br.test, sub));
      if (br.provider) out.push(utilityEl(br.provider, store));
      if (br.pick) {
        const p = br.pick, cur = new Set(store[p.id] || []);
        const shown = shownOptions(p.options);
        out.push(el('div', { class: 'q' }, T(p.label)), el('div', { class: 'opts' }, ...shown.map((o) => el('button', { type: 'button', class: `opt${cur.has(o.id) ? ' on' : ''}`, onclick: () => { cur.has(o.id) ? cur.delete(o.id) : cur.add(o.id); store[p.id] = [...cur]; go(); } }, T(o.label), badge(o), o.desc ? el('small', {}, T(o.desc)) : null))));
        for (const o of shown) if (cur.has(o.id)) out.push(setupFor(step.id, o));
      }
      if (br.fields && late) out.push(...fieldsEl(br.fields, sub, go));
    }
  }
  if (step.fields) out.push(...fieldsEl(step.id === 'account' && W.rerun ? step.fields.map((f) => (f.id === 'password' ? { ...f, required: false, label: T('New password (leave empty to keep the current one)') } : f)) : step.fields, store, go));
  if (step.id === 'account') out.push(claimEl(store), safeNote(true));
  if (step.help) out.push(el('details', { class: 'card' }, el('summary', {}, T('Where do I find the link?')), el('p', { class: 'note' }, T(step.help))));
  return out;
}
/* Bought Pro? The key comes by e-mail code instead of copy and paste. */
function claimEl(store) {
  const st = W.claim ||= { email: '', sent: false, msg: '' };
  const card = el('div', { class: 'card' }, el('h3', {}, 'Bought CasaTorch Pro?'));
  if (store.license && st.done) { card.append(el('div', { class: 'ok' }, `✓ Pro key added (${st.done})`)); return card; }
  const email = el('input', { type: 'email', value: st.email, placeholder: 'you@example.com', autocomplete: 'email', oninput: (e) => { st.email = e.target.value; } });
  const code = el('input', { inputmode: 'numeric', maxlength: '6', placeholder: '6-digit code', autocomplete: 'one-time-code' });
  const msg = el('p', { class: 'note' }, st.msg || 'Type the e-mail you bought with and we\'ll send a code - no key to copy. (Or paste a key in the box above.)');
  const btn = el('button', { type: 'button', class: 'small' }, st.sent ? 'Get my key' : 'Send me a code');
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (!st.sent) { await api('/api/license/claim/start', { body: { email: st.email } }); st.sent = true; st.msg = 'If that address bought Pro, a code is on its way - check spam too. It works for 15 minutes.'; go(); }
      else { const r = await api('/api/license/claim/finish', { body: { email: st.email, code: code.value } }); store.license = r.key; st.done = r.plan; go(); }
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
  card.append(el('label', { class: 'field' }, el('span', {}, 'E-mail address'), email));
  if (st.sent) card.append(el('label', { class: 'field' }, el('span', {}, 'Code from the e-mail'), code));
  card.append(msg, btn);
  return card;
}
/* "Who is your power company?" - Home Assistant's own list (Opower), then its sign-in. */
function utilityEl(p, store) {
  const card = el('div', { class: 'card' }, el('h3', {}, T(p.label), el('span', { class: 'badge ha' }, W.ha ? 'via Home Assistant' : 'needs Home Assistant')), W.ha ? el('p', { class: 'note' }, T(p.help)) : null);
  if (store.utility === 'other') { card.append(el('div', { class: 'note' }, 'OK - enter your price per kWh below.'), W.ha ? el('button', { type: 'button', class: 'small', onclick: () => { store.utility = null; go(); } }, 'Look again') : null); return card; }
  if (store.utility) { card.append(el('div', { class: 'ok' }, `✓ ${store.utility} - connected through Home Assistant`)); return card; }
  if (!W.ha) { store.utility = 'other'; card.append(el('div', { class: 'warn', style: 'margin:6px 0' }, '\u26A0 Needs Home Assistant - you skipped it, so CasaTorch can\'t sign in to your power company.'), el('div', { class: 'note' }, 'You can still see costs: CasaTorch adds up your smart plugs and uses the price per kWh you enter below (it\'s on your bill). To get your real bill and usage later, connect Home Assistant from Settings > Run setup again.')); return card; }
  if (W.haDomains.includes(p.domain)) { store.utility = 'Your power company'; card.append(el('div', { class: 'ok' }, '✓ Your power company is already connected in Home Assistant')); return card; }
  const f = flowEl(p.domain, null, (title) => { store.utility = title; go(); }, (cancel) => el('button', { type: 'button', class: 'small', onclick: () => { store.utility = 'other'; cancel(); } }, T(p.otherLabel)));
  if (W.flows[p.domain]?.view) f.render();
  else card.append(el('div', { class: 'row' }, el('button', { type: 'button', class: 'small', onclick: (e) => { e.target.parentElement.remove(); f.start(); } }, 'Find my power company'), el('button', { type: 'button', class: 'small', onclick: () => { store.utility = 'other'; go(); } }, T(p.otherLabel))));
  card.append(f.el);
  return card;
}
const labelsOf = (step, ids) => (ids || []).map((id) => T(W.steps.find((s) => s.id === step)?.branches?.yes?.pick?.options.find((o) => o.id === id)?.label || id)).join(', ');
function review() {
  const a = W.a, dl = el('dl', { class: 'review' });
  const add = (k, v) => dl.append(el('dt', {}, T(k)), el('dd', {}, v || '-'));
  add('Home|house', `${a.house?.name} · ${a.house?.timezone} · °${a.house?.units} · ${a.house?.currency}`);
  add('Weather for', a.house?.location?.name || T('not set'));
  add('Login', `${a.account?.username} (${T('owner')})${a.account?.license ? ` · ${T('Pro key entered')}` : ''}`);
  add('Your phone', a.phone?.how === 'new' ? T('{user} - QR code at the end', { user: a.phone.username }) : a.phone?.how === 'owner' ? T('owner login - QR code at the end') : T('later'));
  add('Calendars', (a.calendars?.list || []).filter((c) => c.url).map((c) => c.name).join(', ') || T('none'));
  add('Teams', (a.sports?.teams || []).map((t) => t.name).join(', ') || T('none'));
  add('Headlines', T('{n} source(s)', { n: (a.news?.picks || []).length + (a.news?.custom || []).filter((c) => c.url).length }));
  add('Reminders', (a.reminders?.list || []).filter((r) => r.title).map((r) => r.title).join(', ') || T('none'));
  add('Home Assistant', W.ha ? W.ha.message : a.homeassistant?.uses === 'yes' ? T('not connected') : T('not used'));
  if (W.added.length) add('Added to Home Assistant', W.added.map((x) => x.title).join(', '));
  add('Cameras', a.cameras?.has === 'yes' ? labelsOf('cameras', a.cameras.kinds) : T('none'));
  add('Lights, locks, climate', a.controls?.has === 'yes' ? labelsOf('controls', a.controls.kinds) : T('none'));
  add('Sensors', a.sensors?.has === 'yes' ? labelsOf('sensors', a.sensors.kinds) : T('none'));
  add('Home AI Agent', a.ai?.provider && a.ai.provider !== 'later' ? (a.ai._test?.ok ? `${{ anthropic: 'Claude', openai: 'OpenAI', ollama: 'Ollama' }[a.ai.provider]} · ${a.ai._test.model}` : T('not connected yet')) : T('not now'));
  add('Network', `${T(W.steps.find((s) => s.id === 'network')?.question.options.find(([v]) => v === a.network?.kind)?.[1] || '-')}${a.network?.dns && a.network.dns !== 'none' ? ` · ${a.network.dns}` : ''}`);
  add('Energy', a.energy?.track === 'yes' ? `${a.energy.utility === 'other' || !a.energy.utility ? T('{rate} per kWh', { rate: a.energy.rate || '?' }) : a.energy.utility}${a.energy.budget ? ` · ${T('budget {budget}/month', { budget: a.energy.budget })}` : ''}${a.energy.kinds?.length ? ` · ${labelsOf('energy', a.energy.kinds)}` : ''}` : T('off'));
  const sec = el('dd', {}, T('On by default - setting itself up'));   // 43-local-https.js starts it before setup
  dl.append(el('dt', {}, T('Secure address at home')), sec);
  fetch('/api/local-https/target').then((r) => r.json()).then((j) => { sec.textContent = j.url ? T('On · {url} · the easy way in at home: casatorch.com/home', { url: j.url }) : j.off ? T('Off (turn it on in Settings)') : location.protocol === 'https:' ? T('On') : T('On by default - setting itself up (needs the internet once). Turn it off in Settings if you like.'); }).catch(() => {});
  return [el('h1', {}, T('All set?')), el('p', { class: 'intro' }, T('Check this over. Finish saves it and opens your dashboard; you can change anything later in Settings.')), dl, safeNote(true), ...(window.CasaTour ? [window.CasaTour.card(true)] : []), el('div', { id: 'finishMsg' })];
}

/* ---------- navigation ---------- */
function problems(step) {
  if (!step) return null;
  const store = ans(step.id);
  if (step.question && !store[step.question.id]) return 'Pick an answer to continue.';
  if (step.id === 'ai' && store.provider !== 'later' && !store._test?.ok) return T('Press "Test connection" so your Home AI Agent is ready - or pick "Not now".');
  const br = step.question ? step.branches?.[store[step.question.id]] : null;
  const sub = br ? branchStore(step, store) : store;
  for (const [list, src] of [[step.fields, store], [br?.fields, sub]]) for (const f of (list || []).filter((g) => visible(g, src) && g.required && !(step.id === 'homeassistant' && sub._signedIn) && !(W.rerun && step.id === 'account' && g.id === 'password') && !(W.rerun && W.ha && step.id === 'homeassistant' && g.id === 'token'))) {
    const v = src[f.id];
    if (v == null || v === '') return `${f.label} is needed.`;
    if (f.minLength && String(v).length < f.minLength) return `${f.label}: at least ${f.minLength} characters.`;
  }
  if (step.id === 'calendars' && (store.list || []).some((c) => !c.url)) return 'Paste a link for each calendar, or remove the empty one.';
  if (step.id === 'reminders' && (store.list || []).some((r) => !r.title)) return 'Give each reminder a name, or remove the empty one.';
  if (br?.pick) for (const o of shownOptions(br.pick.options)) if ((store[br.pick.id] || []).includes(o.id) && o.method === 'direct') {
    const d = store[o.id] || {};
    for (const f of (o.fields || []).filter((g) => g.required)) if (!d[f.id]) return `${o.label}: ${f.label} is needed.`;
    if (o.id === 'frigate' && !d._test?.ok) return 'Press "Test connection" for Frigate so CasaTorch can find your cameras.';
  }
  if (step.id === 'homeassistant' && store.uses === 'yes' && !W.ha) return 'Press "Test connection" so we know Home Assistant is reachable.';
  if (step.id === 'energy' && store.track === 'yes' && !store.utility) return 'Find your power company, or choose "Mine isn\'t listed".';
  return null;
}
function go() {
  $('#navmsg').textContent = '';
  const pages = [T('Welcome'), ...W.steps.map((s) => T(s.title)), T('Review')];
  // Any step already reached can be opened from the top; the ones ahead open in order, with Next.
  W.max = Math.max(W.max || 0, W.i);
  $('#progress').replaceChildren(...pages.map((t, k) => {
    const can = k <= W.max && k !== W.i;
    return el('li', { class: `${k === W.i ? 'on' : k <= W.max ? 'done' : 'ahead'}${can ? ' can' : ''}` }, can ? el('button', { type: 'button', onclick: () => { W.i = k; go(); scrollTo(0, 0); } }, t) : el('span', { 'aria-current': k === W.i ? 'step' : null, title: k > W.max ? T('Use Next to get here') : null }, t));
  }));
  $('#page').replaceChildren(...(W.i === 0 ? welcome() : W.i > W.steps.length ? review() : stepPage(W.steps[W.i - 1])));
  $('#back').disabled = W.i === 0;
  $('#next').textContent = T(W.i === 0 ? 'Set up my home' : W.i > W.steps.length ? (W.focus ? 'Save' : 'Finish') : W.focus && W.steps[W.i - 1]?.id === W.focus.step ? 'Review & save' : 'Next');
  $('#back').textContent = T('Back');
  resumeBar(); saveProgress();
}
$('#back').onclick = () => { if (W.i > 0) { W.i--; go(); scrollTo(0, 0); } };
let finishing = false;
const stepIndex = (id) => W.steps.findIndex((s) => s.id === id) + 1;
$('#next').onclick = async () => {
  if (W.i > W.steps.length) {
    if (finishing) return;   // a double tap saves once
    // Passwords are never kept between visits: ask for one that's missing now, not after a failed save.
    const missing = !W.rerun && !W.a.account?.password ? 'account' : W.a.phone?.how === 'new' && !W.a.phone.password ? 'phone' : null;
    if (missing) { W.i = stepIndex(missing); go(); scrollTo(0, 0); $('#navmsg').textContent = T('Type the password again - for your safety it isn\'t kept between visits.'); return; }
    const msg = $('#finishMsg'), next = $('#next'), back = $('#back'), label = next.textContent;
    finishing = true; next.disabled = back.disabled = true; next.textContent = T('Saving…'); msg.replaceChildren(el('div', { class: 'note' }, T('Saving your setup…')));
    const done = (r) => { W.done = true; clearTimeout(saveT); if (r?.pair) return pairDone(r.pair); location.href = W.focus ? '/#connect' : W.rerun ? '/' : '/?tour'; };
    try { const r = await api('/api/setup/finish', { body: { answers: { ...W.a, _added: W.added } }, noRetry: true }); if (r.ok) return done(r); msg.replaceChildren(el('div', { class: 'err' }, r.error)); }
    catch (e) {
      // The answer may have been lost on the way back (Wi-Fi, CasaTorch restarting): check whether it saved before saying it didn't.
      await wait(1500);
      const st = await api('/api/setup/state').catch(() => null);
      if (st && !W.rerun && st.configured && !st.demo) return done(null);
      msg.replaceChildren(el('div', { class: 'err' }, e.status === 409 ? T('Already saving - one moment.') : e.message), el('div', { class: 'note' }, T('Nothing is lost - press Finish again.')));
    } finally { if (!W.done) { finishing = false; next.disabled = false; back.disabled = W.i === 0; next.textContent = label; } }
    return;
  }
  const p = problems(W.steps[W.i - 1]);
  if (p) { $('#navmsg').textContent = p; return; }
  W.i = W.focus && W.steps[W.i - 1]?.id === W.focus.step ? W.steps.length + 1 : W.i + 1; go(); scrollTo(0, 0);
};
/* The setup code: only the owner sets up a new CasaTorch. On the computer CasaTorch runs on (and from Home Assistant)
   it isn't asked; from a phone or another computer it is, once. A link from the QR code fills it in. */
const WHERE = {
  computer: ['On the computer CasaTorch is installed on: the setup page opened there by itself (or open http://localhost:8090 on it). The code is on that page, with a QR code - scan it with this phone and setup opens with the code filled in.'],
  docker: ['In the container\'s log: run  docker logs casatorch  on the computer running it (or open the log in Portainer or your NAS\'s container app).', 'Or open http://localhost:8090 on the computer running Docker - no code is needed there.'],
  addon: ['Open CasaTorch from Home Assistant instead (Settings › Add-ons › CasaTorch › Open Web UI) - no code is needed there.', 'Or find it in the add-on\'s Log tab.'],
  pi: ['A CasaTorch Box: on the sticker that came with it.', 'A Raspberry Pi you set up yourself: put its memory card in any computer - the code is in the file casatorch-setup-code. Or run  journalctl -u casatorch  on the Pi.'],
};
async function setupCodeGate() {
  const qp = new URLSearchParams(location.search), given = qp.get('code');
  if (given) { qp.delete('code'); history.replaceState(null, '', location.pathname + (qp.toString() ? `?${qp}` : '')); await api('/api/setup/code', { body: { code: given } }).catch(() => {}); }
  const c = await api('/api/setup/code').catch(() => ({ needed: false }));
  if (c.code) W.phone = c;   // on the computer itself: shown on the welcome page for setting up from a phone
  if (!c.needed) return;
  const foot = document.querySelector('footer'); foot.style.display = 'none';   // no Back/Next until the code is in
  await new Promise((done) => {
    const input = el('input', { type: 'text', id: 'setupcode', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', maxlength: '12', placeholder: 'ABCD-2345', 'aria-describedby': 'codehelp', class: 'codein' });
    const msg = el('p', { class: 'err', role: 'alert' });
    const go2 = async (e) => { e?.preventDefault(); msg.textContent = ''; try { await api('/api/setup/code', { body: { code: input.value } }); done(); } catch (err) { msg.textContent = err.message; input.select(); } };
    const askBox = el('div', { class: 'card' });
    const askIdle = () => askBox.replaceChildren(el('h3', {}, T('Or allow this device from the computer CasaTorch runs on')),
      el('p', { class: 'note' }, T('No code to type: ask here, then press Allow on that computer\'s setup page.')),
      el('button', { type: 'button', class: 'small', onclick: ask }, T('Ask to allow this device')));
    async function ask() {
      let a; try { a = await api('/api/setup/ask', { body: {} }); } catch (err) { askBox.replaceChildren(el('p', { class: 'err' }, err.message)); setTimeout(askIdle, 6000); return; }
      if (a.done) return done();
      askBox.replaceChildren(el('h3', {}, T('Waiting to be allowed…')),
        el('p', { class: 'note' }, T('On the computer CasaTorch is installed on, open the setup page (it opened there when you installed, or go to http://localhost:8090 on it). It shows this request - check the number matches, then press Allow.')),
        el('p', { class: 'asknum' }, a.num), el('button', { type: 'button', class: 'small ghost', onclick: () => { stopped = true; askIdle(); } }, T('Cancel')));
      let stopped = false;
      const poll = async () => {
        if (stopped) return;
        let r; try { r = await api(`/api/setup/ask/${encodeURIComponent(a.id)}`); } catch { askBox.replaceChildren(el('p', { class: 'note' }, T('That request ran out after 5 minutes.'))); setTimeout(askIdle, 4000); return; }
        if (r.ok) return done();
        if (r.denied) { askBox.replaceChildren(el('p', { class: 'err' }, T('It was not allowed on the other computer.'))); setTimeout(askIdle, 5000); return; }
        setTimeout(poll, 2000);
      };
      setTimeout(poll, 2000);
    }
    if (['computer', 'addon'].includes(c.how)) askIdle();
    $('#page').replaceChildren(el('h1', {}, T('Enter your setup code')),
      el('p', { class: 'intro', id: 'codehelp' }, T('So only you can set up this CasaTorch - not anyone else on your network - setting up from this device needs your OK once: type the setup code, or allow this device from the computer CasaTorch runs on. Then set up right here.')),
      el('form', { class: 'codeform', onsubmit: go2 }, input, el('button', { type: 'submit', class: 'primary' }, T('Continue'))), msg,
      ['computer', 'addon'].includes(c.how) ? askBox : null,
      el('div', { class: 'card' }, el('h3', {}, T('Where is it?')), ...(WHERE[c.how] || WHERE.computer).map((t) => el('p', { class: 'note' }, T(t)))),
      el('p', { class: 'note' }, `${T('Still stuck? E-mail')} `, el('a', { href: 'mailto:support@casatorch.com' }, 'support@casatorch.com'), '.'));   // scrub-ok: public support address
    input.focus();
  });
  foot.style.display = '';
}
/* On the computer CasaTorch runs on: set up from a phone instead by scanning this. */
function phoneCard() {
  if (!W.phone?.code) return null;
  const q = el('div', { class: 'qr', role: 'img', 'aria-label': 'QR code that opens setup on your phone' }); if (W.phone.qr) q.innerHTML = W.phone.qr;   // made by this CasaTorch
  return el('details', { class: 'card phonedetails' }, el('summary', {}, T('Prefer to set up on your phone or another computer?')),
    el('div', { class: 'phonecard' }, W.phone.qr ? q : null, el('div', {},
      el('p', { class: 'note' }, T('You can set up right here, or on any device on your home Wi-Fi. Scan this with your phone\'s camera and setup opens there with your setup code filled in.')),
      el('p', { class: 'note' }, `${T('Setup code')}: `, el('b', { class: 'code' }, W.phone.code), ` - ${T('or, on the other device, choose Ask to allow this device and press Allow here.')}`))));
}
/* On the computer CasaTorch runs on: another device asking to set up shows here, to allow or not. */
let askPolling = false;
function watchAsks() {
  if (askPolling || !W.phone?.code) return; askPolling = true;
  const bar = el('div', { class: 'askbar', role: 'status', 'aria-live': 'polite' }); document.body.append(bar);
  const tick = async () => {
    let r; try { r = await api('/api/setup/asks'); } catch { r = { asks: [] }; }
    const a = (r.asks || [])[0];
    if (!a) bar.replaceChildren(); else bar.replaceChildren(el('div', {}, el('b', {}, `${a.what} ${T('wants to set up CasaTorch')}`), el('div', { class: 'note' }, `${T('Number')}: `, el('b', { class: 'asknum small' }, a.num), ` - ${T('only allow it if that\'s you and the number matches.')}`)),
      el('button', { type: 'button', class: 'primary small', onclick: async () => { await api(`/api/setup/asks/${encodeURIComponent(a.id)}`, { body: { allow: true } }).catch(() => {}); tick(); } }, T('Allow')),
      el('button', { type: 'button', class: 'ghost small', onclick: async () => { await api(`/api/setup/asks/${encodeURIComponent(a.id)}`, { body: { allow: false } }).catch(() => {}); tick(); } }, T('Don\'t allow')));
    setTimeout(tick, 2500);
  };
  tick();
}
(async () => {
  await setupCodeGate();
  watchAsks();
  const st = await api('/api/setup/state');
  if (!st.open) { $('#page').replaceChildren(el('h1', {}, 'CasaTorch is already set up'), el('p', {}, el('a', { href: '/' }, 'Open the dashboard'))); document.querySelector('footer').hidden = true; return; }
  W.cat = await api('/api/setup/catalog');
  if (st.configured && !st.demo) { const cur = await api('/api/setup/current').catch(() => null); if (cur?.answers) { W.rerun = true; W.a = cur.answers; W.keeps = cur.keeps || {}; if (cur.ha) { W.ha = cur.ha; W.haDomains = cur.ha.domains || []; W.a.homeassistant._test = cur.ha; } } }
  W.steps = W.cat.steps; W.demo = !!st.demo;
  const linked = W.linked = new URLSearchParams(location.search).has('step');
  // Picking up where you left off (not when Connect opened setup at one item - that's its own short visit).
  const pr = linked || st.demo ? null : (await api('/api/setup/progress').catch(() => null))?.progress;
  if (pr?.answers && !!pr.rerun === !!W.rerun) {
    W.a = { ...W.a, ...pr.answers }; W.added = pr.added || []; W.max = Math.min(pr.max || 0, W.steps.length + 1); W.i = Math.min(pr.i || 0, W.steps.length + 1); W.resumed = pr.at;
    if (pr.ui?.hue) W.hue = pr.ui.hue;
    if (pr.ui?.ring) W.ring = pr.ui.ring;
    if (pr.ui?.ha && pr.haOk) { W.ha = pr.ui.ha; W.haDomains = W.ha.domains || []; }
    else if (!pr.haOk && !W.rerun && W.a.homeassistant) { const sub = W.a.homeassistant; delete sub._signedIn; delete sub._test; }   // CasaTorch restarted before it was proven: connect again
  }
  focusFromLink();
  W.ready = true;
  go();
  // Look for gear on the network in the background; whatever turns up is filled in on its step.
  if (!st.demo) api('/api/setup/discover').then((f) => { W.found = f; const busy = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName); const cur = W.steps[W.i - 1]?.id; if (!busy && ['homeassistant', 'cameras', 'controls', 'sensors', 'energy', 'network'].includes(cur)) go(); }).catch(() => {});
})();
/* Opened from Connect in the dashboard (/setup.html?step=controls&add=hue-local): go straight to that
   step with that item already picked, then straight to Review & save. */
function focusFromLink() {
  const qp = new URLSearchParams(location.search), stepId = qp.get('step'), addId = qp.get('add') || '';
  const k = W.steps.findIndex((s) => s.id === stepId); if (k < 0) return;
  const step = W.steps[k], store = ans(step.id), q = step.question;
  let label = step.title, full = null;
  if (q) {
    if (step.id === 'network') {
      if (addId.startsWith('dns:')) { store.dns = addId.slice(4); store.kind ||= 'other'; label = addId.slice(4) === 'pihole' ? 'Pi-hole' : 'AdGuard Home'; }
      else if (q.options.some(([v]) => v === addId)) { store.kind = addId; label = q.options.find(([v]) => v === addId)[1]; }
    } else if (step.id === 'homeassistant') { store.uses = 'yes'; label = 'Home Assistant'; }
    else {
      const yes = q.options.find(([v]) => v === 'yes')?.[0]; if (yes) store[q.id] = yes;
      const pick = step.branches?.yes?.pick, opt = pick?.options.find((o) => o.id === addId);
      if (opt) { const cur = new Set(store[pick.id] || []); cur.add(opt.id); store[pick.id] = [...cur]; full = opt.label; label = opt.label.replace(/\s*\(through Home Assistant\)/, ''); }
      if (addId === 'utility') label = 'your power company';
    }
  }
  W.focus = { step: step.id, label, full };
  W.i = k + 1;
  setTimeout(() => { const card = [...document.querySelectorAll('#page .card h3')].find((h) => h.textContent.startsWith(label) || (full && h.textContent.startsWith(T(full)))); card?.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
}
