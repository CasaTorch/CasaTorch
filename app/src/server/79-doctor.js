/* ======================================================================
 * Health: CasaTorch checks itself (Settings › Health).
 *
 * Storage, memory, the clock, the data folder, the settings and sign-in
 * files, every connection set up in setup (Home Assistant, Hue, Shelly,
 * Frigate, YoLink), certificates, backups and updates - each green, amber or
 * red, in one plain sentence, with a "Fix it" button where CasaTorch can fix
 * it itself (try again, free up space, save a copy of the settings, put an
 * earlier copy back, check for updates, restart).
 *
 * It runs every 15 minutes. A connection that stops answering is tried again
 * after 1, 2, 4, 8... minutes (at most every 30), and if it's still down a
 * second time in a row, ONE alert says what needs a look - and another says
 * when it's fixed. Nothing here sends anything anywhere; the clock check reads
 * only the time from casatorch.com's answer.
 * ====================================================================== */
const DOC_FILE = path.join(DATA_DIR, '.health.json');
const DOC = { at: null, checks: [], running: null, retry: {}, prev: {}, ...(() => { try { const j = JSON.parse(fs.readFileSync(DOC_FILE, 'utf8')); return { alerted: j.alerted || {}, badSince: j.badSince || {} }; } catch { return { alerted: {}, badSince: {} }; } })() };
const docSave = () => { try { writeFileSafe(DOC_FILE, JSON.stringify({ alerted: DOC.alerted, badSince: DOC.badSince }), 0o600); } catch { /* the data-folder check reports it */ } };
const MB = 1048576, GB = 1024 * MB;
const sizeText = (b) => (b >= GB ? `${(b / GB).toFixed(b >= 10 * GB ? 0 : 1)} GB` : `${Math.max(1, Math.round(b / MB))} MB`);
const timed = (p, ms, label) => Promise.race([p, sleep(ms).then(() => { throw Object.assign(new Error(`${label} didn't answer in time`), { name: 'TimeoutError' }); })]);
/* detail is a plain sentence, or [sentence with {values}, values]: then the English goes out filled in as "detail", with
   the stable key and values as "msg" and "vars" so the screen can say it in the home's language (fillMsg: 05b-setup-net.js). */
const chk = (id, group, title, status, detail, extra = {}) => { const [msg, vars] = Array.isArray(detail) ? detail : [detail]; return { id, group, title, status, detail: fillMsg(msg, vars), ...(vars ? { msg, vars } : {}), ...extra }; };
const errLine = (err, what, url) => { const f = friendlyError(err, { what, url }); return { detail: f.vars ? [f.msg, f.vars] : f.error, why: f.fix || null }; };
const errDetail = (err) => { const f = friendlyError(err); return f.vars ? [f.msg, f.vars] : f.error; };
const setupLink = (step, add) => `/setup.html?step=${step}${add ? `&add=${add}` : ''}`;

/* ---- this computer ---- */
/* What CasaTorch itself keeps, by kind (Health shows it under Storage space). Walked without blocking, at most every
   10 minutes; every kind has its own limit (history 2 years, replay 7 days, map cache 64 MB, logs 2 MB...). */
