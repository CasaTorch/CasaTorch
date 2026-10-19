/* ======================================================================
 * CasaTorch dashboard - the shell: side rail (bottom bar on phones), the
 * page title, the Pro banner, and helpers every tab shares. Tabs are
 * { id, label, icon, pro?, render(main) }; render may return a refresh
 * function (called every 30 s while the tab is open).
 * ====================================================================== */
const $ = (s, root = document) => root.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
/* Icons: 24x24 strokes, drawn here so CasaTorch needs nothing from the internet. */
const ICONS = {
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6', paw: 'M5.7 10.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M14.7 10.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M8.4 6.5a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0M12.2 6.5a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0M12 13c-2.8 0-5 3-5 5 0 1.8 1.8 2.2 5 1.3 3.2.9 5 .5 5-1.3 0-2-2.2-5-5-5z',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7zM8.5 8.5l7 7', bill: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3', plant: 'M12 21v-8M12 13c0-4 3-7 7-7 0 4-3 7-7 7zM12 15c0-3-2-5-6-5 0 3 2 5 6 5zM7 21h10',
  cake: 'M4 21h16M5 21v-7h14v7M5 16.5c2 1.5 4.5 1.5 7 0s5-1.5 7 0M12 14v-4M12 7.5c-.9 0-1.4-.7-1.4-1.4 0-.9 1.4-2.6 1.4-2.6s1.4 1.7 1.4 2.6c0 .7-.5 1.4-1.4 1.4z', car: 'M3 17v-4l2-5h14l2 5v4H3zM6 13h12M7 17v2M17 17v2M7 15h.01M17 15h.01',
  school: 'M7 9a5 5 0 0 1 10 0v11H7zM10 4h4M7 13h10M10 13v3h4v-3', laundry: 'M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3c-1 1.5-2.5 2-4 2S9 4.5 8 3z',
  home: 'M3 11 12 3l9 8M5 9.5V21h14V9.5M10 21v-6h4v6', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0', sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  camera: 'M3 8h3l2-3h8l2 3h3v11H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h0', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10', spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3', news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3', list: 'M9 6h11M9 12h11M9 18h11M4 6h0M4 12h0M4 18h0',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  thermo: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', door: 'M6 3h12v18H6zM14 12h.01', drop: 'M12 3s7 7.6 7 12a7 7 0 0 1-14 0c0-4.4 7-12 7-12z', fire: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-4 3 0-2-1-4-2-6-1 4-4 7-4 12a7 7 0 0 0 7 7z', dotc: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  pause: 'M8 5v14M16 5v14', grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', log: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2', palette: 'M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1 3.7A2 2 0 0 1 12 21zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01M17.5 11.5h.01', link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1', download: 'M12 3v12M7 10l5 5 5-5M5 21h14', info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7h.01', help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01', grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01', x: 'M6 6l12 12M18 6 6 18', plus: 'M12 5v14M5 12h14', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', check: 'M20 6 9 17l-5-5', checkc: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z', fan: 'M12 12a2 2 0 1 0 0-.01M12 10c0-4 1-7 4-7s2 5-2 7M14 12c4 0 7 1 7 4s-5 2-7-2M12 14c0 4-1 7-4 7s-2-5 2-7M10 12c-4 0-7-1-7-4s5-2 7 2', blinds: 'M4 3h16M5 3v14M19 3v14M5 7h14M5 11h14M5 15h14M12 17v3M10 21h4', play: 'M7 4l13 8-13 8z', vacuum: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 13h3M16 13h3', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', gauge: 'M12 21a9 9 0 1 1 9-9M12 12l5-5M4.6 16h14.8', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5', chevl: 'M15 18l-6-6 6-6', chevr: 'M9 18l6-6-6-6', expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 10a1.5 1.5 0 1 0 0-.01', alarm: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5M5 3 2 6M19 3l3 3',
};
const icon = (name, size) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); if (size) { s.setAttribute('width', size); s.setAttribute('height', size); } s.innerHTML = `<path d="${ICONS[name] || ICONS.dotc}"/>`; return s; };
/* ---- Talking to the CasaTorch over any network (home Wi-Fi, mobile data through secure access, a train tunnel) ----
   Every request has a time limit (a connection the network change left dead never answers - it would wait forever);
   a read that fails or times out is tried once more; the same read asked twice at once is asked once; the pages'
   own reads stop when you leave the page. Pages draw at once from the last answer they had (kept in memory and, for
   the everyday pages, a small copy in this browser - home data only, never sign-ins or keys, wiped on sign-out),
   then catch up when the live answer lands. makeNet has no DOM in it: test/net-unit.mjs tests it in Node. */
