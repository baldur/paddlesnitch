# Feature spec: what the paddle tracker captures

**Status:** 📋 reference — describes firmware `0.3.0` as shipped on device `5A43CA48`.
**Owner:** Baldur (product). Counterpart: the `gps_device` repo.
**Companion:** [`device-uplink.md`](device-uplink.md) covers *how* the file arrives;
this covers *what is in it* and how much of it to believe.

Every number below is measured from real sessions on the device, not taken from
a datasheet. Where the hardware is worse than you would assume, it says so.

## The file

One CSV per power-on, uploaded as `text/csv` with `X-Device-Firmware` and
`X-Device-Model` headers. Rows are appended at **1 Hz** and flushed individually,
so a file is valid even if the device loses power mid-session.

Measured cadence over a 500-row session: median interval **1000 ms**, max 1218 ms,
no gap above 1.5 s. Do not assume exact spacing — use the `timestamp` column.

### Columns

| Column | Unit | Notes |
|---|---|---|
| `timestamp` | ISO 8601 UTC | **Empty when there is no fix.** From GNSS, not a local clock. |
| `ms` | ms | Monotonic uptime. Survives fix loss — use it to detect gaps and reboots. |
| `utc_date`, `utc_time` | — | Redundant with `timestamp`; retained for humans reading the card. |
| `fix` | 0/1 | Whether the GNSS had a position solution for this row. |
| `lat`, `lon` | deg | **Empty when there is no fix** (see Null Island below). |
| `alt_m` | m | GNSS altitude. **Do not trust** — see below. |
| `speed_kmh` | km/h | Doppler-derived by the GNSS, not differentiated position. |
| `course_deg` | deg | Track over ground. Meaningless below ~2 km/h. |
| `sats` | count | Satellites used in the solution. |
| `hdop` | — | **25.5 is the no-fix sentinel**, not a real reading. |
| `batt_mv` | mV | `0` means no battery fitted (running on USB), not a flat battery. |
| `tx_seq` | count | LoRa packets sent. Device-side diagnostics; ignore. |
| `ax_g`,`ay_g`,`az_g` | g | Accelerometer at the instant of the row. |
| `gx_dps`,`gy_dps`,`gz_dps` | deg/s | Gyroscope at the instant of the row. |
| `accel_mag_max_g` | g | **Peak \|a\| across the whole second**, not an instant. 1.0 = at rest. |
| `gyro_mag_max_dps` | deg/s | Peak \|ω\| across the second. |
| `imu_temp_c` | °C | Die temperature of the IMU. Not water or air temperature. |
| `imu_samples` | count | IMU samples behind that row (~49). **`0` means the motion columns are meaningless for that row.** |

Columns from `ax_g` onward are ours; `parseCsv` ignores them.

**Heart rate is not captured at all** — not stripped at parse time, simply never
recorded. There is no biometric in this file.

## What to believe, and what not to

### Position: good. Altitude: not.

Measured on a stationary device with a clear sky: HDOP **0.8–1.1** (median 0.9),
up to **14 satellites** across GPS, GLONASS and BeiDou. Horizontal quality is
genuinely good.

Altitude over the same stationary session spread **53.9 m** (σ 7.8 m). This is
normal GNSS behaviour — every satellite in view is above the receiver and none
below — but it means `alt_m` cannot support elevation gain, climb rate, or any
derived metric. **Use a DEM lookup against `lat`/`lon` if elevation is needed.**

### Stationary scatter is large enough to invent distance

Summing consecutive fixes across that stationary session yields **115 m of
"travel"** inside a bounding box of roughly **33 × 10 m**. 374 of 421 fixed rows
read under 1 km/h, but 3 rows read above 6 km/h and one reached **20.4 km/h**.

Consequences for the server:

- **Never sum raw point-to-point distance.** Apply a movement gate. The firmware
  uses ≥3 m *and* ≥1.5 km/h before counting a segment, and the server should do
  the same when computing its own figures.
- **A speed spike is not a sprint.** p95 of stationary speed was 2.57 km/h with
  outliers to 20 km/h; treat isolated high-speed samples as noise unless
  sustained across several rows.
- For **time-trial line crossings**, consider requiring `hdop <= 1.5` on the rows
  either side of a crossing. A crossing computed from a poor fix is the failure
  mode that most damages a result.

### Null Island

