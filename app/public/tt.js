/* Trusted Types (CSP: require-trusted-types-for 'script'; trusted-types casatorch default). Loaded first on every page.
   With it, a string can't become HTML or a script address by accident: every HTML sink (innerHTML and the like) goes
   through one of these two policies, which take out anything that could run - script, iframe, object, embed, base
   and meta elements, on...= handlers, javascript: links - and scripts and workers may only come from this CasaTorch
   (or a blob it made itself). Strings are never run as code. CasaTorch's own code uses window.ctPolicy ("casatorch");
   anything else ("default") gets the same rules. Browsers without Trusted Types skip this; the CSP still applies. */
(() => {
  const TT = window.trustedTypes;
  if (!TT || typeof TT.createPolicy !== 'function') return;
  const KILL = /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|base|meta|link)\b[^>]*>/gi;
  const ON = /\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
  const JS = /\b(href|src|xlink:href|action|formaction|data)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)/gi;
  const createHTML = (s) => {
    const out = String(s).replace(KILL, '').replace(ON, '').replace(JS, '$1=$2#blocked-');
    if (out !== String(s)) console.warn('CasaTorch took out something that could run from a piece of HTML.');
    return out;
  };
  const createScriptURL = (u) => {
    const x = new URL(String(u), location.href);
    if (x.origin === location.origin && (x.protocol === 'blob:' || x.protocol === location.protocol)) return x.href;
    throw new TypeError(`Scripts only come from this CasaTorch, not ${x.origin}`);
  };
  const rules = { createHTML, createScriptURL };
  try { window.ctPolicy = TT.createPolicy('casatorch', rules); } catch { /* already made on this page */ }
  try { TT.createPolicy('default', rules); } catch { /* already made */ }
})();
