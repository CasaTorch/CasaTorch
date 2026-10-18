/* Setup's "App tests" step: "Want CasaTorch to keep an eye on the apps you use?" (catalog/setup.json).
   One tap: the suggested apps for where the home is come pre-picked (the router, name lookups, search, video,
   the country's own TV, a video-call app); change any of them, add your own websites (Pro - in the trial), pick how
   often, and whether to get an alert. setupFinish turns the answers into tests (77-apptests.js atFromSetup).
   Loaded after setup.js, so it adds itself to setup.js's CUSTOM field types. */
(() => {
  const GROUP_NAMES = { home: 'Your home\'s internet', calls: 'Video calls', work: 'Work and school', stream: 'Streaming', gaming: 'Gaming', everyday: 'Everyday' };
  const urlOk = (u) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(String(u || '').trim());
  let sug = null, sugKey = '';
  const load = () => {
    const loc = W.a.house?.location, cc = loc?.cc || (/,\s*([A-Z]{2})$/.exec(loc?.name || '')?.[1] || ''), lang = W.a.house?.lang || CasaI18n.lang || 'en', key = `${cc}|${lang}`;
    if (!sug || sugKey !== key) { sugKey = key; sug = api(`/api/setup/apptests?cc=${encodeURIComponent(cc)}&lang=${encodeURIComponent(lang)}`); }
    return sug;
  };
  CUSTOM.apptests = (f, store) => {
    const box = el('div', { class: 'atsetup' }, el('div', { class: 'note' }, T('Looking...')));
    load().then((s) => {
      if (!store._seeded) { store.picks = [...s.picks]; store._seeded = true; }
      store.picks ||= []; store.custom ||= []; store.every ||= 5; store.alert ||= 'yes';
      const picks = new Set(store.picks), count = el('div', { class: 'note' });
      const total = () => picks.size + store.custom.length;
      const recount = () => { count.textContent = T('{n} picked · up to {max} on Basic, {pro} with Pro', { n: total(), max: s.basicMax, pro: 30 }); };
      const chip = (p) => { const b = el('button', { type: 'button', class: `opt${picks.has(p.id) ? ' on' : ''}`, 'aria-pressed': picks.has(p.id) ? 'true' : 'false', onclick: () => {
        if (!picks.has(p.id) && total() >= s.max) { $('#navmsg').textContent = T('That\'s the most for now - remove one first.'); return; }
        picks.has(p.id) ? picks.delete(p.id) : picks.add(p.id); store.picks = [...picks]; b.classList.toggle('on'); b.setAttribute('aria-pressed', picks.has(p.id) ? 'true' : 'false'); recount(); saveProgress();
      } }, T(p.name)); return b; };
      // Suggested first (pre-picked, one tap to change); everything else folded away under "More apps".
      const top = [...new Set([...s.picks, ...picks])].map((id) => s.presets.find((p) => p.id === id)).filter(Boolean);
      const rest = s.groups.map((g) => { const list = s.presets.filter((p) => p.group === g && !top.includes(p)); return list.length ? el('div', { class: 'atsgroup' }, el('label', {}, T(GROUP_NAMES[g] || g)), el('div', { class: 'opts' }, ...list.map(chip))) : null; }).filter(Boolean);
      const groups = [el('div', { class: 'atsgroup' }, el('label', {}, T('Suggested for your home')), el('div', { class: 'opts' }, ...top.map(chip))),
        el('details', { class: 'atsmore', open: store._more ? true : null, ontoggle: (e) => { store._more = e.target.open; } }, el('summary', {}, T('More apps: video calls, work, streaming, gaming')), ...rest)];
      // Your own websites - a bank, a school portal: typed by you (Pro; the 14-day trial includes it).
      const own = el('div', { class: 'atsgroup' }, el('label', {}, T('Your own websites'), ' ', el('span', { class: 'badge' }, 'Pro')));
      store.custom.forEach((c, k) => own.append(el('div', { class: 'item' }, el('div', { class: 'grid2' },
        fieldEl({ id: 'name', label: 'Name', type: 'text', placeholder: T('Your bank\'s website') }, c),
        fieldEl({ id: 'url', label: 'Web address', type: 'url', placeholder: 'https://', required: true }, c)),
        c.url && !urlOk(c.url) ? el('div', { class: 'err' }, T('Enter a web address, like https://example.com.')) : null,
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'small', onclick: () => { store.custom.splice(k, 1); go(); } }, T('Remove'))))));
      own.append(el('div', { class: 'row' }, el('button', { type: 'button', class: 'small', disabled: total() >= s.max ? true : null, onclick: () => { store.custom.push({ name: '', url: '' }); go(); } }, T('Add a website (your bank, a school portal...)'))),
        el('div', { class: 'help' }, s.trial ? T('Included in your 14-day Pro trial. On Basic, your own websites pause and the built-in apps keep going.') : s.pro ? T('Any website or web app - only its sign-in or home page is opened, never signed in to.') : T('Your own websites are part of Pro.')));
      if (!s.pro) own.querySelectorAll('input, button').forEach((x) => { x.disabled = true; });
      const every = el('select', { id: 'at-every', onchange: (e) => { store.every = Number(e.target.value); saveProgress(); } },
        ...s.every.map((m) => el('option', { value: m, selected: Number(store.every) === m ? true : null }, m === 1 ? `${T('Every minute')} (Pro)` : T('Every {n} minutes', { n: m }))));

      box.replaceChildren(...groups, own,
        el('div', { class: 'grid2', style: 'margin-top:14px' }, el('div', { class: 'field' }, el('label', { for: 'at-every' }, T('How often')), every),
          el('div', { class: 'field' }, el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: store.alert !== 'no' ? true : null, onchange: (e) => { store.alert = e.target.checked ? 'yes' : 'no'; saveProgress(); } }), el('span', {}, T('Alert me when something is slow or down'), ' ', el('span', { class: 'badge' }, 'Pro'))),
            el('div', { class: 'help' }, T('One alert per problem, saying what\'s likely to blame. It goes to the phones you pair at the end of setup.')))),
        count,
        el('p', { class: 'note' }, T('Tests run from this CasaTorch straight to each app - nothing goes through casatorch.com. To show who runs each network along the way, the hops\' addresses are looked up in a public directory over DNS.')));
      recount();
    }).catch((e) => box.replaceChildren(el('div', { class: 'err' }, e.message)));
    return box;
  };
  /* Checked before Next (setup.js problems()). */
  window.atSetupProblem = (store) => {
    if (store.want !== 'yes') return null;
    const bad = (store.custom || []).find((c) => !c.url || !urlOk(c.url));
    if (bad) return T('Enter a web address for each website, or remove the empty one.');
    if (!(store.picks || []).length && !(store.custom || []).length) return T('Pick at least one app - or choose "Not now".');
    return null;
  };
})();
