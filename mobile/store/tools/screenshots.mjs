#!/usr/bin/env node
/* Store screenshots for the App Store and Google Play, made from the real product.

     node mobile/store/tools/screenshots.mjs                 every device
     node mobile/store/tools/screenshots.mjs --only=ios/iphone-6.9,android/phone
     node mobile/store/tools/screenshots.mjs --base=http://localhost:8090   use a demo CasaTorch that's already running

   What it does:
   1. Starts the CasaTorch demo (sample house, no real data) from app/server.js on a free port with a throwaway data
      folder - unless --base is given.
   2. Opens the real screens in Chromium at each device's size: the CasaTorch app pages from the demo, and the phone
      app's own screens (mobile/shell) with a stand-in for the phone side (window.CasaNative) that answers like a
      phone that found the demo house at 192.168.1.20.
      Two things are changed for the pictures, nothing else: the demo banner and the Home widgets that show
      third-party content (sample photos with their credits, real sports teams) are hidden, and the Cameras page gets
      a day of sample Frigate detections (the demo has no Frigate) with drawn thumbnails, not photos.
   3. Puts each screen in a plain device frame with a headline, and saves it to
      mobile/store/screenshots/<platform>/<size>/NN-name.png at the exact size each store asks for.

   Needs Node 18+ and Playwright with Chromium (npm i -D playwright && npx playwright install chromium). If Playwright
   lives somewhere else, set PLAYWRIGHT_MODULE (path to its index.mjs) and CHROMIUM_PATH. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '../..');
const REPO = path.resolve(MOBILE, '..');
const OUT = path.join(MOBILE, 'store/screenshots');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));

async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const t of tries) { try { return await import(t.startsWith('/') ? pathToFileURL(t).href : t); } catch { /* next */ } }
  throw new Error('Playwright not found: npm i -D playwright && npx playwright install chromium (or set PLAYWRIGHT_MODULE)');
}
const { chromium } = await loadPlaywright();
const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

/* ---------------------------------------------------------------- devices ----------------------------------------------------------------
   canvas: the exact pixel size the store wants. view: the screen in points / dp. bars: status bar and home indicator / navigation bar. */
const DEVICES = {
  'ios/iphone-6.9': { canvas: [1320, 2868], view: [440, 956], dpr: 3, os: 'ios', kind: 'phone', bars: [62, 34], island: true },
  'ios/iphone-6.5': { canvas: [1284, 2778], view: [414, 896], dpr: 3, os: 'ios', kind: 'phone', bars: [48, 34], island: true },
  'ios/ipad-13': { canvas: [2064, 2752], view: [1032, 1376], dpr: 2, os: 'ios', kind: 'tablet', bars: [24, 20] },
  'android/phone': { canvas: [1080, 1920], view: [412, 892], dpr: 3, os: 'android', kind: 'phone', bars: [32, 24], punch: true },
  'android/tablet-7': { canvas: [1920, 1080], view: [960, 600], dpr: 2, os: 'android', kind: 'tablet', bars: [26, 24] },
  'android/tablet-10': { canvas: [2560, 1440], view: [1280, 800], dpr: 2, os: 'android', kind: 'tablet', bars: [28, 26] },
};

/* ---------------------------------------------------------------- the shots ---------------------------------------------------------------- */
const SHOTS = [
  { n: '01', name: 'home', title: ['Your home,', { hi: 'lit up.' }], sub: 'Lights, climate, energy and your day, on one calm screen.', web: 'home' },
  { n: '02', name: '3d-home', pro: true, title: ['Your home', { hi: 'in 3D' }], sub: 'Every light, door and sensor, right where it is in the house.', web: 'house3d' },
  { n: '03', name: 'cameras', title: ['Every camera,', { hi: 'and what it saw' }], sub: 'Live views, plus people, cars and packages from Frigate.', web: 'cameras' },
  { n: '04', name: 'energy', title: ['See where the', { hi: 'power goes' }], sub: 'What\'s on now, what this month will cost, and the biggest users.', web: 'energy' },
  { n: '05', name: 'health', title: ['Knows it\'s', { hi: 'all working' }], sub: 'CasaTorch checks itself every 15 minutes and tells you when something breaks.', web: 'settings/health' },
  { n: '06', name: 'home-ai-agent', pro: true, title: ['Just', { hi: 'ask your home' }], sub: 'Answers from your own house. It never unlocks a door.', web: 'ask' },
  { n: '07', name: 'pairing', title: ['Pair in', { hi: 'seconds' }], sub: 'Scan the QR code from any screen that\'s signed in. No cloud account.', shell: 'welcome' },
  { n: '08', name: 'lock', title: ['Locked', { hi: 'to you' }], sub: { ios: 'Face ID guards your sign-in, and alerts are end-to-end encrypted.', android: 'Your fingerprint guards your sign-in, and alerts are end-to-end encrypted.' }, shell: 'lock' },
];

