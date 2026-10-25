# Feature spec: mobile apps (shared contract)

🚧 **Spec — 2026-10-24. C1 (contract pipeline) built 2026-10-25; the rest not built.**

paddlesnitch gets two native apps, **Android** and **iPhone**, built side by
side. Wear OS comes much later. On both platforms the phone works as a **tracker** (records a paddle on its own) and
as a **companion** to the hardware tracker (pairs it, sets it up, brings its
recordings home over Bluetooth). It also shows the main things on
paddlesnitch.com: paddles, trials, sections.

This file holds **only what both apps share**: the decisions, the contract
they must both honour, and the server changes. Each platform has its own spec:

- [`android-app.md`](android-app.md): Kotlin + Jetpack Compose, Android 10+,
  Google Play.
- [`ios-app.md`](ios-app.md): Swift + SwiftUI, iOS 17+, App Store (written by
  the iOS session).

This replaces the earlier Expo plan
([`unified-app-and-api.md`](unified-app-and-api.md) Phase 4,
[`tracker-bluetooth-sync.md`](tracker-bluetooth-sync.md) P6/P7 and its open
question 1).

## Decisions taken (2026-10-24, by the owner)

| Question | Decision |
|---|---|
| Expo or native | **Native** on each platform |
| iPhone | **Yes, soon.** Built in parallel with Android |
| How the apps share work | **Shared contracts, not shared code.** Each app is written fully natively (Kotlin/Compose; Swift/SwiftUI). They share a generated API schema, golden test fixtures and design tokens, and both must pass the same fixtures. Kotlin Multiplatform was considered and **not** chosen |
| Oldest versions | Android 10 (API 29); iOS 17. Newer features switch on where the phone has them, and the app says what's missing |
| What's in the apps | **Native screens** for the main things, trial upload and race-a-section included. Rarely used admin pages open the website |
| Distribution | Google Play and the App Store, through their test tracks first. Android starts with direct installs on the owner's phone; the Play account (personal) comes after |
| App id | `com.paddlesnitch.app` on both stores (permanent) |
| Watch | Later, Wear OS only |

## Goals

- Record a paddle on the phone with the screen off, in a drybag, for hours, and
  never lose it.
- Pair a tracker in a minute and then forget about it: recordings arrive in
  Paddles whenever the phone is near, no WiFi needed.
- Feel like a current app on each platform's newest version, and work properly
  on the oldest supported one.
- Keep web, Android and iPhone in step **without** building every feature
  three times, and catch drift automatically.

## Not in scope

- Doing analysis on the phone. The server stays the only place that works out
  splits, stroke rate, summaries and race results.
- Offline browsing of the library beyond a small cache.
- Live stroke rate while recording (waits for the tracker's on-device work,
  `tracker-bluetooth-sync.md` P8).
- Course drawing, group admin, account export/erasure, the river planner and
  games as native screens. These open the website.
- Wear OS / watchOS.

## How parity stays cheap

1. **One recording format for every recorder.** Both phones write **exactly
   the tracker's CSV** (same columns, see [`device-uplink.md`](device-uplink.md))
   plus the same `_i10.csv` motion sidecar, and upload through the same session
   handling (`lib/session-upload.ts`). So `parseTrace`, `deriveCadence`, the
   device data page and the analysis need no change, and server improvements
   reach tracker, Android and iPhone together.
2. **The server does the thinking; the apps only show it.** Neither app
   re-implements timing or analysis.
3. **Shared contracts, native code.** Each app writes its own API client,
   sign-in and token refresh, upload queue, recording writer and tracker
   Bluetooth protocol, in its own language and idioms. What they share is
   language-neutral and lives in `mobile/contract/`:
   - the **API schema** (JSON Schema, generated from the server), from which
     each app generates its own models;
   - **golden fixtures** (JSON + sample files) for the CSV format, the tracker
     Bluetooth protocol and receipts, which the web's TypeScript tests, both
     apps' tests and the firmware host tests all check;
   - the **design tokens**, generated from `@paddlesnitch/ui/tokens.css` into
     Kotlin and Swift.
   The source of truth is always the JSON and fixtures, **never** one app's
   source code.
4. **The contract is generated and checked in CI.** A server change that
   breaks either app fails CI, not someone's phone.
5. **Same features, same names.** Both apps follow the same screen list (below)
   and the same capability-list idea ("This phone" / "This iPhone"), so the
   platforms differ only where the operating system does.

## What's native, what opens the website (both apps)

| Native | Opens the website (in-app browser, still signed in) |
|---|---|
| Sign in / sign up (email code, password, Strava) | Group admin, invitations, join requests |
| Paddles list, one paddle (map, speed/rate, splits, summary, note, boat) | Drawing or editing a course; opening a trial |
| Record a paddle | Account: export, delete, handle, public profile, terms |
| Trackers: pair, set up, sync, settings | River planner, games, help |
| Trials: open trials, leaderboard, submit an entry | |
| Race a section, compare, buddies' paddles | |
| This phone, app settings | |

