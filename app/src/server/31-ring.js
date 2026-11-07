/* ======================================================================
 * Ring cameras, doorbells and chimes - in Basic (free), Labs.
 *
 * Ring has no public API. This uses ring-client-api (MIT), the same library
 * behind ring-mqtt and the Homebridge plugin: it signs in the way the Ring app
 * does. It works well today, but Ring could change or block it at any time -
 * the wizard says so before anyone signs in.
 *
 * Sign-in: e-mail + password -> Ring texts/e-mails a code (or the authenticator
 * app) -> code -> a refresh token, saved in config.ring.refreshToken. The
 * password is never saved. Ring rotates the token as it is used; every new one
 * is saved straight away (onRefreshTokenUpdated) or the next restart could not
 * sign in.
 * ====================================================================== */
/* Loaded only once Ring is set up: it is the biggest part of starting CasaTorch (one to two seconds on a Raspberry Pi). */
const ringLib = () => import('ring-client-api');
const ring = { api: null, cameras: [], chimes: [], pending: null, events: [], error: null };
/* ring-client-api's push listener logs a full stack trace when Ring sends a notification it can't decode
   (it drops that one and carries on). Say it in one line instead of alarming anyone reading the log. */
{ const logErr = console.error.bind(console); let last = 0;
  console.error = (...a) => { const e = a[0]; if (e?.code === 'ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY' && /push-receiver/.test(String(e.stack))) { if (Date.now() - last > 600_000) { last = Date.now(); console.warn('Ring: skipped a notification that could not be decoded (harmless).'); } return; } logErr(...a); }; }
async function ringConnect() {
  if (!config.ring?.refreshToken || ring.api) return;
  try {
    const { RingApi } = await ringLib(); if (ring.api) return;
    ring.api = new RingApi({ refreshToken: config.ring.refreshToken, controlCenterDisplayName: 'CasaTorch', cameraStatusPollingSeconds: 60 });
    ring.api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => { saveConfig({ ...config, ring: { ...config.ring, refreshToken: newRefreshToken } }); });
    ring.cameras = await ring.api.getCameras();
    // Ring Chime / Chime Pro: in the same account, listed per location (the cameras call above already fetched them)
    ring.chimes = (await ring.api.getLocations().catch(() => [])).flatMap((l) => l.chimes || []);
    // Ready pictures for every Ring camera from the start (refreshed once a minute until someone watches).
    for (const cam of ring.cameras) { const e = snapEntry(`ring:${cam.id}`, async () => ({ buf: await cam.getSnapshot(), type: 'image/jpeg' }), ringBeat(cam)); snapRefresh(e); }
    for (const cam of ring.cameras) {
      cam.onDoorbellPressed?.subscribe(() => ringEvent(cam, 'doorbell'));
      cam.onMotionDetected?.subscribe((m) => { if (m) ringEvent(cam, 'motion'); });
    }
    ring.error = null;
  } catch (err) { ring.api = null; ring.error = String(err.message); }
}
function ringEvent(cam, kind) {
  snapNow(`ring:${cam.id}`);   // a fresh picture of whoever is at the door, straight away
  ring.events.unshift({ at: nowIso(), camera: cam.name, kind });
  ring.events = ring.events.slice(0, 100);
  if (typeof tlRecord === 'function') tlRecord({ type: kind, source: 'ring', camera: cam.name, cameraId: `ring:${cam.id}` }, { snapKey: `ring:${cam.id}` });   // the timeline (72t-timeline.js)
  if (typeof alertRaise === 'function') alertRaise({ id: `ring:${cam.id}:${kind}:${Date.now()}`, severity: kind === 'doorbell' ? 'notice' : 'info', title: kind === 'doorbell' ? `Someone at the ${cam.name}` : `Motion at the ${cam.name}`, source: 'ring', image: `/api/ring/${cam.id}/snapshot`, url: '/#timeline' });
}
setTimeout(() => { ringConnect(); }, 5000).unref?.();

