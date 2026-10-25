# Feature spec: Android app

🚧 **P0 done 2026-10-24**: `mobile/android`, CI (`android.yml`) building a debug APK and a release APK signed with the upload key (secrets `ANDROID_UPLOAD_*`; the key itself is on the owner's Mac, `~/.paddlesnitch-android/`), `/.well-known/assetlinks.json` (route in `apps/web/src/app/.well-known/`), installed on the owner's Pixel 9 Pro. **P1 under way:** models generated from the contract (`buildSrc/ContractModels.kt`), formatters checked against `format.json`, the Paddles list, and password sign-in / sign-up / sign-out with the tokens in the Keystore (signed out it shows the sample paddles), and Strava sign-in (2026-10-25: Custom Tab + PKCE, back on `com.paddlesnitch.app:/signin/strava`; checked on an emulator up to the server, the full Strava round trip needs production), and an Account screen (name and email; details, Strava, devices, your data and delete account open on the website already signed in via C4's one-time code; help, privacy, terms; sign out). **Paddle page** (2026-10-25): tap a card for one paddle, read only, as the website's: map coloured by speed (MapLibre Native over Esri's dark grey tiles), stats, conditions, note, coach summary, efforts and rests, and 500 m splits worked out from the points (the website has no splits table yet); Compose UI tests under Robolectric and Roborazzi screenshot goldens in CI. **Add a file** (2026-10-25): the system file picker → the website's upload (`paddles/AddPaddle.kt`; checked on an emulator against a local server). **P3 tracker setup built 2026-10-25, awaiting a hardware test** (`mobile/android/TRACKER-TESTING.md`): Account → **Set up or sync a tracker** finds the tracker with CompanionDeviceManager, pairs it (number on both screens, hold on the tracker), adds it to the account over Bluetooth (`link-bluetooth`), sends WiFi details and syncs recordings through the relay route with receipts. The protocol is pure Kotlin (`tracker/Tracker.kt`, `Protocol.kt`) behind a `TrackerLink` interface, tested against a fake tracker and against `mobile/contract/fixtures/tracker`; `BleTrackerLink` is the Android GATT side. Not yet: automatic sync (presence wake-up + the `connectedDevice` service), tracker settings, updates over Bluetooth.

The native Android app: Kotlin + Jetpack Compose + Material 3, Android 10
(API 29) and up, distributed on Google Play. What it shares with the iPhone app
(the decisions, the API schema, the fixtures, the tokens and the server changes) is in
[`mobile-apps.md`](mobile-apps.md). Read that first. This file covers only
the Android side.

Plain Kotlin/Android throughout: no Kotlin Multiplatform, no expect/actual.
Models are generated from `mobile/contract/api/`, colours and type from
`mobile/contract/tokens/`, and the tests check `mobile/contract/fixtures/`.

## Newer features, and saying what's missing

Floor: **Android 10 (API 29)**. Target: the newest API level Play requires.

A single **capability list** in the app says, for each feature, what it needs
(Android version, hardware, permission) and what happens without it. It has two uses:

- A **"This phone"** screen (Settings) lists every feature as works / needs
  Android N / needs permission → *fix*, and shows whether the phone maker's
  battery setting is done.
- The same list drives the screens: a feature the phone can't do is explained
  where you'd look for it, never silently missing.

First entries (confirm against the docs during the spikes):

| Feature | Needs | Without it |
|---|---|---|
| Tracker syncs on its own when nearby (system wakes the app) | Android 12+ (companion device presence) | Syncs when you open the app, plus a periodic background check |
| Bluetooth scanning without location permission | Android 12+ | Android 10–11 also ask for location to find the tracker, and can't sync in the background |
| Recording progress on the lock screen as a live update | Android 16+ | An ordinary ongoing notification with the same numbers |
| Predictive back animations | Android 14+ | Normal back |
| Save paddles to Health Connect | Android 14+ built in; 10–13 with the Health Connect app | Offered as an install, or hidden |
| Notifications (sync done, recording recovered) | Permission on Android 13+ | Asked for when first useful; works without |
| Per-app language | Android 13+ | Follows the phone |

## Recording

The format and upload are fixed by the recording contract in
[`mobile-apps.md`](mobile-apps.md). On Android:

- A **foreground service** of type `location` runs the recording, started
  while the app is on screen. That keeps GPS going with the screen off
  **without background location permission**, which Play reviews strictly and
  users distrust. The app only asks for location "while using the app".
- GPS at 1 Hz (fused high accuracy, or the raw GNSS provider; the spike
  decides on real water). Accelerometer + gyro reduced to the sidecar's 10 Hz.
- Every fix is appended and flushed. If the system kills the app, the service
  restarts (`START_STICKY`) and carries on from the file.
- **Phone makers that kill apps** (Samsung, Xiaomi, OnePlus…) are the biggest
  risk. The app detects the maker and walks the user through its battery
  setting once.
- Wet hands, drybag: big targets, start/stop from the notification and lock
  screen, "hold to stop".
- WorkManager queues and retries the upload.

## Pairing and syncing the tracker

The protocol is fixed by the tracker sync contract and its fixtures. On Android:

- **Pairing** goes through **CompanionDeviceManager**: the system's own "pair
  with PT-17C?" sheet and no scanning screen of ours. It also lets the system
  wake the app when the tracker comes near (Android 12+). The service runs as
  type `connectedDevice` while syncing.
- **Cached service lists.** Android keeps a tracker's old Bluetooth layout
  after a firmware change (seen 2026-10-05). The tracker sends Service Changed,
  and the app also refreshes its GATT cache when `BLE_LAYOUT` differs, so
  nobody is told to forget and re-pair.
- Android refuses the first paired-only read and a read can hang (found on the
  web, 2026-10-04). Use the same retry the web page uses: about 30 s in total,
  3 s per try.
- **As built (2026-10-25):** the association filter is the paddlesnitch
  service UUID only (the `PT-` name is in the scan response, which a filter on
  the advertisement can miss). CompanionDeviceManager does the scan, so the app
  asks only for `BLUETOOTH_CONNECT` (Android 12+) and never for location; 10–11
  use the install-time `BLUETOOTH`/`BLUETOOTH_ADMIN`. `BLE_LAYOUT` isn't
  readable over Bluetooth, so "differs" means: the discovered items don't
  include all six from `gatt.json`; then the app calls the hidden
  `BluetoothGatt.refresh()` and discovers again. MTU 517, so one DATA page is
  one read. One GATT operation at a time, 10 s each; an operation given up on
  is allowed to answer before the next one starts. The first connection is
  retried once (status 133). The last tracker is remembered for "Connect to
  PT-xxx". Manual sync runs with the screen open (no foreground service yet).

## Sign-in (Android side)

- Server side is in [`mobile-apps.md`](mobile-apps.md) (C2).
- The refresh token lives in Keystore-backed storage. The app refreshes the ID
  token itself.
- Strava and website link-outs open in a **Custom Tab**. Strava sign-in comes
  back on the app's own scheme with a one-time code (`auth/StravaSignIn.kt`;
  `MainActivity` is `singleTask`, so the return closes the tab). PKCE, not app
  link verification, is what protects the code, so debug builds work too.

## Screens and libraries

- Compose + Material 3 with the paddlesnitch dark theme from the generated
  tokens (no dynamic colour: the design system is fixed). Edge to edge,
  predictive back, themed icon.
- Maps: MapLibre Native (likely) over the same Esri dark grey tiles as the web,
  subject to open question 4.
- Navigation, DI and networking: standard current Jetpack choices (Navigation
  Compose, Hilt or manual DI, Ktor or OkHttp + kotlinx.serialization). Pick in
  S3, keep it boring.

## Before Play: installing straight onto phones

Decided 2026-10-24: the owner **tests on their own phone first** and opens the
Play account later. Until then:

- **Debug builds over USB or WiFi** (`adb install`, or Run from Android Studio)
  on the owner's phone. This is enough for S1–S3 and P1–P3.
- **An emulator** for screens, sign-in and the capability list across Android
  versions. It **can't** stand in for a paddle (real GPS with the screen off,
  motion, the phone maker's battery killer) or for the real tracker over
  Bluetooth, so S1 and S2 need the phone.
- **A signed APK from CI** for anyone else who wants to try it before Play
  exists, installed via "install unknown apps". **Built 2026-10-25:** every
  merge to `main` that touches the app publishes the signed release APK to the
  GitHub release `android-latest` (`publish` job in `android.yml`), and
  **paddlesnitch.com/android** has the download button and install steps
  (`/android/download` redirects to the file; not in the menu, not indexed).
  Same upload key every time, so a new download installs over the old one and
  keeps you signed in. Google's 2026
  developer verification will eventually cover such installs too, but `adb`
  installs by a developer stay allowed. Check the status before handing APKs to
  testers.
- The debug signing key isn't the release key. Create the **upload key** once
  and keep it in a GitHub secret from the start, so the first Play upload isn't
  a key ceremony.

## Distribution on Google Play

Opened **after** the owner has used the app on their phone. Note the calendar
cost: a personal account can't reach production until a 14-day closed test
has run, so opening it a little before P5 avoids waiting at the end.

- **Account type: personal** (decided 2026-10-24). A personal developer
  account created after Nov 2023 must run a **closed test with at least 12
  testers opted in for 14 days in a row** before it can publish to production.
  Identity verification and a one-off US$25 fee.
- **Tracks.** Internal testing (up to 100 people, live in minutes) → closed
  testing for beta testers (the tracker beta group) → production. **Every merge
  to `main` that touches `mobile/android/` goes to internal testing**, and
  promotion is a manual workflow, like firmware beta → stable.
- **Signing.** Play App Signing holds the app key; CI holds only the upload key
  (GitHub secret on a protected environment). CI publishes with the Play
  Developer API via GitHub OIDC → Google Workload Identity Federation where
  possible (no stored JSON key, matching the AWS setup).
- **Policy forms**, all needed before the first closed test:
  - foreground service types (`location`, `connectedDevice`), each with a
    short screen recording;
  - data safety form (location, motion, account email; nothing sold or shared;
    heart rate never collected);
  - privacy policy URL (`/privacy`, updated for the apps and phone sensors);
  - account deletion: an in-app entry opening the existing web flow, plus the
    web URL in the listing;
  - content rating, target audience (not children), Health Connect permissions
    if and when added.
- **Android developer verification** (Google's 2026 requirement for apps on
  certified devices): covered by a verified Play account; confirm when the
  account is set up.
- **Package name: `com.paddlesnitch.app`** (decided 2026-10-24, permanent),
  the same as the iOS bundle ID.

## Testing (Android)

- Unit tests over the shared fixtures (CSV writer, Bluetooth protocol,
  receipts) and the generated models.
- Compose UI tests.
- An emulator matrix in CI at API 29, 33 and the newest, mainly to check that
  the capability list switches features on and off as promised.
- A fake tracker for sync, driven by the same fixtures as the web's.
- By hand on real phones: long recordings, OEM battery killers, Bluetooth with
  the real tracker.

## Phases

| Phase | What | Proves |
|---|---|---|
| **P0. Build and install** | `mobile/android` project, CI builds a signed APK, upload key in a secret, `assetlinks.json`; installs on the owner's phone | We can put a build on a phone |
| **S1. Recording spike** | Throwaway: 2 h screen-off in a drybag on a cheap Samsung + one other phone; GPS provider; sidecar → `deriveCadence` | The phone can be a tracker; whether stroke rate is possible |
| **S2. Tracker spike** | CompanionDeviceManager pairing + one background sync from the real tracker, with receipt | Sync with nothing pressed works on Android |
| **S3. API spike** | Generated models + client for two procedures over C1; token sign-in over C2 | The contract and sign-in shape |
| **P1. Read** | Sign-in, Paddles list + one paddle, This phone, link-outs | Daily-use value; shell and theme |
| **P2. Record** | Recorder → upload as a phone device → appears in Paddles | The phone as a tracker |
| **P3. Tracker** | Pair, setup, manual then automatic sync, tracker settings | The boathouse problem solved |
| **P4. Trials and sections** | Open trials, leaderboards, submit an entry; race a section, compare, buddies | Native for the core of the site |
| **P5. Play** | Personal Play account, internal testing, closed test with ≥12 testers for 14 days, store listing, production | Real users |
| Later | Tracker updates over Bluetooth (after signed firmware), Health Connect, passkeys, Wear OS | |

S1–S3 run alongside P0 and the shared C1–C3. Their results may change P2/P3.

## Open questions (Android)

1. **Who are the 12 closed-test testers?** (The tracker beta group is the
   obvious pool.)
2. **GPS provider:** fused or raw GNSS, decided in S1.
3. **Map tiles:** Esri's terms and attribution for use in an app, or a
   different keyless source.
