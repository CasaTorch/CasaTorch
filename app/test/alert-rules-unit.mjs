/* Unit tests for the alert rules (src/server/40r-alert-rules.js): the one decision that says, for each alert and each
   phone, whether it shows in the app, is pushed, with which sound, repeats, waits for the daily summary, and what wall
   panels do. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';

export default async function alertRuleTests(t) {
  const R = globalThis.__casatorchAlertRules;
  const phone = (level = 'important', id = 'w:aaaaaa', user = 'u1') => ({ id, level, user });
  const house = (x = {}) => ({ kinds: {}, rooms: {}, devices: {}, quietHours: '22-7', quietBreak: true, legacy: { awayOnly: false, repeat: true }, ...x });
  const leak = { id: 'leak:ha:binary_sensor.sink', severity: 'critical', title: 'Water detected: Sink' };
  const bell = { id: 'ring:cam1:doorbell:1700000000', severity: 'notice', title: 'Someone at the Front door' };
  const batt = { id: 'battery:ha:sensor.door', severity: 'notice', title: 'Low battery (9%): Door' };
  const offl = { id: 'offline:ha:camera.porch', severity: 'warning', title: 'Porch is not responding' };
  const net = { id: 'internet', severity: 'critical', title: 'The internet is down' };
  const at = (hour, minute = 0) => ({ hour, minute });
  const D = (a, ctx) => R.alertDecide(a, { rules: house(), user: {}, pro: true, now: 1e12, home: null, ...ctx });

  t('alert rules: every alert has a kind and a tier', () => {
    assert.equal(R.alertKindOf(leak), 'water'); assert.equal(R.alertKindOf({ id: 'smoke:x' }), 'smoke'); assert.equal(R.alertKindOf(bell), 'doorbell');
    assert.equal(R.alertKindOf({ id: 'ring:c:motion:1' }), 'motion'); assert.equal(R.alertKindOf(batt), 'battery'); assert.equal(R.alertKindOf(offl), 'offline');
    assert.equal(R.alertKindOf(net), 'network'); assert.equal(R.alertKindOf({ id: 'apptest:x' }), 'network'); assert.equal(R.alertKindOf({ id: 'health:2026' }), 'system');
    assert.equal(R.alertKindOf({ id: 'newdev:aa' }), 'security'); assert.equal(R.alertKindOf({ id: 'x', source: 'sign-in' }), 'security'); assert.equal(R.alertKindOf({ id: 'rainopen:w' }), 'weather');
    assert.equal(R.alertKindOf({ id: 'cleared:leak:x' }), 'water'); assert.equal(R.alertKindOf({ id: 'something' }), 'other'); assert.equal(R.alertKindOf({ kind: 'report', id: 'report:1' }), 'system');
    assert.deepEqual(['critical', 'warning', 'event', 'notice', 'info', 'ok'].map(R.alertTier), ['critical', 'important', 'important', 'info', 'info', null]);
    assert.equal(R.alertDeviceOf({ id: 'leak:ha:binary_sensor.sink:2026-10-18T07:00:00.000Z' }), 'ha:binary_sensor.sink');
    assert.equal(R.alertDeviceOf(bell), 'ring:cam1'); assert.equal(R.alertDeviceOf(net), null); assert.equal(R.alertDeviceOf({ id: 'offline:more' }), null);
    assert.equal(R.alertBaseId('leak:x:2026-10-18T07:00:00.000Z'), 'leak:x'); assert.equal(R.alertBaseId('internet:repeat'), 'internet');
  });

  t('alert rules: nobody changed anything -> exactly the old behavior (phone levels, quiet hours, critical repeats)', () => {
    assert.equal(D(offl, { target: phone('important'), ...at(12) }).push, true);
    assert.equal(D(batt, { target: phone('important'), ...at(12) }).push, false, 'low battery only with "Everything"');
    assert.equal(D(batt, { target: phone('all'), ...at(12) }).push, true);
    assert.equal(D(offl, { target: phone('critical'), ...at(12) }).push, false);
    assert.equal(D(bell, { target: phone('important'), ...at(12) }).push, true, 'a doorbell press counts as important');
    assert.equal(D(offl, { target: phone('important'), ...at(23) }).push, false, 'quiet hours hold back non-critical');
    assert.equal(D(net, { target: phone('important'), ...at(23) }).push, true, 'critical breaks through');
    assert.equal(D(net, {}).repeat, 10); assert.equal(D(net, { pro: false }).repeat, 0, 'non-safety repeats are Pro');
    assert.equal(D(leak, { pro: false }).repeat, 10, 'safety repeats on Basic');
    assert.equal(D(net, { rules: house({ legacy: { repeat: false } }) }).repeat, 0, 'the old "repeat" switch off');
    assert.equal(D(offl, {}).sound, 'normal'); assert.equal(D(net, {}).sound, 'urgent');
    for (const a of [leak, bell, batt, offl, net]) assert.equal(D(a, {}).app, true);
  });

  t('alert rules: quiet hours across midnight, custom times, per-person quiet hours', () => {
    assert.equal(R.quietIn('22-7', 22), true); assert.equal(R.quietIn('22-7', 0), true); assert.equal(R.quietIn('22-7', 6, 59), true); assert.equal(R.quietIn('22-7', 7), false); assert.equal(R.quietIn('22-7', 21, 59), false);
    assert.equal(R.quietIn('22:30-06:15', 22, 29), false); assert.equal(R.quietIn('22:30-06:15', 22, 30), true); assert.equal(R.quietIn('22:30-06:15', 6, 14), true); assert.equal(R.quietIn('22:30-06:15', 6, 15), false);
    assert.equal(R.quietIn('13-15', 14), true); assert.equal(R.quietIn('13-15', 16), false, 'same-day window');
    assert.equal(R.quietIn('none', 23), false); assert.equal(R.quietIn('7-7', 7), false, 'an empty window is never quiet');
    assert.equal(R.quietOk('21:15-06:45'), true); assert.equal(R.quietOk('25-3'), false); assert.equal(R.quietOk('none'), true);
    const mine = { quietHours: '20-9' };
    assert.equal(D(offl, { target: phone(), user: mine, ...at(8) }).push, false, 'my own quiet hours');
    assert.equal(D(offl, { target: phone(), user: { quietHours: 'none' }, ...at(23) }).push, true, 'no quiet hours for me');
    assert.equal(D(net, { target: phone(), user: { quietBreak: false }, ...at(23) }).push, false, 'I said critical must not break through');
    assert.equal(D(leak, { target: phone(), user: { quietBreak: false }, ...at(23) }).push, true, 'safety always breaks through');
    assert.equal(D(offl, { target: phone(), rules: house({ kinds: { offline: { quiet: 'ignore' } } }), ...at(23) }).push, true, 'a kind can ignore quiet hours');
  });

  t('alert rules: only when away / home (Pro, never for safety, sends when it can\'t tell)', () => {
    const away = house({ kinds: { doorbell: { presence: 'away' } } });
    assert.equal(D(bell, { rules: away, target: phone(), home: true, ...at(12) }).push, false);
    assert.equal(D(bell, { rules: away, target: phone(), home: false, ...at(12) }).push, true);
    assert.equal(D(bell, { rules: away, target: phone(), home: null, ...at(12) }).push, true, 'can\'t tell: send');
    assert.equal(D(bell, { rules: away, target: phone(), home: true, pro: false, ...at(12) }).push, true, 'presence is Smart alerts (Pro)');
    assert.equal(D(bell, { rules: house({ legacy: { awayOnly: true, repeat: true } }), target: phone(), home: true, ...at(12) }).push, false, 'the old "only when nobody\'s home" switch carries over');
    assert.equal(D(offl, { rules: house({ kinds: { offline: { presence: 'home' } } }), target: phone(), home: false, ...at(12) }).push, false);
    assert.equal(D(leak, { rules: house({ kinds: { water: { presence: 'away' } } }), target: phone(), home: true, ...at(12) }).push, true, 'safety ignores presence');
  });

  t('alert rules: per-device and per-room overrides, per-person layers, which phones', () => {
    const r = house({ kinds: { battery: { push: true } }, devices: { 'ha:sensor.door': { push: false } } });
    assert.equal(D(batt, { rules: r, target: phone(), ...at(12) }).push, false, 'the device rule beats the kind rule');
    assert.equal(D({ ...batt, id: 'battery:ha:sensor.other' }, { rules: r, target: phone(), ...at(12) }).push, true);
    assert.equal(D(batt, { rules: r, user: { devices: { 'ha:sensor.door': { push: true } } }, target: phone(), ...at(12) }).push, true, 'my rule beats the household');
    const room = house({ rooms: { Garage: { app: false } } });
    assert.equal(D(offl, { rules: room, device: { id: 'ha:camera.porch', room: 'Garage' } }).app, false);
    assert.equal(D(offl, { rules: room, device: { id: 'ha:camera.porch', room: 'Kitchen' } }).app, true);
    assert.equal(D(offl, { rules: room, device: { id: 'ha:camera.porch', room: 'Garage' } }).panel, 'off', 'not in the app: not on panels');
    const only = house({ kinds: { offline: { phones: ['w:bbbbbb'] } } });
    assert.equal(D(offl, { rules: only, target: phone('important', 'w:aaaaaa'), ...at(12) }).push, false);
    assert.equal(D(offl, { rules: only, target: phone('important', 'w:bbbbbb'), ...at(12) }).push, true);
    assert.equal(D(offl, { user: { kinds: { offline: { sound: 'silent' } } }, target: phone(), ...at(12) }).sound, 'silent');
    assert.equal(D(offl, { rules: house({ kinds: { offline: { panel: 'announce' } } }) }).panel, 'announce');
  });

  t('alert rules: the safety floor - water, smoke and freezing can\'t be silenced without a confirm', () => {
    const off = house({ kinds: { water: { push: false, app: false, panel: 'off', sound: 'silent', digest: true } } });
    const d = D(leak, { rules: off, target: phone(), ...at(3) });
    assert.equal(d.app, true); assert.equal(d.panel, 'show'); assert.equal(d.push, true); assert.equal(d.sound, 'urgent'); assert.equal(d.digest, false); assert.ok(d.why.includes('safety-floor'));
    const confirmed = house({ kinds: { water: { push: false, confirmOff: true } } });
    assert.equal(D(leak, { rules: confirmed, target: phone(), ...at(12) }).push, false, 'turned off with the confirm');
    assert.equal(D(leak, { rules: confirmed }).app, true, 'still in the app');
    assert.throws(() => R.cleanRule({ push: false }, { safety: true }), (e) => e.needsConfirm === true);
    assert.deepEqual(R.cleanRule({ push: false, confirm: true }, { safety: true }), { push: false, confirmOff: true });
    assert.throws(() => R.cleanRule({ app: false }, { safety: true }), /always show/);
    assert.throws(() => R.cleanRule({ presence: 'away' }, { pro: false }), /Pro/);
    assert.deepEqual(R.cleanRule({ push: true, repeat: 15, sound: 'loud', evil: 1, phones: ['w:abcdef', 'x'] }), { push: true, repeat: 15, phones: ['w:abcdef'] });
    const mute = [{ scope: 'house', device: 'ha:binary_sensor.sink', until: 2e12 }];
    assert.equal(D(leak, { mutes: mute, target: phone(), ...at(12) }).push, true, 'a mute without the confirm doesn\'t silence safety');
    assert.equal(D(leak, { mutes: [{ ...mute[0], confirmed: true }], target: phone(), ...at(12) }).push, false);
  });

  t('alert rules: snooze, mutes (mine vs everyone), repeats, tests, daily summary', () => {
    assert.equal(D(offl, { snoozedUntil: 2e12, target: phone(), ...at(12) }).push, false);
    assert.equal(D(offl, { snoozedUntil: 1, target: phone(), ...at(12) }).push, true, 'an old snooze is over');
    const mineMute = [{ scope: 'u1', kind: 'offline', until: 2e12 }];
    assert.equal(D(offl, { mutes: mineMute, target: phone('important', 'w:aaaaaa', 'u1'), ...at(12) }).push, false);
    assert.equal(D(offl, { mutes: mineMute, target: phone('important', 'w:cccccc', 'u2'), ...at(12) }).push, true, 'my mute is only mine');
    assert.equal(D(offl, { mutes: [{ scope: 'u1', kind: 'offline', until: 5 }], target: phone(), ...at(12) }).push, true, 'expired');
    assert.equal(D(offl, { mutes: mineMute, isTest: true, target: phone(), ...at(12) }).push, true, 'a test goes through mutes');
    assert.equal(D(net, { isRepeat: true, user: { kinds: { network: { repeat: 0 } } }, target: phone(), ...at(12) }).push, false, 'no reminders for me');
    assert.equal(D(offl, { rules: house({ kinds: { offline: { repeat: 15 } } }) }).repeat, 15);
    const dig = house({ kinds: { battery: { digest: true, push: true } } });
    const d = D(batt, { rules: dig, target: phone(), ...at(12) }); assert.equal(d.push, false); assert.equal(d.digest, true);
    assert.equal(D({ id: 'cleared:leak:x', severity: 'ok' }, { target: phone('all') }).push, false, '"Cleared" is never pushed');
  });

  t('alert rules: flap damping - an alert toggling quickly becomes one', () => {
    const W = R.FLAP_WINDOW_MS; let st = null, r;
    r = R.flapStep(st, 'raise', 0); assert.equal(r.action, 'push'); st = r.st;
    r = R.flapStep(st, 'clear', 60_000); assert.equal(r.action, 'clear'); st = r.st;
    r = R.flapStep(st, 'raise', 120_000); assert.equal(r.action, 'note', 'back within minutes: one history line, no push'); st = r.st;
    r = R.flapStep(st, 'clear', 180_000); assert.equal(r.action, 'hold', '"Cleared" waits'); st = r.st;
    r = R.flapStep(st, 'raise', 240_000); assert.equal(r.action, 'silent'); st = r.st;
    r = R.flapStep(st, 'clear', 300_000); assert.equal(r.action, 'hold'); st = r.st;
    r = R.flapStep(st, 'tick', 300_000 + W - 1); assert.equal(r.action, 'none');
    r = R.flapStep(st, 'tick', 300_000 + W); assert.equal(r.action, 'clear', 'stayed cleared: now it says so'); assert.equal(r.st, null);
    r = R.flapStep({ lastClear: 0 }, 'raise', W + 1); assert.equal(r.action, 'push', 'back much later: a new alert');
    r = R.flapStep({ lastClear: 0 }, 'raise', 1000, true); assert.equal(r.action, 'push', 'water and smoke always go out');
  });
}
