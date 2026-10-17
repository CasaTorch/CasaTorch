/* CasaTorch Pro - 3D Home.
   View: your floors as a solid, lit model. Rooms tint, lights glow where they are, devices show
   their state. Tap a room for its controls; switch floors, walls (tall/cut), stacking and look.
   Editor: place devices, name and color rooms, paint walls/floors/furniture, manage floors. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { openDrawer } from './floorplan-draw.js';
import './device-controls.js';   // window.CasaControls: every device's controls, shared with the dashboard
/* The scan importers (USDZ, OBJ, GLTF exporter...) load only when someone uploads a scan. */
const toGlb = async (...a) => (await import('./floorplan-import.js')).toGlb(...a);
import { Yard, AREA_KINDS, ITEM_KINDS } from './floorplan-yard.js';
import { buildRoof, PowerNet, weatherIcon, sunPosition, nightness, kelvinToHex, WeatherFx } from './floorplan-house.js';
import { THEMES, COLOR_KEYS, ROOM_COLORS, lookOf, classify, guessCats, itemOf, prettyItem, sectionRooms, makeFx, fxMaterial, MAX_GLOW, MAX_ROOMS } from './floorplan-look.js';

const S = { plan: null, live: null, mode: 'view', floorView: 'all', room: null, tool: null, sel: null, F: {}, pins: [], pinObjs: [], q: '', tab: 'devices' };
let card = null;   // the open device card: { id, o }
const PREF_KEY = 'casatorch-3d';
const prefs = { walls: 'auto', stack: 'stacked', names: true, values: false, cameras: true, roof: true, power: true, hidden: {}, theme: null, sun: true, weatherFx: true, yard: true, overlay: 'rooms', spin: false, ...(() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } })() };
if (prefs.theme === 'neon') prefs.theme = 'night';   // the old name of the dark look
if (prefs.v !== 2) Object.assign(prefs, { v: 2, walls: 'auto', roof: true, power: true, hidden: {} });   // the dollhouse view is the new default
/* View choices are kept on the CasaTorch (so every screen and every restart keeps them), with this browser's copy for an instant start. */
let prefTimer = null;
const savePrefs = () => {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* private window */ }
  clearTimeout(prefTimer); prefTimer = setTimeout(() => fetch('/api/floorplan/view', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: prefs }) }).catch(() => {}), 600);
};
const adoptServerView = (v) => { if (v && typeof v === 'object') Object.assign(prefs, v, { v: 2 }); };
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); return e; };
const api = async (url, opts = {}) => { const r = await fetch(url, opts); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j }); return j; };
const send = (url, method, body) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const toast = (t) => { const x = el('div', { class: 'toast' }, t); document.body.append(x); setTimeout(() => x.remove(), 3500); };
const proErr = (e) => toast(e.status === 402 ? 'Editing the 3D home is part of CasaTorch Pro.' : e.message);
const V3 = THREE.Vector3, deg = THREE.MathUtils.degToRad;
const fill = (node, ...kids) => { node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); return node; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- icons (simple line icons, our own) ---------- */
const PATHS = { light: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', media: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  thermo: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z', camera: 'M23 7l-7 5 7 5zM1 5h15v14H1z', door: 'M3 21h18M6 21V3h12v18M14 12h.01', drop: 'M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  fan: 'M12 10V3M14 12h7M12 14v7M10 12H3M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0', cover: 'M4 3h16M5 3v14M19 3v14M5 7h14M5 11h14M5 15h14M12 17v4', sensor: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  dot: 'M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0', close: 'M6 6l12 12M18 6L6 18', back: 'M15 18l-6-6 6-6' };
const ic = (n) => { const s = el('span', { class: 'ic' }); s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[n] || PATHS.dot}"/></svg>`; return s; };
const iconOf = (d) => d.water != null || d.kind === 'leak' ? 'drop' : d.kind === 'light' ? 'light' : ['plug', 'switch'].includes(d.kind) ? 'plug' : d.kind === 'media' ? 'media' : d.kind === 'climate' ? 'thermo' : d.kind === 'camera' ? 'camera'
  : d.kind === 'lock' ? 'lock' : d.kind === 'fan' ? 'fan' : d.kind === 'cover' ? 'cover' : d.open != null ? 'door' : d.tempC != null ? 'thermo' : d.kind === 'sensor' ? 'sensor' : 'dot';

/* ---------- scene ---------- */
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); view.append(renderer.domElement);
const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; view.append(labels.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600); camera.position.set(14, 16, 22);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 2; controls.maxDistance = 150;
const hemi = new THREE.HemisphereLight('#fff', '#000', 1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffffff', 0.6); sun.position.set(12, 30, 18); scene.add(sun); scene.add(sun.target);
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
let grid = new THREE.Group(); scene.add(grid);
/* On a wide screen the house is framed in the space right of the control panel, not behind it. */
const resize = () => { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; if (w > 900) camera.setViewOffset(w, h, -150, 0, w, h); else camera.clearViewOffset(); camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
let tween = null, wallsDirty = true, wallsAt = 0, lastT = 0, skyAt = 0, flash = 0, flashWas = 0;
controls.addEventListener('change', () => { wallsDirty = true; });
const power = new PowerNet(scene), weather = new WeatherFx(scene), yard = new Yard(scene);
const flyTo = (target, pos, ms = 750) => { tween = { t0: performance.now(), ms, ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: pos }; };
(function loop(now) {
  requestAnimationFrame(loop);
  if (document.getElementById('drawer')) return;   // drawing on top: let the 3D rest
  if (tween) { const k = Math.min(1, (now - tween.t0) / tween.ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; controls.target.lerpVectors(tween.ft, tween.tt, e); camera.position.lerpVectors(tween.fp, tween.tp, e); if (k >= 1) tween = null; }
  controls.update();
  if (wallsDirty && now - wallsAt > 120) { wallsDirty = false; wallsAt = now; for (const F of Object.values(S.F)) applyWalls(F); }
  power.tick(now / 1000);
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  flash = weather.tick(dt, now / 1000);
  if (S.plan && yard.group.visible && wxOn()) yard.wind(now / 1000, S.live?.weather?.windMs, windToward());
  if (now - skyAt > 2000 || flash || flashWas) { skyAt = now; updateSky(); } flashWas = flash;
  renderer.render(scene, camera); labels.render(scene, camera);
  if (card) card.o.element.style.zIndex = '100000';   // the open card stays above every pin
})(0);

/* ---------- look ---------- */
const curTheme = () => { const t = prefs.theme === 'blueprint' ? 'night' : prefs.theme; return THEMES[t] ? t : S.plan?.style?.theme in THEMES ? S.plan.style.theme : 'real'; };
function isReal() { return !!THEMES[curTheme()]?.real; }
/* Real life always follows the sun and shows the yard and the weather; the drawings let you choose. */
function sunOn() { return prefs.sun || isReal(); }
function yardOn() { return prefs.yard || isReal(); }
function wxOn() { return prefs.weatherFx || isReal(); }
const look = () => { const L = lookOf(curTheme(), S.plan?.style?.colors), ex = S.plan?.style?.extras || {}; return { ...L, ...(ex.flow ? { flow: ex.flow } : {}), glow: L.glow * (ex.glow || 1) * (S.glowBoost || 1) }; };
/* ---------- sun, sky and night: the house lit as it is outside right now (or at the time you pick) ---------- */
/* Real life: a sky that fades from the zenith to the horizon and follows the sun (blue by day, warm at
   sunrise and sunset, dark at night), a lawn with a little texture, and which way the wind blows. */
const skyCanvas = Object.assign(document.createElement('canvas'), { width: 2, height: 256 }), skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
function skyPaint(k, lowSun) {
  const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
  const top = mix('#3f78c8', '#4a5a96', 1 - lowSun).lerp(new THREE.Color('#03060e'), k), horizon = mix('#cfe3f3', '#f1a66e', (1 - lowSun) * 0.85).lerp(new THREE.Color('#0d1528'), k);
  const g = skyCanvas.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, `#${top.getHexString()}`); gr.addColorStop(0.62, `#${mix(top, horizon, 0.7).getHexString()}`); gr.addColorStop(1, `#${horizon.getHexString()}`);
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256); skyTex.needsUpdate = true;
  return horizon;
}
let grassT = null;
function grassTex() {
  if (grassT) return grassT;
  const c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), g = c.getContext('2d');
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = 170 + Math.random() * 85 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 3); }
  grassT = new THREE.CanvasTexture(c); grassT.wrapS = grassT.wrapT = THREE.RepeatWrapping; grassT.repeat.set(90, 90); grassT.colorSpace = THREE.SRGBColorSpace; grassT.anisotropy = 4;
  return grassT;
}
/* The wind's direction as a world vector the trees lean along: weather reports where it blows FROM (degrees from north). */
function windToward() {
  const d = S.live?.weather?.windDir; if (d == null) return new V3(1, 0, 0);
  const b = deg(d + 180), north = deg(S.plan?.settings?.northDeg || 0);
  return new V3(Math.sin(b), 0, -Math.cos(b)).applyAxisAngle(new V3(0, 1, 0), -north);
}
function updateSky() {
  const L = look(), w = S.live?.weather, theme = curTheme();
  let k = 0, el = 0.9, az = 2.4;
  if (sunOn() && w?.lat != null && w?.lon != null) { const sp = sunPosition(S.timeAt || new Date(), w.lat, w.lon); el = sp.el; az = sp.az; k = nightness(el); }
  const north = deg(S.plan?.settings?.northDeg || 0), dir = new V3(Math.sin(az) * Math.cos(Math.max(el, 0.05)), Math.sin(Math.max(el, 0.05)), -Math.cos(az) * Math.cos(Math.max(el, 0.05))).applyAxisAngle(new V3(0, 1, 0), -north);
  const B = S.sceneBox || S.houseBox, c = B ? B.getCenter(new V3()) : new V3(), R = B ? B.getSize(new V3()).length() * 0.6 + 4 : 20;
  sun.position.copy(c).add(dir.multiplyScalar(R * 2)); sun.target.position.copy(c); sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera; if (cam.right !== R) { cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.5; cam.far = R * 4; cam.updateProjectionMatrix(); }
  const lowSun = Math.min(1, Math.max(0, el / 0.45)), day = 1 - k;
  sun.color.set('#ffb36b').lerp(new THREE.Color('#ffffff'), lowSun);
  sun.intensity = sunOn() ? L.sun * 1.7 * Math.min(1, Math.max(0, Math.sin(el) * 2.4)) : L.sun;
  sun.castShadow = sunOn() && sun.intensity > 0.05;
  hemi.intensity = L.hemi[2] * (0.32 + 0.68 * day) + flash * 2.5;
  const nightMix = { day: 0.92, night: 0.55, blueprint: 0.35, real: 0.95 }[theme] ?? 0.5;
  if (L.real) { const horizon = skyPaint(k, lowSun); scene.background = skyTex; scene.fog.color.copy(horizon); if (grid.isMesh) grid.material.color.set(L.ground).multiplyScalar(0.25 + 0.75 * day); }
  else { scene.background = new THREE.Color(L.bg).lerp(new THREE.Color('#04060d'), k * nightMix); scene.fog.color.copy(scene.background); for (const m of [grid.material].flat().filter(Boolean)) { m.transparent = true; m.opacity = 1 - k * 0.75; } }
  renderer.toneMappingExposure = L.real ? 0.75 + 0.35 * day : 1;
  const boost = 1 + k * 0.9;
  if (Math.abs(boost - (S.glowBoost || 1)) > 0.05) { S.glowBoost = boost; drawPins(); }
  document.documentElement.dataset.night = k > 0.5 ? '1' : '0';
}
function applyLook() {
  const L = look();
  scene.background = new THREE.Color(L.bg); scene.fog = new THREE.Fog(L.bg, 70, 180);
  hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2]; sun.intensity = L.sun; skyAt = 0;
  const y = grid.position.y; scene.remove(grid);
  if (L.real) { grid = new THREE.Mesh(new THREE.CircleGeometry(160, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: L.ground, map: grassTex(), roughness: 1 })); grid.receiveShadow = true; }   // a lawn to the horizon
  else grid = new THREE.GridHelper(140, 140, L.grid[0], L.grid[1]);
  grid.position.y = y; scene.add(grid);
  renderer.toneMapping = L.real ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  scene.fog = L.real ? new THREE.Fog(L.bg, 60, 260) : scene.fog;
  for (const F of Object.values(S.F)) styleFloor(F);
  buildRoofs(); buildYard();
  document.documentElement.dataset.theme = curTheme();
  drawPins();
}
/* The yard sits on the ground around the lowest floor. */
const groundY = () => { const F = Object.values(S.F).sort((a, b) => (a.f.level || 0) - (b.f.level || 0))[0]; return F ? (F.f.level || 0) * (F.f.heightM || 3) + F.minY : 0; };
function buildYard() {
  yard.build(S.plan?.yard, groundY(), curTheme(), el);
  S.sceneBox = S.houseBox?.clone(); if (S.sceneBox && yard.group.children.length) S.sceneBox.union(yard.box);
  skyAt = 0;
}
function styleFloor(F) {
  if (F.original) return;
  const L = look(), M = F.mats;
  M.wall.color.set(L.wall); M.wall.opacity = L.wallOpacity; M.wall.transparent = L.wallOpacity < 1; M.wall.depthWrite = L.wallOpacity >= 1;
  M.floor.color.set(L.floor); M.floor.userData.tint.value = L.tint; M.furniture.color.set(L.furniture); M.door.color.set(L.door); M.window.color.set(L.window);
  const W = F.low; W.wall.color.set(L.wall); W.wall.opacity = L.wallOpacity; W.wall.transparent = L.wallOpacity < 1; W.wall.depthWrite = L.wallOpacity >= 1; W.door.color.set(L.door); W.window.color.set(L.window);
  for (const m of [...Object.values(M), ...Object.values(W)]) m.needsUpdate = true;
  F.edgeMat.color.set(L.edge); F.furnEdgeMat.color.set(L.furnEdge); F.doorEdge.color.set(L.door); F.edgeLow.color.set(L.edge); F.doorEdgeLow.color.set(L.door);
  for (const [key, meshes] of F.items) {
    const hex = F.f.paint?.[key];
    for (const m of meshes) {
      const cat = m.userData.cat;
      if (hex) { m.userData.own ||= Object.assign(fxMaterial({}, F.fx, cat === 'floor' ? L.tint : 0), { clippingPlanes: cat === 'floor' || cat === 'furniture' ? [] : [F.clip] }); m.userData.own.color.set(hex); m.material = m.userData.own; }
      else m.material = M[cat] || M.furniture;
      m.userData.full = m.material;
    }
  }
  applyWalls(F);
}
/* Walls: "Dollhouse" lowers the walls on the side facing you (like a cutaway drawing) and keeps the
   far ones full height; "Cut" lowers them all; "Tall" keeps them all. Follows the camera as you turn. */
