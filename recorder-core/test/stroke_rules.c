/*
 * stroke_rules — the stroke stream's thresholds at their edges, called
 * directly (this file compiles src/stroke.c into itself, so the static rules
 * are in reach). Signals can't land a value on an edge; these can.
 */
#include "../src/stroke.c"

static char g_buf[4096];
static size_t g_len;
static void capture(void *user, rc_stream s, const char *line, size_t len)
{
    (void)user; (void)s;
    if (g_len + len < sizeof(g_buf)) { memcpy(g_buf + g_len, line, len); g_len += len; }
}

static int g_fails;
static void check(int ok, const char *what)
{
    printf("%s stroke rule: %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) g_fails++;
}

static rc_stroke_window win(uint32_t t, int cpm10)
{
    rc_stroke_window w = { t, cpm10, 2 * cpm10, 1, 900 };
    return w;
}

int main(void)
{
    rc_config cfg = { capture, 0, 0 };
    const uint32_t half = 7500, near_ms = 7500;

    /* Neighbours at 56.0 spm (28.0 cycles): within 30% of their mean is kept. */
    rc_stroke_window a = win(0, 280), b = win(10000, 280);
    rc_stroke_window w = win(5000, 364);   /* 72.8: exactly 30% over */
    g_len = 0; point(&cfg, &w, &a, &b, half, near_ms);
    check(g_len > 0, "a point exactly 30% from its neighbours is kept");
    w = win(5000, 365);                    /* 73.0: just over */
    g_len = 0; point(&cfg, &w, &a, &b, half, near_ms);
    check(g_len == 0, "a point just over 30% from its neighbours is dropped");
    w = win(5000, 196);                    /* 39.2: exactly 30% under */
    g_len = 0; point(&cfg, &w, &a, &b, half, near_ms);
    check(g_len > 0, "a point exactly 30% under its neighbours is kept");

    /* A neighbour counts within 1.5 steps (7.5 s between centres). */
    rc_stroke_window far = win(12501, 280);
    w = win(5000, 280);
    g_len = 0; point(&cfg, &w, 0, &far, half, near_ms);
    check(g_len == 0, "a window 7.501 s away isn't a neighbour");
    far = win(12500, 280);
    g_len = 0; point(&cfg, &w, 0, &far, half, near_ms);
    check(g_len > 0, "a window 7.5 s away is a neighbour");

    /* A rest is a gap of at least 60 s between windows (end to start). */
    static rc_stroke_set set;
    static uint16_t hist[RC_STROKE_BINS];
    rc_stroke_window w1 = win(0, 280), w2 = win(120000, 280);   /* end 60000, next 120000 */
    memset(&set, 0, sizeof(set)); g_len = 0;
    accept_session(&set, hist, &cfg, "all", &w1, 60000);
    accept_session(&set, hist, &cfg, "all", &w2, 60000);
    check(strstr(g_buf, "rest,all,60000,120000") != 0, "a 60 s gap between windows is a rest");
    w2 = win(119999, 280);
    memset(&set, 0, sizeof(set)); g_len = 0; g_buf[0] = 0;
    accept_session(&set, hist, &cfg, "all", &w1, 60000);
    accept_session(&set, hist, &cfg, "all", &w2, 60000);
    g_buf[g_len] = 0;
    check(strstr(g_buf, "rest,") == 0, "a 59.999 s gap isn't a rest");

    /* Paddling time merges overlapping windows, and strokes follow each
       window's own rate over its share (moved from cadence.ts's test):
       60 s windows at 0, 30, 60 s (50 spm) and 90 s (60 spm) cover 0-150 s,
       then one at 600 s (40 spm): 210 s, 50x2 + 60x0.5 + 40 = 170 strokes. */
    static const uint32_t at[] = { 0, 30000, 60000, 90000, 600000 };
    static const int cpm[] = { 250, 250, 250, 300, 200 };
    memset(&set, 0, sizeof(set)); g_len = 0;
    for (int i = 0; i < 5; i++) {
        rc_stroke_window wi = win(at[i], cpm[i]);
        accept_session(&set, hist, &cfg, "all", &wi, 60000);
    }
    check(set.paddling_ms == 210000, "paddling time merges overlapping windows");
    check((set.strokes_x + 300000) / 600000 == 170, "strokes follow each window's rate over its share");

    /* not_moving: no run reached the moving set's 90 rows. 89 rows is
       not_moving; 90 is a run, so with no stroke in it, no_rhythm. */
    static rc_stroke st;
    for (uint32_t rows = 89; rows <= 90; rows++) {
        rcs_init(&st);
        g_len = 0;
        for (uint32_t ms = 0; ms <= 120000; ms += 80) rcs_sample(&st, &cfg, ms, 0, 0, 0);
        for (uint32_t i = 0; i < rows; i++) rcs_row(&st, &cfg, 1000 + i * 1000, 8.0);
        rcs_row(&st, &cfg, 1000 + rows * 1000, 0.0);
        rcs_finish(&st, &cfg);
        g_buf[g_len] = 0;
        if (rows == 89) check(strstr(g_buf, "session,moving,0,not_moving,") != 0, "89 rows moving: not_moving");
        else            check(strstr(g_buf, "session,moving,0,no_rhythm,") != 0, "90 rows moving, no stroke: no_rhythm");
    }
    /* The longest run counts, not the last: 95 rows, a stop, then 25. */
    rcs_init(&st);
    g_len = 0;
    for (uint32_t ms = 0; ms <= 200000; ms += 80) rcs_sample(&st, &cfg, ms, 0, 0, 0);
    for (uint32_t i = 0; i < 95; i++) rcs_row(&st, &cfg, 1000 + i * 1000, 8.0);
    rcs_row(&st, &cfg, 96000, 0.0);
    for (uint32_t i = 0; i < 25; i++) rcs_row(&st, &cfg, 97000 + i * 1000, 8.0);
    rcs_finish(&st, &cfg);
    g_buf[g_len] = 0;
    check(strstr(g_buf, "session,moving,0,no_rhythm,") != 0, "a long run, then a short one: the long one counts (no_rhythm)");

    /* The live trace (rcs_trace). */
    static rc_trace tr;
    /* The ring always holds the last 10 s: 100 s at one sample per 80 ms,
       and after the first 10 s every trace has all 125. */
    rcs_init(&st);
    int short_traces = 0;
    for (uint32_t ms = 0; ms <= 100000; ms += 80) {
        rcs_sample(&st, &cfg, ms, 0.0f, (ms / 80) % 2 ? 3.0f : -3.0f, 0.0f);
        rcs_trace(&st, ms, 0, &tr);
        if (ms >= 9920 && (tr.n != 125 || tr.ago_ms[0] != 9920 || tr.ago_ms[124] != 0)) short_traces++;
    }
    check(short_traces == 0, "every trace after the first 10 s has 125 samples, 9.92 s back to 0");

    /* Its axis is the one the stroke windows pick, about the same mean. */
    rcs_init(&st);
    for (uint32_t ms = 0; ms < 10000; ms += 80) {
        float ph = (float)ms / 1000.0f * 6.2831853f;
        rcs_sample(&st, &cfg, ms, 2.0f * sinf(ph), 1.0f + 0.5f * sinf(ph), 7.0f + 9.0f * sinf(0.5f * ph));
    }
    float mean, ss;
    int ax = pick_axis(&st, 0, st.ring_n, &mean, &ss);
    rcs_trace(&st, 9920, 0, &tr);
    int same = tr.axis == ax && ax == 2 && tr.n == st.ring_n;
    for (uint32_t i = 0; same && i < tr.n; i++) same = tr.dps[i] == held(&st, i)->gz - mean;
    check(same, "the trace is the stroke windows' axis (z here), each sample less its mean");
    check(tr.status == RC_TRACE_MOTION && tr.scale_dps > 8.9f && tr.scale_dps < 9.1f, "moving: scaled to its biggest swing (9 deg/s)");

    /* Still below 1 deg/s rms: +-1.01 is moving, +-0.99 is still. */
    for (int k = 0; k < 2; k++) {
        float amp = k ? 0.99f : 1.01f;
        rcs_init(&st);
        for (uint32_t ms = 0; ms < 10000; ms += 80) rcs_sample(&st, &cfg, ms, (ms / 80) % 2 ? amp : -amp, 0.0f, 0.0f);
        rcs_trace(&st, 9920, 0, &tr);
        if (k) check(tr.status == RC_TRACE_STILL && tr.scale_dps == 5.0f, "0.99 deg/s rms: still, drawn on the 5 deg/s floor");
        else   check(tr.status == RC_TRACE_MOTION, "1.01 deg/s rms: motion");
    }

    /* No sample for 7 s: no_samples, nothing to draw; 6.999 s: the last 10 s. */
    rcs_trace(&st, 9920 + 6999, 0, &tr);
    check(tr.status == RC_TRACE_STILL && tr.n == 125, "6.999 s since the newest sample: still drawn");
    rcs_trace(&st, 9920 + 7000, 0, &tr);
    check(tr.status == RC_TRACE_NO_SAMPLES && tr.n == 0 && tr.axis == -1, "7 s since the newest sample: no_samples, nothing to draw");

    /* None yet: starting for 7 s from the start, then no_samples. */
    rcs_init(&st);
    rcs_trace(&st, 1000 + 6999, 1000, &tr);
    check(tr.status == RC_TRACE_STARTING && tr.n == 0, "no sample yet, 6.999 s in: starting");
    rcs_trace(&st, 1000 + 7000, 1000, &tr);
    check(tr.status == RC_TRACE_NO_SAMPLES, "no sample yet, 7 s in: no_samples");

    /* Across the 2^32 ms wrap. */
    rcs_init(&st);
    uint32_t w0 = 0xFFFFFFFFu - 5000u;
    for (uint32_t i = 0; i < 200; i++) rcs_sample(&st, &cfg, w0 + i * 80u, 0.0f, i % 2 ? 3.0f : -3.0f, 0.0f);
    rcs_trace(&st, w0 + 199u * 80u, w0, &tr);
    check(tr.status == RC_TRACE_MOTION && tr.n == 125 && tr.ago_ms[0] == 9920, "the trace across the clock wrap");

    return g_fails ? 1 : 0;
}
