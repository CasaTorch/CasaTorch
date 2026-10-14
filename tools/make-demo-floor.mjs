#!/usr/bin/env node
/*
 * Makes the demo house's floors (demo/floorplan/*.glb): simple walls and a floor
 * slab per level, so demo mode and screenshots have a 3D plan without anyone's
 * real scan. A real plan comes from a LiDAR scan exported as .glb.
 *   node tools/make-demo-floor.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'demo', 'floorplan');
fs.mkdirSync(out, { recursive: true });

function box(P, N, I, [x0, y0, z0], [x1, y1, z1]) {
  const faces = [ // normal, 4 corners
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]], [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]], [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
  ];
  for (const [n, c] of faces) { const b = P.length / 3; for (const v of c) { P.push(...v); N.push(...n); } I.push(b, b + 1, b + 2, b, b + 2, b + 3); }
}
/** walls: [x0, z0, x1, z1] centre lines; 0.12 m thick, 2.5 m high, on a slab. Furniture: { Name0: [min, max] }.
    Every part is its own named node, the way Apple RoomPlan names them (Floor0, Wall3, Sofa0...), so
    HouseOS styles walls, floors and furniture separately. */
function floorGlb(w, d, walls, furniture = {}) {
  const parts = [['Floor0', [[[0, -0.1, 0], [w, 0, d]]]]];
  walls.forEach(([ax, az, bx, bz], i) => { const t = 0.06; parts.push([`Wall${i}`, [[[Math.min(ax, bx) - (ax === bx ? t : 0), 0, Math.min(az, bz) - (az === bz ? t : 0)], [Math.max(ax, bx) + (ax === bx ? t : 0), 2.5, Math.max(az, bz) + (az === bz ? t : 0)]]]]); });
  for (const [name, bx] of Object.entries(furniture)) parts.push([name, [bx]]);
  const bufs = [], views = [], accessors = [], meshes = [], nodes = [];
  let off = 0;
  const add = (arr, target) => { const b = Buffer.from(arr.buffer); views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target }); bufs.push(b); off += b.length; return views.length - 1; };
  for (const [name, boxes] of parts) {
    const P = [], N = [], I = [];
    for (const [lo, hi] of boxes) box(P, N, I, lo, hi);
    const xs = [0, 1, 2].map((k) => P.filter((_, j) => j % 3 === k));
    const pv = add(new Float32Array(P), 34962), nv = add(new Float32Array(N), 34962), iv = add(new Uint32Array(I), 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: P.length / 3, type: 'VEC3', min: xs.map((a) => Math.min(...a)), max: xs.map((a) => Math.max(...a)) }, { bufferView: nv, componentType: 5126, count: N.length / 3, type: 'VEC3' }, { bufferView: iv, componentType: 5125, count: I.length, type: 'SCALAR' });
    const a0 = accessors.length - 3;
    meshes.push({ name, primitives: [{ attributes: { POSITION: a0, NORMAL: a0 + 1 }, indices: a0 + 2, material: 0 }] });
    nodes.push({ name, mesh: meshes.length - 1 });
  }
  const bin = Buffer.concat(bufs);
  const gltf = { asset: { version: '2.0', generator: 'HouseOS demo' }, scene: 0, scenes: [{ nodes: [nodes.length] }], nodes: [...nodes, { name: 'house', children: nodes.map((_, i) => i) }], meshes,
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.87, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    buffers: [{ byteLength: bin.length }], bufferViews: views, accessors };
  let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
  return Buffer.concat([header, ch(json.length, 'JSON'), json, ch(binPad.length, 'BIN\0'), binPad]);
}
// Ground floor 12 x 9 m: living, kitchen, garage, hall. Upstairs: three bedrooms, bath.
const outer = (w, d) => [[0, 0, w, 0], [w, 0, w, d], [w, d, 0, d], [0, d, 0, 0]];
fs.writeFileSync(path.join(out, 'demo-ground.glb'), floorGlb(12, 9, [...outer(12, 9), [7, 0, 7, 5.5], [0, 5.5, 4, 5.5], [5.5, 5.5, 12, 5.5], [4, 5.5, 4, 9]], {
  Sofa0: [[1, 0, 0.5], [4, 0.8, 1.4]], CoffeeTable0: [[1.8, 0, 2.1], [3.2, 0.45, 3]], Storage0: [[6.45, 0, 1.6], [6.9, 0.5, 3.6]], Television0: [[6.75, 0.5, 1.8], [6.85, 1.25, 3.4]],
  Storage1: [[7.2, 0, 0.1], [11.9, 0.9, 0.7]], Refrigerator0: [[11.1, 0, 4], [11.9, 1.9, 4.9]], DiningTable0: [[8.5, 0, 2.2], [10.5, 0.75, 3.4]],
  Desk0: [[0.2, 0, 6], [1, 0.75, 7.6]], Chair0: [[1.2, 0, 6.5], [1.7, 0.9, 7]], Washer0: [[11, 0, 7.2], [11.8, 0.9, 8]], Dryer0: [[11, 0, 8.05], [11.8, 0.9, 8.85]] }));
