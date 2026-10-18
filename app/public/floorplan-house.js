/* The things that make the 3D plan read as a house: a roof over the top floor, and the power
   running from the electrical panel to every device - glowing lines with current flowing along
   them while the device is on, faster the more it draws. */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { roofShape, offsetPoly } from './floorplan-geom.js';
import { roofOn, roofParams, wallHeight, buildSkylightFor } from './floorplan-drawn.js';
const TT = (s) => (typeof window !== 'undefined' && typeof window.T === 'function' ? window.T(s) : s);   // the home's language (i18n.js)

/* ---------- roof: a gable over the top floor's footprint, with a little overhang ---------- */
const ROOF = { real: ['#55595f', '#3c3f45', 1], night: ['#1e2b4f', '#38bdf8', 0.92], blueprint: ['#1d4a8f', '#e8f1ff', 0.35], day: ['#8a5a44', '#5c3a2c', 1] };
export function buildRoof(box, theme, custom) {
  const [themeColor, edge, opacity] = ROOF[theme] || ROOF.real, color = custom || themeColor;
  const over = 0.35, x0 = box.min.x - over, x1 = box.max.x + over, z0 = box.min.z - over, z1 = box.max.z + over, y = box.max.y + 0.02;
  const alongX = x1 - x0 >= z1 - z0, span = alongX ? z1 - z0 : x1 - x0, rise = Math.min(2.4, span * 0.3);
  const P = [];
  const quad = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d);
  if (alongX) {
    const zm = (z0 + z1) / 2;
    quad([x0, y, z0], [x1, y, z0], [x1, y + rise, zm], [x0, y + rise, zm]);
    quad([x1, y, z1], [x0, y, z1], [x0, y + rise, zm], [x1, y + rise, zm]);
    P.push(x0, y, z1, x0, y, z0, x0, y + rise, zm, x1, y, z0, x1, y, z1, x1, y + rise, zm);
  } else {
    const xm = (x0 + x1) / 2;
    quad([x1, y, z0], [x1, y, z1], [xm, y + rise, z1], [xm, y + rise, z0]);
    quad([x0, y, z1], [x0, y, z0], [xm, y + rise, z0], [xm, y + rise, z1]);
    P.push(x0, y, z0, x1, y, z0, xm, y + rise, z0, x1, y, z1, x0, y, z1, xm, y + rise, z1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.8 })));
  m.raycast = () => {}; m.userData.roof = true;
  return m;
}

/* ---------- a drawn floor's own roof: Flat / Gable / Hip, with its pitch and overhang (set in the drawing editor) ----------
   Built in the floor's plan (meters, y down the page = z), to sit in the drawn floor's own group. A flat roof follows each room's
   outline (grown by the overhang); a gable or hip roof covers the outline's box. Returns null when the floor has no roof. */
export function buildPlanRoof(f, floors, theme, custom) {
  if (!roofOn(f, floors)) return null;
  const R = roofParams(f); if (!R) return null;
  const [themeColor, edge, opacity] = ROOF[theme] || ROOF.real, color = custom || themeColor, y = wallHeight(f) + 0.02, P = [];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  const g = new THREE.Group(); g.userData.roof = true; g.name = 'Roof';
  if (R.type === 'flat') {
    const rooms = R.plan.rooms.length ? R.plan.rooms.map((r) => r.pts) : [[[R.box.x0, R.box.z0], [R.box.x1, R.box.z0], [R.box.x1, R.box.z1], [R.box.x0, R.box.z1]]];
    rooms.forEach((pts, i) => {
      const o = R.plan.rooms.length ? offsetPoly(pts, R.overhang) : pts, sh = new THREE.Shape(o.map(([x, z]) => new THREE.Vector2(x, z)));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.15, bevelEnabled: false }); geo.rotateX(Math.PI / 2); geo.translate(0, y + 0.15 + i * 0.002, 0);   // a hair apart: no flicker where they overlap
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.raycast = () => {}; g.add(m);
    });
    addSkylights(g, f, R); return g;
  }
  const rs = roofShape(R.box, y, R.type, R.pitch);
  for (const t of rs.tris) for (const v of t) P.push(...v);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.raycast = () => {};
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.8 })));
  g.add(m); addSkylights(g, f, R); return g;
}
/* Roof windows sit in the roof, so they lift away with it. Glass and frame get their own look here (the roof is built after the
   floor is styled); each is still a "Window <id>" group with its 'leaf', like every other opening. */
