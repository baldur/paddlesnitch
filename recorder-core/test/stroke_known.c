/*
 * stroke_known — stroke rate on synthetic signals with known answers, each
 * also replayed from the files it wrote (streaming = batch).
 *
 * The signals are the ones the server's tests used (apps/web/src/tests/
 * tracker-fixtures.ts, sidecar()): alternating paddling as a smooth swing,
 * one cycle per PAIR of strokes; single-sided as a pulse at every stroke.
 */
#include "recorder_core.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CAP (8u << 20)

typedef struct { char *buf[4]; size_t len[4]; } out_t;
static out_t g_dev, g_rep;

static void on_write(void *user, rc_stream s, const char *line, size_t len)
{
    out_t *o = (out_t *)user;
    if (o->len[s] + len > CAP) return;
    memcpy(o->buf[s] + o->len[s], line, len);
    o->len[s] += len;
}

static uint32_t g_seed;
static float rnd(void)   /* -1..1, the same generator the server's tests used */
{
    g_seed = (g_seed * 1103515245u + 12345u) & 0x7fffffffu;
    return ((float)g_seed / (float)0x7fffffff - 0.5f) * 2.0f;
}

typedef enum { STILL, ALTERNATING, SINGLE, NOISE, FLAT, DRIFT } motion_kind;
static float g_drift;

/* One stretch: `seconds` at `hz`, a stroke kind and rate, at `kmh`. */
typedef struct { float seconds, hz, spm; motion_kind kind; float kmh; } stretch;

static float gyro(motion_kind k, float t, float spm)
{
    float period = 60.0f / spm, amp = 40.0f;
    switch (k) {
    case ALTERNATING: return amp * sinf(3.14159265f * t / period) + 2.0f * rnd();
    case SINGLE: {
        float ph = t / period - floorf(t / period) - 0.5f;
        return amp * expf(-(ph * ph) / (2.0f * 0.12f * 0.12f)) + 2.0f * rnd();
    }
    case NOISE: return 3.0f * rnd();
    case STILL: return 0.2f * rnd();
    case FLAT: return 0.0f;
    case DRIFT: g_drift = 0.995f * g_drift + 2.0f * rnd(); return g_drift;   /* slow wander */
    }
    return 0.0f;
}

/* Runs the stretches through the core as a device would (samples, then a
   row each second), then replays the files it wrote. */
static int g_axis = 1;            /* which gyroscope axis carries the stroke */
static int g_others_noise;        /* the other two axes: noise, not copies */
static uint32_t g_spike_ms;       /* a sample at exactly this ms is a spike */

static void run(const stretch *st, int n, uint32_t start_ms)
{
    static rc_state rc, rr;
    for (int s = 0; s < 4; s++) { g_dev.len[s] = 0; g_rep.len[s] = 0; }
    g_seed = 7;
    g_drift = 0.0f;
    rc_config cfg = { on_write, &g_dev, RC_HAS_TRACKER };
    rc_init(&rc, &cfg);
    double t0 = 0.0;
    uint32_t next_row = start_ms + 1000;
    for (int i = 0; i < n; i++) {
        uint32_t samples = (uint32_t)lroundf(st[i].seconds * st[i].hz);
        for (uint32_t k = 0; k < samples; k++) {
            double t = t0 + (double)k / st[i].hz;
            uint32_t ms = start_ms + (uint32_t)lround(t * 1000.0);
            while ((int32_t)(ms - next_row) > 0) {   /* rows before this sample; a
                                                        sample in a row's ms goes first */
                rc_gps g;
                memset(&g, 0, sizeof(g));
                g.fix = g.date_valid = g.time_valid = 1;
                g.year = 2026; g.month = 9; g.day = 13; g.hour = 9;
                g.lat = 51.46; g.lon = -0.97;
                g.speed_valid = 1;
                g.speed_kmh = st[i].kmh;
                rc_extras x = { 3900, 0, 1, 20.0f };
                rc_second(&rc, next_row, &g, &x);
                next_row += 1000;
            }
            float g = gyro(st[i].kind, (float)t, st[i].spm > 0 ? st[i].spm : 1.0f);
            float ax[3] = { g * 0.2f, g * 0.4f, g * 0.4f };
            if (g_others_noise) { ax[0] = 3.0f * rnd(); ax[1] = 3.0f * rnd(); ax[2] = 3.0f * rnd(); }
            ax[g_axis] = g;
            if (g_spike_ms && ms == g_spike_ms) ax[0] = 900.0f;
            rc_imu(&rc, ms, 0.01f, 0.02f, 1.0f, ax[0], ax[1], ax[2]);
        }
        t0 += (double)samples / st[i].hz;
    }
    rc_finish(&rc);

    rc_config rcfg = { on_write, &g_rep, 0 };
    rc_replay(&rr, &rcfg, g_dev.buf[RC_TRACK], g_dev.len[RC_TRACK], g_dev.buf[RC_MOTION], g_dev.len[RC_MOTION]);
}

