#pragma once
#include <Arduino.h>

// Everything drawn on the OLED lives here, so the tracker logic never touches
// pixels and the screens can be reasoned about as a set.

// Exactly one state is active. Nerd overlays whatever was active and returns to
// it. See docs/device-states-spec.md.
enum class AppState { Intro, Setup, Linking, Waiting, Ready, Recording, Nerd };

struct UiState {
    AppState state = AppState::Waiting;
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
