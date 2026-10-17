/* ======================================================================
 * Ask the house (Pro). Questions in plain English, answered from what
 * CasaTorch knows right now: devices, power, weather, calendar, scores,
 * headlines, the internet and open alerts.
 *
 * Bring your own AI: Anthropic (Claude), OpenAI, any OpenAI-compatible
 * server (LM Studio, vLLM...), or Ollama on your own network (nothing leaves
 * the house). config.ai = { provider, model, apiKey?, url? } - the key never
 * goes back to the browser.
 *
 * The AI can SUGGEST actions (turn a light off, pause music); the person
 * taps to do them. It can never unlock, open or disarm anything.
 * ====================================================================== */
const AI = {
  anthropic: {
    name: 'Anthropic (Claude)',
    async models(c) { const j = await aiFetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' } }); return (j.data || []).map((m) => m.id); },
    pick: (ms) => ms.find((m) => /sonnet/.test(m)) || ms.find((m) => /haiku/.test(m)) || ms[0],
    async chat(c, system, messages) {
      const j = await aiFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }, body: { model: c.model, max_tokens: 900, system, messages } });
      return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    },
  },
  openai: {
    name: 'OpenAI',
    base: (c) => String(c.url || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    async models(c) { const j = await aiFetch(`${this.base(c)}/models`, { headers: c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {} }); return (j.data || []).map((m) => m.id).filter((id) => !/embed|whisper|tts|dall-e|moderation|audio|realtime|transcribe|image/i.test(id)).sort(); },
    pick: (ms) => ms.find((m) => /^gpt-4o-mini$/.test(m)) || ms.find((m) => /mini/.test(m)) || ms[0],
    async chat(c, system, messages) {
      const j = await aiFetch(`${this.base(c)}/chat/completions`, { method: 'POST', headers: c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}, body: { model: c.model, messages: [{ role: 'system', content: system }, ...messages] } });
      return j.choices?.[0]?.message?.content || '';
    },
  },
  ollama: {
    name: 'Ollama (on your network)',
    base: (c) => String(c.url || 'http://localhost:11434').replace(/\/+$/, ''),
    async models(c) { const j = await aiFetch(`${this.base(c)}/api/tags`); return (j.models || []).map((m) => m.name); },
    pick: (ms) => ms.find((m) => /llama3|qwen|mistral|gemma/.test(m)) || ms[0],
    async chat(c, system, messages) {
      const j = await aiFetch(`${this.base(c)}/api/chat`, { method: 'POST', body: { model: c.model, stream: false, messages: [{ role: 'system', content: system }, ...messages] }, timeout: 120000 });
      return j.message?.content || '';
    },
  },
};
AI.compatible = { ...AI.openai, name: 'OpenAI-compatible server', base: (c) => String(c.url || '').replace(/\/+$/, '') };
const aiOf = (id) => (Object.hasOwn(AI, String(id)) ? AI[id] : null);   // only the providers above
async function aiFetch(url, { method = 'GET', headers = {}, body, timeout = 60000 } = {}) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* text */ }
  if (!r.ok) throw new Error(j?.error?.message || j?.error || (r.status === 401 ? 'the API key was refused' : `HTTP ${r.status}`));
  return j || {};
}

