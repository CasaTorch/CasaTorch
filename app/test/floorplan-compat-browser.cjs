#!/usr/bin/env node
/*
 * The 3D home on older browsers, best effort (a real old Chrome isn't available in CI, so a current Chromium is made
 * to look like one: an old user agent and the newer functions removed before the page runs).
 *   1. "Chrome 79" (no Object.hasOwn, no Array.prototype.at, no structuredClone): the page must say it is too old,
 *      plainly, instead of a blank screen or an error.
 *   2. "Chrome 100" (no structuredClone, no color-mix() in CSS): the 3D home must start with no page errors, and the
 *      color-mix() stand-in (floorplan-compat.js) must have written plain colors for the panels.
 * Run: node app/test/floorplan-compat-browser.cjs   (Playwright from $PLAYWRIGHT, like the other end-to-end tests;
 * TEST_PORT_BASE picks the ports). Exit code 0 = passed.
 */
'use strict';
const { launchBrowser, startCasaTorch, shutdown } = require('../../tools/test-e2e-lib.cjs');

const STRIP = (opts) => {   // runs in the page before anything else
  if (opts.old) { try { delete Object.hasOwn; } catch { /* fine */ } try { delete Array.prototype.at; } catch { /* fine */ } }
  try { delete window.structuredClone; } catch { /* fine */ }
  if (opts.noColorMix && window.CSS && CSS.supports) { const s = CSS.supports.bind(CSS); CSS.supports = (...a) => (a.join(' ').includes('color-mix') ? false : s(...a)); }
};

(async () => {
  let failed = false;
  const fail = (m) => { failed = true; console.error(`  FAIL ${m}`); };
  const ok = (m) => console.log(`  ok   ${m}`);
  try {
    const srv = await startCasaTorch({ name: '3d-compat', env: { CASATORCH_DEMO: '1' } });
    const browser = await launchBrowser();
    /* 1. too old */
    {
      const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.136 Safari/537.36', locale: 'en-US' });
      await ctx.addInitScript(STRIP, { old: true });
      const p = await ctx.newPage(), errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(`${srv.base}/floorplan.html`, { waitUntil: 'load' });
      const shown = await p.waitForSelector('#tooold', { timeout: 10000 }).then(() => true).catch(() => false);
      if (shown) ok('an old browser is told plainly that it is too old'); else fail('no "too old" message on an old browser');
      const text = shown ? await p.textContent('#tooold') : '';
      if (/Chrome or Edge 94/.test(text) && /dashboard/i.test(text)) ok('the message says what is needed and links back'); else fail(`message text: ${text.slice(0, 120)}`);
      if (await p.evaluate(() => !!window.__casa3dReady)) fail('the 3D modules still started'); else ok('the 3D modules were not started');
      if (errs.length) fail(`page errors: ${errs.join(' | ')}`); else ok('no page errors');
      await ctx.close();
    }
    /* 2. old enough */
    {
      const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36', locale: 'en-US', viewport: { width: 1024, height: 600 } });
      await ctx.addInitScript(() => { try { localStorage.setItem('casatorch-3d-qlevel', '"old"'); } catch { /* fine */ } });
      await ctx.addInitScript(STRIP, { noColorMix: true });
      const p = await ctx.newPage(), errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(`${srv.base}/floorplan.html`, { waitUntil: 'load' });
      const ready = await p.waitForFunction(() => window.__casa3dReady === true, null, { timeout: 60000 }).then(() => true).catch(() => false);
      if (ready) ok('the 3D home starts without structuredClone and color-mix()'); else fail('the 3D home did not start');
      if (await p.$('#tooold')) fail('"too old" shown on a browser that can run it'); else ok('no "too old" message');
      const fix = await p.waitForFunction(() => document.getElementById('cmfix')?.textContent.includes('rgba('), null, { timeout: 15000 }).then(() => p.evaluate(() => document.getElementById('cmfix').textContent)).catch(() => '');
      if (fix && !fix.includes('color-mix(') && /\.panel|\.tabs|\.mini/.test(fix)) ok(`color-mix() stand-in wrote ${fix.split('\n').filter(Boolean).length} rules in plain colors`); else fail('no color-mix() stand-in rules');
      await p.waitForTimeout(3000);
      if (errs.length) fail(`page errors: ${errs.join(' | ')}`); else ok('no page errors');
      await ctx.close();
    }
    await browser.close();
  } catch (e) { fail(e.stack || e.message); }
  await shutdown(failed);
  console.log(failed ? '\n3D compatibility: FAILED' : '\n3D compatibility: passed');
  process.exit(failed ? 1 : 0);
})();
