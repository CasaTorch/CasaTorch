/* The "Real life" look, made to look real: light from the sky itself (an environment drawn from the current sky
   colors, so surfaces pick up blue from above and warm light at sunset), wood floors and plaster walls with a
   believable sheen, glass that reflects the sky, softer sun shadows, and on High quality a gentle contact shadow in
   corners and under furniture (ambient occlusion). The drawings (Blueprint, Day) stay flat on purpose.
   Called from floorplan.js: initReal() once, applyReal() after every look change, realSky() when the sky changes,
   renderReal() in place of the plain draw (returns false when the plain draw should be used). Nothing here runs
   per frame except the draw itself; textures are made once, in code (no downloads). */
import * as THREE from 'three';

let R = null;   // { renderer, scene, camera, sun, pmrem, env, envScene, envMat, comp, gtao, real, high }
let daylightK = 1;
export const daylight = () => daylightK;
export function initReal(ctx) { R = { ...ctx, pmrem: null, env: null, lastSky: null, skyAt: 0, real: false, high: false, comp: null, qAt: 0, last: null }; }

/* ---- the sky as light: a small scene (a sphere colored like the sky, the ground below, a bright sun) blurred into an environment map ---- */
function envScene() {
  if (R.envScene) return R.envScene;
  const s = new THREE.Scene();
  R.envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#3f78c8') }, horizon: { value: new THREE.Color('#cfe3f3') }, ground: { value: new THREE.Color('#5a6248') }, sunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) }, sunCol: { value: new THREE.Color('#fff4e0') }, sunK: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, horizon, ground, sunDir, sunCol; uniform float sunK; varying vec3 vDir;
      void main() { float y = vDir.y; vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, ground, min(1.0, -y * 6.0));
        float s = max(0.0, dot(normalize(vDir), normalize(sunDir))); c += sunCol * sunK * (pow(s, 64.0) * 6.0 + pow(s, 6.0) * 0.35);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), R.envMat));
  R.envScene = s; return s;
}
const same = (a, b) => a && b && Math.abs(a[0] - b[0]) < 0.04 && Math.abs(a[1] - b[1]) < 0.04 && Math.abs(a[2] - b[2]) < 0.04;
/* top, horizon: THREE.Color; night 0..1; sunDir: the direction to the sun (world). Rebuilt only when the sky really changed. */
export function realSky(top, horizon, night, sunDir) {
  if (!R) return;
  daylightK = Math.max(0.28, 1 - night * 0.72);
  if (!R.real) return;
  const key = [top.r + horizon.r, top.g + horizon.g, top.b + horizon.b], now = performance.now();
  if (R.env && (same(key, R.lastSky) && Math.abs((R.lastNight ?? -1) - night) < 0.05 || now - R.skyAt < 4000)) { R.scene.environmentIntensity = envIntensity(night); return; }
  R.lastSky = key; R.lastNight = night; R.skyAt = now;
  envScene(); R.envMat.uniforms.top.value.copy(top); R.envMat.uniforms.horizon.value.copy(horizon);
  R.envMat.uniforms.ground.value.set('#4d5640').multiplyScalar(0.35 + 0.65 * (1 - night));
  if (sunDir) R.envMat.uniforms.sunDir.value.copy(sunDir); R.envMat.uniforms.sunK.value = Math.max(0, sunDir?.y ?? 0.5) > 0.02 ? 1 - night : 0;
  R.pmrem ||= new THREE.PMREMGenerator(R.renderer);
  const rt = R.pmrem.fromScene(R.envScene, 0.02, 0.1, 100);
  R.envRT?.dispose(); R.envRT = rt; R.env = rt.texture;
  R.scene.environment = R.env; R.scene.environmentIntensity = envIntensity(night);
}
const envIntensity = (night) => (0.18 + 0.42 * (1 - night)) * (R.high ? 1 : 0.85);

