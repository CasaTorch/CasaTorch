#!/usr/bin/env node
// Lists every string on the app's own screens (each T('…') in mobile/shell/shell.js) and, for each language in
// mobile/shell/i18n/words.js, what's still missing or no longer used. Fails (exit 1) on a translation whose {gaps}
// don't match the English, so a broken translation can't ship.
//   node mobile/tools/shell-strings.mjs          summary
//   node mobile/tools/shell-strings.mjs --tsv    every string, one per line (to hand to a translator)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const shell = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'shell');
const src = fs.readFileSync(path.join(shell, 'shell.js'), 'utf8');
const keys = new Set();
for (const m of src.matchAll(/\bT\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
const box = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(shell, 'i18n', 'words.js'), 'utf8'), box);
const words = box.window.CASA_WORDS || {};
if (process.argv.includes('--tsv')) { for (const k of [...keys].sort()) console.log(k); process.exit(0); }
const gaps = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let bad = 0;
console.log(`${keys.size} strings on the app's own screens.`);
for (const [lang, d] of Object.entries(words)) {
  const missing = [...keys].filter((k) => !d[k]), unused = Object.keys(d).filter((k) => !keys.has(k));
  const wrong = Object.entries(d).filter(([k, v]) => keys.has(k) && gaps(k) !== gaps(v));
  console.log(`${lang}: ${keys.size - missing.length}/${keys.size} translated${unused.length ? `, ${unused.length} no longer used` : ''}${wrong.length ? `, ${wrong.length} with wrong {gaps}` : ''}`);
  for (const [k] of wrong) console.log(`  wrong gaps: ${k}`);
  bad += wrong.length;
}
if (!Object.keys(words).length) console.log('No translations yet (English only) - see mobile/shell/i18n/words.js.');
process.exit(bad ? 1 : 0);
