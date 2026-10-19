# CasaTorch Basic and Pro

**Basic is a complete home dashboard, free for good.** Pro adds the showpiece features and, as they
ship, the things that cost money to run (remote access, cloud backups).

**Pro: $5/month or $49/year.** Every new install gets a **14-day Pro trial** - no card, nothing to
cancel. A Pro key is checked on your box, offline; CasaTorch never phones home to check it.

This table is the single source of truth for what is in each edition. It follows the code; the Settings › CasaTorch Pro
list, casatorch.com and the README follow this table.

✓ = included · **Now** = in the current release · **Coming** = on the roadmap (Pro buyers get it when it ships, no extra cost)

| | Basic | Pro | |
| --- | :---: | :---: | --- |
| **The dashboard** | | | |
| Every page made of tiles you drag, resize, add and remove (built for your home until you arrange it); tap any tile for more | ✓ | ✓ | Now |
| Themes and backgrounds (weather, seasons, team colors, your own photo), your own main bar | ✓ | ✓ | Now |
| Panel mode for wall tablets: status bar, keeps the screen on, full screen | ✓ | ✓ | Now |
| Rename anything; hide what you don't use; 14 languages | ✓ | ✓ | Now |
| Unlimited screens at home; sign-ins for the family with optional two-step codes; PIN for risky actions | ✓ | ✓ | Now |
| **Safety and security** | | | |
| Every alert - leaks, smoke, doors, low batteries, devices offline, internet down - on every screen and phone | ✓ | ✓ | Now |
| Alerts tuned your way: in the app, on phones, sound, repeats, quiet hours, daily summary, per room and per device | ✓ | ✓ | Now |
| Phone alerts: the web app on your home screen, the Home Assistant app, and the CasaTorch apps (coming) | ✓ | ✓ | Now |
| Fewer false alarms: an alert must still be there a minute later (water and smoke go out at once) | ✓ | ✓ | Now |
| Security Center: video wall, doors and locks with "Lock all", the alarm (arm only), new-device alerts, open-port check | ✓ | ✓ | Now |
| Secure address at home (https on your home network), on by default | ✓ | ✓ | Now |
| **Smart alerts**: doorbell and motion only when nobody's home; critical alerts repeat every 10 minutes until someone taps "Got it" (water and smoke repeat on Basic too: safety is never Pro) | | ✓ | Now |
| **Your day** | | | |
| Weather, family calendar (built in, plus Google/iCloud/Outlook links), sports scores, headlines | ✓ | ✓ | Now |
| Rain radar (RainViewer, or the US National Weather Service) and your own weather station | ✓ | ✓ | Now |
| Reminders on every screen, with icons, sounds or your photos | ✓ | ✓ | Now |
| Household: bin day, mail, thirsty plants, washer, dryer and dishwasher | ✓ | ✓ | Now |
| Family board: shared lists, chores and stars, kids' routines, meal plan | ✓ | ✓ | Now |
| Photo reel | ✓ | ✓ | Now |
| **Reminders on phones**: your reminders and Household reminders sent to everyone's phone, anywhere, even in quiet hours | | ✓ | Now |
| **Your home** | | | |
| Setup that asks the questions and connects everything for you | ✓ | ✓ | Now |
| Without Home Assistant: Hue, Shelly, YoLink, Frigate, Reolink, any snapshot camera | ✓ | ✓ | Now |
| With Home Assistant: everything in it, searchable and pinnable | ✓ | ✓ | Now |
| Energy dashboard: power flow, solar, battery and car, top consumers, heat map, standby waste; from plugs and Home Assistant's Energy dashboard | ✓ | ✓ | Now |
| Energy history by day and by device | 7 days shown | 2 years | Now |
| This month's electricity bill forecast | | ✓ | Now |
| Health: CasaTorch checks itself, repairs what it can and says what it fixed | ✓ | ✓ | Now |
| Encrypted backup and restore | ✓ | ✓ | Now |
| Internet status and speed tests | ✓ | ✓ | Now |
| App tests: the path hop by hop and the likely culprit | Built-in apps, up to 8, every 5 or 15 min | Plus your own websites, up to 30, every 1, 5 or 15 min, with alerts | Now |
| **Pro features** | | | |
| **3D Home**: draw or scan your floors, yard and furniture; live devices, power and sunlight; replay up to 7 days | View only* | ✓ | Now |
| **Home AI Agent** (your own Claude, OpenAI or Ollama - AI usage billed by them) | | ✓ | Now |
| **Ring** doorbells and cameras without Home Assistant (Labs - unofficial API) | | ✓ | Now |
| **Weekly report** every Monday, written by your AI if connected | | ✓ | Now |
| **Server monitor**: NAS, servers and self-hosted apps, certificates, alerts | | ✓ | Now |
| **Network monitoring**: UniFi, Cisco Meraki, Pi-hole, AdGuard Home, with alerts; with Meraki or UniFi, the full Network dashboard (map, Wi-Fi, ports, clients, events, firmware) | | ✓ | Now |
| **Cisco Meraki** MV camera pictures and MT sensor readings (through the Meraki network connection; MT water and temperature alerts keep working on Basic) | | ✓ | Now |
| **Voice assistants**: Alexa, Google Home, Apple Home and SmartThings through Matter (never locks, garage doors, gates or alarms); "Ask CasaTorch" with Siri | | ✓ | Now |
| Asking the Home AI Agent through Alexa | | ✓ | Coming |
| **Away from home**: secure remote access from your phone, no port forwarding | At home only | ✓ | Now |
| CasaTorch apps for iPhone, iPad and Android | ✓ | ✓ | Coming |
| Multiple homes in one app; extra panel layouts and theme packs; cloud backup | | ✓ | Coming |
| E-mail help | ✓ | ✓ | Now |

