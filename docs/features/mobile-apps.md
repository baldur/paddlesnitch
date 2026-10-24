# Feature spec: mobile apps (Android first, then iPhone)

🚧 **Spec — 2026-10-24. Not built.**

A native paddlesnitch app: Android first, iPhone soon after, Wear OS much
later. The phone works as a **tracker** (records a paddle on its own) and as a
**companion** to the hardware tracker (pairs it, sets it up, brings its
recordings home over Bluetooth). It also shows everything you'd normally look
at on paddlesnitch.com: paddles, trials, sections.

This replaces the earlier plan of an Expo app
([`unified-app-and-api.md`](unified-app-and-api.md) Phase 4,
[`tracker-bluetooth-sync.md`](tracker-bluetooth-sync.md) P6/P7 and its open
question 1).

## Decisions taken (2026-10-24)

| Question | Decision |
|---|---|
| Expo or native | **Native.** Kotlin + Jetpack Compose on Android, with logic shared with iPhone through Kotlin Multiplatform |
| iPhone | **Yes, soon after Android.** So shared code is Kotlin Multiplatform from day one |
| Oldest Android | **Android 10 (API 29).** Newer features switch on where the phone has them, and the app says what's missing |
| What's in the app | **Native screens** for the main things, trial upload and race-a-section included. Rarely used admin pages open the website |
| Distribution | **Google Play** from the start: internal testing → closed testing → production |
| Watch | Later, Wear OS only. Not planned here beyond keeping the recorder reusable |

## Goals

- Record a paddle on the phone with the screen off, in a drybag, for hours, and
  never lose it, even if the phone kills the app.
- Pair a tracker in a minute and then forget about it: recordings arrive in
  Paddles whenever the phone is near, no WiFi needed.
- Feel like a current Android app (Material 3, predictive back, edge to edge,
  lock-screen progress) on new phones, and work properly on Android 10.
- Keep the web, Android and iPhone in step **without** building every feature
  three times.

## Not in scope

- Doing analysis on the phone. The server stays the only place that works out
  splits, stroke rate, summaries and race results.
- Offline browsing of the library beyond a small cache (it comes later if
  testers ask for it).
- Live stroke rate while recording (that waits for the tracker's own
  on-device work, `tracker-bluetooth-sync.md` P8).
- Course drawing, group admin, account export/erasure, the river planner and
  games as native screens. These open the website (see "What's native").
- Wear OS.

## How parity stays cheap

Parity is the hard part, so it's designed in rather than kept up by effort.
Six rules:

1. **One recording format for every recorder.** The phone writes **exactly the
   tracker's CSV** (same columns, see [`device-uplink.md`](device-uplink.md))
   plus the same `_i10.csv` motion sidecar, from its own GPS and motion
   sensors. It uploads through the same session handling
   (`lib/session-upload.ts`). So `parseTrace`, `deriveCadence`, the device
   data page and the analysis need no change, and any server improvement
   reaches tracker, phone and (later) watch together.
2. **The server does the thinking; the apps only show it.** Anything worked out
   comes from the API. The app never re-implements timing or analysis.
3. **One shared Kotlin core for Android and iPhone** (Kotlin Multiplatform):
   API client and models, sign-in and token refresh, the upload queue, the
   recording writer, and the tracker's Bluetooth protocol. Only the screens and
   the platform glue (GPS, sensors, background work, Bluetooth radio, secure
   storage) are written per platform.
4. **The API contract is generated, not copied.** See "API contract". A server
   change that breaks the app fails CI, not someone's phone.
5. **Shared test fixtures.** The tracker's Bluetooth protocol, receipts and CSV
   format get golden fixtures (JSON + sample files) in the repo, checked by
   the web's TypeScript tests, the Kotlin tests and the firmware host tests.
   Three implementations, one set of answers.
6. **Design tokens are generated.** `@paddlesnitch/ui/tokens.css` stays the one
   source. A small script emits Kotlin (and later Swift) colours and type, so
   the apps' dark theme can't drift from the web's.

## Platforms and newer features

Floor: **Android 10 (API 29)**. Target: the newest API Play requires.

A single **capability list** in the app says, for each feature, what it needs
(Android version, hardware, permission) and what happens without it. Two uses:

- A **"This phone"** screen (Settings) lists every feature as works / needs
  Android N / needs permission → *fix*.
