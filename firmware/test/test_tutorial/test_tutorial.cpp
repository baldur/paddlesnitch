#include <unity.h>
#include "tutorial.h"

static TutState tap(TutState s, int n = 1)   { while (n--) s = tutorialAdvance(s, TutEvent::Tap);       return s; }
static TutState hold(TutState s)             { return tutorialAdvance(s, TutEvent::Hold); }
static TutState dbl(TutState s)              { return tutorialAdvance(s, TutEvent::DoubleTap); }

static void the_whole_sequence_can_be_completed(void)
{
    TutState s;
    s = tap(s, TUT_TAPS_TO_PASS);
    TEST_ASSERT_EQUAL(TutStep::Hold, s.step);
    s = hold(s);
    TEST_ASSERT_EQUAL(TutStep::Back, s.step);
    s = dbl(s);
    TEST_ASSERT_EQUAL(TutStep::Ready, s.step);
    s = hold(s);
    TEST_ASSERT_EQUAL(TutStep::Done, s.step);
    TEST_ASSERT_TRUE(tutorialComplete(s));
}

// THE FAILURE THAT MATTERS. Every gesture is spent teaching a gesture, so there
// is no spare one to escape with: a missing transition is not a cosmetic bug,
// it is a device stuck in its own tutorial needing a factory reset.
//
// Brute-force every reachable state against every event and assert that nothing
// can reach a state from which Done is unreachable.
static void no_sequence_of_gestures_can_trap_the_user(void)
{
    const TutEvent events[] = { TutEvent::Tap, TutEvent::Hold, TutEvent::DoubleTap };

    // Walk a few thousand pseudo-random gesture sequences; every one must still
    // be able to finish by playing the known-good path afterwards.
    uint32_t seed = 1;
    for (int trial = 0; trial < 2000; trial++) {
        TutState s;
        for (int i = 0; i < 12; i++) {
            seed = seed * 1103515245u + 12345u;
            s = tutorialAdvance(s, events[(seed >> 16) % 3]);
            if (s.step == TutStep::Done) break;
        }
        if (s.step == TutStep::Done) continue;

        // From wherever it landed, the canonical path must still reach Done.
        for (int i = 0; i < 40 && s.step != TutStep::Done; i++) {
            s = tap(s);
            s = hold(s);
            s = dbl(s);
            s = hold(s);
        }
        TEST_ASSERT_EQUAL_MESSAGE(TutStep::Done, s.step, "a gesture sequence trapped the tutorial");
    }
}

static void tapping_wraps_around_the_choices(void)
{
    TutState s;
    s = tap(s, TUT_CHOICES);          // all the way round
    TEST_ASSERT_TRUE(s.wrapped);
    TEST_ASSERT_EQUAL(0, s.sel);      // back to the start
}

static void the_tap_lesson_passes_on_taps_alone(void)
{
    // Not gated on having wrapped: a person who taps exactly TUT_CHOICES-1 times
    // would otherwise sit there wondering why nothing happened.
    TutState s;
    s = tap(s, TUT_TAPS_TO_PASS);
    TEST_ASSERT_EQUAL(TutStep::Hold, s.step);
}

static void a_wrong_gesture_never_skips_a_lesson(void)
{
    // Holding during the tap lesson must not jump ahead -- the lesson is the tap.
    TutState s;
    s = hold(s);
    TEST_ASSERT_EQUAL(TutStep::Tap, s.step);
    s = dbl(s);
    TEST_ASSERT_EQUAL(TutStep::Tap, s.step);

    // ...and a hold must not skip the double-tap lesson, which is the gesture
    // people forget.
    s = tap(s, TUT_TAPS_TO_PASS);
    s = hold(s);
    TEST_ASSERT_EQUAL(TutStep::Back, s.step);
    s = hold(s);
    TEST_ASSERT_EQUAL(TutStep::Back, s.step);
}

// The previous lesson does not stop being true when the next one begins. A
// tutorial that deadens a gesture it just taught teaches the wrong thing.
static void tapping_still_moves_the_highlight_in_later_lessons(void)
{
    TutState s;
    s = tap(s, TUT_TAPS_TO_PASS);
    TEST_ASSERT_EQUAL(TutStep::Hold, s.step);
    uint8_t before = s.sel;
    s = tap(s);
    TEST_ASSERT_NOT_EQUAL(before, s.sel);
    TEST_ASSERT_EQUAL(TutStep::Hold, s.step);   // and it did not advance
}

// "Ready?" must not be a dead end -- double-tap means back everywhere else, and
// it has to mean back here too or the last screen is a trap.
static void ready_can_go_back(void)
{
    TutState s;
    s = tap(s, TUT_TAPS_TO_PASS); s = hold(s); s = dbl(s);
    TEST_ASSERT_EQUAL(TutStep::Ready, s.step);
    s = dbl(s);
    TEST_ASSERT_EQUAL(TutStep::Back, s.step);
    // ...and forward again.
    s = dbl(s);
    TEST_ASSERT_EQUAL(TutStep::Ready, s.step);
    s = hold(s);
    TEST_ASSERT_EQUAL(TutStep::Done, s.step);
}

static void done_is_absorbing(void)
{
    TutState s; s.step = TutStep::Done;
    TEST_ASSERT_EQUAL(TutStep::Done, tap(s).step);
    TEST_ASSERT_EQUAL(TutStep::Done, hold(s).step);
    TEST_ASSERT_EQUAL(TutStep::Done, dbl(s).step);
}

static void every_step_has_words_on_the_screen(void)
{
    const TutStep all[] = { TutStep::Tap, TutStep::Hold, TutStep::Back, TutStep::Ready };
    for (unsigned i = 0; i < sizeof(all) / sizeof(all[0]); i++) {
        TEST_ASSERT_TRUE(tutorialPrompt(all[i])[0] != '\0');
        TEST_ASSERT_TRUE(tutorialAction(all[i])[0] != '\0');
    }
}

int main(int, char **)
{
    UNITY_BEGIN();
    RUN_TEST(the_whole_sequence_can_be_completed);
    RUN_TEST(no_sequence_of_gestures_can_trap_the_user);
    RUN_TEST(tapping_wraps_around_the_choices);
    RUN_TEST(the_tap_lesson_passes_on_taps_alone);
    RUN_TEST(a_wrong_gesture_never_skips_a_lesson);
    RUN_TEST(tapping_still_moves_the_highlight_in_later_lessons);
    RUN_TEST(ready_can_go_back);
    RUN_TEST(done_is_absorbing);
    RUN_TEST(every_step_has_words_on_the_screen);
    return UNITY_END();
}
