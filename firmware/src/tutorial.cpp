#include "tutorial.h"

TutState tutorialAdvance(TutState s, TutEvent e)
{
    switch (s.step) {

    case TutStep::Tap:
        // Only a tap teaches anything here. A hold or a double-tap is a person
        // guessing, and the honest answer is to let the lesson stand rather than
        // reward the wrong gesture -- but never to ignore it silently either:
        // the caller flashes the prompt, so the button always visibly does
        // SOMETHING.
        if (e == TutEvent::Tap) {
            uint8_t next = (uint8_t)((s.sel + 1) % TUT_CHOICES);
            if (next < s.sel) s.wrapped = true;   // came round the end
            s.sel = next;
            if (s.taps < 255) s.taps++;
            // Pass on taps alone. Requiring the wrap as well would mean a person
            // who taps exactly TUT_CHOICES-1 times sits there wondering why
            // nothing happens, and the wrap is shown by then anyway.
            if (s.taps >= TUT_TAPS_TO_PASS) s.step = TutStep::Hold;
        }
        return s;

    case TutStep::Hold:
        // A tap still moves the highlight -- the previous lesson does not stop
        // being true the moment the next one starts, and a tutorial that
        // deadens a gesture it just taught teaches the wrong thing.
        if (e == TutEvent::Tap) {
            uint8_t next = (uint8_t)((s.sel + 1) % TUT_CHOICES);
            if (next < s.sel) s.wrapped = true;
            s.sel = next;
        } else if (e == TutEvent::Hold) {
            s.step = TutStep::Back;
        }
        return s;

    case TutStep::Back:
        if (e == TutEvent::DoubleTap) {
            s.wentBack = true;
            s.step = TutStep::Ready;
        } else if (e == TutEvent::Tap) {
            uint8_t next = (uint8_t)((s.sel + 1) % TUT_CHOICES);
            if (next < s.sel) s.wrapped = true;
            s.sel = next;
        }
        // A hold here does nothing on purpose: the lesson is specifically that
        // double-tap is the way back, and letting a hold skip past it would
        // leave the one gesture people forget untaught.
        return s;

    case TutStep::Ready:
        // Hold to begin -- which is the gesture just learned, used for real.
        if (e == TutEvent::Hold) {
            s.step = TutStep::Done;
        } else if (e == TutEvent::DoubleTap) {
            // Back, consistent with everywhere else: return to the last lesson
            // rather than trapping someone on the final screen. This is the
            // transition whose absence would make the tutorial a dead end.
            s.step = TutStep::Back;
        }
        return s;

    case TutStep::Done:
    default:
        return s;
    }
}

const char *tutorialPrompt(const TutStep step)
{
    switch (step) {
    case TutStep::Tap:   return "TAP to move";
    case TutStep::Hold:  return "HOLD to select";
    case TutStep::Back:  return "DOUBLE-TAP goes back";
    case TutStep::Ready: return "Ready?";
    case TutStep::Done:  return "";
    }
    return "";
}

const char *tutorialAction(const TutStep step)
{
    switch (step) {
    case TutStep::Tap:   return "tap a few times";
    case TutStep::Hold:  return "hold until it fills";
    case TutStep::Back:  return "two quick taps";
    case TutStep::Ready: return "hold to start";
    case TutStep::Done:  return "";
    }
    return "";
}

bool tutorialComplete(const TutState &s)
{
    return s.step == TutStep::Done;
}
