# paddlesnitch — paddling platform

A monorepo for **paddlesnitch**, a web platform for paddlers (kayak, canoe, SUP, rowing): **one Next.js app** (`apps/web`) over six internal packages, one Cognito user pool, one S3 bucket, one CloudFront distribution, plus the tracker firmware (`firmware/`). Three sections, one header:

- **Trials** (URL `/att`, historically "ATT — Automated Time Trials"): GPS-timed river time trials. Organisers draw start/finish lines on a map; paddlers upload GPS files; the site computes elapsed time, 500 m splits and stroke rate.
- **Paddles** (`/paddles`, formerly `/analyse`): paddle analysis with an AI-written summary. `/paddles` is also the signed-in home.
- **Devices** (`/devices`): the paddlesnitch tracker — add, see and remove trackers and their recordings. Plus **Profile** (`/profile/…`) and **Account** (`/account`).

Area detail lives next to the code, in nested `CLAUDE.md` files that load when a session works in that folder (the index is under **Where things are documented**). This root file holds only what every session needs: how to work here, the monorepo map, shared conventions and the writing rules. Each file is the source of truth for *current* behaviour in its area.

## Working with Claude

After completing any task that changes behaviour, adds a feature, or introduces a new convention: update the `CLAUDE.md` that covers that area (this root file only for rules every session needs) and the memory files in `~/.claude/projects/…/memory/` to reflect the new state. Do not wait to be asked. Keep this root file short: area detail goes in the area's file, not here.

### Agent roles

Sessions run in roles: `lead` (the default contact; routes work and runs the
reviewers), `help` (explains this setup), builders `android`, `ios`,
`firmware`, `motion-core`, `game`, and reviewers `tester`, `security-privacy`,
`design-usability`, `copy-style`. Briefs are in `.claude/agents/`; who owns
what, how to start a window (`psa <role>`), worktrees and ports are in
[`docs/agents.md`](docs/agents.md). Stay in your area, write lessons into your
area's `CLAUDE.md`, and keep `docs/agents.md` in step with `.claude/agents/`
(`pnpm test:agents` checks it).

### The backlog (GitHub issues)

The to-do list is **GitHub issues labelled `backlog`** (`gh issue list --label backlog`). It exists so there is always something worth doing when the owner leaves Claude working (overnight, during the day). Labels:

- **`unattended-ok`**: Claude may do it alone and merge it: reversible, provable with a test, no owner decision. **`p1`** first, then oldest.
- **`needs-decision`**: the owner chooses first. Write up the options and a recommendation on the issue; don't build it.
- **`owner-task`**: needs the owner or hardware (testing on the water, merging firmware, admin settings). Remind, don't do.
- **`firmware`**: PRs wait for the owner's merge (a merge releases to every tracker).

**Working it** ("work the backlog"): take `unattended-ok` issues in order; for each, prove the problem (a failing test or a measurement), fix, test, open a PR that says `Closes #n`, merge when the PR checks pass. Comment on the issue as you go: the issues are the report. When the list runs dry, propose new issues rather than inventing work. **Filing:** each issue says what's wrong and how we know, how to prove it's fixed, and what done looks like. **The repo is public:** no personal data in issues (no emails, account ids, training details, tracker serials). **Never use `claude-go` / `claude-active`** for backlog work: they start the CI Claude workflows on the same item.

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

### Where things are documented

Claude Code loads this file in every session, and a nested `CLAUDE.md` when the session reads or edits files in its folder. Put a rule where the sessions that need it will load it.

