/* ======================================================================
 * Security headers on every answer, and fast static files.
 *
 *  - Content-Security-Policy: scripts only from this CasaTorch (inline
 *    scripts in our own pages are allowed by their hashes, worked out at
 *    start-up), no plugins, forms only to here, and the page may only be
 *    framed by this CasaTorch and your Home Assistant (for the HACS card).
 *  - No sniffing, no referrer leaks, no camera/geolocation for pages,
 *    HSTS when served over https.
 *  - API answers are never cached by the browser (they can hold home data).
 *  - Static files (and three.js) are compressed once with Brotli or gzip and
 *    kept in memory: a wall tablet on Wi-Fi loads the 3D page several times
 *    faster.
 * ====================================================================== */
import zlib from 'node:zlib';
const QRCode = { toString: async (...a) => (await import('qrcode')).default.toString(...a) };   // loaded the first time a QR code is drawn, not at every start
const PUBLIC_DIR = path.join(APP_DIR, 'public'), THREE_DIR = path.join(APP_DIR, 'node_modules', 'three');
const inlineScriptHashes = (() => {
  const out = new Set();
  for (const f of fs.existsSync(PUBLIC_DIR) ? fs.readdirSync(PUBLIC_DIR).filter((x) => x.endsWith('.html')) : []) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) out.add(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  }
  return [...out].join(' ');
})();
const frameAncestors = () => {
  const list = new Set(["'self'", 'http://homeassistant.local:8123', 'https://homeassistant.local:8123']);
  try { if (config.homeAssistant?.url && !/supervisor/.test(config.homeAssistant.url)) list.add(new URL(config.homeAssistant.url).origin); } catch { /* not a URL */ }
  for (const o of config.security?.frameAncestors || []) if (/^https?:\/\/[\w.-]+(:\d+)?$/.test(o)) list.add(o);
  return [...list].join(' ');
};
app.set('trust proxy', 'loopback');
/* Which names CasaTorch answers to. A web page on some other site can't point its own name at this box
   ("DNS rebinding") and talk to it: only addresses, home-network names, and CasaTorch's own secure names are
   accepted. Others can be added (Settings › Safety › Allowed names, or CASATORCH_ALLOWED_HOSTS=name1,name2). */
const HOME_SUFFIX = /\.(local|lan|home|home\.arpa|internal|localdomain|intranet|corp|private|ts\.net)$/i;
function hostAllowed(hostHeader) {
  const h = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return false;
  if (net.isIP(h) || !h.includes('.') || HOME_SUFFIX.test(h)) return true;
  if (LOCAL_TLS.url && h === new URL(LOCAL_TLS.url).hostname) return true;
  if (config.remote?.hostname && h === String(config.remote.hostname).toLowerCase()) return true;
  try { if (config.homeAssistant?.url && h === new URL(config.homeAssistant.url).hostname) return true; } catch { /* not a URL */ }
  const extra = [...String(process.env.CASATORCH_ALLOWED_HOSTS || '').split(','), ...(config.security?.allowedHosts || [])].map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  return extra.includes(h);
}
app.use((req, res, next) => {
  if (hostAllowed(req.headers.host)) return next();
  res.status(421).type('text/plain').send(`CasaTorch doesn't answer to "${String(req.headers.host || '').slice(0, 80)}". Open it with its address on your network (like http://192.168.1.20:8090) or casatorch.com/home. To use this name, add it in Settings › Safety › Allowed names, or set CASATORCH_ALLOWED_HOSTS.`);
});
/* Changes only from CasaTorch's own pages: a request another site's page makes is refused. Registered here,
   before every route - setup's included. The one exception is the CasaTorch phone app, whose built-in screens run from
   their own origins: its sign-in calls carry no cookies (nothing to forge), and once signed in it sends its own token. */
