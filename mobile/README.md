# CasaTorch for iPhone, iPad and Android

*Your home, lit up - in your pocket.*

The phone apps are your own CasaTorch, fitted to the phone: the same dashboard, cameras, 3D home and settings, plus
what only a phone can do - Face ID or fingerprint lock, encrypted alerts, haptics, pairing by QR code and (on
iPhone Pro / iPad Pro) scanning rooms with LiDAR straight into the 3D editor.

```
mobile/
  shell/     the app's own screens (welcome, find your CasaTorch, sign in, two-step, alerts...), shared by both apps
  ios/       iPhone + iPad (Swift, XcodeGen project), with the alerts extension that decrypts on the phone
  android/   Android phones + tablets (Kotlin)
  store/     App Store and Google Play texts (English), review notes, data-safety answers
  tools/     shell-strings.mjs (strings to translate), store-check.mjs (store text limits)
```

Version **0.8.0** (build / versionCode **800**: raise it for every store upload).

## How it works

**No CasaTorch account.** You sign in to your own CasaTorch with the user you already have there. The app needs
two-step sign-in (it sets it up on the spot if you haven't). Or, on a screen that's already signed in, open
**Settings › Phones & alerts › Add a phone** and scan the one-time QR code (valid 10 minutes).

**Finding your CasaTorch.** **Find my CasaTorch** sees boxes that announce themselves on the home Wi-Fi
(Bonjour, `_casatorch._tcp`, CasaTorch 0.7 and newer), asks casatorch.com which boxes are on the same home internet
connection, and also tries the names a box answers to on the home network (`casatorch.local`, and
`homeassistant.local` for the add-on). Whatever it finds, it only trusts once that address answers as a CasaTorch. Or type its address: the app forgives a missing `http://`, a missing port
(it tries 8090, then https, then plain), a path or slash at the end, capitals and spaces, IPv6 (`fd00::20`) and
`.local` names. It then moves to the box's secure address by itself when the phone can reach it.

**When something's wrong, it says what.** The phone itself checks the address (not the web view), so the app can
tell apart: the phone is offline or on mobile data, iPhone's Local Network permission is off, no such name, nothing
listening on that port, a certificate the phone doesn't trust, a Wi-Fi sign-in page (hotel, café), Home Assistant
instead of CasaTorch, a CasaTorch that needs an update (older than 0.6.0) or an app that needs one (a box can ask for
a minimum app version with `appMin` in `/api/app/hello`). Sign-in errors (wrong password, too many tries, a wrong or
expired two-step code, a used or expired pairing code) come with what to do next; after two wrong codes it points
at the phone's clock.

**It reconnects by itself.** "Can't reach your home" is calm, says why, and keeps trying (after 2, 4, 8, 15, then
every 30 seconds, and at once when the network changes or the app comes back); it opens your home as soon as it
answers. With your home open, switching between Wi-Fi and mobile data (or coming back after a while) re-checks the
address and moves to one that works from here, on the same page. If the phone closes the app mid-sign-in, it
reopens at the same step (no password, code or ticket is kept). A pairing link opened while the app was closed goes
straight to pairing (after the lock, if it's on), and is never tried twice.

**The sign-in stays on the phone.** Each phone gets its own revocable sign-in (seen in Settings › Phones & alerts),
kept in the iOS Keychain / Android Keystore. With the lock on, it only comes out after Face ID, Touch ID, a
fingerprint or the screen lock, and the app hides itself in the app switcher.

**The app only shows your CasaTorch.** Links anywhere else open in the browser. The bridge to the phone
(`window.CasaNative`) only answers the main frame of the app's own screens and the exact addresses (scheme, host,
port) of the homes you signed in to; saving a sign-in and checking addresses only work from the app's own screens.
Plain http is used only to home-network addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x, fd00::/8, `*.local`, the
100.64/10 range used by Tailscale); anything else must be https, and casatorch.com always is.

