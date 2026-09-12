// Tracker role: read GNSS, broadcast position over LoRa.
//
// Transmits every TX_INTERVAL_S, subject to the duty-cycle guard. Sends even
// without a fix (flagged, lat/lon zeroed) so the radio link can be tested
// indoors, where this module will otherwise never acquire.

#include <Arduino.h>
#include "board.h"
#include "board_pins.h"
#include "packet.h"
#include "dutycycle.h"
#include "storage.h"
#include "imu.h"
#include "netcfg.h"
#include "uplink.h"
#include "ui.h"
#include <WiFi.h>

#ifndef TX_INTERVAL_S
#define TX_INTERVAL_S 30
#endif
#ifndef DUTY_CYCLE_PERCENT
#define DUTY_CYCLE_PERCENT 1
#endif
#ifndef PACKET_SELFTEST
#define PACKET_SELFTEST 0
#endif
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

// Build with -DGPS_ECHO=1 to mirror raw NMEA to the serial monitor. Useful when
// the parser reports nothing and you need to know whether the module is silent,
// talking at the wrong baud, or simply has no fix.
#ifndef GPS_ECHO
#define GPS_ECHO 0
#endif

static BoardStatus board;
static uint32_t    lastDraw = 0;   // screen refresh
static uint32_t    lastTick = 0;   // 1 Hz logging / status
static DutyCycle   duty(DUTY_CYCLE_PERCENT);
static uint16_t    txSeq       = 0;
static uint32_t    lastTxMs    = 0;
static int16_t     lastTxState = 0;
static uint32_t    txOkCount   = 0;
static uint32_t    txFailCount = 0;

// Session figures for the screen. Distance uses a movement threshold: summing
// every consecutive fix inflates the total badly when stationary (the first
// outdoor run logged 115 m of "travel" inside a 33 x 10 m box), so a segment
// only counts if the device actually moved.
static double   sessionMetres  = 0;
static uint32_t firstFixMs     = 0;
static bool     haveLastPos    = false;

// What to tell the user while the device is not yet linked. Set during setup()
// and by a retry, so the screen keeps explaining itself instead of showing a
// tracker UI for a device that cannot yet deliver anything anywhere.
// Every boot (once usable) lands on the Pick chooser; the user taps to move the
// highlight and holds to enter a screen. A double-tap in a screen returns to
// Pick. Onboarding screens (Setup/Linking) are forced separately while the
// device is not yet usable. DeleteConfirm is a transient overlay on Sync.
enum class Screen { Track, Sync, Nerd };
static bool     onPick        = true;            // showing the chooser
static Screen   pickHighlight = Screen::Track;   // highlighted option on Pick
static Screen   uiScreen      = Screen::Track;   // the entered screen
static bool     confirmDelete = false;
static uint32_t confirmUntil  = 0;
// Track auto-records on entry (once there's a fix); stopping is a deliberate
// hold -> double-tap, so stopArmed gates the confirm the way confirmDelete does.
static bool     stopArmed     = false;
static uint32_t stopArmUntil  = 0;
static String   toastText;
static uint32_t toastUntil    = 0;

static void toast(const char *t, uint32_t ms = 1500)
{
    toastText = t;
    toastUntil = millis() + ms;
}

static String linkTitle = "Not linked";
static String linkHint  = "Hold BOOT 3s";
static double   lastLat = 0, lastLon = 0;

static double metresBetween(double lat1, double lon1, double lat2, double lon2)
{
    const double R = 6371000.0, d2r = 0.017453292519943295;
    double p1 = lat1 * d2r, p2 = lat2 * d2r;
    double dp = (lat2 - lat1) * d2r, dl = (lon2 - lon1) * d2r;
    double a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2);
    return 2 * R * asin(sqrt(a));
}

static void updateSession()
{
    if (!gps.location.isValid()) return;
    if (firstFixMs == 0) firstFixMs = millis();

    double lat = gps.location.lat(), lon = gps.location.lng();
    if (haveLastPos) {
        double d = metresBetween(lastLat, lastLon, lat, lon);
        // 3 m and 1.5 km/h: below both, it is GPS scatter, not paddling.
        if (d >= 3.0 && gps.speed.isValid() && gps.speed.kmph() >= 1.5) {
            sessionMetres += d;
            lastLat = lat; lastLon = lon;
        }
    } else {
        lastLat = lat; lastLon = lon; haveLastPos = true;
    }
}

