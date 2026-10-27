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
| `fixtures/` (rest) | Recording CSV | Phase C3 (not yet). The CSV and motion sidecar the phones write are pinned byte for byte by `recorder-core/fixtures/` (motion-core; format in its README) |

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
`RefreshToken`, `StravaAppToken`, `GoogleAppToken`, `SignInOptions`), and `api/rest.json` maps each `"<METHOD> <path>"` to its
`auth` (`user` = send `Authorization: Bearer`), input, output and the statuses
that answer an `ApiError`. Golden answers:
`fixtures/api/auth.*.json` (sign-up: `auth.signup.json`, `auth.login.needs-code.json`, `auth.too-many-codes.json`). `needsTerms` is missing on sign-up (the account has
just accepted the Terms).

| Call | Body | Answer |
|---|---|---|
| `POST /att/api/auth/login` | `{email, password}` | `{id, email, displayName, needsTerms, idToken, refreshToken}`; 401 wrong password; 403 with `needsCode: true` = right password but the sign-up code was never entered: a new one has gone out, ask for it and POST signup/confirm |
| `POST /att/api/auth/otp-request` | `{email, website: "", elapsedMs}` | `{session}`: emails a 6-digit code (makes the account if new) |
| `POST /att/api/auth/otp-verify` | `{email, session, code}` | as login; 400 with a new `session` if the code was wrong but tries remain |
| `POST /att/api/auth/signup` | `{email, displayName, password, acceptedTosVersion}` | 202 `{needsCode: true, email}`: a 6-digit code has gone to the email, nothing is signed in yet (#702). 409 = a confirmed account has this email; 422 if `acceptedTosVersion` isn't current. Calling it again sends a new code |
| `POST /att/api/auth/signup/confirm` | `{email, code, password, acceptedTosVersion?}` | 201, as login. 500 "Your email is confirmed. Please sign in." = confirmed but the sign-in failed: go back to the Sign in form with that message (sending a new code would now answer 409). 429 never here; signup and login answer 429 with `auth.too-many-codes.json` (show it as an error, don't restart the pause). Send `acceptedTosVersion` when the Terms were just ticked (Create account); leave it out when the code step came from a 403 sign-in, and then follow `needsTerms`. 400 = wrong or expired code (ask again, or send a new code by repeating the sign-up or sign-in) |
| `GET /att/api/auth/options` | | `{google, strava}`: which buttons to show besides email. Ask each time the sign-in screen opens; if the call fails, show email only |
| `POST /att/api/auth/strava/app-token` | `{code, verifier}` | as login; 401 = the code is spent or expired, start again |
| `POST /att/api/auth/google/app-token` | `{code, verifier}` | as login; 401 = the code is spent, expired or not from this verifier: start again |
| `POST /att/api/auth/refresh` | `{refreshToken}` | `{idToken}`; 401 = sign in again |
| `POST /att/api/auth/logout` | `{refreshToken}` | `{ok: true}`; the refresh token stops working |
| `POST /att/api/auth/password-reset/request` | `{email, website: "", elapsedMs}` | `{ok: true}` whether or not the account exists (it never says); if it does, a 6-digit code goes to that email |
| `POST /att/api/auth/password-reset/confirm` | `{email, code, password}` | `{ok: true, signedIn: true, idToken, refreshToken}`: signed in with the new password (then ask `me` for the name). Every other session of the account ends, so other devices' refresh tokens stop working (#702). `signedIn: false` = set, but sign in again. 400 with `error` for a wrong or expired code or a weak password |

**Website pages, signed in.** For a page only the website has (account
details, delete account…), `POST /att/api/auth/web-code {next: "/account#delete"}`
with the Bearer token answers `{url}`; open it in the in-app browser within a
minute. It works once and signs the website in as the app's person. `next` must be a page: a server route (`/api/…`, `/att/api/…`) opens the home page instead.

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

**Google** works the same way, with its own addresses. Show it only when
`options` says `google: true` (and Strava only when `strava: true`). Open
`/att/api/auth/google/init?challenge=<challenge>`. It first shows a page with a
"Sign in with Google" button, so a link alone can't finish a sign-in for the app;
the person taps it once. It ends on
`com.paddlesnitch.app:/signin/google?code=<code>` or `?error=<key>`, and you
swap the code and verifier at `google/app-token` (within 5 minutes, once).
The keys and what to say for them, as on the website:

| `error` | Say |
|---|---|
| `google_account_exists` | You already have an account with this email. Sign in with your email instead. (With `strava: true`: "…with your email or Strava instead.") |
| `google_no_email` | Couldn’t sign in with Google, because Google didn’t share a confirmed email address. Please sign up with your email instead. |
| `google_denied` | You cancelled the Google sign-in. |
| `google_failed` | Couldn’t sign in with Google. Please try again. |
| `google_not_configured` | Google sign-in isn’t available right now. |
| `google_linked` | Google is now connected to your account. Sign in with Google again. (Someone who started Connect Google on the website and then signed in with Google: start Google sign-in again, and it opens their account.) |

A Google account has no password here: don't offer "Forgot password" for it.
Ignore a `?code=` or `?error=` on that address when the app didn't start a
Google sign-in.

**When `strava` is false** (Strava switched off; ask `options` on these
screens too, not only on sign-in), do as the website does:
- Sign in: no Strava button. Under the form: "Signed up with Strava? Strava
  sign-in is off for now. Email us and we’ll help you sign in." and an
  "Email us" button: `mailto:privacy@paddlesnitch.com?subject=Signing%20in%20without%20Strava`.
  Not Report an issue: reports are public, and people would put their name
  and email in them.
- Account: no Strava section unless `strava/status` says connected. Then a
  neutral "Paused" badge, "Strava isn’t available right now. Paddles you
  already brought in stay here.", and Disconnect, except on a `placeholderEmail`
  account (its Strava link is its only way back in). No auto-import, no older
  paddles, no Connect.
- Add paddle: no Strava choice.
- Sign in again (before deleting): a `placeholderEmail` account can't. Say
  "Strava sign-in is off for now, so you can’t sign in again here. Report an
  issue asking us to delete your account. We’ll know it’s yours, so leave out
  your name and email: reports are public." and open `/account?report=1`
  through `web-code`, so the report is filed signed in, as that account (the
  website's issue form opens by itself on any page with `?report=1`).
- If `options` fails, show the email form and "Couldn’t load the other ways to
  sign in." with Try again, so a Strava-made account can still reach the line
  above.

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
| `GET /api/account/contact` | | `{contact: {email, addedAt} \| null, placeholderEmail}`: show "Contact email" only when `placeholderEmail` is true (the account was made through Strava, which never shares an email), as the website does |
| `POST /api/account/contact` | `{email}` | as GET; 400 if it doesn't look like an email |
| `DELETE /api/account/contact` | | `{ok: true}` |
| `GET /api/account/devices` | | `{devices: Tracker[], stableVersion, summaries: TrackerSummary[]}`: each tracker, the version it should run (`targetVersion`; `beta: true` may be ahead of stable), its last report (`health`) and last crash. **Show the cards from `summaries`**: already in order, removed trackers that still have recordings included (`linked: false`), with the counts, `firmwareState`, `quiet` (over 2 days silent) and `crash` (last 7 days) worked out by the server, the same rules the website uses. Don't recompute them |
| `DELETE /api/account/devices` | `{deviceId}` | `{ok: true}`: removed; it stops syncing and can be added again. Its recordings and paddles stay. 404 if it isn't this person's |
| `GET /api/account/devices/sessions` | | `{sessions: Recording[]}`: every recording the person's trackers uploaded, newest upload first (an old paddle synced late comes first), including removed trackers'. A recording with usable GPS also becomes a paddle in `paddles.list`; a desk test or one with no fix doesn't. Each also carries the owner's `userId`. `paddleId` on each recording that became a paddle (open it with `paddles.get`); none = too short or no track |
| `GET /api/account/devices/sessions/{sessionId}?deviceId=` | | `RecordingMotion`: a tracker paddle's boat motion. See **Boat motion** below. 404 if it isn't this person's recording |

### Boat motion

The website's `/paddles/[id]/motion`. Only a paddle whose `paddles.get` has
`source.type === "device"` with `deviceId` and `deviceSessionId` has one: call
`GET /api/account/devices/sessions/<deviceSessionId>?deviceId=<deviceId>`
(URL-encode both). Every number comes from the server; the app draws. The
answer carries more fields (`report`, `noPaddle`, `fromMotion`: the website's
technical details); ignore them. It sends an `ETag`: send it back as
`If-None-Match` and a 304 with no body means "what you have is current".

| State | What to show (the website's words) |
|---|---|
| Paddle not from a tracker | Title "No boat motion for this paddle", body "This paddle didn't come from a paddlesnitch tracker. Boat motion needs one fixed in the boat.", buttons Back to the paddle and About the tracker (`/guide`, through web-code). Don't call the route |
| Loading | "Loading" |
| Call failed, or 404 | "Couldn’t read the tracker's recording. Please try again." |
| `attitude` null, or `attitude.available` false | "No boat motion for this recording." then `noMotionCopy` (format.json: null = the motion file hasn't arrived, else it couldn't be measured), then "Technical detail: " + `attitude.reason` when there is an `attitude` |
| `attitude.available` | The tiles, the three charts and the two notes below |

Page title "Boat motion", with the paddle's `paddledAt` as `fmtDayTime` above it.

**Tiles** (label, value, note under it):
- Side-to-side roll: `rollRmsDeg` + "°", "typical lean"
- Bow-to-stern pitch: `pitchRmsDeg` + "°", "typical tilt"
- Evenness: `fmtEvenness(symmetry.imbalancePct)`, "uneven"; `symmetry` null: "—" and no note
- Stroke rate: the paddle's `result.avgSR` rounded, "spm"; null: "—", "not measured"

**Charts** (title, then caption under the chart). Roll is the split colour,
pitch the green; angles in degrees, `t` in milliseconds.
- "Through the session" from `envelope`: a band per bucket from min to max, roll
  over pitch, y from −`plotBoundDeg` to +`plotBoundDeg` (10 when null), values
  beyond clamped to the edge, and then the axis note "a few moments went past
  ±N° and are clipped here". X labels "0 min" and the length in whole minutes.
  Caption: "The shaded band shows how far the boat rolled and pitched through the recording. Roll is the side-to-side lean, pitch the bow rising and falling."
- "Stroke shape" from `excerpt`: two lines, scaled to its largest value ×1.1.
  Label "<seconds> s at <sampleRateHz> Hz". Caption: "30 seconds of typical paddling. An even stroke crosses the centre line equally on both sides."
- "Where the boat spent its time" from `rollHistogram`: bars by `centreDeg`,
  plus a dashed red line of the same counts flipped about 0 (each bin takes the
  count of the bin nearest `-centreDeg`). Labels "level" at 0, ±the largest
  `|centreDeg|`, legend "actual" and "mirrored". Caption: "Bars show how often the boat leaned each way. The dashed line is the same, flipped. If they match, your roll is even."

A chart with fewer than 2 points (histogram: no bins) is left out.

**Notes** under the charts:
- "**Reading this.** Rowing: aim for little roll, so the boat stays level. Kayak: the boat should rock with the stroke; what matters is that it rocks evenly."
- "**What this can't tell you.** We can't tell port from starboard, and a tracker mounted slightly crooked looks like a steady lean." and, when `axisConfident` is false, " Roll and pitch were hard to tell apart in this recording."

Never call the sides left and right (`sideADeg`/`sideBDeg`): the tracker can't tell which is which.

Your name and sign-in email come from `me`. Adding a tracker and syncing it
are in `fixtures/tracker/README.md`. Forgot password is under Signing in; Strava has its own section below.

## Strava, signed in

**Connect** shows Strava's own consent page, so it needs a browser. It works
like Strava sign-in, with the account's Bearer token added:

1. Make a PKCE verifier and challenge (as in Signing in). Send
   `POST /att/api/strava/app-connect {challenge}` with the Bearer token. It
   answers `{url}`.
   A 403 `{reauth: true}` means the last real sign-in is over 10 minutes old:
   sign in again first (as for deleting the account).
2. Open `url` in the in-app browser: an Android Custom Tab, or iOS
   `ASWebAuthenticationSession` with callback scheme `com.paddlesnitch.app`.
   It ends on `com.paddlesnitch.app:/account/strava` with one of:
   - `?code=<code>`: Strava said yes. Nothing is saved yet.
   - `?strava=<key>`: it didn't work: `denied`, `exchange_failed`,
     `linked_elsewhere`, or `state_mismatch` (the page was left open over
     10 minutes). Show the words for that key from `api/constants.json`
     `stravaConnectResults`. Offer to try again, except for `linked_elsewhere`.
   - A 503 from step 1 is `not_configured`: don't open a browser.
3. Within 5 minutes, send `POST /att/api/strava/app-connect/finish {code, verifier}`
   with the Bearer token. Only now is Strava connected, and it answers the
   new status. A code works once, and only for the person who started it with
   that verifier. A 400 means start again; a 409 is `linked_elsewhere`.

Anyone can open the app's address, so ignore a `?code=` or `?strava=` when
the app didn't start a connect, and treat a result as a cue to ask
`GET /att/api/strava/status`, never as proof. A Strava account that is
already connected to another paddlesnitch account is never moved
(`linked_elsewhere`).

| Call | Body | Answer |
|---|---|---|
| `GET /att/api/strava/status` | | `{connected, athlete?: {id, name}, autoImport?}`; 401 if the Bearer token is expired or invalid (with no token at all it answers `{connected: false}`, for the website) |
| `POST /att/api/strava/auto-import` | `{enabled}` | `{autoImport}`: new Strava paddles come in by themselves (on by default) |
| `POST /att/api/strava/disconnect` | | `{ok: true}`: Strava is told, and the tokens are deleted |

**Older paddles** are tRPC (`procedures.json`), driven by the open screen as
the website does it:
1. `sources.stravaHistory {since: "first" | "months3" | "year" | "all"}`
   lists what isn't in yet, oldest first. `first` means the last month.
   Connecting brings that in once by itself; `firstImportDone` says it has.
2. `sources.importStravaPaddle {id, sport, startDate}` for each one, one at a
   time. `imported` or `duplicate` give the paddle's `sessionId`. If `skipped`
   comes back with `rate_limited`, or the list says `rate_limited`, wait for
   Strava's next quarter hour (:00, :15, :30, :45) and carry on.
3. `sources.stravaHistoryDone` when the list is finished.

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
`account.devices`(`.none`), `account.devices-sessions`,
`account.devices-session` (boat motion: `.json` measured, `.no-motion` no motion
file yet, `.motion-unusable` measured nothing, `.not-found` the 404), and
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
| `noMotionCopy` | the answer's `attitude` (null, or one with `available: false`) | why a tracker paddle has no boat motion |
| `fmtEvenness` | `symmetry.imbalancePct` | the Evenness tile: its size, rounded, with % |

## tokens/

`tokens.json`: `color` (hex), `radius` (px), `font` (family names; the apps
bundle IBM Plex themselves). The platform theme is dark.
