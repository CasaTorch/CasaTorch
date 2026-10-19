/* ======================================================================
 * Themes and backgrounds: Settings › Look & main bar, and setup's
 * "Make it yours" step. Saved for the home in config.ui.look.
 *  - Themes are token sets in public/app.css (between themes:begin and
 *    themes:end); GET /api/looks hands them to setup's live preview.
 *  - Backgrounds are our own art, drawn here as SVG (no stock photos):
 *    gradients, weather (changes with the weather and day/night at home),
 *    seasons with a few generic holidays, and sports art with team colors
 *    picked as colors - never team names, logos or marks.
 *  - Your own photo: the browser re-encodes it (resized to 3840 px at most,
 *    turned upright, no metadata) and this file never trusts that - it
 *    checks the real type from the bytes, the size and the dimensions, and
 *    rebuilds the file keeping only the picture itself (no EXIF/GPS, XMP,
 *    comments, color profiles or thumbnails). No native image library.
 * ====================================================================== */
const LK_THEMES = [['midnight', 'Midnight'], ['daylight', 'Daylight'], ['graphite', 'Graphite'], ['ocean', 'Ocean'], ['forest', 'Forest'], ['sunset', 'Sunset'], ['paper', 'Warm paper'], ['contrast', 'High contrast']];
const LK_GRADIENTS = [['aurora', 'Aurora', [170, 265]], ['dusk', 'Dusk', [250, 330]], ['lagoon', 'Lagoon', [190, 220]], ['ember', 'Ember', [10, 38]], ['meadow', 'Meadow', [140, 85]], ['nebula', 'Nebula', [280, 320]], ['dawn', 'Dawn', [20, 290]], ['steel', 'Steel', [215, 200]]];
const LK_SPORTS = [['field', 'Field'], ['court', 'Court'], ['diamond', 'Ball diamond'], ['rink', 'Ice rink'], ['track', 'Running track'], ['stripes', 'Jersey stripes']];
const LK_TEAM_COLORS = [['#1b2a4a', '#f26b1d', 'Navy and orange'], ['#b3121d', '#f2b705', 'Red and gold'], ['#1f5c3a', '#f2c230', 'Green and gold'], ['#4b2a7b', '#f2b705', 'Purple and gold'], ['#1a1a1a', '#b9bcc2', 'Black and silver'],
  ['#1f4fbf', '#ffffff', 'Royal blue and white'], ['#6e1423', '#f5f0e6', 'Maroon and cream'], ['#0f6e6e', '#111111', 'Teal and black'], ['#c8102e', '#14254a', 'Red and navy'], ['#f26b1d', '#111111', 'Orange and black'], ['#2e7d32', '#ffffff', 'Kelly green and white'], ['#0b2265', '#a5acaf', 'Blue and silver']];
const LK_SEASONS = ['spring', 'summer', 'fall', 'winter'], LK_HOLIDAYS = ['newyear', 'hearts', 'harvest', 'lights'];
const LK_CONDS = ['clear', 'partly', 'cloudy', 'rain', 'snow', 'storm', 'fog'], LK_TIMES = ['day', 'twilight', 'night'];
const LK_KINDS = ['none', 'solid', 'gradient', 'weather', 'season', 'sport', 'photo', 'reel'];
const LK_HEX = /^#[0-9a-f]{6}$/i, LK_PHOTO_ID = /^[a-f0-9]{24}\.(jpg|png|webp)$/;
const LK_MAX_SIDE = 3840, LK_MAX_BYTES = 12 * 1024 * 1024;

/* ---- color math (sRGB, WCAG 2.x relative luminance). The client has the same few lines for the accent picker;
   test/themes-unit.mjs checks the two agree. ---- */
const lkRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lkHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lkLum = (h) => { const [r, g, b] = lkRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const lkContrast = (a, b) => { const x = lkLum(a), y = lkLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function lkHsl(h) {
  const [r, g, b] = lkRgb(h).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, s, l];
}
function lkFromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return lkHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}
/* The same hue, made lighter or darker until it has `need`:1 against `bg` (or as close as the hue allows). */
function lkReach(hex, bg, need, dir) {
  const [h, s, l0] = lkHsl(hex);
  if (lkContrast(hex, bg) >= need) return hex;
  const up = dir ? dir > 0 : lkLum(bg) < 0.18;
  let lo = up ? l0 : 0, hi = up ? 1 : l0;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2, ok = lkContrast(lkFromHsl(h, s, mid), bg) >= need; if (up) { if (ok) hi = mid; else lo = mid; } else if (ok) lo = mid; else hi = mid; }
  return lkFromHsl(h, s, up ? hi : lo);
}
/* A chosen accent made safe for a theme: the fill for buttons (text on it 4.5:1), a second color for the
   gradient, and a text color for links (4.5:1 on cards and on the page). */
function lkAccentSet(hex, t) {
  const dark = '#06101e', light = '#ffffff';
  let fill = hex;
  const best = (c) => (lkContrast(dark, c) >= lkContrast(light, c) ? dark : light);
  let on = best(fill);
  if (lkContrast(on, fill) < 4.5) fill = lkReach(fill, on, 4.5, on === dark ? 1 : -1);
  const [h, s, l] = lkHsl(fill);
  let fill2 = lkFromHsl((h + 32) % 360, s, l);
  if (lkContrast(on, fill2) < 4.5) fill2 = lkReach(fill2, on, 4.5, on === dark ? 1 : -1);
  let text = lkReach(hex, t.solid, 4.6); text = lkReach(text, t.bg, 4.6);
  if (lkContrast(text, t.solid) < 4.5) text = t.text;   // a hue that can't get there (it never happens with the themes, but stay safe)
  return { accent: fill, accent2: fill2, onAccent: on, accentText: text, changed: fill.toLowerCase() !== hex.toLowerCase() };
}

/* ---- the themes, read from app.css (the one place they're defined) ---- */
const lkParseRgba = (v) => { v = String(v).trim(); let m = v.match(/^#([0-9a-f]{6})$/i); if (m) return [...lkRgb(v), 1]; m = v.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/); return m ? [+m[1], +m[2], +m[3], +m[4]] : null; };
const lkOver = (fg, bg) => lkHex([0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])));   // a see-through color on a solid one
function lkParseThemes(css) {
  const block = (String(css).split('/* themes:begin')[1] || '').split('/* themes:end */')[0], out = {};
  for (const m of block.matchAll(/:root\[data-look="([a-z]+)"\]\s*\{([^}]*)\}/g)) out[m[1]] = Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
  return out;
}
let lkThemeCache = null;
function lkThemes() {
  if (lkThemeCache) return lkThemeCache;
  let css = ''; try { css = fs.readFileSync(path.join(APP_DIR, 'public', 'app.css'), 'utf8'); } catch { /* no file: no themes to list (the app still has its built-in look) */ }
  const parsed = lkParseThemes(css);
  lkThemeCache = LK_THEMES.filter(([id]) => parsed[id]).map(([id, name]) => ({ id, name, mode: parsed[id]['look-mode'] === 'light' ? 'light' : 'dark', tokens: parsed[id] }));
  return lkThemeCache;
}
/* How light or dark big areas of our own art may be, so the theme's text stays 4.5:1 right on the art
   (with a little room): set by the theme with the weakest text color of each kind. */
