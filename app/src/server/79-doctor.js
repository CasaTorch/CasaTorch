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
const chk = (id, group, title, status, detail, extra = {}) => ({ id, group, title, status, detail, ...extra });
const errLine = (err, what, url) => { const f = friendlyError(err, { what, url }); return { detail: f.error, why: f.fix || null }; };
const setupLink = (step, add) => `/setup.html?step=${step}${add ? `&add=${add}` : ''}`;

/* ---- this computer ---- */
function docStorage() {
  let st; try { st = fs.statfsSync(DATA_DIR); } catch { return chk('storage', 'system', 'Storage space', 'off', 'This system doesn\'t say how much space is free.'); }
  const free = st.bavail * st.bsize, total = st.blocks * st.bsize, pct = total ? free / total : 1;
  const detail = `${sizeText(free)} free of ${sizeText(total)}.`;
  // A share of the disk only matters while the space itself is small: 2% of a 20 TB NAS is still 400 GB.
  if (free < 300 * MB || (pct < 0.02 && free < 5 * GB)) return chk('storage', 'system', 'Storage space', 'bad', `Almost full: ${detail}`, { why: 'When the disk is full, CasaTorch can\'t save settings, history or camera pictures.', fix: { action: 'free-space', label: 'Free up space' } });
  if (free < 1.5 * GB || (pct < 0.08 && free < 20 * GB)) return chk('storage', 'system', 'Storage space', 'warn', `Getting low: ${detail}`, { fix: { action: 'free-space', label: 'Free up space' } });
  return chk('storage', 'system', 'Storage space', 'ok', detail);
}
function docMemory() {
  const rss = process.memoryUsage().rss, free = os.freemem(), total = os.totalmem(), pct = total ? free / total : 1;
  const detail = `CasaTorch uses ${sizeText(rss)}; ${sizeText(free)} of ${sizeText(total)} is free.`;
  const restart = INSTALL === 'manual' ? {} : { fix: { action: 'restart', label: 'Restart CasaTorch' } };
  if (rss > 1.5 * GB || pct < 0.03) return chk('memory', 'system', 'Memory', 'bad', `Running out of memory. ${detail}`, { why: 'Things will get slow, and the system may stop CasaTorch. A restart frees what CasaTorch holds.', ...restart });
  if (rss > 900 * MB || pct < 0.07) return chk('memory', 'system', 'Memory', 'warn', `Memory is tight. ${detail}`, restart);
  return chk('memory', 'system', 'Memory', 'ok', detail);
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
  const min = Math.abs(s) / 60_000, side = s > 0 ? 'ahead' : 'behind';
  const why = 'Turn on automatic date and time (network time) on the computer CasaTorch runs on. A wrong clock breaks sign-ins, certificates and schedules.';
  if (min > 10) return chk('clock', 'system', 'Clock', 'bad', `This device's clock is ${Math.round(min)} minutes ${side}.`, { why });
  if (min > 2) return chk('clock', 'system', 'Clock', 'warn', `This device's clock is ${Math.round(min)} minutes ${side}.`, { why });
  return chk('clock', 'system', 'Clock', 'ok', `Right on time (checked with ${clockMemo.from}).`);
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
  const hist = settingsHistory(), copies = `${hist.length} saved cop${hist.length === 1 ? 'y' : 'ies'} in your settings history`;
  const healed = HEAL.filter((h) => /damaged|mismatch/.test(h.what)).slice(-1)[0];
  let disk; try { disk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return chk('settings', 'system', 'Settings file', 'off', 'Not set up yet.');
    return chk('settings', 'system', 'Settings file', 'bad', 'The settings file is damaged.', { why: healed?.detail || null, ...(hist.length ? { fix: { action: 'restore', id: hist[0], label: 'Put back the last good copy' } } : {}) });
  }
  let sealed = 0, unopened = 0;
  mapSecrets(disk, (v) => { if (SEALED.test(v)) { sealed++; if (unseal(v) == null) unopened++; } return v; });
  if (unopened) return chk('settings', 'system', 'Settings file', 'bad', `${unopened} of ${sealed} saved passwords and keys can't be unlocked.`, { why: 'The key file (secret.key) doesn\'t match these settings. Put back a copy from before it changed, restore a backup, or enter those passwords again.', ...(hist.length > 1 ? { fix: { action: 'history', label: 'See saved copies' } } : {}) });
  return chk('settings', 'system', 'Settings file', hist.length ? 'ok' : 'warn', hist.length ? `Readable, all ${sealed} saved passwords and keys unlock. ${copies}.` : 'Readable, but there\'s no saved copy yet.', hist.length ? {} : { fix: { action: 'snapshot', label: 'Save a copy now' } });
}
function docSignIns() {
  if (!isConfigured()) return null;
  const ok = Array.isArray(users?.list) && users.list.some((u) => u.role === 'owner');
  return ok ? chk('signins', 'system', 'Sign-ins', 'ok', `${users.list.length} login${users.list.length === 1 ? '' : 's'}, with an owner.`)
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
    return chk('hue', 'connections', 'Philips Hue', 'ok', `Bridge "${String(j?.name || 'Hue').slice(0, 40)}" is answering.`);
  } catch (err) { const e = errLine(err, 'The Hue bridge', `http://${h.host}`); return chk('hue', 'connections', 'Philips Hue', 'bad', e.detail, { why: e.why || 'If the bridge got a new address, set it to a fixed address in your router, then pair again.', fix: { action: 'retry', id: 'hue', label: 'Try again' } }); }
}
async function docShelly() {
  const list = (config.shelly || []).map((s) => s.host).filter(Boolean); if (!list.length) return null;
  const res = await Promise.all(list.map(async (h) => !!(await getJSON(`http://${h}/shelly`, { timeout: 5000 }).catch(() => null))));
  const down = list.filter((_, i) => !res[i]);
  if (!down.length) return chk('shelly', 'connections', 'Shelly', 'ok', `All ${list.length} answering.`);
  return chk('shelly', 'connections', 'Shelly', down.length === list.length ? 'bad' : 'warn', `${down.length} of ${list.length} not answering: ${down.join(', ')}.`, { why: 'Check they have power and Wi-Fi. Give each a fixed address in your router so it can\'t move.', fix: { action: 'retry', id: 'shelly', label: 'Try again' } });
}
async function docFrigate() {
  const cams = (config.cameras || []).filter((c) => c.type === 'frigate'); if (!cams.length) return null;
  const c = cams[0];
  try { await frigateJson(c, '/api/version'); } catch (err) {
    if (err.status === 401) return chk('frigate', 'connections', 'Frigate', 'bad', 'Frigate turned down CasaTorch\'s username or password.', { fix: { action: 'reconnect', href: setupLink('cameras', 'frigate'), label: 'Enter them again' } });
    const e = errLine(err, 'Frigate', c.url); return chk('frigate', 'connections', 'Frigate', 'bad', e.detail, { why: e.why, fix: { action: 'retry', id: 'frigate', label: 'Try again' } });
  }
  return chk('frigate', 'connections', 'Frigate', 'ok', `Answering - ${cams.length} camera${cams.length === 1 ? '' : 's'}.`);
}
async function docYolink() {
  const y = config.yolink; if (!y?.uaid) return null;
  try { await TESTS.yolink(y); return chk('yolink', 'connections', 'YoLink', 'ok', 'Signed in.'); }
  catch (err) { const e = /refused/.test(err.message) ? { detail: 'YoLink turned down CasaTorch\'s UAID and Secret Key.', why: 'Make new ones in the YoLink app (Account > Advanced Settings > User Access Credentials) and enter them again.' } : errLine(err, 'YoLink'); return chk('yolink', 'connections', 'YoLink', 'bad', e.detail, { why: e.why, fix: /refused/.test(err.message) ? { action: 'reconnect', href: setupLink('sensors', 'yolink-cloud'), label: 'Enter them again' } : { action: 'retry', id: 'yolink', label: 'Try again' } }); }
}
async function docInternet() {
  if (typeof internetNow !== 'function') return null;
  const n = await internetNow().catch(() => null); if (!n) return null;
  return n.online ? chk('internet', 'connections', 'Internet', 'ok', n.provider ? `Online through ${n.provider}.` : 'Online.')
    : chk('internet', 'connections', 'Internet', 'warn', 'The internet is down. Everything at home keeps working; weather, news and updates wait until it\'s back.');
}

