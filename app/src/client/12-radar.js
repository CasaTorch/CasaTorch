/* ======================================================================
 * Rain radar - a Home widget (server: 24r-radar.js).
 * The last two hours of rain and snow around the home, on a small map,
 * played as a loop; tap it for the full screen. Everything comes from this
 * CasaTorch (the box fetches the radar and the map and caches them), so the
 * browser never talks to anyone else.
 *  - Drawn on three canvases: an outline of land and borders (always there,
 *    even offline), the map tiles (tinted to match light or dark), and the
 *    radar - with a pin on home.
 *  - "Rain likely in about 20 min": worked out here from how the rain moved
 *    over the last half hour (the radar service has no forecast frames any
 *    more), and labeled as an estimate.
 *  - Plays only while it's on screen and the page is showing; with reduced
 *    motion it starts paused on the newest frame and doesn't cross-fade.
 * ====================================================================== */
const RD_T = 256;
const RD = { framesP: null, framesAt: 0, tiles: new Map(), queue: [], active: 0, outlines: new Map(), analysis: new Map() };
const rdTileOf = (lat, lon, z) => { const n = 2 ** z, la = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180; return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n }; };
const rdReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rdIso = (t) => new Date(t * 1000).toISOString();
function rdFrames(force) {
  if (!force && RD.framesP && Date.now() - RD.framesAt < 120_000) return RD.framesP;
  RD.framesAt = Date.now();
  RD.framesP = api('/api/radar/frames').catch((err) => { RD.framesAt = 0; throw err; });
  return RD.framesP;
}
/* Tiles: six loading at a time, newest frame first; one shared cache for every radar on the page. */
function rdLoad(url) {
  return new Promise((ok, bad) => {
    const done = () => { RD.active--; const next = RD.queue.shift(); if (next) next(); };
    const run = () => { RD.active++; const img = new Image(); img.decoding = 'async'; img.onload = () => { done(); ok(img); }; img.onerror = () => { done(); bad(new Error('tile')); }; img.src = url; };
    if (RD.active < 6) run(); else RD.queue.push(run);
  });
}
function rdImg(url) {
  let e = RD.tiles.get(url);
  if (e && (e.ok || e.p || Date.now() - e.fail < 30_000)) { RD.tiles.delete(url); RD.tiles.set(url, e); return e; }
  e = { img: null, ok: false, fail: 0, p: null };
  e.p = rdLoad(url).then((img) => { e.img = img; e.ok = true; }, () => { e.fail = Date.now(); }).finally(() => { e.p = null; });
  RD.tiles.set(url, e);
  for (const k of RD.tiles.keys()) { if (RD.tiles.size <= 700) break; if (!RD.tiles.get(k).p) RD.tiles.delete(k); else break; }
  return e;
}
function rdOutline(z) {
  if (!RD.outlines.has(z)) RD.outlines.set(z, api(`/api/radar/outline?z=${z}`).catch((err) => { RD.outlines.delete(z); throw err; }));
  return RD.outlines.get(z);
}

