/* ======================================================================
 * Nudges: your home's own reminders - trash night, the dog's dinner, bills due, medicine, a birthday.
 *
 * Each nudge has a name, a time, and when it happens: once on a date, every day, on chosen days of the week,
 * every month on a date, or every year. At that time it lights up every CasaTorch screen in the house - a
 * card with its picture (one of ten icons, or a photo you upload) - until someone taps Done or Snooze. With
 * Pro it's also sent to your phones (the CasaTorch app, and the Home Assistant app if alerts go there),
 * wherever you are. Nudges are in Basic; sending them to phones is Pro.
 *
 * Kept in DATA_DIR/nudges.json, photos in DATA_DIR/nudges/. Members and up add and change them; viewers see
 * them. Reminders from setup (before 0.4.4) become nudges the first time this runs.
 * ====================================================================== */
const NUDGE_FILE = path.join(DATA_DIR, 'nudges.json'), NUDGE_DIR = path.join(DATA_DIR, 'nudges');
const NUDGE_ICONS = ['trash', 'paw', 'pill', 'bill', 'plant', 'cake', 'car', 'school', 'laundry', 'bell'];
const NUDGE_SOUNDS = ['none', 'chime', 'bell', 'dingdong', 'marimba', 'birds', 'alarm'];   // played by the screens (client 37-nudges.js makes them)
const NUDGE_REPEAT = ['once', 'daily', 'weekly', 'monthly', 'yearly'];
const NUDGE_MAX = 100, NUDGE_SHOW_MIN = 60;   // a nudge stays up an hour unless someone answers it
const ng = { list: [], active: [] };
(function nudgeLoad() {
  try { const d = JSON.parse(fs.readFileSync(NUDGE_FILE, 'utf8')); ng.list = Array.isArray(d.list) ? d.list : []; ng.active = Array.isArray(d.active) ? d.active : []; return; } catch { /* first run */ }
  // Reminders from setup become nudges (shown on screens; same days and time).
  ng.list = (config.reminders || []).filter((r) => r?.title).map((r) => ({ id: crypto.randomBytes(6).toString('hex'), title: String(r.title).slice(0, 60), icon: 'bell', time: /^\d{2}:\d{2}$/.test(r.time || '') ? r.time : '18:00',
    repeat: Array.isArray(r.days) && r.days.length && r.days.length < 7 ? 'weekly' : 'daily', days: Array.isArray(r.days) ? r.days.map(Number).filter((x) => x >= 0 && x <= 6) : [], flash: true, push: false, on: true, createdAt: nowIso() }));
})();
const nudgeSave = () => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileSafe(NUDGE_FILE, JSON.stringify({ list: ng.list, active: ng.active }, null, 2), 0o600); } catch (e) { console.warn('nudges: could not save', e.message); } };

/* The house's date and time now (its own time zone, not this computer's). */
function houseNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: houseTz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), day: Number(p.day), md: `${p.month}-${p.day}` };
}
/* Does this nudge happen on that day? (Monthly on the 31st happens on the last day of shorter months.) */
function nudgeOnDay(n, h) {
  if (!n.on) return false;
  if (n.start && h.date < n.start) return false;
  switch (n.repeat) {
    case 'once': return n.date === h.date;
    case 'daily': return true;
    case 'weekly': return (n.days || []).includes(h.dow);
    case 'monthly': { const want = Number(String(n.date || '').slice(8, 10)) || 1; const [y, m] = h.date.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return h.day === Math.min(want, last); }
    case 'yearly': return String(n.date || '').slice(5) === h.md;
    default: return false;
  }
}
/* Reminders answered in setup (run again later) become nudges too - new names only. */
function nudgesFromSetup(list) {
  let added = 0;
  for (const r of list || []) {
    if (!r?.title || ng.list.some((n) => n.title.toLowerCase() === String(r.title).trim().toLowerCase())) continue;
    const days = Array.isArray(r.days) ? r.days.map(Number).filter((x) => x >= 0 && x <= 6) : [];
    ng.list.push({ id: crypto.randomBytes(6).toString('hex'), title: String(r.title).trim().slice(0, 60), icon: NUDGE_ICONS.includes(r.icon) ? r.icon : 'bell', sound: NUDGE_SOUNDS.includes(r.sound) ? r.sound : 'chime', time: /^\d{2}:\d{2}$/.test(r.time || '') ? r.time : '18:00', repeat: days.length && days.length < 7 ? 'weekly' : 'daily', days, flash: true, push: false, on: true, createdAt: nowIso() });
    added++;
  }
  if (added) nudgeSave();
}
const nudgesToday = () => { const h = houseNow(); return ng.list.filter((n) => nudgeOnDay(n, h)).sort((a, b) => a.time.localeCompare(b.time)); };

