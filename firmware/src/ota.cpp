#include "ota.h"
#include "ota_policy.h"
#include "netcfg.h"
#include "board.h"
#include "storage.h"
#include "dbg.h"
#include "root_ca.h"

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

// NVS lives in its own partition and survives a firmware write, which is the
// only reason app-level rollback can work at all: the flag that says "this image
// is on trial" has to outlive the image being installed.
static const char *NVS_NS = "ota";
static const char *K_PENDING = "pending";   // version on trial, "" when none
static const char *K_BOOTS   = "boots";     // boots so far on that trial image
static const char *K_PREV    = "prev";      // version we came FROM, for the ack
static const char *K_NOTES   = "notes";     // release note, shown once after update
static const char *K_ACKVER  = "ackver";    // outcome awaiting delivery
static const char *K_ACKOK   = "ackok";
static const char *K_ACKRB   = "ackrb";
static const char *K_SHOWVER = "showver";   // "Updated to X" not yet dismissed

// Per-version failure counters are keyed by version, so a NEW version always
// starts with a clean slate — that is what lets a fixed build through after a
// broken one has used up its three strikes.
static String failKey(const String &v) { return "f_" + v; }

static String   g_serverVersion;     // latest X-PS-Firmware seen this boot
static uint32_t g_lastProbeMs = 0;   // 0 = never probed this boot

// The "Updated to X" notice, cached in RAM.
//
// These used to read NVS on every call, and the UI tick calls otaJustUpdated()
// at 4 Hz -- so a device with no `ota` namespace yet (every device, until the
// first update) logged two nvs_open NOT_FOUND errors eight times a second,
// burying the serial log that is this firmware's main diagnostic. Reading flash
// at 4 Hz to answer a question that changes twice in a device's life was the
// real mistake; the log spam just made it visible.
static String g_showVersion;
static String g_showNotes;
static OtaProgress g_progress;

// How often a device that has heard NOTHING may ask outright.
//
// The spec put this at 7 days, on the reasoning that the signal rides on
// requests the device is already making. That reasoning has a hole: a device
// with nothing to upload makes NO authenticated request at all --
// uplinkSyncSessions returns early when the card has no pending files -- so it
// never receives a response to carry the header. An idle device would sit a
// week behind, and a bench device with an empty card would never update at all,
// which makes the feature untestable.
//
// One hour, and ONLY when no header has been seen this boot. A device that is
// actually uploading still costs zero extra requests, which was the point.
static const uint32_t OTA_PROBE_INTERVAL_MS = 60UL * 60UL * 1000UL;
static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

static void setProgress(OtaPhase phase, uint8_t percent, const char *version, const char *message)
{
    portENTER_CRITICAL(&g_mux);
    g_progress.phase   = phase;
    g_progress.percent = percent;
    if (version) snprintf(g_progress.version, sizeof(g_progress.version), "%s", version);
    if (message) snprintf(g_progress.message, sizeof(g_progress.message), "%s", message);
    portEXIT_CRITICAL(&g_mux);
}

OtaProgress otaGetProgress()
{
    portENTER_CRITICAL(&g_mux);
    OtaProgress copy = g_progress;
    portEXIT_CRITICAL(&g_mux);
    return copy;
}

// ---------------------------------------------------------------------------
// Boot-time rollback
// ---------------------------------------------------------------------------