- The same list drives the screens: a feature the phone can't do is explained
  where you'd look for it, never silently missing.

First entries (to be confirmed against the docs during the spikes):

| Feature | Needs | Without it |
|---|---|---|
| Tracker syncs on its own when nearby (system wakes the app) | Android 12+ (companion device presence) | Syncs when you open the app, plus a periodic background check |
| Bluetooth scanning without location permission | Android 12+ | Android 10–11 also ask for location to find the tracker, and can't sync in the background |
| Recording progress on the lock screen as a live update | Android 16+ | An ordinary ongoing notification with the same numbers |
| Predictive back animations | Android 14+ | Normal back |
| Save paddles to Health Connect | Android 14+ built in; 10–13 with the Health Connect app | Offered as an install, or hidden |
| Notifications (sync done, recording recovered) | Permission on Android 13+ | Asked for when first useful; works without, just quieter |
| Per-app language | Android 13+ | Follows the phone |

## What's native, what opens the website

| Native | Opens the website (Custom Tab, still signed in) |
|---|---|
| Sign in / sign up (email code, password, Strava) | Group admin, invitations, join requests |
| Paddles list, one paddle (map, speed/rate, splits, summary, note, boat) | Drawing or editing a course; opening a trial |
| Record a paddle | Account: export, delete, handle, public profile, terms |
| Trackers: pair, set up, sync, settings | River planner, games, help |
| Trials: open trials, leaderboard, submit an entry | |
| Race a section, compare, buddies' paddles | |
| This phone, app settings | |

A website page can be brought into the app later if people actually use it
there. Open question: whether the **Custom Tab shares the web session** (it
needs the `tt_id` cookie). See "Sign-in".

## Recording on the phone

- A **foreground service** of type `location` runs the recording, started
  while the app is on screen. That keeps GPS going with the screen off **without
  background location permission**, which Play reviews strictly and users
  distrust. The app only ever asks for location "while using the app".
- **GPS** at 1 Hz (fused high accuracy or the raw GNSS provider; the spike
  decides on real water). **Motion** from the accelerometer and gyro, reduced
  to the sidecar's 10 Hz, so `deriveCadence` can try stroke rate. Whether a
  phone in a bag gives a usable stroke rate is **unknown**: measure it and show
  an honest verdict, the way the device data page does. Never fake it.
- **Never lose a paddle.** Every fix is appended and flushed to disk as it
  arrives. If the phone kills the app, the service restarts and carries on, and
  the screen says "recording recovered, gap 0:42" rather than starting again.
  Stopping only queues the upload; it never waits for the network.
- **Wet hands, drybag.** Big targets, start/stop from the notification and lock
  screen, a "hold to stop" to avoid accidents, and later auto-start on movement
  like the tracker.
- **Phone makers that kill apps** (Samsung, Xiaomi, OnePlus…) are the biggest
  risk. The app detects the maker and walks the user through its battery
  setting once, and the "This phone" screen shows whether it's done.
- **Uploading.** The phone registers itself as a device on the account
  (`model: phone-android`) the first time it records, so its paddles show up
  under the devices like a tracker's: same duplicate checks, same pieces and
  compression, same data page. It uploads as the signed-in user (no device
  token on the phone), through the account route that already relays tracker
  recordings (`POST /api/account/devices/{deviceId}/sessions`), extended to
  accept a phone device (no receipt needed). A WorkManager job retries until
  the server has it.

## Pairing and syncing the tracker

