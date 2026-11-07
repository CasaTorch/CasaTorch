#!/usr/bin/env node
/*
 * Text squeezed into a narrow column: every page, every Settings section and the main drawers and sheets of the demo,
 * at four screen sizes (1440x900, 1024x768, 768x1024, 390x844), dark and light. Flags any text that wraps one or two
 * words to a line (3+ lines with 2 words or fewer each, or 2 short lines in a narrow box beside wider content), any box
 * under 60 px wide whose text runs more than 3 lines down, any word broken letter by letter, and any name cut to a
 * few letters ("L..."). Also checks that switching pages lands at the top of the new page.
 * Screenshots of everything go to $SHOTS/layout/<size>-<theme>/ (default <temp>/casatorch-test-results).
 *
 *   cd app && node build.mjs && node test/layout-text-check.cjs
 *
 * Options: BASE=http://127.0.0.1:8090 (a demo already running - never a real house), LAYOUT_SIZES=1440x900,390x844,
 * LAYOUT_THEMES=dark, LAYOUT_ONLY=network,settings/help, LAYOUT_SHOTS=0 (no screenshots, faster), LAYOUT_JSON=<file>.
 * Runs on its own demo CasaTorch with its own data folder (it never touches real data). Exit code 1 if anything is
 * flagged. 3D Home is skipped (its 3D view has its own tests).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../tools/test-e2e-lib.cjs');

const SIZES = (process.env.LAYOUT_SIZES || '1440x900,1024x768,768x1024,390x844').split(',').map((s) => s.split('x').map(Number));
const THEMES = (process.env.LAYOUT_THEMES || 'dark,light').split(',');
const ONLY = (process.env.LAYOUT_ONLY || '').split(',').filter(Boolean);
const SHOTS = process.env.LAYOUT_SHOTS !== '0';
const OUT = path.join(process.env.SHOTS || path.join(require('node:os').tmpdir(), 'casatorch-test-results'), 'layout');
const SKIP_TABS = new Set(['house3d']);

/* In the page: every visible bit of text, and whether it's squeezed. Returns [{ where, text, why }]. */
function squeezed() {
  const out = [], seen = new Set();
  const name = (e) => { const p = []; for (let n = e, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) p.unshift(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${[...n.classList].slice(0, 2).map((c) => `.${c}`).join('')}`); return p.join(' > '); };
  const hiddenUp = (e) => { for (let n = e; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true; } return false; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const tn = w.currentNode, text = tn.textContent.replace(/\s+/g, ' ').trim();
    if (text.length < 4) continue;
    const e = tn.parentElement; if (!e || seen.has(e)) continue;
    if (e.closest('svg, script, style, select, option, textarea, pre, code, .view-next, [aria-hidden="true"], .sr-only, .visually-hidden')) continue;
    const r = document.createRange(); r.selectNodeContents(tn);
    const b = e.getBoundingClientRect(); if (b.width === 0 || b.height === 0) continue;
    const rects = [...r.getClientRects()].filter((x) => x.width > 0.5 && x.height > 0.5 && x.top < b.bottom - 2);   // lines a clamp hides don't count
    if (!rects.length) continue;
    if (hiddenUp(e)) continue;
    const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.35;
    const tops = []; for (const x of rects) if (!tops.some((t) => Math.abs(t - x.top) < lh * 0.5)) tops.push(x.top);
    const lines = tops.length, words = text.split(' ').length, widest = Math.max(...rects.map((x) => x.width));
    let why = null;
    const cut = cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1;
    if (cut && e.clientWidth < 48 && text.length >= 4) why = `cut to ${Math.round(e.clientWidth)} px ("${text.slice(0, 3)}...")`;
    else     if (lines >= 3 && words / lines <= 2 && words >= 3) why = `${lines} lines of ${(words / lines).toFixed(1)} words`;
    else if (b.width < 60 && b.height > 3 * lh && text.length >= 6) why = `${Math.round(b.width)} px wide, ${Math.round(b.height / lh)} lines high`;
    else if (lines === 2 && words >= 2 && words <= 4 && text.length >= 10 && b.width < 110 && (e.parentElement?.getBoundingClientRect().width || 0) > 2.5 * b.width && !e.closest('.nav, .rail')) why = `2 short lines in a ${Math.round(b.width)} px box beside wider content`;
    else if (lines >= 2 && widest < 40 && b.width < 60 && text.replace(/\s/g, '').length >= 8) why = `broken letter by letter (${lines} lines, ${Math.round(widest)} px)`;
    if (why) { seen.add(e); out.push({ where: name(e), text: text.slice(0, 70), why }); }
  }
  return out;
}

(async () => {
  let failed = false;
  const found = [];
  try {
    const srv = process.env.BASE ? { base: process.env.BASE.replace(/\/$/, '') } : await L.startCasaTorch({ name: 'layout', env: { CASATORCH_DEMO: '1' } });
    const health = await (await fetch(`${srv.base}/api/setup/state`)).json();
    if (!health.demo) throw new Error('this check runs on a demo CasaTorch only (CASATORCH_DEMO=1)');
    const browser = await L.launchBrowser();
    for (const [W, H] of SIZES) for (const theme of THEMES) {
      const tag = `${W}x${H}-${theme}`, dir = path.join(OUT, tag);
      if (SHOTS) fs.mkdirSync(dir, { recursive: true });
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: theme, locale: 'en-US', timezoneId: 'America/Los_Angeles', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }, reducedMotion: 'reduce' });
      await ctx.addInitScript(() => { try { localStorage.setItem('casatorch-tour', 'done'); localStorage.setItem('casatorch-whatsnew', '9.9.9'); } catch { /* fine */ } });
      const p = await ctx.newPage(), errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(`${srv.base}/#home`, { waitUntil: 'load' });
      await p.waitForFunction(() => typeof TABS !== 'undefined' && document.querySelector('#view > :not(.view-next)'), null, { timeout: 30000 });
      const setTheme = () => p.evaluate((mode) => { S.ui.theme = mode; if (typeof LOOK !== 'undefined' && LOOK.cat) LOOK.cat.look = { ...(LOOK.cat.look || {}), theme: mode === 'light' ? 'daylight' : 'midnight' }; applyUi(); }, theme);
      await setTheme();
      const settle = async () => {
        await p.waitForFunction(() => !document.querySelector('#view .view-next, #view .skel, .dr-skel, .set-pane .card.skeleton'), null, { timeout: 15000 }).catch(() => {});
        await p.waitForTimeout(700);
      };
      const look = async (name) => {
        await settle();
        const hits = await p.evaluate(squeezed);
        for (const h of hits) found.push({ size: tag, page: name, ...h });
        if (SHOTS) await p.screenshot({ path: path.join(dir, `${name.replace(/[^\w-]+/g, '_')}.png`), fullPage: true }).catch(() => {});
      };
      const go = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); };
      const want = (n) => !ONLY.length || ONLY.includes(n);
      const tabs = (await p.evaluate(() => TABS.map((t) => t.id))).filter((id) => !SKIP_TABS.has(id));
      const sections = await p.evaluate(() => Object.keys(SET_GROUP));
      for (const id of tabs) {
        if (want(id)) { await go(`#${id}`); await look(id); }
        if (id === 'settings') for (const k of sections) if (want(`settings/${k}`)) { await go(`#settings/${k}`); await look(`settings-${k}`); }
      }
      /* the main drawers and sheets */
      const drawers = [['network', 'net-apptests'], ['home', null], ['energy', null], ['network', null], ['security', null]];
      for (const [pg, tile] of drawers) {
        const name = `drawer-${pg}-${tile || 'first'}`; if (!want(name)) continue;
        if (tile) await go(`#${pg}?tile=${tile}`);
        else { await go(`#${pg}`); await settle(); const t = p.locator('#view section.tile').first(); if (!(await t.count())) continue; await t.click({ position: { x: 30, y: 12 } }).catch(() => {}); }
        await p.waitForSelector('.drawer, .dr', { timeout: 8000 }).catch(() => {});
        await look(name);
        if (tile === 'net-apptests' && want('sheet-apptest')) {
          const steam = p.locator('.dr-body').getByText('Steam', { exact: true }).first();
          if (await steam.count()) { await steam.click(); await p.waitForSelector('#modal .pv', { timeout: 10000 }).catch(() => {}); await look('sheet-apptest-steam');
            const box = await p.evaluate(() => { const b = document.querySelector('#modal .box'); return b ? b.scrollWidth - b.clientWidth : 0; });
            if (box > 2) found.push({ size: tag, page: 'sheet-apptest-steam', where: '#modal .box', text: '', why: `the sheet scrolls sideways by ${box} px` });
            await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
        }
        await p.keyboard.press('Escape'); await p.waitForTimeout(300);
        await p.evaluate(() => { document.querySelector('#modal')?.remove(); });
      }
      if (want('sheet-more') && W <= 760) { await go('#home'); await settle(); const more = p.locator('.nav a[title="More"]'); if (await more.count()) { await more.click(); await look('sheet-more'); await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelector('#modal')?.remove()); } }
      /* switching pages lands at the top (the window, and whatever box scrolls the page) */
      if (!ONLY.length) for (const [from, to] of [['home', 'settings'], ['network', 'energy'], ['settings/alerts', 'controls']]) {
        await go(`#${from}`); await settle();
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await go(`#${to}`); await settle();
        const y = await p.evaluate(() => Math.max(window.scrollY, document.querySelector('.main')?.scrollTop || 0));
        if (y > 2) found.push({ size: tag, page: to, where: 'window', text: '', why: `opened ${Math.round(y)} px down after switching from ${from}` });
      }
      if (errs.length) { failed = true; console.error(`  FAIL ${tag}: page errors: ${errs.slice(0, 3).join(' | ')}`); }
      await ctx.close();
      console.log(`  ${tag}: ${found.filter((f) => f.size === tag).length} flagged`);
    }
    await browser.close();
  } catch (e) { failed = true; console.error(`  FAIL ${e.stack || e.message}`); }
  if (process.env.LAYOUT_JSON) fs.writeFileSync(process.env.LAYOUT_JSON, JSON.stringify(found, null, 1));
  for (const f of found) console.error(`  squeezed  ${f.size}  ${f.page}  ${f.where}  "${f.text}"  (${f.why})`);
  if (found.length) failed = true;
  console.log(found.length ? `\n${found.length} places with squeezed text` : '\nno squeezed text');
  if (SHOTS) console.log(`screenshots: ${OUT}`);
  await L.shutdown(failed);
  process.exit(failed ? 1 : 0);
})();
