#!/usr/bin/env node
/*
 * Pins the vendored front-end files (three.js, served at /vendor/three) by their SHA-384:
 * app/catalog/vendor-integrity.json lists every file the dashboard and the 3D home load - the modules they import,
 * everything those import in turn, and the Draco/Basis decoders - with its hash. The server serves only those files,
 * and only while they still match (01-security.js), and floorplan.html's import map carries the same hashes, so the
 * browser checks them too. Run it after moving three.js to a new version:
 *
 *   node tools/make-vendor-integrity.mjs          write the list (and the import map's hashes)
 *   node tools/make-vendor-integrity.mjs --check  fail if either is out of date (test/supply-chain-unit.mjs runs this)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app'), THREE = path.join(APP, 'node_modules', 'three'), PUB = path.join(APP, 'public');
const OUT = path.join(APP, 'catalog', 'vendor-integrity.json'), HTML = path.join(PUB, 'floorplan.html');
const check = process.argv.includes('--check');

/* Where the front end starts: what it imports through the import map, plus the decoders it points the loaders at. */
const front = [...fs.readdirSync(PUB).filter((f) => /\.(js|html)$/.test(f)), ...fs.readdirSync(path.join(APP, 'src', 'client')).map((f) => `../src/client/${f}`)];
const seeds = new Set(['build/three.module.js']);
for (const f of front) {
  const t = fs.readFileSync(path.join(PUB, f), 'utf8');
  for (const m of t.matchAll(/['"]three\/addons\/([\w./-]+\.js)['"]/g)) seeds.add(`examples/jsm/${m[1]}`);
  for (const m of t.matchAll(/['"]\/vendor\/three\/([\w./-]+\.js)['"]/g)) seeds.add(m[1]);
}
for (const d of ['examples/jsm/libs/draco', 'examples/jsm/libs/basis']) for (const f of fs.readdirSync(path.join(THREE, d))) if (/\.(js|wasm)$/.test(f)) seeds.add(`${d}/${f}`);

/* Everything those import, relatively or as "three" (followed until nothing new turns up). */
const files = new Set(), todo = [...seeds];
while (todo.length) {
  const rel = todo.pop(); if (files.has(rel)) continue;
  const abs = path.join(THREE, rel);
  if (!fs.existsSync(abs)) throw new Error(`three.js has no ${rel}`);
  files.add(rel);
  if (!rel.endsWith('.js')) continue;
  const t = fs.readFileSync(abs, 'utf8');
  for (const m of t.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)) {
    const s = m[1];
    if (s === 'three') { todo.push('build/three.module.js'); continue; }
    if (s.startsWith('three/addons/')) { todo.push(`examples/jsm/${s.slice(13)}`); continue; }
    if (s.startsWith('.')) todo.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), s)));
  }
}
const sri = (rel) => `sha384-${crypto.createHash('sha384').update(fs.readFileSync(path.join(THREE, rel))).digest('base64')}`;
const version = JSON.parse(fs.readFileSync(path.join(THREE, 'package.json'), 'utf8')).version;
const list = { package: 'three', version, files: Object.fromEntries([...files].sort().map((f) => [f, sri(f)])) };
const text = `${JSON.stringify(list, null, 1)}\n`;

/* The import map: same URLs, same hashes (browsers that know "integrity" check every module they load). */
const html = fs.readFileSync(HTML, 'utf8');
const integrity = Object.fromEntries(Object.entries(list.files).filter(([f]) => f.endsWith('.js')).map(([f, h]) => [`/vendor/three/${f}`, h]));
const map = `<script type="importmap">${JSON.stringify({ imports: { three: '/vendor/three/build/three.module.js', 'three/addons/': '/vendor/three/examples/jsm/' }, integrity })}</script>`;
const newHtml = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, map);

if (check) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const bad = [old !== text && 'app/catalog/vendor-integrity.json', newHtml !== html && 'the import map in app/public/floorplan.html'].filter(Boolean);
  if (bad.length) { console.error(`out of date: ${bad.join(', ')} - run node tools/make-vendor-integrity.mjs`); process.exit(1); }
  console.log(`vendor integrity: ${files.size} three.js ${version} files pinned`);
} else {
  fs.writeFileSync(OUT, text); fs.writeFileSync(HTML, newHtml);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${files.size} files, three.js ${version}) and the import map`);
}
