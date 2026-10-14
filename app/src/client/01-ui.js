/* ======================================================================
 * Look & feel (shared by every screen, saved on the box) and panel mode
 * (this screen only): theme, colors, which side the menu is on, the
 * status bar across the top, and the household's own names for things.
 * ====================================================================== */
S.ui = { theme: 'dark', accent: '#5eb8ff', accent2: '#8b7bff', nav: 'left', statusBar: 'panel', panelAsk: true, tabs: {}, deviceNames: {} };
const PALETTES = [['Ocean', '#5eb8ff', '#8b7bff'], ['Sunset', '#fb923c', '#f43f5e'], ['Forest', '#34d399', '#22d3ee'], ['Grape', '#a78bfa', '#ec4899'], ['Gold', '#fbbf24', '#f97316'], ['Rose', '#fb7185', '#c084fc'], ['Mint', '#2dd4bf', '#a3e635'], ['Slate', '#94a3b8', '#64748b']];
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminance = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const tabLabel = (t) => S.ui.tabs?.[t.id]?.label || t.label;
const isPanel = () => { try { return new URLSearchParams(location.search).has('panel') || localStorage.getItem('casatorch-panel') === '1'; } catch { return false; } };
const darkNow = () => S.ui.theme === 'dark' || (S.ui.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
function applyUi() {
  const root = document.documentElement, u = S.ui;
  root.dataset.theme = darkNow() ? 'dark' : 'light';
  try { localStorage.setItem('casatorch-theme', root.dataset.theme); } catch { /* private window */ }
  root.style.setProperty('--accent', u.accent); root.style.setProperty('--accent-2', u.accent2);
  root.style.setProperty('--on-accent', luminance(u.accent) > 0.35 ? '#06101e' : '#ffffff');
  const [r, g, b] = hexRgb(u.accent), [r2, g2, b2] = hexRgb(u.accent2), a = darkNow() ? 0.10 : 0.16;
  root.style.setProperty('--glow-a', `rgba(${r},${g},${b},${a})`); root.style.setProperty('--glow-b', `rgba(${r2},${g2},${b2},${a})`);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', darkNow() ? '#070a12' : '#eef2f8');
  document.body.classList.remove('nav-left', 'nav-right', 'nav-top', 'nav-bottom'); document.body.classList.add(`nav-${u.nav || 'left'}`);
  document.body.classList.toggle('panel', isPanel());
  statusBar.draw();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S.ui.theme === 'auto') applyUi(); });
async function saveUi(patch) { S.ui = await post('/api/ui', patch, 'PUT'); applyUi(); drawNav(); return S.ui; }

/* ---- panel mode (this screen only) ---- */
let wakeLock = null;
async function setPanel(on) {
  try { localStorage.setItem('casatorch-panel', on ? '1' : '0'); } catch { /* ignore */ }
  if (!on && new URLSearchParams(location.search).has('panel')) { history.replaceState(null, '', location.pathname + location.hash); }
  applyUi();
  if (on) { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ } toast('Panel mode - the screen stays on. Tap × in the top bar to leave.'); }
  else { try { await wakeLock?.release(); } catch { /* ignore */ } wakeLock = null; if (document.fullscreenElement) document.exitFullscreen?.(); }
  show(current);
}
document.addEventListener('visibilitychange', async () => { if (!document.hidden && isPanel() && !wakeLock) { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } } });

