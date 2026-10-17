#!/usr/bin/env node
/*
 * Everything in one go (what `npm test` in app/ runs, and what CI runs):
 *   build -> syntax check -> unit tests -> security checks (own temp server) -> setup wizard end-to-end
 *   (with mock Home Assistant) -> setup wizard end-to-end without Home Assistant.
 *
 *   node tools/test-all.mjs                 everything
 *   node tools/test-all.mjs --no-e2e        skip the browser tests (or SKIP_E2E=1)
 *   node tools/test-all.mjs --only=unit,security
 * Each test starts its own servers on free ports and cleans up. Screenshots: $SHOTS (default <temp>/casatorch-test-results).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const noE2e = args.includes('--no-e2e') || process.env.SKIP_E2E === '1';

const STEPS = [
  ['build', APP, ['build.mjs']],
  ['syntax', APP, ['-e', "for (const f of ['server.js','public/app.js','public/setup.js','public/floorplan.js','public/login.js']) require('node:child_process').execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' })"]],
  ['unit', APP, ['test/unit.mjs']],
  ['security', ROOT, ['tools/test-security.mjs']],
  ['e2e-wizard', ROOT, ['tools/test-setup-wizard.cjs'], true],
  ['e2e-noha', ROOT, ['tools/test-setup-noha.cjs'], true],
];

const run = (name, cwd, argv, limitMs) => new Promise((ok) => {
  const t0 = Date.now();
  const child = spawn(process.execPath, argv, { cwd, stdio: 'inherit', env: process.env });
  const timer = setTimeout(() => { console.error(`\n${name}: timed out after ${limitMs / 1000}s`); child.kill('SIGTERM'); }, limitMs);
  child.on('exit', (code, sig) => { clearTimeout(timer); ok({ name, ok: code === 0, code: code ?? sig, secs: (Date.now() - t0) / 1000 }); });
});

const results = [];
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));   // children get the same signal from the terminal
for (const [name, cwd, argv, e2e] of STEPS) {
  if (only.length && !only.includes(name)) continue;
  if (e2e && noE2e) { results.push({ name, ok: true, skipped: true, secs: 0 }); continue; }
  console.log(`\n=== ${name} ===`);
  const r = await run(name, cwd, argv, Number(process.env.TEST_STEP_TIMEOUT) || 240_000);
  results.push(r);
  if (!r.ok && name === 'build') break;   // nothing else can run without a build
}
console.log('\n=== summary ===');
for (const r of results) console.log(`${r.skipped ? 'skip' : r.ok ? ' ok ' : 'FAIL'}  ${r.name.padEnd(11)} ${r.skipped ? '' : `${r.secs.toFixed(1)}s`}${r.ok ? '' : `  (exit ${r.code})`}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} failed: ${failed.map((r) => r.name).join(', ')}` : `\nall ${results.filter((r) => !r.skipped).length} passed`);
process.exit(failed.length ? 1 : 0);
