/* CasaTorch 3D Home - the plain math behind "Network on the plan" and voice "Show me" (no 3D, no page: the unit
   tests load this file directly).

   Wi-Fi coverage is an ESTIMATE from where the access points are placed - never a measurement:
     signal at a spot = AP_DBM - 10 * N * log10(distance in m) - WALL_DB per wall crossed - FLOOR_DB per floor between
   with the usual indoor values (about -35 dBm a meter from an access point, exponent 3, 4 dB a wall, 15 dB a floor).
   The strongest access point wins. Real signal depends on walls' materials, furniture, channels and the phone. */
export const WIFI = { AP_DBM: -35, N: 3, WALL_DB: 4, FLOOR_DB: 15, MAX_WALLS: 8 };
export const WIFI_LEVELS = [[-60, 'strong'], [-67, 'good'], [-75, 'fair'], [-200, 'weak']];
export const WIFI_COLORS = { strong: '#22c55e', good: '#a3e635', fair: '#fbbf24', weak: '#ef4444', none: '#64748b' };
/** The estimated signal (dBm) from one access point. */
export function estimateDbm(distM, walls = 0, floors = 0) {
  const d = Math.max(1, Number(distM) || 0), w = Math.min(WIFI.MAX_WALLS, Math.max(0, walls | 0));
  return Math.round(WIFI.AP_DBM - 10 * WIFI.N * Math.log10(d) - WIFI.WALL_DB * w - WIFI.FLOOR_DB * Math.max(0, Math.abs(floors | 0)));
}
export const wifiLevel = (dbm) => (dbm == null || !Number.isFinite(dbm) ? 'none' : WIFI_LEVELS.find(([min]) => dbm >= min)[1]);
/* 2D segment crossing (x, z), ends touching do not count. */
function crosses(p, q, a, b) {
  const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]); if (Math.abs(d) < 1e-9) return null;
  const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d, u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1 ? t : null;
}
/** How many walls a straight line from p to q goes through. walls: [[x1, z1, x2, z2], ...]. Two walls drawn on top of
 *  each other (two rooms sharing an edge) count once: crossings closer than 25 cm along the line are one wall. */
export function wallsBetween(p, q, walls) {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ts = [];
  for (const w of walls || []) { const t = crosses(p, q, [w[0], w[1]], [w[2], w[3]]); if (t != null) ts.push(t * len); }
  ts.sort((a, b) => a - b); let n = 0, last = -Infinity;
  for (const t of ts) { if (t - last > 0.25) n++; last = t; }
  return n;
}
/** Each room's estimate: rooms [{ x, z, level }], aps [{ x, y?, z, level, online }], walls by level { [level]: [[x1,z1,x2,z2]] }.
 *  Returns [{ dbm, level: 'strong'|'good'|'fair'|'weak'|'none', ap: index of the best access point }]. */
export function roomCoverage(rooms, aps, wallsByLevel = {}) {
  const live = (aps || []).map((a, i) => ({ ...a, i })).filter((a) => a.online !== false);
  return (rooms || []).map((r) => {
    let best = null;
    for (const a of live) {
      const floors = (r.level || 0) - (a.level || 0), dy = floors * 3;
      const dist = Math.hypot(r.x - a.x, r.z - a.z, dy);
      const walls = wallsBetween([a.x, a.z], [r.x, r.z], wallsByLevel[r.level || 0] || []);
      const dbm = estimateDbm(dist, walls, floors);
      if (!best || dbm > best.dbm) best = { dbm, ap: a.i, walls };
    }
    return best ? { ...best, level: wifiLevel(best.dbm) } : { dbm: null, level: 'none', ap: -1, walls: 0 };
  });
}

/* ---------- voice: "show me the kitchen" ----------
   A small matcher, no AI: when what was said asks to see something (or is just a name), and a room, floor, device or
   network pin has that name, the view flies there. Anything else goes to the Home AI Agent. */
