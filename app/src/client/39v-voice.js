/* ---- Settings › Voice assistants (Pro): Alexa, Google Home, Apple Home and SmartThings through CasaTorch's Matter
   bridge (scan a code, pick what's shared, see and remove the apps it's added to), and "Ask CasaTorch" from Siri with
   a token per phone. Locks, garage doors, gates and alarms are never shared - the box enforces it (79v-voice.js). ---- */
ICONS.mic ||= 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3';
document.head.append(el('style', {}, `
.vo-status{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:var(--surface-2);margin:10px 0}
.vo-status .dot{margin-top:5px}
.vo-pair{display:grid;grid-template-columns:minmax(0,180px) 1fr;gap:18px;align-items:center;margin:12px 0}
.vo-qr{background:#fff;border-radius:14px;padding:10px;line-height:0;max-width:180px}
.vo-qr svg{width:100%;height:auto;display:block}
.vo-code{font:700 28px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;margin:4px 0 8px;overflow-wrap:anywhere}
.vo-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 8px}
.vo-tabs button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#04121f}
.vo-steps{margin:0;padding-left:20px;display:grid;gap:4px}
.vo-row{display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.vo-row:first-child{border-top:0}
.vo-row .grow{min-width:0;flex:1}
.vo-row input[type=checkbox]{flex:none;width:20px;height:20px;margin:0;padding:0;accent-color:var(--accent)}
label.vo-row{cursor:pointer}
.vo-row b{display:block;font-size:14px}
.vo-row small{display:block;color:var(--muted);font-size:12px;line-height:1.4}
.vo-list{max-height:55vh;overflow:auto;margin:6px 0}
.vo-group{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 2px}
.vo-never{opacity:.7}
.vo-token{font:600 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:10px 12px;border-radius:10px;background:var(--surface-2);overflow-wrap:anywhere;user-select:all}
.vo-kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;font-size:13px;margin:8px 0}
.vo-kv dt{color:var(--muted)} .vo-kv dd{margin:0;overflow-wrap:anywhere}
@media (max-width:600px){.vo-pair{grid-template-columns:1fr}.vo-qr{max-width:200px;margin:0 auto}.vo-code{font-size:24px;text-align:center}}
`));
const VO_KIND = { light: 'Lights', plug: 'Plugs and switches', switch: 'Plugs and switches', fan: 'Fans', cover: 'Blinds and shades', climate: 'Thermostats', action: 'Scenes', sensor: 'Sensors', lock: 'Never shared', alarm: 'Never shared' };
const VO_STEPS = {
  alexa: ['Open the Alexa app and tap Devices, then +.', 'Tap Add Device, then Other, then Matter.', 'Scan the code (or type the 11 digits).', 'Alexa finds the devices CasaTorch shares. Say "Alexa, turn off the kitchen lights".'],
  google: ['Open the Google Home app and tap Devices, then Add.', 'Tap Matter-enabled device and scan the code (or type the 11 digits).', 'Pick a room for each device when it asks.', 'Say "Hey Google, turn on the porch light".'],
  apple: ['Open the Home app on your iPhone and tap +, then Add Accessory.', 'Scan the code (or tap More options and type the 11 digits).', 'If it says Uncertified Accessory, tap Add Anyway.', 'Pick rooms, then say "Hey Siri, turn off the bedroom fan".'],
  smartthings: ['Open the SmartThings app and tap +, then Device.', 'Tap Scan QR code (or Partner devices, then Matter).', 'Scan the code (or type the 11 digits).', 'The devices CasaTorch shares show up in SmartThings.'],
};
const VO_APPS = [['alexa', 'Alexa'], ['google', 'Google Home'], ['apple', 'Apple Home'], ['smartthings', 'SmartThings']];
async function voiceCards() {
  const host = el('div', { style: 'display:contents' });
  let v = null, poll = null, tab = 'alexa';
  const load = async () => { v = await api('/api/settings/voice', { timeout: 15000 }); };
  const put = async (body) => { try { v = await post('/api/settings/voice', body, 'PUT'); draw(); } catch (e) { toast(e.message, 5000); } };
  const keepPolling = () => {
    clearInterval(poll);
    if (!v || !(v.on && (v.state === 'starting' || (v.pairing && !v.pairing.sample) || v.state === 'error'))) return;
    poll = setInterval(async () => {
      if (!host.isConnected) { clearInterval(poll); return; }
      const before = JSON.stringify([v.state, v.commissioned, v.fabrics?.length, v.pairing?.manual, v.devices]);
      try { await load(); } catch { return; }
      if (JSON.stringify([v.state, v.commissioned, v.fabrics?.length, v.pairing?.manual, v.devices]) !== before) draw();
    }, 3000);
  };
  const statusLine = () => {
    const s = v.state, apps = (v.fabrics || []).map((f) => f.name);
    const [dot, text, sub] = s === 'demo' ? ['warn', T('This is the demo'), T('The code below is a sample: nothing can be added from the demo.')]
      : s === 'needs-pro' ? ['warn', T('Off while Pro is off'), T('Your pairings are kept and come back with Pro.')]
      : s === 'off' ? ['', T('Off'), T('Nothing is shared with voice assistants.')]
      : s === 'starting' ? ['warn', T('Starting…'), T('This takes a few seconds.')]
      : s === 'error' ? ['bad', v.error || T('Voice assistants aren\'t running.'), v.why || '']
      : apps.length ? ['good', T('Working with {apps}', { apps: [...new Set(apps)].join(', ') }), T('{n} devices shared', { n: v.devices ?? 0 })]
      : ['warn', T('Ready to add'), T('Scan the code below in your assistant\'s app.')];
    return el('div', { class: 'vo-status' }, el('span', { class: `dot ${dot}` }), el('div', {}, el('b', {}, text), sub ? el('div', { class: 'small muted' }, sub) : null));
  };
  const pairBox = () => {
    if (!v.pairing) return null;
    const p = v.pairing, qr = el('div', { class: 'vo-qr', role: 'img', 'aria-label': T('Pairing QR code') }); qr.innerHTML = p.qr || '';   // an SVG drawn by this CasaTorch from a fixed alphabet
    const steps = el('ol', { class: 'vo-steps small' });
    const tabs = el('div', { class: 'vo-tabs', role: 'group', 'aria-label': T('Which app?') });
    const pick = (k) => { tab = k; steps.replaceChildren(...VO_STEPS[k].map((s) => el('li', {}, T(s)))); for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.k === k)); };
    tabs.append(...VO_APPS.map(([k, label]) => el('button', { class: 'btn small', type: 'button', 'data-k': k, 'aria-pressed': 'false', onclick: () => pick(k) }, label)));
    pick(tab);
    return el('div', {},
      el('div', { class: 'vo-pair' }, qr, el('div', {},
        el('div', { class: 'small muted' }, T('Setup code')),
        el('div', { class: 'vo-code' }, p.manual),
        el('button', { class: 'btn small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(p.manual.replace(/-/g, '')); toast(T('Copied')); } catch { toast(p.manual, 6000); } } }, T('Copy the code')),
        p.until ? el('p', { class: 'tiny faint' }, T('Open for another app until {time}.', { time: fmtTime(new Date(p.until).toISOString()) })) : null)),
      el('div', { class: 'small', style: 'font-weight:600' }, T('Add it in your app')), tabs, steps,
      el('p', { class: 'tiny faint' }, T('Your phone and the assistant must be on the same home network as CasaTorch. Google Home needs a one-time step for devices that aren\'t certified - see the guide.')));
  };
  const appsBox = () => {
    if (!v.fabrics?.length) return null;
    return el('div', { style: 'margin-top:10px' }, el('div', { class: 'small', style: 'font-weight:600' }, T('Added to')),
      el('div', {}, v.fabrics.map((f) => el('div', { class: 'vo-row' }, icon('checkc', 16), el('div', { class: 'grow' }, el('b', {}, f.name), f.label && f.label !== f.name ? el('small', {}, f.label) : null),
        el('button', { class: 'btn small danger', type: 'button', onclick: () => confirmVo(T('Remove {app}?', { app: f.name }), T('{app} stops seeing CasaTorch\'s devices. You can add it again any time.', { app: f.name }), T('Remove'), async () => { v = await api(`/api/settings/voice/fabrics/${f.index}`, { method: 'DELETE' }); draw(); toast(T('Removed')); }) }, T('Remove'))))),
      v.pairing ? null : el('button', { class: 'btn small', type: 'button', style: 'margin-top:8px', onclick: async () => { try { v = await post('/api/settings/voice/pair'); draw(); } catch (e) { toast(e.message, 5000); } } }, icon('plus', 14), T('Add another app')));
  };
  const confirmVo = (title, text, label, fn) => {
    const m = modal(el('div', {}, el('p', {}, text), el('div', { class: 'row wrap', style: 'justify-content:flex-end;gap:8px' },
      el('button', { class: 'btn', type: 'button', onclick: () => m.remove() }, T('Cancel')),
      el('button', { class: 'btn primary', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { await fn(); m.remove(); } catch (err) { toast(err.message, 5000); e.currentTarget.disabled = false; } } }, label))), { title });
  };
  const chooseDevices = async () => {
    let d; try { d = await api('/api/settings/voice/devices', { timeout: 20000 }); } catch (e) { toast(e.message); return; }
    const changes = new Map(), groups = new Map();
    for (const x of d.devices) { const g = x.never ? 'Never shared' : VO_KIND[x.kind] || 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
    const order = ['Lights', 'Plugs and switches', 'Fans', 'Blinds and shades', 'Thermostats', 'Scenes', 'Sensors', 'Other', 'Never shared'];
    const count = el('span', { class: 'pill' });
    const upd = () => { const n = d.devices.filter((x) => !x.never && (changes.has(x.id) ? changes.get(x.id) : x.shared)).length; count.textContent = T('{n} shared', { n }); count.className = `pill${n > d.alexaMax ? ' warn' : ''}`; warn.hidden = n <= d.alexaMax; };
    const warn = el('p', { class: 'small', hidden: true, style: 'color:var(--warn)' }, T('Alexa shows at most {n} devices from one bridge. Google Home and Apple Home show more.', { n: d.alexaMax }));
    const list = el('div', { class: 'vo-list' }, order.filter((g) => groups.has(g)).map((g) => [el('div', { class: 'vo-group' }, T(g)), ...groups.get(g).map((x) => {
      const box = el('input', { type: 'checkbox', checked: x.shared, disabled: !!x.never, 'aria-label': x.name });
      box.onchange = () => { changes.set(x.id, box.checked); upd(); };
      return el('label', { class: `vo-row${x.never ? ' vo-never' : ''}` }, el('div', { class: 'grow' }, el('b', {}, x.name), el('small', {}, x.never ? T(x.never) : [x.room && x.room !== x.name ? x.room : null, x.parts.length > 1 ? T('{n} sensors', { n: x.parts.length }) : null].filter(Boolean).join(' · ') || ' ')), x.never ? icon('shield', 16) : box);
    })]).flat());
    upd();
    const m = modal(el('div', {}, el('p', { class: 'small muted' }, T('What your voice assistants can see and switch. Locks, garage doors, gates and alarms are never shared.')), el('div', { class: 'row between' }, count), warn, list,
      el('div', { class: 'row wrap', style: 'justify-content:flex-end;gap:8px;margin-top:10px' }, el('button', { class: 'btn', type: 'button', onclick: () => m.remove() }, T('Cancel')),
        el('button', { class: 'btn primary', type: 'button', onclick: async () => { try { await post('/api/settings/voice/devices', { changes: [...changes].map(([id, shared]) => ({ id, shared })) }, 'PUT'); m.remove(); toast(T('Saved - your assistants update in a few seconds')); await load(); draw(); } catch (e) { toast(e.message, 5000); } } }, T('Save')))), { title: T('Choose what\'s shared'), wide: true });
  };
  const matterCard = () => {
    const on = el('input', { type: 'checkbox', checked: v.on, disabled: v.demo || !v.pro, 'aria-label': T('Share with voice assistants') });
    on.onchange = () => put({ on: on.checked });
    const room = el('input', { type: 'checkbox', checked: v.roomInName, disabled: v.demo || !v.pro, 'aria-label': T('Put the room in front of each name') });
    room.onchange = () => put({ roomInName: room.checked });
    const many = v.devices != null && v.devices > v.alexaMax;
    return el('div', { class: 'card', style: 'grid-column:1/-1' },
      el('h2', {}, icon('mic', 16), T('Alexa, Google Home, Apple Home and SmartThings')),
      el('p', { class: 'small muted' }, T('Add CasaTorch once in your assistant\'s app, and your lights, plugs, blinds, thermostats, sensors and scenes show up there - with their names. Switch them by voice, in that app or in CasaTorch: both stay in step.')),
      v.pro ? null : el('div', { style: 'margin:8px 0' }, proUpsell(T('Control your home with Alexa, Google Home and Siri with CasaTorch Pro'))),
      el('label', { class: 'vo-row' }, el('div', { class: 'grow' }, el('b', {}, T('Share with voice assistants')), el('small', {}, T('Works on your home network, through Matter.'))), on),
      v.on || v.demo ? statusLine() : null,
      v.on || v.demo ? pairBox() : null,
      v.on ? appsBox() : null,
      v.on || v.demo ? el('div', { style: 'margin-top:10px' },
        el('div', { class: 'vo-row' }, el('div', { class: 'grow' }, el('b', {}, T('What\'s shared')), el('small', {}, v.devices != null ? T('{n} devices. Locks, garage doors, gates and alarms never are.', { n: v.devices }) : T('Lights, plugs, fans, blinds, thermostats, sensors and scenes. Locks, garage doors, gates and alarms never are.'))),
          el('button', { class: 'btn small', type: 'button', onclick: chooseDevices }, T('Choose…'))),
        many ? el('p', { class: 'small', style: 'color:var(--warn)' }, T('Alexa shows at most {n} devices from one bridge - choose the ones you talk to most.', { n: v.alexaMax })) : null,
        el('label', { class: 'vo-row' }, el('div', { class: 'grow' }, el('b', {}, T('Put the room in front of each name')), el('small', {}, T('"Kitchen ceiling" instead of "Ceiling" - handy when names repeat in different rooms.'))), room)) : null,
      v.on && !v.demo ? el('details', { style: 'margin-top:10px' }, el('summary', { class: 'small' }, T('Reset the bridge')),
        el('p', { class: 'small muted' }, T('Removes CasaTorch from every app it was added to and makes a new code. Use it if pairing got stuck or you\'re giving the device away.')),
        el('button', { class: 'btn small danger', type: 'button', onclick: () => confirmVo(T('Reset the bridge?'), T('Every app loses CasaTorch\'s devices and their rooms and routines. You can add CasaTorch again with the new code.'), T('Reset'), async () => { v = await post('/api/settings/voice/reset', { confirm: true }); draw(); toast(T('Reset - scan the new code to add CasaTorch again')); }) }, T('Reset the bridge…'))) : null,
      el('p', { class: 'tiny faint', style: 'margin-top:10px' }, T('Works with Amazon Alexa, Google Home, Apple Home and SmartThings through Matter. You need a Matter hub at home for some of them: an Echo, a Nest speaker or display, a HomePod or Apple TV, or a SmartThings hub.'), ' ', docLink('settings.voice')));
  };
  const siriCard = () => {
    const list = el('div', {}, (v.tokens || []).map((t) => el('div', { class: 'vo-row' }, icon('phone', 16), el('div', { class: 'grow' }, el('b', {}, t.name),
      el('small', {}, [t.scopes.includes('ask') ? T('Asks questions') : null, t.scopes.includes('do') ? T('Switches things') : null].filter(Boolean).join(' · '), ' · ', t.lastUsed ? T('Last used {when}', { when: ago(t.lastUsed) }) : T('Not used yet'))),
      el('button', { class: 'btn small danger', type: 'button', onclick: () => confirmVo(T('Remove "{name}"?', { name: t.name }), T('That phone\'s "Ask CasaTorch" shortcut stops working right away.'), T('Remove'), async () => { await api(`/api/settings/voice/tokens/${t.id}`, { method: 'DELETE' }); await load(); draw(); toast(T('Removed')); }) }, T('Remove')))));
    return el('div', { class: 'card', style: 'grid-column:1/-1' },
      el('h2', {}, icon('spark', 16), T('Siri: "Ask CasaTorch"')),
      el('p', { class: 'small muted' }, T('Say "Hey Siri, Ask CasaTorch", then a question - "is the garage door closed?", "how much power are we using?" - and Siri reads your Home AI Agent\'s short answer. You can also say "turn off the kitchen lights". Each phone gets its own key, made here and removable any time.')),
      list.children.length ? list : el('p', { class: 'small muted' }, T('No phone has one yet.')),
      el('div', { class: 'row wrap', style: 'margin-top:8px' }, el('button', { class: 'btn primary small', type: 'button', disabled: v.demo || !v.pro, onclick: makeToken }, icon('plus', 14), T('Set up a phone…'))),
      el('p', { class: 'tiny faint', style: 'margin-top:10px' }, T('Alexa: "Alexa, ask CasaTorch..." questions are Coming (they need an Alexa skill). Switching devices with Alexa works now, through the bridge above.'), ' ', docLink('settings.voice.siri')));
  };
  const makeToken = () => {
    const name = el('input', { type: 'text', maxlength: 40, placeholder: T('Kitchen iPad'), 'aria-label': T('Phone name') });
    const ask = el('input', { type: 'checkbox', checked: true }), doit = el('input', { type: 'checkbox', checked: true });
    const body = el('div', {},
      el('label', { class: 'field' }, el('span', {}, T('Which phone?')), name),
      el('label', { class: 'vo-row' }, el('div', { class: 'grow' }, el('b', {}, T('Ask questions')), el('small', {}, T('Answers from your Home AI Agent (needs an AI connected).'))), ask),
      el('label', { class: 'vo-row' }, el('div', { class: 'grow' }, el('b', {}, T('Switch things')), el('small', {}, T('Only what\'s shared with voice assistants - never locks, garage doors, gates or alarms.'))), doit),
      el('div', { class: 'row wrap', style: 'justify-content:flex-end;gap:8px;margin-top:10px' }, el('button', { class: 'btn', type: 'button', onclick: () => m.remove() }, T('Cancel')),
        el('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { const r = await post('/api/settings/voice/tokens', { name: name.value.trim() || T('My phone'), scopes: [ask.checked ? 'ask' : null, doit.checked ? 'do' : null].filter(Boolean) }); showRecipe(m, r); await load(); }
          catch (err) { toast(err.message, 5000); e.currentTarget.disabled = false; }
        } }, T('Make the key'))));
    const m = modal(body, { title: T('Set up "Ask CasaTorch" on a phone') });
    setTimeout(() => name.focus(), 50);
  };
  /* The key once, and the Shortcut, step by step (Apple doesn't let other apps make shortcut files). */
  const showRecipe = (m, r) => {
    const addr = (v.addresses || []).find((a) => a.where === 'anywhere') || (v.addresses || []).find((a) => a.where === 'home') || (v.addresses || [])[0] || { url: location.origin };
    const url = `${addr.url}/api/voice/ask`;
    const copy = (text, what) => el('button', { class: 'btn small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); toast(T('{what} copied', { what })); } catch { toast(text, 8000); } } }, T('Copy'));
    const box = m.querySelector('.box') || m;
    box.replaceChildren(el('h3', { style: 'margin:0 0 8px' }, T('Your key for "{name}"', { name: r.name })),
      el('p', { class: 'small', style: 'color:var(--warn)' }, T('Copy it now - CasaTorch shows it only this once. Lost it? Remove it and make a new one.')),
      el('div', { class: 'row', style: 'gap:8px;align-items:center' }, el('div', { class: 'vo-token grow' }, `Bearer ${r.token}`), copy(`Bearer ${r.token}`, T('Key'))),
      el('dl', { class: 'vo-kv' }, el('dt', {}, T('Address')), el('dd', {}, url, ' ', copy(url, T('Address')))),
      addr.where === 'anywhere' ? null : el('p', { class: 'tiny faint' }, T('This address works on your home network. Turn on Secure access to use it away from home too.')),
      el('div', { class: 'small', style: 'font-weight:600;margin-top:10px' }, T('On the iPhone, in the Shortcuts app')),
      el('ol', { class: 'vo-steps small' }, [
        T('Tap + to make a new shortcut and name it "Ask CasaTorch" (that\'s what you\'ll say to Siri).'),
        T('Add the action "Dictate Text".'),
        T('Add "Get Contents of URL". Paste the address. Tap Show More: Method POST; Headers: add "Authorization" with the key as its value; Request Body: JSON, with a text field "question" set to Dictated Text.'),
        T('Add "Speak Text" and pick Contents of URL.'),
        T('Say "Hey Siri, Ask CasaTorch", then your question.'),
      ].map((s) => el('li', {}, s))),
      el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, el('button', { class: 'btn primary', type: 'button', onclick: () => { m.remove(); draw(); } }, T('Done'))));
  };
  const draw = () => {
    if (!v) return;
    host.replaceChildren(...[matterCard(), siriCard(), v.demo ? el('div', { class: 'card', style: 'grid-column:1/-1' }, el('p', { class: 'small muted', style: 'margin:0' }, T('This is the demo: everything here is a sample, and changes aren\'t saved.'))) : null].filter(Boolean));
    keepPolling();
  };
  try { await load(); draw(); } catch (e) { host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'small muted' }, e.message))); }
  return [host];
}
