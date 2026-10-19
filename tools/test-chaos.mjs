#!/usr/bin/env node
/*
 * Failure injection: CasaTorch must stay up, keep its data and say what's wrong in Health when the things
 * around it break. Starts its own CasaTorch and a live pretend Home Assistant (tools/mock-ha-live.mjs) on free
 * ports, with temp data folders, and cleans up. About 3 minutes:   cd app && node build.mjs && node ../tools/test-chaos.mjs
 *
 *   Home Assistant  down, back, a half-open connection that goes silent, slow (20 s answers), flapping, answering 500
 *   files           every data file damaged at once after a hard kill (and one save cut off mid-swap):
 *                   CasaTorch starts, sets the damaged ones aside, uses the cut-off save, says so in Health
 *   disk full       the data folder on a small RAM disk (only when this can mount one - root on Linux): saving fails
 *                   politely, nothing half-written is left, Health says the disk is full, and it recovers
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('./test-e2e-lib.cjs');
const { check, finish } = L.runner('failure injection (chaos)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOK = L.HA_TOKEN;

async function mockHa() {
  const port = await L.freePort();
  const child = spawn(process.execPath, [path.join(L.ROOT, 'tools', 'mock-ha-live.mjs'), String(port), '80'], { env: { ...process.env, MOCK_HA_TOKEN: TOK }, stdio: 'ignore' });
  process.on('exit', () => { try { child.kill(); } catch { /* gone */ } });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { await fetch(`${base}/mock/stats`); break; } catch { await sleep(100); } }
  return { base, child, mode: (m) => fetch(`${base}/mock/mode?m=${m}`).then((r) => r.json()) };
}
function client(B) {
  let cookie = '';
  const req = async (m, p, body, ms = 30000) => {
    const t0 = Date.now();
    try {
      const r = await fetch(B + p, { method: m, headers: { Origin: B, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
      const j = await r.json().catch(() => null);
      if (r.headers.get('set-cookie')?.startsWith('casatorch_session=')) cookie = r.headers.get('set-cookie').split(';')[0];
      return { s: r.status, j, ms: Date.now() - t0 };
    } catch (e) { return { s: 0, err: e.cause?.code || e.name, ms: Date.now() - t0 }; }
  };
  return { req, login: () => req('POST', '/api/auth/login', { username: 'owner1', password: 'Correct-horse-9' }) };
}
async function setUp(c, haBase) {
  await c.req('POST', '/api/setup/test/homeassistant', { url: haBase, token: TOK });
  const f = await c.req('POST', '/api/setup/finish', { answers: { house: { name: 'Chaos House', timezone: 'America/Los_Angeles' }, homeassistant: { uses: haBase ? 'yes' : 'no' }, account: { username: 'owner1', password: 'Correct-horse-9', terms: true } } });
  const l = await c.login();
  return f.s === 200 && l.s === 200;
}
const until = async (fn, ms, every = 1000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(every); } };
const live = async (c) => (await c.req('GET', '/api/system/info')).j?.liveHomeAssistant === true;
const haCheck = async (c) => (await c.req('GET', '/api/doctor?fresh=1', null, 60000)).j?.checks?.find((x) => x.id === 'ha');
const alive = (child) => child.exitCode == null && !child.signalCode;

/* A CasaTorch on a data folder we choose (so it can be stopped and started again on the same one). */
async function startOn(data, port, env = {}) {
  const child = spawn(process.execPath, ['server.js'], { cwd: L.APP, env: { ...process.env, CASATORCH_DATA_DIR: data, PORT: String(port), CASATORCH_DEMO: '', NODE_ENV: 'test', CASATORCH_HA_QUIET_SECONDS: '12', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = path.join(path.dirname(data), `${path.basename(data)}-${port}.log`), out = fs.createWriteStream(log, { flags: 'a' });
  child.stdout.pipe(out); child.stderr.pipe(out); child.logFile = log;
  process.on('exit', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  await L.waitFor(`http://127.0.0.1:${port}/api/health`, 60000, Object.assign(child, { label: 'CasaTorch' }));
  return child;
}
const stopHard = (child) => new Promise((ok) => { if (!alive(child)) return ok(); child.once('exit', ok); child.kill('SIGKILL'); });
const stopSoft = (child) => new Promise((ok) => { if (!alive(child)) return ok(); const t = setTimeout(() => child.kill('SIGKILL'), 8000); child.once('exit', () => { clearTimeout(t); ok(); }); child.kill('SIGTERM'); });

try {
  /* ---------- Home Assistant misbehaving ---------- */
  const ha = await mockHa();
  const data = L.tmpDir('chaos-data'), port = await L.freePort(), B = `http://127.0.0.1:${port}`;
  let srv = await startOn(data, port);
  const c = client(B);
  check('set up with Home Assistant', await setUp(c, ha.base));
  check('the live connection to Home Assistant comes up', await until(() => live(c), 30000));
  check('devices answer', (await c.req('GET', '/api/devices')).s === 200);

  await ha.mode('down');
  check('Home Assistant down: the live connection notices within 15 s', await until(async () => !(await live(c)), 15000));
  const d1 = await c.req('GET', '/api/devices', null, 30000);
  check('Home Assistant down: devices still answer, within 15 s', d1.s === 200 && d1.ms < 15000, `HTTP ${d1.s} in ${d1.ms} ms`);
  const h1 = await haCheck(c);
  check('Home Assistant down: Health says so in plain words', h1?.status === 'bad' && h1.detail.length > 10, JSON.stringify(h1)?.slice(0, 160));
  await ha.mode('ok');
  check('Home Assistant back: the live connection returns within 45 s', await until(() => live(c), 45000));

  await ha.mode('silent');   // the connection stays open, nothing comes back: Home Assistant's machine lost power mid-way
  check('a silent (half-open) connection is dropped within 30 s', await until(async () => !(await live(c)), 30000), 'states would be shown as current forever');
  await ha.mode('ok');
  check('...and the live connection comes back', await until(() => live(c), 45000));

  await ha.mode('slow');
  const d2 = await c.req('GET', '/api/devices', null, 40000);
  check('Home Assistant slow (20 s answers): devices answer within 15 s', d2.s === 200 && d2.ms < 15000, `HTTP ${d2.s} in ${d2.ms} ms`);
  await ha.mode('500');
  await sleep(1500);
  const h2 = await haCheck(c);
  check('Home Assistant answering 500: Health says so', h2?.status === 'bad', JSON.stringify(h2)?.slice(0, 160));
  await ha.mode('flap');
  for (let i = 0; i < 6; i++) { await c.req('GET', '/api/devices', null, 30000); await sleep(4000); }
  check('Home Assistant flapping for 25 s: CasaTorch stays up', alive(srv));
  await ha.mode('ok');
  check('...and settles back to live', await until(() => live(c), 60000));

  /* ---------- damaged files after a hard stop ---------- */
  await c.req('POST', '/api/mycal', { title: 'Dentist', date: '2026-11-02', time: '09:00' });
  await c.req('POST', '/api/family/lists', { name: 'Groceries', icon: 'cart' });
  await c.req('POST', '/api/nudges', { title: 'Trash night', time: '19:30', repeat: 'weekly', days: [2] });
  await sleep(1500);   // the Family board saves a moment later
  await stopHard(srv);
  const fam = fs.readFileSync(path.join(data, 'family.json'));
  fs.writeFileSync(path.join(data, `family.json.${99999}.tmp`), fam);   // a save cut off just before its swap...
  fs.writeFileSync(path.join(data, 'family.json'), '');                  // ...left an empty file (ext4 after a power cut)
  const broken = ['events.json', 'nudges.json', 'alerts.json', 'sessions.json', 'push.json', 'household.json', 'history.json', 'replay.json', 'apptests.json', 'power-baseline.json', 'layout.json', 'security.json'];
  for (const f of broken) fs.writeFileSync(path.join(data, f), '{"half a fi');
  fs.writeFileSync(path.join(data, 'config.json'), '\0\0\0\0');   // the settings too: the settings history has them
  srv = await startOn(data, port);
  await sleep(1500);
  check('damaged files: CasaTorch starts', alive(srv));
  const c2 = client(B);
  check('damaged files: the owner can still sign in (settings put back from the history)', (await c2.login()).s === 200);
  const dr = await c2.req('GET', '/api/doctor?fresh=1', null, 60000);
  const healed = (dr.j?.healed || []).map((h) => h.what);
  check('Health lists what it repaired', healed.includes('settings-repaired') && healed.includes('data-repaired') && healed.includes('data-damaged') && (dr.j?.healed || []).some((h) => h.what === 'data-damaged' && /Your calendar/.test(h.detail)), healed.join(', '));
  const fl = await c2.req('GET', '/api/family');
  check('the save that was cut off is used (family lists kept)', JSON.stringify(fl.j || {}).includes('Groceries'), `HTTP ${fl.s}`);
  const asides = fs.readdirSync(data).filter((n) => /\.damaged-/.test(n));
  check('every damaged file is kept aside, none deleted', broken.every((f) => asides.some((a) => a.startsWith(`${f}.damaged-`))), asides.join(', '));
  for (const p of ['/api/mycal', '/api/nudges', '/api/alerts', '/api/household', '/api/layout', '/api/apptests', '/api/push']) { const r = await c2.req('GET', p); check(`after damage: ${p} answers`, r.s === 200, `HTTP ${r.s}`); }
  const ev = await c2.req('POST', '/api/mycal', { title: 'Plumber', date: '2026-11-03' });
  check('after damage: new things save again', ev.s === 200);
  check('Home Assistant is still connected after the repair', await until(() => live(c2), 30000));
  await stopSoft(srv);
  ha.child.kill();

  /* ---------- disk full ---------- */
  let tiny = null;
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    tiny = L.tmpDir('chaos-tmpfs');
    try { execFileSync('mount', ['-t', 'tmpfs', '-o', 'size=8m,nr_inodes=400,mode=0700', 'tmpfs', tiny], { stdio: 'ignore' }); } catch { tiny = null; }
  }
  if (!tiny) console.log('  (disk-full checks skipped: this needs root on Linux to make a small RAM disk)');
  else {
    let s2 = null;
    try {
      const d = path.join(tiny, 'data'), p2 = await L.freePort(), B2 = `http://127.0.0.1:${p2}`;
      fs.mkdirSync(d, { mode: 0o700 });
      s2 = await startOn(d, p2);
      const k = client(B2);
      check('disk full: set up on the small disk', await setUp(k, null));
      await k.req('POST', '/api/mycal', { title: 'Before full', date: '2026-11-02' });
      const filler = path.join(tiny, 'filler');
      const fill = () => {   // every last page: one big file, then tiny ones until nothing more fits (anything freed meanwhile is taken too)
        try { execFileSync('dd', ['if=/dev/zero', `of=${filler}`, 'bs=64k', 'oflag=append', 'conv=notrunc'], { stdio: 'ignore' }); } catch { /* stops when full: that's the point */ }
        for (let i = 0; i < 2000; i++) { try { fs.writeFileSync(path.join(tiny, `f${Date.now()}-${i}`), 'x'.repeat(4096)); } catch { try { fs.writeFileSync(path.join(tiny, `g${Date.now()}-${i}`), 'x'); } catch { break; } } }
        for (let i = 0; i < 500; i++) { try { fs.writeFileSync(path.join(tiny, `g${Date.now()}-e${i}`), ''); } catch { break; } }   // and every file slot, so nothing freed in between lets a save through
      };
      fill();
      const e1 = await k.req('POST', '/api/mycal', { title: 'While full', date: '2026-11-03' });
      check('disk full: saving says it failed (no crash)', e1.s >= 400 && e1.s < 600 && alive(s2), `HTTP ${e1.s}`);
      fill();
      for (const p of ['/api/family/lists', '/api/nudges']) await k.req('POST', p, p.includes('nudges') ? { title: 'X', time: '10:00' } : { name: 'X' });
      await sleep(3000);   // the saves that happen a moment later
      const dr2 = await k.req('GET', '/api/doctor?fresh=1', null, 60000);
      const dc = dr2.j?.checks?.find((x) => x.id === 'data'), sc = dr2.j?.checks?.find((x) => x.id === 'storage');
      check('disk full: Health says the disk is full', dc?.status === 'bad' && /full/i.test(dc.detail) && sc?.status === 'bad', `${dc?.detail} / ${sc?.detail}`);
      check('disk full: nothing half-written left behind', !fs.readdirSync(d).some((n) => n.endsWith('.tmp')), fs.readdirSync(d).join(','));
      const ev2 = JSON.parse(fs.readFileSync(path.join(d, 'events.json'), 'utf8'));
      check('disk full: the calendar file is intact', Array.isArray(ev2) && ev2.some((e) => e.title === 'Before full'));
      await sleep(5000);
      check('disk full: still running', alive(s2));
      for (const n of fs.readdirSync(tiny)) if (/^(filler|f\d|g\d)/.test(n)) fs.rmSync(path.join(tiny, n), { force: true });
      const e2 = await k.req('POST', '/api/mycal', { title: 'After freeing', date: '2026-11-04' });
      check('disk full: saving works again once there is space', e2.s === 200, `HTTP ${e2.s}`);
      await stopSoft(s2);
      s2 = await startOn(d, p2);
      const k2 = client(B2); await k2.login();
      const all = await k2.req('GET', '/api/mycal');
      check('disk full: after a restart everything saved is there', ['Before full', 'After freeing'].every((t) => JSON.stringify(all.j).includes(t)));
      await stopSoft(s2);
    } finally { if (s2) await stopHard(s2); try { execFileSync('umount', [tiny], { stdio: 'ignore' }); } catch { /* best effort */ } }
  }
  finish();
} catch (e) { finish(e); }
