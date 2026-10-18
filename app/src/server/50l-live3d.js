/* ======================================================================
 * The 3D home, live (CasaTorch Pro): the extra things the 3D view needs to
 * follow the real house, kept beside the plan (50-floorplan.js).
 *
 * - Each placed device gets a few more facts: heating or cooling right now
 *   (Home Assistant's hvac_action), a TV's album art (fetched here so the
 *   browser never talks to Home Assistant itself), the robot vacuum's state.
 * - "Replay the day": what the placed devices did over the last 24 hours
 *   (Pro: up to 7 days) - lights, doors and windows, motion, power. From Home
 *   Assistant's own history for its devices, and from a small record CasaTorch
 *   keeps itself for the rest. View only. People and trackers are never part
 *   of it.
 * - "Window open while it rains": an alert when a window (or a skylight, a
 *   sliding door) is open while it is raining. Each one can be left out.
 * - The live view's own settings: camera view wedges, saved room views,
 *   lamps that always show one color, status chips for wall panels.
 * ====================================================================== */
const L3_KEEP_MS = 7 * 86400_000, L3_FILE = path.join(DATA_DIR, 'replay.json');
const L3_NEVER = /^(presence|person|device_tracker)$/;   // never record or replay people or trackers
const L3 = (() => { try { const j = JSON.parse(fs.readFileSync(L3_FILE, 'utf8')); return { s: j.s || {}, p: j.p || [], last: {} }; } catch { return { s: {}, p: [], last: {} }; } })();
let l3SavedAt = 0;
const l3Save = (force) => { if (isDemo() || (!force && Date.now() - l3SavedAt < 10 * 60_000)) return; l3SavedAt = Date.now(); try { writeFileSafe(L3_FILE, JSON.stringify({ s: L3.s, p: L3.p }), 0o600); } catch { /* next time */ } };
/* The few facts a replay needs from a device - nothing about people, nothing personal. */
function l3Fields(d) {
  const f = {};
  for (const k of ['on', 'open', 'motion', 'water', 'smoke', 'playing', 'locked']) if (typeof d[k] === 'boolean') f[k] = d[k];
  if (Number.isFinite(d.brightness)) f.brightness = Math.round(d.brightness / 5) * 5;
  if (Number.isFinite(d.position)) f.position = Math.round(d.position);
  if (Number.isFinite(d.powerW)) f.powerW = d.powerW < 20 ? Math.round(d.powerW) : Math.round(d.powerW / 10) * 10;
  if (d.kind === 'climate' && d.mode) f.mode = String(d.mode).slice(0, 20);
  if (d.kind === 'vacuum' && d.state) f.state = String(d.state).slice(0, 20);
  return f;
}
/* Only what changed (power only when it moved by more than a fifth, or 20 W), so a week stays small. */
function l3Diff(prev, f) {
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'powerW' && prev?.powerW != null) { if (Math.abs(v - prev.powerW) > Math.max(20, prev.powerW * 0.2)) out.powerW = v; continue; }
    if (!prev || prev[k] !== v) out[k] = v;
  }
  return out;
}
function l3Record(devices, pinIds, now = Date.now()) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  for (const id of pinIds) {
    const d = byId.get(id); if (!d || L3_NEVER.test(d.kind || '') || L3_NEVER.test(d.domain || '')) continue;
    const f = l3Fields(d), ch = l3Diff(L3.last[id], f); if (!Object.keys(ch).length) continue;
    L3.last[id] = { ...(L3.last[id] || {}), ...ch };
    (L3.s[id] ||= []).push([now, ch]);
  }
  const cut = now - L3_KEEP_MS;
  for (const [id, list] of Object.entries(L3.s)) {
    let i = -1; while (i < list.length - 1 && list[i + 1][0] < cut) i++;
    if (i >= 0 && !(i === 0 && list[0][0] === cut)) { const base = {}; for (let j = 0; j <= i; j++) Object.assign(base, list[j][1]); list.splice(0, i + 1, [cut, base]); }   // changes older than a week fold into one starting state
    if (list.length > 6000) list.splice(0, list.length - 6000);
    if (!pinIds.has(id) && list[list.length - 1][0] < cut) delete L3.s[id];
  }
  L3.p.push([now, Math.round(housePower(devices).watts)]);
  while (L3.p.length && L3.p[0][0] < cut) L3.p.shift();
  l3Save(false);
}
const l3PinIds = () => new Set((fpData().pins || []).map((p) => p.deviceId));
if (!isDemo()) setInterval(async () => { try { if (isConfigured()) { const { devices } = await houseDevices(); const ids = l3PinIds(); const G = fpGroup(devices); for (const id of [...ids]) { const m = G.alias.get(id); if (m) ids.add(m); } l3Record(G.list.concat(devices), ids); } } catch { /* next time */ } }, 30_000).unref?.();

