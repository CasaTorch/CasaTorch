/* HouseOS setup wizard. The questions come from /api/setup/catalog
   (app/catalog/setup.json); this file only knows how to ask them.
   Integrations are added to Home Assistant by running that integration's own
   setup ("config flow"): Home Assistant sends its questions, we show them. */
const W = { cat: null, steps: [], i: 0, a: {}, ha: null, haDomains: [], added: [], tests: {}, flows: {} };
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

/* One picked option of a "pick all that apply" list: how it gets set up. */
function setupFor(stepId, opt) {
  const store = ans(stepId);
  const card = el('div', { class: 'card' }, el('h3', {}, opt.label));
  if (opt.method === 'ha' || opt.method === 'ha-ui') {
    if (!W.ha) { card.append(el('div', { class: 'warn' }, 'Needs Home Assistant - connect it in the Home Assistant step first.')); return card; }
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
  return [el('h1', {}, 'Welcome to HouseOS'),
    el('p', { class: 'intro' }, 'This takes about 10 minutes. We\'ll ask what you have at home - Home Assistant, cameras, lights and locks, sensors, your network, your power company - and set each one up for you. Anything you skip can be added later.'),
    el('div', { class: 'card' }, el('h3', {}, 'Just looking?'), el('p', { class: 'note' }, 'See HouseOS with a sample house, no setup needed.'),
      el('button', { type: 'button', class: 'small', onclick: async () => { await api('/api/setup/demo', { body: {} }); location.href = '/'; } }, 'Try the demo'))];
}
/* Where a step's branch keeps its answers: the network step keeps each kind's own (meraki, unifi). */
const branchStore = (step, store) => (step.id === 'network' && step.branches?.[store.kind]?.fields ? (store[store.kind] ||= {}) : store);
function stepPage(step) {
  const store = ans(step.id);
  const out = [el('h1', {}, step.title)];
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
      if (br.fields && !late) out.push(...fieldsEl(br.fields, sub, go));
      if (br.test) out.push(testEl(br.test, sub));
      if (br.provider) out.push(utilityEl(br.provider, store));
      if (br.pick) {
        const p = br.pick, cur = new Set(store[p.id] || []);
        out.push(el('div', { class: 'q' }, p.label), el('div', { class: 'opts' }, ...p.options.map((o) => el('button', { type: 'button', class: `opt${cur.has(o.id) ? ' on' : ''}`, onclick: () => { cur.has(o.id) ? cur.delete(o.id) : cur.add(o.id); store[p.id] = [...cur]; go(); } }, o.label, o.desc ? el('small', {}, o.desc) : null))));
        for (const o of p.options) if (cur.has(o.id)) out.push(setupFor(step.id, o));
      }
      if (br.fields && late) out.push(...fieldsEl(br.fields, sub, go));
      if (br.agent) out.push(agentEl(store));
    }
  }
  if (step.fields) out.push(...fieldsEl(step.fields, store, go));
  if (step.id === 'network' && ['pihole', 'adguard'].includes(store.dns)) out.push(testEl(store.dns, store, `Test ${store.dns === 'pihole' ? 'Pi-hole' : 'AdGuard'}`));
  return out;
}
/* "Who is your power company?" - Home Assistant's own list (Opower), then its sign-in. */
function utilityEl(p, store) {
  const card = el('div', { class: 'card' }, el('h3', {}, p.label), el('p', { class: 'note' }, p.help));
  if (store.utility === 'other') { card.append(el('div', { class: 'note' }, 'OK - enter your price per kWh below.'), W.ha ? el('button', { type: 'button', class: 'small', onclick: () => { store.utility = null; go(); } }, 'Look again') : null); return card; }
  if (store.utility) { card.append(el('div', { class: 'ok' }, `✓ ${store.utility} - connected through Home Assistant`)); return card; }
  if (!W.ha) { store.utility = 'other'; card.append(el('div', { class: 'note' }, 'Without Home Assistant, enter your price per kWh below.')); return card; }
  if (W.haDomains.includes(p.domain)) { store.utility = 'Your power company'; card.append(el('div', { class: 'ok' }, '✓ Your power company is already connected in Home Assistant')); return card; }
  const f = flowEl(p.domain, null, (title) => { store.utility = title; go(); }, (cancel) => el('button', { type: 'button', class: 'small', onclick: () => { store.utility = 'other'; cancel(); } }, p.otherLabel));
  if (W.flows[p.domain]?.view) f.render();
  else card.append(el('div', { class: 'row' }, el('button', { type: 'button', class: 'small', onclick: (e) => { e.target.parentElement.remove(); f.start(); } }, 'Find my power company'), el('button', { type: 'button', class: 'small', onclick: () => { store.utility = 'other'; go(); } }, p.otherLabel)));
  card.append(f.el);
  return card;
}
function agentEl(store) {
  const out = el('div', {});
  if (store._agent) out.append(el('p', { class: 'note' }, 'Run this once on that server (SSH in, or paste it into its Docker / Container Manager):'), el('pre', {}, store._agent));
  const btn = el('button', { type: 'button', class: 'small', onclick: async () => {
    try { const r = await api('/api/setup/agent', { body: { address: store.address } }); store._agent = r.command; go(); }
    catch (e) { out.replaceChildren(el('div', { class: 'err' }, e.message)); }
  } }, store._agent ? 'Show it again' : 'Get the install command');
  return el('div', { class: 'card' }, el('h3', {}, 'The HouseOS agent'), el('p', { class: 'note' }, 'A small helper that lets HouseOS see the server\'s apps, drives, backups and UPS. It only reads, except when you press Restart or Update.'), store._agent ? null : btn, out);
}
const labelsOf = (step, ids) => (ids || []).map((id) => W.steps.find((s) => s.id === step)?.branches?.yes?.pick?.options.find((o) => o.id === id)?.label || id).join(', ');
function review() {
  const a = W.a, dl = el('dl', { class: 'review' });
  const add = (k, v) => dl.append(el('dt', {}, k), el('dd', {}, v || '-'));
  add('Home', `${a.house?.name} · ${a.house?.timezone} · °${a.house?.units} · ${a.house?.currency}`);
  add('Login', `${a.account?.username}${a.account?.pin ? ' · PIN set' : ''}`);
  add('Home Assistant', W.ha ? W.ha.message : a.homeassistant?.uses === 'yes' ? 'not connected' : 'not used');
  add('Added to Home Assistant', W.added.length ? W.added.map((x) => x.title).join(', ') : 'nothing new');
  add('Cameras', a.cameras?.has === 'yes' ? labelsOf('cameras', a.cameras.kinds) : 'none');
  add('Lights, locks, climate', a.controls?.has === 'yes' ? labelsOf('controls', a.controls.kinds) : 'none');
  add('Sensors', a.sensors?.has === 'yes' ? labelsOf('sensors', a.sensors.kinds) : 'none');
  add('Network', `${W.steps.find((s) => s.id === 'network')?.question.options.find(([v]) => v === a.network?.kind)?.[1] || '-'}${a.network?.dns && a.network.dns !== 'none' ? ` · ${a.network.dns}` : ''}`);
  add('Energy', a.energy?.track === 'yes' ? `${a.energy.utility === 'other' ? `${a.energy.rate || '?'} per kWh` : a.energy.utility || '-'}${a.energy.budget ? ` · budget ${a.energy.budget}/month` : ''}${a.energy.kinds?.length ? ` · ${labelsOf('energy', a.energy.kinds)}` : ''}` : 'off');
  add('Servers', a.servers?.has === 'yes' ? `${W.steps.find((s) => s.id === 'servers').branches.yes.fields[0].options.find(([v]) => v === a.servers.kind)?.[1] || a.servers.kind} at ${a.servers.address}` : 'none');
  return [el('h1', {}, 'All set?'), el('p', { class: 'intro' }, 'Check this over. Finish saves it and opens your dashboard; you can change anything later in Settings.'), dl, el('div', { id: 'finishMsg' })];
}

