/* ======================================================================
 * HouseOS dashboard - the shell: side rail (bottom bar on phones), the
 * page title, the Pro banner, and helpers every tab shares. Tabs are
 * { id, label, icon, pro?, render(main) }; render may return a refresh
 * function (called every 30 s while the tab is open).
 * ====================================================================== */
const $ = (s, root = document) => root.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
/* Icons: 24x24 strokes, drawn here so HouseOS needs nothing from the internet. */
const ICONS = {
  home: 'M3 11 12 3l9 8M5 9.5V21h14V9.5M10 21v-6h4v6', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0', sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  camera: 'M3 8h3l2-3h8l2 3h3v11H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h0', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10', spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3', news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3', list: 'M9 6h11M9 12h11M9 18h11M4 6h0M4 12h0M4 18h0',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  thermo: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', door: 'M6 3h12v18H6zM14 12h.01', drop: 'M12 3s7 7.6 7 12a7 7 0 0 1-14 0c0-4.4 7-12 7-12z', fire: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-4 3 0-2-1-4-2-6-1 4-4 7-4 12a7 7 0 0 0 7 7z', dotc: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01', x: 'M6 6l12 12M18 6 6 18', plus: 'M12 5v14M5 12h14', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', check: 'M20 6 9 17l-5-5', checkc: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z', fan: 'M12 12a2 2 0 1 0 0-.01M12 10c0-4 1-7 4-7s2 5-2 7M14 12c4 0 7 1 7 4s-5 2-7-2M12 14c0 4-1 7-4 7s-2-5 2-7M10 12c-4 0-7-1-7-4s5-2 7 2', blinds: 'M4 3h16M5 3v14M19 3v14M5 7h14M5 11h14M5 15h14M12 17v3M10 21h4', play: 'M7 4l13 8-13 8z', vacuum: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 13h3M16 13h3', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', gauge: 'M12 21a9 9 0 1 1 9-9M12 12l5-5M4.6 16h14.8', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5', chevl: 'M15 18l-6-6 6-6', chevr: 'M9 18l6-6-6-6', expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
};
const icon = (name, size) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); if (size) { s.setAttribute('width', size); s.setAttribute('height', size); } s.innerHTML = `<path d="${ICONS[name] || ICONS.dotc}"/>`; return s; };
const api = async (url, opts = {}) => {
  const o = { ...opts, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } };
  const r = await fetch(url, o);
  if (r.status === 401) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('sign in first'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j });
  return j;
};
const post = (url, body, method = 'POST') => api(url, { method, body: JSON.stringify(body || {}) });
const S = { status: null, tz: undefined, units: 'F', alertsOpen: 0, settings: null };
const isPro = () => !!S.status?.pro?.pro;
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
function modal(content, { wide = false, title } = {}) {
  const box = el('div', { class: `box${wide ? ' wide' : ''}` }, title ? el('div', { class: 'row between', style: 'margin-bottom:12px' }, el('h3', { style: 'margin:0' }, title), el('button', { class: 'btn ghost small', 'aria-label': 'Close', onclick: () => m.remove() }, icon('x'))) : null, content);
  const m = el('div', { id: 'modal', onclick: (e) => { if (e.target === m) m.remove(); } }, box);
  $('#modal')?.remove(); document.body.append(m); return m;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal')?.remove(); });
/* Time in the house's time zone (a wall panel in another zone still shows house time). */
const fmt = (iso, o) => (iso ? new Intl.DateTimeFormat('en-US', { timeZone: S.tz, ...o }).format(new Date(iso)) : '');
const fmtTime = (iso) => fmt(iso, { hour: 'numeric', minute: '2-digit' });
const dayKey = (iso, tz = S.tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const fmtWhen = (iso) => { const k = dayKey(iso), today = dayKey(new Date().toISOString()), tom = dayKey(new Date(Date.now() + 86400_000).toISOString()); return k === today ? `Today ${fmtTime(iso)}` : k === tom ? `Tomorrow ${fmtTime(iso)}` : `${fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtTime(iso)}`; };
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); if (!(s >= 0)) return ''; if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
const hm = (t) => { const [h, m] = String(t).split(':').map(Number); return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : t; };
const tempOf = (c) => (c == null ? '-' : S.units === 'C' ? `${c.toFixed(1)}°` : `${Math.round(c * 9 / 5 + 32)}°`);
const devIconName = (d) => (d.water != null ? 'drop' : d.smoke != null ? 'fire' : d.kind === 'cover' ? (d.risky ? 'door' : 'blinds') : d.open != null ? 'door' : d.meter ? 'bolt' : { light: 'bulb', switch: 'plug', plug: 'plug', media: 'music', climate: 'thermo', lock: 'lock', camera: 'camera', fan: 'fan', action: 'play', vacuum: 'vacuum', alarm: 'shield', presence: 'user', value: 'gauge' }[d.kind] || 'dotc');

const TABS = [];   // filled by the tab files
const tab = (t) => TABS.push(t);
let refresher = null, current = null;
function setTop(title, sub = '', actions = []) { $('#title').textContent = title; $('#subtitle').textContent = sub; $('#actions').replaceChildren(...actions); }
async function show(id) {
  const t = TABS.find((x) => x.id === id) || TABS[0];
  current = t.id; document.body.classList.remove('editing-on');
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === t.id));
  const main = el('div'); $('#view').replaceChildren(main); refresher = null;   // a fresh box per visit: a slow, older render can't write into the new page
  setTop(tabLabel(t));
  try { const r = (await t.render(main)) || null; if (main.isConnected) refresher = r; }
  catch (err) { main.append(el('div', { class: 'card empty' }, `Could not load this: ${err.message}`)); }
}
function drawNav() {
  $('.nav').replaceChildren(...TABS.filter((t) => !S.ui.tabs?.[t.id]?.hidden).map((t) => el('a', { href: `#${t.id}`, 'data-tab': t.id, class: t.id === current ? 'on' : null, title: tabLabel(t) }, icon(t.icon), S.ui.tabs?.[t.id]?.label || t.short || t.label,
    t.pro && !isPro() ? el('span', { class: 'pro' }, 'PRO') : null, t.id === 'alerts' && S.alertsOpen ? el('span', { class: 'badge' }, S.alertsOpen) : null)));
}
function drawBanner() {
  const b = $('#banner'), s = S.status; if (!s) return;
  const p = s.pro || {}; b.className = ''; b.replaceChildren();
  if (s.demo) b.append('Demo mode - sample data, no real house connected.', el('a', { href: '/setup.html' }, 'Set up my house'));
  else if (p.plan === 'trial') b.append(icon('spark', 16), `Pro trial: ${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left - 3D Home, Ask the house and Ring are unlocked.`, el('a', { href: '#settings' }, 'Enter a license key'));
  else if (p.grace) b.append('Your Pro subscription has ended - Pro keeps working for a few more days.', el('a', { href: '#settings' }, 'Renew'));
  else if (!p.pro) { b.className = 'free'; b.append('HouseOS Free.', el('a', { href: '#settings' }, 'See what Pro adds')); }
  b.hidden = !b.textContent;
}
function tick() { $('#clock').textContent = fmt(new Date().toISOString(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
async function loadStatus() {
  try { S.status = await api('/api/status'); S.units = S.status.units || 'F'; const a = await api('/api/alerts').catch(() => null); S.alertsOpen = a?.now?.length || 0; } catch { /* offline: keep what we had */ }
  drawBanner(); drawNav(); statusBar.draw();
}
async function boot() {
  try { S.settings = await api('/api/settings'); S.tz = S.settings.house?.timezone || undefined; } catch { /* default zone */ }
  try { S.ui = { ...S.ui, ...(await api('/api/ui')) }; } catch { /* defaults */ }
  applyUi();
  await loadStatus();
  tick(); setInterval(tick, 15_000);
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || 'home');
  setInterval(() => { if (document.hidden || document.body.classList.contains('editing-on')) return; loadStatus(); if (refresher) refresher(); }, 30_000);
}
document.addEventListener('DOMContentLoaded', () => boot());
