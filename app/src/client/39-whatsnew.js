/* ======================================================================
 * What's new: after CasaTorch updates to a new version, a short sheet
 * shows once per browser with what this version adds (each line opens the
 * place it talks about), and a small dot marks the new sections until they
 * have been opened once. A brand-new CasaTorch gets the tour instead, and a
 * wall panel never gets either. Settings › Help opens the sheet any time.
 * ====================================================================== */
/* The release this sheet is for. Any CasaTorch that last showed an older sheet (0.9 and earlier) shows it once.
   Compared as major.minor.patch; bump it (and WN_GROUPS) with each release that has news. */
const WN_VERSION = '0.9.4';
const WN_KEY = 'casatorch-whatsnew', WN_SEEN = 'casatorch-new-opened';
/* Settings › Voice assistants names a microphone icon; the set in 00-core.js had none. */
Object.assign(ICONS, { mic: 'M12 3.5a2.8 2.8 0 0 0-2.8 2.8v5.4a2.8 2.8 0 0 0 5.6 0V6.3A2.8 2.8 0 0 0 12 3.5zM6.5 11a5.5 5.5 0 0 0 11 0M12 16.5v4M9 20.5h6' });
/* Groups of [icon, title, words, where it opens, pro?] - only what each version really adds (docs: help/whats-new.html,
   #next for this version, #v093 for 0.9.3, which had no sheet of its own). A group's version null = this version.
   '#inbox' opens the inbox sheet instead of a page. */
const WN_GROUPS = [
  [null, [
    ['lock', 'Only your approved devices', 'Away from home, your home opens only on your phones and the browsers you approve.', '#settings/devices'],
    ['user', 'Devices & sessions', 'Every signed-in device, sign-in alerts, and a lock for remote access.', '#settings/devices'],
    ['plug', 'New devices found', 'CasaTorch finds gear on your network - add it in one tap.', '#connect'],
    ['reset', 'Undo and layout files', 'Undo while you edit a page, and export or import its layout.', '#home'],
    ['checkc', 'Security score', 'Settings › Health shows which protections are on.', '#settings/health'],
    ['spark', 'When Pro ends', 'A daily key check, and a clear note with Renew. Nothing is deleted.', '#settings/pro'],
  ]],
  ['0.9.3', [
    ['list', 'Timeline', 'Everything at your doors and cameras in one list, with clips.', '#timeline'],
    ['bell', 'Your own inbox', 'The bell on every page: what happened, and what you haven\'t read.', '#inbox'],
    ['camera', 'Ring chimes', 'Volume and snooze, without Home Assistant.', '#cameras', true],
  ]],
];
/* Sections (main bar ids and Settings sections) that are new in this version. */
const WN_NEW_TABS = [], WN_NEW_SECTIONS = ['devices'], WN_NEW_WIDGETS = [];
const wnGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const wnSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
const wnVer = (v) => { const p = String(v || '0').split(':')[0].split('.').map((x) => Number(x) || 0); return [p[0] || 0, p[1] || 0, p[2] || 0]; };
const wnOlder = (a, b) => { const x = wnVer(a), y = wnVer(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
/* "updated": this browser used an older CasaTorch before (so the new things are news); fresh browsers just remember the version. */
function wnState() {
  if (wnState.v) return wnState.v;
  const seen = wnGet(WN_KEY), usedBefore = !!wnGet('casatorch-tour');
  let st = 'quiet';
  if (seen && wnOlder(seen, WN_VERSION)) st = 'updated';
  else if (!seen && usedBefore && !new URLSearchParams(location.search).has('tour')) st = 'updated';   // opened CasaTorch before this version kept track
  else if (seen === `${WN_VERSION}:new`) st = 'shown';
  if (st === 'quiet' && !seen) wnSet(WN_KEY, WN_VERSION);
  return (wnState.v = st);
}
const wnOpened = () => { try { return new Set(JSON.parse(wnGet(WN_SEEN) || '[]')); } catch { return new Set(); } };
/* A dot on a main-bar button for a section that is new, until it has been opened. */
function newDot(id) {
  if (!['updated', 'shown'].includes(wnState()) || !WN_NEW_TABS.includes(id) || wnOpened().has(id) || id === current) return null;
  return el('span', { class: 'newdot', title: T('New'), 'aria-label': T('New') });
}
function newTag(id) {
  if (!['updated', 'shown'].includes(wnState()) || wnOpened().has(`settings/${id}`)) return null;
  return WN_NEW_SECTIONS.includes(id) ? el('span', { class: 'newtag' }, T('New')) : null;
}
addEventListener('hashchange', () => {
  const id = location.hash.slice(1); if (!id) return;
  const o = wnOpened(), base = id.split('/')[0];
  if (o.has(id) && o.has(base)) return;
  o.add(base); if (id.includes('/')) o.add(id);
  wnSet(WN_SEEN, JSON.stringify([...o]));
  if (WN_NEW_TABS.includes(base) && S.ui) drawNav();
});
function whatsNew(always = false) {
  if (!always && (wnState() !== 'updated' || isPanel() || $('#modal') || $('#tour'))) return;
  wnSet(WN_KEY, `${WN_VERSION}:new`); wnState.v = 'shown';
  const item = ([ic, title, words, href, pro]) => el('li', {},
    el('a', { class: 'wn-item', href: href === '#inbox' ? '#' : href, onclick: (e) => { m.remove(); if (href === '#inbox') { e.preventDefault(); if (typeof inboxOpen === 'function') inboxOpen(); } } }, el('span', { 'aria-hidden': 'true' }, icon(ic)),
      el('span', {}, el('b', {}, T(title), pro ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'Pro') : null), el('small', {}, T(words)))));
  const shown = (href) => href !== '#house3d' || TABS.some((t) => t.id === 'house3d');
  const groups = WN_GROUPS.map(([v, items]) => [el('h3', { class: 'wn-h' }, v ? T('New in {v}', { v }) : T('New in this version')), el('ul', { class: 'wn-list' }, items.filter(([, , , href]) => shown(href)).map(item))]).flat();
  const m = modal(el('div', { class: 'wn' }, el('p', { class: 'muted', style: 'margin-top:0' }, T('Here\'s what\'s new. Tap one to see it.')), ...groups,
    el('div', { class: 'row between wrap', style: 'gap:8px' }, el('a', { class: 'btn ghost', href: 'https://casatorch.com/docs/help/whats-new.html', target: '_blank', rel: 'noopener' }, T('Everything that changed')),
      el('button', { class: 'btn primary', onclick: () => m.remove() }, T('Got it')))), { title: T('What\'s new in CasaTorch') });
}
/* New widgets get a "New" tag in the widget gallery, for a household that updated. */
document.addEventListener('DOMContentLoaded', () => {
  if (['updated', 'shown'].includes(wnState())) for (const id of WN_NEW_WIDGETS) if (WIDGETS[id]) WIDGETS[id].isNew = true;
  setTimeout(() => whatsNew(), 1500);   // after the first screen has drawn (the tour offer goes first, at 0.7 s, and wins)
});