static void toggleRecording();
static void linkAttempt();   // defined below; used by setup() and the BOOT button

static void report(const char *name, bool ok, const char *detail = "")
{
    Serial.printf("  %-8s %s %s\n", name, ok ? "[ ok ]" : "[FAIL]", detail);
}

void setup()
{
    Serial.begin(115200);
    // USB-CDC: give the host a moment to enumerate, but never block forever --
    // the board must still run on battery with no serial monitor attached.
    uint32_t t0 = millis();
    while (!Serial && millis() - t0 < 2000) delay(10);

    Serial.println("\n=== T-Beam S3 Supreme bring-up ===");
    board = boardInit();
    uiSplash();

    char radioDetail[32] = "";
    if (!board.radio) snprintf(radioDetail, sizeof(radioDetail), "RadioLib %d", board.radioErr);

    report("PMU",     board.pmu);
    report("GPS",     board.gps, "UART open, waiting for NMEA");
    report("Radio",   board.radio, radioDetail);
    report("Display", board.display, board.display ? "" : "panel did not ack");

#if PACKET_SELFTEST
    pktSelfTest();
#endif

    // IMU before SD: both are on the shared SPI bus, and mounting the card first
    // leaves it contending with the IMU's chip-select -- the documented cause of
    // the intermittent "IMU probe 0xFF / init failed". Probe + init the IMU while
    // the bus is still clean, then mount the card. (imuInit also rail-cycles and
    // retries if the chip comes up wedged after a warm reset.)
    imuProbe();
    bool imuOk = imuInit();
    report("IMU", imuOk, imuOk ? "QMI8658 accel+gyro" : "init failed");

    board.sdcard = storageInit();
    report("SD", board.sdcard,
           board.sdcard ? "card ready - tap button to record" : "no card / mount failed");

    // Uplink runs once, at boot, and only when WiFi is configured: the device
    // is plugged in at home when that is true, and the radio is the largest
    // power draw on the board, so it is not left on while tracking.
    netcfgLoad();

    // A device with no credentials cannot be set up without this: the portal
    // needs the display and blocks, so it cannot live in the background task.
    if (!netHasWifi()) netBringUp();

    uplinkTaskStart();   // core 0; the UI and logging keep running on core 1
    // linkAttempt() can block for minutes while polling for the claim code, and
    // setup() never reads serial. Anything typed in that window would otherwise
    // execute the instant loop() starts -- a FORGET sent during a claim once
    // very nearly wiped the token the moment it was issued.
    while (Serial.available()) Serial.read();

    boardScanI2C(Wire1, "PMU/RTC");
    boardScanI2C(Wire,  "OLED/QWIIC");
    if (board.radio) radioPrintConfig();
    Serial.printf("Node ID: %08X   TX every %ds (<=%d%% duty)\n",
                  pktNodeId(), (int)TX_INTERVAL_S, (int)DUTY_CYCLE_PERCENT);

    if (board.pmu) Serial.printf("Battery: %.2f V\n", boardBatteryVoltage());
    Serial.println("Streaming GPS...\n");
}

static void transmitPosition()
{
    PositionPacket p = {};
    p.nodeId  = pktNodeId();
    p.seq     = txSeq++;
    p.battMv  = boardBatteryMv();
    p.flags   = 0;
    if (boardIsCharging()) p.flags |= PKT_FLAG_CHARGING;

    if (gps.location.isValid()) {
        p.flags |= PKT_FLAG_HAS_FIX;
        p.lat  = (int32_t)(gps.location.lat() * 1e7);
        p.lon  = (int32_t)(gps.location.lng() * 1e7);
        p.altM = gps.altitude.isValid() ? (int16_t)gps.altitude.meters() : 0;
    }
    p.sats    = gps.satellites.isValid() ? (uint8_t)gps.satellites.value() : 0;
    double h  = gps.hdop.isValid() ? gps.hdop.hdop() : 25.5;
    p.hdopX10 = (uint8_t)(h > 25.5 ? 255 : h * 10);

    pktFinalise(p);

    uint32_t airtimeMs = radio.getTimeOnAir(sizeof(p)) / 1000;
    lastTxState = radio.transmit((uint8_t *)&p, sizeof(p));
    duty.recordTx(airtimeMs);
    lastTxMs = millis();

    if (lastTxState == RADIOLIB_ERR_NONE) {
        txOkCount++;
        Serial.printf("TX seq=%u %s air=%lums next>=%lus\n",
                      p.seq, (p.flags & PKT_FLAG_HAS_FIX) ? "fix" : "nofix",
                      (unsigned long)airtimeMs,
                      (unsigned long)(duty.waitRemainingMs() / 1000));
    } else {
        txFailCount++;
        Serial.printf("TX seq=%u FAILED RadioLib %d\n", p.seq, lastTxState);
    }

    // transmit() leaves the radio in standby; nothing to restore for TX-only.
}

