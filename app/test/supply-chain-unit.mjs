/* Supply chain and lock-down checks on the repository's own files: GitHub workflows (pinned actions, least
   privilege, code scanning, signed images), the container and service definitions, pinned base images and the
   vendored front-end files. Loaded by unit.mjs. Nothing here needs the network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

export default async function supplyChainUnit(t) {
  const WF = fs.readdirSync(path.join(root, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));

  await t('workflows: every action is pinned to a full commit (with its version noted), never a tag or branch', () => {
    for (const f of WF) {
      for (const [i, l] of rd(`.github/workflows/${f}`).split('\n').entries()) {
        const m = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/.exec(l); if (!m) continue;
        if (m[1].startsWith('./')) continue;
        assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}:${i + 1} ${m[1]}`);
        assert.match(l, /#\s*v\d/, `${f}:${i + 1} names the version it pins`);
      }
    }
  });

  await t('workflows: read-only by default, write rights only on the job that needs them', () => {
    for (const f of WF) {
      const y = rd(`.github/workflows/${f}`);
      assert.match(y, /^permissions:\s*\{\s*contents:\s*read\s*\}\s*$/m, `${f}: top-level permissions are contents: read`);
      assert.ok(!/write-all|permissions:\s*write/.test(y), `${f}: no blanket write`);
      assert.ok(!/pull_request_target/.test(y), `${f}: never pull_request_target`);
      const checkouts = (y.match(/actions\/checkout@/g) || []).length, noCreds = (y.match(/persist-credentials:\s*false/g) || []).length;
      assert.ok(noCreds >= checkouts, `${f}: every checkout drops its token (persist-credentials: false)`);
    }
  });

  await t('code scanning: CodeQL for JavaScript/TypeScript (every change) and Kotlin + Swift (weekly), dependency review, Scorecard', () => {
    const q = rd('.github/workflows/codeql.yml');
    for (const l of ['javascript-typescript', 'java-kotlin', 'swift', 'actions']) assert.ok(q.includes(l), `CodeQL: ${l}`);
    assert.match(q, /schedule:/); assert.match(q, /security-events: write/);
    assert.match(rd('.github/workflows/dependency-review.yml'), /dependency-review-action@[0-9a-f]{40}/);
    const s = rd('.github/workflows/scorecard.yml');
    assert.match(s, /ossf\/scorecard-action@[0-9a-f]{40}/); assert.match(s, /publish_results: true/);
    assert.ok(!/^env:/m.test(s) && !/^\s+- run:/m.test(s), 'Scorecard: no env and no run steps (needed to publish results)');
  });

}
