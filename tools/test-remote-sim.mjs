#!/usr/bin/env node
/*
 * The dashboard over a slow, flaky link (what a phone on mobile data sees through secure access).
 *
 * A demo CasaTorch runs behind a small TCP proxy that adds latency (default 150 ms round trip), a little jitter
 * and limited bandwidth, and that can:
 *   - freeze every open connection without closing it (what a Wi-Fi -> mobile data switch leaves behind: the
 *     phone's old connections are dead, but nothing says so),
 *   - reset every open connection (a router or tunnel restart),
 *   - go fully offline for a while (a tunnel or elevator), then come back.
 * A phone-sized Chromium opens the dashboard through it and checks that:
 *   - no page is ever blank: the page body always shows content, a skeleton or a retry card,
 *   - a page seen before draws within 1 s from the last known data, even while every connection is dead,
 *   - after the network comes back, the live event stream reconnects and the page catches up by itself.
 * It prints time to first content on Home (cold and warm) and per tab switch.
 *
 *   node tools/test-remote-sim.mjs                 run the checks (part of test:all; skipped with --no-e2e)
 *   node tools/test-remote-sim.mjs --report        only measure and print, no pass/fail
 *   RTT=150 MBPS=8 node tools/test-remote-sim.mjs  link settings
 */
import net from 'node:net';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lib = require('./test-e2e-lib.cjs');

if (process.env.SKIP_E2E === '1') { console.log('remote-sim: skipped (SKIP_E2E)'); process.exit(0); }
const REPORT = process.argv.includes('--report');
const RTT = Number(process.env.RTT) || 150, MBPS = Number(process.env.MBPS) || 8, JITTER = Number(process.env.JITTER ?? 20);

/* ---- the link: latency, jitter, bandwidth; freeze / reset / offline ---- */
function makeLink(targetPort) {
  const pairs = new Set(), all = new Set();
  let offline = false, down = 0;
  const half = RTT / 2;
  const pipe = (from, to, pair) => {
    let lastAt = 0;
    from.on('data', (chunk) => {
      if (pair.dead || offline) return;   // a dead connection: bytes go nowhere, and nothing says so
      const wire = (chunk.length * 8) / (MBPS * 1000);   // ms on the wire
      const at = Math.max(lastAt, Date.now() + half + Math.random() * JITTER) + wire; lastAt = at;
      setTimeout(() => { if (!pair.dead && !to.destroyed) to.write(chunk); }, at - Date.now());
    });
    from.on('error', () => {}); from.on('close', () => { if (!pair.dead) setTimeout(() => to.destroy(), half); });
  };
  const server = net.createServer((client) => {
    all.add(client); client.on('close', () => all.delete(client));
    if (offline) { client.on('error', () => {}); return; }   // offline: the connection never gets anywhere
    const up = net.connect(targetPort, '127.0.0.1');
    const pair = { client, up, dead: false };
    pairs.add(pair);
    client.on('close', () => pairs.delete(pair));
    pipe(client, up, pair); pipe(up, client, pair);
    up.on('data', (c) => { down += c.length; });
    up.on('error', () => client.destroy());
  });
  return {
    listen: (port) => new Promise((ok) => server.listen(port, '127.0.0.1', ok)),
    /* every open connection goes silent and stays open (the network changed under it) */
    freeze() { for (const p of pairs) p.dead = true; },
    /* every open connection is reset */
    reset() { for (const p of pairs) { p.dead = true; p.client.destroy(); p.up.destroy(); } pairs.clear(); },
    setOffline(on) { offline = on; if (on) for (const p of pairs) p.dead = true; },
    open: () => [...pairs].filter((p) => !p.dead).length,
    bytes: () => down,
    close: () => new Promise((ok) => { for (const p of pairs) { p.client.destroy(); p.up.destroy(); } for (const c of all) c.destroy(); server.close(ok); }),
  };
}

