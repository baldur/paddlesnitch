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

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(a_current_reading_is_a_fix);
    RUN_TEST(an_old_reading_is_no_fix_even_though_marked_valid);
    RUN_TEST(never_valid_is_no_fix);
    return UNITY_END();
}