function lkBand() {
  const ts = lkThemes(), lt = (m) => ts.filter((t) => t.mode === m).map((t) => lkLum(t.tokens.text));
  const d = lt('dark'), l = lt('light');
  return { darkMax: d.length ? (Math.min(...d) + 0.05) / 4.8 - 0.05 : 0.13, lightMin: l.length ? 4.8 * (Math.max(...l) + 0.05) - 0.05 : 0.3 };
}
/* A color for a big area of art, pulled into the band for the mode (dark art stays dark, light art light). */
function lkTone(hex, mode) {
  const b = lkBand(), [h, s, l0] = lkHsl(hex);
  if (mode === 'light' ? lkLum(hex) >= b.lightMin : lkLum(hex) <= b.darkMax) return hex;
  let lo = mode === 'light' ? l0 : 0, hi = mode === 'light' ? 1 : l0;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2, ok = mode === 'light' ? lkLum(lkFromHsl(h, s, mid)) >= b.lightMin : lkLum(lkFromHsl(h, s, mid)) <= b.darkMax; if (mode === 'light') { if (ok) hi = mid; else lo = mid; } else if (ok) lo = mid; else hi = mid; }
  return lkFromHsl(h, s, mode === 'light' ? hi : lo);
}

/* ---- the art ---- */
const lkRand = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const lkF = (n) => Math.round(n * 10) / 10;
/* hsl that fits the mode: dark art uses the first lightness, light art the second; then held inside the band */
const lkP = (mode, h, s, ld, ll) => lkTone(lkFromHsl(h % 360, s, mode === 'light' ? ll : ld), mode);
const lkLin = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
const lkRad = (id, c, a = 1) => `<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="${a}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
const lkSvg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
function lkHills(y, amp, seed, fill, n = 6) {
  const r = lkRand(seed), pts = Array.from({ length: n + 1 }, (_, i) => [i * (1600 / n), y + (r() - 0.5) * 2 * amp]);
  let d = `M0 1000L${pts[0][0]} ${lkF(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; d += `C${lkF(x0 + (x1 - x0) / 2)} ${lkF(y0)} ${lkF(x0 + (x1 - x0) / 2)} ${lkF(y1)} ${lkF(x1)} ${lkF(y1)}`; }
  return `<path d="${d}L1600 1000Z" fill="${fill}"/>`;
}
const lkCloud = (x, y, k, fill, a) => `<g transform="translate(${x} ${y}) scale(${k})" fill="${fill}" fill-opacity="${a}"><circle cx="0" cy="0" r="46"/><circle cx="52" cy="-22" r="58"/><circle cx="112" cy="0" r="44"/><rect x="0" y="-6" width="112" height="50" rx="25"/></g>`;
const lkStars = (n, seed, color, maxY = 620) => { const r = lkRand(seed); return Array.from({ length: n }, () => `<circle cx="${lkF(r() * 1600)}" cy="${lkF(r() * maxY)}" r="${lkF(0.6 + r() * 1.6)}" fill="${color}" fill-opacity="${lkF(0.25 + r() * 0.6)}"/>`).join(''); };
function lkWeatherArt(c, t, mode) {
  const L = mode === 'light', night = t === 'night', dusk = t === 'twilight', wet = ['rain', 'storm', 'cloudy', 'fog', 'snow'].includes(c);
  const sat = wet ? 0.18 : 0.55;
  const top = night ? lkP(mode, 230, 0.5, 0.06, 0.82) : dusk ? lkP(mode, 265, 0.42, 0.12, 0.84) : lkP(mode, 210, sat, 0.2, 0.86);
  const mid = night ? lkP(mode, 228, 0.42, 0.1, 0.86) : dusk ? lkP(mode, 330, 0.5, 0.18, 0.88) : lkP(mode, 205, sat * 0.9, 0.24, 0.9);
  const low = night ? lkP(mode, 222, 0.35, 0.13, 0.9) : dusk ? lkP(mode, 25, 0.75, 0.22, 0.9) : lkP(mode, 195, sat * 0.8, 0.28, 0.94);
  let defs = lkLin('sky', [[0, top], [0.6, mid], [1, low]]), body = '<rect width="1600" height="1000" fill="url(#sky)"/>';
  if (night && !wet) body += lkStars(140, 7, L ? '#5b6b8c' : '#e6ecff');
  if (['clear', 'partly'].includes(c)) {
    if (night) { defs += lkRad('glow', L ? '#ffffff' : '#c7d2fe', 0.35); body += `<circle cx="1220" cy="260" r="240" fill="url(#glow)"/><circle cx="1220" cy="260" r="62" fill="${L ? '#fffbeb' : '#e8ecf8'}" fill-opacity=".92"/><circle cx="1246" cy="244" r="58" fill="${top}"/>`; }
    else { defs += lkRad('glow', dusk ? '#fb923c' : '#fde68a', L ? 0.7 : 0.38); body += `<circle cx="1220" cy="${dusk ? 560 : 250}" r="300" fill="url(#glow)"/><circle cx="1220" cy="${dusk ? 560 : 250}" r="74" fill="${dusk ? '#fdba74' : '#fde68a'}" fill-opacity="${L ? 0.95 : 0.75}"/>`; }
  }
  const cloudFill = L ? '#ffffff' : lkP(mode, 220, 0.12, 0.3, 0.97), cloudA = L ? 0.85 : 0.55;
  const clouds = { clear: [], partly: [[180, 220, 1.3], [900, 160, 0.9]], cloudy: [[60, 180, 1.8], [620, 120, 1.5], [1150, 210, 1.9], [380, 330, 1.2], [1350, 360, 1.1]], rain: [[60, 170, 2], [600, 110, 1.7], [1140, 190, 2.1], [360, 300, 1.4]], storm: [[40, 160, 2.2], [600, 100, 1.9], [1120, 170, 2.3], [380, 290, 1.6]], snow: [[120, 180, 1.6], [760, 130, 1.4], [1250, 200, 1.5]], fog: [] }[c] || [];
  body += clouds.map(([x, y, k], i) => lkCloud(x, y, k, cloudFill, cloudA - i * 0.04)).join('');
  if (c === 'storm') body += `<path d="M820 360l-60 150h50l-40 130 120-180h-58l46-100z" fill="${L ? '#f59e0b' : '#fde68a'}" fill-opacity=".8"/>`;
  if (c === 'fog') body += [380, 520, 660, 800].map((y, i) => `<rect x="-100" y="${y}" width="1800" height="70" rx="35" fill="${L ? '#ffffff' : lkP(mode, 220, 0.1, 0.3, 0.97)}" fill-opacity="${0.35 + i * 0.08}"/>`).join('');
  const g1 = c === 'snow' ? lkP(mode, 210, 0.2, 0.28, 0.97) : night ? lkP(mode, 230, 0.3, 0.08, 0.84) : lkP(mode, 150, wet ? 0.18 : 0.35, 0.14, 0.86);
  const g2 = c === 'snow' ? lkP(mode, 210, 0.25, 0.22, 0.95) : night ? lkP(mode, 232, 0.3, 0.05, 0.8) : lkP(mode, 155, wet ? 0.2 : 0.4, 0.1, 0.8);
  body += lkHills(760, 60, 3, g1) + lkHills(860, 50, 9, g2);
  return lkSvg(defs, body);
}
const lkFlower = (x, y, k, petal, core) => `<g transform="translate(${x} ${y}) scale(${k})">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-14" rx="10" ry="15" fill="${petal}" transform="rotate(${a})"/>`).join('')}<circle r="6" fill="${core}"/></g>`;
const lkLeaf = (x, y, k, rot, fill) => `<path d="M0 -20C14 -10 14 10 0 20C-14 10 -14 -10 0 -20Z" transform="translate(${x} ${y}) rotate(${rot}) scale(${k})" fill="${fill}"/>`;
const lkHeart = (x, y, k, fill, a) => `<path d="M0 8C-22 -10 -14 -30 0 -18C14 -30 22 -10 0 8Z" transform="translate(${x} ${y}) scale(${k})" fill="${fill}" fill-opacity="${a}"/>`;
const lkPine = (x, y, k, fill, snow) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="M0 -120L46 -30H22L60 30H-60L-22 -30H-46Z" fill="${fill}"/><rect x="-8" y="30" width="16" height="22" fill="${fill}"/>${snow ? `<path d="M0 -120L18 -84H-18Z" fill="${snow}"/>` : ''}</g>`;
function lkSeasonArt(s, mode) {
  const L = mode === 'light', r = lkRand(11);
  let defs = '', body = '';
  const sky = (a, b, c) => { defs += lkLin('sky', [[0, a], [0.65, b], [1, c]]); body += '<rect width="1600" height="1000" fill="url(#sky)"/>'; };
  if (s === 'spring') {
    sky(lkP(mode, 200, 0.45, 0.16, 0.9), lkP(mode, 170, 0.35, 0.2, 0.92), lkP(mode, 120, 0.3, 0.22, 0.93));
    body += lkHills(720, 70, 4, lkP(mode, 120, 0.4, 0.16, 0.84)) + lkHills(840, 50, 8, lkP(mode, 105, 0.45, 0.12, 0.78));
    body += `<path d="M-20 120C200 160 380 140 560 60" stroke="${lkP(mode, 25, 0.3, 0.2, 0.55)}" stroke-width="14" fill="none" stroke-linecap="round"/>`;
    for (let i = 0; i < 9; i++) body += lkFlower(lkF(40 + i * 60 + r() * 30), lkF(120 + Math.sin(i) * 30 + r() * 30), lkF(0.9 + r() * 0.8), L ? '#f9a8d4' : '#d9779f', L ? '#fde68a' : '#e6b84d');
    for (let i = 0; i < 22; i++) body += `<ellipse cx="${lkF(r() * 1600)}" cy="${lkF(200 + r() * 560)}" rx="6" ry="3.5" fill="${L ? '#f9a8d4' : '#d9779f'}" fill-opacity="${lkF(0.35 + r() * 0.4)}" transform="rotate(${Math.round(r() * 180)})"/>`;
  } else if (s === 'summer') {
    sky(lkP(mode, 205, 0.6, 0.2, 0.86), lkP(mode, 195, 0.55, 0.24, 0.9), lkP(mode, 40, 0.7, 0.24, 0.92));
    defs += lkRad('glow', '#fde68a', L ? 0.8 : 0.4);
    body += `<circle cx="1180" cy="300" r="320" fill="url(#glow)"/><circle cx="1180" cy="300" r="86" fill="#fde68a" fill-opacity="${L ? 0.95 : 0.7}"/>`;
    body += `<rect y="640" width="1600" height="360" fill="${lkP(mode, 200, 0.6, 0.16, 0.8)}"/>`;
    for (let k = 0; k < 4; k++) body += `<path d="${Array.from({ length: 17 }, (_, i) => `${i ? 'Q' : 'M'}${i ? `${i * 100 - 50} ${680 + k * 70 - 14} ` : ''}${i * 100} ${680 + k * 70}`).join(' ')}" fill="none" stroke="${L ? '#ffffff' : lkP(mode, 195, 0.5, 0.3, 0.95)}" stroke-opacity="${0.5 - k * 0.08}" stroke-width="5" stroke-linecap="round"/>`;
    body += lkHills(900, 30, 2, lkP(mode, 42, 0.55, 0.2, 0.86));
  } else if (s === 'fall') {
    sky(lkP(mode, 30, 0.5, 0.14, 0.9), lkP(mode, 20, 0.5, 0.18, 0.9), lkP(mode, 15, 0.45, 0.2, 0.88));
    body += lkHills(700, 70, 5, lkP(mode, 25, 0.45, 0.15, 0.82));
    for (let i = 0; i < 7; i++) { const x = 80 + i * 230 + r() * 60, y = 700 + r() * 60, cr = 70 + r() * 40, hue = [12, 25, 38, 5][i % 4]; body += `<rect x="${lkF(x - 7)}" y="${lkF(y)}" width="14" height="120" fill="${lkP(mode, 25, 0.35, 0.1, 0.6)}"/><circle cx="${lkF(x)}" cy="${lkF(y - cr * 0.4)}" r="${lkF(cr)}" fill="${lkP(mode, hue, 0.7, 0.22, 0.75)}"/>`; }
    body += lkHills(880, 40, 12, lkP(mode, 28, 0.5, 0.11, 0.78));
    for (let i = 0; i < 26; i++) body += lkLeaf(lkF(r() * 1600), lkF(r() * 640), lkF(0.6 + r() * 0.8), Math.round(r() * 360), lkP(mode, [12, 28, 40][i % 3], 0.75, 0.3, 0.6));
  } else if (s === 'winter' || s === 'lights') {
    const nightSky = s === 'lights';
    sky(lkP(mode, 220, 0.4, nightSky ? 0.06 : 0.16, 0.88), lkP(mode, 215, 0.3, nightSky ? 0.1 : 0.2, 0.92), lkP(mode, 210, 0.25, 0.22, 0.95));
    if (nightSky) body += lkStars(90, 5, L ? '#64748b' : '#e2e8f0', 500);
    body += lkHills(720, 60, 6, lkP(mode, 210, 0.25, 0.26, 0.97)) + lkHills(840, 40, 13, lkP(mode, 210, 0.3, 0.3, 0.98));
    for (let i = 0; i < 9; i++) body += lkPine(lkF(60 + i * 190 + r() * 50), lkF(760 + r() * 80), lkF(0.7 + r() * 0.6), lkP(mode, 155, 0.35, 0.12, 0.62), L ? '#ffffff' : '#c8d3e0');
    if (s === 'lights') {
      const bulbs = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#c084fc'];
      body += `<path d="M-20 70Q400 230 800 90T1620 80" stroke="${L ? '#475569' : '#94a3b8'}" stroke-width="3" fill="none"/>`;
      for (let i = 0; i < 26; i++) { const x = i * 64, y = x < 800 ? 70 + 160 * Math.sin((x / 800) * Math.PI) * 0.62 : 90 + 140 * Math.sin(((x - 800) / 800) * Math.PI) * 0.6; defs += i < 5 ? lkRad(`b${i}`, bulbs[i], 0.6) : ''; body += `<circle cx="${x}" cy="${lkF(y + 16)}" r="26" fill="url(#b${i % 5})"/><ellipse cx="${x}" cy="${lkF(y + 16)}" rx="7" ry="10" fill="${bulbs[i % 5]}"/>`; }
    } else for (let i = 0; i < 40; i++) body += `<circle cx="${lkF(r() * 1600)}" cy="${lkF(r() * 700)}" r="${lkF(2 + r() * 4)}" fill="${L ? '#ffffff' : '#dbe4ef'}" fill-opacity="${lkF(0.4 + r() * 0.5)}"/>`;
  } else if (s === 'newyear') {
    sky(lkP(mode, 240, 0.5, 0.05, 0.86), lkP(mode, 255, 0.45, 0.08, 0.88), lkP(mode, 265, 0.4, 0.12, 0.9));
    body += lkStars(80, 3, L ? '#64748b' : '#e2e8f0', 700);
    const bursts = [[360, 280, '#fbbf24'], [820, 200, '#f472b6'], [1240, 320, '#60a5fa'], [600, 470, '#34d399'], [1080, 520, '#c084fc']];
    for (const [x, y, col] of bursts) body += `<g transform="translate(${x} ${y})" stroke="${col}" stroke-width="4" stroke-linecap="round" stroke-opacity="${L ? 0.85 : 0.7}">${Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return `<line x1="${lkF(Math.cos(a) * 26)}" y1="${lkF(Math.sin(a) * 26)}" x2="${lkF(Math.cos(a) * 96)}" y2="${lkF(Math.sin(a) * 96)}"/>`; }).join('')}</g>`;
    body += lkHills(880, 30, 4, lkP(mode, 245, 0.4, 0.06, 0.82));
  } else if (s === 'hearts') {
    sky(lkP(mode, 340, 0.45, 0.12, 0.92), lkP(mode, 330, 0.4, 0.16, 0.93), lkP(mode, 300, 0.3, 0.18, 0.94));
    for (let i = 0; i < 28; i++) body += lkHeart(lkF(r() * 1600), lkF(r() * 1000), lkF(1.2 + r() * 2.4), L ? '#f472b6' : '#e0607e', lkF(0.25 + r() * 0.4));
  } else if (s === 'harvest') {
    sky(lkP(mode, 250, 0.45, 0.07, 0.86), lkP(mode, 280, 0.35, 0.11, 0.88), lkP(mode, 25, 0.55, 0.16, 0.9));
    defs += lkRad('glow', '#fde68a', L ? 0.6 : 0.35);
    body += `<circle cx="1180" cy="280" r="260" fill="url(#glow)"/><circle cx="1180" cy="280" r="110" fill="${L ? '#fde68a' : '#f1d58a'}" fill-opacity="${L ? 0.95 : 0.75}"/>`;
    body += lkHills(760, 50, 7, lkP(mode, 30, 0.35, 0.09, 0.8)) + lkHills(870, 30, 2, lkP(mode, 28, 0.4, 0.06, 0.74));
    for (let i = 0; i < 6; i++) { const x = 160 + i * 240 + r() * 60, y = 880 + r() * 40, k = 0.8 + r() * 0.6; body += `<g transform="translate(${lkF(x)} ${lkF(y)}) scale(${lkF(k)})"><rect x="-4" y="-62" width="8" height="18" rx="3" fill="${L ? '#4d7c0f' : '#3f6212'}"/>${[-26, 0, 26].map((dx) => `<ellipse cx="${dx}" cy="-20" rx="26" ry="38" fill="${L ? '#f97316' : '#c2560f'}"/>`).join('')}</g>`; }
  }
  return lkSvg(defs, body);
}
function lkSportArt(s, mode, c1, c2) {
  const L = mode === 'light', team = !!c1;
  const base = (h, sat, ld, ll) => (team ? lkP(mode, lkHsl(c1)[0], Math.min(0.7, lkHsl(c1)[1]), ld, ll) : lkP(mode, h, sat, ld, ll));
  const line = team ? (L ? lkReach(c2, '#ffffff', 1.6, -1) : c2) : (L ? '#ffffff' : '#e5e7eb');
  const la = L ? 0.9 : 0.45;
  let defs = '', body = '';
  if (s === 'stripes') {
    const a = team ? lkP(mode, lkHsl(c1)[0], Math.min(0.75, lkHsl(c1)[1]), 0.16, 0.86) : lkP(mode, 220, 0.5, 0.14, 0.86);
    const b = team ? lkP(mode, lkHsl(c2)[0], Math.min(0.75, lkHsl(c2)[1]), 0.22, 0.92) : lkP(mode, 25, 0.6, 0.2, 0.9);
    defs += `<pattern id="st" width="240" height="240" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><rect width="240" height="240" fill="${a}"/><rect x="150" width="44" height="240" fill="${b}"/><rect x="206" width="12" height="240" fill="${b}"/></pattern>`;
    defs += lkLin('sh', [[0, '#000', L ? 0 : 0.25], [1, '#000', 0]], 1, 1);
    return lkSvg(defs, '<rect width="1600" height="1000" fill="url(#st)"/><rect width="1600" height="1000" fill="url(#sh)"/>');
  }
  if (s === 'field') {
    const g1 = base(130, 0.45, 0.14, 0.78), g2 = lkP(mode, lkHsl(g1)[0], lkHsl(g1)[1], Math.min(0.22, lkHsl(g1)[2] + 0.025), Math.min(0.92, lkHsl(g1)[2] + 0.04));
    for (let i = 0; i < 12; i++) body += `<rect x="${i * 140}" width="140" height="1000" fill="${i % 2 ? g1 : g2}"/>`;
    body += `<g fill="none" stroke="${line}" stroke-opacity="${la}" stroke-width="6"><rect x="80" y="90" width="1440" height="820"/><line x1="800" y1="90" x2="800" y2="910"/><circle cx="800" cy="500" r="120"/><rect x="80" y="300" width="160" height="400"/><rect x="1360" y="300" width="160" height="400"/></g>`;
  } else if (s === 'court') {
    const w = base(32, 0.45, 0.16, 0.8);
    for (let i = 0; i < 20; i++) body += `<rect y="${i * 50}" width="1600" height="50" fill="${lkP(mode, lkHsl(w)[0], lkHsl(w)[1], lkHsl(w)[2] + (i % 3) * 0.012, Math.min(0.94, lkHsl(w)[2] + (i % 3) * 0.02))}"/>`;
    body += `<g fill="none" stroke="${line}" stroke-opacity="${la}" stroke-width="6"><rect x="80" y="90" width="1440" height="820"/><line x1="800" y1="90" x2="800" y2="910"/><circle cx="800" cy="500" r="110"/><rect x="80" y="330" width="300" height="340"/><rect x="1220" y="330" width="300" height="340"/><path d="M80 150C620 200 620 800 80 850M1520 150C980 200 980 800 1520 850"/></g>`;
  } else if (s === 'diamond') {
    body += `<rect width="1600" height="1000" fill="${base(125, 0.4, 0.14, 0.8)}"/>`;
    body += `<path d="M800 220L1120 540L800 860L480 540Z" fill="${lkP(mode, 28, 0.45, 0.17, 0.84)}"/><path d="M800 330L1010 540L800 750L590 540Z" fill="${base(125, 0.4, 0.15, 0.82)}"/>`;
    body += `<g fill="${line}" fill-opacity="${la}">${[[800, 330], [1010, 540], [800, 750], [590, 540]].map(([x, y]) => `<rect x="${x - 14}" y="${y - 14}" width="28" height="28" transform="rotate(45 ${x} ${y})"/>`).join('')}</g><g fill="none" stroke="${line}" stroke-opacity="${la}" stroke-width="5"><path d="M800 750L80 30M800 750L1520 30"/></g>`;
  } else if (s === 'rink') {
    body += `<rect width="1600" height="1000" fill="${team ? base(200, 0.3, 0.16, 0.9) : lkP(mode, 205, 0.3, 0.17, 0.95)}"/>`;
    body += `<rect x="70" y="80" width="1460" height="840" rx="200" fill="none" stroke="${line}" stroke-opacity="${la}" stroke-width="6"/>`;
    body += `<g stroke-width="10" stroke-opacity="${L ? 0.7 : 0.45}"><line x1="800" y1="80" x2="800" y2="920" stroke="${team ? line : '#ef4444'}"/><line x1="560" y1="80" x2="560" y2="920" stroke="${team ? line : '#3b82f6'}"/><line x1="1040" y1="80" x2="1040" y2="920" stroke="${team ? line : '#3b82f6'}"/></g>`;
    body += `<g fill="none" stroke="${team ? line : '#ef4444'}" stroke-opacity="${L ? 0.6 : 0.4}" stroke-width="5">${[[800, 500, 110], [320, 300, 80], [320, 700, 80], [1280, 300, 80], [1280, 700, 80]].map(([x, y, rr]) => `<circle cx="${x}" cy="${y}" r="${rr}"/>`).join('')}</g>`;
  } else {   // track
    body += `<rect width="1600" height="1000" fill="${base(130, 0.35, 0.13, 0.82)}"/>`;
    body += `<rect x="60" y="110" width="1480" height="780" rx="390" fill="${team ? base(10, 0.5, 0.18, 0.84) : lkP(mode, 12, 0.5, 0.18, 0.84)}"/><rect x="300" y="350" width="1000" height="300" rx="150" fill="${base(130, 0.35, 0.14, 0.82)}"/>`;
    body += `<g fill="none" stroke="${line}" stroke-opacity="${la}" stroke-width="4">${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${100 + i * 34}" y="${150 + i * 34}" width="${1400 - i * 68}" height="${700 - i * 68}" rx="${350 - i * 34}"/>`).join('')}</g>`;
  }
  defs += lkLin('vg', [[0, '#000', L ? 0 : 0.3], [0.5, '#000', 0], [1, '#000', L ? 0 : 0.35]]);
  return lkSvg(defs, `${body}<rect width="1600" height="1000" fill="url(#vg)"/>`);
}
function lkGradientArt(id, mode) {
  const g = LK_GRADIENTS.find(([x]) => x === id) || LK_GRADIENTS[0], [h1, h2] = g[2];
  const a = lkP(mode, h1, 0.6, 0.34, 0.86), b = lkP(mode, h2, 0.55, 0.32, 0.88), base = lkP(mode, (h1 + h2) / 2, 0.35, 0.08, 0.95);
  const defs = lkLin('bg', [[0, base], [1, lkP(mode, h2, 0.4, 0.08, 0.93)]], 1, 1) + lkRad('a', a, 0.95) + lkRad('b', b, 0.9);
  return lkSvg(defs, '<rect width="1600" height="1000" fill="url(#bg)"/><ellipse cx="300" cy="200" rx="900" ry="650" fill="url(#a)"/><ellipse cx="1350" cy="850" rx="950" ry="700" fill="url(#b)"/>');
}
/* Rain or snow on its own, to repeat over the art (the page moves it, gently, unless motion is reduced). */
function lkFxTile(f, mode) {
  const r = lkRand(f === 'snow' ? 21 : 17), L = mode === 'light';
  if (f === 'snow') return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">${Array.from({ length: 26 }, () => `<circle cx="${lkF(r() * 400)}" cy="${lkF(r() * 400)}" r="${lkF(1.5 + r() * 3)}" fill="${L ? '#ffffff' : '#e2e8f0'}" fill-opacity="${lkF(0.45 + r() * 0.45)}"/>`).join('')}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" stroke="${L ? '#64748b' : '#cbd5e1'}" stroke-width="2" stroke-linecap="round">${Array.from({ length: 34 }, () => { const x = r() * 400, y = r() * 400, l = 18 + r() * 22; return `<line x1="${lkF(x)}" y1="${lkF(y)}" x2="${lkF(x - l * 0.25)}" y2="${lkF(y + l)}" stroke-opacity="${lkF(0.25 + r() * 0.35)}"/>`; }).join('')}</svg>`;
}
/* One query in, one picture out; every value is checked against a fixed list (or is a #hex color). */
function lkArt(q) {
  const mode = q.m === 'light' ? 'light' : 'dark', pick = (v, list, d) => (list.includes(v) ? v : d);
  switch (q.k) {
    case 'weather': return lkWeatherArt(pick(q.c, LK_CONDS, 'partly'), pick(q.t, LK_TIMES, 'day'), mode);
    case 'season': return lkSeasonArt(pick(q.s, [...LK_SEASONS, ...LK_HOLIDAYS], 'spring'), mode);
    case 'sport': return lkSportArt(pick(q.s, LK_SPORTS.map(([x]) => x), 'field'), mode, LK_HEX.test(q.c1 || '') ? q.c1 : null, LK_HEX.test(q.c2 || '') ? q.c2 : (LK_HEX.test(q.c1 || '') ? '#ffffff' : null));
    case 'gradient': return lkGradientArt(q.g, mode);
    case 'solid': return lkSvg('', `<rect width="1600" height="1000" fill="${lkTone(LK_HEX.test(q.c || '') ? q.c : '#1e293b', mode)}"/>`);
    case 'fx': return lkFxTile(q.f === 'snow' ? 'snow' : 'rain', mode);
    default: return null;
  }
}

