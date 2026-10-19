/* Unit tests for themes and backgrounds (src/server/09t-themes.js, src/client/03-themes.js, the tokens in public/app.css):
   every theme's text passes WCAG AA, a chosen accent is made safe, our art stays readable under the theme's text,
   and a background photo is checked by its bytes and rebuilt without its metadata. Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const FIX = { jpg: '/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAwAEADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAWEAADAAAAAAAAAAAAAAAAAAAAFGH/xAAWAQEBAQAAAAAAAAAAAAAAAAAABQb/xAAXEQEAAwAAAAAAAAAAAAAAAAAAFBVh/9oADAMBAAIRAxEAPwCEtAtCuvAvDVWGosdIWgWhXXgXgsNI6QtAtCuvAvBYaR0haBaFdeBeCw0jrC8C8K68C8MNYauR0heBeFdeBeCw0jpC8C8K68C8FhpHSF4F4V14F4LDSOsLwLwsLwLww9hq5HR14F4WF4F4LDSOjrwLwsLwLwWGkdHXgXhYXgXgsNI7/9k=', prog: '/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAwAEADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAWAQEBAQAAAAAAAAAAAAAAAAAABAX/2gAMAwEAAhADEAAAAYFjVijWCNYI1gsVsK6RWJFYkVixYw7o1gjWCNYP/8QAFRABAQAAAAAAAAAAAAAAAAAAABL/2gAIAQEAAQUClKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpSlKUpS/8QAFREBAQAAAAAAAAAAAAAAAAAAABP/2gAIAQMBAT8Bmmmmmmmmmmmm/8QAFREBAQAAAAAAAAAAAAAAAAAAABT/2gAIAQIBAT8BoUKFChQoUKFChQ//xAAUEAEAAAAAAAAAAAAAAAAAAABQ/9oACAEBAAY/AkP/xAAUEAEAAAAAAAAAAAAAAAAAAABQ/9oACAEBAAE/IUAAAAAAAAP/2gAMAwEAAgADAAAAEMMMMDjjjvvvvv/EABQRAQAAAAAAAAAAAAAAAAAAADD/2gAIAQMBAT8QQAD/xAAVEQEBAAAAAAAAAAAAAAAAAAAAcf/aAAgBAgEBPxClKUpSlKUpT//EABUQAQEAAAAAAAAAAAAAAAAAAABx/9oACAEBAAE/EJSlKUpShCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEP/Z', webp: 'UklGRn4AAABXRUJQVlA4IHIAAAAwBQCdASpAADAAPpFAmUk3OCIhKBVdUwASCUBcACT5MRWBf/oBp2jpQUV1+HYcaxIJ2AD+5TPe+7Iv4aeyhl+3TcVgekwQrnEwwF1YDfki9u8m0HC2HoES/sWT71ahp6HSJGqPPI0G/LKaYDiSFc3aQAA=', webpl: 'UklGRlwAAABXRUJQVlA4TE8AAAAvP8ALAJmM6H9sYuij/1EOxW3bRnCGzf573EnPVysWTPGziBIIJPm7zHiobduGsdPL6Cf4rjSBOBBxwO43RPrfXv/qLvzw3W+I/L2NHt1dAA==' };
const seg = (marker, payload) => { const b = Buffer.alloc(4); b[0] = 0xff; b[1] = marker; b.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([b, payload]); };
const chunk = (type, data) => { const L = globalThis.__casatorchLook, len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'latin1'), data]); len.writeUInt32BE(data.length); crc.writeUInt32BE(L.lkCrc32(body)); return Buffer.concat([len, body, crc]); };
const riff = (id, data) => { const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
const webpOf = (chunks) => { const body = Buffer.concat(chunks), h = Buffer.alloc(12); h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(body.length + 4, 4); h.write('WEBP', 8, 'latin1'); return Buffer.concat([h, body]); };
const GPS = 'GPSLatitude 47.6205 N GPSLongitude 122.3493 W';   // scrub-ok: a made-up position the test checks is removed

export default async function themesTests(t) {
  const L = globalThis.__casatorchLook;
  const themes = L.lkThemes(), tok = (th, k) => L.lkParseRgba(th.tokens[k]);
  const NEED = ['bg', 'solid', 'surface', 'surface-2', 'surface-3', 'line', 'line-2', 'text', 'muted', 'faint', 'accent', 'accent-2', 'accent-text', 'on-accent', 'good', 'warn', 'bad', 'banner-text', 'rail-bg', 'inset', 'frost', 'glow-a', 'glow-b', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'look-mode'];

  t('themes: eight curated themes in app.css, each a full token set of plain colors', () => {
    assert.deepEqual(themes.map((x) => x.id), L.LK_THEMES.map(([id]) => id));
    assert.ok(themes.length >= 8);
    for (const th of themes) for (const k of NEED) { assert.ok(th.tokens[k], `${th.id} has --${k}`); if (k !== 'look-mode') assert.ok(tok(th, k), `${th.id} --${k} is #hex or rgba(): ${th.tokens[k]}`); }
    assert.ok(themes.some((x) => x.mode === 'light') && themes.some((x) => x.mode === 'dark'));
  });
  t('themes: every text color passes WCAG AA (4.5:1) on the page, on cards, and on frosted cards over a white or black picture', () => {
    const fails = [];
    for (const th of themes) {
      const bg = L.lkOver(tok(th, 'bg'), [0, 0, 0, 1]), solid = L.lkOver(tok(th, 'solid'), [0, 0, 0, 1]), grounds = { page: bg, card: solid, glass: L.lkOver(tok(th, 'surface'), L.lkParseRgba(bg)),
        raised: L.lkOver(tok(th, 'surface-3'), L.lkParseRgba(solid)), 'frost on white': L.lkOver(tok(th, 'frost'), [255, 255, 255, 1]), 'frost on black': L.lkOver(tok(th, 'frost'), [0, 0, 0, 1]) };
      for (const fg of ['text', 'muted', 'faint', 'accent-text', 'good', 'warn', 'bad']) for (const [gn, g] of Object.entries(grounds)) {
        const need = th.id === 'contrast' && ['text', 'muted'].includes(fg) ? 7 : 4.5, c = L.lkContrast(th.tokens[fg], g);
        if (c < need) fails.push(`${th.id}: ${fg} on ${gn} ${c.toFixed(2)}`);
      }
      for (const k of ['accent', 'accent-2']) if (L.lkContrast(th.tokens['on-accent'], th.tokens[k]) < 4.5) fails.push(`${th.id}: text on ${k}`);
      if (L.lkContrast(th.tokens['banner-text'], bg) < 4.5) fails.push(`${th.id}: banner text`);
    }
    assert.deepEqual(fails, []);
  });
  t('themes: chart colors and the accent stand out from cards (3:1, WCAG non-text contrast)', () => {
    const fails = [];
    for (const th of themes) for (const k of ['accent', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6']) { const c = L.lkContrast(th.tokens[k], th.tokens.solid); if (c < 3) fails.push(`${th.id}: ${k} ${c.toFixed(2)}`); }
    assert.deepEqual(fails, []);
  });
  t('themes: any accent color is made safe - text on buttons 4.5:1 (both gradient ends), links 4.5:1 on cards and the page', () => {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const picks = [...Array.from({ length: 160 }, () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`), '#000000', '#ffffff', '#ffff00', '#0000ff', '#808080', '#5eb8ff'];
    for (const th of themes) for (const hex of picks) {
      const a = L.lkAccentSet(hex, th.tokens);
      assert.ok(L.lkContrast(a.onAccent, a.accent) >= 4.5, `${th.id} ${hex}: button text ${L.lkContrast(a.onAccent, a.accent).toFixed(2)}`);
      assert.ok(L.lkContrast(a.onAccent, a.accent2) >= 4.5, `${th.id} ${hex}: second color`);
      assert.ok(L.lkContrast(a.accentText, th.tokens.solid) >= 4.5 && L.lkContrast(a.accentText, th.tokens.bg) >= 4.5, `${th.id} ${hex}: link text ${a.accentText}`);
    }
  });
  t('themes: the browser\'s color math is the same as the server\'s', () => {
    const src = fs.readFileSync(new URL('../src/client/03-themes.js', import.meta.url), 'utf8');
    const block = src.split('/* @look-color:begin */')[1].split('/* @look-color:end */')[0];
    const C = new Function(`${block}; return { lkAccentSet, lkContrast };`)();
    for (const th of themes) for (const hex of ['#5eb8ff', '#ff0000', '#22aa44', '#f0e68c', '#111111', '#7b61ff']) assert.deepEqual(C.lkAccentSet(hex, th.tokens), L.lkAccentSet(hex, th.tokens));
    assert.equal(C.lkContrast('#000000', '#ffffff'), 21);
  });
  t('themes: art colors stay in the readable band - every theme\'s text is 4.5:1 right on them', () => {
    const b = L.lkBand();
    for (let i = 0; i < 400; i++) {
      const hex = `#${((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0')}`;
      for (const th of themes) { const c = L.lkTone(hex, th.mode); assert.ok(L.lkContrast(th.tokens.text, c) >= 4.5, `${th.id}: text on art ${c} (${hex}) ${L.lkContrast(th.tokens.text, c).toFixed(2)}`); }
    }
    assert.ok(b.darkMax > 0.05 && b.lightMin < 0.6, JSON.stringify(b));
  });
  t('backgrounds: every kind of art is our own SVG, with nothing but fixed choices and #hex colors in it', () => {
    const qs = [];
    for (const m of ['dark', 'light']) {
      for (const c of L.LK_CONDS) for (const tm of L.LK_TIMES) qs.push({ k: 'weather', c, t: tm, m });
      for (const s of [...L.LK_SEASONS, ...L.LK_HOLIDAYS]) qs.push({ k: 'season', s, m });
      for (const [s] of L.LK_SPORTS) { qs.push({ k: 'sport', s, m }); qs.push({ k: 'sport', s, m, c1: '#1b2a4a', c2: '#f26b1d' }); }
      for (const [g] of L.LK_GRADIENTS) qs.push({ k: 'gradient', g, m });
      qs.push({ k: 'solid', c: '#ffcc00', m }, { k: 'fx', f: 'rain', m }, { k: 'fx', f: 'snow', m });
    }
    for (const q of qs) {
      const s = L.lkArt(q);
      assert.ok(s && s.startsWith('<svg') && s.endsWith('</svg>'), JSON.stringify(q));
      assert.ok(!/<script|\son\w+=|href|<foreignObject|url\((?!#)/i.test(s), `${JSON.stringify(q)}: only shapes and gradients`);
      assert.ok(!/NaN|undefined/.test(s), `${JSON.stringify(q)}: no broken numbers`);
    }
    const evil = L.lkArt({ k: 'solid', c: '"/><script>x</script>', m: 'dark' }) + L.lkArt({ k: 'sport', s: 'field', c1: 'red;x', m: 'dark' }) + L.lkArt({ k: 'weather', c: '<b>', t: 'x' });
    assert.ok(!/script|red;x|<b>/.test(evil));
    assert.equal(L.lkArt({ k: 'nope' }), null);
  });
  t('backgrounds: the season follows the hemisphere and a few generic holidays (or not)', () => {
    const at = (iso) => new Date(iso);
    assert.equal(L.lkSeasonNow(at('2026-10-30T18:00:00Z'), { lat: 47, tz: 'America/Los_Angeles' }), 'harvest');
    assert.equal(L.lkSeasonNow(at('2026-10-30T18:00:00Z'), { lat: 47, tz: 'America/Los_Angeles', holidays: false }), 'fall');
    assert.equal(L.lkSeasonNow(at('2026-07-10T12:00:00Z'), { lat: -33.9, tz: 'Australia/Sydney' }), 'winter');
    assert.equal(L.lkSeasonNow(at('2026-04-10T12:00:00Z'), { lat: 47, tz: 'UTC' }), 'spring');
    assert.equal(L.lkSeasonNow(at('2026-12-31T20:00:00Z'), { lat: 47, tz: 'UTC' }), 'newyear');
    assert.equal(L.lkSeasonNow(at('2026-12-20T20:00:00Z'), { lat: 47, tz: 'UTC' }), 'lights');
    assert.equal(L.lkSeasonNow(at('2026-02-14T12:00:00Z'), { lat: 47, tz: 'UTC' }), 'hearts');
  });
  t('backgrounds: day, twilight and night from the sun; the weather word from the forecast symbol', () => {
    assert.ok(L.lkSunElevation(0, 0, new Date('2026-03-20T12:00:00Z')) > 80, 'noon at the equator in March: overhead');
    assert.ok(L.lkSunElevation(47.6, -122.3, new Date('2026-06-21T20:00:00Z')) > 50, 'Seattle, June, 1 pm');
    assert.ok(L.lkSunElevation(47.6, -122.3, new Date('2026-06-21T08:00:00Z')) < -6, 'Seattle, June, 1 am');
    assert.deepEqual(['clearsky_day', 'fair_night', 'cloudy', 'lightrainshowers_day', 'heavysnow', 'rainandthunder', 'fog', 'sleet'].map(L.lkCond), ['clear', 'partly', 'cloudy', 'rain', 'snow', 'storm', 'fog', 'snow']);
  });
  t('looks: only known values are kept (themes, kinds, colors, photo names)', () => {
    const cur = { theme: 'midnight', accent: null, bg: { kind: 'none', color: '#1e293b', gradient: 'aurora', season: 'auto', holidays: true, sport: 'field', team: null, photo: null, tone: null, blur: 0, dim: 35, reelMin: 10 } };
    const a = L.lookClean({ theme: 'evil', accent: 'red', bg: { kind: 'x', color: 'url(x)', gradient: '../a', photo: '../../config.json', team: ['#fff', 'x'], blur: 999, dim: -5, reelMin: 7, sport: 'brand' } }, cur);
    assert.deepEqual(a, { ...cur, bg: { ...cur.bg, blur: 30, dim: 15 } }, 'numbers are held to their range, everything else is ignored');
    const b = L.lookClean({ theme: 'ocean', accent: '#FF8800', bg: { kind: 'sport', sport: 'rink', team: ['#112233', '#AABBCC'], blur: 12, dim: 60 } }, cur);
    assert.equal(b.theme, 'ocean'); assert.equal(b.accent, '#ff8800'); assert.equal(b.bg.kind, 'sport'); assert.deepEqual(b.bg.team, ['#112233', '#aabbcc']); assert.equal(b.bg.blur, 12); assert.equal(b.bg.dim, 60);
    assert.equal(L.lookClean({ theme: 'auto' }, cur).theme, 'auto');
    assert.equal(L.lookClean({ bg: { photo: 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg' } }, cur).bg.photo, null, 'a photo that isn\'t on the box');
  });

  /* ---- photo uploads ---- */
  const jpg = Buffer.from(FIX.jpg, 'base64'), prog = Buffer.from(FIX.prog, 'base64');
  const withMeta = (j) => Buffer.concat([j.subarray(0, 2), seg(0xe0, Buffer.from('JFIF\0\x01\x02\0\0\x01\0\x01\0\0', 'latin1')), seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(`MM\0*${GPS} Make=PhoneCo Model=X1 DateTimeOriginal=2026:10:01`, 'latin1')])),
    seg(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description exif:${GPS}/></x:xmpmeta>`, 'latin1')), seg(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01 device: OwnerCam', 'latin1')), seg(0xed, Buffer.from('Photoshop 3.0\0 IPTC by: someone', 'latin1')),
    seg(0xfe, Buffer.from('comment: at the lake house', 'latin1')), j.subarray(2), Buffer.from('trailing secret after the end', 'latin1')]);
  const META = /Exif|GPS|xmpmeta|ICC_PROFILE|Photoshop|OwnerCam|lake house|PhoneCo|trailing secret|JFIF/;
  t('photos: the real type comes from the bytes - not the name or what the browser says', () => {
    assert.equal(L.lkSniff(jpg), 'jpg'); assert.equal(L.lkSniff(Buffer.from(FIX.webp, 'base64')), 'webp');
    for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<!doctype html><script>x</script>....', 'GIF89a\x01\0\x01\0\0\0\0;............', '%PDF-1.7 ....................'])
      assert.throws(() => L.lkCleanImage(Buffer.from(bad, 'latin1')), (e) => e.status === 415);
    assert.throws(() => L.lkCleanImage(Buffer.alloc(5)), (e) => e.status === 400);
    assert.throws(() => L.lkCleanImage(Buffer.concat([jpg, Buffer.alloc(13 * 1024 * 1024)])), (e) => e.status === 413);
  });
  t('photos: a JPEG loses EXIF (GPS, camera, time), XMP, color profile, Photoshop data, comments and anything after its end - the picture stays byte for byte', () => {
    for (const j of [jpg, prog]) {
      const r = L.lkCleanImage(withMeta(j));
      assert.equal(r.type, 'image/jpeg'); assert.equal(r.w, 64); assert.equal(r.h, 48);
      assert.ok(!META.test(r.buf.toString('latin1')), 'no metadata left');
      assert.deepEqual([r.buf[r.buf.length - 2], r.buf[r.buf.length - 1]], [0xff, 0xd9]);
      const strip = (b) => { const out = []; let i = 2; while (i < b.length) { const m = b[i + 1]; if (m === 0xd9) break; const len = b.readUInt16BE(i + 2); if (!(m >= 0xe0 && m <= 0xef) && m !== 0xfe) out.push(b.subarray(i, i + 2 + len)); i += 2 + len; if (m === 0xda) { let k = i; while (!(b[k] === 0xff && b[k + 1] !== 0 && !(b[k + 1] >= 0xd0 && b[k + 1] <= 0xd7))) k++; out.push(b.subarray(i, k)); i = k; } } return Buffer.concat(out); };
      assert.ok(strip(r.buf).equals(strip(j)), 'every table, frame and scan is unchanged');
    }
  });
  t('photos: too big, cut off or broken JPEGs are refused', () => {
    const big = Buffer.from(jpg); const sof = big.indexOf(Buffer.from([0xff, 0xc0])); big.writeUInt16BE(3000, sof + 5); big.writeUInt16BE(4000, sof + 7);
    assert.throws(() => L.lkCleanImage(big), (e) => e.status === 413 && /4000 × 3000/.test(e.message));
    assert.throws(() => L.lkCleanImage(jpg.subarray(0, jpg.length - 40)), /cut off|damaged/);
    const bad = Buffer.from(jpg); bad.writeUInt16BE(0xfff0, 4); assert.throws(() => L.lkCleanImage(bad), /damaged/);
  });
  t('photos: a PNG loses text, EXIF and time chunks (checksums checked), keeps every pixel; moving PNGs are refused', () => {
    const { PNG } = createRequire(import.meta.url)('pngjs');
    const png = new PNG({ width: 80, height: 64 }); for (let i = 0; i < png.data.length; i += 4) { png.data[i] = i % 251; png.data[i + 1] = (i >> 3) % 255; png.data[i + 2] = 90; png.data[i + 3] = 255; }
    const clean = PNG.sync.write(png), ihdrEnd = 8 + 25;
    const dirty = Buffer.concat([clean.subarray(0, ihdrEnd), chunk('tEXt', Buffer.from(`Comment\0${GPS}`, 'latin1')), chunk('eXIf', Buffer.from(`MM\0*${GPS}`, 'latin1')), chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>', 'latin1')), chunk('tIME', Buffer.from([7, 234, 10, 1, 12, 0, 0])), clean.subarray(ihdrEnd)]);
    const r = L.lkCleanImage(dirty);
    assert.equal(r.type, 'image/png'); assert.equal(r.w, 80); assert.equal(r.h, 64);
    assert.ok(!/GPS|xmpmeta|tEXt|eXIf|tIME/.test(r.buf.toString('latin1')));
    assert.ok(PNG.sync.read(r.buf).data.equals(png.data), 'the same pixels');
    const anim = Buffer.concat([clean.subarray(0, ihdrEnd), chunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])), clean.subarray(ihdrEnd)]);
    assert.throws(() => L.lkCleanImage(anim), /Moving/);
    const crc = Buffer.from(clean); crc[ihdrEnd + 8] ^= 0xff; assert.throws(() => L.lkCleanImage(crc), /damaged/);
  });
  t('photos: a WebP loses EXIF, XMP and its color profile, and its header says so; moving WebPs are refused', () => {
    for (const src of [FIX.webp, FIX.webpl]) {
      const w = Buffer.from(src, 'base64'), pic = w.subarray(12), vp8x = Buffer.alloc(10); vp8x[0] = 0x20 | 0x08 | 0x04; vp8x.writeUIntLE(63, 4, 3); vp8x.writeUIntLE(47, 7, 3);
      const dirty = webpOf([riff('VP8X', vp8x), riff('ICCP', Buffer.from('ICC device: OwnerCam')), pic, riff('EXIF', Buffer.from(`MM\0*${GPS}`, 'latin1')), riff('XMP ', Buffer.from(`<x:xmpmeta>${GPS}</x:xmpmeta>`))]);
      const r = L.lkCleanImage(dirty);
      assert.equal(r.type, 'image/webp'); assert.equal(r.w, 64); assert.equal(r.h, 48);
      const s = r.buf.toString('latin1'); assert.ok(!/GPS|xmpmeta|OwnerCam|EXIF|ICCP|XMP /.test(s));
      assert.equal(r.buf[20] & (0x20 | 0x08 | 0x04 | 0x02), 0, 'VP8X flags cleared');
      assert.equal(r.buf.readUInt32LE(4), r.buf.length - 8, 'RIFF size right');
      assert.ok(r.buf.includes(pic.subarray(0, Math.min(pic.length, 40))), 'the picture itself is kept');
      assert.equal(L.lkCleanImage(w).w, 64, 'a plain WebP is fine');
    }
    const anim = webpOf([riff('VP8X', Buffer.alloc(10)), riff('ANIM', Buffer.alloc(6)), riff('ANMF', Buffer.alloc(20))]);
    assert.throws(() => L.lkCleanImage(anim), /Moving/);
  });
  await t('looks: the art and the theme list over HTTP, photos refused before setup, odd names refused', async () => {
    const H = globalThis.__casatorch, srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
    const B = `http://127.0.0.1:${srv.address().port}`;
    try {
      const a = await fetch(`${B}/api/looks/art.svg?k=weather&c=rain&t=night&m=dark`);
      assert.equal(a.status, 200); assert.match(a.headers.get('content-type'), /^image\/svg\+xml/); assert.match(a.headers.get('content-security-policy'), /default-src 'none'/); assert.equal(a.headers.get('x-content-type-options'), 'nosniff');
      assert.equal((await fetch(`${B}/api/looks/art.svg?k=../../x`)).status, 404);
      const c = await (await fetch(`${B}/api/looks`)).json(); assert.ok(c.themes.length >= 8); assert.ok(c.teamColors.every((x) => x.colors.length === 2));
      const up = await fetch(`${B}/api/looks/photo`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpg });
      assert.ok([403, 409].includes(up.status), `refused before setup (${up.status})`);
      for (const id of ['..%2F..%2Fconfig.json', 'x.svg', 'aaaaaaaaaaaaaaaaaaaaaaaa.html']) assert.equal((await fetch(`${B}/api/looks/photo/${id}`)).status, 404);
    } finally { srv.close(); }
  });
}
