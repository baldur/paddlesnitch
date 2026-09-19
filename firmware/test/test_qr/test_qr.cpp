#include <unity.h>
#include <string.h>
#include "qr.h"

// The spec calls the sizing arithmetic "the thing most likely to be got wrong",
// and it is arithmetic, so it is testable on a host in half a second instead of
// discovered by flashing and squinting at a photograph.
//
// What this CANNOT tell you: whether a real phone reads the thing off a real
// panel at arm's length in daylight. That is item 5 of the spec's verification
// and it needs a camera. These tests only guarantee we never ship a payload
// that silently promotes the code to version 3 and overflows the screen.

static void the_qr_square_fits_the_panel(void)
{
    // 25 modules + 2 quiet either side = 29, at 2 px = 58, against 64 px of
    // panel height. Version 3 would be 33 modules = 66 px and would not fit,
    // which is the entire reason the payload budget is 32 bytes.
    // 62, not 58: the quiet zone now spends whatever the version leaves over,
    // because a thin border is the likeliest scan failure.
    TEST_ASSERT_EQUAL_INT(62, qrSizePx());
    TEST_ASSERT_TRUE(qrSizePx() <= 64);

    // And it leaves room on a 128 px panel for the text fallback BESIDE it,
    // rather than alternating with it.
    TEST_ASSERT_TRUE(128 - qrSizePx() >= 64);
}

static void the_wifi_join_payload_fits_exactly(void)
{
    // WIFI:S:<6>;T:WPA;P:<8>;; -- 32 bytes, the exact version-2 byte budget.
    // The SSID had to shrink from PaddleTracker-A48 to PT-A48 to achieve this,
    // so anything that lengthens either field breaks the code silently.
    const char *join = "WIFI:S:PT-A48;T:WPA;P:12345678;;";
    TEST_ASSERT_EQUAL_INT(32, (int)strlen(join));
    TEST_ASSERT_TRUE(qrFits(join));

    // One more character and it must be refused, not promoted.
    const char *tooLong = "WIFI:S:PT-A488;T:WPA;P:12345678;;";
    TEST_ASSERT_EQUAL_INT(33, (int)strlen(tooLong));
    TEST_ASSERT_FALSE(qrFits(tooLong));

    // Three hex characters, not four. The spec's formula (substring(4) of an
    // 8-char device id) produces "PT-CA48" and 33 bytes -- one over. Pinned
    // here because it is a single character and the failure is silent.
    TEST_ASSERT_FALSE(qrFits("WIFI:S:PT-CA48;T:WPA;P:12345678;;"));

    // The old AP name could never have fitted -- worth pinning so nobody
    // "restores" it.
    TEST_ASSERT_FALSE(qrFits("WIFI:S:PaddleTracker-A48;T:WPA;P:12345678;;"));
}

static void the_claim_link_payload_fits_with_room(void)
{
    const char *link = "paddlesnitch.com/l/ABC123";
    TEST_ASSERT_EQUAL_INT(25, (int)strlen(link));
    TEST_ASSERT_TRUE(qrFits(link));

    // No scheme on purpose, and this is why: with "https://" the payload is 33
    // bytes and does NOT fit. The scheme is not a nicety that was dropped for
    // neatness -- it does not have room to exist.
    const char *withScheme = "https://paddlesnitch.com/l/ABC123";
    TEST_ASSERT_EQUAL_INT(33, (int)strlen(withScheme));
    TEST_ASSERT_FALSE(qrFits(withScheme));
}

static void uppercasing_the_claim_link_buys_a_smaller_version(void)
{
    // Lowercase forces BYTE mode: 25 chars needs version 2.
    TEST_ASSERT_TRUE(qrFits("paddlesnitch.com/l/ABC123"));
    // Uppercase is all inside ALPHANUMERIC mode's set, where 25 chars is
    // exactly version 1's capacity -- fewer modules and a wider quiet zone at
    // the same module size.
    TEST_ASSERT_TRUE(qrFits("PADDLESNITCH.COM/L/ABC123"));
    // Still refused when genuinely too long, in either mode.
    TEST_ASSERT_FALSE(qrFits("HTTPS://PADDLESNITCH.COM/L/ABC123/AND/MORE/AND/MORE/X"));
}

static void nothing_silly_is_accepted(void)
{
    TEST_ASSERT_FALSE(qrFits(0));
    TEST_ASSERT_TRUE(qrFits(""));
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(the_qr_square_fits_the_panel);
    RUN_TEST(the_wifi_join_payload_fits_exactly);
    RUN_TEST(the_claim_link_payload_fits_with_room);
    RUN_TEST(uppercasing_the_claim_link_buys_a_smaller_version);
    RUN_TEST(nothing_silly_is_accepted);
    return UNITY_END();
}
