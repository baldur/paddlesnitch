#include "uplink.h"
#include "spibus.h"
#include "naming.h"
#include "qr.h"
#include "dbg.h"
#include "netcfg.h"
#include "mbedtls/sha256.h"
#include "storage.h"
#include "board.h"
#include "root_ca.h"
#include "ota.h"
#include "ota_policy.h"
#include "upload_policy.h"
#include "compress.h"
#include "health.h"
#include "ble_about.h"
#include <mbedtls/md.h>

#ifndef BENCH_TOOLS
#define BENCH_TOOLS 0
#endif
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SD.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

static const char *UPLOADED_INDEX = "/uploaded.txt";

static SemaphoreHandle_t g_lock   = nullptr;
static UplinkStatus      g_status;
static volatile bool     g_yield   = false;   // "let go of the SD card"
static volatile bool     g_syncNow = false;

// Bluetooth setup's WiFi trial (uplinkTryWifi). Strings are only touched
// under g_trialLock; the state is a single byte.
static SemaphoreHandle_t  g_trialLock = nullptr;
static String             g_trialSsid, g_trialPass;
static volatile bool      g_trialPending = false;
static volatile WifiTrial g_trial = WifiTrial::Idle;

const char *wifiTrialName(WifiTrial t)
{
    switch (t) {
    case WifiTrial::Trying:        return "trying";
    case WifiTrial::Joined:        return "joined";
    case WifiTrial::WrongPassword: return "wrong_password";
    case WifiTrial::NotFound:      return "not_found";
    case WifiTrial::Failed:        return "failed";
    default:                       return "idle";
    }
}

void uplinkTryWifi(const String &ssid, const String &pass)
{
    if (!g_trialLock) g_trialLock = xSemaphoreCreateMutex();
    xSemaphoreTake(g_trialLock, portMAX_DELAY);
    g_trialSsid = ssid; g_trialPass = pass;
    xSemaphoreGive(g_trialLock);
    g_trial = WifiTrial::Trying;
    g_trialPending = true;
}
WifiTrial uplinkWifiTrial() { return g_trial; }

// Runs on the uplink task, which owns the radio. Tries the new details with
// the old ones kept in RAM, and saves the new ones only if they join.
static void runWifiTrial()
{
    String ssid, pass;
    xSemaphoreTake(g_trialLock, portMAX_DELAY);
    ssid = g_trialSsid; pass = g_trialPass;
    g_trialPass = "";   // don't keep the password around longer than needed
    xSemaphoreGive(g_trialLock);

    const String oldSsid = netcfg.ssid, oldPass = netcfg.pass;
    netDisconnect();
    netcfg.ssid = ssid; netcfg.pass = pass;          // RAM only, for this attempt
    const bool ok = netConnect(15000, nullptr);
    if (ok) {
        // Restore first, so netcfgSaveWifi compares the new details with the
        // old ones (setup_policy.h) and then marks what it saves.
        netcfg.ssid = oldSsid; netcfg.pass = oldPass;
        netcfgSaveWifi(ssid, pass, netcfg.baseUrl);
        // netcfgSaveWifi clears the "has worked" mark when the network changed.
        // It has just worked, so join again to set it -- from disconnected:
        // netConnect returns early, without marking, if already connected.
        netDisconnect();
        netConnect(15000, nullptr);
        g_trial = WifiTrial::Joined;
        g_syncNow = true;                             // sync while we're at it
    } else {
        const int seen = netSsidVisible(ssid);
        netcfg.ssid = oldSsid; netcfg.pass = oldPass; // keep what worked before
        g_trial = seen == 1 ? WifiTrial::WrongPassword : seen == 0 ? WifiTrial::NotFound : WifiTrial::Failed;
    }
    DBGI("wifi", "bluetooth setup: %s", wifiTrialName(g_trial));
    Serial.printf("WiFi trial (Bluetooth setup): %s\n", wifiTrialName(g_trial));
    netDisconnect();
}
static volatile bool     g_countNow = false;  // recompute Sync-screen tallies
static volatile bool     g_probeNow = false;  // run a card probe on THIS task
static char              g_probeFile[64] = "";
static volatile bool     g_deleteNow = false; // delete confirmed-uploaded files
// Descriptive only now: the Sync screen and the recording-yield handshake ask
// "is the uploader working the card?". It is NOT what keeps the IMU off the bus
// any more -- a flag cannot do that (see spibus.h). The mutex does.
static volatile bool     g_sdBusy   = false;  // task is using the shared SPI bus (SD)

static void statusSet(const UplinkStatus &s)
{
    if (!g_lock) return;
    xSemaphoreTake(g_lock, portMAX_DELAY);
    g_status = s;
    xSemaphoreGive(g_lock);
}

// Publishes chunk progress by poking the three progress fields, rather than
// writing back a whole snapshot: the sync loop holds a local UplinkStatus across
// the entire upload, so a read-modify-statusSet here would race it and lose
// whatever the loop set in the meantime. One short critical section per 64 KB
// chunk, against a UI that takes the same mutex once a frame -- it cannot starve
// the display. The statusSet() the loop runs when the sync ends clears these
// back to the defaults of its own local, so idle needs no explicit reset.
static void statusProgress(const char *name, int part, int parts)
{
    if (!g_lock) return;
    xSemaphoreTake(g_lock, portMAX_DELAY);
    snprintf(g_status.upFile, sizeof(g_status.upFile), "%s", name);
    g_status.upPart  = part;
    g_status.upParts = parts;
    xSemaphoreGive(g_lock);
}

// Publishes the claim code the INSTANT it is known, rather than when the claim
// finishes. uplinkClaim() then blocks for minutes polling for the user to enter
// it -- and the UI repaints drawLinking() at 4 Hz throughout, so a code that is
// only published after the poll returns is published after it was needed. The
// screen showed "...." for the entire window in which the user had to read it.
//
// Pokes the one field rather than writing a whole snapshot back, for the same
// reason statusProgress() does: the caller holds a local UplinkStatus across
// the whole operation and a read-modify-set here would race it.
static void statusClaimCode(const char *code)
{
    if (!g_lock) return;
    xSemaphoreTake(g_lock, portMAX_DELAY);
    snprintf(g_status.claimCode, sizeof(g_status.claimCode), "%s", code);
    g_status.claiming = true;
    xSemaphoreGive(g_lock);
}

UplinkStatus uplinkGetStatus()
{
    UplinkStatus copy;
    if (!g_lock) return copy;
    xSemaphoreTake(g_lock, portMAX_DELAY);
    copy = g_status;
    xSemaphoreGive(g_lock);
    return copy;
}

