/*
 * stroke.c — stroke rate as a stream (recorder_core.h, STROKE RATE).
 *
 * Moved from packages/timing/src/cadence.ts, which the server ran over a
 * whole file at once. The maths is the same; what changed is that every
 * figure is built as the lines arrive, so the device and a replay of its
 * files end on the same numbers. Why each step is there:
 *
 *  - The gyroscope axis with the most variance: which axis carries the
 *    stroke depends on how the device sits (pocket, deck, face down).
 *  - The best LOCAL maximum of the autocorrelation in the band, never the
 *    global one: with broadband noise the global maximum sits on the band
 *    edge and reports the edge as a measurement (an early version returned
 *    exactly the band limit for every stationary window).
 *  - Refined between lags (a parabola through the peak): one lag step is
 *    ~10% of a stroke at 5 Hz; at the ~11 Hz we upload, still ~1 spm.
 *  - Alternating left/right strokes mirror each other, so the half-lag
 *    correlation is nearly the inverse of the peak (measured: peak +0.82,
 *    half -0.88, ratio -1.07) and the stroke rate is twice the cycle. The
 *    test is the RATIO: a single-sided pulse train also reaches -0.67 at
 *    half its period (ratio -0.69), so an absolute floor doubles everything.
 *    Calibration debt: the single-sided end is synthetic; it needs a real
 *    canoe or SUP recording.
 *  - Windows wholly inside a moving run: recordings open with ~20 minutes
 *    parked at the launch, and a still device invents a rhythm.
 */
#include "stroke.h"

#if defined(__clang__)
#pragma STDC FP_CONTRACT OFF
#endif

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MIN_CYCLE_HZ      0.2f
#define MAX_CYCLE_HZ      2.0f
#define MIN_CONFIDENCE    0.35f
#define ALTERNATING_RATIO (-0.85f)
#define MIN_SAMPLES       16
#define GATE_MS           80u      /* the RC_MOTION gate, re-applied on replay  */
#define MOVING_KMH        4.0
#define REST_MS           60000u   /* a gap this long between windows: a rest   */
#define RATE_DELTAS       1999u    /* the sample rate: median of the first gaps */
#define MIN_ROWS          64u      /* fewer motion lines: no stroke rate        */
#define MIN_HZ            2.0f
#define HOLE_MS           500u     /* a bigger gap inside a window: no rate     */
#define ROW_GAP_MS        3000u    /* no track row this long: the run ended     */
#define SHORTEST_RUN      20u      /* the fewest rows any set needs             */
/* series: a recording needs this many windows to decide left/right, and this
   share alternating; a point this far from its neighbours' mean is dropped */
#define SERIES_MIN_WINDOWS 6u
#define SERIES_ALT_SHARE10 6u      /* 0.6, in tenths                            */
#define NEIGHBOUR_TOL10    3       /* 0.3, in tenths                            */

enum { SET_MOVING, SET_ALL, SET_SERIES, SETS };

static const struct {
    const char *name;
    uint32_t    window_ms, step_ms, min_rows;   /* min_rows 0: not gated */
} SET[SETS] = {
    { "moving", 60000u, 30000u, 90u },
    { "all",    60000u, 30000u, 0u  },
    { "series", 15000u,  5000u, 20u },
};

/* ---- time on the wrapping 32-bit ms clock ---------------------------- */

static int after(uint32_t a, uint32_t b) { return (int32_t)(a - b) > 0; }
static int at_or_after(uint32_t a, uint32_t b) { return (int32_t)(a - b) >= 0; }

/* ---- reading lines ---------------------------------------------------- */

/* A CSV field as a number, the way the server's JavaScript read it
   (Number(field)): surrounding spaces ignored, empty is 0, anything else
   that isn't wholly a finite number is not a number. */
static int field_number(const char *f, size_t n, double *out)
{
    while (n && (*f == ' ' || *f == '\t')) { f++; n--; }
    while (n && (f[n - 1] == ' ' || f[n - 1] == '\t' || f[n - 1] == '\r')) n--;
    if (n == 0) { *out = 0.0; return 1; }
    char buf[64];
    if (n >= sizeof(buf)) return 0;
    memcpy(buf, f, n);
    buf[n] = 0;
    char *end;
    double v = strtod(buf, &end);
    if (*end != 0 || !isfinite(v)) return 0;
    *out = v;
    return 1;
}

