#include "uplink.h"
#include "netcfg.h"
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

static bool uploadOne(WiFiClientSecure &client, const String &name, size_t size)
{
    File f = SD.open("/" + name, FILE_READ);
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

    // Streamed from the card: a session can be hundreds of KB and the device
    // has nowhere near enough heap to hold one as a String.
    int rc = http.sendRequest("POST", &f, size);
    String payload = http.getString();
    http.end();
    f.close();

    // 200 accepted, 409 already have it -- both mean stop trying. 422 means the
    // server parsed it and found no usable track (an indoor session with no
    // fix); recording it as done stops us re-uploading junk every boot.
    bool done = (rc == 200 || rc == 201 || rc == 409 || rc == 422);
    Serial.printf("  %s (%u B) -> HTTP %d %s\n", name.c_str(), (unsigned)size, rc,
                  done ? "" : payload.substring(0, 60).c_str());
    if (done) markUploaded(name, rc);
    return rc == 200 || rc == 201;
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
        bool isTrack = name.startsWith("track_") && name.endsWith(".csv");
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
        bool isTrack = name.startsWith("track_") && name.endsWith(".csv");
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

        if (!name.startsWith("track_") || !name.endsWith(".csv")) continue;
        if (name == active) continue;             // still being written to
        if (alreadyUploaded(name)) continue;
        // Checked between files, not mid-file: a recording starting must not
        // find the card busy, and an upload must not be torn in half.
        if (g_yield) { Serial.println("sync: yielding card"); break; }

        if (uploadOne(client, name, size)) accepted++;
    }
    root.close();
    Serial.printf("sync: %d session(s) accepted\n", accepted);
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
            if (g_deleteNow) {
                g_deleteNow = false;
                st.busy = true; statusSet(st);
                st.deleted = deleteConfirmedAll();
                g_countNow = true;              // tallies changed
            }
            if (g_countNow) { g_countNow = false; computeCounts(st); }
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
            st.uploadedOk = uplinkSyncSessions();
            computeCounts(st);          // refresh tallies after uploading
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