/* ---- keeping safe ---- */
function docCerts() {
  const out = [];
  if (typeof lt === 'object' && lt.expires) out.push({ name: 'the secure address at home', until: Date.parse(lt.expires), auto: true });
  for (const c of (config.cameras || []).filter((x) => x.ca)) { try { out.push({ name: `${c.name || 'a camera'}'s pinned certificate`, until: Date.parse(new crypto.X509Certificate(c.ca).validTo) }); } catch { /* not a certificate */ } }
  if (!out.length) return null;
  const soonest = out.sort((a, b) => a.until - b.until)[0], days = Math.floor((soonest.until - Date.now()) / 86400_000);
  if (days < 0) return chk('certs', 'safety', 'Security certificates', 'bad', `The certificate for ${soonest.name} has expired.`, { why: soonest.auto ? 'CasaTorch renews it by itself when it can reach the internet - check the internet, then try again.' : 'Renew it on that device, then test it again in setup.' });
  if (days < (soonest.auto ? 10 : 21)) return chk('certs', 'safety', 'Security certificates', 'warn', `The certificate for ${soonest.name} runs out in ${days} day${days === 1 ? '' : 's'}.`, { why: soonest.auto ? 'CasaTorch renews it by itself - this only stays amber if renewing keeps failing.' : 'Renew it on that device before then.' });
  return chk('certs', 'safety', 'Security certificates', 'ok', `All current - the next one runs out in ${days} days${soonest.auto ? ' and renews by itself' : ''}.`);
}
function lastBackupAt() {
  try {
    const st = fs.statSync(AUDIT_FILE), fd = fs.openSync(AUDIT_FILE, 'r'), len = Math.min(st.size, 512 * 1024), buf = Buffer.alloc(len);
    try { fs.readSync(fd, buf, 0, len, st.size - len); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n').filter((l) => l.includes('"backup-made"'));
    return lines.length ? JSON.parse(lines[lines.length - 1]).at : null;
  } catch { return null; }
}
function docBackup() {
  if (!isConfigured() || isDemo()) return null;
  const at = lastBackupAt(), days = at ? Math.floor((Date.now() - Date.parse(at)) / 86400_000) : null;
  const fix = { action: 'link', href: '#settings/updates', label: 'Make a backup' };
  if (INSTALL === 'ha-addon') return chk('backup', 'safety', 'Backup', 'ok', 'Home Assistant\'s own backups include CasaTorch.' + (at ? ` Your last CasaTorch backup file: ${days} day${days === 1 ? '' : 's'} ago.` : ''));
  if (days == null) return chk('backup', 'safety', 'Backup', 'warn', 'No backup file yet. Your settings history is on this device only - a backup file keeps everything safe if the device fails.', { fix });
  if (days > 60) return chk('backup', 'safety', 'Backup', 'warn', `Your last backup file is ${days} days old.`, { fix });
  return chk('backup', 'safety', 'Backup', 'ok', `Last backup file ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}.`);
}
function docUpdates() {
  if (typeof updateView !== 'function') return null;
  const u = updateView();
  if (u.available) return chk('updates', 'safety', 'Updates', 'warn', `CasaTorch ${u.latest} is available (you have ${u.version}).`, { why: u.how, fix: { action: 'link', href: '#settings/updates', label: 'See the update' } });
  if (!u.check) return chk('updates', 'safety', 'Updates', 'off', `Version ${u.version}. Checking for updates is off.`);
  return chk('updates', 'safety', 'Updates', 'ok', u.latest ? `Up to date (${u.version}).` : `Version ${u.version}.`, { fix: u.error ? { action: 'check-updates', label: 'Check now' } : undefined });
}

const DOC_CONN = { ha: docHa, hue: docHue, shelly: docShelly, frigate: docFrigate, yolink: docYolink };
const DOC_DEMO = [['ha', 'Home Assistant', 'Connected - changes arrive instantly.'], ['hue', 'Philips Hue', 'Bridge "Hue" is answering.'], ['shelly', 'Shelly', 'All 2 answering.'], ['frigate', 'Frigate', 'Answering - 3 cameras.']];
async function doctorRun() {
  if (DOC.running) return DOC.running;
  DOC.running = (async () => {
    const one = (id, fn) => timed(Promise.resolve().then(fn), 15000, id).catch((err) => chk(id, 'connections', id, 'bad', friendlyError(err).error));
    const conn = isDemo() ? DOC_DEMO.map(([id, t, d]) => chk(id, 'connections', t, 'ok', d)) : await Promise.all(Object.entries(DOC_CONN).map(([id, fn]) => one(id, fn)));
    const sys = await Promise.all([docStorage, docMemory, docClock, docDataFolder, docSettings, docSignIns, docInternet, docCerts, docBackup, docUpdates].map((fn) => one(fn.name.replace(/^doc/, '').toLowerCase(), fn)));
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
  const c = await timed(fn(), 15000, id).catch((err) => chk(id, 'connections', id, 'bad', friendlyError(err).error));
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
  sizeMemo = { at: 0, bytes: 0 };
  return { freed, what: [...new Set(gone)] };
}
const FIXES = {
  async retry(b) { const c = await doctorRecheck(String(b.id)); if (!c) throw new Error('Nothing to try again.'); return { check: c, message: c.status === 'ok' ? `${c.title} is answering again.` : `Still not answering - CasaTorch keeps trying by itself.` }; },
  async 'free-space'() { const r = freeSpace(); return { message: r.freed > MB ? `Freed ${sizeText(r.freed)} (${r.what.join(', ')}).` : 'Nothing CasaTorch can safely remove by itself. To free more, delete photos or 3D scans you don\'t need, or move CasaTorch\'s data to a bigger disk.' }; },
  async snapshot() { const id = settingsSnapshot('saved-by-you', { force: true }); if (!id) throw new Error('Couldn\'t save a copy - check the Data folder line above.'); return { message: 'Saved a copy of your settings.' }; },
  async restore(b, req) {
    if (signInOn() && rank(req.user?.role) < rank('owner')) throw Object.assign(new Error('Only the owner can put back saved settings.'), { status: 403 });
    settingsRestore(String(b.id)); if (typeof audit === 'function') audit(req, 'settings-put-back', { copy: String(b.id) });
    if (INSTALL === 'manual') { loadConfig(); return { message: 'Put back. Restart CasaTorch to finish.' }; }
    setTimeout(() => process.exit(0), 700); return { message: 'Put back. CasaTorch is restarting - this page reconnects in a few seconds.', restarting: true };
  },
  async restart(_b, req) { if (INSTALL === 'manual') throw new Error('This copy was started by hand - stop it and start it again where it runs.'); if (typeof audit === 'function') audit(req, 'restarted'); setTimeout(() => process.exit(0), 700); return { message: 'Restarting - this page reconnects in a few seconds.', restarting: true }; },
  async 'check-updates'() { await checkUpdates(); return { message: updateView().available ? `CasaTorch ${updateView().latest} is available.` : 'Up to date.' }; },
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
