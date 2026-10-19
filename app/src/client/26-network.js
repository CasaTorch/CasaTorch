/* ======================================================================
 * Network: a page of tiles (06-pagegrid.js). With just a Meraki or UniFi key, CasaTorch draws the whole
 * network: the internet and each uplink, a live map from the internet through the gateway and switches to the
 * access points and their clients, every device online or offline, Wi-Fi by band, network name and access
 * point, switch ports, the top users, events, firmware and licenses (74n-net-model.js). Next to it, what works
 * with any router: internet health, speed tests, app and network tests, your DNS filter and new devices.
 *
 * Each tile shows more as it grows (S: the state, M: + a sparkline, L: + a list or chart, XL: + details).
 * Status colors are the same everywhere: green online, amber needs a look, red offline, gray idle.
 * Public addresses come only to admins and stay masked until tapped. Charts and the map are plain SVG.
 * ====================================================================== */
Object.assign(ICONS, {
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3.6 9h16.8M3.6 15h16.8M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9M12 3c-2.4 2.5-3.6 5.5-3.6 9s1.2 6.5 3.6 9',
  nrouter: 'M3 12h18v7H3zM6.5 15.5h.01M9.5 15.5h.01M14 15.5h4M7 12 5 5M17 12l2-7',
  nswitch: 'M3 7.5h18v9H3zM6 11h2v2H6zM10 11h2v2h-2zM14 11h2v2h-2zM18 11h.5',
  nap: 'M4 14.5c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3M12 14.5h.01M8.5 8a5 5 0 0 1 7 0M6 5.5a8.5 8.5 0 0 1 12 0',
  ncell: 'M8 21l4-11 4 11M9.4 17h5.2M12 10V8M9 6.2a4.2 4.2 0 0 1 6 0M6.6 3.8a7.6 7.6 0 0 1 10.8 0',
  nsensor: 'M7 3h10v18H7zM10 7h4M12 12a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  nclients: 'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.8a3.2 3.2 0 0 1 0 6.1M18 14.3c1.8.8 3 2.9 3 5.7',
  nbox: 'M4 6h16v12H4zM8 18v2M16 18v2M7.5 10h9M7.5 14h5',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
});
const NW_TYPE = { internet: ['globe', 'Internet'], appliance: ['nrouter', 'Gateway'], cellular: ['ncell', 'Cellular gateway'], switch: ['nswitch', 'Switch'], wireless: ['nap', 'Access point'], camera: ['camera', 'Camera'], sensor: ['nsensor', 'Sensor'], other: ['nbox', 'Device'], box: ['nbox', 'This CasaTorch'], more: ['grid', 'More'] };
const NW_TYPES_PL = [['appliance', 'Gateways'], ['cellular', 'Cellular'], ['switch', 'Switches'], ['wireless', 'Access points'], ['camera', 'Cameras'], ['sensor', 'Sensors'], ['other', 'Other']];
const NW_ST = { online: ['good', 'Online'], alerting: ['warn', 'Alerting'], offline: ['bad', 'Offline'], dormant: ['idle', 'Dormant'], unknown: ['idle', 'Unknown'], standby: ['idle', 'Standby'] };
const nwSt = (s) => (NW_ST[s] || NW_ST.unknown)[0];
const nwStWord = (s) => T((NW_ST[s] || NW_ST.unknown)[1]);
const NW_UP_ST = { active: ['good', 'Active'], ready: ['idle', 'Ready'], standby: ['idle', 'Standby'], failed: ['bad', 'Down'], 'not connected': ['idle', 'Not connected'], connecting: ['warn', 'Connecting'] };
const NW_IFACE = { wan1: 'WAN 1', wan2: 'WAN 2', wan3: 'WAN 3', cellular: 'Cellular' };
const NW_SEV = { bad: 3, warn: 2, idle: 1, good: 0 };
const nwPut = (b, ...k) => b.replaceChildren(...k.flat().filter((x) => x != null && x !== false && x !== ''));
const nwTier = (size) => size?.tier || sizeTier(size || {});
const nwAt = (size, t) => TIER_RANK[nwTier(size)] >= TIER_RANK[t];
const NW_NF = new Map();   // one number format per language (making one costs more than using it)
const nwN = (v) => { if (v == null) return '-'; const l = dateLoc(); let f = NW_NF.get(l); if (!f) NW_NF.set(l, (f = new Intl.NumberFormat(l))); return f.format(v); };
const nwGB = (kb) => (kb == null ? '-' : kb >= 1e6 ? `${(kb / 1e6).toFixed(kb >= 1e7 ? 0 : 1)} GB` : kb >= 1e3 ? `${Math.round(kb / 1e3)} MB` : `${Math.round(kb)} KB`);
const nwPct = (v) => (v == null ? '-' : `${Math.round(v * 10) / 10}%`);
const nwStat = (label, value, sub, cls = '') => el('div', { class: `en-stat ${cls}` }, el('div', { class: 'en-lbl' }, label), el('div', { class: 'en-val' }, value), sub ? el('div', { class: 'en-sub' }, sub) : null);
const nwPill = (cls, text) => el('span', { class: `pill nw-pill ${cls}` }, el('span', { class: `dot ${cls}` }), text);
const nwModel = (ctx) => ctx.data?.ov?.model || null;
const nwDev = (ctx, id) => nwModel(ctx)?.devices?.find((d) => d.id === id) || null;
/* A public address: masked until tapped, then shown for 20 seconds - and only ever sent to admins. */
function nwIp(ip) {
  if (!ip) return null;
  const masked = String(ip).includes(':') ? `${String(ip).split(':').slice(0, 2).join(':')}:••••` : String(ip).replace(/^(\d+)\.\d+\.\d+\.(\d+)$/, '•••.•••.•••.$2');
  const b = el('button', { type: 'button', class: 'nw-ip', title: T('Show the address'), 'aria-label': T('Show the address') }, icon('eye', 13), el('span', {}, masked));
  let t = null;
  b.onclick = (e) => { e.stopPropagation(); const on = !b.classList.contains('shown'); b.classList.toggle('shown', on); b.lastChild.textContent = on ? ip : masked; clearTimeout(t); if (on) t = setTimeout(() => { b.classList.remove('shown'); b.lastChild.textContent = masked; }, 20_000); };
  return b;
}
/* What a tile needs that isn't there yet: Meraki or UniFi (Pro), or the first read still running. */
function nwNeed(b, ctx, what) {
  const ov = ctx.data?.ov, admin = nwAdmin();
  if (ov?.source && !ov.model) return nwPut(b, el('div', { class: 'pg-empty-state' }, ov.source.error ? el('div', { class: 'small bad' }, T('Can\'t read {name}: {error}', { name: ov.source.name, error: ov.source.error })) : [pgSkel(3), el('div', { class: 'tiny muted' }, T('Reading your network - the first time takes a minute.'))]));
  if (!ov?.pro) return nwPut(b, el('div', { class: 'en-lock' }, el('span', { class: 'pill pro' }, 'Pro'), el('div', { class: 'small muted' }, what), el('a', { class: 'btn small', href: '#settings/pro' }, T('Unlock with Pro'))));
  nwPut(b, el('div', { class: 'pg-empty-state' }, el('div', { class: 'small muted' }, what), admin ? el('button', { class: 'btn small', onclick: () => netConnect(ctx.data.nw, () => ctx.refresh?.()) }, icon('plus', 14), T('Connect Meraki or UniFi')) : null));
}
const nwAdmin = () => { const r = S.me?.user?.role; return !S.status?.demo && (!S.me?.user || (['owner', 'admin'].includes(r) && !S.me.user.panel)); };

/* ---- internet health: online, latency and loss, each uplink ---- */
pageTile({ id: 'net-internet', page: 'network', title: 'Internet', icon: 'globe', blurb: 'Online or down, latency and loss over the day, and each uplink (WAN 1, WAN 2, cellular)', size: [4, 3], min: [2, 2], max: [12, 8], phoneFull: true, render(b, ctx, size) {
  const n = ctx.data?.inet || {}, m = nwModel(ctx), hist = ctx.data?.ov?.history || {};
  const ups = (m?.uplinks || []).slice().sort((a, c) => (a.status === 'active' ? 0 : 1) - (c.status === 'active' ? 0 : 1) || String(a.iface).localeCompare(String(c.iface)));
  const main = ups.find((u) => u.status === 'active');
  const lat = main?.lat ?? n.latencyMs?.cloudflare ?? n.latencyMs?.google ?? null, loss = main?.loss ?? null;
  const series = (main && hist.up?.[`${main.dev}:${main.iface}`]?.map((p) => p[2])) || (hist.inet || []).map((p) => p[1]);
  const online = n.online !== false && (!ups.length || ups.some((u) => u.status === 'active'));
  const head = el('div', { class: 'nw-hero-row' },
    el('div', { class: 'nw-hero' }, el('span', { class: `nw-orb ${online ? 'good' : 'bad'}` }), el('div', {}, el('b', {}, online ? T('Online') : T('Down')), el('div', { class: 'tiny muted ellipsis' }, [n.provider || main?.provider, ups.length > 1 && ups.filter((u) => u.status === 'active').length === 1 && ups.some((u) => u.status === 'ready') ? T('backup ready') : null].filter(Boolean).join(' · ') || T('Your internet')))),
    el('div', { class: 'nw-kpis' }, nwStat(T('Latency'), lat != null ? atMs(lat) : '-', null, 'sm'), loss != null && nwAt(size, 'm') ? nwStat(T('Loss'), nwPct(loss), null, `sm${loss >= 2 ? ' warn' : ''}`) : null));
  const spark = series.filter((v) => v != null).length > 3 && (nwAt(size, 'm') || size.h >= 3) ? pgLine(series, { end: Date.now(), step: 300_000, fmt: (v) => atMs(v), label: T('Latency, the last 24 hours'), h: size.h >= 4 ? 70 : 44, cls: 'nw-line' }) : null;
  const upRow = (u) => { const [c, w] = NW_UP_ST[u.status] || ['idle', u.status || '-'];
    return el('div', { class: 'nw-up' }, el('span', { class: 'nw-up-ic' }, icon(u.iface === 'cellular' ? 'ncell' : 'globe', 16)),
      el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'row', style: 'gap:6px' }, el('b', {}, T(NW_IFACE[u.iface] || u.iface)), el('span', { class: 'tiny muted ellipsis' }, [u.provider, u.kind, u.via ? T('through {name}', { name: nwDev(ctx, u.via)?.name || '' }) : null].filter(Boolean).join(' · '))),
        el('div', { class: 'tiny muted' }, [u.lat != null ? atMs(u.lat) : null, u.loss != null ? T('{n}% loss', { n: u.loss }) : null, u.rxBps != null ? `↓ ${Math.round(u.rxBps / 1e5) / 10} Mbps` : null].filter(Boolean).join(' · ') || ' ')),
      ctx.data?.ov?.canIp && nwAt(size, 'l') ? nwIp(u.publicIp) : null, nwPill(c, T(w))); };
  const room = Math.floor((size.h * 78 + (size.h - 1) * 14 - (spark ? 150 + (size.h >= 4 ? 26 : 0) : 100)) / 58);
  const list = ups.length && room >= 1 ? el('div', { class: 'nw-ups' }, ups.slice(0, Math.min(4, room)).map(upRow)) : null;
  const pings = !ups.length && nwAt(size, 'm') ? el('div', { class: 'nw-chips' }, Object.entries(n.latencyMs || {}).map(([k, v]) => el('span', { class: 'chip-stat' }, el('i', { class: v == null ? 'bad' : '' }), `${{ cloudflare: 'Cloudflare', google: 'Google', router: T('Router') }[k] || k} ${v == null ? '-' : `${v} ms`}`))) : null;
  nwPut(b, head, spark, list, pings);
} });

