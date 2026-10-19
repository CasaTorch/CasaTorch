/* Voice assistants (79v-voice.js, src/voice/matter-bridge.mjs): the safety rule (never a lock, garage door, gate,
   alarm or siren - whatever is picked), how devices become Matter devices, the plain commands, the voice tokens'
   scopes over HTTP, plain-language Health, the bridge child process, and - in its own process - pairing with
   matter.js's own controller (voice-matter-int.mjs). Loaded by unit.mjs after the server (CASATORCH_TEST=1). */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default async function voiceUnit(t) {
  const V = globalThis.__casatorchVoice, H = globalThis.__casatorch, A = globalThis.__casatorchAsk;
  if (!V) { console.log('skip voice-unit (no __casatorchVoice)'); return; }
  const { _test: B } = await import('../src/voice/matter-bridge.mjs');
  const dev = (o) => ({ online: true, provider: 'ha', ...o });

  /* ---- the safety rule ---- */
  t('voice safety: locks, alarm panels and sirens are never shared', () => {
    assert.ok(V.voiceNever(dev({ id: 'ha:lock.front', kind: 'lock', domain: 'lock', name: 'Front' })));
    assert.ok(V.voiceNever(dev({ id: 'ha:alarm_control_panel.home', kind: 'alarm', domain: 'alarm_control_panel', name: 'House' })));
    assert.ok(V.voiceNever(dev({ id: 'ha:siren.hall', kind: 'switch', domain: 'siren', name: 'Hall' })));
  });
  t('voice safety: garage doors, gates, doors and valves are never shared; blinds and shades are', () => {
    assert.ok(V.voiceNever(dev({ id: 'ha:cover.g', kind: 'cover', domain: 'cover', haClass: 'garage', risky: true, name: 'Garage' })));
    assert.ok(V.voiceNever(dev({ id: 'ha:cover.x', kind: 'cover', domain: 'cover', haClass: 'gate', name: 'Driveway' })));
    assert.ok(V.voiceNever(dev({ id: 'ha:cover.y', kind: 'cover', domain: 'cover', haClass: null, name: 'Side thing' })), 'a cover that says nothing about itself');
    assert.ok(V.voiceNever(dev({ id: 'ha:cover.z', kind: 'cover', domain: 'cover', haClass: 'blind', name: 'Garage door blind' })), 'a "blind" named like a garage door');
    assert.ok(V.voiceNever(dev({ id: 'ha:valve.main', kind: 'cover', domain: 'valve', haClass: 'water', name: 'Water main' })));
    assert.equal(V.voiceNever(dev({ id: 'ha:cover.b', kind: 'cover', domain: 'cover', haClass: 'blind', name: 'Living room blinds' })), null);
    assert.equal(V.voiceNever(dev({ id: 'ha:cover.s', kind: 'cover', domain: 'cover', haClass: 'shade', name: 'Bedroom shades' })), null);
  });
  t('voice safety: a switch, fan or scene named like a door/gate/lock/alarm control is never shared (any language)', () => {
    for (const name of ['Garage door opener', 'Gate', 'Front door unlock', 'Disarm alarm', 'Garagentor', 'Portón']) assert.ok(V.voiceNever(dev({ id: `ha:switch.${name.length}`, kind: 'switch', domain: 'switch', name })), name);
    assert.ok(V.voiceNever(dev({ id: 'ha:scene.unlock_all', kind: 'action', domain: 'scene', name: 'Unlock everything' })));
    assert.ok(V.voiceNever(dev({ id: 'ha:script.bed', kind: 'action', domain: 'script', name: 'Bedtime' })), 'scripts can do anything: never');
    assert.ok(V.voiceNever(dev({ id: 'ha:button.x', kind: 'action', domain: 'button', name: 'Restart' })));
    assert.equal(V.voiceNever(dev({ id: 'ha:switch.kettle', kind: 'plug', domain: 'switch', name: 'Kettle' })), null);
    assert.equal(V.voiceNever(dev({ id: 'ha:light.porch', kind: 'light', domain: 'light', name: 'Front door light' })), null, 'a light can\'t open anything');
  });
  t('voice safety: a scene that sets a lock, an alarm or a garage door is never shared', () => {
    const scene = dev({ id: 'ha:scene.leaving', kind: 'action', domain: 'scene', name: 'Leaving' });
    assert.ok(V.voiceNever(scene, ['light.hall', 'lock.front_door']));
    assert.ok(V.voiceNever(scene, ['alarm_control_panel.home']));
    assert.ok(V.voiceNever(scene, ['cover.garage_door']));
    assert.equal(V.voiceNever(scene, ['light.hall', 'cover.living_room_blinds']), null);
  });
  await t('voice safety: picking a lock, garage door or alarm on does nothing - never on the bridge, never switched', async () => {
    const was = process.env.CASATORCH_DEMO; process.env.CASATORCH_DEMO = '1';
    const st = V.voiceLoad().matter, picks = { ...st.picks };
    try {
      Object.assign(st.picks, { 'ha:lock.front_door': true, 'ha:cover.garage_door': true, 'ha:alarm_control_panel.home': true, 'ha:valve.water_main': true, 'ha:script.goodnight': true });
      const cat = await V.voiceCatalog(), by = (id) => cat.find((c) => c.device.id === id);
      for (const id of ['ha:lock.front_door', 'ha:lock.back_door', 'ha:cover.garage_door', 'ha:alarm_control_panel.home', 'ha:valve.water_main', 'ha:script.goodnight']) { assert.ok(by(id), id); assert.equal(by(id).shared, false, id); assert.ok(by(id).never, id); }
      const items = await V.voiceBridgeItems();
      assert.ok(!items.some((i) => /lock\.|garage_door|alarm_control|valve\.|script\./.test(i.key)), 'nothing risky reaches the bridge');
      assert.ok(items.some((i) => i.key === 'ha:cover.living_room_blinds' && i.type === 'cover'));
      for (const [id, action] of [['ha:lock.front_door', 'unlock'], ['ha:lock.front_door', 'lock'], ['ha:cover.garage_door', 'open'], ['ha:cover.garage_door', 'close'], ['ha:alarm_control_panel.home', 'disarm']]) await assert.rejects(V.voiceAct(id, action, undefined, 'test'), (e) => e.status === 403, `${id} ${action}`);
      await assert.rejects(V.voiceAct('ha:cover.living_room_blinds', 'unlock', undefined, 'test'), (e) => e.status === 403, 'an action blinds don\'t have');
      assert.equal((await V.voiceAct('ha:light.porch', 'on', undefined, 'test')).ok, true);
    } finally { st.picks = picks; if (was === undefined) delete process.env.CASATORCH_DEMO; else process.env.CASATORCH_DEMO = was; }
  });
  t('voice safety: the list of what an assistant may do has no unlock, open-a-door or disarm', () => {
    const all = Object.values(V.VOICE_ACTIONS).flat();
    for (const a of ['unlock', 'disarm', 'arm_home', 'arm_away']) assert.ok(!all.includes(a), a);
    assert.equal(V.VOICE_ACTIONS.lock, undefined); assert.equal(V.VOICE_ACTIONS.alarm, undefined);
  });

  /* ---- devices -> Matter ---- */
  t('voice mapping: lights become on/off, dimmable, color-temperature or color lights by what they can do', () => {
    const type = (o) => V.voiceItemsOf(dev({ id: 'ha:light.a', kind: 'light', name: 'A', on: true, ...o }))[0].type;
    assert.equal(type({ brightness: null, can: [] }), 'onoff-light');
    assert.equal(type({ brightness: 40, can: ['brightness'] }), 'dimmable-light');
    assert.equal(type({ can: ['brightness', 'kelvin'] }), 'ct-light');
    assert.equal(type({ can: ['brightness', 'color', 'kelvin'] }), 'color-light');
    assert.equal(V.voiceItemsOf({ id: 'hue:1', provider: 'hue', kind: 'light', name: 'Hue', on: false, brightness: 30 })[0].type, 'dimmable-light');
  });
  t('voice mapping: plugs, switches, fans, blinds, thermostats and scenes; names and rooms carried over', () => {
    const one = (o) => V.voiceItemsOf(dev({ id: 'ha:x.y', name: 'Thing', area: 'Kitchen', ...o }))[0];
    assert.equal(one({ kind: 'plug' }).type, 'plug'); assert.equal(one({ kind: 'switch' }).type, 'plug');
    assert.equal(one({ kind: 'fan', percent: 40 }).state.percent, 40);
    assert.equal(one({ kind: 'cover', position: 70 }).type, 'cover');
    assert.equal(one({ kind: 'climate', domain: 'climate', targetC: 21, tempC: 20 }).type, 'thermostat');
    assert.equal(V.voiceItemsOf(dev({ id: 'ha:water_heater.t', kind: 'climate', domain: 'water_heater', targetC: 50 })).length, 0, 'a water heater is not a thermostat');
    assert.equal(one({ kind: 'action', domain: 'scene' }).type, 'scene');
    const it = one({ kind: 'plug', name: 'Kettle' }); assert.equal(it.name, 'Kettle'); assert.equal(it.room, 'Kitchen');
    assert.equal(V.voiceItemsOf(dev({ id: 'ha:switch.k', kind: 'plug', name: 'Kettle', area: 'Kitchen' }), { roomInName: true })[0].name, 'Kitchen Kettle');
    assert.equal(V.voiceItemsOf(dev({ id: 'ha:switch.k', kind: 'plug', name: 'Kitchen kettle', area: 'Kitchen' }), { roomInName: true })[0].name, 'Kitchen kettle', 'no "Kitchen Kitchen"');
    for (const k of ['media', 'camera', 'vacuum', 'presence', 'value', 'lock', 'alarm']) assert.equal(V.voiceItemsOf(dev({ id: `ha:${k}.a`, kind: k, name: k })).length, 0, k);
  });
  t('voice mapping: one sensor can be several Matter sensors (temperature + humidity), power meters are not', () => {
    const items = V.voiceItemsOf({ id: 'shelly:h:temperature', provider: 'shelly', kind: 'sensor', name: 'Bath', tempC: 21.5, humidity: 60 });
    assert.deepEqual(items.map((i) => i.type), ['temp', 'humidity']); assert.equal(items[1].name, 'Bath humidity');
    assert.deepEqual(V.voiceItemsOf(dev({ id: 'ha:binary_sensor.w', kind: 'sensor', name: 'Window', open: true })).map((i) => i.type), ['contact']);
    assert.deepEqual(V.voiceItemsOf(dev({ id: 'ha:binary_sensor.m', kind: 'sensor', name: 'Hall', motion: false })).map((i) => i.type), ['occupancy']);
    assert.deepEqual(V.voiceItemsOf(dev({ id: 'ha:binary_sensor.l', kind: 'sensor', name: 'Sink', water: false })).map((i) => i.type), ['leak']);
    assert.equal(V.voiceItemsOf(dev({ id: 'ha:sensor.p', kind: 'sensor', name: 'Power', powerW: 5, meter: true })).length, 0);
  });
  t('voice mapping: shared by default - lights, plugs, fans, blinds, thermostats, scenes, sensors in a room; automations not', () => {
    assert.equal(V.voiceDefaultOn(dev({ kind: 'light' })), true); assert.equal(V.voiceDefaultOn(dev({ kind: 'action', domain: 'scene' })), true);
    assert.equal(V.voiceDefaultOn(dev({ kind: 'sensor', area: 'Hall' })), true); assert.equal(V.voiceDefaultOn(dev({ kind: 'sensor' })), false, 'Home Assistant sensors in no room (there can be hundreds)');
    assert.equal(V.voiceDefaultOn(dev({ kind: 'switch', domain: 'automation' })), false);
  });
  t('voice mapping: Matter attributes - levels, blinds the other way round, contact = closed, 0.01 °C', () => {
    assert.equal(B.LEVEL(100), 254); assert.equal(B.LEVEL(0), 1); assert.equal(B.PCT(254), 100); assert.equal(B.PCT(127), 50);
    assert.deepEqual(B.attrsOf({ type: 'cover', state: { position: 70 } }).windowCovering.currentPositionLiftPercent100ths, 3000, 'Matter counts closed, CasaTorch counts open');
    assert.equal(B.attrsOf({ type: 'cover', state: { open: true, position: null } }).windowCovering.currentPositionLiftPercent100ths, 0);
    assert.equal(B.attrsOf({ type: 'contact', state: { open: false } }).booleanState.stateValue, true);
    assert.equal(B.attrsOf({ type: 'temp', state: { tempC: 21.37 } }).temperatureMeasurement.measuredValue, 2137);
    assert.equal(B.attrsOf({ type: 'thermostat', state: { targetC: 21, mode: 'heat' } }).thermostat.systemMode, 4);
    assert.equal(B.attrsOf({ type: 'fan', state: { on: true, percent: 80 } }).fanControl.fanMode, 3);
    const hs = B.hexToHs('#ff0000'); assert.equal(hs.hue, 0); assert.equal(hs.sat, 254); assert.equal(B.hsToHex(hs.hue, hs.sat), '#ff0000');
    assert.equal(B.epId('hue:1', 'dimmable-light'), B.epId('hue:1', 'dimmable-light'), 'stable'); assert.notEqual(B.epId('hue:1', 'plug'), B.epId('hue:2', 'plug'));
  });

  /* ---- plain commands ---- */
  t('voice commands: "turn off the kitchen lights", "turn the porch light on", "dim ... to 30%", "set the thermostat to 70"', () => {
    assert.deepEqual(V.voiceParse('Turn off the kitchen lights.'), { action: 'off', target: 'kitchen lights', all: false });
    assert.equal(V.voiceParse('turn the porch light on').action, 'on'); assert.equal(V.voiceParse('turn the porch light on').target, 'porch light');
    assert.deepEqual(V.voiceParse('dim the kitchen to 30%'), { action: 'brightness', target: 'kitchen', value: 30 });
    assert.equal(V.voiceParse('set the thermostat to 70 degrees').action, 'target');
    assert.equal(V.voiceParse('what is the weather like?'), null);
  });
  await t('voice commands: room lights, a single device, the safety answer for "unlock" (demo house)', async () => {
    const was = process.env.CASATORCH_DEMO; process.env.CASATORCH_DEMO = '1';
    try {
      const cat = await V.voiceCatalog();
      const kitchen = V.voiceMatch(cat, V.voiceParse('turn off the kitchen lights')); assert.ok(kitchen.length >= 2); assert.ok(kitchen.every((c) => c.device.kind === 'light' && /kitchen/i.test(c.device.area)));
      assert.deepEqual(V.voiceMatch(cat, V.voiceParse('turn on the porch light')).map((c) => c.device.id), ['ha:light.porch']);
      const r = await V.voiceCommand('unlock the front door', 'test'); assert.equal(r.done, false); assert.match(r.speech, /never unlocks/);
      const g = await V.voiceCommand('turn on the garage door', 'test'); assert.equal(g.done, false);
      assert.equal((await V.voiceCommand('open the garage door', 'test')).done, false); assert.equal((await V.voiceCommand('disarm the alarm', 'test')).done, false);
      const blinds = await V.voiceCommand('open the living room blinds', 'test'); assert.equal(blinds.done, true, blinds.speech);
      const ok = await V.voiceCommand('turn off the kitchen lights', 'test'); assert.equal(ok.done, true); assert.match(ok.speech, /^Done/);
    } finally { if (was === undefined) delete process.env.CASATORCH_DEMO; else process.env.CASATORCH_DEMO = was; }
  });

  /* ---- tokens: scopes, over HTTP ---- */
  await t('voice tokens: only /api/voice/ask and /api/voice/do, each only with its scope; wrong tokens refused; spoken plain text', async () => {
    const env = { demo: process.env.CASATORCH_DEMO, pro: process.env.CASATORCH_PRO_DEV };
    process.env.CASATORCH_DEMO = '1'; process.env.CASATORCH_PRO_DEV = '1';
    const st = V.voiceLoad(), keep = st.tokens.slice();
    const ask = V.voiceTokenCreate({ name: 'Ask only', scopes: ['ask'] }), doit = V.voiceTokenCreate({ name: 'Do only', scopes: ['do'] }), both = V.voiceTokenCreate({ name: 'Both', scopes: ['ask', 'do', 'admin'] });
    assert.match(ask.token, /^ctv_[A-Za-z0-9_-]{30,80}$/); assert.deepEqual(both.scopes, ['ask', 'do'], 'unknown scopes dropped');
    assert.ok(!JSON.stringify(st.tokens).includes(ask.token), 'only a hash is kept');
    A.useProvider({ name: 'Test AI', async turn() { return { text: '**It is 68 °F inside.** All doors are closed.\n```offer\n{"text":"Want the week?","ask":["Show the week"]}\n```', calls: [], sources: [] }; } });
    const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
    const B0 = `http://127.0.0.1:${srv.address().port}`;
    const post = (p, tok, body) => fetch(`${B0}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
    try {
      assert.equal((await post('/api/voice/ask', null, { question: 'hi' })).status, 401);
      assert.equal((await post('/api/voice/ask', `ctv_${'x'.repeat(40)}`, { question: 'hi' })).status, 401);
      assert.equal((await post('/api/voice/do', ask.token, { text: 'turn on the porch light' })).status, 403, 'an ask-only token can\'t switch');
      const sneaky = await post('/api/voice/ask', ask.token, { question: 'turn on the porch light' }); assert.equal(sneaky.status, 403, '...not even through ask');
      assert.equal((await post('/api/voice/ask', doit.token, { question: 'how warm is it?' })).status, 403, 'a do-only token can\'t ask');
      const a = await post('/api/voice/ask', ask.token, { question: 'How warm is it inside?' }); assert.equal(a.status, 200);
      assert.match(a.headers.get('content-type'), /text\/plain/); const said = await a.text();
      assert.equal(said, 'It is 68 °F inside. All doors are closed.', 'spoken: plain words, no markdown, no follow-up offer');
      const d = await post('/api/voice/do', doit.token, { text: 'turn off the kitchen lights' }); assert.equal(d.status, 200); assert.match(await d.text(), /^Done/);
      const no = await post('/api/voice/do', both.token, { text: 'unlock the front door' }); assert.equal(no.status, 403); assert.match(await no.text(), /never unlocks/);
      const j = await fetch(`${B0}/api/voice/do`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${both.token}` }, body: JSON.stringify({ device: 'Front door lock', action: 'unlock' }) });
      assert.equal(j.status, 403); assert.equal((await j.json()).ok, false);
    } finally {
      srv.close(); A.useProvider(null); st.tokens = keep;
      if (env.demo === undefined) delete process.env.CASATORCH_DEMO; else process.env.CASATORCH_DEMO = env.demo;
      if (env.pro === undefined) delete process.env.CASATORCH_PRO_DEV; else process.env.CASATORCH_PRO_DEV = env.pro;
    }
  });

  /* ---- plain-language problems ---- */
  t('voice health: no IPv6, ports in use, no multicast, missing package - each in plain words with what to do', () => {
    assert.match(V.voiceExplain('Cannot bind to {::}:5353 (code EAFNOSUPPORT)', 'EAFNOSUPPORT').error, /IPv6 is turned off/);
    assert.match(V.voiceExplain('bind EADDRINUSE 0.0.0.0:5540', 'EADDRINUSE').error, /ports \(5540-5549\)/);
    assert.match(V.voiceExplain('addMembership EPERM', 'EPERM').error, /multicast/);
    assert.match(V.voiceExplain('Cannot find package \'@matter/main\'', 'ERR_MODULE_NOT_FOUND').error, /missing/);
    for (const k of ['EAFNOSUPPORT', 'EADDRINUSE', 'EPERM']) assert.ok(V.voiceExplain('x', k).why, k);
  });

  /* ---- the bridge as CasaTorch runs it: a child process, talking over IPC ---- */
  await t('voice bridge process: starts, hands back its pairing code and sealed-storage changes, takes the items', async () => {
    const file = fileURLToPath(new URL('../src/voice/matter-bridge.mjs', import.meta.url));
    const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, CASATORCH_MATTER_CHILD: '1', CASATORCH_MATTER_SIMULATE: '1', HOME: '/tmp/casatorch-unit' } });
    const got = [], seen = (fn, ms = 15000) => new Promise((ok, no) => { const t0 = Date.now(); const iv = setInterval(() => { const m = got.find(fn); if (m) { clearInterval(iv); ok(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); no(new Error(`no such message: ${JSON.stringify(got.slice(-3)).slice(0, 300)}`)); } }, 30); });
    child.on('message', (m) => got.push(m));
    try {
      await seen((m) => m.t === 'hello');
      child.send({ t: 'start', opts: { port: 5540, passcode: 20202031, discriminator: 77, serial: 'CT-TEST', uniqueId: 'ct-unit', name: 'Test House', version: '0.0.1' }, storage: {} });
      const ready = await seen((m) => m.t === 'status' && m.status.state === 'ready');
      assert.match(ready.status.pairing.manual, /^\d{11}$/); assert.equal(ready.status.commissioned, false);
      await seen((m) => m.t === 'store' && m.ns === 'bridge');
      child.send({ t: 'items', items: [{ key: 'hue:1', type: 'dimmable-light', name: 'Kitchen', state: { on: true, level: 50 } }, { key: 'ha:switch.k', type: 'plug', name: 'Kettle', state: { on: false } }, { key: 'bad', type: 'lock', name: 'Nope' }] });
      const st = await seen((m) => m.t === 'status' && m.status.devices === 2);
      assert.equal(st.status.devices, 2, 'an unknown type (a lock) is ignored by the bridge too');
      child.send({ t: 'stop' });
      await new Promise((ok) => child.once('exit', ok));
    } finally { try { child.kill(); } catch { /* gone */ } }
  });

  /* ---- pairing with matter.js's own controller (its own process) ---- */
  await t('voice bridge: paired by a Matter controller end to end (voice-matter-int.mjs)', async () => {
    const file = fileURLToPath(new URL('./voice-matter-int.mjs', import.meta.url));
    const out = await new Promise((ok) => { const c = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: '/tmp/casatorch-unit' } }); let s = ''; c.stdout.on('data', (b) => { s += b; }); c.stderr.on('data', (b) => { s += b; }); const k = setTimeout(() => c.kill(), 90_000); c.on('exit', (code) => { clearTimeout(k); ok({ code, s }); }); });
    const lines = out.s.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.done), `the pairing test didn't finish:\n${out.s.slice(-1500)}`);
    assert.ok(lines.filter((l) => l.ok).length >= 12); assert.equal(out.code, 0);
  });
}