| File | Covers |
|---|---|
| [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) | The site: routes, sign-in and sessions, Trials (courses, trials, entries, groups, profiles, Terms, permissions), Paddles, local dev and seed data, testing (vitest + Playwright), analytics, performance, jobs, telemetry, payload sizes, campaigns, maps, and the tracker-server rules |
| [`packages/core/CLAUDE.md`](packages/core/CLAUDE.md) | Platform primitives (storage, auth, Cognito, Strava, types) and buddies (`canViewPaddle`) |
| [`packages/timing/CLAUDE.md`](packages/timing/CLAUDE.md) | GPS files and parsers, line crossing and splits, tracker data diagnostics, stroke rate, boat attitude |
| [`packages/analysis/CLAUDE.md`](packages/analysis/CLAUDE.md) | Rules for the Paddles domain package (engine, store, summary); the rest is in `apps/web` |
| [`packages/api/CLAUDE.md`](packages/api/CLAUDE.md) | Rules for the tRPC router (mobile contract, projections, telemetry) |
| [`packages/ui/CLAUDE.md`](packages/ui/CLAUDE.md) | The shared shell, header, account menu, feedback widget, analytics pump |
| [`packages/waterways/CLAUDE.md`](packages/waterways/CLAUDE.md) | The river planner: network, routing, sources, national build, refresh, coverage, tides, live levels |
| [`infra/CLAUDE.md`](infra/CLAUDE.md) | Production architecture, deploys, SSM secrets, inbound email, costs and tagging |
| [`.github/CLAUDE.md`](.github/CLAUDE.md) | The customer-issue automation (intake, fast loop, clean-up) |
| [`firmware/CLAUDE.md`](firmware/CLAUDE.md) | The tracker firmware |
| [`games/CLAUDE.md`](games/CLAUDE.md) | The browser games, and how the site serves them |
| `mobile/android/CLAUDE.md`, `mobile/ios/CLAUDE.md` | Lessons for the native apps |
| [`docs/features/README.md`](docs/features/README.md) | Index of feature design records and their status |
| [`docs/features/devices-platform.md`](docs/features/devices-platform.md) | Full reference for trackers on the platform (pairing, uploads, OTA, Bluetooth, fleet, crash reports) |
| [`docs/agents.md`](docs/agents.md) | Agent roles, who owns what, worktrees and ports |

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
  waterways/  @paddlesnitch/waterways — river planner domain: OSM waterway network + routing (UK, Ireland, the Netherlands, Belgium, France and Germany: one dataset), locks/facilities from CRT/EA, places search, coverage (docs/features/river-planner.md, waterways-uk-ireland.md)
