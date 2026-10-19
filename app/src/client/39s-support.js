/* ======================================================================
 * Support (80-support.js): Get help in Settings › Health - troubleshooters
 * that run real checks, and a support file you see in full before you share
 * it; Activity in Settings › People & sign-in; Getting started on Home; how
 * the last update went in Settings › Updates; and an update notice that
 * doesn't nag ("Not now" hides it until the next version).
 * ====================================================================== */
document.head.append(el('style', {}, `
.sup-guides{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
.sup-guide{display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);color:inherit;font:inherit;font-size:14px;cursor:pointer;min-height:44px}
.sup-guide:hover,.sup-guide:focus-visible{border-color:var(--accent)}
.sup-guide .set-ic{flex:none}
.sup-pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:42vh;overflow:auto;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:6px 0 0}
.sup-what{margin:4px 0 6px;padding-left:18px;columns:2 240px;column-gap:24px}
.sup-what li{margin:2px 0;break-inside:avoid}
.sup-file h4{margin:12px 0 4px}
.sup-qr svg{width:132px;height:132px;background:#fff;border-radius:10px;padding:6px;display:block}
.sup-start{grid-column:1/-1;margin-bottom:14px}
.sup-start-card{padding:16px 18px}
.sup-bar{height:6px;border-radius:6px;background:var(--surface-2);overflow:hidden;margin:12px 0 10px}
.sup-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2,var(--accent)));border-radius:6px;transition:width .4s}
.sup-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.sup-item{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid var(--line);color:inherit;text-decoration:none;min-height:44px}
.sup-item:hover{border-color:var(--accent)}
.sup-item b{display:block;font-size:14px}.sup-item small{display:block;font-size:12px}
.sup-item.done b{text-decoration:line-through;opacity:.7}
.sup-tick{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--surface-2);color:var(--muted)}
.sup-item.done .sup-tick{background:var(--good);color:#fff}
.sup-notes{white-space:pre-wrap;max-height:220px;overflow:auto;padding:8px 10px;border-radius:10px;background:var(--surface-2)}
.sup-activity .ev{flex-wrap:wrap}
#banner .ban-x{margin-left:auto;background:none;border:0;color:inherit;opacity:.75;font:inherit;font-size:13px;cursor:pointer;padding:4px 6px;border-radius:8px}
#banner .ban-x:hover{opacity:1;background:rgba(127,127,127,.15)}
@media (max-width:760px){.sup-guides,.sup-items{grid-template-columns:1fr}}
`));
const SUP_DOT = { ok: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--accent)', off: 'var(--faint)' };
const SUP_WORD = { ok: 'OK', warn: 'Needs a look', bad: 'Not working', info: 'Good to know', off: 'Not checked' };
/* The ten things people get stuck on most. 'here' ones run in this browser (they're about this screen). */
const SUP_GUIDES = [
  ['reach', 'wifi', 'Can\'t open CasaTorch from my phone'],
  ['ha', 'home', 'Home Assistant stopped working'],
  ['cameras', 'camera', 'Cameras aren\'t showing'],
  ['slow3d', 'cube', 'The 3D home is slow on a tablet', true],
  ['remote', 'lock', 'Secure access isn\'t working'],
  ['locked', 'user', 'Forgot a password or locked out'],
  ['alerts', 'bell', 'Alerts don\'t reach my phone'],
  ['tablet', 'phone', 'The wall tablet goes to sleep', true],
  ['frigate', 'shield', 'Frigate\'s certificate changed'],
  ['update', 'download', 'An update didn\'t work'],
];
const supDocs = (anchor = '') => `${SITE}/docs/help/troubleshooting.html${anchor ? `#${anchor}` : ''}`;

