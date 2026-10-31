/*
 * recorder_core.c — see include/recorder_core.h.
 *
 * Phase 1: the recording format, moved here from the tracker firmware
 * (firmware/src/main_tracker.cpp, storage.cpp, include/motion_gate.h). Every
 * format string below must stay byte-identical to what the tracker has
 * written since 0.4.x: the server, and every recording already uploaded,
 * read these columns.
 */
#include "recorder_core.h"
#include "stroke.h"

/* No fused multiply-add. Apple and Android clang on arm64 fuse a*b + c by
   default and x86 and WASM don't, which changed about one row in a few
   thousand (fixtures/fp_contract). gcc doesn't know this pragma: its builds
   (the ESP32-S3) pass -ffp-contract=off instead. */
#if defined(__clang__)
#pragma STDC FP_CONTRACT OFF
#endif

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

/* The column lists, defined once. The first three names are what the
   server's generic CSV parser looks for (packages/timing/src/csv.ts). */
static const char TRACK_HEADER[] =
    "timestamp,ms,utc_date,utc_time,fix,lat,lon,alt_m,speed_kmh,course_deg,"
    "sats,hdop,batt_mv,tx_seq,"
    "ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,"
    "accel_mag_max_g,gyro_mag_max_dps,imu_temp_c,imu_samples\n";

static const char MOTION_HEADER[] = "ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps\n";

/* One RC_MOTION row per 80 ms, gated on TIME, not every Nth sample: the
   tracker's poll really runs ~43.7 Hz, and stroke rate reads 20% low below
   ~10 Hz. 80 rather than 90 ms keeps the ~23 ms-spaced samples above
   10.9 Hz (the rate that was tested), not just under it. */
#define RC_MOTION_INTERVAL_MS 80u

static void emit(const rc_state *rc, rc_stream s, const char *line, int n)
{
    if (n < 0) return;
    rc->cfg.write(rc->cfg.user, s, line, (size_t)n);
}

static void emit_str(const rc_state *rc, rc_stream s, const char *line)
{
    emit(rc, s, line, (int)strlen(line));
}

void rc_init(rc_state *rc, const rc_config *cfg)
{
    memset(rc, 0, sizeof(*rc));
    rc->cfg = *cfg;
    rcs_init(&rc->stroke);
    emit_str(rc, RC_TRACK, TRACK_HEADER);
    emit_str(rc, RC_MOTION, MOTION_HEADER);
    if (rc->cfg.has & RC_HAS_RAW_MOTION) emit_str(rc, RC_MOTION_RAW, MOTION_HEADER);
}

void rc_imu(rc_state *rc, uint32_t t_ms,
            float ax, float ay, float az, float gx, float gy, float gz)
{
    float am = sqrtf(ax * ax + ay * ay + az * az);
    float gm = sqrtf(gx * gx + gy * gy + gz * gz);
    rc->ax = ax; rc->ay = ay; rc->az = az;
    rc->gx = gx; rc->gy = gy; rc->gz = gz;
    if (am > rc->accel_mag_max) rc->accel_mag_max = am;
    if (gm > rc->gyro_mag_max) rc->gyro_mag_max = gm;
    rc->window_samples++;

    /* Room for six of the largest floats: no float can cut this line short. */
    char line[320];
    int n = snprintf(line, sizeof(line), "%lu,%.4f,%.4f,%.4f,%.2f,%.2f,%.2f\n",
                     (unsigned long)t_ms, ax, ay, az, gx, gy, gz);

    if (rc->cfg.has & RC_HAS_RAW_MOTION) emit(rc, RC_MOTION_RAW, line, n);

    /* Unsigned difference: wrap-safe across the 2^32 ms rollover. */
    if (!rc->motion_started || (uint32_t)(t_ms - rc->motion_last_ms) >= RC_MOTION_INTERVAL_MS) {
        rc->motion_started = 1;
        rc->motion_last_ms = t_ms;
        emit(rc, RC_MOTION, line, n);
        /* Stroke rate reads the line as written, as a replay of the file
           will: the same values, rounded the same way. */
        uint32_t ms;
        float gx_, gy_, gz_;
        if (n > 0 && rcs_parse_motion(line, (size_t)n, &ms, &gx_, &gy_, &gz_))
            rcs_sample(&rc->stroke, &rc->cfg, ms, gx_, gy_, gz_);
    }
}

