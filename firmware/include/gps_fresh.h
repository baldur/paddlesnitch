#pragma once
#include <stdint.h>

// Is a GPS reading current? TinyGPS++ keeps the last position and speed
// marked valid after the receiver loses the sky; only their age grows. Until
// 0.18.1 the tracker wrote that last reading every second as a fix: on
// 2026-10-11 the GPS dropped out 30 s into a paddle and the recording carried
// one position and 15.7 km/h, labelled fix=1, for 1 h 49 min, with the screen
// showing the frozen speed. A reading older than this is no fix.
static const uint32_t GPS_STALE_MS = 3000;

static inline bool gpsFresh(bool valid, uint32_t ageMs)
{
    return valid && ageMs < GPS_STALE_MS;
}

// Is a GPS date real? TinyGPS++ marks the date valid after an RMC whose date
// field is EMPTY -- sent while the receiver has a time but no date yet -- and
// the zeroed parser then reads 2000-00-00. A fix arriving first named a
// recording track_20000000_190737 and stamped its rows 2000-00-00T...
static inline bool gpsDateOk(bool valid, uint16_t year, uint8_t month, uint8_t day)
{
    return valid && year >= 2025 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
