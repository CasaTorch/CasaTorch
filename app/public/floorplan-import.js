/* Turn whatever a scanning app exported into one .glb for CasaTorch:
   - a .glb                         -> used as is
   - a .gltf (with its .bin and textures picked together, or embedded)
   - a .usdz / .usd (Apple RoomPlan apps - the free export in many scanners)
   - an .obj (with its .mtl and textures, or inside a .zip) - the free export in most scanning apps
   - a .zip from Polycam / Scaniverse / 3D Scanner App holding either of the above
   The conversion happens in the browser (three.js GLTFLoader -> GLTFExporter), so the box only ever stores .glb. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { itemOf } from './floorplan-look.js';

const base = (n) => n.split('/').pop();
// Scans should be in meters; some apps write centimeters - scale down anything absurdly large (no house is 200 m across)
function fitUnits(scene) {
  scene.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  if (Math.max(size.x, size.y, size.z) > 200) scene.scale.multiplyScalar(0.01);
}
export async function toGlb(fileList) {
  const files = [...fileList];
  if (!files.length) throw new Error('Choose the file from your scan first.');
  const entries = new Map();
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const z = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [p, data] of Object.entries(z)) if (!p.startsWith('__MACOSX') && !p.endsWith('/') && data.length) entries.set(base(p), new Blob([data]));
    } else entries.set(f.name, f);
  }
  const glb = [...entries.keys()].find((n) => /\.glb$/i.test(n));
  if (glb) return { blob: entries.get(glb), name: glb.replace(/\.glb$/i, '') };
  const usdName = [...entries.keys()].find((n) => /\.(usdz|usdc|usda|usd)$/i.test(n));
  if (usdName && ![...entries.keys()].some((n) => /\.(gltf|obj)$/i.test(n))) {
    try {
      const scene = new USDLoader().parse(await entries.get(usdName).arrayBuffer());
      fitUnits(scene);
      const out = await new GLTFExporter().parseAsync(scene, { binary: true });
      return { blob: new Blob([out], { type: 'model/gltf-binary' }), name: usdName.replace(/\.[^.]+$/, '') };
    } catch (e) { throw new Error(`Could not read that USDZ (${e.message || e}). Try exporting the scan as GLB or OBJ instead.`); }
  }
  const gltfName = [...entries.keys()].find((n) => /\.gltf$/i.test(n));
  const objName = [...entries.keys()].find((n) => /\.obj$/i.test(n));
  if (!gltfName && !objName) throw new Error('No 3D model found. Export your scan as USDZ, GLB, GLTF or OBJ, then pick the file (or the .zip, or the model together with its .mtl/.bin and image files).');
  const urls = new Map([...entries].map(([n, b]) => [n, URL.createObjectURL(b)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => { if (url.startsWith('data:')) return url; const n = decodeURIComponent(base(url).split('?')[0]); return urls.get(n) || url; });
  try {
    let scene, name;
    if (gltfName) { scene = (await new GLTFLoader(manager).loadAsync(urls.get(gltfName))).scene; name = gltfName.replace(/\.gltf$/i, ''); }
    else {
      const obj = new OBJLoader(manager);
      const mtlName = [...entries.keys()].find((n) => /\.mtl$/i.test(n));
      if (mtlName) { const m = await new MTLLoader(manager).loadAsync(urls.get(mtlName)); m.preload(); obj.setMaterials(m); }
      scene = await obj.loadAsync(urls.get(objName)); name = objName.replace(/\.obj$/i, '');
      fitUnits(scene);
    }
    const out = await new GLTFExporter().parseAsync(scene, { binary: true });
    return { blob: new Blob([out], { type: 'model/gltf-binary' }), name };
  } catch (e) {
    throw new Error(`Could not read that model (${e.message || e}). If the scan came as several files, select the .gltf, .bin and image files together - or upload the .zip.`);
  } finally { for (const u of urls.values()) URL.revokeObjectURL(u); }
}

/* Rooms scanned one at a time, joined into one floor: each part's model with the turn, size and place it
   was fitted to, in one .glb. A joined room's names get a short tag so its walls and furniture stay
   separate from the floor's own (hiding or painting one doesn't touch the other); RoomPlan's group and
   room markers keep their names, so walls, doors and rooms are still recognized. Parts hidden on the
   room are left out. */
export async function mergeGlb(parts) {
  const loader = new GLTFLoader(), root = new THREE.Group(); root.name = 'house';
  for (const p of parts) {
    const g = (await loader.loadAsync(p.url)).scene;
    if (p.hidden?.length) {
      const gone = new Set(p.hidden), meshes = []; g.traverse((o) => { if (o.isMesh) meshes.push(o); });
      meshes.forEach((m, i) => { if (gone.has(itemOf(m).name || m.name || `mesh${i}`)) m.parent?.remove(m); });
    }
    if (p.tag) g.traverse((o) => { if (o.name && !/_grp(_\d+)?$/i.test(o.name) && !/^section_grp(_\d+)?$/i.test(o.parent?.name || '')) o.name = `${o.name}_${p.tag}`; });
    const w = new THREE.Group(); w.position.set(p.pos[0], 0, p.pos[1]); w.rotation.y = p.rotY || 0; w.scale.setScalar(p.scale || 1); w.add(g); root.add(w);
  }
  const out = await new GLTFExporter().parseAsync(root, { binary: true });
  return new Blob([out], { type: 'model/gltf-binary' });
}