// One configured client for every request. setCACert (never setInsecure) is the
// whole point: this device carries a token that can write to a user's account.
static void configureClient(WiFiClientSecure &c)
{
    c.setCACert(AMAZON_ROOT_CAS);
    c.setTimeout(20000);
}

static bool alreadyUploaded(const String &name)
{
    SpiBusGuard bus(5000);
    if (!bus) { DBGE("sd", "%s: bus busy", __func__); return false; }
    File f = SD.open(UPLOADED_INDEX, FILE_READ);
    if (!f) return false;
    bool found = false;
    while (f.available()) {
        String line = f.readStringUntil('\n');
        line.trim();
        int tab = line.indexOf('\t');
        if ((tab < 0 ? line : line.substring(0, tab)) == name) { found = true; break; }
    }
    f.close();
    return found;
}

// The index records the HTTP outcome, not just the name, so retention can tell
// "the server has this" (200/201/409) from "the server could not use it" (422).
static void markUploaded(const String &name, int rc)
{
    SpiBusGuard bus(5000);
    if (!bus) { DBGE("sd", "%s: bus busy", __func__); return ; }
    File f = SD.open(UPLOADED_INDEX, FILE_APPEND);
    if (!f) return;
    f.printf("%s\t%d\n", name.c_str(), rc);
    f.close();
}

// The HTTP code the index recorded for a file, or 0 if it has none.
static int indexRc(const String &name)
{
    SpiBusGuard bus(5000);
    if (!bus) { DBGE("sd", "%s: bus busy", __func__); return 0; }
    File f = SD.open(UPLOADED_INDEX, FILE_READ);
    if (!f) return 0;
    int found = 0;
    while (f.available()) {
        String line = f.readStringUntil('\n');
        line.trim();
        int tab = line.indexOf('\t');
        if (tab < 0) continue;
        if (line.substring(0, tab) != name) continue;
        found = line.substring(tab + 1).toInt();
        break;
    }
    f.close();
    return found;
}

static bool confirmedUploaded(const String &name) { return indexRcConfirmed(indexRc(name)); }

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

static void showCode(const String &code)
{
    Serial.printf("\n>>> Enter this code at %s/profile/me/settings : %s\n\n",
                  netcfg.baseUrl.c_str(), code.c_str());
    // DRAWS NOTHING, on purpose. This runs on the uplink task while the UI
    // repaints drawLinking() from core 1 at 4 Hz, so painting here does not
    // "get there first" -- the two alternate, and the screen visibly flickers
    // between the characters and the QR. Calling it a first paint was wrong on
    // two counts: uplinkClaim() runs again on every retry, and two cores
    // driving one I2C display with no lock between them is not safe even when
    // it looks fine.
    //
    // statusClaimCode() publishes the code the instant it is known and
    // drawLinking() renders it. The screen has one owner.
}

ClaimStatus uplinkClaim(uint32_t timeoutMs)
{
    ClaimStatus st;
    WiFiClientSecure client;
    configureClient(client);

    String code = "", secret = netcfg.claimSecret;

    // Ask for a code. The server ties it to our device id and returns a secret
    // that only we hold, so knowing the visible code is not enough to collect
    // the token.
    {
        HTTPClient http;
        if (!http.begin(client, netcfg.baseUrl + "/api/devices/claim")) {
            st.state = ClaimState::Failed; st.message = "begin() failed";
            return st;
        }
        http.addHeader("Content-Type", "application/json");
        JsonDocument body;
        body["deviceId"] = netDeviceId();
        body["model"]    = "lilygo-tbeam-s3-supreme";
        body["firmware"] = FIRMWARE_VERSION;
        String out; serializeJson(body, out);

        int rc = http.POST(out);
        String payload = http.getString();
        http.end();

        if (rc != 200 && rc != 201) {
            st.state = ClaimState::Failed;
            st.message = "claim HTTP " + String(rc) + " " + payload.substring(0, 80);
            Serial.printf("claim failed: %s\n", st.message.c_str());
            return st;
        }
        JsonDocument res;
        if (deserializeJson(res, payload)) {
            st.state = ClaimState::Failed; st.message = "bad JSON from /claim";
            return st;
        }
        code   = res["claimCode"]   | "";
        secret = res["claimSecret"] | "";
        if (!code.length() || !secret.length()) {
            st.state = ClaimState::Failed; st.message = "claim response missing fields";
            return st;
        }
        netcfgSaveClaimSecret(secret);
    }

    statusClaimCode(code.c_str());   // BEFORE the poll, not after it
    showCode(code);
    st.code  = code;
    st.state = ClaimState::AwaitingUser;

    // Poll for the token. 5s is frequent enough to feel immediate to someone
    // typing the code on the website, and gentle enough on the API.
    uint32_t t0 = millis();
    while (millis() - t0 < timeoutMs) {
        delay(5000);

        HTTPClient http;
        if (!http.begin(client, netcfg.baseUrl + "/api/devices/token")) continue;
        http.addHeader("Content-Type", "application/json");
        JsonDocument body;
        body["deviceId"]    = netDeviceId();
        body["claimSecret"] = secret;
        String out; serializeJson(body, out);

        int rc = http.POST(out);
        String payload = http.getString();
        http.end();

        if (rc == 202) { Serial.println("waiting for the code to be entered..."); continue; }
        if (rc == 200) {
            JsonDocument res;
            if (!deserializeJson(res, payload)) {
                String token = res["deviceToken"] | "";
                if (token.length()) {
                    netcfgSaveToken(token);
                    st.state = ClaimState::Claimed;
                    st.message = "linked";
                    Serial.println("device linked");
                    return st;
                }
            }
        }
        if (rc == 410) {   // code expired -- the user took too long
            st.state = ClaimState::Failed; st.message = "claim code expired";
            return st;
        }
    }
    st.state = ClaimState::Failed;
    st.message = "timed out waiting for the code to be entered";
    return st;
}

// ---------------------------------------------------------------------------
// Session upload
// ---------------------------------------------------------------------------

