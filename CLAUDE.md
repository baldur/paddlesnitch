# paddlesnitch — paddling platform

A monorepo for **paddlesnitch**, a web platform for paddlers (kayak, canoe, SUP, rowing): **one Next.js app** (`apps/web`) over five internal packages, one Cognito user pool, one S3 bucket, one CloudFront distribution, plus the tracker firmware (`firmware/`). Three sections, one header:

- **Trials** (URL `/att`, historically "ATT — Automated Time Trials"): GPS-timed river time trials. Organisers draw start/finish lines on a map; paddlers upload GPS files; the site computes elapsed time, 500 m splits and stroke rate.
- **Paddles** (`/paddles`, formerly `/analyse`): paddle analysis with an AI-written summary. `/paddles` is also the signed-in home.
- **Devices** (`/devices`): the paddlesnitch tracker — add, see and remove trackers and their recordings. Plus **Profile** (`/profile/…`) and **Account** (`/account`).

This file is the source of truth for *current* behaviour. It's organised as: **Working with Claude** (how to work in this repo) → **Platform & monorepo** → **Shared packages** → **App: ATT** (Trials) → **App: Analyse** (Paddles) → **Ops & conventions**. Section headings keep the historical names; the UI never shows them.

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

**One repo, one pnpm workspace** (`pnpm-workspace.yaml` → `apps/*` + `packages/*`). **ONE Next app over the shared packages** (att + Analyse were merged — see [`unified-app-and-api.md`](docs/features/unified-app-and-api.md)):

```
apps/
  web/        (pkg "web")             — the whole web app: /att (Trials) + /paddles (Paddles, formerly /analyse) + /profile + /api/trpc. Next, NO basePath; /att and /paddles are baked into src/app/att/ and src/app/paddles/. The header tabs are TRIALS and PADDLES. Old /analyse URLs 301-redirect to /paddles (next.config redirects). The Analyse *domain package* stays @paddlesnitch/analysis and the upload route stays /paddles/api/analyse — only the user-facing section prefix moved.
packages/
  core/       @paddlesnitch/core      — platform primitives (auth, storage, cognito, strava, url, shared types, paddles/paddle-store)
  timing/     @paddlesnitch/timing    — GPS/track domain (geo incl. projectRoute, parsers, weather/flow/conditions, track types)
  analysis/   @paddlesnitch/analysis  — the Analyse domain/service layer (analysis engine, analysis-store, similar, trials, device-sessions, llm, share-card, history-stats, athlete-profile)
  api/        @paddlesnitch/api       — the shared, typed tRPC router (over core/timing/analysis); consumed by web (SSR + client) and, later, mobile
  ui/         @paddlesnitch/ui        — shared UI shell + design tokens + RouteThumb
firmware/     LilyGO T-Beam S3 Supreme tracker firmware — C/C++, built with PlatformIO, NOT pnpm
```

**`firmware/` is not a workspace package.** It's the hardware tracker's PlatformIO project (`pio run -e tracker|receiver|displayprobe`), deliberately outside the `apps/*`/`packages/*` globs — it has no `package.json`, `pnpm install`/`pnpm test`/`pnpm build` do not touch it, and its `.pio/` build output (~750 MB) is gitignored. Its contract with the platform lives in [`docs/features/device-uplink.md`](docs/features/device-uplink.md) + [`device-data.md`](docs/features/device-data.md) (see the Devices section under Ops); keep firmware and those specs in step. `firmware/CLAUDE.md` covers the firmware itself, and `firmware/docs/` holds its
specs — `device-states-spec.md` (screens, the one-meaning-per-gesture contract,
and the bench acceptance walk-through) and `motion-capture-spec.md`.

One Cognito user pool, one S3 bucket, one CloudFront distribution, **one server Lambda** (`ServerFn`) serving everything. Locally it's **one port** — `pnpm dev` → :3000 serves everything (`/`, `/att`, `/paddles`, `/devices`, `/account`, `/profile`, `/api/trpc`).

**API: tRPC.** JSON endpoints are typed tRPC procedures in `@paddlesnitch/api`, mounted at `/api/trpc`. SSR calls the router in-process via `createCaller`; the browser (and, later, an Expo mobile app) call it over HTTP with a shared React client (`@/lib/trpc`, provider in the root layout). Auth context accepts the `tt_id` cookie (web) **or** a `Bearer` Cognito JWT (mobile). **File uploads stay REST** (multipart: `POST /paddles/api/analyse`, the trial upload) and **firmware device endpoints stay REST**. See [`unified-app-and-api.md`](docs/features/unified-app-and-api.md).

**Conventions that keep the monorepo working:**
- Import **per-file subpaths** (`@paddlesnitch/core/auth`, `@paddlesnitch/analysis/analysis-store`), not the barrel. The app `transpilePackages` all five packages in `next.config.ts`.
- Client bundles import only client-safe subpaths (pure). Storage-backed modules are separate server-only subpaths (e.g. `core/paddles` pure vs `core/paddle-store` server; the analysis engine `@paddlesnitch/analysis/analysis` is pure, `analysis-store` is server).
- **Don't duplicate** a domain type/util — if more than one place needs it, it belongs in a package (`core`/`timing`/`analysis`). The Analyse domain lives in `@paddlesnitch/analysis`, not the app.

See [`platform-monorepo.md`](docs/features/platform-monorepo.md) (original extraction) and [`unified-app-and-api.md`](docs/features/unified-app-and-api.md) (the merge + tRPC API).

### Feature design records

Shipped specs are kept in `docs/features/` as design records. **Each doc's own status line is the source of truth for its status**; this table is an index. The sections below describe *current* behaviour.

| Doc | Status | What it covers |
|---|---|---|
| [`courses-and-entries.md`](docs/features/courses-and-entries.md) | ✅ 2026-05 | Course catalogue, entries, boat class + crew, pace, dates |
| [`visibility-clubs-tos.md`](docs/features/visibility-clubs-tos.md) | ✅ 2026-06 | Visibility, clubs (now groups), invitational trials, versioned ToS |
| [`groups-and-creation-gating.md`](docs/features/groups-and-creation-gating.md) | ✅ 2026-06 | club→group, creation gated to group admins, member-gated submission, joining |
| [`platform-monorepo.md`](docs/features/platform-monorepo.md) | ✅ superseded | The original two-app split; replaced by `unified-app-and-api.md` |
| [`unified-app-and-api.md`](docs/features/unified-app-and-api.md) | ✅ 2026-09 | One Next app + the shared tRPC API |
| [`paddle-analysis.md`](docs/features/paddle-analysis.md) | ✅ 2026-08 | The analysis engine and its design decisions |
| [`personable-insights.md`](docs/features/personable-insights.md) | ✅ 2026-08 | History-aware summary: aggregates, athlete profile, retrieval. **The model switch to Haiku/Nova was NOT made; prod runs Mixtral** (`LLM_MODEL` in `infra/lib/att-stack.ts`) |
| [`similar-sections-compare.md`](docs/features/similar-sections-compare.md) | ✅ 2026-08 | Compare a section across your paddles |
| [`weather-and-river-conditions.md`](docs/features/weather-and-river-conditions.md) | ✅ | Wind + river flow for a paddle |
| [`single-app-shell.md`](docs/features/single-app-shell.md) | ✅ 2026-08 | Shared header/shell, one dark theme |
| [`share-image-strava.md`](docs/features/share-image-strava.md) | ✅ P1+P2 | Share card image + Strava helper; P3 (activity:write) deferred |
| [`profile-routes.md`](docs/features/profile-routes.md) | ✅ | Platform-level profile/account routes (account is now `/account`) |
| [`strava-auto-import.md`](docs/features/strava-auto-import.md) | ✅ (ops step pending) | Strava webhook auto-import |
| [`device-uplink.md`](docs/features/device-uplink.md) + [`device-data.md`](docs/features/device-data.md) | ✅ 2026-09 | Tracker pairing, chunked upload, what the data contains |
| [`device-ota-and-auth.md`](docs/features/device-ota-and-auth.md) | ✅ built; rollback seen on hardware | Firmware OTA; every merge to `main` promotes |
| [`device-screen-map.md`](docs/features/device-screen-map.md) | 📋 reference | Tracker screens and the web pages they lead to |
| [`qr-onboarding.md`](docs/features/qr-onboarding.md) | Phase 1 built | Scan to join WiFi, scan to add a tracker |
| [`sitemap.md`](docs/features/sitemap.md) | ✅ current map | Every route, as of the 2026-09 navigation clean-up |
| [`security-audit-2026-09.md`](docs/features/security-audit-2026-09.md) | 🔍 audit, 2026-09-29 | Security, privacy, resilience (firmware, web, live AWS). Fixes: PRs #303–#320. The rest: 15 decisions with trade-offs. Read "Read this first" before handing trackers to testers |
| [`behavioural-analytics.md`](docs/features/behavioural-analytics.md) | 🚧 spec, not built | Consent-gated struggle signals |
| [`release-testing.md`](docs/features/release-testing.md) | ✅ in use 2026-10 | Firmware release checklist: bench walk with `firmware/tools/bench.sh`, phone steps, after-merge update check, rollback; plan for beta channel + hardware in CI |
| [`tracker-bluetooth-sync.md`](docs/features/tracker-bluetooth-sync.md) | 📋 spec, not built | Recordings home by phone/browser over Bluetooth, compression first, game-style setup |
| [`one-paddle.md`](docs/features/one-paddle.md) | ✅ phases 1–4 built | One paddle whatever the source: tracker stroke rate through the paddle, automatic tracker paddles, boat motion on the paddle page, same-outing comparison |

### Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript | Full-stack, server + client components |
| Styling | Tailwind CSS v4 | No shadcn/ui — custom retro design system |
| Maps | Leaflet + react-leaflet v5 | Free, no API key |
| Map drawing | Custom click-to-place | 2 clicks per line; no Leaflet.draw dependency |
| Auth (local dev) | cognito-local emulator on port 9229 | Same Cognito SDK calls as prod — only the endpoint URL differs |
| Auth (production) | AWS Cognito User Pool `paddlesnitch-users` (eu-west-1_BHyKJ0toh) | Email/password, email code (OTP, via SES) and Sign in with Strava; magic link is disabled; Google/Apple not wired |
| Storage (local dev) | Filesystem under `apps/web/.local-data/` | `@paddlesnitch/core/storage` (app shim `src/lib/storage.ts`) |
| Storage (production) | Amazon S3 | Same interface, different backing |
| API | tRPC (`/api/trpc`, `packages/api`) for JSON; Next route handlers for uploads, auth, account, devices | Same handlers in local dev and prod |
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
auth/signup           POST — Cognito SignUp + AdminConfirmSignUp, sets tt_id + tt_refresh
auth/login            POST — Cognito InitiateAuth (USER_PASSWORD_AUTH), sets tt_id + tt_refresh
auth/logout           POST — clears cookies, revokes refresh token
auth/me               GET  — returns the user claims from the current ID token, or `null` (200) when signed out. Signed-out is a normal state for this probe (the auth cookie is httpOnly, so the client always calls it); it answers 200 with a null body rather than 401 so a logged-out page load doesn't log a console error. Callers treat a null body as "not signed in". The tRPC `me` procedure returns `{ user: AuthUser | null }` the same way.
auth/magic-request    POST — 501 (magic link is disabled; email code + password are the sign-in methods)
auth/magic-verify     GET  — redirects to /signin?error=magic_disabled
courses               GET / POST
courses/[id]          GET / PATCH
courses/validate-trace POST — organiser tool: multipart {file, geometry JSON}; runs the trace through processTrace + diagnoseGates and returns { matched, totalElapsedSeconds?, gateAnalysis?, message? }. Stores nothing. Used by ReferenceTraceValidator on the course form to catch a backwards gate before anyone races (#71).
trials                GET (?courseId=) / POST
trials/[id]           GET / PATCH (open/close, visibility, participation, invitees; `{regenerateSubmitToken:true}` mints a shareable submit token, `{submitToken:null}` revokes it — owner/admin only)
trials/[id]/upload    POST (?invite={submitToken} bypasses the participation gate for link-holders; viewing still required) — parse GPX/FIT/CSV (or Strava import via {stravaActivityId}), process, rebuild leaderboard. On a "did not cross the lines" failure, the 422 body carries `diagnostic: { track, course }` (parsed track as [lat,lng] pairs, downsampled to ≤1500 points, plus the course geometry) so the upload page can render a map of the track against the start/finish lines. For gate courses the 422 also carries `diagnostic.gateAnalysis` (see `diagnoseGates`) and the error message names the specific blocking gate. The full-fidelity failing track + course (+ gateAnalysis) is also persisted to `trials/{trialId}/failed-uploads/{userId}/{id}/diagnostic.json` (best-effort; a write error doesn't change the 422) so a failure can be reproduced offline. Failed uploads are otherwise not saved. They ARE covered by GDPR: included in the account export (Art. 15) and removed on account erasure (Art. 17), same as entries.
trials/[id]/can-submit   GET (?invite=) — phase 3: { canSubmit } for the viewer, or { canSubmit:false, reason:'members'|'invitational', group? } so the upload page can show a join/invite CTA. A valid `?invite={submitToken}` answers canSubmit even on a gated trial. 404 if the viewer can't even view the trial.
trials/[id]/leaderboard GET
strava/connect        GET  — sets state cookie, 302 to Strava authorize URL
strava/callback       GET  — verifies state, exchanges code, persists tokens, redirects to /account?strava=connected
strava/status         GET  — { connected, athlete? }
strava/disconnect     POST — revokes on Strava, deletes local tokens
strava/activities     GET  — recent water-sport activities, refreshes token if needed
feedback              POST — files a customer-reported GitHub issue (anti-bot gate, see below)
account/export        GET  — JSON archive of the signed-in user's data (GDPR Art. 15) — courses, trials, entries, failed uploads, paddles + notes, coach profile, users/ records (Strava as connected+athleteId only, never tokens), groups + role, trackers (no tokenHash) + recording metadata (raw tracker CSVs on request: too big for one response)
account               DELETE — full account erasure (GDPR Art. 17). Also: `eraseUserAnalysis` (paddles, coach profile, share index), `eraseUserDevices` (owned trackers unlinked, claims, parts; recordings deleted by OWNER not device prefix — a tracker that changed hands keeps the previous owner's), `removeUserFromAllGroups` (owned group → first admin, else first member, deleted only if empty), `eraseFeedbackContactsForUser`, Strava deauthorised + athlete index removed. Every kind of personal data needs a line here AND in export — see `src/tests/account-data-complete.test.ts`.
account/profile       GET / PATCH — read or set the viewer's profile visibility ({ public: boolean }); profiles are opt-in (private by default)
account/handle        GET (?check=) / PUT / DELETE — check availability, claim/change, or release the viewer's vanity profile handle
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

**Note on trial path:** Trials are stored flat (`trials/{trialId}/`) not nested under courseId. The `courseId` is stored inside `metadata.json`. This simplifies lookups by trialId.

#### Anti-bot gate

Unauthenticated POST endpoints that send email or create content guard against naive bots with two invisible, zero-friction checks in `src/lib/anti-bot.ts` (`looksLikeBot()`):

- **Honeypot** — a hidden `website` form field real users never fill; bots scraping inputs do.
- **Time trap** — submissions arriving sooner than `MIN_ELAPSED_MS` (2 s) after the form loaded are bots. The client sends `elapsedMs` measured from page/form mount.

A positive result means **drop silently**: skip the side effect (send no email, create no Cognito user, file no issue) and return a success-looking response so the bot gets no signal to adapt. Guarded routes:

- `auth/otp-request` — the gate runs **before** `signUp`/SES, so a bot can't email-bomb arbitrary inboxes *or* churn junk Cognito accounts. On a bot signal it returns a throwaway `{ session }`; a rare false-positive human hits "use a different email" to retry (timer resets, well past 2 s by then).
- `auth/password-reset/request` — returns the same `{ ok: true }` it returns for a non-existent account; `forgotPassword` never runs.
- `feedback` — returns `{ ok: true }` without filing the issue.

Client forms (`/signin` OTP tab, `/signin/forgot`, the feedback widget) carry the hidden `website` input + a `mountedAt` ref. These checks only stop unsophisticated bots — a script POSTing JSON directly omits both fields. They're a cheap first line, **not** a guarantee; a real challenge (Turnstile) or rate limiting would be the next step if targeted abuse appears. Tests: `src/lib/anti-bot.test.ts` (unit) plus bot-drop cases in `otp.test.ts`, `password-reset.test.ts`, `feedback.test.ts`.

#### Customer-issue automation (GitHub)

The full lifecycle of a customer report:

1. **Create** — the "Report an issue" widget (every page; POSTs to `/att/api/feedback`) files a GitHub issue labelled `customer-reported` + `triage`. The proxy exempts `/att/api/feedback` so **anonymous** reports get through (`src/proxy.ts`). **The repo is PUBLIC:** the issue carries only the report, the page as origin+path (query/fragment stripped — they can carry `?join=`/`?invite=`/`?code=` tokens), viewport and browser. Reporter name/email/account id go to `feedback-contacts/{issueNumber}.json` (`src/lib/feedback-contacts.ts`), which account erasure deletes and export includes. Never put identifying data in an issue body.
2. **Auto-intake** (`.github/workflows/claude-intake.yml`) — fires on `issues: [opened]` for `customer-reported` issues: Claude claims it (`claude-active`) and posts **one comment**: a diagnosis with a proposed fix and test, or one clarifying question. **Read and comment only** (security audit 2026-09): the issue text is written by anonymous members of the public, so this job has `contents: read`, no Edit/Write, and Bash only for `gh issue view|comment|edit`. A prompt-injected issue can make it say something, not change anything. `claude-intake.test.ts` pins this.
3. **Fast loop** (`.github/workflows/claude-fast-loop.yml`) — does the actual fixing, on a branch, as a PR. Fires on comments/reviews to `claude-active` items **from OWNER/MEMBER/COLLABORATOR only**, and on a `claude-go` label (which only people with triage access can add). So a maintainer reading the intake's diagnosis replies or adds `claude-go` to get the fix. Serialised with intake via a shared `concurrency: claude-<n>` group. Both workflows pin `claude-code-action` to a commit SHA.
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
                └──► SES (noreply@paddlesnitch.com)         ← sign-in codes, invitations, notifications
```

OpenNext v4 bundles the Next.js server into a single Lambda. No API Gateway — CloudFront routes directly to a Lambda function URL. Static assets (JS/CSS/images) go to S3 and are served by CloudFront with long cache TTLs.

**Deploy is not atomic — asset ordering matters (both directions).** Next.js chunks are content-hashed, so a deploy that changes shared code (e.g. the header) rehashes every page's bundle. Two guards in `infra/lib/att-stack.ts` keep the site from breaking mid-deploy: (1) the asset `BucketDeployment`s use **`prune:false`** so the PREVIOUS build's hashed files survive for in-flight/cached OLD HTML (a lifecycle rule expires orphans later); and (2) the server Lambda (`ServerFn`) has an explicit **`.node.addDependency(deployAssets)`** so CloudFormation uploads the NEW chunks to S3 *before* flipping the Lambda that serves HTML referencing them — otherwise the new HTML 404s on `/_next/static/*` for the duration of the upload. The BucketDeployments deliberately carry **no** `distribution`/`distributionPaths` (that built-in invalidation would depend on the distribution → serverFn and force the wrong order / a cycle); invalidation isn't needed for immutable hashed assets — invalidate a changed non-hashed `public/` path manually if that ever comes up.

Cognito is the identity store. The server function has IAM permission for an explicit list of `cognito-idp` actions on the user pool and `ses:SendEmail` for the `paddlesnitch.com` identity. The S3 data bucket holds *only* course/trial/entry data — no user records, no sessions.

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

---

## Shared packages

Five internal packages: `core`, `timing` and `ui` are described here; `analysis` (the Paddles domain: engine, store, summary/LLM, similar sections, trial and tracker sources) and `api` (the tRPC router) are covered under **App: Analyse** and **Platform & monorepo**. Each exposes **per-file subpath exports** — import the subpath, not the barrel.

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

### `@paddlesnitch/ui` (`packages/ui/src`)

The shared UI shell ([`single-app-shell.md`](docs/features/single-app-shell.md)). Theme-aware,
**presentational + config-driven** (props: user, hrefs, callbacks, endpoint), per-file
subpath exports, `transpilePackages`d. The app wires it once: `components/AppHeader.tsx`
(every page's header) + `components/AccountMenu.tsx` (the account menu).
- `tokens.css` — canonical platform design tokens (**dark**) as a Tailwind v4
  `@theme`. An app's `globals.css` does `@import "@paddlesnitch/ui/tokens.css"` +
  `@source "…/packages/ui/src"`; components use only the semantic token classes
  (`bg-bg`, `text-fg`, `border-border`, `text-muted`, `text-primary`, …).
- `FeedbackWidget` — the one report-an-issue widget (floating + opens on a
  `paddlesnitch:open-feedback` event), POSTs to `/att/api/feedback`.
- `AccountNav` — signed-in/out account nav (props-driven). **Signed in it's a single dropdown** (`Name ▾`) holding everything common to every page — PADDLES, DEVICES, PROFILE, ACCOUNT, REPORT AN ISSUE (dispatches the `paddlesnitch:open-feedback` event), SIGN OUT; closes on click-outside + Escape. `paddlesHref`/`devicesHref` are **optional** — the host omits the prop and the row disappears. The DEVICES row is shown to every signed-in viewer (`/devices` is also where you add your first tracker). Signed out → a plain `SIGN IN` link. This consolidation (from the old flat name/ACCOUNT/SIGN OUT + a standalone header REPORT) keeps the header uncluttered.
- `AppShell` — platform header (brand + TRIALS/PADDLES section **tabs** + optional section `nav` slot + account slot). The lit tab comes from the URL via `sectionFor(pathname)` (`/att…` → trials, `/paddles…` → paddles, anything else → neither); the app's `AppHeader` reads `usePathname()`. It used to hard-code `att`, lighting TRIALS on home/profile/account pages. Page titles use the root template `%s · paddlesnitch`; each section's `layout.tsx` names itself (Trials, Paddles, Profile). Inside Trials, back links say **← TRIALS** (to `/att`); **← HOME** always means `/`. Common actions live in `AccountNav`'s dropdown, **not** the top level (there is no standalone REPORT button anymore — anonymous users still get `FeedbackWidget`'s floating button). **Cross-app links (`/`, `/att`, `/analyse`) and the account links (`/att/…`, `/profile/…`) use plain `<a>`, NOT `next/link`** — Analyse runs under `basePath:'/analyse'`, which makes `<Link>` prepend the basePath (turning `/att` into `/analyse/att`). App-supplied same-app `nav` children keep using `<Link>` (they SHOULD get the basePath).
- `ContactBanner` — dismissible top banner (Strava add-email); host supplies the show-predicate + href.
- `Analytics` + `analytics` + `metrics-events` — shared client event capture (see Product analytics under Ops). `metrics-events` is the pure event allowlist (single source of truth); `analytics` is the buffered `capture()`/`flush()`/`startAnalytics()` pump; `Analytics` is the layout-mounted component both apps render. att re-export shims live at `@/lib/analytics` + `@/components/Analytics`; att's `@/lib/metrics` re-exports the vocabulary and keeps the server EMF helpers.

---

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

**trackSegment**: `ProcessedResult.trackSegment` stores the interpolated lat/lng path from start crossing to finish crossing. Used to plot the leader's track on the leaderboard map. Coordinates are **rounded to 6 dp (~0.1 m, well under GPS noise) in `buildResult`** — full-precision floats are ~incompressible and dominate the payload, so rounding cuts the served/stored trackSegment ~2.8× after gzip (it reaches the client via `GET /att/api/entries/[entryId]` and the trial page SSR). See "Payload sizing" under Ops.

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

**Heart rate is intentionally NOT captured** (a sensitive biometric) — every parser strips it at parse time. **Stroke rate (a.k.a. cadence) IS captured** for paddlers (#143): each parser reads it from that format's own field (GPX `<gpxtpx:cad>`/`<cadence>`, FIT `cadence` + `fractional_cadence`, TCX `<Cadence>`/`<RunCadence>`, CSV aliases `cadence`/`cad`/`stroke rate`/`spm`/`sr`, SpeedCoach `Stroke Rate`), stores it on `TrackPoint.strokeRate`, and `geo.buildResult` averages it. In practice the **FIT** export is the reliable carrier — GPX exports (Strava, SpeedCoach) frequently omit stroke rate. See `docs/features/courses-and-entries.md`. **User-facing claims are tested:** `src/lib/legal-claims.test.ts` ties the privacy page, FAQ and cookie notice to the code (stroke rate kept, heart rate never, page views counted, and every outside host the code calls must be named on the privacy page). Adding an external service means adding it to that test AND the privacy page — and the policy promises to email users before new services or data kinds.

#### Boat class
Every entry carries a `boatClass`. Kayak: `K1`, `K2`, `K4`. Sculling: `1X`, `2X`, `4X+`, `4X-`. Sweep: `2-`, `4+`, `4-`, `8+`. Defined in `src/lib/types.ts` (`BoatClass`, `BOAT_CLASSES`, `BOAT_CLASS_INFO`, `isBoatClass`). The leaderboard UI defaults to showing all classes with a filter dropdown — comparing a 1X to an 8+ is not meaningful so users typically filter to their own class. Crew (per-seat names) is stored too (`CrewMember`, `validateCrew` in core).

#### Line Crossing Detection
Given a GPS track as an ordered array of `[lat, lng, timestamp]` tuples and a line (two `[lat, lng]` points), a crossing is detected when any consecutive pair of track points forms a segment that intersects the line. Intersection uses standard 2D line-segment math (cross-product / parametric form). Haversine is used for distance calculations. All geo math lives in `src/lib/geo.ts`.

**Best-effort / fastest-segment algorithm** (`processTrace` in `geo.ts`): for a full-session upload (warmup + cooldown included), the system finds **all** crossings of the start line in the track, then for each start crossing finds the nearest subsequent finish crossing. The result with the shortest elapsed time is returned — analogous to Strava's "best effort on a segment." This means participants can upload their complete session without trimming; the algorithm automatically extracts the actual racing segment.

#### 500 m Split Calculation
Walk the track from the start-crossing point, accumulating Haversine distance between consecutive points. Record the interpolated timestamp each time cumulative distance crosses a 500 m boundary. Continue to the finish crossing.

### Auth System

#### Identity store

All users live in a Cognito User Pool — no user records in S3 or the filesystem.

- **Local dev**: cognito-local emulator on port 9229 (`pnpm cognito`). Stores users in `apps/web/.cognito/db/`.
- **Production**: AWS Cognito pool `paddlesnitch-users` — `eu-west-1_BHyKJ0toh` (eu-west-1).

App code never branches on environment. Only the Cognito SDK endpoint differs:
- dev → `COGNITO_ENDPOINT=http://localhost:9229`
- prod → endpoint unset; SDK hits AWS directly

#### Sign-in flows

1. **Email + password** — Cognito `USER_PASSWORD_AUTH` flow. Cognito enforces the password policy (8+ chars, mixed case, digit).
2. **Email OTP** — **hidden while `EMAIL_DELIVERY` is false** (`apps/web/src/lib/email-delivery.ts`): SES production access was refused, so codes only reach verified addresses. The EMAIL CODE tab is hidden and /signin/forgot says to use Report an issue instead (password resets are emailed too). Flip the constant when `aws sesv2 get-account` shows ProductionAccessEnabled. Cognito `CUSTOM_AUTH` flow. Our three Lambda triggers generate a 6-digit code, email it via SES, and verify it. See `infra/lambdas/cognito-auth/`.
3. **Sign in with Strava** — server-driven OAuth. Routes: `/att/api/auth/strava/init` sets a CSRF state cookie and 302s to `strava.com/oauth/authorize` with `scope=read,activity:read_all,profile:read_all`. `/att/api/auth/strava/callback` exchanges the code, fetches the authenticated athlete's profile (`/api/v3/athlete`), then resolves the Cognito user by trying in order: (a) `strava-athletes/{athleteId}.json` index, (b) `cognito ListUsers` with `email = ...` (auto-link to an existing email account — only when Strava actually returned an email, otherwise skipped), (c) `AdminCreateUser` with a random unused password. Sign-in goes through the existing `CUSTOM_AUTH` flow with a server-generated one-time token. **The token is passed via the user's `custom:auth_preset` attribute, NOT `ClientMetadata`** — Cognito does **not** forward `ClientMetadata` to the Create/Define/Verify Auth Challenge triggers (AWS limitation; it only reaches Pre-Signup/Pre-Auth/User-Migration), so the original `ClientMetadata.preset_otp` approach silently never worked and `CreateAuthChallenge` always fell through to emailing a random code. `customAuthSignIn()` now sets `custom:auth_preset` via `AdminUpdateUserAttributes` right before `InitiateAuth`, `CreateAuthChallenge` reads it from `event.request.userAttributes['custom:auth_preset']` (clientMetadata kept only as a dev/test fallback), and the attribute is cleared after. Only the server can do both halves of that dance, so the path is server-trusted.

> **One-time pool setup (already done in prod):** the `custom:auth_preset` attribute was added out-of-band — `aws cognito-idp add-custom-attributes --user-pool-id <pool> --custom-attributes Name=auth_preset,AttributeDataType=String,Mutable=true`. It is **not** declared in the CDK `UserPool` construct on purpose: changing the pool's schema through CloudFormation can force a pool *replacement* (losing all users), so schema additions are manual, like the SES rule-set activation.
   **Strava never shares email** with third-party apps (their policy, not a bug). When the profile call returns no email field, we mint a synthesised address `strava-{athleteId}@noreply.paddlesnitch.com` to satisfy Cognito's email-format requirement. The user sees a banner inviting them to add a real contact email at `/account` (see `src/lib/strava-account.ts` + `src/components/AttContactBanner.tsx` (over `@paddlesnitch/ui/ContactBanner`)). Real emails sit in `users/{userId}/contact.json` (separate from the Cognito email) and feed any future outbound comms.
4. **Magic link** — **disabled.** `magic-request` answers 501 and `magic-verify` redirects to `/signin?error=magic_disabled`. Email code (flow 2) replaced it.
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
- `GET  /att/api/auth/me` — verifies JWT (and silent-refreshes if expired), returns user claims, or `null` with a **200** when signed out (not 401 — a 401 on this always-called probe is logged as a console error on every logged-out page load; callers key off the null body)
- `GET  /att/api/auth/strava/init` — Strava sign-in: state cookie + redirect to Strava with `profile:read_all`
- `GET  /att/api/auth/strava/callback` — finds/creates Cognito user, runs `CUSTOM_AUTH` with preset token, sets `tt_id` + `tt_refresh`, redirects to `next`
- `POST /att/api/auth/magic-request` — disabled in v1 (returns 501 with friendly message)
- `GET  /att/api/auth/magic-verify` — disabled in v1 (redirects to `/signin?error=magic_disabled`)

#### Access control

- **Proxy (`src/proxy.ts`)**: cheap cookie-presence check at the edge — does NOT verify the JWT (keeps middleware fast). Redirects to `/signin?next={path}` if absent. Real verification happens in API/page handlers via `getAuthUser()`.
- Public without login: home (open trials list), leaderboard, upload form (shows sign-in prompt).
- Admin pages require login.

#### Adding Google/Apple OAuth (future)

User pool is already deployed. Steps when ready:
1. Register OAuth client in Google Cloud Console / Apple Developer portal
2. Add identity provider to the pool in CDK (`cognito.UserPoolIdentityProviderGoogle`)
3. Add a Cognito domain (`userPool.addDomain(...)`) and callback URL
4. Add "Sign in with Google" button to `/signin` (redirects to hosted UI)
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
- **Auto-import (webhook) — [`strava-auto-import.md`](docs/features/strava-auto-import.md)**: new water-sport activities appear in **My Paddles** automatically via the Strava **Webhook Events API**. Callback `GET|POST /api/strava/webhook` (public — Strava is the caller; GET echoes `hub.challenge`, POST acks 200 fast + processes in `after()`). An `activity create` → map `owner_id`→user via the `strava-athletes/{id}` index → if auto-import is on, `importStravaActivity()` → the shared `analyseAndSave` pipeline (water-sport filtered, de-duped). An `athlete` deauthorize event → disconnect (delete tokens + index). **Opt-in default-ON** per connected user (`users/{userId}/strava-prefs.json`, toggle in Account → Strava). One-time ops: set `/att/strava-webhook-verify-token` (SSM) then `pnpm --filter web strava:webhook create` (Strava allows ONE subscription/app; the callback must be live first — like the SES rule-set activation). Read-only, never posts; fast-ack; deauth deletes tokens — see the record for the full Strava-guideline mapping.

#### Env vars

| Var | Where | Notes |
|---|---|---|
| `STRAVA_CLIENT_ID` | `.env.local` (dev only) | Direct override for local dev. Public — appears in every authorize URL. |
| `STRAVA_CLIENT_ID_PARAM` | env (prod, set by CDK) | Name of SSM String parameter to fetch at runtime: `/att/strava-client-id`. |
| `STRAVA_CLIENT_SECRET` | `.env.local` (dev only) | Direct override for local dev. |
| `STRAVA_CLIENT_SECRET_PARAM` | env (prod, set by CDK) | Name of SSM SecureString to fetch at runtime: `/att/strava-client-secret`. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | `.env.local` (dev only) | Direct override — the shared secret echoed on the webhook subscription handshake. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN_PARAM` | env (prod, set by CDK) | Name of SSM SecureString to fetch at runtime: `/att/strava-webhook-verify-token`. |

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

Don't hand-maintain a tree here (the last one rotted: it listed deleted components and pre-merge paths). The layout is:

- **Pages and route handlers:** `apps/web/src/app/**` (`att/` Trials, `paddles/` Paddles, `devices/`, `account/`, `profile/`, `api/` platform routes, `l/` tracker QR). `find apps/web/src/app -name page.tsx -o -name route.ts` lists them; `docs/features/sitemap.md` explains them.
- **Components:** `apps/web/src/components/` — `AppHeader` + `AccountMenu` (every page's header), `analysis/` (the paddle view), `map/` (Leaflet; `CourseMapClient` is the `ssr:false` wrapper for server components), `leaderboard/`, `devices/`, `campaigns/`, `strava/`.
- **`apps/web/src/lib/`:** app-level logic (permissions, groups, profile, entries, email, feedback-contacts, beta-signups, tracker-copy, …) plus one-line **re-export shims** (`geo`, `parse`, `storage`, `auth`, `strava`, `types`…) over the packages, kept so old `@/lib/*` imports resolve. New shared code goes in a package, not a shim.
- **Header behaviour:** the lit tab follows the URL; signed-out pages show SIGN IN in the account slot.

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

Profile + account are **platform-level routes** ([`profile-routes.md`](docs/features/profile-routes.md)). **Sign-in, help and the legal pages are site-wide (2026-10):** `/signin` (+ `/signin/forgot`, `/signin/reset`), `/help` (a hub: tracker guide, troubleshooting, then the Trials FAQ), `/privacy`, `/terms` (+ `/terms/accept`); the old `/att/auth`, `/att/faq`, `/att/privacy`, `/att/tos` 308 to them in one hop with the query kept (`next.config.ts`, covered by `redirects.test.ts`). **Account settings live at `/account`** (called ACCOUNT everywhere — never "settings"); `/profile/me/settings` and `/att/account` 308 straight to it (`src/tests/redirects.test.ts` also fails on chained redirects). Profile: public profile `/profile/{id-or-handle}`, your own `/profile/me` (→ redirects to your public profile, which shows an EDIT PROFILE link to `/account#profile` when it's yours), account API `/api/account/*`. Old `/att/u/:id` 308s to `/profile/:id`. `/profile/me*`, `/account` and `/api/account` mutations are auth-gated in `src/proxy.ts`; `/profile/:id` is public.

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

- **Signup** requires `acceptedTosVersion: CURRENT_TOS_VERSION` in the request body. The signup form on `/signin` ships the constant; an out-of-date client gets 422 instead of silently signing the user up.
- The signup hook records `{ version, acceptedAt }` at `users/{userId}/tos-consent.json`.
- **Every other way in accepts them at sign-in** (2026-09-29): EMAIL CODE and Strava create accounts with no Terms box, so `otp-verify` and `login` return `needsTerms` and the Strava callback redirects, sending anyone without the current version to **`/terms/accept?next=…`** (tick, CONTINUE, then on to `next`; `termsAcceptPath()` in `src/lib/terms-path.ts`). That also catches accounts from before the current version. A session that is already signed in isn't interrupted until its next sign-in.
- `GET /api/account/tos` returns `{ currentVersion, accepted, acceptances[] }` for the authenticated viewer.
- `POST /api/account/tos { version }` records an acceptance. Refuses anything other than `CURRENT_TOS_VERSION` (no future-version land-grab).
- Public ToS page at `/terms` rendered from the markdown source.

#### Bumping a version

1. Copy `legal/tos-{prev}.md` to `legal/tos-{new}.md`. Edit, including the `**Version NNN, effective …**` line (a test checks it matches).
2. Set `CURRENT_TOS_VERSION` in `src/lib/types.ts` to the new string. The signup form and tests read the constant — nothing else to bump.
3. **Email registered users** — the ToS (§9) promises this for every new version. Each user accepts the new version at their next sign-in (`/terms/accept`).

Current version: **002** (2026-09-28): adds Paddles/trackers/AI summary ("can be wrong"), stroke rate kept, and drops 001's false claims (re-accept prompt, version in footer, leaked "so we don't chase consents" reasoning).

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

**Paddles** — what happened on each outing. Pages are in `apps/web/src/app/paddles/`; the domain (engine, store, summary, similar sections, trial and tracker sources) is **`@paddlesnitch/analysis`**; JSON goes through the tRPC routers in `packages/api/src/routers/` (`paddles.*`, `sources.*`, `similar.*`, `me`). Data lives under the `analysis/` S3 prefix, private per user. The code keeps the historical names `analysis`/`analyse`; the UI never shows them.

- **Pages**: `/paddles` is the ONE list (totals + every paddle, tick two to compare, inline delete) and the **signed-in home** (`/` redirects there unless a known `?campaign=` is given); `/paddles/library` and `/analyse/library` 308 to it. `/paddles/new` is ADD A PADDLE (tabs UPLOAD FILE / FROM STRAVA / TIME TRIALS / TRACKER). Every page uses the one `AppHeader` + `AccountMenu` (no per-section header or account adapter). Paddles pages use the design tokens, not hex. The `· STRAVA / · TIME TRIAL / · TRACKER` tag is `sourceLabel()` in `@paddlesnitch/core/paddles`.
- **Sources**: file upload (GPX/FIT/TCX/CSV/SpeedCoach/zip), **Strava import**, or **analyse one of your own time-trial results** (`@paddlesnitch/analysis/trials`, no re-upload), or a **tracker recording** (`@paddlesnitch/analysis/device-sessions`).
- **Engine** (`@paddlesnitch/analysis/analysis`, pure): speed + distance-per-stroke, **baseline+departures** segmentation (rests down / surges up), per-effort trend, set grouping, SUP→kayak ×2 stroke-rate (auto for kayak boat classes; manual toggle otherwise — default off). Map `points` are downsampled to ≤900 and **rounded** (`roundPoint`: lat/lng 6 dp, speed/dps 3 dp, t 0.1 s, sr 0.1) at build time — this + gzip cuts the analyse payload ~3× (≈31→10 KB gzip) with no precision loss that matters. `rescaleDoubling` re-rounds after the SR rescale. See "Payload sizing" under Ops.
- **Conditions**: real wind + river flow via `@paddlesnitch/timing`.
- **Persistence** (`@paddlesnitch/analysis/analysis-store`): auto-saves each paddle → `analysis/{userId}/{id}/session.json` (`AnalysisSession`). The Paddles list, saved view, diary notes, per-paddle **boat class + seat**, and a persistent **athlete profile** (`analysis/{userId}/profile.json`).
- **Duplicate detection** (#178): re-submitting the same paddle (same file re-uploaded, same Strava activity re-imported, or the same trace analysed twice) doesn't create a second library entry. `paddleFingerprint(paddledAt, durationS, distanceKm)` is a source-agnostic identity derived only from stored fields (so it also matches pre-existing sessions with no migration; distance rounded to whole metres, duration to whole seconds to absorb float noise). The `POST /analyse` route computes the incoming fingerprint after `analyseTrack`, checks `findDuplicateSession` (best-effort — a storage error degrades to a normal save, never a 500), and on a hit returns the existing paddle with `duplicate: true` (skipping the LLM call + save). ADD A PADDLE (`/paddles/new`) shows "You've already added this paddle" with OPEN IT → `/paddles/{id}` instead of rendering a fresh duplicate.
- **LLM summary** (`@paddlesnitch/analysis/llm`, `makeInsighter()`): Ollama local / **Bedrock prod** (never the Anthropic quota), model per env `LLM_MODEL`, bounded by `withTimeout` (`LLM_TIMEOUT_MS`); deterministic templated fallback when no backend, so it never breaks. Memory-aware via `history-stats.ts` (cross-history aggregates + relevance retrieval) + the athlete profile — the enrichment is best-effort and off the request's critical path, so it can never fail the analysis.
- **Compare a section** (`@paddlesnitch/analysis/similar`): "race a section" across your own paddles between two derived gate lines, and a single-section "analyse this stretch" narrative.
- **Share a paddle (#202)**: an owner can opt a saved paddle into an **unlisted public link** and revoke it. `analysis-store.ts` `shareSession`/`unshareSession`/`getSharedSession` maintain a share index `analysis/shared/{shareId}.json → { userId, sessionId }` (so the token resolves to the owner's session without the userId appearing in the URL; idempotent — same link on repeat share; `deleteSession` drops the index; a stale index whose session no longer bears the token doesn't resolve). Owner procedures `paddles.share`/`paddles.unshare`; public `paddles.shared` (strips the private diary note — exposes result + boat only). **The shared view never shows the AI summary**: it is written from the owner's diary notes + coach profile and can repeat private text, so `paddles.shared` swaps in `plainInsight(result)` (the deterministic template, rebuilt from the saved numbers) and drops `insightModel`. The public page `/paddles/shared/[shareId]` renders `AnalysisView` in `readOnly` mode (no edit controls; "analyse your own" CTA). `AnalysisView` shows a `SHARE` control (owner only). No `AnalysisSession` schema change beyond an optional `shareId`.
  - **Share-card image + Strava helper (#212, P1+P2):** the shared route has an `opengraph-image` (`app/paddles/shared/[shareId]/opengraph-image.tsx`, `next/og`) — a branded 1200×630 card with the route polyline + distance/time/pace/rate + boat tag + wordmark + `paddlesnitch.com`. Pure data via `shareCard()` (`@paddlesnitch/analysis/share-card`, tested); missing/revoked link → a generic branded fallback (never leaks); sets `og:image` (X uses it as the twitter fallback — no `twitter-image`, which Turbopack can't statically read as a re-export). **No QR** — it needs a second device's camera, useless phone-on-phone; the click-through is the **tappable link** the owner pastes (Strava linkifies URLs) + the OG unfurl on social. SHARE panel: **DOWNLOAD IMAGE** (fetch the OG image → save) for all paddles, and for Strava-sourced ones an **OPEN MY STRAVA ACTIVITY ↗** deep-link (needs `stravaActivityId` on the owner's `ViewData.source`) + a paste-the-tappable-link nudge. See [`share-image-strava.md`](docs/features/share-image-strava.md).
- **Routes**: the one REST route is the upload/analyse pipeline, `POST /paddles/api/analyse` (multipart). Everything else is tRPC: `paddles.list/sessions/get/delete/setNote/setBoat/setDoubling/share/unshare/shared`, `sources.strava/trials/devices`, `similar.find/compare/sectionInsight`, `me`.
- **Key files**: `apps/web/src/app/paddles/api/analyse/route.ts` → `@paddlesnitch/analysis/pipeline` (`analyseAndSave`), `apps/web/src/components/analysis/AnalysisView.tsx` (the paddle view: site header, the map with only the colour scale + legend, replay bar and section picking over it, then the numbers, summary and efforts table below, actions beside (a compact row under the map on a phone); it replaced a full-screen map with floating panels in 2026-10. Adding a paddle goes to `/paddles/{id}`), `apps/web/src/components/map/AnalysisMap.tsx`. It runs on the one server Lambda (`ServerFn`); there is no separate Analyse Lambda any more.

Feature records: [`paddle-analysis.md`](docs/features/paddle-analysis.md), [`similar-sections-compare.md`](docs/features/similar-sections-compare.md), [`personable-insights.md`](docs/features/personable-insights.md).

---

## Ops & conventions

Cross-cutting: how to run the apps, test, deploy, and the shared conventions + design language both apps follow.

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

Pattern: pure lib functions get unit tests; API routes get integration tests against real temp filesystem + real cognito-local. Only `next/headers` is mocked (Next.js server-only API). No SDK mocks.

Run: `pnpm test`

**Firmware has a host test environment now** — `cd firmware && pio test -e native`,
~0.5 s, no board. It compiles only `src/naming.cpp` (the pure track-vs-sidecar
predicates and the chunk maths) against `firmware/test/`. It exists because
`isTrackUpload` not excluding the `_i10.csv` suffix cost a full debugging
session and five wrong diagnoses; that is now three lines of test that run
before the first flash. **Pure logic that has burned us belongs there.** Anything
needing Arduino, the SD card or the radio stays in a hardware env — `[env]` was
split into `[hw]` precisely so `native` inherits neither a board nor the arduino
framework.

### Test pyramid

Two tiers. Don't blur them — they catch different bugs and the cost profiles are very different.

| Tier | Lives in | What it catches | Cost |
|---|---|---|---|
| **Unit + integration** (vitest) | `src/lib/*.test.ts`, `src/tests/*.test.ts` | Pure-function correctness, route-handler behaviour, every row of the permission matrix as a story-style test name | ~2 s for the whole suite |
| **E2E critical paths** (Playwright) | `e2e/critical/*.spec.ts` | Real-browser cookie flows, form-to-route-to-page round trips, redirect chains, multi-page navigations | ~30 s per scenario; 3–5 scenarios target |

#### Run

```bash
pnpm test          # the whole vitest suite (a few seconds) — see the monorepo note below
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
- **Tiles**: **Esri Gray Canvas** (keyless raster) — att maps toggle World_Light_Gray_Base ↔ World_Dark_Gray_Base; analyse maps are Dark Gray only. `maxNativeZoom={16}` (Esri's native cap) + `maxZoom={19}` so Leaflet upscales beyond 16 instead of 404ing. Swapped off CARTO's free basemaps, which started serving an "API key required" nag tile once an IP passed their informal limit. River layer recolours to match: cyan neon on dark, blue on light.
- **River overlay** (opt-in): `RiverLayer.tsx` renders `/data/rivers.geojson` (OSM UK data, `pnpm rivers`) as non-interactive cyan (`#06b6d4`) lines with a neon glow behind the course lines. Line weight/opacity scales by waterway type (`w` property: `river` | `canal`). **Gated behind `NEXT_PUBLIC_RIVERS=1`** and off by default: the geojson is gitignored and not deployed, so fetching it 404s in dev / 403s in prod — a console error on every map. The component skips the fetch entirely unless the flag is set, so the overlay is a no-op (no error) until someone generates the file, deploys it as an asset, and sets the flag.
- **Coordinates**: `[lat, lng]` throughout — NOT GeoJSON order.

#### River data
`public/data/rivers.geojson` is gitignored (16.5 MB raw, ~3.3 MB gzipped). Regenerate with `pnpm rivers`.

Source: OpenStreetMap via Overpass API — UK rivers and canals (60,065 features). Streams omitted (visible on the dark base tile). Simplified at 0.001° tolerance (~100 m) for browser performance. The `w` property is `river` or `canal`.

The script requires a `User-Agent` header; Overpass blocks the default Node.js UA.

### Design System

**Aesthetic: minimal, data-centric, DARK — dense tables, IBM Plex Mono, single blue accent.** The whole platform is dark ([`single-app-shell.md`](docs/features/single-app-shell.md)); the canonical tokens live in **`@paddlesnitch/ui/tokens.css`** (Tailwind v4 `@theme`), imported by each app's `globals.css`. **Use the semantic token classes** (`bg-bg`, `bg-surface`, `text-fg`, `text-muted`, `border-border`, `text-primary`, …) — do **not** hardcode hex (`bg-[#0b1220]`); the whole point of the migration was to make colour swap in one place.

| Token | Value (dark) | Class | Usage |
|---|---|---|---|
| Background | `#0b1220` | `bg-bg` | `<body>` |
| Surface | `#0f172a` | `bg-surface` | cards, form fields |
| Surface-2 | `#1e293b` | `bg-surface-2` | hover states |
| Border | `#1e293b` | `border-border` | dividers |
| Primary | `#0369a1` | `text-primary`/`bg-primary` | times, CTAs, active links (white text on it) |
| Split | `#a78bfa` | `text-split` | split times, cadence data |
| Green | `#22c55e` | `text-green` | start line, open status |
| Red | `#f87171` | `text-red` | finish line, close/delete |
| Text | `#e2e8f0` | `text-fg` | body |
| Muted | `#94a3b8` | `text-muted` | labels, secondary text |
| Font | IBM Plex Mono | `--font-mono` | everything — loaded via `next/font/google` |

CSS utilities in `globals.css`: `.tabular` (tabular-nums), `.tt-link`/`.tt-nav-link` (token-based).
Maps: dark tiles (Esri World Dark Gray); att maps still default to light with a dark toggle (flip pending — see the spec's follow-ups). No rounded corners on data elements. Sharp, precise. Mobile-first; tap targets ≥ 44px. The historical light palette values (`#ffffff`/`#0f172a`/…) are retained in comments in `tokens.css` as a possible future light mode.

### Writing for the site

Plain words, one name per thing. `apps/web/src/lib/copy-style.test.ts` fails on phrases we removed; add to its list when you retire a word.

1. **One name per thing:** Trials (URL `/att`), Paddles, Devices, Profile, Account — never "Settings", "My …", "Analyse" (as a place), "library", "ATT/ATTS". A paddle, a tracker (not "device" in prose), a recording (from a tracker), an effort, a rest, a section, stroke rate (not cadence), add/remove (not link/pair/revoke).
2. **Buttons:** 1–3 uppercase words that say what happens (SAVE, ADD, REMOVE TRACKER). Loading = same verb + "…". No emoji.
3. **Labels and headings:** uppercase (in source, or via `uppercase`); helper text on its own muted line below, sentence case.
4. **Errors:** "Couldn't …" + what to do ("Please try again." only when retrying helps). Never codes, vendor names (Cognito, JWT, S3), "token", "state", "endpoint", raw enums.
5. **One idea per sentence, ~20 words max;** helper text two sentences at most. No marketing filler (suite, seamless, unlock, journey, "actually happened"), no lists of three for rhythm, few em-dashes.
6. **Don't blame the reader** ("We can't find this paddle", not "it isn't yours"), and **don't claim causes the data can't show** ("slowed", not "faded (fatigue)").
7. **Units:** lowercase with a space — `2.1 km`, `/500 m`, `58 spm`; pace is `/500`, not m/s.
8. **No AI model names on screen.** AI-written text follows the same rules.

### Key Conventions

- All IDs: `nanoid()` — URL-safe, short.
- Timestamps: ISO 8601 strings in JSON.
- Times: stored as seconds (float), displayed as `m:ss.t` via `formatTime()` in `geo.ts`.
- Coordinates: always `[lat, lng]` — never GeoJSON `[lng, lat]` order.
- Start/finish lines: exactly `[[lat, lng], [lat, lng]]`.
- Course distance: auto-calculated (Haversine between midpoints of start and finish lines). Not stored as user input.
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
- YAGNI + KISS: don't build what isn't needed; simplest thing that works.
- Never commit AWS credentials. IAM roles for Lambda; `aws sso` locally.
- Target domain: `paddlesnitch.com` — app at `paddlesnitch.com/att`, landing at `paddlesnitch.com/`

### Marketing campaign landings (`/?campaign=<id>`)

`src/lib/campaigns.ts` lists the ids (`CAMPAIGN_LANDINGS`); `src/app/page.tsx` maps each to a landing (`LANDINGS`) and optional title/description/share image (`CAMPAIGN_METADATA`). An unknown id falls back to the default landing and is logged (`[campaign] …`). **A known campaign is shown to signed-in visitors too** (people share these links; the dashboard only replaces the DEFAULT landing).

- **`betatesters`** — tracker beta-tester recruitment. The tracker video (`public/campaigns/betatesters.mp4`, 720p/24 fps/no audio, ~4.9 MB; poster `.jpg`) loops muted behind a one-card carousel of four messages (what it is → "This is what the snitch tells you" (GPS watch / stroke coach basics + pitch, roll, side-to-side evenness; a cropped boat-motion screenshot `public/campaigns/betatesters-what-you-get.png` → you paddle, weekly questions + up to 60 min interview, keep the tracker (£60 value) → fixed in place, case not waterproof, zip-lock bag on request) (`BetaSlides.tsx`: side arrows, dots, keyboard ←/→, swipe; all cards in the HTML, stacked in one grid cell so the frame and button never jump, inactive ones `invisible` + `inert`; swipes are caught on the whole card area incl. the phone arrows; on the last card a ↓ arrow and the button bounce, `motion-safe` only) and a **CLICK TO SNITCH** button that opens the application form in a one-column pop-up (`src/components/campaigns/BetaApplyModal.tsx`; closes on ✕/Escape/backdrop; form: name, email, sport, how often — no note, no tick boxes; submit is SIGN ME UP). Requirements stated on the page: they paddle/row regularly, and the tracker sits firmly in the boat (attached is best; it measures boat movement) and stays reasonably dry. `POST /api/beta-signup` (public; outside the proxy's mutation gate; `looksLikeBot` gated) stores `beta-signups/{sha256(email)}.json` — one record per email, a re-apply updates it — and emails a notification to `privacy@` (`BETA_NOTIFY_TO`), best effort. Covered by account delete + export (matched on the account email) and listed on the privacy page. List them: `aws s3 ls s3://paddlesnitch-data-prod/beta-signups/`. **Measured on the `paddlesnitch-app` dashboard** ("Campaigns: visits → button clicks → sign-ups"): a page view that arrived on a `?campaign=` link carries a `campaign` prop (`campaignFrom()` in `@paddlesnitch/ui/metrics-events`: lower-cased, plain ids only, unknown ids kept so a mistyped link shows up); CLICK TO SNITCH sends `campaign_cta`; a saved application emits `campaign_signup` server-side (`repeat` = someone updating theirs; bots never reach it). All are props on the one `Event` dimension, so no new per-value metrics. Client events only fire in production builds.

### Product analytics (CloudWatch EMF)

Custom product events flow to CloudWatch metrics via **Embedded Metric Format** — `emitMetric(event, props?)` in `src/lib/metrics.ts` writes one EMF JSON line; in the Lambda runtime CloudWatch auto-extracts a `Count` metric (namespace `Paddlesnitch/App`, dimension `Event`) with **no metric filters, no log parsing, no extra IAM**. Locally/in tests it's a harmless `console.log`.

- **Cardinality discipline:** the only metric dimension is `Event` (fixed allowlist in `METRIC_EVENTS`: `pageview`, `signup`, `login`, `upload`, `trial_create`, `course_create`, `campaign_cta`, `campaign_signup`). High-cardinality context (page `path`, session `sid`) is attached as a plain property — queryable in Logs Insights but does **not** create per-value metrics.
- **Server events** (`signup`, `login`, `upload`) are emitted directly in those routes and are **always on in production** — no flag — so they can't be spoofed and start flowing on first deploy. Cost is ~6 custom metrics (~pennies/month).
- **Client events (buffered + batched):** the capture lives in **`@paddlesnitch/ui/analytics`** (`capture(event, props?)`), and the root layout mounts the shared **`@paddlesnitch/ui/Analytics`** component (via the shim `@/components/Analytics`). `capture()` appends to an in-memory queue and **flushes a batch** to `POST /att/api/track` on whichever comes first: a timer (`flushIntervalMs`, 15 s), the queue hitting `maxBatch` (20), or the tab being hidden/closed (`visibilitychange→hidden` / `pagehide`, via `navigator.sendBeacon`). The `Analytics` component records a `pageview` (with `window.location.pathname`) on each route change. **On in production builds**, off in dev/test; `NEXT_PUBLIC_ANALYTICS=0` is the kill switch (tuning knobs on `_config`). No PII: only event, path, small string props, and a random per-tab `sid`. Vocabulary is a **strict allowlist** — the single source of truth is **`@paddlesnitch/ui/metrics-events`** (`METRIC_EVENTS`), re-exported by att's `src/lib/metrics.ts` (which keeps the server EMF `buildEmf`/`emitMetric`); enforced client-side (dropped before queueing) AND server-side. To add an event, add it to `METRIC_EVENTS`, then `capture('your_event')`. att keeps a re-export shim at `@/lib/analytics`.
- **Track endpoint (`POST /att/api/track`):** accepts a **batch** `{ sid, events: [{ event, t?, path?, props? }] }` (and a legacy single `{ event, path, sid }` for back-compat). Per allowlisted event it emits one EMF line via `emitMetric(event, props, timestamp)`, using the event's own capture time `t` (validated to CloudWatch's accepted window, else now) so a batch flushed later still lands in the right minute. Non-allowlisted events dropped; caps: ≤100 events/batch, ≤10 props/event, values truncated. Unauthenticated by design; always 204. **`src/proxy.ts` must exempt `/att/api/track`** (alongside `/att/api/feedback`) — the mutation-auth-gate would otherwise 307-redirect every signed-out beacon to `/signin`, dropping all anonymous traffic (regression covered in `proxy.test.ts`). Being public + unauthenticated, it guards against random/bot pings with an **Origin allowlist** (`isAllowedIngestOrigin`, `src/lib/ingest-origin.ts`): a ping whose Origin/Referer isn't one of our own origins is dropped (still 204, no signal). This is a cheap first line, **not integrity** — the header is spoofable; the strict event allowlist + per-request caps are what bound the actual damage (count-skew only, no arbitrary metrics). Rate-limiting/WAF or a signed nonce would be the next step if abuse appears.
- **Dashboard:** a CloudWatch dashboard `paddlesnitch-app` (defined in `infra/lib/att-stack.ts`) charts product events/day + period totals, **pageviews & key events per hour** (recent/sparse batched beacons show here where the daily view hides them), two **Logs Insights** tables over the server Lambda log group — **pageviews by path** ("what people look at") and **events-by-type + distinct sessions** — and server-Lambda invocations/errors/p95. The Logs Insights widgets reference the log group by name (`/aws/lambda/${serverFn.functionName}`) so no LogGroup resource is created/adopted. The `DashboardUrl` stack output links to it. EMF metrics populate once events fire; the Logs Insights widgets need log data in the selected range.
- **Not built yet (deliberate):** alarms and session heartbeats — add later if wanted.

### Payload sizing

API responses are **gzipped on the wire** (origin/Next; CloudFront only compresses cacheable responses, and the API behaviors are `CACHING_DISABLED`). The only fat payloads are the ones carrying per-point GPS arrays: the **analyse result** `points` (`POST /paddles/api/analyse`, tRPC `paddles.get`) and the ATT **`trackSegment`** (`GET /att/api/entries/[entryId]` + trial-page SSR). Leaderboard rows (splits only) and the sessions **list** (summaries, no points) are already tiny.

**A binary protocol is the wrong tool here** — measured on a real 856-point trace, a Float32 blob is *larger* after gzip (12.4 KB) than rounded JSON (10.2 KB), because full-precision float bits are ~incompressible while rounded decimals compress beautifully. The lever is **numeric precision, not encoding**: rounding at the source (`roundPoint` in `analysis.ts`; `round6` in `geo.ts`) + the existing gzip cut the analyse payload ~3× (31→10 KB) and trackSegment ~2.8× (12.5→4.5 KB), staying plain JSON (curl/devtools-inspectable, no codec, no schema). Reserve any binary/columnar work for a specific endpoint only if a future measurement proves it matters.

### Devices (hardware trackers)

A LilyGO T-Beam S3 Supreme uploads paddle sessions itself (no phone, no card copy). See [`device-uplink.md`](docs/features/device-uplink.md) (how the file arrives) + [`device-data.md`](docs/features/device-data.md) (what's in it).

- **Two auth paths, kept separate:** `getAuthUser()` (browser `tt_id` cookie) vs **`getDeviceAuth(req)`** (`Authorization: Bearer <deviceToken>`), both in `@paddlesnitch/core/auth`. Never merge them — a device token must not satisfy a human route, or vice versa.
- **Pairing (TV-style):** device `POST /api/devices/claim` → shows a 6-char code on its OLED; user enters it at `/account` → Devices (`POST /api/account/devices/link`); device polls `POST /api/devices/token` and collects a per-device token. Secrets + tokens stored only as `sha256`; claims single-use + 10-min TTL; `deviceId` (efuse-MAC hex) is **not** a secret. Manage/revoke via `GET`/`DELETE /api/account/devices`.
- **Claims are keyed by `deviceId`, not by code (2026-09-27).** `device-claims/{deviceId}.json` + a `device-claim-codes/{code}.json → {deviceId}` index. `redeemToken` used to `listKeys` every claim and read each one — on an endpoint the device polls **every 5 s for five minutes**, so onboarding got slower as anyone's claims accumulated. Now one direct read. **Consequence to remember: a device has only ONE outstanding claim, and a new claim supersedes the old one** — `createClaim` drops the superseded code's index, `linkClaim` re-checks `claim.claimCode === code` (a stale index must never bind a later claim), and redeeming deletes the index. No migration: claims live 10 minutes, so an in-flight one is simply lost at deploy.
- **Rate limits (2026-09-27):** `packages/core/src/rate-limit.ts` (fixed window in the object store, `rate/` prefix, 1-day lifecycle rule), numbers in `apps/web/src/lib/device-limits.ts` — `/claim` 20/hour per device + 30/hour per IP, `/token` **1000/hour per device**, `/api/account/devices/link` 20/hour per user. **The device numbers are measured, not chosen:** `uplinkClaim()` polls on `delay(5000)` for `timeoutMs` (default 300000), so one claim round is ~60 requests, and the uplink task starts the next round as soon as one times out — a tracker left on its code screen makes ~12 claims and ~720 polls an hour. The earlier 10 and 300 cut such a tracker off after ~25 minutes (security audit 2026-09). **A tracker already on an account can't be added to another** (`owned_elsewhere`) until its owner removes it, and redeeming a claim deletes the tracker's previous token. Validation runs **before** the limiter so a malformed id cannot spend a real device's allowance; a bad id on `/token` still answers `202 pending` (that endpoint never reveals whether a device exists). **The limiter fails OPEN and is not atomic** — a speed bump for cost and storage, not a WAF, and not a brute-force defence (the secret is 32 random bytes).
- **Upload:** `POST /api/devices/sessions?filename=…` (device Bearer), raw CSV (≤4 MB), idempotent by `deviceId`+`filename`. **In practice every upload arrives chunked** (`&part=N&parts=M`) — see Upload transport below; a single-shot PUT still works and is what the tests exercise for small files. **Reuses `parseTrace()` UNCHANGED** — the firmware conforms to the existing CSV columns, so the device's `lat`/`lon`/`timestamp` need **no** device-specific parser. Column names are therefore **load-bearing**; unfixed rows write empty `lat`/`lon` (never `0,0` — see Null Island in the spec) and yield `422` (a bench log, not an error).
- **As a paddle source:** every accepted recording where the boat moved ≥ 500 m **becomes a paddle by itself** (one-paddle.md phase 2: `paddleForRecording` after the upload response, from both the WiFi and Bluetooth routes; re-analysed once when its motion file lands, gaining stroke rate; fixed paddle id `t-<recordingId>` so racing jobs can't make two). The **TRACKER** tab of ADD A PADDLE (tRPC `sources.devices`; `source.type: 'device'`) still exists and finds the same paddle. A tracker paddle's boat motion is its **BOAT MOTION** side page `/paddles/[id]/motion` (phase 3); `/devices/[deviceId]` links recordings to their paddles (`paddles.byRecording`) and `/devices/[deviceId]/[sessionId]` redirects to the paddle's motion page when there is one. **The same outing from two sources** (tracker + Strava) stays two paddles: `paddles.sameOuting` finds the other when a paddle opens (≥ 50% time overlap, then ≥ 70% of same-clock positions within 40 m), the paddle shows ALSO RECORDED BY …, and `/paddles/compare` adds a SAME OUTING section (both tracks, how far apart, stroke rate from each).
- **Tracker pages speak to paddlers:** each recording opens to time, distance, speed, stroke rate and boat motion in plain words (`src/lib/tracker-copy.ts`: `strokeRateCopy`, `gpsCopy`, `noMotionCopy`, tested); the engineering diagnostics below (reasons, evidence, HDOP, dps, columns, raw rows) sit under a **TECHNICAL DETAILS** toggle, never on top.
- **Diagnostics:** `describeDeviceData(csv)` (`@paddlesnitch/timing/device`) reports every column, fix/no-fix counts, **movement-gated** distance (anchor-based ≥3 m at ≥1.5 km/h — never a raw fix sum; GNSS scatter otherwise invents ~115 m). `movementDistanceM(points)` (same module) is the ONE implementation: the upload route stores it as `DeviceSessionMeta.distanceMetres` too (it stored a raw sum until 2026-09 — ~1.3 km for ten minutes on a jetty; `scripts/backfill-device-distance.ts [--apply]` rewrites old records, dry run by default), and an **honest stroke-rate verdict**. **MY DEVICES** (`/profile/me/devices`) surfaces all of it. **Stroke rate is NOT derivable from firmware 0.3.0** (*solved since — see the next bullet; kept because the verdict logic still has to handle old captures*) — it logs a per-second accel *peak* at 1 Hz, which can't yield a 0.5–2 Hz cadence; the fix is device-side cadence emitting a `strokerate` column (already handled by `parseCsv`, so no server change). Do not fake it from `accel_mag_max_g`.
- **Session diagnostics (2026-09-13):** the report also carries `capture`, `gnss`, `motion` and `deadColumns` — all derived from columns firmware 0.3.0 **already writes**, so no firmware change was needed. `capture` measures dropped rows against the interval **observed in the file** (median delta, never a hardcoded 1 Hz). `gnss` carries sats/HDOP first→last plus a `fixTrend` and `altitudeSpreadM` (GPS altitude wandered 27.8 m on flat water in a real session — still unusable). `motion` splits the IMU peaks by moving vs stationary and reports **`gyroPeakP99Moving`** alongside the max: the bare max is hostage to the landing second, where the GPS still reads ~3 km/h while the device is being handled (241 dps vs a true 24.8 dps paddling envelope). `deadColumns` flags all-empty/all-zero columns but **never a constant non-zero one** (`fix=1` all session is good news). `strokeRate.evidence` renders the measured numbers so the verdict stops being an assertion. **`batt_mv` reading 0 is correct with no cell fitted** (`boardBatteryMv()` returns 0 when `isBatteryConnect()` is false) — the UI says "nothing was recorded here", not "this is broken". Validated end-to-end against a real 60-min, 3,627-row paddle.
- **Stroke rate: SOLVED (2026-09-13).** The 50 Hz motion sidecar is **decimated to 10 Hz on-device and uploaded**; cadence is derived server-side by **`deriveCadence`** (`@paddlesnitch/timing/cadence`). Highest-variance gyro axis (orientation-agnostic) → autocorrelation → best **local** maximum (the global max in a band returns the band EDGE on broadband content — an early version reported exactly 2.5 Hz for every stationary window) → parabolic sub-sample. Windows must sit **wholly inside a moving stretch** (sessions open parked at the launch, and stationary windows invent a periodicity). Alternating L/R strokes mirror, so stroke rate = **2× cycle rate**, detected from the **ratio** of half-lag to peak correlation (−0.85 threshold), never an absolute floor — a single-sided pulse train also correlates −0.67 at half-period, so an absolute test doubles everything. **10 Hz is measured, not chosen:** −0.5% error vs the full 50 Hz, against −12.8% at 5 Hz (lag quantisation, not lost signal) — don't lower it without re-running the sweep in `device-data.md`. Real result: **58.0 spm** over 22 windows. Calibration debt: the single-sided case is synthetic; confirm against a real canoe/SUP recording. **Through the paddle (2026-10-06):** `strokeRateSeries` (15 s windows every 5 s, left/right decided once per paddle by majority, alternating only) + `withStrokeRate` put stroke rate on each track point of a tracker paddle in `loadDeviceSessionTrack`, so efforts, splits, distance per stroke and the map get it from the existing engine; tracker paddles are never auto-doubled for kayak classes. Measurements in `device-data.md`; backfill `scripts/backfill-tracker-stroke-rate.ts [--apply]`.
- **Boat attitude (2026-09-13):** **`deriveAttitude`** (`@paddlesnitch/timing/attitude`) reports roll/pitch rms, roll range, and **rock evenness** from the same sidecar — the spec's Phase 2. Serves both disciplines deliberately: **rowing wants `rollRmsDeg` near zero**; **kayaking wants `symmetry.imbalancePct` near zero** and a large roll is NOT a fault. Mounting is learned, never assumed: "down" comes from the session's own mean gravity and the roll axis from **PCA over the tilt**, so a tracker in a pocket reads the same as a deck mount. **Accel alone is not enough** — stroke surge reads as tilt and inflates roll ~40% (5.6° accel-only vs 4.0° fused on the same stretch), so accel+gyro are fused with a complementary filter (τ=2 s, well below the ~0.5 Hz rocking). Two things it deliberately will NOT claim: **which side is port/starboard** (no magnetometer → no heading; it says side A/side B), and **a constant lean** (indistinguishable from a device mounted a few degrees off — symmetry is measured about the session's own neutral). `axisConfident:false` when roll and pitch are too alike to separate. Real result: roll rms **4.0°**, pitch **1.9°**, 2.1:1, **13.5% imbalance** — and identical at the uploaded 10 Hz.
- **Setup guide (`/guide`, 2026-09-28):** public, one page per step for beta testers (account → switch on → WiFi → add to account → fix in the boat → record → upload) plus `/guide/troubleshooting` (linkable `#wifi`, `#code`, …). The step order + BACK/NEXT come from `GUIDE_STEPS` in `src/lib/guide.ts` (the account comes FIRST: the tracker's code rotates about every 5 minutes, so an account made mid-link misses it). **Tracker screens are drawn, not photographed**: `src/lib/tracker-screens.ts` copies each screen's positions + fonts from the firmware, marks example values `‹like this›`, and `tracker-screens.test.ts` requires every other piece of text to exist in `firmware/src`/`include` — change on-screen wording in the firmware and that test tells you which guide drawing to update. `/devices` shows a **Getting started** checklist (`setupProgress()`: account ✓ → tracker added → first recording) linking into the guide until a recording has arrived. Anything the guide says about the tracker must match the firmware as shipped; the facts it was written from (and the doc claims found stale) are in the #301 PR description.
- **DEVICES (`/devices`, 2026-09-28; was `/profile/me/devices`):** the tracker pages are **device-first** and sign-in gated. `/devices` is one card per tracker plus the **Add a tracker** code box (`components/devices/AddTrackerForm.tsx`; it used to be a section of the account page, and each page sent you to the other). **Remove** is on the tracker's own page (`RemoveTrackerButton`, asks first; recordings stay the user's). The menu shows DEVICES to everyone — it used to be hidden until you owned a tracker, which hid the only place to add one. The tracker QR `/L/<code>` is served by the `/l/<code>` handler via an internal **rewrite in `src/proxy.ts`** (a next.config rule matched case-INsensitively and looped `/l/` onto itself; it only worked in prod by a quirk of the hosting router) and lands on `/devices?code=…#add`, prefilled after mount (a lazy `useState` read of `window` caused a hydration mismatch on every QR arrival). Old URLs: `/profile/me/devices` and `/profile/me/devices/d/:id` 308 to `/devices`, `/devices/:id`; the old recording URL is a tiny page that looks up the tracker. `/devices` is one card per tracker (name, model, firmware, last seen, session count, total distance, newest session) — it used to be a flat list of every upload with a raw hex `deviceId` on each row, which stops being readable past one device. One level down, **`/devices/[deviceId]`** is that tracker's recordings with the expandable per-recording diagnostics, and **`/devices/[deviceId]/[sessionId]`** the motion charts. **A revoked tracker keeps its card**, flagged `not linked` — `revokeDevice` deletes the device record but not its sessions, so dropping it would hide data the user still owns. The grouping rule is pure and tested (`apps/web/src/lib/device-view.ts` → `deviceSummaries`). `GET /api/account/devices` now **projects an explicit field set** rather than returning `DeviceRecord` whole: `tokenHash` (sha256 of the device bearer token) was being shipped to the browser, where it authenticates nothing.
- **Per-recording page + charts (2026-09-13):** **`/devices/[deviceId]/[sessionId]`** plots the motion. The data comes from the already owner-filtered session list, so a deviceId in the URL exposes nothing. Three hand-drawn SVG charts (no chart dependency; colours are design tokens as CSS vars **with literal fallbacks**, since SVG presentation attributes can't take Tailwind's semantic classes): a **min/max band** per bucket through the session (NOT a sampled line — the rocking is ~0.5 Hz, so chart-sized decimation draws a waveform that never happened), a **full-rate 30 s excerpt** taken from the most *representative* window (roll rms closest to the session's — the middle can land on a turn), and the **roll distribution with its own mirror overlaid**, which is where left/right unevenness becomes visible. `deriveAttitude` returns `envelope`/`excerpt`/`rollHistogram`/`plotBoundDeg` for these (~31 KB for a 19-min session). **Both scales are robust, and that was forced by real data:** the reference session has a single **20.3° lurch** against a ~6° working range, which on raw min/max squeezed the whole histogram into a third of the axis — so bins span **p1–p99** (outliers land in the end bins, counts still total every sample) and the envelope **clamps with a caption** rather than dropping. Don't "simplify" either back to raw extremes.
- **Reference capture:** every figure above was measured against `~/Documents/paddlesnitch-tracker-capture-2026-09-13/` (1 Hz track + 50 Hz sidecar, ~65 min, pulled over serial `CAT` so it carries `<<<CAT …>>>` markers that all parsers skip). Synthetic fixtures missed failure modes this file caught — re-run against it before changing `cadence.ts` or `attitude.ts`. Its README records what it measured; the earlier pre-0.4.x card copy (no sidecars) is in `…-card-backup-2026-09-11/`.
- **Upload transport — EVERYTHING is chunked:** `POST /api/devices/sessions?filename=X&part=N&parts=M[&sha256=hex]`. Chunking is **pure transport**: `storeUploadPart` stages parts by **filename** (a track has no session until it is assembled and parsed), and once the last part lands the assembled buffer falls through to exactly the handling a single-shot upload gets — `parseTrace` for a track, `storeDeviceMotion` for a sidecar. 202 per part, 201 on assembly. Assembly checks **every index is present** rather than assuming ordered delivery (a retried part can arrive after the last), returns 409 with the missing list, and only deletes the staged parts **after** the assembled object is written. Parts are **idempotent by index**, so a reboot mid-sync resumes. `sha256` is verified over the assembled whole — concatenating from pieces creates a silent-corruption path a single PUT never had. A part may be **zlib-compressed** (`&enc=zlib`, body sent as `application/octet-stream` because a Lambda function URL passes `text/*` bodies through as strings): the route unpacks it on arrival (size limit applies to the unpacked bytes) and stores it like any other part, so assembly and the sha256 over the uncompressed file are unchanged. Chunk size is **64 KB**, and a sidecar whose track is missing 409s on the **last** part (the track check happens at assembly). **Why not S3 multipart:** S3 objects are immutable (no append) and multipart requires every part but the last to be ≥5 MB — larger than these whole files. **Why chunk at all:** the device cannot read a large file off its own card in one go while HTTP is in flight; `SDPROBE` proves the same card streams 2.38 MB at 430 KB/s with the radio off *and* associated, so it is neither the card nor WiFi. Verified end to end: a 696 KB track in 11 parts + a 2.38 MB sidecar in 37, byte-exact in S3, zero orphaned parts. `MAX_BYTES` is 4 MB (a Lambda function URL caps near 6 MB — raisable, not removable). The full 50 Hz file stays on the card and is never uploaded or auto-deleted.
- **Debugging the device — read this before theorising:** four faults stacked here and each hid the next, and five confident diagnoses were wrong before instrumentation found the truth in minutes. Things that are NOT the problem, each disproved with evidence: the battery (`batt_mv` reads ~4070 when one is fitted), warm resets, a wedged IMU corrupting the bus, the card itself, and WiFi association. Two traps in particular: **`n=0` in the status line during a sync is deliberate** — `loop()` runs `if (!uplinkSdBusy()) imuPoll();`, so polling is paused while the card is busy, and it does not mean the IMU is dead. And **`Display [ok]` in the bring-up banner is not evidence the screen works** — it records whether the panel acked at init, several rail power-cycles before anything is drawn. Use `SDPROBE <file>` (reads a file end to end with the radio off, then associated) rather than inferring from upload failures.
- **Screen map + error catalogue:** [`device-screen-map.md`](docs/features/device-screen-map.md) — every screen, how you reach it, and **where a customer gets stuck**. Mermaid diagrams (render on GitHub, no tooling). Read the "Gaps" section before adding device UI; the top entry is a real regression (a permanently-rejected upload is retried every sync forever, because `uploadChunked` lost the permanent-vs-transient distinction `uploadOne` had).
- **OTA + device auth:** [`device-ota-and-auth.md`](docs/features/device-ota-and-auth.md) — Phase 0 (repartition) **shipped** #256; Phases 1, 2 and 4 (manifest + presigned URL + the signal, observability, release workflow) **shipped 2026-09-19** — see the OTA bullet below; Phase 3 (firmware) **built 2026-09-27 but NOT verified on hardware** — `firmware/src/ota.{h,cpp}` + a host-tested `ota_policy.{h,cpp}`; no device has ever taken an update. **A partition table cannot be changed over the air**, so every new device needs the two-slot table flashed by cable before use or it is cable-only for life.
- **OTA — live end to end.** Server (Phases 1, 2, 4, 2026-09-19) and firmware (Phase 3, 2026-09-27) of [`device-ota-and-auth.md`](docs/features/device-ota-and-auth.md) are built, and a tracker has updated itself over the air (0.12.0 → 0.14.0, 2026-09-28). **The app-level rollback has worked on hardware** (2026-09-28: paddle02 was sent back to 0.14.0, which could not start its new-batch screen, and restored 0.15.0 by itself). Shape:
  - **MERGING RELEASES (changed 2026-09-27).** **Every push to `main` promotes the latest firmware (`firmware/VERSION`) to stable**, so devices take it on their next sync; a push that touches `firmware/` also builds + publishes it to `firmware/<version>/` first (a failed build does not promote). Every push, not only `firmware/**` ones, because a missed promote otherwise stays missed: 0.14.0 sat unpromoted after #276 fixed the workflow without touching `firmware/`. The one exception: a merge never re-promotes a build **older than a manual promotion** (it would silently undo a rollback) — bump VERSION to supersede. Decision logic: `.github/scripts/firmware-promote-decision.sh` (tested by the sibling `.test.sh`, which the workflow runs). `workflow_dispatch` promotes any already-built version and is **the rollback lever**. Both paths share one promote job so the rollback cannot drift from the thing that releases. Publishing still **refuses to overwrite** an existing version, promoting still **verifies the image exists**, and the build still **fails if `firmware/src` changed without `firmware/VERSION`**. It used to need a separate manual promote; the gate was in the wrong place for this repo, where firmware is flashed and tested by cable **before** the PR is merged — so by merge time the release decision is already made with a device in hand. A second confirmation of a settled decision is ceremony, and 0.13.0 sat published-but-invisible proving it. **Consequence: the app-level rollback is now load-bearing, not a backstop** — three failed boots and the device restores the old image; that has now happened on a real tracker (paddle02, 2026-09-28). No `environment:` gate on promote, deliberately: it would prompt on every merge. If devices ever ship to people who cannot reach them with a cable, put it on the auto path — never on the manual one, which must stay fast. **Staged rollout is not built**, but the channel mechanism already supports it (the server reads `firmware/channels/<channel>.json` and the workflow can write `beta`).
  - **Signal, don't probe.** `X-PS-Firmware: <version>` is stamped on **every** device-authenticated response by `withDeviceAuth` (`apps/web/src/lib/device-route.ts`) — errors, the 401, and each of ~48 chunk responses included. The upload route returns from fourteen places, which is why this is a wrapper and not fourteen remembered headers. A device in the steady state makes **no** firmware request at all. **An absent header means "no opinion", not "you are current".**
  - **`getChannelVersion` is cached in-process for 60 s** because that header makes it the hottest read in the system; `promoteFirmware` drops the cache so a rollback isn't delayed.
  - Routes: `GET /api/devices/firmware?current=` (304/404 `no_channel`/200 + a **15-minute presigned URL**, generated per request), `POST /api/devices/firmware/ack` (idempotent on deviceId+version; a rollback is never a successful boot), and `GET /api/admin/devices/:deviceId/firmware-events` (**human** admin only, writes an audit line before the read).
  - **Local dev has no S3**, so `presignGetUrl` returns a same-origin HMAC-signed URL served by `/api/devices/firmware/download` — same contract (no credentials, one object, expires), and that route refuses to run outside dev and refuses any key that isn't a firmware image.
  - **Metrics: `Paddlesnitch/Firmware`, dimensions `Version` + `Model` ONLY, never `deviceId`** (`apps/web/src/lib/firmware-metrics.ts`, deliberately separate from the product-analytics EMF in `@/lib/metrics`). Per-device detail lives in `firmware-events/` records with a **90-day bucket lifecycle rule**. Dashboard `paddlesnitch-firmware` in the CDK.
  - **`firmware/VERSION` is the single source of truth** (read the file; never quote the number in docs), read by `firmware/scripts/version.py` (a PlatformIO `pre:` script on `[hw]`) and by the workflow, which **fails the build if `firmware/src/**` changed and VERSION didn't**. The old `-DFIRMWARE_VERSION` literal in `platformio.ini` is gone — it had sat at 0.9.0 across several behaviour changes, which the server would read as "already current". **`firmware/NOTES`** is the one-line note the tracker shows after it updates, written for paddlers and checked to fit the screen (`.github/scripts/firmware-notes.sh`); the release fails if VERSION moved without it. It was the last commit's subject until a merge commit put "Merge pull request #295…" on trackers. Each published version is also **tagged `fw/v<VERSION>`** on the built commit (message = the note); the scheme `<component>/v<semver>` lives in `.github/scripts/release-tag.sh` so `ios/`, `android/` and `web/` can follow.
  - **Outstanding risk** (promotion is automatic now, so this is not a gate): `firmware/` writes are not scoped to a release role — the workflow reuses the deploy role, so anything that can deploy can also release. Prerequisites 1–2 (claims keyed by `deviceId`; rate limits) are done, and the app-level **rollback has been seen on hardware** (2026-09-28: paddle02 took an older build it couldn't start its screen on and restored the previous one by itself).
- **Fleet visibility (2026-09-27):** `touchDevice()` (`@paddlesnitch/core/devices`) refreshes `DeviceRecord.firmware`, `.model` and `.lastSeenAt` from the `X-Device-Firmware` / `X-Device-Model` headers on **every** authenticated device request, called once in `withDeviceAuth`. Before this both fields were written at claim time and **never updated**, so a device's stored version was whatever it wore the day it was paired and "last seen" was frozen at pairing — both plausible-looking and both wrong. Rate-limited to one write a minute (a 2.4 MB sidecar is ~37 requests back-to-back) and it never throws. `GET /api/account/devices` also returns `stableVersion`, so MY DEVICES can say **up to date** / **update pending** rather than printing a number nobody can calibrate, plus a real "seen 3m ago" that turns red past two days. **`deviceId` is a log PROPERTY, never a CloudWatch dimension.** A dimension mints a billable time series per value; a property is queryable in Logs Insights and costs nothing per value — the same discipline `path`/`sid` follow for product analytics. That is what lets the dashboard answer the fleet questions without the bill growing with the fleet.
- **Fleet heartbeat — `DeviceSeen` (2026-09-27):** emitted from `withDeviceAuth` whenever `touchDevice()` actually writes, so its one-write-per-minute limit bounds the log volume too. Dimensions `Version` + `Model`; `deviceId` as a property. **Deliberately not built on the firmware-check metrics:** OTA is signal-not-poll, so a device that is up to date *and* has uploads never calls `/api/devices/firmware` at all — a fleet count built on those would systematically miss the healthiest devices. Three Logs Insights widgets on `paddlesnitch-firmware` answer the actual questions: devices seen in range, `count_distinct(deviceId) by Version, Model`, and a per-device roll call with `latest(@timestamp)` so the silent ones sort to the bottom.
- **Platform admin (new, 2026-09-19):** `isPlatformAdmin` (`apps/web/src/lib/admin.ts`) — an allowlist of Cognito `sub`s in the **`ADMIN_USER_IDS`** env var, baked into the Lambda at CDK synth and passed through `deploy.yml` from a repository *variable*. This is "may read cross-account operational data", NOT group owner/admin (`src/lib/permissions.ts`), which is about one club's courses. **Unset means nobody** — a missing config must not open a door. No route can grant it, so escalation needs a deploy. Admin API routes are deliberately **not** in `proxy.ts`: they are meant to be curled, and 401/403 JSON beats a 307 to a sign-in page.
- **Bluetooth (P4 of [`tracker-bluetooth-sync.md`](docs/features/tracker-bluetooth-sync.md), step 1, 2026-10-04):** firmware Bluetooth is compiled with `-DBLE_ENABLED=1`. **From 0.18.0 the release build `tracker` has it too, but it is OFF until turned on** (NVS `ble/on`, default `BLE_DEFAULT_ON`, which only `tracker-bench` sets to 1): Settings > Network, tap to the Bluetooth page, hold to turn on; turning it off saves and restarts, and is refused while recording. The tracker advertises the paddlesnitch service as `PT-<last 3 of id>` and serves an About record (`firmware/include/ble_about.h`, host-tested). The web side is `/devices/bluetooth`, linked from `/devices` (a BLUETOOTH box) and each tracker's page, explained in guide step 8 `/guide/bluetooth` (+ `/guide/troubleshooting#bluetooth`; screen drawings `bluetoothOff`/`bluetoothOn`/`pair`). Chrome/Edge only (no iPhone): connect and read About; the ids live in `apps/web/src/lib/tracker-ble.ts` and a test checks they match the header. Known: with Bluetooth on, turning WiFi off logs `wifi:timeout when WiFi un-init` and takes ~3 s; WiFi reconnects fine. **Step 2 (pairing, 2026-10-04):** number comparison, the tracker shows the 6 digits + a countdown, hold = yes (25 s, under Bluetooth's 30 s limit); a `Paired` item readable only when paired is what starts pairing; verified on a Mac and an Android phone. The page retries that read for ~30 s with a 3 s limit per try (Android Chrome refuses the first read, and a read can hang), and trims a trailing NUL (a C-string terminator once made a paired phone show "unexpected reply"). The tracker keeps advertising while connected (a Mac tab left connected had hidden it from the phone). **Setup over Bluetooth (2026-10-05, not yet tested paired):** `POST /api/account/devices/link-bluetooth` links from `{deviceId, tokenHash}` -- the tracker makes its own token and only the hash leaves it (`linkByTokenHash`: owned_elsewhere, same rate limit, and **token_in_use** so a known hash can't redirect another tracker's uploads); the WIFI item makes the uplink task try a network for 15 s and save it only if it joins (verified: missing network → not_found, wrong password → wrong_password, saved WiFi unchanged). macOS keeps a pairing after the tracker forgets it ("Peer removed pairing information"): remove PT-xxx in System Settings → Bluetooth; `blueutil --unpair` can't remove BLE pairings on this macOS. **WiFi over Bluetooth verified on Android (2026-10-05)** after "forget": Android had cached the pre-setup item list, so firmware now sends Service Changed when its `BLE_LAYOUT` string changes (bump it with any item change) and the page says "forget PT-xxx and pair again" on a NotFoundError. **Recordings over Bluetooth (2026-10-05, not yet tested paired):** `POST /api/account/devices/[deviceId]/sessions` (owner only, 404 otherwise) shares the tracker's upload handling (`lib/session-upload.ts`, used by both routes) and answers 201 / 409 already_uploaded with a **receipt** = HMAC-SHA256(key = stored hex sha256 of the tracker's token, `ps-receipt:v1|id|uploadName`) (`uploadReceipt` in core). Tracker items SYNC (list / piece / done) + DATA (pages of `[u32 offset LE][≤500 B]`, seekable); all card/compress/receipt work runs on the uplink task; a recording is marked sent only on a valid receipt. The sequence is `syncOverBluetooth` in `lib/tracker-ble.ts`, tested against a fake tracker.
- **Crash reports + heartbeat (0.18.0 firmware, server #358):** after a panic/watchdog reset the tracker keeps an ESP-IDF coredump in flash, reads its summary at boot (`firmware/src/health.cpp`, JSON built by host-tested `include/health_report.h`) and POSTs it to **`POST /api/devices/health`** on its next WiFi sync, then erases it; an hourly heartbeat (uptime, min heap, battery, stack headroom) follows. Server: `sanitizeHealth`/`storeDeviceHealth` in core keep `devices/{id}/health/latest.json` + the last 20 `crashes/`; /devices shows a red "crashed …" note for 7 days; `DeviceCrash` metric (Version+Model, deviceId a property) + alarm. Decode a backtrace with `firmware/tools/decode-crash.sh <version> <addr…>` (the release workflow uploads `firmware.elf`). Verified end to end with the bench `CRASH` command 2026-10-05.
- **Deferred:** attaching a device session to a trial submission; **device token expiry + rotation** (OTA prerequisite 3, the next one — tokens currently never expire, so one leaked from plaintext NVS is valid until revoked by hand).

### Cost Model (Production, Low Scale)

< 1000 entries/month:
- S3 storage + requests: < $1/month
- CloudFront: free tier / cents
- Lambda: free tier covers ~1M invocations
- Cognito: free up to 50,000 MAU

**Cost attribution — the `project=paddlesnitch` tag.** The AWS account is shared with unrelated projects, so paddlesnitch spend is isolated by tag, not by account. `infra/bin/att.ts` applies `cdk.Tags.of(app).add('project', 'paddlesnitch')` at the app root, which reaches every taggable resource in the stack (Lambdas, buckets, CloudFront, Cognito pool, IAM roles, dashboards). Tag changes are in-place updates (including the Cognito pool's `UserPoolTags` — no replacement). Not covered by CDK, tagged once by hand: Lambda-created log groups (`/aws/lambda/AttStack-*`, `/aws/lambda/att-*`) and the imported `paddlesnitch.com` hosted zone. `project` must be **activated** once as a cost allocation tag (Billing → Cost allocation tags) before Cost Explorer can group by it. Tag-blind charges: SES sending, on-demand Bedrock invocations (would need an application inference profile), tax, and the shared CDK bootstrap bucket.

Migration path to add a database: replace S3 JSON reads with DynamoDB; processing Lambda writes to both S3 (raw) and DynamoDB (indexed). Leaderboard becomes a DynamoDB query instead of reading `leaderboard.json`.
