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
    now: { temp: tempOut(d.air_temperature), symbol: nowSym, words: symbolWord(nowSym), wind: speedOut(d.wind_speed || 0), humidity: Math.round(d.relative_humidity || 0) },
    hours: ts.slice(0, 12).map((t) => ({ at: t.time, temp: tempOut(t.data.instant.details.air_temperature), symbol: t.data.next_1_hours?.summary?.symbol_code || null, rainMm: t.data.next_1_hours?.details?.precipitation_amount ?? null })),
    days: [...days.values()].slice(0, 7).map((x) => ({ date: x.date, hi: tempOut(x.hi), lo: tempOut(x.lo), rainMm: Math.round(x.rain * 10) / 10, symbol: mode(x.symbols) || null, words: symbolWord(mode(x.symbols)) })),
    credit: 'Weather: MET Norway',
  };
}
async function weatherNow() {
  const loc = config.location;
  if (!loc?.lat || !loc?.lon) return { error: 'no location set' };
  const lat = Number(loc.lat).toFixed(4), lon = Number(loc.lon).toFixed(4);   // MET asks for at most 4 decimals
  return cached(`weather:${lat},${lon}`, 30 * 60_000, async () => weatherView(await getJSON(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`), houseTz()));
}
app.get('/api/weather', async (_req, res) => { try { res.json(await weatherNow()); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
