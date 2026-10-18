/* CasaTorch 3D Home - network on the plan, plan backups, the vacuum's map to trace, and voice "Show me".
   Loaded by one line at the end of floorplan.js, which hands over what it needs (the scene, the camera, the plan state).
   Everything here sits beside the 3D home's own parts and never changes them:
   - Network pins: Wi-Fi access points and other network gear (UniFi, Meraki), servers you watch and the internet "modem",
     green when fine, red when not, with connected-device counts. Placed from Editor > Network.
   - Wi-Fi coverage: each room tinted by an ESTIMATE from where the access points are (distance, walls, floors).
   - Backups: download the plan as a .zip (or as a template without devices), upload one with a preview, and go back to a
     restore point (kept automatically). Editor > Backups.
   - Vacuum map: in the drawing editor, a robot vacuum's map from Home Assistant as the picture to trace, to scale.
   - Voice: the mic in the bar listens (the browser's speech recognition, on a secure address only); a room, floor or device
     name flies there, anything else goes to the Home AI Agent - which never unlocks, opens or disarms anything. */
import { roomCoverage, WIFI_COLORS, matchVoice } from './floorplan-net-model.js';

const T = (s, v) => (typeof window.T === 'function' ? window.T(s, v) : String(s).split('|')[0].replace(/\{(\w+)\}/g, (_, k) => v?.[k] ?? ''));
let X = null;   // what floorplan.js handed over
const N = { data: null, objs: [], cov: [], fsig: '', covSig: '', placing: null, wifi: false, timer: null };
try { N.wifi = localStorage.getItem('casatorch-3d-wifi') === '1'; } catch { /* private window */ }
const P = { wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 19.5h.01', server: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01', globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  switch: 'M3 8h18v8H3zM7 12h.01M11 12h.01M15 12h.01', gateway: 'M4 14h16v6H4zM8 17h.01M12 10V4M9 7l3-3 3 3', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3', box: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4', close: 'M6 6l12 12M18 6L6 18' };
const icon = (n) => { const s = document.createElement('span'); s.className = 'ic'; s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${P[n] || P.server}"/></svg>`; return s; };
const KIND_ICON = { ap: 'wifi', modem: 'globe', server: 'server', switch: 'switch', gateway: 'gateway', device: 'switch' };
const KIND_WORD = { ap: 'Access point', modem: 'Your internet connection', server: 'Server', switch: 'Switch', gateway: 'Gateway', device: 'Network device' };
const thingOf = (ref) => N.data?.things?.find((t) => t.ref === ref) || null;
const plural = (n, one, many) => T(n === 1 ? one : many, { n });

export function init(ctx) {
  X = ctx;
  if (!document.querySelector('link[href="floorplan-net.css"]')) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'floorplan-net.css' }));
  micButton();
  new MutationObserver(() => { toolsButton(); editorButtons(); }).observe(document.body, { childList: true, subtree: true });
  new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.id === 'drawer') drawerVacuum(n); }).observe(document.body, { childList: true });
  X.renderer.domElement.addEventListener('pointerdown', placeDown, true);
  X.renderer.domElement.addEventListener('pointerup', placeUp, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && N.placing) stopPlacing(); });
  refresh(); N.timer = setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(sync, 400);
  pendingShow();
}

