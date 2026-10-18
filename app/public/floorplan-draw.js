/* CasaTorch 3D Home - draw a floor plan, for anyone without a LiDAR iPhone/iPad.
   Rooms (drag a box, or tap the corners of any shape), walls by length and angle, doors and windows placed by their
   width and distance from the nearest edge, stairs, paint and floor materials, the roof, and lining a floor up with the
   one below - optionally over a picture of your floor plan. A live 3D preview sits beside the drawing.
   Units are meters; CasaTorch raises the walls into 3D (floorplan-drawn.js). Geometry: floorplan-geom.js. */
import * as G from './floorplan-geom.js';

const T = (s, v) => (typeof window !== 'undefined' && window.T ? window.T(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; };
const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (v) => `${r2(v).toFixed(2)} m`;
const ICON = {
  select: 'M5 3l14 8-6 1.5L10 19z', room: 'M4 5h16v14H4z', shape: 'M4 18L6 5l9 2 5 8-7 4z', wall: 'M4 20L20 4M3 17l4 4M17 3l4 4',
  opening: 'M5 21V3h11v18M5 21h14M13 12h.01M16 3l3 2v16', stairs: 'M3 20h5v-4h4v-4h4V8h5', paint: 'M4 15c0-4 6-11 6-11s6 7 6 11a6 6 0 0 1-12 0zM18 4l3 3',
  picture: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01', floor: 'M3 10l9-6 9 6v10H3zM9 20v-6h6v6',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3', cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01', close: 'M6 6l12 12M18 6L6 18',
};
const icon = (k) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICON[k]); s.append(p); const w = document.createElement('span'); w.className = 'dz-ic'; w.append(s); return w; };
const TOOLS = [['select', 'Select'], ['room', 'Room'], ['shape', 'Shape'], ['wall', 'Wall'], ['opening', 'Door/Window'], ['stairs', 'Stairs'], ['paint', 'Paint'], ['picture', 'Picture'], ['floor', 'Floor']];
const MAT_FILL = { wood: '#e7cfa9', tile: '#e3e8ec', carpet: '#d8d5e6', concrete: '#d6d6d2' };
const WALL_KINDS = ['door', 'double', 'slider', 'bifold', 'garage', 'window'];
let cssOnce = false;
const ensureCss = () => { if (cssOnce || document.querySelector('link[data-dz]')) return; cssOnce = true; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'floorplan-draw.css'; l.dataset.dz = '1'; document.head.append(l); };

