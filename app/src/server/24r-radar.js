/* ======================================================================
 * Rain radar (the Home screen's "Rain radar" widget, client 12-radar.js).
 *
 * The browser only ever talks to this CasaTorch: the box fetches the radar
 * and the map for the area around the home, keeps them in a small cache
 * (memory, then disk), and hands them on. Nothing else is reachable through
 * it - only the hosts below, only map tiles near the home, only a few zoom
 * levels - so it can't be used to load anything else from the internet.
 *
 *   Radar: RainViewer's public Weather Maps API - the past 2 hours, every
 *          10 minutes, worldwide where there is radar. Free for personal
 *          use with credit; about 100 requests a minute per address, zoom
 *          7 at most. (Their forecast frames ended on 2026-01-01; if they
 *          come back in the answer they are shown, marked as forecast.)
 *          RainViewer's free API is for personal and educational use: each home's
 *          own CasaTorch fetches it for that household, it's part of Basic
 *          (never sold as a Pro feature) and the credit is always shown.
 *   Or:    the US National Weather Service's radar mosaic (NOAA, public domain,
 *          the lower 48 states) - Settings › radar provider "nws"; or "off".
 *          (config.radar.provider, or CASATORCH_RADAR_PROVIDER to override it.)
 *   Map:   OpenStreetMap's standard tiles, with credit, a CasaTorch
 *          User-Agent and at least a week of caching (their tile policy).
 *   No map at all (offline, the map service down, the demo with no
 *          internet): an outline of land, borders and US states from
 *          Natural Earth (public domain), shipped in catalog/.
 *   Demo:  the real radar for the demo house when the internet answers;
 *          otherwise made-up rain, and the widget says so.
 *
 *   GET  /api/radar/frames                 what can be shown, and where home is (rounded)
 *   GET  /api/radar/tile/:kind/:z/:x/:y    kind = base | radar (radar needs ?f=<frame time>)
 *   GET  /api/radar/outline?z=             the outline near home
 *   POST /api/radar/home {name, lat, lon}  set the home's town (admins) - the weather uses it too
 *   PUT  /api/radar/provider {provider}    rainviewer | nws | off (admins)
 * ====================================================================== */
