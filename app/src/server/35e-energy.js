/* ======================================================================
 * The Energy page: one answer for every tile on it (/api/energy/overview).
 *
 *  - Live: what the house uses now, and where it comes from (grid, solar, a home battery) and where it goes
 *    (the house, an EV charger, back to the grid) - from whatever meters the house has. Nothing is made up:
 *    a part the house has no sensor for is null and its tile isn't suggested.
 *  - Hour by hour: every minute CasaTorch notes the house's watts and each metered device's watts, kept as hourly
 *    averages for 8 days (data/energy-hours.json, about 200 KB). That gives the hour-of-day heatmap, each device's
 *    sparkline, the always-on estimate, standby waste, and the share used at peak price.
 *  - By day: the history CasaTorch already keeps (72-history.js), Home Assistant's Energy dashboard when it has one
 *    (35-energy-ha.js), and the bill forecast (Pro).
 *  - The demo house gets a believable, repeatable week: solar on the roof, a home battery, an EV and smart plugs.
 * ====================================================================== */
const EN_FILE = path.join(DATA_DIR, 'energy-hours.json');
const EN = { hours: {}, live: [] };   // hours: { <hour since epoch>: { w: [sum, n], f: { s|g|b: [sum, n] }, d: { <device id>: [sum, n] } } }
try { const j = JSON.parse(fs.readFileSync(EN_FILE, 'utf8')); if (j && typeof j.hours === 'object') EN.hours = j.hours; } catch { /* first run */ }
let enSavedAt = Date.now(), enDirty = false;
const enSave = () => { try { writeFileSafe(EN_FILE, JSON.stringify({ v: 1, hours: EN.hours }), 0o600); enDirty = false; enSavedAt = Date.now(); } catch { /* next time */ } };
process.on('exit', () => { if (enDirty && !isDemo()) enSave(); });

/* What a power reading is: the whole house, the grid, solar, a battery, an EV charger, or one device. */
const EN_EV = /charg(er|ing)|wall.?connector|\bev\b|_ev_|^ev_|evse|wallbox|zappi|easee|juicebox/i;
function enRole(d) {
  const w = `${d.id} ${d.originalName || d.name || ''}`;
  if (/battery/i.test(w) && !/powerwall|battery.?(power|charg|discharg)|storage.?power/i.test(w) && !Number.isFinite(d.powerW)) return null;
  if (SOLAR.test(w) && !NOT_NOW.test(w) && !/battery/i.test(w)) return 'solar';
  if (/powerwall|battery.?(power|charg|discharg)|storage.?power/i.test(w)) return 'battery';
  if (/\bgrid\b|_grid|grid_|net.?(power|meter)|mains|utility/i.test(w) && !SOLAR.test(w)) return 'grid';
  if (d.kind === 'sensor' && WHOLE_HOUSE.test(w) && !/charg|car|ev_|solar|battery|pv/i.test(w)) return 'house';
  if (EN_EV.test(w) && !/phone|battery.?level/i.test(w)) return 'ev';
  return 'device';
}
const enMetered = (d) => Number.isFinite(d.powerW) && !d.pairedTo && d.powerW >= 0 && d.powerW < 100_000 && ['device', 'ev'].includes(enRole(d));

/* The live picture: house use, solar, grid (+ from it, - back to it), battery (+ out of it, - into it), EV. */
function enFlowsNow(devices, useW) {
  const f = energyFlows(devices, useW), ev = devices.filter((d) => Number.isFinite(d.powerW) && !d.pairedTo && enRole(d) === 'ev');
  const evW = ev.length ? Math.round(ev.reduce((s, d) => s + d.powerW, 0)) : null;
  const battW = f.battery?.w ?? null;
  // with a grid meter and solar or a battery, the house is what comes in plus what's made, not just the grid reading
  const home = f.gridW != null && (f.solarW != null || battW != null) ? Math.max(0, f.gridW + (f.solarW || 0) + (battW || 0)) : useW;
  const gridW = f.gridW ?? (f.solarW != null || battW != null ? Math.round(home - (f.solarW || 0) - (battW || 0)) : null);
  return { useW: Math.round(home), solarW: f.solarW, gridW, battery: f.battery, evW, selfPct: home > 0 && (f.solarW != null || battW != null) ? Math.max(0, Math.min(100, Math.round(((f.solarW || 0) + Math.max(0, battW || 0)) / home * 100))) : null };
}

