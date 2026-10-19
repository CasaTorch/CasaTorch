/* ======================================================================
 * Themes and backgrounds on this screen, and Settings › Look's theme and
 * background card. The theme tokens are in app.css (themes:begin); the
 * art, the weather scene and the photo upload are in 09t-themes.js.
 *  - Cards and the menu get a frosted surface whenever a background is on,
 *    so text keeps its contrast (test/themes-unit.mjs checks it).
 *  - Backgrounds load after the page is drawn, sit behind everything (no
 *    layout shift), keep still with "reduce motion", and a phone in data
 *    saver gets a plain color instead of a photo.
 *  - Each screen can have its own background (a wall tablet, a phone):
 *    kept in that browser only.
 * ====================================================================== */
const LOOK = { cat: null, loading: null, scene: null, sceneAt: 0, key: '', reel: null, reelT: null, refreshT: null, saveT: null };
/* The theme this browser showed last, straight away: no flash of the default look while the page starts. */
try { const c = String(localStorage.getItem('casatorch-look') || '').split(':'); if (/^[a-z]{3,12}$/.test(c[0])) { document.documentElement.dataset.look = c[0]; if (/^(dark|light)$/.test(c[1])) document.documentElement.dataset.theme = c[1]; } } catch { /* private window */ }

/* ---- color math: the same as 09t-themes.js (test/themes-unit.mjs checks they agree) ---- */
/* @look-color:begin */
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
function lkReach(hex, bg, need, dir) {
  const [h, s, l0] = lkHsl(hex);
  if (lkContrast(hex, bg) >= need) return hex;
  const up = dir ? dir > 0 : lkLum(bg) < 0.18;
  let lo = up ? l0 : 0, hi = up ? 1 : l0;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2, ok = lkContrast(lkFromHsl(h, s, mid), bg) >= need; if (up) { if (ok) hi = mid; else lo = mid; } else if (ok) lo = mid; else hi = mid; }
  return lkFromHsl(h, s, up ? hi : lo);
}
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
  if (lkContrast(text, t.solid) < 4.5) text = t.text;
  return { accent: fill, accent2: fill2, onAccent: on, accentText: text, changed: fill.toLowerCase() !== hex.toLowerCase() };
}
/* @look-color:end */

const lookReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const lookSaver = () => !!navigator.connection?.saveData;
const lookScreenBg = () => { try { const v = JSON.parse(localStorage.getItem('casatorch-look-screen') || 'null'); return v && typeof v === 'object' && v.kind ? v : null; } catch { return null; } };
const lookSetScreenBg = (bg) => { try { if (bg) localStorage.setItem('casatorch-look-screen', JSON.stringify(bg)); else localStorage.removeItem('casatorch-look-screen'); } catch { /* private window */ } };
const lookThemeId = (look) => {
  const id = look?.theme || (S.ui.theme === 'light' ? 'daylight' : S.ui.theme === 'auto' ? 'auto' : 'midnight');
  return id === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'daylight') : id;
};
const lookTheme = (id) => LOOK.cat?.themes.find((t) => t.id === id) || null;
function lookLoad() {
  LOOK.loading ||= api('/api/looks', { global: true }).then((c) => { LOOK.cat = c; lookApply(); return c; }).catch(() => null).finally(() => { LOOK.loading = null; });
  return LOOK.loading;
}
/* applyUi (01-ui.js) sets the light/dark mode and the old single accent; the theme goes on top of it. */
const lookApplyBase = applyUi;
// eslint-disable-next-line no-func-assign
applyUi = function applyUiAndLook() {
  lookApplyBase();
  const seen = JSON.stringify(S.ui.look || null);   // the look changed on the box (a reset, another screen): ask again
  if (LOOK.cat && LOOK.seen !== undefined && seen !== LOOK.seen) { LOOK.seen = seen; LOOK.key = ''; lookLoad(); return; }
  LOOK.seen = seen; lookApply();
};
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { LOOK.key = ''; lookApply(); });