const RADAR_DIR = path.join(DATA_DIR, 'radar-cache');
const RADAR_ZOOM = { min: 4, max: 9, radarMax: 7, analysis: 7 };   // the view's zooms; radar tiles stop at 7 and are scaled up past it
const RADAR_RADIUS = 5;                                           // tiles either side of the home's tile (11 x 11: a wall screen at zoom 9)
const RADAR_KINDS = { base: { min: RADAR_ZOOM.min, max: RADAR_ZOOM.max }, radar: { min: RADAR_ZOOM.min, max: RADAR_ZOOM.radarMax } };
const RADAR_HOSTS = [/^api\.rainviewer\.com$/, /^tilecache\.rainviewer\.com$/, /^tile\.openstreetmap\.org$/, /^opengeo\.ncep\.noaa\.gov$/];
const RADAR_PATH_RE = /^\/v2\/radar\/[A-Za-z0-9_-]{1,64}$/;
const RADAR_CREDIT = [{ text: 'RainViewer', href: 'https://www.rainviewer.com/' }, { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' }];
/* Radar providers. "nws": the National Weather Service's base reflectivity mosaic for the lower 48 states, from NOAA's
   public map server (public domain) - the newest picture, refreshed every 5 minutes. */
const RADAR_PROVIDERS = ['rainviewer', 'nws', 'off'];
const RADAR_NWS = { url: 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows', box: { s: 20, n: 52, w: -130, e: -60 }, step: 300 };
const RADAR_NWS_CREDIT = [{ text: 'NOAA / National Weather Service', href: 'https://www.weather.gov/' }, RADAR_CREDIT[1]];
const radarProviderSetting = () => { const v = String(process.env.CASATORCH_RADAR_PROVIDER || config.radar?.provider || 'rainviewer').toLowerCase(); return RADAR_PROVIDERS.includes(v) ? v : 'rainviewer'; };
const radarNwsCovers = (h) => !!h && h.lat >= RADAR_NWS.box.s && h.lat <= RADAR_NWS.box.n && h.lon >= RADAR_NWS.box.w && h.lon <= RADAR_NWS.box.e;
/** The National Weather Service picture for one map tile (a WMS request for the tile's box, in Web Mercator meters). */
function radarNwsTileUrl(z, x, y) {
  const R = 20037508.342789244, size = (2 * R) / 2 ** z, minx = -R + x * size, maxy = R - y * size;
  const q = new URLSearchParams({ service: 'WMS', version: '1.1.1', request: 'GetMap', layers: 'conus_bref_qcd', styles: '', format: 'image/png', transparent: 'true', srs: 'EPSG:3857', width: '256', height: '256', bbox: [minx, maxy - size, minx + size, maxy].map((v) => v.toFixed(2)).join(',') });
  return `${RADAR_NWS.url}?${q}`;
}
const RADAR_DEMO_HOME = { lat: 37.7749, lon: -122.4194, name: 'San Francisco, CA' };
const RADAR = { frames: null, framesAt: 0, framesErr: null, live: false, mem: new Map(), memBytes: 0, inflight: new Map(), writes: 0, synth: null, outline: null, outlineMemo: new Map(),
  up: { rainviewer: { calls: [], busy: 0, wait: [], fails: 0, offUntil: 0 }, osm: { calls: [], busy: 0, wait: [], fails: 0, offUntil: 0 }, nws: { calls: [], busy: 0, wait: [], fails: 0, offUntil: 0 } } };
const RADAR_MEM_MAX = 24 * 1024 * 1024, RADAR_DISK_MAX = 64 * 1024 * 1024;
const RADAR_RATE = { rainviewer: 60, osm: 60, nws: 60 };   // upstream requests a minute, at most (RainViewer allows about 100)

/* ---- tile math (Web Mercator, the same on every web map) ---- */
function radarTileOf(lat, lon, z) {
  const n = 2 ** z, la = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n };
}
function radarLonLatOf(x, y, z) {   // tile coordinates (fractions allowed) back to degrees
  const n = 2 ** z;
  return { lon: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI };
}
/** Is this tile one the home's radar may show? Known kind, whole numbers, an allowed zoom, on the map, and
    within RADAR_RADIUS tiles of the home's own tile (across the date line too). */
function radarAllowed(kind, z, x, y, home) {
  const k = RADAR_KINDS[kind];
  if (!k || !home || ![z, x, y].every(Number.isInteger) || z < k.min || z > k.max) return false;
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return false;
  const h = radarTileOf(home.lat, home.lon, z), hx = Math.floor(h.x), hy = Math.floor(h.y);
  const dx = Math.min(Math.abs(x - hx), n - Math.abs(x - hx));
  return dx <= RADAR_RADIUS && Math.abs(y - hy) <= RADAR_RADIUS;
}
/** Only plain https addresses on the providers' own hosts (no other port, no user name, nothing else). */
function radarUrlAllowed(u) {
  let url; try { url = new URL(String(u)); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && RADAR_HOSTS.some((re) => re.test(url.hostname));
}
const radarFrameOk = (f) => f && Number.isInteger(f.time) && f.time > 1.5e9 && f.time < 4e9 && RADAR_PATH_RE.test(String(f.path || ''));
/** RainViewer's weather-maps.json, checked: their image host and frame paths only, oldest first. */
function radarParseMaps(j) {
  const host = String(j?.host || '');
  if (host !== 'https://tilecache.rainviewer.com') throw new Error('unexpected radar host');
  const pick = (a) => (Array.isArray(a) ? a.filter(radarFrameOk).map((f) => ({ time: f.time, path: f.path })).sort((a2, b2) => a2.time - b2.time).slice(-24) : []);
  const past = pick(j?.radar?.past), nowcast = pick(j?.radar?.nowcast);
  if (!past.length) throw new Error('no radar frames in the answer');
  return { host, past, nowcast, generated: Number(j?.generated) || null };
}
function radarTileUrl(kind, z, x, y, frame, host = 'https://tilecache.rainviewer.com') {
  if (kind === 'base') return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  if (kind === 'radar' && radarFrameOk(frame) && host === 'nws') return radarNwsTileUrl(z, x, y);
  if (kind === 'radar' && radarFrameOk(frame)) return `${host}${frame.path}/256/${z}/${x}/${y}/2/1_1.png`;   // 256 px, Universal Blue, smoothed, snow shown
  return null;
}
function radarHome() {
  const l = config.location, lat = Number(l?.lat), lon = Number(l?.lon);
  if (l && l.lat != null && l.lon != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) return { lat, lon, name: l.name || null };
  return isDemo() ? RADAR_DEMO_HOME : null;
}

/* ---- the upstream: a few at a time, a budget a minute, and a pause after repeated failures ---- */
const radarProvider = (url) => { const h = new URL(url).hostname; return /rainviewer\.com$/.test(h) ? 'rainviewer' : /noaa\.gov$/.test(h) ? 'nws' : 'osm'; };
async function radarUpstream(url, { etag, modified, json } = {}) {
  if (!radarUrlAllowed(url)) throw Object.assign(new Error('not an allowed map address'), { status: 400 });
  const p = RADAR.up[radarProvider(url)], now = Date.now();
  if (p.offUntil > now) throw Object.assign(new Error('the map service is not answering'), { status: 502, quick: true });
  p.calls = p.calls.filter((t) => now - t < 60_000);
  if (p.calls.length >= RADAR_RATE[radarProvider(url)]) throw Object.assign(new Error('busy - try again in a moment'), { status: 503 });
  p.calls.push(now);
  if (p.busy >= 4) await new Promise((ok) => p.wait.push(ok));
  p.busy++;
  try {
    const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(json ? 10_000 : 8000),
      headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'image/png,image/*;q=0.8', ...(etag ? { 'If-None-Match': etag } : {}), ...(modified ? { 'If-Modified-Since': modified } : {}) } });
    if (r.status === 304) { r.body?.cancel?.(); p.fails = 0; return { notModified: true, headers: r.headers }; }
    if (!r.ok) { r.body?.cancel?.(); throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status === 404 ? 404 : 502 }); }
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (json ? !/json/.test(type) : !/^image\/(png|webp|jpeg)$/.test(type)) { r.body?.cancel?.(); throw Object.assign(new Error('unexpected answer'), { status: 502 }); }
    const max = json ? 256 * 1024 : 1024 * 1024, parts = []; let n = 0;
    for await (const c of r.body) { n += c.length; if (n > max) throw Object.assign(new Error('that answer is too big'), { status: 502 }); parts.push(c); }
    p.fails = 0;
    return { body: Buffer.concat(parts), type, headers: r.headers };
  } catch (err) {
    if (err.status !== 404 && err.status !== 503) { p.fails++; if (p.fails >= 3) { p.offUntil = Date.now() + Math.min(10, p.fails - 2) * 60_000; } }
    throw Object.assign(err, { status: err.status || 502 });
  } finally { p.busy--; p.wait.shift()?.(); }
}
/* How long a map tile is kept: what the server says, but never less than a week (OpenStreetMap asks for that) or more than 30 days. */
function radarKeepFor(headers) {
  const cc = String(headers?.get?.('cache-control') || ''), m = cc.match(/max-age=(\d+)/), exp = Date.parse(headers?.get?.('expires') || '');
  const secs = m ? Number(m[1]) : Number.isFinite(exp) ? (exp - Date.now()) / 1000 : 0;
  return Math.min(30 * 86400, Math.max(7 * 86400, secs)) * 1000;
}

