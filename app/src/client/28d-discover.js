/* ======================================================================
 * "New devices found" (29n-discover.js on the server): what CasaTorch spotted on the home network or in Home
 * Assistant since the last look, each with one tap to add, "Not now" (back in a week) or "Hide" (for good).
 *  - Shown at the top of Connect, and as a sheet from the count on the Connect tab.
 *  - Add: a Shelly is tested and added here; a new Home Assistant device becomes a tile on Home (and its room on
 *    Controls, when Controls is arranged by room); a brand that comes through Home Assistant opens its questions here;
 *    the rest open the guided setup at that item with the address filled in. Passwords are asked only there, in
 *    sealed fields.
 *  - "Add by address": type an address, CasaTorch says what answers there (home network only).
 * Everything shown came from the network: it is drawn as text only (el() never parses HTML).
 * ====================================================================== */
const DISC = { n: 0, at: 0 };
/** The count on the Connect tab (admins only; refreshed at most every 5 minutes, or right after a change). */
async function discCount(force = false) {
  if (!force && Date.now() - DISC.at < 300_000) return DISC.n;
  DISC.at = Date.now();
  try {
    const me = S.me || await api('/api/auth/me').catch(() => null);
    const admin = me && (me.signIn === false || ['owner', 'admin'].includes(me.user?.role)) && !me.user?.panel;
    const n = admin ? (await api('/api/discover/count')).n || 0 : 0;
    if (n !== DISC.n) { DISC.n = n; if (typeof drawNav === 'function') drawNav(); }
  } catch { /* offline: keep the last count */ }
  return DISC.n;
}
setTimeout(() => discCount(true), 4000);

