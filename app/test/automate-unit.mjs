/* Unit tests for the things CasaTorch now does by itself (the automation pass): gear that moved to a new address is
   followed (79m-moved.js). Run from test/unit.mjs (which loads server.js first, CASATORCH_TEST=1). */
import assert from 'node:assert/strict';

export default async function automateTests(t) {
  const M = globalThis.__casatorchMoved;
  if (!M) { console.log('skip automate-unit (no __casatorchMoved)'); return; }
  const kept = M.keep();
  try {
    t('moved: hardware ids compare in one form; too short or not hex is not an id', () => {
      assert.equal(M.movedId('00:00:00:ff:fe:00:00:01'), '000000FFFE000001');   // scrub-ok: made-up ids
      assert.equal(M.movedId('000000fffe000001'), '000000FFFE000001');   // scrub-ok: made-up id
      assert.equal(M.movedId('abc'), null);
      assert.equal(M.movedId(null), null);
      assert.equal(M.movedId('x'.repeat(40)), null);
    });

    t('moved: a device that stopped answering is matched to the address showing its id - one address per device, never its old one', () => {
      const down = [{ host: '192.168.1.40', id: 'AABBCC000001' }, { host: '192.168.1.41', id: 'AABBCC000002' }, { host: '192.168.1.42', id: null }];   // scrub-ok: example addresses, made-up ids
      const seen = [{ addr: '192.168.1.40', id: 'AABBCC000001' }, { addr: '192.168.1.77', id: 'aa:bb:cc:00:00:01' }, { addr: '192.168.1.78', id: 'FFFFFF000009' }, { addr: '192.168.1.79', id: 'AABBCC000002' }];   // scrub-ok: example addresses, made-up ids
      assert.deepEqual(M.movedMatch(down, seen), [{ from: '192.168.1.40', to: '192.168.1.77' }, { from: '192.168.1.41', to: '192.168.1.79' }]);   // scrub-ok: example addresses
      assert.deepEqual(M.movedMatch(down, [{ addr: '192.168.1.80', id: 'AABBCC000003' }]), [], 'another device is not taken for it');   // scrub-ok: example address, made-up id
      assert.deepEqual(M.movedMatch([{ host: 'a', id: 'AABBCC000001' }, { host: 'b', id: 'AABBCC000001' }], [{ addr: 'c', id: 'AABBCC000001' }]).length, 1, 'one address is never given to two devices');
    });

    t('moved: at most one look for each kind every 10 minutes', () => {
      delete M.MOVED.at.test; const now = Date.now();
      assert.equal(M.movedDue('test', now), true);
      assert.equal(M.movedDue('test', now + 60_000), false);
      assert.equal(M.movedDue('test', now + 11 * 60_000), true);
    });

    await t('moved: the Hue bridge is followed by its bridge id; only its public page is asked, the key goes nowhere else', async () => {
      M.setCfg({ house: { name: 'Test' }, hue: { host: '192.168.1.20', username: 'hue-user-key-0123456789' } });   // scrub-ok: example address
      M.movedLearnHue({ name: 'Hue', bridgeid: '000000FFFE000001' });   // scrub-ok: made-up id
      assert.equal(M.cfg().hue.bridgeid, '000000FFFE000001', 'learned while it answered');   // scrub-ok: made-up id
      const asked = [];
      const ask = (ip) => { asked.push(ip); return { '192.168.1.30': { bridgeid: 'FFFFFFFFFE000009' }, '192.168.1.31': { bridgeid: '000000fffe000001' } }[ip] || null; };   // scrub-ok: example addresses, made-up ids
      const heal = M.HEAL.length;
      const m = await M.movedFollowHue({ find: async () => ['192.168.1.20', '192.168.1.30', '192.168.1.31', '8.8.8.8', '169.254.169.254'], ask });   // scrub-ok: example addresses
      assert.deepEqual(m, { from: '192.168.1.20', to: '192.168.1.31' });   // scrub-ok: example addresses
      assert.deepEqual(asked.sort(), ['192.168.1.30', '192.168.1.31'], 'never its old address, never an internet or metadata address');   // scrub-ok: example addresses
      assert.equal(M.cfg().hue.host, '192.168.1.31'); assert.equal(M.cfg().hue.username, 'hue-user-key-0123456789', 'the key stays');   // scrub-ok: example address
      assert.equal(M.HEAL.length, heal + 1); assert.match(M.HEAL[M.HEAL.length - 1].detail, /Hue bridge got a new address/);
      assert.equal(await M.movedFollowHue({ find: async () => ['192.168.1.30'], ask }), null, 'no match: nothing changes');   // scrub-ok: example address
      M.setCfg({ house: { name: 'Test' }, hue: { host: '192.168.1.20', username: 'k' } });   // scrub-ok: example address
      assert.equal(await M.movedFollowHue({ find: async () => ['192.168.1.31'], ask }), null, 'no bridge id learned yet: nothing is guessed');   // scrub-ok: example address
    });

    await t('moved: a Shelly is followed by its hardware id and keeps its device ids (tiles, rooms, alert rules)', async () => {
      M.setCfg({ house: { name: 'Test' }, shelly: [{ host: '192.168.1.40' }, { host: '192.168.1.41' }] });   // scrub-ok: example addresses
      M.movedLearnShelly([{ host: '192.168.1.40', id: 'AABBCC000001' }, { host: '192.168.1.41', id: 'AABBCC000002' }]);   // scrub-ok: example addresses, made-up ids
      assert.deepEqual(M.cfg().shelly.map((s) => s.hwid), ['AABBCC000001', 'AABBCC000002']);   // scrub-ok: made-up ids
      const moves = await M.movedFollowShelly(['192.168.1.40'], { find: async () => ['192.168.1.41', '192.168.1.90'], found: () => ['192.168.1.91'], ask: (ip) => ({ '192.168.1.90': { mac: 'FFFFFF000009' }, '192.168.1.91': { mac: 'AABBCC000001' } })[ip] });   // scrub-ok: example addresses, made-up ids
      assert.deepEqual(moves, [{ from: '192.168.1.40', to: '192.168.1.91' }]);   // scrub-ok: example addresses
      const s = M.cfg().shelly;
      assert.equal(s[0].host, '192.168.1.91'); assert.equal(s[0].tag, '192.168.1.40', 'device ids stay named after where it was added');   // scrub-ok: example addresses
      assert.equal(s[1].host, '192.168.1.41'); assert.equal(s[1].tag, undefined, 'the other one is untouched');   // scrub-ok: example address
      assert.deepEqual(await M.movedFollowShelly(['192.168.1.41'], { find: async () => [], found: () => [], ask: () => null }), [], 'not found: nothing changes');   // scrub-ok: example address
    });

    await t('moved: Home Assistant is found again by the id it announces; its token goes only to an address announcing that id', async () => {
      const U = '0123456789abcdef0123456789abcdef', OTHER = 'ffffffffffffffffffffffffffffffff';
      const ann = (ip, uuid, txt = {}) => ({ name: 'Home._home-assistant._tcp.local', ip, port: 8123, txt: { uuid, ...txt } });
      assert.deepEqual(M.haAnnounced([ann('192.168.1.20', U), ann('192.168.1.21', 'nope'), ann(null, U, { internal_url: 'http://ha.local:8123/' }), { txt: {} }]),   // scrub-ok: example addresses
        [{ uuid: U, url: 'http://192.168.1.20:8123' }, { uuid: U, url: 'http://ha.local:8123' }]);   // scrub-ok: example address
      M.setCfg({ house: { name: 'Test' }, homeAssistant: { url: 'http://192.168.1.20:8123', token: 'ha-token-0123456789' } });   // scrub-ok: example address
      assert.equal(await M.movedLearnHa({ find: async () => [ann('192.168.1.30', OTHER), ann('192.168.1.20', U)] }), U, 'ours is the one at our address');   // scrub-ok: example addresses
      assert.equal(M.cfg().homeAssistant.uuid, U);
      const tried = [];
      const works = async (url, token) => { tried.push([url, token]); return url === 'http://192.168.1.25:8123'; };   // scrub-ok: example address
      const heal = M.HEAL.length;
      const m = await M.movedFollowHa({ find: async () => [ann('192.168.1.20', U), ann('192.168.1.30', OTHER), ann('192.168.1.25', U), ann('198.51.100.9', U)], works });   // scrub-ok: example addresses
      assert.deepEqual(m, { from: 'http://192.168.1.20:8123', to: 'http://192.168.1.25:8123' });   // scrub-ok: example addresses
      assert.deepEqual(tried.map((x) => x[0]), ['http://192.168.1.25:8123'], 'the token went only to the address with our id, never another Home Assistant or the internet');   // scrub-ok: example address
      assert.equal(M.cfg().homeAssistant.url, 'http://192.168.1.25:8123'); assert.equal(M.cfg().homeAssistant.token, 'ha-token-0123456789');   // scrub-ok: example address
      assert.match(M.HEAL[heal].detail, /Home Assistant got a new address/);
      M.setCfg({ house: { name: 'Test' }, homeAssistant: { url: 'http://192.168.1.20:8123', token: 't' } });   // scrub-ok: example address
      assert.equal(await M.movedFollowHa({ find: async () => [ann('192.168.1.25', U)], works }), null, 'its id not learned yet: nothing is tried');   // scrub-ok: example address
    });

    await t('Hue in one tap: Pair waits while the bridge asks for its button, and stops at once on any other answer', async () => {
      let n = 0;
      const pair = async () => (++n < 3 ? { ok: false, button: true, error: 'press it' } : { ok: true, username: 'u' });
      assert.deepEqual(await M.huePairWait('192.168.1.20', { pair, every: 1, wait: async () => {} }), { ok: true, username: 'u' });   // scrub-ok: example address
      assert.equal(n, 3, 'asked again until the button was pressed');
      n = 0;
      const never = await M.huePairWait('192.168.1.20', { pair: async () => { n++; return { ok: false, button: true }; }, ms: 30, every: 10, wait: (ms) => new Promise((ok) => setTimeout(ok, ms)) });   // scrub-ok: example address
      assert.equal(never.ok, false); assert.equal(never.timeout, true); assert.match(never.error, /wasn't pressed in time/);
      assert.ok(n >= 2 && n <= 5, `asked ${n} times in 30 ms`);
      n = 0;
      const other = await M.huePairWait('192.168.1.20', { pair: async () => { n++; return { ok: false, error: 'not a bridge' }; }, every: 1, wait: async () => {} });   // scrub-ok: example address
      assert.deepEqual([other.error, n], ['not a bridge', 1], 'not a "press the button" answer: no waiting');
    });

    t('found gear in one tap: the first Hue bridge and the first Frigate say "Adds in one tap"; with one already there, the guided setup', () => {
      const D = globalThis.__casatorchDiscover;
      const hue = { key: 'hue:192.168.1.20', kind: 'hue', addr: '192.168.1.20' }, fr = { key: 'frigate:192.168.1.10', kind: 'frigate', addr: 'http://192.168.1.10:5000' };   // scrub-ok: example addresses
      assert.equal(D.discView(hue, {}).how, 'direct'); assert.equal(D.discView(fr, {}).how, 'direct');
      assert.equal(D.discView(hue, { hue: { host: '192.168.1.21', username: 'k' } }).how, 'setup', 'a second bridge: setup, which says what it replaces');   // scrub-ok: example address
      assert.equal(D.discView(fr, { cameras: [{ type: 'frigate', url: 'http://192.168.1.11:5000' }] }).how, 'setup');   // scrub-ok: example address
      assert.equal(D.discView({ key: 'onvif:192.168.1.73', kind: 'onvif', addr: '192.168.1.73' }, {}).how, 'setup', 'cameras that need a password still go to setup');   // scrub-ok: example address
    });

    await t('found gear in one tap: Frigate without a password gives its cameras as setup saves them; a sign-in, https or an internet address goes to setup', async () => {
      const D = globalThis.__casatorchDiscover, seen = [];
      const test = async (b) => { seen.push(b.url); return { ok: true, cameras: ['front_door', 'back-yard', 'bad name<'] }; };
      const r = await D.discFrigateQuick('192.168.1.10', test);   // scrub-ok: example address
      assert.equal(r.url, 'http://192.168.1.10:5000');   // scrub-ok: example address
      assert.deepEqual(r.cams.map((c) => [c.id, c.name, c.type, c.camera]), [['frigate-front_door', 'Front door', 'frigate', 'front_door'], ['frigate-back-yard', 'Back yard', 'frigate', 'back-yard']]);
      assert.ok(r.cams.every((c) => !('user' in c) && !('password' in c)), 'no sign-in kept');
      assert.equal(await D.discFrigateQuick('192.168.1.10', async () => ({ ok: false, needLogin: true })), null, 'asks for a sign-in: setup');   // scrub-ok: example address
      assert.equal(await D.discFrigateQuick('https://192.168.1.10:8971', test), null, 'its secure port: setup (the certificate is trusted there)');   // scrub-ok: example address
      assert.equal(await D.discFrigateQuick('http://198.51.100.7:5000', test), null, 'never an internet address');
      assert.deepEqual(seen, ['http://192.168.1.10:5000'], 'only the home address was asked');   // scrub-ok: example address
    });

    t('Home step from Home Assistant: name, time zone, units, currency and a rounded position; anything odd is left out', () => {
      const G = globalThis.__casatorchSetupHome.haHomeGuess;
      assert.deepEqual(G({ location_name: 'Maple\u202e Cottage\n', time_zone: 'Europe/Berlin', latitude: 52.520008, longitude: 13.404954, country: 'de', currency: 'EUR', unit_system: { temperature: '°C' } }),
        { name: 'Maple Cottage', timezone: 'Europe/Berlin', units: 'C', currency: 'EUR', location: { lat: 52.52, lon: 13.4, cc: 'DE' } });
      assert.deepEqual(G({ time_zone: 'America/Argentina/Buenos_Aires', unit_system: { temperature: '°F' } }), { name: null, timezone: 'America/Argentina/Buenos_Aires', units: 'F', currency: null, location: null });
      const odd = G({ location_name: '<>\u200b ', time_zone: '../../etc', latitude: 0, longitude: 0, currency: 'euro', unit_system: { temperature: 'K' } });
      assert.equal(odd, null, 'nothing usable: nothing offered');
      assert.equal(G({ latitude: 95, longitude: 10, location_name: 'Home' }).location, null, 'not a place on Earth');
      assert.equal(G(null), null); assert.equal(G('x'), null);
    });

    await t('Home step from Home Assistant: the setup screen fills only what is still unanswered', async () => {
      const fs = await import('node:fs'), vm = await import('node:vm');
      const src = fs.readFileSync(new URL('../public/setup.js', import.meta.url), 'utf8');
      const fn = src.match(/function fillHomeFromHa\(store, g\) \{[\s\S]*?\n\}/)?.[0]; assert.ok(fn, 'fillHomeFromHa is in setup.js');
      const ctx = { T: (s) => s, Intl }; vm.runInNewContext(`${fn}; this.fill = fillHomeFromHa;`, ctx);
      const g = { name: 'Maple Cottage', timezone: 'Europe/Berlin', units: 'C', currency: 'EUR', location: { lat: 52.52, lon: 13.4, cc: 'DE' } };
      const fresh = {}; assert.equal(ctx.fill(fresh, g), true);
      assert.deepEqual([fresh.name, fresh.timezone, fresh.units, fresh.currency, fresh.location.lat, fresh.location.cc, fresh.location.fromHa], ['Maple Cottage', 'Europe/Berlin', 'C', 'EUR', 52.52, 'DE', true]);
      const mine = { name: 'Our place', timezone: 'Asia/Tokyo', units: 'F', _unitsSet: true, currency: 'JPY', _currencySet: true, location: { name: 'Kyoto', lat: 35.01, lon: 135.77 } };
      assert.equal(ctx.fill(mine, g), false, 'everything answered already: nothing changes');
      assert.deepEqual([mine.name, mine.timezone, mine.units, mine.currency, mine.location.name], ['Our place', 'Asia/Tokyo', 'F', 'JPY', 'Kyoto']);
      assert.equal(ctx.fill({}, null), false);
    });

    t('full disk: tidied by itself when Storage is red or the data folder is full - at most every 6 hours', () => {
      const S = globalThis.__casatorchSetup, now = Date.now();
      const red = [{ id: 'storage', status: 'bad' }], full = [{ id: 'data', status: 'bad', fix: { action: 'free-space' } }];
      assert.equal(S.autoFreeDue(red, 0, now), true); assert.equal(S.autoFreeDue(full, 0, now), true);
      assert.equal(S.autoFreeDue([{ id: 'storage', status: 'warn' }], 0, now), false, 'getting low is only a warning: the button is there');
      assert.equal(S.autoFreeDue([{ id: 'data', status: 'bad' }], 0, now), false, 'not allowed to save is not a full disk');
      assert.equal(S.autoFreeDue(red, now - 3600_000, now), false); assert.equal(S.autoFreeDue(red, now - 7 * 3600_000, now), true);
    });

    t('full disk: what it removed is listed under "Fixed by itself", and Storage is checked again', () => {
      const S = globalThis.__casatorchSetup, heal = M.HEAL.length, was = S.DOC.freedAt; let ran = 0;
      try {
        S.DOC.freedAt = 0;
        const checks = [{ id: 'storage', status: 'bad', title: 'Storage space' }, { id: 'ha', status: 'ok' }];
        const out = S.doctorAutoFree(checks, { free: () => { ran++; return { freed: 5 * 1048576, what: ['leftover temporary files'] }; } });
        assert.equal(ran, 1); assert.equal(M.HEAL.length, heal + 1); assert.match(M.HEAL[M.HEAL.length - 1].detail, /disk was almost full/);
        assert.notEqual(out[0], checks[0], 'Storage looked at again'); assert.equal(out[1], checks[1]);
        S.doctorAutoFree(checks, { free: () => { ran++; return { freed: 1 }; } });
        assert.equal(ran, 1, 'not again within 6 hours');
        S.DOC.freedAt = 0;
        assert.equal(S.doctorAutoFree(checks, { free: () => ({ freed: 0, what: [] }) }), checks, 'nothing to remove: nothing changes, no note');
        assert.equal(M.HEAL.length, heal + 1);
      } finally { S.DOC.freedAt = was; }
    });
  } finally { M.restore(kept); }
}
