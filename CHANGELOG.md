# Changelog

What changed in each CasaTorch version. The illustrated version, with links into the app, is
[What's new](https://casatorch.com/docs/help/whats-new.html); after an update CasaTorch also shows a short
"What's new" sheet (find it again in Settings › Help). Items marked **Coming** are not available yet.

## 0.9.0

Every page is now yours to arrange - tap any tile for the whole story - plus a full Network dashboard, a rich Energy
dashboard, a Home AI Agent that shows its work, voice assistants, themes and backgrounds, and your CasaTorch from
anywhere with Secure access. Items marked **Coming** are not available yet.

**Editions.** Modular pages, drawers, the Energy dashboard, themes and backgrounds, tunable alerts, the Household page
and the Family board are in Basic. The Network dashboard (with a Cisco Meraki or UniFi connection), the Home AI Agent,
voice assistants and Secure access from anywhere are Pro (and in the 14-day trial). Safety is never Pro.

### Every page, your way
- **Modular pages**: Home, Alerts, Controls, Cameras, Security, Energy, Network, Reminders, Household and the Family
  board are all tiles you add, remove, drag and resize. Until you arrange a page, CasaTorch builds it from what your
  home has (solar gets a power-flow tile, Frigate gets Detections, each room gets its own tile) and offers new tiles
  in one tap when new devices arrive. Layouts for everyone, for phones, tablets or computers, just for you, or for
  one screen.
- **Tiles that grow**: a small tile shows the key number; bigger ones add a sparkline, a chart, then a table.
- **Tap any tile for more**: a drawer slides in with everything behind it - the weather's 48 hours and 10 days,
  your teams' standings, line scores and schedules, a stock's chart, the week's agenda, cameras live with what they
  saw, and every device with its controls and its last 24 hours. Drawers have their own address, so Back closes
  them and a link opens one.
- **Themes and backgrounds**: pick a theme and a background - gradients, the weather at home (day and night),
  the seasons, team colors, or your own photo (cleaned of location and other hidden data before it's saved). Each
  screen can have its own. Asked early in setup; changed any time in Settings › Look & main bar.
- **Docs one tap away**: a "?" on every page and Settings section, and "Learn more" on every setup step.

### Network dashboard (Pro)
- With a **Cisco Meraki** API key or **UniFi**: a live network map from the internet down to every switch, access
  point and camera, uplinks and cellular backup, Wi-Fi by network and band, top clients, switch ports with PoE and
  errors, events, firmware and license, new devices, your DNS filter, servers and apps - all tiles you can arrange.
- App and network tests on the same page, with the hop-by-hop path for each.

### Energy dashboard
- Power flow between the grid, solar, a home battery, the house and the car; what's on now and its cost; today,
  7 and 30 days; day by day; top consumers; sources hour by hour; an hour-of-day heat map; by room; this week vs
  last; peak hours; carbon; standby waste with what it costs a year; a tile for each metered device. Built from the
  meters your home has - nothing made up - and arranged like every other page. Bill forecast and 2 years of
  history stay Pro.

### Home AI Agent (Pro)
- **Looks things up for itself**: Home Assistant, every CasaTorch page, the weather, scores, headlines and - if you
  turn it on - the web. It reads only what the person asking may see.
- **Shows its work**: answers come with charts, tables and headline numbers, name their sources, and end with a
  next step you can tap. It still never unlocks, opens or disarms.
- **You choose what it sees**: cameras, location, the calendar and the family can each be kept from the AI.

### Voice assistants (Pro)
- **Alexa, Google Home, Apple Home and SmartThings** through Matter: add CasaTorch once in your assistant's app and
  your lights, plugs, fans, blinds, thermostats, sensors and scenes show up there, in step both ways. Locks, garage
  doors, gates and alarms are never shared. (Google Home asks for a one-time developer-console step for devices like
  this one; the docs walk you through it.)
- **"Hey Siri, Ask CasaTorch"**: ask your Home AI Agent by voice and hear a short answer, with an Apple Shortcut and
  a key for each phone that opens nothing else. Asking through Alexa is **Coming**.

### Alerts, your way
- **Settings › Alerts**: for each kind of alert - in the app, on phones, the sound, how often it repeats, quiet
  hours and a daily summary - for the household or just your phones, and per room or per device. Mute a device for
  a while from its alert.
- Reminders and Household pushes follow the same rules. Water, smoke, gas, carbon monoxide and freezing alerts
  always break through, and turning one off asks first.

### Your home from anywhere
- **Secure access is available**: with Pro, your CasaTorch works from anywhere through an encrypted address, with
  no port forwarding. On Basic, the secure address works on your home Wi-Fi.
- **iPhone alerts straight through Apple**: the iPhone and iPad app now gets alerts through Apple's own push service,
  with no Google service in between - still encrypted on your CasaTorch for that one phone. The CasaTorch apps are **Coming** to the App Store and Google Play.
- **Pages never go blank**: switching between Wi-Fi and cellular, or coming back to a tab, keeps the last data on
  screen while CasaTorch reconnects, with time limits and a retry behind every request. The app asks which home to
  open when a phone is signed in to more than one.

### Cameras
- **Live video, really live**: low-latency video from Frigate and Home Assistant cameras, in browsers and the phone
  apps, with sharp tiles and the full-quality stream when you open one.
- **Each camera once**: Cameras and Security show every camera one time, even when it's reached both directly and
  through Home Assistant; the others wait under Detected cameras, ready to add back.

### Setup
- **Make it yours** early on: the look of your CasaTorch, previewed live.
- **Two-step sign-in**, offered right after your login and strongly recommended, with recovery codes; the
  CasaTorch app adds Face ID, Touch ID or fingerprint.
- **Already in Home Assistant?** Setup explains what connecting Frigate or a Meraki key directly adds (live video,
  detections, the full network map) and what you can skip.
- **Change your setup** in Settings › General: every setup step can be opened again later.
- **App tests** show the path to each app as a graph, hop by hop, with the likely culprit.

### Household and Family board
- **Household** has its own page: bins, the mail, plants and laundry as tiles.
- The Family hub is now the **Family board**: same lists, chores, routines and meals, now as tiles too.

### Security, reliability and clean-ups
- **Passwords and keys are encrypted in your browser** before they're sent to your CasaTorch, on top of the
  encrypted connection - and stay encrypted on the box, as before.
- A person whose role is lowered to viewer can no longer switch things by voice; more of the app is covered by the
  automated attack tests.
- Faster main bar and Network page; fixes for phones, tablets and German text across the app.
- Public sources, plainly: CasaTorch names itself to scores, quotes and feeds, and a source that refuses shows "not
  available right now". Teams show as their abbreviation in team colors (logos are an opt-in switch). The AP News
  preset is gone; Wikipedia excerpts in the Home AI Agent are labeled with their license.
- Fresh screenshots, docs videos and tour film, and new store screenshots for the CasaTorch apps.

## 0.8.1

- **Who is it?** Security Center names each device by its maker (from the first half of its network address) and
  the names your network already knows, guesses its type, and explains each open service for that kind of device.
  A receiver's control port is shown as normal information instead of a warning; real risks stay red.
- CI tests on Node 22 and 24 (Node 20 is end of life).
- Fresh screenshots and videos everywhere.

## 0.8.0

The biggest update yet: draw your whole home, inside and out, and watch it live in 3D; Household and a Family hub (now Family board);
a rain radar; App tests hop by hop - and a release built for trust: attack- and failure-tested on every change,
complete backups, updates that roll back by themselves, and help when you're stuck.

**Editions.** Household, the Family board, the rain radar, App tests for the built-in apps, "Show only when..." and your
own weather station are in Basic. Everything in the 3D home is Pro (and in the 14-day trial). Safety is never Pro:
water and smoke alerts (gas and carbon monoxide count as smoke) repeat until someone taps Got it on Basic too.

### 3D home (Pro)
- **Drawing editor**: walls by length and angle with 45°/90° snapping, rooms of any shape sharing walls, doors and
  windows placed by their distance from the wall's edge (double, sliding, bifold, garage, roof windows), gaps and
  overlaps marked with a Fix button, stairs (straight, L, U, spiral) and roofs (flat, gable, hip). Saves as you go;
  undo and redo everything.
- **One editor with tabs** in build order (Floors, Rooms, Furniture, Outdoor, Devices, Network, Colors) and
  "What can I add?" search. Rooms from Home Assistant areas in one tap. Trace a robot-vacuum map or a plan picture;
  import Sweet Home 3D and DXF with a preview.
- **Outside and furnished**: lawn, terrace, paths, sloped driveways, beds, gravel and pools with depth; fences,
  hedges, awnings, strip lights; 29 pieces of furniture and "Furnish a room".
- **Live**: doors, windows, garage doors, blinds and curtains move as they do; heating and cooling glows, fans,
  TV pictures, alarms; camera views that turn red on motion; sunlight through skylights; solar, battery, car
  charging, the robot vacuum, a heat map and an optional pet that follows open doors.
- **Replay** the last 24 hours, 3 or 7 days (lights, doors, motion, power - never people or trackers). Eye-level
  walk-through and saved views. Network devices on the plan with a Wi-Fi coverage estimate. Voice: "Show me the
  kitchen".
- **Photo-real scans and imports** (GLB, glTF, USDZ, OBJ, PLY), lined up automatically with a lighter copy for wall
  tablets; compressed scans supported. LiDAR scanning in the CasaTorch app is **Coming**.
- **Plan backups**: automatic restore points (scans included), download, template without devices, upload to
  restore or move. A damaged plan comes back from its newest restore point.
- **Wall-tablet modes**: quality levels, frame-rate readout, night dimming, photo screensaver, status chips. About
  half the draw calls, rests when nothing moves, shader warm-up for a smoother first picture; old browsers get a
  clear card instead of a blank page.

### Household, Family board, rain radar (Basic)
- **Household**: bin day from a schedule, Home Assistant waste sensors or a city calendar (holidays skip or move
  a pickup), "Take out the recycling tonight" on every screen; mail, thirsty plants, washer/dryer/dishwasher
  countdowns; the Household widget. Reminders on phones are Pro.
- **Family board**: shared lists (two-way with Home Assistant to-do lists), chores with stars, goals and rewards,
  kids' routines, a weekly meal plan; "Show only when..." widgets; your own weather station replaces "now".
- **Rain radar** widget: the last couple of hours of rain, looped, with "Rain likely in about 15 min".

### Network
- **App tests, hop by hop**: picked for you in setup; each hop's network, round trip and loss, a 7-day history
  marking route changes, and the likely culprit. Basic: built-in apps, up to 8 tests; Pro: your own sites, up to
  30, with alerts.
- Public address and provider now come from Cloudflare's trace page and RIPEstat (no token needed), replacing
  ipinfo.io's legacy API.

### Security
- Automated security and attack testing runs on every change, with the unit tests.
- A brand-new box can only be set up by its owner.
- Safer handling of links and addresses CasaTorch fetches for you.
- Stronger protection against password guessing; password checks no longer pause live updates.
- **Signed installers**: install.sh, install.ps1 and the Home Assistant add-on install the newest release (never
  `main`) and check every file against the release's signed file list before anything runs. The add-on no longer
  runs as root.
- Phone push relay bound to the box's own key. Privacy Notice retention table; Terms updated October 17, 2026
  (accepted once, with one tap, at the next sign-in).

### Reliability
- **Backups carry everything** (Family board, Household, reminders and photos, App tests, replay, layouts, the secure
  address at home and the box's identity), encrypted with AES-256-GCM.
- **Updates roll back by themselves** on a Box, Raspberry Pi and Linux if the new version doesn't answer within 5
  minutes; Settings › Updates & backup shows what's new, progress and how it went.
- A Home Assistant connection that goes silent is dropped and reconnected within about 90 seconds.
- Damaged data files are set aside (never overwritten) and the last complete save used; Health says which.
- About 80% fewer writes a day (memory-card wear), about 3× faster start and a third less memory.
- A failure suite (Home Assistant down/silent/slow/flapping, every file damaged, a full disk) runs on every change.

### Help when you need it
- 10 guided troubleshooters in Settings › Health › Get help that run real checks; "Send me a test alert".
- A **support file** you read in full before sharing, with passwords, names, e-mail, IP and MAC addresses masked;
  "Copy summary" for an e-mail or forum post.
- "I'm locked out" for the owner: a one-time code shown on the box itself, home network only, 30 minutes, and
  everyone sees it was used.
- Activity log (who signed in, what changed - names, never values), Getting started checklist on Home, and the
  What's new sheet.

### Also
- More of the app translated (settings, sign-in, setup messages, dates and times) in all 14 languages;
  accessibility labels and announcements; compressed API data.
- Open-source licenses in Settings › Help › About CasaTorch, and THIRD_PARTY_NOTICES.md.
- Phone apps (0.8.0, build 800): store texts, screenshots and icons ready - the apps are **Coming** to the App Store
  and Google Play.
- Secure access self-test and repair is **Coming** with Secure access (away from home).

## 0.7.1

A polish release.

- **Setup that takes care of you**: picks up where you left off ("Welcome back"), errors in plain English with How
  to fix, addresses tidied for you, Home Assistant, Hue, Shelly and Frigate found on your network, and a 26-second
  film of the demo house on the Welcome page.
- **Settings › Health**: 15 checks, each green, amber or red, with Fix it where CasaTorch can fix it; automatic
  retry and one combined alert; settings history with one-tap restore; self-repair of damaged settings and sign-in
  files, crash-loop rollback and a watchdog.
- **Security hardening** across storage, logs, alerts and the browser, and a new Security and encryption page.
- CasaTorch announces itself on the home network (Bonjour) for the phone apps (**Coming**); phone apps hardened
  (iPad, offline, back button, https first).

## 0.7.0

Setup language and location, the phone step with a pairing QR code, the Home AI Agent step, keys entered inline,
Frigate's secure port, camera duplicates and detections, Home Assistant energy, Reminders, headlines, optional
two-step sign-in for the app, and 7 more languages.

## Earlier versions

See the [releases page](https://github.com/casatorch/casatorch/releases).
