/*
 * recorder_phone.c — see include/recorder_phone.h.
 *
 * Everything is ordered in whole milliseconds, the core's t_ms: a sample and
 * a row in the same millisecond go sample first, as a replay of the files
 * puts them. Ordering in nanoseconds would put a sample 0.3 ms after a row
 * into the next row, and the replay into this one.
 */
#include "recorder_phone.h"

#if defined(__clang__)
#pragma STDC FP_CONTRACT OFF
#endif

#include <math.h>
#include <string.h>

#define G_MS2        9.80665            /* standard gravity, m/s² per g     */
#define DEG_PER_RAD  57.29577951308232  /* 180 / pi                          */
#define STALE_MS     3000               /* a fix older than this is no fix
                                           (firmware/include/gps_fresh.h)    */
#define PAIR_MS      100                /* gyro reading older than this: the
                                           accelerometer sample is unpaired  */
#define IMU_OK_MS    1000               /* no sample this long: motion is
                                           down for the row                  */
/* A fix's date must be real (the tracker's gpsDateOk): Android gives 0 for a
   location with no time. 2025-01-01 and 2100-01-01, in ms since 1970. */
#define UTC_MIN_MS   1735689600000LL
#define UTC_MAX_MS   4102444800000LL

static int64_t to_ms(int64_t t_ns) { return t_ns / 1000000; }

void rc_phone_init(rc_phone *p, const rc_phone_config *cfg)
{
    memset(p, 0, sizeof(*p));
    p->cfg = *cfg;
    p->accel_last = p->gyro_last = p->row_last = p->done_ms = -1;
    p->emitted_ms = p->imu_last = p->tick_last = -1;
    /* Only the battery: a phone's satellite count is often not known, and
       the server drops a row that reads 0 satellites (csv.ts). */
    rc_config core = { cfg->write, cfg->user, cfg->has & RC_HAS_BATT_MV };
    rc_init(&p->core, &core);
}

/* Civil date from days since 1970-01-01 (Howard Hinnant's algorithm). */
static void civil(int64_t days, int *y, int *m, int *d)
{
    int64_t z = days + 719468;
    int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    int64_t doe = z - era * 146097;
    int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    int64_t mp = (5 * doy + 2) / 153;
    *d = (int)(doy - (153 * mp + 2) / 5 + 1);
    *m = (int)(mp < 10 ? mp + 3 : mp - 9);
    *y = (int)(yoe + era * 400 + (*m <= 2));
}

/*
 * The GPS state for a row asked for at `ms`: the latest location, if under
 * 3 s old and dated. The row's time is the fix's plus its age, so a fix
 * reused for a row or two repeats its position but not its time, as the
 * tracker's receiver clock runs on.
 */
static void snapshot(const rc_phone *p, int64_t ms, rc_gps *g)
{
    memset(g, 0, sizeof(*g));
    if (!p->have_location) return;
    const rc_phone_location *l = &p->location;
    int64_t age = ms - to_ms(l->t_ns);
    if (age >= STALE_MS) return;
    if (l->utc_ms < UTC_MIN_MS || l->utc_ms >= UTC_MAX_MS) return;

    int64_t s = (l->utc_ms + (age > 0 ? age : 0)) / 1000;
    int64_t days = s / 86400;
    int64_t sod = s - days * 86400;
    g->fix = 1;
    g->date_valid = g->time_valid = 1;
    civil(days, &g->year, &g->month, &g->day);
    g->hour = (int)(sod / 3600);
    g->minute = (int)(sod / 60 % 60);
    g->second = (int)(sod % 60);
    g->lat = l->lat;
    g->lon = l->lon;
    g->alt_valid = l->alt_valid;       g->alt_m = l->alt_m;
    g->speed_valid = l->speed_valid;   g->speed_kmh = l->speed_ms * 3.6;
    g->course_valid = l->course_valid; g->course_deg = l->course_deg;
}

/* Every sample with ms below this is known: both sensors have passed it. */
static int64_t watermark(const rc_phone *p)
{
    if (!p->cfg.motion) return INT64_MAX;
    if (p->accel_last < 0 || p->gyro_last < 0) return -1;
    return p->accel_last < p->gyro_last ? p->accel_last : p->gyro_last;
}

static void write_row(rc_phone *p, const rc_phone_row *r)
{
    rc_extras x = r->extras;
    x.imu_ok = p->cfg.motion && p->imu_last >= 0 && r->ms - p->imu_last < IMU_OK_MS;
    rc_second(&p->core, (uint32_t)r->ms, &r->gps, &x);
    p->done_ms = r->ms;
}

static void pass_sample(rc_phone *p, int is_gyro, const rc_phone_event *e)
{
    p->emitted_ms = e->ms;
    if (is_gyro) {
        p->gyro_now = *e;
        p->have_gyro = 1;
        return;
    }
    if (!p->have_gyro || e->ms - p->gyro_now.ms > PAIR_MS) {
        p->dropped_unpaired++;
        return;
    }
    rc_imu(&p->core, (uint32_t)e->ms, e->x, e->y, e->z,
           p->gyro_now.x, p->gyro_now.y, p->gyro_now.z);
    p->imu_last = e->ms;
}

/*
 * Passes on the earliest thing held: a sample, or a row once every sample
 * up to it has gone (samples first on a tie; the gyroscope before the
 * accelerometer, so the pair uses it). Without `force`, only what nothing
 * can still arrive before. Returns 0 when there's nothing it may pass on.
 */
