/* Unit tests for the event timeline (src/server/72t-timeline.js, src/client/24t-timeline.js): what a Home Assistant
   change means, one event for a flickering sensor, Basic 24 hours and Pro 30 days, the file sealed at rest, and
   Frigate's events merged in with their clips played through CasaTorch (seeking included). Run from test/unit.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export default async function timelineTests(t) {
  const L = globalThis.__casatorchTimeline, H = globalThis.__casatorch, C = globalThis.__casatorchCamLive;
  const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes, last_changed: '2026-11-05T10:00:00.000Z' });

  await t('timeline: Home Assistant doorbell and motion events, motion sensors, locks (and who) and the alarm', () => {
    const ding = L.tlHaEvent(st('event.front_door_ding', '2026-11-05T09:00:00Z', { device_class: 'doorbell', friendly_name: 'Front door Ding' }), st('event.front_door_ding', '2026-11-05T10:00:00Z', { device_class: 'doorbell', friendly_name: 'Front door Ding' }));
    assert.equal(ding.type, 'doorbell'); assert.equal(ding.device, 'ha:event.front_door_ding');
    assert.equal(L.tlHaEvent(st('binary_sensor.hall_motion', 'off', { device_class: 'motion' }), st('binary_sensor.hall_motion', 'on', { device_class: 'motion' })).type, 'motion');
    assert.equal(L.tlHaEvent(st('binary_sensor.hall_motion', 'on', { device_class: 'motion' }), st('binary_sensor.hall_motion', 'off', { device_class: 'motion' })), null, 'motion ending is no event');
    assert.equal(L.tlHaEvent(st('binary_sensor.window', 'off', { device_class: 'window' }), st('binary_sensor.window', 'on', { device_class: 'window' })), null);
    const lock = L.tlHaEvent(st('lock.front_door', 'locked'), st('lock.front_door', 'unlocked', { changed_by: 'Keypad 2' }));
    assert.deepEqual([lock.type, lock.state, lock.person], ['lock', 'unlocked', 'Keypad 2']);
    assert.equal(L.tlHaEvent(st('alarm_control_panel.home', 'armed_away'), st('alarm_control_panel.home', 'triggered')).state, 'triggered');
    assert.equal(L.tlHaEvent(st('alarm_control_panel.home', 'disarmed'), st('alarm_control_panel.home', 'arming')), null, 'on the way is not an event');
    assert.equal(L.tlHaEvent(st('lock.front_door', 'unavailable'), st('lock.front_door', 'locked')), null, 'coming back after a restart is no event');
    assert.equal(L.tlHaEvent(null, st('lock.front_door', 'locked')), null);
    const cams = new Set(['camera.front_door', 'camera.backyard_live_view']);
    assert.equal(L.tlHaCamera('event.front_door_ding', cams), 'camera.front_door');
    assert.equal(L.tlHaCamera('binary_sensor.backyard_motion', cams), 'camera.backyard_live_view');
    assert.equal(L.tlHaCamera('binary_sensor.kitchen_motion', cams), null);
  });

  await t('timeline: a flickering sensor is one event a minute; unknown kinds and fields are dropped', () => {
    const keep = L.TL.list; L.TL.list = []; L.TL.last.clear();
    try {
      const now = Date.now(), ev = { type: 'motion', source: 'ha', device: 'ha:binary_sensor.hall', name: 'Hall', extra: 'x', at: new Date(now).toISOString() };
      assert.ok(L.tlRecord(ev, { now }));
      assert.equal(L.tlRecord(ev, { now: now + 20_000 }), null);
      assert.ok(L.tlRecord(ev, { now: now + 70_000 }));
      assert.equal(L.TL.list.length, 2); assert.ok(!('extra' in L.TL.list[0]));
      assert.equal(L.tlRecord({ type: 'unlock-door' }), null);
      assert.equal(L.tlClean({ type: 'lock', name: 'x'.repeat(500) }).name.length, 80);
    } finally { L.TL.list = keep; L.TL.last.clear(); }
  });

  await t('timeline: filters (kind, camera, person), newest first, and the counts for the chips', () => {
    const now = Date.parse('2026-11-05T12:00:00Z'), ago = (h) => new Date(now - h * 3600_000).toISOString();
    const list = [{ type: 'doorbell', at: ago(1), camera: 'Porch' }, { type: 'detection', at: ago(2), camera: 'Porch', label: 'person', person: 'Alex' }, { type: 'lock', at: ago(3), name: 'Front', person: 'Sam' }, { type: 'motion', at: ago(30), camera: 'Yard' }];
    const all = L.tlView(list, { hours: 24, now });
    assert.deepEqual(all.events.map((e) => e.type), ['doorbell', 'detection', 'lock']);
    assert.deepEqual(all.cameras, ['Porch']); assert.deepEqual(all.people, ['Alex', 'Sam']); assert.equal(all.types.doorbell, 1);
    assert.deepEqual(L.tlView(list, { hours: 24, now, camera: 'Porch', type: 'detection' }).events.map((e) => e.person), ['Alex']);
    assert.equal(L.tlView(list, { hours: 24 * 30, now }).events.length, 4);
  });

  // Frigate stand-in: an event list and a clip that answers ranges
  const clip = Buffer.alloc(5000, 7), seen = [];
  const fr = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); seen.push({ path: u.pathname, range: req.headers.range || null });
    if (u.pathname === '/api/events') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify([{ id: '1730800000.1-abc', camera: 'front_door', label: 'person', sub_label: ['Alex', 0.9], start_time: Date.now() / 1000 - 600, end_time: Date.now() / 1000 - 590, has_clip: true, has_snapshot: true, data: { top_score: 0.88 }, zones: ['porch'] }, { id: '../etc', camera: 'x', label: 'car', start_time: Date.now() / 1000 }])); }
    if (u.pathname === '/api/events/1730800000.1-abc/clip.mp4') {
      res.setHeader('Content-Type', 'video/mp4');
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (m) { const a = Number(m[1]), b = m[2] ? Number(m[2]) : clip.length - 1; res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${clip.length}`, 'Content-Length': b - a + 1 }); return res.end(clip.subarray(a, b + 1)); }
      res.setHeader('Content-Length', clip.length); return res.end(clip);
    }
    res.statusCode = 404; res.end();
  });
  await new Promise((ok) => fr.listen(0, '127.0.0.1', ok));
  const cfg = C.cfg(), was = cfg.cameras;
  cfg.cameras = [{ id: 'fr1', name: 'Front door', type: 'frigate', url: `http://127.0.0.1:${fr.address().port}`, camera: 'front_door' }];
  const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
  const B = `http://127.0.0.1:${srv.address().port}`;
  const keep = L.TL.list; L.TL.list = []; L.TL.last.clear();
  try {
    await t('timeline: Frigate\'s events merged in (person named, odd ids skipped); Basic gets 24 hours whatever it asks', async () => {
      L.tlRecord({ type: 'lock', source: 'ha', name: 'Back door', state: 'locked', at: new Date(Date.now() - 3 * 86400_000).toISOString() }, { now: Date.now() });
      L.tlRecord({ type: 'doorbell', source: 'ring', camera: 'Front door', at: new Date(Date.now() - 60_000).toISOString() });
      const basic = globalThis.__casatorchLicense.patchConfig({ license: undefined, setupAt: '2020-01-01T00:00:00.000Z' });   // Basic: no key, trial long over
      let r, j; try { r = await fetch(`${B}/api/timeline?hours=720`); j = await r.json(); } finally { basic(); }
      assert.equal(r.status, 200); assert.equal(j.pro, false); assert.equal(j.hours, 24); assert.equal(j.maxHours, 24);
      assert.deepEqual(j.events.map((e) => e.type), ['doorbell', 'detection'], 'the 3-day-old lock is Pro only');
      const f = j.events[1];
      assert.deepEqual([f.person, f.camera, f.score, f.clip], ['Alex', 'Front door', 88, '/api/timeline/clip/0/1730800000.1-abc']);
      assert.match(seen.find((x) => x.path === '/api/events').path, /events/);
      assert.deepEqual(j.people, ['Alex']);
      {
        const p = await (await fetch(`${B}/api/timeline?hours=720`)).json();
        if (p.pro) { assert.equal(p.hours, 720); assert.ok(p.events.some((e) => e.type === 'lock'), 'Pro sees 30 days'); }
      }
      const only = await (await fetch(`${B}/api/timeline?type=doorbell&person=${encodeURIComponent('<b>')}`)).json();
      assert.equal(only.events.length, 0); assert.equal(only.filters.person, '<b>');
    });
    await t('timeline: a Frigate clip plays through CasaTorch, seeking included; a made-up id gets nothing', async () => {
      const full = await fetch(`${B}/api/timeline/clip/0/1730800000.1-abc`);
      assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/mp4'); assert.equal((await full.arrayBuffer()).byteLength, 5000);
      const part = await fetch(`${B}/api/timeline/clip/0/1730800000.1-abc`, { headers: { Range: 'bytes=100-199' } });
      assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 100-199/5000'); assert.equal((await part.arrayBuffer()).byteLength, 100);
      assert.equal((await fetch(`${B}/api/timeline/clip/0/..%2Fetc`)).status, 404);
      assert.equal((await fetch(`${B}/api/timeline/clip/5/1730800000.1-abc`)).status, 404);
      assert.equal((await fetch(`${B}/api/timeline/snap/nope`)).status, 404);
    });
    await t('timeline: kept sealed on disk (no names or places in the file)', async () => {
      await new Promise((ok) => setTimeout(ok, 1800));
      const file = path.join(process.env.CASATORCH_DATA_DIR, 'timeline.json'), raw = fs.readFileSync(file, 'utf8');
      assert.match(raw, /^v2\./); assert.doesNotMatch(raw, /Front door|Back door|doorbell/);
    });
  } finally {
    L.TL.list = keep; L.TL.last.clear(); cfg.cameras = was;
    srv.close(); fr.close();
  }
  await t('timeline: the page is off the bar, reached from Cameras and Security, and its words are translated', () => {
    const cli = fs.readFileSync(new URL('../src/client/24t-timeline.js', import.meta.url), 'utf8');
    assert.match(cli, /tab\(\{ id: 'timeline'[^\n]*nav: false/);
    assert.match(fs.readFileSync(new URL('../src/client/24-pages.js', import.meta.url), 'utf8'), /page: 'cameras'[^\n]*timelineBtn\(\)/);
    assert.match(fs.readFileSync(new URL('../src/client/36-security.js', import.meta.url), 'utf8'), /page: 'security'[^\n]*timelineBtn\(\)/);
    const tsv = new Set(fs.readFileSync(new URL('../../tools/i18n-strings.tsv', import.meta.url), 'utf8').split('\n').map((l) => l.split('\t')[0]));
    for (const m of cli.matchAll(/\bT\('((?:[^'\\]|\\.)*)'/g)) assert.ok(tsv.has(m[1].replace(/\\'/g, "'")), m[1]);
    for (const m of cli.matchAll(/\[\s*'\w+',\s*'\w+',\s*'([A-Z][^']*)'\]/g)) assert.ok(tsv.has(m[1]), m[1]);
  });
}