/* Every 20 seconds: anything due this minute goes up on the screens (once per day per nudge), and to phones. */
async function nudgeTick() {
  if (!isConfigured() || isDemo()) return;
  const h = houseNow(); let changed = false;
  for (const n of ng.list) {
    const key = `${h.date} ${n.time}`;
    if (n.time !== h.time || n.lastFired === key || !nudgeOnDay(n, h)) continue;
    n.lastFired = key; changed = true;
    ng.active = ng.active.filter((a) => a.id !== n.id);
    ng.active.push({ id: n.id, at: nowIso(), until: new Date(Date.now() + NUDGE_SHOW_MIN * 60_000).toISOString() });
    if (n.repeat === 'once') n.on = false;   // done; kept so it can be used again
    if (n.push && proStatus().pro) nudgePush(n).catch(() => {});
  }
  const now = Date.now(), before = ng.active.length;
  ng.active = ng.active.filter((a) => Date.parse(a.until) > now && ng.list.some((n) => n.id === a.id));
  if (changed || ng.active.length !== before) { nudgeSave(); if (typeof liveNudge === 'function') liveNudge(); }   // every screen shows (or clears) it within a second, not at its next check
}
setInterval(() => { nudgeTick().catch(() => {}); }, 20_000).unref?.();
/* A nudge you asked to be sent is sent - quiet hours don't hold it back (you chose the time). */
async function nudgePush(n) {
  const msg = { title: n.title, body: `${n.time} reminder from your home`, tag: `nudge:${n.id}`, url: '/#home', sev: 'event' };
  await Promise.allSettled([
    (async () => {
      if (!push.subs.length) return;
      const k = vapid();
      await Promise.allSettled(push.subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(msg), { TTL: 3600, urgency: 'normal', vapidDetails: { subject: 'mailto:support@casatorch.com', publicKey: k.publicKey, privateKey: k.privateKey }, timeout: 10_000 })));   // scrub-ok: public support address
    })(),
    haPhone(msg),
    (push.apps || []).length && !isDemo() ? appPushSend(push.apps, { ...msg, sound: n.sound && n.sound !== 'none' ? n.sound : null }) : null,
  ]);
}

