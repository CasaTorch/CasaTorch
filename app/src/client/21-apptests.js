/* ---- Network > App tests: how well your apps answer from home, and the path there (77-apptests.js) ---- */
const AT_PHASES = [['dns', 'Finding it (DNS)'], ['connect', 'Connecting'], ['tls', 'Secure handshake'], ['wait', 'App\'s answer'], ['download', 'Download']];
const AT_ZONES = { home: 'Your home', provider: 'Your internet provider', internet: 'Networks in between', app: 'The app' };
const AT_GROUP_NAMES = { home: 'Your home\'s internet', calls: 'Video calls', work: 'Work and school', stream: 'Streaming', gaming: 'Gaming', everyday: 'Everyday' };
const AT_WHO_UI = { home: 'Your Wi-Fi or router', provider: 'Your internet provider', internet: 'A network in between', app: 'The app itself', dns: 'Name lookups (DNS)' };
const atMs = (v) => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)} s` : v < 10 ? `${(Math.round(v * 10) / 10).toString()} ms` : `${Math.round(v)} ms`);
const atAgo = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); if (!(s >= 0)) return ''; if (s < 60) return T('just now'); if (s < 3600) return T('{n} min ago', { n: Math.round(s / 60) }); if (s < 86400) return T('{n} h ago', { n: Math.round(s / 3600) }); return T('{n} d ago', { n: Math.round(s / 86400) }); };
const atState = (t) => (!t.last ? ['warn', T('Checking')] : t.down ? ['bad', T('Down')] : t.failing ? ['warn', T('Missed one')] : t.slow || (t.median24h && t.last.total > 2 * t.median24h && t.last.total > 800) ? ['warn', T('Slow')] : ['good', T('OK')]);
const atName = (t) => (t.preset && !t.custom && !/^SharePoint \(/.test(t.name) ? T(t.name) : t.name);
const atRegion = (cc) => { try { return new Intl.DisplayNames([CasaI18n.lang || 'en'], { type: 'region' }).of(cc); } catch { return cc; } };
/* The likely culprit in one sentence, in the home's language. */
function atCulpritLine(c, name) {
  if (!c?.who) return '';
  const who = T(AT_WHO_UI[c.who]) + (c.who === 'internet' && c.org ? ` (${c.org})` : '');
  const v = { who, hop: c.hop, ms: c.ms, loss: c.loss, name };
  if (c.kind === 'loss') return c.hop ? T('{who}: traffic is being lost from hop {hop} on ({loss}% loss).', v) : T('{who}: traffic is being lost on the way ({loss}% loss).', v);
  if (c.kind === 'delay') return c.hop ? T('{who}: the slowdown starts at hop {hop}, about {ms} ms more than usual.', v) : T('{who}: the slowdown starts there, about {ms} ms more than usual.', v);
  if (c.kind === 'stops') return T('{who}: the path stops answering after hop {hop}.', { ...v, hop: c.hop || 1 });
  if (c.kind === 'many') return T('{who}: several apps are having trouble at the same time.', v);
  if (c.kind === 'answer') return T('{who}: the network to {name} looks fine, but it\'s slow to answer.', v);
  if (c.kind === 'dns') return T('{who}: the app\'s address couldn\'t be looked up - that\'s your router or your internet provider.', v);
  if (c.kind === 'down' && c.who === 'app') return T('{who}: other apps are fine and the path reaches its network.', v);
  return who;
}
/* The five steps of a test as one bar: each step's share of the time, 2px gaps between. */
function atBar(r, big = false) {
  const parts = AT_PHASES.map(([k]) => [k, Math.max(0, r?.[k] || 0)]).filter(([, v]) => v > 0), sum = parts.reduce((s, [, v]) => s + v, 0);
  const bar = el('div', { class: `atbar${big ? ' big' : ''}`, role: 'img', 'aria-label': AT_PHASES.map(([k, l]) => `${T(l)} ${atMs(r?.[k])}`).join(', ') });
  if (!r?.ok || !sum) { bar.classList.add('empty'); return bar; }
  for (const [k, v] of parts) bar.append(el('i', { class: `ph-${k}`, style: `flex-grow:${v}`, title: `${T(AT_PHASES.find((p) => p[0] === k)[1])}: ${atMs(v)}` }));
  return bar;
}
/* The last day as a thin line (failures as red ticks along the bottom). */
function atSpark(vals) {
  const W = 160, H = 34, ok = vals.filter((v) => v >= 0), max = Math.max(1, ...ok) * 1.1, n = vals.length;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'atspark'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('preserveAspectRatio', 'none');
  if (n < 2) return svg;
  const x = (i) => (i / (n - 1)) * W, y = (v) => H - 3 - (v / max) * (H - 8);
  let d = '', pen = false;
  vals.forEach((v, i) => { if (v < 0) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); p.setAttribute('class', 'line'); svg.append(p);
  vals.forEach((v, i) => { if (v >= 0) return; const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); r.setAttribute('x', x(i) - 1); r.setAttribute('y', H - 4); r.setAttribute('width', 2); r.setAttribute('height', 4); r.setAttribute('class', 'fail'); svg.append(r); });
  return svg;
}
function atTile(t, onOpen) {
  const [dot, word] = t.paused ? ['warn', T('Paused (Pro)')] : atState(t), l = t.last, web = t.kind === 'web';
  return el('button', { class: `attile${t.down ? ' down' : t.slow ? ' slow' : ''}`, onclick: () => onOpen(t.id) },
    el('div', { class: 'row', style: 'gap:10px' }, el('span', { class: 'atbadge', 'aria-hidden': 'true' }, t.kind === 'router' ? icon('wifi') : t.short || t.name[0]), el('b', { class: 'grow ellipsis' }, atName(t)), el('span', { class: `pill ${dot}` }, el('span', { class: `dot ${dot}` }), word)),
    el('div', { class: 'row', style: 'gap:8px;align-items:baseline;margin-top:10px' }, el('span', { class: `atbig${l && !l.ok ? ' fail' : ''}` }, l?.ok ? atMs(l.total) : l ? T('No answer') : '…'),
      l?.ok ? el('span', { class: 'tiny muted' }, web ? T('to load') : t.kind === 'dns' || t.kind === 'dnsq' ? T('to look up a name') : T('round trip')) : el('span', { class: 'tiny muted ellipsis' }, l?.error || '')),
    web ? atBar(l) : null,
    el('div', { class: 'tiny muted atnet' }, l?.latency != null ? T('latency {lat} · jitter {jit} · loss {loss}%', { lat: atMs(l.latency), jit: atMs(l.jitter), loss: l.loss }) : l?.loss === 100 ? T('no answer to network probes (100% loss)') : T('network: -')),
    t.culprit?.who ? el('div', { class: 'tiny atculprit' }, `${T('Likely')}: ${T(AT_WHO_UI[t.culprit.who])}${t.culprit.hop ? ` · ${T('hop {n}', { n: t.culprit.hop })}` : ''}`) : null,
    el('div', { class: 'row between', style: 'gap:10px;margin-top:6px' }, el('span', { class: 'tiny muted' }, t.uptime24h != null ? `${T('{n}% up today', { n: t.uptime24h })}${t.hops ? ` · ${T('{n} hops', { n: t.hops })}` : ''}` : T('first test running')), atSpark(t.spark || [])),
    t.pathChangedAt && Date.now() - Date.parse(t.pathChangedAt) < 86400_000 ? el('div', { class: 'tiny', style: 'color:var(--warn);margin-top:4px' }, T('Path changed {when}', { when: atAgo(t.pathChangedAt) })) : null);
}
/* Plain words when this computer can't trace the path. */
const atNoTrace = (a) => el('p', { class: 'tiny muted', style: 'margin:10px 0 0' }, T('The hop-by-hop path needs a path-tracing tool (traceroute), and this computer doesn\'t have one. The tests themselves work.'), ' ',
  el('a', { href: 'https://casatorch.com/docs/use/app-tests.html#path', target: '_blank', rel: 'noopener' }, T('How to add it')));
function appTestsCard(a, redraw) {
  const card = el('div', { class: 'card apptests', style: 'margin-top:14px' });
  const head = el('div', {}, el('h2', { style: 'margin:0' }, T('App tests'), docLink('page.apptests', { icon: true, topic: T('App tests') })), el('p', { class: 'small muted', style: 'margin:4px 0 0' }, T('How fast your apps answer from home, and the path your traffic takes to get there.')));
  const add = !a.demo && a.tests.length < a.max ? el('button', { class: 'btn small', onclick: () => atAdd(a, redraw) }, icon('plus'), T('Add a test')) : null;
  card.append(el('div', { class: 'row between', style: 'margin-bottom:12px;align-items:flex-start;gap:12px' }, head, add));
  if (!a.tests.length) {
    const quick = ['router', 'google', 'youtube', 'zoom'].map((id) => a.presets.find((p) => p.id === id)).filter(Boolean);
    card.append(el('div', { class: 'atempty' }, el('p', { class: 'muted', style: 'margin:0 0 10px' }, T('Pick the apps you use - for work, school or at home - and CasaTorch tests them every few minutes: how long each step takes, latency, jitter and loss, and every hop from your router to the app.')),
      el('div', { class: 'row wrap', style: 'gap:8px' }, quick.map((p) => el('button', { class: 'btn small', onclick: async (e) => { e.currentTarget.disabled = true; try { await post('/api/apptests', { preset: p.id }); toast(T('{name} added', { name: T(p.name) })); redraw(); } catch (err) { toast(err.message); e.target.disabled = false; } } }, icon('plus'), T(p.name))),
        el('button', { class: 'btn small primary', onclick: () => atAdd(a, redraw) }, T('More apps…')))));
    return card;
  }
  card.append(el('div', { class: 'atgrid' }, a.tests.map((t) => atTile(t, (id) => atOpen(id, a, redraw)))));
  if (a.overview) card.append(pvOverview(a, (id) => atOpen(id, a, redraw)));
  if (!(a.trace?.ok ?? a.traceroute)) card.append(atNoTrace(a));
  if (!a.pro) card.append(el('p', { class: 'tiny muted', style: 'margin:10px 0 0' }, T('Basic tests the built-in apps (up to {n}).', { n: a.basicMax }), ' ', el('a', { href: '#settings' }, 'Pro'), ' ', T('adds your own websites, up to 30 tests, testing every minute, and an alert when an app is down or slow.')));
  return card;
}
function atAdd(a, redraw) {
  const have = new Set(a.tests.map((t) => t.preset).filter(Boolean));
  const every = el('select', { 'aria-label': T('How often'), style: 'width:auto' }, a.every.map((m) => el('option', { value: m, selected: m === 5 ? true : null }, m === 1 ? T('Every minute') : T('Every {n} minutes', { n: m }))));
  const msg = el('p', { class: 'small', style: 'min-height:1.2em;margin:8px 0 0' });
  const go = async (body, btn) => {
    btn.disabled = true; msg.style.color = ''; msg.textContent = T('Testing it…');
    try { const r = await post('/api/apptests', { ...body, every: Number(every.value) }); m.remove(); toast(r.test.last?.ok ? `${atName(r.test)}: ${atMs(r.test.last.total)}` : T('{name} added - it didn\'t answer yet', { name: atName(r.test) })); redraw(); }
    catch (e) { msg.style.color = 'var(--bad)'; msg.textContent = e.message; btn.disabled = false; }
  };
  const group = (g) => { const list = a.presets.filter((p) => p.group === g); return list.length ? el('div', { class: 'atpick' }, el('h3', {}, T(AT_GROUP_NAMES[g] || g)), el('div', { class: 'row wrap', style: 'gap:8px' },
    list.map((p) => el('button', { class: 'btn small', disabled: have.has(p.id) && p.id !== 'sharepoint' ? true : null, onclick: (e) => {
      if (p.needs === 'tenant') { const v = prompt(T('Your company\'s SharePoint name - the part before .sharepoint.com (for example, in contoso.sharepoint.com it\'s "contoso")')); if (v) go({ preset: p.id, tenant: v }, e.currentTarget); return; }
      go({ preset: p.id }, e.currentTarget);
    } }, el('span', { class: 'atbadge sm', 'aria-hidden': 'true' }, p.short), T(p.name), have.has(p.id) && p.id !== 'sharepoint' ? icon('check') : null)))) : null; };
  const url = el('input', { type: 'url', placeholder: 'https://example.com', autocomplete: 'off', disabled: a.pro ? null : true });
  const name = el('input', { placeholder: T('Name (optional)'), maxlength: 40, disabled: a.pro ? null : true });
  const own = el('div', { class: 'atpick' }, el('h3', {}, T('Your own website'), ' ', el('span', { class: 'pill pro' }, 'Pro')),
    a.pro ? el('div', { class: 'row wrap', style: 'gap:8px' }, el('div', { class: 'grow', style: 'min-width:200px' }, url), el('div', { style: 'width:180px;max-width:100%' }, name), el('button', { class: 'btn primary', onclick: (e) => go({ url: url.value, name: name.value }, e.currentTarget) }, T('Add')))
      : el('p', { class: 'small muted', style: 'margin:0' }, T('Test any website or web app - your bank, your company\'s portal, a school site, a game server\'s page.'), ' ', el('a', { href: '#settings', onclick: () => m.remove() }, T('Unlock with Pro'))));
  const m = modal(el('div', {}, (a.groups || ['home', 'calls', 'work', 'stream', 'gaming', 'everyday']).map(group), own,
    el('div', { class: 'row', style: 'gap:10px;margin-top:14px' }, el('span', { class: 'small muted' }, T('Test')), every),
    el('p', { class: 'tiny muted' }, T('Tests run from this CasaTorch straight to the app - they load the app\'s sign-in or home page, without signing in. Nothing goes through casatorch.com.')), msg), { title: T('Add an app test'), wide: true });
}
/* "Slower than ... ms, or more than ...% loss": your own alert limits (Pro). Empty: CasaTorch's own sense of slow. */
function atLimitsRow(t, a, id) {
  const inp = (v, max, label) => el('input', { type: 'number', min: 1, max, step: 1, value: v ?? '', placeholder: T('auto'), 'aria-label': label, disabled: a.demo ? true : null, style: 'width:84px' });
  const ms = inp(t.slowMs, 60000, T('Slower than (ms)')), loss = inp(t.lossPct, 100, T('Loss over (%)'));
  const save = async () => { try { await post(`/api/apptests/${encodeURIComponent(id)}`, { slowMs: ms.value === '' ? null : Number(ms.value), lossPct: loss.value === '' ? null : Number(loss.value) }, 'PUT'); toast(T('Saved')); } catch (e) { toast(e.message); } };
  ms.onchange = save; loss.onchange = save;
  return el('div', { class: 'row wrap atlimits', style: 'gap:8px;align-items:center;margin:4px 0' }, el('span', { class: 'small muted' }, T('Slow when over')), ms, el('span', { class: 'small muted' }, T('ms, or loss over')), loss, el('span', { class: 'small muted' }, '%'));
}
/* "Add a test", from anywhere on the Network page: an app, a network test (ping, a port, a name lookup), or a server to watch. */
function atAddAny(a, redraw, data = {}) {
  const have = new Set(a.tests.map((t) => t.preset).filter(Boolean)), full = a.tests.length >= a.max;
  const quick = ['router', 'dns'].map((id) => a.presets.find((p) => p.id === id)).filter((p) => p && !have.has(p.id));
  const opt = (ic, title, text, onclick, pro) => el('button', { type: 'button', class: 'atchoice', disabled: full && !pro?.server ? true : null, onclick: () => { m.remove(); onclick(); } },
    el('span', { class: 'atchoice-ic' }, icon(ic, 22)), el('span', { class: 'grow' }, el('b', {}, title, pro?.need ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'Pro') : null), el('span', { class: 'tiny muted' }, text)), icon('chevr', 18));
  const m = modal(el('div', { class: 'atchoices' },
    opt('gauge', T('An app or website'), T('Teams, Zoom, Netflix, your bank or your company\'s portal: how fast it loads from home, and the path there.'), () => atAdd(a, redraw)),
    opt('wifi', T('A network test'), T('A ping, a port or a name lookup to anything - your NAS, the gateway, a game server - with your own alert limits.'), () => atAddNet(a, redraw, data), { need: !a.pro }),
    opt('nbox', T('A server or app at home'), T('Your NAS, Plex or Home Assistant: up or down, response time and certificates.'), () => (data.mo?.pro ? monAdd(redraw) : (location.hash = '#settings/pro')), { need: !data.mo?.pro, server: true }),
    quick.length && !full ? el('div', { class: 'atquick' }, el('span', { class: 'tiny muted' }, T('One tap:')), quick.map((p) => el('button', { class: 'btn small', onclick: async (e) => { e.currentTarget.disabled = true; try { await post('/api/apptests', { preset: p.id }); m.remove(); toast(T('{name} added', { name: T(p.name) })); redraw(); } catch (err) { toast(err.message); e.target.disabled = false; } } }, icon('plus', 14), T(p.name)))) : null,
    full ? el('p', { class: 'small muted' }, a.pro ? T('Up to {n} tests - remove one first.', { n: a.max }) : T('Up to {n} tests on Basic. Pro allows up to 30.', { n: a.max })) : null), { title: T('Add a test') });
}
const AT_NET_DNS = [['', 'The one this CasaTorch uses (usually your provider\'s)'], ['1.1.1.1', 'Cloudflare (1.1.1.1)'], ['8.8.8.8', 'Google (8.8.8.8)'], ['9.9.9.9', 'Quad9 (9.9.9.9)'], ['other', 'Another one...']];
function atAddNet(a, redraw, data = {}) {
  let kind = 'ping';
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': T('Kind of test') });
  const host = el('input', { autocomplete: 'off', placeholder: '192.168.1.20  or  example.com' });   // scrub-ok: example
  const port = el('input', { type: 'number', min: 1, max: 65535, placeholder: '445', style: 'width:110px' });
  const qname = el('input', { autocomplete: 'off', placeholder: 'example.com' });
  const server = el('select', {}, AT_NET_DNS.map(([v, l]) => el('option', { value: v }, T(l)))), other = el('input', { autocomplete: 'off', placeholder: '192.168.1.1', hidden: true });
  const name = el('input', { maxlength: 40, placeholder: T('Name (optional)') });
  const every = el('select', { 'aria-label': T('How often'), style: 'width:auto' }, a.every.map((x) => el('option', { value: x, selected: x === 5 ? true : null }, x === 1 ? T('Every minute') : T('Every {n} minutes', { n: x }))));
  const slow = el('input', { type: 'number', min: 10, max: 60000, placeholder: T('auto'), style: 'width:90px' }), loss = el('input', { type: 'number', min: 1, max: 100, placeholder: T('auto'), style: 'width:76px' });
  const msg = el('p', { class: 'small', style: 'min-height:1.2em;margin:8px 0 0' });
  const field = (label, ...k) => el('label', { class: 'field' }, el('span', {}, label), ...k);
  const gw = data.inet?.gateway;
  const chip = (label, fill) => el('button', { type: 'button', class: 'chipbtn', onclick: () => { fill(); } }, label);
  const hostF = field(T('Host name or address'), host, el('div', { class: 'row wrap', style: 'gap:6px;margin-top:6px' },
    gw ? chip(T('Your router ({ip})', { ip: gw }), () => { host.value = gw; name.value ||= T('Router'); }) : null, chip('Cloudflare 1.1.1.1', () => { host.value = '1.1.1.1'; }), chip('Google 8.8.8.8', () => { host.value = '8.8.8.8'; })));
  const portF = field(T('Port'), el('div', { class: 'row wrap', style: 'gap:6px' }, port, ...[[22, 'SSH'], [445, T('File sharing')], [8123, 'Home Assistant'], [32400, 'Plex']].map(([p, l]) => chip(`${l} (${p})`, () => { port.value = p; }))));
  const dnsF = el('div', {}, field(T('Name to look up'), qname), field(T('Name server'), server, other));
  server.onchange = () => { other.hidden = server.value !== 'other'; };
  const url = el('input', { type: 'url', placeholder: 'https://example.com', autocomplete: 'off' }), urlF = field(T('Web address'), url);
  const kinds = [['ping', T('Ping')], ['tcp', T('Port')], ['dnsq', T('Name lookup')], ['web', T('Website')]];
  const help = el('p', { class: 'tiny muted', style: 'margin:4px 0 0' });
  const HELP = { ping: T('Round trip, jitter and loss to any device on your network or on the internet.'), tcp: T('Whether it accepts a connection on that port, and how fast.'), dnsq: T('How fast a name server answers - yours, or a public one to compare.'), web: T('How fast a web page loads, step by step.') };
  const sync = () => { [...seg.children].forEach((x, i) => x.classList.toggle('on', kinds[i][0] === kind)); hostF.hidden = !['ping', 'tcp'].includes(kind); portF.hidden = kind !== 'tcp'; dnsF.hidden = kind !== 'dnsq'; urlF.hidden = kind !== 'web'; help.textContent = HELP[kind]; };
  seg.append(...kinds.map(([k, l]) => el('button', { type: 'button', onclick: () => { kind = k; sync(); } }, l)));
  const go = el('button', { class: 'btn primary', disabled: a.pro ? null : true, onclick: async () => {
    go.disabled = true; msg.style.color = ''; msg.textContent = T('Testing it…');
    const lim = { slowMs: slow.value === '' ? null : Number(slow.value), lossPct: loss.value === '' ? null : Number(loss.value) };
    const body = kind === 'web' ? { url: url.value, name: name.value } : kind === 'dnsq' ? { kind, host: qname.value, server: server.value === 'other' ? other.value : server.value, name: name.value } : { kind, host: host.value, port: kind === 'tcp' ? Number(port.value) : undefined, name: name.value };
    try { const r = await post('/api/apptests', { ...body, ...lim, every: Number(every.value) }); m.remove(); toast(r.test.last?.ok ? `${atName(r.test)}: ${atMs(r.test.last.total)}` : T('{name} added - it didn\'t answer yet', { name: atName(r.test) })); redraw(); }
    catch (e) { msg.style.color = 'var(--bad)'; msg.textContent = e.message; go.disabled = false; }
  } }, T('Add test'));
  const m = modal(el('div', {}, seg, help, hostF, portF, dnsF, urlF, field(T('Name'), name),
    el('div', { class: 'row wrap', style: 'gap:10px;align-items:center;margin-top:6px' }, el('span', { class: 'small muted' }, T('Test')), every),
    el('div', { class: 'row wrap', style: 'gap:8px;align-items:center;margin-top:10px' }, el('span', { class: 'small muted' }, T('Alert when slower than')), slow, el('span', { class: 'small muted' }, T('ms, or loss over')), loss, el('span', { class: 'small muted' }, '%')),
    a.pro ? null : el('p', { class: 'small muted' }, T('Network tests are part of Pro.'), ' ', el('a', { href: '#settings/pro', onclick: () => m.remove() }, T('Unlock with Pro'))),
    el('p', { class: 'tiny muted' }, T('Tests run from this CasaTorch. Nothing goes through casatorch.com.')), msg, el('div', { class: 'row', style: 'justify-content:flex-end' }, go)), { title: T('Add a network test') });
  sync(); setTimeout(() => host.focus(), 30);
}
/* The detail sheet: what's wrong (if anything), the last test step by step, the path hop by hop, and the history. */
async function atOpen(id, a, redraw) {
  const body = el('div', { class: 'atdetail' }, el('p', { class: 'muted' }, T('Loading…')));
  const m = modal(body, { title: T('App test'), wide: true });
  m.querySelector('.box')?.classList.add('pvwide');   // the path graph likes room
  const draw = (t) => {
    const [dot, word] = atState(t), l = t.last, web = t.kind === 'web', nm = atName(t);
    const runBtn = el('button', { class: 'btn small primary', onclick: async () => { runBtn.disabled = true; runBtn.lastChild.textContent = T('Testing…'); try { draw(await post(`/api/apptests/${encodeURIComponent(id)}/run`, {})); } catch (e) { toast(e.message); runBtn.disabled = false; } } }, icon('play'), T('Test now'));
    const canTrace = (a.trace?.ok ?? a.traceroute) && t.kind !== 'router';
    const pathBtn = el('button', { class: 'btn small', onclick: async () => { pathBtn.disabled = true; pathBtn.lastChild.textContent = T('Tracing (up to a minute)…'); try { draw(await post(`/api/apptests/${encodeURIComponent(id)}/run?path=1`, {})); } catch (e) { toast(e.message); pathBtn.disabled = false; } } }, icon('reset'), T('Trace the path now'));
    const every = el('select', { 'aria-label': T('How often'), disabled: a.demo ? true : null, onchange: async () => { try { await post(`/api/apptests/${encodeURIComponent(id)}`, { every: Number(every.value) }, 'PUT'); toast(T('Saved')); redraw(); } catch (e) { toast(e.message); } } },
      a.every.map((n) => el('option', { value: n, selected: n === t.every ? true : null }, n === 1 ? T('Every minute') : T('Every {n} minutes', { n }))));
    const alertBox = el('label', { class: 'row atalert', style: 'gap:6px', title: a.pro ? null : T('Alerts are part of Pro') }, el('input', { type: 'checkbox', checked: t.alert && a.pro ? true : null, disabled: a.demo || !a.pro ? true : null,
      onchange: async (e) => { try { await post(`/api/apptests/${encodeURIComponent(id)}`, { alert: e.target.checked }, 'PUT'); toast(T('Saved')); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; } } }), el('span', { class: 'small' }, T('Alert me when it\'s down or slow')), a.pro ? null : el('span', { class: 'pill pro' }, 'Pro'));
    const del = a.demo ? null : el('button', { class: 'btn small ghost danger', onclick: async () => { if (!confirm(T('Stop testing {name}?', { name: nm }))) return; try { await api(`/api/apptests/${encodeURIComponent(id)}`, { method: 'DELETE' }); m.remove(); redraw(); } catch (e) { toast(e.message); } } }, icon('x'), T('Remove'));
    const steps = el('div', { class: 'atsteps' }, AT_PHASES.map(([k, lab]) => el('div', { class: 'atstep' }, el('i', { class: `sw ph-${k}`, 'aria-hidden': 'true' }), el('span', { class: 'grow' }, T(lab)), el('b', {}, atMs(l?.[k])))),
      el('div', { class: 'atstep total' }, el('span', { class: 'grow' }, T('Total')), el('b', {}, l?.ok ? atMs(l.total) : T('No answer'))));
    const verdict = t.culprit?.who ? el('div', { class: `atverdict ${t.down ? 'bad' : 'warn'}`, role: 'status' }, el('b', {}, t.down ? T('{name} isn\'t answering from home', { name: nm }) : T('{name} is slow from home', { name: nm })), el('span', {}, el('span', { class: 'muted' }, `${T('Likely culprit')} · `), atCulpritLine(t.culprit, nm)), t.culprit.sure === false ? el('span', { class: 'tiny muted' }, T('A best guess from the path and your other tests.')) : null)
      : t.down || t.slow ? el('div', { class: `atverdict ${t.down ? 'bad' : 'warn'}`, role: 'status' }, el('b', {}, t.down ? T('{name} isn\'t answering from home', { name: nm }) : T('{name} is slow from home', { name: nm })), el('span', {}, T('Nothing along the path stands out yet - CasaTorch keeps watching.'))) : null;
    body.replaceChildren(...[
      el('div', { class: 'row between wrap', style: 'gap:10px' }, el('div', { class: 'row', style: 'gap:12px;min-width:0' }, el('span', { class: 'atbadge lg', 'aria-hidden': 'true' }, t.kind === 'router' ? icon('wifi') : t.short), el('div', { style: 'min-width:0' }, el('h2', { style: 'margin:0' }, nm), el('div', { class: 'tiny muted ellipsis' }, t.url || t.target || (t.kind === 'router' ? T('Your router, timed from this CasaTorch') : T('How fast this home looks up names'))))),
        el('span', { class: `pill ${dot}` }, el('span', { class: `dot ${dot}` }), word)),
      el('div', { class: 'row wrap', style: 'gap:8px;margin:12px 0 4px;align-items:center' }, a.demo ? null : runBtn, a.demo || !canTrace ? null : pathBtn, every, alertBox, del),
      a.pro ? atLimitsRow(t, a, id) : null,
      verdict,
      el('div', { class: 'atcols' },
        web ? el('section', {}, el('h3', {}, T('Last test'), l ? el('span', { class: 'tiny muted', style: 'font-weight:400;margin-left:6px' }, atAgo(l.at)) : null), atBar(l, true), steps, l?.error ? el('p', { class: 'small', style: 'color:var(--bad)' }, T('Didn\'t work: {why}', { why: l.error })) : null,
          l?.status ? el('p', { class: 'tiny muted' }, l.ip ? T('The app answered {status} from {ip}.', { status: l.status, ip: l.ip }) : T('The app answered {status}.', { status: l.status })) : null)
          : el('section', {}, el('h3', {}, T('Last test'), l ? el('span', { class: 'tiny muted', style: 'font-weight:400;margin-left:6px' }, atAgo(l.at)) : null), el('div', { class: 'atsteps' }, el('div', { class: 'atstep total' }, el('span', { class: 'grow' }, t.kind === 'dns' || t.kind === 'dnsq' ? T('Time to look up a name') : t.kind === 'router' ? T('Round trip to the router') : T('Round trip')), el('b', {}, l?.ok ? atMs(l.total) : T('No answer')))),
            l?.ip ? el('p', { class: 'tiny muted' }, t.kind === 'dns' ? T('Asked {ip}, the name server this computer uses.', { ip: l.ip }) : t.kind === 'dnsq' ? T('Asked {ip}.', { ip: l.ip }) : t.kind === 'router' ? T('Your router is {ip}.', { ip: l.ip }) : T('Its address: {ip}', { ip: l.ip })) : null, l?.error ? el('p', { class: 'small', style: 'color:var(--bad)' }, T('Didn\'t work: {why}', { why: l.error })) : null),
        el('section', {}, el('h3', {}, web ? T('Network to the app') : T('Network')), el('div', { class: 'atstats' },
          [['Latency', atMs(l?.latency), 'how long a round trip takes'], ['Jitter', atMs(l?.jitter), 'how much that wobbles'], ['Loss', l?.loss != null ? `${l.loss}%` : '-', 'probes that got no answer']].map(([k, v, s]) => el('div', { class: 'atstat' }, el('span', { class: 'tiny muted' }, T(k)), el('b', {}, v), el('span', { class: 'tiny muted' }, T(s))))),
          el('p', { class: 'tiny muted' }, T('From five quick connections each test. Video calls stay smooth with latency under about 100 ms, jitter under 30 ms and no loss.')))),
      el('h3', { style: 'margin-top:18px' }, T('Path, hop by hop'), t.path?.at && t.path.hops?.length ? el('span', { class: 'tiny muted', style: 'font-weight:400;margin-left:6px' }, T('traced {when}', { when: atAgo(t.path.at) })) : null),
      pvSection(t, a, nm, id),
      web ? el('h3', { style: 'margin-top:18px' }, T('Time to load today')) : null, web ? atChart(t.runs || []) : null].filter(Boolean));
  };
  try { draw(await api(`/api/apptests/${encodeURIComponent(id)}`)); } catch (e) { body.replaceChildren(el('p', { class: 'small', style: 'color:var(--bad)' }, e.message)); }
}
/* The day's tests as a line (time to load), with a crosshair and a tooltip on hover or touch. */
function atChart(runs) {
  const box = el('div', { class: 'atchart' });
  if (runs.length < 2) { box.append(el('p', { class: 'small muted' }, T('The chart fills in as tests run.'))); return box; }
  const paint = () => {
    const W = Math.max(280, box.clientWidth || 600), H = 170, padL = 54, padR = 8, padT = 10, padB = 22;
    const t0 = Date.parse(runs[0].at), t1 = Date.parse(runs[runs.length - 1].at), okv = runs.filter((r) => r.ok).map((r) => r.total);
    const top = Math.max(100, Math.ceil(Math.max(...okv, 1) * 1.15 / 100) * 100);
    const x = (t) => padL + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (W - padL - padR), y = (v) => padT + (H - padT - padB) * (1 - Math.min(v, top) / top);
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), add = (tag, at, txt) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; svg.append(e); return e; };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', T('Time to load over the day: median {ms}, {n} failed tests', { ms: atMs([...okv].sort((p, q) => p - q)[Math.floor(okv.length / 2)]), n: runs.filter((r) => !r.ok).length }));
    for (const v of [0, top / 2, top]) { add('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }); add('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, atMs(v)); }
    let d = '', pen = false;
    for (const r of runs) { if (!r.ok) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(Date.parse(r.at)).toFixed(1)},${y(r.total).toFixed(1)}`; pen = true; }
    add('path', { d, class: 'line' });
    for (const r of runs) if (!r.ok) add('rect', { x: x(Date.parse(r.at)) - 1.5, y: H - padB - 6, width: 3, height: 6, rx: 1, class: 'fail' });
    for (const [t, anchor] of [[t0, 'start'], [t1, 'end']]) add('text', { x: x(t), y: H - 5, 'text-anchor': anchor, class: 'axis' }, fmtTime(new Date(t).toISOString()));
    const cross = add('line', { y1: padT, y2: H - padB, class: 'cross', visibility: 'hidden' }), mark = add('circle', { r: 4.5, class: 'mark', visibility: 'hidden' });
    const tip = el('div', { class: 'attip', hidden: true });
    const show = (cx) => {
      let best = runs[0]; for (const r of runs) if (Math.abs(x(Date.parse(r.at)) - cx) < Math.abs(x(Date.parse(best.at)) - cx)) best = r;
      const px = x(Date.parse(best.at)); cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      if (best.ok) { mark.setAttribute('cx', px); mark.setAttribute('cy', y(best.total)); mark.setAttribute('visibility', 'visible'); } else mark.setAttribute('visibility', 'hidden');
      tip.replaceChildren(el('b', {}, fmtTime(best.at)), el('div', {}, best.ok ? T('{ms} to load', { ms: atMs(best.total) }) : T('No answer: {why}', { why: best.error || T('failed') })),
        best.ok ? el('div', { class: 'tiny muted' }, `DNS ${atMs(best.dns)} · ${T('connect')} ${atMs(best.connect)} · ${T('handshake')} ${atMs(best.tls)} · ${T('answer')} ${atMs(best.wait)}`) : null,
        best.latency != null ? el('div', { class: 'tiny muted' }, T('latency {lat} · jitter {jit} · loss {loss}%', { lat: atMs(best.latency), jit: atMs(best.jitter), loss: best.loss })) : null);
      tip.hidden = false; tip.style.left = `${Math.min(Math.max(px - 110, 0), W - 230)}px`;
    };
    const hit = add('rect', { x: padL, y: 0, width: W - padL - padR, height: H, fill: 'transparent' });
    const pos = (e) => { const b = svg.getBoundingClientRect(); return ((e.touches?.[0]?.clientX ?? e.clientX) - b.left) * (W / b.width); };
    hit.addEventListener('pointermove', (e) => show(pos(e))); hit.addEventListener('pointerdown', (e) => show(pos(e)));
    hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); mark.setAttribute('visibility', 'hidden'); });
    box.replaceChildren(svg, tip);
  };
  atWatchWidth(box, paint);
  return box;
}
/* Repaint a chart when its box changes width; let go once it's off the page. */
function atWatchWidth(box, paint) {
  let lastW = 0; const ro = new ResizeObserver(() => { if (!box.isConnected) { if (lastW) ro.disconnect(); return; } if (Math.abs(box.clientWidth - lastW) > 4) { lastW = box.clientWidth; paint(); } }); ro.observe(box);
}

