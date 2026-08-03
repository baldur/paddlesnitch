# Feature spec: Personable, memory-aware LLM commentary

**Status:** 🚧 built, in local review (2026-08-03; branch `personable-insights-build`). Layers 1–3 implemented + wired; the model bump is documented + one-line-switchable but NOT flipped in prod (needs Bedrock verification). Verified end-to-end on the real local library via Ollama.
**Owners:** Baldur (product), Claude (implementation).
**App:** `apps/analysis` (the analyse stack). Extends the existing insight in `src/lib/llm.ts`.

## Implementation (2026-08-03)

- **L1** `src/lib/history-stats.ts` — `computeHistoryStats` + `renderHistoryFacts` (PBs, vs-90-day-average, pace trend, volume this week/month, days-since-last, distance milestones). Pure, 8 unit tests.
- **L3** same module — `selectRelevantPaddles` + `renderRelevant` (venue via start-point haversine + boat class + similar distance). `SessionSummary` gained `startLat`/`startLng`/`avgDps`.
- **L2** `src/lib/athlete-profile.ts` — `refreshAthleteProfile` (cold-start skip < 3 paddles; full re-distill every 10 or when no profile; else incremental merge) + `deterministicProfile` fallback. Stored via `AthleteProfile` at `analysis/{userId}/profile.json` (`getAthleteProfile`/`saveAthleteProfile` in the store).
- **llm.ts** — revised coach-persona `SYSTEM`; `buildPrompt` takes an `InsightContext` (profile + historyFacts + relevant); shared `runInsighter` used by both `generateInsight` and the profile builder (one place picks backend/model).
- **Route** `api/analyse/route.ts` — computes L1/L3 from prior paddles + loads the profile → feeds `generateInsight`; after save, best-effort `refreshAthleteProfile` folds the new paddle in for next time (awaited in-request for Lambda reliability).
- **Model bump** — `BedrockInsighter` already uses model-agnostic Converse, so it's a one-line `LLM_MODEL` change in `infra/lib/att-stack.ts` (documented there with the Haiku/Nova `eu.` inference-profile ids). **Left as Mixtral** until Bedrock model-access is enabled + the id confirmed.

## Why

The per-paddle insight is grounded and correct but generic — it reads the same
for everyone. It should feel like a coach who **knows this paddler**: their
history, their goals, what they've been working on, how today compares to their
own record. Today `buildHistory` feeds the last 8 paddles' compact stats + notes
into the prompt — a good start, but chronological and shallow, and it grows with
history.

**The constraint we design around:** you cannot feed *all* paddles into every
prompt — tokens grow unbounded and context blows up. The whole design is about
**distilling history into a compact, near-constant-size memory** so richness is
decoupled from history length.

## The three layers (cheapest → richest)

### Layer 1 — Deterministic cross-history aggregates (≈100 tokens, NO extra LLM call)

Computed in code across the user's saved paddles; fed as a short fact block.
New pure module `apps/analysis/src/lib/history-stats.ts`:

- **Personal bests:** fastest cruise/500 overall + per boat class; longest paddle.
- **This-vs-you:** today's cruise pace/SR/distance-per-stroke vs a rolling
  30-/90-day average; signed deltas ("8s/500 quicker than your 90-day average").
- **Trends:** slope of cruise pace + stroke-rate consistency (CV) over recent
  paddles/months → improving / plateauing / slipping.
- **Volume:** distance + session count this week/month/year; days since last paddle.
- **Milestones / streaks:** Nth session this week; first sub-X pace; cumulative
  distance milestones (100 km, …); 2nd-fastest 5 k, etc.

Output: a `HistoryStats` object + `renderHistoryFacts()` → a compact text block.
Deterministic, unit-tested, grounded — the model narrates it, never computes it.
**Best ROI: instant "it knows me" with zero token/model change.**

### Layer 2 — Persistent athlete profile (≈200 tokens, CONSTANT regardless of history size)

A stored, evolving natural-language memory of the paddler as a person.

- **Stored** at `analysis/{userId}/profile.json` (`AthleteProfile`: `{ text,
  version, updatedAt, builtFromCount }`). Private to the user, like sessions.
- **Content** (~200 tokens): who they are as a paddler, home water, typical
  sessions, boat classes, **goals + themes mined from their diary notes and prior
  insights**, what they're working on, tone.
- **Update strategy — the token-control crux:**
  - *First build* once the user has ≥3 paddles.
  - *Incremental merge* on each new saved paddle: feed the CURRENT profile + the
    new paddle's summary + note → a small LLM call returns the updated profile.
    O(1) per paddle, at **save time** (not view time).
  - *Full re-distill* every K paddles (e.g. 10) or on demand: read all history
    summaries once and rebuild fresh to prevent drift. Amortized.
- **Fed** into the per-paddle insight prompt at a constant ~200 tokens — this is
  what buys **unbounded memory at bounded per-insight cost**.
