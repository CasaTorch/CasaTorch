# Adding an integration

There are two ways a brand gets into CasaTorch:

1. **Through Home Assistant** - nothing to write. Anything Home Assistant supports shows up in
   CasaTorch by itself once Home Assistant is connected: every entity is mapped to a device kind
   (`app/src/server/32-ha.js`, `haDevice`), and unknown kinds still appear as readable values.
   Home Assistant cameras get pictures and live video (MJPEG through `camera_proxy_stream`).
2. **Directly** - one file in `app/src/server/`, registered with `integration()`. That's all it takes
   for it to appear on the Connect page, in Home, Controls, Cameras, the 3D home, alerts and Ask the house.

The build (`node app/build.mjs`) joins `app/src/server/*.js` in file-name order into one module, so
a new file just needs a number after `30-devices.js` (where `integration()` lives), e.g.
`app/src/server/77-acme.js`.

## The contract

```js
integration({
  id: 'acme',                        // device ids are 'acme:<your id>'
  label: 'Acme cameras',             // a label puts a card on the Connect page
  group: 'cameras',                  // cameras | controls | sensors | network | energy | day
  desc: 'Pictures from your Acme cameras.',
  how: 'direct',                     // direct | pro | ha
  pro: false,                        // true: only with Pro (and the trial)
  href: '#network',                  // where it's connected in the app, or step/add for the setup wizard
  replaces: [],                      // catalog cards (catalog/setup.json) this card stands in for
  connected: () => !!config.acme,    // the Connect page shows "Connected"

  async list() {                     // every device, as plain objects (see the kinds below)
    return (config.acme?.cameras || []).map((c) => camDevice('acme', c.id, { name: c.name, source: 'Acme' }));
  },
  async act(device, action, value) { /* on, off, toggle, set... - leave out for read-only devices */ },

  camera: {                          // only for cameras
    every: 3000,                     // ms between pictures while someone is looking
    idle: 60000,                     // ms between pictures otherwise (keep battery cameras long)
    known: async (id) => true,       // refuse ids that aren't yours
    snapshot: async (id) => ({ buf, type: 'image/jpeg' }),
    live: async (id) => ({ url: 'http://camera/mjpeg', headers: {} }),   // optional MJPEG
  },
});
```

`camDevice()` fills in the camera fields the dashboard uses: `snapshot` (served from the picture
cache at `/api/cam/<id>/<camera>/snapshot`, with ETags, so unchanged pictures cost nothing),
`stream` (live video at `/api/cam/<id>/<camera>/live`, at most 3 viewers, closed the moment the
viewer leaves), and `every` (how often tiles ask).

## Device kinds

| kind | Useful fields |
| --- | --- |
| light | `on`, `brightness` (0-100), `rgb` (`#rrggbb`) |
| fan | `on`, `percent` |
| switch, plug | `on`, `powerW` |
| sensor | `tempC`, `humidity`, `water`, `smoke`, `open`, `motion`, `battery`, `powerW` |
| camera | `snapshot`, `stream`, `every` (use `camDevice`) |
| climate | `tempC`, `targetC`, `mode` |
| lock | `locked` (CasaTorch never unlocks) |
| cover | `open`, `position` (garage doors and gates only close) |
| media | `on`, `playing`, `title`, `volume` |
| action | a scene, script or button: `act(device, 'on')` runs it |
| vacuum | `state` |
| alarm | `armed`, `triggered` (CasaTorch never disarms) |
| presence | `home` |
| value | `value`, `unit` - anything else |

Every device also has `name`, `online`, and optionally `area` (its room) and `source`.

## What you get for free

- **Alerts**: `water: true`, `smoke: true`, `battery <= 15`, `online: false` (cameras, locks,
  climate, leak and smoke sensors) and extreme `tempC` raise alerts and phone alerts.
- **Safety**: door, gate, lock and alarm controls are filtered by the safety rule in `30-devices.js`.
- **Energy**: anything with `powerW` counts toward the house total and history.
- **Names**: people can rename any device in the app.

## Checklist

- Secrets go in `config.json` under names the sealer recognises (`token`, `apiKey`, `secret`,
  `password`...), so they're encrypted at rest; never send them back to the browser.
- Time out every network call (6 s for `list()`; the dashboard never waits longer).
- Add a unit test in `app/test/unit.mjs` with a small mock of the brand's API.
- Run `node app/build.mjs && node app/test/unit.mjs`.
