/* ======================================================================
 * Remove CasaTorch (Settings › Updates & backup; owner only; 75r-remove.js on the server): a backup first if you want
 * one, then one tap signs every phone and browser out, ends their passes, deletes the secure address and its DNS names
 * at casatorch.com, and (if you choose) erases everything this CasaTorch keeps. Then: how to uninstall the program on
 * this kind of computer.
 * ====================================================================== */
const REMOVE_STEP = { passes: 'Passes for phones and browsers away from home ended', 'secure-access': 'Secure access and its address deleted at casatorch.com', 'home-address': 'The secure address at home deleted at casatorch.com', find: 'Taken off "Find my CasaTorch"', 'sign-out': 'Every phone and browser signed out', erase: 'Everything on this computer erased' };
/** How to remove the program itself, for the way it was installed: [text, command?] lines. Commands aren't translated. */
function uninstallHow(kind) {
  const H = {
    script: [[T('In a terminal on this computer:')], [null, 'curl -fsSL https://casatorch.com/install.sh | sudo bash -s -- --uninstall'], [T('Add --keep-data at the end to keep the settings folder.')]],
    deb: [[T('In a terminal on this computer:')], [null, 'sudo apt purge casatorch'], [T('Use "remove" instead of "purge" to keep the settings folder.')]],
    macos: [[T('Open Finder › Go › Go to Folder, type /Library/CasaTorch, and double-click "Uninstall CasaTorch".')]],
    windows: [[T('Settings › Apps › Installed apps › CasaTorch › Uninstall. If you installed it with PowerShell, run this as administrator instead:')], [null, "$env:CASATORCH_UNINSTALL='1'; irm https://casatorch.com/install.ps1 | iex"]],
    docker: [[T('Where your compose file is:')], [null, 'docker compose down -v'], [T('Leave out -v to keep the data volume.')]],
    'ha-addon': [[T('In Home Assistant: Settings › Add-ons › CasaTorch › Uninstall.')]],
    manual: [[T('Stop CasaTorch, then delete its folder.')]],
  };
  return (H[kind] || H.manual).map(([t, cmd]) => (cmd ? el('pre', { class: 'rm-cmd' }, el('code', {}, cmd)) : el('p', { class: 'small' }, t)));
}
async function removeCard(s) {
  if (s.demo) return null;
  const me = await api('/api/auth/me').catch(() => null);
  if (me && me.signIn !== false && me.user?.role !== 'owner') return null;
  return el('div', { class: 'card rm-card' }, el('h2', {}, T('Remove CasaTorch')),
    el('p', { class: 'small muted' }, T('Signs every phone and browser out, deletes your secure address and its names at casatorch.com, and can erase everything CasaTorch keeps on this computer. Then it shows how to uninstall the program.')),
    el('button', { class: 'btn danger', onclick: () => removeFlow(me) }, icon('trash', 14), T('Remove CasaTorch…')));
}
function removeFlow(me) {
  const body = el('div', { class: 'rm-flow' });
  const m = modal(body, { title: T('Remove CasaTorch') });
  const needPw = me && me.signIn !== false;
  const step1 = () => body.replaceChildren(
    el('p', {}, T('First, keep a copy? An encrypted backup brings everything back on this or another computer: settings, sign-ins, layouts, history and photos.')),
    el('div', { class: 'row wrap', style: 'gap:8px;justify-content:flex-end' },
      el('button', { class: 'btn', onclick: () => { m.remove(); const b = [...document.querySelectorAll('.card h2')].find((h) => h.textContent === T('Backup')); b?.scrollIntoView({ behavior: 'smooth', block: 'start' }); b?.closest('.card')?.querySelector('input')?.focus({ preventScroll: true }); } }, icon('download', 14), T('Make a backup first')),
      el('button', { class: 'btn primary', onclick: step2 }, T('Continue without a backup'))));
  const step2 = () => {
    const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: T('Your CasaTorch password') });
    const erase = el('input', { type: 'checkbox', style: 'width:auto' });
    const msg = el('p', { class: 'small bad', role: 'status', style: 'min-height:1.2em' });
    const go = el('button', { class: 'btn danger', onclick: async () => {
      go.disabled = true; msg.className = 'small muted'; msg.textContent = T('Removing… about 30 seconds.');
      try { const r = await post('/api/remove-casatorch', { password: pw.value, erase: erase.checked }); done(r); }
      catch (e) { msg.className = 'small bad'; msg.textContent = e.message; go.disabled = false; }
    } }, T('Remove CasaTorch'));
    body.replaceChildren(
      el('p', {}, T('This happens now:')),
      el('ul', { class: 'small rm-list' }, ['passes', 'secure-access', 'home-address', 'find', 'sign-out'].map((k) => el('li', {}, T(REMOVE_STEP[k])))),
      el('label', { class: 'row small', style: 'gap:8px;margin:8px 0' }, erase, el('span', {}, el('b', {}, T('Also erase everything on this computer')), el('br'), el('span', { class: 'muted' }, T('Settings, keys, layouts and history. Without this they stay, so installing again picks up where you left off.')))),
      needPw ? el('label', { class: 'field' }, el('span', {}, T('Confirm it\'s you')), pw) : null, msg,
      el('div', { class: 'row', style: 'gap:8px;justify-content:flex-end' }, el('button', { class: 'btn ghost', onclick: () => m.remove() }, T('Cancel')), go));
    if (needPw) setTimeout(() => pw.focus(), 50);
  };
  const done = (r) => {
    NET.clear();
    body.replaceChildren(
      el('p', {}, el('b', {}, r.ok ? T('CasaTorch is removed from your phones and from casatorch.com.') : T('Mostly done - one part didn\'t finish:'))),
      el('ul', { class: 'small rm-list' }, r.steps.map((x) => el('li', { class: x.ok ? 'good' : 'bad' }, x.ok ? '✓ ' : '✕ ', T(REMOVE_STEP[x.id] || x.id), x.skipped ? el('span', { class: 'muted' }, ` (${T('nothing to do')})`) : null, x.error ? el('span', { class: 'muted' }, ` - ${x.error}`) : null))),
      el('h3', {}, T('Uninstall the program')), ...uninstallHow(r.install),
      el('p', { class: 'small muted' }, r.erased ? T('This page stops working in a moment.') : T('This browser is signed out. Sign in again to keep using CasaTorch.')));
  };
  step1();
}
