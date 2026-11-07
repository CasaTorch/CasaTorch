/* ======================================================================
 * Home Assistant, when it is connected: EVERY entity becomes a device
 * CasaTorch can show - lights, switches, fans, covers, media, climate, locks,
 * cameras, scenes, scripts, buttons, vacuums, alarms, people, and every
 * sensor (power, energy, temperature, humidity, battery, or any value).
 * The things that are safe to switch can be switched from the dashboard;
 * unlocking, opening garage doors and disarming alarms stay in Home Assistant.
 * ====================================================================== */
async function haStates() {
  const h = config.homeAssistant; if (!h?.url) return [];
  const live = haLiveStates(); if (live) return live;   // the websocket keeps them current (34-live.js)
  return (await cached('ha:states', 8_000, async () => ({ list: await getJSON(`${h.url}/api/states`, { headers: { Authorization: `Bearer ${h.token}` } }) }))).list || [];
}
/* Home Assistant reports temperatures in its own unit system; CasaTorch keeps Celsius inside. */
const haC = (v, unit) => { if (v == null || v === '' || Number.isNaN(Number(v))) return null; const f = unit ? /F/.test(unit) : config.house?.units === 'F'; return f ? Math.round((Number(v) - 32) * 5 / 9 * 10) / 10 : Number(v); };
const HA_SKIP = new Set(['zone', 'sun', 'persistent_notification', 'tts', 'stt', 'conversation', 'event', 'wake_word', 'assist_satellite', 'tag', 'image', 'notify', 'ai_task', 'calendar']);   // to-do lists (todo.*) come through: their items are in Family › Lists (79c-family.js)
const RISKY_COVERS = new Set(['garage', 'gate', 'door']);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
/* Smart plugs show up in Home Assistant as a switch plus separate sensors (switch.kitchen_kettle,
   sensor.kitchen_kettle_power, sensor.kitchen_kettle_today_s_consumption...). Put the watts and today's
   kWh on the switch itself, so the plug is one device that knows it is on and what it is pulling. */
