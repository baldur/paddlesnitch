# App: paddle analysis

**Status: ✅ shipped 2026-08.** Was a living design record refined through prototyping; kept as the record of why the engine works the way it does.

> **Since this was written:** `apps/att` + `apps/analysis` became the single `apps/web`, and the `/analyse` section moved to `/paddles` (old URLs 301). Paths below are as-built at the time; `CLAUDE.md` is authoritative for today.

<!-- original status line follows -->
**Originally: 💭 spec (2026-07). Living design record — refined through prototyping on
real traces. Build starts once the monorepo lands (see [platform-monorepo](platform-monorepo.md)).**

Lives at `apps/analysis`, `basePath: /analysis`, on `@paddlesnitch/core` (users,
storage, auth, LLM) and `@paddlesnitch/timing` (parsers, conditions, geo, map).

**Shipped since spec — time-trial import (#159):** the "analyse one of my trial
entries" path is built. A **TIME TRIALS** tab (`src/lib/trials.ts` →
`GET /api/trials`) lists the signed-in user's own att submissions and re-parses
the stored raw trace (upload or Strava snapshot) — no re-upload. Saved paddles
carry source type `'trial'`. The issue's second ask — compare against others
with overlapping paths — is a deferred follow-up.

## Concept

A **paddling-session analysis** tool. "Paddle" = an outing on the water, not the
equipment. Upload a session (any format the platform parses — GPX / FIT / TCX /
CSV / NK SpeedCoach — or import from Strava), and the app finds **something
interesting** about it: what actually happened and what it implies, narrated.

Proven on four real sessions during prototyping (2× rowing SpeedCoach/Garmin, a
kayak-via-SUP Garmin, a Strava touring paddle) — the engine below produced the
right read for each.

## Product (v1 screen)

Sits inside paddlesnitch as a sibling of Trials — same top bar, same login:
`[ Trials ] [ Analysis ] ( Videos )`. Upload / Strava import / **"analyse one of
my trial entries"** (att already stored those traces + conditions) → the page:

```
┌ YOUR PADDLE · 12 Jul · Thames, Reading ───────────────────────────────┐
│   ╭ live Leaflet map: track coloured, digs glowing, rest rings, ╮ WIND │
│   │ marker replaying the paddle              ▶━━━●━━━            │ 20NE │
│   ╰───────────────────────────────────────────────────────────╯ FLOW  │
│   colour by: (speed) (stroke rate) (true effort*)               3.7 lo │
├───────────────────────────────────────────────────────────────────────┤
│  65 min · 10.4 km · ~74 spm · 2.3 m/stroke · 4 digs · 2 rests          │
├─ WHAT HAPPENED (LLM) ─────────────────────────────────────────  share ┤
│  "A long paddle with a few real digs. Mostly cruising 2:54/500…"       │
├─ EFFORTS ─────────────────────────────────────────────────────────────┤
│  ✦ dig 1 30:00 2:02 1:39/500 82spm ✓steady →held  · ○ rest 12:00 24s   │
└───────────────────────────────────────────────────────────────────────┘
```

Hover a segment → its pace/rate/relative-wind. **My Paddles** library adds
history + trends (distance-per-stroke over a season, cruise pace vs flow,
consistency improving). Share mints a public link like att leaderboards.

## Analysis engine (deterministic — the LLM only narrates its output)

Pipeline: **ingest → derive → segment → conditions → summarise → (LLM) narrate → visualise.**

- **Derive** (per point / windowed): speed (GPS + Haversine, smoothed), **distance
  per stroke** (`speed ÷ strokeRate`), acceleration, bearing, 500 m split.
- **Sport normalisation.** Surface the FIT `sport` field (parsers currently drop
  it — small `ParseResult` addition). This community records kayak as
  `stand_up_paddleboarding`, which counts a full L+R cycle as one → **×2 stroke
  rate, ÷2 distance-per-stroke** to get true kayak values. A per-user/session
  setting (default on here) handles genuine SUP. **NB: this also affects att's
  existing stroke-rate display** — same paddlers, same halving — so the fix
  belongs in the shared layer.
