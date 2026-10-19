/* ======================================================================
 * Voice assistants (Pro): Settings › Voice assistants.
 *
 *  1. A Matter bridge. Turn it on and CasaTorch shows a pairing QR code and
 *     an 11-digit code; scan it in the Alexa, Google Home, Apple Home or
 *     SmartThings app and the lights, switches, plugs, fans, blinds,
 *     thermostats, sensors and scenes CasaTorch shares show up there, with
 *     their names, both ways in step. The bridge runs in its own process
 *     (src/voice/matter-bridge.mjs), so if Matter can't start (no IPv6, the
 *     port taken, no multicast) the dashboard carries on and Health says why
 *     in plain words.
 *  2. "Ask CasaTorch" from Siri (Apple Shortcuts): a token per phone, made
 *     here and revocable, that opens exactly two doors - /api/voice/ask (the
 *     Home AI Agent's short spoken answer) and /api/voice/do (switching what
 *     the bridge shares). Nothing else answers to it.
 *
 * THE SAFETY RULE, hard-coded here and tested (voice-unit.mjs): locks,
 * garage doors, gates, doors, alarm panels and sirens are never shared with
 * a voice assistant, whatever is picked; a switch, scene or fan whose name
 * says it opens, unlocks or disarms something isn't either; a scene that
 * includes a lock, an alarm or a garage door/gate isn't either. Every
 * command from an assistant is checked again on arrival and goes through
 * the same control path and safety check as a tap in the app (riskOf,
 * 30-devices.js). Voice never unlocks, opens a garage door or gate, or
 * disarms.
 *
 * Files (owner-only, sealed with the box's key): voice.json (choices, the
 * pairing passcode sealed, token hashes - never the tokens) and
 * voice-matter.sealed (matter.js's own keys and pairings).
 * ====================================================================== */
const VOICE_FILE = path.join(DATA_DIR, 'voice.json'), VOICE_STORE_FILE = path.join(DATA_DIR, 'voice-matter.sealed');
const VOICE_CHILD = [path.join(APP_DIR, 'src', 'voice', 'matter-bridge.mjs'), path.join(APP_DIR, 'voice', 'matter-bridge.mjs')];
const VOICE_PORTS = [5540, 5541, 5542, 5543, 5544, 5545, 5546, 5547, 5548, 5549];
const VOICE_MAX = 120, VOICE_ALEXA_MAX = 50;
const VOICE_DEFAULT = { matter: { on: false, picks: {}, roomInName: false, known: {} }, tokens: [] };
let voiceState = null;
function voiceLoad() {
  if (voiceState) return voiceState;
  try { const j = JSON.parse(fs.readFileSync(VOICE_FILE, 'utf8')); voiceState = { ...VOICE_DEFAULT, ...j, matter: { ...VOICE_DEFAULT.matter, ...(j.matter || {}) }, tokens: Array.isArray(j.tokens) ? j.tokens : [] }; }
  catch { voiceState = structuredClone(VOICE_DEFAULT); }
  return voiceState;
}
const voiceSave = () => { if (isDemo()) return; try { writeFileSafe(VOICE_FILE, JSON.stringify(voiceLoad()), 0o600); } catch { /* the data-folder check in Health reports it */ } };