/* ---------------------------------------------------------------- demo server ---------------------------------------------------------------- */
let server = null, BASE = args.base && args.base !== true ? String(args.base).replace(/\/$/, '') : null;
async function startDemo() {
  const port = Number(args.port || process.env.PORT || 18300);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'casatorch-store-'));
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(REPO, 'app'), env: { ...process.env, CASATORCH_DEMO: '1', CASATORCH_DATA_DIR: data, PORT: String(port) }, stdio: 'ignore' });
  BASE = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/app/hello`); if (r.ok) return; } catch { /* starting */ } await sleep(500); }
  throw new Error('The demo server didn\'t start (is the port free? try --port=...)');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- sample detections ----------------------------------------------------------------
   The demo house has no Frigate, so the Cameras page gets a day of sample events in Frigate's own format. The
   thumbnails are drawn (a night yard and a shape), in the same style as the demo's camera pictures. */
let DETS = null;
function sampleDetections() {
  if (DETS) return DETS;   // once per run, so the thumbnails match the list
  const now = Date.now(), min = 60_000;
  const ev = [[6, 'porch', 'package', 91], [24, 'driveway', 'car', 88], [41, 'porch', 'person', 94], [78, 'backyard', 'dog', 83], [115, 'driveway', 'person', 90], [170, 'garage', 'car', 86],
    [230, 'backyard', 'cat', 77], [300, 'porch', 'person', 92], [380, 'driveway', 'car', 89], [460, 'backyard', 'person', 81]];
  const recent = ev.map(([ago, camera, label, score], i) => ({ id: `0:${Math.round((now - ago * min) / 1000)}.${i}-demo`, camera, label, subLabel: null, score,
    start: new Date(now - ago * min).toISOString(), end: new Date(now - ago * min + (20 + i * 7) * 1000).toISOString(), zones: camera === 'porch' ? ['front_steps'] : [], snapshot: true, clip: true }));
  const byHour = [0, 0, 1, 0, 0, 0, 1, 3, 5, 4, 2, 3, 4, 2, 3, 5, 6, 8, 7, 5, 4, 2, 1, 0];
  const byLabel = { person: 17, car: 14, package: 5, dog: 6, cat: 4 }, byCamera = { driveway: 19, porch: 15, backyard: 9, garage: 3 };
  return (DETS = { frigate: true, hours: 24, total: 46, byLabel, byCamera, byHour, recent, errors: [], at: new Date(now).toISOString() });
}
function thumbSvg(label, seed) {
  const sky = ['#1e3a5f', '#25406a', '#1b3358'][seed % 3];
  const shape = {
    person: '<circle cx="88" cy="40" r="9" fill="#d6dbe6"/><path d="M75 92V62q0-12 13-12t13 12v30z" fill="#d6dbe6"/>',
    car: '<path d="M44 86V72l12-14h52l14 14v14z" fill="#d6dbe6"/><circle cx="62" cy="88" r="8" fill="#0b1020"/><circle cx="104" cy="88" r="8" fill="#0b1020"/>',
    package: '<rect x="70" y="62" width="34" height="28" rx="2" fill="#c9a26b"/><path d="M70 72h34" stroke="#8a6a3d" stroke-width="3"/>',
    dog: '<path d="M58 86V70q0-8 10-8h30l8-10 6 4-4 10v20h-8V76H70v10z" fill="#d6dbe6"/>',
    cat: '<path d="M74 88V70q0-10 10-10h12l4-8 4 8v28z" fill="#d6dbe6"/>',
  }[label] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110"><rect width="160" height="110" fill="${sky}"/><rect y="78" width="160" height="32" fill="#2f5a34"/><path d="M8 78V48l26-20 26 20v30z" fill="#7a4b33" opacity=".7"/>${shape}<rect x="${label === 'car' ? 38 : label === 'package' ? 64 : 66}" y="${label === 'person' ? 26 : 50}" width="${label === 'car' ? 90 : label === 'package' ? 46 : 46}" height="${label === 'person' ? 70 : 44}" fill="none" stroke="#fbbf24" stroke-width="2.5" rx="3"/></svg>`;
}