/* ---- speed tests ---- */
pageTile({ id: 'net-speed', page: 'network', title: 'Speed', icon: 'gauge', blurb: 'Download and upload speed, every 4 hours or when you ask', size: [4, 2], min: [2, 2], max: [12, 6], render(b, ctx, size) {
  const n = ctx.data?.inet || {}, s = n.speed, hist = (ctx.data?.ov?.history?.speed || []).filter((x) => x[1] != null);
  const btn = el('button', { class: 'btn small', disabled: !S.me?.user || ['member', 'admin', 'owner'].includes(S.me?.user?.role) ? null : true }, icon('bolt', 14), T('Run a speed test'));
  btn.onclick = async () => { btn.disabled = true; btn.lastChild.textContent = T('Testing (about 20 s)...'); try { await post('/api/internet/speedtest'); toast(T('Speed test done')); ctx.refresh?.(); } catch (err) { toast(err.message); btn.disabled = false; } };
  if (!s?.downMbps) return nwPut(b, el('div', { class: 'pg-empty-state' }, el('div', { class: 'small muted' }, s?.error ? T('The last test didn\'t work: {error}', { error: s.error }) : T('No test yet. CasaTorch tests every 4 hours.')), btn));
  const narrow = size.w < 3 && size.h < 3;   // a small tile (a phone's half width): upload goes under download
  const kp = narrow ? el('div', { class: 'nw-speed' }, nwStat(T('Download'), el('span', {}, Math.round(s.downMbps), el('small', {}, ' Mbps')), `${T('Upload')} ${Math.round(s.upMbps)} Mbps`))
    : el('div', { class: 'nw-speed' }, nwStat(T('Download'), el('span', {}, Math.round(s.downMbps), el('small', {}, ' Mbps'))), nwStat(T('Upload'), el('span', {}, Math.round(s.upMbps), el('small', {}, ' Mbps'))));
  const chart = hist.length >= 3 && (nwAt(size, 'm') || size.h >= 3) && size.h >= 3 ? el('div', { class: 'nw-speed-chart' }, pgSpark(hist.map((x) => x[1]), { w: 300, h: size.h >= 4 ? 60 : 36, cls: 'en-grid-c', label: T('Download speed, the last {n} tests', { n: hist.length }) }), el('div', { class: 'en-axis' }, el('span', {}, T('{n} tests', { n: hist.length })), el('span', {}, T('now')))) : null;
  nwPut(b, kp, chart, el('div', { class: 'row between wrap nw-foot', style: 'gap:8px' }, el('span', { class: 'tiny muted' }, T('Tested {when}', { when: fmtWhen(s.at) })), size.h >= 2 && size.w >= 3 ? btn : null));
} });

/* ---- the map ---- */
/* Lay the tree out: leaves spread along one axis in order, each parent centered over its children; layers along the
   other. Too many children for the room: the rest fold into one "+n" node. o: { W, H, horiz, pad } -> positions. */