/* ---------- network pins ---------- */
async function refresh() {
  try { N.data = await (await fetch('/api/floorplan/network')).json(); } catch { return; }
  N.fsig = ''; sync(); toolsButton();
}
function floorSig() { return Object.values(X.S.F).map((F) => `${F.f.id}:${F.G.uuid}`).join(','); }
/* Called often and cheaply: rebuild when the floors were loaded again, and keep each pin shown only with its floor. */
function sync() {
  if (!X || !N.data) return;
  const S = X.S, fs = floorSig();
  if (fs !== N.fsig) { N.fsig = fs; buildPins(); N.covSig = ''; }
  coverage();
  const cur = X.curF(); let changed = false;
  const show = (o, extra = true) => { const F = S.F[o.userData.floor], v = !!F && F.G.visible && (!cur || F === cur) && extra; if (o.visible !== v) { o.visible = v; changed = true; } };
  for (const o of N.objs) show(o);
  const one = !!cur || Object.keys(S.F).length === 1;   // the words per room only when one floor is shown (the whole house would be a crowd)
  for (const o of N.cov) show(o, N.wifi && S.mode === 'view' && (!o.isCSS2DObject || one));
  legend();
  if (changed) X.kick();
}
function pinView(t) {
  if (!t) return { cls: 'unknown', val: '' };
  const cls = t.online === false ? 'down' : t.online ? 'up' : 'unknown';
  if (t.kind === 'modem') return { cls: t.online === false ? 'down' : t.tests?.down ? 'warn' : cls, val: t.online === false ? T('Offline') : t.tests?.down ? T('{n} app down', { n: t.tests.down }) : T('Online') };
  if (t.kind === 'server') return { cls, val: t.online === false ? T('Down') : t.ms != null ? `${t.ms} ms` : '' };
  return { cls, val: t.online === false ? T('Offline') : t.clients != null ? plural(t.clients, '{n} device', '{n} devices') : '' };
}
function buildPins() {
  for (const o of N.objs) { o.parent?.remove(o); o.element.remove(); }
  N.objs = [];
  for (const p of N.data?.pins || []) {
    const F = X.S.F[p.floor], t = thingOf(p.ref); if (!F) continue;
    const v = pinView(t), kind = t?.kind || (p.ref === 'modem' ? 'modem' : 'device');
    const b = X.el('button', { type: 'button', class: `pin netpin ${v.cls}${X.S.mode === 'edit' ? ' movable' : ''}`, 'aria-label': `${t?.name || p.ref}${v.val ? `: ${v.val}` : ''}`, onclick: () => pinClick(p) },
      icon(KIND_ICON[kind] || 'server'), kind === 'ap' && t?.online && t.clients != null ? X.el('span', { class: 'nb' }, String(t.clients)) : null, X.el('span', { class: 'val' }, X.el('b', {}, t?.name || T('Not found')), v.val ? ` ${v.val}` : ''));
    const o = new X.CSS2DObject(b); o.position.set(...p.pos); o.userData = { floor: p.floor, net: p.ref }; F.G.add(o); N.objs.push(o);
  }
  X.kick();
}
function pinClick(p) {
  const t = thingOf(p.ref);
  if (X.S.mode === 'edit') return X.modal(X.el('div', { class: 'box netbox' }, X.el('h2', {}, t?.name || p.ref),
    X.el('div', { class: 'row' }, X.el('button', { type: 'button', class: 'mini primary', onclick: () => { X.closeModal(); startPlacing(p.ref); } }, T('Move')),
      X.el('button', { type: 'button', class: 'mini', onclick: () => { X.closeModal(); savePins((N.data.pins || []).filter((x) => x.ref !== p.ref)); } }, T('Remove from the plan')),
      X.el('button', { type: 'button', class: 'mini', onclick: X.closeModal }, T('Cancel')))));
  netCard(t);
}
function netCard(t) {
  if (!t) return;
  const rows = [], row = (k, v) => v != null && v !== '' && rows.push(X.el('div', { class: 'nrow' }, X.el('span', {}, k), X.el('b', {}, v)));
  const state = t.online === false ? T('Offline') : t.online ? T('Online') : T('Not known yet');
  if (t.kind === 'modem') {
    const i = t.internet || {};
    row(T('Internet'), state); row(T('Provider'), i.provider); row(T('Delay to the internet'), i.ms != null ? `${i.ms} ms` : null); row(T('Last speed test'), i.down != null ? `${Math.round(i.down)} / ${Math.round(i.up)} Mbps` : null);
    row(T('Devices on the network'), t.clients != null ? String(t.clients) : null);
    if (t.tests) {
      row(T('App tests'), [T('{n} OK', { n: t.tests.ok }), t.tests.slow ? T('{n} slow', { n: t.tests.slow }) : '', t.tests.down ? T('{n} down', { n: t.tests.down }) : ''].filter(Boolean).join(' · '));
      for (const x of t.tests.names || []) rows.push(X.el('div', { class: `nrow sub ${x.down ? 'bad' : 'warn'}` }, X.el('span', {}, x.name), X.el('b', {}, x.down ? T('Down') : T('Slow'))));
    }
  } else if (t.kind === 'server') { row(T('Status'), t.online === false ? T('Not responding') : state); row(T('Answers in'), t.ms != null ? `${t.ms} ms` : null); }
  else { row(T('Status'), state); row(T('Connected devices'), t.clients != null ? String(t.clients) : t.kind === 'ap' ? T('Not reported by this network') : null); row(T('Model'), t.model); row(T('From'), t.source); }
  X.modal(X.el('div', { class: 'box netbox' }, X.el('h2', {}, icon(KIND_ICON[t.kind] || 'server'), ` ${t.name}`), X.el('p', { class: 'note' }, T(KIND_WORD[t.kind] || 'Network device')), ...rows,
    X.el('div', { class: 'row' }, X.el('a', { class: 'mini', href: '/#network', target: '_top' }, T('Open the Network tab')), X.el('button', { type: 'button', class: 'mini', onclick: X.closeModal }, T('Close')))));
}
async function savePins(pins) {
  try { const r = await X.send('/api/floorplan/net-pins', 'PUT', { pins }); N.data.pins = r.pins; N.fsig = ''; sync(); if (X.S.mode === 'edit' && X.S.tab === 'network') X.editor?.(); }
  catch (e) { X.toast(e.status === 402 ? T('Editing the 3D home is part of CasaTorch Pro.') : e.message); }
}
/* Edit > Network (a tab of the editor): what can go on the plan, and where it is. */
export function panel() {
  const d = N.data || { things: [], pins: [] }, placed = new Set((d.pins || []).map((p) => p.ref));
  const group = (title, list) => (list.length ? [X.el('h3', {}, title), ...list.map((t) => X.el('div', { class: 'nrow' }, X.el('span', { class: `dotst ${pinView(t).cls}` }), icon(KIND_ICON[t.kind] || 'server'), X.el('span', { class: 'nm' }, t.name, X.el('small', {}, pinView(t).val)),
    X.el('button', { type: 'button', class: 'mini primary', onclick: () => startPlacing(t.ref) }, placed.has(t.ref) ? T('Move') : T('Place')),
    placed.has(t.ref) ? X.el('button', { type: 'button', class: 'mini', onclick: () => savePins(d.pins.filter((p) => p.ref !== t.ref)) }, T('Remove')) : null))] : []);
  const th = d.things || [];
  return X.el('div', { class: 'netpanel' },
    ...group(T('Internet'), th.filter((t) => t.kind === 'modem')), ...group(T('Wi-Fi access points'), th.filter((t) => t.kind === 'ap')),
    ...group(T('Other network gear'), th.filter((t) => ['gateway', 'switch', 'device'].includes(t.kind))), ...group(T('Servers you watch'), th.filter((t) => t.kind === 'server')),
    X.el('p', { class: 'note' }, T('They turn red when they go offline; the internet pin turns red when the internet is down.')),
    !d.connected?.network ? X.el('p', { class: 'note' }, T('To place access points, connect your network controller in the Network tab of the dashboard.')) : null,
    !d.connected?.monitors ? X.el('p', { class: 'note' }, T('To place servers, add them to watch in the Network tab of the dashboard.')) : null);
}
/* For "What can I add?": everything that can be placed (or moved). */
export function addItems() {
  const d = N.data || { things: [], pins: [] }, placed = new Set((d.pins || []).map((p) => p.ref));
  const word = { modem: 'internet modem router', ap: 'wifi wi-fi access point', gateway: 'router gateway', switch: 'switch', server: 'server nas', device: 'network' };
  return (d.things || []).map((t) => ({ label: placed.has(t.ref) ? T('{name} (move)', { name: t.name }) : t.name, words: `${word[t.kind] || ''} network`, run: () => startPlacing(t.ref) }));
}
/* Placing: tap the house where it is (a drag still turns the view). */
function startPlacing(ref) {
  N.placing = { ref }; const t = thingOf(ref);
  document.getElementById('netplace')?.remove();
  document.body.append(X.el('div', { id: 'netplace', class: 'hint' }, T('Tap the house where {name} is.', { name: t?.name || ref }), X.el('button', { type: 'button', class: 'mini', onclick: stopPlacing }, T('Cancel'))));
}
function stopPlacing() { N.placing = null; document.getElementById('netplace')?.remove(); }
let downAt = null;
function placeDown(e) { if (N.placing && e.button === 0) downAt = [e.clientX, e.clientY]; }
function placeUp(e) {
  if (!N.placing || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null; if (moved > 6) return;
  const hit = hitAt(e.clientX, e.clientY); if (!hit) { X.toast(T('Tap on the house itself.')); return; }
  e.stopImmediatePropagation();
  const ref = N.placing.ref; stopPlacing();
  savePins([...(N.data.pins || []).filter((p) => p.ref !== ref), { ref, floor: hit.floor, pos: hit.pos }]);
}
const ray = { r: null, m: null };
function hitAt(cx, cy) {
  const { THREE, S } = X; ray.r ||= new THREE.Raycaster(); ray.m ||= new THREE.Vector2();
  const rc = X.renderer.domElement.getBoundingClientRect(); ray.m.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1); ray.r.setFromCamera(ray.m, X.camera);
  const cur = X.curF(), Fs = Object.values(S.F).filter((F) => F.G.visible && (!cur || F === cur));
  const h = ray.r.intersectObjects(Fs.map((F) => F.G), true).find((x) => x.object.isMesh && x.object.visible && x.object.material?.opacity !== 0 && !(x.point.y > (x.object.material?.clippingPlanes?.[0]?.constant ?? Infinity)));
  if (!h) return null;
  let o = h.object; while (o && !(o.userData?.floor && o.isGroup && S.F[o.userData.floor]?.G === o)) o = o.parent;
  const F = o ? S.F[o.userData.floor] : S.F[h.object.userData.floor]; if (!F) return null;
  const n = h.face?.normal ? h.face.normal.clone().transformDirection(h.object.matrixWorld).multiplyScalar(0.15) : new THREE.Vector3(0, 0.15, 0);
  const l = F.G.worldToLocal(h.point.clone().add(n));
  return { floor: F.f.id, pos: [l.x, l.y, l.z].map((v) => Math.round(v * 1000) / 1000) };
}

