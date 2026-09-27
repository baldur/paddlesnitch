#pragma once
#include <Arduino.h>

// Over-the-air firmware update — the device half.
// Spec: ../../docs/features/device-ota-and-auth.md, Phase 3.
//
// Everything here runs on the UPLINK TASK (core 0), like every other network
// operation in this firmware. Nothing here draws: it publishes into the
// mutex-guarded UplinkStatus and ui.cpp renders it. Nothing here touches the SD
// card either — the image streams from TLS straight into the inactive flash
// slot, deliberately, because the card shares an SPI bus with the IMU and that
// bus is the source of this firmware's worst bug class.
//
// The DECISIONS (gates, version comparison, give-up counting) live in
// ota_policy.h, which is pure and host-tested. This file is the I/O.

// --- boot-time bookkeeping --------------------------------------------------

// Call EARLY in setup(), before anything else can crash.
//
// If the previous boot flashed a new image, this counts the attempt and, after
// OTA_MAX_BOOTS unsuccessful ones, sets the boot partition back and reboots into
// the old image. An image that faults before this runs is beyond app-level
// rescue and needs a cable — that limit is real and is written down rather than
// glossed over.
void otaBootCheck();

// Call once the device has proved it works: PMU, display, GPS UART and card all
// came up. Clears the pending flag and cancels the bootloader's rollback timer,
// making the new image permanent. Until this is called, a reboot counts against
// OTA_MAX_BOOTS.
void otaMarkValid();

// True on the first boot of a freshly installed version, until dismissed — the
// UI shows "Updated to X" plus the release note.
bool    otaJustUpdated();
String  otaJustUpdatedVersion();
String  otaJustUpdatedNotes();
void    otaDismissUpdatedNotice();

// --- the signal -------------------------------------------------------------

// Feed the X-PS-Firmware header from ANY device-authenticated response. Cheap
// and safe to call on every response; it only records a version string.
//
// An empty or absent header means "no opinion" and must NOT be read as "you are
// current" — passing "" or nullptr here is a no-op, never a clear.
void otaNoteServerVersion(const char *version);

// --- the update itself ------------------------------------------------------

enum class OtaPhase : uint8_t { Idle, Checking, Downloading, Verifying, Done, Failed };

struct OtaProgress {
    OtaPhase phase   = OtaPhase::Idle;
    uint8_t  percent = 0;
    char     version[16] = "";
    char     message[48] = "";
};

OtaProgress otaGetProgress();

// Attempt an update if every gate passes. Call from the uplink task when idle
// and not recording. Returns true only if an image was flashed (in which case
// the device is about to reboot). Cheap no-op when nothing is pending — that is
// the steady state and it costs one comparison.
bool otaMaybeUpdate();

// Is there a boot outcome the server has not been told about yet? The ack rides
// on the next sync rather than forcing its own connection.
bool otaAckPending();

// POST the pending boot outcome to /api/devices/firmware/ack. Safe to call
// repeatedly; the server is idempotent on (deviceId, version) and this clears
// its local flag only on a 2xx, so a failed sync retries next time.
void otaSendAck();
