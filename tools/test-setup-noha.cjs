// End-to-end test of the setup wizard WITHOUT Home Assistant: the everyday
// steps, direct gear (snapshot camera, Shelly), then sign-in and the dashboard.
//   (cd app && HOUSEOS_DATA_DIR=/tmp/hos PORT=18091 node server.js) &  ;  node tools/test-setup-noha.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const shot = async (n) => p.screenshot({ path: `${process.env.SHOTS || '/tmp'}/${n}.png`, fullPage: true });
  const next = () => p.getByRole('button', { name: /^(Next|Set up my home|Finish)$/ }).click();
  const btn = (n) => p.getByRole('button', { name: n, exact: true });
  const msg = async () => (await p.locator('#navmsg').textContent()) || '';
  await p.goto('http://localhost:18091/'); await p.waitForSelector('h1'); await shot('n01-welcome'); await next();
  await p.getByLabel('What should we call your home?').fill('Test Home');
  await p.getByPlaceholder(/latitude/).fill('47.6062, -122.3321'); await btn('Find').click(); await p.waitForSelector('text=47.6062');
  await shot('n02-house'); await next();
  await p.getByLabel('Password (8+ characters)').fill('longenough1'); await next();
  await btn('Add a calendar').click(); await next(); console.log('empty calendar msg:', await msg());
  await p.getByLabel('Private iCal link').fill('https://example.com/cal.ics'); await shot('n03-calendars'); await next();
  await shot('n04-sports'); await next();
  await p.waitForSelector('text=NPR'); await btn('NPR').click(); await shot('n05-news'); await next();
  await btn('Example: trash night').click(); await shot('n06-reminders'); await next();
  await btn('No - use HouseOS on its own').click(); await shot('n07-ha'); await next();
  await btn('Yes').click(); await shot('n08-cameras-list');
  console.log('camera options:', (await p.locator('.opts .opt').allTextContents()).join(' | '));
  await p.getByRole('button', { name: /^Any camera with a snapshot address/ }).click();
  await next(); console.log('camera msg:', await msg());
  await p.getByLabel('Camera name').fill('Back yard'); await p.getByLabel('Snapshot address').fill('http://192.0.2.10/snap.jpg'); await shot('n09-cameras'); await next();
  await btn('Yes').click(); console.log('control options:', (await p.locator('.opts .opt').nth(1).locator('xpath=..').locator('.opt').allTextContents()).join(' | '));
  await p.getByRole('button', { name: /^Philips Hue/ }).click(); await p.getByRole('button', { name: /^Shelly/ }).click();
  await p.getByLabel('Each Shelly\'s IP address').fill('192.0.2.40 192.0.2.41'); await shot('n10-controls'); await next();
  await btn('No').click(); await next();
  await btn('My internet provider\'s router').click(); await next();
  await btn('Yes').click(); await p.getByLabel(/Price per kWh/).fill('0.17'); await shot('n11-energy'); await next();
  await next(); await shot('n12-review');
  await next(); await p.waitForURL(/login/); console.log('after finish:', p.url());
  await p.locator('#u').fill('admin'); await p.locator('#p').fill('longenough1'); await p.locator('button[type=submit]').click();
  await p.waitForSelector('.tile'); await p.waitForTimeout(800); await shot('n13-home');
  await p.goto('http://localhost:18091/#settings'); await p.waitForSelector('h2:has-text("Connected")'); await shot('n14-settings');
  await p.goto('http://localhost:18091/#cameras'); await p.waitForSelector('.cam', { timeout: 10000 }); console.log('cameras tab:', await p.locator('.cam .cap span:first-child').allTextContents());
  console.log(errs.length ? `page errors: ${errs.join(' / ')}` : 'no page errors'); await b.close();
})();
