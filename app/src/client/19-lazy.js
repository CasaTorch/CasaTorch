/* ---- Pages loaded the first time they open ----
   The biggest pages (Network with its app tests, Energy) are files of their own (build.mjs CHUNKS: public/app-<page>.js), so the
   dashboard starts with less to download and run. index.html names each one in a <link rel="prefetch"> - the
   CasaTorch gives it its contents' name there (app-network.3f2a9c1b7d.js), the browser fetches it while idle and
   keeps it a year, and the web app's offline copy keeps it with app.js - so a page opens from it even offline.
   Opening such a page waits for its file (the page skeleton shows meanwhile, then "Try again" if it can't be had).
   The 3D Home was already its own page (floorplan.html, in a frame), with three.js loaded only there. */
const CHUNK_BUILD = '__CHUNK_BUILD__';   // build.mjs: the same id is in every chunk of this version
const CHUNK_LOADS = {};
/* A Home tile whose drawer lives in a chunk (the Energy tile's drawer is the Energy page's). */
const CHUNK_DRAWERS = { energy: 'energy' };
const chunkReady = (name) => window.__ctChunk?.[name] === CHUNK_BUILD;
function chunkSrc(name) {
  const link = [...document.querySelectorAll('link[data-chunk]')].find((l) => l.dataset.chunk === name);
  return link?.getAttribute('href') || `/app-${name}.js`;
}
function appChunk(name) {
  if (chunkReady(name)) return Promise.resolve();
  return (CHUNK_LOADS[name] ||= new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = chunkSrc(name); s.async = true;
    s.onload = () => {
      if (chunkReady(name)) return ok();
      // a file from another CasaTorch version (this tab is older than the box): load the new version, once
      let again = false; try { again = sessionStorage.getItem('casatorch-chunk-reload') !== CHUNK_BUILD; sessionStorage.setItem('casatorch-chunk-reload', CHUNK_BUILD); } catch { /* private window */ }
      if (again) { location.reload(); return; }
      no(new Error(T('CasaTorch was updated. Reload this page.')));
    };
    s.onerror = () => { delete CHUNK_LOADS[name]; s.remove(); no(Object.assign(new Error(T('This part of CasaTorch didn\'t download.')), { retry: true })); };
    document.head.append(s);
  }));
}
/** A tab whose page is a chunk: its file first, then the page (the router shows the skeleton, or loadFail with Try again). */
const lazyTab = (name, draw) => async (main, sub) => { await appChunk(name); return draw(main, sub); };