/* ---- reading the radar back: RainViewer's "Universal Blue" colors, rain then snow, -10 to 65 dBZ ---- */
const RD_RAIN = '63615914 66635a19 69665c1e 6c685d24 6f6b5f29 726e612e 75706234 78736439 7c75653e 7f786744 827b6949 857d6a4e 88806c54 8b826d59 8e856f5e 92887164 9e93756e aa9e7978 b6a97e82 c2b4828c cec08796 d2c48ba0 d6c88faa dacc93b4 ded097be 88ddeeff 6cd1ebff 51c5e8ff 36bae5ff 1baee2ff 00a3e0ff 009ad5ff 0091caff 0088bfff 007fb4ff 0077aaff 0070a3ff 00699cff 006295ff 005b8eff 005588ff 005180ff 004e78ff 004a70ff 004768ff ffee00ff ffe000ff ffd200ff ffc500ff ffb700ff ffaa00ff ff9f00ff ff9500ff ff8b00ff ff8100ff ff4400ff f23600ff e62800ff d91b00ff cd0d00ff c10000ff a80000ff 8f0000ff 760000ff 5d0000ff ffaaffff ff9fffff ff95ffff ff8bffff ff81ffff ff77ffff ff6cffff ff62ffff ff58ffff ff4effff ffffffff';
const RD_SNOW = 'cfffff00 ceffff0c cdffff19 ccffff26 cbffff33 cbffff3f caffff4c c9ffff59 c8ffff66 c7ffff72 c7ffff7f c6ffff8c c5ffff99 c4ffffa5 c3ffffb2 c3ffffbf c2ffffcc c1ffffd8 c0ffffe5 bffffff2 bfffffff b8f8ffff b2f2ffff abebffff a5e5ffff 9fdfffff 98d8ffff 92d2ffff 8bcbffff 85c5ffff 7fbfffff 78b8ffff 72b2ffff 6babffff 65a5ffff 5f9fffff 5b9bffff 5898ffff 5595ffff 5292ffff 4f8fffff 4b8bffff 4888ffff 4585ffff 4282ffff 3f7fffff 3b7bffff 3878ffff 3575ffff 3272ffff 2f6fffff 2b6bffff 2868ffff 2565ffff 2262ffff 1f5fffff 1b5bffff 1858ffff 1555ffff 1252ffff 0f4fffff 0c4bffff 0948ffff 0645ffff 0242ffff 003fffff';
const RD_PAL = [...RD_RAIN.split(' ').map((h, i) => [h, i - 10, 0]), ...RD_SNOW.split(' ').map((h, i) => [h, i - 10, 1])].map(([h, dbz, snow]) => ({ c: [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16)), dbz, snow }));
const RD_MEMO = new Map();
/** A radar pixel's color back to { dbz, snow } (the nearest color in the legend), or null for no echo. */
function rdDbz(r, g, b, a) {
  if (a < 60) return null;
  const key = ((r << 16) | (g << 8) | b) * 4 + (a >> 6);
  let v = RD_MEMO.get(key);
  if (v === undefined) {
    let best = Infinity; v = null;
    for (const p of RD_PAL) { const d = (p.c[0] - r) ** 2 + (p.c[1] - g) ** 2 + (p.c[2] - b) ** 2 + ((p.c[3] - a) ** 2) / 4; if (d < best) { best = d; v = p; } }
    if (RD_MEMO.size > 50_000) RD_MEMO.clear();
    RD_MEMO.set(key, v);
  }
  return v;
}
/** The newest frame (and one about 30 minutes before it) as grids of 4-pixel cells at zoom 7 around home. */
async function rdGrid(info, t) {
  const z = 7, h = rdTileOf(info.home.lat, info.home.lon, z), hx = Math.floor(h.x), hy = Math.floor(h.y), n = 2 ** z;
  const urls = []; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) urls.push([i, j, `/api/radar/tile/radar/${z}/${(((hx + i) % n) + n) % n}/${hy + j}?f=${t}`]);
  const es = urls.map(([, , u]) => rdImg(u)); await Promise.all(es.map((e) => e.p));
  if (!es.some((e) => e.ok)) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = RD_T * 3;
  const c = cv.getContext('2d', { willReadFrequently: true });
  urls.forEach(([i, j], k) => { if (es[k].ok) c.drawImage(es[k].img, (i + 1) * RD_T, (j + 1) * RD_T, RD_T, RD_T); });
  const px = c.getImageData(0, 0, RD_T * 3, RD_T * 3).data, G = (RD_T * 3) / 4, dbz = new Float32Array(G * G).fill(-99), snow = new Uint8Array(G * G);
  for (let y = 0; y < RD_T * 3; y++) for (let x = 0; x < RD_T * 3; x++) {
    const o = (y * RD_T * 3 + x) * 4; if (px[o + 3] < 60) continue;
    const v = rdDbz(px[o], px[o + 1], px[o + 2], px[o + 3]); if (!v) continue;
    const ci = (y >> 2) * G + (x >> 2); if (v.dbz > dbz[ci]) { dbz[ci] = v.dbz; snow[ci] = v.snow; }
  }
  return { G, dbz, snow, home: { x: ((h.x - hx + 1) * RD_T) / 4, y: ((h.y - hy + 1) * RD_T) / 4 }, kmPerCell: (4 * 40075.016 * Math.cos((info.home.lat * Math.PI) / 180)) / (RD_T * n) };
}
/** How the rain moved between two grids, in cells: the shift that lines them up best (coarse, then fine). */
function rdMotion(A, B) {
  const G = A.G, w = (v) => (v >= 15 ? v - 10 : 0);
  const count = (g) => { let k = 0; for (let i = 0; i < g.dbz.length; i++) if (g.dbz[i] >= 20) k++; return k; };
  if (count(A) < 12 || count(B) < 12) return null;
  const down = (g) => { const H = G / 2, out = new Float32Array(H * H); for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const i = (y >> 1) * H + (x >> 1); out[i] = Math.max(out[i], w(g.dbz[y * G + x])); } return out; };
  const score = (a, b, N, sx, sy) => { let s = 0; for (let y = Math.max(0, -sy); y < Math.min(N, N - sy); y++) for (let x = Math.max(0, -sx); x < Math.min(N, N - sx); x++) { const va = a[y * N + x]; if (va) s += va * b[(y + sy) * N + x + sx]; } return s; };
  const a2 = down(A), b2 = down(B), H = G / 2; let best = -1, bx = 0, by = 0;
  for (let sy = -9; sy <= 9; sy++) for (let sx = -9; sx <= 9; sx++) { const s = score(a2, b2, H, sx, sy); if (s > best) { best = s; bx = sx; by = sy; } }
  if (best <= 0) return null;
  const a1 = A.dbz.map(w), b1 = B.dbz.map(w); let fb = -1, fx = 0, fy = 0;
  for (let sy = by * 2 - 2; sy <= by * 2 + 2; sy++) for (let sx = bx * 2 - 2; sx <= bx * 2 + 2; sx++) { const s = score(a1, b1, G, sx, sy); if (s > fb) { fb = s; fx = sx; fy = sy; } }
  return { dx: fx, dy: fy };
}
/** What the rain is doing at home: now, soon, or where the nearest is. Plain words come from rdSummaryText. */
function rdForecast(B, motion, mins) {
  const G = B.G, hx = B.home.x, hy = B.home.y;
  const at = (x, y, r) => {
    if (x < -r || y < -r || x >= G + r || y >= G + r) return null;
    let m = -99, s = 0, k = 0; const r2 = r * r;
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
      if (i < 0 || j < 0 || i >= G || j >= G || (i - x) ** 2 + (j - y) ** 2 > r2) continue;
      const v = B.dbz[j * G + i]; if (v > m) m = v; if (v >= 15) { k++; s += B.snow[j * G + i]; }
    }
    return { dbz: m, snow: k > 0 && s / k > 0.5 };
  };
  const out = { now: null, startIn: null, stopIn: null, nearest: null, moving: null };
  const km = (v) => v / B.kmPerCell;   // a distance in km as cells
  const here = at(hx, hy, km(3));
  const vx = motion ? motion.dx / mins : 0, vy = motion ? motion.dy / mins : 0;   // cells a minute
  if (motion) { const kmh = Math.hypot(vx, vy) * B.kmPerCell * 60; if (kmh >= 5 && kmh < 160) out.moving = { kmh, dir: rdCompass(Math.atan2(vx, -vy)) }; }
  if (here && here.dbz >= 18) {
    out.now = { dbz: here.dbz, snow: here.snow };
    if (out.moving) { let dry = 0; for (let L = 5; L <= 90; L += 5) { const p = at(hx - vx * L, hy - vy * L, km(3)); if (!p) break; if (p.dbz < 15) { dry++; if (dry >= 2) { out.stopIn = L - 5; break; } } else dry = 0; } }
    return out;
  }
  if (out.moving) {
    for (let L = 5; L <= 120; L += 5) { const p = at(hx - vx * L, hy - vy * L, km(2.5 + L * 0.06)); if (!p) break; if (p.dbz >= 20) { out.startIn = L; out.startSnow = p.snow; break; } }
  }
  let best = Infinity, bi = -1;
  for (let i = 0; i < B.dbz.length; i++) if (B.dbz[i] >= 20) { const d = (i % G - hx) ** 2 + (Math.floor(i / G) - hy) ** 2; if (d < best) { best = d; bi = i; } }
  if (bi >= 0) out.nearest = { km: Math.sqrt(best) * B.kmPerCell, dir: rdCompass(Math.atan2(bi % G - hx, -(Math.floor(bi / G) - hy))), snow: !!B.snow[bi] };
  return out;
}
const RD_SHORT = { north: 'N', northeast: 'NE', east: 'E', southeast: 'SE', south: 'S', southwest: 'SW', west: 'W', northwest: 'NW' };
const RD_DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
function rdCompass(rad) { const deg = ((rad * 180) / Math.PI + 360) % 360; return RD_DIRS[Math.round(deg / 45) % 8]; }
const rdDist = (km) => { const mi = S.units !== 'C', v = mi ? km * 0.621 : km, r = v >= 20 ? Math.round(v / 5) * 5 : Math.max(1, Math.round(v)); return `${r} ${mi ? 'mi' : 'km'}`; };
const rdMins = (m) => (m >= 90 ? T('{n} h', { n: Math.round(m / 30) / 2 }) : T('{n} min', { n: m }));
/** The sentence on the widget, and a level for its color: 'now' | 'soon' | 'near' | 'dry'. */
function rdSummaryText(f) {
  if (!f) return null;
  if (f.now) {
    const kind = f.now.snow ? (f.now.dbz >= 30 ? 'Heavy snow at home' : 'Snow at home') : f.now.dbz >= 40 ? 'Heavy rain at home' : f.now.dbz >= 28 ? 'Rain at home' : 'Light rain at home';
    return { level: 'now', text: T(kind), short: T(f.now.snow ? 'Snow now' : 'Rain now'), sub: f.stopIn != null ? (f.stopIn <= 5 ? T('Stopping soon') : T('Stopping in about {t}', { t: rdMins(f.stopIn) })) : f.moving ? T('Likely to keep going for a while') : null };
  }
  if (f.startIn != null) return { level: 'soon', short: f.startIn <= 10 ? T(f.startSnow ? 'Snow soon' : 'Rain soon') : T(f.startSnow ? 'Snow in ~{t}' : 'Rain in ~{t}', { t: rdMins(f.startIn) }), text: f.startIn <= 10 ? T(f.startSnow ? 'Snow likely within 10 min' : 'Rain likely within 10 min') : T(f.startSnow ? 'Snow likely in about {t}' : 'Rain likely in about {t}', { t: rdMins(f.startIn) }), sub: f.nearest ? T('{dist} away, to the {dir}', { dist: rdDist(f.nearest.km), dir: T(f.nearest.dir) }) : null };
  if (f.nearest && f.nearest.km <= 160) return { level: 'near', short: T(f.nearest.snow ? 'Snow {dist} {dir}' : 'Rain {dist} {dir}', { dist: rdDist(f.nearest.km), dir: T(RD_SHORT[f.nearest.dir]) }), text: T(f.nearest.snow ? 'Snow {dist} to the {dir}' : 'Rain {dist} to the {dir}', { dist: rdDist(f.nearest.km), dir: T(f.nearest.dir) }), sub: f.moving ? T('Moving {dir}', { dir: T(f.moving.dir) }) : null };
  return { level: 'dry', text: T('No rain nearby'), short: T('No rain nearby'), sub: null };
}
/* Worked out once per newest frame and shared by every radar on the page. */
function rdAnalyze(info) {
  const past = info.frames.filter((f) => f.kind === 'past');
  if (!past.length) return Promise.resolve(null);
  const B = past[past.length - 1], key = `${info.home.lat},${info.home.lon},${B.t}`;
  if (RD.analysis.has(key)) return RD.analysis.get(key);
  const p = (async () => {
    const gb = await rdGrid(info, B.t); if (!gb) return null;
    const A = past.filter((f) => B.t - f.t >= 1200).sort((a, b) => Math.abs(B.t - a.t - 1800) - Math.abs(B.t - b.t - 1800))[0];
    const ga = A ? await rdGrid(info, A.t) : null;
    const motion = ga ? rdMotion(ga, gb) : null;
    return rdForecast(gb, motion, A ? (B.t - A.t) / 60 : 30);
  })().catch(() => null);
  RD.analysis.set(key, p); if (RD.analysis.size > 6) RD.analysis.delete(RD.analysis.keys().next().value);
  return p;
}

