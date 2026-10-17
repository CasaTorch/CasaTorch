/* ======================================================================
 * The Home tab's data in one call: weather, what's next on the calendars,
 * your teams, headlines, the internet, today's reminders. Each part fails on
 * its own - a dead feed never blanks the panel.
 * ====================================================================== */
function remindersToday() {
  const tz = houseTz();
  const now = new Date();
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now));
  if (typeof nudgesToday === 'function' && !isDemo()) return nudgesToday().map((n) => ({ title: n.title, at: n.time, icon: n.icon || null, id: n.id }));   // nudges (78-nudges.js)
  return (config.reminders || []).filter((r) => r.enabled !== false && (!Array.isArray(r.days) || r.days.includes(dow))).map((r) => ({ title: r.title, at: r.time || null, icon: r.icon || null }));
}
const settle = async (p) => { try { return await p; } catch (err) { return { error: String(err.message || err) }; } };
app.get('/api/home', async (_req, res, next) => {
  if (isDemo()) return next();   // demo fixtures (90-demo.js)
  const [weather, calendar, sports, news, internet] = await Promise.all([
    config.location ? settle(weatherNow()) : null,
    (config.calendars || []).length || config.myCalendar || myEvents.length ? settle(calendarEvents(7)) : null,
    (config.sports?.teams || []).length ? settle(sportsNow()) : null,
    (config.news?.feeds || []).length ? settle(newsNow()) : null,
    settle(internetNow()),
  ]);
  res.json({ house: config.house?.name || 'Home', timezone: houseTz(), units: config.house?.units || 'F', weather, calendar, sports, news, internet, reminders: remindersToday(), note: config.note || null });
});
