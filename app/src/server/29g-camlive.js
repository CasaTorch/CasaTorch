/* ======================================================================
 * Live video, real video: low latency and sharp, in every browser and in
 * the phone apps.
 *
 * Each camera gets a "plan": the ways it can play, best first. The page tries them in order and says
 * plainly when it falls back.
 *   1. MSE over a WebSocket (fragmented MP4, about half a second behind) from go2rtc - the restreamer
 *      built into Frigate 0.12 and newer. Browsers with MediaSource, and Safari / iPhone (iOS 17.1+)
 *      with ManagedMediaSource.
 *   2. HLS (fragmented MP4): go2rtc's own, or Home Assistant's camera stream for cameras only Home
 *      Assistant has. Plays natively on iPhone and Safari; elsewhere the page feeds it to MediaSource.
 *   3. MJPEG (the old way, still there for any camera that has nothing better).
 * Tiles get the camera's small stream (<cam>_sub and the like, or Frigate's detect stream), the full
 * view its main one (Frigate's record stream).
 *
 * Everything goes through CasaTorch, on the page's own address: the same sign-in, the same Secure access,
 * and Frigate's or Home Assistant's own sign-in stays on this box. Only the configured Frigate or Home
 * Assistant, and only go2rtc's fixed paths (stream.m3u8, hls/..., the MSE socket), can be reached - the
 * page never names an address or a path of its own.
 * ====================================================================== */
const CL_DEV = /^[\w:.-]{1,160}$/;
const CL_SUB = /(?:^|[_-])(?:sub|substream|lq|low|lo|small|sd|mobile|ext|preview|detect)$/i;
const CL_MAIN = /(?:^|[_-])(?:main|mainstream|hq|high|hd|record)$/i;
/** Which go2rtc streams a Frigate camera has: { main, sub } (sub may be main), or null when go2rtc has none for it.
    `names`: go2rtc's stream names; `cfg`: the camera's block from Frigate's /api/config. */
function pickStreams(cam, names, cfg = {}) {
  const have = new Set((names || []).filter((n) => typeof n === 'string'));
  if (!have.size) return null;
  const listed = [];
  const live = cfg?.live || {};
  if (live.streams && typeof live.streams === 'object') for (const v of Object.values(live.streams)) if (typeof v === 'string') listed.push(v);   // Frigate 0.15+: { "Main": "cam", "Sub": "cam_sub" }
  if (typeof live.stream_name === 'string') listed.push(live.stream_name);                                                                 // Frigate 0.13 - 0.14
  // The restream paths Frigate itself reads (rtsp://127.0.0.1:8554/<name>): the record input is the main stream, a detect-only input the small one.
  let roleMain = null, roleSub = null;
  for (const inp of Array.isArray(cfg?.ffmpeg?.inputs) ? cfg.ffmpeg.inputs : []) {
    const n = /:8554\/([^/?#\s]+)/.exec(String(inp?.path || ''))?.[1], roles = Array.isArray(inp?.roles) ? inp.roles : [];
    if (!n || !have.has(n)) continue;
    if (roles.includes('record') && !roleMain) roleMain = n;
    else if (roles.includes('detect') && !roles.includes('record') && !roleSub) roleSub = n;
  }
  const family = [...have].filter((n) => n === cam || n.startsWith(`${cam}_`) || n.startsWith(`${cam}-`)).sort((a, b) => a.length - b.length);
  const pool = [...new Set([...listed.filter((n) => have.has(n)), roleMain, roleSub, ...family].filter(Boolean))];
  if (!pool.length) return null;
  const tail = (n) => (n.startsWith(cam) ? n.slice(cam.length) : n);
  const main = roleMain || pool.find((n) => CL_MAIN.test(tail(n))) || pool.find((n) => n === roleSub ? false : !CL_SUB.test(tail(n))) || pool[0];
  const sub = roleSub || pool.find((n) => n !== main && CL_SUB.test(tail(n))) || main;
  return { main, sub };
}
/** Frigate's go2rtc streams for a camera (asked once a minute). */
async function frigateStreams(c) {
  return cached(`go2rtc:${frigateBase(c)}|${c.camera}`, 60_000, async () => {
    const names = await frigateJson(c, '/api/go2rtc/streams').then((x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x) : [])).catch(() => []);
    if (!names.length) return { pick: null };
    const conf = await frigateJson(c, '/api/config').catch(() => null);
    return { pick: pickStreams(c.camera, names, conf?.cameras?.[c.camera] || {}) };
  }).then((x) => x?.pick || null);
}

/* ---- Home Assistant's own stream (HLS) for cameras only Home Assistant has ----
   HA hands out a stream address with its own short-lived token; that token stays here and the page only sees
   /api/camlive/ha:<entity>/hls/<file>. */
const HA_HLS = new Map();   // entity -> { token, at }
async function haHlsStart(ent) {
  const hit = HA_HLS.get(ent);
  if (hit && Date.now() - hit.at < 60_000) return hit.token;
  const r = await haWs({ type: 'camera/stream', entity_id: ent, format: 'hls' }, 12000);
  const token = /^\/api\/hls\/([\w-]{8,200})\/master_playlist\.m3u8/.exec(String(r?.url || ''))?.[1];
  if (!token) throw new Error('Home Assistant did not start a stream');
  if (HA_HLS.size > 200) HA_HLS.clear();
  HA_HLS.set(ent, { token, at: Date.now() });
  return token;
}

/* ---- Which files the page may ask for: fixed names only, with only the query keys each server uses ---- */
const GO2RTC_FILE = /^(stream\.m3u8|hls\/playlist\.m3u8|hls\/init\.mp4|hls\/segment\.(?:ts|m4s))$/;
const HA_FILE = /^(master_playlist\.m3u8|playlist\.m3u8|init\.mp4|segment\/\d{1,10}(?:\.\d{1,5})?\.m4s|part\/\d{1,10}\.\d{1,5}\.m4s)$/;
/** The upstream path and query for a page's HLS request, or null when it isn't one of go2rtc's or Home Assistant's own files. */
function hlsUpstream(kind, file, query = {}, { src, token } = {}) {
  const q = new URLSearchParams();
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]);
  if (kind === 'go2rtc') {
    if (!GO2RTC_FILE.test(file) || !src) return null;
    if (file === 'stream.m3u8') { q.set('src', src); q.set('mp4', ''); return `/api/go2rtc/api/stream.m3u8?${q.toString().replace(/mp4=$/, 'mp4')}`; }
    const id = one('id'), n = one('n');
    if (!/^[\w-]{1,64}$/.test(String(id || ''))) return null;
    q.set('id', id); if (n != null) { if (!/^\d{1,9}$/.test(String(n))) return null; q.set('n', n); }
    return `/api/go2rtc/api/${file}?${q}`;
  }
  if (kind === 'ha') {
    if (!HA_FILE.test(file) || !/^[\w-]{8,200}$/.test(String(token || ''))) return null;
    for (const k of ['_HLS_msn', '_HLS_part']) { const v = one(k); if (v != null) { if (!/^\d{1,9}$/.test(String(v))) return null; q.set(k, v); } }
    const skip = one('_HLS_skip'); if (skip != null) { if (!/^(YES|v2)$/.test(String(skip))) return null; q.set('_HLS_skip', skip); }
    return `/api/hls/${token}/${file}${q.size ? `?${q}` : ''}`;
  }
  return null;
}
const HLS_TYPES = /^(application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl|video\/(mp4|mp2t|iso\.segment)|audio\/mp4|application\/octet-stream)\b/i;