## Recording contract (both phones)

- Output is the tracker's CSV + `_i10.csv` sidecar, byte-compatible with what
  `describeDeviceData` and `parseTrace` accept. A golden fixture holds a short
  phone recording each app must reproduce from recorded sensor input.
- **Never lose a paddle:** every fix is appended and flushed as it arrives; a
  killed app resumes and says "recording recovered, gap 0:42".
- **Phone as a device.** The first time a phone records, it registers itself as
  a device on the account (`model: phone-android` / `phone-ios`), so its
  paddles behave like a tracker's: same duplicate checks, pieces, compression
  and data page. It uploads **as the signed-in user** (no device token on the
  phone) through the account route that already relays tracker recordings,
  `POST /api/account/devices/{deviceId}/sessions`, extended to accept a phone
  device (no receipt needed). Uploads are queued and retried until the server
  has them.
- **Stroke rate from a phone** is unknown. Each platform's recording spike
  measures it; show an honest verdict, never fake it.

## Tracker sync contract (both phones)

Reuses what the browser already proved
([`tracker-bluetooth-sync.md`](tracker-bluetooth-sync.md), #346/#353/#355):

- The same GATT layout and `BLE_LAYOUT` version, captured as fixtures.
- The **device token never crosses Bluetooth.** The phone uploads as the user
  through the relay route and hands the server's receipt back; the tracker
  marks a recording sent only on a valid receipt.
- Partly sent files resume from the pieces the server already holds
  (`GET …/sessions?filename=`).
- Updates over Bluetooth wait for signed firmware (Bluetooth spec P3).

## Server changes (shared by both apps)

- **Bearer on REST** ✅ (2026-10-25). `getRequestUser(req)` in
  `@paddlesnitch/core/auth`: a Bearer Cognito ID token, else the website's
  cookie. A Bearer header that isn't a valid ID token is null, never a cookie
  fallback, and a tracker's device token never signs in a person. Used by tRPC
  and by the REST routes the apps call: the trial reads (list, one trial,
  leaderboard, can-submit) and trial upload, every `/api/account/devices/*`
  route, and paddle upload (`POST /paddles/api/analyse`). Organiser
  mutations (create/edit trials, courses, groups) and account settings stay
  cookie-only; the apps open the website for those. `src/proxy.ts` lets a
  Bearer-signed call to `/att/api/*` or `/api/account/*` past its cookie
  check (pages still need the cookie). Tests: `src/tests/mobile-bearer.test.ts`.
- **Token-returning sign-in ✅.** The website's own sign-in routes, through the
  same code (anti-bot gate, terms acceptance, pending invitations): a call with
  the `x-paddlesnitch-app: <platform>/<version>` header gets the ID + refresh
  tokens in the answer and no cookies (`signedInResponse` in
  `@paddlesnitch/core/auth`; the website's answers never carry a token). Covers
  password sign-in, sign-up, the email code and the password-reset confirm.
  `POST /att/api/auth/refresh {refreshToken}` → `{idToken}` (401: sign in
  again), and `POST /att/api/auth/logout {refreshToken}` revokes it. How to call
  them: `mobile/contract/README.md`. Tests: `src/tests/mobile-signin.test.ts`.
- **Strava sign-in from an app ✅ (2026-10-25):** the in-app browser (Custom
  Tab / `ASWebAuthenticationSession`) runs the existing flow with a PKCE
  challenge (`strava/init?challenge=`); the callback sends a **one-time code**
  to the app's own scheme, `com.paddlesnitch.app:/signin/strava?code=`, and the
  app swaps code + verifier at `POST /att/api/auth/strava/app-token`. Tokens
  never appear in a URL; a code works once, for 5 minutes, and only with the
  verifier (`apps/web/src/lib/app-signin.ts`, tests
  `src/tests/strava-app-signin.test.ts`). **Changed from the plan's verified app
  link:** a custom scheme hands back reliably from both in-app browsers, works
  in debug builds, and needs no Apple team ID, so iPhone Strava sign-in doesn't
  wait for P5; PKCE is what makes an intercepted code useless (RFC 8252).
  `apple-app-site-association` (for `webcredentials`, saved passwords) still
  waits for the team ID. How to call it: `mobile/contract/README.md`.
- **Signed-in website pages from the apps:** proposal is a one-time code
  handed to the in-app browser, which a web route turns into the usual cookies.
- **Phone devices** on the relay route (above).
- **Minimum supported app version**, per platform. Below it the app asks the
  user to update.
- **A store-review account.** App Review and Play review both need to sign in.
  SES is still in sandbox, so email codes don't reach reviewers. Keep a
  reviewer account that signs in with a **password**, seeded in production,
  with a few sample paddles, and its credentials in both stores' review notes
  (never in the repo).

## API contract

- tRPC **inputs** are already zod. **Outputs** are inferred TypeScript types,
  so every procedure the apps use gets a zod output schema in
  `packages/api/src/contract.ts`, listed in `contractProcedures`.
- Those schemas are **not** attached with `.output()`. Stored paddles go back
  years and some lack fields the types now have (the tests themselves write
  partial ones), so runtime output validation could turn old data into a 500 on
  the website. Instead, type checks in `contract.ts` fail `pnpm typecheck` when a
  schema and the procedure's real output type differ in any way (a field added,
  removed, retyped, or made optional), and the contract test checks real
  answers against the schemas.
- `pnpm mobile:contract` writes JSON Schema (draft-07, via zod v4's
  `z.toJSONSchema`) into `mobile/contract/api/`, one file per named type plus
  `procedures.json`, and the tokens into `mobile/contract/tokens/`. The output is committed;
  `src/tests/mobile-contract.test.ts` fails in `pnpm test` while it's stale.
  Schemas never forbid extra fields, so a new server field can't break an old
  app. REST routes the apps call get the same treatment when the apps need them.
- Timestamps carry `format: date-time`, whole numbers are `integer`, and every
  object union is discriminated by a `kind` constant. Both apps decode an
  unknown enum value or union kind to an `unknown` case and never throw, so the
  server can add values as well as fields. Golden answers per procedure live
  in `mobile/contract/fixtures/api/` (one deliberately full of unknown values),
  checked against the schemas in `pnpm test` and decoded by both apps' tests.
- The format the apps read is written down in
  [`mobile/contract/README.md`](../../mobile/contract/README.md), with tests
  that the HTTP answers really look like that.
- Both clients speak tRPC's plain HTTP form (queries `GET
  /api/trpc/<path>?input=…`, mutations `POST`, answers `{ result: { data } }`).
  The router has no transformer, so it stays **plain JSON**; keep it that way.
  No batching.
- **Changes are additive only** while any app version in use relies on a
  field. Combined with the minimum-version check, that's how old apps keep
  working.

## Layout

```
mobile/                 NOT a pnpm workspace package (like firmware/)
  contract/             Shared, language-neutral, committed:
    api/                  generated JSON Schema (tRPC + REST)
    fixtures/             CSV, Bluetooth protocol, receipts — golden files
    tokens/               design tokens as JSON (generated from tokens.css)
  android/              Gradle project — see android-app.md
  ios/                  Xcode project — see ios-app.md
```

**Changing the contract:** whoever changes a schema, fixture or token format
updates the generator, regenerates, and makes both apps' tests pass (or files
the follow-up for the other platform in the same PR). Sessions working on one
platform tell the other when the contract or fixture formats change.

## Testing (shared)

- Server: tests for every REST route that gains Bearer auth, the mobile sign-in
  routes, phone devices on the relay route, and a contract test that the
  committed schema matches the routers.
- Fixtures: the web's tests and the firmware host tests check the same
  fixtures as both apps. A fixture change that one implementation fails is a
  real parity bug.
- Platform tests: in each platform spec.

## Phases (shared track)

| Phase | What | Needed by |
|---|---|---|
| **C1. Contract pipeline** ✅ | Schemas for `me`, `paddles.list` (cards with note / no-GPS / same outing, totals, logbook — all worked out on the server), `paddles.get`; `pnpm mobile:contract`; freshness + drift checks; tokens → JSON | Both apps' first screens |
| **C2. Sign-in** (Bearer on REST ✅) | `getRequestUser`, token-returning sign-in, Strava one-time code, app-link files | Both apps' sign-in |
| **C3. Recording + sync** | Phone devices on the relay route; CSV + Bluetooth + receipt fixtures from the existing web code and firmware | Both apps' recording and tracker phases |
| **C4. Signed-in website pages** | One-time code → cookies | Both apps' link-outs |

Platform phases (spikes, screens, store releases) are in each platform spec.
They run in parallel and meet only at this contract.

## Success measures

- Recordings lost or cut short on phones: target zero.
- Time from end of paddle to it showing in Paddles, per route.
- Share of tracker recordings arriving through an app versus WiFi.
- Contract drift caught in CI before a release, not after.

## Open questions (shared)

1. **Signed-in website pages:** one-time code → cookies, or something else.
2. **Phone stroke rate:** usable from a phone in a bag or on a deck mount?
   Each platform's spike reports.
3. **Sign in with Apple.** App Review guideline 4.8: an app offering a
   third-party login (Strava) must also offer a privacy-focused one. If our own
   email-code sign-in doesn't count, Sign in with Apple becomes a Cognito
   identity provider, a shared server change in C2 (and it would show on
   Android and the web too, if we want sign-in options to match).
4. **App name on the stores.** (The id is decided: `com.paddlesnitch.app` on
   both, as the Android package name and the iOS bundle ID.)

Maps are per platform: MapKit on iPhone; the tile question is Android's
([`android-app.md`](android-app.md)).
