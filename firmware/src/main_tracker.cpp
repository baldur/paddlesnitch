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
#include <esp_ota_ops.h>
#include "qr.h"
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
enum class Screen { Track, Sync, Nerd, Network };

// Two menus, not one. Nerd mode and Network live under Settings so the top
// level stays the three things you touch on the water; the diagnostics are one
// hold further in, which is the right way round.
//
//   Pick      Track | Sync | Settings
//   Settings  Nerd mode | Network
//
// DOUBLE-TAP GOES UP ONE LEVEL, not straight to the top. The contract is "it
// always takes you back", and with a nested menu "back" is the parent: a screen
// returns to the menu that opened it, and Settings returns to Pick. Two
// double-taps reach the top from anywhere, and nothing is ever a dead end.
enum class Menu { None, Pick, Settings };
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

// Which menu a screen belongs to, so a double-tap returns to the one that
// opened it rather than always to the top.
static Menu parentOf(Screen s)
{
    return (s == Screen::Track || s == Screen::Sync) ? Menu::Pick : Menu::Settings;
}
static int  menuCount(Menu m) { return m == Menu::Settings ? 2 : 3; }

static Menu     menu     = Menu::Pick;     // None = a screen is showing
static int      menuSel  = 0;              // highlighted row of `menu`
static Screen   uiScreen      = Screen::Track;   // the entered screen
// Seven taps inside RESET_TAP_WINDOW arms a factory reset. Seven because the
// button already means "cycle" on every screen, so the count has to be high
// enough that nobody reaches it while flicking through pages -- and the reset
// is still gated behind a confirmation after that.
static const int      RESET_TAPS       = 7;
static const uint32_t RESET_TAP_WINDOW = 3000;
static int      resetTaps     = 0;
static uint32_t resetTapFirst = 0;
static bool     confirmReset  = false;
static uint32_t resetUntil    = 0;
static int      linkPage      = 0;      // Linking screen: 0 QR, 1 characters
static bool     qrTestHold    = false;   // QRTEST owns the panel until any other command
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