function lookApply(look = LOOK.cat?.look) {
  const root = document.documentElement;
  if (!LOOK.cat) { if (!LOOK.loading) lookLoad(); return; }
  const id = lookThemeId(look), t = lookTheme(id); if (!t) return;
  root.dataset.look = id; root.dataset.theme = t.mode;
  try { localStorage.setItem('casatorch-look', `${id}:${t.mode}`); localStorage.setItem('casatorch-theme', t.mode); } catch { /* private window */ }
  for (const p of ['--accent', '--accent-2', '--on-accent', '--accent-text', '--glow-a', '--glow-b']) root.style.removeProperty(p);
  if (look?.accent && /^#[0-9a-f]{6}$/i.test(look.accent) && id !== 'contrast') {
    const a = lkAccentSet(look.accent, t.tokens), [r, g, b] = lkRgb(a.accent), [r2, g2, b2] = lkRgb(a.accent2), al = t.mode === 'dark' ? 0.1 : 0.16;
    root.style.setProperty('--accent', a.accent); root.style.setProperty('--accent-2', a.accent2); root.style.setProperty('--on-accent', a.onAccent); root.style.setProperty('--accent-text', a.accentText);
    root.style.setProperty('--glow-a', `rgba(${r},${g},${b},${al})`); root.style.setProperty('--glow-b', `rgba(${r2},${g2},${b2},${al})`);
  }
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.tokens.bg);
  lookBg(lookScreenBg() || look?.bg || { kind: 'none' }, t.mode);
}

