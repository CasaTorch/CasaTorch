#!/usr/bin/env node
/*
 * Security regression checks against a fresh install. Starts its own CasaTorch (temp data folder, free port)
 * and cleans up:   cd app && node build.mjs && cd .. && node tools/test-security.mjs
 * Or against one already running:  SEC_BASE=http://127.0.0.1:8095 SEC_DATA=<its data folder> node tools/test-security.mjs
 *
 * Covers: setup can't be taken over once finished, setup answers stay private, members can't change
 * settings (including by changing the case of the path), the license e-mail isn't public, push levels are
 * clamped, session cookie flags, security headers, owner-only data files, hashed passwords, sealed push keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('./test-e2e-lib.cjs');
const { check, finish } = L.runner('security regression checks');

try {
  let B = process.env.SEC_BASE, DATA = process.env.SEC_DATA;
  if (!B) { const s = await L.startCasaTorch({ name: 'security' }); B = s.base; DATA = s.data; }
  const H = { 'Content-Type': 'application/json', Origin: B };
  let cookie = '';
  const req = async (m, p, body, c = cookie) => {
    const r = await fetch(B + p, { method: m, headers: { ...H, ...(c ? { Cookie: c } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    return { s: r.status, j: await r.json().catch(() => null), sc: r.headers.get('set-cookie') };
  };

  const fin = await req('POST', '/api/setup/finish', { answers: { house: { name: 'T' }, account: { username: 'owner1', password: 'Correct-horse-9', terms: true } } }, '');
  check('first setup succeeds from this computer', fin.s === 200, `HTTP ${fin.s} ${JSON.stringify(fin.j)}`);
  const lg = await req('POST', '/api/auth/login', { username: 'owner1', password: 'Correct-horse-9' }, '');
  cookie = (lg.sc || '').split(';')[0];
  check('owner can sign in', lg.s === 200 && !!cookie, `HTTP ${lg.s}`);

  const take = await req('POST', '/api/setup/finish', { answers: { account: { username: 'owner1', password: 'Attacker-pass-77', terms: true } } }, '');
  check('setup can\'t be run again without signing in (takeover)', take.s === 403, `HTTP ${take.s}`);
  const again = await req('POST', '/api/auth/login', { username: 'owner1', password: 'Attacker-pass-77' }, '');
  check('the attacker\'s password does not work', again.s !== 200, `HTTP ${again.s}`);
  const cur = await req('GET', '/api/setup/current', null, '');
  check('setup answers are private when signed out', cur.s === 403, `HTTP ${cur.s}`);

  const inv = await req('POST', '/api/users', { username: 'kid', name: 'Kid', role: 'member', password: 'Member-pass-123' });
  check('owner can add a member', inv.s === 200, `HTTP ${inv.s} ${JSON.stringify(inv.j).slice(0, 120)}`);
  const link = inv.j?.link || inv.j?.invite || JSON.stringify(inv.j).match(/https?:[^"]+/)?.[0];
  let mc = '';
  if (link && new URL(link).searchParams.get('invite')) {
    const acc = await req('POST', '/api/auth/invite', { token: new URL(link).searchParams.get('invite'), username: 'kid', password: 'Member-pass-123', accept: true }, '');
    check('member accepts the invite', acc.s === 200, `HTTP ${acc.s} ${JSON.stringify(acc.j).slice(0, 80)}`);
    mc = (acc.sc || '').split(';')[0];
  }
  const ml = await req('POST', '/api/auth/login', { username: 'kid', password: 'Member-pass-123' }, '');
  if (ml.s === 200 && ml.sc) mc = ml.sc.split(';')[0];
  check('member can sign in', !!mc, `HTTP ${ml.s} ${JSON.stringify(ml.j).slice(0, 80)}`);
  for (const p of ['/api/settings', '/API/settings', '/api/ui/', '/Api/floorplan/settings']) {
    const r = await req('PUT', p, { x: 1 }, mc);
    check(`member can't PUT ${p}`, r.s === 403, `HTTP ${r.s}`);
  }
  const ai = await req('POST', '/API/settings/ai/models', { provider: 'openai', url: 'http://127.0.0.1:9' }, mc);
  check('member can\'t probe AI models (mixed-case path)', ai.s === 403, `HTTP ${ai.s}`);
  const lic = await req('GET', '/api/license', null, '');
  check('license e-mail is not shown signed out', !('email' in (lic.j || {})));
  const push = await req('POST', '/api/push', { subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } }, level: 'constructor' }, mc);
  const list = await req('GET', '/api/push', null, mc);
  check('an odd push level is saved as "important"', push.s === 200 && list.j?.devices?.[0]?.level === 'important', `HTTP ${push.s}, level ${list.j?.devices?.[0]?.level}`);

  // Encryption at rest and in transit (docs: Security and encryption)
  const flags = (lg.sc || '').split(';').slice(1).map((x) => x.trim().toLowerCase());
  check('session cookie is HttpOnly and SameSite=Lax', flags.includes('httponly') && flags.includes('samesite=lax'), flags.join('; '));
  const hd = await fetch(`${B}/api/health`);
  for (const k of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'cross-origin-opener-policy', 'cache-control']) check(`header ${k}`, hd.headers.has(k));
  if (DATA && fs.existsSync(DATA)) {
    const loose = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === 'bin') continue; const m = fs.lstatSync(p).mode & 0o777; if (e.isDirectory()) { if (m & 0o077) loose.push(`${p} ${m.toString(8)}`); walk(p); } else if (e.isFile() && m & 0o077) loose.push(`${p} ${m.toString(8)}`); } };
    walk(DATA);
    check('data files are readable by the owner only', loose.length === 0, loose.join(', '));
    const users = fs.readFileSync(path.join(DATA, 'users.json'), 'utf8');
    check('users.json has no plain passwords', !/Correct-horse-9|Member-pass-123/.test(users));
    const pj = JSON.parse(fs.readFileSync(path.join(DATA, 'push.json'), 'utf8'));
    check('push.json web-push keys are sealed', (pj.subs || []).length > 0 && pj.subs.every((x) => /^v1\./.test(x.keys?.p256dh) && /^v1\./.test(x.keys?.auth)));
  } else console.log('  (data-folder checks skipped: set SEC_DATA to the server\'s data folder)');
  finish();
} catch (e) { finish(e); }
