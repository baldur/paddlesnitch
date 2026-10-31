/*
 * live_values — rc_live and rc_phone_live: the GPS state a recording screen
 * shows ("waiting for GPS", "GPS lost 40 s ago"). The metrics are NAN until
 * their phases; this pins the fix flag and the time since the last fix.
 */
#include "recorder_core.h"
#include "recorder_phone.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

static void discard(void *user, rc_stream s, const char *line, size_t len)
{
    (void)user; (void)s; (void)line; (void)len;
}

static int g_fails;
static void check(int ok, const char *what)
{
    printf("%s live: %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) g_fails++;
}

static int is(const rc_live_values *v, int fix, float since)
{
    if (v->fix != fix) return 0;
    if (isnan(since)) return isnan(v->since_fix_s);
    return fabsf(v->since_fix_s - since) < 0.0005f;
}

static void second(rc_state *rc, uint32_t t_ms, int fix)
{
    rc_gps g;
    rc_extras x;
    memset(&g, 0, sizeof(g));
    memset(&x, 0, sizeof(x));
    if (fix) {
        g.fix = 1;
        g.date_valid = g.time_valid = 1;
        g.year = 2026; g.month = 10; g.day = 31; g.hour = 9;
        g.lat = 51.46; g.lon = -0.97;
    }
    rc_second(rc, t_ms, &g, &x);
}

static rc_state g_rc;
static rc_phone g_phone;

int main(void)
{
    rc_live_values v;
    rc_config cfg = { discard, 0, 0 };

    /* The tracker (the core): what the latest row says. */
    rc_init(&g_rc, &cfg);
    rc_live(&g_rc, &v);
    check(is(&v, 0, NAN), "before any row: no fix, no time since one");
    check(isnan(v.spm) && isnan(v.speed_kmh) && isnan(v.distance_m), "the metrics stay NAN until their phase");
    second(&g_rc, 1000, 0);
    rc_live(&g_rc, &v);
    check(is(&v, 0, NAN), "rows without a fix yet: waiting, no time since one");
    second(&g_rc, 2000, 1);
    rc_live(&g_rc, &v);
    check(is(&v, 1, 0.0f), "a row with a fix: fix, 0 s since");
    second(&g_rc, 3000, 0);
    second(&g_rc, 43000, 0);
    rc_live(&g_rc, &v);
    check(is(&v, 0, 41.0f), "the fix lost: 41 s since the last row with one");
    second(&g_rc, 44000, 1);
    rc_live(&g_rc, &v);
    check(is(&v, 1, 0.0f), "the fix back: 0 s since");

    rc_init(&g_rc, &cfg);
    second(&g_rc, 0xFFFFF000u, 1);
    second(&g_rc, 0x00001000u, 0);
    rc_live(&g_rc, &v);
    check(is(&v, 0, 8.192f), "across the ms clock wrapping");

    /* A phone: the latest tick, even while its row waits for late samples. */
    rc_phone_config pc;
    memset(&pc, 0, sizeof(pc));
    pc.write = discard;
    pc.platform = RC_PHONE_ANDROID;
    pc.motion = 1;     /* rows wait for both sensors: none arrive here */
    rc_phone_init(&g_phone, &pc);
    rc_phone_live(&g_phone, &v);
    check(is(&v, 0, NAN), "phone, before any tick: no fix");
    rc_phone_tick(&g_phone, 1000000000LL, 0);
    rc_phone_live(&g_phone, &v);
    check(is(&v, 0, NAN), "phone, a tick before any location: waiting");

    rc_phone_location loc;
    memset(&loc, 0, sizeof(loc));
    loc.t_ns = 1500000000LL;
    loc.utc_ms = 1793437200000LL;   /* 2026-10-31T09:00:00Z */
    loc.lat = 51.46; loc.lon = -0.97;
    rc_phone_location_update(&g_phone, &loc);
    rc_phone_tick(&g_phone, 2000000000LL, 0);
    rc_phone_live(&g_phone, &v);
    check(is(&v, 1, 0.0f), "phone, a tick with a current fix: fix, though its row still waits");
    rc_live(&g_phone.core, &v);
    check(is(&v, 0, NAN), "(the core has written no row yet: the tick is what a screen needs)");

    rc_phone_tick(&g_phone, 4000000000LL, 0);   /* the fix 2.5 s old: still current */
    rc_phone_tick(&g_phone, 5000000000LL, 0);   /* 3.5 s old: stale */
    rc_phone_tick(&g_phone, 9000000000LL, 0);
    rc_phone_live(&g_phone, &v);
    check(is(&v, 0, 5.0f), "phone, the fix gone stale: 5 s since the last tick with one");

    return g_fails ? 1 : 0;
}
