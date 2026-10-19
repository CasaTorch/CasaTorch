/* The CasaTorch app's own screens (bundled in the app, so they work with no network):
     welcome → find your CasaTorch (or scan a pairing code, or type its address) → sign in → two-step code
     (or set it up) → Face ID → alerts → your home.
   Also: your homes (switch, add, remove), "can't reach your home" (it keeps trying by itself) and "signed out".
   There's no CasaTorch account: the app signs in to your own CasaTorch and keeps a token for it in the phone's
   secure storage. Nothing here talks to anyone else, except casatorch.com/api/find, which lists the CasaTorch boxes
   on the same home internet connection as the phone (the same thing casatorch.com/home does in a browser).

   Every word on screen goes through T(), so the screens can be translated (see i18n/words.js).
   Where you are is kept in the address (#signin=…), so if the phone closes the app in the background mid-sign-in,
   it opens at the same step. Nothing secret is kept there: no password, no code, no ticket. */
(() => {
  'use strict';
  const N = window.CasaNative;
  const $app = document.getElementById('app');
  const FIND = 'https://casatorch.com/api/find';
  /* The oldest CasaTorch this app can sign in to, and the newest pairing-code format it reads. */
  const MIN_SERVER = '0.6.0', PAIR_FORMAT = 1;
  const APP_VERSION = (N && N.version) || '';
  const S = { base: null, hello: null, ticket: null, user: null, home: null, token: null, recovery: null, lastStep: null, onBack: null, gen: 0, codeFails: 0 };

  /* ---- words ---- */
  const LANGS = Object.keys(window.CASA_WORDS || {});
  const LANG = (() => {
    for (const l of navigator.languages || [navigator.language || 'en']) { const b = String(l).toLowerCase().split('-')[0]; if (b === 'en') return 'en'; if (LANGS.includes(b)) return b; }
    return 'en';
  })();
  const WORDS = (window.CASA_WORDS || {})[LANG] || {};
  if (LANG !== 'en') document.documentElement.lang = LANG;
  /** T('Sign in to {name}', { name }) - the translation if there is one, with the {gaps} filled in. */
  const T = (s, v) => {
    let o = Object.prototype.hasOwnProperty.call(WORDS, s) && WORDS[s] ? WORDS[s] : s;
    if (v) o = o.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
    return o;
  };

  /* ---- building screens ---- */
  const ICON = {
    qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5', link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    home: 'M3 11 12 3l9 8M5 9.5V21h14V9.5M10 21v-6h4v6', chev: 'M9 18l6-6-6-6', back: 'M15 18l-6-6 6-6', face: 'M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 16c1.5 1 4.5 1 6 0',
    bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0', wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h0', plus: 'M12 5v14M5 12h14', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    keyboard: 'M3 6h18v12H3zM7 10h0M11 10h0M15 10h0M7 14h10', update: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', alert: 'M12 3 2 20h20zM12 10v4M12 17h0',
  };
  const svg = (name, size) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${size ? `width="${size}" height="${size}"` : ''} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[name] || ''}"/></svg>`;
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  let pendingBack = null;
  /** The Back button; it's also what the Android back gesture, Escape and the iPad edge swipe do on this screen. */
  const back = (to) => { pendingBack = to; return el('button', { class: 'back', type: 'button', onclick: () => to() }, el('span', { html: svg('back', 20) }), T('Back')); };
  /** Shows a screen. Returns its number: work started for a screen stops when another one is shown. */
  function screen(...kids) {
    S.gen++; S.onBack = pendingBack; pendingBack = null;
    $app.replaceChildren(el('div', { class: 'glow', 'aria-hidden': 'true' }), el('section', { class: 'screen' }, ...kids));
    window.scrollTo(0, 0);
    const gen = S.gen;
    setTimeout(() => {
      if (gen !== S.gen) return;
      // a keyboard: straight into the first field. Touch and screen readers: start at the heading.
      const f = $app.querySelector('input:not([type=hidden])'), h = $app.querySelector('h1, h2');
      if (f && !coarse()) f.focus();
      else if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }, 60);
    return gen;
  }
  /** Where you are, kept in the address so a reload (the phone closed the app in the background) comes back here. */
  const remember = (route) => { try { history.replaceState(null, '', `#${route}`); } catch { /* fine */ } };
  const busy = (btn, on, label) => {
    btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false');
    if (on) { btn.dataset.label = btn.textContent; btn.replaceChildren(el('span', { class: 'spin', role: 'img', 'aria-label': T('Working…') })); }
    else btn.textContent = label || btn.dataset.label || T('Continue');
  };
  const errBox = (msg) => el('p', { class: 'err', role: 'alert' }, msg || '');
  const haptic = (k) => { try { N && N.haptic(k); } catch { /* fine */ } };
  const spinner = (text) => el('div', { class: 'row' }, el('span', { class: 'spin', 'aria-hidden': 'true' }), el('span', { class: 'muted' }, text));
  const bigIcon = (name, kind) => el('div', { class: `big-ic${kind ? ` ${kind}` : ''}`, html: svg(name) });
  /** A QR code from your CasaTorch, as plain SVG shapes only. */
  function safeSvg(text) {
    try {
      const doc = new DOMParser().parseFromString(String(text || ''), 'image/svg+xml'), root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
      for (const n of [root, ...root.querySelectorAll('*')]) {
        if (!['svg', 'path', 'rect', 'g'].includes(n.nodeName.toLowerCase())) { n.remove(); continue; }
        for (const a of [...n.attributes]) if (/^on|href$/i.test(a.name)) n.removeAttribute(a.name);
      }
      return document.importNode(root, true);
    } catch { return null; }
  }

  /* ---- addresses ---- */
  const vcmp = (a, b) => { const x = String(a).split(/[.+-]/).map((n) => parseInt(n, 10) || 0), y = String(b).split(/[.+-]/).map((n) => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
  const hostOf = (base) => { try { return new URL(base).host; } catch { return String(base || ''); } };
  const plainHost = (base) => { try { return new URL(base).hostname.replace(/^\[|\]$/g, ''); } catch { return ''; } };
  /** Addresses that only exist inside a home network (or on a private network like Tailscale): the only places plain http is used. */
  function isLocalHost(h) {
    h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h) return false;
    if (h === 'localhost') return true;
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (v4) { const a = +v4[1], b = +v4[2]; return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127); }
    if (h.includes(':')) return h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
    return !h.includes('.') || /\.(local|lan|home|home\.arpa|internal|localdomain)$/.test(h);
  }
  const allowed = (base) => { try { const u = new URL(base); return u.protocol === 'https:' || (u.protocol === 'http:' && isLocalHost(u.hostname)); } catch { return false; } };
  /**
   * What someone typed, as the addresses worth trying, best first. Forgives a missing http(s)://, a path or a slash
   * at the end, capitals, spaces, a bare IPv6 address, and a missing port (CasaTorch uses 8090 at home).
   *   192.168.1.20         → http://192.168.1.20:8090, https://192.168.1.20, http://192.168.1.20
   *   casatorch.local      → http://casatorch.local:8090, …
   *   home-x.casatorch.com → https://home-x.casatorch.com
   */
  function addressesFrom(raw) {
    let s = String(raw || '').trim().replace(/\s+/g, '').replace(/[。．｡]/g, '.');
    if (!s) return [];
    s = s.replace(/^(https?):\/*/i, (m, p) => `${p.toLowerCase()}://`);
    let scheme = null; const m = /^(https?):\/\//.exec(s);
    if (m) { scheme = m[1]; s = s.slice(m[0].length); }
    s = s.replace(/^[^@/]*@/, '').replace(/[/?#].*$/, '');   // no user@, only the address itself
    if (!s.startsWith('[') && (s.match(/:/g) || []).length >= 2) s = `[${s.replace(/%.*$/, '')}]`;   // a bare IPv6 address
    let host, port;
    const v6 = /^\[([0-9a-fA-F:.]+)(?:%[^\]]*)?\](?::(\d{1,5}))?$/.exec(s);
    if (v6) { host = `[${v6[1].toLowerCase()}]`; port = v6[2]; }
    else { const hp = /^([^:[\]]+)(?::(\d{1,5}))?$/.exec(s); if (!hp) return []; host = hp[1].toLowerCase().replace(/\.$/, ''); port = hp[2]; }
    if (port && (+port < 1 || +port > 65535)) return [];
    const local = isLocalHost(host), out = [];
    const add = (sc, p) => { try { const u = new URL(`${sc}://${host}${p ? `:${p}` : ''}`); if (u.hostname) out.push(u.origin); } catch { /* not an address */ } };
    if (scheme) { add(scheme, port); if (scheme === 'http' && !port && local) add('http', 8090); }
    else if (port) { if (local && port !== '443') add('http', port); add('https', port); }
    else if (local) { add('http', 8090); add('https'); add('http'); }
    else add('https');
    return [...new Set(out)];
  }

  /* ---- talking to a CasaTorch ---- */
  const netNow = () => ({ online: navigator.onLine !== false });
  /** Is there a CasaTorch at this address, and can this app use it? The phone itself asks (exact reasons when it can't). */
  async function probe(base, timeout = 5000) {
    if (!allowed(base)) return { ok: false, kind: 'insecure', base };
    let r;
    if (N && typeof N.probe === 'function') {
      try { r = await N.probe({ url: `${base}/api/app/hello`, timeout }); } catch (e) { r = { error: 'other', message: e.message }; }
    } else {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
      try { const x = await fetch(`${base}/api/app/hello`, { signal: ctl.signal, credentials: 'omit', cache: 'no-store' }); r = { status: x.status, json: await x.json().catch(() => null) }; }
      catch (e) { r = { error: e.name === 'AbortError' ? 'timeout' : navigator.onLine === false ? 'offline' : 'unreachable', net: netNow() }; }
      finally { clearTimeout(t); }
    }
    r = r || { error: 'other' };
    if (r.error) return { ok: false, kind: r.error, base, net: r.net || netNow() };
    if (r.status >= 300 && r.status < 400) return { ok: false, kind: 'portal', base };
    // your CasaTorch's secure address, away from home, on Basic: it says so in JSON ({ away, needsPro }) - that's an answer, not an error
    if (r.status === 403 && r.json && (r.json.needsPro || r.json.away)) return { ok: false, kind: 'needspro', base };
    if (r.status === 404) return { ok: false, kind: 'old', base };
    if (r.status >= 500) return { ok: false, kind: 'server', status: r.status, base };
    const h = r.json;
    if (r.status !== 200 || !h || h.casatorch !== true) return { ok: false, kind: 'notcasa', base, net: r.net };
    if (h.home && h.home.version && vcmp(h.home.version, MIN_SERVER) < 0) return { ok: false, kind: 'old', version: h.home.version, base, hello: h };
    const need = h.appMin || h.minApp;
    if (need && APP_VERSION && vcmp(APP_VERSION, need) < 0) return { ok: false, kind: 'appold', need, base, hello: h };
    return { ok: true, base, hello: h };
  }
  /** All at once; the best one that answers wins (in the order given). Returns { ok, base, hello } or the most telling failure. */
  async function probeAll(list, timeout = 5000) {
    const uniq = [...new Set(list.filter(Boolean))];
    if (!uniq.length) return { ok: false, kind: 'other', base: '' };
    const tries = uniq.map((b) => probe(b, timeout));
    const fails = [];
    for (const t of tries) { const r = await t; if (r.ok) return r; fails.push(r); }
    // an answer that says what's wrong beats a silence; else what the first (best) address said.
    // "away from home, that's Pro" first: the home addresses can't answer from here anyway.
    return fails.find((f) => f.kind === 'needspro') || fails.find((f) => ['appold', 'old', 'notcasa', 'portal', 'server', 'tls'].includes(f.kind) && f.base === uniq[0])
      || fails.find((f) => ['appold', 'old', 'notcasa', 'portal', 'server'].includes(f.kind)) || fails[0];
  }
  /** The best address to sign in at: its secure address (encrypted on your Wi-Fi) when this phone can reach it, else the one that answered. */
  async function bestBase(list) {
    const r = await probeAll(list);
    if (!r.ok) return r;
    if (r.hello.secure && r.hello.secure !== r.base) { const s = await probe(r.hello.secure, 4000); if (s.ok) return s; }   // some routers block it
    return r;
  }
  /** Why it didn't work, in words. */
  function explain(f) {
    const host = hostOf(f.base), local = isLocalHost(plainHost(f.base)), net = f.net || {};
    const port = (() => { try { return new URL(f.base).port; } catch { return ''; } })();
    switch (f.kind) {
      case 'offline': return T('This phone is offline. Turn off Airplane Mode or join your home Wi-Fi, then try again.');
      case 'localnet': return T('CasaTorch isn\'t allowed to reach devices on your network. Turn on Settings › CasaTorch › Local Network, then try again.');
      case 'cellular': return T('This phone is on mobile data, so it can\'t see devices at home. Join your home Wi-Fi and try again.');
      case 'timeout':
        if (local && net.wifi === false && net.cellular) return T('This phone is on mobile data, so it can\'t see devices at home. Join your home Wi-Fi and try again.');
        return T('{host} didn\'t answer. Check this phone is on your home Wi-Fi and CasaTorch is switched on.', { host });
      case 'dns': return local ? T('Nothing called {host} answered on this network. Check this phone is on your home Wi-Fi, or use its number address (like 192.168.1.20).', { host }) : T('Nothing called {host} was found. Check the spelling, or use its number address at home (like 192.168.1.20).', { host });
      case 'refused': return T('{host} is there, but CasaTorch isn\'t answering on it. Check CasaTorch is switched on and the port is right (usually 8090).', { host });
      case 'tls': return T('This phone doesn\'t trust the security certificate at {host}. If CasaTorch was reset or moved, type its plain address at home (like 192.168.1.20) and the app picks up the new secure address.', { host });
      case 'insecure': return T('{host} isn\'t on your home network and isn\'t encrypted, so the app won\'t use it. Use CasaTorch\'s secure address (it starts with https).', { host });
      case 'old': return f.version ? T('This CasaTorch ({version}) needs an update before the app can use it. On a computer, open CasaTorch › Settings › Updates & backup and update it, then try again.', { version: f.version }) : T('This CasaTorch needs an update before the app can use it. On a computer, open CasaTorch › Settings › Updates & backup and update it, then try again.');
      case 'appold': return T('This CasaTorch needs a newer version of the app ({need} or later). Update CasaTorch in the {store}.', { need: f.need, store: storeName() });
      case 'notcasa': return port === '8123' ? T('That\'s Home Assistant, not CasaTorch. CasaTorch usually uses port 8090 on the same address.') : local ? T('Something answered at {host}, but it isn\'t CasaTorch.', { host }) : T('Something answered at {host}, but it isn\'t CasaTorch. If this Wi-Fi has a sign-in page (like at a hotel or café), open your browser and sign in first.', { host });
      case 'needspro': return T('You\'re away from home. Using CasaTorch from anywhere is part of Pro (your trial includes it).');
      case 'portal': return T('This Wi-Fi wants you to sign in first (like at a hotel or café). Open your browser, sign in, then try again.');
      case 'server': return T('CasaTorch had a problem ({status}). Wait a moment and try again.', { status: f.status || 500 });
      default: return navigator.onLine === false ? T('This phone is offline. Turn off Airplane Mode or join your home Wi-Fi, then try again.') : T('Can\'t reach {host} from this phone. Check it\'s on your home Wi-Fi.', { host: host || T('your CasaTorch') });
    }
  }
  const storeName = () => (/android/i.test((N && N.platform) || navigator.userAgent) ? T('Play Store') : T('App Store'));
  /** A call to your CasaTorch's app sign-in (after the address is known to work). Errors come back as words. */
  async function j(base, path, body, { token, timeout = 15000 } = {}) {
    if (navigator.onLine === false) throw new Error(T('This phone is offline. Turn off Airplane Mode or join your home Wi-Fi, then try again.'));
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    let r;
    try { r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, credentials: 'omit', cache: 'no-store' }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? T('Your CasaTorch took too long to answer. Check this phone\'s Wi-Fi and try again.') : T('Lost the connection to your CasaTorch. Check this phone\'s Wi-Fi and try again.')); }
    finally { clearTimeout(t); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.error || (r.status === 404 ? explain({ kind: 'old', base }) : r.status >= 500 ? explain({ kind: 'server', status: r.status, base }) : T('Your CasaTorch answered {status}.', { status: r.status }));
      throw Object.assign(new Error(msg), { status: r.status, data });
    }
    return data;
  }
  const device = async () => { try { return await N.deviceInfo(); } catch { return { name: 'Phone', platform: /android/i.test(navigator.userAgent) ? 'android' : 'ios' }; } };
  /**
   * Keeps trying by itself while this screen is up: after 2, 4, 8, 15, then every 30 seconds - and at once when the
   * phone's network changes or the app comes back. attempt() returns true when it's done.
   */
  function keepTrying(gen, attempt, onWait) {
    const DELAYS = [2, 4, 8, 15, 30];
    let n = 0, timer = null, running = false, stopped = false;
    const stop = () => { stopped = true; clearInterval(timer); window.removeEventListener('online', kick); window.removeEventListener('casa:network', kick); window.removeEventListener('casa:resume', kick); document.removeEventListener('visibilitychange', vis); };
    const alive = () => !stopped && gen === S.gen;
    const run = async () => {
      if (!alive()) return stop();
      if (running) return;
      clearInterval(timer); running = true; if (onWait) onWait(0);
      let done = false; try { done = await attempt(); } catch { /* next time */ }
      running = false;
      if (done || !alive()) return stop();
      schedule();
    };
    const schedule = () => {
      let left = DELAYS[Math.min(n++, DELAYS.length - 1)];
      if (onWait) onWait(left);
      timer = setInterval(() => { if (!alive()) return stop(); left -= 1; if (left <= 0) run(); else if (onWait) onWait(left); }, 1000);
    };
    function kick() { if (!alive()) return stop(); n = 0; run(); }
    function vis() { if (document.visibilityState === 'visible') kick(); }
    window.addEventListener('online', kick); window.addEventListener('casa:network', kick); window.addEventListener('casa:resume', kick); document.addEventListener('visibilitychange', vis);
    schedule();
    return { now: kick, stop };
  }
  const waitText = (s) => (s > 0 ? T('Trying again in {n} s', { n: s }) : T('Trying…'));

  /* ---- screens ---- */
  function welcome() {
    remember('welcome');
    screen(el('div', { class: 'spacer' }),
      el('div', { class: 'logo', role: 'img', 'aria-label': 'CasaTorch', html: '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eb8ff"/><stop offset="1" stop-color="#8b7bff"/></linearGradient></defs><path d="M46 20a18 18 0 1 0 0 24" fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round"/><circle cx="46" cy="32" r="5" fill="#fbbf24"/></svg>' }),
      el('div', { class: 'stack' }, el('h1', {}, 'CasaTorch'), el('p', { class: 'tag' }, T('Your home, lit up.')), el('p', { class: 'muted' }, T('Your whole home on your phone - lights, cameras, the 3D home and alerts - straight from your own CasaTorch.'))),
      el('div', { class: 'spacer' }),
      el('div', { class: 'stack' },
        el('button', { class: 'btn primary', type: 'button', onclick: scanPair }, el('span', { html: svg('qr') }), T('Scan a pairing code')),
        el('button', { class: 'btn', type: 'button', onclick: find }, el('span', { html: svg('search') }), T('Find my CasaTorch')),
        el('button', { class: 'btn plain', type: 'button', onclick: () => address() }, T('Type its address'))),
      el('p', { class: 'foot' }, T('The pairing code is in CasaTorch on any screen you\'re signed in to: Settings › Phones & alerts › Add a phone.')));
  }

  /** Looking for CasaTorch boxes: the ones announcing themselves on this Wi-Fi (Bonjour, CasaTorch 0.7 and newer), the ones
      casatorch.com sees on this internet connection, and the usual names on the home network. */
  async function find() {
    remember('find');
    const list = el('div', { class: 'group', 'aria-live': 'polite' }, spinner(T('Looking on your home network…')));
    const status = el('p', { class: 'status small muted', 'aria-live': 'polite' });
    const gen = screen(back(welcome), el('h2', {}, T('Find my CasaTorch')), el('p', { class: 'muted' }, T('Make sure this phone is on your home Wi-Fi.')), list, status,
      el('div', { class: 'stack' }, el('button', { class: 'btn', type: 'button', onclick: () => address() }, el('span', { html: svg('keyboard') }), T('Type its address')), el('button', { class: 'btn plain', type: 'button', onclick: scanPair }, T('Scan a pairing code instead'))));
    const look = async () => {
      let seen = [];
      const nearby = N && typeof N.discover === 'function' ? N.discover({ timeout: 3000 }).then((l) => (Array.isArray(l) ? l.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 8) : [])).catch(() => []) : Promise.resolve([]);
      try { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000); const r = await fetch(FIND, { signal: ctl.signal, credentials: 'omit', cache: 'no-store' }); clearTimeout(t); seen = ((await r.json()).found || []).filter((x) => x && x.kind !== 'personal' && typeof x.url === 'string'); } catch { /* offline, or casatorch.com unreachable */ }
      // CasaTorch on a Raspberry Pi answers at casatorch.local; the Home Assistant add-on at homeassistant.local
      const names = ['http://casatorch.local:8090', 'http://homeassistant.local:8090'];
      const tries = await Promise.all([...new Set([...seen.map((x) => x.url), ...(await nearby), ...names])].map((u) => probe(u, 4500)));
      if (gen !== S.gen) return true;
      const byHome = new Map();
      for (const r of tries) {
        if (!r.ok) continue;
        const id = (r.hello.home && r.hello.home.id) || r.base, had = byHome.get(id);
        if (!had || (r.base.startsWith('https:') && !had.base.startsWith('https:'))) byHome.set(id, r);
      }
      const ok = [...byHome.values()], why = tries.find((r) => ['old', 'appold'].includes(r.kind));
      if (ok.length) {
        list.replaceChildren(...ok.map((r) => el('button', { class: 'row', type: 'button', onclick: () => chosen(r.base, r.hello) }, el('span', { class: 'ic', html: svg('home') }), el('div', { class: 'grow' }, el('b', {}, (r.hello.home && r.hello.home.name) || 'CasaTorch'), el('small', {}, hostOf(r.base))), el('span', { class: 'chev', html: svg('chev', 18) }))));
        status.textContent = '';
        haptic('light');
        return true;
      }
      const net = (tries[0] && tries[0].net) || netNow();
      const msg = why ? explain(why) : net.online === false ? explain({ kind: 'offline' }) : (net.wifi === false && net.cellular) ? explain({ kind: 'cellular' })
        : seen.length ? T('Found one on your internet connection, but this phone can\'t reach it. Is the phone on the same Wi-Fi as CasaTorch?') : T('None found yet. Check this phone is on your home Wi-Fi and CasaTorch is switched on - or type its address.');
      list.replaceChildren(el('div', { class: 'row' }, el('div', { class: 'grow' }, el('b', {}, T('None found')), el('small', { class: 'wrap' }, msg))));
      return false;
    };
    if (await look()) return;
    keepTrying(gen, look, (s) => { status.textContent = s > 0 ? T('Looking again in {n} s', { n: s }) : T('Looking…'); });
  }

  function address(prefill = '') {
    remember('address');
    const inp = el('input', { id: 'addr', type: 'url', inputmode: 'url', autocapitalize: 'none', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: '192.168.1.20', value: prefill, 'aria-describedby': 'addr-hint' });
    const err = errBox(), go = el('button', { class: 'btn primary', type: 'button' }, T('Continue'));
    const run = async () => {
      const list = addressesFrom(inp.value);
      if (!list.length) { err.textContent = inp.value.trim() ? T('That doesn\'t look like an address. Type it like 192.168.1.20 or casatorch.local.') : T('Type the address you use for CasaTorch.'); haptic('error'); return; }
      busy(go, true); err.textContent = '';
      const r = await probeAll(list);
      if (r.ok) return chosen(r.base, r.hello);
      err.textContent = explain(r); busy(go, false); haptic('error');
    };
    go.onclick = run; inp.onkeydown = (e) => { if (e.key === 'Enter') run(); };
    screen(back(welcome), el('h2', {}, T('Your CasaTorch\'s address')), el('p', { class: 'muted' }, T('The address you open CasaTorch at on a computer. At home it\'s often a number like 192.168.1.20, or casatorch.local.')),
      el('label', { class: 'field', for: 'addr' }, el('span', {}, T('Address')), inp),
      el('p', { class: 'small muted', id: 'addr-hint' }, T('No need for http:// or the port - the app tries the usual ones.')), err, go);
  }

  async function chosen(base, h) {
    const best = await bestBase([h.secure, base]);
    const b = best.ok ? best : { base, hello: h };
    S.base = b.base; S.hello = b.hello;
    if (!S.hello.signIn) {
      return screen(back(welcome), bigIcon('alert', 'calm'), el('h2', {}, S.hello.demo ? T('That\'s the demo') : T('Finish setting up first')),
        el('p', { class: 'muted' }, S.hello.demo ? T('The demo has no accounts. Point the app at your own CasaTorch.') : T('Finish setup on CasaTorch (it creates your sign-in), then come back.')),
        el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', onclick: welcome }, T('Done')));
    }
    signin();
  }
  function plainWarning() { return S.base && S.base.startsWith('http://') ? el('div', { class: 'note warn' }, el('span', { html: svg('lock', 18) }), el('span', {}, T('This address isn\'t encrypted on your Wi-Fi. Turn on CasaTorch\'s secure address (Settings › Connections & AI › Secure address at home) and the app uses it by itself.'))) : null; }
  function signin(note) {
    remember(`signin=${S.base}`);
    S.ticket = null; S.codeFails = 0;
    const u = el('input', { id: 'user', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next', placeholder: T('Name or email') });
    const p = el('input', { id: 'pass', type: 'password', autocomplete: 'current-password', enterkeyhint: 'go', placeholder: T('Password') });
    const err = errBox(note), go = el('button', { class: 'btn primary', type: 'button' }, T('Sign in'));
    const run = async () => {
      if (!u.value.trim() || !p.value) { err.textContent = T('Enter your name and password.'); (u.value.trim() ? p : u).focus(); haptic('error'); return; }
      busy(go, true); err.textContent = '';
      try { step(await j(S.base, '/api/app/login', { username: u.value.trim(), password: p.value, device: await device() })); }
      catch (e) { err.textContent = e.message; busy(go, false, T('Sign in')); haptic('error'); p.value = ''; if (e.status === 401) p.focus(); }
    };
    go.onclick = run; u.onkeydown = (e) => { if (e.key === 'Enter') p.focus(); }; p.onkeydown = (e) => { if (e.key === 'Enter') run(); };
    screen(back(welcome), el('h2', {}, T('Sign in to {name}', { name: (S.hello && S.hello.home && S.hello.home.name) || T('your home') })), el('p', { class: 'muted' }, T('The same name and password as CasaTorch on your other screens.')), plainWarning(),
      el('label', { class: 'field', for: 'user' }, el('span', {}, T('Name')), u), el('label', { class: 'field', for: 'pass' }, el('span', {}, T('Password')), p), err, go,
      el('p', { class: 'foot' }, T('Forgot your password? Someone who looks after CasaTorch can reset it in Settings › People & sign-in.')));
  }
  function step(r) {
    S.lastStep = r;
    if (r.ticket) S.ticket = r.ticket;
    if (r.recovery) S.recovery = r.recovery;
    if (r.ok && r.token) return done(r);
    if (r.step === 'mfa') return code();
    if (r.step === 'enroll') return enroll();
    if (r.step === 'terms') return terms(r.terms);
    screen(back(welcome), el('h2', {}, T('One more step')), el('p', { class: 'muted' }, T('Your CasaTorch asked for a step this app doesn\'t know yet. Update the app in the {store}, or finish signing in on another screen first.', { store: storeName() })));
  }
  /** After a while away, the sign-in ticket runs out: back to the password, with a word why. */
  const ticketGone = (e) => e.status === 401 && /sign in again|too long/i.test(e.message);
  function code() {
    const c = el('input', { id: 'code', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 11, placeholder: '000000', enterkeyhint: 'go', 'aria-describedby': 'code-hint' });
    const err = errBox(), go = el('button', { class: 'btn primary', type: 'button' }, T('Continue')), skew = el('p', { class: 'small muted', hidden: true }, T('Still not right? Check the time is set automatically on this phone and on the one with your authenticator - codes depend on the clock.'));
    let sending = false;
    const run = async () => {
      const v = c.value.replace(/\s+/g, '');
      if (sending || !v) return;
      sending = true; busy(go, true); err.textContent = '';
      try { step(await j(S.base, '/api/app/mfa', { ticket: S.ticket, code: v })); }
      catch (e) {
        sending = false; busy(go, false); haptic('error'); c.value = '';
        if (ticketGone(e)) return signin(T('That took too long, so sign in again - it only takes a moment.'));
        err.textContent = e.message; S.codeFails++; if (S.codeFails >= 2) skew.hidden = false; c.focus();
      }
    };
    go.onclick = run; c.oninput = () => { if (/^\d{6}$/.test(c.value.replace(/\s+/g, ''))) run(); }; c.onkeydown = (e) => { if (e.key === 'Enter') run(); };
    screen(back(() => signin()), el('h2', {}, T('Your 6-digit code')), el('p', { class: 'muted', id: 'code-hint' }, T('From your authenticator app. Lost it? Use one of your recovery codes (like a1b2c-d3e4f).')),
      el('label', { class: 'sr', for: 'code' }, T('Code')), c, err, skew, go);
  }
  async function enroll() {
    let e0; try { e0 = await j(S.base, '/api/app/enroll', { ticket: S.ticket }); } catch (e) { return ticketGone(e) ? signin(T('That took too long, so sign in again - it only takes a moment.')) : screen(back(() => signin()), el('h2', {}, T('Sign in again')), errBox(e.message)); }
    const optional = !S.lastStep || S.lastStep.optional !== false;
    const secret = String(e0.secret || ''), key = secret.replace(/(.{4})/g, '$1 ').trim(), uri = /^otpauth:\/\//i.test(String(e0.uri || '')) ? e0.uri : null;
    const c = el('input', { id: 'code', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '000000', enterkeyhint: 'go' });
    const err = errBox(), go = el('button', { class: 'btn primary', type: 'button' }, T('Turn on two-step sign-in'));
    let sending = false;
    const run = async () => {
      if (sending) return;
      sending = true; busy(go, true); err.textContent = '';
      try { step(await j(S.base, '/api/app/enroll', { ticket: S.ticket, code: c.value.replace(/\s+/g, '') })); }
      catch (x) { sending = false; busy(go, false, T('Turn on two-step sign-in')); haptic('error'); if (ticketGone(x)) return signin(T('That took too long, so sign in again - it only takes a moment.')); err.textContent = x.message; }
    };
    go.onclick = run; c.oninput = () => { if (/^\d{6}$/.test(c.value)) run(); };
    const copy = async () => { try { await (N && N.copy ? N.copy(secret) : navigator.clipboard.writeText(secret)); haptic('success'); return true; } catch { return false; } };
    // Your authenticator, your choice: Apple's opens straight from a link; the others take the setup key (copied for you).
    const isIos = /ios|ipados/.test((N && N.platform) || '') || /iphone|ipad/i.test(navigator.userAgent);
    const APPS = [['google', 'Google Authenticator'], ['microsoft', 'Microsoft Authenticator'], ['onepassword', '1Password'], ['authy', 'Authy'], ...(isIos ? [['apple', 'Apple Passwords']] : []), ['other', T('Another app')]];
    const how = el('div', { class: 'howto' });
    const pick = (id) => {
      for (const b of chips.children) { b.classList.toggle('on', b.dataset.id === id); b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false'); }
      const name = (APPS.find(([k]) => k === id) || [])[1] || T('your authenticator');
      if (id === 'apple' && uri) { how.replaceChildren(el('a', { class: 'btn', href: uri }, T('Add to Apple Passwords')), el('p', { class: 'small muted' }, T('Then come back here and type the 6-digit code it shows.'))); return; }
      const copied = el('span', { class: 'small muted', 'aria-live': 'polite' });
      how.replaceChildren(
        el('ol', { class: 'steps' }, el('li', {}, T('Copy your setup key:'), ' ', el('button', { class: 'btn small', type: 'button', onclick: async () => { copied.textContent = (await copy()) ? ` ${T('Copied ✓')}` : ` ${T('Select it below and copy')}`; } }, T('Copy key')), copied),
          el('li', {}, T('Open {app}, tap +, then {how} and paste it.', { app: name, how: id === 'onepassword' ? T('One-Time Password') : T('Enter a setup key') })),
          el('li', {}, T('Come back here and type the 6-digit code it shows.'))),
        el('div', { class: 'mono', 'aria-label': T('Setup key') }, key),
        ...(isIos || !uri ? [] : [el('a', { class: 'btn plain', href: uri }, T('Or open {app} directly', { app: name }))]));
    };
    const chips = el('div', { class: 'chips', role: 'group', 'aria-label': T('Which authenticator do you use?') }, ...APPS.map(([id, label]) => el('button', { class: 'chip', type: 'button', 'data-id': id, onclick: () => { haptic('light'); pick(id); } }, label)));
    pick('google');
    const qr = safeSvg(e0.qr);
    screen(back(() => signin()), el('h2', {}, T('Two-step sign-in')),
      el('p', { class: 'muted' }, optional ? T('Recommended: a 6-digit code from an authenticator app as well as your password. Even if someone learns your password, they can\'t get into your home.') : T('This home requires it: a 6-digit code from an authenticator app as well as your password.')),
      el('p', { class: 'field-label' }, T('Which authenticator do you use?')), chips, how,
      qr ? el('details', {}, el('summary', { class: 'small muted' }, T('Setting it up on another device?')), el('div', { class: 'qr' }, qr)) : null,
      el('label', { class: 'field', for: 'code' }, el('span', {}, T('The 6-digit code')), c), err, go,
      optional ? el('button', { class: 'btn plain', type: 'button', onclick: async (e) => { const b = e.currentTarget; busy(b, true); try { step(await j(S.base, '/api/app/enroll', { ticket: S.ticket, skip: true })); } catch (x) { if (ticketGone(x)) return signin(T('That took too long, so sign in again - it only takes a moment.')); err.textContent = x.message; busy(b, false, T('Not now')); } } }, T('Not now')) : null,
      optional ? el('p', { class: 'foot' }, T('You can turn it on later in Settings › People & sign-in.')) : null);
  }
  function terms(version) {
    const go = el('button', { class: 'btn primary', type: 'button' }, T('Agree and continue')), err = errBox();
    go.onclick = async () => { busy(go, true); try { step(await j(S.base, '/api/app/terms', { ticket: S.ticket, accept: true })); } catch (e) { busy(go, false); if (ticketGone(e)) return signin(T('That took too long, so sign in again - it only takes a moment.')); err.textContent = e.message; } };
    screen(back(() => signin()), el('h2', {}, T('The terms')), el('p', { class: 'muted' }, T('CasaTorch\'s terms of use and privacy notice ({version}).', { version: version || '' })),
      el('div', { class: 'stack' }, el('button', { class: 'btn', type: 'button', onclick: () => N && N.openExternal(`${S.base}/terms.html`) }, T('Read the terms')), el('button', { class: 'btn', type: 'button', onclick: () => N && N.openExternal(`${S.base}/privacy.html`) }, T('Read the privacy notice'))), err, go);
  }
  /* Signed in: keep the home (the token goes to the phone's secure storage), then Face ID and alerts. */
  async function done(r) {
    S.token = r.token; S.home = r.home; S.user = r.user;
    remember('homes');   // from here on, a reload goes to your homes (the sign-in is kept)
    const a = (r.home && r.home.addresses) || {};
    try { await N.saveHome({ id: r.home.id, name: r.home.name, token: r.token, user: { name: (r.user && (r.user.name || r.user.username)) || '', role: (r.user && r.user.role) || '' }, addresses: { lan: a.lan, remote: a.remote, plain: a.plain, here: S.base } }); }
    catch (e) { haptic('error'); return screen(bigIcon('lock', 'calm'), el('h2', {}, T('Couldn\'t keep the sign-in')), errBox(e.message), el('div', { class: 'spacer' }), el('button', { class: 'btn primary', type: 'button', onclick: () => done(r) }, T('Try again')), el('button', { class: 'btn plain', type: 'button', onclick: welcome }, T('Start over'))); }
    haptic('success');
    if (S.recovery) return recovery();
    faceId();
  }
  function recovery() {
    const codes = S.recovery || [];
    screen(bigIcon('lock'), el('h2', {}, T('Your recovery codes')), el('p', { class: 'muted' }, T('If you ever lose your authenticator, each of these signs you in once. Keep them somewhere safe - a password manager is ideal.')),
      el('div', { class: 'codes', role: 'list', 'aria-label': T('Your recovery codes') }, codes.map((x) => el('span', { role: 'listitem' }, x))),
      el('button', { class: 'btn', type: 'button', onclick: () => N && N.share({ text: `${T('CasaTorch recovery codes for {home}:', { home: (S.home && S.home.name) || T('your home') })}\n${codes.join('\n')}` }).catch(() => {}) }, T('Save them…')),
      el('button', { class: 'btn primary', type: 'button', onclick: () => { S.recovery = null; faceId(); } }, T('I\'ve saved them')));
  }
  async function faceId() {
    let b = { available: false }; try { b = await N.biometrics(); } catch { /* none */ }
    if (!b.available || b.enabled) return alerts();
    const name = { faceID: 'Face ID', touchID: 'Touch ID', opticID: 'Optic ID', fingerprint: T('your fingerprint'), face: T('face unlock') }[b.type] || 'Face ID';
    const on = el('button', { class: 'btn primary', type: 'button' }, T('Use {name}', { name }));
    on.onclick = async () => { busy(on, true); try { if (await N.setBiometricLock(true)) haptic('success'); } catch { /* they said no */ } alerts(); };
    screen(el('div', { class: 'spacer' }), bigIcon('face'), el('h2', {}, T('Unlock with {name}?', { name })), el('p', { class: 'muted' }, T('CasaTorch opens with {name} - your sign-in is kept in this phone\'s secure storage and only comes out when it\'s you. Recommended.', { name })),
      el('div', { class: 'spacer' }), on, el('button', { class: 'btn plain', type: 'button', onclick: alerts }, T('Not now')));
  }
  async function alerts() {
    const on = el('button', { class: 'btn primary', type: 'button' }, T('Turn on alerts')), err = errBox();
    on.onclick = async () => {
      busy(on, true); err.textContent = '';
      try {
        const p = await N.pushEnable(), opt = { token: S.token };
        try { await j(S.base, '/api/app/push', { ...p, level: 'important' }, opt); }
        catch (e) { if (p.platform !== 'apns' || e.status !== 400) throw e; await j(S.base, '/api/app/push', { ...p, platform: 'ios', level: 'important' }, opt); }   // a CasaTorch before 0.8.1 knows Apple's tokens as "ios"
        // the first test alert: only "not switched on yet" (casatorch.com can't send for this app) holds things up
        let off = false;
        try { await j(S.base, '/api/app/push/test', {}, opt); } catch (e) { off = !!(e.data && e.data.unavailable); }
        if (off) { err.textContent = T('Phone alerts aren\'t switched on for this CasaTorch app yet. This phone is set - alerts start by themselves once they are.'); busy(on, false, T('Continue')); on.onclick = finish; haptic('warning'); return; }
        haptic('success'); finish();
      } catch (e) { err.textContent = e.message; busy(on, false, T('Try again')); haptic('error'); }
    };
    screen(el('div', { class: 'spacer' }), bigIcon('bell'), el('h2', {}, T('Alerts on this phone?')), el('p', { class: 'muted' }, T('Water, smoke, the doorbell, a device going offline, your reminders - even when the app is closed. Encrypted by your CasaTorch; only this phone can read them.')),
      el('div', { class: 'spacer' }), err, on, el('button', { class: 'btn plain', type: 'button', onclick: finish }, T('Not now')));
  }
  function finish() { if (N && S.home) N.openHome(S.home.id); }

  /* ---- pairing with a code from a signed-in screen ---- */
  async function scanPair() {
    let link; try { link = await N.scanQR(); } catch (e) { return pairCode(e.message); }
    if (!link) return;   // cancelled
    pairFrom(link);
  }
  async function pairFrom(link) {
    remember('welcome');   // the code works once: a reload mustn't try it again
    let u; try { u = new URL(String(link).replace(/^casatorch:\/\/pair/i, 'https://x/pair')); } catch { return pairCode(T('That isn\'t a CasaTorch pairing code.')); }
    const q = u.searchParams, code = q.get('c');
    if (!code) return pairCode(T('That isn\'t a CasaTorch pairing code.'));
    if (q.get('v') && +q.get('v') > PAIR_FORMAT) return needsAppUpdate();
    const name = q.get('n') || T('your home');
    const status = el('p', { class: 'status small muted', 'aria-live': 'polite' }), msg = el('p', { class: 'muted' }, T('Reaching {name}…', { name }));
    const gen = screen(back(welcome), el('div', { class: 'spacer' }), el('div', { class: 'center stack' }, el('span', { class: 'spin big', 'aria-hidden': 'true' }), el('h2', {}, T('Pairing with {name}', { name })), msg, status), el('div', { class: 'spacer' }),
      el('button', { class: 'btn plain', type: 'button', onclick: welcome }, T('Cancel')));
    const addrs = [q.get('l'), q.get('h'), q.get('r'), q.get('p')].filter((x) => x && /^https?:\/\//i.test(x)).map((x) => { try { return new URL(x).origin; } catch { return null; } }).filter(Boolean);
    const attempt = async () => {
      const best = await bestBase(addrs);
      if (gen !== S.gen) return true;
      if (!best.ok) { msg.textContent = explain(best); return false; }
      S.base = best.base; S.hello = best.hello;
      msg.textContent = T('Signing in…');
      try { done(await j(S.base, '/api/app/claim', { code, device: await device() })); }
      catch (e) { if (gen === S.gen) pairFailed(e); }
      return true;
    };
    if (await attempt()) return;
    haptic('error');
    keepTrying(gen, attempt, (s) => { status.textContent = waitText(s); });
  }
  /** The code was used already, ran out (10 minutes), or was mistyped. */
  function pairFailed(e) {
    haptic('error');
    screen(back(welcome), bigIcon('qr', 'calm'), el('h2', {}, T('That pairing code didn\'t work')),
      el('p', { class: 'muted' }, e.status === 401 ? T('Each code works once, for 10 minutes. Make a new one in CasaTorch: Settings › Phones & alerts › Add a phone.') : e.message),
      el('div', { class: 'spacer' }), el('button', { class: 'btn primary', type: 'button', onclick: scanPair }, el('span', { html: svg('qr') }), T('Scan a new code')), el('button', { class: 'btn plain', type: 'button', onclick: () => pairCode() }, T('Type the code instead')));
  }
  function needsAppUpdate() {
    screen(back(welcome), bigIcon('update', 'calm'), el('h2', {}, T('Update the app')), el('p', { class: 'muted' }, T('This pairing code is from a newer CasaTorch than this app knows. Update CasaTorch in the {store}, then scan again.', { store: storeName() })), el('div', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', onclick: welcome }, T('Done')));
  }
  function pairCode(msg) {
    remember('paircode');
    const c = el('input', { id: 'pc', class: 'code pair', autocapitalize: 'characters', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', maxlength: 11, placeholder: 'ABCDE-12345', enterkeyhint: 'next' });
    const a = el('input', { id: 'pa', type: 'url', inputmode: 'url', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: '192.168.1.20', value: S.base ? hostOf(S.base) : '' });
    const err = errBox(msg), go = el('button', { class: 'btn primary', type: 'button' }, T('Pair'));
    c.oninput = () => { const v = c.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); const f = v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v; if (f !== c.value) c.value = f; };
    const run = async () => {
      const code = c.value.replace(/[^A-Za-z0-9]/g, '');
      if (code.length < 10) { err.textContent = T('The code has 10 letters and numbers, like ABCDE-12345.'); c.focus(); haptic('error'); return; }
      const list = addressesFrom(a.value); if (!list.length) { err.textContent = T('Type the CasaTorch\'s address too.'); a.focus(); haptic('error'); return; }
      busy(go, true); err.textContent = '';
      const best = await bestBase(list);
      if (!best.ok) { err.textContent = explain(best); busy(go, false, T('Pair')); haptic('error'); return; }
      S.base = best.base; S.hello = best.hello;
      try { done(await j(S.base, '/api/app/claim', { code, device: await device() })); }
      catch (e) { if (e.status === 401) return pairFailed(e); err.textContent = e.message; busy(go, false, T('Pair')); haptic('error'); }
    };
    go.onclick = run; c.onkeydown = (e) => { if (e.key === 'Enter') a.focus(); }; a.onkeydown = (e) => { if (e.key === 'Enter') run(); };
    screen(back(welcome), el('h2', {}, T('Type the pairing code')), el('p', { class: 'muted' }, T('It\'s under the QR code in CasaTorch: Settings › Phones & alerts › Add a phone.')),
      el('label', { class: 'field', for: 'pc' }, el('span', {}, T('Code')), c), el('label', { class: 'field', for: 'pa' }, el('span', {}, T('Address')), a), err, go);
  }

  /* ---- your homes ---- */
  const lastSeen = (iso) => {
    const t = Date.parse(iso || ''); if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return T('just now'); if (m < 60) return T('{n} minutes ago', { n: m });
    const h = Math.round(m / 60); if (h < 24) return h === 1 ? T('an hour ago') : T('{n} hours ago', { n: h });
    try { return new Date(t).toLocaleDateString(LANG === 'en' ? undefined : LANG, { month: 'short', day: 'numeric' }); } catch { return ''; }
  };
  async function homes() {
    remember('homes');
    let list = []; try { list = await N.homes(); } catch { /* none */ }
    if (!list.length) return welcome();
    const rows = el('div', { class: 'group' }, ...list.map((h) => el('button', { class: 'row', type: 'button', onclick: () => { haptic('light'); N.openHome(h.id); } }, el('span', { class: 'ic', html: svg('home') }),
      el('div', { class: 'grow' }, el('b', {}, h.name), el('small', {}, [(h.user && h.user.name) || '', h.last ? T('last opened {when}', { when: lastSeen(h.last) }) : ''].filter(Boolean).join(' · '))), el('span', { class: 'chev', html: svg('chev', 18) }))));
    screen(el('h1', {}, T('Your homes')), rows, el('button', { class: 'btn', type: 'button', onclick: welcome }, el('span', { html: svg('plus') }), T('Add a home')),
      el('div', { class: 'spacer' }), el('div', { class: 'group' }, ...list.map((h) => el('button', { class: 'row', type: 'button', onclick: () => confirmRemove(h) }, el('div', { class: 'grow' }, el('b', { class: 'danger-text' }, T('Sign out of {name}', { name: h.name })), el('small', {}, T('Removes it from this phone')))))));
  }
  function confirmRemove(h) {
    const go = el('button', { class: 'btn danger', type: 'button' }, T('Sign out'));
    go.onclick = async () => { busy(go, true); try { await N.removeHome(h.id); haptic('success'); } catch { /* gone already */ } homes(); };
    screen(back(homes), el('h2', {}, T('Sign out of {name}?', { name: h.name })), el('p', { class: 'muted' }, T('This phone forgets the sign-in and stops getting its alerts. You can sign in again any time.')),
      el('div', { class: 'spacer' }), go, el('button', { class: 'btn plain', type: 'button', onclick: homes }, T('Cancel')));
  }
  /** Can't reach your home: calm, says why if it can, and keeps trying by itself - it opens your home as soon as it answers. */
  async function unreachable(id) {
    remember(`unreachable=${id}`);
    let h = null; try { h = (await N.homes()).find((x) => x.id === id); } catch { /* none */ }
    if (!h) return homes();
    const ad = h.addresses || {}, addrs = [ad.here, ad.lan, ad.remote, ad.plain].filter(Boolean);
    const why = el('p', { class: 'muted', 'aria-live': 'polite' }, T('This phone can\'t get to your CasaTorch right now. It may be switched off, or this phone isn\'t on your home Wi-Fi.'));
    const status = el('p', { class: 'status small muted', 'aria-live': 'polite' });
    const retry = el('button', { class: 'btn primary', type: 'button' }, T('Try now'));
    const away = ad.remote ? null : el('div', { class: 'note' }, el('span', { html: svg('wifi', 18) }), el('span', {}, T('Away from home: coming with Secure access (Pro). For now the app connects on your home Wi-Fi.')));
    const title = el('h2', {}, T('Can\'t reach {name}', { name: h.name })), icon = bigIcon('wifi', 'calm');
    const gen = screen(el('div', { class: 'spacer' }), icon, title, why, away,
      h.last ? el('p', { class: 'small muted' }, T('Last connected {when}.', { when: lastSeen(h.last) })) : null,
      el('div', { class: 'spacer' }), status, retry, el('button', { class: 'btn plain', type: 'button', onclick: homes }, T('Your homes')));
    const attempt = async () => {
      const r = await probeAll(addrs, 5000);
      if (gen !== S.gen) return true;
      if (r.ok) {
        haptic('success'); status.textContent = T('Opening {name}…', { name: h.name }); retry.disabled = true;
        N.openHome(id);
        setTimeout(() => { if (gen === S.gen) unreachable(id); }, 15000);   // still here: the app couldn't open it after all
        return true;
      }
      // away from home on Basic: a clear screen of its own, never a generic error (it opens by itself once home, or with Pro)
      const pro = r.kind === 'needspro';
      title.textContent = pro ? T('You\'re away from home') : T('Can\'t reach {name}', { name: h.name });
      why.textContent = pro ? T('Using CasaTorch from anywhere is part of Pro (your trial includes it). On your home Wi-Fi it opens as usual.') : explain(r);
      icon.innerHTML = svg(pro ? 'lock' : 'wifi');
      retry.textContent = pro ? T('Try again') : T('Try now');
      if (away) away.hidden = pro;
      return false;
    };
    const loop = keepTrying(gen, attempt, (s) => { status.textContent = waitText(s); retry.disabled = s === 0; });
    retry.onclick = () => { haptic('light'); loop.now(); };
  }
  function signedOut(id) {
    remember(`signedout=${id}`);
    const go = el('button', { class: 'btn primary', type: 'button' }, T('Sign in again')), err = errBox();
    go.onclick = async () => {
      busy(go, true); err.textContent = '';
      let h = null; try { h = (await N.homes()).find((x) => x.id === id); } catch { /* none */ }
      if (!h) return welcome();
      const ad = h.addresses || {}, best = await bestBase([ad.lan, ad.here, ad.remote, ad.plain]);
      if (best.ok) { S.base = best.base; S.hello = best.hello; return signin(); }
      err.textContent = explain(best); busy(go, false, T('Try again')); haptic('error');
    };
    screen(el('div', { class: 'spacer' }), bigIcon('lock', 'calm'), el('h2', {}, T('Signed out')), el('p', { class: 'muted' }, T('This phone was signed out of your CasaTorch (from Settings, or the sign-in ran out). Sign in again to carry on.')),
      el('div', { class: 'spacer' }), err, go, el('button', { class: 'btn plain', type: 'button', onclick: homes }, T('Your homes')));
  }
  /** Back at the sign-in after the app was closed in the background: the address still works? Then the password, else the address. */
  async function resumeSignin(base) {
    const gen = screen(el('div', { class: 'spacer' }), el('div', { class: 'center stack' }, el('span', { class: 'spin big', 'aria-hidden': 'true' }), el('p', { class: 'muted' }, T('Reaching {host}…', { host: hostOf(base) }))), el('div', { class: 'spacer' }));
    const r = await probe(base, 5000);
    if (gen !== S.gen) return;
    if (r.ok) { S.base = r.base; S.hello = r.hello; return signin(); }
    address(hostOf(base));
  }

  /* ---- routing: the app opens this page at #welcome, #homes, #pair=<link>, #unreachable=<id> or #signedout=<id> ---- */
  function route() {
    const raw = location.hash.slice(1), i = raw.indexOf('='), k = i < 0 ? raw : raw.slice(0, i);
    let v = i < 0 ? '' : raw.slice(i + 1); try { v = decodeURIComponent(v); } catch { /* as is */ }
    if (!N) return screen(el('h2', {}, 'CasaTorch'), el('p', { class: 'muted' }, T('Open this in the CasaTorch app.')));
    if (k === 'pair' && v) return pairFrom(v);
    if (k === 'unreachable' && v) return unreachable(v);
    if (k === 'signedout' && v) return signedOut(v);
    if (k === 'signin' && v && allowed(v)) return resumeSignin(v);
    if (k === 'welcome') return welcome();
    if (k === 'find') return find();
    if (k === 'address') return address();
    if (k === 'paircode') return pairCode();
    return homes();
  }
  /** The Android back gesture, the iPad edge swipe and Escape: the screen's own Back, if it has one. */
  window.__casaBack = () => { if (S.onBack) { haptic('light'); S.onBack(); return true; } return false; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) window.__casaBack(); });
  window.addEventListener('hashchange', route);
  window.addEventListener('casa:pair', (e) => pairFrom(e.detail));   // a pairing link opened from the camera app
  route();
})();
