/* ======================================================================
 * Ring cameras and doorbells - CasaTorch Pro, Labs.
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
import { RingApi } from 'ring-client-api';
import { RingRestClient } from 'ring-client-api/rest-client';
const ring = { api: null, cameras: [], pending: null, events: [], error: null };
async function ringConnect() {
  if (!config.ring?.refreshToken || ring.api) return;
  try {
    ring.api = new RingApi({ refreshToken: config.ring.refreshToken, controlCenterDisplayName: 'CasaTorch', cameraStatusPollingSeconds: 60 });
    ring.api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => { saveConfig({ ...config, ring: { ...config.ring, refreshToken: newRefreshToken } }); });
    ring.cameras = await ring.api.getCameras();
    // Ready pictures for every Ring camera from the start (refreshed once a minute until someone watches).
    for (const cam of ring.cameras) { const e = snapEntry(`ring:${cam.id}`, async () => ({ buf: await cam.getSnapshot(), type: 'image/jpeg' }), 'ring'); snapRefresh(e); }
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
  if (typeof alertRaise === 'function') alertRaise({ id: `ring:${cam.id}:${kind}:${Date.now()}`, severity: kind === 'doorbell' ? 'notice' : 'info', title: kind === 'doorbell' ? `Someone at the ${cam.name}` : `Motion at the ${cam.name}`, source: 'ring', image: `/api/ring/${cam.id}/snapshot` });
}
setTimeout(() => { if (proStatus().pro) ringConnect(); }, 5000).unref?.();

/* During setup the token waits in the wizard's draft (saving config.json early would end setup). */
async function ringSave(refreshToken) {
  if (isDemo()) return [];
  if (!isConfigured()) { draft.ring = { refreshToken, connectedAt: nowIso() }; return []; }
  saveConfig({ ...config, ring: { refreshToken, connectedAt: nowIso() } });
  await ringConnect(); return ring.cameras.map((c) => c.name);
}
app.post(['/api/ring/login', '/api/setup/ring/login'], requireRole('admin'), express.json(), requirePro, async (req, res) => {
  const { email, password, code } = req.body || {};
  try {
    if (code) {
      if (!ring.pending) return res.status(409).json({ error: 'start again with your e-mail and password' });
      const auth = await ring.pending.getAuth(String(code).trim());
      ring.pending = null;
      return res.json({ ok: true, cameras: await ringSave(auth.refresh_token) });
    }
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
app.get('/api/ring/status', requirePro, (_req, res) => res.json({ connected: !!ring.api, error: ring.error, cameras: ring.cameras.map((c) => ({ id: String(c.id), name: c.name, battery: c.batteryLevel ?? null, doorbell: !!c.isDoorbot })), events: ring.events.slice(0, 20) }));
app.get('/api/ring/:id/snapshot', requirePro, async (req, res) => {
  const cam = ring.cameras.find((c) => String(c.id) === req.params.id);
  if (!cam) return res.status(404).end();
  return sendSnap(req, res, `ring:${cam.id}`, async () => ({ buf: await cam.getSnapshot(), type: 'image/jpeg' }), 'ring');
});
PROVIDERS.ring = { async list() { return proStatus().pro ? ring.cameras.map((c) => ({ id: `ring:${c.id}`, provider: 'ring', kind: 'camera', name: c.name, battery: c.batteryLevel ?? null, online: true, snapshot: `/api/ring/${c.id}/snapshot` })) : []; } };
