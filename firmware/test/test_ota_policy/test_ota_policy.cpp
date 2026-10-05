#include <unity.h>
#include "ota_policy.h"

// A device that passes every gate. Individual tests break ONE thing, so a test
// that fails names exactly the gate that rejected it.
static OtaGateInputs ready(void)
{
    OtaGateInputs in;
    in.havePendingVersion = true;
    in.versionDiffers     = true;
    in.recording          = false;
    in.wifiUp             = true;
    in.everConnected      = true;
    in.onUsb              = true;
    in.charging           = false;
    in.batteryMv          = 0;      // no cell fitted — the bench rig
    in.failCount          = 0;
    return in;
}

static void a_ready_device_is_allowed(void)
{
    TEST_ASSERT_EQUAL(OtaGate::Go, otaEvaluateGates(ready()));
}

// THE ONE THAT MATTERS FOR THE FIRST BENCH TEST.
//
// The spec wrote the power gate as `charging || batteryMv > 3800`. A device on
// USB with NO battery fitted reports batteryMv == 0 (boardBatteryMv short
// -circuits on !isBatteryConnect) and isCharging() false — nothing to charge.
// Under the spec's rule that device can never update, and the only symptom
// would be silence. USB power is strictly better than any battery state.
static void usb_power_alone_satisfies_the_power_gate_with_no_battery_fitted(void)
{
    OtaGateInputs in = ready();
    in.onUsb     = true;
    in.charging  = false;
    in.batteryMv = 0;
    TEST_ASSERT_EQUAL(OtaGate::Go, otaEvaluateGates(in));
}

static void a_flat_battery_on_no_usb_is_refused(void)
{
    OtaGateInputs in = ready();
    in.onUsb     = false;
    in.charging  = false;
    in.batteryMv = 3700;
    TEST_ASSERT_EQUAL(OtaGate::LowPower, otaEvaluateGates(in));
}

static void a_healthy_battery_alone_is_enough(void)
{
    OtaGateInputs in = ready();
    in.onUsb     = false;
    in.charging  = false;
    in.batteryMv = 4000;
    TEST_ASSERT_EQUAL(OtaGate::Go, otaEvaluateGates(in));
}

static void the_battery_threshold_is_exclusive(void)
{
    OtaGateInputs in = ready();
    in.onUsb = false; in.charging = false;
    in.batteryMv = OTA_MIN_BATTERY_MV;          // exactly 3800 is NOT enough
    TEST_ASSERT_EQUAL(OtaGate::LowPower, otaEvaluateGates(in));
    in.batteryMv = OTA_MIN_BATTERY_MV + 1;
    TEST_ASSERT_EQUAL(OtaGate::Go, otaEvaluateGates(in));
}

static void charging_alone_is_enough(void)
{
    OtaGateInputs in = ready();
    in.onUsb = false; in.charging = true; in.batteryMv = 3500;
    TEST_ASSERT_EQUAL(OtaGate::Go, otaEvaluateGates(in));
}

static void never_mid_recording(void)
{
    OtaGateInputs in = ready();
    in.recording = true;
    TEST_ASSERT_EQUAL(OtaGate::Recording, otaEvaluateGates(in));
}

static void never_without_wifi(void)
{
    OtaGateInputs in = ready();
    in.wifiUp = false;
    TEST_ASSERT_EQUAL(OtaGate::NoWifi, otaEvaluateGates(in));
}

// A multi-megabyte download over somebody's phone hotspot at a race is a bad
// surprise. everConnected means credentials that have worked before.
static void never_on_an_unknown_network(void)
{
    OtaGateInputs in = ready();
    in.everConnected = false;
    TEST_ASSERT_EQUAL(OtaGate::NotHomeNetwork, otaEvaluateGates(in));
}

static void nothing_pending_is_the_common_case(void)
{
    OtaGateInputs in = ready();
    in.havePendingVersion = false;
    TEST_ASSERT_EQUAL(OtaGate::NoPending, otaEvaluateGates(in));
}

static void the_same_version_is_not_an_update(void)
{
    OtaGateInputs in = ready();
    in.versionDiffers = false;
    TEST_ASSERT_EQUAL(OtaGate::SameVersion, otaEvaluateGates(in));
}

