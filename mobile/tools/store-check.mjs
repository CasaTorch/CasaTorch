#!/usr/bin/env node
// Checks the store texts in mobile/store against the App Store and Google Play length limits.
import fs from 'node:fs';
import path from 'node:path';
const store = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'store');
const LIMITS = {
  'app-store/en-US/name.txt': 30, 'app-store/en-US/subtitle.txt': 30, 'app-store/en-US/promotional_text.txt': 170, 'app-store/en-US/description.txt': 4000,
  'app-store/en-US/keywords.txt': 100, 'app-store/en-US/release_notes.txt': 4000,
  'google-play/en-US/title.txt': 30, 'google-play/en-US/short_description.txt': 80, 'google-play/en-US/full_description.txt': 4000, 'google-play/en-US/changelogs/900.txt': 500,
};
let bad = 0;
for (const [f, max] of Object.entries(LIMITS)) {
  const p = path.join(store, f);
  if (!fs.existsSync(p)) { console.log(`missing: ${f}`); bad++; continue; }
  const n = [...fs.readFileSync(p, 'utf8').trim()].length;
  if (n > max) { console.log(`too long (${n}/${max}): ${f}`); bad++; }
}
console.log(bad ? `${bad} problem(s)` : 'store texts OK');
process.exit(bad ? 1 : 0);
