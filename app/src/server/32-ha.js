/* ======================================================================
 * Home Assistant, when it is connected: EVERY entity becomes a device
 * HouseOS can show - lights, switches, fans, covers, media, climate, locks,
 * cameras, scenes, scripts, buttons, vacuums, alarms, people, and every
 * sensor (power, energy, temperature, humidity, battery, or any value).
 * The things that are safe to switch can be switched from the dashboard;
 * unlocking, opening garage doors and disarming alarms stay in Home Assistant.
 * ====================================================================== */
async function haStates() {
  const h = config.homeAssistant; if (!h?.url) return [];
  return (await cached('ha:states', 8_000, async () => ({ list: await getJSON(`${h.url}/api/states`, { headers: { Authorization: `Bearer ${h.token}` } }) }))).list || [];
}
/* Home Assistant reports temperatures in its own unit system; HouseOS keeps Celsius inside. */
const haC = (v, unit) => { if (v == null || v === '' || Number.isNaN(Number(v))) return null; const f = unit ? /F/.test(unit) : config.house?.units === 'F'; return f ? Math.round((Number(v) - 32) * 5 / 9 * 10) / 10 : Number(v); };
const HA_SKIP = new Set(['zone', 'sun', 'persistent_notification', 'tts', 'stt', 'conversation', 'event', 'wake_word', 'assist_satellite', 'tag', 'image', 'notify', 'ai_task', 'todo', 'calendar']);
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
    if (p) Object.assign(sw, { powerW: sw.on ? p.powerW : 0, kind: 'plug' });
    if (e && num(e.value) != null) sw.energyKWh = num(e.value);
  }
  return list;
}
function haDevice(s) {
  const [domain] = s.entity_id.split('.'), a = s.attributes || {};
  if (HA_SKIP.has(domain) || a.hidden) return null;
  const name = a.friendly_name || s.entity_id, on = s.state === 'on', cls = a.device_class || null, unit = a.unit_of_measurement || null;
  const base = { id: `ha:${s.entity_id}`, provider: 'ha', domain, haClass: cls, name, state: s.state, online: !['unavailable', 'unknown'].includes(s.state) || domain === 'sensor' };
  switch (domain) {
    case 'light': return { ...base, kind: 'light', on, brightness: a.brightness != null ? Math.round(a.brightness / 2.55) : null };
    case 'switch': return { ...base, kind: cls === 'outlet' ? 'plug' : 'switch', on };
    case 'input_boolean': case 'automation': case 'siren': case 'humidifier': return { ...base, kind: 'switch', on };
    case 'fan': return { ...base, kind: 'fan', on, percent: a.percentage ?? null };
    case 'media_player': return { ...base, kind: 'media', on: !['off', 'standby', 'unavailable'].includes(s.state), playing: s.state === 'playing', title: [a.media_artist, a.media_title].filter(Boolean).join(' - ') || null, volume: a.volume_level ?? null };
    case 'climate': case 'water_heater': return { ...base, kind: 'climate', mode: s.state, tempC: haC(a.current_temperature), targetC: haC(a.temperature), humidity: a.current_humidity ?? null };
    case 'lock': return { ...base, kind: 'lock', locked: s.state === 'locked' };
    case 'camera': return { ...base, kind: 'camera', source: 'Home Assistant' };
    case 'cover': case 'valve': return { ...base, kind: 'cover', open: ['open', 'opening'].includes(s.state), position: a.current_position ?? null, risky: RISKY_COVERS.has(cls) };
    case 'scene': case 'script': case 'button': case 'input_button': return { ...base, kind: 'action' };
    case 'vacuum': case 'lawn_mower': return { ...base, kind: 'vacuum' };
    case 'alarm_control_panel': return { ...base, kind: 'alarm', armed: /^armed/.test(s.state), triggered: s.state === 'triggered' };
    case 'person': case 'device_tracker': return { ...base, kind: 'presence', home: s.state === 'home', online: true };
    case 'binary_sensor': {
      const map = { moisture: 'water', door: 'open', window: 'open', garage_door: 'open', opening: 'open', motion: 'motion', occupancy: 'motion', presence: 'motion', smoke: 'smoke', gas: 'smoke', carbon_monoxide: 'smoke' };
      return { ...base, kind: 'sensor', ...(map[cls] ? { [map[cls]]: on } : { on }) };
    }
    case 'sensor': {
      if (cls === 'power' || unit === 'W' || unit === 'kW') return { ...base, kind: 'sensor', powerW: (num(s.state) || 0) * (unit === 'kW' ? 1000 : 1), meter: true };
      if (cls === 'temperature') return { ...base, kind: 'sensor', tempC: haC(s.state, unit) };
      if (cls === 'humidity') return { ...base, kind: 'sensor', humidity: num(s.state) };
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
  cover: { open: 'open_cover', close: 'close_cover', stop: 'stop_cover', toggle: 'toggle' }, valve: { open: 'open_valve', close: 'close_valve', toggle: 'toggle' },
  scene: { run: 'turn_on' }, script: { run: 'turn_on' }, button: { run: 'press' }, input_button: { run: 'press' },
  vacuum: { start: 'start', dock: 'return_to_base', stop: 'stop' }, lawn_mower: { start: 'start_mowing', dock: 'dock' },
  lock: { lock: 'lock' },
};
PROVIDERS.ha = {
  async list() { return haPairPlugs((await haStates()).map(haDevice).filter(Boolean)); },
  async act(d, action, value) {
    const h = config.homeAssistant, ent = d.id.slice(3), domain = ent.split('.')[0];
    if (d.risky && ['open', 'toggle'].includes(action)) throw new Error('opening garage doors and gates stays in Home Assistant');
    const svc = HA_SERVICES[domain]?.[action];
    if (!svc) throw new Error(`can't ${action} a ${domain}`);
    const body = { entity_id: ent, ...(action === 'brightness' ? { brightness_pct: Math.max(1, Math.min(100, Number(value))) } : {}) };
    await getJSON(`${h.url}/api/services/${domain}/${svc}`, { method: 'POST', headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },
};
/* Home Assistant cameras: a still picture through HA's camera proxy (the token stays on the box). */
app.get('/api/ha/camera/:entity', async (req, res) => {
  const h = config.homeAssistant, ent = String(req.params.entity);
  if (!h?.url || !/^camera\.[\w]+$/.test(ent)) return res.status(404).end();
  try {
    const r = await fetch(`${h.url}/api/camera_proxy/${ent}`, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(502).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg'); res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch { res.status(502).end(); }
});
