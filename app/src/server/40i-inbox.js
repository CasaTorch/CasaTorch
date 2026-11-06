/* ======================================================================
 * Inbox: each person's own list of what happened, with what they've read.
 *
 * It isn't a second alert system: the items are the alerts' own history (alerts.events, 40-alerts.js), shown to each
 * person exactly as the Alerts page shows them - whatever their rules leave "In the app" (alertDecide in
 * 40r-alert-rules.js; safety is always there). Pushing to phones is decided there too and doesn't change here.
 * What's per person is only the reading: read, all read, cleared. Kept in DATA_DIR/inbox.json, sealed with the box
 * key like the other household data (who read what, and when).
 * ====================================================================== */
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json'), INBOX_MAX_IDS = 400, INBOX_SHOW = 100;
let inboxStore = null, inboxSaveT = null;
function inboxLoad() {
  if (inboxStore) return inboxStore;
  inboxStore = { users: {} };
  try { const j = JSON.parse(unseal(fs.readFileSync(INBOX_FILE, 'utf8'), 'inbox') ?? 'null'); if (j && typeof j === 'object' && j.users && typeof j.users === 'object') inboxStore = j; } catch { /* first run */ }
  return inboxStore;
}
const inboxSave = () => {
  if (isDemo()) return;
  clearTimeout(inboxSaveT);
  inboxSaveT = setTimeout(() => { try { writeFileSafe(INBOX_FILE, seal(JSON.stringify(inboxLoad()), 'inbox'), 0o600); } catch { /* next change */ } }, 300);
  inboxSaveT.unref?.();
};
const inboxUser = (uid) => {
  const s = inboxLoad(), k = String(uid || 'local');
  if (!Object.hasOwn(s.users, k) || typeof s.users[k] !== 'object') s.users[k] = { readAt: null, read: [], clearedAt: null, cleared: [] };
  return s.users[k];
};
/** Where an alert leads in CasaTorch (a page, or a page with a drawer open). Pure. */
function inboxLink(a, kind, device) {
  if (typeof a?.url === 'string' && /^\/#[a-z0-9]+(?:[/?][\w%:.=&/-]*)?$/i.test(a.url)) return a.url.slice(1);
  if (['doorbell', 'motion', 'detection'].includes(kind)) return '#timeline';
  if (device && /^[\w.:@-]{1,160}$/.test(device)) return `#alerts?dev=${encodeURIComponent(device)}`;
  return { security: '#security', network: '#network', household: '#household', reminders: '#reminders', system: '#settings/health', weather: '#alerts' }[kind] || '#alerts';
}
/** This person's inbox: the alerts they see in the app, newest first, each with read or not. Pure (ctx carries everything). */
function inboxView(events, st, { decide, panel = false, limit = INBOX_SHOW } = {}) {
  const read = new Set(st.read || []), cleared = new Set(st.cleared || []), readAt = Date.parse(st.readAt || '') || 0, clearedAt = Date.parse(st.clearedAt || '') || 0;
  const items = [];
  for (const a of events) {
    if (!a?.id || cleared.has(a.id) || (Date.parse(a.at) || 0) <= clearedAt) continue;
    const d = decide(a);
    if (!d.app || (panel && d.panel === 'off')) continue;
    items.push({ id: String(a.id), at: a.at, title: a.title, ...(a.msg ? { msg: a.msg, vars: a.vars || null } : {}), severity: a.severity || 'info', kind: d.kind, safety: !!d.safety,
      link: inboxLink(a, d.kind, d.device), read: read.has(a.id) || (Date.parse(a.at) || 0) <= readAt, image: typeof a.image === 'string' && a.image.startsWith('/api/') ? a.image : null });
    if (items.length >= limit) break;
  }
  return { items, unread: items.filter((x) => !x.read).length };
}
function inboxFor(req) {
  const rules = alertRulesHouse(), user = alertRulesUser(alertUserKey(req)), pro = !!proStatus().pro;
  const events = isDemo() ? inboxDemo() : alerts.events;
  return inboxView(events, inboxUser(alertUserKey(req)), { panel: !!req.user?.panel, decide: (a) => alertDecide(a, { rules, user, pro, target: null, device: alertDevCtx(a) }) });
}
/* Only the ids this person still has matter: the rest go (alerts.events keeps 300). */
function inboxTrim(st) {
  const have = new Set((isDemo() ? inboxDemo() : alerts.events).map((a) => a.id));
  st.read = [...new Set(st.read)].filter((id) => have.has(id)).slice(-INBOX_MAX_IDS);
  st.cleared = [...new Set(st.cleared)].filter((id) => have.has(id)).slice(-INBOX_MAX_IDS);
}
const INBOX_DEMO = { at: 0, list: [] };
function inboxDemo() {
  if (Date.now() - INBOX_DEMO.at < 10 * 60_000) return INBOX_DEMO.list;
  const t = (m) => new Date(Date.now() - m * 60_000).toISOString();
  INBOX_DEMO.at = Date.now();
  INBOX_DEMO.list = [
    { id: 'ring:doorbell-demo:doorbell:1', at: t(6), title: 'Someone at the Front door bell', severity: 'notice', source: 'ring', kind: 'doorbell', url: '/#timeline' },
    { id: 'battery:ha:sensor.back_door:demo', at: t(95), title: 'Low battery (12%): Back door sensor', severity: 'notice', source: 'ha' },
    { id: 'newdev:da:a1:19:00:00:06', at: t(36), title: 'New device on your network: 192.168.1.77', severity: 'notice', source: 'network' },   // scrub-ok: sample address
    { id: 'cleared:leak:ha:binary_sensor.laundry_leak', at: t(1440), title: 'Cleared: Water detected: Laundry leak sensor', severity: 'ok', source: 'ha' },
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return INBOX_DEMO.list;
}
app.get('/api/inbox', (req, res) => res.json(inboxFor(req)));
const inboxIds = (b) => (Array.isArray(b?.ids) ? b.ids.filter((x) => typeof x === 'string' && x.length <= 300).slice(0, 200) : []);
/** Read (some ids, or everything up to now: all) or clear (the same). The alerts themselves stay - on the Alerts page,
    and in everyone else's inbox. */
function inboxAct(uid, what, body) {
  const st = inboxUser(uid), ids = inboxIds(body);
  if (what === 'read') { if (body?.all === true) { st.readAt = nowIso(); st.read = []; } else st.read.push(...ids); }
  if (what === 'clear') { if (body?.all === true) { st.clearedAt = nowIso(); st.cleared = []; } else st.cleared.push(...ids); }
  inboxTrim(st); inboxSave();
}
app.post('/api/inbox/:what(read|clear)', express.json({ limit: '32kb' }), (req, res) => { inboxAct(alertUserKey(req), req.params.what, req.body); res.json(inboxFor(req)); });
if (process.env.CASATORCH_TEST === '1') { globalThis.__casatorchInbox = { inboxView, inboxLink, inboxUser, inboxLoad, inboxFor, inboxAct }; globalThis.__casatorchAlerts = { alerts }; }
