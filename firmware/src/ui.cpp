#include "ui.h"
#include "board.h"

// A 12x9 satellite: two solar panels, a body, and a stub antenna. Drawn with
// primitives rather than an icon font so it stays legible at this size on an
// SH1106 -- scaled-down glyphs turn to mush.
static void drawSatellite(int x, int y)
{
    display.drawBox(x,     y + 2, 3, 6);   // left panel
    display.drawBox(x + 9, y + 2, 3, 6);   // right panel
    display.drawHLine(x + 3, y + 5, 2);    // struts
    display.drawHLine(x + 7, y + 5, 2);
    display.drawBox(x + 5, y + 3, 2, 4);   // body
    display.drawPixel(x + 6, y + 1);       // antenna
    display.drawPixel(x + 7, y);
}

// Five bars. Doubles as the acquisition progress indicator: a satellite count
// climbing 0 -> 14 is the only signal that a cold fix is actually coming.
static void drawBars(int x, int y, int sats)
{
    int bars = sats >= 12 ? 5 : sats >= 9 ? 4 : sats >= 6 ? 3 : sats >= 4 ? 2 : sats >= 1 ? 1 : 0;
    for (int i = 0; i < 5; i++) {
        int h = 2 + i * 2, bx = x + i * 4, by = y + 8 - h;
        if (i < bars) display.drawBox(bx, by, 3, h);
        else          display.drawHLine(bx, y + 7, 3);
    }
}

// Battery gauge: outline, proportional fill, nub. A number alone does not read
// at a glance in bright light; a filling bar does.
static void drawBattery(int x, int y, int pct, bool charging)
{
    display.drawFrame(x, y, 14, 8);
    display.drawBox(x + 14, y + 2, 2, 4);
    int w = (pct * 10) / 100;
    if (w > 0) display.drawBox(x + 2, y + 2, w, 4);
    if (charging) {                       // bolt over the fill
        display.drawLine(x + 8, y + 1, x + 5, y + 4);
        display.drawLine(x + 5, y + 4, x + 9, y + 4);
        display.drawLine(x + 9, y + 4, x + 6, y + 7);
    }
}

// Shown instead of a gauge when no battery is fitted: the device is running on
// the cable alone and stops the moment it is unplugged.
static void drawPlug(int x, int y)
{
    display.drawVLine(x + 3, y,     2);
    display.drawVLine(x + 7, y,     2);
    display.drawBox  (x + 1, y + 2, 9, 4);
    display.drawVLine(x + 5, y + 6, 3);
}

void uiSplash()
{
    if (!display.begin()) return;

    // A satellite orbiting a "P". Short, and it says what the device is for.
    const int cx = 64, cy = 33, rx = 44, ry = 21;
    for (int f = 0; f < 26; f++) {
        float a = -1.6f + f * 0.30f;
        display.clearBuffer();
        display.drawEllipse(cx, cy, rx, ry);
        display.setFont(u8g2_font_logisoso32_tf);
        display.drawStr(cx - 11, cy + 17, "P");
        drawSatellite((int)(cx + cosf(a) * rx) - 6, (int)(cy + sinf(a) * ry) - 4);
        display.sendBuffer();
        delay(38);
    }

    display.clearBuffer();
    display.setFont(u8g2_font_logisoso32_tf);
    display.drawStr(cx - 11, cy + 11, "P");
    display.setFont(u8g2_font_6x10_tf);
    const char *w = "paddlesnitch";
    display.drawStr(cx - display.getStrWidth(w) / 2, 62, w);
    display.sendBuffer();
    delay(650);
}