/* ---------- Wi-Fi coverage (estimate) ---------- */
function apList() {
  return (N.data?.pins || []).map((p) => ({ p, t: thingOf(p.ref) })).filter((x) => x.t?.kind === 'ap' && X.S.F[x.p.floor]).map(({ p, t }) => {
    const F = X.S.F[p.floor], w = F.G.localToWorld(new X.THREE.Vector3(...p.pos)); return { x: w.x, z: w.z, level: F.f.level || 0, online: t.online, name: t.name };
  });
}
/* Walls as straight lines on the floor, from the floor's wall pieces (a scan's walls or the drawn ones). */
function wallLines(F) {
  const out = [], b = new X.THREE.Box3();
  for (const m of F.wallMeshes || []) {
    if (m.userData.cat !== 'wall' || !m.visible) continue;
    b.setFromObject(m); const dx = b.max.x - b.min.x, dz = b.max.z - b.min.z;
    if (Math.max(dx, dz) < 0.3 || Math.min(dx, dz) > 1) continue;   // not one straight wall
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    out.push(dx >= dz ? [b.min.x, cz, b.max.x, cz] : [cx, b.min.z, cx, b.max.z]);
  }
  return out;
}
function clearCoverage() { for (const o of N.cov) { o.parent?.remove(o); if (o.isCSS2DObject) o.element.remove(); o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); } N.cov = []; }
function coverage() {
  const aps = apList(), sig = `${N.fsig}|${N.wifi}|${aps.map((a) => `${a.x.toFixed(2)},${a.z.toFixed(2)},${a.level},${a.online}`).join(';')}`;
  if (sig === N.covSig) return; N.covSig = sig; clearCoverage();
  if (!N.wifi || !aps.length) return;
  const { THREE, S } = X, Fs = Object.values(S.F), walls = {};
  for (const F of Fs) (walls[F.f.level || 0] ||= []).push(...wallLines(F));
  for (const F of Fs) {
    if (!F.rooms?.length || !F.box) continue;
    const rooms = F.rooms.map((r) => { const w = F.G.localToWorld(new THREE.Vector3(r.pos[0], 0, r.pos[1])); return { x: w.x, z: w.z, level: F.f.level || 0 }; });
    const est = roomCoverage(rooms, aps, walls);
    /* A tint on the floor, room by room (each spot takes its nearest room, like the room colors do). */
    const bx0 = F.box.min.x - F.loadOff[0], bx1 = F.box.max.x - F.loadOff[0], bz0 = F.box.min.z - F.loadOff[1], bz1 = F.box.max.z - F.loadOff[1], w = bx1 - bx0, d = bz1 - bz0;
    if (!(w > 0.5 && d > 0.5)) continue;
    const res = 160 / Math.max(w, d), cw = Math.max(8, Math.round(w * res)), ch = Math.max(8, Math.round(d * res)), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d'), img = g.createImageData(cw, ch), cols = est.map((e) => new THREE.Color(WIFI_COLORS[e.level]));
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const x = bx0 + (i + 0.5) / res, z = bz0 + (j + 0.5) / res; let best = -1, bd = Infinity;
      F.rooms.forEach((r, k) => { const dd = (r.pos[0] - x) ** 2 + (r.pos[1] - z) ** 2; if (dd < bd) { bd = dd; best = k; } });
      const c = cols[best], o = (j * cw + i) * 4; if (!c || bd > 64) continue;
      img.data[o] = c.r * 255; img.data[o + 1] = c.g * 255; img.data[o + 2] = c.b * 255; img.data[o + 3] = 150;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(bx0 + w / 2, F.minY + 0.06, bz0 + d / 2); mesh.renderOrder = 3; mesh.raycast = () => {}; mesh.userData = { floor: F.f.id, keep: true };
    F.G.add(mesh); N.cov.push(mesh);
    F.rooms.forEach((r, k) => {   // the word for each room, under its name
      const o = new X.CSS2DObject(X.el('div', { class: 'wifichipw' }, X.el('span', { class: `wifichip ${est[k].level}` }, T('Wi-Fi: {q}', { q: wifiWord(est[k].level) }))));
      o.position.set(r.pos[0], F.minY + 0.15, r.pos[1]); o.userData = { floor: F.f.id }; F.G.add(o); N.cov.push(o);
    });
  }
  X.kick();
}
const wifiWord = (k) => ({ strong: T('Strong|wifi'), good: T('Good|wifi'), fair: T('Fair|wifi'), weak: T('Weak|wifi') }[k] || T('None|wifi'));
function legend() {
  const on = N.wifi && X.S.mode === 'view' && apList().length > 0; let lg = document.getElementById('wifilegend');
  if (!on) { lg?.remove(); return; }
  if (lg) return;
  lg = X.el('div', { id: 'wifilegend' }, X.el('b', {}, T('Wi-Fi coverage - estimate')),
    X.el('div', { class: 'keys' }, ...['strong', 'good', 'fair', 'weak'].map((k) => X.el('span', {}, X.el('i', { style: `background:${WIFI_COLORS[k]}` }), wifiWord(k)))),
    X.el('small', {}, T('Worked out from where your access points are placed, how far each room is and the walls in between - not measured. Offline access points are left out.')));
  document.body.append(lg);
}
function toolsButton() {
  const t = document.getElementById('tools'); if (!t || t.hidden) return;
  const has = (N.data?.pins || []).some((p) => thingOf(p.ref)?.kind === 'ap'), b = t.querySelector('#wifiTog');
  if (!has) { b?.remove(); return; }
  if (b) { b.classList.toggle('on', N.wifi); return; }
  t.append(X.el('button', { type: 'button', id: 'wifiTog', class: `tog${N.wifi ? ' on' : ''}`, title: T('Estimated Wi-Fi coverage, room by room'), onclick: () => { N.wifi = !N.wifi; try { localStorage.setItem('casatorch-3d-wifi', N.wifi ? '1' : '0'); } catch { /* fine */ } sync(); toolsButton(); } }, icon('wifi'), T('Wi-Fi')));
}

