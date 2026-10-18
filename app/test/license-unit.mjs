/* Unit tests for CasaTorch Pro keys and the trial (src/server/07-license.js). Run from test/unit.mjs (which
   loads server.js first). The tests sign keys with a throwaway key pair of their own - never the real one. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export default async function licenseTests(t) {
  const L = globalThis.__casatorchLicense;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  L.useTestKey(publicKey);
  const sign = (payload, key = privateKey) => { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${p}.${crypto.sign(null, Buffer.from(p), key).toString('base64url')}`; };
  const day = 86400_000, iso = (ms) => new Date(ms).toISOString();
  const saved = { trialStart: L.licState.trialStart, runMs: L.licState.runMs, renew: L.licState.renew };
  const reset = () => Object.assign(L.licState, saved);

  t('license: a key we signed is valid; anything else is refused with a reason', () => {
    const k = sign({ email: 'buyer@example.com', plan: 'yearly', homes: 1, expires: iso(Date.now() + 300 * day) });
    assert.equal(L.checkLicenseKeyNow(k).valid, true);
    const { privateKey: other } = crypto.generateKeyPairSync('ed25519');
    assert.match(L.checkLicenseKeyNow(sign({ email: 'x@example.com', plan: 'lifetime', expires: null }, other)).why, /not issued by CasaTorch/);
    assert.match(L.checkLicenseKeyNow('nonsense').why, /not a CasaTorch license key/);
    assert.match(L.checkLicenseKeyNow(`${k}.extra`).why, /not a CasaTorch license key/);
    const [p, s] = k.split('.'); const tampered = `${Buffer.from(JSON.stringify({ email: 'buyer@example.com', plan: 'lifetime', expires: null })).toString('base64url')}.${s}`;
    assert.equal(L.checkLicenseKeyNow(tampered).valid, false, 'a changed payload breaks the signature');
    assert.equal(L.checkLicenseKeyNow(`${p}.${s.slice(0, -4)}AAAA`).valid, false);
  });
  t('license: a signed key with an unknown plan or no readable end date never counts as forever', () => {
    assert.equal(L.checkLicenseKeyNow(sign({ email: 'a@example.com', plan: 'family-unlimited', expires: null })).valid, false);
    assert.equal(L.checkLicenseKeyNow(sign({ email: 'a@example.com', plan: 'monthly', expires: 'soon' })).valid, false);
    assert.equal(L.checkLicenseKeyNow(sign({ email: 'a@example.com', plan: 'monthly' })).valid, false);
    assert.equal(L.checkLicenseKeyNow(sign({ email: 'a@example.com', plan: 'lifetime', expires: null })).valid, true);
  });
  t('license: active, grace (14 days, 30 when casatorch.com was down), then Basic with nothing deleted', () => {
    const lapsed = (days) => sign({ email: 'b@example.com', plan: 'monthly', homes: 1, expires: iso(Date.now() - days * day) });
    let restore = L.patchConfig({ license: sign({ email: 'b@example.com', plan: 'monthly', homes: 1, expires: iso(Date.now() + 10 * day) }) });
    try { const p = L.proStatus(); assert.equal(p.pro, true); assert.equal(p.plan, 'monthly'); assert.equal(p.grace, false); } finally { restore(); }
    L.licState.renew = { unreachable: false };
    restore = L.patchConfig({ license: lapsed(5) });
    try { const p = L.proStatus(); assert.equal(p.pro, true); assert.equal(p.grace, true); assert.equal(p.graceDaysLeft, 9); } finally { restore(); }
    restore = L.patchConfig({ license: lapsed(20) });
    try { const p = L.proStatus(); assert.equal(p.pro, false); assert.match(p.note, /Nothing was deleted/); } finally { restore(); }
    L.licState.renew = { unreachable: true };   // our outage: the longer grace
    restore = L.patchConfig({ license: lapsed(20) });
    try { const p = L.proStatus(); assert.equal(p.pro, true); assert.equal(p.grace, true); } finally { restore(); }
    restore = L.patchConfig({ license: lapsed(31) });
    try { assert.equal(L.proStatus().pro, false); } finally { restore(); reset(); }
  });
  t('trial: 14 days from setup; re-running setup or setting the clock back does not stretch it', () => {
    let restore = L.patchConfig({ license: undefined, setupAt: iso(Date.now() - 3 * day) });
    L.licState.trialStart = null; L.licState.runMs = 3 * day;
    try { const p = L.proStatus(); assert.equal(p.plan, 'trial'); assert.equal(p.trialDaysLeft, 11); } finally { restore(); }
    // setup run again yesterday, but the box remembers when the trial really began
    L.licState.trialStart = iso(Date.now() - 13.5 * day);
    restore = L.patchConfig({ license: undefined, setupAt: iso(Date.now() - day) });
    try { assert.equal(L.proStatus().trialDaysLeft, 1); } finally { restore(); }
    // the clock set back 30 days: the calendar says "plenty left", the running time says it's over
    L.licState.trialStart = null; L.licState.runMs = 14.2 * day;
    restore = L.patchConfig({ license: undefined, setupAt: iso(Date.now() + 25 * day) });
    try { const p = L.proStatus(); assert.equal(p.pro, false); assert.equal(p.trialEnded, true); assert.match(p.note, /Nothing was deleted/); } finally { restore(); reset(); }
  });
  t('license: a valid key wins over an ended trial; developer mode stays separate', () => {
    L.licState.runMs = 40 * day;
    const restore = L.patchConfig({ setupAt: iso(Date.now() - 90 * day), license: sign({ email: 'c@example.com', plan: 'lifetime', homes: 1, expires: null }) });
    try { const p = L.proStatus(); assert.equal(p.pro, true); assert.equal(p.plan, 'lifetime'); assert.equal(p.expires, null); } finally { restore(); reset(); }
  });
  t('radar provider: NWS tiles are a WMS box for the tile, US-only; RainViewer stays the default', () => {
    const R = globalThis.__casatorchRadar;
    const u = new URL(R.radarNwsTileUrl(7, 20, 49));
    assert.equal(u.hostname, 'opengeo.ncep.noaa.gov'); assert.equal(u.searchParams.get('srs'), 'EPSG:3857'); assert.equal(u.searchParams.get('layers'), 'conus_bref_qcd');
    const [minx, miny, maxx, maxy] = u.searchParams.get('bbox').split(',').map(Number);
    assert.ok(Math.abs((maxx - minx) - (maxy - miny)) < 0.1 && Math.abs(maxx - minx - 313086.07) < 1, 'one zoom-7 tile is about 313 km square');
    assert.equal(R.radarUrlAllowed(u.toString()), true);
    assert.equal(R.radarNwsCovers({ lat: 37.77, lon: -122.42 }), true); assert.equal(R.radarNwsCovers({ lat: 51.5, lon: -0.12 }), false);
    assert.equal(R.radarProviderSetting(), 'rainviewer');
  });
  t('about: open-source licenses page - AGPL notice, the notices file, every installed package; markdown is escaped', async () => {
    const O = globalThis.__casatorchOss, fs = await import('node:fs');
    const [shipped, root] = O.OSS_NOTICES.map((f) => fs.readFileSync(f, 'utf8'));
    assert.equal(shipped, root, 'app/catalog/THIRD_PARTY_NOTICES.md must be a copy of the one at the repo root');
    const html = O.ossPage();
    assert.match(html, /GNU Affero General Public License/); assert.match(html, /no warranty/); assert.match(html, /RainViewer/);
    const pk = O.ossPackages(); assert.ok(pk.length > 50); assert.ok(pk.some((p) => p.name === 'three' && p.license === 'MIT'));
    assert.ok(!pk.some((p) => /^(A?GPL-[23]\.0(-only|-or-later)?|SSPL|BUSL)/.test(p.license)), 'no GPL-only, SSPL or BUSL package');
    assert.equal(O.ossMarkdown('a <script>x</script> [y](javascript:alert(1)) **b**'), '<p>a &lt;script&gt;x&lt;/script&gt; [y](javascript:alert(1)) <b>b</b></p>');
  });
}
