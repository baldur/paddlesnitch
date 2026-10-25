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

One pnpm workspace. One Next app over six shared packages, plus the tracker
firmware, the phone apps and the games, which live outside it.

```
apps/web            the whole web app — /att, /paddles, /profile, /api/trpc
packages/core       auth, storage, cognito, strava, shared types
packages/timing     GPS domain — geo, parsers, weather/flow, stroke rate, attitude
packages/analysis   the analysis engine, store, LLM, share cards
packages/api        the typed tRPC router the website and the phone apps share
packages/ui         shared shell, design tokens, analytics
packages/waterways  the river planner (/plan): waterway network, routing, locks
firmware/           the tracker — C++/PlatformIO, NOT part of the pnpm workspace
mobile/             the Android and iPhone apps, and the contract they share
games/              the browser games at /games — plain HTML/JS, no build
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

Sign in with `admin@rrc-tt.is` / `Password123` (the seed admin).

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

Firmware is built separately: flash by cable with `cd firmware && ./tools/flash.sh`.
A merge to `main` that changes `firmware/VERSION` sends it over the air to the
beta trackers. Moving it to every tracker (stable) is a manual step.
`.github/workflows/firmware-release.yml` explains both.
A plain `pio run -t upload` does not work on this board — see `firmware/CLAUDE.md`.

## Where the documentation is

**The `CLAUDE.md` files are the source of truth for current behaviour.** They
are written for whoever — person or agent — is about to change something, and
they are kept current as part of doing the work rather than afterwards. The
root [`CLAUDE.md`](CLAUDE.md) holds the working rules, the map and the writing
rules. It also indexes one `CLAUDE.md` per area, next to its code: `apps/web/`,
each package, `infra/`, `.github/`, `firmware/`, `games/` and the phone apps.

- [`firmware/CLAUDE.md`](firmware/CLAUDE.md) — the tracker, its gesture
  contract, and the hardware traps that have cost real time
- [`docs/features/`](docs/features/) — design records, one per feature. These
  are history: they describe what was built and why at the time. Where they
  disagree with a `CLAUDE.md`, the `CLAUDE.md` wins.
- [`docs/features/device-screen-map.md`](docs/features/device-screen-map.md) —
  every device screen, and a catalogue of where a customer can get stuck

## Working with Claude agents

Most of the work here is done by Claude Code sessions, each with a role. The
full map is [`docs/agents.md`](docs/agents.md); the short version:

- **`lead`** is the one to talk to. It routes work to the right specialist,
  does changes that cross areas itself, and runs the reviewers before every
  pull request.
- **Builders** each own one area and edit only that: `android`, `ios`,
  `firmware`, `motion-core` (the motion maths, and the shared recorder core
  now being built) and `game`. Everything else (the web app, packages, infra, the mobile
  contract) is `lead`'s.
- **Reviewers** check a change and report, never edit: `tester`,
  `security-privacy`, `design-usability` and `copy-style`. `lead`'s pull
  requests list which ones ran and what they found.
- **`help`** explains the setup and answers "who does what".

Each role has a brief in [`.claude/agents/`](.claude/agents/). Each role you
start in its own window gets its own git worktree (`../paddlesnitch-<role>`),
so sessions never share a checkout. Reviewers are spawned by another session
and need none.

Start a window with `psa <role>`. `psa` is a one-line shell function: copy it
from [`docs/agents.md`](docs/agents.md) and change the path to your clone. It
runs [`scripts/agents/start.sh`](scripts/agents/start.sh) from the latest
`main`, and `psa -h` lists the roles.

Agents open pull requests and people merge them. The exception is backlog
issues labelled `unattended-ok` (reversible, provable with a test, no owner
decision), which an agent may merge once the checks pass. Firmware pull
requests always wait for a person, because a merge can release to trackers.