/* ---- what the weather and the calendar say right now ---- */
/* The sun's height in degrees (good to a degree or so - enough for day, twilight or night). */
function lkSunElevation(lat, lon, when = new Date()) {
  const rad = Math.PI / 180, d = when.getTime() / 86400000 - 10957.5, g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const lam = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(lam)), ra = Math.atan2(Math.cos(e) * Math.sin(lam), Math.cos(lam));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24, ha = ((gmst * 15 + lon) * rad) - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}
const lkCond = (sym) => { const s = String(sym || ''); return /thunder/.test(s) ? 'storm' : /snow|sleet/.test(s) ? 'snow' : /rain|drizzle|shower/.test(s) ? 'rain' : /fog/.test(s) ? 'fog' : /^cloudy/.test(s) ? 'cloudy' : /partly|fair/.test(s) ? 'partly' : /clear/.test(s) ? 'clear' : 'partly'; };
const lkLocalDate = (when, tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(when).map((x) => [x.type, Number(x.value)])); return { m: p.month, d: p.day, h: p.hour }; };
/* The season where the home is (the southern half of the world has them the other way round), and - if wanted - a
   few generic holidays around their dates. */
function lkSeasonNow(when = new Date(), { lat = 40, tz = 'UTC', holidays = true } = {}) {
  const { m, d } = lkLocalDate(when, tz);
  if (holidays) {
    if ((m === 12 && d === 31) || (m === 1 && d === 1)) return 'newyear';
    if (m === 2 && d >= 12 && d <= 14) return 'hearts';
    if (m === 10 && d >= 24) return 'harvest';
    if (m === 12 && d >= 14 && d <= 30) return 'lights';
  }
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'][m - 1];
  return lat < 0 ? { winter: 'summer', summer: 'winter', spring: 'fall', fall: 'spring' }[north] : north;
}
async function lkScene(look = lookState()) {
  const loc = config.location || (isDemo() ? { lat: 47.6, lon: -122.3 } : null), tz = houseTz(), now = new Date();
  let c = 'partly', sym = null;
  try { const w = await Promise.race([weatherNow(), new Promise((_, no) => setTimeout(no, 2500, new Error('slow')))]); sym = w?.now?.symbol; c = lkCond(sym); } catch { /* no weather: a fair sky */ }
  let t;
  if (loc?.lat != null) { const el = lkSunElevation(loc.lat, loc.lon, now); t = el > 6 ? 'day' : el > -6 ? 'twilight' : 'night'; }
  else { const { h } = lkLocalDate(now, tz); t = h >= 8 && h < 18 ? 'day' : (h >= 6 && h < 8) || (h >= 18 && h < 20) ? 'twilight' : 'night'; }
  if (c === 'clear' && /_night$/.test(String(sym || '')) && t === 'day') t = 'twilight';
  const season = lkSeasonNow(now, { lat: loc?.lat ?? 40, tz, holidays: look.bg?.holidays !== false });
  return { weather: { c, t, fx: c === 'rain' || c === 'storm' ? 'rain' : c === 'snow' ? 'snow' : null }, season, at: nowIso() };
}

