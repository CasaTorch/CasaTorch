/* Unit tests for the pages loaded the first time they open (build.mjs CHUNKS, src/client/19-lazy.js): a chunk holds only
   its own page - nothing outside it names what it declares, and it runs nothing at load but tile and drawer
   registrations - it carries app.js's build id, the dashboard page names it by its contents' name, and the web
   app's offline copy keeps it. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(APP, 'src', 'client');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

export default async function lazyTests(t) {
  const CHUNKS = vm.runInNewContext(`(${/const CHUNKS = (\{[^\n]*\});/.exec(fs.readFileSync(path.join(APP, 'build.mjs'), 'utf8'))[1]})`);
  const inChunk = new Set(Object.values(CHUNKS).flat());
  const files = fs.readdirSync(CLIENT).filter((f) => f.endsWith('.js')).sort();

  t('lazy pages: Network (with App tests) and Energy are their own files; Family stays (its tiles are on Home)', () => {
    assert.deepEqual(Object.keys(CHUNKS).sort(), ['energy', 'network']);
    for (const f of inChunk) assert.ok(files.includes(f), f);
    assert.ok(!inChunk.has('38-family.js'));
  });

  t('lazy pages: nothing outside a chunk names what the chunk declares (only its tab, through lazyTab)', () => {
    for (const [name, list] of Object.entries(CHUNKS)) {
      const names = new Set();
      for (const f of list) for (const m of fs.readFileSync(path.join(CLIENT, f), 'utf8').matchAll(/^(?:async\s+)?function\s*\*?\s*([\w$]+)|^(?:const|let|var|class)\s+([\w$]+)/gm)) names.add(m[1] || m[2]);
      assert.ok(names.size > 10, name);
      for (const g of files.filter((x) => !inChunk.has(x))) {
        const src = strip(fs.readFileSync(path.join(CLIENT, g), 'utf8')).split('\n').filter((l) => !/lazyTab\(/.test(l)).join('\n');
        for (const n of names) assert.doesNotMatch(src, new RegExp(`(?<![\\w$.'"])${n.replace(/\$/g, '\\$')}(?![\\w$])`), `${g} uses ${n} from the ${name} chunk: move it to a core file`);
      }
    }
  });

  t('lazy pages: a chunk runs nothing at load but tile, drawer and route registrations', () => {
    for (const f of inChunk) {
      const calls = [...strip(fs.readFileSync(path.join(CLIENT, f), 'utf8')).matchAll(/^([A-Za-z_$][\w$.]*)\s*\(/gm)].map((m) => m[1]);
      for (const c of calls) assert.ok(['pageTile', 'tileDrawer', 'drawerRoute'].includes(c), `${f}: ${c}(...) at load`);
    }
  });

  t('lazy pages: app.js and every chunk carry the same build id; the tabs wait for their file', () => {
    const pub = path.join(APP, 'public'), app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
    const id = /const CHUNK_BUILD = '([0-9a-f]{12})'/.exec(app)?.[1];
    assert.ok(id, 'the build id is filled in');
    for (const name of Object.keys(CHUNKS)) {
      const c = fs.readFileSync(path.join(pub, `app-${name}.js`), 'utf8');
      assert.ok(c.trimEnd().endsWith(`;(window.__ctChunk ||= {})["${name}"] = '${id}';`), name);
      assert.doesNotMatch(app, new RegExp(`^(?:async )?function ${name}Page\\(`, 'm'), `${name}Page is in the chunk, not app.js`);
      assert.match(app, new RegExp(`tab\\(\\{ id: '${name}'[^\\n]*lazyTab\\('${name}'`));
    }
  });

  t('lazy pages: index.html names each chunk by its contents\' name, and the offline copy keeps it', () => {
    const A = globalThis.__casatorchAssets, html = A.withHashedAssets(fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8'));
    const sw = fs.readFileSync(path.join(APP, 'public', 'sw.js'), 'utf8');
    const kept = new RegExp(/html\.matchAll\(\/(.*)\/g\)/.exec(sw)[1].replace(/\\\//g, '/'), 'g');
    const refs = [...html.matchAll(kept)].map((m) => m[1]);
    for (const name of Object.keys(CHUNKS)) {
      const m = new RegExp(`<link rel="prefetch" as="script" href="(app-${name}\\.[0-9a-f]{10}\\.js)" data-chunk="${name}">`).exec(html);
      assert.ok(m, `${name} is named in index.html with its hash`);
      assert.ok(refs.includes(m[1]), `the service worker keeps ${m[1]}`);
      assert.ok(A.HASHED_ASSET.test(`/${m[1]}`), 'served as a year-long, content-named file');
    }
    assert.doesNotMatch(html, /<script>(?!try\{var t=localStorage)/, 'no new inline script (the CSP allows none but the theme line)');
  });

  t('lazy pages: the loader adds one same-origin script per chunk, retries after a failed download, and a Home tile waits for its drawer', async () => {
    const src = fs.readFileSync(path.join(APP, 'public', 'app.js'), 'utf8');
    const lazy = /\/\* ---- Pages loaded the first time they open ----[\s\S]*?const lazyTab = [^\n]*\n/.exec(src)[0];
    const added = [];
    const doc = { head: { append: (s) => added.push(s) }, querySelectorAll: () => [{ dataset: { chunk: 'energy' }, getAttribute: () => 'app-energy.0123456789.js' }], createElement: () => ({ remove() {} }) };
    const ctx = { document: doc, window: {}, T: (s) => s, location: { reload() { ctx.reloaded = true; } }, sessionStorage: { getItem: () => null, setItem() {} }, Promise, Object, Error };
    vm.runInNewContext(`${lazy}\nthis.L = { appChunk, chunkReady, CHUNK_BUILD };`, ctx);
    const { L } = ctx;
    const first = L.appChunk('energy'); assert.equal(L.appChunk('energy'), first, 'one download at a time');
    assert.equal(added.length, 1); assert.equal(added[0].src, 'app-energy.0123456789.js');
    added[0].onerror(); await assert.rejects(first, (e) => e.retry === true);
    const again = L.appChunk('energy'); assert.equal(added.length, 2, 'tried again after a failure');
    ctx.window.__ctChunk = { energy: L.CHUNK_BUILD }; added[1].onload(); await again;
    assert.equal(L.chunkReady('energy'), true);
    // a file from another version: the page reloads (once)
    const other = L.appChunk('network'); ctx.window.__ctChunk.network = 'other'; added[2].onload(); assert.equal(ctx.reloaded, true); void other;
    const drawer = fs.readFileSync(path.join(CLIENT, '06d-drawer.js'), 'utf8');
    assert.match(drawer, /CHUNK_DRAWERS\[w\.id\][\s\S]{0,200}appChunk\(chunk\)[\s\S]{0,120}waited: true/, 'the Energy tile on Home opens the Energy drawer');
  });
}
