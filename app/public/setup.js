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
const api = async (url, opts = {}) => {
  const r = await fetch(url, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !('ok' in j) && !j.type) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};
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
  const set = (v) => { store[f.id] = v; onChange?.(); };
  let input;
  if (f.type === 'choice') {
    input = el('select', { id, onchange: (e) => set(e.target.value) }, ...f.options.map(([v, l]) => el('option', { value: v, selected: store[f.id] === v }, l)));
  } else if (f.type === 'multi') {
    const cur = new Set(store[f.id] || []);
    return el('div', { class: 'field' }, el('label', {}, f.label), el('div', { class: 'opts' }, ...f.options.map(([v, l]) => {
      const b = el('button', { type: 'button', class: `opt${cur.has(v) ? ' on' : ''}`, onclick: () => { cur.has(v) ? cur.delete(v) : cur.add(v); store[f.id] = [...cur]; b.classList.toggle('on'); } }, l);
      return b;
    })));
  } else if (f.type === 'consent') {
    return el('div', { class: 'field' }, el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: store[f.id] === true, onchange: (e) => set(e.target.checked) }),
      el('span', {}, f.label, ' ', el('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, 'Terms'), ' · ', el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy'))));
  } else if (f.type === 'textarea') {
    input = el('textarea', { id, rows: 3, spellcheck: 'false', oninput: (e) => set(e.target.value.trim()) }, store[f.id] || '');
  } else if (f.type === 'timezone') {
    const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [store[f.id]]);
    input = el('select', { id, onchange: (e) => set(e.target.value) }, ...zones.map((z) => el('option', { value: z, selected: z === store[f.id] }, z)));
  } else {
    const type = f.type === 'password' || f.type === 'pin' ? 'password' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text';
    input = el('input', { id, type, value: store[f.id] ?? '', placeholder: f.placeholder || null, step: f.step || null, inputmode: f.type === 'pin' ? 'numeric' : null, autocomplete: type === 'password' ? 'new-password' : 'off', oninput: (e) => set(e.target.value) });
  }
  return el('div', { class: 'field' }, el('label', { for: id }, f.label, f.required || ['choice', 'multi', 'timezone'].includes(f.type) || /optional/i.test(f.label) ? '' : ' (optional)'), input, f.help ? el('div', { class: 'help' }, f.help) : null);
}
/* A field that others depend on (showIf) redraws the page when it changes. */
function fieldsEl(fields, store, rerender) {
  const drivers = new Set((fields || []).flatMap((g) => Object.keys(g.showIf || {})));
  return (fields || []).filter((f) => visible(f, store)).map((f) => fieldEl(f, store, drivers.has(f.id) ? rerender : null));
}


