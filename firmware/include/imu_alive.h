#pragma once

// Did the QMI8658 actually answer? SensorLib's SPI read cannot report a
// failure on the ESP32 -- it returns success whatever is clocked in -- so a
// wedged chip (0xFFFF on every axis, -0.000244 g) or a reset one (zeros) looks
// like a good sample, and imuPoll's dead-sensor watchdog could never fire.
// Gravity is the check: anything attached to a boat feels about 1 g, so a
// frame under 0.2 g is not a reading. (Free fall would read low too, but not
// for the 3 s the watchdog waits.)
static inline bool imuAccelAlive(float ax, float ay, float az)
{
    return ax * ax + ay * ay + az * az >= 0.2f * 0.2f;
}
