#include <unity.h>
#include <string.h>
#include "claim_proof.h"

// The server verifies a signature over exactly these bytes; one character of
// difference and no tracker can be added to an account.
static void the_claim_message_is_what_the_server_checks(void)
{
    char out[128];
    size_t n = claimProofMessage("435C09C8", "q1w2e3-_r4", out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("paddlesnitch-claim\n435C09C8\nq1w2e3-_r4\n", out);
    TEST_ASSERT_EQUAL(strlen(out), n);
}

static void the_link_message_is_what_the_server_checks(void)
{
    char out[128];
    linkProofMessage("435C09C8", "ab", out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("paddlesnitch-link\n435C09C8\nab\n", out);
}

static void a_claim_and_a_link_never_sign_the_same_bytes(void)
{
    char a[128], b[128];
    claimProofMessage("435C09C8", "x", a, sizeof(a));
    linkProofMessage("435C09C8", "x", b, sizeof(b));
    TEST_ASSERT_TRUE(strcmp(a, b) != 0);
}

static void too_small_a_buffer_is_refused_not_truncated(void)
{
    char out[20];
    TEST_ASSERT_EQUAL(0, claimProofMessage("435C09C8", "secret", out, sizeof(out)));
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(the_claim_message_is_what_the_server_checks);
    RUN_TEST(the_link_message_is_what_the_server_checks);
    RUN_TEST(a_claim_and_a_link_never_sign_the_same_bytes);
    RUN_TEST(too_small_a_buffer_is_refused_not_truncated);
    return UNITY_END();
}
