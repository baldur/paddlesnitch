#include "ui.h"
#include "qr.h"
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

// Power state, top-right, on EVERY screen.
//
// The gauge used to live only in the Track screen's status bar, on the reasoning
// that the status bar was Track's. But "how much battery is left" is not a
// property of the screen you happen to be looking at — it is the one thing you
// want to be able to glance at whatever the device is showing, and out on the
// water there is no other way to find out. Icon only here, no percentage: it has
// to fit beside each screen's own title without pushing anything around. Track
// keeps the fuller icon+percent treatment in drawTopRow.
static void drawBatteryBadge(const UiState &s)
{
    if (s.batteryPct >= 0) drawBattery(128 - 16, 0, s.batteryPct, s.charging);
    else                   drawPlug(128 - 11, 0);
}

void uiSplash()
{
    if (!display.begin()) return;

    // The wordmark, centred, briefly. Nothing else.
    //
    // This used to be a satellite orbiting a "P" over an ellipse — 26 frames and
    // about 1.6 s before the device would show you anything useful. A boot
    // animation is a cost paid every single power-on, and it was saying something
    // the rest of the UI says better: the Track screen's satellite glyph already
    // tells you about GPS, and it does it when the answer matters.
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    const char *w = "paddlesnitch";
    display.drawStr((128 - display.getStrWidth(w)) / 2, 36, w);
    display.sendBuffer();
    delay(200);
}

