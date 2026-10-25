/*
 * run_fixtures — replays a fixture's calls through the core and compares
 * every stream, byte for byte, with the fixture's golden files.
 *
 *   run_fixtures DIR...           check each fixture directory
 *   run_fixtures --write DIR...   (re)write the golden files from the core
 *
 * A fixture directory holds calls.csv (the input, format in
 * fixtures/README.md) and track.csv, motion.csv and, when the config has
 * raw_motion, motion_raw.csv (the expected output). The apps' unit tests and
 * the WASM build replay the same files.
 */
#include "recorder_core.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_OUT (32u << 20)
#define MAX_FIELDS 32

typedef struct {
    char  *buf[3];
    size_t len[3];
    int    overflow;
} outputs;

static void on_write(void *user, rc_stream s, const char *line, size_t len)
{
    outputs *o = (outputs *)user;
    if (o->len[s] + len > MAX_OUT) { o->overflow = 1; return; }
    memcpy(o->buf[s] + o->len[s], line, len);
    o->len[s] += len;
}

/* Splits in place on commas, keeping empty fields. */
static int split(char *line, char **f)
{
    int n = 0;
    f[n++] = line;
    for (char *c = line; *c && n < MAX_FIELDS; c++)
        if (*c == ',') { *c = 0; f[n++] = c + 1; }
    return n;
}

static uint32_t parse_has(char *list)
{
    static const struct { const char *name; uint32_t bit; } names[] = {
        { "tracker", RC_HAS_TRACKER }, { "sats", RC_HAS_SATS }, { "hdop", RC_HAS_HDOP },
        { "batt_mv", RC_HAS_BATT_MV }, { "tx_seq", RC_HAS_TX_SEQ },
        { "imu_temp", RC_HAS_IMU_TEMP }, { "raw_motion", RC_HAS_RAW_MOTION },
    };
    uint32_t has = 0;
    for (char *tok = strtok(list, " "); tok; tok = strtok(NULL, " ")) {
        size_t i;
        for (i = 0; i < sizeof(names) / sizeof(names[0]); i++)
            if (!strcmp(tok, names[i].name)) { has |= names[i].bit; break; }
        if (i == sizeof(names) / sizeof(names[0])) {
            fprintf(stderr, "unknown config flag '%s'\n", tok);
            exit(2);
        }
    }
    return has;
}

static int set_d(const char *s, int *valid, double *v)
{
    *valid = *s != 0;
    *v = *valid ? strtod(s, NULL) : 0.0;
    return *valid;
}

static const char *const FILES[3] = { "track.csv", "motion.csv", "motion_raw.csv" };

static char *slurp(const char *path, size_t *len)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *b = malloc((size_t)n + 1);
    *len = fread(b, 1, (size_t)n, f);
    b[*len] = 0;
    fclose(f);
    return b;
}

/* Reports the first differing line, so a failure says what changed. */
static void report_diff(const char *name, const char *got, size_t glen, const char *want, size_t wlen)
{
    size_t i = 0, line = 1, start = 0;
    while (i < glen && i < wlen && got[i] == want[i]) {
        if (got[i] == '\n') { line++; start = i + 1; }
        i++;
    }
    const char *ge = memchr(got + start, '\n', glen - start);
    const char *we = memchr(want + start, '\n', wlen - start);
    int gl = (int)((ge ? ge : got + glen) - (got + start));
    int wl = (int)((we ? we : want + wlen) - (want + start));
    fprintf(stderr, "  %s line %zu differs\n    want: %.*s\n    got:  %.*s\n",
            name, line, wl, want + start, gl, got + start);
}

