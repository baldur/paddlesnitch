# mobile/contract

What the Android and iPhone apps share with the server and with each other
([`docs/features/mobile-apps.md`](../../docs/features/mobile-apps.md)). It is
language-neutral: each app generates its own Kotlin or Swift from these files,
and neither app's source is ever the reference.

| Folder | What | Made by |
|---|---|---|
| `api/` | JSON Schema (draft-07) for every procedure the apps call, plus `procedures.json` | `pnpm mobile:contract`, from `packages/api/src/contract.ts` |
| `tokens/` | Colours, radii and font families | `pnpm mobile:contract`, from `packages/ui/src/tokens.css` |
| `fixtures/api/` | Golden answers per procedure, which both apps must decode | By hand, from synthetic paddles run through the real analysis; checked against the schemas by `pnpm test` |
| `fixtures/tracker/` | The tracker's Bluetooth protocol: UUIDs, layout, what each item replies, what each write sends, DATA pages, upload receipts, the waits | By hand, from `firmware/include/ble_about.h`, `firmware/src/ble.cpp` and the website's `lib/tracker-ble.ts`; checked against all three by `pnpm test`. See its README |
| `telemetry.md` + `fixtures/telemetry/` | The `x-paddlesnitch-app` header on every request, `app_open`, and crash reports sent on the next start | By hand; replayed against the real endpoint by `pnpm test` |
| `fixtures/` (rest) | Recording CSV | Phase C3 (not yet) |

**Don't edit `api/` or `tokens/` by hand.** Change the source, run
`pnpm mobile:contract`, commit the result. `pnpm test` fails while they differ.

## api/

- One `<Type>.schema.json` per named type. Types refer to each other by file
  name (`"$ref": "BoatClass.schema.json"`).
- `procedures.json` maps each tRPC path to `{ kind, auth, input, output }`:
  `kind` is `query` or `mutation`, `auth` is `public` or `user` (needs
  `Authorization: Bearer <Cognito ID token>`), and `input`/`output` name a type
  (`input: null` = takes nothing).
- Timestamps are strings with `"format": "date-time"` (ISO 8601). Whole
  numbers (counts, seat numbers, Strava ids) are `"type": "integer"`; every
  other number is a double.

### Rules both apps follow

1. **Ignore fields you don't know.** Unnamed fields are allowed everywhere; the
   server only ever adds fields.
2. **Never throw on an unknown enum value or union kind.** A newer server may
   add a source type, a boat class, a segment kind or a `NoPaddleReason`. Decode
   it into an `unknown` case and carry on. `fixtures/api/paddles.get.unknown-values.json`
   has one of each (plus an unknown field); both apps' tests must decode it.
3. **Unions of objects are discriminated by `kind`.** Every `oneOf` variant is an
   object with a `kind` string constant, so it maps to a Kotlin sealed type or a
   Swift enum with associated values. `pnpm test` enforces this. Two
   shapes are mapped by hand instead: the `[lat, lng]` tuples (arrays with
   `items: [...]`) and `Seat` (`integer` or `"C"`).

### Calling a procedure

Plain JSON over HTTPS, no batching:

```
query     GET  /api/trpc/paddles.get?input=<url-encoded JSON of the input>
mutation  POST /api/trpc/<path>   body: the input as JSON
answer    200  { "result": { "data": <output> } }
error     4xx/5xx  { "error": { "message": …, "code": …, "data": { "code": "NOT_FOUND" | "UNAUTHORIZED" | … } } }
```

A query with no input omits `?input=`.

## Adding a paddle from a file

