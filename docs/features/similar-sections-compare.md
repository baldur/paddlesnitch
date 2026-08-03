# Feature spec: Compare similar sections across paddles

**Status:** 💭 design (2026-07-20). Living design record — build after review.
**Owners:** Baldur (product), Claude (implementation).
**App:** `apps/analysis` (the analyse stack). Extends the existing `/analyse/compare` flow.

## Why

The current compare puts two *whole* paddles side by side — but a 65-min tour and a
20-min blast aren't comparable at the session level. What a paddler actually wants is:
*"On **this** stretch of river — the bit I care about — how do my other paddles that
covered the same water stack up?"* Same stretch, same conditions of geography → a fair
fight, and the place where training progress (or a good/bad day) actually shows.

The enabling fact: **every saved paddle already stores its full track** as
`result.points: AnalysisPoint[]` (`{ t, lat, lng, speed, sr, dps }`). So this is a pure
analysis-and-UI feature — **no reprocessing, no schema change** to session storage.

## The core model: an ad-hoc race between two lines

The comparison is framed as a **virtual race**, not a fuzzy "how similar are these
tracks." You pick two points on a paddle; we turn them into a **start line** and a
**finish line** across the river (two gates). A paddle "counts" if it crosses the start
line and then the finish line **in the same direction**; its result is the **elapsed
time between those two crossings** — exactly as if every one of your paddles had raced
the same course. This is precisely ATT's course-timing model, so we **reuse ATT's
line-crossing machinery** (`processTrace`, `segmentIntersect`, 500 m splits from
`@paddlesnitch/timing/geo`) rather than build new alignment math.

## The flow (from the product ask)

1. **Select** — on a saved paddle, click **two points** on the map (snap each to the
   nearest track point). We derive a **start gate** at the first and a **finish gate**
   at the second — each a short line **perpendicular to the local track heading**
   (a line across the river). The required crossing **direction** is taken from how the
   source paddle crossed each gate.
2. **Find** — run every one of the user's **own** other paddles through this ad-hoc
   course: does it cross the start gate, then the finish gate, in the **same direction**?
3. **List** — the matches ("racers"), in **reverse chronological order** (newest first):
   date, its elapsed time over the section, its pace/500.
4. **Compare** — pick **one or more** → a race-style comparison: elapsed time + pace/500
   over the section for each, deltas, and a map overlay of the racers between the two
   gates.

Scoped to the **signed-in user's own** paddles (sessions are private per user;
"who else was fast on this water" is a separate, social follow-up — see Deferred).

## Settled decisions (2026-07-20)

1. **Match = crosses both gates in order, same direction.** No reversed-direction
   comparisons — a paddle going the other way through the same water is not a match.
2. **Result = a virtual race between two lines** (start line → finish line), reusing
   ATT's line-crossing timing. Best-effort: if a paddle crosses the gates more than once
   (e.g. an out-and-back), take the **fastest valid** start→finish pair, like ATT.
3. **Compare axis = distance along the section, both paddles zeroed at the start line.**
   Every racer's clock and distance start at 0 at the start gate; **pace/500 is
   recalculated for that section only** (not the whole paddle).
4. **List order = reverse chronological** (most recent paddle first).
5. **Thresholds start as heuristics, with a hook to get smarter later.** The gate-crossing
   test is exact; the *quality* filters (how close the in-between path must stay, how
   long a valid section must be) begin as simple constants and produce a **candidate score**
   that a model can later rank/refine to surface "great" comparisons (see Thresholds).

## Algorithm (deterministic core — no LLM in the timing)

All geometry in `[lat, lng]`; reuse `haversine`, `segmentIntersect`, `processTrace`, and
500 m split logic from `@paddlesnitch/timing/geo`. New pure module:
`apps/analysis/src/lib/similar.ts`.

### 1. Selection → two gates
`gatesFromSelection(points, aIdx, bIdx) → { startLine, finishLine, dir, refPath }`:
- `startLine` = a segment of length `GATE_M` (~60 m) centred on point A, **perpendicular
  to the source track's local heading** at A (a line across the river). `finishLine` the
  same at B.
