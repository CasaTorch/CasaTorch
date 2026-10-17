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
const mergeGlb = async (...a) => (await import('./floorplan-import.js')).mergeGlb(...a);
import { Yard, AREA_KINDS, ITEM_KINDS } from './floorplan-yard.js';
import { buildRoof, PowerNet, weatherIcon, sunPosition, nightness, kelvinToHex, WeatherFx, SkyDome, moonPhase } from './floorplan-house.js';
import { createDock, createImmersive } from './floorplan-dock.js';
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
const api = async (url, opts = {}) => { await undoBefore(url, String(opts.method || 'GET').toUpperCase()); const r = await fetch(url, opts); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j }); return j; };
const send = (url, method, body) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const toast = (t) => { const x = el('div', { class: 'toast' }, t); document.body.append(x); setTimeout(() => x.remove(), 3500); };
const proErr = (e) => toast(e.status === 402 ? 'Editing the 3D home is part of CasaTorch Pro.' : e.message);
const V3 = THREE.Vector3, deg = THREE.MathUtils.degToRad;
const fill = (node, ...kids) => { node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); return node; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
/* Free what a 3D object holds on the graphics card: its shapes, materials and their pictures (all of its parts too).
   keep: materials or textures shared with other things, left alone. Labels on it are taken off the page. */
const TEX_KEYS = ['map', 'alphaMap', 'aoMap', 'bumpMap', 'emissiveMap', 'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap'];
function disposeMaterial(m, keep) {
  if (!m || keep?.has(m)) return;
  for (const k of TEX_KEYS) if (m[k]?.isTexture && !keep?.has(m[k])) m[k].dispose();
  m.dispose();
}
function disposeTree(root, keep) {
  if (!root) return;
  root.traverse((o) => {
    if (o.isCSS2DObject) o.element.remove();
    o.geometry?.dispose();
    for (const m of [o.material].flat()) disposeMaterial(m, keep);
    for (const k of ['full', 'own', 'ownLow']) if (o.userData?.[k]?.isMaterial) disposeMaterial(o.userData[k], keep);
  });
}

/* ---------- icons (simple line icons, our own) ---------- */
const PATHS = { clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4', grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01', grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', shrink: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0', note: 'M4 4h16v12l-4 4H4zM16 20v-4h4', calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4', light: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', media: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  thermo: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z', camera: 'M23 7l-7 5 7 5zM1 5h15v14H1z', door: 'M3 21h18M6 21V3h12v18M14 12h.01', drop: 'M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  fan: 'M12 10V3M14 12h7M12 14v7M10 12H3M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0', cover: 'M4 3h16M5 3v14M19 3v14M5 7h14M5 11h14M5 15h14M12 17v4', sensor: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z', car: 'M5 17h14M3 13l2-5h14l2 5v4H3zM7 17v2M17 17v2M7 13h.01M17 13h.01', home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6', walk: 'M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9 21l2-6 3 3v3M7 12l3-5 4 2 2 4M10 7l-2 6',
  dot: 'M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0', close: 'M6 6l12 12M18 6L6 18', back: 'M15 18l-6-6 6-6' };
const ic = (n) => { const s = el('span', { class: 'ic' }); s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[n] || PATHS.dot}"/></svg>`; return s; };
const iconOf = (d) => d.water != null || d.kind === 'leak' ? 'drop' : d.kind === 'light' ? 'light' : ['plug', 'switch'].includes(d.kind) ? 'plug' : d.kind === 'media' ? 'media' : d.kind === 'climate' ? 'thermo' : d.kind === 'camera' ? 'camera'
  : d.kind === 'lock' ? 'lock' : d.kind === 'fan' ? 'fan' : d.kind === 'cover' ? 'cover' : d.open != null ? 'door' : d.tempC != null ? 'thermo' : d.kind === 'sensor' ? 'sensor' : 'dot';

/* ---------- scene ---------- */
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.localClippingEnabled = true;
/* Speed: shadows are drawn again only when something that casts them changes (not every frame), and the picture is
   drawn only when it changes - full speed while you turn the view, gentle when only power lines or rain are moving. */
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
/* Slower screens (a wall tablet, an old laptop) step down by themselves: if turning the view runs under ~22 frames a second
   the picture gets a little softer, then shadows switch off. The step is remembered on this screen. */
const Q = { ratios: [Math.min(1.5, devicePixelRatio), Math.min(1, devicePixelRatio), 0.75], i: 0, noShadow: false, frames: [], busy: false };
try { const v = JSON.parse(localStorage.getItem('casatorch-3d-quality') || 'null'); if (v) { Q.i = Math.min(2, v.i | 0); Q.noShadow = !!v.noShadow; } } catch { /* fine */ }
renderer.setPixelRatio(Q.ratios[Q.i]); view.append(renderer.domElement);
const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; view.append(labels.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600); camera.position.set(14, 16, 22);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 2; controls.maxDistance = 150;
const hemi = new THREE.HemisphereLight('#fff', '#000', 1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffffff', 0.6); sun.position.set(12, 30, 18); scene.add(sun); scene.add(sun.target);
sun.shadow.mapSize.set(2048, 2048); sun.shadow.autoUpdate = true; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
let grid = new THREE.Group(); scene.add(grid);
/* On a wide screen the house is framed in the space right of the control panel, not behind it. */
const resize = () => { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; if (w > 900) camera.setViewOffset(w, h, -150, 0, w, h); else camera.clearViewOffset(); camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
let tween = null, wallsDirty = true, wallsAt = 0, lastT = 0, skyAt = 0, flash = 0, flashWas = 0, dirty = true, drawnAt = 0;
const kick = () => { dirty = true; };
controls.addEventListener('start', () => { Q.busy = true; Q.frames = []; }); controls.addEventListener('end', () => { Q.busy = false; });
function lowerQuality() {
  if (Q.i < Q.ratios.length - 1 && Q.ratios[Q.i + 1] < Q.ratios[Q.i]) { Q.i++; renderer.setPixelRatio(Q.ratios[Q.i]); resize(); }
  else if (!Q.noShadow) { Q.noShadow = true; skyAt = 0; } else return;
  try { localStorage.setItem('casatorch-3d-quality', JSON.stringify({ i: Q.i, noShadow: Q.noShadow })); } catch { /* fine */ }
}
const reshadow = () => { renderer.shadowMap.needsUpdate = true; dirty = true; };
let clusterDirty = true, clusterAt = 0;
function clusterPins() {
  const on = S.mode === 'view' && !S.room, w = view.clientWidth, h = view.clientHeight, items = [], v = new V3();
  for (const o of S.pinObjs) {
    const e = o.element; e.classList.remove('clustered'); delete e.dataset.n; o.userData.cluster = null;
    if (!on || !o.visible) continue;
    o.getWorldPosition(v).project(camera); if (v.z > 1) continue;
    items.push({ o, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, pri: e.classList.contains('alarm') ? 3 : e.classList.contains('say') ? 2 : e.classList.contains('act') ? 1 : 0 });
  }
  items.sort((a, b) => b.pri - a.pri);
  const lead = [];
  for (const it of items) { const L = lead.find((l) => Math.abs(l.x - it.x) < 34 && Math.abs(l.y - it.y) < 28); if (L) { L.m.push(it.o); it.o.element.classList.add('clustered'); } else lead.push({ ...it, m: [it.o] }); }
  for (const L of lead) if (L.m.length > 1) { L.o.element.dataset.n = String(L.m.length); L.o.userData.cluster = L.m; }
}
function zoomToPins(list) {   // fly in until the bubble's devices sit apart
  const c = new V3(); for (const o of list) c.add(o.getWorldPosition(new V3())); c.divideScalar(list.length);
  const back = camera.position.clone().sub(controls.target), d = Math.max(3, back.length() * 0.4);
  flyTo(c, c.clone().add(back.normalize().multiplyScalar(d)));
}
controls.addEventListener('change', () => { wallsDirty = true; dirty = true; clusterDirty = true; });
addEventListener('resize', kick);
const power = new PowerNet(scene), weather = new WeatherFx(scene), yard = new Yard(scene), skyDome = new SkyDome(scene); 
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const flyTo = (target, pos, ms = 750) => { if (calm) ms = 1; tween = { t0: performance.now(), ms, ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: pos }; };
(function loop(now) {
  requestAnimationFrame(loop);
  if (document.getElementById('drawer')) return;   // drawing on top: let the 3D rest
  if (tween) { const k = Math.min(1, (now - tween.t0) / tween.ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; controls.target.lerpVectors(tween.ft, tween.tt, e); camera.position.lerpVectors(tween.fp, tween.tp, e); if (k >= 1) tween = null; }
  controls.update();
  if (wallsDirty && now - wallsAt > 120) { wallsDirty = false; wallsAt = now; for (const F of Object.values(S.F)) applyWalls(F); }
  const moving = (power.flows.length && power.group.visible) || !!weather.points?.visible || (yard.group.visible && wxOn() && yard.group.children.length);
  if (!dirty && !tween && !flash && !flashWas && now - drawnAt < (moving ? 40 : 250)) return;   // nothing new to draw yet
  power.tick(now / 1000);
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  flash = weather.tick(dt, now / 1000, S.live?.weather?.windMs != null ? windToward().multiplyScalar(S.live.weather.windMs) : null);
  if (skyDome.visible) skyDome.tick(now / 1000, camera);
  if (S.plan && yard.group.visible && wxOn()) yard.wind(now / 1000, S.live?.weather?.windMs, windToward());
  if (now - skyAt > 2000 || flash || flashWas) { skyAt = now; updateSky(); } flashWas = flash;
  if (yard.group.visible && wxOn() && yard.group.children.length && now - (S.treeShadowAt || 0) > 500) { S.treeShadowAt = now; renderer.shadowMap.needsUpdate = true; }   // swaying trees
  renderer.render(scene, camera); labels.render(scene, camera); dirty = false; drawnAt = now;
  if (clusterDirty && now - clusterAt > 120) { clusterDirty = false; clusterAt = now; clusterPins(); }
  if (Q.busy) { Q.frames.push(now); if (Q.frames.length >= 24) { const ms = (Q.frames[Q.frames.length - 1] - Q.frames[0]) / (Q.frames.length - 1); Q.frames = []; if (ms > 45) lowerQuality(); } }
  if (card) card.o.element.style.zIndex = '100000';   // the open card stays above every pin
})(0);

/* ---------- look ---------- */
/* The editing look: in the editor (except the Colors tab, where you're choosing colors) the house switches to the bright,
   flat Day look - no night sky, sun shadows or weather - with the near walls lowered, so walls, floors and pins are easy to
   see and click. Your own look comes back when you leave the editor. Nothing about your look is changed or saved. */
function editLook() { return S.mode === 'edit' && S.tab !== 'colors' && prefs.editLook !== false; }   // (a function: the drawing loop asks before this line has run)
const curTheme = () => (editLook() ? 'day' : baseTheme());
const baseTheme = () => { const t = prefs.theme === 'blueprint' ? 'night' : prefs.theme; return THEMES[t] ? t : S.plan?.style?.theme in THEMES ? S.plan.style.theme : 'real'; };
function isReal() { return !!THEMES[curTheme()]?.real; }
/* Real life always follows the sun and shows the yard and the weather; the drawings let you choose. */
function sunOn() { return !editLook() && (prefs.sun || isReal()); }
function yardOn() { return prefs.yard || isReal(); }
function wxOn() { return !editLook() && (prefs.weatherFx || isReal()); }
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
  return [top, horizon];
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
  if (!scene.fog) return;   // the look isn't set up yet (the floors are still loading)
  const L = look(), w = S.live?.weather, theme = curTheme();
  let k = 0, el = 0.9, az = 2.4;
  if (sunOn() && w?.lat != null && w?.lon != null) { const sp = sunPosition(S.timeAt || new Date(), w.lat, w.lon); el = sp.el; az = sp.az; k = nightness(el); }
  /* Clouds: the forecast's cloud cover where there is one, else from the kind of weather. Cloud dims the sun and softens
     shadows (an overcast day has none), rain darkens the sky and wets the lawn. */
  const wk = w?.kind, fx = wxOn();
  const cover = !fx ? 0.12 : w?.cloudPct != null ? Math.max(0, Math.min(1, w.cloudPct / 100)) : ({ sun: 0.05, moon: 0.05, partly: 0.4, cloud: 0.85, fog: 0.8, rain: 0.95, storm: 1, snow: 0.9 }[wk] ?? 0.3);
  const dark = fx ? ({ rain: 0.75, storm: 1, snow: 0.3, fog: 0.2 }[wk] || 0) : 0;
  const north = deg(S.plan?.settings?.northDeg || 0), dir = new V3(Math.sin(az) * Math.cos(Math.max(el, 0.05)), Math.sin(Math.max(el, 0.05)), -Math.cos(az) * Math.cos(Math.max(el, 0.05))).applyAxisAngle(new V3(0, 1, 0), -north);
  const B = S.sceneBox || S.houseBox, c = B ? B.getCenter(new V3()) : new V3(), R = B ? B.getSize(new V3()).length() * 0.6 + 4 : 20;
  const sunDir = dir.clone().normalize();
  const sunWas = sun.position.clone(); sun.position.copy(c).add(dir.multiplyScalar(R * 2)); sun.target.position.copy(c); sun.target.updateMatrixWorld();
  if (sunWas.distanceToSquared(sun.position) > 1e-4) reshadow(); else kick();
  const cam = sun.shadow.camera; if (cam.right !== R) { cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.5; cam.far = R * 4; cam.updateProjectionMatrix(); }
  const lowSun = Math.min(1, Math.max(0, el / 0.45)), day = 1 - k;
  if (Math.abs((S.night ?? -1) - k) > 0.05) { S.night = k; drawBeams(); }
  sun.color.set('#ffb36b').lerp(new THREE.Color('#ffffff'), lowSun);
  sun.intensity = (sunOn() ? L.sun * 1.7 * Math.min(1, Math.max(0, Math.sin(el) * 2.4)) : L.sun) * (1 - 0.8 * cover ** 1.6);
  const cast = !Q.noShadow && sunOn() && sun.intensity > 0.05 && cover < 0.86; if (sun.castShadow !== cast) { sun.castShadow = cast; reshadow(); }
  hemi.intensity = L.hemi[2] * (0.32 + 0.68 * day) * (1 + 0.18 * cover - 0.25 * dark) + flash * 2.5;
  const nightMix = { day: 0.92, night: 0.55, blueprint: 0.35, real: 0.95 }[theme] ?? 0.5;
  if (L.real) {
    const [top, horizon] = skyPaint(k, lowSun);
    let moonDir = new V3(0, -1, 0); const phase = moonPhase(S.timeAt || new Date());
    if (w?.lat != null && w?.lon != null) { const mp = sunPosition(new Date((S.timeAt || new Date()).getTime() - phase * 24.84 * 3600_000), w.lat, w.lon); moonDir = new V3(Math.sin(mp.az) * Math.cos(mp.el), Math.sin(mp.el), -Math.cos(mp.az) * Math.cos(mp.el)).applyAxisAngle(new V3(0, 1, 0), -north); }
    skyDome.update({ top, horizon, sunDir, moonDir, sunEl: el, night: k, cover, dark, phase, wind: windToward(), windMs: w?.windMs });
    skyDome.visible = true; scene.background = horizon.clone();
    scene.fog.color.copy(horizon).lerp(new THREE.Color(k > 0.5 ? '#0b0f18' : '#9aa3ad'), cover * 0.6);
    const fogNear = wk === 'fog' && fx ? 18 : 60, fogFar = wk === 'fog' && fx ? 110 : wk === 'rain' || wk === 'storm' ? 200 : 260; if (scene.fog.near !== fogNear || scene.fog.far !== fogFar) { scene.fog.near = fogNear; scene.fog.far = fogFar; }
    if (grid.isMesh) grid.material.color.set(L.ground).multiplyScalar((0.25 + 0.75 * day) * (1 - 0.22 * dark));
  }
  else { skyDome.visible = false; scene.background = new THREE.Color(L.bg).lerp(new THREE.Color('#04060d'), k * nightMix); scene.fog.color.copy(scene.background); for (const m of [grid.material].flat().filter(Boolean)) { m.transparent = true; m.opacity = 1 - k * 0.75; } }
  renderer.toneMappingExposure = L.real ? (0.75 + 0.35 * day) * (1 - 0.12 * cover) : 1;
  const boost = 1 + k * 0.9;
  if (Math.abs(boost - (S.glowBoost || 1)) > 0.05) { S.glowBoost = boost; drawPins(); }
  document.documentElement.dataset.night = k > 0.5 ? '1' : '0';
}
function applyLook() {
  const L = look();
  scene.background = new THREE.Color(L.bg); scene.fog = new THREE.Fog(L.bg, 70, 180);
  hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2]; sun.intensity = L.sun; skyAt = 0;
  const y = grid.position.y; scene.remove(grid); grid.geometry?.dispose(); for (const m of [grid.material].flat()) m?.dispose();   // the lawn's grass picture is shared and stays
  if (L.real) { grid = new THREE.Mesh(new THREE.CircleGeometry(160, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: L.ground, map: grassTex(), roughness: 1 })); grid.receiveShadow = true; }   // a lawn to the horizon
  else grid = new THREE.GridHelper(140, 140, L.grid[0], L.grid[1]);
  grid.position.y = y; scene.add(grid);
  renderer.toneMapping = L.real ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  scene.fog = L.real ? new THREE.Fog(L.bg, 60, 260) : scene.fog;
  for (const F of Object.values(S.F)) styleFloor(F);
  buildRoofs(); buildYard();
  document.documentElement.dataset.theme = curTheme();
  reshadow(); drawPins();
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
  const mode = editLook() ? 'auto' : prefs.walls, dir = camera.position.clone().sub(controls.target).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
  for (const m of F.wallMeshes) {
    const full = m.userData.full; if (!full) continue;
    let low = mode === 'cut';
    if (mode === 'auto') { const w = m.userData.wc; low = (w.x - F.center.x) * dir.x + (w.z - F.center.z) * dir.z > F.r * 0.2; }
    const want = low ? lowOf(F, m, full) : full;
    if (m.material !== want) m.material = want;
    if (m.userData.cat === 'wall' && m.castShadow === low) { m.castShadow = !low; renderer.shadowMap.needsUpdate = true; }
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
function disposeFloor(F) {
  /* Labels on the old floors are page elements: take them off the page too, or they stay behind, stacked in the middle. */
  scene.remove(F.G);
  disposeTree(F.G);
  for (const m of [...Object.values(F.mats), ...Object.values(F.low), F.edgeMat, F.furnEdgeMat, F.doorEdge, F.edgeLow, F.doorEdgeLow]) m?.dispose();
}
let floorsGen = 0;
async function loadFloors() {
  const gen = ++floorsGen;   // a newer load (a quick second reload) wins; this one stops and frees what it made
  S.liveSig = null;   // the pins go with the old floors: draw them again
  for (const F of Object.values(S.F)) disposeFloor(F);
  S.pinObjs = []; closeCard();
  S.F = {};
  for (const f of S.plan.floors) {
    const inner = f.kind === 'drawn' ? await drawnFloor(f) : await new Promise((ok, bad) => loader.load(`/api/floorplan/floors/${encodeURIComponent(f.id)}/model`, (g) => ok(g.scene), undefined, bad)).catch(() => null);
    if (gen !== floorsGen) { disposeTree(inner); return; }
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
    F.loadOff = [G.position.x, G.position.z];
    S.F[f.id] = F;
  }
  if (S.plan.floors.length === 1 && S.F[S.plan.floors[0].id]) S.floorView = S.plan.floors[0].id;
  if (S.floorView !== 'all' && !S.F[S.floorView]) S.floorView = 'all';
  S.houseBox = new THREE.Box3(); for (const F of Object.values(S.F)) S.houseBox.union(F.box.clone().translate(new V3(0, (F.f.level || 0) * (F.f.heightM || 3), 0)));
  applyLook(); buildRoomLabels(); layout(true);
}
/* The roof sits on the top floor (and lifts away when you pick a floor or a room). */
function buildRoofs() {
  for (const F of Object.values(S.F)) if (F.roof) { F.roof.parent?.remove(F.roof); disposeTree(F.roof); F.roof = null; }
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
    const f = F.f, lvl = f.level || 0, isCur = !cur || F === cur || f.id === fitId();
    F.G.position.y = lvl * (f.heightM || 3) + (prefs.stack === 'apart' && !cur ? lvl * 3 : 0);
    F.G.visible = (isCur || (prefs.stack !== 'alone' && lvl < curLevel)) && !prefs.hidden?.[f.id];
    F.fx.uDim.value = isCur ? 1 : 0.28; F.edgeMat.opacity = isCur ? 0.9 : 0.12; F.furnEdgeMat.opacity = isCur ? 0.35 : 0.05; F.doorEdge.opacity = F.edgeMat.opacity;
    F.G.updateMatrixWorld(true);
    F.clipLow.constant = F.G.position.y + F.minY + 1.1;
    if (F.roof) F.roof.visible = prefs.roof && S.mode !== 'edit' && (!cur || !multi) && !S.room && F.G.visible;   // the roof lifts off while you edit
    if (F.G.visible) minY = Math.min(minY, F.G.position.y + F.minY);
    roomUniforms(F);
    F.label.visible = multi && !cur && F.G.visible && labelMode() === 'all' && S.mode !== 'edit';
    for (const l of F.roomLabs) l.visible = prefs.names && F.G.visible && (cur ? F === cur : !multi);
  }
  grid.position.y = (Number.isFinite(minY) ? minY : 0) - 0.05;
  yard.visible = yardOn() || (S.mode === 'edit' && S.tab === 'yard');   // the yard, the driveway and the car stay whichever floor you're looking at
  if (card) { const F = S.F[card.o.userData.floor]; card.o.visible = !!F && F.G.visible && (!cur || F === cur); }
  for (const o of S.pinObjs) { const F = S.F[o.userData.floor]; o.visible = !!F && F.G.visible && (!cur || F === cur) && (prefs.cameras || o.userData.kind !== 'camera'); }
  wallsDirty = true;
  if (S.houseBox) { weather.set(wxOn() ? S.live?.weather?.kind : null, S.houseBox, S.live?.weather?.rainMm != null ? 0.5 + S.live.weather.rainMm / 4 : 1); weather.visible = wxOn() && !S.room; }
  controls.autoRotate = !!prefs.spin && !S.tour && (!document.body.classList.contains('panelmode') || Date.now() - lastTouch > 120_000); controls.autoRotateSpeed = 0.45;
  drawChips(); drawTools(); drawLeft(); drawTiles(); drawInfo(); drawPower(); drawBeams(); reshadow(); clusterDirty = true;
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
  for (const F of Object.values(S.F)) if (F.G.visible && (!cur || F === cur || F.f.id === fitId())) box.union(F.box.clone().translate(new V3(0, F.G.position.y, 0)));
  if (box.isEmpty()) return;
  if (!cur && yard.group.visible) for (const c of yard.cars) box.expandByObject(c.o);   // keep the car in the picture
  /* From the front of the house, a little to one side and above - like looking into a dollhouse. */
  const c = box.getCenter(new V3()), len = Math.max(6, box.getSize(new V3()).length());
  const dir = new V3(0.32, 0, 1).applyAxisAngle(new V3(0, 1, 0), deg(S.plan?.settings?.frontDeg || 0)).normalize();
  controls.maxDistance = Math.max(25, len * 3.5);   // zoom out until the whole house is small - never so far it's lost
  flyTo(c, c.clone().add(dir.multiplyScalar(len * 1.02)).add(new V3(0, len * 0.66, 0)));
}
/* Zooming is always the 3D view's - never the page's. A trackpad pinch or Ctrl+scroll over a device pin, a label or the bar
   used to zoom the whole page instead, pushing the controls off the screen with no way back. Now: over the house, it zooms the
   house; over a panel, it scrolls the panel; and it never enlarges the page. Safari's pinch gestures likewise. */
addEventListener('wheel', (e) => {
  if (e.target === renderer.domElement) { if (e.ctrlKey) e.preventDefault(); return; }   // the camera has it
  const inUi = e.target.closest?.('.panel, #tiles, .morepop, #modal, .devcard, #chips, #tools, header, .tabs, #drawer');
  if (inUi) { if (e.ctrlKey) e.preventDefault(); return; }
  e.preventDefault();
  renderer.domElement.dispatchEvent(new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, bubbles: true, cancelable: true }));
}, { passive: false, capture: true });
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) addEventListener(ev, (e) => e.preventDefault(), { passive: false });
/* Lost? Double-click (or double-tap) empty space, press Home or R, or the ⟲ button: back to the whole house. */
function resetView() { S.room = null; if (card) closeCard(); layout(true); }
renderer.domElement.addEventListener('dblclick', (e) => { if (S.mode !== 'view' || S.tool) return; if (rayAt(e.clientX, e.clientY).intersectObjects(Object.values(S.F).filter((F) => F.G.visible).map((F) => F.G), true).some((h) => h.object.isMesh && h.object.visible)) return; resetView(); });   // on the house, a double-click is two taps on a room
addEventListener('keydown', (e) => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === 'Home' || e.key === 'r' || e.key === 'R') { e.preventDefault(); resetView(); } });
/* An open menu closes when you go back to the map (or anywhere else); a tap on the map closes a drawer too. */
document.addEventListener('pointerdown', (e) => {
  if (S.moreOpen && !e.target.closest?.('.morepop, #tools')) { S.moreOpen = false; drawTools(); }
}, true);
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
/* ---------- the house at a glance: tiles, and a drawer with the whole story behind each one ----------
   Tiles sum up what CasaTorch knows about the house right now (power, comfort, safety, lights, movement, the car, the home
   itself). Tap one - or a car, or the house - and a drawer slides in with the detail, every row tappable to fly to it. */
