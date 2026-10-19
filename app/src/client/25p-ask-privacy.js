/* ---- Settings › Connections & AI › Home AI Agent: exactly what is shared with the AI, and the switches
   (cameras, location, calendar, family, web search, keeping chats). Admins change them; everyone can see them. ---- */
const ASK_WEB_MODES = [['auto', 'The AI\'s own web search (Claude, OpenAI)'], ['free', 'CasaTorch\'s free lookup (DuckDuckGo and Wikipedia)'], ['off', 'Off']];
function aiPrivacyCard(s) {
  const card = el('div', { class: 'card ask-privacy' }, el('h2', {}, icon('shield', 15), T('What your Home AI Agent shares')), el('p', { class: 'small muted' }, T('Loading...')));
  (async () => {
    const role = (S.me ||= await api('/api/auth/me').catch(() => ({})))?.user?.role, admin = !role || ['owner', 'admin'].includes(role);   // the box checks again
    let p; try { p = await api('/api/ask/privacy'); } catch (err) { card.lastChild.textContent = err.message; return; }
    const save = async (body, what) => { try { const r = await post('/api/settings/ai/privacy', body, 'PUT'); Object.assign(p, { share: r.share, webSearch: r.webSearch, keepChats: r.keepChats }); toast(what || T('Saved')); } catch (err) { toast(err.message); } };
    const who = p.local ? T('{provider} on your own network - nothing leaves your home.', { provider: p.providerName || T('Your AI') }) : p.providerName ? T('{provider} - only for the question being asked, and only what the answer needs.', { provider: p.providerName }) : T('No AI is connected yet.');
    const rows = p.categories.map((c) => {
      const tog = c.id === 'always' ? null : el('input', { type: 'checkbox', checked: c.on, disabled: !admin, 'aria-label': T(c.title) });
      if (tog) tog.onchange = () => save({ share: { [c.id]: tog.checked } }, tog.checked ? T('{what} is shared again', { what: T(c.title) }) : T('{what} is no longer shared', { what: T(c.title) }));
      return el('label', { class: 'ask-prow' }, el('div', {}, el('div', { class: 'ask-ptitle' }, T(c.title)), el('div', { class: 'small muted' }, T(c.what))), tog || el('span', { class: 'pill' }, T('Needed')));
    });
    const web = el('select', { disabled: !admin, 'aria-label': T('Web search') }, ASK_WEB_MODES.map(([v, l]) => el('option', { value: v, selected: p.webSearch === v }, T(l))));
    web.onchange = () => save({ webSearch: web.value });
    const keep = el('input', { type: 'checkbox', checked: p.keepChats, disabled: !admin, 'aria-label': T('Keep chats on this CasaTorch') });
    keep.onchange = () => save({ keepChats: keep.checked }, keep.checked ? T('Chats are kept') : T('Chats aren\'t kept, and the saved ones are deleted'));
    const peek = el('details', { class: 'ask-peek' }, el('summary', {}, T('See exactly what is sent')));
    peek.addEventListener('toggle', async () => {
      if (!peek.open || peek.dataset.done) return; peek.dataset.done = '1';
      try { const j = await api('/api/ask/privacy?preview=1'); peek.append(el('p', { class: 'small muted' }, T('With every question: these instructions, your question and the chat so far. Then, only if the AI asks for it, the result of a lookup below.')), el('pre', { class: 'ask-code' }, j.system || ''), el('div', { class: 'small' }, el('strong', {}, T('Lookups it can ask for')), el('ul', {}, j.tools.map((t) => el('li', {}, el('code', {}, t.name), ' - ', t.what))))); } catch (err) { peek.append(el('p', { class: 'small' }, err.message)); }
    });
    card.replaceChildren(el('h2', {}, icon('shield', 15), T('What your Home AI Agent shares')),
      el('p', { class: 'small' }, el('strong', {}, T('Sent to')), ' ', who),
      el('p', { class: 'small muted' }, T('CasaTorch never sends pictures or video, passwords, keys, addresses or map positions. The AI service\'s own terms cover what it does with a question; with Ollama it stays at home.')),
      el('div', { class: 'ask-plist' }, rows),
      el('label', { class: 'field' }, el('span', {}, T('Web search')), web),
      el('p', { class: 'tiny faint', style: 'margin-top:-4px' }, p.nativeWeb ? T('With "the AI\'s own web search", your AI service searches and lists the pages it used.') : T('Your AI has no web search of its own: pick CasaTorch\'s free lookup, or leave it off.')),
      el('label', { class: 'ask-prow' }, el('div', {}, el('div', { class: 'ask-ptitle' }, T('Keep chats on this CasaTorch')), el('div', { class: 'small muted' }, T('Each person\'s last 30 chats, sealed on this box. Never sent anywhere except with a new question in the same chat.'))), keep),
      el('div', { class: 'row wrap' }, el('button', { class: 'btn small', type: 'button', onclick: async () => { try { await api('/api/ask/chats', { method: 'DELETE' }); askHistory.length = 0; askChatId = null; toast(T('All your chats are deleted')); } catch (err) { toast(err.message); } } }, icon('trash', 14), T('Delete all my chats'))),
      peek);
  })();
  return card;
}
