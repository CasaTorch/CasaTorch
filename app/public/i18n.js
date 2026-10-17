/* ======================================================================
 * Languages. CasaTorch is in English unless the home picks another
 * language (asked in setup, changed in Settings > Look & feel).
 *
 * T('Settings') returns the text in the home's language, or the English
 * when there's no translation yet - so a screen that isn't translated
 * simply stays English. T('Welcome to {house}', { house }) fills in values.
 * A key can carry a context after "|" ("Open|state" vs the button "Open").
 * Translations: public/i18n/<lang>.json, built from tools/i18n-strings.tsv.
 * ====================================================================== */
(() => {
  const LANGS = { en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français', pt: 'Português', it: 'Italiano', nl: 'Nederlands', pl: 'Polski', sv: 'Svenska', tr: 'Türkçe', hi: 'हिन्दी', ja: '日本語', zh: '简体中文', ko: '한국어' };
  /* First visit: the browser's own language, when CasaTorch speaks it. */
  const guess = () => { for (const l of navigator.languages || [navigator.language || 'en']) { const k = String(l).toLowerCase().split('-')[0]; if (LANGS[k]) return k; } return 'en'; };
  const KEY = 'casatorch-lang';
  let lang = 'en', dict = {};
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && LANGS[c.lang] && c.dict) { lang = c.lang; dict = c.dict; } } catch { /* first visit or private window */ }
  document.documentElement.lang = lang;
  function T(s, vars) {
    let out = (lang !== 'en' && dict[s]) || String(s).split('|')[0];
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return out;
  }
  /* A sentence from the server with values in it: the English as sent, plus a stable key and its values
     ({ msg: 'Almost full: {free}', vars: { free: '1.2 GB' } }). Shown in the home's language when there's a
     translation; a value that is itself a known phrase ("The Hue bridge") is translated too. */
  function TM(text, msg, vars) {
    const key = msg || text;
    if (lang === 'en' || key == null || !dict[key]) return text != null ? String(text) : T(String(key || ''), vars);
    const v = {}; for (const [k, x] of Object.entries(vars || {})) v[k] = typeof x === 'string' && dict[x] ? dict[x] : x;
    return T(key, v);
  }
  /* Switch language; resolves true when it changed (the page then redraws what it shows). */
  async function use(l) {
    l = LANGS[l] ? l : 'en';
    if (l === lang && (l === 'en' || Object.keys(dict).length)) return false;
    let d = {};
    if (l !== 'en') { try { const r = await fetch(`/i18n/${l}.json`, { cache: 'no-cache' }); if (r.ok) d = await r.json(); } catch { /* offline: keep English */ } }
    lang = l; dict = d; document.documentElement.lang = l;
    try { localStorage.setItem(KEY, JSON.stringify({ lang, dict })); } catch { /* private window */ }
    return true;
  }
  window.CasaI18n = { LANGS, T, TM, use, guess, get lang() { return lang; } };
  window.T = T; window.TM = TM;
})();
