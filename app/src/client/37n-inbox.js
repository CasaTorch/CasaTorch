/* ---- Inbox: your own list of what happened, with what you've read (40i-inbox.js) ----
   The bell at the top of every page: a count of what you haven't read, and the list - the alerts your rules show you
   in the app, newest first. Tap one to go where it happened (it's then read); mark all read; clear one or all. Each
   person has their own; nothing here changes what's pushed to phones (Settings › Alerts does that). */
const INBOX_IC = { doorbell: 'bell', motion: 'user', detection: 'camera', water: 'drop', smoke: 'fire', temp: 'thermo', security: 'shield', offline: 'plug', battery: 'gauge', network: 'wifi', weather: 'drop', household: 'trash', reminders: 'clock', system: 'checkc' };
const INBOX = { n: 0, btn: null, at: 0 };
function inboxBadge(n) {
  INBOX.n = n; const b = INBOX.btn; if (!b) return;
  const badge = b.querySelector('.badge');
  badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = !n;
  b.setAttribute('aria-label', n ? T('Inbox, {n} unread', { n }) : T('Inbox'));
  b.title = b.getAttribute('aria-label');
}
async function inboxRefresh() {
  if (!INBOX.btn || document.hidden) return;
  if (S.me?.user?.panel) { INBOX.btn.hidden = true; return; }   // a wall panel has no inbox of its own
  try { const d = await api('/api/inbox'); INBOX.btn.hidden = false; inboxBadge(d.unread || 0); INBOX.at = Date.now(); } catch { /* signed out or offline: the badge keeps its last count */ }
}
function inboxRow(x, act) {
  const go = el('button', { type: 'button', class: 'inbox-go', onclick: () => act('open', x) },
    el('span', { class: `inbox-ic sev-${x.severity}`, 'aria-hidden': 'true' }, icon(INBOX_IC[x.kind] || 'bell', 18)),
    el('span', { class: 'inbox-txt' }, el('b', {}, TM(x.title, x.msg, x.vars)), el('span', { class: 'tiny muted' }, `${ago(x.at)}${x.read ? '' : ` · ${T('Unread')}`}`)));
  return el('li', { class: `inbox-item${x.read ? '' : ' unread'}` }, go,
    x.read ? null : el('button', { type: 'button', class: 'inbox-x', title: T('Mark read'), 'aria-label': `${T('Mark read')}: ${TM(x.title, x.msg, x.vars)}`, onclick: () => act('read', x) }, icon('check', 16)),
    el('button', { type: 'button', class: 'inbox-x', title: T('Clear'), 'aria-label': `${T('Clear')}: ${TM(x.title, x.msg, x.vars)}`, onclick: () => act('clear', x) }, icon('x', 16)));
}
function inboxOpen() {
  const box = el('div', { class: 'inbox', 'aria-live': 'polite' }, el('div', { class: 'skel', 'aria-busy': 'true', 'aria-label': T('Loading…') }, el('i', { class: 'skel-b skel-w60' }), el('i', { class: 'skel-b skel-w90' }), el('i', { class: 'skel-b skel-w75' })));
  let m = null;
  const draw = (d) => {
    inboxBadge(d.unread || 0);
    const head = el('div', { class: 'row wrap inbox-head' }, el('span', { class: 'small muted grow' }, d.unread ? T('{n} unread', { n: d.unread }) : T('All read')),
      d.unread ? el('button', { class: 'btn small', onclick: () => act('readAll') }, icon('check', 16), T('Mark all read')) : null,
      d.items.length ? el('button', { class: 'btn small ghost', onclick: () => act('clearAll') }, T('Clear all')) : null);
    box.replaceChildren(head, d.items.length ? el('ul', { class: 'inbox-list' }, d.items.map((x) => inboxRow(x, act)))
      : el('div', { class: 'inbox-empty' }, icon('checkc', 28), el('b', {}, T('You\'re all caught up.')), el('span', { class: 'small muted' }, T('What your alert settings show you in the app lands here.')), el('a', { class: 'small', href: '#settings/alerts', onclick: () => m?.remove() }, T('Alert settings')), typeof docLink === 'function' ? docLink('inbox') : null));
  };
  const fail = (err) => box.replaceChildren(el('div', { class: 'inbox-empty', role: 'alert' }, icon('info', 24), el('b', {}, T('The inbox didn\'t load')), el('span', { class: 'small muted' }, err?.message || ''), el('button', { class: 'btn small', onclick: () => load() }, icon('reset', 16), T('Try again'))));
  const load = async () => { try { draw(await api('/api/inbox')); } catch (err) { fail(err); } };
  async function act(what, x) {
    try {
      if (what === 'open') { if (!x.read) post('/api/inbox/read', { ids: [x.id] }).then((d) => inboxBadge(d.unread || 0)).catch(() => {}); m?.remove(); location.hash = x.link || '#alerts'; return; }
      const d = what === 'read' ? await post('/api/inbox/read', { ids: [x.id] }) : what === 'clear' ? await post('/api/inbox/clear', { ids: [x.id] })
        : what === 'readAll' ? await post('/api/inbox/read', { all: true }) : await post('/api/inbox/clear', { all: true });
      draw(d);
    } catch (err) { toast(err.message, 4000); }
  }
  m = modal(box, { title: T('Inbox') });
  load();
}
function inboxInit() {
  const top = document.querySelector('.main > .top'), actions = top?.querySelector('#actions'); if (!top || !actions || INBOX.btn) return;
  INBOX.btn = el('button', { type: 'button', class: 'btn icon inbox-btn', hidden: true, 'aria-label': T('Inbox'), title: T('Inbox'), onclick: inboxOpen }, icon('bell', 18), el('span', { class: 'badge', hidden: true }));
  top.insertBefore(INBOX.btn, actions);
  setTimeout(inboxRefresh, 1500);
  setInterval(() => { if (Date.now() - INBOX.at > 55_000) inboxRefresh(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - INBOX.at > 15_000) inboxRefresh(); });
  addEventListener('hashchange', () => { if (Date.now() - INBOX.at > 15_000) inboxRefresh(); });
}
inboxInit();
