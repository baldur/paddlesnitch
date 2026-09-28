#include <unity.h>
#include "setup_policy.h"

// The bug: holding BOOT on the code screen replaced the code being typed.
static void a_hold_leaves_a_code_on_screen_alone(void)
{
    TEST_ASSERT_FALSE(linkHoldRetries(true));
}

static void a_hold_retries_when_nothing_is_running(void)
{
    TEST_ASSERT_TRUE(linkHoldRetries(false));
}

// The bug: a wrong new password kept the old "has worked" mark, so setup
// never reopened.
static void a_new_password_must_work_before_it_counts(void)
{
    TEST_ASSERT_FALSE(wifiStillProven(true, "home", "right", "home", "wrnog"));
}

static void a_new_network_must_work_before_it_counts(void)
{
    TEST_ASSERT_FALSE(wifiStillProven(true, "home", "pw", "cabin", "pw"));
}

// Settings > Network saved with the same details (blank password = keep the
// saved one) must not throw away a network that works.
static void saving_the_same_details_keeps_the_mark(void)
{
    TEST_ASSERT_TRUE(wifiStillProven(true, "home", "pw", "home", "pw"));
    TEST_ASSERT_FALSE(wifiStillProven(false, "home", "pw", "home", "pw"));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(a_hold_leaves_a_code_on_screen_alone);
    RUN_TEST(a_hold_retries_when_nothing_is_running);
    RUN_TEST(a_new_password_must_work_before_it_counts);
    RUN_TEST(a_new_network_must_work_before_it_counts);
    RUN_TEST(saving_the_same_details_keeps_the_mark);
    return UNITY_END();
}
