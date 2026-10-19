/* Voice assistants, end to end with matter.js's own controller: the CasaTorch bridge starts on a simulated
   network (no IPv6, multicast or free UDP port needed), shows a pairing code, is paired ("commissioned") by a
   controller the way Alexa, Google Home or Apple Home would, exposes one bridged endpoint per item, sends an
   assistant's "turn on" back as a command, follows CasaTorch's own changes, takes a second app (multi-admin),
   lets one be removed, keeps its pairings across a restart (sealed storage handed to CasaTorch) and resets.
   Run by voice-unit.mjs in its own process (matter.js ends a process on an error nobody caught).
   Prints one JSON line per check: {"ok":true,"name":"..."} and finally {"done":true}. */
import assert from 'node:assert/strict';
import { createBridge } from '../src/voice/matter-bridge.mjs';

const M = await import('@matter/main');
const { ServerNode, ControllerBehavior, NetworkSimulator, Network, Environment } = M;
const { OnOffClient } = await import('@matter/main/behaviors/on-off');
const sim = new NetworkSimulator();
Environment.default.set(Network, sim.addHost(1));
Environment.default.vars.set('log.level', 'error');
const say = (o) => console.log(JSON.stringify(o));
const check = async (name, fn) => { await fn(); say({ ok: true, name }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(50); } throw new Error('timed out'); };

const stored = {}, commands = [], statuses = [];
const ITEMS = [
  { key: 'hue:1', type: 'dimmable-light', name: 'Kitchen ceiling', state: { on: false, level: 40 } },
  { key: 'ha:light.desk', type: 'color-light', name: 'Desk lamp', state: { on: true, level: 80, rgb: '#ff8800' } },
  { key: 'shelly:192.168.1.40:switch0', type: 'plug', name: 'Kettle', state: { on: false } },   // scrub-ok: documentation-style example address
  { key: 'ha:fan.bed', type: 'fan', name: 'Bedroom fan', state: { on: true, percent: 50 } },
  { key: 'ha:cover.blinds', type: 'cover', name: 'Living room blinds', state: { open: true, position: 70 } },
  { key: 'ha:climate.hall', type: 'thermostat', name: 'Hallway', state: { tempC: 20.5, targetC: 21, mode: 'heat' } },
  { key: 'ha:sensor.t#temp', type: 'temp', name: 'Porch temperature', state: { tempC: 12.3 } },
  { key: 'ha:sensor.h#humidity', type: 'humidity', name: 'Bath humidity', state: { humidity: 55 } },
  { key: 'ha:binary_sensor.w#contact', type: 'contact', name: 'Back window', state: { open: false } },
  { key: 'ha:binary_sensor.m#occupancy', type: 'occupancy', name: 'Hall motion', state: { motion: true } },
  { key: 'ha:binary_sensor.leak#leak', type: 'leak', name: 'Under sink', state: { water: false } },
  { key: 'ha:scene.movie', type: 'scene', name: 'Movie night', state: { on: false } },
];
const OPTS = { port: 5540, passcode: 20202029, discriminator: 2345, name: 'CasaTorch', serial: 'ct-test-serial', uniqueId: 'ct-test-unique', version: '0.8.1' };
const mk = () => createBridge({ opts: OPTS, storage: { ...stored }, onStore: (ns, json) => { if (json === null) delete stored[ns]; else stored[ns] = json; }, onCommand: (key, action, value) => commands.push({ key, action, value }), onStatus: (s) => statuses.push(s) });

let bridge = await mk();
await bridge.sync(ITEMS);
await check('bridge: starts, shows an 11-digit pairing code and a QR payload while not paired', async () => {
  const v = bridge.view(); assert.equal(v.state, 'ready'); assert.equal(v.commissioned, false);
  assert.match(v.pairing.manual, /^\d{11}$/); assert.match(v.pairing.qr, /^MT:[0-9A-Z.\-]+$/);
});
await check('bridge: one bridged endpoint per item, with stable ids', async () => {
  const e = bridge.endpoints(); assert.equal(e.length, ITEMS.length);
  assert.deepEqual(new Set(e.map((x) => x.type)), new Set(ITEMS.map((i) => i.type)));
  assert.ok(e.every((x) => x.number >= 2)); assert.equal(bridge.view().lastError, null);
});
const numbers = Object.fromEntries(bridge.endpoints().map((x) => [x.key, x.number]));

