/* Secure access, end to end, on a fresh CasaTorch with a fake casatorch.com and a fake cloudflared
   (test/fixtures/fake-cloudflared.cjs, copied to <data>/bin/cloudflared with a VERSION file so nothing is downloaded).
   Turns it on, checks itself, the Basic "only at home" gate, Health, the helper crashing, a tunnel that went stale,
   a firewall that blocks QUIC (HTTP/2 fallback), a blocked port, a key that was turned down (Repair), casatorch.com
   failing, turning it off, and a failed download.
   Run: node build.mjs && node test/remote-e2e.mjs        (REMOTE_E2E_PORT=18281 picks the ports: that and the next two) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const free = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const base = Number(process.env.REMOTE_E2E_PORT) || 0;
const [PORT, EDGE, FAKE] = base ? [base, base + 1, base + 2] : [await free(), await free(), await free()];
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'casatorch-remote-e2e-')), BIN = path.join(DIR, 'bin');
fs.mkdirSync(BIN, { recursive: true });
fs.copyFileSync(path.join(here, 'fixtures/fake-cloudflared.cjs'), path.join(BIN, 'cloudflared')); fs.chmodSync(path.join(BIN, 'cloudflared'), 0o755);
fs.writeFileSync(path.join(BIN, 'VERSION'), '2026.10.0');
const mode = (m) => fs.writeFileSync(path.join(BIN, 'FAKE_MODE'), m);
const runs = () => { try { return fs.readFileSync(path.join(BIN, 'FAKE_RUNS'), 'utf8').trim().split('\n'); } catch { return []; } };
mode('ok');
// a home whose trial ended long ago: Basic, so the "only from home" rule applies
fs.writeFileSync(path.join(DIR, 'config.json'), JSON.stringify({ house: { name: 'E2E home', timezone: 'UTC' }, setupAt: '2020-01-01T00:00:00.000Z' }));

/* ---- the fake casatorch.com ---- */
const homes = new Map(); let fail = false, downloads = 0, deleted = 0;
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith('/cfd/')) { downloads++; res.writeHead(500); return res.end('no'); }
    if (req.method === 'HEAD') { res.writeHead(200); return res.end(); }
    if (req.url !== '/api/remote') return send(404, { error: 'not here' });
    const b = JSON.parse(body || '{}');
    if (req.method === 'DELETE') { if (homes.get(b.id)?.secret === b.secret) { homes.delete(b.id); deleted++; } return send(200, { ok: true }); }
    if (fail) return send(503, { error: 'casatorch.com is busy - try again in a minute' });
    let h = homes.get(b.id);
    if (h && b.secret !== h.secret) return send(403, { error: 'That home already has an address.' });
    if (!h) { h = { hostname: `home-${String(b.id).slice(0, 8).toLowerCase()}.casatorch.test`, secret: `s-${Math.random().toString(36).slice(2)}` }; homes.set(b.id, h); }
    send(200, { hostname: h.hostname, secret: h.secret, token: Buffer.from(JSON.stringify({ h: h.hostname, p: b.port, n: Math.random() })).toString('base64url') });
  });
});
await new Promise((ok) => fake.listen(FAKE, '127.0.0.1', ok));

/* ---- CasaTorch ---- */
const env = { ...process.env, CASATORCH_DATA_DIR: DIR, PORT: String(PORT), HTTPS_PORT: '0', CASATORCH_MDNS: '0', CASATORCH_LOCAL_HTTPS: 'off',
  CASATORCH_REMOTE_URL: `http://127.0.0.1:${FAKE}/api/remote`, CASATORCH_CFD_BASE: `http://127.0.0.1:${FAKE}/cfd`, CASATORCH_REMOTE_CHECK_BASE: `http://127.0.0.1:${EDGE}`,
  CASATORCH_FAKE_EDGE_PORT: String(EDGE), CASATORCH_REMOTE_FAST: '1' };
for (const k of ['CASATORCH_TEST', 'CASATORCH_DEMO', 'CASATORCH_PRO_DEV']) delete env[k];
const child = spawn(process.execPath, [path.join(here, '../server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (c) => { log += c; }); child.stderr.on('data', (c) => { log += c; });
const B = `http://127.0.0.1:${PORT}`;
const api = async (p, body, method) => { const r = await fetch(B + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Origin: B }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => null) }; };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(what, fn, ms = 15000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(150); }
  const r = await api('/api/remote'); throw new Error(`timed out waiting for ${what}: ${JSON.stringify({ view: r.j?.view, state: r.j?.state, lastError: r.j?.lastError })}\n--- log ---\n${log.slice(-3000)}`);
}
const view = async () => (await api('/api/remote')).j;
const status = (s) => async () => { const v = await view(); return v.view.status === s ? v : null; };
let n = 0; const ok = (name) => { n++; console.log('ok', name); };