// Until the tracker is linked to an account it has nothing useful to say about
// paddling, so the screen is given over entirely to getting it linked. Showing
// speed and satellites first would imply the device is ready when it is not.
//
// Not blank, though: a blank screen is indistinguishable from a dead one, and
// the claim code has to be readable.
static void drawOnboarding()
{
    if (!board.display) return;

    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "PADDLE TRACKER");
    display.drawHLine(0, 13, 128);

    display.setFont(u8g2_font_helvB12_tf);
    display.drawStr(0, 32, linkTitle.c_str());

    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 47, linkHint.c_str());

    display.setFont(u8g2_font_5x8_tf);
    char id[32];
    snprintf(id, sizeof(id), "id %s", netDeviceId().c_str());
    display.drawStr(0, 62, id);
    if (board.sdcard) {
        const char *rec = "recording";
        display.drawStr(128 - display.getStrWidth(rec), 62, rec);
    }
    display.sendBuffer();
}

// Screen for the person using the tracker, not for debugging it.
//
// Rules this follows, learned the hard way:
//  - No raw diagnostics. NMEA byte counts and an HDOP of 25.5 (the no-fix
//    sentinel) tell a paddler nothing; they belong on the serial log.
//  - While searching, show progress, because "nothing yet" and "nearly there"
//    look identical otherwise and a cold fix takes over a minute.
//  - Anything the user must act on is persistent, not a boot-time flash.
static void drawStatus()
{
    if (!board.display) return;
    char line[32];
    bool fix = gps.location.isValid();
    int  sats = gps.satellites.isValid() ? gps.satellites.value() : 0;

    display.clearBuffer();

    // --- status bar ---------------------------------------------------
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(0, 7, fix ? "GPS" : "SAT");

    // Signal as five bars: compact, and readable at a glance without parsing
    // a number. Below a fix it doubles as the acquisition progress indicator.
    int bars = sats >= 12 ? 5 : sats >= 9 ? 4 : sats >= 6 ? 3 : sats >= 4 ? 2 : sats >= 1 ? 1 : 0;
    for (int i = 0; i < 5; i++) {
        int h = 2 + i * 2, x = 20 + i * 4, y = 8 - h;
        if (i < bars) display.drawBox(x, y, 3, h);
        else          display.drawFrame(x, y + h - 1, 3, 1);
    }

    if (board.sdcard) display.drawStr(46, 7, "REC");

    int pct = boardBatteryPercent();
    if (pct >= 0) snprintf(line, sizeof(line), "%s%d%%", boardIsCharging() ? "+" : "", pct);
    else          snprintf(line, sizeof(line), "USB");
    display.drawStr(128 - display.getStrWidth(line), 7, line);

    display.drawHLine(0, 11, 128);

    // --- hero ----------------------------------------------------------
    if (fix) {
        double kmh = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
        snprintf(line, sizeof(line), "%.1f", kmh);
        display.setFont(u8g2_font_logisoso24_tn);
        display.drawStr(0, 41, line);
        display.setFont(u8g2_font_5x8_tf);
        display.drawStr(display.getStrWidth(line) > 0 ? 4 + display.getStrWidth(line) : 60, 41, "");
        display.setFont(u8g2_font_6x10_tf);
        display.drawStr(66, 30, "km/h");
    } else {
        display.setFont(u8g2_font_6x10_tf);
        display.drawStr(0, 26, "Searching for");
        display.drawStr(0, 38, "satellites...");
        display.setFont(u8g2_font_5x8_tf);
        snprintf(line, sizeof(line), "%ds", (int)(millis() / 1000));
        display.drawStr(128 - display.getStrWidth(line), 38, line);
    }

    // --- bottom line: alerts win over stats ----------------------------
    display.setFont(u8g2_font_6x10_tf);
    if (fix) {
        uint32_t secs = firstFixMs ? (millis() - firstFixMs) / 1000 : 0;
        snprintf(line, sizeof(line), "%lu:%02lu", (unsigned long)(secs / 60),
                 (unsigned long)(secs % 60));
        display.drawStr(0, 63, line);
        if (sessionMetres >= 1000) snprintf(line, sizeof(line), "%.2f km", sessionMetres / 1000.0);
        else                       snprintf(line, sizeof(line), "%.0f m", sessionMetres);
        display.drawStr(128 - display.getStrWidth(line), 63, line);
    } else if (!board.sdcard) {
        display.drawStr(0, 63, "No SD card");
    } else {
        snprintf(line, sizeof(line), "Recording  %lu", (unsigned long)storageRowCount());
        display.drawStr(0, 63, line);
    }

    display.sendBuffer();
}

