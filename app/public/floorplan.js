/* HouseOS Pro - 3D Home.
   View: your floors as a solid, lit model. Rooms tint, lights glow where they are, devices show
   their state. Tap a room for its controls; switch floors, walls (tall/cut), stacking and look.
   Editor: place devices, name and colour rooms, paint walls/floors/furniture, manage floors. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { openDrawer } from './floorplan-draw.js';
import { toGlb } from './floorplan-import.js';
import { THEMES, COLOR_KEYS, ROOM_COLORS, lookOf, classify, guessCats, itemOf, prettyItem, sectionRooms, makeFx, fxMaterial, MAX_GLOW, MAX_ROOMS } from './floorplan-look.js';

const S = { plan: null, live: null, mode: 'view', floorView: 'all', room: null, tool: null, sel: null, F: {}, pins: [], pinObjs: [], q: '', tab: 'devices' };
const PREF_KEY = 'houseos-3d';
const prefs = { walls: 'tall', stack: 'stacked', names: true, values: false, cameras: true, theme: null, ...(() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } })() };
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* private window */ } };
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); return e; };
const api = async (url, opts = {}) => { const r = await fetch(url, opts); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j }); return j; };
const send = (url, method, body) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const toast = (t) => { const x = el('div', { class: 'toast' }, t); document.body.append(x); setTimeout(() => x.remove(), 3500); };
const proErr = (e) => toast(e.status === 402 ? 'Editing the 3D home is part of HouseOS Pro.' : e.message);
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
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); view.append(renderer.domElement);
const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; view.append(labels.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600); camera.position.set(14, 16, 22);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 2; controls.maxDistance = 150;
const hemi = new THREE.HemisphereLight('#fff', '#000', 1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffffff', 0.6); sun.position.set(12, 30, 18); scene.add(sun);
let grid = new THREE.Group(); scene.add(grid);
const resize = () => { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
let tween = null;
const flyTo = (target, pos, ms = 750) => { tween = { t0: performance.now(), ms, ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: pos }; };
(function loop(now) {
  requestAnimationFrame(loop);
  if (document.getElementById('drawer')) return;   // drawing on top: let the 3D rest
  if (tween) { const k = Math.min(1, (now - tween.t0) / tween.ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; controls.target.lerpVectors(tween.ft, tween.tt, e); camera.position.lerpVectors(tween.fp, tween.tp, e); if (k >= 1) tween = null; }
  controls.update(); renderer.render(scene, camera); labels.render(scene, camera);
})(0);

/* ---------- look ---------- */
const curTheme = () => (THEMES[prefs.theme] ? prefs.theme : S.plan?.style?.theme in THEMES ? S.plan.style.theme : 'neon');
const look = () => lookOf(curTheme(), S.plan?.style?.colors);
function applyLook() {
  const L = look();
  scene.background = new THREE.Color(L.bg); scene.fog = new THREE.Fog(L.bg, 70, 180);
  hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2]; sun.intensity = L.sun;
  const y = grid.position.y; scene.remove(grid); grid = new THREE.GridHelper(140, 140, L.grid[0], L.grid[1]); grid.position.y = y; scene.add(grid);
  for (const F of Object.values(S.F)) styleFloor(F);
  document.documentElement.dataset.theme = curTheme();
  drawPins();
}
function styleFloor(F) {
  if (F.original) return;
  const L = look(), M = F.mats;
  M.wall.color.set(L.wall); M.wall.opacity = L.wallOpacity; M.wall.transparent = L.wallOpacity < 1; M.wall.depthWrite = L.wallOpacity >= 1;
  M.floor.color.set(L.floor); M.floor.userData.tint.value = L.tint; M.furniture.color.set(L.furniture); M.door.color.set(L.door); M.window.color.set(L.window);
  for (const m of Object.values(M)) m.needsUpdate = true;
  F.edgeMat.color.set(L.edge); F.furnEdgeMat.color.set(L.furnEdge); F.doorEdge.color.set(L.door);
  for (const [key, meshes] of F.items) {
    const hex = F.f.paint?.[key];
    for (const m of meshes) {
      const cat = m.userData.cat;
      if (hex) { m.userData.own ||= Object.assign(fxMaterial({}, F.fx, cat === 'floor' ? L.tint : 0), { clippingPlanes: cat === 'floor' || cat === 'furniture' ? [] : [F.clip] }); m.userData.own.color.set(hex); m.material = m.userData.own; }
      else m.material = M[cat] || M.furniture;
    }
  }
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
    const fx = makeFx(), clip = new THREE.Plane(new V3(0, -1, 0), 1e6);
    const F = { f, G, inner, fx, clip, mats: floorMats(fx, clip), items: new Map(), roomLabs: [],
      edgeMat: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, clippingPlanes: [clip] }), furnEdgeMat: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }), doorEdge: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, clippingPlanes: [clip] }) };
    const meshes = []; inner.traverse((o) => { if (o.isMesh && !o.userData.keep) meshes.push(o); });
    for (const m of meshes) { m.userData.cat ||= classify(m); m.userData.floor = f.id; }
    F.original = f.look === 'original' || (f.look !== 'styled' && f.kind !== 'drawn' && !guessCats(meshes, inner));
    if (!F.original) for (const m of meshes) {
      const cat = m.userData.cat || 'furniture', it = itemOf(m), key = it.name || m.name || `mesh${meshes.indexOf(m)}`;
      m.userData.key = key; m.material = F.mats[cat] || F.mats.furniture;
      if (!F.items.has(key)) F.items.set(key, []); F.items.get(key).push(m);
      const em = cat === 'furniture' ? F.furnEdgeMat : cat === 'door' ? F.doorEdge : cat === 'opening' || cat === 'floor' ? null : F.edgeMat;
      if (em && m.geometry.attributes.position.count < 80000) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, cat === 'furniture' ? 40 : 25), em); e.raycast = () => {}; m.add(e); }
    }
    const box = new THREE.Box3().setFromObject(inner); F.minY = box.min.y; F.box = box;
    F.detected = f.kind === 'drawn' ? drawnRooms(f, inner, G) : sectionRooms(inner, (p) => G.worldToLocal(p.clone()));
    F.rooms = Array.isArray(f.rooms) ? f.rooms : F.detected;
    F.label = new CSS2DObject(el('button', { class: 'floorlab', type: 'button', onclick: () => pickFloor(f.id) }));
    F.label.position.set((box.min.x + box.max.x) / 2 - G.position.x, box.max.y + 0.6, box.max.z - G.position.z); G.add(F.label);
    S.F[f.id] = F;
  }
  if (S.plan.floors.length === 1 && S.F[S.plan.floors[0].id]) S.floorView = S.plan.floors[0].id;
  if (S.floorView !== 'all' && !S.F[S.floorView]) S.floorView = 'all';
  applyLook(); buildRoomLabels(); layout(true);
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
    F.G.visible = isCur || (prefs.stack !== 'alone' && lvl < curLevel);
    F.fx.uDim.value = isCur ? 1 : 0.28; F.edgeMat.opacity = isCur ? 0.9 : 0.12; F.furnEdgeMat.opacity = isCur ? 0.35 : 0.05; F.doorEdge.opacity = F.edgeMat.opacity;
    F.G.updateMatrixWorld(true);
    F.clip.constant = prefs.walls === 'cut' ? F.G.position.y + F.minY + 1.15 : 1e6;
    if (F.G.visible) minY = Math.min(minY, F.G.position.y + F.minY);
    roomUniforms(F);
    F.label.visible = multi && !cur && F.G.visible;
    for (const l of F.roomLabs) l.visible = prefs.names && F.G.visible && (cur ? F === cur : !multi);
  }
  grid.position.y = (Number.isFinite(minY) ? minY : 0) - 0.05;
  for (const o of S.pinObjs) { const F = S.F[o.userData.floor]; o.visible = !!F && F.G.visible && (!cur || F === cur) && (prefs.cameras || o.userData.kind !== 'camera'); }
  drawChips(); drawTools(); drawSummary(); drawRoomPanel();
  if (fit) fitView();
}
function roomUniforms(F) {
  const n = Math.min(F.rooms.length, MAX_ROOMS);
  for (let i = 0; i < n; i++) { const r = F.rooms[i], w = F.G.localToWorld(new V3(r.pos[0], 0, r.pos[1])), c = new THREE.Color(r.color || ROOM_COLORS[i % ROOM_COLORS.length]); F.fx.uRoomPos.value[i].set(w.x, w.z); F.fx.uRoomCol.value[i].set(c.r, c.g, c.b); }
  F.fx.uRoomN.value = n; F.fx.uRoomSel.value = S.room?.floor === F.f.id ? S.room.i : -1;
}
function fitView() {
  const cur = curF(), box = new THREE.Box3();
  for (const F of Object.values(S.F)) if (F.G.visible && (!cur || F === cur)) box.expandByObject(F.inner);
  if (box.isEmpty()) return;
  const c = box.getCenter(new V3()), len = Math.max(6, box.getSize(new V3()).length());
  flyTo(c, new V3(c.x + len * 0.5, c.y + len * 0.9, c.z + len * 0.95));
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
  if (d.powerW != null) return { act: d.powerW > 3, val: `${Math.round(d.powerW)} W` };
  if (d.open != null) return { act: !!d.open, val: d.open ? 'Open' : 'Closed' };
  if (d.locked != null) return { act: !d.locked, val: d.locked ? 'Locked' : 'Unlocked' };
  if (d.kind === 'climate' || d.tempC != null) return { act: false, val: d.tempC != null ? temp(d.tempC) : d.state };
  if (d.motion) return { act: true, val: 'Motion' };
  if (['plug', 'switch', 'fan'].includes(d.kind)) return { act: !!d.on, val: d.on ? 'On' : 'Off' };
  return { act: false, val: d.value != null ? `${d.value}${d.unit || ''}` : d.state ?? null };
}
const pinName = (p) => p.label || p.device.name;
function pinsByRoom(F) { const out = F.rooms.map(() => []); for (const p of S.live?.pins || []) if (p.floor === F.f.id) { const i = roomAt(F, p.pos[0], p.pos[2]); if (i >= 0) out[i].push(p); } return out; }
function drawPins() {
  for (const o of S.pinObjs) { o.parent?.remove(o); o.element.remove(); }
  S.pinObjs = [];
  const L = look(), glows = {};
  for (const p of S.live?.pins || []) {
    const F = S.F[p.floor]; if (!F) continue;
    const d = p.device, st = devState(d), sel = S.mode === 'edit' && S.tool?.type === 'device' && S.tool.dev.id === p.deviceId;
    const div = el('button', { type: 'button', class: `pin${st.act ? ' act' : ''}${st.alarm ? ' alarm' : ''}${d.online === false ? ' offline' : ''}${sel ? ' sel' : ''}`, title: `${pinName(p)}${st.val ? ` - ${st.val}` : ''}`, onclick: () => pinClick(p) },
      ic(iconOf(d)), (st.act || prefs.values) && st.val ? el('span', { class: 'val' }, prefs.values && !st.act ? `${pinName(p)} · ${st.val}` : st.val) : null);
    const o = new CSS2DObject(div); o.position.set(...p.pos); o.userData = { floor: p.floor, kind: d.kind }; F.G.add(o); S.pinObjs.push(o);
    const glow = d.kind === 'light' && d.on ? [p.color || '#ffc477', (0.35 + 0.65 * ((d.brightness ?? 100) / 100)) * L.glow] : d.kind === 'media' && d.playing ? ['#c084fc', 0.45 * L.glow] : st.alarm ? ['#ef4444', 0.9 * L.glow] : d.open ? ['#f59e0b', 0.35 * L.glow] : null;
    if (glow) (glows[p.floor] ||= []).push({ p, color: glow[0], k: glow[1] });
  }
  for (const F of Object.values(S.F)) {
    const list = (glows[F.f.id] || []).slice(0, MAX_GLOW);
    list.forEach((g, i) => { const w = F.G.localToWorld(new V3(...g.p.pos)), c = new THREE.Color(g.color); F.fx.uGlowPos.value[i].copy(w); F.fx.uGlowCol.value[i].set(c.r * g.k, c.g * g.k, c.b * g.k); F.fx.uGlowRoom.value[i] = roomAt(F, g.p.pos[0], g.p.pos[2]); });
    F.fx.uGlowN.value = list.length;
    const by = pinsByRoom(F);
    F.roomLabs.forEach((l, i) => { const on = by[i].filter((p) => p.device.kind === 'light' && p.device.on).length, t = by[i].find((p) => p.device.tempC != null); l.element.querySelector('small').textContent = [t ? temp(t.device.tempC) : '', on ? `${on} on` : ''].filter(Boolean).join(' · '); });
    const lightsOn = (S.live?.pins || []).filter((p) => p.floor === F.f.id && p.device.kind === 'light' && p.device.on).length;
    fill(F.label.element, el('b', {}, F.f.name), el('small', {}, `${F.rooms.length} rooms · ${lightsOn} lights on`));
  }
  layout(false);
}
async function act(d, action, value) {
  try { await send(`/api/devices/${encodeURIComponent(d.id)}/${action}`, 'POST', value != null ? { value } : {}); setTimeout(refresh, 700); }
  catch (e) { toast(e.message); }
}
function pinClick(p) {
  const d = p.device;
  if (S.mode === 'edit') { S.tab = 'devices'; S.tool = { type: 'device', dev: { id: d.id, name: pinName(p) } }; editor(); drawPins(); return; }
  if (d.kind === 'camera') return cameraModal(d);
  if (['light', 'plug', 'switch', 'media', 'fan'].includes(d.kind)) return act(d, 'toggle');
  const F = S.F[p.floor], i = F ? roomAt(F, p.pos[0], p.pos[2]) : -1; if (i >= 0) focusRoom(p.floor, i);
}
const snapUrl = (d) => d.snapshot || `/api/cameras/${encodeURIComponent(d.id.split(':').slice(1).join(':'))}/snapshot`;
function cameraModal(d) { modal(el('div', { class: 'box' }, el('h2', {}, d.name), el('img', { src: `${snapUrl(d)}?t=${Date.now()}`, alt: d.name }))); }
function modal(content) { const m = $('#modal'); m.replaceChildren(content); m.hidden = false; m.onclick = (e) => { if (e.target === m) m.hidden = true; }; }