/* ---- the path: this CasaTorch, every hop, then the app ----
   Each hop shows its round trip as a bar (the dark part is the average, the light band runs from the fastest to the
   slowest probe) and is colored by loss. Loss at one router that doesn't carry on to the app is shown gray: many
   routers don't bother answering traces, and that doesn't slow your traffic. Tap a hop for everything about it. */
function atPathNodes(t, nm) {
  const p = t.path;
  return [{ you: true, zone: 'home', label: T('This CasaTorch'), avg: 0 }, ...(p.hops || []).map((h) => ({ ...h, label: h.name || h.ip || T('no reply') })),
    { ...(p.dest || {}), dest: true, zone: 'app', label: nm }];
}
/* Does a hop's loss carry on to the app (real), or is it just that router not answering traces? */
const atLossReal = (nodes, i) => nodes[i].loss >= 10 && nodes[i].loss < 100 && nodes.slice(i + 1).filter((x) => x.dest ? x.loss != null : x.ip && x.loss < 100).every((x) => x.loss >= 10);
function atPath(t, a, nm) {
  const p = t.path;
  if (t.kind === 'router' || (['dns', 'dnsq', 'ping', 'tcp'].includes(t.kind) && p?.none === 'home')) return el('p', { class: 'small muted' }, T('This test stays inside your home, so there\'s no path to trace.'));
  if (!(a.trace?.ok ?? a.traceroute) || p?.none === 'tool') return atNoTrace(a);
  if (!p || !p.hops?.length) return el('p', { class: 'small muted' }, p ? T('The last trace got no answers along the way - some networks block traces. CasaTorch tries again every 15 minutes.') : T('Tracing the path - it shows up here within a few minutes.'));
  const nodes = atPathNodes(t, nm), scale = Math.max(5, ...nodes.map((n) => n.max ?? n.avg ?? 0)) * 1.05;
  const info = el('div', { class: 'athopinfo', 'aria-live': 'polite' });
  let sel = null;
  const pickNode = (i, btn) => { sel?.classList.remove('sel'); sel = btn; btn.classList.add('sel'); info.replaceChildren(atHopInfo(nodes, i, t, nm)); };
  const groups = []; nodes.forEach((n, i) => { const g = groups[groups.length - 1]; if (g && g.zone === n.zone) g.items.push(i); else groups.push({ zone: n.zone, items: [i] }); });
  const startAt = t.culprit?.who ? nodes.findIndex((n) => (t.culprit.hop ? n.n === t.culprit.hop && !n.you : n.dest && t.culprit.who === 'app')) : -1;
  const btnOf = (i) => {
    const n = nodes[i], quiet = !n.you && !n.dest && !n.ip, real = atLossReal(nodes, i), lossC = n.you ? '' : quiet ? ' quiet' : n.loss >= 100 && n.dest ? ' l-bad' : real || (n.dest && n.loss >= 10) ? ' l-bad' : n.loss > 0 ? ' l-minor' : ' l-ok';
    const w = n.avg != null ? Math.max(2, n.avg / scale * 100) : 0, lo = n.min != null ? n.min / scale * 100 : null, hi = n.max != null ? n.max / scale * 100 : null;
    const ms = n.you ? '' : n.avg != null ? atMs(n.avg) : quiet ? T('quiet') : T('No answer');
    const b = el('button', { type: 'button', class: `atnode${lossC}${n.you ? ' you' : ''}${n.dest ? ' dest' : ''}${i === startAt ? ' start' : ''}`, role: 'listitem',
      'aria-label': [n.you ? n.label : n.dest ? n.label : T('Hop {n}', { n: n.n }), n.ip, n.org, ms, n.loss ? T('{n}% loss', { n: n.loss }) : null].filter(Boolean).join(', '), onclick: () => pickNode(i, b) },
      el('span', { class: 'atnum', 'aria-hidden': 'true' }, n.you ? icon('home') : n.dest ? (t.short || '•') : String(n.n)),
      el('span', { class: 'atnlab ellipsis' }, n.you || n.dest ? n.label : n.ip ? (n.name || n.ip) : T('no reply')),
      el('span', { class: 'atnown tiny muted ellipsis' }, n.you ? T('start') : n.dest ? (n.org || n.ip || '') : n.org || (n.ip && n.name ? n.ip : n.ip ? T(AT_ZONES[n.zone] || '') : '')),
      el('span', { class: 'atlat', 'aria-hidden': 'true' }, n.you ? null : el('i', { class: 'avg', style: `width:${w}%` }), lo != null && hi != null && hi > lo ? el('i', { class: 'rng', style: `left:${lo}%;width:${Math.max(1, hi - lo)}%` }) : null),
      el('span', { class: 'atnms tiny' }, ms, !n.you && n.loss > 0 && n.loss < 100 ? el('span', { class: real || n.dest ? 'lossbad' : 'lossminor' }, ` · ${n.loss}%`) : null),
      i === startAt ? el('span', { class: 'atflag' }, T('starts here')) : null);
    return b;
  };
  const row = el('div', { class: 'atpath2', role: 'list', 'aria-label': T('Path to {name}: {n} hops', { name: nm, n: nodes.length - 2 }) }, groups.map((g) => el('div', { class: `atzone2 z-${g.zone}` },
    el('div', { class: 'atzlabel' }, T(AT_ZONES[g.zone]), g.zone === 'provider' && !nodes.some((n) => n.zone === 'provider' && n.asn) ? el('span', { class: 'muted', title: T('Worked out from the hops\' names - providers don\'t label their routers consistently.') }, ` ${T('(estimated)')}`) : null),
    el('div', { class: 'atznodes2' }, g.items.map(btnOf)))));
  const legend = el('div', { class: 'atlegend tiny muted' }, el('span', {}, el('i', { class: 'lg l-ok' }), T('no loss')), el('span', {}, el('i', { class: 'lg l-minor' }), T('a router skipping trace replies (harmless)')), el('span', {}, el('i', { class: 'lg l-bad' }), T('loss that reaches the app')), el('span', {}, el('i', { class: 'lg quiet' }), T('doesn\'t answer traces (normal)')));
  const facts = [T('{n} hops', { n: nodes.length - 1 }), p.mtu ? T('largest packet (MTU) {n} bytes', { n: p.mtu }) : null, p.dest?.from === 'probe' ? T('the app\'s own numbers come from the connection probes') : null].filter(Boolean).join(' · ');
  const changed = t.pathChangedAt && Date.now() - Date.parse(t.pathChangedAt) < 7 * 86400_000 ? el('p', { class: 'small', style: 'color:var(--warn);margin:8px 0 0' }, T('The route changed {when}. Routes change now and then; if the app got slower at the same time, the new route may be the reason.', { when: atAgo(t.pathChangedAt) })) : null;
  const owners = a.demo ? null : el('label', { class: 'row tiny muted atowners', style: 'gap:6px;margin-top:8px;align-items:center' }, el('input', { type: 'checkbox', checked: a.owners !== false ? true : null, onchange: async (e) => { try { await post('/api/apptests/settings', { owners: e.target.checked }, 'PUT'); a.owners = e.target.checked; toast(T('Saved')); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; } } }),
    T('Show who runs each network (looked up by address in a public directory, over DNS)'));
  const wrap = el('div', {}, ...[el('div', { class: 'atpathwrap2', tabindex: 0, role: 'region', 'aria-label': T('Network path') }, row), info, legend, el('p', { class: 'tiny muted', style: 'margin:6px 0 0' }, facts), changed, owners].filter(Boolean));
  const first = startAt >= 0 ? startAt : nodes.length - 1;
  requestAnimationFrame(() => { const b = row.querySelectorAll('.atnode')[first]; if (b) pickNode(first, b); });
  return wrap;
}
function atHopInfo(nodes, i, t, nm) {
  const n = nodes[i], dl = el('dl', { class: 'kv athopkv' }), add = (k, v) => { if (v != null && v !== '') dl.append(el('dt', {}, T(k)), el('dd', {}, v)); };
  const title = n.you ? T('This CasaTorch') : n.dest ? nm : T('Hop {n}', { n: n.n });
  if (n.you) { dl.append(el('dt', {}, T('Where')), el('dd', {}, T('The start of the path: every time on this page is a round trip from here.'))); return el('div', {}, el('b', {}, title), dl); }
  add('Where', T(AT_ZONES[n.zone] || 'Internet'));
  add('Address', n.ip || T('no reply'));
  if (n.name && n.name !== n.ip && (!n.dest || n.name !== n.label)) add('Name', n.name);
  add('Network', n.org || n.asn ? `${n.org || ''}${n.asn ? ` (AS${n.asn})` : ''}`.trim() : null);
  add('Registered in', n.cc ? atRegion(n.cc) : null);
  if (n.avg != null) add('Round trip', T('{avg} average · {min} fastest · {max} slowest', { avg: atMs(n.avg), min: atMs(n.min), max: atMs(n.max) }));
  if (n.usual != null && n.avg != null) add('Usual', `${atMs(n.usual)}${n.avg - n.usual >= 20 ? ` · ${T('{ms} more than usual now', { ms: atMs(n.avg - n.usual) })}` : ''}`);
  if (n.sent) add('Loss', n.loss >= 100 && !n.dest ? T('It didn\'t answer any of the {n} probes. Many routers stay quiet - that\'s normal when the hops after it answer.', { n: n.sent }) : n.loss > 0 && !atLossReal(nodes, i) && !n.dest ? T('{loss}% of {n} probes - only here, not further on, so it\'s this router skipping trace replies, not lost traffic.', { loss: n.loss, n: n.sent }) : T('{loss}% of {n} probes', { loss: n.loss, n: n.sent }));
  if (n.ips?.length > 1) add('Also answered from', n.ips.slice(1).join(', '));
  if (n.seen && t.path?.traces) add('Seen', T('in {n} of the last {m} traces', { n: n.seen, m: t.path.traces }));
  return el('div', {}, el('b', {}, title), dl);
}
function atChangeText(c) {
  if (c.kind === 'mtu') return T('Largest packet size (MTU) changed: {a} → {b} bytes', { a: c.mtuFrom, b: c.mtuTo });
  const from = (c.from || []).join(' → ') || '?', to = (c.to || []).join(' → ') || '?';
  return from === to ? T('Route changed ({a} → {b} hops)', { a: c.hopsFrom, b: c.hopsTo }) : T('Route changed: {from} became {to}', { from, to });
}