/* ---------- Editor: Backups (next to Undo and Redo; Network is a tab of its own) ---------- */
function editorButtons() {
  const bar = document.querySelector('#left .undobar'); if (!bar || bar.querySelector('.nbx')) return;
  bar.append(X.el('span', { class: 'nbx' },
    X.el('button', { type: 'button', class: 'mini', title: T('Download, upload and restore points'), onclick: backupPanel }, T('Backups'))));
}
const WHY = { auto: 'A change', start: 'When CasaTorch started', 'before-import': 'Before an upload', imported: 'Uploaded plan', 'before-restore': 'Before going back' };
async function backupPanel() {
  const list = X.el('div', { class: 'rplist' }, X.el('p', { class: 'note' }, T('Loading…')));
  const file = X.el('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none', onchange: () => file.files[0] && preview(file.files[0]) });
  X.modal(X.el('div', { class: 'box netbox wide' }, X.el('h2', {}, T('Backups of your plan')),
    X.el('div', { class: 'row' }, X.el('a', { class: 'mini primary', href: '/api/floorplan/export', download: '' }, T('Download the plan (.zip)')), X.el('a', { class: 'mini', href: '/api/floorplan/export?template=1', download: '' }, T('Download as a template')), X.el('button', { type: 'button', class: 'mini', onclick: () => file.click() }, T('Upload a plan…')), file),
    X.el('p', { class: 'note' }, T('The .zip has your floors, rooms, scans and floor-plan pictures. A template leaves out every device, so you can share the layout.')),
    X.el('h3', {}, T('Restore points')), list,
    X.el('div', { class: 'row' }, X.el('button', { type: 'button', class: 'mini', onclick: X.closeModal }, T('Close')))));
  try {
    const r = await (await fetch('/api/floorplan/restore-points')).json();
    X.fill(list, r.points?.length ? r.points.map((p) => X.el('div', { class: 'nrow' }, X.el('span', { class: 'nm' }, new Date(p.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      X.el('small', {}, `${T(WHY[p.reason] || 'A change')} · ${plural(p.floors, '{n} floor', '{n} floors')} · ${plural(p.rooms, '{n} room', '{n} rooms')} · ${plural(p.pins, '{n} pin', '{n} pins')}`)),
      X.el('button', { type: 'button', class: 'mini', onclick: () => restore(p) }, T('Restore')))) : X.el('p', { class: 'note' }, T('None yet - one is kept a few seconds after each change.')),
      X.el('p', { class: 'note' }, T('Kept by themselves a few seconds after each change: the newest {keep}, plus one a day for two weeks.', { keep: r.keep || 20 }), r.demo ? ` ${T('In the demo they last until it restarts.')}` : ''));
  } catch { X.fill(list, X.el('p', { class: 'note' }, T('Restore points could not be loaded.'))); }
}
const after = async (msg) => { X.S.hist.undo = []; X.S.hist.redo = []; X.closeModal(); await X.reload(); N.fsig = ''; refresh(); X.toast(msg); };
async function restore(p) {
  const when = new Date(p.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  if (!confirm(T('Go back to the plan from {when}? The plan as it is now is kept as a restore point too.', { when }))) return;
  try { await X.api(`/api/floorplan/restore-points/${encodeURIComponent(p.id)}`, { method: 'POST' }); await after(T('Plan restored.')); } catch (e) { X.toast(e.message); }
}
async function preview(f) {
  X.toast(T('Checking the file…'));
  let r; try { r = await X.api('/api/floorplan/import', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: f }); } catch (e) { X.toast(e.message); return; }
  const s = r.summary, tpl = X.el('input', { type: 'checkbox', checked: s.template ? true : null });
  X.modal(X.el('div', { class: 'box netbox wide' }, X.el('h2', {}, T('Upload this plan?')),
    X.el('div', { class: 'nrow' }, X.el('span', {}, T('Floors')), X.el('b', {}, s.floors.map((x) => x.name).join(', '))),
    X.el('div', { class: 'nrow' }, X.el('span', {}, T('Rooms')), X.el('b', {}, String(s.rooms))),
    X.el('div', { class: 'nrow' }, X.el('span', {}, T('Devices placed')), X.el('b', {}, String(s.pins))),
    X.el('div', { class: 'nrow' }, X.el('span', {}, T('Scans and pictures')), X.el('b', {}, `${s.files} · ${s.mb} MB`)),
    s.exportedAt ? X.el('div', { class: 'nrow' }, X.el('span', {}, T('Saved')), X.el('b', {}, new Date(s.exportedAt).toLocaleString())) : null,
    ...(s.warnings || []).map((w) => X.el('p', { class: 'note warn' }, w)),
    X.el('label', { class: 'nrow' }, X.el('span', {}, tpl, ' ', T('Use as a template (leave out every device)')), null),
    X.el('p', { class: 'note' }, T('It replaces the plan you have now. Your plan now is kept as a restore point first, so you can go back.')),
    X.el('div', { class: 'row' }, X.el('button', { type: 'button', class: 'mini primary', onclick: async () => {
      if (!confirm(T('Replace your plan with this one?'))) return;
      try { await X.send('/api/floorplan/import/apply', 'POST', { token: r.token, template: tpl.checked }); await after(T('Plan uploaded.')); } catch (e) { X.toast(e.message); }
    } }, T('Replace my plan')), X.el('button', { type: 'button', class: 'mini', onclick: X.closeModal }, T('Cancel')))));
}