void otaBootCheck()
{
    Preferences p;
    if (!p.begin(NVS_NS, false)) { DBGE("ota", "nvs open failed"); return; }

    // Load the notice into RAM while the namespace is already open read-write.
    // This is the ONLY place it is read from flash.
    g_showVersion = p.getString(K_SHOWVER, "");
    g_showNotes   = p.getString(K_NOTES, "");

    String pending = p.getString(K_PENDING, "");
    if (pending.isEmpty()) {
        // Normal boot. If a previous update completed and has not been shown to
        // the user yet, leave that notice alone — it is cleared by a button press.
        p.end();
        return;
    }

    uint8_t boots = p.getUChar(K_BOOTS, 0) + 1;
    String  prev  = p.getString(K_PREV, "");

    if (boots > OTA_MAX_BOOTS) {
        // Three goes and it still has not reached otaMarkValid(). Put the old
        // image back. esp_ota_get_last_invalid_partition() is not used here: we
        // want the OTHER slot, which is where the previous image still sits
        // untouched — an OTA never erases the slot it booted from.
        const esp_partition_t *other = esp_ota_get_next_update_partition(nullptr);
        DBGE("ota", "rollback after %u boots, back to %s", boots, other ? other->label : "?");
        Serial.printf("OTA: %s failed %u boots -- rolling back\n", pending.c_str(), boots);

        p.putString(K_ACKVER, pending);
        p.putBool(K_ACKOK, false);
        p.putBool(K_ACKRB, true);
        p.remove(K_PENDING);
        p.remove(K_BOOTS);
        // Count the failure so the same version is not pulled again forever.
        p.putUChar(failKey(pending).c_str(), OTA_MAX_FAILS);
        p.end();

        if (other) esp_ota_set_boot_partition(other);
        delay(100);
        ESP.restart();
        return;
    }

    p.putUChar(K_BOOTS, boots);
    p.end();
    DBGI("ota", "trial boot %u/%u on %s (from %s)", boots, OTA_MAX_BOOTS, pending.c_str(), prev.c_str());
    Serial.printf("OTA: trial boot %u/%u on %s\n", boots, OTA_MAX_BOOTS, pending.c_str());
}

void otaMarkValid()
{
    Preferences p;
    if (!p.begin(NVS_NS, false)) return;
    String pending = p.getString(K_PENDING, "");
    if (pending.isEmpty()) { p.end(); return; }

    String prev = p.getString(K_PREV, "");
    p.remove(K_PENDING);
    p.remove(K_BOOTS);
    p.remove(failKey(pending).c_str());     // it worked; forget its failures
    // Queue the ack and the one-time "Updated to X" notice.
    p.putString(K_ACKVER, pending);
    p.putBool(K_ACKOK, true);
    p.putBool(K_ACKRB, false);
    p.putString(K_SHOWVER, pending);
    p.end();
    // RAM copy too: the accessors read RAM, and this runs long after the boot
    // load above, so without this the notice would not appear until a reboot.
    g_showVersion = pending;

    // Tells the bootloader this image is good. Harmless when rollback is not
    // enabled in the prebuilt Arduino bootloader — the app-level counter above
    // is the layer we actually rely on.
    esp_ota_mark_app_valid_cancel_rollback();

    DBGI("ota", "validated %s (from %s)", pending.c_str(), prev.c_str());
    Serial.printf("OTA: %s validated\n", pending.c_str());
}

bool   otaJustUpdated()        { return !g_showVersion.isEmpty(); }
String otaJustUpdatedVersion() { return g_showVersion; }
String otaJustUpdatedNotes()   { return g_showNotes; }

void otaDismissUpdatedNotice()
{
    if (g_showVersion.isEmpty()) return;      // nothing to clear, no flash write
    g_showVersion = "";
    g_showNotes   = "";
    Preferences p;
    if (!p.begin(NVS_NS, false)) return;
    p.remove(K_SHOWVER);
    p.remove(K_NOTES);
    p.end();
}

// ---------------------------------------------------------------------------
// The signal
// ---------------------------------------------------------------------------

void otaNoteServerVersion(const char *version)
{
    // Absent header = no opinion. Never treat it as "you are current", and
    // never let it clear a version we already learned this boot.
    if (!version || !*version) return;
    if (g_serverVersion == version) return;
    g_serverVersion = version;
    DBGI("ota", "server says %s (running %s)", version, FIRMWARE_VERSION);
}

// ---------------------------------------------------------------------------
// The update
// ---------------------------------------------------------------------------

static void configureClient(WiFiClientSecure &c)
{
    // The pinned root, never setInsecure(). The presigned URL points at S3,
    // a different host from paddlesnitch.com, but S3 also chains to Amazon
    // Root CA 1 so the same pin covers both.
    c.setCACert(AMAZON_ROOT_CAS);
    c.setTimeout(20000);
}