const STORE_KINDS = [
  ['scans', '3D Home plans and scans', (n) => n === 'floorplan'], ['photos', 'Photos', (n) => n === 'photos'],
  ['restorePoints', '3D Home restore points', (n) => n === '.floorplan-restore'], ['beforeRestore', 'Kept from restores', (n) => n.startsWith('.before-restore-')],
  ['history', 'History, energy and replay', (n) => /^(history|replay|power-baseline|alerts|apptests)\.json$|^audit\.log$/.test(n)],
  ['family', 'Family, household and reminders', (n) => /^(family|household|events|nudges)\.json$|^nudges$/.test(n)],
  ['mapCache', 'Map cache', (n) => n === 'radar-cache'], ['helper', 'Secure access helper', (n) => n === 'bin'],
  ['settingsHistory', 'Settings history', (n) => n === '.settings-history'],
];
let storeMemo = { at: 0, parts: null };
async function sizeOfPath(p, depth = 0) {
  let st; try { st = await fs.promises.lstat(p); } catch { return 0; }
  if (st.isFile()) return st.size;
  if (!st.isDirectory() || depth > 6) return 0;
  let n = 0, list = []; try { list = await fs.promises.readdir(p); } catch { return 0; }
  for (const e of list) n += await sizeOfPath(path.join(p, e), depth + 1);
  return n;
}
let storeBusy = null;
function storageUse() {
  if (storeMemo.parts && Date.now() - storeMemo.at < 10 * 60_000) return Promise.resolve(storeMemo.parts);
  return (storeBusy ||= storageWalk().finally(() => { storeBusy = null; }));
}
async function storageWalk() {
  const sum = Object.fromEntries([...STORE_KINDS.map(([k]) => [k, 0]), ['settings', 0]]);
  let names = []; try { names = await fs.promises.readdir(DATA_DIR); } catch { /* none */ }
  for (const n of names) { const k = STORE_KINDS.find(([, , m]) => m(n))?.[0] || 'settings'; sum[k] += await sizeOfPath(path.join(DATA_DIR, n)); }
  const label = Object.fromEntries([...STORE_KINDS.map(([k, l]) => [k, l]), ['settings', 'Settings and everything else']]);
  const parts = Object.entries(sum).filter(([, b]) => b >= 1024).sort((x, y) => y[1] - x[1]).map(([key, bytes]) => ({ key, label: label[key], bytes, size: bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : sizeText(bytes) }));
  storeMemo = { at: Date.now(), parts };
  return parts;
}
function docStorage() {
  if (Date.now() - storeMemo.at > 10 * 60_000) storageUse().catch(() => {});   // doctorRun waits for it; others get the last one
  const parts = storeMemo.parts, extra = parts ? { parts, usedBytes: parts.reduce((t, p) => t + p.bytes, 0) } : {};
  let st; try { st = fs.statfsSync(DATA_DIR); } catch { return chk('storage', 'system', 'Storage space', 'off', 'This system doesn\'t say how much space is free.'); }
  const free = st.bavail * st.bsize, total = st.blocks * st.bsize, pct = total ? free / total : 1;
  const v = { free: sizeText(free), total: sizeText(total) }, detail = (pre = '') => [`${pre}{free} free of {total}.`, v];
  // A share of the disk only matters while the space itself is small: 2% of a 20 TB NAS is still 400 GB.
  if (free < 300 * MB || (pct < 0.02 && free < 5 * GB)) return chk('storage', 'system', 'Storage space', 'bad', detail('Almost full: '), { why: 'When the disk is full, CasaTorch can\'t save settings, history or camera pictures.', fix: { action: 'free-space', label: 'Free up space' }, ...extra });
  if (free < 1.5 * GB || (pct < 0.08 && free < 20 * GB)) return chk('storage', 'system', 'Storage space', 'warn', detail('Getting low: '), { fix: { action: 'free-space', label: 'Free up space' }, ...extra });
  return chk('storage', 'system', 'Storage space', 'ok', detail(), extra);
}
function docMemory() {
  const rss = process.memoryUsage().rss, free = os.freemem(), total = os.totalmem(), pct = total ? free / total : 1;
  const v = { used: sizeText(rss), free: sizeText(free), total: sizeText(total) }, detail = (pre = '') => [`${pre}CasaTorch uses {used}; {free} of {total} is free.`, v];
  const restart = INSTALL === 'manual' ? {} : { fix: { action: 'restart', label: 'Restart CasaTorch' } };
  if (rss > 1.5 * GB || pct < 0.03) return chk('memory', 'system', 'Memory', 'bad', detail('Running out of memory. '), { why: 'Things will get slow, and the system may stop CasaTorch. A restart frees what CasaTorch holds.', ...restart });
  if (rss > 900 * MB || pct < 0.07) return chk('memory', 'system', 'Memory', 'warn', detail('Memory is tight. '), restart);
  return chk('memory', 'system', 'Memory', 'ok', detail());
}
let clockMemo = { at: 0, skew: null, from: null };
async function docClock() {
  if (Date.now() - clockMemo.at > 3 * 3600_000 || clockMemo.skew == null) {
    const sources = [new URL(UPDATE_URL).origin, config.homeAssistant?.url && config.homeAssistant.url !== SUPERVISOR_HA ? `${config.homeAssistant.url}/api/` : null].filter(Boolean);
    clockMemo = { at: Date.now(), skew: null, from: null };
    for (const u of sources) {
      try { const t0 = Date.now(); const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'manual' }); const half = (Date.now() - t0) / 2; const s = clockSkewMs(r.headers.get('date'), Date.now() - half); if (s != null) { clockMemo = { at: Date.now(), skew: s, from: /casatorch\.com/.test(u) ? 'the internet' : 'Home Assistant' }; break; } } catch { /* next */ }
    }
  }
  const s = clockMemo.skew;
  if (s == null) return chk('clock', 'system', 'Clock', 'off', 'Couldn\'t compare the clock right now (no internet?).');
  const min = Math.abs(s) / 60_000, off = [s > 0 ? 'This device\'s clock is {n} minutes ahead.' : 'This device\'s clock is {n} minutes behind.', { n: Math.round(min) }];
  const why = 'Turn on automatic date and time (network time) on the computer CasaTorch runs on. A wrong clock breaks sign-ins, certificates and schedules.';
  if (min > 10) return chk('clock', 'system', 'Clock', 'bad', off, { why });
  if (min > 2) return chk('clock', 'system', 'Clock', 'warn', off, { why });
  return chk('clock', 'system', 'Clock', 'ok', ['Right on time (checked with {from}).', { from: clockMemo.from }]);
}
function docDataFolder() {
  const f = path.join(DATA_DIR, `.write-test-${process.pid}`);
  try { writeFileSafe(f, 'ok', 0o600); fs.rmSync(f, { force: true }); return chk('data', 'system', 'Data folder', 'ok', 'CasaTorch can save its settings and history.'); }
  catch (e) {
    return chk('data', 'system', 'Data folder', 'bad', e.code === 'ENOSPC' ? 'CasaTorch can\'t save anything: the disk is full.' : e.code === 'EROFS' ? 'CasaTorch can\'t save anything: the disk is read-only (it may be failing, or mounted read-only).' : 'CasaTorch isn\'t allowed to save in its data folder.',
      { why: e.code === 'ENOSPC' ? null : 'Check the folder\'s owner and permissions (on a NAS: the shared folder\'s permissions for the container).', ...(e.code === 'ENOSPC' ? { fix: { action: 'free-space', label: 'Free up space' } } : {}) });
  }
}
function docSettings() {
  if (isDemo()) return null;
  const hist = settingsHistory();
  const healed = HEAL.filter((h) => /damaged|mismatch/.test(h.what)).slice(-1)[0];
  let disk; try { disk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return chk('settings', 'system', 'Settings file', 'off', 'Not set up yet.');
    return chk('settings', 'system', 'Settings file', 'bad', 'The settings file is damaged.', { why: healed?.detail || null, ...(hist.length ? { fix: { action: 'restore', id: hist[0], label: 'Put back the last good copy' } } : {}) });
  }
  let sealed = 0, unopened = 0;
  mapSecrets(disk, (v) => { if (SEALED.test(v)) { sealed++; if (unseal(v) == null) unopened++; } return v; });
  if (unopened) return chk('settings', 'system', 'Settings file', 'bad', ['{n} of {total} saved passwords and keys can\'t be unlocked.', { n: unopened, total: sealed }], { why: 'The key file (secret.key) doesn\'t match these settings. Put back a copy from before it changed, restore a backup, or enter those passwords again.', ...(hist.length > 1 ? { fix: { action: 'history', label: 'See saved copies' } } : {}) });
  return chk('settings', 'system', 'Settings file', hist.length ? 'ok' : 'warn', hist.length ? [hist.length === 1 ? 'Readable, all {n} saved passwords and keys unlock. 1 saved copy in your settings history.' : 'Readable, all {n} saved passwords and keys unlock. {copies} saved copies in your settings history.', { n: sealed, copies: hist.length }] : 'Readable, but there\'s no saved copy yet.', hist.length ? {} : { fix: { action: 'snapshot', label: 'Save a copy now' } });
}
function docSignIns() {
  if (!isConfigured()) return null;
  const ok = Array.isArray(users?.list) && users.list.some((u) => u.role === 'owner');
  // amber, never an alert: setup's "Protect your CasaTorch" was answered "Not now" (or an admin has no second step)
  const open = ok && signInOn() ? users.list.filter((u) => ['owner', 'admin'].includes(u.role) && u.password && !u.panel && !u.totp?.on) : [];
  if (open.length) return chk('signins', 'system', 'Sign-ins', 'warn', open.some((u) => u.role === 'owner') ? 'Two-step sign-in is off for the owner login.' : ['Two-step sign-in is off for {n} admin login(s).', { n: open.length }], { why: 'With it on, a stolen password alone can\'t get in: sign-in also asks for a code from your phone. It takes two minutes with any authenticator app.', fix: { action: 'link', href: '#settings/people', label: 'Turn on two-step sign-in' } });
  return ok ? chk('signins', 'system', 'Sign-ins', 'ok', users.list.length === 1 ? '1 login, with an owner.' : ['{n} logins, with an owner.', { n: users.list.length }])
    : chk('signins', 'system', 'Sign-ins', 'bad', 'There is no owner login.', { why: 'Restore a backup, or put back a saved copy of the settings from before this happened.', fix: { action: 'history', label: 'See saved copies' } });
}

