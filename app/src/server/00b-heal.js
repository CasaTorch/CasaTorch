/* ======================================================================
 * Self-healing at start: CasaTorch's own files can't take the house down.
 *
 *  - Settings history: a copy of config.json, users.json and secret.key in
 *    data/.settings-history/ whenever they change (checked every 10 minutes),
 *    before setup changes, before a restore and when CasaTorch starts a new
 *    version. The newest 10 and one a day for two weeks are kept. Settings ›
 *    Health lists them and puts one back with a tap.
 *  - A damaged settings or sign-in file (a disk error, an editor that saved
 *    half a file) is put aside - never deleted - and the last good copy is used.
 *  - A key file that no longer opens the settings (replaced or regenerated) is
 *    swapped for the copy that does, if there is one.
 *  - Crash loop: if CasaTorch stops within a minute and a half of starting,
 *    three times in a row, right after its settings changed, it goes back to the
 *    settings it last ran well with (the newer ones are kept in the history).
 *  - Stuck: a watchdog thread restarts CasaTorch if it stops responding for two
 *    minutes (the service manager - systemd, launchd, Docker, Home Assistant,
 *    Windows - starts it again).
 * What it did is listed in Settings › Health (HEAL below).
 * ====================================================================== */
import { Worker } from 'node:worker_threads';
const HEAL = [];   // { at, what, detail } - what CasaTorch fixed by itself, newest last
const healNote = (what, detail) => { HEAL.push({ at: new Date().toISOString(), what, detail }); if (HEAL.length > 50) HEAL.shift(); };
const SH_DIR = path.join(DATA_DIR, '.settings-history');
const SH_FILES = ['config.json', 'users.json', 'secret.key'];
const shSource = (f) => (f === 'config.json' ? CONFIG_FILE : path.join(DATA_DIR, f));
const shStamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');   // 20261017T101500Z
const shTime = (id) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(id); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN; };
const shReadable = (file, kind) => { try { const t = fs.readFileSync(file, 'utf8'); if (kind === 'secret.key') return Buffer.from(t.trim(), 'base64').length === 32; const j = JSON.parse(t); return !!j && typeof j === 'object'; } catch { return false; } };
/** Snapshot ids, newest first. */
function settingsHistory(dir = SH_DIR) {
  let list = []; try { list = fs.readdirSync(dir).filter((n) => /^\d{8}T\d{6}Z-[a-z0-9-]{1,40}$/.test(n)); } catch { /* none yet */ }
  return list.sort().reverse();
}
/** Which snapshots to delete: keep the newest `keep`, plus the newest of each day for `days` days. */
function settingsPrune(ids, now = Date.now(), keep = 10, days = 14) {
  const sorted = [...ids].sort().reverse(), keepSet = new Set(sorted.slice(0, keep)), seenDay = new Set();
  for (const id of sorted) { const t = shTime(id), day = id.slice(0, 8); if (now - t <= days * 86400_000 && !seenDay.has(day)) { seenDay.add(day); keepSet.add(id); } }
  return sorted.filter((id) => !keepSet.has(id));
}
const shHash = (dir, rel = (f) => path.join(dir, f)) => { const h = crypto.createHash('sha256'); for (const f of ['config.json', 'users.json']) { try { h.update(fs.readFileSync(rel(f))); } catch { h.update('-'); } } return h.digest('hex'); };
/** Copy the current settings into the history (only if they're readable and changed). Returns the id, or null. */
function settingsSnapshot(reason = 'auto', { force = false, dir = SH_DIR, source = shSource } = {}) {
  try {
    if (!fs.existsSync(source('config.json')) || !shReadable(source('config.json'), 'config.json')) return null;   // never keep a broken copy as "good"
    const last = settingsHistory(dir)[0];
    if (!force && last && shHash(path.join(dir, last)) === shHash(null, source)) return null;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = `${shStamp()}-${String(reason).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40)}`, to = path.join(dir, id);
    if (fs.existsSync(to)) return null;
    fs.mkdirSync(to, { mode: 0o700 });
    for (const f of SH_FILES) { try { writeFileSafe(path.join(to, f), fs.readFileSync(source(f)), 0o600); } catch { /* not there yet */ } }
    for (const old of settingsPrune(settingsHistory(dir))) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
    return id;
  } catch { return null; }
}
/** Put a snapshot back (the current files are kept in the history first). */
function settingsRestore(id, { dir = SH_DIR, source = shSource, files = SH_FILES } = {}) {
  if (!/^\d{8}T\d{6}Z-[a-z0-9-]{1,40}$/.test(String(id)) || !fs.existsSync(path.join(dir, id))) throw new Error('That copy is no longer there.');
  if (!shReadable(path.join(dir, id, 'config.json'), 'config.json')) throw new Error('That copy is damaged - pick another one.');
  settingsSnapshot('before-putting-back', { force: true, dir, source });
  for (const f of files) { const from = path.join(dir, id, f); if (fs.existsSync(from) && shReadable(from, f)) writeFileSafe(source(f), fs.readFileSync(from), 0o600); }
}
/** A damaged file: moved aside (kept), and the newest readable copy from the history put in its place. */
function healFile(f, { dir = SH_DIR, source = shSource } = {}) {
  const file = source(f);
  if (!fs.existsSync(file) || shReadable(file, f)) return null;
  // Not allowed to read it (a permissions slip) isn't damage: never write over it - the recovery page says what to do.
  try { fs.readFileSync(file); } catch { return null; }
  // A save that was cut off just before the swap leaves a complete temp file next to it.
  const tmps = (() => { try { return fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.`) && n.endsWith('.tmp')).map((n) => path.join(path.dirname(file), n)); } catch { return []; } })()
    .filter((p) => shReadable(p, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const snap = settingsHistory(dir).find((id) => shReadable(path.join(dir, id, f), f));
  const from = tmps[0] || (snap ? path.join(dir, snap, f) : null);
  const aside = `${file}.damaged-${shStamp()}`;
  try { fs.copyFileSync(file, aside); } catch { /* keep going */ }
  if (!from) return { file: f, aside: path.basename(aside), from: null };
  writeFileSafe(file, fs.readFileSync(from), 0o600);
  return { file: f, aside: path.basename(aside), from: tmps[0] ? 'a save that was cut off' : snap };
}
/* Every other file CasaTorch keeps. One that no longer reads (a power cut can leave a file on an SD card empty or half
   written) is set aside - kept, never deleted - and a complete save that was cut off just before its swap is used
   when there is one. Without this, that part would start empty and its next save would write over what is left. */
const DATA_FILES = { 'events.json': 'Your calendar', 'family.json': 'The Family board', 'household.json': 'Household', 'nudges.json': 'Reminders',
  'history.json': 'Energy history', 'replay.json': 'The 3D Home replay', 'alerts.json': 'Alerts', 'layout.json': 'Your screen layout', 'screen-layouts.json': 'Your screen layouts', 'page-layouts.json': 'Your page layouts', 'energy-hours.json': 'Energy hour by hour',
  'push.json': 'Phone alerts', 'sessions.json': 'Sign-in sessions', 'apptests.json': 'App test history', 'power-baseline.json': 'Usual power use', 'security.json': 'Network security',
  'floorplan/floorplan.json': 'Your 3D Home plan', 'setup-progress.json': 'Setup progress', 'tls/state.json': 'The secure address at home', '.health.json': 'Health' };
function healData(f, { dir = DATA_DIR } = {}) {
  const file = path.join(dir, f);
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }   // not there, or not allowed (not damage)
  try { const j = JSON.parse(raw); if (j && typeof j === 'object') return null; } catch { /* damaged */ }
  const tmps = (() => { try { return fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.`) && n.endsWith('.tmp')).map((n) => path.join(path.dirname(file), n)); } catch { return []; } })()
    .filter((t) => { try { const j = JSON.parse(fs.readFileSync(t, 'utf8')); return !!j && typeof j === 'object'; } catch { return false; } }).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const aside = `${file}.damaged-${shStamp()}`;
  try { fs.copyFileSync(file, aside); } catch { /* keep going */ }
  try { if (tmps[0]) writeFileSafe(file, fs.readFileSync(tmps[0]), 0o600); else fs.rmSync(file, { force: true }); } catch { return null; }
  return { file: f, aside: path.basename(aside), recovered: !!tmps[0] };
}
const sealedSample = (o) => { if (typeof o === 'string') return SEALED.test(o) ? o : null; if (o && typeof o === 'object') for (const v of Object.values(o)) { const s = sealedSample(v); if (s) return s; } return null; };
const opensWith = (sealed, key) => { try { const [, iv, enc, tag] = sealed.split('.'); const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url')); d.update(Buffer.from(enc, 'base64url')); d.final(); return true; } catch { return false; } };
/** The key file doesn't open the settings, but a copy in the history does: use that copy (the other is kept aside). */
function healKey({ dir = SH_DIR } = {}) {
  let disk; try { disk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
  const sample = sealedSample(disk); if (!sample) return null;
  let cur = null; try { cur = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64'); } catch { /* missing */ }
  if (cur?.length === 32 && opensWith(sample, cur)) return null;
  for (const id of settingsHistory(dir)) {
    let k; try { k = Buffer.from(fs.readFileSync(path.join(dir, id, 'secret.key'), 'utf8').trim(), 'base64'); } catch { continue; }
    if (k.length === 32 && opensWith(sample, k)) {
      try { if (fs.existsSync(KEY_FILE)) fs.copyFileSync(KEY_FILE, `${KEY_FILE}.unmatched-${shStamp()}`); } catch { /* keep going */ }
      writeFileSafe(KEY_FILE, `${k.toString('base64')}`, 0o600);
      return { from: id };
    }
  }
  return { from: null };
}

/* ---- at start ---- */
let configAside = null;   // the copy of a damaged config.json that couldn't be repaired
const BOOT_FILE = path.join(DATA_DIR, '.boot.json');
const bootState = (() => { try { return JSON.parse(fs.readFileSync(BOOT_FILE, 'utf8')) || {}; } catch { return {}; } })();
const bootSave = () => { try { writeFileSafe(BOOT_FILE, JSON.stringify(bootState), 0o600); } catch { /* read-only data folder: Health says so */ } };
if (process.env.CASATORCH_TEST !== '1' && !isDemo()) {
  try {
    for (const f of ['config.json', 'users.json']) {
      const r = healFile(f);
      if (r?.from) { healNote(f === 'config.json' ? 'settings-repaired' : 'sign-ins-repaired', `${f === 'config.json' ? 'Your settings file' : 'The sign-in file'} was damaged, so CasaTorch went back to ${r.from === 'a save that was cut off' ? 'the last save' : 'the last good copy'}. The damaged file was kept as ${r.aside}.`); if (f === 'config.json') loadConfig(); }
      else if (r) { healNote(f === 'config.json' ? 'settings-damaged' : 'sign-ins-damaged', `${f === 'config.json' ? 'Your settings file' : 'The sign-in file'} is damaged and there was no good copy to go back to. It was kept as ${r.aside}.`); if (f === 'config.json') configAside = r.aside; }
    }
    const dmg = Object.keys(DATA_FILES).map((f) => healData(f)).filter(Boolean), names = (l) => l.map((r) => DATA_FILES[r.file]).join(', ').replace(/, ([^,]*)$/, ' and $1');
    const fixed = dmg.filter((r) => r.recovered), lost = dmg.filter((r) => !r.recovered);
    if (fixed.length) healNote('data-repaired', `${names(fixed)} ${fixed.length === 1 ? 'was' : 'were'} cut off while saving, so CasaTorch used the last complete save. The damaged ${fixed.length === 1 ? 'file was' : 'files were'} kept (named ...damaged-...).`);
    if (lost.length) healNote('data-damaged', `${names(lost)} couldn't be read (damaged, often by a power cut), so ${lost.length === 1 ? 'it starts' : 'they start'} again empty. The damaged ${lost.length === 1 ? 'file was' : 'files were'} kept (named ...damaged-...); restoring a backup puts ${lost.length === 1 ? 'it' : 'them'} back.`);
    for (const r of dmg) console.warn(`Self-check: ${r.file} was damaged; kept as ${r.aside}${r.recovered ? ', the last complete save was used' : ''}.`);
    const k = healKey();
    if (k?.from) { secretKey = null; loadConfig(); healNote('key-repaired', 'The key that unlocks your saved passwords had changed, so CasaTorch put back the matching key from your settings history.'); }
    else if (k) healNote('key-mismatch', 'The key that unlocks your saved passwords doesn\'t match your settings, and no copy does. Restore a backup, or enter passwords and keys again.');
    /* Crash loop right after a settings change: back to the settings it last ran well with. */
    if (bootState.running) bootState.fails = (bootState.fails || 0) + 1; else bootState.fails = 0;
    let cfgTime = 0; try { cfgTime = fs.statSync(CONFIG_FILE).mtimeMs; } catch { /* none */ }
    const good = bootState.healthyAt ? Date.parse(bootState.healthyAt) : 0;
    // Only when this is the same version that last ran well (a crash right after an update is the update, not the settings).
    if (bootState.fails >= 3 && good && cfgTime > good && bootState.rolledBackFor !== bootState.healthyAt && (!bootState.healthyVersion || bootState.healthyVersion === VERSION)) {
      const snap = settingsHistory().find((id) => shTime(id) <= good + 1000 && shReadable(path.join(SH_DIR, id, 'config.json'), 'config.json'));
      if (snap) {
        // the settings only: sign-ins (a changed password, a removed login) and the key stay as they are
        settingsRestore(snap, { files: ['config.json'] }); loadConfig(); bootState.rolledBackFor = bootState.healthyAt; bootState.fails = 0;
        healNote('crash-rollback', `CasaTorch kept stopping right after its settings changed, so it went back to the settings from ${new Date(shTime(snap)).toISOString().slice(0, 16).replace('T', ' ')} UTC. The newer ones are kept in your settings history.`);
      }
    }
    if (bootState.hangAt && bootState.hangAt !== bootState.hangSeen) { healNote('hang-restart', 'CasaTorch stopped responding, so it restarted itself.'); bootState.hangSeen = bootState.hangAt; }
    if (bootState.version && bootState.version !== VERSION) settingsSnapshot(`before-${VERSION.replace(/\./g, '-')}`, { force: true });
    else settingsSnapshot('start');
    Object.assign(bootState, { running: true, startedAt: new Date().toISOString(), version: VERSION });
    bootSave();
    setTimeout(() => { Object.assign(bootState, { healthyAt: new Date().toISOString(), healthyVersion: VERSION, fails: 0 }); bootSave(); }, 90_000).unref?.();
    process.on('exit', (code) => { if (code === 0 || code === 130) { bootState.running = false; bootSave(); } });   // a clean stop or restart doesn't count as a crash
    // Still running well: the copy just kept is "the settings it last ran well with" (not the ones from when it started, weeks ago).
    setInterval(() => { if (isConfigured()) settingsSnapshot('auto'); Object.assign(bootState, { healthyAt: new Date().toISOString(), healthyVersion: VERSION }); bootSave(); }, 10 * 60_000).unref?.();
  } catch (e) { healNote('heal-error', `Self-check at start didn't finish: ${e.message}`); }
  /* The watchdog: a separate thread that restarts CasaTorch if its main thread is stuck for two minutes. */
  if (INSTALL !== 'manual' || process.env.CASATORCH_WATCHDOG === '1') {
    try {
      const beat = new Int32Array(new SharedArrayBuffer(4));
      const now = () => Number(process.hrtime.bigint() / 1_000_000_000n) & 0x7fffffff;   // a steady clock: changing the time of day can't trip it
      Atomics.store(beat, 0, now()); setInterval(() => Atomics.store(beat, 0, now()), 5000).unref?.();
      const w = new Worker(`const { workerData: d } = require('node:worker_threads'); const fs = require('node:fs');
        const now = () => Number(process.hrtime.bigint() / 1000000000n) & 0x7fffffff;
        let tick = now(), suspect = false;   // the whole process paused (a VM or container frozen for a backup) is not "stuck": wait for the next look
        setInterval(() => { const t = now(), paused = t - tick > 30; tick = t; const late = t - Atomics.load(d.beat, 0);
          if (paused || late <= d.limit) { suspect = false; return; } if (!suspect) { suspect = true; return; } {
          try { const s = JSON.parse(fs.readFileSync(d.file, 'utf8')); s.hangAt = new Date().toISOString(); fs.writeFileSync(d.file, JSON.stringify(s), { mode: 0o600 }); } catch {}
          process._rawDebug('CasaTorch stopped responding for ' + late + ' seconds - restarting it.'); process.kill(process.pid, 'SIGKILL'); } }, 10000);`,
      { eval: true, workerData: { beat, limit: Number(process.env.CASATORCH_WATCHDOG_SECONDS) || 120, file: BOOT_FILE } });
      w.unref(); w.on('error', () => {});
    } catch { /* no worker threads here: the service manager's own restart still applies */ }
  }
}
/* The settings file is there but damaged (or can't be read), and there was no good copy to put back. CasaTorch
   doesn't start: the setup wizard would look like a new install and write over the real settings, and every
   integration would run with none. Only a small page says what happened and what to do (503 for every address,
   so installers and health checks see it too); the file is left exactly as it is. */
const recoveryPage = (p, aside) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CasaTorch needs your help</title>
<style>:root{color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--ink:#1d1d1f;--sub:#6e6e73}@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--ink:#f5f5f7;--sub:#a1a1a6}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:16px}main{max-width:560px;margin:8vh auto;background:var(--card);border-radius:18px;padding:28px}
h1{font-size:22px;margin:0 0 8px}p,li{color:var(--sub)}b{color:var(--ink)}code{font:14px ui-monospace,Menlo,monospace}</style></head><body><main>
<h1>CasaTorch can't open its settings</h1>
<p>${p.kind === 'unreadable' ? 'CasaTorch isn\'t allowed to read its settings file, <code>config.json</code>.' : 'Its settings file, <code>config.json</code>, is damaged'}${p.kind === 'unreadable' ? '' : ', and there was no good copy in its settings history to go back to'}. So it hasn't started, and it hasn't changed anything: your settings, sign-ins and history are all still in its data folder.</p>
<p><b>To get going again</b>, do one of these, then restart CasaTorch (or the device it runs on):</p><ul>
${p.kind === 'unreadable' ? '<li>Give CasaTorch permission to read the files in its data folder again.</li>' : ''}<li>Put back a copy of <code>config.json</code> you saved, in CasaTorch's data folder.</li>
<li>Or start over: move <code>config.json</code> out of the data folder. Setup opens, and you can restore a CasaTorch backup from there.</li></ul>
${aside ? `<p>A copy of the damaged file was kept as <code>${String(aside).replace(/[^\w.-]/g, '')}</code>.</p>` : ''}</main></body></html>`;
if (configProblem && process.env.CASATORCH_TEST !== '1' && !isDemo()) {
  console.error(`\n${configProblem.detail}\nThere is no good copy in the settings history to go back to, so CasaTorch is not starting (only a recovery page answers on port ${PORT}). Nothing was changed${configAside ? `; a copy of the damaged file was kept as ${configAside}` : ''}.\nFix or replace config.json (or move it away to run setup again), then restart CasaTorch.\n`);
  const rec = express(); rec.disable('x-powered-by');
  rec.use((req, res) => {
    res.status(503).set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Retry-After': '60' });
    if (req.path.startsWith('/api/')) return res.json({ ok: false, recovery: true, error: 'CasaTorch can\'t open its settings file. Open CasaTorch in a browser to see what to do.' });
    res.type('html').send(recoveryPage(configProblem, configAside));
  });
  rec.listen(PORT).on('error', (err) => { console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : err); process.exit(1); });
  await new Promise(() => {});   // nothing after this runs: no integrations, no setup, no writes
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchSetup = { ...(globalThis.__casatorchSetup || {}), settingsPrune, settingsSnapshot, settingsRestore, settingsHistory, healFile, healData, shTime };
