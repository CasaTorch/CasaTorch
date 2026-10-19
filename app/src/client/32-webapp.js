/* ======================================================================
 * The web app: install CasaTorch on a phone or computer like an app, and
 * get alerts there (Web Push) - even with the app closed.
 * Phones only allow both on a secure (https) address; on a plain http
 * address this card says so instead of showing buttons that can't work.
 * ====================================================================== */
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
const b64ToBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const deviceName = () => { const ua = navigator.userAgent; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || isIOS ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device'; };
async function mySubscription() { if (!('serviceWorker' in navigator)) return null; const r = await navigator.serviceWorker.getRegistration(); return r ? r.pushManager.getSubscription() : null; }

async function phoneCard() {
  const card = el('div', { class: 'card' }, el('h2', {}, icon('bell', 15), window.CasaNative ? T('Alerts for everyone') : T('Web app & alerts')));
  const body = el('div'); card.append(body);
  // each kind of alert (which phones, sound, repeats, quiet hours, a device or a room): 37a-alert-rules.js
  card.append(el('p', { class: 'small', style: 'margin:14px 0 0' }, el('a', { href: '#settings/alerts', class: 'row', style: 'gap:6px;display:inline-flex' }, icon('sliders', 14), T('Fine-tune in Settings › Alerts'))));
  const add = (...kids) => body.append(...kids.filter((k) => k != null && k !== false));
  const draw = async () => {
    const info = await api('/api/push').catch(() => null);
    const me = await api('/api/auth/me').catch(() => null), admin = !me || me.signIn === false || ['owner', 'admin'].includes(me.user?.role);
    body.replaceChildren();
    if (window.CasaNative) { /* in the CasaTorch app, this phone's alerts are on the card above - only the house-wide settings here */ }
    else {
    /* 1. Install */
    const install = isStandalone() ? el('p', { class: 'small good' }, T('✓ You\'re using the installed app.'))
      : installPrompt ? el('button', { class: 'btn', onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; draw(); } }, icon('plus'), T('Install CasaTorch on this device'))
      : isIOS ? el('p', { class: 'small muted' }, T('To install on this iPhone or iPad: tap the Share button in Safari, then "Add to Home Screen".'))
      : el('p', { class: 'small muted' }, T('To install: use your browser\'s "Install app" or "Add to Home screen" menu item.'));
    add(el('h3', { class: 'sub' }, T('Install')), install);
    /* 2. Alerts on this device */
    add(el('h3', { class: 'sub' }, T('Alerts on this device')));
    if (!isSecureContext) {
      const secure = el('p', { class: 'small muted' }, T('Phones only allow app installs and alerts on a secure (https) address, and this page is on {host} (http). At home, open CasaTorch at its secure address (Settings › Connections & AI › Secure address at home); away from home, use Secure access (Pro).', { host: location.host }));
      api('/api/local-https/target').then((j) => { if (j.url) secure.replaceChildren(T('Phones only allow app installs and alerts on a secure (https) address. '), el('a', { href: j.url + location.pathname + location.hash }, T('Open the secure address')), T(' on this device, then install and turn on alerts there.')); }).catch(() => {});
      add(secure,
        info?.haPhone ? el('p', { class: 'small good' }, T('✓ Alerts already go to the Home Assistant app on your phones.')) : el('p', { class: 'small muted' }, T('Using Home Assistant? Its phone app can get CasaTorch alerts today - turn it on below.')));
    } else if (!('PushManager' in window) || !('Notification' in window)) {
      add(el('p', { class: 'small muted' }, isIOS && !isStandalone() ? T('On iPhone and iPad, alerts work in the installed app: add CasaTorch to your Home Screen first (above), open it from there, and come back here.') : T('This browser can\'t show alerts.')));
    } else {
      const sub = await mySubscription(), mine = sub && info?.devices.find((d) => d.id === localStorage.getItem('casatorch-push-id'));
      const level = el('select', { 'aria-label': T('Which alerts') }, ...[['critical', 'Only critical (water, smoke, internet down)'], ['important', 'Important (also offline devices, doorbell)'], ['all', 'Everything (also low batteries, motion)']].map(([v, t]) => el('option', { value: v, selected: (mine?.level || 'important') === v ? true : null }, t)));
      if (mine) {
        level.onchange = () => post(`/api/push/${mine.id}`, { level: level.value }, 'PUT').then(() => toast(T('Saved'))).catch((e) => toast(e.message));
        add(el('p', { class: 'small good' }, T('✓ Alerts are on for this device.')), el('label', { class: 'field' }, el('span', {}, T('Send')), level),
          el('div', { class: 'row wrap', style: 'gap:8px' }, el('button', { class: 'btn small', onclick: () => post(`/api/push/${mine.id}/test`, {}).then(() => toast(T('Sent - it should appear in a few seconds'))).catch((e) => toast(e.message, 5000)) }, T('Send a test')),
            el('button', { class: 'btn small ghost', onclick: async () => { await sub.unsubscribe().catch(() => {}); await api(`/api/push/${mine.id}`, { method: 'DELETE' }).catch(() => {}); try { localStorage.removeItem('casatorch-push-id'); } catch { /* fine */ } draw(); } }, T('Turn off'))));
      } else {
        add(el('label', { class: 'field' }, el('span', {}, T('Send')), level), el('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          try {
            if (await Notification.requestPermission() !== 'granted') throw new Error('Alerts are blocked for CasaTorch in this browser\'s settings.');
            const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
            const s = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.key) });
            const r = await post('/api/push', { subscription: s.toJSON(), level: level.value, name: deviceName() });
            try { localStorage.setItem('casatorch-push-id', r.id); } catch { /* fine */ }
            await post(`/api/push/${r.id}/test`, {}).catch(() => {});
            toast(T('Alerts are on - a test alert is on its way.'), 4000);
          } catch (err) { toast(err.message, 5000); }
          draw();
        } }, icon('bell'), T('Turn on alerts here')));
      }
    }
    }
    const others = (info?.devices || []).filter((d) => d.id !== (() => { try { return localStorage.getItem('casatorch-push-id'); } catch { return null; } })());
    if (others.length) add(el('h3', { class: 'sub' }, T('Your other devices with alerts')), ...others.map((d) => el('div', { class: 'row between', style: 'gap:8px;margin:6px 0' }, el('span', {}, d.name, d.broken ? el('small', { class: 'muted' }, T(' · not reachable')) : null),
      el('button', { class: 'btn small ghost', onclick: () => api(`/api/push/${d.id}`, { method: 'DELETE' }).then(draw) }, T('Remove')))));
    /* 3. House-wide settings */
    if (admin && info) {
      const quiet = el('select', { onchange: () => post('/api/alerts/settings', { quietHours: quiet.value }, 'PUT').then(() => toast(T('Saved'))).catch((e) => toast(e.message)) }, ...[['22-7', '10 PM to 7 AM'], ['23-6', '11 PM to 6 AM'], ['21-6', '9 PM to 6 AM'], ['none', 'None']].map(([v, t]) => el('option', { value: v, selected: info.quietHours === v ? true : null }, t)));
      const ha = el('input', { type: 'checkbox', checked: info.haPhone ? true : null, onchange: () => post('/api/alerts/settings', { haPhone: ha.checked }, 'PUT').then(() => toast(T('Saved'))).catch((e) => toast(e.message)) });
      add(el('h3', { class: 'sub' }, T('For everyone')), el('label', { class: 'field' }, el('span', {}, T('Quiet hours (only critical alerts get through)')), quiet),
        info.ha ? el('label', { class: 'field check' }, ha, el('span', {}, T('Also send alerts to the Home Assistant app on your phones'))) : null);
      /* Smart alerts (Pro) */
      const set = (k) => (e) => post('/api/alerts/settings', { [k]: e.target.checked }, 'PUT').then(() => toast(T('Saved'))).catch((x) => { e.target.checked = !e.target.checked; toast(x.message); });
      const away = el('input', { type: 'checkbox', checked: info.awayOnly ? true : null, disabled: !info.pro || !info.people ? true : null, onchange: set('awayOnly') });
      const rep = el('input', { type: 'checkbox', checked: info.repeat ? true : null, onchange: set('repeat') });   // safety repeats are on every edition (40-alerts.js)
      add(el('h3', { class: 'sub' }, T('Smart alerts '), el('span', { class: 'pill pro' }, 'Pro')),
        el('label', { class: 'field check' }, away, el('span', {}, T('Doorbell and motion alerts only when nobody\'s home'), el('span', { class: 'small muted', style: 'display:block' }, info.people ? T(info.people === 1 ? 'Uses the {n} person or phone Home Assistant tracks. They still show on the dashboard.' : 'Uses the {n} people and phones Home Assistant tracks. They still show on the dashboard.', { n: info.people }) : T('Needs people or phones tracked in Home Assistant (the Home Assistant phone app does this).')))),
        el('label', { class: 'field check' }, rep, el('span', {}, T('Repeat critical alerts every 10 minutes until someone taps "Got it"'), el('span', { class: 'small muted', style: 'display:block' }, info.pro ? T('Water, smoke and the internet going down. Up to 6 reminders.') : T('Water and smoke repeat on every edition (safety is never Pro). Other critical alerts, like the internet going down, repeat with Pro. Up to 6 reminders.')))),
        el('p', { class: 'small muted' }, T('For everyone: an alert has to still be there a minute later before it goes out, so a sensor that blinks offline doesn\'t wake anyone up. Water and smoke go out straight away.')));
    }
  };
  draw(); return card;
}

