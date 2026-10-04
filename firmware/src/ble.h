#pragma once
#include <stdint.h>
// The tracker's Bluetooth service (docs/features/tracker-bluetooth-sync.md, P4).
// Compiled only with -DBLE_ENABLED=1, which only the bench build sets so far:
// there is no pairing yet, so it must not reach trackers in use.
void bleStart();

// Pairing (number comparison). When a phone or browser pairs, the Bluetooth
// task waits up to 25 s for the owner to confirm the 6-digit number on the
// tracker's screen: hold = yes, double-tap = no (the same gestures as every
// other confirmation). The main loop shows the number while this is pending.
bool bleConfirmPending(uint32_t *pin);
void bleConfirmAnswer(bool yes);
void bleForgetAll();   // drop every pairing (bench: BLEFORGET)