fs.writeFileSync(path.join(out, 'demo-upstairs.glb'), floorGlb(12, 9, [...outer(12, 9), [4, 0, 4, 4.5], [8, 0, 8, 4.5], [0, 4.5, 5, 4.5], [6.5, 4.5, 12, 4.5], [8, 4.5, 8, 9]], {
  Bed0: [[0.5, 0, 0.5], [2.5, 0.55, 2.6]], Bed1: [[4.6, 0, 0.5], [6.6, 0.55, 2.6]], Bed2: [[8.6, 0, 0.5], [10.6, 0.55, 2.6]], Desk1: [[10.4, 0, 6.4], [11.8, 0.75, 7.4]], Storage2: [[0.2, 0, 5], [0.8, 2, 7]] }));
fs.writeFileSync(path.join(out, 'floorplan.json'), JSON.stringify({
  floors: [{ id: 'ground', name: 'Ground floor', file: 'demo-ground.glb', level: 0, heightM: 2.8, rotationY: 0, scale: 1, offset: [0, 0], rooms: [{"name": "Living room", "color": "#38bdf8", "pos": [3.5, 2.75]}, {"name": "Kitchen", "color": "#fbbf24", "pos": [9.5, 2.75]}, {"name": "Office", "color": "#a78bfa", "pos": [2, 7.25]}, {"name": "Hall", "color": "#34d399", "pos": [8, 7.25]}] }, { id: 'upstairs', name: 'Upstairs', file: 'demo-upstairs.glb', level: 1, heightM: 2.8, rotationY: 0, scale: 1, offset: [0, 0], rooms: [{"name": "Bedroom 1", "color": "#f472b6", "pos": [2, 2.25]}, {"name": "Bedroom 2", "color": "#a78bfa", "pos": [6, 2.25]}, {"name": "Bedroom 3", "color": "#38bdf8", "pos": [10, 2.25]}, {"name": "Landing", "color": "#34d399", "pos": [4, 6.75]}, {"name": "Study", "color": "#22d3ee", "pos": [10, 6.75]}] }],
  style: { theme: 'neon', colors: {} },
  pins: [
    { deviceId: 'hue:1', floor: 'ground', pos: [3.5, 2.2, 2.5] }, { deviceId: 'hue:2', floor: 'ground', pos: [9.5, 2.2, 2.5] }, { deviceId: 'ha:media_player.living_room', floor: 'ground', pos: [1.2, 0.9, 1] },
    { deviceId: 'shelly:fridge', floor: 'ground', pos: [11.3, 0.8, 4.6] }, { deviceId: 'ha:binary_sensor.front_door', floor: 'ground', pos: [5.5, 1.2, 9] }, { deviceId: 'camera:porch', floor: 'ground', pos: [6.5, 2.3, 9.2] },
    { deviceId: 'yolink:leak1', floor: 'ground', pos: [10.5, 0.1, 7.5] }, { deviceId: 'hue:3', floor: 'upstairs', pos: [2, 2.2, 2] }, { deviceId: 'ha:media_player.bedroom', floor: 'upstairs', pos: [10, 1, 2] },
    { deviceId: 'shelly:office', floor: 'upstairs', pos: [10.5, 0.8, 7] }, { deviceId: 'ha:climate.thermostat', floor: 'ground', pos: [4.2, 1.5, 6] },
  ] }, null, 2));
if (!fs.existsSync(path.join(out, 'devices.json'))) fs.writeFileSync(path.join(out, 'devices.json'), JSON.stringify([  // the demo's device list has grown by hand since; never overwrite it

  { id: 'hue:1', provider: 'hue', kind: 'light', name: 'Living room', on: true, brightness: 80, online: true },
  { id: 'hue:2', provider: 'hue', kind: 'light', name: 'Kitchen', on: false, online: true },
  { id: 'hue:3', provider: 'hue', kind: 'light', name: 'Bedroom 1', on: true, brightness: 30, online: true },
  { id: 'ha:media_player.living_room', provider: 'ha', kind: 'media', name: 'Living room speaker', on: true, playing: true, title: 'Fleetwood Mac - Dreams', online: true },
  { id: 'ha:media_player.bedroom', provider: 'ha', kind: 'media', name: 'Bedroom TV', on: false, playing: false, online: true },
  { id: 'shelly:fridge', provider: 'shelly', kind: 'plug', name: 'Fridge', on: true, powerW: 96, online: true },
  { id: 'shelly:office', provider: 'shelly', kind: 'plug', name: 'Office desk', on: true, powerW: 142, online: true },
  { id: 'ha:binary_sensor.front_door', provider: 'ha', kind: 'sensor', name: 'Front door', open: false, online: true },
  { id: 'camera:porch', provider: 'camera', kind: 'camera', name: 'Porch', online: true },
  { id: 'yolink:leak1', provider: 'yolink', kind: 'sensor', name: 'Laundry leak sensor', water: false, battery: 80, online: true },
  { id: 'ha:climate.thermostat', provider: 'ha', kind: 'climate', name: 'Thermostat', mode: 'heat', tempC: 20.5, target: 21, online: true },
], null, 2));
console.log('demo floor plan written to', out);
