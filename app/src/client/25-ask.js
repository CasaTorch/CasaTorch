/* ---- Home AI Agent (Pro): a chat about your home and the world. Answers stream in, with charts, tables and tiles
   (25c-ask-render.js), the sources they came from, and an offer with buttons; switching anything needs a tap.
   Each person's chats are kept on the box (Settings › Home AI Agent shows what is shared, and deletes them). ---- */
const ASK_SUGGEST = ['Which lights are on?', 'Show energy for the last 7 days', 'Will it rain this week?', 'Did my team win?', 'What\'s on the calendar this week?', 'Is everything OK at home?'];
const askHistory = [];   // this chat on this screen (the box keeps a copy for each person)
const askPush = (m) => { askHistory.push(m); if (askHistory.length > 60) askHistory.splice(0, askHistory.length - 60); };   // a wall panel asks all day: keep the last 60
let askChatId = null, askBusy = false;
const askLangNow = () => (document.documentElement.lang || 'en').split('-')[0];
/* One question to the box; progress, text and the finished answer come back as lines of JSON as they happen. */
async function askStream(q, { onEvent, signal } = {}) {
  const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ question: q, stream: true, chatId: askChatId, lang: askLangNow(), history: askChatId ? [] : askHistory.slice(0, -1).slice(-10).map(({ role, content }) => ({ role, content: content || '' })) }) });
  if (r.status === 401) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('sign in first'); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error ? TM(j.error, j.msg, j.vars) : `HTTP ${r.status}`), { status: r.status, body: j }); }
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', done = null;
  for (;;) {
    const { value, done: end } = await rd.read(); if (end) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; let e; try { e = JSON.parse(line); } catch { continue; } if (e.t === 'done') done = e; else if (e.t === 'error') throw new Error(e.error); else onEvent?.(e); }
  }
  if (!done) throw new Error(T('The answer stopped - try again.'));
  return done;
}
const askCopyText = (m) => [m.content, m.cite].filter(Boolean).join('\n\n');
function askBox({ compact = false } = {}) {
  const log = el('div', { class: `chat ask-chat${compact ? ' compact' : ''}`, style: compact ? 'flex:1;overflow-y:auto;min-height:0;padding-right:4px' : null, 'aria-live': 'polite' });
  const input = el('input', { type: 'text', placeholder: T('Ask about your home...'), maxlength: 1000, 'aria-label': T('Ask your Home AI Agent') });
  const send = el('button', { class: 'btn primary', 'aria-label': T('Ask') }, icon('send'));
  const tools = (m, i) => el('div', { class: 'ask-tools' },
    el('button', { class: 'btn ghost small', type: 'button', title: T('Copy'), 'aria-label': T('Copy'), onclick: async (e) => { try { await navigator.clipboard.writeText(askCopyText(m)); toast(T('Copied')); } catch { toast(T('Couldn\'t copy here')); } e.currentTarget.blur(); } }, icon('log', 14)),
    m.q ? el('button', { class: 'btn ghost small', type: 'button', title: T('Ask again'), 'aria-label': T('Ask again'), onclick: () => { if (askBusy) return; askHistory.splice(i - 1, 2); ask(m.q); } }, icon('reset', 14)) : null);
  const bubble = (m, i) => {
    if (m.role === 'user') return el('div', { class: 'msg me' }, m.content);
    const b = el('div', { class: `msg ai${m.error ? ' err' : ''}` });
    if (m.error) b.append(el('div', {}, m.content), m.q ? el('div', { class: 'acts' }, el('button', { class: 'btn small', type: 'button', onclick: () => { if (askBusy) return; askHistory.splice(i - 1, 2); ask(m.q); } }, icon('reset', 14), T('Try again'))) : null);
    else { b.append(askAnswerEl(m, { onAsk: (q) => ask(q), compact })); if (!compact) b.append(tools(m, i)); }
    return b;
  };
  const drawLog = () => {
    const list = askHistory.map((m, i) => [m, i]).slice(compact ? -4 : 0);
    log.replaceChildren(...(list.length ? list.map(([m, i]) => bubble(m, i)) : [el('div', { class: 'chips ask-start' }, ASK_SUGGEST.slice(0, compact ? 3 : 6).map((s) => el('button', { onclick: () => ask(T(s)) }, T(s))))]));
    log.scrollTop = log.scrollHeight; if (!compact) log.lastElementChild?.scrollIntoView?.({ block: 'end' });
  };
  async function ask(q) {
    q = String(q || '').trim(); if (!q || askBusy) return;
    askBusy = true; send.disabled = true;
    input.value = ''; askPush({ role: 'user', content: q }); drawLog();
    const status = el('div', { class: 'ask-status' }, el('span', { class: 'typing' }, el('i'), el('i'), el('i')), el('span', {}, T('Thinking…')));
    const draft = el('div', { class: 'ask-draft' }), wait = el('div', { class: 'msg ai' }, status, draft); log.append(wait); wait.scrollIntoView?.({ block: 'nearest' });
    let text = '', raf = 0;
    const paint = () => { raf = 0; draft.replaceChildren(askDraftEl(text)); if (!compact) wait.scrollIntoView?.({ block: 'end' }); else log.scrollTop = log.scrollHeight; };
    try {
      const r = await askStream(q, { onEvent: (e) => {
        if (e.t === 'tool') status.lastChild.textContent = `${T(e.label || 'Looking it up')}…`;
        else if (e.t === 'step') { text = ''; draft.replaceChildren(); }
        else if (e.t === 'text') { text += e.d || ''; status.lastChild.textContent = T('Writing…'); if (!raf) raf = requestAnimationFrame(paint); }
      } });
      if (r.chatId) askChatId = r.chatId;
      askPush({ role: 'assistant', content: r.answer, blocks: r.blocks, offer: r.offer, sources: r.sources, from: r.from, cite: r.cite, q });
    } catch (err) {
      askPush({ role: 'assistant', content: err.body?.setup ? T('Connect an AI first: Settings › Connections & AI.') : err.message, error: true, q });
    }
    cancelAnimationFrame(raf); askBusy = false; send.disabled = false; drawLog();
  }
  send.onclick = () => ask(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(input.value); });
  drawLog();
  return el('div', { style: 'display:flex;flex-direction:column;gap:12px;flex:1;min-height:0' }, log, el('div', { class: 'asker' }, input, send));
}
/* Your saved chats: open one again, or delete it. */
async function askChatsPanel() {
  let r; try { r = await api('/api/ask/chats'); } catch (err) { return toast(err.message); }
  const list = el('div', { class: 'ask-chats' });
  const draw = () => list.replaceChildren(...(r.chats.length ? r.chats.map((c) => el('div', { class: 'ask-chatrow' },
    el('button', { class: 'ask-chatopen', type: 'button', onclick: async () => {
      try { const j = await api(`/api/ask/chats/${encodeURIComponent(c.id)}`); askHistory.length = 0; for (const m of j.msgs) askPush(m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.text || '', blocks: m.blocks, offer: m.offer, sources: m.sources, from: m.from, error: m.error }); askChatId = j.id; $('#modal')?.remove(); show('ask'); } catch (err) { toast(err.message); }
    } }, el('div', { class: 'ask-chat-t' }, c.title || T('Chat')), el('div', { class: 'tiny faint' }, fmtWhen(c.at))),
    el('button', { class: 'btn ghost small', type: 'button', 'aria-label': T('Delete'), title: T('Delete'), onclick: async () => { await api(`/api/ask/chats/${encodeURIComponent(c.id)}`, { method: 'DELETE' }); r.chats = r.chats.filter((x) => x.id !== c.id); if (askChatId === c.id) { askChatId = null; askHistory.length = 0; } draw(); } }, icon('trash', 15))))
    : [el('p', { class: 'muted' }, r.keep ? T('No saved chats yet.') : T('Chats aren\'t kept - turn that on in Settings › Home AI Agent.'))]));
  draw();
  const all = el('button', { class: 'btn small', type: 'button', onclick: async () => { await api('/api/ask/chats', { method: 'DELETE' }); r.chats = []; askChatId = null; askHistory.length = 0; draw(); toast(T('All your chats are deleted')); } }, icon('trash', 14), T('Delete all my chats'));
  modal(el('div', {}, el('p', { class: 'small muted', style: 'margin-top:0' }, T('Kept only on this CasaTorch, for you - the newest 30.')), list, el('div', { class: 'row', style: 'margin-top:12px' }, all)), { title: T('Your chats') });
}
tab({ id: 'ask', label: 'Home AI Agent', short: 'AI Agent', icon: 'spark', pro: true, async render(main) {
  if (!isPro()) { main.replaceChildren(el('div', { class: 'card hero3d' }, el('div', { style: 'font-size:28px;font-weight:700;margin-bottom:10px' }, T('Your Home AI Agent')), el('p', { class: 'muted', style: 'max-width:540px;margin:0 auto 18px' }, T('"Which lights are on?" "What\'s using the most power?" "Did the Niners win?" Answers from everything CasaTorch knows - and it can switch things for you with one tap.')), el('a', { class: 'btn primary', href: '#settings' }, T('Unlock with Pro')))); return null; }
  const ai = S.settings?.ai;
  setTop(T('Home AI Agent'), ai?.model ? `${T('Answers by {provider}', { provider: ai.provider === 'ollama' ? T('your own Ollama') : ai.provider })} · ${ai.model}` : S.status?.demo ? T('Demo answers from the sample house') : T('Connect an AI in Settings to start'), [
    el('button', { class: 'btn', onclick: () => askChatsPanel() }, icon('clock'), T('Chats')),
    askHistory.length ? el('button', { class: 'btn', onclick: () => { askHistory.length = 0; askChatId = null; show('ask'); } }, icon('plus'), T('New chat')) : null].filter(Boolean));
  main.replaceChildren(el('div', { class: 'card ask-card', style: 'display:flex;flex-direction:column;min-height:min(70vh,640px)' }, askBox(),
    el('p', { class: 'tiny faint', style: 'margin:12px 0 0' }, T('Answers come from your home\'s data and, when it searches, the web - with the sources listed. Each question sends only what the answer needs to the AI you chose; with Ollama nothing leaves your network. CasaTorch only suggests switches - you tap to do them. Locks, garage doors, gates and alarms are never touched.'), ' ', el('a', { href: '#settings/connections' }, T('What is shared')))));
  return null;
} });