/* ---- what may be shared: the safety rule first ---- */
const VOICE_RISKY_SCENE_ENTITY = /^(lock|alarm_control_panel|siren)\.|^cover\.[^ ]*(garage|gate|door)/i;
/** Why a device is NEVER shared with a voice assistant (a plain sentence), or null. No owner exception for these. */
function voiceNever(d, sceneEntities = null) {
  if (!d) return 'not found';
  const words = `${d.id} ${d.originalName || ''} ${d.name || ''}`;
  if (d.kind === 'lock' || d.domain === 'lock') return 'Locks are never shared with voice assistants.';
  if (d.kind === 'alarm' || d.domain === 'alarm_control_panel') return 'Alarm panels are never shared with voice assistants.';
  if (d.domain === 'siren' || /siren/i.test(d.id)) return 'Sirens are never shared with voice assistants.';
  if (d.kind === 'cover') {
    if (d.risky || RISKY_COVERS.has(d.haClass) || d.domain === 'valve' || !SAFE_COVERS.has(d.haClass) || d.haClass === 'water' || RISKY_NAME.test(words)) return 'Garage doors, gates and doors are never shared with voice assistants - only blinds, shades, curtains and awnings.';
  }
  if (d.kind === 'action') {
    if (d.domain && d.domain !== 'scene') return 'Only scenes can be shared, not scripts or buttons (they could do anything).';
    if (RISKY_NAME.test(words)) return 'This scene\'s name says it opens, unlocks or disarms something, so it is never shared with voice assistants.';
    if (sceneEntities && sceneEntities.some((e) => VOICE_RISKY_SCENE_ENTITY.test(String(e)))) return 'This scene includes a lock, an alarm or a garage door, so it is never shared with voice assistants.';
  }
  if (['switch', 'plug', 'fan'].includes(d.kind) && riskOf(d)) return 'Its name looks like a door, gate, lock or alarm control, so it is never shared with voice assistants. If that\'s a mistake, allow it in Settings › Safety.';
  if (riskOf(d) && d.kind !== 'light') return 'The safety rule holds this one back.';
  return null;
}
/** The Matter item(s) a device becomes (none if it can't be one). Sensors can give several: temperature, humidity... */
function voiceItemsOf(d, { roomInName = false } = {}) {
  const base = String(d.name || d.originalName || d.id).trim(), room = String(d.area || '').trim();
  const name = roomInName && room && !base.toLowerCase().includes(room.toLowerCase()) ? `${room} ${base}` : base;
  const it = (key, type, state, extra = {}) => ({ key, id: d.id, type, name: extra.name || name, room: room || null, online: d.online !== false, state });
  const can = Array.isArray(d.can) ? d.can : [];
  switch (d.kind) {
    case 'light': {
      const type = can.includes('color') ? 'color-light' : can.includes('kelvin') ? 'ct-light' : (can.includes('brightness') || d.brightness != null) ? 'dimmable-light' : 'onoff-light';
      return [it(d.id, type, { on: !!d.on, level: d.brightness ?? null, kelvin: d.kelvin ?? null, rgb: d.rgb ?? null })];
    }
    case 'switch': case 'plug': return [it(d.id, 'plug', { on: !!d.on })];
    case 'fan': return [it(d.id, 'fan', { on: !!d.on, percent: d.percent ?? null })];
    case 'cover': return [it(d.id, 'cover', { open: !!d.open, position: d.position ?? null })];
    case 'climate': return d.domain === 'water_heater' || d.targetC == null ? [] : [it(d.id, 'thermostat', { tempC: d.tempC ?? null, targetC: d.targetC, mode: d.mode || null })];
    case 'action': return [it(d.id, 'scene', { on: false })];
    case 'sensor': {
      if (d.meter || d.pairedTo) return [];
      const out = [], parts = ['tempC', 'humidity', 'open', 'motion', 'water'].filter((k) => d[k] !== undefined && d[k] !== null).length;
      if (d.tempC != null) out.push(it(`${d.id}#temp`, 'temp', { tempC: d.tempC }));
      if (d.humidity != null) out.push(it(`${d.id}#humidity`, 'humidity', { humidity: d.humidity }, parts > 1 ? { name: `${name} humidity` } : {}));
      if (typeof d.open === 'boolean') out.push(it(`${d.id}#contact`, 'contact', { open: d.open }));
      if (typeof d.motion === 'boolean') out.push(it(`${d.id}#occupancy`, 'occupancy', { motion: d.motion }));
      if (typeof d.water === 'boolean') out.push(it(`${d.id}#leak`, 'leak', { water: d.water }));
      return out;
    }
    default: return [];
  }
}
/** Shared unless picked off: lights, switches, plugs, fans, blinds, thermostats, scenes - and sensors that are in a room (or not from Home Assistant). */
function voiceDefaultOn(d) {
  if (d.kind === 'sensor') return !!d.area || d.provider !== 'ha';
  return ['light', 'switch', 'plug', 'fan', 'cover', 'climate', 'action'].includes(d.kind) && !(d.domain === 'automation' || d.domain === 'input_boolean');
}
const VOICE_KIND_ORDER = { light: 0, plug: 1, switch: 1, fan: 2, cover: 3, climate: 4, action: 5, sensor: 6 };
/* Scenes in Home Assistant list what they set: one with a lock, alarm or garage door in it is never shared. */
async function voiceSceneEntities() {
  if (isDemo() || !config.homeAssistant?.url || typeof haStates !== 'function') return {};
  try { return Object.fromEntries((await haStates()).filter((s) => String(s.entity_id).startsWith('scene.')).map((s) => [`ha:${s.entity_id}`, Array.isArray(s.attributes?.entity_id) ? s.attributes.entity_id : []])); } catch { return {}; }
}
/** Every device with what voice does with it: { device, items, never, shared, defaultOn }. */
async function voiceCatalog() {
  const [{ devices }, scenes] = await Promise.all([houseDevices(), voiceSceneEntities()]);
  const st = voiceLoad().matter, picks = st.picks || {};
  const out = [];
  for (const d of devices) {
    const items = voiceItemsOf(d, { roomInName: !!st.roomInName });
    const never = voiceNever(d, scenes[d.id] || null);
    if (!items.length && !never) continue;
    if (!items.length && never && !['lock', 'alarm', 'cover', 'action', 'switch', 'plug', 'fan'].includes(d.kind)) continue;
    const defaultOn = voiceDefaultOn(d), shared = !never && items.length > 0 && (Object.hasOwn(picks, d.id) ? picks[d.id] === true : defaultOn);
    out.push({ device: d, items, never, shared, defaultOn });
  }
  out.sort((a, b) => (VOICE_KIND_ORDER[a.device.kind] ?? 9) - (VOICE_KIND_ORDER[b.device.kind] ?? 9) || String(a.device.name).localeCompare(String(b.device.name)));
  return out;
}
/* The items the bridge gets. A device that is missing for a while (Home Assistant restarting) stays, shown as not
   reachable, for 7 days - so Alexa and the others keep it, its room and its routines instead of seeing a new device. */
async function voiceBridgeItems() {
  const st = voiceLoad().matter, cat = await voiceCatalog(), now = Date.now(), items = [], seen = new Set();
  for (const c of cat) if (c.shared) for (const i of c.items) { if (items.length >= VOICE_MAX) break; items.push(i); seen.add(i.key); }
  const known = st.known ||= {}; let dirty = false;
  for (const i of items) { const k = known[i.key]; if (!k || k.type !== i.type || k.name !== i.name || now - (k.seen || 0) > 6 * 3600_000) { known[i.key] = { id: i.id, type: i.type, name: i.name, seen: now }; dirty = true; } }
  const picks = st.picks || {};
  for (const [key, k] of Object.entries(known)) {
    if (seen.has(key)) continue;
    const stillWanted = picks[k.id] !== false && !cat.some((c) => c.device.id === k.id);   // not picked off, and simply not here right now
    if (stillWanted && now - (k.seen || 0) < 7 * 86400_000 && items.length < VOICE_MAX) items.push({ key, id: k.id, type: k.type, name: k.name, online: false, state: {} });
    else { delete known[key]; dirty = true; }
  }
  if (dirty) voiceSave();
  return items;
}