function haPairPlugs(list) {
  const key = (d) => d.id.split('.').slice(1).join('.');
  const sensors = list.filter((d) => d.domain === 'sensor');
  for (const sw of list.filter((d) => d.domain === 'switch')) {
    const k = key(sw), mine = sensors.filter((x) => key(x).startsWith(`${k}_`));
    const p = mine.find((x) => x.powerW != null);
    const e = mine.find((x) => x.kind === 'value' && /kwh/i.test(x.unit || '') && /today|daily|day/.test(key(x))) || mine.find((x) => x.kind === 'value' && /kwh/i.test(x.unit || ''));
    if (p) { Object.assign(sw, { powerW: sw.on ? p.powerW : 0, kind: 'plug' }); p.pairedTo = sw.id; }   // the sensor stays a sensor, but isn't counted twice
    if (e && num(e.value) != null) sw.energyKWh = num(e.value);
  }
  return list;
}
/* What a device can do beyond on/off, from Home Assistant's supported_features bits and color modes. */
const haBits = (f, map) => Object.entries(map).filter(([, b]) => (Number(f) || 0) & b).map(([k]) => k);
function haLightCan(a) {
  const m = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
  const can = [...(m.some((x) => x !== 'onoff') || a.brightness != null ? ['brightness'] : []), ...(m.some((x) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(x)) ? ['color'] : []), ...(m.includes('color_temp') ? ['kelvin'] : [])];
  return { can, ...(can.includes('kelvin') ? { minK: a.min_color_temp_kelvin ?? 2000, maxK: a.max_color_temp_kelvin ?? 6500 } : {}) };
}
function haDevice(s) {
  const [domain] = s.entity_id.split('.'), a = s.attributes || {};
  if (HA_SKIP.has(domain) || a.hidden) return null;
  const name = String(a.friendly_name || s.entity_id.split('.')[1].replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())).slice(0, 120), on = s.state === 'on', cls = a.device_class || null, unit = a.unit_of_measurement || null;
  const base = { id: `ha:${s.entity_id}`, provider: 'ha', domain, haClass: cls, name, state: s.state, online: !['unavailable', 'unknown'].includes(s.state) || domain === 'sensor' };
  switch (domain) {
    case 'light': return { ...base, kind: 'light', on, brightness: a.brightness != null ? Math.round(a.brightness / 2.55) : null, rgb: Array.isArray(a.rgb_color) && a.rgb_color.length === 3 ? `#${a.rgb_color.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('')}` : null, kelvin: a.color_temp_kelvin ?? null, ...haLightCan(a) };
    case 'switch': return { ...base, kind: cls === 'outlet' ? 'plug' : 'switch', on };
    case 'input_boolean': case 'automation': case 'siren': case 'humidifier': return { ...base, kind: 'switch', on };
    case 'fan': return { ...base, kind: 'fan', on, percent: a.percentage ?? null, can: a.percentage != null || (a.supported_features & 1) ? ['percent'] : [] };
    case 'media_player': return { ...base, kind: 'media', on: !['off', 'standby', 'unavailable'].includes(s.state), playing: s.state === 'playing', title: [a.media_artist, a.media_title].filter(Boolean).join(' - ') || null, volume: a.volume_level ?? null, can: haBits(a.supported_features, { volume: 4, prev: 16, next: 32 }) };
    case 'climate': case 'water_heater': return { ...base, kind: 'climate', mode: s.state, tempC: haC(a.current_temperature), targetC: haC(a.temperature), humidity: a.current_humidity ?? null,
      modes: domain === 'climate' && Array.isArray(a.hvac_modes) ? a.hvac_modes.map(String).slice(0, 8) : null, minC: haC(a.min_temp), maxC: haC(a.max_temp), stepC: a.target_temp_step && config.house?.units !== 'F' ? Number(a.target_temp_step) : 0.5,
      can: a.temperature != null ? ['target', ...(domain === 'climate' && a.hvac_modes?.length ? ['mode'] : [])] : domain === 'climate' && a.hvac_modes?.length ? ['mode'] : [] };
    case 'lock': return { ...base, kind: 'lock', locked: s.state === 'locked' };
    case 'camera': return { ...base, kind: 'camera', source: 'Home Assistant', snapshot: `/api/ha/camera/${encodeURIComponent(s.entity_id)}`, stream: `/api/ha/camera/${encodeURIComponent(s.entity_id)}/live`, every: 3000 };
    case 'cover': case 'valve': return { ...base, kind: 'cover', open: ['open', 'opening'].includes(s.state), position: a.current_position ?? null, risky: RISKY_COVERS.has(cls), can: domain === 'cover' && (a.supported_features & 4) ? ['position'] : [] };
    case 'scene': case 'script': case 'button': case 'input_button': return { ...base, kind: 'action' };
    case 'vacuum': case 'lawn_mower': return { ...base, kind: 'vacuum' };
    case 'alarm_control_panel': return { ...base, kind: 'alarm', armed: /^armed/.test(s.state), triggered: s.state === 'triggered', can: haBits(a.supported_features ?? 3, { arm_home: 1, arm_away: 2, arm_night: 4 }) };
    case 'person': case 'device_tracker': return { ...base, kind: 'presence', home: s.state === 'home', online: true };
    case 'todo': return { ...base, kind: 'value', value: s.state, unit: 'to do', list: true, online: !['unavailable', 'unknown'].includes(s.state) };   // a to-do list: its state is how many are still to do
    case 'binary_sensor': {
      const map = { moisture: 'water', door: 'open', window: 'open', garage_door: 'open', opening: 'open', motion: 'motion', occupancy: 'motion', presence: 'motion', smoke: 'smoke', gas: 'smoke', carbon_monoxide: 'smoke' };
      return { ...base, kind: 'sensor', ...(map[cls] ? { [map[cls]]: on } : { on }), ...(map[cls] === 'motion' && s.last_changed ? { changedAt: s.last_changed } : {}) };
    }
    case 'sensor': {
      if (cls === 'power' || unit === 'W' || unit === 'kW') return { ...base, kind: 'sensor', powerW: num(s.state) == null ? null : num(s.state) * (unit === 'kW' ? 1000 : unit === 'MW' ? 1e6 : 1), meter: true, online: num(s.state) != null };   // 'unavailable' is unknown, not 0 W
      if (cls === 'temperature') return { ...base, kind: 'sensor', tempC: haC(s.state, unit) };
      if (cls === 'humidity') return { ...base, kind: 'sensor', humidity: num(s.state) };
      if (cls === 'carbon_dioxide' || (unit === 'ppm' && /co2|carbon.?dioxide/i.test(`${s.entity_id} ${name}`))) return { ...base, kind: 'sensor', co2: num(s.state) };
      if (cls === 'battery') return { ...base, kind: 'sensor', battery: num(s.state) };
      return { ...base, kind: 'value', value: s.state, unit };
    }
    default: return { ...base, kind: 'value', value: s.state, unit };
  }
}
const HA_SERVICES = {
  light: { on: 'turn_on', off: 'turn_off', toggle: 'toggle', brightness: 'turn_on' },
  switch: { on: 'turn_on', off: 'turn_off', toggle: 'toggle' }, input_boolean: { on: 'turn_on', off: 'turn_off', toggle: 'toggle' }, automation: { on: 'turn_on', off: 'turn_off', toggle: 'toggle' },
  siren: { on: 'turn_on', off: 'turn_off', toggle: 'toggle' }, humidifier: { on: 'turn_on', off: 'turn_off', toggle: 'toggle' }, fan: { on: 'turn_on', off: 'turn_off', toggle: 'toggle' },
  media_player: { toggle: 'media_play_pause', play: 'media_play', pause: 'media_pause', next: 'media_next_track', on: 'turn_on', off: 'turn_off' },
  cover: { open: 'open_cover', close: 'close_cover', stop: 'stop_cover', toggle: 'toggle' }, valve: { open: 'open_valve', close: 'close_valve', stop: 'stop_valve', toggle: 'toggle' },
  scene: { run: 'turn_on' }, script: { run: 'turn_on' }, button: { run: 'press' }, input_button: { run: 'press' },
  vacuum: { start: 'start', dock: 'return_to_base', stop: 'stop' }, lawn_mower: { start: 'start_mowing', dock: 'dock', stop: 'pause' },
  lock: { lock: 'lock' },
  climate: { target: 'set_temperature', mode: 'set_hvac_mode', on: 'turn_on', off: 'turn_off' }, water_heater: { target: 'set_temperature' },
  alarm_control_panel: { arm_home: 'alarm_arm_home', arm_away: 'alarm_arm_away', arm_night: 'alarm_arm_night' },   // never disarm
};
Object.assign(HA_SERVICES.light, { color: 'turn_on', kelvin: 'turn_on' });
Object.assign(HA_SERVICES.fan, { percent: 'set_percentage' });
Object.assign(HA_SERVICES.media_player, { volume: 'volume_set', prev: 'media_previous_track' });
Object.assign(HA_SERVICES.cover, { position: 'set_cover_position' });
/* The service data for actions that carry a value - checked here, so nothing odd reaches Home Assistant. */
const clampN = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error('that value isn\'t a number'); return Math.max(lo, Math.min(hi, n)); };
function haServiceData(d, action, value) {
  switch (action) {
    case 'brightness': return { brightness_pct: Math.round(clampN(value, 1, 100)) };
    case 'color': { if (!/^#[0-9a-f]{6}$/i.test(String(value))) throw new Error('color must look like #ffaa00'); const v = String(value); return { rgb_color: [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) }; }
    case 'kelvin': return { color_temp_kelvin: Math.round(clampN(value, 1500, 9000)) };
    case 'percent': return { percentage: Math.round(clampN(value, 0, 100)) };
    case 'volume': return { volume_level: Math.round(clampN(value, 0, 100)) / 100 };
    case 'position': return { position: Math.round(clampN(value, 0, 100)) };
    case 'target': { const c = clampN(value, 0, 90); return { temperature: config.house?.units === 'F' ? Math.round((c * 9 / 5 + 32) * 2) / 2 : Math.round(c * 2) / 2 }; }   // value in °C; Home Assistant wants its own unit
    case 'mode': { const m = String(value); if (!(d.modes || []).includes(m)) throw new Error('that mode isn\'t one this device has'); return { hvac_mode: m }; }
    default: return {};
  }
}
/* Home Assistant areas (Living room, Kitchen...): which room each entity is in, so every room can be a
   widget of its own. One template call; areas change rarely, so it is kept for five minutes. */
const HA_AREA_TEMPLATE = `{% set ns = namespace(out=[]) %}{% for a in areas() %}{% set n = namespace(ids=area_entities(a) | list) %}{% for d in area_devices(a) %}{% set n.ids = n.ids + (device_entities(d) | list) %}{% endfor %}{% set ns.out = ns.out + [{'name': area_name(a), 'ids': n.ids | unique | list}] %}{% endfor %}{{ ns.out | tojson }}`;
async function haAreas() {
  const h = config.homeAssistant; if (!h?.url) return {};
  try {
    return await cached('ha:areas', 300_000, async () => {
      const r = await fetch(`${h.url}/api/template`, { method: 'POST', headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ template: HA_AREA_TEMPLATE }), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const map = {};
      for (const a of JSON.parse(await r.text())) for (const id of a.ids || []) map[id] ||= String(a.name);
      return map;
    });
  } catch { return {}; }   // older Home Assistant or no areas: entities just have no room
}
/* Which Home Assistant device each entity belongs to, so one car or one plug with five sensors is one
   row (not five with the same name) where devices are listed for placing. Kept for five minutes too. */
const HA_DEV_TEMPLATE = `{% for s in states %}{% set d = device_id(s.entity_id) %}{% if d %}{{ s.entity_id }}={{ d }};{% endif %}{% endfor %}`;
async function haDevIds() {
  const h = config.homeAssistant; if (!h?.url) return {};
  try {
    return await cached('ha:devids', 300_000, async () => {
      const r = await fetch(`${h.url}/api/template`, { method: 'POST', headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ template: HA_DEV_TEMPLATE }), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const map = {};
      for (const pair of (await r.text()).split(';')) { const [e, d] = pair.split('='); if (/^[a-z_]+\.[\w-]+$/.test(e || '') && /^[\w-]{6,64}$/.test(d || '')) map[e] = d; }
      return map;
    });
  } catch { return {}; }
}
/* Ring Chime and Chime Pro are plug-in speakers that ring when someone presses the doorbell - not cameras. Some setups
   still give one a camera entity (ring-mqtt, a camera made from the Ring account, a name Home Assistant reused), and
   then it must never count or show as a camera: not in camera counts, the Cameras and Security pages, camera walls,
   the 3D home's camera views or "New camera" notices. It shows as a chime instead. Known by its Home Assistant device
   model ("Chime", "Chime Pro"), the kind of device the integration names, or - for a camera entity with no video, or
   one from Ring - "chime" in its name. Pure. */
const CHIME_WORD = /(?:^|[\s_.-])chime(?:[\s_-]*pro)?(?:[\s_-]*v?\d)?(?:$|[\s_.-])/i;
function haIsChime(s, model = '') {
  const a = s?.attributes || {};
  if (/\bchime\b/i.test(String(model || ''))) return true;
  if (/\bchime/i.test(String(a.device_type || a.model || ''))) return true;
  if (!CHIME_WORD.test(`${s?.entity_id || ''} ${a.friendly_name || ''}`)) return false;
  const ring = /\bring\b/i.test(String(a.attribution || '')) || /^camera\.ring_/i.test(String(s?.entity_id || ''));
  return ring || !((Number(a.supported_features) || 0) & 2);
}
/* The Home Assistant device model of each camera entity (for haIsChime), asked once every five minutes. */
const HA_CAM_MODEL_TEMPLATE = `{% for s in states.camera %}{{ s.entity_id }}={{ (device_attr(s.entity_id, 'model') or '') | replace(';', ' ') | replace('=', ' ') }};{% endfor %}`;
async function haCamModels() {
  const h = config.homeAssistant; if (!h?.url) return {};
  try {
    return await cached('ha:cammodels', 300_000, async () => {
      const r = await fetch(`${h.url}/api/template`, { method: 'POST', headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ template: HA_CAM_MODEL_TEMPLATE }), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const map = {};
      for (const pair of (await r.text()).split(';')) { const i = pair.indexOf('='), e = pair.slice(0, i).trim(); if (i > 0 && /^camera\.\w{1,120}$/.test(e)) map[e] = pair.slice(i + 1).trim().slice(0, 80); }
      return map;
    });
  } catch { return {}; }
}
/* ---- The safety rule for things that act on other things ----
   A scene, a group or a script can unlock a door, open a garage door or gate, or disarm an alarm without saying so in
   its name ("Leaving", "Good night", a switch group "Outside" with the garage relay in it). So what each one touches
   is looked at: a scene's and a group's members (Home Assistant lists them), and a script's own steps (asked from
   Home Assistant, every scene and script it calls followed too). Each gets a level that riskOf (30-devices.js) uses:
     'sure'    - it can unlock, open a garage door, gate or door, or disarm: never run from CasaTorch, no exception;
     'name'    - it switches something whose name looks like a door, gate, lock or alarm control: held, an owner may allow it;
     'unknown' - CasaTorch couldn't read what it does (a template, a blueprint, Home Assistant didn't say): held the same way.
   A step that reaches "everything", an area, a floor, a label or a whole device that can't be resolved counts as reaching
   whatever is there. Running a script asks Home Assistant again first (haSafetyNow), so an edit made a moment ago counts. */
const HA_ALWAYS_BAD = /^(lock\.(unlock|open)|alarm_control_panel\.alarm_disarm)$/;
const HA_SAFE_WAY = /^(lock\.lock|cover\.(close_cover|stop_cover|close_cover_tilt|stop_cover_tilt|open_cover_tilt|set_cover_tilt_position)|alarm_control_panel\.alarm_(arm_[a-z_]+|trigger)|valve\.(close_valve|stop_valve))$/;
const HA_SWEEP_DOMAINS = new Set(['homeassistant', 'cover', 'lock', 'alarm_control_panel', 'switch', 'button', 'input_boolean', 'input_button', 'fan']);
const HA_SWEEP_SURE = new Set(['homeassistant', 'cover', 'lock', 'alarm_control_panel']);   // these can reach a garage door, a lock or an alarm wherever they sweep
const HA_SWEEP_KEYS = ['area_id', 'device_id', 'floor_id', 'label_id'];
const HA_LEVEL = { name: 1, unknown: 2, sure: 3 };
const haWorse = (a, b) => ((HA_LEVEL[b] || 0) > (HA_LEVEL[a] || 0) ? b : a);
const haIds = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
const haTemplated = (v) => /[{}%]/.test(typeof v === 'string' ? v : JSON.stringify(v ?? ''));
/** How risky one entity is to switch on, run or open: 'sure' | 'name' | 'unknown' | null.
    dev: its device here (or undefined: hidden in Home Assistant); level: the level found for scenes, scripts and groups. Pure. */
function haEntityRisk(ent, dev, level = () => null) {
  const e = String(ent || '').toLowerCase(), dom = e.split('.')[0];
  if (dom === 'lock' || dom === 'alarm_control_panel') return 'sure';
  if (dom === 'cover') {
    if (!dev) return RISKY_NAME.test(e) ? 'sure' : 'unknown';
    if (dev.risky || RISKY_COVERS.has(dev.haClass)) return 'sure';
    return riskOf({ ...dev, safety: null }) ? 'name' : null;
  }
  if (['scene', 'script', 'group', 'switch', 'light', 'fan', 'input_boolean', 'button', 'input_button'].includes(dom)) {
    const own = level(e); if (own) return own;
    if (dom === 'light' || dom === 'scene' || dom === 'script' || dom === 'group') return null;
    if (!dev) return RISKY_NAME.test(e) ? 'name' : null;
    return riskOf({ ...dev, safety: null }) ? 'name' : null;
  }
  return null;
}
/** What a script's steps can do, at worst: 'sure' | 'name' | 'unknown' | null. look(entity) rates one entity (haEntityRisk);
    devEnts(deviceId) lists a Home Assistant device's entities (or null when unknown). Pure. */
function haActionRisk(cfg, look, devEnts = () => null) {
  let worst = null;
  const bump = (lv) => { worst = haWorse(worst, lv); };
  const rateAll = (ents) => { for (const e of ents) bump(look(e)); };
  const walk = (o, depth) => {
    if (worst === 'sure') return;
    if (depth > 60) { bump('unknown'); return; }
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (!o || typeof o !== 'object') return;
    if (o.use_blueprint || o.service_template != null) bump('unknown');
    const svc = typeof o.service === 'string' ? o.service : typeof o.action === 'string' && o.action.includes('.') ? o.action : null;
    if (svc) {
      const s = svc.trim().toLowerCase(), [dom, verb = ''] = s.split('.');
      if (haTemplated(s)) bump('unknown');
      else {
        const tg = o.target && typeof o.target === 'object' ? o.target : {}, data = o.data && typeof o.data === 'object' ? o.data : {};
        const ents = [...haIds(o.entity_id), ...haIds(tg.entity_id), ...haIds(data.entity_id)];
        const devs = [...haIds(o.device_id), ...haIds(tg.device_id), ...haIds(data.device_id)];
        const fuzzy = ents.includes('all') || ents.some(haTemplated) || [o.target, o.data].some((x) => typeof x === 'string') || HA_SWEEP_KEYS.some((k) => k !== 'device_id' && (o[k] != null || tg[k] != null || data[k] != null));
        const devList = devs.map((d) => devEnts(d));
        if (HA_ALWAYS_BAD.test(s)) bump('sure');
        else if (!HA_SAFE_WAY.test(s)) {
          if (dom === 'script' && !['turn_on', 'turn_off', 'toggle', 'reload'].includes(verb)) bump(look(s));   // script.night_mode: runs that script
          if (verb !== 'turn_off') rateAll(ents.filter((e) => e !== 'all' && !haTemplated(e)));
          if (verb !== 'turn_off') for (const l of devList) { if (l) rateAll(l); else if (HA_SWEEP_DOMAINS.has(dom)) bump(HA_SWEEP_SURE.has(dom) ? 'sure' : 'unknown'); }
          if (fuzzy && HA_SWEEP_DOMAINS.has(dom) && verb !== 'turn_off') bump(HA_SWEEP_SURE.has(dom) ? 'sure' : 'unknown');
          if (dom === 'scene' && (verb === 'apply' || verb === 'create') && data.entities && typeof data.entities === 'object') rateAll(Object.keys(data.entities).map((k) => k.toLowerCase()));
          if (dom === 'scene' && (verb === 'apply' || verb === 'create') && haTemplated(data.entities)) bump('unknown');
        }
      }
    } else if (typeof o.device_id === 'string' && typeof o.domain === 'string' && typeof o.type === 'string' && o.condition == null && o.trigger == null && o.platform == null) {
      const dom = o.domain.toLowerCase(), type = o.type.toLowerCase();   // a device action ("Unlock Front door" picked in the script editor)
      if (dom === 'lock' && type !== 'lock') bump('sure');
      else if (dom === 'alarm_control_panel' && !/^(arm_[a-z_]+|trigger)$/.test(type)) bump('sure');
      else if (dom === 'cover' && /^(open|set_position|toggle)$/.test(type)) bump(o.entity_id ? look(String(o.entity_id).toLowerCase()) || null : 'sure');
      else if (/^(turn_on|toggle|press)$/.test(type)) { const l = o.entity_id ? [String(o.entity_id).toLowerCase()] : devEnts(o.device_id.toLowerCase()); if (l) rateAll(l); else bump('unknown'); }
    }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && k !== 'target' && k !== 'data') walk(v, depth + 1);
  };
  try { walk(cfg, 0); } catch { return 'unknown'; }
  return worst;
}
/** Levels for every scene, group and script, from Home Assistant's states and the scripts' steps. Pure.
    states: Home Assistant states; devs: our devices; scripts: { 'script.x': steps | null (couldn't read) }; devIds: entity -> device. */
function haSafetyLevels(states, devs, scripts = {}, devIds = {}) {
  const byId = new Map((devs || []).map((d) => [d.id, d])), members = new Map(), levels = new Map(), byDev = new Map();
  for (const [e, d] of Object.entries(devIds || {})) { if (!byDev.has(d)) byDev.set(d, []); byDev.get(d).push(e); }
  for (const s of states || []) {
    const e = String(s?.entity_id || '').toLowerCase(), dom = e.split('.')[0];
    if (dom !== 'light' && Array.isArray(s?.attributes?.entity_id)) members.set(e, s.attributes.entity_id.slice(0, 500).map((x) => String(x).toLowerCase()));
  }
  const look = (e) => haEntityRisk(e, byId.get(`ha:${e}`), (x) => levels.get(x) || null);
  const devEnts = (d) => byDev.get(d) || null;
  for (let round = 0; round < 6; round++) {   // a scene in a script in a script: until nothing changes
    let changed = false;
    for (const [e, list] of members) { let lv = null; for (const m of list) if (m !== e) lv = haWorse(lv, look(m)); if (lv !== (levels.get(e) || null)) { levels.set(e, lv); changed = true; } }
    for (const s of states || []) {
      const e = String(s?.entity_id || '').toLowerCase(); if (!e.startsWith('script.')) continue;
      const cfg = Object.hasOwn(scripts || {}, e) ? scripts[e] : null;
      const lv = cfg && typeof cfg === 'object' ? haActionRisk(cfg, (x) => (x === e ? null : look(x)), devEnts) : 'unknown';
      if (lv !== (levels.get(e) || null)) { levels.set(e, lv); changed = true; }
    }
    if (!changed) break;
  }
  return levels;
}
/** Each script's steps, from Home Assistant's websocket ("script/config"): { entity: steps | null }. Kept a minute. */
async function haScriptConfigs(ents, { fresh = false } = {}) {
  const list = [...new Set(ents)].filter((e) => /^script\.[\w-]{1,200}$/.test(e)).slice(0, 300); if (!list.length) return {};
  const key = `ha:scriptcfg:${crypto.createHash('sha1').update(list.join(',')).digest('base64url').slice(0, 12)}`;
  if (fresh) CACHE.delete(key);
  try {
    return await cached(key, 60_000, async () => {
      const h = config.homeAssistant;
      const res = await famHaWs(list.map((entity_id) => ({ type: 'script/config', entity_id })), { url: h?.url, token: h?.token, timeout: 4000 });
      return Object.fromEntries(list.map((e, i) => [e, res[i]?.ok && res[i].result?.config && typeof res[i].result.config === 'object' ? res[i].result.config : null]));
    });
  } catch { return {}; }
}
/** Marks the devices that act on other things with their level (d.safety), for riskOf. */
function haSafetyMark(list, states, scripts, devIds) {
  const levels = haSafetyLevels(states, list, scripts, devIds);
  for (const d of list) { const lv = levels.get(d.id.slice(3).toLowerCase()); if (lv) d.safety = lv; }
  return list;
}
/** Right before a scene, script or group runs: its level from what Home Assistant says this second. */
async function haSafetyNow(ent) {
  const states = await haStates();
  const scripts = await haScriptConfigs(states.map((s) => s.entity_id).filter((e) => /^script\./.test(e)), { fresh: true });
  const devs = haPairPlugs(states.map(haDevice).filter(Boolean));
  return haSafetyLevels(states, devs, scripts, await haDevIds()).get(String(ent).toLowerCase()) || null;
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchHaSafety = { haActionRisk, haEntityRisk, haSafetyLevels, haSafetyMark };
/** A camera entity that is really a chime becomes one (the snapshot and stream addresses go). Pure. */
function haChimeOf(d) { const { snapshot: _s, stream: _l, every: _e, liveVia: _v, ...rest } = d; return { ...rest, kind: 'chime', chime: true }; }
PROVIDERS.ha = {
  async list() {
    const [states, areas, devs, models] = await Promise.all([haStates(), haAreas(), haDevIds(), haCamModels()]);
    const scripts = await haScriptConfigs(states.map((s) => s.entity_id).filter((e) => /^script\./.test(e)));
    const byEnt = new Map(states.map((s) => [s.entity_id, s]));
    const list = haPairPlugs(states.map(haDevice).filter(Boolean)).map((d) => (d.kind === 'camera' && haIsChime(byEnt.get(d.id.slice(3)), models[d.id.slice(3)]) ? haChimeOf(d) : d));
    const fast = camMapNow();   // cameras Frigate's go2rtc also has: live video through it (29h-camauto.js)
    for (const d of list) { const a = areas[d.id.slice(3)]; if (a) d.area = a; const g = devs[d.id.slice(3)]; if (g) d.dev = g; if (d.kind === 'camera' && fast[d.id.slice(3)]?.via === 'frigate') d.liveVia = 'frigate'; }
    return haSafetyMark(list, states, scripts, devs);
  },
  async act(d, action, value) {
    const h = config.homeAssistant, ent = d.id.slice(3), domain = ent.split('.')[0];
    if (d.risky && ['open', 'toggle'].includes(action)) throw new Error('opening garage doors and gates stays in Home Assistant');
    const svc = HA_SERVICES[domain]?.[action];
    if (svc && domain === 'script') {   // a script's steps are asked again this second (scenes and groups: the device list already has their members as they are now)
      const lv = await haSafetyNow(ent).catch(() => 'unknown');
      const why = lv && blocked({ ...d, safety: lv }, action); if (why) throw Object.assign(new Error(why), { status: 403 });
    }
    if (!svc) throw new Error(`can't ${action} a ${domain}`);
    const body = { entity_id: ent, ...haServiceData(d, action, value) };
    await getJSON(`${h.url}/api/services/${domain}/${svc}`, { method: 'POST', headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },
};
/* Home Assistant cameras: live video through HA's MJPEG proxy (works for most cameras HA has: Reolink, UniFi
   Protect, Nest, Ring and more), passed through so the token stays on the box. */
app.get('/api/ha/camera/:entity/live', async (req, res) => {
  const h = config.homeAssistant, ent = String(req.params.entity);
  if (!h?.url || !/^camera\.[\w]+$/.test(ent)) return res.status(404).end();
  if (!(await haStates().catch(() => [])).some((x) => x.entity_id === ent)) return res.status(404).end();
  return mjpegPass(req, res, `ha:${ent}`, `${h.url}/api/camera_proxy_stream/${ent}`, { Authorization: `Bearer ${h.token}` });
});
/* Ready pictures for Home Assistant's cameras soon after start-up, so the first look is never blank. */
setTimeout(async () => {
  const h = config.homeAssistant; if (isDemo() || !h?.url) return;
  for (const st of (await haStates().catch(() => [])).filter((x) => /^camera\./.test(x.entity_id) && !haIsChime(x)).slice(0, 24)) snapRefresh(snapEntry(`ha:${st.entity_id}`, () => haCameraPicture(st.entity_id), 'ha'));
}, 4000).unref?.();
async function haProxyPicture(ent) {
  const h = config.homeAssistant;
  const r = await fetch(`${h.url}/api/camera_proxy/${ent}`, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Home Assistant answered ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error('Home Assistant sent an empty picture');
  return { buf, type: r.headers.get('content-type') || 'image/jpeg' };
}
/* A camera's picture, from wherever it can be had. Home Assistant's own picture first; when that fails (a Ring
   "Live view" camera has none until someone watches it, a camera that is asleep or briefly gone), the same camera
   another way: the same camera's other entity in Home Assistant (Ring and ring-mqtt both list it: "_snapshot"),
   a frame from its go2rtc stream through Frigate, or Ring itself when it is connected here. Ways that wake a camera
   (a Ring stream, a battery camera) are asked at most once a minute per camera. Only this box's own connections are
   used, with the same sign-ins as always; nothing new is sent anywhere. */
/** The same camera's other entities in Home Assistant (never a chime, never one that is unavailable), "_snapshot" ones
    first: ring-mqtt's snapshot entity has a picture when the Ring integration's "Live view" has none. Pure. */
function haPicTwins(ent, states) {
  const base = camBaseName(ent); if (base.length < 3) return [];
  return states.filter((s) => s.entity_id !== ent && /^camera\.\w{1,120}$/.test(s.entity_id) && !haIsChime(s) && s.state !== 'unavailable' && camBaseName(s.entity_id) === base)
    .map((s) => s.entity_id).sort((a, b) => (/_snapshot$/.test(b) ? 1 : 0) - (/_snapshot$/.test(a) ? 1 : 0) || a.localeCompare(b));
}
/** Try the ways in turn - the one that worked last time first - and remember the one that works. */
async function haPicFirst(ent, tries) {
  const last = HA_PIC_WAY.get(ent), order = last ? [...tries.filter(([w]) => w === last), ...tries.filter(([w]) => w !== last)] : tries;
  let first = null;
  for (const [way, fn] of order) { try { const pic = await fn(); HA_PIC_WAY.set(ent, way); return pic; } catch (e) { first ||= e; } }
  throw first || new Error('no picture');
}
const HA_PIC_SLOW = new Map();   // entity -> when a waking way was last used
const HA_PIC_WAY = new Map();    // entity -> the way that worked last time, tried first next time
async function haCameraPicture(ent) {
  const tries = [], base = camBaseName(ent), key = camMatchKeys(ent).key;
  tries.push(['ha', () => haProxyPicture(ent)]);
  for (const id of haPicTwins(ent, await haStates().catch(() => []))) tries.push([`twin:${id}`, () => haProxyPicture(id)]);
  const slow = (fn) => async () => {
    if (Date.now() - (HA_PIC_SLOW.get(ent) || 0) < 60_000) throw new Error('asked a moment ago');
    HA_PIC_SLOW.set(ent, Date.now()); return fn();
  };
  tries.push(['go2rtc', slow(async () => {
    const fast = typeof camFastFor === 'function' ? await camFastFor(ent).catch(() => null) : null;
    if (!fast) throw new Error('no stream');
    const r = await frigateGet(fast.c, `/api/go2rtc/api/frame.jpeg?src=${encodeURIComponent(fast.sub || fast.main)}`);
    const buf = await readAll(r, 20 * 1024 * 1024);
    if (r.statusCode >= 300 || buf.length < 200) throw new Error(`go2rtc answered ${r.statusCode}`);
    return { buf, type: r.headers['content-type'] || 'image/jpeg' };
  })]);
  if (typeof ring !== 'undefined' && ring.cameras?.length && key) {
    const rc = ring.cameras.find((c) => camMatchKeys(c.name).key === key || camBaseName(c.name) === base);
    if (rc) tries.push(['ring', slow(async () => ({ buf: await rc.getSnapshot(), type: 'image/jpeg' }))]);
  }
  return haPicFirst(ent, tries);
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchHaPic = { haPicTwins, haPicFirst, HA_PIC_WAY };
/* Home Assistant cameras: a still picture through HA's camera proxy (the token stays on the box). */
app.get('/api/ha/camera/:entity', async (req, res) => {
  const h = config.homeAssistant, ent = String(req.params.entity);
  if (!h?.url || !/^camera\.[\w]+$/.test(ent)) return res.status(404).end();
  if (!SNAP.has(`ha:${ent}`) && !(await haStates().catch(() => [])).some((s) => s.entity_id === ent)) return res.status(404).end();   // only cameras Home Assistant really has
  return sendSnap(req, res, `ha:${ent}`, () => haCameraPicture(ent), 'ha');
});