/* ---- the cache: memory first (24 MB), then disk (64 MB, oldest first out) ---- */
const radarKeyFile = (key) => path.join(RADAR_DIR, crypto.createHash('sha256').update(key).digest('hex').slice(0, 40));
function radarMemPut(key, e) {
  const old = RADAR.mem.get(key); if (old) { RADAR.memBytes -= old.body.length; RADAR.mem.delete(key); }
  RADAR.mem.set(key, e); RADAR.memBytes += e.body.length;
  for (const [k, v] of RADAR.mem) { if (RADAR.memBytes <= RADAR_MEM_MAX) break; RADAR.mem.delete(k); RADAR.memBytes -= v.body.length; }
}
function radarMemGet(key) { const e = RADAR.mem.get(key); if (e) { RADAR.mem.delete(key); RADAR.mem.set(key, e); } return e || null; }   // most recently used last
async function radarDiskGet(key) {
  const f = radarKeyFile(key);
  try {
    const meta = JSON.parse(await fs.promises.readFile(`${f}.json`, 'utf8'));
    if (meta.key !== key) return null;
    const body = await fs.promises.readFile(`${f}.bin`);
    fs.promises.utimes(`${f}.json`, new Date(), new Date()).catch(() => {});
    return { body, type: meta.type || 'image/png', exp: meta.exp || 0, etag: meta.etag || null, modified: meta.modified || null };
  } catch { return null; }
}
async function radarDiskPut(key, e) {
  try {
    await fs.promises.mkdir(RADAR_DIR, { recursive: true, mode: 0o700 });
    const f = radarKeyFile(key);
    await fs.promises.writeFile(`${f}.bin.tmp`, e.body, { mode: 0o600 }); await fs.promises.rename(`${f}.bin.tmp`, `${f}.bin`);   // never half a picture after a power cut
    await fs.promises.writeFile(`${f}.json`, JSON.stringify({ key, type: e.type, exp: e.exp, etag: e.etag, modified: e.modified }), { mode: 0o600 });
    if (++RADAR.writes % 50 === 1) radarDiskPrune();
  } catch { /* a full or read-only disk: memory still works */ }
}
async function radarDiskPrune() {
  try {
    const names = await fs.promises.readdir(RADAR_DIR), now = Date.now(), items = [];
    for (const n of names.filter((x) => x.endsWith('.json'))) {
      const base = path.join(RADAR_DIR, n.slice(0, -5));
      try {
        const [st, bin] = await Promise.all([fs.promises.stat(`${base}.json`), fs.promises.stat(`${base}.bin`).catch(() => null)]);
        let meta = {}; try { meta = JSON.parse(await fs.promises.readFile(`${base}.json`, 'utf8')); } catch { /* damaged: goes */ }
        const old = !bin || !meta.key || now - (meta.exp || 0) > (String(meta.key).startsWith('radar/') ? 6 * 3600_000 : 30 * 86400_000);
        items.push({ base, at: st.mtimeMs, size: (bin?.size || 0) + st.size, old });
      } catch { /* went away */ }
    }
    let total = items.reduce((s, i) => s + i.size, 0);
    for (const i of items.sort((a, b) => a.at - b.at)) {
      if (!i.old && total <= RADAR_DISK_MAX) continue;
      await fs.promises.rm(`${i.base}.bin`, { force: true }); await fs.promises.rm(`${i.base}.json`, { force: true }); total -= i.size;
    }
  } catch { /* no cache folder yet */ }
}
setInterval(() => radarDiskPrune(), 3600_000).unref?.();
/** One tile: fresh from the cache, else from upstream (one fetch for everyone asking at once); if upstream
    fails, the last copy we have, however old. */
