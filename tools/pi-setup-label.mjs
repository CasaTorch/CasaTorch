#!/usr/bin/env node
/* Make one CasaTorch Box's Wi-Fi setup sticker, and write its setup Wi-Fi settings onto the Box's card.
 *
 *   node tools/pi-setup-label.mjs /Volumes/bootfs        (the card's boot partition, after flashing)
 *
 * - picks a network name (CasaTorch-Setup-XXXX) and a strong random password for this Box,
 * - writes them to casatorch-setup.txt on the card,
 * - writes dist/labels/<name>.html: a printable sticker with a QR code (scan it with the phone camera
 *   to join the setup Wi-Fi) and the same name and password written out, for joining by hand.
 * The password is only on the card and the sticker - keep no other copy. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const QRCode = require('qrcode');

const boot = process.argv[2];
if (!boot || !fs.existsSync(boot)) { console.error('usage: node tools/pi-setup-label.mjs <boot partition of the flashed card>'); process.exit(1); }
const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';   // no 0/O, 1/l/I: easy to read off a sticker
const pick = (n) => Array.from(crypto.randomBytes(n), (b) => ABC[b % ABC.length]).join('');
const ssid = `CasaTorch-Setup-${pick(4).toUpperCase()}`, pw = `${pick(4)}-${pick(4)}-${pick(4)}`;
fs.writeFileSync(path.join(boot, 'casatorch-setup.txt'), `SETUP_SSID=${ssid}\nSETUP_PASSWORD=${pw}\n`);

const esc = (s) => s.replace(/([\;,:"])/g, '\\$1');
const svg = await QRCode.toString(`WIFI:T:WPA;S:${esc(ssid)};P:${esc(pw)};;`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'labels'); fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `${ssid}.html`);
fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>${ssid}</title>
<style>@page{size:62mm 40mm;margin:0}body{margin:0;font:9pt/1.25 -apple-system,Helvetica,Arial,sans-serif}
.l{width:62mm;height:40mm;box-sizing:border-box;padding:3mm;display:flex;gap:3mm;align-items:center}.q{width:30mm;height:30mm;flex:none}.q svg{width:100%;height:100%}
b{font-size:8pt}code{font:600 10pt/1.2 Menlo,Consolas,monospace;display:block;margin:0 0 1.5mm;word-break:break-all}small{font-size:6.5pt;color:#444}</style>
<div class="l"><div class="q">${svg}</div><div><b>Wi-Fi setup</b><br><small>Scan with your phone camera, or join:</small>
<code>${ssid}</code><small>Password</small><code>${pw}</code><small>Then pick your home Wi-Fi on the page that opens.</small></div></div>`);
console.log(`wrote casatorch-setup.txt to ${boot}\nsticker: ${file}  (print at 100%, 62 x 40 mm)`);
