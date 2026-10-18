/* ======================================================================
 * CasaTorch Pro - the license key.
 *
 * A key is "<payload>.<signature>", both base64url: the payload is JSON
 * { email, plan: monthly|yearly|lifetime, homes, expires (ISO or null), issued },
 * signed with CasaTorch's private Ed25519 key (kept offline, see
 * tools/license-sign.mjs, and as a secret on casatorch.com - never in this repo).
 * Checked here, offline, with the public key below - no phone-home.
 *
 * Trial: every new install gets 14 days of Pro from setup day. The start is
 * also kept in license-state.json (it survives "run setup again"), and the
 * box counts the time it has actually been running: the trial ends after 14
 * days by the calendar OR 14 days of running time, so setting the clock back
 * doesn't stretch it.
 *
 * After a monthly/yearly key's end date Pro keeps working for 14 days (grace),
 * or 30 days when casatorch.com couldn't be reached to fetch the renewed key -
 * an outage on our side never switches anyone's Pro off. Then Pro features
 * switch off; nothing is deleted, and core home control and safety alerts are
 * never part of Pro.
 * ====================================================================== */
let LICENSE_PUBLIC_KEY = crypto.createPublicKey({ key: Buffer.from('MCowBQYDK2VwAyEABf+qQNUoFUyjunG6K/hZL7XnsA+950eq2nek4Sg/j7U=', 'base64'), format: 'der', type: 'spki' });   // `let` only so the unit tests can use a key of their own (below)
const TRIAL_DAYS = 14, GRACE_DAYS = 14, OFFLINE_GRACE_DAYS = 30, LIC_PLANS = new Set(['monthly', 'yearly', 'lifetime']);
const b64u = (b) => Buffer.from(b).toString('base64url');
/* proStatus() runs on many requests: the signature check of the saved key is done once, not every time. */
let licenseMemo = { key: null, out: null };
function checkLicenseKey(key) {
  const k = String(key || '');
  if (licenseMemo.key === k) return licenseMemo.out;
  const out = checkLicenseKeyNow(k);
  licenseMemo = { key: k, out };
  return out;
}
function checkLicenseKeyNow(key) {
  const [p, s, extra] = String(key || '').trim().split('.');
  if (!p || !s || extra !== undefined) return { valid: false, why: 'that is not a CasaTorch license key' };
  let payload;
  try { payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return { valid: false, why: 'that key is damaged - copy it again' }; }
  let sigOk = false;
  try { sigOk = crypto.verify(null, Buffer.from(p), LICENSE_PUBLIC_KEY, Buffer.from(s, 'base64url')); } catch { sigOk = false; }
  if (!sigOk) return { valid: false, why: 'that key was not issued by CasaTorch' };
  /* Signed by us, but still checked: an unknown plan, or a dated plan with no readable end date, never counts as "forever". */
  if (!payload || typeof payload !== 'object' || !LIC_PLANS.has(payload.plan)) return { valid: false, why: 'that key is for a plan this version of CasaTorch doesn\'t know - update CasaTorch' };
  if (payload.plan !== 'lifetime' && !Number.isFinite(Date.parse(payload.expires || ''))) return { valid: false, why: 'that key has no end date - contact support@casatorch.com' };   // scrub-ok: public support address
  return { valid: true, payload };
}

/* ---- what the box remembers about its license (license-state.json, owner-only) ---- */
const LICENSE_STATE_FILE = path.join(DATA_DIR, 'license-state.json');
const licState = { trialStart: null, runMs: 0, renew: null };
try { Object.assign(licState, JSON.parse(fs.readFileSync(LICENSE_STATE_FILE, 'utf8'))); } catch { /* first start */ }
let licStateDirty = false;
function saveLicState() {
  if (process.env.CASATORCH_DEMO === '1') return;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileSafe(LICENSE_STATE_FILE, JSON.stringify(licState), 0o600); licStateDirty = false; } catch { licStateDirty = true; /* read-only disk: try again later */ }
}
/* Running time, from the monotonic clock (setting the wall clock back or forward doesn't change it). */
let licTickAt = performance.now();
function licenseTick() {
  const now = performance.now(), d = Math.max(0, Math.min(now - licTickAt, 11 * 60_000)); licTickAt = now;   // a sleeping computer counts at most one tick
  if (!isConfigured() || isDemo()) return;
  licState.runMs = (Number(licState.runMs) || 0) + d;
  const fromSetup = Date.parse(config.setupAt || '');
  if (!licState.trialStart && Number.isFinite(fromSetup)) licState.trialStart = new Date(fromSetup).toISOString();
  saveLicState();
}
setInterval(() => { try { licenseTick(); } catch { /* next time */ } }, 10 * 60_000).unref?.();

