/* ======================================================================
 * Timeline: everything that happened at the doors and cameras, in one list.
 *
 *  - Frigate's events (people, cars, packages...), asked of Frigate itself when the timeline opens - it keeps its
 *    own history, with a snapshot and a clip for each - and played through CasaTorch (its sign-in stays here).
 *  - Doorbell presses and motion from Ring (31-ring.js) and from Home Assistant (event and motion entities, 34-live.js),
 *    alarm and lock changes from Home Assistant (who did it, when it says), and people and vehicles Cisco Meraki
 *    cameras count (Pro, asked once a minute) - noted here as they happen. A doorbell or motion event with a camera
 *    keeps the picture taken right then.
 *
 * Kept on this computer for 30 days, encrypted at rest (DATA_DIR/timeline.json and timeline-snaps/, sealed with the
 * box key like the other household data). Basic shows the last 24 hours, Pro all 30 days.
 * The timeline only reads: nothing here switches, locks, unlocks or disarms anything.
 * ====================================================================== */
const TL_FILE = path.join(DATA_DIR, 'timeline.json'), TL_SNAPS = path.join(DATA_DIR, 'timeline-snaps');
const TL_KEEP_MS = 30 * 86400_000, TL_MAX = 5000, TL_SNAP_MAX = 400, TL_BASIC_H = 24, TL_PRO_H = 24 * 30;
const TL_TYPES = ['doorbell', 'motion', 'detection', 'alarm', 'lock'];
const TL = { list: null, saveT: null, last: new Map() };
const tlText = (v, n = 80) => (v == null || v === '' ? null : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) || null);
function tlLoad() {
  if (TL.list) return TL.list;
  TL.list = [];
  try { const j = JSON.parse(unseal(fs.readFileSync(TL_FILE, 'utf8'), 'timeline') ?? '[]'); if (Array.isArray(j)) TL.list = j.filter((e) => e && TL_TYPES.includes(e.type)); } catch { /* first run */ }
  return TL.list;
}
const tlSave = () => {
  if (isDemo()) return;
  clearTimeout(TL.saveT);
  TL.saveT = setTimeout(() => { try { writeFileSafe(TL_FILE, seal(JSON.stringify(TL.list || []), 'timeline'), 0o600); } catch { /* next event */ } }, 1500);
  TL.saveT.unref?.();
};
/** An event as kept: known fields only, bounded. Pure. */
function tlClean(e, now = Date.now()) {
  if (!e || !TL_TYPES.includes(e.type)) return null;
  const at = Number.isFinite(Date.parse(e.at)) ? new Date(Date.parse(e.at)).toISOString() : new Date(now).toISOString();
  return { id: tlText(e.id, 120) || `${e.type}:${crypto.randomBytes(6).toString('hex')}`, at, type: e.type, source: tlText(e.source, 20) || 'casatorch',
    name: tlText(e.name), camera: tlText(e.camera), cameraId: tlText(e.cameraId, 160), device: tlText(e.device, 160), label: tlText(e.label, 40),
    person: tlText(e.person, 60), state: tlText(e.state, 30), snap: e.snap === true || undefined };
}
/** The same thing again within the window (a motion sensor that flickers, a person standing in view) is one event. Pure. */
const tlDupKey = (x) => `${x.type}|${x.source}|${x.device || x.cameraId || x.camera || x.name || ''}|${x.label || ''}|${x.state || ''}`;
function tlRecord(e, { now = Date.now(), within = 60_000, snapKey = null } = {}) {
  const x = tlClean(e, now); if (!x) return null;
  const k = tlDupKey(x), last = TL.last.get(k);
  if (last && now - last < within) return null;
  TL.last.set(k, now); if (TL.last.size > 1000) TL.last.clear();
  const list = tlLoad();
  list.unshift(x);
  tlPrune(now);
  tlSave();
  if (snapKey && (x.type === 'doorbell' || x.type === 'motion')) tlSnap(x, snapKey).catch(() => {});
  return x;
}
function tlPrune(now = Date.now()) {
  const list = tlLoad(), cut = now - TL_KEEP_MS;
  const keep = list.filter((e) => Date.parse(e.at) >= cut).slice(0, TL_MAX);
  const gone = list.filter((e) => e.snap && !keep.includes(e));
  // pictures: at most TL_SNAP_MAX, the newest
  let pics = 0; for (const e of keep) if (e.snap && ++pics > TL_SNAP_MAX) { gone.push(e); delete e.snap; }
  for (const e of gone) try { fs.rmSync(path.join(TL_SNAPS, `${tlSnapName(e.id)}.jpg.sealed`), { force: true }); } catch { /* gone already */ }
  TL.list = keep;
}
const tlSnapName = (id) => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 32);
/* The camera's picture right after the press or motion (the cache was just told to fetch a fresh one: snapNow). */
async function tlSnap(x, key) {
  if (isDemo() || typeof SNAP === 'undefined') return;
  if (typeof snapNow === 'function') snapNow(key);
  await new Promise((ok) => setTimeout(ok, 2500).unref?.());
  const e = SNAP.get(key); if (e?.inflight) await e.inflight.catch(() => {});
  if (!e?.buf?.length || e.buf.length > 4 * 1024 * 1024 || !e.at || e.at < Date.parse(x.at) - 1000) return;
  fs.mkdirSync(TL_SNAPS, { recursive: true, mode: 0o700 });
  writeFileSafe(path.join(TL_SNAPS, `${tlSnapName(x.id)}.jpg.sealed`), seal(e.buf.toString('base64'), `timeline.snap:${x.id}`), 0o600);
  x.snap = true; tlSave();
}