const APP_ORIGINS = new Set(['casatorch-app://app', 'https://appassets.androidplatform.net']);
const APP_OPEN = /^\/(?:api\/)?app\/(login|mfa|enroll|terms|claim|hello)$/;
const fromApp = (req) => (!req.headers.origin || APP_ORIGINS.has(req.headers.origin)) && !/(?:^|;\s*)casatorch_session=/.test(String(req.headers.cookie || '')) && (APP_OPEN.test(req.path) || /^Bearer [A-Za-z0-9_-]{20,200}$/.test(String(req.headers.authorization || '')));
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (fromApp(req)) return next();
  const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return res.status(403).json({ error: 'refused: that request did not come from CasaTorch' });
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'refused: that request did not come from CasaTorch' }); } catch { return res.status(403).json({ error: 'refused' }); } }
  next();
});
/* Before setup, only setup itself may change anything (no sign-in links, no Google or two-step policy, no
   settings): a fresh box on the network can't be quietly given a way back in before its owner finishes setup. */
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || isConfigured() || isDemo()) return next();
  if (/^\/(setup|license\/claim)\//.test(req.path)) return next();
  res.status(409).json({ error: 'Finish setup first.' });
});
/* Live camera video comes over a WebSocket to this same address. Newer browsers count ws:/wss: to the page's own
   address as 'self'; older Safari (and so older iPhones) don't, so the page's own address is named too - only that one. */
const wsSelf = (req) => { const h = String(req.headers.host || ''); return /^[\w.-]{1,253}(:\d{1,5})?$|^\[[\da-f:.]{2,45}\](:\d{1,5})?$/i.test(h) ? ` wss://${h}${req.secure ? '' : ` ws://${h}`}` : ''; };
/* 'wasm-unsafe-eval' lets WebAssembly run (the 3D home's Draco, meshopt and KTX2 decoders for compressed scans); JavaScript eval stays off. */
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", `script-src 'self' 'wasm-unsafe-eval' ${inlineScriptHashes}`.trim(), "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:", "media-src 'self' blob: https:", `connect-src 'self' blob: data:${wsSelf(req)}`, "worker-src 'self' blob:", "frame-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self' https://accounts.google.com", `frame-ancestors ${frameAncestors()}`,
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self), screen-wake-lock=(self), fullscreen=(self)');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // a page that opened CasaTorch gets no handle on its window. "allow-popups", and none on the way back from Home
  // Assistant's sign-in window: that window tells setup it's done through window.opener (public/setup-ha-done.js).
  if (req.path !== '/setup-ha-done.html' && req.path !== '/api/setup/ha/callback') res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
/* API answers (JSON) are compressed too once they're worth it (the device list, history, the catalog): a few KB
   instead of tens over Wi-Fi or secure access. Only reads, and only for CasaTorch's own pages (never another site's
   request), so nothing a page sends in can be compared against a secret in the answer. Quick Brotli/gzip settings. */
app.use('/api', (req, res, next) => {
  const ae = String(req.headers['accept-encoding'] || ''), enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null, site = req.headers['sec-fetch-site'];
  if (!enc || req.method !== 'GET' || (site && site !== 'same-origin' && site !== 'none')) return next();
  const send = res.send;
  res.send = function packJson(body) {
    if ((typeof body === 'string' || Buffer.isBuffer(body)) && /json/.test(String(res.getHeader('Content-Type') || '')) && !res.getHeader('Content-Encoding') && Buffer.byteLength(body) >= 1400) {
      const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const out = enc === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : zlib.gzipSync(raw, { level: 6 });
      res.setHeader('Content-Encoding', enc); res.vary('Accept-Encoding');
      return send.call(this, out);
    }
    return send.call(this, body);
  };
  next();
});

/* Compressed static files, cached in memory per file version. Mounted later (99-start), after sign-in.
   The dashboard names each script and style sheet after its contents (app.js is asked for as app.3f2a9c1b7d.js): the browser
   keeps those a year and never asks again - over a slow link that's no round trip per file on every open - and an
   update changes the name. Pages themselves (and sw.js, which carries the same version) are always checked. */
const packed = new Map();
/* Brotli quality 6, not 8: a quarter of the time for 2% larger files - the 3D engine packed in about 70 ms instead of
   330 (four times that on a Raspberry Pi), and the page load no longer holds up the live updates. Done in line on
   purpose: on the thread pool each worker thread keeps its own copy of the encoder's memory (~100 MB more on a Pi). */