/* ---------------------------------------------------------------- capturing ---------------------------------------------------------------- */
const HIDE_CSS = '#banner{display:none!important}';
async function webContext(browser, d) {
  const ctx = await browser.newContext({ viewport: { width: d.view[0], height: d.view[1] }, deviceScaleFactor: d.dpr, isMobile: d.kind === 'phone', hasTouch: true, colorScheme: 'dark', timezoneId: 'America/Los_Angeles', locale: 'en-US',
    userAgent: d.os === 'ios' ? undefined : 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36' });
  await ctx.addInitScript(() => { try { localStorage.setItem('casatorch-tour', 'done'); } catch { /* fine */ } });
  await ctx.addInitScript({ content: nativeStub(d.os) });   // the page runs as it does inside the app (html.in-app)
  await ctx.route('**/api/frigate/events?*', (r) => r.fulfill({ json: sampleDetections() }));
  await ctx.route('**/api/frigate/events/*/*/*', (r) => { const id = decodeURIComponent(r.request().url().split('/').slice(-2)[0]); const ev = sampleDetections().recent.find((e) => e.id.endsWith(id)) || { label: 'person' }; return r.fulfill({ contentType: 'image/svg+xml', body: thumbSvg(ev.label, parseInt(id.split('.')[1], 10) || 0) }); });
  return ctx;
}
/* Chromium has no notch: the phone's safe areas (status bar, home indicator), as the app's own CSS would get them. */
const insetCss = (d) => {
  const [t, b] = d.bars;
  return `html.in-app .main{padding-top:max(16px,${t + 4}px)!important}
  @media (max-width:760px){html.in-app .rail{padding-bottom:max(8px,${b}px)!important}html.in-app .main{padding-bottom:calc(88px + ${b}px)!important}}
  @media (min-width:761px){html.in-app .rail{padding-top:${t + 6}px!important}}`;
};
async function openWeb(ctx, route, d) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.warn(`  page error (${route}): ${e.message}`));
  await p.goto(`${BASE}/#${route}`, { waitUntil: 'load' });
  await p.addStyleTag({ content: HIDE_CSS + insetCss(d) });
  await sleep(3000);
  await p.evaluate(() => { for (const t of document.querySelectorAll('section.tile')) if (Object.values(t.dataset).some((v) => ['sports', 'photos', 'calendar'].includes(v))) t.remove(); });
  return p;
}
const WEB_ACTIONS = {
  async house3d(p) { await sleep(4500); },
  async cameras(p, d) {
    await p.waitForSelector('.card.det .detrow', { timeout: 10000 }).catch(() => {});
    await sleep(1500);
    // phones: the last camera and the detections under it; tablets: the camera grid with the detections below
    await p.evaluate(([phone, top]) => {
      const det = document.querySelector('.card.det'), cams = [...document.querySelectorAll('.cams .cam')]; if (!det || !cams.length) return;
      const abs = (e) => e.getBoundingClientRect().top + scrollY;
      // phone: the last camera, then the detections; tall tablet: the grid and the detections; wide tablet: half and half
      const y = phone ? abs(cams[cams.length - 1]) - top - 14 : innerHeight > innerWidth ? abs(cams[0]) - top - 14 : abs(det) - innerHeight * 0.42;
      scrollTo(0, Math.max(0, y));
    }, [d.kind === 'phone', d.bars[0]]);
    await sleep(800);
  },
  async ask(p) {
    // typed, like a person would: the same demo answers as the suggestion buttons
    const box = p.locator('main input[placeholder^="Ask"], main textarea[placeholder^="Ask"]').first();
    for (const q of ['Which lights are on?', 'What\'s using the most power?']) { await box.fill(q); await box.press('Enter'); await sleep(3500); }
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
  },
  async 'settings/health'(p) { await p.waitForSelector('text=Everything is working', { timeout: 10000 }).catch(() => {}); await sleep(800); },
};

