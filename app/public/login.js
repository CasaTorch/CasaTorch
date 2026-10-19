/* CasaTorch sign-in: password -> (authenticator code | set up two-step sign-in) -> (accept terms) -> in.
   Also: invite links (pick your username and password) and Sign in with Google. */
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
/* The sign-in page in the home's language (the one this browser last used here; i18n.js keeps it). */
const T = (s, v) => (window.CasaI18n ? window.CasaI18n.T(s, v) : s);
const q = new URLSearchParams(location.search);
const nextUrl = (() => { const n = q.get('next') || ''; try { const u = new URL(n, location.origin); return n.startsWith('/') && u.origin === location.origin && !u.pathname.startsWith('/login') ? u.pathname + u.search + u.hash : '/'; } catch { return '/'; } })();   // only this CasaTorch's own pages
async function call(url, body) {
  const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ? (window.TM ? window.TM(j.error, j.msg, j.vars) : j.error) : T('Something went wrong - try again.')), { status: r.status });
  return j;
}
const view = $('#view');
const show = (...kids) => { view.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); const f = view.querySelector('input:not([type=checkbox])'); if (f) setTimeout(() => f.focus(), 30); };
const errBox = () => el('p', { class: 'err', role: 'alert' });
function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = on ? T('One moment…') : label; }
/* Where each answer leads. */
function after(r) {
  if (r.ok) { if (r.recovery) return showRecovery(r.recovery, () => { location.href = nextUrl; }); location.href = nextUrl; return; }
  if (r.step === 'mfa') return stepCode(r.ticket);
  if (r.step === 'enroll') return stepEnroll(r.ticket);
  if (r.step === 'terms') { if (r.recovery) return showRecovery(r.recovery, () => stepTerms(r.ticket)); return stepTerms(r.ticket); }
}
let STATE = {};