/** What a device id means here: a Frigate camera, a Home Assistant camera, or an integration's camera. */
async function camSource(dev) {
  if (!CL_DEV.test(dev)) return null;
  if (dev.startsWith('camera:')) {
    const c = (config.cameras || []).find((x) => `camera:${x.id}` === dev);
    return c ? { kind: c.type === 'frigate' ? 'frigate' : 'camera', c } : null;
  }
  if (dev.startsWith('ha:camera.')) {
    const ent = dev.slice(3), h = config.homeAssistant;
    if (!h?.url || !/^camera\.\w{1,120}$/.test(ent)) return null;
    const st = (await haStates().catch(() => [])).find((x) => x.entity_id === ent);
    return st ? { kind: 'ha', ent, stream: !!((Number(st.attributes?.supported_features) || 0) & 2) } : null;
  }
  const [integ, ...rest] = dev.split(':'), id = rest.join(':'), def = INTEGRATIONS.get(integ);
  if (!def?.camera || !id || (def.pro && !proStatus().pro)) return null;
  if (def.camera.known && !(await def.camera.known(id).catch(() => false))) return null;
  return { kind: 'integration', def, id };
}

/** The plan: the ways this camera can play, best first. */
async function camPlan(dev, role = 'full') {
  const src = await camSource(dev); if (!src) return null;
  const enc = encodeURIComponent(dev), ways = [];
  const mjpegH = role === 'tile' ? 480 : 1080, mjpegFps = role === 'tile' ? 8 : 12;
  let why = null;
  if (src.kind === 'frigate') {
    const pick = await frigateStreams(src.c).catch(() => null);
    if (pick) {
      const s = role === 'tile' ? 'sub' : 'main';
      ways.push({ kind: 'mse', url: `/api/camlive/${enc}/mse?s=${s}` }, { kind: 'hls', url: `/api/camlive/${enc}/hls/stream.m3u8?s=${s}` });
    } else why = 'nogo2rtc';
    ways.push({ kind: 'mjpeg', url: `/api/cameras/${encodeURIComponent(src.c.id)}/live?h=${mjpegH}&fps=${mjpegFps}` });
  } else if (src.kind === 'ha') {
    if (src.stream && role !== 'tile') ways.push({ kind: 'hls', url: `/api/camlive/${enc}/hls/master_playlist.m3u8` });
    else if (!src.stream) why = 'nostream';
    if (role !== 'tile') ways.push({ kind: 'mjpeg', url: `/api/ha/camera/${encodeURIComponent(src.ent)}/live` });
  } else if (src.kind === 'integration' && src.def.camera.live && role !== 'tile') ways.push({ kind: 'mjpeg', url: `/api/cam/${src.def.id}/${encodeURIComponent(src.id)}/live` });
  if (!ways.length) why = 'pictures';
  return { ways, why };
}
app.get('/api/camlive/:dev/plan', async (req, res) => {
  if (isDemo()) return res.json({ ways: [], why: 'demo' });
  try {
    const p = await camPlan(String(req.params.dev), req.query.for === 'tile' ? 'tile' : 'full');
    return p ? res.json(p) : res.status(404).json({ error: 'no such camera' });
  } catch { return res.json({ ways: [], why: 'error' }); }
});

