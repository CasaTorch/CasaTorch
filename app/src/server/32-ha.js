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
PROVIDERS.ha = {
  async list() {
    const [states, areas, devs] = await Promise.all([haStates(), haAreas(), haDevIds()]);
    const list = haPairPlugs(states.map(haDevice).filter(Boolean));
    for (const d of list) { const a = areas[d.id.slice(3)]; if (a) d.area = a; const g = devs[d.id.slice(3)]; if (g) d.dev = g; }
    return list;
  },
  async act(d, action, value) {
    const h = config.homeAssistant, ent = d.id.slice(3), domain = ent.split('.')[0];
    if (d.risky && ['open', 'toggle'].includes(action)) throw new Error('opening garage doors and gates stays in Home Assistant');
    const svc = HA_SERVICES[domain]?.[action];
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
  for (const st of (await haStates().catch(() => [])).filter((x) => /^camera\./.test(x.entity_id)).slice(0, 24)) snapRefresh(snapEntry(`ha:${st.entity_id}`, () => haCameraPicture(st.entity_id), 'ha'));
}, 4000).unref?.();
async function haCameraPicture(ent) {
  const h = config.homeAssistant;
  const r = await fetch(`${h.url}/api/camera_proxy/${ent}`, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Home Assistant answered ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' };
}
/* Home Assistant cameras: a still picture through HA's camera proxy (the token stays on the box). */
app.get('/api/ha/camera/:entity', async (req, res) => {
  const h = config.homeAssistant, ent = String(req.params.entity);
  if (!h?.url || !/^camera\.[\w]+$/.test(ent)) return res.status(404).end();
  if (!SNAP.has(`ha:${ent}`) && !(await haStates().catch(() => [])).some((s) => s.entity_id === ent)) return res.status(404).end();   // only cameras Home Assistant really has
  return sendSnap(req, res, `ha:${ent}`, () => haCameraPicture(ent), 'ha');
});
