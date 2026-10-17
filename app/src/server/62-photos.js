/* ======================================================================
 * Photos for the Photo reel tile: uploaded from any screen, kept on the
 * box in data/photos/. Images only (checked by their first bytes, not
 * the name), up to 30 MB each.
 * ====================================================================== */
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true, mode: 0o700 });
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
  if (isDemo() && photoList().length >= 50) return res.status(409).json({ error: 'the demo keeps up to 50 photos - remove some first' });   // the demo has no sign-in: anyone could fill the disk
  if (photoList().length >= 2000) return res.status(409).json({ error: 'the photo reel is full (2000 photos) - remove some first' });
  const id = `${crypto.randomBytes(8).toString('hex')}.${t[0]}`;
  writeFileSafe(path.join(PHOTO_DIR, id), b, 0o600);
  res.json({ ok: true, photo: { id, url: `/api/photos/${id}` } });
});
app.get('/api/photos/:id', (req, res) => {
  if (req.params.id.startsWith('demo-')) { const c = demoCredits()[Number(req.params.id.slice(5))]; return c && /^scenic-\d+\.jpg$/.test(c.file) ? res.set('Cache-Control', 'public, max-age=86400').sendFile(path.join(DEMO_PHOTO_DIR, c.file)) : res.status(404).end(); }
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
/* Demo: scenic sample photos (no people), free-licensed from Wikimedia Commons - each one's
   author and license travel with it (demo/photos/credits.json) and show on the tile. */
const DEMO_PHOTO_DIR = path.join(APP_DIR, '..', 'demo', 'photos');
const demoCredits = () => { try { return JSON.parse(fs.readFileSync(path.join(DEMO_PHOTO_DIR, 'credits.json'), 'utf8')); } catch { return []; } };
const demoPhotos = () => demoCredits().map((c, i) => ({ id: `demo-${i}`, at: nowIso(), url: `/api/photos/demo-${i}`, demo: true, caption: c.caption,
  credit: `${c.author.replace(/\s+/g, ' ').slice(0, 60)}, ${c.license}`, source: c.source }));
