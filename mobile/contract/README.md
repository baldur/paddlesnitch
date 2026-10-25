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
| `telemetry.md` + `fixtures/telemetry/` | The `x-paddlesnitch-app` header on every request, `app_open`, and crash reports sent on the next start | By hand; replayed against the real endpoint by `pnpm test` |
| `fixtures/` (rest) | Recording CSV, tracker Bluetooth protocol, receipts | Phase C3 (not yet) |

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

## Signing in

REST, not tRPC. Send `x-paddlesnitch-app: <platform>/<version>` (e.g.
`android/0.1.0`) on every sign-in call: the answer then carries `idToken` and
`refreshToken` instead of setting cookies. Keep the refresh token in the
platform's secure storage; send the ID token as `Authorization: Bearer` on
every API call.

The types are in `api/` like the rest (`SignIn`, `OtpSession`, `Refreshed`,
`Ok`, `ApiError`; inputs `Login`, `OtpRequest`, `OtpVerify`, `Signup`,
`RefreshToken`), and `api/rest.json` maps each `"<METHOD> <path>"` to its input,
output and the statuses that answer an `ApiError`. Golden answers:
`fixtures/api/auth.*.json`. `needsTerms` is missing on sign-up (the account has
just accepted the Terms).

| Call | Body | Answer |
|---|---|---|
| `POST /att/api/auth/login` | `{email, password}` | `{id, email, displayName, needsTerms, idToken, refreshToken}`; 401 wrong password |
| `POST /att/api/auth/otp-request` | `{email, website: "", elapsedMs}` | `{session}`: emails a 6-digit code (makes the account if new) |
| `POST /att/api/auth/otp-verify` | `{email, session, code}` | as login; 400 with a new `session` if the code was wrong but tries remain |
| `POST /att/api/auth/signup` | `{email, displayName, password, acceptedTosVersion}` | 201, as login; 422 if `acceptedTosVersion` isn't current |
| `POST /att/api/auth/refresh` | `{refreshToken}` | `{idToken}`; 401 = sign in again |
| `POST /att/api/auth/logout` | `{refreshToken}` | `{ok: true}`; the refresh token stops working |

`website` and `elapsedMs` are the anti-bot fields the website's forms send: an
empty honeypot, and the milliseconds since the form appeared. A call that
fills `website` or arrives under 2 s is dropped while looking like a success,
so send the real time. `needsTerms: true` means an older account must accept
the current Terms before going on (the website's flow; the apps open it).
Every error answer has a human-readable `error`.

## fixtures/api/

`<procedure>[.<case>].json`, each the `data` of one answer: `me.signed-in`,
`me.signed-out`, `paddles.list`, `paddles.get` (`pdl-river`),
`paddles.get.strava` (`pdl-strava`), `paddles.get.motion-only` (`pdl-motion`, a
paddle whose GPS failed: `result.noGps`), and `paddles.get.unknown-values`
(rule 2; deliberately does **not** fit the schema). The paddles are synthetic.

Sign-in answers are `auth.<route>[.<case>].json`: the answer of
`POST /att/api/auth/<route>` (`rest.json` gives its type). A fixture with an
`error` field is that route's `ApiError` instead (`auth.otp-verify.retry`: a
wrong code with tries left). `auth.error.json` is the refusal every sign-in
route shares. So far: `auth.login`, `auth.login.needs-terms`,
`auth.otp-verify.retry`, `auth.refresh`, `auth.error`.

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
