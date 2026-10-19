/* ======================================================================
 * Sealed entry: passwords and keys are encrypted in the browser, to this box,
 * the moment they're sent - so they never cross the network readable, even
 * on a plain-http home address or through a proxy that logs what it carries.
 *
 *  - This box has a sealing key pair (ECDH P-256), made in memory, never written
 *    anywhere, replaced every day (the one before stays usable for 2 hours).
 *  - A page asks for the public half once (GET /api/seal/key) and gets a ticket
 *    with it: bound to this browser (its own cookie) and, when signed in, to the
 *    session; good for 2 hours.
 *  - Each secret is sealed on its own: a fresh one-time key pair in the browser,
 *    ECDH with the box's key, HKDF-SHA-256, AES-256-GCM. The field's name, the
 *    ticket and a one-time nonce are sealed in, so a sealed value only opens as
 *    that field, from that browser, once (a replay is refused).
 *       cts1.<kid>.<ticket>.<nonce>.<browser key>.<iv>.<sealed>
 *  - Every JSON body is opened right after it's read (express.json, 00-setup.js),
 *    inside the request that uses it. Opened bytes are wiped after use.
 *  - Secrets CasaTorch has to hand back to a page to carry forward (a Pro key
 *    claimed by e-mail during setup) go back sealed to the box itself ("ctk1."):
 *    the page can pass them on but can't read them.
 *  - Over plain http from another device, a request carrying a password or key
 *    that isn't sealed is refused: CasaTorch's own pages always seal.
 * public/sealed-input.js (and its copy in src/client/02s-sealed.js) is the browser half.
 * ====================================================================== */
