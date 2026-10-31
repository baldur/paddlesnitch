/*
 * recorder_phone.h — the phones' way into the recorder core.
 *
 * A phone delivers sensor events in batches, late, and the accelerometer and
 * gyroscope out of step with each other. The core needs calls in time order
 * (recorder_core.h, CALL ORDER), so this layer sits in front of it. Both apps
 * hand it events exactly as the platform delivers them, in the platform's own
 * units, and it:
 *
 *   - converts units and axes (Android m/s², iPhone's -g, rad/s → deg/s);
 *   - holds events until both sensors have passed a time, then passes them
 *     to the core in time order, each accelerometer sample with the latest
 *     gyroscope reading;
 *   - writes each once-a-second row only after every sample up to it has
 *     been passed in, with the location as it stood when the row was asked for;
 *   - drops what arrives too late to place, rather than putting it in the
 *     wrong row (a replay of the files must rebuild the same rows).
 *
 * The app's part is: register the sensors, take timestamps from ONE monotonic
 * clock, call these from ONE thread or queue, and write the lines to files.
 * The tracker doesn't use this layer; it calls the core directly.
 *
 * CLOCK: t_ns is a monotonic nanosecond clock since boot, never wall time.
 *   Android: SensorEvent.timestamp, Location.getElapsedRealtimeNanos(), and
 *            SystemClock.elapsedRealtimeNanos() for ticks.
 *   iPhone:  CMLogItem.timestamp × 1e9 for samples;
 *            ProcessInfo.systemUptime × 1e9 for ticks; and for a CLLocation,
 *            when it was TAKEN on that clock:
 *              (systemUptime - (Date().timeIntervalSince1970
 *                               - location.timestamp.timeIntervalSince1970)) × 1e9
 *            never when it arrived: the first fix is often a cached one,
 *            minutes old, and must read as no fix.
 * The core's t_ms is t_ns / 1,000,000, truncated.
 *
 * SAMPLE RATE: ask for about 50 Hz from both sensors. The core thins the
 * uploaded file to one row per 80 ms, and stroke rate needs at least 10 Hz.
 *
 * BATCHING: events may arrive up to 15 s late at 50 Hz (7 s at 100 Hz):
 * that's what the buffers below hold. Later than that, rows are written
 * without them and they're dropped as late. On Android keep
 * maxReportLatencyUs at or under 5 s and hold a partial wake lock while
 * recording, or the sensor FIFO is only emptied when the screen wakes.
 */
#ifndef RECORDER_PHONE_H
#define RECORDER_PHONE_H

#include "recorder_core.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    RC_PHONE_ANDROID = 1, /* accel in m/s², up reads +9.81; gyro rad/s          */
    RC_PHONE_IOS     = 2  /* accel in g, up reads -1 (CMAccelerometerData);
                             gyro rad/s (CMGyroData)                            */
} rc_platform;

typedef struct {
    rc_write_fn write;
    void       *user;
    rc_platform platform;
    uint32_t    has;      /* RC_HAS_BATT_MV if the app can supply it; anything
                             else is ignored. Satellites stay blank on phones:
                             the count is often not known, and the server drops
                             a row that reads 0.                               */
    int         motion;   /* 1: the phone has both sensors and will send them.
                             0: track only (no gyroscope): rows aren't held.   */
} rc_phone_config;

/*
 * The latest location, as the platform reported it. A *_valid of 0 means
 * the platform didn't give that field (Android: !hasAltitude() etc.;
 * iPhone: verticalAccuracy <= 0, speed < 0, course < 0).
 */
typedef struct {
    int64_t t_ns;         /* monotonic: when the fix was taken (Android) or
                             arrived (iPhone), see CLOCK                       */
    int64_t utc_ms;       /* wall time of the fix: Location.getTime();
                             CLLocation.timestamp.timeIntervalSince1970 × 1000 */
    double  lat, lon;     /* degrees                                          */
    int     alt_valid;    double alt_m;
    int     speed_valid;  double speed_ms;    /* m/s; the row has km/h        */
    int     course_valid; double course_deg;
} rc_phone_location;

/* Room for batches up to 15 s late at 50 Hz (BATCHING). */
#define RC_PHONE_EVENTS 2048
#define RC_PHONE_ROWS   32

typedef struct { int64_t ms; float x, y, z; } rc_phone_event;

typedef struct {
    rc_gps    gps;
    rc_extras extras;
    int64_t   ms;
} rc_phone_row;

/* Caller-allocated (about 100 KB: never on the stack); treat every field
   as private. */
typedef struct {
    rc_state          core;
    rc_phone_config   cfg;
    rc_phone_event    accel[RC_PHONE_EVENTS], gyro[RC_PHONE_EVENTS];
    uint32_t          accel_head, accel_n, gyro_head, gyro_n;
    int64_t           accel_last, gyro_last;   /* last ms received (-1: none) */
    rc_phone_row      rows[RC_PHONE_ROWS];
    uint32_t          rows_head, rows_n;
    int64_t           row_last;                /* last row ms queued (-1)      */
    int64_t           tick_last;               /* last tick's own ms (-1)      */
    int64_t           done_ms;                 /* last row written (-1)        */
    int64_t           emitted_ms;              /* last sample passed on (-1)   */
    int               have_gyro;
    rc_phone_event    gyro_now;                /* the latest gyroscope reading */
    int64_t           imu_last;                /* last accel passed on (-1)    */
    int               have_location;
    rc_phone_location location;
    uint32_t          dropped_late, dropped_unpaired;
} rc_phone;

/* Starts a recording: writes the header lines (rc_init). */
void rc_phone_init(rc_phone *p, const rc_phone_config *cfg);

/* One accelerometer or gyroscope event, in the platform's units (rc_platform). */
void rc_phone_accel(rc_phone *p, int64_t t_ns, double x, double y, double z);
void rc_phone_gyro(rc_phone *p, int64_t t_ns, double x, double y, double z);

/* A new location. The next rows use it while it's under 3 s old (the
   tracker's rule) and dated 2025-2099; otherwise they have no fix. A row
   using it is stamped with the fix's time plus its age. */
void rc_phone_location_update(rc_phone *p, const rc_phone_location *loc);

/*
 * Asks for this second's row: call once a second from the app's own timer.
 * batt_mv is written when the config has RC_HAS_BATT_MV (0: not known; the
 * server reads 0 as "nothing recorded"). The row is written once both
 * sensors have passed t_ns, or when RC_PHONE_ROWS rows are already waiting
 * (a sensor stopped). A tick that arrives after later samples or rows (a
 * late timer) still gets its row, just after them. A tick no later than
 * the previous one, by its own time, is ignored.
 */
void rc_phone_tick(rc_phone *p, int64_t t_ns, unsigned batt_mv);

/* Ends the recording: writes everything still held. Call before closing the files. */
void rc_phone_finish(rc_phone *p);

/* Live values (rc_live on the core). */
void rc_phone_live(const rc_phone *p, rc_live_values *out);

/*
 * Events dropped: arrived after their row was written ("late"), or an
 * accelerometer sample with no gyroscope reading in the last 100 ms
 * ("unpaired"). Log them with the recording; a steady count means the app
 * is holding events too long or a sensor stopped.
 */
uint32_t rc_phone_dropped_late(const rc_phone *p);
uint32_t rc_phone_dropped_unpaired(const rc_phone *p);

#ifdef __cplusplus
}
#endif

#endif /* RECORDER_PHONE_H */