/* ---- what an assistant may do, per kind (and the safety check again, on arrival) ---- */
const VOICE_ACTIONS = { light: ['on', 'off', 'toggle', 'brightness', 'color', 'kelvin'], switch: ['on', 'off', 'toggle'], plug: ['on', 'off', 'toggle'], fan: ['on', 'off', 'toggle', 'percent'], cover: ['open', 'close', 'stop', 'position'], climate: ['target', 'mode', 'on', 'off'], action: ['run'] };
async function voiceAct(id, action, value, via) {
  const cat = await voiceCatalog(), c = cat.find((x) => x.device.id === id);
  if (!c) throw Object.assign(new Error('That device isn\'t there any more.'), { status: 404 });
  const d = c.device;
  if (c.never) throw Object.assign(new Error(c.never), { status: 403 });
  if (!c.shared) throw Object.assign(new Error(`"${d.name}" isn't shared with voice assistants.`), { status: 403 });
  let act = String(action), val = value;
  if (d.kind === 'cover' && act === 'position' && !(d.can || []).includes('position')) { act = Number(val) >= 50 ? 'open' : 'close'; val = undefined; }   // a blind that only opens and closes
  if (d.kind === 'climate' && act === 'mode' && !(d.modes || []).includes(String(val))) {
    if (val === 'off' && d.domain === 'climate') { act = 'off'; val = undefined; } else if (val === 'auto' && (d.modes || []).includes('heat_cool')) val = 'heat_cool'; else throw Object.assign(new Error('That mode isn\'t one this thermostat has.'), { status: 400 });
  }
  if (!(VOICE_ACTIONS[d.kind] || []).includes(act)) throw Object.assign(new Error('Voice assistants can\'t do that.'), { status: 403 });
  const why = blocked(d, act); if (why) throw Object.assign(new Error(why), { status: 403 });
  if (isDemo()) return { ok: true, demo: true, device: d, action: act };
  const prov = PROVIDERS[id.split(':')[0]];
  if (!prov?.act) throw Object.assign(new Error('That device can\'t be switched from CasaTorch.'), { status: 404 });
  const { devices } = await allDevices(), live = devices.find((x) => x.id === id) || d;
  if (voiceNever(live)) throw Object.assign(new Error(voiceNever(live)), { status: 403 });   // checked on the live device too
  const why2 = blocked(live, act); if (why2) throw Object.assign(new Error(why2), { status: 403 });
  await prov.act(live, act, val);
  CACHE.delete(`dev:${id.split(':')[0]}`);
  audit(null, 'voice-control', { id, action: act, via });
  voiceResyncSoon();
  return { ok: true, device: d, action: act };
}

