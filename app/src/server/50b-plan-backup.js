/* ======================================================================
 * 3D Home plan safety: download the whole plan, bring one back, and
 * automatic restore points.
 *
 *   GET  /api/floorplan/export[?template=1]   a .zip: floorplan.json, manifest.json and files/ (every
 *                                             scan .glb and floor-plan picture the plan uses)
 *   POST /api/floorplan/import                the .zip as the body: checked and described, nothing changed yet
 *   POST /api/floorplan/import/apply          { token, template } puts it in place (a restore point first)
 *   GET  /api/floorplan/restore-points        the list, newest first
 *   POST /api/floorplan/restore-points/:id    put one back (what is there now is kept as a restore point first)
 *
 * "Template" leaves out every link to a device (pins, network pins, a car's sensors, a door's contact...):
 * the rooms, walls, scans, yard and colors only - to share a layout or start a second house from it.
 *
 * Restore points: a few seconds after every change to the plan, a copy of floorplan.json is kept in
 * data/.floorplan-restore/ - the newest 20, plus the last one of each day for two weeks. The scans and
 * pictures it uses are kept beside it as hard links (no extra space while the file is unchanged; a
 * replaced scan stays restorable). The demo keeps its restore points in memory only.
 *
 * The .zip is written and read here (stored or deflated entries, no zip64) - no extra library.
 * ====================================================================== */
const PZ_CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function pzCrc(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = PZ_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
const PZ_LIMITS = { entries: 400, total: 700 * 1024 * 1024, json: 8 * 1024 * 1024 };
/** A .zip from [{ name, data: Buffer }]. Each entry is deflated unless that doesn't make it smaller. */
function pzWrite(entries, when = new Date()) {
  const locals = [], central = []; let off = 0;
  const dosT = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff, dosD = (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data), crc = pzCrc(raw);
    const z = zlib.deflateRawSync(raw, { level: raw.length > 20e6 ? 3 : 6 }), stored = z.length >= raw.length, body = stored ? raw : z, method = stored ? 0 : 8;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8); h.writeUInt16LE(dosT, 10); h.writeUInt16LE(dosD, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10); c.writeUInt16LE(dosT, 12); c.writeUInt16LE(dosD, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, name, body); central.push(c, name); off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** The entries of a .zip as Map(name -> Buffer). Throws a plain-words error on anything odd (zip bombs included). */
function pzRead(buf, limits = PZ_LIMITS) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('That file is not a .zip.');
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('That file is not a .zip (or it is damaged).');
  const n = buf.readUInt16LE(e + 10), cdOff = buf.readUInt32LE(e + 16), out = new Map(); let total = 0;
  if (n > limits.entries) throw new Error('That .zip has too many files in it.');
  let p = cdOff;
  for (let k = 0; k < n; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('That .zip is damaged.');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8'); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('That .zip is damaged.');
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.subarray(start, start + csize);
    if (raw.length !== csize) throw new Error('That .zip is cut short.');
    total += usize; if (total > limits.total) throw new Error('What is inside that .zip is too big.');
    let data;
    if (method === 0) data = raw;
    else if (method === 8) { try { data = zlib.inflateRawSync(raw, { maxOutputLength: Math.min(limits.total, usize + 1) }); } catch { throw new Error('A file in that .zip is damaged.'); } }
    else throw new Error('That .zip uses a kind of compression CasaTorch does not read - zip it again with your computer\'s own "Compress".');
    if (data.length !== usize || pzCrc(data) !== crc) throw new Error('A file in that .zip is damaged.');
    out.set(name, data);
  }
  return out;
}
/* Every file the plan uses, by name: scanned floors (.glb), floor-plan pictures and the photo-real scans on a floor (full and light copy). */
const PZ_FILE = /^[\w-]{1,80}\.(glb|png|jpg|webp)$/;
const pzFilesOf = (d) => [...new Set((d?.floors || []).flatMap((f) => [f.file, f.plan?.bg, ...(Array.isArray(f.scans) ? f.scans.flatMap((s) => [s?.file, s?.low]) : [])]).filter((x) => typeof x === 'string' && PZ_FILE.test(x)))];
const pzFilePath = (name) => { const own = path.join(FP_DIR, name); return fs.existsSync(own) ? own : isDemo() && fs.existsSync(path.join(DEMO_FP, name)) ? path.join(DEMO_FP, name) : null; };
/* Links to devices and household things, wherever they sit in the plan (pins, a car's sensors, a door's contact, a blind,
   a bin's schedule, a plant, the washer, the mailbox, the camera a view wedge turns red for...). */
