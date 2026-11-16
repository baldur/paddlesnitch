# Job: views (score the game against the footage)

**Goal:** a score that says how recognisable the Reading game's river is,
without the owner scoring by hand. First make the model's scores agree with
the owner's; then score every new build.

**Data (all local, all private):** `~/.paddlesnitch/refviews/`
- `views.json`: 44 fixed places. Each has an `id`, a `name` and a `frame` (a
  still from the owner's footage in `frames/`).
- `game/<label>/<id>.png`: the game drawn from the same eye and heading, one
  folder per build (`blocks-1`, `reach-1`, `vom-3`, …).
- `scores.json`: the owner's scores, `{ label: { viewId: 1..5 } }`. Only
  `blocks-1` is scored. 1 = nothing alike, 5 = you'd know the place at once.
- Read `apps/web/scripts/courses/views.ts` and `lib/views.ts` for how they're made.

**Tool:** `apps/web/scripts/courses/view-score.ts` (run as
`pnpm --filter web course:view-score <label>`). If it doesn't exist yet,
writing it is your first run. It sends each frame and game shot to Ollama
through the gate (`http://127.0.0.1:11435/api/chat`, the only way to the
model), model `qwen3.8-64k:latest`, `temperature: 0`,
images as base64), asks for JSON `{ "score": 1-5, "differences": ["…"] }`
with the rubric above, and writes `$NIGHT_WORK/views/model-scores.json`
as `{ label: { viewId: { score, differences } } }` (`refviews/` is read-only
for you). Keep the prompt in the
script, so changing it is a diff `lead` can review. Pure helpers (parsing the
answer, the agreement maths) go in `lib/` with a vitest test.

**Metric, phase 1: `views-mae`.** Mean absolute difference between your
scores and the owner's on `blocks-1`. Lower is better. Tune the prompt on the
views with an even index in `views.json` and report the MAE on the odd ones
too (`views-mae-held-out`): if only the even ones improve, you overfitted.
Also report the rank correlation (Spearman).

**Metric, phase 2: `views-mean`** (once `views-mae-held-out` ≤ 0.75, or
`steer.md` says so). Score every label in `game/` that has no model scores.
Report the mean per label, oldest to newest, and the five lowest-scoring views
of the newest label with their `differences`. That list is what the game
should fix next.

**Tests:** `pnpm --filter web exec vitest run scripts/courses`.

**Never:** put frames, shots, differences or scores in the repo. They stay in
`~/.paddlesnitch/`. One model at a time: if `ollama ps` shows another model
busy (the overnight colour run), wait or report `stuck`.

## Lessons

(lead adds what it learns from your reports here.)

- 2026-11-15: a full 44-view scoring takes about 30 minutes.

- 2026-11-16 (lead): **always answering 3 scores views-mae 0.705 and held-out
  0.773 on blocks-1**, exactly what the 16 Nov prompt reached. A lower MAE
  only counts if it beats that constant. Report the constant-3 numbers next to
  yours every run, and treat Spearman (rank agreement, 0.31 now) as the number
  to raise: the owner's scores run 1-5 and the model so far only says 2, 3 or 4.
  Phase 2 waits until held-out MAE is at most 0.60 **and** held-out Spearman is
  at least 0.5. `view-score.ts` is on main now (`course:view-score`); `tsx`
  can't run in the sandbox (it opens a unix socket), so run it with `node
  --experimental-strip-types` or as the last run did. The first run
  spent 90 minutes on setup and trial scores, started the full baseline late
  and was stopped with no report. If `$NIGHT_WORK/views/model-scores.json`
  already holds all 44 views for main, use it as **before** instead of scoring
  again; otherwise score the baseline first, before anything else.