/* Settings > Secure access: this CasaTorch at its own https address. It checks itself from outside (42-remote.js)
   and says so in plain words: "Working from anywhere ✓ (checked 2 min ago)", or exactly what's wrong and the fix. */
function remoteStatusEl(r) {
  const v = r.view || { status: 'starting', title: T('Starting…') };
  const dot = { working: 'good', problem: 'bad' }[v.status] || 'warn';
  return el('div', { style: 'display:flex;gap:9px;align-items:flex-start', role: 'status', 'aria-live': 'polite' }, el('span', { class: `dot ${dot}`, style: 'flex:none;margin-top:7px' }),
    el('div', {}, el('b', {}, v.title, v.status === 'working' ? ' ✓' : ''), v.status === 'working' && r.check?.at ? el('span', { class: 'small muted' }, ` (${T('checked {ago}', { ago: ago(r.check.at) })})`) : null));
}
/** The fix the server suggests (Repair / Check again), as a button. */
function remoteFixBtn(r, after) {
  const f = r.view?.fix; if (!f) return null;
  return el('button', { class: `btn small ${f.action === 'repair' ? 'primary' : ''}`, onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = f.action === 'repair' ? T('Repairing… (up to a minute)') : T('Checking…');
    try { const x = await post(`/api/remote/${{ repair: 'repair', on: 'on' }[f.action] || 'check'}`, {}); toast(x.view?.status === 'working' ? T('Secure access works') : f.action === 'repair' ? T('Set up again - checking it now') : x.view?.title || T('Checked')); }
    catch (err) { toast(err.message, 6000); }
    after();
  } }, f.label);
}
/** Copy / share the secure address, to open it on a phone. */
function remoteSendEls(url) {
  const copy = el('button', { class: 'btn small', onclick: async () => { try { await navigator.clipboard.writeText(url); toast(T('Link copied')); } catch { toast(url, 8000); } } }, icon('link', 14), T('Copy link'));
  const share = navigator.share ? el('button', { class: 'btn small', onclick: () => navigator.share({ title: 'CasaTorch', url }).catch(() => {}) }, icon('send', 14), T('Send to phone')) : null;
  return el('div', { class: 'row wrap', style: 'gap:8px' }, share, copy);
}
async function remoteCard() {
  const card = el('div', { class: 'card', id: 'remote-card' }, el('h2', {}, icon('lock', 15), T('Secure access'), el('span', { class: 'pill', style: 'margin-left:6px', title: T('Still being finished - it may change') }, T('Beta'))));
  /* Beta until the owner confirms it is finished (the site lists using it away from home as Coming); it stays usable. */
  const beta = () => el('p', { class: 'small muted', style: 'margin-top:0' }, T('Beta: secure access works, but it is still being finished and may change.'));
  const body = el('div'); card.append(body);
  let timer = null;
  const draw = async () => {
    clearTimeout(timer);
    const r = await api('/api/remote').catch(() => null);
    const me = await api('/api/auth/me').catch(() => null), admin = !me || me.signIn === false || ['owner', 'admin'].includes(me.user?.role);
    body.replaceChildren();
    if (!r) return body.append(el('p', { class: 'small muted' }, T('Not available right now.')));
    const add = (...k) => body.append(...k.filter(Boolean));
    if (!r.on && r.busy) {
      add(remoteStatusEl(r), el('p', { class: 'small muted', style: 'margin:6px 0 0' }, r.view.detail));
      timer = setTimeout(() => { if (card.isConnected) draw(); }, 3000);
      return;
    }
    if (!r.on) {
      add(beta(), el('p', { class: 'small muted', style: 'margin-top:0' }, T('Give this CasaTorch its own secure https address, so phones can install the CasaTorch app and get alerts. Nothing to change on your router. Everyone still signs in as usual.')),
        el('p', { class: 'small muted' }, r.anywhere ? T('With Pro, the address works from anywhere - at home or away (beta).') : T('On Basic, the address works on your home Wi-Fi. Using it from anywhere is part of Pro.')),
        !r.supported ? el('p', { class: 'small bad' }, T('Secure access isn\'t available on this kind of computer yet.')) : null,
        r.demo ? el('p', { class: 'small muted' }, T('Not in the demo.')) : null,
        admin && r.supported && !r.demo ? el('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; e.target.textContent = T('Setting up… (up to a minute)'); try { await post('/api/remote/on', {}); toast(T('Secure access is on - checking it works')); } catch (err) { toast(err.message, 6000); } draw(); } }, icon('lock'), T('Turn on secure access')) : null);
      if (r.view?.status === 'problem') add(el('p', { class: 'small bad', style: 'margin-bottom:2px' }, r.view.title), r.view.detail ? el('p', { class: 'small muted', style: 'margin-top:0' }, r.view.detail) : null);
      return;
    }
    const v = r.view || {};
    const qr = el('div', { class: 'qr', role: 'img', 'aria-label': T('QR code for the secure address'), style: 'width:150px;height:150px;background:#fff;border-radius:12px;padding:8px;flex:none' }); qr.innerHTML = r.qr || '';   // server-made SVG
    add(beta(), remoteStatusEl(r),
      v.detail ? el('p', { class: `small ${v.status === 'problem' ? '' : 'muted'}`, style: 'margin:6px 0 0' }, v.detail) : null,
      admin && v.fix ? el('div', { class: 'row wrap', style: 'gap:8px;margin-top:10px' }, remoteFixBtn(r, draw)) : null,
      el('p', { style: 'margin:14px 0 8px' }, el('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.url)),
      el('div', { class: 'row wrap', style: 'gap:16px;align-items:center' }, qr, el('div', { style: 'max-width:360px' },
        el('p', { class: 'small muted', style: 'margin-top:0' }, T('Scan this with your phone\'s camera to open CasaTorch at its secure address, sign in, then add it to your home screen and turn on alerts (Settings › Phones & alerts).')),
        el('p', { class: 'small muted' }, T('Or send it to your phone:')), remoteSendEls(r.url),
        el('p', { class: 'small muted' }, T('The CasaTorch app picks up this address by itself the next time it connects at home.')))),
      v.status === 'working' ? null : el('p', { class: 'small muted' }, r.anywhere ? T('Works from anywhere (Pro, beta).') : T('Works on your home Wi-Fi. From anywhere is part of Pro.')),
      admin && r.lastError && v.status !== 'working' ? el('details', { class: 'small muted' }, el('summary', {}, T('Details for support')), el('p', { class: 'tiny', style: 'word-break:break-word' }, `${fmtWhen(r.lastError.at)}: ${r.lastError.text}`)) : null,
      admin ? el('button', { class: 'btn small ghost', style: 'margin-top:8px', onclick: async () => { if (!confirm(T('Turn off secure access? The address stops working on every phone.'))) return; await post('/api/remote/off', {}).catch((err) => toast(err.message)); draw(); } }, T('Turn off')) : null);
    // while it's getting there, every few seconds; once it's settled, once a minute (for "checked 2 min ago")
    timer = setTimeout(() => { if (card.isConnected) draw(); }, ['starting', 'checking'].includes(v.status) ? 3000 : 60_000);
  };
  draw(); return card;
}
/* Settings > Secure address at home: https straight to this box on the home network (43-local-https.js). */
async function localHttpsCard() {
  const card = el('div', { class: 'card' }, el('h2', {}, icon('lock', 15), T('Secure address at home')));
  const body = el('div'); card.append(body);
  const draw = async () => {
    const r = await api('/api/local-https').catch(() => null);
    body.replaceChildren();
    if (!r) { card.remove(); return; }   // admins only
    const add = (...k) => body.append(...k.filter(Boolean));
    if (!r.on) {
      const ip = el('input', { type: 'text', value: r.detected || '', placeholder: '192.168.1.20', inputmode: 'decimal', style: 'max-width:180px' });
      add(r.auto ? el('p', { style: 'margin-top:0' }, el('b', {}, T('Setting itself up…')), ' ', el('span', { class: 'small muted' }, T('This is on by default and starts by itself. It needs the internet once to get its certificate.')))
          : el('p', { class: 'small muted', style: 'margin-top:0' }, T('Off. Turn it on to use CasaTorch over https at home, so sign-ins and everything else are encrypted on your Wi-Fi.')),
        el('p', { class: 'small muted' }, T('Browsers in the house connect straight to this CasaTorch - nothing goes out to the internet - and the plain address sends them to the secure one automatically. CasaTorch gets a free certificate from Let\'s Encrypt for its own name, which points at its address on your network. That address (like 192.168.1.20) is listed in public DNS under a random name; it can\'t be reached from the internet.')),
        r.demo ? el('p', { class: 'small muted' }, T('Not in the demo.')) : el('div', { class: 'row wrap', style: 'gap:8px;align-items:center' }, el('span', { class: 'small muted' }, T('This CasaTorch\'s address on your network')), ip,
          el('button', { class: `btn ${r.auto ? '' : 'primary'}`, onclick: async (e) => { e.target.disabled = true; e.target.textContent = T('Setting up… (about a minute)'); try { await post('/api/local-https/on', { ip: ip.value.trim() === r.detected ? undefined : ip.value.trim() }); } catch (err) { toast(err.message, 5000); } draw(); } }, r.auto ? T('Set up now') : T('Turn on'))));
      if (r.why) add(el('p', { class: 'small bad' }, r.why));
      return;
    }
    const st = { ready: ['good', T('Working')], certificate: ['warn', T('Getting the certificate… (about a minute)')], error: ['bad', T('Not working')], off: ['warn', T('Starting…')] }[r.state] || ['warn', r.state];
    add(el('div', { class: 'row', style: 'gap:8px;align-items:center' }, el('span', { class: `dot ${st[0]}` }), el('b', {}, st[1])),
      el('p', {}, el('a', { href: r.url }, r.url)),
      r.find ? el('p', {}, T('The easy way in at home: '), el('a', { href: 'https://casatorch.com/home', target: '_blank', rel: 'noopener' }, el('b', {}, T('casatorch.com/home'))), el('span', { class: 'small muted' }, T(' - on any phone or computer on your Wi-Fi it opens this CasaTorch. Bookmark it or add it to the home screen.'))) : null,
      el('p', { class: 'small muted' }, `${T('Points at {ip}', { ip: r.ip })}${r.expires ? ` · ${T('certificate renews itself before {date}', { date: fmt(r.expires, { dateStyle: 'medium' }) })}` : ''}.${r.find ? '' : ` ${T('Bookmark this address on your computers and wall tablets (casatorch.com/home needs "Help me find this CasaTorch" on, in Settings › Updates & backup).')}`}`),
      r.why ? el('p', { class: 'small bad' }, r.why) : null,
      r.state === 'ready' && location.protocol === 'http:' ? el('p', { class: 'small' }, T('You\'re on the plain address. '), el('a', { href: r.url + location.pathname + location.hash }, T('Switch to the secure one'))) : null,
      el('details', {}, el('summary', { class: 'small muted' }, T('Doesn\'t open on some devices?')),
        el('p', { class: 'small muted' }, T('Some routers block names that point into the home network ("DNS rebinding protection"). Those devices keep using the plain address. To fix it, allow casatorch.com in that router setting, or set your router\'s DNS to 1.1.1.1.'))),
      el('div', { class: 'row wrap', style: 'gap:8px' },
        el('button', { class: 'btn small', onclick: async () => { const v = prompt(T('This CasaTorch\'s address on your network'), r.ip || ''); if (!v) return; try { await post('/api/local-https/ip', { ip: v.trim() }); toast(T('Address updated')); } catch (err) { toast(err.message, 5000); } draw(); } }, T('Change address')),
        el('button', { class: 'btn small ghost', onclick: async () => { if (!confirm(T('Turn off the secure address at home? Browsers go back to the plain, unencrypted address, and it stays off until you turn it on again here.'))) return; await post('/api/local-https/off', {}).catch((err) => toast(err.message)); draw(); } }, T('Turn off'))));
    if (r.state === 'certificate' || (r.auto && !r.why)) setTimeout(() => { if (card.isConnected) draw(); }, 5000);
  };
  draw(); return card;
}