/* ---------- the vacuum's map, as the picture to trace ---------- */
function drawerVacuum(box) {
  setTimeout(() => {
    const input = box.querySelector('input[type=file]'), row = input?.closest('.draw-top'); if (!row || row.querySelector('.vacbtn')) return;
    const btn = X.el('button', { type: 'button', class: 'vacbtn', title: T('Use your robot vacuum\'s map from Home Assistant') }, T('From the vacuum\'s map'));
    btn.onclick = () => vacuumPick(box, input, btn);
    input.before(btn);
  }, 0);
}
async function vacuumPick(box, input, btn) {
  box.querySelector('.vacpop')?.remove();
  const pop = X.el('div', { class: 'vacpop' }, X.el('p', { class: 'note' }, T('Looking for vacuum maps…'))); btn.after(pop);
  const close = X.el('button', { type: 'button', class: 'mini', onclick: () => pop.remove() }, T('Close'));
  let r; try { r = await (await fetch('/api/floorplan/vacuum-maps')).json(); } catch { r = { maps: [] }; }
  if (!r.connected) return X.fill(pop, X.el('p', { class: 'note' }, T('Connect Home Assistant to use your robot vacuum\'s map (Valetudo, Roborock or Xiaomi map entities).')), close);
  if (!r.maps?.length) return X.fill(pop, X.el('p', { class: 'note' }, T('No vacuum map found in Home Assistant. Valetudo, the Roborock integration and the Xiaomi map extractor each add one as a camera or image entity.')), close);
  X.fill(pop, X.el('b', {}, T('Pick the map')), ...r.maps.map((m) => X.el('button', { type: 'button', class: 'vacrow', onclick: () => useMap(m) }, X.el('span', {}, m.name), X.el('small', {}, `${m.source}${m.mpp ? ` · ${T('to scale')}` : ''}`))), close);
  async function useMap(m) {
    X.fill(pop, X.el('p', { class: 'note' }, T('Getting the map…')));
    try {
      const res = await fetch(`/api/floorplan/vacuum-maps/image?entity=${encodeURIComponent(m.entity)}`); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || T('The map could not be loaded.'));
      const blob = await res.blob(), bmp = await createImageBitmap(blob), widthM = m.mpp ? Math.round(bmp.width * m.mpp * 10) / 10 : null; bmp.close?.();
      const dt = new DataTransfer(); dt.items.add(new File([blob], `vacuum-map.${/png/.test(blob.type) ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg'}`, { type: blob.type }));
      const widthIn = () => box.querySelector('input[type=number][max="500"][step="0.1"]') || box.querySelector('input[type=number][max="500"]');
      const before = widthIn();
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));   // the drawing editor uploads it as its own picture
      if (widthM) {   // then, once its picture panel shows the new picture, the real width
        for (let k = 0; k < 40; k++) { await new Promise((ok) => setTimeout(ok, 250)); const w = widthIn(); if (w && w !== before) break; }
        const w = widthIn();
        if (w) { w.dispatchEvent(new Event('focus')); w.value = String(widthM); w.dispatchEvent(new Event('input', { bubbles: true })); w.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      pop.remove();
      setTimeout(() => X.toast(widthM ? T('Vacuum map added at its real size ({w} m wide) - check it against a wall you know.', { w: widthM }) : T('Vacuum map added - set how wide it is in meters.')), 300);
    } catch (e) { X.fill(pop, X.el('p', { class: 'note' }, e.message), close); }
  }
}

