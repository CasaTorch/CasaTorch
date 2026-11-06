/* Unit tests for each person's inbox (src/server/40i-inbox.js, src/client/37n-inbox.js): it's the alerts' own history as
   that person's rules show it in the app (no second alert system), read and cleared per person, with a link to where
   it happened, and sealed at rest. Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export default async function inboxTests(t) {
  const I = globalThis.__casatorchInbox, H = globalThis.__casatorch;
  const ev = (id, mins, extra = {}) => ({ id, at: new Date(Date.parse('2026-11-05T12:00:00Z') - mins * 60_000).toISOString(), title: id, severity: 'notice', ...extra });
  const events = [ev('ring:cam1:doorbell:1', 1, { kind: 'doorbell' }), ev('leak:ha:binary_sensor.sink:2026-11-05T11:58:00.000Z', 2, { severity: 'critical' }), ev('battery:ha:sensor.door', 3), ev('newdev:aa', 4)];
  const decide = (hide = []) => (a) => { const kind = a.kind || (a.id.startsWith('leak:') ? 'water' : a.id.startsWith('battery:') ? 'battery' : a.id.startsWith('newdev:') ? 'security' : 'other'); const safety = kind === 'water'; return { kind, safety, app: safety || !hide.includes(kind), panel: 'show', device: a.id.startsWith('battery:') ? 'ha:sensor.door' : null }; };

  t('inbox: the alerts this person sees in the app (their rules hide motion or batteries; safety always stays)', () => {
    const all = I.inboxView(events, { read: [], cleared: [] }, { decide: decide() });
    assert.equal(all.items.length, 4); assert.equal(all.unread, 4);
    const mine = I.inboxView(events, { read: [], cleared: [] }, { decide: decide(['battery', 'water']) });
    assert.deepEqual(mine.items.map((x) => x.kind), ['doorbell', 'water', 'security'], 'battery hidden by their rule; water is safety');
    const panel = I.inboxView(events, {}, { panel: true, decide: (a) => ({ ...decide()(a), panel: a.id.startsWith('newdev') ? 'off' : 'show' }) });
    assert.equal(panel.items.length, 3);
  });

  t('inbox: read, all read and cleared are per person', () => {
    const a = { read: ['battery:ha:sensor.door'], cleared: ['newdev:aa'] }, b = { read: [], cleared: [] };
    const va = I.inboxView(events, a, { decide: decide() }), vb = I.inboxView(events, b, { decide: decide() });
    assert.equal(va.items.length, 3); assert.equal(va.unread, 2); assert.equal(vb.items.length, 4); assert.equal(vb.unread, 4);
    const all = I.inboxView(events, { readAt: '2026-11-05T11:58:30.000Z' }, { decide: decide() });
    assert.deepEqual(all.items.filter((x) => !x.read).map((x) => x.kind), ['doorbell'], 'only what came after "Mark all read" is new');
    assert.equal(I.inboxView(events, { clearedAt: '2026-11-05T11:58:30.000Z' }, { decide: decide() }).items.length, 1);
  });

  t('inbox: each item links to where it happened', () => {
    assert.equal(I.inboxLink({ url: '/#timeline' }, 'doorbell'), '#timeline');
    assert.equal(I.inboxLink({}, 'motion'), '#timeline');
    assert.equal(I.inboxLink({}, 'battery', 'ha:sensor.door'), '#alerts?dev=ha%3Asensor.door');
    assert.equal(I.inboxLink({}, 'security'), '#security'); assert.equal(I.inboxLink({}, 'network'), '#network'); assert.equal(I.inboxLink({}, 'other'), '#alerts');
    assert.equal(I.inboxLink({ url: 'https://evil.example/#x' }, 'other'), '#alerts', 'only links inside CasaTorch');
    assert.equal(I.inboxLink({ url: '/#x"><img' }, 'other'), '#alerts');
  });

  const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
  const B = `http://127.0.0.1:${srv.address().port}`;
  // POSTs wait for setup on a fresh box (the pre-setup gate): the same action, for the same person ('local')
  const post = async (p, b) => { I.inboxAct('local', p.split('/').pop(), b); return (await fetch(`${B}/api/inbox`)).json(); };
  try {
    await t('inbox: the API reads the alert history; mark read, all read, clear; kept sealed', async () => {
      const A = globalThis.__casatorchAlerts.alerts;
      Object.assign(I.inboxUser('local'), { readAt: null, read: [], clearedAt: null, cleared: [] });   // a fresh start (the data folder outlives a run)
      const d0 = await (await fetch(`${B}/api/inbox`)).json();
      assert.ok(Array.isArray(d0.items)); assert.equal(typeof d0.unread, 'number');
      {
        const keep = A.events; A.events = [{ id: 'internet:2026-11-05T11:00:00.000Z', at: new Date(Date.now() - 60_000).toISOString(), title: 'The internet is down', severity: 'critical', source: 'internet' }, ...keep];
        try {
          const d = await (await fetch(`${B}/api/inbox`)).json(), it = d.items.find((x) => x.id.startsWith('internet:'));
          assert.ok(it && !it.read); assert.equal(it.link, '#network');
          assert.ok((await post('/api/inbox/read', { ids: [it.id] })).items.find((x) => x.id === it.id).read);
          assert.ok(!(await post('/api/inbox/clear', { ids: [it.id] })).items.some((x) => x.id === it.id));
          assert.equal((await post('/api/inbox/read', { all: true })).unread, 0);
          assert.equal((await post('/api/inbox/clear', { all: true })).items.length, 0);
        } finally { A.events = keep; }
      }
      await new Promise((ok) => setTimeout(ok, 500));
      const raw = fs.readFileSync(path.join(process.env.CASATORCH_DATA_DIR, 'inbox.json'), 'utf8');
      assert.match(raw, /^v2\./); assert.doesNotMatch(raw, /internet|local/);
    });
  } finally { srv.close(); }

  t('inbox: the bell is on every page, its words are translated, and nothing pushes from here', () => {
    const cli = fs.readFileSync(new URL('../src/client/37n-inbox.js', import.meta.url), 'utf8'), srvSrc = fs.readFileSync(new URL('../src/server/40i-inbox.js', import.meta.url), 'utf8');
    assert.match(cli, /top\.insertBefore\(INBOX\.btn, actions\)/);
    assert.doesNotMatch(srvSrc, /notify\(|alertRaise\(|webpush/, 'the inbox never sends anything');
    assert.match(srvSrc, /alertDecide\(/, 'it uses the alert rules');
    const tsv = new Set(fs.readFileSync(new URL('../../tools/i18n-strings.tsv', import.meta.url), 'utf8').split('\n').map((l) => l.split('\t')[0]));
    for (const m of cli.matchAll(/\bT\('((?:[^'\\]|\\.)*)'/g)) assert.ok(tsv.has(m[1].replace(/\\'/g, "'")), m[1]);
  });
}
