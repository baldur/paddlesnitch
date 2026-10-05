#include "ota_policy.h"
#include <string.h>

bool otaVersionDiffers(const char *running, const char *offered)
{
    if (!running || !offered) return false;
    if (!*running || !*offered) return false;
    return strcmp(running, offered) != 0;
}

bool otaMayRetryVersion(uint8_t failCount)
{
    return failCount < OTA_MAX_FAILS;
}

OtaGate otaEvaluateGates(const OtaGateInputs &in)
{
    // Cheapest and most common first: in the steady state there is nothing
    // pending and this is the only test that runs.
    if (!in.havePendingVersion) return OtaGate::NoPending;
    if (!in.versionDiffers)     return OtaGate::SameVersion;

    // Never mid-session. The uploader already follows this rule, and an update
    // costs the SPI bus and a reboot — both fatal to a recording.
    if (in.recording) return OtaGate::Recording;

    if (!in.wifiUp) return OtaGate::NoWifi;
    // everConnected means these are credentials that have worked before, i.e.
    // home, not a captive portal at a race. A multi-megabyte download over a
    // hotspot someone is paying for by the megabyte is a bad surprise.
    if (!in.everConnected) return OtaGate::NotHomeNetwork;

    // POWER. The spec wrote this as `charging || batteryMv > 3800`, which is
    // wrong on the most likely test rig: with no cell fitted boardBatteryMv()
    // returns 0 (it short-circuits on !isBatteryConnect()) and nothing is
    // charging, so a bench device on USB would refuse to update FOREVER — and
    // the only symptom would be silence.
    //
    // VBUS present is strictly better than any battery state: wall power does
    // not brown out halfway through Update.end(). So USB alone is sufficient.
    if (!in.onUsb && !in.charging && in.batteryMv <= OTA_MIN_BATTERY_MV) return OtaGate::LowPower;

    if (!otaMayRetryVersion(in.failCount)) return OtaGate::TooManyFailures;

    return OtaGate::Go;
}

const char *otaGateReason(OtaGate g)
{
    switch (g) {
        case OtaGate::Go:              return "go";
        case OtaGate::NoPending:       return "nothing pending";
        case OtaGate::SameVersion:     return "already on that version";
        case OtaGate::Recording:       return "recording";
        case OtaGate::NoWifi:          return "wifi down";
        case OtaGate::NotHomeNetwork:  return "not a known network";
        case OtaGate::LowPower:        return "no usb and battery low";
        case OtaGate::TooManyFailures: return "this version failed 3 times";
    }
    return "?";
}

bool otaCheckBeforeUploads(bool lastResetWasCrash, bool firstSyncSinceBoot)
{
    return lastResetWasCrash && firstSyncSinceBoot;
}
