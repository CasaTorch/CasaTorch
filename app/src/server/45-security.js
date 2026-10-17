/* ======================================================================
 * Security Center: everything about keeping the home safe, in one place.
 *
 *  - Devices on your network: every device on the home network, and an alert
 *    when a new one joins. CasaTorch reads this computer's neighbor table
 *    (the list of devices it can see on the network), after a gentle nudge to
 *    every address in its own network so quiet devices show up too. The first
 *    look is taken as "these are yours"; anything after that is new until
 *    someone says it's theirs.
 *  - Open-port check: once a day (and when asked), each device is checked for
 *    a short list of risky services - Telnet, FTP, file sharing, Remote
 *    Desktop, VNC, unprotected camera streams - and told how to close them.
 *    Home network only, never anything on the internet.
 *  - The video wall's layout, the security checklist and recent events.
 *
 * Kept in DATA_DIR/security.json (devices with their hardware address, names,
 * ports found, what's marked as expected, the wall layout). Nothing leaves the box.
 * ====================================================================== */
import dgram from 'node:dgram';
import dnsP from 'node:dns/promises';
const SEC_FILE = path.join(DATA_DIR, 'security.json');
const sec = { devices: {}, baseline: false, scanAt: null, portsAt: null, expected: {}, wall: null, available: null, scanning: false };
try { Object.assign(sec, JSON.parse(fs.readFileSync(SEC_FILE, 'utf8')), { scanning: false }); } catch { /* first run */ }
const saveSec = () => { if (!isDemo()) try { const { scanning, ...keep } = sec; writeFileSafe(SEC_FILE, JSON.stringify(keep), 0o600); } catch { /* next time */ } };
const PRIVATE4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const macOk = (m) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m) && m !== 'ff:ff:ff:ff:ff:ff' && m !== '00:00:00:00:00:00' && !m.startsWith('01:00:5e');   // scrub-ok: broadcast/empty addresses, not a device
const normMac = (m) => String(m || '').toLowerCase().replace(/-/g, ':').split(':').map((x) => x.padStart(2, '0')).join(':');
/* A phone or tablet's "private Wi-Fi address" has the locally-administered bit set. */
const privateMac = (m) => /^.[26ae]/.test(m);

/* This computer's neighbor table: [{ ip, mac }] for devices on the home network. */
function parseNeighbors(text, platform) {
  const out = [];
  for (const line of String(text).split('\n')) {
    let m;
    if (platform === 'linux') { m = line.trim().split(/\s+/); if (m.length >= 4 && m[2] === '0x2') out.push({ ip: m[0], mac: normMac(m[3]) }); continue; }
    if (platform === 'win32') { m = line.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+dynamic/i); if (m) out.push({ ip: m[1], mac: normMac(m[2]) }); continue; }
    m = line.match(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]+) on/i); if (m) out.push({ ip: m[1], mac: normMac(m[2]) });   // macOS / BSD "arp -an"
  }
  return out.filter((n) => PRIVATE4.test(n.ip) && macOk(n.mac));
}
const run = (cmd, args) => new Promise((ok) => execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (e, out) => ok(e ? '' : out)));
async function neighbors() {
  if (process.platform === 'linux') { try { return parseNeighbors(fs.readFileSync('/proc/net/arp', 'utf8'), 'linux'); } catch { return []; } }
  return parseNeighbors(await run('arp', process.platform === 'win32' ? ['-a'] : ['-an']), process.platform);
}
/* A tiny packet to every address in our /24 makes the computer look each one up, so quiet devices appear. */
async function wakeNeighbors(me) {
  const base = me.split('.').slice(0, 3).join('.'), s = dgram.createSocket('udp4');
  await new Promise((ok) => s.bind(0, ok));
  for (let i = 1; i < 255; i++) { const ip = `${base}.${i}`; if (ip !== me) s.send(Buffer.from([0]), 9, ip, () => {}); if (i % 32 === 0) await new Promise((ok) => setTimeout(ok, 50)); }
  await new Promise((ok) => setTimeout(ok, 2500)); s.close();
}
const nameOf = async (ip) => { try { const n = await Promise.race([dnsP.reverse(ip), new Promise((_, bad) => setTimeout(() => bad(new Error('slow')), 1500))]); return String(n?.[0] || '').replace(/\.(local|lan|home|home\.arpa|localdomain)$/i, '') || null; } catch { return null; } };

