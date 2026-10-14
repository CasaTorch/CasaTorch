/* ======================================================================
 * Photos for the Photo reel tile: uploaded from any screen, kept on the
 * box in data/photos/. Images only (checked by their first bytes, not
 * the name), up to 30 MB each.
 * ====================================================================== */
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
const PHOTO_TYPES = [['jpg', 'image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff], ['png', 'image/png', (b) => b.subarray(0, 4).toString('hex') === '89504e47'],
  ['gif', 'image/gif', (b) => b.subarray(0, 4).toString() === 'GIF8'], ['webp', 'image/webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  ['heic', 'image/heic', (b) => b.subarray(4, 8).toString() === 'ftyp' && /hei|mif|avi/.test(b.subarray(8, 12).toString())]];
const photoList = () => fs.readdirSync(PHOTO_DIR).filter((f) => /^[a-f0-9]{16}\.(jpg|png|gif|webp|heic)$/.test(f))
  .map((f) => ({ id: f, at: fs.statSync(path.join(PHOTO_DIR, f)).mtime.toISOString(), url: `/api/photos/${f}` })).sort((a, b) => b.at.localeCompare(a.at));
app.get('/api/photos', (_req, res) => res.json({ photos: isDemo() && !photoList().length ? demoPhotos() : photoList() }));
app.post('/api/photos', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => {
  const b = req.body;
  if (!Buffer.isBuffer(b) || b.length < 16) return res.status(400).json({ error: 'no file received' });
  const t = PHOTO_TYPES.find(([, , ok]) => ok(b));
  if (!t) return res.status(415).json({ error: 'that is not a photo CasaTorch can show (JPEG, PNG, WebP, GIF or HEIC)' });
  if (photoList().length >= 2000) return res.status(409).json({ error: 'the photo reel is full (2000 photos) - remove some first' });
  const id = `${crypto.randomBytes(8).toString('hex')}.${t[0]}`;
  fs.writeFileSync(path.join(PHOTO_DIR, id), b, { mode: 0o600 });
  res.json({ ok: true, photo: { id, url: `/api/photos/${id}` } });
});
app.get('/api/photos/:id', (req, res) => {
  if (req.params.id.startsWith('demo-')) return res.type('image/svg+xml').send(demoPhotoSvg(req.params.id));
  if (!/^[a-f0-9]{16}\.(jpg|png|gif|webp|heic)$/.test(req.params.id)) return res.status(404).end();
  const f = path.join(PHOTO_DIR, req.params.id); if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Content-Type', PHOTO_TYPES.find(([ext]) => req.params.id.endsWith(`.${ext}`))[1]); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(f).pipe(res);
});
app.delete('/api/photos/:id', (req, res) => {
  if (!/^[a-f0-9]{16}\.(jpg|png|gif|webp|heic)$/.test(req.params.id)) return res.status(404).json({ error: 'not found' });
  try { fs.unlinkSync(path.join(PHOTO_DIR, req.params.id)); } catch { /* gone already */ }
  res.json({ ok: true });
});
/* Demo: painted stand-ins (no real photos ship with CasaTorch). */
const DEMO_SCENES = [['#f97316', '#7c2d12', 'Beach sunset'], ['#22c55e', '#14532d', 'Hiking trip'], ['#60a5fa', '#1e3a8a', 'Lake day'], ['#e879f9', '#581c87', 'Birthday'], ['#facc15', '#713f12', 'Fall leaves']];
const demoPhotos = () => DEMO_SCENES.map((_, i) => ({ id: `demo-${i}`, at: nowIso(), url: `/api/photos/demo-${i}`, demo: true }));
function demoPhotoSvg(id) {
  const [a, b, label] = DEMO_SCENES[Number(id.split('-')[1]) % DEMO_SCENES.length] || DEMO_SCENES[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="880" cy="250" r="110" fill="#fff" opacity=".35"/><path d="M0 620 L260 420 L470 560 L700 360 L1200 640 V800 H0Z" fill="#000" opacity=".28"/><text x="60" y="740" font-family="sans-serif" font-size="44" fill="#fff" opacity=".85">${label} (demo photo)</text></svg>`;
}
