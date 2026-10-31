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

typedef enum { STILL, ALTERNATING, SINGLE, NOISE, FLAT, DRIFT, FLICKER } motion_kind;
static float g_drift;

/* One stretch: `seconds` at `hz`, a stroke kind and rate, at `kmh`.
   hz 0: no samples, only track rows (FLICKER: speed 3.9/4.1 alternately).
   no_rows: samples but no track rows. */
typedef struct { float seconds, hz, spm; motion_kind kind; float kmh; int no_rows; } stretch;

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
    case FLAT: case FLICKER: return 0.0f;
    case DRIFT: g_drift = 0.995f * g_drift + 2.0f * rnd(); return g_drift;   /* slow wander */
    }
    return 0.0f;
}

/* Runs the stretches through the core as a device would (samples, then a
   row each second), then replays the files it wrote. */
static void row(rc_state *rc, uint32_t ms, float kmh)
{
    rc_gps g;
    memset(&g, 0, sizeof(g));
    g.fix = g.date_valid = g.time_valid = 1;
    g.year = 2026; g.month = 9; g.day = 13; g.hour = 9;
    g.lat = 51.46; g.lon = -0.97;
    g.speed_valid = 1;
    g.speed_kmh = kmh;
    rc_extras x = { 3900, 0, 1, 20.0f };
    rc_second(rc, ms, &g, &x);
}

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
    int flick = 0;
    for (int i = 0; i < n; i++) {
        if (st[i].hz == 0.0f) {   /* rows only */
            uint32_t end = start_ms + (uint32_t)lround((t0 + st[i].seconds) * 1000.0);
            while ((int32_t)(end - next_row) > 0) {
                float kmh = st[i].kind == FLICKER ? ((flick++ & 1) ? 4.1f : 3.9f) : st[i].kmh;
                row(&rc, next_row, kmh);
                next_row += 1000;
            }
            t0 += st[i].seconds;
            continue;
        }
        uint32_t samples = (uint32_t)lroundf(st[i].seconds * st[i].hz);
        for (uint32_t k = 0; k < samples; k++) {
            double t = t0 + (double)k / st[i].hz;
            uint32_t ms = start_ms + (uint32_t)lround(t * 1000.0);
            while ((int32_t)(ms - next_row) > 0) {   /* rows before this sample; a
                                                        sample in a row's ms goes first */
                if (!st[i].no_rows) row(&rc, next_row, st[i].kmh);
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

/* Every window of a set (and every point) reads within `tol` of `spm`,
   where it gives a rate at all; returns how many did. */
static int all_near(const char *set, double spm, double tol)
{
    const char *b = g_dev.buf[RC_STROKE], *end = b + g_dev.len[RC_STROKE];
    char prefix[32];
    snprintf(prefix, sizeof(prefix), "window,%s,", set);
    size_t pn = strlen(prefix);
    int n = 0;
    for (const char *p = b; p < end; ) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        const char *c = 0;
        if ((size_t)(end - p) >= pn && !memcmp(p, prefix, pn)) {   /* t,cycles,strokes */
            c = p + pn;
            for (int k = 0; k < 2 && c; k++) { c = strchr(c, ','); if (c) c++; }
        } else if (!strcmp(set, "series") && !strncmp(p, "point,", 6)) {
            c = strchr(p + 6, ',');
            if (c) c++;
        }
        if (c) {
            double v = strtod(c, NULL);
            if (fabs(v - spm) > tol) {
                char m[120];
                snprintf(m, sizeof(m), "a %s reading of %.1f (want %.1f +- %.1f)", set, v, spm, tol);
                fail(m);
                return n;
            }
            n++;
        }
        p = nl ? nl + 1 : end;
    }
    return n;
}

/* The window lines of a set that start before `before_ms`, as one string. */
static size_t windows_before(const char *set, uint32_t before_ms, char *out, size_t cap)
{
    const char *b = g_dev.buf[RC_STROKE], *end = b + g_dev.len[RC_STROKE];
    char prefix[32];
    snprintf(prefix, sizeof(prefix), "window,%s,", set);
    size_t pn = strlen(prefix), k = 0;
    for (const char *p = b; p < end; ) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        const char *le = nl ? nl + 1 : end;
        if ((size_t)(end - p) >= pn && !memcmp(p, prefix, pn) && strtoul(p + pn, NULL, 10) < before_ms &&
            k + (size_t)(le - p) < cap) {
            memcpy(out + k, p, (size_t)(le - p));
            k += (size_t)(le - p);
        }
        p = le;
    }
    return k;
}

/* Replays edited copies of the files the last run wrote and checks they read
   the same as the originals (or, with `want_moving` 0, give no moving or
   series windows). */
static char g_t2[CAP], g_m2[CAP];
static void replay_reads(const char *what, size_t tn, size_t mn, int want_moving)
{
    static rc_state rr;
    static out_t o;
    if (!o.buf[RC_STROKE]) o.buf[RC_STROKE] = malloc(CAP);
    o.len[RC_STROKE] = 0;
    rc_config cfg = { on_write, &o, 0 };
    rc_replay(&rr, &cfg, g_t2, tn, g_m2, mn);
    if (want_moving) {
        if (o.len[RC_STROKE] != g_dev.len[RC_STROKE] || memcmp(o.buf[RC_STROKE], g_dev.buf[RC_STROKE], g_dev.len[RC_STROKE])) {
            char m[160];
            snprintf(m, sizeof(m), "%s: replay reads differently", what);
            fail(m);
        }
        return;
    }
    const char *b = o.buf[RC_STROKE], *end = b + o.len[RC_STROKE];
    for (const char *p = b; p < end; ) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        if (!strncmp(p, "window,moving,", 14) || !strncmp(p, "window,series,", 14)) {
            char m[160];
            snprintf(m, sizeof(m), "%s: moving windows without a usable speed column", what);
            fail(m);
            return;
        }
        p = nl ? nl + 1 : end;
    }
}