// Until the tracker is linked to an account it has nothing useful to say about
// paddling, so the screen is given over entirely to getting it linked. Showing
// speed and satellites first would imply a readiness the device does not have.
// Not blank, though: a blank screen is indistinguishable from a dead one.
static void drawOnboarding(const UiState &s)
{
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "Paddle tracker");
    display.drawHLine(0, 13, 128);

    display.setFont(u8g2_font_helvB12_tf);
    display.drawStr(0, 32, s.linkTitle.c_str());

    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 47, s.linkHint.c_str());

    display.setFont(u8g2_font_5x8_tf);
    char id[32];
    snprintf(id, sizeof(id), "id %s", s.deviceId.c_str());
    display.drawStr(0, 62, id);
    drawBatteryBadge(s);
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

    // REC now lives on the bottom line next to "hold to stop", not here.
    display.setFont(u8g2_font_5x8_tf);
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

    // A hold has armed the stop: make the whole screen the confirmation so it
    // can't be missed. Same answers as the delete confirmation -- tap = yes,
    // double-tap = no. These two used to disagree, which is the worst possible
    // place for the button to mean different things.
    if (s.stopArmed) {
        display.setFont(u8g2_font_helvB12_tf);
        display.drawStr(0, 34, "Stop?");
        display.setFont(u8g2_font_6x10_tf);
        display.drawStr(0, 52, "tap = yes   2x = no");
        display.setFont(u8g2_font_5x8_tf);
        display.drawStr(0, 62, "no answer = keep recording");
        display.sendBuffer();
        return;
    }

    // --- hero: speed value + its unit (hugging the number), stroke rate right
    char val[12], unit[6];
    if (!s.fix) {
        strcpy(val, "--");
    } else if (s.speedUnit == 1) {                 // m/s
        snprintf(val, sizeof(val), "%.1f", s.speedKmh / 3.6);
    } else if (s.speedUnit == 2) {                 // pace per 500 m (m:ss)
        if (s.speedKmh >= 0.5) {
            int sec = (int)(1800.0 / s.speedKmh + 0.5);   // 500 m / (kmh/3.6)
            snprintf(val, sizeof(val), "%d:%02d", sec / 60, sec % 60);
        } else strcpy(val, "--:--");
    } else {                                       // km/h
        snprintf(val, sizeof(val), "%.1f", s.speedKmh);
    }
    strcpy(unit, s.speedUnit == 1 ? "m/s" : s.speedUnit == 2 ? "/500" : "km/h");

    display.setFont(u8g2_font_logisoso24_tn);
    display.drawStr(0, 40, val);
    int vw = display.getStrWidth(val);
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(vw + 4, 40, unit);             // unit right up against the number

    // stroke rate, top-right (value over a small "spm"); "--" until derived.
    char sr[6];
    if (s.strokeRateSpm >= 0) snprintf(sr, sizeof(sr), "%d", (int)(s.strokeRateSpm + 0.5));
    else                      strcpy(sr, "--");
    display.setFont(u8g2_font_helvB12_tf);
    display.drawStr(128 - display.getStrWidth(sr), 28, sr);
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(128 - display.getStrWidth("spm"), 38, "spm");

    // --- bottom ----------------------------------------------------------
    if (!s.sdReady) {
        display.setFont(u8g2_font_6x10_tf);
        display.drawStr(0, 63, "No SD card");
    } else if (s.recording) {
        // time + distance on the line above the REC row.
        display.setFont(u8g2_font_6x10_tf);
        snprintf(line, sizeof(line), "%lu:%02lu", (unsigned long)(s.sessionSecs / 60),
                 (unsigned long)(s.sessionSecs % 60));
        display.drawStr(0, 51, line);
        if (s.distanceM >= 1000) snprintf(line, sizeof(line), "%.2f km", s.distanceM / 1000.0);
        else                     snprintf(line, sizeof(line), "%.0f m", s.distanceM);
        display.drawStr(128 - display.getStrWidth(line), 51, line);
        // bottom row: blinking REC on the left, "hold to stop" on the right.
        if ((millis() / 600) % 2) display.drawDisc(3, 60, 3);   // blinking circle
        display.setFont(u8g2_font_5x8_tf);
        display.drawStr(9, 63, "REC");
        // Lost rows displace the hint. A dropped row is a missing second of the
        // paddle, and the documented rule here is that anything the user must
        // act on lives on the screen -- it should never be visible, so when it
        // is, it matters more than a hint they have already read.
        char h2[24];
        const char *h = "hold to stop";
        if (s.droppedRows) {
            snprintf(h2, sizeof(h2), "!%lu ROWS LOST", (unsigned long)s.droppedRows);
            h = h2;
        }
        display.drawStr(128 - display.getStrWidth(h), 63, h);
    } else {
        // Recording auto-starts once there's a fix; until then we're acquiring.
        display.setFont(u8g2_font_6x10_tf);
        display.drawStr(0, 63, "Acquiring GPS...");
    }

    // Transient feedback (e.g. "BUSY") overlays the hero.
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
    // No top row: the status bar is the Track screen's. Sync is its own view.
    char l[32];
    display.clearBuffer();

    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, s.syncPage == 0 ? "Sync" : "Sync / cleanup");
    // ANIMATED, deliberately. The old mark was a static "..." -- indistinguishable
    // from a wedged uploader, which is the exact failure this firmware spent a
    // session chasing. A mark that moves is evidence the task is still running.
    if (s.syncing) {
        const char frames[] = "|/-\\";
        char m[2] = { frames[(millis() / 200) % 4], 0 };
        display.drawStr(128 - 18 - display.getStrWidth(m), 10, m);
    }
    display.drawHLine(0, 13, 128);

    if (!s.countsValid) {
        display.drawStr(0, 32, "scanning card...");
    } else if (s.syncPage == 0) {
        snprintf(l, sizeof(l), "on device %d", s.onDevice);  display.drawStr(0, 28, l);
        snprintf(l, sizeof(l), "uploaded  %d", s.uploaded);  display.drawStr(0, 40, l);
        if (s.upParts <= 0) { snprintf(l, sizeof(l), "pending   %d", s.pending); display.drawStr(0, 52, l); }
    } else {
        // The cleanup page states the count and, more usefully, what survives:
        // the thing people actually want to know before wiping a card is whether
        // the un-uploaded paddle goes with it. It does not.
        snprintf(l, sizeof(l), "delete %d uploaded", s.uploaded);
        display.drawStr(0, 30, l);
        display.setFont(u8g2_font_5x8_tf);
        snprintf(l, sizeof(l), "keeps %d not yet sent", s.pending);
        display.drawStr(0, 42, l);
        display.setFont(u8g2_font_6x10_tf);
    }

    display.setFont(u8g2_font_5x8_tf);
    if (s.upParts > 0) {
        // A chunk in flight takes the bottom two rows: which file, how far in, and
        // a bar. A 2.4 MB sidecar is 37 requests -- several minutes during which
        // the tallies above do not move at all, so the count is the only real
        // progress the screen can show.
        String n = s.upFile;
        if (n.startsWith("track_")) n = n.substring(6);   // 23 chars of tail fits 128px at 5x8
        char pl[48];                                      // its own buffer: l[32] is too small here
        snprintf(pl, sizeof(pl), "%s %d/%d", n.c_str(), s.upPart, s.upParts);
        display.drawStr(0, 52, pl);
        display.drawFrame(0, 56, 128, 7);
        const int inner = (int)(126.0f * s.upPart / s.upParts);
        if (inner > 0) display.drawBox(1, 57, inner, 5);
    } else {
        char pg[8];
        snprintf(pg, sizeof(pg), "%d/%d", s.syncPage + 1, s.syncPages);
        display.drawStr(0, 63, pg);
        const char *hint = s.syncPage == 0 ? "tap=page  hold=sync now"
                                           : "tap=page  hold=delete";
        display.drawStr(128 - display.getStrWidth(hint), 63, hint);
    }
    drawBatteryBadge(s);
    display.sendBuffer();
}