/* What the house knows right now, small enough to send with every question. */
async function houseSnapshot() {
  const tz = houseTz(), units = config.house?.units || 'F';
  const temp = (c) => (c == null ? undefined : units === 'C' ? Math.round(c * 10) / 10 : Math.round(c * 9 / 5 + 32));
  const s = async (p) => { try { return await p; } catch { return null; } };
  const demo = isDemo();
  const [dev, home, alertsNow] = await Promise.all([
    s(houseDevices()),
    demo ? demoFixture('home') : (async () => ({
      weather: config.location ? await s(weatherNow()) : null, calendar: await s(calendarEvents(7)),
      sports: (config.sports?.teams || []).length ? await s(sportsNow()) : null, news: (config.news?.feeds || []).length ? await s(newsNow()) : null, internet: await s(internetNow()),
    }))(),
    demo ? demoFixture('alerts') : { now: Object.values(alerts.open || {}) },
  ]);
  const devices = (dev?.devices || []).map((d) => Object.fromEntries(Object.entries({ id: d.id, name: d.name, room: d.area, kind: d.kind, on: d.on, brightness: d.brightness, watts: d.powerW, playing: d.playing, nowPlaying: d.title, temperature: temp(d.tempC), target: temp(d.targetC), humidity: d.humidity, open: d.open, water: d.water, motion: d.motion, locked: d.locked, battery: d.battery, online: d.online, home: d.home, armed: d.armed, fanPercent: d.percent, state: ['value', 'presence', 'alarm', 'vacuum', 'cover', 'action'].includes(d.kind) ? d.state : undefined, value: d.value, unit: d.unit || undefined }).filter(([, v]) => v !== undefined && v !== null)));
  const watts = housePower(dev?.devices || []).watts, rate = config.energy?.ratePerKwh ?? (demo ? 0.17 : null);
  /* A big Home Assistant can have thousands of entities. The AI gets the ones a person asks about first,
     and at most 350, so a question never costs a fortune or runs past the model's limit. */
  const PRI = { light: 0, plug: 0, switch: 1, media: 1, climate: 1, fan: 1, cover: 2, lock: 2, camera: 3, sensor: 3, presence: 3, vacuum: 4, action: 5, value: 6 };
  devices.sort((a, b) => (PRI[a.kind] ?? 7) - (PRI[b.kind] ?? 7)); devices.length = Math.min(devices.length, 350);
  return {
    house: config.house?.name || (demo ? 'Demo House' : 'Home'), now: new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date()), timezone: tz, temperatureUnit: units,
    devices, power: { wattsNow: Math.round(watts), costPerKwh: rate, costPerDayIfSteady: rate ? Math.round(watts / 1000 * 24 * rate * 100) / 100 : null },
    weather: home?.weather?.now ? { place: home.weather.place, now: home.weather.now, next7days: home.weather.days } : null,
    calendar: (home?.calendar?.events || []).slice(0, 25).map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay, calendar: e.calendar })),
    sports: (home?.sports?.games || []).slice(0, 10).map((g) => ({ league: g.leagueName, state: g.state, detail: g.detail, start: g.start, home: `${g.home?.name} ${g.home?.score ?? ''}`.trim(), away: `${g.away?.name} ${g.away?.score ?? ''}`.trim(), winner: g.home?.winner ? g.home.name : g.away?.winner ? g.away.name : null })),
    headlines: (home?.news?.items || []).slice(0, 8).map((n) => `${n.title} (${n.source})`),
    internet: home?.internet ? { online: home.internet.online, provider: home.internet.provider, downMbps: home.internet.speed?.downMbps, upMbps: home.internet.speed?.upMbps, pingMs: home.internet.latencyMs?.cloudflare, devicesOnNetwork: home.internet.lanDevices } : null,
    alerts: (alertsNow?.now || []).map((a) => `${a.severity}: ${a.title}`),
    reminders: demo ? (home?.reminders || []).map((r) => r.title) : remindersToday().map((r) => r.title),
  };
}
const SAFE_ACTIONS = new Set(['on', 'off', 'toggle']);
function systemPrompt(snap) {
  return `You are the assistant built into CasaTorch, the home dashboard for "${snap.house}". Answer the household's questions about their home in plain, friendly English - usually 1-3 sentences, a short list if it helps. Use only the data below; if something isn't there, say you can't see it. Times are in the house's time zone (${snap.timezone}); temperatures in °${snap.temperatureUnit}.

You cannot change anything yourself. If the person asks to switch something (lights, plugs, switches, play/pause music), suggest it as an action and they will tap to confirm. Allowed actions: "on", "off", "toggle" (use "toggle" for play/pause on media). Never suggest unlocking doors, opening garage doors or gates, or disarming alarms - say CasaTorch doesn't do that, and to use that device's own app.

Reply with ONLY a JSON object, no other text:
{"answer": "your reply", "actions": [{"deviceId": "<id from the data>", "action": "on|off|toggle", "label": "short button text, e.g. Turn off Kitchen"}]}
Use "actions": [] when there is nothing to do.

House data right now:
${JSON.stringify(snap)}`;
}
function parseReply(text, snap) {
  let j = null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } }
  if (!j || typeof j.answer !== 'string') return { answer: String(text).trim() || 'Sorry - I could not answer that.', actions: [] };
  const byId = new Map(snap.devices.map((d) => [d.id, d]));
  // The button text is made here from the device's real name - never taken from the AI - and nothing the
  // safety rule holds back (door, gate, lock, alarm controls) is ever offered.
  const VERB = { on: 'Turn on', off: 'Turn off', toggle: 'Switch' };
  const actions = (Array.isArray(j.actions) ? j.actions : []).filter((a) => byId.has(a?.deviceId) && SAFE_ACTIONS.has(a.action) && ['light', 'switch', 'plug', 'media', 'fan'].includes(byId.get(a.deviceId).kind) && !blocked(byId.get(a.deviceId), a.action))
    .slice(0, 12).map((a) => { const d = byId.get(a.deviceId); return { deviceId: a.deviceId, action: a.action, label: `${d.kind === 'media' && a.action === 'toggle' ? 'Play/pause' : VERB[a.action]} ${d.name}`.slice(0, 60) }; });
  return { answer: j.answer.trim(), actions };
}
/* Demo with no AI connected: a few canned skills over the sample house, so the demo still shows the idea. */
function demoAnswer(q, snap) {
  const t = q.toLowerCase(), on = snap.devices.filter((d) => d.kind === 'light' && d.on);
  if (/light/.test(t) && /(off|turn)/.test(t)) return { answer: `${on.length} light${on.length === 1 ? ' is' : 's are'} on: ${on.map((d) => d.name).join(', ')}. Tap to turn them off.`, actions: on.map((d) => ({ deviceId: d.id, action: 'off', label: `Turn off ${d.name}` })) };
  if (/light/.test(t)) return { answer: on.length ? `${on.length} on right now: ${on.map((d) => `${d.name}${d.brightness ? ` (${d.brightness}%)` : ''}`).join(', ')}.` : 'All the lights are off.', actions: [] };
  if (/power|energy|watt|electric|cost|bill/.test(t)) { const top = snap.devices.filter((d) => d.watts).sort((a, b) => b.watts - a.watts)[0]; return { answer: `The house is using ${snap.power.wattsNow} W right now - about $${snap.power.costPerDayIfSteady}/day if it stays like this. Biggest draw: ${top?.name} at ${top?.watts} W.`, actions: [] }; }
  if (/weather|rain|cold|hot|jacket|umbrella/.test(t)) { const w = snap.weather; return { answer: w ? `${w.now.temp}° and ${w.now.words.toLowerCase()} in ${w.place}. ${w.next7days?.find((d) => d.rainMm > 1) ? `Rain is likely ${new Date(`${w.next7days.find((d) => d.rainMm > 1).date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}.` : 'No real rain in the week ahead.'}` : 'I can\'t see the weather.', actions: [] }; }
  if (/calendar|today|tonight|tomorrow|week|plan|schedule|next/.test(t)) { const e = snap.calendar.filter((x) => Date.parse(x.end) > Date.now()).slice(0, 3); return { answer: e.length ? `Coming up: ${e.map((x) => `${x.title} (${new Date(x.start).toLocaleString('en-US', { weekday: 'short', hour: x.allDay ? undefined : 'numeric', minute: x.allDay ? undefined : '2-digit', timeZone: snap.timezone })})`).join('; ')}.` : 'Nothing on the calendar this week.', actions: [] }; }
  if (/game|score|win|won|play|niners|49ers|warriors|giants/.test(t)) return { answer: snap.sports.map((g) => `${g.away} at ${g.home} - ${g.state === 'in' ? `live, ${g.detail}` : g.state === 'post' ? `final${g.winner ? `, ${g.winner} won` : ''}` : g.detail}`).join('. ') || 'No games this week.', actions: [] };
  if (/music|play|song|speaker/.test(t)) { const p = snap.devices.filter((d) => d.playing); return { answer: p.length ? `${p.map((d) => `${d.name} is playing ${d.nowPlaying || 'music'}`).join('; ')}.` : 'Nothing is playing.', actions: p.map((d) => ({ deviceId: d.id, action: 'toggle', label: `Pause ${d.name}` })) }; }
  if (/internet|wifi|speed|network/.test(t)) return { answer: `The internet is ${snap.internet?.online ? 'up' : 'down'} - ${Math.round(snap.internet?.downMbps)} down / ${Math.round(snap.internet?.upMbps)} up Mbps, ${snap.internet?.pingMs} ms ping, ${snap.internet?.devicesOnNetwork} devices on the network.`, actions: [] };
  if (/door|leak|alert|wrong|problem|ok\b|everything/.test(t)) return { answer: snap.alerts.length ? `Needs a look: ${snap.alerts.join('; ')}. Doors are closed and no leaks.` : 'All clear - doors closed, no leaks.', actions: [] };
  return { answer: 'In the demo I can answer about lights, power, the weather, the calendar, scores, music, the internet and alerts. Connect an AI in Settings > Ask the house to ask anything.', actions: [] };
}
const askLog = [];
app.post('/api/ask', express.json({ limit: '64kb' }), requirePro, async (req, res) => {
  const q = String(req.body?.question || '').trim().slice(0, 1000);
  if (!q) return res.status(400).json({ error: 'ask a question' });
  const now = Date.now(); while (askLog.length && now - askLog[0] > 60_000) askLog.shift();
  if (askLog.length >= 20) return res.status(429).json({ error: 'That\'s a lot of questions - wait a minute.' });
  askLog.push(now);
  const snap = await houseSnapshot();
  const c = config.ai, p = c && aiOf(c.provider);
  if (!p || !c.model) {
    if (isDemo()) return res.json({ ...demoAnswer(q, snap), demo: true });
    return res.status(409).json({ error: 'Connect an AI first: Settings > Ask the house.', setup: true });
  }
  const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-8).filter((m) => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string').map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  try { res.json(parseReply(await p.chat(c, systemPrompt(snap), [...history, { role: 'user', content: q }]), snap)); }
  catch (err) { res.status(502).json({ error: `${p.name}: ${err.message}` }); }
});

/* Settings > Ask the house */
app.post('/api/settings/ai/models', requireRole('admin'), express.json(), async (req, res) => {
  const b = req.body || {}, p = aiOf(b.provider);
  if (!p) return res.status(400).json({ error: 'pick a provider' });
  // The saved key is only reused for the same provider at the same address - never sent somewhere new.
  const sameHome = config.ai?.provider === b.provider && (b.url || null) === (config.ai?.url || null) || (config.ai?.provider === b.provider && !b.url);
  const c = { provider: b.provider, url: b.url || config.ai?.url, apiKey: b.apiKey || (sameHome ? config.ai?.apiKey : null) };
  try { const models = await p.models(c); res.json({ models, suggested: p.pick(models) || null }); }
  catch (err) { res.status(400).json({ error: `${p.name}: ${err.message}` }); }
});
app.put('/api/settings/ai', requireRole('admin'), express.json(), (req, res) => {
  const b = req.body || {};
  if (b.provider === 'none') { if (!isDemo()) { const { ai, ...rest } = config; saveConfig(rest); } return res.json({ ok: true }); }
  if (!aiOf(b.provider) || !b.model) return res.status(400).json({ error: 'pick a provider and a model' });
  const keep = config.ai?.provider === b.provider && (b.url ? String(b.url).trim() : null) === (config.ai?.url || null) ? config.ai.apiKey : null;   // a new address needs the key typed again
  const ai = { provider: b.provider, model: String(b.model).slice(0, 120), url: b.url ? String(b.url).trim() : null, apiKey: b.apiKey ? String(b.apiKey).trim() : keep };
  if (!isDemo()) saveConfig({ ...config, ai });
  res.json({ ok: true });
});
