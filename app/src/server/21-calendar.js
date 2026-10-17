/* ======================================================================
 * Calendars - any ICS/iCal link (Google "secret address in iCal format",
 * iCloud public calendar, Outlook "publish calendar", school and team
 * calendars). No sign-in. config.calendars: [{ name, url, color }].
 *
 * The parser handles what real calendars send: folded lines, all-day events,
 * UTC times, times in a named zone (TZID), and repeating events
 * (RRULE: DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY),
 * with EXDATE exceptions and moved instances (RECURRENCE-ID).
 * ====================================================================== */
/** The UTC instant of a wall-clock time in a zone ("2026-10-20 09:00 in America/Chicago"). */
const TZ_FMT = new Map();   // one formatter per time zone: making one is slow, using one is fast
const tzFmt = (tz) => { let f = TZ_FMT.get(tz); if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); if (TZ_FMT.size < 50) TZ_FMT.set(tz, f); } return f; };
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz) return guess;
  try {
    const p = Object.fromEntries(tzFmt(tz).formatToParts(guess).map((x) => [x.type, x.value]));
    const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return guess - (asIfUtc - guess);
  } catch { return guess; }
}
/** "20261020", "20261020T090000", "20261020T160000Z" (+ TZID) -> { t: ms, allDay } */
function icsTime(value, params, defaultTz) {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { t: Date.UTC(+y, +mo - 1, +d), allDay: true, ymd: `${y}-${mo}-${d}` };
  if (z) return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false };
  return { t: zonedToUtc(+y, +mo, +d, +h, +mi, +(s || 0), params.TZID || defaultTz), allDay: false };
}
function parseIcs(text, defaultTz) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = []; let cur = null;
  for (const raw of lines) {
    if (raw === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (raw === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = raw.indexOf(':'); if (i < 0) continue;
    const [nameAndParams, value] = [raw.slice(0, i), raw.slice(i + 1)];
    const [name, ...ps] = nameAndParams.split(';');
    const params = Object.fromEntries(ps.map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), (v || '').replace(/^"|"$/g, '')]));
    const text = () => value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
    if (name === 'SUMMARY') cur.title = text();
    else if (name === 'LOCATION') cur.location = text();
    else if (name === 'UID') cur.uid = value;
    else if (name === 'DTSTART') cur.start = icsTime(value, params, defaultTz);
    else if (name === 'DTEND') cur.end = icsTime(value, params, defaultTz);
    else if (name === 'DURATION') cur.duration = value;
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map((p) => p.split('=')));
    else if (name === 'EXDATE') for (const v of value.split(',')) { const t = icsTime(v, params, defaultTz); if (t) cur.exdates.push(t.t); }
    else if (name === 'RECURRENCE-ID') cur.recurrenceId = icsTime(value, params, defaultTz)?.t;
    else if (name === 'STATUS') cur.status = value;
  }
  return events;
}
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function durationMs(ev) {
  if (ev.end) return ev.end.t - ev.start.t;
  const m = String(ev.duration || '').match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (m) return (((+m[1] || 0) * 7 + (+m[2] || 0)) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60) * 1000;
  return ev.start.allDay ? 86400_000 : 3600_000;
}
/* The wall-clock date and time of an instant in a zone (all-day events use UTC fields). */
function localParts(t, tz) {
  if (!tz) { const d = new Date(t); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]; }
  const p = Object.fromEntries(tzFmt(tz).formatToParts(t).map((x) => [x.type, x.value]));   // the same cached formatter as zonedToUtc
  return [+p.year, +p.month, +p.day, +p.hour, +p.minute, +p.second];
}
/** Every occurrence overlapping [from, to). Repeats step on the event's local calendar, so a
    9 AM meeting stays at 9 AM across daylight-saving changes and evening events keep their day. */
