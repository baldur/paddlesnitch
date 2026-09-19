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
#include "spibus.h"
#include "dbg.h"
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
// Chooser row for a screen. One mapping, used by both the draw and the selection
// blink: (int)Screen happens to match the menu order today, and relying on that
// would break silently the first time the enum is reordered.
static const char *resetReasonStr()
{
    switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "poweron";
    case ESP_RST_SW:       return "sw";
    case ESP_RST_PANIC:    return "PANIC";
    case ESP_RST_INT_WDT:  return "int-wdt";
    case ESP_RST_TASK_WDT: return "TASK-WDT";
    case ESP_RST_WDT:      return "wdt";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_EXT:      return "ext";
    case ESP_RST_DEEPSLEEP:return "deepsleep";
    default:               return "unknown";
    }
}

static int pickIndex(Screen s) { return s == Screen::Track ? 0 : s == Screen::Sync ? 1 : 2; }
static bool     onPick        = true;            // showing the chooser
static Screen   pickHighlight = Screen::Track;   // highlighted option on Pick
static Screen   uiScreen      = Screen::Track;   // the entered screen
static int      nerdPage      = 0;              // diagnostics page, 0..NERD_PAGES-1
static const int NERD_PAGES   = 3;
// Sync is paged for the same reason Nerd is, but the motive is safety as much as
// space: deleting every uploaded file used to be a hold on the status page, so
// "hold = do the thing on this screen" and "hold = wipe the card" were the same
// gesture in the same place. Cleanup now lives on its own page you have to tap to.
static int      syncPage      = 0;
static const int SYNC_PAGES   = 2;             // 0 status, 1 cleanup
static bool     confirmDelete = false;
static uint32_t confirmUntil  = 0;
// Track auto-records on entry (once there's a fix); stopping is a deliberate
// hold -> double-tap, so stopArmed gates the confirm the way confirmDelete does.
static bool     stopArmed     = false;
static uint32_t stopArmUntil  = 0;
static uint8_t  speedUnit     = 0;   // Track readout: 0 km/h, 1 m/s, 2 pace/500m
static String   toastText;
static uint32_t toastUntil    = 0;

static void toast(const char *t, uint32_t ms = 1500)
{
    toastText = t;
    toastUntil = millis() + ms;
}

static String linkTitle = "Not linked";
static String linkHint  = "Hold BOOT";
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

    // Both before any subsystem starts: the bus mutex must exist before the
    // first SD or IMU access, and the recorder must exist to catch bring-up,
    // which is where several of the hard faults have shown themselves.
    spiBusInit();
    dbgInit();
    Serial.printf("\n=== T-Beam S3 Supreme bring-up (fw %s) ===\n", FIRMWARE_VERSION);
    DBGI("boot", "fw %s, reset=%s", FIRMWARE_VERSION, resetReasonStr());
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
    DBGI("imu", "init %s", imuOk ? "ok" : "FAILED");
    report("IMU", imuOk, imuOk ? "QMI8658 accel+gyro" : "init failed");
    // imuInit may have power-cycled the sensor rails (up to three times) to
    // recover a wedged chip, which leaves the OLED dark for the rest of the run.
    boardDisplayReinit();

    board.sdcard = storageInit();
    DBGI("sd", "init %s", board.sdcard ? "ok" : "FAILED");
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