async function lanScan() {
  const me = lanAddress();
  if (!me) { sec.available = false; return; }
  if (sec.scanning) return; sec.scanning = true;
  try {
    await wakeNeighbors(me).catch(() => {});
    const list = await neighbors(), now = nowIso();
    sec.available = list.length > 0 || sec.available === true;
    for (const { ip, mac } of list) {
      const d = sec.devices[mac];
      if (d) { d.ip = ip; d.lastSeen = now; if (!d.host) d.host = await nameOf(ip); }
      else sec.devices[mac] = { mac, ip, host: await nameOf(ip), firstSeen: now, lastSeen: now, known: !sec.baseline, privateMac: privateMac(mac) };
    }
    sec.baseline = true; sec.scanAt = now;
    // keep it tidy: forget devices not seen for 90 days
    for (const [mac, d] of Object.entries(sec.devices)) if (Date.now() - Date.parse(d.lastSeen) > 90 * 86400_000) delete sec.devices[mac];
    saveSec();
  } finally { sec.scanning = false; }
}

/* ---- the open-port check ---- */
const RISKY_PORTS = [
  [23, 'Telnet', 'warning', 'An old, unencrypted way to log in remotely. Turn it off in the device\'s settings - nothing modern needs it. Often found on cheap cameras and old routers.'],
  [2323, 'Telnet (second port)', 'warning', 'The same old remote login on another port - often a sign of an unpatched camera or gadget. Update its firmware, or keep it off the network.'],
  [21, 'FTP file transfer', 'warning', 'Sends files and passwords unencrypted. Turn it off, or switch to SFTP if the device offers it.'],
  [3389, 'Remote Desktop', 'warning', 'Lets someone take over this computer\'s screen. Fine if you use it on purpose; make sure it has a strong password and is never opened to the internet on your router.'],
  [5900, 'VNC screen sharing', 'warning', 'Screen sharing, often with a weak password or none. Turn it off if you don\'t use it; otherwise set a strong password.'],
  [445, 'Windows file sharing (SMB)', 'notice', 'Normal on a NAS or a computer that shares folders. Make sure guest access is off and every share needs a password.'],
  [554, 'Camera video stream (RTSP)', 'notice', 'Normal for many cameras. Make sure the camera\'s video needs a password - some ship with it open to anyone on the network.'],
  [1883, 'MQTT without encryption', 'notice', 'A messaging service many smart-home gadgets use. Fine at home; make sure it needs a username and password.'],
];
const probe = (ip, port, ms = 800) => new Promise((ok) => { const s = net.connect({ host: ip, port }); const done = (v) => { s.destroy(); ok(v); }; s.setTimeout(ms, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false)); });
async function portCheck() {
  if (sec.portsRunning) return; sec.portsRunning = true;
  try {
    const recent = Object.values(sec.devices).filter((d) => PRIVATE4.test(d.ip) && Date.now() - Date.parse(d.lastSeen) < 86400_000);
    const jobs = recent.flatMap((d) => RISKY_PORTS.map(([port]) => ({ d, port })));
    const found = {};
    for (let i = 0; i < jobs.length; i += 24) await Promise.all(jobs.slice(i, i + 24).map(async ({ d, port }) => { if (await probe(d.ip, port)) (found[d.mac] ||= []).push(port); }));
    for (const d of recent) d.ports = (found[d.mac] || []).sort((a, b) => a - b);
    sec.portsAt = nowIso(); saveSec();
  } finally { sec.portsRunning = false; }
}
const portInfo = (port) => { const r = RISKY_PORTS.find(([p]) => p === port); return r ? { port, name: r[1], level: r[2], how: r[3] } : { port, name: `Port ${port}`, level: 'notice', how: '' }; };
const devLabel = (d) => d.name || d.host || d.ip;

