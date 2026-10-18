/* CasaTorch 3D Home - doors and windows in drawn floors, built so they can move later.
   Each opening is a THREE.Group named "Door <id>" / "Window <id>" with
     userData: { openingId, kind, swing ('left'|'right' hinge side), opens ('in'|'out'), openDir (+1/-1: multiply an angle by it to swing the
                 leaf the way it opens), slide (m a slider travels), lift (m a garage door rises) }
   and a child Group named 'leaf' (door leaf, window sash, garage panel) whose origin is its pivot: the hinge for doors and windows
   (leaf.rotation.y = openDir x angle), the top edge for a roof window (leaf.rotation.x = openDir x angle), the closed spot for sliders and garage doors
   (move leaf.position.x / .y). A double door has 'leaf' and 'leaf2' (hinged at the other side, turn it by -angle); a bifold door's
   leaf holds 'panel2', hinged where its two panels meet (turn it by -2 x angle while the leaf turns by angle).
   A window or roof window linked to a blind (coverId) has a child Group 'cover' (origin at the top; scale.y 0..1 lowers it).
   The local frame: x along the wall (from its start), y up from the floor, z out of the wall on the "out" side. */
import * as THREE from 'three';

const box = (w, h, d, name) => { const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.005, w), Math.max(0.005, h), Math.max(0.005, d))); m.name = name; return m; };
const FRAME = 0.05;
/* o: the opening; w: its width; T: the wall's thickness; out: +1 when "out" is the wall's +z side. */
export function buildOpening(o, { width, thick, inSign = 1 }) {
  const g = new THREE.Group(), id = o.id, kind = o.kind, W = width, Hh = Math.max(0.3, o.height || 2), sill = Math.max(0, o.sill || 0), T = thick;
  const isWin = kind === 'window', base = isWin ? `Window ${id}` : `Door ${id}`, hinge = o.swing === 'right' ? 1 : -1, opensOut = o.opens === 'out';
  g.name = base;
  const openDir = (opensOut ? -inSign : inSign) * hinge;   // a + turn swings the leaf toward z = hinge side's sign
  g.userData = { openingId: id, kind, swing: o.swing === 'right' ? 'right' : 'left', opens: opensOut ? 'out' : 'in', openDir };
  // the frame (wall colored, so it reads as the reveal of the hole)
  const trim = (w, h, x, y, n) => { const m = box(w, h, T + 0.02, `Wall frame ${id} ${n}`); m.position.set(x, y, 0); g.add(m); };
  trim(FRAME, Hh, -W / 2 + FRAME / 2, sill + Hh / 2, 'l'); trim(FRAME, Hh, W / 2 - FRAME / 2, sill + Hh / 2, 'r'); trim(W, FRAME, 0, sill + Hh - FRAME / 2, 't');
  if (isWin) trim(W, FRAME, 0, sill + FRAME / 2, 'b');
  const iw = W - FRAME * 2, ih = Hh - FRAME * (isWin ? 2 : 1), y0 = sill + (isWin ? FRAME : 0);
  const leafAt = (x, name = 'leaf') => { const l = new THREE.Group(); l.name = name; l.position.set(x, y0, 0); g.add(l); return l; };
  const panel = (w, h, d, name) => box(w, h, d, `${name} ${id}`);
  if (kind === 'window') {
    const l = leafAt(hinge * iw / 2); const p = panel(iw, ih, 0.03, 'Window pane'); p.position.set(-hinge * iw / 2, ih / 2, 0); l.add(p);
  } else if (kind === 'door' || kind === 'double') {
    const n = kind === 'double' ? 2 : 1, lw = iw / n;
    const l = leafAt(hinge * iw / 2); const p = panel(lw, ih, 0.045, 'Door leaf'); p.position.set(-hinge * lw / 2, ih / 2, 0); l.add(p);
    if (n === 2) { const l2 = leafAt(-hinge * iw / 2, 'leaf2'); const p2 = panel(lw, ih, 0.045, 'Door leaf 2'); p2.position.set(hinge * lw / 2, ih / 2, 0); l2.add(p2); }
  } else if (kind === 'bifold') {
    const pw = iw / 2, l = leafAt(hinge * iw / 2), p1 = panel(pw, ih, 0.04, 'Door fold 1'); p1.position.set(-hinge * pw / 2, ih / 2, 0); l.add(p1);
    const k = new THREE.Group(); k.name = 'panel2'; k.position.set(-hinge * pw, 0, 0); l.add(k);
    const p2 = panel(pw, ih, 0.04, 'Door fold 2'); p2.position.set(-hinge * pw / 2, ih / 2, 0); k.add(p2);
  } else if (kind === 'slider') {
    const pw = iw / 2 + 0.03, fixed = panel(pw, ih, 0.03, 'Window slider fixed'); fixed.position.set(hinge * (iw / 2 - pw / 2), y0 + ih / 2, -0.03); g.add(fixed);
    const l = leafAt(-hinge * (iw / 2 - pw / 2)), p = panel(pw, ih, 0.03, 'Window slider'); p.position.set(0, ih / 2, 0.03); l.add(p);
    g.userData.slide = +(hinge * (iw - pw)).toFixed(3);   // move leaf.position.x by up to this to open
  } else if (kind === 'garage') {
    const l = leafAt(0), p = panel(iw, ih, 0.05, 'Door garage'); p.position.set(0, ih / 2, 0); l.add(p);
    for (let i = 1; i < 4; i++) { const s = panel(iw, 0.012, 0.06, `Door garage seam${i}`); s.position.set(0, (ih * i) / 4, 0); l.add(s); }
    g.userData.lift = +ih.toFixed(3);   // move leaf.position.y up by this to open
  }
  if (o.coverId && (isWin || kind === 'slider')) {
    const c = new THREE.Group(); c.name = 'cover'; c.position.set(0, sill + Hh - FRAME, inSign * (T / 2 + 0.03)); g.add(c);
    const s = box(W - FRAME, Hh - FRAME * 2, 0.012, `Wall blind ${id}`); s.position.set(0, -(Hh - FRAME * 2) / 2, 0); c.add(s);
    c.userData.full = Hh - FRAME * 2;
  }
  return g;
}