/* ---- the bridge process ---- */
const VOICE = { child: null, status: { state: 'off' }, error: null, errorCode: null, why: null, startedAt: 0, backoff: 0, restartT: null, syncT: null, lastSent: '', storeT: null, store: null, wait: new Map() };
function voiceStoreLoad() {
  if (VOICE.store) return VOICE.store;
  try { const t = fs.readFileSync(VOICE_STORE_FILE, 'utf8'), j = JSON.parse(unseal(t, 'voice.matter') ?? 'null'); VOICE.store = j && typeof j === 'object' ? j : {}; } catch { VOICE.store = {}; }
  return VOICE.store;
}
function voiceStoreSave() {
  clearTimeout(VOICE.storeT);
  VOICE.storeT = setTimeout(() => { try { writeFileSafe(VOICE_STORE_FILE, seal(JSON.stringify(VOICE.store || {}), 'voice.matter'), 0o600); } catch { /* next change */ } }, 300);
  VOICE.storeT.unref?.();
}
const voiceDigits = (n) => String(n).padStart(8, '0');
const VOICE_BAD_PASSCODES = new Set([0, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888, 99999999, 12345678, 87654321]);
/** The bridge's identity, made once: passcode (sealed), discriminator, serial, unique id. A reset makes a new one. */
function voiceIdentity() {
  const st = voiceLoad().matter;
  let pass = st.passcode ? Number(unseal(st.passcode, 'voice.passcode')) : 0;
  if (!pass || VOICE_BAD_PASSCODES.has(pass)) {
    do pass = crypto.randomInt(1, 99999998); while (VOICE_BAD_PASSCODES.has(pass));
    st.passcode = seal(voiceDigits(pass), 'voice.passcode');
    st.discriminator = crypto.randomInt(0, 4096); st.serial = `CT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; st.uniqueId = crypto.randomBytes(12).toString('hex');
    voiceSave();
  }
  return { passcode: pass, discriminator: Number(st.discriminator) || 0, serial: st.serial, uniqueId: st.uniqueId };
}
const VOICE_ECOSYSTEMS = { 4937: 'Apple Home', 24582: 'Google Home', 4631: 'Amazon Alexa', 4362: 'SmartThings', 4939: 'Home Assistant' };
const voiceFabricName = (f) => VOICE_ECOSYSTEMS[f.vendorId] || (f.label ? f.label : 'Another app');
/* Plain words for why Matter can't run here. */
function voiceExplain(err, code) {
  const s = `${err || ''} ${code || ''}`;
  if (/EAFNOSUPPORT|\{::\}|IPv6|EADDRNOTAVAIL.*::/i.test(s)) return { error: 'Voice assistants can\'t start: IPv6 is turned off on this computer. Matter - what Alexa, Google Home and Apple Home use - needs IPv6 on your home network (IPv6 from your internet provider isn\'t needed).', why: INSTALL === 'docker' ? 'Turn IPv6 on for this computer, and run CasaTorch with host networking (network_mode: host).' : 'Turn IPv6 on in this computer\'s network settings, then turn Voice assistants off and on.' };
  if (/EADDRINUSE/i.test(s)) return { error: 'Voice assistants can\'t start: another program on this computer is using the Matter ports (5540-5549).', why: 'Stop the other Matter program, or run it on a different computer.' };
  if (/EACCES|EPERM|multicast|addMembership/i.test(s)) return { error: 'Voice assistants can\'t start: this computer doesn\'t let CasaTorch announce itself on the network (multicast).', why: INSTALL === 'docker' ? 'Run CasaTorch with host networking (network_mode: host) - Docker\'s own network hides it from your phone and speakers.' : 'Allow CasaTorch through this computer\'s firewall for the local network.' };
  if (/ERR_MODULE_NOT_FOUND|Cannot find (package|module)/i.test(s)) return { error: 'Voice assistants can\'t start: the Matter part of CasaTorch is missing.', why: 'Update or reinstall CasaTorch.' };
  return { error: `Voice assistants stopped: ${String(err || 'the Matter bridge ended').slice(0, 160)}`, why: 'CasaTorch tries again by itself. If it keeps happening, turn Voice assistants off and on.' };
}
const voiceWanted = () => !isDemo() && voiceLoad().matter.on === true && proStatus().pro && process.env.CASATORCH_TEST !== '1';
function voiceSend(m) { try { VOICE.child?.send?.(m); return true; } catch { return false; } }
function voiceAsk(m, ms = 15000) {
  if (!VOICE.child) return Promise.reject(new Error('The bridge isn\'t running.'));
  const id = crypto.randomBytes(6).toString('hex');
  return new Promise((ok, no) => {
    const t = setTimeout(() => { VOICE.wait.delete(id); no(new Error('The bridge didn\'t answer.')); }, ms);
    VOICE.wait.set(id, (r) => { clearTimeout(t); VOICE.wait.delete(id); if (r.ok) ok(r); else no(new Error(r.error || 'That didn\'t work.')); });
    if (!voiceSend({ ...m, id })) { clearTimeout(t); VOICE.wait.delete(id); no(new Error('The bridge isn\'t running.')); }
  });
}
function voiceStart() {
  if (VOICE.child || !voiceWanted()) return;
  const file = VOICE_CHILD.find((f) => fs.existsSync(f));
  if (!file) { Object.assign(VOICE, voiceExplain('Cannot find module matter-bridge'), { status: { state: 'error' } }); return; }
  const st = voiceLoad().matter, id = voiceIdentity(), port = VOICE_PORTS.includes(Number(st.port)) ? Number(st.port) : 5540;
  const child = spawn(process.execPath, ['--max-old-space-size=192', file], {
    cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json',
    env: { PATH: process.env.PATH || '', HOME: DATA_DIR, NODE_ENV: process.env.NODE_ENV || 'production', CASATORCH_MATTER_CHILD: '1', ...(process.env.CASATORCH_MATTER_LOG ? { CASATORCH_MATTER_LOG: process.env.CASATORCH_MATTER_LOG } : {}) },   // nothing else: no keys, tokens or settings reach it
  });
  VOICE.child = child; VOICE.startedAt = Date.now(); VOICE.status = { state: 'starting', port }; VOICE.lastSent = '';
  let lines = 0;
  const log = (b) => { for (const l of String(b).split('\n').filter(Boolean)) if (lines++ < 40) console.warn(`Voice assistants: ${l.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300)}`); };
  child.stdout.on('data', log); child.stderr.on('data', log);
  child.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      const opts = { port, passcode: id.passcode, discriminator: id.discriminator, serial: id.serial, uniqueId: id.uniqueId, name: String(config.house?.name || 'CasaTorch').slice(0, 32), version: VERSION, storageDir: path.join(DATA_DIR, 'matter'), max: VOICE_MAX, iface: process.env.CASATORCH_MATTER_INTERFACE || st.iface || undefined };
      voiceSend({ t: 'start', opts, storage: voiceStoreLoad() });
    } else if (m.t === 'status') {
      VOICE.status = m.status || {}; if (VOICE.status.state === 'ready') { VOICE.error = null; VOICE.why = null; VOICE.errorCode = null; VOICE.backoff = 0; if (st.port !== port) { st.port = port; voiceSave(); } voiceSyncSoon(200); }
    } else if (m.t === 'store') {
      const s = voiceStoreLoad(); if (m.json === null) delete s[m.ns]; else if (typeof m.json === 'string' && m.json.length < 4_000_000) s[String(m.ns).slice(0, 60)] = m.json; voiceStoreSave();
    } else if (m.t === 'cmd') {
      const key = String(m.key || ''), devId = key.split('#')[0];
      voiceAct(devId, String(m.action || ''), m.value, 'matter').catch((err) => { console.warn(`Voice assistants: ${String(err.message).slice(0, 200)}`); voiceResyncSoon(); });
    } else if (m.t === 'fatal') {
      Object.assign(VOICE, voiceExplain(`${m.error || ''} ${m.cause || ''}`, m.code), { errorCode: m.code || null });
      if (/EADDRINUSE/.test(`${m.code} ${m.error}`)) { const i = VOICE_PORTS.indexOf(port); if (i >= 0 && i < VOICE_PORTS.length - 1) { st.port = VOICE_PORTS[i + 1]; voiceSave(); VOICE.backoff = 0; } }
    } else if (m.t === 'done') VOICE.wait.get(m.id)?.(m);
  });
  child.on('exit', (code) => {
    VOICE.child = null; clearTimeout(VOICE.syncT);
    for (const [, f] of VOICE.wait) f({ ok: false, error: 'The bridge stopped.' });
    if (VOICE.resetting) { VOICE.resetting = false; VOICE.status = { state: 'off' }; setTimeout(voiceStart, 300); return; }
    if (!voiceWanted()) { VOICE.status = { state: voiceLoad().matter.on && !proStatus().pro ? 'needs-pro' : 'off' }; return; }
    if (code !== 0 && !VOICE.error) Object.assign(VOICE, voiceExplain(`the bridge ended (code ${code})`));
    VOICE.status = { state: 'error' };
    const ran = Date.now() - VOICE.startedAt; if (ran > 10 * 60_000) VOICE.backoff = 0;
    const wait = [5_000, 30_000, 120_000, 600_000][Math.min(3, VOICE.backoff++)];
    clearTimeout(VOICE.restartT); VOICE.restartPending = true; VOICE.restartT = setTimeout(() => { VOICE.restartPending = false; voiceStart(); }, wait); VOICE.restartT.unref?.();
  });
  child.on('error', (err) => { Object.assign(VOICE, voiceExplain(err.message, err.code)); });
}
function voiceStop() {
  clearTimeout(VOICE.restartT); clearTimeout(VOICE.syncT); VOICE.restartPending = false;
  if (VOICE.child) { voiceSend({ t: 'stop' }); const c = VOICE.child; setTimeout(() => { try { c.kill('SIGTERM'); } catch { /* gone */ } }, 4000).unref?.(); }
  VOICE.status = { state: 'off' }; VOICE.error = null; VOICE.why = null;
}
/* State sync, CasaTorch -> assistants: every few seconds (Home Assistant's live feed keeps the devices current), only when something changed. */
async function voiceSync() {
  clearTimeout(VOICE.syncT);
  if (!VOICE.child || VOICE.status.state !== 'ready') return;
  if (!voiceWanted()) { voiceStop(); return; }
  try {
    const items = await voiceBridgeItems(), text = JSON.stringify(items);
    if (text !== VOICE.lastSent) { VOICE.lastSent = text; voiceSend({ t: 'items', items }); }
  } catch { /* next round */ }
  voiceSyncSoon(4000);
}
function voiceSyncSoon(ms = 4000) { clearTimeout(VOICE.syncT); VOICE.syncT = setTimeout(voiceSync, ms); VOICE.syncT.unref?.(); }
function voiceResyncSoon() { VOICE.lastSent = ''; voiceSyncSoon(1500); }
/* Pro ended or came back, or settings changed elsewhere: check once a minute. */
setInterval(() => { if (voiceWanted() && !VOICE.child && !VOICE.restartPending) voiceStart(); else if (!voiceWanted() && VOICE.child) voiceStop(); }, 60_000).unref?.();
setTimeout(() => { if (voiceWanted()) voiceStart(); }, 4000).unref?.();
process.on('exit', () => { try { VOICE.child?.kill('SIGTERM'); } catch { /* gone */ } if (VOICE.storeT) { try { writeFileSafe(VOICE_STORE_FILE, seal(JSON.stringify(VOICE.store || {}), 'voice.matter'), 0o600); } catch { /* */ } } });

/* ---- Health ---- */
function docVoice() {
  if (!voiceLoad().matter.on || isDemo()) return null;
  const title = 'Voice assistants';
  if (!proStatus().pro) return chk('voice', 'connections', title, 'off', 'Off while Pro is off - your pairings are kept and come back with Pro.');
  const s = VOICE.status || {};
  if (s.state === 'ready') {
    const names = [...new Set((s.fabrics || []).map(voiceFabricName))];
    if (!names.length) return chk('voice', 'connections', title, 'warn', ['Ready to add: {n} devices shared. Scan the code in Settings › Voice assistants with your Alexa, Google Home or Apple Home app.', { n: s.devices || 0 }], { fix: { action: 'link', href: '#settings/voice', label: 'Show the code' } });
    return chk('voice', 'connections', title, 'ok', ['Working with {apps} - {n} devices shared.', { apps: names.join(', '), n: s.devices || 0 }]);
  }
  if (s.state === 'starting') return chk('voice', 'connections', title, 'ok', 'Starting.');
  return chk('voice', 'connections', title, 'bad', VOICE.error || 'Voice assistants aren\'t running.', { why: VOICE.why || null, fix: { action: 'link', href: '#settings/voice', label: 'Open Voice assistants' } });
}
DOC_CONN.voice = docVoice;   // 79-doctor.js: one more connection in Settings › Health

/* ---- Ask CasaTorch tokens: one per phone, only for /api/voice/ask and /api/voice/do ---- */
const VOICE_SCOPES = ['ask', 'do'];
const voiceTokenHash = (tok) => crypto.createHash('sha256').update(`voice:${tok}`).digest('hex');
function voiceTokenCreate({ name, scopes, userId }) {
  const st = voiceLoad();
  if (st.tokens.length >= 20) throw Object.assign(new Error('That\'s 20 already - remove one you don\'t use first.'), { status: 400 });
  const sc = (Array.isArray(scopes) ? scopes : []).filter((s) => VOICE_SCOPES.includes(s));
  if (!sc.length) throw Object.assign(new Error('Pick what this phone may do: ask, switch, or both.'), { status: 400 });
  const token = `ctv_${crypto.randomBytes(30).toString('base64url')}`, rec = { id: crypto.randomBytes(6).toString('hex'), name: String(name || 'My phone').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'My phone', hash: voiceTokenHash(token), scopes: sc, userId: userId || null, created: nowIso(), lastUsed: null };
  st.tokens.push(rec); voiceSave();
  return { token, ...voiceTokenView(rec) };
}
const voiceTokenView = (r) => ({ id: r.id, name: r.name, scopes: r.scopes, created: r.created, lastUsed: r.lastUsed });
const voiceTries = new Map();
function voiceTokenOf(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer (ctv_[A-Za-z0-9_-]{30,80})$/);
  if (!m) return null;
  const h = voiceTokenHash(m[1]);
  return voiceLoad().tokens.find((t) => crypto.timingSafeEqual(Buffer.from(t.hash, 'hex'), Buffer.from(h, 'hex'))) || null;
}
/* The gate: a valid token with this scope, from a person who still exists - or a plain spoken "no". */
const voiceGate = (scope) => (req, res, next) => {
  const ip = clientIp(req), now = Date.now(), tries = (voiceTries.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  if (tries.length >= 20) return voiceSay(req, res, 429, 'Too many tries with a wrong token. Wait 15 minutes.');
  const t = voiceTokenOf(req);
  if (!t) { tries.push(now); voiceTries.set(ip, tries); audit(req, 'voice-token-refused', {}); return voiceSay(req, res, 401, 'CasaTorch didn\'t recognize this phone. Make a new token in Settings, Voice assistants.'); }
  if (!t.scopes.includes(scope)) return voiceSay(req, res, 403, scope === 'do' ? 'This phone may ask questions, but not switch things.' : 'This phone may switch things, but not ask questions.');
  const u = t.userId && typeof userById === 'function' ? userById(t.userId) : null;
  if (signInOn() && !u) return voiceSay(req, res, 401, t.userId ? 'The person who made this token isn\'t on this CasaTorch any more.' : 'Sign-in was turned on after this token was made. Make a new token in Settings, Voice assistants.');
  if (signInOn() && u && scope === 'do' && rank(u.role) < rank('member')) return voiceSay(req, res, 403, 'The person who made this token may not switch things any more.');   // made by an admin who is now a viewer
  if (!proStatus().pro) return voiceSay(req, res, 402, 'Voice assistants are part of CasaTorch Pro.');
  const per = (VOICE_RATE.get(t.id) || []).filter((x) => now - x < 60_000); if (per.length >= 15) return voiceSay(req, res, 429, 'That\'s a lot of questions - wait a minute.');
  per.push(now); VOICE_RATE.set(t.id, per);
  if (!t.lastUsed || now - Date.parse(t.lastUsed) > 3600_000) { t.lastUsed = nowIso(); voiceSave(); }
  req.voiceToken = t; req.voiceUser = u || null;
  next();
};
const VOICE_RATE = new Map();
/* Siri speaks the body: plain text by default, JSON when asked for. */
function voiceSay(req, res, status, text, extra = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (/application\/json/.test(String(req.headers.accept || ''))) return res.status(status).json({ speech: text, ok: status < 400, ...extra });
  return res.status(status).type('text/plain; charset=utf-8').send(text);
}
OPEN.push(/^\/api\/voice\/(ask|do)$/);   // 08-signin.js: these answer to a voice token instead of a sign-in (checked in voiceGate)

/* ---- "Turn off the kitchen lights": a few plain commands, without the AI ---- */
const VOICE_NEVER_WORDS = /\b(unlock|lock|garage|gate|door|disarm|alarm|deadbolt|opener)\b/i;
function voiceParse(text) {
  let s = String(text || '').toLowerCase().normalize('NFKC').replace(/[.!?,;"]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(hey |ok |okay )?(casatorch[, ]*)?(please |can you |could you |would you )?/, '').replace(/ please$/, '').trim();
  let m;
  if ((m = s.match(/^(unlock|disarm) (?:the |my )?(.+)$/))) return { action: m[1], target: m[2].trim() };
  if ((m = s.match(/^(open|close|raise|lower) (?:the |my |all (?:the )?)?(.+)$/))) return { action: m[1] === 'raise' ? 'open' : m[1] === 'lower' ? 'close' : m[1], target: m[2].trim() };
  if ((m = s.match(/^(?:turn|switch|put) (on|off) (?:the |my |all (?:of )?the |all )?(.+)$/)) || (m = s.match(/^(?:turn|switch|put) (?:the |my )?(.+?) (on|off)$/))) {
    const [action, target] = m[1] === 'on' || m[1] === 'off' ? [m[1], m[2]] : [m[2], m[1]];
    return { action, target: target.trim(), all: /^all\b|\ball (?:the )?lights\b/.test(s) || /^(?:turn|switch) (?:on|off) all/.test(s) };
  }
  if ((m = s.match(/^(?:dim|set|turn|put) (?:the |my )?(.+?) (?:to|at) (\d{1,3}) ?(?:%|percent)$/))) return { action: 'brightness', target: m[1].trim(), value: Math.max(1, Math.min(100, Number(m[2]))) };
  if ((m = s.match(/^(?:set )?(?:the )?(.+?) (?:to|at) (\d{2,3}(?:\.\d)?) ?(?:degrees?|°)?(?: ?(f|c|fahrenheit|celsius))?$/)) && /thermostat|heat|temperature|heating|cooling|ac\b|air/.test(m[1])) return { action: 'target', target: m[1].trim(), value: Number(m[2]), unit: m[3] ? m[3][0] : null };
  if ((m = s.match(/^(?:run|start|activate|turn on) (?:the )?(?:scene )?(.+?)(?: scene)?$/))) return { action: 'run', target: m[1].trim() };
  return null;
}
const voiceNorm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** The devices a command means, among the ones shared with voice: an exact name, "<room> lights", "all lights", a name that contains it. */
function voiceMatch(cat, cmd) {
  const list = cat.filter((c) => c.shared), t = voiceNorm(cmd.target).replace(/^the /, '');
  const want = ['open', 'close'].includes(cmd.action) ? ['cover'] : cmd.action === 'run' ? ['action'] : cmd.action === 'target' ? ['climate'] : cmd.action === 'brightness' ? ['light'] : ['light', 'switch', 'plug', 'fan', 'action'];
  const pool = list.filter((c) => want.includes(c.device.kind)), name = (c) => voiceNorm(c.device.name), room = (c) => voiceNorm(c.device.area);
  const exact = pool.filter((c) => name(c) === t || `${room(c)} ${name(c)}`.trim() === t); if (exact.length) return exact.slice(0, 1);
  const plural = t.match(/^(?:(.+?) )?(lights?|lamps?|plugs?|switches|fans?|blinds|shades|curtains)$/);
  if (plural) {
    const kind = /^light|^lamp/.test(plural[2]) ? ['light'] : /^plug/.test(plural[2]) ? ['plug'] : /^switch/.test(plural[2]) ? ['switch'] : /^(blinds|shades|curtains)$/.test(plural[2]) ? ['cover'] : ['fan'], r = (plural[1] || '').replace(/^(all|all the|the)$/, '').replace(/^all (the )?/, '').trim();
    const hits = pool.filter((c) => kind.includes(c.device.kind) && (!r || room(c) === r || room(c).includes(r) || name(c).includes(r)));
    if (hits.length && (r || cmd.all || cmd.action === 'off' || kind[0] === 'cover')) return hits.slice(0, 40);
  }
  const part = pool.filter((c) => name(c).includes(t) || (t.includes(name(c)) && name(c).length > 2));
  if (part.length <= 1) return part;
  const inRoom = part.filter((c) => room(c) && t.includes(room(c)));
  if (inRoom.length === 1) return inRoom;
  return Object.assign([], { ambiguous: part.slice(0, 3).map((c) => c.device.name) });
}
async function voiceCommand(text, via) {
  const cmd = voiceParse(text); if (!cmd) return null;
  if (['unlock', 'disarm'].includes(cmd.action) || VOICE_NEVER_WORDS.test(cmd.target)) return { done: false, speech: 'CasaTorch never unlocks doors, opens garage doors or gates, or disarms alarms by voice. Use that device\'s own app.' };
  const cat = await voiceCatalog(), hits = voiceMatch(cat, cmd);
  if (hits.ambiguous) return { done: false, speech: `Which one: ${hits.ambiguous.join(', ')}? Say the full name.` };
  if (!hits.length) { const never = cat.find((c) => c.never && voiceNorm(c.device.name).includes(voiceNorm(cmd.target))); return { done: false, speech: never ? never.never : `I couldn't find "${String(cmd.target).slice(0, 60)}" among the devices shared with voice assistants.` }; }
  let value = cmd.value;
  if (cmd.action === 'target') { const unit = cmd.unit || (config.house?.units || 'F').toLowerCase(); value = unit === 'f' ? Math.round(((value - 32) * 5 / 9) * 10) / 10 : value; }
  const act = cmd.action === 'run' && hits[0].device.kind !== 'action' ? 'on' : cmd.action;
  const done = [], failed = [];
  for (const c of hits) { try { await voiceAct(c.device.id, act, value, via); done.push(c.device.name); } catch (err) { failed.push(`${c.device.name}: ${err.message}`); } }
  if (!done.length) return { done: false, speech: failed[0] || 'That didn\'t work.' };
  const what = done.length === 1 ? done[0] : `${done.length} ${hits[0].device.kind === 'light' ? 'lights' : 'devices'}`;
  const speech = act === 'on' || act === 'off' ? `Done - ${what} ${done.length === 1 ? 'is' : 'are'} ${act}.` : act === 'open' || act === 'close' ? `Done - ${what} ${act === 'open' ? 'opening' : 'closing'}.` : act === 'run' ? `Done - ${what} is running.` : act === 'brightness' ? `Done - ${what} at ${value} percent.` : `Done - ${what} set to ${cmd.value} degrees.`;
  return { done: true, speech: failed.length ? `${speech} ${failed.length} didn't switch.` : speech, devices: done };
}

