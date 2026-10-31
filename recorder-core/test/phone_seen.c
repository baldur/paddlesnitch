/*
 * The phone layer as the fixture runner builds it: every call it makes to
 * the core goes through run_fixtures.c's checks first (time order, samples
 * before rows on a tie, one row per tick), not just the lines that reach
 * the files. Shipped builds compile src/recorder_phone.c itself.
 */
#define rc_imu rc_imu_seen
#define rc_second rc_second_seen
#include "../src/recorder_phone.c"