/* ---------- navigation ---------- */
function problems(step) {
  if (!step) return null;
  const store = ans(step.id);
  if (step.question && !store[step.question.id]) return 'Pick an answer to continue.';
  const br = step.question ? step.branches?.[store[step.question.id]] : null;
  const sub = br ? branchStore(step, store) : store;
  for (const [list, src] of [[step.fields, store], [br?.fields, sub]]) for (const f of (list || []).filter((g) => visible(g, src) && g.required)) {
    const v = src[f.id];
    if (v == null || v === '') return `${f.label} is needed.`;
    if (f.minLength && String(v).length < f.minLength) return `${f.label}: at least ${f.minLength} characters.`;
  }
  if (step.id === 'account' && store.pin && !/^\d{4,8}$/.test(store.pin)) return 'The PIN is 4 to 8 digits.';
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
  $('#next').textContent = W.i === 0 ? 'Set up my home' : W.i > W.steps.length ? 'Finish' : 'Next';
}
$('#back').onclick = () => { if (W.i > 0) { W.i--; go(); scrollTo(0, 0); } };
$('#next').onclick = async () => {
  if (W.i > W.steps.length) {
    const msg = $('#finishMsg'); msg.replaceChildren('Saving…');
    try { const r = await api('/api/setup/finish', { body: { answers: { ...W.a, _added: W.added } } }); if (r.ok) { location.href = '/'; return; } msg.replaceChildren(el('div', { class: 'err' }, r.error)); }
    catch (e) { msg.replaceChildren(el('div', { class: 'err' }, e.message)); }
    return;
  }
  const p = problems(W.steps[W.i - 1]);
  if (p) { $('#navmsg').textContent = p; return; }
  W.i++; go(); scrollTo(0, 0);
};
(async () => {
  const st = await api('/api/setup/state');
  if (!st.open) { $('#page').replaceChildren(el('h1', {}, 'HouseOS is already set up'), el('p', {}, el('a', { href: '/' }, 'Open the dashboard'))); document.querySelector('footer').hidden = true; return; }
  W.cat = await api('/api/setup/catalog');
  W.steps = W.cat.steps;
  go();
})();
