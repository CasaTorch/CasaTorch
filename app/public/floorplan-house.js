/* The things that make the 3D plan read as a house: a roof over the top floor, and the power
   running from the electrical panel to every device - glowing lines with current flowing along
   them while the device is on, faster the more it draws. */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/* ---------- roof: a gable over the top floor's footprint, with a little overhang ---------- */
const ROOF = { neon: ['#1e2b4f', '#38bdf8', 0.92], blueprint: ['#1d4a8f', '#e8f1ff', 0.35], day: ['#8a5a44', '#5c3a2c', 1] };
export function buildRoof(box, theme, custom) {
  const [themeColor, edge, opacity] = ROOF[theme] || ROOF.neon, color = custom || themeColor;
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
    for (const o of [...this.group.children]) { this.group.remove(o); o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }
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
      this.label = new CSS2DObject(el('div', { class: 'panellab' }, el('small', {}, 'Total now'), el('b', {}, kw)));
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
export class WeatherFx {
  constructor(scene) { this.scene = scene; this.points = null; this.kind = null; this.flash = 0; }
  set(kind, box) {
    const want = ['rain', 'snow', 'storm'].includes(kind) ? kind : null;
    const key = want && box ? `${want}|${box.min.x.toFixed(0)}|${box.max.x.toFixed(0)}|${box.min.z.toFixed(0)}` : null;
    if (key === this.key) return; this.key = key;
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); this.points = null; }
    this.kind = want; if (!want) return;
    const snow = want === 'snow', n = snow ? 1600 : 2600, pad = 6;
    this.lo = new THREE.Vector3(box.min.x - pad, box.min.y, box.min.z - pad); this.hi = new THREE.Vector3(box.max.x + pad, box.max.y + 10, box.max.z + pad);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = THREE.MathUtils.lerp(this.lo.x, this.hi.x, Math.random()); pos[i * 3 + 1] = THREE.MathUtils.lerp(this.lo.y, this.hi.y, Math.random()); pos[i * 3 + 2] = THREE.MathUtils.lerp(this.lo.z, this.hi.z, Math.random()); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: snow ? '#ffffff' : '#9fd3ff', size: snow ? 0.09 : 0.045, transparent: true, opacity: snow ? 0.9 : 0.55, depthWrite: false }));
    this.points.raycast = () => {}; this.scene.add(this.points);
  }
  set visible(v) { if (this.points) this.points.visible = v; }
  /* returns a 0..1 lightning flash for the lights to add */
  tick(dt, t) {
    if (!this.points || !this.points.visible) return 0;
    const p = this.points.geometry.attributes.position, a = p.array, snow = this.kind === 'snow', fall = snow ? 0.9 : 9;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] -= fall * dt; if (snow) { a[i] += Math.sin(t * 0.8 + i) * 0.004; a[i + 2] += Math.cos(t * 0.6 + i) * 0.004; }
      if (a[i + 1] < this.lo.y) a[i + 1] = this.hi.y;
    }
    p.needsUpdate = true;
    if (this.kind === 'storm') { if (this.flash <= 0 && Math.random() < dt * 0.08) this.flash = 1; this.flash = Math.max(0, this.flash - dt * 3); return this.flash > 0.5 || (this.flash > 0.2 && this.flash < 0.35) ? this.flash : 0; }
    return 0;
  }
}