/* ---- the household's choice ---- */
const LK_DEFAULT_BG = { kind: 'none', color: '#1e293b', gradient: 'aurora', season: 'auto', holidays: true, sport: 'field', team: null, photo: null, tone: null, blur: 0, dim: 35, reelMin: 10 };
const lkLegacyTheme = (ui) => (ui.theme === 'light' ? 'daylight' : ui.theme === 'auto' ? 'auto' : 'midnight');
function lookState() {
  const ui = (isDemo() ? demoUi : config.ui) || {}, saved = ui.look || {};
  const legacyAccent = !ui.look && LK_HEX.test(ui.accent || '') && ui.accent.toLowerCase() !== '#5eb8ff' ? ui.accent : null;   // a color picked before themes came
  return { theme: saved.theme || lkLegacyTheme(ui), accent: saved.accent === undefined ? legacyAccent : saved.accent, bg: { ...LK_DEFAULT_BG, ...(saved.bg || {}) } };
}
const lkInt = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
function lookClean(b, cur = lookState()) {
  const out = { theme: cur.theme, accent: cur.accent ?? null, bg: { ...cur.bg } };
  if (!b || typeof b !== 'object') return out;
  if (b.theme === 'auto' || LK_THEMES.some(([id]) => id === b.theme)) out.theme = b.theme;
  if (b.accent === null || LK_HEX.test(b.accent || '')) out.accent = b.accent ? b.accent.toLowerCase() : null;
  const g = b.bg && typeof b.bg === 'object' ? b.bg : {}, o = out.bg;
  if (LK_KINDS.includes(g.kind)) o.kind = g.kind;
  if (LK_HEX.test(g.color || '')) o.color = g.color.toLowerCase();
  if (LK_GRADIENTS.some(([id]) => id === g.gradient)) o.gradient = g.gradient;
  if (g.season === 'auto' || LK_SEASONS.includes(g.season) || LK_HOLIDAYS.includes(g.season)) o.season = g.season;
  if (typeof g.holidays === 'boolean') o.holidays = g.holidays;
  if (LK_SPORTS.some(([id]) => id === g.sport)) o.sport = g.sport;
  if (g.team === null) o.team = null; else if (Array.isArray(g.team) && g.team.length === 2 && g.team.every((c) => LK_HEX.test(c || ''))) o.team = g.team.map((c) => c.toLowerCase());
  if (g.photo === null) o.photo = null; else if (LK_PHOTO_ID.test(g.photo || '') && fs.existsSync(path.join(LK_DIR, g.photo))) o.photo = g.photo;
  if (g.tone === null || LK_HEX.test(g.tone || '')) o.tone = g.tone ? g.tone.toLowerCase() : null;
  if (g.blur != null) o.blur = lkInt(g.blur, 0, 30, o.blur);
  if (g.dim != null) o.dim = lkInt(g.dim, 15, 85, o.dim);
  if (g.reelMin != null) o.reelMin = [1, 5, 10, 30, 60].includes(Number(g.reelMin)) ? Number(g.reelMin) : o.reelMin;
  return out;
}
function lookSave(next) {
  const themeMode = next.theme === 'auto' ? 'auto' : lkThemes().find((t) => t.id === next.theme)?.mode || 'dark';
  if (isDemo()) { demoUi = { ...uiPrefs(), look: next, theme: themeMode }; return; }
  saveConfig({ ...config, ui: { ...(config.ui || {}), look: next, theme: themeMode } });
}
/* Setup's choice, before setup has saved anything: kept in a file of its own (writing config.json now would make
   CasaTorch count as set up), and moved into the settings once setup is done. */