/* @net:start */
/* Kept in this browser between visits (the everyday pages; home data only): */
const NET_KEPT = /^\/api\/(home|alerts|devices|settings|layout|page-layout\/[\w-]+|ui|status|status-bar|updates|energy(\/[\w-]+)?|network|internet|calendar|mycal|nudges(\/active)?|household|family(\/(chips|meals))?|w\/(weather|sun|sports|stocks|teams|leagues)|photos|monitors|security|safety|reports|auth\/me|history|radar\/frames|apptests|frigate\/events)$/;
/* Never drawn from an older answer (a step-by-step flow, a search, a job's progress), even in memory: */
const NET_LIVE_ONLY = /^\/api\/(ha\/|find|live\/|app\/|support|doctor|system|w\/places|catalog|connections|integrations|local-https|remote|updates\/|apptests\/|plan|floorplan|scan|internet\/speedtest|camera|cam|snap)/;
const NET_SECRET = /(token|secret|password|passkey|session|mfa|2fa|totp|recover|backup|support|pair|push|users|admin|license|keys?\b|log\b|doctor|setup)/i;
const NET_RETRY_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);   // the tunnel or the box restarting
const NET_HEAVY = /^\/api\/(history|reports|network|energy|security|photos|calendar|mycal|frigate|system|radar|monitors)/;
const NET_SLOW = /^\/api\/(doctor|apptests\/|support|find|ha\/|setup|backup|updates|system\/log|local-https|connections|integrations|family\/setup|household\/setup|plan|floorplan|scan)/;
/* What's kept of an answer in this browser: /api/auth/me without the list of sign-ins and addresses. */
const NET_KEEP = { '/api/auth/me': (j) => ({ signIn: j.signIn, user: j.user ? { id: j.user.id, name: j.user.name, role: j.user.role, panel: j.user.panel, twoStep: j.user.twoStep } : null, terms: j.terms, needsTerms: j.needsTerms }) };
function makeNet(o = {}) {
  const fetchFn = o.fetch, store = o.store || null, now = o.now || (() => Date.now()), sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const P = 'casa.c1:', BUDGET = o.budget || 1_500_000, MAX_ONE = o.maxOne || 300_000, FRESH_MS = o.freshMs ?? 2000;
  const mem = new Map(), flights = new Map(), listeners = new Set();
  const st = { okAt: 0, failAt: 0, epoch: 0, mutatedAt: 0, served: new Map() };
  const emit = (what, url) => { for (const f of listeners) { try { f(what, url); } catch { /* a listener's own problem */ } } };
  const pathOf = (url) => String(url).replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
  const swrOk = (url) => { const p = pathOf(url); return p.startsWith('/api/') && !NET_LIVE_ONLY.test(p) && !NET_SECRET.test(p); };
  const keptOk = (url) => NET_KEPT.test(pathOf(url)) && swrOk(url);
  const err = (name, message, extra = {}) => Object.assign(new Error(message), { name, ...extra });
  const timeoutFor = (method, url, t) => (t != null ? t : method === 'GET' || method === 'HEAD' ? (NET_SLOW.test(pathOf(url)) ? 60_000 : NET_HEAVY.test(pathOf(url)) ? 15_000 : 8_000) : NET_SLOW.test(pathOf(url)) ? 120_000 : 30_000);
  const backoff = () => 250 + Math.floor(Math.random() * 350);
  const degraded = () => st.failAt > st.okAt && now() - st.failAt < 120_000;
  /* ---- this browser's copy ---- */
  let idx = null;
  const sget = (k) => { try { return store ? store.get(k) : null; } catch { return null; } };
  const sset = (k, v) => { try { if (store) store.set(k, v); return true; } catch { return false; } };
  const sdel = (k) => { try { if (store) store.del(k); } catch { /* fine */ } };
  const index = () => { if (idx) return idx; try { idx = JSON.parse(sget(`${P}idx`) || '{}') || {}; } catch { idx = {}; } return idx; };
  const saveIdx = () => sset(`${P}idx`, JSON.stringify(idx || {}));
  const evict = (need) => {
    const i = index(), list = Object.entries(i).sort((a, b) => a[1].at - b[1].at);
    let total = list.reduce((n, [, v]) => n + v.n, 0);
    while (list.length && total + need > BUDGET) { const [u, v] = list.shift(); sdel(P + u); delete i[u]; total -= v.n; }
  };
  function persist(url, text, at) {
    if (!store || !keptOk(url)) return;
    let keep = text;
    const tidy = NET_KEEP[pathOf(url)];
    if (tidy) { try { keep = JSON.stringify(tidy(JSON.parse(text))); } catch { return; } }
    if (keep.length > MAX_ONE) return;
    const i = index(), v = JSON.stringify({ at, t: keep });
    delete i[url]; evict(v.length);
    if (!sset(P + url, v)) { evict(BUDGET / 2 + v.length); if (!sset(P + url, v)) { saveIdx(); return; } }
    i[url] = { n: v.length, at }; saveIdx();
  }
  function load(url) {
    if (!store || !keptOk(url)) return null;
    const raw = sget(P + url); if (!raw) return null;
    try { const v = JSON.parse(raw); if (typeof v?.t !== 'string') return null; const e = { text: v.t, at: v.at || 0, fresh: 0 }; mem.set(url, e); return e; } catch { return null; }
  }
  function remember(url, text) {
    const old = mem.get(url), at = now();
    mem.set(url, { text, at, fresh: at });
    if (mem.size > 300) mem.delete(mem.keys().next().value);
    if (!old || old.text !== text || at - (old.at || 0) > 60_000) persist(url, text, at);
    return old;
  }
  /* ---- one request: a time limit, one more try for a read, shared by everyone asking at once ---- */
  function attempt(url, init, ms, f) {
    const ctl = new AbortController(); f.ctl = ctl;
    const timer = ms ? setTimeout(() => ctl.abort(err('TimeoutError', 'The CasaTorch took too long to answer.', { retry: true })), ms) : null;
    return Promise.resolve().then(() => fetchFn(url, { ...init, signal: ctl.signal })).then(async (r) => ({ status: r.status, ok: r.ok, text: await r.text() }))
      .catch((e) => { throw (ctl.signal.aborted && ctl.signal.reason?.name ? ctl.signal.reason : err('NetworkError', 'Can\'t reach the CasaTorch right now.', { retry: true, cause: e })); })
      .finally(() => clearTimeout(timer));
  }
  async function run(url, init, f, ms) {
    for (let i = 0; ; i++) {
      try {
        const r = await attempt(url, init, ms, f);
        if (f.idem && i === 0 && NET_RETRY_STATUS.has(r.status) && !f.cancelled) { await sleep(backoff()); continue; }
        return r;
      } catch (e) {
        if (f.cancelled || !f.idem || !e.retry || i > 0 && e.name !== 'Reset' || i > 2) throw e;
        if (e.name !== 'Reset') { st.failAt = now(); emit('state'); }   // pages draw from their last answers at once from here on
        await sleep(e.name === 'Reset' ? 0 : backoff());   // the network changed: again at once, on a new connection
      }
    }
  }
  const abortErr = () => err('AbortError', 'Cancelled.', { aborted: true });
  function join(f, signal) {
    if (!signal) { f.pinned = true; return f.p; }   // someone without a way to cancel keeps it going
    if (signal.aborted) return Promise.reject(abortErr());
    f.users++;
    return new Promise((res, rej) => {
      const off = () => {
        f.users--; rej(abortErr());
        if (f.users <= 0 && !f.pinned && !f.cancelled) { f.cancelled = true; if (flights.get(f.key) === f) flights.delete(f.key); f.ctl?.abort(abortErr()); }
      };
      signal.addEventListener('abort', off, { once: true });
      f.p.then((v) => { signal.removeEventListener('abort', off); res(v); }, (e) => { signal.removeEventListener('abort', off); rej(e); });
    });
  }
  function request(url, init = {}, { signal, timeout } = {}) {
    const method = String(init.method || 'GET').toUpperCase(), idem = (method === 'GET' || method === 'HEAD') && init.body == null;
    if (!idem) { st.epoch++; st.mutatedAt = now(); for (const e of mem.values()) e.fresh = 0; }   // a change: nothing read before it counts as fresh
    const key = idem ? `${method} ${url}` : null;
    let f = key ? flights.get(key) : null;
    if (!f || f.epoch !== st.epoch || f.cancelled) {
      f = { key, users: 0, pinned: false, idem, epoch: st.epoch, ctl: null, cancelled: false };
      f.p = run(url, init, f, timeoutFor(method, url, timeout))
        .then((r) => { if (r.status < 500 || !NET_RETRY_STATUS.has(r.status)) { st.okAt = now(); } else st.failAt = now(); emit('state'); return r; },
          (e) => { if (!e.aborted) { st.failAt = now(); emit('state'); } throw e; })
        .finally(() => { if (key && flights.get(key) === f) flights.delete(key); });
      f.p.catch(() => {});   // everyone may have left: not an unhandled rejection
      if (key) flights.set(key, f);
    }
    return join(f, signal);
  }
  /* ---- a read that can draw from the last answer ---- */
  async function get(url, { signal, timeout, patience, init = {} } = {}) {
    if (!swrOk(url)) return request(url, init, { signal, timeout });
    const hit = mem.get(url) || load(url);
    if (hit && hit.fresh && now() - hit.fresh < FRESH_MS) return { status: 200, ok: true, text: hit.text, at: hit.at };   // just asked: the same answer
    const p = request(url, init, { signal, timeout }).then((r) => {
      if (r.status === 200) {
        const old = remember(url, r.text);
        if (st.served.has(url)) { st.served.delete(url); if (old && old.text !== r.text) emit('fresh', url); emit('state'); }
      }
      return r;
    });
    if (!hit) return p;
    const wait = patience != null ? patience : degraded() ? 0 : now() - st.mutatedAt < 5000 ? 2500 : 350;
    const STALE = {}; let timer = null;
    const stale = () => { if (!st.served.has(url)) st.served.set(url, { at: hit.at, since: now() }); p.catch(() => {}); emit('state'); return { status: 200, ok: true, text: hit.text, at: hit.at, stale: true }; };
    try {
      const r = await Promise.race([p, new Promise((res) => { timer = setTimeout(res, wait, STALE); })]);
      clearTimeout(timer);
      if (r === STALE) return stale();   // no answer yet: the last one now, the live one when it lands
      if (NET_RETRY_STATUS.has(r.status)) return stale();   // the tunnel or the box is down: the last answer, marked
      return r;
    } catch (e) {
      clearTimeout(timer);
      if (e.aborted) throw e;
      return stale();
    }
  }
  function reset() {   // the network changed: every read in flight starts again on a new connection
    for (const f of flights.values()) if (f.idem && f.ctl && !f.ctl.signal.aborted) f.ctl.abort(err('Reset', 'The network changed.', { retry: true }));
  }
  function clear() {
    mem.clear(); st.served.clear();
    try { for (const k of store ? store.keys() : []) if (k.startsWith(P)) sdel(k); } catch { /* fine */ }
    idx = {};
  }
  function scope(who) {   // a different person signed in on this browser: nothing of the last one's is shown
    const k = `${P}who`, w = String(who || '');
    if (!store || !w) return;
    const was = sget(k);
    if (was && was !== w) clear();
    if (was !== w) sset(k, w);
  }
  const status = () => {
    const v = [...st.served.values()], waiting = v.length ? now() - Math.min(...v.map((x) => x.since)) : 0;
    // still no answer 6 s after drawing from the last one: as good as offline, and said so
    return { offline: degraded() || waiting > 6000, stale: v.length > 0, since: v.length ? Math.min(...v.map((x) => x.at)) : 0, waiting, busy: flights.size, okAt: st.okAt, failAt: st.failAt };
  };
  return { get, request, reset, clear, scope, status, page: () => { st.served.clear(); emit('state'); }, on: (f) => listeners.add(f), peek: (url) => mem.get(url) || load(url), _st: st };
}
/* @net:end */
const NET = makeNet({
  fetch: (u, i) => fetch(u, i),
  store: (() => { try { const ls = window.localStorage; ls.getItem('casa.c1:who'); return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v), del: (k) => ls.removeItem(k), keys: () => Object.keys(ls) }; } catch { return null; } })(),
});
let pageCtl = new AbortController();   // the reads of the page on show: they stop when you leave it
/* Signing out (from anywhere: Settings, Security, the app) wipes this browser's copy of the home's data first. */
{
  const f0 = window.fetch;
  window.fetch = function casaFetch(input, init) {
    try { if (String(init?.method || input?.method || 'GET').toUpperCase() === 'POST' && /\/api\/(auth\/logout|logout|app\/signout)(\?|$)/.test(String(input?.url || input))) NET.clear(); } catch { /* fine */ }
    return f0.apply(window, arguments);
  };
}
const api = async (url, opts = {}) => {
  const { timeout, global: keep, patience, signal: own, ...rest } = opts;
  const o = { ...rest, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } };
  const method = String(o.method || 'GET').toUpperCase();
  const signal = own || (method === 'GET' && !keep ? pageCtl.signal : null);
  const r = method === 'GET' && o.body == null ? await NET.get(url, { signal, timeout, patience, init: o }) : await NET.request(url, o, { signal, timeout });
  if (r.status === 401) { NET.clear(); location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('sign in first'); }
  let j = {}; try { j = r.text ? JSON.parse(r.text) : {}; } catch { j = {}; }
  if (url === '/api/auth/me' && r.status === 200 && !r.stale) NET.scope(j.user?.id || j.user?.name || (j.signIn === false ? 'open' : ''));
  if (r.status === 403 && j.terms) { location.href = `/login.html?step=terms&next=${encodeURIComponent(location.pathname + location.search + location.hash)}`; throw new Error(j.error); }   // updated terms: one tap, then back here
  /* The server's error in the home's language when it's a known sentence (body.error keeps the English). */
  if (!r.ok) throw Object.assign(new Error(j.error ? TM(j.error, j.msg, j.vars) : `HTTP ${r.status}`), { status: r.status, body: j });
  return j;
};
const post = (url, body, method = 'POST') => api(url, { method, body: JSON.stringify(body || {}) });
/* Links from outside (news feeds, calendars, Home Assistant): only web addresses, never javascript: or data:. */
const safeHref = (u) => { try { const x = new URL(String(u || ''), location.href); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
/* A color from a calendar or feed, used inside a style: only plain color values get through. */
const safeColor = (c, fallback = 'var(--accent)') => (/^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\([\d\s.,%/-]{1,40}\))$/i.test(String(c || '').trim()) ? String(c).trim() : fallback);
/* An address from the server to go to: only pages on this CasaTorch. */
const sameOrigin = (u, fallback = '/') => { try { const x = new URL(String(u || ''), location.origin); return x.origin === location.origin ? x.pathname + x.search + x.hash : fallback; } catch { return fallback; } };
const S = { status: null, tz: undefined, units: 'F', alertsOpen: 0, settings: null };
const isPro = () => !!S.status?.pro?.pro;
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
function modal(content, { wide = false, title } = {}) {
  const box = el('div', { class: `box${wide ? ' wide' : ''}` }, title ? el('div', { class: 'row between', style: 'margin-bottom:12px' }, el('h3', { style: 'margin:0' }, title), el('button', { class: 'btn ghost small', 'aria-label': T('Close'), onclick: () => m.remove() }, icon('x'))) : null, content);
  const m = el('div', { id: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : null, onclick: (e) => { if (e.target === m) m.remove(); } }, box);
  // a real dialog for keyboards and screen readers: focus moves in, Tab stays inside, and closing returns focus to where it was
  const back = $('#modal')?._back || document.activeElement, rm = m.remove.bind(m); m._back = back; box.tabIndex = -1;
  m.remove = () => { rm(); if (back?.isConnected && !$('#modal')) back.focus?.({ preventScroll: true }); };
  m.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent || x === document.activeElement);
    if (!f.length) { e.preventDefault(); box.focus(); return; }
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  });
  const old = $('#modal'); if (old) Element.prototype.remove.call(old); document.body.append(m);
  requestAnimationFrame(() => { if (m.isConnected && !m.contains(document.activeElement)) box.focus({ preventScroll: true }); });   // the box, not a field: no phone keyboard popping up
  return m;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal')?.remove(); });
