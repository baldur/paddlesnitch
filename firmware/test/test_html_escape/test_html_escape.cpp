#include <unity.h>
#include <string.h>
#include "html_escape.h"

// The bug: a nearby network named like this was pasted into the setup page raw.
static void a_hostile_network_name_is_inert(void)
{
    char out[128];
    htmlEscape("\"><script>alert(1)</script>", out, sizeof out);
    TEST_ASSERT_EQUAL_STRING("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;", out);
}

static void ordinary_names_are_unchanged(void)
{
    char out[64];
    htmlEscape("BT-Hub 5G", out, sizeof out);
    TEST_ASSERT_EQUAL_STRING("BT-Hub 5G", out);
}

static void quotes_and_ampersands_are_escaped(void)
{
    char out[64];
    htmlEscape("Tom's & Jerry's", out, sizeof out);
    TEST_ASSERT_EQUAL_STRING("Tom&#39;s &amp; Jerry&#39;s", out);
}

static void never_overflows_or_splits_an_entity(void)
{
    char out[8];
    size_t n = htmlEscape("ab<cd", out, sizeof out);   // "ab&lt;" is 6, "c" makes 7
    TEST_ASSERT_EQUAL_STRING("ab&lt;c", out);
    TEST_ASSERT_EQUAL_UINT(7, n);
    htmlEscape("a<<<", out, 6);                         // room for "a&lt;" only
    TEST_ASSERT_EQUAL_STRING("a&lt;", out);
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(a_hostile_network_name_is_inert);
    RUN_TEST(ordinary_names_are_unchanged);
    RUN_TEST(quotes_and_ampersands_are_escaped);
    RUN_TEST(never_overflows_or_splits_an_entity);
    return UNITY_END();
}
