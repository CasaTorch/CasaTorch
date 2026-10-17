/* ======================================================================
 * Devices without Home Assistant. Every provider turns its gear into the
 * same small shape, so the dashboard, alerts and the 3D floor plan treat a
 * Hue bulb, a Shelly plug and a Home Assistant light alike:
 *
 *   { id: 'shelly:192.168.1.40:0', provider, kind: light|switch|plug|sensor|camera|media|climate|lock,
 *     name, on?, powerW?, tempC?, humidity?, water?, open?, motion?, battery?, playing?, title?, online }
 *
 * Providers here: Shelly (local), Philips Hue (local), cameras (Frigate,
 * Reolink, any snapshot/RTSP camera), YoLink (official cloud API), and
 * Home Assistant when it is connected (32-ha.js). Ring is Pro (31-ring.js).
 * ====================================================================== */
const PROVIDERS = {};   // name -> { list(): Promise<device[]>, act?(device, action, value) }
/* ---- Integrations: one call, and a brand shows up everywhere ----
   integration({
     id: 'acme',                       // also the device id prefix: 'acme:<id>'
     label: 'Acme cameras', group: 'cameras' | 'controls' | 'sensors' | 'network' | 'energy' | 'day',
     desc: 'What it brings in', how: 'direct' | 'pro' | 'ha',
     href: '#network',                 // where in CasaTorch it's connected (or step/add for the setup wizard)
     replaces: ['old-catalog-key'],    // catalog cards this one stands in for on the Connect page
     connected: () => boolean,
     list: async () => devices,        // as any provider; cameras add camDevice('acme', id, {...})
     act: async (device, action, value) => ...,
     camera: { every: 3000, idle: 60000, snapshot: async (id) => ({ buf, type }), live: async (id) => ({ url, headers }) },
   })
   The Connect page lists it with its status, its devices join Home, Controls, Cameras, 3D, alerts and Ask,
   and cameras get pictures (cached, conditional, at the integration's own pace) and live video for free. */
const INTEGRATIONS = new Map();
function integration(def) {
  INTEGRATIONS.set(def.id, def);
  if (def.list) PROVIDERS[def.id] = { list: def.list, ...(def.act ? { act: def.act } : {}) };
  return def;
}
/** The standard camera fields for an integration's camera. */
const camDevice = (integ, id, extra = {}) => {
  const def = INTEGRATIONS.get(integ), enc = encodeURIComponent(id);
  return { id: `${integ}:${id}`, provider: integ, kind: 'camera', online: true, ...extra, snapshot: `/api/cam/${integ}/${enc}/snapshot`, every: def?.camera?.every || 3000, ...(def?.camera?.live ? { stream: `/api/cam/${integ}/${enc}/live` } : {}) };
};
app.get('/api/cam/:integ/:id/snapshot', async (req, res) => {
  const def = INTEGRATIONS.get(req.params.integ), id = String(req.params.id);
  if (!def?.camera?.snapshot || (def.pro && !proStatus().pro)) return res.status(404).end();
  if (def.camera.known && !(await def.camera.known(id))) return res.status(404).end();
  return sendSnap(req, res, `${def.id}:${id}`, () => def.camera.snapshot(id), { every: def.camera.every, idle: def.camera.idle });
});
app.get('/api/cam/:integ/:id/live', async (req, res) => {
  const def = INTEGRATIONS.get(req.params.integ), id = String(req.params.id);
  if (!def?.camera?.live || (def.pro && !proStatus().pro)) return res.status(404).end();
  if (def.camera.known && !(await def.camera.known(id))) return res.status(404).end();
  try { const up = await def.camera.live(id); if (!up?.url) return res.status(404).end(); return mjpegPass(req, res, `${def.id}:${id}`, up.url, up.headers); }
  catch { return res.status(502).end(); }
});
/* What's registered, and whether each is connected - the Connect page shows these next to the catalog. */
app.get('/api/integrations', async (_req, res) => {
  const counts = {}; for (const d of (await houseDevices().catch(() => ({ devices: [] }))).devices) counts[d.provider] = (counts[d.provider] || 0) + 1;
  res.json({ integrations: [...INTEGRATIONS.values()].filter((d) => d.label).map((d) => ({ id: d.id, label: d.label, group: d.group || 'controls', desc: d.desc || '', how: d.how || 'direct', href: d.href || null, step: d.step || null, add: d.add || null, replaces: d.replaces || [], connected: (() => { try { return !!d.connected?.(); } catch { return false; } })(), devices: counts[d.id] || 0 })) });
});
async function allDevices() {
  const out = [], errors = [];
  // Providers in parallel, each capped at 6 s, so one dead bridge never stalls the screen.
  const cap = (pr) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('did not answer in 6 s')), 6000))]);
  await Promise.all(Object.entries(PROVIDERS).map(async ([name, p]) => {
    try { for (const d of await cap(cached(`dev:${name}`, 5_000, async () => ({ list: await p.list() }))).then((x) => x.list || [])) out.push(d); }
    catch (err) { errors.push({ provider: name, error: String(err.message) }); }
  }));
  return { devices: out, errors };
}
/** Every device, demo or real, with the names the household gave them (Settings > Names). */
async function houseDevices() {
  const r = isDemo() ? { devices: JSON.parse(fs.readFileSync(path.join(APP_DIR, '..', 'demo', 'floorplan', 'devices.json'), 'utf8')), errors: [] } : await allDevices();
  // The demo "without Home Assistant" (CASATORCH_DEMO_NOHA=1): only the brands CasaTorch reaches by itself - for honest side-by-side pictures.
  if (isDemo() && process.env.CASATORCH_DEMO_NOHA === '1') r.devices = r.devices.filter((d) => d.provider !== 'ha');
  const names = uiPrefs().deviceNames || {};
  for (const d of r.devices) { d.originalName = d.name; if (names[d.id]) d.name = names[d.id]; }
  return r;
}
/* ---- What the whole house is using right now, without counting anything twice. ----
   1. A meter you picked (Settings > Energy), or one that is clearly the whole house ("house power",
      "grid consumption", "mains"...): that is the answer.
   2. Otherwise add up plugs and power sensors - skipping a plug's own power sensor (counted on the plug)
      and a second sensor reporting the same big load (a car charger seen by both the car and the charger). */