// things drawn as a picture or a chip but acting as a button (role=button, tabindex=0) work from the keyboard too
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][tabindex]:not(button, a, input)')) { e.preventDefault(); e.target.click(); } });
/* Time in the house's time zone (a wall panel in another zone still shows house time). */
// Building a date formatter is slow (tens of ms on a Pi at first paint); each one is made once and reused.
const DTF = new Map();
const dtf = (loc, o) => { const k = `${loc}|${JSON.stringify(o)}`; let f = DTF.get(k); if (!f) { if (DTF.size > 300) DTF.clear(); f = new Intl.DateTimeFormat(loc, o); DTF.set(k, f); } return f; };
/* Dates and times read the way the home's language writes them (English: US style). */
const dateLoc = () => { const l = window.CasaI18n?.lang || 'en'; return l === 'en' ? 'en-US' : l === 'zh' ? 'zh-CN' : l; };
const fmt = (iso, o) => (iso ? dtf(dateLoc(), { timeZone: S.tz, ...o }).format(new Date(iso)) : '');
const fmtTime = (iso) => fmt(iso, { hour: 'numeric', minute: '2-digit' });
const dayKey = (iso, tz = S.tz) => dtf('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const fmtWhen = (iso) => { const k = dayKey(iso), today = dayKey(new Date().toISOString()), tom = dayKey(new Date(Date.now() + 86400_000).toISOString()); return k === today ? `${T('Today')} ${fmtTime(iso)}` : k === tom ? `${T('Tomorrow')} ${fmtTime(iso)}` : `${fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtTime(iso)}`; };
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); if (!(s >= 0)) return ''; if (s < 60) return T('just now'); if (s < 3600) return T('{n} min ago', { n: Math.round(s / 60) }); if (s < 86400) return T('{n} h ago', { n: Math.round(s / 3600) }); return T('{n} d ago', { n: Math.round(s / 86400) }); };
/* Alert titles are kept in English (the history stores them as they were raised); they show in the home's language.
   A title with a stable key (msg/vars) uses it; the usual ones are recognized by their wording; anything else as is. */
