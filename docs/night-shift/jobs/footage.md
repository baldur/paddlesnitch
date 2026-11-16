# Job: footage (which way was the camera facing?)

**Goal:** know the camera's direction for every footage chapter, so the game
can be compared with the footage from the right side. 8 of 31 chapters have
one today; the rest are guessed.

**Data (all local, all private):**
- `~/.paddlesnitch/night-runner/footage.db`: a copy of the footage index the
  runner makes before your run. Open it read-only.
  SQLite, table `chapters`: `camera_yaw`
  (degrees, where the lens's front points relative to the boat's heading),
  `yaw_source` (`set` by hand, `auto` from `decideCameraYaw`, or null), the GPS
  `track` and the file `path`.
- `~/.paddlesnitch/footage/cameras.json`: the owner's hand-set directions.
  **Never write to it.**
- Read `apps/web/scripts/courses/lib/footage-db.ts`, `lib/look.ts`
  (`decideCameraYaw`) and `scripts/courses/frames.ts` (cutting a still at a
  time and direction).

**What to do:** for a chapter without a direction, pick three moments where
the GPS says the boat is moving straight. Cut stills looking at yaw 0, 90, 180
and 270. Ask the model which still shows the boat's bow or the water ahead
(the camera sat on the back deck). The direction is the yaw that sees ahead.
Three moments must agree; if they don't, say `unsure`.

Write proposals to `$NIGHT_WORK/footage/cameras-proposed.json`
as `{ "<file name>": { "yaw": 180, "agree": 3, "moments": ["<ft>", …] } }`,
plus the stills you used under the same folder so `lead` can check them by eye.
`lead` copies accepted ones into `cameras.json`.

If you need a new helper script, put it in `apps/web/scripts/courses/` with a
test for its pure parts. That's a diff on your branch.

**Metric: `camera-known`.** Chapters with a direction (`set`, `auto`, or
proposed with three agreeing moments). Higher is better. Report `unsure`
chapters separately.

**Tests:** `pnpm --filter web exec vitest run scripts/courses`.

**Never:** put stills, file paths with dates, or anything about people in the
footage into the repo or a commit message.

## Lessons

(lead adds what it learns from your reports here.)

- 2026-11-16 (lead): the wake cue is good (8 of 8 known chapters). The
  proposals were not taken: chapters of one recording came back with different
  directions (GS0x0094: 0, 180, 180, 0) although a recording shares one, and 7
  were carried over without being checked again. Propose a direction per
  **recording**, only when every chapter you checked agrees, with 3 of 3
  moments in each; list conflicts under Unsure instead of picking one.
