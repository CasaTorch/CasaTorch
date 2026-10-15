#!/usr/bin/env node
/* ======================================================================
 * CasaTorch Box: Wi-Fi setup without a cable or a keyboard.
 *
 * When the Box has no network (no Ethernet cable and no Wi-Fi that works)
 * for about two minutes, it opens its own setup Wi-Fi, "CasaTorch-Setup-XXXX",
 * protected by the password printed on the Box's sticker. Join it either way:
 *   - scan the sticker's QR code with the phone camera, or
 *   - pick the network in the phone's Wi-Fi settings and type the password.
 * The phone then shows the setup page by itself (like hotel Wi-Fi). Pick your
 * home Wi-Fi, type its password, done: the setup Wi-Fi goes away and the Box
 * joins your network. A wrong password brings the setup Wi-Fi back within a
 * minute, with a note saying what went wrong.
 *
 * The setup Wi-Fi only exists while the Box is offline. If the home Wi-Fi is
 * just down for a while (a router restart), the Box keeps trying it every few
 * minutes and goes back to it on its own.
 *
 * Runs as root (it changes network settings, through NetworkManager's nmcli).
 * The Wi-Fi password you type is handed straight to NetworkManager - never
 * written to a log or a CasaTorch file.
 *
 * Settings: /boot/firmware/casatorch-setup.txt
 *   SETUP_SSID=CasaTorch-Setup-7KQ2
 *   SETUP_PASSWORD=...           (8-63 characters; no file = no setup Wi-Fi)
 * ====================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const CONF = process.env.CASATORCH_SETUP_FILE || '/boot/firmware/casatorch-setup.txt';
const IFACE = process.env.CASATORCH_WIFI_IFACE || 'wlan0';
const AP_IP = '10.42.0.1', /* scrub-ok: NetworkManager's standard hotspot address, not a real network */ AP_CON = 'casatorch-setup', PORT = Number(process.env.CASATORCH_SETUP_PORT || 80);
const OFFLINE_BEFORE_SETUP = Number(process.env.CASATORCH_SETUP_AFTER_MS || 120_000), RETRY_HOME_EVERY = 5 * 60_000;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, timeout = 30_000) => new Promise((ok) => execFile(cmd, args, { timeout }, (err, stdout, stderr) => ok({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })));
const nm = (...args) => run('nmcli', args, 60_000);

