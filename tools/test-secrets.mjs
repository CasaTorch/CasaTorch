#!/usr/bin/env node
/*
 * Where do passwords and keys end up? A fresh CasaTorch gets real-looking secrets through setup, the sign-in page and
 * Settings (in a real browser, opened on this computer's network address so it's a plain-http page like a home
 * network), then everything is searched for them:
 *   every file in the data folder, CasaTorch's own log (process output and Settings › Log), every GET API answer,
 *   the support file, the browser's storage (localStorage, sessionStorage), what the browser sent over the network,
 *   and every byte CasaTorch sent to the stand-in services (Home Assistant, an AI, UniFi, Meraki, Pi-hole, a Reolink camera).
 * A secret may only appear in what's sent to its own service, in the header (or sign-in body) that service reads it from -
 * never in an address.
 *   cd app && node build.mjs && cd .. && node tools/test-secrets.mjs      (Playwright from $PLAYWRIGHT; TEST_PORT_BASE picks ports)
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('./test-e2e-lib.cjs');
const { check, finish } = L.runner('secrets: never readable outside where they are used');

const SECRETS = {
  ownerPw: 'Kettle-Porch-Lamp-41', newPw: 'Garden-Hose-Window-73', haToken: L.HA_TOKEN,
  aiKey: 'sk-test-ai-key-Q9X2Z7W4', aiKey2: 'sk-test-ai-key-second-R5T8', unifiKey: 'unifi-test-key-M3N6P9Q2',   // scrub-ok: made-up test values
  piholePw: 'pihole-test-pass-K4L7', reolinkPw: 'reolink-test-pass-H2J5', snapPw: 'snapshot-test-pass-D8F1',
  merakiKey: 'meraki0test0key0V7B4N1C9X2Z5',   // scrub-ok: made-up test value (a Meraki key entered with Meraki cameras in setup)
};
const ALLOWED = {   // where each secret may appear in what CasaTorch sends to the stand-in services
  haToken: [/^authorization: bearer /i],
  aiKey: [/^authorization: bearer /i], aiKey2: [/^authorization: bearer /i],
  unifiKey: [/^x-api-key: /i],
  merakiKey: [/^authorization: bearer /i],
  piholePw: [/^\{"password":/],   // Pi-hole 6's sign-in: the password in the body of POST /api/auth
  reolinkPw: [/^\[\{"cmd":"Login"/],   // Reolink's sign-in: in the body of cmd=Login, never in an address
};

/* A pass-through that keeps every byte sent to a service (HTTP and WebSocket alike). */
async function recorder(targetPort) {
  const port = await L.freePort(), chunks = [];
  const srv = net.createServer((c) => {
    const up = net.connect(targetPort, '127.0.0.1');
    c.on('data', (d) => { chunks.push(Buffer.from(d)); up.write(d); }); up.on('data', (d) => c.write(d));
    c.on('error', () => up.destroy()); up.on('error', () => c.destroy()); c.on('close', () => up.destroy()); up.on('close', () => c.destroy());
  });
  await new Promise((ok) => srv.listen(port, '127.0.0.1', ok));
  return { port, base: `http://127.0.0.1:${port}`, text: () => Buffer.concat(chunks).toString('latin1'), close: () => srv.close() };
}
/* Stand-ins for an OpenAI-style AI, UniFi, Pi-hole 6, a Reolink camera and a plain snapshot camera. */
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');
async function fakeServices() {
  const port = await L.freePort();
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      const u = new URL(req.url, 'http://x'), j = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname.startsWith('/meraki/api/v1/')) return /Bearer meraki0test0key/.test(req.headers.authorization || '') ? j(u.pathname.endsWith('/organizations') ? [{ id: '1', name: 'Test org' }] : []) : j({ errors: ['Invalid API key'] }, 401);
      if (u.pathname.endsWith('/models')) return /Bearer sk-test-ai-key/.test(req.headers.authorization || '') ? j({ data: [{ id: 'gpt-4o-mini' }] }) : j({ error: 'no' }, 401);
      if (u.pathname === '/proxy/network/integration/v1/sites') return req.headers['x-api-key'] === SECRETS.unifiKey ? j({ data: [{ id: 's1', name: 'Default' }] }) : j({}, 401);
      if (u.pathname.startsWith('/proxy/network/integration/v1/')) return j({ data: [], totalCount: 0 });
      if (u.pathname === '/api/auth') return req.method === 'DELETE' ? j({}) : j({ session: { valid: body.includes(SECRETS.piholePw), sid: 'sid-1' } });
      if (u.pathname.startsWith('/api/stats') || u.pathname.startsWith('/api/dns')) return j({ queries: { total: 10, blocked: 1, percent_blocked: 10 }, clients: { active: 2 }, gravity: { domains_being_blocked: 100 }, blocking: 'enabled' });
      if (u.pathname === '/cgi-bin/api.cgi' && u.searchParams.get('cmd') === 'Login') return j([{ cmd: 'Login', code: 0, value: { Token: { leaseTime: 3600, name: 'reolink-session-1' } } }]);
      if (u.pathname === '/cgi-bin/api.cgi' || u.pathname === '/snap.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(JPEG); }
      j({}, 404);
    });
  });
  await new Promise((ok) => srv.listen(port, '127.0.0.1', ok));
  return { port, close: () => srv.close() };
}
const lanIp = () => Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address || null;
/* Where in a text a secret turns up: the line it's on. */
const hitsIn = (text, secret) => { const out = []; let i = -1; while ((i = text.indexOf(secret, i + 1)) >= 0) { const s = text.lastIndexOf('\n', i) + 1, e = text.indexOf('\n', i); out.push(text.slice(s, e < 0 ? undefined : e).replace(/\r$/, '')); } return out; };
const found = (text) => Object.entries(SECRETS).filter(([, v]) => text.includes(v)).map(([k]) => k);

