/* ======================================================================
 * Pro keys without copy and paste.
 *  - "Get my key by e-mail": someone who bought Pro types
 *    the e-mail they bought with, casatorch.com e-mails them a 6-digit code,
 *    and the key comes back here. Only the e-mail and the code are sent.
 *  - Renewal: a monthly or yearly key close to its end date is swapped for
 *    the renewed one (only the key itself is sent). Turning renewal off in
 *    config (licenseRenew: false) means pasting each new key by hand.
 * Keys are still checked here, offline (07-license.js).
 * Both calls also send a short one-way tag of this CasaTorch's random id (never
 * the id itself), so casatorch.com can count how many homes use one key.
 * If casatorch.com can't be reached, nothing breaks: Pro keeps working through
 * a longer grace period (07-license.js) and renewal tries again every 12 hours.
 *  - The daily check: once a day (and when Settings › CasaTorch Pro opens, at
 *    most every 10 minutes) the key is sent to casatorch.com, which says whether
 *    it is still good. That's how a refund, a chargeback, a cancellation or a
 *    revocation reaches this box before the key's own end date. The answer is
 *    kept in license-state.json; casatorch.com not answering changes nothing.
 * ====================================================================== */
const PRO_API = process.env.CASATORCH_PRO_API || 'https://casatorch.com/api/license';
async function proApi(part, body) {
  const r = await fetch(`${PRO_API}/${part}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `casatorch.com answered ${r.status}`), { status: r.status });
  return j;
}
/** A one-way tag for this home (casatorch.com never sees the install id itself). */
const homeTag = () => crypto.createHash('sha256').update(`casatorch-license|${installId()}`).digest('base64url').slice(0, 22);
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
app.post('/api/license/claim/start', requireRole('admin'), express.json(), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!okEmail(email)) return res.status(400).json({ error: 'that e-mail address does not look right' });
  try { res.json(await proApi('claim-start', { email })); } catch (err) { res.status(err.status === 429 ? 429 : 502).json({ error: err.message }); }
});
app.post('/api/license/claim/finish', requireRole('admin'), express.json(), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase(), code = String(req.body?.code || '').replace(/\D/g, '');
  if (!okEmail(email) || code.length !== 6) return res.status(400).json({ error: 'enter the 6-digit code from the e-mail' });
  try {
    const j = await proApi('claim-finish', { email, code, home: homeTag() });
    const chk = checkLicenseKey(j.key);
    if (!chk.valid) throw new Error('the key that came back is not valid - contact support@casatorch.com');   // scrub-ok: public support address
    if (isConfigured() && !isDemo()) saveConfig({ ...config, license: j.key });   // during first setup, setup saves it
    res.json({ ok: true, key: keptSecret('answers.account.license', j.key), plan: chk.payload.plan, expires: chk.payload.expires || null, pro: proStatus() });
  } catch (err) { res.status(err.status === 400 || err.status === 404 ? 400 : err.status === 409 ? 409 : err.status === 429 ? 429 : 502).json({ error: err.message }); }   // 409: the key is already on as many homes as it covers
});
/** Remember what casatorch.com said about this key; when Pro changes because of it, say so in the log, and tell the edge
    gate (Secure Remote Access from away follows Pro). */
function licRemember(key, j, at = new Date().toISOString()) {
  const before = proStatus().pro, prev = licState.check;
  const st = ['active', 'grace', 'expired', 'revoked'].includes(j?.state) ? j.state : j?.revoked ? 'revoked' : null;
  if (!st) return;
  const okIso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  licState.check = { at, kid: licKid(key), state: st, endedAt: okIso(j.endedAt), endsAt: okIso(j.endsAt), reason: typeof j.reason === 'string' ? j.reason.slice(0, 20) : null };
  saveLicState();
  const after = proStatus().pro;
  if (before !== after) {
    console.log(after ? '  pro: casatorch.com says this key is good again - Pro is back' : `  pro: casatorch.com says this key ${st === 'revoked' ? 'was ended' : 'has ended'} - CasaTorch keeps working as Basic`);
    if (typeof audit === 'function') audit(null, after ? 'pro-restored' : 'pro-ended', { state: st });
  }
  if ((before !== after || prev?.state !== st) && config.remote?.on && typeof gateActive === 'function' && gateActive()) gateSync().catch(() => {});
}
async function renewLicense() {
  if (isDemo() || !config.license || config.licenseRenew === false) return false;
  const lic = checkLicenseKey(config.license); if (!lic.valid) return false;
  const { plan, expires } = lic.payload;
  if (!['monthly', 'yearly'].includes(plan) || !expires || Date.parse(expires) - Date.now() > 7 * 86400_000) return false;
  const at = new Date().toISOString(), had = config.license;
  try {
    const j = await proApi('renew', { key: config.license, home: homeTag() });
    licState.renew = { at, unreachable: false, answer: j.key ? 'key' : j.why || 'none' }; saveLicState();
    const next = j.key ? checkLicenseKey(j.key) : null;
    if (next?.valid && (next.payload.plan === 'lifetime' || Date.parse(next.payload.expires || '') > Date.parse(expires))) { saveConfig({ ...config, license: j.key }); console.log('  pro: subscription renewed'); if (config.remote?.on && typeof gateActive === 'function' && gateActive()) gateSync().catch(() => {}); }
    else if (j.revoked) licRemember(had, j, at);
  } catch (err) {
    /* No answer, or casatorch.com itself failing (5xx): that's our outage, so the longer grace applies. A clear
       "no" (4xx) is not. Either way the old key keeps working through its grace days and we try again later. */
    licState.renew = { at, unreachable: !err.status || err.status >= 500, answer: String(err.message || err).slice(0, 80) }; saveLicState();
  }
  return true;
}
/** The daily check: is the key in use still good? Every key is checked, lifetime ones too, and also with renewal
    turned off (pasting keys by hand). Not answering never changes anything. */
let licCheckBusy = null;
async function licenseCheck({ force = false } = {}) {
  if (isDemo() || !config.license) return null;
  const key = config.license, lic = checkLicenseKey(key); if (!lic.valid) return null;
  const last = licCheckFor(key), since = last ? Date.now() - Date.parse(last.at) : Infinity;
  if (since < (force ? 10 * 60_000 : 20 * 3600_000)) return last;
  if (licCheckBusy) return licCheckBusy;
  licCheckBusy = (async () => {
    try { const j = await proApi('check', { key, home: homeTag() }); licRemember(key, j); }
    catch (err) { if (err.status === 400) licRemember(key, { state: 'revoked', reason: 'invalid' }); /* a key casatorch.com never made */ }
    return licCheckFor(key);
  })().finally(() => { licCheckBusy = null; });
  return licCheckBusy;
}
/* Every 6 hours: a key in its last week is renewed (that answer also says when it was revoked), any other key gets its
   daily check. The first run is 2 minutes after start. */
async function licenseTickDaily() { if (!(await renewLicense())) await licenseCheck(); }
setTimeout(() => licenseTickDaily().catch(() => {}), 120_000).unref?.();
setInterval(() => licenseTickDaily().catch(() => {}), 6 * 3600_000).unref?.();
/* Settings › CasaTorch Pro asks for a fresh answer when it opens (at most every 10 minutes). */
app.post('/api/license/check', requireRole('admin'), asyncRoute(async (_req, res) => { await licenseCheck({ force: true }).catch(() => null); res.json({ ok: true, pro: proStatus() }); }));
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchLicCheck = { licenseCheck, renewLicense, licRemember };
