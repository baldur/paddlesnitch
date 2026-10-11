#include <unity.h>
#include <algorithm>
#include "card_cleanup.h"

static const uint64_t MB = 1024ull * 1024ull;
static const uint64_t CARD = 1000 * MB;

static bool has(const std::vector<std::string> &v, const char *n) { return std::find(v.begin(), v.end(), n) != v.end(); }

// One paddle: track, 10 Hz motion, full-rate motion.
static void paddle(std::vector<CardFile> &f, const std::string &base, uint64_t imuMb)
{
    f.push_back({ base + ".csv", 1 * MB });
    f.push_back({ base + "_i10.csv", 2 * MB });
    f.push_back({ base + "_imu.csv", imuMb * MB });
}

static void names_belong_to_their_paddle(void)
{
    TEST_ASSERT_EQUAL_STRING("track_20261011_072956", cardUnitBase("track_20261011_072956.csv").c_str());
    TEST_ASSERT_EQUAL_STRING("track_20261011_072956", cardUnitBase("track_20261011_072956_i10.csv").c_str());
    TEST_ASSERT_EQUAL_STRING("track_20261011_072956", cardUnitBase("track_20261011_072956_imu.csv").c_str());
    TEST_ASSERT_EQUAL_STRING("", cardUnitBase("uploaded.txt").c_str());
    TEST_ASSERT_EQUAL_STRING("", cardUnitBase("put.tmp").c_str());
}

static void a_card_with_room_deletes_nothing(void)
{
    std::vector<CardFile> f; paddle(f, "track_20260901_080000", 100);
    UploadIndex ix; ix.addLine("track_20260901_080000.csv\t201"); ix.addLine("track_20260901_080000_i10.csv\t201");
    TEST_ASSERT_EQUAL(0, cardSpacePlan(f, ix, CARD, "").size());
}

// The card is past 80%: whole uploaded paddles go, oldest first, until under 70%.
// Six paddles of 143 MB on a 1000 MB card is 858 MB (86%); one gone leaves 715
// (71.5%, still over), two gone leaves 572 -- so exactly the two oldest go.
static void a_full_card_frees_the_oldest_uploaded_paddles_first(void)
{
    const char *bases[] = { "track_20260904_080000", "track_20260901_080000", "track_20260906_080000",
                            "track_20260902_080000", "track_20260905_080000", "track_20260903_080000" };
    std::vector<CardFile> f;
    UploadIndex ix;
    for (const char *b : bases) {
        paddle(f, b, 140);
        ix.addLine((std::string(b) + ".csv\t201").c_str());
        ix.addLine((std::string(b) + "_i10.csv\t201").c_str());
    }
    auto plan = cardSpacePlan(f, ix, CARD, "");
    TEST_ASSERT_EQUAL(6, plan.size());
    TEST_ASSERT_TRUE(has(plan, "track_20260901_080000_imu.csv"));
    TEST_ASSERT_TRUE(has(plan, "track_20260901_080000.csv"));
    TEST_ASSERT_TRUE(has(plan, "track_20260901_080000_i10.csv"));
    TEST_ASSERT_TRUE(has(plan, "track_20260902_080000_imu.csv"));
    TEST_ASSERT_FALSE(has(plan, "track_20260903_080000.csv"));
}

// Nothing goes unless the server has the track AND its motion file.
static void a_paddle_not_fully_uploaded_is_never_freed(void)
{
    std::vector<CardFile> f;
    paddle(f, "track_20260901_080000", 450);   // track up, motion not yet
    paddle(f, "track_20260902_080000", 450);   // nothing up
    UploadIndex ix; ix.addLine("track_20260901_080000.csv\t201");
    TEST_ASSERT_EQUAL(0, cardSpacePlan(f, ix, CARD, "").size());
}

// A track the server refused (422) is the evidence if something is wrong: keep it.
static void a_refused_track_is_kept(void)
{
    std::vector<CardFile> f; paddle(f, "track_20260901_080000", 900);
    UploadIndex ix; ix.addLine("track_20260901_080000.csv\t422"); ix.addLine("track_20260901_080000_i10.csv\t422");
    TEST_ASSERT_EQUAL(0, cardSpacePlan(f, ix, CARD, "").size());
}

// A motion file the server refused for good does not hold its paddle on the card.
static void a_refused_motion_file_does_not_block_freeing(void)
{
    std::vector<CardFile> f; paddle(f, "track_20260901_080000", 900);
    UploadIndex ix; ix.addLine("track_20260901_080000.csv\t201"); ix.addLine("track_20260901_080000_i10.csv\t413");
    TEST_ASSERT_EQUAL(3, cardSpacePlan(f, ix, CARD, "").size());
}