/* ---- what the app gets ---- */
const nudgeView = (n) => ({ id: n.id, title: n.title, icon: n.icon || null, sound: NUDGE_SOUNDS.includes(n.sound) ? n.sound : 'none', photo: !!n.photo, time: n.time, repeat: n.repeat, days: n.days || [], date: n.date || null, flash: n.flash !== false, push: !!n.push, on: n.on !== false, lastFired: n.lastFired || null });
function nudgeClean(b, old = {}) {
  const title = String(b.title ?? old.title ?? '').trim().slice(0, 60);
  if (!title) throw new Error('Give it a name, like "Trash night".');
  const time = String(b.time ?? old.time ?? '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Pick a time.');
  const repeat = NUDGE_REPEAT.includes(b.repeat) ? b.repeat : old.repeat || 'once';
  const days = repeat === 'weekly' ? [...new Set((Array.isArray(b.days) ? b.days : old.days || []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : [];
  if (repeat === 'weekly' && !days.length) throw new Error('Pick at least one day of the week.');
  const date = ['once', 'monthly', 'yearly'].includes(repeat) ? String(b.date ?? old.date ?? '') : null;
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a date.');
  const icon = NUDGE_ICONS.includes(b.icon) ? b.icon : old.icon && NUDGE_ICONS.includes(old.icon) ? old.icon : 'bell';
  const wantPush = 'push' in b ? !!b.push : !!old.push;
  const sound = NUDGE_SOUNDS.includes(b.sound) ? b.sound : NUDGE_SOUNDS.includes(old.sound) ? old.sound : 'none';
  return { title, time, repeat, days, date, icon, sound, flash: 'flash' in b ? b.flash !== false : old.flash !== false, push: wantPush, on: 'on' in b ? b.on !== false : old.on !== false };
}
/* Any change (Done, 10 more minutes, a new or edited nudge, Try it): every open screen hears at once. */
app.use('/api/nudges', (req, res, next) => { if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400 && typeof liveNudge === 'function') liveNudge(); }); next(); });
app.get('/api/nudges', (_req, res) => {
  if (isDemo()) return res.json(nudgeDemo());
  res.json({ pro: !!proStatus().pro, icons: NUDGE_ICONS, sounds: NUDGE_SOUNDS, phones: push.subs.length + (config.alerts?.phone === 'homeassistant' ? 1 : 0), list: ng.list.map(nudgeView), today: nudgesToday().map((n) => n.id) });
});
/* What should be on the screens right now (every screen asks every 30 seconds). */
app.get('/api/nudges/active', (_req, res) => {
  if (isDemo()) return res.json({ active: [] });
  const out = ng.active.map((a) => ({ ...a, nudge: ng.list.find((n) => n.id === a.id) })).filter((a) => a.nudge && a.nudge.flash !== false && (!a.snoozeUntil || Date.parse(a.snoozeUntil) < Date.now()))
    .map((a) => ({ at: a.at, ...nudgeView(a.nudge) }));
  if (typeof hhActive === 'function') out.push(...hhActive());   // bin night, the mail, the plants, the laundry (78h-household.js)
  res.json({ active: out });
});
app.post('/api/nudges', requireRole('member'), express.json({ limit: '4kb' }), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  if (ng.list.length >= NUDGE_MAX) return res.status(400).json({ error: `Up to ${NUDGE_MAX} reminders - remove one first.` });
  try {
    const n = { id: crypto.randomBytes(6).toString('hex'), ...nudgeClean(req.body || {}), createdAt: nowIso(), by: req.user?.username || null };
    if (n.push && !proStatus().pro) n.push = false;   // phones are Pro: saved without it
    ng.list.push(n); nudgeSave(); res.json({ ok: true, nudge: nudgeView(n) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/nudges/:id', requireRole('member'), express.json({ limit: '4kb' }), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const n = ng.list.find((x) => x.id === req.params.id); if (!n) return res.status(404).json({ error: 'That reminder is gone.' });
  try {
    const c = nudgeClean(req.body || {}, n); if (c.push && !proStatus().pro) c.push = false;
    const timing = c.time !== n.time || c.repeat !== n.repeat || c.date !== n.date || String(c.days) !== String(n.days || []);
    Object.assign(n, c); if (timing) delete n.lastFired;
    nudgeSave(); res.json({ ok: true, nudge: nudgeView(n) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/nudges/:id', requireRole('member'), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const n = ng.list.find((x) => x.id === req.params.id); if (!n) return res.json({ ok: true });
  if (n.photo) fs.rmSync(path.join(NUDGE_DIR, n.photo), { force: true });
  ng.list = ng.list.filter((x) => x !== n); ng.active = ng.active.filter((a) => a.id !== n.id); nudgeSave(); res.json({ ok: true });
});
/* Done (for everyone) or snooze 10 minutes. */
app.post('/api/nudges/:id/done', requireRole('member'), (req, res) => { if (typeof hhAnswer === 'function' && hhAnswer(req.params.id, 'done')) return res.json({ ok: true }); ng.active = ng.active.filter((a) => a.id !== req.params.id); nudgeSave(); res.json({ ok: true }); });
app.post('/api/nudges/:id/snooze', requireRole('member'), (req, res) => {
  if (typeof hhAnswer === 'function' && hhAnswer(req.params.id, 'snooze')) return res.json({ ok: true });
  const a = ng.active.find((x) => x.id === req.params.id); if (a) { a.snoozeUntil = new Date(Date.now() + 10 * 60_000).toISOString(); a.until = new Date(Math.max(Date.parse(a.until), Date.now() + 20 * 60_000)).toISOString(); nudgeSave(); }
  res.json({ ok: true });
});
/* Try it: shows on the screens now (and on phones, if it's set to and you have Pro). */
app.post('/api/nudges/:id/test', requireRole('member'), async (req, res) => {
  const n = ng.list.find((x) => x.id === req.params.id); if (!n) return res.status(404).json({ error: 'That reminder is gone.' });
  ng.active = ng.active.filter((a) => a.id !== n.id); ng.active.push({ id: n.id, at: nowIso(), until: new Date(Date.now() + 10 * 60_000).toISOString() }); nudgeSave();
  if (n.push && proStatus().pro) await nudgePush(n).catch(() => {});
  res.json({ ok: true });
});
/* A photo instead of an icon: JPEG, PNG or WebP up to 5 MB, checked by its first bytes. */
const NUDGE_TYPES = [['jpg', 'image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff], ['png', 'image/png', (b) => b.subarray(0, 4).toString('hex') === '89504e47'], ['webp', 'image/webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP']];
app.post('/api/nudges/:id/photo', requireRole('member'), express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const n = ng.list.find((x) => x.id === req.params.id); if (!n) return res.status(404).json({ error: 'That reminder is gone.' });
  const buf = Buffer.isBuffer(req.body) ? req.body : null, t = buf && NUDGE_TYPES.find(([, , ok]) => buf.length > 12 && ok(buf));
  if (!t) return res.status(400).json({ error: 'Use a JPEG, PNG or WebP picture, up to 5 MB.' });
  fs.mkdirSync(NUDGE_DIR, { recursive: true, mode: 0o700 });
  if (n.photo) fs.rmSync(path.join(NUDGE_DIR, n.photo), { force: true });
  n.photo = `${n.id}.${t[0]}`; writeFileSafe(path.join(NUDGE_DIR, n.photo), buf, 0o600); nudgeSave();
  res.json({ ok: true, nudge: nudgeView(n) });
});
app.delete('/api/nudges/:id/photo', requireRole('member'), (req, res) => {
  const n = ng.list.find((x) => x.id === req.params.id); if (!n) return res.json({ ok: true });
  if (n.photo) fs.rmSync(path.join(NUDGE_DIR, n.photo), { force: true });
  delete n.photo; nudgeSave(); res.json({ ok: true, nudge: nudgeView(n) });
});
app.get('/api/nudges/:id/photo', (req, res) => {
  const n = ng.list.find((x) => x.id === req.params.id); if (!n?.photo || !/^[0-9a-f]{12}\.(jpg|png|webp)$/.test(n.photo)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=300'); res.setHeader('Content-Type', NUDGE_TYPES.find(([e]) => n.photo.endsWith(e))[1]);
  res.sendFile(path.join(NUDGE_DIR, n.photo));
});
function nudgeDemo() {
  const mk = (id, title, icon, time, repeat, extra = {}) => ({ id, title, icon, photo: false, time, repeat, days: [], date: null, flash: true, push: true, on: true, lastFired: null, sound: 'chime', ...extra });
  return { pro: true, demo: true, icons: NUDGE_ICONS, phones: 2, today: ['d1', 'd2'], list: [mk('d1', 'Trash night', 'trash', '19:30', 'weekly', { days: [2] }), mk('d2', "Dog's dinner", 'paw', '17:30', 'daily'), mk('d3', 'Electric bill due', 'bill', '09:00', 'monthly', { date: '2026-01-15' }), mk('d4', "Mom's birthday", 'cake', '08:00', 'yearly', { date: '2026-03-22' }), mk('d5', 'Water the plants', 'plant', '08:30', 'weekly', { days: [1, 4] })] };
}
