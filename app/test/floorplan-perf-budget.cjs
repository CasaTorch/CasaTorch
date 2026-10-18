#!/usr/bin/env node
/*
 * The 3D home's speed budget, on the demo house (3 scanned floors, 42 devices, a full yard, 12 live outdoor things).
 * Draw calls and triangles per picture are counted by three.js itself, so they don't depend on the machine; the
 * software GPU in CI is slow, so time per picture is printed but not judged.
 *   Old tablet: at most 180 draw calls and 60,000 triangles per picture
 *   Normal:     at most 400 draw calls (sun shadows included) and 120,000 triangles
 *   Resting:    with nothing being touched, at most 12 pictures in 6 seconds on Old tablet (the demo's fan and vacuum move; it was 15+ before it learned to rest)
 * Run: node app/test/floorplan-perf-budget.cjs   (Playwright from $PLAYWRIGHT; TEST_PORT_BASE picks the ports)
 */
'use strict';
const { launchBrowser, startCasaTorch, shutdown } = require('../../tools/test-e2e-lib.cjs');
const BUDGET = { old: { calls: 180, tris: 60000, idle: 12 }, normal: { calls: 400, tris: 120000 } };

(async () => {
  let failed = false;
  const fail = (m) => { failed = true; console.error(`  FAIL ${m}`); }, ok = (m) => console.log(`  ok   ${m}`);
  try {
    const srv = await startCasaTorch({ name: '3d-perf', env: { CASATORCH_DEMO: '1' } });
    const browser = await launchBrowser();
    for (const level of Object.keys(BUDGET)) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      await ctx.addInitScript((l) => { try { localStorage.setItem('casatorch-3d-qlevel', JSON.stringify(l)); localStorage.setItem('casatorch-3d', JSON.stringify({ theme: 'real' })); } catch { /* fine */ } }, level);
      const p = await ctx.newPage(), errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(`${srv.base}/floorplan.html?debug3d=1`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.__casa3d && Object.keys(window.__casa3d.S.F).length >= 3, null, { timeout: 90000 });
      await p.waitForTimeout(12000);
      const r = await p.evaluate(() => new Promise((done) => {
        const C = window.__casa3d, R = C.renderer, o = R.render.bind(R); let calls = 0, tris = 0, n = 0, ms = [];
        R.info.autoReset = false;
        R.render = (s, c) => { if (c !== C.camera) return o(s, c); R.info.reset(); const t = performance.now(); o(s, c); ms.push(performance.now() - t); n++; calls = Math.max(calls, R.info.render.calls); tris = Math.max(tris, R.info.render.triangles); };
        let k = 0; const iv = setInterval(() => { C.kick(); if (++k > 6) clearInterval(iv); }, 150);
        setTimeout(() => { const at = n; setTimeout(() => { R.render = o; R.info.autoReset = true; ms.sort((a, b) => a - b); done({ calls, tris, idle: n - at, ms: +(ms[ms.length >> 1] || 0).toFixed(1) }); }, 6000); }, 2500);
      }));
      const B = BUDGET[level];
      console.log(`  ${level}: ${r.calls} draw calls, ${r.tris} triangles, ${r.idle} pictures in 6 s resting, ~${r.ms} ms a picture here`);
      if (r.calls > 0 && r.calls <= B.calls) ok(`${level}: draw calls within ${B.calls}`); else fail(`${level}: ${r.calls} draw calls (budget ${B.calls})`);
      if (r.tris <= B.tris) ok(`${level}: triangles within ${B.tris}`); else fail(`${level}: ${r.tris} triangles (budget ${B.tris})`);
      if (B.idle != null) { if (r.idle <= B.idle) ok(`${level}: rests when nothing moves`); else fail(`${level}: ${r.idle} pictures in 6 s with nothing touched (budget ${B.idle})`); }
      if (errs.length) fail(`${level}: page errors: ${errs.join(' | ')}`);
      await ctx.close();
    }
    await browser.close();
  } catch (e) { fail(e.stack || e.message); }
  await shutdown(failed);
  console.log(failed ? '\n3D speed budget: FAILED' : '\n3D speed budget: passed');
  process.exit(failed ? 1 : 0);
})();