static int g_fails;
static const char *g_case;

static void fail(const char *what)
{
    fprintf(stderr, "FAIL %s: %s\n", g_case, what);
    g_fails++;
}

/* The value of a field of the first RC_STROKE line starting with prefix. */
static int field(const char *prefix, int idx, char *out, size_t cap)
{
    const char *b = g_dev.buf[RC_STROKE], *end = b + g_dev.len[RC_STROKE];
    size_t pn = strlen(prefix);
    for (const char *p = b; p < end; ) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        const char *le = nl ? nl : end;
        if ((size_t)(le - p) >= pn && !memcmp(p, prefix, pn)) {
            int f = 0;
            const char *c = p;
            while (f < idx && c < le) { if (*c == ',') f++; c++; }
            if (f < idx) return 0;
            size_t k = 0;
            while (c < le && *c != ',' && k < cap - 1) out[k++] = *c++;
            out[k] = 0;
            return 1;
        }
        p = nl ? nl + 1 : end;
    }
    return 0;
}

static double median(const char *set)
{
    char prefix[32], v[32];
    snprintf(prefix, sizeof(prefix), "session,%s,", set);
    if (!field(prefix, 2, v, sizeof(v)) || strcmp(v, "1")) return -1.0;   /* not available */
    field(prefix, 5, v, sizeof(v));
    return strtod(v, NULL);
}

static const char *reason(const char *set)
{
    static char v[32];
    char prefix[32];
    snprintf(prefix, sizeof(prefix), "session,%s,", set);
    return field(prefix, 3, v, sizeof(v)) ? v : "?";
}

static int series_ok(void)
{
    char v[8];
    return field("series,", 1, v, sizeof(v)) && !strcmp(v, "1");
}

/* Points between from and to ms: how many, and their range. */
static int points(uint32_t from, uint32_t to, double *lo, double *hi)
{
    const char *b = g_dev.buf[RC_STROKE], *end = b + g_dev.len[RC_STROKE];
    int n = 0;
    *lo = 1e9; *hi = -1e9;
    for (const char *p = b; p < end; ) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        if (!strncmp(p, "point,", 6)) {
            char *c;
            unsigned long ms = strtoul(p + 6, &c, 10);
            double spm = strtod(c + 1, NULL);
            if (ms >= from && ms < to) {
                n++;
                if (spm < *lo) *lo = spm;
                if (spm > *hi) *hi = spm;
            }
        }
        p = nl ? nl + 1 : end;
    }
    return n;
}

static int count(const char *prefix)
{
    const char *b = g_dev.buf[RC_STROKE], *end = b + g_dev.len[RC_STROKE];
    int n = 0;
    size_t pn = strlen(prefix);
    for (const char *p = b; p < end; ) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        if ((size_t)(end - p) >= pn && !memcmp(p, prefix, pn)) n++;
        p = nl ? nl + 1 : end;
    }
    return n;
}