/* Splits a line in place-free: start offset and length of each field. */
static int fields(const char *line, size_t len, size_t *start, size_t *flen, int max)
{
    int n = 0;
    size_t s = 0;
    for (size_t i = 0; i <= len && n < max; i++) {
        if (i == len || line[i] == ',') {
            start[n] = s;
            flen[n] = i - s;
            n++;
            s = i + 1;
        }
    }
    return n;
}

static uint32_t to_ms(double v) { return (uint32_t)(int64_t)v; }

int rcs_parse_motion(const char *line, size_t len, uint32_t *ms, float *gx, float *gy, float *gz)
{
    size_t st[8], fl[8];
    while (len && (line[len - 1] == '\n' || line[len - 1] == '\r')) len--;
    int n = fields(line, len, st, fl, 8);
    if (n < 7) return 0;
    double v[7];
    for (int i = 0; i < 7; i++)
        if (!field_number(line + st[i], fl[i], &v[i])) return 0;
    *ms = to_ms(v[0]);
    /* The gyroscope as a float: what the device has, and what strtof gives
       the replay from the same printed text. */
    *gx = (float)v[4];
    *gy = (float)v[5];
    *gz = (float)v[6];
    return 1;
}

int rcs_parse_row(const char *row, size_t len, int ms_col, int speed_col, uint32_t *ms, double *speed)
{
    size_t st[64], fl[64];
    while (len && (row[len - 1] == '\n' || row[len - 1] == '\r')) len--;
    int n = fields(row, len, st, fl, 64);
    int need = ms_col > speed_col ? ms_col : speed_col;
    if (n <= need) return 0;
    double m;
    if (!field_number(row + st[ms_col], fl[ms_col], &m)) return 0;
    if (!field_number(row + st[speed_col], fl[speed_col], speed)) return 0;
    *ms = to_ms(m);
    return 1;
}

/* ---- writing lines ---------------------------------------------------- */

#if defined(__GNUC__)
__attribute__((format(printf, 2, 3)))
#endif
static void say(const rc_config *cfg, const char *fmt, ...)
{
    char line[160];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(line, sizeof(line), fmt, ap);
    va_end(ap);
    if (n < 0) return;
    if ((size_t)n >= sizeof(line)) { n = (int)sizeof(line) - 1; line[n - 1] = '\n'; }
    cfg->write(cfg->user, RC_STROKE, line, (size_t)n);
}

/* Tenths and thousandths as text: integers, so every platform prints the same. */
#define TENTHS(v)    (v) / 10, (v) % 10
#define THOUSANDS(v) (v) / 1000, (v) % 1000

/* ---- one window -------------------------------------------------------- */

static float axis(const rc_stroke_sample *s, int a) { return a == 0 ? s->gx : a == 1 ? s->gy : s->gz; }

/* The ring index of the k-th held sample. */
static const rc_stroke_sample *held(const rc_stroke *s, uint32_t k)
{
    return &s->ring[(s->ring_head + k) % RC_STROKE_RING];
}

/* Autocorrelation of the detrended axis at one lag, over n samples from k0. */
static float autocorr(const rc_stroke *s, uint32_t k0, uint32_t n, int a, float mean, uint32_t lag, float denom)
{
    float sum = 0.0f;
    for (uint32_t i = 0; i + lag < n; i++)
        sum += (axis(held(s, k0 + i), a) - mean) * (axis(held(s, k0 + i + lag), a) - mean);
    return denom > 0.0f ? sum / denom : 0.0f;
}

/* Orientation-agnostic: whichever gyroscope axis carries the stroke, the one
   with the most variance over n samples from k0. Gives its mean and its sum
   of squares about the mean. The stroke windows and the live trace both
   pick their axis here, so the trace shows the signal the rate is counted
   from. */
