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
// Readable only over a paired, encrypted connection. Reading it is how the page
// asks for pairing: the browser/phone starts it when the read is refused.
#define PS_BLE_PAIRED_UUID  "04dd0a03-9cd1-403e-a461-0b4af515a1b4"
#define PS_BLE_PAIRED_JSON  "{\"v\":1,\"paired\":true}"

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

// ---- Setup over Bluetooth (both readable/writable only when paired) --------
//
// LINK: write {"op":"begin"} -> the tracker makes a fresh token and keeps it
// pending; read -> its id and the token's sha256 (never the token); the page
// registers the hash with the server, then writes {"op":"commit","tokenHash":h}
// and the tracker keeps that token as its own. The token never leaves it.
#define PS_BLE_LINK_UUID    "04dd0a04-9cd1-403e-a461-0b4af515a1b4"
// WIFI: write {"ssid":..,"pass":..} -> the tracker tries the network and saves
// it only if it joins; read -> {"v":1,"state":"..."}.
#define PS_BLE_WIFI_UUID    "04dd0a05-9cd1-403e-a461-0b4af515a1b4"

// state: "idle" (nothing pending), "pending" (begin done, hash below is the
// one to register), "committed" (the tracker now uses that token).
static inline int bleLinkJson(char *out, size_t n, const char *id, const char *state, const char *tokenHash)
{
    return snprintf(out, n, "{\"v\":1,\"id\":\"%s\",\"state\":\"%s\",\"tokenHash\":\"%s\"}",
                    id, state, tokenHash ? tokenHash : "");
}

// state: idle, trying, joined, wrong_password, not_found, failed.
static inline int bleWifiJson(char *out, size_t n, const char *state)
{
    return snprintf(out, n, "{\"v\":1,\"state\":\"%s\"}", state);
}

// ---- Recordings over Bluetooth (paired only) --------------------------------
//
// SYNC: write a command, read the status. The work (card, compression, receipt
// check) runs on the uplink task, so read SYNC until state leaves "working".
//   {"op":"list"}                          -> DATA holds the waiting recordings
//   {"op":"piece","name":n,"part":p}       -> DATA holds 64 KB piece p of n
//   {"op":"done","name":n,"receipt":hex}   -> marked sent if the receipt checks
// DATA: read pages of what SYNC prepared, each [u32 offset, little-endian]
// then up to PS_BLE_PAGE_DATA bytes; write {"op":"seek","offset":k} to resume.
#define PS_BLE_SYNC_UUID    "04dd0a06-9cd1-403e-a461-0b4af515a1b4"
#define PS_BLE_DATA_UUID    "04dd0a07-9cd1-403e-a461-0b4af515a1b4"
#define PS_BLE_PAGE_DATA    500   // + 4-byte offset = 504, under the 512 a read allows

static inline void blePageHeader(uint8_t *out, uint32_t offset)
{
    out[0] = offset & 0xff; out[1] = (offset >> 8) & 0xff;
    out[2] = (offset >> 16) & 0xff; out[3] = (offset >> 24) & 0xff;
}

// What the receipt (server: uploadReceipt) is computed over. The server keys
// it with the hex sha256 of the tracker's token; `uploadName` is the name the
// server knows the file by (a motion file uploads as ..._imu.csv).
static inline int bleReceiptMessage(char *out, size_t n, const char *deviceId, const char *uploadName)
{
    return snprintf(out, n, "ps-receipt:v1|%s|%s", deviceId, uploadName);
}

// SYNC status. len/parts describe what DATA holds; compressed says whether a
// piece is zlib (upload it with &enc=zlib) or plain.
static inline int bleSyncJson(char *out, size_t n, const char *state, unsigned long len,
                              int part, int parts, bool compressed)
{
    return snprintf(out, n,
        "{\"v\":1,\"state\":\"%s\",\"len\":%lu,\"part\":%d,\"parts\":%d,\"compressed\":%s}",
        state, len, part, parts, compressed ? "true" : "false");
}