static void same_on_replay(void)
{
    if (g_rep.len[RC_STROKE] != g_dev.len[RC_STROKE] ||
        memcmp(g_rep.buf[RC_STROKE], g_dev.buf[RC_STROKE], g_dev.len[RC_STROKE]))
        fail("replaying the files gives different stroke lines (streaming != batch)");
}

/* A file faster than the uploaded one (the raw 50 Hz) reads the same: the
   replay thins it by time as the device did. Only the motion line differs:
   it reports the file's own lines and rate. */
static const char *skip_motion_line(const char *b, size_t *len)
{
    const char *p = b, *end = b + *len;
    while (p < end) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        if (!strncmp(p, "motion,", 7)) {   /* the finish lines follow it */
            const char *after_line = nl ? nl + 1 : end;
            static char tmp[1 << 20];
            size_t head = (size_t)(p - b), tail = (size_t)(end - after_line);
            if (head + tail > sizeof(tmp)) return b;
            memcpy(tmp, b, head);
            memcpy(tmp + head, after_line, tail);
            *len = head + tail;
            return tmp;
        }
        p = nl ? nl + 1 : end;
    }
    return b;
}
static void raw_reads_the_same(void)
{
    static rc_state rr;
    static out_t raw;
    if (!raw.buf[RC_STROKE]) raw.buf[RC_STROKE] = malloc(CAP);
    raw.len[RC_STROKE] = 0;
    rc_config cfg = { on_write, &raw, 0 };
    rc_replay(&rr, &cfg, g_dev.buf[RC_TRACK], g_dev.len[RC_TRACK], g_dev.buf[RC_MOTION_RAW], g_dev.len[RC_MOTION_RAW]);
    static char dev_copy[1 << 20];
    size_t dn = g_dev.len[RC_STROKE], rn = raw.len[RC_STROKE];
    if (dn > sizeof(dev_copy)) { fail("stroke lines too long for the check"); return; }
    memcpy(dev_copy, g_dev.buf[RC_STROKE], dn);
    const char *d = skip_motion_line(dev_copy, &dn);
    static char dkeep[1 << 20];
    memcpy(dkeep, d, dn);
    const char *r = skip_motion_line(raw.buf[RC_STROKE], &rn);
    if (rn != dn || memcmp(r, dkeep, dn))
        fail("the raw file replayed gives different stroke lines from the uploaded one");
}

static void near(double got, double want, double tol, const char *what)
{
    if (got < 0 || fabs(got - want) > tol) {
        char m[160];
        snprintf(m, sizeof(m), "%s: %.1f (want %.1f +- %.1f)", what, got, want, tol);
        fail(m);
    }
}

static void begin(const char *name) { g_case = name; }
static void done(int before) { if (g_fails == before) printf("ok   stroke: %s\n", g_case); }