/* The phone side, for the app's own screens: a phone that found the demo house at 192.168.1.20. */
function nativeStub(os) {
  return `(() => {
    const ok = (v) => Promise.resolve(v);
    const hello = { casatorch: true, appMin: '0.7.0', home: { id: 'demo', name: 'Demo House', version: '0.8.0' }, signIn: true, configured: true, secure: null };
    window.CasaNative = Object.freeze({ platform: '${os}', version: '0.8.0', device: '${os === 'ios' ? 'iPhone' : 'Pixel'}', hasLidar: false,
      haptic() {}, fullscreen() {}, share: () => ok(), openExternal() {},
      biometrics: () => ok({ available: true, enabled: false, type: '${os === 'ios' ? 'faceID' : 'fingerprint'}' }), setBiometricLock: () => ok(true),
      pushEnable: () => ok({}), lidar: () => ok(false), scanRoom: () => ok(null),
      homes: () => ok([]), saveHome: () => ok(true), openHome() {}, removeHome: () => ok(true), switchHome() {}, signOut() {},
      scanQR: () => new Promise(() => {}), deviceInfo: () => ok({ name: 'Phone', platform: '${os}' }), copy: () => ok(true),
      probe: (o) => /192\\.168\\.1\\.20:8090/.test(o.url) ? ok({ status: 200, json: hello }) : ok({ error: 'dns' }),
      discover: () => ok(['http://192.168.1.20:8090']) });
  })();`;
}
async function captureShell(browser, d, which) {
  const ctx = await browser.newContext({ viewport: { width: d.view[0], height: d.view[1] }, deviceScaleFactor: d.dpr, isMobile: d.kind === 'phone', hasTouch: true, colorScheme: 'dark', locale: 'en-US' });
  await ctx.addInitScript({ content: nativeStub(d.os) });
  await ctx.route('https://casatorch.com/**', (r) => r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { found: [] } }));
  await ctx.route('http://192.168.1.20:8090/api/app/claim', (r) => r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { token: 'sample', home: { id: 'demo', name: 'Demo House', addresses: { lan: 'http://192.168.1.20:8090' } }, user: { name: 'Owner', role: 'owner' } } }));
  const p = await ctx.newPage();
  const file = pathToFileURL(path.join(MOBILE, 'shell/index.html')).href;
  const hash = which === 'lock' ? `#pair=${encodeURIComponent('casatorch://pair?v=1&c=SAMPLE&n=Demo%20House&l=http%3A%2F%2F192.168.1.20%3A8090')}` : `#${which}`;
  await p.goto(file + hash);
  // the shell's CSP allows no inline styles, so the safe areas are set through the DOM
  await p.evaluate(([t, b]) => { const a = document.getElementById('app'); a.style.paddingTop = `max(1.5rem, ${t + 8}px)`; a.style.paddingBottom = `max(1.5rem, ${b + 8}px)`; }, d.bars);
  await sleep(which === 'lock' ? 1800 : 900);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  const png = await p.screenshot();
  await ctx.close();
  return png;
}

async function captureAll(browser, key, d) {
  const out = {};
  const ctx = await webContext(browser, d);
  for (const s of SHOTS) {
    if (s.shell) { out[s.n] = await captureShell(browser, d, s.shell); continue; }
    const p = await openWeb(ctx, s.web, d);
    if (WEB_ACTIONS[s.web]) await WEB_ACTIONS[s.web](p, d);
    out[s.n] = await p.screenshot({ timeout: 180000 });   // the 3D home renders in software here: big screens take a while
    await p.close();
  }
  await ctx.close();
  return out;
}

