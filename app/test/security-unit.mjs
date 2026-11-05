/* Security unit tests (pre-launch review): outbound-request guard (metadata by name and by redirect, sign-ins
   dropped on a cross-site redirect, CasaTorch's own requests to this computer marked), member links must be on
   the internet, the pre-setup read gate's open list, rate limits that count every call.
   Loaded by unit.mjs after the server (CASATORCH_TEST=1). */
import assert from 'node:assert/strict';
import http from 'node:http';
import dnsP from 'node:dns/promises';
import crypto from 'node:crypto';

export default async function securityUnit(t) {
  const S = globalThis.__casatorchGuard;
  if (!S) { console.log('skip security-unit (no __casatorchGuard)'); return; }
  /* Names that point at the cloud's metadata service, or at this computer, without the internet. */
  const realLookup = dnsP.lookup;
  const FAKE = { 'meta.test': '169.254.169.254', 'meta6.test': '::ffff:169.254.169.254', 'loop.test': '127.0.0.1', 'lan.test': '192.168.1.20', 'pub.test': '93.184.216.34' };   // scrub-ok: documentation-style example addresses
  dnsP.lookup = async (h, o) => (FAKE[h] ? (o?.all ? [{ address: FAKE[h], family: FAKE[h].includes(':') ? 6 : 4 }] : { address: FAKE[h], family: 4 }) : realLookup(h, o));
  /* A tiny web server: /to?u=<url> redirects there; anything else answers with the headers it got. */
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/to') { res.writeHead(Number(u.searchParams.get('s')) || 302, { Location: u.searchParams.get('u') }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ method: req.method, headers: req.headers }));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const P = srv.address().port, A = `http://127.0.0.1:${P}`, B = `http://localhost:${P}`;
  try {
    await t('ssrf: metadata address refused (literal, decimal, IPv6-mapped)', async () => {
      for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://2852039166/', 'http://[::ffff:169.254.169.254]/', 'http://metadata.google.internal/']) await assert.rejects(fetch(u), /not allowed/, u);
    });
    await t('ssrf: a name that points at the metadata service is refused', async () => {
      await assert.rejects(fetch('http://meta.test/latest/meta-data/'), /not allowed/);
      await assert.rejects(fetch('http://meta6.test/'), /not allowed/);
    });
    await t('ssrf: a redirect to the metadata service is refused (literal and by name), any status', async () => {
      for (const s of [301, 302, 303, 307, 308]) await assert.rejects(fetch(`${A}/to?s=${s}&u=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`), /not allowed/, String(s));
      await assert.rejects(fetch(`${A}/to?u=${encodeURIComponent('http://meta.test/')}`), /not allowed/);
    });
    await t('ssrf: a redirect to file: or another scheme is refused', async () => {
      await assert.rejects(fetch(`${A}/to?u=${encodeURIComponent('file:///etc/passwd')}`), /not allowed/);
      await assert.rejects(fetch('file:///etc/passwd'));
    });
    await t('ssrf: redirects still work, POST becomes GET on 303, and the final address is reported', async () => {
      const r = await fetch(`${A}/to?s=303&u=${encodeURIComponent(`${A}/end`)}`, { method: 'POST', body: 'x' });
      assert.equal(r.status, 200); assert.equal((await r.json()).method, 'GET'); assert.equal(r.url, `${A}/end`);
      const r7 = await fetch(`${A}/to?s=307&u=${encodeURIComponent(`${A}/end`)}`, { method: 'POST', body: 'x' });
      assert.equal((await r7.json()).method, 'POST');
    });
    await t('ssrf: sign-ins are dropped on a redirect to another site, kept on the same site', async () => {
      const same = await (await fetch(`${A}/to?u=${encodeURIComponent(`${A}/end`)}`, { headers: { Authorization: 'Bearer secret-token-1' } })).json();
      assert.equal(same.headers.authorization, 'Bearer secret-token-1');
      const other = await (await fetch(`${A}/to?u=${encodeURIComponent(`${B}/end`)}`, { headers: { Authorization: 'Bearer secret-token-1', Cookie: 'a=b' } })).json();
      assert.equal(other.headers.authorization, undefined); assert.equal(other.headers.cookie, undefined);
    });
    await t('ssrf: a redirect the caller handles itself is passed back untouched', async () => {
      const r = await fetch(`${A}/to?u=${encodeURIComponent('http://169.254.169.254/')}`, { redirect: 'manual' });
      assert.equal(r.status, 302);
    });
    await t('loopback: CasaTorch\'s own requests to its own port on this computer are marked (address, name, redirect), others are not', async () => {
      assert.equal((await (await fetch(`${A}/x`)).json()).headers['x-casatorch-internal'], undefined, 'another program on this computer');
      S.SELF_PORTS.add(P);
      assert.equal((await (await fetch(`${A}/to?u=${encodeURIComponent(`${B}/x`)}`)).json()).headers['x-casatorch-internal'], '1', 'after a redirect');
      assert.equal((await (await fetch(`${A}/x`)).json()).headers['x-casatorch-internal'], '1');
      assert.equal(await S.assertFetchable('http://loop.test/'), true, 'a name that points at this computer');
      assert.equal((await (await fetch(`${B}/x`)).json()).headers['x-casatorch-internal'], '1');
      assert.equal(await S.assertFetchable('http://pub.test/'), false);
      assert.equal(await S.assertFetchable('http://lan.test/'), false);
      S.SELF_PORTS.delete(P);
    });
    await t('member links: only internet addresses (not this box, the home network, CGNAT, sign-ins in the link)', async () => {
      for (const u of ['http://127.0.0.1:8123/', 'http://localhost/', 'http://homeassistant.local:8123/', 'http://router/', 'http://10.0.0.1/', 'http://192.168.1.20/', 'http://172.20.1.1/', 'http://100.100.1.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://0.0.0.0/', 'http://loop.test/', 'http://lan.test/', 'http://meta.test/', 'http://user:pw@pub.test/', 'file:///etc/passwd', 'gopher://pub.test/', 'not a url']) assert.ok(await S.publicUrlProblem(u), u);   // scrub-ok: example addresses for the range checks
      assert.equal(await S.publicUrlProblem('https://pub.test/calendar.ics'), null);
      assert.equal(await S.publicUrlProblem('https://93.184.216.34/c.ics'), null);   // scrub-ok: documentation-style example address
    });
    await t('member links: fetch with publicOnly refuses this box and the home network before connecting', async () => {
      await assert.rejects(fetch(`${A}/x`, { publicOnly: true }), /internet/);
      await assert.rejects(fetch(`http://lan.test:${P}/x`, { publicOnly: true }), /internet/);
    });
    t('pre-setup gate: only the pages setup needs before the code answer', () => {
      for (const p of ['/health', '/lang', '/auth/state', '/app/hello', '/setup/state', '/setup/code', '/setup/ask', '/setup/ask/abc', '/local-https/target']) assert.ok(S.PRESETUP_OPEN.test(p), p);
      for (const p of ['/system/log', '/system/diagnostics', '/settings', '/setup/current', '/setup/progress', '/users', '/auth/admin/audit', '/health/', '/backup', '/support/bundle', '/doctor']) assert.ok(!S.PRESETUP_OPEN.test(p), p);
    });
    t('rate limits: overLimit counts every call', () => {
      const k = `unit-ol-${Date.now()}`; let n = 0; for (let i = 0; i < 10; i++) if (!S.overLimit(k, 3, 60_000)) n++;
      assert.equal(n, 3);
    });
    t('nonPublicIp: v4 and v6 ranges', () => {
      for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.1.1', '172.31.0.1', '192.168.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.ok(S.nonPublicIp(ip), ip);   // scrub-ok: example addresses for the range checks
      for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111']) assert.ok(!S.nonPublicIp(ip), ip);
    });
    const Z = globalThis.__casatorchSec;
    await t('passwords: async scrypt reads and writes the same hashes as before, without blocking the event loop', async () => {
      const old = Z.hashSecret('correct horse battery'), neu = await Z.hashSecretAsync('correct horse battery');
      assert.match(neu, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
      assert.equal(await Z.verifySecretAsync(old, 'correct horse battery'), true, 'old (sync) hash, async check');
      assert.equal(Z.verifySecret(neu, 'correct horse battery'), true, 'new (async) hash, old check - downgrades keep working');
      assert.equal(await Z.verifySecretAsync(neu, 'wrong horse'), false);
      assert.equal(await Z.verifySecretAsync('scrypt$00$zz', 'x'), false, 'a damaged hash is a wrong password, not a crash');
      assert.equal(await Z.verifySecretAsync('', 'x'), false);
      let ticks = 0; const iv = setInterval(() => ticks++, 1);
      await Promise.all(Array.from({ length: 6 }, () => Z.verifySecretAsync(old, 'nope')));
      clearInterval(iv); assert.ok(ticks > 0, 'timers ran while six checks were worked out');
      const rc = await Z.rcHashAsync('abcde-12345');
      assert.equal(Z.rcMatch(rc, 'abcde-12345'), true); assert.equal(await Z.rcMatchAsync(Z.rcHash('abcde-12345'), 'abcde-12345'), true);
      assert.equal(await Z.rcMatchAsync(rc, 'abcde-12346'), false);
    });
    t('rate limits: a try is counted before the slow check, so parallel requests cannot slip under the limit', () => {
      const k = `unit-rt-${Date.now()}`, undos = [];
      for (let i = 0; i < 5; i++) { assert.equal(Z.limited(k, 5), false); undos.push(Z.reserveTry(k)); }
      assert.equal(Z.limited(k, 5), true, 'five in flight already fill the limit');
      undos[2](); assert.equal(Z.limited(k, 5), false, 'a right password takes its try back');
    });
    t('secure access: the box sends its Pro key with a tunnel request (and nothing extra without one)', () => {
      const RM = globalThis.__casatorchRemote;
      const withKey = RM.remoteRequestBody({ house: { name: 'Home' }, license: ' CT1.payload.sig ', remote: { secret: 's3' } });
      assert.equal(withKey.key, 'CT1.payload.sig'); assert.equal(withKey.secret, 's3'); assert.ok(withKey.id);
      const trial = RM.remoteRequestBody({ house: { name: 'Home' } });
      assert.ok(!('key' in trial) && !('secret' in trial));
    });
    t('push relay: the home id sent to the relay is bound to the box key (nothing to squat)', () => {
      const k = Z.relayKey(), id = Z.relayHomeId(k.pub);
      assert.match(id, /^k[A-Za-z0-9_-]{32}$/);
      assert.equal(id, `k${crypto.createHash('sha256').update(Buffer.from(k.pub, 'base64')).digest('base64url').slice(0, 32)}`);
      assert.notEqual(Z.relayHomeId(Buffer.alloc(32, 7).toString('base64')), id);
    });
    await t('town search: Nominatim only from the box, 3+ characters, one request a second, cached, with credit', async () => {
      const P = globalThis.__casatorchPlaces, real = globalThis.fetch, seen = [];
      globalThis.fetch = async (u, o = {}) => { const url = String(u); if (!url.startsWith('https://nominatim.openstreetmap.org/')) return real(u, o); seen.push({ url, ua: o.headers?.['User-Agent'], at: Date.now() }); return new Response(JSON.stringify([{ lat: '47.6062', lon: '-122.3321', name: 'Springfield', address: { city: 'Springfield', state: 'Oregon', country_code: 'us' } }]), { headers: { 'Content-Type': 'application/json' } }); };
      try {
        assert.deepEqual(await P.placeSearch('ab'), []); assert.equal(seen.length, 0, 'fewer than 3 characters never leave the box');
        const tag = Date.now().toString(36);
        const a = await P.placeSearch(`Springfield ${tag}`), b = await P.placeSearch(`springfield  ${tag.toUpperCase()}`.toLowerCase());
        assert.equal(a[0].name, 'Springfield, Oregon, US'); assert.equal(a[0].cc, 'US'); assert.deepEqual(a, b); assert.equal(seen.length, 1, 'the same search is answered from the cache');
        assert.match(seen[0].ua, /^CasaTorch\/[\d.]+ \(\+https:\/\/casatorch\.com\)$/, 'CasaTorch\'s own User-Agent');
        await P.placeSearch(`Shelbyville ${tag}`);
        assert.equal(seen.length, 2); assert.ok(seen[1].at - seen[0].at >= 1000, `at most one request a second (${seen[1].at - seen[0].at} ms)`);
        assert.match(P.PLACE_CREDIT.text, /OpenStreetMap/); assert.equal(P.PLACE_MIN, 3);
      } finally { globalThis.fetch = real; }
    });
    await t('internet: provider from Cloudflare trace + RIPEstat (no ipinfo.io), with credit', async () => {
      const P = globalThis.__casatorchPlaces, real = globalThis.fetch, hosts = [];
      const J = (b) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
      globalThis.fetch = async (u, o = {}) => { const url = new URL(String(u)); hosts.push(url.hostname);
        if (url.href === 'https://1.1.1.1/cdn-cgi/trace') return new Response('fl=1\nip=203.0.113.9\nloc=US\n');   // scrub-ok: documentation address
        if (url.pathname.endsWith('/network-info/data.json')) return J({ data: { asns: ['64500'], prefix: '203.0.113.0/24' } });   // scrub-ok: documentation prefix
        if (url.pathname.endsWith('/as-overview/data.json')) return J({ data: { holder: 'EXAMPLE-NET - Example Internet, Inc.' } });
        return real(u, o); };
      try {
        const i = await P.ispInfo();
        assert.deepEqual(i, { ip: '203.0.113.9', country: 'United States', asn: 64500, provider: 'Example Internet, Inc.' });   // scrub-ok: documentation address
        assert.ok(!hosts.some((h) => /ipinfo/.test(h)));
      } finally { globalThis.fetch = real; }
    });
    await t('releases: installers and the add-on build check the source against the signed release (verify-release.js)', async () => {
      const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), crypto = await import('node:crypto'), { spawnSync } = await import('node:child_process');
      const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), canon = fs.readFileSync(path.join(root, 'deploy/packaging/verify-release.js'), 'utf8');
      // Updates install only signed releases, never fail open, and never go backwards.
      const rdx = (f) => fs.readFileSync(path.join(root, f), 'utf8');
      const upd = rdx('deploy/packaging/linux/casatorch-update');
      assert.match(upd, /\[ -s "\$KEY" \] \|\| \{[^\n]*exit 1; \}/, 'the updater refuses to run without its release key');
      assert.ok(!/if \[ -f "\$KEY" \]/.test(upd), 'the signature check is not optional');
      assert.match(upd, /dpkg-deb -f "\$tmp\/\$file" Version/); assert.match(upd, /dpkg --compare-versions "\$pkgver" gt "\$cur"/);
      assert.ok(upd.indexOf('dpkg --compare-versions') < upd.indexOf('apt-get install'), 'versions are checked before anything is installed');
      for (const f of ['deploy/install.sh', 'deploy/install.ps1']) assert.match(rdx(f), /should be signed, but its signed file list couldn't be checked/, `${f}: a 0.8+ release without its signed list is refused`);
      const unit = rdx('deploy/packaging/linux/casatorch.service');
      for (const k of ['NoNewPrivileges=true', 'CapabilityBoundingSet=', 'ProtectSystem=strict', 'ProtectKernelTunables=true', 'RestrictSUIDSGID=true', 'UMask=0077']) assert.ok(unit.includes(k), `casatorch.service: ${k}`);
      // Supply chain: no package's install scripts run - not on a developer's computer, in CI, or in any installer.
      assert.match(rdx('app/.npmrc'), /^ignore-scripts=true$/m);
      for (const f of ['app/Dockerfile', 'ha-addon/Dockerfile', 'deploy/packaging/bundle.sh', 'deploy/install.sh', 'deploy/install.ps1', '.github/workflows/ci.yml'])
        for (const l of rdx(f).split('\n').filter((x) => /\bnpm (ci|install)\b/.test(x) && !/playwright@/.test(x))) assert.match(l, /--ignore-scripts/, `${f}: ${l.trim()}`);
      // One verifier everywhere: the add-on's copy, the one inside install.sh and the one inside install.ps1.
      assert.equal(fs.readFileSync(path.join(root, 'ha-addon/verify-release.js'), 'utf8'), canon);
      assert.ok(fs.readFileSync(path.join(root, 'deploy/install.sh'), 'utf8').includes(`<<'VERIFY_JS'\n${canon}VERIFY_JS\n`), 'install.sh carries the same verifier');
      assert.ok(fs.readFileSync(path.join(root, 'deploy/install.ps1'), 'utf8').includes(`@'\n${canon}'@`), 'install.ps1 carries the same verifier');
      const pub = fs.readFileSync(path.join(root, 'deploy/packaging/release-key.pub.pem'), 'utf8').trim();
      assert.ok(canon.includes(pub.split('\n')[1]), 'the built-in key is the release key');
      const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8'), addonVer = rd('ha-addon/config.yaml').match(/^version:\s*"?([\d.]+)/m)[1];
      assert.match(rd('deploy/install.sh'), /REF="\$\{CASATORCH_REF:-\$\{CASATORCH_BRANCH:-\}\}"/, 'install.sh: the newest release unless asked');
      assert.match(rd('deploy/install.ps1'), /elseif \(\$env:CASATORCH_BRANCH\) \{ \$env:CASATORCH_BRANCH \} else \{ '' \}/, 'install.ps1: the newest release unless asked');
      assert.match(rd('ha-addon/build.yaml'), new RegExp(`CASATORCH_REF: v${addonVer.replace(/\./g, '\\.')}\\b`), 'the add-on builds the release tag of its own version');
      assert.match(rd('ha-addon/Dockerfile'), /ARG CASATORCH_REF=v\d/); assert.ok(!/refs\/heads\//.test(rd('ha-addon/Dockerfile') + rd('deploy/install.ps1')));
      // A tag from 0.8.0 on is always signed: the add-on build stops when its signed file list can't be checked (never builds it unchecked).
      const strict = rd('ha-addon/Dockerfile').match(/if \[ "\$rc" = 2 \] && echo "\$CASATORCH_REF" \| grep -Eq '([^']+)'; then [^\n]*exit 1; fi/);
      assert.ok(strict, 'the add-on refuses an unsigned 0.8.0+ tag');
      const signedEra = new RegExp(strict[1]);
      for (const r of ['v0.8.0', 'v0.9.1', 'v0.10.0', 'v1.0.0', 'v12.3.4']) assert.ok(signedEra.test(r), r);
      for (const r of ['v0.7.9', 'v0.1.0', 'main', 'v0.8']) assert.ok(!signedEra.test(r), r);
      // A made-up release signed with a throwaway key.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rel-')), src = path.join(tmp, 'src'), rel = path.join(tmp, 'rel');
      try {
        fs.mkdirSync(path.join(src, 'app/src'), { recursive: true }); fs.mkdirSync(rel);
        fs.writeFileSync(path.join(src, 'app/src/a.js'), 'one'); fs.writeFileSync(path.join(src, 'README.md'), 'two');
        const sh = (b) => crypto.createHash('sha256').update(b).digest('hex');
        const list = `${sh('two')}  README.md\n${sh('one')}  app/src/a.js\n`;
        fs.writeFileSync(path.join(rel, 'casatorch-source-files.sha256'), list);
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        fs.writeFileSync(path.join(tmp, 'k.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
        const sign = (sums) => { fs.writeFileSync(path.join(rel, 'SHA256SUMS'), sums); fs.writeFileSync(path.join(rel, 'SHA256SUMS.sig'), crypto.sign(null, Buffer.from(sums), privateKey)); };
        sign(`${sh('deb')}  casatorch_amd64.deb\n${sh(list)}  casatorch-source-files.sha256\n`);
        const run = (extra = [], env = { CASATORCH_RELEASE_KEY_FILE: path.join(tmp, 'k.pem') }) => spawnSync(process.execPath, [path.join(root, 'deploy/packaging/verify-release.js'), src, path.join(rel, 'SHA256SUMS'), path.join(rel, 'SHA256SUMS.sig'), path.join(rel, 'casatorch-source-files.sha256'), ...extra], { env: { ...process.env, ...env } }).status;
        assert.equal(run(), 0, 'a matching download');
        assert.equal(run([], {}), 1, 'signed with another key than CasaTorch\'s');
        fs.writeFileSync(path.join(src, 'app/src/zz-extra.js'), 'evil'); assert.equal(run(), 1, 'an added file (it would be built in)');
        fs.writeFileSync(path.join(tmp, 'names'), 'README.md\napp/src/a.js\n'); assert.equal(run([path.join(tmp, 'names')]), 0, 'a git checkout: only tracked files count');
        fs.rmSync(path.join(src, 'app/src/zz-extra.js'));
        fs.writeFileSync(path.join(src, 'README.md'), 'changed'); assert.equal(run(), 1, 'a changed file'); fs.writeFileSync(path.join(src, 'README.md'), 'two');
        fs.writeFileSync(path.join(rel, 'casatorch-source-files.sha256'), list.replace('README.md', 'OTHER.md')); assert.equal(run(), 1, 'a file list that isn\'t the signed one');
        fs.writeFileSync(path.join(rel, 'casatorch-source-files.sha256'), list);
        sign(`${sh('deb')}  casatorch_amd64.deb\n`); assert.equal(run(), 2, 'a release from before signed file lists');
        fs.rmSync(path.join(rel, 'SHA256SUMS.sig')); assert.equal(run(), 2, 'no signature at all');
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });

    t('secure access: only rules that reach this CasaTorch are accepted from Cloudflare\'s side of the tunnel', () => {
      const R = globalThis.__casatorchRemote, line = (c) => `2026-11-04T00:00:00Z INF Updated to new configuration config=${JSON.stringify(JSON.stringify(c))} version=2`;
      const okRules = { ingress: [{ hostname: 'home-a.casatorch.com', service: 'http://localhost:8090' }, { service: 'http_status:404' }], 'warp-routing': { enabled: false } };
      assert.equal(R.remoteConfigProblem(line(okRules), { port: 8090 }), null);
      assert.equal(R.remoteConfigProblem(line({ ingress: [{ service: 'http://127.0.0.1:8090/' }] }), { port: 8090 }), null);
      // The exact rules casatorch.com pushes to tunnels made before 0.9.2: the home's own name as the Host header is fine.
      assert.equal(R.remoteConfigProblem(line({ ingress: [{ hostname: 'home-a.casatorch.com', service: 'http://localhost:8090', originRequest: { httpHostHeader: 'home-a.casatorch.com' } }, { service: 'http_status:404' }] }), { port: 8090 }), null, 'existing tunnels keep working');
      assert.match(String(R.remoteConfigProblem(line({ ingress: [{ hostname: 'home-a.casatorch.com', service: 'http://localhost:8090', originRequest: { httpHostHeader: 'home-b.casatorch.com' } }] }), { port: 8090 })), /httpHostHeader/, 'another name is still refused');
      for (const [bad, why] of [
        [{ ingress: [{ hostname: 'home-a.casatorch.com', service: 'http://192.0.2.1:80' }, { service: 'http_status:404' }] }, /visitors sent to http:\/\/192\.0\.2\.1:80/],
        [{ ingress: [{ service: 'http://localhost:8123' }] }, /visitors sent/],   // Home Assistant on this computer
        [{ ingress: [{ service: 'ssh://localhost:22' }] }, /visitors sent/],
        [{ ingress: [{ service: 'tcp://192.0.2.9:445' }] }, /visitors sent/],
        [{ ingress: [{ service: 'http://localhost:8090', originRequest: { proxyType: 'socks' } }] }, /proxyType/],
        [{ ingress: [{ service: 'http://localhost:8090' }], originRequest: { httpHostHeader: '127.0.0.1' } }, /httpHostHeader/],
        [{ ...okRules, 'warp-routing': { enabled: true } }, /private network/],
      ]) assert.match(String(R.remoteConfigProblem(line(bad), { port: 8090 })), why, JSON.stringify(bad));
      assert.match(R.remoteConfigProblem('INF Updated to new configuration config="{not json" version=3', { port: 8090 }), /could not be read/, 'unreadable rules count as wrong');
      assert.equal(R.remoteLineKind(line(okRules)), 'config');
      assert.equal(R.tunnelConfigText('home-a.casatorch.com', 8090), '# Written by CasaTorch each time secure access starts: visitors reach this CasaTorch and nothing else.\ningress:\n  - hostname: home-a.casatorch.com\n    service: http://127.0.0.1:8090\n  - service: http_status:404\nwarp-routing:\n  enabled: false\n');
      assert.ok(R.tunnelConfigText('home-ab_c-d.casatorch.com', 8090));
      for (const h of ['a\nservice: ssh://x', 'a b', '', '-x.example.com', 'x:y', 'x'.repeat(260)]) assert.equal(R.tunnelConfigText(h, 8090), null, JSON.stringify(h));
    });

    t('encryption at rest: the secure address\'s private keys are sealed on disk (old plain ones sealed on first read)', async () => {
      const fs = await import('node:fs'), path = await import('node:path'), T = globalThis.__casatorchTls;
      const pem = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      fs.mkdirSync(T.TLS_DIR, { recursive: true }); const f = path.join(T.TLS_DIR, 'test-key.pem');
      try {
        fs.writeFileSync(f, pem);
        assert.equal(T.ltReadKey(f, 'tls.key'), pem, 'an older plain key still works');
        const disk = fs.readFileSync(f, 'utf8');
        assert.match(disk, /^v2\./); assert.ok(!disk.includes('PRIVATE KEY'), 'and is sealed now');
        assert.equal(T.ltReadKey(f, 'tls.key'), pem);
        assert.throws(() => T.ltReadKey(f, 'tls.account'), /does not open/, 'bound to its place');
        T.ltWriteKey(f, pem, 'tls.account'); assert.ok(!fs.readFileSync(f, 'utf8').includes('PRIVATE KEY')); assert.equal(T.ltReadKey(f, 'tls.account'), pem);
        fs.writeFileSync(f, 'hello'); assert.throws(() => T.ltReadKey(f, 'tls.key'), /not a private key/);
      } finally { fs.rmSync(f, { force: true }); }
    });

    t('secure access: a request that came through the tunnel counts as from outside, whatever Host it carries', () => {
      const R = globalThis.__casatorchRemote, U = globalThis.__casatorchSupport, undo = R.patchConfig({ remote: { on: true, hostname: 'home-a.casatorch.com' } });
      try {
        const rq = (addr, headers) => ({ socket: { remoteAddress: addr }, headers });
        const sneaky = rq('127.0.0.1', { host: '127.0.0.1:8090', 'cf-connecting-ip': '198.51.100.7' });
        assert.equal(R.viaTunnel(sneaky), true); assert.equal(R.clientIp(sneaky), '198.51.100.7', 'the visitor\'s own address, for limits and the log');
        assert.equal(U.viaSecureAccess(sneaky), true, 'resetting the owner\'s password stays home-only');
        assert.equal(R.viaTunnel(rq('::ffff:127.0.0.1', { host: 'localhost', 'cf-ray': 'x' })), true);
        assert.equal(R.viaTunnel(rq('192.0.2.5', { host: '192.0.2.4:8090', 'cf-connecting-ip': '198.51.100.7' })), false, 'a device at home can\'t pass itself off as the tunnel');
        assert.equal(R.viaTunnel(rq('127.0.0.1', { host: '127.0.0.1:8090' })), false, 'this computer itself');
      } finally { undo(); }
      assert.equal(R.viaTunnel({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'cf-ray': 'x' } }), false, 'secure access off: no tunnel');
    });
  } finally { dnsP.lookup = realLookup; srv.close(); }
}
