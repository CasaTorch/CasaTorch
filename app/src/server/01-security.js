/* ======================================================================
 * Security headers on every answer, and fast static files.
 *
 *  - Content-Security-Policy: scripts only from this HouseOS (inline
 *    scripts in our own pages are allowed by their hashes, worked out at
 *    start-up), no plugins, forms only to here, and the page may only be
 *    framed by this HouseOS and your Home Assistant (for the HACS card).
 *  - No sniffing, no referrer leaks, no camera/geolocation for pages,
 *    HSTS when served over https.
 *  - API answers are never cached by the browser (they can hold home data).
 *  - Static files (and three.js) are compressed once with Brotli or gzip and
 *    kept in memory: a wall tablet on Wi-Fi loads the 3D page several times
 *    faster.
 * ====================================================================== */
import zlib from 'node:zlib';
import QRCode from 'qrcode';
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
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", `script-src 'self' ${inlineScriptHashes}`.trim(), "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:", "media-src 'self' blob: https:", "connect-src 'self' blob: data:", "worker-src 'self' blob:", "frame-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self' https://accounts.google.com", `frame-ancestors ${frameAncestors()}`,
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self), screen-wake-lock=(self), fullscreen=(self)');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

/* Compressed static files, cached in memory per file version. Mounted later (99-start), after sign-in. */
const packed = new Map();
function staticPacked(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const vendor = req.path.startsWith('/vendor/three/');
  let file = vendor ? path.join(THREE_DIR, decodeURIComponent(req.path.slice('/vendor/three/'.length))) : path.join(PUBLIC_DIR, decodeURIComponent(req.path === '/' ? 'index.html' : req.path));
  file = path.normalize(file);
  if (!file.startsWith(vendor ? THREE_DIR : PUBLIC_DIR) || !/\.(m?js|css|html|svg|json)$/.test(file)) return next();
  const ae = String(req.headers['accept-encoding'] || ''), enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
  let st; try { st = fs.statSync(file); if (!st.isFile() || st.size < 1024) return next(); } catch { return next(); }
  if (!enc) return next();
  const key = `${file}|${enc}`; let hit = packed.get(key);
  if (!hit || hit.v !== st.mtimeMs) {
    const raw = fs.readFileSync(file);
    const body = enc === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 8, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : zlib.gzipSync(raw, { level: 9 });
    hit = { v: st.mtimeMs, body, etag: `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16)}-${enc}"` };
    packed.set(key, hit);
  }
  res.setHeader('Vary', 'Accept-Encoding'); res.setHeader('ETag', hit.etag);
  res.setHeader('Cache-Control', vendor ? 'public, max-age=604800, immutable' : 'no-cache');
  if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
  res.type(path.extname(file)); res.setHeader('Content-Encoding', enc); res.setHeader('Content-Length', hit.body.length);
  return req.method === 'HEAD' ? res.end() : res.end(hit.body);
}