/* ---- the view: map, radar, pin, chips and controls ---- */
function radarView(host, cfg) {
  const big = !!cfg.big, compact = !big && !!cfg.compact;
  const cvO = el('canvas', { class: 'rd-cv rd-outline', 'aria-hidden': 'true' }), cvB = el('canvas', { class: 'rd-cv rd-base', 'aria-hidden': 'true' }), cvR = el('canvas', { class: 'rd-cv rd-radar', 'aria-hidden': 'true' });
  const pin = el('div', { class: 'rd-pin', 'aria-hidden': 'true' }, el('i'));
  const sumText = el('b', {}, T('Checking the radar…')), sumSub = el('span', { class: 'rd-sub' });
  const sum = el('div', { class: 'rd-sum', role: 'status', 'aria-live': 'polite' }, el('span', { class: 'rd-lvl' }), el('div', { class: 'rd-sum-t' }, cfg.label ? el('span', { class: 'rd-label' }, cfg.label) : null, sumText, sumSub));
  const timeChip = el('div', { class: 'rd-time' }), note = el('div', { class: 'rd-note', hidden: true });
  const playBtn = el('button', { type: 'button', class: 'rd-play', 'aria-label': T('Play') }, icon('play'));
  const range = el('input', { type: 'range', class: 'rd-range', min: 0, max: 0, value: 0, step: 1, 'aria-label': T('Radar time') });
  const tFrom = el('span'), tTo = el('span');
  const bar = compact ? null : el('div', { class: 'rd-bar' }, playBtn, el('div', { class: 'rd-track' }, range, el('div', { class: 'rd-ends tiny' }, tFrom, tTo)));
  const legend = el('div', { class: 'rd-legend', 'aria-hidden': 'true' }, el('span', {}, T('Light|rain')), el('i', { class: 'rd-ramp' }), el('span', {}, T('Heavy|rain')), big ? [el('i', { class: 'rd-snow' }), el('span', {}, T('Snow'))] : null);
  const credit = el('div', { class: 'rd-credit' });
  const zoomBox = big ? el('div', { class: 'rd-zoom' }, el('button', { type: 'button', 'aria-label': T('Zoom in'), onclick: () => zoomBy(1) }, icon('plus')), el('button', { type: 'button', 'aria-label': T('Zoom out'), onclick: () => zoomBy(-1) }, el('span', { class: 'rd-minus' }))) : null;
  const stage = el('div', { class: 'rd-stage' }, cvO, cvB, cvR, pin);
  const root = el('div', { class: `rd${big ? ' rd-big' : ''}${compact ? ' rd-compact' : ''}` }, stage, el('div', { class: 'rd-top' }, sum, timeChip), note, zoomBox, el('div', { class: 'rd-foot' }, bar, el('div', { class: 'rd-foot-r' }, cfg.legend || big ? legend : null, credit)));
  host.replaceChildren(root);

  const st = { info: null, z: cfg.zoom || 7, frames: [], idx: -1, prev: -1, k: 1, playing: false, visible: true, w: 0, h: 0, dpr: 1, dead: false, timer: 0, raf: 0, fadeAt: 0, outline: null, baseShown: false, poll: 0 };
  const reduced = rdReduced();
  const cx = { o: cvO.getContext('2d'), b: cvB.getContext('2d'), r: cvR.getContext('2d') };
  const center = () => { const t = rdTileOf(st.info.home.lat, st.info.home.lon, st.z); return { x: t.x * RD_T, y: t.y * RD_T }; };
  const n = () => 2 ** st.z;
  const wrapX = (x, nn) => ((x % nn) + nn) % nn;
  const R = () => st.info?.radius ?? 5;
  /* The tiles a layer needs at zoom z for this view, within the home's allowed area. */
  function tilesAt(z) {
    const c = center(), s = 2 ** (st.z - z), size = RD_T * s, ox = c.x - st.w / 2, oy = c.y - st.h / 2;
    const h = rdTileOf(st.info.home.lat, st.info.home.lon, z), hx = Math.floor(h.x), hy = Math.floor(h.y), nn = 2 ** z, out = [];
    for (let y = Math.floor(oy / size); y <= Math.floor((oy + st.h) / size); y++) for (let x = Math.floor(ox / size); x <= Math.floor((ox + st.w) / size); x++) {
      if (y < 0 || y >= nn || Math.abs(x - hx) > R() || Math.abs(y - hy) > R()) continue;
      out.push({ x, y, xx: wrapX(x, nn), px: x * size - ox, py: y * size - oy, size });
    }
    return out;
  }
  const prep = (c) => { c.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); c.clearRect(0, 0, st.w, st.h); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; };
  function drawOutline() {
    const c = cx.o; prep(c);
    const cs = getComputedStyle(root), land = cs.getPropertyValue('--rd-land').trim() || '#1e2533', line = cs.getPropertyValue('--rd-line').trim() || 'rgba(255,255,255,.25)';
    const o = st.outline; if (!o || o.z !== st.z) return;
    const cc = center(), proj = (lon, lat) => { const t = rdTileOf(lat, lon, st.z); return [t.x * RD_T - cc.x + st.w / 2, t.y * RD_T - cc.y + st.h / 2]; };
    const path = (flat, close) => { const p = new Path2D(); for (let i = 0; i + 1 < flat.length; i += 2) { const [x, y] = proj(flat[i], flat[i + 1]); if (i) p.lineTo(x, y); else p.moveTo(x, y); } if (close) p.closePath(); return p; };
    const coast = cs.getPropertyValue('--rd-coast').trim() || line;
    c.fillStyle = land; c.strokeStyle = coast; c.lineWidth = 1; for (const r of o.land) { const p = path(r, true); c.fill(p, 'evenodd'); c.stroke(p); }
    c.strokeStyle = line; c.lineJoin = 'round';
    c.lineWidth = 0.8; c.setLineDash([]); for (const l of o.states) c.stroke(path(l));
    c.lineWidth = 1.3; for (const l of o.borders) c.stroke(path(l));
  }
  let baseQueued = false;
  function drawBase() {
    baseQueued = false; const c = cx.b; prep(c); let shown = 0;
    for (const t of tilesAt(st.z)) {
      const e = rdImg(`/api/radar/tile/base/${st.z}/${t.xx}/${t.y}`);
      if (e.ok) { c.drawImage(e.img, t.px, t.py, t.size, t.size); shown++; } else if (e.p) e.p.then(() => { if (!baseQueued && !st.dead) { baseQueued = true; requestAnimationFrame(drawBase); } });
    }
    if (!!shown !== st.baseShown) { st.baseShown = !!shown; drawCredit(); }
  }
  const radarZ = () => Math.min(st.z, st.info?.zoom?.radarMax ?? 7);
  const frameUrls = (f) => tilesAt(radarZ()).map((t) => ({ ...t, url: `/api/radar/tile/radar/${radarZ()}/${t.xx}/${t.y}?f=${f.t}` }));
  const frameReady = (i) => frameUrls(st.frames[i]).every((t) => { const e = RD.tiles.get(t.url); return e && !e.p && (e.ok || e.fail); });
  function drawFrame(i, alpha) {
    if (i < 0 || !st.frames[i]) return;
    const c = cx.r; c.globalAlpha = alpha;
    for (const t of frameUrls(st.frames[i])) { const e = RD.tiles.get(t.url); if (e?.ok) c.drawImage(e.img, t.px, t.py, t.size, t.size); }
    c.globalAlpha = 1;
  }
  function drawRadar() {
    prep(cx.r);
    if (st.k < 1 && st.prev >= 0) drawFrame(st.prev, 1 - st.k);
    drawFrame(st.idx, st.k);
  }
  /* Ask for every frame's tiles, newest first; redraw when the one on screen arrives. */
  function loadFrames() {
    for (let i = st.frames.length - 1; i >= 0; i--) for (const t of frameUrls(st.frames[i])) {
      const e = rdImg(t.url);
      if (e.p) e.p.then(() => { if (st.dead) return; if (i === st.idx || i === st.prev) drawRadar(); markReady(); });
    }
    markReady();
  }
  let readyQueued = false;
  function markReady() { if (readyQueued) return; readyQueued = true; requestAnimationFrame(() => { readyQueued = false; if (st.dead) return; root.style.setProperty('--rd-loaded', `${(st.frames.filter((_, i) => frameReady(i)).length / Math.max(1, st.frames.length)) * 100}%`); }); }
  function drawCredit() {
    const a = (x) => el('a', { href: x.href, target: '_blank', rel: 'noopener noreferrer' }, x.text);
    const cr = st.info?.credit || [], parts = [st.frames.length && !st.info?.synthetic ? cr.find((x) => !/OpenStreetMap/.test(x.text)) : null,   /* the radar's own credit: RainViewer or NOAA / NWS */ st.baseShown ? cr.find((x) => /OpenStreetMap/.test(x.text)) : null].filter(Boolean).map(a);
    if (!st.baseShown && st.outline) parts.push('Natural Earth');
    credit.replaceChildren(...parts.flatMap((x, i) => (i ? [' · ', x] : [x])));
  }
  function showTime() {
    const f = st.frames[st.idx]; if (!f) { timeChip.replaceChildren(); return; }
    const newest = st.frames.filter((x) => x.kind === 'past').at(-1), fresh = st.info && st.info.now - newest.t < 20 * 60;
    const label = f.kind === 'forecast' ? T('+{n} min', { n: Math.round((f.t - newest.t) / 60) }) : f === newest && fresh ? T('Now') : fmtTime(rdIso(f.t));
    timeChip.replaceChildren(...[el('b', {}, label), f.kind === 'forecast' ? el('span', { class: 'rd-sub' }, T('Forecast')) : f === newest && fresh && !compact ? el('span', { class: 'rd-sub' }, fmtTime(rdIso(f.t))) : null].filter(Boolean));
    timeChip.classList.toggle('rd-past', f !== newest);
    if (bar) { range.value = st.idx; range.setAttribute('aria-valuetext', label); }
  }
  function setFrame(i, fade) {
    if (i === st.idx) return;
    st.prev = st.idx; st.idx = i; st.k = fade && !reduced ? 0 : 1; st.fadeAt = performance.now();
    showTime();
    if (st.k < 1) { cancelAnimationFrame(st.raf); const step = (now) => { if (st.dead) return; st.k = Math.min(1, (now - st.fadeAt) / 300); drawRadar(); if (st.k < 1) st.raf = requestAnimationFrame(step); }; st.raf = requestAnimationFrame(step); } else drawRadar();
  }
  const canPlay = () => st.playing && st.visible && !document.hidden && !document.body.classList.contains('editing-on') && root.isConnected && st.frames.length > 1;
  function schedule() {
    clearTimeout(st.timer);
    if (st.dead) return;
    if (!root.isConnected && st.w) { destroy(); return; }
    if (!canPlay()) return;
    const last = st.idx === st.frames.length - 1;
    st.timer = setTimeout(() => {
      if (!canPlay()) return schedule();
      let next = st.idx; for (let k = 0; k < st.frames.length; k++) { next = (next + 1) % st.frames.length; if (frameReady(next)) break; }
      setFrame(next, true); schedule();
    }, last ? 1800 : 550);
  }
  function setPlaying(on) {
    st.playing = !!on && st.frames.length > 1;
    playBtn.replaceChildren(icon(st.playing ? 'pause' : 'play')); playBtn.setAttribute('aria-label', st.playing ? T('Pause') : T('Play'));
    root.classList.toggle('rd-playing', st.playing);
    schedule();
  }
  playBtn.onclick = () => { if (!st.playing && st.idx === st.frames.length - 1) setFrame(0, false); setPlaying(!st.playing); };
  range.oninput = () => { setPlaying(false); setFrame(Number(range.value), false); };
  root.addEventListener('keydown', (e) => {
    if (!st.frames.length || e.target.matches('input, a')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); setFrame(Math.max(0, Math.min(st.frames.length - 1, st.idx + (e.key === 'ArrowLeft' ? -1 : 1))), false); }
    else if (e.key === ' ' && big) { e.preventDefault(); playBtn.click(); }
    else if ((e.key === '+' || e.key === '=') && big) zoomBy(1); else if (e.key === '-' && big) zoomBy(-1);
  });
  function resize() {
    const w = stage.offsetWidth, h = stage.offsetHeight;   // layout size: right inside a scaled preview too
    if (!w || !h) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === st.w && h === st.h && dpr === st.dpr) return false;
    st.w = w; st.h = h; st.dpr = dpr;
    for (const c of [cvO, cvB, cvR]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    return true;
  }
  function redrawAll() { if (!st.info || !st.w) return; drawOutline(); drawBase(); drawRadar(); }
  async function loadOutline() { try { const o = await rdOutline(st.z); if (st.dead) return; st.outline = o; drawOutline(); drawCredit(); } catch { /* the tiles still draw */ } }
  function zoomBy(d) {
    const zr = st.info?.zoom || { min: 4, max: 9 }, z = Math.max(Math.max(5, zr.min), Math.min(zr.max, st.z + d));
    if (z === st.z || !st.info) return;
    st.z = z; root.classList.add('rd-zooming'); setTimeout(() => root.classList.remove('rd-zooming'), 220);
    loadOutline(); redrawAll(); loadFrames();
  }
  if (big) {
    let acc = 0, wheelT = 0;
    stage.addEventListener('wheel', (e) => { e.preventDefault(); acc += e.deltaY; clearTimeout(wheelT); wheelT = setTimeout(() => { acc = 0; }, 250); if (Math.abs(acc) > 120) { zoomBy(acc < 0 ? 1 : -1); acc = 0; } }, { passive: false });
    const pts = new Map(); let d0 = 0;
    stage.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
    stage.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2 && d0) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d / d0 > 1.45) { zoomBy(1); d0 = d; } else if (d / d0 < 0.7) { zoomBy(-1); d0 = d; } } });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) stage.addEventListener(ev, (e) => { pts.delete(e.pointerId); if (pts.size < 2) d0 = 0; });
  }
  async function showSummary() {
    if (!st.info?.frames?.length) { sumText.textContent = T('Radar not available'); sumSub.textContent = ''; root.dataset.level = ''; return; }
    const f = await rdAnalyze(st.info); if (st.dead) return;
    const s = rdSummaryText(f);
    if (!s) { sumText.textContent = st.info.state === 'down' ? T('Radar not available') : T('Rain radar'); sumSub.textContent = ''; root.dataset.level = ''; return; }
    sumText.textContent = compact && st.w < 260 ? s.short || s.text : s.text; sumSub.textContent = s.sub || ''; sumSub.hidden = !s.sub || compact; root.dataset.level = s.level;
    sum.title = T('An estimate from how the rain moved over the last half hour');
  }
  function showNote() {
    const i = st.info, newest = st.frames.filter((x) => x.kind === 'past').at(-1);
    const text = i.state === 'demo' ? T(compact ? 'Demo: made-up rain' : 'Demo: made-up rain, not real weather') : i.state === 'stale' ? T('Offline - radar from {t}', { t: newest ? fmtTime(rdIso(newest.t)) : '-' }) : i.state === 'down' ? T('The radar is not answering right now.') : i.demo && !compact ? T('Demo house: the real radar for San Francisco') : null;
    note.hidden = !text; note.textContent = text || ''; note.className = `rd-note${i.state === 'stale' || i.state === 'down' ? ' rd-warn' : ''}`;
  }
  async function load(force) {
    let info;
    try { info = await rdFrames(force); } catch (err) { if (!st.info) { note.hidden = false; note.textContent = T('The radar is not loading right now.'); note.className = 'rd-note rd-warn'; sumText.textContent = T('Rain radar'); } return; }
    if (st.dead) return;
    if (info.state === 'nolocation') { cfg.onNoLocation?.(); return; }
    const newestBefore = st.frames.at(-1)?.t, keepAtEnd = st.idx === st.frames.length - 1 || st.idx < 0;
    const homeChanged = st.info && (st.info.home.lat !== info.home.lat || st.info.home.lon !== info.home.lon);
    st.info = info; st.frames = info.frames || [];
    if (homeChanged) { RD.outlines.clear(); st.outline = null; }
    if (bar) { range.max = Math.max(0, st.frames.length - 1); range.disabled = st.frames.length < 2; tFrom.textContent = st.frames[0] ? fmtTime(rdIso(st.frames[0].t)) : ''; tTo.textContent = st.frames.length ? T('Now') : ''; }
    resize();
    if (!st.outline || homeChanged) loadOutline();
    const newest = st.frames.filter((x) => x.kind === 'past').length - 1;
    if (keepAtEnd || newestBefore !== st.frames.at(-1)?.t) { st.idx = -1; setFrame(Math.max(0, newest), false); } else showTime();
    showNote(); drawCredit(); redrawAll(); loadFrames(); showSummary();
    if (st.playing === false && cfg.autoplay && !reduced && !st.started) { st.started = true; setPlaying(true); } else schedule();
    root.classList.toggle('rd-empty', !st.frames.length);
  }
  /* Keep up to date, and only work while it can be seen. */
  const ro = new ResizeObserver(() => { if (resize()) redrawAll(); });
  ro.observe(stage);
  const io = new IntersectionObserver((es) => { st.visible = es.some((e) => e.isIntersecting); schedule(); });
  io.observe(root);
  const onVis = () => { if (!document.hidden && st.info && Date.now() - RD.framesAt > 5 * 60_000) load(true); schedule(); };
  document.addEventListener('visibilitychange', onVis);
  const mo = new MutationObserver(() => drawOutline());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  st.poll = setInterval(() => { if (!root.isConnected) return destroy(); if (!document.hidden && st.visible) load(Date.now() - RD.framesAt > 4 * 60_000); }, 60_000);
  function destroy() {
    if (st.dead) return; st.dead = true;
    clearTimeout(st.timer); clearInterval(st.poll); cancelAnimationFrame(st.raf);
    ro.disconnect(); io.disconnect(); mo.disconnect(); document.removeEventListener('visibilitychange', onVis);
  }
  load(false);
  return { destroy, root, play: setPlaying, get state() { return st; } };
}

