#pragma once
#include <stdint.h>

// May this hold accept a Bluetooth pairing? Only if the press began once the
// number was on screen. A pairing request arrives unsolicited from anyone in
// range, and a hold already under way -- for whatever the screen showed a
// moment before -- used to say yes to it. Wrap-safe millis() comparison.
static inline bool pairHoldAccepts(uint32_t pressedAtMs, uint32_t promptAtMs)
{
    return (int32_t)(pressedAtMs - promptAtMs) >= 0;
}
