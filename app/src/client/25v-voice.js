/* ---- Voice for the Home AI Agent (Pro): a mic beside the question box (the Home AI Agent tab and the panel bar).
   The browser's own speech recognition, on a secure address only. "Show me the kitchen" (a room, floor or device on the
   3D plan) opens the 3D Home there; anything else is asked like a typed question - the agent only suggests switches you tap,
   and never unlocks, opens or disarms anything. ---- */
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const LANGS = { en: 'en-US', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT', nl: 'nl-NL', ja: 'ja-JP', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN', pl: 'pl-PL', sv: 'sv-SE', tr: 'tr-TR' };
  const lang = () => { const l = (document.documentElement.lang || 'en').split('-')[0]; return (navigator.languages || []).find((x) => x.toLowerCase().startsWith(`${l}-`)) || LANGS[l] || 'en-US'; };
  const MIC = 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3';
  const style = document.createElement('style');
  style.textContent = '.micbtn.on{background:var(--bad);border-color:var(--bad);color:#fff}.micbtn svg{width:18px;height:18px;display:block}.askvoice-hint{font-size:12px;color:var(--muted);margin-top:6px}';
  document.head.append(style);
  let plan = null, planAt = 0;
  async function where(text) {   // a place on the 3D plan, or null
    try {
      if (!plan || Date.now() - planAt > 60_000) {
        const [p, l, M] = await Promise.all([fetch('/api/floorplan').then((r) => r.json()), fetch('/api/floorplan/live').then((r) => r.json()).catch(() => ({})), import('/floorplan-net-model.js')]);
        plan = { p, l, M }; planAt = Date.now();
      }
      const { p, l, M } = plan; if (!p.floors?.length) return null;
      return M.matchVoice(text, { rooms: p.floors.flatMap((f) => (f.rooms || f.plan?.rooms || []).map((r, i) => ({ name: r.name, floor: f.id, i }))), floors: p.floors.map((f) => ({ id: f.id, name: f.name, level: f.level || 0 })),
        devices: (l.pins || []).map((x) => ({ id: x.deviceId, name: x.label || x.device?.name })).filter((d) => d.name) });
    } catch { return null; }
  }
  function say(box, text) { box.querySelector('.askvoice-hint')?.remove(); if (text) box.after(Object.assign(document.createElement('div'), { className: 'askvoice-hint', textContent: text })); }
  function listen(btn, input, box) {
    if (btn.rec) { btn.rec.stop(); return; }
    if (!window.isSecureContext) return say(box, T('Voice needs the secure address. Open CasaTorch from its secure address - Settings > Connections & AI > Secure address at home.'));
    if (!SR) return say(box, T('This browser can\'t listen - voice works in Chrome, Edge and Safari.'));
    const rec = new SR(); btn.rec = rec; rec.lang = lang(); rec.interimResults = true; rec.maxAlternatives = 3;
    let final = null, err = null; btn.classList.add('on'); say(box, T('Listening…'));
    rec.onresult = (e) => { const r = e.results[e.results.length - 1]; input.value = r[0].transcript; if (r.isFinal) final = [...r].map((a) => a.transcript); };
    rec.onerror = (e) => { err = e.error; };
    rec.onend = async () => {
      btn.rec = null; btn.classList.remove('on');
      if (!final?.length) return say(box, err === 'not-allowed' || err === 'service-not-allowed' ? T('The microphone is blocked - allow it for this site in the browser\'s settings.') : T('Didn\'t catch that - tap the mic and try again.'));
      say(box, '');
      for (const a of final) { const m = await where(a); if (m) { try { sessionStorage.setItem('casatorch-3d-show', JSON.stringify({ text: a, at: Date.now() })); } catch { /* fine */ } input.value = ''; location.hash = '#house3d'; return; } }
      input.value = final[0]; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    };
    try { rec.start(); } catch { btn.rec = null; btn.classList.remove('on'); }
  }
  function addMics() {
    for (const box of document.querySelectorAll('.asker, .sb-ask')) {
      if (box.querySelector('.micbtn')) continue;
      const input = box.querySelector('input'); if (!input) continue;
      const btn = el('button', { class: 'btn micbtn', type: 'button', title: T('Speak your question - or say "Show me the kitchen"'), 'aria-label': T('Speak') });
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${MIC}"/></svg>`;
      btn.onclick = () => listen(btn, input, box);
      input.after(btn);
    }
  }
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; addMics(); }); }).observe(document.body, { childList: true, subtree: true });
})();