// Until the tracker is linked to an account it has nothing useful to say about
// paddling, so the screen is given over entirely to getting it linked. Showing
// speed and satellites first would imply a readiness the device does not have.
// Not blank, though: a blank screen is indistinguishable from a dead one.
static void drawOnboarding(const UiState &s)
{
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "PADDLE TRACKER");
    display.drawHLine(0, 13, 128);

    display.setFont(u8g2_font_helvB12_tf);
    display.drawStr(0, 32, s.linkTitle.c_str());

    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 47, s.linkHint.c_str());

    display.setFont(u8g2_font_5x8_tf);
    char id[32];
    snprintf(id, sizeof(id), "id %s", s.deviceId.c_str());
    display.drawStr(0, 62, id);
    display.sendBuffer();
}

// The one element common to every operating screen, so state changes never move
// the things the user checks reflexively: fix, recording, power.
static void drawTopRow(const UiState &s)
{
    char line[32];
    // --- status bar -----------------------------------------------------
    // The satellite blinks while searching and goes solid on a fix: state you
    // can read from across a boat without counting anything.
    bool showSat = s.fix || (millis() / 500) % 2;
    if (showSat) drawSatellite(0, 0);
    drawBars(15, 0, s.sats);

    // Nothing is drawn when idle: the absence of REC is the "not recording"
    // state, and the bottom line already says what to press.
    display.setFont(u8g2_font_5x8_tf);
    if (s.recording) {
        if ((millis() / 600) % 2) display.drawDisc(44, 4, 3);   // pulsing dot
        display.drawStr(50, 7, "REC");
    }

    if (s.batteryPct >= 0) {
        snprintf(line, sizeof(line), "%d%%", s.batteryPct);
        int bw = display.getStrWidth(line);
        display.drawStr(128 - 16 - 3 - bw, 7, line);
        drawBattery(128 - 16, 0, s.batteryPct, s.charging);
    } else {
        drawPlug(128 - 11, 0);
    }
    display.drawHLine(0, 11, 128);
}

static void drawTracker(const UiState &s)
{
    char line[32];
    display.clearBuffer();
    drawTopRow(s);

    // --- hero ------------------------------------------------------------
    // Layout stays put whether or not there is a fix -- "--" reads as "no value
    // yet" without a sentence explaining it. The blinking satellite above is
    // already saying that we are searching.
    display.setFont(u8g2_font_logisoso24_tn);
    if (s.fix) { snprintf(line, sizeof(line), "%.1f", s.speedKmh); display.drawStr(0, 41, line); }
    else       { display.drawStr(0, 41, "--"); }
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(66, 30, "km/h");

    // --- bottom line -----------------------------------------------------
    display.setFont(u8g2_font_6x10_tf);
    if (!s.sdReady) {
        display.drawStr(0, 63, "No SD card");
    } else if (s.recording) {
        snprintf(line, sizeof(line), "%lu:%02lu", (unsigned long)(s.sessionSecs / 60),
                 (unsigned long)(s.sessionSecs % 60));
        display.drawStr(0, 63, line);
        if (s.distanceM >= 1000) snprintf(line, sizeof(line), "%.2f km", s.distanceM / 1000.0);
        else                     snprintf(line, sizeof(line), "%.0f m", s.distanceM);
        display.drawStr(128 - display.getStrWidth(line), 63, line);
    } else {
        display.drawStr(0, 63, "Press to record");
    }

    // Transient feedback (e.g. "NEED GPS" after a refused tap) overlays the hero.
    if (s.toastUntilMs > millis() && s.toast.length()) {
        display.setFont(u8g2_font_helvB12_tf);
        display.drawStr(0, 40, s.toast.c_str());
    }
    display.sendBuffer();
}