const LK_PENDING = path.join(DATA_DIR, 'look-setup.json');
function lookAdoptPending() {
  if (isDemo() || !isConfigured() || !fs.existsSync(LK_PENDING)) return;
  try { const p = JSON.parse(fs.readFileSync(LK_PENDING, 'utf8')); if (!config.ui?.look) lookSave(lookClean(p)); } catch { /* a damaged file: the default look */ }
  try { fs.rmSync(LK_PENDING, { force: true }); } catch { /* next time */ }
}
const lkCanEdit = (req) => !signInOn() || (!!req.user && rank(req.user.role) >= rank('admin'));
app.get('/api/looks', (req, res) => {
  lookAdoptPending();
  let pending = null; if (!isConfigured() && fs.existsSync(LK_PENDING)) { try { pending = lookClean(JSON.parse(fs.readFileSync(LK_PENDING, 'utf8'))); } catch { /* none */ } }
  res.json({ themes: lkThemes(), gradients: LK_GRADIENTS.map(([id, name]) => ({ id, name })), sports: LK_SPORTS.map(([id, name]) => ({ id, name })), teamColors: LK_TEAM_COLORS.map(([a, b, name]) => ({ colors: [a, b], name })),
    seasons: [...LK_SEASONS, ...LK_HOLIDAYS], look: pending || lookState(), chosen: !!pending || !!((isDemo() ? demoUi : config.ui) || {}).look, canEdit: lkCanEdit(req), demo: isDemo(), maxSide: LK_MAX_SIDE, maxBytes: LK_MAX_BYTES });
});
app.put('/api/looks', express.json({ limit: '8kb' }), requireRole('admin'), (req, res) => {
  const next = lookClean(req.body);
  try { lookSave(next); } catch (e) { return res.status(500).json({ error: String(e.message) }); }
  lkPrune(next.bg.photo);
  res.json({ look: next });
});
/* Setup's step: before setup, into its own file; when setup runs again (an admin), straight into the settings. */
app.post('/api/setup/look', express.json({ limit: '8kb' }), (req, res) => {
  if (isConfigured() || isDemo()) { if (!lkCanEdit(req)) return res.status(403).json({ error: 'Only an admin can change that.' }); const next = lookClean(req.body); lookSave(next); return res.json({ look: next }); }
  const next = lookClean(req.body, { theme: 'midnight', accent: null, bg: { ...LK_DEFAULT_BG } });
  next.bg.photo = null; if (next.bg.kind === 'photo') next.bg.kind = 'none';
  writeFileSafe(LK_PENDING, JSON.stringify(next), 0o600);
  res.json({ look: next });
});
app.get('/api/looks/scene', async (_req, res) => res.json(await lkScene()));
app.get('/api/looks/art.svg', (req, res) => {
  const q = Object.fromEntries(Object.entries(req.query || {}).map(([k, v]) => [k, String(v).slice(0, 12)]));
  const svg = lkArt(q); if (!svg) return res.status(404).end();
  res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=604800', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
  res.send(svg);
});

