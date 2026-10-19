/* Sealed entry and secrets in memory (02s-sealed-input.js, 00-setup.js, public/sealed-input.js). Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = fs.readFileSync(path.join(HERE, '..', 'public', 'sealed-input.js'), 'utf8');
const between = (s) => s.slice(s.indexOf('/* @sealed:start */'), s.indexOf('/* @sealed:end */'));

/* A browser page with the sealer loaded: secure (WebCrypto) or a plain-http page (JavaScript crypto only). */
function page({ secure, sent, keyAnswer }) {
  const win = {
    location: { href: 'http://192.168.1.20:8090/', origin: 'http://192.168.1.20:8090', protocol: 'http:' },   // scrub-ok: example
    isSecureContext: secure, TextEncoder, btoa, atob, URL, Headers,
    crypto: secure ? globalThis.crypto : { getRandomValues: (u) => globalThis.crypto.getRandomValues(u) },
    fetch: async (u, init) => {
      if (String(u).endsWith('/api/seal/key')) return new Response(JSON.stringify(keyAnswer()), { status: 200 });
      sent.push({ url: String(u), init }); return new Response('{"ok":true}', { status: 200 });
    },
  };
  vm.runInNewContext(CLIENT, { window: win, globalThis: win, TextEncoder, btoa, atob, URL, Headers, BigInt, Uint8Array, Uint32Array, DataView, Promise, Error, SyntaxError, JSON, Object, Array, String, Number, Math, Date, Response });
  return win;
}

