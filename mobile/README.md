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
```

## How it works

**No CasaTorch account.** You sign in to your own CasaTorch with the user you already have there. The app needs
two-step sign-in (it sets it up on the spot if you haven't). Or, on a screen that's already signed in, open
**Settings › Phones & alerts › Add a phone** and scan the one-time QR code (valid 10 minutes).

**The sign-in stays on the phone.** Each phone gets its own revocable sign-in (seen in Settings › Phones & alerts),
kept in the iOS Keychain / Android Keystore. With the lock on, it only comes out after Face ID, Touch ID, a
fingerprint or the screen lock, and the app hides itself in the app switcher.

**The app only shows your CasaTorch.** Links anywhere else open in the browser. The bridge to the phone
(`window.CasaNative`) only answers the app's own screens and the homes you signed in to.

**Alerts are end-to-end encrypted.** When you turn alerts on, the phone makes a key for that home and gives it only
to your CasaTorch. Each alert is encrypted (AES-256-GCM) by your box, signed with your box's own key, and handed to
casatorch.com, which passes the sealed bytes to Apple or Google. Only the phone can read them. casatorch.com keeps
no copy - only your box's public key (so nobody else can send as your home) and an hourly count, for rate limiting.

**Room scans go home.** On a LiDAR iPhone or iPad, **3D home › Scan a room** runs Apple's RoomPlan and uploads
the result to *your* CasaTorch's editor. It never touches casatorch.com.

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

**App Store (iPhone + iPad)**

- **Bundle ids:** `com.casatorch.app` and `com.casatorch.app.alerts`.
- **Capabilities:** Push Notifications, Keychain Sharing, Time Sensitive Notifications.
- **Before release:** set `aps-environment` to `production` in `ios/project.yml`.
- **Privacy:** "Data Not Collected". `PrivacyInfo.xcprivacy` is included, and the app has no tracking and no analytics.
- **Export compliance:** the app uses only standard encryption (HTTPS, AES-GCM through the system), so
  `ITSAppUsesNonExemptEncryption` is `false`.
- **App Review notes:** the app connects to the reviewer's own CasaTorch. Provide a demo box address and a demo
  user, or a video of pairing.

**Google Play**

- **Release signing:** make an upload key with `keytool` and keep it in `houseos-private`, never in this repository.
  Then use Play App Signing.
- **Data safety:** "No data collected" and "No data shared". Data is encrypted in transit.
- **Notifications permission:** asked only when you tap **Turn on alerts**.
- **Target API:** 35.