/* Home Assistant's history for the placed Home Assistant devices: one call for all of them, cached for a minute. */
function haHistFields(domain, cls, state, factor = 1) {
  const s = String(state);
  if (['unavailable', 'unknown'].includes(s)) return null;
  switch (domain) {
    case 'light': case 'switch': case 'fan': case 'input_boolean': case 'humidifier': return { on: s === 'on' };
    case 'media_player': return { playing: s === 'playing', on: !['off', 'standby'].includes(s) };
    case 'cover': case 'valve': return { open: s === 'open' || s === 'opening' };
    case 'lock': return { locked: s === 'locked' };
    case 'climate': case 'water_heater': return { mode: s.slice(0, 20) };
    case 'vacuum': case 'lawn_mower': return { state: s.slice(0, 20) };
    case 'binary_sensor': {
      const map = { moisture: 'water', door: 'open', window: 'open', garage_door: 'open', opening: 'open', motion: 'motion', occupancy: 'motion', presence: 'motion', smoke: 'smoke', gas: 'smoke', carbon_monoxide: 'smoke' };
      return { [map[cls] || 'on']: s === 'on' };
    }
    case 'sensor': { const n = Number(s); return Number.isFinite(n) && factor ? { powerW: Math.round(n * factor) } : null; }
    default: return null;
  }
}
async function l3HaHistory(devs, from, to) {
  const h = config.homeAssistant; if (!h?.url || !h.token || !devs.length) return {};
  const ids = devs.map((d) => d.id.slice(3)).filter((e) => /^[a-z_]+\.[\w-]+$/.test(e)).slice(0, 150);
  if (!ids.length) return {};
  return cached(`l3:hist:${Math.floor(from / 60_000)}:${ids.join(',').length}:${ids.length}`, 60_000, async () => {
    const url = `${h.url}/api/history/period/${new Date(from).toISOString()}?end_time=${encodeURIComponent(new Date(to).toISOString())}&filter_entity_id=${encodeURIComponent(ids.join(','))}&minimal_response&no_attributes`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const byEntity = new Map(devs.map((d) => [d.id.slice(3), d])), out = {};
    for (const list of await r.json()) {
      if (!Array.isArray(list) || !list.length) continue;
      const eid = list[0].entity_id, d = byEntity.get(eid); if (!d) continue;
      const [domain] = eid.split('.'), factor = d.powerW != null && Number(d.state) ? d.powerW / Number(d.state) : 1;
      const ch = []; let prev = null;
      for (const x of list) { const f = haHistFields(domain, d.haClass, x.state, factor); if (!f) continue; const diff = l3Diff(prev, f); if (Object.keys(diff).length) { ch.push([Date.parse(x.last_changed || x.last_updated), diff]); prev = { ...(prev || {}), ...diff }; } }
      if (ch.length) out[`ha:${eid}`] = ch.filter((c) => Number.isFinite(c[0]));
    }
    return out;
  }).catch(() => ({}));
}
/* The demo's day: a believable house - lights in the morning and evening, doors, motion, the dishwasher - made the same way every time. */
function l3Demo(pins, devices, from, to) {
  const byId = new Map(devices.map((d) => [d.id, d])), s = {}, H = 3600_000;
  const day0 = (() => { const x = new Date(to); x.setHours(0, 0, 0, 0); return x.getTime(); })();
  const at = (dayOff, h, m = 0) => day0 - dayOff * 86400_000 + h * H + m * 60_000;
  const days = Math.ceil((to - from) / 86400_000) + 1;
  for (const p of pins) {
    const d = byId.get(p.deviceId); if (!d || L3_NEVER.test(d.kind)) continue;
    const ch = [], hash = [...d.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7), push = (t, f) => { if (t >= from - 86400_000 && t <= to) ch.push([t, f]); };
    for (let k = days; k >= 0; k--) {
      if (d.kind === 'light') { push(at(k, 6, 30 + (hash % 20)), { on: true, brightness: 60 }); push(at(k, 8, 10 + (hash % 30)), { on: false }); push(at(k, 17, 40 + (hash % 50)), { on: true, brightness: 80 }); push(at(k, 22, 30 + (hash % 60)), { on: false }); }
      else if (d.open != null || d.kind === 'cover') { for (const [h0, m0] of [[7, 55], [12, 20 + (hash % 30)], [17, 35]]) { push(at(k, h0, m0 + (hash % 9)), { open: true }); push(at(k, h0, m0 + 2 + (hash % 9)), { open: false }); } }
      else if (d.motion != null) { for (let h0 = 7; h0 <= 22; h0 += 2) { push(at(k, h0, hash % 50), { motion: true }); push(at(k, h0, (hash % 50) + 4), { motion: false }); } push(at(k, 2, 13 + (hash % 20)), { motion: true }); push(at(k, 2, 16 + (hash % 20)), { motion: false }); }
      else if (d.kind === 'media') { push(at(k, 18, 5 + (hash % 40)), { playing: true, on: true }); push(at(k, 21, 15), { playing: false }); }
      else if (d.powerW != null) { const base = Math.max(5, Math.round((d.powerW || 50) * 0.08)); push(at(k, 0, 0), { on: true, powerW: base }); if (d.powerW > 300) { push(at(k, 19, 30 + (hash % 25)), { powerW: Math.round(d.powerW) }); push(at(k, 21, 5), { powerW: base }); } }
    }
    ch.sort((a, b) => a[0] - b[0]);
    if (ch.length) s[d.id] = ch;
  }
  const pw = []; for (let t = from - (from % 300_000); t <= to; t += 300_000) { const h = new Date(t).getHours() + new Date(t).getMinutes() / 60; pw.push([t, Math.round(450 + 900 * Math.max(0, Math.sin((h - 5) / 3)) * (h < 10 ? 1 : 0) + 1800 * Math.max(0, Math.sin((h - 16.5) / 2.2)) * (h > 16 && h < 23 ? 1 : 0) + (h > 19.5 && h < 21.1 ? 1200 : 0))]); }
  return { s, p: pw };
}
app.get('/api/floorplan/replay', async (req, res) => {
  const pro = !!proStatus().pro, maxH = pro ? 168 : 24, hours = Math.max(1, Math.min(maxH, Number(req.query.hours) || 24));
  const to = Date.now(), from = to - hours * 3600_000, d = fpData();
  const { devices } = await houseDevices(), G = fpGroup(devices), main = (id) => G.alias.get(id) || id;
  const pins = (d.pins || []).map((p) => ({ ...p, deviceId: main(p.deviceId) }));
  const all = new Map([...devices, ...G.list].map((x) => [x.id, x]));
  const kinds = {}; for (const p of pins) { const x = all.get(p.deviceId); if (x && !L3_NEVER.test(x.kind)) kinds[p.deviceId] = x.kind; }
  let series = {}, power = [];
  if (isDemo()) ({ s: series, p: power } = l3Demo(pins, [...all.values()], from, to));
  else {
    const mine = (id) => (L3.s[id] || []).filter((c, i, a) => c[0] >= from || (a[i + 1]?.[0] ?? Infinity) >= from);
    // a grouped device (a plug and its power sensor): Home Assistant's history of every part, merged under the pin
    const parts = (id) => { const g = all.get(id); return g?.parts?.length ? g.parts : [id]; };
    const haDevs = [...new Set(pins.flatMap((p) => parts(p.deviceId)))].filter((id) => id.startsWith('ha:') && kinds[main(id)] && !L3_NEVER.test(all.get(id)?.kind || '')).map((id) => all.get(id)).filter(Boolean);
    const ha = await l3HaHistory(haDevs, from, to);
    for (const p of pins) {
      if (!kinds[p.deviceId]) continue;
      const fromHa = parts(p.deviceId).flatMap((id) => ha[id] || []).sort((a, b) => a[0] - b[0]);
      const list = fromHa.length ? fromHa : mine(p.deviceId);
      if (list.length) series[p.deviceId] = list;
    }
    power = L3.p.filter((x) => x[0] >= from);
  }
  res.json({ from, to, hours, maxHours: maxH, pro, kinds, series, power });
});

