/* ======================================================================
 * Frigate NVR, both ways it can be reached:
 *   - its open port (usually 5000): plain http, no sign-in - fine on a home network;
 *   - its secure port (usually 8971): https with Frigate's own certificate, and Frigate's sign-in.
 * Frigate makes its own certificate, which no browser or computer trusts. CasaTorch trusts it only after
 * you confirm its SHA-256 fingerprint in setup, and from then on only that exact certificate: if it
 * changes, CasaTorch stops and says so instead of sending your Frigate password to something else.
 * The Frigate password is kept sealed in config.json like every other password (AES-256-GCM).
 * ==================================================================== */

const frigateBase = (c) => String(c.url || '').trim().replace(/\/+$/, '');
const FRIGATE_TOKENS = new Map();   // base|user -> { cookie, at }

/** The certificate a https address shows, without trusting it: { pem, fingerprint, trusted, subject }. */
function peekCertificate(base) {
  const u = new URL(base);
  if (blockedUrl(u.href)) return Promise.reject(new TypeError('That address is not allowed.'));
  return new Promise((ok, fail) => {
    const s = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: /^[\d.:]+$/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, timeout: 8000 }, () => {
      const c = s.getPeerCertificate(true), raw = c?.raw;
      const out = raw ? { pem: `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`, fingerprint: c.fingerprint256, trusted: s.authorized, subject: c.subject?.CN || '' } : null;
      s.end(); out ? ok(out) : fail(new Error('it sent no certificate'));
    });
    s.on('timeout', () => s.destroy(new Error('timed out'))); s.on('error', fail);
  });
}

/** One request to Frigate. https to Frigate's own certificate is allowed only with the fingerprint pinned (c.fingerprint + c.ca). */
function frigateRequest(c, path, { method = 'GET', body, headers = {}, timeout = 10000, signal } = {}) {
  const u = new URL(frigateBase(c) + path);
  if (blockedUrl(u.href)) return Promise.reject(new TypeError('That address is not allowed.'));
  return new Promise((ok, fail) => {
    const opts = { method, headers: { Accept: '*/*', ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, timeout, signal };
    if (u.protocol === 'https:' && c.fingerprint && c.ca) {
      // Trust exactly that certificate: it is the only authority, the name on it is not checked (it's an address on
      // your network), and the fingerprint must match before anything - a password included - is sent.
      Object.assign(opts, { ca: c.ca, agent: false, checkServerIdentity: (_host, cert) => (cert?.fingerprint256 === c.fingerprint ? undefined : Object.assign(new Error('Frigate\'s security certificate changed - check it in Connect, then trust it again'), { code: 'CERT_CHANGED' })) });
    }
    const rq = (u.protocol === 'https:' ? https : http).request(u, opts, ok);
    rq.on('timeout', () => rq.destroy(new Error('timed out'))); rq.on('error', fail);
    rq.end(body ? JSON.stringify(body) : undefined);
  });
}
const readAll = async (r, max = 8 * 1024 * 1024) => { const parts = []; let n = 0; for await (const p of r) { n += p.length; if (n > max) { r.destroy(); throw new Error('the answer was too big'); } parts.push(p); } return Buffer.concat(parts); };

/** Frigate's sign-in (0.14 and newer, on its secure port): a token in a cookie, kept in memory and renewed when it runs out. */
async function frigateCookie(c, fresh = false) {
  if (!c.user) return null;
  const key = `${frigateBase(c)}|${c.user}`, hit = FRIGATE_TOKENS.get(key);
  if (hit && !fresh && Date.now() - hit.at < 6 * 3600_000) return hit.cookie;
  const r = await frigateRequest(c, '/api/login', { method: 'POST', body: { user: c.user, password: c.password || '' } });
  await readAll(r).catch(() => null);
  if (r.statusCode === 401 || r.statusCode === 400) throw Object.assign(new Error('Frigate turned down that username or password'), { status: 401 });
  if (r.statusCode >= 300) throw Object.assign(new Error(`Frigate's sign-in answered HTTP ${r.statusCode}`), { status: r.statusCode });
  const tok = [].concat(r.headers['set-cookie'] || []).map((x) => /^(frigate_token=[^;]+)/.exec(x)?.[1]).find(Boolean);
  if (!tok) throw new Error('Frigate signed in but sent no token');
  FRIGATE_TOKENS.set(key, { cookie: tok, at: Date.now() });
  return tok;
}
/** A signed-in request (signs in again once if the token ran out). */
async function frigateGet(c, path, opts = {}) {
  let cookie = await frigateCookie(c);
  let r = await frigateRequest(c, path, { ...opts, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) } });
  if (r.statusCode === 401 && c.user) { r.resume(); cookie = await frigateCookie(c, true); r = await frigateRequest(c, path, { ...opts, headers: { Cookie: cookie, ...(opts.headers || {}) } }); }
  return r;
}
async function frigateJson(c, path) {
  const r = await frigateGet(c, path), buf = await readAll(r);
  if (r.statusCode >= 300) throw Object.assign(new Error(`HTTP ${r.statusCode}`), { status: r.statusCode, text: buf.toString('utf8', 0, 300) });
  try { return JSON.parse(buf.toString('utf8')); } catch { return buf.toString('utf8').trim(); }
}
/** A camera's latest picture, as fetchImage returns it. */
async function frigateSnapshot(c) {
  const r = await frigateGet(c, `/api/${encodeURIComponent(c.camera)}/latest.jpg?h=720`);
  if (r.statusCode >= 300) { r.resume(); throw Object.assign(new Error(`Frigate answered HTTP ${r.statusCode}`), { status: r.statusCode }); }
  const buf = await readAll(r, 20 * 1024 * 1024);
  return { type: r.headers['content-type'] || 'image/jpeg', buf };
}
/** Live video for mjpegPass: Frigate's MJPEG stream, shaped like a fetch answer. */
async function frigateStream(c, signal, { h = 720, fps = 10 } = {}) {
  const r = await frigateGet(c, `/api/${encodeURIComponent(c.camera)}?h=${h}&fps=${fps}&bbox=0&timestamp=0&zones=0&mask=0&motion=0&regions=0`, { signal, timeout: 0 });
  return { ok: r.statusCode < 300, headers: { get: (k) => r.headers[String(k).toLowerCase()] || null }, body: r };
}

