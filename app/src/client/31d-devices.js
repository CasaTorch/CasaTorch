/* ======================================================================
 * Settings › Devices & sessions: every phone and browser signed in (the
 * owner sees everyone's, others their own), with where and when each was
 * last seen; "Sign out", "Remove this phone", "Sign out everywhere else";
 * the browsers approved for away from home (the edge gate, 42g-edge-gate.js);
 * and, for the owner, the shields: Lock remote access and allowed countries.
 * ====================================================================== */
const ISO_COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const countryName = (c) => { try { return new Intl.DisplayNames([document.documentElement.lang || 'en', 'en'], { type: 'region' }).of(c) || c; } catch { return c; } };
const whereText = (w) => (!w ? '-' : w.home ? T('At home') : [w.city, w.country ? countryName(w.country) : null].filter(Boolean).join(', ') || T('Away from home'));
const onGateHost = () => /^home-[a-z0-9]{8}\.casatorch\.com$/.test(location.hostname);
/* An approved browser at the secure address keeps its edge ticket fresh while CasaTorch is open (the app does its own). */
if (onGateHost() && !window.CasaNative) {
  const renew = () => { if (document.visibilityState !== 'hidden') fetch('/api/gate/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }).catch(() => {}); };
  setTimeout(renew, 4000); setInterval(renew, 30 * 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renew(); });
}
/** Off to the secure address with this browser's new ticket (a form post: it never goes in the address bar or history). */
function gateApproveHere(action, ticket) {
  const f = el('form', { method: 'POST', action, style: 'display:none' }, el('input', { type: 'hidden', name: 't', value: ticket }));
  document.body.append(f); f.submit();
}
async function devicesCards() {
  let d; try { d = await api('/api/access'); } catch (e) { return [el('div', { class: 'card' }, el('h2', {}, icon('lock', 15), T('Devices & sessions')), el('p', { class: 'small muted' }, e.message))]; }
  return [devicesCard(d), d.owner ? shieldsCard(d) : null].filter(Boolean);
}
function devicesCard(d) {
  const box = el('div', { class: 'card wide' }), n = window.CasaNative;
  const draw = () => {
    const who = (x) => (d.owner && x.user !== d.me ? ` · ${x.person}` : '');
    const row = (ic, title, sub, btn) => el('div', { class: 'person' }, icon(ic), el('div', { class: 'grow' }, el('b', {}, title), el('div', { class: 'small muted' }, sub)), btn);
    const end = (s, label, ask) => el('button', { class: 'btn ghost sm', onclick: async () => {
      if (ask && !confirm(ask)) return;
      try { await api(`/api/access/sessions/${s.id}`, { method: 'DELETE' }); d.sessions = d.sessions.filter((x) => x !== s); draw(); toast(T('Signed out')); } catch (x) { toast(x.message, 4000); }
    } }, label);
    const sessRow = (s) => {
      const kind = s.kind === 'app' ? T('CasaTorch app') : s.kind === 'panel' ? T('Wall panel') : T('Browser');
      const name = s.kind === 'app' ? (s.name || T('Phone')) : browserOf(s.agent);
      const sub = `${kind}${who(s)} · ${whereText(s.where)} · ${T('last used {ago}', { ago: secAgo(s.seen) })}`;
      const btn = s.current ? pill(T('This device'), 'good') : s.kind === 'app' ? end(s, T('Remove this phone'), T('Remove {name}? It is signed out, its alerts stop, and it can no longer reach this home from away.', { name }))
        : end(s, T('Sign out'));
      return row(s.kind === 'app' ? 'phone' : s.kind === 'panel' ? 'home' : 'lock', name, sub, btn);
    };
    const phones = d.sessions.filter((s) => s.kind === 'app'), others = d.sessions.filter((s) => s.kind !== 'app');
    const browsers = d.browsers.map((b) => row('link', b.name, `${T('approved {ago}', { ago: secAgo(b.at) })}${b.seen ? ` · ${T('last used {ago}', { ago: secAgo(b.seen) })}` : ''}${b.user && d.owner && b.user !== d.me ? ` · ${b.person}` : ''}`,
      el('button', { class: 'btn ghost sm danger', onclick: async () => { if (!confirm(T('Stop letting {name} open this home from away?', { name: b.name }))) return; try { await api(`/api/access/browsers/${b.id}`, { method: 'DELETE' }); d.browsers = d.browsers.filter((x) => x !== b); draw(); } catch (x) { toast(x.message, 4000); } } }, T('Remove'))));
    const g = d.gate || {};
    const approveHere = d.owner && g.active && !onGateHost() && !n ? el('button', { class: 'btn', onclick: async (e) => {
      e.target.disabled = true;
      try { const r = await post('/api/gate/approve-here', {}); gateApproveHere(r.action, r.ticket); } catch (x) { toast(x.message, 5000); e.target.disabled = false; }
    } }, icon('link', 14), T('Approve this browser for away from home')) : null;
    const approveScan = d.owner && g.active && n?.scanQR ? el('button', { class: 'btn', onclick: async () => {
      try {
        const code = await n.scanQR(); if (!code) return;
        await post('/api/gate/approve', { code });
        toast(T('Approved - the browser opens in a few seconds.'), 5000); d = await api('/api/access'); draw();
      } catch (x) { toast(x.message, 5000); }
    } }, icon('camera', 14), T('Approve a browser')) : null;
    fillCard(box, el('h2', {}, icon('lock', 15), T('Devices & sessions')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, d.owner ? T('Every phone and browser signed in to this CasaTorch, where it was last seen, and the browsers approved to open it away from home.') : T('Your phones and browsers signed in to this CasaTorch, and where each was last seen.')),
      el('h3', {}, T('Phones')), ...(phones.length ? phones.map(sessRow) : [el('p', { class: 'small muted' }, T('No phones yet - add one in Settings › Phones & alerts.'))]),
      el('h3', {}, T('Browsers and wall panels')), ...others.map(sessRow),
      el('div', { class: 'row wrap', style: 'margin-top:10px' },
        d.sessions.filter((s) => s.user === d.me).length > 1 ? el('button', { class: 'btn', onclick: async () => {
          if (!confirm(T('Sign out every other phone and browser of yours? Their away-from-home access ends too.'))) return;
          try { await post('/api/access/others', {}); d = await api('/api/access'); draw(); toast(T('Signed out everywhere else')); } catch (x) { toast(x.message, 4000); }
        } }, T('Sign out everywhere else')) : null),
      g.on ? el('h3', {}, T('Approved for away from home')) : null,
      g.on ? el('p', { class: 'small muted' }, T('Away from home, this home only opens on phones with the CasaTorch app and on browsers you approve. To approve a browser, open the secure address on it: it shows a code to scan with the CasaTorch app (Approve a browser). At home, you can also approve the browser you are using.')) : null,
      ...(g.on ? (browsers.length ? browsers : [el('p', { class: 'small muted' }, T('No approved browsers yet.'))]) : []),
      approveHere || approveScan ? el('div', { class: 'row wrap', style: 'gap:8px;margin-top:8px' }, approveScan, approveHere) : null);
  };
  draw(); return box;
}
/* The owner's shields for remote access. */
function shieldsCard(d) {
  const box = el('div', { class: 'card' }), n = window.CasaNative;
  const draw = () => {
    const g = d.gate || {};
    if (!g.on) return fillCard(box, el('h2', {}, icon('shield', 15), T('Away-from-home protection')), el('p', { class: 'small muted' }, T('Turn on secure access first (Settings › Connections & AI).')));
    const done = (r, ok) => { d.gate = r.gate || d.gate; draw(); toast(r.warning ? T('Saved, but casatorch.com didn\'t get it yet: {why}', { why: r.warning }) : ok, 5000); };
    const lockBtn = g.locked
      ? el('button', { class: 'btn primary', onclick: async () => {
        try {
          if (n) { const ok = n.confirmOwner ? await n.confirmOwner(T('Unlock remote access')) : false; if (!ok) { if (!n.confirmOwner) toast(T('Update the CasaTorch app to unlock from it.'), 5000); return; } }
          done(await post('/api/gate/unlock', {}), T('Remote access is unlocked'));
        } catch (x) { toast(x.message, 5000); }
      } }, icon('lock', 14), T('Unlock'))
      : el('button', { class: 'btn danger', onclick: async () => {
        if (!confirm(T('Lock remote access? Nobody can reach this CasaTorch from outside until you unlock it at home or from the CasaTorch app.'))) return;
        try { done(await post('/api/gate/settings', { locked: true }), T('Remote access is locked')); } catch (x) { toast(x.message, 5000); }
      } }, icon('lock', 14), T('Lock now'));
    const chosen = new Set(g.countries || []);
    const sel = el('select', { 'aria-label': T('Add a country') }, el('option', { value: '' }, T('Add a country')), ...ISO_COUNTRIES.filter((c) => !chosen.has(c)).map((c) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1])).map(([c, nm]) => el('option', { value: c }, nm)));
    const saveC = async (list) => { try { done(await post('/api/gate/settings', { countries: list }), T('Saved')); } catch (x) { toast(x.message, 5000); } };
    sel.onchange = () => { if (sel.value) saveC([...chosen, sel.value]); };
    const chips = [...chosen].map((c) => el('button', { class: 'chip', title: T('Remove'), onclick: () => saveC([...chosen].filter((x) => x !== c)) }, countryName(c), ' ×'));
    fillCard(box, el('h2', {}, icon('shield', 15), T('Away-from-home protection')),
      el('p', { class: 'small' }, el('span', { class: `dot ${g.active ? 'good' : 'warn'}` }), ' ', g.active ? T('Edge gate on: only approved devices reach this CasaTorch from outside.') : T('Edge gate not active yet. Secure access works as before; the gate turns on by itself once casatorch.com has this CasaTorch\'s key.')),
      el('h3', {}, T('Lock remote access')),
      el('p', { class: 'small muted' }, g.locked ? T('Remote access is locked. Nobody can reach this CasaTorch from outside until you unlock it, here at home or from the CasaTorch app.') : T('Refuses everything from outside right away - phones, browsers, everyone - until you unlock it here at home or from the CasaTorch app.')),
      lockBtn,
      el('h3', {}, T('Allowed countries')),
      el('p', { class: 'small muted' }, T('Only answer from these countries when away from home. Leave it empty for anywhere. Include the country your home is in, or CasaTorch can\'t check its own address from outside.')),
      el('div', { class: 'row wrap gap4' }, ...(chips.length ? chips : [pill(T('Anywhere'))])), el('div', { class: 'row wrap', style: 'margin-top:8px' }, sel),
      el('h3', {}, T('Start over')),
      el('p', { class: 'small muted' }, T('Every phone and approved browser loses its away-from-home access. Phones get it back the next time they open CasaTorch at home; browsers need approving again.')),
      el('button', { class: 'btn ghost', onclick: async () => {
        if (!confirm(T('Sign every device out of away-from-home access?'))) return;
        try { done(await post('/api/gate/revoke-all', {}), T('Done')); } catch (x) { toast(x.message, 5000); }
      } }, T('Sign every device out of away access')));
  };
  draw(); return box;
}
