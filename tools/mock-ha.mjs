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
 *   node tools/mock-ha.mjs [port]      token: test-token
 */
import http from 'node:http';
const PORT = Number(process.argv[2] || 18123), TOKEN = 'test-token';
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
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { message: 'Unauthorized' });
    const j = body ? JSON.parse(body) : null;
    const u = req.url;
    if (req.method === 'GET' && u === '/api/config') return send(res, 200, { version: '2026.10.1', location_name: 'Test Home', time_zone: 'America/Los_Angeles', unit_system: { temperature: '°F' } });
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
}).listen(PORT, () => console.log(`mock Home Assistant on :${PORT} (token: ${TOKEN})`));