/* ---- the path graph: every trace in a time window merged into one picture (atGraph in 77-apptests.js) ----
   Left to right from your home to the app (top to bottom on a phone), in bands by whose network it is. Routers that
   share the traffic show as branches that split and rejoin; a hop that doesn't answer traces is a dashed "no reply".
   Color is loss (green none, amber at that router only - harmless, red loss that carries on to the app), a ring is
   delay a hop adds, a link's label is the delay between its ends, and a thick red link is much slower than usual.
   Above it, a strip of the last day or week: drag across it (or tap) to see the path at that time. */
const PV_BAND = { home: 'Your home network', provider: 'Your internet provider', internet: 'Transit network', app: 'The app\'s network' };
const PV_NS = 'http://www.w3.org/2000/svg';
const pvS = (tag, at = {}, parent = null, txt = null) => { const e = document.createElementNS(PV_NS, tag); for (const [k, v] of Object.entries(at)) if (v != null && v !== false) e.setAttribute(k, v); if (txt != null) e.textContent = txt; if (parent) parent.append(e); return e; };
const pvCut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s; };
const pvReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const pvLoss = (n) => (n.kind === 'you' ? 'you' : n.kind === 'silent' ? 'quiet' : n.loss == null ? (n.kind === 'dest' ? 'nodata' : 'ok')
  : (n.kind === 'dest' ? n.loss >= 5 : (n.lossOn ?? 0) >= 5) ? 'bad' : n.loss > 0 ? 'minor' : 'ok');
