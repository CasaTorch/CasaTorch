#!/usr/bin/env node
/* A stand-in for Cloudflare's cloudflared, for test/remote-e2e.mjs. Copied to <data>/bin/cloudflared.
   It reads the tunnel token the fake casatorch.com handed out (base64url JSON { h: hostname, p: port }),
   prints the log lines the real one prints, and plays "Cloudflare's edge": an http server on
   CASATORCH_FAKE_EDGE_PORT that forwards to CasaTorch with the secure address as Host and a visitor IP in
   CF-Connecting-IP (X-Fake-Ip, or 203.0.113.9), as Cloudflare does.
   What it does is set by the file FAKE_MODE next to it:
     ok       connects
     noquic   only connects with --protocol http2 (a firewall that blocks UDP 7844)
     blocked  never connects (outgoing port 7844 blocked)
     token    the key is turned down ("Unauthorized")
     stale    says it's connected, but the edge answers 530 (a tunnel that died while the computer slept)
     crash    connects, then stops after a second (CasaTorch restarts it)
   And what casatorch.com's side of the tunnel could try (CasaTorch must keep the tunnel to itself):
     pushok   Cloudflare's side sends rules that reach this CasaTorch only (fine)
     pushlegacy  ...the one rule casatorch.com gives an older box's tunnel (its own name as httpHostHeader: fine)
     pushlan  ...rules that send visitors to a router on the home network
     warp     ...rules that turn on private-network routing
     hostrewrite  the edge sends a home-looking Host (127.0.0.1:<port>) instead of the secure address
   Its arguments go to FAKE_ARGS (one run per line).
   The edge gate (casatorch.com's edge-gate/ Worker), played the same way when a GATE_STATE file is next to it (the fake
   casatorch.com writes it from the box's signed calls): only requests with a valid ticket (cookie __Host-ct_gate or
   header X-CT-Gate, checked strictly like edge-gate/src/ticket.js) get through; the lock and allowed countries
   (X-Fake-Country, default US, passed on as CF-IPCountry); POST /__ct_gate/set turns a browser ticket into the cookie. */
