/* The 3D home, live: the house moves with the real one.
   Doors and windows swing, slide or tilt with their contact sensors; blinds, curtains, screens and awnings follow the cover's
   position; the garage door rolls up. Ceiling fans turn at their speed, TVs glow (with the album art), heating glows red and
   cooling blue, a cooktop glows while it's on. A smoke, CO or water alarm pulses its room and shows a banner that flies you
   there. Cameras show what they see as a wedge on the ground that turns red on motion. Skylights let the real sun in. The roof's
   solar panels glow with what they make, a ring shows the home battery. A robot vacuum (its path is made up) and, for fun, a pet.
   Everything moves smoothly and only while it moves: the picture rests (no drawing) the moment nothing changes.
   floorplan.js calls in here through a few small hooks; the rules themselves are in floorplan-live-core.js. */
import * as THREE from 'three';
import { approach, openAmount, coverAmount, leafMotion, clipToBox, liveGlow, lampColor as lampColorOf, fanTurns, isTv, wedgePoints, happeningOf, doorLinks, petRoute, reachable } from './floorplan-live-core.js';
import { normalizePlan, pointInPoly } from './floorplan-geom.js';
import { createReplay } from './floorplan-replay.js';
import { createQuality } from './floorplan-quality.js';
import { createWalk } from './floorplan-walk.js';
import { setAwning } from './floorplan-furniture.js';

