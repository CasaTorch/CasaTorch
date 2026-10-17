/* ======================================================================
 * Phone alerts. When an alert starts (water, smoke, the internet down, a
 * device offline, a doorbell press...), it goes to:
 *   - every phone or computer where someone turned on alerts in CasaTorch's
 *     web app (Web Push - works with the app closed; the message is
 *     encrypted for that one device, so the push service can't read it), and
 *   - the Home Assistant phone app, if setup chose that.
 * Quiet hours hold back everything except critical alerts. Each device picks
 * how much it hears: only critical, important (the default), or everything.
 *
 * Security: a device can only be registered by a signed-in person; push
 * addresses must belong to a real push service (Google, Apple, Mozilla,
 * Microsoft) - so CasaTorch never sends anything to an address someone
 * typed in; the signing key is sealed on disk like every other secret.
 * ====================================================================== */
import webpush from 'web-push';

const PUSH_FILE = path.join(DATA_DIR, 'push.json');
const push = { vapid: null, subs: [] };
try { Object.assign(push, JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8'))); } catch { /* first run */ }
const savePush = () => { try { writeFileSafe(PUSH_FILE, JSON.stringify(push), 0o600); } catch { /* next time */ } };
function vapid() {
  if (!push.vapid) { const k = webpush.generateVAPIDKeys(); push.vapid = { publicKey: k.publicKey, privateKey: seal(k.privateKey) }; savePush(); }
  return { publicKey: push.vapid.publicKey, privateKey: unseal(push.vapid.privateKey) };
}
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.services\.mozilla\.com$/];
const okEndpoint = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(x.hostname)); } catch { return false; } };
const LEVELS = { critical: ['critical'], important: ['critical', 'warning', 'event'], all: ['critical', 'warning', 'event', 'notice', 'info'] };

/* Quiet hours in the house's own time zone: "22-7" means 10 PM to 7 AM. */
function quietNow() {
  const q = config.alerts?.quietHours || '22-7'; if (q === 'none') return false;
  const [a, b] = q.split('-').map(Number); if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: typeof houseTz === 'function' ? houseTz() : undefined }).format(new Date()));
  return a > b ? h >= a || h < b : h >= a && h < b;
}
const sevOf = (a) => (a.kind === 'doorbell' || /^ring:[^:]+:doorbell:/.test(a.id || '') ? 'event' : a.severity || 'info');   // a doorbell press is 'important'; motion only with 'everything'