**Kept on the phone, and only there.** Sign-ins: iOS Keychain (this device only, behind Face ID when the lock is
on) / Android Keystore-sealed. No cloud or device-to-device backup of app data on Android (`allowBackup=false` and
data-extraction rules); on iOS the web view's storage is excluded from backups. With the lock on, the app hides
itself in the app switcher / Recents. A copied two-step setup key leaves the clipboard after 2 minutes (and isn't
shown in Android's clipboard preview). Web view debugging is off in release builds.

**Alerts are end-to-end encrypted.** When you turn alerts on, the phone makes a key for that home and gives it only
to your CasaTorch. Each alert is encrypted (AES-256-GCM) by your box, signed with your box's own key, and handed to
casatorch.com, which passes the sealed bytes to Apple or Google. Only the phone can read them. casatorch.com keeps
no copy - only your box's public key (so nobody else can send as your home) and an hourly count, for rate limiting.

**Room scans go home.** On a LiDAR iPhone or iPad, **3D home › Scan a room** runs Apple's RoomPlan and uploads
the result to *your* CasaTorch's editor. It never touches casatorch.com.

**Photo-real scans.** Next to it, **3D home › Editor › Floors › Photo-real scan with this phone** scans the room with
ARKit's scene reconstruction (the LiDAR mesh, `ARMeshAnchor`) and colors it from the camera: while you walk, a small
photo (320 x 240) and the LiDAR depth are kept whenever the phone has moved or turned enough (up to 80); at Done each
point of the mesh takes its color from the photo that saw it best (facing it, close by, not hidden - the depth
says so). The result is a binary PLY (meters, Y up, normals and colors) that goes to the page through the same
chunked bridge as a RoomPlan scan, and the page makes it a photo-real scan on that floor (full and lighter copy,
lined up automatically). The screen says what to do as you go ("Move slowly. Point at every wall, the floor and the
corners", "Slow down a little", "Point at something with more detail"). Needs iOS 16 and
`ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification)` (iPhone 12 Pro or newer Pro,
iPad Pro with LiDAR); the bridge reports it as `hasMesh`. Code: `ios/CasaTorch/MeshScan.swift`.

## Fitted to each device

- **iPhone:** safe areas, Dynamic Type (the app's screens follow your text size), dark and light, VoiceOver labels
  and headings, haptics for success, errors and choices.
- **iPad:** a centered card instead of a stretched phone screen, every orientation, Split View, Slide Over and
  Stage Manager, pointer support, keyboard shortcuts (⌘R reload, ⌘[ back, ⇧⌘H your homes), Escape goes back, and
  a swipe from the left edge goes back on the app's own screens.
- **Android:** edge to edge, the back gesture (predictive back) goes back step by step on the app's own screens and
  never back into sign-in once your home is open, rotation and folding without reloading, tablets, the phone's font
  size, TalkBack labels.
- **Never a blank screen:** the web view appears only once a page has drawn; if its process is stopped (memory
  pressure, a crash) the same page comes back.

## Languages

Every string on the app's own screens goes through `T('…')` in `shell/shell.js`. Translations go in
`shell/i18n/words.js` (English key → translated text; the phone's language is used when it's there). The
CasaTorch web app's languages are es, de, fr, pt, it, nl, ja, zh, ko, hi, pl, sv and tr; the app's own screens
are English until those are added. `node mobile/tools/shell-strings.mjs` lists the strings and checks translations.

## Build it

### iPhone and iPad

```sh
brew install xcodegen
cd mobile/ios && xcodegen
open CasaTorch.xcodeproj
```

Pick your team under **Signing & Capabilities** for both targets (CasaTorch and NotificationService), then run.
Requires Xcode 16+, iOS 16+.

### Android

Open `mobile/android` in Android Studio (Ladybug or newer) and run, or from the command line:

```sh
gradle -p mobile/android assembleDebug
```

Requires JDK 17, Android 9+ on the phone.

Every push to `mobile/` also builds both apps in GitHub Actions (**Mobile apps** workflow); the Android debug APK
is attached to each run.

## Turning on alerts (once, for the store builds)

Alerts run through Firebase Cloud Messaging for both platforms. Without the Firebase files the apps work fully,
and the alerts screen says alerts aren't available in that build.

1. Create a Firebase project (console.firebase.google.com). Turn off Google Analytics for it - the apps don't use it.
2. Add an **iOS app** with bundle id `com.casatorch.app`. Download `GoogleService-Info.plist` into
   `mobile/ios/CasaTorch/`.
3. In Apple Developer › Keys, make an **APNs key**. Upload it in Firebase › Project settings › Cloud Messaging ›
   Apple app configuration.
4. Add an **Android app** with package `com.casatorch.app`. Download `google-services.json` into
   `mobile/android/app/`.
5. In Firebase › Project settings › Service accounts, **Generate new private key**. Save the JSON file outside any
   repository, then give it to the relay from the site folder:

   ```sh
   npx wrangler pages secret put FCM_SERVICE_ACCOUNT --project-name casatorch < path/to/service-account.json
   ```

   Delete the downloaded file after.

The two Firebase app files are listed in `.gitignore`; keep them out of the repository.

## Store checklist

**Pictures, icons and a step-by-step upload guide** for both stores are in [`store/README.md`](store/README.md):
8 screenshots per device (iPhone 6.9" and 6.5", iPad 13", Android phone, 7" and 10" tablet), the Play feature
graphic and icon, and the iOS 18 dark and tinted app icons. `store/tools/screenshots.mjs` makes the screenshots
again from the demo house.

**App Store (iPhone + iPad)**

- **Bundle ids:** `com.casatorch.app` and `com.casatorch.app.alerts`.
- **Capabilities:** Push Notifications, Keychain Sharing, Time Sensitive Notifications.
- **Before release:** set `aps-environment` to `production` in `ios/project.yml`.
- **Privacy:** "Data Not Collected". `PrivacyInfo.xcprivacy` is included, and the app has no tracking and no analytics.
- **Texts:** `store/app-store/en-US/` (name, subtitle, description, keywords, release notes, URLs) and
  `store/app-store/review_notes.txt`. `node mobile/tools/store-check.mjs` checks the length limits.
- **Export compliance:** the app uses only standard encryption (HTTPS, AES-GCM through the system), so
  `ITSAppUsesNonExemptEncryption` is `false`.
- **App icon:** `AppIcon` has the normal, iOS 18 dark and iOS 18 tinted versions (Xcode 16+).
- **App Review notes:** the app connects to the reviewer's own CasaTorch. Provide a demo box address and a demo
  user, or a video of pairing.

**Google Play**

- **Release signing:** make an upload key with `keytool` and keep it in `houseos-private`, never in this repository.
  Then use Play App Signing.
- **Data safety:** "No data collected" and "No data shared". Data is encrypted in transit (answers in
  `store/google-play/data_safety.txt`).
- **Texts:** `store/google-play/en-US/` (title, short and full description, changelog for versionCode 700).
- **Notifications permission:** asked only when you tap **Turn on alerts**.
- **Target API:** 35.
- **Launcher icon:** adaptive vector icon with a monochrome layer (themed icons, Android 13+); no density PNGs needed
  (minSdk 28).
