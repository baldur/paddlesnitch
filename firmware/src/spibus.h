#pragma once
#include <Arduino.h>

// Ownership of the shared SPI bus (microSD + QMI8658 IMU on the same SCK/MISO/
// MOSI, different CS lines).
//
// WHY A MUTEX AND NOT A FLAG. There was a flag -- `uplinkSdBusy()` -- and core 1
// checked it before calling `imuPoll()`. It is not enough, for two reasons:
//
//  1. No acknowledgement. Core 0 set the flag and started reading the card
//     immediately, without waiting for a poll already in flight on core 1 to
//     finish.
//  2. Check-then-act. Core 1 could read the flag as clear and enter imuPoll()
//     just as core 0 set it.
//
// Either way both chip selects end up asserted at once. That is fatal rather
// than merely untidy, because the SD library holds ITS CS low across a whole
// multi-command sequence, not just one SPI transaction -- so the Arduino SPI
// transaction lock does not serialise them. Two devices then drive MISO
// together, the card's state machine desynchronises, and every later access
// fails: `sdWait: Wait Failed`, `sdSelectCard: Select Failed`, CRC errors, and
// short reads. One collision poisons the rest of the sync.
//
// Measured, on the same file and the same session: read from core 1 (the serial
// SDPROBE/LS/CAT handler, which cannot race imuPoll because it shares its
// thread) 818630 bytes at 429 KB/s, radio off AND associated. Read from core 0
// (the uplink task): `short read 4096/65536 at +0`. The card and WiFi were never
// the problem; the concurrency was.
//
// Rules:
//  - Any SD operation, and any IMU sampling, holds this for its whole duration.
//  - The IMU uses spiBusTryTake() and simply SKIPS a sample when the card has
//    the bus. It must never block core 1's loop, and a dropped IMU sample costs
//    nothing -- sync does not run while recording.
//  - NEVER hold it across a network call. The chunked uploader reads one chunk,
//    releases, then does HTTP -- that is what lets the IMU keep sampling through
//    a multi-minute sync instead of going silent for all of it.
//  - It is RECURSIVE, because some card operations legitimately nest (a
//    directory walk that consults the uploaded-index per entry). The one thing
//    recursion makes possible and wrong is a caller holding the bus and then
//    calling imuPoll(), whose try-take would succeed against its own task. No
//    path does that today; do not add one.
void spiBusInit();
bool spiBusTryTake();                       // non-blocking; false = someone else has it
bool spiBusTake(uint32_t timeoutMs);        // blocking with a bound
void spiBusGive();

// How often the IMU had to skip a sample because the card held the bus, and how
// often a take timed out. Both are pure diagnostics, surfaced by `DBG`.
uint32_t spiBusSkips();
uint32_t spiBusTimeouts();

// RAII for the blocking case: `SpiBusGuard g(2000); if (!g) { ...give up... }`
class SpiBusGuard {
public:
    explicit SpiBusGuard(uint32_t timeoutMs) : held(spiBusTake(timeoutMs)) {}
    ~SpiBusGuard() { if (held) spiBusGive(); }
    explicit operator bool() const { return held; }
    SpiBusGuard(const SpiBusGuard &) = delete;
    SpiBusGuard &operator=(const SpiBusGuard &) = delete;
private:
    bool held;
};
