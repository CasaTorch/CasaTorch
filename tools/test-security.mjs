// Security regression checks against a fresh install:  (cd app && CASATORCH_DATA_DIR=/tmp/sec-data PORT=18095 node server.js) &  then  node tools/test-security.mjs
// Regression checks for the overnight security fixes, against a fresh install.
const B = 'http://127.0.0.1:18095', H = { 'Content-Type': 'application/json', Origin: B };
let cookie = '';
const req = async (m, p, body, c = cookie) => { const r = await fetch(B + p, { method: m, headers: { ...H, ...(c ? { Cookie: c } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); return { s: r.status, j: await r.json().catch(() => null), sc }; };
const fin = await req('POST', '/api/setup/finish', { answers: { house: { name: 'T' }, account: { username: 'owner1', password: 'Correct-horse-9', terms: true } } }, '');
console.log('first setup', fin.s);
const lg = await req('POST', '/api/auth/login', { username: 'owner1', password: 'Correct-horse-9' }, ''); cookie = (lg.sc || '').split(';')[0]; console.log('owner login', lg.s, !!cookie, JSON.stringify(lg.j));
const take = await req('POST', '/api/setup/finish', { answers: { account: { username: 'owner1', password: 'Attacker-pass-77', terms: true } } }, '');
console.log('takeover without sign-in ->', take.s, '(want 403)');
const cur = await req('GET', '/api/setup/current', null, ''); console.log('setup/current without sign-in ->', cur.s, '(want 403)');
const inv = await req('POST', '/api/users', { username: 'kid', name: 'Kid', role: 'member', password: 'Member-pass-123' }); console.log('add member', inv.s, JSON.stringify(inv.j).slice(0, 120));
const tok = new URL(inv.j.link || inv.j.invite || JSON.stringify(inv.j).match(/https?:[^"]+/)[0]).searchParams.get('invite');
const acc = await req('POST', '/api/auth/invite', { token: tok, username: 'kid', password: 'Member-pass-123', accept: true }, ''); console.log('accept invite', acc.s, JSON.stringify(acc.j).slice(0,80));
const ml = await req('POST', '/api/auth/login', { username: 'kid', password: 'Member-pass-123' }, ''); const mc = (ml.sc || acc.sc || '').split(';')[0]; console.log('member login', ml.s, JSON.stringify(ml.j).slice(0,80));
for (const p of ['/API/settings', '/api/ui/', '/Api/floorplan/settings']) { const r = await req('PUT', p, { x: 1 }, mc); console.log('member PUT', p, '->', r.s, '(want 403)'); }
const ai = await req('POST', '/API/settings/ai/models', { provider: 'openai', url: 'http://127.0.0.1:9' }, mc); console.log('member AI models ->', ai.s, '(want 403)');
const lic = await req('GET', '/api/license', null, ''); console.log('license email visible signed out:', 'email' in (lic.j || {}));
const push = await req('POST', '/api/push', { subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } }, level: 'constructor' }, mc);
const list = await req('GET', '/api/push', null, mc); console.log('push level saved as:', list.j?.devices?.[0]?.level, '(want important)');
