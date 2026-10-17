/* ======================================================================
 * Setup, the forgiving part: whatever someone types as an address, the
 * errors gear gives back, and finding things on the home network.
 *
 *   normalizeAddress   "homeassistant.local" -> http://homeassistant.local:8123
 *                      (adds http://, the usual port, drops trailing slashes and
 *                      pasted page paths, fixes "http//" and "https:\\" typos)
 *   friendlyError      ECONNREFUSED, certificate trouble, 401... -> one plain
 *                      sentence saying what happened, and one saying the fix
 *   withRetry          a network blip (time-out, reset, DNS hiccup) is tried
 *                      again with a growing pause before anyone sees an error
 *   mDNS               the names gear announces on the home network
 *                      (_home-assistant._tcp, _hue._tcp, _shelly._tcp) - this
 *                      also works in Docker, where ".local" names often don't
 *   discoverAll        everything above at once, for setup to fill in
 * ====================================================================== */

/** Clean up an address someone typed or pasted. Returns { url, notes } or { error }. */
function normalizeAddress(input, { defaultPort = null, defaultScheme = 'http', keepPath = false } = {}) {
  let s = String(input ?? '').trim().replace(/^[<"'`(\s]+|[>"'`)\s]+$/g, '');
  if (!s) return { error: 'Type the address first.' };
  const notes = [];
  s = s.replace(/\\/g, '/');
  let scheme = null, rest = s;
  const sm = s.match(/^([a-z][a-z0-9+.-]{1,9})\s*[:;]?\s*\/\/+/i) || s.match(/^([a-z]{3,6})\s*:(?!\d)\/*/i);   // "http://", "http//", "https:\\", "htp:/"
  if (sm) {
    const w = sm[1].toLowerCase();
    if (/^h{0,2}t{1,3}ps?$/.test(w)) scheme = w.endsWith('s') ? 'https' : 'http';
    else if (w === 'webcal') scheme = 'https';
    else return { error: 'The address should start with http:// or https://.' };
    rest = s.slice(sm[0].length).replace(/^\/+/, '');
  }
  const slash = rest.search(/[/?#]/);
  let hostPort = slash < 0 ? rest : rest.slice(0, slash), tail = slash < 0 ? '' : rest.slice(slash);
  if (hostPort.includes('@')) return { error: 'Leave the username and password out of the address - type them in their own boxes.' };
  hostPort = hostPort.replace(/\.+$/, '').replace(/:$/, '');
  const m = hostPort.match(/^(\[[0-9a-f:.]+\]|[^\s:/]+)(?::(\d{1,5}))?$/i);
  if (!m || /\s/.test(rest.trim()) || !/^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(\.[a-z0-9_-]+)*)$/i.test(m[1])) return { error: 'That doesn\'t look like an address. It\'s usually like http://192.168.1.20:8123 or http://homeassistant.local:8123.' };
  const host = m[1].toLowerCase();
  let port = m[2] ? Number(m[2]) : null;
  if (port != null && (port < 1 || port > 65535)) return { error: 'The port (the number after the colon) must be between 1 and 65535.' };
  if (!scheme) { scheme = [443, 8443, 8971].includes(port) ? 'https' : defaultScheme; notes.push(`added ${scheme}://`); }
  if (port == null && defaultPort && scheme === 'http') { port = defaultPort; notes.push(`added :${defaultPort}`); }
  if ((scheme === 'http' && port === 80) || (scheme === 'https' && port === 443)) port = null;
  let p = '';
  if (keepPath) p = tail === '/' ? '' : tail;
  else if (tail && tail.replace(/[/?#]+$/, '')) notes.push('removed the page part');
  return { url: `${scheme}://${host}${port ? `:${port}` : ''}${p}`, host, port: port || (scheme === 'https' ? 443 : 80), scheme, notes };
}
/** A host name or IP only (Shelly, Reolink, Hue): strip a pasted http:// and anything after the address. */
const cleanHost = (h) => String(h || '').trim().replace(/^[a-z]+:\/*/i, '').replace(/[/?#].*$/, '').replace(/\.+$/, '').toLowerCase();
/** A pasted token: no "Bearer", quotes, spaces or line breaks. */
const cleanToken = (t) => String(t || '').replace(/^\s*(bearer|token)[:\s]+/i, '').replace(/["'\s]/g, '');
/** What a JSON Web Token (Home Assistant's long-lived tokens are one) says about itself - nothing is trusted, it only helps explain. */
function jwtInfo(t) {
  const parts = String(t || '').split('.');
  if (parts.length !== 3 || parts.some((x) => !/^[\w-]+$/.test(x))) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); return { exp: Number(p.exp) || null, iat: Number(p.iat) || null }; } catch { return null; }
}
/** How far this computer's clock is from another's (a Date header), in ms; null when unknown. */
const clockSkewMs = (dateHeader, now = Date.now()) => { const t = Date.parse(String(dateHeader || '')); return Number.isFinite(t) ? now - t : null; };

/* ---- errors, in plain words ---- */
const errCode = (err) => String(err?.cause?.code || err?.code || err?.cause?.name || err?.name || '');
const errText = (err) => `${err?.message || ''} ${err?.cause?.message || ''} ${err?.body?.message || ''} ${typeof err?.body === 'string' ? err.body : ''}`;
/** Worth trying again: the other side blinked, not "it said no". */
function isTransient(err) {
  const c = errCode(err), t = errText(err);
  return /ECONNRESET|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT|EPIPE|UND_ERR_SOCKET|TimeoutError|AbortError|UND_ERR_CONNECT_TIMEOUT/.test(c) || /timed? ?out|socket hang up|other side closed/i.test(t) || [502, 503, 504].includes(err?.status);
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** Try fn() up to `tries` times, pausing 0.6 s, 1.5 s... between, but only for blips (isTransient). */
async function withRetry(fn, { tries = 3, base = 600, retryIf = isTransient } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (err) { last = err; if (i === tries - 1 || err?.user || !retryIf(err)) throw err; await sleep(Math.round(base * 2.5 ** i)); }
  }
  throw last;
}
/** An error someone can act on: { error, fix, code }. `what` names the thing ("Home Assistant"), `url` the address tried. */
/* Each sentence is also sent as a stable key with its values ({ msg, fixMsg, vars }) so the screen can show it
   in the home's language; "error" and "fix" stay the plain English for anything older that reads them. */
const fillMsg = (s, v) => (s && v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m)) : s);
function friendlyError(err, { what = 'it', url = '', port = null } = {}) {
  if (err?.user) return { error: String(err.message), fix: err.fix || null, code: 'input', msg: err.msgKey || String(err.message), ...(err.vars ? { vars: err.vars } : {}), ...(err.fix ? { fixMsg: err.fix } : {}) };
  const c = errCode(err), t = errText(err), s = err?.status;
  let host = '', p = port; try { const u = new URL(url); host = u.hostname; p ??= Number(u.port) || (u.protocol === 'https:' ? 443 : 80); } catch { /* no address */ }
  const W = what === 'it' ? 'It' : what, isHa = /home assistant/i.test(what);
  const v = { what: W, host, port: p || '?', status: s };
  const r = (code, error, fix) => ({ code, error: fillMsg(error, v), fix: fix ? fillMsg(fix, v) : fix, msg: error, ...(fix ? { fixMsg: fix } : {}), vars: v });
  if (/not allowed/i.test(t)) return r('blocked', 'That address is not allowed.', 'Use the address of a device on your home network.');
  if (/ENOTFOUND|EAI_NONAME/.test(c) || /ENOTFOUND/.test(t)) return r('dns', host ? 'CasaTorch couldn\'t find {host} on your network.' : 'CasaTorch couldn\'t find that name on your network.', /\.local$/i.test(host) ? 'Names ending in .local don\'t work everywhere (Docker, some routers) - use its number address instead, like 192.168.1.20. Your router\'s device list shows it.' : 'Check the spelling, or use its number address (like 192.168.1.20) from your router\'s device list.');
  if (/EAI_AGAIN/.test(c)) return r('dns-down', 'This CasaTorch can\'t look up names right now.', 'Check that it\'s connected to your network (the cable or Wi-Fi), then try again.');
  if (/ECONNREFUSED/.test(c) || /ECONNREFUSED/.test(t)) return r('refused', '{what} isn\'t answering on port {port}.', isHa ? 'Home Assistant normally uses port 8123 - check the number after the colon, and that Home Assistant is running.' : /frigate/i.test(what) ? 'Frigate normally uses port 5000 (or 8971 with https://). Check the number after the colon, and that Frigate is running.' : 'Check the number after the colon, and that it\'s switched on.');
  if (/EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENETDOWN/.test(c)) return r('unreachable', host ? '{host} can\'t be reached from this CasaTorch.' : 'That address can\'t be reached from this CasaTorch.', 'Make sure it\'s switched on and on the same home network (not a guest Wi-Fi or a VPN).');
  if (/CERT_NOT_YET_VALID/.test(c) || /not yet valid/i.test(t)) return r('clock', '{what}\'s security certificate isn\'t valid yet - that almost always means this device\'s clock is wrong.', 'Turn on automatic date and time on the computer CasaTorch runs on, then try again.');
  if (/CERT_HAS_EXPIRED/.test(c) || /certificate has expired/i.test(t)) return r('cert-expired', '{what}\'s security certificate has expired.', url.startsWith('https:') ? 'Renew it on that device, or use its http:// address at home.' : 'Renew it on that device.');
  if (/SELF_SIGNED|UNABLE_TO_VERIFY_LEAF|UNABLE_TO_GET_ISSUER/.test(c) || /self[- ]signed|unable to verify/i.test(t)) return r('cert-self', isHa ? '{what} uses its own (self-signed) security certificate, so CasaTorch can\'t check it\'s really your Home Assistant.' : '{what} uses its own (self-signed) security certificate, so CasaTorch can\'t check it\'s really yours.', isHa ? 'At home, use its http:// address instead (usually http://<its address>:8123).' : 'Use its http:// address at home, or trust its certificate if setup offers that.');
  if (/ERR_TLS_CERT_ALTNAME_INVALID/.test(c) || /altnames|does not match certificate/i.test(t)) return r('cert-name', host ? '{what}\'s certificate is for a different name than {host}.' : '{what}\'s certificate is for a different name than the one typed.', 'Type the exact name it\'s known by, or use its http:// address at home.');
  if (/EPROTO|ERR_SSL|WRONG_VERSION_NUMBER/.test(c) || /wrong version number|packet length too long|ssl3_get_record|EPROTO/i.test(t)) return r('not-https', 'That address speaks plain http, not https.', 'Change https:// to http:// at the start of the address.');
  if (s === 400 && /plain HTTP request was sent to HTTPS port|http request to an https server/i.test(t)) return r('needs-https', 'That port wants a secure (https) connection.', 'Change http:// to https:// at the start of the address.');
  if (s === 401 || s === 403) return r('auth', isHa ? 'Home Assistant turned down the access token - it may be mistyped, expired or deleted.' : '{what} turned down the key, token or password.', isHa ? 'Use "Sign in with Home Assistant" instead, or make a new long-lived token in Home Assistant (your profile > Security) and paste it.' : 'Copy it again (no spaces before or after), or make a new one.');
  if (s === 404 || err instanceof SyntaxError || /Unexpected token|not valid JSON/i.test(t)) return r('wrong-thing', isHa ? 'Something answered at that address, but it isn\'t Home Assistant.' : what === 'it' ? 'Something answered at that address, but it isn\'t what we expected.' : 'Something answered at that address, but it isn\'t {what}.', isHa ? 'Check the port - Home Assistant is usually on :8123.' : 'Check the address and the number after the colon.');
  if (s === 429) return r('busy', '{what} says it\'s had too many requests.', 'Wait a minute, then try again.');
  if (s >= 500) return r('server', '{what} answered with an error ({status}).', 'It may be starting up or updating - try again in a minute.');
  if (isTransient(err)) return r('timeout', '{what} didn\'t answer in time.', 'Check it\'s switched on and the address is right. If it\'s just starting up, try again in a minute.');
  if (/ECONNRESET|socket hang up/i.test(`${c} ${t}`)) return r('reset', 'The connection was cut off.', 'Try again. If it keeps happening, try https:// instead of http:// (or the other way round).');
  const other = String(err?.message || err || 'Something went wrong.').slice(0, 200);
  return { code: 'other', error: other, fix: null, msg: other };
}
const userErr = (msg, fix) => Object.assign(new Error(msg), { user: true, fix: fix || null });

/* ---- mDNS: ask the network who's there (RFC 6762 one-shot queries; answers come back to our own port) ---- */
function mdnsQuery(names, type = 12) {
  const qs = (Array.isArray(names) ? names : [names]).map((n) => {
    const labels = String(n).replace(/\.$/, '').split('.').map((l) => { const b = Buffer.from(l, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); });
    const tail = Buffer.alloc(4); tail.writeUInt16BE(type, 0); tail.writeUInt16BE(1, 2);
    return Buffer.concat([...labels, Buffer.from([0]), tail]);
  });
  const head = Buffer.alloc(12); head.writeUInt16BE(qs.length, 4);
  return Buffer.concat([head, ...qs]);
}
/** Every record in an mDNS answer: { name, type, data } - A: the IP, PTR: a name, SRV: { port, target }, TXT: { key: value }. */
function mdnsParse(buf) {
  const out = [];
  const name = (off, depth = 0) => {
    const labels = []; let jumped = false, end = off;
    while (off < buf.length && depth < 20) {
      const len = buf[off];
      if (len === 0) { off++; break; }
      if ((len & 0xc0) === 0xc0) { const ptr = buf.readUInt16BE(off) & 0x3fff; if (!jumped) end = off + 2; jumped = true; off = ptr; depth++; continue; }
      labels.push(buf.subarray(off + 1, off + 1 + len).toString('utf8')); off += 1 + len;
    }
    return { name: labels.join('.'), end: jumped ? end : off };
  };
  try {
    const qd = buf.readUInt16BE(4), rr = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let off = 12;
    for (let i = 0; i < qd; i++) off = name(off).end + 4;
    for (let i = 0; i < rr && off + 10 <= buf.length; i++) {
      const n = name(off); off = n.end;
      const type = buf.readUInt16BE(off), len = buf.readUInt16BE(off + 8), at = off + 10; off = at + len;
      if (off > buf.length) break;
      let data = null;
      if (type === 1 && len === 4) data = [...buf.subarray(at, at + 4)].join('.');
      else if (type === 12) data = name(at).name;
      else if (type === 33) data = { port: buf.readUInt16BE(at + 4), target: name(at + 6).name };
      else if (type === 16) { data = {}; let o = at; while (o < at + len) { const l = buf[o]; const kv = buf.subarray(o + 1, o + 1 + l).toString('utf8'); const eq = kv.indexOf('='); if (eq > 0) data[kv.slice(0, eq).toLowerCase()] = kv.slice(eq + 1); o += 1 + l; } }
      out.push({ name: n.name.toLowerCase(), type, data });
    }
  } catch { /* a broken packet: keep what we read */ }
  return out;
}
/** Send the questions, collect every answer for `ms`. Never throws (no network, no multicast: no answers). */
function mdnsAsk(names, type = 12, ms = 1800) {
  return new Promise((done) => {
    const recs = []; let s;
    try { s = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { done(recs); return; }
    const finish = () => { try { s.close(); } catch { /* closed */ } done(recs); };
    s.on('error', finish);
    s.on('message', (m) => { for (const r of mdnsParse(m)) recs.push(r); });
    s.bind(0, () => { try { s.setMulticastTTL(255); } catch { /* fine */ } s.send(mdnsQuery(names, type), 5353, '224.0.0.251', () => {}); setTimeout(finish, ms); });
  });
}
/** Instances of a service: [{ name, host, ip, port, txt }]. */
async function mdnsBrowse(service, ms = 1800) {
  const recs = await mdnsAsk(service, 12, ms);
  const by = (type, n) => recs.find((r) => r.type === type && r.name === n)?.data;
  const found = [];
  for (const ptr of recs.filter((r) => r.type === 12 && r.name === service.toLowerCase())) {
    const inst = String(ptr.data).toLowerCase(), srv = by(33, inst), txt = by(16, inst) || {};
    const target = srv?.target?.toLowerCase();
    let ip = target ? by(1, target) : null;
    if (!ip && target) ip = await mdnsResolve(target, 1200);
    if (ip || target) found.push({ name: ptr.data, host: target || null, ip: ip || null, port: srv?.port || null, txt });
  }
  return found;
}
/** A ".local" name's IPv4 address through mDNS (null when nobody answers). */
async function mdnsResolve(host, ms = 1500) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!/\.local$/.test(h)) return null;
  return (await mdnsAsk(h, 1, ms)).find((r) => r.type === 1 && r.name === h)?.data || null;
}

/* ---- finding gear ---- */
const lanGateway = () => { const g = typeof gatewayIp === 'function' ? gatewayIp() : null; if (g) return g; const me = typeof lanAddress === 'function' ? lanAddress() : null; return me ? `${me.split('.').slice(0, 3).join('.')}.1` : null; };
async function netProbe(url, { ms = 2500, insecure = false, method = 'GET' } = {}) {
  try {
    if (insecure && lanHttps(url)) {   // own certificates only on the home network (05-setup.js)
      return await new Promise((ok) => {
        const rq = https.request(url, { method, rejectUnauthorized: false, timeout: ms }, (r) => { let t = ''; r.on('data', (c) => { if (t.length < 20000) t += c; }); r.on('end', () => ok({ status: r.statusCode, text: t, date: r.headers.date })); });
        rq.on('timeout', () => rq.destroy()); rq.on('error', () => ok(null)); rq.end();
      });
    }
    const r = await fetch(url, { method, signal: AbortSignal.timeout(ms), redirect: 'manual' });
    const text = (await r.text().catch(() => '')).slice(0, 20000);
    return { status: r.status, text, date: r.headers.get('date') };
  } catch { return null; }
}
const looksHa = async (base) => { const r = await netProbe(`${base}/api/`, { ms: 3000 }); return !!r && (r.status === 401 || (r.status === 200 && /API running/i.test(r.text))); };
const DISCOVERERS = {
  async homeassistant() {
    const fromMdns = (await mdnsBrowse('_home-assistant._tcp.local')).map((x) => {
      const b = x.txt?.internal_url || x.txt?.base_url; if (b && /^https?:\/\//.test(b)) return b.replace(/\/+$/, '');
      return x.ip ? `http://${x.ip}:${x.port || 8123}` : null;
    }).filter(Boolean);
    const guesses = ['http://homeassistant.local:8123', 'http://homeassistant:8123', 'http://home-assistant.local:8123'];
    const urls = [...new Set([...fromMdns, ...guesses])];
    const ok = await Promise.all(urls.map(async (u) => ((await looksHa(u)) ? u : null)));
    return [...new Set(ok.filter(Boolean))];
  },
  async hue() {
    const [md, cloud] = await Promise.all([mdnsBrowse('_hue._tcp.local'), getJSON('https://discovery.meethue.com/', { timeout: 4000 }).catch(() => [])]);
    return [...new Set([...md.map((x) => x.ip), ...(Array.isArray(cloud) ? cloud.map((b) => b.internalipaddress) : [])].filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(String(ip || ''))))];
  },
  async shelly() {
    const md = await mdnsBrowse('_shelly._tcp.local');
    return [...new Set(md.map((x) => x.ip).filter(Boolean))];
  },
  async frigate() {
    const urls = ['http://frigate.local:5000', 'http://frigate:5000', 'http://ccab4aaf-frigate:5000', 'http://ccab4aaf-frigate-fa:5000'];
    const ok = await Promise.all(urls.map(async (u) => { const r = await netProbe(`${u}/api/version`); return r?.status === 200 && /^[\w.+-]{1,40}$/.test(r.text.trim()) ? u : null; }));
    return ok.filter(Boolean);
  },
  async unifi() {
    const gw = lanGateway(); if (!gw) return [];
    const r = await netProbe(`https://${gw}/`, { insecure: true });
    return r && /unifi/i.test(r.text) ? [`https://${gw}`] : [];
  },
  async pihole() {
    const r = await netProbe('http://pi.hole/admin/');
    return r && /pi-hole/i.test(r.text) ? ['http://pi.hole'] : [];
  },
};
let discoverMemo = { at: 0, p: null };
/** Everything at once, in about four seconds; remembered for two minutes. */
function discoverAll(fresh = false) {
  if (!fresh && discoverMemo.p && Date.now() - discoverMemo.at < 120_000) return discoverMemo.p;
  const run = async () => {
    const out = {};
    await Promise.all(Object.entries(DISCOVERERS).map(async ([k, fn]) => { out[k] = await Promise.race([fn().catch(() => []), sleep(6000).then(() => [])]); }));
    return out;
  };
  discoverMemo = { at: Date.now(), p: run() };
  return discoverMemo.p;
}
/** Fetch through mDNS when the computer itself can't look up a ".local" name (Docker, some Linux boxes). */
async function viaMdns(url) {
  try { const u = new URL(url); if (!/\.local$/i.test(u.hostname)) return null; await dnsP.lookup(u.hostname); return null; }   // the system can: nothing to do
  catch { /* the system can't */ }
  try { const u = new URL(url); const ip = await mdnsResolve(u.hostname); if (!ip) return null; u.hostname = ip; return u.toString().replace(/\/+$/, ''); } catch { return null; }
}
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchSetup = { ...(globalThis.__casatorchSetup || {}), normalizeAddress, cleanHost, cleanToken, jwtInfo, clockSkewMs, friendlyError, isTransient, withRetry, mdnsQuery, mdnsParse };

/** Which address answers as Home Assistant: what was typed first, then the obvious variants (https, no port, the
    .local name's number address). Returns { url, warning? }; throws the first address's error when none answer. */
async function haPickUrl(raw) {
  if (String(raw || '').trim() === SUPERVISOR_HA) return { url: SUPERVISOR_HA };
  const n = normalizeAddress(raw, { defaultPort: 8123 });
  if (n.error) throw userErr(n.error);
  const addedScheme = n.notes.some((x) => /^added https?:/.test(x)), addedPort = n.notes.includes('added :8123');
  const flip = (u) => (u.startsWith('https:') ? u.replace(/^https:/, 'http:') : u.replace(/^http:/, 'https:'));
  const list = [n.url];
  const m = await viaMdns(n.url); if (m) list.push(m);
  if (n.scheme === 'http' || isLanHost(n.host)) list.push(flip(n.url));   // never from https:// down to http:// for an internet address (the token would travel in the clear)
  if (addedPort) list.push(`${n.scheme}://${n.host}`);
  let first = null;
  for (let i = 0; i < list.length && i < 8; i++) {
    const u = list[i];
    try {
      const r = await withRetry(async () => { const x = await fetch(`${u}/api/`, { signal: AbortSignal.timeout(5000), redirect: 'manual' }); return { status: x.status, text: (await x.text().catch(() => '')).slice(0, 2000), date: x.headers.get('date'), loc: x.headers.get('location') }; }, { tries: i === 0 ? 2 : 1 });
      if (r.status === 401 || (r.status === 200 && /API running/i.test(r.text))) {
        const skew = clockSkewMs(r.date);
        const warning = skew != null && Math.abs(skew) > 5 * 60_000 ? `This device's clock is ${Math.round(Math.abs(skew) / 60_000)} minutes ${skew > 0 ? 'ahead' : 'behind'} - turn on automatic date and time on the computer CasaTorch runs on, or sign-ins and certificates can fail.` : null;
        return { url: u, warning };
      }
      if (r.status >= 300 && r.status < 400 && r.loc) { try { const to = new URL(r.loc, u); list.push(`${to.protocol}//${to.host}`); } catch { /* odd redirect */ } continue; }
      first ||= Object.assign(new Error(`HTTP ${r.status}`), { status: r.status === 200 ? 404 : r.status, body: r.text.slice(0, 200) });   // something else answered there
    } catch (err) { first ||= err; }
  }
  throw Object.assign(first || new Error('no answer'), { triedUrl: n.url });
}
/* Which address fields each setup test has, and how to fill in what's missing. */
const TEST_URLS = {
  homeassistant: [], frigate: [['url', { defaultPort: 5000 }]], unifi: [['url', { defaultScheme: 'https' }]], pihole: [['dnsUrl', {}]], adguard: [['dnsUrl', {}]],
  ai: [['url', { defaultPort: 11434, keepPath: true }]], calendar: [['url', { defaultScheme: 'https', keepPath: true }]], feed: [['url', { defaultScheme: 'https', keepPath: true }]], snapshot: [['snapshotUrl', { keepPath: true }]],
};
const TEST_NAMES = { homeassistant: 'Home Assistant', frigate: 'Frigate', unifi: 'UniFi', pihole: 'Pi-hole', adguard: 'AdGuard Home', ai: 'the AI', calendar: 'The calendar', feed: 'The feed', shelly: 'The Shelly', yolink: 'YoLink', reolink: 'The camera', snapshot: 'The camera', meraki: 'Meraki' };
/** Tidy a test's answers before it runs: { body, fixed } or { error }. */
function tidyTestBody(kind, body) {
  const b = { ...body }, fixed = {};
  for (const [f, opt] of TEST_URLS[kind] || []) {
    const v = String(b[f] ?? '').trim(); if (!v) continue;
    const n = normalizeAddress(v, opt); if (n.error) return { error: n.error };
    if (n.url !== v) fixed[f] = n.url;
    b[f] = n.url;
  }
  if (kind === 'reolink' && b.host) { const h = cleanHost(b.host); if (h !== b.host) fixed.host = h; b.host = h; }
  if (kind === 'shelly' && b.hosts) { const h = String(b.hosts).split(/[\s,;]+/).map(cleanHost).filter(Boolean).join(' '); if (h !== String(b.hosts).trim()) fixed.hosts = h; b.hosts = h; }
  for (const k of ['apiKey', 'secret', 'uaid', 'dnsKey']) if (typeof b[k] === 'string') b[k] = b[k].trim();
  return { body: b, fixed };
}
if (process.env.CASATORCH_TEST === '1') Object.assign(globalThis.__casatorchSetup, { tidyTestBody });
