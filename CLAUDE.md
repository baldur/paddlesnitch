# paddlesnitch — paddling platform

A monorepo for **paddlesnitch**, a web platform for paddlers (kayak, canoe, SUP, rowing). Two Next.js apps share two internal packages, one Cognito user pool, one S3 bucket, and one CloudFront distribution:

- **ATT — Automated Time Trials** (`/att`): GPS-timed river time trials. Organisers draw start/finish lines on a map; participants upload GPS traces; the system computes elapsed time, 500 m splits, and stroke rate.
- **Analyse** (`/analyse`): paddle-session analysis — "what actually happened on this outing, and what it means" — with an LLM coach narrative.

This file is the source of truth for *current* behaviour. It's organised as: **Working with Claude** (how to work in this repo) → **Platform & monorepo** → **Shared packages** → **App: ATT** → **App: Analyse** → **Ops & conventions**.

## Working with Claude

After completing any task that changes behaviour, adds a feature, or introduces a new convention: update this file and the memory files in `~/.claude/projects/…/memory/` to reflect the new state. Do not wait to be asked.

### General coding guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

#### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

#### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

#### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

#### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

#### 5. Tests Are Not Optional

**Every behaviour change ships with a test. No exceptions.**

- **New feature** → write tests that would fail without it before writing the implementation.
- **Bug fix** → write a test that reproduces the bug first, then fix it. The test name should describe the bug (e.g. `'returns coordinates in degrees, not semicircles'`).
- **Changed behaviour** → update the existing tests that cover it. A passing test suite after a behaviour change means the tests weren't testing the right thing — fix them.
- **Refactor** → tests must pass before and after with no changes to test assertions.

If a change touches a file that has no tests, flag it and add coverage for the affected logic before shipping. Do not ship untested behaviour changes.

Run `pnpm test` before every commit. If tests fail, fix them — do not disable or delete them to make CI green.

---

## Platform & monorepo

### What this is

**One repo, one pnpm workspace** (`pnpm-workspace.yaml` → `apps/*` + `packages/*`). Two apps over two shared packages:

```
apps/
  att/        (pkg "att")             — Automated Time Trials, served at /att       (Next; /att baked into src/app/att/, no basePath)
  analysis/   (pkg "analysis")        — the Analyse app, served at /analyse         (Next, basePath: '/analyse')
packages/
  core/       @paddlesnitch/core      — platform primitives shared by both apps (auth, storage, cognito, strava, url, shared types)
  timing/     @paddlesnitch/timing    — GPS/track domain shared by both apps (geo, parsers, weather/flow/conditions, track types)
```

Both apps use the **same** Cognito user pool, S3 bucket, and CloudFront distribution; in prod CloudFront routes by path (`/att/*`, `/analyse/*`) to per-app Lambdas. Locally the two apps run on two ports (`pnpm dev` → att :3000, `pnpm dev:analysis` → analysis :3001).

**Conventions that keep the monorepo working:**
- Import **per-file subpaths** (`@paddlesnitch/core/auth`, `@paddlesnitch/timing/geo`), not the barrel. Both apps `transpilePackages` the two packages in `next.config.ts`.
- The extraction from att was **in-place**: each moved module left a **re-export shim** at its old `apps/att/src/lib/*.ts` path, so existing att `@/lib/*` imports (and att's domain `types.ts`) resolve unchanged. When adding shared code, put it in the package and keep/add the shim if att already imported it.
- **Don't duplicate** a domain type/util across apps — if both need it, it belongs in `core` or `timing` (that's how the boat-class model landed in `core`).

See [`platform-monorepo.md`](docs/features/platform-monorepo.md).

### Feature design records

