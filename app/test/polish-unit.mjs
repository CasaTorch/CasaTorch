/* Unit tests for the polish pass: the new parts are readable in all eight themes (WCAG AA), they move only when motion
   is welcome, and something that didn't load says so in its place with Try again (src/client/05-grid.js tileFail,
   00-core.js pageStale). Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

export default async function polishTests(t) {
  const L = globalThis.__casatorchLook, themes = L.lkThemes(), rgb = (th, k) => L.lkParseRgba(th.tokens[k]);
  const mix = (a, b, p) => [0, 1, 2].map((i) => Math.round(a[i] * p + b[i] * (1 - p))).concat(1);
  const hex = (c) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  t('polish: the inbox count, the timeline\'s play button, inline errors and the "behind" note pass AA in every theme', () => {
    const fails = [];
    for (const th of themes) {
      const page = L.lkOver(rgb(th, 'bg'), [0, 0, 0, 1]), solid = L.lkOver(rgb(th, 'solid'), [0, 0, 0, 1]), glass = L.lkOver(rgb(th, 'surface'), L.lkParseRgba(page));
      const pairs = {
        'inbox count (page color on --bad)': [th.tokens.bg.startsWith('#') ? th.tokens.bg : hex(L.lkParseRgba(page)), th.tokens.bad],
        'play button': [th.tokens['on-accent'], th.tokens.accent],
        'tile error text': [th.tokens.text, hex(mix(rgb(th, 'bad'), L.lkParseRgba(solid), 0.09))],
        'tile error detail': [th.tokens.muted, hex(mix(rgb(th, 'bad'), L.lkParseRgba(solid), 0.09))],
        'behind note': [th.tokens.text, hex(mix(rgb(th, 'warn'), L.lkParseRgba(glass), 0.10))],
        'unread inbox row': [th.tokens.text, hex(mix(rgb(th, 'accent'), L.lkParseRgba(L.lkOver(rgb(th, 'surface-2'), L.lkParseRgba(solid))), 0.08))],
      };
      for (const [name, [fg, bg]] of Object.entries(pairs)) { const c = L.lkContrast(fg, typeof bg === 'string' ? bg : hex(bg)); if (c < 4.5) fails.push(`${th.id}: ${name} ${c.toFixed(2)}`); }
    }
    assert.deepEqual(fails, []);
  });
  t('polish: every animation stops when the device asks for less motion', () => {
    const css = fs.readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation-duration: \.01ms !important; transition-duration: \.01ms !important; \} \}/);
    const tail = css.slice(css.indexOf('/* ---- Timeline (24t-timeline.js) ---- */'));
    assert.doesNotMatch(tail, /@keyframes|animation:/, 'the new parts add no motion of their own');
  });
  t('polish: a tile that fails says so with Try again; a page that can\'t update says how old it is', () => {
    const grid = fs.readFileSync(new URL('../src/client/05-grid.js', import.meta.url), 'utf8'), core = fs.readFileSync(new URL('../src/client/00-core.js', import.meta.url), 'utf8');
    assert.match(grid, /catch \(err\) \{ L\.body\.replaceChildren\(tileFail\(err, \(\) => paint\(node, true\)\)\); \}/);
    assert.match(grid, /function tileFail\(err, retry\)[\s\S]{0,600}role: 'alert'[\s\S]{0,600}T\('Try again'\)/);
    assert.match(core, /try \{ await r\(\); pageStale\(null\); \} catch \(err\) \{ if \(r === refresher && !err\?\.aborted\) pageStale\(err\); \}/);
    assert.doesNotMatch(grid + fs.readFileSync(new URL('../src/client/06d-drawer.js', import.meta.url), 'utf8'), /Could not load: \{message\}/, 'no bare message without a way to try again');
  });
}
