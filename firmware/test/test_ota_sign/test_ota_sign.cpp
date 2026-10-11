#include <unity.h>
#include <string.h>
#include "ota_sign.h"

// The release job signs exactly these bytes (.github/workflows/firmware-release.yml).
// If the two ever disagree, every signed update is refused, so the format is
// pinned here byte for byte.
static const char *SHA = "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08";

static void the_signed_message_names_the_version_and_the_image(void)
{
    char out[160];
    size_t n = otaSignedMessage("0.19.0", SHA, out, sizeof(out));
    const char *want =
        "paddlesnitch-firmware\n0.19.0\n"
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08\n";
    TEST_ASSERT_EQUAL_STRING(want, out);
    TEST_ASSERT_EQUAL(strlen(want), n);
}

// A signature over one version must not vouch for the same bytes under another
// version, or the tracker would believe whatever label the manifest gave it.
static void a_different_version_is_a_different_message(void)
{
    char a[160], b[160];
    otaSignedMessage("0.19.0", SHA, a, sizeof(a));
    otaSignedMessage("0.19.1", SHA, b, sizeof(b));
    TEST_ASSERT_TRUE(strcmp(a, b) != 0);
}

static void a_hash_that_is_not_64_hex_is_refused(void)
{
    char out[160];
    TEST_ASSERT_EQUAL(0, otaSignedMessage("0.19.0", "abc", out, sizeof(out)));
    TEST_ASSERT_EQUAL(0, otaSignedMessage("0.19.0",
        "zz86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", out, sizeof(out)));
}

static void a_version_with_a_newline_is_refused(void)
{
    char out[160];
    TEST_ASSERT_EQUAL(0, otaSignedMessage("0.19.0\nx", SHA, out, sizeof(out)));
    TEST_ASSERT_EQUAL(0, otaSignedMessage("", SHA, out, sizeof(out)));
}

static void a_buffer_too_small_is_refused_not_truncated(void)
{
    char out[40];
    TEST_ASSERT_EQUAL(0, otaSignedMessage("0.19.0", SHA, out, sizeof(out)));
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(the_signed_message_names_the_version_and_the_image);
    RUN_TEST(a_different_version_is_a_different_message);
    RUN_TEST(a_hash_that_is_not_64_hex_is_refused);
    RUN_TEST(a_version_with_a_newline_is_refused);
    RUN_TEST(a_buffer_too_small_is_refused_not_truncated);
    return UNITY_END();
}