/* ---- full screen, on tap ---- */
function radarFull(opts = {}) {
  const back = document.activeElement;
  const close = () => { v.destroy(); ov.remove(); document.removeEventListener('keydown', onKey, true); document.documentElement.classList.remove('rd-lock'); back?.focus?.({ preventScroll: true }); };
  const closeBtn = el('button', { type: 'button', class: 'btn ghost small rd-close', 'aria-label': T('Close'), onclick: () => close() }, icon('x'));
  const holder = el('div', { class: 'rd-full-b' });
  const ov = el('div', { class: 'rd-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('Rain radar') },
    el('div', { class: 'rd-full-h' }, icon('drop'), el('b', {}, opts.title || T('Rain radar')), el('span', { class: 'muted small rd-place' }), el('span', { class: 'grow' }), closeBtn), holder,
    el('div', { class: 'rd-full-f tiny muted' }, T('Radar: the last two hours. "Rain likely" is an estimate from how the rain moved, not a forecast.')));
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  document.documentElement.classList.add('rd-lock');
  document.body.append(ov);
  const v = radarView(holder, { big: true, zoom: opts.zoom || 7, autoplay: opts.autoplay !== false, legend: true });
  rdFrames().then((i) => { if (i?.home?.name) ov.querySelector('.rd-place').textContent = i.home.name; }).catch(() => {});
  requestAnimationFrame(() => (v.root.querySelector('.rd-play') || closeBtn).focus({ preventScroll: true }));
  return { close };
}

/* ---- no town yet: find it here (admins), and the weather gets it too ---- */
function radarSetHome(onDone) {
  const q = el('input', { type: 'search', placeholder: T('Search for a town or city…'), 'aria-label': T('Search for a town or city…') }), list = el('div', { class: 'pick-list' });
  // One search when you press Find or Enter (OpenStreetMap's search asks apps not to search while you type).
  const find = async () => {
    const s = q.value.trim(); if (s.length < 3) return list.replaceChildren();
    try {
      const { places = [], credit } = await api(`/api/w/places?q=${encodeURIComponent(s)}`);
      list.replaceChildren(...(places.length ? places.map((p) => el('button', { type: 'button', class: 'pick-item', onclick: async () => {
        try { await post('/api/radar/home', p); m.remove(); RD.framesP = null; RD.outlines.clear(); toast(T('Home is set to {name}.', { name: p.name })); onDone?.(); } catch (err) { toast(err.message); }
      } }, icon('home', 14), p.name)) : [el('div', { class: 'tiny muted' }, T('Nothing found.'))]), ...(credit ? [placeCredit(credit)] : []));
    } catch { list.replaceChildren(el('div', { class: 'tiny muted' }, T('Town search is not answering right now. Try again in a minute.'))); }
  };
  q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } };
  const m = modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('The radar centers on your town. The weather uses it too. Only the town is saved, not your address.')), el('div', { class: 'row', style: 'gap:8px' }, el('div', { class: 'grow' }, q), el('button', { type: 'button', class: 'btn small', onclick: find }, T('Find'))), list), { title: T('Where is home?') });
  setTimeout(() => q.focus(), 60);
}