// `path` is what we read from the card; `name` is what the server is told it is.
// They differ only for a motion sidecar, which is uploaded from a decimated temp
// file but must still arrive under its real track_<stamp>_imu.csv name so the
// server can attach it to the right session.
static bool uploadOne(WiFiClientSecure &client, const String &path, const String &name, size_t size,
                      bool retryOn409 = false)
{
    File f = SD.open("/" + path, FILE_READ);
    if (!f) return false;

    HTTPClient http;
    String url = netcfg.baseUrl + "/api/devices/sessions?filename=" + name;
    if (!http.begin(client, url)) { f.close(); return false; }
    http.addHeader("Content-Type", "text/csv");
    http.addHeader("Authorization", "Bearer " + netcfg.token);
    // Lets the server reason about the file it is being handed without sniffing
    // the CSV: column sets and sensor behaviour change between firmware builds.
    http.addHeader("X-Device-Firmware", FIRMWARE_VERSION);
    http.addHeader("X-Device-Model", "lilygo-tbeam-s3-supreme");
    // HTTPClient's own timeout, which is NOT the 20 s set on the TLS client and
    // defaults to five seconds. Five seconds is fine for a claim POST and hopeless
    // for a session: this board sustains a couple of hundred KB/s over TLS, so
    // anything past roughly half a megabyte times out mid-body and comes back
    // error(-3) "send payload failed". That is exactly the pattern seen — small
    // sidecars accepted, a 696 KB track and a 2.4 MB sidecar both failing, and a
    // 1.6 MB upload that once succeeded on a faster moment of the same link.
    // 65535 ms is the ceiling, not a style choice: HTTPClient::setTimeout takes a
    // uint16_t, so the 120000 that used to be here silently became 54464 -- half
    // the intended budget, on the one call whose whole purpose was a long one.
    // The compiler does warn (-Woverflow); it was lost in the RadioLib noise.
    http.setTimeout(60000);

    // Streamed from the card: a session can be hundreds of KB and the device
    // has nowhere near enough heap to hold one as a String.
    // Read the whole file into PSRAM, then POST from memory.
    //
    // Streaming straight off the card (`sendRequest(..., &f, size)`) fails on
    // anything large: HTTPClient pulls from the File while the TLS write is in
    // flight, an SPI read stalls for a moment, and a short read is reported as
    // error(-3) "send payload failed". Measured: a 696 KB track and a 2.4 MB
    // sidecar both died after ~6 s with heap untouched at 268 KB, and the server
    // accepts a 2.4 MB body in 2.3 s from a laptop — so neither memory, nor the
    // timeout, nor the server was the problem.
    //
    // The board has 8 MB of PSRAM doing nothing. Reading first separates the two
    // operations completely: the card is read with no TLS active, then the socket
    // is fed from RAM at full speed. Falls back to streaming if the allocation
    // fails, which is no worse than before.
    uint32_t heapBefore = ESP.getFreeHeap();
    uint32_t t0 = millis();
    int rc;
    uint8_t *buf = (uint8_t *)ps_malloc(size);
    if (buf) {
        // Loop: File::read() returns what it has, not what was asked for. A single
        // call came back with 57 KB of a 696 KB file — and that same short read,
        // hit inside HTTPClient while streaming, is what produced the original
        // error(-3) "send payload failed". Reading to completion here is the
        // actual fix; PSRAM just makes it cheap to hold the result.
        // A zero from read() means "nothing right now", NOT end of file. With the
        // radio associated, SD reads stall after a few tens of KB — measured at
        // 12 KB and 70 KB of the same 2.38 MB file, while a CAT of an 8.19 MB file
        // with WiFi idle streams end to end. So treat a zero as backpressure and
        // wait, rather than as the end, which is what the first version did.
        size_t got = 0;
        int stalls = 0;
        while (got < size) {
            int n = f.read(buf + got, size - got);
            if (n > 0) { got += (size_t)n; stalls = 0; continue; }
            if (++stalls > 200) break;       // ~2 s of grace in total, then give up
            delay(10);
        }
        if (stalls) Serial.printf("  %s: %d read stall(s), got %u/%u\n",
                                  name.c_str(), stalls, (unsigned)got, (unsigned)size);
        f.close();
        if (got != size) {
            Serial.printf("  %s: short read %u/%u\n", name.c_str(), (unsigned)got, (unsigned)size);
            free(buf);
            http.end();
            return false;
        }
        rc = http.sendRequest("POST", buf, size);
        free(buf);
    } else {
        Serial.printf("  %s: no PSRAM for %u B, streaming from card\n", name.c_str(), (unsigned)size);
        rc = http.sendRequest("POST", &f, size);
    }
    uint32_t took = millis() - t0;
    String payload = http.getString();
    http.end();
    if (f) f.close();

    // 200 accepted, 409 already have it -- both mean stop trying. 422 means the
    // server parsed it and found no usable track (an indoor session with no
    // fix); recording it as done stops us re-uploading junk every boot.
    //
    // A sidecar is the exception: its 409 means "the track this belongs to has
    // not been uploaded yet", which is temporary. Marking that done would strand
    // the motion data on the card permanently.
    bool done = (rc == 200 || rc == 201 || rc == 422 || (rc == 409 && !retryOn409));
    Serial.printf("  %s (%u B) -> HTTP %d in %lums  heap %lu->%lu  %s\n",
                  name.c_str(), (unsigned)size, rc, (unsigned long)took,
                  (unsigned long)heapBefore, (unsigned long)ESP.getFreeHeap(),
                  done ? "" : payload.substring(0, 60).c_str());
    if (done) markUploaded(name, rc);
    return rc == 200 || rc == 201;
}

// An uploadable session file: track_*.csv, but NOT the raw motion-capture
// sidecar track_*_imu.csv, which is uploaded separately and decimated first.
// Thin wrappers over naming.h, which is host-tested. The predicates themselves
// deliberately live outside this file: getting one wrong here cost a full
// debugging session, and `pio test -e native` now catches that in 0.5s.
static bool isTrackUpload(const String &name) { return nameIsTrackUpload(name.c_str()); }

// The raw motion sidecar. Uploaded AFTER the tracks (the server attaches it to an
// already-uploaded session and answers 409 otherwise), and never auto-deleted:
// the full-rate copy stays on the card even once the reduction is safely up.
// The pre-written UPLOAD-RATE motion file (~11 Hz), produced during recording by
// storage.cpp. The full-rate track_*_imu.csv is never uploaded and never touched
// here: re-reading megabytes at sync time is exactly what boot-looped the device.
// Uploads a motion sidecar in fixed-size chunks.
//
// Not a transfer optimisation — a workaround for the card. With the radio
// associated this board's SD reads stall hard after a few tens of KB: measured
// 90112 of 2383054 bytes, and 200 retries over two seconds did not recover it,
// while a CAT of an 8.19 MB file with the radio idle streams end to end. Small
// reads with a fresh open and an idle gap between them get around that; a single
// large read does not.
//
// Each chunk is its own POST with ?part=N&parts=M, and the server assembles once
// the last one lands (see storeMotionPart). Parts are idempotent by index, so a
// reboot mid-sync resumes rather than starting over. The final part carries a
// sha256 of the whole file, because assembling from pieces introduces a way to
// produce a silently wrong file that a single PUT never had.
static const size_t UPLOAD_CHUNK = 64 * 1024;

