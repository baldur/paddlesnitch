#include <unity.h>
#include "pair_policy.h"

// The bug: a Bluetooth pairing arrives unsolicited, from anyone in range, and
// any hold that crossed 1200 ms while the number was up said yes -- including
// one that began before the number appeared, for something else entirely.
static void a_hold_begun_before_the_number_does_not_accept(void)
{
    TEST_ASSERT_FALSE(pairHoldAccepts(1000, 1500));
}

static void a_hold_begun_after_the_number_accepts(void)
{
    TEST_ASSERT_TRUE(pairHoldAccepts(1500, 1500));
    TEST_ASSERT_TRUE(pairHoldAccepts(4000, 1500));
}

static void millis_wrapping_does_not_flip_the_answer(void)
{
    TEST_ASSERT_TRUE(pairHoldAccepts(10, 0xFFFFFF00u));      // pressed just after the wrap
    TEST_ASSERT_FALSE(pairHoldAccepts(0xFFFFFF00u, 10));     // pressed before it
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(a_hold_begun_before_the_number_does_not_accept);
    RUN_TEST(a_hold_begun_after_the_number_accepts);
    RUN_TEST(millis_wrapping_does_not_flip_the_answer);
    return UNITY_END();
}