/* Appends to buf at *pos; keeps *pos inside the buffer whatever happens. */
#if defined(__GNUC__)
__attribute__((format(printf, 4, 5)))
#endif
static void put(char *buf, size_t cap, size_t *pos, const char *fmt, ...)
{
    if (*pos >= cap - 1) return;
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf + *pos, cap - *pos, fmt, ap);
    va_end(ap);
    if (n < 0) return;
    *pos += (size_t)n;
    if (*pos > cap - 1) *pos = cap - 1;
}

void rc_second(rc_state *rc, uint32_t t_ms, const rc_gps *g, const rc_extras *x)
{
    const uint32_t has = rc->cfg.has;
    char row[384];
    size_t p = 0;

    rc->rows = 1;
    rc->row_ms = t_ms;
    rc->fix = g->fix ? 1 : 0;
    if (g->fix) { rc->fixed = 1; rc->fix_ms = t_ms; }

    /* Timestamp, lat and lon only with a fix: blank, never 0,0. */
    if (g->fix) {
        put(row, sizeof(row), &p, "%04d-%02d-%02dT%02d:%02d:%02dZ",
            g->year, g->month, g->day, g->hour, g->minute, g->second);
    }
    put(row, sizeof(row), &p, ",%lu,%04d-%02d-%02d,%02d:%02d:%02d,%d,",
        (unsigned long)t_ms,
        g->date_valid ? g->year : 0, g->date_valid ? g->month : 0, g->date_valid ? g->day : 0,
        g->time_valid ? g->hour : 0, g->time_valid ? g->minute : 0, g->time_valid ? g->second : 0,
        g->fix ? 1 : 0);
    if (g->fix) put(row, sizeof(row), &p, "%.7f,%.7f", g->lat, g->lon);
    else        put(row, sizeof(row), &p, ",");
    put(row, sizeof(row), &p, ",%.1f,%.2f,%.1f,",
        g->alt_valid ? g->alt_m : 0.0,
        g->speed_valid ? g->speed_kmh : 0.0,
        g->course_valid ? g->course_deg : 0.0);
    if (has & RC_HAS_SATS) put(row, sizeof(row), &p, "%u", g->sats_valid ? g->sats : 0u);
    put(row, sizeof(row), &p, ",");
    if (has & RC_HAS_HDOP) put(row, sizeof(row), &p, "%.1f", g->hdop_valid ? g->hdop : 0.0);
    put(row, sizeof(row), &p, ",");
    if (has & RC_HAS_BATT_MV) put(row, sizeof(row), &p, "%u", x->batt_mv);
    put(row, sizeof(row), &p, ",");
    if (has & RC_HAS_TX_SEQ) put(row, sizeof(row), &p, "%u", x->tx_seq);

    /* The motion summary for this second. A dead sensor writes zeros and
       leaves the window open, as the tracker always has. */
    float ax = 0, ay = 0, az = 0, gx = 0, gy = 0, gz = 0, am = 0, gm = 0, temp = 0;
    uint32_t samples = 0;
    if (x->imu_ok) {
        ax = rc->ax; ay = rc->ay; az = rc->az;
        gx = rc->gx; gy = rc->gy; gz = rc->gz;
        am = rc->accel_mag_max; gm = rc->gyro_mag_max;
        temp = x->imu_temp_c;
        samples = rc->window_samples;
        rc->accel_mag_max = 0;
        rc->gyro_mag_max = 0;
        rc->window_samples = 0;
    }
    put(row, sizeof(row), &p, ",%.4f,%.4f,%.4f,%.2f,%.2f,%.2f,%.4f,%.2f,",
        ax, ay, az, gx, gy, gz, am, gm);
    if (has & RC_HAS_IMU_TEMP) put(row, sizeof(row), &p, "%.1f", temp);
    put(row, sizeof(row), &p, ",%lu\n", (unsigned long)samples);
    if (row[p - 1] != '\n') row[p - 1] = '\n';

    emit(rc, RC_TRACK, row, (int)p);

    uint32_t ms;
    double speed;
    if (rcs_parse_row(row, p, RCS_ROW_MS_COL, RCS_ROW_SPEED_COL, &ms, &speed))
        rcs_row(&rc->stroke, &rc->cfg, ms, speed);
}

void rc_finish(rc_state *rc)
{
    rcs_finish(&rc->stroke, &rc->cfg);
}

void rc_live(const rc_state *rc, rc_live_values *out)
{
    out->spm = NAN;
    out->roll_deg = NAN;
    out->pitch_deg = NAN;
    out->evenness_pct = NAN;
    out->speed_kmh = NAN;
    out->distance_m = NAN;
    out->fix = rc->rows && rc->fix;
    out->since_fix_s = rc->fixed ? (float)(uint32_t)(rc->row_ms - rc->fix_ms) / 1000.0f : NAN;
}
