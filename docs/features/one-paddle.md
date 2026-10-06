# One paddle

📋 **Spec, 2026-10-06. Not built.** This is Phase G of the 2026-09 audit
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
  method (highest-variance gyro axis → autocorrelation → best local maximum →
  parabolic sub-sample → the alternating-stroke ratio test) on **shorter windows
  with a short step**, about 15 s every 5 s. Fifteen seconds is about 14 strokes
  at 58 spm, enough for the autocorrelation. Each window gives a stroke rate and
  a confidence. Windows below the confidence floor, or outside moving stretches,
  give **no value** rather than a guess (rests show as gaps, not zeros).
- **Window and step are measured, not chosen.** Before settling, sweep both
  against the 13 Sep reference capture as the 10 Hz decision was
  (`device-data.md`): the session median must stay within ~1% of the 60 s
  figure (58.0 spm), and the series must show the known efforts and rests.
  Record the sweep in `device-data.md`.
- **Joining it to the track.** The motion file has only `ms` (the tracker's
  millis clock). The track has both `ms` and the GPS `timestamp`, so the mapping
  is exact: give each track point the stroke rate of the window whose centre is
  nearest its `ms`, within half a step, else none.
- `loadDeviceSessionTrack` attaches it when the recording has motion data, so
  the paddle analysis receives `TrackPoint.strokeRate` like any SpeedCoach file.
  `doubleStrokeRate` stays false for tracker paddles: the series is already
  strokes per minute.
- **Existing tracker paddles:** a script re-analyses them (dry run by default,
  like `backfill-device-distance.ts`). Re-analysis keeps the diary note and boat
  class, and replaces the summary.

**Tests:** synthetic signals of known rate (steady, a rest in the middle, a
rate change, single-sided pulses for canoe or SUP); the `ms` mapping; no value
outside moving stretches; a tracker paddle's efforts get a stroke rate.

## Phase 2: tracker recordings become paddles automatically

- When a recording is accepted (`lib/session-upload.ts`, shared by the WiFi
  and Bluetooth routes), schedule `analyseAndSave` with
  `source: { type: 'device', deviceId, deviceSessionId }` after the response
  (`after()`), as the Strava webhook does.
- **The motion file arrives after the track** (a separate upload, sometimes
  minutes later). So the paddle is created when the track lands, and
  **re-analysed once when its motion file lands**, gaining stroke rate. A
  recording whose motion never comes keeps its GPS-only analysis.
- **One paddle per recording:** look up by `deviceSessionId` before creating,
  not only by the fingerprint (a re-analysis must update the paddle, not
  duplicate it). Picking the recording by hand in ADD A PADDLE opens the same
  paddle.
- Only usable recordings: those `parseTrace` accepts. Bench logs and indoor
  recordings with no GPS don't become paddles (they already return 422).
- **No setting to turn it off** at first: it's your own tracker, and Strava has
  one only because people use Strava for other sports. Add one if anyone asks.
- **Existing recordings:** a script creates their paddles (dry run by default),
  skipping any that already have one.

## Phase 3: one paddle page

- The paddle page gets a **BOAT MOTION** section when the paddle came from a
  tracker with motion data: the three figures (roll, pitch, evenness) and the
  rowing/kayak note, then the charts from `/devices/[id]/[sessionId]`.
  TECHNICAL DETAILS (rows, fix, capture, satellites, columns, first rows) sits
  under it, collapsed.
- `/devices/[deviceId]` lists that tracker's **paddles**, each linking to
  `/paddles/[id]`, and keeps the hardware: firmware, last seen, crashes,
  Bluetooth, REMOVE TRACKER. A recording that couldn't become a paddle (no GPS)
  is listed plainly with its reason, so nothing disappears.
- `/devices/[deviceId]/[sessionId]` **308s to the paddle**.
- The shared view of a paddle (`/paddles/shared/…`) shows boat motion too: it's
  numbers about the boat, not private text. Technical details stay owner-only.

## Phase 4: the same outing from two sources

- **Detecting it:** two of your paddles whose time ranges overlap by at least
  half the shorter one, and whose tracks stay within the corridor already used
  for sections (`similar.ts`, 40 m) over most of the overlap. Computed when a
  paddle is saved, both ways, and stored as a link (`sameOutingAs: [id]`) on
  each paddle.
- **On the paddle page:** "Also recorded by Strava" (or by the tracker), linking
  to the comparison.
- **The comparison** (`/paddles/compare?a=&b=`, the existing page, gaining a
  mode when the two are the same outing):
  - both tracks on one map
  - distance, time, average speed and average stroke rate side by side, with the
    difference
  - stroke rate from each source over the same clock, where both have it
  - how far apart the tracks are (median and worst, in metres)

  For QA this answers "does the tracker agree with my watch or SpeedCoach?"
  directly.
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
