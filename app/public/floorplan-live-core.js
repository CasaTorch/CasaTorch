/* The 3D home, live: the small pure rules behind it (no three.js, no page), so they can be tested on their own.
   - How far a door, window, blind or garage door is open, and how it moves there smoothly.
   - Which glow a device gets (heating red, cooling blue, a cooktop on, a TV playing, a lamp in its own color).
   - What every device looked like at a moment in the past ("Replay the day").
   - Quality levels for wall tablets, night dimming, and the "window open while it rains" rule. */

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/* Smoothly toward a target: a critically damped step that never overshoots, the same feel at any frame rate.
   rate: about how many times per second it closes most of the gap (4 = a calm ~0.7 s move). Snaps when close. */
export function approach(cur, target, dt, rate = 4) {
  if (!Number.isFinite(cur)) return target;
  const k = 1 - Math.exp(-rate * Math.max(0, Math.min(0.25, dt)));
  const next = cur + (target - cur) * k;
  return Math.abs(target - next) < 0.002 ? target : next;
}

/* How open a thing is, 0 (shut) to 1 (fully open), from what the device says.
   A contact sensor: open or not. A cover: its position (0-100) when it has one, else open/closed (and "opening" counts). */
export function openAmount(d) {
  if (!d) return 0;
  const pos = num(d.position);
  if (pos != null) return clamp01(pos / 100);
  if (d.tilt === true) return 0.35;   // a window on tilt: a little open
  if (d.open != null) return d.open ? 1 : 0;
  if (typeof d.state === 'string') return /^(open|opening|on)$/.test(d.state) ? 1 : 0;
  if (d.on != null) return d.on ? 1 : 0;
  return 0;
}
/* How much of a window a blind/curtain/screen covers: the reverse of how open it is (position 100 = fully up/open). */
export const coverAmount = (d) => 1 - openAmount(d);

/* How a door leaf, window sash, roof window, slider or garage door moves when it is k open (0..1), following the drawn
   floors' openings (floorplan-openings.js): each leaf's origin is its pivot, openDir (+1/-1) says which way it swings,
   slide/lift say how far a slider or a garage door travels. Returns offsets from the closed pose:
   ry (turn about up), rx (tip), dx (slide along the wall), dy (lift), sy (squash: a garage door rolling up into its drum at the top),
   ry2 (a double door's second leaf), ryPanel2 (a bifold's second panel). */
export function leafMotion(kind, k, { openDir = 1, slide = 0, lift = 0, tilt = false } = {}) {
  k = clamp01(k);
  const out = { ry: 0, rx: 0, dx: 0, dy: 0, sy: 1, ry2: 0, ryPanel2: 0 };
  if (kind === 'slider') out.dx = slide * k;
  else if (kind === 'garage') { out.sy = 1 - 0.92 * k; out.dy = (lift || 2) * 0.92 * k; }   // rolls up: the bottom rises, the top stays
  else if (kind === 'skylight') out.rx = openDir * 0.52 * k;   // a roof window lifts ~30° at its bottom edge
  else if (kind === 'window' && tilt) out.rx = -0.21 * k;   // tipped in ~12° at the top
  else {
    const ang = (kind === 'window' ? 0.9 : kind === 'bifold' ? 1.3 : 1.4) * k;   // a window ~50°, a door ~80°
    out.ry = openDir * ang; out.ry2 = -openDir * ang; out.ryPanel2 = -2 * openDir * ang;
  }
  return out;
}

