/* The 3D home editor's one shared language (floorplan.js calls in here):
   - the editor's tabs, each with the same icon style as the drawing tools, and a one-line hint saying what that tab is for;
   - "Build your home in 3 steps" for an empty plan: get the shape (scan with a phone, draw it, or upload a plan),
     furnish it, put the devices where they are;
   - "What can I add?": one searchable list of everything that can go on the plan. Picking one opens the right tab
     and starts the right tool, so nobody has to know which tab a fence or a router lives in.
   Nothing here talks to the server or to three.js; the caller passes in what to do. */

const TT = (s, v) => (typeof window !== 'undefined' && typeof window.T === 'function' ? window.T(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));

/* 24 px line icons, drawn the same way as the drawing editor's tool rail. */
const PATH = {
  floors: 'M3 10l9-6 9 6v10H3zM9 20v-6h6v6', rooms: 'M4 5h16v14H4zM12 5v6M4 13h8', furniture: 'M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 17v-4a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4zM5 17v2M19 17v2',
  yard: 'M12 22v-6M7 16h10l-5-12zM9 11h6', devices: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z', network: 'M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01',
  colors: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.3-1-2.5 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5zM7.5 11h.01M10 7.5h.01M15 7.5h.01',
  plus: 'M12 5v14M5 12h14', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5', phone: 'M7 2h10v20H7zM11 18h2', pencil: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', picture: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01', file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  door: 'M5 21V3h11v18M5 21h14M13 12h.01', window: 'M4 4h16v16H4zM12 4v16M4 12h16', stairs: 'M3 20h5v-4h4v-4h4V8h5', roof: 'M2 12l10-8 10 8M5 10v10h14V10', wall: 'M4 20L20 4',
  tree: 'M12 22v-6M7 16h10l-5-12z', fence: 'M4 21V7l2-3 2 3v14M16 21V7l2-3 2 3v14M4 11h16M4 17h16', ground: 'M3 17l6-4 4 3 8-6M3 21h18', box: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z', check: 'M5 12l5 5 9-11', info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01', close: 'M6 6l12 12M18 6L6 18',
};
export function icon(k, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [a, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(a, v);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', PATH[k] || PATH.box); s.append(p); return s;
}

/* The tabs, in the order a home gets built: the shape, the rooms, what's inside, outside, then the live things. */
export const TABS = [['floors', 'Floors'], ['rooms', 'Rooms'], ['furniture', 'Furniture'], ['yard', 'Outdoor'], ['devices', 'Devices'], ['network', 'Network'], ['colors', 'Colors']];
export const TAB_HINT = {
  floors: 'Draw, scan or upload each floor, then stack them by level.',
  rooms: 'Name and color the rooms - they become buttons in the 3D view.',
  furniture: 'Pick a piece, then tap the floor. Drag to move it, tap it for more.',
  yard: 'Draw lawns, paths and fences on the ground; place trees, bins and pots.',
  devices: 'Drag a device onto the house - or tap it, then tap the spot.',
  network: 'Put Wi-Fi access points, network gear and servers where they really are.',
  colors: 'Choose a look, change any color, or paint a single wall or sofa.',
};
export function tabBar({ el }, cur, pick) {
  return el('div', { class: 'tabs edtabs', role: 'tablist', 'aria-label': TT('Edit') }, ...TABS.map(([k, n]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(cur === k), class: cur === k ? 'on' : '', 'data-tab': k, onclick: () => pick(k) }, icon(k, 16), el('span', {}, TT(n)))));
}
export function tabHint({ el }, k) { return TAB_HINT[k] ? el('p', { class: 'tabhint' }, icon('info', 14), el('span', {}, TT(TAB_HINT[k]))) : null; }