/* HLS through CasaTorch: go2rtc's (Frigate) or Home Assistant's, one fixed file at a time. */
app.get(/^\/api\/camlive\/([^/]+)\/hls\/(.+)$/, async (req, res) => {
  const dev = String(req.params[0]), file = String(req.params[1]);   // (Express has decoded them)
  const src = await camSource(dev).catch(() => null); if (!src) return res.status(404).end();
  try {
    if (src.kind === 'frigate') {
      const pick = await frigateStreams(src.c); if (!pick) return res.status(404).end();
      const p = hlsUpstream('go2rtc', file, req.query, { src: req.query.s === 'sub' ? pick.sub : pick.main }); if (!p) return res.status(404).end();
      const ac = new AbortController(); res.on('close', () => ac.abort());
      const r = await frigateGet(src.c, p, { signal: ac.signal, timeout: 20000 });
      return hlsPass(r.statusCode, r.headers['content-type'], r, res);
    }
    if (src.kind === 'ha' && src.stream) {
      const h = config.homeAssistant;
      let token = HA_HLS.get(src.ent)?.token || await haHlsStart(src.ent);
      if (/^master_playlist/.test(file)) token = await haHlsStart(src.ent);   // the start of a viewing: make sure HA's stream is running
      const p = hlsUpstream('ha', file, req.query, { token }); if (!p) return res.status(404).end();
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000); res.on('close', () => { clearTimeout(t); ac.abort(); });
      const r = await fetch(`${h.url}${p}`, { headers: { Authorization: `Bearer ${h.token}` }, signal: ac.signal });
      if (r.status === 404) HA_HLS.delete(src.ent);   // the stream ended: the next master playlist starts it again
      return hlsPass(r.status, r.headers.get('content-type'), r.body, res);
    }
    return res.status(404).end();
  } catch { if (!res.headersSent) res.status(502).end(); else res.end(); }
});
async function hlsPass(status, type, body, res) {
  if (status >= 300 || !HLS_TYPES.test(String(type || ''))) { try { body?.resume?.(); await body?.cancel?.(); } catch { /* gone */ } return res.status(status === 404 ? 404 : 502).end(); }
  res.setHeader('Content-Type', String(type).split(';')[0]);
  for await (const chunk of body) if (res.destroyed) break; else if (!res.write(chunk)) await new Promise((ok) => { res.once('drain', ok); res.once('close', ok); });
  res.end();
}

/* ---- MSE over a WebSocket: the page's socket is joined, byte for byte, to go2rtc's (through Frigate) ----
   The upgrade runs through every check a normal request does (address, Secure access, sign-in) by handing it to
   the app; only /api/camlive/<camera>/mse ever becomes a tunnel. And only from CasaTorch's own pages: the Origin
   must be this address (a page on another site can't open it with your cookies). */
