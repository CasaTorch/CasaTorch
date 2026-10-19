/* CasaTorch sealed entry - the browser half (the box's half: src/server/02s-sealed-input.js).
   Passwords and keys a page sends to CasaTorch are encrypted here, to this CasaTorch, the moment they're sent: so they
   never cross the network readable - not on a plain-http home address, not through a proxy that logs what it carries.
   Each one: a fresh one-time key pair, ECDH P-256 with the box's key of the day, HKDF-SHA-256, AES-256-GCM, with the
   field's name, a ticket bound to this browser and a one-time nonce sealed in. WebCrypto when the page has it (https,
   localhost); on a plain-http address browsers don't offer WebCrypto, so the same steps run in the small JavaScript
   versions below. If even those can't run (a very old browser), a password is only sent over https.
   It works by wrapping fetch: every request to CasaTorch's API is checked for fields that hold a password or key.
   The same file is src/client/02s-sealed.js (in the dashboard's app.js); test/unit.mjs checks they match. */
/* @sealed:start */
(function sealedInput(G) {
  if (!G || G.CasaSeal || typeof G.fetch !== 'function') return;
  const KEYS = /^(password\d?|passphrase|token|access_token|refreshToken|refresh_token|apiKey|api_key|apikey|secret|clientSecret|client_secret|totp_secret|license|privateKey|pin|uaid|dnsKey|snapshotUrl)$/i;
  const BY_PATH = [[/^\/api\/auth\/password\/?$/, /^(current|next)$/], [/^\/api\/license\/?$/, /^key$/], [/^\/api\/(auth|app)\//, /^code$/], [/^\/api\/setup\/code\/?$/, /^code$/]];
  const HEADERS = ['x-backup-passphrase'];
  const NOT_SENT = /^\/api\/setup\/progress\/?$/;   // setup's answers kept as you go: passwords and keys are left out (asked again)
  const enc = new TextEncoder();
  const b64u = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = (s) => { const t = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  const rand = (n) => { const u = new Uint8Array(n); G.crypto.getRandomValues(u); return u; };
  const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
  const subtle = (() => { try { return G.isSecureContext !== false && G.crypto && G.crypto.subtle && typeof G.crypto.subtle.deriveBits === 'function' ? G.crypto.subtle : null; } catch (e) { return null; } })();
  const canJs = (() => { try { return typeof BigInt === 'function' && !!(G.crypto && G.crypto.getRandomValues) && typeof TextEncoder === 'function'; } catch (e) { return false; } })();

  /* ---- the JavaScript versions (only when this page has no WebCrypto) ---- */
  const JS = canJs ? (() => {
    /* SHA-256, HMAC, HKDF */
    const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    function sha256(msg) {
      const l = msg.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb); m.set(msg); m[l] = 0x80;
      const dv = new DataView(m.buffer); dv.setUint32(nb - 4, (l * 8) >>> 0); dv.setUint32(nb - 8, Math.floor(l / 0x20000000));
      const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64);
      const r = (x, n) => (x >>> n) | (x << (32 - n));
      for (let o = 0; o < nb; o += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
        for (let i = 16; i < 64; i++) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
          const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
          hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
      }
      const out = new Uint8Array(32), ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]); return out;
    }
    function hmac(key, msg) {
      if (key.length > 64) key = sha256(key);
      const k = new Uint8Array(64); k.set(key); const ip = k.map((x) => x ^ 0x36), op = k.map((x) => x ^ 0x5c);
      return sha256(cat(op, sha256(cat(ip, msg))));
    }
    const hkdf32 = (ikm, salt, info) => hmac(hmac(salt, ikm), cat(info, new Uint8Array([1])));
    /* AES-256 (encrypt only) and GCM */
    const SB = new Uint8Array(256);
    { let p = 1, q = 1; do { p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0); q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09; SB[p] = (q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4)) ^ 0x63) & 0xff; } while (p !== 1); SB[0] = 0x63; }
    const xt = (x) => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
    function expand(key) {
      const w = new Uint8Array(240); w.set(key); let rc = 1;
      for (let i = 32; i < 240; i += 4) {
        let t = w.slice(i - 4, i);
        if (i % 32 === 0) { t = new Uint8Array([SB[t[1]] ^ rc, SB[t[2]], SB[t[3]], SB[t[0]]]); rc = xt(rc); } else if (i % 32 === 16) t = t.map((x) => SB[x]);
        for (let j = 0; j < 4; j++) w[i + j] = w[i - 32 + j] ^ t[j];
      }
      return w;
    }
    function block(w, inp) {
      const s = inp.slice(0, 16);
      for (let j = 0; j < 16; j++) s[j] ^= w[j];
      for (let r = 1; r <= 14; r++) {
        for (let j = 0; j < 16; j++) s[j] = SB[s[j]];
        const t = s.slice(); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) s[c * 4 + rr] = t[((c + rr) % 4) * 4 + rr];   // shift rows
        if (r < 14) for (let c = 0; c < 4; c++) { const a = s.slice(c * 4, c * 4 + 4), x = a[0] ^ a[1] ^ a[2] ^ a[3]; for (let rr = 0; rr < 4; rr++) s[c * 4 + rr] = a[rr] ^ x ^ xt(a[rr] ^ a[(rr + 1) % 4]); }
        for (let j = 0; j < 16; j++) s[j] ^= w[r * 16 + j];
      }
      return s;
    }
    const big = (u8) => u8.reduce((n, x) => (n << 8n) | BigInt(x), 0n);
    const bytes = (n, len) => { const u = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { u[i] = Number(n & 0xffn); n >>= 8n; } return u; };
    const R = 0xe1n << 120n;
    function gmul(x, y) { let z = 0n, v = y; for (let i = 127; i >= 0; i--) { if ((x >> BigInt(i)) & 1n) z ^= v; v = v & 1n ? (v >> 1n) ^ R : v >> 1n; } return z; }
    function gcm(key, iv, aad, pt) {
      const w = expand(key), h = big(block(w, new Uint8Array(16))), j0 = cat(iv, new Uint8Array([0, 0, 0, 1]));
      const ct = new Uint8Array(pt.length), ctr = j0.slice();
      for (let o = 0; o < pt.length; o += 16) {
        for (let i = 15; i >= 12; i--) { ctr[i] = (ctr[i] + 1) & 0xff; if (ctr[i]) break; }
        const ks = block(w, ctr); for (let i = 0; i < 16 && o + i < pt.length; i++) ct[o + i] = pt[o + i] ^ ks[i];
      }
      let y = 0n;
      const absorb = (d) => { for (let o = 0; o < d.length; o += 16) { const b = new Uint8Array(16); b.set(d.subarray(o, o + 16)); y = gmul(y ^ big(b), h); } };
      absorb(aad); absorb(ct); y = gmul(y ^ ((BigInt(aad.length * 8) << 64n) | BigInt(ct.length * 8)), h);
      const tag = bytes(y ^ big(block(w, j0)), 16);
      w.fill(0);
      return cat(ct, tag);
    }
    /* P-256 */
    const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn, N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
    const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n, GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;
    const md = (x) => { x %= P; return x < 0n ? x + P : x; };
    const inv = (x) => { let r = 1n, b = md(x), e = P - 2n; while (e) { if (e & 1n) r = md(r * b); b = md(b * b); e >>= 1n; } return r; };
    const dbl = ([X, Y, Z]) => {
      if (!Y || !Z) return [0n, 1n, 0n];
      const d = md(Z * Z), g = md(Y * Y), be = md(X * g), al = md(3n * md(X - d) * md(X + d));
      const X3 = md(al * al - 8n * be), Z3 = md(md((Y + Z) * (Y + Z)) - g - d), Y3 = md(al * md(4n * be - X3) - 8n * md(g * g));
      return [X3, Y3, Z3];
    };
    const add = (p1, p2) => {
      if (!p1[2]) return p2; if (!p2[2]) return p1;
      const [X1, Y1, Z1] = p1, [X2, Y2, Z2] = p2, z1 = md(Z1 * Z1), z2 = md(Z2 * Z2);
      const U1 = md(X1 * z2), U2 = md(X2 * z1), S1 = md(Y1 * z2 * Z2), S2 = md(Y2 * z1 * Z1);
      if (U1 === U2) return S1 === S2 ? dbl(p1) : [0n, 1n, 0n];
      const H = md(U2 - U1), Rr = md(S2 - S1), H2 = md(H * H), H3 = md(H2 * H);
      const X3 = md(Rr * Rr - H3 - 2n * U1 * H2), Y3 = md(Rr * md(U1 * H2 - X3) - S1 * H3), Z3 = md(H * Z1 * Z2);
      return [X3, Y3, Z3];
    };
    const mul = (k, pt) => { let r = [0n, 1n, 0n]; for (let i = 255; i >= 0; i--) { r = dbl(r); if ((k >> BigInt(i)) & 1n) r = add(r, pt); } return r; };
    const affine = ([X, Y, Z]) => { const zi = inv(Z), zi2 = md(zi * zi); return [md(X * zi2), md(Y * zi2 * zi)]; };
    const onCurve = (x, y) => x < P && y < P && md(y * y) === md(x * x * x - 3n * x + B);
    function ecdh(serverPub) {
      if (serverPub.length !== 65 || serverPub[0] !== 4) throw new Error('bad key');
      const qx = big(serverPub.subarray(1, 33)), qy = big(serverPub.subarray(33));
      if (!onCurve(qx, qy)) throw new Error('bad key');
      const k = (big(rand(40)) % (N - 1n)) + 1n;
      const [px, py] = affine(mul(k, [GX, GY, 1n])), [sx] = affine(mul(k, [qx, qy, 1n]));
      return { pub: cat(new Uint8Array([4]), bytes(px, 32), bytes(py, 32)), shared: bytes(sx, 32) };
    }
    return { sha256, hmac, hkdf32, gcm, ecdh };
  })() : null;

  /* ---- sealing one value ---- */
  async function sealOne(k, field, value) {
    const nonce = b64u(rand(16)), iv = rand(12), pt = enc.encode(String(value));
    const salt = enc.encode(`${k.ticket}.${nonce}`), info = enc.encode(`casatorch sealed-input v1|${k.kid}|${field}`), aad = enc.encode(`cts1|${k.kid}|${k.ticket}|${nonce}|${field}`);
    const server = unb64u(k.pub);
    let epk, ct;
    if (subtle) {
      const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const spub = await subtle.importKey('raw', server, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: spub }, eph.privateKey, 256));
      const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']); shared.fill(0);
      const ak = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, ak, pt));
      epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
    } else {
      const e = JS.ecdh(server), key = JS.hkdf32(e.shared, salt, info);
      ct = JS.gcm(key, iv, aad, pt); epk = e.pub; e.shared.fill(0); key.fill(0);
    }
    pt.fill(0);
    return `cts1.${k.kid}.${k.ticket}.${nonce}.${b64u(epk)}.${b64u(iv)}.${b64u(ct)}`;
  }

  /* ---- the box's key of the day (asked once per page, again when it runs out) ---- */
  const f0 = G.fetch;
  let key = null, keyAsk = null;
  async function keyNow(fresh) {
    if (!fresh && key && key.exp - (Date.now() + key.skew) > 120000) return key;
    if (!keyAsk) keyAsk = (async () => {
      try {
        const r = await f0.call(G, '/api/seal/key', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) throw new Error('no key');
        const j = await r.json(); if (!j || !j.pub || !j.ticket || !j.kid) throw new Error('no key');
        key = { kid: j.kid, pub: j.pub, ticket: j.ticket, exp: j.exp, skew: (j.now || Date.now()) - Date.now() }; return key;
      } finally { keyAsk = null; }
    })();
    return keyAsk;
  }
  const can = !!subtle || !!JS;
  const CANT = 'This browser can\'t send passwords securely on this address. Open CasaTorch with its https address, or use an up-to-date browser.';
  const cant = () => { try { return G.CasaI18n && G.CasaI18n.T ? G.CasaI18n.T(CANT) : CANT; } catch (e) { return CANT; } };   // in the home's language (i18n.js)

  /* ---- which fields hold a secret ---- */
  const isSecret = (path, name, v) => typeof v === 'string' && v !== '' && !/^ct[sk]1\./.test(v) && (KEYS.test(name) || BY_PATH.some(([p, k]) => p.test(path) && k.test(name)));
  function secretsIn(o, path, out = [], depth = 0, parentName = '') {
    if (!o || typeof o !== 'object' || depth > 8) return out;
    for (const k of Object.keys(o)) {
      const v = o[k], name = Array.isArray(o) ? parentName : k;
      if (isSecret(path, name, v)) out.push([o, k, name]); else if (v && typeof v === 'object') secretsIn(v, path, out, depth + 1, name);
    }
    return out;
  }
  function withoutSecrets(o, path, depth = 0, parentName = '') {
    if (Array.isArray(o)) return o.map((v) => withoutSecrets(v, path, depth + 1, parentName));
    if (!o || typeof o !== 'object' || depth > 10) return o;
    const out = {};
    for (const k of Object.keys(o)) { const v = o[k]; if ((isSecret(path, k, v) && !(k === 'snapshotUrl' && !/\/\/[^/?#]*@/.test(v))) || (typeof v === 'string' && v.indexOf('cts1.') === 0)) continue; out[k] = withoutSecrets(v, path, depth + 1, k); }   // a snapshot address is kept unless it has a login in it
    return out;
  }
  const headerList = (h) => { if (!h) return []; if (typeof Headers === 'function' && h instanceof Headers) { const o = []; h.forEach((v, k) => o.push([k, v])); return o; } return Array.isArray(h) ? h.map((x) => [x[0], x[1]]) : Object.keys(h).map((k) => [k, h[k]]); };

  /** Seals a whole JSON body (and the sealed headers) for a request to path; returns { body, headers }. */
  async function sealRequest(path, text, headers, fresh) {
    const k = await keyNow(fresh);
    let body = text, hs = headers;
    if (typeof text === 'string') {
      const obj = JSON.parse(text), jobs = secretsIn(obj, path);
      for (const [o, kk, name] of jobs) o[kk] = await sealOne(k, name, o[kk]);
      body = JSON.stringify(obj);
    }
    const list = headerList(headers);
    if (list.some(([n, v]) => HEADERS.includes(String(n).toLowerCase()) && v && !/^cts1\./.test(v))) {
      hs = {};
      for (const [n, v] of list) hs[n] = HEADERS.includes(String(n).toLowerCase()) && v && !/^cts1\./.test(v) ? await sealOne(k, String(n).toLowerCase(), v) : v;
    }
    return { body, headers: hs };
  }
  G.fetch = function sealedFetch(input, init) {
    let path = null, text = null, needs = false;
    try {
      const url = typeof input === 'string' ? input : (typeof URL === 'function' && input instanceof URL) ? input.href : null;
      if (url && init) {
        const u = new URL(url, G.location.href);
        if (u.origin === G.location.origin && u.pathname.indexOf('/api/') === 0 && String(init.method || 'GET').toUpperCase() !== 'GET') {
          path = u.pathname;
          if (typeof init.body === 'string' && /^\s*[{[]/.test(init.body)) { try { const o = JSON.parse(init.body); text = init.body; needs = secretsIn(o, path).length > 0; } catch (e) { text = null; } }
          if (headerList(init.headers).some(([n, v]) => HEADERS.includes(String(n).toLowerCase()) && v && !/^cts1\./.test(v))) needs = true;
          if (NOT_SENT.test(path) && text) return f0.call(G, input, Object.assign({}, init, { body: JSON.stringify(withoutSecrets(JSON.parse(text), path)) }));
        }
      }
    } catch (e) { path = null; needs = false; }
    if (!needs) return f0.apply(G, arguments);
    if (!can) { if (G.location.protocol === 'https:') return f0.apply(G, arguments); return Promise.reject(new Error(cant())); }   // https carries it safely; plain http never carries it readable
    return (async () => {
      for (let i = 0; ; i++) {
        let s;
        try { s = await sealRequest(path, text, init.headers, i > 0); } catch (e) { if (i === 0) continue; throw new TypeError('Failed to fetch'); }   // the key couldn't be had (CasaTorch unreachable): like any request that couldn't go
        const r = await f0.call(G, input, Object.assign({}, init, { body: text != null ? s.body : init.body, headers: s.headers }));
        if (i === 0 && r.status === 409 && r.headers && r.headers.get('X-CasaTorch-Seal') === 'retry') continue;   // the box restarted or the key of the day changed
        return r;
      }
    })();
  };
  G.CasaSeal = { ready: can, js: !subtle && !!JS, sealOne: async (field, v) => sealOne(await keyNow(), field, v), keyNow, _js: JS };
})(typeof window !== 'undefined' ? window : globalThis);
/* @sealed:end */
