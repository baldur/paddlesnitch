# Recorder core fixtures

Each folder is one case: `calls.csv` is the input, and the other files are
what the core must write, byte for byte. `make test` replays them through the
host build. The firmware's native tests, the Android and iOS unit tests and
the WASM build replay the **same files**: a platform passes when its build of
the core writes identical output.

| Folder | What it pins |
|---|---|
| `tracker_cold_start` | Every tracker column: before a date (`0000-00-00`), a time before the date (GGA before RMC), the receiver's early `2000-00-00`, a date without a fix (blank timestamp, lat, lon: never `0,0`), the first fix, a second with no motion samples, a dead motion sensor (all zeros), and the sensor coming back (its window stayed open) |
| `iphone` | Columns the iPhone has no source for (satellites, HDOP, battery, radio, IMU temperature) are blank; no raw motion file; ~100 Hz samples thinned to one per 80 ms |
| `android` | Satellites and battery written; HDOP, radio and IMU temperature blank |
| `clock_wrap` | The millisecond clock wrapping at 2^32: the motion file keeps its 80 ms spacing across it |
| `fp_contract` | No fused multiply-add: one sample whose gyro peak is 165.56 as written and 165.57 fused (arm64 clang fuses by default) |

## `calls.csv`

One call per line; `#` starts a comment. The first call is `config`.

```
config,<flags>
imu,t_ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps
second,t_ms,fix,utc_date,utc_time,lat,lon,alt_m,speed_kmh,course_deg,sats,hdop,batt_mv,tx_seq,imu_ok,imu_temp_c
```

- `config` → `rc_init`. Flags, space-separated: `tracker` (all of them), `sats`,
  `hdop`, `batt_mv`, `tx_seq`, `imu_temp`, `raw_motion`. None = an iPhone.
- `imu` → `rc_imu`. Values are parsed as `float`; give 9 significant digits
  when a case needs a float's exact bits.
- `second` → `rc_second`. `fix` and `imu_ok` are 0/1. `utc_date` is
  `YYYY-MM-DD` and `utc_time` is `HH:MM:SS`. An **empty** date, time, `alt_m`,
  `speed_kmh`, `course_deg`, `sats` or `hdop` means that field isn't valid
  this second (its `*_valid` is 0). GPS values are parsed as `double`.

## Output files

| File | Stream | Exists when |
|---|---|---|
| `track.csv` | `RC_TRACK` | always |
| `motion.csv` | `RC_MOTION` (the uploaded `_i10.csv`) | always |
| `motion_raw.csv` | `RC_MOTION_RAW` (the tracker's `_imu.csv`) | `raw_motion` is set |

## Changing them

`make fixtures` rewrites the output files from the core. A changed byte here
changes every recording, so read every changed line in the diff, and say in
the PR why it changed. Never regenerate to make a red build green.

No real recordings in here: the repo is public, and a real track is where
someone lives and paddles. Real captures are replayed locally (see
`../CLAUDE.md`).
