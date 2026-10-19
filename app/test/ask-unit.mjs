/* Unit tests for the Home AI Agent (src/server/70*-ask*.js, src/client/25c-ask-render.js): chart and table checks, no HTML or
   script from an answer ever reaching the page, links only http(s), the safety rule on offered actions, sources and
   "From your home" citations, tool dispatch and privacy, and the whole question loop end to end with a stand-in AI that
   asks for lookups (over the real /api/ask, streamed). Run from test/unit.mjs (which loads server.js first). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* A tiny stand-in DOM, enough to run the browser's answer renderer here and inspect what it builds. */
function fakeDom() {
  class Node { constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this.text = ''; this.style = {}; this.classList = { add: (c) => { this.attrs.class = `${this.attrs.class || ''} ${c}`.trim(); } }; }
    setAttribute(k, v) { this.attrs[k] = String(v); } removeAttribute(k) { delete this.attrs[k]; } getAttribute(k) { return this.attrs[k]; }
    append(...k) { for (const x of k) this.children.push(x); } appendChild(x) { this.children.push(x); return x; } replaceChildren(...k) { this.children = [...k]; }
    addEventListener() {} get childNodes() { return this.children; } get lastChild() { return this.children.at(-1); } get firstChild() { return this.children[0]; }
    set className(v) { this.attrs.class = v; } get className() { return this.attrs.class; } set textContent(v) { this.children = []; this.text = String(v); } get textContent() { return this.text + this.children.map((c) => c.textContent ?? '').join(''); }
    set innerHTML(v) { throw new Error(`innerHTML used: ${String(v).slice(0, 60)}`); } get isConnected() { return false; } querySelector() { return null; } getBoundingClientRect() { return { left: 0, top: 0, width: 640 }; } }
  class Text { constructor(t) { this.nodeType = 3; this.textContent = t; } }
  Node.prototype.nodeType = 1;
  return { createElement: (t) => new Node(t), createElementNS: (_ns, t) => new Node(t), createTextNode: (t) => new Text(t) };
}
function loadRenderer() {
  const core = fs.readFileSync(path.join(HERE, '../src/client/00-core.js'), 'utf8');
  const pick = (re) => { const m = core.match(re); assert.ok(m, `00-core.js: ${re}`); return m[0]; };
  const elSrc = pick(/const el = \(tag[\s\S]*?\n};/), safeSrc = pick(/const safeHref = .*\n/);
  const ctx = { document: fakeDom(), location: { href: 'http://192.168.1.20:8090/' }, URL, T: (s) => s, icon: () => ({ nodeType: 1, tagName: 'svg', attrs: {}, children: [], textContent: '' }), api: async () => ({ devices: [] }), post: async () => ({}), toast: () => {}, fmtTime: () => '2:41 PM', S: { units: 'F' }, setTimeout: () => 0, window: { innerWidth: 1200 }, Map, Math, Number, String, Array, Object, JSON, Date, Set };
  vm.createContext(ctx);
  vm.runInContext(`${elSrc}\n${safeSrc}\n${fs.readFileSync(path.join(HERE, '../src/client/25c-ask-render.js'), 'utf8')}\nthis.R = { askAnswerEl, askChartOk, askInline, askMd, askChartEl, askTableEl };`, ctx);
  return ctx.R;
}
const walk = (n, f) => { f(n); for (const c of n.children || []) walk(c, f); };

