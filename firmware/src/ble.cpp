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

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer *) override    { DBGI("ble", "connected"); Serial.println("BLE: connected"); }
    void onDisconnect(NimBLEServer *) override { DBGI("ble", "disconnected"); Serial.println("BLE: disconnected"); }
};

void bleStart()
{
    // Same name as the setup hotspot (PT- + last three of the id), so the
    // browser's list shows a name the owner has already seen.
    const String id = netDeviceId();
    char name[7];
    apSsidFor(id.c_str(), name);

    NimBLEDevice::init(name);
    NimBLEServer *server = NimBLEDevice::createServer();
    server->setCallbacks(new ServerCallbacks());   // NimBLE restarts advertising on disconnect

    NimBLEService *svc = server->createService(PS_BLE_SERVICE_UUID);
    NimBLECharacteristic *about = svc->createCharacteristic(PS_BLE_ABOUT_UUID, NIMBLE_PROPERTY::READ);
    about->setCallbacks(new AboutCallbacks());
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