/* For the alerts list (40-alerts.js): new devices to look at, and risky ports nobody has marked as expected. */
function securityAlerts() {
  if (isDemo() || config.security?.watch === false) return [];
  const out = [];
  for (const d of Object.values(sec.devices)) {
    if (!d.known) out.push({ id: `newdev:${d.mac}`, severity: 'notice', title: `New device on your network: ${devLabel(d)}`, source: 'network' });
    for (const p of d.ports || []) if (!sec.expected[`${d.mac}:${p}`]) { const i = portInfo(p); out.push({ id: `port:${d.mac}:${p}`, severity: i.level, title: `${devLabel(d)} has ${i.name} open`, source: 'network' }); }
  }
  return out.slice(0, 20);
}

/* ---- the checklist: what's done, and what's worth doing next ---- */
function securityChecklist() {
  const items = [], add = (id, ok, title, how, href) => items.push({ id, ok: !!ok, title, how, href });
  const admins = (typeof users !== 'undefined' && users?.list ? users.list : []).filter((u) => ['owner', 'admin'].includes(u.role) && u.password);
  add('signin', isDemo() || signInOn(), 'Everyone signs in', 'Settings › Security: CasaTorch asks for a password on every phone and computer.', '#settings');
  add('2fa', admins.length && admins.every((u) => u.totp?.on), 'Two-step sign-in for owners and admins', 'Settings › Your account & security › Two-step sign-in. Takes two minutes with any authenticator app.', '#settings');
  add('https', ltConf()?.on && LOCAL_TLS.url, 'Secure address at home (https)', 'Settings › Secure address at home: sign-ins and everything else are encrypted on your Wi-Fi.', '#settings');
  const up = typeof updateView === 'function' ? updateView() : null;
  add('updates', !up?.available, 'CasaTorch is up to date', up?.available ? `Version ${up.latest} is ready - Settings › Updates.` : 'Updates fix security problems; automatic updates keep you current.', '#settings');
  let backup = false; try { backup = fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').slice(-5000).some((l) => l.includes('"backup-made"') && Date.now() - Date.parse(JSON.parse(l).at) < 90 * 86400_000); } catch { /* none */ }
  add('backup', backup, 'A backup in the last 3 months', 'Settings › Backup: one file, protected by a passphrase you choose.', '#settings');
  const devs = isDemo() ? DEMO_LAN() : Object.values(sec.devices);
  const risky = devs.flatMap((d) => (d.ports || []).filter((p) => !sec.expected[`${d.mac}:${p}`] && portInfo(p).level === 'warning'));
  if ((sec.portsAt && sec.available) || isDemo()) add('ports', !risky.length, 'No risky services open on your network', risky.length ? `${risky.length} found - see "Devices on your network" below.` : 'Checked once a day.', '#security');
  const fresh = devs.filter((d) => !d.known).length;
  if ((sec.scanAt && sec.available) || isDemo()) add('newdevices', !fresh, 'Every device on your network is one you know', fresh ? `${fresh} new - say whether each is yours below.` : 'You\'ll get an alert when a new one joins.', '#security');
  const dnsGuard = typeof netSources === 'function' && netSources().some((s) => ['pihole', 'adguard'].includes(s.kind));
  add('dns', dnsGuard, 'Ads and known bad sites blocked for the whole home', 'Pi-hole or AdGuard Home blocks trackers and many malicious sites for every device. Connect yours on the Network tab (Pro).', '#network');
  return items;
}

/* Recent security events, newest first: alerts history plus sign-in trouble from the security log. */
function securityEvents() {
  const SEC_RE = /^(ring:|leak:|smoke:|offline:|newdev:|port:|cleared:(leak|smoke|newdev|port)|internet)/;
  const ev = (alerts.events || []).filter((e) => SEC_RE.test(String(e.id || '')) || /doorbell|motion|door|lock|alarm/i.test(e.title || '')).slice(0, 60)
    .map((e) => ({ at: e.at, title: e.title, severity: e.severity, source: e.source }));
  try {
    for (const l of fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').slice(-400)) {
      const a = JSON.parse(l); if (!['login-failed', 'login-limited', 'code-failed', 'google-unknown', 'recovery-code-used', 'role-changed', 'user-added'].includes(a.event)) continue;
      const what = { 'login-failed': 'Wrong password', 'login-limited': 'Too many sign-in tries - paused', 'code-failed': 'Wrong two-step code', 'google-unknown': 'Google sign-in from an unknown account', 'recovery-code-used': 'Recovery code used', 'role-changed': 'Someone\'s role changed', 'user-added': 'Person added' }[a.event];
      ev.push({ at: a.at, title: `${what}${a.user ? ` (${a.user})` : ''}`, severity: ['login-limited', 'google-unknown', 'recovery-code-used'].includes(a.event) ? 'warning' : 'notice', source: 'sign-in' });
    }
  } catch { /* no log yet */ }
  return ev.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50);
}

