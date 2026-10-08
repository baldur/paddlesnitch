#include <unity.h>
#include "upload_index.h"

static void looks_up_a_files_code(void)
{
    UploadIndex ix;
    ix.addLine("track_0001.csv\t201\n");
    ix.addLine("track_0002.csv\t422");
    TEST_ASSERT_EQUAL_INT(201, ix.rc("track_0001.csv"));
    TEST_ASSERT_EQUAL_INT(422, ix.rc("track_0002.csv"));
    TEST_ASSERT_EQUAL_INT(0, ix.rc("track_0003.csv"));
    TEST_ASSERT_FALSE(ix.has("track_0003.csv"));
}

// The line-by-line lookup stopped at the first match: keep that answer.
static void the_first_line_for_a_name_wins(void)
{
    UploadIndex ix;
    ix.addLine("track_0001.csv\t409");
    ix.addLine("track_0001.csv\t422");
    TEST_ASSERT_EQUAL_INT(409, ix.rc("track_0001.csv"));
}

// Very old index lines carry no code: still "already uploaded".
static void a_line_without_a_code_still_counts_as_uploaded(void)
{
    UploadIndex ix;
    ix.addLine("track_0001.csv\r\n");
    TEST_ASSERT_TRUE(ix.has("track_0001.csv"));
    TEST_ASSERT_EQUAL_INT(0, ix.rc("track_0001.csv"));
}

static void blank_lines_are_ignored(void)
{
    UploadIndex ix;
    ix.addLine("");
    ix.addLine("   \n");
    ix.addLine(nullptr);
    TEST_ASSERT_EQUAL_INT(0, (int)ix.size());
}

// The card that crashed: hundreds of recordings, each looked up once.
static void a_full_card_is_looked_up_from_memory(void)
{
    UploadIndex ix;
    char line[48];
    for (int i = 0; i < 2000; i++) { snprintf(line, sizeof line, "track_%04d.csv\t201", i); ix.addLine(line); }
    int found = 0;
    for (int i = 0; i < 2000; i++) { snprintf(line, sizeof line, "track_%04d.csv", i); found += ix.rc(line) == 201; }
    TEST_ASSERT_EQUAL_INT(2000, found);
}

// The index outlives the files: only what's on the card is kept.
static void only_the_wanted_names_are_kept(void)
{
    UploadIndex ix;
    ix.want("track_0002.csv");
    ix.addLine("track_0001.csv\t201");
    ix.addLine("track_0002.csv\t201");
    TEST_ASSERT_EQUAL_INT(1, (int)ix.size());
    TEST_ASSERT_TRUE(ix.has("track_0002.csv"));
    TEST_ASSERT_FALSE(ix.has("track_0001.csv"));
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(looks_up_a_files_code);
    RUN_TEST(the_first_line_for_a_name_wins);
    RUN_TEST(a_line_without_a_code_still_counts_as_uploaded);
    RUN_TEST(blank_lines_are_ignored);
    RUN_TEST(a_full_card_is_looked_up_from_memory);
    RUN_TEST(only_the_wanted_names_are_kept);
    return UNITY_END();
}
