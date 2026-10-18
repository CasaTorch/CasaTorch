/* ======================================================================
 * Activity: the changes the sign-in code doesn't record itself.
 *
 * Sign-ins, failures, people, two-step sign-in and panels are written to
 * the audit log by 08-signin.js. This adds the rest an owner wants to see in
 * Settings › People & sign-in › Activity: settings changes, secure access
 * and the secure address at home turned on or off, alerts turned on or off
 * on a device, pairing codes, safety exceptions, exports and downloads.
 *
 * Only WHAT changed is recorded - the names of the settings, never their
 * values (no passwords, tokens, addresses or names). It runs after the
 * answer is sent, only for changes that worked, and never slows a request.
 * Kept for a year, at most 5,000 events (80-support.js trims it daily).
 * ====================================================================== */
const ACT_RULES = [
  // [method, path pattern, event, detail(body, match)]
  ['PUT', /^\/api\/settings$/, 'settings-changed', (b) => ({ fields: actFields(b) })],
  ['POST', /^\/api\/settings\/rerun-setup$/, 'setup-reopened'],
  ['PUT', /^\/api\/settings\/ai$/, 'ai-settings-changed', (b) => ({ fields: actFields(b) })],
  ['POST', /^\/api\/license$/, 'license-added'],
  ['DELETE', /^\/api\/license$/, 'license-removed'],
  ['PUT', /^\/api\/safety\/[^/]+$/, 'safety-exception-changed', (b) => ({ allowed: b?.allow === true })],
  ['POST', /^\/api\/remote\/on$/, 'secure-access-on'],
  ['POST', /^\/api\/remote\/off$/, 'secure-access-off'],
  ['POST', /^\/api\/local-https\/on$/, 'home-https-on'],
  ['POST', /^\/api\/local-https\/off$/, 'home-https-off'],
  ['POST', /^\/api\/push$/, 'alerts-device-on'],
  ['DELETE', /^\/api\/push\/[^/]+$/, 'alerts-device-off'],
  ['POST', /^\/api\/app\/push$/, 'alerts-phone-on'],
  ['DELETE', /^\/api\/app\/push$/, 'alerts-phone-off'],
  ['PUT', /^\/api\/alerts\/settings$/, 'alert-settings-changed', (b) => ({ fields: actFields(b) })],
  ['POST', /^\/api\/app\/pair$/, 'pairing-code-made'],
  ['PUT', /^\/api\/security\/settings$/, 'security-settings-changed', (b) => ({ fields: actFields(b) })],
  ['POST', /^\/api\/updates$/, 'update-settings-changed', (b) => (b && ('check' in b || 'auto' in b) ? { fields: actFields({ check: b.check, auto: b.auto }) } : null)],
  ['POST', /^\/api\/find$/, 'find-setting-changed'],
  ['DELETE', /^\/api\/connections\/[^/]+$/, null],   // 28-connections.js records it itself
  ['GET', /^\/api\/floorplan\/export$/, 'floorplan-exported'],
  ['GET', /^\/api\/system\/diagnostics$/, 'diagnostics-downloaded'],
  ['POST', /^\/api\/floorplan\/import\/apply$/, 'floorplan-imported'],
];
/* The names of what changed - short, plain keys only (a value never goes in). */
const actFields = (b) => Object.keys(b && typeof b === 'object' && !Array.isArray(b) ? b : {}).filter((k) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k) && b[k] !== undefined).slice(0, 20);
/** Which activity event a finished request is, or null. Pure (unit-tested). */
function activityFor(method, p, status, body) {
  if (!(status >= 200 && status < 400)) return null;
  const path = String(p || '').toLowerCase().replace(/\/+$/, '') || '/';   // /API/x and /api/x/ reach the same route
  for (const [m, re, event, detail] of ACT_RULES) {
    if (m !== method || !re.test(path)) continue;
    if (!event) return null;
    const d = detail ? detail(body) : {};
    return d === null ? null : { event, detail: d };
  }
  return null;
}
app.use('/api', (req, res, next) => {
  if (!ACT_RULES.some(([m]) => m === req.method)) return next();
  const p = String(req.originalUrl || '').split('?')[0];
  res.on('finish', () => {
    try {
      const a = activityFor(req.method, p, res.statusCode, req.body);
      if (a && typeof audit === 'function') audit(req, a.event, a.detail);
    } catch { /* never let the activity log break anything */ }
  });
  next();
});