/* ---------- view UI: floor/room chips, toggles, floor summary, room panel ---------- */
function drawChips() {
  const cur = curF(), multi = Object.keys(S.F).length > 1, chip = (txt, on, fn, color) => el('button', { type: 'button', class: `chip${on ? ' on' : ''}`, onclick: fn, style: color ? `--rc:${color}` : null }, color ? el('i', { class: 'swatch' }) : null, txt);
  const rooms = (F) => F.rooms.map((r, i) => chip(r.name, S.room?.floor === F.f.id && S.room.i === i, () => focusRoom(F.f.id, i), r.color));
  fill($('#chips'), 
    ...(multi ? [chip('All floors', !cur, () => pickFloor('all')), ...Object.values(S.F).sort((a, b) => b.f.level - a.f.level).map((F) => chip(F.f.name, cur === F, () => pickFloor(F.f.id)))] : []),
    ...(multi ? [el('span', { class: 'sep' })] : []),
    ...(cur ? rooms(cur) : multi ? Object.values(S.F).flatMap((F) => (F.rooms.length ? [el('span', { class: 'chiphead' }, F.f.name), ...rooms(F)] : [])) : []));
  $('#chips').hidden = !$('#chips').children.length;
}
function seg(options, value, onpick) { return el('div', { class: 'seg' }, ...options.map(([v, label]) => el('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => onpick(v) }, label))); }
const toggle = (label, key) => el('button', { type: 'button', class: `tog${prefs[key] ? ' on' : ''}`, onclick: () => { prefs[key] = !prefs[key]; savePrefs(); drawPins(); } }, label);
function drawTools() {
  const t = $('#tools'); t.hidden = S.mode !== 'view' || !Object.keys(S.F).length;
  const set = (k) => (v) => { prefs[k] = v; savePrefs(); layout(k === 'stack'); };
  fill(t, 
    seg([['tall', 'Tall walls'], ['cut', 'Cut']], prefs.walls, set('walls')),
    Object.keys(S.F).length > 1 ? seg([['stacked', 'Stacked'], ['apart', 'Apart'], ['alone', 'Alone']], prefs.stack, set('stack')) : null,
    toggle('Room names', 'names'), toggle('Values', 'values'), toggle('Cameras', 'cameras'),
    el('button', { type: 'button', class: 'tog', onclick: () => { S.room = null; layout(true); } }, 'Reset view'),
    S.room ? el('button', { type: 'button', class: 'tog on', onclick: () => { S.room = null; layout(true); } }, ic('back'), 'Back') : null);
}
const lightsIn = (pins) => pins.filter((p) => p.device.kind === 'light');
async function allLights(pins, on) { await Promise.all(lightsIn(pins).filter((p) => !!p.device.on !== on).map((p) => send(`/api/devices/${encodeURIComponent(p.device.id)}/${on ? 'on' : 'off'}`, 'POST', {}).catch(() => {}))); setTimeout(refresh, 700); }
function drawSummary() {
  const box = $('#left');
  if (S.mode !== 'view' || !Object.keys(S.F).length || !S.live) { if (S.mode === 'view') box.hidden = true; return; }
  const cur = curF(), Fs = cur ? [cur] : Object.values(S.F), pins = (S.live.pins || []).filter((p) => Fs.some((F) => F.f.id === p.floor));
  const lights = lightsIn(pins), on = lights.filter((p) => p.device.on).length, open = pins.filter((p) => p.device.open), wet = pins.filter((p) => p.device.water || p.device.smoke);
  box.hidden = false;
  fill(box, el('div', { class: 'eyebrow' }, cur ? cur.f.name : Object.keys(S.F).length > 1 ? 'Whole home' : 'Home'),
    lights.length ? el('div', { class: 'srow' }, el('span', {}, 'Lights ', el('b', {}, `${on}/${lights.length}`)), el('button', { type: 'button', class: 'mini', onclick: () => allLights(pins, true) }, 'On'), el('button', { type: 'button', class: 'mini', onclick: () => allLights(pins, false) }, 'Off')) : null,
    ...wet.map((p) => el('div', { class: 'srow bad' }, ic('drop'), `${pinName(p)}: ${devState(p.device).val}`)),
    ...open.map((p) => el('div', { class: 'srow warn' }, ic('door'), `${pinName(p)} is open`)),
    ...Fs.flatMap((F) => { const by = pinsByRoom(F); return F.rooms.map((r, i) => { const n = by[i].filter((p) => p.device.kind === 'light' && p.device.on).length; return el('button', { type: 'button', class: 'sroom', onclick: () => focusRoom(F.f.id, i) }, el('i', { class: 'swatch', style: `--rc:${r.color}` }), r.name, el('small', {}, n ? `${n} on` : '')); }); }),
    !Fs.some((F) => F.rooms.length) ? el('p', { class: 'note' }, 'No rooms yet. Open Editor > Rooms to add them.') : null);
}
function drawRoomPanel() {
  const side = $('#side');
  if (S.mode !== 'view') return;
  if (!S.room) { if (side.dataset.kind === 'room') { side.hidden = true; side.dataset.kind = ''; } return; }
  if (side.contains(document.activeElement) && document.activeElement.type === 'range') return;   // don't redraw under a dragging slider
  const F = S.F[S.room.floor], r = F?.rooms[S.room.i]; if (!r) return;
  const pins = pinsByRoom(F)[S.room.i] || [], kinds = (k) => pins.filter((p) => k(p.device));
  const t = pins.find((p) => p.device.tempC != null);
  const sw = (d) => el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: d.on || d.playing ? true : null, onchange: () => act(d, 'toggle') }), el('span'));
  const row = (p, extra) => { const d = p.device, st = devState(d); return el('div', { class: `drow${st.act ? ' act' : ''}` }, el('div', { class: 'dtop' }, ic(iconOf(d)), el('span', { class: 'dn' }, pinName(p)), el('small', {}, st.val ?? ''), extra), ...(p.more || [])); };
  const lights = kinds((d) => d.kind === 'light'), ctl = kinds((d) => ['plug', 'switch', 'fan', 'media'].includes(d.kind)), cams = kinds((d) => d.kind === 'camera');
  const other = pins.filter((p) => !lights.includes(p) && !ctl.includes(p) && !cams.includes(p));
  side.hidden = false; side.dataset.kind = 'room';
  fill(side, 
    el('div', { class: 'rhead' }, el('i', { class: 'swatch big', style: `--rc:${r.color}` }), el('div', {}, el('h2', {}, r.name), el('small', {}, [t ? temp(t.device.tempC) : '', F.f.name].filter(Boolean).join(' · '))), el('button', { type: 'button', class: 'iconbtn', title: 'Close', onclick: () => { S.room = null; layout(true); } }, ic('close'))),
    lights.length ? el('div', { class: 'sechead' }, 'Lights', el('button', { type: 'button', class: 'mini', onclick: () => allLights(lights, false) }, 'All off')) : null,
    ...lights.map((p) => { const d = p.device, x = row(p, sw(d)); if (d.brightness != null || d.on) x.append(el('input', { type: 'range', min: 1, max: 100, value: d.brightness ?? 100, class: 'bri', 'aria-label': 'Brightness', onchange: (e) => act(d, 'brightness', Number(e.target.value)) })); return x; }),
    ctl.length ? el('div', { class: 'sechead' }, 'Devices') : null, ...ctl.map((p) => row(p, sw(p.device))),
    other.length ? el('div', { class: 'sechead' }, 'Sensors') : null, ...other.map((p) => row(p)),
    cams.length ? el('div', { class: 'sechead' }, 'Cameras') : null, ...cams.map((p) => el('button', { type: 'button', class: 'camthumb', onclick: () => cameraModal(p.device) }, el('img', { src: `${snapUrl(p.device)}?t=${Math.floor(Date.now() / 30000)}`, alt: pinName(p), loading: 'lazy' }), el('span', {}, pinName(p)))),
    !pins.length ? el('p', { class: 'note' }, 'Nothing placed in this room yet. Open ', el('b', {}, 'Editor > Devices'), ' and click where each device is.') : null);
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
  const hit = ray.intersectObjects(targets, true).find((h) => h.object.isMesh && h.object.material?.opacity !== 0 && !isClipped(h));
  if (S.mode === 'view') {
    if (!hit) { if (S.room) { S.room = null; layout(true); } return; }
    const F = S.F[hit.object.userData.floor], l = F.G.worldToLocal(hit.point.clone()), i = roomAt(F, l.x, l.z);
    if (i >= 0) focusRoom(F.f.id, i); else if (!cur) pickFloor(F.f.id);
    return;
  }
  if (!S.tool) return;
  if (!hit) { toast('Click on the model.'); return; }
  const F = S.F[hit.object.userData.floor];
  if (S.tool.type === 'device') {
    const local = F.G.worldToLocal(hit.point.clone().add(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).multiplyScalar(0.15)));
    const old = S.pins.find((p) => p.deviceId === S.tool.dev.id);
    S.pins = S.pins.filter((p) => p.deviceId !== S.tool.dev.id).concat({ ...(old || {}), deviceId: S.tool.dev.id, floor: F.f.id, pos: [local.x, local.y, local.z] });
    S.tool = null; savePins();
  } else if (S.tool.type === 'room') {
    const l = F.G.worldToLocal(hit.point.clone()), rooms = F.rooms.map((x) => ({ ...x }));
    if (S.tool.i >= 0 && S.tool.floor === F.f.id) rooms[S.tool.i].pos = [+l.x.toFixed(2), +l.z.toFixed(2)];
    else rooms.push({ name: `Room ${rooms.length + 1}`, color: ROOM_COLORS[rooms.length % ROOM_COLORS.length], pos: [+l.x.toFixed(2), +l.z.toFixed(2)] });
    S.focusName = S.tool.i >= 0 && S.tool.floor === F.f.id ? S.tool.i : rooms.length - 1; S.tool = null; saveRooms(F, rooms);
  } else if (S.tool.type === 'paint') {
    if (F.original) { toast('This floor uses the scan\'s own colours. Switch it to "Styled" under Floors to paint it.'); return; }
    S.sel = { floor: F.f.id, key: hit.object.userData.key }; showSel(); editor();
  }
});
const isClipped = (h) => prefs.walls === 'cut' && ['wall', 'door', 'window', 'opening'].includes(h.object.userData.cat) && h.point.y > S.F[h.object.userData.floor].clip.constant;
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
  try { await send('/api/floorplan/pins', 'PUT', { pins: S.pins.map(({ deviceId, floor, pos, label, color }) => ({ deviceId, floor, pos, label, color })) }); await refresh(); editor(); }
  catch (e) { proErr(e); }
}
const savePinsSoon = debounce(savePins, 500);
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
async function saveStyle() {
  try { await send('/api/floorplan/style', 'PUT', S.plan.style); }
  catch (e) { proErr(e); }
}
const saveStyleSoon = debounce(saveStyle, 500);

