/* Secure access (42-remote.js): this check has to run before every other route, so it lives here. */
/* Requests that came through the secure address: Basic only from home, Pro from anywhere. Runs first. */
app.use(async (req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase(), r = config.remote;
  if (!r?.on || !r.hostname || host !== r.hostname) return next();
  const ip = String(req.headers['cf-connecting-ip'] || '');
  if (!ip || proStatus().pro || (await fromHome(ip))) return next();
  res.status(403).type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>CasaTorch</title><body style="font:16px system-ui;background:#070a12;color:#e8eef7;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:420px;padding:24px"><h1 style="font-size:22px">You\'re away from home</h1><p style="color:#8fa0ba">This CasaTorch\'s secure address works on your home Wi-Fi. Using it from anywhere is part of CasaTorch Pro.</p></div>');
});

