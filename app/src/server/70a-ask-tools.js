/* ======================================================================
 * Home AI Agent tools: what the AI may look up, one question at a time.
 * Every tool reads what CasaTorch already shows - the same pages the app
 * reads, as the person who asked (so a viewer's agent sees what a viewer
 * sees, and the demo answers from the sample house). Nothing here changes
 * anything; switching things is a button the person taps (70b-ask-format.js).
 *
 * Privacy (Settings › Home AI Agent): cameras, location, calendar and family
 * can each be kept from the AI; a tool in a category that is off is never
 * offered, and the other tools leave those fields out.
 * ====================================================================== */
const ASK_SHARE_DEFAULT = { cameras: true, location: true, calendar: true, family: true };
const askShare = () => ({ ...ASK_SHARE_DEFAULT, ...(config.ai?.share && typeof config.ai.share === 'object' ? config.ai.share : {}) });
/* Web search: 'auto' = the AI service's own search (Claude, OpenAI); 'free' = CasaTorch's own lookup in
   DuckDuckGo instant answers and Wikipedia; 'off'. Local AIs (Ollama, your own server) start with it off. */
const askWebMode = () => {
  const m = config.ai?.webSearch; if (['auto', 'free', 'off'].includes(m)) return m;
  return ['anthropic', 'openai'].includes(config.ai?.provider) || isDemo() ? 'auto' : 'off';
};

