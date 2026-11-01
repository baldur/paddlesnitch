/*
 * recorder_core.h — the shared recorder core (docs/features/on-device-metrics.md).
 *
 * One implementation of "samples in, recording lines and live values out",
 * used by the tracker, the Android app, the iPhone app and (as WASM) the
 * server. Pure C99: no malloc, no I/O, no platform headers. The caller owns
 * the memory (an rc_state) and the files (the write callback).
 *
 * Not thread-safe: call everything for one rc_state from one thread (or
 * serialise the calls). Phones deliver motion and location on different
 * queues; the adapter funnels both onto one.
 *
 * CALL ORDER: calls come in non-decreasing t_ms, rc_imu before rc_second on
 * a tie. A sample lands in the row of the next rc_second CALLED, so the
 * adapter calls rc_second for time T only once every sample up to T has
 * been passed in (phones deliver sensor events in batches and late). That
 * is what lets a replay of the files rebuild the same rows.
 *
 * THE SENSOR CONVENTION — what every adapter delivers:
 *   - Raw sensors, as the tracker's QMI8658: Android TYPE_ACCELEROMETER and
 *     TYPE_GYROSCOPE; iPhone CMAccelerometerData and CMGyroData (not
 *     CMDeviceMotion: its gravity/userAcceleration split is already filtered).
 *   - Accelerometer in g, gravity INCLUDED. At rest the axis pointing up
 *     reads +1 g (the QMI8658 and Android do; Core Motion reads -1 g, so the
 *     iPhone adapter negates the ACCELEROMETER only, never the gyroscope;
 *     Android gives m/s², so divide by 9.80665).
 *   - Gyroscope in deg/s (both phones give rad/s: multiply by 57.29578).
 *   - One rc_imu per accelerometer sample, at that sample's timestamp, with
 *     the latest gyroscope reading. A platform with no gyroscope can't record
 *     motion yet: record the track with imu_ok = 0 (an open question in
 *     docs/features/on-device-metrics.md).
 *   - Time: t_ms is a monotonic millisecond clock, taken from each sample's
 *     OWN timestamp (not when the app received it). Any origin will do (the
 *     tracker uses millis() since boot); it may wrap at 2^32, and every
 *     comparison in the core is wrap-safe. ONE clock for samples and rows:
 *     on iPhone, sensor timestamps are time since boot, so rows use
 *     ProcessInfo.systemUptime, never CLLocation.timestamp (wall clock);
 *     on Android, both use elapsedRealtimeNanos.
 *   - Fields a platform doesn't have are left out through rc_config.has, and
 *     written blank — never invented.
 */
#ifndef RECORDER_CORE_H
#define RECORDER_CORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* The core's version, logged with every recording (phase 4: core_ver). */
#define RC_VERSION "0.6.0"

/* ---- Output streams ---------------------------------------------------- */

typedef enum {
    RC_TRACK      = 0, /* track_<stamp>.csv: one row a second, uploaded        */
    RC_MOTION     = 1, /* track_<stamp>_i10.csv: motion thinned by time to
                          ~12 Hz (one row per 80 ms of t_ms), uploaded         */
    RC_MOTION_RAW = 2, /* track_<stamp>_imu.csv: every sample, kept on the
                          card, not uploaded. Only if RC_HAS_RAW_MOTION.       */
    RC_STROKE     = 3  /* stroke rate as it's measured, and the recording's
                          figures at rc_finish (STROKE RATE below). Not a file
                          a device needs to keep: the server rebuilds it from
                          the other two with rc_replay.                        */
} rc_stream;

/*
 * Receives every finished line, header lines included. `line` ends in '\n',
 * is NUL-terminated, and is only valid during the call; `len` excludes the NUL.
 * Required (never NULL). It must not call back into rc_* for the same state.
 */
typedef void (*rc_write_fn)(void *user, rc_stream stream, const char *line, size_t len);

/* ---- Configuration ----------------------------------------------------- */

/* What this platform has. A column whose bit is clear is written blank. */
enum {
    RC_HAS_SATS       = 1 << 0, /* satellite count (not on iPhone)           */
    RC_HAS_HDOP       = 1 << 1, /* HDOP (not on iPhone)                      */
    RC_HAS_BATT_MV    = 1 << 2, /* battery millivolts                        */
    RC_HAS_TX_SEQ     = 1 << 3, /* the tracker's radio sequence number       */
    RC_HAS_IMU_TEMP   = 1 << 4, /* IMU temperature                           */
    RC_HAS_RAW_MOTION = 1 << 5, /* write the RC_MOTION_RAW stream            */
    RC_HAS_TRACKER    = 0x3f    /* all of the above                          */
};