/* Copies buf line by line: `crlf` ends lines with CR LF; `drop_header`
   leaves out the first line; `pre`/`post` add lines before and after. */
static size_t rewrite(char *out, const char *buf, size_t len, int crlf, int drop_header, const char *pre, const char *post)
{
    size_t k = 0;
    if (pre) { size_t n = strlen(pre); memcpy(out + k, pre, n); k += n; }
    int first = 1;
    for (const char *p = buf, *end = buf + len; p < end; ) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        size_t n = (size_t)((nl ? nl : end) - p);
        if (!(first && drop_header)) {
            memcpy(out + k, p, n); k += n;
            if (crlf) out[k++] = '\r';
            out[k++] = '\n';
        }
        first = 0;
        p = nl ? nl + 1 : end;
    }
    if (post) { size_t n = strlen(post); memcpy(out + k, post, n); k += n; }
    return k;
}

/* The track with only its ms and speed, columns reordered and renamed the
   way older files spell them: "Speed_kmh, MS". */
static size_t two_columns(char *out, const char *ms_name, int with_speed)
{
    size_t k = 0;
    const char *b = g_dev.buf[RC_TRACK], *end = b + g_dev.len[RC_TRACK];
    k += (size_t)snprintf(out + k, CAP - k, with_speed ? "Speed_kmh, sats ,%s,extra\n" : "sats,%s,extra\n", ms_name);
    int first = 1;
    for (const char *p = b; p < end; ) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        if (!first) {
            char line[512];
            size_t n = (size_t)((nl ? nl : end) - p);
            if (n >= sizeof(line)) n = sizeof(line) - 1;
            memcpy(line, p, n); line[n] = 0;
            char *f[32];
            int m = 0;
            f[m++] = line;
            for (char *c = line; *c && m < 32; c++) if (*c == ',') { *c = 0; f[m++] = c + 1; }
            if (m > 8) {
                if (with_speed) k += (size_t)snprintf(out + k, CAP - k, "%s,12,%s,x\n", f[8], f[1]);
                else k += (size_t)snprintf(out + k, CAP - k, "12,%s,x\n", f[1]);
            }
        }
        first = 0;
        p = nl ? nl + 1 : end;
    }
    return k;
}