- `dir` = the crossing sign (`rxsSign`, ATT's convention) with which the **source** paddle
  crosses each gate → the direction every candidate must match.
- `refPath` = the source track slice A→B (used only for the path-similarity score + the
  section distance).

This is literally "spin up an ATT `point_to_point` course from two map clicks."

### 2. Match a candidate (reuse ATT line-crossing)
Run the candidate's points through the same start/finish-line matcher ATT uses
(`processTrace`-style): find the **fastest** pair where the track crosses `startLine`
then later `finishLine`, **both in direction `dir`**. If none → not a match.

### 3. Quality filter → candidate score (heuristic now, model-ready later)
Crossing both gates isn't quite enough (a different channel could clip both lines). For a
matched pair, compute a **path-similarity score**: the fraction of the candidate's
between-crossings path that stays within `CORRIDOR_M` of `refPath`. Keep it if
`score ≥ COVERAGE_MIN`. This score (plus section length, gap in conditions, recency) is
exactly the signal we can later feed a model to **rank the best candidates to review** —
the heuristic is the v1, the score is the seam for the smarter version.

### 4. Race stats (per racer, source included)
- **elapsed** = t(finish crossing) − t(start crossing).
- **section distance** = along-track distance between the crossings.
- **pace/500 recalculated for the section**; **500 m splits within the section** (reuse
  ATT's split walk, restarted at the start line).
- avg SR / dps over the `[start, finish]` window.
- Everything **zeroed at the start line** so racers line up head-to-head from 0.

### Thresholds (tune on real traces — heuristic first)
| Const | Value | Meaning |
|---|---|---|
| `GATE_M` | 120 m | length of the derived start/finish lines across the river |
| `CORRIDOR_M` | 40 m | max distance from `refPath` for the path-similarity score |
| `COVERAGE_MIN` | 0.6 | min path-similarity score to keep a gate-matched candidate |
| `MIN_SECTION_M` | 200 m | shortest selectable section (matching is noisy below this) |

Deliberately **broad** (widened from the first-guess 60 m / 25 m / 0.75 after
reviewing real traces) so a paddle on a slightly different line — a different
river lane, GPS drift — still crosses the gates and registers as a candidate; the
path-similarity score then rejects genuinely different water.

First guesses. The gate-crossing test is exact and robust; these *quality* constants
**need calibration on two real overlapping traces**, and are the numbers a future model
can replace with a learned/prompted ranking.

## Data model

**No change to `AnalysisSession` storage.** Everything derives from the already-saved
`result.points`. New *transient* types in `similar.ts`:

```ts
type Gate    = [[number, number], [number, number]]   // ATT Line: two [lat,lng]
type Racer   = { sessionId: string; paddledAt: string; source: AnalysisSource
                 elapsedS: number; sectionM: number; cruiseSpeed: number
                 avgSR: number | null; avgDps: number | null
                 splits: { distM: number; elapsedS: number }[]     // per-500 within section
                 score: number                                     // path-similarity (0..1)
                 trackSegment: [number, number][] }                // start→finish path, for the overlay
type RaceCompare = { startLine: Gate; finishLine: Gate; sectionM: number; racers: Racer[] }
```

## API (analyse stack)

Server-side (don't ship every paddle's points to the browser); own sessions only via
`getAuthUser`:

- `POST /analyse/api/analyse/similar` — body `{ sourceId, aIdx, bIdx }` →
  `{ startLine, finishLine, sectionM, matches: Racer[] }` (matches newest-first; source
  excluded from the list). Loads the user's full sessions, derives the gates from
  `sourceId`, races every other paddle, returns the ones that cross both gates same-
  direction and clear the quality score.
- `POST /analyse/api/analyse/similar/compare` — body `{ sourceId, aIdx, bIdx, sessionIds[] }`
  → `{ race: RaceCompare }` for the chosen subset (**source always included** as a racer).
  Splits the heavier per-500 + trackSegment work out of the list call.

## UI

- **Select** (on `/analyse/[id]`, the saved-paddle map — `AnalysisView`/`AnalysisMap`):
  a "RACE A SECTION" mode. First map click on the track drops the **start line**
  (snapped, drawn perpendicular across the river, ATT green); second drops the **finish
  line** (ATT red). Readout: `section: 1.4 km`. `[ FIND MY OTHER PADDLES → ]` POSTs to
  `/similar`.
- **List**: racers as rows, newest first — date · elapsed · pace/500 · (later: score
  badge). Multi-select; `[ RACE SELECTED → ]`.
- **Compare** (`/analyse/compare/section`): a race board — each racer's elapsed +
  pace/500 over the section, delta vs the source, the **500 m section splits**, a
  per-racer **CONDITIONS** row (wind + river flow that day), and a **map overlay** of the
  racers' `trackSegment`s between the two gates (gates drawn as lines). Reuses the dark
  compare styling and ATT's leaderboard-map idea.

### Analyse this section (single-paddle focus)

The same two-click selection also drives an **ANALYSE THIS SECTION** action (next to
FIND MY OTHER PADDLES) that narrates *just that stretch of the current paddle* — no
comparison needed. `sectionStats(source, aIdx, bIdx)` (in `similar.ts`) computes stats
over the **literal slice** `points[lo..hi]` (not gate-racing, so an out-and-back reflects
exactly what was picked): distance, elapsed, pace/500, avg SR + dist/stroke (respecting
the current SUP→kayak doubling), per-500 splits, an SR trend, and a **moving-speed**
first-half vs second-half read (held / built / faded — moving speed so a rest inside the
section doesn't distort it) + the day's conditions. `POST /analyse/api/analyse/section-insight`
feeds that to `generateSectionInsight` (LLM) with a deterministic `buildSectionInsight`
fallback; the narrative shows inline in the section panel.

### Conditions + coach narrative (LLM)

Each racer carries the paddle's whole-session **conditions** (`result.conditions` — wind
km/h + direction, river flow m³/s + station) onto the board. Above the results, a short
**coach narrative** reasons about the differences AND *whether wind/flow plausibly
explain them* (a quicker time with more downstream flow / a tailwind is discounted; a
quicker time into a headwind is credited). Generated server-side in the compare route via
the analysis app's existing `makeInsighter()` (Ollama local / Bedrock prod), with a
**deterministic template** (`buildRaceInsight`) fallback so the board is never blank and
never depends on a backend. The LLM sees only the compact per-racer summary (times, pace,
SR, wind, flow) — never raw points. Lives in `src/lib/llm.ts`
(`generateRaceInsight` / `buildRaceInsight`); only runs with ≥2 efforts.

## Phases

- **P1 — timing engine + API.** `similar.ts` (`gatesFromSelection`, gate-matching via
  ATT's line-crossing, per-section splits, quality score) + the two endpoints.
  Unit-tested against two of Baldur's real overlapping traces (same direction). **Ship no
  UI until the match list + times look right.**
- **P2 — selection UI + match list.** Race-a-section mode on the saved-paddle map (two
  gate lines) + the results list with multi-select.
- **P3 — race compare view.** Elapsed + pace/500 + section splits table with deltas; then
  the coloured multi-track map overlay between the gates.

## Edge cases
- **No matches** → empty-state ("none of your other paddles raced this stretch").
- **Wrong direction** → not a match (excluded), by decision.
- **Multiple valid crossings** (out-and-back) → take the **fastest** start→finish pair
  (ATT best-effort).
- **Crosses both gates via a different channel** → excluded by the path-similarity score.
- **Selection too short** (< `MIN_SECTION_M`) → block with a hint.
- **Source == candidate** → the source is the reference racer, never in the match list.
- **No stroke-rate data** → SR/dps columns show `—`; elapsed + pace still work.

## Testing
- Pure `similar.ts` unit tests: gate derivation (perpendicular, correct direction sign),
  gate-crossing match, fastest-pair selection, per-section splits, quality-score
  boundaries. Fixtures = two real same-direction overlapping traces, a reversed one (must
  NOT match), and a non-overlapping one (must NOT match).
- Endpoint tests: own-sessions-only scoping, source-excluded from list, newest-first order.
- These run in the **analysis app's own vitest** (note: CI's `pnpm test` is att-only
  today — the analysis suite isn't wired into CI yet; flag when we add these).

## Open questions
- [ ] **Gate length / perpendicular heading** on sharp bends — a fixed `GATE_M` across a
      tight meander could clip the wrong bit of track; may need to shorten near high
      curvature. Verify on real data.
- [ ] **Bin/split resolution on short sections** — a 300 m section only has 0 full 500 m
      splits; show a single section split under 500 m (as the leaderboard already does).

## Deferred
- **Model-ranked candidates** — replace/augment the heuristic quality score with a learned
  or prompted ranking to surface the *best* comparisons (the `score` seam is built for it).
- **Cross-user** "who else raced this stretch and how fast" (leaderboard-style, social) —
  needs a visibility model; out of scope here.
- **Auto-suggested / saved stretches** — detect or name a stretch you race often and
  re-compare over time.