static int pick_axis(const rc_stroke *s, uint32_t k0, uint32_t n, float *mean_out, float *ss_out)
{
    int best = -1;
    float best_var = -1.0f, best_mean = 0.0f, denom = 0.0f;
    for (int a = 0; a < 3; a++) {
        float sum = 0.0f;
        for (uint32_t i = 0; i < n; i++) sum += axis(held(s, k0 + i), a);
        float mean = sum / (float)n;
        float ss = 0.0f;                  /* sum of squares about the mean */
        for (uint32_t i = 0; i < n; i++) {
            float d = axis(held(s, k0 + i), a) - mean;
            ss += d * d;
        }
        float var = ss / (float)n;
        if (var > best_var) { best_var = var; best = a; best_mean = mean; denom = ss; }
    }
    *mean_out = best_mean;
    *ss_out = denom;
    return best;
}

/* Analyses [t, t + window): 1 and the result, or 0 for no clear stroke. */
static int analyse(const rc_stroke *s, uint32_t t, uint32_t window_ms, rc_stroke_window *w)
{
    uint32_t k0 = 0, n = 0;
    while (k0 < s->ring_n && !at_or_after(held(s, k0)->ms, t)) k0++;
    while (k0 + n < s->ring_n && after(t + window_ms, held(s, k0 + n)->ms)) n++;
    if (n < MIN_SAMPLES) return 0;

    /* A hole in the samples (a phone that paused, a stalled sensor): lags in
       samples stop being time, and the rate reads low by the hole's share. */
    for (uint32_t i = 1; i < n; i++)
        if (held(s, k0 + i)->ms - held(s, k0 + i - 1)->ms > HOLE_MS) return 0;

    /* The window's own sample rate: n - 1 gaps over its span. */
    uint32_t span = held(s, k0 + n - 1)->ms - held(s, k0)->ms;
    if (span == 0) return 0;
    float fs = 1000.0f * (float)(n - 1) / (float)span;
    if (fs < MIN_HZ) return 0;

    float best_mean, denom;
    int best = pick_axis(s, k0, n, &best_mean, &denom);
    float best_var = denom / (float)n;
    if (best < 0 || best_var <= 0.0f || denom <= 0.0f) return 0;

    int lo = (int)floorf(fs / MAX_CYCLE_HZ);
    if (lo < 2) lo = 2;
    int hi = (int)ceilf(fs / MIN_CYCLE_HZ);
    if (hi > (int)n - 2) hi = (int)n - 2;
    if (hi <= lo + 2) return 0;

    /* The best LOCAL maximum in the band: never the band edge. */
    float prev = autocorr(s, k0, n, best, best_mean, (uint32_t)lo, denom);
    float cur = autocorr(s, k0, n, best, best_mean, (uint32_t)lo + 1, denom);
    float r_before = 0.0f, r_after = 0.0f, peak_r = -1.0f;
    int peak_lag = -1;
    for (int lag = lo + 1; lag < hi; lag++) {
        float next = autocorr(s, k0, n, best, best_mean, (uint32_t)lag + 1, denom);
        if (cur > prev && cur > next && cur > peak_r) {
            peak_r = cur; peak_lag = lag; r_before = prev; r_after = next;
        }
        prev = cur;
        cur = next;
    }
    if (peak_lag < 0 || peak_r < MIN_CONFIDENCE) return 0;

    float lag = (float)peak_lag;
    float curve = r_before - 2.0f * peak_r + r_after;
    if (curve != 0.0f) {
        float shift = 0.5f * (r_before - r_after) / curve;
        if (fabsf(shift) <= 1.0f) lag += shift;
    }

    /* Half the lag, rounded half up as the server's Math.round did. (Either
       way reads the same: a periodic signal's autocorrelation is symmetric
       about half its period.) */
    float half_r = autocorr(s, k0, n, best, best_mean, (uint32_t)(peak_lag + 1) / 2, denom);
    int alternating = peak_r > 0.0f && half_r / peak_r < ALTERNATING_RATIO;
    float cycles = 60.0f * fs / lag;

    w->t_ms = t;
    w->cpm10 = (int)lroundf(cycles * 10.0f);
    w->spm10 = (int)lroundf(cycles * (alternating ? 2.0f : 1.0f) * 10.0f);
    w->alternating = alternating;
    w->conf1000 = (int)lroundf(peak_r * 1000.0f);
    return 1;
}

