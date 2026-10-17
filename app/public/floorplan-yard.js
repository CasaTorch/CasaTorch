/* The yard around the 3D house: areas you draw (grass, driveway, patio, path, garden beds, a pool)
   and things you place (trees, pines, bushes, cars, an EV charger). Trees and cars cast real sun
   shadows, so the sun on the plan finally knows about the big oak out front.
   A car can be linked to your car's own sensors (Tesla, or any EV Home Assistant knows): it sits in
   the driveway when the car is home, fades out when it's away, and while it charges a glowing cable
   runs from the charger with current flowing into it. Shown only - CasaTorch never controls the car. */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const AREA_KINDS = { grass: ['Grass', '#4f7d3a'], driveway: ['Driveway', '#5f6670'], patio: ['Patio / deck', '#9c8b78'], path: ['Path', '#c9c2b8'], garden: ['Garden bed', '#5a3c2a'], pool: ['Pool', '#2fa4d6'] };
export const ITEM_KINDS = { tree: 'Tree', pine: 'Pine', bush: 'Bush', car: 'Car', charger: 'EV charger' };
const LIFT = { grass: 0.004, garden: 0.012, driveway: 0.008, patio: 0.016, path: 0.02, pool: 0.024 };
const PAINT = { night: 0.5, blueprint: 0.42, day: 1, real: 1 };

/* ---- shared, cached geometry (one tree shape for every tree) ---- */
const G = {};
const geo = (k, make) => (G[k] ||= make());
function carBody(suv) {
  const s = new THREE.Shape(), h = suv ? 1.12 : 1;
  const p = suv ? [[-2.35, .32], [2.35, .32], [2.42, .82], [1.75, .95], [1.0, 1.62], [-2.05, 1.66], [-2.38, 1.2], [-2.42, .9]]
    : [[-2.35, .3], [2.35, .3], [2.42, .74], [1.6, .86], [.72, 1.4 * h], [-.9, 1.42 * h], [-1.9, .96], [-2.4, .86]];
  s.moveTo(...p[0]); for (const q of p.slice(1)) s.lineTo(...q); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.76, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 2 }); g.translate(0, 0, -.88); return g;
}
function carGlass(suv) {
  const s = new THREE.Shape(), p = suv ? [[1.62, .98], [.98, 1.56], [-1.95, 1.6], [-2.24, 1.2], [-2.2, .98]] : [[1.45, .9], [.7, 1.36], [-.86, 1.38], [-1.76, .98]];
  s.moveTo(...p[0]); for (const q of p.slice(1)) s.lineTo(...q); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.84, bevelEnabled: false }); g.translate(0, 0, -.92); return g;
}

