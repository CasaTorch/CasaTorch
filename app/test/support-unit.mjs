/* Unit tests for support (src/server/80-support.js and 08s-activity.js): the support file never carries a secret or a
   name, the settings shape keeps only names of settings, the activity log's filters and retention, and the
   getting-started checklist. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';

export default async function supportTests(t) {
  const S = globalThis.__casatorchSupport;
  const SECRETS = ['eyJhbGciOiJIUzI1NiJ9.c2VjcmV0LXRva2VuLWZvci1oYQ.sig123', 'Hunter2-Garage-Pass', 'sk-live-0123456789abcdefABCDEF', 'pa55word!x'];   // scrub-ok: made-up secrets the test checks never leak
  const cfg = {
    house: { name: 'Maple Cottage', timezone: 'America/Los_Angeles', lang: 'en' },
    homeAssistant: { url: 'http://192.168.1.20:8123', token: SECRETS[0] },
    location: { lat: 47.61, lon: -122.33, name: 'Springfield' },
    cameras: [{ id: 'c1', type: 'snapshot', name: 'Driveway Cam', snapshotUrl: 'http://cam-front.lan/snap.jpg?user=admin&pwd=x', username: 'camuser', password: SECRETS[1] }],
    ai: { provider: 'openai', apiKey: SECRETS[2] },
    remote: { on: true, hostname: 'maple-7f3a.casatorch.com' },
    safety: { 'lock.front_door': true, 'cover.kitchen_blind': false },
    signIn: { enabled: true },
  };
  const people = { users: [{ name: 'Jordan Rivera', username: 'jrivera', email: 'jordan@example.com', password: `scrypt$${'ab'.repeat(16)}$${'cd'.repeat(32)}` }] };

  t('support: the settings shape has setting names, on/off and counts - never values', () => {
    const sh = S.supShape(cfg), txt = JSON.stringify(sh);
    assert.equal(sh.homeAssistant.token, 'set (hidden)');
    assert.equal(sh.homeAssistant.url, 'text');
    assert.equal(sh.location.lat, 'number');
    assert.equal(sh.signIn.enabled, true);
    assert.deepEqual(sh.cameras.items, 1);
    assert.deepEqual(sh.safety, { entries: 2 }, 'a map keyed by device ids shows only how many');
    for (const v of [...SECRETS, 'Maple Cottage', 'Springfield', 'Driveway Cam', '192.168.1.20', 'lock.front_door', '47.61', 'camuser']) assert.ok(!txt.includes(v), `shape leaks ${v}`);
  });

  t('support: masking removes tokens, passwords, e-mails, names, host names, IPs and MACs', () => {
    const priv = S.supPrivateStrings(cfg, people);
    const log = [
      `Home Assistant at http://192.168.1.20:8123 answered 401 with token=${SECRETS[0]}`,
      `camera Driveway Cam: GET http://cam-front.lan/snap.jpg?user=admin&pwd=${SECRETS[1]} failed`,
      'Signed in: jrivera (Jordan Rivera, jordan@example.com) from 10.0.0.12 and fe80::1c2b:3d4e:5f60:7a8b',
      'router aa:bb:cc:11:22:33 at nas.lan; tunnel https://maple-7f3a.casatorch.com up; docs at https://casatorch.com/docs',
      `Authorization: Bearer ${SECRETS[2]} / rtsp://camuser:${SECRETS[3]}@192.168.1.31/stream`,
      'Weather for Springfield, house Maple Cottage; started 2026-10-17T20:52:15.000Z on /home/jordan/casatorch',
    ].join('\n');
    const out = S.supMaskText(log, priv);
    for (const v of [...SECRETS, 'Jordan Rivera', 'jrivera', 'jordan@example.com', 'Maple Cottage', 'Springfield', 'Driveway Cam', '192.168.1.20', '10.0.0.12', 'fe80::1c2b', 'aa:bb:cc:11:22:33', 'nas.lan', 'maple-7f3a', 'cam-front', '/home/jordan', 'camuser']) assert.ok(!out.includes(v), `still in the masked text: ${v}\n${out}`);
    assert.ok(out.includes('‹home-ip›') && out.includes('‹email›') && out.includes('‹mac›') && out.includes('‹name›'));
    assert.ok(out.includes('2026-10-17T20:52:15.000Z'), 'times are not mistaken for addresses');
    assert.ok(out.includes('https://casatorch.com/docs'), 'casatorch.com itself stays');
    const keep = S.supMaskText('reached 192.168.1.20 and aa:bb:cc:11:22:33', priv, { maskIps: false });
    assert.ok(keep.includes('192.168.1.20') && !keep.includes('aa:bb:cc'), 'IPs can be kept on request; MACs never');
  });

  await t('support: the whole support file is valid JSON with no secret or name in it', async () => {
    console.warn(`support-test: token=${SECRETS[0]} for jordan@example.com from 192.168.1.77 password: ${SECRETS[3]}`);   // goes into the in-app log the file includes
    const { text, data } = await S.supportBundle({ maskIps: true });
    for (const v of [SECRETS[0], SECRETS[3], 'jordan@example.com', '192.168.1.77']) assert.ok(!text.includes(v), `support file leaks ${v}`);
    assert.ok(data.log.some((l) => l.includes('support-test')), 'the log is in it');
    assert.ok(data && data.kind === 'casatorch-support-file', 'parses back');
    for (const k of ['casatorch', 'system', 'timings', 'health', 'integrations', 'people', 'updates', 'settingsShape', 'log']) assert.ok(k in data, `has ${k}`);
    assert.ok(!/scrypt\$|BEGIN CERTIFICATE|Bearer [A-Za-z0-9]/.test(text));
    const sum = S.supportSummary(data);
    assert.match(sum, /^CasaTorch \d+\.\d+\.\d+/);
    assert.ok(sum.split('\n').length <= 7);
  });

  t('support: activity records changes by name, never values, and only when they worked', () => {
    assert.deepEqual(S.activityFor('PUT', '/api/settings', 200, { energyPrice: 0.31, lang: 'de' }), { event: 'settings-changed', detail: { fields: ['energyPrice', 'lang'] } });
    assert.equal(S.activityFor('PUT', '/api/settings', 403, { lang: 'de' }), null);
    assert.equal(S.activityFor('POST', '/API/Remote/On/', 200, {}).event, 'secure-access-on', 'case and slashes do not dodge it');
    assert.equal(S.activityFor('GET', '/api/floorplan/export', 200).event, 'floorplan-exported');
    assert.equal(S.activityFor('POST', '/api/updates', 200, { checkNow: true }), null, 'checking now is not a change');
    assert.equal(S.activityFor('DELETE', '/api/connections/hue', 200), null, 'already recorded by its own route');
    const d = S.activityFor('PUT', '/api/settings/ai', 200, { apiKey: 'sk-secret-value', model: 'x' });
    assert.ok(!JSON.stringify(d).includes('sk-secret-value'));
  });

  t('support: activity filters by kind, words, days and paging; retention keeps a year and 5,000', () => {
    const now = Date.now(), at = (d) => new Date(now - d * 86400_000).toISOString();
    const ev = [{ at: at(40), event: 'signed-in', user: 'kid' }, { at: at(10), event: 'login-failed', user: 'mallory' }, { at: at(5), event: 'settings-changed', user: 'owner1', fields: ['lang'] }, { at: at(1), event: 'phone-paired', user: 'owner1', device: 'Pixel' }];
    assert.deepEqual(S.activityFilter(ev).map((e) => e.event), ['phone-paired', 'settings-changed', 'login-failed', 'signed-in'], 'newest first');
    assert.deepEqual(S.activityFilter(ev, { kind: 'failed' }).map((e) => e.user), ['mallory']);
    assert.equal(S.activityFilter(ev, { kind: 'failed' })[0].bad, true);
    assert.deepEqual(S.activityFilter(ev, { days: 7 }).map((e) => e.event), ['phone-paired', 'settings-changed']);
    assert.deepEqual(S.activityFilter(ev, { q: 'pixel' }).map((e) => e.event), ['phone-paired']);
    assert.deepEqual(S.activityFilter(ev, { before: ev[2].at, limit: 1 }).map((e) => e.event), ['login-failed']);
    const lines = [JSON.stringify({ at: at(500), event: 'signed-in' }), 'not json', ...Array.from({ length: 5003 }, (_, i) => JSON.stringify({ at: at(1), event: 'signed-in', n: i }))];
    const kept = S.activityTrim(lines);
    assert.equal(kept.length, 5000); assert.ok(!kept.some((l) => l.includes(at(500))));
    assert.equal(JSON.parse(kept[kept.length - 1]).n, 5002, 'the newest are kept');
  });

  t('support: the getting-started checklist ticks itself off and hides when it should', () => {
    const base = { configured: true, demo: false, admin: true };
    const none = S.checklistState(base);
    assert.equal(none.show, true); assert.equal(none.done, 0); assert.equal(none.total, 7);
    assert.deepEqual(none.items.map((i) => i.id), ['ha', 'twostep', 'phone', 'alerts', 'backup', 'town', '3d']);
    const some = S.checklistState({ ...base, ha: true, town: true, backup: true });
    assert.deepEqual(some.items.filter((i) => i.done).map((i) => i.id), ['ha', 'backup', 'town']);
    assert.equal(S.checklistState(base, { seen3d: true }).items.find((i) => i.id === '3d').done, true, 'opening the 3D home counts');
    assert.equal(S.checklistState(base, { dismissed: true }).show, false);
    assert.equal(S.checklistState({ ...base, admin: false }).show, false, 'not for viewers and members');
    assert.equal(S.checklistState({ ...base, demo: true }).show, false);
    assert.equal(S.checklistState({ ...base, configured: false }).show, false);
    const all = { ...base, ha: 1, twoStep: 1, phone: 1, alerts: 1, backup: 1, town: 1, plan: 1 };
    assert.equal(S.checklistState(all, { allDoneAt: new Date().toISOString() }).show, true, 'all done: still shows "all set" for a day');
    assert.equal(S.checklistState(all, { allDoneAt: new Date(Date.now() - 2 * 86400_000).toISOString() }).show, false);
  });

  t('owner reset: asks are limited per device, with a box-wide ceiling one device cannot use up', () => {
    const ip = (n) => `192.168.77.${n}`;   // scrub-ok: documentation-style example addresses
    const r1 = [1, 2, 3, 4].map(() => S.recoverAskLimit(ip(1)));
    assert.deepEqual(r1.slice(0, 3), [null, null, null]); assert.match(r1[3], /from this device/);
    assert.equal(S.recoverAskLimit(ip(2)), null, 'another device still can ask after one device used its share');
    for (let i = 3; i < 13; i++) for (let k = 0; k < 3; k++) S.recoverAskLimit(ip(i));   // 30+ asks across many devices
    assert.match(S.recoverAskLimit(ip(50)), /today/, 'the box-wide ceiling holds');
    assert.equal(S.recoverAskLimit(ip(51), { local: true }), null, 'the owner at the box itself is never held back by the ceiling');
    assert.equal(S.recoverAskLimit(ip(52), { renew: false }), null, 'showing a waiting code again makes no new code and needs no box-wide place');
  });

  await t('activity: trimming the log rewrites it atomically (no temp file left, old lines gone)', async () => {
    const fs = await import('node:fs'), path = await import('node:path');
    const file = path.join(process.env.CASATORCH_DATA_DIR, 'audit.log'), was = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    try {
      fs.writeFileSync(file, `${JSON.stringify({ at: new Date(Date.now() - 500 * 86400_000).toISOString(), event: 'signed-in' })}\n${JSON.stringify({ at: new Date().toISOString(), event: 'signed-in', n: 1 })}\n`);
      S.activityTrimFile();
      const left = fs.readFileSync(file, 'utf8').trim().split('\n');
      assert.equal(left.length, 1); assert.equal(JSON.parse(left[0]).n, 1);
      assert.ok(!fs.readdirSync(path.dirname(file)).some((f) => f.startsWith('audit.log.') && f.endsWith('.tmp')));
      if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally { if (was == null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, was); }
  });
}
