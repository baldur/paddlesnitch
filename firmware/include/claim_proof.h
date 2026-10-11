#pragma once
#include <stddef.h>
#include <stdio.h>

// What a tracker signs to prove it is itself when it is added to an account.
// Byte-identical to claimProofMessage / linkProofMessage in
// packages/core/src/devices.ts (a vitest contract test reads this file).
//
//   by code:       the server's claim secret -- fresh per claim, so a
//                  signature cannot be replayed onto a later claim
//   by Bluetooth:  the hash of the token the tracker just made -- also fresh
//
// Returns the length, or 0 if `out` is too small (never truncated).
static inline size_t claimProofMessage(const char *deviceId, const char *claimSecret, char *out, size_t n)
{
    int k = snprintf(out, n, "paddlesnitch-claim\n%s\n%s\n", deviceId, claimSecret);
    return (k > 0 && (size_t)k < n) ? (size_t)k : 0;
}

static inline size_t linkProofMessage(const char *deviceId, const char *tokenHash, char *out, size_t n)
{
    int k = snprintf(out, n, "paddlesnitch-link\n%s\n%s\n", deviceId, tokenHash);
    return (k > 0 && (size_t)k < n) ? (size_t)k : 0;
}