// The two menus. Kept here rather than passed in via UiState: the labels are
// presentation, and the tracker already tells us which menu is showing.
//
// Nerd mode and Network sit under Settings so the top level stays the three
// things you touch on the water. Track and Sync are one hold away as before;
// the diagnostics are one more, which is the right way round.
static const char *PICK_OPTS[3]     = { "Track", "Sync", "Settings" };
static const char *SETTINGS_OPTS[2] = { "Nerd mode", "Network" };

// One frame of a menu. Split out so the selection blink reuses the exact
// layout instead of a near-copy that drifts the first time a menu changes.
static void drawMenuFrame(const char **opts, int n, int sel, bool highlight, const char *title)
{
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    // A title only where there is one: Pick is the top level and needs no
    // label, but inside Settings you need to know where you are.
    int y0 = 20;
    if (title) {
        display.setFont(u8g2_font_5x8_tf);
        display.drawStr(0, 8, title);
        display.drawHLine(0, 11, 128);
        display.setFont(u8g2_font_6x10_tf);
        y0 = 26;
    }
    for (int i = 0; i < n; i++) {
        int y = y0 + i * 14;
        if (i == sel && highlight) {
            display.drawBox(0, y - 10, 128, 13);         // highlight bar
            display.setDrawColor(0);
            display.drawStr(6, y, opts[i]);
            display.setDrawColor(1);
        } else {
            display.drawStr(6, y, opts[i]);
        }
    }
    display.setFont(u8g2_font_5x8_tf);
    // Inside Settings the way out is worth stating; at the top level there is
    // nowhere to go back to.
    const char *hint = title ? "tap=move hold=open 2x=back" : "tap=move  hold=open";
    display.drawStr((128 - display.getStrWidth(hint)) / 2, 63, hint);
}

static void drawPick(const UiState &s)
{
    // No top row here: the chooser is just the options. The sat status bar
    // belongs to the Track screen, where it is what you are watching.
    drawMenuFrame(PICK_OPTS, 3, s.menuSel, true, nullptr);
    drawBatteryBadge(s);
    display.sendBuffer();
}

