# Feature spec: iPhone app

🚧 **Spec — 2026-10-24. P0 and P1 built; S1, S2 and P2 on need a real iPhone.** How to work on it: [`mobile/ios/README.md`](../../mobile/ios/README.md).

The native iPhone app: Swift + SwiftUI, iOS 17 and up, distributed through
TestFlight and the App Store. What it shares with the Android app (the
decisions, the API schema, the fixtures, the tokens and the server changes) is
in [`mobile-apps.md`](mobile-apps.md). Read that first. This file covers only
the iPhone side. The Android twin is [`android-app.md`](android-app.md).

Plain Swift throughout: no Kotlin Multiplatform, no cross-platform UI. Models
are generated from `mobile/contract/api/`, colours and type from
`mobile/contract/tokens/`, and the tests check `mobile/contract/fixtures/`.

## Newer features, and saying what's missing

Floor: **iOS 17**. Built with the newest Xcode and SDK, so system parts (tab
bar, navigation bars, sheets) take each version's current look automatically,
including Liquid Glass on iOS 26, while our own content keeps the paddlesnitch
dark design system.

The same **capability list** idea as Android: one table in code says, for each
feature, what it needs (iOS version, hardware, permission) and what happens
without it.

- A **"This iPhone"** screen (Settings) lists every feature as works / needs
  iOS N / needs permission → *fix* (opens the right Settings page).
- The same list drives the screens: a feature the phone can't do is explained
  where you'd look for it, never silently missing.

First entries (confirm against the docs during the spikes):

| Feature | Needs | Without it |
|---|---|---|
| Recording on the lock screen as a Live Activity, with a stop button | iOS 17 (all supported phones); Dynamic Island on iPhone 14 Pro and later | — |
| Start/stop a paddle from the Action button | iPhone 15 Pro and later (App Shortcut) | Lock screen / Live Activity / in app |
| Start/stop from Control Centre and the lock screen controls | iOS 18+ | Live Activity and in app |
| Pair the tracker with the system's own sheet, no Bluetooth permission prompt | iOS 18+ (AccessorySetupKit) | Our own scan screen + the Bluetooth permission prompt |
| Tracker syncs on its own when nearby | Bluetooth background mode + state restoration (iOS 17) | — (stops if the user force-quits the app; the screen says so) |
| Save paddles to Apple Health as a paddling workout with its route | HealthKit permission | Hidden until asked for |
| Notifications (sync done, recording recovered) | Permission | Asked for when first useful; works without |
| Passkeys | Shared question, later | Email code / password |

## Recording

The format and upload are fixed by the recording contract in
[`mobile-apps.md`](mobile-apps.md). On iPhone:

- Recording is **started on screen** and carries on with the screen off using
  the `location` background mode and a background activity session
  (`CLBackgroundActivitySession`, iOS 17). That needs only **"While Using"**
  location permission, never "Always", and shows the system's blue location
  indicator, which is honest about what's happening. App Review checks this.
- GPS at 1 Hz from `CLLocationUpdate.liveUpdates` with the fitness activity
  type and best accuracy. Accelerometer + gyro from Core Motion, reduced to the
  sidecar's 10 Hz.
- Every fix is appended and flushed. iOS doesn't relaunch an app killed while
  recording on "While Using" permission, so on the next open the app recovers
  the file and says "recording recovered, gap 0:42". The Live Activity ends
  with that state so the lock screen never lies.
- **The risk differs from Android's.** iOS doesn't have phone makers killing apps,
  but it does end background work under memory pressure and when the battery
  is low. S1 measures how often that happens on a 2-hour paddle.
- Wet hands, drybag: big targets, start/stop from the Live Activity, Action
  button and Control Centre where the phone has them, "hold to stop".
- The upload queue uses a background `URLSession`, so iOS finishes an upload
  even if the app is suspended, and retries on the next launch until the
  server has it.

## Pairing and syncing the tracker

The protocol is fixed by the tracker sync contract and its fixtures. On iPhone:

