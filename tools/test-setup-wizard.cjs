#!/usr/bin/env node
/*
 * End-to-end test of the setup wizard WITH Home Assistant (tools/mock-ha.mjs), in headless Chromium.
 * Starts its own fresh CasaTorch and mock Home Assistant on free ports and cleans up after itself:
 *
 *   cd app && node build.mjs && cd .. && node tools/test-setup-wizard.cjs
 *
 * Covers: English welcome page with the tour card, location by coordinates, a validation error (missing
 * home name, short password), resume after a reload (and the password asked again before Finish), a
 * phone login, Home Assistant with an address tidied by CasaTorch, integrations added through Home
 * Assistant's own setup (Ring sign-in, Hue already there, the power company with a wrong password then a
 * verification code), review, Finish with the phone pairing QR code, then signing in to the dashboard.
 * Options: BASE=http://... HA=http://... to use servers already running; SHOTS=<dir> for screenshots
 * (default <temp>/casatorch-test-results); TEST_PORT_BASE=18290 to pick ports from there; KEEP_TEST_DATA=1.
 */
'use strict';
const L = require('./test-e2e-lib.cjs');

const PW = 'Lantern-harbor-42', PHONE_PW = 'Phone-pass-1234';
const { check, finish } = L.runner('setup wizard (with Home Assistant)');
let page, shot;

