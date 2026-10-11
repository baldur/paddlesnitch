#include <unity.h>
#include "imu_alive.h"

// SensorLib's SPI read cannot fail on the ESP32 (it returns success whatever
// comes back), so imuPoll's "silent for 3 s -> dead, park CS" watchdog could
// never fire. A wedged QMI8658 reads 0xFFFF on every axis: -1 count, which at
// the 8 g range is -0.000244 g.
static void a_wedged_chip_is_not_a_reading(void)
{
    const float c = -8.0f / 32768.0f;
    TEST_ASSERT_FALSE(imuAccelAlive(c, c, c));
    TEST_ASSERT_FALSE(imuAccelAlive(0, 0, 0));          // unpowered / reset chip
}

// Gravity is always there: at rest, tilted, or knocked about in a boat.
static void anything_that_feels_gravity_is_a_reading(void)
{
    TEST_ASSERT_TRUE(imuAccelAlive(0.02f, 0.11f, 1.03f));    // flat on a desk (measured)
    TEST_ASSERT_TRUE(imuAccelAlive(-0.82f, -0.03f, 0.52f));  // tilted (a real row)
    TEST_ASSERT_TRUE(imuAccelAlive(3.5f, -2.0f, 6.0f));      // a knock
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(a_wedged_chip_is_not_a_reading);
    RUN_TEST(anything_that_feels_gravity_is_a_reading);
    return UNITY_END();
}