/* ---- Home Assistant: doorbell and motion events, locks, the alarm (from 34-live.js's state_changed) ---- */
const TL_HA_SUFFIX = /_(ding|doorbell|ring|pressed|button|motion|motion_detected|person|person_detected|occupancy|visitor)$/;
/** What a state change means for the timeline, or null. Pure. */
function tlHaEvent(oldS, newS) {
  const id = String(newS?.entity_id || ''), dom = id.split('.')[0], a = newS?.attributes || {};
  if (!newS || !oldS || ['unavailable', 'unknown'].includes(oldS.state) || ['unavailable', 'unknown'].includes(newS.state) || oldS.state === newS.state) return null;
  const name = tlText(a.friendly_name) || id, base = { at: newS.last_changed || newS.last_updated, source: 'ha', device: `ha:${id}`, name };
  const who = tlText(a.changed_by || a.user || a.last_changed_by, 60);
  if (dom === 'event' && ['doorbell', 'motion'].includes(a.device_class)) return { ...base, type: a.device_class, id: `ha:${id}:${newS.state}` };
  if (dom === 'binary_sensor' && newS.state === 'on' && oldS.state === 'off' && ['motion', 'occupancy'].includes(a.device_class)) return { ...base, type: 'motion' };
  if (dom === 'lock' && ['locked', 'unlocked', 'jammed', 'open'].includes(newS.state)) return { ...base, type: 'lock', state: newS.state, person: who };
  if (dom === 'alarm_control_panel' && (/^armed_/.test(newS.state) || ['disarmed', 'triggered'].includes(newS.state))) return { ...base, type: 'alarm', state: newS.state, person: who };
  return null;
}
/** The Home Assistant camera a doorbell or motion entity belongs to ("event.front_door_ding" -> camera.front_door), or null. Pure. */
function tlHaCamera(entityId, cameraIds) {
  const obj = String(entityId || '').split('.')[1] || '', stem = obj.replace(TL_HA_SUFFIX, '');
  for (const c of [`camera.${stem}`, `camera.${stem}_live_view`, `camera.${stem}_snapshot`, `camera.${obj}`]) if (cameraIds.has(c)) return c;
  return null;
}
function tlFromHa(oldS, newS) {
  const ev = tlHaEvent(oldS, newS); if (!ev) return;
  let snapKey = null;
  if (ev.type === 'doorbell' || ev.type === 'motion') {
    const cams = new Set((typeof haLiveStates === 'function' ? haLiveStates() || [] : []).map((s) => s.entity_id).filter((x) => x.startsWith('camera.')));
    const cam = tlHaCamera(newS.entity_id, cams);
    if (cam) { const st = haLiveStates().find((s) => s.entity_id === cam); ev.cameraId = `ha:${cam}`; ev.camera = tlText(st?.attributes?.friendly_name) || cam; snapKey = `ha:${cam}`; }
  }
  tlRecord(ev, { snapKey });
}