// Returns what the server's reply means for the file (upload_policy.h) and, in
// rcOut, the HTTP code to record in the index.
static UploadOutcome uploadChunked(WiFiClientSecure &client, const String &path, const String &name, int &rcOut)
{
    rcOut = 0;
    // Opened only to learn the size; each chunk reopens it. Nothing holds a card
    // handle while HTTP is in flight.
    size_t total = 0;
    {
        SpiBusGuard bus(5000);
        if (!bus) { DBGE("sd", "%s: bus busy sizing", name.c_str()); return UploadOutcome::Retry; }
        File probe = SD.open("/" + path, FILE_READ);
        if (!probe) return UploadOutcome::Retry;
        total = probe.size();
        probe.close();
    }
    // An empty file has nothing the server could use (it would answer 422), and
    // left alone it would count as pending for ever.
    if (total == 0) { rcOut = 422; return UploadOutcome::Rejected; }
    const int parts = chunkCount(total, UPLOAD_CHUNK);

    uint8_t *buf = (uint8_t *)ps_malloc(UPLOAD_CHUNK);
    if (!buf) { Serial.println("  no PSRAM for a chunk"); return UploadOutcome::Retry; }
    // Compressed copy of the piece. A little larger than the piece itself so a
    // piece that barely compresses still fits; one that doesn't fit, or grows,
    // goes plain (sendCompressed).
    const size_t ZBUF = UPLOAD_CHUNK + 1024;
    uint8_t *zbuf = (uint8_t *)ps_malloc(ZBUF);
    size_t sentBytes = 0;   // what actually went over the air, for the log

    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);

    bool ok = true;
    UploadOutcome failed = UploadOutcome::Retry;   // what a failed part means
    for (int part = 1; part <= parts && ok; part++) {
        // Published BEFORE the read, not after the POST: the read is the step
        // that used to stall, so the screen has to name the chunk it is stuck on.
        statusProgress(name.c_str(), part, parts);
        const size_t want = chunkLength(total, UPLOAD_CHUNK, part);
        // Open, seek, read, CLOSE — once per chunk, with no HTTP in between.
        //
        // The file used to stay open across all 37 requests, and that is what was
        // failing: SDPROBE reads this same 2.38 MB file end to end at 430 KB/s
        // with the radio off AND associated, so neither the card nor WiFi is the
        // problem. What breaks it is holding a File handle across seconds of TLS
        // work between reads. Reading in one uninterrupted go per chunk is
        // exactly the pattern the probe proves works.
        size_t got = 0;
        const size_t offset = (size_t)(part - 1) * UPLOAD_CHUNK;
        {
            // The bus is held for THIS READ ONLY, and released before the POST
            // below. That is the whole point of chunking: the card is idle
            // while TLS runs, so the IMU keeps sampling between chunks instead
            // of going silent for the entire sync.
            SpiBusGuard bus(5000);
            if (!bus) {
                DBGE("sd", "%s part %d: bus busy 5s", name.c_str(), part);
                Serial.printf("  %s part %d: SPI bus busy\n", name.c_str(), part);
                ok = false; break;
            }
            File f = SD.open("/" + path, FILE_READ);
            if (!f) {
                DBGE("sd", "%s part %d: reopen failed", name.c_str(), part);
                Serial.printf("  %s: cannot reopen for part %d\n", name.c_str(), part);
                ok = false; break;
            }
            if (!f.seek(offset)) {
                DBGE("sd", "%s part %d: seek +%u failed", name.c_str(), part, (unsigned)offset);
                Serial.printf("  %s part %d: seek to +%u failed\n", name.c_str(), part, (unsigned)offset);
                f.close(); ok = false; break;
            }
            int stalls = 0;
            while (got < want) {
                int n = f.read(buf + got, want - got);
                if (n > 0) { got += (size_t)n; stalls = 0; continue; }
                if (++stalls > 20) break;
                delay(10);
            }
            f.close();
        }
        if (got != want) {
            DBGE("sd", "%s part %d/%d short read %u/%u at +%u",
                 name.c_str(), part, parts, (unsigned)got, (unsigned)want, (unsigned)offset);
            Serial.printf("  %s part %d/%d: short read %u/%u at +%u | cardType=%d heap=%lu\n",
                          name.c_str(), part, parts, (unsigned)got, (unsigned)want, (unsigned)offset,
                          (int)SD.cardType(), (unsigned long)ESP.getFreeHeap());
            ok = false;
            break;
        }
        mbedtls_sha256_update(&sha, buf, got);

        // The hash is only known in full on the last part, which is also the one
        // that triggers assembly -- so that is where it is sent. It covers the
        // UNCOMPRESSED file: the server unpacks each piece before assembling.
        String query = "/api/devices/sessions?filename=" + name
                     + "&part=" + String(part) + "&parts=" + String(parts);
        if (part == parts) {
            uint8_t digest[32];
            mbedtls_sha256_finish(&sha, digest);
            char hex[65];
            for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", digest[i]);
            hex[64] = 0;
            query += "&sha256=" + String(hex);
        }

        // Compress the piece (zlib, ROM deflate). About 3x smaller on real
        // recordings; sent plain if it doesn't help or the buffer is missing.
        size_t zlen = zbuf ? compressPiece(buf, got, zbuf, ZBUF) : 0;
        bool compressed = sendCompressed(got, zlen);

        int rc = 0;
        String payload;
        for (int attempt = 0; attempt < 2; attempt++) {
            HTTPClient http;
            if (!http.begin(client, netcfg.baseUrl + query + (compressed ? "&enc=zlib" : ""))) { rc = -1; break; }
            // Compressed bytes MUST go as octet-stream: a Lambda function URL
            // passes a text/* body through as a string, which mangles binary.
            http.addHeader("Content-Type", compressed ? "application/octet-stream" : "text/csv");
            http.addHeader("Authorization", "Bearer " + netcfg.token);
            http.addHeader("X-Device-Firmware", FIRMWARE_VERSION);
            http.addHeader("X-Device-Model", "lilygo-tbeam-s3-supreme");
            http.setTimeout(60000);
            // THE OTA SIGNAL. HTTPClient throws away every response header unless it
            // is asked for one by name BEFORE the request, so without this line the
            // device would never learn a new version exists and would fall back to
            // polling -- which is exactly what the design avoids.
            static const char *kCollect[] = { "X-PS-Firmware" };
            http.collectHeaders(kCollect, 1);
            rc = compressed ? http.sendRequest("POST", zbuf, zlen) : http.sendRequest("POST", buf, got);
            payload = http.getString();
            // Read it on EVERY response, including the failures below: a device
            // whose uploads are failing is exactly one that may need a new build.
            otaNoteServerVersion(http.header("X-PS-Firmware").c_str());
            http.end();
            // A server that can't unpack the piece: resend it plain, once. A 400
            // would otherwise write the recording off (upload_policy.h).
            if (compressed && resendPlain(rc, payload.c_str())) {
                DBGW("sync", "%s part %d: bad_encoding, resending plain", name.c_str(), part);
                Serial.printf("  %s part %d: server could not unpack it, resending plain\n", name.c_str(), part);
                compressed = false;
                continue;
            }
            break;
        }
        if (rc == 202 || rc == 201) sentBytes += compressed ? zlen : got;

        rcOut = rc;
        // 202 = part stored, 201 = assembled. Anything else stops this file, and
        // uploadOutcome() says whether it is done anyway (409 already_uploaded),
        // can never work (400/413/422), or should be tried again next sync.
        if (rc != 202 && rc != 201) {
            failed = uploadOutcome(rc, payload.c_str());
            DBGE("sync", "%s part %d/%d -> HTTP %d %s", name.c_str(), part, parts,
                 rc, payload.substring(0, 40).c_str());
            Serial.printf("  %s part %d/%d (%u B) -> HTTP %d %s\n", name.c_str(), part, parts,
                          (unsigned)got, rc, payload.substring(0, 60).c_str());
            ok = false;
            break;
        }
        if (part == parts || (part % 8) == 0) {
            Serial.printf("  %s part %d/%d -> HTTP %d\n", name.c_str(), part, parts, rc);
        }
        if (part == parts) {
            DBGI("sync", "%s: %u B sent for %u B", name.c_str(), (unsigned)sentBytes, (unsigned)total);
            Serial.printf("  %s: sent %u B for %u B (%.1fx)\n", name.c_str(), (unsigned)sentBytes,
                          (unsigned)total, sentBytes ? (double)total / sentBytes : 0.0);
        }
        delay(5);   // let the radio breathe before the next card read
    }

    mbedtls_sha256_free(&sha);
    free(buf);
    free(zbuf);
    return ok ? UploadOutcome::Accepted : failed;
}