/* ---- connections ---- */
async function docHa() {
  const h = config.homeAssistant; if (!h?.url) return null;
  const live = typeof LIVE === 'object' && LIVE.ok;
  try {
    const r = await fetch(`${h.url}/api/`, { headers: { Authorization: `Bearer ${h.token}` }, signal: AbortSignal.timeout(8000) });
    if (r.status === 401 || r.status === 403) return chk('ha', 'connections', 'Home Assistant', 'bad', 'Home Assistant no longer accepts CasaTorch\'s token (it was removed or expired).', { why: 'Sign in to Home Assistant again - it takes a few seconds and nothing else changes.', fix: { action: 'reconnect', href: setupLink('homeassistant'), label: 'Sign in again' } });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return chk('ha', 'connections', 'Home Assistant', 'ok', live ? 'Connected - changes arrive instantly.' : 'Connected (checking every few seconds; instant updates are reconnecting).');
  } catch (err) { const e = errLine(err, 'Home Assistant', h.url); return chk('ha', 'connections', 'Home Assistant', 'bad', e.detail, { why: e.why, fix: { action: 'retry', id: 'ha', label: 'Try again' } }); }
}
async function docHue() {
  const h = config.hue; if (!h?.host) return null;
  try {
    const j = await getJSON(`http://${h.host}/api/${h.username}/config`, { timeout: 6000 });
    if (Array.isArray(j) && j[0]?.error?.type === 1) return chk('hue', 'connections', 'Philips Hue', 'bad', 'The Hue bridge no longer knows CasaTorch (it was reset or CasaTorch was removed from it).', { why: 'Pair again: press the button on the bridge, then Pair.', fix: { action: 'reconnect', href: setupLink('controls', 'hue-local'), label: 'Pair again' } });
    return chk('hue', 'connections', 'Philips Hue', 'ok', ['Bridge "{name}" is answering.', { name: String(j?.name || 'Hue').slice(0, 40) }]);
  } catch (err) { const e = errLine(err, 'The Hue bridge', `http://${h.host}`); return chk('hue', 'connections', 'Philips Hue', 'bad', e.detail, { why: e.why || 'If the bridge got a new address, set it to a fixed address in your router, then pair again.', fix: { action: 'retry', id: 'hue', label: 'Try again' } }); }
}
async function docShelly() {
  const list = (config.shelly || []).map((s) => s.host).filter(Boolean); if (!list.length) return null;
  const res = await Promise.all(list.map(async (h) => !!(await getJSON(`http://${h}/shelly`, { timeout: 5000 }).catch(() => null))));
  const down = list.filter((_, i) => !res[i]);
  if (!down.length) return chk('shelly', 'connections', 'Shelly', 'ok', ['All {n} answering.', { n: list.length }]);
  return chk('shelly', 'connections', 'Shelly', down.length === list.length ? 'bad' : 'warn', ['{n} of {total} not answering: {list}.', { n: down.length, total: list.length, list: down.join(', ') }], { why: 'Check they have power and Wi-Fi. Give each a fixed address in your router so it can\'t move.', fix: { action: 'retry', id: 'shelly', label: 'Try again' } });
}
async function docFrigate() {
  const cams = (config.cameras || []).filter((c) => c.type === 'frigate'); if (!cams.length) return null;
  const c = cams[0];
  try { await frigateJson(c, '/api/version'); } catch (err) {
    if (err.status === 401) return chk('frigate', 'connections', 'Frigate', 'bad', 'Frigate turned down CasaTorch\'s username or password.', { fix: { action: 'reconnect', href: setupLink('cameras', 'frigate'), label: 'Enter them again' } });
    const e = errLine(err, 'Frigate', c.url); return chk('frigate', 'connections', 'Frigate', 'bad', e.detail, { why: e.why, fix: { action: 'retry', id: 'frigate', label: 'Try again' } });
  }
  return chk('frigate', 'connections', 'Frigate', 'ok', cams.length === 1 ? 'Answering - 1 camera.' : ['Answering - {n} cameras.', { n: cams.length }]);
}
async function docYolink() {
  const y = config.yolink; if (!y?.uaid) return null;
  try { await TESTS.yolink(y); return chk('yolink', 'connections', 'YoLink', 'ok', 'Signed in.'); }
  catch (err) { const e = /refused/.test(err.message) ? { detail: 'YoLink turned down CasaTorch\'s UAID and Secret Key.', why: 'Make new ones in the YoLink app (Account > Advanced Settings > User Access Credentials) and enter them again.' } : errLine(err, 'YoLink'); return chk('yolink', 'connections', 'YoLink', 'bad', e.detail, { why: e.why, fix: /refused/.test(err.message) ? { action: 'reconnect', href: setupLink('sensors', 'yolink-cloud'), label: 'Enter them again' } : { action: 'retry', id: 'yolink', label: 'Try again' } }); }
}
async function docInternet() {
  if (typeof internetNow !== 'function') return null;
  const n = await internetNow().catch(() => null); if (!n) return null;
  return n.online ? chk('internet', 'connections', 'Internet', 'ok', n.provider ? ['Online through {provider}.', { provider: n.provider }] : 'Online.')
    : chk('internet', 'connections', 'Internet', 'warn', 'The internet is down. Everything at home keeps working; weather, news and updates wait until it\'s back.');
}

