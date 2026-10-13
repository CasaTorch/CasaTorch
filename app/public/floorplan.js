/* HouseOS Pro - 3D Home. Your LiDAR-scanned floors with your devices on them,
   live: lights glow when on, speakers pulse while playing, plugs show watts,
   leaks and open doors flash. Click a pin to switch it; "Place devices" to put
   a device where it really is. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const S = { plan: null, live: null, floorView: 'all', edit: false, pick: null, pins: [], groups: {}, pinObjs: [], lights: {} };
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); return e; };
const api = async (url, opts = {}) => { const r = await fetch(url, opts); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j }); return j; };
const toast = (t) => { const x = el('div', { class: 'toast' }, t); document.body.append(x); setTimeout(() => x.remove(), 3500); };

/* ---------- the scene: dark, neon edges, see-through walls ---------- */
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); view.append(renderer.domElement);
const labels = new CSS2DRenderer(); labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none'; view.append(labels.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#05070d'); scene.fog = new THREE.Fog('#05070d', 40, 120);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500); camera.position.set(14, 16, 22);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight('#9ec5ff', '#0b1220', 0.55)); const sun = new THREE.DirectionalLight('#ffffff', 0.5); sun.position.set(10, 30, 10); scene.add(sun);
const grid = new THREE.GridHelper(80, 80, '#12304a', '#0b1a2b'); grid.position.y = -0.02; scene.add(grid);
const resize = () => { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); labels.render(scene, camera); })();

const wallMat = new THREE.MeshStandardMaterial({ color: '#1e293b', transparent: true, opacity: 0.38, roughness: 0.9, side: THREE.DoubleSide, depthWrite: false });
const edgeMat = new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.85 });
const loader = new GLTFLoader();
async function loadFloors() {
  for (const g of Object.values(S.groups)) scene.remove(g);
  S.groups = {};
  const box = new THREE.Box3();
  for (const f of S.plan.floors) {
    const gltf = await new Promise((ok, bad) => loader.load(`/api/floorplan/floors/${f.id}/model`, ok, undefined, bad)).catch(() => null);
    if (!gltf) { toast(`Could not load ${f.name}`); continue; }
    const g = new THREE.Group(); g.userData.floor = f.id;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = wallMat; o.userData.floor = f.id;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), edgeMat); edges.raycast = () => {}; o.add(edges);
    });
    gltf.scene.scale.setScalar(f.scale || 1); gltf.scene.rotation.y = THREE.MathUtils.degToRad(f.rotationY || 0);
    g.add(gltf.scene); g.position.set(f.offset?.[0] || 0, (f.level || 0) * (f.heightM || 3), f.offset?.[1] || 0);
    scene.add(g); S.groups[f.id] = g; box.expandByObject(g);
  }
  if (!box.isEmpty()) { const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length(); controls.target.copy(c); camera.position.set(c.x + sz * 0.6, c.y + sz * 0.7, c.z + sz * 0.9); }
  showFloors();
}
function showFloors() {
  for (const [id, g] of Object.entries(S.groups)) {
    const f = S.plan.floors.find((x) => x.id === id), on = S.floorView === 'all' || S.floorView === id, above = S.floorView !== 'all' && f.level > (S.plan.floors.find((x) => x.id === S.floorView)?.level ?? 0);
    g.visible = !above; g.traverse((o) => { if (o.isMesh) o.material = on ? wallMat : ghostMat; if (o.isLineSegments) o.visible = on; });
  }
  for (const o of S.pinObjs) o.visible = S.floorView === 'all' || o.userData.floor === S.floorView;
  $('#floors').replaceChildren(...[['all', 'All floors'], ...S.plan.floors.map((f) => [f.id, f.name])].map(([id, n]) => el('button', { type: 'button', class: S.floorView === id ? 'on' : '', onclick: () => { S.floorView = id; showFloors(); } }, n)));
}
const ghostMat = new THREE.MeshStandardMaterial({ color: '#1e293b', transparent: true, opacity: 0.08, depthWrite: false });