static bool isMotionUpload(const String &name) { return nameIsMotionUpload(name.c_str()); }

// track_<stamp>_i10.csv -> the name the SERVER keys the sidecar by. It attaches a
// sidecar to the track of the matching name, so the on-card name and the uploaded
// name deliberately differ.
static String motionUploadName(const String &local)
{
    char out[64];
    return nameMotionUploadName(local.c_str(), out, sizeof(out)) ? String(out) : String();
}

// Tallies the sessions on the card for the Sync screen: how many track files
// exist, and how many of those the server has confirmed. Read-only; runs on the
// uplink task so SD access stays single-owner. Writes the result into `st`.
static void computeCounts(UplinkStatus &st)
{
    if (!storageReady()) { st.countsValid = false; return; }

    SpiBusGuard bus(5000);
    if (!bus) { DBGE("sd", "bus busy counting"); st.countsValid = false; return; }

    int on = 0, up = 0, rejected = 0;
    File root = SD.open("/");
    for (File f = root.openNextFile(); f; f = root.openNextFile()) {
        bool dir = f.isDirectory();
        String name = f.name();
        if (name.startsWith("/")) name = name.substring(1);
        bool isTrack = isTrackUpload(name);
        f.close();
        if (dir || !isTrack) continue;
        on++;
        const int rc = indexRc(name);
        if (indexRcConfirmed(rc)) up++;
        else if (indexRcRejected(rc)) rejected++;
    }
    root.close();

    st.onDevice = on;
    st.uploaded = up;
    st.rejected = rejected;
    st.pending  = on - up - rejected;   // rejected ones will never upload
    st.countsValid = true;
}

// Deletes EVERY session the server has confirmed (200/201/409). No keep-newest-N
// safety: this is a deliberate, user-confirmed action from the Sync screen, and
// after a 200 paddlesnitch is the system of record. Files rejected 422 and files
// never uploaded are left untouched -- 422 is the evidence if a parse problem is
// ever suspected, and an un-uploaded file exists nowhere else yet.
static int deleteConfirmedAll()
{
    if (!storageReady()) return 0;

    SpiBusGuard bus(5000);
    if (!bus) { DBGE("sd", "bus busy deleting"); return 0; }

    // Collect names first; deleting while iterating the directory handle is
    // asking for trouble. Static for the same stack reason as uplinkSyncSessions
    // above -- this runs on the same 8 KB task.
    static String names[128];
    int n = 0;
    for (int i = 0; i < 128; i++) names[i] = "";
    File root = SD.open("/");
    for (File f = root.openNextFile(); f && n < 128; f = root.openNextFile()) {
        bool dir = f.isDirectory();
        String name = f.name();
        if (name.startsWith("/")) name = name.substring(1);
        bool isTrack = isTrackUpload(name);
        f.close();
        if (!dir && isTrack) names[n++] = name;
    }
    root.close();

    int deleted = 0;
    for (int i = 0; i < n; i++) {
        if (!confirmedUploaded(names[i])) continue;
        if (SD.remove("/" + names[i])) {
            Serial.printf("  deleted %s\n", names[i].c_str());
            deleted++;
        }
    }
    return deleted;
}