const WHOLE_HOUSE = /\b(house|home|whole|total|grid|mains?|main_?panel|consumption|import)\b|_house_|_home_|_grid_|_total_/i;
function housePower(devices) {
  const withW = devices.filter((d) => Number.isFinite(d.powerW));
  const pick = config.energy?.meter && withW.find((d) => d.id === config.energy.meter);
  if (pick) return { watts: Math.round(pick.powerW), from: pick.name };
  const meters = withW.filter((d) => d.kind === 'sensor' && !d.pairedTo && WHOLE_HOUSE.test(`${d.id} ${d.name}`) && !/charg|car|ev_|solar|battery|pv/i.test(`${d.id} ${d.name}`));
  if (meters.length) { const m = meters.sort((a, b) => b.powerW - a.powerW)[0]; return { watts: Math.round(m.powerW), from: m.name }; }
  let sum = 0; const seen = [];
  for (const d of withW) {
    if (d.pairedTo || d.powerW <= 0 || d.powerW > 100_000 || /solar|pv_|production|generation/i.test(`${d.id} ${d.name}`)) continue;
    if (d.powerW >= 50 && seen.some((w) => Math.abs(w - d.powerW) <= Math.max(5, d.powerW * 0.02))) continue;
    seen.push(d.powerW); sum += d.powerW;
  }
  return { watts: Math.round(sum), from: null };
}
/* Where the power comes from, for the 3D Home's energy card: solar, a home battery and the grid, from
   whatever sensors the house has (Home Assistant's own names: solar/pv/inverter, battery/powerwall, grid).
   Anything not found stays null and isn't shown - nothing is made up. */
