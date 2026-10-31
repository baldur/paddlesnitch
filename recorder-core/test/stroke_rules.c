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

    return g_fails ? 1 : 0;
}