const ALERT_SAY = [[/^Cleared: (.+)$/s, 'Cleared: {what}', ['what'], true], [/^Still happening: (.+)$/s, 'Still happening: {what}', ['what'], true],
  [/^Water detected: (.+)$/s, 'Water detected: {name}', ['name']], [/^Smoke alarm: (.+)$/s, 'Smoke alarm: {name}', ['name']], [/^Low battery \((\d+)%\): (.+)$/s, 'Low battery ({n}%): {name}', ['n', 'name']],
  [/^(\d+) more devices are not responding$/, '{n} more devices are not responding', ['n']], [/^(.+) is not responding$/s, '{name} is not responding', ['name']],
  [/^(.+) is near freezing$/s, '{name} is near freezing', ['name']], [/^(.+) is very hot$/s, '{name} is very hot', ['name']],
  [/^Someone at the (.+)$/s, 'Someone at the {name}', ['name']], [/^Motion at the (.+)$/s, 'Motion at the {name}', ['name']],
  [/^Fixed: (.+) is fine again$/s, 'Fixed: {what} is fine again', ['what'], 'T'], [/^Fixed: (.+) no longer needs a look$/s, 'Fixed: {what} no longer needs a look', ['what'], 'T'],
  [/^Fixed: (.+) is answering again$/s, 'Fixed: {what} is answering again', ['what'], 'T'], [/^(\d+) things need a look: (.+)$/s, '{n} things need a look: {list}', ['n', 'list']],
  [/^New device on your network: (.+)$/s, 'New device on your network: {name}', ['name']], [/^(.+) has (.+) open$/s, '{name} has {service} open', ['name', 'service'], 'T'],
  [/^(Wrong password|Too many sign-in tries - paused|Wrong two-step code|Google sign-in from an unknown account|Recovery code used|Someone's role changed|Person added) \((.+)\)$/s, '{what} ({user})', ['what', 'user'], 'T'],
  [/^(\d+) found - see "Devices on your network" below\.$/, '{n} found - see "Devices on your network" below.', ['n']], [/^(\d+) new - say whether each is yours below\.$/, '{n} new - say whether each is yours below.', ['n']],
  [/^Version (.+) is ready - Settings › Updates & backup\.$/s, 'Version {version} is ready - Settings › Updates & backup.', ['version']]];
function alertTitle(a) {
  const t = String((typeof a === 'string' ? a : a?.title) || '');
  if (a && typeof a === 'object' && a.msg) return TM(t, a.msg, a.vars);
  if (CasaI18n.lang === 'en') return t;
  for (const [re, key, names, inner] of ALERT_SAY) {
    const m = re.exec(t); if (!m) continue;
    const v = {}; names.forEach((n, k) => { const x = m[k + 1]; v[n] = inner === true ? alertTitle(x) : inner === 'T' ? T(x) : x; });
    return T(key, v);
  }
  return T(t);
}
const hm = (t) => { const [h, m] = String(t).split(':').map(Number); return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : t; };
const tempOf = (c) => (c == null ? '-' : S.units === 'C' ? `${c.toFixed(1)}°` : `${Math.round(c * 9 / 5 + 32)}°`);
const devIconName = (d) => (d.kind === 'sensor' && d.tempC != null ? 'thermo' : d.kind === 'sensor' && d.humidity != null && d.water == null ? 'drop' : d.water != null ? 'drop' : d.smoke != null ? 'fire' : d.kind === 'cover' ? (d.risky ? 'door' : 'blinds') : d.open != null ? 'door' : d.meter ? 'bolt' : { light: 'bulb', switch: 'plug', plug: 'plug', media: 'music', climate: 'thermo', lock: 'lock', camera: 'camera', fan: 'fan', action: 'play', vacuum: 'vacuum', alarm: 'shield', presence: 'user', value: 'gauge' }[d.kind] || 'dotc');

/* Where a device or alert comes from, as a person would write it ("frigate" reads Frigate; a plain camera says nothing). */
const SRC_NAMES = { frigate: 'Frigate', reolink: 'Reolink', ring: 'Ring', yolink: 'YoLink', hue: 'Philips Hue', shelly: 'Shelly', ha: 'Home Assistant', homeassistant: 'Home Assistant', unifi: 'UniFi', meraki: 'Cisco Meraki', casatorch: 'CasaTorch', camera: '', snapshot: '', internet: '' };
const srcName = (s) => { const k = String(s || '').toLowerCase(); return Object.hasOwn(SRC_NAMES, k) ? SRC_NAMES[k] : String(s || ''); };
const TABS = [];   // filled by the tab files
const tab = (t) => { const k = t.after ? TABS.findIndex((x) => x.id === t.after) : -1; if (k >= 0) TABS.splice(k + 1, 0, t); else TABS.push(t); };   // after: its place on the main bar
let refresher = null, current = null;
function setTop(title, sub = '', actions = []) { $('#title').textContent = title; $('#subtitle').textContent = sub; $('#actions').replaceChildren(...actions); if (typeof docTitleLink === 'function') docTitleLink(current); }   // docTitleLink: the page's "?" guide link (39d-docs-links.js)
let showSeq = 0;
async function show(id) {
  const [base, sub] = String(id || '').split('/');   // #settings/people opens Settings at People
  const t = TABS.find((x) => x.id === base) || TABS[0];
  current = t.id; document.body.classList.remove('editing-on');
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === t.id));
  if (window.innerWidth <= 760 && S.ui) drawNav();   // the phone bar's More lights up for a page inside it
  // live video left on the old page would keep downloading in the background: stop it
  for (const img of document.querySelectorAll('#view .cam.live img')) { img.onerror = null; img.removeAttribute('src'); }
  // The last page's reads stop (a slow answer for a page you left only holds up this one).
  pageCtl.abort(); pageCtl = new AbortController(); NET.page();
  // A fresh box per visit (a slow, older render can't write into the new page). The page you're on stays until the
  // new one has drawn - or a quarter second has passed - so switching never flashes or jumps. Still nothing to show
  // by then: a skeleton of the page, until its first part draws. It never ends empty: an error is a card to try again.
  const view = $('#view'), main = el('div', { class: 'view-next', 'data-page': t.id }); refresher = null; showSeq = (showSeq || 0) + 1; const seq = showSeq;
  view.append(main);
  const skelOff = new MutationObserver(() => { if ([...main.children].some((n) => !n.classList.contains('skel'))) { main.querySelectorAll(':scope > .skel').forEach((n) => n.remove()); skelOff.disconnect(); } });
  skelOff.observe(main, { childList: true });
  const reveal = () => {
    if (seq !== showSeq || !main.isConnected || !main.classList.contains('view-next')) return;
    if (!main.children.length) main.append(pageSkeleton());
    for (const n of [...view.children]) if (n !== main) n.remove(); main.classList.remove('view-next'); main.classList.add('view-in');
  };
  const early = setTimeout(reveal, 250);
  setTop(tabLabel(t));
  try { const r = (await t.render(main, sub || null)) || null; if (main.isConnected) refresher = r; }
  catch (err) { if (seq === showSeq && !err?.aborted) main.replaceChildren(loadFail(err)); }
  clearTimeout(early);
  if (seq !== showSeq) return;
  skelOff.disconnect(); main.querySelectorAll(':scope > .skel').forEach((n) => n.remove());
  if (!main.children.length) main.append(loadFail(null));
  reveal(); netNote();
}
/* While a page's first answer is on its way: the shape of a page, softly pulsing. */
const pageSkeleton = () => el('div', { class: 'skel', 'aria-busy': 'true', 'aria-label': T('Loading…') }, el('div', { class: 'skel-row' }, el('i', { class: 'skel-b skel-w40' }), el('i', { class: 'skel-b skel-w20' })),
  el('div', { class: 'skel-grid' }, [0, 1, 2, 3].map(() => el('div', { class: 'skel-card' }, el('i', { class: 'skel-b skel-w60' }), el('i', { class: 'skel-b skel-w90' }), el('i', { class: 'skel-b skel-w75' })))));