/* ---- the background layer ---- */
const lookArtUrl = (q) => `/api/looks/art.svg?${new URLSearchParams(q)}`;
async function lookSceneNow(force) {
  if (!force && LOOK.scene && Date.now() - LOOK.sceneAt < 10 * 60_000) return LOOK.scene;
  try { LOOK.scene = await api('/api/looks/scene', { global: true, timeout: 6000 }); LOOK.sceneAt = Date.now(); } catch { /* the last one, or a fair sky */ }
  return LOOK.scene || { weather: { c: 'partly', t: 'day', fx: null }, season: 'fall' };
}
/* What a background shows right now: { url, fx, photo, credit }. */
async function lookBgSource(bg, mode) {
  const m = mode, motion = lookReduced() ? 0 : 1;
  switch (bg.kind) {
    case 'solid': return { url: lookArtUrl({ k: 'solid', c: bg.color, m }) };
    case 'gradient': return { url: lookArtUrl({ k: 'gradient', g: bg.gradient, m }) };
    case 'sport': return { url: lookArtUrl({ k: 'sport', s: bg.sport, m, ...(bg.team ? { c1: bg.team[0], c2: bg.team[1] } : {}) }) };
    case 'weather': { const s = await lookSceneNow(); return { url: lookArtUrl({ k: 'weather', c: s.weather.c, t: s.weather.t, m }), fx: s.weather.fx ? lookArtUrl({ k: 'fx', f: s.weather.fx, m }) : null, motion }; }
    case 'season': { const s = bg.season === 'auto' ? (await lookSceneNow()).season : bg.season; return { url: lookArtUrl({ k: 'season', s, m }), fx: s === 'winter' ? lookArtUrl({ k: 'fx', f: 'snow', m }) : null, motion }; }
    case 'photo':
      if (lookSaver()) return { url: lookArtUrl({ k: 'solid', c: bg.tone || '#1e293b', m }) };   // data saver: the photo's own color, not the photo
      return bg.photo ? { url: `/api/looks/photo/${bg.photo}`, photo: true } : null;
    case 'reel': {
      if (lookSaver()) return { url: lookArtUrl({ k: 'gradient', g: 'steel', m }) };
      if (!LOOK.reel) { try { LOOK.reel = { list: (await api('/api/photos', { global: true })).photos || [], i: -1 }; } catch { LOOK.reel = { list: [], i: -1 }; } }
      if (!LOOK.reel.list.length) return { url: lookArtUrl({ k: 'gradient', g: 'steel', m }) };
      LOOK.reel.i = (LOOK.reel.i + 1) % LOOK.reel.list.length;
      const p = LOOK.reel.list[LOOK.reel.i]; return { url: p.url, photo: true, credit: p.credit || null };
    }
    default: return null;
  }
}
function lookLayer() {
  let l = document.getElementById('ct-bg');
  if (!l) { l = el('div', { id: 'ct-bg', 'aria-hidden': 'true' }, el('div', { class: 'ct-bg-img' }), el('div', { class: 'ct-bg-img' }), el('div', { class: 'ct-bg-fx' }), el('div', { class: 'ct-bg-dim' }), el('div', { class: 'ct-bg-credit' })); document.body.prepend(l); }
  return l;
}
const lookPreload = (url) => new Promise((ok) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(true); i.onerror = () => ok(false); i.src = url; });
async function lookBg(bg, mode) {
  const root = document.documentElement, key = JSON.stringify([bg, mode, lookReduced(), lookSaver()]);
  if (key === LOOK.key) return;
  LOOK.key = key; clearTimeout(LOOK.reelT); clearInterval(LOOK.refreshT);
  if (!bg || bg.kind === 'none' || (bg.kind === 'photo' && !bg.photo)) { document.getElementById('ct-bg')?.remove(); root.classList.remove('has-bg'); return; }
  root.classList.add('has-bg');
  const l = lookLayer();
  l.style.setProperty('--bg-blur', bg.kind === 'photo' || bg.kind === 'reel' ? `${bg.blur || 0}px` : '0px');
  l.style.setProperty('--bg-dim', bg.kind === 'photo' || bg.kind === 'reel' ? String((bg.dim ?? 35) / 100) : '0');
  const show = async () => {
    const src = await lookBgSource(bg, mode); if (LOOK.key !== key) return;
    if (!src) { l.querySelectorAll('.ct-bg-img').forEach((n) => n.classList.remove('on')); return; }
    await new Promise((ok) => (window.requestIdleCallback ? requestIdleCallback(ok, { timeout: 800 }) : setTimeout(ok, 60)));   // after the page is drawn
    if (!(await lookPreload(src.url)) || LOOK.key !== key) return;
    const [a, b] = l.querySelectorAll('.ct-bg-img'), cur = a.classList.contains('on') ? a : b, next = cur === a ? b : a;
    next.style.backgroundImage = `url("${src.url}")`; next.classList.toggle('photo', !!src.photo);
    next.classList.add('on'); cur.classList.remove('on');
    const fx = l.querySelector('.ct-bg-fx'); fx.style.backgroundImage = src.fx ? `url("${src.fx}")` : ''; fx.classList.toggle('on', !!src.fx); fx.classList.toggle('still', !src.motion); fx.classList.toggle('snow', /f=snow/.test(src.fx || ''));
    l.querySelector('.ct-bg-credit').textContent = src.credit ? `${T('Photo')}: ${src.credit}` : '';
  };
  await show();
  if (bg.kind === 'reel') { const tick = () => { LOOK.reelT = setTimeout(async () => { if (!document.hidden) await show(); if (LOOK.key === key) tick(); }, (bg.reelMin || 10) * 60_000); }; tick(); }
  if (bg.kind === 'weather' || (bg.kind === 'season' && bg.season === 'auto')) LOOK.refreshT = setInterval(async () => { if (document.hidden) return; await lookSceneNow(true); if (LOOK.key === key) show(); }, 15 * 60_000);
}

/* ---- saving ---- */
async function lookSave(patch, { screen = false } = {}) {
  const cur = LOOK.cat.look, next = { ...cur, ...patch, bg: { ...cur.bg, ...(patch.bg || {}) } };
  if (screen) { lookSetScreenBg({ ...(lookScreenBg() || cur.bg), ...(patch.bg || {}) }); lookApply(); return; }
  LOOK.cat = { ...LOOK.cat, look: next }; lookApply();
  clearTimeout(LOOK.saveT);
  return new Promise((ok) => { LOOK.saveT = setTimeout(async () => { try { const r = await post('/api/looks', next, 'PUT'); LOOK.cat = { ...LOOK.cat, look: r.look }; LOOK.seen = JSON.stringify(r.look); S.ui = { ...S.ui, look: r.look, theme: next.theme === 'auto' ? 'auto' : lookTheme(next.theme)?.mode || S.ui.theme }; } catch (e) { toast(e.message, 4000); } ok(); }, 350); });
}
/* A photo for the background: opened here (turned upright, HEIC where this browser can read it), made 3840 px on the
   long side at most and saved again as WebP or JPEG - which leaves every bit of metadata behind - then sent. */