const PZ_LINK_KEYS = new Set(['deviceId', 'coverId', 'binId', 'plantId', 'laundryId', 'mail', 'motionId', 'uplinkDeviceId', 'bind', 'entity', 'entityId', 'sensor', 'sensors', 'monitorId']);
function pzTemplate(d) {
  const walk = (v) => { if (Array.isArray(v)) return v.map(walk); if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !PZ_LINK_KEYS.has(k)).map(([k, x]) => [k, walk(x)])); return v; };
  const out = walk({ ...d, pins: [], netPins: [] });
  delete out.view?.hidden;
  /* The live view's settings are keyed by device (no rain warning, camera wedges, fixed lamp colors, status chips): gone too. */
  if (out.live3d && typeof out.live3d === 'object') { for (const k of ['noRain', 'wedges', 'fixed', 'chips']) delete out.live3d[k]; }
  return out;
}
/* Only plain JSON comes in: no special keys, bounded depth, sizes and strings. */
function pzClean(v, depth = 0) {
  if (depth > 14) return null;
  if (Array.isArray(v)) return v.slice(0, 5000).map((x) => pzClean(x, depth + 1));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k.length > 80) continue; o[k] = pzClean(x, depth + 1); } return o; }
  if (typeof v === 'string') return v.slice(0, 2000);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  return typeof v === 'boolean' || v === null ? v : null;
}
const pzMagic = (name, b) => (/\.glb$/.test(name) ? b.subarray(0, 4).toString() === 'glTF' : /\.png$/.test(name) ? b.subarray(0, 4).toString('hex') === '89504e47' : /\.jpg$/.test(name) ? b[0] === 0xff && b[1] === 0xd8 : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');
/** Check a plan .zip and say what is in it. Returns { plan, files: Map, summary }. */
function pzParse(buf) {
  const z = pzRead(buf), j = z.get('floorplan.json');
  if (!j) throw new Error('That .zip is not a CasaTorch plan (no floorplan.json in it).');
  if (j.length > PZ_LIMITS.json) throw new Error('The plan in that .zip is too big.');
  let plan; try { plan = pzClean(JSON.parse(j.toString('utf8'))); } catch { throw new Error('The plan in that .zip is damaged.'); }
  if (!plan || !Array.isArray(plan.floors)) throw new Error('That .zip is not a CasaTorch plan.');
  const files = new Map(), warnings = [];
  for (const [name, data] of z) { const m = /^files\/([^/]+)$/.exec(name); if (m && PZ_FILE.test(m[1]) && pzMagic(m[1], data)) files.set(m[1], data); }
  plan.floors = plan.floors.filter((f) => f && typeof f === 'object' && /^[\w-]{1,40}$/.test(String(f.id || ''))).slice(0, FP_MAX).filter((f) => {
    f.name = String(f.name || 'Floor').slice(0, 40);
    if (f.kind === 'drawn') { f.plan = f.plan && typeof f.plan === 'object' ? f.plan : { rooms: [], walls: [] }; if (f.plan.bg && !files.has(f.plan.bg)) { warnings.push(`${f.name}: its picture is missing`); f.plan.bg = null; } return true; }
    if (!PZ_FILE.test(String(f.file || '')) || !/\.glb$/.test(f.file) || !files.has(f.file)) { warnings.push(`${f.name}: its scan is missing - left out`); return false; }
    return true;
  });
  /* Photo-real scans on a floor: only the ones whose file came along (and named the way scan files are); a missing light copy is just dropped. */
  for (const f of plan.floors) {
    if (!Array.isArray(f.scans)) { delete f.scans; continue; }
    const had = f.scans.length;
    f.scans = f.scans.filter((s) => s && typeof s === 'object' && SC_FILE.test(String(s.file || '')) && files.has(s.file)).slice(0, 12);
    for (const s of f.scans) if (s.low && !(SC_FILE.test(String(s.low)) && files.has(s.low))) delete s.low;
    if (f.scans.length < had) warnings.push(`${f.name}: ${had - f.scans.length} photo-real scan(s) missing - left out`);
    if (!f.scans.length) delete f.scans;
  }
  const ids = new Set(plan.floors.map((f) => f.id));
  plan.pins = (Array.isArray(plan.pins) ? plan.pins : []).filter((p) => p && ids.has(p.floor) && Array.isArray(p.pos) && p.pos.length === 3).slice(0, 500);
  plan.netPins = (Array.isArray(plan.netPins) ? plan.netPins : []).filter((p) => p && ids.has(p.floor) && Array.isArray(p.pos) && p.pos.length === 3).slice(0, 200);
  delete plan.pro;
  for (const n of [...files.keys()]) if (!pzFilesOf(plan).includes(n)) files.delete(n);   // only what the plan uses
  const rooms = plan.floors.reduce((s, f) => s + (Array.isArray(f.rooms) ? f.rooms.length : Array.isArray(f.plan?.rooms) ? f.plan.rooms.length : 0), 0);
  const bytes = [...files.values()].reduce((s, b) => s + b.length, 0);
  let man = {}; try { man = JSON.parse(z.get('manifest.json')?.toString('utf8') || '{}'); } catch { /* optional */ }
  return { plan, files, summary: { floors: plan.floors.map((f) => ({ name: f.name, kind: f.kind === 'drawn' ? 'drawn' : 'scan' })), rooms, pins: plan.pins.length + plan.netPins.length, files: files.size, mb: Math.round(bytes / 1e5) / 10, template: !!man.template, exportedAt: typeof man.exportedAt === 'string' ? man.exportedAt.slice(0, 30) : null, warnings: warnings.slice(0, 20) } };
}
function pzExport(d, template = false) {
  const plan = template ? pzTemplate(d) : { ...d }; delete plan.pro;
  const entries = [{ name: 'manifest.json', data: JSON.stringify({ format: 'casatorch-plan', version: 1, exportedAt: new Date().toISOString(), template: !!template, app: 'CasaTorch' }, null, 2) },
    { name: 'floorplan.json', data: JSON.stringify(plan, null, 2) }];
  for (const name of pzFilesOf(plan)) { const p = pzFilePath(name); if (p) entries.push({ name: `files/${name}`, data: fs.readFileSync(p) }); }
  return pzWrite(entries);
}

/* ---- restore points ---- */
const RP_DIR = path.join(DATA_DIR, '.floorplan-restore'),   // beside the data, not in floorplan/ (so a backup with media doesn't carry every scan twice)
  RP_FILES = path.join(RP_DIR, 'files'), RP_ID = /^\d{8}T\d{6}Z-[a-z0-9-]{1,40}$/;
const RP_KEEP = 20, RP_DAYS = 14;
/** Which restore points to delete: the newest 20 stay, plus the last one of each day for two weeks. */
const rpPrune = (ids, now = Date.now()) => settingsPrune(ids, now, RP_KEEP, RP_DAYS);
const rpMem = [];   // the demo: { id, json } newest first, in memory only
const rpList = () => (isDemo() ? rpMem.map((x) => x.id) : (() => { try { return fs.readdirSync(RP_DIR).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter((id) => RP_ID.test(id)).sort().reverse(); } catch { return []; } })());
const rpRead = (id) => { if (!RP_ID.test(String(id))) return null; if (isDemo()) return rpMem.find((x) => x.id === id)?.json || null; try { return fs.readFileSync(path.join(RP_DIR, `${id}.json`), 'utf8'); } catch { return null; } };
const rpSig = (s) => crypto.createHash('sha256').update(s).digest('hex');
let rpLastSig = null;
/** Keep the plan as it is now (unless it is the same as the newest restore point). Returns the id, or null. */
function rpSnapshot(reason = 'auto', { force = false, now = new Date() } = {}) {
  try {
    const d = fpData(); if (!d?.floors?.length && !d?.pins?.length) return null;   // nothing to keep yet
    const copy = { ...d }; delete copy.pro;
    const json = JSON.stringify(copy), sig = rpSig(json);
    if (!force && sig === (rpLastSig ??= (() => { const l = rpList()[0]; const t = l && rpRead(l); return t ? rpSig(t) : ''; })())) return null;
    let id = `${shStamp(now)}-${String(reason).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 30)}`;
    for (let k = 2; rpList().includes(id); k++) id = `${id.replace(/-\d+$/, '')}-${k}`;
    if (isDemo()) { rpMem.unshift({ id, json }); rpMem.sort((a, b) => (a.id < b.id ? 1 : -1)); }
    else {
      fs.mkdirSync(RP_FILES, { recursive: true, mode: 0o700 });
      for (const name of pzFilesOf(copy)) {   // the scans and pictures it uses, as they are now
        const src = path.join(FP_DIR, name), dst = path.join(RP_FILES, name); if (!fs.existsSync(src)) continue;
        try { const a = fs.statSync(src), b = fs.existsSync(dst) ? fs.statSync(dst) : null; if (b && a.ino === b.ino && a.dev === b.dev) continue; if (b) fs.rmSync(dst, { force: true }); fs.linkSync(src, dst); }
        catch { try { if (!fs.existsSync(dst)) fs.copyFileSync(src, dst); } catch { /* keep the plan anyway */ } }
      }
      writeFileSafe(path.join(RP_DIR, `${id}.json`), json, 0o600);
    }
    rpLastSig = sig;
    for (const old of rpPrune(rpList(), now.getTime())) rpDrop(old);
    rpGc();
    return id;
  } catch (e) { console.warn('3D Home restore point:', String(e.message || e).slice(0, 200)); return null; }
}
function rpDrop(id) { if (isDemo()) { const i = rpMem.findIndex((x) => x.id === id); if (i >= 0) rpMem.splice(i, 1); } else fs.rmSync(path.join(RP_DIR, `${id}.json`), { force: true }); }
function rpGc() {   // kept scans and pictures no restore point uses any more
  if (isDemo()) return;
  const used = new Set(); for (const id of rpList()) { try { for (const n of pzFilesOf(JSON.parse(rpRead(id) || '{}'))) used.add(n); } catch { /* skip */ } }
  try { for (const n of fs.readdirSync(RP_FILES)) if (!used.has(n)) fs.rmSync(path.join(RP_FILES, n), { force: true }); } catch { /* none */ }
}
const rpInfo = (id) => { try { const d = JSON.parse(rpRead(id)); const rooms = (d.floors || []).reduce((s, f) => s + (f.rooms?.length || f.plan?.rooms?.length || 0), 0);
  return { id, at: new Date(shTime(id)).toISOString(), reason: id.replace(/^\d{8}T\d{6}Z-/, '').replace(/-\d+$/, ''), floors: (d.floors || []).length, rooms, pins: (d.pins || []).length + (d.netPins || []).length }; } catch { return null; } };
/** Put a plan in place: its files first (from the restore point's own copies), then the plan. */
function rpPut(plan, files) {
  for (const [name, buf] of files || []) writeFileSafe(path.join(FP_DIR, name), buf, 0o600);
  if (!isDemo()) for (const name of pzFilesOf(plan)) { const own = path.join(FP_DIR, name), kept = path.join(RP_FILES, name); if (!fs.existsSync(own) && fs.existsSync(kept)) { try { fs.linkSync(kept, own); } catch { fs.copyFileSync(kept, own); } } }
  fpWrite(plan); rpLastSig = null;
}
/* A damaged plan at start: the start-up check (00b-heal.js) kept the damaged floorplan.json aside and removed it, so the
   plan would start empty. Put back the newest restore point that reads instead, and say so in Health. Runs only when
   the plan file is missing AND a damaged copy of it sits beside it - never over a plan that is there. */
function rpHealPlan() {
  try {
    if (isDemo() || fs.existsSync(FP_FILE)) return null;
    const damaged = (() => { try { return fs.readdirSync(FP_DIR).filter((n) => n.startsWith('floorplan.json.damaged-')); } catch { return []; } })();
    if (!damaged.length) return null;
    const newest = Math.max(...damaged.map((n) => { try { return fs.statSync(path.join(FP_DIR, n)).mtimeMs; } catch { return 0; } }));
    for (const id of rpList()) {
      let plan; try { plan = JSON.parse(rpRead(id) || ''); } catch { continue; }
      if (!plan || typeof plan !== 'object' || !Array.isArray(plan.floors)) continue;
      if (shTime(id) > newest + 60_000) continue;   // made after the damage was found: not the plan that was lost
      rpPut(plan, null);
      const when = new Date(shTime(id)).toISOString().slice(0, 16).replace('T', ' ');
      /* the start-up note said the plan "starts again empty": that is no longer true */
      for (let i = HEAL.length - 1; i >= 0; i--) if (HEAL[i].what === 'data-damaged' && /^Your 3D Home plan couldn't be read/.test(HEAL[i].detail)) HEAL.splice(i, 1);
      healNote('plan-restored', `Your 3D Home plan was damaged (often by a power cut), so CasaTorch put back its newest restore point, from ${when} UTC. Changes after that may be missing; the damaged file was kept (named ...damaged-...). Other restore points are in 3D Home › Edit › Backups.`);
      console.warn(`Self-check: the 3D Home plan was damaged; restore point ${id} was put back.`);
      return id;
    }
  } catch (e) { console.warn('3D Home plan repair:', String(e.message || e).slice(0, 200)); }
  return null;
}
if (process.env.CASATORCH_TEST !== '1') rpHealPlan();
/* A few seconds after the plan changes (and stays put), it is kept. Checking costs one stat of the file (in the
   demo, one look at the plan in memory) every 4 seconds. */
let rpSeen = null, rpPending = false;
const rpNow = () => { if (isDemo()) { try { return rpSig(JSON.stringify(fpData())); } catch { return null; } } try { const s = fs.statSync(FP_FILE); return `${s.mtimeMs}:${s.size}`; } catch { return null; } };
if (process.env.CASATORCH_TEST !== '1') {
  setTimeout(() => { rpSeen = rpNow(); if (isConfigured() || isDemo()) rpSnapshot('start'); }, 6000).unref?.();
  setInterval(() => {
    const s = rpNow(); if (s == null) return;
    if (s !== rpSeen) { rpSeen = s; rpPending = true; return; }   // still changing: wait for it to settle
    if (rpPending) { rpPending = false; rpSnapshot('auto'); }
  }, 4000).unref?.();
}

app.get('/api/floorplan/export', requireRole('admin'), (req, res) => {
  try {
    const t = req.query.template === '1', zip = pzExport(fpData(), t), day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="casatorch-3d-home-${t ? 'template-' : ''}${day}.zip"`); res.setHeader('Cache-Control', 'no-store');
    res.end(zip);
  } catch (e) { res.status(500).json({ error: `The plan could not be packed: ${String(e.message || e).slice(0, 120)}` }); }
});
const pzPending = new Map();   // token -> { at, plan, files, summary } for 10 minutes, one at a time
app.post('/api/floorplan/import', requirePro, requireRole('admin'), express.raw({ type: '*/*', limit: '600mb' }), (req, res) => {
  try {
    const r = pzParse(req.body); if (!r.plan.floors.length) return res.status(400).json({ error: 'There are no floors in that plan.', summary: r.summary });
    pzPending.clear(); const token = crypto.randomBytes(12).toString('hex'); pzPending.set(token, { at: Date.now(), ...r });
    setTimeout(() => pzPending.delete(token), 10 * 60_000).unref?.();
    res.json({ ok: true, token, summary: r.summary });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
app.post('/api/floorplan/import/apply', requirePro, requireRole('admin'), express.json({ limit: '2kb' }), (req, res) => {
  const p = pzPending.get(String(req.body?.token || '')); if (!p) return res.status(410).json({ error: 'Choose the file again - the preview expired.' });
  pzPending.clear();
  rpSnapshot('before-import', { force: true });
  const plan = req.body?.template ? pzTemplate(p.plan) : p.plan;
  try { rpPut(plan, p.files); } catch (e) { return res.status(500).json({ error: `The plan could not be saved: ${String(e.message || e).slice(0, 120)}` }); }
  rpSnapshot('imported');
  res.json({ ok: true, floors: plan.floors.length });
});
app.get('/api/floorplan/restore-points', requireRole('admin'), (_req, res) => res.json({ keep: RP_KEEP, days: RP_DAYS, points: rpList().map(rpInfo).filter(Boolean), demo: isDemo() }));
app.post('/api/floorplan/restore-points/:id', requirePro, requireRole('admin'), (req, res) => {
  const t = rpRead(req.params.id); if (!t) return res.status(404).json({ error: 'That restore point is no longer there.' });
  let plan; try { plan = JSON.parse(t); } catch { return res.status(422).json({ error: 'That restore point is damaged - pick another one.' }); }
  rpSnapshot('before-restore', { force: true });
  try { rpPut(plan, null); } catch (e) { return res.status(500).json({ error: String(e.message || e).slice(0, 160) }); }
  res.json({ ok: true });
});
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchPlan = { pzWrite, pzRead, pzParse, pzExport, pzTemplate, pzClean, pzCrc, rpPrune, rpSnapshot, rpList, rpRead, rpPut, rpInfo, rpHealPlan, RP_DIR, FP_DIR, FP_FILE };
