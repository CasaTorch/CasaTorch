/* The tamper-evident activity log (07z-audit-chain.js) and the security score (79k-score.js). Loaded by unit.mjs. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default async function auditChainUnit(t) {
  const A = globalThis.__casatorchAudit;
  if (!A) { console.log('skip audit-chain-unit'); return; }
  /* Lines as audit() writes them: each chained to the one before. */
  const make = (n, from = 0) => { A.resetHead(); const out = []; for (let i = from; i < from + n; i++) { const l = A.auditChainLine({ at: `2026-11-0${1 + (i % 8)}T10:00:0${i % 10}.000Z`, event: 'login', user: `u${i}`, ip: null }); out.push(l); } return out; };
  await t('activity log: every line is sealed (HMAC) to the one before; the whole log checks out', () => {
    const lines = make(6);
    for (const l of lines) assert.match(JSON.parse(l).ch, /^[\w-]{43}$/);
    const r = A.auditVerify(lines); assert.equal(r.ok, true); assert.equal(r.chained, 6); assert.equal(r.older, 0);
  });
  await t('activity log: a changed, removed or added line breaks the chain right there', () => {
    const lines = make(6);
    const changed = [...lines]; changed[2] = changed[2].replace('"u2"', '"mallory"');
    assert.deepEqual([A.auditVerify(changed).ok, A.auditVerify(changed).brokenAt], [false, 3]);
    const removed = lines.filter((_, i) => i !== 3); assert.equal(A.auditVerify(removed).brokenAt, 4);
    const forged = JSON.stringify({ at: '2026-11-03T00:00:00.000Z', event: 'login', user: 'x', ch: 'A'.repeat(43) });
    assert.equal(A.auditVerify([...lines.slice(0, 2), forged, ...lines.slice(2)]).brokenAt, 3);
    const plain = JSON.stringify({ at: '2026-11-03T00:00:00.000Z', event: 'login', user: 'x' });
    assert.equal(A.auditVerify([...lines.slice(0, 2), plain, ...lines.slice(2)]).brokenAt, 3, 'an unsealed line after the chain began');
  });
  await t('activity log: the oldest lines trimmed (a year, 5,000 events) or written before the chain are fine', () => {
    const lines = make(8), old = [JSON.stringify({ at: '2026-01-01T00:00:00.000Z', event: 'login', user: 'old' })];
    assert.equal(A.auditVerify(lines.slice(3)).ok, true);
    const r = A.auditVerify([...old, ...lines]); assert.equal(r.ok, true); assert.equal(r.older, 1);
  });
  await t('activity log: a new key (the secret key was lost) starts the chain again from a marked line, not a false alarm', () => {
    const before = make(3);
    const body = JSON.stringify({ at: '2026-11-04T00:00:00.000Z', event: 'audit-chain-restart', reason: 'new key' }), ch = A.auditMac(null, body);
    const restart = `${body.slice(0, -1)},"ch":"${ch}"}`;
    const broken = before.map((l) => l.replace(/"ch":"[\w-]+"/, `"ch":"${'B'.repeat(43)}"`));   // sealed with a key that is gone
    A.resetHead(); /* chain on from the restart line */
    const after = []; let prev = ch; for (let i = 0; i < 2; i++) { const e = { at: '2026-11-04T01:00:00.000Z', event: 'login', user: `n${i}`, ip: null }, b = JSON.stringify(e), c = A.auditMac(prev, b); after.push(`${b.slice(0, -1)},"ch":"${c}"}`); prev = c; }
    const r = A.auditVerify([broken[0], ...[], restart, ...after]);
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.chained, 3);
  });
  await t('activity export (JSON): signed with Ed25519 and the public key; an edited file no longer checks out', () => {
    const x = A.auditSignedExport([{ at: '2026-11-05T00:00:00.000Z', event: 'login', user: 'owner1' }], { exported: '2026-11-05T00:00:01.000Z', version: 'test' });
    const { signature: s, ...body } = JSON.parse(JSON.stringify(x, null, 1));
    const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(s.publicKey, 'base64')]), format: 'der', type: 'spki' });
    assert.equal(s.alg, 'Ed25519'); assert.ok(crypto.verify(null, Buffer.from(JSON.stringify(body)), pub, Buffer.from(s.value, 'base64')));
    body.events[0].user = 'someone-else';
    assert.ok(!crypto.verify(null, Buffer.from(JSON.stringify(body)), pub, Buffer.from(s.value, 'base64')));
    assert.ok('chain' in body && typeof body.chain.ok === 'boolean');
  });
  await t('security score: nine protections, each on or off with where to turn it on; every title translated (tools/i18n-strings.tsv)', () => {
    const sc = A.securityScore(); assert.equal(sc.of, 9); assert.equal(sc.on, sc.items.filter((i) => i.on).length);
    const rows = new Map(fs.readFileSync(path.join(APP, '..', 'tools', 'i18n-strings.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => { const c = l.split('\t'); return [c[0], c]; }));
    const texts = [...sc.items.map((i) => i.title), 'Security score', '{n} of {total} protections on', 'Activity log', 'Intact.', 'Intact: {n} events, each sealed to the one before.', 'The activity log was changed outside CasaTorch, from line {n} on.', 'See the activity log'];
    for (const x of texts) { const r = rows.get(x); assert.ok(r, `not in i18n-strings.tsv: ${x}`); assert.equal(r.length, 14, x); assert.ok(r.every(Boolean), x); }
    for (const i of sc.items) if (i.fix) assert.match(i.fix, /^#settings\/[a-z]+$/);
  });
}