async function lookPhotoPrepare(file) {
  if (file.size > 60e6) throw new Error(T('That photo is over 60 MB - pick a smaller one.'));
  const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; }
  catch {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); src = img; w = img.naturalWidth; h = img.naturalHeight; }
    catch { throw new Error(heic ? T('This browser can\'t open HEIC photos. Try again in Safari, or save the photo as JPEG first.') : T('That file isn\'t a photo CasaTorch can open (JPEG, PNG, WebP or HEIC).')); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const max = LOOK.cat?.maxSide || 3840, k = Math.min(1, max / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  const cv = el('canvas'); cv.width = cw; cv.height = ch; cv.getContext('2d').drawImage(src, 0, 0, cw, ch); src.close?.();
  const sm = el('canvas'); sm.width = 8; sm.height = 8; const sx = sm.getContext('2d'); sx.drawImage(cv, 0, 0, 8, 8);
  const px = sx.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0; for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
  const tone = lkHex([r / 64, g / 64, b / 64]);
  let blob = await new Promise((ok) => cv.toBlob(ok, 'image/webp', 0.82));
  if (!blob || blob.type !== 'image/webp' || blob.size > (LOOK.cat?.maxBytes || 12e6)) blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.84));
  cv.width = cv.height = 0;
  if (!blob) throw new Error(T('That photo couldn\'t be prepared - try another one.'));
  return { blob, tone };
}