/* ---- moving runs ------------------------------------------------------- */

/* Is [t, t + window) wholly inside a moving run of at least min_rows rows?
   1 yes, 0 no, -1 not known yet (the run is still going). */
static int inside_run(const rc_stroke *s, uint32_t t, uint32_t window_ms, uint32_t min_rows)
{
    const rc_stroke_run *r = 0;
    for (uint32_t i = 0; i < s->runs_n; i++)       /* the latest run starting by t */
        if (at_or_after(t, s->runs[i].start_ms)) r = &s->runs[i];
    if (!r) return 0;
    /* still going: active, and a row seen within ROW_GAP_MS of the newest
       sample (rows stopping while motion goes on end it) */
    int open = r->active && !after(s->last_sample_ms, r->last_ms + ROW_GAP_MS);
    if (after(t + window_ms, r->last_ms)) return open ? -1 : 0;
    if (r->rows >= min_rows) return 1;
    return open ? -1 : 0;
}

/* ---- accepted windows --------------------------------------------------- */

static void accept_session(rc_stroke_set *set, uint16_t *hist, const rc_config *cfg, const char *name,
                           const rc_stroke_window *w, uint32_t window_ms)
{
    say(cfg, "window,%s,%lu,%d.%d,%d.%d,%d,%d.%03d\n", name, (unsigned long)w->t_ms,
        TENTHS(w->cpm10), TENTHS(w->spm10), w->alternating, THOUSANDS(w->conf1000));
    set->windows++;
    if (w->alternating) set->alternating++;
    int bin = w->spm10 < RC_STROKE_BINS ? w->spm10 : RC_STROKE_BINS - 1;
    if (bin < 0) bin = 0;
    if (hist[bin] < 0xffff) hist[bin]++;

    /* Rests (gaps between windows) and paddling time (windows, overlaps
       merged, each at its own rate): windows arrive in time order. */
    uint32_t to = w->t_ms + window_ms;
    if (set->have_end && at_or_after(w->t_ms, set->end_ms + REST_MS))
        say(cfg, "rest,%s,%lu,%lu\n", name, (unsigned long)set->end_ms, (unsigned long)w->t_ms);
    uint32_t from = set->have_end && after(set->end_ms, w->t_ms) ? set->end_ms : w->t_ms;
    if (after(to, from)) {
        uint32_t d = to - from;
        set->paddling_ms += d;
        set->strokes_x += (uint64_t)(w->spm10 > 0 ? w->spm10 : 0) * d;
    }
    if (!set->have_end || after(to, set->end_ms)) set->end_ms = to;
    set->have_end = 1;
}

/* Series point: the window's centre, at twice the cycle (only alternating
   paddles get a series), kept when it agrees with a neighbour. */
static void point(const rc_config *cfg, const rc_stroke_window *w, const rc_stroke_window *a,
                  const rc_stroke_window *b, uint32_t half_ms, uint32_t near_ms)
{
    uint32_t ms = w->t_ms + half_ms;
    int v = 2 * w->cpm10;   /* tenths: the rounded cycle rate, doubled */
    int sum = 0, k = 0;
    const rc_stroke_window *nb[2] = { a, b };
    for (int i = 0; i < 2; i++) {
        if (!nb[i]) continue;
        uint32_t m = nb[i]->t_ms + half_ms;
        uint32_t d = after(m, ms) ? m - ms : ms - m;
        if (d > near_ms) continue;
        sum += 2 * nb[i]->cpm10;
        k++;
    }
    if (k == 0) return;
    /* |v - sum/k| <= 0.3 * sum/k, in integers */
    int diff = v * k - sum;
    if (diff < 0) diff = -diff;
    if (diff * 10 > NEIGHBOUR_TOL10 * sum) return;
    say(cfg, "point,%lu,%d.%d,%d.%03d\n", (unsigned long)ms, TENTHS(v), THOUSANDS(w->conf1000));
}

