# Feature spec: raw motion capture → stroke rate + boat-motion modelling

**Status:** ✅ approved 2026-09-12 — implementing **Phase 1** (raw capture). Phases 2–3
are a roadmap, not built. Targets firmware 0.4.x on the T-Beam S3 Supreme.
**Owner:** Baldur (product).
**Related:** [`device-data`](../../docs/features/device-data.md) (the uploaded CSV; Phase 3
adds `strokerate` there), [`device-states-spec`](device-states-spec.md) (recording is
deliberate, needs a fix).

## Why

Two things we want from the on-board IMU (QMI8658 accel+gyro), neither of which the
current firmware can deliver:

1. **Stroke rate.** `device-data.md` says it "isn't derivable" — but that's only because
   0.3.0 logs a **1 Hz peak** and throws the rest away. `imuPoll()` already *samples* at
   ~50 Hz; a 0.5–2 Hz cadence is recoverable from that stream, just not from one
   sample/second.
2. **Boat motion.** Per-stroke **roll** (lean left/right), **pitch** (bow dip/rise), and
   the **yaw** wiggle are all in the same stream. Worth modelling to see what's learnable
   (stroke timing, catch/exit, lean asymmetry, bow bounce, glide).

Honest constraints that shape the approach:
- **Rate vs angle needs both sensors.** Gyro gives rotation *rate* + instantaneous
  direction but drifts when integrated; the accelerometer's **gravity vector** gives
  *absolute* tilt (which side it's leaned, how pitched). Roll/pitch = **accel+gyro fusion**
  (complementary/Madgwick). We have both; no magnetometer, so absolute **yaw/heading is
  not** IMU-recoverable — pair it with **GPS course** instead.
- **Everything is relative to how the device is mounted.** We learn the mounting from real
  captures (or mount consistently) rather than hard-coding axes.
- **Accuracy can't be bench-verified.** "Is the SPM right / is that really a left lean?"
  only proves out on the water. And existing uploads are 1 Hz, so we can't mine them.
  Hence: **capture first, model offline, distil onto the device** — and compare every
  outing.

## Phase 1 — raw capture (this change)

During a recording, log the full-rate IMU stream to a **sidecar file** next to the track,
so each outing yields a dataset to model against.

- **File:** `track_<stamp>_imu.csv` (same stamp as the session; fallback
  `track_n<NNNNNN>_imu.csv`). The main `track_<stamp>.csv` is **unchanged** — still 1 Hz,
  still the only thing uploaded and parsed by the server.
- **Columns:** `ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps`. `ms` is `millis()`, the **same
  clock** the track CSV already logs in its `ms` column, so the 50 Hz IMU rows align to
  the 1 Hz GPS rows for offline analysis.
- **Rate:** whatever `imuPoll()` produces (~50 Hz, POLL_INTERVAL_MS = 20). Each row
  carries its own `ms`, so a variable/occasionally-dropped rate is self-describing and
  fine.
- **Flush:** buffered, flushed ~once per second (every ~50 rows) — not per-row. Unlike the
  track CSV (flush-every-row so a yanked cable never loses a paddle), losing the last <1 s
  of *analysis* IMU on an abrupt power-off is acceptable, and 50 flushes/second is needless
  wear/power.
- **Not uploaded, not counted, not auto-touched.** The sidecar stays on the card; you pull
  it via the card reader or serial `CAT`. The uplink sweep, the Sync-screen counts, and the
  delete-uploaded action all **ignore `*_imu.csv`** (they match `track_*.csv` but exclude
  the `_imu.csv` suffix). Delete-uploaded removes only confirmed *track* files; sidecars are
  left for you to collect, since they're the whole point.

Scope guard: Phase 1 does **no** detection or modelling on-device. It only records.

### Shared SPI bus: IMU polling pauses while the uploader uses the card

The IMU and the microSD share one SPI bus. The UI/GNSS loop polls the IMU on core 1;
the uploader scans/syncs/deletes on core 0. Concurrent access corrupts both —
observed as SD `Select Failed` / `token error` storms that left the Sync screen stuck
on "scanning card..." (the count scan never finished) once the IMU was alive. Fix:
the task raises `uplinkSdBusy()` around its SD work and `loop()` skips `imuPoll()`
while it's set. This only happens when **not recording** (scans/syncs never run during
a recording — the task yields the card), so no sample that would be logged is lost.
During recording the opposite holds: the task is yielded and core 1 owns the bus for
both the IMU read and the SD write, sequentially. (A FreeRTOS mutex around every
`sdSPI` transaction would be the heavier, fuller alternative if a future need arises.)

## Phase 2 — model offline (not firmware)

With real sidecar traces: develop the stroke-rate detector (band-pass ~0.3–3 Hz to kill
the ~9 dps gyro rest-bias, then autocorrelation/peak-count over a ~6–8 s window) and the
roll/pitch/yaw characterisation (fuse accel+gyro to orientation; correlate with GPS course
and the per-stroke rhythm). Figure out mounting, and what's actually learnable. Iterate
outing to outing.

## Phase 3 — distil on-device (later, needs a spec of its own)

Once the offline model is trusted, emit small per-second values into the **uploaded** track
CSV: `strokerate` (SPM), and candidate motion summaries (`roll_deg`, `pitch_deg`, lean
side, …). `strokerate` flows straight into the server (the generic parser already aliases
`strokerate`/`spm`/`sr`/`cadence`); **this is the change that updates `device-data.md`.**
No server change for the rest unless we decide to keep it.

## Verification (Phase 1, on hardware)

Bench-verifiable — this phase is about *capturing*, not interpreting:
- A recording creates **both** `track_<stamp>.csv` and `track_<stamp>_imu.csv` (`LS`).
- The sidecar has the header + many rows accumulating at ~50/second (`CAT` its head;
  row count ≈ 50 × seconds recorded).
- `ms` values in the sidecar overlap the `ms` column of the track CSV (alignable).
- A sync uploads **only** the track CSV; the Sync counts still count only track files
  (the sidecar is ignored by both).
- Then the real work is offline: pull a paddle's sidecar and model it.
