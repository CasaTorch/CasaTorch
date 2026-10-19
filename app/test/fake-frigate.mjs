/* A stand-in Frigate (0.14-style) with its built-in go2rtc, for the live-video tests: /api/version, /api/config,
   /api/go2rtc/streams, latest.jpg, the MJPEG stream, go2rtc's MSE WebSocket (/live/mse/api/ws) and its HLS
   (/api/go2rtc/api/stream.m3u8, hls/...). The video is made here with ffmpeg: 12 s of a test pattern as
   fragmented MP4, VP9 (the open-source Chromium the tests use has no H.264; real go2rtc sends H.264/H.265 the same way).
   Every request is logged in `seen`, so a test can check exactly what reached "Frigate". */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CODEC = 'vp09.00.10.08';
export function makeSample(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casatorch-cam-'))) {
  const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a], { cwd: dir, stdio: 'pipe' });
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', '12', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-g', '15', '-keyint_min', '15', '-pix_fmt', 'yuv420p',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 's.mp4');
  ff('-i', 's.mp4', '-c', 'copy', '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_time', '1', '-hls_list_size', '0', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', 'seg%d.m4s', 'pl.m3u8');
  ff('-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=1', '-frames:v', '1', 'snap.jpg');
  return dir;
}
/** Top-level MP4 boxes: the init part (ftyp+moov) and each fragment (moof+mdat). */
function fragments(buf) {
  const boxes = []; for (let o = 0; o + 8 <= buf.length;) { const n = buf.readUInt32BE(o); if (n < 8) break; boxes.push({ type: buf.toString('latin1', o + 4, o + 8), data: buf.subarray(o, o + n) }); o += n; }
  const init = Buffer.concat(boxes.filter((b) => b.type === 'ftyp' || b.type === 'moov').map((b) => b.data)), frags = [];
  for (let i = 0; i < boxes.length; i++) if (boxes[i].type === 'moof' && boxes[i + 1]?.type === 'mdat') frags.push(Buffer.concat([boxes[i].data, boxes[i + 1].data]));
  return { init, frags };
}
const wsFrame = (op, payload) => {
  const p = Buffer.from(payload), n = p.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, p]);
};
function readFrame(buf) {   // one masked client frame -> { op, text } or null
  if (buf.length < 2) return null;
  let n = buf[1] & 127, o = 2; if (n === 126) { n = buf.readUInt16BE(2); o = 4; } else if (n === 127) return null;
  if (buf.length < o + 4 + n) return null;
  const mask = buf.subarray(o, o + 4), data = Buffer.from(buf.subarray(o + 4, o + 4 + n)); for (let i = 0; i < n; i++) data[i] ^= mask[i & 3];
  return { op: buf[0] & 15, text: data.toString('utf8'), size: o + 4 + n };
}

