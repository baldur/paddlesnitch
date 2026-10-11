# Paddles from motion data when the GPS fails (#414)

✅ **B built, 2026-10-11** (the owner chose B without C, and yes to counting
towards streaks and the paddle count). C (estimated distance) and D (fix at the
source) are not part of it. See "What was built" at the end.

## Where we are

On 2026-10-11 a 1 h 49 min paddle got no paddle: the GPS lost the sky 30 s
after setting off. The tracker kept recording motion the whole time (10 Hz,
the sidecar).

What exists today:

- The recording's page says **why** (#408) and, from the motion data, **how
  long you paddled and about how many strokes** (step 1, #444): "From the
  motion data: about 1 h 41 min paddling, about 5,200 strokes at 52 spm."
- BOAT MOTION shows stroke rate and roll, pitch and evenness for any recording
  with motion data.
- It does **not** appear in Paddles, the weekly chart, streaks or totals.

## What the motion data can and can't tell

| | From motion alone | Notes |
|---|---|---|
| Time paddling | yes | windows with a clear stroke (60 s, every 30 s) |
| Rests | yes | gaps between those windows |
| Stroke rate, through the paddle | yes | per window |
| Strokes | about | rate × time |
| Boat motion (roll, pitch, evenness) | yes | as BOAT MOTION today |
| Distance | **no** | only as an estimate (see C) |
| Speed, pace /500 | **no** | needs distance over time |
| Route, map | **no** | the part before the GPS was lost, at most |
| Wind and river flow | partly | the start position is known if the GPS had a fix at first |

The site's rule applies: don't claim what the data can't show.

## Options

**A. Leave it on the recording page (done, step 1).** No change to what a
paddle is. The paddle is still missing from your log and your weekly time.

**B. A paddle without a map (chosen; built 2026-10-11).** The recording becomes a
paddle marked "no GPS". It has:

- date, time paddling, rests, stroke rate through the paddle, strokes, boat
  motion, and the AI summary written from those;
- the part of the route recorded before the GPS was lost, if any.

What it counts towards:

- **counts:** the paddle count, time on the water, and streaks;
- **adds nothing to:** km totals and the weekly km chart (shown "—", not 0);
- **not offered for:** compare, sections, similar paddles, or trials;
- **in the list:** shown with a small "no GPS" tag instead of a route
  thumbnail.

Work involved:

- an `AnalysisSession` with no `points`, or a new `kind: 'motion'`;
- every place that reads points or distance has to cope with it: the list,
  totals, weekly km, compare pickers, sections, similar, the coach profile and
  history stats, and the share card;
- the tracker pipeline (`tracker-paddle.ts`) makes one when `noPaddleReason`
  says the GPS failed and motion shows ≥ 10 minutes of paddling.

About 2–3 PRs, with tests for each of those places.

**C. B plus an estimated distance.** Strokes × your usual distance per stroke
for that boat, from your recent paddles that had GPS. It would be labelled
"about 14 km (estimated from 5,200 strokes)", and you could choose whether it
counts in km totals. The risk: distance per stroke varies with conditions and
effort (±15% is typical), so a wrong number would sit in your log looking
real. If we do this, keep it out of totals by default.

**D. Fix it at the source.** The GPS losing the sky is the real problem:

- the antenna, or where the tracker sits in the boat (owner task #418, the
  sky test);
- firmware that warns on the screen when the fix is lost while recording
  (#417 territory).

Worth doing whatever we pick here.

## Recommendation

B, without C to start with. Your log gets the paddle (time, strokes, stroke
rate, boat motion) and nothing invented. Add C later only if you want km in
totals and accept "about". Do D in any case.

## Decision (2026-10-11)

- **B**, without C.
- A motion-only paddle **counts** towards streaks, the paddle count and time
  on the water.

## What was built

- **When:** `paddleForRecording` (`tracker-paddle.ts`) would skip the
  recording (no usable track, or the boat moved < 500 m), `noPaddleReason`
  says `gps_lost` or `no_gps`, and the motion data shows ≥ 10 minutes of
  paddling (`MIN_MOTION_PADDLE_S`). The cadence is worked out as on the
  recording's page (`deriveCadence` with `movingRangesFromTrack`), so the two
  agree. Made by the call after the motion file lands; same fixed id
  `t-<recordingId>`. Everything else is unchanged: a recording that lost the
  GPS but still moved ≥ 500 m gets a normal paddle from its partial track.
- **Model:** one marker, `result.noGps = { reason, strokes }` (summaries carry
  `noGps: true`). `durationS` = time paddling, `avgSR` = median stroke rate,
  `stops` = gaps ≥ 60 s between stroke windows, `points` = only the route
  from before the GPS was lost, `distanceKm` and speeds 0. Everything tests
  it with `isMotionOnly()` (`@paddlesnitch/core/paddles`), never by distance.
- **Where it shows:** the list (a NO GPS tag instead of the route, "—" for
  distance, no compare tick box), its own page (PADDLING, DISTANCE —, STROKE
  RATE, STROKES about, rests, the GPS line, BOAT MOTION; no map, chart, pace,
  compare or section picking), the share card and title (no route, distance
  or pace), the plain and AI summaries and the coach profile (no distance or
  pace).
- **Left out of:** km totals, the weekly km chart, month km, "longest";
  compare, same outing, sections, similar paddles (route squares are empty).
- **Not covered:** a recording with no GPS row at all is still refused at
  upload (422), so it never gets this far.
