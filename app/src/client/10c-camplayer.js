/* ======================================================================
 * Live camera video in the page (the server side is 29g-camlive.js).
 *
 * The server says which ways a camera can play, best first ("the plan"); this tries them in order and keeps
 * the first that really plays (the picture has to move, not just connect):
 *   mse   - fragmented MP4 over a WebSocket (go2rtc in Frigate), into MediaSource - or ManagedMediaSource on
 *           iPhone / iPad (iOS 17.1+) and Safari. About half a second behind.
 *   hls   - native <video> on iPhone and Safari; elsewhere the fragmented-MP4 playlist is fed to MediaSource here.
 *   mjpeg - a moving picture in an <img>, for cameras that have nothing better.
 * A way that doesn't start in time, or stalls, moves on to the next; the caller is told why, so the page can
 * say it in plain words. Everything stays inline and muted on a phone (no full-screen player taking over).
 * ====================================================================== */
Object.assign(ICONS, {
  vol: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
});
const CL_MS = window.ManagedMediaSource || window.MediaSource || null;
const CL_CODECS = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'avc1.4D401F', 'avc1.42E01E', 'hvc1.1.6.L153.B0', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'opus'];
const clSupported = (c) => { try { return !!CL_MS?.isTypeSupported(`video/mp4; codecs="${c}"`); } catch { return false; } };
const clNativeHls = (() => { try { return !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'); } catch { return false; } })();
/** Which of the plan's ways this browser can play, in the plan's order. Pure, so it can be tested. */
function camWays(plan, env = { ms: !!CL_MS, ws: typeof WebSocket === 'function', nativeHls: clNativeHls }) {
  return (plan?.ways || []).filter((w) => (w.kind === 'mse' ? env.ms && env.ws : w.kind === 'hls' ? env.nativeHls || env.ms : w.kind === 'mjpeg'));
}
const CL_PLANS = new Map();
async function camPlanOf(d, role) {
  const k = `${d.id}|${role}`, hit = CL_PLANS.get(k);
  if (hit && Date.now() - hit.at < 30_000) return hit.plan;
  let plan;
  try { const r = await fetch(`/api/camlive/${encodeURIComponent(d.id)}/plan?for=${role}`, { cache: 'no-store' }); plan = r.ok ? await r.json() : null; } catch { plan = null; }
  if (!plan) plan = { ways: d.stream && role !== 'tile' ? [{ kind: 'mjpeg', url: d.stream }] : [], why: 'error' };   // an older CasaTorch, or no answer: the old way
  CL_PLANS.set(k, { at: Date.now(), plan });
  return plan;
}
const clWsUrl = (u) => { const x = new URL(u, location.href); x.protocol = x.protocol === 'https:' ? 'wss:' : 'ws:'; return x.href; };

/* MSE over a WebSocket, go2rtc's way: ask for the codecs this browser plays, get the MIME type back, then MP4 fragments. */
function clMse(video, url, info) {
  const ms = new CL_MS(), managed = !!window.ManagedMediaSource && CL_MS === window.ManagedMediaSource;
  let ws = null, sb = null, queue = [], closed = false;
  const pump = () => {
    if (closed || !sb || sb.updating) return;
    if (queue.length) {
      const n = queue.reduce((a, b) => a + b.byteLength, 0), buf = new Uint8Array(n); let o = 0;
      for (const b of queue) { buf.set(new Uint8Array(b), o); o += b.byteLength; }
      queue = [];
      try { sb.appendBuffer(buf); } catch (e) { if (e.name === 'QuotaExceededError' && sb.buffered.length) { try { sb.remove(sb.buffered.start(0), Math.max(sb.buffered.start(0) + 1, video.currentTime - 2)); } catch { /* next time */ } } }
      return;
    }
    if (sb.buffered.length) {   // keep about 10 s: a wall panel can watch for days
      const s = sb.buffered.start(0), e = sb.buffered.end(sb.buffered.length - 1);
      if (e - s > 20 && video.currentTime - s > 12) { try { sb.remove(s, video.currentTime - 8); } catch { /* next time */ } }
    }
  };
  ms.addEventListener('sourceopen', () => {
    if (closed) return;
    try { ws = new WebSocket(clWsUrl(url)); } catch { info.fail('ws'); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(JSON.stringify({ type: 'mse', value: CL_CODECS.filter(clSupported).join(',') }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') { queue.push(ev.data); pump(); return; }
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'mse' && !sb) {
        try { sb = ms.addSourceBuffer(m.value); sb.mode = 'segments'; sb.addEventListener('updateend', pump); info.audio = /mp4a|opus|flac|alaw|mulaw|pcm/i.test(m.value); pump(); }
        catch { info.fail('codec'); }
      } else if (m.type === 'error') info.fail('source');
    };
    ws.onclose = () => { if (!closed) info.fail('closed'); };
  }, { once: true });
  if (managed) { video.disableRemotePlayback = true; video.srcObject = ms; }   // ManagedMediaSource plays only with AirPlay off (or an AirPlay alternative)
  else video.src = URL.createObjectURL(ms);
  return () => { closed = true; try { ws?.close(); } catch { /* closed */ } if (!managed && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src); };
}

/* HLS for browsers that don't play it natively: the fragmented-MP4 playlist, fed to MediaSource here (go2rtc's and Home Assistant's are both fMP4). */
function clHlsMse(video, url, info) {
  const ms = new CL_MS(), managed = !!window.ManagedMediaSource && CL_MS === window.ManagedMediaSource;
  let closed = false, sb = null, last = -1, timer = null;
  const get = async (u, bin) => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); return bin ? r.arrayBuffer() : r.text(); };
  const append = (buf) => new Promise((ok, no) => { if (closed) return ok(); const done = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', no); ok(); }; sb.addEventListener('updateend', done); sb.addEventListener('error', no); try { sb.appendBuffer(buf); } catch (e) { no(e); } });
  const run = async () => {
    try {
      let pl = new URL(url, location.href), text = await get(pl), codecs = null;
      if (/#EXT-X-STREAM-INF/.test(text)) {
        codecs = /CODECS="([^"]+)"/.exec(text)?.[1] || null;
        const line = text.split('\n').map((x) => x.trim()).find((x) => x && !x.startsWith('#'));
        pl = new URL(line, pl); text = await get(pl);
      }
      for (;;) {
        if (closed) return;
        const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(text)?.[1];
        if (!map) { info.fail('format'); return; }
        const seq = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1] || 0), target = Number(/#EXT-X-TARGETDURATION:(\d+)/.exec(text)?.[1] || 2);
        const segs = []; const lines = text.split('\n').map((x) => x.trim());
        for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('#EXTINF')) { const u = lines.slice(i + 1).find((x) => x && !x.startsWith('#')); if (u) segs.push(u); }
        if (!sb) {
          const mime = `video/mp4; codecs="${codecs || 'avc1.640029'}"`;
          if (!CL_MS.isTypeSupported(mime)) { info.fail('codec'); return; }
          sb = ms.addSourceBuffer(mime); info.audio = /mp4a|opus|flac/i.test(codecs || '');
          await append(await get(new URL(map, pl), true));
          last = seq + Math.max(0, segs.length - 2) - 1;   // start near the live edge
        }
        for (let i = 0; i < segs.length; i++) { const n = seq + i; if (n <= last) continue; await append(await get(new URL(segs[i], pl), true)); last = n; }
        if (sb.buffered.length && !sb.updating) { const s = sb.buffered.start(0); if (video.currentTime - s > 30) { try { sb.remove(s, video.currentTime - 10); } catch { /* next time */ } } }
        if (/#EXT-X-ENDLIST/.test(text)) return;
        await new Promise((ok) => { timer = setTimeout(ok, Math.max(500, target * 500)); });
        text = await get(pl);
      }
    } catch { if (!closed) info.fail('hls'); }
  };
  ms.addEventListener('sourceopen', run, { once: true });
  if (managed) { video.disableRemotePlayback = true; video.srcObject = ms; } else video.src = URL.createObjectURL(ms);
  return () => { closed = true; clearTimeout(timer); if (!managed && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src); };
}

/**
 * Play a camera: camPlay(d, { role: 'tile'|'full', video, img, onState }) -> { stop() }.
 * onState({ state: 'trying'|'playing'|'none', kind, why, audio, latency }) is called as it goes. `img` shows MJPEG.
 */
function camPlay(d, { role = 'full', video, img, onState = () => {} }) {
  let stopped = false, undo = null, watch = null, ways = [], idx = -1, why = null;
  const st = { audio: false };
  for (const [k, v] of [['muted', ''], ['playsinline', ''], ['webkit-playsinline', ''], ['autoplay', ''], ['disablepictureinpicture', '']]) video.setAttribute(k, v);
  video.muted = true; video.playsInline = true; video.controls = false;
  const clear = () => {
    clearInterval(watch); watch = null; video.onerror = null;
    try { undo?.(); } catch { /* gone */ } undo = null;
    try { video.pause(); } catch { /* gone */ }
    video.removeAttribute('src'); video.srcObject = null; try { video.load(); } catch { /* gone */ }
    if (img) { img.onload = img.onerror = null; img.removeAttribute('src'); }
  };
  const next = (reason) => {
    if (stopped) return;
    if (reason && idx >= 0) why = why || reason;
    clear(); idx++;
    const w = ways[idx];
    if (!w) { onState({ state: 'none', why: why || 'none' }); return; }
    onState({ state: 'trying', kind: w.kind });
    const info = { fail: (r) => { if (info.done) return; info.done = true; next(r); } };
    let lastT = -1, still = 0, moves = 0, started = false, t0 = Date.now();
    const limit = w.kind === 'hls' ? 15000 : 8000;   // Home Assistant can take a while to start a stream
    if (w.kind === 'mjpeg') {
      img.onerror = () => info.fail('mjpeg');
      img.src = `${w.url}${w.url.includes('?') ? '&' : '?'}t=${Date.now()}`;
      watch = setInterval(() => {
        if (img.naturalWidth > 0 && !started) { started = true; onState({ state: 'playing', kind: 'mjpeg', audio: false }); }
        if (!started && Date.now() - t0 > limit) info.fail('timeout');
      }, 300);
      return;
    }
    try {
      if (w.kind === 'mse') undo = clMse(video, w.url, Object.assign(info, st));
      else if (clNativeHls) { video.src = w.url; undo = null; }
      else undo = clHlsMse(video, w.url, Object.assign(info, st));
    } catch { info.fail('start'); return; }
    const kick = () => { const p = video.play?.(); if (p?.catch) p.catch(() => {}); };
    video.onerror = () => info.fail(w.kind);
    video.addEventListener('loadeddata', kick, { once: true }); kick();
    watch = setInterval(() => {
      if (info.done) return;
      const t = video.currentTime, b = video.buffered, end = b.length ? b.end(b.length - 1) : 0;
      if (t > lastT + 0.01) { still = 0; lastT = t; moves++; } else still += 300;
      if (b.length && t < b.start(0) - 0.05 && !video.seeking) video.currentTime = b.start(0) + 0.05;   // the first fragment doesn't start at zero
      if (!started && moves >= 3) { started = true; st.audio = info.audio || !!(video.audioTracks?.length) || !!video.mozHasAudio || (video.webkitAudioDecodedByteCount || 0) > 0; }
      if (w.kind !== 'hls' || !clNativeHls) { if (end - t > 3 && !video.seeking) video.currentTime = Math.max(t, end - 0.5); }   // fell behind: back to now
      if (video.paused && end > t) kick();
      const lat = w.kind === 'hls' && clNativeHls && video.seekable?.length ? video.seekable.end(video.seekable.length - 1) - t : end - t;
      if (started) onState({ state: 'playing', kind: w.kind, audio: st.audio, latency: Number.isFinite(lat) && lat >= 0 ? lat : null });
      if (!started && Date.now() - t0 > limit) info.fail('timeout');
      else if (started && still > 8000) info.fail('stalled');
    }, 300);
  };
  camPlanOf(d, role).then((plan) => { if (stopped) return; ways = camWays(plan); why = plan.why || null; idx = -1; next(); });
  return { stop() { stopped = true; clear(); }, video, get audio() { return st.audio; } };
}
/** What to tell someone when there's no live video, in plain words. */
const camWhyText = (why) => ({
  nogo2rtc: T('Frigate isn\'t sharing a live stream for this camera.'),
  nostream: T('Home Assistant doesn\'t offer a live stream for this camera.'),
  pictures: T('This camera sends pictures, not video.'),
  demo: T('The demo has pictures only.'),
}[why] || T('The live stream didn\'t start.'));
if (window.__casatorchTest) window.__casatorchTest.camWays = camWays;