/* ---- Settings › Health › Get help ---- */
async function supportHelpCard(s) {
  const grid = el('div', { class: 'sup-guides' }, SUP_GUIDES.map(([id, ic, title]) => el('button', { type: 'button', class: 'sup-guide', onclick: () => supGuideModal(id, s) }, el('span', { class: 'set-ic' }, icon(ic, 16)), el('span', { class: 'grow' }, T(title)), icon('chevr', 14))));
  const copyBtn = el('button', { class: 'btn' }, icon('list', 14), T('Copy summary'));
  copyBtn.onclick = async () => {
    copyBtn.disabled = true;
    try { const r = await api('/api/support/bundle'); await supCopy(r.summary); post('/api/support/bundle/shared', { how: 'summary' }).catch(() => {}); toast(T('Summary copied - paste it into your post or e-mail.'), 3500); }
    catch (e) { toast(e.message, 4000); }
    copyBtn.disabled = false;
  };
  return el('div', { class: 'card', id: 'gethelp', style: 'grid-column:1/-1' },
    el('h2', {}, icon('help', 16), T('Get help')),
    el('p', { class: 'small muted', style: 'margin-top:0' }, T('Pick what\'s wrong: CasaTorch runs real checks and tells you the fix.')),
    grid,
    el('div', { class: 'row wrap', style: 'margin-top:14px;gap:8px' },
      el('button', { class: 'btn primary', onclick: () => supFileModal() }, icon('download', 14), T('Make a support file')), copyBtn,
      el('a', { class: 'btn ghost', href: supDocs(), target: '_blank', rel: 'noopener' }, T('Troubleshooting guide')),
      el('a', { class: 'btn ghost', href: 'mailto:support@casatorch.com' }, T('E-mail support'))),   // scrub-ok: the public support address
    el('p', { class: 'tiny muted', style: 'margin:10px 0 0' }, T('A support file has no passwords, tokens, names or e-mail addresses in it. You see everything that\'s in it before you share it - CasaTorch never sends it anywhere by itself.')));
}
async function supCopy(text) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* not allowed here (plain http): the old way */ }
  const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
}
/* The support file: what's in it, the whole thing to read, then download or copy. */
const SUP_SECTIONS = [
  ['casatorch', 'Version, how it was installed, Basic or Pro'],
  ['system', 'The computer: system, memory, storage, uptime'],
  ['timings', 'How fast it answers'],
  ['health', 'The Health checks and what fixed itself'],
  ['integrations', 'Which integrations are set up (on/off and counts)'],
  ['people', 'How many accounts and roles - no names'],
  ['updates', 'Updates and how the last one went'],
  ['activityLast7Days', 'Counts of sign-ins and changes this week'],
  ['settingsShape', 'The names of your settings - never their values'],
  ['log', 'The last 200 lines of CasaTorch\'s log, masked'],
];
function supFileModal() {
  const ips = el('input', { type: 'checkbox', checked: true, style: 'width:auto' });
  const pre = el('pre', { class: 'sup-pre', tabindex: '0', 'aria-label': T('Everything in the support file') }, T('Making it…'));
  const sum = el('pre', { class: 'sup-pre small', style: 'max-height:140px' });
  const what = el('ul', { class: 'small sup-what' });
  const size = el('span', { class: 'tiny muted' });
  const dl = el('button', { class: 'btn primary', disabled: true }, icon('download', 14), T('Download file'));
  const cp = el('button', { class: 'btn', disabled: true }, T('Copy summary'));
  let cur = null;
  const load = async () => {
    dl.disabled = cp.disabled = true; pre.textContent = T('Making it…');
    try {
      cur = await api(`/api/support/bundle${ips.checked ? '' : '?ips=1'}`);
      pre.textContent = cur.text; sum.textContent = cur.summary;
      what.replaceChildren(...SUP_SECTIONS.filter(([k]) => cur.sections.includes(k)).map(([, label]) => el('li', {}, T(label))));
      size.textContent = T('{n} KB', { n: Math.max(1, Math.round(cur.bytes / 1024)) });
      dl.disabled = cp.disabled = false;
    } catch (e) { pre.textContent = e.message; }
  };
  ips.onchange = load;
  dl.onclick = () => {
    if (!cur) return;
    const a = el('a', { href: URL.createObjectURL(new Blob([cur.text], { type: 'application/json' })), download: `casatorch-support-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    post('/api/support/bundle/shared', { how: 'file', ips: !ips.checked }).catch(() => {});
    toast(T('Saved. Attach it to your e-mail to support@casatorch.com.'), 4000);   // scrub-ok: the public support address
  };
  cp.onclick = async () => { await supCopy(cur.summary); post('/api/support/bundle/shared', { how: 'summary' }).catch(() => {}); toast(T('Summary copied - paste it into your post or e-mail.'), 3500); };
  const m = modal(el('div', { class: 'sup-file' },
    el('p', { class: 'small', style: 'margin-top:0' }, T('This is exactly what the file contains. Passwords, tokens, keys, e-mail addresses, the names in your home and host names are masked.')),
    el('h4', {}, T('What\'s inside')), what,
    el('label', { class: 'row small', style: 'gap:8px;margin:8px 0' }, ips, T('Mask IP addresses too (leave on unless support asks for them)')),
    el('h4', {}, T('Summary for a forum post')), sum,
    el('div', { class: 'row between', style: 'margin-top:10px' }, el('h4', { style: 'margin:0' }, T('The whole file')), size), pre,
    el('div', { class: 'row wrap', style: 'justify-content:flex-end;gap:8px;margin-top:12px' }, cp, dl)), { title: T('Support file'), wide: true });
  m.classList.add('sup-modal');
  load();
}

/* ---- troubleshooters ---- */
function supStepRow(st, s, rerun) {
  const fix = st.fix ? el('button', { class: `btn small${st.status === 'bad' ? ' primary' : ''}` }, T(st.fix.label)) : null;
  if (fix) fix.onclick = async () => {
    const f = st.fix;
    if (f.guide) return supGuideModal(f.guide, s);
    if (f.local) { f.local(); toast(T('Done')); return rerun(); }
    if (f.href) { $('#modal')?.remove(); if (f.href.startsWith('#')) { location.hash = f.href; return; } return reconnectModal(f.href, s); }
    if (f.action) {
      fix.disabled = true;
      try { const r = await post('/api/doctor/fix', { action: f.action, id: f.id }); toast(TM(r.message || 'Done', r.msg, r.vars), 4500); await rerun(); }
      catch (e) { toast(e.message, 5000); fix.disabled = false; }
    }
  };
  return el('div', { class: 'health-row', style: 'display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-top:1px solid var(--line)' },
    el('span', { role: 'img', 'aria-label': T(SUP_WORD[st.status] || ''), title: T(SUP_WORD[st.status] || ''), style: `width:10px;height:10px;border-radius:50%;flex:none;margin-top:6px;background:${SUP_DOT[st.status] || SUP_DOT.info}` }),
    el('div', { class: 'grow', style: 'min-width:0' }, el('b', {}, T(st.title)), el('div', { class: 'small muted', style: 'margin-top:2px;overflow-wrap:anywhere' }, TM(st.detail, st.msg, st.vars)),
      st.why ? el('div', { class: 'small', style: 'margin-top:4px' }, T(st.why)) : null),
    fix);
}
async function supGuideModal(id, s) {
  const g = SUP_GUIDES.find((x) => x[0] === id); if (!g) return;
  $('#modal')?.remove();
  const body = el('div', { class: 'sup-steps', 'aria-live': 'polite' }, el('p', { class: 'small muted' }, T('Checking…')));
  const again = el('button', { class: 'btn small' }, icon('reset', 14), T('Check again'));
  const extra = el('div');
  const run = async () => {
    again.disabled = true; body.replaceChildren(el('p', { class: 'small muted' }, T('Checking…'))); extra.replaceChildren();
    let r;
    try { r = g[3] ? await SUP_HERE[id]() : await post(`/api/support/guides/${id}`, {}); }
    catch (e) { body.replaceChildren(el('p', { class: 'small', style: 'color:var(--bad)' }, e.message)); again.disabled = false; return; }
    const steps = r.steps || [], bad = steps.filter((x) => x.status === 'bad').length, warn = steps.filter((x) => x.status === 'warn').length;
    body.replaceChildren(
      el('div', { class: 'small', style: 'margin-bottom:4px' }, el('b', {}, bad ? T('Found the problem - the fix is below.') : warn ? T('Something needs a look - see below.') : T('Every check passed.'))),
      ...steps.map((st) => supStepRow(st, s, run)));
    if (r.qr) { const q = el('div', { class: 'sup-qr' }); q.innerHTML = r.qr; extra.append(el('div', { class: 'row', style: 'gap:14px;margin-top:12px;align-items:center' }, q, el('div', { class: 'small' }, el('b', {}, T('Scan with your phone')), el('div', { class: 'muted', style: 'overflow-wrap:anywhere' }, r.url)))); }   // an SVG made by this CasaTorch
    if (r.canTest) {
      const tb = el('button', { class: 'btn small' }, icon('bell', 14), T('Send me a test alert'));
      tb.onclick = async () => { tb.disabled = true; try { const x = await post('/api/support/test-alert', {}); toast(x.demo ? T('The demo doesn\'t change anything.') : x.ok ? T('Sent to {n} device(s) - did it arrive?', { n: x.sent }) : T('It couldn\'t be sent - see the checks above.'), 5000); } catch (e) { toast(e.message, 5000); } tb.disabled = false; };
      extra.append(el('div', { class: 'row', style: 'margin-top:12px' }, tb));
    }
    again.disabled = false;
  };
  again.onclick = run;
  modal(el('div', {}, body, extra,
    el('div', { class: 'row between wrap', style: 'margin-top:14px;gap:8px' }, el('a', { class: 'small', href: docUrl(`trouble.${id}`) || supDocs(SUP_ANCHOR[id]), target: '_blank', rel: 'noopener' }, T('Read the full guide')), again)), { title: T(g[2]), wide: true });
  run();
}
const SUP_ANCHOR = { reach: 'phone', ha: 'ha-test', cameras: 'camera', slow3d: 'slow', remote: 'secure-access', locked: 'password', alerts: 'alerts', tablet: 'tablet-sleep', frigate: 'frigate-cert', update: 'update-failed' };
/* The two checks that are about this screen, not the box. */
const supStep = (status, title, detail, extra = {}) => ({ status, title, detail, ...extra });
const SUP_HERE = {
  async slow3d() {
    const out = [];
    let gl = null, renderer = '';
    try { const c = document.createElement('canvas'); gl = c.getContext('webgl2') || c.getContext('webgl'); const dbg = gl?.getExtension('WEBGL_debug_renderer_info'); renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : ''; } catch { gl = null; }
    const soft = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
    out.push(!gl ? supStep('bad', 'Graphics', 'This browser can\'t draw 3D (WebGL is off or not supported).', { why: T('Update the browser, or turn on hardware acceleration in its settings.') })
      : soft ? supStep('bad', 'Graphics', 'The browser is drawing 3D without the graphics chip, so it\'s slow.', { why: T('Turn on hardware acceleration in the browser\'s settings, then restart it.') })
        : supStep('ok', 'Graphics', renderer ? TM(`3D works (${renderer.slice(0, 60)}).`, '3D works ({gpu}).', { gpu: renderer.slice(0, 60) }) : T('3D works.')));
    const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency || 0;
    out.push(mem && mem <= 2 || cores && cores <= 4 ? supStep('warn', 'This device', TM(`A smaller device (${mem ? `${mem} GB memory, ` : ''}${cores} cores).`, 'A smaller device ({cores} cores).', { cores }), { why: T('Use the Old tablet quality below - it draws fewer pixels and no shadows.') }) : supStep('ok', 'This device', TM(`${cores || '?'} cores${mem ? `, ${mem} GB memory` : ''}.`, '{cores} cores.', { cores: cores || '?' })));
    const fps = await new Promise((ok) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 1000) requestAnimationFrame(f); else ok(Math.round((n * 1000) / (t - t0))); }; requestAnimationFrame(f); });
    out.push(fps < 40 ? supStep('warn', 'Smoothness', TM(`This screen draws ${fps} frames a second while idle.`, 'This screen draws {n} frames a second while idle.', { n: fps }), { why: T('Close other apps and tabs; on a tablet, turn off battery saver.') }) : supStep('ok', 'Smoothness', TM(`${fps} frames a second.`, '{n} frames a second.', { n: fps })));
    const px = Math.round(screen.width * screen.height * (devicePixelRatio || 1) ** 2 / 1e6 * 10) / 10;
    if (px > 4 && (mem && mem <= 4 || cores && cores <= 6)) out.push(supStep('warn', 'Screen', TM(`A sharp screen (${px} million pixels) for this device's chip.`, 'A sharp screen ({n} million pixels) for this device\'s chip.', { n: px }), { why: T('The Old tablet quality draws at a lower sharpness - hardly visible on a wall, much faster.') }));
    let level = 'auto'; try { level = JSON.parse(localStorage.getItem('casatorch-3d-qlevel') || '"auto"'); } catch { /* default */ }
    const QW = { auto: 'Auto', old: 'Old tablet', normal: 'Normal', high: 'High' };
    out.push(level === 'old' ? supStep('ok', '3D quality on this screen', T('Old tablet - the fastest.')) : supStep('info', '3D quality on this screen', TM(`${QW[level] || level}. Old tablet is the fastest.`, '{level}. Old tablet is the fastest.', { level: T(QW[level] || level) }), { fix: { label: T('Use Old tablet quality'), local: () => { try { localStorage.setItem('casatorch-3d-qlevel', '"old"'); } catch { /* private window */ } } } }));
    out.push(supStep('info', 'Still slow?', T('Use the regular Home screen on this tablet and the 3D home on a newer screen - each screen can have its own layout.')));
    return { steps: out };
  },
  async tablet() {
    const out = [], ua = navigator.userAgent, ipad = /iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1, ios = /iPhone|iPad/.test(ua) || ipad, android = /Android/.test(ua);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    out.push(isPanel() ? supStep('ok', 'Panel mode', T('On - CasaTorch asks the screen to stay on.')) : supStep('warn', 'Panel mode', T('Off on this screen.'), { why: T('Panel mode keeps the screen on and hides the bars.'), fix: { label: T('Turn on panel mode'), local: () => setPanel(true) } }));
    out.push('wakeLock' in navigator ? supStep('ok', 'Keep the screen on', T('This browser can keep the screen on.')) : supStep('warn', 'Keep the screen on', T('This browser can\'t keep the screen on by itself.'), { why: ios ? T('Set Auto-Lock to Never on the iPad.') : T('Use the device\'s own "stay awake" setting, or a kiosk browser.') }));
    if (location.protocol !== 'https:' && 'wakeLock' in navigator === false && !/^(localhost|127\.)/.test(location.hostname)) out.push(supStep('info', 'Secure address', T('Browsers only keep the screen on for a secure (https) address - use the secure address at home on this tablet.')));
    if (ios) out.push(supStep('info', 'iPad settings', T('Settings › Display & Brightness › Auto-Lock › Never. For a wall: Settings › Accessibility › Guided Access keeps CasaTorch on screen.')));
    else if (android) out.push(supStep('info', 'Android settings', T('Settings › Display › Screen timeout to the longest, or Developer options › Stay awake while charging. A kiosk browser such as Fully Kiosk can keep it on and restart CasaTorch.')));
    else out.push(supStep('info', 'Screen settings', T('Turn off sleep and the screen saver in the device\'s power settings.')));
    out.push(supStep('info', 'Wi-Fi asleep', android ? T('If the tablet loses Wi-Fi when the screen dims: Wi-Fi › Advanced › Keep Wi-Fi on during sleep: Always, and turn off battery optimization for the browser.') : T('If the tablet loses Wi-Fi when the screen dims, turn off low-power or battery saver mode. CasaTorch reconnects by itself when Wi-Fi comes back.')));
    if (!standalone && (ios || android)) out.push(supStep('info', 'Add to Home Screen', T('Added to the Home Screen, CasaTorch opens full screen like an app - best for a wall.')));
    return { steps: out };
  },
};

