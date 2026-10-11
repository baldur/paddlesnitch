#pragma once
#include <stddef.h>
#include <stdio.h>
#include <ctype.h>

// The exact bytes a firmware release is signed over. Pure, so the format the
// release job signs and the format the tracker checks can be pinned by a host
// test -- if they ever drift apart, every update is refused.
//
// The signature covers the VERSION as well as the image hash, so the manifest
// cannot relabel a genuine build as some other version. The hash is lowercased
// because sha256sum prints lowercase and the manifest may not.
//
// Returns the message length, or 0 when the inputs are malformed or `out` is
// too small (never a truncated message, which could not verify anyway).
static inline size_t otaSignedMessage(const char *version, const char *sha256hex, char *out, size_t outSize)
{
    if (!version || !*version || !sha256hex) return 0;
    for (const char *p = version; *p; p++) if (*p == '\n' || *p == '\r') return 0;
    char sha[65];
    for (int i = 0; i < 64; i++) {
        char c = sha256hex[i];
        if (!c || !isxdigit((unsigned char)c)) return 0;
        sha[i] = (char)tolower((unsigned char)c);
    }
    if (sha256hex[64] != '\0') return 0;
    sha[64] = '\0';
    int n = snprintf(out, outSize, "paddlesnitch-firmware\n%s\n%s\n", version, sha);
    if (n <= 0 || (size_t)n >= outSize) return 0;
    return (size_t)n;
}
