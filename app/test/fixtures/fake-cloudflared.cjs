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
     crash    connects, then stops after a second (CasaTorch restarts it) */
/* CommonJS on purpose: the copy has no file extension. */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const here = __dirname;
const mode = (() => { try { return fs.readFileSync(path.join(here, 'FAKE_MODE'), 'utf8').trim(); } catch { return 'ok'; } })();
const proto = process.argv.includes('--protocol') ? process.argv[process.argv.indexOf('--protocol') + 1] : 'quic';
const log = (lvl, t) => process.stderr.write(`2026-10-17T12:00:00Z ${lvl} ${t}\n`);
try { fs.appendFileSync(path.join(here, 'FAKE_RUNS'), `${mode} ${proto}\n`); } catch { /* fine */ }
let tok; try { tok = JSON.parse(Buffer.from(String(process.env.TUNNEL_TOKEN || ''), 'base64url').toString()); } catch { tok = null; }
if (!tok?.h || !tok?.p) { log('ERR', 'Provided Tunnel token is not valid.'); process.exit(1); }
log('INF', `Starting tunnel tunnelID=fake version=2026.10.0 protocol=${proto}`);
if (mode === 'token') { log('ERR', 'Register tunnel error from server side error="Unauthorized: Invalid tunnel secret" connIndex=0 ip=198.41.192.7'); setTimeout(() => process.exit(1), 100); }
else if (mode === 'blocked' || (mode === 'noquic' && proto !== 'http2')) {
  const say = () => (proto === 'http2' ? log('ERR', 'Unable to establish connection with Cloudflare edge error="DialContext error: dial tcp 198.41.192.7:7844: i/o timeout" connIndex=0') : log('ERR', 'Failed to dial a quic connection error="failed to dial to edge with quic: timeout: no recent network activity" connIndex=0 ip=198.41.192.7'));
  say(); setInterval(say, 700);
} else {
  const edge = http.createServer((req, res) => {
    if (mode === 'stale') { res.writeHead(530, { 'Content-Type': 'text/html' }); return res.end('error code: 1033'); }
    const headers = { ...req.headers, host: tok.h, 'cf-connecting-ip': req.headers['x-fake-ip'] || '203.0.113.9', 'cf-ray': 'fake-0', 'x-forwarded-proto': 'https', 'x-forwarded-for': req.headers['x-fake-ip'] || '203.0.113.9' };
    delete headers['x-fake-ip'];
    const up = http.request({ host: '127.0.0.1', port: tok.p, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
    req.pipe(up);
  });
  const listen = (n = 0) => edge.listen(Number(process.env.CASATORCH_FAKE_EDGE_PORT), '127.0.0.1', () => {
    for (const i of [0, 1, 2, 3]) log('INF', `Registered tunnel connection connIndex=${i} connection=fake-${i} event=0 ip=198.41.200.${i} location=test protocol=${proto}`);
    if (mode === 'crash') setTimeout(() => { log('ERR', 'Connection terminated error="crash" connIndex=0'); process.exit(3); }, 1000);
  });
  edge.on('error', (e) => { if (e.code === 'EADDRINUSE') setTimeout(() => listen(), 200); else throw e; });
  listen();
}
process.on('SIGTERM', () => process.exit(0));
