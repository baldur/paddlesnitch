#include <unity.h>
#include "gps_fresh.h"

static void a_current_reading_is_a_fix(void)
{
    TEST_ASSERT_TRUE(gpsFresh(true, 0));
    TEST_ASSERT_TRUE(gpsFresh(true, 1200));   // between two 1 Hz updates
}

// The bug: valid stayed true for 1 h 49 min after the receiver lost the sky.
static void an_old_reading_is_no_fix_even_though_marked_valid(void)
{
    TEST_ASSERT_FALSE(gpsFresh(true, GPS_STALE_MS));
    TEST_ASSERT_FALSE(gpsFresh(true, 6539000));
}

static void never_valid_is_no_fix(void)
{
    TEST_ASSERT_FALSE(gpsFresh(false, 0));
    TEST_ASSERT_FALSE(gpsFresh(false, 0xFFFFFFFFu));   // TinyGPS++: age when never valid
}

// TinyGPS++ marks the date valid after an RMC with an EMPTY date field, which
// the receiver sends while it has a time but no date yet; the global parser
// then reads 2000-00-00. A GGA fix arriving before the dated RMC stamped a
// recording track_20000000_190737 and gave its rows 2000-00-00T... timestamps.
static void an_empty_gps_date_is_no_date(void)
{
    TEST_ASSERT_FALSE(gpsDateOk(true, 2000, 0, 0));
}

static void a_real_date_is_a_date(void)
{
    TEST_ASSERT_TRUE(gpsDateOk(true, 2026, 10, 11));
    TEST_ASSERT_TRUE(gpsDateOk(true, 2026, 12, 31));
    TEST_ASSERT_TRUE(gpsDateOk(true, 2027, 1, 1));
}

static void impossible_or_unset_dates_are_no_date(void)
{
    TEST_ASSERT_FALSE(gpsDateOk(false, 2026, 10, 11));
    TEST_ASSERT_FALSE(gpsDateOk(true, 2026, 13, 1));
    TEST_ASSERT_FALSE(gpsDateOk(true, 2026, 10, 0));
    TEST_ASSERT_FALSE(gpsDateOk(true, 2026, 10, 32));
    TEST_ASSERT_FALSE(gpsDateOk(true, 2024, 10, 11));   // older than the firmware
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(a_current_reading_is_a_fix);
    RUN_TEST(an_old_reading_is_no_fix_even_though_marked_valid);
    RUN_TEST(never_valid_is_no_fix);
    RUN_TEST(an_empty_gps_date_is_no_date);
    RUN_TEST(a_real_date_is_a_date);
    RUN_TEST(impossible_or_unset_dates_are_no_date);
    return UNITY_END();
}
