#pragma once
#include <stdint.h>
#include <stdio.h>

// A tracker's device ID, as 8 uppercase hex characters (the server's format).
//
// ESP.getEfuseMac() holds the 6 MAC bytes little-endian: MAC[0] is the lowest
// byte. MAC[0..2] are Espressif's OUI (48:ca:43 on every board so far), so they
// carry no identity at all.
//
// LEGACY (firmware <= 0.15.0): the low 32 bits, i.e. MAC[3] MAC[2] MAC[1] MAC[0]
// -- three OUI bytes and ONE board byte. Only 256 values, and it collided within
// five boards: paddle03 (48:ca:43:5a:ba:b0) got the same 5A43CA48 as the first
// tracker. Kept only for trackers already on an account under it.
//
// UNIQUE (from 0.16.0): MAC[2..5] in MAC order -- one OUI byte, then the three
// bytes the manufacturer assigns per board. paddle03 -> 435ABAB0.
static inline void deviceIdLegacy(uint64_t efuse, char out[9])
{
    snprintf(out, 9, "%08X", (unsigned)(efuse & 0xFFFFFFFFu));
}

static inline void deviceIdUnique(uint64_t efuse, char out[9])
{
    uint8_t m[6];
    for (int i = 0; i < 6; i++) m[i] = (uint8_t)(efuse >> (8 * i));
    snprintf(out, 9, "%02X%02X%02X%02X", m[2], m[3], m[4], m[5]);
}

// Which scheme a tracker uses the FIRST time it decides (the answer is then
// stored and never recomputed): one already on an account keeps the ID the
// server knows it by; a new one gets the unique ID.
static inline bool deviceIdUseLegacy(bool alreadyClaimed) { return alreadyClaimed; }

// The setup hotspot's name: "PT-" + the ID's last THREE characters ("PT-9C8").
// Not four. The join QR payload is WIFI:S:<name>;T:WPA;P:<8 chars>;; and with a
// 6-character name that is 32 bytes, the whole budget for a QR small enough for
// the panel. 0.16.0 used four and every new tracker lost its join QR (33 bytes,
// text only). Three hex characters is 4096 names: plenty for two trackers in
// setup mode in one room.
static inline void apSsidFor(const char id[9], char out[7])
{
    snprintf(out, 7, "PT-%s", id + 5);
}