Rows without a fix write **empty** `timestamp`, `lat` and `lon` — never `0,0`.
This is deliberate: `0.0, 0.0` is a valid coordinate in the Gulf of Guinea, and
an earlier firmware wrote exactly that, which the generic CSV parser would have
accepted as real points. If a future upload contains `0,0` rows, treat the file
as suspect rather than parsing them.

### Cold start costs the first ~80 seconds

Measured time to first fix from cold, with no stored almanac: **80 s**, during
which `sats` is 0 and `hdop` is 25.5. The device logs throughout, so a file
routinely opens with a minute or more of fix-less rows. That is not corruption.

### The gyroscope is uncalibrated

`gyro_mag_max_dps` sits around **8–9 deg/s at rest** on this unit — an
uncalibrated bias, not motion. Treat gyro magnitudes as **relative**: useful for
"was there rotation", not for absolute turn rate. The accelerometer needs no such
caveat; it reads 1.03 g flat against an expected 1.0.

## A session is a deliberate recording (changed in 0.4.0)

**This changed after the first version of this spec.** Firmware ≤ 0.3.0 opened a
new file on every power-up, so a file could contain desk time, the drive to the
water, the paddle, and the drive home. From **0.4.0** the user starts and stops
recording with the button, so a file is intended to be one paddle.

Two consequences:

- Files uploaded from **0.3.0 and earlier** still carry the old semantics. The
  `X-Device-Firmware` header on the upload says which you are handling.
- The device no longer transmits over LoRa or writes rows while idle, so a card
  no longer fills with fix-less bench sessions.

Segmentation is still worth doing defensively — someone will forget to stop the
recording on the drive home:

1. Drop rows with `fix = 0`.
2. Split on time gaps greater than ~60 s in `timestamp`.
3. Discard segments shorter than ~60 s or covering less than ~50 m after the
   movement gate.
4. What remains is candidate activities; the paddle is usually the longest.

Of 31 files uploaded during testing, **all 31 correctly returned `422 no usable
track points`** — they were power-on bench sessions from firmware ≤ 0.3.0. With
deliberate recording this should become rare, but `422` remains a normal outcome
(a recording started indoors, or stopped before a fix) and should not be
surfaced to the user as an error.

## After you confirm an upload, you are the system of record

From firmware 0.5.0 the device **deletes a session once the server has confirmed
it** (`200`, `201`, or `409`), keeping only the five most recent sessions on the
card as a local safety net.

Two consequences:

- **A `200` is a promise.** Do not return it until the trace is durably stored.
  Returning `200` and then failing to persist loses the only other copy, once the
  file ages past the five-session window.
- **`409` also counts as confirmation.** If the server has forgotten a session it
  previously accepted, answering `409` will let the device delete it. Answer
  `404`/`422` instead if you want it re-sent.

Files rejected `422` are **not** deleted — they are the evidence if a parse
problem is ever suspected.

## Stroke rate: the gap worth closing

`TrackPoint.strokeRate` exists and matters for paddlers (#143), and this device
**has the sensor to provide it** — a QMI8658 sampled at 50 Hz, which is
comfortably above paddling cadence (roughly 0.5–2 Hz, or 30–120 spm).

It cannot provide it **today**: the firmware reduces 50 Hz to a per-second peak
before writing, and a peak magnitude cannot yield cadence. The information is
destroyed on the device, not missing from the sensor.

Two ways to close it, in increasing order of work:

1. **Device-side cadence.** Run a peak-count or autocorrelation over the 50 Hz
   accelerometer stream on the ESP32 and emit a `strokerate` column. `parseCsv`
   already looks for `strokerate`/`cadence`/`spm`/`sr`, so **no server change at
   all** would be needed. This is the cheap option and mirrors the trick that let
   the position columns work unchanged.
2. **Raw IMU upload.** A second file per session at 50 Hz (~5 MB/hour) with
   server-side analysis. More flexible, considerably more plumbing and storage.

Recommendation: option 1. Say the word and I will implement it on the device.

## Open questions for paddlesnitch

- **Do you want fix-less rows at all?** The device currently uploads whole files
  including the acquisition period. Trimming server-side keeps the raw record;
  trimming device-side saves bandwidth. The raw record is probably worth keeping.
- **Should the device upload at all when a session has no fix?** It costs one
  request per bench session. Filtering device-side is easy but means the server
  never learns a device is alive and logging.
- **Boat class and crew** are entry-level metadata the device has no way to know.
  They presumably stay a UI concern at submission time.
