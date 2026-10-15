#!/usr/bin/env node
/*
 * scrub-check: refuse anything that would put a real house on GitHub.
 *
 *   node tools/scrub-check.mjs <file|dir> ...    scan files, exit 1 on a hit
 *   node tools/scrub-check.mjs --staged          scan what `git commit` is about to commit
 *
 * Two kinds of check:
 *  1. Built-in patterns: private IPv4 addresses (except documentation/example
 *     ranges), MAC addresses, Meraki serials, API-key shapes, e-mail addresses,
 *     street-address shapes.
 *  2. Your own words in tools/private-terms.txt (git-ignored, one per line):
 *     names, plates, the network name, the home address - anything that is
 *     yours. Matched case-insensitively.
 * A line can opt out with the comment `scrub-ok` (e.g. a documented example).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const termsFile = path.join(root, 'tools', 'private-terms.txt');
const terms = fs.existsSync(termsFile)
  ? fs.readFileSync(termsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  : [];

// Documentation / placeholder addresses are fine: 192.0.2.x, 198.51.100.x, 203.0.113.x, 10.0.0.x, 192.168.1.x, 127.x
const okIp = /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|10\.0\.0\.|192\.168\.1\.|127\.|0\.0\.0\.0)/;
const PATTERNS = [
  ['private IP', /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, (m) => !okIp.test(m)],
  ['MAC address', /\b([0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, (m) => !/^(00:00:00|aa:bb:cc|de:ad:be|12:34:56)/i.test(m)],
  ['Meraki serial', /\bQ2[A-Z0-9]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, (m) => !/XXXX/.test(m)],
  ['API key / token', /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|[a-f0-9]{40})\b/g, () => true],
  ['e-mail address', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) => !/@(example\.(com|org)|users\.noreply\.github\.com|casatorch\.(dev|app))$/i.test(m)],
  ['street address', /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Court|Way)\b/g, () => true],
];
const SKIP = /(^|\/)(node_modules|\.git|vendor)(\/|$)|\.(png|jpe?g|gif|webp|ico|glb|gltf|woff2?|pdf|mp4|webm|mov|tgz|xz)$|(^|\/)LICENSE$|private-terms\.txt$/;

function files(args) {
  if (args[0] === '--staged') {
    return execSync('git diff --cached --name-only --diff-filter=ACMR', { cwd: root, encoding: 'utf8' })
      .split('\n').filter(Boolean).map((f) => path.join(root, f));
  }
  const out = [];
  const walk = (p) => { const st = fs.statSync(p); if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); } else out.push(p); };
  for (const a of args.length ? args : [root]) walk(path.resolve(a));
  return out;
}

let hits = 0;
for (const f of files(process.argv.slice(2))) {
  const rel = path.relative(root, f);
  if (SKIP.test(rel) || !fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/scrub-ok/.test(line)) return;
    for (const [kind, re, keep] of PATTERNS) {
      for (const m of line.matchAll(re)) if (keep(m[0])) { hits++; console.log(`${rel}:${i + 1}  ${kind}: ${m[0]}`); }
    }
    const low = line.toLowerCase();
    for (const t of terms) if (low.includes(t.toLowerCase())) { hits++; console.log(`${rel}:${i + 1}  private term: ${t}`); }
  });
}
if (!terms.length) console.log('note: tools/private-terms.txt is empty or missing - only the built-in patterns were checked');
if (hits) { console.log(`\n${hits} thing(s) that look personal. Replace them with settings or example values, or mark a deliberate example with "scrub-ok".`); process.exit(1); }
console.log('scrub-check: clean');