const SEAL = { keys: [], tickets: new Map(), asks: new Map() };
const SEAL_DAY = 24 * 3600_000, SEAL_GRACE = 2 * 3600_000, SEAL_TICKET_MS = 2 * 3600_000, SEAL_TICKETS_MAX = 5000, SEAL_NONCES_MAX = 400;
const SEAL_COOKIE = 'casatorch_seal';
/** The sealing key in use (a new one every day). The private half exists only in this process's memory. */
function sealKeyNow(now = Date.now()) {
  SEAL.keys = SEAL.keys.filter((k) => now - k.born < SEAL_DAY + SEAL_GRACE);
  let k = SEAL.keys[SEAL.keys.length - 1];
  if (!k || now - k.born >= SEAL_DAY) {
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    k = { kid: crypto.randomBytes(6).toString('base64url'), ecdh, pub: ecdh.getPublicKey(), born: now };
    SEAL.keys.push(k);
  }
  return k;
}
const sealCookieOf = (req) => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)casatorch_seal=([\w-]{16,64})/); return m ? m[1] : null; };
const sealSid = (req) => { try { return typeof sessionOf === 'function' ? sessionOf(req)?.key || null : null; } catch { return null; } };
/* Asking for keys is cheap but not free: 120 tickets per address per 10 minutes. */
function sealAskOk(ip, now = Date.now()) {
  const a = SEAL.asks.get(ip);
  if (!a || now - a.at > 600_000) { SEAL.asks.set(ip, { at: now, n: 1 }); if (SEAL.asks.size > 5000) SEAL.asks.delete(SEAL.asks.keys().next().value); return true; }
  return ++a.n <= 120;
}
app.get('/api/seal/key', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!sealAskOk(String(req.ip || req.socket?.remoteAddress || ''))) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
  const k = sealKeyNow(), now = Date.now();
  let bind = sealCookieOf(req);
  if (!bind) {
    bind = crypto.randomBytes(18).toString('base64url');
    res.append('Set-Cookie', `${SEAL_COOKIE}=${bind}; Path=/; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`);
  }
  const ticket = crypto.randomBytes(16).toString('base64url');
  for (const [t, v] of SEAL.tickets) { if (v.exp > now && SEAL.tickets.size < SEAL_TICKETS_MAX) break; SEAL.tickets.delete(t); }   // oldest first
  SEAL.tickets.set(ticket, { kid: k.kid, bind: sha256Hex(bind), sid: sealSid(req), exp: Math.min(now + SEAL_TICKET_MS, k.born + SEAL_DAY + SEAL_GRACE), nonces: new Set() });
  res.json({ v: 1, alg: 'ECDH-P256+HKDF-SHA256+A256GCM', kid: k.kid, pub: Buffer.from(k.pub).toString('base64url'), ticket, exp: SEAL.tickets.get(ticket).exp, now });
});
const sha256Hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SEAL_RX = /^cts1\.([\w-]{4,16})\.([\w-]{16,32})\.([\w-]{16,32})\.([\w-]{80,100})\.([\w-]{16})\.([\w-]{22,})$/;
/** Opens one sealed value for this request and field. Throws { seal: 'retry' | 'bad' } when it can't. */
function openSealed(req, field, s, now = Date.now()) {
  const m = SEAL_RX.exec(String(s)); if (!m) throw Object.assign(new Error('not a sealed value'), { seal: 'bad' });
  const [, kid, ticket, nonce, epk, iv, ct] = m;
  const t = SEAL.tickets.get(ticket), k = SEAL.keys.find((x) => x.kid === kid);
  if (!t || !k || t.kid !== kid || t.exp < now) throw Object.assign(new Error('the key expired'), { seal: 'retry' });
  const bind = sealCookieOf(req);
  if (!bind || sha256Hex(bind) !== t.bind) throw Object.assign(new Error('another browser'), { seal: 'retry' });
  if (t.sid && t.sid !== sealSid(req)) throw Object.assign(new Error('another session'), { seal: 'retry' });
  if (t.nonces.has(nonce)) throw Object.assign(new Error('already used'), { seal: 'bad' });
  let shared = null, key = null, plain = null;
  try {
    shared = k.ecdh.computeSecret(Buffer.from(epk, 'base64url'));   // refuses a point that isn't on the curve
    key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(`${ticket}.${nonce}`), Buffer.from(`casatorch sealed-input v1|${kid}|${field}`), 32));
    const all = Buffer.from(ct, 'base64url'); if (all.length < 16) throw new Error('short');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(`cts1|${kid}|${ticket}|${nonce}|${field}`)); d.setAuthTag(all.subarray(all.length - 16));
    plain = Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]);
    const text = plain.toString('utf8');
    t.nonces.add(nonce); if (t.nonces.size > SEAL_NONCES_MAX) { SEAL.tickets.delete(ticket); }   // a page that sealed this much gets a new ticket
    return text;
  } catch (e) { if (e.seal) throw e; throw Object.assign(new Error('it did not open'), { seal: 'bad' }); }
  finally { shared?.fill(0); key?.fill(0); plain?.fill(0); }
}
/* Secrets handed back to a page to carry forward, sealed to this box and to where they go back in (the JSON path, like
   "answers.account.license"), good for a day. */