// An update that fails forever must not become a device that pulls a megabyte
// every five minutes for the rest of its life.
static void gives_up_after_three_failures_on_one_version(void)
{
    OtaGateInputs in = ready();
    in.failCount = OTA_MAX_FAILS - 1;
    TEST_ASSERT_EQUAL(OtaGate::Go, otaEvaluateGates(in));
    in.failCount = OTA_MAX_FAILS;
    TEST_ASSERT_EQUAL(OtaGate::TooManyFailures, otaEvaluateGates(in));
    TEST_ASSERT_TRUE(otaMayRetryVersion(2));
    TEST_ASSERT_FALSE(otaMayRetryVersion(3));
    TEST_ASSERT_FALSE(otaMayRetryVersion(9));
}

// Version comparison is INEQUALITY, not "is newer" — unpromoting 0.12.0 back to
// 0.11.0 has to move devices DOWN, and a `>` test would silently refuse the
// rollback that exists to save them.
static void a_downgrade_counts_as_a_difference(void)
{
    TEST_ASSERT_TRUE(otaVersionDiffers("0.12.0", "0.11.0"));
    TEST_ASSERT_TRUE(otaVersionDiffers("0.11.0", "0.12.0"));
    TEST_ASSERT_FALSE(otaVersionDiffers("0.11.0", "0.11.0"));
}

// A missing header is "no opinion" and must never trigger an update.
static void absent_or_empty_versions_never_trigger_an_update(void)
{
    TEST_ASSERT_FALSE(otaVersionDiffers(0, "0.12.0"));
    TEST_ASSERT_FALSE(otaVersionDiffers("0.11.0", 0));
    TEST_ASSERT_FALSE(otaVersionDiffers("", "0.12.0"));
    TEST_ASSERT_FALSE(otaVersionDiffers("0.11.0", ""));
    TEST_ASSERT_FALSE(otaVersionDiffers(0, 0));
}

static void every_gate_has_a_readable_reason(void)
{
    const OtaGate all[] = {
        OtaGate::Go, OtaGate::NoPending, OtaGate::SameVersion, OtaGate::Recording,
        OtaGate::NoWifi, OtaGate::NotHomeNetwork, OtaGate::LowPower, OtaGate::TooManyFailures,
    };
    for (unsigned i = 0; i < sizeof(all) / sizeof(all[0]); i++) {
        const char *r = otaGateReason(all[i]);
        TEST_ASSERT_NOT_NULL(r);
        TEST_ASSERT_TRUE(r[0] != '\0');
        TEST_ASSERT_TRUE(r[0] != '?');
    }
}


// A crash DURING an upload (2026-10-04: the uplink stack overflowed on the
// first compressed upload) used to be unfixable over the air: the tracker
// checked for an update only after uploading, so it crashed before it ever
// asked. After a crash, the first sync now checks first.
static void after_a_crash_the_first_sync_checks_for_an_update_before_uploading(void)
{
    TEST_ASSERT_TRUE(otaCheckBeforeUploads(true, true));
}

static void normally_uploads_go_first(void)
{
    TEST_ASSERT_FALSE(otaCheckBeforeUploads(false, true));    // a normal start
    TEST_ASSERT_FALSE(otaCheckBeforeUploads(true, false));    // only the first sync after it
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(a_ready_device_is_allowed);
    RUN_TEST(usb_power_alone_satisfies_the_power_gate_with_no_battery_fitted);
    RUN_TEST(a_flat_battery_on_no_usb_is_refused);
    RUN_TEST(a_healthy_battery_alone_is_enough);
    RUN_TEST(the_battery_threshold_is_exclusive);
    RUN_TEST(charging_alone_is_enough);
    RUN_TEST(never_mid_recording);
    RUN_TEST(never_without_wifi);
    RUN_TEST(never_on_an_unknown_network);
    RUN_TEST(nothing_pending_is_the_common_case);
    RUN_TEST(the_same_version_is_not_an_update);
    RUN_TEST(gives_up_after_three_failures_on_one_version);
    RUN_TEST(a_downgrade_counts_as_a_difference);
    RUN_TEST(absent_or_empty_versions_never_trigger_an_update);
    RUN_TEST(every_gate_has_a_readable_reason);
    RUN_TEST(after_a_crash_the_first_sync_checks_for_an_update_before_uploading);
    RUN_TEST(normally_uploads_go_first);
    return UNITY_END();
}
