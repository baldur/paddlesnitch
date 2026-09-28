#include <unity.h>
#include "track_policy.h"

static const TrackNav ON_TRACK = { false, true };

static void track_starts_recording_on_a_fix(void)
{
    TEST_ASSERT_TRUE(trackShouldAutoStart(ON_TRACK, false, true));
}

static void track_waits_for_a_fix(void)
{
    TEST_ASSERT_FALSE(trackShouldAutoStart(ON_TRACK, false, false));
}

static void nothing_records_from_the_menu(void)
{
    TEST_ASSERT_FALSE(trackShouldAutoStart({ true, true }, false, true));
    TEST_ASSERT_FALSE(trackShouldAutoStart({ false, false }, false, true));
}

// The bug: "hold to stop" stayed on Track, and the next tick started a new
// recording because there was still a fix.
static void a_stop_is_not_undone_by_a_new_recording(void)
{
    TEST_ASSERT_FALSE(trackShouldAutoStart(trackNavAfterStop(ON_TRACK), false, true));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(track_starts_recording_on_a_fix);
    RUN_TEST(track_waits_for_a_fix);
    RUN_TEST(nothing_records_from_the_menu);
    RUN_TEST(a_stop_is_not_undone_by_a_new_recording);
    return UNITY_END();
}
