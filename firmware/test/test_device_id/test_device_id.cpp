#include <unity.h>
#include <string.h>
#include "device_id.h"

// ESP.getEfuseMac() packs MAC[0] into the lowest byte.
static uint64_t efuseFor(const uint8_t mac[6])
{
    uint64_t v = 0;
    for (int i = 5; i >= 0; i--) v = (v << 8) | mac[i];
    return v;
}

static const uint8_t PADDLE02[6] = {0x48, 0xca, 0x43, 0x5c, 0x09, 0xb0};
static const uint8_t PADDLE03[6] = {0x48, 0xca, 0x43, 0x5a, 0xba, 0xb0};

// The legacy ID must stay byte-for-byte what 0.15.0 produced, or trackers
// already on an account would stop matching their server record.
static void legacy_matches_what_the_old_firmware_reported(void)
{
    char id[9];
    deviceIdLegacy(efuseFor(PADDLE02), id);
    TEST_ASSERT_EQUAL_STRING("5C43CA48", id);
}

// The bug: paddle03's legacy ID is the first tracker's (5A43CA48).
static void legacy_collides_for_paddle03_and_the_first_tracker(void)
{
    char id[9];
    deviceIdLegacy(efuseFor(PADDLE03), id);
    TEST_ASSERT_EQUAL_STRING("5A43CA48", id);
}

static void unique_id_uses_the_per_board_bytes(void)
{
    char a[9], b[9];
    deviceIdUnique(efuseFor(PADDLE03), a);
    deviceIdUnique(efuseFor(PADDLE02), b);
    TEST_ASSERT_EQUAL_STRING("435ABAB0", a);
    TEST_ASSERT_EQUAL_STRING("435C09B0", b);
    TEST_ASSERT_TRUE(strcmp(a, b) != 0);
}

// Two boards differing only in the last per-board byte must still differ.
static void unique_id_separates_boards_that_differ_in_the_last_byte(void)
{
    const uint8_t x[6] = {0x48, 0xca, 0x43, 0x5a, 0xba, 0xb0};
    const uint8_t y[6] = {0x48, 0xca, 0x43, 0x5a, 0xba, 0xb1};
    char a[9], b[9];
    deviceIdUnique(efuseFor(x), a);
    deviceIdUnique(efuseFor(y), b);
    TEST_ASSERT_TRUE(strcmp(a, b) != 0);
}

static void claimed_trackers_keep_legacy_new_ones_get_unique(void)
{
    TEST_ASSERT_TRUE(deviceIdUseLegacy(true));
    TEST_ASSERT_FALSE(deviceIdUseLegacy(false));
}

// The join QR only fits the panel up to 32 bytes; 0.16.0 made it 33.
static void hotspot_name_keeps_the_join_qr_within_32_bytes(void)
{
    const uint8_t PADDLE04[6] = {0x48, 0xca, 0x43, 0x5c, 0x09, 0xc8};
    char id[9], ssid[7], payload[64];
    deviceIdUnique(efuseFor(PADDLE04), id);
    apSsidFor(id, ssid);
    TEST_ASSERT_EQUAL_STRING("PT-9C8", ssid);
    snprintf(payload, sizeof payload, "WIFI:S:%s;T:WPA;P:%s;;", ssid, "abcdefgh");
    TEST_ASSERT_EQUAL_UINT(32, strlen(payload));

    deviceIdLegacy(efuseFor(PADDLE02), id);   // what claimed trackers keep
    apSsidFor(id, ssid);
    TEST_ASSERT_EQUAL_STRING("PT-A48", ssid);
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(legacy_matches_what_the_old_firmware_reported);
    RUN_TEST(legacy_collides_for_paddle03_and_the_first_tracker);
    RUN_TEST(unique_id_uses_the_per_board_bytes);
    RUN_TEST(unique_id_separates_boards_that_differ_in_the_last_byte);
    RUN_TEST(claimed_trackers_keep_legacy_new_ones_get_unique);
    RUN_TEST(hotspot_name_keeps_the_join_qr_within_32_bytes);
    return UNITY_END();
}
