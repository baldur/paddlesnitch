#if BLE_ENABLED
#include "ble.h"
#include "ble_about.h"
#include "device_id.h"
#include "netcfg.h"
#include "uplink.h"
#include "dbg.h"
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <mbedtls/sha256.h>
#include <mbedtls/base64.h>
#include <esp_random.h>
#include <Preferences.h>
extern "C" void ble_svc_gatt_changed(uint16_t start_handle, uint16_t end_handle);

// The tracker's list of items, as a phone would cache it. Change this string
// whenever an item is added, removed or changes its properties: at the next
// boot every paired phone is told the list changed (Service Changed) and
// re-reads it. Without that, a phone paired before an update kept the old
// list and couldn't find the new WIFI item (2026-10-05, Android).
static const char *BLE_LAYOUT = "about,paired,link,wifi,sync,data/v2";

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

// About is built at the moment it's read, so `waiting` is current.
class AboutCallbacks : public NimBLECharacteristicCallbacks {
    void onRead(NimBLECharacteristic *c) override
    {
        const UplinkStatus st = uplinkGetStatus();
        char json[200];
        bleAboutJson(json, sizeof(json), netDeviceId().c_str(), FIRMWARE_VERSION,
                     "lilygo-tbeam-s3-supreme", st.countsValid ? st.pending : -1, netIsClaimed());
        c->setValue((const uint8_t *)json, strlen(json));
        DBGI("ble", "about read");
    }
};

// The number waiting for the owner, and their answer (-1 none yet, 0 no, 1 yes).
static volatile bool     s_pending = false;
static volatile uint32_t s_pin     = 0;
static volatile int      s_answer  = -1;
static volatile uint32_t s_since   = 0;    // millis() when the number appeared
static const uint32_t    CONFIRM_MS = 25000;   // under Bluetooth's 30 s pairing timeout

bool bleConfirmPending(uint32_t *pin)
{
    if (s_pending && pin) *pin = s_pin;
    return s_pending;
}
uint32_t bleConfirmSecondsLeft()
{
    if (!s_pending) return 0;
    const uint32_t used = millis() - s_since;
    return used >= CONFIRM_MS ? 0 : (CONFIRM_MS - used + 999) / 1000;
}
void bleConfirmAnswer(bool yes) { if (s_pending) s_answer = yes ? 1 : 0; }
void bleForgetAll()
{
    NimBLEDevice::deleteAllBonds();
    DBGI("ble", "all pairings forgotten");
    Serial.println("BLE: all pairings forgotten");
}

// ---- LINK: the tracker makes its own token; only the hash leaves it --------
static String s_pendingToken, s_pendingHash;
static bool   s_committed = false;

static String sha256Hex(const String &s)
{
    uint8_t d[32];
    mbedtls_sha256((const uint8_t *)s.c_str(), s.length(), d, 0);
    char hex[65];
    for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", d[i]);
    hex[64] = 0;
    return String(hex);
}

// 32 random bytes, base64url without padding: the same shape as the tokens
// the server issues when linking by code.
static String newToken()
{
    uint8_t raw[32];
    esp_fill_random(raw, sizeof(raw));
    unsigned char b64[64];
    size_t n = 0;
    mbedtls_base64_encode(b64, sizeof(b64), &n, raw, sizeof(raw));
    String t;
    for (size_t i = 0; i < n; i++) {
        char c = (char)b64[i];
        if (c == '=') break;
        t += c == '+' ? '-' : c == '/' ? '_' : c;
    }
    return t;
}

class LinkCallbacks : public NimBLECharacteristicCallbacks {
    void onRead(NimBLECharacteristic *c) override
    {
        char json[200];
        const char *state = s_committed ? "committed" : s_pendingHash.length() ? "pending" : "idle";
        bleLinkJson(json, sizeof(json), netDeviceId().c_str(), state, s_pendingHash.c_str());
        c->setValue((const uint8_t *)json, strlen(json));
    }
    void onWrite(NimBLECharacteristic *c) override
    {
        JsonDocument doc;
        if (deserializeJson(doc, c->getValue().c_str())) return;
        const char *op = doc["op"] | "";
        if (!strcmp(op, "begin")) {
            s_pendingToken = newToken();
            s_pendingHash  = sha256Hex(s_pendingToken);
            s_committed    = false;
            DBGI("ble", "link: begin");
            Serial.println("BLE: link begun (token made, hash ready)");
        } else if (!strcmp(op, "commit")) {
            // Only the token whose hash the page just registered. Anything else
            // (a stale page, a second browser) leaves the tracker as it was.
            const char *h = doc["tokenHash"] | "";
            if (s_pendingToken.length() && s_pendingHash == h) {
                netcfgSaveToken(s_pendingToken);
                s_pendingToken = "";
                s_committed = true;
                DBGI("ble", "link: committed");
                Serial.println("BLE: linked to an account over Bluetooth");
            } else {
                DBGW("ble", "link: commit refused (hash mismatch or nothing pending)");
                Serial.println("BLE: link commit refused");
            }
        }
    }
};