async function energySample(now = Date.now()) {
  const { devices } = await houseDevices();
  const p = housePower(devices), fl = enFlowsNow(devices, p.watts), hk = Math.floor(now / 3600_000);
  const b = (EN.hours[hk] ||= { w: [0, 0], d: {} });
  b.w[0] += fl.useW; b.w[1]++;
  for (const [k, v] of [['s', fl.solarW], ['g', fl.gridW], ['b', fl.battery?.w]]) if (Number.isFinite(v)) { b.f ||= {}; const e = (b.f[k] ||= [0, 0]); e[0] += v; e[1]++; }
  for (const x of devices) if (enMetered(x)) { const e = (b.d[x.id] ||= [0, 0]); e[0] += x.powerW; e[1]++; }
  const ids = Object.keys(b.d); if (ids.length > 60) ids.sort((x, y) => b.d[x][0] - b.d[y][0]).slice(0, ids.length - 50).forEach((id) => delete b.d[id]);
  EN.live.push([now, fl.useW]); while (EN.live.length && EN.live[0][0] < now - 3600_000) EN.live.shift();
  for (const k of Object.keys(EN.hours)) if (Number(k) < hk - 24 * 8) delete EN.hours[k];
  enDirty = true; if (now - enSavedAt >= 30 * 60_000) enSave();
}
setInterval(() => { if (isConfigured() && !isDemo()) energySample().catch(() => {}); }, 60_000).unref?.();