/* ---------- pins: devices where they are, showing what they're doing ---------- */
const ICON = { light: '💡', plug: '🔌', switch: '🔌', media: '🎵', sensor: '📟', camera: '📷', climate: '🌡️', lock: '🔒' };
function pinState(d) {
  const cls = ['pin']; let lab = d.name;
  if (d.online === false) cls.push('offline');
  if (d.water || d.smoke) { cls.push('alarm'); lab = `${d.name}: ${d.water ? 'WATER' : 'SMOKE'}`; }
  else if (d.kind === 'light') { cls.push(d.on ? 'on' : 'off'); if (d.on && d.brightness != null) lab += ` ${d.brightness}%`; }
  else if (d.kind === 'media') { if (d.playing) { cls.push('playing'); lab = d.title ? `♪ ${d.title}` : `${d.name} playing`; } }
  else if (d.powerW != null) { cls.push(d.on === false ? 'off' : ''); lab = `${d.name} · ${Math.round(d.powerW)} W`; }
  else if (d.open != null) { if (d.open) cls.push('alarm'); lab = `${d.name}: ${d.open ? 'open' : 'closed'}`; }
  else if (d.tempC != null) lab = `${d.name} · ${units === 'C' ? Math.round(d.tempC) : Math.round(d.tempC * 9 / 5 + 32)}°`;
  return { cls: cls.filter(Boolean).join(' '), lab, icon: ICON[d.kind] || '•' };
}
let units = 'F';
function drawPins() {
  for (const o of S.pinObjs) { o.parent?.remove(o); o.element.remove(); }
  for (const l of Object.values(S.lights)) scene.remove(l);
  S.pinObjs = []; S.lights = {};
  for (const p of S.live?.pins || []) {
    const g = S.groups[p.floor]; if (!g) continue;
    const st = pinState(p.device);
    const div = el('div', { class: st.cls, title: p.device.name, onclick: () => pinClick(p) }, el('div', { class: 'dot' }, st.icon), el('div', { class: 'lab' }, st.lab));
    const o = new CSS2DObject(div); o.position.set(...p.pos); o.userData.floor = p.floor; g.add(o); S.pinObjs.push(o);
    if (p.device.kind === 'light' && p.device.on) { const l = new THREE.PointLight('#ffd27a', 1.2 * ((p.device.brightness ?? 100) / 100), 6, 1.6); l.position.set(...p.pos); g.add(l); S.lights[p.deviceId] = l; }
  }
  showFloors();
}
async function pinClick(p) {
  if (S.edit) { if (confirm(`Remove ${p.device.name} from the plan?`)) { S.pins = S.pins.filter((x) => x !== p && x.deviceId !== p.deviceId); await savePins(); } return; }
  const d = p.device;
  if (d.kind === 'camera') { const src = d.snapshot || `/api/cameras/${encodeURIComponent(d.id.split(':')[1])}/snapshot`; modal(el('div', { class: 'box' }, el('h2', {}, d.name), el('img', { src: `${src}?t=${Date.now()}`, alt: d.name }))); return; }
  const action = d.kind === 'media' ? 'toggle' : ['light', 'plug', 'switch'].includes(d.kind) ? 'toggle' : null;
  if (!action) return;
  try { await api(`/api/devices/${encodeURIComponent(d.id)}/${action}`, { method: 'POST' }); setTimeout(refresh, 600); } catch (e) { toast(e.message); }
}
function modal(content) { const m = $('#modal'); m.replaceChildren(content); m.hidden = false; m.onclick = (e) => { if (e.target === m) m.hidden = true; }; }

