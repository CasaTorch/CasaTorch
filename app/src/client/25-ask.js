/* ---- Ask the house (Pro): a chat about your home; suggested actions need a tap ---- */
const ASK_SUGGEST = ['What\'s on the calendar this week?', 'Which lights are on?', 'What\'s using the most power?', 'Will it rain this week?', 'Did my team win?', 'Is everything OK at home?'];
const askHistory = [];   // this screen only; never saved
function askBox({ compact = false } = {}) {
  const log = el('div', { class: 'chat', style: compact ? 'flex:1;overflow-y:auto;min-height:0;padding-right:4px' : null });
  const input = el('input', { type: 'text', placeholder: 'Ask about your home...', maxlength: 1000, 'aria-label': 'Ask the house' });
  const send = el('button', { class: 'btn primary', 'aria-label': 'Ask' }, icon('send'));
  const bubble = (m) => {
    const b = el('div', { class: `msg ${m.role === 'user' ? 'me' : 'ai'}` }, m.content);
    if (m.actions?.length) b.append(el('div', { class: 'acts' }, m.actions.map((a) => { const btn = el('button', { class: 'btn small' }, icon('check'), a.label); btn.onclick = async () => { btn.disabled = true; try { await post(`/api/devices/${encodeURIComponent(a.deviceId)}/${a.action}`); btn.replaceChildren(icon('check'), 'Done'); } catch (err) { toast(err.message); btn.disabled = false; } }; return btn; })));
    if (m.error) b.style.borderColor = 'var(--bad)';
    return b;
  };
  const drawLog = () => {
    log.replaceChildren(...(askHistory.length ? askHistory.slice(compact ? -4 : 0).map(bubble) : [el('div', { class: 'chips' }, ASK_SUGGEST.slice(0, compact ? 3 : 6).map((s) => el('button', { onclick: () => ask(s) }, s)))]));
    log.scrollTop = log.scrollHeight; if (!compact) log.lastElementChild?.scrollIntoView({ block: 'end' });
  };
  async function ask(q) {
    q = String(q || '').trim(); if (!q) return;
    input.value = ''; askHistory.push({ role: 'user', content: q }); drawLog();
    const wait = el('div', { class: 'msg ai' }, el('span', { class: 'typing' }, el('i'), el('i'), el('i'))); log.append(wait); wait.scrollIntoView?.({ block: 'nearest' });
    try {
      const r = await post('/api/ask', { question: q, history: askHistory.slice(0, -1).slice(-8).map(({ role, content }) => ({ role, content })) });
      askHistory.push({ role: 'assistant', content: r.answer, actions: r.actions });
    } catch (err) {
      askHistory.push({ role: 'assistant', content: err.body?.setup ? 'Connect an AI first: Settings > Ask the house.' : err.message, error: true });
    }
    drawLog();
  }
  send.onclick = () => ask(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(input.value); });
  drawLog();
  return el('div', { style: 'display:flex;flex-direction:column;gap:12px;flex:1;min-height:0' }, log, el('div', { class: 'asker' }, input, send));
}
tab({ id: 'ask', label: 'Ask', icon: 'spark', pro: true, async render(main) {
  if (!isPro()) { main.replaceChildren(el('div', { class: 'card hero3d' }, el('div', { style: 'font-size:28px;font-weight:700;margin-bottom:10px' }, 'Ask the house'), el('p', { class: 'muted', style: 'max-width:540px;margin:0 auto 18px' }, '"Which lights are on?" "What\'s using the most power?" "Did the Niners win?" Answers from everything CasaTorch knows - and it can switch things for you with one tap.'), el('a', { class: 'btn primary', href: '#settings' }, 'Unlock with Pro'))); return null; }
  const ai = S.settings?.ai;
  setTop('Ask the house', ai ? `Answers by ${ai.provider === 'ollama' ? 'your own Ollama' : ai.provider} · ${ai.model}` : S.status?.demo ? 'Demo answers from the sample house' : 'Connect an AI in Settings to start', [askHistory.length ? el('button', { class: 'btn', onclick: () => { askHistory.length = 0; show('ask'); } }, icon('reset'), 'New chat') : null].filter(Boolean));
  main.replaceChildren(el('div', { class: 'card', style: 'display:flex;flex-direction:column;min-height:min(70vh,640px)' }, askBox(),
    el('p', { class: 'tiny faint', style: 'margin:12px 0 0' }, 'Each question sends a snapshot of your home (device names and states, calendar, weather) to the AI you chose. With Ollama it never leaves your network. CasaTorch only suggests actions - you tap to do them. Locks and doors are never touched.')));
  return null;
} });