static void drawSettings(const UiState &s)
{
    drawMenuFrame(SETTINGS_OPTS, 2, s.menuSel, true, "Settings");
    drawBatteryBadge(s);
    display.sendBuffer();
}

// Settings > Network: what the device is on, and the way to change it. The
// portal is the screen's primary action, so it is a hold -- consistent with
// every other screen, and deliberately not a tap, because opening the portal
// drops the current connection.
static void drawNetwork(const UiState &s)
{
    char l[40];
    display.clearBuffer();
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(0, 8, "Settings > Network");
    display.drawHLine(0, 11, 128);
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 26, s.net.ssid.length() ? s.net.ssid.c_str() : "no network set");
    display.setFont(u8g2_font_5x8_tf);
    // "not connected" was true and misleading. The radio is DOWN almost always
    // by design -- it comes up for about a second per sync (boot,
    // recording-stop, a sync-now tap, every 5 min) and is off the rest of the
    // time to save current. Reporting that as "not connected" tells the user
    // something is broken when the device is working exactly as intended.
    //
    // So: distinguish idle-but-fine from never-worked. `everConnected` is the
    // one that actually needs action.
    if (s.net.up)                    snprintf(l, sizeof(l), "%s  %d dBm", s.net.ip.c_str(), s.net.rssi);
    else if (!s.net.ssid.length())   snprintf(l, sizeof(l), "hold to choose a network");
    else if (s.net.everConnected)    snprintf(l, sizeof(l), "idle - connects to sync");
    else                             snprintf(l, sizeof(l), "never connected - check pass");
    display.drawStr(0, 38, l);
    display.drawStr(0, 50, "hold = change network");
    const char *hint = "2x = back";
    display.drawStr((128 - display.getStrWidth(hint)) / 2, 63, hint);
    drawBatteryBadge(s);
    display.sendBuffer();
}

// Blinks the highlighted row on its way out.
//
// A hold opens the screen under your thumb with no other acknowledgement, so a
// slow press and a successful one looked identical until the next screen appeared.
// Two quick flashes of the bar say "that one, and it took" — and they double as
// the transition, which otherwise cut hard from one layout to another.
void uiPickFlash(int sel, bool settings)
{
    if (!board_display_ok()) return;
    const char **opts = settings ? SETTINGS_OPTS : PICK_OPTS;
    const int    n    = settings ? 2 : 3;
    const char  *ttl  = settings ? "Settings" : nullptr;
    for (int i = 0; i < 2; i++) {
        drawMenuFrame(opts, n, sel, false, ttl); display.sendBuffer(); delay(70);
        drawMenuFrame(opts, n, sel, true,  ttl); display.sendBuffer(); delay(70);
    }
}

// Delete confirmation: destructive, so it is a deliberate screen, not a gesture.
static void drawDeleteConfirm(const UiState &s)
{
    char l[32];
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 12, "Delete uploaded?");
    display.drawHLine(0, 15, 128);
    display.setFont(u8g2_font_helvB12_tf);
    snprintf(l, sizeof(l), "%d files", s.uploaded);
    display.drawStr(0, 38, l);
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 62, "tap = yes   2x = no");
    drawBatteryBadge(s);
    display.sendBuffer();
}

// Factory reset confirmation. Reached by seven taps, which is deliberate: the
// button means "cycle" everywhere, so a reset cannot be a gesture that also
// does something else, and it has to be something nobody does by accident.
//
// Spells out what goes and what stays, because "reset" is doing a lot of work
// in one word and the answer to "will I lose my paddles?" is no.
static void drawResetConfirm(const UiState &s)
{
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 12, "Factory reset?");
    display.drawHLine(0, 15, 128);
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(0, 29, "clears wifi + account link");
    display.drawStr(0, 40, "KEEPS paddles on the card");
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 62, "tap = yes   2x = no");
    drawBatteryBadge(s);
    display.sendBuffer();
}

