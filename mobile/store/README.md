# Store listing kit

Everything the App Store and Google Play ask for: texts, pictures and icons, and where each one goes.
The phone apps are not in the stores yet - this is what you upload when they are.

```
store/
  app-store/en-US/        texts for App Store Connect (one file per box)
  app-store/review_notes.txt
  google-play/en-US/      texts for Play Console
  google-play/data_safety.txt
  google-play/icon-512.png                  Play Store icon
  google-play/feature-graphic-1024x500.png  Play Store feature graphic
  screenshots/ios/iphone-6.9/   8 pictures, 1320 x 2868
  screenshots/ios/iphone-6.5/   8 pictures, 1284 x 2778
  screenshots/ios/ipad-13/      8 pictures, 2064 x 2752
  screenshots/android/phone/      8 pictures, 1080 x 1920
  screenshots/android/tablet-7/   8 pictures, 1920 x 1080
  screenshots/android/tablet-10/  8 pictures, 2560 x 1440
  tools/screenshots.mjs   makes all the screenshots and the feature graphic again
  tools/icons.mjs         makes the dark and tinted iPhone icons and the Play icon again
```

## The screenshots

Every device folder has the same eight pictures, in this order (upload them in this order - the first two or
three are what people see in search results):

| # | File | Headline | What it shows |
|---|------|----------|---------------|
| 1 | `01-home.png` | Your home, lit up. | The Home screen |
| 2 | `02-3d-home.png` | Your home in 3D (**Pro**) | The 3D home |
| 3 | `03-cameras.png` | Every camera, and what it saw | Cameras and Frigate detections |
| 4 | `04-energy.png` | See where the power goes | Energy |
| 5 | `05-health.png` | Knows it's all working | Settings › Health |
| 6 | `06-home-ai-agent.png` | Just ask your home (**Pro**) | Home AI Agent |
| 7 | `07-pairing.png` | Pair in seconds | The app's welcome screen (scan a pairing code) |
| 8 | `08-lock.png` | Locked to you | The Face ID / fingerprint step |

They are real screens: the CasaTorch demo house (no real people, places or accounts) and the app's own screens.
Two things are adjusted for the pictures, and nothing else: the demo banner and the Home widgets with third-party
content (sample photos, sports teams) are hidden, and the Cameras page shows a day of sample Frigate detections
with drawn thumbnails (the demo house has no Frigate). Nothing about reaching your home from away is shown - that's
still Coming.

## App Store Connect, step by step

Sign in at **appstoreconnect.apple.com** › **Apps** › **CasaTorch** (or **+ New App**: platform iOS, name
*CasaTorch*, language English (U.S.), bundle id `com.casatorch.app`, SKU `casatorch-ios`).

1. **App Information** (left column):
   - **Name**: `app-store/en-US/name.txt`. **Subtitle**: `subtitle.txt`.
   - **Category**: Primary *Utilities*, Secondary *Lifestyle*.
   - **Content Rights**: the app only shows what your own CasaTorch serves; answer the question for what your
     CasaTorch shows (weather, news and calendars you connected are third-party content).
   - **Age Rating** › Edit: answer *None* to everything (rating 4+).
2. **App Privacy**: **Privacy Policy URL** = `privacy_url.txt`. **Get Started** › "No, we do not collect data from
   this app" › **Publish**.
3. **Pricing and Availability**: Free, all countries you want.
4. Open the version under **iOS App** (for example *1.0 Prepare for Submission*):
   - **Previews and Screenshots** › **iPhone** tab › **6.9" Display**: drag in the 8 files from
     `screenshots/ios/iphone-6.9/`, in number order. Then **6.5" Display** (if the box is there; Apple can also
     reuse the 6.9" set): `screenshots/ios/iphone-6.5/`.
   - **iPad** tab › **13" Display**: the 8 files from `screenshots/ios/ipad-13/`.
   - **Promotional Text**: `promotional_text.txt` (you can change this one any time without a new build).
   - **Description**: `description.txt`. **Keywords**: `keywords.txt`. **Support URL**: `support_url.txt`.
     **Marketing URL**: `marketing_url.txt`.
   - **What's New in This Version**: `release_notes.txt` (not asked for the very first version).
   - **Build**: pick the build you uploaded from Xcode (Product › Archive › Distribute App).
   - **App Review Information**: a demo box address, user name and password the reviewer can reach (or a video of
     pairing), plus **Notes** = `review_notes.txt`.
   - **Version Release**: your choice (manual is safest the first time).
5. **Save**, then **Add for Review** › **Submit**.

The **app icon** is not uploaded here - it comes from the build. The asset catalog has three versions:
`ios/CasaTorch/Assets.xcassets/AppIcon.appiconset/icon-1024.png` (normal), `icon-1024-dark.png` (iOS 18 dark
Home Screen) and `icon-1024-tinted.png` (iOS 18 tinted). Xcode 16 or newer picks them up by itself.

## Google Play Console, step by step

Sign in at **play.google.com/console** › **CasaTorch** (or **Create app**: name *CasaTorch*, English (United
States), App, Free).

1. **Grow users › Store presence › Main store listing**:
   - **App name**: `google-play/en-US/title.txt`. **Short description**: `short_description.txt`.
     **Full description**: `full_description.txt`.
   - **App icon**: `google-play/icon-512.png`.
   - **Feature graphic**: `google-play/feature-graphic-1024x500.png`.
   - **Phone screenshots**: the 8 files from `screenshots/android/phone/`, in number order.
   - **7-inch tablet screenshots**: `screenshots/android/tablet-7/`.
   - **10-inch tablet screenshots**: `screenshots/android/tablet-10/`.
   - No video. **Save**.
2. **Store settings**: Category *House & Home*; contact email and website (`https://casatorch.com`).
3. **Policy › App content**:
   - **Privacy policy**: `https://casatorch.com/privacy.html`.
   - **Data safety**: answers in `google-play/data_safety.txt` ("No data collected", "No data shared",
     encrypted in transit).
   - **Ads**: No ads. **App access**: "All or some functionality is restricted" - give the same demo box, user
     and password as for Apple, with the steps from `app-store/review_notes.txt`.
   - **Content rating**: fill in the questionnaire (Utility, no violence/etc. - everything *No*).
   - **Target audience**: 18 and over. **News app**: No. **Government app**: No.
4. **Release › Production** (or **Testing › Internal testing** first) › **Create new release**: upload the
   signed `.aab`, release notes from `google-play/en-US/changelogs/800.txt` (the number is the versionCode).
   **Review release** › **Start rollout**.

The **launcher icon** is in the app itself (`android/app/src/main/res`): an adaptive icon (navy background, the
mark as foreground) with a **monochrome** layer for Android 13+ themed icons. It is a vector, so it's sharp at
every density; there are no PNG copies to keep up to date. The round icon is the same adaptive icon (launchers cut
it to their shape).

## Making the pictures again

After a design change, from the repository folder, on a computer with Node 18+:

```sh
npm i -D playwright && npx playwright install chromium   # once
node mobile/store/tools/screenshots.mjs                  # ~7 minutes; starts its own demo house
node mobile/store/tools/screenshots.mjs --only=ios/iphone-6.9,android/phone   # just some devices
node mobile/store/tools/icons.mjs                        # icons, if the mark changes
```

Headlines and the order of the pictures are at the top of `screenshots.mjs` (`SHOTS`). Look at every picture
before uploading it.