const WALLISH = new Set(['wall', 'door', 'window', 'opening']);
function applyWalls(F) {
  if (F.original || !F.wallMeshes) return;
  const mode = prefs.walls, dir = camera.position.clone().sub(controls.target).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
  for (const m of F.wallMeshes) {
    const full = m.userData.full; if (!full) continue;
    let low = mode === 'cut';
    if (mode === 'auto') { const w = m.userData.wc; low = (w.x - F.center.x) * dir.x + (w.z - F.center.z) * dir.z > F.r * 0.2; }
    const want = low ? lowOf(F, m, full) : full;
    if (m.material !== want) m.material = want;
    if (m.userData.cat === 'wall') m.castShadow = !low;
    const e = m.userData.edge, door = m.userData.cat === 'door';
    if (e) e.material = low ? (door ? F.doorEdgeLow : F.edgeLow) : (door ? F.doorEdge : F.edgeMat);
  }
}
function lowOf(F, m, full) {
  const cat = m.userData.cat;
  if (full === F.mats[cat] && F.low[cat]) return F.low[cat];
  m.userData.ownLow ||= Object.assign(fxMaterial({}, F.fx), { clippingPlanes: [F.clipLow] });
  m.userData.ownLow.color.copy(full.color); return m.userData.ownLow;
}

/* ---------- floors ---------- */
const loader = new GLTFLoader();
function floorMats(fx, clip) {
  const c = (m) => Object.assign(m, { clippingPlanes: [clip] });
  return { wall: c(fxMaterial({}, fx)), floor: fxMaterial({}, fx, 0.5), furniture: fxMaterial({}, fx), door: c(fxMaterial({ transparent: true, opacity: 0.45, depthWrite: false }, fx)),
    window: c(fxMaterial({ transparent: true, opacity: 0.25, depthWrite: false }, fx)), opening: fxMaterial({ transparent: true, opacity: 0, depthWrite: false }, fx) };
}
async function loadFloors() {
  for (const F of Object.values(S.F)) scene.remove(F.G);
  S.F = {};
  for (const f of S.plan.floors) {
    const inner = f.kind === 'drawn' ? await drawnFloor(f) : await new Promise((ok, bad) => loader.load(`/api/floorplan/floors/${f.id}/model`, (g) => ok(g.scene), undefined, bad)).catch(() => null);
    if (!inner) { toast(`Could not load ${f.name}`); continue; }
    if (f.kind !== 'drawn') { inner.scale.setScalar(f.scale || 1); inner.rotation.y = deg(f.rotationY || 0); }
    const G = new THREE.Group(); G.userData.floor = f.id; G.add(inner); G.position.set(f.offset?.[0] || 0, 0, f.offset?.[1] || 0); scene.add(G); G.updateMatrixWorld(true);
    const fx = makeFx(), clip = new THREE.Plane(new V3(0, -1, 0), 1e6), clipLow = new THREE.Plane(new V3(0, -1, 0), 1e6);
    const F = { f, G, inner, fx, clip, clipLow, mats: floorMats(fx, clip), low: floorMats(fx, clipLow), items: new Map(), roomLabs: [], wallMeshes: [],
      edgeMat: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, clippingPlanes: [clip] }), furnEdgeMat: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }), doorEdge: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, clippingPlanes: [clip] }),
      edgeLow: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, clippingPlanes: [clipLow] }), doorEdgeLow: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, clippingPlanes: [clipLow] }) };
    const meshes = []; inner.traverse((o) => { if (o.isMesh && !o.userData.keep) meshes.push(o); });
    for (const m of meshes) { m.userData.cat ||= classify(m); m.userData.floor = f.id; m.userData.key ||= itemOf(m).name || m.name || `mesh${meshes.indexOf(m)}`; }
    /* Parts of a scan the owner erased (stray furniture, scan noise, a neighbor's wall): kept hidden, never deleted from the file. */
    const gone = new Set(f.hiddenParts || []); for (const m of meshes) m.visible = !gone.has(m.userData.key);
    F.original = f.look === 'original' || (f.look !== 'styled' && f.kind !== 'drawn' && !guessCats(meshes, inner));
    if (!F.original) for (const m of meshes) {
      const cat = m.userData.cat || 'furniture', key = m.userData.key; m.material = F.mats[cat] || F.mats.furniture;
      if (!F.items.has(key)) F.items.set(key, []); F.items.get(key).push(m);
      const em = cat === 'furniture' ? F.furnEdgeMat : cat === 'door' ? F.doorEdge : cat === 'opening' || cat === 'floor' ? null : F.edgeMat;
      if (em && m.geometry.attributes.position.count < 80000) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, cat === 'furniture' ? 40 : 25), em); e.raycast = () => {}; m.add(e); m.userData.edge = e; }
      m.userData.full = m.material; m.castShadow = cat === 'wall' || cat === 'furniture'; m.receiveShadow = true;
      if (WALLISH.has(cat)) { const c = new THREE.Box3().setFromObject(m).getCenter(new V3()); m.userData.wc = { x: c.x, z: c.z }; F.wallMeshes.push(m); }
    }
    /* The house itself = walls and floors. Scans can carry stray bits far outside it, which must not
       size the roof, place the panel or frame the view. */
    let box = new THREE.Box3(); for (const m of meshes) if (m.visible && m.userData.cat === 'wall') box.expandByObject(m);
    if (box.isEmpty()) for (const m of meshes) if (m.visible && m.userData.cat === 'floor') box.expandByObject(m);
    if (box.isEmpty()) box = new THREE.Box3().setFromObject(inner);
    { const all = new THREE.Box3().setFromObject(inner); box.min.y = Math.min(box.min.y, all.min.y); }   // floors sit a touch below the walls
    F.minY = box.min.y; F.box = box;
    const fb = new THREE.Box3(); for (const m of meshes) if (m.visible && m.userData.cat === 'floor') fb.expandByObject(m);
    F.floorY = fb.isEmpty() ? box.min.y : Math.min(box.min.y + 0.3, fb.max.y);   // the walking surface: power lines run just above it
    F.center = box.getCenter(new V3()); F.r = Math.max(1, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2);
    F.detected = f.kind === 'drawn' ? drawnRooms(f, inner, G) : sectionRooms(inner, (p) => G.worldToLocal(p.clone()));
    F.rooms = Array.isArray(f.rooms) ? f.rooms : F.detected;
    F.label = new CSS2DObject(el('button', { class: 'floorlab', type: 'button', onclick: () => pickFloor(f.id) }));
    F.label.position.set((box.min.x + box.max.x) / 2 - G.position.x, box.max.y + 0.6, box.max.z - G.position.z); G.add(F.label);
    S.F[f.id] = F;
  }
  if (S.plan.floors.length === 1 && S.F[S.plan.floors[0].id]) S.floorView = S.plan.floors[0].id;
  if (S.floorView !== 'all' && !S.F[S.floorView]) S.floorView = 'all';
  S.houseBox = new THREE.Box3(); for (const F of Object.values(S.F)) S.houseBox.union(F.box.clone().translate(new V3(0, (F.f.level || 0) * (F.f.heightM || 3), 0)));
  applyLook(); buildRoomLabels(); layout(true);
}
/* The roof sits on the top floor (and lifts away when you pick a floor or a room). */
function buildRoofs() {
  for (const F of Object.values(S.F)) if (F.roof) { F.roof.parent?.remove(F.roof); F.roof = null; }
  const top = Object.values(S.F).sort((a, b) => (b.f.level || 0) - (a.f.level || 0))[0];
  if (!top || top.original) return;
  const b = top.box.clone(); b.min.x -= top.G.position.x; b.max.x -= top.G.position.x; b.min.z -= top.G.position.z; b.max.z -= top.G.position.z;
  top.roof = buildRoof(b, curTheme(), S.plan?.style?.extras?.roof); top.roof.castShadow = true; top.G.add(top.roof);
}
/* A drawn floor: a slab per room, walls raised from the room edges and drawn walls, the picture underneath. */
async function drawnFloor(f) {
  const g = new THREE.Group(), p = f.plan || {}, H = Math.max(1.5, Math.min(4, (f.heightM || 2.7) - 0.1)), T = 0.12;
  const addWall = (x1, z1, x2, z2) => { const len = Math.hypot(x2 - x1, z2 - z1); if (len < 0.05) return; const m = new THREE.Mesh(new THREE.BoxGeometry(len, H, T)); m.position.set((x1 + x2) / 2, H / 2, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); m.name = `Wall${g.children.length}`; m.userData.cat = 'wall'; g.add(m); };
  for (const r of p.rooms || []) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.06, r.h)); slab.position.set(r.x + r.w / 2, -0.03, r.y + r.h / 2); slab.name = `Floor ${r.name || g.children.length}`; slab.userData.cat = 'floor'; g.add(slab);
    addWall(r.x, r.y, r.x + r.w, r.y); addWall(r.x + r.w, r.y, r.x + r.w, r.y + r.h); addWall(r.x + r.w, r.y + r.h, r.x, r.y + r.h); addWall(r.x, r.y + r.h, r.x, r.y);
  }
  for (const w of p.walls || []) addWall(w[0], w[1], w[2], w[3]);
  if (p.bg) {
    const tex = await new THREE.TextureLoader().loadAsync(`/api/floorplan/floors/${f.id}/background`).catch(() => null);
    if (tex) { const w = p.bgW || 15, h = w * (tex.image.height / tex.image.width); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: Math.min(0.6, p.bgOpacity ?? 0.5), depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(w / 2, -0.07, h / 2); m.userData.keep = true; m.raycast = () => {}; g.add(m); }
  }
  if (!g.children.length) g.add(new CSS2DObject(el('div', { class: 'roomlab' }, `${f.name}: nothing drawn yet - Editor > Floors > Edit drawing`)));
  g.scale.setScalar(f.scale || 1); g.rotation.y = deg(f.rotationY || 0);
  return g;
}
function drawnRooms(f, inner, G) {
  inner.updateMatrixWorld(true);
  return (f.plan?.rooms || []).map((r, i) => { const p = G.worldToLocal(inner.localToWorld(new V3(r.x + r.w / 2, 0, r.y + r.h / 2))); return { name: r.name || `Room ${i + 1}`, color: ROOM_COLORS[i % ROOM_COLORS.length], pos: [+p.x.toFixed(2), +p.z.toFixed(2)] }; });
}
const roomAt = (F, x, z) => { let best = -1, bd = Infinity; F.rooms.forEach((r, i) => { const d = Math.hypot(r.pos[0] - x, r.pos[1] - z); if (d < bd) { bd = d; best = i; } }); return best; };
const curF = () => (S.floorView === 'all' ? null : S.F[S.floorView]);
function layout(fit) {
  const cur = curF(), curLevel = cur?.f.level ?? Infinity, multi = Object.keys(S.F).length > 1;
  let minY = Infinity;
  for (const F of Object.values(S.F)) {
    const f = F.f, lvl = f.level || 0, isCur = !cur || F === cur;
    F.G.position.y = lvl * (f.heightM || 3) + (prefs.stack === 'apart' && !cur ? lvl * 3 : 0);
    F.G.visible = (isCur || (prefs.stack !== 'alone' && lvl < curLevel)) && !prefs.hidden?.[f.id];
    F.fx.uDim.value = isCur ? 1 : 0.28; F.edgeMat.opacity = isCur ? 0.9 : 0.12; F.furnEdgeMat.opacity = isCur ? 0.35 : 0.05; F.doorEdge.opacity = F.edgeMat.opacity;
    F.G.updateMatrixWorld(true);
    F.clipLow.constant = F.G.position.y + F.minY + 1.1;
    if (F.roof) F.roof.visible = prefs.roof && (!cur || !multi) && !S.room && F.G.visible;
    if (F.G.visible) minY = Math.min(minY, F.G.position.y + F.minY);
    roomUniforms(F);
    F.label.visible = multi && !cur && F.G.visible && labelMode() !== 'none';
    for (const l of F.roomLabs) l.visible = prefs.names && F.G.visible && (cur ? F === cur : !multi);
  }
  grid.position.y = (Number.isFinite(minY) ? minY : 0) - 0.05;
  yard.visible = (yardOn() || (S.mode === 'edit' && S.tab === 'yard')) && (!cur || cur === Object.values(S.F).sort((a, b) => (a.f.level || 0) - (b.f.level || 0))[0]);
  if (card) { const F = S.F[card.o.userData.floor]; card.o.visible = !!F && F.G.visible && (!cur || F === cur); }
  for (const o of S.pinObjs) { const F = S.F[o.userData.floor]; o.visible = !!F && F.G.visible && (!cur || F === cur) && (prefs.cameras || o.userData.kind !== 'camera'); }
  wallsDirty = true;
  if (S.houseBox) { weather.set(wxOn() ? S.live?.weather?.kind : null, S.houseBox); weather.visible = wxOn() && !S.room; }
  controls.autoRotate = !!prefs.spin && !S.tour; controls.autoRotateSpeed = 0.45;
  drawChips(); drawTools(); drawLeft(); drawPower();
  if (fit) fitView();
}
/* Overlays color each room by what is happening in it, instead of its own color. */
const ramp = (stops, v) => { if (v <= stops[0][0]) return new THREE.Color(stops[0][1]); for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) return new THREE.Color(stops[i - 1][1]).lerp(new THREE.Color(stops[i][1]), (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])); return new THREE.Color(stops[stops.length - 1][1]); };
function roomStats(F) {
  return pinsByRoom(F).map((pins) => {
    const temps = pins.map((p) => p.device.tempC).filter((x) => x != null);
    const hums = pins.map((p) => p.device.humidity).filter((x) => x != null), co2 = pins.map((p) => p.device.co2).filter((x) => x != null);
    return { hum: hums.length ? hums.reduce((a, b) => a + b, 0) / hums.length : null, co2: co2.length ? Math.max(...co2) : null, temp: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null, watts: pins.filter((p) => p.device.powerW != null && p.device.on !== false).reduce((a, p) => a + p.device.powerW, 0),
      lights: pins.filter((p) => p.device.kind === 'light' && p.device.on).length, motion: pins.some((p) => p.device.motion), any: pins.length };
  });
}
function overlayColor(st) {
  const none = new THREE.Color('#3b4559');
  switch (prefs.overlay) {
    case 'temp': return st.temp == null ? none : ramp([[16, '#3b82f6'], [19, '#22d3ee'], [21.5, '#34d399'], [24, '#fbbf24'], [27, '#ef4444']], st.temp);
    case 'humidity': return st.hum == null ? none : ramp([[25, '#f97316'], [35, '#fbbf24'], [45, '#34d399'], [60, '#22d3ee'], [70, '#3b82f6']], st.hum);
    case 'air': return st.co2 == null ? none : ramp([[500, '#34d399'], [800, '#a3e635'], [1100, '#fbbf24'], [1500, '#f97316'], [2000, '#ef4444']], st.co2);
    case 'energy': return st.watts <= 1 ? none : ramp([[5, '#22c55e'], [300, '#fbbf24'], [1200, '#f97316'], [2500, '#ef4444']], st.watts);
    case 'lights': return st.lights ? new THREE.Color('#fbbf24') : none;
    case 'presence': return st.motion ? new THREE.Color('#22c55e') : none;
    default: return null;
  }
}
const overlayText = (st) => ({ humidity: st.hum != null ? `${Math.round(st.hum)}%` : '', air: st.co2 != null ? `${Math.round(st.co2)} ppm` : '', temp: st.temp != null ? temp(st.temp) : '', energy: st.watts > 1 ? fmtW(st.watts) : '', lights: st.lights ? `${st.lights} on` : '', presence: st.motion ? 'motion' : '' }[prefs.overlay] ?? null);
function roomUniforms(F) {
  const n = Math.min(F.rooms.length, MAX_ROOMS), stats = prefs.overlay !== 'rooms' && S.live ? roomStats(F) : null;
  F.mats.floor.userData.tint.value = stats ? 0.75 : look().tint;
  for (let i = 0; i < n; i++) { const r = F.rooms[i], w = F.G.localToWorld(new V3(r.pos[0], 0, r.pos[1])), c = (stats && overlayColor(stats[i])) || new THREE.Color(r.color || ROOM_COLORS[i % ROOM_COLORS.length]); F.fx.uRoomPos.value[i].set(w.x, w.z); F.fx.uRoomCol.value[i].set(c.r, c.g, c.b); }
  F.fx.uRoomN.value = n; F.fx.uRoomSel.value = S.room?.floor === F.f.id ? S.room.i : -1;
}
function fitView() {
  const cur = curF(), box = new THREE.Box3();
  for (const F of Object.values(S.F)) if (F.G.visible && (!cur || F === cur)) box.union(F.box.clone().translate(new V3(0, F.G.position.y, 0)));
  if (box.isEmpty()) return;
  if (!cur && yard.group.visible) for (const c of yard.cars) box.expandByObject(c.o);   // keep the car in the picture
  /* From the front of the house, a little to one side and above - like looking into a dollhouse. */
  const c = box.getCenter(new V3()), len = Math.max(6, box.getSize(new V3()).length());
  const dir = new V3(0.32, 0, 1).applyAxisAngle(new V3(0, 1, 0), deg(S.plan?.settings?.frontDeg || 0)).normalize();
  flyTo(c, c.clone().add(dir.multiplyScalar(len * 1.02)).add(new V3(0, len * 0.66, 0)));
}
function pickFloor(id) { S.floorView = id; S.room = null; layout(true); }
function focusRoom(fid, i) {
  const F = S.F[fid], r = F?.rooms[i]; if (!r) return;
  S.floorView = fid; S.room = { floor: fid, i }; layout(false);
  const w = F.G.localToWorld(new V3(r.pos[0], F.minY + 0.6, r.pos[1]));
  const near = F.rooms.filter((_, j) => j !== i).reduce((m, o) => Math.min(m, Math.hypot(o.pos[0] - r.pos[0], o.pos[1] - r.pos[1])), 8);
  const dist = Math.max(7, Math.min(13, near * 2.1)), dir = camera.position.clone().sub(controls.target).setY(0).normalize();
  if (!dir.lengthSq()) dir.set(0.5, 0, 0.8).normalize();
  flyTo(w, w.clone().add(dir.multiplyScalar(dist * 0.75)).add(new V3(0, dist, 0)));
}
function buildRoomLabels() {
  for (const F of Object.values(S.F)) {
    for (const l of F.roomLabs) { l.parent?.remove(l); l.element.remove(); }
    F.roomLabs = F.rooms.map((r, i) => {
      const o = new CSS2DObject(el('button', { class: 'roomlab', type: 'button', style: `--rc:${r.color || ROOM_COLORS[i % ROOM_COLORS.length]}`, onclick: () => (S.mode === 'view' ? focusRoom(F.f.id, i) : null) }, el('b', {}, r.name), el('small', {})));
      o.position.set(r.pos[0], F.minY + 0.15, r.pos[1]); F.G.add(o); return o;
    });
  }
}