/* Read one of CasaTorch's own pages as the person who asked (their sign-in never leaves this computer). */
async function askGet(ctx, p) {
  if (ctx.get) return ctx.get(p);   // tests
  const headers = {}; if (ctx.cookie) headers.Cookie = ctx.cookie; if (ctx.auth) headers.Authorization = ctx.auth;
  const r = await fetch(`http://127.0.0.1:${ctx.port}${p}`, { headers, signal: AbortSignal.timeout(25_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j || {};
}
/* Big answers are cut down so one lookup can't fill the AI's memory; the cut is marked. */
function askTrim(v, max = 14000) {
  let out = v;
  for (const cap of [120, 50, 20, 8]) {
    const s = JSON.stringify(out); if (!s || s.length <= max) return out;
    const cut = (x) => (Array.isArray(x) ? [...x.slice(0, cap).map(cut), ...(x.length > cap ? [`... ${x.length - cap} more not shown - ask for less`] : [])]
      : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, cut(y)])) : typeof x === 'string' && x.length > 400 ? `${x.slice(0, 400)}...` : x);
    out = cut(v);
  }
  const s = JSON.stringify(out); return s.length <= max ? out : { truncated: true, preview: s.slice(0, max) };
}
const askLocal = (iso) => { if (!iso) return null; try { return new Intl.DateTimeFormat('en-US', { timeZone: houseTz(), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch { return null; } };
const askClean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const askTempOut = (c) => (c == null ? undefined : (config.house?.units || 'F') === 'C' ? Math.round(c * 10) / 10 : Math.round(c * 9 / 5 + 32));
function askDevice(d) {
  return askClean({ id: d.id, name: d.name, room: d.area, kind: d.kind, on: d.on, online: d.online === false ? false : undefined, brightness: d.brightness, watts: d.powerW, playing: d.playing, nowPlaying: d.title,
    temperature: askTempOut(d.tempC), target: askTempOut(d.targetC), humidity: d.humidity, open: d.open, water: d.water, motion: d.motion, locked: d.locked, battery: d.battery, home: d.home, armed: d.armed,
    fanPercent: d.percent, position: d.position, state: ['value', 'presence', 'alarm', 'vacuum', 'cover', 'action', 'sensor'].includes(d.kind) ? d.state : undefined, value: d.value, unit: d.unit, guarded: d.guarded ? 'CasaTorch will not open/unlock/disarm this' : undefined });
}
const askFind = (list, q) => { const s = String(q || '').trim().toLowerCase(); if (!s) return null; return list.find((d) => d.id.toLowerCase() === s) || list.find((d) => String(d.name).toLowerCase() === s) || list.find((d) => `${d.name} ${d.area || ''}`.toLowerCase().includes(s)) || null; };
const askDayLabel = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const ASK_KINDS = ['light', 'switch', 'plug', 'media', 'fan', 'climate', 'cover', 'lock', 'camera', 'sensor', 'presence', 'vacuum', 'alarm', 'action', 'value'];

const ASK_TOOLS = [
  { name: 'home_devices', cat: 'devices', label: 'Checking your devices', cite: () => 'Devices',
    description: 'Every device CasaTorch sees right now (lights, plugs, switches, media, climate, covers, locks, sensors, vacuums, cameras...) with its room and live state: on/off, brightness, watts, temperature, battery, open/closed, motion, water. Filter by kind, room or a word in the name.',
    params: { type: 'object', properties: { kind: { type: 'string', enum: ASK_KINDS }, room: { type: 'string', description: 'Room or area name, e.g. "Kitchen" or "downstairs"' }, search: { type: 'string', description: 'A word in the device name' }, only_on: { type: 'boolean', description: 'Only devices that are on/playing' } } },
    async run(a, ctx) {
      const r = await askGet(ctx, '/api/devices'), share = ctx.share;
      let list = (r.devices || []).filter((d) => (share.cameras || d.kind !== 'camera') && (share.family || d.kind !== 'presence'));
      if (a.kind) list = list.filter((d) => d.kind === a.kind);
      if (a.room) { const q = String(a.room).toLowerCase(); list = list.filter((d) => String(d.area || '').toLowerCase().includes(q) || String(d.name).toLowerCase().includes(q)); }
      if (a.search) { const q = String(a.search).toLowerCase(); list = list.filter((d) => `${d.name} ${d.id}`.toLowerCase().includes(q)); }
      if (a.only_on) list = list.filter((d) => d.on || d.playing);
      const PRI = { light: 0, plug: 0, switch: 1, media: 1, climate: 1, fan: 1, cover: 2, lock: 2, camera: 3, sensor: 3, presence: 3, vacuum: 4, action: 5, value: 6 };
      list.sort((x, y) => (PRI[x.kind] ?? 7) - (PRI[y.kind] ?? 7));
      return { data: { count: list.length, houseWattsNow: r.power?.watts != null ? Math.round(r.power.watts) : undefined, devices: list.slice(0, 160).map(askDevice) } };
    } },
  { name: 'device_history', cat: 'devices', label: 'Reading the history', cite: (a, out) => `${out?.device || 'Device'} history, ${out?.hours || 24} h`,
    description: 'The history of one device or sensor over a time range (from Home Assistant\'s history): a temperature, power, humidity or any number as a series of points, or on/off and open/closed changes with times.',
    params: { type: 'object', properties: { device: { type: 'string', description: 'Device id (from home_devices) or its name' }, hours: { type: 'number', description: 'How far back, 1-720 hours. Default 24.' } }, required: ['device'] },
    async run(a, ctx) {
      const devs = (await askGet(ctx, '/api/devices')).devices || [], d = askFind(devs.filter((x) => (ctx.share.cameras || x.kind !== 'camera') && (ctx.share.family || x.kind !== 'presence')), a.device);
      if (!d) return { data: { error: `no device matching "${String(a.device).slice(0, 60)}"` } };
      const hours = Math.max(1, Math.min(720, Math.round(Number(a.hours) || 24))), to = Date.now(), from = to - hours * 3600_000;
      let raw;
      if (isDemo()) raw = askDemoHistory(d, from, to);
      else {
        const h = config.homeAssistant;
        if (!d.id.startsWith('ha:') || !h?.url || !h.token) return { data: { device: d.name, error: 'CasaTorch only has history for Home Assistant devices; this one is not from Home Assistant' } };
        const eid = d.id.slice(3); if (!/^[a-z_]+\.[\w-]+$/.test(eid)) return { data: { error: 'not a Home Assistant entity' } };
        const r = await fetch(`${h.url}/api/history/period/${new Date(from).toISOString()}?end_time=${encodeURIComponent(new Date(to).toISOString())}&filter_entity_id=${encodeURIComponent(eid)}&minimal_response&no_attributes`, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) throw new Error(`Home Assistant answered HTTP ${r.status}`);
        raw = ((await r.json())[0] || []).map((x) => [Date.parse(x.last_changed || x.last_updated), x.state]).filter(([t]) => Number.isFinite(t));
      }
      const nums = raw.filter(([, s]) => s !== '' && Number.isFinite(Number(s)));
      const out = { device: d.name, id: d.id, room: d.area, hours, from: new Date(from).toISOString(), to: new Date(to).toISOString(), unit: d.unit || (d.tempC != null ? `°${config.house?.units || 'F'}` : d.powerW != null ? 'W' : undefined), ...(isDemo() ? { note: 'sample house data' } : {}) };
      if (nums.length >= Math.max(2, raw.length / 2)) {
        const n = 48, step = (to - from) / n, pts = [];
        for (let i = 0; i < n; i++) {
          const a0 = from + i * step, a1 = a0 + step, inb = nums.filter(([t]) => t >= a0 && t < a1).map(([, s]) => Number(s));
          const prev = nums.filter(([t]) => t < a1).at(-1);
          const v = inb.length ? inb.reduce((s, x) => s + x, 0) / inb.length : prev ? Number(prev[1]) : null;
          pts.push([askLocal(new Date(a1).toISOString()), v == null ? null : Math.round(v * 100) / 100]);
        }
        const vals = nums.map(([, s]) => Number(s));
        return { data: { ...out, points: pts, min: Math.min(...vals), max: Math.max(...vals), latest: vals.at(-1) }, at: new Date(to).toISOString() };
      }
      const changes = raw.map(([t, s], i) => ({ at: askLocal(new Date(t).toISOString()), state: s, minutes: Math.round(((raw[i + 1]?.[0] || to) - t) / 60_000) }));
      const onMin = changes.filter((c) => ['on', 'open', 'playing', 'home', 'unlocked', 'detected'].includes(String(c.state))).reduce((s, c) => s + c.minutes, 0);
      return { data: { ...out, changes: changes.slice(-60), minutesOnOrOpen: onMin }, at: new Date(to).toISOString() };
    } },
  { name: 'energy', cat: 'energy', label: 'Checking energy', cite: (a) => ({ now: 'Energy right now', days: `Energy, ${Math.min(730, Number(a.days) || 7)} days`, compare_weeks: 'Energy, this week vs last', top_devices: 'Energy by device, 7 days', forecast: 'Energy bill forecast', home_assistant: 'Home Assistant energy' }[a.what] || 'Energy'),
    description: 'Electricity: "now" (watts the house uses now, biggest consumers now, cost per day at this rate), "days" (kWh and cost for each of the last N days with peaks and always-on load), "compare_weeks" (the last 7 days vs the 7 before, day by day), "top_devices" (which metered devices used the most in the last 7 days, kWh, share and cost), "forecast" (this month\'s bill so far and forecast vs budget), "home_assistant" (Home Assistant\'s energy dashboard: grid import/export, solar, cost).',
    params: { type: 'object', properties: { what: { type: 'string', enum: ['now', 'days', 'compare_weeks', 'top_devices', 'forecast', 'home_assistant'] }, days: { type: 'number', description: 'For "days": 1-730 (default 7). For "home_assistant": 1, 7 or 30.' } }, required: ['what'] },
    async run(a, ctx) {
      const rate = config.energy?.ratePerKwh ?? (isDemo() ? 0.17 : null), currency = config.house?.currency || 'USD';
      if (a.what === 'now') {
        const r = await askGet(ctx, '/api/devices'), devs = r.devices || [], watts = Math.round(r.power?.watts || 0);
        const top = devs.filter((d) => Number(d.powerW) > 0 && !d.meter && !d.pairedTo).sort((x, y) => y.powerW - x.powerW).slice(0, 10).map((d) => ({ name: d.name, room: d.area, watts: Math.round(d.powerW) }));
        return { data: { wattsNow: watts, ratePerKwh: rate, currency, costPerDayIfSteady: rate ? Math.round(watts / 1000 * 24 * rate * 100) / 100 : null, topNow: top, solarWatts: r.power?.solarW ?? undefined } };
      }
      if (a.what === 'home_assistant') { const d = [1, 7, 30].includes(Number(a.days)) ? Number(a.days) : 7; const r = await askGet(ctx, `/api/energy/ha?days=${d}`); return { data: r.ha === false ? { error: 'Home Assistant\'s energy dashboard is not connected' } : askTrim(r) }; }
      if (a.what === 'days' || a.what === 'forecast') {
        const n = Math.max(1, Math.min(730, Math.round(Number(a.days) || (a.what === 'forecast' ? 1 : 7))));
        const r = await askGet(ctx, `/api/history?days=${n}`);
        if (a.what === 'forecast') return { data: r.forecast ? { ...r.forecast, currency } : { error: r.pro ? 'not enough history yet for a forecast (it needs 3 whole days)' : 'the bill forecast is part of Pro' } };
        const days = (r.days || []).map((d) => askClean({ date: d.date, day: askDayLabel(d.date), kwh: d.kwh, cost: d.cost, peakW: d.peakW, alwaysOnW: d.nightMinW, partialToday: d.partial || undefined }));
        const have = days.filter((d) => d.kwh != null && !d.partialToday);
        return { data: { days, currency, ratePerKwh: r.rate, totalKwh: Math.round(have.reduce((s, d) => s + d.kwh, 0) * 10) / 10, avgKwhPerDay: have.length ? Math.round(have.reduce((s, d) => s + d.kwh, 0) / have.length * 10) / 10 : null, keptDays: r.maxDays, historySince: r.since } };
      }
      const all = await histDays(), today = dayOf(Date.now()), yest = addDays(today, -1);
      const w = weekStats(all, yest), prev = weekStats(all, addDays(yest, -7));
      if (a.what === 'top_devices') return { data: { from: w.from, to: w.to, topDevices: w.topDevices, meteredShareOfHousePct: w.meteredShareOfHousePct, currency } };
      const day = (k) => ({ date: k, day: askDayLabel(k), kwh: all[k] ? Math.round(all[k].wh / 100) / 10 : null });
      return { data: { thisWeek: { from: w.from, to: w.to, kwh: w.kwh, cost: w.cost, days: Array.from({ length: 7 }, (_, i) => day(addDays(yest, i - 6))) }, lastWeek: { from: prev.from, to: prev.to, kwh: prev.kwh, cost: prev.cost, days: Array.from({ length: 7 }, (_, i) => day(addDays(yest, i - 13))) }, changePct: w.changePct, currency } };
    } },
  { name: 'weather', cat: 'weather', label: 'Checking the weather', cite: (a, out) => `${a.place ? `Weather for ${out?.place || a.place}` : 'Weather at home'}${out?.source ? ` (${String(out.source).replace(/^Weather:\s*/i, '')})` : ''}`,
    description: 'Weather now, the next 12 hours and the next days: temperature, conditions, rain, wind. At home by default, or for any town by name.',
    params: { type: 'object', properties: { place: { type: 'string', description: 'A town or city, e.g. "Austin, TX". Leave out for home.' } } },
    async run(a, ctx) {
      let w;
      if (a.place) {
        const p = (await askGet(ctx, `/api/w/places?q=${encodeURIComponent(String(a.place).slice(0, 100))}`)).places?.[0];
        if (!p) return { data: { error: `could not find a place called "${String(a.place).slice(0, 60)}"` } };
        w = await askGet(ctx, `/api/w/weather?lat=${p.lat}&lon=${p.lon}&name=${encodeURIComponent(p.name)}`);
      } else {
        w = (await askGet(ctx, '/api/home')).weather;
        if (!w || w.error) return { data: { error: w?.error === 'no location set' || !w ? 'no home town is set (Settings), so there is no home weather' : w.error } };
        if (!ctx.share.location) w = { ...w, place: undefined };
      }
      if (w.error) return { data: { error: w.error } };
      const units = w.units || config.house?.units || 'F';
      return { data: askClean({ place: w.place, units: `°${units}`, now: w.now, next12Hours: (w.hours || []).slice(0, 12).map((h) => askClean({ at: askLocal(h.at), temp: h.temp, words: h.words || symbolWord(h.symbol), rainMm: h.rainMm })), days: (w.days || []).slice(0, 8).map((d) => askClean({ date: d.date, day: askDayLabel(d.date), high: d.hi ?? d.max ?? d.high, low: d.lo ?? d.min ?? d.low, words: d.words || symbolWord(d.symbol), rainMm: d.rainMm })), source: w.credit || 'MET Norway' }), at: w.updated || w.at || null, place: w.place };
    } },
  { name: 'sports', cat: 'sports', label: 'Checking the scores', cite: () => 'Scores (ESPN)',
    description: `Scores and schedules from ESPN: live and final scores and next games. No arguments = the teams this house follows. Or name a team (any team in these leagues), or just a league for today's scoreboard. Leagues: ${Object.keys(LEAGUES).join(', ')}.`,
    params: { type: 'object', properties: { team: { type: 'string', description: 'Team name or abbreviation, e.g. "49ers" or "Warriors"' }, league: { type: 'string', enum: Object.keys(LEAGUES) } } },
    async run(a, ctx) {
      const view = (g) => askClean({ league: g.leagueName, state: g.state === 'in' ? 'live' : g.state === 'post' ? 'final' : 'upcoming', detail: g.detail, start: askLocal(g.start), away: `${g.away?.name}${g.away?.score != null && g.state !== 'pre' ? ` ${g.away.score}` : ''}`, home: `${g.home?.name}${g.home?.score != null && g.state !== 'pre' ? ` ${g.home.score}` : ''}`, winner: g.home?.winner ? g.home.name : g.away?.winner ? g.away.name : undefined, tv: g.broadcast });
      if (isDemo() || (!a.team && !a.league)) {
        let games = (await askGet(ctx, '/api/home')).sports?.games || [];
        if (a.team) { const q = String(a.team).toLowerCase(); games = games.filter((g) => `${g.home?.name} ${g.home?.abbr} ${g.away?.name} ${g.away?.abbr}`.toLowerCase().includes(q)); }
        return { data: { games: games.slice(0, 20).map(view), ...(isDemo() ? { note: 'sample house: only its teams' } : {}), ...(games.length ? {} : { note: 'no games found for the teams this house follows' }) } };
      }
      const leagues = a.league && LEAGUES[a.league] ? [a.league] : [...new Set([...(config.sports?.teams || []).map((t) => t.league), 'nfl', 'nba', 'mlb', 'nhl', 'mls', 'epl'])];
      if (!a.team) {
        const L = LEAGUES[leagues[0]], j = await getJSON(`${ESPN}/${L.path}/scoreboard`);
        return { data: { league: L.name, games: (j?.events || []).map((e) => gameView(e, leagues[0])).filter(Boolean).slice(0, 30).map(view) } };
      }
      const q = String(a.team).toLowerCase();
      for (const lg of leagues) {
        const t = ((await sportsTeams(lg).catch(() => ({ teams: [] }))).teams || []).find((x) => [x.name, x.abbr].some((n) => String(n || '').toLowerCase() === q)) || ((await sportsTeams(lg).catch(() => ({ teams: [] }))).teams || []).find((x) => String(x.name).toLowerCase().includes(q));
        if (t) { const r = await sportsNow([{ league: lg, id: t.id }]); return { data: { team: t.name, league: LEAGUES[lg].name, games: (r.games || []).map(view) } }; }
      }
      return { data: { error: `no team matching "${String(a.team).slice(0, 40)}" in ${leagues.join(', ')}` } };
    } },
  { name: 'calendar', cat: 'calendar', label: 'Checking the calendar', cite: (a) => `Calendar, next ${Math.min(60, Number(a.days) || 7)} days`,
    description: 'Events on the house calendars (and CasaTorch\'s own calendar): title, start, end, which calendar.',
    params: { type: 'object', properties: { days: { type: 'number', description: '1-60, default 7' }, from: { type: 'string', description: 'Start date YYYY-MM-DD (default now)' } } },
    async run(a, ctx) {
      const days = Math.max(1, Math.min(60, Math.round(Number(a.days) || 7)));
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(a.from || '')) ? `&from=${a.from}` : '';
      const r = await askGet(ctx, `/api/calendar?days=${days}${from}`);
      const end = (from ? Date.parse(a.from) : Date.now()) + days * 86400_000;
      return { data: { events: (r.events || []).filter((e) => Date.parse(e.end || e.start) >= Date.now() - 3600_000 && Date.parse(e.start) <= end).slice(0, 80).map((e) => askClean({ title: e.title, start: e.allDay ? String(e.start).slice(0, 10) : askLocal(e.start), end: e.allDay ? undefined : askLocal(e.end), allDay: e.allDay || undefined, calendar: e.calendar, where: e.location })), errors: (r.errors || []).map((x) => x.calendar) } };
    } },
  { name: 'household', cat: 'household', label: 'Checking the household', cite: () => 'Household',
    description: 'Household reminders: bin days (which bin, when, is it out), the mailbox, plants that need water, the washer and dryer, and today\'s reminders.',
    params: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const [h, home] = await Promise.all([askGet(ctx, '/api/household').catch((e) => ({ error: e.message })), askGet(ctx, '/api/home').catch(() => ({}))]);
      return { data: askTrim({ bins: (h.bins || []).map((b) => askClean({ name: b.name, next: b.next ? askDayLabel(b.next) : null, inDays: b.days, state: b.state, out: b.out, upcoming: (b.upcoming || []).slice(0, 4).map(askDayLabel) })),
        mail: h.mail ? { state: h.mail.state, at: askLocal(h.mail.at), collected: askLocal(h.mail.collectedAt) } : undefined, plants: h.plants, laundry: h.laundry, remindersToday: (home.reminders || []).map((r) => askClean({ title: r.title, at: r.at })), error: h.error }) };
    } },
  { name: 'family', cat: 'family', label: 'Checking the family board', cite: () => 'Family',
    description: 'The family board: people, shopping and to-do lists, today\'s chores (who, done or not), stars earned, and the meal plan for the week.',
    params: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const f = await askGet(ctx, '/api/family'), who = new Map((f.people || []).map((p) => [p.id, p.name]));
      return { data: askTrim({ today: f.today, people: (f.people || []).map((p) => askClean({ name: p.name, goalStars: p.goal || undefined, reward: p.reward, starsThisWeek: f.stars?.week?.[p.id] || 0 })),
        lists: (f.lists || []).map((l) => ({ name: l.name, open: (l.items || []).filter((i) => !i.done).map((i) => i.text), done: (l.items || []).filter((i) => i.done).length })),
        choresToday: (f.chores || []).map((c) => ({ chore: c.title, stars: c.stars, who: (c.slots || []).map((s) => askClean({ person: s.person === '*' ? 'anyone' : who.get(s.person), done: !!s.done, by: s.by ? who.get(s.by) : undefined })) })),
        meals: Object.entries(f.meals || {}).sort().slice(0, 14).map(([date, m]) => askClean({ day: askDayLabel(date), meal: m.title, note: m.note })) }) };
    } },
  { name: 'cameras', cat: 'cameras', label: 'Checking the cameras', cite: () => 'Cameras',
    description: 'Cameras (names, rooms, online) and what they detected (Frigate: people, cars, animals by camera and time), plus recent doorbell and motion alerts. Text only - no pictures.',
    params: { type: 'object', properties: { hours: { type: 'number', description: 'Detections from the last 1-168 hours, default 24' } } },
    async run(a, ctx) {
      const hours = Math.max(1, Math.min(168, Math.round(Number(a.hours) || 24)));
      const [d, fr, al, demo] = await Promise.all([askGet(ctx, '/api/devices'), askGet(ctx, `/api/frigate/events?hours=${hours}`).catch(() => ({ frigate: false })), askGet(ctx, '/api/alerts').catch(() => ({})), isDemo() ? askGet(ctx, '/api/cameras').catch(() => null) : null]);
      return { data: askTrim({ cameras: (d.devices || []).filter((x) => x.kind === 'camera').map((x) => askClean({ name: x.name, room: x.area, online: x.online !== false })),
        detections: fr.frigate ? { hours, total: fr.total, byLabel: fr.byLabel, byCamera: fr.byCamera, recent: (fr.recent || []).slice(0, 25).map((e) => askClean({ camera: e.camera, what: e.subLabel || e.label, at: askLocal(e.start), zones: e.zones?.length ? e.zones : undefined })) } : undefined,
        latest: demo?.items ? demo.items.map((i) => `${i.title}: ${i.detail}`) : undefined,
        recentAlerts: (al.recent || []).filter((x) => /door|motion|person|camera|ring|doorbell/i.test(`${x.title} ${x.source}`)).slice(0, 15).map((x) => ({ at: askLocal(x.at), title: x.title })) }) };
    } },
  { name: 'internet_network', cat: 'network', label: 'Checking the network', cite: () => 'Internet & network',
    description: 'The internet (online, speed, ping), the home network (UniFi, Meraki, Pi-hole, AdGuard: devices online/offline, clients, blocked queries) and the server monitor (NAS, servers, self-hosted apps up or down, response time).',
    params: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const [i, n, m] = await Promise.all([askGet(ctx, '/api/internet').catch((e) => ({ error: e.message })), askGet(ctx, '/api/network').catch(() => ({})), askGet(ctx, '/api/monitors').catch(() => ({}))]);
      return { data: askTrim({ internet: askClean({ online: i.online, provider: ctx.share.location ? i.provider : undefined, downMbps: i.speed?.downMbps, upMbps: i.speed?.upMbps, speedTestAt: askLocal(i.speed?.at), pingMs: i.latencyMs?.cloudflare, routerPingMs: i.latencyMs?.router, devicesOnNetwork: i.lanDevices, error: i.error }),
        network: (n.sources || []).map((s) => askClean({ name: s.name, kind: s.kindName, ok: s.ok, error: s.error, summary: s.summary, offline: (s.devices || []).filter((x) => x.online === false).map((x) => x.name) })),
        servers: (m.monitors || []).map((x) => askClean({ name: x.name, up: x.up, ms: x.ms, uptime24hPct: x.uptime24h, error: x.error, certDaysLeft: x.cert?.days })) }) };
    } },
  { name: 'app_tests', cat: 'network', label: 'Checking the app tests', cite: (a) => (a.test ? 'App test path' : 'App tests'),
    description: 'App tests (Zoom, Teams, Netflix, your own sites...): is each one working, how fast (ms), usual speed, uptime, slow or failing and why. Name one test to get its network path hop by hop (home, provider, internet, app) with loss and delay.',
    params: { type: 'object', properties: { test: { type: 'string', description: 'A test name for its path, e.g. "Zoom"' } } },
    async run(a, ctx) {
      const r = await askGet(ctx, '/api/apptests'), tests = r.tests || [];
      if (a.test) {
        const t = askFind(tests.map((x) => ({ ...x, area: x.url })), a.test); if (!t) return { data: { error: `no app test called "${String(a.test).slice(0, 40)}"`, tests: tests.map((x) => x.name) } };
        const d = await askGet(ctx, `/api/apptests/${encodeURIComponent(t.id)}`), hop = (h) => askClean({ hop: h.n, name: h.name, network: h.org, zone: h.zone, lossPct: h.loss, avgMs: h.avg, usualMs: h.usual });
        return { data: askTrim({ name: t.name, ok: !t.failing && !t.down, ms: t.last?.total, usualMs: t.median24h, culprit: t.culprit, pathAt: askLocal(d.path?.at), path: (d.path?.hops || []).map(hop), destination: d.path?.dest ? hop(d.path.dest) : undefined, pathChanged: askLocal(d.pathChangedAt) }) };
      }
      return { data: { tests: tests.map((t) => askClean({ name: t.name, ok: !t.failing && !t.down, down: t.down || undefined, slow: t.slow || undefined, ms: t.last?.total, usualMs: t.median24h, uptime24hPct: t.uptime24h, culprit: t.culprit, lastRun: askLocal(t.last?.at) })) } };
    } },
  { name: 'alerts', cat: 'alerts', label: 'Checking alerts', cite: () => 'Alerts',
    description: 'Open alerts right now (leaks, smoke, doors, low batteries, devices not responding, internet down...) and what happened recently.',
    params: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const r = await askGet(ctx, '/api/alerts');
      return { data: { open: (r.now || []).map((x) => ({ severity: x.severity, title: x.title, since: askLocal(x.since) })), recent: (r.recent || []).slice(0, 25).map((x) => ({ at: askLocal(x.at), severity: x.severity, title: x.title })) } };
    } },
  { name: 'health', cat: 'health', label: 'Checking CasaTorch\'s health', cite: () => 'Health checks',
    description: 'CasaTorch\'s own health checks (Settings › Health, admins only): storage, memory, connections (Home Assistant, cameras, internet), certificates, backups and updates - each ok, warning or problem.',
    params: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const r = await askGet(ctx, '/api/doctor');
      return { data: { checks: (r.checks || []).map((c) => askClean({ group: c.group, check: c.title, status: c.status, detail: c.detail, fix: c.why })) }, at: r.at };
    } },
  { name: 'rooms_3d', cat: 'rooms', label: 'Looking at the 3D home', cite: () => '3D Home',
    description: 'The 3D home plan: floors, rooms, and the devices placed in each room with their live state.',
    params: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const [p, l] = await Promise.all([askGet(ctx, '/api/floorplan'), askGet(ctx, '/api/floorplan/live').catch(() => ({}))]);
      const pins = (l.pins || []).filter((x) => x.device && (ctx.share.cameras || x.device.kind !== 'camera'));
      return { data: askTrim({ floors: (p.floors || []).map((f) => ({ floor: f.name, rooms: (f.rooms || f.plan?.rooms || []).map((r) => r.name).filter(Boolean),
        devices: pins.filter((x) => x.floor === f.id).map((x) => askDevice(x.device)) })) }) };
    } },
  { name: 'news', cat: 'news', label: 'Reading the headlines', cite: () => 'Headlines',
    description: 'The latest headlines from the news feeds this house follows (title, source, link, time).',
    params: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const n = (await askGet(ctx, '/api/home')).news;
      return { data: { headlines: (n?.items || []).slice(0, 15).map((x) => askClean({ title: x.title, source: x.source, at: askLocal(x.at), link: askUrl(x.link) })) }, links: (n?.items || []).slice(0, 15).map((x) => ({ title: x.title, url: x.link })) };
    } },
  { name: 'stocks', cat: 'stocks', label: 'Checking prices', cite: () => 'Stock prices',
    description: 'Stock and fund prices and today\'s change for ticker symbols (the stocks widget\'s source).',
    params: { type: 'object', properties: { symbols: { type: 'string', description: 'Comma-separated tickers, e.g. "AAPL,VOO"' } }, required: ['symbols'] },
    async run(a, ctx) { const r = await askGet(ctx, `/api/w/stocks?s=${encodeURIComponent(String(a.symbols || '').slice(0, 120))}`); return { data: askTrim({ quotes: r.quotes, source: r.credit }) }; } },
];
/* The free web lookup (Settings › Home AI Agent › Web search: "CasaTorch's free lookup"): DuckDuckGo's Instant
   Answer API (short facts, with attribution) and Wikipedia's search API - both meant for this kind of use. */