/* ---- the status bar ---- */
const statusBar = {
  conns: null, wx: null, timer: null, answerEl: null,
  visible() { return S.ui.statusBar === 'always' || (isPanel() && S.ui.statusBar !== 'off') || (isPanel() && S.ui.statusBar === 'off' && false); },
  async load() {
    const [c, h] = await Promise.all([api('/api/connections').catch(() => null), api('/api/home').catch(() => null)]);
    if (c) this.conns = c.items; if (h?.weather?.now) this.wx = h.weather.now;
    this.draw();
  },
  draw() {
    const bar = $('#statusbar'); if (!bar) return;
    const show = this.visible(); bar.hidden = !show;
    document.documentElement.style.setProperty('--sb-h', show ? `${bar.offsetHeight || 52}px` : '0px');
    if (!show) { clearInterval(this.timer); this.timer = null; return; }
    if (!this.timer) { this.load(); this.timer = setInterval(() => { if (!document.hidden) this.load(); }, 60_000); }
    const now = new Date().toISOString();
    const dot = { ok: 'good', warn: 'warn', down: 'bad', off: '' };
    const items = (this.conns || []).map((c) => el('span', { class: 'sb-item', title: `${c.name}: ${c.detail || c.state}` }, el('span', { class: `dot ${dot[c.state] || ''}` }), c.name, c.detail && c.state !== 'ok' ? el('small', {}, c.detail) : null));
    if (S.alertsOpen) items.unshift(el('a', { class: 'sb-item', href: '#alerts', style: 'color:var(--bad);text-decoration:none' }, icon('bell', 14), `${S.alertsOpen} alert${S.alertsOpen === 1 ? '' : 's'}`));
    const kids = [el('div', {}, el('div', { class: 'sb-clock' }, fmt(now, { hour: 'numeric', minute: '2-digit' }))), el('div', { class: 'sb-date' }, fmt(now, { weekday: 'short', month: 'short', day: 'numeric' })),
      this.wx ? el('span', { class: 'sb-wx' }, `${wxIcon(this.wx.symbol)} ${this.wx.temp}°`) : null];
    if (S.ui.panelAsk !== false && isPro() && isPanel()) kids.push(this.askBar());
    kids.push(el('div', { class: 'sb-items grow' }, items));
    if (isPanel()) kids.push(el('button', { class: 'btn ghost small', title: 'Full screen', 'aria-label': 'Full screen', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()) }, icon('expand')),
      el('button', { class: 'btn ghost small', title: 'Leave panel mode', 'aria-label': 'Leave panel mode', onclick: () => setPanel(false) }, icon('x')));
    const keepInput = bar.querySelector('.sb-ask input'); const val = keepInput?.value || ''; const focused = document.activeElement === keepInput;
    bar.replaceChildren(...kids.filter(Boolean));
    const inp = bar.querySelector('.sb-ask input'); if (inp) { inp.value = val; if (focused) inp.focus(); }
    document.documentElement.style.setProperty('--sb-h', `${bar.offsetHeight}px`);
  },
  askBar() {
    const input = el('input', { type: 'text', placeholder: 'Ask the house…', 'aria-label': 'Ask the house', maxlength: 1000 });
    const wrap = el('div', { class: 'sb-ask' }, input, el('button', { class: 'btn primary', 'aria-label': 'Ask', onclick: () => go() }, icon('send')));
    if (this.answerEl) wrap.append(this.answerEl);
    const close = () => { this.answerEl?.remove(); this.answerEl = null; };
    const go = async () => {
      const q = input.value.trim(); if (!q) return;
      close(); this.answerEl = el('div', { class: 'sb-answer' }, el('span', { class: 'typing' }, el('i'), el('i'), el('i'))); wrap.append(this.answerEl);
      askHistory.push({ role: 'user', content: q });
      let r; try { r = await post('/api/ask', { question: q, history: askHistory.slice(0, -1).slice(-8).map(({ role, content }) => ({ role, content })) }); } catch (err) { r = { answer: err.body?.setup ? 'Connect an AI first: Settings > Ask the house.' : err.message, actions: [] }; }
      askHistory.push({ role: 'assistant', content: r.answer, actions: r.actions });
      input.value = '';
      const box = el('div', { class: 'sb-answer' }, el('div', { class: 'row between', style: 'align-items:flex-start;gap:12px' }, el('div', {}, r.answer), el('button', { class: 'btn ghost small', 'aria-label': 'Close', onclick: close }, icon('x'))));
      if (r.actions?.length) box.append(el('div', { class: 'acts' }, r.actions.map((a) => { const b = el('button', { class: 'btn small' }, icon('check'), a.label); b.onclick = async () => { b.disabled = true; try { await post(`/api/devices/${encodeURIComponent(a.deviceId)}/${a.action}`); b.replaceChildren(icon('check'), 'Done'); } catch (err) { toast(err.message); b.disabled = false; } }; return b; })));
      this.answerEl.replaceWith(box); this.answerEl = box;
      clearTimeout(this.hideT); this.hideT = setTimeout(close, 45_000);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') close(); });
    return wrap;
  },
};
setInterval(() => { if (!$('#statusbar')?.hidden) { const c = $('#statusbar .sb-clock'); if (c) c.textContent = fmt(new Date().toISOString(), { hour: 'numeric', minute: '2-digit' }); } }, 10_000);