// Hold the BOOT button (HOLD_MS) to reopen the setup portal. Without this, a
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
        linkHint  = "Hold BOOT";
        netBringUp();                       // opens the portal itself
        return;
    }
    if (!netBringUp()) {
        linkTitle = "No WiFi";
        linkHint  = "Hold BOOT to fix";
        return;
    }
    if (!netIsClaimed()) {
        ClaimStatus cs = uplinkClaim();
        if (cs.state != ClaimState::Claimed) {
            Serial.printf("claim: %s\n", cs.message.c_str());
            linkTitle = "Not linked";
            linkHint  = "Hold BOOT to retry";
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
    if (s == Screen::Nerd) nerdPage = 0;                    // always start at page 1
    if (s == Screen::Sync) syncPage = 0;                    // never open on cleanup
    if (s == Screen::Sync) uplinkRequestCounts();           // refresh on entry
    // Track is the recording screen: it auto-starts once a fix is available
    // (handled in loop()), so there is no "press to record".
}

// The one free button (RST is the AXP2101 power key), three gestures, and ONE
// meaning for each of them on every screen:
//
//   tap        -> move / cycle within this screen. Never acts, never destroys.
//   hold       -> select, or commit this screen's primary action.
//   double-tap -> back to the chooser. ALWAYS, from anywhere, including out of a
//                 confirmation, which it cancels on the way.
//
// A confirmation is the single place tap commits, and it says so on the panel.
// Before this, tap meant "sync now" on Sync and "cycle a unit" on Track, paging
// was on double-tap, and the two confirmations disagreed with each other about
// which gesture meant yes -- so the button had to be relearned per screen and
// the only gesture you could rely on to get out was a guess.
// See docs/device-states-spec.md.
static void screenTap()
{
    if (confirmDelete) {                       // confirmation: tap = yes
        confirmDelete = false;
        uplinkRequestDeleteUploaded();
        toast("DELETING");
        return;
    }
    if (stopArmed) {                           // Track's stop confirmation
        stopArmed = false;
        if (storageRecording()) toggleRecording();     // stop + trigger a sync
        return;
    }
    if (!deviceUsable()) return;               // onboarding: tap does nothing
    if (onPick) {                              // move the highlight
        pickHighlight = pickHighlight == Screen::Track ? Screen::Sync
                      : pickHighlight == Screen::Sync  ? Screen::Nerd
                                                       : Screen::Track;
        return;
    }
    // Every one of these wraps. Cycling is only safe to hand to a single button
    // if you can always get back round to where you were without a second one.
    switch (uiScreen) {
    case Screen::Track: speedUnit = (speedUnit + 1) % 3; break;   // km/h -> m/s -> pace
    case Screen::Sync:  syncPage  = (syncPage  + 1) % SYNC_PAGES; break;
    case Screen::Nerd:  nerdPage  = (nerdPage  + 1) % NERD_PAGES; break;
    }
}

static void screenDoubleTap()
{
    // No exceptions, no "unless" -- that is the entire value of the gesture. A
    // pending confirmation is cancelled rather than carried back to the chooser,
    // so leaving a screen can never be the thing that stops a recording or wipes
    // the card.
    confirmDelete = false;
    stopArmed     = false;
    if (!deviceUsable()) return;
    if (onPick) return;                        // already there
    onPick = true;
    pickHighlight = uiScreen;
}

static void screenHold()
{
    if (confirmDelete || stopArmed) return;    // a confirmation answers to tap
    if (!deviceUsable()) { linkAttempt(); return; }        // onboarding: WiFi/link
    // Blink the chosen row first: the hold fires while still held, so without an
    // acknowledgement a successful press and a too-short one look the same.
    if (onPick) { uiPickFlash(pickIndex(pickHighlight)); enterScreen(pickHighlight); return; }
    switch (uiScreen) {
    case Screen::Track:
        // Recording starts itself on a fix, so stopping is the only thing here.
        if (storageRecording()) { stopArmed = true; stopArmUntil = millis() + 10000; }
        break;
    case Screen::Sync:
        if (syncPage == 0) { uplinkRequestSync(); toast("SYNCING"); }
        else               { confirmDelete = true; confirmUntil = millis() + 10000; }
        break;
    case Screen::Nerd:
        // Only the radio page has an action, and it is the page already showing
        // UNLINKED / the SSID -- which is what you are looking at when re-linking
        // is what you came for.
        if (nerdPage == NERD_PAGES - 1) linkAttempt();
        break;
    }
}

// A single tap is only confirmed once the double-tap window closes, so the action
// fires ~400 ms after release. Invisible next to a 1 Hz log rate.
static const uint32_t DOUBLE_TAP_MS = 400;
// How long a hold has to be held. Named, because the on-screen hints and two
// specs used to repeat "3 s" as a literal and drifted the moment it changed.
//
// 1200 ms, down from 3000. Three seconds is a long time to stand on a button and
// made every hold feel like the device had missed the press. It can be this short
// because a hold fires WHILE HELD, not on release: the screen changes under your
// thumb, so you hold until it reacts rather than counting. The destructive actions
// behind a hold (stop recording, delete uploaded) are each confirmed on a second
// screen anyway, so the hold itself does not need to be the safety.
static const uint32_t HOLD_MS = 1200;

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
    } else if (down && !longFired && millis() - heldSince > HOLD_MS) {
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
                uint32_t kept, lost, bytes;
                dbgStats(kept, lost, bytes);
                Serial.printf("debug    %lu entries (%lu overwritten, %luKB ring) -- DBG to dump\n",
                              (unsigned long)kept, (unsigned long)lost, (unsigned long)(bytes / 1024));
                Serial.printf("spibus   %lu imu skips, %lu take timeouts\n",
                              (unsigned long)spiBusSkips(), (unsigned long)spiBusTimeouts());
                uplinkRequestCounts();   // refresh for the next STATUS
            }
            // DBG dumps the flight recorder; DBG CLEAR empties it. The point of
            // the recorder is that this works AFTER the interesting thing has
            // happened -- no reflash, no waiting for the fault to recur.
            else if (!strncmp(buf, "DBG", 3)) {
                if (!strncmp(buf + 3, " CLEAR", 6)) { dbgClear(); Serial.println("dbg cleared"); }
                else dbgDump(Serial);
            }
            else if (!strncmp(buf, "SETUP", 5)) {
                if (netStartPortal("Change the WiFi network or password below.")) {
                    Serial.println("saved -- restarting"); delay(300); ESP.restart();
                }
                else Serial.println("setup timed out");
            }
            // SDPROBE <file> — read a file to completion in 64 KB chunks and
            // report throughput and any stall, with the radio in three different
            // states. The open question is whether SD reads fail because WiFi is
            // ASSOCIATED or because TLS is IN FLIGHT, and nothing so far
            // separates those: every failure has been observed mid-upload.
            else if (!strncmp(buf, "SDPROBE ", 8)) {
                const char *fn = buf + 8;
                for (int phase = 0; phase < 2; phase++) {
                    if (phase == 0) { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); delay(300); }
                    else            { String why; netConnect(15000, &why); }
                    size_t bytes = 0; uint32_t ms = 0;
                    bool okRead = storageProbeRead(fn, &bytes, &ms);
                    Serial.printf("SDPROBE wifi=%s: %u bytes in %lums (%lu KB/s)  %s\n",
                                  phase == 0 ? "OFF" : "ON", (unsigned)bytes, (unsigned long)ms,
                                  (unsigned long)(ms ? bytes / ms : 0),
                                  okRead ? "complete" : "STALLED");
                }
            }
            else if (!strncmp(buf, "SYNC", 4)) {
                // ASKS the uplink task to sync; never syncs on this core. The task
                // (core 0) is the single owner of the SD card and raises
                // uplinkSdBusy() around its work. Calling uplinkSyncSessions()
                // straight from here put core 1 on the card while the task's own
                // scheduled sync could be on it from core 0 — which produces the
                // sdCommand CRC/token storm that leaves the card unreadable until
                // a power cycle. Harmless while a sync meant a few hundred KB of
                // track files; a motion sidecar reads megabytes and writes a temp
                // file, so the overlap became easy to hit.
                uplinkRequestSync();
                Serial.println("sync requested -- watch for progress on the Sync screen");
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
    // No flag check any more. imuPoll() takes the SPI bus itself and skips the
    // sample if the card has it -- which is the only way to close the window
    // where this check passed and the uplink task grabbed the card a microsecond
    // later. It also means the IMU keeps sampling through the HTTP half of a
    // sync, instead of going silent for the whole thing.
    imuPoll();

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
        u.pickSel     = pickIndex(pickHighlight);
        u.nerdPage    = nerdPage;
        u.nerdPages   = NERD_PAGES;
        u.syncPage    = syncPage;
        u.syncPages   = SYNC_PAGES;
        u.onUsb       = boardOnUsb();
        u.uptimeS     = millis() / 1000;
        u.heapMin     = ESP.getMinFreeHeap();
        u.psramFree   = ESP.getFreePsram();
        u.fwVersion   = FIRMWARE_VERSION;
        u.resetReason = resetReasonStr();
        u.rssi        = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
        u.serverHost  = netcfg.baseUrl;
        u.sdSizeMB    = storageCardSizeMB();
        u.imuOk       = imuReady();
        {
            ImuSample m = imuSnapshot();
            u.imuTempC   = m.tempC;
            u.imuSamples = m.samples;
        }
        u.stopArmed   = stopArmed;
        u.speedUnit   = speedUnit;
        u.strokeRateSpm = -1;          // on-device stroke-rate derivation is TBD
        u.countsValid = up.countsValid;
        u.onDevice    = up.onDevice;
        u.uploaded    = up.uploaded;
        u.pending     = up.pending;
        u.syncing     = up.busy;
        u.upFile      = up.upFile;
        u.upPart      = up.upPart;
        u.upParts     = up.upParts;
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
