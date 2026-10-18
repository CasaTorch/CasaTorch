#!/usr/bin/env node
/*
 * Builds app/catalog/oui.txt.gz: who made a network device, from the first half of its hardware (MAC) address.
 *
 * Source: the IEEE Registration Authority's public MA-L listing (the "OUI" list of company prefixes),
 * https://standards-oui.ieee.org/oui/oui.csv - company names and the prefixes IEEE assigned them.
 * Also reads the same listing as JSON from the oui-data npm package (BSD-2-Clause), which mirrors it daily.
 *
 *   node tools/make-oui.mjs <oui.csv | oui-data/index.json> [out.txt.gz]
 *
 * Only MA-L (6 hex digit) prefixes are kept; "Private" and the IEEE's own blocks are dropped (they say nothing about
 * the maker). Company names lose their legal suffixes (Inc., Co., Ltd., GmbH...) to stay short. The output is plain
 * text, gzip'd: a header line, then one line per company - "Name<TAB>PREFIX PREFIX ...", sorted - so `zcat` shows it.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [src, outArg] = process.argv.slice(2);
if (!src) { console.error('usage: node tools/make-oui.mjs <oui.csv | index.json> [out.txt.gz]'); process.exit(2); }
const out = outArg || path.join(ROOT, 'app', 'catalog', 'oui.txt.gz');

/* "HUAWEI TECHNOLOGIES CO.,LTD" -> "HUAWEI TECHNOLOGIES"; "Ugreen Group Limited" -> "Ugreen Group". */
const SUFFIX = /[\s,.]*\b(co\.?,?\s*ltd|co\.?,?\s*limited|company\s+limited|corporation|corporate|corp|incorporated|inc|limited|ltd|llc|l\.l\.c|gmbh(\s*&\s*co\.?\s*kg)?|kg|ag|s\.?a\.?s|s\.?a\.?r\.?l|s\.?r\.?l|s\.?p\.?a|s\.?a|b\.?v|n\.?v|a\/s|aps|ab|oy|as|plc|pte|pty|sdn\.?\s*bhd|bhd|k\.?k|co|company)\.?$/i;
export function cleanName(s) {
  let n = String(s || '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f]/g, '').trim();
  for (let i = 0; i < 4; i++) { const m = n.replace(SUFFIX, '').replace(/[\s,.(-]+$/, '').trim(); if (m === n || m.length < 2) break; n = m; }
  return n.slice(0, 80);
}

function rows(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return Object.entries(JSON.parse(text)).map(([k, v]) => [k, String(v).split('\n')[0]]);
  // the IEEE CSV: Registry,Assignment,Organization Name,Organization Address (quoted fields may hold commas)
  const out = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const f = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { f.push(cur); cur = ''; } else cur += c; }
    f.push(cur);
    if (f[0] === 'MA-L' && f[1]) out.push([f[1], f[2]]);
  }
  return out;
}

const by = new Map();
for (const [pfx, org] of rows(src)) {
  const p = String(pfx).toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(p)) continue;   // MA-M / MA-S blocks are small companies inside an IEEE prefix: left out
  const n = cleanName(org);
  if (!n || /^(private|ieee registration authority)$/i.test(n)) continue;
  if (!by.has(n)) by.set(n, []);
  by.get(n).push(p);
}
const lines = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en')).map(([n, ps]) => `${n}\t${ps.sort().join(' ')}`);
const total = [...by.values()].reduce((s, a) => s + a.length, 0);
const head = `# CasaTorch maker list: IEEE Registration Authority MA-L (OUI) public listing, ${total} prefixes, built ${new Date().toISOString().slice(0, 10)} by tools/make-oui.mjs`;
const gz = zlib.gzipSync(`${head}\n${lines.join('\n')}\n`, { level: 9 });
fs.writeFileSync(out, gz);
console.log(`${out}: ${by.size} companies, ${total} prefixes, ${Math.round(gz.length / 1024)} KB`);
