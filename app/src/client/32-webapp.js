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
