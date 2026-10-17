/*
 * Shared helpers for the end-to-end tests (tools/test-setup-*.cjs, tools/test-all.mjs).
 *
 *  - findPlaywright(): Playwright from $PLAYWRIGHT, app/node_modules, or a cached copy it installs once
 *    into the OS temp folder (npm install --no-save). The browser is Chromium: $CHROME_PATH if set, else
 *    Playwright's own (npx playwright install chromium).
 *  - freePort(): a free TCP port. $TEST_PORT_BASE=18290 scans upward from there instead of asking the OS.
 *  - startCasaTorch({ env }): a fresh CasaTorch (its own temp data folder) on a free port, waits for /api/health.
 *  - startMockHa(): tools/mock-ha.mjs on a free port.
 *  - stopAll(): stops everything this process started and removes the temp folders (also on Ctrl-C / crash).
 * Nothing here talks to the internet except the one-time Playwright install.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const PW_VERSION = process.env.PLAYWRIGHT_VERSION || '1.56.1';
const children = new Set(), tmpDirs = new Set(), usedPorts = new Set(), logs = [];

function findPlaywright() {
  const tries = [process.env.PLAYWRIGHT, path.join(APP, 'node_modules', 'playwright'), 'playwright', path.join(os.tmpdir(), `casatorch-pw-${PW_VERSION}`, 'node_modules', 'playwright')].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* next */ } }
  const dir = path.join(os.tmpdir(), `casatorch-pw-${PW_VERSION}`);
  console.log(`  (installing Playwright ${PW_VERSION} once into ${dir})`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--loglevel=error', '--prefix', dir, `playwright@${PW_VERSION}`], { stdio: 'inherit' });
  return require(path.join(dir, 'node_modules', 'playwright'));
}

const QUIET = ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-features=AutofillServerCommunication,OptimizationHints,MediaRouter'];
async function launchBrowser() {
  const { chromium } = findPlaywright();
  const exe = process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') && !process.env.CI ? '/opt/pw-browsers/chromium' : undefined);
  try { return await chromium.launch({ executablePath: exe, headless: true, args: QUIET }); } catch (e) { if (!exe) throw e; return chromium.launch({ headless: true, args: QUIET }); }
}