function nwLayout(topo, o) {
  const nodes = topo.nodes.map((n) => ({ ...n })), byId = new Map(nodes.map((n) => [n.id, n])), kids = new Map(nodes.map((n) => [n.id, []]));
  const sev = (n) => NW_SEV[nwSt(n.status)] || 0, rank = { appliance: 0, cellular: 1, switch: 2, wireless: 3, camera: 4, sensor: 5, other: 6 };
  for (const n of nodes) if (n.parent && kids.has(n.parent)) kids.get(n.parent).push(n);
  for (const [, ch] of kids) ch.sort((a, c) => (rank[a.type] ?? 6) - (rank[c.type] ?? 6) || String(a.name).localeCompare(String(c.name)));
  const along = o.horiz ? o.H : o.W, minSlot = o.horiz ? 54 : o.W < 520 ? 62 : 74;
  const slots = Math.max(2, Math.floor((along - o.pad * 2) / minSlot) + 1);
  const leafCount = (id) => { const ch = kids.get(id) || []; return ch.length ? ch.reduce((s, c) => s + leafCount(c.id), 0) : 1; };
  // fold: the parent with the most children loses its quietest two into a "+n" until the leaves fit
  for (let guard = 0; guard < 60 && leafCount('internet') > slots; guard++) {
    let best = null; for (const [id, ch] of kids) if (ch.length > 2 && (!best || ch.length > kids.get(best).length)) best = id;
    if (!best) break;
    const ch = kids.get(best), keep = ch.slice().sort((a, c) => sev(c) - sev(a) || (c.clients || 0) - (a.clients || 0)).slice(0, ch.length - 2);
    const gone = ch.filter((x) => !keep.includes(x) && x.type !== 'more'), more = ch.find((x) => x.type === 'more');
    const fold = (x) => { for (const k of kids.get(x.id) || []) fold(k); kids.delete(x.id); byId.delete(x.id); };
    gone.forEach(fold);
    const m = more || { id: `more:${best}`, type: 'more', name: '', status: 'online', layer: ch[0].layer, parent: best, folded: [] };
    m.folded = [...(m.folded || []), ...gone.map((x) => x.name)]; m.ids = [...(m.ids || []), ...gone.map((x) => x.id)]; m.name = `+${m.folded.length}`; if (gone.some((x) => nwSt(x.status) === 'bad')) m.status = 'offline';
    kids.set(best, [...keep.filter((x) => x.type !== 'more'), m]); byId.set(m.id, m); kids.set(m.id, []);
  }
  let i = 0; const pos = new Map();
  const place = (id) => { const ch = kids.get(id) || []; if (!ch.length) { pos.set(id, i++); return pos.get(id); } const xs = ch.map((c) => place(c.id)); pos.set(id, (xs[0] + xs[xs.length - 1]) / 2); return pos.get(id); };
  place('internet');
  for (const n of byId.values()) if (!pos.has(n.id)) pos.set(n.id, i++);   // not in the tree (shouldn't happen): at the end
  const leaves = Math.max(1, i), layers = Math.max(...[...byId.values()].map((n) => n.layer)) + 1;
  const span = along - o.pad * 2, step = leaves > 1 ? Math.min(span / (leaves - 1), o.horiz ? 120 : 220) : 0, off = o.pad + (span - step * (leaves - 1)) / 2;
  const deep = (o.horiz ? o.W : o.H) - o.top - o.bottom, lstep = layers > 1 ? Math.min(deep / (layers - 1), o.horiz ? 170 : 132) : 0, loff = o.top + (deep - lstep * (layers - 1)) / 2;
  const out = [];
  for (const n of byId.values()) { const a = off + pos.get(n.id) * step, l = loff + n.layer * lstep; out.push({ ...n, x: o.horiz ? l : a, y: o.horiz ? a : l }); }
  return { nodes: out, step, lstep, slots, layers };
}
function nwTopoDraw(box, data, ctx) {
  const { topo, detail, model } = data, W = Math.max(200, box.clientWidth), H = Math.max(150, box.clientHeight);
  const horiz = false;   // top to bottom everywhere: on a phone, quiet branches fold into "+n" (tap the map's devices list for all)
  const L = nwLayout(topo, { W, H, horiz, pad: W < 520 ? 30 : 46, top: horiz ? 34 : 30, bottom: horiz ? 60 : (detail >= 2 ? 58 : 40) });
  const N = new Map(L.nodes.map((n) => [n.id, n]));
  const r = Math.max(13, Math.min(21, (horiz ? L.step : L.lstep) * 0.26, (horiz ? L.lstep : L.step) * 0.3));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'nw-topo-svg', role: 'group', 'aria-label': T('Network map: {n} devices', { n: topo.nodes.length - 1 }) });
  const ge = svgEl('g', { class: 'nw-edges' }), gl = svgEl('g', { class: 'nw-elabels' }), gn = svgEl('g', { class: 'nw-nodes' });
  svg.append(ge, gl, gn);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const edges = topo.edges.map((e) => ({ ...e, a: N.has(e.a) ? e.a : null, b: N.has(e.b) ? e.b : N.has(`more:${e.a}`) ? `more:${e.a}` : null })).filter((e) => e.a && e.b);
  const seenMore = new Set();
  for (const e of edges) {
    if (String(e.b).startsWith('more:')) { if (seenMore.has(e.b)) continue; seenMore.add(e.b); }
    const a = N.get(e.a), c = N.get(e.b), st = e.status === 'standby' ? 'idle' : nwSt(c.type === 'more' ? c.status : e.status);
    let d;
    if (!e.tree && a.layer === c.layer) d = horiz ? `M${a.x},${a.y + r}L${c.x},${c.y - r}` : `M${a.x + r},${a.y}L${c.x - r},${c.y}`;
    else if (horiz) { const x1 = a.x + r, x2 = c.x - r, mx = (x1 + x2) / 2; d = `M${x1},${a.y}C${mx},${a.y} ${mx},${c.y} ${x2},${c.y}`; }
    else { const y1 = a.y + r + (a.type === 'more' ? 0 : detail >= 1 || a.type === 'internet' ? 33 : 20), y2 = c.y - r - 2, my = (y1 + y2) / 2; d = `M${a.x},${y1}C${a.x},${my} ${c.x},${my} ${c.x},${y2}`; }   // from under the parent's label
    const cls = `nw-e ${st}${e.inferred ? ' est' : ''}${!e.tree ? ' side' : ''}${['wan', 'cellular', 'wan2'].includes(e.kind) ? ' wan' : ''}`;
    ge.append(svgEl('path', { d, class: cls }));
    if (st === 'good' && !still && e.tree) ge.append(svgEl('path', { d, class: `nw-flow${['wan'].includes(e.kind) ? ' fast' : ''}` }));
    if (detail >= 2 && e.label && ['wan', 'cellular'].includes(e.kind) && !horiz) {
      const mx = (a.x + c.x) / 2, my = (a.y + r + 33 + c.y - r) / 2, tw = e.label.length * 6.2 + 12;
      gl.append(svgEl('g', { transform: `translate(${mx.toFixed(1)},${my.toFixed(1)})`, class: 'nw-elab' }, svgEl('rect', { x: -tw / 2, y: -9, width: tw, height: 18, rx: 9 }), svgEl('text', { x: 0, y: 4, 'text-anchor': 'middle' }, e.label)));
    }
  }
  const tip = chartTip(), chars = Math.max(5, Math.floor((horiz ? L.lstep - 6 : L.step - 4) / 6.4));
  const cut = (s, k) => { s = String(s ?? ''); return s.length > k ? `${s.slice(0, Math.max(1, k - 1))}…` : s; };
  for (const n of L.nodes) {
    const st = n.type === 'internet' ? nwSt(n.status) : nwSt(n.status), [ic] = NW_TYPE[n.type] || NW_TYPE.other;
    const g = svgEl('g', { class: `nw-n t-${n.type} ${st}`, transform: `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`, tabindex: 0, role: 'button',
      'aria-label': [n.type === 'more' ? T('{n} more: {names}', { n: n.folded.length, names: n.folded.join(', ') }) : n.name, T(NW_TYPE[n.type]?.[1] || 'Device'), nwStWord(n.status), n.clients ? T('{n} clients', { n: n.clients }) : null].filter(Boolean).join(', ') });
    const rr = n.type === 'internet' ? r + 3 : n.type === 'more' ? r - 3 : r;
    g.append(svgEl('circle', { r: rr + 5, class: 'nw-halo' }), svgEl('circle', { r: rr, class: 'nw-disc' }));
    if (n.type === 'more') g.append(svgEl('text', { y: 4, 'text-anchor': 'middle', class: 'nw-moretx' }, n.name));
    else g.append(svgEl('path', { d: ICONS[ic], transform: `translate(${-rr * 0.55},${-rr * 0.55}) scale(${(rr * 1.1 / 24).toFixed(3)})`, class: 'nw-ic' }));
    if (n.type !== 'internet' && n.type !== 'more') g.append(svgEl('circle', { cx: rr * 0.72, cy: -rr * 0.72, r: 4.2, class: 'nw-sdot' }));
    const name = n.type === 'internet' ? (data.provider || T('Internet')) : n.type === 'more' ? '' : n.name;
    if (name) g.append(svgEl('text', { y: rr + 15, 'text-anchor': 'middle', class: 'nw-l1' }, cut(name, chars)));
    const sub = n.type === 'internet' ? (data.latency != null ? atMs(data.latency) : '') : detail >= 1 && n.type !== 'more' ? (nwSt(n.status) === 'bad' ? nwStWord(n.status) : n.model || '') : '';
    if (sub && (detail >= 1 || n.type === 'internet')) g.append(svgEl('text', { y: rr + 28, 'text-anchor': 'middle', class: `nw-l2${nwSt(n.status) === 'bad' && n.type !== 'internet' ? ' bad' : ''}` }, cut(sub, chars + 2)));
    if (detail >= 1 && n.clients > 0 && ['wireless', 'switch', 'other', 'box'].includes(n.type)) {   // client count: a small pill at the node's foot
      const txt = String(n.clients), cw = txt.length * 7 + 22;
      g.append(svgEl('g', { class: 'nw-cl', transform: `translate(${(rr * 0.7).toFixed(1)},${(rr * 0.62).toFixed(1)})` }, svgEl('rect', { x: 0, y: -8, width: cw, height: 16, rx: 8 }),
        svgEl('path', { d: ICONS.nclients, transform: 'translate(3,-6) scale(0.5)', class: 'nw-clic' }), svgEl('text', { x: 16, y: 4 }, txt)));
    }
    const dev = n.type === 'more' || n.type === 'internet' || n.type === 'box' ? null : model?.devices?.find((d) => d.id === n.id);
    const show = (e) => tip.show(e, [el('b', {}, n.type === 'more' ? T('{n} more', { n: n.folded.length }) : name || n.name), el('div', {}, n.type === 'more' ? n.folded.join(', ') : [T(NW_TYPE[n.type]?.[1] || 'Device'), n.model, nwStWord(n.status)].filter(Boolean).join(' · ')),
      dev?.ip ? el('div', { class: 'muted' }, dev.ip) : null, n.clients ? el('div', { class: 'muted' }, T('{n} clients', { n: n.clients })) : null]);
    g.addEventListener('pointermove', show); g.addEventListener('pointerleave', () => tip.hide());
    const open = () => {
      tip.hide();
      if (dev) return nwDeviceSheet(dev, ctx);
      if (n.type === 'more') { const list = (n.ids || []).map((id) => model?.devices?.find((d) => d.id === id)).filter(Boolean); const mm = modal(el('div', { class: 'nw-devlist' }, list.map((d) => el('button', { type: 'button', class: 'nw-dev', onclick: () => { mm.remove(); nwDeviceSheet(d, ctx); } }, el('span', { class: `dot ${nwSt(d.status)}` }), icon(NW_TYPE[d.type]?.[0] || 'nbox', 15), el('span', { class: 'ellipsis' }, d.name), el('span', { class: 'tiny muted' }, nwStWord(d.status))))), { title: T('{n} more', { n: list.length }) }); }
    };
    g.addEventListener('click', open); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    gn.append(g);
  }
  box.replaceChildren(svg);
}
/* Without Meraki or UniFi: what any router gives - the internet, the router, this CasaTorch and the devices seen. */
function nwBasicTopo(n) {
  const nodes = [{ id: 'internet', type: 'internet', status: n.online === false ? 'offline' : 'online', layer: 0, parent: null, name: 'Internet' },
    { id: 'router', type: 'appliance', name: T('Your router'), model: n.gateway || null, status: n.latencyMs?.router != null || n.online !== false ? 'online' : 'unknown', layer: 1, parent: 'internet' },
    { id: 'box', type: 'box', name: 'CasaTorch', model: n.host || null, status: 'online', layer: 2, parent: 'router', clients: n.lanDevices || null }];
  return { nodes, edges: [{ a: 'internet', b: 'router', kind: 'wan', tree: true, status: nodes[0].status }, { a: 'router', b: 'box', kind: 'lan', tree: true, status: 'online' }], layers: 3, inferred: 0 };
}
pageTile({ id: 'net-topo', page: 'network', phoneFull: true, title: 'Network map', icon: 'grid', blurb: 'From the internet through your gateway and switches to every access point and its clients - live', size: [8, 6], min: [3, 3], max: [12, 10],
  presets: [['s', 'Small', [4, 3]], ['m', 'Medium', [6, 4]], ['l', 'Large', [8, 6]], ['xl', 'Extra large', [12, 7]]], render(b, ctx, size) {
    const ov = ctx.data?.ov || {}, m = ov.model, n = ctx.data?.inet || {};
    const topo = ov.topo || nwBasicTopo(n), tier = nwTier(size), detail = TIER_RANK[tier];
    const main = (m?.uplinks || []).find((u) => u.status === 'active');
    const data = { topo, model: m, detail, provider: n.provider || main?.provider || null, latency: main?.lat ?? n.latencyMs?.cloudflare ?? null };
    let box = b.querySelector('.nw-topo');
    if (!box) {
      box = el('div', { class: 'nw-topo' });
      let lw = 0, lh = 0; const ro = new ResizeObserver(() => { if (!box.isConnected) { if (lw) ro.disconnect(); return; } if (Math.abs(box.clientWidth - lw) > 3 || Math.abs(box.clientHeight - lh) > 3) { lw = box.clientWidth; lh = box.clientHeight; nwTopoDraw(box, box._d, ctx); } });
      ro.observe(box); box._ro = ro;
    }
    box._d = data;
    const devs = topo.nodes.filter((x) => !['internet', 'box'].includes(x.type)), off = devs.filter((x) => nwSt(x.status) === 'bad').length, warn = devs.filter((x) => nwSt(x.status) === 'warn').length;
    const legend = el('div', { class: 'nw-legend' },
      el('span', {}, el('i', { class: 'good' }), T('Online')), warn ? el('span', {}, el('i', { class: 'warn' }), T('{n} alerting', { n: warn })) : null, off ? el('span', {}, el('i', { class: 'bad' }), T('{n} offline', { n: off })) : null,
      topo.inferred && detail >= 1 ? el('span', { title: T('Not reported by your gear - worked out from the kind of device') }, el('i', { class: 'est' }), T('estimated link')) : null,
      el('span', { class: 'grow' }), m ? el('span', { class: 'tiny muted' }, T('{n} devices · {c} clients', { n: devs.length, c: nwN(m.clients?.total) })) : el('span', { class: 'tiny muted' }, ov.pro ? T('Connect Meraki or UniFi for the whole map') : T('The whole map comes with Meraki or UniFi (Pro)')));
    if (b.firstChild !== box) nwPut(b, box, legend); else b.replaceChild(legend, b.lastChild);
    if (box.clientWidth) nwTopoDraw(box, data, ctx);
  } });