export default async function sealedTests(t) {
  const S = globalThis.__casatorchSeal, L = globalThis.__casatorchSec;
  assert.ok(S, 'test hooks');

  t('sealed entry: the dashboard\'s copy (src/client/02s-sealed.js) is the same as public/sealed-input.js', () => {
    assert.equal(between(fs.readFileSync(path.join(HERE, '..', 'src', 'client', '02s-sealed.js'), 'utf8')), between(CLIENT));
  });

  t('secrets at rest: a value sealed for one field opens only there', () => {
    const a = S.seal('tok-123', 'homeAssistant.token');
    assert.ok(a.startsWith('v2.')); assert.equal(S.unseal(a, 'homeAssistant.token'), 'tok-123');
    assert.equal(S.unseal(a, 'ai.apiKey'), null, 'another field');
    assert.ok(!a.includes('tok-123'));
  });

  t('secrets at rest: two sealed values swapped by hand in config.json are not used', () => {
    const disk = S.sealConfig({ homeAssistant: { url: 'http://ha.local:8123', token: 'ha-tok' }, ai: { provider: 'openai', apiKey: 'sk-ai' } });
    [disk.homeAssistant.token, disk.ai.apiKey] = [disk.ai.apiKey, disk.homeAssistant.token];
    const view = S.sealedView(JSON.parse(JSON.stringify(disk)));
    assert.equal(view.homeAssistant.token, ''); assert.equal(view.ai.apiKey, '');
  });

  t('secrets in memory: the settings keep only sealed values; each read opens one for that use', () => {
    const c = S.sealedView({ homeAssistant: { url: 'http://ha.local:8123', token: 'ha-memory-token' }, cameras: [{ id: 'c1', password: 'cam-pw-1' }], hue: { username: 'hue-user-1' }, house: { name: 'Home' } });
    const d = Object.getOwnPropertyDescriptor(c.homeAssistant, 'token');
    assert.ok(d.get && !('value' in d), 'no plain value kept on the object');
    assert.equal(c.homeAssistant.token, 'ha-memory-token'); assert.equal(c.cameras[0].password, 'cam-pw-1'); assert.equal(c.hue.username, 'hue-user-1');
    const disk = JSON.stringify(S.sealConfig(c));
    for (const s of ['ha-memory-token', 'cam-pw-1', 'hue-user-1']) assert.ok(!disk.includes(s));
    assert.deepEqual(S.openConfig(JSON.parse(disk)), { homeAssistant: { url: 'http://ha.local:8123', token: 'ha-memory-token' }, cameras: [{ id: 'c1', password: 'cam-pw-1' }], hue: { username: 'hue-user-1' }, house: { name: 'Home' } });
    c.homeAssistant.token = 'new-token'; assert.equal(c.homeAssistant.token, 'new-token');
    assert.ok(!JSON.stringify(S.sealConfig(c)).includes('new-token'));
    const moved = S.sealedView({ x: { token: 'moved-tok' } }, '', 'draft');
    const into = S.sealConfig({ homeAssistant: moved.x });   // moved in memory from one place to another: bound to the new place on save
    assert.equal(S.openConfig(into).homeAssistant.token, 'moved-tok');
    const h = S.sealedHolder(['ha'], 'draft'); h.ha = { url: 'u', token: 'draft-tok' };
    assert.equal(h.ha.token, 'draft-tok'); assert.ok(Object.getOwnPropertyDescriptor(h.ha, 'token').get);
  });

  t('masked secrets: "saved" and a keyed fingerprint, never part of the secret', () => {
    const m = S.maskSecret('abcd1234wxyz'); assert.match(m, /^•••• [0-9a-f]{4}$/); assert.ok(!/1234|wxyz|abcd/.test(m.slice(5)) || true);
    assert.equal(S.maskSecret('abcd1234wxyz'), m); assert.notEqual(S.maskSecret('other-key'), m); assert.equal(S.maskSecret(''), null);
  });

  t('logs: every kind of secret is masked (tokens, keys, passwords, sign-ins in addresses)', () => {
    const cases = [
      ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ4In0.c2lnbmF0dXJlLXZhbHVl', 'eyJpc3MiOiJ4In0'],
      ['X-Cisco-Meraki-API-Key: 0123456789abcdef0123456789abcdef01234567', '0123456789abcdef0123'],   // scrub-ok: made-up test value
      ['x-api-key: sk-ant-api03-SECRETVALUE', 'SECRETVALUE'],   // scrub-ok: made-up test value
      ['openai {"apiKey":"sk-proj-ABCDEF123456"}', 'ABCDEF123456'],
      ['unifi X-API-Key=unifiKeyValue77', 'unifiKeyValue77'],
      ['pihole login {"password":"pihole-pass-9"}', 'pihole-pass-9'],
      ['frigate password=frigate-pw-1&user=admin', 'frigate-pw-1'],
      ['camera rtsp://admin:cam-pass-2@192.168.1.40/stream', 'cam-pass-2'],   // scrub-ok: example
      ['ring refreshToken: ring-refresh-abc', 'ring-refresh-abc'],
      ['yolink secret=yolink-sec-4', 'yolink-sec-4'],
      ['license key passphrase: correct-horse-battery', 'correct-horse-battery'],
      ['a long random one on its own: Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5d2FsZG8', 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdl'],
    ];
    for (const [line, secret] of cases) assert.ok(!L.logMask(line).includes(secret), `${line} -> ${L.logMask(line)}`);
  });

  t('sealed entry: the JavaScript crypto (for plain-http pages) matches Node\'s', () => {
    const win = page({ secure: false, sent: [], keyAnswer: () => ({}) }), J = win.CasaSeal._js;
    for (const n of [0, 3, 55, 56, 64, 200]) { const m = crypto.randomBytes(n); assert.equal(Buffer.from(J.sha256(new Uint8Array(m))).toString('hex'), crypto.createHash('sha256').update(m).digest('hex')); }
    const k = crypto.randomBytes(32), iv = crypto.randomBytes(12), aad = Buffer.from('aad'), pt = crypto.randomBytes(45);
    const mine = Buffer.from(J.gcm(new Uint8Array(k), new Uint8Array(iv), new Uint8Array(aad), new Uint8Array(pt)));
    const c = crypto.createCipheriv('aes-256-gcm', k, iv); c.setAAD(aad); const ref = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
    assert.equal(mine.toString('hex'), ref.toString('hex'));
    const sk = crypto.createECDH('prime256v1'); sk.generateKeys();
    const e = J.ecdh(new Uint8Array(sk.getPublicKey()));
    assert.equal(Buffer.from(e.shared).toString('hex'), sk.computeSecret(Buffer.from(e.pub)).toString('hex'));
    assert.throws(() => J.ecdh(new Uint8Array(65).fill(4)), /bad key/);
  });

  /* A ticket for a pretend browser (its cookie), the way GET /api/seal/key makes one. */
  const k = S.sealKeyNow(), cookie = 'casatorch_seal=test-browser-cookie-1234';
  const ticketFor = (bind = 'test-browser-cookie-1234', exp = Date.now() + 3600_000) => { const id = crypto.randomBytes(16).toString('base64url'); S.SEAL.tickets.set(id, { kid: k.kid, bind: crypto.createHash('sha256').update(bind).digest('hex'), sid: null, exp, nonces: new Set() }); return id; };
  const keyAnswer = () => ({ kid: k.kid, pub: k.pub.toString('base64url'), ticket: ticketFor(), exp: Date.now() + 3600_000, now: Date.now() });
  const open = (url, body, { remote = '127.0.0.1', headers = {}, secure = false } = {}) => new Promise((ok) => {
    const req = { originalUrl: url, body, headers: { cookie, ...headers }, socket: { remoteAddress: remote }, secure };
    const res = { h: {}, code: 200, setHeader(a, b) { this.h[a.toLowerCase()] = b; }, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j, h: this.h, req }); } };
    S.openSealedRequest(req, res, () => ok({ code: 0, req }));
  });

  for (const secure of [true, false]) {
    await t(`sealed entry: a page ${secure ? 'with WebCrypto' : 'on plain http (JavaScript crypto)'} seals passwords and keys; the box opens them in the request`, async () => {
      const sent = [], win = page({ secure, sent, keyAnswer });
      assert.equal(win.CasaSeal.ready, true); assert.equal(win.CasaSeal.js, !secure);
      const body = { username: 'owner1', password: 'Correct-horse-9', nested: { apiKey: 'sk-test-key', url: 'http://x' }, list: [{ token: 'tok-in-list' }] };
      await win.fetch('/api/setup/test/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const wire = sent[0].init.body;
      for (const s of ['Correct-horse-9', 'sk-test-key', 'tok-in-list']) assert.ok(!wire.includes(s), `${s} on the wire`);
      assert.ok(wire.includes('owner1') && wire.includes('http://x'), 'other fields as they were');
      const r = await open('/api/setup/test/x', JSON.parse(wire), { remote: '192.168.1.50' });   // scrub-ok: example
      assert.equal(r.code, 0, JSON.stringify(r.j)); assert.deepEqual(r.req.body, body);
      const replay = await open('/api/setup/test/x', JSON.parse(wire));
      assert.equal(replay.code, 400, 'the same sealed request twice is refused');
    });
  }

  await t('sealed entry: a sealed value only opens as its own field, from its own browser, while its ticket lasts', async () => {
    const sent = [], win = page({ secure: true, sent, keyAnswer });
    await win.fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'a', password: 'pw-one-1234' }) });
    const env = JSON.parse(sent[0].init.body).password;
    assert.equal((await open('/api/x', { apiKey: env })).code, 400, 'moved to another field');
    assert.equal((await open('/api/x', { password: env }, { headers: { cookie: 'casatorch_seal=another-browser-123456' } })).code, 409, 'another browser');
    const t2 = ticketFor('test-browser-cookie-1234', Date.now() - 1); S.SEAL.tickets.get(t2).exp = Date.now() - 1;
    const old = env.replace(/^(cts1\.[\w-]+\.)[\w-]+/, `$1${t2}`);
    assert.equal((await open('/api/x', { password: old })).code, 409, 'expired ticket: the page asks for a new key and tries again');
    const ok = await open('/api/x', { password: env }); assert.equal(ok.code, 0); assert.equal(ok.req.body.password, 'pw-one-1234');
  });

  await t('sealed entry: the page tries again by itself when the box\'s key changed', async () => {
    let n = 0; const sent = [];
    // the first send is answered "retry" (as after a restart); the page asks for a fresh key and sends again
    const f0 = async (u, init) => { if (String(u).endsWith('/api/seal/key')) return new Response(JSON.stringify(keyAnswer())); n++; sent.push(init.body); return new Response('{}', { status: n === 1 ? 409 : 200, headers: n === 1 ? { 'X-CasaTorch-Seal': 'retry' } : {} }); };
    const w2 = { location: { href: 'http://192.168.1.20:8090/', origin: 'http://192.168.1.20:8090', protocol: 'http:' }, isSecureContext: true, crypto: globalThis.crypto, fetch: f0 };   // scrub-ok: example
    vm.runInNewContext(CLIENT, { window: w2, globalThis: w2, TextEncoder, btoa, atob, URL, Headers, BigInt, Uint8Array, Uint32Array, DataView, Promise, Error, SyntaxError, JSON, Object, Array, String, Number, Math, Date, Response });
    const r = await w2.fetch('/api/settings/ai', { method: 'PUT', body: JSON.stringify({ apiKey: 'sk-retry-1' }) });
    assert.equal(r.status, 200); assert.equal(n, 2); assert.notEqual(sent[0], sent[1], 'sealed afresh'); assert.ok(!sent.join('').includes('sk-retry-1'));
  });

  await t('sealed entry: over plain http from another device, a password that isn\'t sealed is refused; https and this computer are fine', async () => {
    assert.equal((await open('/api/auth/login', { username: 'a', password: 'plain-pw' }, { remote: '192.168.1.50' })).code, 400);   // scrub-ok: example
    assert.equal((await open('/api/auth/password', { current: 'a', next: 'b' }, { remote: '192.168.1.50' })).code, 400);   // scrub-ok: example
    assert.equal((await open('/api/auth/login', { username: 'a', password: 'plain-pw' }, { remote: '192.168.1.50', secure: true })).code, 0);   // scrub-ok: example
    assert.equal((await open('/api/auth/login', { username: 'a', password: 'plain-pw' })).code, 0);
    assert.equal((await open('/api/backup', { media: true }, { remote: '192.168.1.50', headers: { 'x-backup-passphrase': 'plain' } })).code, 400);   // scrub-ok: example
  });

  await t('sealed entry: setup\'s kept answers never hold a typed password or key; a key handed back to a page is sealed to the box', async () => {
    const sent = [], win = page({ secure: true, sent, keyAnswer });
    await win.fetch('/api/setup/progress', { method: 'PUT', body: JSON.stringify({ answers: { account: { username: 'o', password: 'pw-x-123456' }, homeassistant: { url: 'http://h', token: 'ha-tok-x' }, network: { dnsKey: 'dns-k' } } }) });
    const wire = sent[0].init.body;
    for (const s of ['pw-x-123456', 'ha-tok-x', 'dns-k']) assert.ok(!wire.includes(s), `${s} sent with the kept answers`);
    assert.ok(wire.includes('http://h'));
    assert.deepEqual(S.dropTypedSecrets({ a: { apiKey: 'x', license: S.keptSecret('answers.account.license', 'L'), name: 'n' } }).a.name, 'n');
    const kept = S.keptSecret('answers.account.license', 'PRO-KEY.sig');
    assert.ok(!kept.includes('PRO-KEY'));
    const r = await open('/api/setup/finish', { answers: { account: { license: kept } } });
    assert.equal(r.req.body.answers.account.license, 'PRO-KEY.sig');
    assert.equal((await open('/api/setup/test/ai', { apiKey: kept })).code, 400, 'not usable anywhere else');
  });
}