\* A 3D home made during the trial or a subscription stays on your box and can still be looked at;
drawing, editing and the 3D Home tab need Pro.

## When the trial or a subscription ends

- **Nothing is deleted.** Your 3D home, history, reports, monitors and settings stay on your box and
  come back as soon as a key is added.
- **Safety never stops.** Every alert keeps reaching every screen and phone; only the Pro extras
  (repeating critical alerts, "only when nobody's home") switch back to plain alerts.
- **Grace days.** A monthly or yearly key keeps Pro on for 14 days after its end date - 30 days if
  casatorch.com couldn't be reached to fetch the renewed key, so an outage on our side never switches
  anyone's Pro off.
- **Clear next step.** Pro screens say what Pro adds and link to Settings › CasaTorch Pro.

## How the license works

- A key is signed by CasaTorch (Ed25519) and checked on the box, offline. The private signing key
  is never in this repository.
- Monthly keys run to the end of the paid month plus 3 days. A yearly charge first gets a key for
  21 days (the 14-day refund window plus a week); after the window CasaTorch fetches the key for the
  rest of the paid year by itself. Renewals work the same way, automatically.
- One purchase covers one home, with room for a reinstall or a new box. Claiming the key on a new
  box ("Get my key by e-mail") moves it; a box that stops checking in frees its place after 90 days.
- Refunds and chargebacks stop the key being handed out or extended; a key already on a box runs to
  its own end date (at most a few weeks after a refund).
- The 14-day trial counts calendar days and running time, so setting the clock back doesn't stretch it.

## Why it's split this way

Everything you need to run your house from a wall screen - and every safety alert - is free and open
source (AGPL-3.0). Pro pays for what costs money to run - the remote-access relay, backups - and for
the features that took the most work: the 3D Home, Home AI Agent, Ring and the monitoring tools.

## Using AI with Home AI Agent

**What it costs:** CasaTorch Pro unlocks Home AI Agent, but **the AI itself is not included**. You connect
your own AI and pay that company for what you use:

| AI | Cost | Privacy |
| --- | --- | --- |
| **Claude** (Anthropic API key) | Billed to you by Anthropic, per question - usually a fraction of a cent | Your question + a home snapshot go to Anthropic |
| **ChatGPT** (OpenAI API key) | Billed to you by OpenAI, per question - usually a fraction of a cent | Your question + a home snapshot go to OpenAI |
| **Ollama** (on a computer at home) | Free | Nothing leaves your network |

A ChatGPT Plus or Claude Pro *subscription* does not include API use - you need an API key from
platform.openai.com or console.anthropic.com, with billing set up there. Both let you set a monthly
spending limit.

Home AI Agent sends a snapshot of your home (device names and states, the calendar, weather) to
the AI you choose, only when you ask a question. Choose **Ollama** and it never leaves your
network. CasaTorch only suggests actions - you tap to do them - and it never unlocks doors, opens
garage doors or disarms alarms.