export function openDrawer(floor, { el, api, toast, onSave, floors = () => [], outlines = () => [], devices = () => [] }) {
  ensureCss();
  document.getElementById('drawer')?.remove();
  let plan = G.normalizePlan(floor.plan || { rooms: [], walls: [] });
  const saved0 = JSON.stringify(plan);
  const narrow = () => matchMedia('(max-width: 760px)').matches;
  const st = { tool: plan.rooms.length || plan.walls.length ? 'select' : 'room', ppm: 40, ox: 60, oy: 60, sel: null, drag: null, chain: null, hover: null, free: false, shift: false,
    openKind: 'door', stairShape: 'straight', paint: { kind: 'wall', value: G.WALL_COLORS[4] }, issues: [], walls: [], undo: [], redo: [], moveFloor: false, measure: null, bgRatio: null, bgv: 1,
    preview: !narrow(), sheetMin: false, pointers: new Map(), pinch: null, help: false, typed: null };
  /* ---------- the page ---------- */
  const svg = svgEl('svg', { class: 'dz-svg' }), defs = svgEl('defs'), gridL = svgEl('g'), layer = svgEl('g');
  svg.append(defs, gridL, layer);
  const bgImg = el('img', { alt: '', class: 'dz-bg' });
  const hint = el('div', { class: 'dz-hint' }), fixChip = el('div', { class: 'dz-fix', hidden: true });
  const zoomBtns = el('div', { class: 'dz-zoom' }, el('button', { type: 'button', title: T('Zoom in'), onclick: () => zoomAt(1.25) }, '+'), el('button', { type: 'button', title: T('Zoom out'), onclick: () => zoomAt(0.8) }, '−'), el('button', { type: 'button', title: T('Fit the drawing'), onclick: () => { fit(); draw(); } }, '⤢'));
  const stage = el('div', { class: 'dz-stage' }, bgImg, svg, hint, fixChip, zoomBtns);
  const bgFile = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none' });
  const nameIn = el('input', { type: 'text', value: floor.name, class: 'dz-name', maxlength: 40, 'aria-label': T('Floor name') });
  const undoB = el('button', { type: 'button', class: 'ghost', title: `${T('Undo')} (Ctrl+Z)`, onclick: () => undo() }, icon('undo'));
  const redoB = el('button', { type: 'button', class: 'ghost', title: `${T('Redo')} (Ctrl+Y)`, onclick: () => redo() }, icon('redo'));
  const status = el('span', { class: 'dz-status', onclick: () => { if (st.issues.length) { select({ type: 'issue', id: st.issues[0].id }); centerOn(st.issues[0].at); } } });
  const pvBtn = el('button', { type: 'button', title: T('3D preview'), onclick: () => { st.preview = !st.preview; layoutPv(); } }, icon('cube'), el('span', { class: 'dz-hide-s' }, T('3D')));
  const top = el('div', { class: 'dz-top' },
    el('button', { type: 'button', class: 'ghost', title: T('Close'), onclick: () => close() }, icon('close')), nameIn, undoB, redoB, el('span', { class: 'dz-sp' }, status),
    el('button', { type: 'button', class: 'ghost dz-hide-s', title: T('Keyboard shortcuts'), onclick: () => { st.help = !st.help; drawHelp(); } }, icon('help')), pvBtn,
    el('button', { type: 'button', class: 'primary', onclick: save }, T('Save')));
  const tools = el('div', { class: 'dz-tools', role: 'toolbar' }, ...TOOLS.map(([id, label]) => el('button', { type: 'button', 'data-tool': id, title: T(label), onclick: () => setTool(id) }, icon(id), el('span', {}, T(label)))));
  const insp = el('div', { class: 'dz-insp' });
  const pvHost = el('div', { class: 'dz-pv' }, el('span', { class: 'dz-pvlab' }, T('3D preview')), el('button', { type: 'button', class: 'dz-pvx', onclick: () => { st.preview = false; layoutPv(); } }, T('Hide')));
  const more = el('div', { class: 'dz-more' }, el('button', { type: 'button', onclick: () => { st.sheetMin = !st.sheetMin; side.classList.toggle('min', st.sheetMin); } }, '⌃⌄'));
  /* The picture's file picker lives in a row of its own that is never redrawn: other parts of the 3D home add to it
     (floorplan-net.js puts "From the vacuum's map" beside it). Shown with the Picture tool. */
  const picBar = el('div', { class: 'draw-top dz-picbar' }, bgFile);
  const side = el('div', { class: 'dz-side' }, more, insp, picBar, pvHost);
  const box = el('div', { id: 'drawer', class: 'dz', role: 'dialog', 'aria-label': T('Draw your floor') }, top, tools, stage, side);
  document.body.append(box);

  /* ---------- the floor below (to line up with), as outlines in this floor's own plan ---------- */
  let below = { polys: [], corners: [], name: '', holes: [] };
  function computeBelow() {
    const all = floors() || [], lvl = floor.level || 0, b = all.find((f) => f.id !== floor.id && (f.level || 0) === lvl - 1);
    below = { polys: [], corners: [], name: b?.name || '', holes: [] };
    if (!b) return;
    const toMe = (p) => G.worldToFloor(floor, p);
    if (b.kind === 'drawn') {
      const bp = G.normalizePlan(b.plan);
      for (const s of G.planWalls(bp)) below.polys.push([toMe(G.floorToWorld(b, s.a)), toMe(G.floorToWorld(b, s.b))]);
      below.corners = G.planCorners(bp).map((p) => toMe(G.floorToWorld(b, p)));
      below.holes = bp.stairs.map((x) => G.stairSteps(x, b.heightM || 2.7).outline.map((p) => toMe(G.floorToWorld(b, p))));   // the opening cut for the stairs coming up
    } else {
      const o = (outlines() || []).find((x) => x.id === b.id); if (!o) return;
      const [x0, z0, x1, z1] = o.box, pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(toMe);
      below.polys.push([...pts, pts[0]]); below.corners = pts;
    }
  }
  computeBelow();
  const aboveFloor = () => (floors() || []).find((f) => f.id !== floor.id && (f.level || 0) === (floor.level || 0) + 1);

  /* ---------- changes, undo and redo ---------- */
  const snap = () => JSON.stringify(plan);
  function change(fn, { soft = false } = {}) { const before = snap(); fn(); if (snap() !== before) { st.undo.push(before); if (st.undo.length > 200) st.undo.shift(); st.redo = []; } refresh(soft); }
  function beginGesture() { st.before = snap(); }
  function endGesture() { if (st.before != null && snap() !== st.before) { st.undo.push(st.before); st.redo = []; } st.before = null; refresh(); }
  function undo() { if (!st.undo.length) return; st.redo.push(snap()); plan = JSON.parse(st.undo.pop()); st.sel = validSel(st.sel); st.chain = null; refresh(); }
  function redo() { if (!st.redo.length) return; st.undo.push(snap()); plan = JSON.parse(st.redo.pop()); st.sel = validSel(st.sel); refresh(); }
  const validSel = (s) => (s && find(s) ? s : null);
  function refresh(soft) {
    st.walls = G.planWalls(plan); st.issues = G.findIssues(plan);
    if (st.sel?.type === 'issue' && !st.issues.some((i) => i.id === st.sel.id)) st.sel = null;
    draw(); if (!soft) inspector(); preview.soon();
    undoB.disabled = !st.undo.length; redoB.disabled = !st.redo.length;
  }
  /* ---------- finding things ---------- */
  const room = (id) => plan.rooms.find((r) => r.id === id), wall = (id) => plan.walls.find((w) => w.id === id), opening = (id) => plan.openings.find((o) => o.id === id), stair = (id) => plan.stairs.find((s) => s.id === id);
  function find(s) {
    if (!s) return null;
    if (s.type === 'room' || s.type === 'edge') return room(s.id);
    if (s.type === 'wall') return wall(s.id);
    if (s.type === 'opening') return opening(s.id);
    if (s.type === 'stairs') return stair(s.id);
    if (s.type === 'issue') return st.issues.find((i) => i.id === s.id);
    return null;
  }
  const edgeLine = (r, i) => [r.pts[i], r.pts[(i + 1) % r.pts.length]];
  /* The wall or room side nearest p (within tol m): { ref: { wall } | { room, edge }, a, b, t (m from a), d } */
  function nearestHost(p, tol) {
    let best = null;
    const tryLine = (ref, a, b) => { const n = G.nearestOnSeg(p, a, b); if (n.d <= tol && (!best || n.d < best.d)) best = { ref, a, b, t: n.t * G.dist(a, b), d: n.d }; };
    for (const w of plan.walls) tryLine({ wall: w.id }, w.a, w.b);
    for (const r of plan.rooms) for (let i = 0; i < r.pts.length; i++) { const [a, b] = edgeLine(r, i); tryLine({ room: r.id, edge: i }, a, b); }
    return best;
  }
  const roomAt = (p) => [...plan.rooms].reverse().find((r) => G.pointInPoly(p, r.pts));

  /* ---------- view ---------- */
  const toM = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left - st.ox) / st.ppm, (e.clientY - r.top - st.oy) / st.ppm]; };
  const P = (v) => v * st.ppm;
  const gridStep = () => (st.ppm >= 120 ? 0.05 : st.ppm >= 60 ? 0.1 : 0.25);
  const snapGrid = (p) => { const s = gridStep(); return [Math.round(p[0] / s) * s, Math.round(p[1] / s) * s].map((v) => Math.round(v * 1000) / 1000); };
  const tolM = (px = 12) => px / st.ppm;
  function zoomAt(f, cx, cy) { st.moved = true; const r = svg.getBoundingClientRect(); cx ??= r.width / 2; cy ??= r.height / 2; const nppm = Math.max(8, Math.min(320, st.ppm * f)); st.ox = cx - ((cx - st.ox) * nppm) / st.ppm; st.oy = cy - ((cy - st.oy) * nppm) / st.ppm; st.ppm = nppm; draw(); }
  function fit() {
    const pts = [...G.planCorners(plan), ...plan.stairs.flatMap((s) => G.stairSteps(s, floor.heightM || 2.7).outline), ...below.corners];
    const r = svg.getBoundingClientRect(), W = r.width || 800, H = r.height || 600;
    if (!pts.length) { st.ppm = Math.max(28, Math.min(64, W / 16)); st.ox = 40; st.oy = 40; return; }
    const b = G.bbox(pts), m = Math.min(60, W * 0.08); st.ppm = Math.max(8, Math.min(160, Math.min((W - m * 2) / Math.max(1, b.w), (H - m * 2) / Math.max(1, b.h))));
    st.ox = (W - b.w * st.ppm) / 2 - b.x0 * st.ppm; st.oy = (H - b.h * st.ppm) / 2 - b.y0 * st.ppm;
  }
  /* After the first rooms: zoom in when the drawing is still a speck in the corner. */
  function maybeFit() {
    const pts = G.planCorners(plan); if (!pts.length) return;
    const b = G.bbox(pts), r = svg.getBoundingClientRect();
    if (P(b.w) < r.width * 0.3 && P(b.h) < r.height * 0.3) { fit(); st.ppm = Math.min(st.ppm * 0.6, 80); const W = r.width, H = r.height; st.ox = (W - b.w * st.ppm) / 2 - b.x0 * st.ppm; st.oy = (H - b.h * st.ppm) / 2 - b.y0 * st.ppm; draw(); }
  }
  function centerOn(p) { const r = svg.getBoundingClientRect(); st.ox = r.width / 2 - p[0] * st.ppm; st.oy = r.height / 2 - p[1] * st.ppm; draw(); }

  /* ---------- drawing the plan ---------- */
  const add = (parent, tag, attrs, text) => { const e = svgEl(tag, attrs); if (text != null) e.textContent = text; parent.append(e); return e; };
  const label = (g, p, text, cls = 'lbl') => add(g, 'text', { x: P(p[0]), y: P(p[1]), class: cls }, text);
  /* A length label beside the line a-b, pushed out by off px. */
  const dimLabel = (g, a, b, text, off = 14, cls = 'lbl') => { const L = G.dist(a, b) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], m = G.lerp2(a, b, 0.5); return add(g, 'text', { x: P(m[0]) + n[0] * off, y: P(m[1]) + n[1] * off, class: cls }, text); };
  function draw() {
    box.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
    stage.className = `dz-stage ${st.tool}`;
    const tf = `translate(${st.ox} ${st.oy})`; gridL.setAttribute('transform', tf); layer.setAttribute('transform', tf);
    gridL.replaceChildren(); layer.replaceChildren(); defs.replaceChildren();
    const arrowM = add(defs, 'marker', { id: 'dz-arrow', viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }); add(arrowM, 'path', { d: 'M0 0L10 5L0 10z', fill: '#5b4633' });
    const W = svg.clientWidth || 1000, H = svg.clientHeight || 700;
    // grid: 1 m squares, every 5th darker; finer when zoomed in
    const step = st.ppm >= 120 ? 0.1 : 1;
    for (let i = Math.floor(-st.ox / st.ppm / step); i * step * st.ppm < W - st.ox; i++) add(gridL, 'line', { x1: P(i * step), y1: -st.oy, x2: P(i * step), y2: H - st.oy, class: Math.round(i * step * 10) % 50 === 0 ? 'g5' : 'g1' });
    for (let i = Math.floor(-st.oy / st.ppm / step); i * step * st.ppm < H - st.oy; i++) add(gridL, 'line', { x1: -st.ox, y1: P(i * step), x2: W - st.ox, y2: P(i * step), class: Math.round(i * step * 10) % 50 === 0 ? 'g5' : 'g1' });
    drawPicture();
    const g = layer;
    for (const poly of below.polys) add(g, 'polyline', { points: poly.map((p) => `${P(p[0])},${P(p[1])}`).join(' '), class: 'below' });
    for (const h of below.holes) { add(g, 'polygon', { points: h.map((p) => `${P(p[0])},${P(p[1])}`).join(' '), class: 'below', style: 'fill:rgba(139,111,82,.14);stroke:#8b6f52' }); const c = G.centroid(h); label(g, c, T('Stairs up from below'), 'lbl dim'); }
    // material patterns
    for (const [k, c] of Object.entries(MAT_FILL)) {
      const s = Math.max(4, P(k === 'tile' ? 0.3 : k === 'wood' ? 0.2 : 0.5)), pat = add(defs, 'pattern', { id: `dz-${k}`, width: s, height: s, patternUnits: 'userSpaceOnUse' });
      add(pat, 'rect', { width: s, height: s, fill: c, 'fill-opacity': 0.75 });
      if (k === 'wood') add(pat, 'path', { d: `M0 ${s - 0.5}H${s}`, stroke: '#b9925f', 'stroke-width': 1 });
      if (k === 'tile') add(pat, 'path', { d: `M0 0H${s}M0 0V${s}`, stroke: '#a9b3bb', 'stroke-width': 1 });
    }
    // rooms
    for (const r of plan.rooms) {
      const on = st.sel?.type === 'room' && st.sel.id === r.id;
      add(g, 'polygon', { points: r.pts.map((p) => `${P(p[0])},${P(p[1])}`).join(' '), class: `room${on ? ' sel' : ''}`, style: r.floorMat ? `fill:url(#dz-${r.floorMat})` : null, 'data-k': 'room', 'data-id': r.id });
    }
    // stairs (under the walls)
    for (const s of plan.stairs) {
      const S = G.stairSteps(s, floor.heightM || 2.7), on = st.sel?.type === 'stairs' && st.sel.id === s.id;
      add(g, 'polygon', { points: S.outline.map((p) => `${P(p[0])},${P(p[1])}`).join(' '), class: `stairs${on ? ' sel' : ''}`, 'data-k': 'stairs', 'data-id': s.id });
      for (const p of S.steps) {
        if (p.wedge) { const a = [p.c[0] + Math.cos(p.a0) * p.r0, p.c[1] + Math.sin(p.a0) * p.r0], b = [p.c[0] + Math.cos(p.a0) * p.r1, p.c[1] + Math.sin(p.a0) * p.r1]; add(g, 'line', { x1: P(a[0]), y1: P(a[1]), x2: P(b[0]), y2: P(b[1]), class: 'step' }); continue; }
        const rad = (p.rot * Math.PI) / 180, u = [Math.cos(rad), Math.sin(rad)], v = [-u[1], u[0]], e = [p.c[0] + u[0] * p.d / 2, p.c[1] + u[1] * p.d / 2];
        add(g, 'line', { x1: P(e[0] - v[0] * p.w / 2), y1: P(e[1] - v[1] * p.w / 2), x2: P(e[0] + v[0] * p.w / 2), y2: P(e[1] + v[1] * p.w / 2), class: 'step' });
      }
      add(g, 'polyline', { points: S.arrow.map((p) => `${P(p[0])},${P(p[1])}`).join(' '), class: 'arrow' });
    }
    // walls, as they will be built: shared sides once, outside walls thicker, painted sides shown along each face
    for (const w of st.walls) {
      add(g, 'line', { x1: P(w.a[0]), y1: P(w.a[1]), x2: P(w.b[0]), y2: P(w.b[1]), class: 'wallv', 'stroke-width': Math.max(3, P(w.thick)) });
      for (const [c, sgn] of [[w.colorL, 1], [w.colorR, -1]]) if (c) { const o = (sgn * Math.max(3, P(w.thick))) / 2 - sgn * 1.5; add(g, 'line', { x1: P(w.a[0]) + w.n[0] * o, y1: P(w.a[1]) + w.n[1] * o, x2: P(w.b[0]) + w.n[0] * o, y2: P(w.b[1]) + w.n[1] * o, class: 'paint', stroke: c, 'stroke-width': 3 }); }
    }
    // doors and windows
    for (const o of plan.openings) drawOpening(g, o);
    // hit lines for room sides and walls (select them, paint them, put doors in them)
    for (const r of plan.rooms) for (let i = 0; i < r.pts.length; i++) { const [a, b] = edgeLine(r, i); add(g, 'line', { x1: P(a[0]), y1: P(a[1]), x2: P(b[0]), y2: P(b[1]), class: 'hit', 'data-k': 'edge', 'data-id': r.id, 'data-edge': i }); }
    for (const w of plan.walls) add(g, 'line', { x1: P(w.a[0]), y1: P(w.a[1]), x2: P(w.b[0]), y2: P(w.b[1]), class: 'hit', 'data-k': 'wall', 'data-id': w.id });
    for (const o of plan.openings) { const f = G.openingFrame(plan, o); if (f) add(g, 'line', { x1: P(f.a[0]), y1: P(f.a[1]), x2: P(f.b[0]), y2: P(f.b[1]), class: 'hit', 'stroke-width': 20, 'data-k': 'opening', 'data-id': o.id }); }
    // room names and sizes
    for (const r of plan.rooms) {
      const c = G.centroid(r.pts), a = Math.abs(G.polyArea(r.pts)), bb = G.bbox(r.pts), rect = G.isAxisRect(r.pts);
      if (P(Math.min(bb.w, bb.h)) < 28) continue;
      if (r.name) label(g, c, r.name, 'rname').setAttribute('dy', '-0.5em');
      add(g, 'text', { x: P(c[0]), y: P(c[1]), class: 'rarea', dy: r.name ? '0.9em' : null }, rect ? `${r2(bb.w)} × ${r2(bb.h)} m` : `${r2(a)} m²`);
    }
    drawSelection(g);
    drawLive(g);
    // problems: a red marker on the exact spot
    for (const is of st.issues) {
      const ig = add(g, 'g', { class: 'issue', 'data-k': 'issue', 'data-id': is.id });
      add(ig, 'circle', { cx: P(is.at[0]), cy: P(is.at[1]), r: 16, class: 'ring' });
      add(ig, 'circle', { cx: P(is.at[0]), cy: P(is.at[1]), r: 11, 'data-k': 'issue', 'data-id': is.id }); add(ig, 'text', { x: P(is.at[0]), y: P(is.at[1]) }, '!');
    }
    drawFixChip();
    status.textContent = st.issues.length ? (st.issues.length === 1 ? T('1 thing to fix') : T('{n} things to fix', { n: st.issues.length })) : '';
    status.className = `dz-status${st.issues.length ? ' bad' : ''}`;
    hint.textContent = hintText(); hint.hidden = !hint.textContent;
  }
  function drawPicture() {
    if (!plan.bg) { bgImg.style.display = 'none'; return; }
    const href = `/api/floorplan/floors/${floor.id}/background?v=${st.bgv}`;
    if (!st.bgRatio && !st.bgLoading) { st.bgLoading = true; const im = new Image(); im.onload = () => { st.bgLoading = false; st.bgRatio = im.naturalHeight / im.naturalWidth || 1; draw(); }; im.onerror = () => { st.bgLoading = false; }; im.src = href; }
    if (bgImg.getAttribute('src') !== href) bgImg.setAttribute('src', href);
    const w = P(plan.bgW || 15);
    Object.assign(bgImg.style, { width: `${w}px`, height: `${w * (st.bgRatio || 0)}px`, opacity: plan.bgOpacity ?? 0.6, display: st.bgRatio ? '' : 'none',
      transform: `translate(${st.ox + P(plan.bgX || 0)}px, ${st.oy + P(plan.bgY || 0)}px) rotate(${plan.bgRot || 0}deg)` });
  }
  function drawOpening(g, o) {
    const on = st.sel?.type === 'opening' && st.sel.id === o.id, cls = (c) => `sym${c ? ` ${c}` : ''}${on ? ' sel' : ''}`;
    if (o.kind === 'skylight') {
      if (!Number.isFinite(o.x)) return;
      const rad = ((o.rot || 0) * Math.PI) / 180, u = [Math.cos(rad), Math.sin(rad)], v = [-u[1], u[0]], hw = (o.width || 0.8) / 2, hl = (o.height || 1.2) / 2;
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [o.x + u[0] * a * hw + v[0] * b * hl, o.y + u[1] * a * hw + v[1] * b * hl]);
      add(g, 'polygon', { points: pts.map((p) => `${P(p[0])},${P(p[1])}`).join(' '), class: `sky${on ? ' sel' : ''}`, 'data-k': 'opening', 'data-id': o.id, ...(on ? { stroke: '#0a84ff' } : {}) });
      add(g, 'line', { x1: P(pts[0][0]), y1: P(pts[0][1]), x2: P(pts[2][0]), y2: P(pts[2][1]), class: cls('glass') });
      return;
    }
    const f = G.openingFrame(plan, o); if (!f) return;
    const wt = st.walls.find((w) => G.nearestOnSeg(f.c, w.a, w.b).d < 0.05)?.thick || plan.thickInt;
    add(g, 'line', { x1: P(f.a[0]), y1: P(f.a[1]), x2: P(f.b[0]), y2: P(f.b[1]), class: 'gap', 'stroke-width': Math.max(3, P(wt)) + 2 });
    const d = f.dir, n0 = [-d[1], d[0]], w = f.t1 - f.t0, hingeAtB = o.swing === 'right';
    // which side the door swings to: "in" = into its room (or the wall's left side for a wall on its own)
    let inS = 1; if (o.room) { const r = room(o.room); if (r) inS = G.pointInPoly([f.c[0] + n0[0] * 0.2, f.c[1] + n0[1] * 0.2], r.pts) ? 1 : -1; }
    const s = (o.opens === 'out' ? -inS : inS), n = [n0[0] * s, n0[1] * s];
    const line = (a, b, c) => add(g, 'line', { x1: P(a[0]), y1: P(a[1]), x2: P(b[0]), y2: P(b[1]), class: cls(c) });
    const arc = (hinge, from, len) => { const tip = [hinge[0] + n[0] * len, hinge[1] + n[1] * len]; line(hinge, tip); add(g, 'path', { d: `M${P(from[0])} ${P(from[1])} A${P(len)} ${P(len)} 0 0 ${sweepOf(hinge, from, tip)} ${P(tip[0])} ${P(tip[1])}`, class: cls('arc') }); };   // the leaf, open, and the path its edge sweeps
    const sweepOf = (h, a, b) => (((a[0] - h[0]) * (b[1] - h[1]) - (a[1] - h[1]) * (b[0] - h[0])) > 0 ? 1 : 0);
    if (o.kind === 'door') { const h = hingeAtB ? f.b : f.a, fr = hingeAtB ? f.a : f.b; arc(h, fr, w); }
    else if (o.kind === 'double') { arc(f.a, f.c, w / 2); arc(f.b, f.c, w / 2); }
    else if (o.kind === 'bifold') { const h = hingeAtB ? f.b : f.a, q = G.lerp2(f.a, f.b, 0.5), k = w / 4; const mid1 = [G.lerp2(h, q, 0.5)[0] + n[0] * k, G.lerp2(h, q, 0.5)[1] + n[1] * k]; line(h, mid1); line(mid1, q); const o2 = hingeAtB ? f.a : f.b, mid2 = [G.lerp2(q, o2, 0.5)[0] + n[0] * k, G.lerp2(q, o2, 0.5)[1] + n[1] * k]; line(q, mid2); line(mid2, o2); }
    else if (o.kind === 'slider') { const off = Math.max(2, P(wt) / 4) / st.ppm; const m = G.lerp2(f.a, f.b, 0.55), m2 = G.lerp2(f.a, f.b, 0.45); line([f.a[0] + n0[0] * off, f.a[1] + n0[1] * off], [m[0] + n0[0] * off, m[1] + n0[1] * off], 'glass'); line([m2[0] - n0[0] * off, m2[1] - n0[1] * off], [f.b[0] - n0[0] * off, f.b[1] - n0[1] * off], 'glass'); }
    else if (o.kind === 'garage') { const e = add(g, 'line', { x1: P(f.a[0]), y1: P(f.a[1]), x2: P(f.b[0]), y2: P(f.b[1]), class: cls() }); e.setAttribute('stroke-dasharray', '8 4'); e.setAttribute('stroke-width', '3'); }
    else if (o.kind === 'window') { const off = Math.max(2, P(wt) / 3) / st.ppm; line([f.a[0] + n0[0] * off, f.a[1] + n0[1] * off], [f.b[0] + n0[0] * off, f.b[1] + n0[1] * off], 'glass'); line([f.a[0] - n0[0] * off, f.a[1] - n0[1] * off], [f.b[0] - n0[0] * off, f.b[1] - n0[1] * off], 'glass'); }
  }
  function drawSelection(g) {
    const s = st.sel; if (!s) return;
    const handle = (p, k, extra = {}) => add(g, 'circle', { cx: P(p[0]), cy: P(p[1]), r: matchMedia('(pointer: coarse)').matches ? 11 : 7, class: 'handle', 'data-k': k, ...extra });
    if (s.type === 'room') {
      const r = room(s.id); if (!r) return;
      add(g, 'polygon', { points: r.pts.map((p) => `${P(p[0])},${P(p[1])}`).join(' '), class: 'selln' });
      const ccw = G.polyArea(r.pts) > 0;
      r.pts.forEach((p, i) => { const q = r.pts[(i + 1) % r.pts.length]; dimLabel(g, p, q, fmt(G.dist(p, q)), ccw ? 16 : -16); });
      r.pts.forEach((p, i) => handle(p, 'vtx', { 'data-id': r.id, 'data-i': i }));
    } else if (s.type === 'edge') {
      const r = room(s.id); if (!r) return; const [a, b] = edgeLine(r, s.edge);
      add(g, 'line', { x1: P(a[0]), y1: P(a[1]), x2: P(b[0]), y2: P(b[1]), class: 'selln', 'stroke-width': 5 });
      dimLabel(g, a, b, fmt(G.dist(a, b)), G.polyArea(r.pts) > 0 ? 18 : -18, 'lbl acc big');
      handle(a, 'vtx', { 'data-id': r.id, 'data-i': s.edge }); handle(b, 'vtx', { 'data-id': r.id, 'data-i': (s.edge + 1) % r.pts.length });
    } else if (s.type === 'wall') {
      const w = wall(s.id); if (!w) return;
      add(g, 'line', { x1: P(w.a[0]), y1: P(w.a[1]), x2: P(w.b[0]), y2: P(w.b[1]), class: 'selln', 'stroke-width': 5 });
      dimLabel(g, w.a, w.b, `${fmt(G.dist(w.a, w.b))} · ${G.angleOf(w.a, w.b)}°`, 18, 'lbl acc big');
      handle(w.a, 'wend', { 'data-id': w.id, 'data-end': 'a' }); handle(w.b, 'wend', { 'data-id': w.id, 'data-end': 'b' });
    } else if (s.type === 'opening') {
      const o = opening(s.id); if (!o || o.kind === 'skylight') return;
      const f = G.openingFrame(plan, o); if (!f) return;
      const h = f.host, gp = G.openingGaps(o, f.len), n = [-f.dir[1], f.dir[0]], off = 26 / st.ppm, sh = (p) => [p[0] + n[0] * off, p[1] + n[1] * off];
      const meas = o.side === 'end' ? 'after' : 'before';
      // dimension line: start end -> opening -> far end, the measured gap in blue
      for (const [a, b, txt, k] of [[h.a, f.a, fmt(gp.before), 'before'], [f.a, f.b, fmt(f.t1 - f.t0), 'w'], [f.b, h.b, fmt(gp.after), 'after']]) {
        if (G.dist(a, b) < 0.01) continue;
        const A = sh(a), B = sh(b); add(g, 'line', { x1: P(A[0]), y1: P(A[1]), x2: P(B[0]), y2: P(B[1]), class: k === meas ? 'selln' : 'guide', 'stroke-width': k === meas ? 2 : 1 });
        dimLabel(g, A, B, txt, 0, k === meas ? 'lbl acc big' : k === 'w' ? 'lbl' : 'lbl dim');
      }
      handle(f.a, 'oend', { 'data-id': o.id, 'data-end': 'a' }); handle(f.b, 'oend', { 'data-id': o.id, 'data-end': 'b' });
    } else if (s.type === 'stairs') {
      const x = stair(s.id); if (!x) return; const S = G.stairSteps(x, floor.heightM || 2.7), bb = G.bbox(S.outline);
      label(g, [(bb.x0 + bb.x1) / 2, bb.y0 - 14 / st.ppm], T('{n} steps · {w} m wide', { n: S.count, w: r2(x.width) }), 'lbl acc');
    }
  }
  /* What is being drawn right now: the next wall with its length and angle, the box with its sizes, the magnet and guides. */
  function drawLive(g) {
    const ch = st.chain, h = st.hover;
    if (ch && ch.pts.length) {
      const pts = [...ch.pts, ...(h ? [h.pt] : [])];
      add(g, 'polyline', { points: pts.map((p) => `${P(p[0])},${P(p[1])}`).join(' '), class: 'ghost', fill: ch.kind === 'shape' && pts.length > 2 ? null : 'none' });
      for (let i = 1; i < pts.length; i++) dimLabel(g, pts[i - 1], pts[i], i === pts.length - 1 && h ? `${fmt(G.dist(pts[i - 1], pts[i]))} · ${G.angleOf(pts[i - 1], pts[i])}°` : fmt(G.dist(pts[i - 1], pts[i])), -16, i === pts.length - 1 && h ? 'lbl acc big' : 'lbl');
      ch.pts.forEach((p, i) => add(g, 'circle', { cx: P(p[0]), cy: P(p[1]), r: i === 0 && ch.kind === 'shape' ? 7 : 4, class: 'mag', stroke: '#0a84ff' }));
    }
    const d = st.drag;
    if (d?.kind === 'new-room') {
      const a = [Math.min(d.p0[0], d.p1[0]), Math.min(d.p0[1], d.p1[1])], b = [Math.max(d.p0[0], d.p1[0]), Math.max(d.p0[1], d.p1[1])];
      add(g, 'rect', { x: P(a[0]), y: P(a[1]), width: P(b[0] - a[0]), height: P(b[1] - a[1]), class: 'ghost' });
      dimLabel(g, [a[0], a[1]], [b[0], a[1]], fmt(b[0] - a[0]), -14, 'lbl acc big'); dimLabel(g, [b[0], a[1]], [b[0], b[1]], fmt(b[1] - a[1]), -14, 'lbl acc big');
    }
    if (st.measure?.a) { const b = st.measure.b || h?.pt; if (b) { add(g, 'line', { x1: P(st.measure.a[0]), y1: P(st.measure.a[1]), x2: P(b[0]), y2: P(b[1]), class: 'meas' }); dimLabel(g, st.measure.a, b, fmt(G.dist(st.measure.a, b)), -14, 'lbl acc'); } add(g, 'circle', { cx: P(st.measure.a[0]), cy: P(st.measure.a[1]), r: 5, class: 'meas-dot' }); }
    if (h?.mag && (st.tool !== 'select' || d)) add(g, 'circle', { cx: P(h.pt[0]), cy: P(h.pt[1]), r: h.mag === 'corner' ? 9 : 6, class: 'mag' });
    if (h?.guide) { if (h.guide.x != null) add(g, 'line', { x1: P(h.guide.x), y1: -st.oy, x2: P(h.guide.x), y2: (svg.clientHeight || 700) - st.oy, class: 'guide' }); if (h.guide.y != null) add(g, 'line', { x1: -st.ox, y1: P(h.guide.y), x2: (svg.clientWidth || 1000) - st.ox, y2: P(h.guide.y), class: 'guide' }); }
  }
  function drawFixChip() {
    const s = st.sel, is = s?.type === 'issue' && st.issues.find((i) => i.id === s.id);
    if (!is) { fixChip.hidden = true; return; }
    fixChip.hidden = false; fixChip.style.left = `${st.ox + P(is.at[0])}px`; fixChip.style.top = `${st.oy + P(is.at[1])}px`;
    fixChip.replaceChildren(el('span', {}, issueText(is)), el('button', { type: 'button', class: 'primary', onclick: () => fixIssue(is) }, T('Fix')));
  }
  function hintText() {
    const ch = st.chain;
    if (st.measure) return st.measure.a ? T('Tap the other end of something you know the length of.') : T('Tap one end of a wall you know the length of (on the picture).');
    if (st.moveFloor) return below.polys.length ? T('Drag to move the whole floor. Corners snap to the floor below (purple).') : T('Drag to move the whole floor.');
    if (st.tool === 'room') return T('Drag to draw a room. Each square is 1 m.');
    if (st.tool === 'shape') return ch?.pts.length ? (ch.pts.length >= 3 ? T('Tap the first corner (or Enter) to finish. Type a length for the next side.') : T('Tap the next corner, or type a length.')) : T('Tap each corner of the room.');
    if (st.tool === 'wall') return ch?.pts.length ? T('Tap where the wall ends, or type its length. Esc to stop.') : T('Tap where a wall starts.');
    if (st.tool === 'opening') return st.openKind === 'skylight' ? T('Tap inside a room to add a roof window.') : T('Tap a wall to add: {kind}', { kind: T(G.OPENING_KINDS[st.openKind].label) });
    if (st.tool === 'stairs') return T('Tap where the stairs go.');
    if (st.tool === 'paint') return st.paint.kind === 'floor' ? T('Tap a room to lay this floor.') : T('Tap a room to paint its walls, or one wall to paint just that side.');
    if (st.tool === 'picture') return plan.bg ? T('Drag the picture to move it.') : '';
    if (st.tool === 'select' && !st.sel && !plan.rooms.length && !plan.walls.length) return T('Pick Room, Shape or Wall to start drawing.');
    return '';
  }
  function drawHelp() {
    stage.querySelector('.dz-help')?.remove();
    if (!st.help) return;
    const rows = [['Ctrl+Z', 'Undo'], ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'], ['Delete', 'Delete what is selected'], ['← ↑ → ↓', 'Nudge 25 cm (with Alt: 1 cm)'], ['D', 'Duplicate'], ['R', 'Turn 90°'], ['Shift (hold)', 'Draw at any angle'], ['0-9', 'While drawing: type the length'], ['Enter', 'Finish the shape or wall'], ['Esc', 'Stop drawing / clear the selection'], ['?', 'Show or hide this list']];
    stage.append(el('div', { class: 'dz-help', onclick: (e) => { if (e.target === e.currentTarget) { st.help = false; drawHelp(); } } }, el('div', {}, el('h3', {}, T('Keyboard shortcuts')),
      el('table', {}, ...rows.map(([k, v]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, T(v))))), el('p', { class: 'dz-p' }, T('On a phone or tablet: pinch to zoom, drag with two fingers to move around.')),
      el('div', { class: 'dz-acts' }, el('button', { type: 'button', class: 'primary', onclick: () => { st.help = false; drawHelp(); } }, T('Done'))))));
  }

  /* ---------- the inspector: what you can change about what is selected (or the tool, or the floor) ---------- */
  const row = (lab, ...kids) => el('div', { class: 'dz-row' }, el('label', {}, T(lab)), ...kids);
  /* A meters field: typing changes the plan live; one undo step per edit. */
  function numField(value, set, { step = 0.01, min = 0, max = 500, unit = 'm', id } = {}) {
    const i = el('input', { type: 'number', step, min, max, value: r2(value), inputmode: 'decimal', id });
    i.onfocus = () => beginGesture();
    i.oninput = () => { const v = Number(i.value); if (!Number.isFinite(v) || v < min || v > max) return; set(v); st.walls = G.planWalls(plan); st.issues = G.findIssues(plan); draw(); preview.soon(); };
    i.onchange = () => { endGesture(); };
    i.onkeydown = (e) => { if (e.key === 'Enter') { i.blur(); } };
    return [i, el('span', { class: 'unit' }, unit)];
  }
  const seg = (options, value, pick) => el('div', { class: 'dz-seg' }, ...options.map(([v, lab]) => el('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => pick(v) }, T(lab))));
  const chips = (options, value, pick) => el('div', { class: 'dz-chips' }, ...options.map(([v, lab]) => el('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => pick(v) }, T(lab))));
  const swatches = (value, pick, { none = true } = {}) => el('div', { class: 'dz-sw' }, ...(none ? [el('button', { type: 'button', title: T('Plain'), class: !value ? 'on' : '', style: 'background:linear-gradient(135deg,#fff 45%,#e11d48 47%,#e11d48 53%,#fff 55%)', onclick: () => pick(null) })] : []),
    ...G.WALL_COLORS.map((c) => el('button', { type: 'button', title: c, class: value === c ? 'on' : '', style: `background:${c}`, onclick: () => pick(c) })),
    el('label', { class: 'dz-row', style: 'margin:0', title: T('Any color') }, el('input', { type: 'color', value: value || '#ffffff', style: 'width:32px;height:32px;border:0;padding:0;background:none', onclick: () => beginGesture(), oninput: (e) => pick(e.target.value, true), onchange: () => endGesture() })));
  const mats = (value, pick) => el('div', { class: 'dz-sw' }, el('button', { type: 'button', class: `mat${!value ? ' on' : ''}`, onclick: () => pick(null) }, T('Plain')),
    ...Object.entries(G.FLOOR_MATS).map(([k, lab]) => el('button', { type: 'button', class: `mat${value === k ? ' on' : ''}`, style: `background:${MAT_FILL[k]}`, onclick: () => pick(k) }, T(lab))));
  function inspector() {
    const s = st.sel, it = find(s), out = [];
    if (st.chain && (st.tool === 'wall' || st.tool === 'shape')) out.push(...drawingPanel());
    else if (s?.type === 'issue' && it) out.push(el('h3', {}, T('Something to fix')), el('p', {}, issueText(it)), el('p', {}, T(FIX_WHAT[it.fix] || '')), el('div', { class: 'dz-acts' }, el('button', { type: 'button', class: 'primary', onclick: () => fixIssue(it) }, T('Fix')), el('button', { type: 'button', onclick: () => { select(null); } }, T('Leave it'))));
    else if (s?.type === 'room' && it) out.push(...roomPanel(it));
    else if ((s?.type === 'edge' || s?.type === 'wall') && it) out.push(...wallPanel(s, it));
    else if (s?.type === 'opening' && it) out.push(...openingPanel(it));
    else if (s?.type === 'stairs' && it) out.push(...stairsPanel(it));
    else if (st.tool === 'opening') out.push(el('h3', {}, T('Doors and windows')), el('p', {}, T('Pick one, then tap a wall. You can change its size and place after.')), chips(Object.entries(G.OPENING_KINDS).map(([k, v]) => [k, v.label]), st.openKind, (k) => { st.openKind = k; inspector(); draw(); }));
    else if (st.tool === 'stairs') out.push(el('h3', {}, T('Stairs')), el('p', {}, T('Pick a shape, then tap where the stairs go. They climb to the floor above, which gets an opening cut for them.')), chips(Object.entries(G.STAIR_SHAPES), st.stairShape, (k) => { st.stairShape = k; inspector(); }));
    else if (st.tool === 'paint') out.push(...paintPanel());
    else if (st.tool === 'picture') out.push(...picturePanel());
    else out.push(...floorPanel());
    insp.replaceChildren(...out.filter(Boolean));
    picBar.style.display = st.tool === 'picture' && !s ? '' : 'none';
  }
  const issueText = (is) => T(is.msg, { ...(is.vars || {}), a: is.vars?.a || T('A room'), b: is.vars?.b || T('a room') });
  const FIX_WHAT = { merge: 'Fix joins them into one wall.', join: 'Fix moves the end of the wall onto the other one, so the outline closes.', trim: 'Fix cuts the wall back to where it meets the other one.', push: 'Fix moves the second room so they only touch.', fit: 'Fix makes it fit its wall.', space: 'Fix moves one along so they sit side by side.', remove: 'Fix removes it.' };
  function drawingPanel() {
    const ch = st.chain, last = ch.pts[ch.pts.length - 1], h = st.hover?.pt || last, len = G.dist(last, h), ang = G.angleOf(last, h);
    const lenIn = el('input', { type: 'number', step: 0.01, min: 0.05, max: 100, inputmode: 'decimal', placeholder: r2(len) || '', id: 'dz-len' }), angIn = el('input', { type: 'number', step: 1, value: Math.round(len > 0.01 ? ang : ch.ang ?? 0), inputmode: 'decimal', id: 'dz-ang' });
    const addSide = () => { const L = Number(lenIn.value); if (!(L > 0.04)) { lenIn.focus(); return; } const a = Number(angIn.value) || 0; pushPoint(G.polar(last, L, a)); ch.ang = a; setTimeout(() => document.getElementById('dz-len')?.focus(), 0); };
    lenIn.onkeydown = angIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addSide(); } e.stopPropagation(); if (e.key === 'Escape') { endChain(); } };
    const quick = [[0, '→'], [90, '↓'], [180, '←'], [270, '↑']];
    return [el('h3', {}, T(ch.kind === 'shape' ? 'Drawing a room' : 'Drawing walls')),
      el('p', {}, T('Type the length of the next side and press Enter - or tap on the plan.')),
      row('Length', lenIn, el('span', { class: 'unit' }, 'm')), row('Angle', angIn, el('span', { class: 'unit' }, '°')),
      el('div', { class: 'dz-chips', style: 'margin:4px 0 8px' }, ...quick.map(([a, s]) => el('button', { type: 'button', title: `${a}°`, onclick: () => { angIn.value = a; lenIn.focus(); } }, s))),
      el('div', { class: 'dz-acts' }, el('button', { type: 'button', class: 'primary', onclick: addSide }, T('Add side')),
        ch.kind === 'shape' && ch.pts.length >= 3 ? el('button', { type: 'button', onclick: () => finishShape() }, T('Finish room')) : null,
        ch.kind === 'wall' ? el('button', { type: 'button', onclick: () => endChain() }, T('Done')) : null,
        ch.pts.length > 1 ? el('button', { type: 'button', onclick: () => backOne() }, T('Back one')) : null,
        el('button', { type: 'button', class: 'ghost', onclick: () => endChain(true) }, T('Cancel'))),
      el('label', { class: 'dz-row', style: 'margin-top:12px' }, el('input', { type: 'checkbox', checked: !st.free ? true : null, onchange: (e) => { st.free = !e.target.checked; } }), el('span', {}, T('Straight lines (45° and 90°) - hold Shift for any angle')))];
  }
  function roomPanel(r) {
    const bb = G.bbox(r.pts), rect = G.isAxisRect(r.pts);
    const resize = (w, h) => { const x0 = bb.x0, y0 = bb.y0; r.pts = r.pts.map((p) => [Math.round((x0 + ((p[0] - x0) / (bb.w || 1)) * w) * 1000) / 1000, Math.round((y0 + ((p[1] - y0) / (bb.h || 1)) * h) * 1000) / 1000]); };
    const name = el('input', { type: 'text', value: r.name, placeholder: T('Kitchen, Bedroom...'), maxlength: 30, id: 'dz-rname' });
    name.onfocus = () => beginGesture(); name.oninput = () => { r.name = name.value; draw(); }; name.onchange = () => endGesture();
    return [el('h3', {}, T('Room')), row('Name', name),
      rect ? row('Width', ...numField(bb.w, (v) => resize(Math.max(0.3, v), G.bbox(r.pts).h), { min: 0.3, max: 200 })) : row('Area', el('span', {}, `${r2(Math.abs(G.polyArea(r.pts)))} m²`)),
      rect ? row('Depth', ...numField(bb.h, (v) => resize(G.bbox(r.pts).w, Math.max(0.3, v)), { min: 0.3, max: 200 })) : null,
      el('h4', {}, T('Floor')), mats(r.floorMat, (k) => change(() => { if (k) r.floorMat = k; else delete r.floorMat; })),
      el('h4', {}, T('Wall color')), swatches(r.wallColor, (c, live) => { const fn = () => { if (c) r.wallColor = c; else delete r.wallColor; delete r.edgeColors; }; if (live) { fn(); refresh(true); } else change(fn); }),
      el('p', {}, T('Tap one wall to paint just that side.')),
      el('div', { class: 'dz-acts' }, el('button', { type: 'button', onclick: () => duplicate() }, T('Duplicate')), el('button', { type: 'button', onclick: () => turn90() }, T('Turn 90°')), el('button', { type: 'button', class: 'danger', onclick: () => removeSel() }, T('Delete')))];
  }
  function wallPanel(s, it) {
    const isEdge = s.type === 'edge', [a, b] = isEdge ? edgeLine(it, s.edge) : [it.a, it.b], L = G.dist(a, b), ang = G.angleOf(a, b);
    const setLen = (v) => {
      if (isEdge) { const r = it, i = s.edge, n = r.pts.length, A = r.pts[i], B = r.pts[(i + 1) % n], cur = G.dist(A, B) || 1, u = [(B[0] - A[0]) / cur, (B[1] - A[1]) / cur], dd = v - cur;
        if (G.isAxisRect(r.pts)) { const j = (i + 2) % n; for (const k of [(i + 1) % n, j]) r.pts[k] = [r.pts[k][0] + u[0] * dd, r.pts[k][1] + u[1] * dd].map((x) => Math.round(x * 1000) / 1000); }   // keep the box a box: the far side moves
        else r.pts[(i + 1) % n] = G.polar(A, v, G.angleOf(A, B));
      } else it.b = G.polar(it.a, v, G.angleOf(it.a, it.b));
      keepOpeningsOn(isEdge ? { room: it.id, edge: s.edge } : { wall: it.id });
    };
    const setAng = (v) => { if (isEdge) { const i = s.edge, n = it.pts.length; it.pts[(i + 1) % n] = G.polar(it.pts[i], G.dist(it.pts[i], it.pts[(i + 1) % n]), v); } else it.b = G.polar(it.a, G.dist(it.a, it.b), v); };
    const color = isEdge ? it.edgeColors?.[s.edge] || it.wallColor : it.color;
    const ons = plan.openings.filter((o) => (isEdge ? o.room === it.id && o.edge === s.edge : o.wall === it.id));
    const segAt = st.walls.find((w) => G.nearestOnSeg(G.lerp2(a, b, 0.5), w.a, w.b).d < 0.05);
    return [el('h3', {}, T(isEdge ? 'Wall of {room}' : 'Wall', { room: it.name || T('this room') })),
      row('Length', ...numField(L, (v) => setLen(Math.max(0.05, v)), { min: 0.05, max: 200 })),
      row('Angle', ...numField(ang, (v) => setAng(v), { step: 1, min: -360, max: 360, unit: '°' })),
      isEdge ? el('p', {}, T(segAt?.ext ? 'An outside wall ({cm} cm thick).' : 'An inside wall ({cm} cm thick).', { cm: Math.round((segAt?.thick || plan.thickInt) * 100) }))
        : row('Thickness', seg([[plan.thickExt, 'Outside'], [plan.thickInt, 'Inside']], it.thick ?? plan.thickInt, (v) => change(() => { it.thick = v; }))),
      el('h4', {}, T(isEdge ? 'Paint this side' : 'Paint')),
      swatches(color, (c, live) => { const fn = () => { if (isEdge) { it.edgeColors ||= {}; if (c) it.edgeColors[s.edge] = c; else delete it.edgeColors[s.edge]; } else if (c) it.color = c; else delete it.color; }; if (live) { fn(); refresh(true); } else change(fn); }),
      el('h4', {}, T('Add to this wall')),
      chips(WALL_KINDS.map((k) => [k, G.OPENING_KINDS[k].label]), null, (k) => addOpeningOn(isEdge ? { room: it.id, edge: s.edge } : { wall: it.id }, k, L / 2)),
      ons.length ? el('p', {}, T('{n} on this wall - tap one to change it.', { n: ons.length })) : null,
      el('div', { class: 'dz-acts' }, !isEdge ? el('button', { type: 'button', onclick: () => duplicate() }, T('Duplicate')) : null, !isEdge ? el('button', { type: 'button', class: 'danger', onclick: () => removeSel() }, T('Delete')) : el('button', { type: 'button', onclick: () => select({ type: 'room', id: it.id }) }, T('Select the room')))];
  }
  function openingPanel(o) {
    const sky = o.kind === 'skylight', f = sky ? null : G.openingFrame(plan, o), len = f?.len || 0, K = G.OPENING_KINDS[o.kind];
    const win = o.kind === 'window', hinged = ['door', 'double', 'bifold', 'window'].includes(o.kind);
    const setKind = (k) => change(() => { const d = G.OPENING_KINDS[k]; const was = o.kind; o.kind = k; if (G.OPENING_KINDS[was].w === o.width || was !== k) { o.width = Math.min(d.w, len || d.w); o.height = d.h; o.sill = d.sill; } if (f) G.placeOpening(o, len, G.openingSpan(o, len).t0); });
    const out = [el('h3', {}, T(K.label))];
    if (!sky) out.push(chips(WALL_KINDS.map((k) => [k, G.OPENING_KINDS[k].label]), o.kind, setKind));
    out.push(row('Width', ...numField(o.width, (v) => { o.width = Math.max(0.2, Math.min(v, sky ? 4 : len)); if (f) { o.fromEdge = Math.min(o.fromEdge, Math.max(0, len - o.width)); o.t = r2(G.openingSpan(o, len).t0); } }, { min: 0.2, max: 10 })));
    if (!sky) {
      const gp = G.openingGaps(o, len);
      out.push(row('From the edge', ...numField(o.fromEdge, (v) => { o.fromEdge = Math.max(0, Math.min(v, len - o.width)); o.t = r2(G.openingSpan(o, len).t0); }, { min: 0, max: 200, id: 'dz-from' })),
        el('div', { class: 'dz-row' }, el('label', {}, ''), el('button', { type: 'button', title: T('Measure from the other end'), onclick: () => change(() => { const t0 = G.openingSpan(o, len).t0; o.side = o.side === 'end' ? 'start' : 'end'; o.fromEdge = r2(o.side === 'end' ? len - t0 - o.width : t0); }) }, T('Measure from the other end'))),
        el('p', {}, T('{a} m to one end, {b} m to the other. The blue number is the one kept when the wall changes.', { a: gp.before, b: gp.after })));
    }
    out.push(row(sky ? 'Length' : 'Height', ...numField(o.height ?? K.h, (v) => { o.height = v; }, { min: 0.3, max: 5 })));
    if (win) out.push(row('Sill height', ...numField(o.sill ?? 0.9, (v) => { o.sill = v; }, { min: 0, max: 3 })));
    if (hinged) out.push(row('Hinge', seg([['left', 'Left'], ['right', 'Right']], o.swing === 'right' ? 'right' : 'left', (v) => change(() => { o.swing = v; }))), row('Opens', seg([['in', 'In'], ['out', 'Out']], o.opens === 'out' ? 'out' : 'in', (v) => change(() => { o.opens = v; }))));
    if (sky) out.push(row('Turn', seg([[0, '0°'], [90, '90°']], (o.rot || 0) % 180 ? 90 : 0, (v) => change(() => { o.rot = v; }))), el('p', {}, T('Sits in the roof (or the ceiling, under a flat roof).')));
    out.push(...linkRows(o));
    out.push(el('div', { class: 'dz-acts' }, el('button', { type: 'button', onclick: () => duplicate() }, T('Duplicate')), el('button', { type: 'button', class: 'danger', onclick: () => removeSel() }, T('Delete'))));
    return out;
  }
  /* In the 3D home it moves with the real thing: its contact sensor opens the leaf, a blind lowers (a curtain parts sideways),
     and an open window while it rains is flagged - unless "No rain warning". Only shows state; nothing here controls a device. */
  const CONTACT = /door|window|opening|garage|gate|contact|vent|sash|skylight|velux/i;
  function linkRows(o) {
    const all = (devices() || []).filter((d) => d && d.id), byId = new Map(all.map((d) => [d.id, d]));
    const NOT = /temperature|humidity|power|energy|battery|motion|leak|moisture|smoke|lux|illuminance|charge/i;
    const contacts = all.filter((d) => (d.kind === 'sensor' && (CONTACT.test(d.haClass || '') || ((d.bin || /binary_sensor\./.test(d.id) || !d.haClass) && CONTACT.test(`${d.name} ${d.id}`) && !NOT.test(`${d.haClass || ''} ${d.name} ${d.id}`))))
      || (o.kind === 'garage' && d.kind === 'cover' && /garage|gate/i.test(`${d.haClass || ''} ${d.name} ${d.id}`)));
    const covers = all.filter((d) => d.kind === 'cover' && !/valve\.|garage|gate/i.test(`${d.haClass || ''} ${d.id} ${d.name}`));
    const pick = (list, value, set, none) => {
      const opts = [...list]; if (value && !opts.some((d) => d.id === value)) opts.unshift(byId.get(value) || { id: value, name: value });
      return el('select', { class: 'dz-sel', onchange: (e) => change(() => set(e.target.value || null)) }, el('option', { value: '' }, T(none)),
        ...opts.sort((a, b) => String(a.name).localeCompare(String(b.name))).map((d) => el('option', { value: d.id, selected: d.id === value ? true : null }, d.name || d.id)));
    };
    const setKey = (k) => (v) => { if (v) o[k] = v; else delete o[k]; };
    const coverable = ['window', 'slider', 'skylight'].includes(o.kind), rainy = coverable;
    const out = [el('h4', {}, T('In the live 3D view'))];
    out.push(row(o.kind === 'garage' ? 'Opens with' : 'Linked sensor', pick(contacts, o.deviceId, setKey('deviceId'), 'None')));
    if (coverable) out.push(row('Blind, curtain or shade', pick(covers, o.coverId, setKey('coverId'), 'None')));
    if (rainy) out.push(el('label', { class: 'dz-row dz-chk' }, el('input', { type: 'checkbox', checked: o.noRainAlert ? true : null, onchange: (e) => change(() => { if (e.target.checked) o.noRainAlert = true; else delete o.noRainAlert; }) }), el('span', {}, T('No rain warning'))));
    if (!all.length) out.push(el('p', {}, T('Devices show up here once CasaTorch can see them.')));
    else if (o.coverId && /curtain|drape/i.test(`${byId.get(o.coverId)?.haClass || ''} ${byId.get(o.coverId)?.name || ''}`)) out.push(el('p', {}, T('A curtain: it parts to the sides as it opens.')));
    return out;
  }
  function stairsPanel(s) {
    const S = G.stairSteps(s, floor.heightM || 2.7), up = aboveFloor();
    return [el('h3', {}, T('Stairs')), chips(Object.entries(G.STAIR_SHAPES), s.shape, (k) => change(() => { s.shape = k; if (k === 'spiral') s.dia ||= 1.8; if (k === 'L') s.len2 ||= 1.8; })),
      row('Width', ...numField(s.width, (v) => { s.width = v; }, { min: 0.5, max: 3 })),
      s.shape === 'spiral' ? row('Diameter', ...numField(s.dia || 1.8, (v) => { s.dia = v; }, { min: 1.2, max: 4 })) : row('Length', ...numField(s.len || 3, (v) => { s.len = v; }, { min: 1, max: 12 })),
      s.shape === 'L' ? row('Second part', ...numField(s.len2 || 1.8, (v) => { s.len2 = v; }, { min: 0.5, max: 12 })) : null,
      s.shape !== 'straight' ? row('Turns', seg([['left', 'Left'], ['right', 'Right']], s.turn || 'right', (v) => change(() => { s.turn = v; }))) : null,
      row('Direction', el('button', { type: 'button', onclick: () => turn90() }, T('Turn 90°')), el('button', { type: 'button', onclick: () => change(() => { s.rot = ((s.rot || 0) + 180) % 360; }) }, T('Flip'))),
      el('p', {}, T('{n} steps of {cm} cm. The arrow points up.', { n: S.count, cm: Math.round(S.rise * 100) })),
      el('p', {}, up ? T('They reach {floor}, which gets an opening cut for them.', { floor: up.name }) : T('Add a floor above (Editor > Floors) for them to reach.')),
      el('div', { class: 'dz-acts' }, el('button', { type: 'button', onclick: () => duplicate() }, T('Duplicate')), el('button', { type: 'button', class: 'danger', onclick: () => removeSel() }, T('Delete')))];
  }
  function paintPanel() {
    return [el('h3', {}, T('Paint')), seg([['wall', 'Walls'], ['floor', 'Floors']], st.paint.kind, (k) => { st.paint = { kind: k, value: k === 'floor' ? 'wood' : G.WALL_COLORS[4] }; inspector(); draw(); }),
      el('div', { style: 'margin-top:10px' }, st.paint.kind === 'floor' ? mats(st.paint.value, (k) => { st.paint.value = k; inspector(); }) : swatches(st.paint.value, (c) => { st.paint.value = c; inspector(); })),
      el('p', {}, T(st.paint.kind === 'floor' ? 'Then tap the rooms. Floors show in the Real life and Day looks.' : 'Then tap a room for all its walls, or a single wall for just that side.'))];
  }
  function picturePanel() {
    const out = [el('h3', {}, T('Picture to trace')), el('p', {}, T('A floor plan from the listing, the builder, or a photo of a paper plan.')),
      el('div', { class: 'dz-acts' }, el('button', { type: 'button', class: plan.bg ? '' : 'primary', onclick: () => bgFile.click() }, T(plan.bg ? 'Replace picture' : 'Add a picture')))];
    out.push(row('Width in real life', ...numField(plan.bgW || 15, (v) => { plan.bgW = v; }, { min: 1, max: 500, step: 0.1 })));
    if (plan.bg) out.push(
      el('div', { class: 'dz-acts' }, el('button', { type: 'button', class: st.measure ? 'on' : '', onclick: () => { st.measure = st.measure ? null : {}; draw(); inspector(); } }, T('Measure a known length'))),
      el('p', {}, T('Tap both ends of a wall on the picture, then type how long it really is: the picture is scaled to match.')),
      row('Fade', el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: plan.bgOpacity ?? 0.6, onfocus: beginGesture, oninput: (e) => { plan.bgOpacity = Number(e.target.value); draw(); }, onchange: () => endGesture() })),
      row('Turn', el('input', { type: 'range', min: -45, max: 45, step: 0.5, value: plan.bgRot || 0, onfocus: beginGesture, oninput: (e) => { plan.bgRot = Number(e.target.value); draw(); }, onchange: () => endGesture() })),
      row('', ...numField(plan.bgRot || 0, (v) => { plan.bgRot = v; }, { step: 0.5, min: -180, max: 180, unit: '°' })),
      el('div', { class: 'dz-acts' }, el('button', { type: 'button', onclick: () => change(() => { plan.bgX = 0; plan.bgY = 0; plan.bgRot = 0; }) }, T('Reset place and turn'))));
    return out;
  }
  function floorPanel() {
    const roof = plan.roof || {}, on = typeof roof.on === 'boolean' ? (roof.on ? 'yes' : 'no') : 'auto';
    const setRoof = (k, v) => change(() => { plan.roof = { type: 'gable', overhang: 0.35, ...plan.roof, [k]: v }; if (k === 'on' && v === undefined) delete plan.roof.on; if (plan.roof.pitch == null && k !== 'pitch' && plan.roof.type !== 'flat') plan.roof.pitch = 30; });
    const out = [el('h3', {}, T('This floor'))];
    out.push(el('h4', {}, T('Problems')));
    if (!st.issues.length) out.push(el('div', { class: 'dz-ok' }, `✓ ${T('Everything lines up.')}`));
    else {
      out.push(...st.issues.slice(0, 12).map((is) => el('div', { class: 'dz-issue' }, el('span', {}, issueText(is)), el('button', { type: 'button', onclick: () => { select({ type: 'issue', id: is.id }); centerOn(is.at); } }, T('Show')), el('button', { type: 'button', class: 'primary', onclick: () => fixIssue(is) }, T('Fix')))));
      if (st.issues.length > 1) out.push(el('div', { class: 'dz-acts' }, el('button', { type: 'button', onclick: () => fixAll() }, T('Fix all'))));
    }
    out.push(el('h4', {}, T('Walls')), row('Outside walls', ...numField(plan.thickExt, (v) => { plan.thickExt = v; }, { min: 0.05, max: 0.6, step: 0.01 })), row('Inside walls', ...numField(plan.thickInt, (v) => { plan.thickInt = v; }, { min: 0.05, max: 0.6, step: 0.01 })));
    out.push(el('h4', {}, T('Roof')), row('Has a roof', seg([['auto', 'Top floor'], ['yes', 'Yes'], ['no', 'No']], on, (v) => setRoof('on', v === 'auto' ? undefined : v === 'yes'))));
    if (on !== 'no') {
      out.push(row('Shape', seg(Object.entries(G.ROOF_TYPES), roof.type || 'gable', (v) => setRoof('type', v))));
      if ((roof.type || 'gable') !== 'flat') out.push(row('Pitch', ...numField(roof.pitch ?? 30, (v) => { plan.roof = { type: 'gable', overhang: 0.35, ...plan.roof, pitch: v }; }, { min: 3, max: 70, step: 1, unit: '°' })));
      out.push(row('Overhang', ...numField(roof.overhang ?? 0.35, (v) => { plan.roof = { type: 'gable', ...plan.roof, overhang: v }; }, { min: 0, max: 2, step: 0.05 })));
    }
    out.push(el('h4', {}, T('Line up')));
    if (below.polys.length) out.push(el('p', {}, T('{floor} is shown in purple underneath.', { floor: below.name })), el('div', { class: 'dz-acts' }, el('button', { type: 'button', class: 'primary', onclick: () => snapBelow() }, T('Snap to the floor below'))));
    out.push(el('div', { class: 'dz-acts' }, el('button', { type: 'button', class: st.moveFloor ? 'on' : '', onclick: () => { st.moveFloor = !st.moveFloor; st.sel = null; draw(); inspector(); } }, T(st.moveFloor ? 'Done moving' : 'Move this floor')), el('button', { type: 'button', onclick: () => turnFloor(90) }, T('Turn floor 90°'))));
    out.push(el('div', { class: 'dz-acts' }, el('button', { type: 'button', onclick: () => turnHouse(90) }, T('Turn the whole house 90°'))), el('p', {}, T('Turns every floor together, scans too.')));
    out.push(el('h4', {}, T('Start faster')), el('div', { class: 'dz-acts' }, el('button', { type: 'button', onclick: () => roomsFromHa() }, T('Rooms from Home Assistant areas')), el('button', { type: 'button', onclick: () => setTool('picture') }, T('Trace a picture'))),
      el('div', { class: 'dz-acts' }, el('button', { type: 'button', class: 'ghost', onclick: () => { st.help = true; drawHelp(); } }, T('Keyboard shortcuts'))));
    return out;
  }

  /* ---------- actions ---------- */
  function setTool(id) {
    if (id === 'floor') { st.tool = 'select'; st.sel = null; } else st.tool = id;
    st.chain = null; st.measure = null; st.moveFloor = false; if (id !== 'select') st.sel = null;
    if (st.sheetMin) { st.sheetMin = false; side.classList.remove('min'); }
    draw(); inspector();
  }
  function select(s) { st.sel = s; draw(); inspector(); }
  function fixIssue(is) { change(() => G.applyFix(plan, is)); toast(T('Fixed.')); if (st.sel?.type === 'issue') st.sel = null; draw(); inspector(); }
  function fixAll() { change(() => { for (let k = 0; k < 20; k++) { const list = G.findIssues(plan); if (!list.length) break; if (!G.applyFix(plan, list[0])) break; } }); }
  function keepOpeningsOn(ref) {   // a wall got shorter: doors and windows on it stay on it
    const h = G.hostLine(plan, ref); if (!h) return;
    for (const o of plan.openings) if ((ref.wall && o.wall === ref.wall) || (ref.room && o.room === ref.room && o.edge === ref.edge)) { if (o.width > h.len) o.width = r2(Math.max(0.2, h.len)); o.fromEdge = r2(Math.min(o.fromEdge, Math.max(0, h.len - o.width))); o.t = r2(G.openingSpan(o, h.len).t0); }
  }
  function addOpeningOn(ref, kind, tCenter) {
    const h = G.hostLine(plan, ref); if (!h) return;
    const o = G.newOpening(kind, { ...ref, floorId: floor.id }); o.width = Math.min(o.width, Math.max(0.3, h.len - 0.1));
    G.placeOpening(o, h.len, tCenter - o.width / 2);
    change(() => plan.openings.push(o)); st.openKind = kind; select({ type: 'opening', id: o.id });
  }
  function removeSel() {
    const s = st.sel; if (!s) return;
    change(() => {
      if (s.type === 'room') { plan.rooms = plan.rooms.filter((r) => r.id !== s.id); plan.openings = plan.openings.filter((o) => o.room !== s.id || o.kind === 'skylight'); }
      else if (s.type === 'wall') { plan.walls = plan.walls.filter((w) => w.id !== s.id); plan.openings = plan.openings.filter((o) => o.wall !== s.id); }
      else if (s.type === 'opening') plan.openings = plan.openings.filter((o) => o.id !== s.id);
      else if (s.type === 'stairs') plan.stairs = plan.stairs.filter((x) => x.id !== s.id);
    });
    st.sel = null; refresh();
  }
  function duplicate() {
    const s = st.sel, it = find(s); if (!it) return;
    change(() => {
      if (s.type === 'room') { const b = G.bbox(it.pts), c = { ...JSON.parse(JSON.stringify(it)), id: G.uid('r'), name: it.name ? `${it.name} 2` : '', pts: it.pts.map((p) => [Math.round((p[0] + b.w) * 1000) / 1000, p[1]]) }; plan.rooms.push(c); st.sel = { type: 'room', id: c.id }; }   // beside it, sharing the wall
      else if (s.type === 'wall') { const off = 0.5, c = { ...JSON.parse(JSON.stringify(it)), id: G.uid('w'), a: [it.a[0], it.a[1] + off], b: [it.b[0], it.b[1] + off] }; plan.walls.push(c); st.sel = { type: 'wall', id: c.id }; }
      else if (s.type === 'stairs') { const c = { ...it, id: G.uid('s'), x: it.x + 1.5 }; plan.stairs.push(c); st.sel = { type: 'stairs', id: c.id }; }
      else if (s.type === 'opening') {
        const c = { ...it, id: G.uid('o') };
        if (it.kind === 'skylight') { c.x = it.x + it.width + 0.3; } else { const f = G.openingFrame(plan, it); if (f) G.placeOpening(c, f.len, f.t1 + 0.3); }
        plan.openings.push(c); st.sel = { type: 'opening', id: c.id };
      }
    });
  }
  function turn90() {
    const s = st.sel, it = find(s); if (!it) return;
    change(() => {
      if (s.type === 'room') { const c = G.centroid(it.pts), f = G.turnFn(c, 90); it.pts = it.pts.map((p) => f(p).map((v) => Math.round(v * 1000) / 1000)); }
      else if (s.type === 'wall') { const c = G.lerp2(it.a, it.b, 0.5), f = G.turnFn(c, 90); it.a = f(it.a).map((v) => Math.round(v * 1000) / 1000); it.b = f(it.b).map((v) => Math.round(v * 1000) / 1000); }
      else if (s.type === 'stairs') it.rot = ((it.rot || 0) + 90) % 360;
      else if (s.type === 'opening') { if (it.kind === 'skylight') it.rot = ((it.rot || 0) + 90) % 360; else it.swing = it.swing === 'right' ? 'left' : 'right'; }
    });
  }
  function nudge(dx, dy) {
    const s = st.sel, it = find(s); if (!it) { return false; }
    change(() => {
      const mv = (p) => [Math.round((p[0] + dx) * 1000) / 1000, Math.round((p[1] + dy) * 1000) / 1000];
      if (s.type === 'room') it.pts = it.pts.map(mv);
      else if (s.type === 'edge') { const n = it.pts.length; it.pts[s.edge] = mv(it.pts[s.edge]); it.pts[(s.edge + 1) % n] = mv(it.pts[(s.edge + 1) % n]); }
      else if (s.type === 'wall') { it.a = mv(it.a); it.b = mv(it.b); }
      else if (s.type === 'stairs') { it.x = r2(it.x + dx); it.y = r2(it.y + dy); }
      else if (s.type === 'opening') { if (it.kind === 'skylight') { it.x += dx; it.y += dy; } else { const f = G.openingFrame(plan, it); if (f) G.placeOpening(it, f.len, f.t0 + (dx * f.dir[0] + dy * f.dir[1])); } }
    }, { soft: true });
    return true;
  }
  function snapBelow() {
    const r = G.bestAlign(G.planCorners(plan), below.corners);
    if (!r.hits) { toast(T('Nothing lines up yet - drag the floor close to the purple outline first.')); return; }
    change(() => G.transformPlan(plan, G.shiftFn(r.dx, r.dy)));
    toast(T('Lined up: {n} corners on the floor below.', { n: r.hits }));
  }
  function turnFloor(deg) { const pts = G.planCorners(plan); if (!pts.length) return; const b = G.bbox(pts), c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; change(() => G.transformPlan(plan, G.turnFn(c, deg), deg)); }
  async function turnHouse(deg) {
    const all = (floors() || []), boxes = (outlines() || []).map((o) => o.box); if (!all.length) return;
    const xs = boxes.flatMap((b) => [b[0], b[2]]), zs = boxes.flatMap((b) => [b[1], b[3]]), c = xs.length ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2] : [0, 0];
    if (!confirm(T('Turn every floor of the house 90°? Your drawing is saved first.'))) return;
    try {
      await putPlan();
      for (const x of G.turnHouse(all, deg, c)) await api(`/api/floorplan/floors/${x.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset: x.offset, rotationY: x.rotationY }) });
      const me = G.turnHouse([floor], deg, c)[0]; floor.offset = me.offset; floor.rotationY = me.rotationY;
      for (const f of all) { const t = G.turnHouse([f], deg, c)[0]; f.offset = t.offset; f.rotationY = t.rotationY; }
      computeBelow(); refresh(); toast(T('The whole house turned.')); onSave?.({ keepOpen: true });
    } catch (e) { toast(e.message); }
  }
  async function roomsFromHa() {
    try {
      const r = await api('/api/devices'), names = [...new Set((r.devices || []).map((d) => d.area).filter(Boolean))];
      if (!names.length) { toast(T('No areas found in Home Assistant. Give your devices an area there, or draw the rooms here.')); return; }
      const made = G.roomsFromAreas(names, plan); if (!made.length) { toast(T('Every area already has a room.')); return; }
      change(() => plan.rooms.push(...made)); fit(); draw();
      toast(T('{n} rooms added, 3 × 3 m each - drag and resize them to match.', { n: made.length }));
    } catch (e) { toast(e.message); }
  }
  /* ---------- drawing walls and shapes, point by point ---------- */
  function pushPoint(p) {
    const ch = st.chain; if (!ch) return;
    const last = ch.pts[ch.pts.length - 1];
    if (last && G.dist(last, p) < 0.04) return;
    if (ch.kind === 'shape' && ch.pts.length >= 3 && G.dist(p, ch.pts[0]) < Math.max(0.05, tolM(14))) { finishShape(); return; }
    if (ch.kind === 'wall' && last) {
      const w = { id: G.uid('w'), a: [...last], b: [...p] }; change(() => plan.walls.push(w), { soft: true }); (ch.made ||= []).push(w.id);
      if (G.dist(p, ch.pts[0]) < 0.02 && ch.pts.length > 2) { ch.pts.push(p); endChain(); return; }   // closed the outline
    }
    ch.pts.push(p); draw(); inspector();
  }
  function backOne() {
    const ch = st.chain; if (!ch?.pts.length) return;
    ch.pts.pop(); if (ch.kind === 'wall' && ch.made?.length > ch.pts.length - 1 && ch.made.length) { const id = ch.made.pop(); plan.walls = plan.walls.filter((w) => w.id !== id); refresh(true); }
    if (!ch.pts.length) st.chain = null; draw(); inspector();
  }
  function finishShape() {
    const ch = st.chain; if (!ch || ch.pts.length < 3) return;
    const r = { id: G.uid('r'), name: '', pts: ch.pts.map((p) => [...p]) };
    if (Math.abs(G.polyArea(r.pts)) < 0.2) { toast(T('That room is too small.')); return; }
    st.chain = null; change(() => plan.rooms.push(r)); maybeFit(); select({ type: 'room', id: r.id }); setTimeout(() => document.getElementById('dz-rname')?.focus(), 30);
  }
  function endChain(cancel) {
    const ch = st.chain; st.chain = null;
    if (cancel && ch?.kind === 'wall' && ch.made?.length) change(() => { plan.walls = plan.walls.filter((w) => !ch.made.includes(w.id)); });
    st.hover = null; if (!cancel) maybeFit(); draw(); inspector();
  }
  /* Where the pointer is, with every snap applied: magnet to corners and walls, 45/90° from the last point, then the grid. */
  function snapPoint(raw, { from, skip } = {}) {
    const extra = { ...plan, extraCorners: below.corners };
    const m = G.magnet(raw, extra, tolM(12), skip);
    if (m.kind) return { pt: m.pt, mag: m.kind };
    let p = raw;
    if (from && !st.free && !st.shift) {
      p = G.snapAngle(from, raw, 45);
      const L = Math.round(G.dist(from, p) / gridStep()) * gridStep(), a = G.angleOf(from, p); p = G.polar(from, L, a);
      return { pt: p, mag: null };
    }
    p = snapGrid(raw);
    const gd = G.alignGuides(p, G.planCorners(plan), tolM(6));
    return { pt: gd.pt, mag: null, guide: gd.x != null || gd.y != null ? gd : null };
  }

  /* ---------- pointer ---------- */
  svg.addEventListener('pointerdown', (e) => {
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { svg.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    if (st.pointers.size === 2) {   // two fingers: pinch to zoom, drag to move around
      const [a, b] = [...st.pointers.values()]; st.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ox: st.ox, oy: st.oy, ppm: st.ppm };
      if (st.drag?.kind === 'new-room') st.drag = null; if (st.before != null) { endGesture(); }
      st.drag = null; return;
    }
    if (e.button === 1 || (e.button === 0 && e.altKey && st.tool !== 'select')) { st.drag = { kind: 'pan', sx: e.clientX - st.ox, sy: e.clientY - st.oy }; return; }
    const raw = toM(e), k = e.target.dataset?.k, id = e.target.dataset?.id;
    st.shift = e.shiftKey;
    if (k === 'issue') { select({ type: 'issue', id }); return; }
    if (st.measure) {
      const p = raw;
      if (!st.measure.a) { st.measure.a = p; draw(); return; }
      const d = G.dist(st.measure.a, p); st.measure = null;
      const real = Number(prompt(T('How long is that in real life (meters)?'), r2(d)));
      if (real > 0 && d > 0.01) change(() => { plan.bgW = r2((plan.bgW || 15) * (real / d)); });
      draw(); inspector(); return;
    }
    if (st.moveFloor) { beginGesture(); st.drag = { kind: 'floor', last: raw, start: raw, total: [0, 0], base: snap() }; return; }
    // the handles of what is selected work with every tool
    if (k === 'vtx') { beginGesture(); st.drag = { kind: 'vtx', id, i: Number(e.target.dataset.i) }; return; }
    if (k === 'wend') { beginGesture(); st.drag = { kind: 'wend', id, end: e.target.dataset.end }; return; }
    if (k === 'oend') { beginGesture(); st.drag = { kind: 'oend', id, end: e.target.dataset.end }; return; }
    const t = st.tool;
    if (t === 'room') { const p = snapPoint(raw).pt; st.drag = { kind: 'new-room', p0: p, p1: p }; draw(); return; }
    if (t === 'shape' || t === 'wall') {
      if (!st.chain) st.chain = { kind: t, pts: [] };
      const last = st.chain.pts[st.chain.pts.length - 1], p = snapPoint(raw, { from: last });
      pushPoint(p.pt); return;
    }
    if (t === 'opening') {
      if (st.openKind === 'skylight') {
        const r = roomAt(raw); if (!r) { toast(T('Tap inside a room.')); return; }
        const o = G.newOpening('skylight', { room: r.id, x: r2(raw[0]), y: r2(raw[1]), rot: 0, floorId: floor.id }); change(() => plan.openings.push(o)); select({ type: 'opening', id: o.id }); return;
      }
      if (k === 'opening') { select({ type: 'opening', id }); startOpeningDrag(e, id, raw); return; }
      const h = nearestHost(raw, tolM(16)); if (!h) { toast(T('Tap on a wall.')); return; }
      addOpeningOn(h.ref, st.openKind, h.t); return;
    }
    if (t === 'stairs') {
      if (k === 'stairs') { select({ type: 'stairs', id }); startMove(e, 'stairs', id, raw); return; }
      const p = snapGrid(raw), s = { id: G.uid('s'), shape: st.stairShape, x: p[0], y: p[1], rot: 0, width: 1, len: st.stairShape === 'straight' ? 3.2 : 2.6, len2: 1.8, dia: 1.8, turn: 'right' };
      change(() => plan.stairs.push(s)); select({ type: 'stairs', id: s.id }); return;
    }
    if (t === 'paint') {
      const v = st.paint.value;
      if (k === 'edge' && st.paint.kind === 'wall') { const r = room(id), i = Number(e.target.dataset.edge); change(() => { r.edgeColors ||= {}; if (v) r.edgeColors[i] = v; else delete r.edgeColors[i]; }); return; }
      if (k === 'wall' && st.paint.kind === 'wall') { const w = wall(id); change(() => { if (v) w.color = v; else delete w.color; }); return; }
      const r = roomAt(raw); if (!r) return;
      change(() => { if (st.paint.kind === 'floor') { if (v) r.floorMat = v; else delete r.floorMat; } else { if (v) r.wallColor = v; else delete r.wallColor; delete r.edgeColors; } });
      return;
    }
    if (t === 'picture' && plan.bg) { beginGesture(); st.drag = { kind: 'pic', sx: raw[0] - (plan.bgX || 0), sy: raw[1] - (plan.bgY || 0) }; return; }
    // select
    if (k === 'opening') { select({ type: 'opening', id }); if (opening(id)?.kind === 'skylight') startMove(e, 'sky', id, raw); else startOpeningDrag(e, id, raw); return; }
    if (k === 'edge') { const i = Number(e.target.dataset.edge); select({ type: 'edge', id, edge: i }); beginGesture(); st.drag = { kind: 'edge', id, edge: i, last: raw }; return; }
    if (k === 'wall') { select({ type: 'wall', id }); startMove(e, 'wall', id, raw); return; }
    if (k === 'stairs') { select({ type: 'stairs', id }); startMove(e, 'stairs', id, raw); return; }
    if (k === 'room') { select({ type: 'room', id }); startMove(e, 'room', id, raw); return; }
    select(null); st.drag = { kind: 'pan', sx: e.clientX - st.ox, sy: e.clientY - st.oy };
  });
  function startMove(e, what, id, raw) { beginGesture(); st.drag = { kind: 'move', what, id, last: raw, total: [0, 0] }; }
  function startOpeningDrag(e, id, raw) { const o = opening(id), f = G.openingFrame(plan, o); if (!f) return; beginGesture(); st.drag = { kind: 'opening', id, grab: (raw[0] - f.host.a[0]) * f.dir[0] + (raw[1] - f.host.a[1]) * f.dir[1] - f.t0 }; }
  svg.addEventListener('pointermove', (e) => {
    if (st.pointers.has(e.pointerId)) st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pinch && st.pointers.size >= 2) {
      const [a, b] = [...st.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, P0 = st.pinch, r = svg.getBoundingClientRect();
      const nppm = Math.max(8, Math.min(320, P0.ppm * (d / (P0.d || 1)))), lx = P0.cx - r.left, ly = P0.cy - r.top;
      st.moved = true; st.ppm = nppm; st.ox = lx - ((lx - P0.ox) * nppm) / P0.ppm + (cx - P0.cx); st.oy = ly - ((ly - P0.oy) * nppm) / P0.ppm + (cy - P0.cy); draw(); return;
    }
    const raw = toM(e), d = st.drag; st.shift = e.shiftKey;
    if (!d) {
      if (st.chain || st.tool === 'room' || st.measure || st.tool === 'shape' || st.tool === 'wall') { const last = st.chain?.pts[st.chain.pts.length - 1]; st.hover = st.measure ? { pt: raw } : snapPoint(raw, { from: last }); draw(); if (st.chain) updateDrawingFields(); }
      return;
    }
    if (d.kind === 'pan') { st.moved = true; st.ox = e.clientX - d.sx; st.oy = e.clientY - d.sy; draw(); return; }
    if (d.kind === 'new-room') { const p = snapPoint(raw); d.p1 = p.pt; st.hover = p; draw(); return; }
    if (d.kind === 'pic') { plan.bgX = r2(raw[0] - d.sx); plan.bgY = r2(raw[1] - d.sy); draw(); return; }
    if (d.kind === 'floor') {   // the whole floor, with its corners pulled onto the floor below's
      plan = JSON.parse(d.base); d.total = [raw[0] - d.start[0], raw[1] - d.start[1]];
      let [dx, dy] = d.total; const mine = G.planCorners(plan); let best = null;
      for (const p of mine) for (const q of below.corners) { const ex = q[0] - (p[0] + dx), ey = q[1] - (p[1] + dy), dd = Math.hypot(ex, ey); if (dd < tolM(14) && (!best || dd < best.d)) best = { d: dd, ex, ey, q }; }
      if (best) { dx += best.ex; dy += best.ey; st.hover = { pt: best.q, mag: 'corner' }; } else st.hover = null;
      G.transformPlan(plan, G.shiftFn(dx, dy)); st.walls = G.planWalls(plan);
      // guides: an edge of this floor in line with one of the floor below
      let gx = null, gy = null; for (const p of G.planCorners(plan)) { const g2 = G.alignGuides(p, below.corners, 0.02); gx ??= g2.x; gy ??= g2.y; }
      if (gx != null || gy != null) st.hover = { ...(st.hover || { pt: [gx ?? 0, gy ?? 0] }), guide: { x: gx, y: gy } };
      draw(); return;
    }
    if (d.kind === 'vtx') {
      const r = room(d.id); if (!r) return;
      const p = snapPoint(raw, { skip: (s) => s.room === d.id && (s.edge === d.i || s.edge === (d.i - 1 + r.pts.length) % r.pts.length) });
      r.pts[d.i] = p.pt; st.hover = p; liveRefresh(); return;
    }
    if (d.kind === 'wend') { const w = wall(d.id); if (!w) return; const other = d.end === 'a' ? w.b : w.a, p = snapPoint(raw, { from: other, skip: (s) => s.wall === d.id }); w[d.end] = p.pt; st.hover = p; liveRefresh(); return; }
    if (d.kind === 'edge') {   // drag a room's side straight out or in
      const r = room(d.id); if (!r) return; const n = r.pts.length, A = r.pts[d.edge], B = r.pts[(d.edge + 1) % n], L = G.dist(A, B) || 1, nrm = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
      let k = (raw[0] - d.last[0]) * nrm[0] + (raw[1] - d.last[1]) * nrm[1]; const s = gridStep(); k = Math.round(k / s) * s; if (!k) return;
      d.last = [d.last[0] + nrm[0] * k, d.last[1] + nrm[1] * k];
      for (const j of [d.edge, (d.edge + 1) % n]) r.pts[j] = [r.pts[j][0] + nrm[0] * k, r.pts[j][1] + nrm[1] * k].map((v) => Math.round(v * 1000) / 1000);
      liveRefresh(); return;
    }
    if (d.kind === 'opening') { const o = opening(d.id), f = o && G.openingFrame(plan, o); if (!f) return; const along = (raw[0] - f.host.a[0]) * f.dir[0] + (raw[1] - f.host.a[1]) * f.dir[1]; G.placeOpening(o, f.len, Math.round((along - d.grab) / 0.05) * 0.05); liveRefresh(); return; }
    if (d.kind === 'oend') {
      const o = opening(d.id), f = o && G.openingFrame(plan, o); if (!f) return;
      const along = Math.max(0, Math.min(f.len, Math.round(((raw[0] - f.host.a[0]) * f.dir[0] + (raw[1] - f.host.a[1]) * f.dir[1]) / 0.05) * 0.05));
      const t0 = d.end === 'a' ? Math.min(along, f.t1 - 0.3) : f.t0, t1 = d.end === 'b' ? Math.max(along, f.t0 + 0.3) : f.t1;
      o.width = r2(t1 - t0); G.placeOpening(o, f.len, t0); liveRefresh(); return;
    }
    if (d.kind === 'move') {
      const it = find({ type: d.what === 'sky' ? 'opening' : d.what, id: d.id }); if (!it) return;
      let dx = raw[0] - d.last[0], dy = raw[1] - d.last[1];
      // magnet: the moved thing's nearest corner onto another corner, else the grid
      const pts = d.what === 'room' ? it.pts : d.what === 'wall' ? [it.a, it.b] : null;
      if (pts) {
        const others = { ...plan, rooms: plan.rooms.filter((r) => r.id !== d.id), walls: plan.walls.filter((w) => w.id !== d.id), extraCorners: below.corners };
        let best = null; for (const p of pts) { const q = [p[0] + dx, p[1] + dy], m = G.magnet(q, others, tolM(10)); if (m.kind === 'corner' && (!best || m.d < best.d)) best = { ...m, ex: m.pt[0] - q[0], ey: m.pt[1] - q[1] }; }
        if (best) { dx += best.ex; dy += best.ey; st.hover = { pt: best.pt, mag: 'corner' }; } else { const s = gridStep(); dx = Math.round(dx / s) * s; dy = Math.round(dy / s) * s; st.hover = null; }
      } else { const s = gridStep(); dx = Math.round(dx / s) * s; dy = Math.round(dy / s) * s; }
      if (!dx && !dy) return;
      d.last = [d.last[0] + dx, d.last[1] + dy];
      const mv = (p) => [Math.round((p[0] + dx) * 1000) / 1000, Math.round((p[1] + dy) * 1000) / 1000];
      if (d.what === 'room') it.pts = it.pts.map(mv); else if (d.what === 'wall') { it.a = mv(it.a); it.b = mv(it.b); } else { it.x = r2(it.x + dx); it.y = r2(it.y + dy); }
      liveRefresh();
    }
  });
  function liveRefresh() { st.walls = G.planWalls(plan); draw(); }
  const pointerEnd = (e) => {
    st.pointers.delete(e.pointerId);
    if (st.pinch) { if (st.pointers.size < 2) st.pinch = null; return; }
    const d = st.drag; st.drag = null;
    if (d?.kind === 'new-room') {
      const a = [Math.min(d.p0[0], d.p1[0]), Math.min(d.p0[1], d.p1[1])], b = [Math.max(d.p0[0], d.p1[0]), Math.max(d.p0[1], d.p1[1])];
      if (b[0] - a[0] >= 0.4 && b[1] - a[1] >= 0.4) { const r = { id: G.uid('r'), name: '', pts: G.rectPts(a[0], a[1], r2(b[0] - a[0]), r2(b[1] - a[1])) }; change(() => plan.rooms.push(r)); maybeFit(); select({ type: 'room', id: r.id }); setTimeout(() => document.getElementById('dz-rname')?.focus(), 30); }
      else draw();
      return;
    }
    if (d && d.kind !== 'pan') { st.hover = null; endGesture(); }
  };
  svg.addEventListener('pointerup', pointerEnd); svg.addEventListener('pointercancel', pointerEnd);
  svg.addEventListener('dblclick', () => { if (st.chain?.kind === 'wall') endChain(); else if (st.chain?.kind === 'shape') finishShape(); });
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  function updateDrawingFields() { const L = document.getElementById('dz-len'), A = document.getElementById('dz-ang'), ch = st.chain; if (!L || !ch?.pts.length || !st.hover) return; const last = ch.pts[ch.pts.length - 1]; L.placeholder = r2(G.dist(last, st.hover.pt)); if (document.activeElement !== A && G.dist(last, st.hover.pt) > 0.05) A.value = Math.round(G.angleOf(last, st.hover.pt)); }

  /* ---------- keyboard ---------- */
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  /* On the document, so it runs before the 3D page's own keys (on the window) - which then don't see the key at all while
     the drawer is open: Ctrl+Z here undoes the drawing, not the editor's last saved change. */
  const key = (e) => { if (!box.isConnected) { unbindKeys(); return; } try { onKey(e); } finally { e.stopPropagation(); } };
  const onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (mod && (k === 'z' || k === 'Z')) { if (typing()) return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { if (typing()) return; e.preventDefault(); redo(); return; }
    if (k === 'Shift') { st.shift = true; return; }
    if (typing()) return;
    if (k === 'Escape') { if (st.help) { st.help = false; drawHelp(); return; } if (st.chain) { st.chain.kind === 'shape' ? endChain(true) : endChain(); return; } st.measure = null; st.moveFloor = false; select(null); return; }
    if (k === 'Enter') { if (st.chain?.kind === 'shape') finishShape(); else if (st.chain) endChain(); return; }
    if (k === '?') { st.help = !st.help; drawHelp(); return; }
    if (st.chain && /^[0-9.]$/.test(k)) { const L = document.getElementById('dz-len'); if (L) { e.preventDefault(); L.focus(); L.value = k; } return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (st.chain) backOne(); else removeSel(); return; }
    const step = e.altKey ? 0.01 : 0.25, arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[k]) { if (nudge(...arrows[k])) e.preventDefault(); return; }
    if (mod) return;
    if (k === 'd' || k === 'D') { duplicate(); return; }
    if (k === 'r' || k === 'R') { turn90(); return; }
  };
  const keyUp = (e) => { if (e.key === 'Shift') st.shift = false; if (box.isConnected) e.stopPropagation(); };
  const unbindKeys = () => { document.removeEventListener('keydown', key); document.removeEventListener('keyup', keyUp); };
  document.addEventListener('keydown', key); document.addEventListener('keyup', keyUp);

  /* ---------- the picture ---------- */
  bgFile.onchange = async () => {
    const f = bgFile.files[0]; if (!f) return;
    try { const r = await api(`/api/floorplan/floors/${floor.id}/background`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f }); plan.bg = r.floor.plan.bg; st.bgv = Date.now(); st.bgRatio = null; st.tool = 'picture'; refresh(); toast(T('Picture added - set how wide it is (or measure a wall on it), then trace over it.')); }
    catch (e) { toast(e.message); }
  };

  /* ---------- saving and closing ---------- */
  const body = () => JSON.stringify({ ...plan, name: nameIn.value });
  async function putPlan() { await api(`/api/floorplan/floors/${floor.id}/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body() }); floor.plan = JSON.parse(JSON.stringify(plan)); floor.name = nameIn.value; }
  async function save() {
    try { await putPlan(); teardown(); toast(T('Saved')); onSave?.(); }
    catch (e) { toast(e.message); }
  }
  function close() {
    if (snap() !== saved0 && !confirm(T('Leave without saving your changes?'))) return;
    teardown();
  }
  function teardown() { unbindKeys(); preview.dispose(); ro.disconnect(); box.remove(); }

  /* ---------- the live 3D preview ---------- */
  const preview = createPreview(pvHost, () => ({ ...floor, plan, name: nameIn.value }), floors);
  function layoutPv() { box.classList.toggle('nopv', !st.preview); pvBtn.classList.toggle('on', st.preview); if (st.preview) preview.soon(0); requestAnimationFrame(draw); }
  const ro = new ResizeObserver(() => { if (!st.moved) fit(); draw(); preview.resize(); }); ro.observe(stage);   // keeps the drawing framed until you pan or zoom yourself
  layoutPv();
  requestAnimationFrame(() => { fit(); refresh(); });
  return { get plan() { return plan; }, get view() { return { ppm: st.ppm, ox: st.ox, oy: st.oy }; }, close: teardown };
}