/* ---------- placing devices: pick one, click where it is ---------- */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
renderer.domElement.addEventListener('click', (e) => {
  if (!S.edit || !S.pick) return;
  const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const targets = Object.values(S.groups).filter((g) => g.visible);
  const hit = ray.intersectObjects(targets, true).find((h) => h.object.isMesh && (S.floorView === 'all' || h.object.userData.floor === S.floorView));
  if (!hit) { toast('Click on the model where the device is.'); return; }
  const floor = hit.object.userData.floor, g = S.groups[floor];
  const local = g.worldToLocal(hit.point.clone().add(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).multiplyScalar(0.15)));
  S.pins = S.pins.filter((p) => p.deviceId !== S.pick.id);
  S.pins.push({ deviceId: S.pick.id, floor, pos: [local.x, local.y, local.z] });
  S.pick = null; savePins();
});
async function savePins() {
  try { await api('/api/floorplan/pins', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pins: S.pins.map(({ deviceId, floor, pos, label }) => ({ deviceId, floor, pos, label })) }) }); await refresh(); editPanel(); }
  catch (e) { toast(e.status === 402 ? 'Placing devices is part of HouseOS Pro.' : e.message); }
}
function editPanel() {
  const side = $('#side'); side.hidden = false;
  const placed = new Set(S.pins.map((p) => p.deviceId));
  const devs = (S.live?.devices || []).slice().sort((a, b) => Number(placed.has(a.id)) - Number(placed.has(b.id)) || a.name.localeCompare(b.name));
  side.replaceChildren(el('h2', {}, 'Place devices'), el('p', { class: 'note' }, S.pick ? `Now click on the model where "${S.pick.name}" is.` : 'Pick a device, then click on the model where it is. Click a placed pin to remove it.'),
    el('h3', {}, `Not placed (${devs.filter((d) => !placed.has(d.id)).length})`), ...devs.filter((d) => !placed.has(d.id)).map(row),
    el('h3', {}, `On the plan (${placed.size})`), ...devs.filter((d) => placed.has(d.id)).map(row),
    el('p', {}, el('button', { type: 'button', class: 'primary', onclick: () => { S.edit = false; S.pick = null; $('#editBtn').classList.remove('on'); side.hidden = true; } }, 'Done')));
  function row(d) { return el('div', { class: `dev${S.pick?.id === d.id ? ' sel' : ''}`, onclick: () => { S.pick = d; editPanel(); } }, ICON[d.kind] || '•', d.name, el('small', {}, d.provider)); }
}

