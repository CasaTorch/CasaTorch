/* ---- Network > App tests: how well your apps answer from home, and the path there (77-apptests.js) ---- */
const AT_PHASES = [['dns', 'Finding it (DNS)'], ['connect', 'Connecting'], ['tls', 'Secure handshake'], ['wait', 'App\'s answer'], ['download', 'Download']];
const AT_ZONES = { home: 'Your home', provider: 'Your internet provider', internet: 'Internet', app: 'The app' };
const atMs = (v) => (v == null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)} s` : `${Math.round(v)} ms`);
const atState = (t) => (!t.last ? ['warn', 'Checking'] : t.down ? ['bad', 'Down'] : t.failing ? ['warn', 'Missed one'] : t.median24h && t.last.total > 2 * t.median24h && t.last.total > 800 ? ['warn', 'Slow'] : ['good', 'OK']);
/* The five steps of a test as one bar: each step's share of the time, 2px gaps between. */
function atBar(r, big = false) {
  const parts = AT_PHASES.map(([k]) => [k, Math.max(0, r?.[k] || 0)]).filter(([, v]) => v > 0), sum = parts.reduce((s, [, v]) => s + v, 0);
  const bar = el('div', { class: `atbar${big ? ' big' : ''}`, role: 'img', 'aria-label': AT_PHASES.map(([k, l]) => `${l} ${atMs(r?.[k])}`).join(', ') });
  if (!r?.ok || !sum) { bar.classList.add('empty'); return bar; }
  for (const [k, v] of parts) bar.append(el('i', { class: `ph-${k}`, style: `flex-grow:${v}`, title: `${AT_PHASES.find((p) => p[0] === k)[1]}: ${atMs(v)}` }));
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
  const [dot, word] = t.paused ? ['warn', 'Paused (Pro)'] : atState(t), l = t.last;
  return el('button', { class: `attile${t.down ? ' down' : ''}`, onclick: () => onOpen(t.id), 'aria-label': `${t.name}: ${word}${l?.total ? `, ${atMs(l.total)}` : ''}. Open details` },
    el('div', { class: 'row', style: 'gap:10px' }, el('span', { class: 'atbadge', 'aria-hidden': 'true' }, t.short || t.name[0]), el('b', { class: 'grow ellipsis' }, t.name), el('span', { class: `pill ${dot}` }, el('span', { class: `dot ${dot}` }), word)),
    el('div', { class: 'row', style: 'gap:8px;align-items:baseline;margin-top:10px' }, el('span', { class: `atbig${l && !l.ok ? ' fail' : ''}` }, l?.ok ? atMs(l.total) : l ? 'No answer' : '…'), l?.ok ? el('span', { class: 'tiny muted' }, 'to load') : el('span', { class: 'tiny muted ellipsis' }, l?.error || '')),
    atBar(l),
    el('div', { class: 'tiny muted atnet' }, l?.latency != null ? `latency ${atMs(l.latency)} · jitter ${atMs(l.jitter)} · loss ${l.loss}%` : l?.loss === 100 ? 'no answer to network probes (100% loss)' : 'network: -'),
    el('div', { class: 'row between', style: 'gap:10px;margin-top:6px' }, el('span', { class: 'tiny muted' }, t.uptime24h != null ? `${t.uptime24h}% up today${t.hops ? ` · ${t.hops} hops` : ''}` : 'first test running'), atSpark(t.spark || [])),
    t.pathChangedAt && Date.now() - Date.parse(t.pathChangedAt) < 86400_000 ? el('div', { class: 'tiny', style: 'color:var(--warn);margin-top:4px' }, `Path changed ${ago(t.pathChangedAt)}`) : null);
}
function appTestsCard(a, redraw) {
  const card = el('div', { class: 'card apptests', style: 'margin-top:14px' });
  const head = el('div', {}, el('h2', { style: 'margin:0' }, 'App tests'), el('p', { class: 'small muted', style: 'margin:4px 0 0' }, 'How fast your apps answer from home, and the path your traffic takes to get there.'));
  const add = !a.demo && a.tests.length < a.max ? el('button', { class: 'btn small', onclick: () => atAdd(a, redraw) }, icon('plus'), 'Add a test') : null;
  card.append(el('div', { class: 'row between', style: 'margin-bottom:12px;align-items:flex-start;gap:12px' }, head, add));
  if (!a.tests.length) {
    const quick = ['google', 'm365', 'zoom', 'youtube'].map((id) => a.presets.find((p) => p.id === id)).filter(Boolean);
    card.append(el('div', { class: 'atempty' }, el('p', { class: 'muted', style: 'margin:0 0 10px' }, 'Pick the apps you use - for work, school or at home - and CasaTorch tests them every few minutes: how long each step takes, latency, jitter and loss, and every hop from your router to the app.'),
      el('div', { class: 'row wrap', style: 'gap:8px' }, quick.map((p) => el('button', { class: 'btn small', onclick: async (e) => { e.target.disabled = true; try { await post('/api/apptests', { preset: p.id }); toast(`${p.name} added`); redraw(); } catch (err) { toast(err.message); e.target.disabled = false; } } }, icon('plus'), p.name)),
        el('button', { class: 'btn small primary', onclick: () => atAdd(a, redraw) }, 'More apps…'))));
    return card;
  }
  card.append(el('div', { class: 'atgrid' }, a.tests.map((t) => atTile(t, (id) => atOpen(id, a, redraw)))));
  if (!a.traceroute) card.append(el('p', { class: 'tiny muted', style: 'margin:10px 0 0' }, 'The hop-by-hop path needs traceroute, which this computer doesn\'t have. The tests themselves work.'));
  if (!a.pro) card.append(el('p', { class: 'tiny muted', style: 'margin:10px 0 0' }, `Basic tests the built-in apps (up to ${a.basicMax}). `, el('a', { href: '#settings' }, 'Pro'), ' adds your own websites, up to 30 tests, testing every minute, and an alert when an app stops answering.'));
  return card;
}
function atAdd(a, redraw) {
  const have = new Set(a.tests.map((t) => t.preset).filter(Boolean));
  const every = el('select', { 'aria-label': 'How often', style: 'width:auto' }, a.every.map((m) => el('option', { value: m, selected: m === 5 ? true : null }, m === 1 ? 'Every minute' : `Every ${m} minutes`)));
  const msg = el('p', { class: 'small', style: 'min-height:1.2em;margin:8px 0 0' });
  const go = async (body, btn) => {
    btn.disabled = true; msg.style.color = ''; msg.textContent = 'Testing it…';
    try { const r = await post('/api/apptests', { ...body, every: Number(every.value) }); m.remove(); toast(r.test.last?.ok ? `${r.test.name}: ${atMs(r.test.last.total)}` : `${r.test.name} added - it didn't answer yet`); redraw(); }
    catch (e) { msg.style.color = 'var(--bad)'; msg.textContent = e.message; btn.disabled = false; }
  };
  const group = (g, title) => el('div', { class: 'atpick' }, el('h3', {}, title), el('div', { class: 'row wrap', style: 'gap:8px' },
    a.presets.filter((p) => p.group === g).map((p) => el('button', { class: 'btn small', disabled: have.has(p.id) && p.id !== 'sharepoint' ? true : null, onclick: (e) => {
      if (p.needs === 'tenant') { const v = prompt('Your company\'s SharePoint name - the part before .sharepoint.com (for example, in contoso.sharepoint.com it\'s "contoso")'); if (v) go({ preset: p.id, tenant: v }, e.currentTarget); return; }
      go({ preset: p.id }, e.currentTarget);
    } }, el('span', { class: 'atbadge sm', 'aria-hidden': 'true' }, p.short), p.name, have.has(p.id) && p.id !== 'sharepoint' ? icon('check') : null))));
  const url = el('input', { type: 'url', placeholder: 'https://example.com', autocomplete: 'off', disabled: a.pro ? null : true });
  const name = el('input', { placeholder: 'Name (optional)', maxlength: 40, disabled: a.pro ? null : true });
  const own = el('div', { class: 'atpick' }, el('h3', {}, 'Your own website ', el('span', { class: 'pill pro' }, 'Pro')),
    a.pro ? el('div', { class: 'row wrap', style: 'gap:8px' }, el('div', { class: 'grow', style: 'min-width:220px' }, url), el('div', { style: 'width:180px' }, name), el('button', { class: 'btn primary', onclick: (e) => go({ url: url.value, name: name.value }, e.currentTarget) }, 'Add'))
      : el('p', { class: 'small muted', style: 'margin:0' }, 'Test any website or web app - your company\'s portal, a school site, a game server\'s page. ', el('a', { href: '#settings', onclick: () => m.remove() }, 'Unlock with Pro')));
  const m = modal(el('div', {}, group('work', 'Work and school'), group('home', 'Home'), own,
    el('div', { class: 'row', style: 'gap:10px;margin-top:14px' }, el('span', { class: 'small muted' }, 'Test'), every),
    el('p', { class: 'tiny muted' }, 'Tests run from this CasaTorch straight to the app - they load the app\'s sign-in or home page, without signing in. Nothing goes through casatorch.com.'), msg), { title: 'Add an app test', wide: true });
}
/* The detail sheet: the last test step by step, the day as a chart, and the path. */
async function atOpen(id, a, redraw) {
  const body = el('div', { class: 'atdetail' }, el('p', { class: 'muted' }, 'Loading…'));
  const m = modal(body, { title: 'App test', wide: true });
  const draw = (t) => {
    const [dot, word] = atState(t), l = t.last;
    const runBtn = el('button', { class: 'btn small primary', onclick: async () => { runBtn.disabled = true; runBtn.lastChild.textContent = 'Testing…'; try { draw(await post(`/api/apptests/${encodeURIComponent(id)}/run`, {})); } catch (e) { toast(e.message); runBtn.disabled = false; } } }, icon('play'), 'Test now');
    const pathBtn = el('button', { class: 'btn small', onclick: async () => { pathBtn.disabled = true; pathBtn.lastChild.textContent = 'Tracing (up to a minute)…'; try { draw(await post(`/api/apptests/${encodeURIComponent(id)}/run?path=1`, {})); } catch (e) { toast(e.message); pathBtn.disabled = false; } } }, icon('reset'), 'Trace the path now');
    const every = el('select', { 'aria-label': 'How often', disabled: a.demo ? true : null, onchange: async () => { try { await post(`/api/apptests/${encodeURIComponent(id)}`, { every: Number(every.value) }, 'PUT'); toast('Saved'); redraw(); } catch (e) { toast(e.message); } } },
      a.every.map((n) => el('option', { value: n, selected: n === t.every ? true : null }, n === 1 ? 'Every minute' : `Every ${n} minutes`)));
    const del = a.demo ? null : el('button', { class: 'btn small ghost danger', onclick: async () => { if (!confirm(`Stop testing ${t.name}?`)) return; try { await api(`/api/apptests/${encodeURIComponent(id)}`, { method: 'DELETE' }); m.remove(); redraw(); } catch (e) { toast(e.message); } } }, icon('x'), 'Remove');
    const steps = el('div', { class: 'atsteps' }, AT_PHASES.map(([k, lab]) => el('div', { class: 'atstep' }, el('i', { class: `sw ph-${k}`, 'aria-hidden': 'true' }), el('span', { class: 'grow' }, lab), el('b', {}, atMs(l?.[k])))),
      el('div', { class: 'atstep total' }, el('span', { class: 'grow' }, 'Total'), el('b', {}, l?.ok ? atMs(l.total) : 'No answer')));
    body.replaceChildren(
      el('div', { class: 'row between wrap', style: 'gap:10px' }, el('div', { class: 'row', style: 'gap:12px;min-width:0' }, el('span', { class: 'atbadge lg', 'aria-hidden': 'true' }, t.short), el('div', { style: 'min-width:0' }, el('h2', { style: 'margin:0' }, t.name), el('div', { class: 'tiny muted ellipsis' }, t.url))),
        el('span', { class: `pill ${dot}` }, el('span', { class: `dot ${dot}` }), word)),
      el('div', { class: 'row wrap', style: 'gap:8px;margin:12px 0 4px' }, a.demo ? null : runBtn, a.demo || !a.traceroute ? null : pathBtn, every, del),
      el('div', { class: 'atcols' },
        el('section', {}, el('h3', {}, 'Last test', l ? el('span', { class: 'tiny muted', style: 'font-weight:400;margin-left:6px' }, ago(l.at)) : null), atBar(l, true), steps, l?.error ? el('p', { class: 'small', style: 'color:var(--bad)' }, `Didn't work: ${l.error}`) : null,
          l?.status ? el('p', { class: 'tiny muted' }, `The app answered ${l.status}${l.ip ? ` from ${l.ip}` : ''}.`) : null),
        el('section', {}, el('h3', {}, 'Network to the app'), el('div', { class: 'atstats' },
          [['Latency', atMs(l?.latency), 'how long a round trip takes'], ['Jitter', atMs(l?.jitter), 'how much that wobbles'], ['Loss', l?.loss != null ? `${l.loss}%` : '-', 'probes that got no answer']].map(([k, v, s]) => el('div', { class: 'atstat' }, el('span', { class: 'tiny muted' }, k), el('b', {}, v), el('span', { class: 'tiny muted' }, s)))),
          el('p', { class: 'tiny muted' }, 'From five quick connections to the app each test. Video calls stay smooth with latency under about 100 ms, jitter under 30 ms and no loss.'))),
      el('h3', {}, 'Today'), atChart(t.runs || []),
      el('h3', { style: 'margin-top:18px' }, 'Path to the app', t.path ? el('span', { class: 'tiny muted', style: 'font-weight:400;margin-left:6px' }, `traced ${ago(t.path.at)}`) : null),
      atPath(t, a));
  };
  try { draw(await api(`/api/apptests/${encodeURIComponent(id)}`)); } catch (e) { body.replaceChildren(el('p', { class: 'small', style: 'color:var(--bad)' }, e.message)); }
}
/* The day's tests as a line (time to load), with a crosshair and a tooltip on hover or touch. */
function atChart(runs) {
  const box = el('div', { class: 'atchart' });
  if (runs.length < 2) { box.append(el('p', { class: 'small muted' }, 'The chart fills in as tests run.')); return box; }
  const paint = () => {
    const W = Math.max(280, box.clientWidth || 600), H = 170, padL = 54, padR = 8, padT = 10, padB = 22;
    const t0 = Date.parse(runs[0].at), t1 = Date.parse(runs[runs.length - 1].at), okv = runs.filter((r) => r.ok).map((r) => r.total);
    const top = Math.max(100, Math.ceil(Math.max(...okv, 1) * 1.15 / 100) * 100);
    const x = (t) => padL + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (W - padL - padR), y = (v) => padT + (H - padT - padB) * (1 - Math.min(v, top) / top);
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), add = (tag, at, txt) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; svg.append(e); return e; };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Time to load over the day: median ${atMs(okv.sort((p, q) => p - q)[Math.floor(okv.length / 2)])}, ${runs.filter((r) => !r.ok).length} failed tests`);
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
      tip.replaceChildren(el('b', {}, fmtTime(best.at)), el('div', {}, best.ok ? `${atMs(best.total)} to load` : `No answer: ${best.error || 'failed'}`),
        best.ok ? el('div', { class: 'tiny muted' }, `DNS ${atMs(best.dns)} · connect ${atMs(best.connect)} · handshake ${atMs(best.tls)} · answer ${atMs(best.wait)}`) : null,
        best.latency != null ? el('div', { class: 'tiny muted' }, `latency ${atMs(best.latency)} · jitter ${atMs(best.jitter)} · loss ${best.loss}%`) : null);
      tip.hidden = false; tip.style.left = `${Math.min(Math.max(px - 110, 0), W - 230)}px`;
    };
    const hit = add('rect', { x: padL, y: 0, width: W - padL - padR, height: H, fill: 'transparent' });
    const pos = (e) => { const b = svg.getBoundingClientRect(); return ((e.touches?.[0]?.clientX ?? e.clientX) - b.left) * (W / b.width); };
    hit.addEventListener('pointermove', (e) => show(pos(e))); hit.addEventListener('pointerdown', (e) => show(pos(e)));
    hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); mark.setAttribute('visibility', 'hidden'); });
    box.replaceChildren(svg, tip);
  };
  let lastW = 0; const ro = new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) > 4) { lastW = box.clientWidth; paint(); } }); ro.observe(box);
  return box;
}
/* The path, left to right: this CasaTorch, each hop grouped by whose network it's in, then the app. A hop that
   doesn't answer traces is drawn hollow - that's normal, many routers stay quiet. A big jump in time is marked. */
function atPath(t, a) {
  const p = t.path;
  if (!a.traceroute) return el('p', { class: 'small muted' }, 'This computer doesn\'t have traceroute, so the path can\'t be shown.');
  if (!p) return el('p', { class: 'small muted' }, 'Tracing the path - it shows up here within a few minutes.');
  if (p.error) return el('p', { class: 'small muted' }, p.error);
  const nodes = [{ zone: 'home', label: 'This CasaTorch', you: true, ms: 0 }, ...p.hops.map((h) => ({ ...h, label: h.ip || 'no reply' })), { zone: 'app', label: t.name, ip: p.dest?.ip, name: p.dest?.name, ms: p.dest?.ms, app: true }];
  const groups = []; for (const n of nodes) { const g = groups[groups.length - 1]; if (g && g.zone === n.zone) g.nodes.push(n); else groups.push({ zone: n.zone, nodes: [n] }); }
  let prevMs = 0;
  const row = el('div', { class: 'atpath', role: 'list', 'aria-label': `Path to ${t.name}: ${nodes.length - 2} hops` }, groups.map((g) => el('div', { class: `atzone z-${g.zone}` },
    el('div', { class: 'atzlabel' }, AT_ZONES[g.zone], g.zone === 'provider' ? el('span', { class: 'muted', title: 'Worked out from the hops\' names - providers don\'t label their routers consistently.' }, ' (estimated)') : null),
    el('div', { class: 'atznodes' }, g.nodes.map((n) => {
      const jump = n.ms != null && prevMs != null && n.ms - prevMs >= 30 && !n.you; if (n.ms != null) prevMs = n.ms;
      return el('div', { class: `athop${n.ip || n.you ? '' : ' quiet'}${jump ? ' jump' : ''}${n.app ? ' app' : ''}${n.you ? ' you' : ''}`, role: 'listitem', title: [n.n ? `Hop ${n.n}` : null, n.ip, n.name, n.ms != null ? `${n.ms} ms` : null].filter(Boolean).join(' · ') },
        el('span', { class: 'athopdot', 'aria-hidden': 'true' }, n.you ? icon('home') : n.app ? (t.short || '•') : ''),
        el('span', { class: 'athoplab ellipsis' }, n.app ? n.label : n.you ? n.label : n.label),
        n.name && !n.app ? el('span', { class: 'tiny muted ellipsis athopname' }, n.name) : n.app && n.ip ? el('span', { class: 'tiny muted ellipsis athopname' }, n.ip) : null,
        el('span', { class: 'tiny athopms' }, n.you ? '' : n.ms != null ? `${atMs(n.ms)}${jump ? ' ▲' : ''}` : n.ip ? '' : 'quiet'));
    })))));
  const legend = el('p', { class: 'tiny muted', style: 'margin:8px 0 0' }, 'Times are the round trip from this CasaTorch to each hop. ▲ marks a jump of 30 ms or more - where a slowdown starts. Hollow hops didn\'t answer the trace (normal for many routers).');
  const changed = t.pathChangedAt ? el('p', { class: 'small', style: 'color:var(--warn);margin:8px 0 0' }, `The path changed ${ago(t.pathChangedAt)}. Routes change now and then; if the app got slower at the same time, the new route may be the reason.`) : null;
  return el('div', {}, el('div', { class: 'atpathwrap' }, row), legend, changed);
}
