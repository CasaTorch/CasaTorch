/* ======================================================================
 * Home Assistant, when it is connected: its entities become devices like any
 * other (lights on, music playing, power used, doors, temperatures), and the
 * dashboard and the floor plan can switch lights, play/pause and so on.
 * ====================================================================== */
async function haStates() {
  const h = config.homeAssistant; if (!h?.url) return [];
  return (await cached('ha:states', 8_000, async () => ({ list: await getJSON(`${h.url}/api/states`, { headers: { Authorization: `Bearer ${h.token}` } }) }))).list || [];
}
/* Home Assistant reports climate in its own unit system; HouseOS keeps Celsius inside. */
const haC = (v) => (v == null ? null : config.house?.units === 'F' ? Math.round((Number(v) - 32) * 5 / 9 * 10) / 10 : Number(v));
function haDevice(s) {
  const [domain] = s.entity_id.split('.'), a = s.attributes || {}, name = a.friendly_name || s.entity_id, on = s.state === 'on';
  const base = { id: `ha:${s.entity_id}`, provider: 'ha', name, online: s.state !== 'unavailable' };
  if (domain === 'light') return { ...base, kind: 'light', on, brightness: a.brightness != null ? Math.round(a.brightness / 2.55) : null };
  if (domain === 'switch') return { ...base, kind: 'plug', on };
  if (domain === 'media_player') return { ...base, kind: 'media', on: s.state !== 'off', playing: s.state === 'playing', title: [a.media_artist, a.media_title].filter(Boolean).join(' - ') || null, volume: a.volume_level ?? null };
  if (domain === 'climate') return { ...base, kind: 'climate', mode: s.state, tempC: haC(a.current_temperature), targetC: haC(a.temperature) };
  if (domain === 'lock') return { ...base, kind: 'lock', locked: s.state === 'locked' };
  if (domain === 'camera') return { ...base, kind: 'camera' };
  if (domain === 'sensor' && a.device_class === 'power') return { ...base, kind: 'sensor', powerW: Number(s.state) || 0 };
  if (domain === 'sensor' && a.device_class === 'temperature') return { ...base, kind: 'sensor', temp: Number(s.state), unit: a.unit_of_measurement };
  if (domain === 'binary_sensor' && ['moisture', 'door', 'window', 'motion', 'occupancy', 'smoke'].includes(a.device_class)) return { ...base, kind: 'sensor', [{ moisture: 'water', door: 'open', window: 'open', motion: 'motion', occupancy: 'motion', smoke: 'smoke' }[a.device_class]]: on };
  return null;
}
PROVIDERS.ha = {
  async list() { return (await haStates()).map(haDevice).filter(Boolean); },
  async act(d, action, value) {
    const h = config.homeAssistant, ent = d.id.slice(3), domain = ent.split('.')[0];
    const svc = { light: { on: 'turn_on', off: 'turn_off', toggle: 'toggle', brightness: 'turn_on' }, switch: { on: 'turn_on', off: 'turn_off', toggle: 'toggle' }, media_player: { toggle: 'media_play_pause', play: 'media_play', pause: 'media_pause', next: 'media_next_track' }, lock: { lock: 'lock' } }[domain]?.[action];
    if (!svc) throw new Error(`can't ${action} a ${domain}`);
    const body = { entity_id: ent, ...(action === 'brightness' ? { brightness_pct: Math.max(1, Math.min(100, Number(value))) } : {}) };
    await getJSON(`${h.url}/api/services/${domain}/${svc}`, { method: 'POST', headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },
};
