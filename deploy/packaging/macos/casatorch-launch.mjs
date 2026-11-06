/* macOS: launchd starts CasaTorch as root (com.casatorch.server.plist) only so its wrapping key can be read from the
   System keychain (00-keystore.js). That is done here, with nothing but Node's own modules loaded: then the process
   drops to CasaTorch's own user for good, and only after that is CasaTorch itself loaded - so no package it uses ever
   runs a line as root. A drop that doesn't work stops it (exit 78): it never runs as root.
   Started by casatorch-run.sh in /Library/CasaTorch/app. */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const run = (cmd, args, input) => { try { const r = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 20_000, maxBuffer: 1 << 20 }); return r.status === 0 ? { out: String(r.stdout || '') } : { err: String(r.stderr || r.error?.message || `exit ${r.status}`).trim().slice(0, 200) }; } catch (e) { return { err: e.message }; } };
const runAs = process.env.CASATORCH_RUN_AS;
if (runAs && typeof process.getuid === 'function' && process.getuid() === 0) {
  let pre = null;
  if (process.platform === 'darwin') {
    const KC = { service: 'com.casatorch.secret-key', account: 'casatorch', file: '/Library/Keychains/System.keychain' };   // the same item as 00-keystore.js
    const find = () => run('/usr/bin/security', ['find-generic-password', '-s', KC.service, '-a', KC.account, '-w', KC.file]);
    let r = find();
    if (r.err) {   // the first start: make one (sent on stdin, never on a command line other users could see)
      const k = crypto.randomBytes(32).toString('base64');
      run('/usr/bin/security', ['-i'], `add-generic-password -s ${KC.service} -a ${KC.account} -l CasaTorch -w ${k} -U ${KC.file}\n`);
      r = find();
    }
    const kek = r.out ? Buffer.from(r.out.trim(), 'base64') : null;
    pre = kek?.length === 32 ? { kind: 'keychain', kek } : { kind: 'keychain', error: r.err || 'no key' };
  }
  const id = (f) => Number(run('/usr/bin/id', [f, runAs]).out);
  const uid = id('-u'), gid = id('-g');
  try {
    if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid)) throw new Error(`no user ${runAs}`);
    process.initgroups(runAs, gid); process.setgid(gid); process.setuid(uid);
    if (process.getuid() === 0 || process.geteuid() === 0) throw new Error('still root');
  } catch (e) { console.error(`CasaTorch couldn't switch to its own user (${runAs}): ${e.message}. Not starting as root.`); process.exit(78); }
  globalThis.__casatorchKsPre = pre;   // the key store's answer, for 00-keystore.js (KS_PRE)
}
await import(pathToFileURL(path.resolve('server.js')).href);