const NOT_ROOM = /water|heater|boiler|tank|oven|fridge|freezer|pool|spa|hot ?tub|outdoor|outside|exterior|cpu|server|rack|nas|router|battery|car|vehicle|attic|garage/i;   // readings that aren't a room's
const roomOf = (p) => { const F = S.F[p.floor]; if (!F?.rooms.length) return F?.f.name || ''; const i = roomAt(F, p.pos[0], p.pos[2]); return F.rooms[i]?.name || F.f.name; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
function houseNow() {
  const pins = S.live?.pins || [], dv = (f) => pins.filter((p) => f(p.device));
  const powered = dv((d) => d.powerW != null && d.on !== false).sort((a, b) => b.device.powerW - a.device.powerW);
  const temps = dv((d) => d.tempC != null && d.tempC > -5 && d.tempC < 40 && !NOT_ROOM.test(d.name || '')), hums = dv((d) => d.humidity != null && !NOT_ROOM.test(d.name || ''));
  const doors = dv((d) => d.open != null && d.kind !== 'cover'), openDoors = doors.filter((p) => p.device.open), locks = dv((d) => d.kind === 'lock'), unlocked = locks.filter((p) => p.device.locked === false);
  const alarms = dv((d) => d.water || d.smoke), covers = dv((d) => d.kind === 'cover' && /garage|gate|door/i.test(d.name || '') && !/valve|water|gas/i.test(d.name || '')), openCovers = covers.filter((p) => p.device.open);
  const lights = dv((d) => d.kind === 'light'), lit = lights.filter((p) => p.device.on), motion = dv((d) => d.motion), cams = dv((d) => d.kind === 'camera');
  const cars = (S.plan?.yard?.items || []).filter((it) => it.kind === 'car').map((it) => ({ it, s: S.live?.cars?.[it.id] || {} }));
  return { pins, powered, temps, hums, doors, openDoors, locks, unlocked, alarms, covers, openCovers, lights, lit, motion, cams, cars, watts: S.live?.totals?.powerW ?? sum(powered.map((p) => p.device.powerW)) };
}
const avg = (a) => (a.length ? sum(a) / a.length : null);
function areaOf(F) { const b = F.box; return b ? Math.max(0, (b.max.x - b.min.x) * (b.max.z - b.min.z)) : 0; }
const areaText = (m2) => (units === 'C' ? `${Math.round(m2)} m²` : `${Math.round(m2 * 10.764).toLocaleString()} ft²`);
function tiles() {
  const H = houseNow(), out = [];
  const t = (kind, icon, label, value, sub, tone) => out.push({ kind, icon, label, value, sub, tone });
  { const tt = S.live?.totals || {}, lv = tt.vs?.level, top = (tt.parts || [])[0];
    if (H.powered.length || H.watts) t('energy', 'bolt', 'Power now', fmtW(H.watts), lv && lv !== 'learning' ? { low: 'Below usual', normal: 'About usual', above: 'Above usual', high: 'Well above usual' }[lv] : top ? `Most: ${top.name}` : '', { low: 'good', normal: 'good', above: 'warn', high: 'bad' }[lv] || ''); }
  if (H.temps.length) { const v = H.temps.map((p) => p.device.tempC); t('climate', 'thermo', 'Inside', temp(avg(v)), `${temp(Math.min(...v))} to ${temp(Math.max(...v))}${H.hums.length ? ` · ${Math.round(avg(H.hums.map((p) => p.device.humidity)))}% humidity` : ''}`); }
  if (H.doors.length || H.locks.length || H.alarms.length) {
    const bad = H.alarms.length, warn = H.openDoors.length + H.unlocked.length + H.openCovers.length;
    t('security', 'shield', 'Safety', bad ? (H.alarms[0].device.water ? 'Water!' : 'Smoke!') : warn ? `${warn} to check` : 'All secure', [H.openDoors.length ? `${H.openDoors.length} open` : '', H.unlocked.length ? `${H.unlocked.length} unlocked` : '', !warn && !bad ? `${H.doors.length + H.locks.length} watched` : ''].filter(Boolean).join(' · '), bad ? 'bad' : warn ? 'warn' : 'good');
  }
  if (H.lights.length) t('lights', 'light', 'Lights', `${H.lit.length} on`, H.lit.length ? [...new Set(H.lit.map(roomOf))].slice(0, 2).join(', ') : 'All off', H.lit.length ? 'warm' : '');
  if (H.motion.length || H.pins.some((p) => p.device.motion != null)) t('motion', 'walk', 'Movement', H.motion.length ? roomOf(H.motion[0]) : 'Quiet', H.motion.length > 1 ? `and ${H.motion.length - 1} more` : H.motion.length ? 'Movement now' : 'Nobody moving', H.motion.length ? 'warm' : '');
  for (const { it, s } of H.cars.slice(0, 2)) t(`car:${it.id}`, 'car', it.name || 'Car', s.battery != null ? `${Math.round(s.battery)}%` : s.home === false ? 'Away' : 'Home', s.home === false ? 'Away' : s.powerW > 50 ? `Charging ${fmtW(s.powerW)}` : s.plugged ? 'Plugged in' : 'Parked', s.powerW > 50 ? 'good' : '');
  const Fs = Object.values(S.F);
  if (Fs.length) t('home', 'home', 'Your home', `${sum(Fs.map((F) => F.rooms.length)) || Fs.length} ${sum(Fs.map((F) => F.rooms.length)) ? 'rooms' : Fs.length === 1 ? 'floor' : 'floors'}`, `${H.pins.length} devices · about ${areaText(sum(Fs.map(areaOf)))}`);
  return out;
}
function drawTiles() { dock.draw(); }
function tileCard(x) {
  return el('button', { type: 'button', class: `tile ${x.tone || ''}${S.info?.kind === x.kind ? ' on' : ''}`, onclick: () => { if (!dock.arranging()) openInfo(x.kind); } },
    el('span', { class: 'tl' }, ic(x.icon), x.label), el('b', {}, x.value), x.sub ? el('small', {}, x.sub) : null);
}
function openInfo(kind) { S.info = S.info?.kind === kind ? null : { kind }; closeCard(); drawInfo(); drawTiles(); }
function closeInfo() { S.info = null; const side = $('#side'); if (side.dataset.kind === 'info') { side.hidden = true; side.dataset.kind = ''; } document.body.classList.remove('drawer'); drawTiles(); }
function infoRow(p, extra) { const d = p.device, st = devState(d); return el('div', { class: `drow${st.act ? ' act' : ''}${st.alarm ? ' bad' : ''}` }, el('div', { class: 'dtop' }, el('button', { type: 'button', class: 'dopen', title: `Show ${pinName(p)} on the map`, onclick: () => goToPin(p) }, ic(iconOf(d)), el('span', { class: 'dn' }, pinName(p)), el('small', {}, [roomOf(p), st.val].filter(Boolean).join(' · '))), extra || null)); }
const swOff = (p) => { const d = p.device; return ['light', 'plug', 'switch', 'fan'].includes(d.kind) || d.kind === 'media' ? el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: d.on || d.playing ? true : null, onchange: () => { d.on = !d.on; act(d, d.kind === 'media' ? 'toggle' : d.on ? 'on' : 'off'); drawPinsSoon(); } }), el('span')) : null; };
function bars(rows) {   // a quiet bar chart: label, bar, value
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return el('div', { class: 'ibars' }, ...rows.map(([n, v, txt]) => el('div', { class: 'ibar' }, el('span', {}, n), el('i', { style: `--w:${Math.max(2, (v / max) * 100)}%` }), el('small', {}, txt))));
}
function drawInfo() {
  const side = $('#side');
  if (!S.info || S.mode !== 'view') { if (side.dataset.kind === 'info') { side.hidden = true; side.dataset.kind = ''; document.body.classList.remove('drawer'); } return; }
  if (side.contains(document.activeElement) && document.activeElement.matches('input[type=range]')) return;
  const H = houseNow(), k = S.info.kind, sec = (t) => el('div', { class: 'sechead' }, t);
  let title = '', sub = '', body = [];
  if (k === 'energy') {
    title = 'Power'; sub = `${fmtW(H.watts)} right now`;
    const tt = S.live?.totals || {}, parts = tt.parts || [], vs = tt.vs || {};
    const byRoom = new Map(); for (const p of H.powered) byRoom.set(roomOf(p), (byRoom.get(roomOf(p)) || 0) + p.device.powerW);
    const placedIds = new Set((S.live?.pins || []).map((p) => p.deviceId));
    body = [el('p', { class: `note vs ${{ low: 'good', normal: 'good', above: 'warn', high: 'bad' }[vs.level] || ''}` }, powerSay(tt)),
      S.live?.energy ? energyCard(S.live.energy) : null,
      sec(tt.from ? 'Where the number comes from' : `What adds up to ${fmtW(H.watts)}`),
      tt.from ? el('p', { class: 'note' }, `Your whole-home meter, ${tt.from}. It measures everything at once.`) : null,
      parts.length ? bars(parts.slice(0, 20).map((x) => [`${x.name}${placedIds.has(x.id) ? '' : ' *'}`, x.w, fmtW(x.w)])) : el('p', { class: 'note' }, 'Nothing is measuring power right now.'),
      !tt.from && parts.length ? el('p', { class: 'note' }, `Only things that measure their own power are counted: smart plugs and switches with a power reading${parts.some((x) => /charging/.test(x.name)) ? ', and your car charging' : ''}. Lights and appliances without one aren't in the number. * = not placed on the map yet.`) : null,
      byRoom.size > 1 ? sec('By room') : null, byRoom.size > 1 ? bars([...byRoom].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, w]) => [n, w, fmtW(w)])) : null,
      sec(`Using power · ${H.powered.length}`), ...H.powered.slice(0, 15).map((p) => infoRow(p, swOff(p))),
      ...H.cars.filter((c) => c.s.powerW > 50).map((c) => el('div', { class: 'drow act' }, el('div', { class: 'dtop' }, ic('car'), el('span', { class: 'dn' }, c.it.name || 'Car'), el('small', {}, `Charging ${fmtW(c.s.powerW)}`))))];
  } else if (k === 'climate') {
    const v = H.temps.map((p) => p.device.tempC); title = 'Inside'; sub = H.temps.length ? `${temp(avg(v))} on average` : '';
    const sorted = [...H.temps].sort((a, b) => b.device.tempC - a.device.tempC);
    body = [sorted.length > 1 ? el('p', { class: 'note' }, `Warmest: ${roomOf(sorted[0])} (${temp(sorted[0].device.tempC)}). Coolest: ${roomOf(sorted[sorted.length - 1])} (${temp(sorted[sorted.length - 1].device.tempC)}).`) : null,
      sec('Temperature'), bars(sorted.map((p) => [roomOf(p) || pinName(p), p.device.tempC - Math.min(...v) + 1, temp(p.device.tempC)])),
      H.hums.length ? sec('Humidity') : null, H.hums.length ? bars(H.hums.map((p) => [roomOf(p) || pinName(p), p.device.humidity, `${Math.round(p.device.humidity)}%`])) : null,
      ...H.pins.filter((p) => p.device.kind === 'climate' && !NOT_ROOM.test(p.device.name || '')).map((p) => infoRow(p))];
  } else if (k === 'security') {
    title = 'Safety'; sub = H.alarms.length ? 'Needs you now' : H.openDoors.length + H.unlocked.length + H.openCovers.length ? 'A few things to check' : 'Everything is shut and locked';
    const lockBtn = (p) => el('button', { type: 'button', class: 'mini', onclick: () => { p.device.locked = true; act(p.device, 'lock'); drawPinsSoon(); } }, 'Lock');   // locking only - never unlock
    body = [H.alarms.length ? sec('Alarms') : null, ...H.alarms.map((p) => infoRow(p)),
      H.unlocked.length || H.openDoors.length || H.openCovers.length ? sec('To check') : null, ...H.unlocked.map((p) => infoRow(p, lockBtn(p))), ...H.openDoors.map((p) => infoRow(p)), ...H.openCovers.map((p) => infoRow(p)),
      H.locks.length ? sec('Locks') : null, ...H.locks.filter((p) => !H.unlocked.includes(p)).map((p) => infoRow(p)),
      H.doors.length ? sec('Doors and windows') : null, ...H.doors.filter((p) => !H.openDoors.includes(p)).map((p) => infoRow(p)),
      H.cams.length ? sec(`Cameras · ${H.cams.length}`) : null, ...H.cams.map((p) => infoRow(p)),
      el('p', { class: 'note' }, 'From here CasaTorch can lock, never unlock. Garage doors and gates only close.')];
  } else if (k === 'lights') {
    title = 'Lights'; sub = `${H.lit.length} of ${H.lights.length} on`;
    const byFloor = Object.values(S.F).sort((a, b) => (b.f.level || 0) - (a.f.level || 0)).map((F) => [F, H.lights.filter((p) => p.floor === F.f.id)]).filter(([, l]) => l.length);
    body = [el('div', { class: 'srow' }, el('span', {}, 'All lights'), el('button', { type: 'button', class: 'mini', onclick: () => allLights(H.pins, true) }, 'On'), el('button', { type: 'button', class: 'mini', onclick: () => allLights(H.pins, false) }, 'Off')),
      ...byFloor.flatMap(([F, l]) => [byFloor.length > 1 ? sec(F.f.name) : null, ...l.sort((a, b) => !!b.device.on - !!a.device.on || roomOf(a).localeCompare(roomOf(b))).map((p) => infoRow(p, swOff(p)))])];
  } else if (k === 'motion') {
    title = 'Movement'; sub = H.motion.length ? `In ${[...new Set(H.motion.map(roomOf))].join(', ')}` : 'Nobody moving right now';
    body = [sec('Motion sensors'), ...H.pins.filter((p) => p.device.motion != null).sort((a, b) => !!b.device.motion - !!a.device.motion).map((p) => infoRow(p)),
      el('p', { class: 'note' }, 'Turn on the activity trail in View to see where movement was over the last minutes.')];
  } else if (k.startsWith('car:')) {
    const c = H.cars.find((x) => `car:${x.it.id}` === k); if (!c) { closeInfo(); return; }
    title = c.it.name || 'Car'; sub = c.s.home === false ? 'Away' : 'At home';
    const row = (n, v) => (v == null ? null : el('div', { class: 'srow' }, el('span', {}, n), el('b', {}, v)));
    body = [c.s.battery != null ? el('div', { class: 'battery' }, el('i', { style: `--w:${Math.max(2, Math.min(100, c.s.battery))}%` }), el('b', {}, `${Math.round(c.s.battery)}%`)) : null,
      row('Plugged in', c.s.plugged == null ? null : c.s.plugged ? 'Yes' : 'No'), row('Charging', c.s.powerW > 50 ? fmtW(c.s.powerW) : c.s.powerW != null ? 'No' : null), row('Where', c.s.home == null ? null : c.s.home ? 'Home' : 'Away'),
      el('button', { type: 'button', class: 'mini wide', onclick: () => { const o = yard.cars.find((x) => x.it.id === c.it.id)?.o; if (o) { const w = o.getWorldPosition(new V3()); flyTo(w, w.clone().add(new V3(5, 5, 7))); } } }, 'Show it on the map'),
      el('p', { class: 'note' }, 'CasaTorch only shows the car - it never unlocks, opens or drives it. Change where it parks in Editor › Yard.')];
  } else if (k === 'home') {
    const Fs = Object.values(S.F).sort((a, b) => (b.f.level || 0) - (a.f.level || 0)), byKind = new Map();
    for (const p of H.pins) { const w = KIND_WORD[p.device.kind] || 'Other'; byKind.set(w, (byKind.get(w) || 0) + 1); }
    title = 'Your home'; sub = `${Fs.length} floor${Fs.length === 1 ? '' : 's'} · about ${areaText(sum(Fs.map(areaOf)))}`;
    body = [sec('Floors'), ...Fs.map((F) => el('button', { type: 'button', class: 'sroom', onclick: () => { closeInfo(); pickFloor(F.f.id); } }, F.f.name, el('small', {}, [F.rooms.length ? `${F.rooms.length} rooms` : '', `about ${areaText(areaOf(F))}`, `${H.pins.filter((p) => p.floor === F.f.id).length} devices`].filter(Boolean).join(' · ')))),
      Fs.some((F) => F.rooms.length) ? sec('Rooms') : null, ...Fs.flatMap((F) => F.rooms.map((r, i) => el('button', { type: 'button', class: 'sroom', onclick: () => { closeInfo(); focusRoom(F.f.id, i); } }, el('i', { class: 'swatch', style: `--rc:${r.color}` }), r.name, el('small', {}, F.f.name)))),
      sec(`On the map · ${H.pins.length}`), bars([...byKind].sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, c, String(c)])),
      H.cars.length || (S.plan?.yard?.items || []).length ? el('p', { class: 'note' }, `Outside: ${[H.cars.length ? `${H.cars.length} car${H.cars.length > 1 ? 's' : ''}` : '', (S.pins || []).filter((p) => p.beam).length ? `${(S.pins || []).filter((p) => p.beam).length} flood lights` : '', (S.plan?.yard?.items || []).filter((it) => ['tree', 'pine', 'bush'].includes(it.kind)).length ? `${(S.plan?.yard?.items || []).filter((it) => ['tree', 'pine', 'bush'].includes(it.kind)).length} trees and bushes` : ''].filter(Boolean).join(', ')}.`) : null,
      S.live?.weather?.temp != null ? el('p', { class: 'note' }, `Outside it's ${Math.round(S.live.weather.temp)}° and ${String(S.live.weather.words || '').toLowerCase()}.`) : null];
  }
  side.hidden = false; side.dataset.kind = 'info'; document.body.classList.add('drawer');
  fill(side, el('div', { class: 'rhead' }, el('div', {}, el('h2', {}, title), sub ? el('small', {}, sub) : null), el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Close', onclick: closeInfo }, ic('close'))), ...body);
}
/* Wall panel mode: the 3D home as the screen you leave on - no editing buttons, tiles a little bigger, the view drifting slowly,
   the screen kept awake where the browser allows, and after two quiet minutes it tidies itself back to the whole house. */
let wakeLock = null, lastTouch = Date.now();
function setPanelMode(on) {
  document.body.classList.toggle('panelmode', on);
  try { localStorage.setItem('casatorch-3d-panel', on ? '1' : ''); } catch { /* fine */ }
  if (on) { prefs.spin = true; navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {}); } else { prefs.spin = false; wakeLock?.release?.().catch(() => {}); wakeLock = null; }
  layout(false); drawTiles();
}
for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { lastTouch = Date.now(); controls.autoRotate = false; }, { passive: true });
setInterval(() => {
  if (!document.body.classList.contains('panelmode') || Date.now() - lastTouch < 120_000) return;
  if (S.info || card || S.room || S.floorView !== 'all') { closeInfo(); closeCard(); S.room = null; S.floorView = 'all'; layout(true); }
  controls.autoRotate = true;
}, 15_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && document.body.classList.contains('panelmode') && !wakeLock) navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {}); });
/* ---------- outdoor flood lights ----------
   A light marked "outdoor" shines one way - onto the driveway, the yard - instead of glowing inside: a soft beam from the
   fixture and a pool of light on the ground where it lands. Which way, how wide and how far are the owner's (Editor > Devices,
   on the light). Brighter after dark; a faint outline while editing so you can see where it points even when it's off. */
