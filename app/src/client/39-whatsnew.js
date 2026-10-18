/* ======================================================================
 * What's new: after CasaTorch updates to a new version, a short sheet
 * shows once per browser with what this version adds (each line opens the
 * place it talks about), and a small dot marks the new sections until they
 * have been opened once. A brand-new CasaTorch gets the tour instead, and a
 * wall panel never gets either. Settings › Help opens the sheet any time.
 * ====================================================================== */
const WN_VERSION = '0.8';
const WN_KEY = 'casatorch-whatsnew', WN_SEEN = 'casatorch-new-opened';
/* [icon, title, words, where it opens, pro?] - only what this version really adds (docs: help/whats-new.html#v080). */
const WN_ITEMS = [
  ['trash', 'Household', 'Bin night the evening before, the mail, thirsty plants and the laundry.', '#settings/household'],
  ['star', 'Family hub', 'Shared lists, chores with stars, kids\' routines and the week\'s meals.', '#family'],
  ['drop', 'Rain radar', 'The last two hours of rain around your home - add it to Home as a widget.', '#home'],
  ['wifi', 'App tests, hop by hop', 'The path to every app, and the likely culprit when one is slow.', '#network'],
  ['cube', '3D home, drawn by you', 'Draw walls, rooms, stairs and the yard, then watch it all live.', '#house3d', true],
];
/* Sections (main bar ids and Settings sections) that are new in this version. */
const WN_NEW_TABS = ['family'], WN_NEW_SECTIONS = ['household', 'family'], WN_NEW_WIDGETS = ['radar', 'household', 'lists', 'chores', 'meals'];
const wnGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const wnSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
const wnVer = (v) => String(v || '0').split(':')[0].split('.').slice(0, 2).map((x) => Number(x) || 0);
const wnOlder = (a, b) => { const [a1, a2] = wnVer(a), [b1, b2] = wnVer(b); return a1 < b1 || (a1 === b1 && a2 < b2); };
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
  const list = el('ul', { class: 'wn-list' }, WN_ITEMS.filter(([, , , href]) => href !== '#house3d' || TABS.some((t) => t.id === 'house3d')).map(([ic, title, words, href, pro]) => el('li', {},
    el('a', { class: 'wn-item', href, onclick: () => m.remove() }, el('span', { 'aria-hidden': 'true' }, icon(ic)),
      el('span', {}, el('b', {}, T(title), pro ? el('span', { class: 'pill pro', style: 'margin-left:6px' }, 'Pro') : null), el('small', {}, T(words)))))));
  const m = modal(el('div', { class: 'wn' }, el('p', { class: 'muted', style: 'margin-top:0' }, T('Here\'s what\'s new. Tap one to see it.')), list,
    el('div', { class: 'row between wrap', style: 'gap:8px' }, el('a', { class: 'btn ghost', href: 'https://casatorch.com/docs/help/whats-new.html', target: '_blank', rel: 'noopener' }, T('Everything that changed')),
      el('button', { class: 'btn primary', onclick: () => m.remove() }, T('Got it')))), { title: T('What\'s new in CasaTorch {v}', { v: WN_VERSION }) });
}
/* New widgets get a "New" tag in the widget gallery, for a household that updated. */
document.addEventListener('DOMContentLoaded', () => {
  if (['updated', 'shown'].includes(wnState())) for (const id of WN_NEW_WIDGETS) if (WIDGETS[id]) WIDGETS[id].isNew = true;
  setTimeout(() => whatsNew(), 1500);   // after the first screen has drawn (the tour offer goes first, at 0.7 s, and wins)
});
