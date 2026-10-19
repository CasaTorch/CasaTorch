/* CasaTorch: "I'm locked out" for the owner (80-support.js). CasaTorch writes a one-time reset code to a file on the
   box itself - only someone who can get to the box can read it, which is how it knows it's the owner. Then a new
   password (and, if the authenticator and recovery codes are lost too, two-step sign-in can be turned off). */
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
/* In the home's language (i18n.js; /api/lang needs no sign-in). */
const T = (s, v) => (window.CasaI18n ? window.CasaI18n.T(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));
async function call(url, body) {
  const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ? (window.TM ? window.TM(j.error, j.msg, j.vars) : j.error) : T('Something went wrong - try again.')), { status: r.status, body: j });
  return j;
}
const view = $('#view');
const show = (...kids) => { view.replaceChildren(...kids.flat().filter(Boolean)); const f = view.querySelector('input:not([type=checkbox])'); if (f && !view.contains(document.activeElement)) f.focus(); };   // at once, and never away from a field already being typed in (a late focus moved fast typing or a password manager's fill into the wrong field)
const back = () => el('p', { class: 'sub', style: 'margin:16px 0 0;font-size:13px' }, el('a', { href: '/login.html' }, T('Back to sign in')));
const WHERE = {
  addon: ['In Home Assistant: Settings › Add-ons › CasaTorch › Log.', 'It\'s also in the file owner-reset-code in the add-on\'s data folder.'],
  docker: ['In the container\'s log - in Portainer or your NAS app, open the CasaTorch container and its Logs.', 'It\'s also in the file owner-reset-code in the folder you gave CasaTorch for its data.'],
  linux: ['In the file owner-reset-code in CasaTorch\'s data folder on the box{folder}.', 'It\'s also in the box\'s system log for CasaTorch.'],
  windows: ['On the Windows computer CasaTorch runs on, open the file owner-reset-code in CasaTorch\'s data folder{folder}.', 'Open this page on that computer to see the folder.'],
  macos: ['On the Mac CasaTorch runs on, open the file owner-reset-code in CasaTorch\'s data folder{folder}.', 'Open this page on that Mac to see the folder.'],
  computer: ['On the computer CasaTorch runs on, open the file owner-reset-code in CasaTorch\'s data folder{folder}.', 'It\'s also in CasaTorch\'s log on that computer.'],
};
let ST = {};
function stepAsk(msg) {
  const err = el('p', { class: 'err', role: 'alert' }, msg || ''), go = el('button', { class: 'btn', type: 'button' }, T('Make a reset code'));
  const w = WHERE[ST.where] || WHERE.computer;
  go.onclick = async () => {
    go.disabled = true; err.textContent = '';
    try { await call('/api/auth/recover/start', {}); ST.pending = true; stepReset(); }
    catch (x) { err.textContent = x.message; go.disabled = false; }
  };
  show(el('h1', {}, T('Locked out?')),
    el('p', { class: 'sub' }, T('If you\'re the owner and can\'t sign in, CasaTorch can write a one-time reset code on the box itself. Only someone who can get to the box can read it - that\'s how it knows it\'s you.')),
    el('div', { class: 'terms', style: 'max-height:none' }, el('h3', {}, T('Where the code appears')), el('p', {}, T(w[0], { folder: ST.folder ? ` (${ST.folder})` : '' })), ST.folder && /Open this page/.test(w[1]) ? null : el('p', {}, T(w[1])), el('p', {}, T('It works once, for 30 minutes. Everyone signed in as the owner is signed out.'))),
    err, go,
    ST.pending ? el('button', { type: 'button', class: 'link', onclick: () => stepReset() }, T('I already have a code')) : null,
    el('p', { class: 'sub', style: 'margin:16px 0 0;font-size:13px' }, T('Not the owner? Ask the owner or an admin to send you a new link.')), back());
}
function stepReset() {
  const code = el('input', { type: 'text', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCDE-23456' });
  const user = el('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const p = el('input', { type: 'password', autocomplete: 'new-password' }), p2 = el('input', { type: 'password', autocomplete: 'new-password' });
  const off = el('input', { type: 'checkbox' }), err = el('p', { class: 'err', role: 'alert' }), go = el('button', { class: 'btn', type: 'submit' }, T('Set my new password'));
  const userRow = el('div', { hidden: ST.owners > 1 ? null : true }, el('label', {}, T('Owner\'s username')), user);
  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (p.value !== p2.value) { err.textContent = T('The two passwords are different.'); return; }
    go.disabled = true;
    try { const r = await call('/api/auth/recover/finish', { code: code.value, username: user.value || undefined, password: p.value, turnOff2fa: off.checked }); done(r); }
    catch (x) { err.textContent = x.message; if (x.body?.needUser) userRow.hidden = false; go.disabled = false; }
  } }, el('label', {}, T('Reset code')), code, userRow, el('label', {}, T('New password (10+ characters - a short sentence is great)')), p, el('label', {}, T('Type it again')), p2,
  el('label', { class: 'check' }, off, el('span', {}, T('Also turn off two-step sign-in (only if you lost your authenticator app and your recovery codes)'))), err, go);
  show(el('h1', {}, T('Choose a new password')),
    el('p', { class: 'sub' }, T('A reset code is waiting on the box. Type it here, then pick a new password for the owner.')), form,
    el('button', { type: 'button', class: 'link', onclick: () => stepAsk() }, T('Where do I find the code?')), back());
}
function done(r) {
  show(el('h1', {}, T('Done')), el('p', { class: 'sub' }, T('The password for {username} is changed. Every device that was signed in as the owner was signed out.', { username: r.username })),
    r.twoStepOff ? el('p', { class: 'sub' }, T('Two-step sign-in is off for now - turn it on again in Settings › People & sign-in.')) : null,
    el('a', { class: 'btn', href: '/login.html', style: 'display:block;text-align:center;text-decoration:none' }, T('Sign in')));
}
(async () => {
  try { const r = await fetch('/api/lang'); const { lang } = await r.json(); if (lang && window.CasaI18n) await window.CasaI18n.use(lang); } catch { /* keep this browser's choice */ }
  for (const a of document.querySelectorAll('.legal a, .legal .lock')) a.textContent = T(a.textContent);
  document.title = T('Locked out - CasaTorch');
  try { const s = await call('/api/auth/state'); if (s.house) $('#house').textContent = s.house; } catch { /* fine */ }
  try { ST = await call('/api/auth/recover/state'); } catch { ST = {}; }
  if (ST.away) return show(el('h1', {}, T('Locked out?')), el('p', { class: 'sub' }, T('For safety, resetting the owner\'s password only works on your home network. Connect to your home Wi-Fi and open CasaTorch there.')), back());
  if (ST.available === false) return show(el('h1', {}, T('Locked out?')), el('p', { class: 'sub' }, T('Sign-in is off on this CasaTorch - just open it.')), el('a', { class: 'btn', href: '/', style: 'display:block;text-align:center;text-decoration:none' }, T('Open CasaTorch')));
  stepAsk();
})();
