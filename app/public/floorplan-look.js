/* How the 3D home looks: themes, what each part of a scan is (wall, door, floor, furniture),
   room detection from Apple RoomPlan scans, and the materials that make rooms tint and
   lights glow on the floor and walls around them (all in one shader, no extra lights). */
import * as THREE from 'three';

export const THEMES = {
  neon: { label: 'Neon', bg: '#070b16', grid: ['#13304d', '#0b1a2b'], wall: '#1b2644', wallOpacity: 1, floor: '#121a30', furniture: '#2a3760', edge: '#38bdf8', door: '#f59e0b', window: '#38bdf8', furnEdge: '#5b78c0', hemi: ['#a9c8ff', '#0b1220', 1.1], sun: 0.7, tint: 0.45, glow: 1.8, flow: '#38bdf8', idleLine: '#1e3a5f' },
  blueprint: { label: 'Blueprint', bg: '#0b2a5b', grid: ['#2f5da0', '#1b4280'], wall: '#1d4a8f', wallOpacity: 0.45, floor: '#123a75', furniture: '#2a5aa5', edge: '#e8f1ff', door: '#ffd166', window: '#a5d8ff', furnEdge: '#cfe0ff', hemi: ['#ffffff', '#0b2a5b', 1.2], sun: 0.3, tint: 0.25, glow: 0.8, flow: '#ffffff', idleLine: '#5b86c5' },
  day: { label: 'Day', bg: '#dfe6ee', grid: ['#c3ccd8', '#cfd7e2'], wall: '#f3f0e9', wallOpacity: 1, floor: '#d9c8ac', furniture: '#97a3bb', edge: '#8a99b0', door: '#b7791f', window: '#7dd3fc', furnEdge: '#6b7280', hemi: ['#ffffff', '#aab4c4', 1.25], sun: 1.3, tint: 0.3, glow: 0.55, flow: '#0ea5e9', idleLine: '#94a3b8' },
};
export const COLOR_KEYS = [['bg', 'Background'], ['wall', 'Walls'], ['floor', 'Floors'], ['furniture', 'Furniture'], ['edge', 'Wall lines'], ['door', 'Doors'], ['window', 'Windows']];
export const ROOM_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#c084fc', '#4ade80', '#f97316', '#60a5fa', '#e879f9'];
export const lookOf = (theme, custom) => ({ ...THEMES[theme] || THEMES.neon, ...(custom?.[theme] || {}) });

/* Apple RoomPlan (and most apps built on it) name every part: Wall3, Door1, Window0, Floor0, Sofa2, Storage7... */
const CATS = [[/^(wall|partition)/i, 'wall'], [/^door/i, 'door'], [/^window/i, 'window'], [/^(opening|arch)/i, 'opening'], [/^floor/i, 'floor'],
  [/^(object_grp|chair|sofa|table|storage|bed|desk|toilet|sink|bathtub|bath|oven|stove|refrigerator|fridge|dishwasher|washer|dryer|fireplace|television|tv|stairs|shelf|cabinet|lamp|diningtable|coffeetable|bookshelf)/i, 'furniture']];
export function classify(mesh) {
  for (let o = mesh; o; o = o.parent) { const n = o.name || ''; for (const [re, c] of CATS) if (re.test(n)) return c; }
  return null;
}
/* Anything a scan app didn't name: guess from its shape. Returns false when the model is one
   photo-textured mesh (Polycam/Scaniverse style), which looks best in its own colours. */
export function guessCats(meshes, root) {
  const all = new THREE.Box3().setFromObject(root), H = Math.max(0.5, all.max.y - all.min.y);
  const unknown = meshes.filter((m) => !m.userData.cat);
  if (unknown.length && unknown.length === meshes.length && meshes.length <= 4) return false;
  for (const m of unknown) {
    const b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3());
    m.userData.cat = s.y < 0.2 && s.x * s.z > 2 && b.min.y < all.min.y + 0.3 ? 'floor' : s.y > H * 0.6 ? 'wall' : 'furniture';
  }
  return true;
}
/* The thing a person means when they click: "Sofa2", not its 40 sub-meshes. */
export function itemOf(mesh) {
  for (let o = mesh; o && o.parent; o = o.parent) if (/_grp$/i.test(o.parent.name || '') && !/_grp$/i.test(o.name || '')) return o;
  return mesh;
}
export const prettyItem = (n) => String(n || 'Object').replace(/[_.]/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/\s+/g, ' ').trim();