/* ---- demo: a believable sample network (no scanning in the demo) ---- */
const DEMO_LAN = () => {
  const t = (h) => new Date(Date.now() - h * 3600_000).toISOString();   // scrub-ok: sample addresses below
  return [
    { mac: '3c:22:fb:10:00:01', ip: '192.168.1.1', host: 'router', name: 'Router', known: true, firstSeen: t(2000), lastSeen: t(0) },   // scrub-ok
    { mac: '00:11:32:aa:00:02', ip: '192.168.1.20', host: 'nas', name: 'NAS', known: true, ports: [445], firstSeen: t(1800), lastSeen: t(0) },   // scrub-ok
    { mac: 'b8:27:eb:00:00:03', ip: '192.168.1.30', host: 'casatorch', name: 'CasaTorch', known: true, firstSeen: t(900), lastSeen: t(0) },   // scrub-ok
    { mac: '9c:8e:cd:00:00:04', ip: '192.168.1.41', host: null, name: 'Driveway camera', known: true, ports: [23, 554], firstSeen: t(1500), lastSeen: t(0) },   // scrub-ok
    { mac: 'f4:f5:d8:00:00:05', ip: '192.168.1.52', host: 'living-room-tv', name: null, known: true, firstSeen: t(1200), lastSeen: t(1) },   // scrub-ok
    { mac: 'da:a1:19:00:00:06', ip: '192.168.1.77', host: null, name: null, known: false, privateMac: true, firstSeen: t(0.6), lastSeen: t(0) },   // scrub-ok
  ];
};

/* ---- routes ---- */
app.get('/api/security', async (_req, res) => {
  const list = isDemo() ? DEMO_LAN() : Object.values(sec.devices);
  const devices = list.map((d) => ({ ...d, ports: (d.ports || []).map((p) => ({ ...portInfo(p), expected: !!sec.expected[`${d.mac}:${p}`] })) }))
    .sort((a, b) => Number(a.known) - Number(b.known) || (b.ports.filter((p) => !p.expected).length - a.ports.filter((p) => !p.expected).length) || String(a.ip).localeCompare(String(b.ip), undefined, { numeric: true }));
  res.json({ available: isDemo() ? true : sec.available, scanning: sec.scanning || !!sec.portsRunning, scanAt: isDemo() ? nowIso() : sec.scanAt, portsAt: isDemo() ? nowIso() : sec.portsAt,
    devices, wall: sec.wall, checklist: securityChecklist(), events: isDemo() ? DEMO_SEC_EVENTS() : securityEvents(), watch: config.security?.watch !== false });
});
const DEMO_SEC_EVENTS = () => { const t = (m) => new Date(Date.now() - m * 60_000).toISOString(); return [
  { at: t(14), title: 'Someone at the Front door', severity: 'notice', source: 'ring' }, { at: t(36), title: 'New device on your network: 192.168.1.77', severity: 'notice', source: 'network' },   // scrub-ok
  { at: t(95), title: 'Motion at the Driveway', severity: 'info', source: 'ring' }, { at: t(240), title: 'Wrong password (guest)', severity: 'notice', source: 'sign-in' },
  { at: t(1440), title: 'Cleared: Water detected: Laundry leak sensor', severity: 'ok', source: 'ha' }]; };
