#include "imu.h"
#include "board.h"
#include "board_pins.h"
#include <SensorQMI8658.hpp>

static SensorQMI8658 qmi;
static bool ready = false;

static float    accelMagMax = 0, gyroMagMax = 0;
static uint32_t windowSamples = 0;
static float    lastAx = 0, lastAy = 0, lastAz = 0;
static float    lastGx = 0, lastGy = 0, lastGz = 0;
static uint32_t lastPollMs = 0;

// Single-slot latest-sample handoff for the raw capture sidecar.
static bool     rawNew = false;
static uint32_t rawMs  = 0;

// 50 Hz: fast enough to catch walking cadence and vehicle bumps, slow enough
// that polling costs nothing next to the GPS serial workload.
static const uint32_t POLL_INTERVAL_MS = 20;
// How long the chip may stay silent before it is declared dead. Long enough that
// a busy bus or a missed read is not mistaken for a failure, short enough that a
// wedged sensor stops corrupting SD traffic within a couple of seconds.
static const uint32_t DEAD_AFTER_MS = 3000;
static uint32_t lastGoodMs = 0;

bool imuInit()
{
    // The chip can come up wedged (SPI reads all 0xFF) after a *warm* reset,
    // because only a cold boot cut its rail in initPMU(). Retry, and before each
    // retry power-cycle the sensor rail (ALDO1/ALDO2 feed this chip) to force a
    // clean power-on -- the same thing initPMU does, but on demand.
    for (int attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
            Serial.printf("IMU: attempt %d failed, power-cycling sensor rail\n", attempt);
            PMU.disableALDO1(); PMU.disableALDO2();
            delay(120);
            PMU.enableALDO1();  PMU.enableALDO2();
            delay(150);
        }
        if (!qmi.begin(sdSPI, IMU_CS, SPI_MOSI, SPI_MISO, SPI_SCK)) continue;

        Serial.printf("IMU: QMI8658 chip id 0x%02X\n", qmi.getChipID());

        // 8G leaves headroom for knocks without wasting resolution; 256 dps covers
        // hand and vehicle rotation. Low ODRs -- this logs motion, not vibration.
        qmi.configAccelerometer(SensorQMI8658::ACC_RANGE_8G,
                                SensorQMI8658::ACC_ODR_125Hz,
                                SensorQMI8658::LPF_MODE_3);
        qmi.configGyroscope(SensorQMI8658::GYR_RANGE_256DPS,
                            SensorQMI8658::GYR_ODR_112_1Hz,
                            SensorQMI8658::LPF_MODE_3);
        qmi.enableAccelerometer();
        qmi.enableGyroscope();

        ready = true;
        return true;
    }

    // Park the chip select HIGH before giving up.
    //
    // This matters far more than a dead IMU should. The QMI8658 and the microSD
    // share one SPI bus, and a half-initialised chip left selected keeps driving
    // MISO — so every SD transaction on that bus gets corrupted. The symptom is
    // not "no motion data": it is a card that reads fine one minute and fails the
    // next, a sync that logs `open(): /sd/uploaded.txt does not exist` and uploads
    // nothing, and sidecars that reach the server truncated and come back 422.
    // A dead sensor should cost its own data and nothing else.
    pinMode(IMU_CS, OUTPUT);
    digitalWrite(IMU_CS, HIGH);
    Serial.println("IMU: giving up, CS parked high to free the shared SPI bus");
    return false;
}

bool imuReady() { return ready; }

void imuPoll()
{
    if (!ready) return;
    if (millis() - lastPollMs < POLL_INTERVAL_MS) return;
    lastPollMs = millis();

    float ax, ay, az, gx, gy, gz;
    bool gotAccel = qmi.getAccelerometer(ax, ay, az);
    bool gotGyro  = qmi.getGyroscope(gx, gy, gz);

    // Runtime watchdog: give up on a chip that has stopped answering, and let go
    // of the bus.
    //
    // The chip does not only come up wedged, it WEDGES WHILE RUNNING — observed
    // within about four minutes of a clean cold boot, with a healthy 4.07 V cell
    // fitted, so it is neither warm-reset-only nor a power problem. What makes
    // that expensive is the shared SPI bus: a wedged QMI8658 keeps driving MISO,
    // and the microSD on the same bus starts throwing `sdWait/Select Failed`,
    // which takes recording and uploads down with it. Every upload failure chased
    // today traced back here.
    //
    // So: once it has been silent for DEAD_AFTER_MS, stop polling and park CS
    // high. A dead sensor then costs its own data and nothing else, mid-session
    // and not merely at boot. Recovery needs a power cycle, which is what
    // imuInit's rail-cycling already does on the next cold start.
    if (!gotAccel && !gotGyro) {
        if (lastGoodMs && millis() - lastGoodMs > DEAD_AFTER_MS) {
            ready = false;
            pinMode(IMU_CS, OUTPUT);
            digitalWrite(IMU_CS, HIGH);
            Serial.printf("IMU: silent for %lums, marking dead and freeing the SPI bus\n",
                          (unsigned long)(millis() - lastGoodMs));
        }
        return;
    }
    lastGoodMs = millis();

    if (gotAccel) {
        lastAx = ax; lastAy = ay; lastAz = az;
        float mag = sqrtf(ax * ax + ay * ay + az * az);
        if (mag > accelMagMax) accelMagMax = mag;
    }
    if (gotGyro) {
        lastGx = gx; lastGy = gy; lastGz = gz;
        float mag = sqrtf(gx * gx + gy * gy + gz * gz);
        if (mag > gyroMagMax) gyroMagMax = mag;
    }
    windowSamples++;

    rawMs = lastPollMs;   // publish this sample for the raw-capture sidecar
    rawNew = true;
}

bool imuTakeRaw(ImuRaw &out)
{
    if (!rawNew) return false;
    out.ms = rawMs;
    out.ax = lastAx; out.ay = lastAy; out.az = lastAz;
    out.gx = lastGx; out.gy = lastGy; out.gz = lastGz;
    rawNew = false;
    return true;
}

ImuSample imuSnapshot()
{
    ImuSample s;
    if (!ready) return s;

    s.ax = lastAx; s.ay = lastAy; s.az = lastAz;
    s.gx = lastGx; s.gy = lastGy; s.gz = lastGz;
    s.accelMagMax = accelMagMax;
    s.gyroMagMax  = gyroMagMax;
    s.tempC       = qmi.getTemperature_C();
    s.samples     = windowSamples;

    accelMagMax = 0;
    gyroMagMax  = 0;
    windowSamples = 0;
    return s;
}
