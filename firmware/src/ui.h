#pragma once
#include <Arduino.h>

// Everything drawn on the OLED lives here, so the tracker logic never touches
// pixels and the screens can be reasoned about as a set.

// What to draw this frame. Onboarding (Setup/Linking) is forced until the device
// is usable; then every boot lands on the Pick chooser (tap = move highlight,
// hold = select), which enters Track/Sync/Nerd; a double-tap in a screen returns
// to Pick. DeleteConfirm is a transient overlay on Sync. The splash at boot is
// uiSplash(), not a state. See docs/device-states-spec.md.
enum class AppState { Setup, Linking, Pick, Track, Sync, Nerd, DeleteConfirm };

struct UiState {
    AppState state = AppState::Track;
    // link / onboarding
    bool     linked      = false;
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

    // pick screen: which option is highlighted (0 Track, 1 Sync, 2 Nerd)
    int      pickSel     = 0;

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
};

void uiSplash();                 // boot animation; blocks for ~1.5 s
void uiDraw(const UiState &s);
