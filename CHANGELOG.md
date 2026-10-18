# Changelog

What changed in each CasaTorch version. The illustrated version, with links into the app, is
[What's new](https://casatorch.com/docs/help/whats-new.html); after an update CasaTorch also shows a short
"What's new" sheet (find it again in Settings › Help). Items marked **Coming** are not available yet.

## 0.8.0 - unreleased

The biggest update yet: draw your whole home, inside and out, and watch it live in 3D; Household and a Family hub;
a rain radar; App tests hop by hop - and a release built for trust: attack- and failure-tested on every change,
complete backups, updates that roll back by themselves, and help when you're stuck.

**Editions.** Household, the Family hub, the rain radar, App tests for the built-in apps, "Show only when..." and your
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

### Household, Family hub, rain radar (Basic)
- **Household**: bin day from a schedule, Home Assistant waste sensors or a city calendar (holidays skip or move
  a pickup), "Take out the recycling tonight" on every screen; mail, thirsty plants, washer/dryer/dishwasher
  countdowns; the Household widget. Reminders on phones are Pro.
- **Family hub**: shared lists (two-way with Home Assistant to-do lists), chores with stars, goals and rewards,
  kids' routines, a weekly meal plan; "Show only when..." widgets; your own weather station replaces "now".
- **Rain radar** widget: the last couple of hours of rain, looped, with "Rain likely in about 15 min".

### Network
- **App tests, hop by hop**: picked for you in setup; each hop's network, round trip and loss, a 7-day history
  marking route changes, and the likely culprit. Basic: built-in apps, up to 8 tests; Pro: your own sites, up to
  30, with alerts.
- Public address and provider now come from Cloudflare's trace page and RIPEstat (no token needed), replacing
  ipinfo.io's legacy API.

### Security
- A penetration test (30+ attack checks against every route) runs on every change, with the unit and security tests.
- A brand-new box answers almost nothing until setup is finished, closing a way someone on the same network could
  set up a new box first; the setup code is never in the in-app log.
- Every redirect is checked when CasaTorch fetches for you; cloud metadata addresses are always refused; member
  calendar links must be on the internet.
- Rate limits for setup codes, "Allow this device" requests and widget lookups; password checks no longer pause
  live updates. Owner reset limits per device; the insider cookie is host-only.
- **Signed installers**: install.sh, install.ps1 and the Home Assistant add-on install the newest release (never
  `main`) and check every file against the release's signed file list before anything runs. The add-on no longer
  runs as root.
- Phone push relay bound to the box's own key. Privacy Notice retention table; Terms updated October 17, 2026
  (accepted once, with one tap, at the next sign-in).

### Reliability
- **Backups carry everything** (Family hub, Household, reminders and photos, App tests, replay, layouts, the secure
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
- **Security hardening**: the master key is never overwritten, owner-only data files re-checked hourly, masked logs,
  HMAC alert tags, Cross-Origin-Opener-Policy, and the Security and encryption page.
- CasaTorch announces itself on the home network (Bonjour) for the phone apps (**Coming**); phone apps hardened
  (iPad, offline, back button, https first).

## 0.7.0

Setup language and location, the phone step with a pairing QR code, the Home AI Agent step, keys entered inline,
Frigate's secure port, camera duplicates and detections, Home Assistant energy, Reminders, headlines, optional
two-step sign-in for the app, and 7 more languages.

## Earlier versions

See the [releases page](https://github.com/casatorch/casatorch/releases).
