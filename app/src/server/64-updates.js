/* ======================================================================
 * Updates. Once a day CasaTorch asks casatorch.com which version is newest
 * (it sends only its own version and how it was installed) and the app
 * shows "CasaTorch x.y is available" with the right way to update for this
 * install. Boxes and Linux installs also update themselves overnight (the
 * casatorch-update timer from the .deb reads updates.auto below).
 * Settings > Updates turns either off.
 * ====================================================================== */
const UPDATE_URL = process.env.CASATORCH_UPDATE_URL || 'https://casatorch.com/api/latest';
const upd = { latest: null, checked: null, error: null };
const verParts = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) {   // is version a newer than b?
  const x = verParts(a), y = verParts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
const AUTO_INSTALLS = new Set(['deb', 'pi-image']);
const updatePrefs = () => ({ check: config.updates?.check !== false, auto: AUTO_INSTALLS.has(INSTALL) && config.updates?.auto !== false });
async function checkUpdates() {
  if (isDemo() || !updatePrefs().check) return upd;
  try {
    const r = await fetch(`${UPDATE_URL}?v=${encodeURIComponent(VERSION)}&i=${encodeURIComponent(INSTALL)}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`casatorch.com answered ${r.status}`);
    const j = await r.json();
    if (!j?.version) throw new Error('no version in the answer');
    upd.latest = j; upd.error = null;
  } catch (err) { upd.error = String(err.message || err); }
  upd.checked = nowIso();
  return upd;
}
setTimeout(() => checkUpdates().catch(() => {}), 90_000).unref?.();
setInterval(() => checkUpdates().catch(() => {}), 24 * 3600_000).unref?.();
const HOW_TO_UPDATE = {
  'ha-addon': 'Home Assistant shows the update under Settings > Add-ons > CasaTorch - click Update. Your settings are kept.',
  docker: 'Pull the new image and recreate the container - in Portainer or your NAS app choose "Pull and redeploy" (or run docker compose pull, then docker compose up -d). Your settings are kept.',
  deb: 'It installs itself overnight. To update now, download the new .deb from casatorch.com/download and open it.',
  'pi-image': 'It installs itself overnight - nothing to do.',
  windows: 'Download the new installer from casatorch.com/download and run it. Your settings are kept.',
  macos: 'Download the new installer from casatorch.com/download and open it. Your settings are kept.',
  manual: 'Pull the latest code (git pull), then restart CasaTorch.',
};
function updateView() {
  const l = upd.latest, prefs = updatePrefs();
  return {
    version: VERSION, install: INSTALL, ...prefs, canAuto: AUTO_INSTALLS.has(INSTALL),
    latest: l?.version || null, available: !!(l && isNewer(l.version, VERSION)),
    notes: l?.notes || null, published: l?.published || null,
    how: HOW_TO_UPDATE[INSTALL] || HOW_TO_UPDATE.manual, download: 'https://casatorch.com/download/',
    checked: upd.checked, error: upd.error,
  };
}
app.get('/api/updates', (_req, res) => res.json(updateView()));
app.post('/api/updates', requireRole('admin'), express.json(), async (req, res) => {
  const b = req.body || {};
  if ('check' in b || 'auto' in b) {
    const next = { ...(config.updates || {}) };
    if ('check' in b) next.check = !!b.check;
    if ('auto' in b) next.auto = !!b.auto;
    saveConfig({ ...config, updates: next });
  }
  if (b.checkNow) await checkUpdates();
  res.json(updateView());
});