/* ---------- editor ---------- */
function setMode(m) {
  if (m === 'edit' && !S.plan.pro?.pro) { toast('The editor is part of HouseOS Pro.'); return; }
  S.mode = m; S.tool = null; clearSel(); S.room = null;
  document.body.classList.toggle('editing', m === 'edit');
  $('#side').hidden = true; $('#side').dataset.kind = '';
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === m);
  if (m === 'edit') editor(); else $('#left').hidden = true;
  drawPins();
}
const edFloor = () => curF() || Object.values(S.F)[0];
function editor() {
  if (S.mode !== 'edit') return;
  const box = $('#left'); box.hidden = false;
  const tabs = [['devices', 'Devices'], ['rooms', 'Rooms'], ['colors', 'Colours'], ['floors', 'Floors']];
  const body = { devices: edDevices, rooms: edRooms, colors: edColors, floors: edFloors }[S.tab]();
  const hint = S.tool?.type === 'device' ? `Click on the model where "${S.tool.dev.name}" is.` : S.tool?.type === 'room' ? 'Click the middle of the room on the model.' : S.tool?.type === 'paint' ? 'Click any wall, floor, door or piece of furniture.' : null;
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
      d.kind === 'light' ? el('input', { type: 'color', value: p.color || '#ffc477', title: 'Glow colour', oninput: (e) => { p.color = e.target.value; savePinsSoon(); } }) : null),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => pick(d) }, 'Move'), el('button', { type: 'button', class: 'mini', onclick: () => { S.pins = S.pins.filter((x) => x.deviceId !== d.id); savePins(); } }, 'Remove'), el('small', {}, S.F[p.floor]?.f.name || ''))); };
  const free = devs.filter((d) => !placed.has(d.id)), on = devs.filter((d) => placed.has(d.id));
  return el('div', {}, el('p', { class: 'note' }, 'Pick a device, then click where it really is. Lights glow on the plan when they are on.'), search,
    el('h3', {}, `On the plan (${on.length})`), ...on.map(placedRow),
    el('h3', {}, `Not placed (${free.length})`), ...free.map((d) => el('button', { type: 'button', class: `edrow pick${S.tool?.dev?.id === d.id ? ' sel' : ''}`, onclick: () => pick(d) }, ic(iconOf(d)), d.name, el('small', {}, d.provider))));
}
function edRooms() {
  const F = edFloor(); if (!F) return el('p', { class: 'note' }, 'Add a floor first (Floors tab).');
  const rooms = F.rooms.map((r) => ({ ...r }));
  const save = () => saveRoomsSoon(F, rooms);
  const list = rooms.map((r, i) => el('div', { class: 'edrow' }, el('div', { class: 'dtop' },
    el('input', { type: 'color', value: r.color || ROOM_COLORS[i % ROOM_COLORS.length], title: 'Room colour', oninput: (e) => { r.color = e.target.value; F.rooms = rooms; roomUniforms(F); save(); } }),
    el('input', { type: 'text', value: r.name, maxlength: 30, 'data-room': i, oninput: (e) => { r.name = e.target.value; save(); } })),
  el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', onclick: () => { S.tool = { type: 'room', i, floor: F.f.id }; editor(); } }, 'Move'), el('button', { type: 'button', class: 'mini', onclick: () => focusRoomEdit(F, i) }, 'Show'), el('button', { type: 'button', class: 'mini', onclick: () => { rooms.splice(i, 1); saveRooms(F, rooms); } }, 'Delete'))));
  if (S.focusName != null) setTimeout(() => { const n = $(`#left input[data-room="${S.focusName}"]`); n?.focus(); n?.select(); S.focusName = null; }, 0);
  return el('div', {}, floorPicker(), el('p', { class: 'note' }, 'Rooms colour the floor, group devices, and show up as buttons in the 3D view. Devices belong to the nearest room centre.'),
    ...list, el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', onclick: () => { S.tool = { type: 'room', i: -1, floor: F.f.id }; editor(); } }, 'Add a room'),
      F.detected.length ? el('button', { type: 'button', onclick: () => { if (confirm('Replace these rooms with the ones found in the scan?')) saveRooms(F, F.detected); } }, 'Use rooms from scan') : null));
}
function focusRoomEdit(F, i) { const r = F.rooms[i], w = F.G.localToWorld(new V3(r.pos[0], F.minY, r.pos[1])); flyTo(w, w.clone().add(new V3(3, 7, 5))); }
function edColors() {
  const theme = curTheme(), style = (S.plan.style ||= { theme: 'neon', colors: {} }), L = look();
  style.colors ||= {};
  const F = S.sel && S.F[S.sel.floor], selName = S.sel ? prettyItem(S.sel.key) : null;
  return el('div', {},
    el('h3', {}, 'Look'), seg(Object.entries(THEMES).map(([k, t]) => [k, t.label]), theme, (v) => { prefs.theme = v; savePrefs(); style.theme = v; saveStyleSoon(); applyLook(); editor(); }),
    el('p', { class: 'note' }, 'Everyone sees this look unless they pick another one at the top of the 3D view.'),
    el('h3', {}, `${THEMES[theme].label} colours`),
    ...COLOR_KEYS.map(([k, label]) => el('div', { class: 'row' }, el('label', {}, label), el('input', { type: 'color', value: L[k], oninput: (e) => { (style.colors[theme] ||= {})[k] = e.target.value; applyLook(); saveStyleSoon(); } }))),
    el('button', { type: 'button', class: 'mini', onclick: () => { delete style.colors[theme]; applyLook(); saveStyleSoon(); editor(); } }, 'Reset to defaults'),
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
        f.kind !== 'drawn' ? el('div', { class: 'row' }, el('label', {}, 'Colours'), el('select', { onchange: (e) => put(f, { look: e.target.value }) }, ...[['auto', 'Automatic'], ['styled', 'Styled (theme)'], ['original', 'Scan\'s own colours']].map(([v, t]) => el('option', { value: v, selected: (f.look || 'auto') === v ? true : null }, t)))) : null,
        F?.original && f.look !== 'original' ? el('p', { class: 'note' }, 'This scan has no named walls or furniture, so it shows in its own colours.') : null,
        el('div', { class: 'row' }, f.kind === 'drawn' ? el('button', { type: 'button', class: 'primary', onclick: () => openDrawer(f, drawOpts()) }, 'Edit drawing') : null,
          el('button', { type: 'button', onclick: async () => { if (!confirm(`Remove ${f.name}?`)) return; await api(`/api/floorplan/floors/${f.id}`, { method: 'DELETE' }).catch(proErr); await reload(); } }, 'Remove floor'))); }),
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
      el('li', {}, 'Open ', el('b', {}, 'Editor > Floors'), ' and upload it. Walls, furniture and rooms are recognised automatically.')),
    el('h3', {}, 'B. Draw it (any device)'),
    el('ol', { class: 'guide' }, el('li', {}, el('b', {}, 'Editor > Floors > Draw a floor'), '. Drag to draw each room (grid squares are 1 m), or trace over a picture of your floor plan.')),
    el('h3', {}, 'Then make it yours'),
    el('ol', { class: 'guide' }, el('li', {}, el('b', {}, 'Devices'), ': pick one, click where it is.'), el('li', {}, el('b', {}, 'Rooms'), ': rename and colour them, or add your own.'), el('li', {}, el('b', {}, 'Colours'), ': choose Neon, Blueprint or Day, change any colour, or paint a single wall or sofa.')),
    S.plan.pro?.pro ? el('p', {}, el('button', { type: 'button', class: 'primary', onclick: () => { setMode('edit'); S.tab = 'floors'; editor(); } }, 'Open the editor')) : el('p', { class: 'note' }, 'The editor is part of HouseOS Pro.'));
}