export default async function askTests(t) {
  const A = globalThis.__casatorchAsk, H = globalThis.__casatorch;
  /* ---- charts ---- */
  await t('ask: a chart keeps only known fields, 60 points, 3 series, numbers', () => {
    const c = A.askChart({ type: 'bar', title: 'Energy <b>7</b> days', unit: 'kWh', color: 'red', onload: 'x', x: Array.from({ length: 80 }, (_, i) => `d${i}`), series: [1, 2, 3, 4].map((k) => ({ name: `s${k}`, values: Array.from({ length: 80 }, (_, i) => (i === 3 ? 'evil' : i * k)), color: '#f00' })) });
    assert.deepEqual(Object.keys(c).sort(), ['series', 'title', 'type', 'unit', 'x']);
    assert.equal(c.x.length, 60); assert.equal(c.series.length, 3); assert.equal(c.series[0].values[3], null); assert.equal(c.title, 'Energy 7 days');
    assert.deepEqual(Object.keys(c.series[0]).sort(), ['name', 'values']);
  });
  await t('ask: unknown chart types, empty and broken specs are dropped', () => {
    for (const s of [null, [], 'x', { type: 'scatter', x: [1], series: [{ values: [1] }] }, { type: 'line', x: [], series: [{ values: [] }] }, { type: 'line', x: ['a'], series: [{ values: ['x'] }] }]) assert.equal(A.askChart(s), null);
  });
  await t('ask: a pie has no negative slices and folds more than 6 into "Other"', () => {
    const c = A.askChart({ type: 'pie', x: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'neg'], series: [{ name: 'kWh', values: [9, 8, 7, 6, 5, 4, 3, 2, -50] }] });
    assert.equal(c.x.length, 6); assert.equal(c.x[5], 'Other'); assert.equal(c.series[0].values[5], 9); assert.ok(c.series[0].values.every((v) => v > 0));
  });
  await t('ask: tables and tiles are capped and plain text', () => {
    const tb = A.askTable({ columns: Array.from({ length: 12 }, (_, i) => `c${i}<script>`), rows: Array.from({ length: 60 }, () => ['<img src=x onerror=alert(1)>ok', 2]) });
    assert.equal(tb.columns.length, 8); assert.equal(tb.rows.length, 40); assert.equal(tb.rows[0][0], 'ok'); assert.equal(tb.columns[0], 'c0');
    const st = A.askStats([{ label: 'Now', value: '1.2 kW', status: 'evil' }, { label: '', value: 'x' }, ...Array(9).fill({ label: 'a', value: 'b' })]);
    assert.equal(st[0].status, null); assert.equal(st.length, 6);
  });
  /* ---- text, links and the whole answer ---- */
  await t('ask: links only http(s), never javascript:, data: or a sign-in inside', () => {
    assert.equal(A.askUrl('javascript:alert(1)'), null); assert.equal(A.askUrl('data:text/html,<b>'), null); assert.equal(A.askUrl('https://user:pw@example.com/'), null); assert.equal(A.askUrl('ftp://example.com'), null);
    assert.equal(A.askUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
  });
  await t('ask: an answer\'s HTML never passes through; fences become checked blocks', () => {
    const text = 'Hi <script>alert(1)</script>**there**\n\n| Day | kWh |\n| --- | --- |\n| Mon | 3 |\n\n```chart\n{"type":"line","x":["a","b"],"series":[{"name":"x","values":[1,2]}]}\n```\n```html\n<iframe src="javascript:1">\n```\n```chart\nnot json\n```\n```devices\n["hue:1","nope"]\n```';
    const r = A.askParse(text, { devices: [{ id: 'hue:1', kind: 'light', name: 'Living room' }] });
    assert.ok(!JSON.stringify(r).includes('<script'), 'no script tag'); assert.ok(!JSON.stringify(r).includes('<iframe'), 'no iframe');
    assert.deepEqual(r.blocks.map((b) => b.type), ['md', 'table', 'chart', 'devices']);
    assert.deepEqual(r.blocks[3].ids, ['hue:1']); assert.deepEqual(r.blocks[1].rows, [['Mon', '3']]);
  });
  /* ---- the safety rule on what the AI offers ---- */
  await t('ask: offered actions only switch safe things, with labels CasaTorch writes', () => {
    const devices = [{ id: 'hue:1', kind: 'light', name: 'Living room' }, { id: 'ha:lock.front', kind: 'lock', name: 'Front door' }, { id: 'ha:cover.garage', kind: 'cover', haClass: 'garage', name: 'Garage door' },
      { id: 'ha:switch.gate_opener', kind: 'switch', name: 'Gate opener' }, { id: 'ha:alarm.home', kind: 'alarm', name: 'Alarm' }, { id: 'shelly:tv', kind: 'plug', name: 'TV' }];
    const byId = new Map(devices.map((d) => [d.id, d]));
    const acts = A.askActions([{ deviceIds: ['ha:lock.front'], action: 'unlock', label: 'Unlock' }, { deviceIds: ['ha:cover.garage'], action: 'toggle' }, { deviceIds: ['ha:switch.gate_opener', 'ha:alarm.home'], action: 'on' },
      { deviceIds: ['hue:1', 'shelly:tv', 'ha:lock.front', 'ghost'], action: 'off', label: 'Click me <script>' }], byId);
    assert.equal(acts.length, 1); assert.deepEqual(acts[0].deviceIds, ['hue:1', 'shelly:tv']); assert.equal(acts[0].label, 'Turn off Living room and TV');
    const r = A.askParse('Done.\n```offer\n{"text":"Unlock the door?","actions":[{"deviceIds":["ha:lock.front"],"action":"off"}],"ask":["a","b","c","d"]}\n```', { devices });
    assert.equal(r.offer.actions.length, 0); assert.equal(r.offer.ask.length, 3);
  });
  await t('ask: the system prompt carries the facts rules and the hard safety rule', () => {
    const s = A.askSystem({ tools: [{ name: 'energy' }] });
    assert.match(s, /Never guess, estimate or invent/); assert.match(s, /I don't know/); assert.match(s, /Never offer, or explain how, to unlock doors, open garage doors or gates, or disarm alarms/); assert.match(s, /```offer/);
  });
  /* ---- sources ---- */
  await t('ask: Wikipedia sources carry the CC BY-SA label and license link (others do not)', () => {
    const s = A.askSources([{ url: 'https://en.wikipedia.org/wiki/Lighthouse', title: 'Lighthouse' }, { url: 'https://example.org/x', title: 'X' }]);
    assert.equal(s[0].license, 'Wikipedia (CC BY-SA)'); assert.match(s[0].licenseUrl, /^https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/$/);
    assert.equal(s[1].license, undefined);
  });
  await t('ask: sources keep http(s) links, drop repeats, at most 8; home citations read plainly', () => {
    const s = A.askSources([{ url: 'https://www.example.com/a#x', title: 'A' }, { url: 'https://www.example.com/a', title: 'A again' }, { url: 'javascript:alert(1)', title: 'bad' }, ...Array.from({ length: 12 }, (_, i) => ({ url: `https://example.org/${i}` }))]);
    assert.equal(s.length, 8); assert.equal(s[0].site, 'example.com'); assert.equal(s[1].title, 'example.org');
    const from = A.askFrom([{ label: 'Energy, 7 days', at: '2026-10-18T21:41:00Z' }, { label: 'Energy, 7 days' }, { label: 'Weather at home (MET Norway)' }]);
    assert.equal(from.length, 2);
    assert.equal(A.askCiteLine(from, s.slice(0, 1), 'America/Los_Angeles'), 'From your home: Energy, 7 days (2:41 PM) · Weather at home (MET Norway)\nSources: [1] A - https://www.example.com/a#x');
  });
  /* ---- the browser's renderer: nothing executable comes out of an answer ---- */
  await t('ask (browser): the renderer builds no script, no event handlers, only http(s) links', () => {
    const R = loadRenderer();
    const node = R.askAnswerEl({ blocks: [{ type: 'md', text: '# Hi\n- [click](javascript:alert(1)) and [ok](https://example.com) <img src=x onerror=alert(1)>\n1. `code`' }, { type: 'chart', spec: { type: 'bar', title: '<svg onload=alert(1)>', x: ['a'], series: [{ name: 'n', values: [1] }] } },
      { type: 'chart', spec: { type: 'pie', x: ['a', 'b'], series: [{ name: 'n', values: [2, 3] }] } }, { type: 'table', columns: ['x'], rows: [['[y](data:text/html,1)']] }, { type: 'stats', items: [{ label: 'a', value: 'b', status: 'bad' }] }, { type: 'evil', html: '<script>' }],
    sources: [{ url: 'javascript:alert(1)', title: 'bad' }, { url: 'https://example.org/', title: 'good', site: 'example.org' }], offer: { text: 'More?', ask: ['Again'] } });
    const tags = [], hrefs = [];
    walk(node, (n) => { if (n.tagName) tags.push(n.tagName); for (const k of Object.keys(n.attrs || {})) assert.ok(!/^on/i.test(k), `no ${k} attribute`); if (n.attrs?.href) hrefs.push(n.attrs.href); });
    assert.ok(!tags.includes('script') && !tags.includes('img') && !tags.includes('iframe'));
    assert.deepEqual(hrefs, ['https://example.com/', 'https://example.org/']);
    assert.ok(tags.includes('svg') && tags.includes('table'));
    assert.equal(R.askChartOk({ type: 'line', x: ['a'], series: [{ values: ['<b>'] }] }), null);
  });
  await t('ask (browser): a Wikipedia source shows "Wikipedia (CC BY-SA)" with the license link', () => {
    const R = loadRenderer(), hrefs = [];
    const node = R.askAnswerEl({ blocks: [{ type: 'md', text: 'Hi' }], sources: [{ url: 'https://en.wikipedia.org/wiki/X', title: 'X', site: 'en.wikipedia.org', license: 'Wikipedia (CC BY-SA)', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }] });
    walk(node, (n) => { if (n.attrs?.href) hrefs.push(n.attrs.href); });
    assert.ok(hrefs.includes('https://creativecommons.org/licenses/by-sa/4.0/'));
    assert.match(JSON.stringify(node, (k, v) => (k === 'style' ? undefined : v)), /Wikipedia \(CC BY-SA\)/);
  });
  await t('ask (browser): the answer files never set HTML from text', () => {
    for (const f of ['25-ask.js', '25c-ask-render.js', '25p-ask-privacy.js']) { const src = fs.readFileSync(path.join(HERE, '../src/client', f), 'utf8'); assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|\bhtml:/, f); }
  });
  /* ---- tools and privacy ---- */
  const fakeGet = async (p) => {
    if (p === '/api/devices') return { devices: [{ id: 'hue:1', kind: 'light', name: 'Living room', area: 'Living room', on: true, brightness: 80 }, { id: 'cam:1', kind: 'camera', name: 'Driveway' }, { id: 'ha:person.alex', kind: 'presence', name: 'Alex', state: 'home' }], power: { watts: 1234 } };
    if (p.startsWith('/api/history')) return { days: [{ date: '2026-10-17', kwh: 20, cost: 3.4 }, { date: '2026-10-18', kwh: 9, cost: 1.5, partial: true }], rate: 0.17, maxDays: 730 };
    if (p.startsWith('/api/calendar')) return { events: [{ title: 'Dentist', start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 7200_000).toISOString() }] };
    throw new Error(`not in this test: ${p}`);
  };
  const ctxOf = (share = {}) => ({ get: fakeGet, share: { cameras: true, location: true, calendar: true, family: true, ...share }, webMode: 'off', lang: 'en', user: null });
  await t('ask: privacy switches take the tools away and hide cameras and people', async () => {
    const names = (c) => A.askToolsFor(c).map((x) => x.name);
    assert.ok(names(ctxOf()).includes('calendar') && names(ctxOf()).includes('cameras') && names(ctxOf()).includes('family'));
    const off = ctxOf({ cameras: false, calendar: false, family: false });
    assert.ok(!names(off).includes('calendar') && !names(off).includes('cameras') && !names(off).includes('family'));
    const r = await A.ASK_TOOLS.find((x) => x.name === 'home_devices').run({}, off);
    assert.deepEqual(r.data.devices.map((d) => d.id), ['hue:1']);
    assert.ok(!names({ ...ctxOf(), webMode: 'off' }).includes('web_search')); assert.ok(names({ ...ctxOf(), webMode: 'free' }).includes('web_search'));
  });
  await t('ask: the question loop runs the lookups the AI asks for and cites them', async () => {
    const seen = [], P = { name: 'Test AI', async turn(_c, { messages, tools, onText }) {
      seen.push(tools.map((x) => x.name));
      const last = messages.at(-1);
      if (last.role === 'user') return { text: '', calls: [{ id: 'a', name: 'energy', args: { what: 'days', days: 2 } }, { id: 'b', name: 'calendar', args: {} }, { id: 'c', name: 'unlock_everything', args: {} }], sources: [] };
      const res = Object.fromEntries(last.results.map((r) => [r.name, JSON.parse(r.content)]));
      assert.equal(res.energy.days[0].kwh, 20); assert.match(res.unlock_everything.error, /no lookup/); assert.equal(res.calendar.error, undefined);
      onText('Used '); onText('20 kWh.');
      return { text: `Used 20 kWh.\n\`\`\`chart\n{"type":"bar","x":["Sat"],"series":[{"name":"kWh","values":[${res.energy.days[0].kwh}]}]}\n\`\`\``, calls: [], sources: [{ url: 'https://example.com/x', title: 'X' }] };
    } };
    const ev = [];
    const out = await A.askRun({ p: P, c: {}, question: 'energy?', ctx: ctxOf({ calendar: true }), emit: (e) => ev.push(e) });
    assert.equal(out.text.split('\n')[0], 'Used 20 kWh.');
    assert.deepEqual(out.used.map((u) => u.label), ['Energy, 2 days', 'Calendar, next 7 days']);
    assert.deepEqual(ev.filter((e) => e.t === 'tool').map((e) => e.name), ['energy', 'calendar']);
    assert.equal(ev.filter((e) => e.t === 'text').map((e) => e.d).join(''), 'Used 20 kWh.');
    assert.equal(out.webSources[0].url, 'https://example.com/x');
  });
  await t('ask: a model without tool use gets one snapshot of the house instead', async () => {
    let n = 0; const P = { name: 'Old AI', async turn(_c, { system, tools }) { n++; if (tools.length) throw Object.assign(new Error('registry.ollama.ai/library/x does not support tools'), { status: 400, noTools: true }); assert.match(system, /House data right now/); assert.match(system, /Living room/); return { text: 'One light is on.', calls: [], sources: [] }; } };
    const out = await A.askRun({ p: P, c: {}, question: 'lights?', ctx: ctxOf() });
    assert.equal(out.text, 'One light is on.'); assert.equal(n, 2);
  });
  await t('ask: the stream readers handle split server-sent events and JSON lines', async () => {
    const body = (parts) => ({ body: (async function* g() { for (const p of parts) yield new TextEncoder().encode(p); })() });
    const got = []; for await (const e of A.aiSse(body(['data: {"a":', '1}\n\nevent: x\ndata: {"b":2}\n', '\ndata: [DONE]\n\n']))) got.push(e);
    assert.deepEqual(got, [{ a: 1 }, { b: 2 }]);
    const lines = []; for await (const e of A.aiLines(body(['{"x":1}\n{"y"', ':2}']))) lines.push(e);
    assert.deepEqual(lines, [{ x: 1 }, { y: 2 }]);
  });
  await t('ask: each provider gets tool results in its own shape', () => {
    const ms = [{ role: 'user', text: 'q' }, { role: 'assistant', text: '', calls: [{ id: 't1', name: 'energy', args: { what: 'now' } }] }, { role: 'tool', results: [{ id: 't1', name: 'energy', content: '{}' }] }];
    const ant = A.antMessages(ms); assert.equal(ant[1].content[0].type, 'tool_use'); assert.equal(ant[2].content[0].tool_use_id, 't1');
    const oai = A.oaiInput(ms); assert.equal(oai[1].type, 'function_call'); assert.equal(oai[2].type, 'function_call_output'); assert.equal(oai[2].call_id, 't1');
  });
  /* ---- end to end: /api/ask, streamed, with a stand-in AI that looks things up in the sample house ---- */
  await t('ask: end to end - streamed answer from real lookups, checked blocks, safe buttons', async () => {
    const env = { demo: process.env.CASATORCH_DEMO, pro: process.env.CASATORCH_PRO_DEV };
    process.env.CASATORCH_DEMO = '1'; process.env.CASATORCH_PRO_DEV = '1';
    A.useProvider({ name: 'Test AI', async turn(_c, { messages, onText }) {
      const last = messages.at(-1);
      if (last.role === 'user') return { text: '', calls: [{ id: 'l', name: 'home_devices', args: { kind: 'light', only_on: true } }, { id: 'k', name: 'home_devices', args: { kind: 'lock' } }], sources: [] };
      const lights = JSON.parse(last.results[0].content).devices, locks = JSON.parse(last.results[1].content).devices;
      const text = `**${lights.length} lights are on.** <script>x</script>\n\`\`\`devices\n${JSON.stringify(lights.map((d) => d.id))}\n\`\`\`\n\`\`\`offer\n${JSON.stringify({ text: 'Turn them off?', actions: [{ deviceIds: lights.map((d) => d.id), action: 'off' }, { deviceIds: locks.map((d) => d.id), action: 'off' }] })}\n\`\`\``;
      for (const part of text.match(/[\s\S]{1,20}/g)) onText(part);
      return { text, calls: [], sources: [] };
    } });
    const srv = H.app.listen(0, '127.0.0.1'); await new Promise((ok) => srv.once('listening', ok));
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Which lights are on?', stream: true }) });
      assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /ndjson/);
      const ev = (await r.text()).trim().split('\n').map((l) => JSON.parse(l)), done = ev.at(-1);
      assert.ok(ev.some((e) => e.t === 'tool' && e.name === 'home_devices')); assert.ok(ev.filter((e) => e.t === 'text').length > 3);
      assert.equal(done.t, 'done'); assert.ok(!JSON.stringify(done).includes('<script'));
      const on = done.blocks.find((b) => b.type === 'devices').ids; assert.ok(on.length >= 1);
      assert.equal(done.offer.actions.length, 1, 'the lock is never offered'); assert.deepEqual(done.offer.actions[0].deviceIds, on);
      assert.deepEqual(done.from.map((f) => f.label), ['Devices']);
    } finally { srv.close(); A.useProvider(null); if (env.demo === undefined) delete process.env.CASATORCH_DEMO; else process.env.CASATORCH_DEMO = env.demo; if (env.pro === undefined) delete process.env.CASATORCH_PRO_DEV; else process.env.CASATORCH_PRO_DEV = env.pro; }
  });
}
