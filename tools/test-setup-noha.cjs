#!/usr/bin/env node
/*
 * End-to-end test of the setup wizard WITHOUT Home Assistant, in headless Chromium. Starts its own fresh
 * CasaTorch and a tiny pretend camera (a snapshot address) on free ports, and cleans up after itself:
 *
 *   cd app && node build.mjs && cd .. && node tools/test-setup-noha.cjs
 *
 * Covers: the everyday steps with their validation errors (an empty calendar, a reminder without a name,
 * a camera without a name), resume after a reload mid-way, a camera address tidied by CasaTorch and
 * tested, direct gear (Shelly) instead of the "through Home Assistant" twins, energy by price per kWh,
 * review, Finish without a phone (straight to the dashboard and its tour), sign-in, and the camera
 * showing up on the dashboard. Options: BASE=http://... to use a server already running; SHOTS=<dir>;
 * TEST_PORT_BASE=18290; KEEP_TEST_DATA=1.
 */
'use strict';
const http = require('node:http');
const L = require('./test-e2e-lib.cjs');

const PW = 'Quiet-meadow-2026';
// The smallest valid JPEG: what a camera's snapshot address answers.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const { check, finish } = L.runner('setup wizard (without Home Assistant)');
let page, shot, camServer;

(async () => {
  const cas = process.env.BASE ? { base: process.env.BASE.replace(/\/$/, '') } : await L.startCasaTorch({ name: 'noha' });
  const camPort = await L.freePort();
  camServer = http.createServer((req, res) => { if (req.url.startsWith('/snap.jpg')) { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': JPEG.length }); res.end(JPEG); } else { res.writeHead(404); res.end(); } });
  await new Promise((ok) => camServer.listen(camPort, '127.0.0.1', ok));
  const browser = await L.launchBrowser();
  const s = await L.newEnglishPage(browser); page = s.page; shot = L.shooter(page, 'noha');
  const p = page, B = cas.base;
  const next = () => p.locator('#next').click();
  const msg = async () => (await p.locator('#navmsg').textContent()) || '';
  const btn = (n) => p.locator('main').getByRole('button', { name: n, exact: true });
  const h1 = (t) => p.locator('main h1', { hasText: t }).waitFor();
  const field = (label, scope = 'main') => L.field(p, label, scope);
  const nextTo = async (title) => { await next(); await h1(title); };

  await p.goto(`${B}/`);
  await p.waitForURL(/setup/);
  await h1('Welcome to CasaTorch');
  check('a new CasaTorch opens setup, in English', (await p.locator('select[aria-label="Language"]').inputValue()) === 'en');
  check('the tour card is on the welcome page', await p.locator('.tour-card').count() === 1);
  await p.getByPlaceholder('Town, ZIP code, or latitude, longitude').fill('40.7128, -74.006');
  await p.locator('main').getByRole('button', { name: 'Find', exact: true }).first().click();
  await p.locator('main .ok', { hasText: '40.7128' }).waitFor();

  await nextTo('Your home');
  await field('What should we call your home?').fill('Quiet House');
  await nextTo('Your CasaTorch login');
  await field('Username').fill('owner');
  await field('Password (10+ characters - a short sentence works well)').fill(PW);
  await next();
  check('the terms must be accepted', /agree to the Terms.* is needed/.test(await msg()), await msg());
  await p.locator('main label.check input[type=checkbox]').check();
  await nextTo('Your phone');
  await btn('Not now').click();

  // Calendars: an empty one is refused
  await nextTo('Calendars');
  await btn('Add a calendar').click();
  await next();
  check('an empty calendar is refused', /Paste a link for each calendar/.test(await msg()), await msg());
  await btn('Remove').click();
  await nextTo('Your teams'); await nextTo('Headlines'); await nextTo('Reminders');

  // Reminders: one without a name is refused
  await btn('Add a reminder').click();
  await next();
  check('a reminder without a name is refused', /Give each reminder a name/.test(await msg()), await msg());
  await field('Reminder').fill('Water the plants');
  await nextTo('Your Home AI Agent'); await btn('Not now').click();
  await nextTo('Home Assistant'); await btn('No - use CasaTorch on its own').click();

  // Cameras: a snapshot camera; resume after a reload in the middle of it
  await nextTo('Cameras'); await btn('Yes').click();
  await p.locator('main .opts .opt', { hasText: 'Any camera with a snapshot address' }).click();
  await next();
  check('a camera without a name is refused', /Camera name is needed/.test(await msg()), await msg());
  await field('Camera name').fill('Back yard');
  await field('Snapshot address').fill(`127.0.0.1:${camPort}/snap.jpg`);
  await p.waitForTimeout(900);   // saved 0.7 s after the last change
  await p.reload(); await h1('Cameras');
  check('reload resumes on the camera step with the answers kept', (await field('Camera name').inputValue()) === 'Back yard' && /Welcome back/.test(await p.locator('#resume').innerText()));
  await btn('Test connection').click();
  await p.locator('main .ok').first().waitFor();
  check('camera address tidied (http:// added)', (await field('Snapshot address').inputValue()) === `http://127.0.0.1:${camPort}/snap.jpg` && await p.locator('main', { hasText: 'We tidied the address for you' }).count() === 1, await field('Snapshot address').inputValue());
  await shot('01-cameras');

  // Controls: without Home Assistant the direct options show, not the "through Home Assistant" ones
  await nextTo('Lights, locks and climate'); await btn('Yes').click();
  const opts = await p.locator('main .opts .opt').allTextContents();
  check('direct Hue and Shelly are offered', opts.some((t) => t.startsWith('Philips Hue') && !t.includes('through Home Assistant')) && opts.some((t) => t.startsWith('Shelly') && !t.includes('through Home Assistant')));
  check('"through Home Assistant" twins are hidden', !opts.some((t) => /^(Philips Hue|Shelly) \(through Home Assistant\)/.test(t)), opts.join(' | '));
  await p.locator('main .opts .opt').filter({ hasText: /^Shelly/ }).first().click();
  await field('Each Shelly\'s IP address').fill('192.0.2.40 192.0.2.41');
  await shot('02-controls');

  await nextTo('Sensors'); await btn('No').click();
  await nextTo('Network'); await btn('My internet provider\'s router').click();
  await nextTo('Energy'); await btn('Yes').click();
  check('energy explains Home Assistant was skipped', await p.locator('main .warn', { hasText: 'Needs Home Assistant' }).count() === 1);
  await field('Price per kWh, if your company isn\'t listed').fill('0.17');
  await nextTo('Alerts');
  await nextTo('All set?');
  const rv = await p.locator('dl.review').innerText();
  check('review: home, no Home Assistant, the camera, the reminder', rv.includes('Quiet House') && /Home Assistant\s+not used/.test(rv) && rv.includes('Any camera with a snapshot address') && rv.includes('Water the plants'), rv.replace(/\n/g, ' / ').slice(0, 300));
  check('review has the tour card', await p.locator('.tour-card').count() === 1);
  await shot('03-review');

  // Finish (no phone): straight on to sign in, then the dashboard with its tour
  await next();
  await h1('Your CasaTorch login');   // the password typed before the reload isn't kept
  check('Finish asks for the password again after a reload', /Type the password again/.test(await msg()), await msg());
  await field('Password (10+ characters - a short sentence works well)').fill(PW);
  await p.locator('#progress button', { hasText: 'Review' }).click(); await h1('All set?');
  await next();
  await p.waitForURL(/login/);
  check('finish without a phone goes to sign-in', true);
  await p.locator('#u').fill('owner'); await p.locator('#p').fill('wrong-password-1'); await p.locator('button[type=submit]').click();
  await p.waitForFunction(() => /\S/.test(document.querySelector('#view .err, #view [role=alert]')?.textContent || ''));
  check('a wrong password is refused at sign-in', /login/.test(p.url()));
  await p.locator('#p').fill(PW); await p.locator('button[type=submit]').click();
  await p.locator('nav.nav').waitFor();
  check('owner signs in to the dashboard', !/login/.test(new URL(p.url()).pathname), p.url());
  await p.locator('.tour-offer').waitFor();
  check('the dashboard offers the tour', true);
  await shot('04-dashboard');
  const cams = await p.evaluate(async () => (await (await fetch('/api/devices')).json()));
  const names = JSON.stringify(cams);
  check('the snapshot camera is among the devices', names.includes('Back yard'), names.slice(0, 200));
  check('no errors in the page', s.errors.length === 0, s.errors.join(' / '));
  await browser.close();
})().then(() => { camServer?.close(); finish(); }, (e) => { camServer?.close(); finish(e, () => shot?.('zz-failure')); });
