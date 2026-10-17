/* ======================================================================
 * "See what's possible": a short film of CasaTorch with the demo house
 * (3D home at dusk, lights, energy, phone), shown from the setup wizard.
 * Self-contained: window.CasaTour.card() returns the card the Welcome
 * (and Review) page shows; it opens a full-screen player. The video is
 * muted, plays inline, closes with Esc or the close button, and with
 * "reduce motion" on it waits on its poster until you press play.
 * Files: /tour/tour.mp4, /tour/tour.webm, /tour/poster.jpg.
 * ====================================================================== */
(() => {
  const T = (s, v) => (typeof window.T === 'function' ? window.T(s, v) : String(s).split('|')[0]);
  const LEN = '0:26';
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mk = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k != null) e.append(k);
    return e;
  };
  const playIcon = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/>'; return s; };

  let open = null;   // the player that is showing, if any

  function player(opener) {
    if (open) return;
    const reduce = calm();
    const video = mk('video', { class: 'tour-video', muted: true, playsinline: true, preload: 'auto', poster: '/tour/poster.jpg', 'aria-label': T('CasaTorch tour video, no sound') },
      mk('source', { src: '/tour/tour.webm', type: 'video/webm; codecs=vp9' }),
      mk('source', { src: '/tour/tour.mp4', type: 'video/mp4' }));
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    const big = mk('button', { type: 'button', class: 'tour-bigplay', 'aria-label': T('Play the tour') }, playIcon());
    const close = mk('button', { type: 'button', class: 'tour-close', 'aria-label': T('Close') }, '×');
    const again = mk('button', { type: 'button', class: 'tour-btn ghost' }, T('Watch again'));
    const done = mk('button', { type: 'button', class: 'tour-btn primary' }, T('Continue setup'));
    const endBox = mk('div', { class: 'tour-end', hidden: true }, mk('p', { text: T('Ready? Let\'s get your home set up.') }), mk('div', { class: 'tour-endrow' }, again, done));
    const frame = mk('div', { class: 'tour-frame' }, video, big, endBox);
    const say = mk('p', { class: 'tour-sr', id: 'tourDesc' }, T('Shown with the CasaTorch demo house: the dashboard, the home in 3D at dusk with lights coming on room by room, tapping a light in 3D to turn it on, energy use, and CasaTorch on a phone.'));
    const box = mk('div', { class: 'tour-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('What CasaTorch can do'), 'aria-describedby': 'tourDesc' },
      mk('div', { class: 'tour-top' }, mk('span', { class: 'tour-kicker', text: T('What\'s possible') }), mk('span', { class: 'tour-note', text: T('Demo house · the 3D home is part of Pro · no sound') }), close),
      frame, say);
    const root = mk('div', { class: 'tour-overlay' }, box);

    const showPlay = (on) => { big.hidden = !on; };
    const play = () => { endBox.hidden = true; showPlay(false); const p = video.play(); if (p && p.catch) p.catch(() => showPlay(true)); };
    big.addEventListener('click', play);
    again.addEventListener('click', () => { video.currentTime = 0; play(); });
    video.addEventListener('click', () => { if (video.paused) play(); else { video.pause(); showPlay(true); } });
    video.addEventListener('ended', () => { endBox.hidden = false; setTimeout(() => done.focus(), 30); });
    const shut = () => {
      if (!open) return;
      video.pause(); video.removeAttribute('src'); for (const s of video.querySelectorAll('source')) s.remove(); video.load();
      root.classList.add('out'); document.removeEventListener('keydown', key, true);
      document.documentElement.classList.remove('tour-lock');
      setTimeout(() => root.remove(), reduce ? 0 : 180);
      open = null; try { opener?.focus(); } catch { /* gone */ }
    };
    done.addEventListener('click', shut); close.addEventListener('click', shut);
    root.addEventListener('click', (e) => { if (e.target === root) shut(); });
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); return; }
      if (e.key === 'Tab') {   // keep the keyboard inside the player
        const f = [...box.querySelectorAll('button, video')].filter((x) => !x.hidden && !x.closest('[hidden]'));
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
      if (e.key === ' ' && document.activeElement === video) { e.preventDefault(); video.click(); }
    };
    document.addEventListener('keydown', key, true);
    document.documentElement.classList.add('tour-lock');
    document.body.append(root);
    open = { shut, video };
    requestAnimationFrame(() => root.classList.add('in'));
    close.focus();
    if (reduce) showPlay(true); else play();
  }

  function card(atEnd) {
    const btn = mk('button', { type: 'button', class: `tour-card${atEnd ? ' end' : ''}`, 'aria-haspopup': 'dialog' },
      mk('span', { class: 'tour-thumb', 'aria-hidden': 'true' }, mk('img', { src: '/tour/poster.jpg', alt: '', loading: 'lazy', decoding: 'async', width: '160', height: '90' }), mk('span', { class: 'tour-play' }, playIcon())),
      mk('span', { class: 'tour-text' },
        mk('b', {}, atEnd ? T('Here\'s what you\'re setting up') : T('See what\'s possible'), mk('span', { class: 'tour-len', text: LEN })),
        mk('span', { class: 'tour-sub', text: atEnd ? T('Your home in 3D, lights at a tap, energy and more - a short look before you finish.') : T('Your home in 3D, lights at a tap, energy and more - a short film with the demo house.') })));
    btn.addEventListener('click', () => player(btn));
    return btn;
  }

  window.CasaTour = { card, open: () => player(document.activeElement), close: () => open?.shut() };
})();
