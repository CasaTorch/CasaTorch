/* Turn whatever a scanning app exported into one .glb for HouseOS:
   - a .glb                         -> used as is
   - a .gltf (with its .bin and textures picked together, or embedded)
   - an .obj (with its .mtl and textures, or inside a .zip) - the free export in most scanning apps
   - a .zip from Polycam / Scaniverse / 3D Scanner App holding either of the above
   The conversion happens in the browser (three.js GLTFLoader -> GLTFExporter), so the box only ever stores .glb. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

const base = (n) => n.split('/').pop();
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
  const gltfName = [...entries.keys()].find((n) => /\.gltf$/i.test(n));
  const objName = [...entries.keys()].find((n) => /\.obj$/i.test(n));
  if (!gltfName && !objName) throw new Error('No 3D model found. Export your scan as GLB, GLTF or OBJ, then pick the file (or the .zip, or the model together with its .mtl/.bin and image files).');
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
      // OBJ has no unit; scans are in meters but some apps write centimeters - scale down anything absurdly large
      const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) > 200) scene.scale.setScalar(0.01);
    }
    const out = await new GLTFExporter().parseAsync(scene, { binary: true });
    return { blob: new Blob([out], { type: 'model/gltf-binary' }), name };
  } catch (e) {
    throw new Error(`Could not read that model (${e.message || e}). If the scan came as several files, select the .gltf, .bin and image files together - or upload the .zip.`);
  } finally { for (const u of urls.values()) URL.revokeObjectURL(u); }
}
