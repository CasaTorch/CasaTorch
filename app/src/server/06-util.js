/* ======================================================================
 * Shared helpers for talking to outside services: one User-Agent (MET Norway
 * and Nominatim require a real one), timeouts, a small time-to-live cache,
 * and a tolerant XML reader for RSS/Atom.
 * ====================================================================== */
const UA = `CasaTorch/${VERSION} (+https://casatorch.com)`;
async function getText(url, { headers = {}, timeout = 12000, method = 'GET', body } = {}) {
  const r = await fetch(url, { method, body, headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeout) });
  // Never read an endless or huge answer into memory (a calendar or feed link pointing at something else).
  const max = 32 * 1024 * 1024, len = Number(r.headers.get('content-length') || 0);
  if (len > max) { r.body?.cancel?.(); throw Object.assign(new Error('that answer is too big'), { status: 413 }); }
  let t = '';
  if (r.body?.getReader) { const rd = r.body.getReader(), dec = new TextDecoder(); let n = 0; for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > max) { rd.cancel(); throw Object.assign(new Error('that answer is too big'), { status: 413 }); } t += dec.decode(value, { stream: true }); } t += dec.decode(); }
  else t = await r.text();
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, body: t.slice(0, 200) });
  return { text: t, headers: r.headers };
}
async function getJSON(url, opts) { const { text } = await getText(url, { ...opts, headers: { Accept: 'application/json', ...(opts?.headers || {}) } }); return JSON.parse(text); }

/** cached(key, ttlMs, fn): reuse a fresh answer; on failure, serve the last good one (marked stale). */
const CACHE = new Map(), INFLIGHT = new Map();
async function cached(key, ttl, fn) {
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  // Many screens asking at once (or a slow Home Assistant): one fetch, everyone waits for the same answer.
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async () => {
    try { const value = await fn(); CACHE.set(key, { at: Date.now(), value }); return value; }
    catch (err) { if (hit) return { ...hit.value, stale: true, error: String(err.message || err) }; throw err; }
    finally { INFLIGHT.delete(key); }
  })();
  INFLIGHT.set(key, p); return p;
}

/* RSS 2.0 and Atom, without a library: titles, links, dates. */
const decodeXml = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();
function xmlTag(block, tag) { const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')); return m ? decodeXml(m[1]) : null; }
function parseFeed(xml) {
  const title = xmlTag(xml.split(/<item[\s>]|<entry[\s>]/i)[0], 'title');
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    const link = xmlTag(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || null;
    const when = xmlTag(b, 'pubDate') || xmlTag(b, 'published') || xmlTag(b, 'updated') || xmlTag(b, 'dc:date');
    const t = when ? Date.parse(when) : NaN;
    items.push({ title: xmlTag(b, 'title'), link, at: Number.isFinite(t) ? new Date(t).toISOString() : null });
  }
  return { title, items: items.filter((i) => i.title) };
}
const tempOut = (c) => (config.house?.units === 'C' ? Math.round(c) : Math.round(c * 9 / 5 + 32));
const speedOut = (ms) => (config.house?.units === 'C' ? Math.round(ms * 3.6) : Math.round(ms * 2.237));

/* Demo mode answers from demo/fixtures/<name>.json (no outside calls, no real house). */
const demoFixture = (name) => { try { return JSON.parse(fs.readFileSync(path.join(APP_DIR, '..', 'demo', 'fixtures', `${name}.json`), 'utf8')); } catch { return null; } };