const CL_TUNNELS = new Map();   // camera -> open tunnels
function camUpgrade(req, socket, head) {
  socket.on('error', () => socket.destroy());
  const res = new http.ServerResponse(req);
  res.assignSocket(socket); res.shouldKeepAlive = false;
  res.on('finish', () => { if (!req.camTunnel) socket.end(); });
  req.camSocket = socket; req.camHead = head;
  app.handle(req, res, () => { if (!res.headersSent) { res.statusCode = 404; res.end(); } });
}
// Every server CasaTorch listens with takes the upgrade (this one; the secure address at home in 43-local-https.js).
const appListen = app.listen.bind(app);
app.listen = (...a) => { const s = appListen(...a); s.on('upgrade', camUpgrade); return s; };
app.get('/api/camlive/:dev/mse', async (req, res) => {
  const socket = req.camSocket;
  if (!socket) return res.status(426).json({ error: 'this address is for live video' });
  const origin = req.headers.origin;
  let same = false; try { same = !!origin && new URL(origin).host === req.headers.host; } catch { same = false; }
  if (!same) return res.status(403).json({ error: 'refused' });
  if (!/^[A-Za-z0-9+/]{22}==$/.test(String(req.headers['sec-websocket-key'] || ''))) return res.status(400).end();
  const dev = String(req.params.dev), src = await camSource(dev).catch(() => null);
  if (!src || src.kind !== 'frigate') return res.status(404).end();
  const pick = await frigateStreams(src.c).catch(() => null); if (!pick) return res.status(404).end();
  const n = CL_TUNNELS.get(dev) || 0;
  if (n >= 8 || [...CL_TUNNELS.values()].reduce((a, b) => a + b, 0) >= 48) return res.status(429).json({ error: 'too many screens are watching live' });
  req.camTunnel = true;
  CL_TUNNELS.set(dev, n + 1);
  let counted = true; const uncount = () => { if (counted) { counted = false; CL_TUNNELS.set(dev, Math.max(0, (CL_TUNNELS.get(dev) || 1) - 1)); } };
  socket.on('close', uncount);
  try { await go2rtcTunnel(src.c, req.query.s === 'sub' ? pick.sub : pick.main, req, socket); }
  catch { uncount(); if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); }
});
/** Open go2rtc's MSE socket (Frigate's /live/mse/api/ws) and join it to the page's. Frigate's sign-in and pinned certificate apply. */
async function go2rtcTunnel(c, stream, req, socket, retried = false) {
  const base = new URL(frigateBase(c));
  if (blockedUrl(base.href)) throw new TypeError('That address is not allowed.');
  const cookie = await frigateCookie(c, retried).catch(() => null);
  const port = Number(base.port) || (base.protocol === 'https:' ? 443 : 80);
  const up = await new Promise((ok, fail) => {
    const done = () => { s.setTimeout(0); ok(s); };
    const s = base.protocol === 'https:'
      ? tls.connect({ host: base.hostname, port, servername: /^[\d.:]+$/.test(base.hostname) ? undefined : base.hostname,
        ...(c.fingerprint && c.ca ? { ca: c.ca, checkServerIdentity: (_h, cert) => (cert?.fingerprint256 === c.fingerprint ? undefined : new Error('Frigate\'s security certificate changed')) } : {}) }, done)
      : net.connect({ host: base.hostname, port }, done);
    s.setTimeout(8000, () => s.destroy(new Error('timed out'))); s.once('error', fail);
  });
  const path = `/live/mse/api/ws?src=${encodeURIComponent(stream)}`;
  up.write(`GET ${path} HTTP/1.1\r\nHost: ${base.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${req.headers['sec-websocket-key']}\r\n${cookie ? `Cookie: ${cookie}\r\n` : ''}User-Agent: CasaTorch\r\n\r\n`);
  // Frigate's answer to the handshake: 101 and the accept for the page's own key (same key, so it is the page's answer too).
  const { status, accept, rest } = await new Promise((ok, fail) => {
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => { cleanup(); up.destroy(); fail(new Error('go2rtc did not answer')); }, 8000);
    const cleanup = () => { clearTimeout(t); up.off('data', onData); up.off('error', onErr); up.off('close', onErr); };
    const onErr = () => { cleanup(); fail(new Error('go2rtc closed')); };
    const onData = (d) => {
      buf = Buffer.concat([buf, d]); if (buf.length > 16384) return onErr();
      const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
      cleanup(); up.pause();
      const head = buf.subarray(0, i).toString('latin1');
      ok({ status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] || 0), accept: /\r\nsec-websocket-accept:\s*([A-Za-z0-9+/=]{20,40})\s*(\r\n|$)/i.exec(head)?.[1], rest: buf.subarray(i + 4) });
    };
    up.on('data', onData); up.once('error', onErr); up.once('close', onErr);
  });
  if (status === 401 && c.user && !retried) { up.destroy(); return go2rtcTunnel(c, stream, req, socket, true); }
  if (status !== 101 || !accept) { up.destroy(); throw new Error(`go2rtc answered ${status}`); }
  if (socket.destroyed) { up.destroy(); return; }
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  if (rest.length) socket.write(rest);
  if (req.camHead?.length) up.write(req.camHead);
  socket.setNoDelay?.(true); up.setNoDelay?.(true);
  const end = () => { socket.destroy(); up.destroy(); };
  up.on('error', end); up.on('close', end); socket.on('error', end); socket.on('close', end);
  up.pipe(socket); socket.pipe(up); up.resume();
}

if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchCamLive = { pickStreams, hlsUpstream, camPlan, camSource, camUpgrade, HA_HLS, CL_TUNNELS, cfg: () => config };