static uint8_t failCountFor(const String &version)
{
    Preferences p;
    if (!p.begin(NVS_NS, true)) return 0;
    uint8_t n = p.getUChar(failKey(version).c_str(), 0);
    p.end();
    return n;
}

static void recordFailure(const String &version, const char *why)
{
    Preferences p;
    if (!p.begin(NVS_NS, false)) return;
    uint8_t n = p.getUChar(failKey(version).c_str(), 0) + 1;
    p.putUChar(failKey(version).c_str(), n);
    p.end();
    DBGE("ota", "attempt %u/%u on %s failed: %s", n, OTA_MAX_FAILS, version.c_str(), why);
    Serial.printf("OTA: %s attempt %u failed -- %s\n", version.c_str(), n, why);
    setProgress(OtaPhase::Failed, 0, version.c_str(), why);
}

static bool hexEqualIgnoreCase(const String &a, const String &b)
{
    if (a.length() != b.length()) return false;
    for (size_t i = 0; i < a.length(); i++) {
        if (tolower((unsigned char)a[i]) != tolower((unsigned char)b[i])) return false;
    }
    return true;
}

/** Download the image straight into the inactive slot, verifying sha256 over the
 *  stream as it is written. Never touches the SD card. */
static bool downloadAndFlash(const String &url, const String &version,
                             size_t expectedSize, const String &expectedSha)
{
    WiFiClientSecure client;
    configureClient(client);

    HTTPClient http;
    if (!http.begin(client, url)) { recordFailure(version, "begin failed"); return false; }
    // The presigned URL can redirect; follow it, still verifying TLS.
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(60000);   // uint16 ceiling is 65535 -- see uplink.cpp

    int rc = http.GET();
    if (rc != HTTP_CODE_OK) {
        http.end();
        recordFailure(version, (String("http ") + rc).c_str());
        return false;
    }

    int len = http.getSize();
    if (len > 0 && (size_t)len != expectedSize) {
        http.end();
        recordFailure(version, "size mismatch");
        return false;
    }

    if (!Update.begin(expectedSize, U_FLASH)) {
        http.end();
        recordFailure(version, "no room in the inactive slot");
        return false;
    }

    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);

    WiFiClient *stream = http.getStreamPtr();
    static uint8_t buf[4096];          // static: the uplink task's stack is 8 KB
    size_t written = 0;
    uint32_t lastTick = millis();
    bool ok = true;

    while (http.connected() && written < expectedSize) {
        size_t avail = stream->available();
        if (!avail) {
            if (millis() - lastTick > 30000) { ok = false; break; }   // stalled
            delay(10);
            continue;
        }
        size_t want = avail > sizeof(buf) ? sizeof(buf) : avail;
        if (want > expectedSize - written) want = expectedSize - written;
        int got = stream->readBytes(buf, want);
        if (got <= 0) { delay(5); continue; }

        if (Update.write(buf, got) != (size_t)got) { ok = false; break; }
        mbedtls_sha256_update(&sha, buf, got);
        written += got;
        lastTick = millis();

        uint8_t pct = expectedSize ? (uint8_t)((written * 100) / expectedSize) : 0;
        setProgress(OtaPhase::Downloading, pct, version.c_str(), "downloading");
    }
    http.end();

    uint8_t digest[32];
    mbedtls_sha256_finish(&sha, digest);
    mbedtls_sha256_free(&sha);

    if (!ok || written != expectedSize) {
        Update.abort();
        recordFailure(version, "download truncated");
        return false;
    }

    // Verify BEFORE Update.end(). Update.end() validates the image STRUCTURE,
    // not that these are the bytes the server meant — a mirror serving a valid
    // but different image would sail past it.
    setProgress(OtaPhase::Verifying, 100, version.c_str(), "verifying");
    char hex[65];
    for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", digest[i]);
    hex[64] = '\0';
    if (!hexEqualIgnoreCase(String(hex), expectedSha)) {
        Update.abort();
        recordFailure(version, "sha256 mismatch");
        return false;
    }

    if (!Update.end(true)) {
        recordFailure(version, (String("end ") + Update.errorString()).c_str());
        return false;
    }

    // Only NOW does otadata move. Everything above is safe to lose to a power
    // cut: the half-written inactive slot is simply never booted.
    Preferences p;
    if (p.begin(NVS_NS, false)) {
        p.putString(K_PENDING, version);
        p.putUChar(K_BOOTS, 0);
        p.putString(K_PREV, FIRMWARE_VERSION);
        p.end();
    }

    setProgress(OtaPhase::Done, 100, version.c_str(), "rebooting");
    DBGI("ota", "flashed %s, rebooting", version.c_str());
    Serial.printf("OTA: flashed %s -- rebooting\n", version.c_str());
    return true;
}