/* English, a fixed time zone, a desktop-sized window: the tests read English text. */
async function newEnglishPage(browser) {
  const ctx = await browser.newContext({ locale: 'en-US', timezoneId: 'America/Los_Angeles', viewport: { width: 900, height: 1000 }, extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(Number(process.env.E2E_TIMEOUT) || 15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_|status of 40[13]/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return { ctx, page, errors };
}

/* The input of a wizard field by its label's start (labels may end in "(optional)"). */
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function field(page, label, scope = 'main') {
  return page.locator(`${scope} .field`).filter({ has: page.locator(':scope > label', { hasText: new RegExp(`^\\s*${esc(label)}(\\s*\\(optional\\))?\\s*$`) }) }).locator('input, textarea, select').first();
}

const portFree = (port) => new Promise((ok) => { const s = net.createServer(); s.once('error', () => ok(false)); s.listen(port, '127.0.0.1', () => s.close(() => ok(true))); });
async function freePort() {
  const base = Number(process.env.TEST_PORT_BASE) || 0;
  if (base) {
    for (let p = base; p < base + 200; p++) if (!usedPorts.has(p) && await portFree(p)) { usedPorts.add(p); return p; }
    throw new Error(`no free port from ${base}`);
  }
  for (;;) {
    const p = await new Promise((ok, no) => { const s = net.createServer(); s.once('error', no); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
    if (!usedPorts.has(p)) { usedPorts.add(p); return p; }
  }
}

function tmpDir(name) { const d = fs.mkdtempSync(path.join(os.tmpdir(), `casatorch-${name}-`)); tmpDirs.add(d); return d; }

function track(child, name, logFile) {
  children.add(child);
  const out = fs.createWriteStream(logFile);
  child.stdout.pipe(out); child.stderr.pipe(out);
  child.on('exit', () => children.delete(child));
  child.logFile = logFile; child.label = name; logs.push(logFile);
  return child;
}

async function waitFor(url, ms = 30000, child) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child && child.exitCode != null) throw new Error(`${child.label} stopped (exit ${child.exitCode}) - log: ${child.logFile}\n${tail(child.logFile)}`);
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok) return r; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not answer in ${ms / 1000}s${child ? ` - log: ${child.logFile}\n${tail(child.logFile)}` : ''}`);
}
const tail = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').slice(-25).join('\n'); } catch { return ''; } };

/* A fresh CasaTorch: app/server.js must be built (node build.mjs) first. */
async function startCasaTorch({ name = 'e2e', env = {} } = {}) {
  if (!fs.existsSync(path.join(APP, 'server.js'))) throw new Error('app/server.js is missing - run: cd app && node build.mjs');
  const port = await freePort(), data = tmpDir(`${name}-data`);
  const child = track(spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, CASATORCH_DATA_DIR: data, PORT: String(port), CASATORCH_DEMO: '', NODE_ENV: 'test', ...env }, stdio: ['ignore', 'pipe', 'pipe'] }), `CasaTorch (${name})`, path.join(data, '..', `${path.basename(data)}.log`));
  tmpDirs.add(child.logFile);
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, 45000, child);
  return { base, port, data, child };
}

/* A made-up token of real length (CasaTorch refuses short ones); mock-ha.mjs accepts it via MOCK_HA_TOKEN. */
const HA_TOKEN = process.env.MOCK_HA_TOKEN || `mock.${'x'.repeat(64)}.token`;
async function startMockHa() {
  const port = await freePort(), log = path.join(os.tmpdir(), `casatorch-mock-ha-${port}.log`); tmpDirs.add(log);
  const child = track(spawn(process.execPath, [path.join(ROOT, 'tools', 'mock-ha.mjs'), String(port)], { env: { ...process.env, MOCK_HA_TOKEN: HA_TOKEN }, stdio: ['ignore', 'pipe', 'pipe'] }), 'mock Home Assistant', log);
  const base = `http://127.0.0.1:${port}`;
  const end = Date.now() + 15000;
  while (Date.now() < end) { try { await fetch(`${base}/api/`, { signal: AbortSignal.timeout(1000) }); return { base, port, child }; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  throw new Error('mock Home Assistant did not start');
}

function stopAll() {
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  children.clear();
  if (process.env.KEEP_TEST_DATA) return;
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  tmpDirs.clear();
}
/* Stop the servers, wait until they have exited (CasaTorch writes a last file as it stops), then tidy up. */
const shotsDir = () => process.env.SHOTS || path.join(os.tmpdir(), 'casatorch-test-results');
async function shutdown(failed = false) {
  const waits = [...children].map((c) => new Promise((ok) => { if (c.exitCode != null || c.signalCode) return ok(); c.once('exit', ok); try { c.kill('SIGTERM'); } catch { ok(); } setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } ok(); }, 5000); }));
  await Promise.all(waits);
  if (failed) for (const f of logs) { try { fs.mkdirSync(shotsDir(), { recursive: true }); fs.copyFileSync(f, path.join(shotsDir(), path.basename(f))); console.error(`  server log kept: ${path.join(shotsDir(), path.basename(f))}`); } catch { /* none */ } }
  stopAll();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); process.exit(130); });
process.on('exit', stopAll);

/* Screenshots: $SHOTS (default: <temp>/casatorch-test-results), which CI uploads on failure. */
function shooter(page, prefix) {
  const dir = shotsDir();
  fs.mkdirSync(dir, { recursive: true });
  return (n) => page.screenshot({ path: path.join(dir, `${prefix}-${n}.png`), fullPage: true }).catch(() => {});
}

/* A tiny runner: named checks, a clear summary, exit code 1 on any failure. */
function runner(title) {
  const t0 = Date.now(); let passed = 0;
  const check = (name, cond, detail = '') => {
    if (!cond) throw new Error(`${name}${detail ? ` - ${detail}` : ''}`);
    passed++; console.log(`  ok  ${name}`);
  };
  const finish = (err, onFail) => {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (err) {
      console.error(`  FAIL ${err.message.split('\n')[0]}`);
      if (err.message.includes('\n') || err.stack) console.error(String(err.stack || err.message).split('\n').slice(1, 8).join('\n'));
      return Promise.resolve(onFail?.()).catch(() => {}).then(() => shutdown(true)).then(() => { console.error(`${title}: FAILED after ${passed} checks (${secs}s)`); process.exit(1); });
    }
    console.log(`${title}: ${passed} checks passed (${secs}s)`); return shutdown().then(() => process.exit(0));
  };
  console.log(title);
  return { check, finish };
}

module.exports = { shutdown, HA_TOKEN, field, ROOT, APP, findPlaywright, launchBrowser, newEnglishPage, freePort, tmpDir, startCasaTorch, startMockHa, stopAll, shooter, runner, waitFor };
