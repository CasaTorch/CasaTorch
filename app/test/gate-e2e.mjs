/* The edge gate, end to end, on a fresh CasaTorch with sign-in, a fake casatorch.com (secure access and the gate's
   signed calls) and a fake cloudflared whose "edge" plays the edge gate (test/fixtures/fake-cloudflared.cjs, GATE_STATE).
   Turning secure access on registers the box's key; the self-test goes through the gate with its own ticket and checks
   the address is closed without one; a stranger is turned away before the box; a paired phone gets a week of tickets
   and reaches the home from away; a browser approved at home gets its cookie, signs in from away (an alert says who,
   which device, where and when) and renews its ticket; Devices & sessions (the owner sees all, a member their own);
   removing the phone revokes its tickets at the edge; allowed countries and the lock, at the edge and on the box;
   unlocking only at home; and after the trial, Basic is still "only at home" behind the gate.
   Run: node build.mjs && node test/gate-e2e.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const [PORT, EDGE, FAKE] = [await free(), await free(), await free()];
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'casatorch-gate-e2e-')), BIN = path.join(DIR, 'bin');
fs.mkdirSync(BIN, { recursive: true });
fs.copyFileSync(path.join(here, 'fixtures/fake-cloudflared.cjs'), path.join(BIN, 'cloudflared')); fs.chmodSync(path.join(BIN, 'cloudflared'), 0o755);
fs.writeFileSync(path.join(BIN, 'VERSION'), '2026.10.7');
fs.writeFileSync(path.join(BIN, 'FAKE_MODE'), 'ok');
const TERMS = /const TERMS_VERSION = '([\d-]+)'/.exec(fs.readFileSync(path.join(here, '../server.js'), 'utf8'))[1];
const PW = 'correct horse battery staple', salt = crypto.randomBytes(16);
const hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(PW, salt, 32).toString('hex')}`;
fs.writeFileSync(path.join(DIR, 'users.json'), JSON.stringify({ list: [{ id: 'owner1', username: 'owner', name: 'Alex', email: null, role: 'owner', password: hash, createdAt: new Date().toISOString(), terms: { version: TERMS, at: new Date().toISOString() } }], policy: { require2fa: false }, google: null, panels: [] }), { mode: 0o600 });
const setupAt = new Date().toISOString();   // in the trial: Pro, so away from home works (Basic is checked at the end)
fs.writeFileSync(path.join(DIR, 'config.json'), JSON.stringify({ house: { name: 'Gate home', timezone: 'UTC' }, setupAt }));

/* ---- the fake casatorch.com: /api/remote and /api/gate (signature, secret, newer state only) ---- */
const homes = new Map(), gateCalls = []; let gateRec = null;
const writeGate = () => { if (gateRec) fs.writeFileSync(path.join(BIN, 'GATE_STATE'), JSON.stringify(gateRec)); else fs.rmSync(path.join(BIN, 'GATE_STATE'), { force: true }); };
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.method === 'HEAD') { res.writeHead(200); return res.end(); }
    const b = JSON.parse(body || '{}');
    if (req.url === '/api/gate') {
      const h = homes.get(b.id), pub = String(b.pub || '');
      const key = (p) => crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(p, 'base64')]), format: 'der', type: 'spki' });
      const okSig = /^[A-Za-z0-9+/]{43}=$/.test(pub) && crypto.verify(null, Buffer.from(body), key(pub), Buffer.from(String(req.headers['x-ct-sig'] || ''), 'base64'));
      gateCalls.push({ b, okSig });
      if (!h || h.secret !== b.secret || h.hostname !== b.hostname) return send(403, { error: 'Not this home\'s address.' });
      if (!okSig) return send(403, { error: 'Not signed by this home.' });
      if (gateRec?.pub && gateRec.pub !== pub) return send(409, { error: 'key changed' });
      if (gateRec?.v && b.v <= gateRec.v) return send(409, { error: 'older', stale: true });
      gateRec = { pub, ...b.state, graceUntil: 0, v: b.v }; writeGate();
      return send(200, { ok: true, active: true, graceUntil: null });
    }
    if (req.url !== '/api/remote') return send(404, { error: 'not here' });
    if (req.method === 'DELETE') { if (homes.get(b.id)?.secret === b.secret) { homes.delete(b.id); gateRec = null; writeGate(); } return send(200, { ok: true }); }
    let h = homes.get(b.id);
    if (h && b.secret !== h.secret) return send(403, { error: 'That home already has an address.' });
    if (!h) { h = { hostname: 'home-gate2345.casatorch.com', secret: `s-${crypto.randomBytes(6).toString('hex')}` }; homes.set(b.id, h); if (b.gate === true) { gateRec = { pending: true }; writeGate(); } }
    send(200, { hostname: h.hostname, secret: h.secret, ingress: 'local', token: Buffer.from(JSON.stringify({ h: h.hostname, p: b.port })).toString('base64url') });
  });
});
await new Promise((ok) => fake.listen(FAKE, '127.0.0.1', ok));

