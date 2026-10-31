# recorder-core — the shared recorder core

Owner: `motion-core`. Design: [`docs/features/on-device-metrics.md`](../docs/features/on-device-metrics.md).
One C implementation of "samples in, recording lines and live values out",
for the tracker, both apps and (as WASM) the server.

```
include/recorder_core.h   the whole API and the sensor convention
src/recorder_core.c       the implementation
include/recorder_phone.h  the phones' layer: events as delivered → core calls in time order
src/recorder_phone.c      (not in the tracker's build: library.json's srcFilter)
test/run_fixtures.c       replays fixtures/*/calls.csv or phone.csv, diffs every stream,
                          checks replay order
test/gen_phone_fixtures.py  writes the phone fixtures' inputs (delivery order)
test/phone_seen.c         the phone layer with its core calls routed through the
                          runner's checks (test builds only)
test/one_implementation.sh  CI: the apps reach the core only through recorder_phone.h
                          and don't convert sensor units themselves
fixtures/                 golden cases (format: fixtures/README.md)
Package.swift             iPhone: add the folder as a local package, `import RecorderCore`
CMakeLists.txt            Android: add_subdirectory(...) + link `recorder_core`
library.json              tracker: lib_deps = symlink://../recorder-core (carries -ffp-contract=off)
test/esp32_no_fma.sh      the tracker's gcc build has no fused multiply-adds
wasm/                     the server's build: a shim taking plain numbers, and
                          run_fixtures.mjs, which replays the fixtures under Node
make test                 host build + every fixture; CI runs this
make wasm WASI_SDK=...    the WebAssembly build + every fixture (wasi-sdk 25)
```

CI (`checks.yml`): `recorder-core` runs the fixtures (ubuntu gcc and clang,
macOS arm64 clang, sanitizers). `recorder-core-builds` runs them through CMake
and checks the Android NDK (arm64) and ESP32-S3 builds for fused
multiply-adds, since the fixtures can't run on those devices here, then
builds the WebAssembly module and replays the fixtures through it.

## The WebAssembly build

`wasm/recorder_core_wasm.c` wraps the API in plain numbers (JavaScript can't
build C structs): `rcw_init(has)`, `rcw_imu(...)` and `rcw_second(...)` with
every `rc_gps` and `rc_extras` field in header order. Lines come back
through the import `env.rcw_write(stream, ptr, len)`. One recording per
instance. libc's stdio comes along with `snprintf`, so the module imports
`fd_write`, `fd_seek` and `fd_close`; the core never calls them, so a host
stubs them and needs no WASI. The module is built in CI and not committed;
phase 2 decides how the server gets it.

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
- **Phones go through `recorder_phone.h`**, never straight to `rc_imu` and
  `rc_second`: putting batched, late sensor events in order is the hard part
  of a phone adapter, so it lives here once. The apps pass the platform's own
  units and clock. It orders in whole milliseconds (the core's `t_ms`), not
  nanoseconds: a sample 0.3 ms after a row in the same millisecond belongs
  to that row in a replay, so it must live too (`fixtures/phone_android`).
- **Never lose a row:** a tick that arrives after later samples or rows have
  gone on gets its row just after them. Samples that can't be placed are
  dropped and counted, not put in the wrong row.
- **Phones leave satellites blank:** the count is often not known on
  Android, and the server drops a row that reads 0 satellites (`csv.ts`).
- **A phone fix needs a real date** (2025-2099, as the tracker's
  `gpsDateOk`) and is current under 3 s old. A row reusing one is stamped
  with the fix's time plus its age, so the clock runs on as the tracker's
  receiver's does.
- **Batching limit:** 15 s at 50 Hz (`RC_PHONE_EVENTS` 2048, `RC_PHONE_ROWS`
  32, about 100 KB). Change the header's BATCHING note with them.
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
- WASM against native, 2026-10-27: both real captures replayed through the
  module give the native build's output byte for byte (~912k lines, 0.6 s
  under Node). In JavaScript, never `parseFloat(s) || 0`: it turns -0 into 0,
  and the core writes `-0.00` (the first WASM run failed on exactly that).
- The phone layer's first version dropped a tick that arrived after later
  samples had gone on, losing that second's row. The fixtures delivered
  every tick on time, so they passed; a 20-line Swift probe that fed
  samples then ticked, as an app's timer does, wrote no row at all
  (2026-10-31). Fixture inputs need the platform's real disorder, not just
  batches: the generator now makes a tick late on purpose. Also: within one
  sensor, events arrive in order; a generator that reorders one sensor's
  events tests something no phone does.
- The `tester` review of the phone layer (2026-10-31) found what the
  fixtures and 17 mutations hadn't: "0 satellites" makes the server drop a
  row; the row queue (8), not the sample buffers, set the batching limit
  (10 s batches lost 40% of samples while the header promised 20 s); an
  iPhone fix stamped on arrival lets a cached fix count as fresh; a tick
  behind a shifted row was dropped. Branch coverage (llvm-cov) showed four
  checks no fixture reached. Run coverage on the fixtures when adding
  rules, not just mutations.
- A fuzz that sorts events by delivery time must keep each stream's own
  order on ties (`qsort` isn't stable): one that didn't reported 3,228
  "lost" rows that were ticks it had reordered, which no app can do.
- macOS `make` compares timestamps to the second: restoring a file within the
  same second as a build leaves a stale binary. `make clean` before trusting
  a mutation test.