Shipped specs are retained under `docs/features/` as design records — the
sections below are the authoritative source for *current* behaviour.
- [`courses-and-entries.md`](docs/features/courses-and-entries.md) — ✅ shipped 2026-05-31. Shared course catalogue, organiser/paddler UX, HR/cadence stripped from entries, boat class + crew, pace variants + date picker.
- [`visibility-clubs-tos.md`](docs/features/visibility-clubs-tos.md) — ✅ shipped 2026-06-13. Public/private/club visibility, clubs with delegated admins, invitational trials, make-public acknowledgement, versioned Terms of Service. (The club→group rename + creation gating below superseded the "club" terminology — this record keeps the original naming.)
- [`groups-and-creation-gating.md`](docs/features/groups-and-creation-gating.md) — ✅ shipped 2026-06-29. Renamed club→group; gated course/trial creation to group admins (every course/trial has a `groupId`); "create a group" on-ramp; member-gated submission (`participation: members|invitational|public`); invite + self-serve join (`joinPolicy`, join requests, join links). 5 phases, all merged.
- [`platform-monorepo.md`](docs/features/platform-monorepo.md) — ✅ shipped 2026-08. paddlesnitch → multi-app platform: one Cognito pool + one S3 bucket + one CloudFront, apps under `apps/*` (att, analysis, …) sharing `packages/core` + `packages/timing`. In-place pnpm-workspace migration, path-based routing, per-app `basePath`. Phased (A1–A5). **A1 done** (workspace + `apps/att`). **A2+A3 done**: `packages/core` (`@paddlesnitch/core` — storage, auth, cognito, url, strava, strava-storage + platform types `AuthUser`/`StravaActivitySummary`/`StravaTokens` + the shared **boat-class model** `BoatClass`/`BOAT_CLASSES`/`BOAT_CLASS_INFO`/`Seat`/`CrewMember`/`expectedSeats`/`seatLabel`/`validateCrew`/`isBoatClass`, re-exported by att's `types.ts` shim and used by the analysis app for per-paddle boat metadata) and `packages/timing` (`@paddlesnitch/timing` — geo, parse, gpx/fit/tcx/csv/speedcoach, unzip, weather, river-flow, conditions + track types `LatLng`/`Line`/`TrackPoint`/`Split`/`ProcessedResult`/`CourseType`/`EntryConditions`) extracted. Each moved module leaves a re-export shim at its old `src/lib/*.ts` path, so all existing `@/lib/*` imports (and the att-domain `types.ts`) resolve unchanged. `next.config.ts` `transpilePackages` both packages; per-file subpath `exports` maps (`./geo`, `./auth`, …). `core` depends on `timing` (strava streams→TrackPoint); no cycle. **A4 done**: `apps/analysis` uses Next `basePath: '/analyse'`. **A5 done** (deployed): `AnalysisFn` Lambda + CloudFront `/analyse/*` → analysis server, `/analyse/_next/*` → assets under a namespaced `_analyse-assets/analyse` prefix (OpenNext emits `_next/*` on disk regardless of basePath; `originPath` prepends so the S3 key resolves), `bedrock:InvokeModel` IAM. Local dev: `pnpm dev` (att :3000) + `pnpm dev:analysis` (:3001) — two ports locally, one CloudFront origin in prod.
- [`paddle-analysis.md`](docs/features/paddle-analysis.md) — ✅ shipped 2026-08. **Session** analysis (not equipment): `apps/analysis` at `/analyse` — upload a trace or import from Strava → derive speed/distance-per-stroke → segment by cruising baseline + departures (rests/surges) → per-effort trend → group sets → real wind+flow → LLM insight → interactive Leaflet map (speed/rate colour, replay). Auto-saves per user (`analysis/{userId}/…`), a My Paddles library, compare, diary notes, and history-aware insights (past sessions + notes feed the prompt). **Time-trial import (#159):** a "TIME TRIALS" tab lists the signed-in user's own ATT entries (`apps/analysis/src/lib/trials.ts` → `GET /analyse/api/trials`) and analyses the stored raw trace with no re-upload — re-parses raw uploads (`parseTrace`) and Strava-import snapshots (`streamsToTrack`); only the user's own entries (userId is in the storage key), saved with source type `'trial'`. (Compare-against-others / overlapping-path is a deferred follow-up.) LLM via `makeInsighter()`: Ollama local / Bedrock prod (never the Anthropic quota), model per env `LLM_MODEL`; falls back to a deterministic templated insight with no backend. SUP→kayak ×2 stroke-rate toggle.
- [`personable-insights.md`](docs/features/personable-insights.md) — ✅ shipped 2026-08 (#168 merged + deployed). Make the analysis LLM commentary personable + memory-aware without unbounded tokens. Three layers: **(1)** deterministic cross-history **aggregates** (`history-stats.ts` — PBs, this-vs-your-average, trends, volume, milestones; ~100 tok, no LLM); **(2)** a persistent **athlete profile** (`analysis/{userId}/profile.json`, ~200 tok, built once then incrementally merged per new paddle + periodic full re-distill — constant per-insight cost regardless of history size); **(3)** relevance **retrieval** of the most similar past paddles (venue/boat/effort, reusing `similar.ts` corridor helpers). Plus a **model bump** to Claude Haiku / Nova on Bedrock (eu-west-1 inference-profile id via `LLM_MODEL`; IAM already covers `inference-profile/*`; billed to AWS not the Anthropic quota) + a revised coach-persona prompt. Grounding unchanged (distilled facts only, never raw points). Phased P1 aggregates+voice → P2 model bump → P3 profile → P4 retrieval. No `AnalysisSession` schema change.
- [`similar-sections-compare.md`](docs/features/similar-sections-compare.md) — ✅ shipped 2026-08 (#163 merged + deployed). Compare similar sections across your **own** paddles as an **ad-hoc race between two derived gate lines**. Click two points on a saved paddle's map (RACE A SECTION mode in `AnalysisView`/`AnalysisMap`) → derive a start line + finish line perpendicular to the track (an on-the-fly ATT `point_to_point` course) → race every other own paddle through it, keeping those that cross **both gates in order, same direction** (fastest valid pair; reversed excluded via `processTrace(..., tryReverse=false)`). Match list reverse-chronological; race board (`/analyse/compare/section`) zeroes every racer at the start line, **recalculates pace/500 for that section only** (+ per-500 section splits + map overlay + per-racer **wind/flow conditions** + an **LLM coach narrative that reasons about whether conditions explain the gaps**, deterministic template fallback via `buildRaceInsight`). **Reuses ATT line-crossing timing** (`processTrace`/splits from `@paddlesnitch/timing/geo`); new pure code = gate-derivation + path-similarity **quality score** (broadened heuristics `GATE_M`=120, `CORRIDOR_M`=40, `COVERAGE_MIN`=0.6; a model-ranking seam for later). No `AnalysisSession` schema change (derives from saved `result.points`/`result.conditions`). `apps/analysis/src/lib/similar.ts` (+ `similar.test.ts`, 8 tests) + `similar`/`similar-compare` insight in `src/lib/llm.ts` + `POST /analyse/api/analyse/similar` (list) & `…/similar/compare` (picked subset, own-paddles-only). Verified on real library data.

### Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript | Full-stack, server + client components |
| Styling | Tailwind CSS v4 | No shadcn/ui — custom retro design system |
| Maps | Leaflet + react-leaflet v5 | Free, no API key |
| Map drawing | Custom click-to-place | 2 clicks per line; no Leaflet.draw dependency |
| Auth (local dev) | cognito-local emulator on port 9229 | Same Cognito SDK calls as prod — only the endpoint URL differs |
| Auth (production) | AWS Cognito User Pool `paddlesnitch-users` (eu-west-1_BHyKJ0toh) | Email/password + magic link via SES; Google/Apple ready to wire |
| Storage (local dev) | Filesystem under `.local-data/` | Drop-in abstraction in `src/lib/storage.ts` |
| Storage (production) | Amazon S3 | Same interface, different backing |
| API | Next.js API routes | Same handlers used in local dev and prod |
| Processing | Inline in the upload API route | No Lambda trigger in local dev |
| IaC | AWS CDK (TypeScript) | `infra/` — OpenNext v4, CloudFront + Lambda |
| CDN | CloudFront + S3 OAC | Deployed — `d1745e47jh0mdf.cloudfront.net` (eu-west-1) |
| CI/CD | GitHub Actions | Push to `main` → test → build → CDK deploy (OIDC, no stored creds) |

### Architecture (Local Dev)

```
Browser
  │
  └─── Next.js (port 3000)         ← src/proxy.ts gates protected routes
         │
         ├──► cognito-local (port 9229)
         │       └── .cognito-local/db/     ← users + tokens (JSON files)
         │
         └──► Filesystem (.local-data/)
                ├── courses/{courseId}/metadata.json
                ├── trials/{trialId}/metadata.json
                ├── trials/{trialId}/leaderboard.json
                └── trials/{trialId}/entries/{userId}/{entryId}/
                      ├── trace.{gpx|fit}
                      └── result.json
```

API routes (under `/att/api/`):
```
auth/signup           POST — Cognito SignUp + AdminConfirmSignUp, sets tt_id + tt_refresh
auth/login            POST — Cognito InitiateAuth (USER_PASSWORD_AUTH), sets tt_id + tt_refresh
auth/logout           POST — clears cookies, revokes refresh token
auth/me               GET  — returns claims from current ID token or 401
auth/magic-request    POST — 501 Not Implemented (deferred follow-up; see Auth System)
auth/magic-verify     GET  — redirects to /att/auth?error=magic_disabled (deferred follow-up)
courses               GET / POST
courses/[id]          GET / PATCH
courses/validate-trace POST — organiser tool: multipart {file, geometry JSON}; runs the trace through processTrace + diagnoseGates and returns { matched, totalElapsedSeconds?, gateAnalysis?, message? }. Stores nothing. Used by ReferenceTraceValidator on the course form to catch a backwards gate before anyone races (#71).
trials                GET (?courseId=) / POST
trials/[id]           GET / PATCH (open/close, visibility, participation, invitees; `{regenerateSubmitToken:true}` mints a shareable submit token, `{submitToken:null}` revokes it — owner/admin only)
trials/[id]/upload    POST (?invite={submitToken} bypasses the participation gate for link-holders; viewing still required) — parse GPX/FIT/CSV (or Strava import via {stravaActivityId}), process, rebuild leaderboard. On a "did not cross the lines" failure, the 422 body carries `diagnostic: { track, course }` (parsed track as [lat,lng] pairs, downsampled to ≤1500 points, plus the course geometry) so the upload page can render a map of the track against the start/finish lines. For gate courses the 422 also carries `diagnostic.gateAnalysis` (see `diagnoseGates`) and the error message names the specific blocking gate. The full-fidelity failing track + course (+ gateAnalysis) is also persisted to `trials/{trialId}/failed-uploads/{userId}/{id}/diagnostic.json` (best-effort; a write error doesn't change the 422) so a failure can be reproduced offline. Failed uploads are otherwise not saved. They ARE covered by GDPR: included in the account export (Art. 15) and removed on account erasure (Art. 17), same as entries.
trials/[id]/can-submit   GET (?invite=) — phase 3: { canSubmit } for the viewer, or { canSubmit:false, reason:'members'|'invitational', group? } so the upload page can show a join/invite CTA. A valid `?invite={submitToken}` answers canSubmit even on a gated trial. 404 if the viewer can't even view the trial.
trials/[id]/leaderboard GET
strava/connect        GET  — sets state cookie, 302 to Strava authorize URL
strava/callback       GET  — verifies state, exchanges code, persists tokens, redirects to /att/account?strava=connected
strava/status         GET  — { connected, athlete? }
strava/disconnect     POST — revokes on Strava, deletes local tokens
strava/activities     GET  — recent water-sport activities, refreshes token if needed
feedback              POST — files a customer-reported GitHub issue (anti-bot gate, see below)
account/export        GET  — JSON archive of the signed-in user's data (GDPR Art. 15)
account               DELETE — full account erasure (GDPR Art. 17)
account/profile       GET / PATCH — read or set the viewer's profile visibility ({ public: boolean }); profiles are opt-in (private by default)
account/handle        GET (?check=) / PUT / DELETE — check availability, claim/change, or release the viewer's vanity profile handle
```

**Note on trial path:** Trials are stored flat (`trials/{trialId}/`) not nested under courseId. The `courseId` is stored inside `metadata.json`. This simplifies lookups by trialId.

#### Anti-bot gate

Unauthenticated POST endpoints that send email or create content guard against naive bots with two invisible, zero-friction checks in `src/lib/anti-bot.ts` (`looksLikeBot()`):

- **Honeypot** — a hidden `website` form field real users never fill; bots scraping inputs do.
- **Time trap** — submissions arriving sooner than `MIN_ELAPSED_MS` (2 s) after the form loaded are bots. The client sends `elapsedMs` measured from page/form mount.

A positive result means **drop silently**: skip the side effect (send no email, create no Cognito user, file no issue) and return a success-looking response so the bot gets no signal to adapt. Guarded routes:

- `auth/otp-request` — the gate runs **before** `signUp`/SES, so a bot can't email-bomb arbitrary inboxes *or* churn junk Cognito accounts. On a bot signal it returns a throwaway `{ session }`; a rare false-positive human hits "use a different email" to retry (timer resets, well past 2 s by then).
- `auth/password-reset/request` — returns the same `{ ok: true }` it returns for a non-existent account; `forgotPassword` never runs.
- `feedback` — returns `{ ok: true }` without filing the issue.

Client forms (`/att/auth` OTP tab, `/att/auth/forgot`, the feedback widget) carry the hidden `website` input + a `mountedAt` ref. These checks only stop unsophisticated bots — a script POSTing JSON directly omits both fields. They're a cheap first line, **not** a guarantee; a real challenge (Turnstile) or rate limiting would be the next step if targeted abuse appears. Tests: `src/lib/anti-bot.test.ts` (unit) plus bot-drop cases in `otp.test.ts`, `password-reset.test.ts`, `feedback.test.ts`.

#### Customer-issue automation (GitHub)

The full lifecycle of a customer report:

1. **Create** — the "Report an issue" widget (att + `/analyse`, both POST to `/att/api/feedback`) files a GitHub issue labelled `customer-reported` + `triage`. The proxy exempts `/att/api/feedback` so **anonymous** reports get through (`src/proxy.ts`).
2. **Auto-intake** (`.github/workflows/claude-intake.yml`) — fires on `issues: [opened]` for `customer-reported` issues: Claude claims it (`claude-active`), then either opens a **draft PR** with a fix or posts **one clarifying question** and stops. Near-immediate (replaces the old ~daily scheduled-cron pickup latency).
3. **Fast loop** (`.github/workflows/claude-fast-loop.yml`) — fires on comments/reviews to `claude-active` items (and a manual `claude-go` label kick). So when the author **answers** the intake's clarifying question, the loop picks it up and turns it into a PR. Serialised with intake via a shared `concurrency: claude-<n>` group.
4. **Cleanup** (`.github/workflows/claude-label-cleanup.yml`) — drains `claude-active` when an issue/PR closes; on a merged PR it also strips the label from the issues it closes.

Internal/tracking issues (no `customer-reported`) aren't auto-worked — kick one with the `claude-go` label to route it through the fast loop. All Claude workflows exclude bot actors to avoid reacting to their own output, and auth via `CLAUDE_CODE_OAUTH_TOKEN` (Max plan, not metered API).

### Architecture (Production)

```
Browser
  │
  └─── CloudFront (d1745e47jh0mdf.cloudfront.net)
         ├──► S3 paddlesnitch-assets-prod  (static assets, served via OAC)
         └──► Lambda (server function)     (Next.js SSR + API routes via OpenNext v4)
                ├──► Cognito paddlesnitch-users (eu-west-1) ← users + tokens
                ├──► S3 paddlesnitch-data-prod              ← courses, trials, entries
                └──► SES (noreply@paddlesnitch.com)         ← magic-link emails
```

OpenNext v4 bundles the Next.js server into a single Lambda. No API Gateway — CloudFront routes directly to a Lambda function URL. Static assets (JS/CSS/images) go to S3 and are served by CloudFront with long cache TTLs.

Cognito is the identity store. The server function has IAM permission to call `cognito-idp:*` against the user pool and `ses:SendEmail` for the `paddlesnitch.com` identity. The S3 data bucket holds *only* course/trial/entry data — no user records, no sessions.

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

.cognito-local/                ← cognito-local emulator state (users + tokens)
  db/
    local_xxx.json             ← user pool (users, password hashes, attributes)
```

**Reset both** (no migration — users are test accounts only): `rm -rf .local-data .cognito-local` then `pnpm seed`.

---

## Shared packages

Two internal packages hold everything both apps need. Each exposes **per-file subpath exports** — import the subpath, not the barrel.

### `@paddlesnitch/core` (`packages/core/src`)

Platform primitives:
- `storage` — S3 (prod) / local-fs (dev) object store: `getJson`/`putJson`/`getObject`/`putObject`/`listKeys`/`deleteObject`.
- `auth` — `getAuthUser()` (reads the `tt_id` cookie, verifies the JWT, silent-refreshes via `tt_refresh`).
- `cognito` — Cognito SDK wrapper (signUp, signIn, refresh, revoke, verifyIdToken).
- `strava` + `strava-storage` — read-only Strava OAuth/API wrapper + per-user token persistence.
- `url` — URL helpers.
- `types` — platform types (`AuthUser`, `StravaTokens`, `StravaActivitySummary`) **plus the shared boat-class model** (`BoatClass`, `BOAT_CLASSES`, `BOAT_CLASS_INFO`, `Seat`, `CrewMember`, `expectedSeats`, `seatLabel`, `validateCrew`, `isBoatClass`) — re-exported by att's `types.ts` shim and used by the Analyse app for per-paddle boat metadata.

### `@paddlesnitch/timing` (`packages/timing/src`)

The GPS/track domain:
- `geo` — haversine, line-segment intersection, `processTrace` (best-effort line-crossing timing), 500 m splits, gate matching + `diagnoseGates`.
- parsers — `gpx`, `fit`, `tcx`, `csv`, `speedcoach`, the `parse` dispatcher, `unzip`.
- `weather` + `river-flow` + `conditions` — real wind (Open-Meteo) + river flow (EA) for a point/time.
- `types` — track types (`LatLng`, `Line`, `TrackPoint`, `Split`, `ProcessedResult`, `CourseType`, `EntryConditions`).

`core` depends on `timing` (Strava streams → `TrackPoint`); no cycle. The detailed geo/timing and parser behaviour is documented under **App: ATT** (Domain Model, GPS File Formats), since that's where it's exercised most — but the code lives in `timing` and is shared.

---

## App: ATT — Automated Time Trials

Served at `/att` (from `apps/att`; the `/att` prefix is baked into `src/app/att/`, no Next `basePath`). The sections below describe ATT's domain, auth, and features. Geo/timing/parser code lives in `@paddlesnitch/timing`; auth/storage/cognito/strava in `@paddlesnitch/core` (att keeps re-export shims at the old `src/lib/*` paths).

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

**Creation gating (phase 2).** Only a group's owner/admins can create courses (and open trials). A course must carry a `groupId` the creator manages (`canCreateCourseInGroup`); a paddler with no group is steered to a "create a group" on-ramp instead of a create form. The create UI is hidden for non-admins on the home + catalogue pages. See [`groups-and-creation-gating.md`](docs/features/groups-and-creation-gating.md).

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

**trackSegment**: `ProcessedResult.trackSegment` stores the interpolated lat/lng path from start crossing to finish crossing. Used to plot the leader's track on the leaderboard map.

**runCount**: `ProcessedResult.runCount` is how many valid runs the uploaded trace contained (start→finish pairs passing `minValidSeconds`); the returned result is the fastest of them. Carried onto `LeaderboardEntry` only when `> 1`, and the leaderboard's expanded row shows "Best of N runs in this upload" so the athlete understands why one time was picked from a multi-run session. Undefined on pre-#77 entries — treat as a single run. See issue #77.

`processTrace` in `geo.ts` uses the best-effort algorithm: tries every valid start crossing, returns the shortest valid pair.

**Reverse-role fallback (point_to_point only)**: if the forward start→finish search finds nothing — e.g. the athlete crossed the finish line first and never re-crossed it after the start, so the run effectively went finish→start — `processTrace` retries once with the start/finish lines swapped before yielding null. Forward is always preferred (the fallback only fires when the normal pass found nothing), so a properly-directed run is never affected. Guarded by the internal `tryReverse` param to run at most once. See issue #66.

#### Time Trial
An event on a Course with a date. A course can host many time trials. Has a status: `open` | `closed`. Carries a **`groupId`** inherited from its course (phase 2) — a trial belongs to the same group that owns its course, and only that group's owner/admins can open or manage it. Visibility clamps to the course's scope as before.

**`participation`** controls WHO can submit once they can view it (phase 3): `members` (any member of the trial's group — the **new default**), `invitational` (only `invitedUserIds`), or `public` (anyone who can view). The organiser can always submit. Legacy pre-phase-3 `'open'` is treated as `public` at read time and migrated by `scripts/migrate-participation-open-to-public.ts`. The gate lives in `canSubmitToTrial`; the upload route 404s a non-submitter (no leak), and `GET /att/api/trials/[id]/can-submit` lets the upload page show a "join {group} to submit" / "invite-only" CTA instead of a form that would fail.

**Shareable submit link (`submitToken`)**: an optional per-trial token on `TrialMetadata`. An organiser mints one from the trial manage page ("Share this trial" → CREATE SUBMIT LINK, which PATCHes `{ regenerateSubmitToken: true }`; REVOKE PATCHes `{ submitToken: null }` — both owner/admin-gated by `canManageTrial`). The resulting `…/upload?invite={submitToken}` link lets **any signed-in viewer bypass the participation gate** — so a link-holder can round-trip through signup and submit to a `members`/`invitational` trial *without* being added to the group or invite list first. This is the "hand out one link, people onboard themselves" path. The token bypasses participation **only**, not visibility: the upload route and `can-submit` still require `canViewTrial` (`tokenOk = !!trial.submitToken && invite === trial.submitToken && canViewTrial(...)`), so it can't submit to a trial the user can't see. The upload page reads `?invite=` (lazy `useState` init, SSR-null) and threads it through `can-submit`, all three submit POSTs, and the encoded sign-in `next` so it survives the auth round-trip. Tests: `src/tests/invitations.test.ts` › "shareable submit link (invite token)". Rotate (re-mint) or revoke to disable an old link.

#### Entry
A participant's submission for a specific time trial, consisting of:
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

**Heart rate is intentionally NOT captured** (a sensitive biometric) — every parser strips it at parse time. **Stroke rate (a.k.a. cadence) IS captured** for paddlers (#143): each parser reads it from that format's own field (GPX `<gpxtpx:cad>`/`<cadence>`, FIT `cadence` + `fractional_cadence`, TCX `<Cadence>`/`<RunCadence>`, CSV aliases `cadence`/`cad`/`stroke rate`/`spm`/`sr`, SpeedCoach `Stroke Rate`), stores it on `TrackPoint.strokeRate`, and `geo.buildResult` averages it. In practice the **FIT** export is the reliable carrier — GPX exports (Strava, SpeedCoach) frequently omit stroke rate. See `docs/features/courses-and-entries.md`.

#### Boat class
Every entry carries a `boatClass`. Kayak: `K1`, `K2`, `K4`. Sculling: `1X`, `2X`, `4X+`, `4X-`. Sweep: `2-`, `4+`, `4-`, `8+`. Defined in `src/lib/types.ts` (`BoatClass`, `BOAT_CLASSES`, `BOAT_CLASS_INFO`, `isBoatClass`). The leaderboard UI defaults to showing all classes with a filter dropdown — comparing a 1X to an 8+ is not meaningful so users typically filter to their own class. Crew details (per-seat names) are added in a later phase; Phase 1 only stores the class label.

#### Line Crossing Detection
Given a GPS track as an ordered array of `[lat, lng, timestamp]` tuples and a line (two `[lat, lng]` points), a crossing is detected when any consecutive pair of track points forms a segment that intersects the line. Intersection uses standard 2D line-segment math (cross-product / parametric form). Haversine is used for distance calculations. All geo math lives in `src/lib/geo.ts`.

**Best-effort / fastest-segment algorithm** (`processTrace` in `geo.ts`): for a full-session upload (warmup + cooldown included), the system finds **all** crossings of the start line in the track, then for each start crossing finds the nearest subsequent finish crossing. The result with the shortest elapsed time is returned — analogous to Strava's "best effort on a segment." This means participants can upload their complete session without trimming; the algorithm automatically extracts the actual racing segment.

#### 500 m Split Calculation
Walk the track from the start-crossing point, accumulating Haversine distance between consecutive points. Record the interpolated timestamp each time cumulative distance crosses a 500 m boundary. Continue to the finish crossing.

### Auth System

#### Identity store

All users live in a Cognito User Pool — no user records in S3 or the filesystem.

- **Local dev**: cognito-local emulator on port 9229 (`pnpm cognito`). Stores users in `.cognito-local/db/`.
- **Production**: AWS Cognito pool `paddlesnitch-users` — `eu-west-1_BHyKJ0toh` (eu-west-1).

App code never branches on environment. Only the Cognito SDK endpoint differs:
- dev → `COGNITO_ENDPOINT=http://localhost:9229`
- prod → endpoint unset; SDK hits AWS directly

#### Sign-in flows

1. **Email + password** — Cognito `USER_PASSWORD_AUTH` flow. Cognito enforces the password policy (8+ chars, mixed case, digit).
2. **Email OTP** — Cognito `CUSTOM_AUTH` flow. Our three Lambda triggers generate a 6-digit code, email it via SES, and verify it. See `infra/lambdas/cognito-auth/`.
3. **Sign in with Strava** — server-driven OAuth. Routes: `/att/api/auth/strava/init` sets a CSRF state cookie and 302s to `strava.com/oauth/authorize` with `scope=read,activity:read_all,profile:read_all`. `/att/api/auth/strava/callback` exchanges the code, fetches the authenticated athlete's profile (`/api/v3/athlete`), then resolves the Cognito user by trying in order: (a) `strava-athletes/{athleteId}.json` index, (b) `cognito ListUsers` with `email = ...` (auto-link to an existing email account — only when Strava actually returned an email, otherwise skipped), (c) `AdminCreateUser` with a random unused password. Sign-in goes through the existing `CUSTOM_AUTH` flow with a server-generated one-time token. **The token is passed via the user's `custom:auth_preset` attribute, NOT `ClientMetadata`** — Cognito does **not** forward `ClientMetadata` to the Create/Define/Verify Auth Challenge triggers (AWS limitation; it only reaches Pre-Signup/Pre-Auth/User-Migration), so the original `ClientMetadata.preset_otp` approach silently never worked and `CreateAuthChallenge` always fell through to emailing a random code. `customAuthSignIn()` now sets `custom:auth_preset` via `AdminUpdateUserAttributes` right before `InitiateAuth`, `CreateAuthChallenge` reads it from `event.request.userAttributes['custom:auth_preset']` (clientMetadata kept only as a dev/test fallback), and the attribute is cleared after. Only the server can do both halves of that dance, so the path is server-trusted.

> **One-time pool setup (already done in prod):** the `custom:auth_preset` attribute was added out-of-band — `aws cognito-idp add-custom-attributes --user-pool-id <pool> --custom-attributes Name=auth_preset,AttributeDataType=String,Mutable=true`. It is **not** declared in the CDK `UserPool` construct on purpose: changing the pool's schema through CloudFormation can force a pool *replacement* (losing all users), so schema additions are manual, like the SES rule-set activation.
   **Strava never shares email** with third-party apps (their policy, not a bug). When the profile call returns no email field, we mint a synthesised address `strava-{athleteId}@noreply.paddlesnitch.com` to satisfy Cognito's email-format requirement. The user sees a banner inviting them to add a real contact email at `/att/account` (see `src/lib/strava-account.ts` + `src/components/StravaContactBanner.tsx`). Real emails sit in `users/{userId}/contact.json` (separate from the Cognito email) and feed any future outbound comms.
4. **Magic link** — server generates a one-time token (stored 15 min), emails it via SES (prod) or console (dev). On click, the verify endpoint looks up the Cognito user by email and issues an ID-token cookie. Uses Cognito's `AdminInitiateAuth` under the hood — no Lambda triggers required.
5. **Social (Google, Apple)** — not yet wired. When added: Cognito hosted UI handles OAuth, callback lands in `/att/auth/oauth-callback`.

#### Session mechanics

- **Cookies**: two httpOnly cookies, sameSite=lax, path=/.
  - `tt_id` — Cognito **ID token** (JWT). 24h maxAge, matches Cognito ID-token validity.
  - `tt_refresh` — Cognito **refresh token**. 30d maxAge.
- **`getAuthUser()`** (`src/lib/auth.ts`): reads `tt_id` → verifies the JWT signature against the pool's JWKS (`https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/jwks.json`, cached) → returns `{ id, email, displayName }` from claims (`sub`, `email`, `name`). If the ID token is expired and the context is mutable (Route Handler / Server Action), silently exchanges `tt_refresh` for a fresh ID token and updates the cookie.
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
- `GET  /att/api/auth/me` — verifies JWT (and silent-refreshes if expired), returns user claims or 401
- `GET  /att/api/auth/strava/init` — Strava sign-in: state cookie + redirect to Strava with `profile:read_all`
- `GET  /att/api/auth/strava/callback` — finds/creates Cognito user, runs `CUSTOM_AUTH` with preset token, sets `tt_id` + `tt_refresh`, redirects to `next`
- `POST /att/api/auth/magic-request` — disabled in v1 (returns 501 with friendly message)
- `GET  /att/api/auth/magic-verify` — disabled in v1 (redirects to `/att/auth?error=magic_disabled`)

#### Access control

- **Proxy (`src/proxy.ts`)**: cheap cookie-presence check at the edge — does NOT verify the JWT (keeps middleware fast). Redirects to `/att/auth?next={path}` if absent. Real verification happens in API/page handlers via `getAuthUser()`.
- Public without login: home (open trials list), leaderboard, upload form (shows sign-in prompt).
- Admin pages require login.

#### Adding Google/Apple OAuth (future)

User pool is already deployed. Steps when ready:
1. Register OAuth client in Google Cloud Console / Apple Developer portal
2. Add identity provider to the pool in CDK (`cognito.UserPoolIdentityProviderGoogle`)
3. Add a Cognito domain (`userPool.addDomain(...)`) and callback URL
4. Add "Sign in with Google" button to `/att/auth` (redirects to hosted UI)
5. Build `/att/auth/oauth-callback/route.ts` to exchange the code for tokens, set cookie

### Strava integration

Users can connect their Strava account once and then import any recent water-sport activity straight into a time trial — no GPX export required. Implementation:

- **Lib**: `src/lib/strava.ts` (OAuth + read-only API wrapper, no SDK) and `src/lib/strava-storage.ts` (per-user token persistence).
- **Token storage**: `users/{userId}/strava.json` in S3 (or `.local-data/` in dev). `getValidStravaTokens()` refreshes silently when the access token is within 2 minutes of expiry and re-persists.
- **OAuth scopes**: `read,activity:read_all` — enough to list recent activities and pull lat/lng + time streams. Never `write` — we don't post to anyone's Strava feed.
- **CSRF**: state cookie `strava_state` (httpOnly, 10 min) set on `/strava/connect`, verified on `/strava/callback`.
- **Activity filter**: the picker shows only `Kayaking`, `Canoeing`, `Rowing`, `StandUpPaddling`, `VirtualRow` — see `WATER_SPORT_TYPES` in `strava.ts`. Other sports can still be imported via the URL tab.
- **Streams → TrackPoint**: `streamsToTrack(latlng, time, startDate)` joins parallel arrays + the activity's start date into the same `TrackPoint[]` shape that GPX/FIT/CSV parsers produce, so `processTrack()` is sport-agnostic.
- **Persisted "raw trace"**: Strava imports save a JSON snapshot (`strava-{id}.json`) instead of a GPX file. Same directory layout (`trials/{trialId}/entries/{userId}/{entryId}/trace.json`), same audit story.

#### Env vars

| Var | Where | Notes |
|---|---|---|
| `STRAVA_CLIENT_ID` | `.env.local` (dev only) | Direct override for local dev. Public — appears in every authorize URL. |
| `STRAVA_CLIENT_ID_PARAM` | env (prod, set by CDK) | Name of SSM String parameter to fetch at runtime: `/att/strava-client-id`. |
| `STRAVA_CLIENT_SECRET` | `.env.local` (dev only) | Direct override for local dev. |
| `STRAVA_CLIENT_SECRET_PARAM` | env (prod, set by CDK) | Name of SSM SecureString to fetch at runtime: `/att/strava-client-secret`. |

Both SSM parameters are set once with the AWS CLI:
```bash
aws ssm put-parameter --name /att/strava-client-id --type String --value '<id>' --overwrite --profile paddlesnitch --region eu-west-1

# IMPORTANT: write the secret to a tempfile with `printf '%s'` so there is
# NO trailing newline. `grep ... > file` or `echo ... > file` both append
# a \n, which AWS CLI stores verbatim via `file://`. The Lambda then ships
# a 41-char "secret" to Strava and gets back 401 Application/""/invalid.
# Bash $(...) strips trailing newlines on read, so length checks via
# ${#VAL} will lie. Verify with `wc -c < file`.
SECRET_FILE=$(mktemp)
printf '%s' '<the 40-char hex secret>' > "$SECRET_FILE"
aws ssm put-parameter --name /att/strava-client-secret --type SecureString --value "file://$SECRET_FILE" --overwrite --profile paddlesnitch --region eu-west-1
rm "$SECRET_FILE"
```

The Lambda IAM role has `ssm:GetParameter` on the parameter ARNs **and** `kms:Decrypt` on `alias/aws/ssm` (scoped via `kms:ViaService = ssm.<region>.amazonaws.com`). Without the KMS grant, SSM **silently returns the encrypted ciphertext blob** (`AQICAH...`, ~240 chars) instead of failing — which the runtime would then forward to Strava as the "secret".

#### Redirect URIs

| Env | URI |
|---|---|
| Local | `http://localhost:3000/att/api/strava/callback` |
| Prod | `https://paddlesnitch.com/att/api/strava/callback` |

Both must be allow-listed in the Strava API app at https://developers.strava.com.

### Frontend Structure

```
src/
  proxy.ts                     ← Next.js 16 proxy (auth gate, replaces middleware)
  app/
    layout.tsx                 ← Root layout (IBM Plex Mono font, white background)
    page.tsx                   ← Landing page at / — link to /att
    globals.css                ← Tailwind + design tokens
    att/
      page.tsx                 ← ATT home — server component; two columns (open trials + recent submissions) side-by-side on desktop, stacked on mobile. Recent submissions come from `getRecentSubmissions` (visibility-filtered) with names linking to public profiles only. Each open-trial card the viewer owns (`canManageTrial`) shows a "MANAGE / CLOSE →" link to `/att/admin/trials/{id}` where the close control lives, so owners can reach it from the listing (#87).
      auth/
        page.tsx               ← Sign in / sign up (tabbed, client component)
      admin/
        courses/
          new/page.tsx         ← Create course (DrawingMap + form, client component)
          [courseId]/page.tsx  ← Manage course + create trials; date field defaults to today (client component)
        trials/
          [trialId]/page.tsx   ← Manage trial: open/close, view entries (client component)
      trials/
        [trialId]/
          page.tsx             ← Public leaderboard + course map (server component)
          upload/page.tsx      ← Upload trace (client component); on success redirects to leaderboard; shows sign-in prompt if unauthenticated; on a "did not cross" failure renders a diagnostic CourseMap of the recorded track vs the start/finish lines
      api/
        auth/{signup,login,logout,me,magic-request,magic-verify}/route.ts
        courses/route.ts
        courses/[courseId]/route.ts
        trials/route.ts
        trials/[trialId]/route.ts
        trials/[trialId]/upload/route.ts
        trials/[trialId]/leaderboard/route.ts
  lib/
    types.ts                   ← All shared types (CourseMetadata, TrialMetadata, etc.)
    geo.ts                     ← Haversine, line-segment intersection, processTrace, formatTime
    gpx.ts                     ← GPX parser (regex-based, no dependencies)
    fit.ts                     ← FIT parser (fit-file-parser package)
    tcx.ts                     ← TCX parser (regex-based, like gpx.ts)
    csv.ts                     ← Generic per-row CSV parser (flexible column names, unix/ISO timestamps)
    speedcoach.ts              ← NK SpeedCoach multi-section CSV parser (Start Time + Per-Stroke Data)
    parse.ts                   ← Dispatcher: parseTrace(filename, buffer) → ParseResult (routes .csv to generic vs SpeedCoach; rejects .kml)
    storage.ts                 ← getObject/putObject/deleteObject/listKeys/getJson/putJson
    auth.ts                    ← getAuthUser(): reads tt_id, verifies JWT, silent-refreshes via tt_refresh
    cognito.ts                 ← Cognito SDK wrapper: signUp, signIn, refresh, revoke, verifyIdToken
  components/
    AuthNav.tsx                ← Client component: signed in → name (links to /att/u/{id} public profile) + ACCOUNT (links to /att/account settings) + SIGN OUT; signed out → "SIGN IN" link
    LoadingState.tsx           ← Shared centered loading indicator (three blinking blue blocks + label) for client pages while data fetches; replaces the bare "Loading…" text node. Defaults to filling its flex parent (`flex-1`); pass `className`/`label` to tune. See #121.
    map/
      DrawingMap.tsx           ← Click-to-place start/finish lines on Leaflet map
      CourseMap.tsx            ← Read-only map: start (green), finish (red), auto-fit bounds
      CourseMapClient.tsx      ← Thin 'use client' wrapper enabling ssr:false from Server Components
    leaderboard/
      LeaderboardTable.tsx     ← Ranked table; per-row expandable 500 m splits (▼/▲ toggle); entries shorter than 500 m show no splits
```

### GPS File Formats

Supported input formats (dispatched by extension in `src/lib/parse.ts`): **GPX, FIT, TCX, CSV** (generic per-row **or** NK SpeedCoach multi-section), and **ZIP** (unwrapped). **KML is deliberately rejected** (no timestamps). Every parser captures stroke rate when present and never captures HR.

#### GPX
XML. Extract `<trkpt lat="" lon=""><time>`. HR (`<gpxtpx:hr>`) is discarded. Stroke rate is captured from `<gpxtpx:cad>` / `<cadence>` / any-prefixed `<…:cad>` (#143). Parser: `src/lib/gpx.ts` (regex, no XML library).

#### FIT
Binary. `fit-file-parser` npm package. Returns `position_lat`/`position_long` already in degrees (no semicircle conversion needed). HR (`heart_rate`) discarded; stroke rate = `cadence` + `fractional_cadence` (#143). Parser: `src/lib/fit.ts`. In practice FIT is the **reliable** stroke-rate carrier (GPX exports often omit it).

#### TCX
Garmin Training Center XML (exported by Strava, Garmin Connect, coaching tools). Regex parser (like GPX): each `<Trackpoint>`'s `<Time>` + `<Position>`; stroke rate from `<Cadence>` or a `<RunCadence>`/`<ns3:Cadence>` extension. HR discarded. Parser: `src/lib/tcx.ts`.

#### CSV
Two shapes, auto-detected:
- **Generic per-row** (`src/lib/csv.ts`): flexible column detection (case-insensitive, ignores spaces/underscores): lat/latitude, lon/lng/longitude, time/timestamp/datetime (unix s, unix ms, ISO 8601, `YYYY-MM-DD HH:MM:SS`). Stroke rate from `cadence`/`cad`/`stroke rate`/`spm`/`sr`; HR ignored.
- **NK SpeedCoach** (`src/lib/speedcoach.ts`): a multi-section report, not a per-row track. `looksLikeSpeedCoach()` routes it here. Reads the session `Start Time` and the `Per-Stroke Data:` section (columns found by name: `Elapsed Time` HH:MM:SS.t, `Stroke Rate` SPM, `GPS Lat.`, `GPS Lon.`); absolute time = start + elapsed. The paddling/rowing device, so read directly rather than only via its FIT export. (Strava's own "activity CSV" is a lap summary with no coordinates → correctly `empty`.)

#### ZIP (fitness-app export wrapper)
Garmin Connect (and others) export an activity as a single trace file wrapped in a `.zip`. `parseTrace` detects `.zip`, unwraps it via `readZip` (`src/lib/unzip.ts` — zero-dep central-directory reader + `zlib.inflateRawSync`; Garmin local headers use a data descriptor with zeroed sizes, so the central directory is the reliable source of sizes), finds the first entry with a supported extension (`gpx`/`fit`/`csv`/`tcx`), and recurses. A zip with no supported file → `unknown_format`; a corrupt zip → `parse_error`. Regression fixture: `src/tests/fixtures/garmin-activity-export.zip` (a real Garmin `*_ACTIVITY.fit` export). See issue #130.

#### KML (rejected)
KML exports (Strava, Google Earth) are geometry only — `<coordinates>` with no per-point timestamps — so a race time can't be computed. `parseTrace` returns `{ ok:false, reason:'kml_no_timing' }`, and the upload route surfaces "export GPX/FIT/TCX instead". (Some tools emit `<gx:Track>` with `<when>` times, but common exports don't — not worth the false promise.)

#### Unknown formats & error messages
Unsupported extension → `{ ok: false, reason: 'unknown_format' }`. The upload route maps every parse reason (`kml_no_timing` / `unknown_format` / `empty` / `parse_error`) to a friendly, actionable 422 message. Future formats can be added to `src/lib/parse.ts` without touching any other file.

### Paddler profiles

A profile page at `/att/u/{userId}` shows one paddler's vanity stats — totals (races, courses, distance, since), personal best per course, best pace/speed, boat-class counts, and race history. Two invariants, both enforced in `src/lib/profile.ts`:

1. **Opt-in.** A profile is private until the user flips it public (account page → Public profile → `PATCH /att/api/account/profile`). Setting stored at `users/{userId}/profile.json` (`{ public: boolean }`, default false). A private profile returns **404** to everyone but its owner (the owner sees their own with a "only you can see this" banner) — same no-leak pattern as private courses/trials.
2. **No visibility leak.** `buildProfileStats(userId, viewer, viewerGroupIds)` scans the user's `entries/*/result.json`, but counts a race **only if `canViewTrial(trial, viewer, viewerGroupIds)`** passes — so a profile never reveals a result the viewer couldn't already see on that trial's leaderboard. Stats are recomputed per-viewer.

A user may also claim a **vanity handle** so their profile lives at `/att/u/baldur`. Handle logic is in `src/lib/profile.ts`: `normaliseHandle` (lowercase, 3–30 chars, `[a-z0-9-]`, no leading/trailing hyphen, not in `RESERVED_HANDLES`), `claimHandle` / `releaseHandle` (maintains a `usernames/{slug}.json → { userId }` reverse index; changing a handle frees the old slug; taken handles are rejected), and `resolveToUserId(segment)` (a known handle wins, else the segment is treated as a userId so old `/att/u/{userId}` links keep working). The profile page redirects to the canonical `/att/u/{handle}` when one exists. Managed from the account page → Public profile → Profile handle (`GET ?check=` / `PUT` / `DELETE /att/api/account/handle`). Account erasure releases the handle index and wipes the whole `users/{userId}/` prefix (profile, contact, groups index, strava, tos-consent — previously these survived deletion).

**Discoverability.** A signed-in user reaches their own profile via their name in `AuthNav`. On a trial leaderboard, an athlete's name links to their profile **only when that profile is public** — `getPublicProfileLinks(userIds)` returns `userId → handle-or-id` for public profiles only, and `LeaderboardTable` renders a link when present, plain text otherwise (no dead links to private/opt-out profiles). The owner's own race history links back to each trial.

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

Both paths trigger a transactional email via SES on creation (`src/lib/email.ts` wraps SES, `src/lib/invitation-email.ts` holds the templates). Pending invitations link to `/att/auth?next=/att/groups/{id}` so the recipient lands on the group after signup; resolved invitations link straight to the group page. Synthetic Strava `strava-{id}@noreply.paddlesnitch.com` addresses are skipped (no inbox). Email send failures are swallowed — the invite record is already persisted and can be re-sent. Local dev (`USE_LOCAL_STORAGE=true`) no-ops SES and logs to stdout instead.

#### Joining a group — self-serve (phase 4)

Beyond admin invitations, a non-member can join via the group's **`joinPolicy`** (on `GroupMetadata`; missing is treated as `request`, the default for new groups):

- **`invite_only`** — no self-serve; only an admin invitation works.
- **`request`** — anyone signed-in can request; an admin approves/declines. A pending request is stored at `groups/{groupId}/join-requests/{id}.json` (`JoinRequest`).
- **`open`** — anyone signed-in joins instantly (no pending record persists).

A group can also carry a **`joinLinkToken`**: anyone signed-in who hits `POST …/join-requests` with a matching token joins **instantly regardless of policy** (the shareable join link is `/att/groups/{id}?join={token}`). Rotate/revoke via PATCH.

Helpers live in `src/lib/groups.ts` (`joinPolicyOf`, `withMember`, join-request CRUD, `findPendingJoinRequest`). Permission checks: `canRequestToJoin` (signed-in non-member, policy ≠ invite_only) and `canManageGroupMembers` (owner/admin) in `src/lib/permissions.ts`.

**Group visibility change for join:** `GET /att/api/groups/[id]` now returns a **limited projection** (name, description, `joinPolicy`, `memberCount`, `viewerStatus`) to non-members instead of 404 — enough to render a join CTA without exposing the member list. Members still get the full payload (+ `viewerStatus`). Groups remain non-enumerable (the catalogue lists only your own), so this is "discoverable by link", not browsable. The upload page's phase-3 "join {group} to submit" CTA links here, closing the loop.

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

- **Signup** requires `acceptedTosVersion: CURRENT_TOS_VERSION` in the request body. The signup form on `/att/auth` ships the constant; an out-of-date client gets 422 instead of silently signing the user up.
- The signup hook records `{ version, acceptedAt }` at `users/{userId}/tos-consent.json` so a re-accept gate on the next bump can tell who's already up to date.
- `GET /att/api/account/tos` returns `{ currentVersion, accepted, acceptances[] }` for the authenticated viewer.
- `POST /att/api/account/tos { version }` records an acceptance. Refuses anything other than `CURRENT_TOS_VERSION` (no future-version land-grab).
- Public ToS page at `/att/tos` rendered from the markdown source.

#### Bumping a version

1. Copy `legal/tos-{prev}.md` to `legal/tos-{new}.md`. Edit.
2. Set `CURRENT_TOS_VERSION` in `src/lib/types.ts` to the new string.
3. Update the signup form's hard-coded `acceptedTosVersion: '...'` (in `src/app/att/auth/page.tsx`) to match.
4. (Future) wire a re-accept gate on the next authenticated request.

### Make-public acknowledgement

Flipping a trial from `private` (or `group`) to `public` via PATCH requires `acknowledged: true` in the request body. Without it, the route returns 422 with `{ code: 'make_public_ack_required' }`. The owner has to explicitly tick a box; the ToS warns participants that performance times may become public, so we don't chase individual consents at the moment of the flip. Public → private and public → public are exempt — the gate only fires when widening visibility.

### Inbound email — privacy@paddlesnitch.com

Mail to `privacy@paddlesnitch.com` lands via SES receipt rule and gets forwarded to the human inbox by the `att-email-forwarder` Lambda.

#### Pipeline

1. **MX record** on `paddlesnitch.com` → `inbound-smtp.eu-west-1.amazonaws.com` (priority 10).
2. **SES receipt rule** `PrivacyAlias` in rule set `paddlesnitch-inbound`. Recipients: `privacy@paddlesnitch.com`. Actions in order:
   - **S3** — stores raw MIME at `s3://paddlesnitch-data-prod/inbound-email/privacy/{messageId}` for audit. Spam + virus scan headers are added by SES (`scanEnabled: true`).
   - **Lambda** — invokes `att-email-forwarder` (event-style, fire-and-forget).
3. **Lambda forwarder** (`infra/lambdas/email-forwarder/index.mjs`) reads the raw MIME, parses headers, builds a fresh MIME with `From: noreply@paddlesnitch.com` + `Reply-To: <original sender>`, and `SendRawEmail`s it to `FORWARD_TO` (currently `baldur.gudbjornsson@gmail.com`).

#### One-time activation

SES allows ONE active receipt rule set per region. After the first deploy that creates the rule set, run **once**:

```bash
aws ses set-active-receipt-rule-set --rule-set-name paddlesnitch-inbound --region eu-west-1 --profile paddlesnitch
```

CDK does NOT automate this — an AwsCustomResource that flips the active set would risk clobbering a manually-set production rule set during routine deploys.

#### Adding a new alias

1. Add a new `addRule` call to the `InboundRules` rule set in `infra/lib/att-stack.ts` with a different recipient address and (optionally) a different S3 prefix.
2. If the forwarder should handle the new alias the same way, no Lambda change needed — the existing forwarder treats every record uniformly.
3. If the new alias should go to a different person, either parameterise `FORWARD_TO` per-alias (read from S3 prefix or rule name) or deploy a second Lambda.

#### Tests

- `src/tests/email-forwarder.test.ts` — pure-helper coverage for the MIME parser + builder (header unfolding, case-insensitive headers, From/Reply-To fallback, subject prefix). The SES + S3 round trip is manual smoke after deploy.

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

**Paddle-session analysis** — "what actually happened on this outing, and what it means." Lives in `apps/analysis` (Next, `basePath: '/analyse'`), on `@paddlesnitch/core` + `@paddlesnitch/timing`; map components are app-local. Same Cognito login + same S3 bucket as att (data under the `analysis/` prefix, private per user).

- **Sources**: file upload (GPX/FIT/TCX/CSV/SpeedCoach/zip), **Strava import**, or **analyse one of your own ATT time-trial entries** (`src/lib/trials.ts`, no re-upload).
- **Engine** (`src/lib/analysis.ts`, pure): speed + distance-per-stroke, **baseline+departures** segmentation (rests down / surges up), per-effort trend, set grouping, SUP→kayak ×2 stroke-rate (auto for kayak boat classes; manual toggle otherwise — default off).
- **Conditions**: real wind + river flow via `@paddlesnitch/timing`.
- **Persistence** (`src/lib/analysis-store.ts`): auto-saves each paddle → `analysis/{userId}/{id}/session.json` (`AnalysisSession`). A **My Paddles** library, saved view, diary notes, per-paddle **boat class + seat**, and a persistent **athlete profile** (`analysis/{userId}/profile.json`).
- **Duplicate detection** (#178): re-submitting the same paddle (same file re-uploaded, same Strava activity re-imported, or the same trace analysed twice) doesn't create a second library entry. `paddleFingerprint(paddledAt, durationS, distanceKm)` is a source-agnostic identity derived only from stored fields (so it also matches pre-existing sessions with no migration; distance rounded to whole metres, duration to whole seconds to absorb float noise). The `POST /analyse` route computes the incoming fingerprint after `analyseTrack`, checks `findDuplicateSession` (best-effort — a storage error degrades to a normal save, never a 500), and on a hit returns the existing paddle with `duplicate: true` (skipping the LLM call + save). The upload page (`src/app/page.tsx`) shows an "already in your library — OPEN IT →" notice linking to `/analyse/{id}` instead of rendering a fresh duplicate.
- **LLM insight** (`src/lib/llm.ts`, `makeInsighter()`): Ollama local / **Bedrock prod** (never the Anthropic quota), model per env `LLM_MODEL`, bounded by `withTimeout` (`LLM_TIMEOUT_MS`); deterministic templated fallback when no backend, so it never breaks. Memory-aware via `src/lib/history-stats.ts` (cross-history aggregates + relevance retrieval) + the athlete profile — the enrichment is best-effort and off the request's critical path, so it can never fail the analysis.
- **Compare / race a section** (`src/lib/similar.ts`): "race a section" across your own paddles between two derived gate lines, and a single-section "analyse this stretch" narrative.
- **Routes** (under `/analyse/api/`): `analyse` (main pipeline), `analyse/sessions[/[id]]`, `analyse/similar[/compare]`, `analyse/section-insight`, `trials`, `strava/activities`, `me`.
- **Key files**: `src/app/api/analyse/route.ts` (pipeline), `src/components/analysis/AnalysisView.tsx` (immersive view), `src/components/map/AnalysisMap.tsx`. Infra: `AnalysisFn` Lambda + CloudFront `/analyse/*` routing in `infra/lib/att-stack.ts`.

Feature records: [`paddle-analysis.md`](docs/features/paddle-analysis.md), [`similar-sections-compare.md`](docs/features/similar-sections-compare.md), [`personable-insights.md`](docs/features/personable-insights.md).

---

## Ops & conventions

Cross-cutting: how to run the apps, test, deploy, and the shared conventions + design language both apps follow.

### Development Workflow

> **Monorepo note.** The root scripts are **att-scoped**: `pnpm dev` = `pnpm --filter att dev` (att on :3000) and `pnpm test` = `pnpm --filter att test`. Run the **Analyse** app with `pnpm dev:analysis` (:3001) and its own suite with `pnpm --filter analysis test`. Both apps must be green before a deploy that touches shared packages. Where the sections below say "pnpm dev"/"pnpm test" unqualified, they mean the att app (historical — the workflow predates the second app).

#### Day-to-day

```
pnpm dev          # att: cognito-local on :9229, init, Next.js on :3000
pnpm dev:analysis # analysis app on :3001 (shares the same cognito + data)
# make changes
pnpm test         # att vitest suite — must be green before shipping
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

The test suite covers the full upload pipeline end-to-end (GPX → parse → cross lines → leaderboard) and all auth flows. These are integration tests against a real temp filesystem — no mocks except `next/headers` (Next.js runtime-only).

**Manual smoke test** (run locally against `pnpm dev`; only needed for UI and map flows):

| Flow | When to check |
|---|---|
| Course creation | Any change to DrawingMap or course API |
| Trial open/close UI | Any change to admin pages |
| Leaderboard display | Any change to LeaderboardTable or splits rendering |
| Map dark/light toggle | Any change to map components |

Run the manual steps only for flows affected by your change. The automated tests cover auth, upload, parsing, and the core timing pipeline.

#### Deploy sequence

**Normal path — just push:**
```bash
git push origin main   # triggers GitHub Actions: test → build → cdk deploy
```

**Manual deploy** (use if CI is broken or you need to deploy from your machine):
```bash
pnpm build:open-next                  # production bundle (includes OpenNext v4)
cd infra
npx cdk deploy --profile paddlesnitch --require-approval never
```

SSO session expires after ~8 h. If CDK says "Unable to resolve AWS account", run:
```bash
aws sso login --profile paddlesnitch
```

#### Test coverage gaps (known)

These flows have no automated tests yet:
- Magic link auth (currently disabled — re-add tests when the Lambda triggers ship)
- Token refresh path in `getAuthUser()` (manual smoke only)
- Course/trial CRUD API routes
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
Creates deterministic demo data in `.local-data/`. Safe to re-run (nanoid IDs differ each run, so re-running adds duplicate data — delete `.local-data/` first if you want a clean reset).

| Account | Email | Password |
|---|---|---|
| Admin (course owner) | admin@paddlesnitch.com | Password123 |
| All others | {name}@example.is | Password123 |

Courses: **Elliðaár 1000m Sprint** (both sports) · **Reykjavik Harbour 500m** (kayak)
Trials: Spring Sprint 2025 (closed) · Summer Championships 2025 (closed) · Harbour Race 2025 (open)

#### Example trace files
`examples/traces/` — drop `.gpx`, `.fit`, or `.csv` files here as reference inputs. Not uploaded automatically; use the upload UI against an open trial.

### Testing

Use **Vitest**. Vitest `globalSetup` spawns its own cognito-local on :9230 so auth/upload/courses tests run against the real Cognito SDK surface (no mocks except `next/headers`).
- `src/lib/geo.test.ts` — haversine, line crossing, processTrace, formatTime
- `src/lib/gpx.test.ts` — GPX parser unit tests
- `src/lib/fit.test.ts` — FIT parser unit tests (mocks fit-file-parser)
- `src/lib/csv.test.ts` — CSV parser: flexible columns, all timestamp formats, edge cases
- `src/tests/auth.test.ts` — integration: signup, login, logout, /me against cognito-local (mocked cookies only)
- `src/tests/upload.test.ts` — integration: full upload pipeline → leaderboard (real filesystem + cognito-local)
- `src/tests/cognito-test-server.ts` + `src/tests/global-setup.ts` — spawn the test cognito-local instance, create pool/client, set env

Pattern: pure lib functions get unit tests; API routes get integration tests against real temp filesystem + real cognito-local. Only `next/headers` is mocked (Next.js server-only API). No SDK mocks.

Run: `pnpm test`

### Test pyramid

Two tiers. Don't blur them — they catch different bugs and the cost profiles are very different.

| Tier | Lives in | What it catches | Cost |
|---|---|---|---|
| **Unit + integration** (vitest) | `src/lib/*.test.ts`, `src/tests/*.test.ts` | Pure-function correctness, route-handler behaviour, every row of the permission matrix as a story-style test name | ~2 s for the whole suite |
| **E2E critical paths** (Playwright) | `e2e/critical/*.spec.ts` | Real-browser cookie flows, form-to-route-to-page round trips, redirect chains, multi-page navigations | ~30 s per scenario; 3–5 scenarios target |

#### Run

```bash
pnpm test          # att vitest suite (~2 s) — see the monorepo note below
pnpm e2e           # headless Playwright (runs pnpm dev under the hood)
pnpm e2e:ui        # Playwright UI mode — for debugging failing tests
pnpm e2e:install   # one-time install of the chromium browser
```

CI runs both: vitest in `deploy.yml`, Playwright in `e2e.yml`. The Playwright workflow caches `~/.cache/ms-playwright` keyed by the package version, so cold runs only pay the ~90 MB Chromium download on a version bump.

#### Discipline

- **Permission rules belong in vitest, not Playwright.** Every "X can/cannot do Y" check is cheaper, more deterministic, and more readable as a story-style unit test. E2E is for flows that span multiple pages or rely on real browser behaviour (cookies, redirects, client-side navigation).
- **One critical path per spec file.** Keep specs focused so a failure points directly at one broken flow.
- **No shared state between specs.** Each test creates its own user via `signUpFlow()` (in `e2e/helpers.ts`) with a unique email. Don't seed shared data across runs.
- **When a vitest story would suffice, write the vitest story.** Reserve Playwright for things vitest physically can't reach.

Failure artifacts (trace, screenshot, video) upload as `playwright-report` on a failed CI run; viewable inline in the Actions UI. Locally: `pnpm exec playwright show-report` after a failed run.

### Map Notes

- **Drawing**: `DrawingMap.tsx` uses click-to-place. Click "SET START LINE", click 2 points across the river, line is drawn. Repeat for finish. Lines can be reset. No Leaflet.draw dependency.
- **SSR**: All Leaflet components are `'use client'`. Server Components that need a map use `CourseMapClient.tsx` which wraps `CourseMap` in `next/dynamic` with `{ ssr: false }`. Direct `ssr: false` in Server Components is not allowed in Next.js 16.
- **Icons**: Leaflet default marker icon URLs are patched on import (webpack breaks the default paths).
- **Tiles**: Default is CartoDB Voyager (light). A toggle button lets users switch to CartoDB Dark Matter (`dark_all`). River layer recolours to match: cyan neon on dark, blue on light.
- **River overlay**: `RiverLayer.tsx` fetches `/data/rivers.geojson` (OSM UK data, downloaded once via `pnpm rivers`) and renders it as non-interactive cyan (`#06b6d4`) lines with a neon glow behind the course lines. Line weight/opacity scales by waterway type (`w` property: `river` | `canal`). Fails silently if file is missing.
- **Coordinates**: `[lat, lng]` throughout — NOT GeoJSON order.

#### River data
`public/data/rivers.geojson` is gitignored (16.5 MB raw, ~3.3 MB gzipped). Regenerate with `pnpm rivers`.

Source: OpenStreetMap via Overpass API — UK rivers and canals (60,065 features). Streams omitted (visible on the dark base tile). Simplified at 0.001° tolerance (~100 m) for browser performance. The `w` property is `river` or `canal`.

The script requires a `User-Agent` header; Overpass blocks the default Node.js UA.

### Design System

**Aesthetic: minimal, data-centric, light background — dense tables, IBM Plex Mono, single blue accent**

| Token | Value | Usage |
|---|---|---|
| Background | `#ffffff` | `<body>` |
| Surface | `#f8fafc` | cards, form fields |
| Surface-2 | `#f1f5f9` | hover states |
| Border | `#e2e8f0` | all dividers |
| Primary | `#0369a1` | times, CTAs, active links |
| Split | `#6d28d9` | split times, HR/cadence data |
| Green | `#15803d` | start line, open status |
| Red | `#b91c1c` | finish line, close/delete |
| Text | `#0f172a` | body |
| Muted | `#64748b` | labels, secondary text |
| Font | IBM Plex Mono | everything — loaded via `next/font/google` |

CSS utilities in `globals.css`:
- `.tabular` — `font-variant-numeric: tabular-nums` for times

Maps default to light (CartoDB Voyager) with a toggle to dark. All other UI is always light.
No rounded corners on data elements. Sharp, precise. Mobile-first; tap targets ≥ 44px.

### Key Conventions

- All IDs: `nanoid()` — URL-safe, short.
- Timestamps: ISO 8601 strings in JSON.
- Times: stored as seconds (float), displayed as `m:ss.t` via `formatTime()` in `geo.ts`.
- Coordinates: always `[lat, lng]` — never GeoJSON `[lng, lat]` order.
- Start/finish lines: exactly `[[lat, lng], [lat, lng]]`.
- Course distance: auto-calculated (Haversine between midpoints of start and finish lines). Not stored as user input.
- `next/dynamic` with `{ ssr: false }` must only appear inside `'use client'` components. Use `CourseMapClient.tsx` pattern.
- **Never store `useSearchParams()` values in `useState`** — the state initialises before the effect that reads params, causing race conditions. Derive values directly: `const next = searchParams.get('next') ?? '/att'`.
- **Route prefix `/att` is baked into the source** (`src/app/att/`) — no Next.js `basePath` config. All `href`, `fetch()`, and `router.push()` calls include `/att` explicitly.
- YAGNI + KISS: don't build what isn't needed; simplest thing that works.
- Never commit AWS credentials. IAM roles for Lambda; `aws sso` locally.
- Target domain: `paddlesnitch.com` — app at `paddlesnitch.com/att`, landing at `paddlesnitch.com/`

### Product analytics (CloudWatch EMF)

Custom product events flow to CloudWatch metrics via **Embedded Metric Format** — `emitMetric(event, props?)` in `src/lib/metrics.ts` writes one EMF JSON line; in the Lambda runtime CloudWatch auto-extracts a `Count` metric (namespace `Paddlesnitch/App`, dimension `Event`) with **no metric filters, no log parsing, no extra IAM**. Locally/in tests it's a harmless `console.log`.

- **Cardinality discipline:** the only metric dimension is `Event` (fixed allowlist in `METRIC_EVENTS`: `pageview`, `signup`, `login`, `upload`, `trial_create`, `course_create`). High-cardinality context (page `path`, session `sid`) is attached as a plain property — queryable in Logs Insights but does **not** create per-value metrics.
- **Server events** (`signup`, `login`, `upload`) are emitted directly in those routes and are **always on in production** — no flag — so they can't be spoofed and start flowing on first deploy. Cost is ~6 custom metrics (~pennies/month).
- **Client pageviews:** `src/components/Analytics.tsx` beacons a `pageview` to `POST /att/api/track` on each route change. **On in production builds**, off in dev/test; set `NEXT_PUBLIC_ANALYTICS=0` to force it off (kill switch). The endpoint drops any event not in the allowlist. No PII: only event, path, and a random per-tab `sid`.
- **Dashboard:** a CloudWatch dashboard `paddlesnitch-app` (defined in `infra/lib/att-stack.ts`) charts product events/day, period totals, and server-Lambda invocations/errors/p95. The `DashboardUrl` stack output links to it. The EMF metrics populate once events fire.
- **Not built yet (deliberate):** alarms and session heartbeats — add later if wanted.

### Cost Model (Production, Low Scale)

< 1000 entries/month:
- S3 storage + requests: < $1/month
- CloudFront: free tier / cents
- Lambda: free tier covers ~1M invocations
- API Gateway: $1/million requests
- Cognito: free up to 50,000 MAU

Migration path to add a database: replace S3 JSON reads with DynamoDB; processing Lambda writes to both S3 (raw) and DynamoDB (indexed). Leaderboard becomes a DynamoDB query instead of reading `leaderboard.json`.
