#include "uplink.h"
#include "netcfg.h"
#include "mbedtls/sha256.h"
#include "storage.h"
#include "board.h"
#include "root_ca.h"
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
static volatile bool     g_countNow = false;  // recompute Sync-screen tallies
static volatile bool     g_deleteNow = false; // delete confirmed-uploaded files
static volatile bool     g_sdBusy   = false;  // task is using the shared SPI bus (SD)

static void statusSet(const UplinkStatus &s)
{
    if (!g_lock) return;
    xSemaphoreTake(g_lock, portMAX_DELAY);
    g_status = s;
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
    c.setCACert(AMAZON_ROOT_CA1);
    c.setTimeout(20000);
}

static bool alreadyUploaded(const String &name)
{
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
    File f = SD.open(UPLOADED_INDEX, FILE_APPEND);
    if (!f) return;
    f.printf("%s\t%d\n", name.c_str(), rc);
    f.close();
}

static bool confirmedUploaded(const String &name)
{
    File f = SD.open(UPLOADED_INDEX, FILE_READ);
    if (!f) return false;
    bool ok = false;
    while (f.available()) {
        String line = f.readStringUntil('\n');
        line.trim();
        int tab = line.indexOf('\t');
        if (tab < 0) continue;
        if (line.substring(0, tab) != name) continue;
        int rc = line.substring(tab + 1).toInt();
        ok = (rc == 200 || rc == 201 || rc == 409);
        break;
    }
    f.close();
    return ok;
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

static void showCode(const String &code)
{
    Serial.printf("\n>>> Enter this code at %s/profile/me/settings : %s\n\n",
                  netcfg.baseUrl.c_str(), code.c_str());
    if (!display.begin()) return;
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "Link this tracker:");
    display.setFont(u8g2_font_logisoso20_tf);
    display.drawStr(2, 38, code.c_str());
    display.setFont(u8g2_font_5x8_tf);
    display.drawStr(0, 54, "paddlesnitch.com");
    display.drawStr(0, 63, "profile > settings");
    display.sendBuffer();
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
    http.setTimeout(120000);

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
static bool isTrackUpload(const String &name)
{
    // Must exclude BOTH sidecar suffixes. _i10.csv was added later and this
    // predicate was not updated, so the upload-rate file was being uploaded as a
    // track — which is why the chunked sidecar path never ran at all, and why
    // every failure looked like a whole-file read of 2383054 bytes.
    return name.startsWith("track_") && name.endsWith(".csv")
        && !name.endsWith("_imu.csv") && !name.endsWith("_i10.csv");
}

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

static bool uploadChunked(WiFiClientSecure &client, const String &path, const String &name)
{
    // Opened only to learn the size; each chunk reopens it. Nothing holds a card
    // handle while HTTP is in flight.
    size_t total = 0;
    {
        File probe = SD.open("/" + path, FILE_READ);
        if (!probe) return false;
        total = probe.size();
        probe.close();
    }
    if (total == 0) return false;
    const int parts = (int)((total + UPLOAD_CHUNK - 1) / UPLOAD_CHUNK);

    uint8_t *buf = (uint8_t *)ps_malloc(UPLOAD_CHUNK);
    if (!buf) { Serial.println("  no PSRAM for a chunk"); return false; }

    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);

    bool ok = true;
    for (int part = 1; part <= parts && ok; part++) {
        size_t want = (part == parts) ? (total - (size_t)(part - 1) * UPLOAD_CHUNK) : UPLOAD_CHUNK;
        // Open, seek, read, CLOSE — once per chunk, with no HTTP in between.
        //
        // The file used to stay open across all 37 requests, and that is what was
        // failing: SDPROBE reads this same 2.38 MB file end to end at 430 KB/s
        // with the radio off AND associated, so neither the card nor WiFi is the
        // problem. What breaks it is holding a File handle across seconds of TLS
        // work between reads. Reading in one uninterrupted go per chunk is
        // exactly the pattern the probe proves works.
        File f = SD.open("/" + path, FILE_READ);
        if (!f) { Serial.printf("  %s: cannot reopen for part %d\n", name.c_str(), part); ok = false; break; }
        const size_t offset = (size_t)(part - 1) * UPLOAD_CHUNK;
        if (!f.seek(offset)) {
            Serial.printf("  %s part %d: seek to +%u failed\n", name.c_str(), part, (unsigned)offset);
            f.close(); ok = false; break;
        }
        size_t got = 0;
        int stalls = 0;
        while (got < want) {
            int n = f.read(buf + got, want - got);
            if (n > 0) { got += (size_t)n; stalls = 0; continue; }
            if (++stalls > 20) break;
            delay(10);
        }
        f.close();
        if (got != want) {
            Serial.printf("  %s part %d/%d: short read %u/%u at +%u | cardType=%d heap=%lu\n",
                          name.c_str(), part, parts, (unsigned)got, (unsigned)want, (unsigned)offset,
                          (int)SD.cardType(), (unsigned long)ESP.getFreeHeap());
            ok = false;
            break;
        }
        mbedtls_sha256_update(&sha, buf, got);

        // The hash is only known in full on the last part, which is also the one
        // that triggers assembly — so that is where it is sent.
        String url = netcfg.baseUrl + "/api/devices/sessions?filename=" + name
                   + "&part=" + String(part) + "&parts=" + String(parts);
        if (part == parts) {
            uint8_t digest[32];
            mbedtls_sha256_finish(&sha, digest);
            char hex[65];
            for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", digest[i]);
            hex[64] = 0;
            url += "&sha256=" + String(hex);
        }

        HTTPClient http;
        if (!http.begin(client, url)) { ok = false; break; }
        http.addHeader("Content-Type", "text/csv");
        http.addHeader("Authorization", "Bearer " + netcfg.token);
        http.addHeader("X-Device-Firmware", FIRMWARE_VERSION);
        http.addHeader("X-Device-Model", "lilygo-tbeam-s3-supreme");
        http.setTimeout(60000);
        int rc = http.sendRequest("POST", buf, got);
        String payload = http.getString();
        http.end();

        // 202 = part stored, 201 = assembled. Anything else is a failure worth
        // seeing; the file is left unmarked so the next sync retries it.
        if (rc != 202 && rc != 201) {
            Serial.printf("  %s part %d/%d (%u B) -> HTTP %d %s\n", name.c_str(), part, parts,
                          (unsigned)got, rc, payload.substring(0, 60).c_str());
            ok = false;
            break;
        }
        if (part == parts || (part % 8) == 0) {
            Serial.printf("  %s part %d/%d -> HTTP %d\n", name.c_str(), part, parts, rc);
        }
        delay(5);   // let the radio breathe before the next card read
    }

    mbedtls_sha256_free(&sha);
    free(buf);
    return ok;
}

