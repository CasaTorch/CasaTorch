/* ======================================================================
 * History and the weekly report.
 *
 * Every 5 minutes CasaTorch notes what the house is using, and turns it into
 * a small record per day: energy (kWh), the peak, the lowest overnight draw
 * (what never switches off), energy by device, how many alerts there were,
 * and minutes without internet. Kept on this computer only, for 2 years;
 * Basic shows the last 7 days, Pro all of it.
 *
 * The weekly report (Pro) turns the last 7 days into a short summary and a
 * few tips - written by your own AI if one is connected (Settings > Ask the
 * house), otherwise by plain rules. It's made on Monday morning, can be made
 * any time from the Energy tab, and arrives as a phone alert.
 * The report only reads; it never switches anything.
 * ====================================================================== */
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const HIST_KEEP_DAYS = 730, HIST_BASIC_DAYS = 7, SAMPLE_MS = 5 * 60_000;
const hist = { v: 1, days: {}, last: null, seenAlertAt: null, reports: [] };
try { Object.assign(hist, JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))); } catch { /* first run */ }
const saveHist = () => { try { writeFileSafe(HISTORY_FILE, JSON.stringify(hist), 0o600); } catch { /* next time */ } };
/* One formatter per kind and time zone, made once (making one is slow; dayOf runs for every alert, every 5 minutes). */
const HIST_FMT = new Map();
const histFmt = (kind, tz, opts) => { const k = `${kind}|${tz}`; let f = HIST_FMT.get(k); if (!f) { f = new Intl.DateTimeFormat(kind === 'day' ? 'en-CA' : 'en-US', { timeZone: tz, ...opts }); if (HIST_FMT.size < 60) HIST_FMT.set(k, f); } return f; };
const dayOf = (ms, tz = houseTz()) => histFmt('day', tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const hourOf = (ms, tz = houseTz()) => Number(histFmt('hour', tz, { hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)));
const weekdayOf = (ms, tz = houseTz()) => histFmt('wd', tz, { weekday: 'short' }).format(new Date(ms));
const addDays = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const isSolar = (d) => /solar|pv_|production|generation|inverter/i.test(`${d.id} ${d.name}`);
const blankDay = () => ({ wh: 0, peakW: 0, peakAt: null, nightMinW: null, n: 0, dev: {}, alerts: {}, titles: {}, netDownMin: 0 });

/* One sample: integrate watts into watt-hours (a gap longer than 10 minutes counts as 10, so a restart or a
   sleeping computer never invents energy), and remember per-device energy and the alerts since last time. */
async function historySample(now = Date.now()) {
  const { devices } = await houseDevices();
  const house = housePower(devices).watts, key = dayOf(now), d = (hist.days[key] ||= blankDay());
  if (hist.last && now > hist.last.at) {
    const hours = Math.min(now - hist.last.at, 10 * 60_000) / 3_600_000;
    d.wh += ((hist.last.w + house) / 2) * hours;
    for (const x of devices) {
      if (!Number.isFinite(x.powerW) || x.powerW <= 0 || x.powerW > 100_000 || x.pairedTo || isSolar(x)) continue;
      const prev = hist.last.dev?.[x.id];
      const e = (d.dev[x.id] ||= [x.name, 0]); e[0] = x.name; e[1] += ((prev ?? x.powerW) + x.powerW) / 2 * hours;
    }
    const ids = Object.keys(d.dev);
    if (ids.length > 60) ids.sort((a, b) => d.dev[a][1] - d.dev[b][1]).slice(0, ids.length - 40).forEach((id) => delete d.dev[id]);
  }
  d.n++;
  if (house > d.peakW) { d.peakW = house; d.peakAt = new Date(now).toISOString(); }
  const h = hourOf(now); if (h >= 1 && h < 5 && house > 0 && (d.nightMinW == null || house < d.nightMinW)) d.nightMinW = house;
  if (alerts.open?.internet) d.netDownMin += SAMPLE_MS / 60_000;
  const since = hist.seenAlertAt ? Date.parse(hist.seenAlertAt) : now - SAMPLE_MS;
  for (const a of alerts.events || []) {
    const at = Date.parse(a.at); if (!(at > since)) break;   // newest first
    if (a.severity === 'ok') continue;
    const k = (hist.days[dayOf(at)] ||= blankDay()), sev = sevOf(a);
    k.alerts[sev] = (k.alerts[sev] || 0) + 1;
    const t = String(a.title || '').slice(0, 80);
    if (t && (k.titles[t] || Object.keys(k.titles).length < 30)) k.titles[t] = (k.titles[t] || 0) + 1;
  }
  if (alerts.events?.[0]?.at) hist.seenAlertAt = alerts.events[0].at;
  hist.last = { at: now, w: house, dev: Object.fromEntries(devices.filter((x) => Number.isFinite(x.powerW) && !x.pairedTo).map((x) => [x.id, x.powerW])) };
  const oldest = addDays(key, -HIST_KEEP_DAYS);
  for (const k of Object.keys(hist.days)) if (k < oldest) delete hist.days[k];
  saveHist();
}
setInterval(() => { if (isConfigured() && !isDemo()) historySample().catch(() => {}); }, SAMPLE_MS).unref?.();

/* ---- the demo house: two months of believable, repeatable history ---- */
let demoHist = null;
async function demoHistory() {
  if (demoHist) return demoHist;
  const { devices } = await houseDevices();
  const metered = devices.filter((d) => Number.isFinite(d.powerW) && d.powerW > 0 && !d.pairedTo && !isSolar(d)).sort((a, b) => b.powerW - a.powerW).slice(0, 12);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const days = {}, today = dayOf(Date.now(), 'America/Los_Angeles');
  for (let i = 60; i >= 0; i--) {
    const key = addDays(today, -i), wk = new Date(`${key}T12:00:00Z`).getUTCDay(), weekend = wk === 0 || wk === 6;
    const kwh = (weekend ? 31 : 26) + rnd() * 6 - (i < 7 ? 2.5 : 0), part = i === 0 ? 0.55 : 1;
    const dev = {}; let left = kwh * 1000 * 0.7;
    metered.forEach((d, j) => { const share = j === 0 ? 0.3 : 0.7 / (metered.length - 1); dev[d.id] = [d.name, Math.round(left * share * (0.8 + rnd() * 0.4) * part)]; });
    days[key] = { wh: Math.round(kwh * 1000 * part), peakW: Math.round(4200 + rnd() * 3800), peakAt: `${key}T${weekend ? '01' : '02'}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00.000Z`, nightMinW: Math.round(310 + rnd() * 60), n: 288, dev,
      alerts: rnd() > 0.6 ? { event: 1 + Math.floor(rnd() * 3) } : {}, titles: rnd() > 0.6 ? { 'Doorbell: Front Door': 1 + Math.floor(rnd() * 3) } : {}, netDownMin: i === 12 ? 25 : 0 };
  }
  if (days[addDays(today, -3)]) { days[addDays(today, -3)].alerts.notice = 1; days[addDays(today, -3)].titles['Low battery (12%): Garage Motion'] = 1; }
  demoHist = { days };
  demoHist.reports = [await buildReport({ days, to: addDays(today, -1), tz: 'America/Los_Angeles', demo: true })];
  return demoHist;
}
const histDays = async () => (isDemo() ? (await demoHistory()).days : hist.days);

/* ---- the bill forecast (Pro): this month so far, plus the recent daily average for the days left ---- */
function billForecast(days, today = dayOf(Date.now())) {
  const rate = config.energy?.ratePerKwh ?? (isDemo() ? 0.17 : null), budget = config.energy?.budget ?? (isDemo() ? 150 : null);
  const month = today.slice(0, 7), y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const inMonth = new Date(Date.UTC(y, m, 0)).getUTCDate(), dayNo = Number(today.slice(8, 10));
  const full = Object.keys(days).filter((k) => k.startsWith(month) && k < today).sort();
  const recent = Array.from({ length: 14 }, (_, i) => addDays(today, -1 - i)).filter((k) => days[k] && (days[k].n || 0) >= 200);   // whole days only
  if (recent.length < 3) return null;   // not enough history to say anything honest
  const avg = recent.reduce((s, k) => s + kwhOf(days[k]), 0) / recent.length;
  const soFar = full.reduce((s, k) => s + kwhOf(days[k]), 0) + kwhOf(days[today]);
  const todayLeft = Math.max(0, avg - kwhOf(days[today])), daysLeft = inMonth - dayNo;
  const kwh = soFar + todayLeft + avg * daysLeft;
  const missing = Math.max(0, dayNo - 1 - full.length);   // days this month CasaTorch wasn't running
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7), prev = Object.keys(days).filter((k) => k.startsWith(prevMonth));
  const prevKwh = prev.length >= 25 ? prev.reduce((s, k) => s + kwhOf(days[k]), 0) : null;
  const r1 = (v) => Math.round(v * 10) / 10, $ = (v) => (rate ? Math.round(v * rate * 100) / 100 : null);
  return { month, kwhSoFar: r1(soFar), kwh: r1(kwh), cost: $(kwh), costSoFar: $(soFar), avgKwhPerDay: r1(avg), daysLeft, missingDays: missing, budget, overBudget: budget && rate ? $(kwh) > budget : null, prevMonthKwh: prevKwh == null ? null : r1(prevKwh), prevMonthCost: prevKwh == null ? null : $(prevKwh) };
}

