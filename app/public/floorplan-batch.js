/* Fewer draws for things that stand still. Every piece of furniture, fence, flower bed and lawn is its own few meshes
   (that is what the editor picks and drags); while you only look at the house, the pieces that never move are merged
   into one mesh per material - an old wall tablet then draws a furnished floor in a handful of calls instead of
   dozens. The pieces themselves stay in the scene, hidden, so leaving the view (or the next rebuild) puts them back.
   batchStatic(group, take, roots?): merge the children of `group` that take(child) accepts - or the given objects anywhere
   below `group` (a scan's furniture sits deep inside its model). unbatch(group): undo it.
   Meshes keep their own material (shared materials are what make merging pay off); lines are merged into one set of
   segments per material. Anything mirrored, skinned, instanced, or carrying an HTML label is left alone. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv'];
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();

function prep(geo, m) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {}; g.clearGroups(); g.applyMatrix4(m);
  return g;
}
function lineSegs(o, m) {   // a Line / LineLoop / LineSegments as segment pairs, in the group's space
  const p = o.geometry.attributes.position; if (!p) return null;
  const pts = []; const v = new THREE.Vector3(), w = new THREE.Vector3(), idx = o.geometry.index;
  const at = (i, out) => out.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m);
  const n = idx ? idx.count : p.count;
  if (o.isLineSegments) for (let i = 0; i + 1 < n; i += 2) { at(i, v); at(i + 1, w); pts.push(v.x, v.y, v.z, w.x, w.y, w.z); }
  else { for (let i = 0; i + 1 < n; i++) { at(i, v); at(i + 1, w); pts.push(v.x, v.y, v.z, w.x, w.y, w.z); } if (o.isLineLoop && n > 2) { at(n - 1, v); at(0, w); pts.push(v.x, v.y, v.z, w.x, w.y, w.z); } }
  return pts;
}

export function unbatch(group) {
  if (!group) return false;
  let any = false;
  for (const o of [...group.children]) if (o.userData.batch) { group.remove(o); o.geometry.dispose(); any = true; }
  for (const o of group.userData.batchRoots || []) if (o.userData.batched) { o.visible = true; delete o.userData.batched; any = true; }
  group.userData.batchRoots = null; group.userData.batchedAt = 0;
  return any;
}

export function batchStatic(group, take = () => true, given = null) {
  unbatch(group);
  group.updateMatrixWorld(true); _inv.copy(group.matrixWorld).invert();
  const meshB = new Map(), lineB = new Map(), roots = [];
  for (const root of given || group.children) {
    if (!root.visible || root.userData.batch || (!given && !take(root))) continue;
    const parts = []; let ok = true;
    root.traverse((o) => {
      if (!ok) return;
      if (o.isCSS2DObject || o.isInstancedMesh || o.isSkinnedMesh || o.isPoints || o.isSprite) { ok = false; return; }
      if (!o.visible) { let x = o; while (x && x !== root) { if (!x.visible) return; x = x.parent; } }
      if ((o.isMesh || o.isLine) && (Array.isArray(o.material) || !o.geometry?.attributes?.position)) { ok = false; return; }
      if (o.isMesh || o.isLine) { _m.multiplyMatrices(_inv, o.matrixWorld); if (_m.determinant() < 0) { ok = false; return; } parts.push([o, _m.clone()]); }
    });
    if (!ok || !parts.length) continue;
    for (const [o, m] of parts) {
      if (o.isMesh) {
        const k = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
        if (!meshB.has(k)) meshB.set(k, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, order: o.renderOrder, geos: [] });
        meshB.get(k).geos.push(prep(o.geometry, m));
      } else {
        const k = `${o.material.uuid}|${o.renderOrder}`, pts = lineSegs(o, m); if (!pts) continue;
        if (!lineB.has(k)) lineB.set(k, { mat: o.material, order: o.renderOrder, pts: [] });
        lineB.get(k).pts.push(...pts);
      }
    }
    roots.push(root);
  }
  /* Only worth it when it saves draws: one piece alone stays as it is. */
  if (roots.length < 2) { for (const b of meshB.values()) b.geos.forEach((g) => g.dispose()); return 0; }
  let made = 0;
  for (const b of meshB.values()) {
    const g = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false); if (b.geos.length > 1) b.geos.forEach((x) => x.dispose());
    if (!g) continue;
    const mesh = new THREE.Mesh(g, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.renderOrder = b.order;
    mesh.userData.batch = true; mesh.raycast = () => {}; mesh.name = 'batch'; group.add(mesh); made++;
  }
  for (const b of lineB.values()) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b.pts, 3));
    const l = new THREE.LineSegments(g, b.mat); l.renderOrder = b.order; l.userData.batch = true; l.raycast = () => {}; l.name = 'batch'; group.add(l); made++;
  }
  for (const r of roots) { r.visible = false; r.userData.batched = true; }
  group.userData.batchRoots = roots; group.userData.batchedAt = performance.now();
  return made;
}

/* How many draws a group costs now (visible meshes, lines and instanced meshes; one per material). */
export function drawsIn(group) {
  let n = 0;
  group.traverseVisible((o) => { if (o.isMesh || o.isLine || o.isPoints || o.isSprite) n += Array.isArray(o.material) ? o.material.length : 1; });
  return n;
}
