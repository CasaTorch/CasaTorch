/* Unit tests for Settings › Alerts › Which alerts (src/server/40a-alert-types.js): the defaults, the one-time migration,
   that a type turned off is off everywhere (history, Alerts tab, inbox, phones), the new types' thresholds, and that
   only an owner or admin can change them. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import fs from 'node:fs';

export default async function alertTypesTests(t) {
  const A = globalThis.__casatorchAlertTypes, R = globalThis.__casatorchAlertRules, H = globalThis.__casatorch;

  t('alert types: every type is in a group, has a one-line description, and known alerts map to their type', () => {
    const groups = new Set(A.ALERT_GROUPS.map(([g]) => g));
    for (const x of A.ALERT_TYPES) { assert.ok(groups.has(x.group), x.id); assert.ok(x.label && x.desc && x.desc.length < 80, x.id); }
    const of = (id, extra) => A.alertTypeOf({ id, ...extra });
    assert.equal(of('leak:ha:binary_sensor.sink:2026-11-05T11:58:00.000Z'), 'leak'); assert.equal(of('cleared:smoke:x'), 'smoke');
    assert.equal(of('newdev:aa:bb:cc:dd:ee:ff'), 'newdev'); assert.equal(of('internet'), 'internet'); assert.equal(of('internet:2026-11-05T11:58:00.000Z'), 'internet'); assert.equal(of('internet:repeat'), 'internet');
    assert.equal(of('ring:c1:doorbell:1'), 'doorbell'); assert.equal(of('ring:c1:motion:1'), 'motion'); assert.equal(of('hh-app-washer'), 'appliance'); assert.equal(of('hh-bin-1'), 'household');
    assert.equal(of('camoff:ha:camera.porch'), 'camoff'); assert.equal(of('offline:ha:lock.front'), 'offline'); assert.equal(of('signin:new:x'), 'signin'); assert.equal(of('x', { source: 'sign-in' }), 'signin');
    assert.equal(of('remote:config:1'), 'signin'); assert.equal(of('disk:data'), 'disk'); assert.equal(of('something-else'), null, 'anything no type covers always shows');
    // the delivery rules know the new ids too
    assert.equal(R.alertKindOf({ id: 'dooropen:ha:cover.garage' }), 'doors'); assert.equal(R.alertKindOf({ id: 'fridge:ha:sensor.freezer' }), 'fridge');
    assert.equal(R.alertKindOf({ id: 'camoff:ha:camera.porch' }), 'offline'); assert.equal(R.alertKindOf({ id: 'disk:data' }), 'system');
    assert.equal(R.alertDeviceOf({ id: 'dooropen:ha:cover.garage' }), 'ha:cover.garage');
  });

  t('alert types: defaults - safety on, "new device on the network" and motion off, sensible thresholds', () => {
    const on = (id) => A.alertTypeCfg(id, {}).on;
    for (const id of ['leak', 'smoke', 'temp', 'dooropen', 'doorbell', 'camoff', 'offline', 'battery', 'internet', 'fridge', 'disk', 'signin']) assert.equal(on(id), true, id);
    for (const id of ['newdev', 'motion']) assert.equal(on(id), false, id);
    assert.deepEqual(A.alertTypeCfg('temp', {}), { on: true, low: 3, high: 35 });
    assert.equal(A.alertTypeCfg('battery', {}).pct, 15); assert.equal(A.alertTypeCfg('dooropen', {}).min, 15); assert.equal(A.alertTypeCfg('internet', {}).min, 5);
    assert.equal(A.alertTypeCfg('offline', {}).min, 30); assert.equal(A.alertTypeCfg('camoff', {}).min, 10); assert.equal(A.alertTypeCfg('disk', {}).pct, 10);
    assert.equal(A.alertTypeCfg('signin', { signin: { on: false } }).on, true, 'sign-in alerts can\'t be turned off');
    assert.equal(A.alertTypeCfg('battery', { battery: { pct: 999 } }).pct, 50, 'a stored number out of range is clamped');
    for (const x of A.ALERT_TYPES.filter((y) => y.safety)) assert.equal(x.on, true, `${x.id}: safety is on by default`);
  });

  t('alert types: the migration - "new device" goes off unless turned on by hand, old low-battery choice kept, done once', () => {
    assert.deepEqual(A.alertTypesMigrate({}), { v: 1, newdev: { on: false } }, 'never touched: off');
    assert.deepEqual(A.alertTypesMigrate({ security: {} }).newdev, { on: false });
    assert.deepEqual(A.alertTypesMigrate({ security: { watch: true } }).newdev, { on: true }, 'turned watching back on by hand: kept on');
    assert.deepEqual(A.alertTypesMigrate({ security: { watch: false } }).newdev, { on: false });
    const m = A.alertTypesMigrate({ sensors: { alertOn: ['leak', 'smoke'] } });
    assert.deepEqual(m.battery, { on: false }, 'low batteries were off in setup'); assert.equal(m.leak, undefined, 'safety keeps its default (on)');
    assert.equal(A.alertTypesMigrate({ sensors: { alertOn: ['leak', 'smoke', 'battery'] } }).battery, undefined);
    assert.equal(A.alertTypesMigrate({ alerts: { types: { v: 1 } } }), null, 'done already');
    assert.deepEqual(A.alertTypesMigrate({ alerts: { types: { newdev: { on: true } } } }).newdev, { on: true }, 'an explicit choice is kept');
    const after = A.alertTypesMigrate({ security: { watch: true } });
    assert.equal(A.alertTypeCfg('newdev', after).on, true); assert.equal(A.alertTypeCfg('newdev', A.alertTypesMigrate({})).on, false);
  });

  t('alert types: a change from Settings - safety needs a confirm, always-on can\'t go off, numbers stay in range', () => {
    assert.throws(() => A.alertTypePatch({}, { id: 'nope', on: true }), /Unknown/);
    assert.throws(() => A.alertTypePatch({}, { id: 'leak', on: false }), (e) => e.needsConfirm === true && /safety alert/.test(e.message));
    assert.deepEqual(A.alertTypePatch({}, { id: 'leak', on: false, confirm: true }).leak, { on: false });
    assert.throws(() => A.alertTypePatch({}, { id: 'signin', on: false }), /always on/);
    assert.deepEqual(A.alertTypePatch({ v: 1 }, { id: 'newdev', on: true }), { v: 1, newdev: { on: true } });
    assert.equal(A.alertTypePatch({}, { id: 'dooropen', nums: { min: 30 } }).dooropen.min, 30);
    assert.throws(() => A.alertTypePatch({}, { id: 'dooropen', nums: { min: 1 } }), /from 2 to 240/);
    assert.throws(() => A.alertTypePatch({}, { id: 'dooropen', nums: { nope: 3 } }), /number/);
    assert.throws(() => A.alertTypePatch({}, { id: 'battery', nums: { pct: 'x' } }), /number/);
    assert.equal(A.alertTypePatch({}, { id: 'battery', level: 'warning' }).battery.level, 'warning');
    assert.throws(() => A.alertTypePatch({}, { id: 'leak', level: 'notice' }), /how important/, 'safety has no "how important"');
    assert.throws(() => A.alertTypePatch({}, { id: 'battery', level: 'loud' }), /how important/);
  });

  t('alert types: only an owner or admin saves them (the route needs admin; members see them read-only)', () => {
    assert.equal(A.alertTypesCanEdit({ user: { role: 'member' } }, true), false);
    assert.equal(A.alertTypesCanEdit({ user: { role: 'admin' } }, true), true); assert.equal(A.alertTypesCanEdit({ user: { role: 'owner' } }, true), true);
    assert.equal(A.alertTypesCanEdit({}, true), false); assert.equal(A.alertTypesCanEdit({}, false), true, 'sign-in off: this computer');
    const src = fs.readFileSync(new URL('../src/server/40a-alert-types.js', import.meta.url), 'utf8');
    assert.match(src, /app\.put\('\/api\/alerts\/types', requireRole\('admin'\)/);
    assert.doesNotMatch(src, /\b(unlock|disarm|haCall|toggleDevice|deviceAction)\b/, 'alerts only notify: nothing here switches anything');
  });

  t('alert types: thresholds - a door or garage left open, a fridge or freezer too warm, the disk almost full, how long to wait', () => {
    const cfg = (stored = {}) => (id) => A.alertTypeCfg(id, stored);
    const garage = { id: 'ha:cover.garage', name: 'Garage door', kind: 'cover', open: true, risky: true, provider: 'ha' };
    const f = A.alertDeviceFinds(garage, cfg());
    assert.equal(f.length, 1); assert.equal(f[0].id, 'dooropen:ha:cover.garage'); assert.equal(f[0].msg, '{name} has been open for over {n} min'); assert.equal(f[0].vars.n, 15); assert.equal(f[0].severity, 'warning');
    assert.equal(A.alertDeviceFinds({ ...garage, open: false }, cfg()).length, 0);
    assert.equal(A.alertDeviceFinds(garage, cfg({ dooropen: { on: false } })).length, 0, 'off: not looked for');
    assert.equal(A.isDoorLike({ kind: 'sensor', open: true, haClass: 'door', name: 'Back door' }), true);
    assert.equal(A.isDoorLike({ kind: 'sensor', open: true, haClass: 'window', name: 'Kitchen window' }), false);
    assert.equal(A.isDoorLike({ kind: 'sensor', open: true, haClass: 'opening', name: 'Bedroom window' }), false);
    assert.equal(A.isDoorLike({ kind: 'cover', open: true, risky: false, name: 'Blinds' }), false);
    const fridge = { id: 'ha:sensor.fridge_temp', name: 'Kitchen fridge', kind: 'sensor', tempC: 9 }, freezer = { id: 'ha:sensor.freezer', name: 'Garage freezer', kind: 'sensor', tempC: -15 };
    assert.equal(A.alertDeviceFinds(fridge, cfg())[0].id, 'fridge:ha:sensor.fridge_temp', 'fridge above 8 °C');
    assert.equal(A.alertDeviceFinds({ ...fridge, tempC: 4 }, cfg()).length, 0);
    assert.equal(A.alertDeviceFinds(freezer, cfg()).length, 0, 'a freezer at -15 °C is fine');
    assert.equal(A.alertDeviceFinds({ ...freezer, tempC: -8 }, cfg()).length, 1, 'a freezer at -8 °C is too warm');
    assert.equal(A.alertDeviceFinds({ ...freezer, tempC: -8 }, cfg({ fridge: { freezer: -5 } })).length, 0, 'its own limit');
    assert.equal(A.isFridge({ name: 'Living room' }), false);
    assert.equal(A.alertDiskFind({ blocks: 1000, bavail: 50 }, 10).id, 'disk:data'); assert.equal(A.alertDiskFind({ blocks: 1000, bavail: 50 }, 10).vars.n, 5);
    assert.equal(A.alertDiskFind({ blocks: 1000, bavail: 200 }, 10), null); assert.equal(A.alertDiskFind(null, 10), null);
    assert.equal(A.alertHoldMin('dooropen:x'), 15); assert.equal(A.alertHoldMin('internet'), 5); assert.equal(A.alertHoldMin('offline:x'), 30); assert.equal(A.alertHoldMin('camoff:x'), 10); assert.equal(A.alertHoldMin('fridge:x'), 30);
    assert.equal(A.alertHoldMin('leak:x'), 0, 'water never waits'); assert.equal(A.alertHoldMin('smoke:x'), 0);
    assert.equal(A.alertTypeLevel({ id: 'battery:x', severity: 'notice' }, { battery: { level: 'warning' } }).severity, 'warning', '"how important"');
    assert.equal(A.alertTypeLevel({ id: 'cleared:battery:x', severity: 'ok' }, { battery: { level: 'warning' } }).severity, 'ok');
    assert.equal(A.alertTypeLevel({ id: 'leak:x', severity: 'critical' }, {}).severity, 'critical');
  });

  t('alert types: a type turned off is not kept and never pushed (alertRaise)', () => {
    const E = H.alerts, n0 = E.events.length;
    A.alertRaise({ id: `newdev:aa:bb:cc:00:00:01:${Date.now()}`, severity: 'notice', title: 'New device on your network: 192.0.2.7', source: 'network' });   // off by default
    assert.equal(E.events.length, n0, 'off: not in the history');
    assert.equal(A.alertTypeAllows({ id: 'newdev:x' }), false); assert.equal(A.alertTypeAllows({ id: 'newdev:x' }, { newdev: { on: true } }), true);
    assert.equal(A.alertTypeAllows({ id: 'leak:x' }, { leak: { on: false } }), false, 'a safety alert turned off with the confirm');
  });

  const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
  const B = `http://127.0.0.1:${srv.address().port}`;
  try {
    await t('alert types: off everywhere - the Alerts tab (and its count), the history and the inbox', async () => {
      const E = H.alerts, keepE = E.events, keepO = E.open, at = new Date().toISOString();
      E.events = [{ id: `newdev:aa:${at}`, at, title: 'New device on your network: Phone', severity: 'notice', source: 'network' }, { id: `battery:ha:sensor.door:${at}`, at, title: 'Low battery (9%): Door', severity: 'notice', source: 'ha' }, ...keepE];
      E.open = { 'newdev:aa': { id: 'newdev:aa', title: 'New device on your network: Phone', severity: 'notice', since: at }, 'battery:ha:sensor.door': { id: 'battery:ha:sensor.door', title: 'Low battery (9%): Door', severity: 'notice', since: at } };
      try {
        const a = await (await fetch(`${B}/api/alerts`)).json();
        assert.deepEqual(a.now.map((x) => x.id), ['battery:ha:sensor.door'], 'the tab\'s count is now.length: 1');
        assert.ok(!a.recent.some((x) => x.id.startsWith('newdev:'))); assert.ok(a.recent.some((x) => x.id.startsWith('battery:')));
        const i = await (await fetch(`${B}/api/inbox`)).json();
        assert.ok(!i.items.some((x) => x.id.startsWith('newdev:'))); assert.ok(i.items.some((x) => x.id.startsWith('battery:')));
        const v = await (await fetch(`${B}/api/alerts/types`)).json();
        assert.equal(v.types.find((x) => x.id === 'newdev').on, false); assert.equal(v.types.find((x) => x.id === 'leak').safety, true);
        assert.deepEqual(v.groups.map((g) => g.id), ['safety', 'security', 'devices', 'network', 'home', 'system']);
      } finally { E.events = keepE; E.open = keepO; }
    });
  } finally { srv.close(); }

  t('alert types: every word on the page is translated in all 13 languages (tools/i18n-strings.tsv)', () => {
    const rows = new Map(fs.readFileSync(new URL('../../tools/i18n-strings.tsv', import.meta.url), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => { const c = l.split('\t'); return [c[0], c]; }));
    const texts = new Set(['Which alerts', 'How they reach you', 'Fine-tune', 'How important', 'Urgent', 'Important', 'Info', 'Always on', 'Safety', '% free', 'min', 'Phones, sounds and repeats',
      'Turn each alert on or off. Changes save right away.', 'Only an owner or admin can change these.', '{name} is a safety alert. Turn it off? You could miss a leak, smoke or a freezing pipe.',
      '{name} has been open for over {n} min', '{name} is too warm', 'The disk is almost full ({n}% free)', 'Doors & garage left open', 'Fridge & freezer']);
    for (const [, l] of A.ALERT_GROUPS) texts.add(l);
    for (const x of A.ALERT_TYPES) { texts.add(x.label); texts.add(x.desc); for (const n of x.nums || []) texts.add(n.label); }
    for (const x of texts) { const r = rows.get(x); assert.ok(r, `not in i18n-strings.tsv: ${x}`); assert.equal(r.length, 14, x); assert.ok(r.every(Boolean), x); }
  });
}