const beams = new THREE.Group(); beams.name = 'beams'; scene.add(beams);
let beamTex = null;
function beamTexture() {   // a soft wedge, bright at the fixture end, fading out and at the edges
  if (beamTex) return beamTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = g.createRadialGradient(0, 128, 0, 0, 128, 256); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.55, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.beginPath(); g.moveTo(0, 118); g.lineTo(256, 0); g.lineTo(256, 256); g.lineTo(0, 138); g.closePath(); g.filter = 'blur(10px)'; g.fill();
  beamTex = new THREE.CanvasTexture(c); beamTex.colorSpace = THREE.SRGBColorSpace; return beamTex;
}
function beamFrom(p) { const F = S.F[p.floor]; return F ? F.G.localToWorld(new V3(...p.pos)) : null; }
function houseMid() { const B = S.houseBox; return B ? B.getCenter(new V3()) : new V3(); }
const autoAim = (p) => { const w = beamFrom(p), c = houseMid(); return w ? Math.round(Math.atan2(w.z - c.z, w.x - c.x) * 180 / Math.PI) : 0; };   // straight out from the house
function drawBeams() {
  for (const o of [...beams.children]) { beams.remove(o); o.geometry?.dispose(); o.material?.dispose(); }
  const live = new Map((S.live?.pins || []).map((p) => [p.deviceId, p.device])), night = S.night ?? 0, editing = S.mode === 'edit';
  for (const p of S.pins || []) {
    const b = p.beam, d = live.get(p.deviceId); if (!b || !d) continue;
    const F = S.F[p.floor], P = beamFrom(p); if (!F || !P || !F.G.visible) continue;
    const on = !!d.on && d.online !== false; if (!on && !editing) continue;
    const a = b.aim * Math.PI / 180, dir = new V3(Math.cos(a), 0, Math.sin(a)), gy = Math.min(P.y - 0.2, groundY() + 0.03);
    const half = Math.tan(Math.min(80, b.spread / 2) * Math.PI / 180), len = b.reach, wid = Math.max(0.4, 2 * len * half);
    const col = new THREE.Color(p.color || d.rgb || (d.kelvin ? kelvinToHex(d.kelvin) : '#ffd9a0')), k = on ? (0.35 + 0.65 * night) * (0.4 + 0.6 * ((d.brightness ?? 100) / 100)) : 0.12;
    // the pool on the ground
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(len, wid).translate(len / 2, 0, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: beamTexture(), color: col, transparent: true, opacity: Math.min(1, 0.9 * k), blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.position.set(P.x, gy, P.z); pool.rotation.y = -a; pool.renderOrder = 3; pool.raycast = () => {}; beams.add(pool);
    // the beam in the air, from the fixture to the middle of the pool
    const Q = new V3(P.x, gy, P.z).addScaledVector(dir, len * 0.55), h = P.distanceTo(Q);
    if (h > 0.3) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, Math.max(0.3, wid * 0.35), h, 24, 1, true).translate(0, -h / 2, 0), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16 * k, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      cone.position.copy(P); cone.quaternion.setFromUnitVectors(new V3(0, -1, 0), Q.clone().sub(P).normalize()); cone.renderOrder = 3; cone.raycast = () => {}; beams.add(cone);
    }
  }
  kick();
}
/* What earns words on the plan in the "Key" labels: things that need you (water, smoke, a door open, a lock open, motion) and big
   power users. A light being on already shows - its pin glows - so it doesn't need "100%" written next to it. */