/* ---- the demo house: a week of minutes, the same every time for the same hour ---- */
const EN_DEMO_SOLAR_KW = 6.4, EN_DEMO_BATT_KWH = 13.5;
const enRnd = (seed) => { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
/* One device's watts at a given hour (h: 0-23 house time, day: day number, r: 0-1 noise). */
const EN_DEMO_DEV = {
  'shelly:fridge': (h, day, r) => 62 + r * 30,
  'shelly:office': (h, day, r) => ((day % 7) < 5 && h >= 9 && h < 18 ? 120 + r * 60 : 9 + r * 2),   // the desk's standby: monitors and a dock
  'ha:switch.tv_stand': (h, day, r) => (h >= 18 && h < 23 ? 110 + r * 40 : h >= 7 && h < 8 ? 60 : 17 + r * 2),   // a TV setup that never really switches off
  'ha:switch.dishwasher': (h, day, r) => (h === 20 && day % 2 === 0 ? 1150 + r * 120 : h === 21 && day % 2 === 0 ? 300 : 1.5),
  'ha:switch.network_rack': (h, day, r) => 60 + r * 8,
  'ha:sensor.washer_power': (h, day, r) => ((day % 7) >= 5 && (h === 10 || h === 11) ? 420 + r * 100 : (day % 3 === 0 && h === 19) ? 380 : 2.2),
  'ha:switch.treadmill': (h, day, r) => (h === 7 && day % 2 === 1 ? 640 + r * 90 : 0),
  'ha:sensor.family_car_charger_power': (h, day, r) => (h === 2 && day % 2 === 0 ? 7000 + r * 300 : 0),   // a top-up three nights a week
};
function enDemoHour(hk, devices) {
  const at = hk * 3600_000, h = hourOf(at), day = Math.round(Date.parse(`${dayOf(at)}T00:00:00Z`) / 86400_000), r = enRnd(hk * 7 + 3), wk = (day + 3) % 7;   // wk: 0 = Monday
  const d = {};
  for (const x of devices) { const fn = EN_DEMO_DEV[x.id]; d[x.id] = Math.max(0, fn ? fn(h, wk, r()) : x.powerW); }
  const other = 180 + (h >= 6 && h < 9 ? 520 : 0) + (h >= 17 && h < 22 ? 900 : 0) + (h >= 9 && h < 17 ? 260 : 0) + r() * 140;   // lights, cooking, the rest of the house
  const use = Object.values(d).reduce((s, v) => s + v, 0) + other;
  const cloud = 0.55 + 0.45 * enRnd(day * 13)();
  const solar = Math.max(0, Math.sin(Math.PI * (h + 0.5 - 6.5) / 13)) * EN_DEMO_SOLAR_KW * 1000 * 0.82 * cloud;
  return { use, solar, d, h };
}
function enDemoData(all, now = Date.now()) {
  const devices = all.filter(enMetered), hk = Math.floor(now / 3600_000), hours = {}, frac = (now % 3600_000) / 3600_000, cap = EN_DEMO_BATT_KWH * 1000;
  let soc = cap * 0.45, cur = null;
  for (let k = hk - 24 * 8 + 1; k <= hk; k++) {   // the battery's charge carried hour to hour: it fills from the sun and covers the evening peak
    const x = enDemoHour(k, devices), n = k === hk ? Math.max(1, Math.round(frac * 60)) : 60;
    let batt = 0;
    if (x.solar > x.use) batt = -Math.min(3300, x.solar - x.use, cap * 0.98 - soc);
    else if (x.h >= 16 && x.h < 23) batt = Math.max(0, Math.min(3000, x.use - x.solar, soc - cap * 0.12));
    soc -= batt; x.batt = batt; x.grid = x.use - x.solar - batt; cur = x;
    hours[k] = { w: [x.use * n, n], f: { s: [x.solar * n, n], g: [x.grid * n, n], b: [batt * n, n] }, d: Object.fromEntries(Object.entries(x.d).map(([id, v]) => [id, [v * n, n]])) };
  }
  const r = enRnd(Math.floor(now / 60_000));
  const live = Array.from({ length: 60 }, (_, i) => [now - (59 - i) * 60_000, Math.round(cur.use * (0.9 + r() * 0.2))]);
  const devW = Object.fromEntries(Object.entries(cur.d).map(([id, v]) => [id, Math.round(v * (0.95 + r() * 0.1))]));
  const flows = { useW: Math.round(cur.use), solarW: Math.round(cur.solar), gridW: Math.round(cur.grid), battery: { pct: Math.round(soc / cap * 100), w: Math.round(cur.batt) }, evW: Math.round(devW['ha:sensor.family_car_charger_power'] || 0) };
  flows.selfPct = flows.useW > 0 ? Math.max(0, Math.min(100, Math.round((flows.solarW + Math.max(0, flows.battery.w)) / flows.useW * 100))) : null;
  return { hours, live, flows, devW };
}

/* ---- reading the hourly store ---- */
const enKwh = (b) => (b ? b[0] / 60 / 1000 : 0);   // a minute's watts, summed: watt-minutes -> kWh
const enAvg = (b) => (b && b[1] ? b[0] / b[1] : null);
function enDayHours(hours, key, pick = (b) => b.w) {
  const out = Array(24).fill(null);
  for (const [k, b] of Object.entries(hours)) { const at = Number(k) * 3600_000; if (dayOf(at) !== key) continue; const v = pick(b); if (v) out[hourOf(at)] = Math.round(((out[hourOf(at)] || 0) + enKwh(v)) * 1000) / 1000; }
  return out;
}
/* A device's last 24 hours as hourly average watts (oldest first). */
function enSpark(hours, id, hk) { return Array.from({ length: 24 }, (_, i) => { const a = enAvg(hours[hk - 23 + i]?.d?.[id]); return a == null ? null : Math.round(a * 10) / 10; }); }
/* Standby waste: a device that, with nobody using it (1-5 AM, three nights), keeps drawing a few watts -
   while it plainly uses much more when it is on. Or a plug reporting "off" that still draws power. */
function enStandby(hours, devs, hk, rate) {
  const out = [];
  for (const d of devs) {
    const night = [], all = [];
    for (let k = hk - 24 * 4; k <= hk; k++) { const a = enAvg(hours[k]?.d?.[d.id]); if (a == null) continue; all.push(a); const h = hourOf(k * 3600_000); if (h >= 1 && h < 5) night.push(a); }
    if (d.on === false && d.w >= 1) { out.push({ id: d.id, name: d.name, w: Math.round(d.w * 10) / 10, why: 'off' }); continue; }
    if (night.length < 6) continue;
    const idle = night.sort((a, b) => a - b)[Math.floor(night.length / 2)], peak = Math.max(...all);
    if (idle >= 2 && idle <= 60 && peak >= idle * 4 + 25) out.push({ id: d.id, name: d.name, w: Math.round(idle * 10) / 10, why: 'idle' });
  }
  return out.map((x) => ({ ...x, kwhYear: Math.round(x.w * 8.76), costYear: rate ? Math.round(x.w * 8.76 * rate) : null })).sort((a, b) => b.w - a.w).slice(0, 6);
}
/* The room a device is in: its Home Assistant area, or the nearest room to its pin on the 3D Home. */
function enRoomOf(fp) {
  const centers = [];
  for (const f of fp?.floors || []) {
    for (const r of f.rooms || []) if (r?.name && Array.isArray(r.pos)) centers.push({ floor: f.id, name: r.name, x: r.pos[0], z: r.pos[1] });
    for (const r of f.plan?.rooms || []) {
      if (!r?.name) continue;
      if (Array.isArray(r.pts) && r.pts.length) centers.push({ floor: f.id, name: r.name, x: r.pts.reduce((s, p) => s + (p[0] ?? p.x ?? 0), 0) / r.pts.length, z: r.pts.reduce((s, p) => s + (p[1] ?? p.y ?? 0), 0) / r.pts.length });
      else if (Number.isFinite(r.x)) centers.push({ floor: f.id, name: r.name, x: r.x + (r.w || 0) / 2, z: r.y + (r.h || 0) / 2 });
    }
  }
  const pins = new Map((fp?.pins || []).map((p) => [p.deviceId, p]));
  return (d) => {
    if (d.area) return d.area;
    const p = pins.get(d.id); if (!p || !Array.isArray(p.pos)) return null;
    let best = null, bd = 36;   // within 6 m
    for (const c of centers) { if (c.floor !== p.floor) continue; const dd = (c.x - p.pos[0]) ** 2 + (c.z - p.pos[2]) ** 2; if (dd < bd) { bd = dd; best = c.name; } }
    return best;
  };
}
/* Prices and the grid's carbon: what the owner set (Energy settings), or a Home Assistant sensor that says so. */
function enPrefs(devices) {
  const e = config.energy || {}, num = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null);
  const priceSensor = devices.find((d) => d.kind === 'value' && /\/\s*kwh$/i.test(String(d.unit || '')) && !/gco2/i.test(String(d.unit)) && Number.isFinite(Number(d.value ?? d.state)));
  const co2Sensor = devices.find((d) => /gco2/i.test(String(d.unit || '')) && Number.isFinite(Number(d.value ?? d.state)));
  const demo = isDemo();
  const rate = num(e.ratePerKwh) ?? (priceSensor ? Number(priceSensor.value ?? priceSensor.state) : null) ?? (demo ? 0.17 : null);
  const peak = e.peak && Number.isInteger(e.peak.from) && Number.isInteger(e.peak.to) ? { from: e.peak.from, to: e.peak.to, rate: num(e.peak.rate) } : demo ? { from: 16, to: 21, rate: 0.38 } : null;
  const co2 = num(e.co2gPerKwh) ?? (co2Sensor ? Number(co2Sensor.value ?? co2Sensor.state) : null) ?? (demo ? 210 : null);
  return { rate, rateFrom: num(e.ratePerKwh) != null ? 'set' : priceSensor ? priceSensor.name : demo ? 'demo' : null, peak, co2, co2From: num(e.co2gPerKwh) != null ? 'set' : co2Sensor ? co2Sensor.name : demo ? 'demo' : null, budget: num(e.budget) ?? (demo ? 150 : null), currency: config.house?.currency || 'USD' };
}
const inPeak = (h, p) => (p.from <= p.to ? h >= p.from && h < p.to : h >= p.from || h < p.to);
const enR1 = (v) => Math.round(v * 10) / 10, enR2 = (v) => Math.round(v * 100) / 100;
const haEnergyOn = () => !isDemo() && !!config.homeAssistant?.url;
async function enHa(days) { if (!haEnergyOn()) return null; try { const x = await cached(`energy-ha:${days}`, days === 1 ? 60_000 : 10 * 60_000, () => energyFromHa(days)); return x?.configured ? x : null; } catch { return null; } }

