/* ======================================================================
 * The key store: where CasaTorch's secret key (data/secret.key, the one key that seals every saved password, token
 * and private key - 00-setup.js) is protected.
 *
 * Where the system has a key store, secret.key holds the key wrapped (sealed) by it, so a copy of the data folder
 * alone - a NAS share, a stolen SD card, a synced backup folder - opens nothing:
 *   systemd     Linux (the .deb, the Raspberry Pi image): a wrapping key in systemd credentials, sealed with this
 *               computer's TPM2 chip when it has one (deploy/packaging/linux/casatorch-key), opened into memory
 *               (/run) for each start.
 *   keychain    macOS: a wrapping key in the System keychain, read while CasaTorch starts and before it drops to its
 *               own user (KS_PRE below).
 *   dpapi       Windows: the key sealed with Windows data protection for the account CasaTorch runs as.
 *   secret      Docker and anything else: a wrapping key in a file outside the data folder - a Docker secret
 *               (/run/secrets/casatorch_key) or CASATORCH_KEK_FILE.
 * Without one, secret.key is the key itself (owner-only), as before. Never a lockout:
 *   - an install that gets a key store wraps its key on the next start (the settings history's copies too);
 *   - a key store that is missing or fails leaves CasaTorch working and Health says so; a wrapped key it can't open
 *     is kept (secret.key.locked-...) and put back by itself when the key store opens it again (00b-heal.js);
 *   - backups always carry the key itself (sealed by the backup's passphrase), so they restore anywhere.
 * Rotation (Settings › Safety › New secret key): a new key is staged as secret.key.next and CasaTorch restarts; at
 * the start, before anything opens a secret, every sealed value in the data folder is sealed again with the new key,
 * then the new key replaces the old one. Each value opens with one key or the other, so a power cut halfway through
 * just carries on at the next start.
 * ====================================================================== */
import { spawnSync as ksSpawn } from 'node:child_process';
const KS_WRAPPED = /^ctkw1\.([a-z]+)\.([\w-]+)$/;
const KS = { kind: 'file', want: null, problem: null, migrated: null, rotated: null, tpm: null };   // what Health shows
function isDemo0() { return process.env.CASATORCH_DEMO === '1'; }   // (the settings aren't loaded yet when the key is)
const ksRun = (cmd, args, input) => { try { const r = ksSpawn(cmd, args, { input, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 1 << 20 }); return r.status === 0 ? { out: String(r.stdout || '') } : { err: String(r.stderr || r.error?.message || `exit ${r.status}`).trim().slice(0, 200) }; } catch (e) { return { err: e.message }; } };

/* macOS, started by launchd as root (com.casatorch.server.plist, CASATORCH_RUN_AS): the wrapping key from the System
   keychain (made the first time), then CasaTorch drops to its own user for good - before anything else runs. A drop
   that doesn't work stops CasaTorch: it never runs as root. */
const KS_KEYCHAIN = { service: 'com.casatorch.secret-key', account: 'casatorch', file: '/Library/Keychains/System.keychain' };
const KS_PRE = (() => {
  const runAs = process.env.CASATORCH_RUN_AS;
  if (!runAs || typeof process.getuid !== 'function' || process.getuid() !== 0 || process.env.CASATORCH_TEST === '1') return null;
  let pre = null;
  if (process.platform === 'darwin') {
    const find = () => ksRun('/usr/bin/security', ['find-generic-password', '-s', KS_KEYCHAIN.service, '-a', KS_KEYCHAIN.account, '-w', KS_KEYCHAIN.file]);
    let r = find();
    if (r.err) {   // the first start: make one (sent on stdin, never on a command line other users could see)
      const k = crypto.randomBytes(32).toString('base64');
      ksRun('/usr/bin/security', ['-i'], `add-generic-password -s ${KS_KEYCHAIN.service} -a ${KS_KEYCHAIN.account} -l CasaTorch -w ${k} -U ${KS_KEYCHAIN.file}\n`);
      r = find();
    }
    const kek = r.out ? Buffer.from(r.out.trim(), 'base64') : null;
    pre = kek?.length === 32 ? { kind: 'keychain', kek } : { kind: 'keychain', error: r.err || 'no key' };
  }
  const id = (f) => Number(ksRun('/usr/bin/id', [f, runAs]).out);
  const uid = id('-u'), gid = id('-g');
  try {
    if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid)) throw new Error(`no user ${runAs}`);
    process.initgroups(runAs, gid); process.setgid(gid); process.setuid(uid);
    if (process.getuid() === 0 || process.geteuid() === 0) throw new Error('still root');
  } catch (e) { console.error(`CasaTorch couldn't switch to its own user (${runAs}): ${e.message}. Not starting as root.`); process.exit(78); }
  return pre;
})();

