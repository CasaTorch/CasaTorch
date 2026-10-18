/* The end of "Sign in with Home Assistant": tell the setup page, then close this little window. */
const T = (s, v) => (window.CasaI18n ? window.CasaI18n.T(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));
const q = new URLSearchParams(location.search), ok = q.get('ok') === '1', msg = q.get('msg') || '';
document.getElementById('t').textContent = ok ? T('✓ Home Assistant is connected') : T('That didn\'t work');
document.getElementById('back').textContent = T('Back to setup');
document.title = T('Home Assistant - CasaTorch');
document.getElementById('m').textContent = ok ? T('{msg}. You can close this window.', { msg: T(msg) }) : T(msg);
try { if (window.opener && window.opener.location.origin === location.origin) { window.opener.postMessage({ casatorchHa: ok }, location.origin); if (ok) setTimeout(() => window.close(), 900); } else document.getElementById('back').hidden = false; }
catch { document.getElementById('back').hidden = false; }