const pvCmp = (x) => (x.tags?.includes('then') && !x.tags.includes('now') ? 'gone' : x.tags?.includes('now') && !x.tags.includes('then') ? 'new' : '');
const pvBandOf = (g, n) => g.bands.find((b) => n.col >= b.c0 && n.col <= b.c1) || null;
const pvBandName = (b, ov) => (ov && b.key === 'apps' ? T('On to each app') : T(PV_BAND[b.zone] || PV_BAND.internet));
const pvBandSub = (b, ov) => (ov && b.zone === 'app' ? '' : [b.org, b.asn ? `AS${b.asn}` : null].filter(Boolean).join(' · '));
const pvTitle = (n, nm) => (n.kind === 'you' ? T('Your home') : n.kind === 'dest' ? nm : T('Hop {n}', { n: (n.ns || []).join('/') }));
const pvHops = (n) => (n === 1 ? T('1 hop') : T('{n} hops', { n }));
const pvIso = (ms) => new Date(ms).toISOString();

/* Everything about one node, for the panel under the graph (and the hover card). */
function pvDetails(n, g, nm, short = false) {
  const dl = el('dl', { class: 'kv pvkv' }), add = (k, v) => { if (v != null && v !== '') dl.append(el('dt', {}, k), el('dd', {}, v)); };
  const band = pvBandOf(g, n), cmp = pvCmp(n);
  const head = el('div', { class: 'pvdhead' }, el('b', {}, n.kind === 'dest' && g.apps ? (n.name || nm) : pvTitle(n, nm)), n.ip && n.kind === 'hop' ? el('span', { class: 'pvmono' }, n.ip) : null,
    cmp ? el('span', { class: `pill ${cmp === 'new' ? 'pvnew' : 'pvgone'}` }, cmp === 'new' ? T('New since then') : T('Gone now')) : null);
  if (n.kind === 'you') { add(T('Where'), T('This CasaTorch - every time here is a round trip from it.')); return el('div', {}, head, dl); }
  add(T('Network'), band ? `${pvBandName(band, !!g.apps)}${n.org || n.asn ? ` · ${[n.org, n.asn ? `AS${n.asn}` : null].filter(Boolean).join(' · ')}` : ''}` : null);
  if (n.kind === 'silent') {
    add(T('Address'), T('no reply'));
    dl.append(el('dt', {}, ''), el('dd', { class: 'muted' }, T('This router doesn\'t answer traces - many don\'t. The hops after it did, so traffic passes through fine.')));
    add(T('Traces'), T('in {n} of the last {m} traces', { n: n.c, m: g.n }));
    return el('div', {}, head, dl);
  }
  if (n.kind === 'dest') add(T('Address'), (n.ips || [n.ip]).filter(Boolean).join(', ') || null);
  if (n.name && n.name !== nm && n.kind !== 'dest') add(T('Name'), n.name);
  if (n.kind === 'dest' && n.name && g.apps) add(T('Name'), n.name);
  if (!short) add(T('Registered in'), n.cc ? atRegion(n.cc) : null);
  if (n.avg != null) add(T('Round trip'), T('{avg} average · {min} fastest · {max} slowest', { avg: atMs(n.avg), min: atMs(n.min), max: atMs(n.max) }));
  if (n.jit != null) add(T('Jitter'), T('{ms} between traces', { ms: atMs(n.jit) }));
  if (n.usual != null && n.avg != null) add(T('Usual'), `${atMs(n.usual)}${n.avg - n.usual >= 20 ? ` · ${T('{ms} more than usual now', { ms: atMs(n.avg - n.usual) })}` : ''}`);
  if (n.add != null && n.add >= 1 && n.kind !== 'dest') add(T('Adds'), T('{ms} over the hop before', { ms: `+${atMs(n.add)}` }));
  if (n.loss != null) add(T('Loss'), n.loss === 0 ? T('none') : n.kind === 'dest' ? (n.loss >= 100 ? T('{loss}% - no answer', { loss: n.loss }) : `${n.loss}%`)
    : (n.lossOn ?? 0) >= 5 ? T('{loss}% - it carries on to the app, so traffic is being lost here', { loss: n.loss })
      : T('{loss}% here only - this router skips some trace replies; your traffic isn\'t lost', { loss: n.loss }));
  add(T('Traces'), g.apps ? T('{n} of your apps go through it', { n: n.tags?.length || 0 }) : T('in {n} of the last {m} traces', { n: n.c, m: g.n }));
  if (!short) {
    add(T('MTU'), n.mtu ? T('{n} bytes', { n: n.mtu }) : null);
    add(T('First seen'), n.f ? fmtWhen(pvIso(n.f)) : null); add(T('Last seen'), n.l ? fmtWhen(pvIso(n.l)) : null);
  }
  return el('div', {}, head, dl);
}