/* ---------- album art: a placed TV or speaker's picture, through CasaTorch ---------- */
const L3_ART = new Map();   // entity -> { key, type, buf } (the last picture only; it changes with the song)
app.get('/api/floorplan/art/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^ha:media_player\.[\w-]+$/.test(id) && !(isDemo() && /^ha:media_player\./.test(id))) return res.status(404).end();
  if (!(fpData().pins || []).some((p) => p.deviceId === id)) return res.status(404).end();   // only devices on the plan
  if (isDemo()) {
    const hue = [...id].reduce((a, c) => (a + c.charCodeAt(0) * 7) % 360, 0);
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=300' });
    return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,58%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},65%,30%)"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><circle cx="128" cy="128" r="70" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="10"/><circle cx="128" cy="128" r="16" fill="rgba(255,255,255,.8)"/></svg>`);
  }
  const h = config.homeAssistant, st = (await haStates()).find((s) => s.entity_id === id.slice(3)), pic = st?.attributes?.entity_picture;
  if (!h?.url || !pic || !/^\/api\/media_player_proxy\//.test(pic)) return res.status(404).end();   // only Home Assistant's own picture relay, never any other address
  try {
    let c = L3_ART.get(id);
    if (!c || c.key !== pic) {
      const r = await fetch(`${h.url}${pic}`, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(8000) });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\/(jpeg|png|webp|gif)/.test(type)) return res.status(404).end();
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 3_000_000) return res.status(404).end();
      c = { key: pic, type, buf }; L3_ART.set(id, c); if (L3_ART.size > 20) L3_ART.delete(L3_ART.keys().next().value);
    }
    res.set({ 'Content-Type': c.type, 'Cache-Control': 'private, max-age=600' }); res.send(c.buf);
  } catch { res.status(404).end(); }
});