/* ---------- devices on the plan ---------- */
let units = 'F';
const temp = (c) => `${Math.round(units === 'C' ? c : c * 9 / 5 + 32)}°`;
function devState(d) {
  if (d.water || d.smoke) return { alarm: true, act: true, val: d.water ? 'Water!' : 'Smoke!' };
  if (d.kind === 'light') return { act: !!d.on, val: d.on ? (d.brightness != null ? `${d.brightness}%` : 'On') : 'Off' };
  if (d.kind === 'media') return { act: !!d.playing, val: d.playing ? (d.title || 'Playing') : 'Idle' };
  if (['plug', 'switch'].includes(d.kind) && d.on != null) return { act: !!d.on, val: d.on ? (d.powerW != null ? `${fmtW(d.powerW)}` : 'On') : 'Off' };
  if (d.powerW != null) return { act: d.powerW > 3, val: fmtW(d.powerW) };
  if (d.open != null) return { act: !!d.open, val: d.open ? 'Open' : 'Closed' };
  if (d.locked != null) return { act: !d.locked, val: d.locked ? 'Locked' : 'Unlocked' };
  if (d.kind === 'climate' || d.tempC != null) return { act: false, val: d.tempC != null ? temp(d.tempC) : d.state };
  if (d.motion) return { act: true, val: 'Motion' };
  if (['plug', 'switch', 'fan'].includes(d.kind)) return { act: !!d.on, val: d.on ? 'On' : 'Off' };
  return { act: false, val: d.value != null ? `${d.value}${d.unit || ''}` : d.state ?? null };
}
const pinName = (p) => p.label || p.device.name;
const fmtW = (w) => (w >= 1000 ? `${(w / 1000).toFixed(w >= 10000 ? 0 : 1)} kW` : `${Math.round(w)} W`);
function pinsByRoom(F) { const out = F.rooms.map(() => []); for (const p of S.live?.pins || []) if (p.floor === F.f.id) { const i = roomAt(F, p.pos[0], p.pos[2]); if (i >= 0) out[i].push(p); } return out; }
function drawPins() {
  for (const o of S.pinObjs) { o.parent?.remove(o); o.element.remove(); }
  S.pinObjs = [];
  const L = look(), glows = {};
  for (const p of S.live?.pins || []) {
    const F = S.F[p.floor]; if (!F) continue;
    const d = p.device, st = devState(d), sel = S.mode === 'edit' && S.tool?.type === 'device' && S.tool.dev.id === p.deviceId;
    let o = null;
    const div = el('button', { type: 'button', class: `pin${st.act ? ' act' : ''}${st.alarm ? ' alarm' : ''}${d.online === false ? ' offline' : ''}${sel ? ' sel' : ''}${S.mode === 'edit' ? ' movable' : ''}`, title: `${pinName(p)}${st.val ? ` - ${st.val}` : ''}${S.mode === 'edit' ? ' (drag to move)' : ''}`, onclick: () => { if (!S.dragged) pinClick(p); }, onpointerdown: (e) => pinDrag(e, p, o) },
      ic(iconOf(d)), (st.act || prefs.values) && st.val ? el('span', { class: 'val' }, prefs.values && !st.act ? `${pinName(p)} · ${st.val}` : st.val) : null);
    o = new CSS2DObject(div); o.position.set(...p.pos); o.userData = { floor: p.floor, kind: d.kind }; F.G.add(o); S.pinObjs.push(o);
    const glow = d.kind === 'light' && d.on ? [p.color || d.rgb || (d.kelvin ? kelvinToHex(d.kelvin) : '#ffc477'), (0.35 + 0.65 * ((d.brightness ?? 100) / 100)) * L.glow] : d.kind === 'media' && d.playing ? ['#c084fc', 0.45 * L.glow] : st.alarm ? ['#ef4444', 0.9 * L.glow] : d.open ? ['#f59e0b', 0.35 * L.glow] : ['plug', 'switch'].includes(d.kind) && d.on && d.powerW > 5 ? ['#34d399', Math.min(0.5, 0.15 + d.powerW / 2000) * L.glow] : null;
    if (glow) (glows[p.floor] ||= []).push({ p, color: glow[0], k: glow[1] });
  }
  for (const F of Object.values(S.F)) {
    const list = (glows[F.f.id] || []).slice(0, MAX_GLOW);
    list.forEach((g, i) => { const w = F.G.localToWorld(new V3(...g.p.pos)), c = new THREE.Color(g.color); F.fx.uGlowPos.value[i].copy(w); F.fx.uGlowCol.value[i].set(c.r * g.k, c.g * g.k, c.b * g.k); F.fx.uGlowRoom.value[i] = roomAt(F, g.p.pos[0], g.p.pos[2]); });
    F.fx.uGlowN.value = list.length;
    const by = pinsByRoom(F);
    F.roomLabs.forEach((l, i) => { const on = by[i].filter((p) => p.device.kind === 'light' && p.device.on).length, t = by[i].find((p) => p.device.tempC != null); l.element.querySelector('small').textContent = prefs.overlay !== 'rooms' ? overlayText(roomStats(F)[i]) || '' : [t ? temp(t.device.tempC) : '', on ? `${on} on` : ''].filter(Boolean).join(' · '); });
    const lightsOn = (S.live?.pins || []).filter((p) => p.floor === F.f.id && p.device.kind === 'light' && p.device.on).length;
    const openN = (S.live?.pins || []).filter((p) => p.floor === F.f.id && p.device.open && p.device.kind !== 'cover').length;
    fill(F.label.element, el('b', {}, F.f.name), el('small', {}, [`${F.rooms.length} rooms`, `${lightsOn} lights on`, openN ? `${openN} open` : ''].filter(Boolean).join(' · ')));
  }
  if (card) { const p = (S.live?.pins || []).find((x) => x.deviceId === card.id); if (p) fillCard(p); else closeCard(); }
  drawTrail();
  layout(false);
}
async function act(d, action, value) {
  try { await send(`/api/devices/${encodeURIComponent(d.id)}/${action}`, 'POST', value != null ? { value } : {}); setTimeout(refresh, 700); }
  catch (e) { if (e.status === 401) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`; return; } toast(e.message); setTimeout(refresh, 300); }
}
function pinClick(p) {
  const d = p.device;
  if (S.mode === 'edit') { S.tab = 'devices'; S.tool = { type: 'device', dev: { id: d.id, name: pinName(p) } }; editor(); drawPins(); return; }
  if (d.kind === 'camera') return cameraModal(d, pinName(p));
  if (card?.id === p.deviceId) return closeCard();
  openCard(p);
}
const snapUrl = (d) => d.snapshot || (d.provider === 'ha' ? `/api/ha/camera/${encodeURIComponent(d.id.slice(3))}` : `/api/cameras/${encodeURIComponent(d.id.split(':').slice(1).join(':'))}/snapshot`);
/* A camera opens its live picture: a real stream when the server has one (MJPEG), otherwise a fresh
   still every second, swapped in only once it has loaded so it never flickers. */
let camStop = null;
function cameraModal(d, name = d.name) {
  const img = el('img', { alt: name, class: 'feed' }), badge = el('span', { class: 'livebadge' }, d.stream ? 'LIVE' : 'Connecting\u2026');
  if (d.stream) { img.src = `${d.stream}${d.stream.includes('?') ? '&' : '?'}t=${Date.now()}`; img.onerror = () => { badge.textContent = 'Stills'; still(); }; }
  let timer = null;
  function still() {
    const tick = () => { const n = new Image(); n.onload = () => { img.src = n.src; badge.textContent = 'Live (stills)'; timer = setTimeout(tick, 1000); }; n.onerror = () => { badge.textContent = 'No picture'; timer = setTimeout(tick, 4000); }; n.src = `${snapUrl(d)}${snapUrl(d).includes('?') ? '&' : '?'}t=${Date.now()}`; };
    tick();
  }
  if (!d.stream) still();
  camStop = () => { clearTimeout(timer); img.onerror = null; img.removeAttribute('src'); camStop = null; };
  modal(el('div', { class: 'box cam' }, el('div', { class: 'rhead' }, ic('camera'), el('div', {}, el('h2', {}, name), el('small', {}, badge)), el('button', { type: 'button', class: 'iconbtn', title: 'Close', onclick: closeModal }, ic('close'))), img));
}
function modal(content) { const m = $('#modal'); m.replaceChildren(content); m.hidden = false; m.onclick = (e) => { if (e.target === m) closeModal(); }; }
function closeModal() { camStop?.(); $('#modal').hidden = true; $('#modal').replaceChildren(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeCard(); } });

/* ---------- tapping a device: a small control card right where it is ---------- */
function closeCard() { if (!card) return; card.o.parent?.remove(card.o); card.o.element.remove(); card = null; }
function openCard(p) {
  closeCard();
  const F = S.F[p.floor]; if (!F) return;
  const o = new CSS2DObject(el('div', { class: 'devcard-wrap' }, el('div', { class: 'devcard', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => e.stopPropagation() })));
  o.center.set(0.5, 1); o.position.set(...p.pos); o.userData = { floor: p.floor, card: true }; F.G.add(o);
  const sp = F.G.localToWorld(new V3(...p.pos)).project(camera), below = (1 - sp.y) / 2 * view.clientHeight < 330;   // near the top: open downwards
  if (below) { o.center.set(0.5, 0); o.element.classList.add('below'); }
  card = { id: p.deviceId, o }; fillCard(p);
}
function fillCard(p) {
  const box = card.o.element.firstChild, d = p.device;
  if (box.contains(document.activeElement) && ['range', 'color'].includes(document.activeElement.type)) return;   // mid-drag
  const F = S.F[p.floor], ri = F ? roomAt(F, p.pos[0], p.pos[2]) : -1, room = F?.rooms[ri];
  const controls = window.CasaControls.build(d, { units, act: (action, value) => { fillCard(p); drawPinsSoon(); act(d, action, value); } });
  fill(box, el('div', { class: 'chead' }, ic(iconOf(d)), el('b', {}, pinName(p)), el('button', { type: 'button', class: 'iconbtn sm', title: 'Close', onclick: closeCard }, ic('close'))), ...controls,
    room ? el('button', { type: 'button', class: 'mini wide', onclick: () => { closeCard(); focusRoom(p.floor, ri); } }, `${T('Open')} ${room.name}`) : null);
}
const drawPinsSoon = debounce(() => drawPins(), 50);

/* ---------- view UI: floor/room chips, toggles, floor summary, room panel ---------- */
function drawChips() {
  const cur = curF(), multi = Object.keys(S.F).length > 1, chip = (txt, on, fn, color) => el('button', { type: 'button', class: `chip${on ? ' on' : ''}`, onclick: fn, style: color ? `--rc:${color}` : null }, color ? el('i', { class: 'swatch' }) : null, txt);
  const rooms = (F) => F.rooms.map((r, i) => chip(r.name, S.room?.floor === F.f.id && S.room.i === i, () => focusRoom(F.f.id, i), r.color));
  fill($('#chips'), 
    ...(multi ? [chip(T('All floors'), !cur, () => pickFloor('all')), ...Object.values(S.F).sort((a, b) => b.f.level - a.f.level).map((F) => chip(F.f.name, cur === F, () => pickFloor(F.f.id)))] : []),
    ...(multi ? [el('span', { class: 'sep' })] : []),
    ...(cur ? rooms(cur) : multi ? Object.values(S.F).flatMap((F) => (F.rooms.length ? [el('span', { class: 'chiphead' }, F.f.name), ...rooms(F)] : [])) : []));
  $('#chips').hidden = !$('#chips').children.length;
}
function seg(options, value, onpick) { return el('div', { class: 'seg' }, ...options.map(([v, label]) => el('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => onpick(v) }, T(label)))); }
const toggle = (label, key) => el('button', { type: 'button', class: `tog${prefs[key] ? ' on' : ''}`, onclick: () => { prefs[key] = !prefs[key]; savePrefs(); skyAt = 0; drawPins(); } }, T(label));
/* Labels: none (just the model and its pins), key (room and floor names, values only on what's on) or all. */
function labelMode() { return prefs.labels || (!prefs.names ? 'none' : prefs.values ? 'all' : 'key'); }
function setLabels(v) { prefs.labels = v; prefs.names = v !== 'none'; prefs.values = v === 'all'; savePrefs(); drawPins(); drawTools(); }
function drawTools() {
  const t = $('#tools'); t.hidden = S.mode !== 'view' || !Object.keys(S.F).length;
  const set = (k) => (v) => { prefs[k] = v; savePrefs(); layout(k === 'stack'); };
  const more = S.moreOpen ? el('div', { class: 'morepop' },
    Object.values(S.F).some((F) => F.roof) ? toggle('Roof', 'roof') : null, toggle('Power lines', 'power'), isReal() ? null : toggle('Sun & shadows', 'sun'), isReal() ? null : toggle('Weather', 'weatherFx'), !isReal() && (S.plan?.yard?.areas?.length || S.plan?.yard?.items?.length) ? toggle('Yard', 'yard') : null,
    el('div', { class: 'poprow look' }, el('small', {}, 'Look'), seg(Object.entries(THEMES).map(([k, t]) => [k, t.label]), curTheme(), (v) => { prefs.theme = v; savePrefs(); applyLook(); drawThemeSeg(); drawTools(); })),
    el('div', { class: 'poprow' }, el('small', {}, 'Labels'), seg([['none', 'None'], ['key', 'Key'], ['all', 'All']], labelMode(), setLabels)), toggle('Activity trail', 'trail'), toggle('Cameras', 'cameras'), toggle('Spin', 'spin'),
    Object.keys(S.F).length > 1 ? seg([['stacked', 'Stacked'], ['apart', 'Apart'], ['alone', 'Alone']], prefs.stack, set('stack')) : null) : null;
  fill(t,
    seg([['auto', 'Dollhouse'], ['tall', 'Tall'], ['cut', 'Cut']], prefs.walls, set('walls')),
    seg([['rooms', 'Rooms'], ['temp', 'Temp'], ...(S.live?.pins || []).some((p) => p.device.humidity != null) ? [['humidity', 'Humidity']] : [], ...(S.live?.pins || []).some((p) => p.device.co2 != null) ? [['air', 'Air']] : [], ['energy', 'Energy'], ['lights', 'Lights'], ['presence', 'Motion']], prefs.overlay, (v) => { prefs.overlay = v; savePrefs(); drawPins(); }),
    el('button', { type: 'button', class: `tog${S.tour ? ' on' : ''}`, onclick: () => (S.tour ? stopTour() : startTour()) }, S.tour ? `■ ${T('Stop')}` : `▶ ${T('Tour')}`),
    el('button', { type: 'button', class: `tog${S.moreOpen ? ' on' : ''}`, onclick: () => { S.moreOpen = !S.moreOpen; drawTools(); } }, `${T('View')} ▾`),
    el('button', { type: 'button', class: 'tog', title: 'Reset view', onclick: () => { S.room = null; layout(true); } }, '⟲'),
    S.room ? el('button', { type: 'button', class: 'tog on', onclick: () => { S.room = null; layout(true); } }, ic('back'), T('Back')) : null);
  document.querySelector('body > .morepop')?.remove(); if (more && !t.hidden) document.body.append(more);   // on the page, so the scrolling bar can't clip it
}
const lightsIn = (pins) => pins.filter((p) => p.device.kind === 'light');
async function allLights(pins, on) { await Promise.all(lightsIn(pins).filter((p) => !!p.device.on !== on).map((p) => send(`/api/devices/${encodeURIComponent(p.device.id)}/${on ? 'on' : 'off'}`, 'POST', pin ? { pin } : {}).catch(() => {}))); setTimeout(refresh, 700); }
/* ---------- the control panel on the left: time, weather, the house, then the room you pick ---------- */
const tz = () => S.live?.weather?.tz || undefined;
function clockText() {
  const now = new Date();
  try { return [now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz() }), now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz() })]; }
  catch { return [now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })]; }
}
setInterval(() => { const c = document.querySelector('#left .clock'); if (c) { const [t, d] = clockText(); c.firstChild.textContent = t; c.lastChild.textContent = d; } }, 10000);
const wIcon = (kind) => { const s = el('span', { class: 'wi' }); s.innerHTML = weatherIcon(kind); return s; };
function weatherBlock() {
  const w = S.live?.weather; if (!w || w.temp == null) return null;
  return el('div', { class: 'weather' },
    el('div', { class: 'wnow' }, wIcon(w.kind), el('b', {}, `${Math.round(w.temp)}°`), el('div', {}, el('span', {}, w.words || ''), el('small', {}, [w.place, w.hi != null ? `H ${Math.round(w.hi)}° · L ${Math.round(w.lo)}°` : ''].filter(Boolean).join(' · ')))),
    (w.days || []).length ? el('div', { class: 'wdays' }, ...w.days.slice(0, 5).map((d) => el('div', {}, el('small', {}, d.label), wIcon(d.kind), el('span', {}, d.hi != null ? `${Math.round(d.hi)}°` : ''), el('small', {}, d.lo != null ? `${Math.round(d.lo)}°` : '')))) : null);
}
/* Scrub through today to see where the sun falls in each room. */
function sunBlock() {
  const w = S.live?.weather; if (!sunOn() || w?.lat == null) return null;
  const at = S.timeAt || new Date(), mins = at.getHours() * 60 + at.getMinutes();
  const lab = el('b', {}, S.timeAt ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : T('Now'));
  const r = el('input', { type: 'range', min: 0, max: 1439, step: 15, value: mins, 'aria-label': 'Time of day for sunlight', oninput: (e) => { const x = new Date(); x.setHours(0, Number(e.target.value), 0, 0); S.timeAt = x; lab.textContent = x.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); updateSky(); } });
  return el('div', { class: 'sunrow' }, el('span', { class: 'small' }, `☀ ${T('Sunlight')}`), r, lab, S.timeAt ? el('button', { type: 'button', class: 'mini', onclick: () => { S.timeAt = null; updateSky(); drawLeft(); } }, 'Now') : null);
}
/* ---------- tour: a slow fly-through of every room, for wall panels and showing off ---------- */
function startTour() {
  const stops = [null, ...Object.values(S.F).sort((a, b) => (a.f.level || 0) - (b.f.level || 0)).flatMap((F) => F.rooms.map((_, i) => [F.f.id, i]))];
  if (stops.length < 2) { toast('Add rooms first (Editor > Rooms).'); return; }
  let n = 0; const step = () => { const s = stops[n++ % stops.length]; if (!s) { S.room = null; S.floorView = Object.keys(S.F).length > 1 ? 'all' : S.floorView; layout(true); } else focusRoom(s[0], s[1]); };
  S.tour = setInterval(step, 7000); step(); layout(false);
  renderer.domElement.addEventListener('pointerdown', stopTour, { once: true });
}
function stopTour() { if (!S.tour) return; clearInterval(S.tour); S.tour = null; layout(false); }
function drawLeft() {
  const box = $('#left');
  if (S.mode !== 'view') return;
  if (!S.live && !Object.keys(S.F).length) { box.hidden = true; return; }
  if (box.contains(document.activeElement) && document.activeElement.type === 'range') return;   // don't redraw under a dragging slider
  const [t, d] = clockText();
  box.hidden = false; box.classList.toggle('roomopen', !!S.room);
  fill(box, el('div', { class: 'clock' }, el('b', {}, t), el('small', {}, d)), weatherBlock(), sunBlock(), S.room ? roomBlock() : homeBlock());
}
/* Where the power is coming from, when the house has the sensors for it (solar, a home battery, the grid). */
function energyCard(E) {
  if (!E || (E.solarW == null && !E.battery && E.gridW == null)) return null;
  const tile = (label, value, cls, sub) => el('div', { class: `etile ${cls || ''}` }, el('small', {}, label), el('b', {}, value), sub ? el('span', {}, sub) : null);
  const b = E.battery;
  return el('div', { class: 'ecard' }, el('div', { class: 'eyebrow' }, T('Energy now')),
    el('div', { class: 'egrid' },
      E.solarW != null ? tile(T('Solar'), fmtW(E.solarW), 'sun') : null,
      tile(T('House'), fmtW(E.useW || 0), 'home'),
      b ? tile(T('Battery'), b.pct != null ? `${b.pct}%` : fmtW(Math.abs(b.w)), 'batt', b.w ? (b.w > 0 ? `charging ${fmtW(b.w)}` : `giving ${fmtW(-b.w)}`) : null) : null,
      E.gridW != null ? tile(T('Grid'), fmtW(Math.abs(E.gridW)), E.gridW < 0 ? 'export' : 'grid', E.gridW < 0 ? 'sending out' : 'drawing in') : null),
    E.selfPct != null ? el('div', { class: 'ebar', title: 'How much of what the house uses right now comes from your solar' }, el('i', { style: `width:${E.selfPct}%` }), el('span', {}, `${E.selfPct}% from your own solar`)) : null);
}
/* Activity trail: where motion was seen in the last 20 minutes, oldest to newest, as a line along the floors. */
let trail = null, trailLabs = [];
function drawTrail() {
  if (trail) { scene.remove(trail); trail.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); trail = null; }
  for (const l of trailLabs) { l.parent?.remove(l); l.element.remove(); } trailLabs = [];
  if (!prefs.trail || S.mode !== 'view' || !S.live) return;
  const now = Date.now(), cur = curF();
  const hits = (S.live.pins || []).filter((p) => p.device.motion != null && S.F[p.floor]?.G.visible && (!cur || cur === S.F[p.floor]))
    .map((p) => ({ p, t: p.device.motion ? now : Date.parse(p.device.changedAt || '') })).filter((x) => Number.isFinite(x.t) && now - x.t < 20 * 60_000).sort((a, b) => a.t - b.t);
  if (!hits.length) return;
  trail = new THREE.Group();
  const pts = hits.map(({ p }) => { const F = S.F[p.floor]; return F.G.localToWorld(new V3(p.pos[0], F.floorY + 0.1, p.pos[2])); });
  const mat = new THREE.MeshBasicMaterial({ color: '#34d399', transparent: true, opacity: 0.85, depthTest: false });
  if (pts.length > 1) trail.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 20, 0.045, 6), mat));
  hits.forEach(({ p, t }, i) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(i === hits.length - 1 ? 0.16 : 0.1, 16, 12), mat.clone()); dot.position.copy(pts[i]); dot.material.opacity = 0.45 + 0.55 * ((i + 1) / hits.length); trail.add(dot);
    const mins = Math.round((now - t) / 60_000), lab = new CSS2DObject(el('div', { class: 'traillab' }, el('b', {}, pinName(p)), el('small', {}, mins < 1 ? 'now' : `${mins} min ago`)));
    lab.position.copy(pts[i]).add(new V3(0, 0.35, 0)); scene.add(lab); trailLabs.push(lab);
  });
  trail.renderOrder = 5; scene.add(trail);
}
function homeBlock() {
  const cur = curF(), Fs = cur ? [cur] : Object.values(S.F), pins = (S.live?.pins || []).filter((p) => Fs.some((F) => F.f.id === p.floor));
  const lights = lightsIn(pins), on = lights.filter((p) => p.device.on).length, open = pins.filter((p) => p.device.open && p.device.kind !== 'cover'), wet = pins.filter((p) => p.device.water || p.device.smoke);
  const placedW = pins.filter((p) => p.device.powerW != null && (p.device.on ?? true)).reduce((a, p) => a + p.device.powerW, 0);
  const watts = cur ? placedW : S.live?.totals?.powerW ?? placedW;   // the whole home: the same number as the top bar
  const all = Object.values(S.F).sort((a, b) => (b.f.level || 0) - (a.f.level || 0)), hasRoof = all.some((F) => F.roof);
  const eye = (on, fn, label) => el('button', { type: 'button', class: `eye${on ? ' on' : ''}`, title: on ? `Hide ${label}` : `Show ${label}`, onclick: fn }, on ? '◉' : '○');
  return el('div', {},
    el('div', { class: 'eyebrow' }, cur ? cur.f.name : all.length > 1 ? T('Whole home') : T('Home|house')),
    el('div', { class: 'kpis' }, el('div', {}, el('small', {}, T('Using now')), el('b', { class: 'good' }, fmtW(watts))), el('div', {}, el('small', {}, T('Lights on')), el('b', { class: 'warm' }, `${on}/${lights.length}`))),
    cur ? null : energyCard(S.live?.energy),
    lights.length ? el('div', { class: 'srow' }, el('span', {}, T('All lights')), el('button', { type: 'button', class: 'mini', onclick: () => allLights(pins, true) }, 'On'), el('button', { type: 'button', class: 'mini', onclick: () => allLights(pins, false) }, 'Off')) : null,
    ...wet.map((p) => el('div', { class: 'srow bad' }, ic('drop'), `${pinName(p)}: ${devState(p.device).val}`)),
    ...open.map((p) => el('div', { class: 'srow warn' }, ic('door'), `${pinName(p)} is open`)),
    all.length > 1 || hasRoof ? el('div', { class: 'sechead' }, T('Layers')) : null,
    hasRoof ? el('div', { class: 'layer' }, eye(prefs.roof, () => { prefs.roof = !prefs.roof; savePrefs(); layout(false); }, 'the roof'), el('span', {}, T('Roof'))) : null,
    ...(all.length > 1 || hasRoof ? all.map((F) => el('div', { class: `layer${cur === F ? ' cur' : ''}` }, eye(!prefs.hidden?.[F.f.id], () => { prefs.hidden = { ...(prefs.hidden || {}), [F.f.id]: !prefs.hidden?.[F.f.id] }; savePrefs(); layout(false); }, F.f.name),
      el('button', { type: 'button', class: 'lname', onclick: () => pickFloor(cur === F ? 'all' : F.f.id) }, F.f.name), el('small', {}, `${F.rooms.length} rooms`))) : []),
    el('div', { class: 'sechead' }, T('Rooms')),
    ...Fs.flatMap((F) => { const by = pinsByRoom(F); return F.rooms.map((r, i) => { const n = by[i].filter((p) => p.device.kind === 'light' && p.device.on).length, w = by[i].filter((p) => p.device.powerW != null && p.device.on !== false).reduce((a, p) => a + p.device.powerW, 0);
      return el('button', { type: 'button', class: 'sroom', onclick: () => focusRoom(F.f.id, i) }, el('i', { class: 'swatch', style: `--rc:${r.color}` }), r.name, el('small', {}, [n ? `${n} on` : '', w ? fmtW(w) : ''].filter(Boolean).join(' · '))); }); }),
    !Fs.some((F) => F.rooms.length) ? el('p', { class: 'note' }, 'No rooms yet. Open Editor > Rooms to add them.') : null);
}
function roomBlock() {
  const F = S.F[S.room.floor], r = F?.rooms[S.room.i]; if (!r) return null;
  const pins = pinsByRoom(F)[S.room.i] || [], kinds = (k) => pins.filter((p) => k(p.device));
  const t = pins.find((p) => p.device.tempC != null);
  const sw = (d) => el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: d.on || d.playing ? true : null, onchange: () => { d.on = !d.on; act(d, d.kind === 'media' ? 'toggle' : d.on ? 'on' : 'off'); drawPinsSoon(); } }), el('span'));
  // tap a row for every control, in a card right where the device is on the plan
  const row = (p, extra) => { const d = p.device, st = devState(d); return el('div', { class: `drow${st.act ? ' act' : ''}` }, el('div', { class: 'dtop' }, el('button', { type: 'button', class: 'dopen', title: `${pinName(p)}: all controls`, onclick: () => openCard(p) }, ic(iconOf(d)), el('span', { class: 'dn' }, pinName(p)), el('small', {}, st.val ?? '')), extra)); };
  const lights = kinds((d) => d.kind === 'light'), ctl = kinds((d) => ['plug', 'switch', 'fan', 'media'].includes(d.kind)), cams = kinds((d) => d.kind === 'camera');
  const more = kinds((d) => ['climate', 'cover', 'lock', 'alarm', 'vacuum', 'action'].includes(d.kind));
  const other = pins.filter((p) => !lights.includes(p) && !ctl.includes(p) && !cams.includes(p) && !more.includes(p));
  const w = pins.filter((p) => p.device.powerW != null && p.device.on !== false).reduce((a, p) => a + p.device.powerW, 0);
  return el('div', {},
    el('div', { class: 'rhead' }, el('button', { type: 'button', class: 'iconbtn', title: 'Back to the house', onclick: () => { S.room = null; layout(true); } }, ic('back')), el('i', { class: 'swatch big', style: `--rc:${r.color}` }),
      el('div', {}, el('h2', {}, r.name), el('small', {}, [t ? temp(t.device.tempC) : '', w ? `${fmtW(w)} now` : '', F.f.name].filter(Boolean).join(' · ')))),
    lights.length ? el('div', { class: 'sechead' }, `Lights · ${lights.filter((p) => p.device.on).length} on`, el('button', { type: 'button', class: 'mini', onclick: () => allLights(lights, false) }, 'All off')) : null,
    ...lights.map((p) => { const d = p.device, x = row(p, sw(d)); if (d.brightness != null || d.on) x.append(el('input', { type: 'range', min: 1, max: 100, value: d.brightness ?? 100, class: 'bri', 'aria-label': 'Brightness', onchange: (e) => { d.on = true; d.brightness = Number(e.target.value); act(d, 'brightness', d.brightness); drawPinsSoon(); } })); return x; }),
    ctl.length ? el('div', { class: 'sechead' }, 'Plugs & devices') : null,
    ...ctl.map((p) => { const d = p.device, x = row(p, sw(d)); if (d.powerW != null || d.energyKWh != null) x.append(el('div', { class: 'meter' }, d.powerW != null ? el('span', {}, el('b', {}, d.on === false ? '0 W' : fmtW(d.powerW)), ' now') : null, d.energyKWh != null ? el('span', {}, el('b', {}, `${(+d.energyKWh).toFixed(2)} kWh`), ' today') : null)); return x; }),
    more.length ? el('div', { class: 'sechead' }, 'Climate, blinds & more') : null, ...more.map((p) => row(p)),
    other.length ? el('div', { class: 'sechead' }, 'Sensors') : null, ...other.map((p) => row(p)),
    cams.length ? el('div', { class: 'sechead' }, 'Cameras') : null, ...cams.map((p) => el('button', { type: 'button', class: 'camthumb', onclick: () => cameraModal(p.device, pinName(p)) }, el('img', { src: `${snapUrl(p.device)}${snapUrl(p.device).includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 30000)}`, alt: pinName(p), loading: 'lazy' }), el('span', {}, pinName(p)))),
    !pins.length ? el('p', { class: 'note' }, 'Nothing placed in this room yet. Open ', el('b', {}, 'Editor > Devices'), ' and click where each device is.') : null);
}

/* ---------- power: from the panel, along the floor, up to every device ---------- */
const POWERED = new Set(['light', 'plug', 'switch', 'media', 'fan', 'climate']);
function panelSpot() {
  const st = S.plan?.settings?.panel, list = Object.values(S.F).sort((a, b) => (a.f.level || 0) - (b.f.level || 0));
  const F = (st && S.F[st.floor]) || list[0]; if (!F) return null;
  const local = st && S.F[st.floor] ? new V3(st.pos[0], F.minY, st.pos[2]) : new V3(F.box.min.x - F.G.position.x + 0.4, F.minY, F.box.max.z - F.G.position.z - 0.4);
  const w = F.G.localToWorld(local); w.y = F.G.position.y + F.floorY + 0.03; return { w, F };
}
function drawPower() {
  if (!S.live) return;
  const cur = curF(), spot = panelSpot();
  if (S.mode === 'edit' && !['devices', 'yard'].includes(S.tab)) { power.clear(); return; }
  const lines = yard.group.visible ? yard.live(S.live.cars, el, fmtW) : []; let i = 0;
  // the charger gets its own line from the panel, carrying what the car is pulling
  const evW = lines.reduce((a, l) => a + (l.on ? l.watts : 0), 0);
  if (spot && yard.charger && yard.group.visible && lines.length) { const a = yard.charger.localToWorld(new V3(0, 0.6, 0)), yb = yard.y + 0.03; lines.push({ on: evW > 0, watts: evW, pts: [spot.w.clone(), new V3(spot.w.x, yb, spot.w.z), new V3(a.x, yb, a.z), a] }); }
  if (!spot) { power.update(lines, null, 0, el, look()); power.visible = prefs.power; return; }
  for (const p of S.live.pins || []) {
    const d = p.device, F = S.F[p.floor];
    if (!F || !F.G.visible || (cur && F !== cur) || !POWERED.has(d.kind)) continue;
    const on = !!(d.on || d.playing) && d.online !== false, P0 = spot.w, yb = F.G.position.y + F.floorY + 0.03, Pd = F.G.localToWorld(new V3(...p.pos)), o = ((i++ % 9) - 4) * 0.05;
    const own = S.pins.find((x) => x.deviceId === p.deviceId)?.route, drawing = ['route', 'route-edit'].includes(S.tool?.type) && S.tool.dev.id === p.deviceId;
    const via = (drawing ? S.tool.pts : own) || null;   // a route the owner drew, as bends along the floor
    const mid = via?.length ? via.map(([x, z]) => { const w = F.G.localToWorld(new V3(x, 0, z)); return new V3(w.x, yb, w.z); })
      : [new V3(P0.x, yb, P0.z + o), new V3(Pd.x, yb, P0.z + o)];
    lines.push({ on: on || drawing, watts: d.powerW ?? (d.kind === 'light' ? 10 : 40), color: drawing ? '#f472b6' : d.kind === 'light' && on ? '#fbbf24' : null,
      pts: [P0.clone(), new V3(P0.x, yb, P0.z), ...mid, new V3(Pd.x, yb, Pd.z), new V3(Pd.x, Math.max(yb, Pd.y - 0.15), Pd.z)] });
  }
  power.update(lines, spot.w, S.live.totals?.powerW ?? 0, el, look());
  if (S.tool?.type === 'route-edit' && !document.body.classList.contains('dragging')) drawRouteHandles(); else if (S.tool?.type !== 'route-edit') clearRouteHandles();
  power.visible = prefs.power && (spot.F.G.visible || !!cur);
}

/* ---------- editor: drag pins and power-line bends ---------- */
/* A point on the model's surfaces under the pointer, just in front of the surface (where a pin sits). */
function surfaceAt(cx, cy, F) {
  const r = renderer.domElement.getBoundingClientRect(); mouse.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects([F.G], true).find((h) => h.object.isMesh && h.object.visible && h.object.material?.opacity !== 0 && !isClipped(h));
  return hit ? F.G.worldToLocal(hit.point.clone().add(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).multiplyScalar(0.15))) : null;
}
/* The point on a floor's own level under the pointer (power lines run along the floor). */
function floorAt(cx, cy, F) {
  const r = renderer.domElement.getBoundingClientRect(); mouse.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const w = ray.ray.intersectPlane(new THREE.Plane(new V3(0, 1, 0), -(F.G.position.y + F.floorY)), new V3());
  return w ? F.G.worldToLocal(w) : null;
}
const drawPowerSoon = (() => { let at = 0, t = null; return () => { const now = performance.now(); clearTimeout(t); if (now - at > 50) { at = now; drawPower(); } else t = setTimeout(() => { at = performance.now(); drawPower(); }, 50); }; })();
/* Shared drag plumbing: past a few pixels it's a drag (the camera holds still), otherwise a click. */
function dragging(e, { onmove, onend }) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const x0 = e.clientX, y0 = e.clientY; let moved = false;
  const move = (ev) => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return; if (!moved) { moved = true; controls.enabled = false; document.body.classList.add('dragging'); } onmove(ev); };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); controls.enabled = true; document.body.classList.remove('dragging');
    if (moved) { S.dragged = true; setTimeout(() => { S.dragged = false; }, 0); onend(); } };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
function pinDrag(e, p, o) {
  if (S.mode !== 'edit' || !o) return;
  const F = S.F[p.floor]; if (!F) return;
  dragging(e, {
    onmove: (ev) => { const l = surfaceAt(ev.clientX, ev.clientY, F); if (!l) return; o.position.copy(l); p.pos = [l.x, l.y, l.z]; drawPowerSoon(); },
    onend: () => { const pin = S.pins.find((x) => x.deviceId === p.deviceId); if (pin) { pin.pos = p.pos.map((n) => +n.toFixed(3)); savePins(); } },
  });
}
/* Editing a power line: a dot on every bend (drag it; double-click to remove it) and a + halfway along
   every stretch (drag it out to add a bend). Starts from the automatic route if the line has none. */
let routeHandles = [];
function clearRouteHandles() { for (const h of routeHandles) { h.parent?.remove(h); h.element.remove(); } routeHandles = []; }
function routeEdit(d) {
  const pin = S.pins.find((x) => x.deviceId === d.id), F = pin && S.F[pin.floor]; if (!F) return;
  let pts = pin.route?.map((q) => [...q]);
  if (!pts?.length) {   // the automatic route's two bends, as a starting point
    const spot = panelSpot(); pts = [];
    if (spot) { const P0 = F.G.worldToLocal(spot.w.clone()); pts = [[P0.x, P0.z], [pin.pos[0], P0.z]].map((q) => q.map((n) => +n.toFixed(2))); }
  }
  S.tool = { type: 'route-edit', dev: { id: d.id, name: pin.label || d.name }, pts }; editor(); drawPower();
}
function routeSave() {
  const t = S.tool, pin = t && S.pins.find((x) => x.deviceId === t.dev.id); if (!pin) return;
  pin.route = t.pts.length ? t.pts.map((q) => q.map((n) => +n.toFixed(2))) : null;
  savePins().then(() => drawRouteHandles());
}
function drawRouteHandles() {
  clearRouteHandles();
  const t = S.tool; if (S.mode !== 'edit' || t?.type !== 'route-edit') return;
  const pin = S.pins.find((x) => x.deviceId === t.dev.id), F = pin && S.F[pin.floor]; if (!F) return;
  const y = F.floorY + 0.06, spot = panelSpot(), st = spot && spot.F === F ? (() => { const l = F.G.worldToLocal(spot.w.clone()); return [l.x, l.z]; })() : null;
  const seq = [st, ...t.pts, [pin.pos[0], pin.pos[2]]].filter(Boolean), off = st ? 1 : 0;
  const add = (q, cls, title, down, dbl) => { const b = el('button', { type: 'button', class: `rh ${cls}`, title, 'aria-label': title, onpointerdown: down, ondblclick: dbl }); const o = new CSS2DObject(b); o.position.set(q[0], y, q[1]); F.G.add(o); routeHandles.push(o); return o; };
  const drag = (idx, o) => (e) => dragging(e, {
    onmove: (ev) => { const l = floorAt(ev.clientX, ev.clientY, F); if (!l) return; t.pts[idx] = [l.x, l.z]; o.position.set(l.x, y, l.z); drawPowerSoon(); },
    onend: () => { routeSave(); },
  });
  t.pts.forEach((q, i) => { const o = add(q, 'bend', 'Drag to move this bend. Double-click to remove it.', (e) => drag(i, o)(e), () => { t.pts.splice(i, 1); drawPower(); routeSave(); }); });
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i], b = seq[i + 1], at = Math.max(0, i - off + 1);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) continue;
    const o = add([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'mid', 'Drag to add a bend here', (e) => { if (t.pts.length >= 30) { toast('That\'s the most bends one line can have.'); return; } t.pts.splice(at, 0, [o.position.x, o.position.z]); o.element.classList.replace('mid', 'bend'); drag(at, o)(e); });
  }
}

/* ---------- clicking the model ---------- */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('click', (e) => {
  if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;   // that was a drag
  const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const cur = curF(), targets = Object.values(S.F).filter((F) => F.G.visible && (!cur || F === cur)).map((F) => F.G);
  const hit = ray.intersectObjects(targets, true).find((h) => h.object.isMesh && h.object.visible && h.object.material?.opacity !== 0 && !isClipped(h));
  if (S.mode === 'view' && card) { closeCard(); return; }
  if (S.mode === 'view') {
    if (!hit) { if (S.room) { S.room = null; layout(true); } return; }
    const F = S.F[hit.object.userData.floor], l = F.G.worldToLocal(hit.point.clone()), i = roomAt(F, l.x, l.z);
    if (i >= 0) focusRoom(F.f.id, i); else if (!cur) pickFloor(F.f.id);
    return;
  }
  if (!S.tool) return;
  if (S.tool.type?.startsWith('yard-')) { const g = ray.ray.intersectPlane(new THREE.Plane(new V3(0, 1, 0), -groundY()), new V3()); if (g) yardClick(g); return; }
  if (!hit) { toast('Click on the model.'); return; }
  const F = S.F[hit.object.userData.floor];
  if (S.tool.type === 'device') {
    const local = F.G.worldToLocal(hit.point.clone().add(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).multiplyScalar(0.15)));
    const old = S.pins.find((p) => p.deviceId === S.tool.dev.id);
    S.pins = S.pins.filter((p) => p.deviceId !== S.tool.dev.id).concat({ ...(old || {}), deviceId: S.tool.dev.id, floor: F.f.id, pos: [local.x, local.y, local.z] });
    S.tool = null; savePins();
  } else if (S.tool.type === 'erase') {
    if (F.f.id !== S.tool.floor) { toast(`Click a part of ${S.F[S.tool.floor]?.f.name || 'that floor'}.`); return; }
    const key = hit.object.userData.key, list = [...(F.f.hiddenParts || [])];
    if (key && !list.includes(key)) { list.push(key); S.tool.done.push(key); for (const m of (F.items.get(key) || [hit.object])) m.visible = false; hit.object.visible = false; saveHidden(F, list); }
  } else if (S.tool.type === 'route') {
    const pin = S.pins.find((p) => p.deviceId === S.tool.dev.id);
    if (!pin || F.f.id !== pin.floor) { toast('Click on the same floor as the device.'); return; }
    if (S.tool.pts.length >= 30) { toast('That\'s the most bends one line can have.'); return; }
    const l = F.G.worldToLocal(hit.point.clone()); S.tool.pts.push([+l.x.toFixed(2), +l.z.toFixed(2)]); drawPower(); editor();
  } else if (S.tool.type === 'panel') {
    const l = F.G.worldToLocal(hit.point.clone());
    S.tool = null; saveSettings({ panel: { floor: F.f.id, pos: [+l.x.toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3)] } });
  } else if (S.tool.type === 'room') {
    const l = F.G.worldToLocal(hit.point.clone()), rooms = F.rooms.map((x) => ({ ...x }));
    if (S.tool.i >= 0 && S.tool.floor === F.f.id) rooms[S.tool.i].pos = [+l.x.toFixed(2), +l.z.toFixed(2)];
    else rooms.push({ name: `Room ${rooms.length + 1}`, color: ROOM_COLORS[rooms.length % ROOM_COLORS.length], pos: [+l.x.toFixed(2), +l.z.toFixed(2)] });
    S.focusName = S.tool.i >= 0 && S.tool.floor === F.f.id ? S.tool.i : rooms.length - 1; S.tool = null; saveRooms(F, rooms);
  } else if (S.tool.type === 'paint') {
    if (F.original) { toast('This floor uses the scan\'s own colors. Switch it to "Styled" under Floors to paint it.'); return; }
    S.sel = { floor: F.f.id, key: hit.object.userData.key }; showSel(); editor();
  }
});
const isClipped = (h) => h.point.y > (h.object.material?.clippingPlanes?.[0]?.constant ?? Infinity);
function showSel() {
  const F = S.F[S.sel?.floor], ms = F?.items.get(S.sel?.key);
  scene.children.filter((o) => o.userData.sel).forEach((o) => scene.remove(o));
  if (!ms) return;
  const b = new THREE.Box3(); ms.forEach((m) => b.expandByObject(m)); b.expandByScalar(0.03);
  const h = new THREE.Box3Helper(b, '#fbbf24'); h.userData.sel = true; scene.add(h);
}
const clearSel = () => { S.sel = null; scene.children.filter((o) => o.userData.sel).forEach((o) => scene.remove(o)); };

/* ---------- saving ---------- */
async function savePins() {
  try { await send('/api/floorplan/pins', 'PUT', { pins: S.pins.map(({ deviceId, floor, pos, label, color, route }) => ({ deviceId, floor, pos, label, color, route })) }); await refresh(); editor(); }
  catch (e) { proErr(e); }
}
const savePinsSoon = debounce(savePins, 500);
/* ---------- the yard: drawing areas, placing trees and cars ---------- */
const newId = () => Math.random().toString(36).slice(2, 10);
const yardData = () => { const y = S.plan.yard || {}; return { areas: [...(y.areas || [])], items: (y.items || []).map((it) => ({ ...it, bind: { ...(it.bind || {}) } })) }; };
async function saveYard(y, quiet) {
  S.plan.yard = y; buildYard(); layout(false); if (!quiet) editor();   // show it right away; the CasaTorch keeps it
  try { const r = await send('/api/floorplan/yard', 'PUT', y); S.plan.yard = r.yard; await refresh(); }
  catch (e) { proErr(e); }
}
const saveYardSoon = debounce((y) => saveYard(y, true), 400);   // typing a name or dragging a slider: no re-draw of the panel
let previewLine = null;
function yardPreview() {
  if (previewLine) { scene.remove(previewLine); previewLine.geometry.dispose(); previewLine = null; }
  const t = S.tool; if (t?.type !== 'yard-area' || !t.pts.length) return;
  const y = groundY() + 0.05, pts = t.pts.map(([x, z]) => new V3(x, y, z));
  previewLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(t.pts.length > 2 ? [...pts, pts[0]] : pts), new THREE.LineBasicMaterial({ color: '#f472b6', depthTest: false }));
  previewLine.renderOrder = 20; scene.add(previewLine);
}
function yardClick(g) {
  const t = S.tool, at = [+g.x.toFixed(2), +g.z.toFixed(2)];
  if (t.type === 'yard-area') { if (t.pts.length >= 200) return; t.pts.push(at); yardPreview(); editor(); return; }
  const y = yardData();
  if (t.type === 'yard-place') { const it = { id: newId(), kind: t.kind, pos: at, rot: 0, scale: 1, ...(t.kind === 'car' ? { name: 'Car', color: '#cfd6df', body: 'sedan', bind: {} } : {}) }; y.items.push(it); S.yardSel = it.id; }
  if (t.type === 'yard-move') { const it = y.items.find((x) => x.id === t.id); if (it) it.pos = at; }
  S.tool = null; saveYard(y);
}
/* Find a car's sensors by their names - Tesla, and most EVs in Home Assistant, name them the same way. */
function guessCar(devs) {
  const ent = (d) => d.id.replace(/^ha:[a-z_]+\./, '');
  const home = devs.find((d) => d.pres && /^ha:device_tracker\..*_location$/.test(d.id)) || devs.find((d) => d.pres && /tesla|car|vehicle|ev_/.test(d.id));
  const stem = home ? ent(home).replace(/_location$/, '') : '';
  const best = (list, ...res) => { for (const re of res) { const hit = list.find((d) => re.test(ent(d)) && (!stem || ent(d).startsWith(stem))) || list.find((d) => re.test(ent(d))); if (hit) return hit; } return null; };
  const plug = best(devs.filter((d) => d.bin || d.kind === 'switch'), /charge_cable|charging_cable|charger_cable/, /vehicle_connected|plugged|plug_state/);
  const power = best(devs.filter((d) => d.pw), /charger_power|charging_power|charge_power|charge_rate|charger_rate/, /wall_connector.*power|charger.*power/);
  const battery = best(devs.filter((d) => d.bat), /battery_level$|state_of_charge|_soc$/, /tesla.*battery|car.*battery|vehicle.*battery/);
  return { plugged: plug?.id, power: power?.id, battery: battery?.id, home: home?.id };
}
function edYard() {
  const y = yardData(), devs = S.live?.devices || [];
  const save = () => saveYardSoon(y);
  const place = (kind) => { S.tool = { type: 'yard-place', kind }; editor(); };
  const pick = (label, key, it, filter) => el('div', { class: 'row' }, el('label', {}, label), el('select', { onchange: (e) => { if (e.target.value) it.bind[key] = e.target.value; else delete it.bind[key]; save(); } },
    el('option', { value: '' }, '-'), ...devs.filter(filter).sort((a, b) => a.name.localeCompare(b.name)).map((d) => el('option', { value: d.id, selected: it.bind[key] === d.id ? true : null }, d.name))));
  const row = (it, i) => {
    const sel = S.yardSel === it.id;
    const head = el('div', { class: 'dtop' }, el('b', {}, it.kind === 'car' ? it.name : ITEM_KINDS[it.kind]), el('small', {}, it.kind === 'car' ? (it.bind.plugged || it.bind.home ? 'linked' : 'not linked') : ''));
    const btns = el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => { S.yardSel = it.id; S.tool = { type: 'yard-move', id: it.id }; editor(); } }, 'Move'),
      el('button', { type: 'button', class: 'mini', title: 'Turn 45°', onclick: () => { it.rot = ((it.rot || 0) + 45) % 360; saveYard(y); } }, 'Turn'),
      el('button', { type: 'button', class: 'mini', onclick: () => { y.items.splice(i, 1); saveYard(y); } }, 'Remove'),
      el('button', { type: 'button', class: 'mini', onclick: () => { S.yardSel = sel ? null : it.id; editor(); } }, sel ? 'Less' : 'More'));
    const more = !sel ? null : it.kind === 'car' ? el('div', {},
      el('div', { class: 'row' }, el('label', {}, 'Name'), el('input', { type: 'text', value: it.name, maxlength: 30, oninput: (e) => { it.name = e.target.value || 'Car'; save(); } }), el('input', { type: 'color', value: it.color, title: 'Paint color', oninput: (e) => { it.color = e.target.value; save(); } })),
      seg([['sedan', 'Car'], ['suv', 'SUV']], it.body, (v) => { it.body = v; saveYard(y); }),
      el('p', { class: 'note' }, 'Link it to your car\'s sensors to show it home or away, plugged in, charging and its battery. Needs your car in Home Assistant (Tesla, and many other EVs). CasaTorch only shows the car - it never controls it.'),
      el('button', { type: 'button', class: 'mini', onclick: () => { const g = guessCar(devs); const n = Object.values(g).filter(Boolean).length; if (!n) { toast('No car sensors found. Add your car to Home Assistant first (Connect > Add any Home Assistant integration).'); return; } it.bind = Object.fromEntries(Object.entries(g).filter(([, v]) => v)); toast(`Found ${n} of 4 - check them below.`); saveYard(y); } }, 'Find my car\'s sensors'),
      pick('Home or away', 'home', it, (d) => d.pres), pick('Plugged in', 'plugged', it, (d) => d.bin || d.kind === 'switch'), pick('Charging power', 'power', it, (d) => d.pw), pick('Battery', 'battery', it, (d) => d.bat))
      : it.kind === 'charger' ? el('p', { class: 'note' }, 'The charging cable runs from here to a car that\'s plugged in, and a power line runs here from your panel.')
      : el('div', { class: 'row' }, el('label', {}, 'Size'), el('input', { type: 'range', min: 0.4, max: 3, step: 0.1, value: it.scale || 1, oninput: (e) => { it.scale = Number(e.target.value); save(); } }));
    return el('div', { class: `edrow${sel ? ' sel' : ''}` }, head, btns, more);
  };
  return el('div', {}, el('p', { class: 'note' }, 'Draw the yard and add trees, bushes and your car so the 3D home looks like your place. Trees and cars cast shadows in the sunlight view.'),
    el('h3', {}, 'Draw an area'),
    el('div', { class: 'row wrap' }, ...Object.entries(AREA_KINDS).map(([k, [n]]) => el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = { type: 'yard-area', kind: k, pts: [] }; editor(); } }, n))),
    y.areas.length ? el('div', {}, ...y.areas.map((a, i) => el('div', { class: 'edrow' }, el('div', { class: 'dtop' }, el('i', { class: 'swatch', style: `--rc:${AREA_KINDS[a.kind][1]}` }), el('span', {}, AREA_KINDS[a.kind][0]), el('small', {}, `${a.pts.length} corners`)),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => { y.areas.splice(i, 1); saveYard(y); } }, 'Delete'))))) : null,
    el('h3', {}, 'Add things'),
    el('div', { class: 'row wrap' }, ...Object.entries(ITEM_KINDS).map(([k, n]) => el('button', { type: 'button', class: 'mini', onclick: () => place(k) }, n))),
    ...y.items.map(row),
    y.areas.length || y.items.length ? el('p', {}, el('button', { type: 'button', class: 'mini', onclick: () => { if (confirm('Clear the whole yard?')) saveYard({ areas: [], items: [] }); } }, 'Clear the yard')) : null);
}
async function saveHidden(F, list) {
  F.f.hiddenParts = list; editor();   // right away, so quick clicks build on each other
  try { await send(`/api/floorplan/floors/${F.f.id}`, 'PUT', { hiddenParts: list }); }
  catch (e) { proErr(e); }
}
function saveRoute(id, pts) {
  const p = S.pins.find((x) => x.deviceId === id); if (!p) return;
  p.route = pts?.length ? pts : null; S.tool = null; savePins().then(drawPower);
}
async function saveRooms(F, rooms) {
  try { await send(`/api/floorplan/floors/${F.f.id}`, 'PUT', { rooms }); F.f.rooms = rooms; F.rooms = rooms; buildRoomLabels(); drawPins(); editor(); }
  catch (e) { proErr(e); }
}
const saveRoomsSoon = debounce(saveRooms, 500);
async function saveFloor(F, body) {
  try { const r = await send(`/api/floorplan/floors/${F.f.id}`, 'PUT', body); Object.assign(F.f, r.floor); styleFloor(F); }
  catch (e) { proErr(e); }
}
const savePaintSoon = debounce((F) => saveFloor(F, { paint: F.f.paint || {} }), 500);
async function saveSettings(body) {
  try { const r = await send('/api/floorplan/settings', 'PUT', body); S.plan.settings = r.settings; layout(false); editor(); }
  catch (e) { proErr(e); }
}
async function saveStyle() {
  try { await send('/api/floorplan/style', 'PUT', S.plan.style); }
  catch (e) { proErr(e); }
}
const saveStyleSoon = debounce(saveStyle, 500);

/* ---------- editor ---------- */
function setMode(m) {
  if (m === 'edit' && !S.plan.pro?.pro) { toast('The editor is part of CasaTorch Pro.'); return; }
  S.mode = m; S.tool = null; clearSel(); S.room = null; closeCard();
  document.body.classList.toggle('editing', m === 'edit');
  $('#side').hidden = true; $('#side').dataset.kind = '';
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === m);
  if (m === 'edit') editor(); else $('#left').hidden = true;
  drawPins();
}
const edFloor = () => curF() || Object.values(S.F)[0];
function editor() {
  if (S.mode !== 'edit') { clearRouteHandles(); return; }
  if (S.tool?.type !== 'route-edit') clearRouteHandles();
  const box = $('#left'); box.hidden = false;
  const tabs = [['devices', 'Devices'], ['rooms', 'Rooms'], ['yard', 'Yard'], ['colors', 'Colors'], ['floors', 'Floors']];
  const body = { devices: edDevices, rooms: edRooms, yard: edYard, colors: edColors, floors: edFloors }[S.tab]();
  const er = S.tool?.type === 'erase' ? S.tool : null;
  if (er) { const F = S.F[er.floor]; return fill(box, el('div', { class: 'hint' }, `Hiding parts of ${F?.f.name}. Click anything that shouldn't be there - a stray chair, scan noise, a wall from next door. ${er.done.length} hidden so far. Nothing is deleted from your scan; you can bring it all back.`,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => { S.tool = null; reload(); } }, 'Done'),
      el('button', { type: 'button', class: 'mini', disabled: er.done.length ? null : true, onclick: () => { const k = er.done.pop(); saveHidden(F, (F.f.hiddenParts || []).filter((x) => x !== k)); F.inner.traverse((o) => { if (o.isMesh && o.userData.key === k) o.visible = true; }); editor(); } }, 'Undo last')))); }
  const re = S.tool?.type === 'route-edit' ? S.tool : null;
  if (re) return fill(box, el('div', { class: 'hint' }, `Editing the power line to "${re.dev.name}". Drag a dot to move a bend, drag a + to add one, double-click a dot to remove it. Changes are saved as you go.`,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => { S.tool = null; clearRouteHandles(); drawPower(); editor(); } }, 'Done'),
      el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = null; clearRouteHandles(); saveRoute(re.dev.id, null); } }, 'Back to automatic'))));
  const rt = S.tool?.type === 'route' ? S.tool : null;
  if (rt) return fill(box, el('div', { class: 'hint' }, `Drawing the power line to "${rt.dev.name}". Click along the floor, in order from the panel to the device, wherever the wire really runs. ${rt.pts.length} bend${rt.pts.length === 1 ? '' : 's'} so far.`,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => saveRoute(rt.dev.id, rt.pts.length ? rt.pts : null) }, 'Done'),
      el('button', { type: 'button', class: 'mini', disabled: rt.pts.length ? null : true, onclick: () => { rt.pts.pop(); drawPower(); editor(); } }, 'Undo last bend'),
      el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = null; drawPower(); editor(); } }, 'Cancel'))));
  const ya = S.tool?.type === 'yard-area' ? S.tool : null;
  if (ya) return fill(box, el('div', { class: 'hint' }, `Drawing ${AREA_KINDS[ya.kind][0].toLowerCase()}: click its corners on the ground, one after another. ${ya.pts.length} so far${ya.pts.length < 3 ? ' - at least 3' : ''}.`,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', disabled: ya.pts.length >= 3 ? null : true, onclick: () => { const y = yardData(); y.areas.push({ id: newId(), kind: ya.kind, pts: ya.pts }); S.tool = null; yardPreview(); saveYard(y); } }, 'Finish'),
      el('button', { type: 'button', class: 'mini', disabled: ya.pts.length ? null : true, onclick: () => { ya.pts.pop(); yardPreview(); editor(); } }, 'Undo last corner'),
      el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = null; yardPreview(); editor(); } }, 'Cancel'))));
  const hint = S.tool?.type === 'yard-place' ? `Click on the ground where the ${ITEM_KINDS[S.tool.kind].toLowerCase()} goes.` : S.tool?.type === 'yard-move' ? 'Click on the ground where it should go.' : S.tool?.type === 'panel' ? 'Click where the electrical panel is (a wall or the floor next to it).' : S.tool?.type === 'device' ? `Click on the model where "${S.tool.dev.name}" is.` : S.tool?.type === 'room' ? 'Click the middle of the room on the model.' : S.tool?.type === 'paint' ? 'Click any wall, floor, door or piece of furniture.' : null;
  fill(box, el('div', { class: 'tabs' }, ...tabs.map(([k, n]) => el('button', { type: 'button', class: S.tab === k ? 'on' : '', onclick: () => { S.tab = k; S.tool = k === 'colors' && S.tool?.type === 'paint' ? S.tool : null; if (k !== 'colors') clearSel(); editor(); drawPins(); } }, n))),
    hint ? el('div', { class: 'hint' }, hint, el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = null; editor(); drawPins(); } }, 'Cancel')) : null, body);
}
function floorPicker() {
  if (Object.keys(S.F).length < 2) return null;
  const s = el('select', { onchange: (e) => { pickFloor(e.target.value); editor(); } }, ...Object.values(S.F).map((F) => el('option', { value: F.f.id, selected: edFloor() === F ? true : null }, F.f.name)));
  return el('div', { class: 'row' }, el('label', {}, 'Floor'), s);
}
function edDevices() {
  const placed = new Map(S.pins.map((p) => [p.deviceId, p])), q = S.q.toLowerCase();
  const devs = (S.live?.devices || []).filter((d) => !q || `${d.name} ${d.id}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const search = el('input', { type: 'search', placeholder: 'Search devices', value: S.q });
  search.oninput = () => { S.q = search.value; editor(); const n = $('#left input[type=search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  const pick = (d) => { S.tool = { type: 'device', dev: d }; editor(); drawPins(); };
  const placedRow = (d) => { const p = placed.get(d.id), active = S.tool?.dev?.id === d.id;
    return el('div', { class: `edrow${active ? ' sel' : ''}` }, el('div', { class: 'dtop' }, ic(iconOf(d)), el('input', { type: 'text', value: p.label || '', placeholder: d.name, title: 'Name on the plan', oninput: (e) => { p.label = e.target.value.trim() || null; savePinsSoon(); } }),
      d.kind === 'light' ? el('input', { type: 'color', value: p.color || '#ffc477', title: 'Glow color', oninput: (e) => { p.color = e.target.value; savePinsSoon(); } }) : null),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => pick(d) }, 'Move'), POWERED.has(d.kind) ? el('button', { type: 'button', class: 'mini', title: 'Move the power line\'s bends to where the wire really runs', onclick: () => routeEdit(d) }, 'Edit power line') : null,
      p.route ? el('button', { type: 'button', class: 'mini', title: 'Back to the automatic route', onclick: () => saveRoute(d.id, null) }, 'Auto line') : null,
      el('button', { type: 'button', class: 'mini', onclick: () => { S.pins = S.pins.filter((x) => x.deviceId !== d.id); savePins(); } }, 'Remove'), el('small', {}, S.F[p.floor]?.f.name || ''))); };
  const free = devs.filter((d) => !placed.has(d.id)), on = devs.filter((d) => placed.has(d.id));
  const sugg = autoPlaces(free);
  return el('div', {}, el('p', { class: 'note' }, 'Pick a device, then click where it really is. Lights glow on the plan when they are on; power lines run to everything that uses electricity.'), search,
    el('div', { class: 'edrow' }, el('div', { class: 'dtop' }, ic('plug'), el('b', {}, 'Electrical panel'), el('small', {}, S.plan.settings?.panel ? 'placed' : 'front corner')),
      el('p', { class: 'note' }, 'Where the power comes into the house. The power lines start here.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = { type: 'panel', dev: { id: '_panel', name: 'the electrical panel' } }; editor(); } }, S.plan.settings?.panel ? 'Move' : 'Place it'),
        S.plan.settings?.panel ? el('button', { type: 'button', class: 'mini', onclick: () => saveSettings({ panel: null }) }, 'Reset') : null)),
    sugg.length ? el('div', { class: 'edrow' }, el('div', { class: 'dtop' }, ic('dot'), el('b', {}, `${sugg.length} can go straight into their rooms`)),
      el('p', { class: 'note' }, 'Home Assistant already knows which room these are in, and you have rooms with the same names. Place them in the middle of their rooms, then drag each one to the exact spot.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => { S.pins = S.pins.concat(sugg.map((x) => x.pin)); savePins(); toast(`Placed ${sugg.length} devices. Drag any of them to move it.`); } }, `Place ${sugg.length}`))) : null,
    el('h3', {}, `On the plan (${on.length})`), ...on.map(placedRow),
    el('h3', {}, `Not placed (${free.length})`), ...free.map((d) => el('button', { type: 'button', class: `edrow pick${S.tool?.dev?.id === d.id ? ' sel' : ''}`, onclick: () => pick(d) }, ic(iconOf(d)), d.name, el('small', {}, d.provider))));
}
/* Devices Home Assistant has in an area whose name matches one of your rooms: placed in a little ring
   around the room's centre, at about light-switch height, ready to drag into place. */
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function autoPlaces(free) {
  const rooms = Object.values(S.F).flatMap((F) => F.rooms.map((r, i) => ({ F, r, i, n: norm(r.name) }))), by = new Map(), out = [];
  for (const d of free) {
    const a = norm(d.area); if (!a) continue;
    const m = rooms.find((x) => x.n === a) || rooms.find((x) => x.n && (x.n.includes(a) || a.includes(x.n)));
    if (m) { const k = `${m.F.f.id}:${m.i}`; by.set(k, [...(by.get(k) || []), [d, m]]); }
  }
  for (const list of by.values()) list.forEach(([d, { F, r }], j) => {
    const ang = (j / list.length) * Math.PI * 2, rad = list.length > 1 ? 0.45 + list.length * 0.06 : 0;
    out.push({ d, pin: { deviceId: d.id, floor: F.f.id, pos: [r.pos[0] + Math.cos(ang) * rad, F.floorY + 1.2, r.pos[1] + Math.sin(ang) * rad].map((n) => +n.toFixed(3)) } });
  });
  return out;
}
function edRooms() {
  const F = edFloor(); if (!F) return el('p', { class: 'note' }, 'Add a floor first (Floors tab).');
  const rooms = F.rooms.map((r) => ({ ...r }));
  const save = () => saveRoomsSoon(F, rooms);
  const list = rooms.map((r, i) => el('div', { class: 'edrow' }, el('div', { class: 'dtop' },
    el('input', { type: 'color', value: r.color || ROOM_COLORS[i % ROOM_COLORS.length], title: 'Room color', oninput: (e) => { r.color = e.target.value; F.rooms = rooms; roomUniforms(F); save(); } }),
    el('input', { type: 'text', value: r.name, maxlength: 30, 'data-room': i, oninput: (e) => { r.name = e.target.value; save(); } })),
  el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = { type: 'room', i, floor: F.f.id }; editor(); } }, 'Move'), el('button', { type: 'button', class: 'mini', onclick: () => focusRoomEdit(F, i) }, 'Show'), el('button', { type: 'button', class: 'mini', onclick: () => { rooms.splice(i, 1); saveRooms(F, rooms); } }, 'Delete'))));
  if (S.focusName != null) setTimeout(() => { const n = $(`#left input[data-room="${S.focusName}"]`); n?.focus(); n?.select(); S.focusName = null; }, 0);
  return el('div', {}, floorPicker(), el('p', { class: 'note' }, 'Rooms color the floor, group devices, and show up as buttons in the 3D view. Devices belong to the nearest room center.'),
    ...list, el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', onclick: () => { S.tool = { type: 'room', i: -1, floor: F.f.id }; editor(); } }, 'Add a room'),
      F.detected.length ? el('button', { type: 'button', onclick: () => { if (confirm('Replace these rooms with the ones found in the scan?')) saveRooms(F, F.detected); } }, 'Use rooms from scan') : null));
}
function focusRoomEdit(F, i) { const r = F.rooms[i], w = F.G.localToWorld(new V3(r.pos[0], F.minY, r.pos[1])); flyTo(w, w.clone().add(new V3(3, 7, 5))); }
function edColors() {
  const theme = curTheme(), style = (S.plan.style ||= { theme: 'real', colors: {} }), L = look();
  style.colors ||= {};
  const F = S.sel && S.F[S.sel.floor], selName = S.sel ? prettyItem(S.sel.key) : null;
  return el('div', {},
    el('h3', {}, 'Look'), seg(Object.entries(THEMES).map(([k, t]) => [k, t.label]), theme, (v) => { prefs.theme = v; savePrefs(); style.theme = v; saveStyleSoon(); applyLook(); editor(); }),
    el('p', { class: 'note' }, 'Everyone sees this look unless they pick another one at the top of the 3D view.'),
    el('h3', {}, `${THEMES[theme].label} colors`),
    ...COLOR_KEYS.map(([k, label]) => el('div', { class: 'row' }, el('label', {}, label), el('input', { type: 'color', value: L[k], oninput: (e) => { (style.colors[theme] ||= {})[k] = e.target.value; applyLook(); saveStyleSoon(); } }))),
    el('button', { type: 'button', class: 'mini', onclick: () => { delete style.colors[theme]; applyLook(); saveStyleSoon(); editor(); } }, 'Reset to defaults'),
    el('h3', {}, 'Roof, power and glow'),
    el('div', { class: 'row' }, el('label', {}, 'Roof'), el('input', { type: 'color', value: style.extras?.roof || (theme === 'day' ? '#8a5a44' : '#1e2b4f'), oninput: (e) => { (style.extras ||= {}).roof = e.target.value; buildRoofs(); layout(false); saveStyleSoon(); } })),
    el('div', { class: 'row' }, el('label', {}, 'Power lines'), el('input', { type: 'color', value: style.extras?.flow || L.flow, oninput: (e) => { (style.extras ||= {}).flow = e.target.value; drawPower(); saveStyleSoon(); } })),
    el('div', { class: 'row' }, el('label', {}, 'Light glow'), el('input', { type: 'range', min: 0.3, max: 2.5, step: 0.1, value: style.extras?.glow || 1, oninput: (e) => { (style.extras ||= {}).glow = Number(e.target.value); drawPins(); saveStyleSoon(); } })),
    el('h3', {}, 'Paint one thing'),
    el('button', { type: 'button', class: S.tool?.type === 'paint' ? 'primary' : '', onclick: () => { S.tool = S.tool?.type === 'paint' ? null : { type: 'paint' }; if (!S.tool) clearSel(); editor(); } }, S.tool?.type === 'paint' ? 'Painting - click things on the model' : 'Pick something to paint'),
    F ? el('div', { class: 'edrow sel' }, el('div', { class: 'dtop' }, el('b', {}, selName), el('small', {}, `${F.items.get(S.sel.key)?.[0]?.userData.cat || ''} · ${F.f.name}`)),
      el('div', { class: 'row' }, el('input', { type: 'color', value: F.f.paint?.[S.sel.key] || '#ffffff', oninput: (e) => { (F.f.paint ||= {})[S.sel.key] = e.target.value; styleFloor(F); savePaintSoon(F); } }),
        el('button', { type: 'button', class: 'mini', onclick: () => { if (F.f.paint) delete F.f.paint[S.sel.key]; styleFloor(F); savePaintSoon(F); editor(); } }, 'Reset'))) : null);
}
function edFloors() {
  const file = el('input', { type: 'file', multiple: true, accept: '.usdz,.usd,.usdc,.usda,.glb,.gltf,.obj,.mtl,.zip,.bin,.png,.jpg,.jpeg,.webp,model/gltf-binary,model/gltf+json,application/zip', onchange: () => upload() }), name = el('input', { type: 'text', placeholder: 'Ground floor' });
  async function upload() {
    if (!file.files.length) { toast('Choose the file from your scan first.'); return; }
    toast('Preparing the model…');
    try { const m = await toGlb(file.files); toast(`Uploading (${Math.max(1, Math.round(m.blob.size / 1e6))} MB)…`); await api(`/api/floorplan/floors?name=${encodeURIComponent(name.value || m.name)}`, { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: m.blob }); await reload(); toast('Floor added.'); }
    catch (e) { proErr(e); }
  }
  const put = (f, body) => send(`/api/floorplan/floors/${f.id}`, 'PUT', body).then(reload).catch(proErr);
  return el('div', {},
    ...S.plan.floors.map((f) => { const F = S.F[f.id];
      const n = (k, label, step) => el('div', { class: 'row' }, el('label', {}, label), el('input', { type: 'number', step, value: k === 'offsetX' ? f.offset[0] : k === 'offsetZ' ? f.offset[1] : f[k], onchange: (e) => { const v = Number(e.target.value); put(f, k === 'offsetX' ? { offset: [v, f.offset[1]] } : k === 'offsetZ' ? { offset: [f.offset[0], v] } : { [k]: v }); } }));
      return el('div', { class: 'card' }, el('div', { class: 'row' }, el('label', {}, 'Name'), el('input', { type: 'text', value: f.name, maxlength: 40, onchange: (e) => put(f, { name: e.target.value }) })),
        n('level', 'Level', 1), n('heightM', 'Height (m)', 0.1), n('rotationY', 'Turn (°)', 5), n('scale', 'Scale', 0.01), n('offsetX', 'Shift X (m)', 0.1), n('offsetZ', 'Shift Z (m)', 0.1),
        f.kind !== 'drawn' ? el('div', { class: 'row' }, el('label', {}, 'Colors'), el('select', { onchange: (e) => put(f, { look: e.target.value }) }, ...[['auto', 'Automatic'], ['styled', 'Styled (theme)'], ['original', 'Scan\'s own colors']].map(([v, t]) => el('option', { value: v, selected: (f.look || 'auto') === v ? true : null }, t)))) : null,
        f.kind !== 'drawn' ? el('div', { class: 'row' }, el('label', {}, 'Clean up'), el('button', { type: 'button', class: 'mini', onclick: () => { pickFloor(f.id); S.tool = { type: 'erase', floor: f.id, done: [] }; editor(); } }, 'Hide parts…'),
          f.hiddenParts?.length ? el('button', { type: 'button', class: 'mini', onclick: () => put(f, { hiddenParts: [] }) }, `Show all ${f.hiddenParts.length} again`) : null) : null,
        F?.original && f.look !== 'original' ? el('p', { class: 'note' }, 'This scan has no named walls or furniture, so it shows in its own colors.') : null,
        el('div', { class: 'row' }, f.kind === 'drawn' ? el('button', { type: 'button', class: 'primary', onclick: () => openDrawer(f, drawOpts()) }, 'Edit drawing') : null,
          el('button', { type: 'button', onclick: async () => { if (!confirm(`Remove ${f.name}?`)) return; await api(`/api/floorplan/floors/${f.id}`, { method: 'DELETE' }).catch(proErr); await reload(); } }, 'Remove floor'))); }),
    el('h3', {}, 'Which way is north'),
    el('p', { class: 'note' }, 'So sunlight and shadows fall the way they really do. Pick the direction north is in, looking at the view as it opens.'),
    seg([[0, 'Ahead'], [90, 'Right'], [180, 'Behind'], [270, 'Left']], S.plan.settings?.northDeg || 0, (v) => saveSettings({ northDeg: v }).then(() => { skyAt = 0; })),
    el('h3', {}, 'Front of the house'),
    el('p', { class: 'note' }, 'Which way the 3D view looks into the house when it opens.'),
    seg([[0, 'Front'], [90, 'Right'], [180, 'Back'], [270, 'Left']], S.plan.settings?.frontDeg || 0, (v) => saveSettings({ frontDeg: v }).then(() => fitView())),
    el('h3', {}, 'Add a floor'),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', onclick: () => newDrawnFloor(false) }, 'Draw a floor'), el('button', { type: 'button', onclick: () => newDrawnFloor(true) }, 'Trace a picture')),
    el('h3', {}, 'Or upload a LiDAR scan'), el('div', { class: 'row' }, el('label', {}, 'Name'), name), file,
    el('p', { class: 'note' }, 'USDZ, GLB, GLTF, OBJ or a .zip of any of them. Scans from Apple RoomPlan apps (LiDarPlan, KIRI Engine Room Scan, Lagarsoft) come with walls, doors, furniture and rooms already named.'),
    el('p', { class: 'note' }, 'Floors stack by Level × Height. If a floor sits crooked or off to the side, adjust Turn and Shift until the walls line up.'));
}
const drawOpts = () => ({ el, api, toast, onSave: reload });
async function newDrawnFloor(withPicture) {
  try {
    const r = await send('/api/floorplan/floors/drawn', 'POST', { name: S.plan.floors.length ? `Floor ${S.plan.floors.length + 1}` : 'Ground floor' });
    S.plan = await api('/api/floorplan'); openDrawer(r.floor, drawOpts());
    if (withPicture) setTimeout(() => document.querySelector('#drawer input[type=file]')?.click(), 200);
  } catch (e) { proErr(e); }
}
function guidePanel() {
  const side = $('#side'); side.hidden = false; side.dataset.kind = 'guide';
  fill(side, el('div', { class: 'rhead' }, el('h2', {}, 'Your home in 3D'), el('button', { type: 'button', class: 'iconbtn', onclick: () => { side.hidden = true; side.dataset.kind = ''; } }, ic('close'))),
    el('p', { class: 'note' }, 'Two ways - pick whichever suits you. You can mix them: scan one floor, draw another.'),
    el('h3', {}, 'A. Scan it (iPhone Pro / iPad Pro with LiDAR)'),
    el('ol', { class: 'guide' },
      el('li', {}, 'Install a free room-scanning app built on Apple RoomPlan, e.g. ', el('b', {}, 'LiDarPlan'), ', ', el('b', {}, 'KIRI Engine'), ' (Room Scan) or ', el('b', {}, 'Lagarsoft LiDAR Scanner'), '.'),
      el('li', {}, 'Scan one floor at a time: lights on, interior doors open, walk slowly and point at every corner.'),
      el('li', {}, 'Export as ', el('b', {}, 'GLB'), ' or ', el('b', {}, 'USDZ'), ' and send it to this computer (AirDrop, e-mail, iCloud Drive).'),
      el('li', {}, 'Open ', el('b', {}, 'Editor > Floors'), ' and upload it. Walls, furniture and rooms are recognized automatically.')),
    el('h3', {}, 'B. Draw it (any device)'),
    el('ol', { class: 'guide' }, el('li', {}, el('b', {}, 'Editor > Floors > Draw a floor'), '. Drag to draw each room (grid squares are 1 m), or trace over a picture of your floor plan.')),
    el('h3', {}, 'Then make it yours'),
    el('ol', { class: 'guide' }, el('li', {}, el('b', {}, 'Devices'), ': pick one, click where it is.'), el('li', {}, el('b', {}, 'Rooms'), ': rename and color them, or add your own.'), el('li', {}, el('b', {}, 'Colors'), ': choose Real life, Blueprint, or Day, change any color, or paint a single wall or sofa.')),
    S.plan.pro?.pro ? el('p', {}, el('button', { type: 'button', class: 'primary', onclick: () => { setMode('edit'); S.tab = 'floors'; editor(); } }, 'Open the editor')) : el('p', { class: 'note' }, 'The editor is part of CasaTorch Pro.'));
}

