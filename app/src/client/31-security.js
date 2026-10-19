/* ======================================================================
 * Settings > Security: my account (password, two-step sign-in, recovery
 * codes, where I'm signed in) and, for admins, people, wall-panel links,
 * the two-step policy, Sign in with Google, and the security log.
 * ====================================================================== */
const secAgo = (iso) => { if (!iso) return '-'; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? T('just now') : s < 5400 ? T('{n} min ago', { n: Math.round(s / 60) }) : s < 129600 ? T('{n} h ago', { n: Math.round(s / 3600) }) : T('{n} days ago', { n: Math.round(s / 86400) }); };
const browserOf = (ua = '') => `${/iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : T('Device')} · ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : T('Browser')}`;
/* A link to hand to someone: shown in a box they can copy (the clipboard needs https, so select-all works everywhere). */
function linkBox(link, note) {
  const inp = el('input', { type: 'text', readonly: true, value: link, onclick: (e) => e.target.select() });
  return el('div', { class: 'linkbox' }, el('p', { class: 'small' }, note), el('div', { class: 'row' }, inp, el('button', { class: 'btn', onclick: () => { inp.select(); try { navigator.clipboard?.writeText(link); } catch { /* selected anyway */ } document.execCommand?.('copy'); toast(T('Copied')); } }, T('Copy'))));
}
const fillCard = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const pill = (txt, cls = '') => el('span', { class: `pill ${cls}` }, txt);
function codesBox(codes) {
  return el('div', { class: 'linkbox' }, el('p', { class: 'small' }, T('Recovery codes - each signs you in once if you lose your phone. Save them now; they will not be shown again.')),
    el('div', { class: 'codes' }, codes.map((c) => el('code', {}, c))));
}

