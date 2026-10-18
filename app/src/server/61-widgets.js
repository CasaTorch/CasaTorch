/* ======================================================================
 * Data for the Home screen's extra widgets. Each answer is small, cached and
 * shared by every screen, so ten tablets showing the same stock cost one
 * request a couple of minutes.
 *   /api/w/weather?lat&lon&name   the weather somewhere else (MET Norway)
 *   /api/w/places?q=              find a town for that (OpenStreetMap)
 *   /api/w/stocks?s=AAPL,^GSPC    quotes and a small chart (Yahoo Finance; delayed)
 *   /api/w/leagues, /api/w/teams  pick teams for one Scores widget
 *   /api/w/sports?t=nfl:25,...    those teams' games (ESPN)
 *   /api/w/sun                    sunrise, sunset, daylight, the moon (worked out here - no service)
 * ====================================================================== */
const W_LIMIT = (req, n = 60) => overLimit(`w:${typeof clientIp === 'function' ? clientIp(req) : req.ip}`, n, 60_000);
const wNum = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };

/* ---- weather somewhere else ---- */
async function weatherAt(lat, lon, name) {
  const la = lat.toFixed(4), lo = lon.toFixed(4);
  const v = await cached(`weather:${la},${lo}`, 30 * 60_000, async () => weatherView(await getJSON(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`), houseTz()));
  return { ...v, place: name || v.place };
}
app.get('/api/w/weather', async (req, res) => {
  const lat = wNum(req.query.lat, -90, 90), lon = wNum(req.query.lon, -180, 180), name = String(req.query.name || '').slice(0, 80) || null;
  if (lat == null || lon == null) return res.status(400).json({ error: 'pick a place' });
  if (isDemo()) { const w = demoFixture('home')?.weather; return res.json(w ? { ...w, place: name || w.place } : { error: 'no demo weather' }); }
  if (W_LIMIT(req)) return res.status(429).json({ error: 'slow down' });
  try { res.json(await weatherAt(lat, lon, name)); } catch (err) { res.status(502).json({ error: String(err.message) }); }
});
/* Town search, for setup (/api/setup/geocode) and the widgets: OpenStreetMap's Nominatim, used the way its usage
   policy asks - only from this server (CasaTorch's own User-Agent, never the browser), one search when the person
   presses Find or Enter (no search-as-you-type), at least 3 characters, at most one request a second from this box,
   answers cached for a week, and the OpenStreetMap credit shown with the results. */
const PLACE_CREDIT = { text: 'Search © OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' };
const PLACE_MIN = 3;
let nominatimNext = 0;
async function nominatimSlot() {   // one request a second for the whole box; a queue longer than a few seconds says "busy"
  const now = Date.now(), at = Math.max(now, nominatimNext);
  if (at - now > 5000) throw Object.assign(new Error('town search is busy - try again in a few seconds'), { status: 429 });
  nominatimNext = at + 1100;
  if (at > now) await new Promise((ok) => setTimeout(ok, at - now));
}
const placeView = (p) => { const a = p.address || {}; const town = a.city || a.town || a.village || a.hamlet || a.county || p.name; return { name: [town, a.state || a.region, a.country_code?.toUpperCase()].filter(Boolean).join(', '), cc: a.country_code ? String(a.country_code).toUpperCase().slice(0, 2) : null, lat: Math.round(Number(p.lat) * 1e4) / 1e4, lon: Math.round(Number(p.lon) * 1e4) / 1e4 }; };
async function placeSearch(q) {
  const key = String(q || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
  if (key.length < PLACE_MIN) return [];
  const j = await cached(`places:${key}`, 7 * 86400_000, async () => { await nominatimSlot(); return { list: await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&q=${encodeURIComponent(key)}`) }; });
  return (j.list || []).map(placeView);
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchPlaces = { placeSearch, PLACE_CREDIT, PLACE_MIN, ispInfo };
app.get('/api/w/places', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < PLACE_MIN) return res.json({ places: [], credit: PLACE_CREDIT });
  if (isDemo()) return res.json({ places: [{ name: `${q.replace(/^\w/, (c) => c.toUpperCase())} (demo)`, lat: 40.7128, lon: -74.006 }], credit: PLACE_CREDIT });
  if (overLimit(`wplaces:${typeof clientIp === 'function' ? clientIp(req) : req.ip}`, 20, 60_000)) return res.status(429).json({ error: 'slow down' });
  try { res.json({ places: (await placeSearch(q)).map(({ cc: _cc, ...p }) => p), credit: PLACE_CREDIT }); } catch (err) { res.status(err.status === 429 ? 429 : 502).json({ error: String(err.message) }); }
});

