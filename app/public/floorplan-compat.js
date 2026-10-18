/* The 3D home on older browsers (wall tablets, old Android WebViews). A plain script on purpose - it must run
   where modules or newer JavaScript don't, and it is written in old JavaScript (no arrow functions, no const).
   - The 3D home needs Chrome or Edge 94+, Safari 16.4+ or Firefox 108+ (three.js uses class static blocks, and the
     page uses import maps). Older browsers get a short, honest message instead of a blank page.
   - color-mix() in our styles needs Chrome 111+ / Safari 16.2+: on older browsers the panels would lose their tinted
     backgrounds and borders, so each color-mix() is worked out once here (from the page's own colors) and added as
     plain colors. Re-done when the look (theme) changes.
   Then it starts floorplan.js. */
(function () {
  'use strict';
  var w = window, d = document;
  function el(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function tt(s) { return typeof w.T === 'function' ? w.T(s) : s; }

  function tooOld() {
    if (d.getElementById('tooold')) return;
    var box = el('div', 'tooold'); box.id = 'tooold'; box.setAttribute('role', 'alert');
    var card = el('div', 'toooldcard');
    card.appendChild(el('h2', '', tt('This browser is too old for the 3D home')));
    card.appendChild(el('p', '', tt('The 3D home needs Chrome or Edge 94 or newer, Safari 16.4 or newer, or Firefox 108 or newer. On a wall tablet, updating its browser (or Android System WebView) usually fixes it.')));
    card.appendChild(el('p', '', tt('Everything else in CasaTorch works here.')));
    var a = el('a', 'toooldbtn', tt('Back to the dashboard')); a.href = '/'; card.appendChild(a);
    box.appendChild(card);
    (d.body || d.documentElement).appendChild(box);
  }
  w.__casa3dTooOld = tooOld;

  var ok = typeof Object.hasOwn === 'function' && typeof [].at === 'function' && typeof Promise !== 'undefined' &&
    typeof HTMLScriptElement !== 'undefined' && 'noModule' in HTMLScriptElement.prototype && !!(w.CSS && CSS.supports);
  if (!ok || /[?&]tooold=1/.test(location.search)) { tooOld(); return; }

  /* A browser that has the newer functions but not the newer syntax stops with a SyntaxError while loading the modules. */
  w.addEventListener('error', function (e) {
    if (w.__casa3dReady) return;
    var m = String((e && (e.message || (e.error && e.error.name))) || '');
    if (/SyntaxError|Unexpected token|import map|Failed to resolve module specifier/i.test(m)) tooOld();
  });
  var s = d.createElement('script'); s.type = 'module'; s.src = 'floorplan.js'; d.body.appendChild(s);

  /* ---------- color-mix() for browsers without it ---------- */
  if (CSS.supports('color', 'color-mix(in srgb, red 50%, blue)')) return;
  var probe = null;
  function rgba(c) {   // any CSS color -> [r, g, b, a], via the browser itself
    if (!probe) { probe = el('i'); probe.style.display = 'none'; d.body.appendChild(probe); }
    probe.style.color = ''; probe.style.color = c;
    var m = getComputedStyle(probe).color.match(/[\d.]+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2], m[3] == null ? 1 : +m[3]];
  }
  function varVal(name, fallback) { var v = getComputedStyle(d.documentElement).getPropertyValue(name).trim(); return v || fallback || ''; }
  function resolve(x) {   // var(--a, var(--b, #fff)) -> a color
    x = x.trim(); var m = x.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
    if (!m) return x;
    var v = varVal(m[1]); return v ? resolve(v) : m[2] ? resolve(m[2]) : 'transparent';
  }
  function split(args) { var out = [], depth = 0, cur = ''; for (var i = 0; i < args.length; i++) { var ch = args[i]; if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
  function mix(args) {   // "in srgb, A p%, B [q%]" -> rgba(...)
    var p = split(args); if (p.length < 3) return null;
    var a = p[1].trim(), b = p[2].trim(), pa = null, pb = null, mm;
    if ((mm = a.match(/^([\s\S]*?)\s+([\d.]+)%$/))) { a = mm[1]; pa = +mm[2] / 100; }
    if ((mm = b.match(/^([\s\S]*?)\s+([\d.]+)%$/))) { b = mm[1]; pb = +mm[2] / 100; }
    if (pa == null && pb == null) { pa = 0.5; pb = 0.5; } else if (pa == null) pa = 1 - pb; else if (pb == null) pb = 1 - pa;
    var A = rgba(resolve(a)), B = rgba(resolve(b)), sum = pa + pb || 1, ka = pa / sum, kb = pb / sum;
    var alpha = A[3] * ka + B[3] * kb, ch = function (i) { return alpha ? Math.round((A[i] * A[3] * ka + B[i] * B[3] * kb) / alpha) : 0; };
    return 'rgba(' + ch(0) + ',' + ch(1) + ',' + ch(2) + ',' + (Math.round(alpha * 1000) / 1000) + ')';
  }
  function rewrite(css) {   // keep only the rules that use color-mix(), with plain colors in its place
    var out = '', i = 0, stack = [];
    var re = /([^{}]*)\{([^{}]*)\}|([^{}]*)\{|\}/g, m;
    while ((m = re.exec(css))) {
      if (m[3] != null) { stack.push(m[3].trim()); continue; }   // an @media (or other block) opens
      if (m[0] === '}') { stack.pop(); continue; }
      var sel = m[1].trim(), body = m[2]; if (body.indexOf('color-mix(') < 0 || !sel || sel.charAt(0) === '@') continue;
      var decls = body.split(';').filter(function (x) { return x.indexOf('color-mix(') >= 0; }).map(function (x) {
        return x.replace(/color-mix\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, function (all, args) { return mix(args) || 'transparent'; });
      }).join(';');
      var rule = sel + '{' + decls + '}';
      for (var k = stack.length - 1; k >= 0; k--) if (/^@media|^@supports/.test(stack[k])) rule = stack[k] + '{' + rule + '}';
      out += rule + '\n'; i++;
    }
    return out;
  }
  var texts = null;
  function sources() {
    if (texts) return Promise.resolve(texts);
    var links = [].slice.call(d.querySelectorAll('link[rel=stylesheet]')).filter(function (l) { return /floorplan[\w-]*\.css/.test(l.href); });
    return Promise.all(links.map(function (l) { return fetch(l.href).then(function (r) { return r.text(); }).catch(function () { return ''; }); })).then(function (list) { texts = list; return list; });
  }
  function apply() {
    sources().then(function (list) {
      var inline = [].slice.call(d.querySelectorAll('style')).filter(function (s) { return s.id !== 'cmfix'; }).map(function (s) { return s.textContent; });
      var css = list.concat(inline).map(rewrite).join('\n'), st = d.getElementById('cmfix');
      if (!st) { st = el('style'); st.id = 'cmfix'; } d.head.appendChild(st);   // last, so it wins over the rules it stands in for
      st.textContent = css;
    });
  }
  var t = null; function soon() { clearTimeout(t); t = setTimeout(apply, 120); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', soon); else soon();
  w.addEventListener('load', soon);
  new MutationObserver(soon).observe(d.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-night'] });
  new MutationObserver(function (list) { for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].addedNodes.length; j++) { var n = list[i].addedNodes[j]; if (n.tagName === 'STYLE' && n.id !== 'cmfix' || n.tagName === 'LINK') { texts = n.tagName === 'LINK' ? null : texts; soon(); return; } } }).observe(d.head, { childList: true });
})();
