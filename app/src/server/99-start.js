// Not set up yet (and not a demo): every page goes to the setup wizard.
app.get(['/', '/index.html'], (req, res, next) => (!isConfigured() && !isDemo() ? res.redirect('/setup.html') : next()));
app.use(staticPacked);
app.use(express.static(path.join(APP_DIR, 'public'), { extensions: ['html'], setHeaders: (res, f) => { if (/\.(html|js|css)$/.test(f)) res.setHeader('Cache-Control', 'no-cache'); } }));
/* Anything that went wrong: a short answer, never a stack trace (file paths, versions) - whatever NODE_ENV says. */
app.use((err, req, res, _next) => {   // eslint-disable-line no-unused-vars
  const status = Number(err?.status || err?.statusCode) >= 400 && Number(err.status || err.statusCode) < 600 ? Number(err.status || err.statusCode) : 500;
  if (status >= 500) console.error(`${req.method} ${req.path}:`, String(err?.stack || err).slice(0, 600));
  if (res.headersSent) return res.end();
  const msg = status === 413 ? 'That is too big.' : status === 400 ? 'That request could not be read.' : status < 500 ? 'That request was refused.' : 'Something went wrong.';
  return req.path.startsWith('/api/') ? res.status(status).json({ error: msg }) : res.status(status).type('text/plain').send(msg);
});
for (const p of [PORT, typeof HTTPS_PORT === 'number' ? HTTPS_PORT : 8443]) SELF_PORTS.add(Number(p));   // CasaTorch's own requests to these, on this computer, are marked (00-setup.js)
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorchGuard = { assertFetchable, publicUrlProblem, nonPublicIp, PRESETUP_OPEN, overLimit, SELF_PORTS };
if (process.env.CASATORCH_TEST === '1') globalThis.__casatorch = { fpGroup, nudgeOnDay, hostAllowed, blockedUrl, atParseTrace, atZones, atParseUrl, atHttp, parseNeighbors, portInfo, securityChecklist, wantsSecure, LOCAL_TLS, ltPrivate, haServiceData, energyFlows, riskOf, app, totpAt, b32enc, b32dec, totpOk, seal, unseal, sealConfig, openConfig, writeFileSafe, sendSnap, SNAP, passwordProblem, haDevice, parseIcs, expandEvents, weatherView, gameView, parseFeed, zonedToUtc, okEndpoint, sevOf, quietNow, blocked, housePower, fromHome, remote, weekStats, ruleReport, addDays, historySample, hist, alerts, parseTarget, checkOne, NET, isLanHost, networkAlerts, netState, billForecast, alertConditions, someoneHome, mtDevice, integration, camDevice, mjpegPass };
else app.listen(PORT, () => console.log(`CasaTorch on :${PORT}${isDemo() ? ' (demo mode)' : isConfigured() ? '' : ' - open it in a browser to set it up'}`))
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use - CasaTorch (or something else) is probably already running.\nOpen http://localhost:${PORT}, stop the other copy (Control+C in its window), or pick another port: PORT=8095 npm run demo\n`);
    else console.error(err);
    process.exit(1);
  });

/* Self-healing: one integration's stray error must never take the whole house down. A promise nobody caught is
   logged and CasaTorch carries on; a real crash is logged and the service manager (systemd, launchd, Docker,
   Windows Task Scheduler - all set to restart) starts CasaTorch again within seconds. */
process.on('unhandledRejection', (err) => { console.warn('CasaTorch: an integration hit an error it didn\'t handle (carrying on):', String(err?.stack || err).slice(0, 600)); });
process.on('uncaughtException', (err) => { console.error('CasaTorch crashed - restarting:', String(err?.stack || err).slice(0, 1200)); process.exit(1); });