function expandEvents(events, from, to, tz) {
  const out = [];
  const push = (ev, t, dur) => { if (t + dur > from && t < to) out.push({ uid: ev.uid || null, title: ev.title || '(no title)', location: ev.location || null, start: new Date(t).toISOString(), end: new Date(t + dur).toISOString(), allDay: !!ev.start.allDay }); };
  const moved = new Set(events.filter((e) => e.recurrenceId).map((e) => `${e.uid}|${e.recurrenceId}`));
  for (const ev of events) {
    const dur = durationMs(ev);
    if (ev.status === 'CANCELLED') continue;
    if (ev.recurrenceId || !ev.rrule) { push(ev, ev.start.t, dur); continue; }
    const r = ev.rrule, interval = Math.max(1, +r.INTERVAL || 1), count = r.COUNT ? +r.COUNT : Infinity;
    const until = r.UNTIL ? icsTime(r.UNTIL, {}, tz)?.t ?? Infinity : Infinity;
    const zone = ev.start.allDay ? null : tz;
    const [Y, M, D, h, mi, sec] = localParts(ev.start.t, zone);
    const at = (y, m, d) => (zone ? zonedToUtc(y, m, d, h, mi, sec, zone) : Date.UTC(y, m - 1, d, h, mi, sec));
    const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => DAY_CODES.indexOf(x.slice(-2))).filter((x) => x >= 0) : null;
    const baseDow = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
    let n = 0;
    /* An old daily or weekly event (say, every weekday since 2015): jump straight to just before the window
       instead of walking every day since it started. Only when there is no COUNT to keep track of. */
    const stepDays = r.FREQ === 'DAILY' ? interval : r.FREQ === 'WEEKLY' ? 7 * interval : r.FREQ === 'MONTHLY' ? 31 * interval : 366 * interval;   // months and years: round the step up, so the jump never overshoots
    const k0 = count === Infinity ? Math.max(0, Math.floor((from - ev.start.t - dur) / (stepDays * 86400_000)) - 1) : 0;
    outer: for (let k = k0; k < k0 + 1500; k++) {
      let dates = [];
      if (r.FREQ === 'DAILY') dates = [[Y, M, D + k * interval]];
      else if (r.FREQ === 'WEEKLY') dates = (byday || [baseDow]).map((wd) => [Y, M, D + k * 7 * interval + ((wd - baseDow + 7) % 7)]).sort((a, b) => a[2] - b[2]);
      else if (r.FREQ === 'MONTHLY') dates = [[Y, M + k * interval, D]];
      else if (r.FREQ === 'YEARLY') dates = [[Y + k * interval, M, D]];
      else { push(ev, ev.start.t, dur); break; }
      for (const [y, m, d] of dates) {
        const norm = new Date(Date.UTC(y, m - 1, d));
        if ((r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') && norm.getUTCDate() !== D) continue;   // no Feb 30
        const t = at(norm.getUTCFullYear(), norm.getUTCMonth() + 1, norm.getUTCDate());
        if (t < ev.start.t) continue;
        if (t > until || n >= count || t >= to) break outer;
        n++;
        if (ev.exdates.some((x) => Math.abs(x - t) < 60_000) || moved.has(`${ev.uid}|${t}`)) continue;
        push(ev, t, dur);
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
async function calendarEvents(days = 14, fromMs = null) {
  const tz = houseTz();
  const from = fromMs || Date.now() - 6 * 3600_000, to = from + days * 86400_000;
  const all = [], errors = [];
  for (const c of config.calendars || []) {
    try {
      const url = String(c.url).replace(/^webcal:/i, 'https:');
      const evs = await cached(`ics:${url}`, 15 * 60_000, async () => ({ events: parseIcs((await getText(url)).text, tz) }));
      for (const e of expandEvents(evs.events, from, to, tz)) all.push({ ...e, calendar: c.name, color: c.color || null });
    } catch (err) { errors.push({ calendar: c.name, error: String(err.message) }); }
  }
  if (typeof myCalendarEvents === 'function') all.push(...myCalendarEvents(from, to));
  return { events: all.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 300), errors };
}
app.get('/api/calendar', async (req, res) => { try {
  if (isDemo()) { const from = req.query.from ? Date.parse(req.query.from) : Date.now() - 6 * 3600_000, to = from + Math.min(400, Number(req.query.days) || 14) * 86400_000; return res.json({ events: [...(demoFixture('home').calendar?.events || []), ...myCalendarEvents(from, to)].sort((a, b) => a.start.localeCompare(b.start)), errors: [] }); }
  res.json(await calendarEvents(Math.min(400, Number(req.query.days) || 14), req.query.from ? Date.parse(req.query.from) : null)); } catch (err) { res.status(502).json({ error: String(err.message) }); } });