(async () => {
  const cas = process.env.BASE ? { base: process.env.BASE.replace(/\/$/, '') } : await L.startCasaTorch({ name: 'wizard' });
  const ha = process.env.HA ? { base: process.env.HA.replace(/\/$/, '') } : await L.startMockHa();
  const browser = await L.launchBrowser();
  const s = await L.newEnglishPage(browser); page = s.page; shot = L.shooter(page, 'wizard');
  const p = page, B = cas.base;
  const next = () => p.locator('#next').click();
  const msg = async () => (await p.locator('#navmsg').textContent()) || '';
  const btn = (n) => p.locator('main').getByRole('button', { name: n, exact: true });
  const h1 = (t) => p.locator('main h1', { hasText: t }).waitFor();
  const field = (label, scope = 'main') => L.field(p, label, scope);
  const nextTo = async (title) => { await next(); await h1(title); };

  // Welcome: English, tour card, where the home is
  await p.goto(`${B}/setup.html`); await h1('Welcome to CasaTorch');
  check('wizard opens in English', (await p.locator('select[aria-label="Language"]').inputValue()) === 'en');
  check('welcome page has the "See what\'s possible" tour card', await p.locator('.tour-card').count() === 1);
  await p.getByPlaceholder('Town, ZIP code, or latitude, longitude').fill('47.6062, -122.3321');
  await p.locator('main').getByRole('button', { name: 'Find', exact: true }).first().click();
  await p.locator('main .ok', { hasText: '47.6062' }).waitFor();
  check('location by coordinates is accepted', true);
  await shot('01-welcome');

  // House: a validation error first
  await nextTo('Your home');
  await field('What should we call your home?').fill('');
  await next();
  check('missing home name is refused', /What should we call your home\?/.test(await msg()), await msg());
  await field('What should we call your home?').fill('Test Home');
  await shot('02-house');

  // Account: short password refused, then a good one
  await nextTo('Your CasaTorch login');
  await field('Username').fill('owner');
  await field('Password (10+ characters - a short sentence works well)').fill('short');
  await p.locator('main label.check input[type=checkbox]').check();
  await next();
  check('a password under 10 characters is refused', /at least 10 characters/.test(await msg()), await msg());
  await field('Password (10+ characters - a short sentence works well)').fill(PW);
  await nextTo('Your phone');

  // Resume after a reload: same step, a welcome-back note, answers kept
  await p.waitForTimeout(900);   // progress is saved 0.7 s after the last change
  await p.reload(); await h1('Your phone');
  check('reload resumes on the same step', true);
  check('resume shows "Welcome back"', /Welcome back/.test(await p.locator('#resume').innerText()));
  await btn('A login just for my phone (recommended)').click();
  await field('Your name').fill('Sam');
  await field('Phone login username').fill('samphone');
  await field('Phone login password').fill(PHONE_PW);
  await shot('03-phone');

  // The everyday steps: skipped (they would reach the internet), one example reminder
  await nextTo('Calendars'); await nextTo('Your teams'); await nextTo('Headlines'); await nextTo('Reminders');
  await btn('Example: trash night').click();
  await nextTo('Your Home AI Agent');
  await next();
  check('the AI step needs an answer', /Pick an answer/.test(await msg()), await msg());
  await btn('Not now').click();

  // Home Assistant: an address without http:// is tidied, then the connection works
  await nextTo('Home Assistant');
  await btn('Yes').click();
  await next();
  check('Home Assistant needs a working connection before Next', /is needed|Test connection/.test(await msg()), await msg());
  const haHost = ha.base.replace(/^https?:\/\//, '');
  await field('Home Assistant address').fill(haHost);
  await field('Long-lived access token').fill(L.HA_TOKEN);
  await btn('Test connection').click();
  await p.locator('main .ok', { hasText: 'Connected to Home Assistant' }).waitFor();
  const tidy = await p.locator('main', { hasText: 'We tidied the address for you' }).count();
  check('address is tidied (http:// added)', tidy === 1 && (await field('Home Assistant address').inputValue()).startsWith('http://'), await field('Home Assistant address').inputValue());
  await shot('04-ha');

  // Cameras: Ring through Home Assistant's own sign-in
  await nextTo('Cameras');
  await btn('Yes').click();
  await p.locator('main .opts .opt', { hasText: 'Ring (through Home Assistant)' }).click();
  await btn('Add to Home Assistant').click();
  await p.locator('.flow input').first().waitFor();
  await field('Username', '.flow').fill('me@example.com');
  await field('Password', '.flow').fill('x');
  await p.locator('.flow').getByRole('button', { name: 'Connect' }).click();
  await p.locator('main .ok', { hasText: 'Added to Home Assistant' }).waitFor();
  check('Ring added through Home Assistant', true);
  await shot('05-cameras');

  // Controls: Hue is already in Home Assistant
  await nextTo('Lights, locks and climate');
  await btn('Yes').click();
  await p.locator('main .opts .opt', { hasText: 'Philips Hue (through Home Assistant)' }).click();
  await p.locator('main .card .ok', { hasText: 'Already in Home Assistant' }).waitFor();
  check('Hue shows as already in Home Assistant', true);

  await nextTo('Sensors'); await btn('No').click();
  await nextTo('Network'); await btn('My internet provider\'s router').click();
  await nextTo('App tests'); await btn('Not now').click();

  // Energy: the power company's sign-in, wrong password first, then the verification code
  await nextTo('Energy'); await btn('Yes').click();
  await next();
  check('energy asks for the power company', /power company/.test(await msg()), await msg());
  await btn('Find my power company').click();
  await p.locator('.flow select').waitFor();
  await p.locator('.flow select').selectOption({ index: 0 });
  await field('Username', '.flow').fill('me@example.com');
  await field('Password', '.flow').fill('wrong');
  await p.locator('.flow').getByRole('button', { name: 'Connect' }).click();
  await p.locator('.flow .err', { hasText: 'Wrong username or password' }).waitFor();
  check('a wrong power-company password is shown', true);
  await field('Username', '.flow').fill('me@example.com');
  await field('Password', '.flow').fill('right');
  await p.locator('.flow').getByRole('button', { name: 'Connect' }).click();
  await field('Verification code', '.flow').fill('123456');
  await p.locator('.flow').getByRole('button', { name: 'Connect' }).click();
  await p.locator('main .ok', { hasText: 'connected through Home Assistant' }).waitFor();
  check('power company connected after the code', true);
  await field('Monthly power budget (optional)').fill('150');
  await shot('06-energy');

  await nextTo('Alerts');
  await nextTo('All set?');
  const rv = await p.locator('dl.review').innerText();
  check('review lists the home', rv.includes('Test Home'), rv.slice(0, 80));
  check('review lists the phone login', rv.includes('samphone'));
  check('review lists what was added to Home Assistant', /Ring|me@example\.com/.test(rv) && rv.includes('Connected to Home Assistant'));
  check('review has the tour card', await p.locator('.tour-card').count() === 1);
  await shot('07-review');

  // Finish: the password typed before the reload isn't kept, so it's asked again first
  await next();
  await h1('Your CasaTorch login');
  check('Finish asks for the password again after a reload', /Type the password again/.test(await msg()), await msg());
  await field('Password (10+ characters - a short sentence works well)').fill(PW);
  await p.locator('#progress button', { hasText: 'Review' }).click();
  await h1('All set?');
  await next();
  await h1('Now your phone');
  check('finish shows the pairing QR code', await p.locator('.pairbox .qr svg').count() === 1);
  check('finish shows a pairing code', ((await p.locator('.paircode').textContent()) || '').trim().length >= 6);
  await shot('08-pair');

  // Sign in afterwards
  await p.locator('#next', { hasText: 'Open my dashboard' }).click();
  await p.waitForURL(/login/);
  await p.locator('#u').fill('owner'); await p.locator('#p').fill(PW);
  await p.locator('button[type=submit]').click();
  await p.waitForURL((u) => !/login/.test(u.pathname));
  await p.locator('nav.nav').waitFor();
  check('owner signs in to the dashboard', !/login/.test(new URL(p.url()).pathname), p.url());
  await p.locator('.tour-offer').waitFor();
  check('the dashboard offers the tour', /look around/.test(await p.locator('.tour-offer').innerText()));
  await shot('09-dashboard');
  const st = await (await fetch(`${B}/api/setup/state`)).json();
  check('CasaTorch reports it is set up', st.configured === true && st.open === false, JSON.stringify(st));
  const phone = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ username: 'samphone', password: PHONE_PW }) });
  check('the phone login can sign in', phone.status === 200, `HTTP ${phone.status}`);
  check('no errors in the page', s.errors.length === 0, s.errors.join(' / '));
  await browser.close();
})().then(() => finish(), (e) => finish(e, () => shot?.('zz-failure')));
