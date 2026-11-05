/* ======================================================================
 * Cameras that set themselves up.
 *
 *  1. New cameras just show up. Whenever Home Assistant gets a camera (its live updates, 34-live.js) - and every few
 *     minutes for Frigate and the rest - the cameras are compared with the ones CasaTorch already knows
 *     (data/cameras-auto.json). A new one is shown at once (Settings › Cameras › Show new cameras automatically, on
 *     unless turned off - then it waits under Detected cameras), written to the Activity log, and every screen shows
 *     "New camera: <name>" with Hide and Open. Never sent to phones. A camera Frigate has that CasaTorch doesn't
 *     (added in Frigate after setup) is added the same way.
 *  2. The fastest live video, with nothing to set up. Each Home Assistant camera is matched to a stream in Frigate's
 *     go2rtc - by name (the endings _live_view, _snapshot, _live and _h264 don't count) or by ring-mqtt's stream
 *     (its stream_Source, rtsp://<host>:8554/<id>_live, among go2rtc's sources) - and then plays through Frigate,
 *     about half a second behind, instead of through Home Assistant. The camera's details say which it uses.
 *  3. "Add to Frigate" (the owner, after typing their password): the camera goes into Frigate's own settings file -
 *     a go2rtc stream and a camera that records and detects - as text inserted into the file, everything else in it
 *     left exactly as it was. Frigate checks the change before it is saved (a refusal is shown as Frigate wrote it
 *     and nothing changes); Frigate is restarted only when the owner says so. The last five versions of the file are
 *     kept here, sealed (AES-256-GCM, like every secret), for "Undo the last change". When Frigate reads its cameras
 *     from a go2rtc outside it, the owner gets the two pieces to paste instead.
 *  4. Camera walls: the household's own sets of cameras, each with its layout (data/camera-walls.json). Admins make
 *     and change them; everyone signed in sees them, on every screen and in the phone apps.
 * Frigate's sign-in and the cameras' stream addresses never leave this box (the browser sees names only).
 * ====================================================================== */
const CAM_TAIL = /(?:[\s_-]+(?:live[\s_-]*view|snapshot|live|h26[45]))+$/i;
/** A camera's name or entity id without what tells its streams apart: "camera.Garden_Gate_Live_View" -> "gardengate". */
const camBaseName = (s) => {
  const raw = String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^camera\./, '').trim(), cut = raw.replace(CAM_TAIL, '');
  return (cut.replace(/[^a-z0-9]+/g, '').length >= 2 ? cut : raw).replace(/[^a-z0-9]+/g, '');
};
/** What a camera is matched to a go2rtc stream by: its base name with or without "ring_" in front, and the number Home
    Assistant adds when two devices share a name kept as its own part. { key, stem }: "camera.ring_driveway_live_view_2"
    -> { key: "driveway2", stem: "driveway" }; stem is null without such a number. Pure. */
function camMatchKeys(s) {
  let raw = String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^camera\./, '').trim().replace(/^ring[\s_-]+(?=[a-z0-9])/, '');
  const n = /[\s_-]+(\d{1,3})$/.exec(raw); if (n) raw = raw.slice(0, n.index);
  const b = camBaseName(raw);
  return b ? { key: `${b}${n ? n[1] : ''}`, stem: n ? b : null } : { key: '', stem: null };
}
const CA_FILE = path.join(DATA_DIR, 'cameras-auto.json'), CA_BACKUPS = path.join(DATA_DIR, 'frigate-config-backups.json'), CW_FILE = path.join(DATA_DIR, 'camera-walls.json');
const CA = { known: null, pending: [], notices: [], added: {}, map: {}, mapAt: 0, offers: 0 };
try { const j = JSON.parse(fs.readFileSync(CA_FILE, 'utf8')); if (j && typeof j === 'object') Object.assign(CA, { known: Array.isArray(j.known) ? j.known.map(String) : null, pending: Array.isArray(j.pending) ? j.pending.map(String) : [], notices: Array.isArray(j.notices) ? j.notices : [], added: j.added && typeof j.added === 'object' ? j.added : {}, map: j.map && typeof j.map === 'object' ? j.map : {} }); } catch { /* first run */ }
const caSave = () => { if (isDemo()) return; try { writeFileSafe(CA_FILE, JSON.stringify({ known: CA.known, pending: CA.pending, notices: CA.notices, added: CA.added, map: CA.map })); } catch { /* next time */ } };
const camAutoOn = () => config.cameraAuto?.show !== false;
const camAutoPending = () => (isDemo() ? [] : CA.pending);
/** For the Cameras page's suggestion: new cameras of the last days, and ones that could go into Frigate. */
const camAutoFacts = () => CA.notices.filter((n) => Date.now() - Date.parse(n.at) < CA_NOTICE_DAYS * 86400_000).length + (CA.offers || 0);
function camAutoAccept(id) { const i = CA.pending.indexOf(String(id)); if (i >= 0) { CA.pending.splice(i, 1); caSave(); } }
const CA_NOTICE_DAYS = 3;

/** Pure: what's new. state { known, pending, notices }, cams: every camera now (before duplicates are hidden), show: the
    ids that would show. A new camera that is the same camera as one already shown is only remembered. The first look
    remembers everything and announces nothing. Returns { state, found: [{ id, name, shown }] }. */