/* ---- your own photo ---- */
const LK_DIR = path.join(DATA_DIR, 'looks');
class LkBad extends Error { constructor(msg, status = 415) { super(msg); this.status = status; } }
const LK_CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const lkCrc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = LK_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const lkSniff = (b) => (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
  : b.length > 16 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null);
/* JPEG: only the markers a picture needs (tables, frame, scans, restart). EXIF (with GPS), XMP, color profiles,
   Photoshop data, comments, the JFIF thumbnail and anything after the end marker are dropped. */
function lkCleanJpeg(b) {
  const out = [Buffer.from([0xff, 0xd8])]; let i = 2, w = 0, h = 0, scans = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new LkBad('That JPEG is damaged.');
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }   // fill byte
    if (m === 0xd9) { if (!w || !h || !scans) throw new LkBad('That JPEG has no picture in it.'); out.push(Buffer.from([0xff, 0xd9])); return { buf: Buffer.concat(out), w, h }; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > b.length) break;
    const len = b.readUInt16BE(i + 2); if (len < 2 || i + 2 + len > b.length) throw new LkBad('That JPEG is damaged.');
    const seg = b.subarray(i, i + 2 + len);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { if (len < 8) throw new LkBad('That JPEG is damaged.'); h = seg.readUInt16BE(5); w = seg.readUInt16BE(7); }
    const adobe = m === 0xee && len <= 16 && seg.toString('latin1', 4, 9) === 'Adobe';   // color transform flags only: needed for some JPEGs' colors
    if (!(m >= 0xe0 && m <= 0xef) || adobe) { if (m !== 0xfe) out.push(seg); }
    i += 2 + len;
    if (m === 0xda) {   // the picture data runs to the next real marker
      scans++; let j = i;
      while (j < b.length - 1 && !(b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7) && b[j + 1] !== 0xff)) j++;
      out.push(b.subarray(i, j)); i = j;
    }
  }
  throw new LkBad('That JPEG is cut off - try saving it again.');
}
/* PNG: the picture's own chunks (each one's checksum checked); text, EXIF, time stamps, color profiles and anything
   unknown are dropped. Moving PNGs are refused. */