/* ---------- live data ---------- */
function drawTotals() {
  const t = S.live?.totals || {};
  fill($('#totals'), el('span', { class: 'stat' }, el('small', {}, 'Power'), `${t.powerW ?? 0} W`), el('span', { class: 'stat warm' }, el('small', {}, 'Lights'), `${t.lightsOn ?? 0} on`),
    ...(t.playing || []).slice(0, 1).map((p) => el('span', { class: 'stat music' }, el('small', {}, 'Playing'), p.title || p.name)),
    ...(t.openDoors ? [el('span', { class: 'stat bad' }, el('small', {}, 'Open'), `${t.openDoors}`)] : []), ...(t.leaks ? [el('span', { class: 'stat bad' }, el('small', {}, 'Leak'), '!')] : []));
}
async function refresh() {
  try { S.live = await api('/api/floorplan/live'); S.pins = (S.live.pins || []).map(({ deviceId, floor, pos, label, color, route }) => ({ deviceId, floor, pos, label, color, route })); drawPins(); drawTotals(); if (S.mode === 'edit' && S.tab === 'devices' && !$('#left').contains(document.activeElement)) editor(); }
  catch { /* next time */ }
}
function drawThemeSeg() { $('#themeSeg').replaceChildren(seg(Object.entries(THEMES).map(([k, t]) => [k, t.label]), curTheme(), (v) => { prefs.theme = v; savePrefs(); applyLook(); drawThemeSeg(); drawTools(); if (S.mode === 'edit') editor(); })); }
async function reload() { S.plan = await api('/api/floorplan'); await loadFloors(); await refresh(); drawThemeSeg(); if (S.mode === 'edit') editor(); }
async function start() {
  try { const { lang } = await api('/api/lang'); if (lang) await CasaI18n.use(lang); } catch { /* keep this browser's choice */ }
  for (const b of document.querySelectorAll('#modeSeg button')) b.textContent = T(b.dataset.mode === 'edit' ? 'Editor' : '3D');
  $('#guideBtn').textContent = T('Help');
  S.plan = await api('/api/floorplan'); adoptServerView(S.plan.view);
  units = S.plan.units || 'F';
  if (!S.plan.units) try { units = (await api('/api/status')).units || 'F'; } catch { /* default */ }
  drawThemeSeg();
  await loadFloors(); await refresh();
  if (!S.plan.floors.length || location.hash === '#guide') guidePanel();
  if (location.hash === '#edit') setMode('edit');
  if (new URLSearchParams(location.search).has('embed')) document.querySelector('.brand').target = '_top';
  if (!S.plan.pro?.pro) toast('3D Home is part of CasaTorch Pro - look around the demo, then upgrade to use your own home.');
}
for (const b of document.querySelectorAll('#modeSeg button')) b.onclick = () => setMode(b.dataset.mode);
$('#guideBtn').onclick = guidePanel;
start(); setInterval(refresh, 5000);