/* During setup the token waits in the wizard's draft (saving config.json early would end setup). */
async function ringSave(refreshToken) {
  if (isDemo()) return [];
  if (!isConfigured()) { draft.ring = { refreshToken, connectedAt: nowIso() }; return []; }
  saveConfig({ ...config, ring: { refreshToken, connectedAt: nowIso() } });
  await ringConnect(); return ring.cameras.map((c) => c.name);
}
app.post(['/api/ring/login', '/api/setup/ring/login'], requireRole('admin'), express.json(), async (req, res) => {
  const { email, password, code } = req.body || {};
  try {
    if (code) {
      if (!ring.pending) return res.status(409).json({ error: 'start again with your e-mail and password' });
      const auth = await ring.pending.getAuth(String(code).trim());
      ring.pending = null;
      return res.json({ ok: true, cameras: await ringSave(auth.refresh_token) });
    }
    const { RingRestClient } = await import('ring-client-api/rest-client');
    const rc = new RingRestClient({ email: String(email || ''), password: String(password || ''), controlCenterDisplayName: 'CasaTorch' });
    try {
      if (isDemo()) return res.json({ ok: true, demo: true, cameras: [] });
      const auth = await rc.getAuth();   // accounts without 2-factor
      return res.json({ ok: true, cameras: await ringSave(auth.refresh_token) });
    } catch (err) {
      if (rc.promptFor2fa) { ring.pending = rc; return res.json({ ok: false, needsCode: true, prompt: rc.promptFor2fa.replace('Please enter', 'Enter') }); }
      throw err;
    }
  } catch (err) { res.status(400).json({ error: /2fa|Verification/i.test(err.message) ? 'That code is not right - try again.' : /password|credentials|oauth/i.test(err.message) ? 'Ring refused that e-mail and password.' : String(err.message) }); }
});
app.get('/api/ring/status', (_req, res) => res.json({ connected: !!ring.api, error: ring.error, cameras: ring.cameras.map((c) => ({ id: String(c.id), name: c.name, battery: c.batteryLevel ?? null, doorbell: !!c.isDoorbot })), chimes: ring.chimes.map(ringChimeDevice), events: ring.events.slice(0, 20) }));
app.get('/api/ring/:id/snapshot', async (req, res) => {
  const cam = ring.cameras.find((c) => String(c.id) === req.params.id);
  if (!cam) return res.status(404).end();
  return sendSnap(req, res, `ring:${cam.id}`, async () => ({ buf: await cam.getSnapshot(), type: 'image/jpeg' }), ringBeat(cam));
});
/* Battery Ring cameras sleep to save power: waking one for a picture every few seconds would drain it in days,
   so they get a new picture every 20 s while someone is looking and every 10 minutes otherwise (and always
   right away on a ring or motion). Wired ones: every 4 s while watched. */
const ringBeat = (c) => (c.hasBattery ? { every: 20_000, idle: 10 * 60_000 } : { every: 4000, idle: 60_000 });
/* A Ring Chime from ring-client-api (location.chimes) as a device: a chime, never a camera - the same shape a Home
   Assistant chime gets (haChimeOf, 32-ha.js), so every camera view skips it. Online, volume (Ring's 0-10) and snooze. Pure. */
const RING_VOL_MAX = 10;
function ringChimeDevice(c) {
  const x = c?.data || {}, left = Math.max(0, Number(x.do_not_disturb?.seconds_left) || 0), conn = String(x.alerts?.connection || '').toLowerCase();
  const vol = Number(x.settings?.volume);
  return haChimeOf({ id: `ring:chime:${c.id}`, provider: 'ring', kind: 'chime', name: String(x.description || c.name || 'Chime'), model: c.model || 'Chime', source: 'Ring',
    online: conn ? conn !== 'offline' : true, volume: Number.isFinite(vol) ? Math.max(0, Math.min(RING_VOL_MAX, Math.round(vol))) : null, volumeMax: RING_VOL_MAX,
    snoozed: left > 0, snoozeMin: left > 0 ? Math.ceil(left / 60) : 0, can: ['volume', 'snooze'] });
}
const ringCamDevice = (c) => ({ id: `ring:${c.id}`, provider: 'ring', kind: 'camera', name: c.name, battery: c.batteryLevel ?? null, online: !c.isOffline, doorbell: !!c.isDoorbot, source: c.hasBattery ? 'Ring (battery)' : 'Ring', snapshot: `/api/ring/${c.id}/snapshot`, every: c.hasBattery ? 20_000 : 4000 });
PROVIDERS.ring = {
  async list() { return [...ring.cameras.map(ringCamDevice), ...ring.chimes.map(ringChimeDevice)]; },
  /* Chimes only: volume 0-10, snooze for some minutes (0 = ring again). Cameras have nothing to switch. */
  async act(d, action, value) {
    const m = /^ring:chime:(\d+)$/.exec(d.id), chime = m && ring.chimes.find((c) => String(c.id) === m[1]);
    if (!chime) throw new Error('that device cannot be controlled from here');
    if (action === 'volume') { const v = Math.round(Number(value)); if (!Number.isFinite(v) || v < 0 || v > RING_VOL_MAX) throw new Error('Pick a volume from 0 to 10.'); return chime.setVolume(v); }
    if (action === 'snooze') { const n = Math.round(Number(value)); if (!Number.isFinite(n) || n < 0 || n > 1440) throw new Error('Pick up to 24 hours.'); return n ? chime.snooze(n) : chime.clearSnooze(); }
    throw new Error('that device cannot be controlled from here');
  },
};
app.get('/api/ring/chimes', (_req, res) => res.json({ chimes: ring.chimes.map(ringChimeDevice) }));
if (process.env.CASATORCH_TEST === '1') { globalThis.__casatorchRing = { ringChimeDevice, ringCamDevice, ring }; globalThis.__casatorchProviders = PROVIDERS; }
