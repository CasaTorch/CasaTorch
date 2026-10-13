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
/** walls: [x0, z0, x1, z1] centre lines; 0.12 m thick, 2.5 m high, on a slab. */
function floorGlb(w, d, walls) {
  const P = [], N = [], I = [];
  box(P, N, I, [0, -0.1, 0], [w, 0, d]);
  for (const [ax, az, bx, bz] of walls) {
    const t = 0.06;
    box(P, N, I, [Math.min(ax, bx) - (ax === bx ? t : 0), 0, Math.min(az, bz) - (az === bz ? t : 0)], [Math.max(ax, bx) + (ax === bx ? t : 0), 2.5, Math.max(az, bz) + (az === bz ? t : 0)]);
  }
  const pos = new Float32Array(P), nor = new Float32Array(N), idx = new Uint32Array(I);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(nor.buffer), Buffer.from(idx.buffer)]);
  const min = [0, -0.1, 0], max = [w, 2.5, d];
  const gltf = { asset: { version: '2.0', generator: 'HouseOS demo' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'house' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.87, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.byteLength + nor.byteLength, byteLength: idx.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5126, count: N.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5125, count: I.length, type: 'SCALAR' }] };
  let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
  return Buffer.concat([header, ch(json.length, 'JSON'), json, ch(binPad.length, 'BIN\0'), binPad]);
}
// Ground floor 12 x 9 m: living, kitchen, garage, hall. Upstairs: three bedrooms, bath.
const outer = (w, d) => [[0, 0, w, 0], [w, 0, w, d], [w, d, 0, d], [0, d, 0, 0]];
fs.writeFileSync(path.join(out, 'demo-ground.glb'), floorGlb(12, 9, [...outer(12, 9), [7, 0, 7, 5.5], [0, 5.5, 4, 5.5], [5.5, 5.5, 12, 5.5], [4, 5.5, 4, 9]]));
fs.writeFileSync(path.join(out, 'demo-upstairs.glb'), floorGlb(12, 9, [...outer(12, 9), [4, 0, 4, 4.5], [8, 0, 8, 4.5], [0, 4.5, 5, 4.5], [6.5, 4.5, 12, 4.5], [8, 4.5, 8, 9]]));
fs.writeFileSync(path.join(out, 'floorplan.json'), JSON.stringify({
  floors: [{ id: 'ground', name: 'Ground floor', file: 'demo-ground.glb', level: 0, heightM: 2.8, rotationY: 0, scale: 1, offset: [0, 0] }, { id: 'upstairs', name: 'Upstairs', file: 'demo-upstairs.glb', level: 1, heightM: 2.8, rotationY: 0, scale: 1, offset: [0, 0] }],
  pins: [
    { deviceId: 'hue:1', floor: 'ground', pos: [3.5, 2.2, 2.5] }, { deviceId: 'hue:2', floor: 'ground', pos: [9.5, 2.2, 2.5] }, { deviceId: 'ha:media_player.living_room', floor: 'ground', pos: [1.2, 0.9, 1] },
    { deviceId: 'shelly:fridge', floor: 'ground', pos: [11.3, 0.8, 4.6] }, { deviceId: 'ha:binary_sensor.front_door', floor: 'ground', pos: [5.5, 1.2, 9] }, { deviceId: 'camera:porch', floor: 'ground', pos: [6.5, 2.3, 9.2] },
    { deviceId: 'yolink:leak1', floor: 'ground', pos: [10.5, 0.1, 7.5] }, { deviceId: 'hue:3', floor: 'upstairs', pos: [2, 2.2, 2] }, { deviceId: 'ha:media_player.bedroom', floor: 'upstairs', pos: [10, 1, 2] },
    { deviceId: 'shelly:office', floor: 'upstairs', pos: [10.5, 0.8, 7] }, { deviceId: 'ha:climate.thermostat', floor: 'ground', pos: [4.2, 1.5, 6] },
  ] }, null, 2));
fs.writeFileSync(path.join(out, 'devices.json'), JSON.stringify([
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
