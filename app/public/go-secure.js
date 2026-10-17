/* Sent instead of a page opened over plain http, once this CasaTorch has its secure address at home
   (src/server/03-https-redirect.js). Try the https address from this browser; go there if it answers,
   otherwise remember it doesn't (for a day) and carry on over http. */
(async () => {
  const stay = () => { document.cookie = 'ct_plain=1; Max-Age=86400; Path=/; SameSite=Lax'; location.reload(); };
  try {
    const { url } = await (await fetch('/api/local-https/target', { cache: 'no-store' })).json();
    if (!url) return stay();
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
    await fetch(`${url}/api/local-https/ping`, { mode: 'cors', cache: 'no-store', signal: ctl.signal });   // throws if the name doesn't resolve here or nothing answers
    location.replace(url + location.pathname + location.search + location.hash);
  } catch { stay(); }
})();