static void the_paddle_being_recorded_is_never_touched(void)
{
    std::vector<CardFile> f; paddle(f, "track_20260901_080000", 900);
    UploadIndex ix; ix.addLine("track_20260901_080000.csv\t201"); ix.addLine("track_20260901_080000_i10.csv\t201");
    TEST_ASSERT_EQUAL(0, cardSpacePlan(f, ix, CARD, "track_20260901_080000").size());
    TEST_ASSERT_EQUAL(0, cardManualPlan(f, ix, "track_20260901_080000").size());
}

// What filled the original tracker's card: tracks deleted by "delete uploaded",
// their motion files left behind with no track. The index still holds the
// track's line, so the leftovers are recognised as uploaded and can go.
static void leftovers_of_a_deleted_track_are_freed(void)
{
    std::vector<CardFile> f;
    f.push_back({ "track_20260901_080000_i10.csv", 2 * MB });
    f.push_back({ "track_20260901_080000_imu.csv", 900 * MB });
    UploadIndex ix; ix.addLine("track_20260901_080000.csv\t201"); ix.addLine("track_20260901_080000_i10.csv\t201");
    TEST_ASSERT_EQUAL(2, cardSpacePlan(f, ix, CARD, "").size());
}

// Very old firmware wrote "name" with no code, and only after a 200.
static void a_line_without_a_code_counts_as_uploaded(void)
{
    std::vector<CardFile> f; f.push_back({ "track_20260901_080000.csv", 900 * MB });
    UploadIndex ix; ix.addLine("track_20260901_080000.csv");
    TEST_ASSERT_EQUAL(1, cardSpacePlan(f, ix, CARD, "").size());
}

// The manual delete used to remove only the track, stranding its motion files.
// It now takes the confirmed 10 Hz file too -- but still never the full-rate one.
static void delete_uploaded_takes_the_motion_file_but_keeps_the_full_rate_copy(void)
{
    std::vector<CardFile> f; paddle(f, "track_20260901_080000", 100);
    UploadIndex ix; ix.addLine("track_20260901_080000.csv\t201"); ix.addLine("track_20260901_080000_i10.csv\t201");
    auto plan = cardManualPlan(f, ix, "");
    TEST_ASSERT_TRUE(has(plan, "track_20260901_080000.csv"));
    TEST_ASSERT_TRUE(has(plan, "track_20260901_080000_i10.csv"));
    TEST_ASSERT_FALSE(has(plan, "track_20260901_080000_imu.csv"));
}

static void delete_uploaded_leaves_a_motion_file_still_to_send(void)
{
    std::vector<CardFile> f; paddle(f, "track_20260901_080000", 100);
    UploadIndex ix; ix.addLine("track_20260901_080000.csv\t201");
    auto plan = cardManualPlan(f, ix, "");
    TEST_ASSERT_TRUE(has(plan, "track_20260901_080000.csv"));
    TEST_ASSERT_FALSE(has(plan, "track_20260901_080000_i10.csv"));
}

// #417: the index shrinks with the card. A line stays while any file of its
// paddle is still there -- the motion file needs its track's line to upload.
static void index_lines_go_with_their_paddle(void)
{
    std::vector<CardFile> f;
    f.push_back({ "track_20260902_080000_i10.csv", 2 * MB });
    TEST_ASSERT_TRUE(cardIndexLineKeep("track_20260902_080000.csv", f));      // its motion file is still here
    TEST_ASSERT_TRUE(cardIndexLineKeep("track_20260902_080000_i10.csv", f));
    TEST_ASSERT_FALSE(cardIndexLineKeep("track_20260901_080000.csv", f));     // that paddle is gone
    TEST_ASSERT_FALSE(cardIndexLineKeep("probe.bin", f));
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(names_belong_to_their_paddle);
    RUN_TEST(a_card_with_room_deletes_nothing);
    RUN_TEST(a_full_card_frees_the_oldest_uploaded_paddles_first);
    RUN_TEST(a_paddle_not_fully_uploaded_is_never_freed);
    RUN_TEST(a_refused_track_is_kept);
    RUN_TEST(a_refused_motion_file_does_not_block_freeing);
    RUN_TEST(the_paddle_being_recorded_is_never_touched);
    RUN_TEST(leftovers_of_a_deleted_track_are_freed);
    RUN_TEST(a_line_without_a_code_counts_as_uploaded);
    RUN_TEST(delete_uploaded_takes_the_motion_file_but_keeps_the_full_rate_copy);
    RUN_TEST(delete_uploaded_leaves_a_motion_file_still_to_send);
    RUN_TEST(index_lines_go_with_their_paddle);
    return UNITY_END();
}
