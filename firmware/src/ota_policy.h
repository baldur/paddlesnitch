#pragma once
#include <stdint.h>

// The DECISIONS behind an over-the-air update, kept pure so they can be tested
// on the host with `pio test -e native`. No Arduino, no network, no flash.
//
// This split exists because these are the lines that can brick a device or,
// just as bad, silently never update one — and this firmware has already paid
// once for an untested predicate (isTrackUpload missing `_i10.csv` cost a week).
// The I/O half lives in ota.cpp and is not host-testable; this half is.

// Three strikes, then stop. An update that fails forever must not turn into a
// device that spends every sync pulling a megabyte it will never boot.
static const uint8_t OTA_MAX_FAILS = 3;

// Boots allowed on a new image before the app-level rollback fires.
static const uint8_t OTA_MAX_BOOTS = 3;

// Only consulted when the device is on battery alone. Below this an update is
// refused: a brown-out midway through writing the inactive slot is survivable
// (otadata is untouched), but a brown-out during Update.end() is not worth risking.
static const uint16_t OTA_MIN_BATTERY_MV = 3800;

struct OtaGateInputs {
    bool     havePendingVersion = false;  // the server told us a version
    bool     versionDiffers     = false;  // ...and it is not what we are running
    bool     recording          = false;  // storageRecording()
    bool     wifiUp             = false;
    bool     everConnected      = false;  // netcfg.everConnected — the home network
    bool     onUsb              = false;  // boardOnUsb()  — VBUS present
    bool     charging           = false;  // boardIsCharging()
    uint16_t batteryMv          = 0;      // 0 when no cell is fitted
    uint8_t  failCount          = 0;      // failures recorded for THIS version
};

enum class OtaGate : uint8_t {
    Go = 0,
    NoPending,
    SameVersion,
    Recording,
    NoWifi,
    NotHomeNetwork,
    LowPower,
    TooManyFailures,
};

/**
 * Should the device attempt an update right now?
 *
 * Deliberately conservative: a bricked device on the water needs a cable and a
 * person holding it. Every gate must pass.
 *
 * Order matters only for which reason is reported, and it is ordered cheapest
 * and most-common first so the usual answer ("nothing pending") is the first
 * test rather than the last.
 */
OtaGate otaEvaluateGates(const OtaGateInputs &in);

/** A short, human reason for a gate result — goes to the serial log and the
 *  flight recorder, so "why did it not update?" is answerable after the fact. */
const char *otaGateReason(OtaGate g);

/**
 * Do two version strings differ?
 *
 * Deliberately a plain inequality, NOT a "is newer" comparison. The server's
 * channel pointer is the authority on what this device should run, and that
 * includes ROLLING BACK: unpromoting 0.12.0 back to 0.11.0 must move devices
 * down, which a `>` test would silently refuse. Ordering is the release
 * workflow's job, not the device's.
 *
 * Null or empty on either side is "no opinion" -> false, so a missing header
 * never triggers an update.
 */
bool otaVersionDiffers(const char *running, const char *offered);

/** Is this version worth another attempt, or has it already failed too often? */
bool otaMayRetryVersion(uint8_t failCount);

/**
 * Check for an update BEFORE uploading, rather than after?
 *
 * Only on the first sync after a crash (panic or watchdog). The update check
 * normally comes after the uploads; a build that crashes DURING an upload
 * (2026-10-04: the uplink stack overflowed on the first compressed upload)
 * would then never reach it, and only a cable could fix the tracker.
 */
bool otaCheckBeforeUploads(bool lastResetWasCrash, bool firstSyncSinceBoot);