function lkCleanPng(b) {
  const KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs']);
  const out = [b.subarray(0, 8)]; let i = 8, w = 0, h = 0, idat = 0;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8), end = i + 12 + len;
    if (!/^[A-Za-z]{4}$/.test(type) || end > b.length) throw new LkBad('That PNG is damaged.');
    if (lkCrc32(b.subarray(i + 4, i + 8 + len)) !== b.readUInt32BE(i + 8 + len)) throw new LkBad('That PNG is damaged.');
    if (type === 'acTL') throw new LkBad('Moving pictures can\'t be a background - use a still photo.');
    if (type === 'IHDR') { if (i !== 8 || len !== 13) throw new LkBad('That PNG is damaged.'); w = b.readUInt32BE(i + 8); h = b.readUInt32BE(i + 12); }
    if (type === 'IDAT') idat++;
    if (KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') { if (!w || !h || !idat) throw new LkBad('That PNG has no picture in it.'); return { buf: Buffer.concat(out), w, h }; }
  }
  throw new LkBad('That PNG is cut off - try saving it again.');
}
/* WebP: the picture (and its transparency) only; EXIF, XMP and color profiles are dropped and the header's flags
   say so. Moving WebPs are refused. */
function lkCleanWebp(b) {
  const keep = []; let i = 12, w = 0, h = 0, pics = 0, vp8x = null;
  const total = Math.min(b.length, 8 + b.readUInt32LE(4));
  while (i + 8 <= total) {
    const id = b.toString('latin1', i, i + 4), len = b.readUInt32LE(i + 4), end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) throw new LkBad('That WebP is damaged.');
    const data = b.subarray(i + 8, i + 8 + len);
    if (id === 'ANIM' || id === 'ANMF') throw new LkBad('Moving pictures can\'t be a background - use a still photo.');
    if (id === 'VP8X') { if (len < 10) throw new LkBad('That WebP is damaged.'); vp8x = Buffer.from(b.subarray(i, i + 8 + len)); vp8x[8] &= ~(0x20 | 0x08 | 0x04 | 0x02); w = data.readUIntLE(4, 3) + 1; h = data.readUIntLE(7, 3) + 1; }
    else if (id === 'VP8 ') { if (len < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) throw new LkBad('That WebP is damaged.'); pics++; if (!vp8x) { w = data.readUInt16LE(6) & 0x3fff; h = data.readUInt16LE(8) & 0x3fff; } keep.push(b.subarray(i, Math.min(end, b.length))); }
    else if (id === 'VP8L') { if (len < 5 || data[0] !== 0x2f) throw new LkBad('That WebP is damaged.'); pics++; if (!vp8x) { const bits = data.readUInt32LE(1); w = (bits & 0x3fff) + 1; h = ((bits >>> 14) & 0x3fff) + 1; } keep.push(b.subarray(i, Math.min(end, b.length))); }
    else if (id === 'ALPH') keep.push(b.subarray(i, Math.min(end, b.length)));
    i = end;
  }
  if (pics !== 1 || !w || !h) throw new LkBad('That WebP has no picture in it.');
  const body = Buffer.concat([...(vp8x ? [vp8x] : []), ...keep].map((c) => (c.length & 1 ? Buffer.concat([c, Buffer.alloc(1)]) : c)));
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + body.length, 4); head.write('WEBP', 8, 'latin1');
  return { buf: Buffer.concat([head, body]), w, h };
}
/* Any upload: the real type from its first bytes (not its name or what the browser says), then rebuilt. */
function lkCleanImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 24) throw new LkBad('No photo received.', 400);
  if (b.length > LK_MAX_BYTES) throw new LkBad('That photo is too big (12 MB at most).', 413);
  const ext = lkSniff(b);
  if (!ext) throw new LkBad('That isn\'t a JPEG, PNG or WebP photo.');
  const r = ext === 'jpg' ? lkCleanJpeg(b) : ext === 'png' ? lkCleanPng(b) : lkCleanWebp(b);
  if (Math.max(r.w, r.h) > LK_MAX_SIDE) throw new LkBad(`That photo is ${r.w} × ${r.h} pixels - ${LK_MAX_SIDE} on the long side at most.`, 413);
  if (Math.min(r.w, r.h) < 32) throw new LkBad('That picture is too small to be a background.', 422);
  return { ...r, ext, type: { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] };
}
const lkPhotos = () => { try { return fs.readdirSync(LK_DIR).filter((f) => LK_PHOTO_ID.test(f)).map((f) => ({ id: f, at: fs.statSync(path.join(LK_DIR, f)).mtimeMs })).sort((a, b) => b.at - a.at); } catch { return []; } };
/* Old photos go: the one in use and the three newest stay. */
function lkPrune(keepId) {
  const inUse = new Set([keepId, lookState().bg.photo].filter(Boolean));
  lkPhotos().filter((p) => !inUse.has(p.id)).slice(3).forEach((p) => { try { fs.rmSync(path.join(LK_DIR, p.id), { force: true }); } catch { /* next time */ } });
}
app.post('/api/looks/photo', requireRole('admin'), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: LK_MAX_BYTES + 1024 }), (req, res) => {
  if (isDemo()) return res.status(403).json({ error: 'The demo doesn\'t keep photos - your own CasaTorch does.' });
  let r; try { r = lkCleanImage(req.body); } catch (e) { return res.status(e.status || 415).json({ error: e.message }); }
  fs.mkdirSync(LK_DIR, { recursive: true, mode: 0o700 });
  const id = `${crypto.randomBytes(12).toString('hex')}.${r.ext}`;
  writeFileSafe(path.join(LK_DIR, id), r.buf, 0o600);
  lkPrune(id);
  if (typeof audit === 'function') audit(req, 'background-photo-added', { bytes: r.buf.length, w: r.w, h: r.h });
  res.json({ ok: true, id, url: `/api/looks/photo/${id}`, w: r.w, h: r.h, bytes: r.buf.length });
});
app.get('/api/looks/photo/:id', (req, res) => {
  const id = String(req.params.id); if (!LK_PHOTO_ID.test(id)) return res.status(404).end();
  const f = path.join(LK_DIR, id); if (!fs.existsSync(f)) return res.status(404).end();
  res.set({ 'Content-Type': { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[id.split('.').pop()], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'", 'Content-Disposition': 'inline' });
  fs.createReadStream(f).pipe(res);
});
app.delete('/api/looks/photo/:id', requireRole('admin'), (req, res) => {
  const id = String(req.params.id); if (!LK_PHOTO_ID.test(id)) return res.status(404).json({ error: 'not found' });
  try { fs.rmSync(path.join(LK_DIR, id), { force: true }); } catch { /* gone already */ }
  const cur = lookState(); if (cur.bg.photo === id) lookSave(lookClean({ bg: { kind: 'none', photo: null } }, cur));
  res.json({ ok: true, look: lookState() });
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchLook = { lkContrast, lkLum, lkAccentSet, lkReach, lkTone, lkBand, lkThemes, lkParseThemes, lkParseRgba, lkOver, lkArt, lkCleanImage, lkCleanJpeg, lkCleanPng, lkCleanWebp, lkSniff, lkCrc32, lookClean, lkSeasonNow, lkSunElevation, lkCond, LK_THEMES, LK_GRADIENTS, LK_SPORTS, LK_TEAM_COLORS, LK_CONDS, LK_TIMES, LK_SEASONS, LK_HOLIDAYS, LK_MAX_SIDE };
