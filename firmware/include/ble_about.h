#pragma once
#include <stdio.h>
#include <stddef.h>

// The tracker's Bluetooth service: the contract with paddlesnitch.com
// (apps/web/src/lib/tracker-ble.ts uses the same ids; a test there checks they
// match this file). See docs/features/tracker-bluetooth-sync.md.
//
// One service. Its first item, About, is readable by anyone in range for now:
// it carries nothing that isn't already public (the id is printed in the
// setup hotspot's name). Recordings will need a paired connection.
#define PS_BLE_SERVICE_UUID "04dd0a01-9cd1-403e-a461-0b4af515a1b4"
#define PS_BLE_ABOUT_UUID   "04dd0a02-9cd1-403e-a461-0b4af515a1b4"

// About, as a small JSON object. `waiting` is the number of recordings not yet
// uploaded, or -1 while the tracker hasn't counted them yet (sent as null).
// `v` is the payload version, so the page can refuse a shape it doesn't know.
// Returns what snprintf returns: the length it needed.
static inline int bleAboutJson(char *out, size_t n, const char *id, const char *fw,
                               const char *model, int waiting, bool linked)
{
    char w[12];
    if (waiting < 0) snprintf(w, sizeof(w), "null");
    else snprintf(w, sizeof(w), "%d", waiting);
    return snprintf(out, n,
        "{\"v\":1,\"id\":\"%s\",\"fw\":\"%s\",\"model\":\"%s\",\"waiting\":%s,\"linked\":%s}",
        id, fw, model, w, linked ? "true" : "false");
}
