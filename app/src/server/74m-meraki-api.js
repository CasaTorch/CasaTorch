/* ======================================================================
 * The Meraki Dashboard API, asked politely (used by 74-network.js, 74n-net-model.js and 76-meraki-mv-mt.js).
 *
 *  - Read-only: GETs, plus the one camera-picture request (POST generateSnapshot) that Meraki itself needs.
 *  - Rate: at most MK_RATE requests a second for each organization (Meraki allows 10 - half is left for
 *    anything else using the same key). Calls queue and start evenly spaced.
 *  - 429 Too Many Requests: the whole organization waits as long as Retry-After says, then the call is tried
 *    again (up to MK_TRIES times). A 5xx or a dropped connection is tried again after a short, growing pause.
 *  - Pages: followed through the Link header (rel=next) - only to the same Meraki address the key goes to.
 *  - Caching: every answer is kept for its own time (statuses 2 minutes, topology 30, licenses hours), so the
 *    page, the 3D home and the alerts asking at once cost one call; when Meraki can't be reached, the last
 *    answer is used.
 *  - The key is unsealed by the caller at the moment of the call, sent only in the Authorization header to
 *    the Meraki address, and never logged or sent to the browser.
 * ====================================================================== */
const MK_RATE = 5, MK_TRIES = 4, MK_CACHE_MAX = 600;
const mkLanes = new Map();   // organization (or 'key:<source>') -> { next } - when the next call may start
const mkCache = new Map();   // source|url|pages -> { at, ttl, value }
const mkSleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const mkBase = (s) => process.env.CASATORCH_MERAKI_BASE || MERAKI_BASES[s?.region] || MERAKI_BASES.us;
/* Wait for this lane's next slot: calls start 1/rate seconds apart. */
async function mkWait(lane, rate = MK_RATE) {
  const st = mkLanes.get(lane) || { next: 0 }; mkLanes.set(lane, st);
  const now = Date.now(), at = Math.max(now, st.next);
  st.next = at + 1000 / Math.max(0.5, rate);
  if (at > now) await mkSleep(at - now);
}
/* 429: nobody on this lane starts again before Retry-After has passed. */
const mkPause = (lane, ms) => { const st = mkLanes.get(lane) || { next: 0 }; st.next = Math.max(st.next, Date.now() + ms); mkLanes.set(lane, st); };
/* Retry-After is seconds (or an HTTP date); missing or odd: 1, 2, 4... seconds. At most a minute. */
function mkRetryAfter(v, attempt) {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.min(60_000, Math.max(200, n * 1000));
  const d = Date.parse(String(v || '')); if (Number.isFinite(d)) return Math.min(60_000, Math.max(200, d - Date.now()));
  return Math.min(60_000, 1000 * 2 ** attempt);
}
/* Link: <https://api.meraki.com/api/v1/...&startingAfter=X>; rel=next, <...>; rel=first - the next page, only
   when it is on the same Meraki address (and API path) as the base: a key is never sent anywhere else. */
