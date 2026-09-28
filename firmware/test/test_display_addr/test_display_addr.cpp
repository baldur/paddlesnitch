#include <unity.h>
#include "display_addr.h"

// The first tracker has something that acks at 0x3C but is not the panel, so
// 0x3D must win whenever it answers -- or that tracker's screen goes dark.
static void prefers_0x3D_when_both_ack(void)
{
    TEST_ASSERT_EQUAL_HEX8(0x3D, displayAddressFor(true, true));
}

// The 2026-09 batch has its panel at 0x3C and nothing at 0x3D. Before this, the
// firmware only tried 0x3D, reported "Display [FAIL] panel did not ack" and ran
// with a blank screen.
static void falls_back_to_0x3C_when_0x3D_is_silent(void)
{
    TEST_ASSERT_EQUAL_HEX8(0x3C, displayAddressFor(false, true));
}

static void uses_0x3D_alone(void)
{
    TEST_ASSERT_EQUAL_HEX8(0x3D, displayAddressFor(true, false));
}

static void reports_no_panel_when_neither_acks(void)
{
    TEST_ASSERT_EQUAL_HEX8(0, displayAddressFor(false, false));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(prefers_0x3D_when_both_ack);
    RUN_TEST(falls_back_to_0x3C_when_0x3D_is_silent);
    RUN_TEST(uses_0x3D_alone);
    RUN_TEST(reports_no_panel_when_neither_acks);
    return UNITY_END();
}
