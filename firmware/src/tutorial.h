#pragma once
#include <stdint.h>

// The first-run gesture tutorial, as a pure state machine so it can be tested
// on the host. No Arduino, no drawing.
//
// Why this is worth testing rather than eyeballing: the failure mode is a device
// STUCK IN THE TUTORIAL with no way out. Every gesture is consumed teaching a
// gesture, so there is no spare one to escape with — a missing transition is not
// a cosmetic bug, it is an unusable device that needs a factory reset to fix.
//
// It exists to pay off a real cost. Five screens carry a permanent gesture hint
// on a 128x64 panel, and those hints have ALREADY gone stale once: they said
// "3 s" for a hold long after HOLD_MS stopped being 3000. Teach the contract
// once, then stop repeating it on every screen forever.

enum class TutStep : uint8_t {
    Tap = 0,    // tap moves the highlight; wraps
    Hold,       // hold selects the highlighted thing
    Back,       // double-tap goes back one level
    Ready,      // "ready?" -- hold to begin, using what was just taught
    Done,       // hand over to the normal UI
};

enum class TutEvent : uint8_t { Tap, Hold, DoubleTap };

// Taps required before the tap lesson is considered learned. Three is enough to
// see the highlight move AND to see it wrap, which is the part that is not
// obvious from one press.
static const uint8_t TUT_TAPS_TO_PASS = 3;

// How many choices the practice row shows. Four fits the panel at a readable
// size and makes the wrap visible without being tedious.
static const uint8_t TUT_CHOICES = 4;

struct TutState {
    TutStep step     = TutStep::Tap;
    uint8_t taps     = 0;   // taps done in the Tap lesson
    uint8_t sel      = 0;   // highlighted choice, wraps at TUT_CHOICES
    bool    wrapped  = false; // has the highlight wrapped at least once?
    bool    wentBack = false; // did the Back lesson actually fire?
};

/**
 * Apply one gesture. Returns the new state.
 *
 * Deliberately total: EVERY (step, event) pair has a defined result, and no
 * event is ever silently dropped. A dropped event on a one-button device reads
 * as a broken button.
 */
TutState tutorialAdvance(TutState s, TutEvent e);

/** The line of instruction for the current step. */
const char *tutorialPrompt(const TutStep step);

/** A short label under the prompt — what to actually do. */
const char *tutorialAction(const TutStep step);

/** Is the tutorial finished and ready to hand over? */
bool tutorialComplete(const TutState &s);
