/*
 * stroke.h — the stroke rate stream, inside the core (not public API).
 * recorder_core.c feeds it the lines it writes; recorder_replay.c feeds it
 * the same lines read back from the files. One path, so streaming = batch.
 */
#ifndef RC_STROKE_H
#define RC_STROKE_H

#include "recorder_core.h"

/* Reads an RC_MOTION line: 1 with ms and the gyroscope (deg/s), 0 if it
   isn't one (a header, too few fields, a value that isn't a number). */
int  rcs_parse_motion(const char *line, size_t len, uint32_t *ms, float *gx, float *gy, float *gz);

/* Reads a track row's ms and speed (km/h) from columns ms_col and speed_col:
   1, or 0 when the row has too few fields or they aren't numbers. */
int  rcs_parse_row(const char *row, size_t len, int ms_col, int speed_col, uint32_t *ms, double *speed);

void rcs_init(rc_stroke *s);
void rcs_sample(rc_stroke *s, const rc_config *cfg, uint32_t ms, float gx, float gy, float gz);
void rcs_row(rc_stroke *s, const rc_config *cfg, uint32_t ms, double speed_kmh);
void rcs_finish(rc_stroke *s, const rc_config *cfg);

/* The device's own track rows: where recorder_core.c writes ms and speed. */
#define RCS_ROW_MS_COL    1
#define RCS_ROW_SPEED_COL 8

#endif