/* The wrapping key in a file: 32 raw bytes, 32 bytes as base64 or hex, or a passphrase of 32 characters or more. */
function ksKekFrom(buf) {
  if (buf.length === 32) return Buffer.from(buf);
  const t = buf.toString('utf8').trim();
  if (/^[A-Za-z0-9+/]{43}=$/.test(t)) return Buffer.from(t, 'base64');
  if (/^[0-9a-f]{64}$/i.test(t)) return Buffer.from(t, 'hex');
  if (t.length >= 32) return crypto.createHash('sha256').update(`casatorch-kek|${t}`).digest();
  return null;
}
const ksAes = (kind, kek) => ({
  kind,
  wrap(key) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', kek, iv); c.setAAD(Buffer.from(`casatorch-key|${kind}`));
    const ct = Buffer.concat([c.update(key), c.final()]);
    return `ctkw1.${kind}.${Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url')}`;
  },
  unwrap(b64) {
    try {
      const all = Buffer.from(b64, 'base64url'); if (all.length !== 60) return null;
      const d = crypto.createDecipheriv('aes-256-gcm', kek, all.subarray(0, 12)); d.setAAD(Buffer.from(`casatorch-key|${kind}`)); d.setAuthTag(all.subarray(44));
      return Buffer.concat([d.update(all.subarray(12, 44)), d.final()]);
    } catch { return null; }
  },
});
/* Windows data protection (DPAPI), for the account CasaTorch runs as (Network Service for the installed service). */
const KS_DPAPI_PS = (op) => `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());$e=[Text.Encoding]::UTF8.GetBytes('CasaTorch secret key');[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}($b,$e,'CurrentUser'))`;
const ksDpapi = (run = ksRun) => {
  const call = (op, b64) => { const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', KS_DPAPI_PS(op)], b64); return r.out ? r.out.trim() : null; };
  return {
    kind: 'dpapi',
    wrap(key) { const b = call('Protect', key.toString('base64')); if (!b) throw new Error('Windows data protection did not answer'); return `ctkw1.dpapi.${Buffer.from(b, 'base64').toString('base64url')}`; },
    unwrap(b64) { const k = call('Unprotect', Buffer.from(b64, 'base64url').toString('base64')); return k ? Buffer.from(k, 'base64') : null; },
  };
};

/** The key store this CasaTorch can use: { kind, wrap, unwrap }, { kind, error } (there, but not working), or null. */
let ksMemo;
function ksStore() {
  if (ksMemo !== undefined) return ksMemo;
  const env = process.env.CASATORCH_KEK_FILE, docker = '/run/secrets/casatorch_key';
  const file = env || (process.platform !== 'win32' && fs.existsSync(docker) ? docker : null);
  if (file) {
    const kind = /^\/run\/casatorch-key\//.test(file) ? 'systemd' : 'secret';
    if (kind === 'systemd') {   // what casatorch-key unseal left: "ok tpm2", "ok host", "failed ...", or "unsupported"
      let status = ''; try { status = fs.readFileSync(path.join(path.dirname(file), 'status'), 'utf8').trim(); } catch { /* not written */ }
      KS.tpm = /^ok tpm2/.test(status);
      if (/^unsupported/.test(status)) return (ksMemo = null);
      if (/^failed/.test(status)) return (ksMemo = { kind, error: status.slice(7, 160) || 'failed' });
    }
    let raw = null; try { raw = fs.readFileSync(file); } catch (e) { return (ksMemo = kind === 'systemd' && e.code === 'ENOENT' ? null : { kind, error: `${path.basename(file)}: ${e.code || e.message}` }); }
    const kek = ksKekFrom(raw); raw.fill(0);
    return (ksMemo = kek ? ksAes(kind, kek) : { kind, error: 'the key in it is too short (32 characters or more)' });
  }
  if (KS_PRE) return (ksMemo = KS_PRE.kek ? ksAes('keychain', KS_PRE.kek) : { kind: 'keychain', error: KS_PRE.error });
  if (process.platform === 'win32' && process.env.CASATORCH_TEST !== '1') {
    const st = ksDpapi();
    try { const probe = crypto.randomBytes(32), w = st.wrap(probe); return (ksMemo = st.unwrap(KS_WRAPPED.exec(w)[2])?.equals(probe) ? st : { kind: 'dpapi', error: 'it did not open what it sealed' }); }
    catch (e) { return (ksMemo = { kind: 'dpapi', error: e.message }); }
  }
  return (ksMemo = null);
}
const ksUsable = () => { const s = ksStore(); return s && !s.error ? s : null; };
/** secret.key's text for a key: wrapped by the key store when there is one, else the key itself (base64). */
const ksText = (key) => { const s = ksUsable(); return s ? s.wrap(key) : key.toString('base64'); };
/** A key file's text -> { key, kind } (kind: the key store that wrapped it, or 'file'), { locked: kind }, or { damaged }. */
function ksOpen(text) {
  const t = String(text || '').trim(), m = KS_WRAPPED.exec(t);
  if (!m) { const k = Buffer.from(t, 'base64'); return k.length === 32 && /^[A-Za-z0-9+/]{43}=$/.test(t) ? { key: k, kind: 'file' } : { damaged: true }; }
  const s = ksUsable(); if (!s || s.kind !== m[1]) return { locked: m[1] };
  const k = s.unwrap(m[2]); return k?.length === 32 ? { key: k, kind: m[1] } : { locked: m[1] };
}
const ksKeyOfFile = (file) => { try { return ksOpen(fs.readFileSync(file, 'utf8')).key || null; } catch { return null; } };
const ksLooksLikeKey = (text) => { const t = String(text || '').trim(); return KS_WRAPPED.test(t) || (/^[A-Za-z0-9+/]{43}=$/.test(t)); };
function ksWrite(file, text) {
  const tmp = `${file}.${process.pid}.ks.tmp`, fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { const d = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch { /* Windows can't fsync a folder */ }
}
/* A key that is still the plain key, with a key store now there: wrapped in place (checked first), and the plain copies
   in the settings history wrapped too. */
function ksMigrate(file, key) {
  const s = ksUsable(); if (!s) return false;
  const text = s.wrap(key); if (!ksOpen(text).key?.equals(key)) return false;
  ksWrite(file, text);
  let n = 0;
  const hist = path.join(path.dirname(file), '.settings-history');
  for (const id of (() => { try { return fs.readdirSync(hist); } catch { return []; } })()) {
    const f = path.join(hist, id, 'secret.key');
    try { const o = ksOpen(fs.readFileSync(f, 'utf8')); if (o.kind === 'file' && o.key) { ksWrite(f, s.wrap(o.key)); n++; } } catch { /* none in this copy */ }
  }
  KS.migrated = { at: new Date().toISOString(), copies: n };
  console.log(`Secret key: now kept with the key store (${s.kind})${n ? `; ${n} saved cop${n === 1 ? 'y' : 'ies'} too` : ''}.`);
  return true;
}

/* ---- rotation ---- */
const KS_SEALED = /^(ctk1\.)?(v[12])\.([\w-]+)\.([\w-]*)\.([\w-]+)$/;
const KS_SKIP_DIRS = new Set(['bin', 'radar-cache', 'photos', 'node_modules']);
const KS_SKIP_FILES = /\.(glb|gltf|bin|jpe?g|png|webp|gif|heic|gz|zip|tgz|xz|mp4|webm|wasm|exe|ply|obj|usdz|ktx2)$|\.tmp$|^secret\.key/i;
/** One sealed value, sealed again with k2 (as it was if it already opens with k2, or opens with neither). */
function ksReseal(s, k1, k2, n) {
  const m = KS_SEALED.exec(s); if (!m) return s;
  const open = (k) => { try { const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(m[3], 'base64url')); d.setAuthTag(Buffer.from(m[5], 'base64url')); return Buffer.concat([d.update(Buffer.from(m[4], 'base64url')), d.final()]); } catch { return null; } };
  const two = open(k2); if (two) { two.fill(0); n.already++; return s; }
  const p = open(k1); if (!p) { n.failed++; return s; }
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k2, iv), enc = Buffer.concat([c.update(p), c.final()]); p.fill(0);
  n.values++;
  return `${m[1] || ''}${m[2]}.${iv.toString('base64url')}.${enc.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}
const ksResealJson = (v, f) => (typeof v === 'string' ? f(v) : Array.isArray(v) ? v.map((x) => ksResealJson(x, f)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ksResealJson(x, f)])) : v);
/** Every sealed value in a folder's files (and its subfolders'), k1 -> k2. A folder with its own secret.key (a copy in
    the settings history, one kept from a restore) is done only if that key is k1, and then gets k2 as its key. */
function ksResealDir(dir, k1, k2, n, depth = 0, top = dir) {
  if (depth > 5) return;
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  if (dir !== top && list.some((e) => e.name === 'secret.key' && e.isFile())) {
    const own = ksKeyOfFile(path.join(dir, 'secret.key'));
    if (!own || (!own.equals(k1) && !own.equals(k2))) return;   // another key's copy: left as it is
    if (own.equals(k1)) ksWrite(path.join(dir, 'secret.key'), ksText(k2));
  }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!(depth === 0 && KS_SKIP_DIRS.has(e.name))) ksResealDir(p, k1, k2, n, depth + 1, top); continue; }
    if (!e.isFile() || KS_SKIP_FILES.test(e.name)) continue;
    let text; try { if (fs.statSync(p).size > 32 * 1048576) continue; text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const t = text.trim(); let out = null;
    if (KS_SEALED.test(t)) out = ksReseal(t, k1, k2, n);
    else if (/^[[{]/.test(t)) { let j; try { j = JSON.parse(t); } catch { continue; } const before = n.values; const r = ksResealJson(j, (s) => ksReseal(s, k1, k2, n)); if (n.values > before) out = JSON.stringify(r, null, /^\{\n\s/.test(t) ? 2 : undefined); }
    if (out !== null && out !== t) { try { ksWrite(p, out); n.files++; } catch (err) { n.failed++; console.error(`Key rotation: couldn't save ${e.name}: ${err.message}`); } }
  }
}
/** Finish a rotation asked for in Settings (secret.key.next): run at the start, before anything opens a secret. */
function ksRotatePending(file) {
  const next = `${file}.next`;
  if (!fs.existsSync(next)) return null;
  const k1 = ksKeyOfFile(file), k2 = ksKeyOfFile(next);
  if (!k2 || !k1) { try { fs.renameSync(next, `${next}.unused-${Date.now()}`); } catch { /* read-only */ } console.error('Key rotation: the old or the new key could not be opened, so nothing was changed.'); KS.rotated = { at: new Date().toISOString(), ok: false }; return KS.rotated; }
  const n = { values: 0, files: 0, already: 0, failed: 0 }, t0 = Date.now();
  ksResealDir(path.dirname(file), k1, k2, n);
  fs.renameSync(next, file);   // the new key takes over only once every value is sealed with it
  try { const d = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch { /* Windows */ }
  k1.fill(0);
  KS.rotated = { at: new Date().toISOString(), ok: n.failed === 0, ...n, ms: Date.now() - t0 };
  try { ksWrite(path.join(path.dirname(file), '.key-state.json'), JSON.stringify({ rotatedAt: KS.rotated.at, values: n.values, files: n.files, failed: n.failed })); } catch { /* Health shows this start's result anyway */ }
  console.log(`Secret key rotated: ${n.values} saved values in ${n.files} files sealed with the new key${n.failed ? ` (${n.failed} could not be opened and were left as they were)` : ''}.`);
  return KS.rotated;
}
/** Stage a new key (Settings): written next to the old one; the restart that follows does the rest. */
function ksStageRotation(file) {
  const k2 = crypto.randomBytes(32);
  ksWrite(`${file}.next`, ksText(k2)); k2.fill(0);
}
const ksLastRotation = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.key-state.json'), 'utf8')).rotatedAt || null; } catch { return null; } };
/** For Health and Settings. */
const ksView = () => {
  const s = ksStore();
  return { kind: KS.kind, store: s ? s.kind : null, storeProblem: s?.error || null, tpm: KS.tpm, problem: KS.problem, migrated: KS.migrated, rotated: KS.rotated, canRotate: true };
};