/* Heating or cooling: Home Assistant's hvac_action when it is there, else a careful guess from the mode and temperatures. */
export function hvacOf(d) {
  if (!d || d.kind !== 'climate') return null;
  const a = String(d.hvac || d.hvacAction || '').toLowerCase();
  if (a) return a === 'heating' || a === 'preheating' ? 'heating' : a === 'cooling' ? 'cooling' : a === 'drying' ? 'drying' : a === 'fan' ? 'fan' : a === 'off' ? 'off' : 'idle';
  const mode = String(d.mode || '').toLowerCase(), t = num(d.tempC), want = num(d.targetC);
  if (!mode || mode === 'off') return 'off';
  if (t == null || want == null) return 'idle';
  if ((mode === 'heat' || mode === 'heat_cool' || mode === 'auto') && t < want - 0.2) return 'heating';
  if ((mode === 'cool' || mode === 'heat_cool' || mode === 'auto') && t > want + 0.2) return 'cooling';
  return 'idle';
}
const COOK = /cooktop|stove|\bhob\b|\boven\b|\brange\b|induction|griddle|air ?fryer/i;
const TVISH = /\btv\b|television|projector|\bscreen\b|apple ?tv|chromecast|roku|shield|fire ?tv/i;
const STRIP = /strip|backlight|ambilight|bias|\bled\b|lightstrip|gradient|play ?bar|sync ?box/i;
export const isCooktop = (d) => !!d && d.kind !== 'light' && COOK.test(`${d.name || ''} ${d.id || ''}`) && (d.kind !== 'sensor' || d.powerW != null);
export const isTv = (d) => !!d && d.kind === 'media' && (d.haClass === 'tv' || TVISH.test(`${d.name || ''} ${d.id || ''}`));
export const isStrip = (d) => !!d && d.kind === 'light' && STRIP.test(`${d.name || ''} ${d.id || ''}`);
/* A lamp's color: its real color (RGB, or white by color temperature) unless the owner fixed one color for it. */
export function lampColor(d, pin, kelvinToHex, fixed) {
  if (pin?.color && fixed) return pin.color;
  if (d?.rgb) return d.rgb;
  if (d?.kelvin && kelvinToHex) return kelvinToHex(d.kelvin);
  return pin?.color || '#ffc477';
}
/* The extra glows the live view adds: [color, strength 0..1] or null. Heating red, cooling blue, a cooktop or oven on,
   a TV playing (soft, cool white). Lights, alarms, open doors and plugs keep the glows floorplan.js already gives them. */
export function liveGlow(d) {
  if (!d || d.online === false) return null;
  const h = hvacOf(d);
  if (h === 'heating') return ['#ff5a36', 0.55];
  if (h === 'cooling') return ['#3b9cff', 0.55];
  if (isCooktop(d)) { const w = num(d.powerW); if ((w != null && w > 60) || (w == null && (d.on || /^(on|heating|cooking|preheat)/i.test(d.state || '')))) return ['#ff6a1a', w != null ? Math.min(0.8, 0.3 + w / 4000) : 0.5]; }
  if (isTv(d) && d.playing) return ['#a5c8ff', 0.4];
  return null;
}
/* A ceiling fan's speed in turns per second: off 0, then by percentage (a high fan ~3 turns a second; drawn as a blur well before that). */
export function fanTurns(d) {
  if (!d || !d.on || d.online === false) return 0;
  const p = num(d.percent ?? d.percentage);
  return p == null ? 1.6 : p <= 0 ? 0 : 0.5 + (p / 100) * 2.5;
}

/* ---------- Replay the day ---------- */
/* series: { id: [[t(ms), {fields}], ...] } sorted by time. The fields each device had at time t: every change up to t applied
   in order, starting from the first known state (so a light that was on before the window began shows on). */