/** When the trial began: setup day, or the remembered start if that is earlier (a re-run of setup can't restart it). */
function trialStartMs() {
  const a = Date.parse(config.setupAt || ''), b = Date.parse(licState.trialStart || '');
  const list = [a, b].filter(Number.isFinite);
  return list.length ? Math.min(...list) : Date.now();
}
/** Days of trial left: the smaller of the calendar and the running-time count. */
function trialDaysLeft(now = Date.now()) {
  const byCalendar = (trialStartMs() + TRIAL_DAYS * 86400_000 - now) / 86400_000;
  const byRunning = TRIAL_DAYS - (Number(licState.runMs) || 0) / 86400_000;
  return Math.ceil(Math.min(byCalendar, byRunning));
}
/** Grace after the end date: longer when the last renewal try couldn't reach casatorch.com at all. */
const licGraceDays = () => (licState.renew?.unreachable ? OFFLINE_GRACE_DAYS : GRACE_DAYS);

function proStatus() {
  if (process.env.CASATORCH_PRO_DEV === '1') return { pro: true, plan: 'developer', why: 'CASATORCH_PRO_DEV=1' };
  const lic = config.license ? checkLicenseKey(config.license) : null;
  if (lic?.valid) {
    const exp = lic.payload.plan === 'lifetime' ? null : Date.parse(lic.payload.expires);
    const grace = licGraceDays();
    if (!exp || Date.now() < exp + grace * 86400_000) {
      const inGrace = !!exp && Date.now() > exp;
      return { pro: true, plan: lic.payload.plan, email: lic.payload.email, expires: lic.payload.expires || null, grace: inGrace, ...(inGrace ? { graceDaysLeft: Math.max(1, Math.ceil((exp + grace * 86400_000 - Date.now()) / 86400_000)) } : {}) };
    }
    return { pro: false, plan: 'free', expired: lic.payload.expires, why: 'your Pro subscription ended', note: 'Pro has ended on this CasaTorch. Nothing was deleted - your 3D home, history and settings come back as soon as Pro is on again.' };
  }
  const left = trialDaysLeft();
  return left > 0 ? { pro: true, plan: 'trial', trialDaysLeft: Math.min(TRIAL_DAYS, left) } : { pro: false, plan: 'free', trialEnded: true, note: 'Your Pro trial has ended. Nothing was deleted - everything you set up in Pro comes back when you add a key.' };
}
/** Route guard: Pro features answer 402 with what to do (never for core home control or safety alerts). */
const requirePro = (req, res, next) => { const p = proStatus(); return p.pro ? next() : res.status(402).json({ error: 'This is a CasaTorch Pro feature.', pro: p, upgrade: 'https://casatorch.com/pro', kept: 'Nothing you made with Pro has been deleted.' }); };
app.get('/api/license', (req, res) => { const p = proStatus(); if (signInOn() && !sessionOf(req)) { const { email, ...rest } = p; return res.json(rest); } res.json(p); });   // the e-mail only for people signed in
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchLicense = { checkLicenseKeyNow, proStatus, trialDaysLeft, trialStartMs, licState, licenseTick, TRIAL_DAYS, GRACE_DAYS, OFFLINE_GRACE_DAYS,
  useTestKey: (pub) => { LICENSE_PUBLIC_KEY = pub; licenseMemo = { key: null, out: null }; },   // tests only (CASATORCH_TEST=1)
  patchConfig: (p) => { const was = config; config = { ...config, ...p }; licenseMemo = { key: null, out: null }; return () => { config = was; licenseMemo = { key: null, out: null }; }; } };