static int run(const char *dir, int write_mode)
{
    char path[1024];
    snprintf(path, sizeof(path), "%s/calls.csv", dir);
    FILE *in = fopen(path, "r");
    if (!in) { fprintf(stderr, "%s: can't open\n", path); return 1; }

    static outputs o;
    for (int s = 0; s < 3; s++) {
        if (!o.buf[s]) o.buf[s] = malloc(MAX_OUT);
        o.len[s] = 0;
    }
    o.overflow = 0;

    rc_state rc;
    int started = 0;
    uint32_t has = 0;
    char line[1024];
    int lineno = 0;
    while (fgets(line, sizeof(line), in)) {
        lineno++;
        line[strcspn(line, "\r\n")] = 0;
        if (!line[0] || line[0] == '#') continue;
        char *f[MAX_FIELDS];
        int n = split(line, f);
        if (!strcmp(f[0], "config")) {
            has = n > 1 ? parse_has(f[1]) : 0;
            rc_config cfg = { on_write, &o, has };
            rc_init(&rc, &cfg);
            started = 1;
        } else if (!started) {
            fprintf(stderr, "%s:%d: the first call must be config\n", path, lineno);
            return 1;
        } else if (!strcmp(f[0], "imu") && n == 8) {
            rc_imu(&rc, (uint32_t)strtoul(f[1], NULL, 10),
                   strtof(f[2], NULL), strtof(f[3], NULL), strtof(f[4], NULL),
                   strtof(f[5], NULL), strtof(f[6], NULL), strtof(f[7], NULL));
        } else if (!strcmp(f[0], "second") && n == 16) {
            rc_gps g;
            rc_extras x;
            memset(&g, 0, sizeof(g));
            memset(&x, 0, sizeof(x));
            uint32_t t = (uint32_t)strtoul(f[1], NULL, 10);
            g.fix = atoi(f[2]);
            g.date_valid = sscanf(f[3], "%d-%d-%d", &g.year, &g.month, &g.day) == 3;
            g.time_valid = sscanf(f[4], "%d:%d:%d", &g.hour, &g.minute, &g.second) == 3;
            g.lat = strtod(f[5], NULL);
            g.lon = strtod(f[6], NULL);
            set_d(f[7], &g.alt_valid, &g.alt_m);
            set_d(f[8], &g.speed_valid, &g.speed_kmh);
            set_d(f[9], &g.course_valid, &g.course_deg);
            g.sats_valid = *f[10] != 0;
            g.sats = (unsigned)strtoul(f[10], NULL, 10);
            set_d(f[11], &g.hdop_valid, &g.hdop);
            x.batt_mv = (unsigned)strtoul(f[12], NULL, 10);
            x.tx_seq = (unsigned)strtoul(f[13], NULL, 10);
            x.imu_ok = atoi(f[14]);
            x.imu_temp_c = strtof(f[15], NULL);
            rc_second(&rc, t, &g, &x);
        } else {
            fprintf(stderr, "%s:%d: can't read '%s' (%d fields)\n", path, lineno, f[0], n);
            return 1;
        }
    }
    fclose(in);
    if (o.overflow) { fprintf(stderr, "%s: output too large\n", dir); return 1; }

    int fails = 0;
    for (int s = 0; s < 3; s++) {
        int expected = s != RC_MOTION_RAW || (has & RC_HAS_RAW_MOTION);
        snprintf(path, sizeof(path), "%s/%s", dir, FILES[s]);
        if (write_mode) {
            if (!expected) { remove(path); continue; }
            FILE *out = fopen(path, "wb");
            fwrite(o.buf[s], 1, o.len[s], out);
            fclose(out);
            continue;
        }
        size_t wlen = 0;
        char *want = slurp(path, &wlen);
        if (!expected) {
            if (want) { fprintf(stderr, "  %s: not expected without raw_motion\n", FILES[s]); fails++; }
            free(want);
            continue;
        }
        if (!want) { fprintf(stderr, "  %s: missing\n", path); fails++; continue; }
        if (wlen != o.len[s] || memcmp(want, o.buf[s], wlen)) {
            report_diff(FILES[s], o.buf[s], o.len[s], want, wlen);
            fails++;
        }
        free(want);
    }
    printf("%s %s\n", fails ? "FAIL" : (write_mode ? "wrote" : "ok  "), dir);
    return fails ? 1 : 0;
}

/* Phase 1 computes no live values: each must read "not ready" (NAN), never 0. */
static int check_live_not_ready(void)
{
    static outputs o;
    rc_state rc;
    rc_config cfg = { on_write, &o, 0 };
    for (int s = 0; s < 3; s++) if (!o.buf[s]) o.buf[s] = malloc(MAX_OUT);
    rc_init(&rc, &cfg);
    rc_live_values v;
    rc_live(&rc, &v);
    if (isnan(v.spm) && isnan(v.roll_deg) && isnan(v.pitch_deg) && isnan(v.evenness_pct) &&
        isnan(v.speed_kmh) && isnan(v.distance_m)) {
        printf("ok   live values read not ready\n");
        return 0;
    }
    fprintf(stderr, "FAIL live values: phase 1 must report every one as NAN\n");
    return 1;
}

/* Nonsense values (a broken sensor, an adapter bug) can't break the file:
   every line still ends in exactly one newline. */
static int g_bad_lines;
static void on_write_check(void *user, rc_stream s, const char *line, size_t len)
{
    (void)user; (void)s;
    if (len == 0 || strlen(line) != len || line[len - 1] != '\n' ||
        memchr(line, '\n', len) != line + len - 1)
        g_bad_lines++;
}

static int check_nonsense_values(void)
{
    rc_state rc;
    rc_config cfg = { on_write_check, NULL, RC_HAS_TRACKER };
    g_bad_lines = 0;
    rc_init(&rc, &cfg);
    rc_imu(&rc, 1, 3.4e38f, -3.4e38f, 3.4e38f, -3.4e38f, 3.4e38f, -3.4e38f);
    rc_gps g;
    memset(&g, 0, sizeof(g));
    g.fix = g.date_valid = g.time_valid = 1;
    g.year = 2147483647;
    g.lat = -1e300; g.lon = 1e300;
    g.alt_valid = g.speed_valid = g.course_valid = g.hdop_valid = 1;
    g.alt_m = -1e300; g.speed_kmh = 1e300; g.course_deg = 1e300; g.hdop = 1e300;
    rc_extras x = { 4294967295u, 4294967295u, 1, 3.4e38f };
    rc_second(&rc, 4294967295u, &g, &x);
    if (g_bad_lines) { fprintf(stderr, "FAIL nonsense values broke %d lines\n", g_bad_lines); return 1; }
    printf("ok   nonsense values still give whole lines\n");
    return 0;
}

int main(int argc, char **argv)
{
    int write_mode = 0, fails = 0, i = 1;
    if (i < argc && !strcmp(argv[i], "--write")) { write_mode = 1; i++; }
    if (i >= argc) { fprintf(stderr, "usage: run_fixtures [--write] DIR...\n"); return 2; }
    if (!write_mode) fails += check_live_not_ready() + check_nonsense_values();
    for (; i < argc; i++) fails += run(argv[i], write_mode);
    return fails ? 1 : 0;
}