Most of this exists. Bluetooth setup, WiFi details over Bluetooth, linking
without WiFi, and syncing through the phone with server receipts were built and
verified from the browser
([`tracker-bluetooth-sync.md`](tracker-bluetooth-sync.md), #346/#353/#355). The
app speaks the same protocol, checked against the same fixtures.

- **Pairing** goes through Android's **CompanionDeviceManager**: the system's
  own "pair with PT-17C?" sheet, no scanning screen of ours, and it lets the
  system wake the app when the tracker comes near (Android 12+).
- **Setup** follows the Bluetooth spec's order: lesson on the tracker, choose
  WiFi / Bluetooth + WiFi / Bluetooth only, link to the account, offer an
  update.
- **Sync.** When the tracker is near, read the list of pending recordings,
  upload each through the relay route, and pass the server's receipt back so
  the tracker marks it sent. The **device token never crosses Bluetooth**.
  Partly sent files resume from the pieces the server already has.
- **Cached service lists.** Android keeps the tracker's old Bluetooth layout
  after a firmware change (seen on 2026-10-05). The tracker already sends
  Service Changed. The app also refreshes its cache when the layout version
  differs, so nobody is told to forget and re-pair.
- **Updates over Bluetooth** wait for signed firmware (Bluetooth spec P3), as
  that spec already requires.

## Sign-in

- The tRPC route already accepts `Authorization: Bearer <Cognito ID token>`.
  **The REST routes the app calls don't yet**: trial upload, the account
  device routes, account endpoints. Add one helper (`getRequestUser(req)`,
  cookie or Bearer) and use it on those routes, with a test per route.
- The existing sign-in routes set cookies. Add **mobile variants that return
  the ID + refresh tokens in the body**, going through the same code (anti-bot
  gate, terms acceptance, pending invitations). The app refreshes the ID token
  itself and keeps the refresh token in Keystore-backed storage.
- **Strava sign-in** opens a Custom Tab. The callback lands on a verified app
  link (`https://paddlesnitch.com/app/...`, needs
  `/.well-known/assetlinks.json`) carrying a **one-time code**, which the app
  swaps for tokens. Tokens never appear in a URL.
- **Website pages opened from the app** need to be signed in too. Proposal: a
  one-time code handed to the Custom Tab, which a web route turns into the
  usual cookies. Decide in spike S3.
- Passkeys (Credential Manager) are a later nice-to-have.

## API contract

- tRPC **inputs** are already zod. **Outputs** are inferred TypeScript types,
  which Kotlin can't see. For every procedure the app uses, add a zod
  `.output()` schema. That also checks the server's answers at runtime.
- A script (`pnpm api:schema`) emits JSON Schema for those procedures with zod
  v4's `z.toJSONSchema`. It is committed, and CI fails if it's out of date. The
  Kotlin models are generated from it. REST routes the app calls get the same
  treatment by hand-written zod.
- The Kotlin client speaks tRPC's plain HTTP form directly (queries as `GET
  /api/trpc/<path>?input=…`, mutations as `POST`, answers as
  `{ result: { data } }`; the router has no transformer, so it's plain JSON).
  No batching.
- **Old app versions stay in the wild.** API changes are additive only (new
  fields optional, nothing renamed or removed while an app version uses it). The
  server reports a **minimum supported app version**, and below it the app
  shows "please update" via Play's in-app update prompt.

## Code layout

```
mobile/                 Gradle, NOT a pnpm workspace package (like firmware/)
  shared/               Kotlin Multiplatform: api client, models (generated), auth,
                        upload queue, recording writer, tracker Bluetooth protocol
  android/              The Android app: Compose UI, services, platform glue
  ios/                  Later: the iPhone app over shared/
  contract/             Generated JSON Schema + design tokens (committed)
```

The iPhone UI is an open question (SwiftUI or Compose Multiplatform). To keep
both options open, the Android screens stick to Compose libraries that also run
on Compose Multiplatform where that costs nothing.

Maps: a native map library (MapLibre Native is the likely choice) over the same
Esri dark grey tiles the web uses. Check Esri's terms for app use and the
attribution needed.

## Distribution on Google Play

Start this **first** (phase P0), because two of the steps take calendar time.

- **Account type.** A *personal* developer account created after Nov 2023 must
  run a **closed test with at least 12 testers opted in for 14 days in a row**
  before it can publish to production. An *organisation* account skips that but
  needs a legal entity and a D-U-N-S number (free, can take a couple of weeks).
  Either way there's identity verification and a one-off US$25 fee. **Decision
  needed: personal or organisation.**
- **Tracks.** Internal testing (up to 100 people, minutes to go live) for us →
  closed testing for beta testers (the tracker beta group) → production.
  Mirrors firmware: **every merge to `main` that touches `mobile/` goes to
  internal testing**, and promotion is a manual workflow, like flipping
  firmware beta → stable.
- **Signing.** Play App Signing holds the app key. CI holds only the upload key
  (a GitHub secret on a protected environment). CI publishes with the Play
  Developer API, authenticated by GitHub OIDC → Google Workload Identity
  Federation where possible (no stored JSON key, matching the AWS setup).
- **Policy forms Play will ask for**, all needed before the first closed test:
  - Foreground service types (`location`, `connectedDevice`), each with a short
    screen recording of why.
  - Data safety form: location, motion, account email; nothing sold or shared;
    heart rate never collected.
  - Privacy policy URL (`/privacy`, updated for the app and the phone's
    sensors).
  - Account deletion: an in-app entry that opens the existing web flow, plus the
    web URL in the listing.
  - Content rating questionnaire, target audience (not children), and Health
    Connect permissions if and when that's added.
- **Android developer verification** (Google's 2026 requirement for all apps on
  certified devices): covered by a verified Play account; confirm the status
  when the account is set up.
- **Store listing:** name, icon, screenshots, feature graphic. Package name
  decided once and never changed (proposal: `com.paddlesnitch.app`).

## Testing

- `shared/`: Kotlin unit tests, including the golden fixtures (CSV format,
  Bluetooth protocol, receipts) that the web and firmware tests also check.
- Server: tests for every REST route that gains Bearer auth, the mobile sign-in
  routes, the phone-as-device upload, and a contract test that the committed
  schema matches the routers.
- Android: Compose UI tests; an emulator matrix in CI at API 29, 33 and the
  newest, mainly to check that the capability list switches features on and
  off as promised; a fake tracker for the Bluetooth sync (the web already has
  one for `syncOverBluetooth`).
- By hand on real phones: long recordings, OEM battery killers, Bluetooth with
  the real tracker. These are what the spikes are for.

## Phases

| Phase | What | Proves |
|---|---|---|
| **P0. Play account** | Developer account, package name, empty app on internal testing via CI, assetlinks.json | We can ship; starts the account clock |
| **S1. Recording spike** | Throwaway: 2 h screen-off recording in a drybag on a cheap Samsung and one other phone; GPS provider choice; motion sidecar → `deriveCadence` | The phone can be a tracker; whether stroke rate is possible |
| **S2. Tracker spike** | CompanionDeviceManager pairing + one background sync from the real tracker, with receipt | Sync with nothing pressed actually works on Android |
| **S3. API spike** | `.output()` + schema + generated Kotlin for two procedures; Bearer on one REST route; mobile sign-in returning tokens; signed-in Custom Tab | The contract pipeline and sign-in shape |
| **P1. Read** | Sign-in, Paddles list + one paddle, This phone screen, link-outs | Daily-use value; the shell, theme and tokens |
| **P2. Record** | Phone recorder → upload as a phone device → appears in Paddles | The phone as a tracker |
| **P3. Tracker** | Pair, setup, manual then automatic sync, tracker settings | The tracker's boathouse problem solved |
| **P4. Trials and sections** | Open trials, leaderboards, submit an entry (from a phone recording, Strava, a file or the library); race a section, compare, buddies | Native for the core of the site |
| **P5. Production** | Closed test with beta testers (≥14 days if personal account), store listing, then production | Real users |
| **P6. iPhone** | SwiftUI or Compose Multiplatform over `shared/`; TestFlight | Parity paid off |
| Later | Tracker updates over Bluetooth (after signed firmware), Health Connect, passkeys, Wear OS recorder over `shared/` | |

S1–S3 can run in parallel with P0. Their results may change P2/P3.

## Success measures

- Recordings lost or cut short on phones: target zero, with every recovery
  logged.
- Time from end of paddle to it showing in Paddles, phone and tracker.
- Share of tracker recordings arriving through the app versus WiFi.
- Crash-free sessions (Play vitals).
- From testers: setup completion, and whether "This phone" ever surprised them.

## Open questions

1. **Personal or organisation Play account?** Organisation needs a legal entity
   + D-U-N-S; personal needs 12 testers for 14 days before production. Who are
   the 12?
2. **iPhone UI: SwiftUI or Compose Multiplatform?** SwiftUI is the most native;
   Compose Multiplatform shares screens too (much less parity work, slightly
   less native feel). Decide before P6. Android is unaffected.
3. **Signed-in website pages from the app.** One-time code → cookies (proposed)
   or something else. Settle in S3.
4. **Phone stroke rate.** Usable from a phone in a bag or on a deck mount? S1
   decides whether the app shows it.
5. **Map tiles in an app.** Esri's terms and attribution for native use, or a
   different keyless source.
6. **App name on the store** and the package name (permanent).
