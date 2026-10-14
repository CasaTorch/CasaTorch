# HouseOS for Home Assistant users

HouseOS works with or without Home Assistant. If you have Home Assistant, there are two pieces and
you can use either or both:

| Piece | What it is | How you get it |
| --- | --- | --- |
| **HouseOS add-on** | HouseOS itself, running on your Home Assistant machine | Add-on store (Home Assistant OS / Supervised) |
| **HouseOS card** | Shows HouseOS (dashboard, wall panel, 3D home or Ask) inside a Home Assistant dashboard | HACS, as a **Dashboard** repository |

HouseOS is a full app (a web server with its own screens), not a Home Assistant integration, so the app
itself installs as an **add-on**; HACS installs the **card**.

## 1. Install the add-on (Home Assistant OS or Supervised)

[![Add the HouseOS add-on repository to your Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fgethouseos%2FHouseOS)

Or by hand: **Settings > Add-ons > Add-on store > ⋮ (top right) > Repositories**, add
`https://github.com/gethouseos/HouseOS`, close, refresh, then open **HouseOS** and press **Install**.

- First start builds HouseOS on your machine: 3-5 minutes on a Raspberry Pi. Follow it in **Log**.
- Turn on **Start on boot** and **Watchdog**, then **Open web UI** (`http://homeassistant.local:8090`).
- Home Assistant is already connected through the Supervisor - no token needed.
- Runs on 64-bit Raspberry Pi 4/5 (aarch64) and PCs/N100 boxes (amd64).

## 2. Install the card with HACS

[![Open the HouseOS card in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=gethouseos&repository=HouseOS&category=plugin)

Or by hand: **HACS > ⋮ > Custom repositories**, add `https://github.com/gethouseos/HouseOS` with
type **Dashboard**, then download **HouseOS card** and reload the browser.

Add it to any dashboard (Edit dashboard > Add card > search "HouseOS", or YAML):

```yaml
type: custom:houseos-card
url: http://homeassistant.local:8090   # where HouseOS runs
view: 3d                               # home | panel | 3d | ask
height: 600
title: Our house                       # optional
```

Prefer no HACS? Home Assistant's built-in **Webpage** card with the same URL works too, and
**Settings > Dashboards > Add dashboard > Webpage** puts HouseOS in the sidebar.

> **https note:** if you open Home Assistant over https (Nabu Casa, a reverse proxy), browsers block an
> http:// page inside it. Use Home Assistant on your home network, or give HouseOS an https address.

## 3. Home Assistant Container or Core (no add-on store)

Run HouseOS next to Home Assistant with Docker (`deploy/docker-compose.yml`) or Node, then in the
HouseOS setup enter your Home Assistant address and a long-lived access token
(Home Assistant > your profile > Security > Long-lived access tokens). The HACS card works the same.

## What HouseOS uses from Home Assistant

Everything: lights, switches, fans, covers, media players, climate, locks, cameras, scenes, scripts,
buttons, vacuums, alarms, people and every sensor. Safe things can be switched from HouseOS;
unlocking doors, opening garage doors/gates and disarming alarms stay in Home Assistant - and the AI
assistant never does any of them.

## 3D home

Scan your floors with any Apple RoomPlan app (LiDarPlan, KIRI Engine Room Scan, Lagarsoft) and upload
the GLB/USDZ, or draw them in HouseOS. Walls, furniture and rooms are recognised from the scan. Place
your Home Assistant devices on it in **3D > Editor**; lights glow where they are, and tapping a room
opens its controls.
