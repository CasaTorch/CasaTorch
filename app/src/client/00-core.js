/* HouseOS client: the tab bar and a placeholder view per tab, filled from
   /api/<tab>. Ported homedash client modules replace these views. */
const TABS = [
  { id: 'home', label: 'Home' }, { id: 'alerts', label: 'Alerts' }, { id: 'controls', label: 'Controls' },
  { id: 'cameras', label: 'Cameras' }, { id: 'sensors', label: 'Sensors' }, { id: 'network', label: 'Network' },
  { id: 'servers', label: 'Servers' }, { id: 'energy', label: 'Energy' },
];
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
async function show(tab) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const main = $('#view'); main.innerHTML = '';
  main.appendChild(el('h1', null, TABS.find((t) => t.id === tab).label));
  try {
    const d = await (await fetch(`/api/${tab}`)).json();
    const items = d.items || [];
    if (!items.length) main.appendChild(el('p', 'muted', d.error || 'Nothing here yet.'));
    for (const it of items) { const c = el('div', 'card'); c.appendChild(el('div', 'title', it.title)); if (it.detail) c.appendChild(el('div', 'muted', it.detail)); main.appendChild(c); }
  } catch { main.appendChild(el('p', 'muted', 'Could not reach the HouseOS server.')); }
}
(async () => {
  const bar = $('.tabs');
  for (const t of TABS) { const b = el('button', null, t.label); b.dataset.tab = t.id; b.onclick = () => show(t.id); bar.appendChild(b); }
  try { const s = await (await fetch('/api/status')).json(); if (s.demo) $('#demo').hidden = false; } catch { /* offline */ }
  show('home');
})();
