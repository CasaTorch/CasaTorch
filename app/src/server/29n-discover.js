/* ======================================================================
 * "New devices found": every kind of gear CasaTorch can find on the home
 * network, all the time, not only during setup.
 *
 * What it looks for (each check is cheap, local, and gives up after a few seconds):
 *   Home Assistant, Hue bridges, Shelly, Frigate, UniFi, Pi-hole  the setup's own finders (05b-setup-net.js)
 *   go2rtc          its API on port 1984, next to Frigate or on the usual names
 *   ONVIF cameras   WS-Discovery (one multicast probe; cameras answer with their address)
 *   RTSP cameras    port 554 on the devices this computer already sees on the network (ARP), with an RTSP OPTIONS
 *   Sonos, Chromecast   mDNS (added through Home Assistant: CasaTorch doesn't control them directly)
 *   AdGuard Home    its web page on the gateway or adguard.local
 *   SSDP / UPnP     routers (Internet gateways), Hue bridges and Sonos answering an M-SEARCH
 *   Ring, Meraki, UniFi   their gear on the network, by the maker part of its hardware address (ARP), while that
 *                   brand isn't connected yet: one suggestion per brand ("Ring devices are on your network")
 *   New devices in Home Assistant   lights, plugs, sensors, locks and the rest that appeared since the last look
 * Every 30 minutes, 3 minutes after start, and when someone presses "Look again" (at most once a minute; "Add by
 * address" at most 12 times a minute). Anything already connected is left out. Each finding stays until it is added
 * or hidden ("Not now" brings it back in a week, "Hide" for good).
 *
 * Everything that comes from the network is untrusted: names lose control and direction characters and are cut
 * short, addresses must be on the home network (private addresses, .local and plain host names; never an internet
 * address or the cloud metadata range), and a typed address is looked up first and refused unless it is private.
 * A new Home Assistant device keeps its area; a network device gets the room its name says ("Kitchen speaker").
 *
 * data/discovered.json  { items: { <key>: item }, known: [device ids], at }   owner-only, no secrets
 *   item: { key, kind, name, addr, firstAt, at, state: 'new' | 'later' | 'hidden' | 'added', until? }
 * Adding: Shelly (no password) is added here and tested first; the first Hue bridge pairs here (Add, then its button:
 * CasaTorch waits 30 seconds for it); Frigate without a password has its cameras added here (the first Frigate only);
 * a new Home Assistant device becomes a tile on Home;
 * the rest open the guided setup at that item with the address filled in (it tests the connection as you go).
 * ====================================================================== */
const DISC_FILE = path.join(DATA_DIR, 'discovered.json');
const disc = { items: {}, known: null, at: null };
try { Object.assign(disc, JSON.parse(fs.readFileSync(DISC_FILE, 'utf8'))); } catch { /* first start */ }
const discSave = () => { if (!isDemo()) { try { writeFileSafe(DISC_FILE, JSON.stringify(disc), 0o600); } catch { /* next time */ } } };
let discBusy = null, discLastRun = 0, discAreas = [];
const DISC_SCAN_GAP = 60_000, DISC_AUTO_GAP = 10 * 60_000;
/* ---- what comes from the network is checked before it is kept ---- */
const DISC_BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff<>]/g;
/** A name a device gave itself: plain text, one line, at most n characters (null when nothing is left). */
const discText = (v, n = 60) => { const t = String(v ?? '').replace(DISC_BAD_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, n).trim(); return t || null; };
/** Is this address on the home network? Private IPv4 (not the 169.254 cloud metadata range), .local / .lan / .home
    names and plain one-word names (Docker, the add-on). loopback only for go2rtc next to CasaTorch. No sign-in in it. */