/* ---------- the "your day" questions: town, calendars, teams, headlines, reminders ---------- */
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const COLORS = [['#60a5fa', 'Blue'], ['#34d399', 'Green'], ['#fbbf24', 'Yellow'], ['#f87171', 'Red'], ['#c084fc', 'Purple'], ['#f472b6', 'Pink']];
const CUSTOM = {
  location(f, store) {
    const box = el('div', { class: 'field' }, el('label', {}, f.label));
    const cur = store[f.id];
    const q = el('input', { type: 'text', placeholder: 'Town, ZIP code, or latitude, longitude', value: '' });
    const results = el('div', { class: 'results' });
    const pick = (p) => { store[f.id] = p; go(); };
    const find = async () => {
      const ll = q.value.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
      if (ll) { pick({ name: `${ll[1]}, ${ll[2]}`, lat: Number(ll[1]), lon: Number(ll[2]) }); return; }
      results.replaceChildren(el('div', { class: 'note' }, 'Looking...'));
      try { const r = await api(`/api/setup/geocode?q=${encodeURIComponent(q.value)}`); results.replaceChildren(...(r.places.length ? r.places.map((p) => el('button', { type: 'button', class: 'small', onclick: () => pick(p) }, p.name)) : [el('div', { class: 'note' }, 'No match - try the nearest bigger town.')])); }
      catch (e) { results.replaceChildren(el('div', { class: 'err' }, e.message)); }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    if (cur?.lat != null) box.append(el('div', { class: 'ok' }, `✓ ${cur.name || `${cur.lat}, ${cur.lon}`}`));
    box.append(el('div', { class: 'row' }, el('div', { style: 'flex:1;min-width:180px' }, q), el('button', { type: 'button', class: 'small', onclick: find }, 'Find'),
      navigator.geolocation ? el('button', { type: 'button', class: 'small', onclick: () => navigator.geolocation.getCurrentPosition((g) => pick({ name: 'This location', lat: Math.round(g.coords.latitude * 1e4) / 1e4, lon: Math.round(g.coords.longitude * 1e4) / 1e4 }), () => results.replaceChildren(el('div', { class: 'note' }, 'The browser did not share a location - search instead.'))) }, 'Use this device\'s location') : null), results);
    if (f.help) box.append(el('div', { class: 'help' }, f.help));
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
    const picks = new Set(store[f.id] ||= []);
    const custom = store.custom ||= [];
    const box = el('div', {}, el('div', { class: 'opts' }));
    api('/api/setup/news/defaults').then((r) => box.firstChild.append(...r.feeds.map((d) => { const b = el('button', { type: 'button', class: `opt${picks.has(d.id) ? ' on' : ''}`, onclick: () => { picks.has(d.id) ? picks.delete(d.id) : picks.add(d.id); store[f.id] = [...picks]; b.classList.toggle('on'); } }, d.name); return b; }))).catch(() => {});
    custom.forEach((c, k) => box.append(el('div', { class: 'item' }, el('div', { class: 'grid2' }, fieldEl({ id: 'name', label: 'Name', type: 'text', required: true }, c), fieldEl({ id: 'url', label: 'RSS or Atom feed address', type: 'url', required: true }, c)), el('div', { class: 'row' }, testEl('feed', c, 'Check it'), el('button', { type: 'button', class: 'small', onclick: () => { custom.splice(k, 1); go(); } }, 'Remove')))));
    box.append(el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { type: 'button', class: 'small', onclick: () => { custom.push({ name: '', url: '' }); go(); } }, 'Add a feed (local news, a blog...)')));
    return box;
  },
  reminders(f, store) {
    const list = store[f.id] ||= [];
    const box = el('div', {});
    list.forEach((r, k) => {
      const days = new Set(r.days ||= [0, 1, 2, 3, 4, 5, 6]);
      box.append(el('div', { class: 'item' }, fieldEl({ id: 'title', label: 'Reminder', type: 'text', placeholder: 'Trash night - bins out', required: true }, r),
        el('div', { class: 'row' }, el('div', { class: 'days' }, ...DAYS.map((d, n) => { const b = el('button', { type: 'button', class: days.has(n) ? 'on' : '', 'aria-label': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n], onclick: () => { days.has(n) ? days.delete(n) : days.add(n); r.days = [...days].sort(); b.classList.toggle('on'); } }, d); return b; })),
          el('input', { type: 'time', value: r.time || '', style: 'width:auto', oninput: (e) => { r.time = e.target.value; } }), el('button', { type: 'button', class: 'small', onclick: () => { list.splice(k, 1); go(); } }, 'Remove'))));
    });
    box.append(el('div', { class: 'row' }, el('button', { type: 'button', class: 'small', onclick: () => { list.push({ title: '', days: [0, 1, 2, 3, 4, 5, 6] }); go(); } }, 'Add a reminder'),
      list.length ? null : el('button', { type: 'button', class: 'small', onclick: () => { list.push({ title: 'Trash night - bins out', days: [2], time: '20:00' }); go(); } }, 'Example: trash night')));
    return box;
  },
};

