/* ======================================================================
 * The CasaTorch app for iPhone, iPad and Android.
 *  - Settings › Phones & alerts › "Add a phone": a QR code (one use, ten
 *    minutes) the app scans to sign in to this home - no typing on the phone.
 *    Only for accounts with two-step sign-in, from a screen that used it.
 *  - Inside the app (window.CasaNative is there): this phone's alerts, Face ID,
 *    switching homes, signing this phone out; the screen fits the phone (safe
 *    areas, the bar along the bottom, pull to refresh, haptics).
 * Everything stays between the phone and this CasaTorch: no CasaTorch cloud
 * account. Alerts are encrypted here, readable only by the phone.
 * ====================================================================== */
const N = () => window.CasaNative || null;
if (N()) {
  document.documentElement.classList.add('in-app', `in-app-${N().platform || 'phone'}`);
  window.casatorchRefresh = () => { loadStatus(); return runRefresh(); };   // pull to refresh (the app calls this)
}
document.addEventListener('click', (e) => { if (N() && e.target.closest('button, a.btn, .dev, .chip')) try { N().haptic('light'); } catch { /* fine */ } }, { capture: true, passive: true });
async function appCards() {
  const me = await api('/api/auth/me').catch(() => null);
  if (!me || me.user?.panel) return [];
  const out = [];
  if (N()) out.push(await thisPhoneCard());
  if (me.signIn !== false) out.push(pairCard(me));
  else out.push(el('div', { class: 'card' }, el('h2', {}, icon('phone', 15), T('The CasaTorch app')), el('p', { class: 'small muted' }, T('The app for iPhone, iPad and Android signs in to your own CasaTorch - set up sign-in on a real install (the demo has no accounts).'))));
  return out;
}
function pairCard(me) {
  const box = el('div');
  const has2 = me.user?.twoStep;
  const go = el('button', { class: 'btn primary', disabled: has2 ? null : true }, icon('plus', 14), T('Add a phone'));
  go.onclick = async () => {
    go.disabled = true;
    try {
      const r = await post('/api/app/pair', {});
      let left = Math.round((Date.parse(r.expires) - Date.now()) / 1000);
      const timer = el('span', { class: 'tiny muted' });
      const tick = setInterval(() => { left--; timer.textContent = left > 0 ? T('Works for {time} more', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }) : T('This code ran out - make a new one.'); if (left <= 0 || !timer.isConnected) clearInterval(tick); }, 1000);
      box.replaceChildren(el('div', { class: 'pair' }, el('div', { class: 'pair-qr', html: r.qr }), el('div', {},
        el('ol', { class: 'small', style: 'padding-left:18px;margin:0 0 10px' }, el('li', {}, T('Open the CasaTorch app on the phone.')), el('li', {}, T('Tap '), el('b', {}, T('Scan a pairing code')), T(' and point it at this code.')), el('li', {}, T('Turn on Face ID and alerts when it asks.'))),
        el('div', { class: 'small muted' }, T('Or type this code in the app:')), el('div', { class: 'pair-code' }, r.code), timer,
        el('div', { class: 'row wrap', style: 'margin-top:10px' }, el('button', { class: 'btn small ghost', onclick: () => { clearInterval(tick); box.replaceChildren(); go.disabled = false; } }, T('Done'))))));
    } catch (e) { toast(e.message, 6000); go.disabled = false; }
  };
  const phones = (me.sessions || []).filter((s) => s.kind === 'app');
  return el('div', { class: 'card' }, el('h2', {}, icon('phone', 15), T('The CasaTorch app')),
    el('p', { class: 'small muted', style: 'margin-top:0' }, T('All of CasaTorch on your iPhone, iPad or Android phone - controls, cameras, the 3D home, alerts - signed in to this home only, behind Face ID or your fingerprint. There\'s no CasaTorch account: the app talks to your CasaTorch, at home or (with secure access) from anywhere.')),
    has2 ? null : el('p', { class: 'small', style: 'color:var(--warn)' }, T('Turn on two-step sign-in for your account first (People & sign-in) - the app requires it.')),
    el('div', { class: 'row wrap' }, go, el('a', { class: 'btn', href: 'https://casatorch.com/docs/use/mobile-app.html', target: '_blank', rel: 'noopener' }, T('How the app works'))),
    box,
    phones.length ? el('h3', { class: 'sub' }, T('Your phones')) : null,
    ...phones.map((s) => el('div', { class: 'row between', style: 'gap:8px;margin:6px 0' }, el('span', {}, s.agent || T('Phone'), el('small', { class: 'muted' }, ` · ${T('last used {ago}', { ago: fmtWhen(s.seen) })}`)),
      s.current ? el('span', { class: 'pill good' }, T('This phone')) : el('button', { class: 'btn small ghost', onclick: async () => { await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' }).catch((e) => toast(e.message)); show('settings/phones'); } }, T('Sign out')))));
}
/* Inside the app: this phone. */
async function thisPhoneCard() {
  const n = N(), card = el('div', { class: 'card' }, el('h2', {}, icon('phone', 15), T('This phone'))), body = el('div'); card.append(body);
  const draw = async () => {
    const [me, bio] = await Promise.all([api('/api/app/me').catch(() => null), n.biometrics().catch(() => ({ available: false }))]);
    const p = me?.push || { on: false };
    const level = el('select', { 'aria-label': T('Which alerts') }, ...[['critical', T('Only critical (water, smoke, internet down)')], ['important', T('Important (also offline devices, the doorbell)')], ['all', T('Everything')]].map(([v, l]) => el('option', { value: v, selected: (p.level || 'important') === v ? true : null }, l)));
    const bioName = { faceID: 'Face ID', touchID: 'Touch ID', opticID: 'Optic ID', fingerprint: T('fingerprint'), face: T('face unlock') }[bio.type] || 'Face ID';
    const lock = el('input', { type: 'checkbox', checked: bio.enabled ? true : null, disabled: bio.available ? null : true, onchange: async (e) => { try { const ok = await n.setBiometricLock(e.target.checked); if (!ok) e.target.checked = !e.target.checked; else toast(e.target.checked ? T('{bioName} is on', { bioName }) : T('{bioName} is off', { bioName })); } catch (x) { e.target.checked = !e.target.checked; toast(x.message); } } });
    body.replaceChildren(
      el('dl', { class: 'kv' }, el('dt', {}, T('Phone')), el('dd', {}, me?.device?.name || T('This phone')), el('dt', {}, T('Signed in as')), el('dd', {}, me?.user?.name || me?.user?.username || '-'), el('dt', {}, T('Home')), el('dd', {}, me?.home?.name || '-')),
      el('label', { class: 'field check' }, lock, el('span', {}, el('b', {}, T('Unlock with {bioName}', { bioName })), el('span', { class: 'small muted', style: 'display:block' }, bio.available ? T('Asked when the app opens, and after a few minutes away.') : T('Set it up in your phone\'s settings first.')))),
      el('h3', { class: 'sub' }, T('Alerts on this phone')),
      p.on ? el('p', { class: 'small good' }, T('✓ Alerts are on. They\'re encrypted on your CasaTorch - only this phone can read them.')) : el('p', { class: 'small muted' }, T('Water, smoke, the doorbell, a device going offline, your reminders - on this phone, even when the app is closed.')),
      el('label', { class: 'field' }, el('span', {}, T('Send')), level),
      el('div', { class: 'row wrap', style: 'gap:8px' },
        p.on ? el('button', { class: 'btn small', onclick: () => post('/api/app/push/test', {}).then(() => toast(T('Sent - it should arrive in a few seconds.'))).catch((e) => toast(e.message, 5000)) }, T('Send a test'))
          : el('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; try { const r = await n.pushEnable(); await post('/api/app/push', { ...r, level: level.value }); await post('/api/app/push/test', {}).catch(() => {}); toast(T('Alerts are on - a test alert is on its way.'), 4000); } catch (x) { toast(x.message, 6000); } draw(); } }, icon('bell', 14), T('Turn on alerts')),
        p.on ? el('button', { class: 'btn small ghost', onclick: () => api('/api/app/push', { method: 'DELETE' }).then(draw) }, T('Turn off')) : null),
      el('h3', { class: 'sub' }, T('Homes')),
      el('div', { class: 'row wrap', style: 'gap:8px' }, el('button', { class: 'btn', onclick: () => n.switchHome() }, T('Switch or add a home')),
        el('button', { class: 'btn ghost', onclick: async () => { await post('/api/app/signout', {}).catch(() => {}); n.signOut(); } }, T('Sign this phone out'))));
    level.onchange = () => { if (p.on) post('/api/app/push', { level: level.value }, 'PUT').then(() => toast(T('Saved'))).catch((e) => toast(e.message)); };
  };
  await draw(); return card;
}