/* ---------------------------------------------------------------- the marketing frame ---------------------------------------------------------------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICONS = {
  signal: '<svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>',
  wifi: '<svg viewBox="0 0 16 12"><path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4C5.1.4 2.5 1.5.5 3.4l1.2 1.3A9 9 0 0 1 8 2.2zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7.1 7.1 0 0 0 8 4c-1.9 0-3.6.7-4.9 1.9l1.2 1.3c1-.9 2.3-1.4 3.7-1.4zM8 9.4c-.6 0-1.1.2-1.5.6L8 11.6 9.5 10c-.4-.4-.9-.6-1.5-.6z"/></svg>',
  battery: '<svg viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="18" height="9" rx="2"/><path d="M25 4.5v4c.8-.3 1.4-1 1.4-2s-.6-1.7-1.4-2z" opacity=".45"/></svg>',
  abattery: '<svg viewBox="0 0 12 18"><rect x="3.5" y="0" width="5" height="2" rx="1"/><rect x="0.5" y="1.5" width="11" height="16" rx="2.5"/></svg>',
  awifi: '<svg viewBox="0 0 18 14"><path d="M9 14 0 3.2A14 14 0 0 1 18 3.2z"/></svg>',
  asignal: '<svg viewBox="0 0 14 14"><path d="M14 0v14H0z"/></svg>',
};
const MARK = '<svg viewBox="0 0 64 64"><defs><linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#8b7bff"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="#0f172a"/><path d="M44 18.5A19 19 0 1 0 44 45.5" fill="none" stroke="url(#mk)" stroke-width="7.5" stroke-linecap="round"/><circle cx="45" cy="32" r="6.5" fill="#fbbf24"/></svg>';

function frameHtml(d, s, png, time) {
  const [W, H] = d.canvas, land = W > H, [vw, vh] = d.view, [top, bot] = d.bars;
  const unit = Math.min(W, H) / 100;                    // 1% of the short side
  const headH = land ? H * 0.245 : H * (d.kind === 'tablet' ? 0.19 : 0.215);
  // the device: as large as fits under the headline
  const bez = d.kind === 'tablet' ? 0.026 : 0.034;     // bezel, as a share of the screen width
  const availH = H - headH - (land ? H * 0.055 : H * 0.035), availW = W * (land ? 0.82 : d.kind === 'tablet' ? 0.86 : 0.8);
  const k = Math.min(availW / (vw * (1 + 2 * bez)), availH / (vh + vw * 2 * bez));   // canvas px per point
  const sw = vw * k, sh = vh * k, b = vw * bez * k;
  const dw = sw + 2 * b, dh = sh + 2 * b, dx = (W - dw) / 2, dy = headH + (H - headH - dh) * (land ? 0.42 : 0.35);
  const outerR = (d.kind === 'tablet' ? 0.05 : d.os === 'ios' ? 0.15 : 0.11) * dw, innerR = Math.max(0, outerR - b);
  const sub = typeof s.sub === 'string' ? s.sub : s.sub[d.os];
  const title = s.title.map((t) => (typeof t === 'string' ? `<span>${esc(t)}</span>` : `<span class="hi">${esc(t.hi)}</span>`)).join(land ? ' ' : '<br>');
  const fsTitle = (land ? 6.4 : d.kind === 'tablet' ? 6.2 : 8.2) * unit, fsSub = (land ? 2.6 : d.kind === 'tablet' ? 2.55 : 3.6) * unit;
  const isIos = d.os === 'ios';
  const status = isIos
    ? `<div class="sb ios" style="height:${top}px"><b>${esc(time)}</b><span class="r">${ICONS.signal}${ICONS.wifi}${ICONS.battery}</span></div>`
    : `<div class="sb and" style="height:${top}px"><b>${esc(time)}</b><span class="r">${ICONS.awifi}${ICONS.asignal}${ICONS.abattery}</span></div>`;
  const notch = d.island ? `<div class="island" style="width:${vw * 0.285}px;height:${top * 0.58}px;top:${top * 0.17}px"></div>` : d.punch ? `<div class="punch" style="width:${top * 0.62}px;height:${top * 0.62}px;top:${top * 0.19}px"></div>` : '';
  const homebar = isIos ? `<div class="hb" style="width:${d.kind === 'tablet' ? vw * 0.3 : vw * 0.36}px"></div>` : `<div class="gb" style="width:${vw * 0.26}px"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  body{font-family:Inter,"Inter Display",system-ui,sans-serif;color:#f8fafc;-webkit-font-smoothing:antialiased;
    background:
      radial-gradient(${W * 0.75}px ${H * 0.32}px at 50% ${land ? -6 : -4}%, rgba(251,191,36,.30), rgba(251,191,36,.08) 45%, transparent 72%),
      radial-gradient(${W * 0.9}px ${H * 0.5}px at 50% ${dy / H * 100 + 40}%, rgba(94,184,255,.16), transparent 70%),
      radial-gradient(${W * 0.7}px ${H * 0.4}px at 110% 105%, rgba(139,123,255,.22), transparent 70%),
      linear-gradient(180deg,#0e1830 0%,#0a1224 45%,#05070d 100%)}
  .head{position:absolute;left:0;right:0;top:0;height:${headH}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${W * 0.07}px;gap:${unit * 1.3}px}
  .eyebrow{display:flex;align-items:center;gap:${unit * 1.1}px;font-size:${fsSub * 0.8}px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#fcd34d}
  .eyebrow svg{width:${fsSub * 1.25}px;height:${fsSub * 1.25}px;border-radius:${fsSub * .3}px}
  .pro{font-size:${fsSub * 0.7}px;letter-spacing:.12em;font-weight:800;color:#1a1204;background:linear-gradient(135deg,#fde68a,#fbbf24 55%,#f59e0b);padding:${fsSub * .18}px ${fsSub * .5}px;border-radius:999px}
  h1{font-family:"Inter Display",Inter,sans-serif;font-size:${fsTitle}px;line-height:1.02;font-weight:800;letter-spacing:-.025em}
  h1 .hi{background:linear-gradient(100deg,#fde68a 0%,#fbbf24 45%,#fb923c 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  h1,p.sub{text-wrap:balance}
  p.sub{font-size:${fsSub}px;line-height:1.3;color:#a9b4c8;font-weight:500;max-width:${land ? W * 0.7 : W * 0.86}px}
  .dev{position:absolute;left:${dx}px;top:${dy}px;width:${dw}px;height:${dh}px;border-radius:${outerR}px;
    background:linear-gradient(145deg,#2b3242,#141925 40%,#0b0f17);padding:${b}px;
    box-shadow:0 0 0 ${Math.max(2, b * 0.09)}px #3a4254 inset, 0 ${unit * 3}px ${unit * 9}px rgba(0,0,0,.55), 0 0 ${unit * 12}px rgba(94,184,255,.10)}
  .scr{position:relative;width:${sw}px;height:${sh}px;border-radius:${innerR}px;overflow:hidden;background:#05070d}
  .in{position:absolute;left:0;top:0;width:${vw}px;height:${vh}px;transform:scale(${k});transform-origin:0 0;display:flex;flex-direction:column}
  .in>img{position:absolute;left:0;top:0;display:block;width:${vw}px;height:${vh}px}
  .sb{position:absolute;left:0;right:0;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;color:#fff}
  .sb.ios{padding:${top * 0.12}px ${vw * 0.085}px 0 ${vw * 0.1}px;font:600 ${d.kind === 'tablet' ? 13 : 17}px/1 Inter,sans-serif}
  .sb.ios .r{display:flex;gap:6px;align-items:center}
  .sb.ios svg{height:${d.kind === 'tablet' ? 10 : 12}px;fill:#fff;color:#fff}
  .sb.and{padding:0 ${d.kind === 'tablet' ? 20 : 18}px;font:500 14px/1 Roboto,Inter,sans-serif}
  .sb.and .r{display:flex;gap:6px;align-items:center}
  .sb.and svg{height:13px;fill:#fff}
  .island,.punch{position:absolute;left:50%;transform:translateX(-50%);background:#000;border-radius:999px;z-index:2}
  .foot{position:absolute;left:0;right:0;bottom:0;height:${bot}px;z-index:1}
  .hb{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);height:5px;border-radius:3px;background:rgba(255,255,255,.85)}
  .gb{position:absolute;left:50%;bottom:${bot / 2 - 2}px;transform:translateX(-50%);height:4px;border-radius:2px;background:rgba(255,255,255,.75)}
  </style></head><body>
  <div class="head">
    ${s.n === '01' ? `<div class="eyebrow">${MARK}CasaTorch</div>` : s.pro ? `<div class="eyebrow"><span class="pro">PRO</span></div>` : ''}
    <h1>${title}</h1>
    <p class="sub">${esc(sub)}</p>
  </div>
  <div class="dev"><div class="scr"><div class="in" id="in">
    <img src="data:image/png;base64,${png.toString('base64')}">
    ${status}${notch}
    <div class="foot">${homebar}</div>
  </div></div></div>
  <script>/* the bars take the color of the screen's edge */</script>
  </body></html>`;
}

/* A scrolled page: the status bar gets the page's own background, so content under it is hidden as on the phone. */
async function edgeColors(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const at = (y) => { const d = x.getImageData(Math.round(img.width / 2), y, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
    const left = (y) => { const d = x.getImageData(2, y, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
    return [left(2), at(img.height - 2)];
  }, png.toString('base64'));
}

async function compose(browser, key, d, raws) {
  const [W, H] = d.canvas;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const dir = path.join(OUT, key);
  fs.mkdirSync(dir, { recursive: true });
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(new Date()).replace(/\s?[AP]M$/, '');
  for (const s of SHOTS) {
    const png = raws[s.n];
    await page.setContent(frameHtml(d, s, png, time), { waitUntil: 'load' });
    if (s.web === 'cameras') { const [topC] = await edgeColors(page, png); await page.evaluate((t) => { document.querySelector('.sb').style.background = t; }, topC); }   // content scrolled under it stays hidden, as on the phone
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(dir, `${s.n}-${s.name}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
    console.log(`  ${path.relative(REPO, file)}`);
  }
  await page.close();
}