function settings() {
  try {
    const kv = Object.fromEntries(fs.readFileSync(CONF, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
    const pw = kv.SETUP_PASSWORD || '', ssid = (kv.SETUP_SSID || 'CasaTorch-Setup').slice(0, 32);
    return pw.length >= 8 && pw.length <= 63 ? { ssid, pw } : null;
  } catch { return null; }
}
const cableIn = () => { if (process.env.CASATORCH_SETUP_NO_CABLE) return false; try { return fs.readdirSync('/sys/class/net').filter((n) => /^(eth|en)/.test(n)).some((n) => fs.readFileSync(`/sys/class/net/${n}/carrier`, 'utf8').trim() === '1'); } catch { return false; } };
async function online() {
  const r = await nm('-t', '-f', 'STATE', 'general');
  return /^connected$/m.test(r.out.trim()) || /connected \(site only\)/.test(r.out);
}

/* ---- the networks the Box can see (scanned before the setup Wi-Fi starts; most Wi-Fi chips can't scan while hosting) ---- */
let networks = [];
async function scan() {
  const r = await nm('-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', 'ifname', IFACE, '--rescan', 'yes');
  const seen = new Map();
  for (const line of r.out.split('\n')) {
    const parts = line.split(/(?<!\\):/).map((s) => s.replace(/\\:/g, ':')); if (parts.length < 3) continue;
    const [ssid, signal, sec] = parts; if (!ssid || ssid.startsWith('CasaTorch-Setup')) continue;
    const s = Number(signal) || 0; if (!seen.has(ssid) || seen.get(ssid).signal < s) seen.set(ssid, { ssid, signal: s, secure: !!sec && sec !== '--', enterprise: /802\.1X|EAP/i.test(sec) });
  }
  if (seen.size) networks = [...seen.values()].sort((a, b) => b.signal - a.signal).slice(0, 40);
}

/* ---- setup Wi-Fi on/off ---- */
let apOn = false, lastError = null, busy = false, lastVisit = 0;
async function apStart(s) {
  await scan();
  await nm('connection', 'delete', AP_CON);
  const add = await nm('connection', 'add', 'type', 'wifi', 'ifname', IFACE, 'con-name', AP_CON, 'autoconnect', 'no', 'ssid', s.ssid,
    '802-11-wireless.mode', 'ap', '802-11-wireless.band', 'bg', 'ipv4.method', 'shared', 'ipv4.addresses', `${AP_IP}/24`, 'ipv6.method', 'disabled',
    'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', s.pw, 'wifi-sec.proto', 'rsn', 'wifi-sec.pairwise', 'ccmp', 'wifi-sec.group', 'ccmp');
  const up = add.ok && await nm('connection', 'up', AP_CON);
  apOn = !!(up && up.ok);
  log(apOn ? `setup Wi-Fi on: ${s.ssid}` : `setup Wi-Fi failed to start: ${(add.err || up?.err || '').trim()}`);
  if (apOn) portalStart();
}
async function apStop() {
  portalStop();
  if (apOn) await nm('connection', 'down', AP_CON);
  apOn = false;
}

/* ---- joining the home Wi-Fi ---- */
async function join(ssid, password, hidden) {
  busy = true; lastError = null;
  log(`joining Wi-Fi "${ssid}"`);
  await apStop();
  await sleep(1500);
  const args = ['dev', 'wifi', 'connect', ssid, 'ifname', IFACE];
  if (password) args.push('password', password);
  if (hidden) args.push('hidden', 'yes');
  const r = await nm(...args);
  let ok = r.ok;
  if (ok) { for (let i = 0; i < 20 && !(await online()); i++) await sleep(1500); ok = await online(); }
  if (ok) { log(`joined "${ssid}"`); busy = false; return; }
  const why = /secrets were required|password|802-1x|psk/i.test(r.err) ? 'The password didn\'t work. Check it and try again - it\'s case-sensitive.'
    : /No network with SSID/i.test(r.err) ? `The Box couldn't find "${ssid}". Is it nearby, and is it a 2.4 GHz or 5 GHz home network (not a guest or business sign-in network)?`
    : 'The Box joined but couldn\'t reach the internet. Check the router, then try again.';
  log(`joining "${ssid}" failed`);
  await nm('connection', 'delete', ssid);   // don't keep a broken network around
  lastError = { ssid, why };
  busy = false;
  const s = settings(); if (s) await apStart(s);
}

/* ---- the setup page (only while the setup Wi-Fi is on, only on its address) ---- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up CasaTorch</title>
<style>:root{color-scheme:dark}body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#070a12;color:#e8eef7}main{max-width:440px;margin:0 auto;padding:28px 18px 40px}
h1{font-size:22px;margin:0 0 6px}p{color:#9fb0c5;margin:6px 0 14px}label{display:block;margin:14px 0 6px;font-weight:600}select,input{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #2a3550;background:#0f1524;color:#e8eef7;font:inherit}
button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:12px;background:linear-gradient(90deg,#5eb8ff,#8b7bff);color:#06101e;font:600 16px system-ui}
.err{background:#3b1220;border:1px solid #fb7185;color:#fecdd3;padding:10px 12px;border-radius:12px}.ok{background:#0e2a22;border:1px solid #34d399;padding:12px;border-radius:12px;color:#d1fae5}
.row{display:flex;gap:8px;align-items:center;margin-top:10px;color:#9fb0c5}.row input{width:auto}small{color:#7d8ba0}</style></head><body><main>${body}</main></body></html>`;
}
function formPage() {
  const opts = networks.map((n) => `<option value="${esc(n.ssid)}"${n.enterprise ? ' disabled' : ''}>${esc(n.ssid)}${n.enterprise ? ' (needs a work sign-in - not supported)' : n.secure ? '' : ' (open)'}</option>`).join('');
  return page(`<h1>Connect CasaTorch to your Wi-Fi</h1><p>Pick your home Wi-Fi and type its password. It's sent only to your CasaTorch Box.</p>
${lastError ? `<div class="err"><b>${esc(lastError.ssid)}:</b> ${esc(lastError.why)}</div>` : ''}
<form method="post" action="/connect" autocomplete="off">
<label for="n">Your Wi-Fi</label><select id="n" name="ssid">${opts}<option value="">Another network (type its name)…</option></select>
<div id="other" hidden><label for="o">Network name</label><input id="o" name="other" maxlength="32" autocapitalize="none" autocorrect="off"><div class="row"><input type="checkbox" id="h" name="hidden" value="1"><label for="h" style="margin:0;font-weight:400">It's a hidden network</label></div></div>
<label for="p">Password</label><input id="p" name="password" type="password" maxlength="63" autocapitalize="none" autocorrect="off" spellcheck="false">
<div class="row"><input type="checkbox" id="s" onclick="p.type=this.checked?'text':'password'"><label for="s" style="margin:0;font-weight:400">Show password</label></div>
<button>Connect</button></form>
<p><small>Can't see your network? CasaTorch works with home Wi-Fi (2.4 GHz and 5 GHz). Or plug the Box into your router with a cable instead - it sets itself up.</small></p>
<script>const s=document.getElementById('n'),o=document.getElementById('other');const f=()=>{o.hidden=s.value!=='';};s.onchange=f;f();</script>`);
}
const donePage = (ssid) => page(`<h1>Connecting to ${esc(ssid)}…</h1><div class="ok">This setup Wi-Fi will disappear in a few seconds while the Box joins your network.</div>
<p><b>Next:</b> make sure your phone is back on <b>${esc(ssid)}</b>, wait about a minute, then open</p><p style="font-size:20px"><b>http://casatorch.local:8090</b></p>
<p><small>If the password was wrong, "CasaTorch-Setup" comes back within a minute - join it again and this page will say what happened.</small></p>`);

let server = null; const hits = [];
function portalStart() {
  if (server) return;
  server = http.createServer((req, res) => {
    lastVisit = Date.now();
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'");
    if (req.method === 'POST' && req.url === '/connect') {
      const now = Date.now(); while (hits.length && now - hits[0] > 60_000) hits.shift();
      if (hits.length >= 6 || busy) { res.writeHead(429, { 'Content-Type': 'text/html' }); return res.end(page('<h1>One moment</h1><p>Too many tries - wait a minute and try again.</p>')); }
      hits.push(now);
      let body = ''; req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        const f = new URLSearchParams(body), ssid = (f.get('ssid') || f.get('other') || '').trim().slice(0, 32), pw = f.get('password') || '';
        if (!ssid) { res.writeHead(303, { Location: '/' }); return res.end(); }
        if (pw && (pw.length < 8 || pw.length > 63)) { lastError = { ssid, why: 'Wi-Fi passwords are 8 to 63 characters long.' }; res.writeHead(303, { Location: '/' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(donePage(ssid));
        setTimeout(() => join(ssid, pw, f.get('hidden') === '1'), 2500);
      });
      return;
    }
    // Every other address shows the setup page - that's what makes phones open it by themselves.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(formPage());
  });
  server.on('error', (e) => { log(`setup page: ${e.message}`); server = null; });
  server.listen(PORT, process.env.CASATORCH_SETUP_BIND || AP_IP, () => log(`setup page on http://${AP_IP}/`));
}
function portalStop() { if (server) { server.close(); server = null; } }

/* ---- main loop ---- */
let offlineSince = null, apSince = 0;
async function tick() {
  if (busy) return;
  const s = settings();
  if (apOn) {
    // In setup mode: every few minutes (when nobody is on the setup page) try the saved home Wi-Fi again.
    if (Date.now() - apSince > RETRY_HOME_EVERY && Date.now() - lastVisit > 120_000) {
      log('trying the saved Wi-Fi again'); await apStop(); await nm('device', 'connect', IFACE);
      for (let i = 0; i < 30 && !(await online()); i++) await sleep(1500);
      if (await online()) { log('back online'); offlineSince = null; return; }
      if (s) { await apStart(s); apSince = Date.now(); }
    }
    return;
  }
  if (cableIn() || (await online())) { offlineSince = null; return; }
  offlineSince ??= Date.now();
  if (Date.now() - offlineSince < OFFLINE_BEFORE_SETUP) return;
  if (!s) { if (offlineSince && Date.now() - offlineSince < OFFLINE_BEFORE_SETUP + 15_000) log(`offline, but no setup Wi-Fi password in ${CONF} - use a cable or Raspberry Pi Imager's Wi-Fi settings`); return; }
  await apStart(s); apSince = Date.now();
}
if (process.argv[2] === '--check') { console.log(JSON.stringify({ settings: !!settings(), cable: cableIn() })); process.exit(0); }
log('Wi-Fi setup helper started');
process.on('SIGTERM', async () => { await apStop(); process.exit(0); });
for (;;) { try { await tick(); } catch (e) { log(`error: ${e.message}`); } await sleep(10_000); }