/* ---------- floors: upload scans, stack them ---------- */
function floorsPanel() {
  const side = $('#side'); side.hidden = false;
  const file = el('input', { type: 'file', accept: '.glb,model/gltf-binary' }), name = el('input', { type: 'text', placeholder: 'Ground floor' });
  side.replaceChildren(el('h2', {}, 'Floors'),
    ...S.plan.floors.map((f) => { const box = el('div', { class: 'card' }); const n = (k, label, step) => el('div', { class: 'row' }, el('label', {}, label), el('input', { type: 'number', step, value: k === 'offsetX' ? f.offset[0] : k === 'offsetZ' ? f.offset[1] : f[k], onchange: async (e) => { const v = Number(e.target.value); const body = k === 'offsetX' ? { offset: [v, f.offset[1]] } : k === 'offsetZ' ? { offset: [f.offset[0], v] } : { [k]: v }; try { await api(`/api/floorplan/floors/${f.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await start(); floorsPanel(); } catch (er) { toast(er.message); } } }));
      box.append(el('h3', {}, f.name), n('level', 'Level', 1), n('heightM', 'Height (m)', 0.1), n('rotationY', 'Turn (°)', 5), n('scale', 'Scale', 0.01), n('offsetX', 'Shift X (m)', 0.1), n('offsetZ', 'Shift Z (m)', 0.1),
        el('button', { type: 'button', onclick: async () => { if (!confirm(`Remove ${f.name}?`)) return; await api(`/api/floorplan/floors/${f.id}`, { method: 'DELETE' }); await start(); floorsPanel(); } }, 'Remove floor')); return box; }),
    el('h3', {}, 'Add a floor'), el('div', { class: 'row' }, el('label', {}, 'Name'), name), file,
    el('p', {}, el('button', { type: 'button', class: 'primary', onclick: async () => {
      const f = file.files[0]; if (!f) { toast('Choose the .glb file from your scan first.'); return; }
      toast('Uploading…');
      try { await api(`/api/floorplan/floors?name=${encodeURIComponent(name.value || f.name.replace(/\.glb$/i, ''))}`, { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: f }); await start(); floorsPanel(); toast('Floor added.'); }
      catch (e) { toast(e.status === 402 ? 'Adding floors is part of HouseOS Pro.' : e.message); }
    } }, 'Upload')),
    el('p', { class: 'note' }, 'Floors stack by Level × Height. If a floor sits crooked or off to the side, adjust Turn and Shift until the walls line up.'));
}
function guidePanel() {
  const side = $('#side'); side.hidden = false;
  side.replaceChildren(el('h2', {}, 'Scan your home in 3D'),
    el('p', { class: 'note' }, 'You need an iPhone Pro or iPad Pro (they have a LiDAR sensor, the small dark circle by the cameras). About 10 minutes per floor.'),
    el('ol', { class: 'guide' },
      el('li', {}, 'Install a free scanning app: ', el('b', {}, 'Polycam'), ', ', el('b', {}, 'Scaniverse'), ' or ', el('b', {}, '3D Scanner App'), '. In Polycam choose "Room" mode (Apple RoomPlan) for clean walls.'),
      el('li', {}, 'Turn on the lights and open interior doors. Start in a corner and walk slowly through every room on one floor, pointing at the walls and floor. Keep the phone about chest high.'),
      el('li', {}, 'Scan one floor at a time. Finish where you started if the app asks.'),
      el('li', {}, 'Export the scan as ', el('b', {}, 'GLB'), ' (Polycam: Export > GLB; Scaniverse: Share > Export Model > GLB; 3D Scanner App: Share > GLB). Send it to the computer you use for HouseOS (AirDrop, e-mail, or iCloud Drive).'),
      el('li', {}, 'Here, open ', el('b', {}, 'Floors'), ' > Add a floor, name it ("Ground floor") and upload the file. Repeat for each floor and set its Level (0 = ground).'),
      el('li', {}, 'Open ', el('b', {}, 'Place devices'), ': pick a light, speaker or sensor, then click where it is on the model. Done - the plan now shows them live.')),
    el('p', { class: 'note' }, 'Tips: slow and steady scans line up best; mirrors and big windows can confuse the scanner - scan past them quickly. Your scan stays on your HouseOS box; it is never uploaded anywhere else.'));
}

/* ---------- live data ---------- */
function drawTotals() {
  const t = S.live?.totals || {};
  $('#totals').replaceChildren(el('span', { class: 'chip' }, `⚡ ${t.powerW ?? 0} W`), el('span', { class: 'chip warm' }, `💡 ${t.lightsOn ?? 0} on`),
    ...(t.playing || []).slice(0, 2).map((p) => el('span', { class: 'chip music' }, `🎵 ${p.title || p.name}`)),
    ...(t.openDoors ? [el('span', { class: 'chip bad' }, `🚪 ${t.openDoors} open`)] : []), ...(t.leaks ? [el('span', { class: 'chip bad' }, '💧 leak')] : []));
}
async function refresh() { try { S.live = await api('/api/floorplan/live'); S.pins = (S.live.pins || []).map(({ deviceId, floor, pos, label }) => ({ deviceId, floor, pos, label })); drawPins(); drawTotals(); } catch { /* next time */ } }
async function start() {
  S.plan = await api('/api/floorplan');
  try { units = (await api('/api/status')).units || 'F'; } catch { /* default */ }
  if (!S.plan.floors.length) { guidePanel(); $('#floors').replaceChildren(); }
  await loadFloors(); await refresh();
  if (location.hash === '#guide') guidePanel();
  if (location.hash === '#edit' && S.plan.pro?.pro) $('#editBtn').click();
  if (new URLSearchParams(location.search).has('embed')) document.querySelector('.brand').target = '_top';
  if (!S.plan.pro?.pro) toast('3D Home is part of HouseOS Pro - you can look around the demo, then upgrade to use your own scan.');
}
$('#editBtn').onclick = () => { S.edit = !S.edit; $('#editBtn').classList.toggle('on', S.edit); if (S.edit) editPanel(); else $('#side').hidden = true; };
$('#setupBtn').onclick = floorsPanel;
$('#guideBtn').onclick = guidePanel;
start(); setInterval(refresh, 5000);
