/* ======================================================================
 * Backup and restore: everything this CasaTorch knows, in one file.
 *
 * Settings > Backup makes a file protected by a passphrase the owner picks:
 * settings and connections, sign-ins, the calendar, floor plans and 3D scans,
 * photos (optional), history and alerts. It's encrypted with AES-256-GCM using
 * a key made from the passphrase (scrypt), so the file is useless without it -
 * and CasaTorch never keeps the passphrase. Restore (from Settings, or from
 * the first setup screen on new hardware) checks the passphrase and the whole
 * file before changing anything, keeps the old data in a ".before-restore"
 * folder, then restarts CasaTorch.
 *
 * File: "CTBK1\n" | salt 16 | iv 12 | AES-256-GCM( gzip( entries ) ) | tag 16
 * Entry: uint32 header length | {"p": path, "s": size} | the file's bytes. A 0 length ends it.
 * ====================================================================== */
import { Readable, Writable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const BK_MAGIC = Buffer.from('CTBK1\n');
const BK_FILES = ['config.json', 'secret.key', 'users.json', 'alerts.json', 'events.json', 'history.json', 'layout.json', 'push.json', 'audit.log'];
const BK_DIRS = ['floorplan', 'photos'];
const bkKey = (pass, salt) => new Promise((ok, bad) => crypto.scrypt(String(pass), salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }, (e, k) => (e ? bad(e) : ok(k))));
const bkAllowed = (p) => typeof p === 'string' && !p.includes('\0') && !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..') && (BK_FILES.includes(p) || BK_DIRS.some((d) => p.startsWith(`${d}/`)));
const bkSource = (rel) => (rel === 'config.json' ? CONFIG_FILE : path.join(DATA_DIR, rel));
function bkList(withMedia) {
  const out = [];
  for (const f of BK_FILES) { try { const st = fs.statSync(bkSource(f)); if (st.isFile()) out.push({ p: f, s: st.size }); } catch { /* not there */ } }
  if (withMedia) {
    const walk = (rel) => { for (const e of fs.readdirSync(path.join(DATA_DIR, rel), { withFileTypes: true })) { const r = `${rel}/${e.name}`; if (e.isDirectory()) walk(r); else if (e.isFile()) out.push({ p: r, s: fs.statSync(path.join(DATA_DIR, r)).size }); } };
    for (const d of BK_DIRS) { try { walk(d); } catch { /* none */ } }
  } else { try { for (const e of fs.readdirSync(path.join(DATA_DIR, 'floorplan'))) if (e.endsWith('.json')) out.push({ p: `floorplan/${e}`, s: fs.statSync(path.join(DATA_DIR, 'floorplan', e)).size }); } catch { /* none */ } }   // the plan's layout without the big scan files
  return out;
}
async function* bkEntries(list) {
  for (const f of list) {
    const h = Buffer.from(JSON.stringify(f)), len = Buffer.alloc(4); len.writeUInt32BE(h.length);
    yield Buffer.concat([len, h]);
    let sent = 0;
    for await (const chunk of fs.createReadStream(bkSource(f.p), { end: Math.max(0, f.s - 1) })) { if (f.s === 0) break; sent += chunk.length; yield chunk; }
    if (sent !== f.s) throw new Error(`${f.p} changed while it was being backed up - try again`);
  }
  yield Buffer.alloc(4);   // the end
}
async function makeBackup(pass, withMedia, out) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = await bkKey(pass, salt);
  fs.writeFileSync(out, Buffer.concat([BK_MAGIC, salt, iv]), { mode: 0o600 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  await pipeline(Readable.from(bkEntries(bkList(withMedia))), zlib.createGzip({ level: 6 }), c, fs.createWriteStream(out, { flags: 'a' }));
  fs.appendFileSync(out, c.getAuthTag());
}
/* Unpacks into `dir`. Throws (and the caller removes `dir`) on a wrong passphrase or a damaged file. */
async function openBackup(file, pass, dir) {
  const size = fs.statSync(file).size; if (size < 50) throw new Error('that isn\'t a CasaTorch backup');
  const fd = fs.openSync(file, 'r'), head = Buffer.alloc(34), tag = Buffer.alloc(16);
  try { fs.readSync(fd, head, 0, 34, 0); fs.readSync(fd, tag, 0, 16, size - 16); } finally { fs.closeSync(fd); }
  if (!head.subarray(0, 6).equals(BK_MAGIC)) throw new Error('that isn\'t a CasaTorch backup');
  const key = await bkKey(pass, head.subarray(6, 22)), d = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(22, 34)); d.setAuthTag(tag);
  let buf = Buffer.alloc(0), cur = null, fdOut = null, left = 0, files = 0, done = false;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      try {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          if (cur) {
            const n = Math.min(left, buf.length); if (n) { fs.writeSync(fdOut, buf, 0, n); buf = buf.subarray(n); left -= n; }
            if (left > 0) break;
            fs.closeSync(fdOut); fdOut = null; cur = null; continue;
          }
          if (done || buf.length < 4) break;
          const hl = buf.readUInt32BE(0); if (hl === 0) { done = true; buf = Buffer.alloc(0); break; }
          if (hl > 4096) throw new Error('damaged backup');
          if (buf.length < 4 + hl) break;
          const h = JSON.parse(buf.subarray(4, 4 + hl).toString('utf8')); buf = buf.subarray(4 + hl);
          if (!bkAllowed(h.p) || !Number.isSafeInteger(h.s) || h.s < 0) throw new Error('damaged backup');
          const to = path.join(dir, h.p); fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
          fdOut = fs.openSync(to, 'w', 0o600); cur = h; left = h.s; files++;
        }
        cb();
      } catch (e) { cb(e); }
    },
    final(cb) { if (fdOut) fs.closeSync(fdOut); cb(cur || !done ? new Error('damaged backup') : null); },
  });
  try { await pipeline(fs.createReadStream(file, { start: 34, end: size - 17 }), d, zlib.createGunzip(), sink); }
  catch (e) { if (fdOut) try { fs.closeSync(fdOut); } catch { /* closed */ } throw new Error(/auth|unable to authenticate/i.test(String(e.message)) ? 'wrong passphrase, or the file is damaged' : /damaged|incorrect header|unexpected end/i.test(String(e.message)) ? 'the backup file is damaged' : String(e.message)); }
  if (!fs.existsSync(path.join(dir, 'config.json'))) throw new Error('that backup is missing its settings');
  return files;
}
function swapIn(staged) {
  const keep = path.join(DATA_DIR, `.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`); fs.mkdirSync(keep, { mode: 0o700 });
  for (const f of [...BK_FILES, ...BK_DIRS, 'sessions.json']) { const from = bkSource(f); if (fs.existsSync(from)) fs.renameSync(from, path.join(keep, path.basename(from))); }
  for (const f of [...BK_FILES, ...BK_DIRS]) { const from = path.join(staged, f); if (fs.existsSync(from)) fs.renameSync(from, bkSource(f)); }
  fs.rmSync(staged, { recursive: true, force: true });
  return keep;
}

