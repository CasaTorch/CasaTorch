/* ======================================================================
 * HouseOS dashboard - the shell: tabs (in the URL hash, so a wall panel
 * can be pointed at /#cameras), the clock, the Pro banner, and helpers the
 * tab files (10-home.js ...) share. Each tab is { id, label, render(main) };
 * render may return a function that refreshes it, called every 30 s.
 * ====================================================================== */
const $ = (s, root = document) => root.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const api = async (url, opts = {}) => {
  const o = { ...opts, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } };
  const r = await fetch(url, o);
  if (r.status === 401) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('sign in first'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j });
  return j;
};
const post = (url, body, method = 'POST') => api(url, { method, body: JSON.stringify(body || {}) });
const S = { status: null, tz: undefined, units: 'F', alertsOpen: 0 };
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
function modal(...content) {
  const m = el('div', { id: 'modal', onclick: (e) => { if (e.target === m) m.remove(); } }, el('div', { class: 'box' }, ...content, el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, el('button', { onclick: () => m.remove() }, 'Close'))));
  $('#modal')?.remove(); document.body.append(m); return m;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal')?.remove(); });
/* Time in the house's time zone (a wall panel in another zone still shows house time). */
const fmt = (iso, o) => (iso ? new Intl.DateTimeFormat('en-US', { timeZone: S.tz, ...o }).format(new Date(iso)) : '');
const fmtTime = (iso) => fmt(iso, { hour: 'numeric', minute: '2-digit' });
const fmtDay = (iso) => fmt(iso, { weekday: 'short' });
const fmtWhen = (iso) => { const d = new Date(iso), today = fmt(new Date().toISOString(), { dateStyle: 'short' }); return fmt(iso, { dateStyle: 'short' }) === today ? fmtTime(iso) : `${fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtTime(iso)}`; };
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); if (!(s >= 0)) return ''; if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
const KIND_ICON = { light: '\u{1F4A1}', switch: '⏻', plug: '\u{1F50C}', media: '♫', climate: '\u{1F321}', lock: '\u{1F512}', camera: '\u{1F4F7}', sensor: '◉' };
const devIcon = (d) => (d.water != null ? '\u{1F4A7}' : d.smoke != null ? '\u{1F525}' : d.open != null ? '\u{1F6AA}' : KIND_ICON[d.kind] || '◉');

const TABS = [];   // filled by the tab files
const tab = (t) => TABS.push(t);
let refresher = null, current = null;
async function show(id) {
  const t = TABS.find((x) => x.id === id) || TABS[0];
  current = t.id;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === t.id));
  const main = $('#view'); main.innerHTML = ''; refresher = null;
  try { refresher = (await t.render(main)) || null; }
  catch (err) { main.append(el('div', { class: 'card empty' }, `Could not load this: ${err.message}`)); }
}
function drawTabs() {
  const nav = $('.tabs'); nav.innerHTML = '';
  for (const t of TABS) {
    const a = el('a', { href: `#${t.id}`, 'data-tab': t.id }, t.label, t.pro ? el('span', { class: 'pro' }, 'PRO') : null, t.id === 'alerts' && S.alertsOpen ? el('span', { class: 'count' }, S.alertsOpen) : null);
    nav.append(a);
  }
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === current));
}
function drawBanner() {
  const b = $('#banner'), s = S.status; if (!s) return;
  const p = s.pro || {}; b.className = ''; b.innerHTML = '';
  if (s.demo) b.append('Demo mode: sample data, no real house connected. ', el('a', { href: '/setup.html' }, 'Set up my house'));
  else if (p.plan === 'trial') b.append(`HouseOS Pro trial: ${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? '' : 's'} left. `, el('a', { href: '#settings' }, 'Enter a license key'));
  else if (p.grace) b.append('Your Pro subscription has ended - Pro keeps working for a few more days. ', el('a', { href: '#settings' }, 'Renew'));
  else if (!p.pro) { b.className = 'free'; b.append('HouseOS Free. ', el('a', { href: '#settings' }, 'See what Pro adds')); }
  b.hidden = !b.textContent;
}
function tick() { $('#clock').textContent = fmt(new Date().toISOString(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
async function loadStatus() {
  try {
    S.status = await api('/api/status'); S.units = S.status.units || 'F';
    const a = await api('/api/alerts').catch(() => null); S.alertsOpen = a?.now?.length || 0;
  } catch { /* offline: keep what we had */ }
  $('#houseName').textContent = S.status?.house || (S.status?.demo ? 'Demo House' : '');
  drawBanner(); drawTabs();
}
async function boot() {
  try { const h = await api('/api/settings'); S.tz = h.house?.timezone || undefined; } catch { /* default zone */ }
  await loadStatus();
  tick(); setInterval(tick, 15_000);
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || 'home');
  setInterval(() => { if (document.hidden) return; loadStatus(); if (refresher) refresher(); }, 30_000);
}
document.addEventListener('DOMContentLoaded', () => boot());
