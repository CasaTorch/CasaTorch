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
  const names = uiPrefs().deviceNames || {};
  for (const d of r.devices) { d.originalName = d.name; if (names[d.id]) d.name = names[d.id]; }
  return r;
}
app.get('/api/devices', async (_req, res) => res.json(await houseDevices()));
app.post('/api/devices/:id/:action', express.json(), async (req, res) => {
  if (isDemo()) { const d = (await houseDevices()).devices.find((x) => x.id === req.params.id); if (d?.risky && ['open', 'toggle'].includes(req.params.action)) return res.status(403).json({ error: 'opening garage doors and gates stays in Home Assistant' }); return res.json({ ok: true, demo: true }); }
  const id = String(req.params.id), prov = PROVIDERS[id.split(':')[0]];
  if (!prov?.act) return res.status(404).json({ error: 'that device cannot be controlled from here' });
  const { devices } = await allDevices(); const d = devices.find((x) => x.id === id);
  if (!d) return res.status(404).json({ error: 'device not found' });
  if (d.kind === 'lock' && req.params.action === 'unlock') return res.status(403).json({ error: 'unlocking isn\'t available from CasaTorch - use your lock\'s own app' });
  if (d.kind === 'alarm') return res.status(403).json({ error: 'arm and disarm the alarm in Home Assistant' });
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
  async list() { return (config.cameras || []).map((c) => ({ id: `camera:${c.id}`, provider: 'camera', kind: 'camera', name: c.name, source: c.type, live: c.rtspUrl ? true : false, online: true })); },
};
app.get('/api/cameras/:id/snapshot', async (req, res) => {
  if (isDemo()) {   // a drawn stand-in so the demo has pictures
    const name = String(req.params.id).replace(/[^\w -]/g, ''), t = new Date().toLocaleTimeString('en-US');
    res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'no-store');
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a5f"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><rect y="250" width="640" height="110" fill="#14301f"/><rect x="250" y="120" width="140" height="140" fill="#3b2f2a"/><polygon points="240,125 320,70 400,125" fill="#5b3b30"/><rect x="300" y="190" width="40" height="70" fill="#1f160f"/><text x="16" y="30" fill="#fff" font-family="monospace" font-size="18">${name.toUpperCase()}  DEMO</text><text x="16" y="345" fill="#fff" font-family="monospace" font-size="16">${t}</text></svg>`);
  }
  const c = (config.cameras || []).find((x) => x.id === req.params.id);
  if (!c || !CAMERA_SNAPSHOT[c.type]) return res.status(404).end();
  try { const img = await CAMERA_SNAPSHOT[c.type](c); res.setHeader('Content-Type', img.type); res.setHeader('Cache-Control', 'no-store'); res.end(img.buf); }
  catch (err) { res.status(502).json({ error: String(err.message) }); }
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