/* ---------- Build your home in 3 steps ---------- */
/* ctx: { el, pro, canScan, scan(), uploadScan(), draw(), trace(), importPlan(), hasFloors, close? } */
export function startGuide(ctx) {
  const { el } = ctx, off = !ctx.pro;
  const way = (ic, title, text, buttons) => el('div', { class: 'way' }, el('div', { class: 'wayic' }, icon(ic, 22)), el('div', { class: 'waytx' }, el('b', {}, TT(title)), el('small', {}, TT(text)), el('div', { class: 'row' }, ...buttons)));
  const btn = (label, fn, primary) => el('button', { type: 'button', class: `mini${primary ? ' primary' : ''}`, disabled: off ? true : null, onclick: fn }, TT(label));
  const step = (n, title, text, body, done) => el('li', { class: `gstep${done ? ' done' : ''}` }, el('span', { class: 'gnum', 'aria-hidden': 'true' }, done ? icon('check', 14) : String(n)), el('div', {}, el('b', {}, TT(title)), text ? el('p', { class: 'note' }, TT(text)) : null, body || null));
  return el('div', { class: 'startguide' },
    el('h2', {}, TT('Build your home in 3 steps')),
    el('ol', { class: 'gsteps' },
      step(1, 'Get the shape of your home', ctx.hasFloors ? 'Done - add more floors any time in Edit > Floors.' : 'Pick one way. You can mix them later: scan one floor, draw another.', ctx.hasFloors ? null : el('div', { class: 'ways' },
        way('phone', 'Scan with your phone', ctx.canScan ? 'This phone has a LiDAR scanner: walk each room slowly and the scan comes straight in.' : 'An iPhone or iPad Pro with LiDAR and a room-scanning app: export GLB or USDZ, then upload it here.',
          ctx.canScan ? [btn('Scan a room', ctx.scan, true), btn('Upload a scan', ctx.uploadScan)] : [btn('Upload a scan', ctx.uploadScan, true)]),
        way('pencil', 'Draw it', 'Any device. Drag rooms on a 1 m grid, then add doors, windows, stairs and the roof.', [btn('Draw a floor', ctx.draw, true)]),
        way('upload', 'Upload a plan', 'Trace over a picture of your floor plan, or import a Sweet Home 3D (.sh3d) or DXF file.', [btn('Trace a picture', ctx.trace, true), btn('Import a file', ctx.importPlan)])), ctx.hasFloors),
      step(2, 'Furnish it', 'Furniture inside; lawns, paths, fences, trees, bins and pots outside. Use "Add" to find anything.'),
      step(3, 'Put your devices where they are', 'Lights, sensors, cameras and speakers: drag each one onto the house, and it shows live.')),
    off ? el('p', { class: 'note' }, TT('Editing the 3D home is part of CasaTorch Pro.')) : null);
}

/* ---------- What can I add? ---------- */
/* ctx: { el, modal, closeModal, items: [{ group, label, icon, hint?, words?, run }] } */
export function addPicker(ctx) {
  const { el } = ctx, all = ctx.items.filter(Boolean);
  const norm = (s) => String(s || '').toLowerCase();
  const list = el('div', { class: 'addlist', role: 'listbox', 'aria-label': TT('Things you can add') });
  const input = el('input', { type: 'search', placeholder: TT('Search: sofa, door, fence, router…'), 'aria-label': TT('What can I add?'), autocomplete: 'off' });
  let shown = [];
  const pick = (it) => { ctx.closeModal(); it.run(); };
  function draw() {
    const q = norm(input.value).trim(), words = q.split(/\s+/).filter(Boolean);
    shown = all.filter((it) => { const hay = norm(`${it.label} ${it.group} ${it.words || ''} ${it.hint || ''}`); return words.every((w) => hay.includes(w)); });
    const groups = new Map(); for (const it of shown) groups.set(it.group, [...(groups.get(it.group) || []), it]);
    list.replaceChildren(...[...groups].flatMap(([g, items]) => [el('h3', {}, TT(g)), el('div', { class: 'addgrid' }, ...items.map((it) => el('button', { type: 'button', class: 'additem', role: 'option', onclick: () => pick(it) }, it.iconFn ? it.iconFn() : icon(it.icon || 'box', 18), el('span', {}, it.label), it.hint ? el('small', {}, it.hint) : null)))]),
      ...(shown.length ? [] : [el('p', { class: 'note' }, TT('Nothing by that name. Try another word - or draw it as a room or a shape.'))]));
  }
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && shown.length) { e.preventDefault(); pick(shown[0]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('.additem')?.focus(); }
  });
  list.addEventListener('keydown', (e) => {   // arrows move through the results
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const b = [...list.querySelectorAll('.additem')], i = b.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const j = i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
    if (j < 0) input.focus(); else b[Math.min(j, b.length - 1)].focus();
  });
  draw();
  ctx.modal(el('div', { class: 'box addbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': TT('What can I add?') },
    el('div', { class: 'rhead' }, el('h2', {}, TT('What can I add?')), el('button', { type: 'button', class: 'iconbtn', 'aria-label': TT('Close'), onclick: ctx.closeModal }, icon('close', 18))),
    el('div', { class: 'addsearch' }, icon('search', 16), input), list));
  setTimeout(() => input.focus(), 0);
}