/* Secure access (42-remote.js): does the address work from outside? CasaTorch opens it itself to find out. */
async function docRemote() {
  if (!config.remote?.on || isDemo()) return null;
  const age = () => (remote.check.at ? Math.round((Date.now() - Date.parse(remote.check.at)) / 60_000) : null);
  if (remote.state === 'connected' && (age() == null || age() > 20)) await remoteCheck('health').catch(() => {});
  const v = remoteView({ on: true, state: remote.state, code: remote.code, check: remote.check, anywhere: !!proStatus().pro, why: remote.why });
  const fix = v.fix ? { action: v.fix.action === 'repair' ? 'remote-repair' : 'remote-check', label: v.fix.label } : { action: 'remote-check', label: 'Check again' };
  const m = age(), detail = m == null ? `${v.title}.` : m < 1 ? `${v.title}. Checked from outside just now.` : [m === 1 ? `${v.title}. Checked from outside a minute ago.` : `${v.title}. Checked from outside {n} minutes ago.`, { n: m }];
  if (v.status === 'working') return chk('remote', 'connections', 'Secure access', 'ok', detail, v.detail ? { why: v.detail } : {});
  if (v.status === 'problem') return chk('remote', 'connections', 'Secure access', 'bad', v.title, { why: v.detail, fix });
  return chk('remote', 'connections', 'Secure access', 'warn', v.title.replace(/…$/, '...'), { why: v.detail, fix });
}

