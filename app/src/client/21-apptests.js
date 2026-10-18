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
      l?.ok ? el('span', { class: 'tiny muted' }, web ? T('to load') : t.kind === 'dns' ? T('to look up a name') : T('round trip')) : el('span', { class: 'tiny muted ellipsis' }, l?.error || '')),
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
  const head = el('div', {}, el('h2', { style: 'margin:0' }, T('App tests')), el('p', { class: 'small muted', style: 'margin:4px 0 0' }, T('How fast your apps answer from home, and the path your traffic takes to get there.')));
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
/* The detail sheet: what's wrong (if anything), the last test step by step, the path hop by hop, and the history. */
async function atOpen(id, a, redraw) {
  const body = el('div', { class: 'atdetail' }, el('p', { class: 'muted' }, T('Loading…')));
  const m = modal(body, { title: T('App test'), wide: true });
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
      el('div', { class: 'row between wrap', style: 'gap:10px' }, el('div', { class: 'row', style: 'gap:12px;min-width:0' }, el('span', { class: 'atbadge lg', 'aria-hidden': 'true' }, t.kind === 'router' ? icon('wifi') : t.short), el('div', { style: 'min-width:0' }, el('h2', { style: 'margin:0' }, nm), el('div', { class: 'tiny muted ellipsis' }, t.url || (t.kind === 'router' ? T('Your router, timed from this CasaTorch') : T('How fast this home looks up names'))))),
        el('span', { class: `pill ${dot}` }, el('span', { class: `dot ${dot}` }), word)),
      el('div', { class: 'row wrap', style: 'gap:8px;margin:12px 0 4px;align-items:center' }, a.demo ? null : runBtn, a.demo || !canTrace ? null : pathBtn, every, alertBox, del),
      verdict,
      el('div', { class: 'atcols' },
        web ? el('section', {}, el('h3', {}, T('Last test'), l ? el('span', { class: 'tiny muted', style: 'font-weight:400;margin-left:6px' }, atAgo(l.at)) : null), atBar(l, true), steps, l?.error ? el('p', { class: 'small', style: 'color:var(--bad)' }, T('Didn\'t work: {why}', { why: l.error })) : null,
          l?.status ? el('p', { class: 'tiny muted' }, l.ip ? T('The app answered {status} from {ip}.', { status: l.status, ip: l.ip }) : T('The app answered {status}.', { status: l.status })) : null)
          : el('section', {}, el('h3', {}, T('Last test'), l ? el('span', { class: 'tiny muted', style: 'font-weight:400;margin-left:6px' }, atAgo(l.at)) : null), el('div', { class: 'atsteps' }, el('div', { class: 'atstep total' }, el('span', { class: 'grow' }, t.kind === 'dns' ? T('Time to look up a name') : T('Round trip to the router')), el('b', {}, l?.ok ? atMs(l.total) : T('No answer')))),
            l?.ip ? el('p', { class: 'tiny muted' }, t.kind === 'dns' ? T('Asked {ip}, the name server this computer uses.', { ip: l.ip }) : T('Your router is {ip}.', { ip: l.ip })) : null, l?.error ? el('p', { class: 'small', style: 'color:var(--bad)' }, T('Didn\'t work: {why}', { why: l.error })) : null),
        el('section', {}, el('h3', {}, web ? T('Network to the app') : T('Network')), el('div', { class: 'atstats' },
          [['Latency', atMs(l?.latency), 'how long a round trip takes'], ['Jitter', atMs(l?.jitter), 'how much that wobbles'], ['Loss', l?.loss != null ? `${l.loss}%` : '-', 'probes that got no answer']].map(([k, v, s]) => el('div', { class: 'atstat' }, el('span', { class: 'tiny muted' }, T(k)), el('b', {}, v), el('span', { class: 'tiny muted' }, T(s))))),
          el('p', { class: 'tiny muted' }, T('From five quick connections each test. Video calls stay smooth with latency under about 100 ms, jitter under 30 ms and no loss.')))),
      el('h3', { style: 'margin-top:18px' }, T('Path, hop by hop'), t.path?.at && t.path.hops?.length ? el('span', { class: 'tiny muted', style: 'font-weight:400;margin-left:6px' }, T('traced {when}', { when: atAgo(t.path.at) })) : null),
      atPath(t, a, nm),
      el('h3', { style: 'margin-top:22px' }, T('History')), atHistory(t),
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
  if (t.kind === 'router' || (t.kind === 'dns' && p?.none === 'home')) return el('p', { class: 'small muted' }, T('This test stays inside your home, so there\'s no path to trace.'));
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
/* History: 24 hours (every test) or 7 days (by the hour) - the round trip to the app, loss below it, and route
   changes as markers. Hover or touch for the numbers; tap a marker for what changed. */
function atHistory(t) {
  const box = el('div', { class: 'athist' }), chart = el('div', { class: 'atchart athistchart' });
  let range = '24h';
  const seg = el('div', { class: 'seg', role: 'tablist' }, [['24h', T('24 hours')], ['7d', T('7 days')]].map(([k, l]) => el('button', { type: 'button', role: 'tab', class: k === range ? 'on' : '', 'aria-selected': k === range ? 'true' : 'false', onclick: (e) => { range = k; for (const b of seg.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-selected', b === e.currentTarget ? 'true' : 'false'); } paint(); } }, l)));
  const list = el('div', { class: 'atchanges' });
  const paint = () => {
    const since = Date.now() - (range === '24h' ? 86400_000 : 7 * 86400_000);
    const pts = (range === '24h' ? (t.runs || []).map((r) => ({ at: r.at, v: r.latency, loss: r.loss, ok: r.ok })) : (t.hours || []).map((h) => ({ at: h.at, v: h.latency, loss: h.loss, ok: h.up == null || h.up >= 99, up: h.up }))).filter((p) => Date.parse(p.at) >= since);
    const ch = (t.changes || []).filter((c) => Date.parse(c.at) >= since);
    list.replaceChildren(...(ch.length ? ch.slice().reverse().map((c) => el('div', { class: 'tiny atchange' }, el('i', { class: 'mk', 'aria-hidden': 'true' }), el('span', {}, atChangeText(c)), el('span', { class: 'muted' }, ` · ${atAgo(c.at)}`))) : [el('p', { class: 'tiny muted', style: 'margin:6px 0 0' }, range === '24h' ? T('The route stayed the same all day.') : T('The route stayed the same all week.'))]));
    if (pts.length < 2) { chart.replaceChildren(el('p', { class: 'small muted' }, T('The chart fills in as tests run.'))); return; }
    const W = Math.max(280, chart.clientWidth || 600), H = 196, padL = 54, padR = 8, padT = 14, lossH = 30, gap = 10, padB = 22, mainH = H - padT - padB - lossH - gap;
    const t0 = since, t1 = Date.now(), okv = pts.map((p) => p.v).filter((v) => v != null), top = Math.max(10, Math.ceil(Math.max(...okv, 1) * 1.2 / 10) * 10), lossMax = Math.max(10, ...pts.map((p) => p.loss || 0));
    const x = (at) => padL + (Date.parse(at) - t0) / (t1 - t0) * (W - padL - padR), y = (v) => padT + mainH * (1 - Math.min(v, top) / top), ly0 = padT + mainH + gap + lossH;
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), add = (tag, at, txt) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; svg.append(e); return e; };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', T('Round trip to the app over {range}: median {ms}, {n} route changes', { range: range === '24h' ? T('24 hours') : T('7 days'), ms: atMs([...okv].sort((p, q) => p - q)[Math.floor(okv.length / 2)]), n: ch.length }));
    for (const v of [0, top / 2, top]) { add('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }); add('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, atMs(v)); }
    add('line', { x1: padL, x2: W - padR, y1: ly0, y2: ly0, class: 'grid' }); add('text', { x: padL - 8, y: ly0 - lossH / 2 + 4, 'text-anchor': 'end', class: 'axis' }, T('loss'));
    let d = '', pen = false;
    for (const p of pts) { if (p.v == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`; pen = true; }
    add('path', { d, class: 'line' });
    const bw = Math.max(2, (W - padL - padR) / pts.length - 1);
    for (const p of pts) { if (p.loss > 0) { const h = Math.max(2, p.loss / lossMax * lossH); add('rect', { x: x(p.at) - bw / 2, y: ly0 - h, width: bw, height: h, rx: 1, class: 'lossbar' }); } if (!p.ok) add('rect', { x: x(p.at) - 1.5, y: padT + mainH - 6, width: 3, height: 6, rx: 1, class: 'fail' }); }
    for (const c of ch) { const cx = x(c.at); add('line', { x1: cx, x2: cx, y1: padT - 4, y2: ly0, class: 'chg' }); add('path', { d: `M${cx},${padT - 10}l5,5l-5,5l-5,-5z`, class: `chgmk${c.kind === 'mtu' ? ' mtu' : ''}` }); }
    for (const [at, anchor] of [[new Date(t0).toISOString(), 'start'], [new Date(t1).toISOString(), 'end']]) add('text', { x: x(at), y: H - 5, 'text-anchor': anchor, class: 'axis' }, range === '24h' ? fmtTime(at) : fmt(at, { weekday: 'short', month: 'short', day: 'numeric' }));
    const cross = add('line', { y1: padT, y2: ly0, class: 'cross', visibility: 'hidden' }), mark = add('circle', { r: 4.5, class: 'mark', visibility: 'hidden' });
    const tip = el('div', { class: 'attip', hidden: true });
    const show = (cx) => {
      const near = ch.find((c) => Math.abs(x(c.at) - cx) < 8);
      let best = pts[0]; for (const p of pts) if (Math.abs(x(p.at) - cx) < Math.abs(x(best.at) - cx)) best = p;
      const px = near ? x(near.at) : x(best.at); cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      if (!near && best.v != null) { mark.setAttribute('cx', px); mark.setAttribute('cy', y(best.v)); mark.setAttribute('visibility', 'visible'); } else mark.setAttribute('visibility', 'hidden');
      tip.replaceChildren(...(near ? [el('b', {}, range === '24h' ? fmtTime(near.at) : fmtWhen(near.at)), el('div', {}, atChangeText(near))]
        : [el('b', {}, range === '24h' ? fmtTime(best.at) : fmtWhen(best.at)), el('div', {}, best.v != null ? T('round trip {ms}', { ms: atMs(best.v) }) : T('No answer')), el('div', { class: 'tiny muted' }, `${T('loss')} ${best.loss ?? 0}%${best.up != null ? ` · ${T('{n}% up', { n: best.up })}` : ''}`)]));
      tip.hidden = false; tip.style.left = `${Math.min(Math.max(px - 110, 0), W - 230)}px`;
    };
    const hit = add('rect', { x: padL - 6, y: 0, width: W - padL - padR + 12, height: H, fill: 'transparent' });
    const pos = (e) => { const b = svg.getBoundingClientRect(); return ((e.touches?.[0]?.clientX ?? e.clientX) - b.left) * (W / b.width); };
    hit.addEventListener('pointermove', (e) => show(pos(e))); hit.addEventListener('pointerdown', (e) => show(pos(e)));
    hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); mark.setAttribute('visibility', 'hidden'); });
    chart.replaceChildren(svg, tip);
  };
  box.append(el('div', { class: 'row between wrap', style: 'gap:8px;margin-bottom:6px' }, el('span', { class: 'tiny muted' }, T('Round trip to the app, loss below it, and route changes (◆).')), seg), chart, list);
  atWatchWidth(chart, paint);
  return box;
}
function atChangeText(c) {
  if (c.kind === 'mtu') return T('Largest packet size (MTU) changed: {a} → {b} bytes', { a: c.mtuFrom, b: c.mtuTo });
  const from = (c.from || []).join(' → ') || '?', to = (c.to || []).join(' → ') || '?';
  return from === to ? T('Route changed ({a} → {b} hops)', { a: c.hopsFrom, b: c.hopsTo }) : T('Route changed: {from} became {to}', { from, to });
}
