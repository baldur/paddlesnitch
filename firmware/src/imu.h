#pragma once
#include <Arduino.h>

// QMI8658 6-axis accelerometer + gyroscope, on the SPI bus shared with the SD
// card (CS on IMU_CS). Identified by reading its ID register -- see imuProbe().
//
// Sampled far faster than it is logged: at a 1 Hz log rate an instantaneous
// reading would miss every bump and turn between rows. imuPoll() accumulates
// peaks continuously, and imuSnapshot() returns them and starts a new window,
// so a row says what actually happened during that second.

struct ImuSample {
    float ax = 0, ay = 0, az = 0;     // g
    float gx = 0, gy = 0, gz = 0;     // degrees/sec
    float accelMagMax = 0;            // peak |a| in the window, g
    float gyroMagMax  = 0;            // peak |g| in the window, deg/s
    float tempC = 0;
    uint32_t samples = 0;             // samples in the window; 0 => no data
};

// One full-rate sample, for the raw motion-capture sidecar (see
// docs/motion-capture-spec.md). `ms` is millis() at the poll, the same clock the
// track CSV logs, so 50 Hz IMU rows align to the 1 Hz GPS rows offline.
struct ImuRaw {
    uint32_t ms = 0;
    float ax = 0, ay = 0, az = 0;     // g
    float gx = 0, gy = 0, gz = 0;     // degrees/sec
};

bool imuInit();
bool imuReady();
void imuPoll();                       // cheap; call every loop iteration
ImuSample imuSnapshot();              // read peaks AND close the window
// Same reading, WITHOUT closing the window. For anything that just displays the
// numbers. Getting this wrong is not cosmetic: the UI refreshes at 4 Hz, so
// while it called imuSnapshot() every 1 Hz CSV row carried the peak over the
// last ~250 ms instead of the last second, and `imu_samples` logged 10-11 where
// the design intent is 43-50. Confirmed in real uploaded data before the fix.
// There must be exactly ONE window-closing consumer: the logger.
ImuSample imuPeek();

// Drains the single most-recent ~50 Hz sample, if one arrived since the last
// call. Returns false when there is nothing new. The caller (the recording loop)
// polls faster than 50 Hz, so it catches each sample.
bool imuTakeRaw(ImuRaw &out);