function addSkylights(g, f, R) {
  for (const o of R.plan.openings) {
    if (o.kind !== 'skylight') continue;
    const s = buildSkylightFor(f, o, R); if (!s) continue;
    s.traverse((x) => { if (x.isMesh) { const glass = /pane/i.test(x.name); x.material = new THREE.MeshStandardMaterial({ color: glass ? '#9fd0ee' : '#e9e6df', roughness: glass ? 0.15 : 0.8, transparent: glass, opacity: glass ? 0.55 : 1 }); x.raycast = () => {}; } });
    g.add(s);
  }
}

/* ---------- power lines ---------- */
let pulseTex = null;
function pulseTexture() {
  if (pulseTex) return pulseTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 4;
  const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.8, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.18)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 4);
  pulseTex = new THREE.CanvasTexture(c); pulseTex.wrapS = pulseTex.wrapT = THREE.RepeatWrapping; pulseTex.colorSpace = THREE.SRGBColorSpace;
  return pulseTex;
}
const polyline = (pts) => { const path = new THREE.CurvePath(); for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i])); return path; };
export class PowerNet {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); this.group.renderOrder = 2; scene.add(this.group); this.flows = []; this.label = null; }
  clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((x) => { x.geometry?.dispose(); x.material?.map?.dispose(); x.material?.dispose(); }); }   // the panel box's outline too
    this.flows = [];
    if (this.label) { this.label.parent?.remove(this.label); this.label.element.remove(); this.label = null; }
  }
  /* lines: [{ pts: [Vector3...], on, watts }], panel: Vector3 (world), totalW, el(): DOM helper */
  update(lines, panel, totalW, el, look) {
    this.clear();
    const live = new THREE.Color(look.flow || '#38bdf8'), idle = new THREE.Color(look.idleLine || '#334155');
    for (const ln of lines) {
      const pts = ln.pts.filter((p, i, a) => i === 0 || p.distanceToSquared(a[i - 1]) > 1e-4);
      if (pts.length < 2) continue;
      const path = polyline(pts), len = path.getLength(), segs = Math.max(8, Math.round(len * 6));
      const geo = new THREE.TubeGeometry(path, segs, ln.on ? 0.035 : 0.018, 6, false);
      let mat;
      if (ln.on) {
        const tex = pulseTexture().clone(); tex.needsUpdate = true; tex.repeat.set(Math.max(1, len / 0.9), 1);
        mat = new THREE.MeshBasicMaterial({ color: ln.color ? new THREE.Color(ln.color) : live, map: tex, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
        // Faster flow for more watts: ~0.25 m/s at a few watts up to ~2.5 m/s at a kettle.
        const speed = 0.25 + Math.min(2.2, Math.log10(1 + (ln.watts ?? 40)) * 0.7);
        this.flows.push({ tex, k: speed / 0.9 });
      } else mat = new THREE.MeshBasicMaterial({ color: idle, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false });
      const m = new THREE.Mesh(geo, mat); m.raycast = () => {}; m.renderOrder = ln.on ? 11 : 10; this.group.add(m);   // drawn over walls, like wiring in a cutaway
    }
    if (panel) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.12), new THREE.MeshBasicMaterial({ color: live, transparent: true, opacity: 0.35 }));
      box.position.copy(panel).add(new THREE.Vector3(0, 0.3, 0)); box.raycast = () => {};
      box.add(new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: live })));
      this.group.add(box);
      const kw = totalW >= 1000 ? `${(totalW / 1000).toFixed(1)} kW` : `${Math.round(totalW || 0)} W`;
      this.label = new CSS2DObject(el('div', { class: 'panellab' }, el('small', {}, TT('Total now')), el('b', {}, kw)));
      this.label.position.copy(panel).add(new THREE.Vector3(0, 1.1, 0)); this.scene.add(this.label);
    }
  }
  set visible(v) { this.group.visible = v; if (this.label) this.label.visible = v; }
  /* t in seconds since the page opened: the flow keeps its phase when the lines are rebuilt. */
  tick(t) { for (const f of this.flows) f.tex.offset.x = -((f.k * t) % 1); }
}