function mkNext(link, base) {
  for (const part of String(link || '').split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i); if (!m) continue;
    try {
      const u = new URL(m[1]), b = new URL(base);
      if (u.origin === b.origin && u.pathname.startsWith(b.pathname.replace(/\/+$/, '') + '/')) return u.toString();
    } catch { /* not an address */ }
    return null;
  }
  return null;
}
/* One request: { status, headers, json }. Meraki has a real certificate; nothing self-signed is accepted here. */
function mkRaw(url, { method = 'GET', headers = {}, body, timeout = 20_000 } = {}) {
  return new Promise((ok, bad) => {
    let u; try { u = new URL(url); } catch { return bad(new Error('that address isn\'t valid')); }
    if (blockedUrl(u) || !/^https?:$/.test(u.protocol)) return bad(new Error('That address is not allowed.'));
    const mod = u.protocol === 'https:' ? https : http, data = body == null ? null : JSON.stringify(body);
    const r = mod.request(u, { method, timeout, headers: { 'User-Agent': UA, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > 16 * 1024 * 1024) { r.destroy(); bad(new Error('the answer was too big')); } else chunks.push(c); });
      res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ } ok({ status: res.statusCode, headers: res.headers, json: j }); });
      res.on('error', (e) => bad(e));
    });
    r.on('timeout', () => { r.destroy(); bad(Object.assign(new Error('Meraki didn\'t answer in 20 seconds'), { retry: true })); });
    r.on('error', (e) => bad(Object.assign(new Error(e.code === 'ENOTFOUND' ? 'Meraki\'s address wasn\'t found - is the internet up?' : String(e.message || e.code).slice(0, 80)), { retry: true })));
    if (data) r.write(data); r.end();
  });
}
/* A call with the waiting, the 429s and the retries. Returns the raw answer for any status below 500 (and 404/400). */
async function mkTry(url, secret, lane, { method = 'GET', body, rate } = {}) {
  let last = null;
  for (let attempt = 0; attempt < MK_TRIES; attempt++) {
    await mkWait(lane, rate);
    let r;
    try { r = await mkRaw(url, { method, body, headers: { Authorization: `Bearer ${secret || ''}` } }); }
    catch (e) { last = e; if (!e.retry || attempt >= 2) throw e; await mkSleep(600 * 2 ** attempt); continue; }
    if (r.status === 429) { last = new Error('Meraki asked CasaTorch to slow down'); mkPause(lane, mkRetryAfter(r.headers['retry-after'], attempt)); continue; }
    if (r.status >= 500) { last = new Error(`Meraki answered ${r.status}`); if (attempt >= 2) break; await mkSleep(800 * 2 ** attempt); continue; }
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('the key was refused'), { status: r.status });
    return r;
  }
  throw last || new Error('Meraki didn\'t answer');
}
/** mkGet(source, secret, path, { ttl, pages, lane, optional }): the answer (arrays from every page joined), from
 *  the cache when fresh. optional: a 400/404 (that product or feature isn't in this organization) gives null
 *  instead of an error. On a failure the last answer is used when there is one. */
async function mkGet(s, secret, p, { ttl = 60_000, pages = 1, lane, optional = false, rate } = {}) {
  const base = mkBase(s), url0 = `${base}${p}`, key = `${s?.id || '-'}|${url0}|${pages}`, hit = mkCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const ln = lane || `key:${s?.id || '-'}`;
  try {
    let url = url0, n = 0, out = null;
    while (url && n < pages) {
      const r = await mkTry(url, secret, ln, { rate });
      if (r.status === 404 || r.status === 400) { if (optional) { out = null; break; } throw Object.assign(new Error(`Meraki answered ${r.status}`), { status: r.status }); }
      if (r.status >= 400) throw Object.assign(new Error(`Meraki answered ${r.status}`), { status: r.status });
      if (r.json == null) throw new Error('Meraki answered, but not with data CasaTorch understands');
      out = Array.isArray(r.json) ? [...(out || []), ...r.json] : r.json;
      if (!Array.isArray(r.json)) break;
      url = mkNext(r.headers.link, base); n++;
    }
    mkCache.delete(key); mkCache.set(key, { at: Date.now(), ttl, value: out });
    while (mkCache.size > MK_CACHE_MAX) mkCache.delete(mkCache.keys().next().value);
    return out;
  } catch (e) {
    if (hit && e.status !== 401 && e.status !== 403) return hit.value;
    throw e;
  }
}
/* The camera picture (76-meraki-mv-mt.js): a POST, on the organization's lane, never cached. */
async function mkPost(s, secret, p, body, lane) {
  const r = await mkTry(`${mkBase(s)}${p}`, secret, lane || `key:${s?.id || '-'}`, { method: 'POST', body: body || {} });
  if (r.status >= 400) throw new Error(`Meraki answered ${r.status}`);
  return r.json;
}
/* A source removed or its key changed: forget what was kept for it. */
const mkForget = (id) => { for (const k of [...mkCache.keys()]) if (k.startsWith(`${id}|`)) mkCache.delete(k); };
