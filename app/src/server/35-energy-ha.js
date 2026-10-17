/* ======================================================================
 * Energy from Home Assistant's own Energy dashboard: everything you set up there - electricity from and back to
 * the grid, solar, a home battery, gas, water, and each device you track - with costs where Home Assistant
 * keeps them. Read with Home Assistant's own numbers (its long-term statistics), so CasaTorch shows exactly
 * what Home Assistant shows: today by hour, or the last 7 or 30 days by day.
 * ====================================================================== */
const EH = { prefs: null, prefsAt: 0 };
async function haEnergyPrefs() {
  if (EH.prefs && Date.now() - EH.prefsAt < 10 * 60_000) return EH.prefs;
  const p = await haWs({ type: 'energy/get_prefs' }, 15000).catch((e) => { if (/not found|no prefs|unknown command/i.test(String(e.message))) return null; throw e; });
  EH.prefs = p || { energy_sources: [], device_consumption: [] }; EH.prefsAt = Date.now();
  return EH.prefs;
}
/** kWh from whatever unit the statistic uses (Wh, kWh, MWh, GJ/MJ). Gas and water keep their own unit. */
const toKwh = (v, unit) => { const u = String(unit || 'kWh'); return u === 'Wh' ? v / 1000 : u === 'MWh' ? v * 1000 : u === 'MJ' ? v / 3.6 : u === 'GJ' ? v * 277.78 : v; };
/** "ev charger energy" -> "EV charger": drop the trailing unit words Home Assistant adds, capitalize the first letter. */
function niceDeviceName(s) {
  let n = String(s || '').replace(/\b(total\s+)?(energy|consumption|kwh|power)\b/gi, '').replace(/\s{2,}/g, ' ').trim() || String(s || '').trim();
  n = n.replace(/\b(ev|ac|hvac|tv|pc|ups)\b/gi, (w) => w.toUpperCase());
  return n.charAt(0).toUpperCase() + n.slice(1);
}
function houseMidnight(daysBack = 0) {
  const tz = houseTz(), now = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  const sinceMidnight = (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000;
  return new Date(now.getTime() - sinceMidnight - daysBack * 86400_000 - (now.getMilliseconds()));
}
app.get('/api/energy/ha', async (req, res) => {
  if (isDemo() || !config.homeAssistant?.url) return res.json({ ha: false });
  const days = [1, 7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 1;
  try {
    const out = await cached(`energy-ha:${days}`, days === 1 ? 60_000 : 10 * 60_000, () => energyFromHa(days));
    res.json(out);
  } catch (err) { res.json({ ha: true, error: `Home Assistant's energy data didn't load: ${err.message}` }); }
});
async function energyFromHa(days) {
  const prefs = await haEnergyPrefs(), src = prefs.energy_sources || [];
  const roles = [];   // [statId, role, extra]
  for (const s of src) {
    if (s.type === 'grid') {
      for (const f of s.flow_from || []) { roles.push([f.stat_energy_from, 'import']); if (f.stat_cost) roles.push([f.stat_cost, 'importCost']); }
      for (const f of s.flow_to || []) { roles.push([f.stat_energy_to, 'export']); if (f.stat_compensation) roles.push([f.stat_compensation, 'exportCredit']); }
      if (s.stat_energy_from) roles.push([s.stat_energy_from, 'import']);   // newer Home Assistant: one grid source per meter
      if (s.stat_energy_to) roles.push([s.stat_energy_to, 'export']);
      if (s.stat_cost) roles.push([s.stat_cost, 'importCost']);
    } else if (s.type === 'solar') roles.push([s.stat_energy_from, 'solar']);
    else if (s.type === 'battery') { roles.push([s.stat_energy_from, 'battOut']); roles.push([s.stat_energy_to, 'battIn']); }
    else if (s.type === 'gas') { roles.push([s.stat_energy_from, 'gas']); if (s.stat_cost) roles.push([s.stat_cost, 'gasCost']); }
    else if (s.type === 'water') { roles.push([s.stat_energy_from, 'water']); if (s.stat_cost) roles.push([s.stat_cost, 'waterCost']); }
  }
  for (const d of prefs.device_consumption || []) if (d.stat_consumption) roles.push([d.stat_consumption, 'device', d.name || null]);
  const ids = [...new Set(roles.map((r) => r[0]).filter((x) => typeof x === 'string' && x))];
  if (!ids.length) return { ha: true, configured: false };
  const start = houseMidnight(days - 1), period = days === 1 ? 'hour' : 'day';
  const [stats, meta] = await Promise.all([
    haWs({ type: 'recorder/statistics_during_period', start_time: start.toISOString(), statistic_ids: ids, period, types: ['change'] }, 40000),
    haWs({ type: 'recorder/get_statistics_metadata', statistic_ids: ids }, 20000).catch(() => []),
  ]);
  const unitOf = Object.fromEntries((meta || []).map((m) => [m.statistic_id, m.statistics_unit_of_measurement || m.display_unit_of_measurement || null]));
  const nameOf = Object.fromEntries((meta || []).map((m) => [m.statistic_id, m.name || null]));
  const slots = period === 'hour' ? 24 : days, slotOf = (t) => Math.floor((t - start.getTime()) / (period === 'hour' ? 3600_000 : 86400_000));
  const series = {}, totals = {}, devices = [];
  const add = (role, i, v) => { (series[role] ||= Array(slots).fill(0)); if (i >= 0 && i < slots) series[role][i] += v; totals[role] = (totals[role] || 0) + v; };
  for (const [id, role, given] of roles) {
    if (!id) continue;
    const rows = stats?.[id] || [], unit = unitOf[id];
    const energy = ['import', 'export', 'solar', 'battOut', 'battIn', 'device'].includes(role);
    let sum = 0;
    for (const r of rows) {
      const t = typeof r.start === 'number' ? r.start : Date.parse(r.start), v = Number(r.change);
      if (!Number.isFinite(v)) continue;
      const val = energy ? toKwh(v, unit) : v;
      if (role === 'device') sum += val; else add(role, slotOf(t), val);
    }
    if (role === 'device') devices.push({ id, name: niceDeviceName(given || nameOf[id] || id.replace(/^sensor\./, '').replace(/_/g, ' ')), kwh: Math.round(sum * 100) / 100 });
  }
  const T = (k) => Math.round((totals[k] || 0) * 100) / 100;
  // what the house used: from the grid, plus solar, plus the battery, minus what went back out and into the battery
  const used = Math.max(0, T('import') + T('solar') + T('battOut') - T('export') - T('battIn'));
  const usedSeries = Array.from({ length: slots }, (_, i) => Math.max(0, (series.import?.[i] || 0) + (series.solar?.[i] || 0) + (series.battOut?.[i] || 0) - (series.export?.[i] || 0) - (series.battIn?.[i] || 0)));
  const rate = Number(config.energy?.ratePerKwh) || null;
  const cost = totals.importCost != null ? T('importCost') - (T('exportCredit') || 0) : rate ? Math.round(T('import') * rate * 100) / 100 : null;
  const gasUnit = unitOf[roles.find((r) => r[1] === 'gas')?.[0]] || null, waterUnit = unitOf[roles.find((r) => r[1] === 'water')?.[0]] || null;
  return {
    ha: true, configured: true, days, period, start: start.toISOString(), slots,
    totals: { used: Math.round(used * 100) / 100, import: T('import'), export: T('export'), solar: T('solar'), battIn: T('battIn'), battOut: T('battOut'), gas: totals.gas != null ? T('gas') : null, water: totals.water != null ? T('water') : null, cost, costFromHa: totals.importCost != null, gasCost: totals.gasCost != null ? T('gasCost') : null, waterCost: totals.waterCost != null ? T('waterCost') : null },
    units: { gas: gasUnit, water: waterUnit }, has: { solar: 'solar' in totals, battery: 'battOut' in totals || 'battIn' in totals, export: 'export' in totals, gas: 'gas' in totals, water: 'water' in totals },
    selfPowered: used > 0 && ('solar' in totals || 'battOut' in totals) ? Math.min(100, Math.round(Math.max(0, used - T('import')) / used * 100)) : null,
    series: { used: usedSeries.map((v) => Math.round(v * 1000) / 1000), import: (series.import || []).map((v) => Math.round(v * 1000) / 1000), solar: (series.solar || []).map((v) => Math.round(v * 1000) / 1000), export: (series.export || []).map((v) => Math.round(v * 1000) / 1000), battOut: (series.battOut || []).map((v) => Math.round(v * 1000) / 1000), gas: (series.gas || []).map((v) => Math.round(v * 1000) / 1000) },
    devices: devices.filter((d) => d.kwh > 0).sort((a, b) => b.kwh - a.kwh).slice(0, 40),
    currency: config.house?.currency || 'USD',
  };
}
