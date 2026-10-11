#pragma once
#include <stdint.h>

// Gate for the uploaded ~12 Hz motion file: one row per `intervalMs` of the
// sample clock (millis()). Unsigned and wrap-safe. It used to compare 32-bit
// `long`s parsed with atol, which saturates past 2^31 ms -- after 24.8 days
// of uptime every row looked 0 ms after the last and the file got one row.
struct UpGate {
    bool     started = false;
    uint32_t last    = 0;
};

static inline bool upRowDue(UpGate &g, uint32_t ms, uint32_t intervalMs)
{
    if (g.started && (uint32_t)(ms - g.last) < intervalMs) return false;
    g.started = true;
    g.last    = ms;
    return true;
}
