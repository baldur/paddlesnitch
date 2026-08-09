# Platform: multi-app monorepo

**Status: 🚧 planned (2026-07). Migration is gradual and in-place — see phases.**

## Why

paddlesnitch is becoming a **platform of apps** that share one user base and one
set of AWS infrastructure, not a single app:

- **att** — Automated Time Trials (the app that exists today).
- **analysis** — paddle / paddle-bits analysis (next; see [`paddle-analysis.md`](paddle-analysis.md)).
- **videos** — paddle video upload + review for a group (later).

All apps share: the **same Cognito user pool** (one account works everywhere,
true SSO), the **same S3 data bucket** (per-app key prefixes), and the **same
CloudFront distribution + CDK stack**. They differ in codebase (separate app
directories) and URL path.

## Decision: rename in place, don't start a new repo

This repo becomes the monorepo. Keep the git history; convert to a
**pnpm workspace** gradually, one behaviour-preserving PR at a time. The GitHub
repo was renamed `paddlesnitch-att` → `paddlesnitch` (2026-08); the OIDC
deploy-role trust was updated to the new slug, and `GITHUB_REPO` (feedback →
issue Lambda) points at `baldur/paddlesnitch`.

## Target structure

```
paddlesnitch/
  pnpm-workspace.yaml            packages: ['apps/*', 'packages/*']
  packages/
    core/    @paddlesnitch/core    identity + plumbing: auth, cognito, storage,
                                    metrics, email, anti-bot, url, platform types
    timing/  @paddlesnitch/timing  the shared sport domain: geo, parsers
                                    (gpx/fit/tcx/csv/speedcoach), courses, trials,
                                    groups, permissions, leaderboard, conditions
  apps/
    att/       Next.js app, basePath /att   (the current app, moved here)
    analysis/  Next.js app, basePath /analysis
  infra/       CDK — one pool, one bucket, ONE CloudFront, one server Lambda per app
```

`core` = things every app needs. `timing` = things a *timing/GPS* app needs
(att uses it fully; analysis uses little/none of it; videos may reuse `groups`).
The exact `core` vs `timing` boundary is refined as we extract.

## Identity & routing (settled)

- **Same Cognito user pool AND same app client id** → a session cookie minted by
  one app validates in another (same JWT audience). `getAuthUser()` is unchanged
  and moves into `core`.
- **Path-based on one domain**: `paddlesnitch.com/att`, `/analysis`. Cookies are
  already host-only on `paddlesnitch.com` (`setAuthCookies`, no `Domain` set), so
  the session is **already shared across paths** — no auth change needed.
- **Consequence — adopt Next `basePath` per app.** Two apps on one CloudFront
  distribution both emit assets at `/_next/*` and would collide. Each app gets a
  real `basePath` (`/att`, `/analysis`) so assets namespace to `/att/_next/*`
  etc. and CloudFront routes each set to the right origin. This **reverses att's
  current "no basePath, /att hand-baked into every href" convention** (a net
  simplification — the hand-baked prefixes get deleted).
- Data: shared bucket, per-app key prefixes (`att/…`, `analysis/…`). SSM params
  namespaced per app (`/att/…`, `/analysis/…`).

## Phased migration (each phase is its own PR; `pnpm test` + `pnpm build` green before/after)

- **A1 — Workspace + move app.** Add `pnpm-workspace.yaml`; move the app into
  `apps/att` (still one package, imports unchanged via path aliases). Behaviour-
  preserving. Infra stays at repo root.
- **A2 — Extract `packages/core`.** Move auth, cognito, storage, metrics, email,
  anti-bot, url + the *platform* types out of the app; app imports
  `@paddlesnitch/core`. (Requires splitting `types.ts`: identity/platform types →
  core, att-domain types stay.) **This unblocks scaffolding the analysis app.**
- **A3 — Extract `packages/timing`.** geo, parsers, courses, trials, groups,
  permissions, leaderboard, conditions → `@paddlesnitch/timing`.
- **A4 — Adopt `basePath: '/att'`** in the att app; delete hand-baked `/att`
  prefixes. Smoke-test the map/auth/upload flows.
- **A5 — Infra for a second app.** One CloudFront distribution, one OpenNext
  server Lambda per app, per-basePath asset behaviors, shared data bucket with
  per-app prefixes. Deploy.

A1–A2 are the priority: once `core` exists, the analysis app can be scaffolded
(`apps/analysis`) in parallel while A3–A5 continue.

## Two parallel workstreams

- **Workstream A — platform (this doc).** Mechanical/infra; little product input.
  A1 → A5 above.
- **Workstream B — analysis app** ([`paddle-analysis.md`](paddle-analysis.md)).
  Product ideation + spec now (no dependency on A), scaffold on `core` after A2,
  then build the MVP.

They converge at A2/B-scaffold. Until then they run independently.