/* ---- CasaTorch ---- */
const env = { ...process.env, CASATORCH_DATA_DIR: DIR, PORT: String(PORT), HTTPS_PORT: '0', CASATORCH_MDNS: '0', CASATORCH_LOCAL_HTTPS: 'off',
  CASATORCH_REMOTE_URL: `http://127.0.0.1:${FAKE}/api/remote`, CASATORCH_CFD_BASE: `http://127.0.0.1:${FAKE}/cfd`, CASATORCH_REMOTE_CHECK_BASE: `http://127.0.0.1:${EDGE}`,
  CASATORCH_FAKE_EDGE_PORT: String(EDGE), CASATORCH_REMOTE_FAST: '1' };
for (const k of ['CASATORCH_TEST', 'CASATORCH_DEMO', 'CASATORCH_PRO_DEV']) delete env[k];
let child, log = '';
const start = () => { child = spawn(process.execPath, [path.join(here, '../server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', (c) => { log += c; }); child.stderr.on('data', (c) => { log += c; }); };
const stop = () => new Promise((ok) => { if (!child || child.exitCode != null) return ok(); child.once('exit', ok); child.kill(); setTimeout(ok, 5000); });
start();
const B = `http://127.0.0.1:${PORT}`, E = `http://127.0.0.1:${EDGE}`;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/* a tiny cookie jar per "device" */
const jar = () => ({ c: new Map(), get header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); },
  take(r) { for (const sc of r.headers.getSetCookie?.() || []) { const [kv, ...attrs] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/max-age=0/i.test(attrs.join(';')) || !v) this.c.delete(k); else this.c.set(k, v); } } });
async function call(base, p, { method, body, cookies, headers = {}, origin } = {}) {
  const h = { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookies && cookies.c.size ? { Cookie: cookies.header } : {}), ...(origin ? { Origin: origin } : {}), ...headers };
  const r = await fetch(base + p, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  cookies?.take(r);
  return { status: r.status, j: await r.clone().json().catch(() => null), text: await r.text().catch(() => ''), r };
}
const home = (p, o = {}) => call(B, p, { origin: B, ...o });
let HOST = null;
const away = (p, o = {}) => call(E, p, { origin: HOST ? `https://${HOST}` : undefined, ...o });
async function until(what, fn, ms = 15000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(150); }
  throw new Error(`timed out waiting for ${what}\n--- log ---\n${log.slice(-3000)}`);
}
let n = 0; const ok = (name) => { n++; console.log('ok', name); };