static void accept_series(rc_stroke_set *set, const rc_config *cfg, const rc_stroke_window *w)
{
    const uint32_t half = SET[SET_SERIES].window_ms / 2;
    const uint32_t near = SET[SET_SERIES].step_ms * 3 / 2;
    say(cfg, "window,series,%lu,%d.%d,%d.%d,%d,%d.%03d\n", (unsigned long)w->t_ms,
        TENTHS(w->cpm10), TENTHS(w->spm10), w->alternating, THOUSANDS(w->conf1000));
    set->windows++;
    if (w->alternating) set->alternating++;
    if (set->nearby == 2) {
        point(cfg, &set->near[1], &set->near[0], w, half, near);
        set->near[0] = set->near[1];
        set->near[1] = *w;
    } else if (set->nearby == 1) {
        point(cfg, &set->near[0], 0, w, half, near);
        set->near[1] = *w;
        set->nearby = 2;
    } else {
        set->near[0] = *w;
        set->nearby = 1;
    }
}

static void accept(rc_stroke *s, const rc_config *cfg, int k, const rc_stroke_window *w)
{
    if (k == SET_SERIES) accept_series(&s->set[k], cfg, w);
    else accept_session(&s->set[k], s->hist[k], cfg, SET[k].name, w, SET[k].window_ms);
}

/* Passes on the waiting windows the track has now decided, in order. */
static void decide(rc_stroke *s, const rc_config *cfg)
{
    for (int k = 0; k < SETS; k++) {
        rc_stroke_set *set = &s->set[k];
        uint32_t done = 0;
        while (done < set->npending) {
            const rc_stroke_window *w = &set->pending[done];
            int in = inside_run(s, w->t_ms, SET[k].window_ms, SET[k].min_rows);
            if (in < 0) break;
            if (in) accept(s, cfg, k, w);
            done++;
        }
        if (done) {
            memmove(set->pending, set->pending + done, (set->npending - done) * sizeof(set->pending[0]));
            set->npending -= done;
        }
    }
}

static void wait_for_track(rc_stroke *s, const rc_config *cfg, int k, const rc_stroke_window *w)
{
    rc_stroke_set *set = &s->set[k];
    /* Can't happen: a window waits only for its run's 90th (or 20th) row or
       3 s of samples without one, so the next window of its set closes after
       it's decided (at most one waits per set). If it ever does, the oldest
       isn't kept. */
    if (set->npending == RC_STROKE_PENDING) {
        memmove(set->pending, set->pending + 1, (RC_STROKE_PENDING - 1) * sizeof(set->pending[0]));
        set->npending--;
    }
    set->pending[set->npending++] = *w;
    decide(s, cfg);
}

/* ---- the stream -------------------------------------------------------- */

void rcs_init(rc_stroke *s)
{
    memset(s, 0, sizeof(*s));
}

void rcs_sample(rc_stroke *s, const rc_config *cfg, uint32_t ms, float gx, float gy, float gz)
{
    /* The sample rate the file reports: from every line, before the gate. */
    s->rows++;
    if (s->have_last && s->deltas < RATE_DELTAS) {
        int32_t d = (int32_t)(ms - s->last_ms);
        if (d > 0) s->delta_hist[d < 1023 ? d : 1023]++;
        s->deltas++;
    }
    s->have_last = 1;
    s->last_ms = ms;
    s->last_sample_ms = ms;
    if (s->set[SET_MOVING].npending || s->set[SET_SERIES].npending)
        decide(s, cfg);   /* rows may have stopped: their run is over */

    /* The 80 ms gate: a device's RC_MOTION lines pass it already; a file
       sampled faster is thinned the same way. */
    if (s->gate_started && (uint32_t)(ms - s->gate_last_ms) < GATE_MS) return;
    s->gate_started = 1;
    s->gate_last_ms = ms;

    if (!s->started) {
        s->started = 1;
        for (int k = 0; k < SETS; k++) s->set[k].next_t = ms;
    }

    /* Every window this sample closes: [t, t + window) is complete once a
       sample at or after its end arrives. */
    for (int k = 0; k < SETS; k++) {
        rc_stroke_set *set = &s->set[k];
        while (at_or_after(ms, set->next_t + SET[k].window_ms)) {
            rc_stroke_window w;
            if (analyse(s, set->next_t, SET[k].window_ms, &w)) {
                if (SET[k].min_rows == 0) accept(s, cfg, k, &w);
                else wait_for_track(s, cfg, k, &w);
            }
            set->next_t += SET[k].step_ms;
        }
    }

    /* Hold what the open windows still need, then this sample. */
    uint32_t keep = s->set[0].next_t;
    for (int k = 1; k < SETS; k++)
        if (after(keep, s->set[k].next_t)) keep = s->set[k].next_t;
    while (s->ring_n && after(keep, held(s, 0)->ms)) {
        s->ring_head = (s->ring_head + 1) % RC_STROKE_RING;
        s->ring_n--;
    }
    if (s->ring_n == RC_STROKE_RING) {
        s->ring_head = (s->ring_head + 1) % RC_STROKE_RING;
        s->ring_n--;
    }
    rc_stroke_sample *e = &s->ring[(s->ring_head + s->ring_n) % RC_STROKE_RING];
    e->ms = ms; e->gx = gx; e->gy = gy; e->gz = gz;
    s->ring_n++;
}

