/* Secure address at home (43-local-https.js): once it's ready, a browser that opens the plain http address
   is moved to the https one before anything else - before the sign-in page - so no password crosses the
   Wi-Fi unencrypted. It runs this early for that reason.

   It doesn't redirect blindly: some routers refuse names that point into the home network ("DNS rebinding
   protection"). The page sent instead (public/go-secure.html) checks the https address really answers from
   this browser, then goes there; if it doesn't, it remembers that for a day and carries on over http.
   This computer itself (localhost) is left alone - browsers already treat it as secure. */
const LOCAL_TLS = { url: null };   // set by 43-local-https.js when the certificate and the https server are ready
const isLoopback = (req) => /^(::1|127\.|::ffff:127\.)/.test(String(req.socket?.remoteAddress || ''));
function wantsSecure(req) {
  if (!LOCAL_TLS.url || req.secure || req.method !== 'GET' || isLoopback(req)) return false;
  if (req.path.startsWith('/api/') || /^\/(go-secure\.(html|js)|i18n|icons\/|favicon|sw\.js|manifest\.webmanifest)/.test(req.path)) return false;
  if (/(?:^|;\s*)ct_plain=1/.test(String(req.headers.cookie || ''))) return false;   // this browser couldn't reach it
  const dest = req.headers['sec-fetch-dest'];
  return dest ? dest === 'document' : /text\/html/.test(String(req.headers.accept || ''));
}
app.use((req, res, next) => {
  if (!wantsSecure(req)) return next();
  res.setHeader('Cache-Control', 'no-store');
  const csp = String(res.getHeader('Content-Security-Policy') || '');   // this one page may check the https address
  if (csp) res.setHeader('Content-Security-Policy', csp.replace("connect-src 'self'", `connect-src 'self' ${LOCAL_TLS.url}`));
  res.sendFile(path.join(APP_DIR, 'public', 'go-secure.html'));
});
/* Where the go-secure page should try (public: it runs before sign-in, and says nothing private). */
app.get('/api/local-https/target', (_req, res) => res.json({ url: LOCAL_TLS.url }));
/* The go-secure page's check: answers on the https address, readable from the plain one (nothing in it). */
app.get('/api/local-https/ping', (_req, res) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); res.setHeader('Access-Control-Allow-Origin', '*'); res.status(204).end(); });