// ---- WIFI: try a network before saving it (the uplink task does the work) --
class WifiCallbacks : public NimBLECharacteristicCallbacks {
    void onRead(NimBLECharacteristic *c) override
    {
        char json[64];
        bleWifiJson(json, sizeof(json), wifiTrialName(uplinkWifiTrial()));
        c->setValue((const uint8_t *)json, strlen(json));
    }
    void onWrite(NimBLECharacteristic *c) override
    {
        JsonDocument doc;
        if (deserializeJson(doc, c->getValue().c_str())) return;
        const String ssid = doc["ssid"] | "";
        const String pass = doc["pass"] | "";
        if (!ssid.length() || ssid.length() > 32 || pass.length() > 64) return;
        DBGI("ble", "wifi: trying a network");
        Serial.printf("BLE: WiFi details received for \"%s\", trying them\n", ssid.c_str());
        uplinkTryWifi(ssid, pass);
    }
};

// ---- SYNC + DATA: recordings home over Bluetooth (uplink task does the work)
class SyncCallbacks : public NimBLECharacteristicCallbacks {
    void onRead(NimBLECharacteristic *c) override
    {
        char json[160];
        uplinkBtStatus(json, sizeof(json));
        c->setValue((const uint8_t *)json, strlen(json));
    }
    void onWrite(NimBLECharacteristic *c) override
    {
        JsonDocument doc;
        if (deserializeJson(doc, c->getValue().c_str())) return;
        const char *op = doc["op"] | "";
        const String name = doc["name"] | "";
        if (name.length() > 64 || name.indexOf('/') >= 0) return;
        if (!strcmp(op, "list"))       uplinkBtList();
        else if (!strcmp(op, "piece")) uplinkBtPiece(name, doc["part"] | 0);
        else if (!strcmp(op, "done"))  uplinkBtDone(name, doc["receipt"] | "");
    }
};

class DataCallbacks : public NimBLECharacteristicCallbacks {
    // One page per read (NimBLE calls this once per read, not per blob of a
    // long read), so the cursor advances exactly once per page.
    void onRead(NimBLECharacteristic *c) override
    {
        static uint8_t page[4 + PS_BLE_PAGE_DATA];
        const size_t n = uplinkBtPage(page, sizeof(page));
        c->setValue(page, n);
    }
    void onWrite(NimBLECharacteristic *c) override
    {
        JsonDocument doc;
        if (deserializeJson(doc, c->getValue().c_str())) return;
        if (!strcmp(doc["op"] | "", "seek")) uplinkBtSeek(doc["offset"] | 0u);
    }
};

class ServerCallbacks : public NimBLEServerCallbacks {
    // Which phone or computer, by address, so a log can tell them apart (a
    // tab left connected on the Mac once hid the tracker from a phone).
    void onConnect(NimBLEServer *, ble_gap_conn_desc *desc) override
    {
        const std::string who = NimBLEAddress(desc->peer_ota_addr).toString();
        DBGI("ble", "connected %s", who.c_str());
        Serial.printf("BLE: connected %s\n", who.c_str());
        // Keep advertising while connected (up to 3 connections), so a second
        // phone or computer can still find the tracker.
        NimBLEDevice::startAdvertising();
    }
    void onDisconnect(NimBLEServer *, ble_gap_conn_desc *desc) override
    {
        const std::string who = NimBLEAddress(desc->peer_ota_addr).toString();
        DBGI("ble", "disconnected %s", who.c_str());
        Serial.printf("BLE: disconnected %s\n", who.c_str());
    }

    // NimBLE 1.4 asks this synchronously, on its own task (core 0), so it waits
    // here while the main loop (core 1) shows the number and takes the answer.
    // Nothing else on the Bluetooth link happens meanwhile -- it's pairing.
    bool onConfirmPIN(uint32_t pin) override
    {
        s_answer = -1; s_pin = pin; s_since = millis(); s_pending = true;
        DBGI("ble", "pairing: confirm %06lu", (unsigned long)pin);
        Serial.printf("BLE: pairing, number %06lu -- hold to confirm\n", (unsigned long)pin);
        const uint32_t t0 = millis();
        while (s_answer < 0 && millis() - t0 < CONFIRM_MS) delay(50);
        const bool yes = s_answer == 1;
        s_pending = false;
        DBGI("ble", "pairing %s", yes ? "confirmed" : (s_answer < 0 ? "timed out" : "refused"));
        Serial.printf("BLE: pairing %s\n", yes ? "confirmed" : (s_answer < 0 ? "timed out" : "refused"));
        return yes;
    }

