/*
 * recorder_replay.c — rc_replay: a recording's uploaded files back through
 * the stroke rate stream, as the device fed it (recorder_core.h).
 *
 * The device feeds the stream each motion line and track row as it writes
 * them, samples before a row on the same ms. Merging the two files by ms in
 * that order gives the stream the same lines in the same order, so the
 * figures come out the same (streaming = batch; test/run_fixtures.c checks
 * it on every fixture).
 */
#include "recorder_core.h"
#include "stroke.h"

#include <ctype.h>
#include <string.h>

typedef struct { const char *p, *end; } cursor;

/* The next line (without its newline; the parsers drop a CR), or 0 at the end. */
static int next_line(cursor *c, const char **line, size_t *len)
{
    if (c->p >= c->end) return 0;
    const char *nl = memchr(c->p, '\n', (size_t)(c->end - c->p));
    const char *stop = nl ? nl : c->end;
    *line = c->p;
    *len = (size_t)(stop - c->p);
    c->p = nl ? nl + 1 : c->end;
    return 1;
}

/* A header cell, compared the way the server always has: lower case, with
   spaces and underscores gone ("Speed_kmh" is "speedkmh"), and the CR that
   ends the last cell of a CR LF file. */
static int cell_is(const char *cell, size_t n, const char *name)
{
    size_t j = 0;
    for (size_t i = 0; i < n; i++) {
        char ch = (char)tolower((unsigned char)cell[i]);
        if (ch == ' ' || ch == '\t' || ch == '_' || ch == '\r') continue;
        if (name[j] != ch) return 0;
        j++;
    }
    return name[j] == 0;
}

/* Is this the header line: does a cell say "ms"? Older captures open with
   a marker line (<<<CAT ...>>>) before it. Finds the ms and speed columns. */
static int header(const char *line, size_t len, int *ms_col, int *speed_col)
{
    int col = 0, ms = -1, sp = -1;
    size_t s = 0;
    for (size_t i = 0; i <= len; i++) {
        if (i == len || line[i] == ',') {
            if (ms < 0 && cell_is(line + s, i - s, "ms")) ms = col;
            if (sp < 0 && (cell_is(line + s, i - s, "speedkmh") || cell_is(line + s, i - s, "speed"))) sp = col;
            col++;
            s = i + 1;
        }
    }
    /* "ms" must be followed by another column, as the server's test was */
    if (ms < 0 || ms == col - 1) return 0;
    *ms_col = ms;
    *speed_col = sp;
    return 1;
}

typedef struct {
    cursor   c;
    int      ms_col, speed_col, have;
    uint32_t ms;
    double   speed;
} track_reader;

static void next_row(track_reader *t)
{
    const char *line;
    size_t len;
    t->have = 0;
    while (next_line(&t->c, &line, &len))
        if (t->speed_col >= 0 &&
            rcs_parse_row(line, len, t->ms_col, t->speed_col, &t->ms, &t->speed)) {
            t->have = 1;
            return;
        }
}

typedef struct {
    cursor   c;
    int      have;
    uint32_t ms;
    float    gx, gy, gz;
} motion_reader;

static void next_sample(motion_reader *m)
{
    const char *line;
    size_t len;
    m->have = 0;
    while (next_line(&m->c, &line, &len))
        if (rcs_parse_motion(line, len, &m->ms, &m->gx, &m->gy, &m->gz)) {
            m->have = 1;
            return;
        }
}

void rc_replay(rc_state *rc, const rc_config *cfg,
               const char *track, size_t track_len,
               const char *motion, size_t motion_len)
{
    memset(rc, 0, sizeof(*rc));
    rc->cfg = *cfg;
    rc->cfg.has = 0;
    rcs_init(&rc->stroke);

    track_reader t;
    memset(&t, 0, sizeof(t));
    t.c.p = track ? track : "";
    t.c.end = t.c.p + (track ? track_len : 0);
    t.speed_col = -1;
    const char *line;
    size_t len;
    while (next_line(&t.c, &line, &len))
        if (header(line, len, &t.ms_col, &t.speed_col)) break;
    next_row(&t);

    motion_reader m;
    memset(&m, 0, sizeof(m));
    m.c.p = motion ? motion : "";
    m.c.end = m.c.p + (motion ? motion_len : 0);
    next_sample(&m);

    /* Samples first on a tie: a sample at a row's ms is in that row. */
    while (t.have || m.have) {
        if (m.have && (!t.have || (int32_t)(m.ms - t.ms) <= 0)) {
            rcs_sample(&rc->stroke, &rc->cfg, m.ms, m.gx, m.gy, m.gz);
            next_sample(&m);
        } else {
            rcs_row(&rc->stroke, &rc->cfg, t.ms, t.speed);
            next_row(&t);
        }
    }
    rcs_finish(&rc->stroke, &rc->cfg);
}
