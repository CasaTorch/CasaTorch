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
  const card = el('div', { class: 'card' }, el('h2', {}, icon('bell', 15), 'Phone app & alerts'));
  const body = el('div'); card.append(body);
  const add = (...kids) => body.append(...kids.filter((k) => k != null && k !== false));
  const draw = async () => {
    const info = await api('/api/push').catch(() => null);
    const me = await api('/api/auth/me').catch(() => null), admin = !me || me.signIn === false || ['owner', 'admin'].includes(me.user?.role);
    body.replaceChildren();
    /* 1. Install */
    const install = isStandalone() ? el('p', { class: 'small good' }, '✓ You\'re using the installed app.')
      : installPrompt ? el('button', { class: 'btn', onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; draw(); } }, icon('plus'), 'Install CasaTorch on this device')
      : isIOS ? el('p', { class: 'small muted' }, 'To install on this iPhone or iPad: tap the Share button in Safari, then "Add to Home Screen".')
      : el('p', { class: 'small muted' }, 'To install: use your browser\'s "Install app" or "Add to Home screen" menu item.');
    add(el('h3', { class: 'sub' }, 'Install'), install);
    /* 2. Alerts on this device */
    add(el('h3', { class: 'sub' }, 'Alerts on this device'));
    if (!isSecureContext) {
      add(el('p', { class: 'small muted' }, `Phones only allow app installs and alerts on a secure (https) address, and this page is on ${location.host} (http). Turn on Secure access (on this page) and open CasaTorch at its https address on your phone.`),
        info?.haPhone ? el('p', { class: 'small good' }, '✓ Alerts already go to the Home Assistant app on your phones.') : el('p', { class: 'small muted' }, 'Using Home Assistant? Its phone app can get CasaTorch alerts today - turn it on below.'));
    } else if (!('PushManager' in window) || !('Notification' in window)) {
      add(el('p', { class: 'small muted' }, isIOS && !isStandalone() ? 'On iPhone and iPad, alerts work in the installed app: add CasaTorch to your Home Screen first (above), open it from there, and come back here.' : 'This browser can\'t show alerts.'));
    } else {
      const sub = await mySubscription(), mine = sub && info?.devices.find((d) => d.id === localStorage.getItem('casatorch-push-id'));
      const level = el('select', { 'aria-label': 'Which alerts' }, ...[['critical', 'Only critical (water, smoke, internet down)'], ['important', 'Important (also offline devices, doorbell)'], ['all', 'Everything (also low batteries, motion)']].map(([v, t]) => el('option', { value: v, selected: (mine?.level || 'important') === v ? true : null }, t)));
      if (mine) {
        level.onchange = () => post(`/api/push/${mine.id}`, { level: level.value }, 'PUT').then(() => toast('Saved')).catch((e) => toast(e.message));
        add(el('p', { class: 'small good' }, '✓ Alerts are on for this device.'), el('label', { class: 'field' }, el('span', {}, 'Send'), level),
          el('div', { class: 'row wrap', style: 'gap:8px' }, el('button', { class: 'btn small', onclick: () => post(`/api/push/${mine.id}/test`, {}).then(() => toast('Sent - it should appear in a few seconds')).catch((e) => toast(e.message, 5000)) }, 'Send a test'),
            el('button', { class: 'btn small ghost', onclick: async () => { await sub.unsubscribe().catch(() => {}); await api(`/api/push/${mine.id}`, { method: 'DELETE' }).catch(() => {}); try { localStorage.removeItem('casatorch-push-id'); } catch { /* fine */ } draw(); } }, 'Turn off')));
      } else {
        add(el('label', { class: 'field' }, el('span', {}, 'Send'), level), el('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          try {
            if (await Notification.requestPermission() !== 'granted') throw new Error('Alerts are blocked for CasaTorch in this browser\'s settings.');
            const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
            const s = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.key) });
            const r = await post('/api/push', { subscription: s.toJSON(), level: level.value, name: deviceName() });
            try { localStorage.setItem('casatorch-push-id', r.id); } catch { /* fine */ }
            await post(`/api/push/${r.id}/test`, {}).catch(() => {});
            toast('Alerts are on - a test alert is on its way.', 4000);
          } catch (err) { toast(err.message, 5000); }
          draw();
        } }, icon('bell'), 'Turn on alerts here'));
      }
    }
    const others = (info?.devices || []).filter((d) => d.id !== (() => { try { return localStorage.getItem('casatorch-push-id'); } catch { return null; } })());
    if (others.length) add(el('h3', { class: 'sub' }, 'Your other devices with alerts'), ...others.map((d) => el('div', { class: 'row between', style: 'gap:8px;margin:6px 0' }, el('span', {}, d.name, d.broken ? el('small', { class: 'muted' }, ' · not reachable') : null),
      el('button', { class: 'btn small ghost', onclick: () => api(`/api/push/${d.id}`, { method: 'DELETE' }).then(draw) }, 'Remove'))));
    /* 3. House-wide settings */
    if (admin && info) {
      const quiet = el('select', { onchange: () => post('/api/alerts/settings', { quietHours: quiet.value }, 'PUT').then(() => toast('Saved')).catch((e) => toast(e.message)) }, ...[['22-7', '10 PM to 7 AM'], ['23-6', '11 PM to 6 AM'], ['21-6', '9 PM to 6 AM'], ['none', 'None']].map(([v, t]) => el('option', { value: v, selected: info.quietHours === v ? true : null }, t)));
      const ha = el('input', { type: 'checkbox', checked: info.haPhone ? true : null, onchange: () => post('/api/alerts/settings', { haPhone: ha.checked }, 'PUT').then(() => toast('Saved')).catch((e) => toast(e.message)) });
      add(el('h3', { class: 'sub' }, 'For everyone'), el('label', { class: 'field' }, el('span', {}, 'Quiet hours (only critical alerts get through)'), quiet),
        info.ha ? el('label', { class: 'field check' }, ha, el('span', {}, 'Also send alerts to the Home Assistant app on your phones')) : null);
      /* Smart alerts (Pro) */
      const set = (k) => (e) => post('/api/alerts/settings', { [k]: e.target.checked }, 'PUT').then(() => toast('Saved')).catch((x) => { e.target.checked = !e.target.checked; toast(x.message); });
      const away = el('input', { type: 'checkbox', checked: info.awayOnly ? true : null, disabled: !info.pro || !info.people ? true : null, onchange: set('awayOnly') });
      const rep = el('input', { type: 'checkbox', checked: info.repeat ? true : null, disabled: !info.pro ? true : null, onchange: set('repeat') });
      add(el('h3', { class: 'sub' }, 'Smart alerts ', el('span', { class: 'pill pro' }, 'Pro')),
        el('label', { class: 'field check' }, away, el('span', {}, 'Doorbell and motion alerts only when nobody\'s home', el('span', { class: 'small muted', style: 'display:block' }, info.people ? `Uses the ${info.people} ${info.people === 1 ? 'person or phone' : 'people and phones'} Home Assistant tracks. They still show on the dashboard.` : 'Needs people or phones tracked in Home Assistant (the Home Assistant phone app does this).'))),
        el('label', { class: 'field check' }, rep, el('span', {}, 'Repeat critical alerts every 10 minutes until someone taps "Got it"', el('span', { class: 'small muted', style: 'display:block' }, 'Water, smoke and the internet going down. Up to 6 reminders.'))),
        el('p', { class: 'small muted' }, 'For everyone: an alert has to still be there a minute later before it goes out, so a sensor that blinks offline doesn\'t wake anyone up. Water and smoke go out straight away.'));
    }
  };
  draw(); return card;
}