// Hold the BOOT button for 3 s to reopen the setup portal. Without this, a
// device that has connected before but whose WiFi password later changes can
// only be fixed with a laptop and a serial console — which is not a reasonable
// thing to need in a kit bag.
// One path for "get this device linked", used at boot and by the BOOT button,
// so the two can never drift apart.
// Starting a recording resets the session figures: distance and elapsed time
// belong to this paddle, not to however long the device has been powered.
static void toggleRecording()
{
    if (!board.sdcard) { Serial.println("no SD card -- cannot record"); return; }

    if (storageRecording()) {
        storageStopSession();
        uplinkResume();                 // the card is free again
        uplinkRequestSync();
        return;
    }

    // Recording before a fix produces exactly the fix-less rows that made all 31
    // of the first uploads return 422. Refuse, and say why.
    if (!gps.location.isValid()) { toast("NEED GPS"); return; }

    // Both cores must never hold the SD card at once.
    if (!uplinkYieldCard()) {
        toast("BUSY");
        return;
    }

    // Name the file from GPS time (valid here: we just checked for a fix), so it
    // is unique for the device's life and never collides with the server's
    // deviceId+filename dedupe the way the old reused track_NNNN names did. Empty
    // stamp -> storage falls back to its NVS counter.
    char stamp[20] = "";
    if (gps.date.isValid() && gps.time.isValid()) {
        snprintf(stamp, sizeof(stamp), "%04d%02d%02d_%02d%02d%02d",
                 gps.date.year(), gps.date.month(), gps.date.day(),
                 gps.time.hour(), gps.time.minute(), gps.time.second());
    }
    if (storageStartSession(stamp[0] ? stamp : nullptr)) {
        sessionMetres = 0;
        haveLastPos   = false;
        firstFixMs    = 0;
    }
}

static void linkAttempt()
{
    if (!netHasWifi()) {
        linkTitle = "Setup needed";
        linkHint  = "Hold BOOT 3s";
        netBringUp();                       // opens the portal itself
        return;
    }
    if (!netBringUp()) {
        linkTitle = "No WiFi";
        linkHint  = "Hold BOOT 3s to fix";
        return;
    }
    if (!netIsClaimed()) {
        ClaimStatus cs = uplinkClaim();
        if (cs.state != ClaimState::Claimed) {
            Serial.printf("claim: %s\n", cs.message.c_str());
            linkTitle = "Not linked";
            linkHint  = "Hold BOOT 3s to retry";
            netDisconnect();
            return;
        }
    }
    uplinkSyncSessions();
    netDisconnect();
}

static bool deviceUsable() { return netHasWifi() && netIsClaimed(); }

static void enterScreen(Screen s)
{
    uiScreen = s;
    onPick   = false;
    stopArmed = false;
    if (s == Screen::Sync) uplinkRequestCounts();           // refresh on entry
    // Track is the recording screen: it auto-starts once a fix is available
    // (handled in loop()), so there is no "press to record".
}

// The one free button (RST is the AXP2101 power key), three gestures, their
// meaning depending on the visible screen. See docs/device-states-spec.md.
//   Pick:          tap -> move highlight, hold -> open highlighted screen
//   Track/Sync:    tap -> primary action, double-tap -> back to Pick,
//                  hold -> Setup (Track) / arm delete (Sync)
//   DeleteConfirm: tap -> yes, double-tap -> no
static void screenTap()
{
    if (confirmDelete) {                       // confirm screen: tap = yes
        confirmDelete = false;
        uplinkRequestDeleteUploaded();
        toast("DELETING");
        return;
    }
    if (!deviceUsable()) return;               // onboarding: tap does nothing
    if (onPick) {                              // move the highlight
        pickHighlight = pickHighlight == Screen::Track ? Screen::Sync
                      : pickHighlight == Screen::Sync  ? Screen::Nerd
                                                       : Screen::Track;
        return;
    }
    switch (uiScreen) {
    case Screen::Track: if (stopArmed) stopArmed = false; break;  // cancel a stop
    case Screen::Sync:  uplinkRequestSync(); toast("SYNCING"); break;
    case Screen::Nerd:  break;
    }
}