const ASK_FREE_WEB = { name: 'web_search', cat: 'web', label: 'Searching the web', cite: () => null,
  description: 'Look something up on the web (DuckDuckGo instant answers and Wikipedia): facts, people, places, definitions. Not for live news, prices or scores.',
  params: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  async run(a) {
    const q = String(a.query || '').trim().slice(0, 200); if (!q) return { data: { error: 'empty search' } };
    if (isDemo() && process.env.CASATORCH_ASK_FAKE !== '1') return { data: { error: 'the demo does not search the web' } };
    const results = [];
    const [ddg, wiki] = await Promise.all([getJSON(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&t=casatorch`, { timeout: 8000 }).catch(() => null),
      getJSON(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=4`, { timeout: 8000 }).catch(() => null)]);
    if (ddg?.AbstractText && askUrl(ddg.AbstractURL)) results.push({ title: ddg.Heading || q, url: ddg.AbstractURL, text: String(ddg.AbstractText).slice(0, 900), via: ddg.AbstractSource || 'DuckDuckGo' });
    if (ddg?.Answer) results.push({ title: `DuckDuckGo: ${q}`, url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`, text: String(ddg.Answer).slice(0, 400), via: 'DuckDuckGo' });
    for (const p of wiki?.pages || []) results.push({ title: p.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(p.key || p.title).replace(/ /g, '_'))}`, text: String(p.excerpt || p.description || '').replace(/<[^>]+>/g, '').slice(0, 400), via: 'Wikipedia' });
    return { data: results.length ? { results } : { error: 'nothing found' }, links: results.map((r) => ({ title: r.title, url: r.url })) };
  } };