const keptSecret = (place, value) => `ctk1.${seal(JSON.stringify({ v: String(value), exp: Date.now() + SEAL_DAY }), `kept:${place}`)}`;
function openKept(place, s) {
  const j = (() => { try { return JSON.parse(unseal(String(s).slice(5), `kept:${place}`) || 'null'); } catch { return null; } })();
  return j && typeof j.v === 'string' && j.exp > Date.now() ? j.v : null;
}
/* Field names that are always a password or key: over plain http from another device they must arrive sealed. */
const MUST_SEAL = /^(password\d?|passphrase|apiKey|api_key|apikey|secret|clientSecret|client_secret|refreshToken|refresh_token|totp_secret)$/;
const sealSafeLink = (req) => req.secure || (isLoop(String(req.socket?.remoteAddress || '')) && !req.headers['x-forwarded-for']);
const SEAL_HEADERS = ['x-backup-passphrase'];
const SEAL_NOT_OPENED = /^\/api\/setup\/progress\/?$/;   // answers kept as you go: sealed values are dropped there, never opened (05-setup.js)
const SEAL_RETRY = 'This page\'s secure key ran out - try again.';
/** Opens every sealed value in a request's JSON body (and the sealed headers), in place. */
function openSealedRequest(req, res, next) {
  const p = String(req.originalUrl || req.url || '').split('?')[0];
  if (SEAL_NOT_OPENED.test(p)) { dropSealedValues(req.body); return next(); }
  const strict = !sealSafeLink(req) && !/^\/api\/app\//.test(p), pwRoute = /^\/api\/auth\/password\/?$/.test(p);
  let plainField = null;
  try {
    const walk = (o, place, depth) => {
      if (!o || typeof o !== 'object' || depth > 8) return;
      for (const k of Object.keys(o)) {
        const v = o[k], at = Array.isArray(o) ? `${place}[]` : place ? `${place}.${k}` : k, name = Array.isArray(o) ? place.split('.').pop() : k;
        if (typeof v === 'string') {
          if (v.startsWith('cts1.')) o[k] = openSealed(req, name, v);
          else if (v.startsWith('ctk1.')) { const x = openKept(at, v); if (x === null) throw Object.assign(new Error('kept value'), { seal: 'kept' }); o[k] = x; }
          else if (strict && v && (MUST_SEAL.test(name) || (pwRoute && (name === 'current' || name === 'next')))) plainField = name;
        } else walk(v, at, depth + 1);
      }
    };
    walk(req.body, '', 0);
    for (const h of SEAL_HEADERS) {
      const v = req.headers[h];
      if (typeof v === 'string' && v.startsWith('cts1.')) req.headers[h] = openSealed(req, h, v);
      else if (strict && v) plainField = h;
    }
  } catch (e) {
    req.body = {};   // nothing half-opened is left on the request
    if (e.seal === 'kept') return res.status(400).json({ error: 'That saved key has expired - enter it again.' });
    res.setHeader('X-CasaTorch-Seal', e.seal === 'retry' ? 'retry' : 'bad');
    return res.status(e.seal === 'retry' ? 409 : 400).json({ error: e.seal === 'retry' ? SEAL_RETRY : 'That request couldn\'t be opened. Refresh the page and try again.', seal: e.seal });
  }
  if (plainField) {
    req.body = {};
    res.setHeader('X-CasaTorch-Seal', 'required');
    return res.status(400).json({ error: 'For your safety, passwords and keys are only accepted from CasaTorch\'s own pages. Refresh this page and try again.', seal: 'required' });
  }
  next();
}
/** One sealed header, opened in place (for a request whose body isn't JSON, like a backup being restored). */
function openSealedHeader(req, h) { const v = req.headers[h]; if (typeof v === 'string' && v.startsWith('cts1.')) req.headers[h] = openSealed(req, h, v); }
/** Setup's kept answers: no secret is kept there unless it's one sealed to the box (ctk1); sealed-in-transit ones go. */
function dropSealedValues(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 8) return o;
  for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string' && v.startsWith('cts1.')) o[k] = ''; else dropSealedValues(v, depth + 1); }
  return o;
}
const TYPED_SECRET = /^(password\d?|passphrase|token|access_token|refreshToken|refresh_token|apiKey|api_key|apikey|secret|clientSecret|client_secret|totp_secret|license|privateKey|pin|uaid|dnsKey|snapshotUrl)$/i;
/** A copy of setup's answers without any typed password or key (each is asked again after a restart). */
function dropTypedSecrets(a, depth = 0) {
  if (Array.isArray(a)) return a.map((v) => dropTypedSecrets(v, depth + 1));
  if (!a || typeof a !== 'object' || depth > 10) return a;
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === 'string' && v && (TYPED_SECRET.test(k) || v.startsWith('cts1.')) && !v.startsWith('ctk1.') && !(k === 'snapshotUrl' && !/\/\/[^/?#]*@/.test(v))) continue;   // a snapshot address is kept unless it has a login in it
    out[k] = dropTypedSecrets(v, depth + 1);
  }
  return out;
}
/** An object whose listed fields, whenever they're set, keep their secrets sealed in memory (sealedView, 00-setup.js). */
function sealedHolder(names, place) {
  const vals = {}, o = {};
  for (const n of names) Object.defineProperty(o, n, { enumerable: true, get: () => vals[n] ?? null, set: (v) => { vals[n] = v && typeof v === 'object' ? sealedView(v, n, `${place}.${n}`) : v; } });
  return o;
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchSeal = { SEAL, sealKeyNow, openSealed, openSealedRequest, keptSecret, openKept, dropTypedSecrets, sealedView, sealedHolder, maskSecret, seal, unseal, sealConfig, openConfig, SEAL_RX };