/* ---- Settings › People & sign-in › Activity (admins) ---- */
const SUP_EVENT = {
  'signed-in': 'Signed in', 'signed-out': 'Signed out', 'panel-signed-in': 'Wall panel signed in', 'login-failed': 'Wrong password', 'login-limited': 'Too many tries - paused', 'code-failed': 'Wrong two-step code',
  'google-unknown': 'Unknown Google account tried', 'google-failed': 'Google sign-in failed', 'google-linked': 'Linked Google', 'terms-accepted': 'Accepted the terms', 'invite-accepted': 'Accepted an invite',
  'password-changed': 'Changed password', '2fa-on': 'Turned on two-step sign-in', '2fa-off': 'Turned off two-step sign-in', '2fa-skipped': 'Skipped two-step sign-in', 'recovery-codes-new': 'Made new recovery codes', 'recovery-code-used': 'Used a recovery code',
  'session-ended': 'Ended a session', 'other-sessions-ended': 'Signed out other devices', 'owner-reset-asked': 'Owner reset code asked for', 'owner-reset': 'Owner password reset with a code from the box', 'owner-reset-failed': 'Wrong owner reset code',
  'user-added': 'Added a person', 'user-removed': 'Removed a person', 'user-reset': 'Reset someone\'s password', 'role-changed': 'Changed a role', 'owner-saved': 'Owner account saved', 'policy-changed': 'Changed the two-step rule',
  'google-on': 'Set up Google sign-in', 'google-off': 'Turned off Google sign-in', 'panel-link-made': 'Made a wall panel link', 'panel-link-revoked': 'Revoked a wall panel link',
  'phone-paired': 'Paired a phone', 'pairing-code-made': 'Made a pairing code', 'alerts-device-on': 'Turned on alerts on a device', 'alerts-device-off': 'Turned off alerts on a device', 'alerts-phone-on': 'Turned on alerts in the app', 'alerts-phone-off': 'Turned off alerts in the app',
  'settings-changed': 'Changed settings', 'setup-reopened': 'Opened setup again', 'ai-settings-changed': 'Changed the Home AI Agent', 'alert-settings-changed': 'Changed alert settings', 'security-settings-changed': 'Changed security settings', 'update-settings-changed': 'Changed update settings',
  'find-setting-changed': 'Changed casatorch.com/home', 'safety-exception-changed': 'Changed a safety exception', 'license-added': 'Added a license key', 'license-removed': 'Removed the license key', 'connection-removed': 'Removed a connection', 'settings-put-back': 'Put back saved settings', 'floorplan-imported': 'Imported a floor plan',
  'secure-access-on': 'Turned on secure access', 'secure-access-off': 'Turned off secure access', 'secure-access-repaired': 'Set up secure access again', 'home-https-on': 'Turned on the secure address at home', 'home-https-off': 'Turned off the secure address at home',
  'backup-made': 'Made a backup', 'backup-restored': 'Restored a backup', 'floorplan-exported': 'Exported the floor plan', 'diagnostics-downloaded': 'Downloaded diagnostics', 'support-file-made': 'Made a support file', 'support-summary-copied': 'Copied a support summary',
  restarted: 'Restarted CasaTorch', updated: 'Updated CasaTorch', 'alert-acknowledged': 'Acknowledged an alert',
};
const SUP_KINDS = [['all', 'Everything'], ['signin', 'Sign-ins'], ['failed', 'Failed attempts'], ['account', 'Accounts'], ['people', 'People'], ['pairing', 'Phones & pairing'], ['settings', 'Settings'], ['remote', 'Secure access'], ['exports', 'Exports'], ['system', 'System']];
async function activityCard() {
  const me = await api('/api/auth/me').catch(() => null);
  if (!me?.signIn || me.user?.panel || !['admin', 'owner'].includes(me.user?.role)) return null;
  const f = { kind: 'all', q: '', days: 30 };
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': T('Show') });
  const q = el('input', { type: 'search', placeholder: T('Search activity'), 'aria-label': T('Search activity'), style: 'flex:1;min-width:160px' });
  const days = el('select', { 'aria-label': T('Period'), style: 'width:auto' }, [[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days'], [365, 'Last year'], [0, 'Everything kept']].map(([v, l]) => el('option', { value: v, selected: v === f.days ? true : null }, T(l))));
  const list = el('div', { class: 'audit sup-activity' }), foot = el('div', { class: 'row between wrap', style: 'margin-top:8px;gap:8px' });
  const drawChips = () => chips.replaceChildren(...SUP_KINDS.map(([k, l]) => el('button', { type: 'button', class: `chip${f.kind === k ? ' on' : ''}`, 'aria-pressed': String(f.kind === k), onclick: () => { f.kind = k; drawChips(); load(); } }, T(l))));
  const line = (e) => {
    const who = [e.user, e.added || e.removed || e.of || e.panel || e.device, e.fields?.length ? e.fields.join(', ') : null, e.from && e.to ? `${e.from} → ${e.to}` : null, e.ip].filter(Boolean).join(' · ');
    return el('div', { class: `ev${e.bad ? ' bad' : ''}` }, el('span', { class: 'when', title: new Date(e.at).toLocaleString() }, fmtWhen(e.at)), el('b', {}, T(SUP_EVENT[e.event] || e.event)), el('span', { class: 'small muted', style: 'overflow-wrap:anywhere' }, who));
  };
  let tq = null;
  const load = async (more = null) => {
    const p = new URLSearchParams({ kind: f.kind, q: f.q, days: String(f.days) }); if (more) p.set('before', more);
    let r; try { r = await api(`/api/support/activity?${p}`); } catch (e) { list.replaceChildren(el('p', { class: 'small muted' }, e.message)); return; }
    if (!more) list.replaceChildren();
    list.append(...r.events.map(line));
    if (!list.children.length) list.append(el('p', { class: 'small muted' }, T('Nothing matches.')));
    const last = r.events[r.events.length - 1];
    foot.replaceChildren(...[el('span', { class: 'tiny muted' }, T('Kept for a year, at most {n} events.', { n: r.keepMax.toLocaleString() })), r.more && last ? el('button', { class: 'btn small', onclick: () => load(last.at) }, T('Show more')) : null].filter(Boolean));
  };
  q.oninput = () => { clearTimeout(tq); tq = setTimeout(() => { f.q = q.value.trim(); load(); }, 250); };
  days.onchange = () => { f.days = Number(days.value); load(); };
  drawChips(); load();
  return el('div', { class: 'card wide', id: 'activity', style: 'grid-column:1/-1' }, el('h2', {}, icon('log', 15), T('Activity')),
    el('p', { class: 'small muted', style: 'margin-top:0' }, T('Sign-ins, failed attempts, changes to settings and people, pairing, secure access and exports. Only what changed is recorded - never passwords or values.')),
    chips, el('div', { class: 'row wrap', style: 'gap:8px;margin:10px 0' }, q, days), list, foot);
}

/* ---- Home: getting started (admins, after setup, until done or hidden) ---- */
const SUP_CHECK = {
  ha: ['home', 'Connect Home Assistant', 'Or your lights, plugs and cameras directly'],
  twostep: ['lock', 'Turn on two-step sign-in', 'A code from your phone, so a password alone can\'t get in'],
  phone: ['phone', 'Add your phone', 'The CasaTorch app or the web app on your phone'],
  alerts: ['bell', 'Turn on alerts', 'Leaks, smoke and the doorbell on your phone'],
  backup: ['download', 'Make a backup', 'One encrypted file to keep somewhere safe'],
  town: ['sun', 'Add your town', 'For the weather and the rain radar'],
  '3d': ['cube', 'Try the 3D home', 'Your home in 3D, live'],
};
function supportChecklist(main) {
  const box = el('div', { class: 'sup-start', hidden: true }); main.append(box);
  (async () => {
    let st; try { st = await api('/api/support/checklist'); } catch { return; }
    if (!st.show || !box.isConnected) return;
    const hide = el('button', { class: 'btn ghost small', 'aria-label': T('Hide getting started'), onclick: async () => { box.remove(); try { await post('/api/support/checklist', { dismissed: true }); toast(T('Hidden. Find it again in Settings › Help.'), 3500); } catch { /* next time */ } } }, T('Hide'));
    const all = st.done === st.total;
    box.replaceChildren(el('div', { class: 'card sup-start-card' },
      el('div', { class: 'row between', style: 'gap:10px' }, el('div', {}, el('h2', { style: 'margin:0' }, all ? T('You\'re all set') : T('Getting started')), el('div', { class: 'small muted' }, T('{n} of {total} done', { n: st.done, total: st.total }))), hide),
      el('div', { class: 'sup-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(st.total), 'aria-valuenow': String(st.done) }, el('i', { style: `width:${Math.round((st.done / st.total) * 100)}%` })),
      el('div', { class: 'sup-items' }, st.items.map((it) => { const [ic, title, sub] = SUP_CHECK[it.id] || ['check', it.id, '']; return el('a', { class: `sup-item${it.done ? ' done' : ''}`, href: it.href.startsWith('#') ? it.href : sameOrigin(it.href, '/setup.html'), 'aria-label': `${T(title)}${it.done ? ` - ${T('done')}` : ''}` },
        el('span', { class: 'sup-tick', 'aria-hidden': 'true' }, it.done ? icon('check', 14) : icon(ic, 15)), el('span', { class: 'grow', style: 'min-width:0' }, el('b', {}, T(title)), el('small', { class: 'muted' }, T(sub)))); }))));
    box.hidden = false;
  })();
}
/* Opening the 3D home ticks "Try the 3D home" (once per browser). */
addEventListener('hashchange', () => {
  if (!/^#house3d\b/.test(location.hash)) return;
  try { if (localStorage.getItem('casatorch-seen3d')) return; localStorage.setItem('casatorch-seen3d', '1'); } catch { /* private window: tell it anyway */ }
  post('/api/support/checklist', { seen: '3d' }).catch(() => {});
});
/* Settings › Help: bring getting started back. */
async function supportStartAgainCard() {
  const me = await api('/api/auth/me').catch(() => null);
  if (me?.signIn && !['admin', 'owner'].includes(me.user?.role)) return null;
  return el('div', { class: 'card' }, el('h2', {}, T('Getting started')), el('p', { class: 'small muted', style: 'margin-top:0' }, T('The checklist on Home that ticks itself off as you set things up.')),
    el('button', { class: 'btn', onclick: async () => { try { await post('/api/support/checklist', { dismissed: false }); location.hash = '#home'; } catch (e) { toast(e.message); } } }, T('Show it on Home')));
}

/* ---- Settings › Updates: how the last update went, and the release notes ---- */
async function updateStatusCard() {
  const [u, st] = await Promise.all([api('/api/updates').catch(() => null), api('/api/support/update-status').catch(() => null)]);
  if (!u || !st) return null;
  const rows = [];
  if (u.available && u.notes) rows.push(el('h3', {}, T('What\'s in {v}', { v: u.latest })), el('div', { class: 'small sup-notes' }, String(u.notes).slice(0, 3000)));
  const L = st.last, STATE = { checking: 'Checking', downloading: 'Downloading', installing: 'Installing', verifying: 'Checking that it starts', done: T('Done'), 'rolled-back': 'Went back to the version you had', failed: 'Didn\'t finish' };
  if (L?.state && L.state !== 'done' && !/fail|rolled/.test(L.state)) rows.push(el('p', { class: 'small' }, el('b', {}, T('Updating now:')), ' ', T(STATE[L.state] || L.state), L.to ? ` - ${L.to}` : ''));
  if (L && /fail|rolled/.test(L.state)) rows.push(el('div', { class: 'small', style: 'padding:10px 12px;border-radius:10px;background:color-mix(in srgb, var(--bad) 12%, transparent);margin:6px 0' }, el('b', {}, T(STATE[L.state] || L.state)), L.to ? ` (${L.to})` : '', L.message ? el('div', { class: 'muted' }, L.message) : null, el('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => supGuideModal('update') }, T('What to do'))));
  if (st.previous) rows.push(el('p', { class: 'small muted' }, T('Updated from {from} {when}.', { from: st.previous, when: st.since ? ago(st.since) : '' })));
  rows.push(el('ul', { class: 'small muted sup-what' }, el('li', {}, T('Before every update, CasaTorch saves a copy of your settings (Health › Settings history).')), st.rollback ? el('li', {}, T('If the new version doesn\'t start, CasaTorch goes back to the one you had by itself.')) : null));
  return el('div', { class: 'card' }, el('h2', {}, T('How updating works')), ...rows);
}

/* ---- the update notice: "Not now" hides it until the next version ---- */
const SUP_SNOOZE = 'casatorch-update-snooze';
const updSnoozed = (v) => { try { return !!v && localStorage.getItem(SUP_SNOOZE) === String(v); } catch { return false; } };
function updSnoozeBtn(v) {
  return el('button', { type: 'button', class: 'ban-x', 'aria-label': T('Not now'), title: T('Not now'), onclick: () => { try { localStorage.setItem(SUP_SNOOZE, String(v)); } catch { /* private window */ } drawBanner(); } }, T('Not now'));
}