/* ---------- weather icons (our own simple line drawings) ---------- */
const W = {
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  partly: '<path d="M8 3v1.5M3.5 8H2M4.6 4.6l1 1M12.4 4.6l-1 1"/><circle cx="8" cy="8.5" r="3"/><path d="M8 20h9a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4 1.6A3.2 3.2 0 0 0 8 20z"/>',
  cloud: '<path d="M7 19h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 11.5 3.8 3.8 0 0 0 7 19z"/>',
  rain: '<path d="M7 15h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 7.5 3.8 3.8 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M7 15h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 7.5 3.8 3.8 0 0 0 7 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01"/>',
  storm: '<path d="M7 15h10a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6 7.5 3.8 3.8 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
};
export const weatherIcon = (kind) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${W[kind] || W.cloud}</svg>`;

/* ---------- the real sun: where it is in the sky for your home, right now (or any time of day) ---------- */
/* Low-precision solar position (about 1° - plenty for shadows). az: radians clockwise from north; el: radians above the horizon. */
export function sunPosition(date, lat, lon) {
  const r = Math.PI / 180, n = (date.getTime() - 946728000000) / 86400000;   // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * r;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r, eps = (23.439 - 0.0000004 * n) * r;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24, ha = (gmst * 15 + lon) * r - ra, phi = lat * r;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { az: (az + 2 * Math.PI) % (2 * Math.PI), el };
}
/* 0 in full daylight, 1 at night, smooth through dusk and dawn. */
export const nightness = (el) => Math.min(1, Math.max(0, (0.1 - el) / 0.25));
export function kelvinToHex(k) {
  const t = Math.max(1000, Math.min(12000, k)) / 100;
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332;
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * (t - 60) ** -0.0755;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const c = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/* ---------- weather outside: rain, snow, and the odd lightning flash ---------- */
/* Rain falls as streaks leaning with the wind, heavier when the forecast says so; snow drifts; a storm flashes. */
export class WeatherFx {
  constructor(scene) { this.scene = scene; this.points = null; this.kind = null; this.flash = 0; this.slant = new THREE.Vector3(); }
  set(kind, box, amount = 1) {
    const want = ['rain', 'snow', 'storm'].includes(kind) ? kind : null;
    const dens = Math.max(0.35, Math.min(1.6, amount || 1));
    const key = want && box ? `${want}|${dens.toFixed(1)}|${box.min.x.toFixed(0)}|${box.max.x.toFixed(0)}|${box.min.z.toFixed(0)}` : null;
    if (key === this.key) return; this.key = key;
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); this.points = null; }
    this.kind = want; if (!want) return;
    const snow = want === 'snow', n = Math.round((snow ? 1600 : 2400) * dens), pad = 8;
    this.lo = new THREE.Vector3(box.min.x - pad, box.min.y, box.min.z - pad); this.hi = new THREE.Vector3(box.max.x + pad, box.max.y + 12, box.max.z + pad);
    const per = snow ? 1 : 2, pos = new Float32Array(n * 3 * per);
    for (let i = 0; i < n; i++) {
      const x = THREE.MathUtils.lerp(this.lo.x, this.hi.x, Math.random()), y = THREE.MathUtils.lerp(this.lo.y, this.hi.y, Math.random()), z = THREE.MathUtils.lerp(this.lo.z, this.hi.z, Math.random());
      for (let k = 0; k < per; k++) { pos[(i * per + k) * 3] = x; pos[(i * per + k) * 3 + 1] = y + k * 0.32; pos[(i * per + k) * 3 + 2] = z; }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = snow ? new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }))
      : new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c3dcf5', transparent: true, opacity: want === 'storm' ? 0.5 : 0.38, depthWrite: false }));
    this.points.raycast = () => {}; this.points.frustumCulled = false; this.scene.add(this.points);
  }
  set visible(v) { if (this.points) this.points.visible = v; }
  /* wind: a world vector the rain leans along (metres a second). Returns a 0..1 lightning flash for the lights to add. */
  tick(dt, t, wind) {
    if (!this.points || !this.points.visible) return 0;
    const p = this.points.geometry.attributes.position, a = p.array, snow = this.kind === 'snow', fall = snow ? 0.9 : 13;
    const wx = (wind?.x || 0) * (snow ? 0.12 : 0.06), wz = (wind?.z || 0) * (snow ? 0.12 : 0.06);
    if (snow) {
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] -= fall * dt; a[i] += Math.sin(t * 0.8 + i) * 0.004 + wx * dt; a[i + 2] += Math.cos(t * 0.6 + i) * 0.004 + wz * dt;
        if (a[i + 1] < this.lo.y) { a[i + 1] = this.hi.y; a[i] = THREE.MathUtils.lerp(this.lo.x, this.hi.x, Math.random()); a[i + 2] = THREE.MathUtils.lerp(this.lo.z, this.hi.z, Math.random()); }
      }
    } else {
      const sx = wx * 0.32 / Math.max(1, fall * 0.06), sz = wz * 0.32 / Math.max(1, fall * 0.06);   // the streak leans with the wind
      for (let i = 0; i < a.length; i += 6) {
        let x = a[i] + wx * fall * dt * 0.06, y = a[i + 1] - fall * dt, z = a[i + 2] + wz * fall * dt * 0.06;
        if (y < this.lo.y) { y = this.hi.y; x = THREE.MathUtils.lerp(this.lo.x, this.hi.x, Math.random()); z = THREE.MathUtils.lerp(this.lo.z, this.hi.z, Math.random()); }
        a[i] = x; a[i + 1] = y; a[i + 2] = z; a[i + 3] = x - sx; a[i + 4] = y + 0.32; a[i + 5] = z - sz;
      }
    }
    p.needsUpdate = true;
    if (this.kind === 'storm') { if (this.flash <= 0 && Math.random() < dt * 0.08) this.flash = 1; this.flash = Math.max(0, this.flash - dt * 3); return this.flash > 0.5 || (this.flash > 0.2 && this.flash < 0.35) ? this.flash : 0; }
    return 0;
  }
}

/* ---------- the sky: a dome around the view with the real sun and moon in it, clouds that drift with the wind and thicken
   with the forecast (dark and low when it rains), and stars on a clear night. One small shader - drawn a few times a second
   when nothing else moves, so the clouds creep along without keeping a tablet busy. ---------- */
export function moonPhase(date) { const syn = 29.530588853, f = ((((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % syn) + syn) % syn / syn; return f; }
/* A tileable cloud-noise picture, made once (about 20 ms) - the sky reads it instead of working noise out per pixel,
   so it costs next to nothing even on a wall tablet. */
function cloudNoise(size = 256) {
  const N = size, rnd = new Float32Array(64 * 64); for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
  const vn = (x, y, f) => { const g = 64 / f | 0 || 1; const xs = (x / N) * f, ys = (y / N) * f, xi = Math.floor(xs), yi = Math.floor(ys), tx = xs - xi, ty = ys - yi;
    const at = (a, b) => rnd[((((b % f) + f) % f) * 64 + (((a % f) + f) % f)) % rnd.length]; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy; };
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0, a = 0.5, f = 4; for (let o = 0; o < 5; o++) { v += a * vn(x, y, f); a *= 0.5; f *= 2; } const i = (y * N + x) * 4; data[i] = data[i + 1] = data[i + 2] = Math.round(Math.min(1, v) * 255); data[i + 3] = 255; }
  const t = new THREE.DataTexture(data, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
export class SkyDome {
  constructor(scene) {
    this.u = {
      uNoise: { value: cloudNoise() },
      uTop: { value: new THREE.Color('#3f78c8') }, uHorizon: { value: new THREE.Color('#cfe3f3') }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color('#fff4e0') },
      uSunVis: { value: 1 }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonPhase: { value: 0.5 }, uMoonVis: { value: 0 }, uCover: { value: 0.3 }, uDark: { value: 0 },
      uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0.3) }, uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99995, p.w); }',
      fragmentShader: `
        uniform sampler2D uNoise;
        uniform vec3 uTop, uHorizon, uSunDir, uSunCol, uMoonDir; uniform float uSunVis, uMoonPhase, uMoonVis, uCover, uDark, uTime, uNight; uniform vec2 uWind;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
          vec3 sky = mix(uHorizon, uTop, pow(h, 0.32));
          vec3 grey = mix(vec3(0.62, 0.66, 0.71), vec3(0.08, 0.09, 0.12), uNight);
          sky = mix(sky, grey * (1.0 - 0.35 * uDark), smoothstep(0.25, 1.0, uCover) * 0.8);
          float sd = max(dot(d, uSunDir), 0.0), clear = 1.0 - uCover * 0.85;
          sky += uSunCol * (pow(sd, 900.0) * 6.0 * uSunVis * clear + pow(sd, 60.0) * 0.35 * uSunVis * clear + pow(sd, 6.0) * 0.12 * uSunVis);
          // the moon: a small disc, lit on the side the sun is on
          float md = dot(d, uMoonDir);
          if (md > 0.99965 && uMoonVis > 0.0) { vec3 side = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + 1e-4); float x = dot(d - uMoonDir * md, side) / 0.0265;
            float lit = smoothstep(-0.15, 0.15, x * (uMoonPhase < 0.5 ? 1.0 : -1.0) + cos(uMoonPhase * 6.2832));
            sky = mix(sky, vec3(0.92, 0.93, 0.88) * (0.12 + 0.88 * lit), uMoonVis * clear * smoothstep(0.99965, 0.9998, md)); }
          // stars on a clear night
          vec2 sp = floor(d.xz / (d.y + 0.25) * 220.0); float st = step(0.9965, hash(sp)) * hash(sp + 3.1);
          sky += vec3(st) * uNight * (1.0 - uCover) * smoothstep(0.05, 0.3, d.y) * 0.9;
          // clouds on a layer above the house, drifting with the wind
          if (d.y > 0.0 && uCover > 0.02) {
            vec2 uv = d.xz / (d.y + 0.05) * 0.5 + uWind * uTime * 0.004;
            float n = texture2D(uNoise, uv * 0.42).r * 0.72 + texture2D(uNoise, uv * 1.37 + vec2(0.37, 0.71) - uWind * uTime * 0.002).r * 0.28;
            float c = smoothstep(1.02 - uCover * 0.95, 1.22 - uCover * 0.7, n + 0.18) * smoothstep(0.0, 0.035, d.y);
            float lit = 0.6 + 0.4 * pow(sd, 3.0);
            vec3 day = mix(vec3(1.0), uSunCol, 0.25) * lit, wet = vec3(0.36, 0.39, 0.44), night = vec3(0.07, 0.08, 0.11);
            vec3 cc = mix(mix(day, wet, uDark), night, uNight);
            sky = mix(sky, cc, c * (0.55 + 0.45 * uCover));
          }
          gl_FragColor = vec4(sky, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false; this.mesh.raycast = () => {}; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  set visible(v) { this.mesh.visible = v; }
  get visible() { return this.mesh.visible; }
  /* o: { top, horizon (Colors), sunDir, moonDir (unit world vectors), sunEl, night (0..1), cover (0..1), dark (0..1 rain), phase, wind (V3) } */
  update(o) {
    const u = this.u; u.uTop.value.copy(o.top); u.uHorizon.value.copy(o.horizon); u.uSunDir.value.copy(o.sunDir); u.uMoonDir.value.copy(o.moonDir);
    u.uSunVis.value = Math.max(0, Math.min(1, (o.sunEl + 0.04) / 0.08)); u.uMoonVis.value = o.moonDir.y > 0 ? Math.min(1, o.moonDir.y * 8) : 0; u.uMoonPhase.value = o.phase;
    u.uNight.value = o.night; u.uCover.value = o.cover; u.uDark.value = o.dark; u.uSunCol.value.set(o.sunEl < 0.12 ? '#ffb36b' : '#fff4e0');
    if (o.wind) { const w = new THREE.Vector2(o.wind.x, o.wind.z); if (w.lengthSq() > 1e-6) u.uWind.value.copy(w.normalize().multiplyScalar(0.6 + Math.min(3, o.windMs || 2) * 0.5)); }
  }
  tick(t, cam) { this.u.uTime.value = t; if (cam) { this.mesh.position.copy(cam.position); this.mesh.updateMatrixWorld(); } }
}
