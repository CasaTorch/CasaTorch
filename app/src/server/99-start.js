app.use(express.static(path.join(APP_DIR, 'public'), { extensions: ['html'] }));
app.listen(PORT, () => console.log(`HouseOS on :${PORT}${DEMO ? ' (demo mode - no real house connected)' : ''}`));
