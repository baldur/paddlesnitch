# apps/web — the site

The one Next.js app (pkg `web`): Trials (`/att`), Paddles (`/paddles`), Plan, Devices, Profile, Account, `/api/trpc`. The root `CLAUDE.md` has the working rules, the monorepo map, shared conventions and the writing rules. Package internals are in `packages/*/CLAUDE.md`, production and deploys in `infra/CLAUDE.md`, the customer-issue workflows in `.github/CLAUDE.md`.

## Architecture

### Public API and MCP

**Public read-only API: `/api/v1`** (#511, owner 2026-10-24: read-only first, no tokens, no rate limit until abuse, attribution in every response). Plain GETs with open CORS over the same functions the pages use: `plan` (same parameters as a `/plan` link, ends by lat,lng or name; GeoJSON route + timed stops with the page's stable stop ids), `places` (`findOnWater`), `trials`, `trials/{id}`, `trials/{id}/leaderboard` (anonymous visibility only — `isListedForViewer`/`canViewTrial` with no viewer; display names, never user ids, tokens or invite lists). Shapes in `src/lib/api-v1.ts` (units in field names, `{ error: { code, message } }`), OpenAPI 3.1 in `src/lib/api-v1-openapi.ts` served at `/api/v1/openapi.json` and rendered on the `/api` docs page (so they can't drift; `api-v1.test.ts` checks every described path has a handler). Linked from `/help`, `llms.txt` and the sitemap. **This is a stable contract:** add fields, never rename or remove; a breaking change is `/api/v2`. Tokens/writes (#514) parked. **Read-only MCP server at `/mcp`** (#512): Streamable HTTP, stateless, no auth, hand-rolled JSON-RPC in `src/lib/mcp.ts` (initialize/ping/tools/list/tools/call; notifications → 202; GET 405). Five tools (`search_places`, `plan_route`, `list_trials`, `get_trial`, `get_leaderboard`), each calling the matching `/api/v1` GET handler in-process, so it returns exactly the API's JSON (a v1 error → `isError: true`). Verified with the official SDK client. Tests: `mcp.test.ts`.

### Architecture (Local Dev)

```
Browser
  │
  └─── Next.js (port 3000)         ← src/proxy.ts gates protected routes
         │
         ├──► cognito-local (port 9229)
         │       └── .cognito/db/           ← users + tokens (JSON files)
         │
         └──► Filesystem (.local-data/)
                ├── courses/{courseId}/metadata.json
                ├── trials/{trialId}/metadata.json
                ├── trials/{trialId}/leaderboard.json
                └── trials/{trialId}/entries/{userId}/{entryId}/
                      ├── trace.{gpx|fit}
                      └── result.json
```

**Finding routes:** pages and route handlers are files under `apps/web/src/app` (`find apps/web/src/app -name 'route.ts' -o -name 'page.tsx'`); JSON procedures are in `packages/api/src/routers/`. The list below records the **non-obvious contracts** of the Trials/auth/account handlers; it is not exhaustive (groups, invitations, OTP, password reset, entries, legal and devices routes also exist). Account routes are at `/api/account/*`, the rest under `/att/api/`.
```
auth/signup           POST — Cognito SignUp: emails a 6-digit code (Cognito's sender) and answers 202 {needsCode, email}; signs nothing in (#702). An UNCONFIRMED account on the email proved nothing, so signing up again replaces it (new code); a confirmed one is 409
auth/signup/confirm   POST {email, code, password, acceptedTosVersion} — ConfirmSignUp, then signs in, records the Terms, marks the email proven (`lib/email-proven.ts`), applies pending invitations, sets tt_id + tt_refresh (201)
auth/login            POST — Cognito InitiateAuth (USER_PASSWORD_AUTH), sets tt_id + tt_refresh. Right password on an account whose sign-up code was never entered: sends a new code, 403 {needsCode: true} (the sign-in page shows the code step)
auth/logout           POST — clears cookies, revokes refresh token (an app sends it as {refreshToken})
auth/refresh          POST — the apps' silent refresh: {refreshToken} → {idToken}, 401 = sign in again. Sign-in routes answer an app (header x-paddlesnitch-app) with the tokens in the body instead of cookies (signedInResponse; see mobile/contract/README.md)
auth/strava/app-token POST — a phone app swaps the one-time code from its Strava sign-in + its PKCE verifier for tokens (`lib/app-signin.ts`; see Sign-in flows)
auth/web-code         POST (Bearer only, never the cookie) {next} → {url} / GET ?code=&next= — opens a website page from a signed-in app already signed in: a one-minute, one-use code swapped for cookies (`lib/app-signin.ts`, C4 in docs/features/mobile-apps.md). Pages only: a `next` under /api or /att/api becomes `/` (anyone can mint a link that signs the opener in as them, so it must not start anything)
auth/me               GET  — returns the user claims from the current ID token, or `null` (200) when signed out. Signed-out is a normal state for this probe (the auth cookie is httpOnly, so the client always calls it); it answers 200 with a null body rather than 401 so a logged-out page load doesn't log a console error. Callers treat a null body as "not signed in". The tRPC `me` procedure returns `{ user: AuthUser | null }` the same way.
auth/magic-request    POST — 501 (magic link is disabled; email code + password are the sign-in methods)
auth/magic-verify     GET  — redirects to /signin?error=magic_disabled
courses               GET / POST
courses/[id]          GET / PATCH
courses/validate-trace POST — organiser tool: multipart {file, geometry JSON}; runs the trace through processTrace + diagnoseGates and returns { matched, totalElapsedSeconds?, gateAnalysis?, message? }. Stores nothing. Used by ReferenceTraceValidator on the course form to catch a backwards gate before anyone races (#71).
trials                GET (?courseId=) / POST
trials/[id]           GET / PATCH (open/close, visibility, participation, invitees; `{regenerateSubmitToken:true}` mints a shareable submit token, `{submitToken:null}` revokes it — owner/admin only)
trials/[id]/upload    POST (?invite={submitToken} bypasses the participation gate for link-holders; viewing still required) — parse GPX/FIT/CSV (or Strava import via {stravaActivityId}, or one of the user's own tracker recordings via {deviceId, deviceSessionId}: owner-checked, read where the tracker uploaded it), process, rebuild leaderboard. On a "did not cross the lines" failure, the 422 body carries `diagnostic: { track, course }` (parsed track as [lat,lng] pairs, downsampled to ≤1500 points, plus the course geometry) so the upload page can render a map of the track against the start/finish lines. For gate courses the 422 also carries `diagnostic.gateAnalysis` (see `diagnoseGates`) and the error message names the specific blocking gate. **Every 422 also carries a stable machine-readable `reason`** (#515, report only: `UPLOAD_REASONS` in `src/lib/upload-reasons.ts`: `UNKNOWN_FORMAT`, `NO_TIMESTAMPS`, `EMPTY_TRACK`, `UNREADABLE_FILE`, `MISSED_START`, `MISSED_FINISH`, `MISSED_GATE` (+ 1-based `gate`), `WRONG_DIRECTION`, `TOO_SHORT`, `STRAVA_UNAVAILABLE`, `BAD_LINK`, `FETCH_FAILED`, `FILE_TOO_LARGE`); non-gate courses get theirs from `noRunReason` in `geo.ts`. Codes never change meaning; add new ones at the end. The full-fidelity failing track + course (+ gateAnalysis) is also persisted to `trials/{trialId}/failed-uploads/{userId}/{id}/diagnostic.json` (best-effort; a write error doesn't change the 422) so a failure can be reproduced offline. Failed uploads are otherwise not saved. They ARE covered by GDPR: included in the account export (Art. 15) and removed on account erasure (Art. 17), same as entries.
trials/[id]/can-submit   GET (?invite=) — phase 3: { canSubmit } for the viewer, or { canSubmit:false, reason:'members'|'invitational', group? } so the upload page can show a join/invite CTA. A valid `?invite={submitToken}` answers canSubmit even on a gated trial. 404 if the viewer can't even view the trial.
trials/[id]/leaderboard GET
strava/connect        POST — from the Connect button's form (`StravaButton post`): sets state cookie, 303 to Strava authorize URL. Needs a recent real sign-in (`hasRecentSignIn`, checked again in the callback), else `/account?strava=reauth`. A GET starts nothing (→ /account#strava) and a foreign Origin is refused, so no link, redirect or page forwarding `next` can start a connect in a browser a web-code link signed in as someone else (security review, C5). A browser signed in by web-code (cookie `tt_from_link` = that account) is refused (`use_app`): Strava is connected in the app there. Saving goes through `saveStravaConnection` (drops the account's previous athlete index); `linkedElsewhere` fails closed (no Cognito lookup: a failed lookup must not let a link move)
strava/app-connect    POST (Bearer) {challenge} → {url}; …/finish POST (Bearer) {code, verifier}: a phone app connects Strava. The state names a server record (`lib/strava-app-connect.ts`, under auth/app-codes/); the callback saves NOTHING for it and sends a one-use code to com.paddlesnitch.app:/account/strava, so a link someone else made can't attach a stranger's Strava (security review, C5). Don't route it through web-code. Both callbacks refuse an athlete already linked to another account (`linked_elsewhere`). Result words: `lib/strava-connect-results.ts` (account page + constants.json). `mobile-strava.test.ts`
strava/callback       GET  — verifies state, exchanges code, persists tokens, redirects to /account?strava=connected
strava/status         GET  — { connected, athlete? }
strava/disconnect     POST — revokes on Strava, deletes local tokens; status, disconnect and auto-import take the apps' Bearer token (`getRequestUser`)
strava/activities     GET  — recent water-sport activities, refreshes token if needed
feedback              POST — files a customer-reported GitHub issue (anti-bot gate, see below)
account/export        GET  — JSON archive of the signed-in user's data (GDPR Art. 15); POST (what the account page uses) writes it to exports/{userId}/ in the data bucket and returns a 5-minute signed S3 link, because a Lambda answer is capped at 6 MB and each paddle is ~0.1 MB, so the GET failed past ~40 paddles (export-large-account.test.ts). Locally the link is the GET. Exports expire after a day (lifecycle) and erasure deletes them. Built by lib/account-export.ts — courses, trials, entries, failed uploads, paddles + notes, coach profile, users/ records (Strava as connected+athleteId only, never tokens), groups + role, trackers (no tokenHash) + recording metadata (raw tracker CSVs on request: too big for one response)
account               DELETE — full account erasure (GDPR Art. 17). Needs a real sign-in from the last 10 minutes (`hasRecentSignIn` in lib/app-signin.ts: the token's `auth_time`, its own `sub`, and not a session a web-code link made, which are recorded under users/{id}/link-sessions/). `GET /api/account` → `{recentSignIn}` lets the page and the apps ask BEFORE anyone types DELETE; the account page then signs out and back in (Strava accounts via Strava, others with the email prefilled) and returns to `/account?resume=delete#delete` with the box open. Else DELETE answers 403 `{reauth: true}`. Repeating a delete that worked succeeds (UserNotFoundException counts as done). **Unverified on prod:** that Cognito keeps `auth_time` across a refresh (the OpenID rule; cognito-local resets it). First it writes `auth/erased/<sha256 of the id>.json` (`@paddlesnitch/core/erased`, kept 2 days by a lifecycle rule): the phone calls answer 410 `accountDeleted` while the account's ID tokens still work, so a phone stops uploading and deletes that account's recordings. Also: `eraseUserAnalysis` (paddles, coach profile, share index), `eraseUserDevices` (owned trackers unlinked, claims, parts; recordings deleted by OWNER not device prefix — a tracker that changed hands keeps the previous owner's), `removeUserFromAllGroups` (owned group → first admin, else first member, deleted only if empty), `eraseFeedbackContactsForUser`, Strava deauthorised + athlete index removed. Every kind of personal data needs a line here AND in export — see `src/tests/account-data-complete.test.ts`. **Erasure must stay flat in time:** gather keys in parallel and delete with `deleteObjects`/`deletePrefix` (core storage; S3 DeleteObjects, 1,000 a call, throws on any S3 error), never `for … await deleteObject` — one call at a time a well-used account ran past the 30 s Lambda limit and stopped halfway (`erasure-big-account.test.ts`: 834 calls, 7.5 s at 10 ms each).
account/profile       GET / PATCH — read or set the viewer's profile visibility ({ public: boolean }); profiles are opt-in (private by default)
account/handle        GET (?check=) / PUT / DELETE — check availability, claim/change, or release the viewer's vanity profile handle
account/*             every /api/account route takes the apps' Bearer ID token as well as the cookie (`getRequestUser(req)`, never `getAuthUser()`); the ones the apps call are in mobile/contract (`rest.json`, README § Account), checked by `mobile-account.test.ts`. DELETE /api/account revokes the cookie's refresh token, else one an app sends as {refreshToken}
```

**Platform-level route: `GET /l/:code`** (`apps/web/src/app/l/[code]/route.ts`) —
the target of the QR on a device's claim screen. Normalises the code and
redirects to `/devices?code=…#add`. `/L/:code` is served by it through an internal
rewrite in `src/proxy.ts` (not a next.config rule, which matches case-insensitively
and loops) because the QR payload is **uppercase** — that is what puts it in
QR alphanumeric mode and drops the code to version 1, which is what makes it
scannable on a 64 px panel. Two things are load-bearing: the path stays **short**
(the payload has 32 bytes and `https://` alone is 8 of them), and the redirect
`Location` is **relative** — building an absolute URL from `req.url` sends the
user to the raw Lambda hostname, where the `tt_id` cookie does not apply and a
signed-in user arrives signed out.

**Note on trial path:** Trials are stored flat (`trials/{trialId}/`) not nested under courseId. The `courseId` is stored inside `metadata.json`. This simplifies lookups by trialId. **List trials and courses with `listTrials()` / `listCourses()` (`apps/web/src/lib/catalogue.ts`, over `@paddlesnitch/core/catalogue`), and a user's entries with `listUserEntryResultKeys`/`listUserFailedUploadKeys`:** they list the trial/course folders (S3 delimiter, `listPrefixes` in core storage) instead of `listKeys('trials/')`, which pages through every entry, trace and leaderboard on the site. Sixteen places used to do that, each with its own filter. The one left is `getEntry(entryId)` (`src/lib/entries.ts`), which needs an entry-id index to stop scanning.

#### Anti-bot gate

Unauthenticated POST endpoints that send email or create content guard against naive bots with two invisible, zero-friction checks in `src/lib/anti-bot.ts` (`looksLikeBot()`):

- **Honeypot** — a hidden `website` form field real users never fill; bots scraping inputs do.
- **Time trap** — submissions arriving sooner than `MIN_ELAPSED_MS` (2 s) after the form loaded are bots. The client sends `elapsedMs` measured from page/form mount.

A positive result means **drop silently**: skip the side effect (send no email, create no Cognito user, file no issue) and return a success-looking response so the bot gets no signal to adapt. Guarded routes:

- `auth/otp-request` — the gate runs **before** `signUp`/SES, so a bot can't email-bomb arbitrary inboxes *or* churn junk Cognito accounts. On a bot signal it returns a throwaway `{ session }`; a rare false-positive human hits "use a different email" to retry (timer resets, well past 2 s by then).
- `auth/password-reset/request` — returns the same `{ ok: true }` it returns for a non-existent account; `forgotPassword` never runs.
- `feedback` — returns `{ ok: true }` without filing the issue.

Client forms (`/signin` OTP tab, `/signin/forgot`, the feedback widget) carry the hidden `website` input + a `mountedAt` ref. These checks only stop unsophisticated bots — a script POSTing JSON directly omits both fields. They're a cheap first line, **not** a guarantee; a real challenge (Turnstile) or rate limiting would be the next step if targeted abuse appears. Tests: `src/lib/anti-bot.test.ts` (unit) plus bot-drop cases in `otp.test.ts`, `password-reset.test.ts`, `feedback.test.ts`.

### Local Data Layout

```
.local-data/                   ← course / trial / entry data (S3 mirror)
  courses/
    {courseId}/
      metadata.json            ← CourseMetadata type
  trials/
    {trialId}/
      metadata.json            ← TrialMetadata type
      leaderboard.json         ← LeaderboardEntry[] sorted by totalElapsedSeconds
      entries/
        {userId}/
          {entryId}/
            trace.{ext}        ← raw uploaded file
            result.json        ← { entryId, userId, displayName, submittedAt, filename, result: ProcessedResult }

.cognito/                      ← cognito-local emulator state (users + tokens)
  db/
    local_xxx.json             ← user pool (users, password hashes, attributes)
```

**Reset both** (no migration — users are test accounts only): `rm -rf apps/web/.local-data apps/web/.cognito` then `pnpm dev` + `pnpm seed`.

## App: ATT — Automated Time Trials

Served at `/att` (from `apps/web`; the `/att` prefix is baked into `src/app/att/`, no Next `basePath`). The sections below describe ATT's domain, auth, and features. Geo/timing/parser code lives in `@paddlesnitch/timing`; auth/storage/cognito/strava in `@paddlesnitch/core` (the app keeps re-export shims at the old `src/lib/*` paths).

### Domain Model

#### Course
A named stretch of water with:
- **Start line** — exactly 2 lat/lng points defining a straight line across the river
- **Finish line** — exactly 2 lat/lng points (only for `point_to_point`; omitted for all single-line course types)
- **Course type** — determines how the clock start/stop is detected (see below)
- **Distance** — auto-calculated from start/finish midpoints (`point_to_point`) or entered manually for single-line types
- **Sport** — `kayak` | `rowing` | `both`
- **`groupId`** — the owning **group** (phase 2). Management authority (edit / delete / open a trial on it) belongs to that group's owner + admins. `adminUserId` is retained as created-by (audit) but is no longer the manage authority. Set on every course created from phase 2 on; optional only to tolerate pre-migration data (where `adminUserId` is the fallback owner — see `canManageCourse`). Migrate legacy data with `scripts/migrate-courses-trials-to-groups.ts`.
- **Visibility** — `public` | `private` | `group`. Public courses appear in the catalogue for any visitor; private courses are owner-only; `group` scopes visibility to the owning group's members (`visibleToGroupId === groupId`). Permission checks live in `src/lib/permissions.ts` — never re-implement inline.

**Creation gating (phase 2).** Only a group's owner/admins can create courses (and open trials). A course must carry a `groupId` the creator manages (`canCreateCourseInGroup`); a paddler with no group is steered to a "create a group" on-ramp instead of a create form. The create UI is hidden for non-admins on the home + catalogue pages. See [`groups-and-creation-gating.md`](../../docs/features/groups-and-creation-gating.md).

##### Geometry lock (course with entries)

If a course has at least one entry on it (across any trial), editing its **geometry** — `type`, `startLine`, `finishLine`, `gates`, `gateDirection`, `distanceMetres`, `minValidSeconds` — is **rejected** with `409` and `{ code: 'course_has_entries' }`. Changing it would silently invalidate the historical results recorded against that geometry. **Name, visibility, and sport** edits still mutate in place — they don't invalidate any race result. (A geometry field re-sent with its current value is a no-op, not a rejection — `geometryChanged` only fires on an actual diff.)

The eventual "clone the course + re-run every existing trace + recalculate leaderboards" flow is tracked in #72; until then the lock is the safe behaviour. (This replaced the earlier modify-creates-copy clone, which produced orphan courses with empty leaderboards.)

Detection lives in `src/lib/course-entries.ts` (`courseHasEntries`, `geometryChanged`, `GEOMETRY_FIELDS`). PATCH logic lives in `src/app/att/api/courses/[courseId]/route.ts`.

#### Course Types

Three canonical types surfaced in the UI:

| Type | Lines | Description |
|---|---|---|
| `point_to_point` | 2 | Start and finish at different locations. Clock starts at start line, stops at finish line. Distance auto-calculated from midpoint to midpoint. |
| `loop` | 1 | Cross the same line twice (any direction). Clock starts on first crossing, stops on second. Use for out-and-back or circular loops. Set `minValidSeconds` to filter warmup false positives. |
| `gate` | 2+ | Ordered gates each with a crossing direction. Athletes must cross every gate in the specified direction, in sequence. Start gate starts the clock; finish gate stops it. Intermediate gates verify route compliance (e.g. turning buoys). |

Legacy aliases (accepted in API, not surfaced in UI): `one_way` = `point_to_point`, `out_and_back` = gate-like, `lap` = loop same-direction, `figure_eight` = three crossings.

**Crossing direction (`rxsSign`)**: `segmentIntersect()` returns `rxs = rx*sy - ry*sx` (r = track segment direction, s = line direction). `rxsSign = Math.sign(rxs)`. The right-hand normal of `line[0]→line[1]` points in the `+1` direction; `gateDirection = 1` means athletes must approach from that side. The direction is shown as a blue filled dot on the active side, hollow gray on the inactive side.

**Multi-gate (`processMultiGate`)**: finds all valid start crossings of `gates[0]` with required direction, then chains through each subsequent gate. Returns the shortest complete run. Lives in `geo.ts`.

**Gate failure diagnosis (`diagnoseGates`)**: when a gate match fails, `diagnoseGates(track, gates)` (in `geo.ts`) reports how far the run got and what blocked the next gate — `{ gatesPassed, total, blocking: { gateNumber (1-based), requiredDirection, reason } }`. `reason` is `'wrong_direction'` (the gate was crossed after the previous one, but only in the opposite direction — likely a backwards gate config) or `'not_crossed'` (no crossing after the previous gate). Only called on the failure path. `gateDiagnosisMessage(d)` (also in `geo.ts`) is the shared human-readable formatter used by both the upload route (athlete-facing failure) and the reference-trace validator (organiser-facing). The upload route turns this into an actionable error message and the upload page highlights the blocking gate in red on the diagnostic map. Regression fixture from a real failing trace lives at `src/tests/fixtures/gate-66-failing-trace.json`. See issue #66.

Organisers can pre-validate a gate course with a **reference trace**: `ReferenceTraceValidator` (on the new-course form, shown once ≥2 gates are drawn) POSTs the drawn geometry + a GPS file to `courses/validate-trace`, which runs the same matcher and reports per-gate pass/fail — catching a backwards gate before anyone races. Validation only; nothing is stored. See issue #71.

**minValidSeconds**: Stored on `CourseMetadata`; any result shorter than this is discarded. Useful for loop courses where warmup crossings can create false positives shorter than any real race time.

**trackSegment**: `ProcessedResult.trackSegment` stores the interpolated lat/lng path from start crossing to finish crossing. Used to plot the leader's track on the leaderboard map. Coordinates are **rounded to 6 dp (~0.1 m, well under GPS noise) in `buildResult`** — full-precision floats are ~incompressible and dominate the payload, so rounding cuts the served/stored trackSegment ~2.8× after gzip (it reaches the client via `GET /att/api/entries/[entryId]` and the trial page SSR). See "Payload sizing" under Ops.

**runCount**: `ProcessedResult.runCount` is how many valid runs the uploaded trace contained (start→finish pairs passing `minValidSeconds`); the returned result is the fastest of them. Carried onto `LeaderboardEntry` only when `> 1`, and the leaderboard's expanded row shows "Best of N runs in this upload" so the athlete understands why one time was picked from a multi-run session. Undefined on pre-#77 entries — treat as a single run. See issue #77.

`processTrace` in `geo.ts` uses the best-effort algorithm: tries every valid start crossing, returns the shortest valid pair.

**Reverse-role fallback (point_to_point only)**: if the forward start→finish search finds nothing — e.g. the athlete crossed the finish line first and never re-crossed it after the start, so the run effectively went finish→start — `processTrace` retries once with the start/finish lines swapped before yielding null. Forward is always preferred (the fallback only fires when the normal pass found nothing), so a properly-directed run is never affected. Guarded by the internal `tryReverse` param to run at most once. See issue #66.

#### Time Trial
An event on a Course with a date. A course can host many time trials. Has a status: `open` | `closed`. Carries a **`groupId`** inherited from its course (phase 2) — a trial belongs to the same group that owns its course, and only that group's owner/admins can open or manage it. Visibility clamps to the course's scope as before.

**`participation`** controls WHO can submit once they can view it (phase 3): `members` (any member of the trial's group — the **new default**), `invitational` (only `invitedUserIds`), or `public` (anyone who can view). The organiser can always submit. Legacy pre-phase-3 `'open'` is treated as `public` at read time and migrated by `scripts/migrate-participation-open-to-public.ts`. The gate lives in `canSubmitToTrial`; the upload route 404s a non-submitter (no leak), and `GET /att/api/trials/[id]/can-submit` lets the upload page show a "join {group} to submit" / "invite-only" CTA instead of a form that would fail.

**Shareable submit link (`submitToken`)**: an optional per-trial token on `TrialMetadata`. An organiser mints one from the trial manage page ("Share this trial" → CREATE SUBMIT LINK, which PATCHes `{ regenerateSubmitToken: true }`; REVOKE PATCHes `{ submitToken: null }` — both owner/admin-gated by `canManageTrial`). The resulting `…/upload?invite={submitToken}` link lets **any signed-in viewer bypass the participation gate** — so a link-holder can round-trip through signup and submit to a `members`/`invitational` trial *without* being added to the group or invite list first. This is the "hand out one link, people onboard themselves" path. The token bypasses participation **only**, not visibility: the upload route and `can-submit` still require `canViewTrial` (`tokenOk = !!trial.submitToken && invite === trial.submitToken && canViewTrial(...)`), so it can't submit to a trial the user can't see. The upload page reads `?invite=` (lazy `useState` init, SSR-null) and threads it through `can-submit`, all three submit POSTs, and the encoded sign-in `next` so it survives the auth round-trip. Tests: `src/tests/invitations.test.ts` › "shareable submit link (invite token)". Rotate (re-mint) or revoke to disable an old link.

#### Entry
A participant's submission for a specific time trial. Found by id through `entry-ids/{entryId}.json → { trialId, userId }` (`src/lib/entries.ts`, #409), written on upload; an older entry is found by listing trials once and indexed then; erasure drops the user's index entries. It consists of:
- A raw GPS trace file (GPX, FIT, or CSV format)
- A processed result (see below)
- The submitting user's identity

#### Result
Derived from an Entry by the processing pipeline:
- **Start crossing time** — timestamp when the track first crosses the start line
- **Finish crossing time** — timestamp when the track first crosses the finish line (after the start)
- **Total elapsed time** — finish − start in seconds
- **500 m splits** — array of `{ distance: number, elapsedSeconds: number }` at each 500 m mark
- **Average stroke rate** — `ProcessedResult.avgStrokeRate` (SPM), mean of per-point stroke rate over the racing window `[start, finish]` (timestamp-bounded so bracketing warmup/cooldown points don't skew it). Undefined when the trace carried none. Shown on the entry page (#143) and carried onto `LeaderboardEntry.avgStrokeRate` (populated by `rebuildLeaderboard` when present) so it also shows in the leaderboard's expanded row on the trial page (#148). Existing leaderboards backfill on the next upload/rebuild.

**Heart rate is intentionally NOT captured** (a sensitive biometric) — every parser strips it at parse time. **Stroke rate (a.k.a. cadence) IS captured** for paddlers (#143): each parser reads it from that format's own field (GPX `<gpxtpx:cad>`/`<cadence>`, FIT `cadence` + `fractional_cadence`, TCX `<Cadence>`/`<RunCadence>`, CSV aliases `cadence`/`cad`/`stroke rate`/`spm`/`sr`, SpeedCoach `Stroke Rate`), stores it on `TrackPoint.strokeRate`, and `geo.buildResult` averages it. In practice the **FIT** export is the reliable carrier — GPX exports (Strava, SpeedCoach) frequently omit stroke rate. See `docs/features/courses-and-entries.md`. **User-facing claims are tested:** `src/lib/legal-claims.test.ts` ties the privacy page, FAQ and cookie notice to the code (stroke rate kept, heart rate never, page views counted, and every outside host the code calls must be named on the privacy page). Adding an external service means adding it to that test AND the privacy page — and the policy promises to email users before new services or data kinds.

#### Boat class
Every entry carries a `boatClass`. Kayak: `K1`, `K2`, `K4`. Sculling: `1X`, `2X`, `4X+`, `4X-`. Sweep: `2-`, `4+`, `4-`, `8+`. Defined in `src/lib/types.ts` (`BoatClass`, `BOAT_CLASSES`, `BOAT_CLASS_INFO`, `isBoatClass`). The leaderboard UI defaults to showing all classes with a filter dropdown — comparing a 1X to an 8+ is not meaningful so users typically filter to their own class. Crew (per-seat names) is stored too (`CrewMember`, `validateCrew` in core).

#### Line crossing and 500 m splits

How a track crosses a line, the best-effort fastest-segment search and the 500 m split walk are in `packages/timing/CLAUDE.md` (the code is `@paddlesnitch/timing/geo`).

### Auth System

#### Identity store

All users live in a Cognito User Pool — no user records in S3 or the filesystem.

- **Local dev**: cognito-local emulator on port 9229 (`pnpm cognito`). Stores users in `apps/web/.cognito/db/`.
- **Production**: AWS Cognito pool `paddlesnitch-users` — `eu-west-1_BHyKJ0toh` (eu-west-1).

App code never branches on environment. Only the Cognito SDK endpoint differs:
- dev → `COGNITO_ENDPOINT=http://localhost:9229`
- prod → endpoint unset; SDK hits AWS directly

#### Sign-in flows

1. **Email + password** — Cognito `USER_PASSWORD_AUTH` flow. Cognito enforces the password policy (8+ chars, mixed case, digit). **Sign-up proves the address** (#702, 2026-10-26): a code goes to it and the account can't sign in until `auth/signup/confirm`; before this anyone could hold an address they didn't own. **Confirm checks the password before the code** (a sign-up again replaces an unconfirmed account, so otherwise someone could start an account on another person's email and have that person's code confirm it; security review); an already-confirmed account is refused there, never marked proven. Codes are limited to 5 an hour per address and 20 per IP (`lib/code-email-limit.ts`, signup and the login resend; 429). `findUserByEmail` counts only accounts whose email is verified. Core: `startSignUp`/`confirmSignUp`/`resendSignUpCode`; plain `signUp` (confirmed at once, sends nothing) is only for paths that prove the address another way (email-code sign-in, seed, tests). **A password reset ends every session** (`signOutEverywhere`, AdminUserGlobalSignOut: refresh tokens die; issued ID tokens live out their 24 h, but `hasRecentSignIn` refuses them) and, if the account never proved its email (no `users/{id}/email-proven.json`: every account from before 2026-10-26 until its first reset or email code), **drops its Strava connection** (`lib/password-reset.ts`, `lib/strava-disconnect.ts`). cognito-local has neither ResendConfirmationCode nor AdminUserGlobalSignOut (it answers `Unsupported`, which core treats as done, so local dev works; tests stub both); codes are read from its database (`tests/cognito-db.ts`, `tests/signup-flow.ts`, E2E `signUpCode`). Locally the code is printed in the `[cognito]` output of `pnpm dev`. **Forgot password works for everyone** (since 2026-10-25): the pool sends Cognito-originated email (reset codes) with **Cognito's own sender** (`UserPoolEmail.withCognito`, 50/day, from no-reply@verificationemail.com), because SES is still in the sandbox (#23) and silently dropped reset codes to unverified addresses. `RESET_EMAIL` (`lib/email-delivery.ts`) shows the reset form; `EMAIL_DELIVERY` (SES) still hides the Email code sign-in tab, since our CreateAuthChallenge Lambda sends those through SES. Switch the pool back to SES once production access lands (the SES config is in a comment in `att-stack.ts`).
2. **Email OTP** — **hidden while `EMAIL_DELIVERY` is false** (`apps/web/src/lib/email-delivery.ts`): SES production access was refused, so codes only reach verified addresses. The EMAIL CODE tab is hidden and /signin/forgot says to use Report an issue instead (password resets are emailed too). Flip the constant when `aws sesv2 get-account` shows ProductionAccessEnabled. Cognito `CUSTOM_AUTH` flow. Our three Lambda triggers generate a 6-digit code, email it via SES, and verify it. See `infra/lambdas/cognito-auth/`.
3. **Sign in with Strava** — server-driven OAuth. Routes: `/att/api/auth/strava/init` sets a CSRF state cookie and 302s to `strava.com/oauth/authorize` with `scope=read,activity:read_all,profile:read_all`. `/att/api/auth/strava/callback` exchanges the code, fetches the authenticated athlete's profile (`/api/v3/athlete`), then resolves the Cognito user by trying in order: (a) `strava-athletes/{athleteId}.json` index, (b) `cognito ListUsers` with `email = ...` (auto-link to an existing email account — only when Strava actually returned an email, otherwise skipped), (c) `AdminCreateUser` with a random unused password. Sign-in goes through the existing `CUSTOM_AUTH` flow with a server-generated one-time token. **The token is passed via the user's `custom:auth_preset` attribute, NOT `ClientMetadata`** — Cognito does **not** forward `ClientMetadata` to the Create/Define/Verify Auth Challenge triggers (AWS limitation; it only reaches Pre-Signup/Pre-Auth/User-Migration), so the original `ClientMetadata.preset_otp` approach silently never worked and `CreateAuthChallenge` always fell through to emailing a random code. `customAuthSignIn()` now sets `custom:auth_preset` via `AdminUpdateUserAttributes` right before `InitiateAuth`, `CreateAuthChallenge` reads it from `event.request.userAttributes['custom:auth_preset']` (clientMetadata kept only as a dev/test fallback), and the attribute is cleared after. Only the server can do both halves of that dance, so the path is server-trusted.

> **One-time pool setup (already done in prod):** the `custom:auth_preset` attribute was added out-of-band — `aws cognito-idp add-custom-attributes --user-pool-id <pool> --custom-attributes Name=auth_preset,AttributeDataType=String,Mutable=true`. It is **not** declared in the CDK `UserPool` construct on purpose: changing the pool's schema through CloudFormation can force a pool *replacement* (losing all users), so schema additions are manual, like the SES rule-set activation.
   **From a phone app** (`init?challenge=<PKCE S256>`): the callback skips cookies and sends a one-time code to `com.paddlesnitch.app:/signin/strava?code=` (errors as `?error=`), stored hashed at `auth/app-codes/` (5 min, single use, swept by a 1-day lifecycle rule); the app swaps code + verifier at `auth/strava/app-token`, which signs in by `CUSTOM_AUTH` then. A website session in the same browser doesn't short-circuit it. `apps/web/src/lib/app-signin.ts`, `src/tests/strava-app-signin.test.ts`.
   **Strava never shares email** with third-party apps (their policy, not a bug). When the profile call returns no email field, we mint a synthesised address `strava-{athleteId}@noreply.paddlesnitch.com` to satisfy Cognito's email-format requirement. The user sees a banner inviting them to add a real contact email at `/account` (see `src/lib/strava-account.ts` + `src/components/AttContactBanner.tsx` (over `@paddlesnitch/ui/ContactBanner`)). Real emails sit in `users/{userId}/contact.json` (separate from the Cognito email) and feed any future outbound comms.
4. **Magic link** — **disabled.** `magic-request` answers 501 and `magic-verify` redirects to `/signin?error=magic_disabled`. Email code (flow 2) replaced it.
5. **Sign in with Google** (#697) — through Cognito's hosted sign-in (`lib/google-signin.ts`). `GET /att/api/auth/google/init?next=` → Cognito's `/oauth2/authorize?identity_provider=Google` with a state and a PKCE challenge (httpOnly cookies `google_signin_state`, `_verifier`, `_next`, 10 min) → Google → Cognito → `GET /att/api/auth/google/callback` swaps the code at Cognito's `/oauth2/token` (public client, PKCE; our server never holds Google's secret) for the pool's own tokens, then the Terms check, pending invitations and cookies, like Strava. **One account per email** (PreSignUp trigger, infra/CLAUDE.md): a Google sign-up whose email already has an account is refused (`google_account_exists`), and so is an email sign-up or Strava account on a Google account's email (`email_exists`), because our sign-ins find people by email. Google is linked only from Account, never by matching email (owner, #697). **Connect Google** (`lib/google-link.ts`, `components/GoogleConnect.tsx`): Account's "Continue with Google" POSTs to `google/link`: own-site form, not a web-code browser, a recent real sign-in (like Strava connect), and an email the account has **proved** (`isEmailProven`: accounts made before sign-up codes may hold someone else's address and would capture that person's Google login, security review 2026-10-27). Account proves it first with a code (`POST /api/account/email-proof`: Cognito's GetUserAttributeVerificationCode / VerifyUserAttribute with the access token from `tt_refresh`, rate-limited like sign-up codes, then `markEmailProven(…, 'account_code')`). The route leaves a 10-minute note `auth/google-links/<sha256(email)>.json` {userId, expiresAt} (lifecycle-swept after a day) and goes to Google with the `google_signin_link` cookie. The PreSignUp trigger reads the note once: same verified email, the note names the one account holding it, not expired, not itself a Google account → `AdminLinkProviderForUser`, then throws `LINKED` → `/account?google=connected`. The callback spends the note on every return of a link trip, and never signs anyone in as another account: a Google login with another email gives `different_email` (with the same email but its own account, `linked_elsewhere`), and only an account Cognito made in the last 2 minutes that never accepted the Terms is deleted. A note abandoned and then used by a plain Google sign-in still links: that trip gets `google_linked` ("sign in with Google again"). **Disconnect** (`google/unlink`, `AdminDisableProviderForUser`); a password reset and account deletion disconnect it too. `GET /api/account/google` → {signsInWithGoogle, connected, email, canConnect, emailProven, canDisconnect} (`findUserBySub().googleLinked/googleId` read the `identities` attribute). The export marks `googleConnected`. `customAuthSignIn` takes the expected sub and refuses tokens for another account; Strava sign-in to an account that signs in with Google says so (`strava_use_google`). Invitations go only to a Google-verified email; the export marks `signsInWithGoogle`. A Google account's Cognito username is `Google_<id>`, not its email: **find it by sub** (erasure uses `deleteUserBySub`), and admin calls that take the email as username (`customAuthSignIn`, so web-code links) don't work for it. The button shows only when the build has `NEXT_PUBLIC_GOOGLE_SIGNIN=1` (repository variable `GOOGLE_SIGNIN`; infra/CLAUDE.md § Sign in with Google). **Locally** cognito-local has no hosted sign-in, so `COGNITO_DOMAIN` is unset and the routes say "not available"; `google-signin.test.ts` mocks Cognito's token endpoint with tokens cognito-local issued, `google-pre-sign-up.test.ts` calls the trigger, `google-infra.test.ts` checks the stack. The real round trip is tested on production.
   **From an app** (#728): `init?challenge=` (the app's own PKCE challenge) → `/signin/google-app`, a page with one button: a link alone must not finish an app sign-in (anyone can make a challenge, and a browser already signed in to Google asks nothing; security review 2026-10-26). The tap POSTs {challenge, n} back to init, checked against the Lax nonce cookie `google_signin_app_nonce`; then Cognito with the app's challenge, and the callback hands Cognito's code to `com.paddlesnitch.app:/signin/google?code=` unswapped (`google_signin_app` cookie). `POST google/app-token {code, verifier}` swaps it and answers as login. Nothing is stored on our side.
6. **Which buttons show** (`lib/sign-in-options.ts`): `googleSignInOn()` (variable `GOOGLE_SIGNIN=1`) and `stravaOn()` (on unless variable `STRAVA_OFF=1`; off in production since 2026-10-26, as our Strava API app needs a paid subscription). The apps read the same from `GET /att/api/auth/options`. Strava off: the web `lib/strava.ts` `authorizeUrl` answers null, so every Strava flow says "not available" (a test fails if a route imports it from core directly); webhook events import nothing (deauthorisations still apply); the website hides Strava sign-in, connect and import, and Account shows Strava only to people still connected ("Paused"). Accounts made through Strava (placeholder email) can't sign in while it's off: the sign-in page and the delete step point them to Report an issue.
6. **Apple** — not wired.

#### Session mechanics

- **Cookies**: two httpOnly cookies, sameSite=lax, path=/.
  - `tt_id` — Cognito **ID token** (JWT). 24h maxAge, matches Cognito ID-token validity.
  - `tt_refresh` — Cognito **refresh token**. 30d maxAge.
- **`getAuthUser()`** (`src/lib/auth.ts`): reads `tt_id` → verifies the JWT signature against the pool's JWKS (`https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/jwks.json`, cached) → returns `{ id, email, displayName }` from claims (`sub`, `email`, `name`). If the ID token is expired and the context is mutable (Route Handler / Server Action), silently exchanges `tt_refresh` for a fresh ID token and updates the cookie.
- **The header's user comes with the page** (#411): the root layout reads it once (`sessionUser()`, `src/lib/session-user.ts`: id + name only; `undefined` when a session cookie couldn't be confirmed, so the header asks `/att/api/auth/me` as before) and passes it through `SessionUserProvider`; `AccountMenu` shows it on first paint with no extra request. This makes every page dynamic (they were all served by the server Lambda anyway). The layout isn't re-rendered on client-side navigation, so **signing in, out, or deleting the account loads the next page in full** (`window.location`), never `router.push`. Tests: `session-user.test.ts`, `AccountMenu.test.tsx`.
- **No server-side session store.** The cookies are the session — verification is local once the JWKS is cached.
- **Logout**: clear both cookies; call Cognito `RevokeToken` on the refresh token.

#### Environment variables

| Var | Local dev | Production |
|---|---|---|
| `COGNITO_ENDPOINT` | `http://localhost:9229` | (unset) |
| `COGNITO_USER_POOL_ID` | `local_xxx` (from cognito-local) | `eu-west-1_BHyKJ0toh` |
| `COGNITO_CLIENT_ID` | (from cognito-local) | `svs358h7ii10o1jktvg57798m` |
| `COGNITO_REGION` | `eu-west-1` | `eu-west-1` |

#### Routes

- `POST /att/api/auth/signup` — Cognito `SignUp` + `AdminConfirmSignUp`, signs in, sets `tt_id` + `tt_refresh`
- `POST /att/api/auth/login` — Cognito `InitiateAuth` (USER_PASSWORD_AUTH), sets `tt_id` + `tt_refresh`
- `POST /att/api/auth/logout` — clears both cookies, calls Cognito `RevokeToken`
- `GET  /att/api/auth/me` — verifies JWT (and silent-refreshes if expired), returns user claims, or `null` with a **200** when signed out (not 401 — a 401 on this always-called probe is logged as a console error on every logged-out page load; callers key off the null body)
- `GET  /att/api/auth/strava/init` — Strava sign-in: state cookie + redirect to Strava with `profile:read_all`
- `GET  /att/api/auth/strava/callback` — finds/creates Cognito user, runs `CUSTOM_AUTH` with preset token, sets `tt_id` + `tt_refresh`, redirects to `next`
- `POST /att/api/auth/magic-request` — disabled in v1 (returns 501 with friendly message)
- `GET  /att/api/auth/magic-verify` — disabled in v1 (redirects to `/signin?error=magic_disabled`)

#### Access control

- **Proxy (`src/proxy.ts`)**: cheap cookie-presence check at the edge — does NOT verify the JWT (keeps middleware fast). Redirects to `/signin?next={path}` if absent. Real verification happens in API/page handlers via `getAuthUser()`.
- Public without login: home (open trials list), leaderboard, upload form (shows sign-in prompt).
- Admin pages require login.

#### Google and Apple

Google is wired (flow 5 above; infra/CLAUDE.md § Sign in with Google). Apple would follow the same shape: a Cognito identity provider, `identity_provider=SignInWithApple` on the same init/callback pattern, and the same rule for an email that already has an account.

### Strava integration

Users can connect their Strava account once and then import any recent water-sport activity straight into a time trial — no GPX export required. Implementation:

- **Lib**: `src/lib/strava.ts` (OAuth + read-only API wrapper, no SDK) and `src/lib/strava-storage.ts` (per-user token persistence).
- **Token storage**: `users/{userId}/strava.json` in S3 (or `.local-data/` in dev). `getValidStravaTokens()` refreshes silently when the access token is within 2 minutes of expiry and re-persists.
- **OAuth scopes**: `read,activity:read_all` — enough to list recent activities and pull lat/lng + time streams. Never `write` — we don't post to anyone's Strava feed.
- **CSRF**: state cookie `strava_state` (httpOnly, 10 min) set on `/strava/connect`, verified on `/strava/callback`.
- **Activity filter**: the picker shows only `Kayaking`, `Canoeing`, `Rowing`, `StandUpPaddling`, `VirtualRow` — see `WATER_SPORT_TYPES` in `strava.ts`. Other sports can still be imported via the URL tab.
- **Streams → TrackPoint**: `streamsToTrack(latlng, time, startDate)` joins parallel arrays + the activity's start date into the same `TrackPoint[]` shape that GPX/FIT/CSV parsers produce, so `processTrack()` is sport-agnostic.
- **Persisted "raw trace"**: Strava imports save a JSON snapshot (`strava-{id}.json`) instead of a GPX file. Same directory layout (`trials/{trialId}/entries/{userId}/{entryId}/trace.json`), same audit story.
- **Auto-import (webhook) — [`strava-auto-import.md`](../../docs/features/strava-auto-import.md)**: new water-sport activities appear in **My Paddles** automatically via the Strava **Webhook Events API**. Callback `GET|POST /api/strava/webhook` (public — Strava is the caller; GET echoes `hub.challenge`, POST writes a `strava-event` job and acks 200 at once; the import runs as that job, see "`after()` does NOT run after the response here"). An `activity create` → map `owner_id`→user via the `strava-athletes/{id}` index → if auto-import is on, `importStravaActivity()` → the shared `analyseAndSave` pipeline (water-sport filtered, de-duped). An `athlete` deauthorize event → disconnect (delete tokens + index). **Opt-in default-ON** per connected user (`users/{userId}/strava-prefs.json`, toggle in Account → Strava). One-time ops, **done 2026-10-09** (it had never been run, so nothing auto-imported until then): SSM SecureString `/att/strava-webhook-verify-token` created and subscription **375973** registered with `pnpm --filter web strava:webhook create` (Strava allows ONE subscription/app and validates the live callback while creating it). Check it with `STRAVA_CLIENT_ID_PARAM=/att/strava-client-id STRAVA_CLIENT_SECRET_PARAM=/att/strava-client-secret AWS_PROFILE=paddlesnitch npx tsx scripts/strava-webhook.ts view` (from `apps/web`). Strava only notifies about activities created after the subscription. **Older paddles (#415):** connecting brings in about the **last month** by itself, once (`StravaFirstImport` on Paddles + Account; done-mark `historyImportedAt` in `strava-prefs.json`, merged so the auto-import toggle keeps it), and Account → Strava → **IMPORT OLDER PADDLES** reaches 3 months / a year / everything; ADD A PADDLE → FROM STRAVA still works one at a time. The open page drives it (no background job, see #413): `sources.stravaHistory` lists (skipping ones already in by `stravaActivityId`), `sources.importStravaPaddle` brings in one with **one** Strava request (sport + start come from the list), and a 429 comes back as `rate_limited` (`StravaRateLimited`) so the page waits for Strava's next quarter hour and carries on. Tests: `strava-history.test.ts`, `StravaHistoryImport.test.tsx`. Read-only, never posts; fast-ack; deauth deletes tokens — see the record for the full Strava-guideline mapping.

#### Env vars

| Var | Where | Notes |
|---|---|---|
| `STRAVA_CLIENT_ID` | `.env.local` (dev only) | Direct override for local dev. Public — appears in every authorize URL. |
| `STRAVA_CLIENT_ID_PARAM` | env (prod, set by CDK) | Name of SSM String parameter to fetch at runtime: `/att/strava-client-id`. |
| `STRAVA_CLIENT_SECRET` | `.env.local` (dev only) | Direct override for local dev. |
| `STRAVA_CLIENT_SECRET_PARAM` | env (prod, set by CDK) | Name of SSM SecureString to fetch at runtime: `/att/strava-client-secret`. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | `.env.local` (dev only) | Direct override — the shared secret echoed on the webhook subscription handshake. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN_PARAM` | env (prod, set by CDK) | Name of SSM SecureString to fetch at runtime: `/att/strava-webhook-verify-token`. |

The SSM parameters are set once by hand: the commands, the trailing-newline trap and the KMS grant are in `infra/CLAUDE.md` § Strava secrets in SSM.

#### Redirect URIs

| Env | URI |
|---|---|
| Local | `http://localhost:3000/att/api/strava/callback` |
| Prod | `https://paddlesnitch.com/att/api/strava/callback` |

Both must be allow-listed in the Strava API app at https://developers.strava.com.

### Frontend Structure

Don't hand-maintain a tree here (the last one rotted: it listed deleted components and pre-merge paths). The layout is:

- **Pages and route handlers:** `apps/web/src/app/**` (`att/` Trials, `paddles/` Paddles, `devices/`, `account/`, `profile/`, `api/` platform routes, `l/` tracker QR). `find apps/web/src/app -name page.tsx -o -name route.ts` lists them; `docs/features/sitemap.md` explains them.
- **Components:** `apps/web/src/components/` — `AppHeader` + `AccountMenu` (every page's header), `analysis/` (the paddle view), `map/` (Leaflet; `CourseMapClient` is the `ssr:false` wrapper for server components), `leaderboard/`, `devices/`, `campaigns/`, `strava/`.
- **`apps/web/src/lib/`:** app-level logic (permissions, groups, profile, entries, email, feedback-contacts, beta-signups, tracker-copy, …) plus one-line **re-export shims** (`geo`, `parse`, `storage`, `auth`, `strava`, `types`…) over the packages, kept so old `@/lib/*` imports resolve. New shared code goes in a package, not a shim.
- **Header behaviour:** the lit tab follows the URL; signed-out pages show SIGN IN in the account slot.
- **System pages:** `src/app/not-found.tsx` (every unknown URL and every `notFound()`, including private trials and profiles, shown inside the site rather than Next's white page) and `src/app/error.tsx` (render errors: Try again + Report an issue). Covered by `e2e/critical/system-pages.spec.ts`.

### GPS File Formats

Formats, what each parser keeps (stroke rate yes, heart rate never), zip and `.gz` handling and the parse reasons are in `packages/timing/CLAUDE.md` § GPS File Formats. The upload route maps every parse reason to a friendly 422 message; the browser gzips GPX/TCX/CSV of 1 MB or more (`src/lib/trace-upload.ts`), because a request can be at most ~4.6 MB.

### Paddler profiles

Profile + account are **platform-level routes** ([`profile-routes.md`](../../docs/features/profile-routes.md)). **Sign-in, help and the legal pages are site-wide (2026-10):** `/signin` (+ `/signin/forgot`, `/signin/reset`), `/help` (a hub: tracker guide, troubleshooting, then the Trials FAQ), `/privacy`, `/terms` (+ `/terms/accept`); the old `/att/auth`, `/att/faq`, `/att/privacy`, `/att/tos` 308 to them in one hop with the query kept (`next.config.ts`, covered by `redirects.test.ts`). **Account settings live at `/account`** (called ACCOUNT everywhere — never "settings"); `/profile/me/settings` and `/att/account` 308 straight to it (`src/tests/redirects.test.ts` also fails on chained redirects). Profile: public profile `/profile/{id-or-handle}`, your own `/profile/me` (→ redirects to your public profile, which shows an EDIT PROFILE link to `/account#profile` when it's yours), account API `/api/account/*`. Old `/att/u/:id` 308s to `/profile/:id`. `/profile/me*`, `/account` and `/api/account` mutations are auth-gated in `src/proxy.ts`; `/profile/:id` is public.

A profile page at `/profile/{id-or-handle}` shows one paddler's vanity stats — totals (races, courses, distance, since), personal best per course, best pace/speed, boat-class counts, and race history. Two invariants, both enforced in `src/lib/profile.ts`:

1. **Opt-in.** A profile is private until the user flips it public (account page → Public profile → `PATCH /api/account/profile`). Setting stored at `users/{userId}/profile.json` (`{ public: boolean }`, default false). A private profile returns **404** to everyone but its owner (the owner sees their own with a "only you can see this" banner) — same no-leak pattern as private courses/trials.
2. **No visibility leak.** `buildProfileStats(userId, viewer, viewerGroupIds)` scans the user's `entries/*/result.json`, but counts a race **only if `canViewTrial(trial, viewer, viewerGroupIds)`** passes — so a profile never reveals a result the viewer couldn't already see on that trial's leaderboard. Stats are recomputed per-viewer.

A user may also claim a **vanity handle** so their profile lives at `/profile/baldur`. Handle logic is in `src/lib/profile.ts`: `normaliseHandle` (lowercase, 3–30 chars, `[a-z0-9-]`, no leading/trailing hyphen, not in `RESERVED_HANDLES`), `claimHandle` / `releaseHandle` (maintains a `usernames/{slug}.json → { userId }` reverse index; changing a handle frees the old slug; taken handles are rejected), and `resolveToUserId(segment)` (a known handle wins, else the segment is treated as a userId so old `/profile/{userId}` links keep working). The profile page redirects to the canonical `/profile/{handle}` when one exists. Managed from the account page → Public profile → Profile handle (`GET ?check=` / `PUT` / `DELETE /api/account/handle`). Account erasure releases the handle index and wipes the whole `users/{userId}/` prefix (profile, contact, groups index, strava, tos-consent — previously these survived deletion).

**Discoverability.** A signed-in user reaches their own profile via PROFILE in the account menu. On a trial leaderboard, an athlete's name links to their profile **only when that profile is public** — `getPublicProfileLinks(userIds)` returns `userId → handle-or-id` for public profiles only, and `LeaderboardTable` renders a link when present, plain text otherwise (no dead links to private/opt-out profiles). The owner's own race history links back to each trial.

### Groups

A **group** is an organisation / community / team — a club, a squad, or just one person. It owns courses + trials (their `groupId`) and scopes their visibility. Stored at `groups/{groupId}/metadata.json`. Has:

- `ownerId` (exactly one; cannot be removed without explicit transfer)
- `adminUserIds` — manage on behalf of the group + create/manage its courses & trials; cannot delete or transfer ownership
- `memberUserIds` — see group-visibility resources + submit to `members` trials
- `joinPolicy` + `joinLinkToken?` — see "Joining a group" below

Reverse index at `users/{userId}/groups.json` keeps membership checks O(1) without scanning every group. Updated on join + leave + accept-invitation + group-delete. `getUserGroupIds(userId)` returns all groups you're in; `getUserAdminGroupIds(userId)` returns the owner/admin subset (gates creation + management).

#### Invitations

Two paths:
- **Resolved** (recipient has an account) — stored at `groups/{groupId}/invitations/{id}.json` with `toUserId`. Recipient sees it and POSTs `/accept` or `/decline`.
- **Pending email** (recipient doesn't yet) — stored at `pending-invitations/groups/{sha256(email)}/{id}.json`. On signup (email AND Strava paths), `applyPendingInvitations(email, sub)` (in `src/lib/pending-invitations.ts`) scans the matching folder, adds the new user to each group, and deletes the pending records. Email is hashed with sha-256 so the bucket directory listing doesn't leak unverified emails.

Both paths trigger a transactional email via SES on creation (`src/lib/email.ts` wraps SES, `src/lib/invitation-email.ts` holds the templates). Pending invitations link to `/signin?next=/att/groups/{id}` so the recipient lands on the group after signup; resolved invitations link straight to the group page. Synthetic Strava `strava-{id}@noreply.paddlesnitch.com` addresses are skipped (no inbox). Email send failures are swallowed — the invite record is already persisted and can be re-sent. Local dev (`USE_LOCAL_STORAGE=true`) no-ops SES and logs to stdout instead.

#### Joining a group — self-serve (phase 4)

Beyond admin invitations, a non-member can join via the group's **`joinPolicy`** (on `GroupMetadata`; missing is treated as `request`, the default for new groups):

- **`invite_only`** — no self-serve; only an admin invitation works.
- **`request`** — anyone signed-in can request; an admin approves/declines. A pending request is stored at `groups/{groupId}/join-requests/{id}.json` (`JoinRequest`).
- **`open`** — anyone signed-in joins instantly (no pending record persists).

A group can also carry a **`joinLinkToken`**: anyone signed-in who hits `POST …/join-requests` with a matching token joins **instantly regardless of policy** (the shareable join link is `/att/groups/{id}?join={token}`). Rotate/revoke via PATCH.

Helpers live in `src/lib/groups.ts` (`joinPolicyOf`, `withMember`, join-request CRUD, `findPendingJoinRequest`). Permission checks: `canRequestToJoin` (signed-in non-member, policy ≠ invite_only) and `canManageGroupMembers` (owner/admin) in `src/lib/permissions.ts`.

**Group visibility change for join:** `GET /att/api/groups/[id]` now returns a **limited projection** (name, description, `joinPolicy`, `memberCount`, `viewerStatus`) to non-members instead of 404 — enough to render a join CTA without exposing the member list. Members still get the full payload (+ `viewerStatus` + `memberNames`, a `userId → displayName` map resolved via `findUserBySub` — display names only, never emails — so the member list shows names, not user IDs). Groups remain non-enumerable (the catalogue lists only your own), so this is "discoverable by link", not browsable. The upload page's phase-3 "join {group} to submit" CTA links here, closing the loop.

Routes: `POST /att/api/groups/[id]/join-requests` (request/auto-join/by-link), `GET` (admin: pending list, names resolved), `POST …/join-requests/[reqId]/approve` + `…/decline` (admin). `joinPolicy` + join-link are set via `PATCH /att/api/groups/[id]`.

#### Group-scoped visibility on courses + trials

`Visibility` is `'public' | 'private' | 'group'`. When `visibility === 'group'`, the resource carries a `visibleToGroupId` and is visible to that group's members + admins + owner. From phase 2, a course is always *owned* by a group (its `groupId`), so `group` visibility scopes to the owning group — `visibleToGroupId === groupId`.

Trials inherit their course's scope when it's tighter than what was requested:
- Course `private` → trial forced `private`.
- Course `group` → trial forced `group` with the course's `visibleToGroupId`.

Permission helpers (`canViewCourse`, `canViewTrial`, `canSubmitToTrial`, `isListedForViewer`) take an optional `viewerGroupIds: Set<string>` argument; callers fetch it once at the request boundary via `getUserGroupIds()` and pass it down. Undefined behaves like "in no groups."

### Terms of Service

Versioned markdown at `legal/tos-{version}.md`. The current version constant is `CURRENT_TOS_VERSION` in `src/lib/types.ts` — bump it when the document changes materially.

#### Acceptance flow

- **Signup** requires `acceptedTosVersion: CURRENT_TOS_VERSION` in the request body. The signup form on `/signin` ships the constant; an out-of-date client gets 422 instead of silently signing the user up.
- The signup hook records `{ version, acceptedAt }` at `users/{userId}/tos-consent.json`.
- **Every other way in accepts them at sign-in** (2026-09-29): EMAIL CODE and Strava create accounts with no Terms box, so `otp-verify` and `login` return `needsTerms` and the Strava callback redirects, sending anyone without the current version to **`/terms/accept?next=…`** (tick, CONTINUE, then on to `next`; `termsAcceptPath()` in `src/lib/terms-path.ts`). That also catches accounts from before the current version. A session that is already signed in isn't interrupted until its next sign-in.
- `GET /api/account/tos` returns `{ currentVersion, accepted, acceptances[] }` for the authenticated viewer.
- `POST /api/account/tos { version }` records an acceptance. Refuses anything other than `CURRENT_TOS_VERSION` (no future-version land-grab).
- Public ToS page at `/terms` rendered from the markdown source via `src/lib/markdown-lite.ts` (only the constructs the legal docs use: `#`/`##`, paragraphs, `- ` lists, `---`, `**bold**`, `` `code` `` — a `` `/path` `` code span renders as a link). A test asserts the current ToS parses with no raw Markdown left.

#### Bumping a version

1. Copy `legal/tos-{prev}.md` to `legal/tos-{new}.md`. Edit, including the `**Version NNN, effective …**` line (a test checks it matches).
2. Set `CURRENT_TOS_VERSION` in `src/lib/types.ts` to the new string. The signup form and tests read the constant — nothing else to bump.
3. **Email registered users** — the ToS (§9) promises this for every new version. Each user accepts the new version at their next sign-in (`/terms/accept`).

Current version: **002** (2026-09-28): adds Paddles/trackers/AI summary ("can be wrong"), stroke rate kept, and drops 001's false claims (re-accept prompt, version in footer, leaked "so we don't chase consents" reasoning).

### Make-public acknowledgement

Flipping a trial from `private` (or `group`) to `public` via PATCH requires `acknowledged: true` in the request body. Without it, the route returns 422 with `{ code: 'make_public_ack_required' }`. The owner has to explicitly tick a box; the ToS warns participants that performance times may become public, so we don't chase individual consents at the moment of the flip. Public → private and public → public are exempt — the gate only fires when widening visibility.

### Inbound email

Inbound mail (`privacy@`, `dmarc@`) and outbound bounce alerts are in `infra/CLAUDE.md` § Inbound email.

### Roles & Permissions

Authoritative permission matrix lives in `docs/features/groups-and-creation-gating.md` (the original visibility/clubs rules are in `visibility-clubs-tos.md`, superseded by the club→group rename + creation gating). Day-to-day summary:

| Action | Public | Private | Open trial | Invitational trial |
|---|---|---|---|---|
| View | Anyone | Owner only | — | Owner + invitees |
| Listed in catalogue / home | Yes, for everyone | Yes, but only for the owner | — | — |
| Edit / delete course or trial | Owning group's owner/admins | Owning group's owner/admins | — | — |
| Create a trial on it | Owning group's owner/admins (phase 2) | Owning group's owner/admins | — | — |
| Submit a trace | By `participation`: `public`→any viewer · `members`→group members · `invitational`→invitees (organiser always) | Owner only | — | Owner + invitees |
| Invite / uninvite | — | — | — | Owner only |
| View leaderboard | Anyone | Owner only | — | Owner + invitees |

A private invitational trial is visible to its invitees so they can see the leaderboard they're racing on; owners can still flip it to public if they want.

Enforced in three layers:
1. `src/proxy.ts` — rejects unauthenticated **mutations** at the edge (cookie check only). GETs always pass through; gating happens deeper.
2. `src/lib/permissions.ts` — single source of truth for `canViewCourse`, `canViewTrial`, `canManageCourse`, `canManageTrial`, `canCreateCourseInGroup`, `canSubmitToTrial`, `isListedForViewer`. All API routes + server pages call into these. **Never re-implement these checks inline.** `canManageCourse`/`canManageTrial` take the viewer's manageable-group set (owner/admin only) — fetch it once per request with `getUserAdminGroupIds(userId)` and pass it down (a resource with no `groupId` falls back to its `adminUserId` for the pre-migration window).
3. API route handlers + Server Components — call `getAuthUser()`, then a permissions helper. Private resources return **404 (not 403)** to non-owners so existence isn't leaked; invitational trials likewise return 404 (not 403) to non-invitees on upload so the guest list isn't leaked.

Story-style permission tests at `src/lib/permissions.test.ts`, `src/tests/courses.test.ts`, `src/tests/trial-visibility.test.ts`, and `src/tests/invitations.test.ts` are the regression net. Test titles mirror the matrix rows; any new permission check gets a paired story.

---

## App: Analyse

**Paddles** — what happened on each outing. Pages are in `apps/web/src/app/paddles/`; the domain (engine, store, summary, similar sections, trial and tracker sources) is **`@paddlesnitch/analysis`**; JSON goes through the tRPC routers in `packages/api/src/routers/` (`paddles.*`, `sources.*`, `similar.*`, `me`). Data lives under the `analysis/` S3 prefix, private per user. The code keeps the historical names `analysis`/`analyse`; the UI never shows them.

- **Pages**: `/paddles` is the ONE list (totals + every paddle as a tappable card; **Compare** switches the list into a tick-two mode with a sticky "Compare these two" bar; **delete lives in the paddle's ⋯ menu**, with a confirm) and the **signed-in home** (`/` redirects there unless a known `?campaign=` is given); `/paddles/library` and `/analyse/library` 308 to it. `/paddles/new` is Add paddle (a `Segmented` choice File / Strava / Trials / Tracker; files go in a dashed drop zone). On one paddle, actions are weighted by tier: Compare with… and Pick a section secondary; Notes, Boat, Share (copy link, download image, Strava, stop sharing) and Boat motion quiet; Hide from buddies + Delete paddle in the ⋯ menu. Every page uses the one `AppHeader` + `AccountMenu` (no per-section header or account adapter). Paddles pages use the design tokens, not hex. The `· STRAVA / · TIME TRIAL / · TRACKER` tag is `sourceLabel()` in `@paddlesnitch/core/paddles`.
- **Sources**: file upload (GPX/FIT/TCX/CSV/SpeedCoach/zip), **Strava import**, or **analyse one of your own time-trial results** (`@paddlesnitch/analysis/trials`, no re-upload), or a **tracker recording** (`@paddlesnitch/analysis/device-sessions`).
- **Engine** (`@paddlesnitch/analysis/analysis`, pure): speed + distance-per-stroke, **baseline+departures** segmentation (rests down / surges up), per-effort trend, set grouping, SUP→kayak ×2 stroke-rate (auto for kayak boat classes; manual toggle otherwise — default off). Map `points` are downsampled to ≤900 and **rounded** (`roundPoint`: lat/lng 6 dp, speed/dps 3 dp, t 0.1 s, sr 0.1) at build time — this + gzip cuts the analyse payload ~3× (≈31→10 KB gzip) with no precision loss that matters. `rescaleDoubling` re-rounds after the SR rescale. See "Payload sizing" under Ops.
- **Conditions**: real wind + river flow via `@paddlesnitch/timing`.
- **Persistence** (`@paddlesnitch/analysis/analysis-store`): auto-saves each paddle → `analysis/{userId}/{id}/session.json` (`AnalysisSession`), plus a ~2 KB **`summary.json`** beside it written by `saveSession` (and removed by `deleteSession`); lists (`listSessionSummaries`, `listPaddleCards`) read only summaries, building a missing one from the full paddle on first read. **Only `saveSession` may write a paddle's `session.json`** (`paddle-summaries.test.ts` fails otherwise), or its summary goes stale. Storage uses one S3 client per process. The Paddles list, saved view, diary notes, per-paddle **boat class + seat**, and a persistent **athlete profile** (`analysis/{userId}/profile.json`).
- **Duplicate detection** (#178): re-submitting the same paddle (same file re-uploaded, same Strava activity re-imported, or the same trace analysed twice) doesn't create a second library entry. `paddleFingerprint(paddledAt, durationS, distanceKm)` is a source-agnostic identity derived only from stored fields (so it also matches pre-existing sessions with no migration; distance rounded to whole metres, duration to whole seconds to absorb float noise). The `POST /analyse` route computes the incoming fingerprint after `analyseTrack`, checks `findDuplicateSession` (best-effort — a storage error degrades to a normal save, never a 500), and on a hit returns the existing paddle with `duplicate: true` (skipping the LLM call + save). ADD A PADDLE (`/paddles/new`) shows "You've already added this paddle" with OPEN IT → `/paddles/{id}` instead of rendering a fresh duplicate.
- **LLM summary** (`@paddlesnitch/analysis/llm`, `makeInsighter()`): Ollama local / **Bedrock prod** (never the Anthropic quota), model per env `LLM_MODEL`, bounded by `withTimeout` (`LLM_TIMEOUT_MS`); deterministic templated fallback when no backend, so it never breaks. Memory-aware via `history-stats.ts` (cross-history aggregates + relevance retrieval) + the athlete profile — the enrichment is best-effort and off the request's critical path, so it can never fail the analysis.
- **Paddles without a map (#414)**: a tracker paddle whose GPS failed carries `result.noGps` (and `noGps: true` on its summary, and on the buddies list projection). **Test it only with `isMotionOnly()` (`@paddlesnitch/core/paddles`)**, never with distance or points. Rules: it counts towards the paddle count, time on the water and streaks; it adds **nothing** to km (`paddleTotals`/`weeklyKm`/`monthKm`/`paddlingSummary` skip its km, and it is never "longest"); its own distance shows "—" (`paddleKm()`), never "0 km"; it is **never offered** for compare (`comparablePaddles`, the list's tick box, `groupSameOuting`, `isSameOuting`, the compare page), sections (`passesIn`, `sections.*` NOT_FOUND on it) or similar paddles (`toRacer`, `similar.*` NOT_FOUND on it), and gets no route squares (`cells.json` empty). The list and a buddy's list show a **NO GPS** tag (`components/paddles/NoGpsTag`) instead of the route thumbnail. Its page has no map, chart, pace, compare or section picking: PADDLING, DISTANCE —, STROKE RATE, STROKES (about), rests, the `noPaddleMessage` line, BOAT MOTION. The plain summary (`plainInsight` → `motionInsight`), the AI prompt (`buildPrompt` → `motionFacts`, told not to invent distance or pace), history lines (`historyBits`), the coach profile and the share card/title say only what the motion data shows.
- **Compare a section** (`@paddlesnitch/analysis/similar`): "race a section" across your own paddles between two derived gate lines, and a single-section "analyse this stretch" narrative.
- **Share a paddle (#202)**: an owner can opt a saved paddle into an **unlisted public link** and revoke it. `analysis-store.ts` `shareSession`/`unshareSession`/`getSharedSession` maintain a share index `analysis/shared/{shareId}.json → { userId, sessionId }` (so the token resolves to the owner's session without the userId appearing in the URL; idempotent — same link on repeat share; `deleteSession` drops the index; a stale index whose session no longer bears the token doesn't resolve). Owner procedures `paddles.share`/`paddles.unshare`; public `paddles.shared` (strips the private diary note — exposes result + boat only). **The shared view never shows the AI summary**: it is written from the owner's diary notes + coach profile and can repeat private text, so `paddles.shared` swaps in `plainInsight(result)` (the deterministic template, rebuilt from the saved numbers) and drops `insightModel`. The public page `/paddles/shared/[shareId]` renders `AnalysisView` in `readOnly` mode (no edit controls; "analyse your own" CTA). `AnalysisView` shows a `SHARE` control (owner only). No `AnalysisSession` schema change beyond an optional `shareId`.
  - **Share-card image + Strava helper (#212, P1+P2):** the shared route has an `opengraph-image` (`app/paddles/shared/[shareId]/opengraph-image.tsx`, `next/og`) — a branded 1200×630 card with the route polyline + distance/time/pace/rate + boat tag + wordmark + `paddlesnitch.com`. Pure data via `shareCard()` (`@paddlesnitch/analysis/share-card`, tested); missing/revoked link → a generic branded fallback (never leaks); sets `og:image` (X uses it as the twitter fallback — no `twitter-image`, which Turbopack can't statically read as a re-export). **No QR** — it needs a second device's camera, useless phone-on-phone; the click-through is the **tappable link** the owner pastes (Strava linkifies URLs) + the OG unfurl on social. SHARE panel: **DOWNLOAD IMAGE** (fetch the OG image → save) for all paddles, and for Strava-sourced ones an **OPEN MY STRAVA ACTIVITY ↗** deep-link (needs `stravaActivityId` on the owner's `ViewData.source`) + a paste-the-tappable-link nudge. See [`share-image-strava.md`](../../docs/features/share-image-strava.md).
- **Routes**: the one REST route is the upload/analyse pipeline, `POST /paddles/api/analyse` (multipart). Everything else is tRPC: `paddles.list/sessions/get/delete/setNote/setBoat/setDoubling/share/unshare/shared`, `sources.strava/trials/devices`, `similar.find/compare/sectionInsight`, `me`.
- **Key files**: `apps/web/src/app/paddles/api/analyse/route.ts` → `@paddlesnitch/analysis/pipeline` (`analyseAndSave`), `apps/web/src/components/analysis/AnalysisView.tsx` (the paddle view: site header, the map with only the colour scale + legend, replay bar and section picking over it, then the numbers, summary and efforts table below, actions beside (a compact row under the map on a phone); it replaced a full-screen map with floating panels in 2026-10. Adding a paddle goes to `/paddles/{id}`), `apps/web/src/components/map/AnalysisMap.tsx`. It runs on the one server Lambda (`ServerFn`); there is no separate Analyse Lambda any more.

Feature records: [`paddle-analysis.md`](../../docs/features/paddle-analysis.md), [`similar-sections-compare.md`](../../docs/features/similar-sections-compare.md), [`personable-insights.md`](../../docs/features/personable-insights.md).

## Ops & conventions

How to run the site, test it, and the conventions it follows. Deploys are in `infra/CLAUDE.md`.

### Development Workflow

> **Monorepo note.** One app now (`apps/web`, pkg `web`): `pnpm dev` = `pnpm --filter web dev` (:3000, serves every page and /api/trpc) and `pnpm test` = `pnpm --filter web test` (the whole suite — Trials + the merged Analyse tests + tRPC contract tests). There is no more `pnpm dev:analysis`.

#### Day-to-day

```
pnpm dev          # cognito-local on :9229, init, Next.js on :3000 (whole app)
# make changes
pnpm test         # vitest suite — must be green before shipping
pnpm build        # TypeScript compile check — no errors allowed
```

Run `pnpm seed` once after deleting `.local-data/` to get demo data back.

#### Before every deploy

Run this checklist in order. If anything fails, fix it first.

**Automated:**
```bash
pnpm test         # att vitest suite — parsers + Cognito auth + upload + courses + crew + pace/date + GDPR + password-reset + OTP + Lambda triggers + feedback widget + invitation email
pnpm build        # TypeScript — catches type regressions
```

The test suite covers the full upload pipeline end-to-end (GPX → parse → cross lines → leaderboard) and all auth flows. These are integration tests against a real temp filesystem and a real cognito-local; mocks are few (mainly `next/headers`, plus a handful of external SDKs and email).

**Manual smoke test** (run locally against `pnpm dev`; only needed for UI and map flows):

| Flow | When to check |
|---|---|
| Course creation | Any change to DrawingMap or course API |
| Trial open/close UI | Any change to admin pages |
| Leaderboard display | Any change to LeaderboardTable or splits rendering |
| Map dark/light toggle | Any change to map components |

Run the manual steps only for flows affected by your change. The automated tests cover auth, upload, parsing, and the core timing pipeline.

#### Deploy sequence

Push to `main` deploys (GitHub Actions: test → build → CDK deploy). The deploy guards, the smoke test and the manual deploy are in `infra/CLAUDE.md` § Deploy sequence.

#### Test coverage gaps (known)

These flows have no automated tests yet:
- Magic link auth (currently disabled — re-add tests when the Lambda triggers ship)
- Map components (UI only — manual)

When fixing a bug in any uncovered area, add a regression test at the same time.

### Local Development

```bash
pnpm dev        # starts cognito-local + creates pool/client + starts Next.js, all in one terminal
pnpm seed       # wipes .local-data + Cognito users; reseeds 8 users / 2 courses / 3 trials / 13 entries
pnpm rivers     # downloads UK river GeoJSON → public/data/rivers.geojson (run once)
pnpm test       # att vitest suite (spawns its own cognito-local on :9230)
pnpm test:watch
```

`pnpm dev` (`scripts/dev.ts`) orchestrates the stack: if cognito-local is already running on `:9229` it reuses it, otherwise it spawns one. Then runs `pnpm cognito:init` (idempotent — creates pool/client + writes `.env.local`), then starts `next dev`. Ctrl+C cleans up both processes. Output is tagged `[cognito]` / `[next]` / `[info]`.

Other scripts:
- `pnpm cognito` — bare cognito-local (use if you want to run it in a separate terminal)
- `pnpm cognito:init` — re-run pool/client init (rarely needed; `pnpm dev` does this)
- `pnpm next` — bare `next dev` (assumes cognito-local is already up)

`.env.local` is written by `pnpm cognito:init`. You can edit it but the COGNITO_* vars will be overwritten if you re-run init:
```
NODE_ENV=development
USE_LOCAL_STORAGE=true
COGNITO_ENDPOINT=http://localhost:9229
COGNITO_USER_POOL_ID=local_xxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=eu-west-1
```

The pool ID and client ID are stable across restarts as long as you don't delete `.cognito/`.

**Reset everything**: `rm -rf .local-data .cognito` then `pnpm dev` (recreates pool), then `pnpm seed` (creates users + demo data).

No Docker, no AWS creds needed for normal dev.

#### Seed data (pnpm seed)
Creates demo data in `apps/web/.local-data/`. Safe to re-run: it wipes `.local-data` and the Cognito users itself first. It also creates a group, "Reykjavík Rowing Club".

| Account | Email | Password |
|---|---|---|
| Admin (course owner) | admin@rrc-tt.is | Password123 |
| All others | {name}@example.is | Password123 |

Courses: **Elliðaár 1000m Sprint** (both sports) · **Reykjavik Harbour 500m** (kayak)
Trials: Spring Sprint 2025 (closed) · Summer Championships 2025 (closed) · Harbour Race 2025 (open)

#### Example trace files
`examples/traces/` — drop `.gpx`, `.fit`, or `.csv` files here as reference inputs. Not uploaded automatically; use the upload UI against an open trial.

### Testing

Use **Vitest**. Vitest `globalSetup` spawns its own cognito-local on :9230 so auth/upload/courses tests run against the real Cognito SDK surface (mocks are few: mainly `next/headers`).
- `src/lib/geo.test.ts` — haversine, line crossing, processTrace, formatTime
- `src/lib/gpx.test.ts` — GPX parser unit tests
- `src/lib/fit.test.ts` — FIT parser unit tests (mocks fit-file-parser)
- `src/lib/csv.test.ts` — CSV parser: flexible columns, all timestamp formats, edge cases
- `src/tests/auth.test.ts` — integration: signup, login, logout, /me against cognito-local (mocked cookies only)
- `src/tests/upload.test.ts` — integration: full upload pipeline → leaderboard (real filesystem + cognito-local)
- `src/tests/cognito-test-server.ts` + `src/tests/global-setup.ts` — spawn the test cognito-local instance, create pool/client, set env

Pattern: pure lib functions get unit tests; API routes get integration tests against real temp filesystem + real cognito-local. Mock what leaves the process (Next's `next/headers`, outside HTTP: weather, river flow, Strava, the AI model, email) or what can't run locally (S3's own API, in `storage-s3.test.ts`); keep storage and Cognito real. Staying signed in (the silent refresh in `getAuthUser()`) is covered by `auth-refresh.test.ts`.

Run: `pnpm test`

### Test pyramid

Two tiers. Don't blur them — they catch different bugs and the cost profiles are very different.

| Tier | Lives in | What it catches | Cost |
|---|---|---|---|
| **Unit + integration** (vitest) | `src/lib/*.test.ts`, `src/tests/*.test.ts` | Pure-function correctness, route-handler behaviour, every row of the permission matrix as a story-style test name | ~2 s for the whole suite |
| **E2E critical paths** (Playwright) | `e2e/critical/*.spec.ts` | Real-browser cookie flows, form-to-route-to-page round trips, redirect chains, multi-page navigations. Includes adding a paddle from a file (open it, find it in the list) and Download my data | ~30 s per scenario; keep it to the flows that matter most |

#### Run

```bash
pnpm test          # the whole vitest suite (a few seconds) — see the monorepo note below
pnpm e2e           # headless Playwright (runs pnpm dev under the hood)
pnpm e2e:ui        # Playwright UI mode — for debugging failing tests
pnpm e2e:install   # one-time install of the chromium browser
```

CI: **every pull request** runs `checks.yml` (vitest, `pnpm typecheck` over the app, packages and test files, `pnpm lint` (errors fail; `.open-next/` is ignored; 0 warnings since #410, and `react-hooks/set-state-in-effect` is an error: load with a tRPC query or set state in the fetch callback, read browser-only values with `useSyncExternalStore`/`useIsClient`), infra `tsc`, firmware host tests when `firmware/` changed, and the recorder-core fixtures on gcc, clang and macOS clang with the sanitizers) and `e2e.yml` (Playwright). After a merge, `deploy.yml` runs vitest again before deploying. Until 2026-10-08 PRs ran only Playwright, so a failing unit test or a type error in a test file could merge (#381, #393). `pr-checks.test.ts` pins it. The Playwright workflow caches `~/.cache/ms-playwright` keyed by the package version, so cold runs only pay the ~90 MB Chromium download on a version bump.

#### Discipline

- **Permission rules belong in vitest, not Playwright.** Every "X can/cannot do Y" check is cheaper, more deterministic, and more readable as a story-style unit test. E2E is for flows that span multiple pages or rely on real browser behaviour (cookies, redirects, client-side navigation).
- **Accessibility:** `e2e/critical/accessibility.spec.ts` runs axe (from the `axe-core` dev dependency) on every public page; a new public page goes in its list. Rules in [`design-system.md`](../../docs/features/design-system.md).
- **One critical path per spec file.** Keep specs focused so a failure points directly at one broken flow.
- **No shared state between specs.** Each test creates its own user via `signUpFlow()` (in `e2e/helpers.ts`) with a unique email. Don't seed shared data across runs.
- **When a vitest story would suffice, write the vitest story.** Reserve Playwright for things vitest physically can't reach.
- **axe runs on every public page and, signed in, on `/paddles`, `/plan`, `/att`, `/account`, `/devices`, `/buddies`, `/profile/me`** (`e2e/critical/accessibility.spec.ts`, #510): unlabelled controls, a missing main landmark or anything serious fails. A trial page's course map has a text equivalent (`courseLinesText`).

Failure artifacts (trace, screenshot, video) upload as `playwright-report` on a failed CI run; viewable inline in the Actions UI. Locally: `pnpm exec playwright show-report` after a failed run.

### Map Notes

- **Drawing**: `DrawingMap.tsx` uses click-to-place. Click "SET START LINE", click 2 points across the river, line is drawn. Repeat for finish. Lines can be reset. No Leaflet.draw dependency.
- **SSR**: All Leaflet components are `'use client'`. Server Components that need a map use `CourseMapClient.tsx` which wraps `CourseMap` in `next/dynamic` with `{ ssr: false }`. Direct `ssr: false` in Server Components is not allowed in Next.js 16.
- **Icons**: Leaflet default marker icon URLs are patched on import (webpack breaks the default paths).
- **Tiles**: **Esri Gray Canvas** (keyless raster) — att maps toggle World_Light_Gray_Base ↔ World_Dark_Gray_Base (course maps start dark, the drawing map light); analyse maps are Dark Gray only. `maxNativeZoom={16}` (Esri's native cap) + `maxZoom={19}` so Leaflet upscales beyond 16 instead of 404ing. Swapped off CARTO's free basemaps, which started serving an "API key required" nag tile once an IP passed their informal limit. River layer recolours to match: cyan neon on dark, blue on light.
- **River overlay** (opt-in): `RiverLayer.tsx` renders `/data/rivers.geojson` (OSM UK data, `pnpm rivers`) as non-interactive cyan (`#06b6d4`) lines with a neon glow behind the course lines. Line weight/opacity scales by waterway type (`w` property: `river` | `canal`). **Gated behind `NEXT_PUBLIC_RIVERS=1`** and off by default: the geojson is gitignored and not deployed, so fetching it 404s in dev / 403s in prod — a console error on every map. The component skips the fetch entirely unless the flag is set, so the overlay is a no-op (no error) until someone generates the file, deploys it as an asset, and sets the flag.
- **Coordinates**: `[lat, lng]` throughout — NOT GeoJSON order.

#### River data
`public/data/rivers.geojson` is gitignored (16.5 MB raw, ~3.3 MB gzipped). Regenerate with `pnpm rivers`.

Source: OpenStreetMap via Overpass API — UK rivers and canals (60,065 features). Streams omitted (visible on the dark base tile). Simplified at 0.001° tolerance (~100 m) for browser performance. The `w` property is `river` or `canal`.

The script requires a `User-Agent` header; Overpass blocks the default Node.js UA.

### Web conventions

- `next/dynamic` with `{ ssr: false }` must only appear inside `'use client'` components. Use `CourseMapClient.tsx` pattern.
- **`src/proxy.ts` puts `pathname + search` in `next`, not just the path.** It
  used to set the pathname alone while the cloned URL kept the original query,
  so `/account?code=ABC123` redirected to
  `/signin?code=ABC123&next=/account` and the parameter was
  silently dropped on the way back. That broke device scan-to-link for anyone
  not already signed in, and it affected every gated page with a query string.
  Covered by a regression test in `proxy.test.ts`.
- **Never store `useSearchParams()` values in `useState`** — the state initialises before the effect that reads params, causing race conditions. Derive values directly: `const next = searchParams.get('next') ?? '/att'`.
- **Route prefix `/att` is baked into the source** (`src/app/att/`) — no Next.js `basePath` config. All `href`, `fetch()`, and `router.push()` calls include `/att` explicitly.
- **Discovery (#513):** `/robots.txt`, `/sitemap.xml` (public pages + public trials/courses only) and `/llms.txt` come from `src/lib/discovery.ts`; public trial pages carry schema.org `SportsEvent` JSON-LD. Keep `LLMS_TXT` in step with the `/plan` link parameters on `/help`.

### Marketing campaign landings (`/?campaign=<id>`)

`src/lib/campaigns.ts` lists the ids (`CAMPAIGN_LANDINGS`); `src/app/page.tsx` maps each to a landing (`LANDINGS`) and optional title/description/share image (`CAMPAIGN_METADATA`). An unknown id falls back to the default landing and is logged (`[campaign] …`). **A known campaign is shown to signed-in visitors too** (people share these links; the dashboard only replaces the DEFAULT landing).

- **`betatesters`** — tracker beta-tester recruitment. The tracker video (`public/campaigns/betatesters.mp4`, 720p/24 fps/no audio, ~4.9 MB; poster `.jpg`) loops muted behind a one-card carousel of four messages (what it is → "This is what the snitch tells you" (GPS watch / stroke coach basics + pitch, roll, side-to-side evenness; a cropped boat-motion screenshot `public/campaigns/betatesters-what-you-get.png` → you paddle, weekly questions + up to 60 min interview, keep the tracker (£60 value) → fixed in place, case not waterproof, zip-lock bag on request) (`BetaSlides.tsx`: side arrows, dots, keyboard ←/→, swipe; all cards in the HTML, stacked in one grid cell so the frame and button never jump, inactive ones `invisible` + `inert`; swipes are caught on the whole card area incl. the phone arrows; on the last card a ↓ arrow and the button bounce, `motion-safe` only) and a **CLICK TO SNITCH** button that opens the application form in a one-column pop-up (`src/components/campaigns/BetaApplyModal.tsx`; closes on ✕/Escape/backdrop; form: name, email, sport, how often — no note, no tick boxes; submit is SIGN ME UP). Requirements stated on the page: they paddle/row regularly, and the tracker sits firmly in the boat (attached is best; it measures boat movement) and stays reasonably dry. `POST /api/beta-signup` (public; outside the proxy's mutation gate; `looksLikeBot` gated) stores `beta-signups/{sha256(email)}.json` — one record per email, a re-apply updates it — and emails a notification to `privacy@` (`BETA_NOTIFY_TO`), best effort. Covered by account delete + export (matched on the account email) and listed on the privacy page. List them: `aws s3 ls s3://paddlesnitch-data-prod/beta-signups/`. **Measured on the `paddlesnitch-health` dashboard** ("Campaigns: visits → button clicks → sign-ups"): a page view that arrived on a `?campaign=` link carries a `campaign` prop (`campaignFrom()` in `@paddlesnitch/ui/metrics-events`: lower-cased, plain ids only, unknown ids kept so a mistyped link shows up); CLICK TO SNITCH sends `campaign_cta`; a saved application emits `campaign_signup` server-side (`repeat` = someone updating theirs; bots never reach it). All are props on the one `Event` dimension, so no new per-value metrics. Client events only fire in production builds.

### Product analytics (CloudWatch EMF)

Custom product events flow to CloudWatch metrics via **Embedded Metric Format** — `emitMetric(event, props?)` in `src/lib/metrics.ts` writes one EMF JSON line; in the Lambda runtime CloudWatch auto-extracts a `Count` metric (namespace `Paddlesnitch/App`, dimension `Event`) with **no metric filters, no log parsing, no extra IAM**. Locally/in tests it's a harmless `console.log`.

- **Cardinality discipline:** the only metric dimension is `Event` (fixed allowlist in `METRIC_EVENTS`: `pageview`, `signup`, `login`, `upload`, `trial_create`, `course_create`, `campaign_cta`, `campaign_signup`). High-cardinality context (page `path`, session `sid`) is attached as a plain property — queryable in Logs Insights but does **not** create per-value metrics.
- **Server events** (`signup`, `login`, `upload`) are emitted directly in those routes and are **always on in production** — no flag — so they can't be spoofed and start flowing on first deploy. Cost is ~6 custom metrics (~pennies/month).
- **Client events (buffered + batched):** the capture lives in **`@paddlesnitch/ui/analytics`** (`capture(event, props?)`), and the root layout mounts the shared **`@paddlesnitch/ui/Analytics`** component (via the shim `@/components/Analytics`). `capture()` appends to an in-memory queue and **flushes a batch** to `POST /att/api/track` on whichever comes first: a timer (`flushIntervalMs`, 15 s), the queue hitting `maxBatch` (20), or the tab being hidden/closed (`visibilitychange→hidden` / `pagehide`, via `navigator.sendBeacon`). The `Analytics` component records a `pageview` (with `window.location.pathname`) on each route change. **On in production builds**, off in dev/test; `NEXT_PUBLIC_ANALYTICS=0` is the kill switch (tuning knobs on `_config`). No PII: only event, path, small string props, and a random per-tab `sid`. Vocabulary is a **strict allowlist** — the single source of truth is **`@paddlesnitch/ui/metrics-events`** (`METRIC_EVENTS`), re-exported by att's `src/lib/metrics.ts` (which keeps the server EMF `buildEmf`/`emitMetric`); enforced client-side (dropped before queueing) AND server-side. To add an event, add it to `METRIC_EVENTS`, then `capture('your_event')`. att keeps a re-export shim at `@/lib/analytics`.
- **Track endpoint (`POST /att/api/track`):** accepts a **batch** `{ sid, events: [{ event, t?, path?, props? }] }` (and a legacy single `{ event, path, sid }` for back-compat). Per allowlisted event it emits one EMF line via `emitMetric(event, props, timestamp)`, using the event's own capture time `t` (validated to CloudWatch's accepted window, else now) so a batch flushed later still lands in the right minute. Non-allowlisted events dropped; caps: ≤100 events/batch, ≤10 props/event, values truncated. Unauthenticated by design; always 204. **`src/proxy.ts` must exempt `/att/api/track`** (alongside `/att/api/feedback`) — the mutation-auth-gate would otherwise 307-redirect every signed-out beacon to `/signin`, dropping all anonymous traffic (regression covered in `proxy.test.ts`). Being public + unauthenticated, it guards against random/bot pings with an **Origin allowlist** (`isAllowedIngestOrigin`, `src/lib/ingest-origin.ts`): a ping whose Origin/Referer isn't one of our own origins is dropped (still 204, no signal). This is a cheap first line, **not integrity** — the header is spoofable; the strict event allowlist + per-request caps are what bound the actual damage (count-skew only, no arbitrary metrics). Rate-limiting/WAF or a signed nonce would be the next step if abuse appears. **Apps send no Origin**: a request with a well-formed `x-paddlesnitch-app` app header is accepted instead (same honest ceiling). Every event is stamped with `platform`/`appVersion`/`build` from the request (client props with those names are ignored). The operational events `app_open`, `crash_report` (fixed fields only, shaped by `src/lib/client-errors.ts`; contract in `mobile/contract/telemetry.md`) and `client_error` (browser errors from our own scripts only, ≤5 per page, via `reportClientError` in `@paddlesnitch/ui/analytics` and the `error.tsx` page) are on the allowlist. **Game events** (`game_play`, `game_kit`, `game_session`, built by `games/reading-thames/metrics.js`, sent by `games/shared/analytics.js`): what was played and chosen, never who. Only the keys in `GAME_EVENT_PROPS` (`@paddlesnitch/ui/metrics-events`) pass, and only short plain values (`gameEventProps`: the game's own set for a fixed choice, numbers as numbers, otherwise lower-case words; a page under `/games` as the path; at most 10 keys, the route's cap), so no colour, skin tone or anything typed reaches the logs (`track-route.test.ts`). Shown on `paddlesnitch-health` (the four "Game …" tables). Each event name is one more `Event` metric (~$0.30/month).
- **Dashboard:** the web part of the `paddlesnitch-health` dashboard (it replaced `paddlesnitch-app`; defined in `infra/lib/dashboards.ts`, with every other dashboard) charts product events/day + period totals, **pageviews & key events per hour** (recent/sparse batched beacons show here where the daily view hides them), two **Logs Insights** tables over the server Lambda log group — **pageviews by path** ("what people look at") and **events-by-type + distinct sessions** — and server-Lambda invocations/errors/p95. The Logs Insights widgets reference the log group by name (`/aws/lambda/${serverFn.functionName}`) so no LogGroup resource is created/adopted. The `DashboardUrl` stack output links to it. EMF metrics populate once events fire; the Logs Insights widgets need log data in the selected range.
- **Not built yet (deliberate):** session heartbeats — add later if wanted. (Alarms now live under Operational telemetry below.)

### Performance check

`pnpm perf` (`apps/web/scripts/perf.ts`, logic in `src/lib/perf.ts`) times the public pages (home, Trials, Courses, Help, Guide, Sign in, Privacy, plus one real trial and course found from the lists) 5 times each and **always reports**: a Markdown table (median time to first byte, p95, the first run separately since it may be a cold start, whole-page time, size, budget), `perf-results.json`, and `perf-metrics.json` for CloudWatch. It also checks a built file carries `immutable`. Budgets warn; `--strict` makes them fail. `--base http://localhost:3000` times a local server. With `PERF_EMAIL`/`PERF_PASSWORD` it also signs in as the **test account** `perf-check@paddlesnitch.com` and times Paddles, a paddle, and the data behind them (`paddles.sessions`, `paddles.get`, tracker recordings, boat motion), and checks a repeat boat-motion view is a 304. The account is set up by `scripts/perf-account.ts` (idempotent: one file paddle, a pretend tracker `F00DCAFE` with the 13 Sep capture as one recording); its password is the SSM SecureString `/att/perf-check-password`, which the workflow reads (masked) and the perf role may read — that one parameter only.

`.github/workflows/perf.yml` runs it after every successful deploy, daily at 06:17 UTC and by hand. The table lands in the run's summary, the JSON as an artifact, and the timings in CloudWatch (`Paddlesnitch/Perf`, metric `TTFB`, dimension `Page`; one metric per page, ~$0.30/month each) through **`att-github-perf`**: a role trusted only in the `perf` environment that can only `PutMetricData` in that namespace and read the test account's password (not the deploy role). The role's ARN is the repository variable `AWS_PERF_ROLE_ARN`; without it the check still reports, it just doesn't send. Dashboard **`paddlesnitch-performance`**: check timings per page, server Lambda p50/p95/p99, cold starts per hour (Logs Insights over the REPORT lines), CloudFront 4xx/5xx rates and requests (us-east-1 metrics). **The server runs on Graviton (arm64) and is kept warm** (2026-10-08, performance.md phase 3): an EventBridge rule `ServerWarmer` sends OpenNext's `{type:'warmer'}` event every 5 minutes, which the handler answers in 75 ms without running Next (~$0.10/month). Warmer calls show up in the Lambda invocation/duration charts (288 a day, ~75 ms each). Review cold starts after 1–2 weeks; provisioned concurrency only if they still hurt. Both are one-line reverts, pinned by `server-warm.test.ts`. `perf-setup.test.ts` keeps the dashboard's pages, the role's scope and the workflow's always-report steps in step.

### Data in the first HTML

`/paddles`, `/paddles/[id]` and `/devices` are server pages (performance.md phase 2, 2026-10-08): they run the same tRPC procedures in process (`prefetch()` in `apps/web/src/lib/trpc-server.ts`, keys checked against `getQueryKey`) and pass the answers to the client's query cache through `HydrationBoundary`; the old client pages live on as `components/paddles/PaddlesList`, `SavedPaddle` and `components/devices/DevicesView` (which takes `initial`). Prefilled queries use `staleTime: PREFILLED_FRESH_MS` (`lib/fresh.ts`) so the browser doesn't fetch them again on mount; a failing procedure is left out and the client asks as before. `GET /api/account/devices` and the page share `lib/device-list.ts`; its `summaries` (each card worked out for the apps: counts, firmware state, quiet, a recent crash) come from `trackerSummaries` in `lib/device-view.ts`, over the same `deviceSummaries`/`deviceIsBehind`/`deviceIsQuiet`/`crashNote` the page uses, so the apps and the page can't disagree. **Anything these pages render on first paint must come out the same on the server and in the browser**: dates use `fmtDay`/`fmtWeekday`/`fmtMonth` from `@paddlesnitch/core/format` (UTC, month names spelled out), never `toLocale*`, or React reports a hydration mismatch. Covered by `src/tests/first-html.test.ts`. The header's account menu still asks `/att/api/auth/me` itself.

### `after()` does NOT run after the response here

OpenNext's buffered `aws-lambda` wrapper passes no `waitUntil`, so Next's `after()` work is awaited **before** the Lambda returns (`finally { await pendingPromises }` in the server bundle): the response waits for it. Found 2026-10-08. Consequences: anything slow in `after()` delays its response. So **no AI call happens while anyone waits**: `analyseAndSave` (every way a paddle arrives: ADD A PADDLE, Strava auto-import, tracker recordings) always saves with the plain summary and `insightPending: true`, and `reanalyseAndSave` (a tracker paddle's motion landing) marks it pending again. The paddle page (`SavedPaddle`) calls `paddles.writeSummary` once per visit, showing "Writing your summary…" (`writePendingSummary` in `@paddlesnitch/analysis/pipeline`: re-reads the paddle before saving so a note written meanwhile is kept and a deleted paddle stays deleted, then folds it into the athlete profile; asking again costs no AI call). **Trade-off:** a paddle never opened has only the plain summary and isn't in the athlete profile. **Don't use `after()` for slow work: write a job.** Since #413 the Strava webhook and the tracker upload routes answer straight away and the work runs as a job (`apps/web/src/lib/jobs.ts`, owner's choice: **the S3 to-do folder, no queue service**):
- `enqueueJob(kind, payload, { notBefore? })` writes `jobs/{kind}/{id}.json` (await it before answering).
- S3 announces new files under `jobs/` to the **jobs kicker** (`infra/lambdas/jobs-kicker`, plain JS, holds only `SITE_URL`), which calls `POST /api/jobs/run { key }` on our own server, so jobs run with the server's code and settings.
- The 5-minute `JobsSweep` timer calls `POST /api/jobs/sweep`: retries (backoff 1/2/4/8 min), `notBefore` jobs, lost announcements; it leaves jobs under a minute old to their announcement.
- A job deletes its file when done. Attempts live in `jobs-state/` (outside `jobs/`, so writing them never announces a new job). After 5 failed attempts it moves to **`jobs-failed/`** with the last error (both expire after 30 days). The folders are the visible record.
- **Jobs must be safe to run twice** (S3 can announce twice; a lease of 3 min stops overlapping runs). Both kinds are: `tracker-paddle` (fixed paddle id) and `strava-event` (`processStravaEvent` in `lib/strava-webhook.ts`, de-duplicated imports; it throws on failures worth retrying).
- The run/sweep endpoints are **public on purpose** (they only run jobs that already exist as files; harmless twice; rate-capped) and exempt from the proxy's mutation gate by being outside `/att/api` and `/api/account` (`proxy.test.ts`).
- Local dev has no S3 events: a new job runs in-process at once. Tests run jobs themselves (`runJob`/`sweepJobs`; `jobs.test.ts`).
- To add a kind: add it to `Handlers`/`HANDLERS` and the `KEY` pattern in `jobs.ts`. Tests: `src/tests/summary-after-open.test.ts`, `SavedPaddle.test.tsx`.

### Operational telemetry (observability)

What breaks and for whom, across web, Android, iOS and trackers ([`observability.md`](../../docs/features/observability.md)). All in `@paddlesnitch/core/observe`; every line is an EMF document (metrics with no metric filters; Logs Insights sees every property).

- **Which client:** the apps' existing `x-paddlesnitch-app: android/0.1.0` header (the one that makes sign-in answer with tokens; optional build `android/1.0.3 (42)`), sent on every request; `clientOf(headers)` → `web` (no header) / `android` / `ios` / `other` (junk). Server-side callers set `tracker` or `server` themselves.
- **API calls:** the outermost tRPC middleware (`packages/api/src/trpc.ts`) logs one `api_call` line per HTTP call (`Paddlesnitch/Api` `Calls` + `ServerErrors`). Only server codes (`INTERNAL_SERVER_ERROR`, `TIMEOUT`, …) count as errors; caller mistakes (`UNAUTHORIZED`, `BAD_REQUEST`, …) never do. In-process calls (SSR, tests) aren't logged, because only the HTTP mount puts `client` on the context.
- **Actions:** `sign_in`, `upload`, `analyse`, `device_sync` and `strava_import` each log one `action` line per attempt with outcome `ok` / `rejected` (the user's input refused, expected) / `fail` (we broke). REST routes use `withAction(action, handler)` (`src/lib/action.ts`: 4xx = rejected, 5xx or a throw = fail). **A new user-facing flow that matters gets wrapped too.** (The word "journey" is banned by the copy style guide, hence "action".)
- Never user ids, input, coordinates or error-message text in these lines.
- **Alarms (zero tolerance, first one in 15 min):** `paddlesnitch-api-errors`, `-action-failed`, `-app-crashes`, `-browser-errors`, and `-server-errors` (any `console.error`). **Daily digest** at 07:00 UTC (`infra/lambdas/error-digest/`, pure queries + formatting in `digest.mjs`): every error of the last day grouped, or an all-clear; `paddlesnitch-digest-failed` if it doesn't run. Logs Insights query strings joined by hand need `\n| ` between commands (CDK's `queryLines` adds the pipes itself).
- **Dashboards (the free three):** `paddlesnitch-health` (open first), `paddlesnitch-api`, `paddlesnitch-firmware`, all in `infra/lib/dashboards.ts`.

### Payload sizing

API responses are **gzipped on the wire** (origin/Next; CloudFront only compresses cacheable responses, and the API behaviors are `CACHING_DISABLED`). The only fat payloads are the ones carrying per-point GPS arrays: the **analyse result** `points` (`POST /paddles/api/analyse`, tRPC `paddles.get`) and the ATT **`trackSegment`** (`GET /att/api/entries/[entryId]` + trial-page SSR). Leaderboard rows (splits only) and the sessions **list** (summaries, no points) are already tiny.

**A binary protocol is the wrong tool here** — measured on a real 856-point trace, a Float32 blob is *larger* after gzip (12.4 KB) than rounded JSON (10.2 KB), because full-precision float bits are ~incompressible while rounded decimals compress beautifully. The lever is **numeric precision, not encoding**: rounding at the source (`roundPoint` in `analysis.ts`; `round6` in `geo.ts`) + the existing gzip cut the analyse payload ~3× (31→10 KB) and trackSegment ~2.8× (12.5→4.5 KB), staying plain JSON (curl/devtools-inspectable, no codec, no schema). Reserve any binary/columnar work for a specific endpoint only if a future measurement proves it matters.

The **network is also published one link per line** (`network.ndjson.gz`, `ndjson.ts`) and the server streams it (`readNetwork`, falling back to `network.json.gz` for older versions): parsed as one ~120 MB string it peaked near 1 GB with Germany; streamed, ~0.35 GB lower overall (measured 1.6 → 1.23 GB peak). Keep the JSON copy until no live code reads it.

**River planner map data is cached at CloudFront** (`/plan/data/*` behaviour, own `PlanDataCache` policy: origin TTLs, nothing from the viewer in the key; NOT the managed UseOriginCacheControlHeaders, which forwards Host and gets a 403 from the function URL): the route marks the live version's network data (`overview`, `area-*`, `tides-nl`) immutable and `coverage`, `coverage-lines` (an index of chunks per level) + `coverage-lines-{level}-{i}` (≤2 MB chunks), `needed` (which move with contributions and plans) 5 minutes, and CloudFront keeps what it says. Never set a cookie on that route: a cached response is shared. **Lambda answers at most 6 MiB, counted before compression**: a bigger response is a 502 (it hit `places` with France and `coverage-lines` with Germany). Chunk anything that grows with the network: `coverage-lines` and `overview` (`overview-chunks` + `overview-{i}`, ≤2 MB each; the whole `overview` stays for tabs running older code and will 502 once it passes the limit).

### Devices (hardware trackers): the rules

The full reference (pairing, uploads, OTA, fleet, Bluetooth, crash reports, the paddle a recording becomes) is [`docs/features/devices-platform.md`](../../docs/features/devices-platform.md): read it before changing a tracker route, `/devices` page or `@paddlesnitch/core/devices`. Motion maths (diagnostics, stroke rate, attitude) is in `packages/timing/CLAUDE.md`; the firmware side in `firmware/CLAUDE.md`. The rules that bite:

- **Auth paths never merge.** `getAuthUser()` (cookie), `getDeviceAuth(req)` (device Bearer) and `getRequestUser(req)` (the apps' Cognito Bearer or the cookie). A device token must never satisfy a human route, or the reverse.
- **Every route that takes a tracker's token goes through `withDeviceAuth`** (`src/lib/device-route.ts`): it stamps `X-PS-Firmware` on every response and calls `touchDevice()`. An absent header means "no opinion", not "you are current".
- **Lists come from the per-user index** (`users/{id}/trackers/`, `users/{id}/recordings/`). Never write `users/{id}/device-index.json` from an upload, or an older account's unindexed recordings vanish.
- **Claims are keyed by `deviceId`; one outstanding claim per tracker.** `linkClaim` re-checks `claim.claimCode === code`; binding needs the tracker's own signature, so new trackers must be enrolled (`firmware/tools/enroll.sh`).
- **The tracker rate limits are measured from the firmware's polling, not chosen** (`src/lib/device-limits.ts`). Validate before limiting. The limiter fails open: a speed bump, not a brute-force defence.
- **Uploads reuse `parseTrace()` unchanged**: the CSV column names are load-bearing, and a row without a fix has empty `lat`/`lon`, never `0,0`.
- **Every upload is chunked in 64 KB pieces, the same over WiFi and Bluetooth** (`UPLOAD_CHUNK`). Change the size and a resumed upload mixes two cuttings. Delete staged parts only after the assembled file is written; the `sha256` covers the whole file.
- **`deviceId` is a log property, never a CloudWatch dimension** (a dimension bills per value).
- **`GET /api/account/devices` projects named fields**: never send `tokenHash` to the browser. A removed tracker keeps its card (its recordings are still the user's).
- **A recording's report (`GET /api/account/devices/sessions/[id]`) answers an app (`x-paddlesnitch-app`) only `{attitude, cadence}`** (`Vary` on that header), never the raw GPS rows of Technical details; the contract's boat-motion fixtures are rebuilt from the route by `boat-motion-fixtures.test.ts`, and `boat-motion-readme.test.ts` checks the README quotes the website's words.
- **Tracker pages speak to paddlers**; engineering detail sits under Technical details (`src/lib/tracker-copy.ts`). Guide drawings (`src/lib/tracker-screens.ts`) must match the firmware's text; `tracker-screens.test.ts` says which to update.
- **Phones (C3) are devices too:** ID `P` + 16 hex (`isPhoneId`; `isTrackerId` is the 8-hex tracker check, used by every claim, token and key path), added by `addPhone` (`POST /api/account/devices/phone`, the ID from account + install ID; never overwrites another account's record), with no claim and no token. They upload through `POST /api/account/devices/[deviceId]/sessions` with no receipt, list under "Your phones" on Devices (`kind: 'phone'`, never quiet, no firmware), and export and erasure cover them as trackers. `phone-recording.test.ts`. The browser copy of the check is `isPhoneDeviceId` in `device-view.ts`.
- **Platform admin is `ADMIN_USER_IDS`**; unset means nobody. Admin API routes stay out of `proxy.ts`.
- **Changing `ble_about.h`, `BLE_LAYOUT`, `UPLOAD_CHUNK`, `tracker-ble.ts` or `uploadReceipt`** means updating `mobile/contract/fixtures/tracker/` (`tracker-ble.fixtures.test.ts` fails otherwise).
- **A merge releases firmware to beta, not stable.** Stable is a manual flip, refused until a tracker has reported a good start (`firmware-release.yml` header). When OTA "didn't update", check `firmware/channels/` first.
- **Debugging a tracker: read "Debugging the device" in the reference before theorising.** `n=0` during a sync is deliberate.

### Games

The `/games` page, how CloudFront serves the games, and the game API and relay are in `games/CLAUDE.md` § The site side.
