/* The end of "Sign in with Home Assistant": tell the setup page, then close this little window. */
const q = new URLSearchParams(location.search), ok = q.get('ok') === '1', msg = q.get('msg') || '';
document.getElementById('t').textContent = ok ? '✓ Home Assistant is connected' : 'That didn\'t work';
document.getElementById('m').textContent = ok ? `${msg}. You can close this window.` : msg;
try { if (window.opener && window.opener.location.origin === location.origin) { window.opener.postMessage({ casatorchHa: ok }, location.origin); if (ok) setTimeout(() => window.close(), 900); } else document.getElementById('back').hidden = false; }
catch { document.getElementById('back').hidden = false; }