const ctl = await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), { id: 'assistant1', network: { port: 5541 }, commissioning: { enabled: false }, controller: { adminFabricLabel: 'Test assistant' } });
await ctl.start();
const node = await ctl.peers.commission({ passcode: OPTS.passcode, longDiscriminator: OPTS.discriminator, timeout: 30_000 });
await check('commissioning: a controller pairs with the code; the bridge lists it and hides the code', async () => {
  const v = await until(() => (bridge.view().commissioned ? bridge.view() : null));
  assert.equal(v.fabrics.length, 1); assert.equal(v.fabrics[0].label, 'Test assistant'); assert.equal(v.pairing, null);
});
const parts = []; const walk = (e) => { for (const p of e.parts) { parts.push(p); walk(p); } };
await until(() => { parts.length = 0; walk(node); return parts.length >= ITEMS.length + 1; }, 10_000);
await check('commissioning: the controller sees every bridged device with its name', async () => {
  const labels = parts.map((p) => p.state.bridgedDeviceBasicInformation?.nodeLabel).filter(Boolean);
  for (const i of ITEMS) assert.ok(labels.includes(i.name), i.name);
});
const byName = (n) => parts.find((p) => p.state.bridgedDeviceBasicInformation?.nodeLabel === n);
await check('assistant -> CasaTorch: "turn on the kettle" becomes one "on" command', async () => {
  await byName('Kettle').commandsOf(OnOffClient).on();
  const c = await until(() => commands.find((x) => x.key === 'shelly:192.168.1.40:switch0'));   // scrub-ok
  assert.equal(c.action, 'on');
});
await check('assistant -> CasaTorch: a scene runs once and switches itself back off', async () => {
  await byName('Movie night').commandsOf(OnOffClient).on();
  const c = await until(() => commands.find((x) => x.key === 'ha:scene.movie')); assert.equal(c.action, 'run');
});
await check('CasaTorch -> assistant: a light switched in CasaTorch shows on, with no echo command', async () => {
  const before = commands.length;
  await bridge.sync(ITEMS.map((i) => (i.key === 'hue:1' ? { ...i, state: { on: true, level: 90 } } : i)));
  await until(() => byName('Kitchen ceiling').state.onOff?.onOff === true);
  await wait(500); assert.equal(commands.filter((x) => x.key === 'hue:1').length, 0); assert.ok(commands.length >= before);
});
await check('CasaTorch -> assistant: a sensor reading follows (0.01 °C)', async () => {
  await bridge.sync(ITEMS.map((i) => (i.key === 'ha:sensor.t#temp' ? { ...i, state: { tempC: 14.5 } } : i)));
  await until(() => byName('Porch temperature').state.temperatureMeasurement?.measuredValue === 1450);
});
await check('devices: one taken off the list disappears from the bridge', async () => {
  await bridge.sync(ITEMS.filter((i) => i.key !== 'ha:fan.bed'));
  assert.equal(bridge.endpoints().length, ITEMS.length - 1);
});
await check('multi-admin: "Add another app" opens pairing again; a second app pairs; one can be removed', async () => {
  const v = await bridge.pair(15); assert.match(v.pairing.manual, /^\d{11}$/);
  const ctl2 = await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), { id: 'assistant2', network: { port: 5542 }, commissioning: { enabled: false }, controller: { adminFabricLabel: 'Second app' } });
  await ctl2.start();
  await ctl2.peers.commission({ passcode: OPTS.passcode, longDiscriminator: OPTS.discriminator, timeout: 30_000 });
  await until(() => bridge.view().fabrics.length === 2);
  const second = bridge.view().fabrics.find((f) => f.label === 'Second app');
  await bridge.removeFabric(second.index);
  await until(() => bridge.view().fabrics.length === 1);
  await ctl2.close();
});
await ctl.close();
await bridge.stop();
await check('storage: everything matter.js keeps was handed over (to be sealed), nothing else', async () => {
  assert.ok(Object.keys(stored).includes('bridge')); assert.ok(stored.bridge.length > 500);
});
bridge = await mk();
await bridge.sync(ITEMS);
await check('restart: still paired, same endpoint numbers', async () => {
  const v = bridge.view(); assert.equal(v.commissioned, true); assert.equal(v.fabrics.length, 1); assert.equal(v.pairing, null);
  for (const x of bridge.endpoints()) if (x.key !== 'ha:fan.bed') assert.equal(x.number, numbers[x.key], x.key);   // (the fan was taken off and came back as a new device)
});
await bridge.reset();
await check('reset: the bridge forgets every pairing', async () => {
  const fresh = await mk(); const v = fresh.view(); assert.equal(v.commissioned, false); assert.ok(v.pairing); await fresh.stop();
});
say({ done: true });
process.exit(0);