/* Ends the newest run; one too short for any set is dropped, so a speed
   flickering about 4 km/h can't push a long run out of the ring. */
static void end_run(rc_stroke *s)
{
    rc_stroke_run *r = &s->runs[s->runs_n - 1];
    r->active = 0;
    if (r->rows < SHORTEST_RUN) s->runs_n--;
}

void rcs_row(rc_stroke *s, const rc_config *cfg, uint32_t ms, double speed_kmh)
{
    rc_stroke_run *r = s->runs_n ? &s->runs[s->runs_n - 1] : 0;
    if (r && r->active && after(ms, r->last_ms + ROW_GAP_MS)) {   /* rows stopped */
        end_run(s);
        r = s->runs_n ? &s->runs[s->runs_n - 1] : 0;
    }
    if (speed_kmh >= MOVING_KMH) {
        if (!r || !r->active) {
            if (s->runs_n == RC_STROKE_RUNS) {
                memmove(s->runs, s->runs + 1, (RC_STROKE_RUNS - 1) * sizeof(s->runs[0]));
                s->runs_n--;
            }
            r = &s->runs[s->runs_n++];
            r->start_ms = ms;
            r->rows = 0;
            r->active = 1;
        }
        r->last_ms = ms;
        r->rows++;
        if (r->rows > s->longest_run) s->longest_run = r->rows;
    } else if (r && r->active) {
        end_run(s);
    }
    decide(s, cfg);
}

static int median10(const rc_stroke_set *set, const uint16_t *hist)
{
    uint32_t n = set->windows, lo = (n - 1) / 2, hi = n / 2, seen = 0;
    int a = -1, b = -1;
    for (int v = 0; v < RC_STROKE_BINS && b < 0; v++) {
        seen += hist[v];
        if (a < 0 && seen > lo) a = v;
        if (seen > hi) b = v;
    }
    return (a + b + 1) / 2;   /* the middle two's mean, half up */
}

