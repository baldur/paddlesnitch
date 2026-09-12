#pragma once
#include <Arduino.h>

// Talks to paddlesnitch.com. Two jobs, in order:
//
//   1. Claim  -- bind this device to a user account, once, and receive a bearer
//                token. The user never types a secret into the device; the
//                device shows a short code and the user enters it on the site.
//   2. Sync   -- upload finished session CSVs from the SD card.
//
// Contract: ../../docs/features/device-uplink.md (written against paddlesnitch's own
// conventions). Nothing here assumes the endpoints exist yet -- every call
// reports its HTTP status so a missing endpoint is obvious rather than silent.

enum class ClaimState { Idle, AwaitingUser, Claimed, Failed };

struct ClaimStatus {
    ClaimState state = ClaimState::Idle;
    String     code;        // shown on the OLED for the user to type
    String     message;
};

// Starts (or resumes) the claim. Shows a code and polls until the user binds it
// on the website, or until timeoutMs elapses. Blocking by design: there is
// nothing useful to do until the device has an identity.
ClaimStatus uplinkClaim(uint32_t timeoutMs = 300000);

// Uploads every finished session not already recorded in /uploaded.txt.
// Returns the number newly accepted by the server.
int uplinkSyncSessions();

// --- background operation -------------------------------------------------
//
// Runs on core 0 so a multi-second HTTP call never freezes the UI, GNSS or
// logging loop on core 1. The task draws nothing; it publishes into
// UplinkStatus, which Nerd mode reads.

struct UplinkStatus {
    bool     wifiUp        = false;
    bool     busy          = false;   // mid-sync/scan, holding the SD card
    bool     claiming      = false;
    char     claimCode[8]  = "";
    int      uploadedOk    = 0;
    int      deleted       = 0;
    char     message[64]   = "";

    // Session tallies for the Sync screen. Recomputed after each sync, on
    // request (uplinkRequestCounts), and after a delete. countsValid is false
    // until the first scan completes.
    bool     countsValid   = false;
    int      onDevice      = 0;   // track_*.csv files on the card
    int      uploaded      = 0;   // of those, confirmed by the server (200/201/409)
    int      pending       = 0;   // onDevice - uploaded
};

void uplinkTaskStart();               // call once, after storage + net are up
UplinkStatus uplinkGetStatus();       // thread-safe snapshot

// Asks the task to stop touching the SD card and waits up to timeoutMs for it
// to actually stop. Called before opening a recording: both cores must never
// have the card at once.
bool uplinkYieldCard(uint32_t timeoutMs = 3000);
void uplinkResume();

// Kicks off a sync now (e.g. after linking). Non-blocking.
void uplinkRequestSync();

// Asks the task to recompute the Sync-screen tallies (onDevice/uploaded/pending)
// next time it is idle. Non-blocking; read the result from uplinkGetStatus().
void uplinkRequestCounts();

// Asks the task to delete every session the server has confirmed (200/201/409),
// then recompute counts. Never deletes 422 or un-uploaded files. Non-blocking;
// runs on core 0 when the card is free, so it never races recording or a sync.
void uplinkRequestDeleteUploaded();

// True while the core-0 task is actively using the SD card (scan / sync / delete).
// The IMU shares the SPI bus, so core 1 must NOT poll it then or the concurrent
// access corrupts both (SD "Select Failed", garbled IMU). The loop skips imuPoll()
// while this is set; it is only ever set when not recording, so no samples that
// would be logged are lost. See docs/motion-capture-spec.md.
bool uplinkSdBusy();
