# Unified web app + shared tRPC API

✅ **Phases 1–3 shipped and deployed — 2026-09-13.** (Since then the `/analyse` section moved to `/paddles`; old URLs 301.) (Phase 4, the Expo mobile
app, is a later track.) Consolidates the two Next apps into one and introduces a
shared, typed tRPC API that web + mobile + firmware consume. Supersedes the two-app split from
[`platform-monorepo.md`](platform-monorepo.md) for the *web tier* (the shared
`packages/*` domain layer is unchanged and becomes the API's core). Executed in
three always-green phases; nothing is big-bang.

## Why

Two frictions drove this:

1. **Dev workflow.** att (`:3000`, no basePath, `/att` baked into folders) and
   analysis (`:3001`, Next `basePath: '/analyse'`) run as **two apps on two
   origins**. Cross-app links and `fetch`es (e.g. the platform home reading a
   user's paddles, an `AppShell` tab from att → `/analyse`) 404 in dev because
   there is no single local origin — they only work behind one CloudFront
   origin in prod. This is a recurring papercut.
2. **A real mobile app is coming (React Native / Expo, TypeScript).** Next route
   handlers tied to cookies + per-app `basePath` are not reusable by a mobile
   client. A multi-client product (web + mobile + firmware) needs a real API
   with a stable, testable contract.

## Decisions

- **One Next app, no basePath.** Merge att + analysis into a single Next app.
  `/analyse` becomes **baked into folders** (`src/app/analyse/*`), exactly like
  att already bakes `/att`. Dropping `basePath` removes the two-origin split →
  one origin in dev *and* prod. This is the enabling step for everything else.
- **Web keeps SSR.** The web app stays a Next app (server components, SEO,
  dynamic OG images for shared paddles, public profiles/leaderboards). It does
  **not** become a static SPA — we keep rendering value and just move data
  access behind the API. ("Static web" was considered and rejected: too much of
  the product is public, SEO-relevant, unfurlable content.)
- **Contract: tRPC.** Web and mobile are both TypeScript, so tRPC gives
  end-to-end types with **no codegen** — the router's input/output types *are*
  the client types, so web and mobile cannot drift. This is the QA/regression
  win (contract tests + shared types), not the folder move itself.
- **The API is a package.** The tRPC router lives in **`packages/api`**, importing
  the existing `@paddlesnitch/core` + `@paddlesnitch/timing` services (already
  framework-free — ~60% of the API already exists). The Next app **mounts it at
  `/api/trpc`**. Mobile hits the same origin's `/api/trpc`. Because the router is
  a package, extracting a standalone `apps/api` later (own Lambda) is mechanical
  — not needed on day one.
- **SSR calls the router in-process.** Server components use tRPC's
  `createCaller` (no HTTP hop); the browser + mobile use the tRPC HTTP client
  against the same router. One source of truth, two transports.
- **Auth: cookie (web) OR bearer JWT (mobile), one context.** The tRPC context
  resolver accepts the `tt_id` httpOnly cookie (web) *or*
  `Authorization: Bearer <Cognito JWT>` (mobile). This is the existing two-path
  pattern (`getAuthUser` cookie + `getDeviceAuth` bearer) unified into one
  resolver. Cognito already issues the JWTs mobile carries.
- **Firmware stays REST.** The device endpoints (`/api/devices/*`,
  `device-uplink.md`) stay plain, versioned REST — a C++ client should not speak
  tRPC. Few, stable, independently testable.

## Repo shape (target)

```
apps/
  web/        the ONE Next app (was att + analysis) — SSR + /api/trpc mount + firmware REST
  mobile/     Expo (React Native), consumes packages/api types      [Phase 4, later]
packages/
  api/        @paddlesnitch/api — tRPC router + context, over core/timing
  core/       unchanged — platform primitives (now also the API's domain layer)
  timing/     unchanged — GPS/track domain
  ui/         unchanged — shared shell + RouteThumb + tokens
firmware/     unchanged — talks device REST to the web app
```

## Auth model

| Client | Credential | Verified by |
|---|---|---|
| Web (browser) | `tt_id` httpOnly cookie (Cognito ID token) | tRPC context → `getAuthUser` |
| Mobile (Expo) | `Authorization: Bearer <Cognito JWT>` | tRPC context → JWT verify (same JWKS) |
| Firmware | `Authorization: Bearer <deviceToken>` | device REST → `getDeviceAuth` (unchanged) |

Human tRPC procedures accept cookie OR user-JWT; never a device token (kept
separate, as today).

## Infra change (Phase 1)

Today: **two** OpenNext server Lambdas — `ServerFn` (att) + `AnalysisFn`
(analysis) — with CloudFront behaviors `/analyse/_next/*` + `/analyse*` → the
analysis Lambda and a separate `_analyse-assets/analyse/` asset origin. After
the merge: **one** server Lambda, the `/analyse*` behaviors + the separate
analysis asset origin/deployment are removed, and `bedrock:InvokeModel` (used by
the analyse LLM) moves onto the single `ServerFn`. Net: fewer moving parts, one
deploy, simpler routing.

## Phases (always green)

1. **Merge att + analysis → one Next app.** Drop basePath; move analysis routes
   to `src/app/analyse/*`; rewrite basePath-relative links to explicit
   `/analyse/...`; unify `next.config`, root layout, `globals.css`, `proxy.ts`
   middleware, and the `@/*` alias; merge `components/`/`lib/` (resolve name
   collisions); collapse the infra to one Lambda. Both test suites green, one
   dev port. **Independently valuable even if we stopped here** (fixes the dev
   workflow).
2. **`packages/api` (tRPC) + mount at `/api/trpc`.** Context resolver
   (cookie/bearer). Migrate a first slice (paddles/sessions) to procedures; SSR
   via `createCaller`; add the client provider. Contract tests.
3. **Migrate remaining endpoints** to procedures a few at a time (old route
   handlers stay until replaced). Firmware REST untouched.
4. **`apps/mobile` (Expo)** consumes the router types. *(Separate track, later.)*

## Risks / watch-items

- **basePath removal is the fiddly part** — every analysis internal navigation
  that relied on `basePath` prepending must become explicit `/analyse/...`. A
  full inventory precedes the move; a missed one is a dead link, caught by build
  + e2e.
- **Asset paths / OpenNext** — merging changes the `_next` asset layout; the
  separate `_analyse-assets` origin goes away. Verify no mid-deploy 404s (the
  existing `prune:false` + `addDependency` ordering guards still apply).
- **Test/import collisions** — the two apps have separate `@/*` roots; merging
  into one `src` can collide component/lib basenames. Resolve during the move.
- **Do it on a branch, confirmed locally** before any deploy.
