/* CasaTorch web app: opens fast and shows something useful when the CasaTorch can't be reached,
   and shows alerts on this device (Web Push). Never caches anything from /api - your home's data
   always comes live, and is never kept on the phone by this worker. */
const SHELL = 'casatorch-shell-v1';
const PRECACHE = ['/', '/app.css', '/app.js', '/favicon.svg', '/icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || /^\/(login|setup)/.test(u.pathname)) return;
  // Network first (always the newest CasaTorch), the last copy only when the network fails.
  e.respondWith(fetch(r).then((res) => {
    if (res.ok && !res.redirected && res.type === 'basic' && (r.mode === 'navigate' || PRECACHE.includes(u.pathname))) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(r.mode === 'navigate' ? '/' : r, copy)); }
    return res;
  }).catch(() => caches.match(r.mode === 'navigate' ? '/' : r).then((hit) => hit || new Response('CasaTorch can\'t be reached right now.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))));
});
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data.json(); } catch { m = { title: 'CasaTorch', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'CasaTorch', { body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', requireInteraction: m.sev === 'critical', data: { url: m.url || '/#alerts' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/#alerts', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(location.origin));
    return w ? w.focus().then(() => w.navigate(url)).catch(() => self.clients.openWindow(url)) : self.clients.openWindow(url);
  }));
});