/* ---- stocks, funds, indexes, currencies and crypto (one source for all: Yahoo Finance's chart answers) ---- */
const SYM_RE = /^[\^A-Z0-9][A-Z0-9.=\-^]{0,14}$/;
const RANGES = { '1d': ['1d', '5m'], '5d': ['5d', '30m'], '1mo': ['1mo', '1d'], '6mo': ['6mo', '1d'], '1y': ['1y', '1wk'] };
function thin(arr, n) { const a = arr.filter((x) => typeof x === 'number' && Number.isFinite(x)); if (a.length <= n) return a; const out = []; for (let i = 0; i < n; i++) out.push(a[Math.round(i * (a.length - 1) / (n - 1))]); return out; }
async function quoteYahoo(sym, range) {
  const [r, iv] = RANGES[range] || RANGES['1d'];
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${r}&interval=${iv}&includePrePost=false`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CasaTorch)' }, timeout: 10000 });
  const res = j?.chart?.result?.[0]; if (!res?.meta) throw new Error(j?.chart?.error?.description || 'no quote');
  const m = res.meta, closes = res.indicators?.quote?.[0]?.close || [];
  const price = m.regularMarketPrice ?? closes.filter((x) => x != null).at(-1);
  const prev = range === '1d' ? (m.chartPreviousClose ?? m.previousClose) : closes.find((x) => x != null);
  if (typeof price !== 'number') throw new Error('no price');
  return { symbol: m.symbol || sym, name: m.shortName || m.longName || m.symbol || sym, price, prev: typeof prev === 'number' ? prev : null, currency: m.currency || null,
    change: typeof prev === 'number' ? price - prev : null, changePct: typeof prev === 'number' && prev ? ((price - prev) / prev) * 100 : null,
    spark: thin(closes, 48), exchange: m.exchangeName || null, at: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null };
}
async function quoteStooq(sym) {   // a fallback for plain US tickers
  if (!/^[A-Z.]{1,6}$/.test(sym)) throw new Error('no fallback for this symbol');
  const { text } = await getText(`https://stooq.com/q/l/?s=${encodeURIComponent(sym.toLowerCase())}.us&f=sd2t2ohlcvn&h&e=csv`, { timeout: 8000 });
  const row = text.trim().split('\n')[1]?.split(','); const close = Number(row?.[6]), open = Number(row?.[3]);
  if (!row || !Number.isFinite(close)) throw new Error('no quote');
  return { symbol: sym, name: (row[8] || sym).replace(/"/g, ''), price: close, prev: Number.isFinite(open) ? open : null, currency: 'USD', change: Number.isFinite(open) ? close - open : null, changePct: Number.isFinite(open) && open ? ((close - open) / open) * 100 : null, spark: [], exchange: null, at: null, note: 'change since open' };
}
function demoQuote(sym, range) {
  let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const base = 20 + (h % 900), n = 48, spark = [];
  let v = base; for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) >>> 0; v *= 1 + (((h % 1000) / 1000) - 0.48) * 0.01; spark.push(Math.round(v * 100) / 100); }
  const price = spark.at(-1), prev = spark[0];
  return { symbol: sym, name: `${sym} (demo)`, price, prev, currency: 'USD', change: price - prev, changePct: ((price - prev) / prev) * 100, spark, exchange: 'Demo', at: new Date().toISOString(), range };
}
app.get('/api/w/stocks', async (req, res) => {
  const syms = [...new Set(String(req.query.s || '').toUpperCase().split(',').map((x) => x.trim()).filter((x) => SYM_RE.test(x)))].slice(0, 12);
  const range = RANGES[req.query.range] ? String(req.query.range) : '1d';
  if (!syms.length) return res.json({ quotes: [] });
  if (isDemo()) return res.json({ quotes: syms.map((s) => demoQuote(s, range)), credit: 'Demo prices' });
  if (W_LIMIT(req)) return res.status(429).json({ error: 'slow down' });
  const quotes = await Promise.all(syms.map(async (s) => {
    try { return await cached(`q:${s}:${range}`, range === '1d' ? 120_000 : 30 * 60_000, async () => { try { return await quoteYahoo(s, range); } catch (e) { return await quoteStooq(s).catch(() => { throw e; }); } }); }
    catch (err) { return { symbol: s, error: String(err.message || err) }; }
  }));
  res.json({ quotes, credit: 'Quotes: Yahoo Finance · may be delayed' });
});

