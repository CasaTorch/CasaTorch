/* ======================================================================
 * Remove CasaTorch (Settings › Updates & backup › Remove CasaTorch): one tap, for the owner, after their password.
 * In order, each step on its own (one that fails doesn't stop the rest, and the answer says how each went):
 *   1. the edge gate's passes revoked (every phone's and browser's access from away ends at Cloudflare at once)
 *   2. Secure access off: the tunnel, its address and the gate's record deleted at casatorch.com
 *   3. the secure address at home off: its DNS name deleted at casatorch.com, the certificate here
 *   4. off "Find my CasaTorch" at casatorch.com
 *   5. every phone and browser signed out (the phones' alerts stop with them)
 *   6. only if asked: everything this CasaTorch keeps is erased (settings, keys, layouts, history), then it stops.
 *      Without it, the settings stay, so installing again (or a backup) brings the home back.
 * The page offers an encrypted backup first (75-backup.js) and then shows how to uninstall the program itself on
 * this kind of computer (the installers' own uninstall: install.sh --uninstall, install.ps1 with CASATORCH_UNINSTALL,
 * the .deb, the macOS uninstaller, Windows Apps, Docker, the Home Assistant add-on).
 * ====================================================================== */
/** How this copy was installed, for the uninstall steps the page shows. */
function installKind() {
  if (process.env.SUPERVISOR_TOKEN) return 'ha-addon';
  const k = String(INSTALL || '').toLowerCase();
  if (['docker', 'deb', 'script', 'macos', 'windows', 'pi-image', 'ha-addon'].includes(k)) return k === 'pi-image' ? 'deb' : k;
  return process.platform === 'win32' ? 'windows' : 'manual';
}
/** Run the steps (each given as a function so a test can stand in for casatorch.com). Never throws. */
async function removeSteps(steps) {
  const out = [];
  for (const [id, fn] of steps) {
    try { const r = await Promise.race([Promise.resolve().then(fn), sleep(25_000).then(() => { throw new Error('took too long'); })]); out.push({ id, ok: r?.ok !== false, ...(r?.skipped ? { skipped: true } : {}), ...(r?.note ? { note: String(r.note) } : {}) }); }
    catch (e) { out.push({ id, ok: false, error: String(e?.message || e).slice(0, 200) }); }
  }
  return out;
}
/** Sign every phone and browser out (the owner's own browser last, by the caller's choice). */
function signEveryoneOut() {
  const n = Object.keys(sessions).length;
  for (const k of Object.keys(sessions)) delete sessions[k];
  saveSessions();
  if (typeof push === 'object' && push) { push.apps = []; push.subs = []; if (typeof savePush === 'function') savePush(); }
  return { ok: true, note: `${n}` };
}
/** Is this a folder CasaTorch may empty? Its own data folder only: never the root, a home folder or a short path. */
function eraseableDir(dir) {
  const d = path.resolve(String(dir || ''));
  if (d.split(path.sep).filter(Boolean).length < 2 || d === path.resolve(os.homedir())) return false;
  return fs.existsSync(path.join(d, 'config.json')) || fs.existsSync(path.join(d, 'secret.key'));
}
function eraseData(dir = DATA_DIR) {
  if (!eraseableDir(dir)) throw new Error('That folder doesn\'t look like CasaTorch\'s own, so nothing was erased.');
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
}
let removing = false;
app.post('/api/remove-casatorch', requireRole('owner'), express.json({ limit: '2kb' }), asyncRoute(async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  if (signInOn() && limited(`pw:${req.user.id}`, 5)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  if (signInOn() && !await verifySecretAsync(req.user.password, req.body?.password || '')) { failed(`pw:${req.user.id}`); return res.status(403).json({ error: 'that password is not right' }); }
  if (gateIsRemote(req) && req.session?.kind !== 'app') return res.status(403).json({ error: 'Remove CasaTorch at home, on the same network as it.' });   // the tunnel it deletes is the one this request came through
  if (removing) return res.status(409).json({ error: 'CasaTorch is being removed already.' });
  removing = true;
  const erase = req.body?.erase === true;
  audit(req, 'casatorch-removed', { erase });
  try {
    const steps = await removeSteps([
      ['passes', async () => (gateActive() ? { ok: !!(await gateChange((st) => { st.epoch += 1; st.browsers = []; })).ok } : { skipped: true })],
      ['secure-access', async () => { const r = await remoteOffNow(); return r.had ? { ok: r.gone } : { skipped: true }; }],
      ['home-address', async () => { const r = await ltOffNow(); return r.had ? { ok: r.gone } : { skipped: true }; }],
      ['find', async () => { if (!findOn()) return { skipped: true }; saveConfig({ ...config, find: { announce: false } }); const body = { id: installId() }; await Promise.race([Promise.all([postFamily(body, 4, 'DELETE', 3000), postFamily(body, 6, 'DELETE', 3000)]), sleep(3500)]); return { ok: true }; }],
      ['sign-out', () => signEveryoneOut()],
    ]);
    if (erase) steps.push({ id: 'erase', ok: eraseableDir(DATA_DIR), ...(eraseableDir(DATA_DIR) ? {} : { error: 'That folder doesn\'t look like CasaTorch\'s own, so nothing was erased.' }) });
    res.setHeader('Set-Cookie', `casatorch_session=; ${cookieFlags(req)}; Max-Age=0`);
    res.json({ ok: steps.every((s) => s.ok), steps, install: installKind(), erased: erase && steps.at(-1).ok });
    if (erase && steps.at(-1).ok && process.env.CASATORCH_TEST !== '1') setTimeout(() => { try { eraseData(); } catch (e) { console.error(`  remove: ${e.message}`); } process.exit(0); }, 800);
  } finally { if (!erase) removing = false; }
}));
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchRemove = { removeSteps, eraseableDir, installKind };