static int memmem_ok(const char *b, size_t n, const char *needle)
{
    size_t k = strlen(needle);
    for (size_t i = 0; i + k <= n; i++) if (!memcmp(b + i, needle, k)) return 1;
    return 0;
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
        stretch st[] = { { 300, rates[i], 60, ALTERNATING, 8, 0 } };
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
        stretch st[] = { { 300, 43.7f, 50, SINGLE, 8, 0 } };
        run(st, 1, 1000);
        near(median("moving"), 50.0, 1.5, "moving median");
        if (series_ok()) fail("single-sided paddling got a series");
        same_on_replay();
    }
    done(f);

    begin("broadband noise gives no stroke rate, never the band edge"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 0, NOISE, 8, 0 } };
        run(st, 1, 1000);
        if (median("moving") >= 0 || median("all") >= 0) fail("noise read as a stroke rate");
        if (strcmp(reason("moving"), "no_rhythm")) fail("reason isn't no_rhythm");
        same_on_replay();
    }
    done(f);

    begin("parked, then paddling: only the paddling counts"); f = g_fails;
    {
        stretch st[] = { { 600, 43.7f, 0, STILL, 0, 0 }, { 300, 43.7f, 56, ALTERNATING, 8, 0 } };
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
        stretch st[] = { { 300, 43.7f, 56, ALTERNATING, 0, 0 } };
        run(st, 1, 1000);
        if (median("moving") >= 0) fail("a still track gave a moving stroke rate");
        near(median("all"), 56.0, 0.6, "all median (GPS failed: whole recording)");
        if (series_ok()) fail("a still track gave a series");
        same_on_replay();
    }
    done(f);

    begin("a moving run under 90 rows: no stroke rate, but a series (20 rows)"); f = g_fails;
    {
        stretch st[] = { { 120, 43.7f, 0, STILL, 0, 0 }, { 80, 43.7f, 56, ALTERNATING, 8, 0 }, { 120, 43.7f, 0, STILL, 0, 0 } };
        run(st, 3, 1000);
        if (median("moving") >= 0) fail("an 80 s run gave a moving stroke rate");
        if (count("window,series,") < 6) fail("an 80 s run gave too few series windows");
        same_on_replay();
    }
    done(f);

    begin("too slow to carry a stroke (1 Hz)"); f = g_fails;
    {
        stretch st[] = { { 300, 1.0f, 56, ALTERNATING, 8, 0 } };
        run(st, 1, 1000);
        if (strcmp(reason("moving"), "too_slow")) fail("reason isn't too_slow");
        if (count("window,")) fail("windows from data too slow to carry a stroke");
        same_on_replay();
    }
    done(f);

    begin("too few samples"); f = g_fails;
    {
        stretch st[] = { { 5, 10.0f, 56, ALTERNATING, 8, 0 } };
        run(st, 1, 1000);
        if (strcmp(reason("moving"), "too_few_samples")) fail("reason isn't too_few_samples");
        same_on_replay();
    }
    done(f);

    begin("the series follows a change of rate instead of averaging it"); f = g_fails;
    {
        stretch st[] = { { 150, 43.7f, 48, ALTERNATING, 8, 0 }, { 150, 43.7f, 72, ALTERNATING, 8, 0 } };
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
        stretch st[] = { { 150, 43.7f, 56, ALTERNATING, 8, 0 }, { 150, 43.7f, 0, FLAT, 8, 0 }, { 150, 43.7f, 56, ALTERNATING, 8, 0 } };
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
        stretch st[] = { { 120, 43.7f, 0, STILL, 0, 0 }, { 20, 43.7f, 56, ALTERNATING, 8, 0 }, { 60, 43.7f, 0, STILL, 0, 0 },
                         { 120, 43.7f, 56, ALTERNATING, 8, 0 } };
        run(st, 4, 1000);
        double lo, hi;
        if (points(0, 200000, &lo, &hi)) fail("a point from a lone window");
        if (!points(200000, 400000, &lo, &hi)) fail("no points from the paddling after it");
        same_on_replay();
    }
    done(f);

    begin("a still device's slow wander gives no stroke rate (falling correlation: no local peak)"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 0, DRIFT, 8, 0 } };
        run(st, 1, 1000);
        if (median("all") >= 0) fail("slow wander read as a stroke rate (the band edge)");
        same_on_replay();
    }
    done(f);

    begin("the stroke on another gyroscope axis (mounted differently) reads the same"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 60, ALTERNATING, 8, 0 } };
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
        stretch st[] = { { 120, 43.7f, 56, ALTERNATING, 8, 0 }, { 10, 43.7f, 85, ALTERNATING, 8, 0 }, { 120, 43.7f, 56, ALTERNATING, 8, 0 } };
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
        stretch st[] = { { 300, 12.5f, 60, ALTERNATING, 8, 0 } };
        g_spike_ms = 61000;
        run(st, 1, 1000);
        char v[32];
        if (!field("window,all,1000,", 4, v, sizeof(v)) || fabs(strtod(v, NULL) - 60.0) > 0.6)
            fail("the first window took the spike at its end");
        g_spike_ms = 0;
        same_on_replay();
    }
    done(f);

    begin("a hole in the samples (3 s, 10 s) gives no wrong rate: its windows are refused"); f = g_fails;
    {
        stretch st[] = { { 150, 43.7f, 56, ALTERNATING, 8, 0 }, { 3, 0, 0, FLAT, 8, 0 }, { 100, 43.7f, 56, ALTERNATING, 8, 0 },
                         { 10, 0, 0, FLAT, 8, 0 }, { 150, 43.7f, 56, ALTERNATING, 8, 0 } };
        run(st, 5, 1000);
        if (all_near("moving", 56.0, 1.2) < 3) fail("too few moving windows around the holes");
        if (all_near("series", 56.0, 1.2) < 20) fail("too few series points around the holes");
        if (all_near("all", 56.0, 1.2) < 3) fail("too few windows (all) around the holes");
        same_on_replay();
    }
    done(f);

    begin("track rows stopping for 250 s while motion goes on ends the moving run"); f = g_fails;
    {
        stretch st[] = { { 200, 43.7f, 56, ALTERNATING, 8, 0 }, { 250, 43.7f, 56, ALTERNATING, 8, 1 },
                         { 200, 43.7f, 56, ALTERNATING, 8, 0 } };
        run(st, 3, 1000);
        const char *b = g_dev.buf[RC_STROKE], *end = b + g_dev.len[RC_STROKE];
        int during = 0, before = 0, after_gap = 0;
        for (const char *p = b; p < end; ) {
            const char *nl = memchr(p, '\n', (size_t)(end - p));
            if (!strncmp(p, "window,series,", 14) || !strncmp(p, "window,moving,", 14)) {
                unsigned long t = strtoul(p + 14, NULL, 10);
                if (t + 15000 > 201000 + 3000 && t < 451000) during++;
                else if (t < 201000) before++;
                else after_gap++;
            }
            p = nl ? nl + 1 : end;
        }
        if (during) fail("windows accepted while there were no track rows");
        if (!before || !after_gap) fail("no windows before or after the gap");
        same_on_replay();
    }
    done(f);

    begin("speed flickering about 4 km/h in a stall doesn't lose the run before it"); f = g_fails;
    {
        /* The samples stop at 300 s; the boat goes on 5 s, then the speed
           flickers (20 one-row runs). The window [241, 301) closes only when
           the samples come back, and its run must still be there. */
        stretch flick[] = { { 300, 43.7f, 56, ALTERNATING, 8, 0 }, { 5, 0, 0, FLAT, 8, 0 }, { 40, 0, 0, FLICKER, 0, 0 },
                            { 120, 43.7f, 56, ALTERNATING, 8, 0 } };
        stretch still[] = { { 300, 43.7f, 56, ALTERNATING, 8, 0 }, { 5, 0, 0, FLAT, 8, 0 }, { 40, 0, 0, FLAT, 0, 0 },
                            { 120, 43.7f, 56, ALTERNATING, 8, 0 } };
        static char a[1 << 16], b[1 << 16];
        run(still, 4, 1000);
        size_t bn = windows_before("moving", 301000, b, sizeof(b));
        run(flick, 4, 1000);
        size_t an = windows_before("moving", 301000, a, sizeof(a));
        if (!strstr(b, "window,moving,241000,")) fail("the window closed by the stall wasn't kept (the case doesn't test the ring)");
        if (!bn || an != bn || memcmp(a, b, an)) fail("the moving windows before the stall changed");
        same_on_replay();
    }
    done(f);

    begin("the sample rate reported is the first 1,999 gaps' median"); f = g_fails;
    {
        stretch st[] = { { 165, 12.5f, 56, ALTERNATING, 8, 0 }, { 300, 10.0f, 56, ALTERNATING, 8, 0 } };
        run(st, 2, 1000);
        char v[16];
        if (!field("motion,", 2, v, sizeof(v)) || strcmp(v, "12.5")) fail("the rate isn't the first gaps' 12.5 Hz");
        same_on_replay();
    }
    done(f);

    begin("exactly 4.00 km/h is moving, 3.99 isn't"); f = g_fails;
    {
        stretch at4[] = { { 300, 43.7f, 56, ALTERNATING, 4.0f, 0 } };
        run(at4, 1, 1000);
        near(median("moving"), 56.0, 0.6, "at 4.00 km/h");
        stretch under[] = { { 300, 43.7f, 56, ALTERNATING, 3.99f, 0 } };
        run(under, 1, 1000);
        if (median("moving") >= 0) fail("3.99 km/h counted as moving");
    }
    done(f);

    begin("rc_replay reads the files the way older trackers and captures wrote them"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 60, ALTERNATING, 8, 0 } };
        run(st, 1, 1000);
        size_t tn, mn;
        /* CR LF, and a serial-capture marker before and after */
        tn = rewrite(g_t2, g_dev.buf[RC_TRACK], g_dev.len[RC_TRACK], 1, 0, "<<<CAT track.csv>>>\r\n", ">>>\r\n");
        mn = rewrite(g_m2, g_dev.buf[RC_MOTION], g_dev.len[RC_MOTION], 1, 0, "<<<CAT track_i10.csv>>>\r\n", 0);
        replay_reads("CR LF and capture markers", tn, mn, 1);
        /* a motion file with no header */
        tn = rewrite(g_t2, g_dev.buf[RC_TRACK], g_dev.len[RC_TRACK], 0, 0, 0, 0);
        mn = rewrite(g_m2, g_dev.buf[RC_MOTION], g_dev.len[RC_MOTION], 0, 1, 0, 0);
        replay_reads("motion without a header", tn, mn, 1);
        /* the track's columns in another order, spelt another way */
        mn = rewrite(g_m2, g_dev.buf[RC_MOTION], g_dev.len[RC_MOTION], 0, 0, 0, 0);
        tn = two_columns(g_t2, " MS ", 1);
        replay_reads("reordered, renamed track columns", tn, mn, 1);
        /* no speed column: nothing says the boat moved */
        tn = two_columns(g_t2, "ms", 0);
        replay_reads("a track with no speed column", tn, mn, 0);
        /* ms as the last column isn't the header the server looked for */
        tn = (size_t)snprintf(g_t2, CAP, "speed_kmh,ms\n");
        for (uint32_t ms = 2000; ms <= 301000; ms += 1000) tn += (size_t)snprintf(g_t2 + tn, CAP - tn, "8.00,%lu\n", (unsigned long)ms);
        replay_reads("ms as the last column", tn, mn, 0);
        /* speed as the last column of a CR LF file: its cell ends in CR */
        tn = (size_t)snprintf(g_t2, CAP, "ms,speed_kmh\r\n");
        for (uint32_t ms = 2000; ms <= 301000; ms += 1000) tn += (size_t)snprintf(g_t2 + tn, CAP - tn, "%lu,8.00\r\n", (unsigned long)ms);
        replay_reads("speed as the last column, CR LF", tn, mn, 1);
        /* motion lines one column short are not samples */
        tn = rewrite(g_t2, g_dev.buf[RC_TRACK], g_dev.len[RC_TRACK], 0, 0, 0, 0);
        mn = 0;
        for (const char *p = g_dev.buf[RC_MOTION], *end = p + g_dev.len[RC_MOTION]; p < end; ) {
            const char *nl = memchr(p, '\n', (size_t)(end - p));
            const char *le = nl ? nl : end, *last = le;
            while (last > p && last[-1] != ',') last--;
            if (last > p) { memcpy(g_m2 + mn, p, (size_t)(last - 1 - p)); mn += (size_t)(last - 1 - p); g_m2[mn++] = '\n'; }
            p = nl ? nl + 1 : end;
        }
        {
            static rc_state rr;
            static out_t o;
            if (!o.buf[RC_STROKE]) o.buf[RC_STROKE] = malloc(CAP);
            o.len[RC_STROKE] = 0;
            rc_config cfg = { on_write, &o, 0 };
            rc_replay(&rr, &cfg, g_t2, tn, g_m2, mn);
            if (memmem_ok(o.buf[RC_STROKE], o.len[RC_STROKE], "motion,0,")) {} else fail("six-column motion lines were read as samples");
        }
    }
    done(f);

    begin("the ms clock wrapping mid-paddle changes nothing"); f = g_fails;
    {
        stretch st[] = { { 300, 43.7f, 60, ALTERNATING, 8, 0 } };
        run(st, 1, 1000);
        double before = median("moving");
        run(st, 1, 0xffffffffu - 150000u);   /* wraps 150 s in */
        near(median("moving"), before, 0.0, "median across the wrap");
        same_on_replay();
    }
    done(f);

    return g_fails ? 1 : 0;
}
