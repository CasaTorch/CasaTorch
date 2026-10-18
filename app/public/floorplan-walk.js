/* Walk through the house at eye height: W A S D or the arrow keys (or the stick on a touch screen) to walk, drag to look around.
   Walls stop you (a simple check straight ahead); open doors don't. Esc or "Leave" goes back to where you were. */
import * as THREE from 'three';

const TT = (s, v) => (typeof window.T === 'function' ? window.T(s, v) : s);
const V3 = THREE.Vector3;

export function createWalk(ctx) {
  const { S, prefs, camera, controls, renderer, el } = ctx;
  const W = { on: false, keys: new Set(), yaw: 0, pitch: 0, stick: [0, 0], saved: null, F: null, hud: null, ray: new THREE.Raycaster(), dir: new V3(), pos: new V3() };
  const eye = () => W.F.G.position.y + W.F.floorY + 1.6;
  function enter() {
    if (W.on) return;
    if (ctx.replaying?.()) return;
    const cur = S.floorView === 'all' ? null : S.F[S.floorView];
    const F = cur || Object.values(S.F).filter((x) => x.rooms.length).sort((a, b) => (a.f.level || 0) - (b.f.level || 0))[0] || Object.values(S.F)[0]; if (!F) return;
    W.F = F; W.on = true;
    W.saved = { p: camera.position.clone(), t: controls.target.clone(), max: controls.maxPolarAngle, minD: controls.minDistance, walls: prefs.walls, roof: prefs.roof, spin: prefs.spin, view: S.floorView, room: S.room };
    const r = S.room?.floor === F.f.id ? F.rooms[S.room.i] : F.rooms[0];
    const at = r ? F.G.localToWorld(new V3(r.pos[0], 0, r.pos[1])) : F.box.getCenter(new V3());
    S.room = null; S.floorView = F.f.id; prefs.walls = 'tall'; prefs.roof = false; prefs.spin = false;
    controls.enabled = false; controls.autoRotate = false; controls.maxPolarAngle = Math.PI; controls.minDistance = 0.01;
    W.yaw = Math.atan2(at.x - camera.position.x, -(at.z - camera.position.z)); W.pitch = 0;
    camera.position.set(at.x, eye(), at.z); aim();
    ctx.closeCard(); document.body.classList.add('walking'); ctx.layout(false);
    hud(); ctx.kick();
  }
  function leave() {
    if (!W.on) return;
    W.on = false; W.keys.clear(); W.stick = [0, 0];
    const s = W.saved; Object.assign(prefs, { walls: s.walls, roof: s.roof, spin: s.spin });
    controls.maxPolarAngle = s.max; controls.minDistance = s.minD; controls.enabled = true;
    S.floorView = s.view; S.room = s.room;
    document.body.classList.remove('walking'); W.hud?.remove(); W.hud = null;
    ctx.layout(false); ctx.flyTo(s.t, s.p, 600); ctx.drawTools();
  }
  function aim() { W.dir.set(Math.sin(W.yaw) * Math.cos(W.pitch), Math.sin(W.pitch), -Math.cos(W.yaw) * Math.cos(W.pitch)); controls.target.copy(camera.position).addScaledVector(W.dir, 0.6); camera.lookAt(controls.target); }
  function blocked(from, d, len) {
    if (len < 1e-5) return false;
    const walls = (W.F.wallMeshes || []).filter((m) => m.visible && m.userData.cat === 'wall');
    for (const h of [-0.7, 0]) {   // at the waist and at eye height
      W.ray.set(from.clone().setY(from.y + h), d); W.ray.far = len + 0.32;
      if (W.ray.intersectObjects(walls, false).length) return true;
    }
    return false;
  }
  function hud() {
    const touch = matchMedia('(pointer: coarse)').matches;
    const knob = el('i'), stick = touch ? el('div', { class: 'l3stick', 'aria-hidden': 'true' }, knob) : null;
    if (stick) stick.addEventListener('pointerdown', (e) => {
      e.preventDefault(); stick.setPointerCapture(e.pointerId); const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const mv = (ev) => { let x = (ev.clientX - cx) / (r.width / 2), y = (ev.clientY - cy) / (r.height / 2); const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } W.stick = [x, y]; knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`; ctx.kick(); };
      const up = () => { W.stick = [0, 0]; knob.style.transform = ''; stick.removeEventListener('pointermove', mv); stick.removeEventListener('pointerup', up); stick.removeEventListener('pointercancel', up); };
      stick.addEventListener('pointermove', mv); stick.addEventListener('pointerup', up); stick.addEventListener('pointercancel', up); mv(e);
    });
    W.hud = el('div', { id: 'l3walk' }, el('div', { class: 'whead' }, el('b', {}, TT('Walking through')), el('small', {}, touch ? TT('Use the stick to walk, drag to look around') : TT('W A S D or arrow keys to walk, drag to look around')),
      el('button', { type: 'button', class: 'tog on', onclick: leave }, TT('Leave'))), stick);
    document.body.append(W.hud);
  }
  /* looking around: drag on the house */
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!W.on) return;
    const x0 = e.clientX, y0 = e.clientY, yaw0 = W.yaw, p0 = W.pitch;
    const mv = (ev) => { W.yaw = yaw0 + (ev.clientX - x0) * 0.005; W.pitch = Math.max(-1.2, Math.min(1.2, p0 - (ev.clientY - y0) * 0.005)); aim(); ctx.kick(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  addEventListener('keydown', (e) => {
    if (!W.on || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'Escape') { leave(); return; }
    const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) { W.keys.add(k); e.preventDefault(); ctx.kick(); }
  });
  addEventListener('keyup', (e) => W.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => W.keys.clear());
  return {
    on: () => W.on, toggle: () => (W.on ? leave() : enter()), leave,
    tick(dt) {
      if (!W.on) return;
      const K = W.keys, fwd = (K.has('w') || K.has('arrowup') ? 1 : 0) - (K.has('s') || K.has('arrowdown') ? 1 : 0) - W.stick[1];
      const side = (K.has('d') ? 1 : 0) - (K.has('a') ? 1 : 0) + W.stick[0], turn = (K.has('arrowright') || K.has('e') ? 1 : 0) - (K.has('arrowleft') || K.has('q') ? 1 : 0);
      if (turn) { W.yaw += turn * 1.6 * dt; aim(); }
      if (!fwd && !side) { if (turn) ctx.kick(); return; }
      const f = new V3(Math.sin(W.yaw), 0, -Math.cos(W.yaw)), r = new V3(-f.z, 0, f.x), mv = f.multiplyScalar(fwd).add(r.multiplyScalar(side));
      const len = Math.min(1, mv.length()) * 1.5 * dt; if (len <= 0) return; mv.normalize();
      const P = camera.position;
      if (!blocked(P, mv, len)) P.addScaledVector(mv, len);
      else for (const ax of [new V3(mv.x, 0, 0), new V3(0, 0, mv.z)]) { if (ax.lengthSq() < 1e-4) continue; const n = ax.clone().normalize(), l = len * ax.length(); if (!blocked(P, n, l)) { P.addScaledVector(n, l); break; } }   // slide along the wall
      P.y = eye(); aim(); ctx.kick();
    },
  };
}
