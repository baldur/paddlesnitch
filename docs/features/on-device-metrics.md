# On-device metrics and the shared recorder core

📋 **Design — 2026-10-25, not built.** Owner: `motion-core` (see
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

```
rc_feed_imu(t_ns, ax, ay, az /* g */, gx, gy, gz /* deg/s */)
rc_feed_gps(t_ns, fix)            // lat, lon, alt, speed, course; sats/hdop optional
rc_tick(t_ns)                     // emits finished CSV lines through a write callback
rc_live(&values)                  // the current live values, for a screen
rc_columns.h                      // the column lists, defined once
```

It owns everything that turns samples into lines and numbers: the column order
and number formats, blank lat/lon without a fix (never `0,0`), the per-second
motion summary, thinning the sidecar to ~10 Hz **by time**, and the live
metrics. It doesn't own drivers, storage, upload, Bluetooth, background
running or screens. Those are the adapters, one per platform.

| Platform | Links the core by | Adapter |
|---|---|---|
| Tracker | PlatformIO `lib_deps = file://../recorder-core` | QMI8658 + GNSS → core; core → SD card; live values → OLED |
| Android | CMake `add_subdirectory` + a small JNI wrapper | `SensorManager` + location → core; core → file; live values → Compose |
| iPhone | `Package.swift` C target at `recorder-core/` (Swift imports C directly) | Core Motion + Core Location → core; core → file; live values → SwiftUI |
| Server | the core compiled to WASM | replays the raw sidecar to produce the final numbers; replaces `cadence.ts` + `attitude.ts` |

### The sensor convention (what every adapter delivers)

- Accelerometer in **g**, raw, **gravity included** (not "user acceleration").
  At rest, the axis pointing up reads **+1 g**, as the tracker's QMI8658 and
  Android's `TYPE_ACCELEROMETER` do. Core Motion reads −1 g there, so the
  iPhone adapter negates acceleration. Android gives m/s²: divide by 9.80665.
- Gyroscope in **deg/s** (both phones give rad/s).
- Timestamps from the **sample's own** timestamp, not when the app received it.
  Neither phone delivers a steady 50 Hz; the core thins by time.
- GPS fields a platform doesn't have (satellites and HDOP on iPhone; the
  tracker's radio `txSeq` on phones) are **blank**, never invented.

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
2. **Stroke rate** in the core as a stream; the server switches to the WASM
   build and `cadence.ts` goes once its tests pass against it.
3. **Boat motion** (roll, pitch, evenness) the same way; `attitude.ts` goes.
4. **Live values** on the tracker's screen and both phones' recording screens,
   with the `live_*` columns and `core_ver`.

## Open questions

- Which live values the tracker's small screen shows (stroke rate certainly;
  roll maybe).
- Whether `core_ver` is a column or a line in the file header.
- The single-sided stroke (canoe, SUP) still needs a real recording to
  calibrate the doubling check.