/* ---- your own teams for one Scores widget ---- */
app.get('/api/w/leagues', (_req, res) => res.json({ leagues: Object.entries(LEAGUES).map(([id, l]) => ({ id, name: l.name })) }));
app.get('/api/w/teams', async (req, res) => { try { res.json(await sportsTeams(String(req.query.league || ''))); } catch (err) { res.status(400).json({ error: String(err.message) }); } });
app.get('/api/w/sports', async (req, res) => {
  const teams = String(req.query.t || '').split(',').map((x) => x.split(':')).filter(([l, id]) => LEAGUES[l] && /^\d{1,8}$/.test(id || '')).slice(0, 12).map(([league, id]) => ({ league, id }));
  if (isDemo()) return res.json(demoFixture('home')?.sports || { games: [] });
  if (!teams.length) return res.json({ games: [] });
  try { res.json(await sportsNow(teams)); } catch (err) { res.status(502).json({ error: String(err.message) }); }
});

/* ---- the sun and the moon, worked out from where the house is (NOAA's formulas) ---- */
const RAD = Math.PI / 180;
function sunTimes(date, lat, lon) {   // UTC Date at the start of that day; returns ms timestamps or null (polar day/night)
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545, n = Math.round(d - 0.0009 + lon / 360);
  const ds = 0.0009 - lon / 360 + n;
  const M = (357.5291 + 0.98560028 * ds) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jtransit = 2451545 + ds + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * L * RAD);
  const dec = Math.asin(Math.sin(L * RAD) * Math.sin(23.4397 * RAD));
  const at = (alt) => { const c = (Math.sin(alt * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec)); if (c < -1 || c > 1) return null; const w = Math.acos(c) / RAD; return [Jtransit - w / 360, Jtransit + w / 360]; };
  const toMs = (j) => Math.round((j - 2440587.5) * 86400000);
  const rise = at(-0.833), golden = at(6), civil = at(-6);
  return { noon: toMs(Jtransit), sunrise: rise && toMs(rise[0]), sunset: rise && toMs(rise[1]), goldenStart: golden && toMs(golden[1]), dawn: civil && toMs(civil[0]), dusk: civil && toMs(civil[1]), polar: rise ? null : (Math.sin(lat * RAD) * Math.sin(dec) > 0 ? 'day' : 'night') };
}
function moonPhase(ms) {
  const syn = 29.530588853, known = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((ms - known) / 86400000) % syn + syn) % syn, f = age / syn;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const name = names[Math.floor(((f * 8) + 0.5) % 8)];
  const illum = Math.round((1 - Math.cos(2 * Math.PI * f)) / 2 * 100);
  const toFull = ((0.5 - f + 1) % 1) * syn, toNew = ((1 - f) % 1) * syn;
  return { age: Math.round(age * 10) / 10, fraction: Math.round(f * 1000) / 1000, name, illumination: illum, nextFull: new Date(ms + toFull * 86400000).toISOString(), nextNew: new Date(ms + toNew * 86400000).toISOString() };
}
app.get('/api/w/sun', (req, res) => {
  const loc = config.location || (isDemo() ? { lat: 37.7749, lon: -122.4194, name: 'San Francisco, CA' } : null);
  const lat = wNum(loc?.lat, -90, 90), lon = wNum(loc?.lon, -180, 180);
  if (lat == null || lon == null) return res.json({ error: 'Add your town in Settings to see the sun and moon.' });
  const tz = houseTz(), now = Date.now();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const day = (d) => sunTimes(new Date(`${d}T12:00:00Z`), lat, lon);
  const today = day(ymd), yest = day(new Date(Date.parse(`${ymd}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)), tom = day(new Date(Date.parse(`${ymd}T12:00:00Z`) + 86400000).toISOString().slice(0, 10));
  const len = (t) => (t.sunrise && t.sunset ? t.sunset - t.sunrise : null);
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  res.json({ place: loc.name || null, polar: today.polar, sunrise: iso(today.sunrise), sunset: iso(today.sunset), noon: iso(today.noon), dawn: iso(today.dawn), dusk: iso(today.dusk), goldenHour: iso(today.goldenStart),
    dayMs: len(today), changeMs: len(today) != null && len(yest) != null ? len(today) - len(yest) : null, tomorrowSunrise: iso(tom.sunrise), moon: moonPhase(now) });
});
