#pragma once
#include <Arduino.h>

// Everything drawn on the OLED lives here, so the tracker logic never touches
// pixels and the screens can be reasoned about as a set.

// What to draw this frame. Onboarding (Setup/Linking) is forced until the device
// is usable; then every boot lands on the Pick chooser (tap = move highlight,
// hold = select), which enters Track/Sync/Nerd; a double-tap in a screen returns
// to Pick. DeleteConfirm is a transient overlay on Sync. The splash at boot is
// uiSplash(), not a state. See docs/device-states-spec.md.
// Two MENUS (Pick, Settings) and the screens they open. Nerd and Network moved
// under Settings so the top level stays the three things you use on the water.
enum class AppState { Setup, Linking, Pick, Settings, Track, Sync, Nerd, Network, DeleteConfirm };

// Network details for the Settings > Network screen.
struct UiNet {
    String ssid;
    String ip;
    int    rssi = 0;
    bool   up   = false;   // associated RIGHT NOW -- true only during a sync
    bool   everConnected = false;   // has this SSID ever worked?
};

struct UiState {
    AppState state = AppState::Track;
    // link / onboarding
    bool     linked      = false;
    UiNet    net;
    // Linking screen: 0 = the QR alone on the whole panel, 1 = the characters.
    int      linkPage    = 0;
    String   linkTitle;
    String   linkHint;
    String   deviceId;

    // recording
    bool     sdReady     = false;
    bool     recording   = false;
    uint32_t rows        = 0;

    // gnss
    bool     fix         = false;
    int      sats        = 0;
    uint32_t searchSecs  = 0;

    // session
    double   speedKmh    = 0;
    double   distanceM   = 0;
    uint32_t sessionSecs = 0;

    // power
    int      batteryPct  = -1;   // -1 = no battery fitted
    bool     charging    = false;

    // transient user feedback, e.g. "NEED GPS" after a refused tap
    String   toast;
    uint32_t toastUntilMs = 0;

    // sync screen tallies
    bool     countsValid = false;
    int      onDevice    = 0;
    int      uploaded    = 0;
    int      pending     = 0;
    bool     syncing     = false;   // a sync is in flight (uplink busy)
    // Which chunk of which file is in flight. upParts == 0 means "syncing, but
    // not inside a chunked file" (scanning, claiming, counting).
    String   upFile;
    int      upPart      = 0;
    int      upParts     = 0;

    // Highlighted row of whichever menu is showing. One field for both: the
    // menus are never on screen at once, and giving each its own would invite
    // them drifting out of sync with the enum they index.
    int      menuSel     = 0;
    // track screen: a hold has armed "stop recording", awaiting a double-tap
    // Track rows lost to a busy bus. Nonzero means the paddle has holes in it.
    uint32_t droppedRows = 0;
    bool     stopArmed   = false;
    // track speed readout unit, toggled by tap: 0 km/h, 1 m/s, 2 pace per 500 m
    int      speedUnit   = 0;
    // stroke rate (SPM) shown right of the speed; <0 = not available yet
    // (on-device derivation from the IMU is deferred — see motion-capture-spec)
    float    strokeRateSpm = -1;

    // nerd mode / diagnostics
    String   ssid;
    String   ip;
    double   hdop      = 0;
    uint32_t txOk      = 0;
    uint32_t txFail    = 0;
    String   fileName;
    float    battVolts = 0;
    uint32_t freeHeap  = 0;
    bool     wifiUp    = false;
    String   claimCode;

    // nerd mode paging. Double-tap advances; after the last page it returns to the
    // chooser, so the gesture stays "move on" everywhere rather than meaning
    // something different here.
    int      nerdPage  = 0;
    int      nerdPages = 3;
    // sync screen: 0 status, 1 cleanup (where the delete lives)
    int      syncPage  = 0;
    int      syncPages = 2;

    // page 2: power + system. Things you cannot get at without a laptop, which is
    // the whole point of the screen existing.
    bool     onUsb        = false;
    uint32_t uptimeS      = 0;
    uint32_t heapMin      = 0;   // low-water mark, not the current free
    uint32_t psramFree    = 0;
    String   fwVersion;
    String   resetReason;        // why it last rebooted -- the boot-loop question

    // page 3: radio + storage
    int      rssi         = 0;   // 0 when not associated
    String   serverHost;
    uint64_t sdSizeMB     = 0;
    bool     imuOk        = false;
    float    imuTempC     = 0;
    uint32_t imuSamples   = 0;   // samples in the last 1 s window
};

void uiSplash();                 // holds the wordmark briefly; blocks ~200 ms
// Blink a menu row on selection; blocks ~280 ms. `settings` picks which menu's
// labels to draw, so the flash matches the menu the user is actually looking at.
void uiPickFlash(int sel, bool settings = false);
void uiDraw(const UiState &s);