/* One device: everything about it, in a sheet. */
function nwDeviceSheet(d, ctx) {
  const m = nwModel(ctx) || {}, [ic, kind] = NW_TYPE[d.type] || NW_TYPE.other;
  const dl = el('dl', { class: 'kv nw-kv' }), add = (k, v) => { if (v != null && v !== '') dl.append(el('dt', {}, k), el('dd', {}, v)); };
  add(T('Kind'), T(kind)); add(T('Model'), d.model); add(T('Address'), d.ip); add(T('Firmware'), d.fw); add(T('Clients'), d.clients != null ? nwN(d.clients) : null);
  const net = m.networks?.find((x) => x.id === d.net); add(T('Network'), net?.name);
  const ups = (m.uplinks || []).filter((u) => u.dev === d.id);
  const sw = (m.ports || []).find((p) => p.dev === d.id), ap = (m.wifi?.aps || []).find((x) => x.id === d.id), evs = (m.events || []).filter((e) => e.dev === d.id).slice(0, 6);
  const body = el('div', { class: 'nw-sheet' },
    el('div', { class: 'row', style: 'gap:12px;margin-bottom:6px' }, el('span', { class: `nw-sheet-ic ${nwSt(d.status)}` }, icon(ic, 22)), el('div', { class: 'grow', style: 'min-width:0' }, el('h2', { style: 'margin:0' }, d.name), el('div', { class: 'tiny muted' }, [T(kind), d.model].filter(Boolean).join(' · '))), nwPill(nwSt(d.status), nwStWord(d.status))),
    dl,
    ups.length ? el('section', {}, el('h3', {}, T('Uplinks')), el('div', { class: 'nw-ups' }, ups.map((u) => { const [c, w] = NW_UP_ST[u.status] || ['idle', u.status]; return el('div', { class: 'nw-up' }, el('span', { class: 'nw-up-ic' }, icon(u.iface === 'cellular' ? 'ncell' : 'globe', 16)), el('div', { class: 'grow' }, el('b', {}, T(NW_IFACE[u.iface] || u.iface)), el('div', { class: 'tiny muted' }, [u.provider, u.lat != null ? atMs(u.lat) : null, u.loss != null ? T('{n}% loss', { n: u.loss }) : null].filter(Boolean).join(' · '))), ctx.data?.ov?.canIp ? nwIp(u.publicIp) : null, nwPill(c, T(w))); }))) : null,
    sw?.ports?.length ? el('section', {}, el('h3', {}, T('Ports')), nwPortGrid(sw, false)) : null,
    ap?.radios?.length ? el('section', {}, el('h3', {}, T('Radios')), nwRadios(ap, true)) : null,
    evs.length ? el('section', {}, el('h3', {}, T('Recent events')), el('div', { class: 'nw-evs' }, evs.map(nwEventRow))) : null,
    el('p', { class: 'tiny muted' }, T('Read from {name}. CasaTorch only looks - it never changes your network.', { name: ctx.data?.ov?.source?.name || 'Meraki' })));
  modal(body, { wide: !!(sw?.ports?.length) });
}