let bkBusy = false;
const bkPass = (p) => (typeof p === 'string' && p.length >= 10 && p.length <= 200 ? p : null);
app.post('/api/backup', requireRole('owner'), express.json({ limit: '2kb' }), async (req, res) => {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const pass = bkPass(req.body?.passphrase); if (!pass) return res.status(400).json({ error: 'Pick a passphrase of at least 10 characters.' });
  if (bkBusy) return res.status(409).json({ error: 'A backup or restore is already running.' });
  bkBusy = true; const out = path.join(DATA_DIR, `.backup-${crypto.randomBytes(6).toString('hex')}.ctbk`);
  try {
    await makeBackup(pass, req.body?.media !== false, out);
    audit(req, 'backup-made', { media: req.body?.media !== false });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="casatorch-backup-${dayOf(Date.now())}.ctbk"`);
    res.setHeader('Content-Length', fs.statSync(out).size);
    await pipeline(fs.createReadStream(out), res);
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: `The backup couldn't be made: ${e.message}` }); }
  finally { fs.rmSync(out, { force: true }); bkBusy = false; }
});
async function restoreHandler(req, res) {
  if (isDemo()) return res.status(400).json({ error: 'Not in the demo.' });
  const pass = bkPass(req.headers['x-backup-passphrase'] ? decodeURIComponent(String(req.headers['x-backup-passphrase'])) : '');
  if (!pass) return res.status(400).json({ error: 'Enter the backup\'s passphrase.' });
  if (bkBusy) return res.status(409).json({ error: 'A backup or restore is already running.' });
  bkBusy = true; const id = crypto.randomBytes(6).toString('hex'), file = path.join(DATA_DIR, `.restore-${id}.ctbk`), staged = path.join(DATA_DIR, `.restore-${id}`);
  try {
    let got = 0; const MAX = 4 * 1024 ** 3;
    await pipeline(req, new Transform({ transform(c, _e, cb) { got += c.length; cb(got > MAX ? new Error('too big') : null, c); } }), fs.createWriteStream(file, { mode: 0o600 }));
    fs.mkdirSync(staged, { mode: 0o700 });
    const files = await openBackup(file, pass, staged);
    if (req.user) audit(req, 'backup-restored', { files });
    const kept = swapIn(staged);
    res.json({ ok: true, files, kept: path.basename(kept), restart: INSTALL === 'manual' ? 'manual' : 'auto' });
    console.log(`Restored a backup (${files} files); the previous data is in ${kept}. Restarting.`);
    setTimeout(() => process.exit(0), 800);   // the service (launchd, systemd, Windows, Docker, Home Assistant) starts it again
  } catch (e) {
    fs.rmSync(staged, { recursive: true, force: true });
    res.status(400).json({ error: `Couldn't restore: ${e.message}` });
  } finally { fs.rmSync(file, { force: true }); bkBusy = false; }
}
app.post('/api/restore', requireRole('owner'), restoreHandler);
app.post('/api/setup/restore', (req, res) => (isConfigured() ? res.status(403).json({ error: 'This CasaTorch is already set up - restore from Settings › Backup instead.' }) : restoreHandler(req, res)));
/* Leftovers from an interrupted backup or restore. */
try { for (const f of fs.readdirSync(DATA_DIR)) if (/^\.(backup|restore)-[0-9a-f]+(\.ctbk)?$/.test(f)) fs.rmSync(path.join(DATA_DIR, f), { recursive: true, force: true }); } catch { /* fine */ }
