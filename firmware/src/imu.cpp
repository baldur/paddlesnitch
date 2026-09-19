#include "imu.h"
#include "spibus.h"
#include "dbg.h"
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

// WHO_AM_I in a given SPI mode, for diagnosis. Deliberately separate from
// board.cpp's imuReadReg, which is hardcoded to mode 3 — the point here is to
// find out whether the mode is what has been wrong.
static uint8_t imuWhoAmI(uint8_t spiMode)
{
    sdSPI.beginTransaction(SPISettings(1000000, MSBFIRST, spiMode));
    digitalWrite(IMU_CS, LOW);
    sdSPI.transfer(0x00 | 0x80);
    uint8_t v = sdSPI.transfer(0x00);
    digitalWrite(IMU_CS, HIGH);
    sdSPI.endTransaction();
    return v;
}

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
            // 120 ms was not obviously enough to drain the sensor rail's
            // decoupling, and a chip that never fully loses power never resets.
            // Lengthened while diagnosing; shorten again only with evidence.
            delay(400);
            PMU.enableALDO1();  PMU.enableALDO2();
            delay(300);
        }
        // Read WHO_AM_I both ways before handing over to the library. The chip
        // supports SPI mode 0 and mode 3, and the probe has only ever tried mode
        // 3 — so "no response" may have meant "asked in the wrong mode". 0x05 is
        // the QMI8658's expected answer at register 0x00.
        Serial.printf("IMU: pre-init who_am_i  mode3=0x%02X  mode0=0x%02X\n",
                      imuWhoAmI(SPI_MODE3), imuWhoAmI(SPI_MODE0));
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
        // Arm the watchdog clock. Without this it stays 0, the `lastGoodMs &&`
        // guard never passes, and a chip that is dead from the very first poll —
        // the case that actually matters — is never declared dead at all.
        lastGoodMs = millis();
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

    // TRY, never wait. The card and this chip share SCK/MISO/MOSI, and the SD
    // driver holds its CS low across a whole multi-command sequence -- so
    // sampling here while the uplink task is mid-read asserts a second CS on a
    // live bus and desynchronises the card for the rest of the sync. Skipping
    // the sample is the cheap side of that trade: sync never runs while
    // recording, so a sample dropped here is never a sample that was going into
    // a paddle. Blocking instead would stall core 1's whole loop -- GNSS, UI and
    // logging -- behind a multi-second card read.
    if (!spiBusTryTake()) return;
    lastPollMs = millis();

    float ax, ay, az, gx, gy, gz;
    bool gotAccel = qmi.getAccelerometer(ax, ay, az);
    bool gotGyro  = qmi.getGyroscope(gx, gy, gz);
    spiBusGive();

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
            DBGE("imu", "silent %lums -> dead, CS parked",
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