const DISC_HOW = { direct: 'Adds in one tap', tile: 'Adds a tile to Home', ha: 'Added through Home Assistant', setup: 'Opens the guided setup', info: 'Nothing to set up' };
/** One finding as a row: what it is, where, the room, and its buttons. */
function discRow(it, after) {
  const title = it.name || T(it.label);
  const sub = [it.name ? T(it.label) : null, it.brand ? T('{n} on your network', { n: it.n || 1 }) : it.addr ? String(it.addr).replace(/^https?:\/\//, '') : null].filter(Boolean).join(' · ');
  const msg = el('div', { class: 'tiny', role: 'status' });
  const busy = (b, on) => { b.disabled = on; b.classList.toggle('busy', on); };
  const add = el('button', { class: 'btn small primary', onclick: async () => {
    busy(add, true); msg.textContent = '';
    try { await discAdd(it, after); } catch (e) { msg.textContent = e.message; msg.className = 'tiny bad'; } finally { busy(add, false); }
  } }, it.how === 'info' ? T('OK') : T('Add'));
  const hide = (later) => async () => { try { await post(`/api/discover/${encodeURIComponent(it.key)}/hide`, { later }); } catch { /* gone already */ } after(); };
  return el('div', { class: 'disc-row', 'data-kind': it.kind },
    el('span', { class: 'disc-ic', 'aria-hidden': 'true' }, icon(it.icon || 'spark', 20)),
    el('div', { class: 'grow', style: 'min-width:0' },
      el('b', { class: 'ellipsis', style: 'display:block' }, title),
      el('div', { class: 'tiny muted ellipsis' }, sub),
      el('div', { class: 'row wrap', style: 'gap:6px;margin-top:4px' }, it.area ? el('span', { class: 'pill' }, icon('home', 12), ' ', it.area) : null, el('span', { class: 'tiny muted' }, T(DISC_HOW[it.how] || DISC_HOW.info))),
      msg),
    el('div', { class: 'disc-acts' },
      it.how === 'info' ? null : el('button', { class: 'btn small ghost', title: T('Ask again in a week'), onclick: hide(true) }, T('Not now')),
      el('button', { class: 'btn small ghost', title: T('Don\'t show this again'), onclick: hide(false) }, T('Hide')),
      add));
}
/** Add one finding. Throws with a message to show on its row. */
async function discAdd(it, after) {
  if (it.how === 'info') { await post(`/api/discover/${encodeURIComponent(it.key)}/hide`, {}); after(); return; }
  const r = await post(`/api/discover/${encodeURIComponent(it.key)}/add`, {});
  if (r.demo) { toast(T('Demo mode - nothing was changed.')); after(); return; }
  if (r.added === 'shelly') { toast(T('Added {name}. Its switches and sensors are on Controls.', { name: r.name || 'Shelly' }), 4000); after(); return; }
  if (r.added === 'tile') { toast(r.room ? T('Added to Home, and to {room} on Controls.', { room: r.room }) : r.already ? T('It\'s on Home already.') : T('Added to Home.'), 4000); after(); return; }
  if (r.open === 'ha' && typeof haFlowModal === 'function') { haFlowModal({ domain: r.domain, label: it.name || T(it.label) }, after); return; }
  if (r.open === 'setup' && typeof startConnect === 'function') {
    const conn = await api('/api/connections').catch(() => ({ ha: {} }));
    await startConnect({ label: it.name || T(it.label), step: r.step, add: r.add || '', how: 'direct', query: r.addr ? { found: r.found, addr: r.addr } : null }, conn);
    return;
  }
  after();
}
/** The list, with Look again and Add by address. Used on Connect (a card) and in the sheet. */
function discPanel({ compact = false } = {}) {
  const box = el('div', { class: `disc${compact ? ' compact' : ''}` }), list = el('div', { class: 'disc-list' }), foot = el('div', { class: 'tiny muted' });
  const again = el('button', { class: 'btn small', onclick: async () => {
    again.disabled = true; foot.textContent = T('Looking around your network… about 30 seconds.');
    try { const r = await post('/api/discover/scan', {}); if (r.recent) toast(T('Just looked - nothing new since a minute ago.')); } catch (e) { toast(e.message); }
    again.disabled = false; load();
  } }, icon('reset', 14), T('Look again'));
  const addr = el('input', { type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: T('An address, like 192.168.1.40'), 'aria-label': T('Device address'), maxlength: 253 });
  const idMsg = el('div', { class: 'tiny', role: 'status' });
  const identify = async () => {
    const v = addr.value.trim(); if (!v) { addr.focus(); return; }
    idMsg.className = 'tiny muted'; idMsg.textContent = T('Asking that address…');
    try { const r = await post('/api/discover/identify', { addr: v }); idMsg.textContent = r.found?.length ? '' : T('Nothing CasaTorch knows answered at that address.'); if (r.found?.length) { addr.value = ''; load(); } }
    catch (e) { idMsg.className = 'tiny bad'; idMsg.textContent = e.message; }
  };
  addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') identify(); });
  const load = async () => {
    let r; try { r = await api('/api/discover'); } catch (e) { list.replaceChildren(el('p', { class: 'muted small' }, /403|admin/i.test(String(e.status || e.message)) ? T('Only an owner or admin can add devices.') : e.message)); return; }
    DISC.n = r.items.length; DISC.at = Date.now(); if (typeof drawNav === 'function') drawNav();
    list.replaceChildren(...(r.items.length ? r.items.map((it) => discRow(it, load)) : [el('div', { class: 'disc-empty' }, icon('checkc', 22), el('div', {}, el('b', {}, T('Nothing new right now')), el('div', { class: 'small muted' }, T('CasaTorch looks every 30 minutes. New lights, plugs, cameras and hubs show up here, ready to add.'))))]));
    foot.textContent = r.busy ? T('Looking around your network… about 30 seconds.') : r.at ? T('Last look: {when}', { when: fmt(r.at, { hour: 'numeric', minute: '2-digit', weekday: 'short' }) }) : '';
    if (r.busy) setTimeout(() => { if (box.isConnected) load(); }, 8000);
  };
  box.append(el('div', { class: 'row wrap', style: 'gap:10px;align-items:center;margin-bottom:8px' }, icon('search', 18), el('b', { class: 'grow' }, T('New devices found')), again), list,
    el('details', { class: 'disc-by-addr' }, el('summary', { class: 'small' }, T('Add by address')),
      el('p', { class: 'tiny muted' }, T('Know a device\'s address? CasaTorch asks it what it is. Only addresses on your home network work.')),
      el('div', { class: 'row', style: 'gap:8px' }, el('div', { class: 'grow' }, addr), el('button', { class: 'btn small', onclick: identify }, T('Find it'))), idMsg),
    foot);
  load();
  return box;
}
/** The sheet: from the count on the Connect tab, or a link (#connect?found). */
function discSheet() { const m = modal(discPanel({ compact: true }), { title: T('New devices found'), wide: true }); m.querySelector('.box')?.classList.add('tall'); return m; }
if (window.__casatorchTest) Object.assign(window.__casatorchTest, { discRow, discPanel });