/* ---------------------------------------------------------------- Play feature graphic (1024 x 500) ----------------------------------------------------------------
   From the Android phone captures: the brand on the left, the Home and 3D home screens on the right. */
async function featureGraphic(browser, d, raws) {
  const W = 1024, H = 500, page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const ph = (png, x, y, w, rot, z) => { const h = w * d.view[1] / d.view[0], b = w * 0.035; return `<div class="ph" style="left:${x}px;top:${y}px;width:${w + 2 * b}px;height:${h + 2 * b}px;padding:${b}px;border-radius:${w * 0.13}px;transform:rotate(${rot}deg);z-index:${z}"><img style="border-radius:${w * 0.1}px" src="data:image/png;base64,${png.toString('base64')}"></div>`; };
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box} html,body{width:${W}px;height:${H}px;overflow:hidden}
    body{font-family:Inter,sans-serif;color:#f8fafc;-webkit-font-smoothing:antialiased;position:relative;
      background:radial-gradient(520px 380px at 18% 30%,rgba(251,191,36,.26),transparent 70%),radial-gradient(560px 420px at 85% 110%,rgba(139,123,255,.30),transparent 70%),radial-gradient(500px 360px at 75% 0%,rgba(94,184,255,.18),transparent 70%),linear-gradient(160deg,#0f1a33,#070b16)}
    .txt{position:absolute;left:64px;top:0;bottom:0;width:470px;display:flex;flex-direction:column;justify-content:center;gap:16px}
    .brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:30px;letter-spacing:-.01em}
    .brand svg{width:56px;height:56px}
    h1{font-family:"Inter Display",Inter,sans-serif;font-size:62px;line-height:1.02;font-weight:800;letter-spacing:-.03em}
    h1 span{background:linear-gradient(100deg,#fde68a,#fbbf24 45%,#fb923c);-webkit-background-clip:text;background-clip:text;color:transparent}
    p{font-size:21px;line-height:1.35;color:#a9b4c8;font-weight:500;max-width:420px}
    .ph{position:absolute;background:linear-gradient(145deg,#2b3242,#141925 40%,#0b0f17);box-shadow:0 0 0 2px #3a4254 inset,0 24px 60px rgba(0,0,0,.6)}
    .ph img{display:block;width:100%;height:100%}
  </style></head><body>
    <div class="txt"><div class="brand">${MARK}CasaTorch</div><h1>Your home,<br><span>lit up.</span></h1><p>Your own CasaTorch on your phone.<br>No cloud account.</p></div>
    ${ph(raws['02'], 790, 60, 200, 6, 1)}${ph(raws['01'], 600, 40, 220, -4, 2)}
  </body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(MOBILE, 'store/google-play/feature-graphic-1024x500.png');
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
  console.log(`  ${path.relative(REPO, file)}`);
  await page.close();
}

/* ---------------------------------------------------------------- run ---------------------------------------------------------------- */
const only = args.only && args.only !== true ? String(args.only).split(',') : Object.keys(DEVICES);
try {
  if (!BASE) await startDemo();
  const browser = await chromium.launch({ executablePath: exe, args: ['--disable-background-networking', '--disable-component-update'] });
  for (const key of only) {
    const d = DEVICES[key]; if (!d) { console.warn(`unknown device ${key} (one of: ${Object.keys(DEVICES).join(', ')})`); continue; }
    console.log(`${key} (${d.canvas.join('x')})`);
    const raws = await captureAll(browser, key, d);
    await compose(browser, key, d, raws);
    if (key === 'android/phone') await featureGraphic(browser, d, raws);
  }
  await browser.close();
} finally {
  if (server) server.kill();
}