const notable = (d, st) => !!(st.alarm || (d.open && d.kind !== 'cover') || d.locked === false || d.motion || (d.powerW || 0) >= 800);
const fmtW = (w) => (w >= 1000 ? `${(w / 1000).toFixed(w >= 10000 ? 0 : 1)} kW` : `${Math.round(w)} W`);
function pinsByRoom(F) { const out = F.rooms.map(() => []); for (const p of S.live?.pins || []) if (p.floor === F.f.id) { const i = roomAt(F, p.pos[0], p.pos[2]); if (i >= 0) out[i].push(p); } return out; }
function drawPins() {
  for (const o of S.pinObjs) { o.parent?.remove(o); o.element.remove(); }
  S.pinObjs = [];
  const L = look(), glows = {};
  /* Devices saved on (nearly) the same spot fan out in a little ring, so each one can be seen and grabbed. */
  const spots = new Map(), shown = new Map();
  for (const p of S.live?.pins || []) { const k = `${p.floor}:${p.pos.map((v) => Math.round(v / 0.25)).join(':')}`; spots.set(k, [...(spots.get(k) || []), p]); }
  for (const list of spots.values()) if (list.length > 1) list.forEach((p, j) => { const a = (j / list.length) * Math.PI * 2, r = 0.25 + list.length * 0.05; shown.set(p, [p.pos[0] + Math.cos(a) * r, p.pos[1], p.pos[2] + Math.sin(a) * r]); });
  for (const p of S.live?.pins || []) {
    const F = S.F[p.floor]; if (!F) continue;
    const d = p.device, st = devState(d), sel = S.mode === 'edit' && S.tool?.type === 'device' && S.tool.dev.id === p.deviceId;
    let o = null;
    const lm = labelMode(), say = lm === 'all' || (lm === 'key' && notable(d, st));
    const div = el('button', { type: 'button', class: `pin${st.act ? ' act' : ''}${st.alarm ? ' alarm' : ''}${d.online === false ? ' offline' : ''}${sel ? ' sel' : ''}${S.mode === 'edit' ? ' movable' : ''}${say ? ' say' : ''}`, 'aria-label': `${pinName(p)}${st.val ? `: ${st.val}` : ''}`, onclick: () => { if (S.dragged) return; if (S.mode === 'view' && o?.userData.cluster?.length > 1) { zoomToPins(o.userData.cluster); return; } pinClick(p); }, onpointerdown: (e) => pinDrag(e, p, o) },
      ic(iconOf(d)), el('span', { class: 'val' }, lm === 'all' || !say ? el('b', {}, pinName(p)) : null, st.val ? (say && lm !== 'all' ? st.val : ` ${st.val}`) : null));
    o = new CSS2DObject(div); o.position.set(...(shown.get(p) || p.pos)); o.userData = { floor: p.floor, kind: d.kind }; F.G.add(o); S.pinObjs.push(o);
    const glow = d.kind === 'light' && d.on ? [p.color || d.rgb || (d.kelvin ? kelvinToHex(d.kelvin) : '#ffc477'), (0.35 + 0.65 * ((d.brightness ?? 100) / 100)) * L.glow] : d.kind === 'media' && d.playing ? ['#c084fc', 0.45 * L.glow] : st.alarm ? ['#ef4444', 0.9 * L.glow] : d.open ? ['#f59e0b', 0.35 * L.glow] : ['plug', 'switch'].includes(d.kind) && d.on && d.powerW > 5 ? ['#34d399', Math.min(0.5, 0.15 + d.powerW / 2000) * L.glow] : null;
    if (glow && !(d.kind === 'light' && p.beam)) (glows[p.floor] ||= []).push({ p, color: glow[0], k: glow[1] });
  }
  for (const F of Object.values(S.F)) {
    const list = (glows[F.f.id] || []).slice(0, MAX_GLOW);
    list.forEach((g, i) => { const w = F.G.localToWorld(new V3(...g.p.pos)), c = new THREE.Color(g.color); F.fx.uGlowPos.value[i].copy(w); F.fx.uGlowCol.value[i].set(c.r * g.k, c.g * g.k, c.b * g.k); F.fx.uGlowRoom.value[i] = roomAt(F, g.p.pos[0], g.p.pos[2]); });
    F.fx.uGlowN.value = list.length;
    const by = pinsByRoom(F), stats = prefs.overlay !== 'rooms' ? roomStats(F) : null;   // once per floor, not once per room
    F.roomLabs.forEach((l, i) => { const on = by[i].filter((p) => p.device.kind === 'light' && p.device.on).length, t = by[i].find((p) => p.device.tempC != null); l.element.querySelector('small').textContent = stats ? overlayText(stats[i]) || '' : [t ? temp(t.device.tempC) : '', on ? `${on} on` : ''].filter(Boolean).join(' · '); });
    const lightsOn = (S.live?.pins || []).filter((p) => p.floor === F.f.id && p.device.kind === 'light' && p.device.on).length;
    const openN = (S.live?.pins || []).filter((p) => p.floor === F.f.id && p.device.open && p.device.kind !== 'cover').length;
    fill(F.label.element, el('b', {}, F.f.name), el('small', {}, [F.rooms.length ? `${F.rooms.length} room${F.rooms.length === 1 ? '' : 's'}` : '', lightsOn ? `${lightsOn} light${lightsOn === 1 ? '' : 's'} on` : '', openN ? `${openN} open` : ''].filter(Boolean).join(' · ')));
  }
  if (card) { const p = (S.live?.pins || []).find((x) => x.deviceId === card.id); if (p) fillCard(p); else closeCard(); }
  drawTrail(); drawBeams();
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
  camStop?.();   // a camera window already open: stop its video first
  /* As live as the camera allows, best first:
     1. WebRTC through the server's camera relay (go2rtc) - a few hundred milliseconds behind, with sound off.
     2. The camera's own MJPEG stream, for cameras CasaTorch reaches directly (Frigate) - about a second.
     3. A fresh picture every 0.7 seconds, each shown only once it has fully loaded.
     Home Assistant's own MJPEG relay is skipped: for Ring and many cloud cameras it runs a minute or more behind. */
  const box = el('div', { class: 'feedbox' }), badge = el('span', { class: 'livebadge' }, 'Connecting…');
  let stop = () => {}, closed = false, lastPic = 0;
  const say = (t) => { badge.textContent = t; };
  const base = /\/stream(\?|$)/.test(d.stream || '') ? d.stream.replace(/\/stream(\?.*)?$/, '') : null;
  function stills() {
    const img = el('img', { alt: name, class: 'feed' }); box.replaceChildren(img); let t = null, gone = false;
    const tick = () => { if (gone) return; const n = new Image(), u = snapUrl(d); n.onload = () => { if (gone) return; img.src = n.src; lastPic = Date.now(); say('Live (pictures)'); t = setTimeout(tick, 700); }; n.onerror = () => { say('No picture right now - trying again'); t = setTimeout(tick, 3000); }; n.src = `${u}${u.includes('?') ? '&' : '?'}t=${Date.now()}`; };
    tick(); stop = () => { gone = true; clearTimeout(t); img.removeAttribute('src'); };
  }
  function mjpeg() {
    const img = el('img', { alt: name, class: 'feed' }); box.replaceChildren(img); let ok = false;
    const dog = setTimeout(() => { if (!ok && !closed) { stop(); stills(); } }, 6000);
    img.onload = () => { ok = true; say('LIVE'); }; img.onerror = () => { clearTimeout(dog); if (!closed) { stop(); stills(); } };
    img.src = `${d.stream}${d.stream.includes('?') ? '&' : '?'}t=${Date.now()}`;
    stop = () => { clearTimeout(dog); img.onerror = null; img.removeAttribute('src'); };
  }
  async function rtc() {
    if (typeof RTCPeerConnection !== 'function') return false;
    const video = el('video', { class: 'feed', muted: true, autoplay: true, playsinline: true }); video.muted = true;
    const pc = new RTCPeerConnection({ iceServers: [] }), ms = new MediaStream(); let playing = false;
    stop = () => { try { pc.close(); } catch { /* closed */ } video.srcObject = null; };
    pc.addTransceiver('video', { direction: 'recvonly' }); pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (ev) => { try { ev.receiver.playoutDelayHint = 0.25; } catch { /* older browser */ } ms.addTrack(ev.track); if (video.srcObject !== ms) video.srcObject = ms; video.play().catch(() => {}); };
    video.addEventListener('playing', () => { playing = true; say('LIVE'); });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((ok) => { if (pc.iceGatheringState === 'complete') return ok(); const t = setTimeout(ok, 1500); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } }); });
      const r = await fetch(`${base}/webrtc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }), cache: 'no-store' });
      if (!r.ok || closed) { stop(); return false; }
      const a = await r.json(); await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
      box.replaceChildren(video);
      await new Promise((ok) => setTimeout(ok, 8000)); if (closed) return true;
      if (!playing) { stop(); return false; }
      return true;
    } catch { stop(); return false; }
  }
  (async () => {
    if (base && await rtc()) return;
    if (closed) return;
    if (d.stream && (d.live || d.provider !== 'ha')) mjpeg(); else stills();
  })();
  const ago = setInterval(() => { if (lastPic && Date.now() - lastPic > 4000) say(`Picture from ${Math.round((Date.now() - lastPic) / 1000)} s ago`); }, 1000);
  modal(el('div', { class: 'box cam' }, el('div', { class: 'rhead' }, ic('camera'), el('div', {}, el('h2', {}, name), el('small', {}, badge)), el('button', { type: 'button', class: 'iconbtn', title: 'Close', 'aria-label': 'Close', onclick: closeModal }, ic('close'))), box));
  camStop = () => { closed = true; clearInterval(ago); stop(); camStop = null; };
}
function modal(content) { camStop?.(); const m = $('#modal'); m.replaceChildren(content); m.hidden = false; m.onclick = (e) => { if (e.target === m) closeModal(); }; }   // anything new in the window stops a camera that was in it
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
    Object.values(S.F).some((F) => F.roof) ? toggle('Roof', 'roof') : null, isReal() ? null : toggle('Sun & shadows', 'sun'), isReal() ? null : toggle('Weather', 'weatherFx'), !isReal() && (S.plan?.yard?.areas?.length || S.plan?.yard?.items?.length) ? toggle('Yard', 'yard') : null,
    el('div', { class: 'poprow look' }, el('small', {}, 'Look'), seg(Object.entries(THEMES).map(([k, t]) => [k, t.label]), curTheme(), (v) => { prefs.theme = v; savePrefs(); applyLook(); drawThemeSeg(); drawTools(); })),
    el('div', { class: 'poprow' }, el('small', {}, 'Power lines'), seg([['off', 'Off'], ['energy', 'Energy view'], ['always', 'Always']], linesMode(), (v) => { prefs.lines = v; prefs.power = v !== 'off'; savePrefs(); drawPower(); drawTools(); })),
    el('div', { class: 'poprow' }, el('small', {}, 'Words'), seg([['none', 'Icons only'], ['key', 'What needs you'], ['all', 'Everything']], labelMode(), setLabels)), el('button', { type: 'button', class: `tog${document.body.classList.contains('panelmode') ? ' on' : ''}`, title: 'For a wall tablet or a screen you leave on', onclick: () => { setPanelMode(!document.body.classList.contains('panelmode')); S.moreOpen = false; drawTools(); } }, 'Wall panel mode'), toggle('Activity trail', 'trail'), toggle('Cameras', 'cameras'), toggle('Spin', 'spin'),
    Object.keys(S.F).length > 1 ? seg([['stacked', 'Stacked'], ['apart', 'Apart'], ['alone', 'Alone']], prefs.stack, set('stack')) : null) : null;
  fill(t,
    seg([['auto', 'Dollhouse'], ['tall', 'Tall'], ['cut', 'Cut']], prefs.walls, set('walls')),
    seg([['rooms', 'Rooms'], ['temp', 'Temp'], ...(S.live?.pins || []).some((p) => p.device.humidity != null) ? [['humidity', 'Humidity']] : [], ...(S.live?.pins || []).some((p) => p.device.co2 != null) ? [['air', 'Air']] : [], ['energy', 'Energy'], ['lights', 'Lights'], ['presence', 'Motion']], prefs.overlay, (v) => { prefs.overlay = v; savePrefs(); drawPins(); }),
    el('button', { type: 'button', class: `tog${S.tour ? ' on' : ''}`, onclick: () => (S.tour ? stopTour() : startTour()) }, S.tour ? `■ ${T('Stop')}` : `▶ ${T('Tour')}`),
    el('button', { type: 'button', class: `tog${S.moreOpen ? ' on' : ''}`, onclick: () => { S.moreOpen = !S.moreOpen; drawTools(); } }, `${T('View')} ▾`),
    el('button', { type: 'button', class: 'tog', title: 'Back to the whole house (double-click the map, or press Home)', onclick: resetView }, '⟲'),
    S.room ? el('button', { type: 'button', class: 'tog on', onclick: () => { S.room = null; layout(true); } }, ic('back'), T('Back')) : null);
  document.querySelector('body > .morepop')?.remove(); if (more && !t.hidden) document.body.append(more);   // on the page, so the scrolling bar can't clip it
}
const lightsIn = (pins) => pins.filter((p) => p.device.kind === 'light');
async function allLights(pins, on) { await Promise.all(lightsIn(pins).filter((p) => !!p.device.on !== on).map((p) => send(`/api/devices/${encodeURIComponent(p.device.id)}/${on ? 'on' : 'off'}`, 'POST', {}).catch(() => {}))); setTimeout(refresh, 700); }
/* ---------- the control panel on the left: time, weather, the house, then the room you pick ---------- */
const tz = () => S.live?.weather?.tz || undefined;
function clockText() {
  const now = new Date();
  try { return [now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz() }), now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz() })]; }
  catch { return [now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })]; }
}
setInterval(() => { const [t, d] = clockText(); for (const c of document.querySelectorAll('.dcard .clock')) { c.firstChild.textContent = t; c.lastChild.textContent = d; } }, 10000);
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
  box.classList.toggle('roomopen', !!S.room);
  dock.draw();
}
/* Everything around the model is a card you can move, size, hide or add (floorplan-dock.js). */
const leftBusy = () => { const a = document.activeElement, box = $('#left'); return !!(box?.contains(a) && (a.type === 'range' || (a.type === 'search' && !S.findForce) || a.tagName === 'TEXTAREA')); };
function dockCards() {
  const out = [], H = S.live ? houseNow() : null, card = (c) => out.push(c);
  card({ id: 'clock', title: T('Clock'), icon: 'clock', side: 'left', render: () => { const [t, d] = clockText(); return el('div', { class: 'clock' }, el('b', {}, t), el('small', {}, d)); } });
  card({ id: 'weather', title: T('Weather'), icon: 'sun', side: 'left', render: () => weatherBlock() });
  card({ id: 'sun', title: T('Sunlight'), icon: 'sun', side: 'left', blurb: 'Scrub through the day to see where the sun falls', render: () => sunBlock() });
  card({ id: 'control', title: T('House panel'), icon: 'home', side: 'left', blurb: 'Using now, find a device, what\'s on, floors and rooms', render: () => (S.room ? roomBlock() : homeBlock()) });
  for (const x of S.live && Object.keys(S.F).length ? tiles() : []) card({ id: `tile:${x.kind}`, title: x.label, icon: x.icon, kind: 'tile', side: 'right', render: () => tileCard(x) });
  card({ id: 'cams', title: T('Cameras'), icon: 'camera', extra: true, blurb: 'Live pictures from your cameras, taking turns', render: (size) => camsCard(H, size) });
  card({ id: 'needs', title: T('What needs you'), icon: 'bell', extra: true, blurb: 'Water, smoke, open doors, unlocked locks, low batteries', render: () => needsCard(H) });
  card({ id: 'media', title: T('Now playing'), icon: 'media', extra: true, blurb: 'What\'s playing, with play and pause', render: () => mediaCard(H) });
  if (!agenda.off) card({ id: 'agenda', title: T('Coming up'), icon: 'calendar', extra: true, blurb: 'The next things on your calendars', render: (size) => agendaCard(size) });
  card({ id: 'note', title: T('Note'), icon: 'note', extra: true, blurb: 'A note for everyone who looks at this screen', render: () => noteCard() });
  return out;
}
/* Extra cards */
const DCAMS = new Map();
function dcam(d) {
  let c = DCAMS.get(d.id);
  if (!c) { const img = el('img', { alt: d.name, decoding: 'async' }); c = { d, img, wrap: el('button', { type: 'button', class: 'dcam', onclick: () => { if (!dock.arranging()) cameraModal(c.d); } }, img, el('span', { class: 'dcap' }, d.name)), last: 0, busy: false, url: null }; DCAMS.set(d.id, c); }
  c.d = d; return c;
}
setInterval(async () => {
  for (const [id, c] of DCAMS) {
    if (!c.wrap.isConnected) { if (Date.now() - c.last > 60_000) { if (c.url) URL.revokeObjectURL(c.url); DCAMS.delete(id); } continue; }
    if (c.busy || document.hidden || Date.now() - c.last < 2000) continue;
    c.busy = true; c.last = Date.now();
    try { const r = await fetch(snapUrl(c.d), { cache: 'no-store' }); if (r.ok) { const u = URL.createObjectURL(await r.blob()), t = new Image(); t.src = u; await t.decode().catch(() => {}); const old = c.url; c.img.src = u; c.url = u; if (old) setTimeout(() => URL.revokeObjectURL(old), 1000); } } catch { /* next time */ }
    finally { c.busy = false; }
  }
}, 500);
function camsCard(H, size) {
  const cams = (H?.cams || []).map((p) => p.device); if (!cams.length) return el('div', { class: 'note' }, T('No cameras on the map yet.'));
  const n = size === 'l' ? Math.min(2, cams.length) : 1, turn = Math.floor(Date.now() / 12_000) % cams.length;
  return el('div', { class: `dcams n${n}` }, ...Array.from({ length: n }, (_, i) => dcam(cams[(turn + i) % cams.length]).wrap));
}
function needsCard(H) {
  if (!H) return null;
  const low = H.pins.filter((p) => typeof p.device.battery === 'number' && p.device.battery <= 20);
  const rows = [...H.alarms.map((p) => [p, p.device.water ? 'Water!' : 'Smoke!', 'bad']), ...H.unlocked.map((p) => [p, 'Unlocked', 'warn']), ...H.openDoors.map((p) => [p, 'Open', 'warn']), ...H.openCovers.map((p) => [p, 'Open', 'warn']), ...low.map((p) => [p, `Battery ${p.device.battery}%`, ''])];
  return el('div', {}, el('div', { class: 'eyebrow' }, T('What needs you')), rows.length ? el('div', { class: 'needs' }, ...rows.slice(0, 8).map(([p, why, tone]) => el('button', { type: 'button', class: `nrow ${tone}`, onclick: () => goToPin(p) }, ic(iconOf(p.device)), el('span', { class: 'dn' }, pinName(p)), el('small', {}, why)))) : el('p', { class: 'note good' }, T('All good - nothing needs you.')));
}
function mediaCard(H) {
  const ms = (H?.pins || []).filter((p) => p.device.kind === 'media' && (p.device.playing || p.device.on));
  if (!ms.length) return el('div', {}, el('div', { class: 'eyebrow' }, T('Now playing')), el('p', { class: 'note' }, T('Nothing is playing.')));
  return el('div', {}, el('div', { class: 'eyebrow' }, T('Now playing')), ...ms.slice(0, 4).map((p) => { const d = p.device; return el('div', { class: 'drow act' }, el('div', { class: 'dtop' }, el('button', { type: 'button', class: 'dopen', onclick: () => goToPin(p) }, ic('media'), el('span', { class: 'dn' }, d.playing ? d.title || pinName(p) : pinName(p)), el('small', {}, d.playing ? pinName(p) : T('Paused'))), el('button', { type: 'button', class: 'mini', onclick: () => { d.playing = !d.playing; act(d, 'toggle'); drawLeft(); } }, d.playing ? '❚❚' : '▶'))); }));
}
let agenda = { at: 0, list: null };
function agendaCard(size) {
  if (Date.now() - agenda.at > 5 * 60_000) { agenda.at = Date.now(); api('/api/home').then((h) => { agenda.list = (h?.calendar?.events || []).filter((e) => Date.parse(e.end || e.start) > Date.now()); dock.draw(); }).catch((e) => { agenda.list = agenda.list || []; if (e.status === 404 || e.status === 501) agenda.off = true; }); }
  const ev = (agenda.list || []).slice(0, size === 's' ? 2 : size === 'l' ? 6 : 4);
  const when = (e) => { try { return new Date(e.start).toLocaleString([], e.allDay ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' } : { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz() }); } catch { return ''; } };
  return el('div', {}, el('div', { class: 'eyebrow' }, T('Coming up')), ev.length ? el('div', { class: 'agenda' }, ...ev.map((e) => el('div', { class: 'arow' }, el('i', { class: 'swatch', style: `--rc:${/^#[0-9a-f]{3,8}$/i.test(e.color || '') ? e.color : 'var(--hl)'}` }), el('span', { class: 'dn' }, e.title), el('small', {}, when(e))))) : el('p', { class: 'note' }, agenda.list ? T('Nothing coming up.') : '…'));
}
function noteCard() {
  if (dock.arranging()) return el('textarea', { class: 'dnote-edit', rows: 3, maxlength: 300, placeholder: T('Write a note for this screen…'), oninput: (e) => { prefs.dockNote = e.target.value; savePrefs(); } }, prefs.dockNote || '');
  return prefs.dockNote ? el('div', { class: 'dnote' }, prefs.dockNote) : null;
}
const dock = createDock({ el, ic, prefs, savePrefs, T, cards: dockCards, isView: () => S.mode === 'view' && !!(S.live || Object.keys(S.F).length), leftReady: () => !leftBusy(), drawerOpen: () => document.body.classList.contains('drawer'),
  extraRight: () => (document.body.classList.contains('panelmode') ? [el('button', { type: 'button', class: 'tile exit', onclick: () => setPanelMode(false) }, el('small', {}, 'Leave wall panel mode'))] : []),
  onArrange: (on) => { if (on) { closeCard(); closeInfo(); } const b = $('#arrangeBtn'); if (b) b.classList.toggle('on', on); } });
const FS_CARDS = [['all', 'All cards'], ['tiles', 'Numbers only'], ['none', 'Just the house']];
const immersive = createImmersive({ el, ic, T,
  cycleCards: () => { const i = FS_CARDS.findIndex(([k]) => k === (prefs.fsCards || 'all')); prefs.fsCards = FS_CARDS[(i + 1) % FS_CARDS.length][0]; savePrefs(); fsCardsApply(); },
  spin: () => { prefs.spin = !prefs.spin; savePrefs(); layout(false); },
  onChange: (on) => { fsCardsApply(); if (on && dock.arranging()) dock.setArrange(false); if (on && isReal() && !calm) { const t = controls.target.clone(), back = camera.position.clone().sub(t), dist = back.length(), flat = new V3(back.x, 0, back.z).normalize(); flyTo(t, t.clone().add(flat.multiplyScalar(dist * Math.cos(0.26))).add(new V3(0, dist * Math.sin(0.26), 0)), 1400); } setTimeout(() => { resize(); kick(); }, 60); const b = $('#fsBtn'); if (b) b.classList.toggle('on', on); } });
function fsCardsApply() { const k = prefs.fsCards || 'all'; document.body.classList.toggle('fs-tiles', k === 'tiles'); document.body.classList.toggle('fs-none', k === 'none'); immersive.label(T(FS_CARDS.find(([x]) => x === k)[1])); }
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
function onNowBlock(pins) {
  const live = pins.filter((p) => { const d = p.device; return (['light', 'plug', 'switch', 'fan'].includes(d.kind) && d.on) || d.playing; })
    .sort((a, b) => (b.device.powerW || 0) - (a.device.powerW || 0) || pinName(a).localeCompare(pinName(b)));
  if (!live.length) return null;
  const top = S.onNowAll ? live : live.slice(0, 6);
  const sw = (d) => el('label', { class: 'switch', title: 'Switch off' }, el('input', { type: 'checkbox', checked: true, onchange: () => { d.on = false; if (d.playing) d.playing = false; act(d, d.kind === 'media' ? 'toggle' : 'off'); drawPinsSoon(); drawLeft(); } }), el('span'));
  const go = goToPin;
  return el('div', {}, el('div', { class: 'sechead' }, `${T('On now')} · ${live.length}`),
    ...top.map((p) => { const d = p.device; return el('div', { class: 'drow act' }, el('div', { class: 'dtop' }, el('button', { type: 'button', class: 'dopen', title: `${pinName(p)}: show it and all its controls`, onclick: () => go(p) }, ic(iconOf(d)), el('span', { class: 'dn' }, pinName(p)), el('small', {}, devState(d).val ?? '')), sw(d))); }),
    live.length > 6 ? el('button', { type: 'button', class: 'mini wide', onclick: () => { S.onNowAll = !S.onNowAll; drawLeft(); } }, S.onNowAll ? 'Show fewer' : `Show all ${live.length}`) : null);
}
function findBlock() {
  const all = S.live?.pins || []; if (all.length < 8) return null;
  const q = norm(S.findQ || ''), hits = q ? all.filter((p) => norm(`${pinName(p)} ${p.device.kind}`).includes(q)).slice(0, 6) : [];
  const box = el('input', { type: 'search', placeholder: T('Find a device'), value: S.findQ || '', 'aria-label': 'Find a device on the plan',
    oninput: (e) => { S.findQ = e.target.value; S.findForce = true; drawLeft(); S.findForce = false; const n = $('#left input[type=search]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } },
    onkeydown: (e) => { if (e.key === 'Enter' && hits[0]) goToPin(hits[0]); } });
  return el('div', { class: 'findbox' }, box, ...hits.map((p) => el('button', { type: 'button', class: 'sroom', onclick: () => goToPin(p) }, ic(iconOf(p.device)), pinName(p), el('small', {}, devState(p.device).val ?? ''))),
    q && !hits.length ? el('p', { class: 'note' }, 'Nothing placed by that name.') : null);
}
function goToPin(p) {
  const F = S.F[p.floor]; if (!F) return;
  S.findQ = ''; if (S.floorView !== 'all' && S.floorView !== p.floor) pickFloor(p.floor);
  const w = F.G.localToWorld(new V3(...p.pos)); flyTo(w, w.clone().add(camera.position.clone().sub(controls.target).normalize().multiplyScalar(6))); openCard(p); drawLeft();
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
    el('div', { class: 'kpis' }, el('div', {}, el('small', {}, T('Using now')), el('b', { class: cur ? 'good' : ({ above: 'warm', high: 'bad' }[S.live?.totals?.vs?.level] || 'good'), title: cur ? null : powerSay(S.live?.totals || {}) }, fmtW(watts))), el('div', {}, el('small', {}, T('Lights on')), el('b', { class: 'warm' }, `${on}/${lights.length}`))),
    cur ? null : energyCard(S.live?.energy),
    findBlock(),
    onNowBlock(pins),
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
/* Power lines from the panel to every device: lovely in the Energy view, busy everywhere else. "Energy view" (the default)
   shows them there, in a room and while editing; the car's charging cable shows whatever is chosen. */
const linesMode = () => prefs.lines || (prefs.power === false ? 'off' : 'energy');
const linesOn = () => S.mode === 'edit' || linesMode() === 'always' || (linesMode() === 'energy' && (prefs.overlay === 'energy' || !!S.room));
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
  if (!spot) { power.update(lines, null, 0, el, look()); power.visible = true; return; }
  for (const p of S.live.pins || []) {
    const d = p.device, F = S.F[p.floor];
    if (!F || !F.G.visible || (cur && F !== cur) || !POWERED.has(d.kind) || !linesOn()) continue;
    const on = !!(d.on || d.playing) && d.online !== false, P0 = spot.w, yb = F.G.position.y + F.floorY + 0.03, Pd = F.G.localToWorld(new V3(...p.pos)), o = ((i++ % 9) - 4) * 0.05;
    const own = S.pins.find((x) => x.deviceId === p.deviceId)?.route, drawing = ['route', 'route-edit'].includes(S.tool?.type) && S.tool.dev.id === p.deviceId;
    const via = (drawing ? S.tool.pts : own) || null;   // a route the owner drew, as bends along the floor
    const mid = via?.length ? via.map(([x, z]) => { const w = F.G.localToWorld(new V3(x, 0, z)); return new V3(w.x, yb, w.z); })
      : [new V3(P0.x, yb, P0.z + o), new V3(Pd.x, yb, P0.z + o)];
    lines.push({ on: on || drawing, watts: d.powerW ?? (d.kind === 'light' ? 10 : 40), color: drawing ? '#f472b6' : d.kind === 'light' && on ? '#fbbf24' : null,
      pts: [P0.clone(), new V3(P0.x, yb, P0.z), ...mid, new V3(Pd.x, yb, Pd.z), new V3(Pd.x, Math.max(yb, Pd.y - 0.15), Pd.z)] });
  }
  power.update(lines, spot.w, S.live.totals?.powerW ?? 0, el, look());
  if (power.label && labelMode() !== 'all') { power.label.parent?.remove(power.label); power.label.element.remove(); power.label = null; }   // the panel on the left shows the total
  if (S.tool?.type === 'route-edit' && !document.body.classList.contains('dragging')) drawRouteHandles(); else if (S.tool?.type !== 'route-edit') clearRouteHandles();
  power.visible = spot.F.G.visible || !!cur;
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
  const move = (ev) => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return; if (!moved) { moved = true; controls.enabled = false; document.body.classList.add('dragging'); } onmove(ev); reshadow(); };
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
const rayAt = (cx, cy) => { const r = renderer.domElement.getBoundingClientRect(); mouse.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera); return ray; };
/* Fitting a room scan into its floor: press on the room and drag it; the camera holds still. Anywhere else still turns the view. */
renderer.domElement.addEventListener('pointerdown', (e) => {
  const t = S.tool; if (S.mode !== 'edit' || t?.type !== 'fit' || e.button !== 0) return;
  const P = S.F[t.floor]; if (!P) return;
  const hit = rayAt(e.clientX, e.clientY).intersectObject(P.G, true).find((h) => h.object.isMesh && h.object.visible); if (!hit) return;
  e.stopImmediatePropagation();
  const plane = new THREE.Plane(new V3(0, 1, 0), -hit.point.y), start = hit.point.clone(), g0 = P.G.position.clone();
  dragging(e, {
    onmove: (ev) => { const w = rayAt(ev.clientX, ev.clientY).ray.intersectPlane(plane, new V3()); if (!w) return; P.G.position.x = g0.x + w.x - start.x; P.G.position.z = g0.z + w.z - start.z; P.G.updateMatrixWorld(true); },
    onend: () => fitSave(P),
  });
}, true);
/* Editor > Yard: press on a car, the charger or a tree and drag it to where it really is. */
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (S.mode !== 'edit' || S.tab !== 'yard' || S.tool || e.button !== 0 || !yard.group.visible) return;
  const hit = rayAt(e.clientX, e.clientY).intersectObject(yard.group, true).find((h) => h.object.isMesh); if (!hit) return;
  let o = hit.object; while (o && !o.userData.yard && o.parent !== yard.group) o = o.parent;
  if (!o?.userData.yard) return;
  e.stopImmediatePropagation();
  const plane = new THREE.Plane(new V3(0, 1, 0), -groundY()), start = rayAt(e.clientX, e.clientY).ray.intersectPlane(plane, new V3()), p0 = o.position.clone(); if (!start) return;
  dragging(e, {
    onmove: (ev) => { const w = rayAt(ev.clientX, ev.clientY).ray.intersectPlane(plane, new V3()); if (!w) return; o.position.set(p0.x + w.x - start.x, p0.y, p0.z + w.z - start.z); o.updateMatrixWorld(true); drawPowerSoon(); },
    onend: () => { const y = yardData(), it = y.items.find((x) => x.id === o.userData.yard.item); if (!it) return; it.pos = [+o.position.x.toFixed(2), +o.position.z.toFixed(2)]; S.yardSel = it.id; saveYard(y); },
  });
}, true);
/* A device dragged from the list and let go over the house: it goes where it was dropped. */
function placeAt(d, cx, cy) {
  const r = renderer.domElement.getBoundingClientRect(), under = document.elementFromPoint(cx, cy);
  if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom || (under && under.closest('#left, #side, .panel'))) return false;
  const cur = curF(), hit = rayAt(cx, cy).intersectObjects(Object.values(S.F).filter((F) => F.G.visible && (!cur || F === cur)).map((F) => F.G), true).find((h) => h.object.isMesh && h.object.visible && h.object.material?.opacity !== 0 && !isClipped(h));
  const F = hit && S.F[hit.object.userData.floor]; if (!F) return false;
  const l = F.G.worldToLocal(hit.point.clone().add(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).multiplyScalar(0.15)));
  const old = S.pins.find((p) => p.deviceId === d.id);
  S.pins = S.pins.filter((p) => p.deviceId !== d.id).concat({ ...(old || {}), deviceId: d.id, floor: F.f.id, pos: [l.x, l.y, l.z] });
  S.tool = null; savePins(); toast(`${d.name} placed. Drag it on the house to fine-tune.`);
  return true;
}
function listDrag(e, d) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;   // touch: tap it, then tap the spot (a drag would fight the list's scrolling)
  e.preventDefault();   // no text selection while dragging
  let last = null; const ghost = el('div', { class: 'pin ghost' }, ic(iconOf(d)), el('span', { class: 'val' }, d.name));
  dragging(e, {
    onmove: (ev) => { if (!ghost.isConnected) document.body.append(ghost); ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; last = ev; },
    onend: () => { ghost.remove(); if (last && !placeAt(d, last.clientX, last.clientY)) toast('Let go over the house to place it.'); },
  });
}

