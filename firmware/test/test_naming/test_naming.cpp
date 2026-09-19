#include <unity.h>
#include "naming.h"

// The regression that motivated a host test environment at all: an upload-rate
// sidecar classified as a track, so the chunked sidecar path never ran.
static void track_predicate_excludes_both_sidecar_suffixes(void)
{
    TEST_ASSERT_TRUE(nameIsTrackUpload("track_20260919_081300.csv"));

    TEST_ASSERT_FALSE(nameIsTrackUpload("track_20260919_081300_i10.csv"));  // the bug
    TEST_ASSERT_FALSE(nameIsTrackUpload("track_20260919_081300_imu.csv"));

    TEST_ASSERT_FALSE(nameIsTrackUpload("uploaded.txt"));
    TEST_ASSERT_FALSE(nameIsTrackUpload("imu_up.tmp"));
    TEST_ASSERT_FALSE(nameIsTrackUpload(".metadata_never_index"));
    TEST_ASSERT_FALSE(nameIsTrackUpload("track_"));          // prefix alone is not a track
    TEST_ASSERT_FALSE(nameIsTrackUpload(""));
    TEST_ASSERT_FALSE(nameIsTrackUpload(0));
}

static void motion_predicate_matches_only_the_upload_rate_file(void)
{
    TEST_ASSERT_TRUE(nameIsMotionUpload("track_20260919_081300_i10.csv"));

    // The full-rate file must NEVER be selected: it reaches 10 MB and re-reading
    // it at sync time once boot-looped the device.
    TEST_ASSERT_FALSE(nameIsMotionUpload("track_20260919_081300_imu.csv"));
    TEST_ASSERT_FALSE(nameIsMotionUpload("track_20260919_081300.csv"));
    TEST_ASSERT_FALSE(nameIsMotionUpload("i10.csv"));
}

static void a_sidecar_uploads_under_the_name_the_server_keys_it_by(void)
{
    char out[64];
    TEST_ASSERT_TRUE(nameMotionUploadName("track_20260919_081300_i10.csv", out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("track_20260919_081300_imu.csv", out);

    // Not a sidecar -> refuses rather than producing a plausible wrong name.
    TEST_ASSERT_FALSE(nameMotionUploadName("track_20260919_081300.csv", out, sizeof(out)));

    // Too small a buffer -> refuses rather than truncating. A truncated name
    // would attach the sidecar to nothing and 409 forever.
    char tiny[8];
    TEST_ASSERT_FALSE(nameMotionUploadName("track_20260919_081300_i10.csv", tiny, sizeof(tiny)));
}

static void chunk_maths_matches_the_real_uploads(void)
{
    const size_t CHUNK = 64 * 1024;

    // The two files from the 19 Sep paddle, which the device reported as 13 and
    // 42 parts.
    TEST_ASSERT_EQUAL_INT(13, chunkCount(790275, CHUNK));
    TEST_ASSERT_EQUAL_INT(42, chunkCount(2715136, CHUNK));

    // Exact multiples must not gain a spurious empty final part.
    TEST_ASSERT_EQUAL_INT(1, chunkCount(CHUNK, CHUNK));
    TEST_ASSERT_EQUAL_INT(2, chunkCount(CHUNK * 2, CHUNK));

    // An empty file is zero chunks, not one. A single empty part is something
    // the server cannot assemble.
    TEST_ASSERT_EQUAL_INT(0, chunkCount(0, CHUNK));
}

static void chunk_lengths_sum_to_the_file(void)
{
    const size_t CHUNK = 64 * 1024;
    const size_t total = 790275;
    const int parts = chunkCount(total, CHUNK);

    size_t sum = 0;
    for (int p = 1; p <= parts; p++) sum += chunkLength(total, CHUNK, p);
    TEST_ASSERT_EQUAL_UINT32((uint32_t)total, (uint32_t)sum);

    TEST_ASSERT_EQUAL_UINT32((uint32_t)CHUNK, (uint32_t)chunkLength(total, CHUNK, 1));
    TEST_ASSERT_EQUAL_UINT32((uint32_t)(total - (size_t)(parts - 1) * CHUNK),
                             (uint32_t)chunkLength(total, CHUNK, parts));

    // Out of range reads nothing rather than past the end of the file.
    TEST_ASSERT_EQUAL_UINT32(0, (uint32_t)chunkLength(total, CHUNK, 0));
    TEST_ASSERT_EQUAL_UINT32(0, (uint32_t)chunkLength(total, CHUNK, parts + 1));
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(track_predicate_excludes_both_sidecar_suffixes);
    RUN_TEST(motion_predicate_matches_only_the_upload_rate_file);
    RUN_TEST(a_sidecar_uploads_under_the_name_the_server_keys_it_by);
    RUN_TEST(chunk_maths_matches_the_real_uploads);
    RUN_TEST(chunk_lengths_sum_to_the_file);
    return UNITY_END();
}