function stepPassword(message) {
  const u = el('input', { type: 'text', id: 'u', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const p = el('input', { type: 'password', id: 'p', autocomplete: 'current-password', required: true });
  const rem = el('input', { type: 'checkbox' }), err = errBox(), go = el('button', { class: 'btn', type: 'submit' }, T('Sign in'));
  if (message) err.textContent = message;
  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; busy(go, true, T('Sign in'));
    try { after(await call('/api/auth/login', { username: u.value, password: p.value, remember: rem.checked, next: nextUrl })); }
    catch (x) { err.textContent = x.message; p.value = ''; p.focus(); }
    finally { busy(go, false, T('Sign in')); }
  } }, el('label', { for: 'u' }, T('Username or e-mail')), u, el('label', { for: 'p' }, T('Password')), p,
  el('label', { class: 'check' }, rem, el('span', {}, T('Keep me signed in on this screen'))), err, go);
  show(el('h1', {}, T('Welcome home')), el('p', { class: 'sub' }, T('Sign in to your CasaTorch.')), form,
    STATE.google ? [el('div', { class: 'or' }, T('or')), el('a', { class: 'btn alt', href: `/api/auth/google/start${rem.checked ? '?remember=1' : ''}`, onclick: (e) => { e.currentTarget.href = `/api/auth/google/start${rem.checked ? '?remember=1' : ''}`; } }, googleMark(), T('Continue with Google'))] : null,
    el('p', { class: 'sub', style: 'margin:16px 0 0;font-size:13px' }, `${T('Forgot your password? Ask the owner of this CasaTorch to send you a new link.')} `, el('a', { href: '/recover.html' }, T('The owner and locked out?'))));   // recover.html: a one-time code from the box (80-support.js)
}
function stepCode(ticket) {
  let recovery = false;
  const c = el('input', { type: 'text', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*', 'aria-label': T('Code') });
  const err = errBox(), go = el('button', { class: 'btn', type: 'submit' }, T('Verify'));
  const toggle = el('button', { type: 'button', class: 'link', onclick: () => { recovery = !recovery; c.value = ''; if (recovery) c.removeAttribute('pattern'); else c.setAttribute('pattern', '[0-9]*'); c.className = recovery ? '' : 'code'; c.maxLength = recovery ? 11 : 6; c.inputMode = recovery ? 'text' : 'numeric'; c.placeholder = recovery ? 'xxxxx-xxxxx' : ''; toggle.textContent = recovery ? T('Use the code from my app') : T('Lost your phone? Use a recovery code'); c.focus(); } }, T('Lost your phone? Use a recovery code'));
  const submit = async (e) => {
    e?.preventDefault(); err.textContent = ''; busy(go, true, T('Verify'));
    try { after(await call('/api/auth/mfa', { ticket, code: c.value })); }
    catch (x) { err.textContent = x.message; c.value = ''; if (x.status === 401 && /long/.test(x.message)) setTimeout(() => stepPassword(), 1500); }
    finally { busy(go, false, T('Verify')); }
  };
  c.addEventListener('input', () => { if (!recovery && /^\d{6}$/.test(c.value)) submit(); });
  show(el('h1', {}, T('Two-step sign-in')), el('p', { class: 'sub' }, T('Enter the 6-digit code from your authenticator app.')), el('form', { onsubmit: submit }, c, err, go), toggle);
}
async function stepEnroll(ticket) {
  const err = errBox();
  let e; try { e = await call('/api/auth/enroll', { ticket }); } catch (x) { return stepPassword(x.message); }
  const qr = el('div', { class: 'qr' }); qr.innerHTML = e.qr;   // an SVG made by this CasaTorch
  const c = el('input', { type: 'text', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, 'aria-label': T('Code') });
  const go = el('button', { class: 'btn', type: 'submit' }, T('Turn on and continue'));
  show(el('h1', {}, T('Protect your account')), el('p', { class: 'sub' }, T('This CasaTorch asks everyone to use two-step sign-in. Scan the code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), then type the 6 digits it shows.')),
    qr, el('p', { class: 'secret' }, e.secret.replace(/(.{4})/g, '$1 ').trim()),
    el('form', { onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; busy(go, true, T('Turn on and continue')); try { after(await call('/api/auth/enroll', { ticket, code: c.value })); } catch (x) { err.textContent = x.message; c.value = ''; } finally { busy(go, false, T('Turn on and continue')); } } }, el('label', {}, T('Code from the app')), c, err, go));
}
function showRecovery(codes, then) {
  const ok = el('input', { type: 'checkbox' }), go = el('button', { class: 'btn', type: 'button', disabled: true, onclick: then }, T('Continue'));
  ok.addEventListener('change', () => { go.disabled = !ok.checked; });
  show(el('h1', {}, T('Save your recovery codes')), el('p', { class: 'sub' }, T('If you lose your phone, each of these lets you in once. Keep them somewhere safe - a password manager or printed in a drawer. They will not be shown again.')),
    el('div', { class: 'codes' }, codes.map((x) => el('span', {}, x))),
    el('button', { type: 'button', class: 'btn alt', onclick: () => { navigator.clipboard?.writeText(codes.join('\n')); } }, T('Copy them')),
    el('label', { class: 'check' }, ok, el('span', {}, T('I have saved my recovery codes'))), go);
}
async function stepTerms(ticket) {
  const ok = el('input', { type: 'checkbox' }), err = errBox(), go = el('button', { class: 'btn', type: 'button', disabled: true }, T('Agree and continue'));
  ok.addEventListener('change', () => { go.disabled = !ok.checked; });
  go.onclick = async () => { busy(go, true, T('Agree and continue')); try { const r = await call('/api/auth/terms', { ticket: ticket || undefined, accept: true }); if (r.ok && !ticket) { location.href = q.get('next') ? nextUrl : `/${location.hash}`; return; } after(r); } catch (x) { err.textContent = x.message; } finally { busy(go, false, T('Agree and continue')); } };
  /* Signed in already (no ticket): the terms were updated since this person last accepted them - one tap, nothing else changes. */
  show(el('h1', {}, ticket ? T('Terms of use') : T('We updated the terms')), el('p', { class: 'sub' }, ticket ? T('Please read and accept these to use CasaTorch.') : T('The Terms of Use and Privacy Notice were updated on October 17, 2026: clearer wording on Pro keys, renewals and refunds, and a fuller list of the services CasaTorch talks to. Please take a look and accept them once to carry on where you were.')), termsSummary(),
    el('label', { class: 'check' }, ok, el('span', {}, T('I have read and agree to the '), el('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, T('Terms of Use')), T(' and the '), el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, T('Privacy Notice')), '.')), err, go);
}
const termsSummary = () => el('div', { class: 'terms' },
  el('h3', {}, T('In short')),
  el('p', {}, T('CasaTorch runs on your own hardware. Your settings, floor plans, photos and device data stay on it; nothing is sent to us.')),
  el('p', {}, T('It shows and switches devices you connect. It is not a safety or security system: do not rely on it for alarms, smoke or leak warnings, medical needs or emergencies.')),
  el('p', {}, T('AI features, weather and other online services you turn on are provided by those services under their own terms, and may cost money.')),
  el('p', {}, T('Keep your password and recovery codes safe and only give accounts to people you trust with your home.')),
  el('p', {}, T('The software is provided as is, without warranties, to the extent the law allows.')));
async function stepInvite(token) {
  let inv; try { inv = await call(`/api/auth/invite?token=${encodeURIComponent(token)}`); } catch (x) { return stepPassword(x.message); }
  const u = el('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', value: inv.username || '' });
  const p = el('input', { type: 'password', autocomplete: 'new-password' }), p2 = el('input', { type: 'password', autocomplete: 'new-password' });
  const bar = el('i'), ok = el('input', { type: 'checkbox' }), err = errBox(), go = el('button', { class: 'btn', type: 'submit' }, inv.reset ? T('Set my new password') : T('Create my account'));
  p.addEventListener('input', () => { const s = strength(p.value); bar.style.width = `${s * 25}%`; bar.style.background = ['#f87171', '#f87171', '#fbbf24', '#34d399', '#34d399'][s]; });
  show(el('h1', {}, inv.reset ? T('Choose a new password') : T('Hi {name}', { name: inv.name || T('there') })), el('p', { class: 'sub' }, inv.reset ? T('Pick a new password for your CasaTorch account.') : T('You\'ve been invited to {house}. Pick a username and password.', { house: inv.house || T('a CasaTorch home') })),
    el('form', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (p.value !== p2.value) { err.textContent = T('The two passwords are different.'); return; }
      busy(go, true, go.textContent); try { after(await call('/api/auth/invite', { token, username: u.value, password: p.value, accept: ok.checked })); } catch (x) { err.textContent = x.message; } finally { busy(go, false, inv.reset ? T('Set my new password') : T('Create my account')); }
    } }, el('label', {}, T('Username')), u, el('label', {}, T('Password (10+ characters - a short sentence is great)')), p, el('div', { class: 'meter' }, bar), el('label', {}, T('Type it again')), p2,
    inv.reset ? null : termsSummary(),
    el('label', { class: 'check' }, ok, el('span', {}, T('I agree to the '), el('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, T('Terms of Use')), T(' and '), el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, T('Privacy Notice')), '.')), err, go));
}
const strength = (pw) => { let s = 0; if (pw.length >= 10) s++; if (pw.length >= 14) s++; if (/[a-z]/.test(pw) && /[A-Z0-9]/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw) || pw.split(' ').length > 2) s++; return Math.min(4, s); };
function googleMark() { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('class', 'g'); s.innerHTML = '<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>'; return s; }

const ERRORS = { 'google-unknown': 'That Google account is not on this CasaTorch. Ask the owner to add your e-mail first.', 'google-failed': 'Google sign-in did not work - try again.', 'google-state': 'That sign-in link expired - try again.', 'google-off': 'Google sign-in is not set up here.', panel: 'That wall-panel link is no longer valid.' };
/* The home's language even on a browser that never opened CasaTorch before (/api/lang needs no sign-in). */
async function pickLang() {
  try { const r = await fetch('/api/lang'); const { lang } = await r.json(); if (lang && window.CasaI18n) await window.CasaI18n.use(lang); } catch { /* offline: keep this browser's choice */ }
  for (const a of document.querySelectorAll('.legal a, .legal .lock')) a.textContent = T(a.textContent);
  document.title = T('Sign in - CasaTorch');
}
(async () => {
  await pickLang();
  try { STATE = await call('/api/auth/state'); } catch { STATE = {}; }
  if (STATE.house) $('#house').textContent = STATE.house;
  if (q.get('invite')) return stepInvite(q.get('invite'));
  if (q.get('ticket') && q.get('step')) return after({ step: q.get('step'), ticket: q.get('ticket') });
  if (q.get('step') === 'terms') return stepTerms(null);
  stepPassword(ERRORS[q.get('error')] ? T(ERRORS[q.get('error')]) : '');
})();
