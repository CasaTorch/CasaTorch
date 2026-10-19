/* Unit tests for talking to the CasaTorch over a slow or flaky network (src/client/00-core.js, makeNet) and for the
   dashboard's content-named files (src/server/01-security.js): time limits, one more try, one request for many
   askers, leaving a page, drawing from the last answer, this browser's copy (what's kept, what never is, the size
   limit, sign-out), and the year-long caching of app.<hash>.js. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', 'src', 'client', '00-core.js'), 'utf8');
const piece = src.slice(src.indexOf('/* @net:start */'), src.indexOf('/* @net:end */'));
const makeNet = new Function(`${piece}; return makeNet;`)();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A stand-in for fetch: answer(url, init, n) returns { status, body, delay } or 'hang'; it honours the abort signal. */
function fakeFetch(answer) {
  const calls = [];
  const f = (url, init = {}) => new Promise((ok, no) => {
    const n = calls.push({ url, init }) , a = answer(url, init, n);
    const fail = () => no(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (init.signal?.aborted) return fail();
    init.signal?.addEventListener('abort', fail, { once: true });
    if (a === 'hang') return;
    if (a instanceof Error) return setTimeout(() => no(a), a.delay || 0);
    setTimeout(() => ok({ status: a.status ?? 200, ok: (a.status ?? 200) < 400, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? {})) }), a.delay || 0);
  });
  f.calls = calls;
  return f;
}
const mapStore = () => { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); }, del: (k) => { m.delete(k); }, keys: () => [...m.keys()] }; };