function discAddrOk(kind, addr) {
  const s = String(addr ?? '');
  if (kind === 'device') return /^[\w.:-]{1,120}$/.test(s);
  if (!s || s.length > 200 || /\s/.test(s)) return false;
  if (/^\w+:\/\//.test(s)) { try { const u = new URL(s); if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false; } catch { return false; } }
  const h = discHost(s);
  if (/^169\.254\./.test(h) || h.includes(':')) return false;   // link-local and IPv6 literals: not offered
  if (/^(127\.|localhost$)/.test(h)) return kind === 'go2rtc';
  return typeof isLanHost === 'function' && isLanHost(h);
}
/** The private IPv4 a typed name or address stands for (null when it isn't on the home network). .local through mDNS. */
async function discLanIp(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const priv = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) && ip.split('.').every((n) => Number(n) <= 255) ? ip : null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return priv(h);
  if (!/^[a-z0-9]([a-z0-9-]{0,62})(\.[a-z0-9-]{1,63})*$/.test(h)) return null;
  let ips = [];
  if (/\.local$/.test(h)) { const ip = await mdnsResolve(h, 1500).catch(() => null); if (ip) ips = [ip]; }
  if (!ips.length) ips = (await Promise.race([dnsP.lookup(h, { all: true, family: 4 }).catch(() => []), sleep(2500).then(() => [])])).map((a) => a.address);
  return ips.length && ips.every((ip) => priv(ip)) ? ips[0] : null;   // every answer private, or none (a name that also points at the internet is refused)
}
/** The room a device's name says it is in: the longest Home Assistant area that appears in it as whole words. */
function discRoomGuess(name, areas = discAreas) {
  const n = ` ${String(name || '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ')} `;
  let best = null;
  for (const a of areas) { const x = String(a || '').toLowerCase().trim(); if (x.length >= 3 && n.includes(` ${x} `) && (!best || x.length > best.length)) best = a; }
  return best ? String(best) : null;
}
/* A few "Add by address" looks a minute, for the whole box (each one knocks on six ports). */
const discIdentifyHits = [];
const discIdentifyOk = (now = Date.now()) => { while (discIdentifyHits.length && now - discIdentifyHits[0] > 60_000) discIdentifyHits.shift(); if (discIdentifyHits.length >= 12) return false; discIdentifyHits.push(now); return true; };