// Linking: the code is the only thing that matters, so it gets the whole panel.
static void drawLinking(const UiState &s)
{
    display.clearBuffer();

    // THE WHOLE PANEL, NOTHING ELSE. The join screen can afford a QR beside
    // text because 62 px on a 128 px panel leaves room; this one cannot, and
    // side-by-side is measurably worse to scan. Text to the right eats into the
    // margin a scanner reads as the quiet zone, and the code sat hard against
    // the left edge with nothing outside its own border. Centred with the panel
    // dark all round, the quiet zone is effectively unlimited -- which is why
    // the centred QRTEST rendering scanned reliably when this did not.
    //
    // No battery badge here either: it is drawn in the corner, which is inside
    // the margin. A cosmetic indicator is not worth an unscannable code.
    const String link = "PADDLESNITCH.COM/L/" + s.claimCode;
    if (s.claimCode.length() && s.linkPage == 0 &&
        qrDraw(link.c_str(), (128 - qrSizePx()) / 2, (64 - qrSizePx()) / 2)) {
        display.sendBuffer();
        return;
    }

    // Page 2, and the fallback while the code is still being fetched: the
    // characters, for a dead camera or someone reading over a shoulder. Tap
    // cycles between the two, which is what tap means everywhere else.
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "Link this tracker");
    display.drawHLine(0, 13, 128);
    display.setFont(u8g2_font_logisoso20_tr);
    display.drawStr(2, 40, s.claimCode.length() ? s.claimCode.c_str() : "....");
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(0, 54, "paddlesnitch.com/l/");
    // Do not claim to be fetching a code when the device cannot reach the
    // network to fetch one. "getting a code..." forever is what this screen
    // showed while WiFi was failing to associate, and it pointed at the wrong
    // thing entirely.
    const char *foot = s.claimCode.length() ? "tap = show QR"
                     : (s.net.ssid.length() && !s.net.everConnected)
                           ? "wifi: check password"
                           : "getting a code...";
    display.drawStr(0, 63, foot);
    drawBatteryBadge(s);
    display.sendBuffer();
}

// Diagnostics, reachable without a laptop -- the situations that need it happen on
// the water. Paged rather than crammed: a 128x64 panel fits about seven 5x8 lines,
// and the useful set outgrew one screen. Tap advances and WRAPS -- paging is a
// cycle, not a queue you have to walk to the end of -- and double-tap leaves,
// same as everywhere else.
static void drawNerdHeader(const UiState &s, const char *title)
{
    char l[40];
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(0, 7, title);
    snprintf(l, sizeof(l), "%d/%d", s.nerdPage + 1, s.nerdPages);
    display.drawStr(128 - 16 - 3 - display.getStrWidth(l), 7, l);
    display.drawHLine(0, 10, 128);
}