/* ---------- rooms scanned one at a time: fit each into its floor, then join them into one ---------- */
const fitId = () => (S.tool?.type === 'fit' ? S.tool.floor : null);
const scans = () => Object.values(S.F).filter((F) => F.f.kind !== 'drawn');
/* Where a scan sits right now (it moves while it's being fitted). */
const boxNow = (F) => F.box.clone().translate(new V3(F.G.position.x - F.loadOff[0], 0, F.G.position.z - F.loadOff[1]));
function overlapping(A, B) {
  const a = boxNow(A), b = boxNow(B), w = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x), d = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  const small = Math.min((a.max.x - a.min.x) * (a.max.z - a.min.z), (b.max.x - b.min.x) * (b.max.z - b.min.z)) || 1;
  return w > 0 && d > 0 && (w * d) / small > 0.3;
}
function fitSave(P) {
  P.f.offset = [+P.G.position.x.toFixed(3), +P.G.position.z.toFixed(3)];
  return send(`/api/floorplan/floors/${P.f.id}`, 'PUT', { offset: P.f.offset, rotationY: P.f.rotationY || 0, level: P.f.level || 0, heightM: P.f.heightM || 3 }).catch(proErr);
}
function startFit(partId, baseId) {
  const P = S.F[partId], B = S.F[baseId]; if (!P || !B || P === B) return;
  const moveLevel = (P.f.level || 0) !== (B.f.level || 0);
  P.f.level = B.f.level || 0; P.f.heightM = B.f.heightM || 3;
  if (moveLevel || Object.values(S.F).some((F) => F !== P && (F.f.level || 0) === P.f.level && overlapping(F, P))) {   // set it down beside that floor, never on top of it
    const taken = new THREE.Box3(); for (const F of Object.values(S.F)) if (F !== P && (F.f.level || 0) === P.f.level) taken.union(boxNow(F));
    const b = boxNow(P); P.G.position.x += taken.max.x + 0.8 - b.min.x; P.G.position.z += (taken.min.z + taken.max.z) / 2 - (b.min.z + b.max.z) / 2; P.G.updateMatrixWorld(true);
  }
  S.tool = { type: 'fit', floor: partId, into: baseId }; S.floorView = baseId; S.room = null;
  fitSave(P); layout(true); editor();
}
function fitTurn(P, by) {   // turns around the room's own middle, so it doesn't swing away
  const mid = () => new THREE.Box3().setFromObject(P.inner).getCenter(new V3());
  const before = mid(); P.f.rotationY = ((((P.f.rotationY || 0) + by) % 360) + 540) % 360 - 180; P.inner.rotation.y = deg(P.f.rotationY); P.inner.updateMatrixWorld(true);
  const after = mid(); P.G.position.x += before.x - after.x; P.G.position.z += before.z - after.z; P.G.updateMatrixWorld(true); fitSave(P);
}
function fitNudge(P, ahead, right) {   // "away from you" and "to your right", as the view is turned now
  const f = camera.getWorldDirection(new V3()); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
  const r = new V3().crossVectors(f, new V3(0, 1, 0));
  P.G.position.addScaledVector(f, ahead).addScaledVector(r, right); P.G.updateMatrixWorld(true); fitSave(P);
}
async function joinFit() {
  const t = S.tool, P = S.F[t?.floor], B = S.F[t?.into]; if (!P || !B) return;
  const dx = P.G.position.x - B.G.position.x, dz = P.G.position.z - B.G.position.z, tag = `r${Date.now().toString(36).slice(-4)}`;
  S.tool = null; editor(); toast(`Joining ${P.f.name} to ${B.f.name}…`);
  try {
    const blob = await mergeGlb([
      { url: `/api/floorplan/floors/${B.f.id}/model`, pos: [0, 0], rotY: B.inner.rotation.y, scale: B.inner.scale.x },
      { url: `/api/floorplan/floors/${P.f.id}/model`, pos: [dx, dz], rotY: P.inner.rotation.y, scale: P.inner.scale.x, hidden: P.f.hiddenParts || [], tag }]);
    await api(`/api/floorplan/floors/${B.f.id}/model`, { method: 'PUT', headers: { 'Content-Type': 'model/gltf-binary' }, body: blob });
    const body = { rotationY: 0, scale: 1 };
    if (Array.isArray(B.f.rooms)) body.rooms = [...B.f.rooms, ...P.rooms.map((r) => ({ ...r, pos: [r.pos[0] + dx, r.pos[1] + dz] }))];
    if (P.f.paint) body.paint = { ...(B.f.paint || {}), ...Object.fromEntries(Object.entries(P.f.paint).map(([k, v]) => [`${k}_${tag}`, v])) };
    await send(`/api/floorplan/floors/${B.f.id}`, 'PUT', body);
    S.pins = S.pins.map((p) => (p.floor !== P.f.id ? p : { ...p, floor: B.f.id, pos: [p.pos[0] + dx, p.pos[1], p.pos[2] + dz], route: p.route ? p.route.map((q) => [q[0] + dx, q[1] + dz]) : null }));
    await send('/api/floorplan/pins', 'PUT', { pins: S.pins });
    const pan = S.plan.settings?.panel; if (pan?.floor === P.f.id) await send('/api/floorplan/settings', 'PUT', { panel: { floor: B.f.id, pos: [pan.pos[0] + dx, pan.pos[1], pan.pos[2] + dz] } });
    await api(`/api/floorplan/floors/${P.f.id}`, { method: 'DELETE' });
    S.floorView = B.f.id; await reload(); toast(`${P.f.name} is now part of ${B.f.name}.`);
    const next = scans().find((F) => F.f.id !== B.f.id && (F.f.level || 0) === (B.f.level || 0) && F.rooms.length <= 1);
    if (next) startFit(next.f.id, B.f.id);   // more rooms waiting beside it: straight on to the next one
  } catch (e) { proErr(e); await reload(); }
}
renderer.domElement.addEventListener('click', (e) => {
  if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;   // that was a drag
  const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const cur = curF(), targets = Object.values(S.F).filter((F) => F.G.visible && (!cur || F === cur)).map((F) => F.G);
  const hit = ray.intersectObjects(targets, true).find((h) => h.object.isMesh && h.object.visible && h.object.material?.opacity !== 0 && !isClipped(h));
  if (S.mode === 'view' && S.info) { closeInfo(); return; }
  if (S.mode === 'view' && yard.group.visible) {
    const yh = ray.intersectObject(yard.group, true).find((h) => h.object.isMesh); let o = yh?.object; while (o && !o.userData.yard && o.parent !== yard.group) o = o.parent;
    const it = o?.userData.yard && (S.plan?.yard?.items || []).find((x) => x.id === o.userData.yard.item);
    if (it?.kind === 'car' && (!hit || yh.distance <= hit.distance)) { openInfo(`car:${it.id}`); return; }
  }
  if (S.mode === 'view' && card) { closeCard(); return; }
  if (S.mode === 'view') {
    if (!hit) { if (S.room) { S.room = null; layout(true); } return; }
    const F = S.F[hit.object.userData.floor], l = F.G.worldToLocal(hit.point.clone()), i = roomAt(F, l.x, l.z);
    if (i >= 0) focusRoom(F.f.id, i); else if (!cur) pickFloor(F.f.id);
    return;
  }
  if (!S.tool || S.tool.type === 'fit' || S.dragged) return;
  if (S.tool.type === 'aim') {
    const pin = S.pins.find((x) => x.deviceId === S.tool.dev.id), P = pin && beamFrom(pin), g = ray.ray.intersectPlane(new THREE.Plane(new V3(0, 1, 0), -groundY()), new V3());
    if (!pin?.beam || !P || !g) { toast('Click on the ground outside.'); return; }
    const dx = g.x - P.x, dz = g.z - P.z, dist = Math.hypot(dx, dz);
    if (dist < 0.5) { toast('Click a little further from the light.'); return; }
    pin.beam = { ...pin.beam, aim: Math.round(Math.atan2(dz, dx) * 180 / Math.PI), reach: Math.min(30, Math.max(2, Math.round(dist * 1.25 * 2) / 2)) };
    S.tool = null; drawBeams(); savePins(); return;
  }
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
  clearSelBox();
  if (!ms) return;
  const b = new THREE.Box3(); ms.forEach((m) => b.expandByObject(m)); b.expandByScalar(0.03);
  const h = new THREE.Box3Helper(b, '#fbbf24'); h.userData.sel = true; scene.add(h);
}
function clearSelBox() { scene.children.filter((o) => o.userData.sel).forEach((o) => { scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); }); }
const clearSel = () => { S.sel = null; clearSelBox(); };