static int step(rc_phone *p, int force)
{
    const rc_phone_event *a = p->accel_n ? &p->accel[p->accel_head] : 0;
    const rc_phone_event *g = p->gyro_n ? &p->gyro[p->gyro_head] : 0;
    int use_gyro = g && (!a || g->ms <= a->ms);
    const rc_phone_event *e = use_gyro ? g : a;
    const rc_phone_row *r = p->rows_n ? &p->rows[p->rows_head] : 0;
    int64_t w = watermark(p);

    if (r && (!e || e->ms > r->ms)) {
        if (!force && r->ms >= w) return 0;
        write_row(p, r);
        p->rows_head = (p->rows_head + 1) % RC_PHONE_ROWS;
        p->rows_n--;
        return 1;
    }
    if (!e) return 0;
    if (!force && e->ms >= w) return 0;
    pass_sample(p, use_gyro, e);
    if (use_gyro) { p->gyro_head = (p->gyro_head + 1) % RC_PHONE_EVENTS; p->gyro_n--; }
    else          { p->accel_head = (p->accel_head + 1) % RC_PHONE_EVENTS; p->accel_n--; }
    return 1;
}

static void drain(rc_phone *p) { while (step(p, 0)) {} }

/* A sample that can no longer be placed in time order: its row is written,
   or a later sample has gone, or its own sensor went backwards. */
static int too_late(const rc_phone *p, int64_t ms, int64_t stream_last)
{
    return ms <= p->done_ms || ms < p->emitted_ms || ms < stream_last;
}

static void push(rc_phone *p, int is_gyro, int64_t t_ns, float x, float y, float z)
{
    if (!p->cfg.motion) return;
    int64_t ms = to_ms(t_ns);
    rc_phone_event *buf = is_gyro ? p->gyro : p->accel;
    uint32_t *head = is_gyro ? &p->gyro_head : &p->accel_head;
    uint32_t *n = is_gyro ? &p->gyro_n : &p->accel_n;
    int64_t *last = is_gyro ? &p->gyro_last : &p->accel_last;

    if (too_late(p, ms, *last)) { p->dropped_late++; return; }
    while (*n == RC_PHONE_EVENTS) step(p, 1);   /* full: the oldest goes on */
    rc_phone_event *e = &buf[(*head + *n) % RC_PHONE_EVENTS];
    e->ms = ms; e->x = x; e->y = y; e->z = z;
    (*n)++;
    *last = ms;
    drain(p);
}

void rc_phone_accel(rc_phone *p, int64_t t_ns, double x, double y, double z)
{
    /* 0 - x, not -x: a reading of exactly 0 stays 0, not -0 ("-0.0000"). */
    if (p->cfg.platform == RC_PHONE_IOS)
        push(p, 0, t_ns, (float)(0.0 - x), (float)(0.0 - y), (float)(0.0 - z));
    else
        push(p, 0, t_ns, (float)(x / G_MS2), (float)(y / G_MS2), (float)(z / G_MS2));
}

void rc_phone_gyro(rc_phone *p, int64_t t_ns, double x, double y, double z)
{
    push(p, 1, t_ns, (float)(x * DEG_PER_RAD), (float)(y * DEG_PER_RAD), (float)(z * DEG_PER_RAD));
}

void rc_phone_location_update(rc_phone *p, const rc_phone_location *loc)
{
    p->location = *loc;
    p->have_location = 1;
}

void rc_phone_tick(rc_phone *p, int64_t t_ns, unsigned batt_mv)
{
    int64_t ms = to_ms(t_ns);
    if (ms <= p->tick_last) return;     /* the same tick again (or a clock gone back) */
    p->tick_last = ms;
    /* The app's timer fired late (it's on a busy queue), after samples or a
       row later than it: write the row after them, never drop it. Its window
       is still exactly the samples a replay puts in it. */
    if (ms < p->emitted_ms) ms = p->emitted_ms;
    if (ms <= p->row_last) ms = p->row_last + 1;
    while (p->rows_n == RC_PHONE_ROWS) step(p, 1);   /* a sensor stopped */
    rc_phone_row *r = &p->rows[(p->rows_head + p->rows_n) % RC_PHONE_ROWS];
    r->ms = ms;
    snapshot(p, ms, &r->gps);
    /* The live GPS state on the row's clock (ms, moved after late samples),
       the one snapshot() judged the fix at, so it agrees with the rows. */
    p->tick_fix = r->gps.fix;
    p->tick_ms = ms;
    if (r->gps.fix) { p->tick_fixed = 1; p->tick_fix_ms = ms; }
    memset(&r->extras, 0, sizeof(r->extras));
    r->extras.batt_mv = batt_mv;
    p->rows_n++;
    p->row_last = ms;
    drain(p);
}

void rc_phone_finish(rc_phone *p)
{
    while (step(p, 1)) {}
    rc_finish(&p->core);
}

void rc_phone_live(const rc_phone *p, rc_live_values *out)
{
    rc_live(&p->core, out);
    out->fix = p->tick_last >= 0 && p->tick_fix;
    out->since_fix_s = p->tick_fixed ? (float)(p->tick_ms - p->tick_fix_ms) / 1000.0f : NAN;
}

uint32_t rc_phone_dropped_late(const rc_phone *p) { return p->dropped_late; }
uint32_t rc_phone_dropped_unpaired(const rc_phone *p) { return p->dropped_unpaired; }
