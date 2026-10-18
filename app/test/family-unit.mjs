/* Unit tests for the Family hub (src/server/79c-family.js and the pure part of src/client/38-family.js): chore repeats and
   stars, the weekly reset, meal-week copying, Home Assistant to-do lists over a pretend websocket, your own weather station,
   the status chips, and the "Show only when..." rules for Home widgets. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function familyTests(t) {
  const F = globalThis.__casatorchFamily;
  // 2026-10-18 is a Sunday.
  const chore = (x) => ({ id: 'c1', title: 'Feed the cat', icon: 'paw', stars: 2, repeat: 'daily', who: ['kid'], ...x });

  t('family: repeats - every day, chosen weekdays, once a week', () => {
    assert.equal(F.famDueOn(chore(), '2026-10-20'), true);
    const mwf = chore({ repeat: 'days', days: [1, 3, 5] });
    assert.deepEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24'].map((d) => F.famDueOn(mwf, d)), [false, true, false, true, true, false]);
    assert.equal(F.famDueOn(chore({ repeat: 'weekly' }), '2026-10-22'), true, 'a weekly chore is on the list every day until done');
    assert.equal(F.famDueOn(chore({ repeat: 'days', days: [] }), '2026-10-19'), false);
  });
  t('family: the week starts on Sunday or Monday', () => {
    assert.equal(F.famWeekOf('2026-10-21', 0), '2026-10-18');
    assert.equal(F.famWeekOf('2026-10-18', 0), '2026-10-18');
    assert.equal(F.famWeekOf('2026-10-18', 1), '2026-10-12');
    assert.equal(F.famWeekOf('2026-10-19', 1), '2026-10-19');
    assert.equal(F.famWeekOf('2026-11-03', 0), '2026-11-01', 'across the daylight-saving change');
  });
  t('family: a weekly chore done on Tuesday stays done all week, and comes back next week', () => {
    const c = chore({ repeat: 'weekly' });
    const done = F.famMark({}, c, 'kid', '2026-10-20', true, null, '2026-10-20T16:00:00Z');
    assert.equal(!!F.famDoneRec(c, 'kid', '2026-10-24', done, 0), true);
    assert.equal(!!F.famDoneRec(c, 'kid', '2026-10-19', done, 0), false, 'not before it was done');
    assert.equal(!!F.famDoneRec(c, 'kid', '2026-10-25', done, 0), false, 'a new week');
    const undone = F.famMark(done, c, 'kid', '2026-10-23', false, null, 'x', 0);
    assert.equal(!!F.famDoneRec(c, 'kid', '2026-10-24', undone, 0), false, 'undone from a later day');
  });
  t('family: each person does their own; "anyone" is one shared check that credits whoever did it', () => {
    const both = chore({ who: ['mia', 'leo'] }), shared = chore({ id: 'c2', who: [] });
    let done = F.famMark({}, both, 'mia', '2026-10-19', true);
    done = F.famMark(done, shared, '*', '2026-10-19', true, 'leo');
    const today = F.famChoresOn([both, shared], '2026-10-19', done, 0);
    assert.deepEqual(today.find((c) => c.id === 'c1').slots.map((s) => [s.person, s.done]), [['mia', true], ['leo', false]]);
    assert.deepEqual(today.find((c) => c.id === 'c2').slots.map((s) => [s.person, s.done, s.by]), [['*', true, 'leo']]);
  });
  t('family: stars this week, last week, and the weekly reset', () => {
    const c = chore({ stars: 2 }), d3 = chore({ id: 'c3', stars: 3, who: ['kid'] });
    let done = {};
    done = F.famMark(done, c, 'kid', '2026-10-16', true);    // last week (Friday)
    done = F.famMark(done, c, 'kid', '2026-10-18', true);    // this week (Sunday)
    done = F.famMark(done, d3, 'kid', '2026-10-20', true);
    const s = F.famStars(done, '2026-10-21', 0);
    assert.equal(s.since, '2026-10-18'); assert.deepEqual(s.week, { kid: 5 }); assert.deepEqual(s.lastWeek, { kid: 2 });
    assert.deepEqual(F.famStars(done, '2026-10-25', 0).week, {}, 'next Sunday it starts from zero');
    const changed = F.famChoresOn([{ ...c, stars: 5 }], '2026-10-21', done, 0); assert.ok(changed);
    assert.deepEqual(F.famStars(done, '2026-10-21', 0).week, { kid: 5 }, 'changing a chore\'s stars later doesn\'t rewrite what was earned');
  });
  t('family: old days are let go after 70 days', () => {
    let done = F.famMark({}, chore(), 'kid', '2026-07-01', true);
    done = F.famMark(done, chore(), 'kid', '2026-10-19', true);
    assert.deepEqual(Object.keys(done), ['2026-10-19']);
  });
  t('family: chore settings are checked', () => {
    const was = F.fam.d.people; F.fam.d.people = [{ id: 'aaaaaaaaaa', name: 'Mia' }];
    try {
      const c = F.famCleanChore({ title: '  Brush teeth ', icon: '<img>', stars: 9, repeat: 'days', days: [5, 1, 1, 9], who: ['aaaaaaaaaa', 'nobody'], routine: 'morning' });
      assert.equal(c.title, 'Brush teeth'); assert.equal(c.icon, 'star'); assert.equal(c.stars, 5); assert.deepEqual(c.days, [1, 5]); assert.deepEqual(c.who, ['aaaaaaaaaa']); assert.equal(c.routine, 'morning');
      assert.throws(() => F.famCleanChore({ title: '' }), /name/);
      assert.throws(() => F.famCleanChore({ title: 'x', repeat: 'days', days: [] }), /day/);
    } finally { F.fam.d.people = was; }
  });
  t('family: copy last week\'s meals (empty days last week leave this week alone)', () => {
    const meals = { '2026-10-11': { title: 'Tacos' }, '2026-10-13': { title: 'Soup', url: 'https://example.com/soup' }, '2026-10-20': { title: 'Already planned' }, '2026-10-21': { title: 'Keep me' } };
    const out = F.famCopyWeek(meals, '2026-10-18');
    assert.equal(out['2026-10-18'].title, 'Tacos'); assert.equal(out['2026-10-20'].title, 'Soup'); assert.equal(out['2026-10-21'].title, 'Keep me'); assert.equal(out['2026-10-19'], undefined);
    assert.equal(F.famUrl('javascript:alert(1)'), null); assert.equal(F.famUrl('https://example.com/a'), 'https://example.com/a');
  });

  /* ---- Home Assistant to-do lists ---- */
  t('family: Home Assistant to-do messages', () => {
    assert.deepEqual(F.famTodoCmd('list', 'todo.shopping_list'), { type: 'call_service', domain: 'todo', service: 'get_items', target: { entity_id: 'todo.shopping_list' }, service_data: { status: ['needs_action', 'completed'] }, return_response: true });
    assert.deepEqual(F.famTodoCmd('add', 'todo.s', { text: 'Milk' }).service_data, { item: 'Milk' });
    assert.deepEqual(F.famTodoCmd('update', 'todo.s', { id: 'u1', done: true }).service_data, { item: 'u1', status: 'completed' });
    assert.deepEqual(F.famTodoCmd('update', 'todo.s', { id: 'u1', text: 'Oat milk', done: false }).service_data, { item: 'u1', rename: 'Oat milk', status: 'needs_action' });
    assert.deepEqual(F.famTodoCmd('remove', 'todo.s', { id: 'u1' }).service_data, { item: ['u1'] });
    assert.equal(F.famTodoCmd('clear', 'todo.s').service, 'remove_completed_items');
    assert.throws(() => F.famTodoCmd('drop', 'todo.s'));
  });
  t('family: Home Assistant\'s items become ours (uid, done, due; items with no uid use their name)', () => {
    const r = { response: { 'todo.s': { items: [{ uid: 'a1', summary: 'Milk', status: 'needs_action' }, { summary: 'Bread', status: 'completed', due: '2026-10-20', description: 'whole grain' }, { uid: 'x' }] } } };
    assert.deepEqual(F.famTodoFromHa(r, 'todo.s'), [{ id: 'a1', text: 'Milk', done: false, due: null, note: null }, { id: 'Bread', text: 'Bread', done: true, due: '2026-10-20', note: 'whole grain' }]);
    assert.deepEqual(F.famTodoFromHa({}, 'todo.s'), []);
  });
  /* A pretend Home Assistant websocket: it asks for the token, then answers each call_service. */
  const fakeWs = (answer, { badToken = false } = {}) => {
    const seen = [];
    class FakeWS {
      constructor(url) { this.url = url; this.l = {}; seen.push({ url }); setTimeout(() => this.emit('message', { type: 'auth_required' }), 1); }
      addEventListener(k, f) { (this.l[k] ||= []).push(f); }
      emit(k, msg) { for (const f of this.l[k] || []) f({ data: JSON.stringify(msg) }); }
      send(s) {
        const m = JSON.parse(s); seen.push(m);
        if (m.type === 'auth') return setTimeout(() => this.emit('message', badToken || m.access_token !== 'tok' ? { type: 'auth_invalid' } : { type: 'auth_ok' }), 1);
        setTimeout(() => this.emit('message', { id: m.id, type: 'result', ...answer(m) }), 1);
      }
      close() { this.closed = true; }
    }
    return { FakeWS, seen };
  };
  await t('family: over the websocket - signs in, sends every step, reads the answers in order', async () => {
    const { FakeWS, seen } = fakeWs((m) => (m.service === 'get_items' ? { success: true, result: { response: { 'todo.s': { items: [{ uid: '1', summary: 'Eggs', status: 'needs_action' }] } } } } : { success: true, result: null }));
    const [list, add] = await F.famHaWs([F.famTodoCmd('list', 'todo.s'), F.famTodoCmd('add', 'todo.s', { text: 'Milk' })], { url: 'http://192.168.1.20:8123/', token: 'tok', WS: FakeWS });
    assert.equal(seen[0].url, 'ws://192.168.1.20:8123/api/websocket');
    assert.deepEqual(seen[1], { type: 'auth', access_token: 'tok' });
    assert.deepEqual(seen.slice(2).map((m) => [m.id, m.service]), [[1, 'get_items'], [2, 'add_item']]);
    assert.equal(list.ok, true); assert.deepEqual(F.famTodoFromHa(list.result, 'todo.s').map((x) => x.text), ['Eggs']); assert.equal(add.ok, true);
  });
  await t('family: over the websocket - a refused step and a wrong token are errors, not hangs', async () => {
    const { FakeWS } = fakeWs(() => ({ success: false, error: { code: 'not_found', message: 'Unable to find to-do list item' } }));
    const [r] = await F.famHaWs([F.famTodoCmd('remove', 'todo.s', { id: 'gone' })], { url: 'https://ha.example.com', token: 'tok', WS: FakeWS });
    assert.deepEqual(r, { ok: false, error: 'Unable to find to-do list item' });
    const bad = fakeWs(() => ({ success: true }), { badToken: true });
    await assert.rejects(F.famHaWs([F.famTodoCmd('clear', 'todo.s')], { url: 'https://ha.example.com', token: 'nope', WS: bad.FakeWS }), /token/);
    class Silent { constructor() { this.l = {}; } addEventListener() {} send() {} close() {} }
    await assert.rejects(F.famHaWs([F.famTodoCmd('clear', 'todo.s')], { url: 'https://ha.example.com', token: 'tok', WS: Silent, timeout: 30 }), /did not answer/);
    await assert.rejects(F.famHaWs([], { url: '', token: '' }), /not connected/);
  });
  t('family: Home Assistant to-do lists are devices now (how many are left), not skipped', () => {
    const d = globalThis.__casatorch.haDevice({ entity_id: 'todo.shopping_list', state: '3', attributes: { friendly_name: 'Shopping List' } });
    assert.equal(d.kind, 'value'); assert.equal(d.value, '3'); assert.equal(d.list, true); assert.equal(d.name, 'Shopping List');
  });

  /* ---- your own weather station ---- */
  t('family: rain from a binary sensor or a rain rate', () => {
    assert.deepEqual(F.famRainOf({ kind: 'sensor', water: true }), { wet: true, mm: null });
    assert.deepEqual(F.famRainOf({ kind: 'sensor', on: false }), { wet: false, mm: null });
    assert.deepEqual(F.famRainOf({ kind: 'value', value: '0.2', unit: 'in/h' }), { wet: true, mm: 5.1 });
    assert.deepEqual(F.famRainOf({ kind: 'value', value: '0', unit: 'mm/h' }), { wet: false, mm: 0 });
    assert.equal(F.famRainOf({ kind: 'value', value: 'unknown' }), null); assert.equal(F.famRainOf({ online: false, water: true }), null);
  });
  t('family: the outdoor sensor replaces the forecast\'s "now" (and the cached forecast is untouched)', () => {
    const view = { now: { temp: 59, symbol: 'partlycloudy_day', words: 'Partly cloudy', rainMm: 0 }, days: [] };
    const out = F.famApplyOutside(view, { name: 'Patio', tempC: 20, online: true }, { name: 'Rain gauge', kind: 'value', value: '1.2', unit: 'mm/h' });
    assert.equal(out.now.temp, 68); assert.equal(out.now.raining, true); assert.equal(out.now.rainMm, 1.2); assert.equal(out.now.symbol, 'rain'); assert.equal(out.now.words, 'Rain'); assert.equal(out.now.station, 'Patio · Rain gauge');
    assert.equal(view.now.temp, 59, 'the forecast object itself is not changed');
    const dry = F.famApplyOutside({ now: { temp: 50, symbol: 'lightrain', words: 'Light rain', rainMm: 0.4 } }, null, { name: 'Rain', kind: 'sensor', on: false });
    assert.equal(dry.now.words, 'Cloudy'); assert.equal(dry.now.rainMm, 0); assert.equal(dry.now.temp, 50);
    assert.equal(F.famApplyOutside(view, { name: 'Gone', tempC: null }, null), view, 'nothing to use: the forecast as it was');
  });

  /* ---- status chips ---- */
  t('family: status chips - counts only when there is something, devices, outside', () => {
    const devs = [{ id: 'l1', kind: 'light', on: true, name: 'A' }, { id: 'l2', kind: 'light', on: true, name: 'B' }, { id: 'l3', kind: 'light', on: false, name: 'C' },
      { id: 'ha:cover.garage', kind: 'cover', risky: true, open: true, name: 'Garage' }, { id: 'w1', kind: 'sensor', haClass: 'window', open: false, name: 'Office window' },
      { id: 'ha:person.a', domain: 'person', kind: 'presence', home: false, name: 'Ann' }, { id: 'k1', kind: 'lock', locked: true, name: 'Front door lock' }];
    const chips = F.famChipsOf([{ kind: 'count', what: 'lights' }, { kind: 'count', what: 'windows' }, { kind: 'device', id: 'ha:cover.garage', when: 'active' }, { kind: 'device', id: 'k1', when: 'active' }, { kind: 'count', what: 'people' }, { kind: 'outside' }], devs, { now: { temp: 18 } });
    assert.deepEqual(chips.map((c) => c.text), ['2 lights on', 'Garage open', 'Nobody home', '18° outside']);
    assert.equal(chips[1].tone, 'warn'); assert.equal(chips[0].msg, '{n} lights on');
    assert.equal(F.famCleanChip({ kind: 'count', what: 'everything' }), null); assert.equal(F.famCleanChip({ kind: 'device', id: 'javascript:x y' }), null);
  });

  /* ---- "Show only when..." (the pure part of the client file, run here as it is in the browser) ---- */
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client', '38-family.js'), 'utf8');
  const pure = src.slice(src.indexOf('/* pure:start */'), src.indexOf('/* pure:end */'));
  const C = new Function(`${pure}; return { famRuleOk, famCondOk, famTimeIn, famDevState, famDevNum, famStatesFor };`)();
  const devices = [{ id: 'ha:cover.garage', kind: 'cover', open: true }, { id: 'ha:person.mia', domain: 'person', kind: 'presence', home: true }, { id: 'ha:person.leo', domain: 'person', kind: 'presence', home: false },
    { id: 'ha:sensor.patio', kind: 'sensor', tempC: 25 }, { id: 'ha:light.k', kind: 'light', on: false }, { id: 'ha:lock.front', kind: 'lock', locked: false }, { id: 'ha:todo.shop', kind: 'value', value: '3', unit: 'to do' }];
  const env = (x) => ({ devices, hhmm: '07:30', dow: 1, units: 'F', ...x });
  t('show only when: time ranges, also past midnight', () => {
    assert.equal(C.famTimeIn('07:30', '07:00', '09:00'), true); assert.equal(C.famTimeIn('09:00', '07:00', '09:00'), false);
    assert.equal(C.famTimeIn('23:10', '22:00', '06:30'), true); assert.equal(C.famTimeIn('03:00', '22:00', '06:30'), true); assert.equal(C.famTimeIn('12:00', '22:00', '06:30'), false);
    assert.equal(C.famTimeIn('12:00', '', '06:30'), true, 'half-filled: shown');
  });
  t('show only when: device states in plain words, numbers in the home\'s units', () => {
    assert.equal(C.famDevState(devices[0]), 'open'); assert.equal(C.famDevState(devices[1]), 'home'); assert.equal(C.famDevState(devices[5]), 'unlocked'); assert.equal(C.famDevState(devices[4]), 'off');
    assert.equal(C.famDevNum(devices[3], 'F'), 77); assert.equal(C.famDevNum(devices[3], 'C'), 25); assert.equal(C.famDevNum(devices[6]), 3);
    assert.deepEqual(C.famStatesFor(devices[0]), ['open', 'closed']);
  });
  t('show only when: each kind of condition', () => {
    const ok = (c, e) => C.famCondOk(c, env(e));
    assert.equal(ok({ type: 'state', id: 'ha:cover.garage', op: 'is', value: 'open' }), true);
    assert.equal(ok({ type: 'state', id: 'ha:cover.garage', op: 'not', value: 'open' }), false);
    assert.equal(ok({ type: 'state', id: 'ha:sensor.patio', op: 'above', value: '75' }), true);
    assert.equal(ok({ type: 'state', id: 'ha:sensor.patio', op: 'below', value: '75' }), false);
    assert.equal(ok({ type: 'state', id: 'ha:todo.shop', op: 'above', value: 0 }), true);
    assert.equal(ok({ type: 'home', who: 'anyone' }), true); assert.equal(ok({ type: 'home', who: 'nobody' }), false);
    assert.equal(ok({ type: 'home', who: 'ha:person.leo' }), false); assert.equal(ok({ type: 'home', who: 'ha:person.mia' }), true);
    assert.equal(ok({ type: 'days', days: [1, 2, 3, 4, 5] }), true); assert.equal(ok({ type: 'days', days: [0, 6] }), false);
    assert.equal(ok({ type: 'time', from: '18:00', to: '22:00' }), false);
  });
  t('show only when: all or any; what can\'t be told counts as met', () => {
    const garageOpen = { type: 'state', id: 'ha:cover.garage', op: 'is', value: 'open' }, evening = { type: 'time', from: '18:00', to: '23:00' };
    assert.equal(C.famRuleOk({ conds: [garageOpen, evening] }, env()), false);
    assert.equal(C.famRuleOk({ mode: 'any', conds: [garageOpen, evening] }, env()), true);
    assert.equal(C.famRuleOk({ conds: [] }, env()), true); assert.equal(C.famRuleOk(null, env()), true);
    assert.equal(C.famRuleOk({ conds: [{ type: 'state', id: 'ha:gone.sensor', op: 'is', value: 'on' }] }, env()), true, 'a device that isn\'t there: shown');
    assert.equal(C.famRuleOk({ conds: [garageOpen] }, env({ devices: null })), true, 'devices not loaded yet: shown');
  });
}
