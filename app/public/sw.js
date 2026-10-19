/* CasaTorch web app: opens fast - even over a slow link, even when the CasaTorch can't be reached - and shows alerts
   on this device (Web Push).
   - The dashboard page opens from its last copy at once while a fresh copy is fetched for next time.
   - Its scripts and style sheets are named after their contents (app.3f2a9c1b7d.js): kept here, never asked again.
   - Nothing from /api is ever kept by this worker, and nothing from the sign-in or setup pages: your home's data and
     sign-ins only come live (the page keeps its own small copy of what it last showed, and wipes it on sign-out).
   The version below is filled in by the CasaTorch when it sends this file: every update makes a new cache and the
   old one is removed. */
const VERSION = '__CASATORCH_BUILD__';
const SHELL = `casatorch-shell-${VERSION}`;
const ICONS = ['/favicon.svg', '/icons/icon-192.png'];
const HASHED = /\.[0-9a-f]{10}\.(js|css)$/;
const KEEP_SWR = /^\/(i18n\/[a-z]{2}\.json|i18n\.js|device-controls\.js|favicon\.svg|icons\/|apple-touch-icon\.png|manifest\.webmanifest)/;
const okToKeep = (res) => res && res.ok && !res.redirected && res.type === 'basic';
/* Install: the dashboard page and everything it names. */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    try {
      const res = await fetch('/', { cache: 'no-cache', credentials: 'same-origin' });
      if (okToKeep(res)) {
        const html = await res.clone().text();
        await c.put('/', res);
        const refs = [...html.matchAll(/(?:src|href)="\/?([\w.-]+\.[0-9a-f]{10}\.(?:js|css))"/g)].map((m) => `/${m[1]}`);
        await Promise.all(refs.map((u) => c.add(u).catch(() => {})));
      }
    } catch { /* offline or signed out: kept as pages are opened */ }
    await Promise.all(ICONS.map((u) => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
/* A fresh copy for next time; a redirect (signed out, or the box was reset to setup) means the old copy goes. */
async function refresh(c, key, req) {
  const res = await fetch(req);
  if (okToKeep(res)) await c.put(key, res.clone());
  else if (res.redirected || res.type === 'opaqueredirect' || res.status === 401 || res.status === 404) await c.delete(key);
  return res;
}
const timeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
const unreachable = () => new Response('CasaTorch can\'t be reached right now.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || /^\/(login|setup|recover|go-secure)/.test(u.pathname)) return;
  const nav = r.mode === 'navigate';
  /* the dashboard page: its last copy now (instant, even offline), a fresh copy for next time */
  if (nav && (u.pathname === '/' || u.pathname === '/index.html')) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL), hit = await c.match('/');
      const live = refresh(c, '/', r);
      if (hit) { e.waitUntil(live.catch(() => {})); return hit; }
      return live.catch(() => unreachable());
    })());
    return;
  }
  /* named after their contents: never change, so the kept copy is the copy */
  if (HASHED.test(u.pathname)) {
    e.respondWith(caches.open(SHELL).then(async (c) => (await c.match(u.pathname)) || fetch(r).then((res) => { if (okToKeep(res)) c.put(u.pathname, res.clone()).catch(() => {}); return res; })));
    return;
  }
  /* small files that rarely change (languages, icons): the kept copy now, checked in the background */
  if (KEEP_SWR.test(u.pathname)) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(r, { ignoreSearch: false }), live = refresh(c, r, r);
      if (hit) { e.waitUntil(live.catch(() => {})); return hit; }
      return live.catch(() => unreachable());
    }));
    return;
  }
  /* other pages (the 3D home, legal pages): the network first, the last copy if it doesn't answer within 4 s */
  if (nav && u.pathname.endsWith('.html')) {
    e.respondWith(caches.open(SHELL).then((c) => timeout(refresh(c, u.pathname, r), 4000).catch(async () => (await c.match(u.pathname)) || (await c.match('/')) || unreachable())));
  }
});
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data.json(); } catch { m = { title: 'CasaTorch', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'CasaTorch', { body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', requireInteraction: m.sev === 'critical', silent: m.silent === true, data: { url: m.url || '/#alerts' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url = new URL('/#alerts', location.origin).href;
  try { const u = new URL(e.notification.data?.url || '/#alerts', location.origin); if (u.origin === location.origin) url = u.href; } catch { /* keep the alerts page */ }   // only pages on this CasaTorch
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(location.origin));
    return w ? w.focus().then(() => w.navigate(url)).catch(() => self.clients.openWindow(url)) : self.clients.openWindow(url);
  }));
});
