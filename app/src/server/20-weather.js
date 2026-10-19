/* ======================================================================
 * Weather - MET Norway's locationforecast (free, worldwide, commercial use
 * allowed with credit; they ask for a real User-Agent and polite caching).
 * Where: config.location {lat, lon, name}, set in the setup wizard.
 * ====================================================================== */
const SYMBOL_WORDS = { clearsky: 'Clear', fair: 'Mostly clear', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog', lightrain: 'Light rain', rain: 'Rain', heavyrain: 'Heavy rain', lightrainshowers: 'Showers', rainshowers: 'Showers', heavyrainshowers: 'Heavy showers', lightsnow: 'Light snow', snow: 'Snow', heavysnow: 'Heavy snow', sleet: 'Sleet', lightsleet: 'Light sleet', snowshowers: 'Snow showers', rainandthunder: 'Thunderstorms', heavyrainandthunder: 'Thunderstorms', lightrainandthunder: 'Thunderstorms', rainshowersandthunder: 'Thunderstorms' };
const symbolWord = (s) => SYMBOL_WORDS[String(s || '').replace(/_(day|night|polartwilight)$/, '')] || pretty(String(s || 'unknown').replace(/_(day|night|polartwilight)$/, ''));
const pretty = (s) => String(s).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
/** Turn MET's hourly series into now / next hours / days, in the house's units. */
function weatherView(j, tz) {
  const ts = j?.properties?.timeseries || [];
  if (!ts.length) throw new Error('no forecast in the answer');
  const now = ts[0];
  const d = now.data.instant.details;
  const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const days = new Map();
  for (const t of ts) {
    const k = dayKey(t.time), temp = t.data.instant.details.air_temperature;
    const day = days.get(k) || { date: k, hi: -Infinity, lo: Infinity, rain: 0, symbols: [] };
    day.hi = Math.max(day.hi, temp); day.lo = Math.min(day.lo, temp);
    const n1 = t.data.next_1_hours, n6 = t.data.next_6_hours;
    if (n1) day.rain += n1.details?.precipitation_amount || 0;
    const sym = n1?.summary?.symbol_code || n6?.summary?.symbol_code;
    const hour = Number(new Date(t.time).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
    if (sym && hour >= 9 && hour <= 18) day.symbols.push(sym);
    days.set(k, day);
  }
  const mode = (a) => { const c = {}; for (const x of a) c[x] = (c[x] || 0) + 1; return Object.entries(c).sort((x, y) => y[1] - x[1])[0]?.[0]; };
  const nowSym = now.data.next_1_hours?.summary?.symbol_code || now.data.next_6_hours?.summary?.symbol_code;
  return {
    place: config.location?.name || null, units: config.house?.units === 'C' ? 'C' : 'F', updated: j.properties?.meta?.updated_at || null,
    now: { temp: tempOut(d.air_temperature), symbol: nowSym, words: symbolWord(nowSym), wind: speedOut(d.wind_speed || 0), windMs: d.wind_speed ?? null, gustMs: d.wind_speed_of_gust ?? null, windDir: d.wind_from_direction ?? null, humidity: Math.round(d.relative_humidity || 0), cloud: d.cloud_area_fraction != null ? Math.round(d.cloud_area_fraction) : null, rainMm: now.data.next_1_hours?.details?.precipitation_amount ?? null },
    hours: ts.slice(0, 12).map((t) => ({ at: t.time, temp: tempOut(t.data.instant.details.air_temperature), symbol: t.data.next_1_hours?.summary?.symbol_code || null, rainMm: t.data.next_1_hours?.details?.precipitation_amount ?? null })),
    days: [...days.values()].slice(0, 7).map((x) => ({ date: x.date, hi: tempOut(x.hi), lo: tempOut(x.lo), rainMm: Math.round(x.rain * 10) / 10, symbol: mode(x.symbols) || null, words: symbolWord(mode(x.symbols)) })),
    credit: 'Weather: MET Norway',
  };
}
async function weatherNow() {
  const loc = config.location;
  if (!loc?.lat || !loc?.lon) return { error: 'no location set' };
  const lat = Number(loc.lat).toFixed(4), lon = Number(loc.lon).toFixed(4);   // MET asks for at most 4 decimals
  const wx = await cached(`weather:${lat},${lon}`, 30 * 60_000, async () => weatherView(await getJSON(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`), houseTz()));
  return typeof famOutside === 'function' ? famOutside(wx) : wx;   // your own outdoor sensors in place of the forecast's "now" (79c-family.js)
}
app.get('/api/weather', async (_req, res) => { try { res.json(await weatherNow()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });

/* ---- The weather drawer: 48 hours, 10 days, rain, wind, UV, sunrise and sunset ----
   MET Norway's "complete" forecast (the same service and User-Agent, cached 30 minutes): hourly for about two days,
   then every 6 hours to about ten days. forecastView reads it; nothing is made up where the answer has a gap. */
const wxMode = (a) => { const c = {}; for (const x of a) c[x] = (c[x] || 0) + 1; return Object.entries(c).sort((x, y) => y[1] - x[1])[0]?.[0] || null; };
function forecastView(j, tz, place = null) {
  const ts = j?.properties?.timeseries || [];
  if (!ts.length) throw new Error('no forecast in the answer');
  const r1 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
  const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const hourOf = (iso) => Number(new Date(iso).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }));
  const hours = [], days = new Map();
  for (const t of ts) {
    const d = t.data?.instant?.details || {}, n1 = t.data?.next_1_hours, n6 = t.data?.next_6_hours, k = dayKey(t.time);
    if (n1 && hours.length < 48) hours.push({ at: t.time, temp: tempOut(d.air_temperature), symbol: n1.summary?.symbol_code || null, rainMm: r1(n1.details?.precipitation_amount), pop: n1.details?.probability_of_precipitation != null ? Math.round(n1.details.probability_of_precipitation) : null,
      wind: d.wind_speed != null ? speedOut(d.wind_speed) : null, gust: d.wind_speed_of_gust != null ? speedOut(d.wind_speed_of_gust) : null, windDir: d.wind_from_direction ?? null, uv: r1(d.ultraviolet_index_clear_sky), humidity: d.relative_humidity != null ? Math.round(d.relative_humidity) : null, cloud: d.cloud_area_fraction != null ? Math.round(d.cloud_area_fraction) : null });
    const day = days.get(k) || { date: k, hi: -Infinity, lo: Infinity, rain: 0, rainFrom: null, pop: null, wind: 0, uv: null, symbols: [] };
    if (Number.isFinite(d.air_temperature)) { day.hi = Math.max(day.hi, d.air_temperature); day.lo = Math.min(day.lo, d.air_temperature); }
    if (n6?.details?.air_temperature_max != null) day.hi = Math.max(day.hi, n6.details.air_temperature_max);
    if (n6?.details?.air_temperature_min != null) day.lo = Math.min(day.lo, n6.details.air_temperature_min);
    // rain: hourly amounts while there are hours, then the 6-hour amounts (never both for the same hours)
    if (n1) { day.rain += n1.details?.precipitation_amount || 0; day.rainFrom = day.rainFrom || 1; day.until = Date.parse(t.time) + 3600_000; }
    else if (n6 && !(day.until && Date.parse(t.time) < day.until)) { day.rain += n6.details?.precipitation_amount || 0; day.until = Date.parse(t.time) + 6 * 3600_000; }
    const pop = n1?.details?.probability_of_precipitation ?? n6?.details?.probability_of_precipitation; if (pop != null) day.pop = Math.max(day.pop ?? 0, Math.round(pop));
    if (d.wind_speed != null) day.wind = Math.max(day.wind, d.wind_speed);
    if (d.ultraviolet_index_clear_sky != null) day.uv = Math.max(day.uv ?? 0, d.ultraviolet_index_clear_sky);
    const sym = n1?.summary?.symbol_code || n6?.summary?.symbol_code, h = hourOf(t.time);
    if (sym && h >= 9 && h <= 18) day.symbols.push(sym); else if (sym && !day.symbols.length) day.symbols.push(sym);
    days.set(k, day);
  }
  const now = ts[0].data?.instant?.details || {}, nowSym = ts[0].data?.next_1_hours?.summary?.symbol_code || ts[0].data?.next_6_hours?.summary?.symbol_code;
  return {
    place: place || config.location?.name || null, units: config.house?.units === 'C' ? 'C' : 'F', windUnit: config.house?.units === 'C' ? 'km/h' : 'mph', updated: j.properties?.meta?.updated_at || null,
    now: { temp: tempOut(now.air_temperature), symbol: nowSym || null, words: symbolWord(nowSym), wind: now.wind_speed != null ? speedOut(now.wind_speed) : null, gust: now.wind_speed_of_gust != null ? speedOut(now.wind_speed_of_gust) : null, windDir: now.wind_from_direction ?? null,
      humidity: now.relative_humidity != null ? Math.round(now.relative_humidity) : null, uv: r1(now.ultraviolet_index_clear_sky), cloud: now.cloud_area_fraction != null ? Math.round(now.cloud_area_fraction) : null, pressure: now.air_pressure_at_sea_level != null ? Math.round(now.air_pressure_at_sea_level) : null, dewPoint: now.dew_point_temperature != null ? tempOut(now.dew_point_temperature) : null },
    hours,
    days: [...days.values()].filter((x) => Number.isFinite(x.hi)).slice(0, 10).map((x) => ({ date: x.date, hi: tempOut(x.hi), lo: tempOut(x.lo), rainMm: Math.round(x.rain * 10) / 10, pop: x.pop, wind: x.wind ? speedOut(x.wind) : null, uv: x.uv != null ? Math.round(x.uv * 10) / 10 : null, symbol: wxMode(x.symbols), words: symbolWord(wxMode(x.symbols)) })),
    credit: 'Weather: MET Norway',
  };
}
/* Sunrise and sunset for each forecast day (worked out here, the same as the Sun & moon tile). */
function forecastSun(f, lat, lon) {
  if (typeof sunTimes !== 'function' || lat == null || lon == null) return f;
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  return { ...f, days: f.days.map((d) => { const s = sunTimes(new Date(`${d.date}T12:00:00Z`), lat, lon); return { ...d, sunrise: iso(s.sunrise), sunset: iso(s.sunset) }; }) };
}
/* The demo: a forecast around today that matches the sample (a rainy spell midweek), made up. */
function demoForecast(place) {
  const w = demoFixture('home')?.weather; if (!w) return { error: 'no demo weather' };
  const tz = houseTz(), h0 = Math.floor(Date.now() / 3600_000) * 3600_000, base = (w.days || [])[0] || { hi: 70, lo: 54 };
  const hourOf = (t) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)));
  const days = Array.from({ length: 10 }, (_, i) => { const fx = w.days?.[i]; const date = new Date(Date.parse(`${(w.days?.[0]?.date || new Date().toISOString().slice(0, 10))}T12:00:00Z`) + i * 86400_000).toISOString().slice(0, 10);
    const wet = i === 2 || i === 3, hi = fx?.hi ?? base.hi - (i % 3), lo = fx?.lo ?? base.lo - (i % 2);
    return { date, hi: wet ? hi - 6 : hi, lo: wet ? lo - 2 : lo, rainMm: wet ? (i === 2 ? 14.2 : 6.8) : i === 7 ? 0.8 : 0, pop: wet ? (i === 2 ? 90 : 70) : i === 7 ? 30 : 5, wind: wet ? 18 : 6 + (i % 4), uv: wet ? 1.5 : 4 + (i % 3), symbol: wet ? (i === 2 ? 'heavyrain' : 'rainshowers_day') : i === 7 ? 'lightrainshowers_day' : fx?.symbol || 'partlycloudy_day', words: wet ? (i === 2 ? 'Heavy rain' : 'Showers') : i === 7 ? 'Showers' : fx?.words || 'Partly cloudy' }; });
  const hours = Array.from({ length: 48 }, (_, k) => { const at = h0 + k * 3600_000, hr = hourOf(at), d = days[Math.min(9, Math.floor(k / 24))], day = hr >= 7 && hr < 19;
    const temp = Math.round(d.lo + (d.hi - d.lo) * Math.max(0, Math.sin(((hr - 6) / 24) * 2 * Math.PI) * 0.5 + 0.5) ** 1.4);
    const rain = k >= 30 && k <= 40 ? Math.round((0.4 + ((k * 7) % 5) / 4) * 10) / 10 : 0;
    return { at: new Date(at).toISOString(), temp, symbol: rain ? 'rain' : day ? 'partlycloudy_day' : 'clearsky_night', rainMm: rain, pop: rain ? 70 + (k % 3) * 10 : 5, wind: 5 + (k % 7) + (rain ? 8 : 0), gust: 11 + (k % 9) + (rain ? 10 : 0), windDir: 250 + (k % 5) * 8, uv: day ? Math.round(Math.max(0, Math.sin(((hr - 7) / 12) * Math.PI)) * 50) / 10 : 0, humidity: 52 + (k % 6) * 3 + (rain ? 25 : 0), cloud: rain ? 95 : day ? 40 : 10 }; });
  // the first hours are the sample's own (so "now" and the chart agree), then the made-up curve takes over smoothly
  const fx = (w.hours || []).map((x) => x.temp).filter(Number.isFinite);
  if (fx.length) { const k0 = fx.length, gap = fx[k0 - 1] - hours[k0 - 1].temp; hours.forEach((x, k) => { x.temp = k < k0 ? fx[k] : Math.round(x.temp + gap * Math.max(0, 1 - (k - k0 + 1) / 8)); }); }
  return forecastSun({ place: place || w.place, units: w.units || 'F', windUnit: w.units === 'C' ? 'km/h' : 'mph', updated: new Date(h0).toISOString(), now: { ...w.now, gust: 14, windDir: 260, uv: 3.2, cloud: 40, pressure: 1016, dewPoint: 49 }, hours, days, credit: 'Sample forecast in the demo', demo: true }, 37.7749, -122.4194);
}
app.get('/api/w/forecast', async (req, res) => {
  const q = req.query.lat != null && req.query.lon != null ? { lat: Number(req.query.lat), lon: Number(req.query.lon), name: String(req.query.name || '').slice(0, 80) || null } : null;
  const loc = q && Number.isFinite(q.lat) && Number.isFinite(q.lon) && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180 ? q : config.location ? { lat: Number(config.location.lat), lon: Number(config.location.lon), name: config.location.name || null } : null;
  if (isDemo()) return res.json(demoForecast(q?.name));
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return res.json({ error: 'Add your town in Settings to see the weather.' });
  if (q && typeof W_LIMIT === 'function' && W_LIMIT(req)) return res.status(429).json({ error: 'slow down' });
  const lat = loc.lat.toFixed(4), lon = loc.lon.toFixed(4);
  try { const f = await cached(`forecast:${lat},${lon}`, 30 * 60_000, async () => forecastView(await getJSON(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`), houseTz(), loc.name));
    res.json(forecastSun(f, Number(lat), Number(lon))); }
  catch (err) { res.status(502).json({ error: String(err.message) }); }
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchForecast = { forecastView, demoForecast };