/* A roof window: a pane in the roof (or the ceiling under a flat roof), hinged at its top edge. at: { x, y, z } on the surface,
   down: [x, z] the way down the slope (or [0, 1]), tilt: the slope (radians). */
export function buildSkylight(o, at, down, tilt) {
  const g = new THREE.Group(), id = o.id, w = Math.max(0.3, o.width || 0.8), len = Math.max(0.3, o.height || 1.2);
  g.name = `Window ${id}`; g.userData = { openingId: id, kind: 'skylight', swing: 'top', opens: 'out', openDir: -1 };
  const dz = new THREE.Vector3(down[0] * Math.cos(tilt), -Math.sin(tilt), down[1] * Math.cos(tilt)).normalize(), up = new THREE.Vector3(down[0] * Math.sin(tilt), Math.cos(tilt), down[1] * Math.sin(tilt)).normalize();
  const dx = new THREE.Vector3().crossVectors(up, dz).normalize();
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dx, up, dz)); g.position.set(at.x, at.y + 0.02, at.z);
  const fr = (a, b, x, z, n) => { const m = box(a, 0.06, b, `Wall frame ${id} ${n}`); m.position.set(x, 0.03, z); g.add(m); };
  fr(w, FRAME, 0, -len / 2 + FRAME / 2, 't'); fr(w, FRAME, 0, len / 2 - FRAME / 2, 'b'); fr(FRAME, len, -w / 2 + FRAME / 2, 0, 'l'); fr(FRAME, len, w / 2 - FRAME / 2, 0, 'r');
  const l = new THREE.Group(); l.name = 'leaf'; l.position.set(0, 0.05, -len / 2 + FRAME); g.add(l);
  const p = box(w - FRAME * 2, 0.025, len - FRAME * 2, `Window pane ${id}`); p.position.set(0, 0, (len - FRAME * 2) / 2); l.add(p);
  if (o.coverId) { const c = new THREE.Group(); c.name = 'cover'; c.position.set(0, -0.02, -len / 2 + FRAME); g.add(c); const s = box(w - FRAME * 2, 0.01, len - FRAME * 2, `Wall blind ${id}`); s.position.set(0, 0, (len - FRAME * 2) / 2); c.add(s); c.userData.full = len - FRAME * 2; }
  return g;
}