int uplinkSyncSessions()
{
    if (!storageReady() || !netIsClaimed()) return 0;

    WiFiClientSecure client;
    configureClient(client);

    int accepted = 0;
    String active = storageFilename();
    if (active.startsWith("/")) active = active.substring(1);
    String activeUp = active;
    if (activeUp.endsWith(".csv")) activeUp = activeUp.substring(0, activeUp.length() - 4) + "_i10.csv";

    // LIST FIRST, UPLOAD AFTER -- and the listing is the only part that holds
    // the SPI bus. Iterating the directory handle while uploading from inside
    // the loop would mean holding the card across every TLS round trip, which
    // both starves the IMU for the whole sync and keeps a directory handle open
    // across minutes of network. It is also what makes the per-chunk locking in
    // uploadChunked possible at all: a scan that held the bus could not call it
    // without deadlocking on the same mutex.
    //
    // 128 is the same bound deleteConfirmedAll uses. A card with more pending
    // files than that syncs the rest on the next pass.
    // STATIC, not stack. The uplink task has an 8 KB stack that already carries a
    // WiFiClientSecure and its TLS buffers; 256 Strings on top of that overflows
    // it and the task double-faults the instant a sync starts (Guru Meditation,
    // core 0, corrupted backtrace). Static is safe here because this task is the
    // only caller and syncs never overlap.
    static String tracks[128];   int nTracks = 0;
    static String sidecars[128]; int nSide = 0;
    for (int i = 0; i < 128; i++) { tracks[i] = ""; sidecars[i] = ""; }
    {
        SpiBusGuard bus(5000);
        if (!bus) { DBGE("sync", "bus busy listing"); return 0; }
        File root = SD.open("/");
        if (!root) { DBGE("sync", "cannot open root"); return 0; }
        for (File f = root.openNextFile(); f; f = root.openNextFile()) {
            if (f.isDirectory()) { f.close(); continue; }
            String name = f.name();
            if (name.startsWith("/")) name = name.substring(1);
            f.close();
            // Only files still to send take a slot. Listing uploaded ones too
            // meant a card holding 128 recordings never uploaded another
            // (audit 2026-09); the next sync picks up anything past 128.
            if (isTrackUpload(name)) {
                if (name != active && nTracks < 128 && !alreadyUploaded(name)) tracks[nTracks++] = name;
            } else if (isMotionUpload(name)) {
                if (name != activeUp && nSide < 128 && !alreadyUploaded(name)) sidecars[nSide++] = name;
            }
        }
        root.close();
    }
    DBGI("sync", "listed %d track(s), %d sidecar(s)", nTracks, nSide);

    // Tracks first. A sidecar attaches to an existing session, so the server
    // answers 409 until its track has landed -- and a 409 marked done would
    // strand the motion data forever.
    for (int i = 0; i < nTracks; i++) {
        if (alreadyUploaded(tracks[i])) continue;
        // Checked between files, not mid-file: a recording starting must not
        // find the card busy, and an upload must not be torn in half.
        if (g_yield) { DBGW("sync", "yielding card"); Serial.println("sync: yielding card"); break; }
        DBGI("sync", "track %s", tracks[i].c_str());
        int rc = 0;
        const UploadOutcome out = uploadChunked(client, tracks[i], tracks[i], rc);
        if (out == UploadOutcome::Accepted) {
            markUploaded(tracks[i], rc == 409 ? 409 : 201);
            accepted++;
        } else if (out == UploadOutcome::Rejected) {
            // Recorded so it is never sent again. Its motion file can't attach
            // to a track the server doesn't have, so it goes the same way.
            DBGW("sync", "%s rejected (HTTP %d), not retrying", tracks[i].c_str(), rc);
            markUploaded(tracks[i], rc);
            char side[64];
            if (sidecarForTrack(tracks[i].c_str(), side, sizeof side)) markUploaded(String(side), rc);
        }
    }

    for (int i = 0; i < nSide; i++) {
        if (alreadyUploaded(sidecars[i])) continue;
        if (g_yield) { DBGW("sync", "yielding card"); Serial.println("sync: yielding card"); break; }
        // Uploaded under the name the SERVER keys sidecars by, read from the
        // on-card name.
        DBGI("sync", "sidecar %s", sidecars[i].c_str());
        int rc = 0;
        const UploadOutcome out = uploadChunked(client, sidecars[i], motionUploadName(sidecars[i]), rc);
        if (out == UploadOutcome::Accepted) {
            markUploaded(sidecars[i], rc == 409 ? 409 : 201);
            accepted++;
        } else if (out == UploadOutcome::Rejected) {
            DBGW("sync", "%s rejected (HTTP %d), not retrying", sidecars[i].c_str(), rc);
            markUploaded(sidecars[i], rc);
        }
    }

    DBGI("sync", "done, %d accepted", accepted);
    Serial.printf("sync: %d file(s) accepted\n", accepted);
    return accepted;
}


// ---------------------------------------------------------------------------
// Background task
// ---------------------------------------------------------------------------

bool uplinkYieldCard(uint32_t timeoutMs)
{
    g_yield = true;
    uint32_t t0 = millis();
    while (millis() - t0 < timeoutMs) {
        if (!uplinkGetStatus().busy) return true;
        delay(50);
    }
    return false;                                  // caller decides what to do
}

void uplinkResume()               { g_yield = false; }
void uplinkRequestProbe(const char *filename)
{
    snprintf(g_probeFile, sizeof(g_probeFile), "%s", filename);
    g_probeNow = true;
}

void uplinkRequestSync()          { g_syncNow = true; }
void uplinkRequestCounts()        { g_countNow = true; }
void uplinkRequestDeleteUploaded(){ g_deleteNow = true; }
bool uplinkSdBusy()               { return g_sdBusy; }

// ---------------------------------------------------------------------------
// Recordings over Bluetooth -- the uplink task's half (see uplink.h)
// ---------------------------------------------------------------------------

enum class BtOp : uint8_t { None, List, Piece, Done };
static volatile BtOp g_btOp = BtOp::None;
static String   g_btName, g_btReceipt;
static int      g_btPart = 0;
static const char *g_btState = "idle";        // idle, working, ready, marked, bad_receipt, busy, error
static uint8_t *g_btBuf = nullptr;            // PSRAM: what DATA serves
static const size_t BT_BUF = UPLOAD_CHUNK + 16 * 1024;   // a piece, or a long list
static size_t   g_btLen = 0, g_btCursor = 0;
static int      g_btParts = 0;
static bool     g_btCompressed = false;

void uplinkBtList()                                   { g_btName = ""; g_btState = "working"; g_btOp = BtOp::List; }
void uplinkBtPiece(const String &name, int part)      { g_btName = name; g_btPart = part; g_btState = "working"; g_btOp = BtOp::Piece; }
void uplinkBtDone(const String &name, const String &r) { g_btName = name; g_btReceipt = r; g_btState = "working"; g_btOp = BtOp::Done; }
void uplinkBtSeek(uint32_t offset)                    { g_btCursor = offset <= g_btLen ? offset : g_btLen; }

void uplinkBtStatus(char *json, size_t n)
{
    bleSyncJson(json, n, g_btState, (unsigned long)g_btLen, g_btPart, g_btParts, g_btCompressed);
}

size_t uplinkBtPage(uint8_t *out, size_t max)
{
    if (max < 4 || strcmp(g_btState, "ready") != 0) return 0;
    blePageHeader(out, (uint32_t)g_btCursor);
    size_t n = g_btLen - g_btCursor;
    if (n > PS_BLE_PAGE_DATA) n = PS_BLE_PAGE_DATA;
    if (n > max - 4) n = max - 4;
    memcpy(out + 4, g_btBuf + g_btCursor, n);
    g_btCursor += n;
    return n + 4;
}

static String btActiveName()
{
    String a = storageFilename();
    return a.startsWith("/") ? a.substring(1) : a;
}