/* The Home AI Agent, as the person who made the token, for a voice: a short spoken answer. The full answer
   (charts, tables, buttons) is kept in that person's Home AI Agent chats. */
const voiceSpeech = (ans) => {
  const md = (ans.blocks || []).filter((b) => b.type === 'md').map((b) => b.text).join(' ');
  let s = md.replace(/\*\*|__|`|#+ /g, '').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1').replace(/^\s*[-*•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  if (s.length > 480) { const cut = s.slice(0, 480), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! ')); s = end > 120 ? cut.slice(0, end + 1) : `${cut.trim()}...`; }
  return s || 'I looked, but couldn\'t put an answer together - try asking another way.';
};
async function voiceAskAgent(q, u, lang) {
  const pick = askProvider(); if (!pick) return { status: 409, speech: 'Connect an AI first, in CasaTorch Settings, Connections and AI.' };
  let tok = null, cookie = null;
  if (signInOn() && u) {   // a session for this one question, gone when it's answered
    tok = crypto.randomBytes(32).toString('base64url');
    sessions[sha256(tok)] = { id: newId(), userId: u.id, kind: 'voice', mfa: true, created: nowIso(), seen: nowIso(), expires: new Date(Date.now() + 5 * 60_000).toISOString(), ip: '127.0.0.1', agent: 'Ask CasaTorch (voice)' };
    cookie = `casatorch_session=${tok}`;
  }
  try {
    const ctx = { port: PORT, cookie, auth: null, user: u || null, share: askShare(), webMode: pick.sample ? 'off' : askWebMode(), lang: ASK_LANG_NAMES[lang] ? lang : (config.house?.lang || 'en') };
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 45_000);
    let out; try { out = await askRun({ p: pick.p, c: pick.c, question: `${q}\n\n(Asked by voice: answer in one or two short spoken sentences, plain words only - no lists, tables, charts or links.)`, ctx, signal: ac.signal }); } finally { clearTimeout(timer); }
    const { devices } = await houseDevices().catch(() => ({ devices: [] }));
    const ans = { ...askParse(out.text, { devices, webSources: out.webSources, used: out.used }), raw: out.text };
    try { askRemember({ user: u || null }, null, q, ans); } catch { /* chats are a bonus */ }
    return { status: 200, speech: voiceSpeech(ans) };
  } catch (err) {
    return { status: 502, speech: `${pick.p.name || 'The AI'} didn't answer: ${String(err.message || err).slice(0, 120)}` };
  } finally { if (tok) delete sessions[sha256(tok)]; }
}
const voiceText = (req) => String(req.body?.question ?? req.body?.q ?? req.body?.text ?? req.body?.say ?? (typeof req.body === 'string' ? req.body : '') ?? '').trim().slice(0, 500);
const voiceBody = [express.json({ limit: '8kb' }), express.text({ limit: '8kb', type: 'text/*' })];
app.post('/api/voice/ask', voiceBody, voiceGate('ask'), async (req, res) => {
  const q = voiceText(req); if (!q) return voiceSay(req, res, 400, 'Ask me something about your home.');
  if (req.voiceToken.scopes.includes('do')) { const c = await voiceCommand(q, 'siri').catch(() => null); if (c) return voiceSay(req, res, 200, c.speech, { done: c.done }); }
  else if (voiceParse(q)) return voiceSay(req, res, 403, 'This phone may ask questions, but not switch things.');
  const r = await voiceAskAgent(q, req.voiceUser, req.body?.lang);
  return voiceSay(req, res, r.status, r.speech);
});
app.post('/api/voice/do', voiceBody, voiceGate('do'), async (req, res) => {
  try {
    if (req.body?.device && req.body?.action) {   // { device: "Kitchen light" or its id, action: "on" | "off" | ... }
      const cat = await voiceCatalog(), q = voiceNorm(req.body.device), c = cat.find((x) => x.device.id === req.body.device) || cat.find((x) => voiceNorm(x.device.name) === q);
      if (!c) return voiceSay(req, res, 404, `I couldn't find "${String(req.body.device).slice(0, 60)}".`);
      const r = await voiceAct(c.device.id, String(req.body.action), req.body.value, 'siri');
      return voiceSay(req, res, 200, `Done - ${r.device.name}.`, { done: true });
    }
    const c = await voiceCommand(voiceText(req), 'siri');
    if (!c) return voiceSay(req, res, 400, 'Try "turn off the kitchen lights" or "turn on the porch light".');
    return voiceSay(req, res, c.done ? 200 : 403, c.speech, { done: c.done });
  } catch (err) { return voiceSay(req, res, err.status || 502, String(err.message || 'That didn\'t work.')); }
});