typedef struct {
    rc_write_fn write;
    void       *user;  /* passed back to write() untouched */
    uint32_t    has;   /* RC_HAS_* bits                    */
} rc_config;

/* ---- Inputs ------------------------------------------------------------ */

/*
 * The GPS state at the moment a track row is written. Each *_valid says
 * whether the receiver has that field now; an invalid field is written as
 * 0 (as the tracker always has), except that without a fix the timestamp,
 * lat and lon are blank: 0,0 is a real place.
 *
 * GPS fields are double, not float: the CSV prints lat/lon to 7 decimals,
 * which float can't hold, and the tracker's GNSS library reports double.
 */
typedef struct {
    int      fix;          /* a usable fix: position, a real date and a time  */
    int      date_valid;   /* year/month/day were reported (may be 0 early)    */
    int      year, month, day;
    int      time_valid;
    int      hour, minute, second;
    double   lat, lon;     /* degrees; read only when fix                       */
    int      alt_valid;    double alt_m;
    int      speed_valid;  double speed_kmh;
    int      course_valid; double course_deg;
    int      sats_valid;   unsigned sats;
    int      hdop_valid;   double hdop;
} rc_gps;

/* The rest of a track row. Fields are ignored when their RC_HAS_* bit is clear. */
typedef struct {
    unsigned batt_mv;      /* 0 when not known                                 */
    unsigned tx_seq;
    int      imu_ok;       /* 0: the motion sensor is dead or absent; the row's
                              motion columns are then all 0                    */
    float    imu_temp_c;
} rc_extras;

/* ---- Live values ------------------------------------------------------- */

/*
 * What a screen shows now. NAN means "not ready" (show "—"), never a guess.
 * The metrics come in phases 2–4, one at a time, each pinned so that
 * replaying a whole recording gives the server's number. The GPS state is
 * there now (0.4.0): it's what the latest row says, so a screen can show
 * "waiting for GPS" or "GPS lost 40 s ago" without working it out itself.
 * A phone's comes from its latest tick, not from a row still held for late
 * samples, so it's never behind by the sensors' batching.
 */
typedef struct {
    float spm;             /* stroke rate, strokes a minute                    */
    float roll_deg;        /* roll rms about the paddler's own neutral         */
    float pitch_deg;       /* pitch rms                                        */
    float evenness_pct;    /* side A/B imbalance, %                            */
    float speed_kmh;
    float distance_m;      /* movement-gated, never a raw sum of fixes         */
    int   fix;             /* 1: the latest row has a GPS fix                  */
    float since_fix_s;     /* seconds from the latest row with a fix to the
                              latest row: 0 while there's a fix, NAN before
                              the first                                        */
} rc_live_values;

/* ---- Live motion trace ----------------------------------------------------
 *
 * What a recording screen draws to show the motion sensors are working
 * (rc_phone_trace in recorder_phone.h). It's the signal stroke rate is
 * counted from, so the trace and the rate always agree: the stroke stream's
 * own samples (the RC_MOTION lines as written, at most one per 80 ms, so
 * ~12.5 Hz), the last 10 s back from the newest, on the gyroscope axis with
 * the most variance over those 10 s, about its mean. That is the rule each
 * stroke window uses to pick its axis, in the same function. The app draws
 * what it gets: no thresholds, no maths.
 *
 * Drawing: x is ago_ms (0 at the right edge, 10,000 at the left); y is
 * dps / scale_dps, from -1 to 1. Samples come ~80 ms apart, more where the
 * sensors paused; a phone's arrive in its batches (up to a few seconds), so
 * the trace moves on in steps, not smoothly.
 */
typedef enum {
    RC_TRACE_STARTING   = 0, /* no sample yet, under 7 s into the recording    */
    RC_TRACE_NO_SAMPLES = 1, /* none for 7 s (since the newest sample, or
                                the start): the sensors stopped, or never
                                started. n is 0                                */
    RC_TRACE_STILL      = 2, /* samples arriving, under 1 deg/s rms over the
                                10 s drawn: the device is lying still (one
                                sample alone reads still)                      */
    RC_TRACE_MOTION     = 3  /* the sensors see movement                       */
} rc_trace_status;