static void screenDoubleTap()
{
    if (confirmDelete) { confirmDelete = false; return; }   // confirm screen: cancel
    if (!deviceUsable()) return;
    if (onPick) return;                                     // no double-tap on Pick
    // On Track, a double-tap confirms a stop that a hold armed; otherwise it just
    // returns to the menu (recording, if any, keeps running in the background).
    if (uiScreen == Screen::Track && stopArmed) {
        stopArmed = false;
        if (storageRecording()) toggleRecording();          // stop + trigger sync
    }
    onPick = true;
    pickHighlight = uiScreen;
}

static void screenHold()
{
    if (confirmDelete) return;
    if (!deviceUsable()) { linkAttempt(); return; }         // onboarding: WiFi/link
    if (onPick) { enterScreen(pickHighlight); return; }     // open highlighted screen
    if (uiScreen == Screen::Sync) {                         // arm the delete
        confirmDelete = true;
        confirmUntil  = millis() + 10000;
        return;
    }
    if (uiScreen == Screen::Track && storageRecording()) {  // arm the stop
        stopArmed    = true;
        stopArmUntil = millis() + 10000;
        return;
    }
    linkAttempt();                                          // Track(idle)/Nerd -> Setup
}

// A single tap is only confirmed once the double-tap window closes, so the action
// fires ~400 ms after release. Invisible next to a 1 Hz log rate.
static const uint32_t DOUBLE_TAP_MS = 400;

static void checkButton()
{
    static uint32_t heldSince   = 0;
    static bool     longFired   = false;
    static uint32_t pendingTap  = 0;   // when a tap is awaiting its double-tap window

    // The delete / stop confirmations auto-cancel if the user walks away.
    if (confirmDelete && millis() > confirmUntil) confirmDelete = false;
    if (stopArmed && millis() > stopArmUntil)     stopArmed     = false;

    bool down = digitalRead(BUTTON_PIN) == LOW;

    if (down && heldSince == 0) {
        heldSince = millis();
        longFired = false;
    } else if (down && !longFired && millis() - heldSince > 3000) {
        longFired  = true;
        pendingTap = 0;
        Serial.println("btn: hold");
        screenHold();
    } else if (!down && heldSince) {
        uint32_t held = millis() - heldSince;
        heldSince = 0;
        if (longFired || held <= 40) return;              // 40 ms debounce
        // On the Pick menu a tap acts immediately: there is no double-tap action
        // there, so waiting out the double-tap window just makes the menu feel
        // dead, and a release bounce would otherwise land as a no-op double-tap.
        if (onPick) {
            Serial.println("btn: tap (pick)");
            screenTap();
            return;
        }
        if (pendingTap && millis() - pendingTap < DOUBLE_TAP_MS) {
            pendingTap = 0;
            Serial.println("btn: double-tap");
            screenDoubleTap();
        } else {
            pendingTap = millis();
        }
    }

    if (pendingTap && millis() - pendingTap >= DOUBLE_TAP_MS) {
        pendingTap = 0;
        Serial.println("btn: tap");
        screenTap();
    }
}

