/* HouseOS sign-in: password -> (authenticator code | set up two-step sign-in) -> (accept terms) -> in.
   Also: invite links (pick your username and password) and Sign in with Google. */
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const q = new URLSearchParams(location.search);
const nextUrl = (() => { const n = q.get('next'); return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/'; })();
async function call(url, body) {
  const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong - try again.'), { status: r.status });
  return j;
}
const view = $('#view');
const show = (...kids) => { view.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); const f = view.querySelector('input:not([type=checkbox])'); if (f) setTimeout(() => f.focus(), 30); };
const errBox = () => el('p', { class: 'err', role: 'alert' });
function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = on ? 'One moment…' : label; }
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
  const rem = el('input', { type: 'checkbox' }), err = errBox(), go = el('button', { class: 'btn', type: 'submit' }, 'Sign in');
  if (message) err.textContent = message;
  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; busy(go, true, 'Sign in');
    try { after(await call('/api/auth/login', { username: u.value, password: p.value, remember: rem.checked, next: nextUrl })); }
    catch (x) { err.textContent = x.message; p.value = ''; p.focus(); }
    finally { busy(go, false, 'Sign in'); }
  } }, el('label', { for: 'u' }, 'Username or e-mail'), u, el('label', { for: 'p' }, 'Password'), p,
  el('label', { class: 'check' }, rem, el('span', {}, 'Keep me signed in on this screen')), err, go);
  show(el('h1', {}, 'Welcome home'), el('p', { class: 'sub' }, 'Sign in to your HouseOS.'), form,
    STATE.google ? [el('div', { class: 'or' }, 'or'), el('a', { class: 'btn alt', href: `/api/auth/google/start${rem.checked ? '?remember=1' : ''}`, onclick: (e) => { e.currentTarget.href = `/api/auth/google/start${rem.checked ? '?remember=1' : ''}`; } }, googleMark(), 'Continue with Google')] : null,
    el('p', { class: 'sub', style: 'margin:16px 0 0;font-size:13px' }, 'Forgot your password? Ask the owner of this HouseOS to send you a new link.'));
}
function stepCode(ticket) {
  let recovery = false;
  const c = el('input', { type: 'text', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*', 'aria-label': 'Code' });
  const err = errBox(), go = el('button', { class: 'btn', type: 'submit' }, 'Verify');
  const toggle = el('button', { type: 'button', class: 'link', onclick: () => { recovery = !recovery; c.value = ''; c.className = recovery ? '' : 'code'; c.maxLength = recovery ? 11 : 6; c.inputMode = recovery ? 'text' : 'numeric'; c.placeholder = recovery ? 'xxxxx-xxxxx' : ''; toggle.textContent = recovery ? 'Use the code from my app' : 'Lost your phone? Use a recovery code'; c.focus(); } }, 'Lost your phone? Use a recovery code');
  const submit = async (e) => {
    e?.preventDefault(); err.textContent = ''; busy(go, true, 'Verify');
    try { after(await call('/api/auth/mfa', { ticket, code: c.value })); }
    catch (x) { err.textContent = x.message; c.value = ''; if (x.status === 401 && /long/.test(x.message)) setTimeout(() => stepPassword(), 1500); }
    finally { busy(go, false, 'Verify'); }
  };
  c.addEventListener('input', () => { if (!recovery && /^\d{6}$/.test(c.value)) submit(); });
  show(el('h1', {}, 'Two-step sign-in'), el('p', { class: 'sub' }, 'Enter the 6-digit code from your authenticator app.'), el('form', { onsubmit: submit }, c, err, go), toggle);
}
async function stepEnroll(ticket) {
  const err = errBox();
  let e; try { e = await call('/api/auth/enroll', { ticket }); } catch (x) { return stepPassword(x.message); }
  const qr = el('div', { class: 'qr' }); qr.innerHTML = e.qr;   // an SVG made by this HouseOS
  const c = el('input', { type: 'text', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, 'aria-label': 'Code' });
  const go = el('button', { class: 'btn', type: 'submit' }, 'Turn on and continue');
  show(el('h1', {}, 'Protect your account'), el('p', { class: 'sub' }, 'This HouseOS asks everyone to use two-step sign-in. Scan the code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), then type the 6 digits it shows.'),
    qr, el('p', { class: 'secret' }, e.secret.replace(/(.{4})/g, '$1 ').trim()),
    el('form', { onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ''; busy(go, true, 'Turn on and continue'); try { after(await call('/api/auth/enroll', { ticket, code: c.value })); } catch (x) { err.textContent = x.message; c.value = ''; } finally { busy(go, false, 'Turn on and continue'); } } }, el('label', {}, 'Code from the app'), c, err, go));
}
function showRecovery(codes, then) {
  const ok = el('input', { type: 'checkbox' }), go = el('button', { class: 'btn', type: 'button', disabled: true, onclick: then }, 'Continue');
  ok.addEventListener('change', () => { go.disabled = !ok.checked; });
  show(el('h1', {}, 'Save your recovery codes'), el('p', { class: 'sub' }, 'If you lose your phone, each of these lets you in once. Keep them somewhere safe - a password manager or printed in a drawer. They will not be shown again.'),
    el('div', { class: 'codes' }, codes.map((x) => el('span', {}, x))),
    el('button', { type: 'button', class: 'btn alt', onclick: () => { navigator.clipboard?.writeText(codes.join('\n')); } }, 'Copy them'),
    el('label', { class: 'check' }, ok, el('span', {}, 'I have saved my recovery codes')), go);
}
async function stepTerms(ticket) {
  const ok = el('input', { type: 'checkbox' }), err = errBox(), go = el('button', { class: 'btn', type: 'button', disabled: true }, 'Agree and continue');
  ok.addEventListener('change', () => { go.disabled = !ok.checked; });
  go.onclick = async () => { busy(go, true, 'Agree and continue'); try { const r = await call('/api/auth/terms', { ticket: ticket || undefined, accept: true }); if (r.ok && !ticket) { location.href = nextUrl; return; } after(r); } catch (x) { err.textContent = x.message; } finally { busy(go, false, 'Agree and continue'); } };
  show(el('h1', {}, 'Terms of use'), el('p', { class: 'sub' }, 'Please read and accept these to use HouseOS.'), termsSummary(),
    el('label', { class: 'check' }, ok, el('span', {}, 'I have read and agree to the ', el('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, 'Terms of Use'), ' and the ', el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy Notice'), '.')), err, go);
}
const termsSummary = () => el('div', { class: 'terms' },
  el('h3', {}, 'In short'),
  el('p', {}, 'HouseOS runs on your own hardware. Your settings, floor plans, photos and device data stay on it; nothing is sent to us.'),
  el('p', {}, 'It shows and switches devices you connect. It is not a safety or security system: do not rely on it for alarms, smoke or leak warnings, medical needs or emergencies.'),
  el('p', {}, 'AI features, weather and other online services you turn on are provided by those services under their own terms, and may cost money.'),
  el('p', {}, 'Keep your password and recovery codes safe and only give accounts to people you trust with your home.'),
  el('p', {}, 'The software is provided as is, without warranties, to the extent the law allows.'));
async function stepInvite(token) {
  let inv; try { inv = await call(`/api/auth/invite?token=${encodeURIComponent(token)}`); } catch (x) { return stepPassword(x.message); }
  const u = el('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', value: inv.username || '' });
  const p = el('input', { type: 'password', autocomplete: 'new-password' }), p2 = el('input', { type: 'password', autocomplete: 'new-password' });
  const bar = el('i'), ok = el('input', { type: 'checkbox' }), err = errBox(), go = el('button', { class: 'btn', type: 'submit' }, inv.reset ? 'Set my new password' : 'Create my account');
  p.addEventListener('input', () => { const s = strength(p.value); bar.style.width = `${s * 25}%`; bar.style.background = ['#f87171', '#f87171', '#fbbf24', '#34d399', '#34d399'][s]; });
  show(el('h1', {}, inv.reset ? 'Choose a new password' : `Hi ${inv.name || 'there'}`), el('p', { class: 'sub' }, inv.reset ? 'Pick a new password for your HouseOS account.' : `You've been invited to ${inv.house || 'a HouseOS home'}. Pick a username and password.`),
    el('form', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (p.value !== p2.value) { err.textContent = 'The two passwords are different.'; return; }
      busy(go, true, go.textContent); try { after(await call('/api/auth/invite', { token, username: u.value, password: p.value, accept: ok.checked })); } catch (x) { err.textContent = x.message; } finally { busy(go, false, inv.reset ? 'Set my new password' : 'Create my account'); }
    } }, el('label', {}, 'Username'), u, el('label', {}, 'Password (10+ characters - a short sentence is great)'), p, el('div', { class: 'meter' }, bar), el('label', {}, 'Type it again'), p2,
    inv.reset ? null : termsSummary(),
    el('label', { class: 'check' }, ok, el('span', {}, 'I agree to the ', el('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, 'Terms of Use'), ' and ', el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy Notice'), '.')), err, go));
}
const strength = (pw) => { let s = 0; if (pw.length >= 10) s++; if (pw.length >= 14) s++; if (/[a-z]/.test(pw) && /[A-Z0-9]/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw) || pw.split(' ').length > 2) s++; return Math.min(4, s); };
function googleMark() { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('class', 'g'); s.innerHTML = '<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>'; return s; }

const ERRORS = { 'google-unknown': 'That Google account is not on this HouseOS. Ask the owner to add your e-mail first.', 'google-failed': 'Google sign-in did not work - try again.', 'google-state': 'That sign-in link expired - try again.', 'google-off': 'Google sign-in is not set up here.', panel: 'That wall-panel link is no longer valid.' };
(async () => {
  try { STATE = await call('/api/auth/state'); } catch { STATE = {}; }
  if (STATE.house) $('#house').textContent = STATE.house;
  if (q.get('invite')) return stepInvite(q.get('invite'));
  if (q.get('ticket') && q.get('step')) return after({ step: q.get('step'), ticket: q.get('ticket') });
  if (q.get('step') === 'terms') return stepTerms(null);
  stepPassword(ERRORS[q.get('error')] || '');
})();