`POST /paddles/api/analyse` with `Authorization: Bearer`, as `multipart/form-data`
with one part, `file` (GPX, FIT, TCX, CSV, SpeedCoach CSV, or a zip of one; the
file name's extension picks the parser). In `rest.json` its `input` is `null`
for that reason. The answer is the whole analysis; the apps need only
`Analysed`: the paddle's `id`, and `duplicate: true` when that paddle was
already there (the existing one is returned, nothing is added). 422 is a file
that can't be read, with the reason in `error`.

**Size:** a request can be at most about 4.6 MB (AWS's limit, before our code
runs: the answer is a 413 that is not an `ApiError`). Do what the website does
(`apps/web/src/lib/trace-upload.ts`): gzip a GPX, TCX or CSV file of 1 MB or
more and send it as `<name>.gz` (the server unpacks it; text traces shrink
about ten times), and stop anything still over 4,400,000 bytes on the phone
with the website's words: "That file is too big to upload. Export the activity
as FIT, which is much smaller, or as a Garmin .zip." Treat a 413 the same way.

## Signing in

REST, not tRPC. Send `x-paddlesnitch-app: <platform>/<version>` (e.g.
`android/0.1.0`) on every sign-in call: the answer then carries `idToken` and
`refreshToken` instead of setting cookies. Keep the refresh token in the
platform's secure storage; send the ID token as `Authorization: Bearer` on
every API call.

The types are in `api/` like the rest (`SignIn`, `OtpSession`, `Refreshed`,
`Ok`, `ApiError`; inputs `Login`, `OtpRequest`, `OtpVerify`, `Signup`,
`RefreshToken`, `StravaAppToken`), and `api/rest.json` maps each `"<METHOD> <path>"` to its
`auth` (`user` = send `Authorization: Bearer`), input, output and the statuses
that answer an `ApiError`. Golden answers:
`fixtures/api/auth.*.json`. `needsTerms` is missing on sign-up (the account has
just accepted the Terms).

| Call | Body | Answer |
|---|---|---|
| `POST /att/api/auth/login` | `{email, password}` | `{id, email, displayName, needsTerms, idToken, refreshToken}`; 401 wrong password |
| `POST /att/api/auth/otp-request` | `{email, website: "", elapsedMs}` | `{session}`: emails a 6-digit code (makes the account if new) |
| `POST /att/api/auth/otp-verify` | `{email, session, code}` | as login; 400 with a new `session` if the code was wrong but tries remain |
| `POST /att/api/auth/signup` | `{email, displayName, password, acceptedTosVersion}` | 201, as login; 422 if `acceptedTosVersion` isn't current |
| `POST /att/api/auth/strava/app-token` | `{code, verifier}` | as login; 401 = the code is spent or expired, start again |
| `POST /att/api/auth/refresh` | `{refreshToken}` | `{idToken}`; 401 = sign in again |
| `POST /att/api/auth/logout` | `{refreshToken}` | `{ok: true}`; the refresh token stops working |
| `POST /att/api/auth/password-reset/request` | `{email, website: "", elapsedMs}` | `{ok: true}` whether or not the account exists (it never says); if it does, a 6-digit code goes to that email |
| `POST /att/api/auth/password-reset/confirm` | `{email, code, password}` | `{ok: true, signedIn: true, idToken, refreshToken}`: signed in with the new password (then ask `me` for the name). `signedIn: false` = set, but sign in again. 400 with `error` for a wrong or expired code or a weak password |

**Website pages, signed in.** For a page only the website has (account
details, delete account…), `POST /att/api/auth/web-code {next: "/account#delete"}`
with the Bearer token answers `{url}`; open it in the in-app browser within a
minute. It works once and signs the website in as the app's person.

**Strava.** Make a PKCE verifier (32 random bytes, base64url without padding)
and its challenge (`base64url(sha256(verifier))`, 43 characters). Open
`/att/api/auth/strava/init?challenge=<challenge>` in the system's in-app
browser (Android Custom Tab, iOS `ASWebAuthenticationSession` with callback
scheme `com.paddlesnitch.app`). It ends on
`com.paddlesnitch.app:/signin/strava?code=<code>` (or `?error=<key>`, the same
keys the website's `/signin?error=` shows). Swap the code and the verifier at
`strava/app-token` within 5 minutes; a code works once, and a wrong verifier
spends it. The app's own scheme, not an app link, so it works in debug builds
and on iPhone before the Apple team ID exists; the verifier is what makes a
code caught by another app useless (RFC 8252).

`website` and `elapsedMs` are the anti-bot fields the website's forms send: an
empty honeypot, and the milliseconds since the form appeared. A call that
fills `website` or arrives under 2 s is dropped while looking like a success,
so send the real time. `needsTerms: true` means an older account must accept
the current Terms before going on (the website's flow; the apps open it).
Every error answer has a human-readable `error`.

## Account

The Account screens (phase C5) call the website's `/api/account` routes with
`Authorization: Bearer` and no cookie. JSON in, JSON out; a GET's input goes in
the query string. Every refusal is an `ApiError`, and 401 means the ID token
is missing or expired: refresh it and try once more. Types are in `rest.json`;
golden answers are `fixtures/api/account.*.json`.

| Call | Body | Answer |
|---|---|---|
| `GET /api/account/tos` | | `{currentVersion, accepted, acceptances[]}` |
| `POST /api/account/tos` | `{version}`: `api/constants.json` `tosVersion` | `{acceptances[]}`; 422 if the version isn't current (the app is out of date) |
| `POST /api/account/export` | | `{url}`: a link to the whole file, valid 5 minutes, any size. Fetch it with no token (it carries its own permission) at once and hand it to the save dialog or share sheet. Locally it points at the dev server instead of S3, same shape |
| `GET /api/account` | | `{recentSignIn}`: ask when "Delete account" is tapped. False: show "For your safety, deleting your account needs a recent sign-in. Sign in again and you’ll come straight back here." and a Sign in again button (sign out, then sign in again: Strava sign-in when `placeholderEmail`, else the email prefilled), then come back to delete. True: ask them to type DELETE |
| `DELETE /api/account` | `{refreshToken}` | `{ok: true}`: everything is erased (safe to send again if the answer was lost) and the refresh token stops working. Drop the stored tokens and go to sign-in. 403 `{error, reauth: true}` when there's no real sign-in from the last 10 minutes (it ran out while they typed): go to the Sign in again step above. A silent token refresh doesn't count, and neither does a session a web-code link made |
| `GET /api/account/profile` | | `{public, handle?}` |
| `PATCH /api/account/profile` | `{public}` | as GET |
| `GET /api/account/handle?check=<handle>` | | `{available, slug?}` or `{available: false, reason}`: show `reason` as it is |
| `PUT /api/account/handle` | `{handle}` | as profile; 400 with the reason if it's taken or not allowed |
| `DELETE /api/account/handle` | | as profile, without `handle` |
| `GET /api/account/contact` | | `{contact: {email, addedAt} \| null}`: a contact email, for accounts made through Strava |
| `POST /api/account/contact` | `{email}` | as GET; 400 if it doesn't look like an email |
| `DELETE /api/account/contact` | | `{ok: true}` |
| `GET /api/account/devices` | | `{devices: Tracker[], stableVersion}`: each tracker, the version it should run (`targetVersion`; `beta: true` may be ahead of stable), its last report (`health`) and last crash |
| `DELETE /api/account/devices` | `{deviceId}` | `{ok: true}`: removed; it stops syncing and can be added again. Its recordings and paddles stay. 404 if it isn't this person's |
| `GET /api/account/devices/sessions` | | `{sessions: Recording[]}`: every recording the person's trackers uploaded, newest upload first (an old paddle synced late comes first), including removed trackers'. A recording with usable GPS also becomes a paddle in `paddles.list`; a desk test or one with no fix doesn't. Each also carries the owner's `userId` |

Your name and sign-in email come from `me`. Adding a tracker and syncing it
are in `fixtures/tracker/README.md`. Forgot password is under Signing in. Strava comes next in C5.

## fixtures/api/

**`index.json` says what each fixture is:** file name → `{call, schema}`.
`call` is a tRPC path or a `"<METHOD> <path>"` from `rest.json` (`null` for a
refusal every route in a group shares), and `schema` is the type to decode it
as: the call's output, or `ApiError` for a refusal. `fits: false` marks the one
fixture that deliberately breaks its schema (rule 2). Read this instead of
working it out from the file name; `pnpm test` keeps it complete.

`<procedure>[.<case>].json`, each the `data` of one answer: `me.signed-in`,
`me.signed-out`, `paddles.list`, `paddles.get` (`pdl-river`), `paddles.writeSummary` (`pdl-river` with its summary written),
`paddles.get.strava` (`pdl-strava`), `paddles.get.motion-only` (`pdl-motion`, a
paddle whose GPS failed: `result.noGps`), and `paddles.get.unknown-values`
(rule 2; deliberately does **not** fit the schema). The paddles are synthetic.

Sign-in answers are `auth.<route>[.<case>].json`: the answer of
`POST /att/api/auth/<route>` (`rest.json` gives its type). A fixture with an
`error` field is that route's `ApiError` instead (`auth.otp-verify.retry`: a
wrong code with tries left). `auth.error.json` is the refusal every sign-in
route shares. So far: `auth.login`, `auth.login.needs-terms`,
`auth.otp-verify.retry`, `auth.refresh`, `auth.error`.

Account answers are `account.<route>[-<what>][.<case>].json`: `account.tos`,
`account.tos-accepted`, `account.export`, `account.profile`(`.private`),
`account.handle-check`(`.taken`), `account.contact`(`.none`),
`account.devices`(`.none`), `account.devices-sessions`, and
`account.error` (the 401 every account route shares).

`paddles.list` is the Paddles screen as the website draws it, worked out on the
server: one card per outing (`pdl-river-watch`, the same outing from Strava,
sits under `pdl-river` in `sameOuting` and has no card of its own), the note,
`noGps` (draw the "no GPS" tag, never the route: a paddle that lost its GPS
part-way still has a route from before), the totals, and the `logbook` (12
weeks oldest first, weeks start Monday UTC). Totals and logbook count every
recording, as the website does.
Add a fixture whenever a real answer turns out to have a shape these don't.

`api/constants.json`: values the apps send exactly as the server expects:
`tosVersion`, the Terms version a new account agrees to (`Signup.acceptedTosVersion`).

## format/

`format.json`: how the website writes the numbers, dates and messages both
apps show. Function name → cases of `{ "in", "out" }`, where each `out` is what
the website's own function returned for `in` when `pnpm mobile:contract` ran.
Port each function and run it over every case. The inputs sit at the edges
where ports go wrong: rounding at :59.5, `toFixed` on 1.005 (round the exact
binary value, as JavaScript does, not the shortest decimal), `toFixed` on an
exact tie like 0.125 or 2.25 (JavaScript rounds up; C's printf rounds to
even), 22.5° on the compass.

| Function | `in` | What it is |
|---|---|---|
| `fmtDur` | seconds | `m:ss`, rounded first; minutes go past 59 |
| `fmtClock` | seconds | `m:ss`, or `h:mm:ss` from an hour |
| `split500` | speed, m/s | pace per 500 m via `fmtDur`; `—` at 0.2 m/s or slower |
| `fmtWeekday` | ISO timestamp | `Sun, 13 Sep 2026` in UTC; unparseable → as given |
| `fmtMonth` | ISO timestamp | `Sep 2026` in UTC; unparseable → as given |
| `paddleKm` | `{distanceKm, noGps?}` | `4.25 km`; `—` for a paddle without a map |
| `compassPoint` | degrees the wind blows from | one of N, NE … NW |
| `noPaddleMessage` | `{reason, hasMotion}` | why a recording has no route (`reason` is a `NoPaddleReason`) |

## tokens/

`tokens.json`: `color` (hex), `radius` (px), `font` (family names; the apps
bundle IBM Plex themselves). The platform theme is dark.
