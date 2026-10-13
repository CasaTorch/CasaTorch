# HouseOS

**One screen for your whole house - with or without Home Assistant.**

HouseOS is a self-hosted home dashboard built for a wall-mounted tablet (and your phone). Weather,
family calendars, your teams' scores, headlines, the internet, lights and plugs, cameras, sensors,
power use - and, with Pro, your house as a live 3D model from an iPhone LiDAR scan.

It runs on hardware you already have: a Raspberry Pi, a NAS with Docker, an old Windows PC, a mini PC.
Nothing leaves your house unless you turn on a feature that needs to.

> **Status: 0.2, early.** Everything below marked "now" works today and is tested against sample
> data and a mock Home Assistant. Some outside services (weather, scores, Ring) still need testing
> against the real thing on more networks - please open an issue if something doesn't work for you.

## Try it in two minutes (demo house, no setup)

```bash
git clone https://github.com/gethouseos/houseos && cd houseos/app
npm install
npm run demo          # open http://localhost:8090
```

## Install it for real

| Runs on | How |
| --- | --- |
| Raspberry Pi 4/5, Debian, Ubuntu | `sudo ./deploy/install.sh` - a service that starts at boot |
| NAS or any Docker host (amd64/arm64) | `cd deploy && docker compose up -d` |
| Windows 10/11 | `deploy\install.ps1` in PowerShell as Administrator |
| macOS / anything with Node 20+ | `cd app && npm install && npm start` |

Then open `http://<that machine>:8090`. Hardware advice and wall-screen picks: [docs/HARDWARE.md](docs/HARDWARE.md).

## Setup asks the questions for you

The first time you open HouseOS, a setup wizard walks through:

1. **Your home** - name, time zone, units, and your town for the weather (rounded position only)
2. **Your login** - password, a PIN for risky actions, and a Pro key if you have one
3. **Calendars** - paste Google / iCloud / Outlook private iCal links (no sign-in)
4. **Your teams** - NFL, NBA, MLB, NHL, MLS, college, Premier League and more: live scores and next game
5. **Headlines** - AP, NPR, BBC, tech, sports, or any RSS feed
6. **Reminders** - trash night, meds, feed the fish
7. **Home Assistant** - optional. If you have it, HouseOS adds integrations *inside* Home Assistant
   for you (Home Assistant asks its own questions; HouseOS shows them)
8. **Cameras, lights, sensors** - each brand says whether it needs Home Assistant
9. **Network, energy, alerts**

Run it again any time from **Settings > Run setup again**; what you don't change is kept.

## What works without Home Assistant

| | Now |
| --- | --- |
| Weather (MET Norway), calendars (iCal), sports scores (ESPN), news (RSS) | ✓ |
| Internet: online/offline, public IP, provider, ping, speed tests every 4 h | ✓ |
| Philips Hue (local, press-the-button pairing) | ✓ |
| Shelly plugs, relays, meters, sensors (local) | ✓ |
| YoLink sensors (official API) | ✓ |
| Cameras: Frigate, Reolink, any camera with a snapshot address | ✓ |
| Ring doorbells/cameras (Pro, Labs - unofficial API) | ✓ |
| Energy: live watts per plug, cost at your rate | ✓ |
| Alerts: leaks, smoke, low batteries, devices offline, internet down | ✓ |

With Home Assistant you also get everything it supports: Z-Wave, Zigbee, Matter, locks, thermostats,
Nest, your power company's real usage (Opower), and thousands more. The full list, including what
we decided *not* to support and why: [docs/SUPPORT-MATRIX.md](docs/SUPPORT-MATRIX.md).

## Free and Pro

**Free** is open source (AGPL-3.0) and complete for one house at home. **Pro** ($5/month, $49/year or
$129 once; 14-day trial for every new install) adds the 3D Home, Ring, and - as they ship - remote
access, phone alerts, smart alerts, energy insights and more. Details and what ships today:
[docs/EDITIONS.md](docs/EDITIONS.md).

### 3D Home (Pro)

Scan each floor with an iPhone or iPad Pro (Polycam, Scaniverse or 3D Scanner App, LiDAR room mode),
export **GLB**, and upload it under **3D Home > Floors**. Line the floors up, then **Place devices**:
pick a light, plug, speaker, camera or sensor and click where it is. Lights glow when on, speakers
pulse when music plays, leaks and open doors flash, the top bar shows total watts - and tapping a
pin switches it or opens the camera. The step-by-step guide is built into the page ("How to scan").

## Privacy

Settings are one file (`config.json`, owner-only) on your box. Device passwords you type during
setup go to that device or to Home Assistant; Ring and power-company passwords are never stored.
More: [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

`app/src/server/*.js` and `app/src/client/*.js` are joined in file-name order by `app/build.mjs`.
`node app/test/unit.mjs` runs the unit tests; `tools/test-setup-wizard.cjs` (with `tools/mock-ha.mjs`)
and `tools/test-setup-noha.cjs` drive the setup wizard end to end with Playwright.
Never put anything from your own house in an issue or PR - the pre-commit hook checks for that.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

HouseOS is licensed under the [GNU AGPL-3.0](LICENSE). HouseOS Pro features are unlocked by a
commercial license key.