const SOLAR = /solar|\bpv\b|pv_|_pv|photovoltaic|inverter|production|generation/i, NOT_NOW = /forecast|today|daily|total|energy|yield|kwh/i;
function energyFlows(devices, useW) {
  const withW = devices.filter((d) => Number.isFinite(d.powerW) && !d.pairedTo), words = (d) => `${d.id} ${d.name}`;
  const solar = withW.filter((d) => SOLAR.test(words(d)) && !NOT_NOW.test(words(d)) && !/battery/i.test(words(d)));
  const solarW = solar.length ? Math.max(0, Math.round(solar.reduce((a, d) => a + d.powerW, 0))) : null;
  const batt = devices.find((d) => d.battery != null && /powerwall|home.?battery|battery.?storage|storage.?battery|\bess\b|encharge|sonnen|enphase.?battery/i.test(words(d)));
  const battW = withW.find((d) => /powerwall|battery.?(power|charg|discharg)|storage.?power/i.test(words(d)));
  const grid = withW.find((d) => /\bgrid\b|_grid|grid_|net.?(power|meter)|mains|utility/i.test(words(d)) && !SOLAR.test(words(d)));
  return { useW, solarW, gridW: grid ? Math.round(grid.powerW) : null, battery: batt || battW ? { pct: batt ? Math.round(batt.battery) : null, w: battW ? Math.round(battW.powerW) : null } : null,
    selfPct: solarW != null && useW > 0 ? Math.min(100, Math.round((solarW / useW) * 100)) : null };
}
/* ---- The safety rule: CasaTorch never unlocks, opens a garage door or gate, or disarms an alarm. ----
   Home Assistant doesn't always label things, so this also looks at what a device is called:
   a relay named "garage", a "gate" button, an "unlock" script or a "disarm" scene is treated the same way.
   Covers can always be closed and stopped; opening is only for blinds, shades, curtains and the like.
   An owner can allow a specific device in Settings > Security if the name caught it by mistake. */
const SAFE_COVERS = new Set(['blind', 'shade', 'curtain', 'shutter', 'awning', 'window', 'damper', 'water']);   // 'water': a water valve
const RISKY_NAME = /garage|\bgates?\b|gate_|door(?!bell|_?sensor|_?contact)|\block|unlock|disarm|\balarm|opener|deadbolt|\b(puerta|port[oó]n|garaje|cerradura|alarma|verja|cerrojo|tor|t[üu]r|tuer|torantrieb|schloss|riegel|porte|portail|serrure|alarme|verrou|port[ãa]o|porta|garagem|fechadura|cancello|portone|serratura|allarme|poort|deur|hek|slot|alarm)\b|^shelly(plus|pro)?(1|2|uni|i3|i4)\b|^shelly(plus|pro)?1(pm|l)?[-_]/i;   // every language CasaTorch speaks; Shelly relay models keep their default name and often drive garage doors
function riskOf(d) {
  if (!d) return null;
  if ((config.safety?.allow || []).includes(d.id)) return null;
  const words = `${d.id} ${d.originalName || d.name || ''}`;
  if (d.kind === 'lock') return { only: ['lock'], why: 'unlocking isn\'t available from CasaTorch - use your lock\'s own app' };
  if (d.kind === 'alarm') return { only: ['arm_home', 'arm_away', 'arm_night'], why: 'disarming isn\'t available from CasaTorch - use the alarm\'s own app or keypad' };
  if (d.kind === 'cover' && (d.risky || !SAFE_COVERS.has(d.haClass) || RISKY_NAME.test(words))) return { only: ['close', 'stop'], why: 'opening garage doors, gates and doors stays in their own app or Home Assistant' };
  if (d.domain === 'siren' || /siren/.test(d.id)) return { only: ['on'], why: 'sirens can be set off from CasaTorch, but only turned off where they were set' };
  if (['switch', 'plug', 'action', 'fan'].includes(d.kind) && RISKY_NAME.test(words)) return { only: [], why: `"${d.name}" looks like a door, gate, lock or alarm control, so CasaTorch won't switch it. An owner can allow it in Settings › Security.` };
  return null;
}
const blocked = (d, action) => { const r = riskOf(d); return r && !r.only.includes(action) ? r.why : null; };
app.get('/api/devices', async (_req, res) => { const r = await houseDevices(); for (const d of r.devices) if (riskOf(d)) d.guarded = riskOf(d).only; res.json({ ...r, power: housePower(r.devices) }); });
/* Owner: the devices the safety rule is holding back, and the ones allowed anyway. */
app.get('/api/safety', requireRole('admin'), async (_req, res) => {
  const { devices } = await houseDevices(), allow = new Set(config.safety?.allow || []);
  res.json({ held: devices.filter((d) => ['switch', 'plug', 'action', 'fan', 'cover'].includes(d.kind) && (allow.has(d.id) || riskOf(d))).map((d) => ({ id: d.id, name: d.name, kind: d.kind, allowed: allow.has(d.id) })) });
});
app.put('/api/safety/:id', express.json({ limit: '2kb' }), (req, res) => {
  if (signInOn() && req.user?.role !== 'owner') return res.status(403).json({ error: 'Only an owner can change this.' });
  const id = String(req.params.id).slice(0, 200), allow = new Set(config.safety?.allow || []);
  if (req.body?.allow === true) allow.add(id); else allow.delete(id);
  config.safety = { ...(config.safety || {}), allow: [...allow].slice(0, 200) }; saveConfig(config);
  if (typeof audit === 'function') audit(req, req.body?.allow ? 'safety-allow' : 'safety-hold', { id });
  res.json({ ok: true });
});
app.post('/api/devices/:id/:action', express.json(), async (req, res) => {
  if (isDemo()) { const d = (await houseDevices()).devices.find((x) => x.id === req.params.id); const why = blocked(d, req.params.action); if (why) return res.status(403).json({ error: why }); return res.json({ ok: true, demo: true }); }
  const id = String(req.params.id), prov = PROVIDERS[id.split(':')[0]];
  if (!prov?.act) return res.status(404).json({ error: 'that device cannot be controlled from here' });
  const { devices } = await allDevices(); const d = devices.find((x) => x.id === id);
  if (!d) return res.status(404).json({ error: 'device not found' });
  const why = blocked(d, String(req.params.action)); if (why) return res.status(403).json({ error: why });
  try { await prov.act(d, req.params.action, req.body?.value); CACHE.delete(`dev:${id.split(':')[0]}`); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ error: String(err.message) }); }
});