// The waiting recordings as JSON: tracks first (a motion file can only attach
// to a track the server already has), never the one being recorded.
static bool btBuildList()
{
    const String active = btActiveName();
    String activeUp = active;
    if (activeUp.endsWith(".csv")) activeUp = activeUp.substring(0, activeUp.length() - 4) + "_i10.csv";
    static String names[128]; static uint32_t sizes[128]; int n = 0;
    {
        SpiBusGuard bus(5000);
        if (!bus) return false;
        File root = SD.open("/");
        for (File f = root.openNextFile(); f && n < 128; f = root.openNextFile()) {
            String nm = f.name();
            if (nm.startsWith("/")) nm = nm.substring(1);
            if (!f.isDirectory() && isTrackUpload(nm) && nm != active) { names[n] = nm; sizes[n++] = f.size(); }
            f.close();
        }
        root.close();
        root = SD.open("/");
        for (File f = root.openNextFile(); f && n < 128; f = root.openNextFile()) {
            String nm = f.name();
            if (nm.startsWith("/")) nm = nm.substring(1);
            if (!f.isDirectory() && isMotionUpload(nm) && nm != activeUp) { names[n] = nm; sizes[n++] = f.size(); }
            f.close();
        }
        root.close();
    }
    String json = "[";
    bool first = true;
    for (int i = 0; i < n; i++) {
        if (alreadyUploaded(names[i])) continue;
        const String up = isMotionUpload(names[i]) ? motionUploadName(names[i]) : names[i];
        json += (first ? "" : ",");
        json += "{\"n\":\"" + names[i] + "\",\"u\":\"" + up + "\",\"s\":" + String(sizes[i]) + "}";
        first = false;
        if (json.length() > BT_BUF - 200) break;      // the rest on the next list
    }
    json += "]";
    memcpy(g_btBuf, json.c_str(), json.length());
    g_btLen = json.length(); g_btParts = 0; g_btCompressed = false;
    return true;
}

// Piece `part` (1-based) of a recording: read 64 KB off the card, compress it
// like a WiFi upload, and hold it for DATA.
static bool btBuildPiece(const String &name, int part)
{
    if (!isTrackUpload(name) && !isMotionUpload(name)) return false;
    if (name == btActiveName()) return false;
    static uint8_t *raw = nullptr;
    if (!raw) raw = (uint8_t *)ps_malloc(UPLOAD_CHUNK);
    if (!raw) return false;
    size_t total = 0, got = 0;
    {
        SpiBusGuard bus(5000);
        if (!bus) return false;
        File f = SD.open("/" + name, FILE_READ);
        if (!f) return false;
        total = f.size();
        const int parts = chunkCount(total, UPLOAD_CHUNK);
        if (part < 1 || part > parts) { f.close(); return false; }
        g_btParts = parts;
        const size_t want = chunkLength(total, UPLOAD_CHUNK, part);
        if (!f.seek((size_t)(part - 1) * UPLOAD_CHUNK)) { f.close(); return false; }
        int stalls = 0;
        while (got < want) {
            int r = f.read(raw + got, want - got);
            if (r > 0) { got += (size_t)r; stalls = 0; continue; }
            if (++stalls > 20) break;
            delay(10);
        }
        f.close();
        if (got != want) return false;
    }
    const size_t z = compressPiece(raw, got, g_btBuf, BT_BUF);
    g_btCompressed = sendCompressed(got, z);
    if (g_btCompressed) g_btLen = z;
    else { memcpy(g_btBuf, raw, got); g_btLen = got; }
    return true;
}

// Mark a recording sent only if the server's receipt checks: HMAC-SHA256 keyed
// with the hex sha256 of OUR token (what the server stores) over
// "ps-receipt:v1|id|uploadName" (ble_about.h; server uploadReceipt).
static bool btCheckReceipt(const String &name, const String &receipt)
{
    if (!netIsClaimed() || receipt.length() != 64) return false;
    uint8_t d[32];
    mbedtls_sha256((const uint8_t *)netcfg.token.c_str(), netcfg.token.length(), d, 0);
    char key[65];
    for (int i = 0; i < 32; i++) sprintf(key + i * 2, "%02x", d[i]);
    const String up = isMotionUpload(name) ? motionUploadName(name) : name;
    char msg[160];
    bleReceiptMessage(msg, sizeof(msg), netDeviceId().c_str(), up.c_str());
    uint8_t mac[32];
    if (mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), (const uint8_t *)key, 64,
                        (const uint8_t *)msg, strlen(msg), mac) != 0) return false;
    char hex[65];
    for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", mac[i]);
    uint8_t diff = 0;
    for (int i = 0; i < 64; i++) diff |= (uint8_t)(hex[i] ^ tolower((unsigned char)receipt[i]));
    return diff == 0;
}

static void runBtOp()
{
    const BtOp op = g_btOp;
    g_btOp = BtOp::None;
    if (!g_btBuf) g_btBuf = (uint8_t *)ps_malloc(BT_BUF);
    if (!g_btBuf) { g_btState = "error"; return; }
    // Recording owns the card; nothing else reads it then.
    if (storageRecording()) { g_btState = "busy"; return; }
    g_btCursor = 0; g_btLen = 0;
    bool ok = false;
    switch (op) {
    case BtOp::List:  ok = btBuildList(); break;
    case BtOp::Piece: ok = btBuildPiece(g_btName, g_btPart); break;
    case BtOp::Done:
        if (btCheckReceipt(g_btName, g_btReceipt)) {
            markUploaded(g_btName, 201);
            DBGI("ble", "%s sent via Bluetooth (receipt ok)", g_btName.c_str());
            Serial.printf("BLE: %s marked sent (receipt checked)\n", g_btName.c_str());
            g_btState = "marked";
        } else {
            DBGW("ble", "%s: receipt did not check", g_btName.c_str());
            Serial.printf("BLE: %s receipt did NOT check -- left waiting\n", g_btName.c_str());
            g_btState = "bad_receipt";
        }
        g_countNow = true;   // refresh the Sync screen's tallies
        return;
    default: return;
    }
    g_btState = ok ? "ready" : "error";
}

