# Rest & Move

Eye and move breaks after real screen use. No ads, no account, works offline.

Eye Rest & Move reminds you to rest your eyes after real screen use, and to stand up after long sitting. It counts while your screen is in use, waits when you are on a call, and asks for nothing before you start.

**Get it:** [App Store](https://plainapps.dfdsfdsfsdf.workers.dev/apps/eye-rest-move/) · [Google Play](https://plainapps.dfdsfdsfsdf.workers.dev/apps/eye-rest-move/) · [GitHub Releases](https://github.com/plainappsforever/eye-app/releases) ·
[Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/plainappsforever/eye-app)

**Status:** first store release pending.

## Our promise

**Free, no ads, no tracking, no accounts.** This app keeps your data on your phone. It has no analytics, no crash
reporter, no advertising SDK and no sign-in. The Android release build has no INTERNET permission at all. We will not sell this app or this project to a company
that changes any of this.

Why we write it down: in 2023 a popular open-source Android suite was sold to an ad-funded app company and its store
listings started saying "Contains ads"; its community had to fork it to keep a clean version. The source code of
Rest & Move is published under GPL-3.0, so if this promise were ever broken, anyone could continue the last
version that kept it.

## What it does

No account. No ads. No subscription. Works offline. The app has no internet permission, and nothing you do in it leaves your phone.

EYE BREAKS
• Counting starts when you use the phone and resets after the screen has been off for a short while. A short check of the phone does not restart it.
• The classic 20-20-20 rhythm is the default (20 minutes, 20 seconds). Change the interval and break length, set active hours and weekdays, or pause for 15 minutes, 30 minutes, an hour or until tomorrow.
• Three strengths: Gentle, Balanced, Firm. One follow-up at most, only if you are still using the phone.
• Answer from the notification: Start break, Snooze or Done. Swipe it away to skip. After a break you return to the app you were in.
• Break types: look far, blink, close your eyes, stand up, or a mix. Each has a "Why this?" note that says what studies exist and what they do not show.
• Four chimes and an end-of-break sound. Reminders wait during phone calls and arrive a few seconds after.

MOVE BREAKS
• One reminder to stand up and move after about 45 minutes (choose 30 to 120), on weekdays 09:00 to 18:00 by default. You can turn it off in one tap.
• When an eye break and a move break are close together you get one reminder, never two within five minutes.
• Walk, stretch or a mix, for 1, 2 or 5 minutes.
• Optional "Notice when I've moved": the phone's step counter skips a reminder after you have already walked. Off by default; Android asks for Physical activity only when you switch it on.

SEE IT AT A GLANCE
• Quick Settings tile "Breaks" and a home-screen widget with the countdown.
• A status notification shows that counting is on, and a Reliability checklist shows what could stop it, with one-tap links to your phone maker's battery settings.
• Stats for 7 or 30 days, hour bars and a move card. Export as a CSV file or delete your history in one tap.

OPTIONAL, ONLY WHEN YOU TURN THEM ON
• Full-screen break (Firm): a short countdown over the app you are using. Needs "Display over other apps". Snooze, Skip and Back always close it.
• Don't count these apps: pick apps such as navigation that should not count as screen time. Needs Usage Access, which Android describes as access to app usage information. The app only checks which app is in front and compares it with your list, on your phone.

PRIVACY
All data stays on your phone. No account, no analytics, no tracking, no ads. The app itself makes no network requests. Study and help links open your browser only when you tap one.

IMPORTANT
Eye Rest & Move is a wellness reminder, not a medical device. It does not diagnose, treat or prevent any condition, and the evidence for break rules is mixed. If discomfort or changes in your vision persist, see an eye-care professional; for other symptoms, see a doctor.

Needs Android 7.0 or newer. The app is in English.

## Privacy

- All data is stored locally (SQLite in the app's private storage). Nothing is uploaded.
- Files leave the phone only when you share or export them yourself.
- Privacy policy: https://plainapps.dfdsfdsfsdf.workers.dev/apps/eye-rest-move/privacy

## Build from source

The app identifier `com.tim.eyeapp` is a placeholder: the identifier changes before the first store release.

You need: **Node.js 22 LTS** (the React Native version used here accepts `^20.19.4 || ^22.13.0 || ^24.3.0`), npm,
and git. The app is an [Expo](https://expo.dev) (SDK 57) / React Native app; the native `android/` and `ios/` folders
are generated from `app.config.ts` and are not in the repository.

```sh
git clone https://github.com/plainappsforever/eye-app.git
cd eye-app
npm ci
npm run verify          # typecheck + lint + all unit tests
```

### Android (Linux, macOS or Windows)

Needs JDK 17 and the Android SDK (Android Studio installs both; set `ANDROID_HOME`).

```sh
export APP_VARIANT=production
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/ (signed with the debug key unless you configure your own key)
```

`APP_VARIANT` selects the app id and name (`development`, `preview`, `production`; see `app.config.ts`).
Builds made this way are signed with your key, not ours, so they cannot update an installed store version.

### iOS (macOS only)

Needs Xcode (26 or newer) and CocoaPods.

```sh
export APP_VARIANT=production
npx expo prebuild --platform ios
npx expo run:ios --configuration Release        # runs on the iOS Simulator
```

For a real iPhone, open `ios/*.xcworkspace` in Xcode, choose your own team under *Signing & Capabilities*
and change the bundle identifier. There is no sideloading store for iOS; the App Store build is ours.

## Verifying a release

Every GitHub release lists SHA-256 checksums (`SHA256SUMS.txt`) and the APKs are signed with one key per app.
Certificate SHA-256 fingerprint: `not yet published on Android`

## How this app was made

Rest & Move was written with substantial help from an AI coding assistant (Claude Code), directed, reviewed and
tested by the maintainer. We say this openly because some stores and users care about it.

## Licence

Copyright (C) 2026 Farija Retkoceri

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, version 3 (GPL-3.0-only). See [LICENSE](LICENSE).
Third-party components keep their own licences (see `LICENSES/` and the app's licences screen where present).
Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