export function startFakeFrigate({ port = 0, dir = makeSample(), streams = ['living', 'living_sub'], user = null } = {}) {
  const mp4 = fragments(fs.readFileSync(path.join(dir, 's.mp4'))), seg = (i) => fs.readFileSync(path.join(dir, `seg${i}.m4s`));
  const segCount = fs.readdirSync(dir).filter((f) => /^seg\d+\.m4s$/.test(f)).length, jpg = fs.readFileSync(path.join(dir, 'snap.jpg'));
  const seen = { http: [], ws: [], sessions: new Map(), open: {} };   // open: live sockets per stream
  const authed = (req) => !user || /frigate_token=good/.test(String(req.headers.cookie || ''));
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); seen.http.push({ path: u.pathname, query: u.search, cookie: req.headers.cookie || null });
    const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname === '/api/login' && req.method === 'POST') { res.setHeader('Set-Cookie', 'frigate_token=good; Path=/'); return res.end('{}'); }
    if (!authed(req)) { res.statusCode = 401; return res.end(); }
    if (u.pathname === '/api/version') return res.end('0.14.1');
    if (u.pathname === '/api/stats') return json({ cameras: { living: {} } });
    if (u.pathname === '/api/events') return json([]);
    if (u.pathname === '/api/config') return json({ cameras: { living: { ffmpeg: { inputs: [{ path: 'rtsp://127.0.0.1:8554/living', roles: ['record'] }, { path: 'rtsp://127.0.0.1:8554/living_sub', roles: ['detect'] }] }, live: { stream_name: 'living' } } } });
    if (u.pathname === '/api/go2rtc/streams') return json(Object.fromEntries(streams.map((s) => [s, { producers: [], consumers: [] }])));
    if (u.pathname === '/api/living/latest.jpg') { res.setHeader('Content-Type', 'image/jpeg'); return res.end(jpg); }
    if (u.pathname === '/api/living') {   // MJPEG
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
      const t = setInterval(() => res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`), jpg, Buffer.from('\r\n')])), 200);
      return res.on('close', () => clearInterval(t));
    }
    if (u.pathname === '/api/go2rtc/api/stream.m3u8') {
      if (!streams.includes(u.searchParams.get('src')) || !u.searchParams.has('mp4')) { res.statusCode = 404; return res.end(); }
      const id = crypto.randomBytes(6).toString('hex'); seen.sessions.set(id, { src: u.searchParams.get('src'), at: Date.now() });
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.end(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=192000,CODECS="${CODEC}"\nhls/playlist.m3u8?id=${id}\n`);
    }
    const ses = seen.sessions.get(u.searchParams.get('id') || '');
    if (u.pathname === '/api/go2rtc/api/hls/playlist.m3u8' && ses) {   // a live window: the newest 3 one-second parts
      const k = Math.min(segCount - 1, 2 + Math.floor((Date.now() - ses.at) / 1000)), first = Math.max(0, k - 2);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.end(['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:1', `#EXT-X-MEDIA-SEQUENCE:${first}`, `#EXT-X-MAP:URI="init.mp4?id=${u.searchParams.get('id')}"`,
        ...Array.from({ length: k - first + 1 }, (_, i) => `#EXTINF:1.000,\nsegment.m4s?id=${u.searchParams.get('id')}&n=${first + i}`), ...(k >= segCount - 1 ? ['#EXT-X-ENDLIST'] : [])].join('\n'));
    }
    if (u.pathname === '/api/go2rtc/api/hls/init.mp4' && ses) { res.setHeader('Content-Type', 'video/mp4'); return res.end(fs.readFileSync(path.join(dir, 'init.mp4'))); }
    if (u.pathname === '/api/go2rtc/api/hls/segment.m4s' && ses && Number(u.searchParams.get('n')) < segCount) { res.setHeader('Content-Type', 'video/iso.segment'); return res.end(seg(Number(u.searchParams.get('n')))); }
    seen.http.at(-1).unknown = true; res.statusCode = 404; res.end();
  });
  srv.on('upgrade', (req, sock) => {
    const u = new URL(req.url, 'http://x'), src = u.searchParams.get('src');
    const rec = { path: u.pathname, src, cookie: req.headers.cookie || null, origin: req.headers.origin || null }; seen.ws.push(rec);
    if (u.pathname !== '/live/mse/api/ws' || !streams.includes(src) || !authed(req)) { sock.end(`HTTP/1.1 ${authed(req) ? 404 : 401} No\r\nContent-Length: 0\r\n\r\n`); return; }
    const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    seen.open[src] = (seen.open[src] || 0) + 1;
    let buf = Buffer.alloc(0), timer = null, gone = false; const bye = () => { clearInterval(timer); if (!gone) { gone = true; seen.open[src]--; } };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]); const f = readFrame(buf); if (!f) return;
      buf = buf.subarray(f.size);
      if (f.op === 8) { sock.end(wsFrame(8, '')); bye(); return; }   // the page closed it: answer and hang up, as go2rtc does
      if (timer) return;
      let m = null; try { m = JSON.parse(f.text); } catch { /* not ours */ }
      rec.asked = m;
      if (m?.type !== 'mse') return;
      sock.write(wsFrame(1, JSON.stringify({ type: 'mse', value: `video/mp4; codecs="${CODEC}"` })));
      sock.write(wsFrame(2, mp4.init));
      let i = 0; sock.write(wsFrame(2, mp4.frags[i++]));
      timer = setInterval(() => { if (i >= mp4.frags.length) { clearInterval(timer); return; } sock.write(wsFrame(2, mp4.frags[i++])); }, 1000);
    });
    sock.on('close', bye); sock.on('error', bye);
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ srv, port: srv.address().port, seen, dir, close: () => { srv.closeAllConnections?.(); srv.close(); } })));
}