/** Fetch the manifest. Returns the HTTP status; fills the out-params on 200. */
static int fetchManifest(String &version, String &sha, String &url, String &notes, size_t &size)
{
    WiFiClientSecure client;
    configureClient(client);
    HTTPClient http;
    String u = netcfg.baseUrl + "/api/devices/firmware?current=" + FIRMWARE_VERSION;
    if (!http.begin(client, u)) return -1;
    http.addHeader("Authorization", "Bearer " + netcfg.token);
    http.addHeader("X-Device-Firmware", FIRMWARE_VERSION);
    http.addHeader("X-Device-Model", "lilygo-tbeam-s3-supreme");
    http.setTimeout(20000);

    int rc = http.GET();
    String payload = http.getString();
    http.end();
    if (rc != 200) return rc;

    JsonDocument doc;
    if (deserializeJson(doc, payload)) return -2;
    version = doc["version"]   | "";
    sha     = doc["sha256"]    | "";
    url     = doc["url"]       | "";
    notes   = doc["notes"]     | "";
    size    = doc["sizeBytes"] | 0;
    if (version.isEmpty() || sha.length() != 64 || url.isEmpty() || size == 0) return -3;
    return 200;
}

bool otaMaybeUpdate()
{
    const bool haveSignal = !g_serverVersion.isEmpty();
    const bool signalled  = haveSignal && otaVersionDiffers(FIRMWARE_VERSION, g_serverVersion.c_str());
    // Only a device that has heard nothing at all asks outright, and then at
    // most hourly. A device that uploads regularly never takes this path.
    const bool probeDue   = !haveSignal &&
                            (g_lastProbeMs == 0 || millis() - g_lastProbeMs > OTA_PROBE_INTERVAL_MS);

    if (!signalled && !probeDue) return false;

    // Environmental gates BEFORE any network call: no point asking, let alone
    // downloading, while recording or on a flat battery. The version-specific
    // gate is re-checked below, once we actually know which version it is.
    OtaGateInputs gi;
    gi.havePendingVersion = true;
    gi.versionDiffers     = true;
    gi.recording          = storageRecording();
    gi.wifiUp             = (WiFi.status() == WL_CONNECTED);
    gi.everConnected      = netcfg.everConnected;
    gi.onUsb              = boardOnUsb();
    gi.charging           = boardIsCharging();
    gi.batteryMv          = boardBatteryMv();
    gi.failCount          = haveSignal ? failCountFor(g_serverVersion) : 0;

    OtaGate g = otaEvaluateGates(gi);
    if (g != OtaGate::Go) {
        DBGI("ota", "holding off: %s", otaGateReason(g));
        return false;
    }

    setProgress(OtaPhase::Checking, 0, haveSignal ? g_serverVersion.c_str() : "", "checking");
    if (probeDue) {
        g_lastProbeMs = millis();
        DBGI("ota", "no signal this boot -- asking outright");
    }

    String version, sha, url, notes;
    size_t size = 0;
    int rc = fetchManifest(version, sha, url, notes, size);

    // 304: already current. Not a failure -- never count it against a version.
    // Clear the signalled version too, so a header that raced a promotion does
    // not make us re-ask on every sync.
    if (rc == 304) {
        DBGI("ota", "asked: already current (%s)", FIRMWARE_VERSION);
        setProgress(OtaPhase::Idle, 0, "", "");
        g_serverVersion = "";
        return false;
    }
    // 404 no_channel is the normal state before the first release -- but LOG it.
    //
    // This used to return silently, on the reasoning that a normal state is not
    // worth a line. That was wrong, and it cost a real debugging session: the
    // ring showed "asking outright" and then nothing, so "asked, and nothing is
    // released" looked identical to "the request never happened". A device that
    // checked and found nothing has done its job, and the log is the only place
    // that can say so.
    if (rc == 404) {
        DBGI("ota", "asked: nothing promoted to stable yet");
        setProgress(OtaPhase::Idle, 0, "", "");
        return false;
    }
    if (rc != 200) {
        if (haveSignal) recordFailure(g_serverVersion, (String("manifest http ") + rc).c_str());
        else            DBGW("ota", "probe failed http %d", rc);
        return false;
    }

    // Now the version is known for certain -- which matters on the probe path,
    // where we had nothing to check a failure count against until this moment.
    if (!otaVersionDiffers(FIRMWARE_VERSION, version.c_str())) {
        DBGI("ota", "asked: stable is %s, already running it", version.c_str());
        setProgress(OtaPhase::Idle, 0, "", "");
        g_serverVersion = "";
        return false;
    }
    if (!otaMayRetryVersion(failCountFor(version))) {
        DBGI("ota", "holding off: %s", otaGateReason(OtaGate::TooManyFailures));
        setProgress(OtaPhase::Idle, 0, "", "");
        return false;
    }

    // Stash the release note now: after the reboot the manifest is gone, and the
    // note is what tells the user what changed.
    Preferences p;
    if (p.begin(NVS_NS, false)) { p.putString(K_NOTES, notes); p.end(); }

    DBGI("ota", "offered %s (%u B), starting", version.c_str(), (unsigned)size);
    Serial.printf("OTA: %s -> %s (%u bytes)\n", FIRMWARE_VERSION, version.c_str(), (unsigned)size);
    if (!downloadAndFlash(url, version, size, sha)) return false;

    delay(250);        // let the serial line drain so the last message is seen
    ESP.restart();
    return true;       // not reached
}