function packFile(file, enc, v, raw = fs.readFileSync(file)) {
  const body = enc === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : zlib.gzipSync(raw, { level: 6 });
  const hit = { v, body, etag: `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16)}-${enc}"` };
  packed.set(`${file}|${enc}`, hit);
  return hit;
}
const ASSET_HASH = new Map();   // file -> { v, size, h }
function assetHash(file) {
  let st; try { st = fs.statSync(file); if (!st.isFile()) return null; } catch { return null; }
  const hit = ASSET_HASH.get(file);
  if (hit && hit.v === st.mtimeMs && hit.size === st.size) return hit.h;
  const h = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  ASSET_HASH.set(file, { v: st.mtimeMs, size: st.size, h });
  return h;
}
const HASHED_ASSET = /^\/([\w-]+(?:\.[\w-]+)*)\.([0-9a-f]{10})\.(js|css)$/;
const ASSET_REF = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")(\/?)([\w-]+(?:\.[\w-]+)*\.(?:js|css))(")/g;
/* A page's own scripts and style sheets, by their contents' names (only files right in public/, as the page names them). */
const withHashedAssets = (html) => html.replace(ASSET_REF, (m, a, slash, name, z) => { const h = assetHash(path.join(PUBLIC_DIR, name)); return h ? `${a}${slash}${name.replace(/\.(js|css)$/, `.${h}.$1`)}${z}` : m; });
/* The app shell's version (the service worker's cache name): changes whenever the dashboard page or anything it loads does. */
function shellBuild() {
  let html = ''; try { html = withHashedAssets(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')); } catch { /* none */ }
  return crypto.createHash('sha256').update(html).update(assetHash(path.join(PUBLIC_DIR, 'sw.js')) || '').digest('hex').slice(0, 12);
}
function staticPacked(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const vendor = req.path.startsWith('/vendor/three/');
  let rel = req.path === '/' ? '/index.html' : req.path, hashed = null;
  if (!vendor) { const m = HASHED_ASSET.exec(rel); if (m && fs.existsSync(path.join(PUBLIC_DIR, `${m[1]}.${m[3]}`))) { rel = `/${m[1]}.${m[3]}`; hashed = m[2]; } }
  let file;
  try { file = vendor ? path.join(THREE_DIR, decodeURIComponent(rel.slice('/vendor/three/'.length))) : path.join(PUBLIC_DIR, decodeURIComponent(rel)); } catch { return next(); }   // a broken %-escape
  file = path.normalize(file);
  if (!file.startsWith((vendor ? THREE_DIR : PUBLIC_DIR) + path.sep) || !/\.(m?js|css|html|svg|json)$/.test(file)) return next();
  let st; try { st = fs.statSync(file); if (!st.isFile()) return next(); } catch { return next(); }
  const top = !vendor && path.dirname(file) === PUBLIC_DIR;
  const kind = top && path.basename(file) === 'index.html' ? 'html' : top && path.basename(file) === 'sw.js' ? 'sw' : null;   // the dashboard (behind sign-in, as its files are); the sign-in and setup pages keep plain names
  const ae = String(req.headers['accept-encoding'] || ''), enc0 = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
  if (!kind && !hashed && (!enc0 || st.size < 1024)) return next();   // small or not compressible here: express.static as always
  let raw = null, v = st.mtimeMs;
  if (kind) {
    try { const text = fs.readFileSync(file, 'utf8'); raw = Buffer.from(kind === 'html' ? withHashedAssets(text) : text.replaceAll('__CASATORCH_BUILD__', shellBuild())); } catch { return next(); }
    v = crypto.createHash('sha1').update(raw).digest('base64url');
  }
  const size = raw ? raw.length : st.size, enc = enc0 && size >= 1024 ? enc0 : null;
  let body, etag;
  if (enc) {
    let hit = packed.get(`${file}|${enc}`);
    if (!hit || hit.v !== v) { try { hit = packFile(file, enc, v, raw || undefined); } catch { return next(); } }
    body = hit.body; etag = hit.etag;
  } else {
    try { body = raw || fs.readFileSync(file); } catch { return next(); }
    etag = `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;
  }
  // named after its contents (and still that content): kept a year in this browser only (private: never by a shared cache)
  const forever = hashed && assetHash(file) === hashed;
  res.setHeader('Vary', 'Accept-Encoding'); res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', vendor ? 'public, max-age=604800, immutable' : forever ? 'private, max-age=31536000, immutable' : 'no-cache');
  if (kind === 'sw') res.setHeader('Service-Worker-Allowed', '/');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.type(path.extname(file)); if (enc) res.setHeader('Content-Encoding', enc); res.setHeader('Content-Length', body.length);
  return req.method === 'HEAD' ? res.end() : res.end(body);
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchAssets = { assetHash, withHashedAssets, shellBuild, HASHED_ASSET, staticPacked };