function makeTree(kind, mats) {
  const g = new THREE.Group();
  if (kind === 'pine') {
    const trunk = new THREE.Mesh(geo('ptrunk', () => new THREE.CylinderGeometry(.12, .16, 1.2, 7).translate(0, .6, 0)), mats.bark); g.add(trunk);
    [[1.5, 1.5, 1.1], [1.15, 1.35, 2.0], [.8, 1.2, 2.8]].forEach(([r, h, y], i) => g.add(new THREE.Mesh(geo(`cone${i}`, () => new THREE.ConeGeometry(r, h, 8).translate(0, y, 0)), mats.pine)));
  } else if (kind === 'bush') {
    g.add(new THREE.Mesh(geo('bush', () => new THREE.IcosahedronGeometry(.6, 1).scale(1, .72, 1).translate(0, .4, 0)), mats.leaf));
  } else {
    g.add(new THREE.Mesh(geo('trunk', () => new THREE.CylinderGeometry(.14, .2, 2.2, 7).translate(0, 1.1, 0)), mats.bark));
    [[0, 3.0, 0, 1.35], [.75, 2.6, .3, 1.0], [-.65, 2.7, -.35, 1.05], [.1, 2.5, -.8, .9]].forEach(([x, y, z, r], i) => g.add(new THREE.Mesh(geo(`can${i}`, () => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z)), mats.leaf)));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
function makeCar(it, mats) {
  const g = new THREE.Group(), suv = it.body === 'suv';
  const paint = new THREE.MeshStandardMaterial({ color: it.color || '#cfd6df', roughness: .35, metalness: .4, transparent: true });
  const body = new THREE.Mesh(geo(suv ? 'suvBody' : 'carBody', () => carBody(suv)), paint);
  const glass = new THREE.Mesh(geo(suv ? 'suvGlass' : 'carGlass', () => carGlass(suv)), mats.glass.clone()), tire = mats.tire.clone();
  g.add(body, glass);
  for (const [x, z] of [[1.45, .86], [1.45, -.86], [-1.45, .86], [-1.45, -.86]]) { const w = new THREE.Mesh(geo('wheel', () => new THREE.CylinderGeometry(.34, .34, .24, 16).rotateX(Math.PI / 2)), tire); w.position.set(x, .34, z); g.add(w); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.paint = paint; g.userData.port = new THREE.Vector3(-2.2, .82, .95);   // rear left, where most EVs (Tesla included) plug in
  return g;
}
function makeCharger(mats) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(geo('cpost', () => new THREE.BoxGeometry(.12, 1.1, .12).translate(0, .55, 0)), mats.tire);
  const box = new THREE.Mesh(geo('cbox', () => new THREE.BoxGeometry(.32, .42, .14).translate(0, 1.15, 0)), mats.charger);
  g.add(post, box); g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.plug = new THREE.Vector3(0, 1.05, .1);
  return g;
}

export class Yard {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); this.group.name = 'yard'; scene.add(this.group); this.cars = []; this.labels = []; this.trees = []; this.y = 0; }
  clear() {
    for (const l of this.labels) { l.parent?.remove(l); l.element.remove(); }
    this.labels = []; this.cars = []; this.trees = [];
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((x) => { if (x.isMesh && !Object.values(G).includes(x.geometry)) x.geometry.dispose(); }); }
  }
  /* yard: { areas: [{ kind, pts: [[x, z]...] }], items: [{ id, kind, pos: [x, z], rot, scale, ... }] }; y: ground height (world) */
  build(yard, y, theme, el) {
    this.clear(); this.y = y;
    const k = PAINT[theme] ?? .6, tint = (hex) => new THREE.Color(hex).multiplyScalar(k);
    const mats = {
      bark: new THREE.MeshStandardMaterial({ color: tint('#6b4a32'), roughness: .95 }), leaf: new THREE.MeshStandardMaterial({ color: tint('#3f7f3a'), roughness: .9, flatShading: true }),
      pine: new THREE.MeshStandardMaterial({ color: tint('#2f5d3a'), roughness: .9, flatShading: true }), glass: new THREE.MeshStandardMaterial({ color: '#0d1420', roughness: .15, metalness: .6, transparent: true }),
      tire: new THREE.MeshStandardMaterial({ color: '#16181c', roughness: .8, transparent: true }), charger: new THREE.MeshStandardMaterial({ color: '#e8ecf2', roughness: .4, emissive: '#38bdf8', emissiveIntensity: .25 }),
    };
    this.mats = mats;
    for (const a of yard?.areas || []) {
      if (!AREA_KINDS[a.kind] || (a.pts || []).length < 3) continue;
      const s = new THREE.Shape(a.pts.map(([x, z]) => new THREE.Vector2(x, -z)));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: tint(AREA_KINDS[a.kind][1]), roughness: a.kind === 'pool' ? .1 : .95, metalness: a.kind === 'pool' ? .2 : 0, ...(a.kind === 'pool' ? { emissive: '#0e7490', emissiveIntensity: theme === 'day' ? .15 : .5 } : {}), polygonOffset: true, polygonOffsetFactor: -1 }));
      m.position.y = y + (LIFT[a.kind] || .01); m.receiveShadow = true; m.userData.yard = { area: a.id }; this.group.add(m);
      if (theme !== 'day') { const e = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(a.pts.map(([x, z]) => new THREE.Vector3(x, 0, z))), new THREE.LineBasicMaterial({ color: tint(AREA_KINDS[a.kind][1]).multiplyScalar(2.2), transparent: true, opacity: .6 })); e.position.y = m.position.y + .005; e.raycast = () => {}; this.group.add(e); }
    }
    for (const it of yard?.items || []) {
      if (!ITEM_KINDS[it.kind]) continue;
      let o = it.kind === 'car' ? makeCar(it, mats) : it.kind === 'charger' ? makeCharger(mats) : makeTree(it.kind, mats);
      if (!['car', 'charger'].includes(it.kind)) { const inner = o; o = new THREE.Group(); o.add(inner); this.trees.push({ o, inner, kind: it.kind, ph: Math.random() * 6.283, ph2: Math.random() * 6.283, f: 0.55 + Math.random() * 0.35, leaves: inner.children.slice(1) }); }
      o.position.set(it.pos[0], y, it.pos[1]); o.rotation.y = THREE.MathUtils.degToRad(it.rot || 0); if (it.kind !== 'car' && it.kind !== 'charger') o.scale.setScalar(it.scale || 1);
      o.userData.yard = { item: it.id }; this.group.add(o); o.updateMatrixWorld(true);
      if (it.kind === 'car') {
        const lab = new CSS2DObject(el('div', { class: 'carlab' })); lab.position.set(0, 2.1, 0); o.add(lab); this.labels.push(lab);
        this.cars.push({ it, o, lab });
      }
      if (it.kind === 'charger') this.charger = o;
    }
    return this;
  }
  /* Wind: every tree leans with the real wind and sways, harder in gusts; pines are stiffer, bushes barely move.
     windMs: metres per second; toward: the direction the wind blows TO, as a world-space unit vector. */
  wind(t, windMs, toward) {
    if (!this.trees.length) return;
    const w = Math.max(0, Math.min(30, windMs || 0)), base = Math.min(0.16, w * 0.0085), gust = 0.65 + 0.35 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.3);
    for (const tr of this.trees) {
      const stiff = tr.kind === 'pine' ? 0.55 : tr.kind === 'bush' ? 0.35 : 1, a = base * stiff;
      const sway = a * (0.55 + 0.45 * gust) + a * 0.35 * Math.sin(t * tr.f * (1 + w / 12) + tr.ph) + a * 0.12 * Math.sin(t * tr.f * 2.7 + tr.ph2);
      const ang = Math.atan2(toward.x, toward.z) - tr.o.rotation.y;   // the wind in this tree's own frame
      tr.inner.rotation.x = sway * Math.cos(ang); tr.inner.rotation.z = -sway * Math.sin(ang);
      const flutter = Math.min(0.06, w * 0.004);   // leaves shiver on top of the lean
      tr.leaves.forEach((m, i) => { m.rotation.x = flutter * Math.sin(t * (3.1 + i) + tr.ph + i); m.rotation.z = flutter * Math.sin(t * (2.6 + i * 0.7) + tr.ph2); });
    }
  }
  get box() { return new THREE.Box3().setFromObject(this.group); }
  set visible(v) { this.group.visible = v; for (const l of this.labels) l.visible = v; }
  /* Live car states -> how each car looks; returns power lines for the charging cables (drawn by PowerNet). */
  live(states, el, fmtW) {
    const lines = [];
    for (const c of this.cars) {
      const s = states?.[c.it.id] || {}, away = s.home === false, charging = !away && (s.powerW ?? 0) > 50, plugged = !away && (s.plugged || charging);
      c.o.traverse((x) => { if (x.isMesh) { x.material.opacity = away ? .14 : 1; x.material.depthWrite = !away; x.castShadow = !away; } });
      const bits = [s.battery != null ? `${Math.round(s.battery)}%` : null, away ? 'Away' : charging ? `Charging ${fmtW(s.powerW)}` : plugged ? 'Plugged in' : null].filter(Boolean);
      c.lab.element.replaceChildren(...[el('b', {}, c.it.name || 'Car'), bits.length ? el('small', {}, bits.join(' · ')) : null].filter(Boolean));
      c.lab.element.className = `carlab${charging ? ' charging' : ''}${away ? ' away' : ''}`;
      if (plugged && this.charger) {
        const a = this.charger.localToWorld(this.charger.userData.plug.clone()), b = c.o.localToWorld(c.o.userData.port.clone()), gy = this.y + .03;
        lines.push({ on: charging, watts: s.powerW || 0, color: charging ? '#34d399' : null, pts: [a, new THREE.Vector3(a.x, gy, a.z), new THREE.Vector3(b.x, gy, b.z), b] });
      }
    }
    return lines;
  }
}
