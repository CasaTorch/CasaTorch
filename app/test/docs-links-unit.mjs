/* Every "Learn more" link goes somewhere real: each page and #section in public/docs-links.js (the one list of links to
   casatorch.com/docs), and any casatorch.com/docs address written straight into the app's code, must exist in the
   docs sources. The sources are the site's docs-src folder: $CASATORCH_DOCS_SRC, or ../sitework/docs-src next to this
   repository. Without them (a checkout of this repository alone) the check uses fixtures/docs-anchors.json, a list of
   the docs' pages and sections; refresh it with:  node test/docs-links-unit.mjs --refresh
   Run from test/unit.mjs, or on its own:  node test/docs-links-unit.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), APP = path.resolve(HERE, '..');
const FIXTURE = path.join(HERE, 'fixtures', 'docs-anchors.json');
const docsSrc = () => [process.env.CASATORCH_DOCS_SRC, path.resolve(APP, '..', '..', 'sitework', 'docs-src'), path.resolve(APP, '..', 'sitework', 'docs-src')].find((d) => d && fs.existsSync(path.join(d, 'index.html')));
/* { 'start/setup.html': ['open', 'moving', ...], ... } from the sources: every id="..." on each page. */
function anchorsFrom(dir) {
  const out = {};
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.html')) out[path.relative(dir, p).split(path.sep).join('/')] = [...new Set([...fs.readFileSync(p, 'utf8').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))].sort(); } };
  walk(dir);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
function docsMap() {
  const win = {}; vm.runInNewContext(fs.readFileSync(path.join(APP, 'public', 'docs-links.js'), 'utf8'), { window: win, document: {} });
  return win.CasaDocs;
}
/* casatorch.com/docs/... written into the app's own code (outside the list). */
function literalLinks() {
  const files = [...fs.readdirSync(path.join(APP, 'src', 'client')).map((f) => path.join(APP, 'src', 'client', f)), ...fs.readdirSync(path.join(APP, 'src', 'server')).map((f) => path.join(APP, 'src', 'server', f)),
    ...fs.readdirSync(path.join(APP, 'public')).filter((f) => /\.(js|html)$/.test(f) && !['app.js', 'docs-links.js'].includes(f)).map((f) => path.join(APP, 'public', f)), path.join(APP, 'catalog', 'setup.json')];
  const out = [];
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/casatorch\.com\/docs\/([a-z0-9/-]+\.html)(#[\w-]+)?/g)) out.push({ where: path.relative(APP, f), page: m[1], anchor: m[2]?.slice(1) || null });
  return out;
}
function check(pages, page, anchor, what) {
  assert.ok(pages[page], `${what}: no docs page ${page}`);
  if (anchor) assert.ok(pages[page].includes(anchor), `${what}: ${page} has no section #${anchor}`);
}

export default async function docsLinksTests(t) {
  const src = docsSrc();
  const pages = src ? anchorsFrom(src) : JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  t(`docs links: every key in docs-links.js points at a real page and section (${src ? 'docs sources' : 'fixture'})`, () => {
    const D = docsMap(), keys = Object.keys(D.MAP);
    assert.ok(keys.length > 80, 'the list is there');
    for (const k of keys) { const [page, anchor] = D.MAP[k].split('#'); check(pages, page, anchor, k); }
    assert.equal(D.url('setup.protect'), 'https://casatorch.com/docs/start/setup.html#protect');
    assert.equal(D.url('no.such.key'), null, 'an unknown key makes no link');
  });
  t('docs links: casatorch.com/docs addresses in the code point at real pages and sections', () => {
    const list = literalLinks();
    for (const l of list) check(pages, l.page, l.anchor, l.where);
  });
  t('docs links: the setup steps, Settings sections and pages all have a guide', () => {
    const D = docsMap();
    const steps = JSON.parse(fs.readFileSync(path.join(APP, 'catalog', 'setup.json'), 'utf8')).steps.map((s) => s.id);
    for (const id of steps) assert.ok(D.url(`setup.${id}`), `setup step "${id}" has no docs link (add setup.${id} to public/docs-links.js)`);
    const settings = fs.readFileSync(path.join(APP, 'src', 'client', '30-settings.js'), 'utf8');
    const sections = [...(settings.match(/const SECTIONS = \[([\s\S]*?)\]\.filter/)?.[1] || '').matchAll(/^\s*\['([a-z]+)',/gm)].map((m) => m[1]);
    assert.ok(sections.length >= 10, 'found the Settings sections');
    for (const k of sections) assert.ok(D.url(`settings.${k}`), `Settings section "${k}" has no docs link`);
    const tabs = fs.readdirSync(path.join(APP, 'src', 'client')).flatMap((f) => [...fs.readFileSync(path.join(APP, 'src', 'client', f), 'utf8').matchAll(/^tab\(\{ id: '([a-z0-9]+)'/gm)].map((m) => m[1]));
    for (const id of tabs) assert.ok(D.url(`page.${id}`), `page "${id}" has no docs link`);
  });
  if (src && process.argv.includes('--refresh')) { fs.mkdirSync(path.dirname(FIXTURE), { recursive: true }); fs.writeFileSync(FIXTURE, `${JSON.stringify(pages, null, 1)}\n`); console.log(`wrote ${path.relative(APP, FIXTURE)}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let n = 0; await docsLinksTests((name, fn) => { fn(); n++; console.log('ok', name); }); console.log(`\n${n} passed`);
}