const NUMS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', first: '1', second: '2', third: '3' };
export const normText = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().replace(/[\u2019']/g, '').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim()
  .split(' ').map((w) => NUMS[w] || w).join(' ');
/* Ways to ask to see something, at the start (most languages) or anywhere (Japanese, Chinese, Korean, Hindi, Turkish put the verb last). */
const LEAD = ['show me', 'show', 'go to', 'take me to', 'fly to', 'zoom to', 'zoom in on', 'zoom into', 'where is', 'wheres', 'find', 'look at', 'jump to',
  'muestrame', 'ensename', 'mostrar', 'ir a', 'llevame a', 'donde esta', 'zeig mir', 'zeige mir', 'zeig', 'zeige', 'geh zu', 'gehe zu', 'wo ist',
  'montre moi', 'montre', 'affiche', 'va a', 'aller a', 'ou est', 'mostre me', 'me mostre', 'mostra me', 'mostra', 'va para', 'ir para', 'onde esta',
  'mostrami', 'fammi vedere', 'vai a', 'vai al', 'vai alla', 'dove e', 'laat me zien', 'toon me', 'toon', 'ga naar', 'waar is', 'pokaz mi', 'pokaz', 'idz do', 'gdzie jest',
  'visa mig', 'visa', 'ga till', 'var ar', 'bana goster', 'goster'];
const TAIL = ['見せて', '表示して', '表示', 'を見せて', '显示', '给我看', '看看', '보여줘', '보여 줘', '보여주세요', 'दिखाओ', 'दिखाइए', 'दिखाएं', 'goster', 'gosterir misin', 'zeigen', 'anzeigen', 'sehen'];
const FILL = new Set(['the', 'my', 'our', 'a', 'please', 'el', 'la', 'los', 'las', 'mi', 'mis', 'der', 'die', 'das', 'den', 'dem', 'mein', 'meine', 'meinen', 'bitte', 'le', 'les', 'l', 'mon', 'ma', 'mes', 'o', 'os', 'as', 'meu', 'minha', 'il', 'lo', 'gli', 'mio', 'mia', 'de', 'het', 'mijn', 'moj', 'moja', 'min', 'mitt', 'mina', 'en', 'ett', 'beni', 'room', 'to', 'at', 'on', 'of', 'in', 'を', 'の', '을', '를', '좀', 'को', 'me']);
const HOUSE = ['whole house', 'the house', 'house', 'home', 'everything', 'all floors', 'overview', 'toda la casa', 'casa', 'ganzes haus', 'haus', 'toute la maison', 'maison', 'casa toda', 'tutta la casa', 'hele huis', 'huis', 'caly dom', 'dom', 'hela huset', 'huset', 'butun ev', 'ev', '家全体', '全体', '整个房子', '全部', '집 전체', '전체', 'पूरा घर', 'घर'];
const DOWN = ['downstairs', 'ground floor', 'first floor', 'abajo', 'planta baja', 'unten', 'erdgeschoss', 'en bas', 'rez de chaussee', 'embaixo', 'terreo', 'giu', 'piano terra', 'beneden', 'begane grond', 'na dole', 'parter', 'nere', 'bottenvaning', 'alt kat', 'zemin kat', '1階', '一楼', '1층', 'नीचे'];
const UP = ['upstairs', 'arriba', 'oben', 'en haut', 'em cima', 'sopra', 'di sopra', 'boven', 'na gorze', 'uppe', 'ovanvaning', 'ust kat', '2階', '二楼', '2층', 'ऊपर'];
const toks = (s) => s.split(' ').filter((w) => w && !FILL.has(w)).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
function score(q, name) {
  const a = normText(name); if (!a || !q) return 0;
  if (a === q) return 1;
  const qa = toks(q).join(' '), aa = toks(a).join(' ');
  if (qa && qa === aa) return 0.97;
  if (aa && (` ${qa} `.includes(` ${aa} `))) return 0.85 * Math.min(1, aa.length / Math.max(qa.length, 1)) + 0.1;
  if (qa && (` ${aa} `.includes(` ${qa} `))) return 0.8 * Math.min(1, qa.length / aa.length) + 0.1;
  if (/[぀-鿿가-힯]/.test(q) && (q.includes(a) || a.includes(q))) return 0.8;   // no spaces between words
  const A = new Set(toks(a)), Q = toks(q); if (!A.size || !Q.length) return 0;
  const hit = Q.filter((w) => A.has(w)).length; return hit ? 0.6 * hit / Math.max(A.size, Q.length) : 0;
}
/** What was said -> where to go. index: { rooms: [{ name, floor, i }], floors: [{ id, name, level }], devices: [{ id, name }], pins: [{ ref, name }] }.
 *  Returns { kind: 'room'|'floor'|'device'|'pin'|'house', ...target, said } or null (for the Home AI Agent). */
export function matchVoice(text, index = {}) {
  let q = normText(text); if (!q) return null;
  let intent = false;
  for (const l of LEAD) if (q === l || q.startsWith(`${l} `)) { q = q.slice(l.length).trim(); intent = true; break; }
  for (const t of TAIL) { const n = normText(t); if (n && (q.endsWith(` ${n}`) || q.endsWith(n)) && q !== n) { q = q.slice(0, q.length - n.length).trim(); intent = true; break; } }
  q = q.split(' ').filter((w) => !FILL.has(w)).join(' ').trim();
  if (!q) return intent ? { kind: 'house', said: text } : null;
  const floors = index.floors || [], byLevel = [...floors].sort((a, b) => (a.level || 0) - (b.level || 0));
  const cands = [
    ...(index.rooms || []).map((r) => ({ kind: 'room', name: r.name, floor: r.floor, i: r.i, pri: 3 })),
    ...floors.map((f) => ({ kind: 'floor', name: f.name, id: f.id, pri: 2 })),
    ...(index.devices || []).map((d) => ({ kind: 'device', name: d.name, id: d.id, pri: 1 })),
    ...(index.pins || []).map((p) => ({ kind: 'pin', name: p.name, ref: p.ref, pri: 1 })),
  ];
  let best = null;
  for (const c of cands) { const s = score(q, c.name); if (s > 0 && (!best || s > best.s || (s === best.s && c.pri > best.c.pri))) best = { s, c }; }
  const need = intent ? 0.5 : 0.97;   // without "show me", only a whole name moves the view ("kitchen lights on" goes to the agent)
  if (best && best.s >= need) { const { pri, ...t } = best.c; return { ...t, said: text }; }
  if (intent || q.split(' ').length <= 2) {
    if (HOUSE.some((h) => q === normText(h))) return { kind: 'house', said: text };
    if (byLevel.length > 1 && DOWN.some((h) => q === normText(h))) return { kind: 'floor', id: byLevel[0].id, name: byLevel[0].name, said: text };
    if (byLevel.length > 1 && UP.some((h) => q === normText(h))) return { kind: 'floor', id: byLevel[1].id, name: byLevel[1].name, said: text };
  }
  return null;
}
