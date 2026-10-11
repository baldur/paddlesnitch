#pragma once
#include <stdint.h>

// A watchdog on loop() -- core 1, which runs GPS, recording, the screen and the
// button. Core 0's uplink task already had one (the idle-task watchdog); core 1
// had none, so if loop() ever got stuck mid-paddle the screen froze, recording
// silently stopped, and nothing noticed until the battery died.
//
// It is the chip's task watchdog, so a stuck loop() PANICS rather than just
// restarting: the core dump names the task and the code it was stuck in, and the
// next start reports it like any other crash (health.cpp -> /api/devices/health
// -> DeviceCrash alarm). Recording starts again by itself after the restart if
// the tracker is on Track with a fix; the paddle is split into two files.
static const uint32_t LOOP_WATCH_TIMEOUT_S = 15;

// End of setup(): set the task watchdog to LOOP_WATCH_TIMEOUT_S (it is shared
// with core 0's idle check, which goes from 5 s to 15 s) and watch loop(). The
// Arduino core feeds it once per loop() pass.
void loopWatchStart();

// Stop watching loop() while a known-long wait that a PERSON is driving runs:
// the WiFi setup page, waiting for a claim code, a serial diagnostic. Nests;
// a no-op off the loop task or before loopWatchStart().
class LoopWatchPause {
public:
    LoopWatchPause();
    ~LoopWatchPause();
    LoopWatchPause(const LoopWatchPause &) = delete;
    LoopWatchPause &operator=(const LoopWatchPause &) = delete;
private:
    bool active_;
};
