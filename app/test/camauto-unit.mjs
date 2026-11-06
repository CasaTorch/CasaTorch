/* Unit tests for cameras that set themselves up (src/server/29h-camauto.js): one tile per physical camera when Ring
   arrives through the Ring integration, ring-mqtt and Frigate; new cameras found (and announced once); each Home
   Assistant camera matched to Frigate's go2rtc by name or by ring-mqtt's stream; Frigate's settings file changed as
   text without touching anything else, with nothing a camera name or address could inject; and camera walls checked.
   Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import http from 'node:http';

export default async function camAutoTests(t) {
  const A = globalThis.__casatorchCamAuto;
  const cam = (id, provider, name, x = {}) => ({ id, provider, name, kind: 'camera', ...x });

  t('camauto: names without _live_view, _snapshot, _live, _h264, case, spaces or underscores', () => {
    assert.equal(A.camBaseName('camera.garden_gate_live_view'), 'gardengate');
    assert.equal(A.camBaseName('camera.Garden_Gate_snapshot'), 'gardengate');
    assert.equal(A.camBaseName('Garden Gate Live view'), 'gardengate');
    assert.equal(A.camBaseName('front_door_h264'), 'frontdoor');
    assert.equal(A.camBaseName('back_yard_live'), 'backyard');
    assert.equal(A.camBaseName('live'), 'live', 'a name that is only an ending stays');
    assert.equal(A.camBaseName('Garage'), 'garage');
  });

  t('camauto: Ring live view, ring-mqtt snapshot and the Frigate camera of the same name are one tile (Frigate kept)', () => {
    const cams = [cam('ha:camera.garden_gate_live_view', 'ha', 'Garden Gate Live view'), cam('ha:camera.garden_gate_snapshot', 'ha', 'Garden Gate Snapshot'),
      cam('camera:frigate-garden_gate', 'camera', 'Garden gate', { source: 'frigate', frigateCam: 'garden_gate' }), cam('ha:camera.side_gate_snapshot', 'ha', 'Side gate snapshot'), cam('ha:camera.side_gate_live_view', 'ha', 'Side gate Live view')];
    const { show, hidden } = A.camDedupe(cams, {});
    assert.deepEqual([...show].sort(), ['camera:frigate-garden_gate', 'ha:camera.side_gate_live_view']);
    assert.equal(hidden.find((h) => h.id === 'ha:camera.garden_gate_snapshot').ofId, 'camera:frigate-garden_gate');
    assert.equal(hidden.find((h) => h.id === 'ha:camera.side_gate_snapshot').ofId, 'ha:camera.side_gate_live_view', 'live view over snapshot');
    // discovered duplicates can still be added back
    const r = A.camDedupe(cams, { shown: ['ha:camera.garden_gate_snapshot'] });
    assert.ok(r.show.has('ha:camera.garden_gate_snapshot') && r.show.has('camera:frigate-garden_gate'));
    // new and waiting (Show new cameras automatically off): under Detected cameras, until added
    const p = A.camDedupe(cams, { pending: ['ha:camera.side_gate_live_view'] });
    assert.equal(p.hidden.find((h) => h.id === 'ha:camera.side_gate_live_view').why, 'new');
    assert.ok(A.camDedupe(cams, { pending: ['ha:camera.side_gate_live_view'], shown: ['ha:camera.side_gate_live_view'] }).show.has('ha:camera.side_gate_live_view'));
    // two different Home Assistant cameras stay two
    assert.equal(A.camDedupe([cam('ha:camera.porch', 'ha', 'Porch'), cam('ha:camera.porch_2', 'ha', 'Porch 2')], {}).show.size, 2);
  });

  t('camauto: new cameras - the first look announces nothing, then each new camera once, duplicates only remembered', () => {
    const now = Date.parse('2026-11-04T20:00:00Z');
    const c1 = [cam('ha:camera.porch', 'ha', 'Porch'), cam('camera:frigate-yard', 'camera', 'Yard')];
    let r = A.camAutoDiff({ known: null, pending: [], notices: [] }, c1, new Set(c1.map((d) => d.id)), { now });
    assert.deepEqual(r.found, []); assert.deepEqual(r.state.known.sort(), ['camera:frigate-yard', 'ha:camera.porch']);
    const c2 = [...c1, cam('ha:camera.garden_gate_live_view', 'ha', 'Garden gate'), cam('ha:camera.garden_gate_snapshot', 'ha', 'Garden gate snapshot')];
    r = A.camAutoDiff(r.state, c2, new Set([...c1.map((d) => d.id), 'ha:camera.garden_gate_live_view']), { now });
    assert.deepEqual(r.found.map((f) => f.id), ['ha:camera.garden_gate_live_view'], 'the snapshot is the same camera: no second notice');
    assert.equal(r.state.notices.length, 1); assert.equal(r.state.notices[0].name, 'Garden gate'); assert.equal(r.state.notices[0].dev, 'ha:camera.garden_gate_live_view');
    assert.equal(r.state.known.length, 4);
    const again = A.camAutoDiff(r.state, c2, new Set(c2.map((d) => d.id)), { now: now + 1000 });
    assert.deepEqual(again.found, [], 'known now'); assert.equal(again.state.notices.length, 1);
    // automatically off: it waits in Detected cameras instead
    const off = A.camAutoDiff({ known: ['ha:camera.porch'], pending: [], notices: [] }, [cam('ha:camera.porch', 'ha', 'Porch'), cam('ha:camera.shed', 'ha', 'Shed')], new Set(['ha:camera.porch', 'ha:camera.shed']), { auto: false, now });
    assert.deepEqual(off.state.pending, ['ha:camera.shed']); assert.equal(off.state.notices.length, 0); assert.equal(off.found[0].shown, false);
    // old notices go after three days
    assert.equal(A.camAutoDiff(r.state, c2, new Set(), { now: now + 4 * 86400_000 }).state.notices.length, 0);
  });

  t('camauto: Home Assistant cameras matched to Frigate\'s go2rtc - by ring-mqtt\'s stream, by name, or not at all', () => {
    const states = [
      { entity_id: 'camera.garden_gate_snapshot', attributes: { friendly_name: 'Garden gate snapshot' } },
      { entity_id: 'sensor.garden_gate_info', attributes: { stream_Source: 'rtsp://ring-mqtt.example.com:8554/a1b2c3d4e5f6_live' } },
      { entity_id: 'camera.garden_gate_live_view', attributes: { friendly_name: 'Garden Gate Live view', attribution: 'Data provided by Ring.com' } },
      { entity_id: 'camera.porch', attributes: { friendly_name: 'Porch' } },
      { entity_id: 'camera.attic', attributes: { friendly_name: 'Attic' } },
    ];
    const src = A.camSources(states);
    assert.equal(src.byBase.gardengate, 'rtsp://ring-mqtt.example.com:8554/a1b2c3d4e5f6_live');
    const frigates = [{ i: 0, streams: { ring_gate: { producers: [{ url: 'rtsp://ring-mqtt.example.com:8554/a1b2c3d4e5f6_live' }] }, porch: { producers: [] }, porch_sub: { producers: [] } },
      conf: { cameras: { porch: { ffmpeg: { inputs: [{ path: 'rtsp://127.0.0.1:8554/porch', roles: ['record'] }, { path: 'rtsp://127.0.0.1:8554/porch_sub', roles: ['detect'] }] } } } } }];
    const m = A.camMatch(states.filter((s) => s.entity_id.startsWith('camera.')), src, frigates);
    assert.deepEqual([m['camera.garden_gate_snapshot'].via, m['camera.garden_gate_snapshot'].main, m['camera.garden_gate_snapshot'].how], ['frigate', 'ring_gate', 'ring']);
    assert.equal(m['camera.garden_gate_live_view'].main, 'ring_gate', 'the live view finds ring-mqtt\'s stream by its name');
    assert.equal(m['camera.garden_gate_live_view'].ring, true);
    assert.deepEqual([m['camera.porch'].via, m['camera.porch'].main, m['camera.porch'].sub, m['camera.porch'].how, m['camera.porch'].frigateCam], ['frigate', 'porch', 'porch_sub', 'name', 'porch']);
    assert.deepEqual([m['camera.attic'].via, m['camera.attic'].frigateCam, m['camera.attic'].rtsp], ['ha', null, null]);
  });

  t('camauto: go2rtc streams found with or without ring_, by the _2 Home Assistant adds, and by ring-mqtt\'s id', () => {
    assert.deepEqual(A.camMatchKeys('camera.ring_driveway_live_view_2'), { key: 'driveway2', stem: 'driveway' });
    assert.deepEqual(A.camMatchKeys('ring_driveway'), { key: 'driveway', stem: null });
    assert.deepEqual(A.camMatchKeys('Garden Gate'), { key: 'gardengate', stem: null });
    assert.equal(A.camMatchKeys('ringo_cam').key, 'ringocam', 'only a whole "ring_" word goes');
    const S = (entity_id, friendly_name, x = {}) => ({ entity_id, attributes: { friendly_name, attribution: 'Data provided by Ring.com', ...x } });
    // two Ring devices called "Driveway": camera.driveway and camera.driveway_2, each to its own stream - never both to one
    const two = [S('camera.driveway', 'Driveway'), S('camera.driveway_2', 'Driveway')];
    const f2 = [{ i: 0, streams: { ring_driveway: { producers: [] }, ring_driveway_2: { producers: [] } }, conf: {} }];
    let m = A.camMatch(two, A.camSources(two), f2);
    assert.deepEqual([m['camera.driveway'].main, m['camera.driveway_2'].main], ['ring_driveway', 'ring_driveway_2']);
    // the first "Driveway" was a chime (no camera here): camera.driveway_2 is the only one, so plain ring_driveway is its stream
    const one = [S('camera.driveway_2', 'Driveway')];
    m = A.camMatch(one, A.camSources(one), [{ i: 0, streams: { ring_driveway: { producers: [] } }, conf: {} }]);
    assert.deepEqual([m['camera.driveway_2'].via, m['camera.driveway_2'].main], ['frigate', 'ring_driveway']);
    // ...but not while another camera is called that
    m = A.camMatch([S('camera.driveway', 'Front'), S('camera.driveway_2', 'Driveway')], {}, [{ i: 0, streams: { driveway: { producers: [] } }, conf: {} }]);
    assert.equal(m['camera.driveway'].main, 'driveway'); assert.equal(m['camera.driveway_2'].via, 'ha');
    // a go2rtc stream named after ring-mqtt's camera id
    const id = [S('camera.side_gate_2', 'Side gate'), { entity_id: 'sensor.side_gate_info_2', attributes: { stream_Source: 'rtsp://ring-mqtt.example.com:8554/0a1b2c3d4e5f_live' } }];
    m = A.camMatch([id[0]], A.camSources(id), [{ i: 0, streams: { '0a1b2c3d4e5f': { producers: [] } }, conf: {} }]);
    assert.deepEqual([m['camera.side_gate_2'].main, m['camera.side_gate_2'].how], ['0a1b2c3d4e5f', 'ring'], 'sensor.side_gate_info_2 is camera.side_gate_2\'s');
  });

  t('camauto: a Ring Chime is never a camera - not counted, not on walls, not announced, shown as a chime', () => {
    const chime = { entity_id: 'camera.hallway_chime', attributes: { friendly_name: 'Hallway Chime', attribution: 'Data provided by Ring.com' } };
    assert.equal(A.haIsChime(chime), true);
    assert.equal(A.haIsChime({ entity_id: 'camera.driveway', attributes: { friendly_name: 'Driveway' } }, 'Chime Pro (v2)'), true, 'by its Home Assistant device model');
    assert.equal(A.haIsChime({ entity_id: 'camera.kitchen', attributes: { friendly_name: 'Kitchen', device_type: 'chime_pro' } }), true);
    assert.equal(A.haIsChime({ entity_id: 'camera.front_door', attributes: { friendly_name: 'Front door', attribution: 'Data provided by Ring.com', supported_features: 2 } }, 'Video Doorbell 4'), false);
    assert.equal(A.haIsChime({ entity_id: 'camera.chimney_cam', attributes: { friendly_name: 'Chimney cam' } }), false, 'a word that only starts with "chime" is no chime');
    const d = A.haChimeOf({ id: 'ha:camera.hallway_chime', kind: 'camera', name: 'Hallway Chime', snapshot: '/x', stream: '/y', every: 3000 });
    assert.deepEqual([d.kind, d.chime, d.snapshot, d.stream], ['chime', true, undefined, undefined]);
    // chimes never reach the camera tiles: dedupe and the walls only ever see kind 'camera'
    assert.equal(A.camDedupe([d].filter((x) => x.kind === 'camera'), {}).show.size, 0);
  });

  t('camauto: Ring chimes from the Ring integration (no Home Assistant) are chimes: online, volume, snooze - never cameras', async () => {
    const R = globalThis.__casatorchRing;
    const calls = [];
    const fake = (id, data) => ({ id, model: 'Chime Pro', data, setVolume: async (v) => calls.push(['vol', id, v]), snooze: async (n) => calls.push(['snooze', id, n]), clearSnooze: async () => calls.push(['clear', id]) });
    const a = fake(11, { description: 'Hallway', settings: { volume: 7 }, alerts: { connection: 'online' }, do_not_disturb: { seconds_left: 0 } });
    const b = fake(12, { description: 'Upstairs', settings: { volume: 14 }, alerts: { connection: 'offline' }, do_not_disturb: { seconds_left: 3599 } });
    const da = R.ringChimeDevice(a), db = R.ringChimeDevice(b);
    assert.deepEqual([da.id, da.kind, da.chime, da.online, da.volume, da.snoozed, da.snoozeMin], ['ring:chime:11', 'chime', true, true, 7, false, 0]);
    assert.deepEqual([db.online, db.volume, db.snoozed, db.snoozeMin], [false, 10, true, 60], 'offline, volume kept in 0-10, snoozed for the hour left');
    assert.ok(!('snapshot' in da) && !('stream' in da), 'no picture or video address');
    assert.equal(A.camDedupe([da, db].filter((x) => x.kind === 'camera'), {}).show.size, 0, 'never counted as a camera');
    const keep = R.ring.chimes; R.ring.chimes = [a, b];
    try {
      const P = globalThis.__casatorchProviders.ring;
      await P.act(da, 'volume', 3); await P.act(db, 'snooze', 0); await P.act(da, 'snooze', 30);
      assert.deepEqual(calls, [['vol', 11, 3], ['clear', 12], ['snooze', 11, 30]]);
      await assert.rejects(P.act(da, 'volume', 99)); await assert.rejects(P.act(da, 'snooze', 5000)); await assert.rejects(P.act(da, 'unlock'));
      await assert.rejects(P.act({ id: 'ring:123' }, 'volume', 3), 'a camera has nothing to switch');
    } finally { R.ring.chimes = keep; }
  });

  t('camauto: Frigate camera names - the Home Assistant name, never one Frigate has (ring_ first for Ring)', () => {
    assert.equal(A.frigateCamName('Garden Gate Live view', []), 'garden_gate');
    assert.equal(A.frigateCamName('Driveway A', ['driveway_a'], { ring: true }), 'ring_driveway_a');
    assert.equal(A.frigateCamName('Driveway A', ['driveway_a', 'ring_driveway_a'], { ring: true }), 'ring_driveway_a_2');
    assert.equal(A.frigateCamName('Driveway A', ['Driveway_A']), 'driveway_a_cam');
    assert.equal(A.frigateCamName('2nd floor', []), 'cam_2nd_floor');
    assert.equal(A.frigateCamName('On', []), 'cam_on', 'never a word YAML reads as true/false');
    assert.equal(A.frigateCamName('Café ☕ "x"; rm -rf /', []), 'cafe_x_rm_rf');
  });

  t('camauto: stream addresses - rtsp:// or rtsps:// only, one plain line, no shell or YAML characters', () => {
    assert.equal(A.rtspClean('rtsp://user:pass@192.0.2.5:8554/a1b2c3d4e5f6_live'), 'rtsp://user:pass@192.0.2.5:8554/a1b2c3d4e5f6_live');
    assert.equal(A.rtspClean('  rtsps://cam.example.com/stream  '), 'rtsps://cam.example.com/stream');
    assert.equal(A.rtspClean(''), null);
    for (const bad of ['http://192.0.2.5/x', 'rtsp://x/a"b', 'rtsp://x/a\nb: 1', 'rtsp://x/$(reboot)', 'rtsp://x/a;b', 'rtsp://x/a`b`', "rtsp://x/'", 'rtsp://x/{FRIGATE_RTSP_PASSWORD}', 'rtsp://x/a b', 'rtsp:///nohost', `rtsp://x/${'a'.repeat(500)}`, 'rtsp://169.254.169.254/x', 'file:///etc/passwd', 'rtsp://x/a#b', 'rtsp://x/a\\b'])
      assert.throws(() => A.rtspClean(bad), /stream address/, bad);
    assert.equal(A.rtspShown('rtsp://user:secret@192.0.2.5:8554/x'), 'rtsp://user:****@192.0.2.5:8554/x');
  });

  const FILE = [
    '# my Frigate',
    'mqtt:',
    '  host: mqtt.example.com   # the broker',
    '',
    'go2rtc:',
    '  streams:',
    '    porch:',
    '      - rtsp://192.0.2.10:554/main   # porch',
    '    porch_sub:',
    '      - rtsp://192.0.2.10:554/sub',
    '  webrtc:',
    '    candidates: [192.0.2.2:8555]',
    '',
    'cameras:',
    '  porch:',
    '    ffmpeg:',
    '      inputs:',
    '        - path: rtsp://127.0.0.1:8554/porch',
    '          roles: [record]',
    '    # zones later',
    '',
    '# --- detection ---',
    'detect:',
    '  enabled: true',
    '',
  ].join('\n');

  t('camauto: Frigate\'s file - the stream under go2rtc.streams and the camera under cameras, everything else exactly as it was', () => {
    const r = A.frigateYamlAdd(FILE, { name: 'garden_gate', source: 'rtsp://ring-mqtt.example.com:8554/a1b2c3d4e5f6_live', ring: true });
    assert.equal(r.ok, true);
    const L = r.text.split('\n');
    assert.equal(L[L.indexOf('    porch_sub:') + 2], '    garden_gate:', 'after the last stream');
    assert.equal(L[L.indexOf('    garden_gate:') + 1], '      - "rtsp://ring-mqtt.example.com:8554/a1b2c3d4e5f6_live"');
    assert.equal(L[L.indexOf('    garden_gate:') + 2], '  webrtc:');
    const c = L.indexOf('  garden_gate:');
    assert.ok(c > L.indexOf('cameras:') && c < L.indexOf('detect:'));
    assert.deepEqual(L.slice(c, c + 10), ['  garden_gate:', '    ffmpeg:', '      hwaccel_args: []', '      inputs:', '        - path: rtsp://127.0.0.1:8554/garden_gate', '          input_args: preset-rtsp-restream', '          roles:', '            - detect', '            - record', '']);
    const goPart = '    garden_gate:\n      - "rtsp://ring-mqtt.example.com:8554/a1b2c3d4e5f6_live"\n', camPart = `${L.slice(c, c + 9).join('\n')}\n`;
    assert.equal(r.text.replace(goPart, '').replace(camPart, ''), FILE, 'nothing else changed');
    // Windows line endings stay Windows line endings
    const w = A.frigateYamlAdd(FILE.replace(/\n/g, '\r\n'), { name: 'garden_gate', source: 'rtsp://ring-mqtt.example.com:8554/a1b2c3d4e5f6_live' });
    assert.ok(!/[^\r]\n/.test(w.text), 'every line ends with CR LF');
    // a stream go2rtc already has: only the camera is added, pointing at it
    const s = A.frigateYamlAdd(FILE, { name: 'porch2', stream: 'porch_sub' });
    assert.ok(s.text.includes('        - path: rtsp://127.0.0.1:8554/porch_sub') && !s.text.includes('    porch2:\n      -'));
  });
  t('camauto: Frigate\'s file - no go2rtc or cameras section yet: added at the end; a name it has: refused', () => {
    const r = A.frigateYamlAdd('mqtt:\n  enabled: false\n', { name: 'shed', source: 'rtsp://cam.example.com/s' });
    assert.equal(r.text, 'mqtt:\n  enabled: false\ngo2rtc:\n  streams:\n    shed:\n      - "rtsp://cam.example.com/s"\ncameras:\n  shed:\n    ffmpeg:\n      inputs:\n        - path: rtsp://127.0.0.1:8554/shed\n          input_args: preset-rtsp-restream\n          roles:\n            - detect\n            - record\n');
    assert.ok(A.frigateYamlAdd('mqtt:\n  enabled: false', { name: 'shed', source: 'rtsp://cam.example.com/s' }).text.startsWith('mqtt:\n  enabled: false\ngo2rtc:'), 'a file without a last new line');
    const g = A.frigateYamlAdd('go2rtc:\n  webrtc:\n    listen: ":8555"\ncameras:\n', { name: 'shed', source: 'rtsp://cam.example.com/s' });
    assert.ok(g.text.startsWith('go2rtc:\n  webrtc:\n    listen: ":8555"\n  streams:\n    shed:\n      - "rtsp://cam.example.com/s"\ncameras:\n  shed:\n'));
    assert.throws(() => A.frigateYamlAdd(FILE, { name: 'porch', source: 'rtsp://cam.example.com/s' }), /already has/);
  });
  t('camauto: Frigate\'s file - nothing can be injected through the name or the address', () => {
    for (const name of ['porch:\n  x', 'a b', 'Porch', 'true', '', 'x'.repeat(41), '../x', 'a"b'])
      assert.throws(() => A.frigateYamlAdd(FILE, { name, source: 'rtsp://cam.example.com/s' }), /name/, JSON.stringify(name));
    for (const source of ['rtsp://cam.example.com/s"\n  evil: true', 'rtsp://cam.example.com/s\ncameras:', 'rtsp://cam.example.com/{FRIGATE_X}', 'exec:reboot', 'ffmpeg:rtsp://x#raw'])
      assert.throws(() => A.frigateYamlAdd(FILE, { name: 'shed', source }), /stream address/, source);
    assert.throws(() => A.frigateYamlAdd(FILE, { name: 'shed', stream: 'a\nb' }), /stream/);
  });
  t('camauto: Frigate\'s file - when Frigate reads cameras from a go2rtc outside it, or the file is unusual: the pieces to paste', () => {
    const ext = 'cameras:\n  driveway:\n    ffmpeg:\n      inputs:\n        - path: rtsp://host.docker.internal:8554/driveway\n          roles: [record]\n';
    const r = A.frigateYamlAdd(ext, { name: 'shed', source: 'rtsp://user:secret@example.com/s' });
    assert.deepEqual([r.ok, r.paste, r.why, r.host], [false, true, 'restream', 'host.docker.internal']);
    const p = A.frigatePaste({ name: 'shed', source: 'rtsp://user:secret@example.com/s', host: r.host });
    assert.ok(p.go2rtc.includes('shed:') && p.go2rtc.includes('user:****@') && !p.go2rtc.includes('secret'));
    assert.ok(p.camera.includes('rtsp://host.docker.internal:8554/shed') && p.masked);
    for (const odd of ['{"cameras": {}}', 'cameras: {}\n', 'go2rtc:\n  streams: {}\n', 'cameras:\n\tporch: {}\n', '"cameras":\n  x: 1\n'])
      assert.equal(A.frigateYamlShape(odd)?.why, 'format', odd);
    assert.equal(A.frigateYamlShape('---\ncameras:\n  porch:\n    enabled: true\n'), null, 'a start marker is fine');
    assert.equal(A.frigateYamlShape(FILE), null);
  });

  t('camauto: camera walls - names, cameras, layouts checked; ids kept or made', () => {
    const w = A.cleanWalls([{ id: 'abcdef12', name: '  Outside  ', cams: ['camera:frigate-yard', 'ha:camera.porch', 'ha:camera.porch'], layout: '2x2' }, { name: 'Night', cams: [], names: false }]);
    assert.deepEqual(w[0], { id: 'abcdef12', name: 'Outside', cams: ['camera:frigate-yard', 'ha:camera.porch'], layout: '2x2', names: true });
    assert.match(w[1].id, /^[a-f0-9]{12}$/); assert.equal(w[1].layout, 'auto'); assert.equal(w[1].names, false);
    const dup = A.cleanWalls([{ id: 'abcdef12', name: 'A' }, { id: 'abcdef12', name: 'B' }]); assert.notEqual(dup[0].id, dup[1].id, 'a copied id gets its own');
    assert.equal(A.cleanWalls([{ name: '<b>Hi</b>' }])[0].name, 'bHi/b');
    for (const bad of [null, 'x', [{}], [{ name: '' }], [{ name: 'x'.repeat(41) }], [{ name: 'A', cams: 'camera:x' }], [{ name: 'A', cams: ['../../x'] }], [{ name: 'A', cams: [1] }], [{ name: 'A', layout: '5x5' }], Array.from({ length: 31 }, () => ({ name: 'A' })), [{ name: 'A', cams: Array.from({ length: 65 }, (_, i) => `camera:c${i}`) }]])
      assert.throws(() => A.cleanWalls(bad), undefined, JSON.stringify(bad)?.slice(0, 60));
  });
  /* Adding a camera end to end, against a stand-in Home Assistant and Frigate on this computer: the Ring camera's
     ring-mqtt stream is found, a Frigate camera with the same name (another brand) is neither matched nor reused, and
     Frigate's own check decides. */
  await t('camauto: add to Frigate - ring-mqtt stream found, the name already taken gets ring_, Frigate checks and keeps the file', async () => {
    const RING = 'rtsp://ring-mqtt.example.com:8554/a1b2c3d4e5f6_live';
    let file = 'cameras:\n  garden_gate:\n    ffmpeg:\n      inputs:\n        - path: rtsp://127.0.0.1:8554/garden_gate\n          roles: [record]\ngo2rtc:\n  streams:\n    garden_gate:\n      - rtsp://192.0.2.50/other\n';
    const saved = [];
    const srv = http.createServer((req, res) => {
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/api/states') return send(200, [{ entity_id: 'camera.garden_gate_live_view', state: 'idle', attributes: { friendly_name: 'Garden Gate Live view', attribution: 'Data provided by Ring.com' } }, { entity_id: 'sensor.garden_gate_info', state: 'ok', attributes: { stream_Source: RING } }]);
      if (req.url === '/api/template') return send(404, {});
      if (req.url === '/api/go2rtc/streams') return send(200, { garden_gate: { producers: [{ url: 'rtsp://192.0.2.50/other' }] } });
      if (req.url === '/api/config') return send(200, { cameras: { garden_gate: { ffmpeg: { inputs: [{ path: 'rtsp://127.0.0.1:8554/garden_gate', roles: ['record'] }] } } }, go2rtc: { streams: { garden_gate: ['rtsp://192.0.2.50/other'] } } });
      if (req.url === '/api/config/raw') return send(200, file);
      if (req.url.startsWith('/api/config/save?save_option=saveonly') && req.method === 'POST') {
        let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
          if (/BROKEN/.test(b)) return send(400, { success: false, message: 'Your configuration is invalid: cameras.x.ffmpeg' });
          saved.push({ type: req.headers['content-type'], csrf: req.headers['x-csrf-token'] }); file = b; send(200, { success: true, message: 'Config successfully saved.' });
        });
        return;
      }
      send(404, {});
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${srv.address().port}`, cfg = A.cfg(), was = { ha: cfg.homeAssistant, cams: cfg.cameras };
    const clear = () => { for (const k of [...A.CACHE.keys()]) if (/^(ha:|camauto|go2rtc|dev:)/.test(k)) A.CACHE.delete(k); };
    cfg.homeAssistant = { url: base, token: 'test-token' }; cfg.cameras = [{ id: 'frigate-x', name: 'X', type: 'frigate', url: base, camera: 'garden_gate' }]; clear();
    try {
      const p = await A.caAddPlan('ha:camera.garden_gate_live_view');
      assert.deepEqual([p.name, p.source, p.ring, p.stream, p.display], ['ring_garden_gate', RING, true, null, 'Garden Gate']);
      const r = A.frigateYamlAdd(p.raw, p); assert.equal(r.ok, true);
      const sub = (big, small) => { let i = 0; for (const l of big) if (l === small[i]) i++; return i === small.length; };
      assert.ok(sub(r.text.split('\n'), file.split('\n')), 'every line of the old file is still there, in order');
      assert.ok(r.text.includes(`    ring_garden_gate:\n      - "${RING}"`) && r.text.includes('        - path: rtsp://127.0.0.1:8554/ring_garden_gate') && r.text.includes('      hwaccel_args: []'));
      const sv = await A.frigateSave(A.frigateServers()[0], r.text, 'saveonly');
      assert.deepEqual([sv.ok, file], [true, r.text]); assert.match(saved[0].type, /^text\/plain/); assert.equal(saved[0].csrf, '1');
      const no = await A.frigateSave(A.frigateServers()[0], 'BROKEN', 'saveonly');
      assert.deepEqual([no.ok, no.message], [false, 'Your configuration is invalid: cameras.x.ffmpeg']); assert.equal(file, r.text, 'a refused file changes nothing');
      await assert.rejects(() => A.caAddPlan('ha:camera.nope'), /isn't one Home Assistant has/);
      await assert.rejects(() => A.caAddPlan('ha:camera.garden_gate_live_view\n'), /isn't one Home Assistant has/);
    } finally { cfg.homeAssistant = was.ha; cfg.cameras = was.cams; clear(); srv.close(); }
  });

  t('camauto: a Ring camera that go2rtc has plays only through it - never Home Assistant\'s slow video; a chime has no plan', async () => {
    const L = globalThis.__casatorchCamLive;
    const srv = http.createServer((req, res) => {
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/api/states') return send(200, [
        { entity_id: 'camera.front_door', state: 'idle', attributes: { friendly_name: 'Front door', attribution: 'Data provided by Ring.com', supported_features: 2 } },
        { entity_id: 'camera.porch', state: 'idle', attributes: { friendly_name: 'Porch', supported_features: 2 } },
        { entity_id: 'camera.hallway_chime', state: 'idle', attributes: { friendly_name: 'Hallway Chime', attribution: 'Data provided by Ring.com' } }]);
      if (req.url === '/api/template') return send(404, {});
      if (req.url === '/api/go2rtc/streams') return send(200, { ring_front_door: { producers: [] }, porch: { producers: [] } });
      if (req.url === '/api/config') return send(200, { cameras: {} });
      send(404, {});
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${srv.address().port}`, cfg = A.cfg(), was = { ha: cfg.homeAssistant, cams: cfg.cameras, map: A.CA.map, at: A.CA.mapAt };
    const clear = () => { for (const k of [...A.CACHE.keys()]) if (/^(ha:|camauto|go2rtc|dev:)/.test(k)) A.CACHE.delete(k); };
    cfg.homeAssistant = { url: base, token: 'test-token' }; cfg.cameras = [{ id: 'frigate-x', name: 'X', type: 'frigate', url: base, camera: 'porch' }]; A.CA.map = {}; A.CA.mapAt = 0; clear();
    try {
      const ring = await L.camPlan('ha:camera.front_door', 'full');
      assert.equal(ring.via, 'frigate');
      assert.ok(ring.ways.length >= 2 && ring.ways.every((w) => w.url.startsWith('/api/camlive/') && !/master_playlist/.test(w.url)), JSON.stringify(ring.ways));
      const plain = await L.camPlan('ha:camera.porch', 'full');
      assert.ok(plain.ways.some((w) => /master_playlist/.test(w.url)), 'a camera that isn\'t Ring keeps Home Assistant as a fallback');
      assert.equal(await L.camPlan('ha:camera.hallway_chime', 'full'), null, 'a chime has no video plan');
    } finally { cfg.homeAssistant = was.ha; cfg.cameras = was.cams; A.CA.map = was.map; A.CA.mapAt = was.at; clear(); srv.close(); }
  });

}
