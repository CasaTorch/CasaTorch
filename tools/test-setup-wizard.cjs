// End-to-end test of the setup wizard against tools/mock-ha.mjs. Needs Playwright:
//   node tools/mock-ha.mjs 18123 &  ;  (cd app && HOUSEOS_DATA_DIR=/tmp/hos PORT=18091 node server.js) &
//   npx -y playwright@1.56.1 install chromium  ;  node tools/test-setup-wizard.cjs

const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }).catch(() => chromium.launch());
  const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const shot = async (n) => p.screenshot({ path: `${process.env.SHOTS || '/tmp'}/${n}.png`, fullPage: true });
  const next = () => p.getByRole('button', { name: /^(Next|Set up my home|Finish)$/ }).click();
  const btn = (n) => p.getByRole('button', { name: n, exact: true });
  await p.goto('http://localhost:18091/'); await p.waitForSelector('h1'); await shot('01-welcome');
  await next();                                   // house
  await p.getByLabel('What should we call your home?').fill('Test Home'); await shot('02-house'); await next();
  await p.getByLabel('Password (8+ characters)').fill('short'); await next();
  console.log('short pw msg:', await p.locator('#navmsg').textContent());
  await p.getByLabel('Password (8+ characters)').fill('longenough1'); await p.getByLabel(/PIN/).fill('1234'); await next();
  await btn('Yes').click(); await next(); console.log('no-test msg:', await p.locator('#navmsg').textContent());
  await p.getByLabel('Home Assistant address').fill('http://localhost:18123'); await p.getByLabel('Long-lived access token').fill('test-token');
  await btn('Test connection').click(); await p.waitForSelector('.ok'); console.log('HA:', await p.locator('.ok').first().textContent()); await shot('03-ha'); await next();
  // cameras: yes, Ring
  await btn('Yes').click(); await p.getByRole('button', { name: /^Ring/ }).click();
  await btn('Add to Home Assistant').click(); await p.waitForSelector('.flow input');
  await p.getByLabel('Username').fill('me@example.com'); await p.getByLabel('Password').fill('x'); await shot('04-ring-form');
  await btn('Connect').click(); await p.waitForSelector('text=Added to Home Assistant'); console.log('ring:', await p.locator('.card .ok').first().textContent()); await shot('05-cameras'); await next();
  // controls: yes, Hue (already set up) 
  await btn('Yes').click(); await p.getByRole('button', { name: /^Philips Hue/ }).click(); console.log('hue:', await p.locator('.card .ok').first().textContent()); await next();
  await btn('No').click(); await next();          // sensors
  await btn('UniFi (Ubiquiti)').click(); await shot('06-network'); await btn('My internet provider\'s router').click(); await next();
  // energy
  await btn('Yes').click(); await next(); console.log('energy msg:', await p.locator('#navmsg').textContent());
  await btn('Find my power company').click(); await p.waitForSelector('.flow select');
  console.log('utilities:', (await p.locator('.flow select option').allTextContents()).join(' | '));
  await p.locator('.flow select').selectOption({ index: 0 }); await p.getByLabel('Username').fill('me@example.com'); await p.getByLabel('Password').fill('wrong');
  await shot('07-utility'); await btn('Connect').click(); await p.waitForSelector('.flow .err:has-text("Wrong")'); console.log('wrong pw shown');
  await p.getByLabel('Username').fill('me@example.com'); await p.getByLabel('Password').fill('right'); await btn('Connect').click();
  await p.waitForSelector('text=Verification code'); await shot('08-code'); await p.getByLabel(/Verification code/).fill('123456'); await btn('Connect').click();
  await p.waitForSelector('text=connected through Home Assistant'); console.log('utility:', await p.locator('.card .ok').first().textContent());
  await p.getByLabel(/budget/).fill('150'); await shot('09-energy'); await next();
  await btn('Yes').click(); await p.getByLabel('Its address').fill('192.168.1.10'); await btn('Get the install command').click(); await p.waitForSelector('pre'); await shot('10-servers'); await next();
  await shot('11-alerts'); await next();
  await p.waitForSelector('dl.review'); await shot('12-review'); console.log('review:', (await p.locator('dl.review').innerText()).replace(/\n/g, ' / '));
  await next(); await p.waitForURL('http://localhost:18091/'); await p.waitForTimeout(500); console.log('landed on:', p.url(), await p.locator('h1').textContent());
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
