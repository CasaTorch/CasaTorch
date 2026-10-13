/*
 * The dashboard's source is split by feature into src/server/*.js and
 * src/client/*.js; this joins each set, in file-name order, into the single
 * server.js and public/app.js that actually run. Nothing is transformed - the
 * pieces are the original file cut at section boundaries - so the result is
 * one module with one scope, exactly as before.
 *
 *   node build.mjs          build once (the Docker image does this)
 *   node build.mjs --check  fail if a piece does not parse
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const join = (dir) => fs.readdirSync(path.join(here, dir)).filter((f) => f.endsWith('.js')).sort()
  .map((f) => fs.readFileSync(path.join(here, dir, f), 'utf8').replace(/\n$/, '')).join('\n');

const outputs = [
  ['src/server', 'server.js'],
  ['src/client', 'public/app.js'],
];
for (const [dir, out] of outputs) {
  const text = join(dir);
  const target = path.join(here, out);
  const old = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (old !== text) fs.writeFileSync(target, text);
  console.log(`  ${out}: ${text.split('\n').length} lines from ${fs.readdirSync(path.join(here, dir)).filter((f) => f.endsWith('.js')).length} files${old === text ? ' (unchanged)' : ''}`);
}