/* A small 3D view of this floor that rebuilds a moment after each change. three.js loads only when it is first shown. */
function createPreview(host, getFloor, floors) {
  let ctx = null, timer = null, loading = null, gone = false;
  const visible = () => host.offsetParent !== null && host.clientWidth > 0;
  async function init() {
    if (ctx || loading) return loading;
    loading = (async () => {
      const [THREE, { OrbitControls }, D, H] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js'), import('./floorplan-drawn.js'), import('./floorplan-house.js')]);
      if (gone) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.prepend(renderer.domElement);
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(45, 1, 0.1, 500), controls = new OrbitControls(cam, renderer.domElement);
      scene.add(new THREE.HemisphereLight('#ffffff', '#b9a98f', 2.1)); const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(8, 14, 6); scene.add(sun);
      controls.enableDamping = false; controls.addEventListener('change', () => render());
      ctx = { THREE, renderer, scene, cam, controls, D, H, group: null, framed: false };
    })();
    return loading;
  }
  const COL = { wall: '#ece8e1', floor: '#d8d1c5', door: '#9a7552', window: '#9fd0ee', furniture: '#b8a48c', frame: '#e3ded6', roof: '#8a5a44' };
  const catOf = (o) => { for (let x = o; x; x = x.parent) { const n = x.name || ''; if (/^wall frame/i.test(n)) return 'frame'; if (/^wall blind/i.test(n)) return 'wall'; if (/^wall/i.test(n)) return 'wall'; if (/^floor/i.test(n)) return 'floor'; if (/^door/i.test(n)) return 'door'; if (/^window/i.test(n)) return 'window'; if (/^stairs/i.test(n)) return 'furniture'; } return 'wall'; };
  function render() { if (ctx && visible()) ctx.renderer.render(ctx.scene, ctx.cam); }
  function resize() { if (!ctx || !visible()) return; const w = host.clientWidth, h = host.clientHeight; ctx.renderer.setSize(w, h, false); ctx.cam.aspect = w / Math.max(1, h); ctx.cam.updateProjectionMatrix(); render(); }
  const free = (g) => g?.traverse((o) => { o.geometry?.dispose(); for (const m of [o.material].flat()) { m?.map?.dispose(); m?.dispose(); } });
  async function rebuild() {
    if (!visible()) return;
    await init(); if (!ctx || gone) return;
    const { THREE, scene, D, H } = ctx, f = getFloor();
    if (ctx.group) { scene.remove(ctx.group); free(ctx.group); }
    const g = D.buildDrawnGroup(f, { floors: floors() || [] });
    g.traverse((o) => {
      if (!o.isMesh) return;
      const cat = catOf(o), tex = o.userData.floorTex || null;
      o.material = new THREE.MeshStandardMaterial({ color: o.userData.paint || (tex ? '#ffffff' : COL[cat]), map: tex, roughness: 0.85, transparent: cat === 'window', opacity: cat === 'window' ? 0.5 : 1, side: THREE.DoubleSide });
    });
    const roof = H.buildPlanRoof(f, floors() || [], 'day');
    if (roof) { roof.traverse((o) => { if (o.material?.color) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } }); g.add(roof); }
    scene.add(g); ctx.group = g;
    if (!ctx.framed) {
      const b = new THREE.Box3().setFromObject(g); if (!b.isEmpty()) { const c = b.getCenter(new THREE.Vector3()), r = Math.max(5, b.getSize(new THREE.Vector3()).length() * 0.95); ctx.controls.target.copy(c); ctx.cam.position.set(c.x + r * 0.55, c.y + r * 0.85, c.z + r * 0.75); ctx.framed = true; }
    }
    ctx.controls.update(); resize(); render();
  }
  return {
    soon(ms = 350) { clearTimeout(timer); timer = setTimeout(() => rebuild().catch(() => {}), ms); },
    resize, dispose() { gone = true; clearTimeout(timer); if (ctx) { free(ctx.group); ctx.controls.dispose(); ctx.renderer.dispose(); ctx.renderer.domElement.remove(); } },
  };
}