int main(void)
{
    for (int s = 0; s < 4; s++) { g_dev.buf[s] = malloc(CAP); g_rep.buf[s] = malloc(CAP); }
    int f;

    /* 60 spm alternating reads 60, at the tracker's uploaded rate (~10.9 Hz
       after the 80 ms gate) and a phone's (12.5 Hz), not 30. */
    float rates[] = { 43.7f, 50.0f, 10.0f };
    const char *names[] = { "60 spm alternating at the tracker's 43.7 Hz reads 60",
                            "60 spm alternating at a phone's 50 Hz reads 60",
                            "60 spm alternating at 10 Hz reads 60" };
    for (int i = 0; i < 3; i++) {
        begin(names[i]); f = g_fails;
        stretch st[] = { { 300, rates[i], 60, ALTERNATING, 8 } };
        run(st, 1, 1000);
        near(median("moving"), 60.0, 0.6, "moving median");
        near(median("all"), 60.0, 0.6, "all median");
        if (!series_ok()) fail("no series for alternating paddling");
        double lo, hi;
        int n = points(0, 400000, &lo, &hi);
        if (n < 40 || lo < 58.0 || hi > 62.0) fail("series points not all about 60");
        same_on_replay();
        raw_reads_the_same();
        done(f);
    }

    begin("single-sided 50 spm is not doubled, and gets no series yet"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 50, SINGLE, 8 } };
        run(st, 1, 1000);
        near(median("moving"), 50.0, 1.5, "moving median");
        if (series_ok()) fail("single-sided paddling got a series");
        same_on_replay();
    }
    done(f);

    begin("broadband noise gives no stroke rate, never the band edge"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 0, NOISE, 8 } };
        run(st, 1, 1000);
        if (median("moving") >= 0 || median("all") >= 0) fail("noise read as a stroke rate");
        if (strcmp(reason("moving"), "no_rhythm")) fail("reason isn't no_rhythm");
        same_on_replay();
    }
    done(f);

    begin("parked, then paddling: only the paddling counts"); f = g_fails;
    {
        stretch st[] = { { 600, 43.7f, 0, STILL, 0 }, { 300, 43.7f, 56, ALTERNATING, 8 } };
        run(st, 2, 1000);
        near(median("moving"), 56.0, 0.6, "moving median");
        char v[32];
        if (!field("window,moving,", 2, v, sizeof(v)) || strtoul(v, NULL, 10) < 600000)
            fail("a moving window starts in the parked minutes");
        same_on_replay();
    }
    done(f);

    begin("a track that never moves gives no stroke rate (ungated: the motion alone)"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 56, ALTERNATING, 0 } };
        run(st, 1, 1000);
        if (median("moving") >= 0) fail("a still track gave a moving stroke rate");
        near(median("all"), 56.0, 0.6, "all median (GPS failed: whole recording)");
        if (series_ok()) fail("a still track gave a series");
        same_on_replay();
    }
    done(f);

    begin("a moving run under 90 rows: no stroke rate, but a series (20 rows)"); f = g_fails;
    {
        stretch st[] = { { 120, 43.7f, 0, STILL, 0 }, { 80, 43.7f, 56, ALTERNATING, 8 }, { 120, 43.7f, 0, STILL, 0 } };
        run(st, 3, 1000);
        if (median("moving") >= 0) fail("an 80 s run gave a moving stroke rate");
        if (count("window,series,") < 6) fail("an 80 s run gave too few series windows");
        same_on_replay();
    }
    done(f);

    begin("too slow to carry a stroke (1 Hz)"); f = g_fails;
    {
        stretch st[] = { { 300, 1.0f, 56, ALTERNATING, 8 } };
        run(st, 1, 1000);
        if (strcmp(reason("moving"), "too_slow")) fail("reason isn't too_slow");
        if (count("window,")) fail("windows from data too slow to carry a stroke");
        same_on_replay();
    }
    done(f);

    begin("too few samples"); f = g_fails;
    {
        stretch st[] = { { 5, 10.0f, 56, ALTERNATING, 8 } };
        run(st, 1, 1000);
        if (strcmp(reason("moving"), "too_few_samples")) fail("reason isn't too_few_samples");
        same_on_replay();
    }
    done(f);

    begin("the series follows a change of rate instead of averaging it"); f = g_fails;
    {
        stretch st[] = { { 150, 43.7f, 48, ALTERNATING, 8 }, { 150, 43.7f, 72, ALTERNATING, 8 } };
        run(st, 2, 1000);
        double lo, hi;
        if (!points(20000, 120000, &lo, &hi) || lo < 45 || hi > 51) fail("first stretch not about 48");
        if (!points(180000, 280000, &lo, &hi) || lo < 68 || hi > 76) fail("second stretch not about 72");
        same_on_replay();
    }
    done(f);

    begin("a rest is a gap in the series and a rest line, never a zero"); f = g_fails;
    {
        /* 150 s: the 60 s windows reach 30 s into it from each side */
        stretch st[] = { { 150, 43.7f, 56, ALTERNATING, 8 }, { 150, 43.7f, 0, FLAT, 8 }, { 150, 43.7f, 56, ALTERNATING, 8 } };
        run(st, 3, 1000);
        double lo, hi;
        if (points(175000, 280000, &lo, &hi)) fail("points in the rest");
        if (points(0, 400000, &lo, &hi) && lo < 50) fail("a point below 50 spm");
        if (count("rest,all,") != 1) fail("no single rest line (all)");
        same_on_replay();
    }
    done(f);

    begin("a lone window with no neighbour is dropped"); f = g_fails;
    {
        /* exactly 20 moving rows: room for one 15 s window */
        stretch st[] = { { 120, 43.7f, 0, STILL, 0 }, { 20, 43.7f, 56, ALTERNATING, 8 }, { 60, 43.7f, 0, STILL, 0 },
                         { 120, 43.7f, 56, ALTERNATING, 8 } };
        run(st, 4, 1000);
        double lo, hi;
        if (points(0, 200000, &lo, &hi)) fail("a point from a lone window");
        if (!points(200000, 400000, &lo, &hi)) fail("no points from the paddling after it");
        same_on_replay();
    }
    done(f);

    begin("a still device's slow wander gives no stroke rate (falling correlation: no local peak)"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 0, DRIFT, 8 } };
        run(st, 1, 1000);
        if (median("all") >= 0) fail("slow wander read as a stroke rate (the band edge)");
        same_on_replay();
    }
    done(f);

    begin("the stroke on another gyroscope axis (mounted differently) reads the same"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 60, ALTERNATING, 8 } };
        g_others_noise = 1;
        for (int a = 0; a < 3; a += 2) {
            g_axis = a;
            run(st, 1, 1000);
            near(median("moving"), 60.0, 0.6, a == 0 ? "stroke on x" : "stroke on z");
            same_on_replay();
        }
        g_axis = 1;
        g_others_noise = 0;
    }
    done(f);

    begin("a burst 50% faster doesn't reach the series (neighbours disagree)"); f = g_fails;
    {
        /* not a harmonic: twice the rate still correlates at the slower lag */
        stretch st[] = { { 120, 43.7f, 56, ALTERNATING, 8 }, { 10, 43.7f, 85, ALTERNATING, 8 }, { 120, 43.7f, 56, ALTERNATING, 8 } };
        run(st, 3, 1000);
        double lo, hi;
        points(0, 400000, &lo, &hi);
        if (hi > 75.0) fail("a point from the burst");
        const char *b = g_dev.buf[RC_STROKE], *end = b + g_dev.len[RC_STROKE];
        int fast = 0;
        for (const char *p = b; p < end; ) {
            const char *nl = memchr(p, '\n', (size_t)(end - p));
            if (!strncmp(p, "window,series,", 14)) {
                const char *c = p + 14;
                for (int k = 0; k < 2 && c; k++) { c = strchr(c, ','); if (c) c++; }
                if (c && strtod(c, NULL) > 75.0) fast++;
            }
            p = nl ? nl + 1 : end;
        }
        if (!fast) fail("no series window read the burst (the case doesn't test the check)");
        same_on_replay();
    }
    done(f);

    begin("a sample exactly at a window's end belongs to the next window"); f = g_fails;
    {
        /* 12.5 Hz exactly, so a sample falls on every window's end; the
           one at 61000 (the first window's end) is a spike. */
        stretch st[] = { { 300, 12.5f, 60, ALTERNATING, 8 } };
        g_spike_ms = 61000;
        run(st, 1, 1000);
        char v[32];
        if (!field("window,all,1000,", 4, v, sizeof(v)) || fabs(strtod(v, NULL) - 60.0) > 0.6)
            fail("the first window took the spike at its end");
        g_spike_ms = 0;
        same_on_replay();
    }
    done(f);

    begin("the ms clock wrapping mid-paddle changes nothing"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 60, ALTERNATING, 8 } };
        run(st, 1, 1000);
        double before = median("moving");
        run(st, 1, 0xffffffffu - 150000u);   /* wraps 150 s in */
        near(median("moving"), before, 0.0, "median across the wrap");
        same_on_replay();
    }
    done(f);

    return g_fails ? 1 : 0;
}
