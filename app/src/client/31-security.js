/* ======================================================================
 * Settings > Security: my account (password, two-step sign-in, recovery
 * codes, where I'm signed in) and, for admins, people, wall-panel links,
 * the two-step policy, Sign in with Google, and the security log.
 * ====================================================================== */
const secAgo = (iso) => { if (!iso) return '-'; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const browserOf = (ua = '') => `${/iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'} · ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'}`;
/* A link to hand to someone: shown in a box they can copy (the clipboard needs https, so select-all works everywhere). */
function linkBox(link, note) {
  const inp = el('input', { type: 'text', readonly: true, value: link, onclick: (e) => e.target.select() });
  return el('div', { class: 'linkbox' }, el('p', { class: 'small' }, note), el('div', { class: 'row' }, inp, el('button', { class: 'btn', onclick: () => { inp.select(); try { navigator.clipboard?.writeText(link); } catch { /* selected anyway */ } document.execCommand?.('copy'); toast('Copied'); } }, 'Copy')));
}
const fillCard = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const pill = (txt, cls = '') => el('span', { class: `pill ${cls}` }, txt);
function codesBox(codes) {
  return el('div', { class: 'linkbox' }, el('p', { class: 'small' }, 'Recovery codes - each signs you in once if you lose your phone. Save them now; they will not be shown again.'),
    el('div', { class: 'codes' }, codes.map((c) => el('code', {}, c))));
}

function accountCard(me) {
  const u = me.user, box = el('div', { class: 'card' });
  const draw = () => {
    /* password */
    const cur = el('input', { type: 'password', autocomplete: 'current-password' }), nw = el('input', { type: 'password', autocomplete: 'new-password' });
    const pwBtn = el('button', { class: 'btn', onclick: async () => { try { await post('/api/auth/password', { current: cur.value, next: nw.value }); toast('Password changed - other screens were signed out'); cur.value = nw.value = ''; } catch (e) { toast(e.message, 4000); } } }, 'Change password');
    /* two-step */
    const tsa = el('div', { class: 'tsa' });
    const tsaOff = () => tsa.replaceChildren(
      el('p', { class: 'small muted' }, 'Two-step sign-in asks for a 6-digit code from an app on your phone after your password - so a stolen password alone is not enough.'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          const e = await post('/api/auth/2fa/start', {});
          const qr = el('div', { class: 'qr' }); qr.innerHTML = e.qr;   // SVG made by this CasaTorch
          const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '123456', class: 'code' });
          tsa.replaceChildren(el('p', { class: 'small' }, '1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).'), qr,
            el('p', { class: 'small muted mono' }, `Can't scan? Enter: ${e.secret.replace(/(.{4})/g, '$1 ').trim()}`),
            el('label', { class: 'field' }, el('span', {}, '2. Type the 6-digit code it shows'), code),
            el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/api/auth/2fa/enable', { code: code.value }); u.twoStep = true; me.recoveryLeft = 10; draw(); box.querySelector('.tsa').append(codesBox(r.recovery)); toast('Two-step sign-in is on'); } catch (x) { toast(x.message, 4000); } } }, 'Turn on'), el('button', { class: 'btn ghost', onclick: tsaOff }, 'Cancel')));
        } catch (x) { toast(x.message, 4000); }
      } }, icon('lock'), 'Turn on two-step sign-in'));
    const tsaOn = () => {
      const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password' }), code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'Code from the app' });
      tsa.replaceChildren(el('p', { class: 'small' }, pill('On', 'good'), ` Recovery codes left: ${me.recoveryLeft ?? '-'}`),
        el('div', { class: 'row wrap' }, pw, code),
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn', onclick: async () => { try { const r = await post('/api/auth/2fa/recovery', { password: pw.value }); me.recoveryLeft = 10; tsaOn(); tsa.append(codesBox(r.recovery)); } catch (x) { toast(x.message, 4000); } } }, 'New recovery codes'),
          me.policy?.require2fa ? null : el('button', { class: 'btn ghost', onclick: async () => { try { await post('/api/auth/2fa/disable', { password: pw.value, code: code.value }); u.twoStep = false; draw(); toast('Two-step sign-in is off'); } catch (x) { toast(x.message, 4000); } } }, 'Turn off')),
        el('p', { class: 'small muted' }, 'New recovery codes need your password; turning it off needs your password and a code.'));
    };
    u.twoStep ? tsaOn() : tsaOff();
    /* sessions */
    const sess = el('div', { class: 'sessions' }, (me.sessions || []).sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.seen.localeCompare(a.seen)).map((s) => el('div', { class: 'sess' },
      icon(s.kind === 'panel' ? 'home' : 'lock'), el('div', {}, el('b', {}, browserOf(s.agent)), el('div', { class: 'small muted' }, `${s.ip || '-'} · last used ${secAgo(s.seen)}${s.current ? ' · this screen' : ''}`)),
      s.current ? pill('This screen', 'good') : el('button', { class: 'btn ghost sm', onclick: async () => { try { await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' }); me.sessions = me.sessions.filter((x) => x !== s); draw(); } catch (x) { toast(x.message); } } }, 'Sign out'))));
    fillCard(box, el('h2', {}, icon('lock'), T('Your account & security')),
      el('div', { class: 'acct' }, el('div', { class: 'avatar' }, (u.name || u.username || '?').slice(0, 1).toUpperCase()), el('div', {}, el('b', {}, u.name || u.username), el('div', { class: 'small muted' }, `${u.username} · ${u.role}${u.email ? ` · ${u.email}` : ''}${me.google?.linked ? ' · Google linked' : ''}`))),
      el('h3', {}, 'Two-step sign-in'), tsa,
      el('h3', {}, 'Password'), el('div', { class: 'row wrap' }, el('label', { class: 'field grow' }, el('span', {}, 'Current'), cur), el('label', { class: 'field grow' }, el('span', {}, 'New (10+ characters)'), nw)), pwBtn,
      el('h3', {}, 'Where you are signed in'), sess,
      el('div', { class: 'row wrap', style: 'margin-top:10px' },
        (me.sessions || []).length > 1 ? el('button', { class: 'btn', onclick: async () => { await post('/api/auth/sessions/others', {}); me.sessions = me.sessions.filter((s) => s.current); draw(); toast('Signed out everywhere else'); } }, 'Sign out everywhere else') : null,
        el('button', { class: 'btn ghost', onclick: async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login.html'; } }, 'Sign out')));
  };
  draw(); return box;
}

function peopleCard(data, me) {
  const box = el('div', { class: 'card wide' }), ROLE_TXT = { owner: 'Owner - everything', admin: 'Admin - settings and people', member: 'Member - can switch things', viewer: 'Viewer - can only look' };
  const roleSel = (v, onchange, allowOwner) => el('select', { onchange }, ...data.roles.filter((r) => allowOwner || r !== 'owner' || v === 'owner').map((r) => el('option', { value: r, selected: r === v ? true : null }, ROLE_TXT[r])));
  const draw = (extra) => {
    const name = el('input', { type: 'text', placeholder: 'Name' }), email = el('input', { type: 'email', placeholder: 'E-mail (for Google sign-in, optional)' });
    let role = 'member'; const rs = roleSel(role, (e) => { role = e.target.value; }, me.user.role === 'owner');
    const rows = data.users.map((u) => el('div', { class: 'person' },
      el('div', { class: 'avatar sm' }, (u.name || '?').slice(0, 1).toUpperCase()),
      el('div', { class: 'grow' }, el('b', {}, u.name), el('div', { class: 'small muted' }, `${u.username}${u.email ? ` · ${u.email}` : ''} · ${u.invited ? 'invite not used yet' : `last in ${secAgo(u.lastLogin)}`}`),
        el('div', { class: 'row wrap gap4' }, u.twoStep ? pill('2-step', 'good') : pill('no 2-step', 'warn'), u.google ? pill('Google') : null)),
      u.id === me.user.id ? pill('You') : el('div', { class: 'row wrap gap4' },
        roleSel(u.role, async (e) => { try { await post(`/api/users/${u.id}`, { role: e.target.value }, 'PUT'); u.role = e.target.value; toast('Saved'); } catch (x) { toast(x.message, 4000); e.target.value = u.role; } }, me.user.role === 'owner'),
        el('button', { class: 'btn ghost sm', title: 'New sign-in link (resets their password and 2-step)', onclick: async () => { if (!confirm(`Reset ${u.name}'s password? They get a new link to set one, and are signed out everywhere.`)) return; try { const r = await post(`/api/users/${u.id}/reset`, {}); draw(linkBox(r.link, `Send this to ${u.name} - it works once, for 7 days.`)); } catch (x) { toast(x.message, 4000); } } }, 'Reset'),
        u.role === 'owner' ? null : el('button', { class: 'btn ghost sm danger', onclick: async () => { if (!confirm(`Remove ${u.name}? They are signed out everywhere.`)) return; try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); data.users = data.users.filter((x) => x !== u); draw(); } catch (x) { toast(x.message, 4000); } } }, 'Remove'))));
    const panels = (data.panels || []).map((p) => el('div', { class: 'person' }, icon('home'), el('div', { class: 'grow' }, el('b', {}, p.name), el('div', { class: 'small muted' }, `${p.role === 'member' ? 'can switch things' : 'view only'} · last used ${secAgo(p.lastUsed)}`)),
      el('button', { class: 'btn ghost sm danger', onclick: async () => { if (!confirm(`Revoke ${p.name}? That screen is signed out.`)) return; await api(`/api/auth/admin/panels/${p.id}`, { method: 'DELETE' }); data.panels = data.panels.filter((x) => x !== p); draw(); } }, 'Revoke')));
    const pname = el('input', { type: 'text', placeholder: 'Kitchen panel' }), prole = el('select', {}, el('option', { value: 'viewer' }, 'View only'), el('option', { value: 'member' }, 'Can switch things'));
    fillCard(box, el('h2', {}, icon('home'), T('People')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, 'Everyone gets their own sign-in. Nobody can sign up on their own: add them here and send them their link.'),
      ...rows, extra || null,
      el('h3', {}, 'Add someone'), el('div', { class: 'row wrap' }, name, email), el('div', { class: 'row wrap' }, rs,
        el('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/api/users', { name: name.value, email: email.value, role }); data.users.push(r.user); draw(linkBox(r.link, `Send this to ${r.user.name} - they pick a username and password. It works once, for 7 days.`)); } catch (x) { toast(x.message, 4000); } } }, icon('plus'), 'Add and get invite link')),
      el('h3', {}, 'Wall panels'), el('p', { class: 'small muted' }, 'A link that signs a wall tablet in for a year, as a panel - not as a person. Revoke it any time.'),
      ...panels, el('div', { class: 'row wrap' }, pname, prole, el('button', { class: 'btn', onclick: async () => { try { const r = await post('/api/auth/admin/panels', { name: pname.value || 'Wall panel', role: prole.value }); data.panels = (await api('/api/users')).panels; draw(linkBox(r.link, 'Open this once on the wall tablet. Treat it like a key - anyone with it can view your home.')); } catch (x) { toast(x.message, 4000); } } }, 'Make a panel link')));
  };
  draw(); return box;
}

async function securityAdminCard(data, me) {
  const box = el('div', { class: 'card wide' });
  let events = []; try { events = (await api('/api/auth/admin/audit')).events; } catch { /* none */ }
  const LABEL = { 'signed-in': 'Signed in', 'login-failed': 'Wrong password', 'login-limited': 'Too many tries - paused', 'code-failed': 'Wrong 2-step code', 'signed-out': 'Signed out', '2fa-on': 'Turned on 2-step', '2fa-off': 'Turned off 2-step', 'password-changed': 'Changed password', 'user-added': 'Added a person', 'user-removed': 'Removed a person', 'user-reset': 'Reset a password', 'role-changed': 'Changed a role', 'invite-accepted': 'Accepted an invite', 'terms-accepted': 'Accepted the terms', 'policy-changed': 'Changed 2-step policy', 'google-on': 'Set up Google sign-in', 'google-off': 'Turned off Google sign-in', 'google-unknown': 'Unknown Google account tried', 'google-linked': 'Linked Google', 'panel-link-made': 'Made a panel link', 'panel-link-revoked': 'Revoked a panel link', 'panel-signed-in': 'Panel signed in', 'recovery-code-used': 'Used a recovery code', 'session-ended': 'Ended a session', 'owner-saved': 'Owner account saved' };
  const bad = new Set(['login-failed', 'login-limited', 'code-failed', 'google-unknown']);
  const req2 = el('input', { type: 'checkbox', checked: data.policy?.require2fa ? true : null, onchange: async (e) => { try { await post('/api/auth/admin/policy', { require2fa: e.target.checked }, 'PUT'); toast(e.target.checked ? 'Everyone now needs two-step sign-in' : 'Two-step sign-in is optional'); } catch (x) { e.target.checked = !e.target.checked; toast(x.message, 5000); } } });
  const cid = el('input', { type: 'text', placeholder: '1234-abc.apps.googleusercontent.com', value: data.google?.clientId || '' }), csec = el('input', { type: 'password', placeholder: data.google?.hasSecret ? 'Saved - leave empty to keep' : 'Client secret', autocomplete: 'off' });
  const redirect = `${location.origin}/api/auth/google/callback`;
  fillCard(box, el('h2', {}, icon('lock'), T('Sign-in & security log')),
    el('label', { class: 'check' }, req2, el('span', {}, el('b', {}, 'Require two-step sign-in for everyone'), el('div', { class: 'small muted' }, 'People without it set it up the next time they sign in.'))),
    el('h3', {}, 'Sign in with Google'),
    el('p', { class: 'small muted' }, 'Lets the people you added sign in with their Google account (matched by e-mail). In Google Cloud Console > APIs & Services > Credentials, create an OAuth client ID (Web application) and add this redirect URI. Google only accepts https addresses or localhost - use your secure remote-access address if you have one.'),
    el('div', { class: 'row' }, el('input', { type: 'text', readonly: true, value: redirect, onclick: (e) => e.target.select() })),
    el('div', { class: 'row wrap' }, cid, csec),
    el('div', { class: 'row wrap' }, el('button', { class: 'btn', onclick: async () => { try { await post('/api/auth/admin/google', { clientId: cid.value.trim(), clientSecret: csec.value.trim() || undefined }, 'PUT'); toast('Google sign-in saved'); csec.value = ''; } catch (x) { toast(x.message, 5000); } } }, 'Save'),
      data.google ? el('button', { class: 'btn ghost', onclick: async () => { await post('/api/auth/admin/google', {}, 'PUT'); cid.value = ''; toast('Google sign-in is off'); } }, 'Turn off') : null),
    el('h3', {}, 'Security log'),
    el('div', { class: 'audit' }, events.slice(0, 60).map((e) => el('div', { class: `ev${bad.has(e.event) ? ' bad' : ''}` }, el('span', { class: 'when' }, secAgo(e.at)), el('b', {}, LABEL[e.event] || e.event), el('span', { class: 'small muted' }, [e.user, e.added || e.removed || e.of || e.panel, e.ip].filter(Boolean).join(' · '))))),
    events.length ? null : el('p', { class: 'small muted' }, 'Nothing yet.'));
  return box;
}

async function securityCards() {
  let me; try { me = await api('/api/auth/me'); } catch { return []; }
  if (!me.signIn) return [el('div', { class: 'card' }, el('h2', {}, icon('lock'), T('Security')), el('p', { class: 'small muted' }, 'Sign-in, two-step sign-in and people are set up on a real install (the demo has no accounts).'))];
  if (me.user.panel) return [];
  const cards = [accountCard(me)];
  if (['admin', 'owner'].includes(me.user.role)) { const d = await api('/api/users').catch(() => null); if (d) cards.push(peopleCard(d, me), await securityAdminCard(d, me)); }
  return cards;
}

/* Safety: what CasaTorch refuses to switch (anything that looks like a door, gate, lock or alarm control),
   and the owner's exceptions - for a device the name rule caught by mistake. */
async function safetyCard() {
  const me = await api('/api/auth/me').catch(() => null);
  if (me && me.signIn !== false && !['owner', 'admin'].includes(me.user?.role)) return null;
  const owner = !me || me.signIn === false || me.user?.role === 'owner';
  const card = el('div', { class: 'card' }, el('h2', {}, icon('lock', 15), 'Safety'),
    el('p', { class: 'small muted', style: 'margin-top:0' }, 'CasaTorch never unlocks doors, opens garage doors or gates, or disarms alarms. It also holds back switches, buttons and scripts whose names look like one of those (a "garage" relay, an "unlock" script). Covers can always be closed.'));
  const list = el('div'); card.append(list);
  let all = false, q = '';
  const draw = async () => {
    const r = await api('/api/safety').catch(() => ({ held: [] }));
    const find = q.toLowerCase(), held = r.held.filter((d) => !find || d.name.toLowerCase().includes(find)), shown = all || find ? held : held.slice(0, 6);
    const search = r.held.length > 6 ? el('input', { type: 'search', placeholder: `Search ${r.held.length} held-back devices`, value: q, oninput: (e) => { q = e.target.value; draw().then(() => { const n = list.querySelector('input[type=search]'); n?.focus(); n?.setSelectionRange(q.length, q.length); }); } }) : null;
    const more = !all && !find && held.length > shown.length ? el('button', { class: 'btn small ghost', onclick: () => { all = true; draw(); } }, `Show all ${held.length}`) : null;
    list.replaceChildren(...[search].filter(Boolean), ...(shown.length ? shown.map((d) => el('div', { class: 'row between', style: 'gap:8px;margin:6px 0' },
      el('span', {}, d.name, el('small', { class: 'muted' }, ` · ${d.allowed ? 'allowed' : 'held back'}`)),
      owner ? el('button', { class: `btn small${d.allowed ? '' : ' ghost'}`, onclick: async () => {
        if (!d.allowed && !confirm(d.kind === 'cover' ? `Allow CasaTorch to open "${d.name}"? Only do this for blinds, shades or curtains - never a garage door, gate or door.` : `Allow CasaTorch to switch "${d.name}"? Only do this if it is not a door, gate, lock or alarm.`)) return;
        await post(`/api/safety/${encodeURIComponent(d.id)}`, { allow: !d.allowed }, 'PUT').catch((e) => toast(e.message)); draw();
      } }, d.allowed ? 'Hold back again' : 'Allow') : null))
      : [el('p', { class: 'small muted' }, find ? 'No match.' : 'Nothing is being held back.')]), ...[more].filter(Boolean));
  };
  draw(); return card;
}
