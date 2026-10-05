#include <unity.h>
#include <string.h>
#include "ble_about.h"

void setUp(void) {}
void tearDown(void) {}

static void about_is_the_json_the_website_reads(void)
{
    char buf[200];
    bleAboutJson(buf, sizeof(buf), "435AC17C", "0.18.0", "lilygo-tbeam-s3-supreme", 2, true);
    TEST_ASSERT_EQUAL_STRING(
        "{\"v\":1,\"id\":\"435AC17C\",\"fw\":\"0.18.0\",\"model\":\"lilygo-tbeam-s3-supreme\",\"waiting\":2,\"linked\":true}",
        buf);
}

// Before the tracker has counted its card, "0 waiting" would be a lie.
static void an_uncounted_card_says_null_not_zero(void)
{
    char buf[200];
    bleAboutJson(buf, sizeof(buf), "435AC17C", "0.18.0", "m", -1, false);
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"waiting\":null"));
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"linked\":false"));
}

// A Bluetooth read returns at most ~500 bytes; the payload must fit with room.
static void about_fits_one_read(void)
{
    char buf[512];
    int n = bleAboutJson(buf, sizeof(buf), "FFFFFFFF", "10.20.30", "lilygo-tbeam-s3-supreme", 99999, true);
    TEST_ASSERT_TRUE(n > 0 && n < 180);
}

static void link_status_carries_the_hash_never_a_token(void)
{
    char buf[200];
    bleLinkJson(buf, sizeof(buf), "435AC17C", "pending",
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    TEST_ASSERT_EQUAL_STRING(
        "{\"v\":1,\"id\":\"435AC17C\",\"state\":\"pending\","
        "\"tokenHash\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}", buf);
    bleLinkJson(buf, sizeof(buf), "435AC17C", "idle", nullptr);
    TEST_ASSERT_NOT_NULL(strstr(buf, "\"tokenHash\":\"\""));
}

static void wifi_status_is_one_word_the_page_maps(void)
{
    char buf[64];
    bleWifiJson(buf, sizeof(buf), "wrong_password");
    TEST_ASSERT_EQUAL_STRING("{\"v\":1,\"state\":\"wrong_password\"}", buf);
}

static void a_page_starts_with_its_offset_little_endian(void)
{
    uint8_t h[4];
    blePageHeader(h, 0x00012345);
    TEST_ASSERT_EQUAL_HEX8(0x45, h[0]); TEST_ASSERT_EQUAL_HEX8(0x23, h[1]);
    TEST_ASSERT_EQUAL_HEX8(0x01, h[2]); TEST_ASSERT_EQUAL_HEX8(0x00, h[3]);
    TEST_ASSERT_TRUE(PS_BLE_PAGE_DATA + 4 <= 512);   // one Bluetooth read
}

// Must equal the server's uploadReceipt message, or no receipt ever checks.
static void the_receipt_covers_the_id_and_the_server_side_name(void)
{
    char m[100];
    bleReceiptMessage(m, sizeof(m), "435AC17C", "track_20261005_061002_imu.csv");
    TEST_ASSERT_EQUAL_STRING("ps-receipt:v1|435AC17C|track_20261005_061002_imu.csv", m);
}

static void sync_status_says_what_data_holds(void)
{
    char b[160];
    bleSyncJson(b, sizeof(b), "ready", 18234, 2, 10, true);
    TEST_ASSERT_EQUAL_STRING("{\"v\":1,\"state\":\"ready\",\"len\":18234,\"part\":2,\"parts\":10,\"compressed\":true}", b);
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(about_is_the_json_the_website_reads);
    RUN_TEST(an_uncounted_card_says_null_not_zero);
    RUN_TEST(about_fits_one_read);
    RUN_TEST(link_status_carries_the_hash_never_a_token);
    RUN_TEST(wifi_status_is_one_word_the_page_maps);
    RUN_TEST(a_page_starts_with_its_offset_little_endian);
    RUN_TEST(the_receipt_covers_the_id_and_the_server_side_name);
    RUN_TEST(sync_status_says_what_data_holds);
    return UNITY_END();
}
