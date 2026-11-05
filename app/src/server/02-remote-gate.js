/* Secure access (42-remote.js): this check has to run before every other route, so it lives here. */
/* Requests that came through the secure address: Basic only from home, Pro from anywhere. Runs first.
   CasaTorch's own self-test (a one-time code, remoteNonceOk) always gets through: it checks the tunnel, not the plan.
   Pages get a friendly page; /api/* gets JSON the phone app understands ({ away, needsPro }), never a page. */
const AWAY_TEXT = 'You\'re away from home. Using CasaTorch from anywhere is part of Pro.';
const AWAY_SIGNIN_TEXT = 'You\'re away from home. Sign-in is off on this CasaTorch, so it only answers on your home network. Turn sign-in on to use it from anywhere.';
/* A request that came down the tunnel. cloudflared runs on this box, so those arrive from this computer carrying
   Cloudflare's CF-Connecting-IP / CF-Ray - whatever Host header they have: the tunnel's settings on Cloudflare's side
   could give them another one (an address, "localhost"), and that must never make a visitor from the internet look
   like someone at home. */
const viaTunnel = (req) => !!config.remote?.on && /^(127\.|::1$|::ffff:127\.)/.test(String(req.socket?.remoteAddress || '')) && !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
app.use(async (req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase(), r = config.remote, tunnel = viaTunnel(req);
  if (!r?.on || !r.hostname || (host !== String(r.hostname).toLowerCase() && !tunnel)) return next();
  const ip = String(req.headers['cf-connecting-ip'] || '');
  /* Away from home the secure address is on the open internet: never without sign-in (a config.json with
     "signIn": { "enabled": false }, or no accounts yet), even with Pro. At home it works as the home network does. */
  const pro = proStatus().pro;
  if ((!ip && !tunnel) || (pro && signInOn()) || remoteNonceOk(req) || (ip && await fromHome(ip))) return next();
  const needsSignIn = pro;   // Pro, but sign-in is off
  res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/api/')) {
    const o = req.headers.origin;   // the app's own screens may read it (no cookies)
    if (o && APP_ORIGINS.has(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
    return res.status(403).json(needsSignIn ? { error: AWAY_SIGNIN_TEXT, away: true, needsSignIn: true } : { error: AWAY_TEXT, away: true, needsPro: true });
  }
  res.status(403).type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>CasaTorch</title><body style="font:16px system-ui;background:#070a12;color:#e8eef7;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:420px;padding:24px"><h1 style="font-size:22px">You're away from home</h1><p style="color:#8fa0ba">${needsSignIn ? AWAY_SIGNIN_TEXT : 'This CasaTorch\'s secure address works on your home Wi-Fi. Using it from anywhere is part of CasaTorch Pro.'}</p><p><a href="/" style="color:#5eb8ff">Try again</a></p></div>`);
});