/* A page that couldn't load: why, in words, and a way to try again (never an empty page). */
function loadFail(err) {
  const off = !navigator.onLine || err?.retry || NET.status().offline;
  return el('div', { class: 'card load-fail', role: 'alert' }, el('div', { class: 'row', style: 'gap:10px;align-items:flex-start' }, icon(off ? 'wifi' : 'info', 20),
    el('div', { class: 'grow' }, el('b', {}, off ? T('Can\'t reach your home right now') : T('This page didn\'t load')),
      el('div', { class: 'small muted', style: 'margin-top:4px' }, off ? T('It opens by itself once the connection is back.') : err?.message ? T('Couldn\'t load this page: {why}', { why: err.message }) : T('Something on this page didn\'t answer.')))),
  el('div', { style: 'margin-top:12px' }, el('button', { class: 'btn small', onclick: () => { NET.reset(); show(location.hash.slice(1) || 'home'); } }, icon('reset'), T('Try again'))));
}
/* "Updating…" while the page shows its last answer and the live one is on its way; "Offline - showing data from
   2 min ago" when the CasaTorch can't be reached. Next to the page title, small and quiet. */
let netNoteT = null;
function netNote() {
  clearTimeout(netNoteT); netNoteT = null;
  const n = $('#netstate'); if (!n) return;
  const s = NET.status(), offline = !navigator.onLine || (s.offline && s.stale);
  let text = '';
  if (offline && s.stale) text = T('Offline - showing data from {when}', { when: ago(new Date(s.since).toISOString()) || T('just now') });
  else if (!navigator.onLine) text = T('Offline');
  else if (s.stale) text = T('Updating…');
  n.hidden = !text; n.className = offline ? 'off' : 'busy'; n.textContent = text;
  if (text) netNoteT = setTimeout(netNote, offline ? 30_000 : 1000);   // "2 min ago" keeps counting; "Updating…" goes as soon as it can
}
NET.on((what) => { if (what === 'state') { clearTimeout(netNoteT); netNoteT = setTimeout(netNote, 120); } else if (what === 'fresh') pageFresh(); });
/* A live answer that differs from the one the page drew from: the page draws again (its own refresh, else the page). */
let freshT = null;
function pageFresh() {
  clearTimeout(freshT);
  freshT = setTimeout(() => {
    if (document.body.classList.contains('editing-on') || $('#modal') || (document.activeElement?.closest?.('#view') && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) return;
    if (refresher) runRefresh(); else if (current && !$('#view .view-next')) show(location.hash.slice(1) || current);
  }, 150);
}
/* The look of the bits above (kept here with the code that draws them). */
document.head.append(el('style', {}, `#netstate{display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:3px 9px;border-radius:999px;font-size:12px;line-height:1.4;color:var(--muted,#9aa4b2);background:color-mix(in srgb,currentColor 9%,transparent);white-space:nowrap;vertical-align:middle}
#netstate[hidden]{display:none}#netstate::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}#netstate.busy::before{animation:netpulse 1.2s ease-in-out infinite}#netstate.off{color:#fbbf24}
.skel{padding:2px 0}.skel-row{display:flex;gap:10px;margin-bottom:14px}.skel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}.skel-card{border-radius:16px;padding:18px;background:color-mix(in srgb,var(--text,#e5e7eb) 5%,transparent);display:grid;gap:12px;min-height:120px}
.skel-b{display:block;height:12px;border-radius:6px;background:color-mix(in srgb,var(--text,#e5e7eb) 10%,transparent);animation:netpulse 1.4s ease-in-out infinite}.skel-row .skel-b{height:16px}.skel-w20{width:20%}.skel-w40{width:40%}.skel-w60{width:60%}.skel-w75{width:75%}.skel-w90{width:90%}
@keyframes netpulse{0%,100%{opacity:.45}50%{opacity:1}}@media (prefers-reduced-motion:reduce){.skel-b,#netstate.busy::before{animation:none}}`));
/* Once the dashboard is up and the browser is idle, the 3D Home's files are fetched ahead (Pro only, only if its
   button is on the bar), so opening it is instant. Skipped on metered or "save data" connections. */
function warmUp() {
  const c = navigator.connection;
  if (c?.saveData || /2g/.test(c?.effectiveType || '') || !isPro() || !navTabs().some((t) => t.id === 'house3d')) return;
  const go = () => ['/floorplan.html', '/floorplan.css', '/floorplan.js', '/floorplan-house.js', '/floorplan-dock.js', '/floorplan-yard.js', '/floorplan-look.js', '/floorplan-draw.js', '/vendor/three/build/three.module.js', '/vendor/three/examples/jsm/controls/OrbitControls.js']
    .forEach((href) => document.head.append(el('link', { rel: 'prefetch', href })));
  (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(go, { timeout: 6000 });
}
/* The main bar: the household's order and names, only the buttons they want; on a phone the first four and "More". */
const navTabs = () => TABS.filter((t) => !S.ui.tabs?.[t.id]?.hidden).map((t, i) => [t, S.ui.tabs?.[t.id]?.order ?? 50 + i]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
function navLink(t) {
  return el('a', { href: `#${t.id}`, 'data-tab': t.id, class: t.id === current ? 'on' : null, title: tabLabel(t) }, icon(t.icon), el('span', { class: 'nl' }, S.ui.tabs?.[t.id]?.label || T(t.short || t.label)),
    t.pro && !isPro() ? el('span', { class: 'pro' }, 'PRO') : null, t.id === 'alerts' && S.alertsOpen ? el('span', { class: 'badge' }, S.alertsOpen) : newDot(t.id));   // newDot: 39-whatsnew.js
}
function drawNav() {
  requestAnimationFrame(navFade);
  const list = navTabs(), phone = window.innerWidth <= 760 && ['left', 'right'].includes(S.ui.nav || 'left');
  if (!phone || list.length <= 5) { $('.nav').replaceChildren(...list.map(navLink)); return; }
  const first = list.slice(0, 4), rest = list.slice(4), inMore = rest.some((t) => t.id === current);
  $('.nav').replaceChildren(...first.map(navLink), el('a', { href: '#', class: inMore ? 'on' : null, title: T('More'), onclick: (e) => { e.preventDefault(); moreSheet(rest); } }, icon('grid'), el('span', { class: 'nl' }, T('More')), rest.some((t) => t.id === 'alerts') && S.alertsOpen ? el('span', { class: 'badge' }, S.alertsOpen) : rest.map((t) => newDot(t.id)).find(Boolean) || null));
}
function moreSheet(rest) {
  const m = modal(el('div', { class: 'more-grid' }, rest.map((t) => el('a', { href: `#${t.id}`, class: `more-item${t.id === current ? ' on' : ''}`, onclick: () => m.remove() }, icon(t.icon, 24), el('span', {}, tabLabel(t)), newDot(t.id)))), { title: T('More') });
  m.classList.add('sheet');
}
let navT = null; addEventListener('resize', () => { clearTimeout(navT); navT = setTimeout(drawNav, 150); });
/* A side bar with more buttons than fit fades at the bottom, so it's clear it scrolls. */
const navFade = () => {
  const n = $('.nav'); if (!n) return;
  n.classList.toggle('more-below', n.scrollHeight - n.scrollTop - n.clientHeight > 4);
  // a long word ("Erinnerungen") gets a slightly smaller size instead of being cut off
  for (const l of n.querySelectorAll('.nl')) {
    l.style.fontSize = ''; const a = l.parentElement, cs = getComputedStyle(a), room = a.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (!(room > 0)) continue;
    const r = document.createRange(); r.selectNodeContents(l);
    for (let px = parseFloat(getComputedStyle(l).fontSize), i = 0; r.getBoundingClientRect().width > room && i < 4; i++) l.style.fontSize = `${(px -= 0.75)}px`;
  }
};
document.addEventListener('DOMContentLoaded', () => { $('.nav')?.addEventListener('scroll', navFade, { passive: true }); new ResizeObserver(navFade).observe($('.nav')); });
function drawBanner() {
  const b = $('#banner'), s = S.status; if (!s) return;
  const p = s.pro || {}; b.className = ''; b.replaceChildren();
  if (s.demo) b.append(T('Demo mode - sample data, no real house connected.'), el('a', { href: '/setup.html' }, T('Set up my house')));
  else if (S.updates?.available && !updSnoozed(S.updates.latest)) b.append(icon('spark', 16), S.updates.auto ? T('CasaTorch {v} is available - it installs itself overnight.', { v: S.updates.latest }) : T('CasaTorch {v} is available.', { v: S.updates.latest }), el('a', { href: '#settings/updates' }, S.updates.auto ? T('Details') : T('How to update')), updSnoozeBtn(S.updates.latest));
  else if (p.plan === 'trial') b.append(icon('spark', 16), p.trialDaysLeft === 1 ? T('Pro trial: 1 day left - 3D Home, your Home AI Agent and Ring are unlocked.') : T('Pro trial: {n} days left - 3D Home, your Home AI Agent and Ring are unlocked.', { n: p.trialDaysLeft }), el('a', { href: '#settings/pro' }, T('Enter a license key')));
  else if (p.grace) b.append(T('Your Pro subscription has ended - Pro keeps working for a few more days.'), el('a', { href: '#settings/pro' }, T('Renew')));
  else if (!p.pro) {
    /* Right after Pro or the trial ends, say once (per browser) what that means: nothing was deleted. */
    let once = false; try { if (p.note && localStorage.getItem('casatorch-pro-ended') !== p.note) { localStorage.setItem('casatorch-pro-ended', p.note); once = true; } } catch { /* fine */ }
    b.className = 'free'; b.append(once ? `${T('CasaTorch Basic.')} ${T(p.note)}` : T('CasaTorch Basic.'), el('a', { href: '#settings/pro' }, T('See what Pro adds')));
  }
  b.hidden = !b.textContent;
}
function tick() { $('#clock').textContent = fmt(new Date().toISOString(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
async function loadStatus() {
  api('/api/updates', { global: true }).then((u) => { S.updates = u; drawBanner(); }).catch(() => {});
  // status and alerts together, not one after the other
  const [st, a] = await Promise.all([api('/api/status', { global: true }).catch(() => null), api('/api/alerts', { global: true }).catch(() => null)]);
  if (st) { S.status = st; S.units = st.units || 'F'; }
  if (a) S.alertsOpen = a.now?.length || 0;
  drawBanner(); drawNav(); statusBar.draw();
}
async function boot() {
  // everything the first screen needs is asked for at once: one round trip of waiting, not five
  const pUi = api('/api/ui', { global: true }).catch(() => null), pStatus = loadStatus();
  // Home's own reads start now too, not after the language and the layout: one round trip less over a slow link
  // (Home asks again a moment later and gets these same answers)
  if (/^#?(home)?$/.test(location.hash)) {
    const sid = typeof screenId === 'function' ? screenId() : '';
    for (const u of ['/api/home', '/api/devices', '/api/auth/me', `/api/layout${sid ? `?screen=${sid}` : ''}`]) api(u, { global: true }).catch(() => {});
  }
  try { S.settings = await api('/api/settings', { global: true }); S.tz = S.settings.house?.timezone || undefined; } catch { /* default zone */ }
  const [ui] = await Promise.all([pUi, S.settings && !S.settings.demo ? CasaI18n.use(S.settings.house?.lang || 'en') : null]);   // the demo keeps whatever this browser picked
  if (ui) S.ui = { ...S.ui, ...ui };
  applyUi();
  await pStatus; drawNav();
  warmUp();
  tick(); setInterval(tick, 15_000);
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || 'home');
  setTimeout(tourOffer, 700);   // first visit in this browser: offer the tour (34-tour.js)
  setInterval(() => { if (document.hidden || document.body.classList.contains('editing-on')) return; loadStatus(); runRefresh(); }, 30_000);
  liveStart();
}
/* One refresh at a time: a slow answer can't land after a newer one, and a burst of changes becomes one more refresh.
   Sections you opened (the "details" on a page) stay open when the page is drawn again. */
let refreshing = false, refreshAgain = false;
async function runRefresh() {
  const r = refresher; if (!r) return;
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  const view = $('#view'), keys = () => { const n = {}; return [...view.querySelectorAll('details')].map((d) => { const k = `${d.className}|${(n[d.className] = (n[d.className] || 0) + 1)}`; return [k, d]; }); };
  const open = new Set(keys().filter(([, d]) => d.open).map(([k]) => k));
  const box = view.firstElementChild, h = box?.offsetHeight || 0; if (box && h) box.style.minHeight = `${h}px`;   // a redraw never shrinks the page under you
  try { await r(); } catch { /* the next tick tries again */ }
  finally { refreshing = false; if (box) requestAnimationFrame(() => { box.style.minHeight = ''; }); }
  if (r === refresher && open.size) for (const [k, d] of keys()) if (open.has(k)) d.open = true;
  if (refreshAgain) { refreshAgain = false; if (r === refresher) runRefresh(); }
}
/* Real time: the server says when something in the house changed (34-live.js), and the screen on show refreshes
   - at most about once a second, never while you're editing, and not in a hidden tab.
   The stream is watched: the server sends a beat every 20 seconds, so a stream silent for 50 is a dead connection
   (the phone moved from Wi-Fi to mobile data, a tunnel restarted) and is opened again - at once when the network
   changes or the app comes back, otherwise after 2, 4, 8... up to 30 seconds. A tab in the background closes it
   (a phone's connections are few and its battery small) and opens it again when it's back. */
let liveLast = 0, liveTimer = null, liveNudgeT = null;
const LIVE_C = { es: null, heard: 0, opened: 0, wait: 2000, retryT: null, hiddenT: null, dogT: null };
function liveStop() {
  clearTimeout(LIVE_C.retryT); LIVE_C.retryT = null;
  const es = LIVE_C.es; LIVE_C.es = null;
  if (es) { es.onmessage = es.onerror = es.onopen = null; try { es.close(); } catch { /* gone */ } }
}
function liveLater() { clearTimeout(LIVE_C.retryT); const d = LIVE_C.wait; LIVE_C.wait = Math.min(30_000, LIVE_C.wait * 2); LIVE_C.retryT = setTimeout(liveStart, d); }
function liveStart() {
  if (typeof EventSource !== 'function' || document.hidden) return;
  liveStop();
  const es = new EventSource('/api/live/events');
  LIVE_C.es = es; LIVE_C.opened = Date.now(); LIVE_C.heard = Date.now();
  es.onopen = () => { LIVE_C.heard = Date.now(); };
  es.onmessage = (ev) => {
    LIVE_C.heard = Date.now(); LIVE_C.wait = 2000;
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'tick' && !document.hidden && typeof nudgeCheck === 'function') { clearTimeout(liveNudgeT); liveNudgeT = setTimeout(nudgeCheck, 300); }   // a nudge going off shows at once
    if (m.type !== 'tick' || document.hidden || document.body.classList.contains('editing-on') || !refresher) return;
    if (document.activeElement?.closest?.('#view') && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;   // someone is typing: the next change (or the 30-second refresh) catches up
    clearTimeout(liveTimer); liveTimer = setTimeout(() => { liveLast = Date.now(); runRefresh(); }, Math.max(0, 1000 - (Date.now() - liveLast)));
  };
  es.onerror = () => { if (es.readyState === 2 && LIVE_C.es === es) { liveStop(); liveLater(); } };   // closed for good (a 503, signed out): again later
  clearInterval(LIVE_C.dogT);
  LIVE_C.dogT = setInterval(() => { if (LIVE_C.es && !document.hidden && Date.now() - LIVE_C.heard > 50_000) { liveStop(); liveStart(); } }, 10_000);
}
/* The network changed (the phone app says so; or the browser went offline and back), or the screen is back after a
   while: reads still waiting on the old connection start again, the live stream opens again, and the page checks
   for anything it missed. */
let netKickT = null, hiddenAt = 0;
function netKick(why) {
  clearTimeout(netKickT);
  netKickT = setTimeout(() => {
    NET.reset(); liveStart(); netNote();
    if (document.hidden) return;
    loadStatus();
    if (refresher) runRefresh(); else if (current && $('#view .load-fail')) show(location.hash.slice(1) || current);
  }, why === 'online' ? 50 : 0);
}
window.addEventListener('online', () => netKick('online'));
window.addEventListener('offline', () => netNote());
window.addEventListener('casa:network', (e) => { if (e.detail?.online !== false) netKick('network'); else netNote(); });   // from the iPhone / Android app
window.addEventListener('casa:resume', () => netKick('resume'));
window.addEventListener('pageshow', (e) => { if (e.persisted) netKick('resume'); });   // back from the browser's back-forward cache
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); clearTimeout(LIVE_C.hiddenT); LIVE_C.hiddenT = setTimeout(() => { if (document.hidden) liveStop(); }, 30_000); return; }
  clearTimeout(LIVE_C.hiddenT);
  if (!LIVE_C.es || Date.now() - hiddenAt > 15_000 || Date.now() - LIVE_C.heard > 50_000) netKick('visible');
});
/* For the tests (tools/test-remote-sim.mjs) and support: how the connection is doing. */
window.__casaNet = Object.freeze({ status: () => NET.status(), live: () => ({ open: LIVE_C.es?.readyState === 1, heard: LIVE_C.heard }) });
document.addEventListener('DOMContentLoaded', () => boot());