/* CommonJS on purpose: the copy has no file extension. */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const here = __dirname;
const mode = (() => { try { return fs.readFileSync(path.join(here, 'FAKE_MODE'), 'utf8').trim(); } catch { return 'ok'; } })();
const proto = process.argv.includes('--protocol') ? process.argv[process.argv.indexOf('--protocol') + 1] : 'quic';
const log = (lvl, t) => process.stderr.write(`2026-10-17T12:00:00Z ${lvl} ${t}\n`);
try { fs.appendFileSync(path.join(here, 'FAKE_RUNS'), `${mode} ${proto}\n`); fs.appendFileSync(path.join(here, 'FAKE_ARGS'), `${JSON.stringify(process.argv.slice(2))}\n`); } catch { /* fine */ }
let tok; try { tok = JSON.parse(Buffer.from(String(process.env.TUNNEL_TOKEN || ''), 'base64url').toString()); } catch { tok = null; }
if (!tok?.h || !tok?.p) { log('ERR', 'Provided Tunnel token is not valid.'); process.exit(1); }
log('INF', `Starting tunnel tunnelID=fake version=2026.10.7 protocol=${proto}`);
if (mode === 'token') { log('ERR', 'Register tunnel error from server side error="Unauthorized: Invalid tunnel secret" connIndex=0 ip=198.41.192.7'); setTimeout(() => process.exit(1), 100); }
else if (mode === 'blocked' || (mode === 'noquic' && proto !== 'http2')) {
  const say = () => (proto === 'http2' ? log('ERR', 'Unable to establish connection with Cloudflare edge error="DialContext error: dial tcp 198.41.192.7:7844: i/o timeout" connIndex=0') : log('ERR', 'Failed to dial a quic connection error="failed to dial to edge with quic: timeout: no recent network activity" connIndex=0 ip=198.41.192.7'));
  say(); setInterval(say, 700);
} else {
  const edge = http.createServer((req, res) => {
    if (mode === 'stale') { res.writeHead(530, { 'Content-Type': 'text/html' }); return res.end('error code: 1033'); }
    if (gateRefused(req, res)) return;
    const headers = { ...req.headers, host: mode === 'hostrewrite' ? `127.0.0.1:${tok.p}` : tok.h, 'cf-connecting-ip': req.headers['x-fake-ip'] || '203.0.113.9', 'cf-ray': 'fake-0', 'cf-ipcountry': req.headers['x-fake-country'] || 'US', 'x-forwarded-proto': 'https', 'x-forwarded-for': req.headers['x-fake-ip'] || '203.0.113.9' };
    if (req.headers['x-fake-city']) headers['cf-ipcity'] = req.headers['x-fake-city'];
    delete headers['x-fake-ip']; delete headers['x-fake-country']; delete headers['x-fake-city']; delete headers['x-ct-gate'];
    const up = http.request({ host: '127.0.0.1', port: tok.p, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
    req.pipe(up);
  });
  const listen = (n = 0) => edge.listen(Number(process.env.CASATORCH_FAKE_EDGE_PORT), '127.0.0.1', () => {
    for (const i of [0, 1, 2, 3]) log('INF', `Registered tunnel connection connIndex=${i} connection=fake-${i} event=0 ip=198.41.200.${i} location=test protocol=${proto}`);
    const pushed = { pushok: { ingress: [{ hostname: tok.h, service: `http://localhost:${tok.p}` }, { service: 'http_status:404' }], 'warp-routing': { enabled: false } },
      pushlegacy: { ingress: [{ hostname: tok.h, service: `http://localhost:${tok.p}`, originRequest: { httpHostHeader: tok.h } }, { service: 'http_status:404' }] },
      pushlan: { ingress: [{ hostname: tok.h, service: 'http://192.0.2.1:80' }, { service: 'http_status:404' }] },
      warp: { ingress: [{ hostname: tok.h, service: `http://localhost:${tok.p}` }, { service: 'http_status:404' }], 'warp-routing': { enabled: true } } }[mode];
    if (pushed) setTimeout(() => log('INF', `Updated to new configuration config=${JSON.stringify(JSON.stringify(pushed))} version=1`), 300);
    if (mode === 'crash') setTimeout(() => { log('ERR', 'Connection terminated error="crash" connIndex=0'); process.exit(3); }, 1000);
  });
  edge.on('error', (e) => { if (e.code === 'EADDRINUSE') setTimeout(() => listen(), 200); else throw e; });
  listen();
}
/* ---- the edge gate ---- */
function gateTicket(t, host, rec) {
  const crypto = require('node:crypto');
  const m = /^ct1\.([A-Za-z0-9_-]{20,700})\.([A-Za-z0-9_-]{86})$/.exec(String(t || '')); if (!m || !rec.pub) return null;
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(rec.pub, 'base64')]), format: 'der', type: 'spki' });
  if (!crypto.verify(null, Buffer.from(`ct1.${m[1]}`), key, Buffer.from(m[2], 'base64url'))) return null;
  let p; try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString()); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (p.h !== host || p.exp - p.nbf > 43200 || now < p.nbf - 60 || now >= p.exp + 60 || p.e < (rec.epoch || 0) || (rec.revoked || []).includes(p.d) || (p.k === 'self' && p.d !== 'box')) return null;
  return p;
}
function gateRefused(req, res) {
  let rec; try { rec = JSON.parse(fs.readFileSync(path.join(here, 'GATE_STATE'), 'utf8')); } catch { return false; }   // no gate: as before
  const cookie = (String(req.headers.cookie || '').match(/(?:^|;\s*)__Host-ct_gate=([^;]+)/) || [])[1];
  const p = gateTicket(cookie || req.headers['x-ct-gate'], tok.h, rec), country = String(req.headers['x-fake-country'] || 'US');
  const no = (extra = {}) => { const api = req.url.startsWith('/api/') || /json/.test(req.headers.accept || ''); res.writeHead(403, { 'Content-Type': api ? 'application/json' : 'text/html', 'Cache-Control': 'no-store' }); res.end(api ? JSON.stringify({ error: 'This home only opens on approved devices.', gate: true, ...extra }) : '<!doctype html><h1>This home only opens on approved devices</h1>'); return true; };
  if (rec.locked) { if (p && p.k === 'app' && req.method === 'POST' && req.url === '/api/gate/unlock') return false; return no(p ? { locked: true } : {}); }
  if (Array.isArray(rec.countries) && rec.countries.length && !rec.countries.includes(country)) return no();
  if (req.url === '/__ct_gate/set' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { const t = new URLSearchParams(body).get('t'), q = gateTicket(t, tok.h, rec); if (!q || q.k !== 'browser') { res.writeHead(403); return res.end('no'); } res.writeHead(303, { Location: '/', 'Set-Cookie': `__Host-ct_gate=${t}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${q.exp - Math.floor(Date.now() / 1000)}` }); res.end(); });
    return true;
  }
  if (p) return false;
  if ((rec.graceUntil || 0) > Date.now() / 1000 && (/^Bearer /.test(req.headers.authorization || '') || /casatorch_session=/.test(req.headers.cookie || ''))) return false;
  return no();
}
process.on('SIGTERM', () => process.exit(0));