/* ---------- the live view's settings ---------- */
const L3_HEX = /^#[0-9a-f]{6}$/i, l3Id = (v) => typeof v === 'string' && v.length <= 200 && /^[\w:.\-@]+$/.test(v);
function l3Clean(b, d) {
  const o = {}, pinned = new Set((d.pins || []).map((p) => p.deviceId));
  o.noRain = (Array.isArray(b.noRain) ? b.noRain : []).filter(l3Id).slice(0, 200);
  o.wedges = Object.fromEntries(Object.entries(b.wedges || {}).filter(([id, w]) => l3Id(id) && w && typeof w === 'object').slice(0, 60).map(([id, w]) => [id, {
    yaw: Math.round(Math.max(-360, Math.min(360, Number(w.yaw) || 0))), fov: Math.round(Math.max(20, Math.min(170, Number(w.fov) || 90))), reach: Math.round(Math.max(1, Math.min(30, Number(w.reach) || 6)) * 2) / 2,
    ...(l3Id(w.motionId) ? { motionId: w.motionId } : {}), ...(w.off === true ? { off: true } : {}) }]));
  o.fixed = Object.fromEntries(Object.entries(b.fixed || {}).filter(([id, v]) => l3Id(id) && typeof v === 'boolean').slice(0, 300));
  const v3 = (a) => Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(Number(n)) && Math.abs(n) < 2000);
  o.views = Object.fromEntries(Object.entries(b.views || {}).filter(([k, v]) => typeof k === 'string' && k.length <= 120 && v && v3(v.p) && v3(v.t)).slice(0, 120).map(([k, v]) => [k, { p: v.p.map((n) => Math.round(n * 100) / 100), t: v.t.map((n) => Math.round(n * 100) / 100) }]));
  o.chips = (Array.isArray(b.chips) ? b.chips : []).filter((x) => l3Id(x) && (pinned.has(x) || /^count:(lights|open|motion|playing)$|^weather$/.test(x))).slice(0, 8);
  o.pets = b.pets === 'cat' || b.pets === 'dog' ? b.pets : null;
  if (L3_HEX.test(b.petColor || '')) o.petColor = b.petColor;
  return o;
}
app.put('/api/floorplan/live3d', requirePro, express.json({ limit: '128kb' }), (req, res) => {
  const d = fpData(); d.live3d = l3Clean(req.body || {}, d); fpWrite(d); res.json({ ok: true, live3d: d.live3d });
});
/* The demo can act out a moment (a door opening, smoke, a doorbell) for the tour and for tests - in memory, demo only. */
const L3_SIM = { dev: {}, events: [], weather: null };
app.post('/api/floorplan/live3d/sim', express.json({ limit: '32kb' }), (req, res) => {
  if (!isDemo()) return res.status(404).json({ error: 'demo only' });
  const b = req.body || {};
  if (b.reset) { L3_SIM.dev = {}; L3_SIM.events = []; L3_SIM.weather = null; }
  if (b.weather && typeof b.weather === 'object') L3_SIM.weather = { kind: ['rain', 'storm', 'sun', 'cloud', 'partly', 'snow', 'fog'].includes(b.weather.kind) ? b.weather.kind : 'rain', rainMm: Math.max(0, Math.min(50, Number(b.weather.rainMm) || 0)) };
  for (const [id, patch] of Object.entries(b.devices || {})) if (l3Id(id) && patch && typeof patch === 'object') L3_SIM.dev[id] = { ...(L3_SIM.dev[id] || {}), ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => /^\w{1,20}$/.test(k) && (['boolean', 'number', 'string'].includes(typeof v) || v === null)).slice(0, 20)) };
  if (b.event && typeof b.event === 'object') L3_SIM.events.unshift({ id: String(b.event.id || 'sim').slice(0, 80), title: String(b.event.title || '').slice(0, 120), severity: ['critical', 'warning', 'notice', 'info'].includes(b.event.severity) ? b.event.severity : 'notice', device: l3Id(b.event.device) ? b.event.device : null, at: nowIso() });
  L3_SIM.events = L3_SIM.events.slice(0, 10);
  if (typeof liveNudge === 'function') liveNudge();
  res.json({ ok: true });
});