- Guardrail: built only from distilled summaries + notes + prior insights, never
  raw GPS points.

*"You mentioned wanting a cleaner catch last month — today's higher
distance-per-stroke suggests it's landing."*

### Layer 3 — Relevance retrieval (≈120 tokens, no extra LLM call)

For THIS paddle, select the few most **relevant** past paddles instead of the
chronological last-8:

- Same **venue** (start point near this paddle's start), same **boat class**,
  similar **distance/effort**. A light path-similarity signal can reuse the
  corridor/coverage helpers from `similar.ts` for "same water."
- Feed the top 2–3 as compact lines, relevance-ranked. More meaningful than
  recency ("your last 3 efforts on this stretch: …").

## Model bump — Claude Haiku / Amazon Nova on Bedrock

The narration model is the other lever for "thoughtful prose." Prod runs
**Mixtral 8x7b** (a small model). Step up to **Claude Haiku** (or **Nova Lite**)
for the narration only.

- **eu-west-1 = inference-profile only** for Claude/Nova → set `LLM_MODEL` to an
  `eu.anthropic.claude-haiku-…` / `eu.amazon.nova-lite-…` **inference-profile id**.
- **IAM is already in place** — `infra/lib/att-stack.ts` grants `bedrock:InvokeModel`
  on both `foundation-model/*` and `inference-profile/*` ARNs. The only infra
  change is the `LLM_MODEL` string; Claude models may also need **model access
  enabled** once in the Bedrock console (Mixtral was ON_DEMAND / auto-enable).
- **Billing:** Bedrock bills the AWS account, **NOT** the Anthropic quota — fully
  consistent with the existing "never the Anthropic quota in prod" guardrail. The
  `anthropic` backend stays local-only.
- **Adapter:** `BedrockInsighter` already folds `system` into the user turn (for
  Mixtral); that still works for Claude/Nova, so no adapter change is required
  (optionally use a proper `system` field for Claude later).
- **Bench before pinning:** freeze ~5 real paddles as fixtures, run Mixtral vs
  Haiku vs Nova over them, print output + tokens + est. $ + latency, eyeball
  quality, pin the winner via `LLM_MODEL`.

## Prompt / voice (the "interesting" lever)

A model can't be relatable with nothing personal to say — Layers 1–2 supply the
material; the prompt supplies the delivery. Revised system prompt: a specific,
warm coach persona; weave the profile + aggregates in naturally; reference the
paddler's journey + goals; vary structure; ban generic praise and filler; stay
concrete. Grounding rule unchanged (only distilled facts, never raw points).

## Token + cost model

| Call | When | Model | Rough in-tokens |
|---|---|---|---|
| Per-paddle insight | once per paddle (stored; re-view is free) | Haiku/Nova | ~450–600 (fact sheet + aggregates + profile + retrieval) |
| Profile incremental update | once per new saved paddle | Haiku/Nova | ~400 (old profile + new paddle) |
| Profile full re-distill | every ~10 paddles / on demand | Haiku/Nova | ~history summaries once |

Net: ~2 small LLM calls per new paddle, **bounded regardless of history length**
(vs a naive "feed all paddles" that is 3000+ tokens and grows forever). Aggregates
+ retrieval add no LLM calls. Insight is still generated once and stored.

## Data model

- New `AthleteProfile` at `analysis/{userId}/profile.json`.
- **No change** to `AnalysisSession` — aggregates + retrieval derive from the
  existing saved sessions.

## Phasing (build order)

- **P1 — aggregates + voice** (`history-stats.ts` + prompt integration + revised
  persona), on the CURRENT model. Unit-tested. Ship; judge the lift.
- **P2 — model bump** to Haiku/Nova (bench → `LLM_MODEL` → verify; enable model
  access if needed).
- **P3 — athlete profile** (store + incremental update at save time + full
  re-distill + prompt integration).
- **P4 — relevance retrieval** (venue/boat/effort ranking; optional path-similarity).

## Open questions / risks

- **Profile drift** — how often to full-re-distill vs incremental-merge; measure.
- **Cold start** — < 3 paddles: skip the profile, rely on aggregates (which
  degrade gracefully to "first session" messaging like today).
- **Save-time latency** — the profile update adds an LLM call when saving a
  paddle; do it after the response is returned (fire-and-forget / async) so it
  never blocks the analysis UI.
- **Privacy** — profile is per-user and private; never cross-user (same rule as
  sessions/profiles in att).
- **Bench + model access** — confirm the chosen Claude/Nova profile is accessible
  in eu-west-1 before pinning.
- **Determinism in tests** — aggregates are pure and asserted directly; the LLM
  layers stay mocked in tests (no network/cost), as today.

## Later (deferred)

- Cross-paddle "season report" narrative (monthly digest).
- Let the paddler set an explicit goal that the coach tracks over time.
