# Architecture

- **One small Node server** (`app/`), no framework: Express + plain JavaScript, built by
  `build.mjs`, which joins `src/server/*.js` into `server.js` and `src/client/*.js` into
  `public/app.js` in file-name order. Each file is one feature; the number sets the order.
- **Config, not code**: everything about a house lives in `data/config.json`
  (`config.example.json` shows the shape). No config → demo mode.
- **Providers**: anything tied to one vendor (Meraki, UniFi, Ring, a utility) lives in
  `src/providers/<name>` behind a small interface, and is off unless configured.
- **Host agent**: the same server in agent mode runs on each Docker host (NAS, mini-PC) and
  answers the main server's questions about containers, drives, RAID, UPS and logs.
- **Pro**: a separate private package (`casatorch-pro`) loaded at start only when a signed
  license file is present; checked offline.
- **Demo mode**: `demo/fixtures/<tab>.json` answers `/api/<tab>`; screenshots and the
  public demo come from here, never from a real house.
