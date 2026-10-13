/* ======================================================================
 * HouseOS Pro - the license key.
 *
 * A key is "<payload>.<signature>", both base64url: the payload is JSON
 * { email, plan: monthly|yearly|lifetime, homes, expires (ISO or null), issued },
 * signed with HouseOS's private Ed25519 key (kept offline, see
 * tools/license-sign.mjs). Checked here, offline, with the public key below -
 * no phone-home. Every new install gets a 14-day Pro trial from setup day.
 * A monthly/yearly key that lapses keeps working for 14 days, then Pro
 * features switch off; nothing is deleted.
 * ====================================================================== */
const LICENSE_PUBLIC_KEY = crypto.createPublicKey({ key: Buffer.from('MCowBQYDK2VwAyEABf+qQNUoFUyjunG6K/hZL7XnsA+950eq2nek4Sg/j7U=', 'base64'), format: 'der', type: 'spki' });
const TRIAL_DAYS = 14, GRACE_DAYS = 14;
const b64u = (b) => Buffer.from(b).toString('base64url');
function checkLicenseKey(key) {
  const [p, s] = String(key || '').trim().split('.');
  if (!p || !s) return { valid: false, why: 'that is not a HouseOS license key' };
  let payload;
  try { payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return { valid: false, why: 'that key is damaged - copy it again' }; }
  if (!crypto.verify(null, Buffer.from(p), LICENSE_PUBLIC_KEY, Buffer.from(s, 'base64url'))) return { valid: false, why: 'that key was not issued by HouseOS' };
  return { valid: true, payload };
}
function proStatus() {
  if (process.env.HOUSEOS_PRO_DEV === '1') return { pro: true, plan: 'developer', why: 'HOUSEOS_PRO_DEV=1' };
  const lic = config.license ? checkLicenseKey(config.license) : null;
  if (lic?.valid) {
    const exp = lic.payload.expires ? Date.parse(lic.payload.expires) : null;
    if (!exp || Date.now() < exp + GRACE_DAYS * 86400_000) return { pro: true, plan: lic.payload.plan, email: lic.payload.email, expires: lic.payload.expires || null, grace: exp && Date.now() > exp };
    return { pro: false, plan: 'free', expired: lic.payload.expires, why: 'your Pro subscription ended' };
  }
  const start = Date.parse(config.setupAt || '') || Date.now();
  const left = Math.ceil((start + TRIAL_DAYS * 86400_000 - Date.now()) / 86400_000);
  return left > 0 ? { pro: true, plan: 'trial', trialDaysLeft: left } : { pro: false, plan: 'free', trialEnded: true };
}
/** Route guard: Pro features answer 402 with what to do. */
const requirePro = (req, res, next) => (proStatus().pro ? next() : res.status(402).json({ error: 'This is a HouseOS Pro feature.', pro: proStatus(), upgrade: 'https://houseos.dev/pro' }));
app.get('/api/license', (_req, res) => res.json(proStatus()));
