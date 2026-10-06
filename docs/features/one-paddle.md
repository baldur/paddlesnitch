# One paddle

📋 **Spec, 2026-10-06.** Phases 1–4 built (2026-10-06). This is Phase G of the 2026-09 audit
("one paddle with extras"), made concrete. The owner's decisions are recorded
under **Decisions**.

## The problem

A paddle and a tracker recording are two different things on the site today,
in two places, holding different information about the same outing.

| | Tracker recording (`/devices/[id]`) | Paddle (`/paddles/[id]`) |
|---|---|---|
| How it appears | By itself, when the tracker uploads | By hand: ADD A PADDLE → TRACKER tab → pick it |
| Stroke rate | One figure for the session (60 s windows every 30 s) | **None.** It is analysed from the GPS columns only |
| Boat motion | Roll, pitch, evenness, charts | **None** |
| Efforts, rests, splits, map, summary | None | Yes |

So the richer page lacks what the tracker is for, and someone with a tracker has
to know to "add" their own recording.

## What it becomes

- **One thing: a paddle.** Whatever it came from (a file, Strava, a time trial
  or a tracker), it is the same page in the same list.
- **Extras appear on the paddle when the data exists.** Boat motion (roll,
  pitch, evenness and the charts) is a section of the paddle page, with
  TECHNICAL DETAILS under it. A paddle from a watch simply doesn't have it.
- **Stroke rate through the whole paddle** from the tracker's motion data,
  written onto the GPS points. The analysis already uses per-point stroke rate
  whenever a file carries it (SpeedCoach, FIT), so it lights up everywhere with
  no change to the engine: stroke rate per effort and per split, distance per
  stroke, and stroke rate on the map.
- **Devices is about the hardware**: firmware, last seen, battery, crashes,
  Bluetooth, and the tracker's paddles as links into Paddles.
- **The same outing from two sources** (the tracker and a watch on Strava) stays
  two paddles, linked as **the same outing**, with a comparison view. Useful now
  for checking the tracker against a known device, and later for people who
  carry both.

## Decisions (owner, 2026-10-06)

1. A tracker recording becomes a paddle **automatically** when it arrives (as
   Strava auto-import does). The audit already approved one AI-summary call per
   tracker upload (2026-09-28).
2. Two sources for one outing: **two paddles, compared**, not merged into one.
3. The recording pages under Devices become **links to the paddle**; their
   content moves into the paddle page.
4. Order: **stroke rate first**, then automatic paddles, then the one page,
   then the comparison.

## Phase 1: stroke rate through the whole paddle

**Today:** `deriveCadence` (`@paddlesnitch/timing/cadence`) uses 60 s windows
every 30 s, wholly inside moving stretches, and reports one median. It is only
called by the device recording route, for the device page.

**Change:**

- `strokeRateSeries(motionCsv, { movingRanges })` in `timing/cadence`: the same
  method as the session figure on **15 s windows every 5 s** (measured: see
  "Stroke rate through the paddle" in `device-data.md`). Rests and unclear
  stretches give **no value**, never a zero or a guess.
- **Left/right is decided once per paddle**, by majority: on short windows the
  half-lag test flips while the cycle rate holds, and each flip read as half
  the rate on real paddles. **Single-sided paddles (canoe, SUP) get no series**
  until a real recording calibrates them, and nor do recordings with fewer than
  6 usable windows.
- **Joining it to the track.** The motion file has only `ms` (the tracker's
  millis clock). The track has both `ms` and the GPS `timestamp`, so the mapping
  is exact: give each track point the stroke rate of the window whose centre is
  nearest its `ms`, within half a step, else none.
- `loadDeviceSessionTrack` attaches it when the recording has motion data, so
  the paddle analysis receives `TrackPoint.strokeRate` like any SpeedCoach file.
  `doubleStrokeRate` stays false for tracker paddles: the series is already
  strokes per minute, and picking a kayak boat class no longer doubles a
  tracker paddle (it did, for files that count one side).
- **Existing tracker paddles:** `scripts/backfill-tracker-stroke-rate.ts`
  re-analyses them (dry run by default). It keeps the diary note, boat class and
  written summary (phase 2 rewrites summaries as motion data arrives) and turns
  doubling off.

**Tests:** synthetic signals of known rate (steady, a rest in the middle, a
rate change, single-sided pulses for canoe or SUP); the `ms` mapping; no value
outside moving stretches; a tracker paddle's efforts get a stroke rate.

## Phase 2: tracker recordings become paddles automatically

**Built** (`@paddlesnitch/analysis/tracker-paddle`, scheduled from
`lib/session-upload.ts` by `lib/tracker-paddles.ts`).