/* ---------- raining, and a window open ---------- */
const L3_WINDOWISH = /window|skylight|velux|roof ?light|sash|casement|dormer|fenster|fen[eê]tre|ventana|janela|finestra|raam/i;
function l3Raining(w) { if (!w) return false; const k = w.kind || ''; return k === 'rain' || k === 'storm' || (Number(w.rainMm) || 0) >= 0.2; }
/* The rule itself (also used by the tests): every open window - or a sliding door or skylight drawn on the plan with its sensor - while it rains, unless left out. */
function rainWindowRule(devices, raining, plan) {
  if (!raining) return [];
  const live = plan?.live3d || {}, off = new Set(live.noRain || []), openings = [...(plan?.openings || []), ...(plan?.floors || []).flatMap((f) => f.plan?.openings || [])];
  const linked = new Map(openings.filter((o) => o && o.deviceId).map((o) => [o.deviceId, o]));
  const out = [];
  for (const d of devices) {
    if (d.open !== true && !(Number(d.position) > 0 && d.kind === 'cover' && d.haClass === 'window')) continue;
    const o = linked.get(d.id), byKind = o && ['window', 'skylight', 'slider'].includes(o.kind), byName = d.haClass === 'window' || L3_WINDOWISH.test(`${d.name} ${d.id}`);
    if (!byKind && !(byName && !o)) continue;
    if (off.has(d.id) || o?.noRainAlert) continue;
    out.push({ id: `rainopen:${d.id}`, severity: 'warning', title: `${d.name} is open and it's raining`, source: d.provider || 'casatorch', device: d.id });
  }
  return out.slice(0, 20);
}
async function rainWindowAlerts() {
  try {
    const w = await fpWeather(); if (!l3Raining(w)) return [];
    const { devices } = await allDevices();
    return rainWindowRule(devices, true, fpData());
  } catch { return []; }
}

