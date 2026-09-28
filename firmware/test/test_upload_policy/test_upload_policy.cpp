#include <unity.h>
#include "upload_policy.h"

static void accepted_replies_are_done(void)
{
    TEST_ASSERT_TRUE(uploadOutcome(201, "{}") == UploadOutcome::Accepted);
    TEST_ASSERT_TRUE(uploadOutcome(409, "{\"error\":\"already_uploaded\"}") == UploadOutcome::Accepted);
}

// The bug: these were retried every sync, forever.
static void a_recording_the_server_cannot_use_is_not_sent_again(void)
{
    TEST_ASSERT_TRUE(uploadOutcome(422, "{\"error\":\"no_points\"}") == UploadOutcome::Rejected);
    TEST_ASSERT_TRUE(uploadOutcome(422, "{\"error\":\"no_motion_rows\"}") == UploadOutcome::Rejected);
    TEST_ASSERT_TRUE(uploadOutcome(413, "{\"error\":\"too_large\"}") == UploadOutcome::Rejected);
    TEST_ASSERT_TRUE(uploadOutcome(400, "{\"error\":\"bad_filename\"}") == UploadOutcome::Rejected);
}

static void temporary_failures_are_retried(void)
{
    TEST_ASSERT_TRUE(uploadOutcome(409, "{\"error\":\"track_not_uploaded\"}") == UploadOutcome::Retry);
    TEST_ASSERT_TRUE(uploadOutcome(409, "{\"error\":\"parts_missing\"}") == UploadOutcome::Retry);
    TEST_ASSERT_TRUE(uploadOutcome(401, "") == UploadOutcome::Retry);
    TEST_ASSERT_TRUE(uploadOutcome(503, "") == UploadOutcome::Retry);
    TEST_ASSERT_TRUE(uploadOutcome(-1, "") == UploadOutcome::Retry);   // no connection
    TEST_ASSERT_TRUE(uploadOutcome(409, nullptr) == UploadOutcome::Retry);
}

static void the_index_tells_confirmed_from_rejected(void)
{
    TEST_ASSERT_TRUE(indexRcConfirmed(201));
    TEST_ASSERT_TRUE(indexRcConfirmed(409));
    TEST_ASSERT_FALSE(indexRcConfirmed(422));   // DELETE UPLOADED must keep these
    TEST_ASSERT_TRUE(indexRcRejected(422));
    TEST_ASSERT_FALSE(indexRcRejected(201));
}

static void finds_the_motion_file_of_a_track(void)
{
    char out[64];
    TEST_ASSERT_TRUE(sidecarForTrack("track_20260928_202520.csv", out, sizeof out));
    TEST_ASSERT_EQUAL_STRING("track_20260928_202520_i10.csv", out);
    TEST_ASSERT_FALSE(sidecarForTrack("notes.txt", out, sizeof out));
    TEST_ASSERT_FALSE(sidecarForTrack("track_20260928_202520.csv", out, 10));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(accepted_replies_are_done);
    RUN_TEST(a_recording_the_server_cannot_use_is_not_sent_again);
    RUN_TEST(temporary_failures_are_retried);
    RUN_TEST(the_index_tells_confirmed_from_rejected);
    RUN_TEST(finds_the_motion_file_of_a_track);
    return UNITY_END();
}
