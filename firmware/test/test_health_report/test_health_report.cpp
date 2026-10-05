#include <unity.h>
#include <string.h>
#include "health_report.h"

void setUp(void) {}
void tearDown(void) {}

static void a_heartbeat_has_the_stats_and_no_crash(void)
{
    HealthStats s; s.kind = "heartbeat"; s.resetReason = "POWERON"; s.uptimeS = 3600; s.heapMin = 180000;
    s.psramFree = 7900000; s.battMv = 4100; s.onUsb = true; s.stackHeadroom = 7872; s.pending = 0;
    char b[400];
    TEST_ASSERT_TRUE(healthJson(b, sizeof(b), s, nullptr) > 0);
    TEST_ASSERT_EQUAL_STRING(
        "{\"kind\":\"heartbeat\",\"resetReason\":\"POWERON\",\"uptimeS\":3600,\"heapMin\":180000,\"psramFree\":7900000,"
        "\"battMv\":4100,\"onUsb\":true,\"stackHeadroom\":7872,\"pending\":0}", b);
}

// The shape the server's sanitizeHealth reads: pc and bt as 0x-hex strings.
static void a_crash_report_carries_task_pc_and_backtrace(void)
{
    HealthStats s; s.kind = "boot"; s.resetReason = "PANIC";
    HealthCrash c; c.present = true; strcpy(c.task, "uplink"); c.pc = 0x42011ebb;
    c.bt[0] = 0x4037d399; c.bt[1] = 0x42011ebb; c.depth = 2; strcpy(c.elf, "1a2b3c4d5e6f7a8b");
    char b[600];
    TEST_ASSERT_TRUE(healthJson(b, sizeof(b), s, &c) > 0);
    TEST_ASSERT_NOT_NULL(strstr(b, "\"crash\":{\"task\":\"uplink\",\"pc\":\"0x42011ebb\",\"corrupted\":false,\"elf\":\"1a2b3c4d5e6f7a8b\",\"bt\":[\"0x4037d399\",\"0x42011ebb\"]}}"));
    TEST_ASSERT_NOT_NULL(strstr(b, "\"pending\":null"));
}

// A crash with no saved summary still counts as a crash.
static void a_crash_without_a_summary_is_still_reported(void)
{
    HealthStats s; s.kind = "boot"; s.resetReason = "TASK_WDT";
    HealthCrash c; c.present = true;
    char b[400];
    TEST_ASSERT_TRUE(healthJson(b, sizeof(b), s, &c) > 0);
    TEST_ASSERT_NOT_NULL(strstr(b, "\"crash\":{\"task\":\"\",\"pc\":\"0x00000000\""));
}

static void odd_names_cannot_break_the_json(void)
{
    HealthStats s; s.resetReason = "a\"b";
    HealthCrash c; c.present = true; strcpy(c.task, "x\"y}");
    char b[500];
    healthJson(b, sizeof(b), s, &c);
    TEST_ASSERT_NULL(strstr(b, "a\"b"));
    TEST_ASSERT_NOT_NULL(strstr(b, "\"task\":\"x_y_\""));
}

static void a_small_buffer_fails_cleanly(void)
{
    HealthStats s; char b[20];
    TEST_ASSERT_EQUAL_INT(-1, healthJson(b, sizeof(b), s, nullptr));
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(a_heartbeat_has_the_stats_and_no_crash);
    RUN_TEST(a_crash_report_carries_task_pc_and_backtrace);
    RUN_TEST(a_crash_without_a_summary_is_still_reported);
    RUN_TEST(odd_names_cannot_break_the_json);
    RUN_TEST(a_small_buffer_fails_cleanly);
    return UNITY_END();
}