widget({ id: 'radar', title: 'Rain radar', icon: 'drop', bare: true, live: true, cat: 'time', multi: true, blurb: 'Rain and snow around your home, the last two hours on a loop', keywords: 'weather radar rain snow storm precipitation map', min: [2, 2], size: [6, 4],
  options: [
    { key: 'zoom', type: 'select', label: 'How far', numeric: true, default: 7, choices: [[6, 'The region'], [7, 'Around town'], [8, 'Close up']] },
    { key: 'play', type: 'toggle', label: 'Animation', text: 'Play the last two hours on a loop', default: true },
    { key: 'legend', type: 'toggle', label: 'Legend', text: 'Show what the colors mean (when there\'s room)', default: true },
  ],
  render(b, ctx, size) {
    const t = b._t || {}, o = optsOf(t), compact = size.w <= 3 || size.h <= 2 || (size.narrow && size.w <= 2);
    b._rd?.destroy(); b._rd = null;
    if (b.parentElement) b.parentElement.style.padding = '0';
    const noLocation = () => {
      b._rd?.destroy(); b._rd = null;
      b.replaceChildren(el('div', { class: 'allclear rd-setup' }, el('div', {}, icon('drop'), el('div', { class: 'small', style: 'margin:8px 0' }, T('See rain coming: set your town first.')),
        el('button', { type: 'button', class: 'btn small primary', onclick: () => radarSetHome(() => b._saved?.()) }, T('Set your town')))));
    };
    b._rd = radarView(b, { zoom: o.zoom || 7, compact, autoplay: o.play !== false && !size.preview, legend: o.legend !== false && size.w >= 6 && size.h >= 4, label: t.title || null, onNoLocation: noLocation });
    b._rd.root.tabIndex = 0;
    b._rd.root.setAttribute('aria-label', T('Rain radar - open full screen'));
    const open = (e) => {
      if (size.preview || b.closest('.editing') || document.body.classList.contains('editing-on')) return;
      if (e.type === 'click' && e.target.closest('button, input, a, .rd-bar')) return;
      if (e.type === 'keydown' && (e.key !== 'Enter' || e.target !== b._rd.root)) return;
      radarFull({ zoom: o.zoom || 7, autoplay: o.play !== false, title: t.title || null });
    };
    b._rd.root.addEventListener('click', open); b._rd.root.addEventListener('keydown', open);
  } });
