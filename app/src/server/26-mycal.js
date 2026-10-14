/* ======================================================================
 * The HouseOS calendar - for families without Google/iCloud/Outlook.
 * Events live in data/events.json and show up next to any linked
 * calendars. Times are the house's local time.
 *   { id, title, date: 'YYYY-MM-DD', time: 'HH:MM' | null (all day), minutes, days (all-day length),
 *     repeat: none|daily|weekly|monthly|yearly, color, who }
 * ====================================================================== */
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
let myEvents = []; try { myEvents = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); } catch { /* none yet */ }
const saveMyEvents = () => { const tmp = `${EVENTS_FILE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(myEvents, null, 1), { mode: 0o600 }); fs.renameSync(tmp, EVENTS_FILE); };
const REPEATS = { none: null, daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
function myEventIcs(e, tz) {   // our shape -> the parser's shape, so repeats reuse expandEvents
  const [y, m, d] = e.date.split('-').map(Number);
  let start, end;
  if (!e.time) { start = { t: Date.UTC(y, m - 1, d), allDay: true }; end = { t: start.t + Math.max(1, e.days || 1) * 86400_000 }; }
  else { const [h, mi] = e.time.split(':').map(Number); start = { t: zonedToUtc(y, m, d, h, mi, 0, tz), allDay: false }; end = { t: start.t + Math.max(5, e.minutes || 60) * 60_000 }; }
  return { uid: `my:${e.id}`, title: e.title, location: e.where || null, start, end, rrule: REPEATS[e.repeat] ? { FREQ: REPEATS[e.repeat] } : null, exdates: [] };
}
function myCalendarEvents(from, to) {
  const tz = houseTz();
  const byId = new Map(myEvents.map((e) => [`my:${e.id}`, e]));
  return expandEvents(myEvents.map((e) => myEventIcs(e, tz)), from, to, tz).map((x) => ({ ...x, calendar: byId.get(x.uid)?.who || 'Home', color: byId.get(x.uid)?.color || '#a78bfa', mine: true, id: byId.get(x.uid)?.id }));
}
function cleanEvent(b, id) {
  const title = String(b.title || '').trim().slice(0, 120);
  if (!title) throw new Error('give the event a name');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) throw new Error('pick a date');
  const time = b.time && /^\d{2}:\d{2}$/.test(String(b.time)) ? String(b.time) : null;
  return { id, title, date: String(b.date), time, minutes: time ? Math.min(24 * 60, Math.max(5, Number(b.minutes) || 60)) : null, days: time ? null : Math.min(60, Math.max(1, Number(b.days) || 1)),
    repeat: REPEATS[b.repeat] !== undefined ? b.repeat : 'none', color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#a78bfa', who: String(b.who || '').slice(0, 40) || null, where: String(b.where || '').slice(0, 120) || null };
}
app.get('/api/mycal', (_req, res) => res.json({ events: myEvents }));
app.post('/api/mycal', express.json(), (req, res) => {
  try { const e = cleanEvent(req.body || {}, crypto.randomBytes(6).toString('hex')); myEvents.push(e); if (!isDemo()) saveMyEvents(); res.json({ ok: true, event: e }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.put('/api/mycal/:id', express.json(), (req, res) => {
  const i = myEvents.findIndex((e) => e.id === req.params.id); if (i < 0) return res.status(404).json({ error: 'event not found' });
  try { myEvents[i] = cleanEvent(req.body || {}, myEvents[i].id); if (!isDemo()) saveMyEvents(); res.json({ ok: true, event: myEvents[i] }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/mycal/:id', (req, res) => { myEvents = myEvents.filter((e) => e.id !== req.params.id); if (!isDemo()) saveMyEvents(); res.json({ ok: true }); });