/* Draw a graph. o: { width, vertical, nm, ov (the all-apps tree), collapsed (Set of band ids), flags: Map(key -> [text, kind]),
   sel, onPick(node), onHover(node, el), onBand(id), apps: { id -> app } }. Returns { svg, W, H }. */
function pvDraw(g, o) {
  const { cols, y0, y1 } = g.layout, span = y1 - y0, ov = !!o.ov, R = ov ? 10 : 13, V = !!o.vertical;
  const bandId = (b) => `${b.key}@${b.c0}`, colBand = (c) => g.bands.find((b) => c >= b.c0 && c <= b.c1);
  const shut = (c) => V && o.collapsed?.has(bandId(colBand(c)));
  const perCol = new Map(); for (const n of g.nodes) perCol.set(n.col, (perCol.get(n.col) || 0) + 1);
  const ringAt = Math.max(10, 0.15 * Math.max(0, ...g.nodes.filter((n) => n.kind === 'dest').map((n) => n.avg || 0)));   // a hop adding a real share of the trip
  let W, H, X, Y, P, COLW = 0, LANEW = 0;
  if (!V) {
    const PADX = ov ? 46 : 62, TOP = ov ? 46 : 70, LANEH = ov ? 62 : 100;
    COLW = Math.min(ov ? 170 : 150, Math.max(ov ? 86 : 108, (o.width - 2 * PADX) / Math.max(1, cols - 1)));
    W = Math.round(2 * PADX + (cols - 1) * COLW); X = (c) => PADX + c * COLW; Y = (y) => TOP + (y - y0) * LANEH;
    H = Math.round(Y(y1) + (ov ? 50 : 60) + ([...(o.flags?.keys() || [])].some((k) => g.nodes.find((n) => n.k === k)?.y === y1) ? 26 : 0)); P = (c, y) => [X(c), Y(y)];
    for (const b of g.bands) { b._x0 = b.c0 === 0 ? 4 : X(b.c0) - COLW / 2 + 3; b._x1 = b.c1 === cols - 1 ? W - 4 : X(b.c1) + COLW / 2 - 3; }
  } else {
    const PADL = 22, BH = 50, ROWH = ov ? 60 : 68, SUMH = 44;
    W = Math.round(o.width); LANEW = span ? Math.min(160, Math.max(56, (W - PADL - R * 2 - (ov ? 70 : 128)) / span)) : 0;
    X = (y) => PADL + R + (y - y0) * LANEW;
    const rowY = []; let cur = 6;
    for (const b of g.bands) {
      b._top = cur; cur += BH;
      if (o.collapsed?.has(bandId(b))) { b._sum = cur + SUMH / 2; for (let c = b.c0; c <= b.c1; c++) rowY[c] = b._sum; cur += SUMH; }
      else for (let c = b.c0; c <= b.c1; c++) { rowY[c] = cur + ROWH / 2; cur += ROWH; }
      b._bot = cur + 4; cur += 10;
    }
    H = Math.round(cur); P = (c, y) => [shut(c) ? X(0) : X(y), rowY[c]];
  }
  const svg = pvS('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: `pvsvg${V ? ' vert' : ''}${ov ? ' ov' : ''}`, role: 'group', 'aria-label': o.label || '' });
  const defs = pvS('defs', {}, svg);
  const grad = pvS('linearGradient', { id: `pvdest${o.uid || ''}`, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
  pvS('stop', { offset: '0', class: 'pvg1' }, grad); pvS('stop', { offset: '1', class: 'pvg2' }, grad);
  // bands
  const gb = pvS('g', { class: 'pvbands' }, svg), heads = pvS('g', { class: 'pvheads' });
  for (const b of g.bands) {
    const name = pvBandName(b, ov), sub = pvBandSub(b, ov);
    if (!V) {
      const w = b._x1 - b._x0, chars = Math.floor((w - 18) / 6.6);
      pvS('rect', { x: b._x0, y: 4, width: w, height: H - 8, rx: 14, class: `pvband z-${b.zone}` }, gb);
      pvS('text', { x: b._x0 + 10, y: 22, class: 'pvbt' }, gb, pvCut(name, chars));
      if (sub) pvS('text', { x: b._x0 + 10, y: 37, class: 'pvbs' }, gb, pvCut(sub, chars));
    } else {
      const open = !o.collapsed?.has(bandId(b));
      pvS('rect', { x: 4, y: b._top, width: W - 8, height: b._bot - b._top, rx: 14, class: `pvband z-${b.zone}` }, gb);
      const hd = pvS('g', { class: 'pvbh', 'data-b': bandId(b), tabindex: 0, role: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-label': `${name}${sub ? `, ${sub}` : ''}, ${pvHops(b.hops)}` }, heads);
      pvS('rect', { x: 5, y: b._top + 1, width: W - 10, height: 44, rx: 13, class: `pvbhit z-${b.zone}` }, hd);
      pvS('path', { d: open ? `M14 ${b._top + 15}l5 5 5-5` : `M16 ${b._top + 13}l5 5-5 5`, class: 'pvchev' }, hd);
      pvS('text', { x: 32, y: b._top + 22, class: 'pvbt' }, hd, pvCut(name, Math.floor((W - 110) / 7.2)));
      if (b.hops) pvS('text', { x: W - 16, y: b._top + 22, class: 'pvbs', 'text-anchor': 'end' }, hd, pvHops(b.hops));
      if (sub) pvS('text', { x: 32, y: b._top + 38, class: 'pvbs' }, hd, pvCut(sub, Math.floor((W - 48) / 6.2)));
      const go = () => o.onBand?.(bandId(b));
      hd.addEventListener('click', go); hd.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      if (!open) {
        const ns = g.nodes.filter((n) => n.col >= b.c0 && n.col <= b.c1 && n.kind !== 'you'), ms = ns.map((n) => n.avg).filter((v) => v != null), bad = ns.some((n) => pvLoss(n) === 'bad');
        const sg = pvS('g', { transform: `translate(${X(0)},${b._sum})`, class: `pvsum${bad ? ' bad' : ''}` }, heads);
        pvS('circle', { r: R - 2, class: 'pvsumdot' }, sg); pvS('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'pvsumn' }, sg, String(ns.length));
        pvS('text', { x: R + 10, y: 4, class: 'pvl2' }, sg, [ms.length ? `${atMs(Math.min(...ms))}–${atMs(Math.max(...ms))}` : null, bad ? T('loss that reaches the app') : T('no loss')].filter(Boolean).join(' · '));
      }
    }
  }
  // links
  const N = new Map(g.nodes.map((n) => [n.k, n])), ge = pvS('g', { class: 'pvedges' }, svg), gl = pvS('g', { class: 'pvlabels' }, svg);
  svg.append(heads);   // phone band headers sit over the links that cross them
  const curve = (pts) => { let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`; for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; d += V ? ` C${ax.toFixed(1)},${(ay + (by - ay) / 2).toFixed(1)} ${bx.toFixed(1)},${(by - (by - ay) / 2).toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}` : ` C${(ax + (bx - ax) / 2).toFixed(1)},${ay.toFixed(1)} ${(bx - (bx - ax) / 2).toFixed(1)},${by.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`; } return d; };
  for (const e of g.edges) {
    const a = N.get(e.a), b = N.get(e.b);
    if (shut(a.col) && shut(b.col) && colBand(a.col) === colBand(b.col)) continue;
    let pts = e.pts.filter(([c], i) => i === 0 || i === e.pts.length - 1 || !shut(c)).map(([c, y]) => P(c, y));
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
    if (pts.length < 2) continue;
    const cmp = pvCmp(e), quiet = a.kind === 'silent' || b.kind === 'silent';
    const w = (ov ? 1.6 : 1.8) + (ov ? 3 : 4.5) * Math.min(1, e.share || 0) + (e.bad ? 1.5 : 0);
    pvS('path', { d: curve(pts), class: `pve${e.bad ? ' bad' : e.jump ? ' jump' : ''}${quiet ? ' quiet' : ''}${cmp ? ` ${cmp}` : ''}${e.back ? ' back' : ''}`, 'stroke-width': w.toFixed(1) }, ge);
    if (!ov && !V && e.dl != null && e.dl >= 1 && (e.share >= 0.2 || e.bad || e.jump)) {   // on a phone the added delay is on the node's own line
      const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1], txt = `+${atMs(e.dl)}`, tw = txt.length * 6.3 + 10;
      const mx = V ? (ax + bx) / 2 + (Math.abs(bx - ax) > 1 ? 0 : 8 + tw / 2) : (ax + bx) / 2, my = V ? (ay + by) / 2 : (ay + by) / 2 - (Math.abs(by - ay) > 1 ? 0 : 11);
      const lg = pvS('g', { class: `pvel${e.bad ? ' bad' : e.jump ? ' jump' : ''}`, transform: `translate(${mx.toFixed(1)},${my.toFixed(1)})` }, gl);
      pvS('rect', { x: -tw / 2, y: -9, width: tw, height: 18, rx: 9 }, lg); pvS('text', { x: 0, y: 4, 'text-anchor': 'middle' }, lg, txt);
    }
  }
  // nodes
  const gn = pvS('g', { class: 'pvnodes' }, svg), gf = pvS('g', { class: 'pvflags' }, svg), els = new Map();
  for (const n of g.nodes) {
    if (shut(n.col)) continue;
    const [x, y] = P(n.col, n.y), big = n.kind === 'dest' || n.kind === 'you', r = big ? R + 3 : R, lc = pvLoss(n), cmp = pvCmp(n), app = ov && n.kind === 'dest' ? o.apps?.[n.app] : null;
    const label = n.kind === 'you' ? T('Your home') : n.kind === 'dest' ? (app ? atName(app) : o.nm) : n.kind === 'silent' ? T('no reply') : (n.ip || '');
    const l2 = n.kind === 'you' ? (ov ? '' : T('start')) : ov ? (n.kind === 'dest' ? (app?.down ? T('Down') : app?.slow ? T('Slow') : n.avg != null ? atMs(n.avg) : '') : n.tags?.length > 1 ? T('{n} apps', { n: n.tags.length }) : '')
      : n.kind === 'silent' ? '' : [n.avg != null ? atMs(n.avg) : n.kind === 'dest' ? T('No answer') : null, V && n.kind === 'hop' && n.add >= 1 ? `+${atMs(n.add)}` : null, n.loss > 0 && n.loss < 100 ? `${n.loss}%` : null].filter(Boolean).join(' · ');
    const slowIn = g.edges.some((e) => e.b === n.k && e.bad);
    const aria = [pvTitle(n, label), n.ip && n.kind === 'hop' ? n.ip : null, n.org, n.avg != null ? atMs(n.avg) : null, n.loss ? T('{n}% loss', { n: n.loss }) : null, cmp === 'new' ? T('New since then') : cmp === 'gone' ? T('Gone now') : null].filter(Boolean).join(', ');
    const ng = pvS('g', { class: `pvn k-${n.kind} l-${lc}${cmp ? ` ${cmp}` : ''}${o.sel === n.k ? ' sel' : ''}${o.marks?.has(n.k) ? ' culprit' : ''}${app?.down ? ' appdown' : app?.slow ? ' appslow' : ''}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: 0, role: 'button', 'aria-label': aria, 'data-k': n.k }, gn);
    pvS('circle', { r: r + 9, class: 'pvhit' }, ng);
    if (o.marks?.has(n.k)) pvS('circle', { r: r + 5, class: 'pvculprit' }, ng);
    if (!ov && n.add != null && n.add >= ringAt && n.kind === 'hop' && cmp !== 'gone') pvS('circle', { r: r + 3.5 + Math.min(8, n.add / 7), class: `pvring${n.add >= 25 ? ' big' : ''}` }, ng);
    pvS('circle', { r, class: 'pvdot', ...(n.kind === 'dest' ? { fill: `url(#pvdest${o.uid || ''})` } : {}) }, ng);
    pvS('circle', { r: r + 4, class: 'pvsel' }, ng);
    if (n.kind === 'you') pvS('path', { d: ICONS.home, transform: `translate(${-r * 0.62},${-r * 0.62}) scale(${(r * 1.24 / 24).toFixed(3)})`, class: 'pvico' }, ng);
    else if (n.kind === 'dest') pvS('text', { x: 0, y: 4.5, 'text-anchor': 'middle', class: 'pvdl' }, ng, app ? app.short || '•' : o.short || '•');
    else pvS('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'pvnum' }, ng, n.kind === 'silent' ? '·' : String(n.ns?.[0] ?? ''));
    // the label: under the node (sideways layout, or a crowded phone row), else to its right
    const crowded = V && (perCol.get(n.col) || 1) > 1 && LANEW < 132;
    if (!V || crowded) {
      const chars = Math.max(6, Math.floor(((V ? LANEW : COLW) - 10) / (n.kind === 'hop' ? 6.4 : 6.6)));
      // the last column on a wide screen: right-aligned, so a long app name stays inside the picture
      const edge = !V && n.col === cols - 1 && label.length * 6.6 / 2 > W - x - 6, ax = edge ? r + 4 : 0, anchor = edge ? 'end' : 'middle';
      if (!(crowded && chars < 11 && n.kind !== 'dest')) {   // a crowded phone row: addresses would be cut to nothing - tap for them
        pvS('text', { x: ax, y: r + 15, 'text-anchor': anchor, class: `pvl1${n.kind === 'hop' ? ' mono' : ''}` }, ng, pvCut(label, chars));
        if (l2) pvS('text', { x: ax, y: r + 28, 'text-anchor': anchor, class: `pvl2${lc === 'bad' ? ' bad' : ''}` }, ng, pvCut(l2, chars));
      }
    } else {
      const room = Math.floor((W - x - r - 22) / 6.6);
      pvS('text', { x: r + 10, y: l2 ? -2 : 4, class: `pvl1${n.kind === 'hop' ? ' mono' : ''}` }, ng, pvCut(label, room));
      if (l2) pvS('text', { x: r + 10, y: 13, class: `pvl2${lc === 'bad' || slowIn ? ' bad' : ''}` }, ng, pvCut(l2, room));
    }
    const flag = o.flags?.get(n.k);
    if (flag) {
      const [txt, kind] = flag, tw = txt.length * 6.1 + 16;
      const fx = V ? Math.min(W - 10 - tw / 2, Math.max(tw / 2 + 8, x + (crowded ? 0 : r + 10 + tw / 2))) : Math.min(W - 6 - tw / 2, Math.max(tw / 2 + 6, x)), fy = V ? y - r - 15 : y + r + (l2 ? 46 : 33);
      const fg = pvS('g', { class: `pvflag ${kind || ''}`, transform: `translate(${fx.toFixed(1)},${fy.toFixed(1)})` }, gf);
      pvS('rect', { x: -tw / 2, y: -10, width: tw, height: 20, rx: 10 }, fg); pvS('text', { x: 0, y: 4, 'text-anchor': 'middle' }, fg, txt);
    }
    els.set(n.k, ng);
    ng.addEventListener('click', () => o.onPick?.(n, ng, 'click'));
    ng.addEventListener('focus', () => o.onPick?.(n, ng, 'focus'));
    ng.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') o.onHover?.(n, ng); });
    ng.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') o.onHover?.(null); });
    ng.addEventListener('keydown', (e) => {
      const fwd = V ? 'ArrowDown' : 'ArrowRight', back = V ? 'ArrowUp' : 'ArrowLeft', side = V ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      let to = null;
      if (e.key === fwd || e.key === back) { const list = g.edges.filter((x) => (e.key === fwd ? x.a : x.b) === n.k).sort((p, q) => q.c - p.c); to = list[0] && (e.key === fwd ? list[0].b : list[0].a); }
      else if (side.includes(e.key)) { const same = g.nodes.filter((x) => x.col === n.col).sort((p, q) => p.y - q.y), i = same.indexOf(n); to = same[i + (e.key === side[0] ? -1 : 1)]?.k; }
      else if (e.key === 'Home') to = 'you'; else if (e.key === 'End') to = g.nodes.find((x) => x.kind === 'dest')?.k;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onPick?.(n, ng, 'click'); return; } else return;
      e.preventDefault(); if (to) { const t2 = els.get(to); t2?.focus(); }
    });
  }
  return { svg, W, H, els, at: (k) => { const n = N.get(k); return n ? P(n.col, n.y) : null; } };
}

/* Pinch, Ctrl + wheel (a trackpad pinch) and buttons zoom a long path on a big screen; it scrolls sideways when wider. */
function pvZoomable(box) {
  let k = null, W = 0, H = 0, svg = null, pts = new Map(), pinch = null;
  const apply = (nk, cx = null) => {
    if (!svg) return; const old = k || 1; k = Math.min(2.2, Math.max(0.5, nk));
    const fx = cx ?? box.clientWidth / 2, sx = (box.scrollLeft + fx) / old;
    svg.setAttribute('width', Math.round(W * k)); svg.setAttribute('height', Math.round(H * k));
    box.scrollLeft = sx * k - fx;
  };
  const set = (r) => { svg = r.svg; W = r.W; H = r.H; const fit = box.clientWidth / W; if (k == null) k = W <= box.clientWidth ? 1 : fit >= 0.78 ? fit : 1; apply(k); };
  box.addEventListener('wheel', (e) => { if (!e.ctrlKey || !svg) return; e.preventDefault(); const b = box.getBoundingClientRect(); apply(k * Math.exp(-e.deltaY * 0.01), e.clientX - b.left); }, { passive: false });
  box.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k }; } });
  box.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (pinch && pts.size === 2) { const [a, b] = [...pts.values()], bb = box.getBoundingClientRect(); apply(pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d, (a[0] + b[0]) / 2 - bb.left); } });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  const btn = (ic, lab, f) => el('button', { type: 'button', class: 'btn small ghost pvzb', 'aria-label': lab, title: lab, onclick: f }, ic);
  const tools = el('div', { class: 'pvzoom', role: 'group', 'aria-label': T('Zoom|graph') },
    btn('−', T('Zoom out'), () => apply(k / 1.25)), btn('+', T('Zoom in'), () => apply(k * 1.25)), btn(T('Fit'), T('Fit the whole path'), () => apply(Math.min(1, box.clientWidth / W))));
  return { set, tools };
}

