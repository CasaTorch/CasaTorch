/* Unit tests for the edge gate on the box (src/server/42g-edge-gate.js): the tickets it signs (the same format casatorch.com's
   Worker checks, edge-gate/src/ticket.js), the phones' run of tickets, checking its own tickets, where a request comes
   from, the box-side lock and allowed countries, sign-in alerts for that person and the owners only, and that every text
   it shows is translated. Run from test/unit.mjs (which loads server.js first, CASATORCH_TEST=1). */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

export default async function gateUnit(t) {
  const G = globalThis.__casatorchGate, RM = globalThis.__casatorchRemote, Z = globalThis.__casatorchSec, A = globalThis.__casatorchAlerts;
  if (!G || !RM) { console.log('skip gate-unit'); return; }
  const HOST = 'home-abcd2345.casatorch.com';
  const undo = RM.patchConfig({ remote: { on: true, hostname: HOST, token: 'x', secret: 's' } });
  const events = [...A.alerts.events];   // the alerts these tests raise are taken back afterwards (and off the disk)
  const pubKey = () => crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(Z.relayKey().pub, 'base64')]), format: 'der', type: 'spki' });
  const parse = (tk) => { const [v, p, s] = tk.split('.'); return { v, p: JSON.parse(Buffer.from(p, 'base64url')), ok: crypto.verify(null, Buffer.from(`${v}.${p}`), pubKey(), Buffer.from(s, 'base64url')) }; };
  const tunnelReq = (extra = {}) => ({ method: 'GET', path: '/', socket: { remoteAddress: '127.0.0.1' }, headers: { host: HOST, 'cf-connecting-ip': '198.51.100.20', 'cf-ray': 'x', ...extra } });
  try {
    t('edge gate: a ticket is ct1.<payload>.<Ed25519 signature by the box key> for this exact address, at most 12 hours', () => {
      const tk = G.gateMake({ d: 'dev12345', k: 'app', nbf: 1000, exp: 1000 + 3600 });
      assert.match(tk, /^ct1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/);
      const x = parse(tk); assert.equal(x.ok, true, 'signed with the relay key (the key casatorch.com knows)');
      assert.deepEqual(Object.keys(x.p), ['h', 'd', 'k', 'e', 'nbf', 'exp']); assert.equal(x.p.h, HOST); assert.equal(x.p.e, G.gateState().epoch);
      const self = parse(G.gateSelfTicket()); assert.equal(self.p.k, 'self'); assert.equal(self.p.d, 'box'); assert.ok(self.p.exp - self.p.nbf <= 11 * 60);
      const b = G.gateBrowserTicket('bdevice1'); assert.equal(parse(b.t).p.exp - parse(b.t).p.nbf, 12 * 3600);
    });
    t('edge gate: a phone gets a week of overlapping 12-hour tickets, so it gets in after days away', () => {
      const now = Math.floor(Date.now() / 1000), list = G.gateAppTickets('sess1234', now);
      assert.equal(list.length, 16);
      for (const [i, x] of list.entries()) {
        const p = parse(x.t).p; assert.equal(p.k, 'app'); assert.equal(p.d, 'sess1234'); assert.equal(p.exp - p.nbf, 12 * 3600); assert.equal(x.nbf, p.nbf); assert.equal(x.exp, p.exp);
        if (i) assert.ok(p.nbf < list[i - 1].exp - 3000, 'each starts an hour before the last one ends');
      }
      assert.ok(list.at(-1).exp - now >= 7 * 86400, 'covers at least a week');
    });
    t('edge gate: the box checks its own tickets strictly (signature, address, window, epoch, revoked list)', () => {
      const now = Math.floor(Date.now() / 1000), ok = G.gateBrowserTicket('bdevice2', now).t;
      assert.equal(G.gateCheckOwn(ok, now).d, 'bdevice2');
      const [v, p, s] = ok.split('.'), q = JSON.parse(Buffer.from(p, 'base64url')); q.d = 'other123';
      assert.equal(G.gateCheckOwn(`${v}.${Buffer.from(JSON.stringify(q)).toString('base64url')}.${s}`, now), null, 'changed payload');
      assert.equal(G.gateCheckOwn(ok, now + 13 * 3600), null, 'expired');
      assert.equal(G.gateCheckOwn(ok, now - 3600), null, 'not yet valid');
      assert.equal(G.gateCheckOwn(G.gateMake({ d: 'x123', k: 'app', nbf: now, exp: now + 13 * 3600 }), now), null, 'longer than 12 hours');
      const st = G.gateState(), was = st.epoch; st.epoch += 1;
      try { assert.equal(G.gateCheckOwn(ok, now), null, 'an older epoch'); } finally { st.epoch = was; }
      st.revoked.push({ d: 'bdevice2', until: Date.now() + 60_000 });
      try { assert.equal(G.gateCheckOwn(ok, now), null, 'revoked'); } finally { st.revoked = st.revoked.filter((r) => r.d !== 'bdevice2'); }
      const undo2 = RM.patchConfig({ remote: { on: true, hostname: 'home-zzzz9999.casatorch.com' } });
      try { assert.equal(G.gateCheckOwn(ok, now), null, 'another address'); } finally { undo2(); }
      assert.equal(G.gateCheckOwn('ct1.x.y'), null); assert.equal(G.gateCheckOwn(null), null);
    });
    t('edge gate: where a request comes from - at home, or the city and country Cloudflare saw', () => {
      assert.deepEqual(G.gateWhere({ socket: { remoteAddress: '192.168.1.30' }, headers: { host: '192.168.1.20:8090' } }), { home: true });   // scrub-ok: example addresses
      assert.deepEqual(G.gateWhere(tunnelReq({ 'cf-ipcountry': 'ca', 'cf-ipcity': 'Toronto<script>' })), { home: false, country: 'CA', city: 'Torontoscript' });
      assert.equal(G.gateWhereText({ home: false, country: 'CA', city: 'Toronto' }, 'en'), 'Toronto, Canada');
      assert.equal(G.gateWhereText({ home: false, country: 'DE' }, 'de'), 'Deutschland');
      assert.equal(G.gateWhereText({ home: true }), null);
    });
    t('edge gate: the box refuses too when locked (except the owner unlocking) and outside the allowed countries', () => {
      const st = G.gateState(), keep = { locked: st.locked, countries: st.countries };
      try {
        st.locked = true;
        assert.equal(G.gateBoxRefuse(tunnelReq()), 'locked');
        assert.equal(G.gateBoxRefuse({ ...tunnelReq(), method: 'POST', path: '/api/gate/unlock' }), null);
        assert.equal(G.gateBoxRefuse({ ...tunnelReq(), method: 'GET', path: '/api/gate/unlock' }), 'locked');
        st.locked = false; st.countries = ['US'];
        assert.equal(G.gateBoxRefuse(tunnelReq({ 'cf-ipcountry': 'US' })), null);
        assert.equal(G.gateBoxRefuse(tunnelReq({ 'cf-ipcountry': 'FR' })), 'country');
        assert.equal(G.gateBoxRefuse(tunnelReq()), 'country', 'no country: refused');
      } finally { Object.assign(st, keep); }
    });
    t('sign-in alerts: a new device, from away, and a paired phone - each says who, which device, where and when; for that person and the owners', () => {
      const before = A.alerts.events.length;
      const u = { id: 'u-member', name: 'Sam', username: 'sam', role: 'member' };
      const a = G.gateNotice('paired', tunnelReq({ 'cf-ipcountry': 'US', 'cf-ipcity': 'Austin' }), u, { name: 'Sam phone', platform: 'ios' });
      assert.equal(a.msg, G.GATE_MSG.pairedAway); assert.match(a.title, /^New phone paired: Sam phone \(iPhone\) for Sam, from Austin, United States, /);
      assert.equal(a.forUser, 'u-member'); assert.match(a.id, /^signin:/, 'Security & sign-in alerts'); assert.equal(A.alerts.events.length, before + 1);
      const h = G.gateNotice('new', { socket: { remoteAddress: '192.168.1.30' }, headers: { host: 'x', 'user-agent': 'Mozilla/5.0 (Macintosh; Mac OS X) Safari/605' } }, u, null);   // scrub-ok: example address
      assert.match(h.title, /^New sign-in on a new device: Sam on Safari on Mac, at home, /);
      assert.equal(G.alertForReq(a, { user: { id: 'u-member', role: 'member' } }, true), true);
      assert.equal(G.alertForReq(a, { user: { id: 'u-other', role: 'member' } }, true), false, 'another member doesn\'t see it');
      assert.equal(G.alertForReq(a, { user: { id: 'u-own', role: 'owner' } }, true), true, 'the owner sees all');
      assert.equal(G.alertForReq({ id: 'leak:x' }, { user: { id: 'u-other', role: 'viewer' } }, true), true, 'household alerts are unchanged');
      assert.equal(G.alertForTarget(a, { user: 'u-other' }), false); assert.equal(G.alertForTarget(a, { user: 'u-member' }), true); assert.equal(G.alertForTarget(a, { user: null, type: 'ha' }), false, 'not the shared Home Assistant phone');
    });
    t('sign-in alerts: a browser seen before is quiet at home, but every sign-in from away says so', () => {
      const u = { id: 'u-quiet', name: 'Kim', username: 'kim', role: 'member', seenDevices: [] }, cookies = [];
      const res = { append: (k, v) => cookies.push(v) };
      const n0 = A.alerts.events.length;
      G.gateSignedIn({ socket: { remoteAddress: '192.168.1.31' }, headers: { host: 'x' } }, res, u, { kind: 'browser' });   // scrub-ok: example address
      assert.equal(A.alerts.events.length, n0 + 1, 'new device'); assert.match(cookies[0], /^casatorch_device=[\w-]+; Path=\/; HttpOnly; SameSite=Lax/);
      const dc = /casatorch_device=([\w-]+)/.exec(cookies[0])[1];
      G.gateSignedIn({ socket: { remoteAddress: '192.168.1.31' }, headers: { host: 'x', cookie: `casatorch_device=${dc}` } }, res, u, { kind: 'browser' });   // scrub-ok: example address
      assert.equal(A.alerts.events.length, n0 + 1, 'the same browser at home: no alert');
      G.gateSignedIn(tunnelReq({ cookie: `casatorch_device=${dc}`, 'cf-ipcountry': 'US' }), res, u, { kind: 'browser' });
      assert.equal(A.alerts.events.length, n0 + 2); assert.match(A.alerts.events[0].title, /^Sign-in from away: Kim/);
      G.gateSignedIn({ headers: {} }, null, u, { kind: 'panel' }); assert.equal(A.alerts.events.length, n0 + 2, 'wall panels: none');
    });
    t('edge gate: tickets never go to a log or the audit log; every text it shows is translated (tools/i18n-strings.tsv)', () => {
      const src = fs.readFileSync(new URL('../src/server/42g-edge-gate.js', import.meta.url), 'utf8');
      assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*(ticket|\bt\b|gateMake)/);
      for (const m of src.matchAll(/audit\(req, '[\w-]+'(?:, \{([^}]*)\})?\)/g)) assert.doesNotMatch(m[1] || '', /ticket|\bt:|tok/, m[0]);
      const rows = new Map(fs.readFileSync(new URL('../../tools/i18n-strings.tsv', import.meta.url), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => { const c = l.split('\t'); return [c[0], c]; }));
      const texts = [...Object.values(G.GATE_MSG), 'Not you? Open Settings › Devices & sessions and sign it out.', 'Remote access is locked', 'Nobody can reach this CasaTorch from outside until you unlock it, here at home or from the CasaTorch app.',
        'Remote access to this CasaTorch is locked. The owner can unlock it at home or from the CasaTorch app.', 'This CasaTorch doesn\'t answer from where you are right now.', 'Edge gate', 'Edge gate not active yet: {why}', 'On. Remote access is locked.',
        'Edge gate not active yet: this CasaTorch\'s key is registered, but its address still answers devices without a ticket.', 'On: only approved devices reach this CasaTorch from outside.', 'On. The next self-test checks the address is closed to other devices.',
        'Edge gate not active yet. Secure Remote Access works as before; the gate turns on by itself once casatorch.com has this CasaTorch\'s key.'];
      for (const m of src.matchAll(/res\.status\(\d+\)\.json\(\{ error: '((?:[^'\\]|\\.)*)'/g)) texts.push(m[1].replace(/\\'/g, '\''));
      const client = fs.readFileSync(new URL('../src/client/31d-devices.js', import.meta.url), 'utf8');
      for (const m of client.matchAll(/T\('((?:[^'\\]|\\.)*)'/g)) texts.push(m[1].replace(/\\'/g, '\''));
      for (const x of texts) { const r = rows.get(x); assert.ok(r, `not in i18n-strings.tsv: ${x}`); assert.equal(r.length, 14, x); assert.ok(r.every(Boolean), x); }
      assert.ok(texts.length > 60, String(texts.length));
    });
    await t('edge gate: when casatorch.com already has a higher epoch (this box lost its record: a restore, a new key), the box takes it on', async () => {
      const st = G.gateState(), keep = { epoch: st.epoch, v: st.v, synced: st.synced, registered: st.registered }, realFetch = globalThis.fetch, sent = [];
      globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, active: true, epoch: keep.epoch + 5, graceUntil: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
      try {
        const r = await G.gateSync(); assert.equal(r.ok, true);
        assert.equal(sent[0].state.epoch, keep.epoch);
        assert.equal(st.epoch, keep.epoch + 5, 'the epoch in place at the edge');
        assert.equal(parse(G.gateBrowserTicket('bdevice7').t).p.e, keep.epoch + 5, 'new tickets carry it, so the edge takes them');
        globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, active: true, epoch: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        await G.gateSync(); assert.equal(st.epoch, keep.epoch + 5, 'never lowered by an answer');
      } finally { globalThis.fetch = realFetch; Object.assign(st, keep); }
    });
    t('edge gate: remoteView says when remote access is locked; the tunnel request says the box knows the gate', () => {
      const v = RM.remoteView({ on: true, state: 'connected', check: { ok: true }, locked: true });
      assert.equal(v.status, 'locked'); assert.equal(v.title, 'Remote access is locked');
      assert.equal(RM.remoteRequestBody({ house: {} }).gate, true);
    });
  } finally {
    undo();
    A.alerts.events.splice(0, A.alerts.events.length, ...events);
    try { fs.rmSync(`${process.env.CASATORCH_DATA_DIR}/alerts.json`, { force: true }); } catch { /* fine */ }
  }
}