/* ---- Shelly: config.shelly = [{ host, name? }]. Gen1 (/status) and Gen2+ (/rpc). ---- */
PROVIDERS.shelly = {
  async list() {
    const out = [];
    await Promise.all((config.shelly || []).map(async (s) => {
      const base = `http://${s.host}`;
      try {
        const info = await getJSON(`${base}/shelly`, { timeout: 4000 });
        if (info.gen >= 2) {
          const st = await getJSON(`${base}/rpc/Shelly.GetStatus`, { timeout: 4000 });
          for (const [k, v] of Object.entries(st)) {
            const [type, ch] = k.split(':');
            const id = `shelly:${s.host}:${type}${ch ?? ''}`, name = s.name || info.name || info.id || s.host;
            if (type === 'switch') out.push({ id, provider: 'shelly', kind: 'plug', name, on: !!v.output, powerW: v.apower ?? null, online: true });
            if (type === 'temperature') out.push({ id, provider: 'shelly', kind: 'sensor', name, tempC: v.tC ?? null, online: true });
            if (type === 'humidity') out.push({ id, provider: 'shelly', kind: 'sensor', name, humidity: v.rh ?? null, online: true });
            if (type === 'flood') out.push({ id, provider: 'shelly', kind: 'sensor', name, water: !!v.alarm, online: true });
            if (type === 'devicepower') out.push({ id, provider: 'shelly', kind: 'sensor', name, battery: v.battery?.percent ?? null, online: true });
          }
        } else {
          const st = await getJSON(`${base}/status`, { timeout: 4000 });
          (st.relays || []).forEach((r, i) => out.push({ id: `shelly:${s.host}:switch${i}`, provider: 'shelly', kind: 'plug', name: s.name || s.host, on: !!r.ison, powerW: st.meters?.[i]?.power ?? null, online: true }));
          if (st.tmp) out.push({ id: `shelly:${s.host}:temperature`, provider: 'shelly', kind: 'sensor', name: s.name || s.host, tempC: st.tmp.tC ?? null, humidity: st.hum?.value ?? null, battery: st.bat?.value ?? null, online: true });
          if ('flood' in st) out.push({ id: `shelly:${s.host}:flood`, provider: 'shelly', kind: 'sensor', name: s.name || s.host, water: !!st.flood, online: true });
        }
      } catch { out.push({ id: `shelly:${s.host}:offline`, provider: 'shelly', kind: 'plug', name: s.name || s.host, online: false }); }
    }));
    return out;
  },
  async act(d, action) {
    const [, host, part] = d.id.split(':'); const ch = Number(String(part).replace(/\D/g, '')) || 0;
    const on = action === 'on' ? true : action === 'off' ? false : !d.on;
    const info = await getJSON(`http://${host}/shelly`, { timeout: 4000 });
    if (info.gen >= 2) await getJSON(`http://${host}/rpc/Switch.Set?id=${ch}&on=${on}`);
    else await getJSON(`http://${host}/relay/${ch}?turn=${on ? 'on' : 'off'}`);
  },
};