static bool isMotionUpload(const String &name)
{
    return name.startsWith("track_") && name.endsWith("_i10.csv");
}

// track_<stamp>_i10.csv -> the name the SERVER keys the sidecar by. It attaches a
// sidecar to the track of the matching name, so the on-card name and the uploaded
// name deliberately differ.
static String motionUploadName(const String &local)
{
    return local.substring(0, local.length() - strlen("_i10.csv")) + "_imu.csv";
}

// Tallies the sessions on the card for the Sync screen: how many track files
// exist, and how many of those the server has confirmed. Read-only; runs on the
// uplink task so SD access stays single-owner. Writes the result into `st`.
static void computeCounts(UplinkStatus &st)
{
    if (!storageReady()) { st.countsValid = false; return; }

    int on = 0, up = 0;
    File root = SD.open("/");
    for (File f = root.openNextFile(); f; f = root.openNextFile()) {
        bool dir = f.isDirectory();
        String name = f.name();
        if (name.startsWith("/")) name = name.substring(1);
        bool isTrack = isTrackUpload(name);
        f.close();
        if (dir || !isTrack) continue;
        on++;
        if (confirmedUploaded(name)) up++;
    }
    root.close();

    st.onDevice = on;
    st.uploaded = up;
    st.pending  = on - up;
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

    // Collect names first; deleting while iterating the directory handle is
    // asking for trouble.
    String names[128];
    int n = 0;
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

    File root = SD.open("/");
    for (File f = root.openNextFile(); f; f = root.openNextFile()) {
        if (f.isDirectory()) { f.close(); continue; }
        String name = f.name();
        if (name.startsWith("/")) name = name.substring(1);
        size_t size = f.size();
        f.close();

        if (!isTrackUpload(name)) continue;        // sidecars go in the pass below
        if (name == active) continue;             // still being written to
        if (alreadyUploaded(name)) continue;
        // Checked between files, not mid-file: a recording starting must not
        // find the card busy, and an upload must not be torn in half.
        if (g_yield) { Serial.println("sync: yielding card"); break; }

        // Chunked, like sidecars. A 696 KB track hits the same wall a 2.4 MB
        // sidecar does — the card will not deliver it in one read while HTTP is
        // in flight — and until the track lands its sidecar cannot attach, so
        // this is the upload that has to work first.
        (void)size;
        if (uploadChunked(client, name, name)) {
            markUploaded(name, 201);
            accepted++;
        }
    }
    root.close();

    // Second pass: the motion sidecars. Deliberately after every track — the
    // server attaches a sidecar to an existing session and answers 409 if the
    // track has not arrived yet, and a 409 here would mark it done forever.
    //
    // Nothing heavy happens here any more. The ~11 Hz file was written during
    // recording, so this is an ordinary streamed upload of a couple of MB, the
    // same as a track. The version that re-read and decimated the full-rate file
    // at this point is what boot-looped the device on a 10.5 MB sidecar.
    String activeUp = active;
    if (activeUp.endsWith(".csv")) activeUp = activeUp.substring(0, activeUp.length() - 4) + "_i10.csv";
    File root2 = SD.open("/");
    for (File f = root2.openNextFile(); f; f = root2.openNextFile()) {
        if (f.isDirectory()) { f.close(); continue; }
        String name = f.name();
        if (name.startsWith("/")) name = name.substring(1);
        size_t size = f.size();
        f.close();

        if (!isMotionUpload(name)) continue;
        if (name == activeUp) continue;            // still being written to
        if (alreadyUploaded(name)) continue;
        if (g_yield) { Serial.println("sync: yielding card"); break; }

        // Uploaded under the name the SERVER keys sidecars by, read from the
        // on-card name. retryOn409 because a 409 means "the track is not up yet",
        // which is temporary — marking that done would strand the motion data.
        // Chunked, always: even a small sidecar costs only one extra request, and
        // one code path is worth more than saving it.
        (void)size;
        if (uploadChunked(client, name, motionUploadName(name))) {
            markUploaded(name, 201);
            accepted++;
        }
    }
    root2.close();

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
void uplinkRequestSync()          { g_syncNow = true; }
void uplinkRequestCounts()        { g_countNow = true; }
void uplinkRequestDeleteUploaded(){ g_deleteNow = true; }
bool uplinkSdBusy()               { return g_sdBusy; }

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
        // Drop transmit power once associated. Not for range — for CURRENT. With
        // no cell fitted the board runs off USB through the PMU, and WiFi TX peaks
        // look like the thing breaking SD reads: the same card streams an 8.19 MB
        // file over CAT with the radio idle, but stalls dead after ~90 KB with it
        // associated. 11 dBm is ample for a device that only syncs at home.
        if (st.wifiUp) WiFi.setTxPower(WIFI_POWER_11dBm);
        if (!st.wifiUp) {
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

        if (netIsClaimed() && !g_yield) {
            st.busy = true;
            statusSet(st);
            g_sdBusy = true;            // pause core-1 IMU polling for the SD reads
            st.uploadedOk = uplinkSyncSessions();
            computeCounts(st);          // refresh tallies after uploading
            g_sdBusy = false;
            st.busy       = false;
            statusSet(st);
        }

        netDisconnect();
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
    xTaskCreatePinnedToCore(uplinkTask, "uplink", 8192, nullptr, 1, nullptr, 0);
}