/* ---- keeping safe ---- */
function docCerts() {
  const out = [];
  if (typeof lt === 'object' && lt.expires) out.push({ name: 'the secure address at home', until: Date.parse(lt.expires), auto: true });
  for (const c of (config.cameras || []).filter((x) => x.ca)) { try { out.push({ name: `${c.name || 'a camera'}'s pinned certificate`, cam: c.name || 'a camera', until: Date.parse(new crypto.X509Certificate(c.ca).validTo) }); } catch { /* not a certificate */ } }
  if (!out.length) return null;
  const soonest = out.sort((a, b) => a.until - b.until)[0], days = Math.floor((soonest.until - Date.now()) / 86400_000);
  /* Home's own secure address, or a camera's pinned certificate: each its own sentence, so it reads naturally in every language. */
  const cv = { name: soonest.cam, n: days }, cs = (home, cam) => [soonest.auto ? home : cam, cv];
  if (days < 0) return chk('certs', 'safety', 'Security certificates', 'bad', cs('The certificate for the secure address at home has expired.', 'The pinned certificate of {name} has expired.'), { why: soonest.auto ? 'CasaTorch renews it by itself when it can reach the internet - check the internet, then try again.' : 'Renew it on that device, then test it again in setup.' });
  if (days < (soonest.auto ? 10 : 21)) return chk('certs', 'safety', 'Security certificates', 'warn', days === 1 ? cs('The certificate for the secure address at home runs out in 1 day.', 'The pinned certificate of {name} runs out in 1 day.') : cs('The certificate for the secure address at home runs out in {n} days.', 'The pinned certificate of {name} runs out in {n} days.'), { why: soonest.auto ? 'CasaTorch renews it by itself - this only stays amber if renewing keeps failing.' : 'Renew it on that device before then.' });
  return chk('certs', 'safety', 'Security certificates', 'ok', cs('All current - the next one runs out in {n} days and renews by itself.', 'All current - the next one runs out in {n} days.'));
}
function lastBackupAt() {
  try {
    const st = fs.statSync(AUDIT_FILE), fd = fs.openSync(AUDIT_FILE, 'r'), len = Math.min(st.size, 512 * 1024), buf = Buffer.alloc(len);
    try { fs.readSync(fd, buf, 0, len, st.size - len); } finally { fs.closeSync(fd); }
    /* a backup made here, or one restored here (counted from the day it was made, or restored if that isn't known) */
    const lines = buf.toString('utf8').split('\n').filter((l) => l.includes('"backup-made"') || l.includes('"backup-restored"'));
    let best = null;
    for (const l of lines) { try { const j = JSON.parse(l), at = j.event === 'backup-restored' ? j.backupAt || j.at : j.at; if (at && (!best || Date.parse(at) > Date.parse(best))) best = at; } catch { /* a cut line */ } }
    return best;
  } catch { return null; }
}
function docBackup() {
  if (!isConfigured() || isDemo()) return null;
  const at = lastBackupAt(), days = at ? Math.floor((Date.now() - Date.parse(at)) / 86400_000) : null;
  const fix = { action: 'link', href: '#settings/updates', label: 'Make a backup' };
  if (INSTALL === 'ha-addon') return chk('backup', 'safety', 'Backup', 'ok', !at ? 'Home Assistant\'s own backups include CasaTorch.' : days === 1 ? 'Home Assistant\'s own backups include CasaTorch. Your last CasaTorch backup file: 1 day ago.' : ['Home Assistant\'s own backups include CasaTorch. Your last CasaTorch backup file: {n} days ago.', { n: days }]);
  if (days == null) return chk('backup', 'safety', 'Backup', 'warn', 'No backup file yet. Your settings history is on this device only - a backup file keeps everything safe if the device fails.', { fix });
  if (days > 60) return chk('backup', 'safety', 'Backup', 'warn', ['Your last backup file is {n} days old.', { n: days }], { fix });
  return chk('backup', 'safety', 'Backup', 'ok', days === 0 ? 'Last backup file today.' : days === 1 ? 'Last backup file 1 day ago.' : ['Last backup file {n} days ago.', { n: days }]);
}
function docUpdates() {
  if (typeof updateView !== 'function') return null;
  const u = updateView();
  if (u.available) return chk('updates', 'safety', 'Updates', 'warn', ['CasaTorch {latest} is available (you have {version}).', { latest: u.latest, version: u.version }], { why: u.how, fix: { action: 'link', href: '#settings/updates', label: 'See the update' } });
  if (!u.check) return chk('updates', 'safety', 'Updates', 'off', ['Version {version}. Checking for updates is off.', { version: u.version }]);
  return chk('updates', 'safety', 'Updates', 'ok', [u.latest ? 'Up to date ({version}).' : 'Version {version}.', { version: u.version }], { fix: u.error ? { action: 'check-updates', label: 'Check now' } : undefined });
}

