/* ======================================================================
 * Voice assistants: CasaTorch as a Matter bridge (matter.js, Apache-2.0).
 *
 * One Matter "bridge" with a bridged device for each light, switch, plug,
 * fan, blind, thermostat, sensor and scene CasaTorch shares, so Amazon
 * Alexa, Google Home, Apple Home and SmartThings can all see and switch
 * them at once. It runs in a child process of CasaTorch (79v-voice.js):
 * a problem in Matter (no IPv6, a port in use, no multicast) never takes
 * the dashboard down, and it can be started again by itself.
 *
 * It knows nothing about devices beyond what CasaTorch sends it ("items",
 * already filtered by the safety rule: never a lock, garage door, gate or
 * alarm), and it changes nothing itself: a command from an assistant goes
 * back to CasaTorch as { key, action, value }, which checks it again and
 * uses the same control path as the app.
 *
 * Storage: matter.js keeps the bridge's keys and pairings in a key/value
 * store. Here that store lives in memory and every change is handed to
 * CasaTorch, which seals it (the box's key) into the data folder. Nothing
 * of it is written in plain text.
 *
 * Messages (child process, IPC):
 *   in:  { t: 'start', opts, storage }  { t: 'items', items }  { t: 'pair' }
 *        { t: 'remove-fabric', index }  { t: 'reset' }  { t: 'stop' }
 *   out: { t: 'status', status }  { t: 'store', ns, json }  { t: 'cmd', key, action, value }
 *        { t: 'fatal', error, code }
 * ====================================================================== */
import crypto from 'node:crypto';