/* ---- Settings › Look & main bar: theme, accent and background ---- */
const LOOK_KINDS = [['none', 'None'], ['solid', 'Color'], ['gradient', 'Gradient'], ['weather', 'Weather'], ['season', 'Seasons'], ['sport', 'Sports'], ['photo', 'Your photo'], ['reel', 'Photo reel']];
const LOOK_SEASON_NAMES = { auto: 'Follow the calendar', spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter', newyear: 'New Year', hearts: 'Hearts', harvest: 'Harvest', lights: 'Winter lights' };
const LOOK_SOLIDS = ['#1e293b', '#0f3d3e', '#3b1d4a', '#4a1d2b', '#1d3557', '#2f3e1f', '#e8edf5', '#f3e9dc'];
function lookPreviewEl(t, small) {
  const v = t.tokens, st = `--p-bg:${v.bg};--p-solid:${v.solid};--p-text:${v.text};--p-muted:${v.muted};--p-accent:${v.accent};--p-accent2:${v['accent-2']};--p-line:${v['line-2']}`;
  return el('span', { class: `lk-prev${small ? ' sm' : ''}`, style: st }, el('i', { class: 'lk-p-card' }, el('b', {}), el('s', {}), el('u', {})), el('i', { class: 'lk-p-card two' }, el('b', {}), el('s', {})));
}
function lookThemesCard() {
  const card = el('div', { class: 'card wide lk-card', id: 'look-themes' });
  const draw = async () => {
    if (!LOOK.cat) await lookLoad();
    if (!LOOK.cat) { card.replaceChildren(el('h2', {}, icon('palette', 15), T('Theme and background')), el('p', { class: 'muted' }, T('Can\'t reach CasaTorch right now.'))); return; }
    const c = LOOK.cat, look = c.look, can = c.canEdit, screenBg = lookScreenBg(), bg = screenBg || look.bg, onScreen = !!screenBg;
    const save = (patch) => lookSave(patch).then(draw);
    const saveBg = (p) => lookSave({ bg: p }, { screen: onScreen }).then(draw);
    const bgEditable = can || onScreen;
    /* themes */
    const auto = el('button', { type: 'button', class: `lk-theme${look.theme === 'auto' ? ' on' : ''}`, 'aria-pressed': String(look.theme === 'auto'), disabled: !can || null, onclick: () => save({ theme: 'auto' }) },
      el('span', { class: 'lk-split' }, lookPreviewEl(lookTheme('midnight') || c.themes[0]), lookPreviewEl(lookTheme('daylight') || c.themes[1])), el('span', { class: 'lk-name' }, T('Auto')), el('span', { class: 'lk-sub' }, T('Follows this device: dark at night')));
    const themes = el('div', { class: 'lk-themes', role: 'group', 'aria-label': T('Theme') }, auto, ...c.themes.map((t) => el('button', { type: 'button', class: `lk-theme${look.theme === t.id ? ' on' : ''}`, 'aria-pressed': String(look.theme === t.id), disabled: !can || null, onclick: () => save({ theme: t.id }) },
      lookPreviewEl(t), el('span', { class: 'lk-name' }, T(t.name)), el('span', { class: 'lk-sub' }, t.mode === 'light' ? T('Light') : T('Dark')))));
    /* accent */
    const curT = lookTheme(lookThemeId(look)), set = look.accent && curT ? lkAccentSet(look.accent, curT.tokens) : null;
    const custom = el('input', { type: 'color', value: look.accent || curT?.tokens.accent || '#5eb8ff', 'aria-label': T('Your own accent color'), disabled: !can || null, class: 'lk-color' });
    let liveT = null; custom.oninput = () => { LOOK.cat.look = { ...LOOK.cat.look, accent: custom.value }; lookApply(); clearTimeout(liveT); liveT = setTimeout(() => save({ accent: custom.value }), 450); };
    const accent = el('div', { class: 'row wrap', style: 'gap:8px' },
      el('button', { type: 'button', class: `chipbtn${!look.accent ? ' on' : ''}`, disabled: !can || null, onclick: () => save({ accent: null }) }, T('Theme color')),
      el('span', { class: 'swatches', style: 'margin:0' }, ...PALETTES.map(([name, x]) => el('button', { type: 'button', class: `swatch${look.accent === x ? ' on' : ''}`, title: T(name), 'aria-label': T('Accent {name}', { name: T(name) }), style: `background:${x}`, disabled: !can || null, onclick: () => save({ accent: x }) }))),
      el('label', { class: 'row small muted', style: 'gap:6px' }, T('Custom'), custom));
    const accentNote = curT?.id === 'contrast' ? T('High contrast keeps its own yellow accent.') : set?.changed ? T('Adjusted a little so text on it stays easy to read.') : T('Buttons, links and highlights. Text on it always stays readable.');
    /* background */
    const kinds = el('div', { class: 'chips lk-kinds', role: 'group', 'aria-label': T('Background') }, ...LOOK_KINDS.map(([k, label]) => el('button', { type: 'button', class: `chip${bg.kind === k ? ' on' : ''}`, 'aria-pressed': String(bg.kind === k), disabled: !bgEditable || null, onclick: () => saveBg({ kind: k }) }, T(label))));
    const m = curT?.mode || 'dark', thumb = (q, label, on, onclick, extra) => el('button', { type: 'button', class: `lk-thumb${on ? ' on' : ''}`, 'aria-pressed': String(!!on), disabled: !bgEditable || null, onclick }, el('img', { src: lookArtUrl({ ...q, m }), alt: '', loading: 'lazy', decoding: 'async', width: 160, height: 100 }), el('span', {}, label), extra || null);
    const opts = el('div', { class: 'lk-opts' }), put = (...k) => opts.append(...k.filter(Boolean));
    const slider = (label, key, min, max, unit) => { const v = el('span', { class: 'tiny muted num' }, `${bg[key]}${unit}`); const r = el('input', { type: 'range', min, max, value: bg[key], disabled: !bgEditable || null, 'aria-label': label, oninput: (e) => { v.textContent = `${e.target.value}${unit}`; document.getElementById('ct-bg')?.style.setProperty(key === 'blur' ? '--bg-blur' : '--bg-dim', key === 'blur' ? `${e.target.value}px` : String(e.target.value / 100)); }, onchange: (e) => saveBg({ [key]: Number(e.target.value) }) }); return el('label', { class: 'lk-slider' }, el('span', { class: 'small' }, label), r, v); };
    if (bg.kind === 'solid') {
      const pick = el('input', { type: 'color', value: bg.color, class: 'lk-color', 'aria-label': T('Your own color'), disabled: !bgEditable || null, onchange: (e) => saveBg({ color: e.target.value }) });
      put(el('div', { class: 'row wrap', style: 'gap:8px' }, el('span', { class: 'swatches', style: 'margin:0' }, ...LOOK_SOLIDS.map((x) => el('button', { type: 'button', class: `swatch${bg.color === x ? ' on' : ''}`, style: `background:${x}`, 'aria-label': x, disabled: !bgEditable || null, onclick: () => saveBg({ color: x }) }))), el('label', { class: 'row small muted', style: 'gap:6px' }, T('Custom'), pick)),
        el('p', { class: 'tiny faint' }, T('Made a little lighter or darker for the theme, so text stays readable.')));
    } else if (bg.kind === 'gradient') put(el('div', { class: 'lk-thumbs' }, ...c.gradients.map((g) => thumb({ k: 'gradient', g: g.id }, T(g.name), bg.gradient === g.id, () => saveBg({ gradient: g.id })))));
    else if (bg.kind === 'weather') {
      const s = await lookSceneNow();
      put(el('div', { class: 'lk-thumbs' }, thumb({ k: 'weather', c: s.weather.c, t: s.weather.t }, T('Right now'), true, () => {})), el('p', { class: 'small muted' }, T('Changes with the weather at your home and the time of day - sun, clouds, rain, snow, fog, dusk and starry nights. Rain and snow move gently unless this device asks for less motion.')));
    } else if (bg.kind === 'season') {
      put(el('div', { class: 'lk-thumbs' }, thumb({ k: 'season', s: (await lookSceneNow()).season }, T(LOOK_SEASON_NAMES.auto), bg.season === 'auto', () => saveBg({ season: 'auto' })),
        ...c.seasons.map((s) => thumb({ k: 'season', s }, T(LOOK_SEASON_NAMES[s]), bg.season === s, () => saveBg({ season: s })))),
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', style: 'width:auto', checked: bg.holidays !== false, disabled: !bgEditable || null, onchange: (e) => saveBg({ holidays: e.target.checked }) }), el('span', {}, T('Holidays too: New Year, hearts in February, harvest at the end of October and winter lights in December (when following the calendar)'))));
    } else if (bg.kind === 'sport') {
      const team = bg.team, c1 = el('input', { type: 'color', value: team?.[0] || '#1b2a4a', class: 'lk-color', 'aria-label': T('First team color'), disabled: !bgEditable || null }), c2 = el('input', { type: 'color', value: team?.[1] || '#f26b1d', class: 'lk-color', 'aria-label': T('Second team color'), disabled: !bgEditable || null });
      c1.onchange = c2.onchange = () => saveBg({ team: [c1.value, c2.value] });
      put(el('div', { class: 'lk-thumbs' }, ...c.sports.map((s) => thumb({ k: 'sport', s: s.id, ...(team ? { c1: team[0], c2: team[1] } : {}) }, T(s.name), bg.sport === s.id, () => saveBg({ sport: s.id })))),
        el('div', { class: 'small muted', style: 'margin:12px 0 6px' }, T('Team colors')),
        el('div', { class: 'row wrap', style: 'gap:8px' }, el('button', { type: 'button', class: `chipbtn${!team ? ' on' : ''}`, disabled: !bgEditable || null, onclick: () => saveBg({ team: null }) }, T('Natural colors')),
          ...c.teamColors.map((tc) => el('button', { type: 'button', class: `lk-pair${team && team[0] === tc.colors[0] && team[1] === tc.colors[1] ? ' on' : ''}`, title: T(tc.name), 'aria-label': T(tc.name), disabled: !bgEditable || null, onclick: () => saveBg({ team: tc.colors }) }, el('i', { style: `background:${tc.colors[0]}` }), el('i', { style: `background:${tc.colors[1]}` }))),
          el('label', { class: 'row small muted', style: 'gap:6px' }, T('Custom'), c1, c2)),
        el('p', { class: 'tiny faint' }, T('Pick your team\'s colors - CasaTorch draws its own generic art and never shows team names or logos.')));
    } else if (bg.kind === 'photo') {
      const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif', hidden: true });
      const msg = el('p', { class: 'small', role: 'status' });
      input.onchange = async () => {
        const f = input.files?.[0]; if (!f) return;
        msg.textContent = T('Preparing the photo...'); msg.style.color = '';
        try {
          const { blob, tone } = await lookPhotoPrepare(f);
          msg.textContent = T('Uploading...');
          const r = await api(`/api/looks/photo`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type }, timeout: 90_000 });
          await lookSave({ bg: { kind: 'photo', photo: r.id, tone } }, { screen: onScreen }); draw();
        } catch (e) { msg.textContent = e.message; msg.style.color = 'var(--bad)'; }
      };
      const canUp = can && !c.demo;
      put(bg.photo ? el('img', { class: 'lk-photo', src: `/api/looks/photo/${bg.photo}`, alt: T('Your background photo'), loading: 'lazy' }) : null,
        el('div', { class: 'row wrap', style: 'gap:8px' }, el('button', { type: 'button', class: 'btn', disabled: !canUp || null, onclick: () => input.click() }, icon('image', 16), bg.photo ? T('Choose another photo') : T('Choose a photo')),
          bg.photo && can ? el('button', { type: 'button', class: 'btn ghost', onclick: async () => { try { const r = await api(`/api/looks/photo/${bg.photo}`, { method: 'DELETE' }); LOOK.cat = { ...LOOK.cat, look: r.look }; if (onScreen) lookSetScreenBg({ ...bg, kind: 'none', photo: null }); lookApply(); draw(); } catch (e) { toast(e.message); } } }, icon('trash', 16), T('Remove')) : null, input),
        msg, el('p', { class: 'tiny faint' }, c.demo ? T('The demo doesn\'t keep photos - your own CasaTorch does.') : T('JPEG, PNG, WebP or HEIC. It is made 3840 pixels wide at most and saved again without its hidden details (where and when it was taken, the camera) before it leaves this device, then checked again on your CasaTorch. It stays on your CasaTorch.')));
      if (bg.photo) put(slider(T('Blur'), 'blur', 0, 30, ' px'), slider(T('Dim'), 'dim', 15, 85, '%'));
    } else if (bg.kind === 'reel') {
      let n = null; try { n = ((await api('/api/photos')).photos || []).length; } catch { /* unknown */ }
      put(el('p', { class: 'small muted' }, n ? T('Shows the photos from the Photos page, one after another ({n} photos).', { n }) : T('Shows the photos from the Photos page, one after another. Add some there first.')),
        el('div', { class: 'row wrap', style: 'gap:8px' }, el('label', { class: 'row small', style: 'gap:6px' }, T('Next photo every'), el('select', { style: 'width:auto', disabled: !bgEditable || null, onchange: (e) => saveBg({ reelMin: Number(e.target.value) }) }, ...[1, 5, 10, 30, 60].map((x) => el('option', { value: x, selected: (bg.reelMin || 10) === x || null }, T('{n} min', { n: x }))))), el('a', { class: 'btn small', href: '#photos' }, icon('image', 14), T('Photos'))),
        slider(T('Blur'), 'blur', 0, 30, ' px'), slider(T('Dim'), 'dim', 15, 85, '%'));
    }
    const screenTog = el('label', { class: 'check small' }, el('input', { type: 'checkbox', style: 'width:auto', checked: onScreen || null, onchange: (e) => { lookSetScreenBg(e.target.checked ? { ...look.bg } : null); LOOK.key = ''; lookApply(); draw(); } }),
      el('span', {}, T('A different background on this screen only'), el('span', { class: 'tiny faint', style: 'display:block' }, T('For a wall tablet or a phone. Kept in this browser; the theme stays the same everywhere.'))));
    card.replaceChildren(el('h2', {}, icon('palette', 15), T('Theme')), themes,
      el('div', { class: 'small muted', style: 'margin:16px 0 8px' }, T('Accent color')), accent, el('p', { class: 'tiny faint' }, accentNote),
      el('h2', { style: 'margin-top:20px' }, icon('image', 15), T('Background')), kinds, opts, screenTog,
      el('p', { class: 'tiny faint' }, T('Cards get a frosted surface over any background, so text stays easy to read.'), ' ', el('a', { href: 'https://casatorch.com/docs/use/home-screen#themes', target: '_blank', rel: 'noopener' }, T('Learn more'))),
      ...(!can ? [el('p', { class: 'small muted' }, T('Only an admin can change the home\'s theme and background. You can still give this screen its own background.'))] : []));
  };
  draw();
  return card;
}