async function radarCachedTile(key, url, keepMs) {
  let e = radarMemGet(key) || await radarDiskGet(key);
  if (e) radarMemPut(key, e);
  if (e && e.exp > Date.now()) return e;
  if (RADAR.inflight.has(key)) return RADAR.inflight.get(key);
  const job = (async () => {
    try {
      const r = await radarUpstream(url, { etag: e?.etag, modified: e?.modified });
      if (r.notModified && e) { e = { ...e, exp: Date.now() + (keepMs ?? radarKeepFor(r.headers)) }; }
      else if (r.notModified) throw Object.assign(new Error('nothing new'), { status: 502 });
      else e = { body: r.body, type: r.type, exp: Date.now() + (keepMs ?? radarKeepFor(r.headers)), etag: r.headers.get('etag') || null, modified: r.headers.get('last-modified') || null };
      radarMemPut(key, e); if (!key.startsWith('radar/')) radarDiskPut(key, e);   // rain frames last 2 hours: memory only (on an SD card each one is wear); map tiles keep on disk for weeks
      return e;
    } catch (err) { if (e) return { ...e, stale: true }; throw err; } finally { RADAR.inflight.delete(key); }
  })();
  RADAR.inflight.set(key, job);
  return job;
}

/* ---- the frames: RainViewer's list every few minutes; the last good list is kept on disk for when it's offline ---- */
const RADAR_FRAMES_FILE = path.join(RADAR_DIR, 'frames.json');
/** NWS: one frame, the newest mosaic, named after the 5-minute step it belongs to (so the cache refreshes with it). */
function radarNwsFrames() {
  const t = Math.floor(Date.now() / 1000 / RADAR_NWS.step) * RADAR_NWS.step;
  return { host: 'nws', provider: 'nws', past: [{ time: t, path: `/v2/radar/nws-${t}` }], nowcast: [], generated: t, fetchedAt: Date.now() };
}
async function radarFramesNow() {
  const now = Date.now();
  if (radarProviderSetting() === 'nws') { RADAR.frames = radarNwsFrames(); RADAR.framesErr = null; RADAR.live = true; RADAR.framesAt = now; return RADAR.frames; }
  if (RADAR.frames?.provider === 'nws') { RADAR.frames = null; RADAR.framesAt = 0; }   // switched back: fetch RainViewer's list
  if (RADAR.frames && now - RADAR.framesAt < (RADAR.framesErr ? 2 * 60_000 : 4 * 60_000)) return RADAR.frames;
  if (RADAR.inflight.has('frames')) return RADAR.inflight.get('frames');
  const job = (async () => {
    try {
      const r = await radarUpstream('https://api.rainviewer.com/public/weather-maps.json', { json: true });
      RADAR.frames = { ...radarParseMaps(JSON.parse(r.body.toString('utf8'))), fetchedAt: now }; RADAR.framesErr = null; RADAR.live = true;
      fs.promises.mkdir(RADAR_DIR, { recursive: true, mode: 0o700 }).then(() => fs.promises.writeFile(RADAR_FRAMES_FILE, JSON.stringify(RADAR.frames), { mode: 0o600 })).catch(() => {});
    } catch (err) {
      RADAR.framesErr = String(err.message || err); RADAR.live = false;
      if (!RADAR.frames) {
        try { const d = JSON.parse(fs.readFileSync(RADAR_FRAMES_FILE, 'utf8')); RADAR.frames = { ...radarParseMaps({ host: d.host, generated: d.generated, radar: { past: d.past, nowcast: d.nowcast } }), fetchedAt: Number(d.fetchedAt) || 0 }; } catch { /* never had any */ }
      }
    }
    RADAR.framesAt = Date.now();
    return RADAR.frames;
  })().finally(() => RADAR.inflight.delete('frames'));
  RADAR.inflight.set('frames', job);
  return job;
}

