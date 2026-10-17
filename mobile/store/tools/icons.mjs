#!/usr/bin/env node
/* App icons from the CasaTorch mark (the same arc and torch dot as app/public/favicon.svg, scaled 16x to 1024).

     node mobile/store/tools/icons.mjs

   Writes:
     ios/CasaTorch/Assets.xcassets/AppIcon.appiconset/icon-1024-dark.png    iOS 18 dark: the mark on transparent (iOS draws the dark backdrop)
     ios/CasaTorch/Assets.xcassets/AppIcon.appiconset/icon-1024-tinted.png  iOS 18 tinted: grayscale on black (iOS applies the tint)
     store/google-play/icon-512.png                                        Play Store listing icon (512 x 512, full square; Play rounds it)
   The Android launcher icons are vectors (res/drawable/ic_launcher_*.xml) and need no PNGs (minSdk 28). Needs Playwright,
   like screenshots.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pw; for (const t of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs'].filter(Boolean)) { try { pw = await import(t.startsWith('/') ? pathToFileURL(t).href : t); break; } catch { /* next */ } }
if (!pw) throw new Error('Playwright not found (npm i -D playwright, or set PLAYWRIGHT_MODULE)');
const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const ARC = 'M704 296A304 304 0 1 0 704 728';   // favicon.svg: M44 18.5 A19 19 0 1 0 44 45.5, x16
const art = {
  any: `<rect width="1024" height="1024" fill="#0f172a"/>
    <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#8b7bff"/></linearGradient>
    <radialGradient id="g" cx="870" cy="512" r="360" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fbbf24" stop-opacity=".35"/><stop offset="1" stop-color="#fbbf24" stop-opacity="0"/></radialGradient></defs>
    <circle cx="870" cy="512" r="360" fill="url(#g)"/>
    <path d="${ARC}" fill="none" stroke="url(#a)" stroke-width="120" stroke-linecap="round"/><circle cx="720" cy="512" r="104" fill="#fbbf24"/>`,
  // dark: no backdrop (iOS fills it); a little brighter so it reads on the system's dark gradient
  dark: `<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a5e3ff"/><stop offset="1" stop-color="#a194ff"/></linearGradient>
    <radialGradient id="g" cx="870" cy="512" r="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fbbf24" stop-opacity=".28"/><stop offset="1" stop-color="#fbbf24" stop-opacity="0"/></radialGradient></defs>
    <circle cx="870" cy="512" r="330" fill="url(#g)"/>
    <path d="${ARC}" fill="none" stroke="url(#a)" stroke-width="120" stroke-linecap="round"/><circle cx="720" cy="512" r="104" fill="#fcc93a"/>`,
  // tinted: grayscale only, the torch dot brightest so the tint keeps the "light" in it
  tinted: `<rect width="1024" height="1024" fill="#000"/>
    <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9d9d9"/><stop offset="1" stop-color="#9a9a9a"/></linearGradient></defs>
    <path d="${ARC}" fill="none" stroke="url(#a)" stroke-width="120" stroke-linecap="round"/><circle cx="720" cy="512" r="104" fill="#fff"/>`,
};

const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
async function render(svgBody, file, size = 1024, transparent = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}" style="display:block">${svgBody}</svg></body></html>`);
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(path.relative(MOBILE, file));
}
const set = path.join(MOBILE, 'ios/CasaTorch/Assets.xcassets/AppIcon.appiconset');
// icon-1024.png (any appearance) is the original artwork and is kept as is; art.any redraws it for the Play icon.
await render(art.dark, path.join(set, 'icon-1024-dark.png'), 1024, true);
await render(art.tinted, path.join(set, 'icon-1024-tinted.png'));
await render(art.any, path.join(MOBILE, 'store/google-play/icon-512.png'), 512);
await browser.close();