/* ---- Settings › Voice assistants (admins) ---- */
const voiceAddresses = () => {
  const out = [];
  if (LOCAL_TLS.url) out.push({ where: 'home', url: LOCAL_TLS.url.replace(/\/$/, '') });
  const ip = typeof lanAddress === 'function' ? lanAddress() : null; if (ip) out.push({ where: 'home-plain', url: `http://${ip}:${PORT}` });
  if (config.remote?.on && config.remote?.hostname) out.push({ where: 'anywhere', url: `https://${config.remote.hostname}` });
  return out;
};
async function voiceView() {
  const st = voiceLoad(), m = st.matter, s = VOICE.status || {}, pro = proStatus();
  let qr = null;
  const pairing = isDemo() ? { manual: '34970112332', qr: 'MT:Y.K9042C00KA0648G00', sample: true } : s.pairing || null;
  if (pairing) { try { qr = await QRCode.toString(pairing.qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch { /* the 11 digits still work */ } }
  const manual = pairing ? `${pairing.manual.slice(0, 4)}-${pairing.manual.slice(4, 7)}-${pairing.manual.slice(7)}` : null;
  const fabrics = isDemo() ? [] : (s.fabrics || []).map((f) => ({ index: f.index, name: voiceFabricName(f), label: f.label || null }));
  return {
    pro: pro.pro, demo: isDemo(), on: !!m.on, roomInName: !!m.roomInName,
    state: isDemo() ? 'demo' : m.on && !pro.pro ? 'needs-pro' : s.state || 'off', error: VOICE.error, why: VOICE.why,
    commissioned: !!s.commissioned, fabrics, pairing: pairing ? { manual, qr, sample: !!pairing.sample, until: s.windowUntil || null } : null,
    devices: s.devices ?? null, port: s.port || m.port || 5540, alexaMax: VOICE_ALEXA_MAX, max: VOICE_MAX,
    tokens: st.tokens.map(voiceTokenView), addresses: voiceAddresses(), install: INSTALL,
  };
}
const voiceAdmin = [requireRole('admin')];
const voiceRoute = (fn) => async (req, res) => { try { res.setHeader('Cache-Control', 'no-store'); res.json(await fn(req)); } catch (err) { res.status(err.status || 400).json({ error: String(err.message || err) }); } };
const voiceNoDemo = () => { if (isDemo()) throw Object.assign(new Error('This is the demo: voice assistants are shown, but nothing is saved.'), { status: 409 }); };
app.get('/api/settings/voice', voiceAdmin, voiceRoute(() => voiceView()));
app.put('/api/settings/voice', voiceAdmin, express.json({ limit: '4kb' }), voiceRoute(async (req) => {
  voiceNoDemo();
  const m = voiceLoad().matter, b = req.body || {};
  if (typeof b.roomInName === 'boolean') { m.roomInName = b.roomInName; VOICE.lastSent = ''; }
  if (typeof b.on === 'boolean' && b.on !== m.on) {
    if (b.on && !proStatus().pro) throw Object.assign(new Error('Voice assistants are part of CasaTorch Pro.'), { status: 402 });
    m.on = b.on; audit(req, b.on ? 'voice-on' : 'voice-off');
  }
  voiceSave();
  if (m.on) { VOICE.backoff = 0; clearTimeout(VOICE.restartT); VOICE.restartPending = false; voiceStart(); voiceResyncSoon(); } else voiceStop();
  for (let i = 0; i < 20 && m.on && VOICE.status.state === 'starting'; i++) await sleep(250);   // the code is usually there in a second or two
  return voiceView();
}));
app.get('/api/settings/voice/devices', voiceAdmin, voiceRoute(async () => {
  const cat = await voiceCatalog();
  return { devices: cat.map((c) => ({ id: c.device.id, name: c.device.name, room: c.device.area || null, kind: c.device.kind, shared: c.shared, never: c.never, defaultOn: c.defaultOn, parts: c.items.map((i) => i.type) })), alexaMax: VOICE_ALEXA_MAX, max: VOICE_MAX };
}));
app.put('/api/settings/voice/devices', voiceAdmin, express.json({ limit: '64kb' }), voiceRoute(async (req) => {
  voiceNoDemo();
  const m = voiceLoad().matter, list = Array.isArray(req.body?.changes) ? req.body.changes.slice(0, 500) : [{ id: req.body?.id, shared: req.body?.shared }];
  for (const c of list) { const id = String(c?.id || '').slice(0, 200); if (!id) continue; if (c.shared === null) delete m.picks[id]; else m.picks[id] = c.shared === true; }
  voiceSave(); voiceResyncSoon(); audit(req, 'voice-devices', { n: list.length });
  return { ok: true };
}));
app.post('/api/settings/voice/pair', voiceAdmin, voiceRoute(async (req) => { voiceNoDemo(); await voiceAsk({ t: 'pair', minutes: 15 }); await sleep(150); audit(req, 'voice-pairing-opened'); return voiceView(); }));
app.delete('/api/settings/voice/fabrics/:index', voiceAdmin, voiceRoute(async (req) => { voiceNoDemo(); await voiceAsk({ t: 'remove-fabric', index: Number(req.params.index) }); await sleep(150); audit(req, 'voice-app-removed', { index: Number(req.params.index) }); return voiceView(); }));
app.post('/api/settings/voice/reset', voiceAdmin, express.json({ limit: '2kb' }), voiceRoute(async (req) => {
  voiceNoDemo();
  if (req.body?.confirm !== true) throw Object.assign(new Error('Confirm the reset first.'), { status: 400 });
  if (VOICE.child) { VOICE.resetting = true; await voiceAsk({ t: 'reset' }, 20000).catch(() => {}); }
  VOICE.store = {}; try { fs.rmSync(VOICE_STORE_FILE, { force: true }); } catch { /* */ }
  const m = voiceLoad().matter; delete m.passcode; m.known = {}; voiceIdentity();   // a new code and identity
  audit(req, 'voice-reset');
  if (!VOICE.child && m.on) setTimeout(voiceStart, 300);
  for (let i = 0; i < 24; i++) { await sleep(250); if (!m.on || VOICE.status.state === 'ready') break; }
  return voiceView();
}));
app.post('/api/settings/voice/tokens', voiceAdmin, express.json({ limit: '4kb' }), voiceRoute(async (req) => {
  voiceNoDemo();
  if (!proStatus().pro) throw Object.assign(new Error('Voice assistants are part of CasaTorch Pro.'), { status: 402 });
  const r = voiceTokenCreate({ name: req.body?.name, scopes: req.body?.scopes, userId: req.user?.id || null });
  audit(req, 'voice-token-made', { name: r.name, scopes: r.scopes.join(',') });
  return r;   // the token itself: shown this once, never again (only its hash is kept)
}));
app.delete('/api/settings/voice/tokens/:id', voiceAdmin, voiceRoute(async (req) => {
  voiceNoDemo();
  const st = voiceLoad(), i = st.tokens.findIndex((t) => t.id === req.params.id);
  if (i >= 0) { audit(req, 'voice-token-removed', { name: st.tokens[i].name }); st.tokens.splice(i, 1); voiceSave(); }
  return { ok: true };
}));
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchVoice = { voiceNever, voiceItemsOf, voiceDefaultOn, voiceCatalog, voiceBridgeItems, voiceAct, voiceParse, voiceMatch, voiceCommand, voiceTokenCreate, voiceTokenOf, voiceExplain, voiceSpeech, voiceLoad, voiceIdentity, docVoice, VOICE_ACTIONS, VOICE };
