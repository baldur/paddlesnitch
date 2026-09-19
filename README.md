# paddlesnitch

A platform for paddlers — kayak, canoe, SUP, rowing. Live at
[paddlesnitch.com](https://paddlesnitch.com).

- **Trials** (`/att`) — GPS-timed river time trials. Organisers draw start and
  finish lines on a map; paddlers upload a GPS trace; the system computes
  elapsed time, 500 m splits and stroke rate.
- **Paddles** (`/paddles`) — session analysis. What actually happened on an
  outing and what it means, with an LLM coach narrative.
- **Tracker** (`firmware/`) — a LilyGO T-Beam S3 Supreme that records a paddle
  and uploads it over WiFi by itself. No phone, no card shuffling.

## Layout

One pnpm workspace. One Next app over four shared packages.

```
apps/web            the whole web app — /att, /paddles, /profile, /api/trpc
packages/core       auth, storage, cognito, strava, shared types
packages/timing     GPS domain — geo, parsers, weather/flow, cadence, attitude
packages/analysis   the analysis engine, store, LLM, share cards
packages/api        the typed tRPC router the app and a future mobile app share
packages/ui         shared shell, design tokens, analytics
firmware/           the tracker — C++/PlatformIO, NOT part of the pnpm workspace
infra/              AWS CDK — CloudFront, Lambda, S3, Cognito, SES
```

## Getting started

```bash
pnpm install
pnpm dev      # cognito-local on :9229, then Next on :3000
pnpm seed     # demo users, courses, trials and entries
```

No Docker and no AWS credentials needed for normal development. Storage is the
local filesystem under `apps/web/.local-data/`, and auth is a local Cognito
emulator that speaks the same SDK as production.

Sign in with `admin@paddlesnitch.com` / `Password123`.

## Testing

```bash
pnpm test               # the web suite — unit + integration, ~4 s
pnpm e2e                # Playwright critical paths
cd firmware && pio test -e native   # firmware logic, on the host, no board
```

The web tests run against a real temp filesystem and a real cognito-local; only
`next/headers` is mocked. The firmware `native` environment exists because the
predicate deciding whether an uploaded file was a track or a sidecar was wrong
for a week and cost a full debugging session — it is now three lines of test
that run in half a second without the hardware.

## Deploying

Push to `main`. GitHub Actions runs the tests, builds with OpenNext, and
deploys with CDK via OIDC — there are no stored AWS credentials.

**Not Vercel.** It runs on CloudFront in front of a single Lambda, with S3 for
assets and data and Cognito for identity.

Firmware is separate and deliberately manual: `cd firmware && ./tools/flash.sh`.
A plain `pio run -t upload` does not work on this board — see `firmware/CLAUDE.md`.

## Where the documentation is

**[`CLAUDE.md`](CLAUDE.md) is the source of truth for current behaviour.** It is
written for whoever — person or agent — is about to change something, and it is
kept current as part of doing the work rather than afterwards.

- [`firmware/CLAUDE.md`](firmware/CLAUDE.md) — the tracker, its gesture
  contract, and the hardware traps that have cost real time
- [`docs/features/`](docs/features/) — design records, one per feature. These
  are history: they describe what was built and why at the time. Where they
  disagree with `CLAUDE.md`, `CLAUDE.md` wins.
- [`docs/features/device-screen-map.md`](docs/features/device-screen-map.md) —
  every device screen, and a catalogue of where a customer can get stuck