/* ---------- saving ---------- */
async function savePins() {
  try { await send('/api/floorplan/pins', 'PUT', { pins: S.pins.map(({ deviceId, floor, pos, label, color, route, beam }) => ({ deviceId, floor, pos, label, color, route, beam })) }); await refresh(); editor(); }
  catch (e) { proErr(e); }
}
const savePinsSoon = debounce(savePins, 500);
/* ---------- the yard: drawing areas, placing trees and cars ---------- */
const newId = () => Math.random().toString(36).slice(2, 10);
const yardData = () => { const y = S.plan.yard || {}; return { areas: [...(y.areas || [])], items: (y.items || []).map((it) => ({ ...it, bind: { ...(it.bind || {}) } })), seen: [...(y.seen || [])] }; };
async function saveYard(y, quiet) {
  S.plan.yard = y; buildYard(); layout(false); if (!quiet) editor();   // show it right away; the CasaTorch keeps it
  try { const r = await send('/api/floorplan/yard', 'PUT', y); S.plan.yard = r.yard; await refresh(); }
  catch (e) { proErr(e); }
}
const saveYardSoon = debounce((y) => saveYard(y, true), 400);   // typing a name or dragging a slider: no re-draw of the panel
let previewLine = null;
function yardPreview() {
  if (previewLine) { scene.remove(previewLine); previewLine.geometry.dispose(); previewLine.material.dispose(); previewLine = null; }
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
/* ---------- cars park themselves ----------
   Every car Home Assistant knows (Tesla - the app or BLE - and most EVs) is found by its sensors and parked where it parks:
   the middle of your driveway (side by side, or one behind the other on a narrow one), else by the EV charger, else beside
   the house. Done once per car; move it in Editor > Yard, and a car you remove stays removed. */
const CARISH = /tesla|\bcar\b|vehicle|\bev\b|model[ _]?[3sxy]\b|leaf|ioniq|mach[ _-]?e|bolt|polestar|rivian|lucid|taycan|bmw|audi|volvo|kia|hyundai|mercedes|volkswagen|\bvw\b|toyota|lexus|subaru|nissan|ford|chevy|chevrolet/i;
function findCars(devs) {
  const ent = (d) => d.id.replace(/^ha:[a-z_]+\./, ''), txt = (d) => `${ent(d)} ${d.name}`.replace(/_/g, ' ');
  const anchors = devs.filter((d) => (d.pres && (/_location$/.test(ent(d)) || CARISH.test(txt(d)))) || (d.bat && CARISH.test(txt(d))));
  const out = [], done = new Set();
  for (const a of anchors) {
    const stem = ent(a).replace(/_(location|battery(_level)?|state_of_charge|soc|charge_level|charge)$/, '');
    const key = a.dev ? `dev:${a.dev}` : `stem:${stem}`; if (done.has(key)) continue; done.add(key);
    const mine = devs.filter((d) => (a.dev && d.dev === a.dev) || ent(d) === stem || ent(d).startsWith(`${stem}_`));
    const best = (list, ...res) => { for (const re of res) { const hit = list.find((d) => re.test(ent(d))); if (hit) return hit; } return null; };
    const plug = best(mine.filter((d) => d.bin || d.kind === 'switch'), /charge_cable|charging_cable|charger_cable|vehicle_connected|plugged|plug_state|charge_port|charge_flap|charger_connected/, /charger$|charging$/);
    const power = best(mine.filter((d) => d.pw), /charger_power|charging_power|charge_power|charge_rate|charging_rate|charger_rate/, /power/) || best(devs.filter((d) => d.pw), /wall_connector.*power/);
    const battery = best(mine.filter((d) => d.bat), /battery_level$|state_of_charge|_soc$|charge_level$/, /battery$|battery/);
    const home = mine.find((d) => d.pres) || null;
    if (!plug && !power && !battery) continue;
    const name = String(a.name || 'Car').replace(/\s+(location|battery( level)?|state of charge|charge level)$/i, '').trim() || 'Car';
    out.push({ key, name, bind: Object.fromEntries(Object.entries({ home: home?.id, plugged: plug?.id, power: power?.id, battery: battery?.id }).filter(([, v]) => v)) });
  }
  return out;
}
const polyArea = (pts) => { let s = 0; pts.forEach((p, k) => { const q = pts[(k + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }); return Math.abs(s / 2); };
function parkSpot(i, n, yd) {
  const dw = (yd.areas || []).filter((a) => a.kind === 'driveway').sort((a, b) => polyArea(b.pts) - polyArea(a.pts))[0];
  if (dw) {
    const c = dw.pts.reduce((m, p) => [m[0] + p[0] / dw.pts.length, m[1] + p[1] / dw.pts.length], [0, 0]);
    let dir = [1, 0], len = 0; dw.pts.forEach((p, k) => { const q = dw.pts[(k + 1) % dw.pts.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz); if (l > len) { len = l; dir = [dx / l, dz / l]; } });
    const side = [-dir[1], dir[0]], proj = (v) => dw.pts.map((p) => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]), w = Math.max(...proj(side)) - Math.min(...proj(side));
    const k = i - (n - 1) / 2, wide = w >= n * 2.5, step = wide ? 2.6 : 5.2, v = wide ? side : dir;   // side by side if it fits, else one behind the other
    return { pos: [c[0] + v[0] * k * step, c[1] + v[1] * k * step].map((x) => +x.toFixed(2)), rot: Math.round(-Math.atan2(dir[1], dir[0]) * 180 / Math.PI) };
  }
  const ch = (yd.items || []).find((it) => it.kind === 'charger');
  if (ch) return { pos: [+(ch.pos[0] + 1.6 + i * 2.6).toFixed(2), ch.pos[1]], rot: 90 };
  const B = S.houseBox; if (!B) return null;
  return { pos: [+(B.max.x + 3 + i * 2.6).toFixed(2), +((B.min.z + B.max.z) / 2).toFixed(2)], rot: 90 };
}
async function autoCars() {
  if (S.autoCarsTried || !S.plan?.pro?.pro || !S.live?.devices?.length || !S.houseBox) return; S.autoCarsTried = true;
  const y = yardData(), have = y.items.filter((it) => it.kind === 'car'), used = new Set(have.flatMap((it) => Object.values(it.bind || {})));
  const found = findCars(S.live.parts || S.live.devices).filter((c) => !y.seen.includes(c.key) && !Object.values(c.bind).some((v) => used.has(v)));
  if (!found.length) return;
  const named = [];
  const blank = have.filter((it) => !Object.keys(it.bind || {}).length), blank0 = blank.length;   // a car you added but never linked: link it, where you put it
  found.forEach((c, i) => { const mine = blank.shift(); if (mine) { mine.bind = c.bind; if (!mine.name || mine.name === 'Car') mine.name = c.name.slice(0, 30); y.seen.push(c.key); named.push(c.name); return; } const sp = parkSpot(have.length + i, have.length + found.length, y); if (!sp) return; y.items.push({ id: newId(), kind: 'car', name: c.name.slice(0, 30), color: '#cfd6df', body: /model[ _]?[xy]\b|suv/i.test(c.name) ? 'suv' : 'sedan', pos: sp.pos, rot: sp.rot, scale: 1, bind: c.bind }); y.seen.push(c.key); named.push(c.name); });
  const blankUsed = blank.length < blank0;
  if (!named.length) return;
  try {
    const r = await send('/api/floorplan/yard', 'PUT', y); S.plan.yard = r.yard; buildYard(); layout(false); fitView(); S.liveSig = null; await refresh(); if (S.mode === 'edit') editor();
    const where = blankUsed ? 'where you put it' : (y.areas || []).some((a) => a.kind === 'driveway') ? 'on the driveway' : 'next to the house';
    toast(`Found ${named.join(' and ')} - ${named.length > 1 ? 'they show' : 'it shows'} on your 3D home${blankUsed ? '' : ` ${where}`}. Drag a car in Editor › Yard to change where it parks.`);
  } catch { /* someone who can only look: nothing is saved */ }
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
  const y = yardData(), devs = S.live?.parts || S.live?.devices || [];
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
      el('button', { type: 'button', class: 'mini', onclick: () => { const g = findCars(devs)[0]?.bind || guessCar(devs); const n = Object.values(g).filter(Boolean).length; if (!n) { toast('No car sensors found. Add your car to Home Assistant first (Connect > Add any Home Assistant integration).'); return; } it.bind = Object.fromEntries(Object.entries(g).filter(([, v]) => v)); toast(`Found ${n} of 4 - check them below.`); saveYard(y); } }, 'Find my car\'s sensors'),
      pick('Home or away', 'home', it, (d) => d.pres), pick('Plugged in', 'plugged', it, (d) => d.bin || d.kind === 'switch'), pick('Charging power', 'power', it, (d) => d.pw), pick('Battery', 'battery', it, (d) => d.bat))
      : it.kind === 'charger' ? el('p', { class: 'note' }, 'The charging cable runs from here to a car that\'s plugged in, and a power line runs here from your panel.')
      : el('div', { class: 'row' }, el('label', {}, 'Size'), el('input', { type: 'range', min: 0.4, max: 3, step: 0.1, value: it.scale || 1, oninput: (e) => { it.scale = Number(e.target.value); save(); } }));
    return el('div', { class: `edrow${sel ? ' sel' : ''}` }, head, btns, more);
  };
  return el('div', {}, el('p', { class: 'note' }, 'Draw the yard and add trees, bushes and your car so the 3D home looks like your place. Cars from Home Assistant park themselves on your driveway. Drag a car, the charger or a tree on the house to where it really is.'),
    el('h3', {}, 'Draw an area'),
    el('div', { class: 'row wrap' }, ...Object.entries(AREA_KINDS).map(([k, [n]]) => el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = { type: 'yard-area', kind: k, pts: [] }; editor(); } }, n))),
    y.areas.length ? el('div', {}, ...y.areas.map((a, i) => el('div', { class: 'edrow' }, el('div', { class: 'dtop' }, el('i', { class: 'swatch', style: `--rc:${AREA_KINDS[a.kind]?.[1] || '#888'}` }), el('span', {}, AREA_KINDS[a.kind]?.[0] || a.kind), el('small', {}, `${a.pts.length} corners`)),
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
  const looked = editLook(); S.mode = m; S.tool = null; clearSel(); S.room = null; closeCard(); if (m === 'edit') { if (S.tour) stopTour(); controls.autoRotate = false; }
  if (looked !== editLook()) { skyAt = 0; applyLook(); drawThemeSeg(); }
  document.body.classList.toggle('editing', m === 'edit');
  $('#side').hidden = true; $('#side').dataset.kind = '';
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === m);
  if (m === 'edit') editor(); else $('#left').hidden = true;
  drawPins();
}
const edFloor = () => curF() || Object.values(S.F)[0];
/* The editor panel is drawn again whenever something is saved. Someone typing (a room's name, a device's name) keeps typing:
   the field they were in gets the focus and the cursor back, wherever it is in the new panel. */
/* ---------- undo and redo (the last 10 changes in the editor) ----------
   Before the editor saves a change, the plan as it was is kept. Undo puts it back - devices, power lines, rooms, the yard,
   colors, floors' place and turn, the panel and north - and Redo puts the change back again. Typing a name counts as one
   change, not one per letter. Uploading, joining or removing a scan can't be undone; the list starts again after those. */
S.hist = { undo: [], redo: [], busy: false, last: '', at: 0 };
const UNDOABLE = /^\/api\/floorplan\/(pins|yard|style|settings|floors\/[\w-]+(\/plan)?)$/;
const WHAT = (u) => (/pins/.test(u) ? 'devices' : /yard/.test(u) ? 'the yard' : /style/.test(u) ? 'colors' : /settings/.test(u) ? 'house settings' : 'the floor');
async function undoBefore(url, method) {
  const H = S.hist; if (H.busy || method === 'GET' || !url.startsWith('/api/floorplan')) return;
  if ((method === 'POST' && /\/floors/.test(url)) || method === 'DELETE' || /\/model$/.test(url)) { H.undo = []; H.redo = []; return; }   // scans: not undoable
  if (method !== 'PUT' || !UNDOABLE.test(url) || S.mode !== 'edit') return;
  const now = Date.now(); if (url === H.last && now - H.at < 1500) { H.at = now; return; }   // the same thing, still being typed or dragged
  H.last = url; H.at = now;
  try { const before = await (await fetch('/api/floorplan')).json(); H.undo.push({ plan: before, what: WHAT(url) }); if (H.undo.length > 10) H.undo.shift(); H.redo = []; } catch { /* no snapshot: nothing to undo for this one */ }
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
async function putPlan(to, from) {   // send only what differs
  const put = (u, b) => api(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  if (!same(to.pins, from.pins)) await put('/api/floorplan/pins', { pins: to.pins || [] });
  if (!same(to.yard, from.yard)) await put('/api/floorplan/yard', to.yard || { areas: [], items: [], seen: from.yard?.seen || [] });
  if (to.style && !same(to.style, from.style)) await put('/api/floorplan/style', to.style);
  if (!same(to.settings, from.settings)) await put('/api/floorplan/settings', { panel: to.settings?.panel || null, northDeg: to.settings?.northDeg || 0, frontDeg: to.settings?.frontDeg || 0 });
  for (const f of to.floors || []) {
    const now = (from.floors || []).find((x) => x.id === f.id); if (!now) continue;
    const keys = ['name', 'level', 'heightM', 'rotationY', 'scale', 'offset', 'look', 'rooms', 'hiddenParts', 'paint'];
    if (keys.some((k) => !same(f[k], now[k]))) await put(`/api/floorplan/floors/${f.id}`, { name: f.name, level: f.level, heightM: f.heightM, rotationY: f.rotationY, scale: f.scale, offset: f.offset, look: f.look || 'auto', rooms: f.rooms ?? null, hiddenParts: f.hiddenParts || [], paint: f.paint || {} });
    if (f.kind === 'drawn' && !same(f.plan, now.plan)) await put(`/api/floorplan/floors/${f.id}/plan`, { rooms: f.plan?.rooms || [], walls: f.plan?.walls || [], bgW: f.plan?.bgW, bgOpacity: f.plan?.bgOpacity });
  }
}
async function undoRedo(dir) {
  const H = S.hist, from = dir === 'undo' ? H.undo : H.redo, to = dir === 'undo' ? H.redo : H.undo;
  if (H.busy || !from.length) return;
  H.busy = true; H.last = '';
  try {
    const step = from.pop(), cur = await (await fetch('/api/floorplan')).json();
    to.push({ plan: cur, what: step.what });
    S.tool = null; await putPlan(step.plan, cur); await reload();
    toast(`${dir === 'undo' ? 'Undone' : 'Redone'}: a change to ${step.what}.`);
  } catch (e) { proErr(e); await reload().catch(() => {}); }
  finally { H.busy = false; editor(); }
}
addEventListener('keydown', (e) => {   // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y - except while typing, where they undo the typing
  if (S.mode !== 'edit' || !(e.ctrlKey || e.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo('undo'); } else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); undoRedo('redo'); }
});
const undoBar = () => { const H = S.hist, mac = /Mac|iPhone|iPad/.test(navigator.platform), key = mac ? '⌘' : 'Ctrl+';
  return el('div', { class: 'undobar' },
    el('button', { type: 'button', class: 'mini', disabled: H.undo.length && !H.busy ? null : true, title: H.undo.length ? `Undo a change to ${H.undo[H.undo.length - 1].what} (${key}Z)` : 'Nothing to undo', onclick: () => undoRedo('undo') }, '↶ Undo'),
    el('button', { type: 'button', class: 'mini', disabled: H.redo.length && !H.busy ? null : true, title: H.redo.length ? `Redo a change to ${H.redo[H.redo.length - 1].what} (${key}${mac ? '⇧Z' : 'Y'})` : 'Nothing to redo', onclick: () => undoRedo('redo') }, '↷ Redo'),
    el('small', {}, H.undo.length ? `${H.undo.length} of the last 10 changes can be undone` : '')); };
function editor() {
  const box = $('#left'), a = document.activeElement;
  const typing = a && box.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'file', 'button'].includes(a.type)));
  if (!typing) { editorDraw(); return; }
  const all = [...box.querySelectorAll('input, textarea')], at = { i: all.indexOf(a), room: a.dataset.room, ph: a.placeholder, type: a.type, s0: a.selectionStart, s1: a.selectionEnd, top: box.scrollTop };
  editorDraw();
  const now = [...box.querySelectorAll('input, textarea')];
  const n = (at.room != null && box.querySelector(`input[data-room="${at.room}"]`)) || (at.ph && now.find((x) => x.placeholder === at.ph && x.type === at.type)) || now[at.i];
  if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(at.s0, at.s1); } catch { /* not a text field */ } }
  box.scrollTop = at.top;
}
function editorDraw() {
  if (S.mode !== 'edit') { clearRouteHandles(); return; }
  if (S.tool?.type !== 'route-edit') clearRouteHandles();
  const box = $('#left'); box.hidden = false;
  const tabs = [['devices', 'Devices'], ['rooms', 'Rooms'], ['yard', 'Yard'], ['colors', 'Colors'], ['floors', 'Floors']];
  const body = { devices: edDevices, rooms: edRooms, yard: edYard, colors: edColors, floors: edFloors }[S.tab]();
  const er = S.tool?.type === 'erase' ? S.tool : null;
  if (er) { const F = S.F[er.floor]; return fill(box, el('div', { class: 'hint' }, `Hiding parts of ${F?.f.name}. Click anything that shouldn't be there - a stray chair, scan noise, a wall from next door. ${er.done.length} hidden so far. Nothing is deleted from your scan; you can bring it all back.`,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => { S.tool = null; reload(); } }, 'Done'),
      el('button', { type: 'button', class: 'mini', disabled: er.done.length ? null : true, onclick: () => { const k = er.done.pop(); saveHidden(F, (F.f.hiddenParts || []).filter((x) => x !== k)); F.inner.traverse((o) => { if (o.isMesh && o.userData.key === k) o.visible = true; }); editor(); } }, 'Undo last')))); }
  const ft = S.tool?.type === 'fit' ? S.tool : null;
  if (ft) {
    const P = S.F[ft.floor], B = S.F[ft.into], b = (label, fn, cls = 'mini') => el('button', { type: 'button', class: cls, onclick: fn }, label);
    if (P && B) return fill(box, el('div', { class: 'hint col' },
      el('div', {}, el('b', {}, `Fitting ${P.f.name} into ${B.f.name}`), el('p', { class: 'note' }, 'Press on the room and drag it until its walls meet the rest of the floor. Turn it if it faces the wrong way. Then press Join.')),
      el('div', { class: 'row' }, el('small', {}, 'Turn'), b('⟲ 90°', () => fitTurn(P, 90)), b('⟳ 90°', () => fitTurn(P, -90)), b('⟲ 5°', () => fitTurn(P, 5)), b('⟳ 5°', () => fitTurn(P, -5))),
      el('div', { class: 'row' }, el('small', {}, 'Nudge'), b('◀', () => fitNudge(P, 0, -0.1)), b('▶', () => fitNudge(P, 0, 0.1)), b('▲', () => fitNudge(P, 0.1, 0)), b('▼', () => fitNudge(P, -0.1, 0))),
      el('div', { class: 'row' }, b(`Join to ${B.f.name}`, joinFit, 'mini primary'), b('Keep it separate', () => { S.tool = null; layout(true); editor(); }))));
    S.tool = null;
  }
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
  const hint = S.tool?.type === 'yard-place' ? `Click on the ground where the ${ITEM_KINDS[S.tool.kind].toLowerCase()} goes.` : S.tool?.type === 'yard-move' ? 'Click on the ground where it should go.' : S.tool?.type === 'aim' ? `Click the ground where "${S.tool.dev.name}" shines.` : S.tool?.type === 'panel' ? 'Click where the electrical panel is (a wall or the floor next to it).' : S.tool?.type === 'device' ? `Click on the house where "${S.tool.dev.name}" is.` : S.tool?.type === 'room' ? 'Click the middle of the room on the model.' : S.tool?.type === 'paint' ? 'Click any wall, floor, door or piece of furniture.' : null;
  fill(box, undoBar(), el('div', { class: 'tabs' }, ...tabs.map(([k, n]) => el('button', { type: 'button', class: S.tab === k ? 'on' : '', onclick: () => { const looked = editLook(); S.tab = k; if (looked !== editLook()) { skyAt = 0; applyLook(); } S.tool = k === 'colors' && S.tool?.type === 'paint' ? S.tool : null; if (k !== 'colors') clearSel(); editor(); drawPins(); } }, n))),
    hint ? el('div', { class: 'hint' }, hint, el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = null; editor(); drawPins(); } }, 'Cancel')) : null, body);
}
function floorPicker() {
  if (Object.keys(S.F).length < 2) return null;
  const s = el('select', { onchange: (e) => { pickFloor(e.target.value); editor(); } }, ...Object.values(S.F).map((F) => el('option', { value: F.f.id, selected: edFloor() === F ? true : null }, F.f.name)));
  return el('div', { class: 'row' }, el('label', {}, 'Floor'), s);
}
const pinOf = (id) => S.pins.find((x) => x.deviceId === id);
function beamRow(d, p0) {
  const p = pinOf(d.id) || p0, cur = () => pinOf(d.id) || p, b = p.beam, bb = () => cur().beam || b, live = () => { drawBeams(); }, keep = () => savePins();
  const box = el('label', { class: 'chk', title: 'It is outside and shines one way, like a flood light or a porch light' }, el('input', { type: 'checkbox', checked: b ? true : null,
    onchange: (e) => { const q = cur(); q.beam = e.target.checked ? { aim: autoAim(q), spread: 70, reach: 8 } : null; keep(); if (p.beam) toast(`${pinName({ ...p, device: d })} now shines outward. Click Aim, then the spot on the ground it lights.`); } }), 'Outdoor flood light');
  if (!b) return el('div', { class: 'row' }, box, /flood|porch|outdoor|outside|exterior|garage|driveway|patio|yard|garden|landscape|security|path|deck|front door|back door/i.test(`${p.label || ''} ${d.name}`) ? el('small', {}, 'Sounds like an outdoor light') : null);
  const slider = (label, key, min, max, step, unit) => el('div', { class: 'row' }, el('label', {}, label), el('input', { type: 'range', min, max, step, value: b[key], 'aria-label': label,
    oninput: (e) => { bb()[key] = Number(e.target.value); e.target.nextSibling.textContent = `${bb()[key]}${unit}`; live(); }, onchange: keep }), el('small', {}, `${b[key]}${unit}`));
  const turn = (by) => { const x = bb(); x.aim = ((x.aim + by + 540) % 360) - 180; live(); savePinsSoon(); };
  return el('div', { class: 'beamset' }, el('div', { class: 'row' }, box),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', title: 'Then click the ground where it shines', onclick: () => { S.tool = { type: 'aim', dev: { id: d.id, name: p.label || d.name } }; editor(); } }, 'Aim it'),
      el('button', { type: 'button', class: 'mini', title: 'Turn left 15°', onclick: () => turn(-15) }, '⟲ 15°'), el('button', { type: 'button', class: 'mini', title: 'Turn right 15°', onclick: () => turn(15) }, '⟳ 15°'),
      el('button', { type: 'button', class: 'mini', title: 'Point straight out from the house', onclick: () => { bb().aim = autoAim(cur()); live(); keep(); } }, 'Straight out')),
    slider('Width', 'spread', 15, 160, 5, '°'), slider('Reach', 'reach', 2, 30, 0.5, ' m'));
}
function edDevices() {
  const placed = new Map(S.pins.map((p) => [p.deviceId, p])), q = S.q.toLowerCase();
  /* Cars live in the yard (Editor > Yard), not on the device list - a car's headlights or charge switch aren't something to place in a room. */
  const carKeys = new Set(findCars(S.live?.parts || S.live?.devices || []).map((c) => c.key)), carIds = new Set((S.plan.yard?.items || []).filter((it) => it.kind === 'car').flatMap((it) => Object.values(it.bind || {})));
  const devs = (S.live?.devices || []).filter((d) => !(d.dev && carKeys.has(`dev:${d.dev}`)) && !carIds.has(d.id)).filter((d) => !q || `${d.name} ${d.id}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const search = el('input', { type: 'search', placeholder: 'Search devices', value: S.q });
  search.oninput = () => { S.q = search.value; editor(); const n = $('#left input[type=search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  const pick = (d) => { S.tool = { type: 'device', dev: d }; editor(); drawPins(); };
  const placedRow = (d) => { const p = placed.get(d.id), active = S.tool?.dev?.id === d.id;
    return el('div', { class: `edrow${active ? ' sel' : ''}` }, el('div', { class: 'dtop' }, ic(iconOf(d)), el('input', { type: 'text', value: p.label || '', placeholder: d.name, title: 'Name on the plan', oninput: (e) => { (pinOf(d.id) || p).label = e.target.value.trim() || null; savePinsSoon(); } }),
      d.kind === 'light' ? el('input', { type: 'color', value: p.color || '#ffc477', title: 'Glow color', oninput: (e) => { (pinOf(d.id) || p).color = e.target.value; savePinsSoon(); } }) : null),
    d.kind === 'light' ? beamRow(d, p) : null,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => pick(d) }, 'Move'), POWERED.has(d.kind) ? el('button', { type: 'button', class: 'mini', title: 'Move the power line\'s bends to where the wire really runs', onclick: () => routeEdit(d) }, 'Edit power line') : null,
      p.route ? el('button', { type: 'button', class: 'mini', title: 'Back to the automatic route', onclick: () => saveRoute(d.id, null) }, 'Auto line') : null,
      el('button', { type: 'button', class: 'mini', onclick: () => { S.pins = S.pins.filter((x) => x.deviceId !== d.id); savePins(); } }, 'Remove'), el('small', {}, S.F[p.floor]?.f.name || ''))); };
  const free = devs.filter((d) => !placed.has(d.id)), on = devs.filter((d) => placed.has(d.id));
  const sugg = autoPlaces(free);
  return el('div', {}, el('p', { class: 'note' }, 'Drag a device from the list onto the house (or tap it, then tap the spot). To move one later, just drag it on the house.'), search,
    el('div', { class: 'edrow' }, el('div', { class: 'dtop' }, ic('plug'), el('b', {}, 'Electrical panel'), el('small', {}, S.plan.settings?.panel ? 'placed' : 'front corner')),
      el('p', { class: 'note' }, 'Where the power comes into the house. The power lines start here.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = { type: 'panel', dev: { id: '_panel', name: 'the electrical panel' } }; editor(); } }, S.plan.settings?.panel ? 'Move' : 'Place it'),
        S.plan.settings?.panel ? el('button', { type: 'button', class: 'mini', onclick: () => saveSettings({ panel: null }) }, 'Reset') : null)),
    sugg.length ? el('div', { class: 'edrow' }, el('div', { class: 'dtop' }, ic('dot'), el('b', {}, `${sugg.length} can go straight into their rooms`)),
      el('p', { class: 'note' }, 'Home Assistant already knows which room these are in, and you have rooms with the same names. Place them in the middle of their rooms, then drag each one to the exact spot.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini primary', onclick: () => { S.pins = S.pins.concat(sugg.map((x) => x.pin)); savePins(); toast(`Placed ${sugg.length} devices. Drag any of them to move it.`); } }, `Place ${sugg.length}`))) : null,
    el('h3', {}, `Not placed (${groupFree(free).length})`), ...groupFree(free).map((g) => {
      const open = !!q || S.open?.has(g.k), row = (d, sub) => el('button', { type: 'button', class: `edrow pick${sub ? ' sub' : ''}${S.tool?.dev?.id === d.id ? ' sel' : ''}`, title: 'Drag it onto the house - or click it, then click the spot', onclick: () => { if (!S.dragged) pick(d); }, onpointerdown: (e) => listDrag(e, d) }, ic(iconOf(d)), el('span', { class: 'nm' }, d.name), el('small', {}, KIND_WORD[d.kind] || d.kind));
      return el('div', { class: 'edgroup' }, row(g.main), g.more.length && !q ? el('button', { type: 'button', class: 'mini wide', 'aria-expanded': String(open), onclick: () => { S.open ||= new Set(); if (open) S.open.delete(g.k); else S.open.add(g.k); editor(); } }, open ? 'Hide its other parts' : `+ ${g.more.length} more from this device`) : null, ...(open ? g.more.map((d) => row(d, true)) : []));
    }),
    el('h3', {}, `On the plan (${on.length})`), ...on.map(placedRow));
}
/* Devices Home Assistant has in an area whose name matches one of your rooms: placed in a little ring
   around the room's centre, at about light-switch height, ready to drag into place. */
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/* One row per real device: a car or a plug with several sensors is one row, its other parts tucked under it. */
const KIND_WORD = { value: 'Reading', light: 'Light', plug: 'Plug', switch: 'Switch', fan: 'Fan', media: 'Speaker', camera: 'Camera', climate: 'Thermostat', lock: 'Lock', cover: 'Door or blind', vacuum: 'Vacuum', sensor: 'Sensor', presence: 'Person', leak: 'Leak sensor' };
const KIND_RANK = ['light', 'plug', 'switch', 'fan', 'media', 'camera', 'climate', 'lock', 'cover', 'vacuum', 'leak', 'sensor', 'presence'];
const kindRank = (d) => { const i = KIND_RANK.indexOf(d.kind); return i < 0 ? KIND_RANK.length : i; };
function groupFree(free) {
  const by = new Map();
  for (const d of free) { const k = d.dev ? `dev:${d.dev}` : `name:${norm(d.name)}`; by.set(k, [...(by.get(k) || []), d]); }
  return [...by.entries()].map(([k, list]) => { list.sort((a, b) => kindRank(a) - kindRank(b) || a.name.length - b.name.length); return { k, main: list[0], more: list.slice(1) }; }).sort((a, b) => a.main.name.localeCompare(b.main.name));
}
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
    el('label', { class: 'chk', title: 'A bright, flat look while you place devices and draw - your own look stays for viewing' }, el('input', { type: 'checkbox', checked: prefs.editLook !== false ? true : null, onchange: (e) => { prefs.editLook = e.target.checked; savePrefs(); } }), 'Use the bright editing look on the other tabs'),
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
  const into = el('select', {}, el('option', { value: '' }, 'A whole floor'), ...scans().map((F) => el('option', { value: F.f.id }, `A room of ${F.f.name}`)));
  async function upload(given) {
    if (!given && !file.files.length) { toast('Choose the file from your scan first.'); return; }
    /* Several scan files at once (RoomPlan apps export one per room): each is its own model. Otherwise the files belong together (an .obj with its .mtl, a .gltf with its .bin). */
    const list = given || [...file.files], models = list.filter((x) => /\.(usdz|usdc|usda|usd|glb)$/i.test(x.name)), groups = models.length > 1 && models.length === list.length ? models.map((x) => [x]) : [list];
    let base = into.value; const made = [];
    try {
      for (const [i, g] of groups.entries()) {
        toast(groups.length > 1 ? `Preparing ${i + 1} of ${groups.length}…` : 'Preparing the model…');
        const m = await toGlb(g); toast(`Uploading (${Math.max(1, Math.round(m.blob.size / 1e6))} MB)…`);
        const lvl = base ? S.plan.floors.find((x) => x.id === base)?.level || 0 : null;
        const r = await api(`/api/floorplan/floors?name=${encodeURIComponent(groups.length > 1 ? m.name : name.value || m.name)}${lvl != null ? `&level=${lvl}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: m.blob });
        if (groups.length > 1 && !base) base = r.id; else made.push(r.id);   // several rooms and no floor picked: the first one is the floor, the rest are its rooms
      }
      await reload();
      if (base && made.length) { for (const id of made) startFit(id, base); toast(made.length > 1 ? `Drag each room into place, then Join. ${made.length - 1} more wait beside the floor.` : 'Drag the room into place, then press Join.'); }
      else toast('Floor added.');
    } catch (e) { proErr(e); await reload().catch(() => {}); }
  }
  /* In the CasaTorch app on an iPhone or iPad with LiDAR: scan a room right here; the scan comes straight in, as if you had uploaded it. */
  const N = window.CasaNative, canScan = !!N?.lidar;
  async function scanHere() {
    try {
      const avail = await N.lidar(); if (!avail?.available) { toast(avail?.why || 'This phone has no LiDAR scanner.'); return; }
      const r = await N.scanRoom(); if (!r) return;   // cancelled
      const f = new File([r.bytes], `${(r.name || name.value || 'Room scan').replace(/[^\w .-]/g, '')}.usdz`, { type: 'model/vnd.usdz+zip' });
      if (!name.value) name.value = r.name || '';
      await upload([f]);
    } catch (e) { toast(e.message || 'The scan didn\'t finish.'); }
  }
  const put = (f, body) => send(`/api/floorplan/floors/${f.id}`, 'PUT', body).then(reload).catch(proErr);
  const lone = scans().filter((F) => F.rooms.length <= 1);
  return el('div', {},
    scans().length > 1 && lone.length ? el('div', { class: 'hint col' }, el('b', {}, 'Scanned one room at a time?'), el('span', {}, `Each room scan shows up as a floor of its own. On each room below, pick "Join to: A room of …" to fit it into its floor.`)) : null,
    ...S.plan.floors.map((f) => { const F = S.F[f.id];
      const n = (k, label, step) => el('div', { class: 'row' }, el('label', {}, label), el('input', { type: 'number', step, value: k === 'offsetX' ? f.offset[0] : k === 'offsetZ' ? f.offset[1] : f[k], onchange: (e) => { const v = Number(e.target.value); put(f, k === 'offsetX' ? { offset: [v, f.offset[1]] } : k === 'offsetZ' ? { offset: [f.offset[0], v] } : { [k]: v }); } }));
      return el('div', { class: 'card' }, el('div', { class: 'row' }, el('label', {}, 'Name'), el('input', { type: 'text', value: f.name, maxlength: 40, onchange: (e) => put(f, { name: e.target.value }) })),
        n('level', 'Level (0 = ground)', 1), n('heightM', 'Height (m)', 0.1), n('rotationY', 'Turn (°)', 5), n('scale', 'Scale', 0.01), n('offsetX', 'Shift X (m)', 0.1), n('offsetZ', 'Shift Z (m)', 0.1),
        F && f.kind !== 'drawn' && scans().length > 1 ? el('div', { class: 'row' }, el('label', {}, 'Join to'), el('select', { title: 'This scan is one room of another floor: fit it in place, then join them', onchange: (e) => { if (e.target.value) startFit(f.id, e.target.value); } },
          el('option', { value: '' }, 'It is its own floor'), ...scans().filter((x) => x.f.id !== f.id).map((x) => el('option', { value: x.f.id }, `A room of ${x.f.name}`)))) : null,
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
    el('h3', {}, canScan ? 'Or scan a room with this phone' : 'Or upload a LiDAR scan'), el('div', { class: 'row' }, el('label', {}, 'This is'), into), el('div', { class: 'row' }, el('label', {}, 'Name'), name),
    canScan ? el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', onclick: scanHere }, 'Scan a room'), el('small', { class: 'note' }, 'Walk the room slowly with the camera on the walls; the scan comes straight in.')) : null,
    canScan ? el('p', { class: 'note' }, 'Or upload a scan file:') : null, file,
    el('p', { class: 'note' }, 'USDZ, GLB, GLTF, OBJ or a .zip of any of them. Scans from Apple RoomPlan apps (LiDarPlan, KIRI Engine Room Scan, Lagarsoft) come with walls, doors, furniture and rooms already named.'),
    el('p', { class: 'note' }, 'Scanned room by room? Pick all the room files together, or upload each one as "A room of" its floor. You drag each room into place and join them into one floor.'),
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
/* How now compares with your usual at this hour (the server learns it - 'learning' for the first days). */
function powerSay(t) {
  const v = t.vs || {}, day = new Date().toLocaleDateString(undefined, { weekday: 'long' }), hr = new Date().toLocaleTimeString(undefined, { hour: 'numeric' });
  if (!v.level || v.level === 'learning') return 'Learning what is usual for your home at this time - a few days.';
  const when = v.sameDay ? `on a ${day} around ${hr}` : `around ${hr}`, u = fmtW(v.usual);
  return { low: `Lower than usual (${u} ${when}).`, normal: `About usual (${u} ${when}).`, above: `Higher than usual (${u} ${when}).`, high: `Much higher than usual (${u} ${when}).` }[v.level];
}
function drawTotals() {
  const t = S.live?.totals || {};
  const v = t.vs || {}, tone = { low: 'good', normal: 'good', above: 'warn', high: 'bad' }[v.level] || '';
  const chip = (cls, label, value, kind, title) => el('button', { type: 'button', class: `stat ${cls}`, title, onclick: () => (S.mode === 'view' ? openInfo(kind) : null) }, el('small', {}, label), value);
  fill($('#totals'), chip(`power ${tone}`, 'Power', fmtW(t.powerW ?? 0), 'energy', powerSay(t)), chip('warm', 'Lights', `${t.lightsOn ?? 0} on`, 'lights', 'Every light, with a switch'),
    ...(t.playing || []).slice(0, 1).map((p) => el('span', { class: 'stat music' }, el('small', {}, 'Playing'), p.title || p.name)),
    ...(t.openDoors ? [chip('bad', 'Open', `${t.openDoors}`, 'security', 'What is open')] : []), ...(t.leaks ? [chip('bad', 'Leak', '!', 'security', 'Water or smoke')] : []));
}
let refreshRun = null, refreshNext = null;
function refresh() {   // one at a time: an older answer can never land after a newer one; a burst of calls becomes one more
  if (!refreshRun) { refreshRun = refreshOnce().finally(() => { refreshRun = null; }); return refreshRun; }
  return (refreshNext ||= refreshRun.catch(() => {}).then(() => { refreshNext = null; return refresh(); }));
}
async function refreshOnce() {
  try { S.live = await api('/api/floorplan/live'); if (!S.autoCarsTried) setTimeout(autoCars, 0); S.pins = (S.live.pins || []).map(({ deviceId, floor, pos, label, color, route, beam }) => ({ deviceId, floor, pos, label, color, route, beam })); const sig = JSON.stringify([S.live.pins, S.live.devices, S.live.totals, S.live.cars, S.live.weather]); if (sig === S.liveSig) return; S.liveSig = sig;   // nothing changed: leave the scene alone
    drawPins(); drawTotals(); if (S.mode === 'edit' && S.tab === 'devices' && !$('#left').contains(document.activeElement) && !S.tool) editor(); }
  catch { S.misses = (S.misses || 0) + 1; if (S.misses === 3) toast('Can\'t reach your devices right now - trying again every few seconds.'); return; }
  if (S.misses >= 3) toast('Connected again.'); S.misses = 0;
}
function drawThemeSeg() { $('#themeSeg').replaceChildren(seg(Object.entries(THEMES).map(([k, t]) => [k, t.label]), curTheme(), (v) => { prefs.theme = v; savePrefs(); applyLook(); drawThemeSeg(); drawTools(); if (S.mode === 'edit') editor(); })); }
async function reload() { S.plan = await api('/api/floorplan'); await loadFloors(); await refresh(); drawThemeSeg(); if (S.mode === 'edit') editor(); }
async function start() {
  try { const { lang } = await api('/api/lang'); if (lang) await CasaI18n.use(lang); } catch { /* keep this browser's choice */ }
  for (const b of document.querySelectorAll('#modeSeg button')) b.textContent = T(b.dataset.mode === 'edit' ? 'Editor' : '3D');
  $('#guideBtn').textContent = T('Help');
  if (!$('#fsBtn')) {   // Arrange and Full screen, next to Help
    const arr = el('button', { type: 'button', id: 'arrangeBtn', class: 'tog', title: T('Move, size, hide and add the cards around the house'), onclick: () => { if (S.mode !== 'view') setMode('view'); dock.setArrange(!dock.arranging()); } }, ic('grid'), el('span', { class: 'btxt' }, T('Arrange')));
    const fs = el('button', { type: 'button', id: 'fsBtn', class: 'tog', title: `${T('Full screen')} (F)`, 'aria-label': T('Full screen'), onclick: () => immersive.toggle() }, ic('expand'), el('span', { class: 'btxt' }, T('Full screen')));
    $('#guideBtn').before(arr, fs);
  }
  S.plan = await api('/api/floorplan'); adoptServerView(S.plan.view);
  units = S.plan.units || 'F';
  if (!S.plan.units) try { units = (await api('/api/status')).units || 'F'; } catch { /* default */ }
  drawThemeSeg();
  await loadFloors(); await refresh();
  if (!S.plan.floors.length || location.hash === '#guide') guidePanel();
  if (location.hash === '#edit') setMode('edit');
  if (location.hash === '#panel' || (() => { try { return localStorage.getItem('casatorch-3d-panel') === '1'; } catch { return false; } })()) setPanelMode(true);
  if (new URLSearchParams(location.search).has('embed')) document.querySelector('.brand').target = '_top';
  if (!S.plan.pro?.pro) toast('3D Home is part of CasaTorch Pro - look around the demo, then upgrade to use your own home.');
}
for (const b of document.querySelectorAll('#modeSeg button')) b.onclick = () => setMode(b.dataset.mode);
$('#guideBtn').onclick = guidePanel;
start(); setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
/* Real time: the server says the moment something in the house changes, and the plan refreshes within about a second
   (both apps send "tick" on /api/live/events). The 5-second check above stays as the safety net. */
let liveAt = 0, liveT = null;
(function liveStart() {
  if (typeof EventSource !== 'function') return;
  const es = new EventSource('/api/live/events');
  es.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type !== 'tick' && m.type !== 'timeline') return;
    if (document.hidden || (S.mode === 'edit' && $('#left').contains(document.activeElement))) return;
    clearTimeout(liveT); liveT = setTimeout(() => { liveAt = Date.now(); refresh(); }, Math.max(150, 800 - (Date.now() - liveAt)));
  };
  es.onerror = () => { if (es.readyState === 2) { es.onmessage = es.onerror = null; setTimeout(liveStart, 30_000); } };
})();
/* Esc: close the device card, then leave the room, then stop a tool. */
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
  if (card) closeCard(); else if (S.info) closeInfo(); else if (S.room) { S.room = null; layout(true); } else if (S.tool) { S.tool = null; editor(); drawPins(); }
});
