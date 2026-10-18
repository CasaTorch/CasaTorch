/* Security unit tests (pre-launch review): outbound-request guard (metadata by name and by redirect, sign-ins
   dropped on a cross-site redirect, CasaTorch's own requests to this computer marked), member links must be on
   the internet, the pre-setup read gate's open list, rate limits that count every call.
   Loaded by unit.mjs after the server (CASATORCH_TEST=1). */
import assert from 'node:assert/strict';
import http from 'node:http';
import dnsP from 'node:dns/promises';

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
  } finally { dnsP.lookup = realLookup; srv.close(); }
}