/* ---------- live data ---------- */
function drawTotals() {
  const t = S.live?.totals || {};
  fill($('#totals'), el('span', { class: 'stat' }, el('small', {}, 'Power'), `${t.powerW ?? 0} W`), el('span', { class: 'stat warm' }, el('small', {}, 'Lights'), `${t.lightsOn ?? 0} on`),
    ...(t.playing || []).slice(0, 1).map((p) => el('span', { class: 'stat music' }, el('small', {}, 'Playing'), p.title || p.name)),
    ...(t.openDoors ? [el('span', { class: 'stat bad' }, el('small', {}, 'Open'), `${t.openDoors}`)] : []), ...(t.leaks ? [el('span', { class: 'stat bad' }, el('small', {}, 'Leak'), '!')] : []));
}
async function refresh() {
  try { S.live = await api('/api/floorplan/live'); S.pins = (S.live.pins || []).map(({ deviceId, floor, pos, label, color }) => ({ deviceId, floor, pos, label, color })); drawPins(); drawTotals(); if (S.mode === 'edit' && S.tab === 'devices' && !$('#left').contains(document.activeElement)) editor(); }
  catch { /* next time */ }
}
function drawThemeSeg() { $('#themeSeg').replaceChildren(seg(Object.entries(THEMES).map(([k, t]) => [k, t.label]), curTheme(), (v) => { prefs.theme = v; savePrefs(); applyLook(); drawThemeSeg(); if (S.mode === 'edit') editor(); })); }
async function reload() { S.plan = await api('/api/floorplan'); await loadFloors(); await refresh(); drawThemeSeg(); if (S.mode === 'edit') editor(); }
async function start() {
  S.plan = await api('/api/floorplan');
  try { units = (await api('/api/status')).units || 'F'; } catch { /* default */ }
  drawThemeSeg();
  await loadFloors(); await refresh();
  if (!S.plan.floors.length || location.hash === '#guide') guidePanel();
  if (location.hash === '#edit') setMode('edit');
  if (new URLSearchParams(location.search).has('embed')) document.querySelector('.brand').target = '_top';
  if (!S.plan.pro?.pro) toast('3D Home is part of HouseOS Pro - look around the demo, then upgrade to use your own home.');
}
for (const b of document.querySelectorAll('#modeSeg button')) b.onclick = () => setMode(b.dataset.mode);
$('#guideBtn').onclick = guidePanel;
start(); setInterval(refresh, 5000);
