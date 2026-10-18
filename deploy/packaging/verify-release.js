// verify-release.js - checks a CasaTorch source tree against the release's signed checksums, before it is built or run.
// Used by deploy/install.sh, deploy/install.ps1 and the Home Assistant add-on build (keep the copies the same:
// tools/test-release-verify.mjs checks). Needs Node.js 20+ only.
//
//   node verify-release.js <dir> <SHA256SUMS> <SHA256SUMS.sig> <casatorch-source-files.sha256> [<list of files>]
//
// SHA256SUMS must carry CasaTorch's offline release signature (Ed25519, the key below - the same one the Linux/Pi
// updater trusts), list casatorch-source-files.sha256 with the right checksum, and every file in that list must be in
// <dir> with the right checksum. With no <list of files>, <dir> must hold nothing else (a fresh download); with one
// (e.g. `git ls-files` of a checkout), that list must match exactly.
// Exit codes: 0 verified; 2 the release has no signed file list (made before 0.8.1); 1 anything else is wrong.
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const RELEASE_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAjZpfFYZVcjzY0N8vFCEfIX7l6t5E7SSRB6Cfe2LdzIY=\n-----END PUBLIC KEY-----\n';
const LIST = 'casatorch-source-files.sha256';
const stop = (msg, code = 1) => { process.stderr.write(`verify-release: ${msg}\n`); process.exit(code); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sums = (txt) => new Map(String(txt).split('\n').map((l) => l.match(/^([0-9a-f]{64}) [ *](.+)$/)).filter(Boolean).map((m) => [m[2], m[1]]));
const [dir, sumsFile, sigFile, listFile, namesFile] = process.argv.slice(2);
if (!dir || !sumsFile || !sigFile || !listFile) stop('usage: verify-release.js <dir> <SHA256SUMS> <SHA256SUMS.sig> <file list> [names]');
const read = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
const S = read(sumsFile), G = read(sigFile);
if (!S || !G) stop('the release has no signed checksums', 2);
const key = process.env.CASATORCH_RELEASE_KEY_FILE ? fs.readFileSync(process.env.CASATORCH_RELEASE_KEY_FILE, 'utf8') : RELEASE_KEY;   // tests only
let good = false; try { good = crypto.verify(null, S, key, G); } catch { good = false; }
if (!good) stop('SHA256SUMS is not signed by CasaTorch\'s release key');
const signed = sums(S);
if (!signed.has(LIST)) stop('this release has no signed file list', 2);
const L = read(listFile);
if (!L || sha(L) !== signed.get(LIST)) stop(`${LIST} doesn't match the signed release`);
const want = sums(L);
if (!want.size) stop(`${LIST} is empty`);
for (const [name, h] of want) {
  const full = path.resolve(dir, name);
  if (!full.startsWith(path.resolve(dir) + path.sep)) stop(`bad path in the list: ${name}`);
  const b = read(full);
  if (!b) stop(`missing: ${name}`);
  if (sha(b) !== h) stop(`changed: ${name}`);
}
let have;
if (namesFile) have = String(read(namesFile) || '').split(/\r?\n/).filter(Boolean);
else {
  have = []; const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else have.push(r); } };
  walk(path.resolve(dir), '');
}
const extra = have.filter((n) => !want.has(n));
if (extra.length) stop(`not in the release: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ` and ${extra.length - 5} more` : ''}`);
if (have.length !== want.size) stop('the file list doesn\'t match the release');
process.stdout.write(`verified ${want.size} files against the signed release\n`);