- **Segment by baseline + departures — do NOT classify the session.** Establish
  the session's own cruising baseline, then flag departures both ways:
  **down** = rests/recovery (always itemised, never narrated away), **up** =
  surges/efforts (relative to *this* session's cruise, not a fixed threshold).
  This one rule spans the whole spectrum — clean intervals, fartlek, steady —
  where a binary "workout vs steady" gate failed (it both over-segmented a
  steady SUP paddle into 11 phantom pieces AND smoothed away its real digs).
- **Per-effort trend (series analysis):** slope of stroke rate + speed within
  each up-departure → `held` / `built (+N spm/min)` / `faded (pace dropping at
  steady rate = fatigue)` / `negative-split`. Plus consistency (stroke-rate CV:
  <4% steady, 4–8% fair, >8% ragged).
- **Group efforts into sets** by similar duration + pace (e.g. auto-detected
  `4 × ~90s @ 1:39, SR 38 ← a set` from a messy 50-min trace).
- **Conditions.** Real wind (Open-Meteo) + river flow (EA gauge) for the day/spot.
  Flow is **discharge (m³/s), not current speed** — make it meaningful via
  **context** (low/normal/high vs the station's own history percentile) and
  **direction** (downstream-assist vs upstream-fight; for out-and-backs the
  two-direction gap *is* the combined current+wind effect). The payoff:
  **conditions-adjusted "true effort"** — normalise speed for headwind + flow per
  segment so a slow upwind-upstream leg reveals as the biggest real effort.

## LLM — identical local and on Bedrock (parity by construction)

Requirement: whatever runs locally for testing is the **same** as prod on AWS
Bedrock. Achieved with **one interface, two transports** (the same pattern as
`cognito-local` vs Cognito):

- Lives in `@paddlesnitch/core` as `generateInsight(summary) → string`. The
  prompt-building + model id + parsing are **shared code**; only the client
  constructor differs by env.
- **Backend = Bedrock Converse** (`@aws-sdk/client-bedrock-runtime` `ConverseCommand`),
  which is **model-agnostic** — the same request shape drives Claude Haiku, Amazon
  Nova, Llama, and Mistral. So the model is pure config (`LLM_MODEL`); swapping to
  a cheaper model is an env change, not code. SSO creds locally, IAM role in prod.
  ```ts
  const c = new BedrockRuntimeClient({ region: BEDROCK_REGION })
  const out = await c.send(new ConverseCommand({ modelId: process.env.LLM_MODEL!,
    system: [{ text: SYSTEM }], messages: [{ role: 'user', content: [{ text: buildPrompt(summary) }] }],
    inferenceConfig: { maxTokens: 400 } }))
  // out.usage → { inputTokens, outputTokens } for cost tracking
  ```
  (An `AnthropicBedrock`/`Anthropic` adapter can still back a Claude-only path, but
  Converse is preferred so we can bench non-Claude cheap models too.)

### Model selection — a local bench (cheap *and* effective, proven before prod)

Because the engine produces the structured summary deterministically, freeze ~5
real paddles as fixtures and run **every candidate model** over them:
`pnpm bench:llm` prints, per model per paddle, the **output text + input/output
tokens + estimated $ + latency**, and a **cost-per-1000-paddles** roll-up (from
`out.usage` × a per-model price table). You read the outputs to judge quality and
see exact cost, then **pin the winner in prod via `LLM_MODEL`**. Candidates:
Amazon Nova Micro/Lite (cheapest), Claude Haiku, Llama/Mistral. (An optional
LLM-judge can auto-score later; a golden set + human eyeball is the v1.)
- **Adapter (`makeInsighter()`) bridges local ↔ prod.** One `Insighter` interface
  (`generate(system, prompt) → string`), backend chosen by env; the prompt +
  model params live *above* the adapter (`generateInsight`/`buildPrompt`) so
  behaviour can't drift. Backends:
  | `LLM_BACKEND` | when | parity |
  |---|---|---|
  | `bedrock` (default) | prod + recommended local (SSO creds) | **exact** |
  | `anthropic` | local off-AWS iteration | same Claude model, different account |
  | `ollama` | offline UI/plumbing only | different model — throwaway |
  | mock (auto when `VITEST`) | tests | n/a |
  Prod sets nothing → `bedrock`. **Recommended local = `bedrock`** (same model id,
  same code path → dev == prod). `AnthropicBedrock` and `Anthropic` share the
  exact `.messages.create()`, so even the two Claude transports are code-identical.
- **Billing is AWS-side, NOT the Anthropic quota.** Bedrock bills per-token to
  the AWS account with its own quotas — it does not go through `api.anthropic.com`
  or any Anthropic plan. The `anthropic` backend (the only one that would use the
  Anthropic quota) is **local-only**. Guardrails so prod can't ever leak onto it:
  (1) **never set `ANTHROPIC_API_KEY` in the prod Lambda** (no key → that backend
  can't run); (2) **`makeInsighter()` hard-pins `bedrock` in the Lambda runtime**
  and ignores any `LLM_BACKEND` override there.
- **Cost containment (AWS side):** the insight is **generated once when a paddle
  is analysed and stored on the session record** — re-viewing the page makes no
  LLM call. Prompts are tiny (the compact summary only, never raw GPS →
  hundreds of tokens), narration uses **the cheapest model the bench proves good enough (likely Amazon
  Nova; Claude Haiku as a step up)**, and a **budget alarm/cap** guards the spend.
  A paddle costs a fraction of a cent.
- **Grounding:** the LLM only ever sees the structured summary, never raw points
  → it can't hallucinate the numbers.
- **Tests mock `generateInsight`** (deterministic, no network/cost) — the engine
  metrics are asserted independently of the LLM.
- **Checkpoints:** confirm the chosen Claude model is available on Bedrock in the
  target region (else use a cross-region inference profile); grant the Lambda
  role + your SSO role `bedrock:InvokeModel` on the model ARN. Env:
  `BEDROCK_REGION`, `LLM_MODEL`.

## Visualisation

Live Leaflet map (reuses att's map stack + neon river overlay): track as a
per-segment coloured polyline, **colour-by toggle** (speed / stroke rate / true
effort), surge glow, rest rings, real **wind rose + flow badge**, hover tooltips,
and a **replay scrubber**. Prototyped standalone against a real track — pans,
zooms, hovers, replays.

## Shares vs owns

- **`core`:** identity, storage, auth, metrics, design system, **the LLM layer**.
- **`timing`:** parsers, `conditions` (wind/flow), geo, Leaflet map components.
- **App-owns:** the derive+segment engine, analysis data model, these screens.

## Data model & build path

Fresh model (analysis sessions ≠ race entries), under the `analysis/` S3 prefix.
Build order once the monorepo lands: extract `core` (A2) → scaffold
`apps/analysis` → **one vertical slice** (upload → the page above for a single
paddle, Bedrock narrative) → library + trends + true-effort colouring.

## Open questions

- [ ] **Library depth** — how much history/trend UI in v1 vs later (the leaning is
      single-paddle page first, library soon after — trends are the sticky bit).

## Later (deferred)

- Paddle **videos** — upload + group review (reuses `groups` from `timing`).