/** Setup's "Test connection": plain words for each way Frigate can go wrong, and what to do. */
async function frigateTest({ url, user, password, trust }) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(base)) throw new Error('the address should start with http:// or https://');
  const c = { url: base, user: String(user || '').trim() || null, password: password || '' };
  if (base.startsWith('https:')) {
    const cert = await peekCertificate(base);
    if (!cert.trusted) {
      if (trust !== cert.fingerprint) return { ok: false, needTrust: true, fingerprint: cert.fingerprint, subject: cert.subject, error: 'Frigate uses its own security certificate. If this is your Frigate, trust it - CasaTorch will then accept only this exact certificate.' };
      Object.assign(c, { fingerprint: cert.fingerprint, ca: cert.pem });
    }
  }
  let ver;
  try { ver = await frigateJson({ ...c, user: null }, '/api/version'); }
  catch (err) {
    if (err.status === 400 && /plain HTTP request was sent to HTTPS port|http request to an https server/i.test(err.text || '')) return { ok: false, error: 'That port is Frigate\'s secure port: change http:// to https:// (or use its open port, usually 5000).' };
    if (err.status !== 401) throw err;
    ver = null;
  }
  if (ver === null) {   // the secure port wants Frigate's sign-in
    if (!c.user) return { ok: false, needLogin: true, error: 'Frigate asks for a sign-in on this port. Enter your Frigate username and password below (or use its open port, usually 5000).' };
    try { ver = await frigateJson(c, '/api/version'); } catch (err) { if (err.status === 401) return { ok: false, needLogin: true, error: 'Frigate turned down that username or password.' }; throw err; }
  }
  const stats = await frigateJson(c.user ? c : { ...c, user: null }, '/api/stats').catch(() => null);
  const cams = stats?.cameras ? Object.keys(stats.cameras) : [];
  const v = typeof ver === 'string' && /^[\w.+-]{1,40}$/.test(ver) ? ver : '';
  return { ok: true, cameras: cams, fingerprint: c.fingerprint || null, ca: c.ca || null, message: `Frigate ${v}${cams.length ? ` with ${cams.length} camera${cams.length === 1 ? '' : 's'}: ${cams.join(', ')}` : ''}${c.fingerprint ? ' · certificate trusted' : ''}` };
}

