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

  await t('releases: an SBOM for the app and the image, the image signed (cosign keyless) with build provenance, digest in the notes', () => {
    const r = rd('.github/workflows/release.yml');
    assert.match(r, /npm sbom [^\n]*--sbom-format cyclonedx/, 'the app SBOM (CycloneDX)');
    assert.match(r, /anchore\/sbom-action@[0-9a-f]{40}[\s\S]*?format: cyclonedx-json/, 'the image SBOM (CycloneDX)');
    assert.match(r, /cosign sign --yes [^\n]*@\$\{?DIGEST/, 'the image is signed by digest, never by tag');
    assert.match(r, /attest-build-provenance@[0-9a-f]{40}[\s\S]*?push-to-registry: true/, 'image provenance pushed to the registry');
    assert.match(r, /attest-build-provenance@[0-9a-f]{40}[\s\S]*?subject-path:/, 'installer provenance');
    assert.match(r, /id-token: write/); assert.match(r, /attestations: write/);
    assert.match(r, /sed "s#image: ghcr.io\/casatorch\/casatorch:latest#image: \$IMAGE:\$V@\$DIGEST#"/, 'the compose file people download names the image by digest');
    assert.match(r, /cosign verify/, 'the release notes say how to check the image');
  });
  await t('releases: only a version tag publishes - the image (and its :latest) is never pushed or signed from a branch run by hand', () => {
    const r = rd('.github/workflows/release.yml'), jobs = r.split(/^jobs:\n/m)[1].split(/^(?=  [a-z][\w-]*:\n)/m);
    for (const j of jobs) {
      if (!/packages: write|contents: write|push: true|cosign sign|action-gh-release/.test(j)) continue;   // a job that publishes something
      assert.match(j, /^    if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/m, `${j.split('\n')[0].trim()} publishes only for a version tag`);
    }
  });

  await t('container: unprivileged user, base image pinned by digest (the same everywhere), no setuid programs or npm, a health check', () => {
    const d = rd('app/Dockerfile'), froms = [...d.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
    assert.ok(froms.length >= 2, 'a build stage and a run stage');
    const pin = /^node:\d+\.\d+\.\d+-[a-z]+-slim@sha256:[0-9a-f]{64}$/;
    for (const f of froms) assert.match(f.replace(/ AS \w+$/, ''), pin, f);
    const base = froms[0];
    assert.ok(froms.every((f) => f === base), 'both stages use the same base');
    assert.ok(rd('ha-addon/Dockerfile').includes(`ARG BUILD_FROM=${base}`), 'the add-on builds on the same base');
    for (const a of ['aarch64', 'amd64']) assert.ok(rd('ha-addon/build.yaml').includes(`${a}: ${base}`), `add-on build.yaml (${a})`);
    assert.match(d, /^USER node:node$/m, 'runs as the node user');
    assert.ok(d.lastIndexOf('USER node') > d.lastIndexOf('RUN '), 'nothing runs as root after USER');
    assert.match(d, /-perm -4000 -o -perm -2000 \\\) -exec chmod u-s,g-s/, 'setuid/setgid bits removed');
    assert.match(d, /rm -rf \/usr\/local\/lib\/node_modules\/npm/, 'no npm in the running image');
    assert.match(d, /^HEALTHCHECK [^\n]*\/api\/health/m);
    assert.match(d, /CASATORCH_DATA_DIR=\/data/); assert.match(d, /HOME=\/data/, 'nothing written outside /data (read-only root)');
    const ep = rd('app/docker-entrypoint.sh');
    assert.match(ep, /exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "\$@"/, 'started as root: drops to node for good');
    assert.match(ep, /exit 78/, 'a settings folder it cannot write is explained, not a stack trace');
  });

  await t('compose, Unraid: read-only, every capability dropped (but the one-time owner fix), no-new-privileges, process and memory limits', () => {
    for (const f of ['deploy/docker-compose.yml', 'deploy/downloads/casatorch-compose.yml']) {
      const y = rd(f);
      for (const k of [/^\s+read_only: true$/m, /^\s+cap_drop: \[ALL\]$/m, /no-new-privileges:true/, /^\s+pids_limit: \d+$/m, /^\s+mem_limit: \d+[mg]$/m, /^\s+cpus: \d/m, /^\s+tmpfs: \["\/tmp:[^"]*noexec[^"]*"\]$/m])
        assert.match(y, k, `${f}: ${k}`);
      const add = /cap_add: \[([^\]]*)\]/.exec(y)?.[1].split(',').map((x) => x.trim()) || [];
      assert.deepEqual(add.sort(), ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'], `${f}: only what the owner fix needs`);
      assert.ok(!/privileged: true|NET_ADMIN|SYS_ADMIN|NET_RAW/.test(y), `${f}: nothing powerful`);
    }
    const x = rd('deploy/unraid/casatorch.xml');
    for (const k of ['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=', '--memory=']) assert.ok(x.includes(k), `Unraid: ${k}`);
    assert.match(x, /<Privileged>false<\/Privileged>/);
  });

  await t('Home Assistant add-on: only the Home Assistant API, AppArmor on, nothing privileged', () => {
    const c = rd('ha-addon/config.yaml');
    for (const k of ['hassio_api: false', 'hassio_role: default', 'docker_api: false', 'host_pid: false', 'host_dbus: false', 'full_access: false', 'apparmor: true', 'privileged: []', 'udev: false', 'kernel_modules: false'])
      assert.ok(c.split('\n').includes(k), `config.yaml: ${k}`);
    assert.match(c, /^homeassistant_api: true$/m);
    assert.ok(!/^(privileged:\s*\[\s*\w|full_access: true|docker_api: true|host_pid: true)/m.test(c));
  });

  await t('Linux service: the full systemd sandbox (syscall filter, no devices, hidden processes, limits); the updater sandboxed too', () => {
    const u = rd('deploy/packaging/linux/casatorch.service');
    for (const k of ['NoNewPrivileges=true', 'ProtectSystem=strict', 'ProtectHome=true', 'PrivateTmp=true', 'PrivateDevices=true', 'ProtectProc=invisible', 'CapabilityBoundingSet=', 'AmbientCapabilities=',
      'ProtectKernelTunables=true', 'ProtectKernelModules=true', 'ProtectKernelLogs=true', 'ProtectControlGroups=true', 'ProtectClock=true', 'ProtectHostname=true', 'RestrictSUIDSGID=true', 'RestrictRealtime=true',
      'RestrictNamespaces=true', 'LockPersonality=true', 'RemoveIPC=true', 'SystemCallArchitectures=native', 'SystemCallFilter=@system-service', 'SystemCallErrorNumber=EPERM', 'UMask=0077', 'TasksMax=512', 'MemoryMax=2G'])
      assert.ok(u.split('\n').includes(k), `casatorch.service: ${k}`);
    assert.match(u, /^SystemCallFilter=~@privileged @resources/m);
    assert.ok(!/^MemoryDenyWriteExecute=true/m.test(u), 'V8\'s JIT needs W+X memory: MemoryDenyWriteExecute stays off');
    assert.ok(!/^User=root/m.test(u) && /^User=casatorch$/m.test(u));
    const up = rd('deploy/packaging/linux/casatorch-update.service');
    for (const k of ['NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectHome=true', 'ProtectKernelModules=true']) assert.ok(up.split('\n').includes(k), `casatorch-update.service: ${k}`);
  });

  await t('vendored front-end files: three.js pinned file by file (SHA-384), the import map carries the same hashes, the server serves only those', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [path.join(root, 'tools/make-vendor-integrity.mjs'), '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const pin = JSON.parse(rd('app/catalog/vendor-integrity.json')), lock = JSON.parse(rd('app/package-lock.json'));
    assert.equal(pin.version, lock.packages['node_modules/three'].version, 'pinned for the version in package-lock.json');
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(rd('app/public/floorplan.html'))[1]);
    for (const [f, h] of Object.entries(pin.files)) if (f.endsWith('.js')) assert.equal(map.integrity[`/vendor/three/${f}`], h, f);
    assert.match(rd('app/src/server/50-floorplan.js'), /if \(!vendorPinned\(rel\)\) return res\.status\(404\)/);
  });

  await t('browser protections in the source: no inline <style> made by script, no style="" in pages, tt.js first on every page with scripts', () => {
    const pub = path.join(root, 'app/public'), cl = path.join(root, 'app/src/client');
    const js = [...fs.readdirSync(cl).map((f) => path.join(cl, f)), ...fs.readdirSync(pub).filter((f) => f.endsWith('.js') && !/^app(-[a-z]+)?\.js$/.test(f)).map((f) => path.join(pub, f))];
    for (const f of js) {
      const t = fs.readFileSync(f, 'utf8');
      assert.ok(!/el\(\s*'style'|createElement\(\s*['"]style['"]\s*\)/.test(t), `${path.basename(f)}: an inline <style> (use a blob: sheet - ctSheet)`);
      assert.ok(!/setAttribute\(\s*['"]style['"]/.test(t), `${path.basename(f)}: style set as an attribute (use .style / cssText)`);
      assert.ok(!/\.(innerHTML|outerHTML)\s*=[^=][^;]*\bstyle=/.test(t), `${path.basename(f)}: HTML with a style attribute`);
    }
    for (const f of fs.readdirSync(pub).filter((x) => x.endsWith('.html'))) {
      const h = fs.readFileSync(path.join(pub, f), 'utf8');
      assert.ok(!/\sstyle="/.test(h), `${f}: a style attribute`);
      assert.ok(!/\son[a-z]+="/.test(h), `${f}: an inline event handler`);
      if (/<script/.test(h)) assert.match(h, /^[\s\S]{0,300}<meta charset="utf-8"><script src="\/tt\.js"><\/script>/, `${f}: tt.js first`);
    }
    const tt = fs.readFileSync(path.join(pub, 'tt.js'), 'utf8');
    assert.match(tt, /createPolicy\('casatorch'/); assert.match(tt, /createPolicy\('default'/); assert.ok(!/createScript\s*[:(]/.test(tt.replace(/createScriptURL/g, '')), 'no policy turns strings into code');
    const sec = rd('app/src/server/01-security.js');
    assert.match(sec, /"require-trusted-types-for 'script'", 'trusted-types casatorch default'/);
    assert.ok(!/style-src[^"`]*'unsafe-inline'/.test(sec), 'style-src without unsafe-inline');
  });
}