/* ---- Cisco Meraki cameras (Pro): people and vehicles they count, asked once a minute ---- */
async function tlMerakiPoll() {
  if (isDemo() || !proStatus().pro || typeof merakiSrc !== 'function') return;
  const s = merakiSrc(); if (!s) return;
  const lane = merakiLane(s);
  for (const c of merakiDevs('camera').slice(0, 8)) {
    for (const [obj, label] of [['person', 'person'], ['vehicle', 'car']]) {
      const rows = await mkGet(s, secretOf(s.secret), `/devices/${encodeURIComponent(c.serial)}/camera/analytics/recent?objectType=${obj}`, { ttl: 55_000, lane, optional: true }).catch(() => null);
      const seen = (Array.isArray(rows) ? rows : []).filter((r) => (Number(r.entrances) || 0) > 0 || (Number(r.averageCount) || 0) >= 0.5);
      if (!seen.length) continue;
      const at = seen.map((r) => Date.parse(r.startTs)).filter(Number.isFinite).sort().pop();
      tlRecord({ type: 'detection', source: 'meraki', label, camera: c.name || c.serial, cameraId: `meraki:${c.serial}`, at: at ? new Date(at).toISOString() : undefined }, { within: 5 * 60_000 });
    }
  }
}
setInterval(() => { tlMerakiPoll().catch(() => {}); }, 60_000).unref?.();

/* ---- Frigate: its own events, when the timeline opens ---- */
const tlPretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
async function tlFrigate(hours) {
  const servers = typeof frigateServers === 'function' ? frigateServers() : [];
  const out = [], errors = [], after = Math.floor(Date.now() / 1000 - hours * 3600);
  await Promise.all(servers.map(async (c, si) => {
    try {
      const q = new URLSearchParams({ after: String(after), limit: '500', include_thumbnails: '0' });
      const list = await cached(`frigate-tl:${frigateBase(c)}:${hours}`, 20_000, () => frigateJson(c, `/api/events?${q}`));
      for (const e of Array.isArray(list) ? list : []) {
        if (!FR_ID.test(String(e.id || '')) || !Number.isFinite(e.start_time)) continue;
        const sub = Array.isArray(e.sub_label) ? e.sub_label[0] : e.sub_label;
        out.push({ id: `fr:${si}:${e.id}`, at: new Date(e.start_time * 1000).toISOString(), end: e.end_time ? new Date(e.end_time * 1000).toISOString() : null, type: 'detection', source: 'frigate',
          label: tlText(e.label, 40), person: e.label === 'person' ? tlText(sub, 60) : null, camera: tlPretty(e.camera), frigateCam: tlText(e.camera, 80),
          score: Math.round(((e.data?.top_score ?? e.top_score ?? e.data?.score ?? e.score) || 0) * 100) || null, zones: Array.isArray(e.zones) ? e.zones.slice(0, 6).map((z) => tlText(z, 40)) : [],
          thumb: `/api/frigate/events/${si}/${encodeURIComponent(e.id)}/thumbnail`, picture: e.has_snapshot ? `/api/frigate/events/${si}/${encodeURIComponent(e.id)}/snapshot` : null,
          clip: e.has_clip ? `/api/timeline/clip/${si}/${encodeURIComponent(e.id)}` : null });
      }
    } catch (err) { errors.push({ source: 'frigate', error: String(err.message || err) }); }
  }));
  return { list: out, errors, frigate: servers.length > 0 };
}

/* ---- the demo: a believable day ---- */
function tlDemo(now = Date.now()) {
  const t = (m) => new Date(now - m * 60_000).toISOString(), pic = (c) => `/api/cameras/${c}/snapshot`;
  return [
    { id: 'd1', at: t(6), type: 'doorbell', source: 'ring', camera: 'Front door bell', cameraId: 'camera:doorbell', picture: pic('doorbell') },
    { id: 'd2', at: t(7), type: 'detection', source: 'frigate', label: 'person', person: 'Alex', camera: 'Front door bell', score: 91, picture: pic('doorbell') },
    { id: 'd3', at: t(42), type: 'lock', source: 'ha', name: 'Front door lock', device: 'ha:lock.front_door', state: 'locked', person: 'Sam' },
    { id: 'd4', at: t(75), type: 'detection', source: 'frigate', label: 'car', camera: 'Driveway', score: 84, picture: pic('driveway') },
    { id: 'd5', at: t(130), type: 'motion', source: 'ring', camera: 'Backyard', cameraId: 'camera:backyard', picture: pic('backyard') },
    { id: 'd6', at: t(190), type: 'detection', source: 'frigate', label: 'package', camera: 'Porch', score: 77, picture: pic('porch') },
    { id: 'd7', at: t(420), type: 'alarm', source: 'ha', name: 'House alarm', device: 'ha:alarm_control_panel.home', state: 'disarmed', person: 'Sam' },
    { id: 'd8', at: t(1500), type: 'alarm', source: 'ha', name: 'House alarm', device: 'ha:alarm_control_panel.home', state: 'armed_away', person: 'Alex' },
    { id: 'd9', at: t(1530), type: 'lock', source: 'ha', name: 'Back door lock', device: 'ha:lock.back_door', state: 'locked' },
    { id: 'd10', at: t(1610), type: 'detection', source: 'meraki', label: 'person', camera: 'Garage', cameraId: 'camera:garage', picture: pic('garage') },
    { id: 'd11', at: t(2900), type: 'motion', source: 'ha', name: 'Hallway motion', device: 'ha:binary_sensor.hallway_motion' },
    { id: 'd12', at: t(4300), type: 'doorbell', source: 'ring', camera: 'Front door bell', cameraId: 'camera:doorbell', picture: pic('doorbell') },
  ];
}