const DOC_CONN = { ha: docHa, hue: docHue, shelly: docShelly, frigate: docFrigate, yolink: docYolink };
const DOC_DEMO = [['ha', 'Home Assistant', 'Connected - changes arrive instantly.'], ['hue', 'Philips Hue', ['Bridge "{name}" is answering.', { name: 'Hue' }]], ['shelly', 'Shelly', ['All {n} answering.', { n: 2 }]], ['frigate', 'Frigate', ['Answering - {n} cameras.', { n: 3 }]]];
async function doctorRun() {
  if (DOC.running) return DOC.running;
  DOC.running = (async () => {
    const one = (id, fn) => timed(Promise.resolve().then(fn), 15000, id).catch((err) => chk(id, 'connections', id, 'bad', errDetail(err)));
    const conn = isDemo() ? DOC_DEMO.map(([id, t, d]) => chk(id, 'connections', t, 'ok', d)) : await Promise.all(Object.entries(DOC_CONN).map(([id, fn]) => one(id, fn)));
    await storageUse().catch(() => {});
    const sys = await Promise.all([docStorage, docMemory, docClock, docDataFolder, docSettings, docSignIns, docInternet, docRemote, docCerts, docBackup, docUpdates].map((fn) => one(fn.name.replace(/^doc/, '').toLowerCase(), fn)));
    const checks = [...sys, ...conn].filter(Boolean);
    DOC.checks = checks; DOC.at = nowIso();
    if (!isDemo()) doctorAlerts(checks);
    return checks;
  })().finally(() => { DOC.running = null; });
  return DOC.running;
}
/* One alert for what broke (only once it's been broken twice in a row - a blip isn't worth anyone's attention), one when it's fixed. */
function doctorAlerts(checks) {
  const now = Date.now(), newly = [];
  for (const c of checks) {
    if (c.status === 'bad') {
      DOC.badSince[c.id] ||= nowIso();
      if (DOC.prev[c.id] === 'bad' && !DOC.alerted[c.id]) newly.push(c);
    } else if (c.status === 'ok' || c.status === 'off') {
      if (DOC.alerted[c.id] && typeof alertRaise === 'function') alertRaise({ id: `health-ok:${c.id}:${now}`, severity: 'ok', title: `Fixed: ${c.title} ${c.status === 'ok' ? 'is fine again' : 'no longer needs a look'}`, source: 'casatorch' });
      delete DOC.alerted[c.id]; delete DOC.badSince[c.id]; delete DOC.retry[c.id];
    }
    DOC.prev[c.id] = c.status;
    if (c.status === 'bad' && DOC_CONN[c.id] && !DOC.retry[c.id]) DOC.retry[c.id] = { n: 0, next: now + 60_000 };
  }
  if (newly.length && typeof alertRaise === 'function') {
    const names = newly.map((c) => c.title);
    const one = newly[0], title = newly.length === 1 ? (one.detail.toLowerCase().startsWith(one.title.toLowerCase()) ? one.detail : `${one.title}: ${one.detail}`) : `${newly.length} things need a look: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    alertRaise({ id: `health:${now}`, severity: 'warning', title: title.slice(0, 160), body: 'Open Settings › Health to see what to do - most have a Fix it button.', source: 'casatorch' });
    for (const c of newly) DOC.alerted[c.id] = nowIso();
  }
  docSave();
}
/* A connection that broke is tried again sooner: 1, 2, 4, 8, 16, then every 30 minutes. */
function doctorKick(id) {
  if (id === 'ha' && typeof LIVE === 'object') { CACHE.delete('ha:states'); CACHE.delete('ha:domains'); if (!LIVE.ws && typeof haLiveStart === 'function') { LIVE.retry = 2000; haLiveStart(); } }
}
async function doctorRecheck(id) {
  doctorKick(id);
  const fn = DOC_CONN[id]; if (!fn) return null;
  const c = await timed(fn(), 15000, id).catch((err) => chk(id, 'connections', id, 'bad', errDetail(err)));
  if (!c) return null;
  DOC.checks = [...DOC.checks.filter((x) => x.id !== id), c];
  if (c.status === 'ok') { if (DOC.alerted[id] && typeof alertRaise === 'function') alertRaise({ id: `health-ok:${id}:${Date.now()}`, severity: 'ok', title: `Fixed: ${c.title} is answering again`, source: 'casatorch' }); delete DOC.alerted[id]; delete DOC.badSince[id]; delete DOC.retry[id]; DOC.prev[id] = 'ok'; docSave(); }
  return c;
}
if (process.env.CASATORCH_TEST !== '1') {
  setTimeout(() => { if (isConfigured()) doctorRun().catch(() => {}); }, 2 * 60_000).unref?.();
  setInterval(() => { if (isConfigured()) doctorRun().catch(() => {}); }, 15 * 60_000).unref?.();
  setInterval(() => {
    if (!isConfigured() || isDemo()) return;
    for (const [id, r] of Object.entries(DOC.retry)) {
      if (Date.now() < r.next) continue;
      r.n++; r.next = Date.now() + Math.min(30, 2 ** r.n) * 60_000;
      doctorRecheck(id).catch(() => {});
    }
  }, 30_000).unref?.();
  /* What CasaTorch fixed at start goes into its log too (the log starts after the self-check). */
  for (const h of HEAL) console.warn(`Self-check: ${h.detail}`);
}

/* ---- fixes ---- */
function freeSpace() {
  let freed = 0; const old = Date.now() - 30 * 86400_000, gone = [];
  const rm = (p) => { const n = fs.statSync(p).isDirectory() ? dirSize(p) : fs.statSync(p).size; fs.rmSync(p, { recursive: true, force: true }); freed += n; };
  for (const name of fs.readdirSync(DATA_DIR)) {
    const p = path.join(DATA_DIR, name); let st; try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    try {
      if (/^\.before-restore-/.test(name) && st.mtimeMs < old) { rm(p); gone.push('old copies kept from restores'); }
      else if (/\.(damaged|unmatched|broken)-[\w-]+$/.test(name) && st.mtimeMs < old) { rm(p); gone.push('old damaged files'); }
      else if (/\.\d+\.tmp$/.test(name) && st.mtimeMs < Date.now() - 86400_000) { rm(p); gone.push('leftover temporary files'); }
      else if (/^\.(backup|restore)-[0-9a-f]+(\.ctbk)?$/.test(name) && !bkBusy) { rm(p); gone.push('an unfinished backup'); }
    } catch { /* skip that one */ }
  }
  CACHE.clear();
  sizeMemo = { at: 0, bytes: 0 }; storeMemo = { at: 0, parts: null };
  return { freed, what: [...new Set(gone)] };
}
const FIXES = {
  async retry(b) { const c = await doctorRecheck(String(b.id)); if (!c) throw new Error('Nothing to try again.'); return { check: c, ...(c.status === 'ok' ? { message: `${c.title} is answering again.`, msg: '{name} is answering again.', vars: { name: c.title } } : { message: 'Still not answering - CasaTorch keeps trying by itself.' }) }; },
  async 'free-space'() { const r = freeSpace(); return r.freed > MB ? { message: `Freed ${sizeText(r.freed)} (${r.what.join(', ')}).`, msg: 'Freed {size}.', vars: { size: sizeText(r.freed) } } : { message: 'Nothing CasaTorch can safely remove by itself. To free more, delete photos or 3D scans you don\'t need, or move CasaTorch\'s data to a bigger disk.' }; },
  async snapshot() { const id = settingsSnapshot('saved-by-you', { force: true }); if (!id) throw new Error('Couldn\'t save a copy - check the Data folder line above.'); return { message: 'Saved a copy of your settings.' }; },
  async restore(b, req) {
    if (signInOn() && rank(req.user?.role) < rank('owner')) throw Object.assign(new Error('Only the owner can put back saved settings.'), { status: 403 });
    settingsRestore(String(b.id)); if (typeof audit === 'function') audit(req, 'settings-put-back', { copy: String(b.id) });
    if (INSTALL === 'manual') { loadConfig(); return { message: 'Put back. Restart CasaTorch to finish.' }; }
    setTimeout(() => process.exit(0), 700); return { message: 'Put back. CasaTorch is restarting - this page reconnects in a few seconds.', restarting: true };
  },
  async restart(_b, req) { if (INSTALL === 'manual') throw new Error('This copy was started by hand - stop it and start it again where it runs.'); if (typeof audit === 'function') audit(req, 'restarted'); setTimeout(() => process.exit(0), 700); return { message: 'Restarting - this page reconnects in a few seconds.', restarting: true }; },
  async 'remote-repair'(_b, req) {
    if (!config.remote?.on) throw new Error('Secure access is off.');
    await remoteOn(); if (typeof audit === 'function') audit(req, 'secure-access-repaired');
    return { message: 'Secure access was set up again - it checks itself in a moment.' };
  },
  async 'remote-check'() {
    if (!config.remote?.on) throw new Error('Secure access is off.');
    if (!remote.proc && remote.code !== 'token') { await ensureCloudflared(); startTunnel(); return { message: 'Starting secure access again - it checks itself in a moment.' }; }
    const r = await remoteCheck('by you'), c = await docRemote();
    if (c) DOC.checks = [...DOC.checks.filter((x) => x.id !== 'remote'), c];
    return { check: c, message: r?.ok ? 'Secure access works from outside.' : 'Not working yet - see what it says above.' };
  },
  async 'check-updates'() { await checkUpdates(); return updateView().available ? { message: `CasaTorch ${updateView().latest} is available.`, msg: 'CasaTorch {latest} is available.', vars: { latest: updateView().latest } } : { message: 'Up to date.' }; },
};
app.get('/api/doctor', requireRole('admin'), async (req, res) => {
  if (!DOC.at || Date.now() - Date.parse(DOC.at) > 10 * 60_000 || req.query.fresh === '1') await doctorRun().catch(() => {});
  res.setHeader('Cache-Control', 'no-store');
  const order = { bad: 0, warn: 1, ok: 2, off: 3 };
  res.json({
    at: DOC.at, checks: [...DOC.checks].sort((a, b) => order[a.status] - order[b.status]),
    healed: HEAL.slice(-8).reverse(),
    history: settingsHistory().slice(0, 12).map((id) => ({ id, at: new Date(shTime(id)).toISOString(), reason: id.replace(/^\d{8}T\d{6}Z-/, '') })),
    demo: isDemo(), canRestart: INSTALL !== 'manual',
  });
});
app.post('/api/doctor/fix', requireRole('admin'), express.json({ limit: '2kb' }), async (req, res) => {
  const a = String(req.body?.action || ''), fn = Object.hasOwn(FIXES, a) ? FIXES[a] : null;
  if (!fn) return res.status(404).json({ error: 'That fix isn\'t available.' });
  if (isDemo() && a !== 'retry') return res.json({ ok: true, demo: true, message: 'The demo doesn\'t change anything.' });
  try { res.json({ ok: true, ...(await fn(req.body || {}, req)) }); }
  catch (err) { res.status(err.status || 400).json({ error: String(err.message) }); }
});
if (process.env.CASATORCH_TEST === '1') Object.assign(globalThis.__casatorchSetup, { docStorage, docSettings, doctorAlerts, DOC });
