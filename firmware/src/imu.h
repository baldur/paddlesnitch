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

bool imuInit();
bool imuReady();
void imuPoll();                       // cheap; call every loop iteration
ImuSample imuSnapshot();              // read peaks and reset the window
