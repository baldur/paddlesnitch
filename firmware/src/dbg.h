#pragma once
#include <Arduino.h>

// A flight recorder: an always-on, in-memory ring of timestamped events, so a
// fault can be reconstructed AFTER it happened instead of only while a laptop
// happens to be watching.
//
// Every hard bug on this device so far has been diagnosed by adding a print,
// reflashing, and hoping the fault came back -- and reflashing is a warm reset,
// which wedges the IMU and changes the very timing being investigated. The
// recorder exists so the next one is answered by reading back what already
// happened.
//
// It must not change how the device behaves, so:
//  - it lives in PSRAM (there are 8 MB; 32 KB costs nothing) and NEVER writes to
//    the SD card on its own. Writing to the card is the fragile thing being
//    debugged, and a logger that provokes the fault is worse than no logger;
//  - entries are fixed-size and the ring overwrites, so it cannot grow, cannot
//    fragment the heap, and cannot stall on a full disk;
//  - the critical section is a memcpy under a mutex, held for microseconds;
//  - formatting happens on the caller's stack into a small buffer, so a slow
//    caller never blocks a fast one inside the lock.
//
// Keep OUT of per-sample hot paths (a 50 Hz IMU poll would fill the ring in
// seconds and drown the events that matter). Log state CHANGES and failures;
// use counters for anything that repeats.

enum DbgLevel : uint8_t { DBG_INFO = 0, DBG_WARN = 1, DBG_ERR = 2 };

void dbgInit();

// Records one line. `tag` is a short subsystem name ("sd", "imu", "sync",
// "wifi") so a dump can be read by area.
void dbgLog(DbgLevel level, const char *tag, const char *fmt, ...)
    __attribute__((format(printf, 3, 4)));

#define DBGI(tag, ...) dbgLog(DBG_INFO, tag, __VA_ARGS__)
#define DBGW(tag, ...) dbgLog(DBG_WARN, tag, __VA_ARGS__)
#define DBGE(tag, ...) dbgLog(DBG_ERR,  tag, __VA_ARGS__)

// Oldest first, framed by <<<DBG>>> / <<<END>>> so the same tooling that already
// scrapes LS and CAT can pick it out of the stream.
void dbgDump(Print &out);
void dbgClear();

// What the ring currently holds: entries kept, entries dropped by overwrite,
// and bytes used. Cheap, for the STATUS line.
void dbgStats(uint32_t &kept, uint32_t &overwritten, uint32_t &bytesUsed);
