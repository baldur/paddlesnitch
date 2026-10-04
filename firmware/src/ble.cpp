#if BLE_ENABLED
#include "ble.h"
#include "ble_about.h"
#include "device_id.h"
#include "netcfg.h"
#include "uplink.h"
#include "dbg.h"
#include <NimBLEDevice.h>

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
static const uint32_t    CONFIRM_MS = 25000;   // under Bluetooth's 30 s pairing timeout

bool bleConfirmPending(uint32_t *pin)
{
    if (s_pending && pin) *pin = s_pin;
    return s_pending;
}
void bleConfirmAnswer(bool yes) { if (s_pending) s_answer = yes ? 1 : 0; }
void bleForgetAll()
{
    NimBLEDevice::deleteAllBonds();
    DBGI("ble", "all pairings forgotten");
    Serial.println("BLE: all pairings forgotten");
}

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer *) override    { DBGI("ble", "connected"); Serial.println("BLE: connected"); }
    void onDisconnect(NimBLEServer *) override { DBGI("ble", "disconnected"); Serial.println("BLE: disconnected"); }

    // NimBLE 1.4 asks this synchronously, on its own task (core 0), so it waits
    // here while the main loop (core 1) shows the number and takes the answer.
    // Nothing else on the Bluetooth link happens meanwhile -- it's pairing.
    bool onConfirmPIN(uint32_t pin) override
    {
        s_answer = -1; s_pin = pin; s_pending = true;
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
        Serial.printf("BLE: pairing %s (bonded=%d, %d pairing(s) stored)\n",
                      ok ? "done" : "failed", desc->sec_state.bonded, NimBLEDevice::getNumBonds());
    }
};

void bleStart()
{
    // Same name as the setup hotspot (PT- + last three of the id), so the
    // browser's list shows a name the owner has already seen.
    const String id = netDeviceId();
    char name[7];
    apSsidFor(id.c_str(), name);

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
    paired->setValue(PS_BLE_PAIRED_JSON);
    svc->start();

    // The service id goes in the advertisement so the page can ask the browser
    // for "paddlesnitch trackers" only; the name goes in the scan response.
    NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
    adv->addServiceUUID(PS_BLE_SERVICE_UUID);
    adv->setScanResponse(true);
    adv->start();

    DBGI("ble", "advertising as %s", name);
    Serial.printf("BLE: advertising as %s\n", name);
}
#endif