/* Settings > Secure access: this CasaTorch at its own https address. */
async function remoteCard() {
  const card = el('div', { class: 'card' }, el('h2', {}, icon('lock', 15), 'Secure access'));
  const body = el('div'); card.append(body);
  const draw = async () => {
    const r = await api('/api/remote').catch(() => null);
    const me = await api('/api/auth/me').catch(() => null), admin = !me || me.signIn === false || ['owner', 'admin'].includes(me.user?.role);
    body.replaceChildren();
    if (!r) return body.append(el('p', { class: 'small muted' }, 'Not available right now.'));
    const add = (...k) => body.append(...k.filter(Boolean));
    if (!r.on) {
      add(el('p', { class: 'small muted', style: 'margin-top:0' }, 'Give this CasaTorch its own secure https address, so phones can install the CasaTorch app and get alerts. Nothing to change on your router. Everyone still signs in as usual.'),
        el('p', { class: 'small muted' }, r.anywhere ? 'With Pro, the address works from anywhere - at home or away.' : 'On Basic, the address works on your home Wi-Fi. Using it from anywhere is part of Pro.'),
        !r.supported ? el('p', { class: 'small bad' }, 'Secure access isn\'t available on this kind of computer yet.') : null,
        admin && r.supported ? el('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Setting up… (up to a minute)'; try { await post('/api/remote/on', {}); toast('Secure access is on'); } catch (err) { toast(err.message, 6000); } draw(); } }, icon('lock'), 'Turn on secure access') : null);
      if (r.why) add(el('p', { class: 'small bad' }, r.why));
      return;
    }
    const st = { connected: ['good', 'Connected'], connecting: ['warn', 'Connecting…'], downloading: ['warn', 'Getting ready…'], off: ['warn', 'Starting…'], error: ['bad', 'Not working'] }[r.state] || ['warn', r.state];
    const qr = el('div', { class: 'qr', style: 'width:150px;height:150px;background:#fff;border-radius:12px;padding:8px' }); qr.innerHTML = r.qr || '';   // server-made SVG
    add(el('div', { class: 'row', style: 'gap:8px;align-items:center' }, el('span', { class: `dot ${st[0]}` }), el('b', {}, st[1])),
      el('p', {}, el('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.url)),
      el('div', { class: 'row wrap', style: 'gap:16px;align-items:center' }, qr, el('p', { class: 'small muted', style: 'max-width:340px' }, 'Scan this with your phone camera to open CasaTorch at its secure address, sign in, then add it to your home screen and turn on alerts (Settings › Phone app & alerts).')),
      el('p', { class: 'small muted' }, r.anywhere ? 'Works from anywhere (Pro).' : 'Works on your home Wi-Fi. From anywhere is part of Pro.'),
      r.why ? el('p', { class: 'small bad' }, r.why) : null,
      admin ? el('button', { class: 'btn small ghost', onclick: async () => { if (!confirm('Turn off secure access? The address stops working on every phone.')) return; await post('/api/remote/off', {}).catch((err) => toast(err.message)); draw(); } }, 'Turn off') : null);
    if (r.state !== 'connected') setTimeout(() => { if (card.isConnected) draw(); }, 4000);
  };
  draw(); return card;
}
/* Settings > Secure address at home: https straight to this box on the home network (43-local-https.js). */
async function localHttpsCard() {
  const card = el('div', { class: 'card' }, el('h2', {}, icon('lock', 15), 'Secure address at home'));
  const body = el('div'); card.append(body);
  const draw = async () => {
    const r = await api('/api/local-https').catch(() => null);
    body.replaceChildren();
    if (!r) { card.remove(); return; }   // admins only
    const add = (...k) => body.append(...k.filter(Boolean));
    if (!r.on) {
      const ip = el('input', { type: 'text', value: r.detected || '', placeholder: '192.168.1.20', inputmode: 'decimal', style: 'max-width:180px' });
      add(el('p', { class: 'small muted', style: 'margin-top:0' }, 'Use CasaTorch over https at home, so sign-ins and everything else are encrypted on your Wi-Fi. Browsers in the house connect straight to this CasaTorch - nothing goes out to the internet - and the plain address sends them to the secure one automatically.'),
        el('p', { class: 'small muted' }, 'CasaTorch gets a free certificate from Let\'s Encrypt for its own name, which points at its address on your network. That address (like 192.168.1.20) is listed in public DNS under a random name; it can\'t be reached from the internet.'),
        r.demo ? el('p', { class: 'small muted' }, 'Not in the demo.') : el('div', { class: 'row wrap', style: 'gap:8px;align-items:center' }, el('span', { class: 'small muted' }, 'This CasaTorch\'s address on your network'), ip,
          el('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Setting up… (about a minute)'; try { await post('/api/local-https/on', { ip: ip.value.trim() === r.detected ? undefined : ip.value.trim() }); } catch (err) { toast(err.message, 5000); } draw(); } }, 'Turn on')));
      if (r.why) add(el('p', { class: 'small bad' }, r.why));
      return;
    }
    const st = { ready: ['good', 'Working'], certificate: ['warn', 'Getting the certificate… (about a minute)'], error: ['bad', 'Not working'], off: ['warn', 'Starting…'] }[r.state] || ['warn', r.state];
    add(el('div', { class: 'row', style: 'gap:8px;align-items:center' }, el('span', { class: `dot ${st[0]}` }), el('b', {}, st[1])),
      el('p', {}, el('a', { href: r.url }, r.url)),
      el('p', { class: 'small muted' }, `Points at ${r.ip}${r.expires ? ` · certificate renews itself before ${fmt(r.expires, { dateStyle: 'medium' })}` : ''}. Bookmark this address on your computers and wall tablets.`),
      r.why ? el('p', { class: 'small bad' }, r.why) : null,
      r.state === 'ready' && location.protocol === 'http:' ? el('p', { class: 'small' }, 'You\'re on the plain address. ', el('a', { href: r.url + location.pathname + location.hash }, 'Switch to the secure one')) : null,
      el('details', {}, el('summary', { class: 'small muted' }, 'Doesn\'t open on some devices?'),
        el('p', { class: 'small muted' }, 'Some routers block names that point into the home network ("DNS rebinding protection"). Those devices keep using the plain address. To fix it, allow casatorch.com in that router setting, or set your router\'s DNS to 1.1.1.1.')),
      el('div', { class: 'row wrap', style: 'gap:8px' },
        el('button', { class: 'btn small', onclick: async () => { const v = prompt('This CasaTorch\'s address on your network', r.ip || ''); if (!v) return; try { await post('/api/local-https/ip', { ip: v.trim() }); toast('Address updated'); } catch (err) { toast(err.message, 5000); } draw(); } }, 'Change address'),
        el('button', { class: 'btn small ghost', onclick: async () => { if (!confirm('Turn off the secure address at home? Browsers go back to the plain address.')) return; await post('/api/local-https/off', {}).catch((err) => toast(err.message)); draw(); } }, 'Turn off')));
    if (r.state === 'certificate') setTimeout(() => { if (card.isConnected) draw(); }, 5000);
  };
  draw(); return card;
}