/* ---- made-up rain for the demo (only when the real radar can't be reached) ----
   A front moving in from the west-southwest at about 30 km/h, reaching the demo house about 25 minutes after
   the newest frame, with a few showers elsewhere. Drawn in the same colors as the real radar. */
const RADAR_UB = ['63615914', '66635a19', '69665c1e', '6c685d24', '6f6b5f29', '726e612e', '75706234', '78736439', '7c75653e', '7f786744', '827b6949', '857d6a4e', '88806c54', '8b826d59', '8e856f5e', '92887164', '9e93756e', 'aa9e7978', 'b6a97e82', 'c2b4828c', 'cec08796', 'd2c48ba0', 'd6c88faa', 'dacc93b4', 'ded097be',
  '88ddeeff', '6cd1ebff', '51c5e8ff', '36bae5ff', '1baee2ff', '00a3e0ff', '009ad5ff', '0091caff', '0088bfff', '007fb4ff', '0077aaff', '0070a3ff', '00699cff', '006295ff', '005b8eff', '005588ff', '005180ff', '004e78ff', '004a70ff', '004768ff',
  'ffee00ff', 'ffe000ff', 'ffd200ff', 'ffc500ff', 'ffb700ff', 'ffaa00ff', 'ff9f00ff', 'ff9500ff', 'ff8b00ff', 'ff8100ff', 'ff4400ff', 'f23600ff', 'e62800ff', 'd91b00ff', 'cd0d00ff', 'c10000ff', 'a80000ff', '8f0000ff', '760000ff', '5d0000ff',
  'ffaaffff', 'ff9fffff', 'ff95ffff', 'ff8bffff', 'ff81ffff', 'ff77ffff', 'ff6cffff', 'ff62ffff', 'ff58ffff', 'ff4effff', 'ffffffff'].map((h) => [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16)));   // RainViewer's "Universal Blue", rain, -10 to 65 dBZ
