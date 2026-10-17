/* ======================================================================
 * Real time. Home Assistant tells CasaTorch the moment anything changes
 * (one websocket, signed in with the same token CasaTorch already has),
 * and CasaTorch tells every open screen at once (/api/live/events, a
 * server-sent event), which then fetches only what it shows. A light
 * switched at the wall, a door opening, a plug's power jumping: on the
 * dashboard and the 3D home within about a second, not at the next poll.
 *
 * Switches, lights, doors, locks, motion and the like are passed on within
 * a quarter of a second; readings that change constantly (power, energy,
 * temperature) at most every 3 seconds, so a wall tablet isn't redrawing
 * all day. With the websocket down, CasaTorch asks Home Assistant every 8
 * seconds as before, and screens keep their own slower refresh.
 * ====================================================================== */
const LIVE = { ws: null, url: '', token: '', states: null, ok: false, retry: 2000, clients: new Set(), fast: null, slow: null, slowAt: 0 };
const LIVE_FAST = /^(light|switch|fan|cover|lock|alarm_control_panel|binary_sensor|media_player|climate|vacuum|valve|siren|input_boolean|person|device_tracker|camera|event|button|scene)\./;
function haLiveStart() {
  const h = config.homeAssistant;
  if (!h?.url || !h.token || isDemo() || typeof WebSocket !== 'function' || LIVE.ws) return;
  let ws; try { ws = new WebSocket(`${h.url.replace(/^http/i, 'ws')}/api/websocket`); } catch { return haLiveLater(); }
  LIVE.ws = ws; LIVE.url = h.url; LIVE.token = h.token;
  ws.addEventListener('message', (m) => {
    let msg; try { msg = JSON.parse(String(m.data)); } catch { return; }
    if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: h.token }));
    else if (msg.type === 'auth_ok') { ws.send(JSON.stringify({ id: 1, type: 'get_states' })); ws.send(JSON.stringify({ id: 2, type: 'subscribe_events', event_type: 'state_changed' })); }
    else if (msg.type === 'auth_invalid') { try { ws.close(); } catch { /* closing anyway */ } }
    else if (msg.type === 'result' && msg.id === 1 && msg.success && Array.isArray(msg.result)) { LIVE.states = new Map(msg.result.map((s) => [s.entity_id, s])); LIVE.ok = true; LIVE.retry = 2000; liveChanged('light.'); }
    else if (msg.type === 'event' && msg.event?.event_type === 'state_changed' && LIVE.states) {
      const d = msg.event.data || {}; if (!d.entity_id) return;
      if (d.new_state) LIVE.states.set(d.entity_id, d.new_state); else LIVE.states.delete(d.entity_id);
      liveChanged(d.entity_id);
    }
  });
  const down = () => { if (LIVE.ws !== ws) return; LIVE.ws = null; LIVE.ok = false; LIVE.states = null; haLiveLater(); };
  ws.addEventListener('close', down);
  ws.addEventListener('error', () => { try { ws.close(); } catch { down(); } });
}
function haLiveLater() { const d = LIVE.retry; LIVE.retry = Math.min(60_000, LIVE.retry * 2); setTimeout(haLiveStart, d).unref?.(); }
/* Home Assistant's states as they are this second, when the websocket is up (32-ha.js asks here first). */
const haLiveStates = () => (LIVE.ok && LIVE.states ? [...LIVE.states.values()] : null);
function liveChanged(entityId) {
  CACHE.delete('ha:states'); CACHE.delete('dev:ha');   // the next question gets today's answer
  if (LIVE_FAST.test(entityId)) { clearTimeout(LIVE.fast); LIVE.fast = setTimeout(liveTell, 250); return; }
  if (LIVE.slow) return;
  LIVE.slow = setTimeout(() => { LIVE.slow = null; liveTell(); }, Math.max(250, 3000 - (Date.now() - LIVE.slowAt)));
}
function liveTell() {
  LIVE.slowAt = Date.now();
  const line = `data: ${JSON.stringify({ type: 'tick', at: LIVE.slowAt })}\n\n`;
  for (const res of LIVE.clients) { try { res.write(line); } catch { LIVE.clients.delete(res); } }
}
/* A change CasaTorch made itself (a switch from the dashboard): tell the other screens too. */
const liveNudge = () => { clearTimeout(LIVE.fast); LIVE.fast = setTimeout(liveTell, 250); };
app.get('/api/live/events', (req, res) => {
  if (LIVE.clients.size >= 100) return res.status(503).json({ error: 'too many screens open' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`retry: 5000\ndata: ${JSON.stringify({ type: 'hello', live: LIVE.ok })}\n\n`);
  LIVE.clients.add(res);
  // Signed out elsewhere (or removed): the open stream ends too, at the next beat.
  const sk = req.session?.key;
  const beat = setInterval(() => {
    if (sk && signInOn() && !sessions[sk]) { res.end(); return; }
    try { res.write(': keep-alive\n\n'); } catch { /* closing */ }
  }, 25_000);
  res.on('close', () => { clearInterval(beat); LIVE.clients.delete(res); });
});
/* Start, and follow Home Assistant being added, changed or removed in setup. */
setTimeout(haLiveStart, 2000).unref?.();
setInterval(() => {
  const h = config.homeAssistant;
  if (LIVE.ws && (!h?.url || h.url !== LIVE.url || h.token !== LIVE.token)) { const ws = LIVE.ws; LIVE.ws = null; LIVE.ok = false; LIVE.states = null; try { ws.close(); } catch { /* gone */ } }
  if (!LIVE.ws) haLiveStart();
}, 30_000).unref?.();