- When a recording is accepted, by either upload route (the tracker's own over
  WiFi, or the owner's browser over Bluetooth), `paddleForRecording` runs after
  the response (`after()`): it makes the paddle through the same `analyseAndSave`
  as every other source.
- **The motion file arrives after the track**, sometimes within a second. The
  paddle is made when the track lands and **re-analysed once when its motion
  file lands** (`reanalyseAndSave`): it gains stroke rate and a new summary, and
  keeps the diary note, boat class and share link. A recording whose motion
  never comes keeps its GPS-only analysis.
- **One paddle per recording, even when the two jobs race:** a recording's
  paddle has a fixed id (`t-<recording id>`), so both jobs write the same paddle;
  and the GPS-only job doesn't save if the motion data landed while it was
  writing the summary, so it can't overwrite the fuller paddle. A paddle added by
  hand before this (any id) is found by its recording and updated in place.
- **Only when the boat moved at least 500 m** (`MIN_PADDLE_METRES`, the
  movement-gated distance). Measured on every recording in production
  (2026-10-06): real paddles moved 1.6 km or more, desk tests, bench logs and
  trackers switched on in the car 154 m at most. Recordings with no usable GPS
  were already refused at upload.
- **No setting to turn it off** at first: it's your own tracker, and Strava has
  one only because people use Strava for other sports. Add one if anyone asks.
- **Existing recordings:** `scripts/create-tracker-paddles.ts [--apply]
  [--skip=<file>,…]` makes the missing ones (dry run by default). Run with the
  production AI settings, or new summaries are the plain ones.
- **ADD A PADDLE → TRACKER** still works and opens the existing paddle (the
  duplicate check); phase 3 removes the need for it.

## Phase 3: one paddle page

**Built.**

- A tracker paddle has a **BOAT MOTION** button (beside SHARE, DIARY, BOAT) that
  opens `/paddles/[id]/motion`: the roll, pitch and evenness figures, the three
  charts and the reading notes (`components/devices/BoatMotion.tsx`), the
  paddle's own stroke rate, and the recording's TECHNICAL DETAILS collapsed
  under them (`components/devices/TechnicalDetails.tsx`). A side page rather
  than a panel: the paddle view is a full-screen map, and the charts need the
  width. "← PADDLE" goes back.
- `/devices/[deviceId]` links each recording that became a paddle to it
  (tRPC `paddles.byRecording`: recording id → paddle id). A recording that
  didn't is listed with its reason ("the boat barely moved") and keeps its
  expandable details, so nothing disappears. The tracker's hardware (firmware,
  last seen, crashes, Bluetooth, REMOVE TRACKER) stays.
- `/devices/[deviceId]/[sessionId]` **redirects to the paddle's BOAT MOTION**
  when the recording is a paddle; otherwise it still shows the recording's boat
  motion. A temporary redirect, not 308: a paddle can be deleted, and a cached
  308 would keep sending people to it.
- **Not done:** boat motion on the shared view (`/paddles/shared/…`). The
  recording read is owner-only; sharing it needs a public read of the motion
  figures. Left for later.

## Phase 4: the same outing from two sources

**Built** (`@paddlesnitch/analysis/same-outing`, tRPC `paddles.sameOuting` and
`paddles.compareOuting`, `components/analysis/SameOuting.tsx`).

- **Detecting it, when a paddle is opened** (not stored, so no backfill): the
  user's other paddles that overlap it in time by at least half the shorter one
  (from the summaries already listed), then, for those few only, a track check:
  **at the same clock moments** (every 10 s), at least 70% of positions within
  40 m of each other. Comparing by clock rather than "near the other route"
  measures what QA wants (how far apart two devices put you at once) and doesn't
  match an out-and-back to itself.
- **On the paddle:** "ALSO RECORDED BY STRAVA →" (or BY THE TRACKER), linking to
  the comparison.
- **The comparison** (`/paddles/compare?a=&b=`) gains a SAME OUTING section when
  the two are one outing: both tracks over each other, how far apart they were
  (usually, and at worst: the 95th percentile), and stroke rate from each by
  clock minute (a watch counting one side reads about half; the page says so).
- **Measured on the owner's paddles (2026-10-06):** three tracker paddles match
  their Strava copies (apart usually 3, 4 and 22 m) and nothing else matches.
- The duplicate check (`paddleFingerprint`) is unchanged: it catches the same
  file twice, which is a different thing from two devices on one outing.

## Not in this spec

- Merging two sources into one paddle (decided against for now; the comparison
  is the step before it).
- Stroke rate computed on the tracker itself (a later phase of
  `tracker-bluetooth-sync.md`). The server stays the source of truth either way.
- Keeping the raw file for non-tracker paddles (audit Phase G, separate CR).

## Risks

- **Stroke rate trust.** A wrong number on every effort is worse than no number.
  Hence the confidence floor and gaps over guesses. The single-sided (canoe, SUP)
  case is still only tested on synthetic data (`device-data.md` calibration
  debt); flag it on the page as less certain until a real recording confirms it.
- **One summary per paddle, written twice** (track, then motion). That's two AI
  calls for one outing. If cost matters, delay the summary until the motion file
  lands or a few minutes pass.
- **Backfills touch every tracker user's paddles.** Both scripts are dry run by
  default and print what they would change.
