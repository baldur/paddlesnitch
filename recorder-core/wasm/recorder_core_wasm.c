/*
 * The recorder core for WebAssembly: the server's build (phase 2 replays
 * uploaded recordings through it). A thin shim over recorder_core.h that
 * takes plain numbers, since JavaScript can't build C structs:
 *
 *   rcw_init(has)                 a new recording (RC_HAS_* bits)
 *   rcw_imu(t_ms, ax..gz)         rc_imu
 *   rcw_second(t_ms, ...)         rc_second, every rc_gps and rc_extras
 *                                 field in header order
 *   rcw_finish()                  rc_finish
 *   rcw_alloc(n) / rcw_free(p)    memory to pass files in
 *   rcw_replay(track, n, motion, n)  rc_replay: the server's way in, which
 *                                 writes only RC_STROKE lines
 *
 * Lines come back through one import, env.rcw_write(stream, ptr, len): the
 * line's bytes are in the module's memory at ptr and only valid during the
 * call. One recording per module instance; instantiate another for the next.
 * wasm/run_fixtures.mjs replays the fixtures through this build.
 */
#include "recorder_core.h"

#include <stdlib.h>

__attribute__((import_module("env"), import_name("rcw_write")))
extern void rcw_write(int stream, const char *line, size_t len);

static rc_state g_rc;

static void on_write(void *user, rc_stream s, const char *line, size_t len)
{
    (void)user;
    rcw_write((int)s, line, len);
}

__attribute__((export_name("rcw_init")))
void rcw_init(uint32_t has)
{
    rc_config cfg = { on_write, 0, has };
    rc_init(&g_rc, &cfg);
}

__attribute__((export_name("rcw_finish")))
void rcw_finish(void)
{
    rc_finish(&g_rc);
}

/* The shim may allocate; the core never does. */
__attribute__((export_name("rcw_alloc")))
void *rcw_alloc(size_t n)
{
    return malloc(n ? n : 1);
}

__attribute__((export_name("rcw_free")))
void rcw_free(void *p)
{
    free(p);
}

__attribute__((export_name("rcw_replay")))
void rcw_replay(const char *track, size_t track_len, const char *motion, size_t motion_len)
{
    static rc_state rc;
    rc_config cfg = { on_write, 0, 0 };
    rc_replay(&rc, &cfg, track, track_len, motion, motion_len);
}

__attribute__((export_name("rcw_imu")))
void rcw_imu(uint32_t t_ms, float ax, float ay, float az, float gx, float gy, float gz)
{
    rc_imu(&g_rc, t_ms, ax, ay, az, gx, gy, gz);
}

__attribute__((export_name("rcw_second")))
void rcw_second(uint32_t t_ms, int fix,
                int date_valid, int year, int month, int day,
                int time_valid, int hour, int minute, int second,
                double lat, double lon,
                int alt_valid, double alt_m, int speed_valid, double speed_kmh,
                int course_valid, double course_deg, int sats_valid, unsigned sats,
                int hdop_valid, double hdop,
                unsigned batt_mv, unsigned tx_seq, int imu_ok, float imu_temp_c)
{
    rc_gps g;
    rc_extras x;
    g.fix = fix;
    g.date_valid = date_valid; g.year = year; g.month = month; g.day = day;
    g.time_valid = time_valid; g.hour = hour; g.minute = minute; g.second = second;
    g.lat = lat; g.lon = lon;
    g.alt_valid = alt_valid;       g.alt_m = alt_m;
    g.speed_valid = speed_valid;   g.speed_kmh = speed_kmh;
    g.course_valid = course_valid; g.course_deg = course_deg;
    g.sats_valid = sats_valid;     g.sats = sats;
    g.hdop_valid = hdop_valid;     g.hdop = hdop;
    x.batt_mv = batt_mv; x.tx_seq = tx_seq; x.imu_ok = imu_ok; x.imu_temp_c = imu_temp_c;
    rc_second(&g_rc, t_ms, &g, &x);
}