- **Pairing** goes through **AccessorySetupKit** on iOS 18+ (the system's "Set
  up PT-17C?" sheet, scoped to our tracker only, no general Bluetooth prompt).
  On iOS 17 it falls back to an in-app scan for the tracker's service UUID.
- **Background sync:** `bluetooth-central` background mode with state
  restoration. The app keeps a pending connection to the paired tracker. iOS
  holds it indefinitely, connects when the tracker comes into range, and wakes
  the app to sync. That's the iPhone's "syncs at the boathouse".
- iOS hides the tracker's MAC address and gives each phone its own identifier
  for it, so the app identifies the tracker by its `deviceId` characteristic,
  never by the iOS identifier.
- Encrypted characteristics trigger iOS's own pairing prompt on first read.
  The tracker sends Service Changed after a firmware update, and the app
  re-discovers services when `BLE_LAYOUT` differs.

## Sign-in (iPhone side)

- Server side is in [`mobile-apps.md`](mobile-apps.md) (C2).
- The refresh token lives in the **Keychain** (this device only, after first
  unlock). The app refreshes the ID token itself.
- Strava sign-in runs in `ASWebAuthenticationSession`. The callback returns
  through a verified **universal link** (`/.well-known/apple-app-site-association`,
  `applinks`), and the app swaps the one-time code for tokens.
- The same file also declares `webcredentials`, so iOS offers saved
  paddlesnitch.com passwords and suggests strong ones at sign-up.
- Website link-outs open in `SFSafariViewController`, signed in through the
  shared one-time-code proposal (C4).
- **Sign in with Apple** may be required by App Review guideline 4.8 because
  of Strava sign-in. That's shared open question 3 in
  [`mobile-apps.md`](mobile-apps.md); if needed it arrives through C2.

## Code and project

```
mobile/ios/
  project.yml              XcodeGen: the Xcode project is generated, not hand-merged
  Makefile                 Every command, local and CI: generate, test, lint
  App/                     The app target: SwiftUI screens, navigation, wiring only
  Packages/PaddleKit/      One local Swift package, one target per area:
    DesignSystem             Generated tokens, IBM Plex, shared SwiftUI components (P0)
    ContractGen(Kit)         contract-gen: mobile/contract/ → Swift (P0)
    PaddleAPI                Generated models + a small tRPC/REST client, auth, token refresh
    Recorder                 Location + motion → tracker CSV + _i10 sidecar, crash recovery
    TrackerLink              Tracker Bluetooth protocol over a CoreBluetooth abstraction
    UploadQueue              Background URLSession uploads, retries, receipts
    Capabilities             The capability list behind "This iPhone"
  Tests/UI/                XCUITest flows
```

Targets are added when their phase starts, not ahead of it. Generated Swift
is committed, and a package test fails while it differs from what
`mobile/contract/` would generate (the same rule as the web's
`pnpm mobile:contract` check).

- **Swift 6 language mode** with complete concurrency checking: data races are
  compile errors.
- **SwiftUI + Observation** (`@Observable`, iOS 17), `NavigationStack`,
  async/await throughout. No third-party UI or state framework.
- **Logic lives in packages, screens stay thin.** The packages have no UIKit
  or SwiftUI dependency where they can avoid it, so their tests run with
  `swift test` on the Mac in seconds, without a simulator.
- **Models from the contract.** `contract-gen` (our own, in `PaddleKit`)
  turns `mobile/contract/api/` JSON Schema into `Codable` Swift structs.
  quicktype was the alternative, but it handles the contract's tuples and
  `kind` unions poorly. `swift-openapi-generator` doesn't fit, because the
  contract is JSON Schema over tRPC, not OpenAPI. The tRPC transport is about a
  hundred lines of our own.
- **Maps: MapKit** (SwiftUI `Map` with route polylines, dark muted style). It's
  native, free, and keeps the Esri tile question on Android only. The colour
  ramps for speed and stroke rate come from the generated tokens, so the
  routes match the web.
- **Dependencies kept minimal:** swift-snapshot-testing (tests only).
  Everything else is Apple's own frameworks.
- **Accessibility from the start:** Dynamic Type, VoiceOver labels on every
  control and chart, 44 pt targets (the web's rule too).

## Distribution: TestFlight and the App Store

**Build first, distribute later** (owner decision 2026-10-24, matching
Android's sideload-first plan). Until there are testers:

- The **simulator** needs no Apple account. CI builds and runs every test on
  simulators without one.
- On the owner's own iPhone, Xcode installs with a **free Apple ID** ("personal
  team"). Builds expire after 7 days and can't use universal links (so Strava
  sign-in waits; email and password work), but background GPS and Bluetooth
  work, which is all S1, S2 and P3 need.
- The paid membership below starts at **P5**, when other people should test.

When it's time:

- **Apple Developer Program** (US$99/yr), **Individual** enrolment unless the
  owner wants a company name on the store (Organisation needs a legal entity +
  D-U-N-S). Unlike Play, there's **no minimum testers/days** before release.
- **Bundle ID:** `com.paddlesnitch.app` (decided 2026-10-24, the same as the
  Android package name; permanent).
- **Tracks.** TestFlight internal (up to 100 team members, no review, live in
  minutes) → TestFlight external (up to 10,000 testers by link; the first build
  of each version gets a short beta review) → App Store. **Every merge to
  `main` that touches `mobile/ios/` goes to TestFlight internal**, and
  promotion is a manual workflow, as on Android and firmware.
- **CI:** GitHub Actions macOS runners (free, since the repo is public),
  `.github/workflows/ios.yml`. Runner images lag Xcode releases (Xcode 26.6
  there while 27 is current) and ship no iOS 17 simulator, so the iOS 17 job
  downloads one, and the code must build with both the runner's Xcode and
  the newest. Until
  P5 CI only builds and tests, so it needs no secrets. From P5, signing uses Xcode's cloud-managed certificates and an App Store Connect API key
  in a protected GitHub environment. Apple has no OIDC equivalent, so this one
  key is unavoidable; it is limited to the App Manager role. Xcode Cloud is the
  fallback if macOS runners become a problem.
- **What App Review needs**, all before the first external TestFlight:
  - purpose strings for location (While Using only), motion, Bluetooth, Health;
  - a justification for the `location` and `bluetooth-central` background
    modes (the reviewer has to see why; a short note + video);
  - the App Privacy labels (location, motion, account email; nothing sold or
    tracked; heart rate never collected) and a **privacy manifest**
    (`PrivacyInfo.xcprivacy`) declaring the required-reason APIs we use;
  - account deletion **started in the app** (guideline 5.1.1(v)): an in-app
    entry that opens the existing web erasure flow;
  - privacy policy URL (`/privacy`, updated for the apps and phone sensors);
  - the shared **store-review account** (password sign-in, seeded in
    production; see server changes in [`mobile-apps.md`](mobile-apps.md)), its
    credentials in the review notes, never in the repo;
  - export compliance: standard HTTPS only (`ITSAppUsesNonExemptEncryption = NO`);
  - age rating questionnaire.

## Testing (iPhone)

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| Package unit tests | Swift Testing (`swift test`) | CSV writer and recovery, Bluetooth protocol, receipts, upload queue, token refresh, capability list | Mac, seconds, every PR |
| Contract tests | Swift Testing over `mobile/contract/` | Generated models decode every fixture response; recorder output matches the golden CSV byte for byte; Bluetooth exchanges match the protocol fixtures | Every PR |
| Recorder replay | Swift Testing | Recorded location + motion input played through `Recorder` → expected files, including a kill mid-recording | Every PR |
| Fake tracker | Swift Testing | `TrackerLink` against a fake peripheral driven by the same fixtures as the web's fake tracker | Every PR |
| Snapshot tests | swift-snapshot-testing | Every screen, dark, at default and largest Dynamic Type, iOS 17 and newest | Every PR |
| UI flows | XCUITest | Sign in, Paddles → one paddle, record (simulated GPS route), This iPhone, link-outs; against a stubbed server, plus one smoke run against `pnpm dev` | Simulators: iOS 17 + newest |
| Accessibility | XCUITest `performAccessibilityAudit()` | Labels, contrast, target sizes, Dynamic Type clipping | Every PR |
| By hand on a real iPhone | — | 2-hour screen-off recording in a drybag, Bluetooth with the real tracker, Live Activity, background sync | Each spike + before each external TestFlight |

Lint: SwiftLint + swift-format in CI. A PR touching `mobile/ios/` doesn't merge
red.

**The simulator can't do Bluetooth, the motion sensors or real background GPS.**
Everything above the "by hand" row runs without a phone, because those parts
sit behind protocols with fakes. The spikes and the final checks need a real
iPhone, and the owner doesn't have one yet (proposal: a used iPhone 12/13/SE 3rd
gen, all of which run the newest iOS; the simulator covers iOS 17).

## Phases

Mirrors Android's so the two apps meet at the same contract phases.

| Phase | What | Proves | Needs a real iPhone |
|---|---|---|---|
| **P0. Project + CI** ✅ | XcodeGen project, `PaddleKit` package, `contract-gen` for tokens, placeholder icon, CI build + tests on iOS 17 and newest simulators, lint | We can build and test | No |
| **S1. Recording spike** | Throwaway: 2 h screen-off in a drybag; While Using + background session; sidecar → `deriveCadence` | The iPhone can be a tracker; whether stroke rate is possible | **Yes** |
| **S2. Tracker spike** | AccessorySetupKit pairing (iOS 18) / scan (iOS 17) + one background sync from the real tracker, with receipt | Sync with nothing pressed works on iPhone | **Yes** |
| **S3. API spike** | Generated models + client for two procedures over C1 ✅ (`PaddleAPI`); token sign-in over C2 | The contract and sign-in shape | No |
| **P1. Read** ✅ | Paddles list + one paddle (MapKit; speed legend, efforts and rests, and 500 m splits as on Android; a paddle saved without its summary writes it on opening), You tab with link-outs, IBM Plex bundled, sign-in (password + create account, Keychain, refresh), the needs-Terms notice | Daily-use value; shell and theme | No |
| **P1b. Native account** (C5) | Add a paddle from a file ✅ (the file picker, and GPS files opened from Files, Mail, AirDrop or a share sheet; a file opened while signed out is added after sign-in); then accept Terms, details and handle, download your data, delete account, trackers, forgot password, Strava (mobile-apps.md, the owner's 2026-10-25 note) | The Account pages leave the website | No |
| **P2. Record** | Recorder → upload as a phone device → appears in Paddles; Live Activity; the "This iPhone" screen, arriving with the first feature it describes | The phone as a tracker | For sign-off |
| **P3. Tracker** | Pair, setup, manual then automatic sync, tracker settings | The boathouse problem solved | **Yes** |
| **P4. Trials and sections** | Open trials, leaderboards, submit an entry; race a section, compare, buddies | Native for the core of the site | No |
| **P5. App Store** | Developer Program enrolment, signed CI → TestFlight internal, then external with the tracker beta group; `apple-app-site-association` with the team ID; store listing, review, release | Real users | For sign-off |
| Later | Apple Health workouts, Control Centre controls, passkeys, tracker updates over Bluetooth (after signed firmware) | | |

S3, P0 and P1 start now on the simulator. S1/S2 wait for a phone, which
puts the iPhone's biggest risks later than Android's. Buying the phone early
closes that gap.

## Open questions (iPhone)

1. **A test iPhone:** which one, and when. It blocks S1, S2 and P3.
2. **Individual or Organisation** developer enrolment (decide at P5).
3. **App icon.** P0 ships a placeholder ("ps" on the dark background). The
   web has no icon to reuse yet; a real one is needed before P5.

Sign in with Apple and the app's store name are shared questions, in
[`mobile-apps.md`](mobile-apps.md).