static void drawNerd(const UiState &s)
{
    char l[48];
    display.clearBuffer();
    display.setFont(u8g2_font_5x8_tf);

    if (s.nerdPage == 0) {
        drawNerdHeader(s, "gnss / session");
        snprintf(l, sizeof(l), "sat %d  hdop %.1f  %s", s.sats, s.hdop, s.fix ? "FIX" : "--");
        display.drawStr(0, 20, l);
        snprintf(l, sizeof(l), "spd %.1f km/h", s.speedKmh);
        display.drawStr(0, 29, l);
        snprintf(l, sizeof(l), "dist %.2f km  %lus", s.distanceM / 1000.0, (unsigned long)s.sessionSecs);
        display.drawStr(0, 38, l);
        snprintf(l, sizeof(l), "%s", s.fileName.length() ? s.fileName.c_str() : "not recording");
        display.drawStr(0, 47, l);
        snprintf(l, sizeof(l), "rows %lu  tx %lu/%lu",
                 (unsigned long)s.rows, (unsigned long)s.txOk, (unsigned long)s.txFail);
        display.drawStr(0, 56, l);
    } else if (s.nerdPage == 1) {
        drawNerdHeader(s, "power / system");
        if (s.batteryPct >= 0) snprintf(l, sizeof(l), "bat %.2fV %d%% %s", s.battVolts, s.batteryPct,
                                        s.charging ? "chg" : (s.onUsb ? "usb" : ""));
        else                   snprintf(l, sizeof(l), "bat none  %s", s.onUsb ? "on usb" : "??");
        display.drawStr(0, 20, l);
        uint32_t up = s.uptimeS;
        snprintf(l, sizeof(l), "up %luh %02lum %02lus",
                 (unsigned long)(up / 3600), (unsigned long)((up / 60) % 60), (unsigned long)(up % 60));
        display.drawStr(0, 29, l);
        snprintf(l, sizeof(l), "heap %luk  min %luk",
                 (unsigned long)(s.freeHeap / 1024), (unsigned long)(s.heapMin / 1024));
        display.drawStr(0, 38, l);
        snprintf(l, sizeof(l), "psram %luk", (unsigned long)(s.psramFree / 1024));
        display.drawStr(0, 47, l);
        // Why it last rebooted. With a watchdog loop this is the first thing worth
        // knowing, and it is otherwise only visible on a serial console.
        snprintf(l, sizeof(l), "fw %s  %s", s.fwVersion.c_str(), s.resetReason.c_str());
        display.drawStr(0, 56, l);
    } else {
        drawNerdHeader(s, "radio / storage");
        snprintf(l, sizeof(l), "id %s %s", s.deviceId.c_str(), s.linked ? "linked" : "UNLINKED");
        display.drawStr(0, 20, l);
        if (s.wifiUp) snprintf(l, sizeof(l), "%s %ddBm", s.ip.c_str(), s.rssi);
        else          snprintf(l, sizeof(l), "wifi %s", s.ssid.length() ? s.ssid.c_str() : "none");
        display.drawStr(0, 29, l);
        // Re-linking is this page's hold action, so the page has to say so -- and
        // it says so exactly when it matters, in place of a server host that is
        // not much use to an unlinked device.
        if (!s.linked) snprintf(l, sizeof(l), "hold = link this device");
        else snprintf(l, sizeof(l), "%s", s.serverHost.length() ? s.serverHost.c_str() : "no server");
        display.drawStr(0, 38, l);
        if (s.sdReady) snprintf(l, sizeof(l), "sd %lluMB  %d/%d up",
                                (unsigned long long)s.sdSizeMB, s.uploaded, s.onDevice);
        else           snprintf(l, sizeof(l), "sd not mounted");
        display.drawStr(0, 47, l);
        if (s.imuOk) snprintf(l, sizeof(l), "imu %.0fC %luHz", s.imuTempC, (unsigned long)s.imuSamples);
        else         snprintf(l, sizeof(l), "imu FAILED");
        display.drawStr(0, 56, l);
    }

    // Was "2x=next", from when double-tap paged. Tap pages now and wraps;
    // double-tap leaves. Saying the wrong thing is worse than saying nothing.
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(74, 63, "tap=next 2x=back");
    drawBatteryBadge(s);
    display.sendBuffer();
}

void uiDraw(const UiState &s)
{
    if (!board_display_ok()) return;
    switch (s.state) {
    case AppState::Linking:       drawLinking(s);       break;
    case AppState::Pick:          drawPick(s);          break;
    case AppState::Settings:      drawSettings(s);      break;
    case AppState::Network:       drawNetwork(s);       break;
    case AppState::Track:         drawTracker(s);       break;
    case AppState::Sync:          drawSync(s);          break;
    case AppState::Nerd:          drawNerd(s);          break;
    case AppState::DeleteConfirm: drawDeleteConfirm(s); break;
    case AppState::ResetConfirm:  drawResetConfirm(s);  break;
    case AppState::Setup:
    default:                      drawOnboarding(s);    break;
    }
}