/* ---- surfaces: drawn in code once (a few hundred KB of graphics memory), sized in meters ---- */
const TEX = {};
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
function canvasTex(w, h, paint, color = true) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }); paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, R.renderer.capabilities.getMaxAnisotropy()); if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/* Wood planks, 2 m square: 11 boards across, staggered joints, grain; near-white so the theme's floor color shows through. */
function wood() {
  return TEX.wood ||= canvasTex(1024, 1024, (g, w, h) => {
    const rows = 11, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * w * 0.6;
      while (x < w) {
        const len = w * (0.35 + rnd() * 0.45), v = 214 + rnd() * 41 | 0, warm = rnd() * 10 | 0;
        g.fillStyle = `rgb(${v},${v - warm},${v - warm * 2})`; g.fillRect(x, r * rh, len, rh);
        for (let k = 0; k < 9; k++) { const y = r * rh + rnd() * rh, a = 0.04 + rnd() * 0.07; g.strokeStyle = `rgba(70,45,25,${a})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 6, x + len * 0.7, y + (rnd() - 0.5) * 6, x + len, y + (rnd() - 0.5) * 4); g.stroke(); }
        g.fillStyle = 'rgba(40,25,15,0.35)'; g.fillRect(x, r * rh, 2, rh);
        x += len;
      }
      g.fillStyle = 'rgba(40,25,15,0.4)'; g.fillRect(0, r * rh, w, 2);
    }
  });
}
function woodRough() {
  return TEX.woodR ||= canvasTex(256, 256, (g, w, h) => { g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2500; i++) { const v = 120 + rnd() * 70 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 12, 1 + rnd() * 2); } }, false);
}
/* Plaster: a soft, uneven matte finish. */
function plaster() {
  return TEX.plaster ||= canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#f7f7f7'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { const v = 228 + rnd() * 27 | 0; g.fillStyle = `rgba(${v},${v},${v},0.5)`; const r = 1 + rnd() * 4; g.fillRect(rnd() * w, rnd() * h, r, r); } });
}
/* Box mapping: picture positions from where each point is (meters / tile), along the side it faces - floors get boards
   the right size whatever shape the floor is. Done once per shape. */
function boxUV(mesh, tile) {
  const g = mesh.geometry; if (!g?.attributes?.position || g.userData.boxUV === tile) return;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, s = mesh.getWorldScale(new THREE.Vector3()), uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i) * s.x / tile, y = p.getY(i) * s.y / tile, z = p.getZ(i) * s.z / tile;
    if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; } else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; } else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.userData.boxUV = tile;
}
function setMaps(m, maps) {
  let changed = false;
  for (const [k, v] of Object.entries(maps)) if (m[k] !== v) { m[k] = v; changed = true; }
  if (changed) m.needsUpdate = true;
}
/* After every look change: real surfaces and sky light in Real life (not on the lowest quality), flat drawings otherwise. */
export function applyReal(args) {
  if (!R) return;
  const { real, floors, quality, edit } = args; R.last = args;
  const on = real && !edit && quality !== 'low';
  if (!real) daylightK = 1;
  R.real = on; R.high = on && quality === 'high';
  if (!on) { R.scene.environment = null; R.lastSky = null; }
  const sh = R.sun.shadow;
  sh.radius = R.high ? 4 : on ? 2.5 : 1;   // softer edges, like a real sun's
  const size = R.high ? 4096 : 2048; if (sh.mapSize.x !== size && R.renderer.capabilities.maxTextureSize >= size) { sh.mapSize.set(size, size); sh.map?.dispose(); sh.map = null; }
  for (const F of Object.values(floors)) {
    if (F.original || !F.mats) continue;
    const M = F.mats, W = F.low, list = [M, W];
    if (on) {
      for (const [, meshes] of F.items) for (const m of meshes) {
        const c = m.userData.cat; if (m.userData.floorTex || (m.material !== M[c] && m.material !== W[c])) continue;   // its own paint or floor picture: left as it is
        if (c === 'floor') boxUV(m, 2); else if (c === 'wall') boxUV(m, 1.5); else if (c === 'door') boxUV(m, 2);
      }
      for (const S of list) {
        if (S.floor) { setMaps(S.floor, { map: wood(), roughnessMap: woodRough() }); S.floor.roughness = 0.62; S.floor.envMapIntensity = 0.9; }
        if (S.wall) { setMaps(S.wall, { map: plaster(), roughnessMap: null }); S.wall.roughness = 0.92; S.wall.envMapIntensity = 0.6; }
        if (S.door) { setMaps(S.door, { map: wood() }); S.door.roughness = 0.55; }
        if (S.furniture) { S.furniture.roughness = 0.7; S.furniture.envMapIntensity = 0.7; }
        if (S.window) { S.window.roughness = 0.05; S.window.metalness = 0.1; S.window.envMapIntensity = 1.6; }
      }
    } else {
      for (const S of list) {
        for (const k of ['floor', 'wall', 'door']) if (S[k]) setMaps(S[k], { map: null, roughnessMap: null });
        for (const k of ['floor', 'wall', 'door', 'furniture', 'window']) if (S[k]) { S[k].roughness = 0.85; S[k].metalness = 0; S[k].envMapIntensity = 1; }
      }
    }
  }
  if (!R.high) dropComposer();
}

/* ---- the draw: plain, or (High quality, Real life) with soft contact shadows ---- */
let compSize = null;
async function makeComposer() {
  if (R.compLoading || R.comp) return;
  R.compLoading = true;
  try {
    const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'), import('three/addons/postprocessing/GTAOPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
    if (!R.high) return;
    const size = R.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y); rt.depthTexture.type = THREE.UnsignedIntType;
    const comp = new EffectComposer(R.renderer, rt); comp.setPixelRatio(1); comp.setSize(size.x, size.y);
    comp.addPass(new RenderPass(R.scene, R.camera));
    /* Depth from the real picture (so cut-away walls and the scan's lowered parts don't cast it), normals from that depth. */
    const g = new GTAOPass(R.scene, R.camera, size.x, size.y);
    g.setGBuffer(comp.renderTarget2.depthTexture);
    g.output = GTAOPass.OUTPUT.Default; g.blendIntensity = 0.75;
    g.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1, scale: 1, samples: 12 });
    g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    comp.addPass(g); comp.addPass(new OutputPass());
    R.comp = comp; R.gtao = g; compSize = size;
  } catch { R.noComp = true; } finally { R.compLoading = false; }
}
function dropComposer() { if (!R?.comp) return; R.comp.renderTarget1.dispose(); R.comp.renderTarget2.dispose(); R.gtao.dispose(); R.comp = null; R.gtao = null; }
const _sz = new THREE.Vector2();
export function renderReal(scene, camera) {
  if (!R) return false;
  const now = performance.now();
  if (R.quality && R.last && now - R.qAt > 2000) { R.qAt = now; const q = R.quality(); if (q !== R.last.quality) applyReal({ ...R.last, quality: q }); }   // the quality level was changed (View menu, or stepped down on a slow screen)
  if (!R.high || R.noComp) return false;
  if (!R.comp) { makeComposer(); return false; }
  R.renderer.getDrawingBufferSize(_sz);
  if (_sz.x !== compSize.x || _sz.y !== compSize.y) { compSize.copy(_sz); R.comp.setSize(_sz.x, _sz.y); R.gtao.setSize(_sz.x, _sz.y); R.gtao.setGBuffer(R.comp.renderTarget2.depthTexture); }
  R.comp.render();
  return true;
}