static void uplinkTask(void *)
{
    // Retried on a timer, not only at boot and on request. A recording that
    // finishes away from WiFi cannot upload then, and if the device never loses
    // power on the way home it would otherwise never try again -- which is
    // exactly what happened on the first real outing.
    //
    // Never while recording: the sync task must not touch the SD card then, and
    // powering the WiFi radio for a doomed 15 s attempt every few minutes is
    // pure battery cost when the device is out on the water.
    const uint32_t RETRY_MS = 5 * 60 * 1000;
    bool     first = true;
    uint32_t lastAttempt = 0;

    for (;;) {
        // The core-0 control probe. Deliberately the first thing in the loop and
        // outside every other branch, so it runs in the plainest possible task
        // context -- no sync in progress, no listing, nothing else holding the
        // bus. If this reads at 429 KB/s like the core-1 SDPROBE does, the task
        // is not the variable and the fault is somewhere in what the sync does.
        // If it stalls, the task context IS the variable.
        if (g_btOp != BtOp::None) runBtOp();

        if (g_trialPending && !storageRecording()) {
            g_trialPending = false;
            runWifiTrial();
        }

        if (g_probeNow) {
            g_probeNow = false;
            for (int phase = 0; phase < 2; phase++) {
                if (phase == 0) { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); delay(300); }
                else            { String why; netConnect(15000, &why); }
                size_t bytes = 0; uint32_t ms = 0;
                g_sdBusy = true;
                bool okRead = storageProbeRead(g_probeFile, &bytes, &ms);
                g_sdBusy = false;
                Serial.printf("SDPROBE0 (core0) wifi=%s: %u bytes in %lums (%lu KB/s)  %s\n",
                              phase == 0 ? "OFF" : "ON", (unsigned)bytes, (unsigned long)ms,
                              (unsigned long)(ms ? bytes / ms : 0),
                              okRead ? "complete" : "STALLED");
                DBGI("probe", "core0 wifi=%s %u B in %lums %s",
                     phase == 0 ? "off" : "on", (unsigned)bytes, (unsigned long)ms,
                     okRead ? "ok" : "STALLED");
            }
            netDisconnect();
        }

        // Local SD maintenance first -- counts and the manual delete need no
        // WiFi, and run only when the card is free (not recording, not yielded)
        // so SD access stays single-owner on this core.
        if ((g_countNow || g_deleteNow) && !storageRecording() && !g_yield) {
            UplinkStatus st = uplinkGetStatus();
            g_sdBusy = true;                    // pause core-1 IMU polling: shared bus
            if (g_deleteNow) {
                g_deleteNow = false;
                st.busy = true; statusSet(st);
                st.deleted = deleteConfirmedAll();
                g_countNow = true;              // tallies changed
            }
            if (g_countNow) { g_countNow = false; computeCounts(st); }
            g_sdBusy = false;
            st.busy = false;
            statusSet(st);
        }

        bool due = first || g_syncNow ||
                   (lastAttempt && millis() - lastAttempt > RETRY_MS);
        if (!due || storageRecording()) { vTaskDelay(pdMS_TO_TICKS(500)); continue; }
        first = false;
        g_syncNow = false;
        lastAttempt = millis();

        if (g_yield || !netHasWifi()) { vTaskDelay(pdMS_TO_TICKS(1000)); continue; }

        UplinkStatus st;
        String why;
        st.wifiUp = netConnect(15000, &why);
        // Drop transmit power once associated. Kept for CURRENT, not range: a
        // device that only ever syncs at home needs nothing more, and less TX
        // current is free.
        //
        // The reason originally written here -- that WiFi TX peaks were breaking
        // SD reads -- is FALSE and was measured to be false: SDPROBE reads the
        // same 818630-byte file at 429 KB/s with the radio off and 429 KB/s with
        // it associated. Deleted rather than annotated, because a stale claim in
        // a comment is read as authoritative and steers the next fix wrong.
        if (st.wifiUp) { WiFi.setTxPower(WIFI_POWER_11dBm); DBGI("wifi", "up %s", WiFi.localIP().toString().c_str()); }
        if (!st.wifiUp) {
            DBGW("wifi", "connect failed: %s", why.c_str());
            snprintf(st.message, sizeof(st.message), "%s", why.c_str());
            statusSet(st);
            netDisconnect();
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        if (!netIsClaimed()) {
            st.claiming = true;
            statusSet(st);
            ClaimStatus cs = uplinkClaim();
            snprintf(st.claimCode, sizeof(st.claimCode), "%s", cs.code.c_str());
            st.claiming = false;
            snprintf(st.message, sizeof(st.message), "%s", cs.message.c_str());
            statusSet(st);
        }

        // Health first (health.h): the start report -- with the crash summary
        // after a crash -- goes before anything that could restart us, such as
        // the update check below; then a heartbeat every hour.
        if (netIsClaimed() && !g_yield) {
            WiFiClientSecure hc;
            configureClient(hc);
            const UplinkStatus now = uplinkGetStatus();
            healthMaybeSend(hc, now.countsValid ? now.pending : -1, uxTaskGetStackHighWaterMark(nullptr));
        }

        // After a crash, look for a fix BEFORE uploading (ota_policy.h): if an
        // upload is what crashed, the usual check after the uploads is never
        // reached, and the tracker could only be fixed with a cable.
        static bool firstSync = true;
        if (netIsClaimed() && !g_yield && otaCheckBeforeUploads(boardLastResetWasCrash(), firstSync)) {
            DBGW("ota", "last restart was a crash: checking for an update before uploading");
            Serial.println("OTA: last restart was a crash -- checking for an update before uploading");
#if !BENCH_TOOLS
            otaMaybeUpdate();   // never returns if it installs: it restarts
#endif
        }
        firstSync = false;

        if (netIsClaimed() && !g_yield) {
            st.busy = true;
            statusSet(st);
            g_sdBusy = true;            // pause core-1 IMU polling for the SD reads
            st.uploadedOk = uplinkSyncSessions();
            DBGI("sync", "stack headroom %u B", (unsigned)uxTaskGetStackHighWaterMark(nullptr));
            Serial.printf("sync: stack headroom %u B\n", (unsigned)uxTaskGetStackHighWaterMark(nullptr));
            computeCounts(st);          // refresh tallies after uploading
            g_sdBusy = false;
            st.busy       = false;
            statusSet(st);
        }

        // OTA, while the radio is still up and the card is free. Order matters:
        // the ack first (it is small, and a rollback report is the thing we most
        // want to reach the server), then the update, which never returns if it
        // succeeds -- it reboots.
        if (netIsClaimed() && !g_yield) {
            if (otaAckPending()) otaSendAck();
#if BENCH_TOOLS
            // Bench build: never install an update (see platformio.ini).
            DBGI("ota", "bench build: automatic updates are off");
#else
            otaMaybeUpdate();
#endif
        }

        netDisconnect();
        DBGI("wifi", "down");
        st.wifiUp = false;
        statusSet(st);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

void uplinkTaskStart()
{
    if (!g_lock) g_lock = xSemaphoreCreateMutex();
    // Core 0: the Arduino loop (UI, GNSS, logging) runs on core 1, and this task
    // blocks for seconds inside TLS and HTTP.
    // 16 KB (was 8 KB) from 0.17.0. Compression runs here, and the ROM deflate keeps
    // its Huffman tables on the stack: on top of TLS that overflowed 8 KB on the
    // first compressed upload (stack canary, crash loop). The headroom left is
    // logged after every sync ("stack headroom").
    // 20 KB from 0.18.0: health reports and Bluetooth jobs run here too, and
    // on 16 KB a compressed upload left 7.7 KB (release-testing A5).
    xTaskCreatePinnedToCore(uplinkTask, "uplink", 20480, nullptr, 1, nullptr, 0);
}
