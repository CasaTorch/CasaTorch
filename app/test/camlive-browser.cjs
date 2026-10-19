#!/usr/bin/env node
/*
 * Live camera video, end to end, in Chromium: a CasaTorch with one Frigate camera (a stand-in Frigate with its
 * go2rtc, test/fake-frigate.mjs) and checks that the video really plays (its time moves on):
 *   - the Cameras page tile plays the camera's small stream (MSE over the WebSocket, through CasaTorch);
 *   - the full view plays the main stream, with a LIVE badge;
 *   - without WebSockets it plays go2rtc's HLS (fed to MediaSource);
 *   - without MediaSource either, the MJPEG picture;
 *   - only go2rtc's fixed paths ever reached "Frigate".
 * Needs ffmpeg (skipped without it).   cd app && node build.mjs && node test/camlive-browser.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const L = require('../../tools/test-e2e-lib.cjs');
const { check, finish } = L.runner('live camera video');

(async () => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('  (skipped: ffmpeg is not installed)'); return finish(); }
  const { startFakeFrigate } = await import('./fake-frigate.mjs');
  const fr = await startFakeFrigate({ port: await L.freePort() });
  const port = await L.freePort(), data = L.tmpDir('camlive-data');
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ house: { name: 'Test' }, cameras: [{ id: 'frigate-living', name: 'Living room', type: 'frigate', url: `http://127.0.0.1:${fr.port}`, camera: 'living' }] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: L.APP, env: { ...process.env, CASATORCH_DATA_DIR: data, PORT: String(port), CASATORCH_DEMO: '', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  let browser;
  try {
    await L.waitFor(`${base}/api/health`, 45000, child);
    browser = await L.launchBrowser();
    const SHOTS = process.env.SHOTS || path.join(require('node:os').tmpdir(), 'casatorch-test-results'); fs.mkdirSync(SHOTS, { recursive: true });
    const open = async (init) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'en-US' });
      await ctx.addInitScript(() => { try { localStorage.setItem('casatorch-tour', 'done'); } catch { /* none */ } });   // no welcome tour over the camera
      if (init) await ctx.addInitScript(init);
      const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('  page error:', e.message));
      await page.goto(`${base}/#cameras`); await page.waitForSelector('.cams .cam', { timeout: 20000 });
      return page;
    };
    const advances = async (page, sel) => {
      const t1 = await page.$eval(sel, (v) => v.currentTime); await page.waitForTimeout(1600);
      const t2 = await page.$eval(sel, (v) => v.currentTime); return { ok: t2 > t1 + 0.5, t1, t2 };
    };

    // 1. tile: MSE, small stream
    const page = await open();
    await page.waitForSelector('.cams .cam.cam-live', { timeout: 20000 }).catch(() => null);
    const tileLive = await page.$('.cams .cam.cam-live');
    check('the tile plays live video', !!tileLive);
    if (tileLive) { const a = await advances(page, '.cams .cam .cam-video'); check('the tile\'s video time moves on', a.ok, JSON.stringify(a)); }
    check('the tile asked for the small stream (living_sub) over the WebSocket', fr.seen.ws.some((w) => w.src === 'living_sub' && w.asked?.type === 'mse'), JSON.stringify(fr.seen.ws));
    const snapAsk = fr.seen.http.filter((x) => x.path === '/api/living/latest.jpg').map((x) => x.query);
    check('tile pictures are made at the tile\'s real pixel size (Retina: h>=480), without boxes', snapAsk.some((q) => /h=(480|720|1080)/.test(q) && /bbox=0/.test(q)), snapAsk.join(' '));

    // 2. full view (the camera's drawer, 06d-drawer.js): MSE, main stream
    await page.$eval('.cams .cam', (e) => e.click());
    await page.waitForSelector('#drawer .camv.is-live', { timeout: 20000 }).catch(() => null);
    check('the full view plays live video', !!(await page.$('#drawer .camv.is-live')));
    const a2 = await advances(page, '#drawer .camv-video'); check('the full view\'s video time moves on (MSE)', a2.ok, JSON.stringify(a2));
    check('the full view asked for the main stream (living)', fr.seen.ws.some((w) => w.src === 'living'));
    const badge = await page.textContent('#drawer .camv-badge'); check('the badge says LIVE (with the delay once it is noticeable)', /^LIVE( · [\d.]+ s)?$/.test(badge || ''), badge);
    check('Frigate saw no Origin from the page (go2rtc checks it) and no browser cookie', fr.seen.ws.every((w) => !w.origin && !/casatorch_session/.test(w.cookie || '')), JSON.stringify(fr.seen.ws));
    await page.screenshot({ path: path.join(SHOTS, 'camlive-modal-mse.png') });
    for (let i = 0; i < 3 && await page.$('#drawer:not(.dr-out)'); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(120); }   // Esc closes a sheet on top first ("What's new"), then the drawer
    for (let i = 0; i < 20 && fr.seen.open.living; i++) await page.waitForTimeout(150);
    check('closing the full view closes its stream at once (no socket left open to Frigate)', !fr.seen.open.living, JSON.stringify(fr.seen.open));

    // 3. no WebSocket: HLS (fragmented MP4) into MediaSource
    const before = fr.seen.http.length;
    const p2 = await open(() => { window.WebSocket = undefined; });
    await p2.$eval('.cams .cam', (e) => e.click());
    await p2.waitForSelector('#drawer .camv.is-live', { timeout: 25000 }).catch(() => null);
    if (!(await p2.$('#drawer .camv-video'))) { await p2.screenshot({ path: path.join(SHOTS, 'camlive-hls-missing.png') }); console.log('  modal now:', (await p2.$eval('#drawer', (m) => m.textContent.slice(0, 200)).catch(() => 'none'))); }
    const a3 = await advances(p2, '#drawer .camv-video'); check('without WebSockets, HLS plays and moves on', a3.ok, JSON.stringify(a3));
    const hls = fr.seen.http.slice(before).filter((x) => x.path.startsWith('/api/go2rtc/api/'));
    check('HLS went through go2rtc\'s own files (stream.m3u8, playlist, init, segments)', ['stream.m3u8', 'hls/playlist.m3u8', 'hls/init.mp4', 'hls/segment.m4s'].every((f) => hls.some((x) => x.path === `/api/go2rtc/api/${f}`)), hls.map((x) => x.path).join(' '));
    await p2.screenshot({ path: path.join(SHOTS, 'camlive-modal-hls.png') });

    // 4. no MediaSource and no WebSocket (an old phone): MJPEG
    const p3 = await open(() => { window.WebSocket = undefined; window.MediaSource = undefined; window.ManagedMediaSource = undefined; });
    await p3.$eval('.cams .cam', (e) => e.click());
    await p3.waitForSelector('#drawer .camv.is-live.is-img', { timeout: 20000 }).catch(() => null);
    check('with neither, the MJPEG picture plays', !!(await p3.$('#drawer .camv.is-live.is-img')));
    const note = await p3.textContent('#drawer .camv-note'); check('and says it is basic quality', /basic quality/.test(note || ''), note);

    // 5. only fixed paths reached Frigate
    const bad = fr.seen.http.filter((x) => x.unknown).map((x) => x.path);
    check('nothing but Frigate\'s and go2rtc\'s known paths was asked for', bad.length === 0, bad.join(' '));
    const r = await fetch(`${base}/api/camlive/camera%3Afrigate-living/hls/..%2F..%2Fconfig`); check('a made-up HLS path is refused', r.status === 404, `HTTP ${r.status}`);
    const r2 = await fetch(`${base}/api/camlive/camera%3Afrigate-living/mse`); check('the MSE address without a WebSocket upgrade answers 426', r2.status === 426, `HTTP ${r2.status}`);
  } catch (e) { console.log(log.slice(-2000)); throw e; }
  finally { await browser?.close().catch(() => {}); child.kill('SIGTERM'); fr.close(); if (!process.env.KEEP_TEST_DATA) { fs.rmSync(data, { recursive: true, force: true }); fs.rmSync(fr.dir, { recursive: true, force: true }); } }
  finish();
})().catch((e) => finish(e));
