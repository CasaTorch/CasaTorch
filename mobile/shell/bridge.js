/* CasaTorch app bridge: window.CasaNative, for the app's own screens and for your CasaTorch's pages inside the app.
   The app injects this only into its own screens and the home you signed in to (it checks the address on every call).
   Calls go to the native side as JSON ({ id, cmd, args }) and come back through __casaReply; big answers (a room scan)
   arrive in pieces through __casaChunk first. */
(() => {
  if (window.CasaNative) return;
  const ios = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.casa, android = window.CasaAndroid;
  if (!ios && !android) return;
  const info = window.__casaInfo || {};
  let seq = 0;
  const waiting = new Map(), parts = new Map();
  const call = (cmd, args = {}) => new Promise((resolve, reject) => {
    const id = ++seq; waiting.set(id, { resolve, reject });
    const msg = JSON.stringify({ id, cmd, args });
    try { if (ios) ios.postMessage(msg); else android.postMessage(msg); } catch (e) { waiting.delete(id); reject(e); }
  });
  const fire = (cmd, args) => { call(cmd, args).catch(() => {}); };
  window.__casaChunk = (id, b64) => { if (!parts.has(id)) parts.set(id, []); parts.get(id).push(b64); };
  window.__casaReply = (id, ok, data) => {
    const w = waiting.get(id); if (!w) return; waiting.delete(id);
    if (!ok) { parts.delete(id); w.reject(new Error((data && data.message) || 'That didn\'t work.')); return; }
    if (data && data.chunked) {   // join the pieces into the file's bytes
      const list = parts.get(id) || []; parts.delete(id);
      const bins = list.map((p) => { const s = atob(p), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; });
      const out = new Uint8Array(bins.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of bins) { out.set(b, o); o += b.length; }
      data.bytes = out; delete data.chunked;
    }
    w.resolve(data);
  };
  window.__casaEvent = (name, detail) => { try { window.dispatchEvent(new CustomEvent(`casa:${name}`, { detail })); } catch { /* old browser */ } };
  window.CasaNative = Object.freeze({
    platform: info.platform || (ios ? 'ios' : 'android'), version: info.version || '', device: info.device || '', hasLidar: !!info.lidar,
    /* feel */
    haptic: (kind = 'light') => fire('haptic', { kind }), fullscreen: (on) => fire('fullscreen', { on: !!on }), share: (o) => call('share', o), openExternal: (url) => fire('openExternal', { url }),
    /* Face ID / Touch ID / fingerprint */
    biometrics: () => call('biometrics'), setBiometricLock: (on) => call('setBiometricLock', { on: !!on }),
    /* alerts: asks the phone's permission, returns { platform, token, key } for this home */
    pushEnable: () => call('pushEnable'),
    /* scanning a room (iPhone / iPad with LiDAR) */
    lidar: () => call('lidar'), scanRoom: () => call('scanRoom'),
    /* homes */
    homes: () => call('homes'), saveHome: (h) => call('saveHome', h), openHome: (id) => fire('openHome', { id }), removeHome: (id) => call('removeHome', { id }),
    switchHome: () => fire('switchHome'), signOut: () => fire('signOut'), scanQR: () => call('scanQR'), deviceInfo: () => call('deviceInfo'), copy: (text) => call('copy', { text: String(text || '').slice(0, 4096) }),
  });
})();