/* ---- devices online, alerting, offline ---- */
function nwRing(parts, center, label) {
  const C = 2 * Math.PI * 30, svg = svgEl('svg', { viewBox: '0 0 80 80', class: 'nw-ring', role: 'img', 'aria-label': label }), sum = parts.reduce((s, [, n]) => s + (n || 0), 0), many = parts.filter(([, x]) => x).length > 1;
  svg.append(svgEl('circle', { cx: 40, cy: 40, r: 30, class: 'trk' }));
  let off = 0; for (const [cls, n] of parts) { if (!n || !sum) continue; const len = C * n / sum; svg.append(svgEl('circle', { cx: 40, cy: 40, r: 30, class: `seg ${cls}`, 'stroke-dasharray': `${Math.max(0.5, len - (many ? 2.5 : 0))} ${C}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 40 40)' })); off += len; }
  if (center != null && center !== '') svg.append(svgEl('text', { x: 40, y: 46, 'text-anchor': 'middle', class: 'nw-ring-n' }, String(center)));
  return svg;
}
pageTile({ id: 'net-devices', page: 'network', title: 'Devices', icon: 'nswitch', blurb: 'Every gateway, switch, access point, camera and sensor: online, alerting or offline', size: [4, 3], min: [2, 2], max: [12, 10], phoneFull: true, render(b, ctx, size) {
  const m = nwModel(ctx);
  if (!m) return nwNeed(b, ctx, T('Every access point, switch and gateway online or offline, with Meraki or UniFi.'));
  const devs = m.devices, c = (s) => devs.filter((d) => d.status === s).length, on = c('online'), al = c('alerting'), off = c('offline'), idle = devs.length - on - al - off;
  const head = el('div', { class: 'nw-devhead' }, nwRing([['good', on], ['warn', al], ['bad', off], ['idle', idle]], devs.length, T('{n} devices', { n: devs.length })),
    el('div', { class: 'nw-devcounts' }, el('div', {}, el('i', { class: 'dot good' }), el('b', {}, on), ' ', T('online')), al ? el('div', {}, el('i', { class: 'dot warn' }), el('b', {}, al), ' ', T('alerting')) : null, el('div', {}, el('i', { class: `dot ${off ? 'bad' : 'idle'}` }), el('b', {}, off), ' ', T('offline')), idle ? el('div', {}, el('i', { class: 'dot idle' }), el('b', {}, idle), ' ', T('dormant')) : null));
  const types = nwAt(size, 'm') ? el('div', { class: 'nw-chips' }, NW_TYPES_PL.map(([k, l]) => { const n = devs.filter((d) => d.type === k).length; return n ? el('span', { class: 'chip-stat' }, icon(NW_TYPE[k][0], 13), `${T(l)} ${n}`) : null; })) : null;
  const order = devs.slice().sort((a, x) => NW_SEV[nwSt(x.status)] - NW_SEV[nwSt(a.status)] || String(a.name).localeCompare(String(x.name)));
  const rows = Math.max(0, Math.floor((size.h * 78 + (size.h - 1) * 14 - (types ? 200 : 160)) / 34));
  const wide = nwAt(size, 'xl') && size.w >= 8;
  const list = nwAt(size, 'l') || (size.h >= 4) ? el('div', { class: `nw-devlist${wide ? ' wide' : ''}` }, order.slice(0, Math.max(3, rows)).map((d) => el('button', { type: 'button', class: 'nw-dev', onclick: () => nwDeviceSheet(d, ctx) },
    el('span', { class: `dot ${nwSt(d.status)}` }), icon(NW_TYPE[d.type]?.[0] || 'nbox', 15), el('span', { class: 'ellipsis grow' }, d.name), wide ? el('span', { class: 'tiny muted ellipsis' }, d.model || '') : null, wide ? el('span', { class: 'tiny muted ellipsis' }, d.ip || '') : null,
    wide ? el('span', { class: 'tiny muted ellipsis' }, d.fw || '') : null, el('span', { class: `tiny ${nwSt(d.status) === 'bad' ? 'bad' : 'muted'}` }, nwSt(d.status) === 'good' ? (d.clients ? T('{n} clients', { n: d.clients }) : nwStWord(d.status)) : nwStWord(d.status))))) : null;
  nwPut(b, head, types, list);
} });

/* ---- Wi-Fi: clients by band, network name and access point; how busy each channel is ---- */
const NW_BANDS = { 2.4: '2.4 GHz', 5: '5 GHz', 6: '6 GHz' };
const nwUtilCls = (u) => (u == null ? '' : u >= 70 ? 'bad' : u >= 45 ? 'warn' : 'good');
function nwRadios(ap, full) {
  return el('div', { class: 'nw-radios' }, (ap.radios || []).map((r) => el('div', { class: 'nw-radio', title: [NW_BANDS[r.band] || `${r.band} GHz`, r.ch ? T('channel {n}', { n: r.ch }) : null, r.width ? `${r.width} MHz` : null, r.util != null ? T('{n}% busy', { n: r.util }) : null].filter(Boolean).join(' · ') },
    el('span', { class: `nw-band b${String(r.band).replace('.', '')}` }, String(r.band)), el('span', { class: 'tiny muted nw-ch' }, r.ch ? `ch ${r.ch}${full && r.width ? ` · ${r.width} MHz` : ''}` : '-'),
    el('span', { class: 'en-track grow' }, r.util != null ? el('i', { class: nwUtilCls(r.util), style: `width:${Math.max(2, r.util)}%` }) : null), el('span', { class: 'tiny num nw-util' }, r.util != null ? `${r.util}%` : r.retries != null ? T('{n}% retries', { n: r.retries }) : ''))));
}
pageTile({ id: 'net-wifi', page: 'network', title: 'Wi-Fi', icon: 'wifi', blurb: 'Clients by band and network name, each access point, and how busy its channels are', size: [4, 3], min: [2, 2], max: [12, 10], phoneFull: true, render(b, ctx, size) {
  const m = nwModel(ctx);
  if (!m) return nwNeed(b, ctx, T('Wi-Fi clients by band and network name, and how busy each channel is, with Meraki or UniFi.'));
  const c = m.clients || {}, bands = (c.byBand || []).filter(([, n]) => n), tot = bands.reduce((s, [, n]) => s + n, 0) || 0;
  const head = el('div', { class: 'row between', style: 'align-items:flex-end;gap:10px' }, nwStat(T('On Wi-Fi now'), nwN(c.wireless), c.total != null ? T('{n} clients in all', { n: nwN(c.total) }) : null),
    bands.length ? el('div', { class: 'nw-bandkeys' }, bands.map(([k, n]) => el('span', {}, el('i', { class: `nw-band b${k.replace('.', '')}` }, k), el('b', {}, n)))) : null);
  const bar = tot ? el('div', { class: 'nw-stack', role: 'img', 'aria-label': bands.map(([k, n]) => `${NW_BANDS[k] || k}: ${n}`).join(', ') }, bands.map(([k, n]) => el('i', { class: `b${k.replace('.', '')}`, style: `flex-grow:${n}` }))) : null;
  const ssids = nwAt(size, 'm') && (c.bySsid || []).length ? el('div', { class: 'nw-ssids' }, c.bySsid.slice(0, nwAt(size, 'l') ? 6 : 3).map(([name, n]) => el('div', { class: 'nw-ssid' }, icon('wifi', 13), el('span', { class: 'ellipsis grow' }, name), el('b', { class: 'num' }, n)))) : null;
  const room = Math.floor((size.h * 78 + (size.h - 1) * 14 - 180 - (ssids ? 30 * Math.min(3, c.bySsid.length) : 0)) / 56);
  const aps = (nwAt(size, 'l') || size.h >= 4) && m.wifi?.aps?.length ? el('div', { class: 'nw-aps' }, m.wifi.aps.slice().sort((a, x) => NW_SEV[nwSt(x.status)] - NW_SEV[nwSt(a.status)] || (x.clients || 0) - (a.clients || 0)).slice(0, Math.max(2, room)).map((ap) => el('button', { type: 'button', class: 'nw-ap', onclick: () => { const d = nwDev(ctx, ap.id); if (d) nwDeviceSheet(d, ctx); } },
    el('div', { class: 'row', style: 'gap:8px' }, el('span', { class: `dot ${nwSt(ap.status)}` }), el('b', { class: 'ellipsis grow' }, ap.name), el('span', { class: 'tiny muted' }, nwSt(ap.status) === 'bad' ? nwStWord(ap.status) : T('{n} clients', { n: ap.clients ?? 0 }))),
    ap.radios?.length ? nwRadios(ap, nwAt(size, 'xl')) : null))) : null;
  nwPut(b, head, bar, ssids, aps);
} });

/* ---- switch ports ---- */
function nwPortGrid(sw, compact) {
  const tip = chartTip();
  return el('div', { class: `nw-ports${compact ? ' compact' : ''}`, role: 'list', 'aria-label': T('{name}: {up} of {n} ports up', { name: sw.name, up: sw.ports.filter((p) => p.up).length, n: sw.ports.length }) }, sw.ports.map((p) => {
    const cls = !p.enabled ? 'off' : p.errors?.length ? 'err' : p.warnings?.length && !p.up ? 'warnp' : p.up ? 'up' : 'down';
    const info = [el('b', {}, T('Port {n}', { n: p.id })), el('div', {}, !p.enabled ? T('Turned off') : p.up ? [p.speed, p.duplex].filter(Boolean).join(' ') || T('Connected') : T('Nothing connected')),
      p.peer ? el('div', {}, p.peer) : null, p.poe ? el('div', { class: 'muted' }, p.watts != null ? T('PoE {w} W', { w: p.watts }) : 'PoE') : null, p.uplink ? el('div', { class: 'muted' }, T('Uplink')) : null,
      ...(p.errors || []).map((x) => el('div', { style: 'color:var(--bad)' }, x)), ...(p.warnings || []).map((x) => el('div', { style: 'color:var(--warn)' }, x))];
    const c = el('span', { class: `nw-port ${cls}${p.uplink ? ' upl' : ''}`, role: 'listitem', tabindex: 0, 'aria-label': info.map((x) => x?.textContent).filter(Boolean).join(', ') }, compact ? null : el('span', { class: 'nw-pn' }, p.id), p.poe ? el('i', { class: 'nw-poe' }) : null);
    c.addEventListener('pointermove', (e) => tip.show(e, info)); c.addEventListener('pointerleave', () => tip.hide());
    return c;
  }));
}
pageTile({ id: 'net-ports', page: 'network', title: 'Switch ports', icon: 'nswitch', blurb: 'Every port on every switch: connected, speed, PoE, errors', size: [4, 4], min: [2, 2], max: [12, 10], phoneFull: true, render(b, ctx, size) {
  const m = nwModel(ctx), sws = (m?.ports || []).filter((s) => s.ports.length);
  if (!m) return nwNeed(b, ctx, T('Every switch port - connected, speed, PoE and errors - with Meraki or UniFi.'));
  if (!sws.length) return nwPut(b, pgEmpty(T('No switches with ports to show.'), null));
  const all = sws.flatMap((s) => s.ports), up = all.filter((p) => p.up).length, err = all.filter((p) => p.errors?.length).length, poe = all.filter((p) => p.poe).reduce((s, p) => s + (p.watts || 0), 0);
  const head = el('div', { class: 'nw-kpirow' }, nwStat(T('Connected'), `${up}/${all.length}`, null, 'sm'), poe ? nwStat('PoE', `${Math.round(poe)} W`, null, 'sm') : null, nwStat(T('Errors'), String(err), null, `sm${err ? ' warn' : ''}`));
  if (!nwAt(size, 'm') && size.h < 3) return nwPut(b, head);
  nwPut(b, head, el('div', { class: 'nw-swlist' }, sws.map((s) => el('div', { class: 'nw-sw' }, el('button', { type: 'button', class: 'nw-swh', onclick: () => { const d = nwDev(ctx, s.dev); if (d) nwDeviceSheet(d, ctx); } }, el('span', { class: `dot ${nwSt(s.status)}` }), el('b', { class: 'ellipsis grow' }, s.name), el('span', { class: 'tiny muted' }, s.model || '')),
    nwPortGrid(s, !nwAt(size, 'l') && size.w < 6)))),
  nwAt(size, 'l') ? el('div', { class: 'nw-legend tiny' }, el('span', {}, el('i', { class: 'good sq' }), T('connected')), el('span', {}, el('i', { class: 'idle sq' }), T('empty')), el('span', {}, el('i', { class: 'bad sq' }), T('errors')), el('span', {}, el('i', { class: 'poe' }), 'PoE')) : null);
} });

/* ---- the top users ---- */
pageTile({ id: 'net-clients', page: 'network', title: 'Top clients', icon: 'nclients', blurb: 'Who uses the most data today, wired or on which Wi-Fi', size: [4, 4], min: [2, 2], max: [12, 10], phoneFull: true, render(b, ctx, size) {
  const m = nwModel(ctx), c = m?.clients;
  if (!m) return nwNeed(b, ctx, T('Which devices use the most data, with Meraki.'));
  const head = el('div', { class: 'nw-kpirow' }, nwStat(T('Online'), nwN(c?.total), null, 'sm'), nwStat(T('Wired'), nwN(c?.wired), null, 'sm'), nwStat('Wi-Fi', nwN(c?.wireless), null, 'sm'));
  const top = (c?.top || []).filter((x) => x.kb > 0);
  if (!top.length) return nwPut(b, head, el('div', { class: 'tiny muted', style: 'margin-top:10px' }, m.kind === 'unifi' ? T('UniFi doesn\'t share how much each device uses yet.') : T('No usage in the last 24 hours.')));
  if (!nwAt(size, 'm') && size.h < 3) return nwPut(b, head);
  const rows = Math.max(2, Math.floor((size.h * 78 + (size.h - 1) * 14 - 130) / 48)), max = top[0].kb;
  nwPut(b, head, el('div', { class: 'en-rank nw-top' }, top.slice(0, rows).map((x, i) => el('div', { class: 'en-rk' }, el('span', { class: 'en-rk-n' }, i + 1),
    el('div', { class: 'en-rk-m' }, el('div', { class: 'row between', style: 'gap:8px' }, el('span', { class: 'ellipsis' }, x.name), el('span', { class: 'num en-rk-w' }, nwGB(x.kb))),
      el('div', { class: 'en-track nw-dual' }, el('i', { style: `width:${Math.max(1.5, (x.down ?? x.kb) / max * 100)}%` }), x.up ? el('i', { class: 'upl', style: `width:${Math.max(0.5, x.up / max * 100)}%` }) : null),
      nwAt(size, 'l') ? el('div', { class: 'tiny muted ellipsis' }, [x.wired ? T('Wired') : x.ssid, nwDev(ctx, x.dev)?.name, x.os].filter(Boolean).join(' · ')) : null)))),
  nwAt(size, 'l') ? el('div', { class: 'en-legend' }, el('span', {}, el('i', { class: 'sw en-grid-bg' }), T('download')), el('span', {}, el('i', { class: 'sw nw-upbg' }), T('upload')), el('span', { class: 'muted' }, T('last 24 hours'))) : null);
} });

/* ---- App and network tests ---- */
pageTile({ id: 'net-apptests', page: 'network', phoneFull: true, title: 'App and network tests', icon: 'gauge', blurb: 'How fast your apps answer from home, pings, ports and name lookups - with the path there', size: [8, 4], min: [3, 2], max: [12, 12], render(b, ctx, size) {
  const a = ctx.data?.at;
  if (!a) return nwPut(b, pgEmpty(T('App tests aren\'t available right now.'), null));
  a.demo = !!S.status?.demo;
  const redraw = () => ctx.refresh?.();
  if (!a.tests.length) {
    const card = appTestsCard(a, redraw); card.classList.remove('card'); card.style.marginTop = '0'; card.querySelector('h2')?.closest('.row')?.remove();
    return nwPut(b, card);
  }
  const bad = a.tests.filter((t) => t.down).length, slow = a.tests.filter((t) => !t.down && (t.slow || t.failing)).length, ok = a.tests.length - bad - slow;
  const head = el('div', { class: 'row between wrap', style: 'gap:8px;margin-bottom:10px' }, el('div', { class: 'nw-chips' }, el('span', { class: 'chip-stat' }, el('i', { class: 'good' }), T('{n} OK', { n: ok })), slow ? el('span', { class: 'chip-stat' }, el('i', { class: 'warn' }), T('{n} slow', { n: slow })) : null, bad ? el('span', { class: 'chip-stat' }, el('i', { class: 'bad' }), T('{n} down', { n: bad })) : null),
    !a.demo && nwAdmin() ? el('button', { class: 'btn small', onclick: () => atAddAny(a, redraw, ctx.data) }, icon('plus', 14), T('Add a test')) : null);
  if (nwAt(size, 'l') && size.w >= 6) {
    const grid = el('div', { class: 'atgrid nw-atgrid' }, a.tests.slice().sort((x, y) => (y.down - x.down) || ((y.slow || 0) - (x.slow || 0))).map((t) => atTile(t, (id) => atOpen(id, a, redraw))));
    return nwPut(b, head, grid, nwAt(size, 'xl') && a.overview && size.h >= 7 ? pvOverview(a, (id) => atOpen(id, a, redraw)) : null);
  }
  const rows = Math.max(1, Math.floor((size.h * 78 + (size.h - 1) * 14 - 110) / 44));
  nwPut(b, head, el('div', { class: 'nw-tests' }, a.tests.slice().sort((x, y) => (y.down - x.down) || ((y.slow || 0) - (x.slow || 0))).slice(0, rows).map((t) => { const [dot, word] = atState(t);
    return el('button', { type: 'button', class: 'nw-test', onclick: () => atOpen(t.id, a, redraw) }, el('span', { class: 'atbadge sm', 'aria-hidden': 'true' }, t.kind === 'router' ? icon('wifi', 13) : t.short || '•'), el('span', { class: 'ellipsis grow' }, atName(t)),
      size.w >= 4 ? atSpark(t.spark || []) : null, el('b', { class: 'num' }, t.last?.ok ? atMs(t.last.total) : word), el('span', { class: `dot ${dot}`, title: word })); })));
} });

/* ---- DNS filter: Pi-hole, AdGuard Home ---- */
pageTile({ id: 'net-dns', page: 'network', title: 'DNS filter', icon: 'shield', blurb: 'Pi-hole or AdGuard Home: look-ups, how much is blocked, and whether blocking is on', size: [4, 2], min: [2, 2], max: [8, 6], render(b, ctx, size) {
  const nw = ctx.data?.nw || {}, list = (nw.sources || []).filter((x) => x.kind === 'pihole' || x.kind === 'adguard');
  if (!list.length) return nwPut(b, nw.pro ? el('div', { class: 'pg-empty-state' }, el('div', { class: 'small muted' }, T('Connect Pi-hole or AdGuard Home to see how much it blocks.')), nwAdmin() ? el('button', { class: 'btn small', onclick: () => netConnect(nw, () => ctx.refresh?.(), 'pihole') }, icon('plus', 14), T('Connect')) : null)
    : el('div', { class: 'en-lock' }, el('span', { class: 'pill pro' }, 'Pro'), el('div', { class: 'small muted' }, T('Pi-hole or AdGuard Home: look-ups and how much is blocked.')), el('a', { class: 'btn small', href: '#settings/pro' }, T('Unlock with Pro'))));
  nwPut(b, list.slice(0, size.h >= 4 ? 3 : 1).map((x) => { const s = x.summary || {}, pct = s.percentBlocked;
    return el('div', { class: 'nw-dns' }, size.w < 3 ? null : nwRing([['accent', s.blocked || 0], ['idle', Math.max(0, (s.queries || 0) - (s.blocked || 0))]], '', T('{n}% blocked', { n: pct ?? 0 })),
      el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'row wrap', style: 'gap:4px 8px' }, el('b', { class: 'ellipsis' }, x.name), x.ok === false ? nwPill('bad', T('Can\'t reach')) : s.protection === false ? nwPill('warn', T('Blocking off')) : nwPill('good', T('Blocking on'))),
        el('div', { class: 'en-val sm' }, pct != null ? `${pct}%` : '-', el('span', { class: 'tiny muted', style: 'font-weight:400' }, ` ${T('blocked')}`)),
        el('div', { class: 'tiny muted' }, [T('{n} look-ups', { n: nwN(s.queries) }), s.clients != null ? T('{n} clients', { n: nwN(s.clients) }) : null].filter(Boolean).join(' · ')))); }));
} });

/* ---- new and unknown devices (Security Center) ---- */
pageTile({ id: 'net-security', page: 'network', title: 'New devices', icon: 'shield', blurb: 'Devices on your network you haven\'t marked as known, from the Security Center', size: [4, 2], min: [2, 2], max: [12, 8], phoneFull: true, render(b, ctx, size) {
  const s = ctx.data?.sec;
  if (!s) return nwPut(b, pgEmpty(T('The Security Center isn\'t available right now.'), null));
  if (!s.available) return nwPut(b, pgEmpty(T('Seeing who is on your network needs CasaTorch on a computer at home (a Box, Raspberry Pi, Linux or Docker).'), '#security', T('Security Center')));
  const unk = (s.devices || []).filter((d) => !d.known), name = (d) => d.name || d.who?.names?.[0]?.name || (d.who?.maker ? T('{maker} device', { maker: d.who.maker.short || d.who.maker.name }) : d.privateMac ? T('Phone or laptop (private address)') : T('Unknown device'));
  const head = el('div', { class: 'row between', style: 'gap:10px;align-items:flex-start' }, nwStat(unk.length ? T('Not known yet') : T('All known'), String(unk.length), T('{n} devices on your network', { n: (s.devices || []).length }), unk.length ? 'warn' : 'good'), el('a', { class: 'btn small', href: '#security' }, T('Review')));
  const rows = Math.max(0, Math.floor((size.h * 78 + (size.h - 1) * 14 - 120) / 40));
  nwPut(b, head, rows && unk.length ? el('div', { class: 'nw-unk' }, unk.slice(0, rows).map((d) => el('a', { class: 'nw-unkr', href: '#security' }, el('span', { class: 'dot warn' }), el('span', { class: 'ellipsis grow' }, name(d)), el('span', { class: 'tiny muted' }, [d.ip, d.firstSeen ? ago(d.firstSeen) : null].filter(Boolean).join(' · '))))) : null);
} });

/* ---- events ---- */
const nwEvSev = (e) => (/offline|down|stopped|fail|error|lost|crc|unreachable/i.test(e.text) ? 'bad' : /latency|slow|scheduled|warning|roam|restart|rose/i.test(e.text) ? 'warn' : 'good');
const NW_EV_IC = { wireless: 'nap', switch: 'nswitch', appliance: 'nrouter', cellularGateway: 'ncell', camera: 'camera' };
function nwEventRow(e) {
  return el('div', { class: `nw-ev ${nwEvSev(e)}` }, el('span', { class: 'nw-ev-ic' }, icon(NW_EV_IC[e.cat] || 'list', 14)),
    el('div', { class: 'grow', style: 'min-width:0' }, el('div', { class: 'nw-ev-t' }, e.text), el('div', { class: 'tiny muted ellipsis' }, [ago(e.at), e.devName, e.client].filter(Boolean).join(' · '))));
}
pageTile({ id: 'net-events', page: 'network', title: 'Events', icon: 'list', blurb: 'What happened on your network: devices going offline, ports, uplinks, new clients', size: [4, 6], min: [2, 2], max: [12, 12], phoneFull: true, render(b, ctx, size) {
  const m = nwModel(ctx);
  if (!m) return nwNeed(b, ctx, T('What happens on your network, as it happens, with Meraki.'));
  b._f ||= 'all';
  const all = m.events || [], list = b._f === 'bad' ? all.filter((e) => nwEvSev(e) !== 'good') : all;
  if (!all.length) return nwPut(b, pgEmpty(m.kind === 'unifi' ? T('UniFi doesn\'t share events yet. Devices going offline still raise alerts.') : T('Nothing happened lately.'), null));
  const seg = nwAt(size, 'm') ? el('div', { class: 'seg seg-mini', style: 'align-self:flex-start;margin-bottom:8px' }, [['all', T('All')], ['bad', T('Problems')]].map(([k, l]) => el('button', { class: b._f === k ? 'on' : '', onclick: () => { b._f = k; this.render(b, ctx, size); } }, l))) : null;
  const rows = Math.max(2, Math.floor((size.h * 78 + (size.h - 1) * 14 - (seg ? 90 : 50)) / 50));
  nwPut(b, seg, el('div', { class: 'nw-evs' }, list.slice(0, rows).map(nwEventRow)), list.length > rows ? el('div', { class: 'en-foot' }, T('{n} more - make this tile taller to see them', { n: list.length - rows })) : null);
} });

/* ---- firmware and license ---- */
const NW_PROD = { appliance: 'Gateways', switch: 'Switches', wireless: 'Access points', camera: 'Cameras', sensor: 'Sensors', cellular: 'Cellular', other: 'Other' };
pageTile({ id: 'net-health', page: 'network', title: 'Firmware and license', icon: 'checkc', blurb: 'Is everything up to date, upgrades coming, and when the license ends', size: [6, 3], min: [2, 2], max: [12, 8], render(b, ctx, size) {
  const m = nwModel(ctx);
  if (!m) return nwNeed(b, ctx, T('Firmware and license status, with Meraki or UniFi.'));
  const fw = m.firmware || [], lic = m.license, days = lic?.expires ? Math.round((Date.parse(lic.expires) - Date.now()) / 86400_000) : null;
  const licBox = lic ? el('div', { class: 'nw-lic' }, nwStat(T('License'), days != null ? (days < 0 ? T('Expired') : T('{n} days left', { n: days })) : lic.status || '-', days != null ? T('until {date}', { date: fmt(lic.expires, { year: 'numeric', month: 'short', day: 'numeric' }) }) : null, `sm${days != null && days <= 30 ? ' warn' : ''}`),
    days != null ? el('div', { class: `en-meter${days <= 30 ? ' warnm' : ''}` }, el('i', { style: `width:${Math.max(2, Math.min(100, days / 365 * 100))}%` })) : null) : null;
  const pending = fw.filter((f) => f.next || f.update);
  const head = el('div', { class: 'nw-kpirow' }, nwStat(T('Firmware'), pending.length ? T('{n} to update', { n: pending.length }) : T('Up to date'), null, `sm${pending.length ? ' warn' : ' good'}`), licBox);
  if (!nwAt(size, 'm') && size.h < 3) return nwPut(b, head);
  nwPut(b, head, fw.length ? el('div', { class: 'nw-fw' }, fw.slice(0, Math.max(2, size.h * 2 - 2)).map((f) => el('div', { class: 'nw-fwr' }, icon(NW_TYPE[f.product]?.[0] || 'nbox', 15), el('span', { class: 'grow ellipsis' }, f.dev || T(NW_PROD[f.product] || 'Other')), el('span', { class: 'tiny muted' }, f.current || ''),
    f.next ? nwPill('warn', f.at ? T('{v} on {when}', { v: f.next, when: fmtWhen(f.at) }) : f.next) : f.update ? nwPill('warn', T('Update ready')) : nwPill('good', T('Up to date'))))) : null);
} });

/* ---- connected gear and servers (the cards that used to be the whole page) ---- */
pageTile({ id: 'net-sources', page: 'network', phoneFull: true, title: 'Connected gear', icon: 'plug', blurb: 'Meraki, UniFi, Pi-hole and AdGuard Home: connect, check and disconnect', size: [6, 3], min: [3, 2], max: [12, 10], render(b, ctx) {
  const card = networkCard(ctx.data?.nw || { pro: false, sources: [], kinds: {} }, () => ctx.refresh?.()); card.classList.remove('card'); card.classList.add('nw-card'); card.style.marginTop = '0';
  card.querySelector('h2')?.remove(); nwPut(b, card);
} });
pageTile({ id: 'net-servers', page: 'network', phoneFull: true, title: 'Servers and apps', icon: 'nbox', blurb: 'Your NAS, media server or any self-hosted app: up or down, how fast, certificates', size: [6, 3], min: [3, 2], max: [12, 10], render(b, ctx) {
  const card = serversCard(ctx.data?.mo || { pro: false, monitors: [], max: 30 }, () => ctx.refresh?.()); card.classList.remove('card'); card.classList.add('nw-card'); card.style.marginTop = '0';
  card.querySelector('h2')?.remove(); nwPut(b, card);
} });
pageTile({ id: 'net-start', page: 'network', phoneFull: true, title: 'Get the most from Network', icon: 'spark', blurb: 'What to connect for more on this page', size: [12, 3], min: [4, 2], max: [12, 8], render(b, ctx) {
  const d = ctx.data || {}, nw = d.nw || {}, rich = (nw.sources || []).some((x) => ['meraki', 'unifi'].includes(x.kind)), dns = (nw.sources || []).some((x) => ['pihole', 'adguard'].includes(x.kind)), tests = d.at?.tests?.length || 0;
  const step = (done, title, text, btn) => el('div', { class: `en-step${done ? ' done' : ''}` }, el('span', { class: 'en-step-ic' }, icon(done ? 'check' : 'plus', 16)), el('div', { class: 'grow' }, el('b', {}, title), el('div', { class: 'tiny muted' }, text)), !done ? btn : null);
  const admin = nwAdmin();
  nwPut(b, el('div', { class: 'en-steps nw-steps' },
    step(rich, T('Cisco Meraki or UniFi'), rich ? T('Connected') : T('With just an API key: the network map, every device, Wi-Fi, switch ports, top clients and events (Pro).'), admin ? el('button', { class: 'btn small', onclick: () => (nw.pro ? netConnect(nw, () => ctx.refresh?.(), 'meraki') : (location.hash = '#settings/pro')) }, nw.pro ? T('Connect') : T('Unlock with Pro')) : null),
    step(tests > 0, T('App and network tests'), tests ? T('{n} tests running', { n: tests }) : T('Your work and streaming apps, your router, a ping to the NAS - tested every few minutes.'), admin && d.at ? el('button', { class: 'btn small', onclick: () => atAddAny(d.at, () => ctx.refresh?.(), d) }, T('Add a test')) : null),
    step(dns, T('Pi-hole or AdGuard Home'), T('How much your DNS filter blocks, and an alert if blocking is switched off (Pro).'), admin && nw.pro ? el('button', { class: 'btn small', onclick: () => netConnect(nw, () => ctx.refresh?.(), 'pihole') }, T('Connect')) : null),
    el('a', { class: 'tiny', href: 'https://casatorch.com/docs/connect/network.html', target: '_blank', rel: 'noopener' }, T('Learn more about the Network page'))));
} });

/* ---- the cards: Network devices (connect gear) and Servers and apps ---- */
/* Server monitor (Pro): a row per server or app, with the last hour as a strip of ticks. */
function monAdd(redraw) {
  const name = el('input', { placeholder: T('NAS, Plex, Backup server...'), maxlength: 40 });
  const target = el('input', { placeholder: 'http://nas.local:5000  or  192.168.1.20:22' });   // scrub-ok: example
  const msg = el('p', { class: 'small', style: 'min-height:1.2em' });
  const save = el('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true; msg.textContent = T('Checking it...');
    try { const r = await post('/api/monitors', { name: name.value, target: target.value }); m.remove(); toast(r.monitor.up ? T('{name} is up', { name: r.monitor.name }) : T('{name} added - it isn\'t answering yet', { name: r.monitor.name })); redraw(); }
    catch (e) { msg.textContent = e.message; msg.style.color = 'var(--bad)'; save.disabled = false; }
  } }, T('Add'));
  const m = modal(el('div', {}, el('label', { class: 'field' }, el('span', {}, T('Name')), name), el('label', { class: 'field' }, el('span', {}, T('Web address, or host and port')), target),
    el('p', { class: 'small muted' }, T('A web address is up when it answers. A host and port is up when it accepts a connection (for example 22 for SSH, 445 for file sharing). Checked every minute from this CasaTorch.')), msg, el('div', { class: 'row', style: 'justify-content:flex-end' }, save)), { title: T('Watch a server or app') });
  setTimeout(() => name.focus(), 30);
}
function serversCard(mo, redraw) {
  const card = el('div', { class: 'card servers', style: 'margin-top:14px' });
  const head = el('h2', { style: 'margin:0' }, T('Servers and apps'), el('span', { class: 'pill pro' }, 'Pro'));
  if (!mo.pro) {
    card.append(head, proPanel(T('Watch your NAS, servers and self-hosted apps: up or down, how fast they answer, and certificates about to expire - with a phone alert when something stops responding.')));
    return card;
  }
  const add = el('button', { class: 'btn small', onclick: () => monAdd(redraw) }, icon('plus'), T('Add'));
  const rows = mo.monitors.map((x) => {
    const dot = x.down ? 'bad' : x.up ? 'good' : 'warn';
    const strip = el('div', { class: 'tickstrip', 'aria-hidden': 'true' }, (x.recent || []).map((v) => el('i', { class: v < 0 ? 'down' : '' })));
    const del = el('button', { class: 'btn ghost small', 'aria-label': T('Stop watching {name}', { name: x.name }), onclick: async () => { try { await api(`/api/monitors/${encodeURIComponent(x.id)}`, { method: 'DELETE' }); redraw(); } catch (e) { toast(e.message); } } }, icon('x'));
    return el('div', { class: 'srv' },
      el('span', { class: `dot ${dot}` }),
      el('div', { class: 'grow' }, el('div', { class: 'row wrap', style: 'gap:8px' }, el('b', {}, x.name), x.cert && x.cert.days <= 14 ? el('span', { class: 'pill warn' }, x.cert.days < 0 ? T('certificate expired') : T('certificate: {days} d', { days: x.cert.days })) : null),
        el('div', { class: 'tiny muted ellipsis' }, x.target)),
      strip,
      el('div', { class: 'srv-num' }, el('b', {}, x.down ? T('Down') : x.ms != null ? `${x.ms} ms` : '-'), el('span', { class: 'tiny muted' }, x.down ? T(x.error || '') : x.uptime24h != null ? T('{uptime24h}% up', { uptime24h: x.uptime24h }) : T('checking'))),
      mo.demo ? null : del);
  });
  card.append(el('div', { class: 'row between', style: 'margin-bottom:10px' }, head, mo.monitors.length < mo.max && !mo.demo ? add : null),
    rows.length ? el('div', { class: 'srvs' }, rows) : el('p', { class: 'muted' }, T('Nothing watched yet. Add your NAS, a media server, Home Assistant or any self-hosted app.')));
  return card;
}
/* Network monitoring (Pro): Pi-hole, AdGuard Home, UniFi, Meraki. */
const NET_HELP = {
  pihole: ['Address', 'http://192.168.1.5', 'Password', 'Pi-hole 6: your web password, or an app password from Settings › Web interface / API. Pi-hole 5: the API token from Settings › API.'],
  adguard: ['Address', 'http://192.168.1.5:3000', 'Password', 'The user name and password you sign in to AdGuard Home with.'],
  unifi: ['Address of your UniFi console', 'https://192.168.1.1', 'API key', 'In UniFi Network: Settings › Control Plane › Integrations › Create API key. Needs UniFi Network 9 or newer on a console (Dream Machine, Cloud Key, UniFi OS Server).'],
  meraki: [null, null, 'API key', 'In the Meraki dashboard: your name (top right) › My profile › API access › Generate new API key. A read-only admin account is enough.'],
};
const fmtN = (v) => (v == null ? '-' : new Intl.NumberFormat('en-US').format(v));
function netSummary(x) {
  const s = x.summary || {};
  if (x.kind === 'pihole' || x.kind === 'adguard') return [T('{n} queries', { n: fmtN(s.queries) }), s.percentBlocked != null ? T('{n}% blocked', { n: s.percentBlocked }) : null, s.clients != null ? T('{n} clients', { n: fmtN(s.clients) }) : null, s.protection === false ? T('blocking is OFF') : s.protection ? T('blocking on') : null].filter(Boolean).join(' · ');
  return [T(s.devices === 1 ? '{n} device' : '{n} devices', { n: fmtN(s.devices) }), s.offline ? T('{n} offline', { n: s.offline }) : T('all online'), s.alerting ? T('{n} alerting', { n: s.alerting }) : null, s.clients != null ? T('{n} clients', { n: fmtN(s.clients) }) : null, s.site || s.org ? `(${s.site || s.org})` : null].filter(Boolean).join(' · ');
}
/* Connect Meraki, UniFi, Pi-hole or AdGuard Home: the key or password goes straight to this CasaTorch and is sealed there. */
function netConnect(nw, redraw, first) {
  const kinds = nw?.kinds && Object.keys(nw.kinds).length ? nw.kinds : { meraki: 'Cisco Meraki', unifi: 'UniFi', pihole: 'Pi-hole', adguard: 'AdGuard Home' };
  const kind = el('select', {}, Object.entries(kinds).map(([v, l]) => el('option', { value: v, selected: v === first ? true : null }, l)));
  const url = el('input', { type: 'url', autocomplete: 'off' }), user = el('input', { autocomplete: 'off', value: 'admin' }), secret = el('input', { type: 'password', autocomplete: 'new-password' });
  const region = el('select', {}, [['us', 'United States and most countries'], ['ca', 'Canada'], ['in', 'India'], ['cn', 'China']].map(([v, l]) => el('option', { value: v }, T(l))));
  const urlF = el('label', { class: 'field' }, el('span', {}), url), userF = el('label', { class: 'field' }, el('span', {}, T('User name')), user), secF = el('label', { class: 'field' }, el('span', {}), secret), regF = el('label', { class: 'field' }, el('span', {}, T('Dashboard region')), region);
  const help = el('p', { class: 'small muted' }), msg = el('p', { class: 'small', style: 'min-height:1.2em' });
  const sync = () => { const h = NET_HELP[kind.value]; urlF.hidden = !h[0]; if (h[0]) { urlF.firstChild.textContent = T(h[0]); url.placeholder = h[1]; } secF.firstChild.textContent = T(h[2]); userF.hidden = kind.value !== 'adguard'; regF.hidden = kind.value !== 'meraki'; help.textContent = T(h[3]); };
  kind.onchange = sync; sync();
  const save = el('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true; msg.style.color = ''; msg.textContent = T('Connecting...');
    try { const r = await post('/api/network', { kind: kind.value, url: url.value, user: user.value, secret: secret.value, region: region.value }); secret.value = ''; m.remove(); toast(T('{name} connected', { name: r.source.kindName })); redraw(); }
    catch (e) { msg.textContent = e.message; msg.style.color = 'var(--bad)'; save.disabled = false; }
  } }, T('Connect'));
  const m = modal(el('div', {}, el('label', { class: 'field' }, el('span', {}, T('What to connect')), kind), urlF, userF, regF, secF, help,
    el('p', { class: 'tiny muted' }, T('CasaTorch only reads - it never changes your network. The key or password is kept encrypted on this CasaTorch.'), ' ', el('a', { href: 'https://casatorch.com/docs/pro/network.html', target: '_blank', rel: 'noopener' }, T('Learn more'))), msg, el('div', { class: 'row', style: 'justify-content:flex-end' }, save)), { title: T('Connect your network') });
}
function networkCard(nw, redraw) {
  const card = el('div', { class: 'card netsrc', style: 'margin-top:14px' });
  const head = el('h2', { style: 'margin:0' }, T('Network devices'), el('span', { class: 'pill pro' }, 'Pro'));
  if (!nw.pro) {
    card.append(head, proPanel(T('Connect UniFi, Cisco Meraki, Pi-hole or AdGuard Home: every access point and switch online or offline, how many devices are connected, and how much your DNS filter blocks - with an alert when something drops off.')));
    return card;
  }
  const add = el('button', { class: 'btn small', onclick: () => netConnect(nw, redraw) }, icon('plus'), T('Connect'));
  const rows = nw.sources.map((x) => {
    const bad = x.ok === false, down = (x.devices || []).filter((d) => !d.online);
    const del = el('button', { class: 'btn ghost small', 'aria-label': T('Disconnect {name}', { name: x.name }), onclick: async () => { if (!confirm(T('Disconnect {name}?', { name: x.name }))) return; try { await api(`/api/network/${encodeURIComponent(x.id)}`, { method: 'DELETE' }); redraw(); } catch (e) { toast(e.message); } } }, icon('x'));
    const list = (x.devices || []).length ? el('details', { class: 'netdevs' }, el('summary', {}, `${T(x.devices.length === 1 ? '{n} device' : '{n} devices', { n: x.devices.length })}${down.length ? ` - ${T('{n} offline', { n: down.length })}` : ''}`),
      el('div', { class: 'netgrid' }, [...down, ...x.devices.filter((d) => d.online)].map((d) => el('div', { class: 'netdev' }, el('span', { class: `dot ${d.online ? (d.alerting ? 'warn' : 'good') : 'bad'}` }), el('span', { class: 'ellipsis' }, d.name), el('span', { class: 'tiny muted ellipsis' }, [d.model, d.ip].filter(Boolean).join(' · ')))))) : null;
    return el('div', { class: 'netrow' },
      el('div', { class: 'row', style: 'gap:12px' }, el('span', { class: `dot ${bad ? 'bad' : x.summary?.offline || x.summary?.protection === false ? 'warn' : 'good'}` }),
        el('div', { class: 'grow' }, el('div', { class: 'row wrap', style: 'gap:8px' }, el('b', {}, x.name), x.name !== x.kindName ? el('span', { class: 'tiny muted' }, x.kindName) : null),
          el('div', { class: 'small muted' }, bad ? T('Can\'t connect: {error}', { error: x.error }) : netSummary(x))),
        nw.demo ? null : del),
      list);
  });
  const refresh = el('button', { class: 'btn ghost small', 'aria-label': T('Refresh'), onclick: async () => { refresh.disabled = true; try { await post('/api/network/refresh'); redraw(); } catch (e) { toast(e.message); refresh.disabled = false; } } }, icon('reset'));
  card.append(el('div', { class: 'row between', style: 'margin-bottom:10px' }, head, el('div', { class: 'row', style: 'gap:6px' }, nw.sources.length && !nw.demo ? refresh : null, nw.demo ? null : add)),
    rows.length ? el('div', { class: 'netrows' }, rows) : el('p', { class: 'muted' }, T('Nothing connected yet. Connect UniFi, Cisco Meraki, Pi-hole or AdGuard Home.')));
  return card;
}

/* ---- the page ---- */
async function networkPage(main) {
  const load = async () => {
    const [ov, inet, nw, at, mo, sec] = await Promise.all([api('/api/network/overview').catch(() => null), api('/api/internet').catch(() => ({})), api('/api/network').catch(() => ({ pro: false, sources: [], kinds: {} })),
      api('/api/apptests').catch(() => null), api('/api/monitors').catch(() => ({ pro: false, monitors: [], max: 30 })), api('/api/security').catch(() => null)]);
    const demo = !!S.status?.demo; nw.demo = mo.demo = demo; if (at) at.demo = demo;
    return { ov, inet, nw, at, mo, sec };
  };
  const addBtn = el('button', { class: 'btn', onclick: () => { const c = pageCtx(main); const d = c?.data; if (!d?.at) return; if (d.at.demo) return toast(T('Not in the demo.')); atAddAny(d.at, () => c.refresh?.(), d); } }, icon('gauge'), el('span', { class: 'hide-phone' }, T('Add a test')));
  const role = (S.me ||= await api('/api/auth/me').catch(() => ({})))?.user?.role;
  const canAdd = !S.status?.demo && (!role || ['owner', 'admin'].includes(role));
  return pageGrid(main, { page: 'network', title: tabLabel({ id: 'network', label: T('Network') }), sub: T('Your internet, your gear and every device on it - live'), load, actions: canAdd ? [addBtn] : [] });
}