/* Only for screenshots and tests (CASATORCH_ASK_FAKE=1): a stand-in web search with example.org pages. */
const ASK_FAKE_WEB = { ...ASK_FREE_WEB, async run(a) { const q = String(a.query || '').slice(0, 80); const r = [{ title: `${q} - Example Encyclopedia`, url: `https://example.org/wiki/${encodeURIComponent(q.replace(/ /g, '_'))}`, text: 'Test page.' }, { title: `${q} explained - Example News`, url: 'https://example.com/news/explained', text: 'Test page.' }]; return { data: { results: r }, links: r }; } };

/* The demo's history for one sensor: a believable day, the same every time (the sample house only). */
function askDemoHistory(d, from, to) {
  const base = d.powerW != null ? d.powerW : d.tempC != null ? askTempOut(d.tempC) : Number(d.state) || null;
  if (base == null || !Number.isFinite(Number(base))) {
    const out = []; let on = !!d.on; for (let t = from; t < to; t += 97 * 60_000) { out.push([t, on ? 'on' : 'off']); on = !on; } return out;
  }
  const out = [];
  for (let t = from; t <= to; t += 15 * 60_000) { const h = new Date(t).getUTCHours(); const wave = Math.sin(((h + 7) % 24) / 24 * Math.PI * 2); out.push([t, String(Math.round((Number(base) * (1 + 0.12 * wave) + ((t / 900_000) % 7) * 0.1) * 10) / 10)]); }
  return out;
}
/* Which tools this question may use: the privacy switches, the person's role, and what is set up. */
function askToolsFor(ctx) {
  const share = ctx.share, isAdmin = !signInOn() || (ctx.user && rank(ctx.user.role) >= rank('admin'));
  const off = new Set([...(share.cameras ? [] : ['cameras']), ...(share.calendar ? [] : ['calendar']), ...(share.family ? [] : ['family']), ...(isAdmin ? [] : ['health'])]);
  const list = ASK_TOOLS.filter((t) => !off.has(t.cat));
  if (ctx.webMode === 'free') list.push(process.env.CASATORCH_ASK_FAKE === '1' ? ASK_FAKE_WEB : ASK_FREE_WEB);
  return list;
}
/* What each privacy category sends (Settings › Home AI Agent shows this). */
const ASK_SHARE_INFO = [
  { id: 'always', title: 'Always shared', what: 'Your question, the chat so far, the time and time zone, and what a lookup returns: device names, rooms and states, power use and cost, weather numbers, scores, household reminders (bins, mail, plants, laundry), alerts, the internet and network status, app tests, the 3D plan\'s rooms, headlines and stock prices. Health checks for admins.' },
  { id: 'location', title: 'Location', what: 'Your town\'s name with the weather, your internet provider\'s name, and your town as a hint for web searches. Never your address or map position.' },
  { id: 'calendar', title: 'Calendar', what: 'Event titles, times, places and calendar names.' },
  { id: 'family', title: 'Family', what: 'People\'s names, lists, chores, stars, meal plans, and who is home.' },
  { id: 'cameras', title: 'Cameras', what: 'Camera names and what they detected (person, car, animal, when). Never pictures or video.' },
];