const radarHash = (x, y) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function radarNoise(x, y) {   // smooth value noise, 0..1
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = radarHash(xi, yi), b = radarHash(xi + 1, yi), c = radarHash(xi, yi + 1), d = radarHash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** dBZ of the made-up rain at a place, `mins` minutes after the newest frame. */
function radarSynthDbz(lat, lon, mins, home = RADAR_DEMO_HOME) {
  const kx = 111.32 * Math.cos((home.lat * Math.PI) / 180), east = (lon - home.lon) * kx, north = (lat - home.lat) * 110.57;
  const ang = (20 * Math.PI) / 180, speed = 0.5;   // moving toward 20° north of east, 0.5 km a minute
  const ex = east - Math.cos(ang) * speed * mins, ny = north - Math.sin(ang) * speed * mins;   // the storm's own frame: it moves, its shape doesn't
  const u = ex * Math.cos(ang) + ny * Math.sin(ang), v = -ex * Math.sin(ang) + ny * Math.cos(ang);   // u: along the motion, v: along the front
  const rx = ex * 0.8776 - ny * 0.4794, ry = ex * 0.4794 + ny * 0.8776;   // noise turned off the grid, so nothing lines up with north
  const n1 = radarNoise(rx / 18 + 50, ry / 18 + 50), n2 = radarNoise(rx / 6 + 9, ry / 6 + 3), n3 = radarNoise(rx / 2.2, ry / 2.2);
  const behind = -(u + 12.5 + (v / 150) ** 2 * 40) + (n1 - 0.5) * 18 + (radarNoise(v / 45, 7.5) - 0.5) * 14;   // km behind the front's leading edge (a gentle bow, 12.5 km short of home at the newest frame)
  let dbz = -20;
  if (behind > 0 && behind < 120) {
    const rise = Math.min(1, behind / 7), tail = Math.exp(-Math.max(0, behind - 14) / 38), along = Math.exp(-((v / 210) ** 2));
    dbz = (18 + 30 * rise * tail + (n2 - 0.5) * 16 + (n3 - 0.5) * 3) * along + (along < 1 ? (1 - along) * -25 : 0);
    if (behind < 18 && n2 > 0.62) dbz += (n2 - 0.62) * 45;   // a few strong cells along the edge
  }
  const showers = radarNoise(ry / 34 + 200, rx / 34 - 70);
  if (showers > 0.86 && u > 60) dbz = Math.max(dbz, 8 + (showers - 0.86) * 220 + (n2 - 0.5) * 8);   // a few showers well ahead of it
  return dbz;
}
const RADAR_CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function radarCrc(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = RADAR_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
/** A plain RGBA PNG (no library). */
function radarPng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) : raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(radarCrc(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
function radarSynthTile(z, x, y, mins) {
  const G = 65, S = 256, grid = new Float32Array(G * G);   // the rain worked out on a 65 x 65 grid, then smoothed up to 256 x 256
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const p = radarLonLatOf(x + i / (G - 1), y + j / (G - 1), z); grid[j * G + i] = radarSynthDbz(p.lat, p.lon, mins); }
  const px = Buffer.alloc(S * S * 4);
  for (let py = 0; py < S; py++) for (let qx = 0; qx < S; qx++) {
    const gx = (qx / (S - 1)) * (G - 1), gy = (py / (S - 1)) * (G - 1), i0 = Math.min(G - 2, Math.floor(gx)), j0 = Math.min(G - 2, Math.floor(gy)), fx = gx - i0, fy = gy - j0;
    const d = grid[j0 * G + i0] * (1 - fx) * (1 - fy) + grid[j0 * G + i0 + 1] * fx * (1 - fy) + grid[(j0 + 1) * G + i0] * (1 - fx) * fy + grid[(j0 + 1) * G + i0 + 1] * fx * fy;
    if (d < 8) continue;
    const c = RADAR_UB[Math.max(0, Math.min(RADAR_UB.length - 1, Math.round(d) + 10))], o = (py * S + qx) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3];
  }
  return radarPng(S, S, px);
}
function radarSynthFrames() {
  const step = 600, last = Math.floor(Date.now() / 1000 / step) * step - step;   // like the real radar: the newest frame is a few minutes old
  if (RADAR.synth?.last !== last) RADAR.synth = { last, tiles: new Map() };
  return { host: 'https://tilecache.rainviewer.com', past: Array.from({ length: 13 }, (_, i) => ({ time: last - (12 - i) * step, path: `/v2/radar/demo${last - (12 - i) * step}` })), nowcast: [], generated: last, synthetic: true };
}

/* ---- what the widget asks for ---- */
const radarRound = (v) => Math.round(v * 100) / 100;   // about a kilometer: the pin, not the house
async function radarState() {
  const home = radarHome();
  if (!home) return { state: 'nolocation' };
  const provider = radarProviderSetting();
  if (provider === 'off') return { state: 'down', provider, frames: [], home: { lat: radarRound(home.lat), lon: radarRound(home.lon), name: home.name }, zoom: RADAR_ZOOM, radius: RADAR_RADIUS, credit: [RADAR_CREDIT[1]], now: Math.floor(Date.now() / 1000), note: 'The rain radar is switched off on this CasaTorch.' };
  if (provider === 'nws' && !radarNwsCovers(home) && !isDemo()) return { state: 'down', provider, frames: [], home: { lat: radarRound(home.lat), lon: radarRound(home.lon), name: home.name }, zoom: RADAR_ZOOM, radius: RADAR_RADIUS, credit: RADAR_NWS_CREDIT, now: Math.floor(Date.now() / 1000), note: 'The National Weather Service radar covers the lower 48 US states only - pick RainViewer for radar here.' };
  let f = await radarFramesNow().catch(() => null), synthetic = false;
  if (isDemo() && (!f || RADAR.framesErr)) { f = radarSynthFrames(); synthetic = true; }   // the demo with no internet: made-up rain
  RADAR.synthOn = synthetic;
  const base = { home: { lat: radarRound(home.lat), lon: radarRound(home.lon), name: home.name }, zoom: RADAR_ZOOM, radius: RADAR_RADIUS, credit: provider === 'nws' && !synthetic ? RADAR_NWS_CREDIT : RADAR_CREDIT, provider, providers: RADAR_PROVIDERS, now: Math.floor(Date.now() / 1000), demo: isDemo() };
  if (!f) return { ...base, state: 'down', frames: [], note: 'The radar is not answering right now.' };
  const frames = [...f.past.map((x) => ({ t: x.time, kind: 'past' })), ...f.nowcast.map((x) => ({ t: x.time, kind: 'forecast' }))];
  const stale = !synthetic && !!RADAR.framesErr;
  return { ...base, state: synthetic ? 'demo' : stale ? 'stale' : 'live', synthetic, frames,
    note: synthetic ? 'Demo: made-up rain, not real weather.' : stale ? 'Offline - showing the last radar CasaTorch saved.' : isDemo() ? 'Demo house: the real radar for San Francisco.' : null };
}
app.get('/api/radar/frames', async (_req, res) => {
  try { res.json(await radarState()); } catch (err) { res.status(502).json({ error: String(err.message || err) }); }
});
app.get('/api/radar/tile/:kind/:z/:x/:y', async (req, res) => {
  const { kind } = req.params, [z, x, y] = [req.params.z, req.params.x, String(req.params.y).replace(/\.png$/, '')].map((v) => (/^\d{1,4}$/.test(v) ? Number(v) : NaN));
  const home = radarHome();
  if (!home) return res.status(409).json({ error: 'Set your town first.' });
  if (!radarAllowed(kind, z, x, y, home)) return res.status(403).json({ error: 'Only the map around your home can be shown.' });
  const send = (e, maxAge) => { res.set({ 'Content-Type': e.type || 'image/png', 'Cache-Control': `private, max-age=${e.stale ? 300 : maxAge}`, 'Cross-Origin-Resource-Policy': 'same-origin' }); if (e.stale) res.set('X-CasaTorch-Stale', '1'); res.end(e.body); };
  try {
    if (kind === 'base') return send(await radarCachedTile(`base/${z}/${x}/${y}`, radarTileUrl('base', z, x, y)), 7 * 86400);
    const t = Number(req.query.f);
    if (!Number.isInteger(t)) return res.status(400).json({ error: 'which frame?' });
    if (isDemo() && RADAR.synthOn && RADAR.synth && t <= RADAR.synth.last && RADAR.synth.last - t <= 12 * 600 && (RADAR.synth.last - t) % 600 === 0) {
      const key = `${t}/${z}/${x}/${y}`;
      let body = RADAR.synth.tiles.get(key);
      if (!body) { body = radarSynthTile(z, x, y, (t - RADAR.synth.last) / 60); RADAR.synth.tiles.set(key, body); if (RADAR.synth.tiles.size > 600) RADAR.synth.tiles.delete(RADAR.synth.tiles.keys().next().value); }
      return send({ body, type: 'image/png' }, 3600);
    }
    const f = RADAR.frames, frame = f && [...f.past, ...f.nowcast].find((p) => p.time === t);
    if (!frame) return res.status(404).json({ error: 'That radar frame has rolled off - reload.' });
    send(await radarCachedTile(`radar/${frame.path}/${z}/${x}/${y}`, radarTileUrl('radar', z, x, y, frame, f.host), 6 * 3600_000), 6 * 3600);
  } catch (err) {
    if (err.status === 503) res.set('Retry-After', '20');
    res.status(err.status === 404 ? 404 : err.status === 503 ? 503 : 502).json({ error: 'The map is not loading right now.' });
  }
});

/* ---- the outline (land, borders, US states) near home, cut to the area and simplified for the zoom ---- */
function radarOutlineData() {
  if (RADAR.outline) return RADAR.outline;
  const j = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'catalog', 'radar-outline.json'), 'utf8')), q = j.q || 100;
  const unpack = (a) => { const pts = []; let x = 0, y = 0; for (let i = 0; i + 1 < a.length; i += 2) { x += a[i]; y += a[i + 1]; pts.push([x / q, y / q]); } return pts; };
  const withBox = (pts) => { let w = 180, e = -180, s = 90, n = -90; for (const [x, y] of pts) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; } return { pts, box: [w, s, e, n] }; };
  RADAR.outline = { land: j.land.map(unpack).map(withBox), borders: j.borders.map(unpack).map(withBox), states: (j.states || []).map(unpack).map(withBox) };
  return RADAR.outline;
}
/** Sutherland-Hodgman: a polygon ring cut to a box (the cut edges run along the box, outside the view). */
function radarClipRing(pts, [w, s, e, n]) {
  let out = pts;
  const edges = [[(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]], [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]], [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]]];
  for (const [inside, cut] of edges) {
    if (!out.length) break;
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); } else if (inside(prev)) out.push(cut(prev, cur));
    }
  }
  return out;
}
/** A line cut to a box: the pieces inside (each with the point just outside, so it reaches the edge). */
function radarClipLine(pts, [w, s, e, n]) {
  const inside = (p) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n, out = []; let cur = null;
  for (let i = 0; i < pts.length; i++) {
    if (inside(pts[i])) { if (!cur) { cur = i > 0 ? [pts[i - 1]] : []; out.push(cur); } cur.push(pts[i]); } else if (cur) { cur.push(pts[i]); cur = null; }
  }
  return out.filter((l) => l.length >= 2);
}
function radarThin(pts, tol) {   // drop points closer together than about a pixel
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) { const l = out[out.length - 1]; if (Math.abs(pts[i][0] - l[0]) + Math.abs(pts[i][1] - l[1]) >= tol) out.push(pts[i]); }
  out.push(pts[pts.length - 1]); return out;
}
function radarOutlineFor(home, z) {
  const t = radarTileOf(home.lat, home.lon, z), hx = Math.floor(t.x), hy = Math.floor(t.y), R = RADAR_RADIUS;
  const nw = radarLonLatOf(hx - R, hy - R, z), se = radarLonLatOf(hx + R + 1, hy + R + 1, z);
  const box = [Math.max(home.lon - 25, nw.lon), Math.max(home.lat - 16, se.lat), Math.min(home.lon + 25, se.lon), Math.min(home.lat + 16, nw.lat)];
  const pad = [box[0] - 0.5, box[1] - 0.5, box[2] + 0.5, box[3] + 0.5], tol = (360 / 2 ** z / 256) * 0.8;
  const hits = (b) => b[2] >= pad[0] && b[0] <= pad[2] && b[3] >= pad[1] && b[1] <= pad[3];
  const D = radarOutlineData(), r3 = (v) => Math.round(v * 1000) / 1000, flat = (pts) => pts.flatMap(([x, y]) => [r3(x), r3(y)]);
  const land = D.land.filter((r) => hits(r.box)).map((r) => radarThin(radarClipRing(r.pts, pad), tol)).filter((r) => r.length >= 3).map(flat);
  const lines = (list) => list.filter((r) => hits(r.box)).flatMap((r) => radarClipLine(r.pts, pad)).map((l) => radarThin(l, tol)).map(flat);
  return { z, box: box.map(r3), land, borders: lines(D.borders), states: lines(D.states), credit: 'Natural Earth' };
}
app.get('/api/radar/outline', (req, res) => {
  const home = radarHome(), z = Math.max(RADAR_ZOOM.min, Math.min(RADAR_ZOOM.max, Math.round(Number(req.query.z) || 7)));
  if (!home) return res.status(409).json({ error: 'Set your town first.' });
  const key = `${home.lat},${home.lon},${z}`;
  try {
    let v = RADAR.outlineMemo.get(key);
    if (!v) { v = radarOutlineFor(home, z); RADAR.outlineMemo.set(key, v); if (RADAR.outlineMemo.size > 12) RADAR.outlineMemo.delete(RADAR.outlineMemo.keys().next().value); }
    res.set('Cache-Control', 'private, max-age=86400'); res.json(v);
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

/* ---- which radar this home uses (admins) ---- */
app.put('/api/radar/provider', requireRole('admin'), express.json({ limit: '1kb' }), (req, res) => {
  const v = String(req.body?.provider || '').toLowerCase();
  if (!RADAR_PROVIDERS.includes(v)) return res.status(400).json({ error: 'Pick rainviewer, nws or off.' });
  if (isDemo()) return res.json({ ok: true, demo: true, provider: v });
  try { saveConfig({ ...config, radar: { ...(config.radar || {}), provider: v } }); } catch (err) { return res.status(500).json({ error: String(err.message || err) }); }
  RADAR.frames = null; RADAR.framesAt = 0;
  res.json({ ok: true, provider: radarProviderSetting() });
});

/* ---- set the home's town from the widget (it's the same town setup asks for; the weather uses it too) ---- */
app.post('/api/radar/home', requireRole('admin'), express.json({ limit: '2kb' }), (req, res) => {
  const b = req.body || {}, lat = Number(b.lat), lon = Number(b.lon), name = String(b.name || '').trim().slice(0, 80);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180 || !name) return res.status(400).json({ error: 'Pick a town from the list.' });
  if (isDemo()) return res.json({ ok: true, demo: true });
  try { saveConfig({ ...config, location: { name, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 } }); } catch (err) { return res.status(500).json({ error: String(err.message || err) }); }
  RADAR.outlineMemo.clear();
  res.json({ ok: true });
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchRadar = { radarTileOf, radarLonLatOf, radarAllowed, radarUrlAllowed, radarParseMaps, radarTileUrl, radarKeepFor, radarClipRing, radarClipLine, radarSynthDbz, radarSynthTile, radarPng, radarCrc, radarOutlineFor, radarNwsTileUrl, radarNwsCovers, radarProviderSetting, RADAR_ZOOM, RADAR_RADIUS, RADAR_DEMO_HOME };