/* The strip above the graph: the round trip to the app, loss under it, route changes (◆), and the time the graph shows
   (the shaded window). Drag across it to pick a time, tap for the hour around a moment; arrow keys move the window. */
function pvStrip(t, st, onPick) {
  const box = el('div', { class: 'pvstrip atchart', tabindex: 0, role: 'slider', 'aria-label': T('Time the path shows - drag or use the arrow keys'), 'aria-valuemin': 0, 'aria-valuemax': 100 });
  const tip = el('div', { class: 'attip', hidden: true });
  const paint = () => {
    const range = st.range, now = Date.now(), since = now - (range === '24h' ? 86400_000 : 7 * 86400_000);
    const pts = (range === '24h' ? (t.runs || []).map((r) => ({ at: Date.parse(r.at), v: r.latency, loss: r.loss })) : (t.hours || []).map((h) => ({ at: Date.parse(h.at) + 1800_000, v: h.latency, loss: h.loss, up: h.up }))).filter((p) => p.at >= since);
    const ch = (t.changes || []).filter((c) => Date.parse(c.at) >= since), marks = st.data?.marks || { traces: [], buckets: [] };
    const W = Math.max(280, box.clientWidth || 600), H = 112, padL = 46, padR = 8, padT = 14, lossH = 18, gap = 6, padB = 20, mainH = H - padT - padB - lossH - gap;
    const okv = pts.map((p) => p.v).filter((v) => v != null), top = Math.max(10, Math.ceil(Math.max(...okv, 1) * 1.2 / 10) * 10), lossMax = Math.max(10, ...pts.map((p) => p.loss || 0));
    const x = (ms) => padL + (ms - since) / (now - since) * (W - padL - padR), y = (v) => padT + mainH * (1 - Math.min(v, top) / top), ly0 = padT + mainH + gap + lossH, inv = (px) => since + (px - padL) / (W - padL - padR) * (now - since);
    const svg = pvS('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    for (const v of [0, top]) { pvS('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }, svg); pvS('text', { x: padL - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg, atMs(v)); }
    pvS('text', { x: padL - 6, y: ly0 - 4, 'text-anchor': 'end', class: 'axis' }, svg, T('loss'));
    // when there's path data: each kept trace as a tick, older sums as a faint band
    for (const [h, w] of marks.buckets) if (h + w > since && h < (marks.traces[0] ?? now)) pvS('rect', { x: x(Math.max(h, since)), y: H - padB + 3, width: Math.max(1, x(Math.min(h + w, now)) - x(Math.max(h, since)) - 1), height: 3, rx: 1.5, class: 'pvhas' }, svg);
    for (const ms of marks.traces) if (ms >= since) pvS('rect', { x: x(ms) - 0.5, y: H - padB + 2, width: 1, height: 3, class: 'pvhas tr' }, svg);
    let d = '', pen = false;
    for (const p of pts) { if (p.v == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`; pen = true; }
    if (d) { pvS('path', { d: `${d}L${x(pts[pts.length - 1].at).toFixed(1)},${(padT + mainH).toFixed(1)}L${x(pts.find((p) => p.v != null)?.at ?? since).toFixed(1)},${(padT + mainH).toFixed(1)}Z`, class: 'pvarea' }, svg); pvS('path', { d, class: 'line' }, svg); }
    const bw = Math.max(1.5, (W - padL - padR) / Math.max(1, pts.length) - 0.6);
    for (const p of pts) if (p.loss > 0) { const h = Math.max(2, p.loss / lossMax * lossH); pvS('rect', { x: x(p.at) - bw / 2, y: ly0 - h, width: bw, height: h, rx: 1, class: 'lossbar' }, svg); }
    for (const c of ch) { const cx = x(Date.parse(c.at)); pvS('line', { x1: cx, x2: cx, y1: padT - 4, y2: ly0, class: 'chg' }, svg); pvS('path', { d: `M${cx},${padT - 11}l5,5l-5,5l-5,-5z`, class: `chgmk${c.kind === 'mtu' ? ' mtu' : ''}` }, svg); }
    // the window the graph shows
    const wf = st.from ?? st.data?.from, wt = st.to ?? st.data?.to;
    if (wf && wt) { const a = x(Math.max(wf, since)), b = x(Math.min(wt, now)); pvS('rect', { x: a, y: padT - 2, width: Math.max(3, b - a), height: ly0 - padT + 4, rx: 4, class: 'pvwin' }, svg); box.setAttribute('aria-valuenow', Math.round((wt - since) / (now - since) * 100)); box.setAttribute('aria-valuetext', `${fmtWhen(pvIso(wf))} – ${fmtTime(pvIso(wt))}`); }
    for (const [ms, anchor] of [[since, 'start'], [now, 'end']]) pvS('text', { x: x(ms), y: H - 3, 'text-anchor': anchor, class: 'axis' }, svg, range === '24h' ? fmtTime(pvIso(ms)) : fmt(pvIso(ms), { weekday: 'short', month: 'short', day: 'numeric' }));
    const sel = pvS('rect', { y: padT - 2, height: ly0 - padT + 4, class: 'pvdrag', visibility: 'hidden' }, svg), cross = pvS('line', { y1: padT, y2: ly0, class: 'cross', visibility: 'hidden' }, svg);
    const pos = (e) => { const b = svg.getBoundingClientRect(); return Math.min(W - padR, Math.max(padL, (e.clientX - b.left) * (W / b.width))); };
    let drag = null;
    svg.addEventListener('pointerdown', (e) => { drag = { x0: pos(e), x1: pos(e) }; svg.setPointerCapture?.(e.pointerId); });
    svg.addEventListener('pointermove', (e) => {
      const px = pos(e);
      if (drag) { drag.x1 = px; const a = Math.min(drag.x0, px), b = Math.max(drag.x0, px); sel.setAttribute('x', a); sel.setAttribute('width', b - a); sel.setAttribute('visibility', b - a > 4 ? 'visible' : 'hidden'); }
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      const at = inv(px), near = ch.find((c) => Math.abs(x(Date.parse(c.at)) - px) < 8); let best = pts[0]; for (const p of pts) if (Math.abs(p.at - at) < Math.abs(best.at - at)) best = p;
      tip.replaceChildren(...(near ? [el('b', {}, fmtWhen(near.at)), el('div', {}, atChangeText(near))] : best ? [el('b', {}, range === '24h' ? fmtTime(pvIso(best.at)) : fmtWhen(pvIso(best.at))), el('div', {}, best.v != null ? T('round trip {ms}', { ms: atMs(best.v) }) : T('No answer')), el('div', { class: 'tiny muted' }, `${T('loss')} ${best.loss ?? 0}%`)] : []));
      tip.hidden = !best && !near; tip.style.left = `${Math.min(Math.max(px - 110, 0), W - 230)}px`; tip.style.top = `${H + 4}px`;
    });
    const end = () => {
      if (!drag) return; const a = Math.min(drag.x0, drag.x1), b = Math.max(drag.x0, drag.x1); drag = null; sel.setAttribute('visibility', 'hidden');
      if (b - a > 6) onPick(Math.round(inv(a)), Math.round(inv(b)));
      else { const at = inv(a), half = range === '24h' ? 1800_000 : 3 * 3600_000; onPick(Math.round(Math.max(since, at - half)), Math.round(Math.min(now, at + half))); }
    };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', () => { drag = null; sel.setAttribute('visibility', 'hidden'); });
    svg.addEventListener('pointerleave', () => { if (!drag) { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); } });
    box.replaceChildren(svg, tip);
  };
  box.addEventListener('keydown', (e) => {
    const wf = st.from ?? st.data?.from, wt = st.to ?? st.data?.to; if (!wf) return;
    const w = wt - wf, now = Date.now(), min = now - (st.range === '24h' ? 86400_000 : 7 * 86400_000);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const s = e.key === 'ArrowLeft' ? -w / 2 : w / 2, f = Math.max(min, Math.min(now - w, wf + s)); onPick(Math.round(f), Math.round(f + w)); }
    else if (e.key === 'End') { e.preventDefault(); onPick(null, null); }
  });
  atWatchWidth(box, paint);
  return { box, paint };
}

/* The path section of a test's details: the strip, the graph (or the hop list), the selected hop, the legend. */
function pvSection(t, a, nm, id) {
  const p = t.path;
  if (t.kind === 'router' || (['dns', 'dnsq', 'ping', 'tcp'].includes(t.kind) && p?.none === 'home') || !(a.trace?.ok ?? a.traceroute) || p?.none === 'tool' || !p?.hops?.length) return atPath(t, a, nm);
  const st = { range: '24h', from: null, to: null, cmp: false, mode: 'graph', collapsed: null, sel: null, data: null, seq: 0, vertical: null };
  try { if (localStorage.getItem('ct.pathview') === 'list') st.mode = 'list'; } catch { /* private window */ }
  const segOf = (opts, cur, on) => { const s = el('div', { class: 'seg seg-mini', role: 'tablist' }, opts.map(([k, l]) => el('button', { type: 'button', role: 'tab', class: k === cur ? 'on' : '', 'aria-selected': k === cur ? 'true' : 'false', onclick: (e) => { for (const b of s.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-selected', b === e.currentTarget ? 'true' : 'false'); } on(k); } }, l))); return s; };
  const wrap = el('div', { class: 'pv' }), gwrap = el('div', { class: 'pvgwrap' }), gbox = el('div', { class: 'pvgraph', role: 'region', 'aria-label': T('Network path') });
  const tip = el('div', { class: 'pvtip', hidden: true }), info = el('div', { class: 'pvinfo', 'aria-live': 'polite' }), when = el('div', { class: 'pvwhen small' });
  const strip = pvStrip(t, st, (f, to) => { st.from = f; st.to = to; if (f == null) st.cmp = false; load(); });
  const cmpBox = el('input', { type: 'checkbox', onchange: (e) => { st.cmp = e.target.checked; load(); } });
  const cmpLab = el('label', { class: 'row pvcmp', style: 'gap:6px' }, cmpBox, el('span', { class: 'small' }, T('Compare with now')));
  const nowBtn = el('button', { type: 'button', class: 'btn small ghost', onclick: () => { st.from = st.to = null; st.cmp = false; load(); } }, T('Back to now'));
  const zoom = pvZoomable(gbox);
  const listBox = el('div', { class: 'pvlist' });
  const changes = el('div', { class: 'atchanges' });
  const legend = el('div', { class: 'pvlegend tiny muted' },
    el('span', {}, el('i', { class: 'lg l-ok' }), T('no loss')), el('span', {}, el('i', { class: 'lg l-minor' }), T('loss at that router only (harmless)')), el('span', {}, el('i', { class: 'lg l-bad' }), T('loss that reaches the app')),
    el('span', {}, el('i', { class: 'lg quiet' }), T('no reply (normal)')), el('span', {}, el('i', { class: 'lg ring' }), T('ring: delay this hop adds')), el('span', {}, el('i', { class: 'ln bad' }), T('slower than usual')), el('span', {}, el('i', { class: 'ln jump' }), T('big jump (usual)')),
    el('span', { class: 'pvlcmp' }, el('i', { class: 'ln new' }), T('new since then')), el('span', { class: 'pvlcmp' }, el('i', { class: 'ln gone' }), T('gone now')));
  const range = segOf([['24h', T('24 hours')], ['7d', T('7 days')]], '24h', (k) => { st.range = k; strip.paint(); paintChanges(); });
  const mode = segOf([['graph', T('Graph')], ['list', T('List')]], st.mode, (k) => { st.mode = k; try { localStorage.setItem('ct.pathview', k); } catch { /* fine */ } show(); });
  const paintChanges = () => {
    const since = Date.now() - (st.range === '24h' ? 86400_000 : 7 * 86400_000), ch = (t.changes || []).filter((c) => Date.parse(c.at) >= since);
    changes.replaceChildren(...(ch.length ? ch.slice().reverse().map((c) => el('button', { type: 'button', class: 'tiny atchange pvchange', title: T('Show the path before this change, compared with now'), onclick: () => { const at = Date.parse(c.at); st.to = at - 60_000; st.from = st.to - 3600_000; st.cmp = true; load(); } },
      el('i', { class: 'mk', 'aria-hidden': 'true' }), el('span', {}, atChangeText(c)), el('span', { class: 'muted' }, ` · ${atAgo(c.at)}`)))
      : [el('p', { class: 'tiny muted', style: 'margin:6px 0 0' }, st.range === '24h' ? T('The route stayed the same all day.') : T('The route stayed the same all week.'))]));
  };
  const flagsOf = (g) => {
    const f = new Map(), tr = g.trouble;
    if (tr?.k) f.set(tr.k, [tr.kind === 'down' ? T('Stops answering here') : T('Trouble starts here'), tr.kind === 'delay' && !t.down && !t.slow ? 'warn' : 'bad']);
    return f;
  };
  const pick = (n, how) => {
    st.sel = n.k; tip.hidden = true;
    for (const x of gbox.querySelectorAll('.pvn.sel')) x.classList.remove('sel');
    gbox.querySelector(`.pvn[data-k="${CSS.escape(n.k)}"]`)?.classList.add('sel');
    info.replaceChildren(pvDetails(n, st.data.graph, nm));
    if (how === 'click' && st.vertical) info.scrollIntoView({ block: 'nearest', behavior: pvReduced() ? 'auto' : 'smooth' });
  };
  const hover = (n, ng) => {
    if (!n) { tip.hidden = true; return; }
    tip.replaceChildren(pvDetails(n, st.data.graph, nm, true));
    const b = ng.getBoundingClientRect(), w = gwrap.getBoundingClientRect();
    tip.hidden = false; const tw = tip.offsetWidth || 280;
    tip.style.left = `${Math.min(Math.max(0, b.left - w.left + b.width / 2 - tw / 2), w.width - tw)}px`; tip.style.top = `${b.bottom - w.top + 6}px`;
  };
  const draw = () => {
    const g = st.data?.graph;
    if (!g) { gbox.replaceChildren(el('p', { class: 'small muted pvempty' }, st.from ? T('No traces in that time - pick another on the strip above.') : T('Tracing the path - it shows up here within a few minutes.'))); info.replaceChildren(); return; }
    const width = gbox.clientWidth || 900; st.vertical = width < 600;
    if (!st.collapsed) st.collapsed = new Set();
    const r = pvDraw(g, { width, vertical: st.vertical, nm, short: t.short, collapsed: st.collapsed, flags: flagsOf(g), sel: st.sel, onPick: (n, _ng, how) => pick(n, how), onHover: hover, uid: id,
      onBand: (bid) => { if (st.collapsed.has(bid)) st.collapsed.delete(bid); else st.collapsed.add(bid); draw(); gbox.querySelector(`.pvbh[data-b="${CSS.escape(bid)}"]`)?.focus({ preventScroll: true }); },
      label: T('Path to {name}: {n} hops', { name: nm, n: g.nodes.filter((x) => x.kind === 'hop' || x.kind === 'silent').length }) });
    gbox.replaceChildren(r.svg); gbox.classList.toggle('vert', st.vertical);
    if (!st.vertical) zoom.set(r); else { r.svg.removeAttribute('height'); r.svg.setAttribute('width', '100%'); }
    if (!pvReduced()) { r.svg.classList.add('pvin'); }
    const sel = g.nodes.find((x) => x.k === st.sel) || g.nodes.find((x) => x.k === g.trouble?.k) || g.nodes.find((x) => x.kind === 'dest');
    if (sel) { st.sel = sel.k; r.els.get(sel.k)?.classList.add('sel'); info.replaceChildren(pvDetails(sel, g, nm)); }
    if (!st.vertical && g.trouble?.k && gbox.scrollWidth > gbox.clientWidth) { const at = r.at(g.trouble.k); if (at) gbox.scrollLeft = Math.max(0, at[0] * (Number(r.svg.getAttribute('width')) / r.W) - gbox.clientWidth / 2); }
  };
  const bar = () => {
    const d = st.data, g = d?.graph, past = st.from != null;
    const span = d ? `${fmtWhen(pvIso(d.from))} – ${fmtTime(pvIso(d.to))}` : '';
    const what = g ? [g.traces != null ? T('{n} traces merged', { n: g.traces }) : null, g.distinct > 1 ? T('{n} different paths', { n: g.distinct }) : null, g.mtu ? T('largest packet (MTU) {n} bytes', { n: g.mtu }) : null].filter(Boolean).join(' · ') : '';
    when.replaceChildren(...[el('b', {}, past ? span : T('The last hour')), what ? el('span', { class: 'muted' }, ` · ${what}`) : null,
      st.cmp && g ? el('span', { class: 'muted' }, ` · ${T('compared with the last hour')}`) : null].filter(Boolean));
    cmpBox.checked = st.cmp; cmpLab.hidden = !past; nowBtn.hidden = !past;
    wrap.classList.toggle('cmp', !!st.cmp);
  };
  const load = async () => {
    const seq = ++st.seq, q = new URLSearchParams();
    if (st.from != null) { q.set('from', st.from); q.set('to', st.to); } if (st.cmp) q.set('cmp', '1');
    gbox.classList.add('busy');
    try {
      const d = await api(`/api/apptests/${encodeURIComponent(id)}/graph?${q}`); if (seq !== st.seq) return;
      st.data = d; bar(); draw(); strip.paint();
    } catch (e) { if (seq === st.seq) gbox.replaceChildren(el('p', { class: 'small', style: 'color:var(--bad)' }, e.message)); }
    finally { if (seq === st.seq) gbox.classList.remove('busy'); }
  };
  const show = () => {
    const g = st.mode === 'graph';
    for (const x of [gwrap, info, legend, when.parentElement]) if (x) x.hidden = !g;
    listBox.hidden = g; if (!g && !listBox.childNodes.length) listBox.append(atPath(t, a, nm));
    if (g && st.data) draw();
  };
  const top = el('div', { class: 'row between wrap pvtop' }, el('span', { class: 'tiny muted' }, T('Round trip to the app, loss below it, and route changes (◆). Drag across it to see the path at any time.')), el('div', { class: 'row', style: 'gap:8px' }, range, mode));
  wrap.append(top, strip.box, el('div', { class: 'row between wrap pvbar' }, when, el('div', { class: 'row wrap', style: 'gap:8px;align-items:center' }, cmpLab, nowBtn, zoom.tools)), gwrap, info, legend, listBox, changes);
  gwrap.append(gbox, tip);
  atWatchWidth(gbox, () => { if (st.data && st.mode === 'graph') draw(); });
  gbox.addEventListener('pointerleave', () => { tip.hidden = true; });
  paintChanges(); show(); load();
  return wrap;
}

/* Paths to all your apps: one tree from home. Where they share hops and where they part; a problem on a shared hop
   shows on every app after it, so trouble there is marked with how many apps pass through. Tap an app to open it. */
function pvOverview(a, open) {
  const g = a.overview, box = el('div', { class: 'pvov' }), gbox = el('div', { class: 'pvgraph ov' }), info = el('div', { class: 'pvinfo', 'aria-live': 'polite' });
  const apps = Object.fromEntries((g.apps || []).map((x) => [x.id, x])), collapsed = new Set();
  const flags = new Map();
  if (g.split && g.split !== 'you') flags.set(g.split, [T('Paths part here'), 'muted']);
  const marks = new Set((g.marks || []).map((m) => m.k));
  if (g.issue) flags.set(g.issue.k, [T('{n} apps having trouble pass here', { n: g.issue.apps.length }), 'bad']);
  const draw = () => {
    const width = gbox.clientWidth || 900, vertical = width < 600;
    const r = pvDraw(g, { width, vertical, ov: true, apps, collapsed, flags, marks, uid: 'ov', label: T('Paths to all your apps'),
      onPick: (n, _ng, how) => { if (n.kind === 'dest' && how === 'click') return open(n.app); if (how === 'click') info.replaceChildren(pvDetails(n, g, '', true)); },
      onBand: (bid) => { if (collapsed.has(bid)) collapsed.delete(bid); else collapsed.add(bid); draw(); gbox.querySelector(`.pvbh[data-b="${CSS.escape(bid)}"]`)?.focus({ preventScroll: true }); } });
    gbox.replaceChildren(r.svg); if (vertical) { r.svg.removeAttribute('height'); r.svg.setAttribute('width', '100%'); }
    gbox.classList.toggle('vert', vertical);
  };
  const shared = g.nodes.filter((x) => x.kind !== 'you' && x.kind !== 'dest' && x.tags.length === (g.apps || []).length).length;
  box.append(el('div', { class: 'row between wrap', style: 'gap:8px;margin:18px 0 6px' }, el('h3', { style: 'margin:0;font-size:15px' }, T('Paths to all your apps')),
    el('span', { class: 'tiny muted' }, shared ? T('All your apps share the first {n} hops, then part ways.', { n: shared }) : T('Your apps part ways straight after your home.'))),
    el('p', { class: 'tiny muted', style: 'margin:0 0 8px' }, T('A problem on a shared hop slows every app after it. Tap an app to see its own path.')), gbox,
    (g.marks || []).length ? el('div', { class: 'pvculps tiny' }, el('i', { class: 'mk', 'aria-hidden': 'true' }), el('span', {}, (g.marks || []).map((m) => { const n = g.nodes.find((x) => x.k === m.k); return T('{name}: likely culprit at hop {hop}{org}', { name: atName(apps[m.app] || { name: '?' }), hop: (n?.ns || []).join('/'), org: n?.org ? ` (${n.org})` : '' }); }).join(' · '))) : null, info);
  atWatchWidth(gbox, draw);
  return box;
}