function camAutoDiff(state, cams, show, { auto = true, now = Date.now() } = {}) {
  const known = new Set(state.known || []), first = !Array.isArray(state.known);
  const out = { known: [...known], pending: [...(state.pending || [])], notices: (state.notices || []).filter((n) => now - Date.parse(n.at) < CA_NOTICE_DAYS * 86400_000) };
  const found = [];
  for (const d of cams) {
    if (known.has(d.id)) continue;
    known.add(d.id); out.known.push(d.id);
    if (first || !show.has(d.id)) continue;   // the first look, or the same camera reached another way
    const name = String(d.name || d.id).slice(0, 80);
    found.push({ id: d.id, name, shown: auto });
    if (auto) out.notices.unshift({ id: crypto.createHash('sha256').update(`${d.id}|${now}`).digest('hex').slice(0, 12), dev: d.id, name, at: new Date(now).toISOString() });
    else if (!out.pending.includes(d.id)) out.pending.push(d.id);
  }
  out.known = out.known.slice(-2000); out.notices = out.notices.slice(0, 20); out.pending = out.pending.slice(-200);
  return { state: out, found };
}

/* ---- Frigate cameras added in Frigate after setup: added here too ---- */
const caPretty = (n) => String(n).replace(/[_-]+/g, ' ').trim().replace(/^\w/, (x) => x.toUpperCase());
async function camFrigateSync() {
  const servers = frigateServers(); if (!servers.length) return false;
  const cams = [...(config.cameras || [])]; let changed = false;
  for (const c of servers) {
    const conf = await frigateJson(c, '/api/config').catch(() => null);
    if (!conf?.cameras || typeof conf.cameras !== 'object') continue;
    for (const [n, cc] of Object.entries(conf.cameras)) {
      if (!/^[\w.-]{1,64}$/.test(n) || cc?.enabled === false) continue;
      if (cams.some((x) => x.type === 'frigate' && frigateBase(x) === frigateBase(c) && x.camera === n)) continue;
      let id = `frigate-${n}`; for (let k = 2; cams.some((x) => x.id === id); k++) id = `frigate-${n}-${k}`;
      cams.push({ id, name: String(CA.added[n]?.name || caPretty(n)).slice(0, 80), type: 'frigate', url: frigateBase(c), camera: n, ...(c.user ? { user: c.user, password: c.password || '' } : {}), ...(c.fingerprint && c.ca ? { fingerprint: c.fingerprint, ca: c.ca } : {}) });
      changed = true;
    }
  }
  if (changed) { saveConfig({ ...config, cameras: cams }); CACHE.delete('dev:camera'); }
  return changed;
}

/** Look for new cameras now (one look at a time). */
let caBusy = null, caSoonT = null;
async function camAutoCheck() {
  if (isDemo() || !isConfigured()) return null;
  if (caBusy) return caBusy;
  caBusy = (async () => {
    await camFrigateSync().catch(() => false);
    if (config.homeAssistant?.url && !(await haStates().catch(() => [])).length) return null;   // Home Assistant isn't answering: nothing is new
    CACHE.delete('dev:ha');
    const { devices } = await allDevices();
    const names = uiPrefs().deviceNames || {}, cams = devices.filter((d) => d.kind === 'camera').map((d) => ({ ...d, originalName: d.name, name: names[d.id] || d.name }));
    const hosts = new Map((config.cameras || []).map((c) => [`camera:${c.id}`, camHostOf(c)]));
    const { show } = camDedupe(cams.map((d) => (hosts.get(d.id) ? { ...d, camHost: hosts.get(d.id) } : d)), config.cameraHide || {});
    const { state, found } = camAutoDiff(CA, cams, show, { auto: camAutoOn() });
    const camIds = new Set(cams.map((d) => d.id)); state.notices = state.notices.filter((n) => camIds.has(n.dev));   // a notice for something that turned out not to be a camera (a Ring Chime) goes
    const changed = state.known.length !== (CA.known || []).length || found.length || state.notices.length !== CA.notices.length;
    Object.assign(CA, state);
    for (const f of found) audit(null, 'camera-found', { device: f.name, ...(f.shown ? {} : { waiting: true }) });
    if (changed) { caSave(); if (found.length) { CACHE.delete('page-facts:cameras'); liveNudge(); } }
    return found;
  })().finally(() => { caBusy = null; });
  return caBusy;
}
/** Home Assistant has a camera this second: look soon (a camera already known costs nothing). */
function camAutoSoon(ent) {
  if (isDemo() || process.env.CASATORCH_TEST === '1') return;
  if (ent && CA.known && CA.known.includes(`ha:${ent}`)) return;
  clearTimeout(caSoonT); caSoonT = setTimeout(() => camAutoCheck().catch(() => {}), 4000); caSoonT.unref?.();
}
if (process.env.CASATORCH_TEST !== '1') {
  setTimeout(() => camAutoCheck().catch(() => {}), 45_000).unref?.();
  setInterval(() => camAutoCheck().catch(() => {}), 5 * 60_000).unref?.();
}

/* ---- The fastest way to each Home Assistant camera ---- */
/** The stream address ring-mqtt gives a camera (its stream_Source), by entity and by name - on the camera itself, or on
    its "info" sensor (sensor.<name>_info, or any sensor of the same Home Assistant device). Pure. */
