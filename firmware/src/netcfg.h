#pragma once
#include <Arduino.h>

// Persistent network + account configuration, stored in NVS so it survives
// reflashing the application (NVS lives in its own partition).
//
// Nothing here is compiled into the firmware image. A shared API key baked into
// a binary can be read straight off the flash of any device that has one, so
// this device holds only a token it was individually issued and can have
// revoked. See ../../docs/features/device-uplink.md.

struct NetConfig {
    String ssid;
    String pass;
    String baseUrl;       // e.g. "https://paddlesnitch.com"
    String token;         // device bearer token, issued by the claim flow
    String claimSecret;   // proves we are the device that started the claim
    bool   everConnected; // this device has joined this network at least once
};

extern NetConfig netcfg;

void netcfgLoad();
void netcfgSaveWifi(const String &ssid, const String &pass, const String &baseUrl);
void netcfgSetSsid(const String &ssid);
void netcfgSetPass(const String &pass);
void netcfgSaveToken(const String &token);
void netcfgSaveClaimSecret(const String &secret);
void netcfgForget();

bool netHasWifi();
bool netIsClaimed();
void netDisconnect();
void netScan();
String netDeviceId();

// Connects, and on failure explains *why* in words a person can act on.
// Distinguishes "no such network" from "wrong password" by checking whether the
// SSID appeared in a scan, because the raw WiFi status code does not reliably
// tell those apart and they need opposite fixes.
bool netConnect(uint32_t timeoutMs = 15000, String *reason = nullptr);

// Blocking SoftAP + captive portal. `errorNote` is shown at the top of the form
// so a failed attempt explains itself instead of leaving a blank page.
// Returns true if credentials were submitted.
bool netStartPortal(const String &errorNote = "", uint32_t timeoutMs = 600000);

// The whole boot-time network bring-up, including deciding when to fall back to
// the setup portal. Returns true if connected.
bool netBringUp();
