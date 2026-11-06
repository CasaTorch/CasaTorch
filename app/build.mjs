/*
 * The dashboard's source is split by feature into src/server/*.js and
 * src/client/*.js; this joins each set, in file-name order, into the single
 * server.js and public/app.js that actually run. Nothing is transformed - the
 * pieces are the original file cut at section boundaries - so the result is
 * one module with one scope, exactly as before.
 *
 * A few big pages are their own file (CHUNKS below: public/app-<page>.js), loaded the first time that page opens
 * (19-lazy.js). They're classic scripts like app.js, so they share its one global scope: everything app.js
 * declares is there for them, and what they declare joins it once loaded. Only the page's own code goes in a
 * chunk - anything another page uses lives in app.js (22e-energy-core.js, 25n-network-core.js), and
 * test/unit.mjs checks that nothing outside a chunk names what it declares. app.js and each chunk carry the same
 * build id, so a chunk from another version is never used with this app.js (the page reloads instead).
 *
 *   node build.mjs          build once (the Docker image does this)
 *   node build.mjs --check  fail if a piece does not parse
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHUNKS = { network: ['21-apptests.js', '26-network.js'], energy: ['23-energy.js'] };
const inChunk = new Set(Object.values(CHUNKS).flat());
const list = (dir) => fs.readdirSync(path.join(here, dir)).filter((f) => f.endsWith('.js')).sort();
const read = (dir, f) => fs.readFileSync(path.join(here, dir, f), 'utf8').replace(/\n$/, '');
const join = (dir, files) => files.map((f) => read(dir, f)).join('\n');

const client = list('src/client');
const build = crypto.createHash('sha256').update(client.map((f) => `${f}\n${read('src/client', f)}`).join('\n')).digest('hex').slice(0, 12);
const outputs = [
  ['src/server', 'server.js', list('src/server'), (t) => t],
  ['src/client', 'public/app.js', client.filter((f) => !inChunk.has(f)), (t) => t.replace("'__CHUNK_BUILD__'", `'${build}'`)],
  ...Object.entries(CHUNKS).map(([name, files]) => ['src/client', `public/app-${name}.js`, files, (t) => `${t}\n;(window.__ctChunk ||= {})[${JSON.stringify(name)}] = '${build}';`]),
];
if (!client.includes('19-lazy.js')) throw new Error('src/client/19-lazy.js (the chunk loader) is missing');
for (const [dir, out, files, finish] of outputs) {
  const text = finish(join(dir, files));
  const target = path.join(here, out);
  const old = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (old !== text) fs.writeFileSync(target, text);
  console.log(`  ${out}: ${text.split('\n').length} lines from ${files.length} files${old === text ? ' (unchanged)' : ''}`);
}
