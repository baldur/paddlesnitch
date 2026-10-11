# Paddles from motion data when the GPS fails (#414)

🚧 **Options for the owner, 2026-10-11. Not built beyond step 1.**

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

**B. A paddle without a map (recommended next).** The recording becomes a
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

## Decision needed

- B, B+C, or stay at A?
- Should a motion-only paddle count towards streaks and the paddle count?