// Minimal serial command interface: "LS" lists files, "CAT <name>" dumps one.
// Lets logs be retrieved without pulling the card out of the board.
static void handleSerialCommand()
{
    static char buf[80];
    static size_t n = 0;
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '\n' || c == '\r') {
            if (!n) continue;
            buf[n] = 0;
            n = 0;
            if      (!strncmp(buf, "LS", 2))   storageList();
            else if (!strncmp(buf, "CAT ", 4))  storageCat(buf + 4);
            else if (!strncmp(buf, "REC", 3))  toggleRecording();
            else if (!strncmp(buf, "NERD", 4)) {
                if (!onPick && uiScreen == Screen::Nerd) { onPick = true; Serial.println("screen pick"); }
                else { enterScreen(Screen::Nerd); Serial.println("screen nerd"); }
            }
            else if (!strncmp(buf, "SCAN", 4)) netScan();
            // Rest-of-line, not space-split: SSIDs and passwords contain spaces.
            else if (!strncmp(buf, "SSID ", 5)) {
                netcfgSetSsid(buf + 5);
                Serial.printf("ssid set to [%s]\n", netcfg.ssid.c_str());
            }
            else if (!strncmp(buf, "PASS ", 5)) {
                netcfgSetPass(buf + 5);
                Serial.printf("password set (%d chars)\n", netcfg.pass.length());
            }
            else if (!strncmp(buf, "STATUS", 6)) {
                Serial.printf("device   %s\n", netDeviceId().c_str());
                Serial.printf("server   %s\n", netcfg.baseUrl.c_str());
                Serial.printf("wifi     %s\n", netHasWifi() ? netcfg.ssid.c_str() : "(not configured)");
                Serial.printf("joined   %s\n", netcfg.everConnected ? "yes, previously" : "never");
                Serial.printf("claimed  %s\n", netIsClaimed() ? "yes" : "no");
                Serial.printf("recording %s%s (%lu rows)\n",
                              storageRecording() ? "yes -> " : "no",
                              storageRecording() ? storageFilename() : "",
                              (unsigned long)storageRowCount());
                UplinkStatus us = uplinkGetStatus();
                Serial.printf("sessions %son device %d, uploaded %d, pending %d\n",
                              us.countsValid ? "" : "(not scanned yet) ",
                              us.onDevice, us.uploaded, us.pending);
                const char *scr = !deviceUsable() ? "onboarding"
                    : onPick ? (pickHighlight == Screen::Track ? "pick>track"
                              : pickHighlight == Screen::Sync  ? "pick>sync" : "pick>nerd")
                    : uiScreen == Screen::Track ? "track"
                    : uiScreen == Screen::Sync  ? "sync" : "nerd";
                Serial.printf("screen   %s\n", scr);
                uplinkRequestCounts();   // refresh for the next STATUS
            }
            else if (!strncmp(buf, "SETUP", 5)) {
                if (netStartPortal("Change the WiFi network or password below.")) {
                    Serial.println("saved -- restarting"); delay(300); ESP.restart();
                }
                else Serial.println("setup timed out");
            }
            else if (!strncmp(buf, "SYNC", 4)) {
                String why;
                if (!netConnect(15000, &why)) { Serial.printf("no WiFi: %s\n", why.c_str()); }
                else {
                    if (!netIsClaimed()) {
                        ClaimStatus cs = uplinkClaim();
                        Serial.printf("claim: %s\n", cs.message.c_str());
                    }
                    if (netIsClaimed()) uplinkSyncSessions();
                    netDisconnect();
                }
            }
            else if (!strncmp(buf, "FORGET", 6)) {
                netcfgForget();
                Serial.println("credentials and device token cleared -- restarting");
                delay(300);
                ESP.restart();
            }
            else Serial.printf("<<<ERR>>> unknown command: %s\n", buf);
        } else if (n < sizeof(buf) - 1) {
            buf[n++] = c;
        }
    }
}

