#pragma once
#include <stddef.h>

// Escape text for the setup page's HTML, attribute values included.
//
// The page pastes in the names of nearby WiFi networks, the saved network name
// and messages that quote it. A network name is whatever a neighbour broadcasts:
// `"><script>...` in one would run in the owner's phone browser on the setup
// page, where it could read the WiFi password as it is typed (security audit
// 2026-09). Writes at most outSize-1 characters plus the terminator and never
// splits an entity; returns the length written.
static inline size_t htmlEscape(const char *in, char *out, size_t outSize)
{
    if (!outSize) return 0;
    size_t o = 0;
    for (const char *p = in; *p; p++) {
        const char *rep = nullptr;
        switch (*p) {
        case '&':  rep = "&amp;";  break;
        case '<':  rep = "&lt;";   break;
        case '>':  rep = "&gt;";   break;
        case '"':  rep = "&quot;"; break;
        case '\'': rep = "&#39;";  break;
        }
        if (rep) {
            size_t n = 0; while (rep[n]) n++;
            if (o + n >= outSize) break;
            for (size_t i = 0; i < n; i++) out[o++] = rep[i];
        } else {
            if (o + 1 >= outSize) break;
            out[o++] = *p;
        }
    }
    out[o] = 0;
    return o;
}
