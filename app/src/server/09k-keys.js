/* ======================================================================
 * Settings › Health › Secret key: where CasaTorch's secret key is kept (00-keystore.js), and a new key on request.
 *
 * A new key is the owner's call alone, with their password (and two-step code, when it's on) typed again. It is
 * staged and CasaTorch restarts: at the start every saved secret is sealed again with the new key before anything
 * else runs. The settings are copied into the settings history first. A copy of CasaTorch started by hand isn't
 * restarted by anything, so there the new key is used the next time it is started.
 * ====================================================================== */
const KEY_STORE_NAME = { file: 'A file in the data folder (owner-only)', systemd: 'systemd credentials', keychain: 'The macOS Keychain', dpapi: 'Windows data protection', secret: 'A Docker secret or key file outside the data folder' };
function keyView() {
  const v = ksView(), last = ksLastRotation(DATA_DIR);
  return { kind: v.kind, name: KEY_STORE_NAME[v.kind] || v.kind, tpm: v.kind === 'systemd' ? !!v.tpm : null, store: v.store, storeProblem: v.storeProblem,
    locked: v.problem ? { aside: v.problem.aside } : null, rotatedAt: v.rotated?.at || last, lastRotation: v.rotated ? { ok: v.rotated.ok, values: v.rotated.values || 0, failed: v.rotated.failed || 0 } : null,
    restarts: INSTALL !== 'manual', demo: isDemo() };
}
app.get('/api/security/key', requireRole('admin'), (_req, res) => res.json(keyView()));
app.post('/api/security/key/rotate', requireRole('owner'), express.json({ limit: '2kb' }), asyncRoute(async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'The demo doesn\'t change anything.' });
  const u = req.user;
  if (signInOn()) {
    if (!u) return res.status(403).json({ error: 'Only the owner can do that.' });
    if (limited(`pw:${u.id}`, 5)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
    const okPw = await verifySecretAsync(u.password, String(req.body?.password || ''));
    const okCode = !u.totp?.on || await secondFactorAsync(u, req.body?.code);
    if (!okPw || !okCode) { failed(`pw:${u.id}`); return res.status(403).json({ error: u.totp?.on ? 'Your password or code is not right.' : 'Your password is not right.' }); }
  }
  if (fs.existsSync(`${KEY_FILE}.next`)) return res.json({ ok: true, staged: true, restarting: false, message: 'A new key is already waiting for the next start.' });
  try { settingsSnapshot('before-new-key', { force: true }); } catch { /* the rotation itself is safe without it */ }
  ksStageRotation(KEY_FILE);
  audit(req, 'secret key rotation', { store: KS.kind });
  if (INSTALL === 'manual') return res.json({ ok: true, staged: true, restarting: false, message: 'Restart CasaTorch to finish: it seals everything again with the new key as it starts.' });
  try { if (typeof bkFlush === 'function') bkFlush(); } catch { /* the restart saves the rest */ }
  res.json({ ok: true, staged: true, restarting: true, message: 'CasaTorch is restarting with a new secret key - this page reconnects in a few seconds.' });
  setTimeout(() => process.exit(0), 900);   // the service (systemd, launchd, Windows, Docker, Home Assistant) starts it again
}));
/* For Health (79-doctor.js). */
function docKeyStore() {
  const v = keyView();
  if (isDemo()) return chk('keystore', 'safety', 'Secret key', 'ok', ['Kept in {store}.', { store: v.name }]);
  const name = v.kind === 'systemd' && v.tpm ? 'systemd credentials, sealed with this computer\'s TPM2 chip' : v.name;
  if (v.locked) return chk('keystore', 'safety', 'Secret key', 'bad', 'The key store didn\'t open your secret key, so CasaTorch made a new one: saved passwords and keys need entering again. The old key is kept and is put back by itself if the key store opens it again.', { why: v.storeProblem ? fillMsg('The key store is there but didn\'t work: {problem}', { problem: v.storeProblem }) : null, ...(v.storeProblem ? { whyMsg: 'The key store is there but didn\'t work: {problem}', whyVars: { problem: v.storeProblem } } : {}) });
  if (v.lastRotation && v.lastRotation.failed) return chk('keystore', 'safety', 'Secret key', 'warn', ['A new key was made, but {n} saved values couldn\'t be opened and were left as they were.', { n: v.lastRotation.failed }]);
  if (v.kind !== 'file') return chk('keystore', 'safety', 'Secret key', 'ok', ['Kept in {store}.', { store: name }]);
  const why = v.storeProblem ? { why: fillMsg('The key store is there but didn\'t work: {problem}', { problem: v.storeProblem }), whyMsg: 'The key store is there but didn\'t work: {problem}', whyVars: { problem: v.storeProblem } }
    : { why: INSTALL === 'docker' ? 'Add a Docker secret named casatorch_key to keep it apart from the data folder.' : process.platform === 'linux' ? 'This system has no key store CasaTorch can use (systemd 250 or newer).' : 'This system has no key store CasaTorch can use.' };
  return chk('keystore', 'safety', 'Secret key', 'warn', 'Kept in a file in the data folder (owner-only).', why);
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchKeys = { KS, ksOpen, ksText, ksStore, ksMigrate, ksRotatePending, ksStageRotation, ksResealDir, ksReseal, ksKekFrom, ksAes, ksDpapi, keyView, docKeyStore, resetStore: () => { ksMemo = undefined; }, KEY_FILE };