/* ---------- voice: "Show me…" ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_LANG = { en: 'en-US', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT', nl: 'nl-NL', ja: 'ja-JP', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN', pl: 'pl-PL', sv: 'sv-SE', tr: 'tr-TR' };
const speechLang = () => { const l = (document.documentElement.lang || 'en').split('-')[0]; return (navigator.languages || []).find((x) => x.toLowerCase().startsWith(`${l}-`)) || SPEECH_LANG[l] || 'en-US'; };
function micButton() {
  const help = document.getElementById('guideBtn'); if (!help || document.getElementById('micBtn')) return;
  help.before(X.el('button', { type: 'button', id: 'micBtn', class: 'tog', title: T('Say a room, a floor or a device to go there - or ask your Home AI Agent'), 'aria-label': T('Show me (voice)'), onclick: listen }, icon('mic'), X.el('span', { class: 'btxt' }, T('Show me'))));
}
function vbox(...kids) {
  let b = document.getElementById('voicebox');
  if (!b) { b = X.el('div', { id: 'voicebox', role: 'status', 'aria-live': 'polite' }); document.body.append(b); }
  X.fill(b, ...kids, X.el('button', { type: 'button', class: 'vx', 'aria-label': T('Close'), onclick: () => { N.rec?.abort?.(); b.remove(); } }, icon('close')));
  clearTimeout(N.vboxT); return b;
}
function listen() {
  if (N.rec) { N.rec.stop(); return; }
  if (!window.isSecureContext) return vbox(X.el('b', {}, T('Voice needs the secure address')), X.el('p', {}, T('Browsers only let a page listen on a secure (https) address. Open CasaTorch from its secure address - Settings > Connections & AI > Secure address at home.')));
  if (!SR) return vbox(X.el('b', {}, T('This browser can\'t listen')), X.el('p', {}, T('Voice works in Chrome, Edge and Safari. You can still type to your Home AI Agent.')));
  const rec = new SR(); N.rec = rec; rec.lang = speechLang(); rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
  const said = X.el('p', { class: 'said' }, '…'); let final = null;
  vbox(X.el('b', { class: 'listening' }, icon('mic'), T('Listening…')), said, X.el('small', {}, T('Say "Show me the kitchen", "Upstairs", or ask anything.')));
  document.getElementById('micBtn')?.classList.add('on');
  rec.onresult = (e) => { const r = e.results[e.results.length - 1]; said.textContent = r[0].transcript; if (r.isFinal) final = [...r].map((a) => a.transcript); };
  rec.onerror = (e) => { final = null; N.recErr = e.error; };
  rec.onend = () => {
    N.rec = null; document.getElementById('micBtn')?.classList.remove('on');
    if (final?.length) return heard(final);
    const why = { 'not-allowed': T('The microphone is blocked - allow it for this site in the browser\'s settings.'), 'service-not-allowed': T('The microphone is blocked - allow it for this site in the browser\'s settings.'), network: T('The browser\'s speech service could not be reached.'), 'no-speech': T('Didn\'t catch that - tap the mic and try again.') }[N.recErr] || T('Didn\'t catch that - tap the mic and try again.');
    N.recErr = null; if (document.getElementById('voicebox')) { vbox(X.el('p', {}, why)); N.vboxT = setTimeout(() => document.getElementById('voicebox')?.remove(), 6000); }
  };
  try { rec.start(); } catch { N.rec = null; }
}
function voiceIndex() {
  const S = X.S;
  return { rooms: Object.values(S.F).flatMap((F) => (F.rooms || []).map((r, i) => ({ name: r.name, floor: F.f.id, i }))), floors: (S.plan?.floors || []).map((f) => ({ id: f.id, name: f.name, level: f.level || 0 })),
    devices: (S.live?.pins || []).map((p) => ({ id: p.deviceId, name: p.label || p.device?.name })).filter((d) => d.name), pins: (N.data?.pins || []).map((p) => ({ ref: p.ref, name: thingOf(p.ref)?.name })).filter((p) => p.name) };
}
/** Go where it was asked. True when it was a place. */
function goTo(m) {
  if (!m) return false;
  if (X.S.mode !== 'view') X.setMode?.('view');
  if (m.kind === 'house') X.resetView();
  else if (m.kind === 'room') X.focusRoom(m.floor, m.i);
  else if (m.kind === 'floor') X.pickFloor(m.id);
  else if (m.kind === 'device') { const p = X.S.live?.pins?.find((x) => x.deviceId === m.id); if (!p) return false; X.goToPin(p); }
  else if (m.kind === 'pin') {
    const o = N.objs.find((x) => x.userData.net === m.ref); if (!o) return false;
    const F = X.S.F[o.userData.floor]; if (X.S.floorView !== 'all' && X.S.floorView !== o.userData.floor) X.pickFloor(o.userData.floor);
    const w = o.getWorldPosition(new X.THREE.Vector3()); X.flyTo(w, w.clone().add(X.camera.position.clone().sub(X.controls.target).normalize().multiplyScalar(6))); if (!F) return false;
  }
  return true;
}
function heard(alts) {
  const idx = voiceIndex();
  for (const a of alts) { const m = matchVoice(a, idx); if (m && goTo(m)) { vbox(X.el('p', {}, T('Showing {what}', { what: m.kind === 'house' ? T('the whole house') : m.name }))); N.vboxT = setTimeout(() => document.getElementById('voicebox')?.remove(), 2500); return; } }
  ask(alts[0]);
}
/* Everything else: the Home AI Agent. It answers, and can line up a switch for you to tap - never a lock, a garage door, a gate or an alarm. */
async function ask(q) {
  vbox(X.el('p', { class: 'said' }, `"${q}"`), X.el('span', { class: 'typing' }, X.el('i'), X.el('i'), X.el('i')));
  let r; try { r = await X.send('/api/ask', 'POST', { question: q, history: [] }); } catch (e) { r = { answer: e.body?.setup ? T('Connect an AI first: Settings › Connections & AI › Home AI Agent.') : e.message, actions: [] }; }
  const acts = (r.actions || []).filter((a) => ['on', 'off', 'toggle'].includes(a.action));
  vbox(X.el('p', { class: 'said' }, `"${q}"`), X.el('p', {}, r.answer || ''),
    acts.length ? X.el('div', { class: 'acts' }, acts.map((a) => { const b = X.el('button', { type: 'button', class: 'mini' }, a.label); b.onclick = async () => { b.disabled = true; try { await X.send(`/api/devices/${encodeURIComponent(a.deviceId)}/${encodeURIComponent(a.action)}`, 'POST', {}); b.textContent = T('Done'); } catch (e) { X.toast(e.message); b.disabled = false; } }; return b; })) : null);
  N.vboxT = setTimeout(() => document.getElementById('voicebox')?.remove(), 45_000);
}
/* "Show me…" said in the Home AI Agent panel of the dashboard: it opens the 3D home and flies there. */
function pendingShow() {
  let p = null; try { p = JSON.parse(sessionStorage.getItem('casatorch-3d-show') || 'null'); sessionStorage.removeItem('casatorch-3d-show'); } catch { /* none */ }
  if (!p?.text || Date.now() - p.at > 60_000) return;
  const t0 = Date.now(), tick = () => { if (Object.keys(X.S.F).length && X.S.live) { const m = matchVoice(p.text, voiceIndex()); if (!goTo(m)) X.toast(T('Couldn\'t find "{q}" on the plan.', { q: p.text })); } else if (Date.now() - t0 < 20_000) setTimeout(tick, 400); };
  setTimeout(tick, 600);
}