let browser = null;
try {
  const ha = await L.startMockHa(), haRec = await recorder(ha.port);
  const fake = await fakeServices(), fakeRec = await recorder(fake.port);
  const s = await L.startCasaTorch({ name: 'secrets', env: { CASATORCH_MERAKI_BASE: `${fakeRec.base}/meraki/api/v1` } }), B = s.base, DATA = s.data;
  const H = { 'Content-Type': 'application/json', Origin: B };
  let cookie = '';
  const req = async (m, p, body, c = cookie) => { const r = await fetch(B + p, { method: m, headers: { ...H, ...(c ? { Cookie: c } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(20000) }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ } return { s: r.status, j, text, sc: r.headers.get('set-cookie') }; };

  /* ---- 1. setup (from this computer), with every kind of secret ---- */
  const tHa = await req('POST', '/api/setup/test/homeassistant', { url: haRec.base, token: SECRETS.haToken });
  check('setup: Home Assistant test passes', tHa.s === 200 && tHa.j?.ok, tHa.text.slice(0, 200));
  const tAi = await req('POST', '/api/setup/test/ai', { provider: 'openai', url: `${fakeRec.base}/v1`, apiKey: SECRETS.aiKey });
  check('setup: AI test passes', tAi.j?.ok, tAi.text.slice(0, 200));
  const tUni = await req('POST', '/api/setup/test/unifi', { url: fakeRec.base, apiKey: SECRETS.unifiKey });
  check('setup: UniFi test passes', tUni.j?.ok, tUni.text.slice(0, 200));
  const tPh = await req('POST', '/api/setup/test/pihole', { dnsUrl: fakeRec.base, dnsKey: SECRETS.piholePw });
  check('setup: Pi-hole test passes', tPh.j?.ok, tPh.text.slice(0, 200));
  {   // the setup page itself seals what's typed into it
    browser = await L.launchBrowser();
    const { ctx, page } = await L.newEnglishPage(browser), sentBySetup = [];
    page.on('request', (r) => sentBySetup.push(`${r.url()}\n${r.postData() || ''}`));
    await page.goto(`${B}/setup.html`); await page.waitForFunction(() => !!window.CasaSeal, null, { timeout: 20000 });
    const r = await page.evaluate(async ([u, k]) => { const x = await fetch('/api/setup/test/pihole', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dnsUrl: u, dnsKey: k }) }); return x.json(); }, [fakeRec.base, SECRETS.piholePw]);
    check('setup page: a Pi-hole password is sealed in the browser and works', r.ok === true, JSON.stringify(r).slice(0, 200));
    check('setup page: what it sent never carried the password readable', !found(sentBySetup.join('\n')).length);
    await ctx.close();
  }
  const bad = await req('POST', '/api/setup/test/snapshot', { snapshotUrl: `http://admin:${SECRETS.snapPw}@127.0.0.1:9/snap.jpg` });
  check('setup: a failed test\'s error message has no password in it', !found(bad.text).length, bad.text.slice(0, 300));
  const fin = await req('POST', '/api/setup/finish', { answers: {
    house: { name: 'Test House', timezone: 'America/Los_Angeles' },
    account: { username: 'owner1', password: SECRETS.ownerPw, terms: true },
    homeassistant: { uses: 'yes', url: haRec.base },
    cameras: { has: 'yes', kinds: ['reolink-local', 'snapshot', 'meraki-mv'], 'meraki-mv': { apiKey: SECRETS.merakiKey }, 'reolink-local': { host: `127.0.0.1:${fakeRec.port}`, username: 'admin', password: SECRETS.reolinkPw }, snapshot: { snapshotUrl: `${fakeRec.base}/snap.jpg`, username: 'cam', password: SECRETS.snapPw } },
    network: { kind: 'unifi', unifi: { url: fakeRec.base, apiKey: SECRETS.unifiKey }, dns: 'pihole', dnsUrl: fakeRec.base, dnsKey: SECRETS.piholePw },
    ai: { provider: 'openai', url: `${fakeRec.base}/v1`, apiKey: SECRETS.aiKey, _test: { ok: true, model: 'gpt-4o-mini' } },
  } });
  check('setup: finished', fin.s === 200, fin.text.slice(0, 200));
  const lg = await req('POST', '/api/auth/login', { username: 'owner1', password: SECRETS.ownerPw }, '');
  cookie = (lg.sc || '').split(';')[0];
  check('owner signs in', lg.s === 200 && !!cookie, `HTTP ${lg.s}`);
  await req('GET', '/api/cameras/camera:reolink-1/snapshot').catch(() => null);
  await new Promise((r) => setTimeout(r, 2500));   // the cameras' first pictures, Home Assistant's live link

  /* ---- 2. the browser: sign-in page and Settings, on a plain-http network address ---- */
  const ip = lanIp(), PB = ip ? `http://${ip}:${s.port}` : B;
  const { ctx, page, errors } = await L.newEnglishPage(browser);
  const wire = [];
  page.on('request', (r) => wire.push(`${r.method()} ${r.url()}\n${Object.entries(r.headers()).map(([k, v]) => `${k}: ${v}`).join('\n')}\n${r.postData() || ''}`));
  await page.goto(`${PB}/login.html`);
  check(`the sign-in page ${ip ? 'on a plain-http network address' : 'on this computer'} can seal (${ip ? 'JavaScript crypto' : 'WebCrypto'})`, await page.evaluate(() => !!window.CasaSeal?.ready));
  await page.fill('#u', 'owner1'); await page.fill('#p', SECRETS.ownerPw);
  await Promise.all([page.waitForURL((u) => !/login\.html/.test(String(u)), { timeout: 20000 }), page.click('button[type=submit]')]);
  check('signed in through the sign-in page', !/login\.html/.test(page.url()), page.url());
  await page.waitForFunction(() => !!window.CasaSeal, null, { timeout: 20000 });   // the dashboard (app.js) has its own copy of the sealer
  const evalPost = (url, body, method = 'POST') => page.evaluate(async ([u, b, m]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, t: await r.text() }; }, [url, body, method]);
  const m1 = await evalPost('/api/settings/ai/models', { provider: 'openai', url: `${fakeRec.base}/v1`, apiKey: SECRETS.aiKey2 });
  check('Settings: a new AI key is checked (sealed in the browser, opened in the request)', m1.s === 200, m1.t.slice(0, 200));
  const m2 = await evalPost('/api/settings/ai', { provider: 'openai', model: 'gpt-4o-mini', url: `${fakeRec.base}/v1`, apiKey: SECRETS.aiKey2 }, 'PUT');
  check('Settings: the new AI key is saved', m2.s === 200, m2.t.slice(0, 200));
  const pw = await evalPost('/api/auth/password', { current: SECRETS.ownerPw, next: SECRETS.newPw });
  check('Security: password changed', pw.s === 200, pw.t.slice(0, 200));
  if (ip) {
    const plain = await fetch(`${PB}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: PB }, body: JSON.stringify({ username: 'owner1', password: SECRETS.newPw }) });
    check('over plain http from another device, a password that isn\'t sealed is refused', plain.status === 400 && plain.headers.get('x-casatorch-seal') === 'required', `HTTP ${plain.status}`);
  }
  for (const h of ['#home', '#settings', '#network', '#energy']) { await page.goto(`${PB}/${h}`); await page.waitForTimeout(1200); }
  const store = await page.evaluate(() => { const o = {}; for (const st of [localStorage, sessionStorage]) for (let i = 0; i < st.length; i++) o[st.key(i)] = st.getItem(st.key(i)); return JSON.stringify(o); });
  check('the browser\'s storage holds no password or key', !found(store).length, found(store).join(', '));
  check('what the browser sent never carried a password or key readable', !found(wire.join('\n')).length, found(wire.join('\n')).join(', '));
  check('no page errors', !errors.filter((e) => !/favicon|ResizeObserver|Cross-Origin-Opener-Policy|origin was untrustworthy/.test(e)).length, errors.join(' | ').slice(0, 300));
  await ctx.close();
  cookie = (await req('POST', '/api/auth/login', { username: 'owner1', password: SECRETS.newPw }, '')).sc?.split(';')[0] || cookie;

  /* ---- 3. every GET answer, the support file, the log ---- */
  const src = fs.readFileSync(path.join(L.APP, 'server.js'), 'utf8');
  const gets = [...new Set([...src.matchAll(/app\.get\(\s*'(\/api\/[^']+)'/g)].map((m) => m[1].replace(/:([A-Za-z]+)(\([^)]*\))?/g, (_, n, re) => (re ? re.slice(1, -1).split('|')[0] : n === 'tab' ? 'weather' : n === 'id' ? 'camera:reolink-1' : 'x1'))))]
    .filter((p) => !/\/(events|stream|live|ws|mjpeg|hls|video|speedtest)(\/|$)|\/api\/seal\/key/.test(p));
  const leaks = [];
  for (let i = 0; i < gets.length; i += 8) {
    await Promise.all(gets.slice(i, i + 8).map(async (p) => {
      try { const r = await fetch(B + p, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(12000) }); const t = Buffer.from(await r.arrayBuffer()).toString('latin1'); const f = found(t); if (f.length) leaks.push(`${p}: ${f.join(',')}`); } catch { /* slow or streaming: skipped */ }
    }));
  }
  check(`no GET answer holds a password or key (${gets.length} routes)`, !leaks.length, leaks.join(' | '));
  const sup = await req('GET', '/api/support/bundle');
  check('the support file holds no password or key', sup.s === 200 && !found(sup.text).length, `HTTP ${sup.s} ${found(sup.text)}`);
  const sett = await req('GET', '/api/settings');
  check('Settings shows that an AI key is saved, not the key', sett.j?.ai?.hasKey === true && !found(sett.text).length);
  const log = await req('GET', '/api/system/log');
  check('Settings › Log holds no password or key', !found(log.text).length, found(log.text).join(', '));
  await new Promise((r) => setTimeout(r, 500));
  const plog = fs.readFileSync(s.child.logFile, 'utf8');
  check('CasaTorch\'s own output (the system log) holds no password or key', !found(plog).length, found(plog).map((k) => hitsIn(plog, SECRETS[k])[0]).join(' | '));

  /* ---- 4. the data folder ---- */
  const files = [], walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) files.push(p); } };
  walk(DATA);
  const inFiles = files.flatMap((f) => { const t = fs.readFileSync(f).toString('latin1'); return found(t).map((k) => `${path.relative(DATA, f)}: ${k}`); });
  check(`no file in the data folder holds a password or key readable (${files.length} files)`, !inFiles.length, inFiles.join(' | '));
  const cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8'));
  check('config.json: every secret is sealed and bound to its field (v2)', [cfg.homeAssistant?.token, cfg.ai?.apiKey, ...(cfg.cameras || []).map((c) => c.password), ...(cfg.network?.sources || []).map((x) => x.secret), cfg.network?.dns?.key].filter(Boolean).every((v) => /^v2\./.test(v)), JSON.stringify(cfg).slice(0, 200));
  check('the Meraki key typed in setup became a Network source, sealed', (cfg.network?.sources || []).some((x) => x.kind === 'meraki' && /^v2\./.test(x.secret || '')) && !cfg.network?.meraki, JSON.stringify(cfg.network || {}).slice(0, 200));
  if (process.platform !== 'win32') {
    check('the key file is owner-only (0600)', (fs.statSync(path.join(DATA, 'secret.key')).mode & 0o777) === 0o600);
    check('the data folder is owner-only (0700)', (fs.statSync(DATA).mode & 0o777) === 0o700);
  }

  /* ---- 5. what CasaTorch sent to the services ---- */
  const sent = `${haRec.text()}\n${fakeRec.text()}`;
  const wrong = [];
  for (const [k, v] of Object.entries(SECRETS)) {
    for (const line of hitsIn(sent, v)) if (!(ALLOWED[k] || []).some((re) => re.test(line))) wrong.push(`${k}: ${line.slice(0, 120)}`);
  }
  check('secrets reached their own services only in the header (or sign-in body) each one reads', !wrong.length, wrong.join(' | '));
  check('the services got the keys (so the check above really saw them)', sent.includes(SECRETS.haToken) && sent.includes(SECRETS.aiKey2) && sent.includes(SECRETS.unifiKey));
  const urls = sent.split(/\r?\n/).filter((l) => /^(GET|POST|PUT|DELETE|PATCH|HEAD) /.test(l));
  check('no secret was ever in an address sent to a service', !urls.some((l) => found(l).length), urls.filter((l) => found(l).length).join(' | '));
  check('Reolink: pictures asked for with the camera\'s session token, not the password', urls.some((l) => /cmd=Snap.*token=reolink-session-1/.test(l)) && !urls.some((l) => /password=/.test(l)), urls.filter((l) => /cgi-bin/.test(l)).join(' | '));
  haRec.close(); fakeRec.close(); fake.close();
  await browser.close(); browser = null;
  finish();
} catch (e) { if (browser) await browser.close().catch(() => {}); finish(e); }