const NAME_MAX = 32;
const short = (s, n = NAME_MAX) => { const t = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim(); return t.length > n ? t.slice(0, n).trim() : t; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/* A stable endpoint id: the same CasaTorch device keeps its Matter endpoint number across restarts. */
const epId = (key, type) => `ct${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 20)}${type.replace(/[^a-z]/g, '')}`;

/* ---- colors: Matter speaks hue/saturation, xy and mireds; CasaTorch speaks #rrggbb and kelvin ---- */
function hsToHex(h254, s254) {
  const h = (h254 / 254) * 360, s = s254 / 254, v = 1, c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((u) => Math.round((u + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
function hexToHs(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { hue: Math.round((h / 360) * 254), sat: Math.round((mx ? d / mx : 0) * 254) };
}
function xyToHex(x65535, y65535) {
  const x = x65535 / 65535, y = Math.max(1e-6, y65535 / 65535), Y = 1, X = (Y / y) * x, Z = (Y / y) * (1 - x - y);
  let [r, g, b] = [X * 1.656492 - Y * 0.354851 - Z * 0.255038, -X * 0.707196 + Y * 1.655397 + Z * 0.036152, X * 0.051713 - Y * 0.121364 + Z * 1.011530];
  const gam = (u) => (u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055);
  [r, g, b] = [r, g, b].map((u) => Math.max(0, gam(u))); const mx = Math.max(r, g, b, 1e-6);
  return `#${[r, g, b].map((u) => Math.round(clamp(u / mx, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/* ---- what an item looks like as Matter attributes (CasaTorch -> Matter) ---- */
const LEVEL = (pct) => clamp(Math.round((num(pct) ?? 100) * 2.54), 1, 254);
const PCT = (level) => clamp(Math.round((Number(level) / 254) * 100), 1, 100);
const C100 = (c) => (num(c) == null ? null : Math.round(Number(c) * 100));
const SYSTEM_MODE = { off: 0, auto: 1, heat_cool: 1, cool: 3, heat: 4, fan_only: 7, dry: 8 };
const FROM_SYSTEM_MODE = { 0: 'off', 1: 'auto', 3: 'cool', 4: 'heat', 7: 'fan_only', 8: 'dry' };
function attrsOf(item) {
  const s = item.state || {}, on = !!s.on;
  switch (item.type) {
    case 'onoff-light': case 'plug': case 'scene': return { onOff: { onOff: on } };
    case 'dimmable-light': return { onOff: { onOff: on }, levelControl: { currentLevel: LEVEL(s.level) } };
    case 'ct-light': {
      const out = { onOff: { onOff: on }, levelControl: { currentLevel: LEVEL(s.level) } };
      if (num(s.kelvin)) out.colorControl = { colorTemperatureMireds: clamp(Math.round(1e6 / s.kelvin), 153, 500) };
      return out;
    }
    case 'color-light': {
      const out = { onOff: { onOff: on }, levelControl: { currentLevel: LEVEL(s.level) } }, hs = hexToHs(s.rgb);
      if (hs && !num(s.kelvin)) out.colorControl = { currentHue: hs.hue, currentSaturation: hs.sat, colorMode: 0 };
      else if (num(s.kelvin)) out.colorControl = { colorTemperatureMireds: clamp(Math.round(1e6 / s.kelvin), 153, 500), colorMode: 2 };
      return out;
    }
    case 'fan': {
      const p = num(s.percent) ?? (on ? 100 : 0), pct = on ? clamp(Math.round(p), 1, 100) : 0;
      return { fanControl: { percentCurrent: pct, percentSetting: pct, fanMode: !on ? 0 : pct <= 33 ? 1 : pct <= 66 ? 2 : 3 } };
    }
    case 'cover': {
      const open = num(s.position) ?? (s.open ? 100 : 0), closed100ths = clamp(Math.round((100 - open) * 100), 0, 10000);
      return { windowCovering: { currentPositionLiftPercent100ths: closed100ths, targetPositionLiftPercent100ths: closed100ths } };
    }
    case 'thermostat': {
      const t = {}; const cur = C100(s.tempC), target = C100(s.targetC);
      if (cur != null) t.localTemperature = cur;
      if (target != null) { t.occupiedHeatingSetpoint = clamp(target, 700, 3000); t.occupiedCoolingSetpoint = clamp(target, 1600, 3200); }
      if (s.mode && SYSTEM_MODE[s.mode] != null) t.systemMode = SYSTEM_MODE[s.mode];
      return { thermostat: t };
    }
    case 'temp': return { temperatureMeasurement: { measuredValue: C100(s.tempC) } };
    case 'humidity': return { relativeHumidityMeasurement: { measuredValue: num(s.humidity) == null ? null : clamp(Math.round(s.humidity * 100), 0, 10000) } };
    case 'contact': return { booleanState: { stateValue: !s.open } };   // Matter: true = contact (closed)
    case 'leak': return { booleanState: { stateValue: !!s.water } };
    case 'occupancy': return { occupancySensing: { occupancy: { occupied: !!s.motion } } };
    default: return {};
  }
}

/* ---- the bridge ---- */
export async function createBridge({ opts, storage = {}, onStore = () => {}, onCommand = () => {}, onStatus = () => {}, network = null }) {
  const M = await import('@matter/main');
  const { Endpoint, Environment, ServerNode, VendorId, StorageService, MemoryStorageDriver, Network, toJson, fromJson } = M;
  const [{ BridgedDeviceBasicInformationServer }, { AggregatorEndpoint }, { DeviceCommissioner, FabricManager }] = await Promise.all([
    import('@matter/main/behaviors/bridged-device-basic-information'), import('@matter/main/endpoints/aggregator'), import('@matter/main/protocol')]);
  const D = Object.fromEntries(await Promise.all(['on-off-light', 'dimmable-light', 'color-temperature-light', 'extended-color-light', 'on-off-plug-in-unit', 'fan', 'window-covering', 'thermostat', 'temperature-sensor', 'humidity-sensor', 'contact-sensor', 'water-leak-detector', 'occupancy-sensor']
    .map(async (n) => [n, await import(`@matter/main/devices/${n}`)])));
  const [{ WindowCoveringServer }, { ThermostatServer }, { ColorControlServer }, { OccupancySensingServer }] = await Promise.all([
    import('@matter/main/behaviors/window-covering'), import('@matter/main/behaviors/thermostat'), import('@matter/main/behaviors/color-control'), import('@matter/main/behaviors/occupancy-sensing')]);
  const BI = BridgedDeviceBasicInformationServer;
  const TYPES = {
    'onoff-light': D['on-off-light'].OnOffLightDevice.with(BI),
    'dimmable-light': D['dimmable-light'].DimmableLightDevice.with(BI),
    'ct-light': D['color-temperature-light'].ColorTemperatureLightDevice.with(BI),
    'color-light': D['extended-color-light'].ExtendedColorLightDevice.with(BI, ColorControlServer.with('HueSaturation', 'Xy', 'ColorTemperature')),
    plug: D['on-off-plug-in-unit'].OnOffPlugInUnitDevice.with(BI),
    scene: D['on-off-plug-in-unit'].OnOffPlugInUnitDevice.with(BI),
    fan: D.fan.FanDevice.with(BI),
    cover: D['window-covering'].WindowCoveringDevice.with(BI, WindowCoveringServer.with('Lift', 'PositionAwareLift')),
    thermostat: D.thermostat.ThermostatDevice.with(BI, ThermostatServer.with('Heating', 'Cooling')),
    temp: D['temperature-sensor'].TemperatureSensorDevice.with(BI),
    humidity: D['humidity-sensor'].HumiditySensorDevice.with(BI),
    contact: D['contact-sensor'].ContactSensorDevice.with(BI),
    leak: D['water-leak-detector'].WaterLeakDetectorDevice.with(BI),
    occupancy: D['occupancy-sensor'].OccupancySensorDevice.with(BI, OccupancySensingServer.with('PassiveInfrared')),
  };
  const EXTRA = {   // attributes a type needs at the start
    fan: { fanControl: { fanModeSequence: 0, fanMode: 0, percentSetting: 0, percentCurrent: 0 } },
    thermostat: { thermostat: { controlSequenceOfOperation: 4, systemMode: 4, localTemperature: 2000, occupiedHeatingSetpoint: 2000, occupiedCoolingSetpoint: 2400 } },
    occupancy: { occupancySensing: { occupancySensorType: 0, occupancySensorTypeBitmap: { pir: true } } },
    cover: { windowCovering: { type: 0, endProductType: 0 } },
    'ct-light': { colorControl: { colorTemperatureMireds: 370, colorTempPhysicalMinMireds: 153, colorTempPhysicalMaxMireds: 500, coupleColorTempToLevelMinMireds: 153, startUpColorTemperatureMireds: null } },
    'color-light': { colorControl: { colorTemperatureMireds: 370, colorTempPhysicalMinMireds: 153, colorTempPhysicalMaxMireds: 500, coupleColorTempToLevelMinMireds: 153, startUpColorTemperatureMireds: null } },
  };

  /* Storage: in memory, every change handed to CasaTorch to seal. */
  const data = {}; for (const [ns, json] of Object.entries(storage || {})) { try { data[ns] = fromJson(json); } catch { /* damaged: start that part afresh */ } }
  const flushT = {};
  class CasaTorchStore extends MemoryStorageDriver {
    static id = 'casatorch-sealed';
    static create(ns) { const name = String(ns?.namespace || ns || 'bridge'); const d = new CasaTorchStore(data[name] ||= {}); d.ns = name; d.initialize(); return d; }
    flush() { clearTimeout(flushT[this.ns]); const ns = this.ns, store = this.store; flushT[ns] = setTimeout(() => { try { onStore(ns, toJson(store)); } catch { /* next change */ } }, 150); }
    set(c, k, v) { super.set(c, k, v); this.flush(); }
    delete(c, k) { super.delete(c, k); this.flush(); }
    clearAll(c) { super.clearAll(c); this.flush(); }
  }
  const flushAll = () => { for (const [ns, store] of Object.entries(data)) { clearTimeout(flushT[ns]); try { onStore(ns, toJson(store)); } catch { /* */ } } };

  const env = Environment.default;
  if (network) env.set(Network, network);
  env.vars.set('log.level', process.env.CASATORCH_MATTER_LOG || 'error');   // never "notice": that level prints the pairing code
  if (opts.storageDir) env.vars.set('storage.path', opts.storageDir);
  if (opts.iface) env.vars.set('mdns.networkInterface', opts.iface);
  const ss = env.get(StorageService); ss.registerDriver(CasaTorchStore); ss.configuredDriver = CasaTorchStore.id;

  const server = await ServerNode.create({
    id: 'bridge',
    network: { port: opts.port || 5540 },
    commissioning: { passcode: opts.passcode, discriminator: opts.discriminator },
    productDescription: { name: short(opts.name || 'CasaTorch'), deviceType: AggregatorEndpoint.deviceType },
    basicInformation: { vendorName: 'CasaTorch', vendorId: VendorId(0xfff1), productName: 'CasaTorch Bridge', productLabel: 'Home bridge', productId: 0x8000, nodeLabel: short(opts.name || 'CasaTorch'),
      serialNumber: short(opts.serial), uniqueId: short(opts.uniqueId), hardwareVersion: 1, hardwareVersionString: '1', softwareVersion: Number(opts.versionNumber) || 1, softwareVersionString: short(opts.version || '1', 64) },
  });
  const agg = new Endpoint(AggregatorEndpoint, { id: 'devices' });
  await server.add(agg);

  const eps = new Map();   // key -> { ep, type, item, sent }
  const timers = new Map();
  const later = (key, ms, fn) => { clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, ms)); };
  /* An assistant changed something: tell CasaTorch (only for changes from a controller, never our own updates). */
  const remote = (ctx) => ctx && ctx.offline !== true;
  const cmd = (key, action, value) => { try { onCommand(key, action, value); } catch { /* */ } };
  function wire(key, type, ep) {
    const E = ep.events;
    if (E.onOff) E.onOff.onOff$Changed.on((v, _o, ctx) => {
      if (!remote(ctx)) return;
      if (type === 'scene') { if (v) { cmd(key, 'run'); setTimeout(() => ep.set({ onOff: { onOff: false } }).catch(() => {}), 1500); } return; }
      cmd(key, v ? 'on' : 'off');
    });
    if (E.levelControl) E.levelControl.currentLevel$Changed.on((v, _o, ctx) => { if (remote(ctx) && v != null) later(`${key}#level`, 350, () => cmd(key, 'brightness', PCT(v))); });
    if (E.colorControl) {
      const c = E.colorControl, st = () => ep.state.colorControl;
      c.colorTemperatureMireds$Changed?.on((v, _o, ctx) => { if (remote(ctx) && v) later(`${key}#color`, 350, () => cmd(key, 'kelvin', Math.round(1e6 / v))); });
      const hs = (_v, _o, ctx) => { if (remote(ctx)) later(`${key}#color`, 350, () => cmd(key, 'color', hsToHex(st().currentHue, st().currentSaturation))); };
      c.currentHue$Changed?.on(hs); c.currentSaturation$Changed?.on(hs);
      const xy = (_v, _o, ctx) => { if (remote(ctx)) later(`${key}#color`, 350, () => cmd(key, 'color', xyToHex(st().currentX, st().currentY))); };
      c.currentX$Changed?.on(xy); c.currentY$Changed?.on(xy);
    }
    if (E.fanControl) {
      E.fanControl.percentSetting$Changed.on((v, _o, ctx) => { if (remote(ctx) && v != null) later(`${key}#fan`, 300, () => cmd(key, v ? 'percent' : 'off', v || undefined)); });
      E.fanControl.fanMode$Changed.on((v, _o, ctx) => { if (!remote(ctx)) return; if (v === 0) later(`${key}#fan`, 300, () => cmd(key, 'off')); else if (v === 4 || v === 5) later(`${key}#fan`, 300, () => cmd(key, 'on')); });
    }
    if (E.windowCovering) E.windowCovering.targetPositionLiftPercent100ths$Changed.on((v, _o, ctx) => { if (remote(ctx) && v != null) later(`${key}#cover`, 300, () => cmd(key, 'position', clamp(Math.round(100 - v / 100), 0, 100))); });
    if (E.thermostat) {
      const sp = (v, _o, ctx) => { if (remote(ctx) && v != null) later(`${key}#target`, 400, () => cmd(key, 'target', Math.round(v / 10) / 10)); };
      E.thermostat.occupiedHeatingSetpoint$Changed.on(sp); E.thermostat.occupiedCoolingSetpoint$Changed.on(sp);
      E.thermostat.systemMode$Changed.on((v, _o, ctx) => { if (remote(ctx) && FROM_SYSTEM_MODE[v]) cmd(key, 'mode', FROM_SYSTEM_MODE[v]); });
    }
  }
  /* Only what changed is written, so assistants get one update per real change. */
  const diff = (want, have) => {
    const out = {};
    for (const [cl, attrs] of Object.entries(want)) for (const [k, v] of Object.entries(attrs)) {
      if (v === null && have?.[cl]?.[k] === undefined) continue;
      if (JSON.stringify(have?.[cl]?.[k]) !== JSON.stringify(v)) (out[cl] ||= {})[k] = v;
    }
    return out;
  };
  async function upsert(item) {
    const type = TYPES[item.type] ? item.type : null; if (!type) return;
    const cur = eps.get(item.key);
    const label = short(item.name || 'Device'), reach = item.online !== false;
    if (cur && cur.type === type) {
      const want = { ...attrsOf(item), bridgedDeviceBasicInformation: { nodeLabel: label, reachable: reach } };
      const d = diff(want, cur.ep.state); if (Object.keys(d).length) await cur.ep.set(d);
      cur.item = item; return;
    }
    if (cur) { eps.delete(item.key); await cur.ep.delete().catch(() => cur.ep.close().catch(() => {})); }
    const id = epId(item.key, type), init = { ...(EXTRA[type] || {}) };
    for (const [cl, attrs] of Object.entries(attrsOf(item))) init[cl] = { ...(init[cl] || {}), ...Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== null)) };
    const ep = new Endpoint(TYPES[type], { id, ...init,
      bridgedDeviceBasicInformation: { nodeLabel: label, productName: short(item.product || 'CasaTorch device'), productLabel: short(item.product || 'CasaTorch device', 64), vendorName: 'CasaTorch', serialNumber: id.slice(2, 22), uniqueId: id.slice(2, 22), reachable: reach } });
    await agg.add(ep);
    wire(item.key, type, ep);
    eps.set(item.key, { ep, type, item });
  }
  let syncing = Promise.resolve();
  function sync(items) {
    syncing = syncing.then(async () => {
      const want = new Map((Array.isArray(items) ? items : []).filter((i) => i && i.key && TYPES[i.type]).slice(0, opts.max || 150).map((i) => [String(i.key), i]));
      for (const [key, cur] of [...eps]) if (!want.has(key)) { eps.delete(key); await cur.ep.delete().catch(() => cur.ep.close().catch(() => {})); }
      for (const item of want.values()) { try { await upsert(item); } catch (err) { status.lastError = `${item.type}: ${String(err?.message || err).slice(0, 160)}`; } }
      status.devices = eps.size; push();
    }).catch(() => {});
    return syncing;
  }

  /* ---- status: pairing code (while it can be added), who it's paired with ---- */
  const status = { state: 'starting', port: opts.port || 5540, devices: 0, lastError: null, windowUntil: null };
  const fabrics = () => {
    try { return Object.values(server.state.commissioning.fabrics || {}).map((f) => ({ index: Number(f.fabricIndex), vendorId: Number(f.rootVendorId), label: short(f.label || '', 64) })); } catch { return []; }
  };
  const view = () => {
    let commissioned = false, codes = null;
    try { commissioned = !!server.state.commissioning.commissioned; codes = server.state.commissioning.pairingCodes; } catch { /* closing */ }
    const open = !commissioned || (status.windowUntil && status.windowUntil > Date.now());
    return { ...status, commissioned, fabrics: fabrics(), pairing: open && codes ? { manual: codes.manualPairingCode, qr: codes.qrPairingCode } : null };
  };
  const push = () => { try { onStatus(view()); } catch { /* */ } };
  server.lifecycle?.commissioned?.on?.(() => { status.windowUntil = null; push(); });
  try { server.events.commissioning.fabricsChanged.on(() => { status.windowUntil = null; push(); }); } catch { /* older matter.js */ }
  try { server.events.commissioning.commissioned.on(() => push()); server.events.commissioning.decommissioned.on(() => push()); } catch { /* */ }

  await server.start();
  status.state = 'ready'; push();

  let windowT = null;
  return {
    server, sync, view, flushAll,
    endpoints: () => [...eps.entries()].map(([key, v]) => ({ key, type: v.type, number: v.ep.number, id: v.ep.id })),
    /* Add another app (multi-admin): the bridge takes a new pairing for 15 minutes, with the same code. */
    async pair(minutes = 15) {
      if (!server.state.commissioning.commissioned) return view();
      const dc = server.env.get(DeviceCommissioner);
      await dc.allowBasicCommissioning(() => { status.windowUntil = null; push(); });
      status.windowUntil = Date.now() + minutes * 60_000; clearTimeout(windowT);
      windowT = setTimeout(() => { status.windowUntil = null; dc.endCommissioning().catch?.(() => {}); push(); }, minutes * 60_000); windowT.unref?.();
      push(); return view();
    },
    async removeFabric(index) {
      const fm = server.env.get(FabricManager), f = fm.fabrics.find((x) => Number(x.fabricIndex) === Number(index));
      if (!f) throw new Error('That connection is already gone.');
      await f.delete(); push(); return view();
    },
    async stop() { clearTimeout(windowT); for (const t of timers.values()) clearTimeout(t); await syncing.catch(() => {}); await server.close().catch(() => {}); flushAll(); status.state = 'off'; },
    async reset() { clearTimeout(windowT); await server.erase().catch(() => {}); await server.close().catch(() => {}); for (const k of Object.keys(flushT)) clearTimeout(flushT[k]); for (const k of Object.keys(data)) { delete data[k]; try { onStore(k, null); } catch { /* */ } } status.state = 'off'; },
  };
}
export const _test = { attrsOf, hsToHex, hexToHs, xyToHex, epId, LEVEL, PCT };

/* ---- run as CasaTorch's child process ---- */
if (process.env.CASATORCH_MATTER_CHILD === '1' && typeof process.send === 'function') {
  let bridge = null, pendingItems = null;
  const send = (m) => { try { process.send(m); } catch { /* the parent is gone */ } };
  const plain = (err) => {   // the error and what caused it (matter.js wraps a socket error in two or three layers)
    const chain = []; for (let e = err, i = 0; e && i < 5; e = e.cause, i++) chain.push(e);
    return { error: String(err?.message || err).slice(0, 300), code: chain.map((e) => e?.code).find((c) => typeof c === 'string') || null, cause: chain.slice(1).map((e) => String(e?.message || e)).join(' / ').slice(0, 300) || null };
  };
  /* matter.js ends the process on an error nobody caught; tell CasaTorch why first. */
  process.on('uncaughtException', (err) => { send({ t: 'fatal', ...plain(err) }); setTimeout(() => process.exit(1), 50); });
  process.on('unhandledRejection', (err) => { send({ t: 'fatal', ...plain(err) }); setTimeout(() => process.exit(1), 50); });
  process.on('disconnect', () => { (bridge ? bridge.stop() : Promise.resolve()).finally(() => process.exit(0)); });
  process.on('message', async (m) => {
    try {
      if (m?.t === 'start' && !bridge) {
        const network = process.env.CASATORCH_MATTER_SIMULATE === '1' ? new (await import('@matter/main')).NetworkSimulator().addHost(1) : null;   // tests: a pretend network
        bridge = await createBridge({ network, opts: m.opts, storage: m.storage, onStore: (ns, json) => send({ t: 'store', ns, json }), onCommand: (key, action, value) => send({ t: 'cmd', key, action, value }), onStatus: (status) => send({ t: 'status', status }) });
        if (pendingItems) await bridge.sync(pendingItems);
      } else if (m?.t === 'items') { if (bridge) await bridge.sync(m.items); else pendingItems = m.items; }
      else if (m?.t === 'pair' && bridge) await bridge.pair(m.minutes || 15);
      else if (m?.t === 'remove-fabric' && bridge) await bridge.removeFabric(m.index);
      else if (m?.t === 'reset') { if (bridge) await bridge.reset(); send({ t: 'reset-done' }); setTimeout(() => process.exit(0), 50); }
      else if (m?.t === 'stop') { if (bridge) await bridge.stop(); setTimeout(() => process.exit(0), 50); }
      if (m?.id) send({ t: 'done', id: m.id, ok: true });
    } catch (err) {
      if (m?.id) send({ t: 'done', id: m.id, ok: false, ...plain(err) });
      if (m?.t === 'start') { send({ t: 'fatal', ...plain(err) }); setTimeout(() => process.exit(1), 50); }
    }
  });
  send({ t: 'hello' });
}
