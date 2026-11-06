/* The key store and key rotation (00-keystore.js, 09k-keys.js): wrapping keys from a file, systemd, the Keychain or
   DPAPI; a plain key wrapped on the first start that has a key store; a key the store can't open kept, never lost;
   rotation that seals every saved value again and survives being cut off halfway; backups carry the key itself.
   Loaded by unit.mjs after the server (CASATORCH_TEST=1). The end-to-end part starts real servers. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Sealed the way 00-setup.js seals (v2: the field's name sealed in with the value). */
const seal2 = (key, field, text) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const enc = Buffer.concat([c.update(Buffer.concat([Buffer.from(field), Buffer.from([0]), Buffer.from(text)])), c.final()]); return `v2.${iv.toString('base64url')}.${enc.toString('base64url')}.${c.getAuthTag().toString('base64url')}`; };
const open2 = (key, s) => { try { const [, iv, enc, tag] = s.split('.'); const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url')); const o = Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]); return o.subarray(o.indexOf(0) + 1).toString('utf8'); } catch { return null; } };
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

export default async function keystoreUnit(t) {
  const K = globalThis.__casatorchKeys;
  if (!K) { console.log('skip keystore-unit (no __casatorchKeys)'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-keys-'));
  const envWas = process.env.CASATORCH_KEK_FILE;
  const useKek = (file) => { if (file) process.env.CASATORCH_KEK_FILE = file; else delete process.env.CASATORCH_KEK_FILE; K.resetStore(); };
  try {
    await t('key store: a wrapping key from a file - raw bytes, base64, hex or a long passphrase; a short one is refused', () => {
      const raw = crypto.randomBytes(32);
      assert.ok(K.ksKekFrom(raw).equals(raw));
      assert.ok(K.ksKekFrom(Buffer.from(`${raw.toString('base64')}\n`)).equals(raw));
      assert.ok(K.ksKekFrom(Buffer.from(raw.toString('hex'))).equals(raw));
      assert.equal(K.ksKekFrom(Buffer.from('correct horse battery staple, and a bit more')).length, 32);
      assert.equal(K.ksKekFrom(Buffer.from('too short')), null);
    });

    await t('key store: the key wrapped (AES-256-GCM, bound to the kind of store) opens only with the same wrapping key and kind', () => {
      const kek = crypto.randomBytes(32), key = crypto.randomBytes(32), a = K.ksAes('secret', kek), w = a.wrap(key);
      assert.match(w, /^ctkw1\.secret\.[\w-]+$/);
      assert.ok(a.unwrap(w.split('.')[2]).equals(key));
      assert.equal(K.ksAes('secret', crypto.randomBytes(32)).unwrap(w.split('.')[2]), null, 'another wrapping key');
      assert.equal(K.ksAes('keychain', kek).unwrap(w.split('.')[2]), null, 'another kind of store');
      assert.ok(!w.includes(key.toString('base64url')) && !w.includes(key.toString('base64')));
    });

    await t('key store: Windows data protection through PowerShell, the key on stdin (never on a command line)', () => {
      const calls = [];
      const fake = (cmd, args, input) => { calls.push({ cmd, args, input }); const op = /::(Protect|Unprotect)\(/.exec(args.at(-1))[1], b = Buffer.from(String(input).trim(), 'base64'); return { out: Buffer.from(b.map((x) => x ^ 0x5a)).toString('base64') }; };
      const d = K.ksDpapi(fake), key = crypto.randomBytes(32), w = d.wrap(key);
      assert.match(w, /^ctkw1\.dpapi\./); assert.ok(d.unwrap(w.split('.')[2]).equals(key));
      assert.equal(calls[0].cmd, 'powershell.exe'); assert.match(calls[0].args.at(-1), /'CurrentUser'/);
      for (const c of calls) assert.ok(!c.args.join(' ').includes(key.toString('base64')), 'not in the arguments');
    });

    await t('key store: a plain key is wrapped once a key store is there (the settings history\'s copies too), and opens again', () => {
      const dir = path.join(tmp, 'mig'), kek = path.join(tmp, 'mig.kek'), key = crypto.randomBytes(32), file = path.join(dir, 'secret.key');
      fs.mkdirSync(path.join(dir, '.settings-history', '20261101T000000Z-start'), { recursive: true });
      fs.writeFileSync(file, key.toString('base64')); fs.writeFileSync(path.join(dir, '.settings-history', '20261101T000000Z-start', 'secret.key'), key.toString('base64'));
      fs.writeFileSync(kek, crypto.randomBytes(32).toString('base64'));
      useKek(kek);
      assert.equal(K.ksMigrate(file, key), true);
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /^ctkw1\.secret\./); assert.ok(!text.includes(key.toString('base64')));
      assert.ok(K.ksOpen(text).key.equals(key));
      assert.match(fs.readFileSync(path.join(dir, '.settings-history', '20261101T000000Z-start', 'secret.key'), 'utf8'), /^ctkw1\.secret\./, 'the copy in the history');
      assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
      /* the key store goes away: the wrapped key is "locked", never taken for damaged */
      useKek(null);
      assert.deepEqual(K.ksOpen(text), { locked: 'secret' });
      useKek(path.join(tmp, 'missing.kek'));
      assert.ok(K.ksStore().error, 'a key store that is set but missing is reported, not ignored');
      assert.deepEqual(K.ksOpen(text), { locked: 'secret' });
      useKek(kek); assert.ok(K.ksOpen(text).key.equals(key), 'and opens again when it is back');
      useKek(null);
    });

    await t('rotation: every sealed value (settings, sign-ins, whole sealed files, kept copies) sealed again with the new key; other keys\' copies left alone', () => {
      const dir = path.join(tmp, 'rot'), file = path.join(dir, 'secret.key'), k1 = crypto.randomBytes(32), other = crypto.randomBytes(32);
      fs.mkdirSync(path.join(dir, 'timeline'), { recursive: true });
      fs.writeFileSync(file, k1.toString('base64'));
      const cfg = { house: { name: 'Test' }, homeAssistant: { url: 'http://ha.local:8123', token: seal2(k1, 'homeAssistant.token', 'ha-token-1') }, cameras: [{ password: seal2(k1, 'cameras[].password', 'cam-pw') }] };
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
      fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: [{ id: 'u1', totp: { secret: seal2(k1, 'users.totp', 'JBSWY3DP') } }] }));
      fs.writeFileSync(path.join(dir, 'inbox.json'), seal2(k1, 'inbox', '{"users":{}}'));
      fs.writeFileSync(path.join(dir, 'timeline', 'a.jpg.sealed'), seal2(k1, 'timeline.snap:a', 'AAAA'));
      fs.writeFileSync(path.join(dir, 'kept.json'), JSON.stringify({ k: `ctk1.${seal2(k1, 'kept:x', 'v')}` }));
      const h1 = path.join(dir, '.settings-history', '20261101T000000Z-start'), h2 = path.join(dir, '.settings-history', '20261001T000000Z-old');
      fs.mkdirSync(h1, { recursive: true }); fs.mkdirSync(h2, { recursive: true });
      fs.writeFileSync(path.join(h1, 'secret.key'), k1.toString('base64')); fs.writeFileSync(path.join(h1, 'config.json'), JSON.stringify(cfg));
      fs.writeFileSync(path.join(h2, 'secret.key'), other.toString('base64')); const oldCfg = JSON.stringify({ homeAssistant: { token: seal2(other, 'homeAssistant.token', 'older') } }); fs.writeFileSync(path.join(h2, 'config.json'), oldCfg);
      K.ksStageRotation(file);
      const k2 = K.ksOpen(fs.readFileSync(`${file}.next`, 'utf8')).key;
      const r = K.ksRotatePending(file);
      assert.equal(r.ok, true); assert.equal(r.failed, 0); assert.equal(r.values, 8, JSON.stringify(r));   // 6 here, 2 in the history copy
      assert.ok(!fs.existsSync(`${file}.next`)); assert.ok(K.ksOpen(fs.readFileSync(file, 'utf8')).key.equals(k2), 'the new key took over');
      const c = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      assert.equal(open2(k2, c.homeAssistant.token), 'ha-token-1'); assert.equal(open2(k1, c.homeAssistant.token), null, 'no longer opens with the old key');
      assert.equal(open2(k2, c.cameras[0].password), 'cam-pw'); assert.equal(c.house.name, 'Test');
      assert.equal(open2(k2, JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8')).users[0].totp.secret), 'JBSWY3DP');
      assert.equal(open2(k2, fs.readFileSync(path.join(dir, 'inbox.json'), 'utf8')), '{"users":{}}');
      assert.equal(open2(k2, fs.readFileSync(path.join(dir, 'timeline', 'a.jpg.sealed'), 'utf8')), 'AAAA');
      assert.equal(open2(k2, JSON.parse(fs.readFileSync(path.join(dir, 'kept.json'), 'utf8')).k.slice(5)), 'v');
      assert.ok(K.ksOpen(fs.readFileSync(path.join(h1, 'secret.key'), 'utf8')).key.equals(k2), 'the history copy of this key moves to the new key');
      assert.equal(open2(k2, JSON.parse(fs.readFileSync(path.join(h1, 'config.json'), 'utf8')).homeAssistant.token), 'ha-token-1');
      assert.equal(fs.readFileSync(path.join(h2, 'config.json'), 'utf8'), oldCfg, 'a copy with another key is left as it was');
      assert.ok(fs.readFileSync(path.join(h2, 'secret.key'), 'utf8').includes(other.toString('base64')));
      assert.match(fs.readFileSync(path.join(dir, '.key-state.json'), 'utf8'), /rotatedAt/);
    });

    await t('rotation: cut off halfway (some values new, some old), the next start finishes it; nothing is lost', () => {
      const dir = path.join(tmp, 'cut'), file = path.join(dir, 'secret.key'), k1 = crypto.randomBytes(32), k2 = crypto.randomBytes(32);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, k1.toString('base64')); fs.writeFileSync(`${file}.next`, k2.toString('base64'));
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ a: { token: seal2(k2, 'a.token', 'done-already') }, b: { token: seal2(k1, 'b.token', 'not-yet') } }));
      const r = K.ksRotatePending(file);
      assert.equal(r.values, 1); assert.equal(r.already, 1); assert.equal(r.failed, 0);
      const c = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      assert.equal(open2(k2, c.a.token), 'done-already'); assert.equal(open2(k2, c.b.token), 'not-yet');
      assert.equal(K.ksRotatePending(file), null, 'nothing waiting: nothing done');
    });

    await t('rotation: a file that can\'t be saved (read-only, disk full) stops the rotation and puts every value back on the old key - nothing is lost', () => {
      const dir = path.join(tmp, 'nowrite'), file = path.join(dir, 'secret.key'), k1 = crypto.randomBytes(32);
      fs.mkdirSync(path.join(dir, '.settings-history', '20261101T000000Z-start'), { recursive: true });
      fs.writeFileSync(file, k1.toString('base64'));
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ a: { token: seal2(k1, 'a.token', 'one') } }));
      fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: [{ totp: { secret: seal2(k1, 'users.totp', 'two') } }] }));
      fs.writeFileSync(path.join(dir, 'inbox.json'), seal2(k1, 'inbox', 'three'));
      const h = path.join(dir, '.settings-history', '20261101T000000Z-start'); fs.writeFileSync(path.join(h, 'secret.key'), k1.toString('base64')); fs.writeFileSync(path.join(h, 'config.json'), JSON.stringify({ a: { token: seal2(k1, 'a.token', 'four') } }));
      fs.mkdirSync(path.join(dir, `users.json.${process.pid}.ks.tmp`));   // users.json can't be written (as if read-only, even for root)
      K.ksStageRotation(file);
      const r = K.ksRotatePending(file);
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.ok(K.ksOpen(fs.readFileSync(file, 'utf8')).key.equals(k1), 'the old key stays');
      assert.ok(!fs.existsSync(`${file}.next`) && fs.readdirSync(dir).some((n) => n.startsWith('secret.key.next.unused-')), 'the new key is put aside');
      assert.equal(open2(k1, JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).a.token), 'one');
      assert.equal(open2(k1, JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8')).users[0].totp.secret), 'two');
      assert.equal(open2(k1, fs.readFileSync(path.join(dir, 'inbox.json'), 'utf8')), 'three');
      assert.ok(K.ksOpen(fs.readFileSync(path.join(h, 'secret.key'), 'utf8')).key.equals(k1));
      assert.equal(open2(k1, JSON.parse(fs.readFileSync(path.join(h, 'config.json'), 'utf8')).a.token), 'four');
      const was = { ...K.KS }; Object.assign(K.KS, { rotated: r, problem: null });
      try { const c = K.docKeyStore(); assert.equal(c.status, 'warn'); assert.match(JSON.stringify(c), /new secret key wasn't used/); } finally { Object.assign(K.KS, was); }
    });

    await t('rotation: when the old key can\'t be opened, nothing is changed and the staged key is kept aside', () => {
      const dir = path.join(tmp, 'bad'), file = path.join(dir, 'secret.key');
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, 'ctkw1.secret.AAAA'); fs.writeFileSync(`${file}.next`, crypto.randomBytes(32).toString('base64'));
      const cfg = JSON.stringify({ x: { token: seal2(crypto.randomBytes(32), 'x.token', 'y') } }); fs.writeFileSync(path.join(dir, 'config.json'), cfg);
      assert.equal(K.ksRotatePending(file).ok, false);
      assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), cfg); assert.equal(fs.readFileSync(file, 'utf8'), 'ctkw1.secret.AAAA');
      assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('secret.key.next.unused-')));
    });

    await t('backups carry the key itself (never wrapped by this computer\'s key store); Health names where the key is', () => {
      const src = fs.readFileSync(path.join(APP, 'src', 'server', '75-backup.js'), 'utf8');
      assert.match(src, /if \(f === 'secret\.key'\) \{ try \{ const mem = Buffer\.from\(keyOf\(\)\.toString\('base64'\)\)/);
      assert.match(src, /if \(f\.mem\) \{ yield f\.mem; continue; \}/);
      const c = K.docKeyStore(); assert.equal(c.id, 'keystore'); assert.equal(c.group, 'safety'); assert.ok(['ok', 'warn'].includes(c.status));
    });

    await t('rotation and Health texts are translated in all 13 languages (tools/i18n-strings.tsv)', () => {
      const rows = new Map(fs.readFileSync(path.join(APP, '..', 'tools', 'i18n-strings.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => { const c = l.split('\t'); return [c[0], c]; }));
      const texts = new Set();
      for (const f of ['src/server/09k-keys.js', 'src/client/31k-keys.js']) {
        const s = fs.readFileSync(path.join(APP, f), 'utf8');
        for (const m of s.matchAll(/\bT\('((?:[^'\\]|\\.)+)'/g)) texts.add(m[1].replace(/\\'/g, '\''));
        for (const m of s.matchAll(/(?:error|message|why|whyMsg): '((?:[^'\\]|\\.)+)'/g)) texts.add(m[1].replace(/\\'/g, '\''));
        for (const m of s.matchAll(/chk\('keystore', 'safety', '[^']+', '\w+', \[?'((?:[^'\\]|\\.)+)'/g)) texts.add(m[1].replace(/\\'/g, '\''));
        for (const m of s.matchAll(/: '((?:[^'\\]|\\.)+)'(?=[,}])/g)) if (/^[A-Z]/.test(m[1]) && / /.test(m[1])) texts.add(m[1].replace(/\\'/g, '\''));
      }
      for (const x of texts) { const r = rows.get(x); assert.ok(r, `not in i18n-strings.tsv: ${x}`); assert.equal(r.length, 14, x); assert.ok(r.every(Boolean), x); }
    });

    await t('installers: Linux opens the wrapping key before each start (never blocking it), macOS reads the Keychain then drops to its own user, Docker hands a secret over in memory', async () => {
      const rd = (f) => fs.readFileSync(path.join(APP, '..', f), 'utf8');
      const unit = rd('deploy/packaging/linux/casatorch.service').split('\n');
      for (const k of ['RuntimeDirectory=casatorch-key', 'RuntimeDirectoryMode=0700', 'Environment=CASATORCH_KEK_FILE=/run/casatorch-key/kek', 'ExecStartPre=-+/opt/casatorch/casatorch-key unseal']) assert.ok(unit.includes(k), k);
      assert.match(rd('deploy/packaging/linux/build-deb.sh'), /cp "\$HERE\/casatorch-key" "\$PKG\/opt\/casatorch\/casatorch-key"/);
      const helper = rd('deploy/packaging/linux/casatorch-key');
      assert.match(helper, /--tpm2-pcrs= /, 'not bound to the boot state (updates never lock it)');
      assert.ok(!/exit [1-9]/.test(helper.split('unseal)')[1].split(';;')[0]), 'unseal never fails the start');
      const plist = rd('deploy/packaging/macos/com.casatorch.server.plist');
      assert.ok(!/<key>UserName<\/key>/.test(plist), 'started as root (to read the Keychain)...');
      assert.match(rd('deploy/packaging/macos/casatorch-run.sh'), /CASATORCH_RUN_AS="\$RUN_AS"/, '...and told which user to drop to');
      const ks = fs.readFileSync(path.join(APP, 'src', 'server', '00-keystore.js'), 'utf8');
      assert.match(ks, /process\.initgroups\(runAs, gid\); process\.setgid\(gid\); process\.setuid\(uid\);/);
      assert.match(ks, /if \(process\.getuid\(\) === 0 \|\| process\.geteuid\(\) === 0\) throw/, 'never carries on as root');
      assert.match(ks, /ksRun\('\/usr\/bin\/security', \['-i'\], `add-generic-password/, 'the new Keychain item goes in on stdin');
      assert.match(rd('app/docker-entrypoint.sh'), /install -m 400 -o node -g node \/run\/secrets\/casatorch_key \/tmp\/casatorch-kek/);
      for (const f of ['deploy/docker-compose.yml', 'deploy/downloads/casatorch-compose.yml']) assert.match(rd(f), /# secrets: \[casatorch_key\][\s\S]*#   casatorch_key: \{ file: \.\/casatorch\.key \}/, f);
      /* The helper itself, with the real systemd-creds when this computer has it (as root). */
      const { spawnSync } = await import('node:child_process');
      if (process.getuid?.() !== 0 || spawnSync('systemd-creds', ['--help']).status !== 0) { console.log('  (casatorch-key: no systemd-creds or not root here - checked by reading only)'); return; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-kek-')), env = { ...process.env, CASATORCH_KEK_CRED: path.join(d, 'etc', 'kek.cred'), CASATORCH_KEK_RUN: path.join(d, 'run'), CASATORCH_USER: 'root' };
      try {
        const h = path.join(APP, '..', 'deploy/packaging/linux/casatorch-key');
        assert.equal(spawnSync('sh', [h, 'unseal'], { env }).status, 0);
        assert.match(fs.readFileSync(path.join(d, 'run', 'status'), 'utf8'), /^ok (tpm2|host)/);
        const k1 = fs.readFileSync(path.join(d, 'run', 'kek')); assert.equal(k1.length, 32);
        assert.ok(!fs.readFileSync(env.CASATORCH_KEK_CRED).includes(k1), 'the wrapping key is stored encrypted');
        assert.equal(spawnSync('sh', [h, 'unseal'], { env }).status, 0);
        assert.ok(fs.readFileSync(path.join(d, 'run', 'kek')).equals(k1), 'the same key at every start');
        fs.writeFileSync(env.CASATORCH_KEK_CRED, 'damaged');
        assert.equal(spawnSync('sh', [h, 'unseal'], { env }).status, 0, 'a damaged credential never stops the start');
        assert.match(fs.readFileSync(path.join(d, 'run', 'status'), 'utf8'), /^failed/); assert.ok(!fs.existsSync(path.join(d, 'run', 'kek')));
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await t('end to end: a real start wraps the key with the key store; a rotation staged in Settings finishes at the next start and every secret still opens', async () => {
      const data = path.join(tmp, 'e2e'), kekFile = path.join(tmp, 'e2e.kek'), kek = crypto.randomBytes(32);
      fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(kekFile, kek);
      const k1 = crypto.randomBytes(32); fs.writeFileSync(path.join(data, 'secret.key'), k1.toString('base64'), { mode: 0o600 });
      fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ house: { name: 'Key test', timezone: 'UTC' }, homeAssistant: { url: 'http://127.0.0.1:9', token: 'plain-token-123' } }), { mode: 0o600 });
      const start = async () => {
        const port = await freePort();
        const env = { ...process.env, CASATORCH_DATA_DIR: data, PORT: String(port), CASATORCH_KEK_FILE: kekFile, CASATORCH_TEST: '', CASATORCH_DEMO: '', NODE_ENV: 'production' };
        delete env.CASATORCH_TEST;
        const p = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
        for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) break; } catch { /* starting */ } await new Promise((ok) => setTimeout(ok, 250)); }
        await new Promise((ok) => { p.once('exit', ok); p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 4000); });
        return log;
      };
      const aes = K.ksAes('secret', kek), keyNow = () => aes.unwrap(fs.readFileSync(path.join(data, 'secret.key'), 'utf8').trim().split('.')[2]);
      await start();
      assert.match(fs.readFileSync(path.join(data, 'secret.key'), 'utf8'), /^ctkw1\.secret\./, 'wrapped at the first start with a key store');
      assert.ok(keyNow().equals(k1), 'the same key, wrapped');
      const tok1 = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).homeAssistant.token;
      assert.equal(open2(k1, tok1), 'plain-token-123', 'the plain token was sealed with the key');
      const k2 = crypto.randomBytes(32); fs.writeFileSync(path.join(data, 'secret.key.next'), aes.wrap(k2), { mode: 0o600 });
      const log = await start();
      assert.match(log, /Secret key rotated: \d+ saved values/);
      assert.ok(keyNow().equals(k2), 'the new key took over'); assert.ok(!fs.existsSync(path.join(data, 'secret.key.next')));
      const tok2 = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).homeAssistant.token;
      assert.equal(open2(k2, tok2), 'plain-token-123'); assert.equal(open2(k1, tok2), null);
      /* the key store gone: CasaTorch still starts, keeps the wrapped key aside, and puts it back once the store is there again */
      fs.renameSync(kekFile, `${kekFile}.away`);
      const log3 = await start();
      assert.match(log3, /sealed by the key store \(secret\), which didn't open it/);
      assert.ok(fs.readdirSync(data).some((n) => /^secret\.key\.locked-\d+$/.test(n)));
      fs.renameSync(`${kekFile}.away`, kekFile);
      await start();
      assert.ok(keyNow()?.equals(k2), 'the kept key is back');
      assert.ok(!fs.readdirSync(data).some((n) => /^secret\.key\.locked-\d+$/.test(n)));
    });
  } finally {
    if (envWas === undefined) delete process.env.CASATORCH_KEK_FILE; else process.env.CASATORCH_KEK_FILE = envWas;
    K.resetStore();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
