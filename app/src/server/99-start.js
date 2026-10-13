// Not set up yet (and not a demo): every page goes to the setup wizard.
app.get(['/', '/index.html'], (req, res, next) => (!isConfigured() && !isDemo() ? res.redirect('/setup.html') : next()));
app.use(express.static(path.join(APP_DIR, 'public'), { extensions: ['html'] }));
if (process.env.HOUSEOS_TEST === '1') globalThis.__houseos = { app, parseIcs, expandEvents, weatherView, gameView, parseFeed, zonedToUtc };
else app.listen(PORT, () => console.log(`HouseOS on :${PORT}${isDemo() ? ' (demo mode)' : isConfigured() ? '' : ' - open it in a browser to set it up'}`));
