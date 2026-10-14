/* HouseOS 3D Home - draw a floor plan, for anyone without a LiDAR iPhone/iPad.
   Drag to draw rooms, click-click to draw walls, optionally over a picture of
   your floor plan (from the listing, the builder, or a photo of a paper plan).
   Units are meters; HouseOS raises the walls into 3D. */
const SNAP = 0.25;
const snap = (v, on) => (on ? Math.round(v / SNAP) * SNAP : Math.round(v * 100) / 100);
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; };
export function openDrawer(floor, { el, api, toast, onSave }) {
  const plan = JSON.parse(JSON.stringify(floor.plan || { rooms: [], walls: [] }));
  plan.rooms ||= []; plan.walls ||= [];
  const st = { tool: plan.rooms.length || plan.walls.length ? 'select' : 'room', ppm: 40, ox: 40, oy: 40, snap: true, sel: null, drag: null, wallStart: null, hover: null, bgRatio: null };
  const svg = svgEl('svg', { class: 'draw-svg' });
  // The picture is created once and only moved/resized - re-creating it on every redraw is slow and can crash some browsers.
  const gridLayer = svgEl('g'), layer = svgEl('g');
  svg.append(gridLayer, layer);
  const bgImg = el('img', { alt: '', class: 'draw-bg' });
  const stage = el('div', { class: 'draw-stage' }, bgImg, svg);
  const info = el('span', { class: 'note' });
  const toolBtn = (id, label, hint) => el('button', { type: 'button', 'data-tool': id, title: hint, onclick: () => { st.tool = id; st.wallStart = null; st.sel = null; draw(); } }, label);
  const nameIn = el('input', { type: 'text', value: floor.name, style: 'width:160px' });
  const bgFile = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none' });
  const bgW = el('input', { type: 'number', min: 1, max: 500, step: 0.5, value: plan.bgW || 15, style: 'width:80px', title: 'How wide the picture is in real life, in meters' });
  const bgOp = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: plan.bgOpacity ?? 0.6, style: 'width:90px' });
  bgW.oninput = () => { plan.bgW = Number(bgW.value) || 15; draw(); }; bgOp.oninput = () => { plan.bgOpacity = Number(bgOp.value); draw(); };
  bgFile.onchange = async () => {
    const f = bgFile.files[0]; if (!f) return;
    try { const r = await api(`/api/floorplan/floors/${floor.id}/background`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f }); plan.bg = r.floor.plan.bg; st.bgv = Date.now(); st.bgRatio = null; draw(); toast('Picture added - set how wide it is in meters, then trace over it.'); }
    catch (e) { toast(e.message); }
  };
  const roomName = el('input', { type: 'text', placeholder: 'Room name', style: 'width:150px' });
  roomName.oninput = () => { if (st.sel?.type === 'room') { plan.rooms[st.sel.i].name = roomName.value; draw(); } };
  const del = el('button', { type: 'button', onclick: () => removeSel() }, 'Delete');
  const selBar = el('span', { class: 'row', style: 'display:none' }, roomName, del);
  const box = el('div', { id: 'drawer' },
    el('div', { class: 'draw-top' }, el('b', {}, 'Draw your floor'), nameIn,
      el('span', { class: 'tools' }, toolBtn('room', '▭ Room', 'Drag to draw a room'), toolBtn('wall', '╱ Wall', 'Click where a wall starts, then where it ends'), toolBtn('select', '↖ Select', 'Click a room or wall to rename, move or delete it; drag empty space to pan')),
      selBar, el('span', { class: 'spacer' }),
      el('button', { type: 'button', onclick: () => { st.ppm = Math.min(200, st.ppm * 1.25); draw(); } }, '+'), el('button', { type: 'button', onclick: () => { st.ppm = Math.max(8, st.ppm / 1.25); draw(); } }, '−'),
      el('label', { class: 'note' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => { st.snap = e.target.checked; } }), ' Snap'),
      el('button', { type: 'button', onclick: () => box.remove() }, 'Cancel'),
      el('button', { type: 'button', class: 'primary', onclick: save }, 'Save & view in 3D')),
    el('div', { class: 'draw-top' }, el('span', { class: 'note' }, 'Floor-plan picture (optional):'), el('button', { type: 'button', onclick: () => bgFile.click() }, plan.bg ? 'Replace picture' : 'Add a picture to trace'), bgFile,
      el('span', { class: 'note' }, 'Width in real life'), bgW, el('span', { class: 'note' }, 'm · Fade'), bgOp, el('span', { class: 'spacer' }), info),
    stage);
  document.body.append(box);
  const toM = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left - st.ox) / st.ppm, (e.clientY - r.top - st.oy) / st.ppm]; };
  const P = (x) => x * st.ppm;
  function draw() {
    box.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
    selBar.style.display = st.sel ? 'inline-flex' : 'none'; roomName.style.display = st.sel?.type === 'room' ? '' : 'none';
    if (st.sel?.type === 'room' && document.activeElement !== roomName) roomName.value = plan.rooms[st.sel.i]?.name || '';
    const tf = `translate(${st.ox} ${st.oy})`;
    gridLayer.replaceChildren(); layer.replaceChildren(); gridLayer.setAttribute('transform', tf); layer.setAttribute('transform', tf);
    let g = gridLayer;
    const W = svg.clientWidth || 1000, H = svg.clientHeight || 700;
    for (let x = Math.floor(-st.ox / st.ppm); x * st.ppm < W - st.ox; x++) g.append(svgEl('line', { x1: P(x), y1: -st.oy, x2: P(x), y2: H - st.oy, class: x % 5 ? 'gl' : 'gl5' }));
    for (let y = Math.floor(-st.oy / st.ppm); y * st.ppm < H - st.oy; y++) g.append(svgEl('line', { x1: -st.ox, y1: P(y), x2: W - st.ox, y2: P(y), class: y % 5 ? 'gl' : 'gl5' }));
    if (plan.bg) {
      const href = `/api/floorplan/floors/${floor.id}/background?v=${st.bgv || 1}`;
      if (!st.bgRatio && !st.bgLoading) { st.bgLoading = true; const im = new Image(); im.onload = () => { st.bgLoading = false; st.bgRatio = im.naturalHeight / im.naturalWidth || 1; draw(); }; im.onerror = () => { st.bgLoading = false; }; im.src = href; }
      if (bgImg.getAttribute('src') !== href) bgImg.setAttribute('src', href);
      Object.assign(bgImg.style, { left: `${st.ox}px`, top: `${st.oy}px`, width: `${P(plan.bgW || 15)}px`, height: `${P((plan.bgW || 15) * (st.bgRatio || 0))}px`, opacity: plan.bgOpacity ?? 0.6, display: st.bgRatio ? '' : 'none' });
    } else bgImg.style.display = 'none';
    g = layer;
    plan.rooms.forEach((r, i) => {
      const on = st.sel?.type === 'room' && st.sel.i === i;
      g.append(svgEl('rect', { x: P(r.x), y: P(r.y), width: P(r.w), height: P(r.h), class: `room${on ? ' sel' : ''}`, 'data-room': i }));
      const t = svgEl('text', { x: P(r.x + r.w / 2), y: P(r.y + r.h / 2), class: 'rlabel' }); t.textContent = r.name || `${r.w} × ${r.h} m`; g.append(t);
      if (r.name) { const t2 = svgEl('text', { x: P(r.x + r.w / 2), y: P(r.y + r.h / 2) + 15, class: 'rdim' }); t2.textContent = `${r.w} × ${r.h} m`; g.append(t2); }
    });
    plan.walls.forEach((w, i) => g.append(svgEl('line', { x1: P(w[0]), y1: P(w[1]), x2: P(w[2]), y2: P(w[3]), class: `wall${st.sel?.type === 'wall' && st.sel.i === i ? ' sel' : ''}`, 'data-wall': i })));
    if (st.drag?.kind === 'new-room') { const d = st.drag; g.append(svgEl('rect', { x: P(Math.min(d.x0, d.x1)), y: P(Math.min(d.y0, d.y1)), width: P(Math.abs(d.x1 - d.x0)), height: P(Math.abs(d.y1 - d.y0)), class: 'room ghost' })); }
    if (st.wallStart && st.hover) g.append(svgEl('line', { x1: P(st.wallStart[0]), y1: P(st.wallStart[1]), x2: P(st.hover[0]), y2: P(st.hover[1]), class: 'wall ghost' }));
    info.textContent = st.tool === 'room' ? 'Drag to draw a room. Each square is 1 m.' : st.tool === 'wall' ? (st.wallStart ? 'Click where the wall ends (Esc to stop).' : 'Click where a wall starts.') : 'Click a room or wall to select it. Drag a room to move it. Drag empty space to pan.';
  }
  svg.addEventListener('pointerdown', (e) => {
    const [mx, my] = toM(e), x = snap(mx, st.snap), y = snap(my, st.snap);
    const roomHit = e.target.dataset?.room, wallHit = e.target.dataset?.wall;
    if (st.tool === 'room') { st.drag = { kind: 'new-room', x0: x, y0: y, x1: x, y1: y }; }
    else if (st.tool === 'wall') {
      if (!st.wallStart) st.wallStart = [x, y];
      else { if (x !== st.wallStart[0] || y !== st.wallStart[1]) plan.walls.push([...st.wallStart, x, y]); st.wallStart = [x, y]; }
    } else if (roomHit != null) { st.sel = { type: 'room', i: Number(roomHit) }; const r = plan.rooms[st.sel.i]; st.drag = { kind: 'move', dx: mx - r.x, dy: my - r.y }; }
    else if (wallHit != null) { st.sel = { type: 'wall', i: Number(wallHit) }; st.drag = null; }
    else { st.sel = null; st.drag = { kind: 'pan', sx: e.clientX - st.ox, sy: e.clientY - st.oy }; }
    svg.setPointerCapture(e.pointerId); draw();
  });
  svg.addEventListener('pointermove', (e) => {
    const [mx, my] = toM(e); st.hover = [snap(mx, st.snap), snap(my, st.snap)];
    const d = st.drag;
    if (d?.kind === 'new-room') { d.x1 = st.hover[0]; d.y1 = st.hover[1]; info.textContent = `${Math.abs(d.x1 - d.x0).toFixed(2)} × ${Math.abs(d.y1 - d.y0).toFixed(2)} m`; }
    else if (d?.kind === 'move') { const r = plan.rooms[st.sel.i]; r.x = snap(mx - d.dx, st.snap); r.y = snap(my - d.dy, st.snap); }
    else if (d?.kind === 'pan') { st.ox = e.clientX - d.sx; st.oy = e.clientY - d.sy; }
    if (d || st.wallStart) { draw(); if (d?.kind === 'new-room') info.textContent = `${Math.abs(d.x1 - d.x0).toFixed(2)} × ${Math.abs(d.y1 - d.y0).toFixed(2)} m`; }
  });
  svg.addEventListener('pointerup', () => {
    const d = st.drag; st.drag = null;
    if (d?.kind === 'new-room') {
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      if (w >= 0.5 && h >= 0.5) { plan.rooms.push({ name: '', x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: +w.toFixed(2), h: +h.toFixed(2) }); st.sel = { type: 'room', i: plan.rooms.length - 1 }; setTimeout(() => roomName.focus(), 30); }
    }
    draw();
  });
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 1 / 1.1, r = svg.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top; st.ox = cx - (cx - st.ox) * f; st.oy = cy - (cy - st.oy) * f; st.ppm = Math.max(8, Math.min(200, st.ppm * f)); draw(); }, { passive: false });
  function removeSel() { if (!st.sel) return; (st.sel.type === 'room' ? plan.rooms : plan.walls).splice(st.sel.i, 1); st.sel = null; draw(); }
  const key = (e) => { if (!box.isConnected) return removeEventListener('keydown', key); if (e.key === 'Escape') { st.wallStart = null; st.drag = null; draw(); } if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement?.tagName !== 'INPUT') removeSel(); };
  addEventListener('keydown', key);
  async function save() {
    try { await api(`/api/floorplan/floors/${floor.id}/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nameIn.value, rooms: plan.rooms, walls: plan.walls, bgW: plan.bgW, bgOpacity: plan.bgOpacity }) }); box.remove(); toast('Saved'); onSave?.(); }
    catch (e) { toast(e.message); }
  }
  requestAnimationFrame(draw);
}
