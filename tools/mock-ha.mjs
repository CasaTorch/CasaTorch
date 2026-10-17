#!/usr/bin/env node
/*
 * mock-ha: a pretend Home Assistant for developing and testing the setup wizard
 * without a real house. It answers the few REST calls the wizard makes and
 * runs three sample integration setups:
 *   opower  power company list -> sign-in -> a verification code -> added
 *           (password "right", code "123456"; anything else = wrong password)
 *   ring    sign-in -> added
 *   hue     already set up
 *
 *   node tools/mock-ha.mjs [port]      token: test-token (or $MOCK_HA_TOKEN - CasaTorch wants a real-length one)
 */
import http from 'node:http';
import crypto from 'node:crypto';
const PORT = Number(process.argv[2] || 18123), TOKEN = process.env.MOCK_HA_TOKEN || 'test-token';
let streamsOpen = 0;   // how many live camera streams are open (to check viewers really close them)
/* With a second argument (e.g. 1500) it also pretends to be a big, messy house: that many entities across
   every domain Home Assistant has, with odd states (unavailable, unknown, empty), odd units, long and
   non-English names, and no device_class where people forget one - for testing that CasaTorch copes. */
const BIG = Number(process.argv[3] || 0);
const DOMAINS = [
  ['light', () => ['on', 'off', 'unavailable'], (i) => ({ brightness: i % 255, color_mode: 'brightness', rgb_color: i % 3 ? [255, 180, 90] : undefined })],
  ['switch', () => ['on', 'off'], (i) => ({ device_class: i % 4 ? 'outlet' : undefined })],
  ['sensor', () => [String((Math.random() * 3000).toFixed(1)), 'unknown', 'unavailable', '', 'Running - 12 min'], (i) => [{ device_class: 'power', unit_of_measurement: i % 2 ? 'W' : 'kW' }, { device_class: 'temperature', unit_of_measurement: '°F' }, { device_class: 'humidity', unit_of_measurement: '%' }, { device_class: 'battery', unit_of_measurement: '%' }, { unit_of_measurement: 'µg/m³' }, {}][i % 6]],
  ['binary_sensor', () => ['on', 'off', 'unavailable'], (i) => ({ device_class: ['door', 'window', 'motion', 'moisture', 'smoke', 'plug', 'connectivity', 'problem', undefined][i % 9] })],
  ['climate', () => ['heat', 'cool', 'off', 'heat_cool'], () => ({ current_temperature: 70.5, temperature: 68, current_humidity: 41, hvac_modes: ['off', 'heat', 'cool'] })],
  ['cover', () => ['open', 'closed', 'opening'], (i) => ({ device_class: ['garage', 'blind', 'shade', undefined, 'gate', 'door'][i % 6], current_position: 40 })],
  ['lock', () => ['locked', 'unlocked', 'jammed'], () => ({})], ['alarm_control_panel', () => ['armed_home', 'disarmed', 'triggered'], () => ({})],
  ['media_player', () => ['playing', 'paused', 'off', 'idle', 'standby'], () => ({ media_title: 'Song', media_artist: 'Band', volume_level: 0.4 })],
  ['fan', () => ['on', 'off'], () => ({ percentage: 50 })], ['vacuum', () => ['docked', 'cleaning', 'error'], () => ({})], ['lawn_mower', () => ['docked', 'mowing'], () => ({})],
  ['camera', () => ['idle', 'streaming', 'unavailable'], () => ({})], ['scene', () => ['scening'], () => ({})], ['script', () => ['off', 'on'], () => ({})], ['button', () => ['unknown'], () => ({})],
  ['input_boolean', () => ['on', 'off'], () => ({})], ['input_number', () => ['42.0'], () => ({ min: 0, max: 100 })], ['input_select', () => ['Home'], () => ({ options: ['Home', 'Away'] })],
  ['number', () => ['3'], () => ({})], ['select', () => ['eco'], () => ({ options: ['eco', 'boost'] })], ['text', () => ['hello'], () => ({})], ['update', () => ['on', 'off'], () => ({ title: 'Firmware' })],
  ['weather', () => ['rainy'], () => ({ temperature: 61 })], ['device_tracker', () => ['home', 'not_home', 'Work'], () => ({ latitude: 1, longitude: 2 })], ['person', () => ['home', 'not_home'], () => ({})],
  ['water_heater', () => ['eco', 'off'], () => ({ current_temperature: 120, temperature: 125 })], ['valve', () => ['open', 'closed'], () => ({ device_class: 'water' })], ['siren', () => ['off', 'on'], () => ({})],
  ['humidifier', () => ['on', 'off'], () => ({ humidity: 45 })], ['remote', () => ['on'], () => ({})], ['event', () => ['2026-10-14T10:00:00Z'], () => ({ event_type: 'pressed' })], ['counter', () => ['7'], () => ({})], ['timer', () => ['idle'], () => ({})],
  ['image', () => ['2026-10-14T10:00:00Z'], () => ({})], ['todo', () => ['3'], () => ({})], ['sun', () => ['above_horizon'], () => ({})], ['zone', () => ['0'], () => ({})],
];
const NAMES = ['Kitchen', 'Living Room', 'Primary Bedroom', 'Garage', 'Kinderzimmer', 'Salle de bain', 'Büro', 'Patio', "Kid's room", 'Basement', 'Back yard', 'Guest suite 2', '書斎', 'A very long name for a device that someone typed into Home Assistant without thinking about screens'];
const STATES = BIG ? Array.from({ length: BIG }, (_, i) => {
  const [dom, st, at] = DOMAINS[i % DOMAINS.length], states = st(i), area = NAMES[i % NAMES.length];
  return { entity_id: `${dom}.${area.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'x'}_${i}`, state: states[i % states.length], attributes: { friendly_name: i % 17 === 0 ? undefined : `${area} ${dom.replace('_', ' ')} ${i}`, ...Object.fromEntries(Object.entries(at(i) || {}).filter(([, v]) => v !== undefined)) }, last_changed: new Date().toISOString() };
}) : [];
const CALLS = [];
const flows = new Map(); let n = 0;
const UTILS = [['Pacific Gas and Electric Company (PG&E)', 'Pacific Gas and Electric Company (PG&E)'], ['Consolidated Edison (ConEd)', 'Consolidated Edison (ConEd)'], ['Portland General Electric (PGE)', 'Portland General Electric (PGE)'], ['Puget Sound Energy (PSE)', 'Puget Sound Energy (PSE)']];
const form = (f, step, schema, errors = {}) => ({ type: 'form', flow_id: f.id, handler: f.domain, step_id: step, data_schema: schema, errors, description_placeholders: null, last_step: null });
const done = (f, title) => { flows.delete(f.id); return { type: 'create_entry', flow_id: f.id, handler: f.domain, title, result: { entry_id: `e${f.id}`, title } }; };
function step(f, input) {
  if (f.domain === 'opower') {
    if (f.step === 'user') {
      if (!input) return form(f, 'user', [{ name: 'utility', required: true, type: 'select', options: UTILS }, { name: 'username', required: true, type: 'string' }, { name: 'password', required: true, type: 'string' }]);
      if (input.password !== 'right') return form(f, 'user', [{ name: 'utility', required: true, type: 'select', options: UTILS, default: input.utility }, { name: 'username', required: true, type: 'string' }, { name: 'password', required: true, type: 'string' }], { base: 'invalid_auth' });
      f.utility = input.utility; f.user = input.username; f.step = 'mfa_code';
      return form(f, 'mfa_code', [{ name: 'code', required: true, type: 'string' }]);
    }
    if (input?.code !== '123456') return form(f, 'mfa_code', [{ name: 'code', required: true, type: 'string' }], { base: 'invalid_code' });
    return done(f, `${f.utility} (${f.user})`);
  }
  if (f.domain === 'ring') {
    if (!input) return form(f, 'user', [{ name: 'username', required: true, selector: { text: {} } }, { name: 'password', required: true, selector: { text: { type: 'password' } } }]);
    return done(f, input.username);
  }
  if (f.domain === 'hue') { flows.delete(f.id); return { type: 'abort', flow_id: f.id, handler: 'hue', reason: 'already_configured' }; }
  return null;
}
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    // "Sign in with Home Assistant": the login page signs you in at once and sends a code back.
    if (req.url.startsWith('/auth/authorize')) { const q = new URL(req.url, 'http://x').searchParams; res.writeHead(302, { Location: `${q.get('redirect_uri')}?code=code123&state=${encodeURIComponent(q.get('state'))}` }); return res.end(); }
    if (req.url === '/auth/token' && req.method === 'POST') { const f = new URLSearchParams(body); return f.get('code') === 'code123' ? send(res, 200, { access_token: 'short-lived', refresh_token: 'r', token_type: 'Bearer', expires_in: 1800 }) : send(res, 400, { error: 'invalid_request' }); }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { message: 'Unauthorized' });
    const j = body ? JSON.parse(body) : null;
    const u = req.url;
    if (req.method === 'GET' && u === '/api/config') return send(res, 200, { version: '2026.10.1', location_name: 'Test Home', time_zone: 'America/Los_Angeles', unit_system: { temperature: '°F' } });
    if (req.method === 'GET' && u === '/api/') return send(res, 200, { message: 'API running.' });
    if (req.method === 'GET' && u === '/api/states') return send(res, 200, STATES);
    if (req.method === 'GET' && u === '/api/services') return send(res, 200, [{ domain: 'notify', services: { mobile_app_phone_one: {}, mobile_app_phone_two: {}, persistent_notification: {} } }]);
    if (req.method === 'POST' && u === '/api/template') return send(res, 200, NAMES.map((name, k) => ({ name, ids: STATES.filter((_, i) => i % NAMES.length === k).map((x) => x.entity_id) })));
    if (req.method === 'GET' && u.startsWith('/api/camera_proxy_stream/')) {   // MJPEG: a frame every 200 ms until the viewer leaves
      const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
      const tick = setInterval(() => res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`), jpg, Buffer.from('\r\n')])), 200);
      res.on('close', () => { clearInterval(tick); streamsOpen--; }); streamsOpen++; return;
    }
    if (req.method === 'GET' && u === '/mock/streams') return send(res, 200, { open: streamsOpen });
    if (req.method === 'GET' && u.startsWith('/api/camera_proxy/')) return setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')); }, 300);   // a camera takes a moment
    const sv = u.match(/^\/api\/services\/(\w+)\/(\w+)$/);
    if (req.method === 'POST' && sv) { CALLS.push(`${sv[1]}.${sv[2]} ${j?.entity_id || ''}`); console.log('service call:', sv[1], sv[2], j?.entity_id || j?.title || ''); return send(res, 200, []); }
    if (req.method === 'GET' && u === '/api/config/config_entries/flow') return send(res, 200, [{ flow_id: 'disc1abc', handler: 'sonos', step_id: 'discovery_confirm', context: { source: 'zeroconf', title_placeholders: { name: 'Sonos Arc' }, unique_id: 'RINCON_1' } }]);
    if (req.method === 'GET' && u === '/api/config/config_entries/flow_handlers') return send(res, 200, ['hue', 'ring', 'opower', 'sonos', 'tesla_fleet']);
    if (req.method === 'GET' && u === '/api/config/config_entries/entry') return send(res, 200, [{ domain: 'hue', title: 'Hue Bridge' }, { domain: 'met', title: 'Home' }]);
    if (req.method === 'POST' && u === '/api/config/config_entries/flow') {
      const f = { id: `flow${++n}abc`, domain: j?.handler, step: 'user' };
      if (!['opower', 'ring', 'hue'].includes(f.domain)) return send(res, 404, { message: 'Invalid handler specified' });
      flows.set(f.id, f); return send(res, 200, step(f, null));
    }
    const m = u.match(/^\/api\/config\/config_entries\/flow\/([\w-]+)$/);
    if (m) {
      const f = flows.get(m[1]);
      if (req.method === 'DELETE') { flows.delete(m[1]); return send(res, 200, { message: 'ok' }); }
      if (!f) return send(res, 404, { message: 'Invalid flow specified' });
      return send(res, 200, step(f, j || {}));
    }
    send(res, 404, { message: 'not found' });
  });
});
/* A tiny WebSocket API: sign in with a token, then answer "make a long-lived token". */
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')}\r\n\r\n`);
  const sendWs = (o) => { const b = Buffer.from(JSON.stringify(o)); const h = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); sock.write(Buffer.concat([h, b])); };
  sendWs({ type: 'auth_required' });
  sock.on('data', (d) => {
    let len = d[1] & 127, off = 2; if (len === 126) { len = d.readUInt16BE(2); off = 4; }
    const mask = d.subarray(off, off + 4), data = Buffer.from(d.subarray(off + 4, off + 4 + len).map((b, i) => b ^ mask[i % 4]));
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.type === 'auth') sendWs(m.access_token === 'short-lived' || m.access_token === TOKEN ? { type: 'auth_ok' } : { type: 'auth_invalid' });
    else if (m.type === 'auth/long_lived_access_token') sendWs({ id: m.id, type: 'result', success: true, result: TOKEN });
    else if (m.type === 'integration/descriptions') sendWs({ id: m.id, type: 'result', success: true, result: { core: { integration: { sonos: { name: 'Sonos', config_flow: true, integration_type: 'hub' }, tesla_fleet: { name: 'Tesla Fleet', config_flow: true, iot_class: 'cloud_polling' } } } } });
    else sendWs({ id: m.id, type: 'result', success: false, error: { message: 'unknown command' } });
  });
});
server.listen(PORT, () => console.log(`mock Home Assistant on :${PORT} (token: ${TOKEN})`));