void rcs_finish(rc_stroke *s, const rc_config *cfg)
{
    /* The recording ends every run: what still waits needed rows that never
       came, so it isn't kept. */
    if (s->runs_n && s->runs[s->runs_n - 1].active) end_run(s);
    decide(s, cfg);
    rc_stroke_set *series = &s->set[SET_SERIES];
    if (series->nearby == 2)
        point(cfg, &series->near[1], &series->near[0], 0,
              SET[SET_SERIES].window_ms / 2, SET[SET_SERIES].step_ms * 3 / 2);
    else if (series->nearby == 1)   /* one window, no neighbour: dropped */
        point(cfg, &series->near[0], 0, 0, SET[SET_SERIES].window_ms / 2, SET[SET_SERIES].step_ms * 3 / 2);

    /* The sample rate: 1000 / the median gap (two middles averaged). */
    uint32_t n = 0;
    for (int d = 0; d < 1024; d++) n += s->delta_hist[d];
    float hz = 0.0f;
    if (n) {
        uint32_t lo = (n - 1) / 2, hi = n / 2, seen = 0;
        int a = -1, b = -1;
        for (int d = 0; d < 1024 && b < 0; d++) {
            seen += s->delta_hist[d];
            if (a < 0 && seen > lo) a = d;
            if (seen > hi) b = d;
        }
        hz = 1000.0f / ((float)(a + b) / 2.0f);
    }
    int hz10 = (int)lroundf(hz * 10.0f);
    say(cfg, "motion,%lu,%d.%d\n", (unsigned long)s->rows, TENTHS(hz10));

    const char *why = s->rows < MIN_ROWS ? "too_few_samples" : hz < MIN_HZ ? "too_slow" : 0;
    for (int k = 0; k < SET_SERIES; k++) {
        const rc_stroke_set *set = &s->set[k];
        const char *reason = why ? why
                           : set->windows ? "ok"
                           : SET[k].min_rows && s->longest_run < SET[k].min_rows ? "not_moving"
                           : "no_rhythm";
        int ok = reason[0] == 'o';
        int med = ok ? median10(set, s->hist[k]) : 0;
        say(cfg, "session,%s,%d,%s,%lu,%d.%d,%llu,%llu\n", SET[k].name, ok, reason,
            (unsigned long)set->windows, TENTHS(med),
            (unsigned long long)((set->paddling_ms + 500) / 1000),
            (unsigned long long)((set->strokes_x + 300000) / 600000));
    }
    int series_ok = !why && series->windows >= SERIES_MIN_WINDOWS &&
                    series->alternating * 10 >= SERIES_ALT_SHARE10 * series->windows;
    say(cfg, "series,%d,%lu,%lu\n", series_ok, (unsigned long)series->windows,
        (unsigned long)series->alternating);
}

/* ---- the live trace (rc_phone_trace) ----------------------------------- */

#define TRACE_MS        10000u  /* the span drawn, back from the newest sample  */
#define NO_SAMPLES_MS   7000u   /* no sample this long: the sensors stopped.
                                   Above a phone's batching (BATCHING in
                                   recorder_phone.h: at most 5 s, plus the
                                   wait for both sensors and the 1 s tick)  */
#define STILL_DPS       1.0f    /* rms under this: the device is lying still
                                   (13 Sep capture, 10 s blocks: parked
                                   0.15-0.25 deg/s; moving >= 4 km/h, 10+)  */
#define SCALE_FLOOR_DPS 5.0f    /* a still device draws nearly flat          */

void rcs_trace(const rc_stroke *s, uint32_t now_ms, uint32_t start_ms, rc_trace *out)
{
    out->n = 0;
    out->axis = -1;
    out->scale_dps = SCALE_FLOOR_DPS;
    /* The last sign of life: the newest sample; before any, the recording's
       start (a sample before the first tick still counts from itself). */
    uint32_t newest = s->ring_n ? held(s, s->ring_n - 1)->ms : start_ms;
    if (after(now_ms, newest) && now_ms - newest >= NO_SAMPLES_MS) { out->status = RC_TRACE_NO_SAMPLES; return; }
    if (!s->ring_n) { out->status = RC_TRACE_STARTING; return; }

    /* The ring always holds the last 10 s: the series windows (15 s every
       5 s) keep it back to at least 10 s before the newest sample. */
    uint32_t k0 = 0;
    while (k0 < s->ring_n && newest - held(s, k0)->ms >= TRACE_MS) k0++;
    if (s->ring_n - k0 > RC_TRACE_MAX) k0 = s->ring_n - RC_TRACE_MAX;
    uint32_t n = s->ring_n - k0;

    float mean, ss;
    int a = pick_axis(s, k0, n, &mean, &ss);
    float peak = 0.0f;
    for (uint32_t i = 0; i < n; i++) {
        const rc_stroke_sample *e = held(s, k0 + i);
        float v = axis(e, a) - mean;
        out->ago_ms[i] = newest - e->ms;
        out->dps[i] = v;
        if (fabsf(v) > peak) peak = fabsf(v);
    }
    out->n = n;
    out->axis = a;
    if (peak > out->scale_dps) out->scale_dps = peak;
    /* One sample has no spread: still, whatever the device is doing. */
    out->status = sqrtf(ss / (float)n) < STILL_DPS ? RC_TRACE_STILL : RC_TRACE_MOTION;
}