// Reads MISO as a plain GPIO under an internal pull-up and then a pull-down.
// A free line follows the pull (1 then 0); a driven line -- OR a line with an
// external pull-up resistor stronger than the ESP32's ~45k internal pull-down
// -- reads the same under both. That ambiguity is exactly why this is sampled
// at three points during bring-up rather than once: if MISO already reads
// "driven" BEFORE either chip is initialised, it is a board pull-up and means
// nothing. If it goes from free to driven at imuInit, the sensor is holding it;
// at storageInit, the card is.
static void misoCheck(const char *when)
{
    pinMode(SPI_MISO, INPUT_PULLUP);
    delayMicroseconds(200);
    int hi = digitalRead(SPI_MISO);
    pinMode(SPI_MISO, INPUT_PULLDOWN);
    delayMicroseconds(200);
    int lo = digitalRead(SPI_MISO);
    // Hand the pad back to the SPI peripheral rather than leaving it a bare
    // INPUT. This is a PR about not disturbing the bus.
    sdSPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, -1);
    const char *verdict = (hi == 1 && lo == 0) ? "free" : "driven/pulled";
    Serial.printf("MISO @%-16s pullup=%d pulldown=%d -> %s\n", when, hi, lo, verdict);
    DBGI("miso", "%s pu=%d pd=%d %s", when, hi, lo, verdict);
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
    // Prove the OTA layout rather than assert it. The previous table declared
    // otadata and typed app0 as ota_0 but had no app1, so this line would have
    // printed "OTA: NOT POSSIBLE" -- which is the whole reason it exists.
    {
        const esp_partition_t *run  = esp_ota_get_running_partition();
        const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
        Serial.printf("  OTA      [%s] running=%s  target=%s (%luKB/slot)\n",
                      next ? " ok " : "FAIL",
                      run  ? run->label  : "?",
                      next ? next->label : "none -- no second app slot",
                      (unsigned long)((run ? run->size : 0) / 1024));
        DBGI("boot", "ota run=%s next=%s", run ? run->label : "?",
             next ? next->label : "NONE");
    }
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
    //
    // ALSO when credentials exist but have NEVER worked. netBringUp() already
    // reopens the portal in that case and says why -- but it was only called
    // when there were no credentials at all, so a device saved with a wrong
    // password never reached that path. It sat on the claim screen retrying an
    // association that could not succeed, with no route back to setup except
    // knowing to hold on Settings > Network. A password that has never once
    // worked is not a flaky router, it is wrong, and the answer is the portal
    // and its join QR.
    //
    // Deliberately NOT on every failure: once these credentials HAVE worked,
    // a failure means the device is away from home, and hijacking it into
    // setup mode when it should be out tracking would be worse than useless.
    if (!netHasWifi() || !netcfg.everConnected) netBringUp();

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
    menu     = Menu::None;
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
    if (confirmReset) {                        // confirmation: tap = yes
        confirmReset = false;
        Serial.println("factory reset -- clearing credentials and token");
        netcfgForget();
        delay(300);
        ESP.restart();
        return;
    }
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
    // Onboarding: tap flips the Linking screen between the QR and the
    // characters. Tap means "cycle what is on this screen" everywhere else, and
    // this screen has exactly two things to show.
    if (!deviceUsable()) { linkPage ^= 1; return; }
    if (menu != Menu::None) {                  // move the highlight, wrapping
        menuSel = (menuSel + 1) % menuCount(menu);
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

// Counts taps towards the reset gesture. Called for every recognised tap,
// whatever else that tap did -- the count runs alongside the normal meaning
// rather than replacing it, so nothing has to be given up to make room for it.
static void noteTapForReset()
{
    const uint32_t now = millis();
    if (!resetTaps || now - resetTapFirst > RESET_TAP_WINDOW) {
        resetTaps = 1;
        resetTapFirst = now;
        return;
    }
    if (++resetTaps < RESET_TAPS) return;
    resetTaps = 0;
    confirmReset = true;
    resetUntil = now + 10000;
    Serial.println("btn: seven taps -- factory reset armed (tap = yes, 2x = no)");
}

static void screenDoubleTap()
{
    if (confirmReset) { confirmReset = false; return; }   // 2x = no
    // No exceptions, no "unless" -- that is the entire value of the gesture. A
    // pending confirmation is cancelled rather than carried back to the chooser,
    // so leaving a screen can never be the thing that stops a recording or wipes
    // the card.
    confirmDelete = false;
    stopArmed     = false;
    if (!deviceUsable()) return;
    // Up ONE level. From a screen, back to the menu that opened it; from
    // Settings, back to Pick; at Pick there is nowhere above.
    if (menu == Menu::Settings) { menu = Menu::Pick; menuSel = 2; return; }
    if (menu == Menu::Pick)     return;
    const Menu parent = parentOf(uiScreen);
    menu    = parent;
    menuSel = parent == Menu::Settings ? (uiScreen == Screen::Nerd ? 0 : 1)
                                       : (uiScreen == Screen::Track ? 0 : 1);
}

static void screenHold()
{
    if (confirmDelete || stopArmed || confirmReset) return;   // confirmations answer to tap
    if (!deviceUsable()) { linkAttempt(); return; }        // onboarding: WiFi/link
    // Blink the chosen row first: the hold fires while still held, so without an
    // acknowledgement a successful press and a too-short one look the same.
    if (menu != Menu::None) {
        uiPickFlash(menuSel, menu == Menu::Settings);
        if (menu == Menu::Pick) {
            // Row 2 is Settings, which is a MENU, not a screen -- so it opens a
            // menu rather than going through enterScreen().
            if (menuSel == 2) { menu = Menu::Settings; menuSel = 0; return; }
            enterScreen(menuSel == 0 ? Screen::Track : Screen::Sync);
        } else {
            enterScreen(menuSel == 0 ? Screen::Nerd : Screen::Network);
        }
        return;
    }
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
    case Screen::Network:
        // The portal. A hold, not a tap, because opening it drops the current
        // connection -- and because hold is what commits on every other screen.
        if (netStartPortal("Change the WiFi network or password below.")) {
            Serial.println("saved -- restarting"); delay(300); ESP.restart();
        }
        toast("NO CHANGE");
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
    if (confirmReset  && millis() > resetUntil)   confirmReset  = false;
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

        // Counted on the RAW RELEASE, before tap/double-tap interpretation.
        // Seven quick presses are read as three double-taps and a tap, so
        // counting dispatched taps would never reach seven however fast you
        // pressed. The press is the thing the user is doing; what it also
        // means on this screen is irrelevant to the count.
        noteTapForReset();
        // PICK ONLY. A tap acts immediately here because Pick is the top level
        // and has no double-tap action, so waiting out the window would just
        // make it feel dead.
        //
        // Settings must NOT take this path. It DOES have a double-tap action
        // (go up to Pick), and acting immediately consumed both taps as
        // highlight moves, so the gesture could never fire and there was no way
        // out of Settings with the button at all. An earlier version of this
        // comment argued a consistent menu feel was worth the 400 ms; that was
        // wrong -- it did not delay the gesture, it removed it.
        if (menu == Menu::Pick) {
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
            // Any command other than QRTEST hands the panel back to the UI.
            if (strncmp(buf, "QRTEST", 6) != 0) qrTestHold = false;
            if      (!strncmp(buf, "LS", 2))   storageList();
            else if (!strncmp(buf, "CAT ", 4))  storageCat(buf + 4);
            else if (!strncmp(buf, "REC", 3))  toggleRecording();
            else if (!strncmp(buf, "NERD", 4)) {
                if (menu == Menu::None && uiScreen == Screen::Nerd) { menu = Menu::Settings; menuSel = 0; Serial.println("screen settings"); }
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
                    : menu == Menu::Pick     ? (menuSel == 0 ? "pick>track" : menuSel == 1 ? "pick>sync" : "pick>settings")
                    : menu == Menu::Settings ? (menuSel == 0 ? "settings>nerd" : "settings>network")
                    : uiScreen == Screen::Track ? "track"
                    : uiScreen == Screen::Sync  ? "sync" : "nerd";
                Serial.printf("screen   %s\n", scr);
                uint32_t kept, lost, bytes;
                dbgStats(kept, lost, bytes);
                Serial.printf("debug    %lu entries (%lu overwritten, %luKB ring) -- DBG to dump\n",
                              (unsigned long)kept, (unsigned long)lost, (unsigned long)(bytes / 1024));
                {
                    const esp_partition_t *run  = esp_ota_get_running_partition();
                    const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
                    Serial.printf("ota      running=%s %luKB  target=%s  -> %s\n",
                                  run  ? run->label  : "?",
                                  (unsigned long)((run ? run->size : 0) / 1024),
                                  next ? next->label : "none",
                                  next ? "OTA possible" : "OTA IMPOSSIBLE (no second app slot)");
                }
                Serial.printf("spibus   %lu imu skips, %lu take timeouts, %lu UNGUARDED\n",
                              (unsigned long)spiBusSkips(), (unsigned long)spiBusTimeouts(),
                              (unsigned long)spiBusUnguarded());
                uplinkRequestCounts();   // refresh for the next STATUS
            }
            // DBG dumps the flight recorder; DBG CLEAR empties it. The point of
            // the recorder is that this works AFTER the interesting thing has
            // happened -- no reflash, no waiting for the fault to recur.
            // HOLD makes the uploader let go of the card so LS/CAT/SDPROBE can
            // have it; RESUME gives it back. Without this, an uploader stuck
            // retrying a failing card starves every diagnostic that could say
            // why -- exactly the hole this fell into on 19 Sep, when CAT could
            // not read a file the uploader had already failed to send.
            // HELP. Eighteen commands with no way to list them is its own bug.
            // Not a command table -- CLAUDE.md favours flatness and warns off
            // speculative abstraction, and the strncmp chain has no live prefix
            // collision (checked: "SDPROBE " carries a trailing space, so
            // SDPROBE0 falls through correctly). This is the cheap half.
            else if (!strncmp(buf, "HELP", 4) || buf[0] == '?') {
                Serial.println(F(
                    "STATUS            state, counts, spibus + debug-ring stats\n"
                    "SETUP / SCAN      captive portal / list WiFi networks\n"
                    "SSID <n>          rest of line is the name (may contain spaces)\n"
                    "PASS <s>          rest of line is the secret\n"
                    "UNLINK            clear the device token only (keeps WiFi), then re-claim\n"
                    "FORGET            clear WiFi credentials AND the token\n"
                    "SYNC              ask the uplink task to sync now\n"
                    "HOLD / RESUME     take the SD card off the uploader / give it back\n"
                    "LS                list files on the card\n"
                    "CAT <f>           dump a file (framed <<<CAT>>> .. <<<END>>>)\n"
                    "SDPROBE <f>       read a file on CORE 1, radio off then on\n"
                    "SDPROBE0 <f>      the same read on CORE 0 (the uplink task)\n"
                    "DBG [CLEAR]       dump / clear the flight recorder\n"
                    "MISOSCAN          who holds MISO: cycles the sensor + card rails\n"
                    "MISOTEST          is MISO driven right now?\n"
                    "MISOCLOCK         retest after one 0xFF release byte\n"
                    "MISORELEASE       sweep 1..64 release bytes\n"
                    "QRDUMP <text>     print a QR module grid (checks for inversion)\n"
                    "\n"
                    "On the device: SEVEN taps in 3s arms a factory reset (tap=yes 2x=no).\n"));
            }
            else if (!strncmp(buf, "HOLD", 4)) {
                Serial.println(uplinkYieldCard(5000) ? "uploader released the card"
                                                     : "uploader did not let go in 5s");
            }
            else if (!strncmp(buf, "RESUME", 6)) {
                uplinkResume();
                Serial.println("uploader resumed");
            }
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
            // SDPROBE0 <file> — the same probe, but run BY THE UPLINK TASK.
            // This is the control for the one thing measured and not explained:
            // core 1 reads a file at 429 KB/s that core 0 cannot read at all.
            // MISOTEST — is anything still driving MISO with every CS high?
            //
            // Park both chip selects, then read MISO as a plain GPIO with the
            // internal pull-up and again with the pull-down. A properly
            // tri-stated line FOLLOWS the pull (reads 1 then 0). A line someone
            // is still driving reads the SAME under both. Run after an SD access
            // and after an IMU access to see which device, if either, holds on.
            //
            // Worth knowing before blaming the sensor: SD cards in SPI mode are
            // documented NOT to release DO when CS goes high -- they need eight
            // further clocks first -- and Arduino SD.h does not reliably issue
            // them. So the card is at least as likely to be the one holding the
            // line during an IMU read.
            else if (!strncmp(buf, "MISOTEST", 8)) {
                SpiBusGuard bus(3000);
                if (!bus) { Serial.println("MISOTEST: bus busy"); }
                else {
                    digitalWrite(SPI_CS, HIGH);
                    digitalWrite(IMU_CS, HIGH);
                    delayMicroseconds(50);
                    pinMode(SPI_MISO, INPUT_PULLUP);
                    delayMicroseconds(200);
                    int hi = digitalRead(SPI_MISO);
                    pinMode(SPI_MISO, INPUT_PULLDOWN);
                    delayMicroseconds(200);
                    int lo = digitalRead(SPI_MISO);
                    pinMode(SPI_MISO, INPUT);
                    Serial.printf("MISOTEST pullup=%d pulldown=%d -> %s\n", hi, lo,
                                  (hi == 1 && lo == 0) ? "tri-stated (line is free)"
                                                       : "DRIVEN (something is holding MISO)");
                    DBGI("miso", "pullup=%d pulldown=%d %s", hi, lo,
                         (hi == 1 && lo == 0) ? "free" : "DRIVEN");
                }
            }
            // MISOCLOCK — the mitigation for the SD-holds-DO case: raise CS and
            // clock out one 0xFF byte, then retest. If MISO frees only after
            // this, the card was the one holding the line and every handover
            // needs the same eight clocks.
            // MISORELEASE — how many dummy bytes, if any, make the card let go.
            // FatFs deselect() sends exactly one; if that is not enough here,
            // the question is whether N is merely larger or whether this card
            // never releases, which decides if a software mitigation exists.
            // MISOSCAN — powers each chip separately and reports who holds MISO.
            // A COMMAND, not boot code: it cycles the sensor and card rails, and
            // a PR about not disturbing the bus has no business doing that on
            // every boot. Re-mounts the card afterwards.
            //
            // Reading it: "rails-off free" means there is no board pull-up, so
            // the method works at all. Then whichever single rail turns the line
            // to "driven/pulled" is the chip presenting something -- though note
            // an internal pull-up on the card's DO reads identically to the card
            // actively driving, and the ESP32's ~45k internal pull-down is too
            // weak to separate those. Distinguishing them needs a scope or a
            // stronger external pull-down.
            // QRDUMP <text> — the module grid over serial. The panel is 58 px
            // square; you cannot tell an inverted or over-sized code from a
            // photograph of it, and you can from this.
            // QRTEST [INV] — draw the REAL join QR full-screen so it can be
            // scan-tested without opening the portal (which drops WiFi).
            // INV draws light-on-dark: fewer emitting pixels, which is the
            // lever when a phone camera is banding on the panel refresh.
            // Any other key returns to the normal UI.
            else if (!strncmp(buf, "QRTEST", 6)) {
                qrTestHold = true;
                const bool inv = strstr(buf, "INV") != nullptr;
                // The REAL credentials, not a plausible-looking fake. The first
                // version of this encoded "testpass", so a phone that read the
                // code perfectly still could not join anything.
                const String pay = "WIFI:S:" + netApSsid() + ";T:WPA;P:" + netApPass() + ";;";
                display.clearBuffer();
                if (qrDraw(pay.c_str(), (128 - qrSizePx()) / 2, (64 - qrSizePx()) / 2, inv)) {
                    display.sendBuffer();
                    Serial.printf("QRTEST %s: %s (%u bytes) -- centred, %dpx.\n",
                                  inv ? "INVERTED" : "normal", pay.c_str(),
                                  (unsigned)pay.length(), qrSizePx());
                    // Say it plainly, because the failure is silent and looks
                    // like the QR not working: the phone reads the code, hunts
                    // for a network that is not on the air, and gives up
                    // without saying anything.
                    if (!netApActive()) {
                        Serial.println("  NOTE: the AP is NOT broadcasting. This tests whether the");
                        Serial.println("  code READS, nothing more -- scanning it will appear to do");
                        Serial.println("  nothing. For an end-to-end join, open the portal instead:");
                        Serial.println("  SETUP, or on the device Settings > Network > hold.");
                    }
                    Serial.println("  Any other command restores the UI.");
                } else {
                    Serial.printf("QRTEST: payload %u bytes, too long\n", (unsigned)pay.length());
                }
            }
            else if (!strncmp(buf, "QRDUMP ", 7)) {
                qrDumpSerial(buf + 7);
            }
            else if (!strncmp(buf, "MISOSCAN", 8)) {
                SpiBusGuard bus(5000);
                if (!bus) { Serial.println("MISOSCAN: bus busy"); }
                else {
                    storageClose();
                    digitalWrite(IMU_CS, HIGH); digitalWrite(SPI_CS, HIGH);
                    PMU.disableALDO1(); PMU.disableALDO2(); PMU.disableBLDO1();
                    delay(250); misoCheck("rails-off");
                    PMU.enableALDO1(); PMU.enableALDO2();
                    delay(250); misoCheck("imu-only");
                    PMU.disableALDO1(); PMU.disableALDO2();
                    delay(150);
                    PMU.enableBLDO1();
                    delay(250); misoCheck("sd-only");
                    PMU.enableALDO1(); PMU.enableALDO2();
                    delay(300); misoCheck("both-rails");
                    Serial.println("MISOSCAN: remounting card + IMU");
                }
                imuInit();
                storageInit();
            }
            else if (!strncmp(buf, "MISORELEASE", 11)) {
                SpiBusGuard bus(3000);
                if (!bus) { Serial.println("MISORELEASE: bus busy"); }
                else {
                    digitalWrite(SPI_CS, HIGH);
                    digitalWrite(IMU_CS, HIGH);
                    sdSPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
                    for (int n = 1; n <= 64; n++) {
                        sdSPI.transfer(0xFF);
                        if (n != 1 && n != 2 && n != 4 && n != 8 && n != 16 && n != 32 && n != 64) continue;
                        sdSPI.endTransaction();
                        pinMode(SPI_MISO, INPUT_PULLDOWN);
                        delayMicroseconds(200);
                        int lo = digitalRead(SPI_MISO);
                        sdSPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, -1);
                        Serial.printf("MISORELEASE after %2d byte(s): pulldown=%d %s\n",
                                      n, lo, lo == 0 ? "<-- RELEASED" : "still driven");
                        if (lo == 0) break;
                        sdSPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
                    }
                    sdSPI.endTransaction();
                }
            }
            else if (!strncmp(buf, "MISOCLOCK", 9)) {
                SpiBusGuard bus(3000);
                if (!bus) { Serial.println("MISOCLOCK: bus busy"); }
                else {
                    digitalWrite(SPI_CS, HIGH);
                    digitalWrite(IMU_CS, HIGH);
                    sdSPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
                    sdSPI.transfer(0xFF);          // the eight release clocks
                    sdSPI.endTransaction();
                    delayMicroseconds(50);
                    pinMode(SPI_MISO, INPUT_PULLUP);
                    delayMicroseconds(200);
                    int hi = digitalRead(SPI_MISO);
                    pinMode(SPI_MISO, INPUT_PULLDOWN);
                    delayMicroseconds(200);
                    int lo = digitalRead(SPI_MISO);
                    pinMode(SPI_MISO, INPUT);
                    Serial.printf("MISOCLOCK pullup=%d pulldown=%d -> %s\n", hi, lo,
                                  (hi == 1 && lo == 0) ? "freed by the release clocks"
                                                       : "STILL DRIVEN");
                    DBGI("miso", "after 0xFF: pullup=%d pulldown=%d %s", hi, lo,
                         (hi == 1 && lo == 0) ? "freed" : "still driven");
                }
            }
            else if (!strncmp(buf, "SDPROBE0 ", 9)) {
                uplinkRequestProbe(buf + 9);
                Serial.println("queued a core-0 probe; watch for SDPROBE0 lines");
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
            // UNLINK clears ONLY the device token and claim secret, so the
            // device re-claims on the next sync while keeping its WiFi. FORGET
            // wipes everything including credentials, which means redoing the
            // portal just to exercise the claim screen -- too blunt for
            // testing, and too blunt for support on a device in the field whose
            // owner changed.
            else if (!strncmp(buf, "UNLINK", 6)) {
                netcfgSaveToken("");
                netcfgSaveClaimSecret("");
                Serial.println("device token cleared -- keeping wifi; restarting to re-claim");
                delay(300);
                ESP.restart();
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
        if (menu == Menu::None && uiScreen == Screen::Track && !storageRecording()
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
    // QRTEST holds the panel: the repaint below would wipe the test code about
    // 250 ms after it was drawn, which is the same trap the claim QR fell into.
    if (qrTestHold) { /* panel held for scan testing */ }
    else if (millis() - lastDraw >= 250) {
        lastDraw = millis();
        UplinkStatus up = uplinkGetStatus();

        UiState u;
        u.linked      = netIsClaimed();
        // Onboarding is forced until usable; then Pick, then the entered screen.
        u.state       = !netHasWifi()   ? AppState::Setup
                      : !netIsClaimed()  ? AppState::Linking
                      : confirmReset     ? AppState::ResetConfirm
                      : confirmDelete    ? AppState::DeleteConfirm
                      : menu == Menu::Pick        ? AppState::Pick
                      : menu == Menu::Settings    ? AppState::Settings
                      : uiScreen == Screen::Sync    ? AppState::Sync
                      : uiScreen == Screen::Nerd    ? AppState::Nerd
                      : uiScreen == Screen::Network ? AppState::Network
                                                    : AppState::Track;
        u.menuSel     = menuSel;
        u.net.ssid    = netcfg.ssid;
        u.net.up      = WiFi.status() == WL_CONNECTED;
        u.net.ip      = u.net.up ? WiFi.localIP().toString() : String();
        u.net.rssi    = u.net.up ? WiFi.RSSI() : 0;
        u.net.everConnected = netcfg.everConnected;
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
            // PEEK, never snapshot. This block runs at 4 Hz and imuSnapshot()
            // closes the accumulation window as a side effect, so calling it
            // here made every 1 Hz CSV row report the peak over ~250 ms instead
            // of the last second -- `imu_samples` logged 10-11 against a design
            // intent of 43-50, confirmed in real uploaded data. The logger at
            // 1 Hz is the one and only window-closing consumer.
            ImuSample m = imuPeek();
            u.imuTempC   = m.tempC;
            u.imuSamples = m.samples;
        }
        u.droppedRows = storageDroppedRows();
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
        u.linkPage    = linkPage;
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