// ---------------------------------------------------------------------------
// The ack
// ---------------------------------------------------------------------------

bool otaAckPending()
{
    Preferences p;
    if (!p.begin(NVS_NS, true)) return false;
    bool has = !p.getString(K_ACKVER, "").isEmpty();
    p.end();
    return has;
}

void otaSendAck()
{
    Preferences p;
    if (!p.begin(NVS_NS, false)) return;
    String version = p.getString(K_ACKVER, "");
    if (version.isEmpty()) { p.end(); return; }
    bool bootOk    = p.getBool(K_ACKOK, false);
    bool rolledBack= p.getBool(K_ACKRB, false);
    String prev    = p.getString(K_PREV, "");
    p.end();

    if (netcfg.token.isEmpty() || WiFi.status() != WL_CONNECTED) return;

    WiFiClientSecure client;
    configureClient(client);
    HTTPClient http;
    if (!http.begin(client, netcfg.baseUrl + "/api/devices/firmware/ack")) return;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " + netcfg.token);
    http.addHeader("X-Device-Firmware", FIRMWARE_VERSION);
    http.addHeader("X-Device-Model", "lilygo-tbeam-s3-supreme");
    http.setTimeout(15000);

    JsonDocument body;
    body["version"]         = version;
    body["previousVersion"] = prev;
    body["bootOk"]          = bootOk;
    body["rolledBack"]      = rolledBack;
    body["resetReason"]     = resetReasonStr();
    String out; serializeJson(body, out);

    int rc = http.POST(out);
    http.end();

    // Clear ONLY on success. The server is idempotent on (deviceId, version), so
    // a retry after a dropped response costs nothing and losing the ack would
    // leave a rollout looking permanently incomplete.
    if (rc >= 200 && rc < 300) {
        Preferences q;
        if (q.begin(NVS_NS, false)) {
            q.remove(K_ACKVER); q.remove(K_ACKOK); q.remove(K_ACKRB);
            q.end();
        }
        DBGI("ota", "acked %s bootOk=%d rolledBack=%d", version.c_str(), bootOk, rolledBack);
    } else {
        DBGE("ota", "ack failed http %d -- will retry", rc);
    }
}