const V3 = THREE.Vector3;
const TT = (s, v) => (typeof window.T === 'function' ? window.T(s, v) : s);
let cssDone = false;
function addCss() { if (cssDone) return; cssDone = true; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'floorplan-live.css'; document.head.append(l); }
const gradTex = (() => { let t = null; return () => { if (t) return t; const c = Object.assign(document.createElement('canvas'), { width: 64, height: 4 }), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 4); t = new THREE.CanvasTexture(c); return t; }; })();
const radialTex = (() => { let t = null; return () => { if (t) return t; const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); t = new THREE.CanvasTexture(c); return t; }; })();
const cellTex = (() => { let t = null; return () => { if (t) return t; const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), g = c.getContext('2d'); g.fillStyle = '#1b2a4a'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#7f93b8'; g.lineWidth = 2; g.strokeRect(1, 1, 62, 62); g.strokeStyle = 'rgba(160,180,220,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(32, 0); g.lineTo(32, 64); g.moveTo(0, 32); g.lineTo(64, 32); g.stroke(); t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; }; })();
const dispose = (o) => { o?.parent?.remove(o); o?.traverse?.((x) => { if (x.isCSS2DObject) x.element.remove(); x.geometry?.dispose(); if (x.material && !x.material.userData?.shared) { x.material.map?.dispose?.(); x.material.dispose(); } }); };
const CEILING_FAN = /purifier|humidif|\bair\b|heater|tower|desk|pedestal|bath|exhaust|extractor|hood|vent/i;

export function createLive(ctx) {
  addCss();
  const { scene, camera, controls, renderer, S, prefs, el, kick } = ctx;
  const root = new THREE.Group(); root.name = 'live'; scene.add(root);
  if (/[?&]debug3d=1/.test(location.search)) window.__casa3d = { THREE, scene, camera, controls, S, kick, flyTo: ctx.flyTo, live: () => A };   // for checking the live view in a test browser only
  const A = { ready: false, t: 0, fans: new Map(), tvs: new Map(), vac: new Map(), wedges: new Map(), pulses: new Map(), patches: [], open: new Map(), solar: null, battery: null, pet: null, seenAlarm: new Set(), seenEvents: new Set(), banner: null, pending: null, saveT: null, lastSun: new V3() };
  const pins = () => S.live?.pins || [];
  const l3 = () => ({ ...(S.live?.live3d || {}), ...(A.pending || {}) });
  /* A device's state: a placed device, or one only linked from a door/window (the server sends those in live3d.states). */
  function stateOf(id) {
    if (!id) return null;
    const p = pins().find((x) => x.deviceId === id || x.device?.parts?.includes(id));
    return p?.device || S.live?.live3d?.states?.[id] || null;
  }
  /* Settings shared with every screen (camera wedges, saved views, fixed lamp colors, chips, pet): saved half a second after the last change. */
  function saveL3(patch) {
    A.pending = { ...(A.pending || {}), ...patch };
    clearTimeout(A.saveT);
    A.saveT = setTimeout(async () => {
      const cur = l3(), body = { noRain: cur.noRain || [], wedges: cur.wedges || {}, fixed: cur.fixed || {}, views: cur.views || {}, chips: cur.chips || [], pets: cur.pets || null, petColor: cur.petColor };
      try { const r = await fetch('/api/floorplan/live3d', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status }); if (S.live) S.live.live3d = { ...(S.live.live3d || {}), ...j.live3d }; A.pending = null; }
      catch (e) { ctx.toast(e.status === 402 ? TT('Editing the 3D home is part of CasaTorch Pro.') : e.message); }
    }, 500);
  }

  /* ---------- doors, windows, blinds, garage doors, awnings, strip lights ----------
     The drawn floors build each opening as a group (floorplan-openings.js): userData { openingId, kind, swing, opens, openDir,
     slide, lift } with a child 'leaf' (origin at its pivot), 'leaf2' for a double door, 'panel2' inside a bifold leaf, and a
     'cover' group (origin at the top, scale.y 0..1 lowers the blind). Placed things (floorplan-furniture.js): an awning's
     'cover' (setAwning), a strip light's wash (userData.wash). */
  function openingRecords() {
    const out = [...(S.plan?.openings || [])];
    for (const f of S.plan?.floors || []) for (const o of f.plan?.openings || []) out.push({ floorId: f.id, ...o });
    for (const it of [...(S.plan?.items || []), ...(S.plan?.yard?.items || [])]) if (it?.coverId || it?.deviceId) out.push({ itemId: it.id, ...it });
    return out;
  }
  function scanOpenings() {
    const recs = new Map(); for (const r of openingRecords()) recs.set(r.id ?? r.itemId, r);
    const seen = new Set();
    const visit = (o) => {
      const u = o.userData || {};
      const isOpening = u.openingId != null, isItem = u.itemId != null && (u.kind === 'awning' || (u.kind === 'led' && u.wash));
      if (!isOpening && !isItem) return;
      const key = isOpening ? `o:${u.openingId}` : `i:${u.itemId}`, rec = recs.get(isOpening ? u.openingId : u.itemId) || {};
      seen.add(key);
      let a = A.open.get(key);
      if (!a || a.o !== o) {
        const byName = (n) => { let f = null; o.traverse((c) => { if (!f && c !== o && c.name === n) f = c; }); return f; };
        a = { o, key, leaf: byName('leaf'), leaf2: byName('leaf2'), panel2: null, cover: byName('cover'), k: null, kc: null };
        a.panel2 = a.leaf ? a.leaf.getObjectByName('panel2') || null : null;
        for (const m of [a.leaf, a.leaf2, a.panel2]) if (m) m.userData.base ||= { rx: m.rotation.x, ry: m.rotation.y, px: m.position.x, py: m.position.y, sy: m.scale.y };
        A.open.set(key, a);
      }
      a.kind = u.kind || rec.kind || 'door'; a.item = isItem; a.openDir = u.openDir || 1;
      a.slide = Number(u.slide) || 0; a.lift = Number(u.lift) || 0;
      a.devId = rec.deviceId || u.deviceId || null; a.coverId = rec.coverId || u.coverId || null;
      a.floorId = rec.floorId || null; a.rec = rec;
    };
    for (const F of Object.values(S.F)) F.G.traverse(visit);
    for (const c of scene.children) if (c !== root && c.children?.length && !Object.values(S.F).some((F) => F.G === c)) c.traverse(visit);   // the yard and things placed outside
    for (const k of [...A.open.keys()]) if (!seen.has(k)) A.open.delete(k);
  }
  /* A curtain (Home Assistant's "curtain" class, or "curtain"/"drape" in its name) is two panels that part sideways; anything else is a blind that lowers. */
  const isCurtain = (d) => !!d && (d.haClass === 'curtain' || /curtain|drape/i.test(d.name || ''));
  function curtainize(a, on) {
    const slab = a.cover.children.find((m) => m.isMesh && !m.userData.curtain);
    if (a.curtain) { for (const p of a.curtain) { a.cover.remove(p); p.traverse((m) => m.geometry?.dispose()); } a.curtain = null; }
    if (slab) slab.visible = !on;
    if (on && slab?.geometry?.parameters) {
      const { width: W, height: H, depth: D } = slab.geometry.parameters, half = W / 2;
      a.curtain = [-1, 1].map((s) => {
        const p = new THREE.Group(); p.name = 'curtain'; p.position.set(slab.position.x + s * half, 0, slab.position.z);   // the pivot at the window's side
        const m = new THREE.Mesh(new THREE.BoxGeometry(half, H, D * 1.6), fabric()); m.position.set(-s * half / 2, slab.position.y, 0); m.userData.curtain = true; m.userData.full = m.material; m.castShadow = false; m.raycast = () => {};
        p.add(m); a.cover.add(p); return p;
      });
    }
    a.reposed = true; a.curtainFor = on;
  }
  const fabric = () => mats.fabric || (mats.fabric = Object.assign(new THREE.MeshStandardMaterial({ color: '#b8c4d2', roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.94 }), { userData: { shared: true } }));
  function poseLeaves(a, k, dev) {
    const L = a.leaf; if (!L) return;
    const m = leafMotion(a.kind, k, { openDir: a.openDir, slide: a.slide, lift: a.lift, tilt: a.kind === 'window' && dev?.tilt === true }), b = L.userData.base;
    L.rotation.y = b.ry + m.ry; L.rotation.x = b.rx + m.rx; L.position.x = b.px + m.dx; L.position.y = b.py + m.dy; L.scale.y = b.sy * m.sy;
    if (a.leaf2) a.leaf2.rotation.y = a.leaf2.userData.base.ry + m.ry2;
    if (a.panel2) a.panel2.rotation.y = a.panel2.userData.base.ry + m.ryPanel2;
  }
  function openingsTick(dt) {
    let moving = false;
    for (const a of A.open.values()) {
      const dev = stateOf(a.devId), cov = stateOf(a.coverId);
      if (a.item && a.kind === 'led') {   // a strip light: its wash glows in the light's color and brightness
        const w = a.o.userData.wash, d = dev; if (!w) continue;
        const want = d && d.on && d.online !== false ? 0.25 + 0.6 * ((d.brightness ?? 100) / 100) : 0, k0 = a.k;
        a.k = a.k == null ? want : approach(a.k, want, dt, 3);
        if (a.k !== k0 || !a.applied) { w.material.opacity = a.k; if (d) w.material.color.set(d.rgb || (d.kelvin ? ctx.kelvinToHex(d.kelvin) : '#ffd9a0')); }
        a.applied = true; if (a.k !== want) moving = true; continue;
      }
      /* a garage door with only its cover (no separate contact) follows the cover; an awning follows its cover too */
      const want = a.kind === 'awning' ? openAmount(cov || dev) : a.kind === 'garage' && !dev ? openAmount(cov) : openAmount(dev);
      const wantC = a.cover && a.coverId && a.kind !== 'awning' ? coverAmount(cov) : null;
      const k0 = a.k, kc0 = a.kc;
      a.k = a.k == null ? want : approach(a.k, want, dt, a.kind === 'garage' ? 1.4 : a.kind === 'awning' ? 1.2 : 3.2);
      if (wantC != null) a.kc = a.kc == null ? wantC : approach(a.kc, wantC, dt, 1.8);
      if (a.k !== k0 || !a.applied) { if (a.kind === 'awning') { if (cov || dev) setAwning(a.o, a.k); } else poseLeaves(a, a.k, dev); }
      if (a.cover && a.kind !== 'awning' && !a.fabric) { a.fabric = true; a.cover.traverse((m) => { if (m.isMesh) { m.material = fabric(); m.userData.full = m.material; m.castShadow = false; } }); }   // a blind looks like fabric, not like the wall (once)
      if (wantC != null && a.kind !== 'skylight' && isCurtain(cov) !== (a.curtainFor ?? false)) curtainize(a, isCurtain(cov));
      if (wantC != null && (a.kc !== kc0 || !a.applied || a.reposed)) {
        a.reposed = false;
        if (a.curtain) { for (const p of a.curtain) p.scale.x = Math.max(0.12, a.kc); a.cover.scale.y = 1; a.cover.visible = true; }   // a curtain parts to the sides (bunched, never quite gone)
        else { a.cover.scale.y = Math.max(0.02, a.kc); a.cover.visible = a.kc > 0.03; }   // a blind or shade lowers from the top
      }
      a.applied = true;
      if (a.k !== want || (wantC != null && a.kc !== wantC)) moving = true;
      if (a.k !== k0 || a.kc !== kc0) A.shadowDue = true;
    }
    return moving;
  }
  /* ---------- fans, TVs, vacuums ---------- */
  const mats = {};
  const mat = (k, make) => (mats[k] ||= Object.assign(make(), { userData: { shared: true } }));
  function fanMesh() {
    const g = new THREE.Group(), m = mat('fan', () => new THREE.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.6 })), dark = mat('fanDark', () => new THREE.MeshStandardMaterial({ color: '#6b6258', roughness: 0.5 }));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), dark); rod.position.y = 0.11; g.add(rod);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.09, 10), dark); g.add(hub);
    const blades = new THREE.Group(); g.add(blades); g.userData.blades = blades;
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.012, 0.11).translate(0.34, 0, 0), m); b.rotation.y = (i * Math.PI) / 2; b.rotation.x = 0.12; blades.add(b); }
    g.traverse((x) => { x.raycast = () => {}; x.castShadow = false; });
    return g;
  }
  function tvMesh() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.68, 0.04), mat('tvFrame', () => new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.4 }))); g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.62), new THREE.MeshBasicMaterial({ color: '#0a0c10', toneMapped: false })); screen.position.z = 0.022; g.add(screen); g.userData.screen = screen;
    g.traverse((x) => { x.raycast = () => {}; });
    return g;
  }
  function artCanvas(img, title) {
    const c = Object.assign(document.createElement('canvas'), { width: 512, height: 288 }), g = c.getContext('2d');
    g.fillStyle = '#0d1018'; g.fillRect(0, 0, 512, 288);
    if (img) { try { g.filter = 'blur(18px) brightness(0.55)'; g.drawImage(img, -40, -150, 592, 592); g.filter = 'none'; g.drawImage(img, 36, 36, 216, 216); } catch { /* a picture the browser won't draw */ } }
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.font = '600 22px system-ui, sans-serif';
    const words = String(title || '').split(' '), lines = []; let ln = '';
    for (const w of words) { if (g.measureText(`${ln} ${w}`).width > 220 && ln) { lines.push(ln); ln = w; } else ln = ln ? `${ln} ${w}` : w; }
    if (ln) lines.push(ln);
    lines.slice(0, 5).forEach((t, i) => g.fillText(t, 272, 70 + i * 30));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function setTvPicture(tv, d) {
    const screen = tv.g.userData.screen, m = screen.material, key = d.playing ? `${d.art || ''}|${d.title || ''}` : '';
    if (tv.key === key) return; tv.key = key;
    const put = (tex) => { if (m.map) m.map.dispose(); m.map = tex; m.color.set(tex ? '#ffffff' : d.playing ? '#7fa6e6' : '#0a0c10'); m.needsUpdate = true; kick(); };
    if (!d.playing) return put(null);
    if (!d.art) return put(artCanvas(null, d.title || ''));
    const img = new Image(); img.decoding = 'async';
    img.onload = () => { if (tv.key === key) put(artCanvas(img, d.title || '')); };
    img.onerror = () => { if (tv.key === key) put(artCanvas(null, d.title || '')); };
    img.src = d.art;
  }
  function vacMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 20), mat('vac', () => new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.5 }))); body.position.y = 0.04; g.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), mat('vacTop', () => new THREE.MeshStandardMaterial({ color: '#cfd5de', roughness: 0.4 }))); top.position.set(0.05, 0.09, 0); g.add(top);
    g.traverse((x) => { x.raycast = () => {}; });
    return g;
  }
  const vacPath = (c, half) => { const pts = []; const n = 6; for (let i = 0; i <= n; i++) { const z = c.z - half + (2 * half * i) / n; if (i % 2) pts.push([c.x + half, z], [c.x - half, z]); else pts.push([c.x - half, z], [c.x + half, z]); } return pts; };
  function syncDevices() {
    const want = new Set();
    for (const p of pins()) {
      const d = p.device, F = S.F[p.floor]; if (!F || !d) continue;
      if (d.kind === 'fan' && p.pos[1] >= 1.7 && !CEILING_FAN.test(`${p.label || ''} ${d.name}`)) {
        const k = `fan:${p.deviceId}`; want.add(k); let f = A.fans.get(k);
        if (!f || f.F !== F) { if (f) dispose(f.g); f = { g: fanMesh(), F, turns: 0 }; F.G.add(f.g); A.fans.set(k, f); }
        f.g.position.set(p.pos[0], p.pos[1] - 0.22, p.pos[2]); f.want = fanTurns(d); f.turns ??= f.want;
      }
      if (isTv(d)) {
        const k = `tv:${p.deviceId}`; want.add(k); let tv = A.tvs.get(k);
        if (!tv || tv.F !== F) { if (tv) dispose(tv.g); tv = { g: tvMesh(), F, key: null }; F.G.add(tv.g); A.tvs.set(k, tv); }
        const ri = ctx.roomAt(F, p.pos[0], p.pos[2]), r = F.rooms[ri], to = r ? new V3(r.pos[0], p.pos[1], r.pos[1]) : new V3(F.center.x - F.G.position.x, p.pos[1], F.center.z - F.G.position.z);
        tv.g.position.set(p.pos[0], Math.max(p.pos[1], 0.9), p.pos[2]);
        if (to.distanceTo(tv.g.position) > 0.2) { const w = F.G.localToWorld(to.clone().setY(tv.g.position.y)); tv.g.lookAt(w); }
        setTvPicture(tv, d);
      }
      if (d.kind === 'vacuum') {
        const k = `vac:${p.deviceId}`; want.add(k); let v = A.vac.get(k);
        if (!v || v.F !== F) {
          if (v) dispose(v.g);
          v = { g: vacMesh(), F, s: 0 }; F.G.add(v.g);
          v.tag = new ctx.CSS2DObject(el('div', { class: 'l3tag' })); v.tag.position.set(0, 0.35, 0); v.g.add(v.tag);
          A.vac.set(k, v);
        }
        const roomI = d.room ? F.rooms.findIndex((r) => r.name.toLowerCase() === String(d.room).toLowerCase()) : -1, ri = roomI >= 0 ? roomI : ctx.roomAt(F, p.pos[0], p.pos[2]), r = F.rooms[ri];
        v.cleaning = /clean|spot|edge|zone|segment|mow/i.test(d.state || '') && d.online !== false;
        v.dock = new V3(p.pos[0], F.floorY + 0.01, p.pos[2]);
        v.path = vacPath(r ? { x: r.pos[0], z: r.pos[1] } : { x: p.pos[0], z: p.pos[2] }, 1.1); v.total = 0;
        v.tag.element.textContent = v.cleaning ? TT('Cleaning (path simulated)') : '';
        if (!v.cleaning) v.g.position.copy(v.dock);
      }
    }
    for (const M of [A.fans, A.tvs, A.vac]) for (const [k, x] of M) if (!want.has(k)) { dispose(x.g); M.delete(k); }
  }
  function devicesTick(dt) {
    let moving = false;
    for (const f of A.fans.values()) {
      f.turns = approach(f.turns, f.want, dt, 0.8);
      if (f.turns > 0.001 && f.F.G.visible) { f.g.userData.blades.rotation.y += f.turns * Math.PI * 2 * dt; moving = true; }
    }
    const cur = S.floorView === 'all' ? null : S.F[S.floorView];
    for (const v of A.vac.values()) {
      const show = v.cleaning && v.F.G.visible && (!cur || cur === v.F) && S.mode === 'view';
      if (v.tag.visible !== show) v.tag.visible = show;
      if (!v.cleaning || !v.F.G.visible) continue;
      const P = v.path, seg = P.length - 1, speed = 0.22, len = (k) => Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]);
      if (!v.total) { v.total = 0; for (let k = 0; k < seg; k++) v.total += len(k); }
      v.s = (v.s + speed * dt) % v.total;
      let s = v.s, i = 0;
      while (i < seg - 1 && s > len(i)) { s -= len(i); i++; }
      const L = len(i) || 1, t = Math.min(1, s / L), x = P[i][0] + (P[i + 1][0] - P[i][0]) * t, z = P[i][1] + (P[i + 1][1] - P[i][1]) * t;
      v.g.position.set(x, v.dock.y, z); v.g.rotation.y = -Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]);
      moving = true;
    }
    return moving;
  }

  /* ---------- glows (through floorplan.js's glow list) ---------- */
  function lampColor(p, d) { return lampColorOf(d, p, ctx.kelvinToHex, l3().fixed?.[p.deviceId] ?? !!p.color); }
  function glow(d, L) { const g = liveGlow(d); return g ? [g[0], g[1] * (L?.glow || 1)] : null; }

  /* ---------- alarms: the room pulses red, a banner flies you there ---------- */
  const alarmOf = (d) => !!(d && (d.water || d.smoke || d.co || d.triggered));
  const alarmWord = (d) => (d.co ? TT('Carbon monoxide') : d.smoke ? TT('Smoke') : d.water ? TT('Water leak') : TT('Alarm'));
  function syncAlarms() {
    const want = new Set();
    for (const p of pins()) {
      const d = p.device, F = S.F[p.floor]; if (!F || !alarmOf(d)) continue;
      want.add(p.deviceId); let a = A.pulses.get(p.deviceId);
      if (!a) { const m = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radialTex(), color: '#ff3b30', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); m.raycast = () => {}; m.renderOrder = 4; a = { m, F }; A.pulses.set(p.deviceId, a); }
      if (a.m.parent !== F.G) F.G.add(a.m);
      a.m.position.set(p.pos[0], F.floorY + 0.05, p.pos[2]); a.p = p;
    }
    for (const [k, a] of A.pulses) if (!want.has(k)) { dispose(a.m); A.pulses.delete(k); }
    drawBanner();
  }
  function pulseTick() {
    if (!A.pulses.size) return false;
    const k = 0.5 + 0.5 * Math.sin(A.t * Math.PI * 1.6);
    for (const a of A.pulses.values()) { a.m.material.opacity = 0.18 + 0.5 * k; a.m.scale.setScalar(0.85 + 0.25 * k); a.m.visible = a.F.G.visible; }
    return true;
  }
  function flyToPin(p, dist = 7) {
    const F = S.F[p.floor]; if (!F) return;
    if (S.floorView !== 'all' && S.floorView !== p.floor) ctx.pickFloor(p.floor);
    const i = ctx.roomAt(F, p.pos[0], p.pos[2]);
    if (i >= 0 && F.rooms[i]) { ctx.focusRoom(p.floor, i); return; }
    const w = F.G.localToWorld(new V3(...p.pos)); ctx.flyTo(w, w.clone().add(new V3(dist * 0.4, dist, dist * 0.6)));
  }
  /* A window's sensor linked in the drawing editor but not placed itself: "Show me" goes to the window. */
  function linkedPin(id) {
    for (const a of A.open.values()) {
      if (a.devId !== id || a.item) continue;
      const F = S.F[a.floorId] || Object.values(S.F).find((x) => { let i = false; a.o.traverseAncestors((p) => { if (p === x.G) i = true; }); return i; }); if (!F) continue;
      const w = F.G.worldToLocal(a.o.getWorldPosition(new V3())), st = S.live?.live3d?.states?.[id] || {};
      return { deviceId: id, floor: F.f.id, pos: [w.x, w.y, w.z], label: st.name, device: { ...st, id } };
    }
    return null;
  }
  function drawBanner() {
    const alarms = pins().filter((p) => alarmOf(p.device)), rain = (S.live?.live3d?.rainOpen || []).map((id) => pins().find((p) => p.deviceId === id) || linkedPin(id)).filter(Boolean);
    let b = document.getElementById('l3banner');
    if (!alarms.length && !rain.length) { b?.remove(); return; }
    if (!b) { b = el('div', { id: 'l3banner', role: 'alert' }); document.body.append(b); }
    const p = alarms[0] || rain[0], d = p.device, F = S.F[p.floor], room = F?.rooms[ctx.roomAt(F, p.pos[0], p.pos[2])]?.name;
    const text = alarms.length ? `${alarmWord(d)}: ${room || ctx.pinName(p)}` : TT('{name} is open and it\'s raining', { name: ctx.pinName(p) });
    b.className = alarms.length ? 'bad' : 'warn';
    b.replaceChildren(...[el('span', { class: 'dot' }), el('b', {}, text), alarms.length > 1 ? el('small', {}, TT('+{n} more', { n: alarms.length - 1 })) : null,
      el('button', { type: 'button', onclick: () => { b.classList.add('fly'); setTimeout(() => b.classList.remove('fly'), 700); flyToPin(p); } }, TT('Show me'))].filter(Boolean));
    /* A new alarm on a wall panel: go there by itself. */
    if (alarms.length && document.body.classList.contains('panelmode') && !A.seenAlarm.has(p.deviceId)) { A.seenAlarm.add(p.deviceId); b.classList.add('fly'); setTimeout(() => b.classList.remove('fly'), 700); flyToPin(p); }
    for (const id of [...A.seenAlarm]) if (!alarms.some((x) => x.deviceId === id)) A.seenAlarm.delete(id);
  }

  /* ---------- camera view wedges ---------- */
  function defaultWedge(p) {
    const F = S.F[p.floor], w = F.G.localToWorld(new V3(...p.pos)), c = S.houseBox ? S.houseBox.getCenter(new V3()) : new V3();
    return { yaw: Math.round(Math.atan2(w.z - c.z, w.x - c.x) * 180 / Math.PI), fov: 90, reach: 6 };
  }
  const wedgeOf = (p) => ({ ...defaultWedge(p), ...(l3().wedges?.[p.deviceId] || {}) });
  function buildWedge(wd) {
    const pts = wedgePoints(wd.yaw, wd.fov, wd.reach), pos = [], uv = [];
    for (let i = 1; i < pts.length - 1; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) { pos.push(q[0], 0, q[1]); uv.push(Math.hypot(q[0], q[1]) / wd.reach, 0.5); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: gradTex(), color: '#60a5fa', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.concat([pts[0]]).map((q) => new V3(q[0], 0.005, q[1]))), new THREE.LineBasicMaterial({ color: '#93c5fd', transparent: true, opacity: 0.55 }));
    edge.raycast = () => {}; m.add(edge); m.renderOrder = 3;
    return m;
  }
  function syncWedges() {
    const want = new Set();
    for (const p of pins()) {
      const d = p.device, F = S.F[p.floor]; if (!F || d?.kind !== 'camera') continue;
      const wd = wedgeOf(p); if (wd.off) continue;
      want.add(p.deviceId); const sig = `${wd.yaw}|${wd.fov}|${wd.reach}|${p.floor}|${p.pos.join(',')}`;
      let w = A.wedges.get(p.deviceId);
      if (!w || w.sig !== sig) { if (w) dispose(w.m); w = { m: buildWedge(wd), sig, p, F }; w.m.userData.camera = p.deviceId; F.G.add(w.m); A.wedges.set(p.deviceId, w); }
      w.p = p; w.F = F; w.m.position.set(p.pos[0], F.floorY + 0.03, p.pos[2]);
      const mot = !!(d.motion || d.person || stateOf(wd.motionId)?.motion);
      w.m.material.color.set(mot ? '#ef4444' : '#60a5fa'); w.m.material.opacity = mot ? 0.5 : 0.28; w.m.children[0].material.color.set(mot ? '#fca5a5' : '#93c5fd');
    }
    for (const [k, w] of A.wedges) if (!want.has(k)) { dispose(w.m); A.wedges.delete(k); }
  }
  function wedgesVisible() {
    const cur = S.floorView === 'all' ? null : S.F[S.floorView];
    for (const w of A.wedges.values()) { const v = S.mode === 'view' && prefs.cameras !== false && w.F.G.visible && (!cur || cur === w.F) && !walk.on(); if (w.m.visible !== v) { w.m.visible = v; kick(); } }
  }
  /* A tap on a wedge opens its camera (before the room underneath takes the tap). */
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; }, true);
  renderer.domElement.addEventListener('click', (e) => {
    if (S.mode !== 'view' || !A.wedges.size || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6 || walk.on()) return;
    const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera);
    const ms = [...A.wedges.values()].filter((w) => w.m.visible).map((w) => w.m), hit = ray.intersectObjects(ms, false)[0]; if (!hit) return;
    const houseHit = ray.intersectObjects(Object.values(S.F).filter((F) => F.G.visible).map((F) => F.G), true).find((h) => h.object.isMesh && h.object.visible && !h.object.userData.camera && h.object.parent !== root);
    if (houseHit && houseHit.distance < hit.distance - 0.3) return;   // a wall or floor is in front of the wedge
    const p = pins().find((x) => x.deviceId === hit.object.userData.camera); if (!p) return;
    e.stopImmediatePropagation(); ctx.cameraModal(p.device, ctx.pinName(p));
  }, true);

  /* ---------- sunlight through skylights and windows ---------- */
  function sunDir() { const s = ctx.sun; return s.position.clone().sub(s.target.position).normalize(); }
  /* the hole a window or roof window lets light through, as 4 world corners - from the drawn opening (its closed pane, not where an open sash swung to) */
  function holeOf(a) {
    const r = a.rec || {}, w = Number(r.width) || 0.9, h = Number(r.height) || 1.2, o = a.o; o.updateMatrixWorld(true);
    if (a.kind === 'skylight') { const y = 0.05; return [[-w / 2, y, -h / 2], [w / 2, y, -h / 2], [w / 2, y, h / 2], [-w / 2, y, h / 2]].map((q) => o.localToWorld(new V3(...q))); }
    const sill = Number(r.sill) || (a.kind === 'window' ? 0.9 : 0), top = sill + h;
    return [[-w / 2, sill, 0], [w / 2, sill, 0], [w / 2, top, 0], [-w / 2, top, 0]].map((q) => o.localToWorld(new V3(...q)));
  }
  function syncPatches() {
    for (const m of A.patches) dispose(m); A.patches = [];
    const q = quality.current(); if (!q.sunPatches || !ctx.sunOn() || !A.open.size) return;
    const D = sunDir(); if (D.y < 0.08) return;
    const strength = Math.min(1, ctx.sun.intensity / 1.8); if (strength < 0.08) return;
    let n = 0;
    for (const a of A.open.values()) {
      if (n >= 14 || !['skylight', 'window', 'slider', 'double'].includes(a.kind)) continue;
      if (a.item) continue;
      const F = Object.values(S.F).find((x) => { let o = a.o; while (o) { if (o === x.G) return true; o = o.parent; } return false; }); if (!F || !F.G.visible) continue;
      const R = holeOf(a);
      const floorY = F.G.position.y + F.floorY + 0.02, C = R.reduce((s, p) => s.add(p), new V3()).multiplyScalar(0.25);
      if (C.y <= floorY + 0.05) continue;
      const Q = R.map((p) => p.clone().addScaledVector(D, -(p.y - floorY) / D.y)).map((p) => { p.y = floorY; return p; });
      const QC = Q.reduce((s, p) => s.add(p), new V3()).multiplyScalar(0.25);
      const fb = F.box.clone().translate(new V3(F.G.position.x - F.loadOff[0], 0, F.G.position.z - F.loadOff[1]));
      const poly = clipToBox(Q.map((q) => [q.x, q.z]), [fb.min.x + 0.12, fb.min.z + 0.12, fb.max.x - 0.12, fb.max.z - 0.12]);   // the part beyond the walls lands on a wall, not the floor
      if (poly.length < 3) continue;
      if (a.kind !== 'skylight') { const fc = fb.getCenter(new V3()); if (Math.hypot(QC.x - fc.x, QC.z - fc.z) > Math.hypot(C.x - fc.x, C.z - fc.z)) continue; if (QC.distanceTo(C.clone().setY(floorY)) > 6) continue; }   // through a window: only into the house
      const cov = a.coverId ? coverAmount(stateOf(a.coverId)) : 0; if (cov > 0.95) continue;
      const tri = []; for (let i = 1; i < poly.length - 1; i++) for (const q of [poly[0], poly[i], poly[i + 1]]) tri.push(q[0], floorY, q[1]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ffe3ad', transparent: true, opacity: 0.32 * strength * (1 - cov), blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.raycast = () => {}; m.renderOrder = 2; root.add(m); A.patches.push(m); n++;
    }
    kick();
  }

  /* ---------- energy: solar panels on the roof, the home battery, their power lines ---------- */
  function syncEnergy() {
    const E = S.live?.energy || {}, top = Object.values(S.F).find((F) => F.roof);
    const roof = top?.roof;
    if (A.solar && (A.solar.roof !== roof || E.solarW == null)) { dispose(A.solar.m); dispose(A.solar.lab); A.solar = null; }
    if (roof && E.solarW != null && !A.solar) {
      /* panels on the sunny side of whatever roof the house has: four corners dropped straight down onto it */
      roof.updateMatrixWorld(true);
      const B = new THREE.Box3().setFromObject(roof), meshes = []; roof.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o); });
      const north = (S.plan?.settings?.northDeg || 0) * Math.PI / 180, s = new V3(0, 0, 1).applyAxisAngle(new V3(0, 1, 0), -north), r = new V3(-s.z, 0, s.x);
      const c = B.getCenter(new V3()), size = B.getSize(new V3()), along = Math.abs(s.x) * size.x + Math.abs(s.z) * size.z, across = Math.abs(r.x) * size.x + Math.abs(r.z) * size.z;
      const rc = new THREE.Raycaster(), drop = (u, w) => {
        const p = c.clone().addScaledVector(s, along * u).addScaledVector(r, across * w); p.y = B.max.y + 2; rc.set(p, new V3(0, -1, 0));
        const hits = []; for (const m of meshes) THREE.Mesh.prototype.raycast.call(m, rc, hits); hits.sort((a, b) => a.distance - b.distance);
        const h = hits[0]; if (!h) return null; const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new V3(0, 1, 0); if (n.y < 0) n.negate();
        return h.point.clone().addScaledVector(n, 0.06);
      };
      const W = [drop(0.08, -0.36), drop(0.08, 0.36), drop(0.42, 0.36), drop(0.42, -0.36)];
      if (W.every(Boolean) && Math.abs(W[0].y - W[3].y) + Math.abs(W[1].y - W[2].y) < 4) {
        const L = W.map((p) => roof.worldToLocal(p.clone())), lenU = W[0].distanceTo(W[1]), lenW = W[0].distanceTo(W[3]);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...L[0].toArray(), ...L[1].toArray(), ...L[2].toArray(), ...L[0].toArray(), ...L[2].toArray(), ...L[3].toArray()], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, lenU / 1.1, 0, lenU / 1.1, lenW / 1.7, 0, 0, lenU / 1.1, lenW / 1.7, 0, lenW / 1.7], 2)); g.computeVertexNormals();
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: cellTex(), color: '#c7d3ea', roughness: 0.45, metalness: 0.1, emissive: '#ffc94d', emissiveIntensity: 0, side: THREE.DoubleSide }));
        m.raycast = () => {}; roof.add(m);
        const mid = L[0].clone().add(L[2]).multiplyScalar(0.5), lab = new ctx.CSS2DObject(el('div', { class: 'l3tag solar' })); lab.position.copy(mid).add(new V3(0, 0.5, 0)); roof.add(lab);
        A.solar = { m, lab, roof, center: mid.clone() };
      } else A.solar = { m: null, lab: null, roof, center: null };   // this roof has no room for panels: don't try again
    }
    if (A.solar?.m) {
      const w = E.solarW || 0, k = Math.min(1, w / Math.max(4000, A.solarPeak = Math.max(A.solarPeak || 0, w)));
      A.solar.m.material.emissiveIntensity = w > 0 ? 0.04 + 0.35 * k : 0;
      A.solar.lab.element.replaceChildren(el('small', {}, TT('Solar')), el('b', {}, ctx.fmtW(w)));
      A.solar.lab.visible = roof.visible && w > 0;
    }
    /* the home battery: a ring by the electrical panel, how full and which way the power goes */
    const bat = E.battery, spot = ctx.panelSpot?.();
    if (bat && bat.pct != null && spot) {
      if (!A.battery) { A.battery = new ctx.CSS2DObject(el('div', { class: 'l3bat' })); scene.add(A.battery); }
      A.battery.position.copy(spot.w).add(new V3(0.9, 1.4, 0));
      const pct = Math.max(0, Math.min(100, bat.pct)), C = 2 * Math.PI * 15, wtxt = bat.w ? `${bat.w > 0 ? '+' : '−'}${ctx.fmtW(Math.abs(bat.w))}` : '';
      A.battery.element.innerHTML = `<svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="none" stroke="rgba(148,163,184,.35)" stroke-width="5"/><circle cx="20" cy="20" r="15" fill="none" stroke="${pct < 20 ? '#ef4444' : '#22c55e'}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/></svg><span><b>${Math.round(pct)}%</b><small>${TT('Battery')}${wtxt ? ` ${wtxt}` : ''}</small></span>`;
      A.battery.visible = S.mode === 'view' && (prefs.overlay === 'energy' || ctx.linesOn());
    } else if (A.battery) { A.battery.parent?.remove(A.battery); A.battery.element.remove(); A.battery = null; }
  }
  /* drawPower: a line of sunshine from the panels down to the electrical panel, flowing while they make power. */
  function energyLines(lines, spot) {
    const E = S.live?.energy || {};
    if (!spot || !A.solar?.m || !(E.solarW > 0) || !A.solar.roof.visible) return;
    const top = A.solar.roof.localToWorld(A.solar.center.clone().setY(A.solar.center.y - 0.45));
    lines.push({ on: true, watts: E.solarW, color: '#facc15', pts: [top, new V3(spot.w.x, top.y, spot.w.z), spot.w.clone()] });
  }

  /* ---------- a pet, for fun (off unless chosen) ---------- */
  function petMesh(kind, color) {
    const g = new THREE.Group(), fur = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }), dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.9, flatShading: true });
    const dog = kind === 'dog', L = dog ? 0.5 : 0.36, H = dog ? 0.2 : 0.15;
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, H * 0.95), fur); body.position.y = H * 1.25; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(H * 0.95, H * 0.85, H * 0.9), fur); head.position.set(L / 2 + H * 0.3, H * 1.75, 0); g.add(head);
    if (dog) { const snout = new THREE.Mesh(new THREE.BoxGeometry(H * 0.45, H * 0.35, H * 0.45), dark); snout.position.set(L / 2 + H * 0.9, H * 1.6, 0); g.add(snout); for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.BoxGeometry(H * 0.18, H * 0.5, H * 0.3), dark); ear.position.set(L / 2 + H * 0.25, H * 1.75, s * H * 0.5); g.add(ear); } }
    else for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(H * 0.2, H * 0.4, 4), dark); ear.position.set(L / 2 + H * 0.3, H * 2.35, s * H * 0.25); g.add(ear); }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, dog ? 0.22 : 0.32, 5), dark); tail.position.set(-L / 2 - 0.06, H * 1.7, 0); tail.rotation.z = dog ? 0.9 : 0.5; g.add(tail); g.userData.tail = tail;
    const legs = []; for (const [x, z] of [[L * 0.35, H * 0.3], [L * 0.35, -H * 0.3], [-L * 0.35, H * 0.3], [-L * 0.35, -H * 0.3]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, H * 0.9, 0.05).translate(0, -H * 0.45, 0), fur); leg.position.set(x, H * 0.9, z); g.add(leg); legs.push(leg); }
    g.userData.legs = legs; g.userData.body = body;
    g.traverse((x) => { x.raycast = () => {}; x.castShadow = true; });
    return g;
  }
  function syncPet() {
    const want = quality.current().pets ? l3().pets : null;
    if (!want || S.mode !== 'view') { if (A.pet) { dispose(A.pet.g); A.pet = null; kick(); } return; }
    const F = Object.values(S.F).filter((x) => x.rooms.length).sort((a, b) => (a.f.level || 0) - (b.f.level || 0))[0]; if (!F) return;
    if (A.pet && (A.pet.kind !== want || A.pet.F !== F)) { dispose(A.pet.g); A.pet = null; }
    if (!A.pet) {
      const g = petMesh(want, l3().petColor || (want === 'dog' ? '#8a6a4a' : '#c98a4b')); F.G.add(g);
      const sofas = []; for (const [key, ms] of F.items || []) if (/sofa|couch|bed/i.test(key)) { const b = new THREE.Box3(); for (const m of ms) b.expandByObject(m); if (!b.isEmpty()) sofas.push(b); }
      A.pet = { g, F, kind: want, state: 'idle', until: 0, to: null, sofas };
      const r = F.rooms[0]; g.position.set(r.pos[0], F.floorY, r.pos[1]);
    }
  }
  /* Where the pet may go: the rooms joined by doors (the drawn doors, or a scan's door parts). Without any door, it stays in its room.
     Drawn floors know their rooms' outlines; scanned ones go by the nearest room center. Everything in the floor's own frame. */
  const DOORISH = new Set(['door', 'double', 'slider', 'bifold']);
  function petPlan(F) {
    const G = F.G, rooms = F.rooms;
    let polys = null;
    if (F.f.kind === 'drawn' && F.inner) {
      const pr = normalizePlan(F.f.plan || {}).rooms;
      if (pr.length === rooms.length) { F.inner.updateMatrixWorld(true); polys = pr.map((r) => r.pts.map(([x, y]) => { const w = G.worldToLocal(F.inner.localToWorld(new V3(x, 0, y))); return [w.x, w.z]; })); }
    }
    const roomAt = polys ? (x, z) => polys.findIndex((p) => pointInPoly([x, z], p)) : (x, z) => ctx.roomAt(F, x, z);
    const inF = (o) => { let y = false; o.traverseAncestors((p) => { if (p === G) y = true; }); return y; };
    const doors = [];
    for (const a of A.open.values()) {
      if (a.item || !DOORISH.has(a.kind) || !inF(a.o)) continue;
      const p = G.worldToLocal(a.o.getWorldPosition(new V3())), n = new V3(0, 0, 1).transformDirection(a.o.matrixWorld);
      doors.push({ p: [p.x, p.z], n: [n.x, n.z] });
    }
    if (!doors.length) for (const m of F.wallMeshes || []) if (m.userData.cat === 'door' && m.userData.wc) doors.push({ p: [m.userData.wc.x - G.position.x, m.userData.wc.z - G.position.z], n: null });
    return { links: doorLinks(rooms, doors, roomAt), roomAt };
  }
  const near = (r, spread = 1.2) => [r.pos[0] + (Math.random() - 0.5) * spread, r.pos[1] + (Math.random() - 0.5) * spread];
  function petGo(P, x, z, y, next) {
    const g = P.g, from = P.plan.roomAt(g.position.x, g.position.z), to = P.plan.roomAt(x, z);
    if (to < 0 && from >= 0) return false;   // a spot outside every room: not from inside one (it would cross a wall)
    const way = from < 0 || to < 0 ? [] : petRoute(P.plan.links, from, to);
    if (way == null) return false;   // no door leads there
    P.path = [...way.map(([a, b]) => new V3(a, P.F.floorY, b)), new V3(x, y ?? P.F.floorY, z)]; P.to = P.path.shift(); P.next = next;
    return true;
  }
  const petV = new V3();
  function petTick(dt) {
    const P = A.pet; if (!P || !P.F.G.visible) return false;
    const now = A.t, g = P.g;
    if (P.state !== 'walk' && now > P.until) {
      P.plan ||= petPlan(P.F);
      const here = P.plan.roomAt(g.position.x, g.position.z), can = here < 0 ? [] : reachable(P.plan.links, here);
      let going = false;
      if (P.state === 'idle' && P.sofas.length && Math.random() < 0.35) {   // a nap on the sofa (one it can walk to)
        const b = P.sofas[Math.floor(Math.random() * P.sofas.length)], c = P.F.G.worldToLocal(b.getCenter(new V3()));
        if (can.includes(P.plan.roomAt(c.x, c.z))) going = petGo(P, c.x, c.z, P.F.G.worldToLocal(new V3(0, b.max.y, 0)).y, 'nap');
      }
      if (!going) {
        const i = can.length ? can[Math.floor(Math.random() * can.length)] : Math.max(0, ctx.roomAt(P.F, g.position.x, g.position.z)), r = P.F.rooms[i];
        if (r) { const [x, z] = near(r); going = petGo(P, x, z, null, 'idle') || petGo(P, ...near(P.F.rooms[Math.max(0, here)], 0.8), null, 'idle'); }
      }
      if (going) { P.state = 'walk'; g.scale.set(1, 1, 1); } else P.until = now + 5;
    }
    if (P.state === 'walk') {
      const d = petV.copy(P.to).sub(g.position), flat = Math.hypot(d.x, d.z), step = (P.kind === 'dog' ? 0.75 : 0.55) * dt;
      if (flat < 0.05 && P.path?.length) { P.to = P.path.shift(); return true; }   // through the door, on to the next step
      if (flat < 0.05) { g.position.copy(P.to); P.state = P.next; P.until = now + (P.state === 'nap' ? 40 + Math.random() * 40 : 6 + Math.random() * 10); if (P.state === 'nap') g.scale.set(1, 0.72, 1.05); for (const l of g.userData.legs) l.rotation.z = 0; ctx.reshadow(); return true; }
      g.rotation.y = -Math.atan2(d.z, d.x); g.position.x += (d.x / flat) * Math.min(step, flat); g.position.z += (d.z / flat) * Math.min(step, flat);
      g.position.y += (P.to.y - g.position.y) * Math.min(1, dt * 3);
      const ph = now * (P.kind === 'dog' ? 9 : 11); g.userData.legs.forEach((l, i) => { l.rotation.z = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.5; });
      g.userData.tail.rotation.x = Math.sin(now * 6) * 0.3;
      if ((A.petShadowAt || 0) < now - 0.5) { A.petShadowAt = now; ctx.reshadow(); }
      return true;
    }
    return false;
  }

  /* ---------- pins: swipe up/down on a light to dim it, press and hold for its card ---------- */
  function pinGestures(div, p) {
    const d = p.device;
    div.addEventListener('pointerdown', (e) => {
      if (S.mode !== 'view' || e.button !== 0 || replay.on()) return;
      const y0 = e.clientY, x0 = e.clientX, b0 = d.brightness ?? (d.on ? 100 : 0); let mode = null, val = b0, bubble = null;
      const hold = setTimeout(() => { if (mode) return; mode = 'hold'; div.dataset.held = '1'; ctx.openCard(p); }, 550);
      const move = (ev) => {
        const dy = ev.clientY - y0, dx = ev.clientX - x0;
        if (!mode && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) && d.kind === 'light' && d.online !== false) { mode = 'dim'; clearTimeout(hold); div.dataset.held = '1'; bubble = el('span', { class: 'l3dim' }); div.append(bubble); controls.enabled = false; }
        else if (!mode && Math.hypot(dx, dy) > 10) clearTimeout(hold);
        if (mode === 'dim') { val = Math.max(0, Math.min(100, Math.round(b0 - dy / 1.6))); bubble.textContent = val ? `${val}%` : TT('Off'); bubble.style.setProperty('--v', `${val}%`); }
      };
      const up = () => {
        clearTimeout(hold); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); controls.enabled = true;
        if (mode === 'dim') { bubble?.remove(); if (val <= 0) { d.on = false; ctx.act(d, 'off'); } else { d.on = true; d.brightness = val; ctx.act(d, 'brightness', val); } ctx.drawPinsSoon(); }
        if (mode) setTimeout(() => { delete div.dataset.held; }, 0);
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
    div.addEventListener('click', (e) => { if (div.dataset.held) { e.stopImmediatePropagation(); e.preventDefault(); delete div.dataset.held; } }, true);
    if (d.kind === 'light') { div.title = TT('Tap to switch, swipe up or down to dim, hold for more'); div.style.touchAction = 'none'; }   // a swipe on a light dims it instead of moving the page
  }

  /* ---------- saved views per room ---------- */
  const viewKey = (fid, i) => { const r = S.F[fid]?.rooms[i]; return r ? `${fid}:${r.name}`.slice(0, 120) : null; };
  function roomView(fid, i) {
    const v = l3().views?.[viewKey(fid, i)]; if (!v) return false;
    ctx.flyTo(new V3(...v.t), new V3(...v.p)); return true;
  }
  function saveViewBtn(fid, i) {
    const k = viewKey(fid, i); if (!k || !S.plan?.pro?.pro) return null;
    const has = !!l3().views?.[k];
    return el('div', { class: 'srow l3views' }, el('button', { type: 'button', class: 'mini', title: TT('Next time this room opens from exactly here'), onclick: () => { saveL3({ views: { ...(l3().views || {}), [k]: { p: camera.position.toArray(), t: controls.target.toArray() } } }); ctx.toast(TT('Saved. This room now opens from this view.')); ctx.drawLeft(); } }, TT('Save this view')),
      has ? el('button', { type: 'button', class: 'mini', onclick: () => { const v = { ...(l3().views || {}) }; delete v[k]; saveL3({ views: v }); ctx.drawLeft(); } }, TT('Forget it')) : null);
  }

  /* ---------- the editor: a few more choices per device ---------- */
  function editorRow(d0, p) {
    const out = [], cur = l3(), d = { ...d0, ...(pins().find((x) => x.deviceId === d0.id)?.device || {}) };   // the list has names and kinds; the placed device has its state
    if (d.kind === 'light') out.push(el('label', { class: 'chk', title: TT('Otherwise the glow follows the light\'s real color') }, el('input', { type: 'checkbox', checked: (cur.fixed?.[d.id] ?? !!p.color) ? true : null, onchange: (e) => saveL3({ fixed: { ...(l3().fixed || {}), [d.id]: e.target.checked } }) }), TT('Always show in this color')));
    if (d.open != null || d.kind === 'cover') { const off = (cur.noRain || []).includes(d.id); out.push(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: off ? null : true, onchange: (e) => { const s = new Set(l3().noRain || []); if (e.target.checked) s.delete(d.id); else s.add(d.id); saveL3({ noRain: [...s] }); } }), TT('Warn me if it\'s open while it rains'))); }
    if (d.kind === 'camera') {
      const w = wedgeOf(p), set = (k, v) => { const all = { ...(l3().wedges || {}) }; all[d.id] = { ...wedgeOf(p), ...(all[d.id] || {}), [k]: v }; saveL3({ wedges: all }); syncWedges(); kick(); };
      const slider = (label, k, min, max, step, unit) => el('div', { class: 'row' }, el('label', {}, label), el('input', { type: 'range', min, max, step, value: w[k], 'aria-label': label, oninput: (e) => { e.target.nextSibling.textContent = `${e.target.value}${unit}`; set(k, Number(e.target.value)); } }), el('small', {}, `${w[k]}${unit}`));
      const motions = (S.live?.devices || []).filter((x) => x.bin || /motion|occupancy|person|presence/i.test(`${x.name} ${x.id}`)).filter((x) => x.kind !== 'presence').slice(0, 80);
      out.push(el('div', { class: 'beamset' }, el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: w.off ? null : true, onchange: (e) => set('off', !e.target.checked) }), TT('Show what it sees on the plan')),
        slider(TT('Direction'), 'yaw', -180, 180, 5, '°'), slider(TT('Width'), 'fov', 20, 170, 5, '°'), slider(TT('Reach'), 'reach', 1, 30, 0.5, ' m'),
        el('div', { class: 'row' }, el('label', {}, TT('Red on motion from')), el('select', { onchange: (e) => set('motionId', e.target.value || null) }, el('option', { value: '' }, TT('The camera itself')), ...motions.map((x) => el('option', { value: x.id, selected: w.motionId === x.id ? true : null }, x.name))))));
    }
    return out.length ? el('div', { class: 'l3ed' }, ...out) : null;
  }

  /* ---------- day / night / follow the sun ---------- */
  function applySky() {
    const m = prefs.skyMode || 'auto';
    if (m === 'auto') { if (S.skyFixed) { S.timeAt = null; S.skyFixed = false; } }
    else { const x = new Date(); x.setHours(m === 'day' ? 12 : 23, m === 'day' ? 30 : 30, 0, 0); S.timeAt = x; S.skyFixed = true; }
  }
  function skySeg() {
    const m = prefs.skyMode || 'auto';
    return el('div', { class: 'seg l3sky', role: 'group', 'aria-label': TT('Daylight') }, ...[['auto', 'Follow the sun'], ['day', 'Day'], ['night', 'Night']].map(([k, label]) => el('button', { type: 'button', class: m === k ? 'on' : '', 'aria-pressed': String(m === k), onclick: () => { prefs.skyMode = k; ctx.savePrefs(); applySky(); ctx.updateSky(); ctx.drawLeft(); kick(); } }, TT(label))));
  }

  /* ---------- the heat map's legend ---------- */
  function legend() {
    const ov = prefs.overlay, box = document.getElementById('l3legend');
    const C = ctx.units() === 'C', tf = (c) => `${Math.round(C ? c : c * 9 / 5 + 32)}°`;
    const spec = { temp: [TT('Temperature'), [[16, '#3b82f6'], [19, '#22d3ee'], [21.5, '#34d399'], [24, '#fbbf24'], [27, '#ef4444']], tf, [TT('Cold'), TT('Comfortable'), TT('Warm')]],
      humidity: [TT('Humidity'), [[25, '#f97316'], [35, '#fbbf24'], [45, '#34d399'], [60, '#22d3ee'], [70, '#3b82f6']], (v) => `${v}%`, [TT('Dry'), TT('Comfortable'), TT('Damp')]],
      air: [TT('CO₂ (fresh air)'), [[500, '#34d399'], [800, '#a3e635'], [1100, '#fbbf24'], [1500, '#f97316'], [2000, '#ef4444']], (v) => `${v}`, [TT('Fresh'), '', TT('Open a window')]],
      energy: [TT('Power now'), [[5, '#22c55e'], [300, '#fbbf24'], [1200, '#f97316'], [2500, '#ef4444']], (v) => ctx.fmtW(v), [TT('Low'), '', TT('High')]] }[ov];
    document.body.classList.toggle('l3-heat', !!spec && S.mode === 'view');
    if (!spec || S.mode !== 'view' || replay.on()) { box?.remove(); return; }
    const [title, stops, fmt, words] = spec, lo = stops[0][0], hi = stops[stops.length - 1][0];
    const grad = stops.map(([v, c]) => `${c} ${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(', ');
    const node = el('div', { id: 'l3legend', role: 'img', 'aria-label': `${title}: ${fmt(lo)} – ${fmt(hi)}` }, el('b', {}, title), el('div', { class: 'lgbar', style: `background: linear-gradient(90deg, ${grad})` }),
      el('div', { class: 'ticks' }, ...stops.map(([v]) => el('span', { style: `left:${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%` }, fmt(v)))),
      el('div', { class: 'words' }, ...words.map((w) => el('small', {}, w))), el('div', { class: 'none' }, el('i'), el('small', {}, TT('No sensor in the room'))));
    if (box) box.replaceWith(node); else document.body.append(node);
  }

  /* ---------- the View menu's extra rows ---------- */
  function viewMenu() {
    const cur = l3(), petsOn = S.plan?.pro?.pro;
    return [
      el('div', { class: 'poprow' }, el('small', {}, TT('Daylight')), skySeg()),
      quality.menuRow(),
      el('div', { class: 'poprow' }, el('small', {}, TT('Wall panel')), el('button', { type: 'button', class: 'tog', onclick: () => { S.moreOpen = false; ctx.drawTools(); quality.settingsPanel(); } }, `${TT('Wall tablet settings')}…`)),
      petsOn ? el('div', { class: 'poprow' }, el('small', {}, TT('Pet')), el('div', { class: 'seg' }, ...[[null, 'Off'], ['cat', 'Cat'], ['dog', 'Dog']].map(([k, label]) => el('button', { type: 'button', class: (cur.pets || null) === k ? 'on' : '', onclick: () => { saveL3({ pets: k }); setTimeout(() => { syncPet(); kick(); ctx.drawTools(); }, 0); } }, TT(label))))) : null,
      el('button', { type: 'button', class: `tog${walk.on() ? ' on' : ''}`, title: TT('Walk through at eye height'), onclick: () => { S.moreOpen = false; ctx.drawTools(); walk.toggle(); } }, TT('Walk through')),
    ];
  }
  function toolsExtra() { return S.mode === 'view' ? [replay.button()] : []; }

  /* ---------- wiring ---------- */
  const quality = createQuality({ ...ctx, replaying: () => replay.on(), live: { l3, saveL3, flyToPin, stateOf, kick: () => kick() } });
  const replay = createReplay({ ...ctx, walking: () => walk.on(), live: { kick: () => kick() } });
  const walk = createWalk({ ...ctx, replaying: () => replay.on(), live: { root } });
  let lastSync = 0, lastTick = 0;
  function onLive() {
    if (!A.ready) return;
    scanOpenings(); syncDevices(); syncAlarms(); syncWedges(); syncEnergy(); syncPet(); syncPatches(); quality.onLive();
    kick();
  }
  return {
    lampColor, glow, pinGestures, energyLines, editorRow, roomView, saveViewBtn, skySeg, viewMenu, toolsExtra, legend,
    replaying: () => replay.on(), walking: () => walk.on(),
    floorsLoaded() { A.ready = true; applySky(); onLive(); syncPatches(); },
    onLive,
    pinsDrawn() { if (!A.ready) return; syncDevices(); syncAlarms(); syncWedges(); syncEnergy(); },
    panel(on) { quality.panel(on); },
    statusChips: () => quality.chips(),
    happening: (ev) => happeningOf(ev),
    lowerAllowed: () => quality.autoAllowed(),
    frameMs: (moving) => quality.frameMs(moving),
    /* the drawing loop: is something animating? (then it keeps drawing, at the quality level's pace) */
    busy() { return A.ready && !quality.hidden() && (A.anim || walk.moving() || replay.playing()); },
    tick(now, dt) {
      if (!A.ready) return;
      const t0 = performance.now();
      A.t = now / 1000;
      const cheap = quality.current().level === 'old';
      let anim = openingsTick(dt);
      anim = devicesTick(dt) || anim;
      anim = pulseTick() || anim;
      anim = petTick(dt) || anim;
      walk.tick(dt);
      wedgesVisible();
      if (A.shadowDue && (!cheap || now - lastTick > 500)) { A.shadowDue = false; lastTick = now; ctx.reshadow(); }
      const sp = ctx.sun.position; if (sp.distanceToSquared(A.lastSun) > 0.25 || now - lastSync > 60_000) { A.lastSun.copy(sp); lastSync = now; syncPatches(); }
      A.anim = anim; A.tickMs = performance.now() - t0;
    },
    frame: (now, reason, ms) => quality.frame(now, reason, ms, A.tickMs),
  };
}
