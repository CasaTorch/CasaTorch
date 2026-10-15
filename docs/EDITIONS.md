# CasaTorch Free and Pro

**Free is a complete home dashboard, for good.** Pro adds the showpiece features and, as they
ship, the things that cost money to run (remote access, phone alerts, cloud backups).

**Pro: $5/month or $49/year.** Every new install gets a
**14-day Pro trial** - no card, nothing to cancel. A Pro key is checked on your box, offline;
CasaTorch never phones home to check it.

## What's in each

✓ = included · **Now** = in the current release · **Coming** = on the roadmap (Pro buyers get it when it ships, no extra cost)

| | Free | Pro | |
| --- | :---: | :---: | --- |
| **The dashboard** | | | |
| Home screen of widgets you drag, resize, add and remove - tiles show more as they grow | ✓ | ✓ | Now |
| 14 widgets: clock, weather, calendar, scores, headlines, internet, today, alerts, energy, quick switches, pinned devices (add as many as you like), cameras, photo reel, 3D Home* | ✓ | ✓ | Now |
| Panel mode for wall tablets: status bar of everything connected, keeps the screen on, full screen | ✓ | ✓ | Now |
| Light and dark mode, color schemes and custom colors, menu on any side of the screen | ✓ | ✓ | Now |
| Rename anything: menu items, tiles, devices, the house; hide what you don't use | ✓ | ✓ | Now |
| Unlimited screens at home; sign-in with a password, PIN for risky actions | ✓ | ✓ | Now |
| **Your day** | | | |
| Weather, family calendar (built in - no Google needed - plus Google/iCloud/Outlook links), sports scores, news, reminders | ✓ | ✓ | Now |
| Photo reel: upload photos from any phone or computer, slideshow on the wall | ✓ | ✓ | Now |
| **Your home** | | | |
| Setup that asks the questions and connects everything for you | ✓ | ✓ | Now |
| Without Home Assistant: Hue, Shelly, YoLink, Frigate, Reolink, any snapshot camera | ✓ | ✓ | Now |
| With Home Assistant: everything in it - lights, fans, covers, media, climate, locks, cameras, scenes, scripts, vacuums, alarms, people, every sensor - searchable and pinnable to tiles | ✓ | ✓ | Now |
| Controls, cameras, sensors, energy (watts and cost per device), network and speed tests | ✓ | ✓ | Now |
| Alerts on the dashboard: leaks, smoke, low batteries, devices offline, internet down | ✓ | ✓ | Now |
| **Pro** | | | |
| **3D Home** - your home as a live 3D plan: **draw your floors in the app** (any device, or trace a floor-plan picture) or **upload a LiDAR scan** (iPhone 12 Pro or newer Pro, iPad Pro 2020 or newer); pin devices where they are; lights glow, music pulses, leaks flash; tap to switch | | ✓ | Now |
| **Ask the house** - plain-English questions about your home; suggests actions you tap to do; in the panel-mode status bar too. Bring your own AI (Claude, OpenAI - **billed to you by them**) or run it free and privately with Ollama | | ✓ | Now |
| **Ring** doorbells and cameras without Home Assistant (Labs - unofficial API) | | ✓ | Now |
| **Away from home** - secure remote access from your phone, no port forwarding | | ✓ | Coming |
| **Phone alerts** - push notifications for leaks, doorbell, alarms, with quiet hours | | ✓ | Coming |
| **CasaTorch apps** for iPhone, iPad and Android (App Store / Play Store) | | ✓ | Coming |
| **Smart alerts** - doorbell and motion only when nobody's home; critical alerts repeat every 10 minutes until acknowledged | | ✓ | Now |
| Fewer false alarms: an alert must still be there a minute later (water and smoke go out at once) | ✓ | ✓ | Now |
| **Weekly report** - every Monday: energy and cost vs the week before, always-on load, top devices, alerts, internet and server downtime, tips (written by your AI if connected, otherwise by rules); phone alert | | ✓ | Now |
| Bill forecast for the month | | ✓ | Now |
| **Self-healing** - restarts stuck integrations and tells you what it fixed | | ✓ | Coming |
| Energy history (by day and by device) | 7 days | 2 years | Now |
| Multiple homes (cabin, parents' house) in one app | | ✓ | Coming |
| Extra wall-panel layouts and theme packs | | ✓ | Coming |
| Encrypted backup and restore (settings, sign-ins, floor plans, history, photos) | ✓ | ✓ | Now |
| Network monitoring: UniFi and Cisco Meraki (every device online/offline, connected clients), Pi-hole and AdGuard Home (queries, blocked, protection on/off), alerts when a device drops off - free keeps internet status and speed tests | | ✓ | Now |
| Wi-Fi health and per-client detail for UniFi and Meraki | | ✓ | Coming |
| Server monitor: NAS, servers and self-hosted apps - up or down, response time, 24-hour uptime, certificate expiry, alerts | | ✓ | Now |
| Server monitor: storage and temperatures (needs an agent on the server) | | ✓ | Coming |
| E-mail help | ✓ | ✓ | Now |

\* The 3D Home tile needs Pro. 3D Home works with no special hardware if you draw your floors; LiDAR scanning needs an iPhone 12 Pro or newer *Pro* model, or an iPad Pro (2020 or newer).

## Why it's split this way

Everything you need to run your house from a wall screen is free and open source (AGPL-3.0).
Pro pays for what costs money to run - the remote-access relay, push notifications, backups -
and for the features that took the most work: the 3D Home, Ask the house and Ring.

## Using AI with Ask the house

**What it costs:** CasaTorch Pro unlocks Ask the house, but **the AI itself is not included**. You connect
your own AI and pay that company for what you use:

| AI | Cost | Privacy |
| --- | --- | --- |
| **Claude** (Anthropic API key) | Billed to you by Anthropic, per question - usually a fraction of a cent | Your question + a home snapshot go to Anthropic |
| **ChatGPT** (OpenAI API key) | Billed to you by OpenAI, per question - usually a fraction of a cent | Your question + a home snapshot go to OpenAI |
| **Ollama** (on a computer at home) | Free | Nothing leaves your network |

A ChatGPT Plus or Claude Pro *subscription* does not include API use - you need an API key from
platform.openai.com or console.anthropic.com, with billing set up there. Both let you set a monthly
spending limit.


Ask the house sends a snapshot of your home (device names and states, the calendar, weather) to
the AI you choose, only when you ask a question. Choose **Ollama** and it never leaves your
network. CasaTorch only suggests actions - you tap to do them - and it never unlocks doors or opens
garage doors.
