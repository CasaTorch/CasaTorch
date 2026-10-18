/* CasaTorch 3D Home - stairs in drawn floors: straight, L-shaped, U-shaped and spiral, climbing to the floor above
   (which gets a hole cut for them - see floorplan-drawn.js). The steps come from stairSteps() in floorplan-geom.js. */
import * as THREE from 'three';
import { stairSteps } from './floorplan-geom.js';

const TREAD = 0.05;
export function buildStairs(st, H) {
  const g = new THREE.Group(), s = stairSteps(st, H);
  g.name = `Stairs ${st.id}`; g.userData.stairId = st.id;
  s.steps.forEach((p, i) => {
    let m;
    if (p.wedge) {
      const sh = new THREE.Shape(); sh.moveTo(Math.cos(p.a0) * p.r0, Math.sin(p.a0) * p.r0); sh.lineTo(Math.cos(p.a0) * p.r1, Math.sin(p.a0) * p.r1);
      sh.absarc(0, 0, p.r1, p.a0, p.a1, p.a1 < p.a0); sh.lineTo(Math.cos(p.a1) * p.r0, Math.sin(p.a1) * p.r0); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: TREAD, bevelEnabled: false, curveSegments: 4 }); geo.rotateX(Math.PI / 2);   // shape y -> z, depth goes down
      m = new THREE.Mesh(geo); m.position.set(p.c[0], p.top, p.c[1]);
    } else {
      const solid = Math.min(p.top, 0.22);   // a thick tread: reads as a stair, with room under it
      m = new THREE.Mesh(new THREE.BoxGeometry(p.d, solid, p.w)); m.position.set(p.c[0], p.top - solid / 2, p.c[1]); m.rotation.y = -(p.rot * Math.PI) / 180;
    }
    m.name = `Stairs ${st.id} step${i}`; g.add(m);
  });
  if (s.shape === 'spiral') { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, H, 10)); pole.position.set(st.x, H / 2, st.y); pole.name = `Stairs ${st.id} pole`; g.add(pole); }
  return g;
}