/* ---- Philips Hue: config.hue = { host, username } (from pressing the bridge button, below). ---- */
PROVIDERS.hue = {
  async list() {
    const h = config.hue; if (!h?.host || !h?.username) return [];
    const lights = await getJSON(`http://${h.host}/api/${h.username}/lights`, { timeout: 5000 });
    if (Array.isArray(lights) && lights[0]?.error) throw new Error(lights[0].error.description);
    return Object.entries(lights || {}).map(([id, l]) => ({ id: `hue:${id}`, provider: 'hue', kind: 'light', name: l.name, on: !!l.state?.on, brightness: l.state?.bri != null ? Math.round(l.state.bri / 2.54) : null, online: l.state?.reachable !== false }));
  },
  async act(d, action, value) {
    const h = config.hue, id = d.id.split(':')[1];
    const body = action === 'brightness' ? { on: true, bri: Math.max(1, Math.min(254, Math.round(Number(value) * 2.54))) } : { on: action === 'on' ? true : action === 'off' ? false : !d.on };
    const r = await fetch(`http://${h.host}/api/${h.username}/lights/${id}/state`, { method: 'PUT', body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Hue answered HTTP ${r.status}`);
  },
};
/** Pairing: the user presses the bridge's button, then this asks for a username. */
async function huePair(host) {
  const r = await fetch(`http://${host}/api`, { method: 'POST', body: JSON.stringify({ devicetype: 'casatorch#panel' }), signal: AbortSignal.timeout(6000) });
  const j = await r.json();
  if (j?.[0]?.success?.username) return { ok: true, username: j[0].success.username };
  if (j?.[0]?.error?.type === 101) return { ok: false, error: 'Press the round button on the Hue bridge, then try again within 30 seconds.' };
  return { ok: false, error: j?.[0]?.error?.description || 'the bridge did not answer as expected' };
}

/* ---- Cameras: config.cameras = [{ id, name, type: frigate|reolink|snapshot, ... }] ---- */
function digestHeader(method, uri, user, pass, chal) {
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const p = Object.fromEntries([...chal.matchAll(/(\w+)="?([^",]+)"?/g)].map((m) => [m[1], m[2]]));
  const nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = md5(`${user}:${p.realm}:${pass}`), ha2 = md5(`${method}:${uri}`);
  const response = p.qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  return `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"${p.qop ? `, qop=auth, nc=${nc}, cnonce="${cnonce}"` : ''}${p.opaque ? `, opaque="${p.opaque}"` : ''}`;
}
/** GET an image with no auth, Basic, or Digest (Hikvision/Dahua/Amcrest use Digest). */
async function fetchImage(url, user, pass) {
  const u = new URL(url);
  const basic = user ? { Authorization: `Basic ${Buffer.from(`${user}:${pass || ''}`).toString('base64')}` } : {};
  let r = await fetch(u, { headers: basic, signal: AbortSignal.timeout(10000) });
  const chal = r.headers.get('www-authenticate');
  if (r.status === 401 && user && /digest/i.test(chal || '')) r = await fetch(u, { headers: { Authorization: digestHeader('GET', u.pathname + u.search, user, pass || '', chal) }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Object.assign(new Error(`camera answered HTTP ${r.status}`), { status: r.status });
  return { type: r.headers.get('content-type') || 'image/jpeg', buf: Buffer.from(await r.arrayBuffer()) };
}
const CAMERA_SNAPSHOT = {
  frigate: (c) => fetchImage(`${String(c.url).replace(/\/+$/, '')}/api/${encodeURIComponent(c.camera)}/latest.jpg?h=720`),
  reolink: (c) => fetchImage(`http://${c.host}/cgi-bin/api.cgi?cmd=Snap&channel=${c.channel || 0}&rs=casatorch${Date.now()}&user=${encodeURIComponent(c.username)}&password=${encodeURIComponent(c.password)}`),
  snapshot: (c) => fetchImage(c.snapshotUrl, c.username, c.password),
};
PROVIDERS.camera = {
  async list() { return (config.cameras || []).map((c) => ({ id: `camera:${c.id}`, provider: 'camera', kind: 'camera', name: c.name, source: c.type, live: c.type === 'frigate', stream: c.type === 'frigate' ? `/api/cameras/${encodeURIComponent(c.id)}/live` : undefined, snapshot: `/api/cameras/${encodeURIComponent(c.id)}/snapshot`, every: 2000, online: true })); },
};
/* Ready pictures for every camera soon after start-up, so the first look is never blank. */
setTimeout(() => { if (!isDemo()) for (const c of config.cameras || []) if (CAMERA_SNAPSHOT[c.type]) snapRefresh(snapEntry(`camera:${c.id}`, () => CAMERA_SNAPSHOT[c.type](c), 'local')); }, 2000).unref?.();
/* Live video for Frigate cameras: Frigate's own MJPEG stream, passed through (mjpegPass in 29-camcache.js). */
app.get('/api/cameras/:id/live', async (req, res) => {
  const c = (config.cameras || []).find((x) => x.id === req.params.id);
  if (!c || c.type !== 'frigate') return res.status(404).end();
  return mjpegPass(req, res, `camera:${c.id}`, `${String(c.url).replace(/\/+$/, '')}/api/${encodeURIComponent(c.camera)}?h=720&fps=10&bbox=0&timestamp=0&zones=0&mask=0&motion=0&regions=0`);
});
app.get('/api/cameras/:id/snapshot', async (req, res) => {
  if (isDemo()) {   // a drawn stand-in so the demo has pictures
    const name = String(req.params.id).replace(/[^\w -]/g, ''), t = new Date().toLocaleTimeString('en-US');
    res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'no-store');
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a5f"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><rect y="250" width="640" height="110" fill="#14301f"/><rect x="250" y="120" width="140" height="140" fill="#3b2f2a"/><polygon points="240,125 320,70 400,125" fill="#5b3b30"/><rect x="300" y="190" width="40" height="70" fill="#1f160f"/><text x="16" y="30" fill="#fff" font-family="monospace" font-size="18">${name.toUpperCase()}  DEMO</text><text x="624" y="30" text-anchor="end" fill="#fff" font-family="monospace" font-size="16">${t}</text></svg>`);
  }
  const c = (config.cameras || []).find((x) => x.id === req.params.id);
  if (!c || !CAMERA_SNAPSHOT[c.type]) return res.status(404).end();
  return sendSnap(req, res, `camera:${c.id}`, () => CAMERA_SNAPSHOT[c.type](c), 'local');
});

/* ---- YoLink: official cloud API. config.yolink = { uaid, secret } (YoLink app > Settings > Account > Advanced > User Access Credentials). ---- */
const yolink = { token: null, exp: 0 };
async function yolinkCall(body) {
  const c = config.yolink;
  if (!yolink.token || Date.now() > yolink.exp) {
    const r = await fetch('https://api.yosmart.com/open/yolink/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.uaid, client_secret: c.secret }), signal: AbortSignal.timeout(10000) });
    const j = await r.json(); if (!j.access_token) throw new Error('YoLink refused the credentials');
    yolink.token = j.access_token; yolink.exp = Date.now() + ((j.expires_in || 3600) - 120) * 1000;
  }
  const r = await fetch('https://api.yosmart.com/open/yolink/v2/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${yolink.token}` }, body: JSON.stringify({ time: Date.now(), ...body }), signal: AbortSignal.timeout(10000) });
  const j = await r.json(); if (j.code !== '000000') throw new Error(j.desc || `YoLink error ${j.code}`);
  return j.data;
}
PROVIDERS.yolink = {
  async list() {
    if (!config.yolink?.uaid) return [];
    return cached('yolink:list', 60_000, async () => {
      const { devices = [] } = await yolinkCall({ method: 'Home.getDeviceList' });
      const out = [];
      for (const d of devices.filter((x) => ['LeakSensor', 'DoorSensor', 'THSensor', 'MotionSensor', 'VibrationSensor'].includes(x.type))) {
        try {
          const s = (await yolinkCall({ method: `${d.type}.getState`, targetDevice: d.deviceId, token: d.token }))?.state || {};
          out.push({ id: `yolink:${d.deviceId}`, provider: 'yolink', kind: 'sensor', name: d.name, water: d.type === 'LeakSensor' ? s.state === 'alert' : undefined, open: d.type === 'DoorSensor' ? s.state === 'open' : undefined,
            motion: d.type === 'MotionSensor' ? s.state === 'alert' : undefined, tempC: s.temperature ?? undefined, humidity: s.humidity ?? undefined, battery: s.battery != null ? s.battery * 25 : undefined, online: s.online !== false });
        } catch { out.push({ id: `yolink:${d.deviceId}`, provider: 'yolink', kind: 'sensor', name: d.name, online: false }); }
      }
      return { list: out };
    }).then((x) => x.list);
  },
};
