/* The CasaTorch app's own screens (bundled in the app, so they work with no network):
     welcome → find your CasaTorch (or scan a pairing code, or type its address) → sign in → two-step code
     (or set it up) → Face ID → alerts → your home.
   Also: your homes (switch, add, remove) and "can't reach your home".
   There's no CasaTorch account: the app signs in to your own CasaTorch and keeps a token for it in the phone's
   secure storage. Nothing here talks to anyone else, except casatorch.com/api/find, which lists the CasaTorch boxes
   on the same home internet connection as the phone (the same thing casatorch.com/home does in a browser). */
(() => {
  const N = window.CasaNative;
  const $app = document.getElementById('app');
  const FIND = 'https://casatorch.com/api/find';
  const S = { base: null, hello: null, ticket: null, user: null, home: null, token: null, recovery: null, pair: null };
  const ICON = {
    qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5', link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    home: 'M3 11 12 3l9 8M5 9.5V21h14V9.5M10 21v-6h4v6', chev: 'M9 18l6-6-6-6', back: 'M15 18l-6-6 6-6', face: 'M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 16c1.5 1 4.5 1 6 0',
    bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0', wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h0', plus: 'M12 5v14M5 12h14', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    torch: 'M12 2c2 3 4 5 4 8a4 4 0 0 1-8 0c0-1.5.6-2.8 1.4-3.9.3 1 .9 1.8 1.6 2.3C11 6 11.4 4 12 2zM9 15h6l-1 7h-4z',
  };
  const svg = (name, size) => `<svg viewBox="0 0 24 24" ${size ? `width="${size}" height="${size}"` : ''} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[name] || ''}"/></svg>`;
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const screen = (...kids) => { $app.replaceChildren(el('div', { class: 'glow' }), el('section', { class: 'screen' }, ...kids)); window.scrollTo(0, 0); const f = $app.querySelector('input:not([type=hidden])'); if (f && !matchMedia('(pointer: coarse)').matches) setTimeout(() => f.focus(), 50); };
  const back = (to) => el('button', { class: 'back', onclick: to }, el('span', { html: svg('back', 20) }), 'Back');
  const busy = (btn, on, label) => { btn.disabled = on; if (on) { btn.dataset.label = btn.textContent; btn.replaceChildren(el('span', { class: 'spin' })); } else btn.textContent = label || btn.dataset.label || 'Continue'; };
  const haptic = (k) => { try { N?.haptic(k); } catch { /* fine */ } };
  /* ---- talking to a CasaTorch ---- */
  const clean = (u) => { let s = String(u || '').trim(); if (!s) return null; if (!/^https?:\/\//i.test(s)) s = (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(s) || /\.local(:\d+)?$/i.test(s) ? 'http://' : 'https://') + s; try { const x = new URL(s); if (!x.port && x.protocol === 'http:' && /^\d+\.\d+\.\d+\.\d+$/.test(x.hostname)) x.port = '8090'; return x.origin; } catch { return null; } };
  async function j(base, path, body, { token, timeout = 12000 } = {}) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(data.error || `Your CasaTorch answered ${r.status}.`), { status: r.status, data });
      return data;
    } catch (e) { if (e.name === 'AbortError') throw new Error('No answer - is the phone on your home Wi-Fi?'); if (e instanceof TypeError) throw new Error('Can\'t reach that address from this phone.'); throw e; }
    finally { clearTimeout(t); }
  }
  const hello = (base, timeout = 5000) => j(base, '/api/app/hello', null, { timeout }).then((h) => { if (!h.casatorch) throw new Error('That isn\'t a CasaTorch.'); return h; });
  /* The best address to sign in at: its secure address (encrypted on your Wi-Fi), else the one from anywhere, else the plain one. */
  async function bestBase(cands) {
    for (const c of [...new Set(cands.filter(Boolean))]) { try { const h = await hello(c, 4000); if (h.secure && h.secure !== c) { try { const h2 = await hello(h.secure, 4000); return { base: h.secure, hello: h2 }; } catch { /* the secure address isn't reachable from here (some routers block it) */ } } return { base: c, hello: h }; } catch { /* next */ } }
    return null;
  }
  const device = async () => { try { return await N.deviceInfo(); } catch { return { name: 'Phone', platform: /android/i.test(navigator.userAgent) ? 'android' : 'ios' }; } };
  /* ---- screens ---- */
  function welcome() {
    screen(el('div', { class: 'spacer' }),
      el('div', { class: 'logo', html: '<svg viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eb8ff"/><stop offset="1" stop-color="#8b7bff"/></linearGradient></defs><path d="M46 20a18 18 0 1 0 0 24" fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round"/><circle cx="46" cy="32" r="5" fill="#fbbf24"/></svg>' }),
      el('div', { class: 'stack' }, el('h1', {}, 'CasaTorch'), el('p', { class: 'tag' }, 'Your home, lit up.'), el('p', { class: 'muted' }, 'Your whole home on your phone - lights, cameras, the 3D home and alerts - straight from your own CasaTorch.')),
      el('div', { class: 'spacer' }),
      el('div', { class: 'stack' },
        el('button', { class: 'btn primary', onclick: scanPair }, el('span', { html: svg('qr') }), 'Scan a pairing code'),
        el('button', { class: 'btn', onclick: find }, el('span', { html: svg('search') }), 'Find my CasaTorch'),
        el('button', { class: 'btn plain', onclick: () => address() }, 'Type its address')),
      el('p', { class: 'foot' }, 'The pairing code is in CasaTorch on any screen you\'re signed in to: Settings › Phones & alerts › Add a phone.'));
  }
  async function find() {
    const list = el('div', { class: 'group' }, el('div', { class: 'row' }, el('span', { class: 'spin' }), el('span', { class: 'muted' }, 'Looking on your home network…')));
    screen(back(welcome), el('h2', {}, 'Find my CasaTorch'), el('p', { class: 'muted' }, 'Make sure this phone is on your home Wi-Fi.'), list);
    let found = [];
    try { found = ((await j('', FIND, null, { timeout: 8000 })).found || []).filter((x) => x.kind !== 'personal'); } catch { /* offline, or casatorch.com unreachable */ }
    const rows = await Promise.all(found.map(async (x) => { try { const h = await hello(x.url, 4000); return { url: x.url, h }; } catch { return null; } }));
    const ok = rows.filter(Boolean);
    list.replaceChildren(...(ok.length ? ok.map((r) => el('button', { class: 'row', onclick: () => chosen(r.url, r.h) }, el('span', { class: 'ic', html: svg('home') }), el('div', { class: 'grow' }, el('b', {}, r.h.home?.name || 'CasaTorch'), el('small', {}, r.url.replace(/^https?:\/\//, ''))), el('span', { class: 'chev', html: svg('chev', 18) })))
      : [el('div', { class: 'row' }, el('div', { class: 'grow' }, el('b', {}, 'None found'), el('small', {}, found.length ? 'Found one, but this phone can\'t reach it - is it on the same Wi-Fi?' : 'Check the phone is on your home Wi-Fi, or type the address.')))]));
    list.after(el('button', { class: 'btn plain', onclick: () => address() }, 'Type its address instead'));
  }
  function address(prefill = '') {
    const inp = el('input', { type: 'url', inputmode: 'url', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: '192.168.1.50 or home-….casatorch.com', value: prefill });
    const err = el('p', { class: 'err' }), go = el('button', { class: 'btn primary' }, 'Continue');
    const run = async () => {
      const base = clean(inp.value); if (!base) { err.textContent = 'Type the address you use for CasaTorch.'; return; }
      busy(go, true); err.textContent = '';
      try { const h = await hello(base); await chosen(base, h); } catch (e) { err.textContent = e.message; busy(go, false); haptic('error'); }
    };
    go.onclick = run; inp.onkeydown = (e) => { if (e.key === 'Enter') run(); };
    screen(back(welcome), el('h2', {}, 'Your CasaTorch\'s address'), el('p', { class: 'muted' }, 'The address you open CasaTorch at - like 192.168.1.50 at home, or its secure address. It\'s in CasaTorch under Settings › General.'),
      el('label', { class: 'field' }, el('span', {}, 'Address'), inp), err, go);
  }
  async function chosen(base, h) {
    const best = await bestBase([h.secure, base]) || { base, hello: h };
    S.base = best.base; S.hello = best.hello;
    if (!S.hello.signIn) return screen(back(welcome), el('h2', {}, S.hello.demo ? 'That\'s the demo' : 'Finish setting up first'), el('p', { class: 'muted' }, S.hello.demo ? 'The demo has no accounts. Point the app at your own CasaTorch.' : 'Finish setup on CasaTorch (it creates your sign-in), then come back.'));
    signin();
  }
  function plainWarning() { return S.base?.startsWith('http://') ? el('div', { class: 'note warn' }, el('span', { html: svg('lock', 18) }), el('span', {}, 'This address isn\'t encrypted on your Wi-Fi. Turn on CasaTorch\'s secure address at home (Settings › Connections) and the app uses it by itself.')) : null; }
  function signin() {
    const u = el('input', { autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', placeholder: 'Name or e-mail' }), p = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
    const err = el('p', { class: 'err' }), go = el('button', { class: 'btn primary' }, 'Sign in');
    const run = async () => {
      if (!u.value || !p.value) { err.textContent = 'Enter your name and password.'; return; }
      busy(go, true); err.textContent = '';
      try { step(await j(S.base, '/api/app/login', { username: u.value, password: p.value, device: await device() })); } catch (e) { err.textContent = e.message; busy(go, false, 'Sign in'); haptic('error'); p.value = ''; }
    };
    go.onclick = run; p.onkeydown = (e) => { if (e.key === 'Enter') run(); };
    screen(back(welcome), el('h2', {}, `Sign in to ${S.hello.home?.name || 'your home'}`), el('p', { class: 'muted' }, 'The same name and password as CasaTorch on your other screens.'), plainWarning(),
      el('label', { class: 'field' }, el('span', {}, 'Name'), u), el('label', { class: 'field' }, el('span', {}, 'Password'), p), err, go,
      el('p', { class: 'foot' }, 'Forgot your password? Someone who looks after CasaTorch can reset it in Settings › People & sign-in.'));
  }
  function step(r) {
    S.lastStep = r;
    if (r.ticket) S.ticket = r.ticket; if (r.recovery) S.recovery = r.recovery;
    if (r.ok && r.token) return done(r);
    if (r.step === 'mfa') return code();
    if (r.step === 'enroll') return enroll();
    if (r.step === 'terms') return terms(r.terms);
    screen(back(welcome), el('h2', {}, 'Something unexpected'), el('p', { class: 'muted' }, 'Sign in on another screen first, then try again.'));
  }
  function code() {
    const c = el('input', { class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 11, placeholder: '000000' });
    const err = el('p', { class: 'err' }), go = el('button', { class: 'btn primary' }, 'Continue');
    const run = async () => { busy(go, true); err.textContent = ''; try { step(await j(S.base, '/api/app/mfa', { ticket: S.ticket, code: c.value })); } catch (e) { err.textContent = e.message; busy(go, false); haptic('error'); c.value = ''; if (e.status === 401 && /sign in again/i.test(e.message)) setTimeout(signin, 1200); } };
    go.onclick = run; c.oninput = () => { if (/^\d{6}$/.test(c.value)) run(); };
    screen(back(signin), el('h2', {}, 'Your 6-digit code'), el('p', { class: 'muted' }, 'From your authenticator app. Lost it? Use one of your recovery codes (like a1b2c-d3e4f).'), c, err, go);
  }
  async function enroll() {
    let e0; try { e0 = await j(S.base, '/api/app/enroll', { ticket: S.ticket }); } catch (e) { return screen(back(signin), el('h2', {}, 'Sign in again'), el('p', { class: 'err' }, e.message)); }
    const optional = S.lastStep?.optional !== false;
    const key = e0.secret.replace(/(.{4})/g, '$1 ').trim();
    const c = el('input', { class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '000000' });
    const err = el('p', { class: 'err' }), go = el('button', { class: 'btn primary' }, 'Turn on two-step sign-in');
    const run = async () => { busy(go, true); err.textContent = ''; try { step(await j(S.base, '/api/app/enroll', { ticket: S.ticket, code: c.value })); } catch (x) { err.textContent = x.message; busy(go, false, 'Turn on two-step sign-in'); haptic('error'); } };
    go.onclick = run; c.oninput = () => { if (/^\d{6}$/.test(c.value)) run(); };
    const copy = async () => { try { await (N?.copy ? N.copy(e0.secret) : navigator.clipboard.writeText(e0.secret)); haptic('success'); return true; } catch { return false; } };
    // Your authenticator, your choice: Apple's opens straight from a link; the others take the setup key (copied for you).
    const isIos = /ios|ipados/.test(N?.platform || '') || /iphone|ipad/i.test(navigator.userAgent);
    const APPS = [['google', 'Google Authenticator'], ['microsoft', 'Microsoft Authenticator'], ['onepassword', '1Password'], ['authy', 'Authy'], ...(isIos ? [['apple', 'Apple Passwords']] : []), ['other', 'Another app']];
    const how = el('div', { class: 'howto' });
    const pick = (id) => {
      for (const b of chips.children) b.classList.toggle('on', b.dataset.id === id);
      const name = APPS.find(([k]) => k === id)?.[1] || 'your authenticator';
      if (id === 'apple') { how.replaceChildren(el('a', { class: 'btn', href: e0.uri }, 'Add to Apple Passwords'), el('p', { class: 'small muted' }, 'Then come back here and type the 6-digit code it shows.')); return; }
      const copied = el('span', { class: 'small muted' });
      how.replaceChildren(
        el('ol', { class: 'steps' }, el('li', {}, 'Copy your setup key: ', el('button', { class: 'btn small', onclick: async () => { copied.textContent = (await copy()) ? ' Copied ✓' : ' Select it below and copy'; } }, 'Copy key'), copied),
          el('li', {}, `Open ${name}, tap `, el('b', {}, '+'), ', then ', el('b', {}, id === 'onepassword' ? 'One-Time Password' : 'Enter a setup key'), ' and paste it.'),
          el('li', {}, 'Come back here and type the 6-digit code it shows.')),
        el('div', { class: 'mono' }, key),
        isIos ? null : el('a', { class: 'btn plain', href: e0.uri }, `Or open ${name} directly`));
    };
    const chips = el('div', { class: 'chips' }, ...APPS.map(([id, label]) => el('button', { class: 'chip', 'data-id': id, onclick: () => pick(id) }, label)));
    pick('google');
    screen(back(signin), el('h2', {}, 'Two-step sign-in'),
      el('p', { class: 'muted' }, optional ? 'Recommended: a 6-digit code from an authenticator app as well as your password. Even if someone learns your password, they can\'t get into your home.' : 'This home requires it: a 6-digit code from an authenticator app as well as your password.'),
      el('label', { class: 'field' }, el('span', {}, 'Which authenticator do you use?')), chips, how,
      el('details', {}, el('summary', { class: 'small muted' }, 'Setting it up on another device?'), el('div', { class: 'qr', html: e0.qr })),
      el('label', { class: 'field' }, el('span', {}, 'The 6-digit code'), c), err, go,
      optional ? el('button', { class: 'btn plain', onclick: async (e) => { busy(e.target, true); try { step(await j(S.base, '/api/app/enroll', { ticket: S.ticket, skip: true })); } catch (x) { err.textContent = x.message; busy(e.target, false, 'Not now'); } } }, 'Not now') : null,
      optional ? el('p', { class: 'foot' }, 'You can turn it on later in Settings › People & sign-in.') : null);
  }
  function terms(version) {
    const go = el('button', { class: 'btn primary' }, 'Agree and continue'), err = el('p', { class: 'err' });
    go.onclick = async () => { busy(go, true); try { step(await j(S.base, '/api/app/terms', { ticket: S.ticket, accept: true })); } catch (e) { err.textContent = e.message; busy(go, false); } };
    screen(el('h2', {}, 'The terms'), el('p', { class: 'muted' }, `CasaTorch's terms of use and privacy notice (${version}).`), el('div', { class: 'stack' }, el('button', { class: 'btn', onclick: () => N?.openExternal(`${S.base}/terms.html`) }, 'Read the terms'), el('button', { class: 'btn', onclick: () => N?.openExternal(`${S.base}/privacy.html`) }, 'Read the privacy notice')), err, go);
  }
  /* Signed in: keep the home (the token goes to the phone's secure storage), then Face ID and alerts. */
  async function done(r) {
    S.token = r.token; S.home = r.home; S.user = r.user; haptic('success');
    const a = r.home.addresses || {};
    try { await N.saveHome({ id: r.home.id, name: r.home.name, token: r.token, user: { name: r.user?.name || r.user?.username, role: r.user?.role }, addresses: { lan: a.lan, remote: a.remote, plain: a.plain, here: S.base } }); }
    catch (e) { return screen(el('h2', {}, 'Couldn\'t keep the sign-in'), el('p', { class: 'err' }, e.message)); }
    if (S.recovery) return recovery();
    faceId();
  }
  function recovery() {
    screen(el('div', { class: 'big-ic', html: svg('lock') }), el('h2', {}, 'Your recovery codes'), el('p', { class: 'muted' }, 'If you ever lose your authenticator, each of these signs you in once. Keep them somewhere safe - a password manager is ideal.'),
      el('div', { class: 'codes' }, S.recovery.map((x) => el('span', {}, x))),
      el('button', { class: 'btn', onclick: () => N?.share({ text: `CasaTorch recovery codes for ${S.home?.name || 'home'}:\n${S.recovery.join('\n')}` }) }, 'Save them…'),
      el('button', { class: 'btn primary', onclick: () => { S.recovery = null; faceId(); } }, 'I\'ve saved them'));
  }
  async function faceId() {
    let b = { available: false }; try { b = await N.biometrics(); } catch { /* none */ }
    if (!b.available) return alerts();
    const name = { faceID: 'Face ID', touchID: 'Touch ID', opticID: 'Optic ID', fingerprint: 'your fingerprint', face: 'face unlock' }[b.type] || 'Face ID';
    const on = el('button', { class: 'btn primary' }, `Use ${name}`);
    on.onclick = async () => { busy(on, true); try { await N.setBiometricLock(true); } catch { /* they said no */ } alerts(); };
    screen(el('div', { class: 'spacer' }), el('div', { class: 'big-ic', html: svg('face') }), el('h2', {}, `Unlock with ${name}?`), el('p', { class: 'muted' }, `CasaTorch opens with ${name} - your sign-in is kept in this phone's secure storage and only comes out when it's you. Recommended.`),
      el('div', { class: 'spacer' }), on, el('button', { class: 'btn plain', onclick: alerts }, 'Not now'));
  }
  async function alerts() {
    const on = el('button', { class: 'btn primary' }, 'Turn on alerts'), err = el('p', { class: 'err' });
    on.onclick = async () => {
      busy(on, true); err.textContent = '';
      try { const p = await N.pushEnable(); await j(S.base, '/api/app/push', { ...p, level: 'important' }, { token: S.token }); j(S.base, '/api/app/push/test', {}, { token: S.token }).catch(() => {}); finish(); }
      catch (e) { err.textContent = e.message; busy(on, false, 'Try again'); }
    };
    screen(el('div', { class: 'spacer' }), el('div', { class: 'big-ic', html: svg('bell') }), el('h2', {}, 'Alerts on this phone?'), el('p', { class: 'muted' }, 'Water, smoke, the doorbell, a device going offline, your nudges - even when the app is closed. Encrypted by your CasaTorch; only this phone can read them.'),
      el('div', { class: 'spacer' }), err, on, el('button', { class: 'btn plain', onclick: finish }, 'Not now'));
  }
  function finish() { N?.openHome(S.home.id); }
  /* ---- pairing with a code from a signed-in screen ---- */
  async function scanPair() {
    let link; try { link = await N.scanQR(); } catch (e) { return pairCode(); }
    if (!link) return;   // cancelled
    pairFrom(link);
  }
  async function pairFrom(link) {
    let u; try { u = new URL(String(link).replace(/^casatorch:\/\/pair/, 'https://x/pair')); } catch { return pairCode(null, 'That isn\'t a CasaTorch pairing code.'); }
    const q = u.searchParams, code = q.get('c');
    if (!code) return pairCode(null, 'That isn\'t a CasaTorch pairing code.');
    screen(el('div', { class: 'spacer' }), el('div', { class: 'center stack' }, el('span', { class: 'spin' }), el('p', { class: 'muted' }, `Reaching ${q.get('n') || 'your home'}…`)), el('div', { class: 'spacer' }));
    const best = await bestBase([q.get('l'), q.get('h'), q.get('r'), q.get('p')]);
    if (!best) return screen(back(welcome), el('h2', {}, 'Can\'t reach your home'), el('p', { class: 'muted' }, 'Make sure this phone is on your home Wi-Fi (or that secure access is on for using it from anywhere), then scan again.'));
    S.base = best.base; S.hello = best.hello;
    try { const r = await j(S.base, '/api/app/claim', { code, device: await device() }); done(r); }
    catch (e) { pairCode(null, e.message); }
  }
  function pairCode(_, msg) {
    const c = el('input', { class: 'code', autocapitalize: 'characters', autocorrect: 'off', maxlength: 11, placeholder: 'ABCDE-12345', style: 'letter-spacing:.12em;font-size:24px' }), a = el('input', { type: 'url', inputmode: 'url', autocapitalize: 'none', placeholder: 'Its address, like 192.168.1.50', value: S.base || '' });
    const err = el('p', { class: 'err' }, msg || ''), go = el('button', { class: 'btn primary' }, 'Pair');
    go.onclick = async () => {
      const base = clean(a.value); if (!base) { err.textContent = 'Type the CasaTorch\'s address too.'; return; }
      busy(go, true); err.textContent = '';
      try { const best = await bestBase([base]); if (!best) throw new Error('Can\'t reach that address from this phone.'); S.base = best.base; S.hello = best.hello; done(await j(S.base, '/api/app/claim', { code: c.value, device: await device() })); }
      catch (e) { err.textContent = e.message; busy(go, false, 'Pair'); haptic('error'); }
    };
    screen(back(welcome), el('h2', {}, 'Type the pairing code'), el('p', { class: 'muted' }, 'It\'s under the QR code in CasaTorch: Settings › Phones & alerts › Add a phone.'), el('label', { class: 'field' }, el('span', {}, 'Code'), c), el('label', { class: 'field' }, el('span', {}, 'Address'), a), err, go);
  }
  /* ---- your homes ---- */
  async function homes() {
    let list = []; try { list = await N.homes(); } catch { /* none */ }
    if (!list.length) return welcome();
    const rows = el('div', { class: 'group' }, ...list.map((h) => el('button', { class: 'row', onclick: () => N.openHome(h.id) }, el('span', { class: 'ic', html: svg('home') }), el('div', { class: 'grow' }, el('b', {}, h.name), el('small', {}, `${h.user?.name || ''}${h.last ? ` · last opened ${new Date(h.last).toLocaleDateString()}` : ''}`)), el('span', { class: 'chev', html: svg('chev', 18) }))));
    screen(el('h1', {}, 'Your homes'), rows, el('button', { class: 'btn', onclick: welcome }, el('span', { html: svg('plus') }), 'Add a home'),
      el('div', { class: 'spacer' }), el('div', { class: 'group' }, ...list.map((h) => el('button', { class: 'row', onclick: async () => { if (await confirmRemove(h)) { await N.removeHome(h.id); homes(); } } }, el('div', { class: 'grow' }, el('b', { style: 'color:var(--bad)' }, `Sign out of ${h.name}`), el('small', {}, 'Removes it from this phone'))))));
  }
  function confirmRemove(h) {
    return new Promise((resolve) => {
      screen(el('h2', {}, `Sign out of ${h.name}?`), el('p', { class: 'muted' }, 'This phone forgets the sign-in and stops getting its alerts. You can sign in again any time.'),
        el('div', { class: 'spacer' }), el('button', { class: 'btn primary', style: 'background:var(--bad);color:#fff', onclick: () => resolve(true) }, 'Sign out'), el('button', { class: 'btn plain', onclick: () => { resolve(false); homes(); } }, 'Cancel'));
    });
  }
  async function unreachable(id) {
    let h = null; try { h = (await N.homes()).find((x) => x.id === id); } catch { /* none */ }
    const name = h?.name || 'your home';
    const retry = el('button', { class: 'btn primary', onclick: () => N.openHome(id) }, 'Try again');
    screen(el('div', { class: 'spacer' }), el('div', { class: 'big-ic', html: svg('wifi') }), el('h2', {}, `Can't reach ${name}`), el('p', { class: 'muted' }, h?.addresses?.remote ? 'This phone can\'t get to your CasaTorch right now - it may be off, or its internet is down. On your home Wi-Fi it\'s reached directly.' : 'Away from home, the app needs secure access, and it isn\'t on for this home yet. On your home Wi-Fi, open CasaTorch › Settings › Connections & AI › Secure access and turn it on - then open the app once at home and it remembers the away-from-home address. (From anywhere is part of Pro.)'),
      h?.addresses ? el('div', { class: 'group' }, ...Object.entries(h.addresses).filter(([, v]) => v).map(([k, v]) => el('div', { class: 'row' }, el('div', { class: 'grow' }, el('b', {}, { lan: 'At home (secure)', remote: 'From anywhere', plain: 'At home', here: 'Last used' }[k] || k), el('small', {}, v.replace(/^https?:\/\//, '')))))) : null,
      el('div', { class: 'spacer' }), retry, el('button', { class: 'btn', onclick: homes }, 'Your homes'));
  }
  function signedOut(id) {
    screen(el('div', { class: 'spacer' }), el('div', { class: 'big-ic', html: svg('lock') }), el('h2', {}, 'Signed out'), el('p', { class: 'muted' }, 'This phone was signed out of your CasaTorch (from Settings, or the sign-in ran out). Sign in again to carry on.'),
      el('div', { class: 'spacer' }), el('button', { class: 'btn primary', onclick: async () => { const h = (await N.homes().catch(() => [])).find((x) => x.id === id); const best = h && await bestBase([h.addresses?.lan, h.addresses?.here, h.addresses?.remote, h.addresses?.plain]); if (best) { S.base = best.base; S.hello = best.hello; signin(); } else welcome(); } }, 'Sign in again'), el('button', { class: 'btn plain', onclick: homes }, 'Your homes'));
  }
  /* ---- routing: the app opens this page at #welcome, #homes, #pair=<link>, #unreachable=<id> or #signedout=<id> ---- */
  function route() {
    const h = decodeURIComponent(location.hash.slice(1)), [k, v] = [h.split('=')[0], h.slice(h.indexOf('=') + 1)];
    if (!N) return screen(el('h2', {}, 'CasaTorch'), el('p', { class: 'muted' }, 'Open this in the CasaTorch app.'));
    if (k === 'pair' && v) return pairFrom(v);
    if (k === 'unreachable') return unreachable(v);
    if (k === 'signedout') return signedOut(v);
    if (k === 'welcome') return welcome();
    return homes();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('casa:pair', (e) => pairFrom(e.detail));   // a pairing link opened from the camera app
  route();
})();