void loop()
{
    handleSerialCommand();
    checkButton();
    // Don't touch the IMU while the uplink task holds the shared SPI bus (SD
    // scan/sync/delete) -- concurrent access corrupts both. Only ever set when
    // not recording, so no sample that would be logged is skipped.
    if (!uplinkSdBusy()) imuPoll();

    // Raw motion capture: stream each ~50 Hz IMU sample to the sidecar while
    // recording (the 1 Hz track row keeps only a summary). See
    // docs/motion-capture-spec.md. The loop runs faster than 50 Hz, so the
    // single-slot handoff catches every sample.
    if (storageRecording()) {
        ImuRaw r;
        while (imuTakeRaw(r)) {
            char line[96];
            snprintf(line, sizeof(line), "%lu,%.4f,%.4f,%.4f,%.2f,%.2f,%.2f\n",
                     (unsigned long)r.ms, r.ax, r.ay, r.az, r.gx, r.gy, r.gz);
            storageLogImuRow(line);
        }
    }

    while (SerialGPS.available()) {
        char c = SerialGPS.read();
        gps.encode(c);
#if GPS_ECHO
        Serial.write(c);
#endif
    }

    // Configure the GNSS output set as soon as it starts talking -- sending it
    // during boardInit() is too early and the module ignores it.
    static bool gpsConfigured = false;
    if (!gpsConfigured && gps.charsProcessed() > 100) {
        gpsConfigureOutput();
        gpsConfigured = true;
        Serial.println("GNSS: requested GGA+GSA+GSV+RMC");
    }

    updateSession();

    // Keep the PCF8563 RTC in step with GPS time, once per boot. Filenames take
    // their timestamp straight from GPS, so this is a convenience for a brief fix
    // loss and future uses, not a dependency. The year guard rejects a bogus
    // pre-fix date.
    static bool rtcSynced = false;
    if (!rtcSynced && gps.date.isValid() && gps.time.isValid() && gps.date.year() >= 2025) {
        boardRtcSet(gps.date.year(), gps.date.month(), gps.date.day(),
                    gps.time.hour(), gps.time.minute(), gps.time.second());
        rtcSynced = true;
        Serial.printf("RTC set from GPS: %04d-%02d-%02d %02d:%02d:%02dZ\n",
                      gps.date.year(), gps.date.month(), gps.date.day(),
                      gps.time.hour(), gps.time.minute(), gps.time.second());
    }

    if (millis() - lastTick >= 1000) {
        lastTick = millis();

        // Track is the recording screen: auto-start once a fix is available, so
        // the user never has to press anything to record. Only fires while on
        // Track and idle; a confirmed stop returns to the menu, so it never
        // immediately re-starts. Throttled to this 1 Hz tick. toggleRecording()
        // self-guards on the fix and the SD card.
        if (!onPick && uiScreen == Screen::Track && !storageRecording()
            && gps.location.isValid()) {
            toggleRecording();
        }


        if (gps.location.isValid()) {
            Serial.printf("fix  %.6f, %.6f  alt=%.1fm sats=%u hdop=%.1f\n",
                          gps.location.lat(), gps.location.lng(),
                          gps.altitude.meters(), gps.satellites.value(),
                          gps.hdop.hdop());
        } else {
            Serial.printf("no fix  sats=%u  nmea_chars=%lu  sentences=%lu  err=%lu\n",
                          gps.satellites.isValid() ? gps.satellites.value() : 0,
                          (unsigned long)gps.charsProcessed(),
                          (unsigned long)gps.sentencesWithFix(),
                          (unsigned long)gps.failedChecksum());
        }

        // charsProcessed() stuck at 0 means the UART is silent: check that
        // GPS_EN_PIN is high and that ALDO4 is actually enabled.
        ImuSample motionNow = imuSnapshot();
        if (imuReady()) {
            Serial.printf("  imu |a|max=%.3fg  a=(%.2f,%.2f,%.2f)  "
                          "|g|max=%.1fdps  %.1fC  n=%lu  sd_rows=%lu\n",
                          motionNow.accelMagMax,
                          motionNow.ax, motionNow.ay, motionNow.az,
                          motionNow.gyroMagMax, motionNow.tempC,
                          (unsigned long)motionNow.samples,
                          (unsigned long)storageRowCount());
        }

        if (storageRecording()) {
            char row[320];
            bool haveFix = gps.location.isValid() && gps.date.isValid() && gps.time.isValid();

            // ISO 8601 UTC when the fix is real, empty otherwise. Blank rather
            // than zero matters: 0.0,0.0 is a *valid* coordinate off the coast
            // of Africa, so writing zeros for unfixed rows would inject false
            // points into the track. An empty field is skipped by the parser.
            char iso[24] = "";
            if (haveFix) {
                snprintf(iso, sizeof(iso), "%04d-%02d-%02dT%02d:%02d:%02dZ",
                         gps.date.year(), gps.date.month(), gps.date.day(),
                         gps.time.hour(), gps.time.minute(), gps.time.second());
            }

            char latS[16] = "", lonS[16] = "";
            if (haveFix) {
                snprintf(latS, sizeof(latS), "%.7f", gps.location.lat());
                snprintf(lonS, sizeof(lonS), "%.7f", gps.location.lng());
            }

            snprintf(row, sizeof(row),
                     "%s,%lu,%04d-%02d-%02d,%02d:%02d:%02d,%d,"
                     "%s,%s,%.1f,%.2f,%.1f,%u,%.1f,%u,%u\n",
                     iso, (unsigned long)millis(),
                     gps.date.isValid() ? gps.date.year()  : 0,
                     gps.date.isValid() ? gps.date.month() : 0,
                     gps.date.isValid() ? gps.date.day()   : 0,
                     gps.time.isValid() ? gps.time.hour()   : 0,
                     gps.time.isValid() ? gps.time.minute() : 0,
                     gps.time.isValid() ? gps.time.second() : 0,
                     haveFix ? 1 : 0,
                     latS, lonS,
                     gps.altitude.isValid() ? gps.altitude.meters() : 0.0,
                     gps.speed.isValid()    ? gps.speed.kmph()      : 0.0,
                     gps.course.isValid()   ? gps.course.deg()      : 0.0,
                     gps.satellites.isValid() ? gps.satellites.value() : 0,
                     gps.hdop.isValid() ? gps.hdop.hdop() : 0.0,
                     boardBatteryMv(), txSeq);

            const ImuSample &m = motionNow;
            char motion[128];
            snprintf(motion, sizeof(motion),
                     "%.4f,%.4f,%.4f,%.2f,%.2f,%.2f,%.4f,%.2f,%.1f,%lu\n",
                     m.ax, m.ay, m.az, m.gx, m.gy, m.gz,
                     m.accelMagMax, m.gyroMagMax, m.tempC,
                     (unsigned long)m.samples);

            // Row is GPS fields then motion fields; the trailing newline from
            // the GPS half is replaced by the comma joining the two.
            size_t n = strlen(row);
            if (n && row[n - 1] == '\n') row[n - 1] = ',';
            strlcat(row, motion, sizeof(row));
            storageLogRow(row);
        }

        if (gps.charsProcessed() == 0 && millis() > 10000) {
            Serial.println("  ^ no NMEA at all -- GPS rail or pin mapping problem");
        }
    }

    // Interval AND duty cycle must both allow it; the duty guard wins.
    // Redrawn at 4 Hz so the blinking satellite and the pulsing REC dot actually
    // blink. At the 1 Hz logging rate they aliased into looking static.
    if (millis() - lastDraw >= 250) {
        lastDraw = millis();
        UplinkStatus up = uplinkGetStatus();

        UiState u;
        u.linked      = netIsClaimed();
        // Onboarding is forced until usable; then Pick, then the entered screen.
        u.state       = !netHasWifi()   ? AppState::Setup
                      : !netIsClaimed()  ? AppState::Linking
                      : confirmDelete    ? AppState::DeleteConfirm
                      : onPick           ? AppState::Pick
                      : uiScreen == Screen::Sync ? AppState::Sync
                      : uiScreen == Screen::Nerd ? AppState::Nerd
                                                 : AppState::Track;
        u.pickSel     = pickHighlight == Screen::Track ? 0
                      : pickHighlight == Screen::Sync  ? 1 : 2;
        u.stopArmed   = stopArmed;
        u.countsValid = up.countsValid;
        u.onDevice    = up.onDevice;
        u.uploaded    = up.uploaded;
        u.pending     = up.pending;
        u.syncing     = up.busy;
        u.claimCode   = up.claimCode;
        u.wifiUp      = up.wifiUp;
        u.ssid        = netcfg.ssid;
        u.ip          = WiFi.localIP().toString();
        u.hdop        = gps.hdop.isValid() ? gps.hdop.hdop() : 0;
        u.txOk        = txOkCount;
        u.txFail      = txFailCount;
        u.fileName    = storageRecording() ? storageFilename() : "";
        u.battVolts   = boardBatteryVoltage();
        u.freeHeap    = ESP.getFreeHeap();
        u.toast       = toastText;
        u.toastUntilMs= toastUntil;
        u.linkTitle   = linkTitle;
        u.linkHint    = linkHint;
        u.deviceId    = netDeviceId();
        u.sdReady     = board.sdcard;
        u.recording   = storageRecording();
        u.rows        = storageRowCount();
        u.fix         = gps.location.isValid();
        u.sats        = gps.satellites.isValid() ? gps.satellites.value() : 0;
        u.searchSecs  = millis() / 1000;
        u.speedKmh    = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
        u.distanceM   = sessionMetres;
        u.sessionSecs = firstFixMs ? (millis() - firstFixMs) / 1000 : 0;
        u.batteryPct  = boardBatteryPercent();
        u.charging    = boardIsCharging();
        uiDraw(u);
    }

    // Only transmit while recording: an idle device on a shelf has nothing worth
    // saying, and every transmission spends duty-cycle budget and battery.
    bool intervalElapsed = (lastTxMs == 0) || (millis() - lastTxMs >= TX_INTERVAL_S * 1000UL);
    if (storageRecording() && board.radio && intervalElapsed && duty.canTransmit()) {
        transmitPosition();
    }
}