try {
  await until('the server', async () => (await fetch(`${B}/api/app/hello`).catch(() => null))?.ok);
  /* the owner, at home */
  const owner = jar();
  let r = await home('/api/auth/login', { body: { username: 'owner', password: PW }, cookies: owner });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.ok(owner.c.get('casatorch_session'));
  assert.ok(owner.c.get('casatorch_device'), 'a device cookie, to tell new devices from known ones');
  /* on: the key is registered (signed) before the self-test, which goes through the gate */
  r = await home('/api/remote/on', { body: {}, cookies: owner }); assert.equal(r.status, 200, JSON.stringify(r.j)); HOST = r.j.hostname;
  const reg = gateCalls.find((c) => c.okSig && c.b.hostname === HOST);
  assert.ok(reg, 'a signed call registered the box key'); assert.equal(reg.b.state.locked, false); assert.ok(gateRec.pub);
  const v = await until('working', async () => { const x = (await home('/api/remote', { cookies: owner })).j; return x?.view?.status === 'working' ? x : null; });
  assert.equal(v.gate.active, true); assert.equal(v.view.title, 'Working from anywhere');
  ok('on: the box registers its key with a signed call; the self-test goes through the gate with its own ticket');
  const doc = (await home('/api/doctor?fresh=1', { cookies: owner })).j, eg = doc.checks.find((c) => c.id === 'edgegate');
  assert.equal(eg?.status, 'ok', JSON.stringify(eg)); assert.match(eg.detail, /only approved devices reach this CasaTorch from outside/);
  ok('Health: "Edge gate - On: only approved devices" (the self-test checked the address is closed without a ticket)');
  /* a stranger */
  const s1 = await away('/api/app/hello'), s2 = await away('/', { headers: { Accept: 'text/html' } });
  assert.equal(s1.status, 403); assert.equal(s1.j.gate, true); assert.equal(s1.j.casatorch, undefined);
  assert.equal(s2.status, 403); assert.doesNotMatch(s2.text, /Gate home|casatorch":/);
  const s3 = await away('/api/auth/login', { body: { username: 'owner', password: 'wrong' } }); assert.equal(s3.status, 403, 'sign-in is never even tried');
  assert.doesNotMatch(fs.readFileSync(path.join(DIR, 'audit.log'), 'utf8'), /login-failed/);
  ok('a stranger is turned away at the edge: no hello, no page, no sign-in attempt reaches the box');
  /* a phone, paired at home */
  r = await home('/api/app/pair', { body: {}, cookies: owner }); assert.equal(r.status, 200, JSON.stringify(r.j));
  r = await call(B, '/api/app/claim', { body: { code: r.j.code, device: { name: 'Test phone', platform: 'ios', model: 'iPhone15,2' } } });
  assert.equal(r.status, 200, JSON.stringify(r.j)); const phone = { token: r.j.token, tickets: r.j.gate?.tickets };
  assert.equal(r.j.gate.host, HOST); assert.equal(phone.tickets.length, 16);
  const tnow = () => { const s = Date.now() / 1000; return phone.tickets.find((x) => x.nbf <= s && s < x.exp - 60).t; };
  const app = (p, o = {}) => away(p, { ...o, origin: undefined, headers: { Authorization: `Bearer ${phone.token}`, 'X-CT-Gate': tnow(), ...(o.headers || {}) } });
  r = await app('/api/app/me'); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.device.name, 'Test phone');
  r = await app('/api/gate/ticket', { body: {} }); assert.equal(r.status, 200); assert.equal(r.j.tickets.length, 16, 'renewed over its session');
  ok('a phone paired at home gets a week of tickets and reaches the home from away; it renews them over its session');
  const inbox = async (who) => (await home('/api/inbox', { cookies: who })).j.items;
  assert.ok((await inbox(owner)).some((x) => /^New phone paired: Test phone \(iPhone\) for Alex, at home, /.test(x.title) && x.msg && x.vars?.device));
  ok('alert: "New phone paired: Test phone (iPhone) for Alex, at home, <when>" in the inbox');
  /* a browser, approved at home, then away */
  r = await home('/api/gate/approve-here', { body: {}, cookies: owner }); assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.action, `https://${HOST}/__ct_gate/set`);
  const laptop = jar();
  const set = await fetch(`${E}/__ct_gate/set`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `t=${r.j.ticket}`, redirect: 'manual' });
  assert.equal(set.status, 303); laptop.take(set); assert.ok(laptop.c.get('__Host-ct_gate'), 'the ticket became the __Host- cookie');
  assert.match(set.headers.get('set-cookie'), /Path=\/; Secure; HttpOnly; SameSite=Lax/);
  const ua = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'X-Fake-City': 'Austin' };
  r = await away('/api/auth/login', { body: { username: 'owner', password: PW }, cookies: laptop, headers: ua }); assert.equal(r.status, 200, JSON.stringify(r.j));
  const a1 = (await inbox(owner)).find((x) => /^New sign-in on a new device: Alex on Safari on Mac, from Austin, United States, /.test(x.title));
  assert.ok(a1, JSON.stringify((await inbox(owner)).map((x) => x.title)));
  ok('a browser approved at home gets its cookie; signing in from away raises "New sign-in on a new device ... from Austin, United States, <when>"');
  r = await away('/api/auth/logout', { body: {}, cookies: laptop, headers: ua });
  r = await away('/api/auth/login', { body: { username: 'owner', password: PW }, cookies: laptop, headers: ua }); assert.equal(r.status, 200);
  assert.ok((await inbox(owner)).some((x) => /^Sign-in from away: Alex on Safari on Mac, from Austin, United States/.test(x.title)), 'a known device, from away: still said');
  const before = laptop.c.get('__Host-ct_gate');
  await sleep(1100);
  r = await away('/api/gate/ticket', { body: {}, cookies: laptop, headers: ua }); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.approved, true);
  assert.notEqual(laptop.c.get('__Host-ct_gate'), before, 'renewed');
  ok('every sign-in from away says so; an approved browser renews its ticket while CasaTorch is open');
  /* Devices & sessions */
  r = await home('/api/users', { body: { name: 'Sam', role: 'member' }, cookies: owner }); assert.equal(r.status, 200, JSON.stringify(r.j));
  const tok = new URL(r.j.link).searchParams.get('invite'), sam = jar();
  r = await home('/api/auth/invite', { body: { token: tok, username: 'sam', password: 'another long passphrase', accept: true }, cookies: sam }); assert.equal(r.status, 200, JSON.stringify(r.j));
  const mine = (await home('/api/access', { cookies: sam })).j, all = (await home('/api/access', { cookies: owner })).j;
  assert.equal(mine.owner, false); assert.ok(mine.sessions.length >= 1 && mine.sessions.every((s) => s.user === mine.me), 'a member sees their own');
  assert.equal(mine.browsers.length, 0);
  assert.ok(all.owner && all.sessions.some((s) => s.person === 'Sam') && all.sessions.some((s) => s.kind === 'app' && s.name === 'Test phone'));
  const lap = all.sessions.find((s) => s.kind === 'browser' && s.where && s.where.home === false);
  assert.ok(lap && lap.where.city === 'Austin' && lap.where.country === 'US', JSON.stringify(all.sessions.map((s) => s.where)));
  assert.ok(all.browsers.length === 1 && /Safari|browser/i.test(all.browsers[0].name));
  assert.equal((await home('/api/gate/settings', { body: { locked: true }, cookies: sam })).status, 403, 'only the owner');
  assert.ok(!(await inbox(sam)).some((x) => /Alex/.test(x.title)), 'Alex\'s sign-ins aren\'t in Sam\'s inbox');
  ok('Devices & sessions: the owner sees every session and approved browser (with where and when), a member only their own');
  /* remove the phone: signed out, and its tickets stop at the edge */
  const ph = all.sessions.find((s) => s.kind === 'app');
  r = await home(`/api/access/sessions/${ph.id}`, { method: 'DELETE', cookies: owner }); assert.equal(r.status, 200);
  await until('revoked at casatorch.com', async () => gateRec.revoked?.includes(ph.id));
  r = await app('/api/app/me'); assert.equal(r.status, 403); assert.equal(r.j.gate, true, 'refused at the edge, not at the box');
  ok('"Remove this phone": signed out, and its edge tickets are revoked (the signed list) and refused at the edge');
  /* allowed countries: edge and box */
  r = await home('/api/gate/settings', { body: { countries: ['US', 'CA'] }, cookies: owner }); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.synced, true);
  assert.deepEqual(gateRec.countries, ['CA', 'US']);
  assert.equal((await away('/api/auth/me', { cookies: laptop, headers: { 'X-Fake-Country': 'FR' } })).status, 403);
  assert.equal((await away('/api/auth/me', { cookies: laptop, headers: { 'X-Fake-Country': 'CA' } })).status, 200);
  /* as if the edge let it through: straight to the box, as cloudflared delivers it (http.request: fetch can't set Host) */
  const direct = (p, extra = {}, o = {}) => new Promise((done, fail) => {
    const body = o.body !== undefined ? JSON.stringify(o.body) : null;
    const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method: o.method || 'GET', headers: { Host: HOST, 'CF-Connecting-IP': '198.51.100.20', 'CF-Ray': 'x', 'X-Forwarded-Proto': 'https', Accept: 'application/json', Cookie: laptop.header, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ } done({ status: res.statusCode, j }); });
    });
    q.on('error', fail); q.end(body || undefined);
  });
  r = await direct('/api/auth/me', { 'CF-IPCountry': 'FR' }); assert.equal(r.status, 403); assert.equal(r.j.country, true);
  assert.equal((await direct('/api/auth/me', { 'CF-IPCountry': 'US' })).status, 200);
  r = await home('/api/gate/settings', { body: { countries: [] }, cookies: owner }); assert.equal(gateRec.countries, null);
  ok('allowed countries: refused at the edge and again on the box (CF-IPCountry), kept in sync by the signed call');
  /* the lock */
  r = await home('/api/gate/settings', { body: { locked: true }, cookies: owner }); assert.equal(r.status, 200); assert.equal(gateRec.locked, true);
  r = await away('/api/auth/me', { cookies: laptop }); assert.equal(r.status, 403); assert.equal(r.j.locked, true);
  r = await direct('/api/auth/me'); assert.equal(r.status, 403); assert.equal(r.j.locked, true);
  r = await direct('/api/gate/unlock', { Origin: `https://${HOST}` }, { method: 'POST', body: {} }); assert.equal(r.status, 403); assert.match(r.j.error, /at home, or from the CasaTorch app/);
  assert.equal(gateRec.locked, true, 'a browser away can\'t unlock');
  const lv = (await home('/api/remote', { cookies: owner })).j; assert.equal(lv.view.status, 'locked');
  const lock = (await home('/api/doctor?fresh=1', { cookies: owner })).j.checks.find((c) => c.id === 'edgegate'); assert.match(lock.detail, /locked/);
  r = await home('/api/gate/unlock', { body: {}, cookies: owner }); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(gateRec.locked, false);
  assert.equal((await away('/api/auth/me', { cookies: laptop })).status, 200);
  ok('Lock remote access: refused at the edge and on the box at once; unlocked only at home (or the paired app), then back');
  /* sign out everywhere else: the laptop's session and approval go */
  r = await home('/api/access/others', { body: {}, cookies: owner }); assert.equal(r.status, 200);
  await until('the browser revoked', async () => (gateRec.revoked || []).length >= 2);
  r = await away('/api/auth/me', { cookies: laptop }); assert.equal(r.status, 403); assert.equal(r.j.gate, true);
  ok('"Sign out everywhere else": the other sessions end and the approved browser is revoked at the edge');
  /* every phone out: a new epoch */
  r = await home('/api/app/pair', { body: {}, cookies: owner });
  r = await call(B, '/api/app/claim', { body: { code: r.j.code, device: { name: 'Second phone', platform: 'android', model: 'Pixel' } } }); phone.token = r.j.token; phone.tickets = r.j.gate.tickets;
  assert.equal((await app('/api/app/me')).status, 200);
  const e0 = gateRec.epoch;
  r = await home('/api/gate/revoke-all', { body: {}, cookies: owner }); assert.equal(r.status, 200); assert.equal(gateRec.epoch, e0 + 1);
  assert.equal((await app('/api/app/me')).status, 403, 'older epoch');
  r = await home('/api/gate/ticket', { body: {}, headers: { Authorization: `Bearer ${phone.token}` } }); phone.tickets = r.j.tickets;   // at home, the phone picks up new ones
  assert.equal((await app('/api/app/me')).status, 200);
  ok('"Sign every device out of away access" bumps the epoch; a phone at home picks up new tickets');
  /* after the trial: Basic is still only at home, behind the gate */
  await stop();
  const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8')); cfg.setupAt = '2020-01-01T00:00:00.000Z'; fs.writeFileSync(path.join(DIR, 'config.json'), JSON.stringify(cfg));
  start();
  await until('the server again', async () => (await fetch(`${B}/api/app/hello`).catch(() => null))?.ok);
  await until('working (Basic)', async () => (await home('/api/remote', { cookies: owner })).j?.view?.status === 'working');
  r = await app('/api/app/me'); assert.equal(r.status, 403); assert.equal(r.j.needsPro, true, 'through the gate, then the box\'s own Basic rule');
  assert.equal((await home('/api/app/me', { headers: { Authorization: `Bearer ${phone.token}` }, origin: undefined })).status, 200, 'at home as usual');
  ok('Basic: an approved phone passes the gate, then the box\'s own "only at home" rule answers as before');
  /* off */
  r = await home('/api/remote/off', { body: {}, cookies: owner }); assert.equal(r.status, 200); assert.equal(gateRec, null);
  assert.equal((await home('/api/access', { cookies: owner })).j.gate.active, false);
  ok('off: the gate\'s record goes with the address');
  assert.doesNotMatch(log, /ct1\.[A-Za-z0-9_-]{20,}/, 'no ticket in the log');
  assert.doesNotMatch(fs.readFileSync(path.join(DIR, 'audit.log'), 'utf8'), /ct1\./, 'no ticket in the audit log');
  ok('no ticket in the log or the audit log');
  console.log(`\n${n} passed`);
} finally {
  await stop(); fake.close();
  try { fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* cleaned up later */ }
}
process.exit(0);