#define RC_TRACE_MAX 128     /* 10 s at one sample per 80 ms is at most 125    */

typedef struct {
    rc_trace_status status;
    int      axis;           /* 0, 1, 2: the device's gyroscope x, y, z; -1
                                when n is 0                                    */
    float    scale_dps;      /* draw dps in +-scale_dps: the biggest |dps|,
                                at least 5, so a still device draws flat       */
    uint32_t n;              /* samples, oldest first                          */
    uint32_t ago_ms[RC_TRACE_MAX]; /* before the newest; ago_ms[n - 1] is 0    */
    float    dps[RC_TRACE_MAX];    /* deg/s about the mean                     */
} rc_trace;

/* ---- Stroke rate ----------------------------------------------------------
 *
 * Read from the uploaded files only, so a replay of them gives the same lines
 * (streaming = batch): every RC_MOTION line as written (80 ms apart, values as
 * printed) and each RC_TRACK row's ms and speed. Each window: the gyroscope
 * axis with the most variance, its autocorrelation, the best LOCAL maximum
 * for 0.2-2 Hz (never the band edge), refined between lags; alternating
 * strokes (half-lag correlation < -0.85 x the peak) are twice the cycle.
 *
 * Three sets of windows:
 *   moving  60 s every 30 s, wholly inside a moving run (>= 4 km/h for >= 90
 *           rows): the recording's stroke rate
 *   all     the same, ungated: for a recording whose GPS failed
 *   series  15 s every 5 s, inside a moving run of >= 20 rows: stroke rate
 *           through the paddle, left/right decided once by majority
 *
 * RC_STROKE lines (no header; the first field says which):
 *   window,<set>,<t_ms>,<cycles/min>,<strokes/min>,<alternating 0|1>,<confidence>
 *   point,<ms>,<strokes/min>,<confidence>     series, after its neighbour check
 *   rest,<moving|all>,<from_ms>,<to_ms>         a gap of >= 60 s between windows
 * and at rc_finish:
 *   motion,<rows>,<sample Hz>
 *   session,<moving|all>,<available 0|1>,<reason>,<windows>,<median spm>,<paddling s>,<strokes>
 *   series,<ok 0|1>,<windows>,<alternating windows>
 * reason: ok, too_few_samples, too_slow, no_rhythm, not_moving.
 * not_moving: moving only, when no stretch of the track ever reached the
 * set's 90 rows at >= 4 km/h (no_rhythm: it did, and no window there showed
 * a stroke). The motion file's own reasons come first. When a set isn't
 * available, its window and rest lines don't count; when series isn't ok,
 * no point counts (single-sided paddling isn't calibrated yet).
 *
 * Reading them (the server's wrapper):
 *   - Keep every line until rc_finish: points come before the series
 *     verdict, and a set's windows and rests before its session line.
 *   - Lines of different sets aren't in time order: a moving window waits
 *     for the track (up to ~30 s, the 90-row run), the others don't.
 *   - All ms are the device's own clock (millis since boot, may wrap).
 *   - motion's Hz is the median gap between the file's lines, as the server
 *     always reported it; windows use their own mean spacing.
 *
 * Rules the windows follow, beyond the maths:
 *   - A window with a hole in its samples (a gap over 0.5 s) gives no rate:
 *     lags in samples stop being time.
 *   - A moving run ends at a slow row (< 4 km/h) or after 3 s with no track
 *     row (no evidence the boat moved): a recording whose GPS failed is
 *     what the "all" set is for.
 */
#define RC_STROKE_RING 1024   /* samples held: 80 s at the 12.5 Hz most     */
#define RC_STROKE_PENDING 8   /* windows waiting for the track to decide     */
#define RC_STROKE_RUNS 8      /* recent moving runs                          */
#define RC_STROKE_BINS 3001   /* 0.0-300.0 strokes/min, in tenths (more: top) */

typedef struct { uint32_t ms; float gx, gy, gz; } rc_stroke_sample;

typedef struct {
    uint32_t t_ms;
    int      cpm10, spm10, alternating, conf1000;
} rc_stroke_window;

