# Recorder core fixtures

Each folder is one case: `calls.csv` (calls to the core) or `phone.csv`
(events into the phone layer, `recorder_phone.h`) is the input, and the
other files are what must be written, byte for byte. `make test` replays
them through the host build. The firmware's native tests, the Android and
iOS unit tests and the WASM build replay the **same files**: a platform
passes when its build writes identical output. The `phone_*` cases are for
the phones only (the tracker and the server don't use that layer).

Every case is also checked for replay order: each motion line written after
a row is later than that row, and each row is no earlier than the motion
lines before it. Otherwise a replay of the files, sorted by `ms` with
samples first on a tie, would put samples in other rows.

| Folder | What it pins |
|---|---|
| `tracker_cold_start` | Every tracker column: before a date (`0000-00-00`), a time before the date (GGA before RMC), the receiver's early `2000-00-00`, a date without a fix (blank timestamp, lat, lon: never `0,0`), the first fix, a second with no motion samples, a dead motion sensor (all zeros), and the sensor coming back (its window stayed open) |
| `iphone` | Columns the iPhone has no source for (satellites, HDOP, battery, radio, IMU temperature) are blank; no raw motion file; ~100 Hz samples thinned to one per 80 ms |
| `android` | Satellites and battery written; HDOP, radio and IMU temperature blank |
| `clock_wrap` | The millisecond clock wrapping at 2^32: the motion file keeps its 80 ms spacing across it |
| `fp_contract` | No fused multiply-add: one sample whose gyro peak is 165.56 as written and 165.57 fused (arm64 clang fuses by default) |
| `phone_android` | m/s² and rad/s in 0.5 s batches, the gyroscope 3 ms behind; a 2.5 s late stretch of accelerometer events (rows wait, nothing lost); the first sample before any gyroscope reading (unpaired); a tick 0.3 ms after a sample in the same millisecond (the sample is in that row); a second tick in a held row's millisecond (ignored); satellites configured but left blank |
| `phone_ios` | Core Motion's −1 g read as +1; both sensors on the same instants (gyroscope first on a tie); a cached fix 10 minutes old and a tick before the sensors start (no fix, motion down); a fix without speed, course or altitude (0); a fix reused with its clock running on, then none after 3 s, then back across midnight UTC; a late tick (its row written after the latest sample, not lost) |
| `phone_sensor_stops` | The gyroscope stops: rows held until 32 wait, then written with motion down; unpaired samples dropped and counted; a straggler from before a written row dropped as late |
| `phone_sensors_pause` | Both sensors deliver nothing for 37.5 s, then resume; rows forced out without them; a sample in a written row's millisecond dropped as late |
| `phone_long_batches` | Both sensors in 12 s batches, half a batch out of step (inside the 15 s limit): nothing dropped |
| `phone_timing` | Two ticks delivered over a second late, after later samples (each still gets a row, just after them); a gyroscope timestamp 1 ms before the previous one (late); a tick exactly on a sample whose timestamp repeats in the next batch (the row waits for it) |
| `phone_buffer_full` | 45 s of accelerometer before any gyroscope event: the 2048-sample buffer full, the oldest going on unpaired, gyroscope readings older than them dropped as late |
| `stroke_paddle` | Real stroke windows on every platform's float maths: parked, 56 spm, an 80 s rest drifting, 62 spm (each stretch reads its own rate); samples ~80 ms apart with the tracker's jitter, so the rate must come from each window's mean spacing, not the median gap; known answers in `expect_*` lines |
| `trace_phone_flat` | The live trace (`rc_phone_trace`) on a phone lying flat: `starting` before any sample; `still` on noise (~0.13 deg/s rms), drawn on the 5 deg/s floor; both sensors stop at 20 s: the last 10 s held at 26.5 s (6.5 s without a sample), `no_samples` at 28.5 s with nothing to draw |
| `trace_phone_paddle` | The live trace while paddling 60 spm alternating at 8 km/h: `motion` on y (the roll, the axis with the most variance), scaled to its peak; the same samples read 60 spm (`expect_session`) |
| `phone_track_only` | No gyroscope (`motion` 0): rows aren't held and sensor events are ignored; a tick before any location; a fix 2.999 s old counts and 3.000 s doesn't, with its clock running on; 29 Feb; a repeated tick ignored; a location with no time (0) and one dated 2024 aren't fixes |

## `calls.csv`

One call per line; `#` starts a comment. The first call is `config`.

```
config,<flags>
imu,t_ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps
second,t_ms,fix,utc_date,utc_time,lat,lon,alt_m,speed_kmh,course_deg,sats,hdop,batt_mv,tx_seq,imu_ok,imu_temp_c
finish
expect_session,<moving|all>,<min spm>,<max spm>   (or <moving|all>,none)
expect_series,<0|1>
expect_points,<min count>,<max count>,<min spm>,<max spm>
```

- `config` → `rc_init`. Flags, space-separated: `tracker` (all of them), `sats`,
  `hdop`, `batt_mv`, `tx_seq`, `imu_temp`, `raw_motion`. None = an iPhone.
- `imu` → `rc_imu`. Values are parsed as `float`; give 9 significant digits
  when a case needs a float's exact bits.
- `second` → `rc_second`. `fix` and `imu_ok` are 0/1. `utc_date` is
  `YYYY-MM-DD` and `utc_time` is `HH:MM:SS`. An **empty** date, time, `alt_m`,
  `speed_kmh`, `course_deg`, `sats` or `hdop` means that field isn't valid
  this second (its `*_valid` is 0). GPS values are parsed as `double`.
- `finish` → `rc_finish`, which writes the stroke figures. Every case ends
  with it (the runner refuses one that doesn't).
- `expect_*` are known answers, checked against the stroke lines written so
  far (so after `finish`), independent of the golden files the core wrote.
  Other platforms' runners may skip them.

## `phone.csv`

Events in the order the phone delivered them, in its own units (Android
m/s², iPhone g with up reading −1; rad/s on both). `t_ns` is the monotonic
nanosecond clock (`recorder_phone.h`, CLOCK).

```
phone,<android|ios>,<flags>,<motion 0|1>
accel,t_ns,x,y,z
gyro,t_ns,x,y,z
location,t_ns,utc_ms,lat,lon,alt_m,speed_ms,course_deg
tick,t_ns,batt_mv
trace
finish
expect,dropped_late,<n>,dropped_unpaired,<n>
```

- `trace` → `rc_phone_trace`, written to `trace.csv` (expected only when a
  case calls it) as `trace,<starting|no_samples|still|motion>,<x|y|z|->,<n>,<scale_dps>`
  and then one `<ago_ms>,<dps>` line per sample, oldest first. Only the
  `trace_phone_*` cases use it (`recorder-core/CLAUDE.md`).
- `phone` → `rc_phone_init`. Flags as `config`'s, but only `batt_mv` means
  anything on a phone (satellites stay blank).
- An **empty** `alt_m`, `speed_ms` or `course_deg` means the platform didn't
  give it.
- `expect` checks the drop counts at that point.
- The runner also sees every core call the layer makes (`test/phone_seen.c`):
  they must come in replay order, and each tick later than the one before
  must get one row.
- The inputs come from `../test/gen_phone_fixtures.py` (`python3
  test/gen_phone_fixtures.py fixtures`, then `make fixtures`).

## Output files

| File | Stream | Exists when |
|---|---|---|
| `track.csv` | `RC_TRACK` | always |
| `motion.csv` | `RC_MOTION` (the uploaded `_i10.csv`) | always |
| `motion_raw.csv` | `RC_MOTION_RAW` (the tracker's `_imu.csv`) | `raw_motion` is set |
| `stroke.csv` | `RC_STROKE` (not a file a device keeps) | always |

**Streaming = batch** is checked on every case: the `track.csv` and
`motion.csv` the case wrote, replayed through `rc_replay` as the server
does, must give exactly its `stroke.csv`.

## Changing them

`make fixtures` rewrites the output files from the core. A changed byte here
changes every recording, so read every changed line in the diff, and say in
the PR why it changed. Never regenerate to make a red build green.

No real recordings in here: the repo is public, and a real track is where
someone lives and paddles. Real captures are replayed locally (see
`../CLAUDE.md`).
