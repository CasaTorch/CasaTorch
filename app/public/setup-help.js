/* ======================================================================
 * Setup that keeps you going: loaded after setup.js, which calls in here.
 *
 *  - "Protect your CasaTorch": two-step sign-in right after the owner login
 *    (catalog step "protect", field type "protect"), strongly recommended,
 *    "Not now" allowed. The server side is 08t-setup-2fa.js, which uses the
 *    sign-in's own TOTP code (08-signin.js).
 *  - Where you are: "Step 3 of 19 · about 8 min left", under the step names.
 *  - What each step is for: "This unlocks: ..." under its title.
 *  - Help on every page: a "Learn more" link to the guide (CasaDocs, the one
 *    list of docs links: docs-links.js), and a way forward on every error.
 *  - Smart defaults: what setup found on the network is picked for you.
 *  - The end: what's ready, and the best next things to do.
 * Uses setup.js's own helpers (W, el, api, go, T). Nothing here is needed for
 * setup to work: if this file didn't load, setup still runs, just plainer.
 * ====================================================================== */
(() => {
  const doc = (key, opts) => (window.CasaDocs ? window.CasaDocs.link(key, opts) : null);
  /* Seconds a step usually takes (a step not listed: 45 s). */
  const SECS = { welcome: 60, house: 45, account: 60, protect: 120, phone: 60, calendars: 60, sports: 30, news: 30, reminders: 45, ai: 60, homeassistant: 90, cameras: 90, controls: 90, sensors: 45, network: 45, apptests: 45, energy: 60, alerts: 30, look: 30, themes: 30, review: 30 };
  /* The payoff, in a few words. */
  const UNLOCKS = {
    house: 'The weather, the right time and costs in your currency, on every screen.',
    account: 'Your own private dashboard - only people you add can sign in.',
    protect: 'A lock that a stolen password can\'t open.',
    phone: 'CasaTorch on your phone, with alerts wherever you are.',
    calendars: 'Today\'s events on the Home screen and one calendar for the family.',
    sports: 'Live scores and next games on the Home screen.',
    news: 'Headlines from your town and the world, in your language.',
    reminders: 'Reminders that pop up on every screen at the right time.',
    ai: 'Your Home AI Agent: ask about your home in plain words.',
    homeassistant: 'Everything in your Home Assistant - every light, sensor, lock and room - as ready-made widgets.',
    cameras: 'Live cameras on the Home, Cameras and Security pages.',
    controls: 'Lights, plugs, locks and thermostats you switch with a tap.',
    sensors: 'Alerts the moment there\'s a leak, smoke or a low battery.',
    network: 'Internet status and speed tests - and with a key, every device on your network.',
    apptests: 'How fast your apps answer from home, and where it slows down.',
    energy: 'What your home uses and what it costs, live.',
    alerts: 'Quiet nights: only critical alerts during quiet hours.',
    look: 'Your own look on every screen.', themes: 'Your own look on every screen.',
  };
  const secs = (id) => SECS[id] ?? 45;

  /* ---------- where you are: step k of n, about m minutes left ---------- */
  function progress() {
    let bar = $('#meter');
    if (!bar) { bar = el('div', { id: 'meter', class: 'meter', role: 'status', 'aria-live': 'polite' }); $('#progress').after(bar); }
    const total = W.steps.length, i = W.i;
    const left = Math.max(1, Math.round((W.steps.slice(Math.max(0, i - 1)).reduce((s, x) => s + secs(x.id), 0) + secs('review')) / 60));
    if (i > total && !W.p2fa && !W.demo) api('/api/setup/2fa').then((r) => { W.p2fa ||= { ...r, started: false }; }).catch(() => {});   // for the end: is two-step sign-in on?
    const key = i === 0 ? 'setup.welcome' : i > total ? 'setup.review' : `setup.${W.steps[i - 1].id}`;
    const pct = i === 0 ? 0 : Math.min(100, Math.round(((i - 1) / total) * 100));
    let text;
    if (W.focus) text = T('Change one step, then Review & save');
    else if (i === 0) text = T('{n} short steps · about {m} min · skip anything', { n: total, m: left });
    else if (i > total) text = T('Last step - check it over and finish');
    else text = `${T('Step {k} of {n}', { k: i, n: total })} · ${left <= 1 ? T('about a minute left') : T('about {m} min left', { m: left })}`;
    bar.replaceChildren(...[el('div', { class: 'meter-row' }, el('span', {}, text), doc(key)),
      W.focus ? null : el('div', { class: 'meter-track', 'aria-hidden': 'true' }, el('i', { style: `width:${i > total ? 100 : pct}%` }))].filter(Boolean));
  }
  /* ---------- under each step's title: what it unlocks; smart defaults from what was found ---------- */
  function top(step, store) {
    const out = [];
    if (UNLOCKS[step.id] && !W.focus) out.push(el('p', { class: 'unlocks' }, el('b', {}, T('This unlocks:')), ' ', T(UNLOCKS[step.id])));
    smart(step, store, out);
    return out;
  }
  /* Picked for you from the network look (setup.js keeps it in W.found) - once, and only when nothing is answered yet. */
  function smart(step, store, out) {
    if (W.rerun || W.focus) return;
    if (step.id === 'house' && !store.name && !store._named) {
      store._named = true;
      const town = String(W.a.house?.location?.name || '').split(',')[0].trim();
      store.name = town && !/\d/.test(town) ? T('{town} home', { town }) : T('My Home');
    }
    const f = W.found; if (!f || store._smart) return;
    const q = step.question; if (!q || store[q.id] !== undefined) return;
    const pick = (kinds) => { const p = step.branches?.yes?.pick; if (!p) return []; return kinds.filter((k) => p.options.some((o) => o.id === k)); };
    let kinds = [];
    if (step.id === 'homeassistant' && f.homeassistant?.length) { store.uses = 'yes'; }
    else if (step.id === 'controls') kinds = pick([...(f.hue?.length ? [W.ha ? 'hue' : 'hue-local'] : []), ...(f.shelly?.length ? [W.ha ? 'shelly' : 'shelly-local'] : [])]);
    else if (step.id === 'cameras') kinds = pick(f.frigate?.length ? ['frigate'] : []);
    else return;
    if (step.id !== 'homeassistant') { if (!kinds.length) return; store[q.id] = 'yes'; store.kinds = kinds; }
    store._smart = true;
    out.push(el('div', { class: 'found' }, '✓ ', T('Found on your network, so it\'s picked for you - change anything.')));
  }
  /* ---------- a step's own checks ---------- */
  function problem(step, store) {
    if (step.id !== 'protect' || W.p2fa?.demo) return null;
    const p = W.p2fa || {};
    if (p.on) return p.codes && !store.saved ? T('Save your recovery codes, then tick "I\'ve saved my recovery codes".') : null;
    if (store.choice === 'later') return null;
    return p.started ? T('Type the 6-digit code from the app and press Turn on - or choose "Not now".') : T('Turn on two-step sign-in, or choose "Not now".');
  }
  /* A test that failed without its own "How to fix": the guide for this step, and a person to ask. */
  function fixFor() {
    const step = W.steps[W.i - 1];
    return el('div', { class: 'fix' }, el('b', {}, T('Still stuck?')), ' ', doc(step ? `setup.${step.id}` : 'setup.errors', { label: 'See the guide for this step' }) || '', ' · ',
      el('a', { href: 'mailto:support@casatorch.com' }, T('E-mail support')));   // scrub-ok: public support address
  }
  /* ---------- "Protect your CasaTorch": two-step sign-in ---------- */
  let asked = null;   // the server was asked (for this kind of run: first setup, or setup again)
  CUSTOM.protect = (f, store) => {
    const box = el('div', { class: 'protect' });
    const draw = () => {
      const p = W.p2fa;
      if (!p) { box.replaceChildren(el('div', { class: 'note' }, T('Looking...'))); return; }
      const faceId = el('p', { class: 'note faceid' }, el('b', {}, T('On your phone, the CasaTorch app also supports Face ID, Touch ID or fingerprint to unlock.')), ' ', T('(The app is coming soon to the App Store and Google Play.)'));
      if (p.demo) { box.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'note' }, T('The demo has no accounts, so there is nothing to protect here. On your own CasaTorch this step turns on two-step sign-in.'))), faceId); return; }
      if (p.on) { box.replaceChildren(onCard(p, store), faceId); return; }
      const later = store.choice === 'later';
      const why = el('div', { class: 'card protect-why' },
        el('div', { class: 'protect-head' }, el('span', { class: 'shield', 'aria-hidden': 'true' }, '🔒'), el('div', {}, el('h3', {}, T('Two-step sign-in'), el('span', { class: 'badge rec' }, T('Recommended'))),
          el('p', { class: 'note', style: 'margin:2px 0 0' }, T('After your password, sign-in also asks for a 6-digit code from your phone. A stolen or guessed password alone can\'t open your cameras, locks or alarm.')))),
        el('ul', { class: 'note protect-list' }, el('li', {}, T('About two minutes, with any authenticator app - Google Authenticator, Microsoft Authenticator, 1Password, the iPhone Passwords app...')),
          el('li', {}, T('Ten recovery codes, in case you lose your phone.'))));
      const choice = (v, title, small) => el('button', { type: 'button', role: 'radio', 'aria-checked': store.choice === v ? 'true' : 'false', class: `opt${store.choice === v ? ' on' : ''}`, onclick: () => { store.choice = v; $('#navmsg').textContent = ''; saveProgress(); if (v === 'on' && !p.started) start(); else draw(); } }, T(title), el('small', {}, T(small)));
      const opts = el('div', { class: 'opts', role: 'radiogroup', 'aria-label': T('Two-step sign-in') }, choice('on', 'Turn it on (recommended)', 'Scan a code with your phone'), choice('later', 'Not now', 'Remind me later'));
      box.replaceChildren(...[why, opts, later ? el('p', { class: 'note later' }, T('OK. CasaTorch will remind you gently: Settings › Health shows it in amber, and Getting started on the Home screen has it. Turn it on any time in Settings › People & sign-in.')) : p.started ? enrolEl(p, store) : null, faceId].filter(Boolean));
    };
    const start = async () => {
      W.p2fa = { ...W.p2fa, busy: true }; box.replaceChildren(el('div', { class: 'note' }, T('Making your code…')));
      try { const r = await api('/api/setup/2fa/start', { body: { username: W.a.account?.username || '' } }); W.p2fa = r.on ? { on: true } : { started: true, ...r }; }
      catch (e) { W.p2fa = { started: false, error: e.message }; }
      draw();
    };
    if (asked !== W.rerun) { asked = W.rerun; W.p2fa = null; api('/api/setup/2fa').then((r) => { W.p2fa = { ...r, started: false }; if (r.on) store.choice = 'on'; draw(); }).catch(() => { W.p2fa = { started: false }; draw(); }); }
    draw();
    if (W.p2fa?.error) box.prepend(el('div', { class: 'err' }, W.p2fa.error));
    return box;
  };
  function enrolEl(p, store) {
    const qr = el('div', { class: 'qr', role: 'img', 'aria-label': T('QR code for your authenticator app') }); if (/^\s*<svg[\s>]/.test(p.qr || '')) qr.innerHTML = p.qr;   // made by this CasaTorch
    const key = el('code', { class: 'tfa-key' }, String(p.secret || '').replace(/(.{4})/g, '$1 ').trim());
    const code = el('input', { type: 'text', id: 'tfa-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '123456', 'aria-label': T('6-digit code from the app'), class: 'tfa-code' });
    const msg = el('div', { class: 'err', role: 'alert' });
    const btn = el('button', { type: 'button', class: 'primary' }, T('Turn on'));
    const verify = async () => {
      msg.textContent = ''; btn.disabled = true;
      try { const r = await api('/api/setup/2fa/verify', { body: { code: code.value }, noRetry: true }); W.p2fa = { on: true, codes: r.recovery }; store.choice = 'on'; store.saved = false; go(); }
      catch (e) { msg.textContent = e.message; if (e.body?.restart) { W.p2fa = { started: false }; go(); return; } btn.disabled = false; code.select(); }
    };
    btn.onclick = verify;
    code.addEventListener('input', () => { if (/^\d{6}$/.test(code.value.trim())) verify(); });
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verify(); } });
    setTimeout(() => { if (code.isConnected && matchMedia('(min-width: 700px)').matches) code.focus({ preventScroll: true }); }, 60);
    return el('div', { class: 'card enrol' },
      el('div', { class: 'enrol-grid' }, qr, el('div', {},
        el('p', { class: 'note' }, el('b', {}, '1. '), T('Open your authenticator app and scan this code.')),
        el('p', { class: 'note' }, T('Can\'t scan? Type this key into the app:')), key,
        el('p', { class: 'note', style: 'margin-top:12px' }, el('b', {}, '2. '), T('Type the 6-digit code the app shows:')),
        el('div', { class: 'row' }, code, btn), msg,
        el('p', { class: 'note', style: 'margin-top:10px' }, el('a', { href: p.uri, class: 'small' }, T('On this phone? Open it in the authenticator app'))))));
  }
  function onCard(p, store) {
    const card = el('div', { class: 'card protect-on' }, el('div', { class: 'ok big' }, '✓ ', W.rerun ? T('Two-step sign-in is on for your login.') : T('Two-step sign-in is on. You\'ll use it from your first sign-in.')));
    if (p.codes) {
      const text = `${T('CasaTorch recovery codes - each one signs you in once if you lose your phone.')}\n\n${p.codes.join('\n')}\n`;
      const copy = el('button', { type: 'button', class: 'small', onclick: async (e) => { try { await navigator.clipboard.writeText(text); e.currentTarget.textContent = T('Copied ✓'); } catch { sel(); } } }, T('Copy'));
      const dl = el('button', { type: 'button', class: 'small', onclick: () => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'casatorch-recovery-codes.txt' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000); } }, T('Download'));
      const list = el('div', { class: 'rcodes', tabindex: '0', 'aria-label': T('Recovery codes') }, p.codes.map((c) => el('code', {}, c)));
      const sel = () => { const r = document.createRange(); r.selectNodeContents(list); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
      const saved = el('label', { class: 'check field' }, el('input', { type: 'checkbox', id: 'tfa-saved', checked: store.saved === true, onchange: (e) => { store.saved = e.target.checked; $('#navmsg').textContent = ''; } }), el('span', {}, T('I\'ve saved my recovery codes')));
      card.append(el('p', { class: 'note' }, el('b', {}, T('Save these recovery codes now.')), ' ', T('Each one signs you in once if you lose your phone. They won\'t be shown again.')), list, el('div', { class: 'row' }, copy, dl), saved);
    } else if (!W.rerun) {
      card.append(el('p', { class: 'note' }, T('Lost your recovery codes? Make a new set - the old ones stop working.')),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'small', onclick: async () => { try { const r = await api('/api/setup/2fa/codes', { body: {} }); W.p2fa = { ...W.p2fa, codes: r.recovery }; store.saved = false; go(); } catch (e) { $('#navmsg').textContent = e.message; } } }, T('Make new codes')),
          el('button', { type: 'button', class: 'small ghost', onclick: async () => { if (!confirm(T('Turn off two-step sign-in? Your login will only need its password.'))) return; await api('/api/setup/2fa', { method: 'DELETE' }).catch(() => {}); W.p2fa = { started: false }; store.choice = undefined; go(); } }, T('Turn it off'))));
    } else card.append(el('p', { class: 'note' }, T('Recovery codes and turning it off are in Settings › People & sign-in.')));
    return card;
  }

  /* ---------- the end: what's ready, and what's next ---------- */
  function celebrate(r, after) {
    const a = W.a, ready = [], soon = [];
    const add = (cond, text) => { if (cond) ready.push(text); };
    add(a.house?.location?.name, T('Weather for {town}', { town: a.house?.location?.name }));
    add(true, T('{name} · {zone}', { name: a.house?.name || T('Your home'), zone: String(a.house?.timezone || '').replace(/_/g, ' ') }));
    const cals = (a.calendars?.list || []).filter((c) => c.url).length;
    add(a.calendars?.mine !== 'no' || cals, cals ? T('Your calendar and {n} linked', { n: cals }) : T('The CasaTorch family calendar'));
    const many = (n, one, more) => (n === 1 ? T(one) : T(more, { n }));
    const teams = (a.sports?.teams || []).length;
    add(teams, many(teams, 'Live scores for your team', 'Live scores for {n} teams'));
    const heads = (a.news?.picks || []).length + (a.news?.custom || []).filter((c) => c.url).length;
    add(heads, many(heads, 'Headlines from 1 source', 'Headlines from {n} sources'));
    const rems = (a.reminders?.list || []).filter((x) => x.title).length;
    add(rems, many(rems, '1 reminder', '{n} reminders'));
    add(W.ha, T('Home Assistant - every device in it, as widgets'));
    add(W.added.length, T('Added to Home Assistant: {list}', { list: W.added.map((x) => x.title).join(', ') }));
    add(a.cameras?.has === 'yes' && (a.cameras.kinds || []).length, T('Cameras'));
    add(a.controls?.has === 'yes' && (a.controls.kinds || []).length, T('Lights, locks and climate'));
    add(a.sensors?.has === 'yes', T('Sensors, with alerts for {list}', { list: (a.sensors?.alertOn || []).join(', ') || '-' }));
    add(a.energy?.track === 'yes', T('Energy and what it costs'));
    add(a.ai?._test?.ok, T('Your Home AI Agent'));
    add(a.apptests?.want === 'yes', T('App tests'));
    const twoStep = !!W.p2fa?.on;
    if (twoStep) ready.push(T('Two-step sign-in'));
    if (r?.pair) soon.push([T('Pair your phone'), T('The QR code is next - one scan and your phone is signed in.'), null]);
    if (!twoStep && !W.p2fa?.demo) soon.push([T('Turn on two-step sign-in'), T('Two minutes, and a stolen password alone can\'t get in.'), '/#settings/people']);
    soon.push([T('Take the one-minute tour'), T('Where everything is.'), '/?tour']);
    if (!r?.pair) soon.push([T('Turn on alerts on your phone'), T('Leaks, smoke and the doorbell, wherever you are.'), '/#settings/phones']);
    soon.push([T('Connect more'), T('Anything else you have - a few clicks each.'), '/#connect']);
    soon.push([T('Make a backup'), T('One encrypted file to keep somewhere safe.'), '/#settings/updates']);
    soon.push([T('Try the 3D home'), T('Your home in 3D, live (Pro - in your trial).'), '/#house3d']);
    $('#progress').replaceChildren(); $('#meter')?.remove(); $('#resume')?.replaceChildren(); $('#back').hidden = true; $('#navmsg').textContent = '';
    const next = $('#next'); next.disabled = false; next.textContent = r?.pair ? T('Next: your phone') : T('Open my dashboard');
    next.onclick = () => (r?.pair ? after() : (location.href = '/?tour'));
    $('#page').replaceChildren(...[
      el('div', { class: 'celebrate' }, el('div', { class: 'burst', 'aria-hidden': 'true' }, el('span', { class: 'tick' }, '✓'), ...Array.from({ length: 12 }, (_, k) => el('i', { style: `--k:${k}` }))),
        el('h1', {}, T('Your CasaTorch is ready')),
        el('p', { class: 'intro' }, T('Nice work - your home is lit up. Here\'s what\'s working already.'))),
      el('ul', { class: 'ready' }, ready.map((x) => el('li', {}, el('span', { class: 'ok' }, '✓'), ' ', x))),
      twoStep || W.p2fa?.demo ? null : el('p', { class: 'note warnline' }, T('Two-step sign-in is off. Turn it on any time in Settings › People & sign-in.')),
      el('h2', { class: 'nexth' }, T('Good next steps')),
      el('div', { class: 'nextgrid' }, soon.slice(0, 5).map(([t, d, href]) => (href ? el('a', { class: 'nextcard', href }, el('b', {}, t), el('span', { class: 'note' }, d)) : el('button', { type: 'button', class: 'nextcard', onclick: after }, el('b', {}, t), el('span', { class: 'note' }, d))))),
      el('p', { class: 'note' }, T('Everything can be changed later in Settings › General › Change your setup.'), ' ', doc('setup.done') || '')].filter(Boolean));
    scrollTo(0, 0);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(() => $('.celebrate')?.classList.add('go'));
  }
  window.SetupHelp = Object.freeze({ progress, top, problem, fixFor, celebrate });
})();
