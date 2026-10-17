/* ======================================================================
 * CasaTorch's own log, kept in memory (the last 600 lines) so admins can read
 * it in Settings › Advanced without a terminal. Anything that looks like a
 * secret (tokens, keys, passwords, long random strings) is masked before it
 * is kept, so the log is safe to download and share with support.
 * ====================================================================== */
const LOGBUF = [], LOG_MAX = 600;
const logMask = (s) => String(s)
  .replace(/((?:token|secret|password|passphrase|api[_-]?key|authorization|bearer|cookie|session)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1***')
  .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/g, '$1 ***')
  .replace(/\b[A-Za-z0-9_\-+/=]{40,}\b/g, (m) => `${m.slice(0, 4)}…(${m.length})`);
for (const level of ['log', 'info', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    try {
      const text = args.map((a) => (a instanceof Error ? `${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').trim();
      if (text) { LOGBUF.push({ at: new Date().toISOString(), level: level === 'log' || level === 'info' ? 'info' : level, text: logMask(text).slice(0, 2000) }); if (LOGBUF.length > LOG_MAX) LOGBUF.splice(0, LOGBUF.length - LOG_MAX); }
    } catch { /* never let logging break anything */ }
  };
}