export default async function netTests(t) {
  await t('net: a read that never answers stops at its time limit, after one more try', async () => {
    const f = fakeFetch(() => 'hang'), net = makeNet({ fetch: f, sleep: () => sleep(1) });
    const t0 = Date.now();
    await assert.rejects(net.get('/api/doctor', { timeout: 40 }), (e) => e.name === 'TimeoutError');
    assert.equal(f.calls.length, 2, 'tried twice');
    assert.ok(Date.now() - t0 < 1000);
  });
  await t('net: default limits - 8 s for a read, 15 s for a heavy one, longer for slow jobs and changes', async () => {
    let seen = [];
    const f = fakeFetch(() => ({ body: {} }));
    const real = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) seen.push(ms); return real(fn, Math.min(ms, 5), ...a); };
    try {
      const net = makeNet({ fetch: f });
      await net.request('/api/devices'); await net.request('/api/history?x=1'); await net.request('/api/apptests/run'); await net.request('/api/devices/x', { method: 'POST', body: '{}' });
    } finally { globalThis.setTimeout = real; }
    seen = seen.filter((ms) => [8000, 15000, 30000, 60000, 120000].includes(ms));
    assert.deepEqual(seen, [8000, 15000, 60000, 30000]);
  });
  await t('net: a dropped connection is tried once more for a read, never for a change', async () => {
    let n = 0;
    const f = fakeFetch(() => (++n === 1 ? new TypeError('Load failed') : { body: { ok: 1 } })), net = makeNet({ fetch: f, sleep: () => sleep(1) });
    assert.equal((await net.request('/api/devices')).text, '{"ok":1}');
    assert.equal(f.calls.length, 2);
    const g = fakeFetch(() => new TypeError('Load failed')), net2 = makeNet({ fetch: g, sleep: () => sleep(1) });
    await assert.rejects(net2.request('/api/devices/x/toggle', { method: 'POST', body: '{}' }), (e) => e.name === 'NetworkError');
    assert.equal(g.calls.length, 1, 'a change is sent once');
  });
  await t('net: a 502/503/504 from the tunnel is tried once more', async () => {
    let n = 0;
    const f = fakeFetch(() => (++n === 1 ? { status: 502, body: 'bad gateway' } : { body: { v: 2 } })), net = makeNet({ fetch: f, sleep: () => sleep(1) });
    const r = await net.request('/api/home');
    assert.equal(r.status, 200); assert.equal(f.calls.length, 2);
  });
  await t('net: the same read asked twice at once goes out once', async () => {
    const f = fakeFetch(() => ({ body: { a: 1 }, delay: 20 })), net = makeNet({ fetch: f });
    const [a, b] = await Promise.all([net.request('/api/devices'), net.request('/api/devices')]);
    assert.equal(a.text, b.text); assert.equal(f.calls.length, 1);
  });
  await t('net: leaving the page stops its reads; a read someone else still wants carries on', async () => {
    const f = fakeFetch(() => ({ body: { a: 1 }, delay: 40 })), net = makeNet({ fetch: f });
    const page = new AbortController();
    const mine = net.request('/api/devices', {}, { signal: page.signal }), theirs = net.request('/api/devices');
    page.abort();
    await assert.rejects(mine, (e) => e.aborted === true);
    assert.equal((await theirs).status, 200, 'the status bar still gets its answer');
    const page2 = new AbortController(), only = net.request('/api/alerts', {}, { signal: page2.signal });
    page2.abort();
    await assert.rejects(only, (e) => e.aborted);
    await sleep(5);
    assert.equal(f.calls.at(-1).init.signal.aborted, true, 'nobody wants it: the request itself is cancelled');
  });
  await t('net: a page draws from its last answer when the live one is slow, then hears about the new one', async () => {
    let body = { n: 1 }, delay = 0;
    const f = fakeFetch(() => ({ body, delay })), net = makeNet({ fetch: f, freshMs: 0 });
    const events = []; net.on((w, u) => events.push(`${w}:${u || ''}`));
    assert.equal((await net.get('/api/home')).text, '{"n":1}');
    body = { n: 2 }; delay = 80;
    const t0 = Date.now(), r = await net.get('/api/home', { patience: 10 });
    assert.ok(Date.now() - t0 < 60, 'drawn from the last answer at once');
    assert.equal(r.stale, true); assert.equal(r.text, '{"n":1}');
    assert.equal(net.status().stale, true, '"Updating..." shows');
    await sleep(120);
    assert.ok(events.includes('fresh:/api/home'), 'the page is told the new answer is in');
    assert.equal(net.status().stale, false);
    assert.equal(net.peek('/api/home').text, '{"n":2}');
  });
  await t('net: an answer from a moment ago is reused (Home and the status bar asking the same thing)', async () => {
    const f = fakeFetch(() => ({ body: { a: 1 } })), net = makeNet({ fetch: f });
    await net.get('/api/alerts'); await net.get('/api/alerts');
    assert.equal(f.calls.length, 1);
  });
  await t('net: a change makes the next read go live (no answer from before the change)', async () => {
    const f = fakeFetch(() => ({ body: { a: 1 } })), net = makeNet({ fetch: f });
    await net.get('/api/devices');
    await net.request('/api/devices/x/toggle', { method: 'POST', body: '{}' });
    await net.get('/api/devices', { patience: 1000 });
    assert.equal(f.calls.length, 3);
  });
  await t('net: offline with a saved answer: the saved answer, marked; no saved answer: an error', async () => {
    let down = false;
    const f = fakeFetch(() => (down ? new TypeError('offline') : { body: { a: 1 } })), net = makeNet({ fetch: f, freshMs: 0, sleep: () => sleep(1) });
    await net.get('/api/devices');
    down = true;
    const r = await net.get('/api/devices');
    assert.equal(r.stale, true); assert.equal(r.text, '{"a":1}');
    assert.equal(net.status().offline, true);
    await assert.rejects(net.get('/api/energy'), (e) => e.name === 'NetworkError');
    const down502 = makeNet({ fetch: fakeFetch((u, i, n) => (n === 1 ? { body: { b: 1 } } : { status: 530, body: 'tunnel down' })), freshMs: 0, sleep: () => sleep(1) });
    await down502.get('/api/home');
    assert.equal((await down502.get('/api/home')).stale, true, 'a tunnel error shows the last answer too');
  });
  await t('net: the network changed - reads waiting on the old connection start again at once', async () => {
    let n = 0;
    const f = fakeFetch(() => (++n === 1 ? 'hang' : { body: { ok: 1 } })), net = makeNet({ fetch: f, sleep: () => sleep(1) });
    const p = net.request('/api/devices', {}, { timeout: 60_000 });
    await sleep(5); net.reset();
    assert.equal((await p).text, '{"ok":1}');
    assert.equal(f.calls.length, 2);
  });
  await t('net: this browser keeps the everyday pages\' answers - never sign-ins, keys or the list of sign-ins', async () => {
    const store = mapStore();
    const answers = { '/api/home': { weather: 'sun' }, '/api/auth/me': { signIn: true, user: { id: 'u1', name: 'Sam', role: 'owner' }, sessions: [{ ip: '192.168.1.20' }], policy: { x: 1 } }, '/api/users': { users: [1] }, '/api/push': { key: 'k' }, '/api/doctor': { a: 1 } };
    const net = makeNet({ fetch: fakeFetch((u) => ({ body: answers[u] })), store });
    for (const u of Object.keys(answers)) await net.get(u);
    const kept = store.keys().filter((k) => !/:(idx|who)$/.test(k)).map((k) => k.replace('casa.c1:', '')).sort();
    assert.deepEqual(kept, ['/api/auth/me', '/api/home']);
    const me = JSON.parse(JSON.parse(store.get('casa.c1:/api/auth/me')).t);
    assert.equal(me.sessions, undefined); assert.equal(me.policy, undefined); assert.equal(me.user.role, 'owner');
    assert.doesNotMatch(store.get('casa.c1:/api/auth/me'), /192\.168/);
    // a new visit (a new page load) draws from it at once
    const later = makeNet({ fetch: fakeFetch(() => 'hang'), store });
    const r = await later.get('/api/home', { patience: 5 });
    assert.equal(r.stale, true); assert.equal(r.text, '{"weather":"sun"}');
  });
  await t('net: this browser\'s copy stays small (oldest answers go first; one big answer is not kept)', async () => {
    const store = mapStore(), big = 'x'.repeat(400);
    let clock = 1000;
    const net = makeNet({ fetch: fakeFetch(() => ({ body: { big } })), store, budget: 1500, maxOne: 1000, now: () => (clock += 10) });
    for (const u of ['/api/home', '/api/devices', '/api/alerts', '/api/energy']) await net.get(u);
    const kept = store.keys().filter((k) => !/:(idx|who)$/.test(k));
    assert.ok(kept.length <= 3, `kept ${kept.length}`);
    assert.ok(!kept.includes('casa.c1:/api/home'), 'the oldest went');
    const total = kept.reduce((n, k) => n + store.get(k).length, 0);
    assert.ok(total <= 1500, `total ${total}`);
    const net2 = makeNet({ fetch: fakeFetch(() => ({ body: { huge: 'y'.repeat(2000) } })), store: mapStore(), maxOne: 1000 });
    await net2.get('/api/devices');
    assert.equal(net2.peek('/api/devices') && 1, 1, 'still in memory');
  });
  await t('net: signing out (or a different person signing in) wipes the copy', async () => {
    const store = mapStore();
    store.set('someone-else', 'keep');
    const net = makeNet({ fetch: fakeFetch(() => ({ body: { a: 1 } })), store });
    net.scope('u1'); await net.get('/api/home');
    net.scope('u2');
    assert.equal(store.get('casa.c1:/api/home'), null, 'another person: nothing of the last one\'s');
    await net.get('/api/devices');
    net.clear();
    assert.deepEqual(store.keys(), ['someone-else'], 'sign-out: everything of ours is gone, nothing else touched');
    assert.equal(net.peek('/api/devices'), null);
  });
  await t('net: a broken or full browser store never breaks a read', async () => {
    const bad = { get: () => { throw new Error('denied'); }, set: () => { throw new Error('quota'); }, del: () => { throw new Error('x'); }, keys: () => { throw new Error('x'); } };
    const net = makeNet({ fetch: fakeFetch(() => ({ body: { a: 1 } })), store: bad });
    assert.equal((await net.get('/api/home')).status, 200);
    net.clear(); net.scope('u');
  });

  /* ---- the dashboard's files, named after their contents ---- */
  const A = globalThis.__casatorchAssets;
  await t('assets: the dashboard names its scripts and styles after their contents', () => {
    const html = A.withHashedAssets('<link rel="stylesheet" href="app.css"><script src="i18n.js"></script><script src="app.js"></script><script src="nope.js"></script><script>inline()</script>');
    assert.match(html, /href="app\.[0-9a-f]{10}\.css"/); assert.match(html, /src="app\.[0-9a-f]{10}\.js"/); assert.match(html, /src="i18n\.[0-9a-f]{10}\.js"/);
    assert.match(html, /src="nope\.js"/, 'a file that isn\'t there keeps its name'); assert.match(html, /<script>inline\(\)<\/script>/);
    assert.match(A.shellBuild(), /^[0-9a-f]{12}$/);
  });
  const call = (p, headers = {}) => new Promise((ok) => {
    const h = {}; let status = 200, done = false;
    const res = { setHeader: (k, v) => { h[k.toLowerCase()] = String(v); }, getHeader: (k) => h[k.toLowerCase()], status: (s) => { status = s; return res; }, type: (x) => { h['content-type'] = x; return res; }, end: (b) => { if (!done) { done = true; ok({ status, h, body: b }); } } };
    A.staticPacked({ method: 'GET', path: p, headers: { 'accept-encoding': 'br, gzip', ...headers } }, res, () => { if (!done) { done = true; ok({ next: true }); } });
  });
  await t('assets: app.<hash>.js is kept a year (private), the page and the service worker are always checked', async () => {
    const pub = path.join(HERE, '..', 'public');
    const h = A.assetHash(path.join(pub, 'app.js'));
    const js = await call(`/app.${h}.js`);
    assert.equal(js.status, 200); assert.equal(js.h['cache-control'], 'private, max-age=31536000, immutable'); assert.equal(js.h['content-encoding'], 'br');
    const old = await call('/app.0123456789.js');
    assert.equal(old.h['cache-control'], 'no-cache', 'an older name still opens, but isn\'t kept as if it were current');
    const page = await call('/index.html');
    assert.equal(page.h['cache-control'], 'no-cache');
    const sw = await call('/sw.js', { 'accept-encoding': '' });
    assert.equal(sw.h['cache-control'], 'no-cache');
    assert.ok(Buffer.from(sw.body).toString().includes(`casatorch-shell-\${VERSION}`) && !Buffer.from(sw.body).toString().includes('__CASATORCH_BUILD__'), 'the service worker carries this version');
    const again = await call(`/app.${h}.js`, { 'if-none-match': js.h.etag });
    assert.equal(again.status, 304);
    assert.equal((await call('/app.0123456789.js/../../server.js')).next, true, 'nothing outside public/');
  });
}