/* ---- Detections: what Frigate saw (people, cars, animals, packages...), straight from Frigate's own event list ----
   Counts by kind and camera, by hour, and the latest events with their thumbnails. Nothing is guessed here: every
   number is a Frigate event, with Frigate's own confidence score. */
const frigateServers = () => { const seen = new Map(); for (const c of config.cameras || []) if (c.type === 'frigate' && c.url && !seen.has(frigateBase(c))) seen.set(frigateBase(c), c); return [...seen.values()]; };
const FR_ID = /^[\w.-]{1,80}$/;
app.get('/api/frigate/events', async (req, res) => {
  const servers = frigateServers();
  if (!servers.length) return res.json({ frigate: false });
  const hours = Math.min(24 * 14, Math.max(1, Number(req.query.hours) || 24)), after = Math.floor(Date.now() / 1000 - hours * 3600);
  const camera = FR_ID.test(String(req.query.camera || '')) ? String(req.query.camera) : null, label = FR_ID.test(String(req.query.label || '')) ? String(req.query.label) : null;
  const all = [], errors = [];
  await Promise.all(servers.map(async (c, si) => {
    try {
      const q = new URLSearchParams({ after: String(after), limit: '1000', include_thumbnails: '0', ...(camera ? { cameras: camera } : {}), ...(label ? { labels: label } : {}) });
      const list = await cached(`frigate-events:${frigateBase(c)}:${q}`, 20_000, () => frigateJson(c, `/api/events?${q}`));
      for (const e of Array.isArray(list) ? list : []) all.push({ ...e, _s: si });
    } catch (err) { errors.push(String(err.message || err)); }
  }));
  const tz = houseTz(), hourOf = (t) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t * 1000)));
  const byLabel = {}, byCamera = {}, byHour = Array(24).fill(0);
  for (const e of all) { byLabel[e.label] = (byLabel[e.label] || 0) + 1; byCamera[e.camera] = (byCamera[e.camera] || 0) + 1; byHour[hourOf(e.start_time)]++; }
  all.sort((a, b) => b.start_time - a.start_time);
  const recent = all.slice(0, 60).map((e) => ({
    id: `${e._s}:${e.id}`, camera: e.camera, label: e.label, subLabel: Array.isArray(e.sub_label) ? e.sub_label[0] : e.sub_label || null,
    score: Math.round(((e.data?.top_score ?? e.top_score ?? e.data?.score ?? e.score) || 0) * 100) || null,
    start: new Date(e.start_time * 1000).toISOString(), end: e.end_time ? new Date(e.end_time * 1000).toISOString() : null,
    zones: Array.isArray(e.zones) ? e.zones.slice(0, 6) : [], snapshot: !!e.has_snapshot, clip: !!e.has_clip,
  }));
  res.json({ frigate: true, hours, total: all.length, byLabel, byCamera, byHour, recent, errors, at: nowIso() });
});
/* An event's thumbnail or snapshot, through CasaTorch (Frigate's sign-in and certificate stay here). */
app.get('/api/frigate/events/:sid/:id/:kind(thumbnail|snapshot)', async (req, res) => {
  const c = frigateServers()[Number(req.params.sid)]; if (!c || !FR_ID.test(req.params.id)) return res.status(404).end();
  try {
    const r = await frigateGet(c, `/api/events/${encodeURIComponent(req.params.id)}/${req.params.kind}.jpg${req.params.kind === 'snapshot' ? '?bbox=1' : ''}`);
    if (r.statusCode >= 300) { r.resume(); return res.status(404).end(); }
    const buf = await readAll(r, 10 * 1024 * 1024);
    res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=86400'); res.end(buf);
  } catch { res.status(502).end(); }
});