/* Smart alerts (Pro): is anyone home? From people and phones Home Assistant tracks. null = can't tell. */
async function someoneHome() {
  return cached('presence:any', 60_000, async () => {
    const ppl = ((await houseDevices().catch(() => ({ devices: [] }))).devices || []).filter((d) => d.kind === 'presence' && typeof d.home === 'boolean');
    return { v: ppl.length ? ppl.some((d) => d.home) : null, n: ppl.length };
  });
}
const isArrival = (a) => /:(doorbell|motion):/.test(String(a.id || '')) || ['doorbell', 'motion'].includes(a.kind);
let sentThisHour = { hour: -1, n: 0 };
async function notify(a) {
  const sev = sevOf(a);
  if (sev === 'ok') return;   // "Cleared: ..." stays on the dashboard
  if (sev !== 'critical' && quietNow()) return;
  // Smart alerts: doorbell and motion only reach phones when nobody's home (they stay on the dashboard).
  if (config.alerts?.awayOnly && isArrival(a) && proStatus().pro && (await someoneHome()).v === true) return;
  const hr = Math.floor(Date.now() / 3_600_000); if (sentThisHour.hour !== hr) sentThisHour = { hour: hr, n: 0 };
  if (++sentThisHour.n > 30 && sev !== 'critical') return;   // a flapping sensor must not buzz a phone all night
  const msg = { title: a.title || 'CasaTorch', body: a.body || (sev === 'critical' ? 'Open CasaTorch to see what is happening.' : ''), tag: String(a.id || a.title || '').slice(0, 64), url: a.url || '/#alerts', sev };
  await Promise.allSettled([webPushAll(msg), haPhone(msg), appPushAll(msg)]);   // the browser web app, Home Assistant's app, the CasaTorch app
}
async function webPushAll(msg) {
  if (!push.subs.length) return;
  const k = vapid(); let changed = false;
  await Promise.allSettled(push.subs.filter((s) => (Object.hasOwn(LEVELS, s.level) ? LEVELS[s.level] : LEVELS.important).includes(msg.sev)).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(msg), { TTL: msg.sev === 'critical' ? 86_400 : 3_600, urgency: msg.sev === 'critical' ? 'high' : 'normal', vapidDetails: { subject: 'mailto:support@casatorch.com', publicKey: k.publicKey, privateKey: k.privateKey }, timeout: 10_000 });   // scrub-ok: public support address
      s.lastOk = nowIso(); changed = true;
    } catch (err) {
      if ([404, 410].includes(err.statusCode)) { push.subs = push.subs.filter((x) => x !== s); changed = true; }   // the device turned alerts off or the browser was reset
      else s.lastError = `${err.statusCode || ''} ${String(err.message).slice(0, 80)}`.trim();
    }
  }));
  if (changed) savePush();
}
/* The Home Assistant phone app: every phone that has it ("notify.mobile_app_<phone>"), or the ones chosen. */
async function haPhone(msg) {
  const h = config.homeAssistant; if (config.alerts?.phone !== 'homeassistant' || !h?.url) return;
  if (!(LEVELS.important).includes(msg.sev)) return;
  const H = { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' };
  let targets = config.alerts?.haTargets;
  if (!targets?.length) {
    const svc = await cached('ha:notify', 10 * 60_000, async () => ({ list: ((await getJSON(`${h.url}/api/services`, { headers: H })) || []).find((d) => d.domain === 'notify')?.services || {} }));
    targets = Object.keys(svc.list || {}).filter((n) => n.startsWith('mobile_app_'));
  }
  const data = { url: msg.url, clickAction: msg.url, tag: msg.tag, ...(msg.sev === 'critical' ? { push: { 'interruption-level': 'time-sensitive' }, priority: 'high', ttl: 0 } : {}) };
  await Promise.allSettled(targets.slice(0, 20).map((t) => getText(`${h.url}/api/services/notify/${encodeURIComponent(t)}`, { method: 'POST', headers: H, body: JSON.stringify({ title: msg.title, message: msg.body || msg.title, data }) })));
}

/* ---- the web app's side ---- */
const mySubs = (req) => push.subs.filter((s) => s.user === (req.user?.id || 'local'));
app.get('/api/push', async (req, res) => res.json({ key: vapid().publicKey, quietHours: config.alerts?.quietHours || '22-7', haPhone: config.alerts?.phone === 'homeassistant', ha: !!config.homeAssistant?.url,
  pro: !!proStatus().pro, awayOnly: !!config.alerts?.awayOnly, repeat: config.alerts?.repeat !== false, people: (await someoneHome().catch(() => ({ n: 0 }))).n,
  devices: mySubs(req).map((s) => ({ id: s.id, name: s.name, level: s.level, since: s.at, lastOk: s.lastOk || null, broken: !!s.lastError && !s.lastOk })) }));
app.post('/api/push', express.json({ limit: '8kb' }), (req, res) => {
  const sub = req.body?.subscription, level = Object.hasOwn(LEVELS, String(req.body?.level)) ? req.body.level : 'important';
  if (!sub || !okEndpoint(sub.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string' || Buffer.from(sub.keys.p256dh, 'base64url').length !== 65 || Buffer.from(sub.keys.auth, 'base64url').length !== 16) return res.status(400).json({ error: 'That browser gave an address CasaTorch can\'t use for alerts.' });
  const user = req.user?.id || 'local';
  push.subs = push.subs.filter((s) => s.endpoint !== sub.endpoint);
  if (push.subs.filter((s) => s.user === user).length >= 10) return res.status(400).json({ error: 'You already have 10 devices with alerts on - remove one first.' });
  const s = { id: crypto.randomBytes(6).toString('hex'), user, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, level, name: String(req.body?.name || 'This device').slice(0, 40), at: nowIso() };
  push.subs.push(s); savePush(); res.json({ ok: true, id: s.id });
});
app.put('/api/push/:id', express.json({ limit: '2kb' }), (req, res) => {
  const s = mySubs(req).find((x) => x.id === req.params.id); if (!s) return res.status(404).json({ error: 'not found' });
  if (Object.hasOwn(LEVELS, String(req.body?.level))) s.level = req.body.level;
  savePush(); res.json({ ok: true });
});
app.delete('/api/push/:id', (req, res) => {
  const before = push.subs.length; push.subs = push.subs.filter((s) => !(s.id === req.params.id && s.user === (req.user?.id || 'local')));
  if (push.subs.length !== before) savePush(); res.json({ ok: true });
});
app.post('/api/push/:id/test', async (req, res) => {
  const s = mySubs(req).find((x) => x.id === req.params.id); if (!s) return res.status(404).json({ error: 'not found' });
  const k = vapid();
  try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: 'CasaTorch', body: 'Alerts work on this device.', tag: 'test', url: '/#alerts', sev: 'info' }), { TTL: 600, vapidDetails: { subject: 'mailto:support@casatorch.com', publicKey: k.publicKey, privateKey: k.privateKey }, timeout: 10_000 }); s.lastOk = nowIso(); s.lastError = null; savePush(); res.json({ ok: true }); }   // scrub-ok: public support address
  catch (err) { res.status(502).json({ error: `The push service said no (${err.statusCode || err.message}). Turn alerts off and on again on that device.` }); }
});
/* Settings: quiet hours, and whether the Home Assistant phone app gets alerts too. Owner/admin. */
app.put('/api/alerts/settings', requireRole('admin'), express.json({ limit: '2kb' }), (req, res) => {
  const b = req.body || {}, next = { ...(config.alerts || {}) };
  if (['22-7', '23-6', '21-6', 'none'].includes(b.quietHours)) next.quietHours = b.quietHours;
  if (typeof b.haPhone === 'boolean') next.phone = b.haPhone ? 'homeassistant' : null;
  if (typeof b.awayOnly === 'boolean') next.awayOnly = b.awayOnly;
  if (typeof b.repeat === 'boolean') next.repeat = b.repeat;
  config.alerts = next; saveConfig(config); res.json({ ok: true, alerts: { quietHours: next.quietHours, haPhone: next.phone === 'homeassistant', awayOnly: !!next.awayOnly, repeat: next.repeat !== false } });
});