typedef struct {
    uint32_t         next_t;                 /* the next window's start         */
    rc_stroke_window pending[RC_STROKE_PENDING];
    uint32_t         npending;
    uint32_t         windows, alternating;
    int              have_end;
    uint32_t         end_ms;                 /* rests and paddling time         */
    uint64_t         paddling_ms, strokes_x; /* strokes x 600,000               */
    int              nearby;                 /* series: windows held for the    */
    rc_stroke_window near[2];                /* neighbour check (prev, current) */
} rc_stroke_set;

typedef struct { uint32_t start_ms, last_ms, rows; int active; } rc_stroke_run;

typedef struct {
    int              started;               /* windows start at the first sample    */
    uint32_t         last_sample_ms;         /* the newest line read                 */
    rc_stroke_sample ring[RC_STROKE_RING];
    uint32_t         ring_head, ring_n;
    int              gate_started;
    uint32_t         gate_last_ms;           /* the 80 ms gate, re-applied on replay */
    uint32_t         rows;                   /* motion lines read                    */
    int              have_last;
    uint32_t         last_ms;                /* the line before, for the sample rate */
    uint16_t         delta_hist[1024];       /* first 2000 gaps, in ms               */
    uint32_t         deltas;
    rc_stroke_run    runs[RC_STROKE_RUNS];
    uint32_t         runs_n;
    uint32_t         longest_run;            /* rows, of any run so far              */
    rc_stroke_set    set[3];                 /* moving, all, series                  */
    uint16_t         hist[2][RC_STROKE_BINS];/* moving, all: the median              */
} rc_stroke;

/* ---- State --------------------------------------------------------------- */

/*
 * About 31 KB: allocate it statically (or on the heap), never on a task
 * stack. Caller-allocated; treat every field as private. It grows as metrics are
 * added, so bindings take sizeof(rc_state) from this header, never a copy.
 */
typedef struct {
    rc_config cfg;
    /* RC_MOTION's time gate */
    int       motion_started;
    uint32_t  motion_last_ms;
    /* the motion summary for the current track row */
    float     ax, ay, az, gx, gy, gz;   /* the latest sample            */
    float     accel_mag_max, gyro_mag_max;
    uint32_t  window_samples;
    /* the GPS state for rc_live: the latest row, the latest with a fix */
    int       rows, fixed, fix;
    uint32_t  row_ms, fix_ms;
    rc_stroke stroke;
} rc_state;

/* ---- Calls --------------------------------------------------------------- */

/*
 * Starts a recording: resets the state and writes each stream's header line.
 * There's no resume: an app restarted mid-recording starts a new recording
 * (new files), rather than calling this again on the old ones.
 */
void rc_init(rc_state *rc, const rc_config *cfg);

/* One motion sample (g, deg/s). Writes RC_MOTION_RAW and, when due, RC_MOTION. */
void rc_imu(rc_state *rc, uint32_t t_ms,
            float ax, float ay, float az, float gx, float gy, float gz);

/*
 * Writes one RC_TRACK row for this second and starts the next motion window.
 * The caller calls it once a second; the core doesn't keep the clock, so a
 * replay of a recording reproduces its rows exactly.
 */
void rc_second(rc_state *rc, uint32_t t_ms, const rc_gps *gps, const rc_extras *extras);

/* The current live values (see rc_live_values). */
void rc_live(const rc_state *rc, rc_live_values *out);

/*
 * Ends the recording: decides what's still waiting and writes the RC_STROKE
 * figures. Call once, after the last rc_second, before closing the files.
 */
void rc_finish(rc_state *rc);

/*
 * The server's way in: replays a recording's uploaded files (the track CSV
 * and the motion CSV, whole) and writes only RC_STROKE, exactly as the device
 * did. Lines are merged by ms, motion first on a tie (CALL ORDER). Columns
 * are found by name in the track's header, so older trackers' files work.
 * Each file must be in time order, as every recorder writes it: lines are
 * read as they come, never sorted (a file written backwards reads as a
 * stopped clock, too_slow). `rc` is scratch space; cfg->has is ignored.
 */
void rc_replay(rc_state *rc, const rc_config *cfg,
               const char *track, size_t track_len,
               const char *motion, size_t motion_len);

#ifdef __cplusplus
}
#endif

#endif /* RECORDER_CORE_H */