/* ---------- added to /api/floorplan/live: the facts above, per placed device ---------- */
function fpLiveExtra(out, d, devices = []) {
  try {
    /* devices a door, window, blind or awning on the plan is linked to, when they aren't placed themselves */
    const linked = new Set(), pinned = new Set((out.pins || []).map((p) => p.deviceId));
    const walk = (o) => { if (o && typeof o === 'object') for (const k of ['deviceId', 'coverId']) if (typeof o[k] === 'string' && !pinned.has(o[k])) linked.add(o[k]); };
    for (const o of d.openings || []) walk(o);
    for (const f of d.floors || []) for (const o of f.plan?.openings || []) walk(o);
    for (const it of [...(d.items || []), ...(d.yard?.items || [])]) walk(it);
    const linkedStates = {};
    if (linked.size) { const byId = new Map(devices.map((x) => [x.id, x])); for (const id of [...linked].slice(0, 200)) { const x = byId.get(id); if (x && !L3_NEVER.test(x.kind || '')) linkedStates[id] = { ...l3Fields(x), ...(isDemo() && L3_SIM.dev[id] ? L3_SIM.dev[id] : {}), name: x.name, haClass: x.haClass || null, kind: x.kind }; } }
    const states = isDemo() ? null : haLiveStates() || null, byEntity = states ? new Map(states.map((s) => [s.entity_id, s])) : null;
    for (const p of out.pins || []) {
      const dev = p.device; if (!dev) continue;
      if (isDemo() && L3_SIM.dev[dev.id]) Object.assign(dev, L3_SIM.dev[dev.id]);
      const s = byEntity && dev.id.startsWith('ha:') ? byEntity.get(dev.id.slice(3)) : null, a = s?.attributes || {};
      if (dev.kind === 'climate' && a.hvac_action) dev.hvac = String(a.hvac_action).slice(0, 20);
      if (dev.kind === 'media') {
        if (a.device_class === 'tv') dev.haClass = 'tv';
        if (a.entity_picture && dev.playing) dev.art = `/api/floorplan/art/${encodeURIComponent(dev.id)}?k=${crypto.createHash('sha1').update(String(a.entity_picture)).digest('hex').slice(0, 10)}`;
        if (isDemo() && dev.playing) dev.art = `/api/floorplan/art/${encodeURIComponent(dev.id)}?k=${crypto.createHash('sha1').update(String(dev.title || '')).digest('hex').slice(0, 10)}`;
      }
      if (dev.kind === 'cover' && a.current_tilt_position != null) dev.tiltPos = Number(a.current_tilt_position);
      if (dev.kind === 'vacuum') { dev.state ||= s?.state || null; if (a.current_room || a.room) dev.room = String(a.current_room || a.room).slice(0, 60); }
      if (a.device_class === 'carbon_monoxide' || /carbon.?monoxide|\bco\b.*(alarm|detector)/i.test(dev.name || '')) dev.co = !!dev.smoke;
    }
    if (isDemo()) for (const p of out.pins || []) if (p.device?.kind === 'climate' && !p.device.hvac) p.device.hvac = p.device.mode === 'heat' && p.device.tempC < p.device.targetC ? 'heating' : p.device.mode === 'cool' && p.device.tempC > p.device.targetC ? 'cooling' : 'idle';
    if (isDemo() && out.energy && out.energy.solarW == null) {   // the demo house has panels and a home battery, so the energy view has something to show
      const w = out.weather, hr = new Date().getHours() + new Date().getMinutes() / 60, sunK = Math.max(0, Math.sin(((hr - 6.5) / 12) * Math.PI));
      out.energy = { ...out.energy, solarW: Math.round(5200 * sunK * (w?.kind === 'rain' ? 0.25 : w?.kind === 'cloud' ? 0.5 : 0.9)), battery: { pct: 78, w: sunK > 0.2 ? 1400 : -900 }, demo: true };
    }
    if (isDemo() && L3_SIM.weather && out.weather) Object.assign(out.weather, L3_SIM.weather, { words: L3_SIM.weather.kind === 'rain' ? 'Rain' : out.weather.words });
    const raining = l3Raining(out.weather);
    const evs = isDemo() ? L3_SIM.events : (alerts.events || []).filter((e) => Date.now() - Date.parse(e.at) < 120_000 && e.severity !== 'ok').slice(0, 5).map((e) => ({ id: e.id, title: e.title, severity: e.severity, at: e.at, device: e.device || null }));
    out.live3d = { ...(d.live3d || {}), states: linkedStates, raining, rainOpen: raining ? rainWindowRule([...(out.pins || []).map((p) => p.device).filter(Boolean), ...Object.entries(linkedStates).map(([id, x]) => ({ ...x, id }))], true, d).map((a) => a.device) : [], events: evs };   // rainOpen: placed devices, and windows' sensors linked in the drawing editor
  } catch { /* the live view still works without the extras */ }
  return out;
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchLive3d = { l3Fields, l3Diff, l3Record, haHistFields, rainWindowRule, l3Raining, l3Clean, L3 };
