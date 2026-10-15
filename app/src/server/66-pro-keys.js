/* ======================================================================
 * Pro keys without copy and paste.
 *  - "Get my key by e-mail": someone who bought Pro types
 *    the e-mail they bought with, casatorch.com e-mails them a 6-digit code,
 *    and the key comes back here. Only the e-mail and the code are sent.
 *  - Renewal: a monthly or yearly key close to its end date is swapped for
 *    the renewed one (only the key itself is sent). Turning renewal off in
 *    config (licenseRenew: false) means pasting each new key by hand.
 * Keys are still checked here, offline (07-license.js).
 * ====================================================================== */
const PRO_API = process.env.CASATORCH_PRO_API || 'https://casatorch.com/api/license';
async function proApi(part, body) {
  const r = await fetch(`${PRO_API}/${part}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `casatorch.com answered ${r.status}`), { status: r.status });
  return j;
}
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
    const j = await proApi('claim-finish', { email, code });
    const chk = checkLicenseKey(j.key);
    if (!chk.valid) throw new Error('the key that came back is not valid - contact support@casatorch.com');   // scrub-ok: public support address
    if (isConfigured() && !isDemo()) saveConfig({ ...config, license: j.key });   // during first setup, setup saves it
    res.json({ ok: true, key: j.key, plan: chk.payload.plan, expires: chk.payload.expires || null, pro: proStatus() });
  } catch (err) { res.status(err.status === 400 || err.status === 404 ? 400 : err.status === 429 ? 429 : 502).json({ error: err.message }); }
});
async function renewLicense() {
  if (isDemo() || !config.license || config.licenseRenew === false) return;
  const lic = checkLicenseKey(config.license); if (!lic.valid) return;
  const { plan, expires } = lic.payload;
  if (!['monthly', 'yearly'].includes(plan) || !expires || Date.parse(expires) - Date.now() > 7 * 86400_000) return;
  try {
    const j = await proApi('renew', { key: config.license });
    const next = j.key ? checkLicenseKey(j.key) : null;
    if (next?.valid && Date.parse(next.payload.expires || '9999') > Date.parse(expires)) { saveConfig({ ...config, license: j.key }); console.log('  pro: subscription renewed'); }
  } catch { /* try again later; the old key keeps working through its grace days */ }
}
setTimeout(() => renewLicense().catch(() => {}), 120_000).unref?.();
setInterval(() => renewLicense().catch(() => {}), 12 * 3600_000).unref?.();
