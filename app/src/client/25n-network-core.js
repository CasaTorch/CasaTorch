/* Network helpers the rest of the dashboard uses too (the internet drawer's masked address, adding a server to
   watch from App tests). The Network page itself (26-network.js) is its own file, loaded the first time Network opens. */
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
/* A public address: masked until tapped, then shown for 20 seconds - and only ever sent to admins. */
function nwIp(ip) {
  if (!ip) return null;
  const masked = String(ip).includes(':') ? `${String(ip).split(':').slice(0, 2).join(':')}:••••` : String(ip).replace(/^(\d+)\.\d+\.\d+\.(\d+)$/, '•••.•••.•••.$2');
  const b = el('button', { type: 'button', class: 'nw-ip', title: T('Show the address'), 'aria-label': T('Show the address') }, icon('eye', 13), el('span', {}, masked));
  let t = null;
  b.onclick = (e) => { e.stopPropagation(); const on = !b.classList.contains('shown'); b.classList.toggle('shown', on); b.lastChild.textContent = on ? ip : masked; clearTimeout(t); if (on) t = setTimeout(() => { b.classList.remove('shown'); b.lastChild.textContent = masked; }, 20_000); };
  return b;
}
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