function camSources(states, devIds = {}) {
  const byEnt = {}, byBase = {}, byDev = {};
  const srcOf = (a) => { for (const [k, v] of Object.entries(a || {})) if (/^stream_?source$/i.test(k) && typeof v === 'string' && /^rtsps?:\/\//i.test(v)) return v.trim(); return null; };
  for (const s of states) {
    const src = srcOf(s.attributes); if (!src) continue;
    const [dom, obj] = String(s.entity_id).split('.');
    if (dom === 'camera') byEnt[s.entity_id] = src;
    const o = dom === 'sensor' ? obj.replace(/_info(?=(?:_\d{1,3})?$)/, '') : obj, b = camBaseName(o), k = camMatchKeys(o).key;   // sensor.driveway_info_2 belongs to camera.driveway_2
    if (b) byBase[b] ||= src;
    if (k && k !== b) byBase[k] ||= src;
    const d = devIds[s.entity_id]; if (d) byDev[d] ||= src;
  }
  return { byEnt, byBase, byDev };
}
const RING_ID = /\/([0-9a-f]{12}_live)(?:[/?#]|$)/i;
/** Pure: for each Home Assistant camera, the fastest way to it. frigates: [{ i, streams: go2rtc's /api/streams, conf: Frigate's
    /api/config }]. Returns { <entity>: { via: 'frigate'|'ha', srv?, main?, sub?, how?: 'ring'|'name', frigateCam, ring, rtsp } }
    (rtsp - the camera's own address - stays on this box). */
function camMatch(cams, sources, frigates, devIds = {}) {
  const out = {};
  /* The names each camera may be matched by. Its entity id always; its friendly name only when no other camera has the
     same one (two Ring devices called "Driveway" become camera.driveway and camera.driveway_2 - the name can't tell them
     apart, the _2 can). And camera.driveway_2 may use plain "driveway" when no other camera here is called that (the
     first "Driveway" was a chime, say, so go2rtc has only ring_driveway). */
  const ek = new Map(cams.map((s) => [s.entity_id, camMatchKeys(s.entity_id)])), nk = new Map(cams.map((s) => [s.entity_id, camMatchKeys(s.attributes?.friendly_name || '')]));
  const nameCount = new Map(); for (const k of nk.values()) if (k.key) nameCount.set(k.key, (nameCount.get(k.key) || 0) + 1);
  const claimed = (k, me) => cams.some((o) => o.entity_id !== me && (ek.get(o.entity_id).key === k || (nk.get(o.entity_id).key === k && nameCount.get(k) === 1)));
  for (const s of cams) {
    const ent = s.entity_id, a = s.attributes || {}, base = camBaseName(ent), e = ek.get(ent), nm = nk.get(ent);
    const keys = [e.key, ...(nm.key && nameCount.get(nm.key) === 1 && !claimed(nm.key, ent) ? [nm.key] : [])].filter(Boolean);
    const stemKeys = e.stem && !claimed(e.stem, ent) ? [e.stem] : [];
    const rtsp = sources.byEnt?.[ent] || sources.byDev?.[devIds[ent]] || sources.byBase?.[base] || sources.byBase?.[e.key] || null, ringId = RING_ID.exec(rtsp || '')?.[1] || null;
    const ring = !!ringId || /\bring\b/i.test(String(a.attribution || ''));
    const tryWith = (want) => {
      for (const f of frigates) {
        const conf = f.conf || {}, gs = conf.go2rtc?.streams && typeof conf.go2rtc.streams === 'object' ? conf.go2rtc.streams : {};
        const names = [...new Set([...Object.keys(f.streams || {}), ...Object.keys(gs)])].filter((n) => /^[\w.-]{1,80}$/.test(n));
        const urls = (n) => [...(Array.isArray(f.streams?.[n]?.producers) ? f.streams[n].producers.map((p) => p?.url) : []), ...[].concat(gs[n] || [])].filter((u) => typeof u === 'string');
        // a Ring camera whose ring-mqtt stream is known is only ever matched to that stream - never to another camera that has its name
        const ringOk = (n) => !ringId || !urls(n).length || urls(n).some((u) => u.includes(`/${ringId}`));
        const isRing = (n) => urls(n).some((u) => u.includes(`/${ringId}`)) || [ringId.toLowerCase(), ringId.toLowerCase().replace(/_live$/, '')].includes(n.toLowerCase());
        let hit = null, how = null;
        if (ringId) { hit = names.find(isRing) || null; if (hit) how = 'ring'; }
        if (!hit) { hit = names.filter((n) => want(n) && ringOk(n)).sort((x, y) => x.length - y.length)[0] || null; if (hit) how = 'name'; }
        const fcams = Object.keys(conf.cameras && typeof conf.cameras === 'object' ? conf.cameras : {});
        const reads = (n, st) => !!st && (conf.cameras[n]?.ffmpeg?.inputs || []).some((x) => String(x?.path || '').split('?')[0].replace(/\/+$/, '').endsWith(`:8554/${st}`));
        const fcam = fcams.find((n) => want(n) && (!ringId || reads(n, hit))) || fcams.find((n) => reads(n, hit)) || null;
        if (!hit && !fcam) continue;
        const pick = hit ? (pickStreams(hit, names, (fcam && conf.cameras[fcam]) || {}) || { main: hit, sub: hit }) : null;
        return { ...(pick ? { via: 'frigate', srv: f.i, main: pick.main, sub: pick.sub, how } : { via: 'ha', srv: f.i }), frigateCam: fcam };
      }
      return null;
    };
    const by = (list) => (n) => { const k = camMatchKeys(n).key; return !!k && list.includes(k); };
    const best = tryWith(by(keys)) || (stemKeys.length ? tryWith(by(stemKeys)) : null);
    out[ent] = { via: 'ha', frigateCam: null, ...(best || {}), ring, rtsp };
  }
  return out;
}
const caSlim = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { via: v.via, ...(v.via === 'frigate' ? { srv: v.srv, main: v.main, sub: v.sub, how: v.how } : {}), ...(v.frigateCam ? { frigateCam: v.frigateCam } : {}), ...(v.rtsp ? { src: true } : {}), ...(v.ring ? { ring: true } : {}) }]));
/** The full map (addresses included - for this box only), asked again once a minute. */
async function camFastMap(fresh = false) {
  if (isDemo() || !config.homeAssistant?.url) return {};
  if (fresh) CACHE.delete('camauto:map');
  const r = await cached('camauto:map', 60_000, async () => {
    const states = await haStates(), models = await haCamModels().catch(() => ({}));
    const cams = states.filter((s) => /^camera\.\w{1,120}$/.test(s.entity_id) && !haIsChime(s, models[s.entity_id]));   // a Ring Chime is no camera (32-ha.js)
    if (!cams.length) return { map: {} };
    const devIds = await haDevIds().catch(() => ({}));
    const frigates = await Promise.all(frigateServers().map(async (c, i) => {
      const [streams, conf] = await Promise.all([frigateJson(c, '/api/go2rtc/streams').catch(() => null), frigateJson(c, '/api/config').catch(() => null)]);
      return { i, streams: streams && typeof streams === 'object' && !Array.isArray(streams) ? streams : {}, conf: conf && typeof conf === 'object' ? conf : {} };
    }));
    const map = camMatch(cams, camSources(states, devIds), frigates, devIds);
    const slim = caSlim(map);
    if (JSON.stringify(slim) !== JSON.stringify(CA.map)) { CA.map = slim; caSave(); }
    CA.mapAt = Date.now();
    return { map };
  });
  return r.map || {};
}
/** What's known right now, without waiting (asks again in the background when it's a minute old). */
function camMapNow() {
  if (!isDemo() && config.homeAssistant?.url && Date.now() - CA.mapAt > 60_000 && process.env.CASATORCH_TEST !== '1') { CA.mapAt = Date.now(); camFastMap().catch(() => {}); }
  return CA.map || {};
}
/** A Home Assistant camera's go2rtc stream through Frigate: { c, main, sub, how } or null. */
async function camFastFor(ent) {
  let m = camMapNow()[ent];
  if (!m && !CA.mapAt) m = (await Promise.race([camFastMap().then((x) => caSlim(x)[ent]), new Promise((ok) => setTimeout(ok, 4000))]).catch(() => null)) || null;
  if (m?.via !== 'frigate') return null;
  const c = frigateServers()[m.srv];
  return c && m.main ? { c, main: m.main, sub: m.sub || m.main, how: m.how || null, ring: !!m.ring } : null;
}

/* ---- Frigate's settings file, changed as text ---- */
const FR_RESERVED = /^(y|yes|n|no|true|false|on|off|null)$/;
/** A Frigate camera name for a Home Assistant camera: its name in lower case with underscores, never one Frigate (or its
    go2rtc) already has - ring_<name> for a Ring camera, then _2, _3... Pure. */
function frigateCamName(haName, taken = [], { ring = false } = {}) {
  const used = new Set([...taken].map((x) => String(x).toLowerCase()));
  let slug = String(haName || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^camera\./, '').replace(CAM_TAIL, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36).replace(/_+$/, '');
  if (!slug) slug = 'camera';
  if (/^\d/.test(slug) || FR_RESERVED.test(slug)) slug = `cam_${slug}`;
  let name = slug;
  if (used.has(name)) name = ring && !slug.startsWith('ring_') ? `ring_${slug}` : `${slug}_cam`;
  for (let k = 2; used.has(name); k++) name = `${ring && !slug.startsWith('ring_') ? `ring_${slug}` : slug}_${k}`;
  return name;
}
/** A camera stream address someone typed, or ring-mqtt's: rtsp:// or rtsps:// only, one line, nothing a settings file or a
    shell could read as anything but the address. Throws a plain-words error. */
function rtspClean(v) {
  const s = String(v ?? '').trim();
  const bad = () => Object.assign(new Error('That doesn\'t look like a camera stream address. It starts with rtsp:// or rtsps://.'), { status: 400 });
  if (!s) return null;
  if (s.length > 400 || /[\s"'`\\$;&|<>{}[\]#,^\u0000-\u001f\u007f]/.test(s) || !/^rtsps?:\/\/[^/?#]+/i.test(s)) throw bad();
  let u; try { u = new URL(s); } catch { throw bad(); }
  if (!/^rtsps?:$/i.test(u.protocol) || !u.hostname || blockedUrl(s)) throw bad();
  return s;
}
/** The address as it may be shown: a password in it becomes ****. */
const rtspShown = (s) => { try { const u = new URL(s); if (u.password) u.password = '****'; return u.href.replace(/%2A/g, '*'); } catch { return ''; } };

/* Frigate's settings file (YAML), read just enough to find where things go: its top-level keys, and the lines of each. */
function yamlLines(raw) {
  const lines = raw.split('\n'), txt = (i) => lines[i].replace(/\r$/, '');
  const tops = [];   // { key, at, rest }
  let seenKey = false;
  lines.forEach((l0, i) => {
    const l = l0.replace(/\r$/, '');
    if (!l.trim() || /^\s*#/.test(l) || /^\s/.test(l) || l.startsWith('- ') || l === '-') return;
    if (!seenKey && /^---\s*(#.*)?$/.test(l)) return;   // the document's start marker
    const m = /^([A-Za-z0-9_][\w.-]*)\s*:(?:\s+(.*))?$/.exec(l);
    if (m) seenKey = true;
    tops.push({ key: m ? m[1] : null, at: i, rest: m ? String(m[2] || '').replace(/(^|\s)#.*$/, '').trim() : '?' });
  });
  const block = (key) => { const k = tops.findIndex((t) => t.key === key); return k < 0 ? null : { ...tops[k], end: k + 1 < tops.length ? tops[k + 1].at : lines.length }; };
  return { lines, txt, tops, block };
}
/** Pure: can a camera be put into this file here? null when it can, or { why: 'format'|'restream', host } when the owner
    should paste it in instead (Frigate reads its cameras from a go2rtc outside it, or the file is written in a way this
    doesn't change: JSON, tabs, {...} on one line, several documents). */
function frigateYamlShape(raw) {
  if (typeof raw !== 'string') return { why: 'format' };
  if (/^\s*[{[]/.test(raw) || /^[ ]*\t/m.test(raw)) return { why: 'format' };
  const { txt, tops, block } = yamlLines(raw), go = block('go2rtc'), cams = block('cameras');
  if ((go && go.rest) || (cams && cams.rest) || tops.some((t) => !t.key)) return { why: 'format' };
  if (go) for (let i = go.at + 1; i < go.end; i++) if (/^\s+streams\s*:\s*[^\s#]/.test(txt(i))) return { why: 'format' };
  if (!go && cams) for (let i = cams.at + 1; i < cams.end; i++) {
    const h = /path:\s*['"]?rtsps?:\/\/(?:[^@\s/'"]*@)?([^:/'"\s]+):8554\//.exec(txt(i))?.[1];
    if (h && !/^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(h)) return { why: 'restream', host: h.slice(0, 120) };
  }
  return null;
}
/** Pure: insert a camera into Frigate's settings file (YAML), changing nothing else in it. opts: { name, source, ring, stream }
    - source: the stream address (a go2rtc stream <name> is added for it), or stream: the go2rtc stream it already has.
    Returns { ok: true, text }, or { ok: false, paste: true, why, host } (frigateYamlShape). */
function frigateYamlAdd(raw, { name, source = null, ring = false, stream = null } = {}) {
  if (typeof raw !== 'string' || raw.length > 2_000_000) throw Object.assign(new Error('Frigate\'s settings file couldn\'t be read.'), { status: 502 });
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(String(name || '')) || FR_RESERVED.test(name)) throw Object.assign(new Error('That camera name can\'t be used in Frigate.'), { status: 400 });
  if (stream != null && !/^[\w.-]{1,80}$/.test(String(stream))) throw Object.assign(new Error('That stream can\'t be used.'), { status: 400 });
  const src = stream ? null : rtspClean(source);
  if (!stream && !src) throw Object.assign(new Error('Type the camera\'s stream address (rtsp://...).'), { status: 400 });
  const shape = frigateYamlShape(raw); if (shape) return { ok: false, paste: true, ...shape };
  const nl = /\r\n/.test(raw) ? '\r' : '';
  const { lines, txt, block } = yamlLines(raw), go = block('go2rtc'), cams = block('cameras');
  const indentOf = (s) => /^ */.exec(s)[0].length, blank = (s) => !s.trim(), comment = (s) => /^\s*#/.test(s);
  const lastIn = (from, to, deeper) => { let at = from; for (let i = from + 1; i < to; i++) { const l = txt(i); if (!blank(l) && indentOf(l) > deeper) at = i; } return at; };
  const firstIndent = (from, to, deeper) => { for (let i = from + 1; i < to; i++) { const l = txt(i); if (!blank(l) && !comment(l) && indentOf(l) > deeper) return indentOf(l); } return null; };
  const keysAt = (from, to, ind) => { const out = []; for (let i = from + 1; i < to; i++) { const l = txt(i); if (!blank(l) && !comment(l) && indentOf(l) === ind) { const m = /^\s*([^\s:#][^:#]*?)\s*:/.exec(l); if (m) out.push(m[1].replace(/^['"]|['"]$/g, '')); } } return out; };
  const inserts = [];   // [after this line (null: at the end), lines]
  if (!stream) {
    const q = `"${src}"`;   // rtspClean let no quote, backslash or new line through
    if (go) {
      const gi = firstIndent(go.at, go.end, 0) || 2;
      let st = null; for (let i = go.at + 1; i < go.end; i++) { const l = txt(i); if (indentOf(l) === gi && /^\s*streams\s*:/.test(l)) { st = i; break; } }
      if (st != null) {
        let stEnd = go.end; for (let i = st + 1; i < go.end; i++) { const l = txt(i); if (!blank(l) && !comment(l) && indentOf(l) <= gi) { stEnd = i; break; } }
        const ei = firstIndent(st, stEnd, gi) ?? gi * 2;
        if (keysAt(st, stEnd, ei).includes(name)) throw Object.assign(new Error('Frigate already has a stream with that name.'), { status: 409 });
        inserts.push([lastIn(st, stEnd, gi), [`${' '.repeat(ei)}${name}:`, `${' '.repeat(ei + 2)}- ${q}`]]);
      } else inserts.push([lastIn(go.at, go.end, 0), [`${' '.repeat(gi)}streams:`, `${' '.repeat(gi * 2)}${name}:`, `${' '.repeat(gi * 2 + 2)}- ${q}`]]);
    } else inserts.push([null, ['go2rtc:', '  streams:', `    ${name}:`, `      - ${q}`]]);
  }
  const input = `rtsp://127.0.0.1:8554/${stream || name}`;
  const camLines = (e, u) => { const p = (n) => ' '.repeat(e + u * n); return [`${p(0)}${name}:`, `${p(1)}ffmpeg:`, ...(ring ? [`${p(2)}hwaccel_args: []`] : []), `${p(2)}inputs:`, `${p(3)}- path: ${input}`, `${p(3)}  input_args: preset-rtsp-restream`, `${p(3)}  roles:`, `${p(3)}    - detect`, `${p(3)}    - record`]; };
  if (cams) {
    const e = firstIndent(cams.at, cams.end, 0) || 2;
    if (keysAt(cams.at, cams.end, e).includes(name)) throw Object.assign(new Error('Frigate already has a camera with that name.'), { status: 409 });
    inserts.push([lastIn(cams.at, cams.end, 0), camLines(e, e)]);
  } else inserts.push([null, ['cameras:', ...camLines(2, 2)]]);
  const out = [...lines];
  for (const [at, add] of inserts.filter(([x]) => x != null).sort((a, b) => b[0] - a[0])) out.splice(at + 1, 0, ...add.map((x) => x + nl));
  const tail = inserts.filter(([x]) => x == null).flatMap(([, a]) => a).map((x) => x + nl);
  if (tail.length) {   // after the file's last line (before any blank lines it ends with)
    let k = out.length - 1; while (k >= 0 && !out[k].replace(/\r$/, '')) k--;
    if (k < 0) out.splice(0, out.length, ...tail, '');
    else if (k === out.length - 1) { out[k] += nl; out.push(...tail, ''); }   // the file didn't end with a new line: now it does
    else out.splice(k + 1, 0, ...tail);
  }
  return { ok: true, text: out.join('\n') };
}
/** The two pieces to paste, for a Frigate that reads its cameras from a go2rtc outside it (the address shown without its password). */
function frigatePaste({ name, source, ring, stream, host }) {
  const shown = source ? rtspShown(source) : '';
  return {
    go2rtc: stream ? null : ['streams:', `  ${name}:`, `    - "${shown}"`].join('\n'),
    camera: [`  ${name}:`, '    ffmpeg:', ...(ring ? ['      hwaccel_args: []'] : []), '      inputs:', `        - path: rtsp://${host || '127.0.0.1'}:8554/${stream || name}`, '          input_args: preset-rtsp-restream', '          roles:', '            - detect', '            - record'].join('\n'),
    masked: shown !== source && !!source,
  };
}
async function frigateRaw(c) {
  const r = await frigateGet(c, '/api/config/raw'), buf = await readAll(r, 4 * 1024 * 1024);
  if (r.statusCode >= 300) throw Object.assign(new Error(r.statusCode === 401 || r.statusCode === 403 ? 'Frigate turned down CasaTorch\'s sign-in. Check it in Connect.' : 'Frigate didn\'t send its settings file.'), { status: 502 });
  let s = buf.toString('utf8'); try { const j = JSON.parse(s); if (typeof j === 'string') s = j; } catch { /* the file itself */ }
  return s;
}
/** Save Frigate's settings file: 'saveonly' (Frigate checks it and keeps it) or 'restart'. { ok, message }. */
async function frigateSave(c, text, how = 'saveonly') {
  let r; try { r = await frigateGet(c, `/api/config/save?save_option=${how === 'restart' ? 'restart' : 'saveonly'}`, { method: 'POST', raw: text, timeout: 30000, headers: { 'X-CSRF-TOKEN': '1' } }); }
  catch (e) { if (how === 'restart') return { ok: true, message: 'restarting' }; throw e; }   // Frigate closing the connection as it restarts
  const buf = await readAll(r, 256 * 1024).catch(() => Buffer.alloc(0)), t = buf.toString('utf8');
  let j = null; try { j = JSON.parse(t); } catch { /* text */ }
  const message = String((j && (j.message || j.detail)) || t || `HTTP ${r.statusCode}`).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 600);
  return { ok: r.statusCode < 300 && j?.success !== false, message };
}
/* The last five versions of Frigate's file, sealed. */
const frBackups = () => { try { const j = JSON.parse(fs.readFileSync(CA_BACKUPS, 'utf8')); return Array.isArray(j.list) ? j.list : []; } catch { return []; } };
const frBackupsSave = (list) => writeFileSafe(CA_BACKUPS, JSON.stringify({ list: list.slice(-5) }));
const frSrvKey = (c) => sha256(`frigate:${frigateBase(c)}`).slice(0, 16);

/** The owner, with their password typed again (when sign-in is on); answers for itself when not. */
async function caOwner(req, res) {
  if (isDemo()) { res.status(400).json({ error: 'The demo doesn\'t change anything.' }); return false; }
  if (!signInOn()) return true;
  const u = req.user;
  if (!u || u.panel || u.role !== 'owner') { res.status(403).json({ error: 'Only the owner can change Frigate.' }); return false; }
  if (limited(`pw:${u.id}`, 5)) { res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' }); return false; }
  if (!await verifySecretAsync(u.password, String(req.body?.password || ''))) { failed(`pw:${u.id}`); res.status(403).json({ error: 'Your password is not right.' }); return false; }
  return true;
}
const caLimited = (req, res) => { if (overLimit(`frigate-write:${req.user?.id || clientIp(req)}`, 12, 15 * 60_000)) { res.status(429).json({ error: 'That\'s a lot of changes - wait a few minutes.' }); return true; } return false; };
/** Everything about adding one camera: the Frigate, its file, the name, the source. */
async function caAddPlan(dev, typed) {
  if (!/^ha:camera\.\w{1,120}$/.test(String(dev || ''))) throw Object.assign(new Error('That camera isn\'t one Home Assistant has.'), { status: 404 });
  const ent = dev.slice(3), st = (await haStates().catch(() => [])).find((s) => s.entity_id === ent);
  if (!st) throw Object.assign(new Error('That camera isn\'t one Home Assistant has.'), { status: 404 });
  const servers = frigateServers(); if (!servers.length) throw Object.assign(new Error('Connect Frigate first.'), { status: 400 });
  const m = (await camFastMap(true))[ent] || {};
  if (m.frigateCam) throw Object.assign(new Error('Frigate already has this camera.'), { status: 409 });
  const c = servers[m.srv ?? 0] || servers[0];
  const [raw, conf, streams] = await Promise.all([frigateRaw(c), frigateJson(c, '/api/config').catch(() => ({})), frigateJson(c, '/api/go2rtc/streams').catch(() => ({}))]);
  const taken = [...Object.keys(conf?.cameras || {}), ...Object.keys(conf?.go2rtc?.streams || {}), ...Object.keys(streams && typeof streams === 'object' ? streams : {})];
  const display = String(st.attributes?.friendly_name || ent.slice(7)).replace(CAM_TAIL, '').trim().slice(0, 80) || caPretty(ent.slice(7));
  const name = frigateCamName(display, taken, { ring: !!m.ring });
  const stream = m.via === 'frigate' && m.srv === servers.indexOf(c) ? m.main : null;
  const source = stream ? null : (m.rtsp || rtspClean(typed));
  return { ent, c, raw, name, display, ring: !!m.ring, stream, source, knownSource: !!m.rtsp };
}

app.get('/api/camera-auto', async (req, res) => {
  const owner = !signInOn() || (req.user?.role === 'owner' && !req.user.panel), admin = !signInOn() || (['owner', 'admin'].includes(req.user?.role) && !req.user?.panel);
  if (isDemo()) return res.json({ demo: true, auto: true, canEdit: admin, owner, frigate: true, notices: [], offers: [], via: { 'camera:driveway': { via: 'frigate' }, 'camera:garage': { via: 'frigate' } }, undo: null });
  const notices = CA.notices.filter((n) => Date.now() - Date.parse(n.at) < CA_NOTICE_DAYS * 86400_000).map(({ id, dev, name, at }) => ({ id, dev, name, at }));
  const via = {}; for (const [ent, m] of Object.entries(CA.map || {})) via[`ha:${ent}`] = { via: m.via, ...(m.how ? { how: m.how } : {}) };
  for (const c of config.cameras || []) if (c.type === 'frigate') via[`camera:${c.id}`] = { via: 'frigate' };
  let offers = [];
  if (frigateServers().length && config.homeAssistant?.url) {
    const cams = new Map((await houseDevices().catch(() => ({ devices: [] }))).devices.filter((d) => d.kind === 'camera').map((d) => [d.id, d.name]));
    offers = Object.entries(CA.map || {}).filter(([ent, m]) => !m.frigateCam && cams.has(`ha:${ent}`)).map(([ent, m]) => ({ dev: `ha:${ent}`, name: cams.get(`ha:${ent}`), source: !!m.src || m.via === 'frigate' }));
    CA.offers = offers.filter((o) => o.source).length;
    if (!owner) offers = [];
  }
  const b = owner ? frBackups() : [];
  res.json({ auto: camAutoOn(), canEdit: admin, owner, frigate: frigateServers().length > 0, notices, offers, via, undo: b.length ? { count: b.length, at: b[b.length - 1].at, name: b[b.length - 1].name } : null });
});
app.put('/api/settings/cameras', requireRole('admin'), express.json({ limit: '2kb' }), (req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true });
  if (typeof req.body?.showNew !== 'boolean') return res.status(400).json({ error: 'bad setting' });
  saveConfig({ ...config, cameraAuto: { ...(config.cameraAuto || {}), show: req.body.showNew } });
  res.json({ ok: true, auto: camAutoOn() });
});
/* What adding a camera to Frigate would do (nothing is changed). */
app.post('/api/camera-auto/frigate/preview', requireRole('owner'), express.json({ limit: '4kb' }), asyncRoute(async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'The demo doesn\'t change anything.' });
  if (caLimited(req, res)) return;
  try {
    const p = await caAddPlan(req.body?.dev, req.body?.source), shape = frigateYamlShape(p.raw);
    res.json({ name: p.name, display: p.display, mode: shape ? 'paste' : 'insert', needsSource: !p.source && !p.stream, knownSource: p.knownSource, ring: p.ring,
      ...(shape && (p.source || p.stream) ? { snippets: frigatePaste({ ...p, host: shape.host }) } : {}) });
  } catch (e) { res.status(e.status || 502).json({ error: e.status ? e.message : 'Frigate didn\'t answer.' }); }
}));
app.post('/api/camera-auto/frigate/add', requireRole('owner'), express.json({ limit: '4kb' }), asyncRoute(async (req, res) => {
  if (!await caOwner(req, res) || caLimited(req, res)) return;
  try {
    const p = await caAddPlan(req.body?.dev, req.body?.source);
    const r = frigateYamlAdd(p.raw, p);
    if (!r.ok) return res.json({ ok: false, paste: true, name: p.name, snippets: frigatePaste({ ...p, host: r.host }) });
    const list = frBackups(); list.push({ at: nowIso(), srv: frSrvKey(p.c), name: p.name, box: seal(p.raw, 'frigateBackup') }); frBackupsSave(list);
    const sv = await frigateSave(p.c, r.text, 'saveonly');
    if (!sv.ok) { frBackupsSave(frBackups().slice(0, -1)); return res.status(400).json({ error: `Frigate didn't accept the change: ${sv.message}`, msg: 'Frigate didn\'t accept the change: {why}', vars: { why: sv.message } }); }
    CA.added[p.name] = { ent: p.ent, name: p.display, at: nowIso() }; caSave();
    for (const k of [...CACHE.keys()]) if (/^(camauto:map|go2rtc:)/.test(k)) CACHE.delete(k);
    audit(req, 'frigate-camera-added', { device: p.display });
    res.json({ ok: true, name: p.name, restart: true });
  } catch (e) { res.status(e.status || 502).json({ error: e.status ? e.message : 'Frigate didn\'t answer.' }); }
}));
app.post('/api/camera-auto/frigate/restart', requireRole('owner'), express.json({ limit: '2kb' }), asyncRoute(async (req, res) => {
  if (!await caOwner(req, res) || caLimited(req, res)) return;
  const c = frigateServers()[0]; if (!c) return res.status(400).json({ error: 'Connect Frigate first.' });
  try {
    const sv = await frigateSave(c, await frigateRaw(c), 'restart');
    if (!sv.ok) return res.status(400).json({ error: `Frigate didn't accept the change: ${sv.message}`, msg: 'Frigate didn\'t accept the change: {why}', vars: { why: sv.message } });
    audit(req, 'frigate-restarted');
    setTimeout(() => { for (const k of [...CACHE.keys()]) if (/^(camauto:map|go2rtc:)/.test(k)) CACHE.delete(k); camAutoCheck().catch(() => {}); }, 60_000).unref?.();   // its new cameras show up here once it's back
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 502).json({ error: e.status ? e.message : 'Frigate didn\'t answer.' }); }
}));
app.post('/api/camera-auto/frigate/undo', requireRole('owner'), express.json({ limit: '2kb' }), asyncRoute(async (req, res) => {
  if (!await caOwner(req, res) || caLimited(req, res)) return;
  const list = frBackups(), last = list[list.length - 1];
  if (!last) return res.status(404).json({ error: 'There\'s no change to undo.' });
  const c = frigateServers().find((x) => frSrvKey(x) === last.srv); if (!c) return res.status(400).json({ error: 'Connect Frigate first.' });
  const raw = unseal(last.box, 'frigateBackup'); if (raw == null) return res.status(500).json({ error: 'That saved copy can\'t be opened.' });
  try {
    const sv = await frigateSave(c, raw, 'saveonly');
    if (!sv.ok) return res.status(400).json({ error: `Frigate didn't accept the change: ${sv.message}`, msg: 'Frigate didn\'t accept the change: {why}', vars: { why: sv.message } });
    frBackupsSave(list.slice(0, -1)); delete CA.added[last.name]; caSave();
    audit(req, 'frigate-change-undone', { device: last.name });
    res.json({ ok: true, restart: true });
  } catch (e) { res.status(e.status || 502).json({ error: e.status ? e.message : 'Frigate didn\'t answer.' }); }
}));

/* ---- Camera walls ---- */
const CW_LAYOUTS = ['auto', 'big', '2x2', '3x3', '4x4'];
const cwBad = (m) => Object.assign(new Error(m), { status: 400 });
/** Pure: the walls as they may be kept. Throws a plain-words error for anything that isn't a wall. */
function cleanWalls(list) {
  if (!Array.isArray(list)) throw cwBad('Those aren\'t camera walls.');
  if (list.length > 30) throw cwBad('At most 30 camera walls.');
  const ids = new Set();
  return list.map((w) => {
    if (!w || typeof w !== 'object' || Array.isArray(w)) throw cwBad('Those aren\'t camera walls.');
    const name = typeof w.name === 'string' ? w.name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim() : '';
    if (!name || name.length > 40) throw cwBad('Give each wall a name of up to 40 letters.');
    if (w.cams != null && !Array.isArray(w.cams)) throw cwBad('Those aren\'t camera walls.');
    const cams = [...new Set(w.cams || [])];
    if (cams.length > 64 || cams.some((x) => typeof x !== 'string' || !CL_DEV.test(x))) throw cwBad('A wall holds up to 64 cameras.');
    if (w.layout != null && !CW_LAYOUTS.includes(w.layout)) throw cwBad('Pick a layout for the wall.');
    let id = typeof w.id === 'string' && /^[a-z0-9]{6,16}$/.test(w.id) && !ids.has(w.id) ? w.id : crypto.randomBytes(6).toString('hex');
    while (ids.has(id)) id = crypto.randomBytes(6).toString('hex');
    ids.add(id);
    return { id, name, cams, layout: w.layout || 'auto', names: w.names !== false };
  });
}
const CW_DEMO = [{ id: 'demoout01', name: 'Outside', cams: ['camera:driveway', 'camera:backyard', 'camera:garage', 'camera:porch'], layout: '2x2', names: true },
  { id: 'demofront1', name: 'Front of the house', cams: ['camera:doorbell', 'camera:porch', 'camera:driveway'], layout: 'big', names: false }];
let camWalls = [];
try { camWalls = cleanWalls(JSON.parse(fs.readFileSync(CW_FILE, 'utf8')).walls || []); } catch { /* none yet */ }
app.get('/api/camera-walls', (req, res) => res.json({ walls: isDemo() ? CW_DEMO : camWalls, canEdit: !signInOn() || (['owner', 'admin'].includes(req.user?.role) && !req.user?.panel), ...(isDemo() ? { demo: true } : {}) }));
app.put('/api/camera-walls', requireRole('admin'), express.json({ limit: '64kb' }), (req, res) => {
  let walls; try { walls = cleanWalls(req.body?.walls); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (isDemo()) return res.json({ ok: true, demo: true, walls });
  camWalls = walls; writeFileSafe(CW_FILE, JSON.stringify({ walls, at: nowIso() }));
  audit(req, 'camera-walls-changed', { n: walls.length });
  liveNudge();
  res.json({ ok: true, walls });
});

if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchCamAuto = { camBaseName, camMatchKeys, haIsChime, haChimeOf, camAutoDiff, camSources, camMatch, frigateCamName, rtspClean, rtspShown, frigateYamlAdd, frigateYamlShape, frigatePaste, cleanWalls, camDedupe, camKeys, CA, caAddPlan, frigateSave, frigateRaw, frigateServers, cfg: () => config, CACHE };