async function energyOverview(now = Date.now()) {
  const { devices } = await houseDevices(), days = await histDays(), pro = !!proStatus().pro || isDemo();
  const pr = enPrefs(devices), rate = pr.rate, money = (kwh) => (rate ? enR2(kwh * rate) : null), today = dayOf(now), hk = Math.floor(now / 3600_000);
  const demo = isDemo() ? enDemoData(devices, now) : null, hours = demo ? demo.hours : EN.hours;
  const p = housePower(devices), flows = demo ? demo.flows : enFlowsNow(devices, p.watts);
  const roomOf = enRoomOf((() => { try { return fpData(); } catch { return null; } })());
  // ---- devices ----
  const devs = devices.filter(enMetered).map((d) => {
    const w = demo ? demo.devW[d.id] ?? d.powerW : d.powerW, wh = days[today]?.dev?.[d.id]?.[1];
    const fromHours = Object.entries(hours).filter(([k]) => dayOf(Number(k) * 3600_000) === today).reduce((s, [, b]) => s + enKwh(b.d?.[d.id]), 0);
    const todayKwh = demo || wh == null ? fromHours : wh / 1000;
    return { id: d.id, name: d.name, kind: d.kind, ev: enRole(d) === 'ev', on: d.on, w: Math.round(w * 10) / 10, room: roomOf(d), todayKwh: enR2(todayKwh), todayCost: money(todayKwh), spark: enSpark(hours, d.id, hk) };
  }).sort((a, b) => b.w - a.w || b.todayKwh - a.todayKwh);
  // ---- rooms ----
  const rm = new Map();
  for (const d of devs) { const k = d.room || (d.ev ? '#ev' : ''); const x = rm.get(k) || { name: d.room || null, ev: !d.room && d.ev, w: 0, todayKwh: 0, n: 0 }; x.w += d.w; x.todayKwh += d.todayKwh; x.n++; rm.set(k, x); }
  const rooms = [...rm.values()].map((x) => ({ ...x, w: Math.round(x.w), todayKwh: enR2(x.todayKwh) })).sort((a, b) => b.todayKwh - a.todayKwh || b.w - a.w);
  // ---- by hour: today, yesterday, and the week as a heatmap ----
  const heat = Array.from({ length: 7 }, (_, i) => { const key = addDays(today, i - 6); return { date: key, hours: enDayHours(hours, key) }; });
  const haveHours = heat.some((d) => d.hours.some((v) => v != null));
  // ---- by day ----
  const list = Array.from({ length: pro ? 90 : 7 }, (_, i) => addDays(today, i - (pro ? 89 : 6))).map((k) => { const d = days[k]; return d ? { date: k, kwh: enR2(kwhOf(d)), cost: money(kwhOf(d)), peakW: d.peakW || null, partial: k === today } : { date: k, kwh: null }; });
  const sumDays = (n) => { const ks = Array.from({ length: n }, (_, i) => addDays(today, -i)).filter((k) => days[k]); return ks.length ? enR2(ks.reduce((s, k) => s + kwhOf(days[k]), 0)) : null; };
  const [ha1, ha7, ha30] = await Promise.all([enHa(1), enHa(7), enHa(30)]);
  const fromHa = (x) => (x ? { kwh: enR2(x.totals.used), cost: x.totals.cost ?? money(x.totals.used) } : null);
  const fromHist = (n) => { const k = sumDays(n); return k == null ? null : { kwh: k, cost: money(k) }; };
  const usage = ha1 ? { from: 'ha', today: fromHa(ha1), d7: fromHa(ha7), d30: fromHa(ha30) }
    : { from: 'casatorch', today: fromHist(1), d7: fromHist(7), d30: pro ? fromHist(30) : null, d30Locked: !pro };
  // ---- this week against the one before (full days) ----
  const wkKeys = (off) => Array.from({ length: 7 }, (_, i) => addDays(today, i - 7 - off));
  const wkVals = (ks) => ks.map((k) => (days[k] ? enR2(kwhOf(days[k])) : null));
  const thisW = wkVals(wkKeys(0)), prevW = wkVals(wkKeys(7)), s = (a) => a.reduce((x, v) => x + (v || 0), 0);
  const week = thisW.filter((v) => v != null).length >= 3 ? { days: wkKeys(0), this: thisW, prev: prevW, thisKwh: enR1(s(thisW)), prevKwh: prevW.filter((v) => v != null).length >= 5 ? enR1(s(prevW)) : null } : null;
  if (week?.prevKwh) week.pct = Math.round((week.thisKwh - week.prevKwh) / week.prevKwh * 100);
  // ---- always on ----
  const nights = Array.from({ length: 7 }, (_, i) => days[addDays(today, -1 - i)]?.nightMinW).filter(Number.isFinite).sort((a, b) => a - b);
  let baseW = nights.length >= 2 ? nights[Math.floor(nights.length / 2)] : null;
  if (baseW == null) { const n = []; for (let k = hk - 24 * 7; k <= hk; k++) { const a = enAvg(hours[k]?.w); if (a != null && hourOf(k * 3600_000) >= 1 && hourOf(k * 3600_000) < 5) n.push(a); } if (n.length >= 3) baseW = Math.min(...n); }
  const avgDay = (() => { const v = Array.from({ length: 7 }, (_, i) => days[addDays(today, -1 - i)]).filter((d) => d && (d.n || 0) >= 200).map(kwhOf); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
  const baseload = baseW != null && baseW > 0 ? { w: Math.round(baseW), kwhYear: Math.round(baseW * 8.76), costYear: rate ? Math.round(baseW * 8.76 * rate) : null, sharePct: avgDay ? Math.min(100, Math.round(baseW * 24 / 1000 / avgDay * 100)) : null } : null;
  // ---- peak / off-peak (when the price changes through the day) ----
  let tariff = null;
  if (pr.peak) {
    let pk = 0, all = 0;
    for (let k = hk - 24 * 7 + 1; k <= hk; k++) { const v = enKwh(hours[k]?.w); all += v; if (inPeak(hourOf(k * 3600_000), pr.peak)) pk += v; }
    const h = hourOf(now), nowPeak = inPeak(h, pr.peak);
    tariff = { from: pr.peak.from, to: pr.peak.to, peakRate: pr.peak.rate, offRate: rate, now: nowPeak ? 'peak' : 'off', peakKwh: enR1(pk), totalKwh: enR1(all), peakPct: all ? Math.round(pk / all * 100) : null };
    if (tariff.peakRate && rate && pk) tariff.shiftSaves = enR2(pk * 0.25 * (tariff.peakRate - rate));   // moving a quarter of it to cheaper hours
  }
  // ---- where today's energy came from (Home Assistant's Energy dashboard, or the house's own meters) ----
  let sources = null;
  if (ha1) sources = { from: 'ha', import: ha1.series.import, solar: ha1.series.solar, export: ha1.series.export, battOut: ha1.series.battOut, totals: ha1.totals, selfPct: ha1.selfPowered, has: ha1.has };
  else if (Object.values(hours).some((b) => b.f?.s || b.f?.b)) {
    const pos = (k, sign) => enDayHours(hours, today, (b) => { const v = b.f?.[k]; if (!v) return null; const a = v[0] / v[1]; return sign > 0 ? (a > 0 ? [a * v[1], v[1]] : null) : (a < 0 ? [-a * v[1], v[1]] : null); });
    const imp = pos('g', 1), exp = pos('g', -1), sol = pos('s', 1), bo = pos('b', 1), bi = pos('b', -1), tot = (a) => enR2(a.reduce((x, v) => x + (v || 0), 0));
    const used = Math.max(0, tot(imp) + tot(sol) + tot(bo) - tot(exp) - tot(bi));
    sources = { from: 'meters', import: imp.map((v) => v || 0), solar: sol.map((v) => v || 0), export: exp.map((v) => v || 0), battOut: bo.map((v) => v || 0),
      totals: { used: enR2(used), import: tot(imp), solar: tot(sol), export: tot(exp), battOut: tot(bo), battIn: tot(bi) }, selfPct: used ? Math.max(0, Math.min(100, Math.round((used - tot(imp)) / used * 100))) : null,
      has: { solar: flows.solarW != null, battery: !!flows.battery, export: tot(exp) > 0 } };
  }
  // ---- carbon ----
  const todayKwh = usage.today?.kwh ?? null, gridToday = sources?.totals?.import ?? todayKwh;
  const co2 = pr.co2 && gridToday != null ? { gPerKwh: Math.round(pr.co2), todayKg: enR1(gridToday * pr.co2 / 1000), weekKg: week ? enR1(week.thisKwh * pr.co2 / 1000 * (sources?.totals?.used ? (sources.totals.import / sources.totals.used) : 1)) : null, savedKg: sources?.totals?.solar ? enR1(sources.totals.solar * pr.co2 / 1000) : null, from: pr.co2From } : null;
  return {
    at: new Date(now).toISOString(), demo: isDemo(), pro, currency: pr.currency, rate, rateFrom: pr.rateFrom, budget: pr.budget,
    now: { ...flows, from: p.from }, live: demo ? demo.live : EN.live.map(([t, w]) => [t, Math.round(w)]),
    devices: devs.slice(0, 40), rooms, heat: haveHours ? heat : null, today: { hours: heat[6].hours, yesterday: heat[5].hours },
    days: list, usage, week, baseload, forecast: pro ? billForecast(days, today) : null, tariff, co2, sources,
    standby: enStandby(hours, devs, hk, rate), ha: !!ha1,
  };
}
app.get('/api/energy/overview', async (_req, res) => {
  try { res.json(await cached('energy-overview', isDemo() ? 20_000 : 15_000, () => energyOverview())); }
  catch (err) { res.status(500).json({ error: `Energy didn't load: ${err.message}` }); }
});
/* Energy settings: the price per kWh (and a different peak-hours price), a monthly budget, and the grid's carbon. */
app.put('/api/energy/prefs', requireRole('admin'), express.json({ limit: '2kb' }), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const b = req.body || {}, e = { ...(config.energy || {}) }, num = (v, lo, hi) => (v === null || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : undefined);
  for (const [k, lo, hi] of [['ratePerKwh', 0, 5], ['budget', 0, 100_000], ['co2gPerKwh', 0, 2000]]) if (k in b) { const v = num(b[k], lo, hi); if (v === undefined) return res.status(400).json({ error: `${k} is out of range` }); if (v === null) delete e[k]; else e[k] = v; }
  if ('peak' in b) {
    if (!b.peak) delete e.peak;
    else {
      const from = Number(b.peak.from), to = Number(b.peak.to), rate = num(b.peak.rate, 0, 5);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 23 || to < 0 || to > 24 || from === to || rate === undefined) return res.status(400).json({ error: 'peak hours are whole hours, 0-24' });
      e.peak = { from, to: to % 24, ...(rate != null ? { rate } : {}) };
    }
  }
  saveConfig({ ...config, energy: e });
  res.json({ ok: true, energy: e });
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchEnergy = { enRole, enMetered, enFlowsNow, enStandby, enDayHours, enSpark, enRoomOf, enDemoData, energySample, energyOverview, inPeak, EN };