function accountCard(me) {
  const u = me.user, box = el('div', { class: 'card' });
  const draw = () => {
    /* password */
    const cur = el('input', { type: 'password', autocomplete: 'current-password' }), nw = el('input', { type: 'password', autocomplete: 'new-password' });
    const pwBtn = el('button', { class: 'btn', onclick: async () => { try { await post('/api/auth/password', { current: cur.value, next: nw.value }); toast(T('Password changed - other screens were signed out')); cur.value = nw.value = ''; } catch (e) { toast(e.message, 4000); } } }, T('Change password'));
    /* two-step */
    const tsa = el('div', { class: 'tsa' });
    const tsaOff = () => tsa.replaceChildren(
      el('p', { class: 'small muted' }, T('Two-step sign-in asks for a 6-digit code from an app on your phone after your password - so a stolen password alone is not enough.')),
      el('label', { class: 'field' }, el('span', {}, T('Your password')), el('input', { type: 'password', autocomplete: 'current-password', class: 'tsapw' })),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          const e = await post('/api/auth/2fa/start', { password: tsa.querySelector('.tsapw')?.value || '' });
          const qr = el('div', { class: 'qr' }); qr.innerHTML = e.qr;   // SVG made by this CasaTorch
          const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '123456', class: 'code' });
          tsa.replaceChildren(el('p', { class: 'small' }, T('1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).')), qr,
            el('p', { class: 'small muted mono' }, `Can't scan? Enter: ${e.secret.replace(/(.{4})/g, '$1 ').trim()}`),
            el('label', { class: 'field' }, el('span', {}, T('2. Type the 6-digit code it shows')), code),
            el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/api/auth/2fa/enable', { code: code.value }); u.twoStep = true; me.recoveryLeft = 10; draw(); box.querySelector('.tsa').append(codesBox(r.recovery)); toast(T('Two-step sign-in is on')); } catch (x) { toast(x.message, 4000); } } }, T('Turn on')), el('button', { class: 'btn ghost', onclick: tsaOff }, T('Cancel'))));
        } catch (x) { toast(x.message, 4000); }
      } }, icon('lock'), T('Turn on two-step sign-in')));
    const tsaOn = () => {
      const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: T('Your password') }), code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: T('Code from the app') });
      tsa.replaceChildren(el('p', { class: 'small' }, pill(T('On'), 'good'), ` ${T('Recovery codes left: {n}', { n: me.recoveryLeft ?? '-' })}`),
        el('div', { class: 'row wrap' }, pw, code),
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn', onclick: async () => { try { const r = await post('/api/auth/2fa/recovery', { password: pw.value }); me.recoveryLeft = 10; tsaOn(); tsa.append(codesBox(r.recovery)); } catch (x) { toast(x.message, 4000); } } }, T('New recovery codes')),
          me.policy?.require2fa ? null : el('button', { class: 'btn ghost', onclick: async () => { try { await post('/api/auth/2fa/disable', { password: pw.value, code: code.value }); u.twoStep = false; draw(); toast(T('Two-step sign-in is off')); } catch (x) { toast(x.message, 4000); } } }, T('Turn off'))),
        el('p', { class: 'small muted' }, T('New recovery codes need your password; turning it off needs your password and a code.')));
    };
    u.twoStep ? tsaOn() : tsaOff();
    /* sessions */
    const sess = el('div', { class: 'sessions' }, (me.sessions || []).sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.seen.localeCompare(a.seen)).map((s) => el('div', { class: 'sess' },
      icon(s.kind === 'panel' ? 'home' : 'lock'), el('div', {}, el('b', {}, browserOf(s.agent)), el('div', { class: 'small muted' }, `${s.ip || '-'} · ${T('last used {ago}', { ago: secAgo(s.seen) })}${s.current ? ` · ${T('this screen')}` : ''}`)),
      s.current ? pill(T('This screen'), 'good') : el('button', { class: 'btn ghost sm', onclick: async () => { try { await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' }); me.sessions = me.sessions.filter((x) => x !== s); draw(); } catch (x) { toast(x.message); } } }, T('Sign out')))));
    fillCard(box, el('h2', {}, icon('lock'), T('Your account & security')),
      el('div', { class: 'acct' }, el('div', { class: 'avatar' }, (u.name || u.username || '?').slice(0, 1).toUpperCase()), el('div', {}, el('b', {}, u.name || u.username), el('div', { class: 'small muted' }, `${u.username} · ${u.role}${u.email ? ` · ${u.email}` : ''}${me.google?.linked ? T(' · Google linked') : ''}`))),
      el('h3', {}, T('Two-step sign-in'), docLink('settings.twostep', { icon: true, topic: T('Two-step sign-in') })), tsa,
      el('h3', {}, T('Password')), el('div', { class: 'row wrap' }, el('label', { class: 'field grow' }, el('span', {}, T('Current')), cur), el('label', { class: 'field grow' }, el('span', {}, T('New (10+ characters)')), nw)), pwBtn,
      el('h3', {}, T('Where you are signed in')), sess,
      el('div', { class: 'row wrap', style: 'margin-top:10px' },
        (me.sessions || []).length > 1 ? el('button', { class: 'btn', onclick: async () => { await post('/api/auth/sessions/others', {}); me.sessions = me.sessions.filter((s) => s.current); draw(); toast(T('Signed out everywhere else')); } }, T('Sign out everywhere else')) : null,
        el('button', { class: 'btn ghost', onclick: async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login.html'; } }, T('Sign out'))));
  };
  draw(); return box;
}

function peopleCard(data, me) {
  const box = el('div', { class: 'card wide' }), ROLE_TXT = { owner: T('Owner - everything'), admin: T('Admin - settings and people'), member: T('Member - can switch things'), viewer: T('Viewer - can only look') };
  const roleSel = (v, onchange, allowOwner) => el('select', { onchange }, ...data.roles.filter((r) => allowOwner || r !== 'owner' || v === 'owner').map((r) => el('option', { value: r, selected: r === v ? true : null }, ROLE_TXT[r])));
  const draw = (extra) => {
    const name = el('input', { type: 'text', placeholder: T('Name') }), email = el('input', { type: 'email', placeholder: T('E-mail (for Google sign-in, optional)') });
    let role = 'member'; const rs = roleSel(role, (e) => { role = e.target.value; }, me.user.role === 'owner');
    const rows = data.users.map((u) => el('div', { class: 'person' },
      el('div', { class: 'avatar sm' }, (u.name || '?').slice(0, 1).toUpperCase()),
      el('div', { class: 'grow' }, el('b', {}, u.name), el('div', { class: 'small muted' }, `${u.username}${u.email ? ` · ${u.email}` : ''} · ${u.invited ? T('invite not used yet') : T('last in {ago}', { ago: secAgo(u.lastLogin) })}`),
        el('div', { class: 'row wrap gap4' }, u.twoStep ? pill('2-step', 'good') : pill('no 2-step', 'warn'), u.google ? pill('Google') : null)),
      u.id === me.user.id ? pill(T('You')) : el('div', { class: 'row wrap gap4' },
        roleSel(u.role, async (e) => { try { await post(`/api/users/${u.id}`, { role: e.target.value }, 'PUT'); u.role = e.target.value; toast(T('Saved')); } catch (x) { toast(x.message, 4000); e.target.value = u.role; } }, me.user.role === 'owner'),
        el('button', { class: 'btn ghost sm', title: T('New sign-in link (resets their password and 2-step)'), onclick: async () => { if (!confirm(T('Reset {name}\'s password? They get a new link to set one, and are signed out everywhere.', { name: u.name }))) return; try { const r = await post(`/api/users/${u.id}/reset`, {}); draw(linkBox(r.link, T('Send this to {name} - it works once, for 7 days.', { name: u.name }))); } catch (x) { toast(x.message, 4000); } } }, T('Reset')),
        u.role === 'owner' ? null : el('button', { class: 'btn ghost sm danger', onclick: async () => { if (!confirm(T('Remove {name}? They are signed out everywhere.', { name: u.name }))) return; try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); data.users = data.users.filter((x) => x !== u); draw(); } catch (x) { toast(x.message, 4000); } } }, T('Remove')))));
    const panels = (data.panels || []).map((p) => el('div', { class: 'person' }, icon('home'), el('div', { class: 'grow' }, el('b', {}, p.name), el('div', { class: 'small muted' }, `${p.role === 'member' ? T('can switch things') : T('view only')} · ${T('last used {ago}', { ago: secAgo(p.lastUsed) })}`)),
      el('button', { class: 'btn ghost sm danger', onclick: async () => { if (!confirm(T('Revoke {name}? That screen is signed out.', { name: p.name }))) return; await api(`/api/auth/admin/panels/${p.id}`, { method: 'DELETE' }); data.panels = data.panels.filter((x) => x !== p); draw(); } }, T('Revoke'))));
    const pname = el('input', { type: 'text', placeholder: T('Kitchen panel') }), prole = el('select', {}, el('option', { value: 'viewer' }, T('View only')), el('option', { value: 'member' }, T('Can switch things')));
    fillCard(box, el('h2', {}, icon('home'), T('People')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, T('Everyone gets their own sign-in. Nobody can sign up on their own: add them here and send them their link.')),
      ...rows, extra || null,
      el('h3', {}, T('Add someone')), el('div', { class: 'row wrap' }, name, email), el('div', { class: 'row wrap' }, rs,
        el('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/api/users', { name: name.value, email: email.value, role }); data.users.push(r.user); draw(linkBox(r.link, T('Send this to {name} - they pick a username and password. It works once, for 7 days.', { name: r.user.name }))); } catch (x) { toast(x.message, 4000); } } }, icon('plus'), T('Add and get invite link'))),
      el('h3', {}, T('Wall panels')), el('p', { class: 'small muted' }, T('A link that signs a wall tablet in for a year, as a panel - not as a person. Revoke it any time.')),
      ...panels, el('div', { class: 'row wrap' }, pname, prole, el('button', { class: 'btn', onclick: async () => { try { const r = await post('/api/auth/admin/panels', { name: pname.value || 'Wall panel', role: prole.value }); data.panels = (await api('/api/users')).panels; draw(linkBox(r.link, T('Open this once on the wall tablet. Treat it like a key - anyone with it can view your home.'))); } catch (x) { toast(x.message, 4000); } } }, T('Make a panel link'))));
  };
  draw(); return box;
}

async function securityAdminCard(data, me) {
  const box = el('div', { class: 'card wide' });
  const req2 = el('input', { type: 'checkbox', checked: data.policy?.require2fa ? true : null, onchange: async (e) => { try { await post('/api/auth/admin/policy', { require2fa: e.target.checked }, 'PUT'); toast(e.target.checked ? T('Everyone now needs two-step sign-in') : T('Two-step sign-in is optional')); } catch (x) { e.target.checked = !e.target.checked; toast(x.message, 5000); } } });
  const cid = el('input', { type: 'text', placeholder: '1234-abc.apps.googleusercontent.com', value: data.google?.clientId || '' }), csec = el('input', { type: 'password', placeholder: data.google?.hasSecret ? T('Saved - leave empty to keep') : T('Client secret'), autocomplete: 'off' });
  const redirect = `${location.origin}/api/auth/google/callback`;
  fillCard(box, el('h2', {}, icon('lock'), T('Sign-in & security log')),
    el('label', { class: 'check' }, req2, el('span', {}, el('b', {}, T('Require two-step sign-in for everyone')), el('div', { class: 'small muted' }, T('People without it set it up the next time they sign in.')))),
    el('h3', {}, T('Sign in with Google')),
    el('p', { class: 'small muted' }, T('Lets the people you added sign in with their Google account (matched by e-mail). In Google Cloud Console > APIs & Services > Credentials, create an OAuth client ID (Web application) and add this redirect URI. Google only accepts https addresses or localhost - use your secure remote-access address if you have one.')),
    el('div', { class: 'row' }, el('input', { type: 'text', readonly: true, value: redirect, onclick: (e) => e.target.select() })),
    el('div', { class: 'row wrap' }, cid, csec),
    el('div', { class: 'row wrap' }, el('button', { class: 'btn', onclick: async () => { try { await post('/api/auth/admin/google', { clientId: cid.value.trim(), clientSecret: csec.value.trim() || undefined }, 'PUT'); toast(T('Google sign-in saved')); csec.value = ''; } catch (x) { toast(x.message, 5000); } } }, T('Save')),
      data.google ? el('button', { class: 'btn ghost', onclick: async () => { await post('/api/auth/admin/google', {}, 'PUT'); cid.value = ''; toast(T('Google sign-in is off')); } }, T('Turn off')) : null),
    el('p', { class: 'small muted', style: 'margin:14px 0 0' }, T('Sign-ins, failed attempts and changes are in Activity, below.')));   // activityCard: 39s-support.js
  return box;
}

async function securityCards() {
  let me; try { me = await api('/api/auth/me'); } catch { return []; }
  if (!me.signIn) return [el('div', { class: 'card' }, el('h2', {}, icon('lock'), T('Security')), el('p', { class: 'small muted' }, T('Sign-in, two-step sign-in and people are set up on a real install (the demo has no accounts).')))];
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
  const card = el('div', { class: 'card' }, el('h2', {}, icon('lock', 15), T('Safety')),
    el('p', { class: 'small muted', style: 'margin-top:0' }, T('CasaTorch never unlocks doors, opens garage doors or gates, or disarms alarms. It also holds back switches, buttons and scripts whose names look like one of those (a "garage" relay, an "unlock" script). Covers can always be closed.')));
  const list = el('div'); card.append(list);
  if (owner) {   // other names CasaTorch answers to: a reverse proxy, your own domain
    const st = await api('/api/settings').catch(() => ({}));
    const hosts = el('input', { value: (st.security?.allowedHosts || []).join(', '), placeholder: 'dash.example.com', autocomplete: 'off' });
    card.append(el('details', { style: 'margin-top:12px' }, el('summary', { class: 'small' }, T('Allowed names')),
      el('p', { class: 'small muted' }, T('CasaTorch only answers to its address on your network, home-network names (like casatorch.local) and its own secure names - so a web page elsewhere can\'t reach it by pointing a name at it. Using CasaTorch behind your own reverse proxy or domain? Add that name here.')),
      el('div', { class: 'row', style: 'gap:8px' }, hosts, el('button', { class: 'btn small', onclick: async () => { try { await post('/api/settings', { allowedHosts: hosts.value }, 'PUT'); toast(T('Saved')); } catch (e) { toast(e.message); } } }, T('Save')))));
  }
  let all = false, q = '';
  const draw = async () => {
    const r = await api('/api/safety').catch(() => ({ held: [] }));
    const find = q.toLowerCase(), held = r.held.filter((d) => !find || d.name.toLowerCase().includes(find)), shown = all || find ? held : held.slice(0, 6);
    const search = r.held.length > 6 ? el('input', { type: 'search', placeholder: T('Search {n} held-back devices', { n: r.held.length }), value: q, oninput: (e) => { q = e.target.value; draw().then(() => { const n = list.querySelector('input[type=search]'); n?.focus(); n?.setSelectionRange(q.length, q.length); }); } }) : null;
    const more = !all && !find && held.length > shown.length ? el('button', { class: 'btn small ghost', onclick: () => { all = true; draw(); } }, T('Show all {n}', { n: held.length })) : null;
    list.replaceChildren(...[search].filter(Boolean), ...(shown.length ? shown.map((d) => el('div', { class: 'row between', style: 'gap:8px;margin:6px 0' },
      el('span', {}, d.name, el('small', { class: 'muted' }, ` · ${d.allowed ? T('allowed') : T('held back')}`)),
      owner ? el('button', { class: `btn small${d.allowed ? '' : ' ghost'}`, onclick: async () => {
        if (!d.allowed && !confirm(d.kind === 'cover' ? T('Allow CasaTorch to open "{name}"? Only do this for blinds, shades or curtains - never a garage door, gate or door.', { name: d.name }) : T('Allow CasaTorch to switch "{name}"? Only do this if it is not a door, gate, lock or alarm.', { name: d.name }))) return;
        await post(`/api/safety/${encodeURIComponent(d.id)}`, { allow: !d.allowed }, 'PUT').catch((e) => toast(e.message)); draw();
      } }, d.allowed ? T('Hold back again') : T('Allow')) : null))
      : [el('p', { class: 'small muted' }, find ? T('No match.') : T('Nothing is being held back.'))]), ...[more].filter(Boolean));
  };
  draw(); return card;
}