// Sync: what is on the card and what the server has. The one screen that makes
// the background uploader visible, and where the card gets cleared.
static void drawSync(const UiState &s)
{
    char l[32];
    display.clearBuffer();
    drawTopRow(s);

    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 24, "SYNC");
    if (s.syncing) display.drawStr(128 - display.getStrWidth("..."), 24, "...");

    display.setFont(u8g2_font_6x10_tf);
    if (!s.countsValid) {
        display.drawStr(0, 40, "scanning card...");
    } else {
        snprintf(l, sizeof(l), "on device %d", s.onDevice);  display.drawStr(0, 38, l);
        snprintf(l, sizeof(l), "uploaded  %d", s.uploaded);  display.drawStr(0, 50, l);
        snprintf(l, sizeof(l), "pending   %d", s.pending);   display.drawStr(0, 62, l);
    }

    display.setFont(u8g2_font_5x8_tf);
    const char *hint = "tap=sync  hold=delete";
    display.drawStr(128 - display.getStrWidth(hint), 8, "");   // keep top-row clear
    display.drawStr(128 - display.getStrWidth(hint), 62, hint);
    display.sendBuffer();
}

// Delete confirmation: destructive, so it is a deliberate screen, not a gesture.
static void drawDeleteConfirm(const UiState &s)
{
    char l[32];
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 12, "DELETE UPLOADED?");
    display.drawHLine(0, 15, 128);
    display.setFont(u8g2_font_helvB12_tf);
    snprintf(l, sizeof(l), "%d files", s.uploaded);
    display.drawStr(0, 38, l);
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 62, "tap = yes   2x = no");
    display.sendBuffer();
}

// Linking: the code is the only thing that matters, so it gets the whole panel.
static void drawLinking(const UiState &s)
{
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "LINK THIS TRACKER");
    display.drawHLine(0, 13, 128);
    display.setFont(u8g2_font_logisoso20_tr);
    display.drawStr(2, 40, s.claimCode.length() ? s.claimCode.c_str() : "....");
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(0, 54, "paddlesnitch.com");
    display.drawStr(0, 63, "profile > settings");
    display.sendBuffer();
}

// Everything removed from the normal screens, on one page, reachable without a
// laptop -- the situations that need it happen on the water.
static void drawNerd(const UiState &s)
{
    char l[40];
    display.clearBuffer();
    display.setFont(u8g2_font_5x8_tf);

    snprintf(l, sizeof(l), "sat %d  hdop %.1f  %s", s.sats, s.hdop, s.fix ? "FIX" : "--");
    display.drawStr(0, 7, l);
    snprintf(l, sizeof(l), "id %s  %s", s.deviceId.c_str(), s.linked ? "linked" : "UNLINKED");
    display.drawStr(0, 16, l);
    snprintf(l, sizeof(l), "net %s", s.wifiUp ? s.ip.c_str() : (s.ssid.length() ? s.ssid.c_str() : "none"));
    display.drawStr(0, 25, l);
    snprintf(l, sizeof(l), "tx %lu/%lu  rows %lu",
             (unsigned long)s.txOk, (unsigned long)s.txFail, (unsigned long)s.rows);
    display.drawStr(0, 34, l);
    snprintf(l, sizeof(l), "%s", s.fileName.length() ? s.fileName.c_str() : "not recording");
    display.drawStr(0, 43, l);
    if (s.batteryPct >= 0) snprintf(l, sizeof(l), "bat %.2fV %d%%", s.battVolts, s.batteryPct);
    else                   snprintf(l, sizeof(l), "bat usb only");
    display.drawStr(0, 52, l);
    snprintf(l, sizeof(l), "heap %luk", (unsigned long)(s.freeHeap / 1024));
    display.drawStr(0, 61, l);
    display.drawStr(92, 61, "2x=next");
    display.sendBuffer();
}

void uiDraw(const UiState &s)
{
    if (!board_display_ok()) return;
    switch (s.state) {
    case AppState::Linking:       drawLinking(s);       break;
    case AppState::Track:         drawTracker(s);       break;
    case AppState::Sync:          drawSync(s);          break;
    case AppState::Nerd:          drawNerd(s);          break;
    case AppState::DeleteConfirm: drawDeleteConfirm(s); break;
    case AppState::Setup:
    default:                      drawOnboarding(s);    break;
    }
}