/* ---- the weekly report ---- */
const kwhOf = (d) => (d?.wh || 0) / 1000;
function weekStats(days, to) {
  const keys = Array.from({ length: 7 }, (_, i) => addDays(to, i - 6)), prev = Array.from({ length: 7 }, (_, i) => addDays(to, i - 13));
  const have = keys.filter((k) => days[k]);
  const sum = (ks) => ks.reduce((s, k) => s + kwhOf(days[k]), 0);
  const kwh = sum(keys), prevHave = prev.filter((k) => days[k]).length, prevKwh = prevHave >= 5 ? sum(prev) : null;
  const rate = config.energy?.ratePerKwh ?? (isDemo() ? 0.17 : null), currency = config.house?.currency || 'USD';
  const dev = {};
  for (const k of keys) for (const [id, [name, wh]] of Object.entries(days[k]?.dev || {})) { (dev[id] ||= { name, kwh: 0 }).kwh += wh / 1000; dev[id].name = name; }
  const metered = Object.values(dev).reduce((s, x) => s + x.kwh, 0);
  const top = Object.values(dev).sort((a, b) => b.kwh - a.kwh).slice(0, 5).map((x) => ({ name: x.name, kwh: Math.round(x.kwh * 10) / 10, sharePct: metered ? Math.round(x.kwh / metered * 100) : null, cost: rate ? Math.round(x.kwh * rate * 100) / 100 : null }));
  const nights = keys.map((k) => days[k]?.nightMinW).filter(Number.isFinite), nightMinW = nights.length ? Math.round(nights.sort((a, b) => a - b)[Math.floor(nights.length / 2)]) : null;
  const peakDay = have.slice().sort((a, b) => (days[b].peakW || 0) - (days[a].peakW || 0))[0];
  const alertsBy = {}, titles = {};
  for (const k of keys) { for (const [s, n] of Object.entries(days[k]?.alerts || {})) alertsBy[s] = (alertsBy[s] || 0) + n; for (const [t, n] of Object.entries(days[k]?.titles || {})) titles[t] = (titles[t] || 0) + n; }
  return {
    from: keys[0], to, daysWithData: have.length, kwh: Math.round(kwh * 10) / 10, prevKwh: prevKwh == null ? null : Math.round(prevKwh * 10) / 10,
    changePct: prevKwh ? Math.round((kwh - prevKwh) / prevKwh * 100) : null, rate, currency, cost: rate ? Math.round(kwh * rate * 100) / 100 : null,
    peakW: peakDay ? days[peakDay].peakW : null, peakAt: peakDay ? days[peakDay].peakAt : null,
    alwaysOnW: nightMinW, alwaysOnCostPerYear: nightMinW && rate ? Math.round(nightMinW / 1000 * 24 * 365 * rate) : null,
    topDevices: top, meteredShareOfHousePct: kwh && metered ? Math.min(100, Math.round(metered / kwh * 100)) : null,
    alerts: alertsBy, repeatedAlerts: Object.entries(titles).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, times]) => ({ title, times })),
    internetDownMin: keys.reduce((s, k) => s + (days[k]?.netDownMin || 0), 0),
    serversDown: Object.entries(keys.reduce((a, k) => { for (const [n, m] of Object.entries(days[k]?.monDown || {})) a[n] = (a[n] || 0) + m; return a; }, {})).filter(([, m]) => m >= 5).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, minutes]) => ({ name, minutes: Math.round(minutes) })),
    lowBatteries: Object.values(alerts.open || {}).filter((a) => String(a.id).startsWith('battery:')).map((a) => a.title.replace(/^Low battery \(\d+%\): /, '')).slice(0, 8),
    notRespondingNow: Object.values(alerts.open || {}).filter((a) => String(a.id).startsWith('offline:') && a.id !== 'offline:more').map((a) => a.title.replace(/ is not responding$/, '')).slice(0, 8),
  };
}
const money = (v, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: v < 10 ? 2 : 0 }).format(v);
function ruleReport(s) {
  const c = (v) => (s.rate ? money(v, s.currency) : null);
  const parts = [`The house used ${s.kwh} kWh over ${s.daysWithData === 7 ? 'the last week' : s.daysWithData === 1 ? 'its first day of history' : `the last ${s.daysWithData} days`}${s.cost != null ? ` (about ${c(s.cost)})` : ''}`];
  if (s.changePct != null) parts[0] += s.changePct === 0 ? ', the same as the week before.' : `, ${Math.abs(s.changePct)}% ${s.changePct > 0 ? 'more' : 'less'} than the week before.`; else parts[0] += '.';
  const quiet = !s.alerts.critical && !s.alerts.warning;
  parts.push(s.alerts.critical ? `There ${s.alerts.critical === 1 ? 'was 1 critical alert' : `were ${s.alerts.critical} critical alerts`} - check the Alerts tab.` : quiet ? 'No critical or warning alerts.' : `${s.alerts.warning} warning${s.alerts.warning === 1 ? '' : 's'}, nothing critical.`);
  if (s.internetDownMin >= 10) parts.push(`The internet was down for about ${Math.round(s.internetDownMin)} minutes.`);
  const f = s.monthForecast; if (f?.cost != null) parts.push(`This month is on track for about ${c(f.cost)}${f.budget && f.overBudget ? `, over your ${c(f.budget)} budget` : f.budget ? `, within your ${c(f.budget)} budget` : ''}.`);
  if (s.serversDown?.length) parts.push(`Down for a while: ${s.serversDown.map((x) => `${x.name} (${x.minutes >= 120 ? `${Math.round(x.minutes / 60)} hours` : `${x.minutes} minutes`})`).join(', ')}.`);
  const tips = [];
  if (s.alwaysOnW >= 120) tips.push(`About ${s.alwaysOnW} W stays on even in the middle of the night${s.alwaysOnCostPerYear ? ` - roughly ${c(s.alwaysOnCostPerYear)} a year` : ''}. Old fridges, computers, game consoles, pumps and heaters on standby are the usual suspects.`);
  if (s.topDevices[0]?.sharePct >= 25) tips.push(`${s.topDevices[0].name} used ${s.topDevices[0].sharePct}% of the energy your metered devices used (${s.topDevices[0].kwh} kWh${s.topDevices[0].cost != null ? `, about ${c(s.topDevices[0].cost)}` : ''}).`);
  if (s.changePct >= 15) tips.push(`Use was up ${s.changePct}% on the week before. Check the By device list on the Energy tab for what changed.`);
  for (const r of s.repeatedAlerts.slice(0, 2)) tips.push(`"${r.title}" came up ${r.times} times. If it's not useful, turn that alert off in Settings.`);
  if (s.lowBatteries.length) tips.push(`Batteries to replace: ${s.lowBatteries.join(', ')}.`);
  if (s.notRespondingNow.length) tips.push(`Not responding right now: ${s.notRespondingNow.join(', ')}.`);
  if (!s.rate) tips.push('Add your electricity rate in Settings to see what this costs.');
  if (!tips.length) tips.push('A quiet week - nothing needs you.');
  return { summary: parts.join(' '), tips: tips.slice(0, 5) };
}
async function aiReport(s) {
  const c = config.ai, p = c && aiOf(c.provider);
  if (!p || !c.model) return null;
  const system = `You write the weekly home report for CasaTorch, a home dashboard. From the JSON stats only, write:
- "summary": 2-3 plain, friendly sentences about the week (energy and how it compares, anything that needs attention).
- "tips": 2-4 short, practical, specific suggestions grounded in the numbers (name devices and amounts; money in ${s.currency}). No generic advice that the data doesn't support. Never suggest unlocking doors, opening garage doors or gates, or disarming alarms.
Reply with ONLY a JSON object: {"summary": "...", "tips": ["...", "..."]}`;
  const text = await p.chat(c, system, [{ role: 'user', content: JSON.stringify(s) }]);
  const m = String(text).match(/\{[\s\S]*\}/); let j = null; try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
  if (!j || typeof j.summary !== 'string' || !Array.isArray(j.tips)) throw new Error('the AI answered in a way CasaTorch could not read');
  return { summary: j.summary.trim().slice(0, 700), tips: j.tips.filter((t) => typeof t === 'string' && t.trim()).slice(0, 4).map((t) => t.trim().slice(0, 300)) };
}
async function buildReport({ days, to, tz = houseTz(), demo = false }) {
  const s = weekStats(days, to);
  s.monthForecast = billForecast(days, dayOf(Date.now(), tz));
  let body = null, by = 'rules', aiError = null;
  if (!demo) { try { body = await aiReport(s); if (body) by = 'ai'; } catch (e) { aiError = String(e.message || e).slice(0, 160); } }
  body ||= ruleReport(s);
  const fmtD = (k) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${k}T12:00:00Z`));
  return { id: `${s.from}_${s.to}`, at: new Date().toISOString(), title: `Your week: ${fmtD(s.from)} - ${fmtD(s.to)}`, ...body, by, aiError, stats: s, tz };
}
let reportBusy = false;
async function makeReport({ to, scheduled = false } = {}) {
  if (reportBusy) throw new Error('a report is already being made');
  reportBusy = true;
  try {
    const r = await buildReport({ days: hist.days, to: to || dayOf(Date.now()) });
    r.scheduled = scheduled;
    hist.reports = [r, ...(hist.reports || []).filter((x) => x.id !== r.id)].slice(0, 26);
    saveHist();
    if (scheduled) notify({ id: `report:${r.id}`, kind: 'report', severity: 'event', title: 'Your weekly home report is ready', body: r.summary.split(/(?<=\.)\s/)[0].slice(0, 160), url: '/#energy' }).catch(() => {});
    return r;
  } finally { reportBusy = false; }
}
/* Monday from 8 AM (house time): last week's report, Monday to Sunday - once. */
setInterval(() => {
  if (!isConfigured() || isDemo() || !proStatus().pro || config.reports?.weekly === false) return;
  const now = Date.now(); if (weekdayOf(now) !== 'Mon' || hourOf(now) < 8) return;
  const to = addDays(dayOf(now), -1), id = `${addDays(to, -6)}_${to}`;
  if ((hist.reports || []).some((r) => r.id === id) || !Object.keys(hist.days).some((k) => k >= addDays(to, -6) && k <= to)) return;
  makeReport({ to, scheduled: true }).catch(() => {});
}, 10 * 60_000).unref?.();

/* ---- the Energy tab ---- */
app.get('/api/history', async (req, res) => {
  const pro = !!proStatus().pro || isDemo(), days = await histDays();
  const want = Math.max(1, Math.min(pro ? HIST_KEEP_DAYS : HIST_BASIC_DAYS, Number(req.query.days) || 30)), today = dayOf(Date.now());
  const rate = config.energy?.ratePerKwh ?? (isDemo() ? 0.17 : null);
  const list = Array.from({ length: want }, (_, i) => addDays(today, i - want + 1)).map((k) => { const d = days[k]; return d ? { date: k, kwh: Math.round(kwhOf(d) * 100) / 100, cost: rate ? Math.round(kwhOf(d) * rate * 100) / 100 : null, peakW: d.peakW || null, nightMinW: d.nightMinW ?? null, alerts: Object.values(d.alerts || {}).reduce((s, n) => s + n, 0), partial: k === today } : { date: k, kwh: null }; });
  res.json({ days: list, pro, maxDays: pro ? HIST_KEEP_DAYS : HIST_BASIC_DAYS, since: Object.keys(days).sort()[0] || null, rate, currency: config.house?.currency || 'USD', forecast: pro ? billForecast(days, today) : null });
});
app.get('/api/reports', async (_req, res) => {
  const pro = !!proStatus().pro || isDemo();
  if (!pro) return res.json({ pro: false, reports: [] });
  const reports = isDemo() ? (await demoHistory()).reports : hist.reports || [];
  res.json({ pro: true, ai: !!(config.ai?.provider && config.ai?.model), weekly: config.reports?.weekly !== false, reports: reports.slice(0, 12).map(({ aiError, ...r }) => ({ ...r, note: aiError ? `Written by CasaTorch's own rules - the AI couldn't be reached (${aiError}).` : null })) });
});
let reportAskedAt = 0;
app.post('/api/reports/now', requireRole('admin'), requirePro, async (_req, res) => {
  if (isDemo()) return res.json({ ok: true, report: (await demoHistory()).reports[0] });
  if (!Object.keys(hist.days).length) return res.status(409).json({ error: 'CasaTorch needs at least a day of history first - try again tomorrow.' });
  if (Date.now() - reportAskedAt < 2 * 60_000) return res.status(429).json({ error: 'A report was just made - wait a couple of minutes.' });
  reportAskedAt = Date.now();
  try { res.json({ ok: true, report: await makeReport() }); } catch (e) { res.status(409).json({ error: String(e.message || e) }); }
});
app.put('/api/reports/settings', requireRole('admin'), express.json({ limit: '1kb' }), (req, res) => {
  if (typeof req.body?.weekly !== 'boolean') return res.status(400).json({ error: 'weekly must be true or false' });
  if (!isDemo()) saveConfig({ ...config, reports: { ...(config.reports || {}), weekly: req.body.weekly } });
  res.json({ ok: true, weekly: req.body.weekly });
});
