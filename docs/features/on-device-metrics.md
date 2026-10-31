# On-device metrics and the shared recorder core

📋 **Design — 2026-10-25; phase 1 in progress** (the API, its fixtures and
the host build are in `recorder-core/`; the firmware doesn't use it yet).
Owner: `motion-core` (see
[`docs/agents.md`](../agents.md)). Related: [`mobile-apps.md`](mobile-apps.md)
(recording contract), [`device-uplink.md`](device-uplink.md) +
[`device-data.md`](device-data.md) (the CSV), [`one-paddle.md`](one-paddle.md),
`firmware/docs/motion-capture-spec.md` (the sidecar).

## The problem

The tracker, the Android app and the iPhone app all record GPS, accelerometer
and gyroscope, and all need the same numbers from them: stroke rate, roll,
pitch, rock evenness, speed, distance. Phones can show far more of it live than
the tracker's screen can. Written three times, those numbers would drift, and
the website would disagree with what a paddler saw on the water.

Today the tracker does no maths: it writes the 1 Hz track CSV and the motion
sidecar, and the server derives stroke rate (`packages/timing/src/cadence.ts`)
and boat motion (`attitude.ts`) from the raw data afterwards.

## Decisions (owner, 2026-10-25)

1. **Devices compute live values for display**, and every recording carries a
   log of **what was shown**, row by row.
2. **The full raw data is always uploaded** too, and it's the source of truth:
   the server recomputes from it, so a better algorithm improves every past
   paddle, and comparing what was shown against the recomputed values is the
   feedback loop for improving the algorithms.
3. **One implementation** of every metric, in portable C, used by the tracker,
   both apps and the server.

## Design

### The recorder core

`recorder-core/` at the repo root (not under `firmware/`: phones and the server
use it too). Pure C, `float` throughout (the ESP32-S3 has a single-precision
FPU), no Arduino/ESP-IDF headers, no malloc, no file I/O.

The API is [`recorder-core/include/recorder_core.h`](../../recorder-core/include/recorder_core.h):

```
rc_init(&rc, &cfg)                    // cfg: write callback, user pointer, RC_HAS_* bits; writes the headers
rc_imu(&rc, t_ms, ax, ay, az, gx, gy, gz)  // g, deg/s; writes the raw and the 80 ms-thinned motion lines
rc_second(&rc, t_ms, &gps, &extras)   // once a second: writes the track row, closes the motion window
rc_live(&rc, &values)                 // the current live values, NAN until ready
```

Three changes from the first sketch, each for a reason:

- **GPS arrives with the row** (`rc_second`), not on its own: the row is the
  GPS state at that second, and the tracker's receiver only reports once a
  second anyway.
- **The adapter calls the row, the core keeps no clock,** so replaying a
  recording reproduces its rows exactly.
- **`t_ms` is a `uint32_t` millisecond clock**, not nanoseconds: it's what the
  CSV's `ms` column has always held, and the comparisons are wrap-safe.
  GPS fields are `double` (7-decimal lat/lon don't fit a float); motion is
  `float`.

**Phones go through a layer in front of it,**
[`recorder_phone.h`](../../recorder-core/include/recorder_phone.h) (since 0.2.0).
A phone delivers accelerometer and gyroscope events in batches, late, and
out of step with each other, and its once-a-second timer fires late. Putting
them in time order is the hardest part of a phone adapter, so it's written
once, here, not once per app:

```
rc_phone_init(&p, &cfg)                   // cfg: write callback, platform (Android/iPhone), what it has, motion or not
rc_phone_accel(&p, t_ns, x, y, z)         // as delivered, in the platform's units (m/s² or -g)
rc_phone_gyro(&p, t_ns, x, y, z)          // rad/s
rc_phone_location_update(&p, &location)   // the latest fix; current while under 3 s old (the tracker's rule)
rc_phone_tick(&p, t_ns, batt_mv)          // once a second from the app's timer: asks for a row
rc_phone_finish(&p)                       // writes what's still held
```

It converts units, holds events until both sensors have passed a time, pairs
each accelerometer sample with the gyroscope reading at or before it (within
100 ms), writes
each row only after every sample up to it, and drops (and counts) what comes
too late to place. Ordering is in whole milliseconds, the core's `t_ms`, so a
replay of the files puts every sample in the same row. It holds batches up to
15 s late at 50 Hz. Phones leave the satellite count blank (often unknown,
and the server drops a row reading 0), and stamp a fix with when it was
taken, so a cached one reads as no fix. Eight fixtures (`fixtures/phone_*`)
pin it from events in delivery order. The tracker doesn't use it.

It owns everything that turns samples into lines and numbers: the column order
and number formats, blank lat/lon without a fix (never `0,0`), the per-second
motion summary, thinning the sidecar to ~10 Hz **by time**, and the live
metrics. It doesn't own drivers, storage, upload, Bluetooth, background
running or screens. Those are the adapters, one per platform.

| Platform | Links the core by | Adapter |
|---|---|---|
| Tracker | PlatformIO `lib_deps = file://../recorder-core` | QMI8658 + GNSS → core; core → SD card; live values → OLED |
| Android | CMake `add_subdirectory` + a small JNI wrapper | `SensorManager` + location → `recorder_phone.h`; core → file; live values → Compose |
| iPhone | `Package.swift` C target at `recorder-core/` (Swift imports C directly) | Core Motion + Core Location → `recorder_phone.h`; core → file; live values → SwiftUI |
| Server | the core compiled to WASM | replays the raw sidecar to produce the final numbers; replaces `cadence.ts` + `attitude.ts` |

### The sensor convention (what every adapter delivers)

- Accelerometer in **g**, raw, **gravity included** (not "user acceleration").
  At rest, the axis pointing up reads **+1 g**, as the tracker's QMI8658 and
  Android's `TYPE_ACCELEROMETER` do. Core Motion reads −1 g there, so the
  iPhone adapter negates acceleration. Android gives m/s²: divide by 9.80665.
- Gyroscope in **deg/s** (both phones give rad/s).
- Timestamps from the **sample's own** timestamp, not when the app received it.
  Neither phone delivers a steady 50 Hz; the core thins by time.
- On the phones, `recorder_phone.h` does the unit and sign conversions: the
  apps pass the platform's own values and timestamps (its header says which
  clock on each).
- GPS fields a platform doesn't have (satellites and HDOP on both phones; the
  tracker's radio `txSeq` on phones) are **blank**, never invented: the
  adapter leaves their `RC_HAS_*` bit clear.

Each adapter proves this twice: a unit test on synthetic sensor events, and a
bench check (phone flat on a table, then tipped on each axis) recorded
alongside the tracker. The bench check also confirms the signs above on real
hardware before anything depends on them.

### Two streams per recording

1. **What was shown:** live values in the 1 Hz track CSV, as extra columns
   with a `live_` prefix (`live_spm`, `live_roll`, `live_pitch`,
   `live_evenness`, …), plus the core's version (`core_ver`). The prefix
   matters: the CSV parser matches columns by name and would take a column
   called `spm` as the measured stroke rate. Unknown columns are ignored, so
   older servers are unaffected.
2. **Everything captured:** the raw motion sidecar, as today, always uploaded.

The website shows the server's recomputed values, never the logged ones. The
log answers "what did the paddler see?" (support), lets a new core version be
checked against every past recording before it ships (regressions), and
measures how far live values lag the final ones.

### Streaming = batch

Every metric is written as a stream. The final number is what the stream gives
at the end of the recording, so the server replaying the raw sidecar through
the same code gets **exactly** what the device would show at the end. Values
that need the whole session today (the median over windows, the mounting
learned from mean gravity, chart ranges) are accumulated as the stream runs.
Live values that need a warm-up (roll while the mounting is learned) show "—"
until they're ready, rather than a guess.

### Cost

Small. Live stroke rate on a ~10 s window at 10 Hz, updated every second, is
under 10k multiply-adds a second; the server's 60 s windows are ~28k every
30 s. The complementary filter is a handful of operations per sample; the
mounting is running sums for a 3×3 covariance. Well under a millisecond on the
ESP32-S3. Confirm once on the bench build.

## Testing without devices

- **Real captures replayed** through a host build: the 13 Sep capture with the
  sidecar, and the 65-minute session that reads 58.0 spm.
- **Synthetic signals with known answers:** 60 spm alternating reads 60, not 30
  or 120; stationary noise reads no stroke; a fixed tilt is not reported as a lean.
- **Streaming = batch:** replaying a whole file gives the batch answer, for every metric.
- **The same fixtures everywhere:** plain `cc` in CI, `pio test -e native`, the
  Android and iOS unit tests, and the WASM build on the server.
- **Byte-identical CSV:** extracting the CSV writing from the firmware must not
  change one byte of a recording (checked against a real capture).

## Phases

1. **Extract** the CSV writing from `firmware/src/main_tracker.cpp` into
   `recorder-core/`, byte-identical. Build it for all four targets with the
   fixtures running in CI. The phones can then build recording, background
   running and upload on it.
   - **1a, done:** the header, the implementation, golden fixtures, `make test`
     in CI, and a Swift package. Replaying the 13 and 16 Sep captures matched
     the raw motion file and every GPS column byte for byte (details in
     `recorder-core/CLAUDE.md`).
   - **1b, in progress:** done so far are the PlatformIO manifest, the CMake
     file, CI guards against fused multiply-adds on the Android and ESP32-S3
     builds, and the WASM build (`make wasm`: every fixture replayed through
     the module under Node, in CI). Next: the tracker switching to the core
     (`firmware`).
   - **1c, done (0.2.0):** the phone layer, `recorder_phone.h`, so both apps
     can record motion now. The server works out stroke rate and boat motion
     from the upload, as for a tracker; live values on the phone wait for
     phase 2.
2. **Stroke rate** in the core as a stream; the server switches to the WASM
   build and `cadence.ts` goes once its tests pass against it.
   - **2a, done (0.3.0):** `src/stroke.c` reads the motion lines and track
     rows as written; `rc_replay` gives the server the same figures from the
     uploaded files (pinned on every fixture). On the 13 and 16 Sep
     captures its windows, rests and paddling time match the server's
     exactly; its rate is lower, because it takes the sample rate from
     each window's mean spacing where the server took the median gap, and
     an independent check on an even time grid agrees with it (details in
     `recorder-core/CLAUDE.md`).
   - **2b, done:** the server runs the WASM build. It is embedded in
     `packages/timing/src/recorder-core-wasm.ts` (generated by
     `recorder-core/wasm/embed.mjs`; CI checks it was built from the C
     sources as they are, and byte for byte matches CI's own build), and
     `cadence.ts` only replays the uploaded files through it and reads its
     lines (`recordingStrokeRate`). Its maths is gone. Stroke rates on the
     site drop by how far each recording's motion file stalls: about 5% for
     files uploaded since 17 Sep (80 ms gate), about 13% for the every-5th
     files of 13-17 Sep (the 13 Sep reference: 58.0 to 50.7). Recording
     reports are worked out again (they key on the core's version); saved
     paddles keep their numbers until recomputed (owner's decision). Live
     stroke rate on the phones waits for phase 4.
   - **0.5.0:** a recording whose GPS never saw the boat moving at >= 4 km/h
     for 90 s gets the reason `not_moving` and says so on its page (owner,
     2026-10-31), instead of suggesting the tracker was loose.
3. **Boat motion** (roll, pitch, evenness) the same way; `attitude.ts` goes.
   Then movement-gated distance, the last motion maths left in
   `packages/timing`.
4. **Live values** on the tracker's screen and both phones' recording screens,
   with the `live_*` columns and `core_ver`.

## Open questions

- Which live values the tracker's small screen shows (stroke rate certainly;
  roll maybe).
- Whether `core_ver` is a column or a line in the file header.
- The single-sided stroke (canoe, SUP) still needs a real recording to
  calibrate the doubling check.
- Phones without a gyroscope (some cheap Android ones). For now they record
  the track with no motion (`imu_ok = 0`). Accelerometer-only motion would need
  blank gyro columns in the motion file, and the server would have to accept
  them.