firmware/     LilyGO T-Beam S3 Supreme tracker firmware — C/C++, built with PlatformIO, NOT pnpm
mobile/       native apps, NOT pnpm: contract/ (shared schema, fixtures, tokens), ios/ (Swift, Xcode — `make test`; see mobile/ios/README.md)
games/        browser games served at /games (plain HTML/JS, no build) — NOT pnpm; see games/CLAUDE.md
```

**`firmware/` is not a workspace package.** It's the hardware tracker's PlatformIO project (`pio run -e tracker|receiver|displayprobe`), deliberately outside the `apps/*`/`packages/*` globs — it has no `package.json`, `pnpm install`/`pnpm test`/`pnpm build` do not touch it, and its `.pio/` build output (~750 MB) is gitignored. Its contract with the platform lives in [`docs/features/device-uplink.md`](docs/features/device-uplink.md) + [`device-data.md`](docs/features/device-data.md) (see `docs/features/devices-platform.md`); keep firmware and those specs in step. `firmware/CLAUDE.md` covers the firmware itself, and `firmware/docs/` holds its
specs — `device-states-spec.md` (screens, the one-meaning-per-gesture contract,
and the bench acceptance walk-through) and `motion-capture-spec.md`.

One Cognito user pool, one S3 bucket, one CloudFront distribution, **one server Lambda** (`ServerFn`) serving everything. Locally it's **one port** — `pnpm dev` → :3000 serves everything (`/`, `/att`, `/paddles`, `/devices`, `/account`, `/profile`, `/api/trpc`).

**API: tRPC.** JSON endpoints are typed tRPC procedures in `@paddlesnitch/api`, mounted at `/api/trpc`. SSR calls the router in-process via `createCaller`; the browser (and, later, the native mobile apps — see [`mobile-apps.md`](docs/features/mobile-apps.md)) call it over HTTP with a shared React client (`@/lib/trpc`, provider in the root layout). Auth context accepts the `tt_id` cookie (web) **or** a `Bearer` Cognito JWT (mobile). **File uploads stay REST** (multipart: `POST /paddles/api/analyse`, the trial upload) and **firmware device endpoints stay REST**. See [`unified-app-and-api.md`](docs/features/unified-app-and-api.md).

**Public read-only API (`/api/v1`) and MCP server (`/mcp`):** a stable contract: add fields, never rename or remove; a breaking change is `/api/v2`. Details in `apps/web/CLAUDE.md`.

**Conventions that keep the monorepo working:**
- Import **per-file subpaths** (`@paddlesnitch/core/auth`, `@paddlesnitch/analysis/analysis-store`), not the barrel. The app `transpilePackages` all six packages in `next.config.ts`.
- Client bundles import only client-safe subpaths (pure). Storage-backed modules are separate server-only subpaths (e.g. `core/paddles` pure vs `core/paddle-store` server; the analysis engine `@paddlesnitch/analysis/analysis` is pure, `analysis-store` is server).
- **Don't duplicate** a domain type/util — if more than one place needs it, it belongs in a package (`core`/`timing`/`analysis`). The Analyse domain lives in `@paddlesnitch/analysis`, not the app.

See [`platform-monorepo.md`](docs/features/platform-monorepo.md) (original extraction) and [`unified-app-and-api.md`](docs/features/unified-app-and-api.md) (the merge + tRPC API).

### Feature design records

Shipped and planned specs are in `docs/features/`, indexed in [`docs/features/README.md`](docs/features/README.md). Each doc's own status line is the source of truth for its status; add a row there when you add a doc.

### Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript | Full-stack, server + client components |
| Styling | Tailwind CSS v4 | No shadcn/ui — custom retro design system |
| Maps | Leaflet + react-leaflet v5 | Free, no API key |
| Map drawing | Custom click-to-place | 2 clicks per line; no Leaflet.draw dependency |
| Auth (local dev) | cognito-local emulator on port 9229 | Same Cognito SDK calls as prod — only the endpoint URL differs |
| Auth (production) | AWS Cognito User Pool `paddlesnitch-users` (eu-west-1_BHyKJ0toh) | Email/password, email code (OTP, via SES), Sign in with Strava and Sign in with Google (Cognito hosted sign-in, #697; button behind the `GOOGLE_SIGNIN` variable); magic link is disabled; Apple not wired |
| Storage (local dev) | Filesystem under `apps/web/.local-data/` | `@paddlesnitch/core/storage` (app shim `src/lib/storage.ts`) |
| Storage (production) | Amazon S3 | Same interface, different backing |
| API | tRPC (`/api/trpc`, `packages/api`) for JSON; Next route handlers for uploads, auth, account, devices | Same handlers in local dev and prod |
| Processing | Inline in the upload API route | No Lambda trigger in local dev |
| IaC | AWS CDK (TypeScript) | `infra/` — OpenNext v4, CloudFront + Lambda |
| CDN | CloudFront + S3 OAC | Deployed — `d1745e47jh0mdf.cloudfront.net` (eu-west-1) |
| CI/CD | GitHub Actions | Push to `main` → test → build → CDK deploy (OIDC, no stored creds) |

### Everyday commands

```
pnpm dev          # cognito-local on :9229, init, Next.js on :3000 (the whole site)
pnpm test         # vitest suite: must be green before every commit
pnpm build        # TypeScript compile check: no errors allowed
pnpm seed         # demo data after deleting apps/web/.local-data
pnpm e2e          # Playwright critical paths
```

Each role window uses its own dev port (see `docs/agents.md`). Detail on local dev, seed accounts, the test tiers and CI is in `apps/web/CLAUDE.md`; deploys in `infra/CLAUDE.md`.

## Shared conventions

### Design System

**Aesthetic: conventional chrome, data with character, DARK — IBM Plex Sans for reading, Plex Mono for numbers, single blue accent.** Rules, feature tiers and the shared components (`Button`, `Form`, `Layout`, `Card` in `@paddlesnitch/ui`) are in [`design-system.md`](docs/features/design-system.md) — read it before building a screen. The whole platform is dark ([`single-app-shell.md`](docs/features/single-app-shell.md)); the canonical tokens live in **`@paddlesnitch/ui/tokens.css`** (Tailwind v4 `@theme`), imported by each app's `globals.css`. **Use the semantic token classes** (`bg-bg`, `bg-surface`, `text-fg`, `text-muted`, `border-border`, `text-primary-text`, …) — do **not** hardcode hex (`bg-[#0b1220]`); the whole point of the migration was to make colour swap in one place.

| Token | Value (dark) | Class | Usage |
|---|---|---|---|
| Background | `#0b1220` | `bg-bg` | `<body>` |
| Surface | `#0f172a` | `bg-surface` | cards, form fields |
| Surface-2 | `#1e293b` | `bg-surface-2` | hover states |
| Border | `#1e293b` | `border-border` | dividers |
| Border-strong | `#334155` | `border-border-strong` | outlines of buttons and inputs |
| Primary | `#0369a1` | `bg-primary` | filled buttons (white text on it) |
| Primary text | `#38bdf8` | `text-primary-text` | blue TEXT: times, links, active tab (`#0369a1` is ~3:1 on the ground; this is ~9:1) |
| Split | `#a78bfa` | `text-split` | split times, cadence data |
| Green | `#22c55e` | `text-green` | start line, open status |
| Red | `#f87171` | `text-red` | finish line, close/delete |
| Text | `#e2e8f0` | `text-fg` | body |
| Muted | `#94a3b8` | `text-muted` | labels, secondary text |
| Font | IBM Plex Sans | `--font-sans` | body, headings, controls — `next/font/google` variable `--font-plex-sans` |
| Mono | IBM Plex Mono | `--font-mono` | numbers (`.tabular`) and `Eyebrow` labels — variable `--font-plex-mono` |
| Radius | 6 px / 12 px | `rounded-control` / `rounded-sheet` | controls + cards / sheets; data stays square |

CSS utilities in `globals.css`: `.tabular` (Plex Mono + tabular-nums), `.tt-link`/`.tt-nav-link` (token-based).
Maps: dark tiles (Esri World Dark Gray); Trials course maps default to dark with a LIGHT MAP toggle (2026-10); the organiser's course-drawing map stays light. No rounded corners on data elements (tables, charts, maps). Mobile-first; tap targets ≥ 44px; phones get a bottom tab bar (Paddles, Trials, Plan, Games, You) and the root layout pads the body for it. The historical light palette values (`#ffffff`/`#0f172a`/…) are retained in comments in `tokens.css` as a possible future light mode.

### Writing for the site

Plain words, one name per thing. `apps/web/src/lib/copy-style.test.ts` fails on phrases we removed; add to its list when you retire a word.

1. **One name per thing:** Trials (URL `/att`), Paddles, Plan (`/plan`), Devices, Profile, Account — never "Settings", "My …", "Analyse" (as a place), "library", "ATT/ATTS". A paddle, a tracker (not "device" in prose), a recording (from a tracker), an effort, a rest, a section, stroke rate (not cadence), add/remove (not link/pair/revoke).
2. **Buttons:** 1–3 sentence-case words that say what happens (Save, Add paddle, Remove tracker). Loading = same verb + "…". No emoji.
3. **Headings, tabs, menus, links:** sentence case. **Uppercase only** for short mono labels over data (`<Eyebrow>`: DISTANCE, PACE /500, column heads). Helper text on its own muted line below, sentence case. See [`design-system.md`](docs/features/design-system.md).
4. **Errors:** "Couldn't …" + what to do ("Please try again." only when retrying helps). Never codes, vendor names (Cognito, JWT, S3), "token", "state", "endpoint", raw enums.
5. **One idea per sentence, ~20 words max;** helper text two sentences at most. No marketing filler (suite, seamless, unlock, journey, "actually happened"), no lists of three for rhythm, few em-dashes.
6. **Don't blame the reader** ("We can't find this paddle", not "it isn't yours"), and **don't claim causes the data can't show** ("slowed", not "faded (fatigue)").
7. **Units:** lowercase with a space — `2.1 km`, `/500 m`, `58 spm`; pace is `/500`, not m/s.
7a. **Dates:** only through `@paddlesnitch/core/format`: `fmtDay` '13 Sep 2026', `fmtWeekday` 'Sun, 13 Sep 2026', `fmtMonth` 'Sep 2026', `fmtDayMonth` '13 Sep' (all UTC, month names spelled out, safe on server-rendered pages) and `fmtDayTime` '13 Sep 2026, 09:11' (viewer's time zone: browser-only pages). Never `toLocale*`: browsers and servers write it differently ('Sept', 'Sep 13'), which also breaks hydration. `one-date-format.test.ts` fails on a new one.
8. **No AI model names on screen.** AI-written text follows the same rules.

### Key Conventions

- **`console.error` means "we broke something and want to hear about it".** One such line on the server emails the owner (the zero-tolerance `paddlesnitch-server-errors` alarm, [`observability.md`](docs/features/observability.md)). Expected or recoverable conditions (a job attempt that will be retried, a refused input) use `console.warn`. Never `console.error` a user's mistake.
- All IDs: `nanoid()` — URL-safe, short.
- Timestamps: ISO 8601 strings in JSON.
- Times: stored as seconds (float), displayed as `m:ss.t` via `formatTime()` in `geo.ts`.
- Coordinates: always `[lat, lng]` — never GeoJSON `[lng, lat]` order.
- Start/finish lines: exactly `[[lat, lng], [lat, lng]]`.
- Course distance: auto-calculated (Haversine between midpoints of start and finish lines). Not stored as user input.
- YAGNI + KISS: don't build what isn't needed; simplest thing that works.
- Never commit AWS credentials. IAM roles for Lambda; `aws sso` locally.
- Target domain: `paddlesnitch.com` — app at `paddlesnitch.com/att`, landing at `paddlesnitch.com/`
- **Personal data:** every new kind of per-user data gets a line in the account export AND in erasure (`account-data-complete.test.ts` checks). Erasure stays flat in time: `deleteObjects`/`deletePrefix`, never a loop of single deletes. Details: `apps/web/CLAUDE.md` (routes list).
- **Outside services:** every outside host the code calls is named on the privacy page and in `legal-claims.test.ts`, and the privacy policy promises to email users before we add a new service or kind of data.
- **Server limits:** a Lambda answer is at most 6 MiB before compression (bigger is a 502: chunk anything that grows), and a request at most ~4.6 MB. Work in `after()` holds the response here, so slow work is a job (`apps/web/CLAUDE.md` § "`after()` does NOT run after the response here").
- Web-only conventions (the proxy's `next` parameter, `useSearchParams`, the baked-in `/att` prefix, `next/dynamic` with `ssr: false`, discovery files) are in `apps/web/CLAUDE.md` § Web conventions.