/* What each kind is, and where "Add" goes. step/add are the guided setup's own ids (catalog/setup.json). */
const DISC_KINDS = {
  homeassistant: { label: 'Home Assistant', icon: 'home', step: 'homeassistant', add: '' },
  hue: { label: 'Philips Hue bridge', icon: 'bulb', step: 'controls', add: 'hue-local', quick: (c) => !c.hue?.username },   // one tap, then the bridge's button
  shelly: { label: 'Shelly', icon: 'plug', direct: true },
  frigate: { label: 'Frigate', icon: 'camera', step: 'cameras', add: 'frigate', quick: (c) => !(c.cameras || []).some((x) => x.type === 'frigate') },   // one tap when it has no password
  go2rtc: { label: 'go2rtc camera streams', icon: 'camera', step: 'cameras', add: 'frigate' },
  onvif: { label: 'ONVIF camera', icon: 'camera', step: 'cameras', add: 'onvif' },
  rtsp: { label: 'Camera (RTSP)', icon: 'camera', step: 'cameras', add: 'snapshot' },
  unifi: { label: 'UniFi', icon: 'wifi', step: 'network', add: 'unifi' },
  pihole: { label: 'Pi-hole', icon: 'shield', step: 'network', add: 'dns:pihole' },
  adguard: { label: 'AdGuard Home', icon: 'shield', step: 'network', add: 'dns:adguard' },
  router: { label: 'Router', icon: 'wifi', step: 'network', add: '' },
  ring: { label: 'Ring', icon: 'camera', step: 'cameras', add: 'ring-labs', brand: true },
  meraki: { label: 'Cisco Meraki', icon: 'wifi', step: 'network', add: 'meraki', brand: true },
  sonos: { label: 'Sonos speaker', icon: 'music', ha: 'sonos' },
  chromecast: { label: 'Chromecast or Google speaker', icon: 'music', ha: 'cast' },
  device: { label: 'New in Home Assistant', icon: 'spark', tile: true },
};
const discHost = (u) => { try { return new URL(/^\w+:\/\//.test(String(u)) ? u : `http://${u}`).hostname.toLowerCase(); } catch { return String(u || '').toLowerCase(); } };

/** Addresses of what is connected already, so it is never "found" again. */
function discConnected(c = config) {
  const hosts = new Set(), add = (u) => { if (u) hosts.add(discHost(u)); };
  add(c.homeAssistant?.url); add(c.hue?.ip || c.hue?.host || c.hue?.bridge);
  for (const s of c.shelly || []) add(s.host);
  for (const x of c.cameras || []) { add(x.url); add(x.host); add(x.snapshotUrl); add(x.go2rtc); }
  for (const s of c.network?.sources || []) add(s.url);
  add(c.network?.dns?.url);
  if (c.ring) hosts.add('brand:ring');
  if (c.network?.meraki) hosts.add('brand:meraki');
  if (c.network?.unifi) hosts.add('brand:unifi');
  hosts.delete(''); return hosts;
}

/* ---- the finders this file adds ---- */
function onvifProbe(ms = 2500) {
  return new Promise((done) => {
    const out = new Set(); let s;
    try { s = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { done([]); return; }
    const finish = () => { try { s.close(); } catch { /* closed */ } done([...out]); };
    s.on('error', finish);
    s.on('message', (m) => { for (const x of String(m).matchAll(/<[\w:]*XAddrs>([^<]{1,600})<\/[\w:]*XAddrs>/g)) for (const u of x[1].trim().split(/\s+/)) { const h = discHost(u); if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) out.add(h); } });
    const id = crypto.randomUUID();
    const probe = `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${id}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;
    s.bind(0, () => { s.send(Buffer.from(probe), 3702, '239.255.255.250', () => {}); setTimeout(finish, ms); });
  });
}
/** Does this address answer RTSP on 554? (an OPTIONS request, no password, nothing played) */
function rtspAnswers(ip, ms = 700) {
  return new Promise((ok) => {
    const sock = net.connect({ host: ip, port: 554, timeout: ms });
    let buf = '';
    const end = (v) => { sock.destroy(); ok(v); };
    sock.on('connect', () => sock.write(`OPTIONS rtsp://${ip}:554/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: CasaTorch\r\n\r\n`));
    sock.on('data', (d) => { buf += d; if (buf.length > 12) end(/^RTSP\/1\.\d/.test(buf)); });
    sock.on('timeout', () => end(false)); sock.on('error', () => end(false)); sock.on('close', () => ok(/^RTSP\/1\.\d/.test(buf)));
  });
}
async function rtspScan(ips, { max = 254, at = 24 } = {}) {
  const list = [...new Set(ips)].filter((ip) => /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(ip)).slice(0, max), out = [];
  for (let i = 0; i < list.length; i += at) { const part = list.slice(i, i + at); const r = await Promise.all(part.map((ip) => rtspAnswers(ip))); part.forEach((ip, k) => { if (r[k]) out.push(ip); }); }
  return out;
}
/** What an SSDP answer is: a router (Internet gateway), a Hue bridge or a Sonos speaker; null for the rest. Pure. */
function ssdpKind(text) {
  const t = String(text).slice(0, 4000);
  if (/^hue-bridgeid:/im.test(t) || /IpBridge/i.test(t)) return 'hue';
  if (/^server:.*sonos/im.test(t) || /ZonePlayer/i.test(t)) return 'sonos';
  if (/InternetGatewayDevice/i.test(t)) return 'router';
  return null;
}
function ssdpLook(ms = 2200) {
  return new Promise((done) => {
    const out = new Map(); let s;
    try { s = dgram.createSocket('udp4'); } catch { done([]); return; }
    const finish = () => { try { s.close(); } catch { /* closed */ } done([...out.values()]); };
    s.on('error', finish);
    s.on('message', (m, r) => {
      if (out.size >= 64 || m.length > 4096) return;   // a flood of answers changes nothing
      const t = String(m), kind = ssdpKind(t); if (!kind) return;
      const sv = (t.match(/^server:\s*(.{1,80})$/im) || [])[1];
      const k = `${kind}:${r.address}`; if (!out.has(k)) out.set(k, { kind, ip: r.address, name: kind === 'router' && sv ? discText(sv.replace(/UPnP\/[\d.]+/g, ' '), 40) : null });
    });
    const ask = (st) => s.send(Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`), 1900, '239.255.255.250', () => {});
    s.bind(0, () => { ask('urn:schemas-upnp-org:device:InternetGatewayDevice:1'); ask('urn:schemas-upnp-org:device:basic:1'); ask('urn:schemas-upnp-org:device:ZonePlayer:1'); setTimeout(finish, ms); });
  });
}
/* Brands seen by the maker part of a device's hardware address. Pure: [{ ip, mac }] -> [{ kind, addr, n }]. */
const DISC_MAKERS = [['ring', /^Ring$/i], ['meraki', /^Cisco Meraki$/i], ['unifi', /^Ubiquiti/i]];
function discBrands(nb, maker = (mac) => (typeof makerOf === 'function' ? makerOf(mac) : null)) {
  const by = {};
  for (const x of nb || []) {
    const raw = maker(x?.mac)?.raw; if (!raw || !/^\d+\.\d+\.\d+\.\d+$/.test(String(x.ip))) continue;
    const hit = DISC_MAKERS.find(([, re]) => re.test(raw)); if (!hit) continue;
    (by[hit[0]] ||= { kind: hit[0], addr: x.ip, n: 0 }).n++;
  }
  return Object.values(by);
}
async function go2rtcFind(frigates = []) {
  const cand = new Set(['http://go2rtc.local:1984', 'http://go2rtc:1984', 'http://localhost:1984']);
  for (const f of frigates) cand.add(`http://${discHost(f)}:1984`);
  const ok = await Promise.all([...cand].map(async (u) => { const r = await netProbe(`${u}/api`, { ms: 2000 }); try { const j = r?.status === 200 ? JSON.parse(r.text) : null; return j && (j.version || j.config_path) ? u : null; } catch { return null; } }));
  return ok.filter(Boolean);
}
async function adguardFind() {
  const gw = lanGateway(), cand = ['http://adguard.local', 'http://adguard.local:3000', ...(gw ? [`http://${gw}:3000`] : [])];
  const ok = await Promise.all(cand.map(async (u) => { const r = await netProbe(`${u}/login.html`, { ms: 2000 }); return r && /AdGuard Home/i.test(r.text) ? u : null; }));
  return ok.filter(Boolean);
}
const discMdnsNames = async (svc) => (await mdnsBrowse(svc).catch(() => [])).filter((x) => x.ip).map((x) => ({ addr: x.ip, name: discText(String(x.txt?.fn || x.txt?.md || x.name || '').replace(/\._.*$/, '')) }));

/** One look around: [{ kind, addr, name }]. Never throws; each finder gives up on its own. */
async function discoverLook() {
  const cap = (p, ms = 9000) => Promise.race([p.catch(() => []), sleep(ms).then(() => [])]);
  const base = await cap(discoverAll(true));
  const [onvif, ssdp, sonos, cast, adg, nb] = await Promise.all([cap(onvifProbe()), cap(ssdpLook()), cap(discMdnsNames('_sonos._tcp.local')), cap(discMdnsNames('_googlecast._tcp.local')), cap(adguardFind()), cap(typeof neighbors === 'function' ? neighbors() : Promise.resolve([]))]);
  const [go2, rtsp] = await Promise.all([cap(go2rtcFind(base.frigate || [])), cap(rtspScan(nb.map((x) => x.ip)), 20000)]);
  const out = [];
  for (const k of ['homeassistant', 'hue', 'shelly', 'frigate', 'unifi', 'pihole']) for (const a of base[k] || []) out.push({ kind: k, addr: String(a) });
  for (const a of go2) out.push({ kind: 'go2rtc', addr: a });
  const onvifSet = new Set(onvif);
  for (const a of onvif) out.push({ kind: 'onvif', addr: a });
  for (const a of rtsp) if (!onvifSet.has(a)) out.push({ kind: 'rtsp', addr: a });
  for (const a of adg) out.push({ kind: 'adguard', addr: a });
  const seen = new Set(out.map((f) => `${f.kind}:${discHost(f.addr)}`));
  for (const g of ssdp) if (!seen.has(`${g.kind}:${g.ip}`)) out.push({ kind: g.kind, addr: g.ip, name: g.name || null });
  for (const x of sonos) out.push({ kind: 'sonos', addr: x.addr, name: x.name || null });
  for (const b of discBrands(nb)) if (b.kind !== 'unifi' || !(base.unifi || []).length) out.push({ kind: b.kind === 'unifi' ? 'unifi' : b.kind, addr: b.addr, n: b.n, brand: true });
  for (const x of cast) out.push({ kind: 'chromecast', addr: x.addr, name: x.name || null });
  return out;
}
/* New devices in Home Assistant (and the other connected brands): ids not seen before. The first look only learns what
   is there, so a fresh install doesn't list everything it already has. */
async function discoverNewDevices() {
  const { devices } = await houseDevices().catch(() => ({ devices: [] }));
  discAreas = [...new Set(devices.map((d) => discText(d?.area)).filter(Boolean))].slice(0, 200);
  const ids = devices.filter((d) => d?.id && d.kind && !['camera', 'chime'].includes(d.kind) && /^[\w.:-]{1,120}$/.test(String(d.id))).map((d) => ({ id: String(d.id), name: discText(d.name || d.id), kind: String(d.kind).slice(0, 20), area: discText(d.area) }));
  if (!Array.isArray(disc.known)) { disc.known = ids.map((d) => d.id); return []; }
  const known = new Set(disc.known), fresh = ids.filter((d) => !known.has(d.id));
  disc.known = [...new Set([...disc.known, ...ids.map((d) => d.id)])].slice(-5000);
  return fresh.map((d) => ({ kind: 'device', addr: d.id, name: d.name, device: d.kind, area: d.area }));
}
const discKey = (f) => (f.brand || DISC_KINDS[f.kind]?.brand ? `${f.kind}:brand` : `${f.kind}:${f.kind === 'device' ? f.addr : discHost(f.addr)}`);
/** Merge one look into the list. Answers how many are new. */
function discMerge(found, now = Date.now()) {
  const have = discConnected(); let n = 0;
  for (const f of found) {
    if (!f || !Object.hasOwn(DISC_KINDS, f.kind) || !discAddrOk(f.kind, f.addr)) continue;
    if (f.kind !== 'device' && have.has(discHost(f.addr))) continue;
    if ((f.brand || DISC_KINDS[f.kind].brand) && have.has(`brand:${f.kind}`)) continue;
    const key = discKey(f), old = disc.items[key], name = discText(f.name), area = discText(f.area) || (f.kind !== 'device' ? discRoomGuess(name) : null);
    if (old) { old.at = new Date(now).toISOString(); if (name && !old.name) old.name = name; if (area && !old.area) old.area = area; if (old.state === 'later' && Date.parse(old.until || 0) < now) { old.state = 'new'; delete old.until; } continue; }
    disc.items[key] = { key, kind: f.kind, addr: String(f.addr), name, ...(f.brand ? { brand: true, n: Math.min(999, Number(f.n) || 1) } : {}), ...(f.device && /^[a-z]{1,20}$/.test(f.device) ? { device: f.device } : {}), ...(area ? { area } : {}), firstAt: new Date(now).toISOString(), at: new Date(now).toISOString(), state: 'new' };
    n++;
  }
  // gone for 30 days and never acted on: drop it; anything connected meanwhile: added
  for (const [k, it] of Object.entries(disc.items)) {
    if (it.kind !== 'device' && it.state !== 'added' && (have.has(discHost(it.addr)) || (it.brand && have.has(`brand:${it.kind}`)))) it.state = 'added';
    if (it.state !== 'hidden' && now - Date.parse(it.at) > 30 * 86400_000) delete disc.items[k];
  }
  const keys = Object.keys(disc.items); if (keys.length > 300) for (const k of keys.sort((a, b) => Date.parse(disc.items[a].at) - Date.parse(disc.items[b].at)).slice(0, keys.length - 300)) delete disc.items[k];
  return n;
}
async function discoverRun() {
  if (discBusy) return discBusy;
  discLastRun = Date.now();
  discBusy = (async () => {
    const [net, devs] = await Promise.all([discoverLook(), discoverNewDevices()]);
    const n = discMerge([...net, ...devs]);
    disc.at = nowIso(); discSave();
    if (n) console.log(`  discover: ${n} new thing${n === 1 ? '' : 's'} found on the network`);
    return n;
  })().finally(() => { discBusy = null; });
  return discBusy;
}
if (process.env.CASATORCH_TEST !== '1') {
  const auto = () => { if (isConfigured() && !isDemo() && Date.now() - discLastRun > DISC_AUTO_GAP) discoverRun().catch(() => {}); };
  setTimeout(auto, 3 * 60_000).unref?.();
  setInterval(auto, 30 * 60_000).unref?.();
}

/* ---- what the screens get ---- */
const DISC_DEMO = [
  { key: 'shelly:192.168.1.61', kind: 'shelly', addr: '192.168.1.61', name: 'Shelly Plus Plug S', state: 'new' },
  { key: 'onvif:192.168.1.73', kind: 'onvif', addr: '192.168.1.73', name: null, state: 'new' },
  { key: 'device:light.porch', kind: 'device', addr: 'light.porch', name: 'Porch light', device: 'light', area: 'Porch', state: 'new' },
  { key: 'sonos:192.168.1.82', kind: 'sonos', addr: '192.168.1.82', name: 'Kitchen', area: 'Kitchen', state: 'new' },
];
function discView(it, c = config) {
  const k = DISC_KINDS[it.kind] || {};
  const how = k.direct || (k.quick && !it.brand && k.quick(c)) ? 'direct' : k.tile ? 'tile' : k.ha ? 'ha' : k.step ? 'setup' : 'info';
  return { key: it.key, kind: it.kind, label: k.label, icon: k.icon, name: it.name || null, addr: it.brand ? null : it.addr, ...(it.brand ? { brand: true, n: it.n || 1 } : {}), device: it.device || null, area: it.area || null, at: it.firstAt || it.at || null, how, ...(how === 'setup' ? { step: k.step, add: k.add } : {}), ...(how === 'ha' ? { domain: k.ha } : {}) };
}
app.get('/api/discover', requireRole('admin'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const list = isDemo() ? DISC_DEMO.filter((x) => !demoDiscDone.has(x.key)) : Object.values(disc.items).filter((x) => x.state === 'new' || (x.state === 'later' && Date.parse(x.until || 0) < Date.now()));
  res.json({ items: list.sort((a, b) => String(b.firstAt || '').localeCompare(String(a.firstAt || ''))).slice(0, 60).map(discView), at: disc.at, busy: !!discBusy });
});
/* The badge's count: cheap, for anyone signed in (no names or addresses). */
app.get('/api/discover/count', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ n: isDemo() ? DISC_DEMO.filter((x) => !demoDiscDone.has(x.key)).length : Object.values(disc.items).filter((x) => x.state === 'new').length }); });
const demoDiscDone = new Set();
app.post('/api/discover/scan', requireRole('admin'), asyncRoute(async (_req, res) => {
  if (isDemo()) return res.json({ ok: true, n: 0 });
  if (!discBusy && Date.now() - discLastRun < DISC_SCAN_GAP) return res.json({ ok: true, n: 0, recent: true, at: disc.at });   // a look a minute at most
  res.json({ ok: true, n: await discoverRun(), at: disc.at });
}));
const discItem = (req) => { const k = String(req.params.key || '').slice(0, 240); return Object.hasOwn(disc.items, k) ? disc.items[k] : null; };
app.post('/api/discover/:key/hide', requireRole('admin'), express.json({ limit: '1kb' }), (req, res) => {
  if (isDemo()) { demoDiscDone.add(String(req.params.key)); return res.json({ ok: true }); }
  const it = discItem(req); if (!it) return res.status(404).json({ error: 'That one is gone already.' });
  if (req.body?.later) { it.state = 'later'; it.until = new Date(Date.now() + 7 * 86400_000).toISOString(); } else it.state = 'hidden';
  discSave(); res.json({ ok: true });
});
/** Add it. Shelly: tested, then saved. A Home Assistant device: a tile on Home. The rest: where the guided setup goes. */
app.post('/api/discover/:key/add', requireRole('admin'), express.json({ limit: '1kb' }), asyncRoute(async (req, res) => {
  if (isDemo()) { demoDiscDone.add(String(req.params.key)); return res.json({ ok: true, demo: true }); }
  const it = discItem(req); if (!it) return res.status(404).json({ error: 'That one is gone already.' });
  const k = DISC_KINDS[it.kind];
  if (it.kind === 'shelly') {
    const host = discHost(it.addr);
    if (!discAddrOk('shelly', host)) return res.status(400).json({ error: 'That address isn\'t on your home network.' });
    const j = await getJSON(`http://${host}/shelly`, { timeout: 5000 }).catch(() => null);
    if (!j || typeof j !== 'object' || !(j.type || j.model || j.gen || j.app)) return res.status(502).json({ error: 'That Shelly didn\'t answer. Check that it\'s on and try again.' });
    if (j.auth_en === true || j.auth === true) return res.status(409).json({ error: 'This Shelly has a password. Add it through Home Assistant, or turn its password off in the Shelly app, then try again.', needs: 'password' });
    const model = discText(j.model || j.type || j.app, 40) || 'Shelly';
    const next = { ...config, shelly: [...(config.shelly || []).filter((s) => discHost(s.host) !== host), { host }] };
    saveConfig(next); it.state = 'added'; discSave();
    if (typeof audit === 'function') audit(req, 'device-added', { device: model, via: 'found' });
    return res.json({ ok: true, added: 'shelly', name: model, addr: host });
  }
  if (it.kind === 'device') {
    if (!/^[\w.:-]{1,120}$/.test(it.addr)) return res.status(400).json({ error: 'That device can\'t be added as a tile.' });
    const placed = await homeAddTile({ id: `device:${crypto.randomBytes(3).toString('hex')}`, w: 3, h: 2, device: it.addr });
    const room = await controlsAddRoom(it.area).catch(() => false);
    it.state = 'added'; discSave();
    return res.json({ ok: true, added: 'tile', already: !placed, room: room ? it.area : null, area: it.area || null });
  }
  /* A Hue bridge, when none is paired yet: tap Add, press the bridge's button, done (no wizard). */
  if (it.kind === 'hue' && k.quick(config)) {
    const host = discHost(it.addr);
    if (!discAddrOk('hue', host)) return res.status(400).json({ error: 'That address isn\'t on your home network.' });
    const r = await huePairWait(host).catch((e) => ({ ok: false, error: friendlyError(e, { what: 'The Hue bridge', url: `http://${host}` }).error }));
    if (!r.ok) return res.status(r.timeout ? 409 : 502).json({ error: r.error || 'The Hue bridge didn\'t answer. Check that it\'s on and try again.' });
    const bridgeid = await hueBridgeId(host, r.username);
    saveConfig({ ...config, hue: { host, username: r.username, ...(bridgeid ? { bridgeid } : {}) } }); it.state = 'added'; discSave();
    if (typeof audit === 'function') audit(req, 'device-added', { device: 'Philips Hue', via: 'found' });
    return res.json({ ok: true, added: 'hue' });
  }
  /* Frigate without a password (its usual open port): its cameras are added straight away. With a password, or its
     secure port, the guided setup asks for them as before. */
  if (it.kind === 'frigate' && k.quick(config)) {
    const t = await discFrigateQuick(it.addr).catch(() => null);
    if (t?.cams?.length) {
      saveConfig({ ...config, cameras: [...(config.cameras || []), ...t.cams] }); it.state = 'added'; discSave();
      if (typeof audit === 'function') audit(req, 'device-added', { device: 'Frigate', via: 'found' });
      return res.json({ ok: true, added: 'frigate', n: t.cams.length });
    }
  }
  if (k?.ha) return res.json({ ok: true, open: 'ha', domain: k.ha });
  if (k?.step) return res.json({ ok: true, open: 'setup', step: k.step, add: k.add, ...(it.brand ? {} : { addr: it.addr, found: it.kind }) });
  return res.json({ ok: true, open: 'info' });
}));
/** Frigate found at an http:// home address that needs no password: its cameras, shaped as setup saves them
    (05-setup.js). null when it asks for a sign-in, isn't plain http, or has no cameras - then setup takes over. */
async function discFrigateQuick(addr, test = (b) => frigateTest(b)) {
  const n = normalizeAddress(addr, { defaultPort: 5000 });
  if (n.error || n.scheme !== 'http' || !discAddrOk('frigate', n.url)) return null;
  const r = await test({ url: n.url });
  if (!r?.ok) return null;
  const cams = (Array.isArray(r.cameras) ? r.cameras : []).filter((x) => /^[\w.-]{1,64}$/.test(String(x))).slice(0, 64)
    .map((cam) => ({ id: `frigate-${cam}`, name: cam.replace(/[_-]+/g, ' ').replace(/^\w/, (x) => x.toUpperCase()), type: 'frigate', url: n.url, camera: cam }));
  return { url: n.url, cams };
}
/* "Add by address": type an address, CasaTorch says what it is (the QR-free, no-guessing fallback). */
app.post('/api/discover/identify', requireRole('admin'), express.json({ limit: '1kb' }), asyncRoute(async (req, res) => {
  const raw = String(req.body?.addr || '').trim().slice(0, 300);
  if (!/^[\w.:-]{1,253}$/.test(raw.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))) return res.status(400).json({ error: 'Type an address like 192.168.1.40 or shelly-plug.local.' });
  if (!discIdentifyOk()) return res.status(429).json({ error: 'That\'s a lot of looks in a row. Wait a minute and try again.' });
  const host = await discLanIp(discHost(raw));
  if (!host) return res.status(400).json({ error: 'That address isn\'t on your home network. CasaTorch only looks for devices at home.' });
  const checks = await Promise.all([
    looksHa(`http://${host}:8123`).then((ok) => ok && { kind: 'homeassistant', addr: `http://${host}:8123` }),
    getJSON(`http://${host}/shelly`, { timeout: 3000 }).then((j) => j && typeof j === 'object' && (j.type || j.model || j.gen) && { kind: 'shelly', addr: host, name: discText(j.model || j.type, 40) }).catch(() => null),
    netProbe(`http://${host}/api/config`, { ms: 3000 }).then((r) => r && /"bridgeid"|"apiversion"/i.test(r.text) && { kind: 'hue', addr: host }),
    netProbe(`http://${host}:5000/api/version`, { ms: 3000 }).then((r) => r?.status === 200 && /^[\w.+-]{1,40}$/.test(r.text.trim()) && { kind: 'frigate', addr: `http://${host}:5000` }),
    netProbe(`http://${host}:1984/api`, { ms: 3000 }).then((r) => r?.status === 200 && /"version"|config_path/.test(r.text) && { kind: 'go2rtc', addr: `http://${host}:1984` }),
    rtspAnswers(host, 2000).then((ok) => ok && { kind: 'rtsp', addr: host }),
  ].map((p) => Promise.resolve(p).catch(() => null)));
  const found = checks.filter(Boolean);
  if (!found.length) return res.json({ found: [], message: 'Nothing CasaTorch knows answered at that address.' });
  if (!isDemo()) { discMerge(found); discSave(); }
  res.json({ found: found.map((f) => discView(disc.items[discKey(f)] || { ...f, key: discKey(f), firstAt: nowIso() })) });
}));
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchDiscover = { disc, discFrigateQuick, ssdpKind, discBrands, discMerge, discText, discAddrOk, discLanIp, discRoomGuess, discIdentifyOk, discIdentifyHits, discConnected, discKey, discView, discoverNewDevices, rtspScan, rtspAnswers, onvifProbe, DISC_KINDS };