/* ---- in the page: what the page body shows right now ---- */
const STATE = `(() => {
  const v = document.querySelector('#view'); if (!v) return { s: 'blank' };
  const box = [...v.children].reverse().find((n) => !n.classList.contains('view-next')) || null;
  if (!box) return { s: 'blank' };
  if (!box.__simId) box.__simId = Math.random().toString(36).slice(2);
  const text = (box.innerText || '').replace(/\\s+/g, ' ').trim();
  const skel = !!box.querySelector('.skel');
  const err = !!box.querySelector('.load-fail');
  return { id: box.__simId, s: err ? 'retry' : skel && text.length < 40 ? 'skeleton' : text.length >= 40 ? 'content' : text.length ? 'partial' : 'blank', len: text.length };
})()`;
/* Go to a page (as tapping its button does) and time it: ms to content, and the longest stretch the body was blank. */
async function visit(page, hash, { limit = 20000 } = {}) {
  const before = await page.evaluate(STATE);
  const t0 = Date.now();
  await page.evaluate((h) => { location.hash = h; }, hash);
  let blankSince = null, longestBlank = 0, first = null, sawSkeleton = false, last = null;
  while (Date.now() - t0 < limit) {
    const st = await page.evaluate(STATE).catch(() => ({ s: 'blank' }));
    last = st;
    const fresh = st.id && st.id !== before.id;
    const now = Date.now() - t0;
    if (process.env.SIM_TRACE && now % 1000 < 30) console.log(`    ${hash} @${now} ${JSON.stringify(st)} ${JSON.stringify(await page.evaluate(() => [window.__casaNet?.status(), document.querySelector('#view')?.children.length, [...document.querySelectorAll('#view > *')].map((n) => n.className + ':' + (n.dataset.page || '')).join(',')]))}`);
    if (fresh && st.s === 'skeleton') sawSkeleton = true;
    if (fresh && st.s === 'blank') { blankSince ??= now; longestBlank = Math.max(longestBlank, now - blankSince); } else blankSince = null;
    if (fresh && (st.s === 'content' || st.s === 'retry')) { first = { ms: now, state: st.s }; break; }
    await new Promise((r) => setTimeout(r, 25));
  }
  return { hash, ms: first?.ms ?? null, state: first?.state ?? last?.s, longestBlank, sawSkeleton };
}
async function firstContent(page, t0, limit = 30000) {
  while (Date.now() - t0 < limit) {
    const [st, born] = await page.evaluate(`[${STATE}, performance.timeOrigin]`).catch(() => [{ s: 'blank' }, 0]);
    if (st.s === 'content' && born >= t0 - 50) return Date.now() - t0;   // this page load, not the one before
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

const { check, finish } = lib.runner(`remote-sim: the dashboard over a ${RTT} ms, ${MBPS} Mbit/s link with dropped connections`);
const results = { link: { rtt: RTT, mbps: MBPS } };
const step = (s) => { if (process.env.SIM_VERBOSE) console.log(`  .. ${s}`); };
try {
  const cas = await lib.startCasaTorch({ name: 'remote-sim', env: { CASATORCH_DEMO: '1' } });
  const link = makeLink(cas.port), lport = await lib.freePort();
  await link.listen(lport);
  const base = `http://127.0.0.1:${lport}`;
  const browser = await lib.launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/Los_Angeles',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CasaTorchApp/0.8.0 (iOS)' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = lib.shooter(page, 'remote-sim');

  step('cold');
  let apiCalls = 0; const pending = new Set();
  page.on('request', (r) => pending.add(r)); page.on('requestfinished', (r) => pending.delete(r)); page.on('requestfailed', (r) => pending.delete(r));
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/') && !r.url().includes('/api/live/')) apiCalls++; });
  /* cold: nothing cached */
  let t0 = Date.now(), b0 = link.bytes();
  await page.goto(`${base}/#home`, { waitUntil: 'commit' });
  results.coldHome = await firstContent(page, t0);
  if (process.env.SIM_TRACE) console.log('  pending after cold load:', [...pending].map((r) => r.url().replace(base, '')).join(' '));
  results.coldApiCalls = apiCalls; results.coldKB = Math.round((link.bytes() - b0) / 1024);
  await page.waitForTimeout(2500);   // the service worker installs, idle prefetches finish
  step('warm');
  /* warm: the app has been opened before */
  t0 = Date.now(); b0 = link.bytes(); apiCalls = 0;
  const warmNet = [];
  if (process.env.SIM_TRACE) { page.on('response', async (r) => { if (!r.url().includes('/api/')) warmNet.push(`${r.url().replace(base, '')} ${r.status()}${r.fromServiceWorker() ? ' sw' : ''}`); }); ctx.on('response', async (r) => { if (!r.url().includes('/api/')) warmNet.push(`[ctx] ${r.url().replace(base, '')} ${r.status()}`); }); }
  await page.reload({ waitUntil: 'commit' });
  results.warmHome = await firstContent(page, t0);
  results.warmApiCalls = apiCalls;
  results.warmKB = Math.round((link.bytes() - b0) / 1024);
  await page.waitForTimeout(1500);
  if (process.env.SIM_TRACE) console.log('  warm static:', warmNet.join(' | '));
  await page.waitForTimeout(1500);
  await shot('home');

  step('tabs');
  const TABS = ['#controls', '#alerts', '#energy', '#network', '#settings', '#home'];
  results.firstVisit = [];
  for (const h of TABS) results.firstVisit.push(await visit(page, h));
  results.revisit = [];
  for (const h of TABS) results.revisit.push(await visit(page, h));

  step('freeze');
  /* the network changes under the page: every open connection silently dead */
  link.freeze();
  results.frozen = [];
  for (const h of ['#controls', '#alerts', '#home']) results.frozen.push(await visit(page, h, { limit: 12000 }));
  await shot('after-freeze');
  /* ... and the app tells the page (what the iPhone and Android apps do on a network change) */
  link.freeze();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('casa:network', { detail: { online: true, wifi: false, cellular: true } })));
  results.frozenWithEvent = [];
  for (const h of ['#energy', '#controls']) results.frozenWithEvent.push(await visit(page, h, { limit: 12000 }));

  step('reset');
  /* every connection reset */
  link.reset();
  results.reset = [];
  for (const h of ['#alerts', '#home']) results.reset.push(await visit(page, h, { limit: 12000 }));

  step('offline');
  /* fully offline for a while: the cached page shows, and says so */
  link.setOffline(true);
  results.offline = [];
  for (const h of ['#controls', '#network']) results.offline.push(await visit(page, h, { limit: 12000 }));
  await page.waitForTimeout(9000);
  results.offlineNote = await page.evaluate(() => document.querySelector('#netstate')?.innerText || '');
  await shot('offline');
  results.blankWhileOffline = (await page.evaluate(STATE)).s === 'blank';
  /* reopened while offline: the app (from the service worker) and the last data (from this browser's copy) */
  t0 = Date.now();
  await page.goto(`${base}/?reopen=1#controls`, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
  results.offlineReopen = await firstContent(page, t0, 10000);
  await shot('offline-reopen');
  link.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  step('back');
  /* back: the live stream reconnects and the note goes */
  const backAt = Date.now();
  let liveBack = null;
  while (Date.now() - backAt < 20000) {
    const st = await page.evaluate(() => window.__casaNet?.live?.() || null);
    if (st?.open) { liveBack = Date.now() - backAt; break; }
    await page.waitForTimeout(100);
  }
  results.liveBackMs = liveBack;
  await page.waitForTimeout(2500);
  results.noteAfter = await page.evaluate(() => { const n = document.querySelector('#netstate'); return n && !n.hidden ? n.innerText : ''; });
  results.afterBack = await visit(page, '#alerts');
  await shot('back-online');
  results.pageErrors = errors.slice(0, 5);
  await browser.close();
  await link.close();

  const fmt = (r) => `${r.hash.padEnd(10)} ${r.ms == null ? 'never'.padStart(6) : `${r.ms} ms`.padStart(8)} ${r.state}${r.longestBlank > 300 ? `  (blank ${r.longestBlank} ms)` : ''}`;
  console.log(`\n  link: ${RTT} ms round trip, ${MBPS} Mbit/s`);
  console.log(`  Home, first open: ${results.coldHome ?? 'never'} ms (${results.coldApiCalls} API calls by first content, ${results.coldKB} KB)   reopened: ${results.warmHome ?? 'never'} ms (${results.warmApiCalls} API calls, ${results.warmKB} KB by first content)`);
  for (const k of ['firstVisit', 'revisit', 'frozen', 'frozenWithEvent', 'reset', 'offline']) { console.log(`  ${k}:`); for (const r of results[k]) console.log(`    ${fmt(r)}`); }
  console.log(`  reopened while offline: ${results.offlineReopen ?? 'never'} ms`);
  console.log(`  offline note: "${results.offlineNote}"   live stream back after: ${results.liveBackMs ?? 'never'} ms   note after: "${results.noteAfter}"`);
  if (process.env.SIM_JSON) (await import('node:fs')).writeFileSync(process.env.SIM_JSON, JSON.stringify(results, null, 2));
  if (REPORT) { await lib.shutdown(); process.exit(0); }

  const all = [...results.firstVisit, ...results.revisit, ...results.frozen, ...results.frozenWithEvent, ...results.reset, ...results.offline, results.afterBack];
  check('Home draws on first open', results.coldHome != null && results.coldHome < 8000, `${results.coldHome} ms`);
  check('Home draws when reopened', results.warmHome != null && results.warmHome < 3000, `${results.warmHome} ms`);
  check('no page is ever blank (content, a skeleton or a retry card)', all.every((r) => r.longestBlank < 400 && r.state !== 'blank'), all.filter((r) => r.longestBlank >= 400 || r.state === 'blank').map(fmt).join('; '));
  check('every tab switch over the slow link shows content', [...results.firstVisit, ...results.revisit].every((r) => r.state === 'content'), results.firstVisit.concat(results.revisit).map(fmt).join('; '));
  check('a page seen before draws within 1 s', results.revisit.every((r) => r.ms != null && r.ms < 1000), results.revisit.map(fmt).join('; '));
  check('with every connection dead, pages seen before still draw within 1 s', [...results.frozen, ...results.frozenWithEvent, ...results.reset].every((r) => r.ms != null && r.ms < 1000 && r.state === 'content'), [...results.frozen, ...results.frozenWithEvent, ...results.reset].map(fmt).join('; '));
  check('offline: pages seen before still draw within 1 s', results.offline.every((r) => r.ms != null && r.ms < 1000 && r.state === 'content'), results.offline.map(fmt).join('; '));
  check('offline: reopening the app shows the last data', results.offlineReopen != null && results.offlineReopen < 3000, `${results.offlineReopen}`);
  check('offline: the page says it is showing saved data', /offline|saved|ago/i.test(results.offlineNote), `"${results.offlineNote}"`);
  check('back online: the live event stream reconnects', results.liveBackMs != null && results.liveBackMs < 15000, `${results.liveBackMs}`);
  check('back online: the offline note goes away', !/offline/i.test(results.noteAfter), `"${results.noteAfter}"`);
  check('no script errors', !results.pageErrors.length, results.pageErrors.join(' | '));
  await finish();
} catch (e) { await finish(e); }
