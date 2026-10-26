# recorder-core — the shared recorder core

Owner: `motion-core`. Design: [`docs/features/on-device-metrics.md`](../docs/features/on-device-metrics.md).
One C implementation of "samples in, recording lines and live values out",
for the tracker, both apps and (as WASM) the server.

```
include/recorder_core.h   the whole API and the sensor convention
src/recorder_core.c       the implementation
test/run_fixtures.c       replays fixtures/*/calls.csv, diffs every stream
fixtures/                 golden cases (format: fixtures/README.md)
Package.swift             iPhone: add the folder as a local package, `import RecorderCore`
CMakeLists.txt            Android: add_subdirectory(...) + link `recorder_core`
library.json              tracker: lib_deps = symlink://../recorder-core (carries -ffp-contract=off)
test/esp32_no_fma.sh      the tracker's gcc build has no fused multiply-adds
make test                 host build + every fixture; CI runs this
```

CI (`checks.yml`): `recorder-core` runs the fixtures (ubuntu gcc and clang,
macOS arm64 clang, sanitizers). `recorder-core-builds` runs them through CMake
and checks the Android NDK (arm64) and ESP32-S3 builds for fused
multiply-adds, since the fixtures can't run on those devices here.

## Rules

- **Pure C99:** no malloc, no I/O, no platform headers; `snprintf` is the
  only libc that writes. The caller owns the `rc_state` and the files.
- **`float` for motion, `double` for GPS.** The ESP32-S3 has a single-precision
  FPU and motion runs at 50 Hz, so motion is float. GPS is one row a second
  and is printed to 7 decimals, which float can't hold, so it stays double.
- **The CSV is a contract.** Every format string matches what the tracker has
  written since 0.4.x; the server and every uploaded recording read it. A
  change to a column is a change to `device-data.md` and the parser, first.
- **The adapter decides when a row is written** (`rc_second`, once a second);
  the core keeps no clock. That's what lets a replay reproduce a recording's
  rows exactly.
- **Blank, never invented:** a column the platform has no source for
  (`rc_config.has`) is blank. An invalid field on a platform that has it is 0,
  as the tracker has always written. No fix: timestamp, lat and lon blank.
- **Same number on every compiler:** no fused multiply-add. The source turns
  it off for clang (`#pragma STDC FP_CONTRACT OFF`). gcc doesn't know that
  pragma, so a gcc build of the core passes `-ffp-contract=off` (the ESP32-S3,
  phase 1b). `fixtures/fp_contract` pins it; only CI's macOS arm64 leg fuses by
  default, so it's the leg that would catch a regression.
- **Calls in time order** (header, "CALL ORDER"): a sample belongs to the row
  of the next `rc_second` called, so an adapter that writes a row before
  late samples arrive makes rows a replay can't rebuild.
- **Wrap-safe time:** `t_ms` is `uint32_t` and wraps after ~49.7 days; compare
  with an unsigned difference, never a signed or widened one
  (`fixtures/clock_wrap`).
- **Live values are NAN until ready**, never 0 or a guess.
- After an API change, tell `lead` (who tells `android`, `ios`, `firmware`),
  and bump `RC_VERSION`.

## Checking against real recordings

Real captures can't be fixtures (the repo is public). Replay them locally:
convert the track CSV and `_imu.csv` into `calls.csv` (an `imu` call per
sidecar row and a `second` per track row, in `ms` order, the IMU first on a
tie), then run `build/run_fixtures --write` on it and compare.

Result, 2026-10-25, against the 13 Sep and 16 Sep captures (~390k motion rows,
~8.9k track rows): the raw motion file and every GPS column and sample count
are byte-identical. Two differences, both from the replay rather than the core:

- **The first row's motion summary:** its window holds samples from before
  the recording started, which no file has.
- **The per-second peaks** (`accel_mag_max_g`, `gyro_mag_max_dps`) are off
  by at most one in the last digit. The tracker takes the peak from
  full-precision samples, while the replay takes it from the sidecar's rounded
  ones. A device feeding the core directly has the full-precision samples.

## Lessons

- arm64 clang (Apple, Android NDK) fuses `a*b + c` by default, and x86 and
  WASM don't. Without the pragma, about one row in a few thousand differed in
  the last digit of a peak (found by the `tester` review, 2026-10-25). Any new
  float maths is covered by the same pragma, but only CI's macOS leg proves it.
  With the pragma on, one more row of the 16 Sep replay differed: it had
  matched only when fused. Confirmed 2026-10-26: the ESP32-S3 gcc emits 4
  `madd.s` in `rc_imu` in GNU C mode (the firmware's), and none with
  `-ffp-contract=off`. Strict `-std=c99` hides it, because ISO mode turns
  contraction off on its own, so test in GNU mode. Once the tracker links the
  core, an occasional peak's last digit changes. That's intended: it then
  matches the server.
- The firmware cut its raw line at 96 characters and its row at 320. The core
  has room for any float, so the two would differ only on values no sensor
  gives.
- macOS `make` compares timestamps to the second: restoring a file within the
  same second as a build leaves a stale binary. `make clean` before trusting
  a mutation test.
