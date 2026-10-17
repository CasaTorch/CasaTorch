/* ======================================================================
 * CasaTorch's own log, kept in memory (the last 600 lines) so admins can read
 * it in Settings › Advanced without a terminal. Anything that looks like a
 * secret (tokens, keys, passwords, sign-ins inside addresses, long random
 * strings) is masked - in that copy and in what goes to the system log
 * (journald, Docker, the add-on log) - so a log is safe to share with support.
 * ====================================================================== */
const LOGBUF = [], LOG_MAX = 600;
/* Explicit secrets: values after a secret-sounding name, Bearer/Basic credentials, sign-ins inside addresses. */
const logMaskNamed = (s) => String(s)
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
  .replace(/((?:token|secret|password|passphrase|passwd|api[_-]?key|private[_-]?key|access[_-]?key|authorization|cookie|session)["']?\s*[:=]\s*["']?)(?!(?:Bearer|Basic) \*\*\*)[^\s"',;&]+/gi, '$1***')
  .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@');   // rtsp://user:pass@camera
/* ...and any long random-looking string (a key or token on its own). */
const logMask = (s) => logMaskNamed(s).replace(/\b[A-Za-z0-9_\-+/=]{40,}\b/g, (m) => `${m.slice(0, 4)}…(${m.length})`);
/* For the system log: the same, except that file paths (in error stacks) stay readable. */
const logMaskSys = (s) => logMaskNamed(s).replace(/\b[A-Za-z0-9_\-+=]{40,}\b/g, (m) => `${m.slice(0, 4)}…(${m.length})`);
const logMaskArg = (a) => (typeof a === 'string' ? logMaskSys(a) : a instanceof Error ? logMaskSys(a.stack || a.message) : a);
for (const level of ['log', 'info', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    let text = '';
    try { text = args.map((a) => (a instanceof Error ? `${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').trim(); } catch { /* a value that can't be shown */ }
    try { orig(...args.map(logMaskArg)); } catch { orig(...args); }
    try {
      if (text) { LOGBUF.push({ at: new Date().toISOString(), level: level === 'log' || level === 'info' ? 'info' : level, text: logMask(text).slice(0, 2000) }); if (LOGBUF.length > LOG_MAX) LOGBUF.splice(0, LOGBUF.length - LOG_MAX); }
    } catch { /* never let logging break anything */ }
  };
}
