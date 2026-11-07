/* Home Assistant cameras always have a picture when the camera has one anywhere (32-ha.js): the same camera's other
   entity ("_snapshot") is tried when the first has none, and the way that worked is tried first next time.
   Run from test/unit.mjs (server.js loaded, CASATORCH_TEST=1). */
import assert from 'node:assert/strict';

export default async function campicTests(t) {
  const P = globalThis.__casatorchHaPic;
  if (!P) { console.log('skip campic-unit (no __casatorchHaPic)'); return; }
  t('camera pictures: the same camera\'s other entities, snapshot first; never a chime, an unavailable one or another camera', () => {
    const states = [
      { entity_id: 'camera.workout_room_live_view', state: 'idle', attributes: {} },
      { entity_id: 'camera.workout_room_snapshot', state: 'idle', attributes: {} },
      { entity_id: 'camera.workout_room', state: 'unavailable', attributes: {} },
      { entity_id: 'camera.mail_boxes_snapshot', state: 'idle', attributes: {} },
    ];
    assert.deepEqual(P.haPicTwins('camera.workout_room_live_view', states), ['camera.workout_room_snapshot']);
    assert.deepEqual(P.haPicTwins('camera.mail_boxes_live_view', states), ['camera.mail_boxes_snapshot']);
    assert.deepEqual(P.haPicTwins('camera.garden', states), []);
    assert.deepEqual(P.haPicTwins('camera.ab', states), [], 'too short a name matches nothing');
  });
  t('camera pictures: the first way that works is used, and tried first next time', async () => {
    const calls = [], pic = { buf: Buffer.alloc(300), type: 'image/jpeg' };
    const tries = [['ha', async () => { calls.push('ha'); throw new Error('500'); }], ['twin', async () => { calls.push('twin'); return pic; }], ['slow', async () => { calls.push('slow'); return pic; }]];
    P.HA_PIC_WAY.delete('camera.x');
    assert.equal(await P.haPicFirst('camera.x', tries), pic);
    assert.deepEqual(calls, ['ha', 'twin'], 'stops at the first picture; the slow way is not asked');
    calls.length = 0;
    await P.haPicFirst('camera.x', tries);
    assert.deepEqual(calls, ['twin'], 'the way that worked goes first');
    await assert.rejects(P.haPicFirst('camera.y', [['ha', async () => { throw new Error('first'); }], ['b', async () => { throw new Error('second'); }]]), /first/, 'nothing works: the first reason');
  });
}