/* ---------- Home Assistant: find it, then sign in on its own page - no token to copy ---------- */
function haSigninEl(sub) {
  const box = el('div', { class: 'card' });
  const msg = el('div', { class: 'note' });
  if (sub._signedIn && W.ha) { box.append(el('div', { class: 'ok' }, `✓ ${W.ha.message}`), el('p', { class: 'note' }, 'CasaTorch made its own access token in Home Assistant (named "CasaTorch"). You can see or remove it there under Profile > Security.'),
    el('button', { type: 'button', class: 'small', onclick: () => { sub._signedIn = false; W.ha = null; go(); } }, 'Use a different Home Assistant')); return box; }
  const url = el('input', { type: 'url', placeholder: 'http://homeassistant.local:8123', value: sub.url || '', 'aria-label': 'Home Assistant address', oninput: (e) => { sub.url = e.target.value.trim(); } });
  const find = el('button', { type: 'button', class: 'small', onclick: async () => {
    find.disabled = true; msg.textContent = 'Looking on your network…';
    const r = await api('/api/setup/ha/find').catch(() => ({}));
    if (r.url) { sub.url = r.url; url.value = r.url; msg.textContent = `Found it at ${r.url}.`; } else msg.textContent = 'Couldn\'t find it by itself - type its address (the one you open Home Assistant with).';
    find.disabled = false;
  } }, 'Find it');
  const go2 = el('button', { type: 'button', class: 'primary', onclick: async () => {
    if (!sub.url) { msg.textContent = 'Type the address first, or press Find it.'; return; }
    const win = window.open('about:blank', 'ha-signin', 'width=520,height=720');
    try {
      const r = await api('/api/setup/ha/signin', { body: { url: sub.url } });
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
function testEl(kind, store, label = 'Test connection') {
  const out = el('div', { class: 'note' });
  const show = (r) => {
    out.replaceChildren(r.ok ? el('span', { class: 'ok' }, `✓ ${r.message || 'Connected'}`) : el('span', { class: 'err' }, `✗ ${r.error}`));
    if (r.ok && r.choose) {
      if (store[r.choose.id] === undefined) store[r.choose.id] = r.choose.options[0][0];
      out.append(fieldEl({ id: r.choose.id, label: r.choose.label, type: 'choice', options: r.choose.options }, store));
    }
  };
  const btn = el('button', { type: 'button', class: 'small', onclick: async () => {
    btn.disabled = true; out.replaceChildren('Checking…');
    try {
      const body = Object.fromEntries(Object.entries(store).filter(([k]) => !k.startsWith('_')));
      const r = await api(`/api/setup/test/${kind}`, { body });
      store._test = r;
      if (kind === 'homeassistant' && r.ok) { W.ha = r; W.haDomains = r.domains || []; }
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
    if (v.type === 'external') { box.append(el('p', { class: 'note' }, 'Finish signing in on the page that opens, then come back.'), el('div', { class: 'row' }, el('a', { href: v.url, target: '_blank', rel: 'noopener' }, 'Open the sign-in page'), el('button', { type: 'button', class: 'small', onclick: () => send({}) }, 'I\'ve signed in'))); return; }
    if (v.type === 'progress') { box.append(el('p', { class: 'note' }, 'Home Assistant is working on it…')); setTimeout(() => send({}), 3000); return; }
    if (v.type === 'menu') {
      const opts = Array.isArray(v.menu) ? v.menu.map((m) => [m, pretty(m)]) : Object.entries(v.menu || {});
      box.append(el('p', { class: 'q' }, 'Choose one:'), el('div', { class: 'opts' }, ...opts.map(([id, l]) => el('button', { type: 'button', class: 'opt', onclick: () => send({ next_step_id: id }) }, l))));
      return;
    }
    const fields = (v.fields || []).map(schemaField).filter(Boolean);
    const input = state.input;
    if (hint) box.append(el('p', { class: 'note' }, hint));
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
  const card = el('div', { class: 'card' }, el('h3', {}, opt.label, badge(opt)));
  if (opt.method === 'hue') return hueEl(card);
  if (opt.method === 'ring') return ringEl(card);
  if (opt.method === 'ha' || opt.method === 'ha-ui') {
    if (!W.ha) { card.append(el('div', { class: 'warn' }, 'Needs Home Assistant. Connect it in the Home Assistant step, or add this later from Settings.')); return card; }
    const added = W.added.find((x) => x.domain === opt.domain);
    if (W.haDomains.includes(opt.domain) || added) { card.append(el('div', { class: 'ok' }, added ? `✓ Added to Home Assistant: ${added.title}` : '✓ Already in Home Assistant')); return card; }
    if (opt.method === 'ha-ui') {
      card.append(el('p', { class: 'note' }, opt.hint || 'This one signs in on a page only Home Assistant can show.'),
        el('button', { type: 'button', class: 'small', onclick: async () => { const r = await api(`/api/setup/ha/link?domain=${opt.domain}`); window.open(r.url, '_blank', 'noopener'); } }, 'Set it up in Home Assistant'));
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
    card.append(...fieldsEl(opt.fields, sub, go));
    if (opt.test) card.append(testEl(opt.test, sub));
    return card;
  }
  if (opt.method === 'guide') card.append(el('pre', {}, W.cat.guides[opt.guide] || ''));
  return card;
}

/* ---------- pages ---------- */
function welcome() {
  if (W.rerun) { const k = Object.entries(W.keeps).filter(([, v]) => v).map(([n]) => n); return [el('h1', {}, 'Change your setup'), el('p', { class: 'intro' }, `Your current answers are filled in. Anything you don't change is kept${k.length ? `, including what's already connected (${k.join(', ')})` : ''}.`)]; }
  return [el('h1', {}, 'Welcome to CasaTorch'),
    el('p', { class: 'intro' }, 'About 10 minutes. First the everyday things - your town for the weather, calendars, teams, headlines, reminders. Then your gear: CasaTorch connects to Hue, Shelly, YoLink, Frigate, Reolink and Ring itself, and to thousands more through Home Assistant if you have it. Skip anything; add it later.'),
    el('p', { class: 'note' }, 'Stuck at any point? Ask in the CasaTorch community: ', el('a', { href: 'https://casatorch.com/discord', target: '_blank', rel: 'noopener' }, 'casatorch.com/discord'), '.'),
    el('div', { class: 'card' }, el('h3', {}, 'Just looking?'), el('p', { class: 'note' }, 'See CasaTorch with a sample house, including the 3D floor plan. No setup needed.'),
      el('button', { type: 'button', class: 'small', onclick: async () => { await api('/api/setup/demo', { body: {} }); location.href = '/'; } }, 'Try the demo'))];
}
/* Where a step's branch keeps its answers: the network step keeps each kind's own (meraki, unifi). */
const branchStore = (step, store) => (step.id === 'network' && step.branches?.[store.kind]?.fields ? (store[store.kind] ||= {}) : store);
function stepPage(step) {
  const store = ans(step.id);
  const out = [el('h1', {}, step.title)];
  if (W.focus?.step === step.id) out.push(el('div', { class: 'focus-note' }, el('b', {}, W.focus.label ? `Adding ${W.focus.label}` : 'Picking up where you left off'), el('span', {}, ' - follow the card below. When you see a green check, press "Review & save". Everything else in your setup stays as it is.')));
  if (step.intro) out.push(el('p', { class: 'intro' }, step.intro));
  if (step.question) {
    const q = step.question;
    out.push(el('div', { class: 'q' }, q.label), el('div', { class: 'opts' }, ...q.options.map(([v, l]) => el('button', { type: 'button', class: `opt${store[q.id] === v ? ' on' : ''}`, onclick: () => { store[q.id] = v; go(); } }, l))));
    const br = step.branches?.[store[q.id]];
    if (br) {
      if (br.note) out.push(el('p', { class: 'note' }, br.note));
      if (br.guide) out.push(el('pre', {}, W.cat.guides[br.guide] || ''));
      const sub = branchStore(step, store);
      // Questions that follow a pick (alerts for people? a budget?) come after it.
      const late = !!(br.pick || br.provider);
      if (step.id === 'homeassistant' && store[q.id] === 'yes') out.push(haSigninEl(sub));
      if (br.fields && !late && !(step.id === 'homeassistant' && sub._signedIn)) out.push(...fieldsEl(br.fields, sub, go));
      if (br.test && !(step.id === 'homeassistant' && sub._signedIn)) out.push(testEl(br.test, sub));
      if (br.provider) out.push(utilityEl(br.provider, store));
      if (br.pick) {
        const p = br.pick, cur = new Set(store[p.id] || []);
        const shown = shownOptions(p.options);
        out.push(el('div', { class: 'q' }, p.label), el('div', { class: 'opts' }, ...shown.map((o) => el('button', { type: 'button', class: `opt${cur.has(o.id) ? ' on' : ''}`, onclick: () => { cur.has(o.id) ? cur.delete(o.id) : cur.add(o.id); store[p.id] = [...cur]; go(); } }, o.label, badge(o), o.desc ? el('small', {}, o.desc) : null))));
        for (const o of shown) if (cur.has(o.id)) out.push(setupFor(step.id, o));
      }
      if (br.fields && late) out.push(...fieldsEl(br.fields, sub, go));
    }
  }
  if (step.fields) out.push(...fieldsEl(step.id === 'account' && W.rerun ? step.fields.map((f) => (f.id === 'password' ? { ...f, required: false, label: 'New password (leave empty to keep the current one)' } : f)) : step.fields, store, go));
  if (step.id === 'account') out.push(claimEl(store));
  if (step.help) out.push(el('details', { class: 'card' }, el('summary', {}, 'Where do I find the link?'), el('p', { class: 'note' }, step.help)));
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
  const card = el('div', { class: 'card' }, el('h3', {}, p.label, el('span', { class: 'badge ha' }, W.ha ? 'via Home Assistant' : 'needs Home Assistant')), W.ha ? el('p', { class: 'note' }, p.help) : null);
  if (store.utility === 'other') { card.append(el('div', { class: 'note' }, 'OK - enter your price per kWh below.'), W.ha ? el('button', { type: 'button', class: 'small', onclick: () => { store.utility = null; go(); } }, 'Look again') : null); return card; }
  if (store.utility) { card.append(el('div', { class: 'ok' }, `✓ ${store.utility} - connected through Home Assistant`)); return card; }
  if (!W.ha) { store.utility = 'other'; card.append(el('div', { class: 'warn', style: 'margin:6px 0' }, '\u26A0 Needs Home Assistant - you skipped it, so CasaTorch can\'t sign in to your power company.'), el('div', { class: 'note' }, 'You can still see costs: CasaTorch adds up your smart plugs and uses the price per kWh you enter below (it\'s on your bill). To get your real bill and usage later, connect Home Assistant from Settings > Run setup again.')); return card; }
  if (W.haDomains.includes(p.domain)) { store.utility = 'Your power company'; card.append(el('div', { class: 'ok' }, '✓ Your power company is already connected in Home Assistant')); return card; }
  const f = flowEl(p.domain, null, (title) => { store.utility = title; go(); }, (cancel) => el('button', { type: 'button', class: 'small', onclick: () => { store.utility = 'other'; cancel(); } }, p.otherLabel));
  if (W.flows[p.domain]?.view) f.render();
  else card.append(el('div', { class: 'row' }, el('button', { type: 'button', class: 'small', onclick: (e) => { e.target.parentElement.remove(); f.start(); } }, 'Find my power company'), el('button', { type: 'button', class: 'small', onclick: () => { store.utility = 'other'; go(); } }, p.otherLabel)));
  card.append(f.el);
  return card;
}
const labelsOf = (step, ids) => (ids || []).map((id) => W.steps.find((s) => s.id === step)?.branches?.yes?.pick?.options.find((o) => o.id === id)?.label || id).join(', ');
function review() {
  const a = W.a, dl = el('dl', { class: 'review' });
  const add = (k, v) => dl.append(el('dt', {}, k), el('dd', {}, v || '-'));
  add('Home', `${a.house?.name} · ${a.house?.timezone} · °${a.house?.units} · ${a.house?.currency}`);
  add('Weather for', a.house?.location?.name || 'not set');
  add('Login', `${a.account?.username}${a.account?.license ? ' · Pro key entered' : ''}`);
  add('Calendars', (a.calendars?.list || []).filter((c) => c.url).map((c) => c.name).join(', ') || 'none');
  add('Teams', (a.sports?.teams || []).map((t) => t.name).join(', ') || 'none');
  add('Headlines', `${(a.news?.picks || []).length + (a.news?.custom || []).filter((c) => c.url).length} source(s)`);
  add('Reminders', (a.reminders?.list || []).filter((r) => r.title).map((r) => r.title).join(', ') || 'none');
  add('Home Assistant', W.ha ? W.ha.message : a.homeassistant?.uses === 'yes' ? 'not connected' : 'not used');
  if (W.added.length) add('Added to Home Assistant', W.added.map((x) => x.title).join(', '));
  add('Cameras', a.cameras?.has === 'yes' ? labelsOf('cameras', a.cameras.kinds) : 'none');
  add('Lights, locks, climate', a.controls?.has === 'yes' ? labelsOf('controls', a.controls.kinds) : 'none');
  add('Sensors', a.sensors?.has === 'yes' ? labelsOf('sensors', a.sensors.kinds) : 'none');
  add('Network', `${W.steps.find((s) => s.id === 'network')?.question.options.find(([v]) => v === a.network?.kind)?.[1] || '-'}${a.network?.dns && a.network.dns !== 'none' ? ` · ${a.network.dns}` : ''}`);
  add('Energy', a.energy?.track === 'yes' ? `${a.energy.utility === 'other' || !a.energy.utility ? `${a.energy.rate || '?'} per kWh` : a.energy.utility}${a.energy.budget ? ` · budget ${a.energy.budget}/month` : ''}${a.energy.kinds?.length ? ` · ${labelsOf('energy', a.energy.kinds)}` : ''}` : 'off');
  return [el('h1', {}, 'All set?'), el('p', { class: 'intro' }, 'Check this over. Finish saves it and opens your dashboard; you can change anything later in Settings.'), dl, el('div', { id: 'finishMsg' })];
}

/* ---------- navigation ---------- */
function problems(step) {
  if (!step) return null;
  const store = ans(step.id);
  if (step.question && !store[step.question.id]) return 'Pick an answer to continue.';
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
  const pages = ['Welcome', ...W.steps.map((s) => s.title), 'Review'];
  $('#progress').replaceChildren(...pages.map((t, k) => el('li', { class: k === W.i ? 'on' : k < W.i ? 'done' : '' }, t)));
  $('#page').replaceChildren(...(W.i === 0 ? welcome() : W.i > W.steps.length ? review() : stepPage(W.steps[W.i - 1])));
  $('#back').disabled = W.i === 0;
  $('#next').textContent = W.i === 0 ? 'Set up my home' : W.i > W.steps.length ? (W.focus ? 'Save' : 'Finish') : W.focus && W.steps[W.i - 1]?.id === W.focus.step ? 'Review & save' : 'Next';
}
$('#back').onclick = () => { if (W.i > 0) { W.i--; go(); scrollTo(0, 0); } };
$('#next').onclick = async () => {
  if (W.i > W.steps.length) {
    const msg = $('#finishMsg'); msg.replaceChildren('Saving…');
    try { const r = await api('/api/setup/finish', { body: { answers: { ...W.a, _added: W.added } } }); if (r.ok) { location.href = W.focus ? '/#connect' : '/'; return; } msg.replaceChildren(el('div', { class: 'err' }, r.error)); }
    catch (e) { msg.replaceChildren(el('div', { class: 'err' }, e.message)); }
    return;
  }
  const p = problems(W.steps[W.i - 1]);
  if (p) { $('#navmsg').textContent = p; return; }
  W.i = W.focus && W.steps[W.i - 1]?.id === W.focus.step ? W.steps.length + 1 : W.i + 1; go(); scrollTo(0, 0);
};
(async () => {
  const st = await api('/api/setup/state');
  if (!st.open) { $('#page').replaceChildren(el('h1', {}, 'CasaTorch is already set up'), el('p', {}, el('a', { href: '/' }, 'Open the dashboard'))); document.querySelector('footer').hidden = true; return; }
  W.cat = await api('/api/setup/catalog');
  if (st.configured && !st.demo) { const cur = await api('/api/setup/current').catch(() => null); if (cur?.answers) { W.rerun = true; W.a = cur.answers; W.keeps = cur.keeps || {}; if (cur.ha) { W.ha = cur.ha; W.haDomains = cur.ha.domains || []; W.a.homeassistant._test = cur.ha; } } }
  W.steps = W.cat.steps;
  focusFromLink();
  go();
})();
/* Opened from Connect in the dashboard (/setup.html?step=controls&add=hue-local): go straight to that
   step with that item already picked, then straight to Review & save. */
function focusFromLink() {
  const qp = new URLSearchParams(location.search), stepId = qp.get('step'), addId = qp.get('add') || '';
  const k = W.steps.findIndex((s) => s.id === stepId); if (k < 0) return;
  const step = W.steps[k], store = ans(step.id), q = step.question;
  let label = step.title;
  if (q) {
    if (step.id === 'network') {
      if (addId.startsWith('dns:')) { store.dns = addId.slice(4); store.kind ||= 'other'; label = addId.slice(4) === 'pihole' ? 'Pi-hole' : 'AdGuard Home'; }
      else if (q.options.some(([v]) => v === addId)) { store.kind = addId; label = q.options.find(([v]) => v === addId)[1]; }
    } else if (step.id === 'homeassistant') { store.uses = 'yes'; label = 'Home Assistant'; }
    else {
      const yes = q.options.find(([v]) => v === 'yes')?.[0]; if (yes) store[q.id] = yes;
      const pick = step.branches?.yes?.pick, opt = pick?.options.find((o) => o.id === addId);
      if (opt) { const cur = new Set(store[pick.id] || []); cur.add(opt.id); store[pick.id] = [...cur]; label = opt.label.replace(/\s*\(through Home Assistant\)/, ''); }
      if (addId === 'utility') label = 'your power company';
    }
  }
  W.focus = { step: step.id, label };
  W.i = k + 1;
  setTimeout(() => { const card = [...document.querySelectorAll('#page .card h3')].find((h) => h.textContent.startsWith(label)); card?.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
}
