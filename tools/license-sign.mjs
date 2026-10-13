#!/usr/bin/env node
/*
 * Make a HouseOS Pro license key (run by the seller, never shipped).
 *   HOUSEOS_LICENSE_KEY=../houseos-private/license-ed25519.pem \
 *     node tools/license-sign.mjs buyer@example.com yearly [homes]
 * plan: monthly | yearly | lifetime. monthly/yearly get an expiry date; lifetime does not.
 * Later this runs in the store's webhook (Lemon Squeezy / Polar) instead of by hand.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
const [email, plan = 'yearly', homes = '1'] = process.argv.slice(2);
if (!email || !['monthly', 'yearly', 'lifetime'].includes(plan)) { console.error('usage: license-sign.mjs <email> <monthly|yearly|lifetime> [homes]'); process.exit(1); }
const keyFile = process.env.HOUSEOS_LICENSE_KEY; if (!keyFile) { console.error('set HOUSEOS_LICENSE_KEY to the private key file'); process.exit(1); }
const days = { monthly: 31, yearly: 366 }[plan];
const payload = { email, plan, homes: Number(homes), issued: new Date().toISOString(), expires: days ? new Date(Date.now() + days * 86400_000).toISOString() : null };
const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
const s = crypto.sign(null, Buffer.from(p), crypto.createPrivateKey(fs.readFileSync(keyFile))).toString('base64url');
console.log(`${p}.${s}`);