    void onAuthenticationComplete(ble_gap_conn_desc *desc) override
    {
        const bool ok = desc->sec_state.encrypted && desc->sec_state.authenticated;
        DBGI("ble", "pairing %s, bonded=%d", ok ? "done" : "failed", desc->sec_state.bonded);
        Serial.printf("BLE: pairing %s with %s (bonded=%d, %d pairing(s) stored)\n",
                      ok ? "done" : "failed", NimBLEAddress(desc->peer_ota_addr).toString().c_str(),
                      desc->sec_state.bonded, NimBLEDevice::getNumBonds());
    }
};

#ifndef BLE_DEFAULT_ON
#define BLE_DEFAULT_ON 0
#endif
static bool s_running = false;
static char s_name[8] = "";

bool bleEnabledSetting()
{
    Preferences p;
    if (!p.begin("ble", true)) return BLE_DEFAULT_ON;   // never written
    const bool on = p.getBool("on", BLE_DEFAULT_ON);
    p.end();
    return on;
}
void bleSetEnabled(bool on)
{
    Preferences p;
    if (!p.begin("ble", false)) return;
    p.putBool("on", on);
    p.end();
}
bool bleRunning() { return s_running; }
int  bleBondCount() { return s_running ? NimBLEDevice::getNumBonds() : 0; }
const char *bleName() { return s_name; }

void bleStart()
{
    if (s_running) return;
    // Same name as the setup hotspot (PT- + last three of the id), so the
    // browser's list shows a name the owner has already seen.
    const String id = netDeviceId();
    char name[7];
    apSsidFor(id.c_str(), name);

    snprintf(s_name, sizeof(s_name), "%s", name);
    NimBLEDevice::init(name);
    // Pairing with number comparison: the tracker has a screen and a button,
    // so both sides show the same 6 digits and the owner confirms on the
    // tracker. Bonded, so the pairing survives a restart (stored in NVS).
    NimBLEDevice::setSecurityAuth(true, true, true);          // bond, MITM, secure connections
    NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_YESNO);
    NimBLEServer *server = NimBLEDevice::createServer();
    server->setCallbacks(new ServerCallbacks());   // NimBLE restarts advertising on disconnect

    NimBLEService *svc = server->createService(PS_BLE_SERVICE_UUID);
    NimBLECharacteristic *about = svc->createCharacteristic(PS_BLE_ABOUT_UUID, NIMBLE_PROPERTY::READ);
    about->setCallbacks(new AboutCallbacks());
    // Readable only once paired: a refused read is what starts pairing.
    NimBLECharacteristic *paired = svc->createCharacteristic(PS_BLE_PAIRED_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::READ_AUTHEN);
    // Explicit length: setValue() of a string literal copied its terminating
    // zero byte too, and the page's JSON.parse refused it ("unexpected reply"
    // on a phone that had paired).
    paired->setValue((const uint8_t *)PS_BLE_PAIRED_JSON, strlen(PS_BLE_PAIRED_JSON));
    // Setup items: paired and encrypted only, for reading AND writing.
    const uint32_t SECURE_RW = NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::READ_AUTHEN |
                               NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::WRITE_AUTHEN;
    svc->createCharacteristic(PS_BLE_LINK_UUID, SECURE_RW)->setCallbacks(new LinkCallbacks());
    svc->createCharacteristic(PS_BLE_WIFI_UUID, SECURE_RW)->setCallbacks(new WifiCallbacks());
    svc->createCharacteristic(PS_BLE_SYNC_UUID, SECURE_RW)->setCallbacks(new SyncCallbacks());
    svc->createCharacteristic(PS_BLE_DATA_UUID, SECURE_RW)->setCallbacks(new DataCallbacks());
    svc->start();

    // The service id goes in the advertisement so the page can ask the browser
    // for "paddlesnitch trackers" only; the name goes in the scan response.
    NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
    adv->addServiceUUID(PS_BLE_SERVICE_UUID);
    adv->setScanResponse(true);
    adv->start();

    // Tell paired phones the list changed, once per change (see BLE_LAYOUT).
    // NimBLE keeps this for each bonded phone and sends it when it next
    // connects; a phone that doesn't listen gets the page's "forget and pair
    // again" message instead.
    Preferences p;
    if (p.begin("ble", false)) {
        if (p.getString("layout", "") != BLE_LAYOUT) {
            ble_svc_gatt_changed(0x0001, 0xffff);
            p.putString("layout", BLE_LAYOUT);
            DBGI("ble", "layout changed: told paired phones");
            Serial.println("BLE: item list changed since last boot -- paired phones told to re-read it");
        }
        p.end();
    }

    s_running = true;
    DBGI("ble", "advertising as %s", name);
    Serial.printf("BLE: advertising as %s\n", name);
}
#endif
