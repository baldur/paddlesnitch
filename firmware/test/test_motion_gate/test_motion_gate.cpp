#include <unity.h>
#include "motion_gate.h"

// The uploaded ~12 Hz motion file takes a row every UP_INTERVAL_MS. It used to
// compare 32-bit `long`s parsed with atol: past 2^31 ms of uptime (24.8 days on
// USB power) atol saturates, every row looked 0 ms after the last, and the file
// got one row per recording.
static void rows_flow_at_the_interval(void)
{
    UpGate g;
    TEST_ASSERT_TRUE(upRowDue(g, 1000, 80));
    TEST_ASSERT_FALSE(upRowDue(g, 1040, 80));
    TEST_ASSERT_TRUE(upRowDue(g, 1080, 80));
}

static void rows_keep_flowing_after_24_8_days(void)
{
    UpGate g;
    uint32_t ms = 2147483600u, rows = 0;
    for (int i = 0; i < 100; i++, ms += 20) rows += upRowDue(g, ms, 80);
    TEST_ASSERT_EQUAL_UINT32(25, rows);   // 2 s at 50 Hz -> one row per 80 ms
}

static void rows_keep_flowing_across_the_49_7_day_wrap(void)
{
    UpGate g;
    TEST_ASSERT_TRUE(upRowDue(g, 0xFFFFFFF0u, 80));
    TEST_ASSERT_FALSE(upRowDue(g, 0x00000020u, 80));   // 48 ms later
    TEST_ASSERT_TRUE(upRowDue(g, 0x00000040u, 80));    // 80 ms later
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(rows_flow_at_the_interval);
    RUN_TEST(rows_keep_flowing_after_24_8_days);
    RUN_TEST(rows_keep_flowing_across_the_49_7_day_wrap);
    return UNITY_END();
}
