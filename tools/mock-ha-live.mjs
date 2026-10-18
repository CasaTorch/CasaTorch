#!/usr/bin/env node
/*
 * mock-ha-live: a pretend Home Assistant that keeps changing, for soak and failure tests
 * (tools/test-chaos.mjs). Unlike mock-ha.mjs (the setup wizard's), it has a live websocket:
 * get_states, subscribe_events and a state_changed event every second (power readings,
 * a light or a door now and then), plus camera snapshots.
 *
 *   node tools/mock-ha-live.mjs [port] [entities=200]       token: $MOCK_HA_TOKEN
 *
 * Failure modes, switched at run time (GET /mock/mode?m=...):
 *   ok      normal
 *   down    every connection is dropped at once (like Home Assistant restarting)
 *   slow    every answer takes 20 seconds
 *   silent  the websocket stays open but nothing arrives, and pings get no answer (a half-open connection)
 *   flap    down and up again every 10 seconds
 *   500     the REST API answers 500
 * GET /mock/stats: how many websockets are open and how many REST calls came in.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2] || 18124), N = Number(process.argv[3] || 200), TOKEN = process.env.MOCK_HA_TOKEN || 'test-token';
const DOMAINS = ['light', 'switch', 'sensor', 'sensor', 'binary_sensor', 'climate', 'cover', 'lock', 'media_player', 'camera'];
const ROOMS = ['Kitchen', 'Living Room', 'Bedroom', 'Garage', 'Office', 'Patio', 'Basement', 'Hall'];
const now = () => new Date().toISOString();
const STATES = Array.from({ length: N }, (_, i) => {
  const dom = DOMAINS[i % DOMAINS.length], room = ROOMS[i % ROOMS.length], id = `${dom}.${room.toLowerCase().replace(/ /g, '_')}_${i}`;
  const power = dom === 'sensor' && i % 4 === 2;
  const attributes = { friendly_name: `${room} ${dom.replace('_', ' ')} ${i}`,
    ...(power ? { device_class: 'power', unit_of_measurement: 'W', state_class: 'measurement' } : dom === 'sensor' ? { device_class: 'temperature', unit_of_measurement: '°F' } : {}),
    ...(dom === 'binary_sensor' ? { device_class: ['door', 'motion', 'window'][i % 3] } : {}),
    ...(dom === 'climate' ? { current_temperature: 70, temperature: 68, hvac_modes: ['off', 'heat', 'cool'] } : {}) };
  const state = power ? String(50 + (i % 7) * 30) : dom === 'sensor' ? '70.1' : dom === 'light' || dom === 'switch' ? 'off' : dom === 'binary_sensor' ? 'off' : dom === 'climate' ? 'heat' : dom === 'cover' ? 'closed' : dom === 'lock' ? 'locked' : dom === 'media_player' ? 'idle' : 'idle';
  return { entity_id: id, state, attributes, last_changed: now(), last_updated: now(), context: { id: crypto.randomBytes(8).toString('hex') } };
});
STATES.push({ entity_id: 'sensor.house_power', state: '850', attributes: { friendly_name: 'House power', device_class: 'power', unit_of_measurement: 'W', state_class: 'measurement' }, last_changed: now(), last_updated: now() });
const byId = new Map(STATES.map((s) => [s.entity_id, s]));
let mode = 'ok', rest = 0, flapT = null;
const socks = new Set(), wsClients = new Set();
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const dropAll = () => { for (const s of socks) if (!s.control) { s.destroy(); socks.delete(s); } wsClients.clear(); };   // not the test's own control connection
function setMode(m) {
  mode = m; clearInterval(flapT);
  if (m === 'down') dropAll();
  if (m === 'flap') { let up = true; flapT = setInterval(() => { up = !up; if (!up) dropAll(); mode = up ? 'flap' : 'flap-down'; }, 10_000); }
}
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/mock/')) req.socket.control = true;
  if (u.pathname === '/mock/mode') { setMode(u.searchParams.get('m') || 'ok'); return send(res, 200, { mode }); }
  if (u.pathname === '/mock/stats') return send(res, 200, { mode, ws: wsClients.size, rest });
  if (mode === 'down' || mode === 'flap-down') return req.socket.destroy();
  rest++;
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const answer = () => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { message: 'Unauthorized' });
      if (mode === '500') return send(res, 500, { message: 'Internal Server Error' });
      const p = u.pathname;
      if (p === '/api/') return send(res, 200, { message: 'API running.' });
      if (p === '/api/config') return send(res, 200, { version: '2026.10.1', location_name: 'Test Home', time_zone: 'America/Los_Angeles', unit_system: { temperature: '°F' }, components: ['light', 'sensor'] });
      if (p === '/api/states') return send(res, 200, STATES);
      if (p.startsWith('/api/states/')) { const s = byId.get(decodeURIComponent(p.slice(12))); return s ? send(res, 200, s) : send(res, 404, { message: 'Entity not found.' }); }
      if (p === '/api/services') return send(res, 200, [{ domain: 'light', services: { turn_on: {}, turn_off: {} } }, { domain: 'notify', services: { persistent_notification: {} } }]);
      if (p === '/api/config/config_entries/entry') return send(res, 200, [{ domain: 'met', title: 'Home' }]);
      if (p === '/api/template') return send(res, 200, ROOMS.map((name, k) => ({ name, ids: STATES.filter((_, i) => i % ROOMS.length === k).map((x) => x.entity_id) })));
      if (p.startsWith('/api/camera_proxy/')) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(JPG); }
      if (p.startsWith('/api/history/period')) return send(res, 200, []);
      const sv = p.match(/^\/api\/services\/(\w+)\/(\w+)$/);
      if (req.method === 'POST' && sv) { try { const j = JSON.parse(body || '{}'); const s = byId.get(j.entity_id); if (s && /turn_(on|off)/.test(sv[2])) change(s, sv[2] === 'turn_on' ? 'on' : 'off'); } catch { /* fine */ } return send(res, 200, []); }
      send(res, 404, { message: 'not found' });
    };
    if (mode === 'slow') setTimeout(answer, 20_000); else answer();
  });
});
server.on('connection', (s) => { socks.add(s); s.on('close', () => socks.delete(s)); });

