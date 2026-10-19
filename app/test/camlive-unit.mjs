/* Unit tests for live camera video (src/server/29g-camlive.js): which go2rtc stream is the main one and which the
   small one, which HLS files may be asked for (nothing else ever reaches Frigate or Home Assistant), the plan of
   ways to play, and the MSE WebSocket tunnel and HLS proxy against a stand-in Frigate (fake-frigate.mjs).
   Run from test/unit.mjs (which loads server.js first). The proxy part needs ffmpeg (skipped without it). */
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const PORT_APP = Number(process.env.CAMLIVE_TEST_PORT) || 18615;
/** A raw WebSocket handshake (so the test controls Origin): resolves { status, head, data } after the first bytes. */
function wsTry(port, path, headers = {}) {
  return new Promise((ok, fail) => {
    const s = net.connect(port, '127.0.0.1', () => {
      const h = { Host: `127.0.0.1:${port}`, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), ...headers };
      s.write(`GET ${path} HTTP/1.1\r\n${Object.entries(h).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    });
    let buf = Buffer.alloc(0), sent = false;
    const t = setTimeout(() => { s.destroy(); ok({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(buf.toString('latin1'))?.[1] || 0), raw: buf }); }, 4000);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const head = buf.toString('latin1'), status = Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] || 0), end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      if (status !== 101) { clearTimeout(t); s.destroy(); return ok({ status, raw: buf }); }
      if (!sent) {   // ask for MSE, as the page does (a masked text frame)
        sent = true; const p = Buffer.from(JSON.stringify({ type: 'mse', value: 'vp09.00.10.08' })), mask = crypto.randomBytes(4), m = Buffer.from(p.map((b, i) => b ^ mask[i & 3]));
        s.write(Buffer.concat([Buffer.from([0x81, 0x80 | p.length]), mask, m]));
      }
      const body = buf.subarray(end + 4);
      if (body.length >= 2 && body[0] === 0x81 && body.length >= 2 + body[1]) { clearTimeout(t); s.destroy(); ok({ status, text: body.subarray(2, 2 + body[1]).toString() }); }
    });
    s.on('error', fail);
  });
}

export default async function camLiveTests(t) {
  const C = globalThis.__casatorchCamLive, H = globalThis.__casatorch;

  t('camlive: <cam> and <cam>_sub - main for the full view, sub for tiles', () => assert.deepEqual(C.pickStreams('door', ['door', 'door_sub', 'yard']), { main: 'door', sub: 'door_sub' }));
  t('camlive: Frigate\'s record/detect inputs decide (restream names that don\'t follow <cam>_sub)', () => assert.deepEqual(C.pickStreams('door', ['front_hd', 'front_small'], { ffmpeg: { inputs: [{ path: 'rtsp://127.0.0.1:8554/front_small', roles: ['detect'] }, { path: 'rtsp://127.0.0.1:8554/front_hd?video=copy', roles: ['record'] }] } }), { main: 'front_hd', sub: 'front_small' }));
  t('camlive: Frigate 0.15 live.streams, a sub-like name listed first is still the small one', () => assert.deepEqual(C.pickStreams('door', ['door_lq', 'door_main'], { live: { streams: { Low: 'door_lq', High: 'door_main' } } }), { main: 'door_main', sub: 'door_lq' }));
  t('camlive: one stream only - tiles and full view share it', () => assert.deepEqual(C.pickStreams('door', ['door']), { main: 'door', sub: 'door' }));
  t('camlive: go2rtc has nothing for this camera - no go2rtc ways', () => { assert.equal(C.pickStreams('door', ['yard', 'yard_sub']), null); assert.equal(C.pickStreams('door', []), null); });

  t('camlive: go2rtc HLS - only its fixed files, src set by CasaTorch, only id/n passed on', () => {
    assert.equal(C.hlsUpstream('go2rtc', 'stream.m3u8', { src: 'evil', url: 'http://x' }, { src: 'door_sub' }), '/api/go2rtc/api/stream.m3u8?src=door_sub&mp4');
    assert.equal(C.hlsUpstream('go2rtc', 'hls/segment.m4s', { id: 'ab12', n: '7', extra: 'x' }, { src: 'door' }), '/api/go2rtc/api/hls/segment.m4s?id=ab12&n=7');
    for (const [f, q] of [['../config', {}], ['hls/../../api/config', { id: 'a' }], ['api/streams', {}], ['hls/segment.m4s', { id: '../x' }], ['hls/segment.m4s', { id: 'a', n: '1;x' }], ['http://169.254.169.254/', {}], ['hls/playlist.m3u8', {}], ['frame.jpeg', { id: 'a' }]])
      assert.equal(C.hlsUpstream('go2rtc', f, q, { src: 'door' }), null, f);
  });
  t('camlive: Home Assistant HLS - its playlist, init and segment files only, the token from this box', () => {
    assert.equal(C.hlsUpstream('ha', 'segment/12.3.m4s', { _HLS_msn: '12', other: 'x' }, { token: 'tok-abcdefgh' }), '/api/hls/tok-abcdefgh/segment/12.3.m4s?_HLS_msn=12');
    assert.equal(C.hlsUpstream('ha', 'master_playlist.m3u8', {}, { token: 'tok-abcdefgh' }), '/api/hls/tok-abcdefgh/master_playlist.m3u8');
    for (const f of ['../../api/states', 'segment/../../x.m4s', 'playlist.m3u8?x', 'api/config']) assert.equal(C.hlsUpstream('ha', f, {}, { token: 'tok-abcdefgh' }), null, f);
    assert.equal(C.hlsUpstream('ha', 'init.mp4', {}, { token: '../x' }), null);
    assert.equal(C.hlsUpstream('nope', 'init.mp4', {}, { token: 'tok-abcdefgh' }), null);
  });

  let ff = true; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ff = false; }
  if (!ff) { console.log('  (camlive proxy tests skipped: no ffmpeg)'); return; }
  const { startFakeFrigate } = await import('./fake-frigate.mjs');
  const fr = await startFakeFrigate({ port: PORT_APP + 1 });
  const cfg = C.cfg(), was = cfg.cameras;
  cfg.cameras = [{ id: 'fr-door', name: 'Door', type: 'frigate', url: `http://127.0.0.1:${fr.port}`, camera: 'living' }, { id: 'snap1', name: 'Snap', type: 'snapshot', snapshotUrl: 'http://127.0.0.1:9/x.jpg' }];
  const srv = await new Promise((ok) => { const s = H.app.listen(PORT_APP, '127.0.0.1', () => ok(s)); });
  const B = `http://127.0.0.1:${PORT_APP}`, dev = encodeURIComponent('camera:fr-door');
  try {
    await t('camlive: plan - MSE, then HLS, then MJPEG; tiles get the small stream', async () => {
      const full = await C.camPlan('camera:fr-door', 'full'), tile = await C.camPlan('camera:fr-door', 'tile');
      assert.deepEqual(full.ways.map((w) => w.kind), ['mse', 'hls', 'mjpeg']); assert.match(full.ways[0].url, /s=main$/); assert.match(tile.ways[0].url, /s=sub$/);
      assert.deepEqual((await C.camPlan('camera:snap1', 'full')).ways, []); assert.equal((await C.camPlan('camera:snap1', 'full')).why, 'pictures');
      assert.equal(await C.camPlan('camera:nope', 'full'), null); assert.equal(await C.camPlan('camera:../x', 'full'), null);
    });
    await t('camlive: MSE tunnel - CasaTorch\'s own page gets go2rtc\'s answer, for the stream CasaTorch picked', async () => {
      const r = await wsTry(PORT_APP, `/api/camlive/${dev}/mse?s=sub`, { Origin: B });
      assert.equal(r.status, 101); assert.match(r.text, /"type":"mse"/);
      assert.equal(fr.seen.ws.at(-1).src, 'living_sub'); assert.equal(fr.seen.ws.at(-1).origin, null);
    });
    await t('camlive: MSE tunnel refused to another site\'s page, to no Origin, to a non-Frigate camera, and to a bad key', async () => {
      assert.equal((await wsTry(PORT_APP, `/api/camlive/${dev}/mse`, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await wsTry(PORT_APP, `/api/camlive/${dev}/mse`, {})).status, 403);
      assert.equal((await wsTry(PORT_APP, `/api/camlive/${encodeURIComponent('camera:snap1')}/mse`, { Origin: B })).status, 404);
      assert.equal((await wsTry(PORT_APP, `/api/camlive/${dev}/mse`, { Origin: B, 'Sec-WebSocket-Key': 'x' })).status, 400);
      assert.equal((await wsTry(PORT_APP, '/api/health', { Origin: B })).status, 200);   // any other upgrade is just a request
    });
    await t('camlive: HLS through CasaTorch - go2rtc\'s playlist comes back; made-up paths never reach Frigate', async () => {
      const m = await fetch(`${B}/api/camlive/${dev}/hls/stream.m3u8?s=main&src=other`); assert.equal(m.status, 200);
      const id = /id=(\w+)/.exec(await m.text())[1];
      assert.equal(fr.seen.http.filter((x) => x.path === '/api/go2rtc/api/stream.m3u8').at(-1).query, '?src=living&mp4');
      assert.equal((await fetch(`${B}/api/camlive/${dev}/hls/hls/playlist.m3u8?id=${id}`)).status, 200);
      for (const p of ['hls/..%2F..%2Fconfig', '..%2F..%2Fapi%2Fconfig', 'api/streams', `hls/segment.m4s?id=${id}%2F..`]) assert.equal((await fetch(`${B}/api/camlive/${dev}/hls/${p}`)).status, 404, p);
      assert.equal(fr.seen.http.filter((x) => x.unknown).length, 0);
    });
    await t('camlive: CSP lets the page reach only its own address over a WebSocket', async () => {
      const csp = (await fetch(`${B}/api/health`)).headers.get('content-security-policy');
      assert.match(csp, new RegExp(`connect-src 'self' blob: data: wss://127\\.0\\.0\\.1:${PORT_APP} ws://127\\.0\\.0\\.1:${PORT_APP};`));
      assert.match(csp, /media-src 'self' blob:/);
    });
  } finally { srv.closeAllConnections?.(); srv.close(); fr.close(); cfg.cameras = was; (await import('node:fs')).rmSync(fr.dir, { recursive: true, force: true }); }
}