try {
  await until('the server', async () => (await fetch(`${B}/api/app/hello`).catch(() => null))?.ok);
  /* on */
  let r = await api('/api/remote/on', {});
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.match(r.j.hostname, /^home-.*\.casatorch\.test$/);
  const host = r.j.hostname;
  let v = await until('working', status('working'));
  assert.equal(v.check.ok, true); assert.equal(v.view.title, 'Working on your home Wi-Fi', 'Basic: works at home'); assert.ok(v.qr.startsWith('<svg'));
  ok('on: the tunnel connects, CasaTorch opens its own address from outside and says it works');
  const hello = await (await fetch(`${B}/api/app/hello`)).json();
  assert.equal(hello.remote, `https://${host}`); assert.equal(hello.check, undefined, 'no self-test code for anyone else');
  ok('hello (at home) tells the app the address');
  /* the Basic gate, through the "edge" */
  const away = await fetch(`http://127.0.0.1:${EDGE}/api/app/hello`, { headers: { 'X-Fake-Ip': '198.51.100.7' } });
  assert.equal(away.status, 403); assert.match(away.headers.get('content-type'), /json/);
  assert.deepEqual(await away.json(), { error: 'You\'re away from home. Using CasaTorch from anywhere is part of Pro.', away: true, needsPro: true });
  const page = await fetch(`http://127.0.0.1:${EDGE}/`, { headers: { 'X-Fake-Ip': '198.51.100.7', Accept: 'text/html' } });
  assert.equal(page.status, 403); assert.match(await page.text(), /away from home/);
  const guess = await fetch(`http://127.0.0.1:${EDGE}/api/app/hello?check=AAAAAAAAAAAAAAAA`, { headers: { 'X-Fake-Ip': '198.51.100.7', 'X-CasaTorch-Check': 'AAAAAAAAAAAAAAAA' } });
  assert.equal(guess.status, 403, 'a made-up self-test code gets nothing');
  ok('Basic, away: JSON 403 { away, needsPro } for /api, the friendly page for pages, no way round it');
  /* Health */
  const doc = (await api('/api/doctor?fresh=1')).j, rc = doc.checks.find((c) => c.id === 'remote');
  assert.equal(rc?.status, 'ok', JSON.stringify(rc)); assert.match(rc.detail, /Working on your home Wi-Fi\. Checked from outside/);
  ok('Health has a Secure access line');
  /* the helper stops by itself: started again */
  const before = runs().length; mode('crash');
  r = await api('/api/remote/repair', {}); assert.equal(r.status, 200);
  await until('a restart after the crash', async () => runs().length >= before + 2, 12000);
  mode('ok'); await until('working again', status('working'), 15000);
  ok('the helper stopping is noticed and it is started again');
  /* stale: says connected, Cloudflare answers 530 - restarted once, then said plainly */
  mode('stale'); const b2 = runs().length;
  await api('/api/remote/repair', {});
  v = await until('a tunnel problem', async () => { const x = await view(); return x.view.code === 'tunnel' ? x : null; }, 15000);
  assert.ok(runs().length >= b2 + 2, 'restarted once by itself before saying so'); assert.equal(v.view.fix.action, 'repair');
  mode('ok'); await api('/api/remote/repair', {}); await until('working after repair', status('working'));
  ok('a tunnel that looks up but doesn\'t answer: restarted, then "Cloudflare can\'t reach this CasaTorch" with Repair');
  /* QUIC blocked: falls back to HTTP/2 by itself, and remembers */
  mode('noquic'); await api('/api/remote/repair', {});
  v = await until('working over http2', async () => { const x = await view(); return x.view.status === 'working' && x.protocol === 'http2' ? x : null; }, 15000);
  assert.equal(runs().at(-1), 'noquic http2');
  ok('UDP blocked: switches to HTTP/2 over TCP by itself');
  /* port 7844 blocked both ways */
  mode('blocked'); await api('/api/remote/repair', {});
  v = await until('blocked', async () => { const x = await view(); return x.view.code === 'blocked' ? x : null; }, 15000);
  assert.match(v.view.detail, /port 7844/); assert.equal(v.view.fix.action, 'check'); assert.ok(v.lastError && !/198\.41/.test(v.lastError.text), 'the last error is kept, masked');
  ok('port 7844 blocked: says so, with what to allow');
  /* a key casatorch.com turned down: Repair from Health */
  mode('token'); await api('/api/remote/repair', {});
  v = await until('token', async () => { const x = await view(); return x.view.code === 'token' ? x : null; }, 10000);
  assert.equal(v.view.fix.action, 'repair');
  const d2 = (await api('/api/doctor?fresh=1')).j.checks.find((c) => c.id === 'remote');
  assert.equal(d2.status, 'bad'); assert.equal(d2.fix.action, 'remote-repair');
  mode('ok'); r = await api('/api/doctor/fix', { action: 'remote-repair' }); assert.equal(r.status, 200, JSON.stringify(r.j));
  await until('working after Health repair', status('working'));
  ok('key turned down: "Repair" (also in Health) gets a fresh one, same address');
  assert.equal((await view()).hostname, host, 'the address stayed the same');
  /* casatorch.com failing */
  fail = true; r = await api('/api/remote/repair', {}); fail = false;
  assert.equal(r.status, 502); assert.match(r.j.error, /busy/); assert.equal(r.j.view.code, 'service');
  ok('casatorch.com failing: its words, and Repair');
  /* off */
  r = await api('/api/remote/off', {}); assert.equal(r.status, 200); assert.equal(deleted, 1);
  const h2 = await (await fetch(`${B}/api/app/hello`)).json(); assert.equal(h2.remote, null, 'the app is told to forget it');
  assert.equal((await view()).view.status, 'off');
  await until('the helper stopped', async () => !(await fetch(`http://127.0.0.1:${EDGE}/`).then(() => true, () => false)), 5000);
  ok('off: the address is given back, hello says remote: null, the helper stops');
  /* the download fails: tried three times, said plainly */
  fs.rmSync(path.join(BIN, 'VERSION'));
  r = await api('/api/remote/on', {});
  assert.equal(r.status, 502); assert.equal(r.j.view.code, 'download'); assert.equal(downloads, 3);
  ok('a failed download is tried 3 times, then "Couldn\'t download the secure-access helper"');
  console.log(`\n${n} passed`);
} finally {
  child.kill(); fake.close();
  fs.rmSync(DIR, { recursive: true, force: true });
}
process.exit(0);