/* ---- websocket ---- */
function frame(obj) {
  const b = Buffer.from(JSON.stringify(obj)); let h;
  if (b.length < 126) h = Buffer.from([0x81, b.length]);
  else if (b.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(b.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(b.length), 2); }
  return Buffer.concat([h, b]);
}
server.on('upgrade', (req, sock) => {
  if (mode === 'down' || mode === 'flap-down') return sock.destroy();
  const key = req.headers['sec-websocket-key'];
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')}\r\n\r\n`);
  const c = { sock, sub: null, send: (o) => { if (mode !== 'silent') try { sock.write(frame(o)); } catch { /* gone */ } } };
  c.send({ type: 'auth_required', ha_version: '2026.10.1' });
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len).map((b, i) => b ^ mask[i % 4]));
      buf = buf.subarray(off + 4 + len);
      if (op === 8) { sock.end(); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      let m; try { m = JSON.parse(data.toString()); } catch { continue; }
      if (m.type === 'auth') { if (m.access_token === TOKEN) { c.send({ type: 'auth_ok', ha_version: '2026.10.1' }); wsClients.add(c); } else { c.send({ type: 'auth_invalid', message: 'Invalid access token' }); sock.end(); } }
      else if (m.type === 'get_states') c.send({ id: m.id, type: 'result', success: true, result: STATES });
      else if (m.type === 'subscribe_events') { c.sub = m.id; c.send({ id: m.id, type: 'result', success: true, result: null }); }
      else if (m.type === 'ping') c.send({ id: m.id, type: 'pong' });
      else c.send({ id: m.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } });
    }
  });
  sock.on('close', () => wsClients.delete(c)); sock.on('error', () => wsClients.delete(c));
});
function change(s, state) {
  const old = { ...s }; s.state = state; s.last_changed = s.last_updated = now();
  for (const c of wsClients) if (c.sub) c.send({ id: c.sub, type: 'event', event: { event_type: 'state_changed', data: { entity_id: s.entity_id, old_state: old, new_state: s }, origin: 'LOCAL', time_fired: now() } });
}
/* The house keeps moving: power every second, a light or door every few seconds. */
let k = 0;
setInterval(() => {
  if (mode !== 'ok' && mode !== 'flap') return;
  k++;
  const hp = byId.get('sensor.house_power'); change(hp, String(600 + Math.round(Math.random() * 900)));
  const powers = STATES.filter((s) => s.attributes.device_class === 'power'); const p = powers[k % powers.length]; change(p, String(Math.round(Math.random() * 400)));
  if (k % 4 === 0) { const l = STATES.filter((s) => /^(light|binary_sensor)\./.test(s.entity_id)); const x = l[k % l.length]; change(x, x.state === 'on' ? 'off' : 'on'); }
}, 1000);
server.listen(PORT, '127.0.0.1', () => console.log(`mock Home Assistant (live) on :${PORT}, ${STATES.length} entities`));
