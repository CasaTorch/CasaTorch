# Changelog

What changed in each CasaTorch version. The illustrated version, with links into the app, is
[What's new](https://casatorch.com/docs/help/whats-new.html); after an update CasaTorch also shows a short
"What's new" sheet (find it again in Settings › Help). Items marked **Coming** are not available yet.

## Unreleased

### Security
- **Secure access only opens on approved devices.** Requests to your home's secure address are now checked by
  Cloudflare before they reach your CasaTorch: only your paired phones (the CasaTorch app) and browsers you approve get
  through. Everyone else sees a plain "This home only opens on approved devices" page and never reaches your CasaTorch,
  not even its sign-in. Approve a browser at home (Settings › Devices & sessions › Approve this browser), or from the
  app by scanning the code the browser shows. New secure addresses have it from the start; an existing one gets it when
  CasaTorch updates (phones that are already signed in keep working while they pick up their passes). Health shows
  whether it's on. Everything CasaTorch already checked (sign-in, two-step sign-in, limits, Basic only at home) stays.
- **Sign-in alerts.** A new phone paired, a sign-in from a device you haven't used before, and every sign-in from
  away from home: an alert in the inbox and on your phones, saying who, which device, where (city or country) and
  when. Each person gets their own; the owner gets everyone's.
- **Devices & sessions** (Settings): every phone and browser signed in, with where and when it was last used, and the
  browsers approved for away from home. Sign one out, sign out everywhere else, or remove a phone, which also ends its
  access from away at once. The owner sees everyone's; others see their own.
- **Lock remote access.** One switch for the owner refuses everything from outside right away, until it's unlocked at
  home or from the CasaTorch app (with Face ID or your fingerprint).
- **Allowed countries** (optional): answer from away only in the countries you pick.
- **Signed container image.** The CasaTorch image is signed (Sigstore cosign) and published with its build provenance
  and a software bill of materials; each release's notes say how to check it. The compose file from
  casatorch.com/download names the release's image exactly, so it runs only the image that was published.
- **Locked-down container and services.** The Docker image runs as CasaTorch's own unprivileged user on a read-only
  system, with no setuid programs and no package manager inside, and its base image pinned exactly. The compose files
  and the Unraid template drop every extra right and set memory and process limits. The Linux service runs in a
  tighter sandbox (only ordinary system calls, no devices, other processes hidden), and the Home Assistant add-on asks
  for nothing beyond the Home Assistant API. If a NAS made the settings folder for another user, the container says
  how to fix it.
- **Pinned 3D engine files.** The 3D home's engine (three.js) is pinned file by file: CasaTorch sends a browser only
  the files it was built with, unchanged, and the browser checks them too.
- **Your secret key in the system's key store.** The key that seals every saved password and token is now kept with
  the system's own key store where there is one - the macOS Keychain, Windows data protection, systemd credentials
  (with the computer's TPM2 chip when it has one) on Linux and the Raspberry Pi, or a Docker secret - so a copy of the
  data folder alone opens nothing. Existing installs move over by themselves; without a key store nothing changes.
  CasaTorch never locks you out: if the key store doesn't open the key, CasaTorch keeps running, says so in Health and
  puts the key back once the key store works again. Backups still restore on any computer.
- **A new secret key on request.** Settings › Health › Secret key › Make a new secret key (owner, with your password):
  CasaTorch restarts and seals everything again with the new key. Nothing needs entering again.
- **Stricter browser protections.** CasaTorch's pages now run with no inline scripts or styles at all, Trusted Types
  (a piece of text can never turn into a script on the page), full isolation from other sites' windows and pages, no
  referrer sent anywhere, only the browser features it uses, and a year of HTTPS-only once you use the secure address.
- **A tamper-evident activity log.** Every event in the activity log is sealed to the one before it, so an event
  changed, removed or slipped in by anything other than CasaTorch shows up in Health. The JSON download is signed, so
  anyone can check later that it wasn't edited.
- **Security score** (Settings › Health): which protections are on - sign-in, two-step sign-in, the secure address,
  the key store, updates, backups, access from away, the activity log and CasaTorch's own files - each with a button to
  turn it on.
- Secure access: a CasaTorch restored on new hardware no longer lets devices that were signed out of away access back in.
- A new secret key can no longer lose a saved value when a file can't be written during the change: the old key stays.
- Activity log: an event removed from just before a restart of CasaTorch now shows up in Health too.
- Releases: the container image is published and signed only for a version tag.
- Trusted Types: pieces of HTML that rebuild a script tag or a handler once one is taken out are cleaned completely.
- Linux updater: what it writes in the data folder (progress, the settings copy, a rollback) is written as CasaTorch's own user, never as root.

## 0.9.3

### Security
- **New secure-access tunnels have no rules on Cloudflare's side.** CasaTorch tells casatorch.com it writes its own
  tunnel rules, and casatorch.com then makes the tunnel "locally managed": there's nothing on Cloudflare's side that
  could point it anywhere else. casatorch.com also refuses every change to an existing tunnel's rules. Tunnels made
  before keep working; Repair moves one to the new kind (same address).
- **Only your CasaTorch can get certificates for its secure address at home.** CasaTorch sends its Let's Encrypt
  account with the request for its `lan-` name, and casatorch.com adds a CAA record that lets Let's Encrypt issue
  certificates for that name to that account only. Names made before get one at their next renewal.
- **Health warns about developer switches.** If CasaTorch is started with a setting meant only for building and
  testing it (such as `CASATORCH_PRO_DEV`, `CASATORCH_TEST` or `CASATORCH_ASK_FAKE`, or one that points it at another
  server), Health shows a red line naming it, and the activity log notes it at start. The demo is left alone.

### Cameras
- **Ring chimes without Home Assistant.** With CasaTorch's own Ring connection (Pro), your Ring Chime and Chime Pro now
  show up as chimes: whether each is online, its volume and whether it's snoozed. Tap one to change the volume or snooze
  it for 30 minutes to 24 hours. Like chimes from Home Assistant, they never count or show as cameras.
- **Timeline: everything at your doors and cameras in one list** (Cameras or Security › Timeline). Frigate's
  detections, doorbell presses, motion, the alarm and your locks (with who, when the lock or alarm says), and people and
  vehicles Cisco Meraki cameras count, grouped by day. Filter by kind, camera or person; tap an event to play
  Frigate's clip or see the picture taken right then. Basic shows the last 24 hours, Pro 30 days. Kept on your
  CasaTorch only, encrypted.

### Alerts
- **Your own inbox.** The bell at the top of every page counts what you haven't read and lists what happened, newest
  first: exactly the alerts your settings show you in the app (water, smoke and other safety alerts always). Tap one to
  go where it happened, mark one or all read, clear one or all. Everyone in the house has their own, kept on your
  CasaTorch and encrypted. What's sent to phones is still up to Settings › Alerts.

### Faster
- **The dashboard starts with less to load.** Network (with App tests) and Energy are now files of their own, fetched
  in the background and run only the first time you open them, so every other page starts with about a sixth less
  to download and run. They're kept like the rest of the app, so they open offline too, from the web app's saved copy.
  The 3D Home already loads only when you open it.

### Polish
- **Nothing fails quietly.** A tile that can't draw says so in its own place, with Try again, instead of a bare
  message; a page whose update fails says it's behind and how old what it shows is, with Try again, until the next
  update works.
- The new Timeline, Inbox and chime controls follow every theme (WCAG AA in all eight), add no motion of their own,
  and fit phones, iPads and wall panels with no sideways scrolling (checked on every page at 390, 820, 1024 and 1920
  pixels wide).

### Languages
- **Secure access speaks your language.** Every status, problem and fix in Settings › Secure access and its Health line
  is translated into all 13 languages, and so is the "You're away from home" page.

### Small things
- The activity log now names "Secure access was stopped to keep your home private" and shows it in red.

## 0.9.2

Security, privacy and cameras: what casatorch.com can and can't do with your CasaTorch is now enforced on the box, every
private key is encrypted, updates only ever go forward, and Ring cameras and chimes behave.

### Security
- **The secure-access tunnel reaches your CasaTorch and nothing else.** Its rules are written on the box (this
  CasaTorch only, private-network routing off), and rules sent from Cloudflare's side that point anywhere else - your
  router, Home Assistant, another computer, a proxy - or that turn on routing into your network stop secure access at
  once, with an alert and a line in the security log. Repair tries again.
- **Visitors through the tunnel stay outside.** A request that came through secure access is treated as one from away
  from home whatever address it claims, so the "Basic works only at home" and "sign-in required away" rules, and the
  home-only owner password reset, can't be got round.
- **Updates only go forward, and only when signed.** The Linux and Raspberry Pi updater installs nothing without its
  release key (it used to skip the check), and refuses a package that isn't the announced version or isn't newer. The
  install scripts refuse a 0.8+ release whose signed file list is missing.
- **The secure address's private keys are encrypted** on the box like every other secret (older ones are encrypted the
  first time they're read).
- **No install scripts**: no package runs its own scripts when installed, including on developers' computers and in CI.
- The Linux service runs with no special powers and with the kernel, clock and other system settings off limits.

### Backups
- **Every backup is checked before you download it**: opened again with its passphrase and read in full.
- **Check a backup file** (Settings › Updates & backup › Backup): tells you whether a file restores and what it holds,
  without changing anything.

### Activity
- **Export the activity log** as CSV or JSON (Settings › People & sign-in › Activity), for what the filters show. The
  CSV is safe to open in a spreadsheet: nothing in it runs as a formula.

### Cameras
- **Ring Chime and Chime Pro are chimes, not cameras**: they no longer count or show as cameras anywhere - camera
  counts, the Cameras and Security pages, camera walls, the 3D home and "New camera" notices.
- **Ring cameras play only through Frigate's go2rtc** when it has their stream (about a second behind), never through
  Home Assistant's video, which runs minutes behind.
- **Better matching to go2rtc streams**: names with or without "ring_", the "_2" Home Assistant adds when two devices
  share a name (each camera gets its own stream), and streams named after ring-mqtt's camera id.
- **Steadier live tiles**: a page redraw no longer restarts a live camera (no flash, no reconnect).

## 0.9.1

The first public release: the free download is open.

- **Scores work again.** ESPN's public scoreboard stopped answering requests that name an app, so the team list in
  setup came back empty. CasaTorch now asks ESPN the way a web browser does - only ESPN, and you can turn it off in
  **Settings › General › Scores**. Every other source still sees CasaTorch's own name.
- Test fix: the docs-link check knows about the Voice assistants page.

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
