/* ======================================================================
 * Camera pictures, fast.
 *
 * Every camera's latest picture is kept here, ready to send. While anyone
 * is looking at a camera (it was asked for in the last minute) it is
 * refreshed in the background - local cameras every 2 s, Ring every 4 s,
 * Home Assistant cameras every 3 s - and right away on a doorbell press or
 * motion. So a screen never waits on the camera or on Ring's servers: it
 * gets the newest picture we have in milliseconds, and asks again with
 * If-None-Match so an unchanged picture costs nothing to send.
 *
 * One fetch per camera at a time, however many screens are watching.
 * A failed fetch keeps the last good picture (with its age) instead of
 * blanking the tile. Every camera gets a picture once a minute even when
 * nobody is watching, so the first look is never empty.
 * ====================================================================== */
const SNAP = new Map();   // key -> { buf, type, at, etag, err, inflight, fetcher, every, wanted }
const SNAP_EVERY = { local: 2000, ring: 4000, ha: 3000 };
const SNAP_IDLE = 60_000, SNAP_WATCH = 60_000;
function snapEntry(key, fetcher, kind) {
  let e = SNAP.get(key);
  if (!e) { e = { buf: null, type: 'image/jpeg', at: 0, etag: null, err: null, inflight: null, fetcher, every: SNAP_EVERY[kind] || 3000, wanted: 0 }; SNAP.set(key, e); }
  e.fetcher = fetcher;   // the camera's settings may have changed
  return e;
}
function snapRefresh(e) {
  if (e.inflight) return e.inflight;
  e.started = Date.now();
  e.inflight = (async () => {
    try {
      const img = await e.fetcher();
      if (img?.buf?.length) {
        const etag = `"${crypto.createHash('sha1').update(img.buf).digest('base64url').slice(0, 20)}"`;
        Object.assign(e, { buf: img.buf, type: img.type || 'image/jpeg', at: Date.now(), etag, err: null });
      }
    } catch (err) { e.err = String(err.message || err); e.errAt = Date.now(); }
    finally { e.inflight = null; }
  })();
  return e.inflight;
}
/** Answer a picture request from the cache; fetch only if we have nothing yet (or it is very old). */
async function sendSnap(req, res, key, fetcher, kind) {
  const e = snapEntry(key, fetcher, kind);
  e.wanted = Date.now();
  if (!e.buf || Date.now() - e.at > 5 * 60_000) await snapRefresh(e);
  else if (Date.now() - (e.started || 0) > e.every) snapRefresh(e);   // fresh enough to send now; a newer one is on its way
  if (!e.buf) return res.status(502).json({ error: e.err || 'the camera did not send a picture' });
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', e.etag);
  res.setHeader('X-Snapshot-Age', String(Math.round((Date.now() - e.at) / 1000)));
  if (req.headers['if-none-match'] === e.etag) return res.status(304).end();
  res.setHeader('Content-Type', e.type);
  res.end(e.buf);
}
/** Something happened at this camera (doorbell, motion): get a new picture now. */
const snapNow = (key) => { const e = SNAP.get(key); if (e) snapRefresh(e); };
/* The background refresher: watched cameras on their own beat, the rest once a minute. */
setInterval(() => {
  const now = Date.now();
  for (const e of SNAP.values()) {
    const watched = now - e.wanted < SNAP_WATCH;
    // timed start-to-start, so a slow camera (or Ring's servers) still gets a new picture on its beat
    const due = now - (e.started || 0) >= (watched ? e.every : SNAP_IDLE) && !(e.err && now - (e.errAt || 0) < 10_000);
    if (due) snapRefresh(e);
  }
}, 500).unref?.();
