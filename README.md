# HouseOS

**One screen for your whole house - with or without Home Assistant.**

HouseOS is a self-hosted home dashboard built for a wall-mounted tablet (and your phone). Weather,
a family calendar, your teams' scores, headlines, photos, the internet, lights and plugs, cameras,
sensors and power use - on a Home screen you arrange yourself. With Pro, your house as a live 3D
model from an iPhone LiDAR scan, and an assistant you can ask anything about your home.

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

## Get a HouseOS Box

Rather not set anything up? Order a **HouseOS Box** - a Raspberry Pi 5 with HouseOS installed, a year
of Pro included. Plug it into your router and open it on any screen. **[gethouseos.com/box](https://gethouseos.com/box)**

## Install it for real

| Runs on | How |
| --- | --- |
| Raspberry Pi 4/5, Debian, Ubuntu | `sudo ./deploy/install.sh` - a service that starts at boot |
| NAS or any Docker host (amd64/arm64) | `cd deploy && docker compose up -d` |
| Windows 10/11 | `deploy\install.ps1` in PowerShell as Administrator |
| macOS / anything with Node 20+ | `cd app && npm install && npm start` |

Then open `http://<that machine>:8090`. Hardware advice and wall-screen picks: [docs/HARDWARE.md](docs/HARDWARE.md).

## Make it yours

- **Drag, resize, add and remove tiles** on the Home screen (Edit layout). Tiles show more as they
  grow: a small weather tile is the temperature; a big one adds the hours and the week.
- **14 widgets**: clock, weather, calendar, scores, headlines, internet, today, alerts, energy,
  quick switches, pinned devices (any devices or Home Assistant entities you pick), cameras, photo reel, 3D Home.
- **Panel mode** for wall tablets (`http://<box>:8090/?panel=1`): a status bar across the top with
  the time, weather, alerts and everything HouseOS is connected to - green, yellow or red - plus
  the Ask the house bar. Keeps the screen on.
- **Light or dark**, color schemes or your own colors, and the **menu on any side** of the screen.
- **Rename anything** - menu items, tiles, devices, the house - and hide what you don't use.
- **A family calendar built in** (no Google account needed) and a **photo reel** you upload to from
  any phone or computer. Everything stays on your box.

## Setup asks the questions for you

The first time you open HouseOS, a setup wizard walks through:

1. **Your home** - name, time zone, units, and your town for the weather (rounded position only)
2. **Your login** - password, a PIN for risky actions, and a Pro key if you have one
3. **Calendars** - the built-in HouseOS calendar, plus Google / iCloud / Outlook links if you use them
4. **Your teams** - NFL, NBA, MLB, NHL, MLS, college, Premier League and more
5. **Headlines** - AP, NPR, BBC, tech, sports, or any RSS feed
6. **Reminders** - trash night, meds, feed the fish
7. **Home Assistant** - optional. If you have it, HouseOS adds integrations *inside* Home Assistant
   for you (Home Assistant asks its own questions; HouseOS shows them)
8. **Cameras, lights, sensors** - each brand says whether it needs Home Assistant
9. **Network, energy, alerts** - your power company's real usage needs Home Assistant; without it,
   HouseOS uses your smart plugs and your price per kWh

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

With Home Assistant connected, **everything in it shows up in HouseOS** - lights, switches, fans, blinds and
covers, media, thermostats, locks, cameras, scenes, scripts, buttons, vacuums, alarms, people, and every sensor -
searchable in Controls and pinnable to any Home screen tile ("Pinned devices"). That brings Z-Wave, Zigbee,
Matter, Nest, your power company's real usage (Opower) and thousands more. Unlocking doors, opening garage
doors and disarming alarms stay in Home Assistant. The full list, including what
we decided *not* to support and why: [docs/SUPPORT-MATRIX.md](docs/SUPPORT-MATRIX.md).

## Free and Pro

**Free** is open source (AGPL-3.0) and everything above - the whole dashboard, for good.

**Pro** - $5/month, $49/year or $129 once, with a 14-day trial on every new install:

| Pro, available now | Pro, coming (included when it ships) |
| --- | --- |
| **3D Home** - your home as a live 3D plan (LiDAR scan, or draw it in the app) | **Away from home** - secure remote access, no port forwarding |
| **Ask the house** - plain-English answers about your home, tap-to-do actions (AI usage billed by your AI provider, or free with Ollama) | **Phone alerts** - push notifications with quiet hours |
| **Ring** doorbells and cameras (Labs) | **iPhone, iPad and Android apps** |
| | Smart alerts, energy insights, self-healing, 2-year history, multi-home, backups |

Full comparison: [docs/EDITIONS.md](docs/EDITIONS.md). Where phones, tablets and the cloud fit in:
[docs/ROADMAP.md](docs/ROADMAP.md).

### 3D Home (Pro)

Two ways to get your floors in - mix and match per floor:

- **Draw them, on any device.** In **3D Home > Floors > Draw a floor**, drag to draw each room on a 1 m
  grid and add walls. Have a floor-plan picture (from the listing, the builder, or a photo of a paper
  plan)? **Trace a picture**: set how wide it is in meters and draw over it. HouseOS raises the walls
  into 3D.
- **Scan them with LiDAR** for the most realistic result. This needs an iPhone or iPad **with a LiDAR
  sensor** - iPhone 12 Pro and newer *Pro* models, iPad Pro 2020 and newer - and a free scanning app
  Free RoomPlan apps such as KIRI Engine (Room Scan) export **USDZ**, which HouseOS reads directly; GLB, GLTF, OBJ or a .zip also work (Polycam, Scaniverse and 3D Scanner App may need a paid plan to export). Upload it under **Floors**.

Line the floors up, then **Place devices**:
pick a light, plug, speaker, camera or sensor and click where it is. Lights glow when on, speakers
pulse when music plays, leaks and open doors flash, the top bar shows total watts - and tapping a
pin switches it or opens the camera. The step-by-step guide is built into the page ("How to scan").

### Ask the house (Pro)

"Which lights are on?" "What's using the most power?" "Did the Niners win?" Answers come from what
HouseOS knows right now; when you ask it to switch something it shows a button you tap to confirm.
Bring your own AI - **Claude**, **OpenAI**, any OpenAI-compatible server - or **Ollama** on your
own network so nothing leaves the house. It never unlocks doors or opens garage doors.

> **AI costs are separate from Pro.** If you connect Claude (Anthropic) or ChatGPT (OpenAI), you use
> your own API key and **they bill you directly** for what you use - usually a fraction of a cent per
> question, a few dollars a month for heavy use. A ChatGPT Plus or Claude Pro *subscription* does not
> cover API use; you need an API key from console.anthropic.com or platform.openai.com. **Ollama is
> free** - it runs on a computer at home - and private.

## Support and services

- **Community** (free): the HouseOS Discord - **[gethouseos.com/discord](https://gethouseos.com/discord)** - and GitHub issues
- **Basic support** (included with Pro): e-mail and Discord support from the HouseOS team
- **Service & Developer Access** ($100/year, includes Pro): a direct line to a HouseOS developer for
  custom features and hands-on help deploying HouseOS in your home
- **Home network planning**: a one-on-one consultation to scope your network, Wi-Fi, cameras and
  sensors, with a written plan

Details: [docs/SUPPORT.md](docs/SUPPORT.md).

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