/* RoomPlan adds a "Section" marker in the middle of each room it recognised. */
const ROOM_NAMES = { livingroom: 'Living room', bedroom: 'Bedroom', bathroom: 'Bathroom', kitchen: 'Kitchen', diningroom: 'Dining room', unidentified: 'Room' };
export function sectionRooms(root, toLocal) {
  const found = [];
  root.traverse((o) => {
    if (!/^section_grp$/i.test(o.parent?.name || '')) return;
    const type = (o.name || '').replace(/\d+$/, ''), p = toLocal(o.getWorldPosition(new THREE.Vector3()));
    found.push({ type, pos: [+p.x.toFixed(2), +p.z.toFixed(2)] });
  });
  const count = {}, seen = {};
  for (const r of found) count[r.type] = (count[r.type] || 0) + 1;
  return found.map((r, i) => {
    seen[r.type] = (seen[r.type] || 0) + 1;
    const base = ROOM_NAMES[r.type.toLowerCase()] || prettyItem(r.type);
    return { name: count[r.type] > 1 || base === 'Room' ? `${base} ${seen[r.type]}` : base, color: ROOM_COLORS[i % ROOM_COLORS.length], pos: r.pos };
  });
}

/* Shared per-floor shader inputs. Rooms are matched by nearest centre; lights glow within ~4 m,
   mostly inside their own room. */
export const MAX_GLOW = 16, MAX_ROOMS = 24;
export function makeFx() {
  return {
    uGlowPos: { value: Array.from({ length: MAX_GLOW }, () => new THREE.Vector3()) }, uGlowCol: { value: Array.from({ length: MAX_GLOW }, () => new THREE.Vector3()) },
    uGlowRoom: { value: new Array(MAX_GLOW).fill(-1) }, uGlowN: { value: 0 },
    uRoomPos: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector2()) }, uRoomCol: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector3()) },
    uRoomN: { value: 0 }, uRoomSel: { value: -1 }, uDim: { value: 1 },
  };
}
export function fxMaterial(params, fx, tint = 0) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, ...params });
  m.userData.tint = { value: tint };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fx, { uTint: m.userData.tint });
    sh.vertexShader = `varying vec3 vWPos;\n${sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')}`;
    sh.fragmentShader = `varying vec3 vWPos;
uniform vec3 uGlowPos[${MAX_GLOW}]; uniform vec3 uGlowCol[${MAX_GLOW}]; uniform float uGlowRoom[${MAX_GLOW}]; uniform int uGlowN;
uniform vec2 uRoomPos[${MAX_ROOMS}]; uniform vec3 uRoomCol[${MAX_ROOMS}]; uniform int uRoomN; uniform int uRoomSel; uniform float uTint; uniform float uDim;
${sh.fragmentShader.replace('#include <dithering_fragment>', `{
  int ri = -1; float best = 1e9;
  for (int i = 0; i < ${MAX_ROOMS}; i++) { if (i >= uRoomN) break; float d = distance(vWPos.xz, uRoomPos[i]); if (d < best) { best = d; ri = i; } }
  vec3 albedo = diffuseColor.rgb;
  if (ri >= 0 && uTint > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, uRoomCol[ri] * 0.55 + gl_FragColor.rgb * 0.3, uTint);
  vec3 g = vec3(0.0);
  for (int i = 0; i < ${MAX_GLOW}; i++) { if (i >= uGlowN) break;
    float d = length((vWPos - uGlowPos[i]) * vec3(1.0, 0.45, 1.0)); float f = max(0.0, 1.0 - d / 4.0);
    float same = (uGlowRoom[i] < 0.0 || ri < 0 || float(ri) == uGlowRoom[i]) ? 1.0 : 0.2;
    g += uGlowCol[i] * f * f * same; }
  gl_FragColor.rgb += g * (0.3 + 0.7 * albedo);
  if (uRoomSel >= 0 && ri != uRoomSel) gl_FragColor.rgb *= 0.38;
  gl_FragColor.rgb *= uDim;
}
#include <dithering_fragment>`)}`;
  };
  m.customProgramCacheKey = () => 'casatorch-fx';
  return m;
}