/** Filter, sort and sum up a list of events for the screen. Pure. */
function tlView(list, { hours, type = null, camera = null, person = null, now = Date.now(), limit = 400 } = {}) {
  const from = now - hours * 3600_000, inRange = list.filter((e) => { const at = Date.parse(e.at); return at >= from && at <= now + 60_000; });
  const cameras = [...new Set(inRange.map((e) => e.camera).filter(Boolean))].sort(), people = [...new Set(inRange.map((e) => e.person).filter(Boolean))].sort();
  const types = Object.fromEntries(TL_TYPES.map((k) => [k, 0]));
  const shown = inRange.filter((e) => (!camera || e.camera === camera) && (!person || e.person === person));
  for (const e of shown) types[e.type]++;
  const events = shown.filter((e) => !type || e.type === type).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { events: events.slice(0, limit), total: events.length, cameras, people, types };
}

app.get('/api/timeline', async (req, res) => {
  const pro = !!proStatus().pro || isDemo(), maxHours = pro ? TL_PRO_H : TL_BASIC_H;
  const hours = Math.min(maxHours, Math.max(1, Math.round(Number(req.query.hours) || 24)));
  const pick = (k, ok) => { const v = tlText(req.query[k], 80); return v && (!ok || ok(v)) ? v : null; };
  const type = pick('type', (v) => TL_TYPES.includes(v)), camera = pick('camera'), person = pick('person');
  const fr = isDemo() ? { list: [], errors: [], frigate: true } : await tlFrigate(hours);
  const own = (isDemo() ? tlDemo() : tlLoad()).map((e) => ({ ...e, ...(e.snap ? { picture: `/api/timeline/snap/${encodeURIComponent(e.id)}` } : {}), snap: undefined }));
  const v = tlView([...own, ...fr.list], { hours, type, camera, person });
  res.json({ pro, hours, maxHours, basicHours: TL_BASIC_H, ...v, filters: { type, camera, person }, frigate: fr.frigate, errors: fr.errors, at: nowIso() });
});
/* The picture a doorbell or motion event kept. */
app.get('/api/timeline/snap/:id', (req, res) => {
  const id = String(req.params.id), e = tlLoad().find((x) => x.id === id && x.snap);
  if (!e) return res.status(404).end();
  const pro = !!proStatus().pro; if (!pro && Date.parse(e.at) < Date.now() - TL_BASIC_H * 3600_000) return res.status(404).end();
  let b64 = null; try { b64 = unseal(fs.readFileSync(path.join(TL_SNAPS, `${tlSnapName(id)}.jpg.sealed`), 'utf8'), `timeline.snap:${id}`); } catch { /* gone */ }
  if (!b64) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=86400'); res.end(Buffer.from(b64, 'base64'));
});
/* A Frigate event's clip, through CasaTorch (Frigate's sign-in and certificate stay here). Seeking works: a Range
   asked for is passed on and Frigate's partial answer comes back as it is. */
app.get('/api/timeline/clip/:sid/:id', async (req, res) => {
  const c = (typeof frigateServers === 'function' ? frigateServers() : [])[Number(req.params.sid)];
  if (!c || !FR_ID.test(req.params.id)) return res.status(404).end();
  const range = /^bytes=\d*-\d*$/.test(String(req.headers.range || '')) ? { Range: String(req.headers.range) } : {};
  let r; try { r = await frigateGet(c, `/api/events/${encodeURIComponent(req.params.id)}/clip.mp4`, { headers: range, timeout: 30_000 }); } catch { return res.status(502).end(); }
  if (![200, 206].includes(r.statusCode)) { r.resume(); return res.status(r.statusCode === 416 ? 416 : 404).end(); }
  res.status(r.statusCode);
  res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Cache-Control', 'private, max-age=3600'); res.setHeader('Accept-Ranges', 'bytes');
  for (const h of ['content-length', 'content-range']) if (r.headers[h]) res.setHeader(h, r.headers[h]);
  r.pipe(res); req.on('close', () => r.destroy());
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchTimeline = { tlClean, tlRecord, tlHaEvent, tlHaCamera, tlView, tlDemo, tlFrigate, tlLoad, TL, TL_TYPES };