export function stateAt(changes, t) {
  if (!changes?.length) return null;
  let lo = 0, hi = changes.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (changes[m][0] <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
  const out = {};
  for (let i = 0; i <= Math.max(0, idx); i++) Object.assign(out, changes[i][1]);
  return out;
}
export function replayFrame(series, t) {
  const out = {};
  for (const [id, ch] of Object.entries(series || {})) { const s = stateAt(ch, t); if (s) out[id] = s; }
  return out;
}
/* Dots on the timeline: doors and windows opening, alarms, motion (all of it, or only at night), lights switched on. */
export function replayDots(series, kinds, from, to, isNight) {
  const dots = [];
  for (const [id, ch] of Object.entries(series || {})) {
    const kind = kinds?.[id] || '';
    let prev = {};
    for (const [t, f] of ch) {
      if (t >= from && t <= to) {
        if (f.water || f.smoke) dots.push({ t, id, type: 'alarm' });
        else if (f.open === true && prev.open !== true) dots.push({ t, id, type: 'open' });
        else if (f.motion === true && prev.motion !== true && (!isNight || isNight(t))) dots.push({ t, id, type: 'motion' });
        else if (kind === 'light' && f.on === true && prev.on !== true) dots.push({ t, id, type: 'light' });
      }
      prev = { ...prev, ...f };
    }
  }
  return dots.sort((a, b) => a.t - b.t);
}
/* The power line at time t from a list of [t, watts] samples (straight between samples). */
export function powerAt(samples, t) {
  if (!samples?.length) return null;
  if (t <= samples[0][0]) return samples[0][1];
  for (let i = 1; i < samples.length; i++) if (t <= samples[i][0]) { const [t0, a] = samples[i - 1], [t1, b] = samples[i]; return t1 === t0 ? b : a + (b - a) * (t - t0) / (t1 - t0); }
  return samples[samples.length - 1][1];
}

/* ---------- wall tablets ---------- */
/* Quality levels: what each one turns on. 'auto' starts from Normal and steps down by itself on a slow screen. */
export const QUALITY = {
  old: { ratio: 0.75, shadows: false, frameMs: 66, idleMs: 400, pets: false, sunPatches: false },   // about 15 pictures a second while something moves
  normal: { ratio: 1, shadows: true, frameMs: 40, idleMs: 250, pets: true, sunPatches: true },
  high: { ratio: 2, shadows: true, frameMs: 16, idleMs: 250, pets: true, sunPatches: true },
};
export function qualityOf(level, dpr = 1, autoStep = 0) {
  const base = QUALITY[level] || (autoStep >= 2 ? QUALITY.old : QUALITY.normal);
  return { ...base, ratio: Math.min(base.ratio, level === 'high' ? Math.min(2, dpr) : Math.max(0.75, Math.min(1.5, dpr))), level: QUALITY[level] ? level : 'auto' };
}
/* Night dimming: 'off', 'sun' (from sunset to sunrise - by the sun's height when the place is known, else 21:00-07:00), or 'hours'. */
export function dimNow(mode, date, sunEl, from = '22:00', to = '07:00') {
  if (!mode || mode === 'off') return false;
  if (mode === 'sun' && sunEl != null) return sunEl < -0.05;
  const [f, t] = mode === 'sun' ? ['21:00', '07:00'] : [from, to];
  const m = (s) => { const [h, mi] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (mi || 0); };
  const now = date.getHours() * 60 + date.getMinutes(), a = m(f), b = m(t);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

/* A camera's view wedge on the floor: yaw (degrees, 0 = +x), fov (degrees) and reach (m), as a fan of points around (0,0). */
export function wedgePoints(yaw = 0, fov = 90, reach = 6, steps = 16) {
  const a0 = (yaw - fov / 2) * Math.PI / 180, a1 = (yaw + fov / 2) * Math.PI / 180, pts = [[0, 0]];
  for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * (i / steps); pts.push([Math.cos(a) * reach, Math.sin(a) * reach]); }
  return pts;
}

/* Which alerts fly to the house on a wall panel ("Show what's happening"): a doorbell press, a person seen, or a new critical alert. */
export function happeningOf(ev) {
  if (!ev) return null;
  const id = String(ev.id || ''), title = String(ev.title || '');
  if (/doorbell|ding/i.test(id) || /at the (front )?door|doorbell/i.test(title)) return 'doorbell';
  if (/person/i.test(id) || /\bperson\b/i.test(title)) return 'person';
  if (ev.severity === 'critical') return 'critical';
  return null;
}

/* A sunlight patch cut to the floor it falls on: polygon [[x, z]...] clipped to the box [minX, minZ, maxX, maxZ]
   (the part beyond would hit a wall first). Sutherland-Hodgman, one edge of the box at a time. */
export function clipToBox(poly, [x0, z0, x1, z1]) {
  let out = poly;
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]], [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= z0, (a, b) => [a[0] + (b[0] - a[0]) * (z0 - a[1]) / (b[1] - a[1]), z0]], [(p) => p[1] <= z1, (a, b) => [a[0] + (b[0] - a[0]) * (z1 - a[1]) / (b[1] - a[1]), z1]]];
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (!out.length) return [];
  }
  return out;
}
