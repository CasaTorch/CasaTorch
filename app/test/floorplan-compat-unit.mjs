/* The 3D home's code stays runnable on the oldest browsers it supports (Chrome/Edge 94, Safari 16.4, Firefox 108 - the
   floor set by three.js and import maps), and newer CSS has a fallback. A quick text check of public/floorplan*.{js,css};
   the browser check is test/floorplan-compat-browser.cjs. Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function compatTests(t) {
  const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const files = fs.readdirSync(PUB).filter((f) => /^floorplan[\w-]*\.(js|css)$/.test(f));
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');   // comments out (roughly)
  const src = Object.fromEntries(files.map((f) => [f, strip(fs.readFileSync(path.join(PUB, f), 'utf8'))]));

  t('3D compatibility: no JavaScript newer than Chrome 94 / Safari 16.4 without a fallback', () => {
    const NEWER = [[/\bstructuredClone\s*\(/, 'structuredClone (Chrome 98)'], [/\.findLast(Index)?\s*\(/, 'findLast (Chrome 97)'], [/\.(toSorted|toReversed|toSpliced)\s*\(/, 'change-array-by-copy (Chrome 110)'],
      [/\bObject\.groupBy\b|\bMap\.groupBy\b/, 'groupBy (Chrome 117)'], [/\bPromise\.withResolvers\b/, 'Promise.withResolvers (Chrome 119)'], [/\.at\(\s*-/, 'Array.prototype.at with a negative index (Safari 15.4 ok, but prefer [length - 1])'],
      [/^\s*await\s/m, 'top-level await'], [/\bAbortSignal\.(timeout|any)\b/, 'AbortSignal.timeout/any (Chrome 103/116)'], [/\.showPopover\(|\bpopover=/, 'popover (Chrome 114)']];
    const bad = [];
    for (const [f, s] of Object.entries(src)) if (f.endsWith('.js')) for (const [re, what] of NEWER) {
      if (what === 'top-level await') { const outside = s.split('\n').filter((l) => /^await\s/.test(l)); if (outside.length) bad.push(`${f}: ${what}`); continue; }
      if (re.test(s)) bad.push(`${f}: ${what}`);
    }
    assert.deepEqual(bad, []);
  });
  t('3D compatibility: no CSS that drops whole rules on older browsers', () => {
    const bad = [];
    for (const [f, s] of Object.entries(src)) {
      const css = f.endsWith('.css') ? s : (s.match(/`[^`]*\{[^`]*\}[^`]*`/g) || []).join('\n');   // CSS kept in a module's template string
      if (/@container|container-type\s*:/.test(css)) bad.push(`${f}: container queries (Chrome 105)`);
      for (const m of css.matchAll(/([^{}]*):has\(([^{}]*)\{/g)) if (m[0].includes(',')) bad.push(`${f}: :has() in a selector list - the whole rule is dropped without it`);
      if (/@layer\b/.test(css)) bad.push(`${f}: @layer (Chrome 99)`);
      if (/\b(?:\d+)?(dvh|svh|lvh)\b/.test(css)) bad.push(`${f}: dynamic viewport units (Chrome 108)`);
    }
    assert.deepEqual(bad, []);
  });
  t('3D compatibility: the page starts through the browser check, which stands in for color-mix()', () => {
    const html = fs.readFileSync(path.join(PUB, 'floorplan.html'), 'utf8'), compat = strip(fs.readFileSync(path.join(PUB, 'floorplan-compat.js'), 'utf8'));
    assert.match(html, /<script src="floorplan-compat\.js"><\/script>/);
    assert.doesNotMatch(html, /<script type="module"/, 'floorplan.js is started by floorplan-compat.js, after the check');
    assert.match(compat, /type = 'module'; s\.src = 'floorplan\.js'/);
    assert.match(compat, /color-mix\(in srgb, red 50%, blue\)/);
    assert.doesNotMatch(compat, /=>|\bconst\b|\blet\b|`/, 'floorplan-compat.js is plain old JavaScript (it must run where the rest cannot)');
    assert.match(fs.readFileSync(path.join(PUB, 'floorplan.js'), 'utf8'), /window\.__casa3dReady = true/);
  });
}