app.post('/api/security/devices/:mac', requireRole('member'), express.json({ limit: '4kb' }), (req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true });
  const mac = normMac(req.params.mac), d = Object.hasOwn(sec.devices, mac) ? sec.devices[mac] : null; if (!d) return res.status(404).json({ error: 'That device isn\'t on the list any more.' });
  if ('known' in (req.body || {})) d.known = !!req.body.known;
  if ('name' in (req.body || {})) d.name = String(req.body.name || '').trim().slice(0, 40) || null;
  saveSec(); res.json({ ok: true });
});
app.post('/api/security/expected', requireRole('member'), express.json({ limit: '4kb' }), (req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true });
  const mac = normMac(req.body?.mac), port = Number(req.body?.port); if (!Object.hasOwn(sec.devices, mac) || !RISKY_PORTS.some(([p]) => p === port)) return res.status(400).json({ error: 'unknown device or port' });
  if (req.body?.expected) sec.expected[`${mac}:${port}`] = true; else delete sec.expected[`${mac}:${port}`];
  saveSec(); res.json({ ok: true });
});
app.post('/api/security/scan', requireRole('admin'), (_req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true });
  res.json({ ok: true }); lanScan().then(() => sec.available && portCheck()).catch(() => {});
});
app.put('/api/security/settings', requireRole('admin'), express.json(), (req, res) => {
  if (isDemo()) return res.json({ ok: true, demo: true });
  saveConfig({ ...config, security: { ...(config.security || {}), watch: req.body?.watch !== false } }); res.json({ ok: true });
});
/* The video wall: which cameras, in what order, how many across. Shared by every screen in the home. */
app.put('/api/security/wall', requireRole('member'), express.json({ limit: '32kb' }), (req, res) => {
  const b = req.body || {}, ids = (a) => (Array.isArray(a) ? a.map(String).filter((x) => x.length <= 200).slice(0, 64) : []);
  sec.wall = { cols: [0, 1, 2, 3, 4].includes(Number(b.cols)) ? Number(b.cols) : 0, order: ids(b.order), hidden: ids(b.hidden), live: !!b.live };
  saveSec(); res.json({ ok: true, wall: sec.wall });
});
/* "Lock all": every lock that's unlocked gets the lock command (CasaTorch never unlocks). */
app.post('/api/security/lock-all', requireRole('member'), async (_req, res) => {
  const { devices } = await allDevices(), open = devices.filter((d) => d.kind === 'lock' && d.locked === false);
  if (isDemo()) return res.json({ ok: true, locked: open.length, demo: true });
  const done = [], failed = [];
  for (const d of open) { const prov = PROVIDERS[d.id.split(':')[0]]; try { await prov.act(d, 'lock'); done.push(d.name); } catch { failed.push(d.name); } }
  CACHE.clear?.();
  res.json({ ok: !failed.length, locked: done.length, failed });
});
if (process.env.CASATORCH_TEST !== '1') {
  setTimeout(() => { if (isConfigured() && !isDemo() && config.security?.watch !== false) lanScan().then(() => { if (sec.available && (!sec.portsAt || Date.now() - Date.parse(sec.portsAt) > 20 * 3600_000)) return portCheck(); }).catch(() => {}); }, 20_000).unref?.();
  setInterval(() => { if (isConfigured() && !isDemo() && config.security?.watch !== false) lanScan().catch(() => {}); }, 15 * 60_000).unref?.();
  setInterval(() => { if (isConfigured() && !isDemo() && config.security?.watch !== false) if (sec.available) portCheck().catch(() => {}); }, 24 * 3600_000).unref?.();
}
