#include "netcfg.h"
#include "board.h"
#include "board_pins.h"
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>

NetConfig netcfg;
static Preferences prefs;
static const char *NS = "paddle";

String netDeviceId()
{
    uint64_t mac = ESP.getEfuseMac();
    char id[9];
    snprintf(id, sizeof(id), "%08X", (uint32_t)(mac & 0xFFFFFFFF));
    return String(id);
}

void netcfgLoad()
{
    // Two quirks of the Preferences library, both of which make a perfectly
    // healthy fresh device look broken in the boot log:
    //   - opening read-only before anything was ever written logs
    //     "nvs_open failed: NOT_FOUND", so open writable (no write happens here)
    //   - getString() on a missing key logs an ERROR even with a default given,
    //     so guard every read with isKey()
    prefs.begin(NS, false);
    auto get = [&](const char *k, const char *dflt) -> String {
        return prefs.isKey(k) ? prefs.getString(k) : String(dflt);
    };
    netcfg.ssid          = get("ssid", "");
    netcfg.pass          = get("pass", "");
    netcfg.baseUrl       = get("url", "https://paddlesnitch.com");
    netcfg.token         = get("token", "");
    netcfg.claimSecret   = get("secret", "");
    netcfg.everConnected = prefs.isKey("okonce") ? prefs.getBool("okonce") : false;
    prefs.end();
}

static void put(const char *k, const String &v)
{
    prefs.begin(NS, false); prefs.putString(k, v); prefs.end();
}

void netcfgSaveWifi(const String &ssid, const String &pass, const String &baseUrl)
{
    put("ssid", ssid); put("pass", pass); put("url", baseUrl);
    netcfg.ssid = ssid; netcfg.pass = pass; netcfg.baseUrl = baseUrl;
}
void netcfgSetSsid(const String &v)         { put("ssid", v);   netcfg.ssid = v; }
void netcfgSetPass(const String &v)         { put("pass", v);   netcfg.pass = v; }
void netcfgSaveToken(const String &t)       { put("token", t);  netcfg.token = t; }
void netcfgSaveClaimSecret(const String &s) { put("secret", s); netcfg.claimSecret = s; }

static void markConnectedOnce()
{
    if (netcfg.everConnected) return;
    prefs.begin(NS, false); prefs.putBool("okonce", true); prefs.end();
    netcfg.everConnected = true;
}

void netcfgForget()
{
    prefs.begin(NS, false); prefs.clear(); prefs.end();
    netcfg = NetConfig();
    netcfg.baseUrl = "https://paddlesnitch.com";
}

bool netHasWifi()   { return netcfg.ssid.length() > 0; }
bool netIsClaimed() { return netcfg.token.length() > 0; }

void netDisconnect()
{
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
}

// ---------------------------------------------------------------------------
// Small OLED helper — the device is often set up with no laptop attached, so
// every state that can block the user has to be legible on the screen itself.
// ---------------------------------------------------------------------------
static void screen(const char *l1, const char *l2 = "", const char *l3 = "",
                   const char *l4 = "")
{
    if (!display.begin()) return;
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 11, l1);
    display.drawStr(0, 27, l2);
    display.drawStr(0, 43, l3);
    display.drawStr(0, 59, l4);
    display.sendBuffer();
}

// 1 = visible, 0 = not visible, -1 = could not tell.
// The -1 case is essential: a scan started while the radio is still retrying a
// failed association returns nothing, which is indistinguishable from "network
// absent" unless you check. Reporting "can't see it" then sends the user to fix
// a network name that was never the problem.
static int ssidVisible(const String &ssid)
{
    WiFi.disconnect(false, false);
    delay(300);
    int n = WiFi.scanNetworks();
    if (n <= 0) { WiFi.scanDelete(); return -1; }
    bool found = false;
    for (int i = 0; i < n; i++) if (WiFi.SSID(i) == ssid) { found = true; break; }
    WiFi.scanDelete();
    return found ? 1 : 0;
}

void netScan()
{
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(100);
    int n = WiFi.scanNetworks();
    Serial.printf("visible 2.4 GHz networks (%d):\n", n);
    for (int i = 0; i < n; i++) {
        Serial.printf("  %-32s ch%-3d %4d dBm %s\n",
                      WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i),
                      WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "open" : "");
    }
    WiFi.scanDelete();
    Serial.printf("configured ssid: [%s] (%d chars)\n",
                  netcfg.ssid.c_str(), netcfg.ssid.length());
}

bool netConnect(uint32_t timeoutMs, String *reason)
{
    if (!netHasWifi()) { if (reason) *reason = "No network configured."; return false; }
    if (WiFi.status() == WL_CONNECTED) return true;

    WiFi.mode(WIFI_STA);
    WiFi.begin(netcfg.ssid.c_str(), netcfg.pass.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) delay(200);

    if (WiFi.status() == WL_CONNECTED) {
        markConnectedOnce();
        Serial.printf("WiFi: connected %s\n", WiFi.localIP().toString().c_str());
        return true;
    }

    // Which failure it is decides what the user should do, and the status code
    // alone does not reliably say. A scan does.
    if (reason) {
        switch (ssidVisible(netcfg.ssid)) {
        case 1:
            *reason = "Found \"" + netcfg.ssid + "\" but couldn't join it — "
                      "the password is probably wrong.";
            break;
        case 0:
            *reason = "Can't see \"" + netcfg.ssid + "\". Names are case-sensitive, "
                      "and this device only supports 2.4 GHz networks (not 5 GHz).";
            break;
        default:
            *reason = "Couldn't join \"" + netcfg.ssid + "\". Check the name "
                      "(case-sensitive), the password, and that it is a 2.4 GHz network.";
            break;
        }
    }
    Serial.printf("WiFi: failed to connect to %s\n", netcfg.ssid.c_str());
    return false;
}

// ---------------------------------------------------------------------------
// Setup portal
// ---------------------------------------------------------------------------

static const char PORTAL_HTML[] PROGMEM = R"HTML(<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Set up tracker</title>
<style>
body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;background:#101317;color:#eef1f5}
.w{max-width:420px;margin:0 auto;padding:28px 20px 48px}
h1{font-size:22px;margin:0 0 4px}
p.sub{color:#a4aeba;margin:0 0 20px;font-size:14px}
.err{background:#3a1d1d;border:1px solid #7a3535;color:#ffd9d9;padding:12px 14px;
 border-radius:8px;font-size:14px;margin:0 0 20px}
label{display:block;font-size:13px;color:#a4aeba;margin:16px 0 5px}
input,select{width:100%;padding:11px 12px;font-size:16px;border-radius:8px;
 border:1px solid #39414c;background:#161a20;color:#eef1f5;box-sizing:border-box}
button{width:100%;margin-top:24px;padding:13px;font-size:16px;font-weight:600;border:0;
 border-radius:8px;background:#3987e5;color:#fff}
code{color:#7fb5ef}
.hint{font-size:12.5px;color:#6d7783;margin:6px 0 0}
</style>
<div class=w><h1>Paddle tracker setup</h1>
<p class=sub>Device <code>%DEVICEID%</code></p>
%ERROR%
<form method=POST action=/save>
<label>Your WiFi network</label>
<select id=pick onchange="if(this.value){document.getElementById('s').value=this.value}">
<option value="">— pick from the list —</option>
%OPTIONS%
</select>
<p class=hint>Not listed? It may be a 5 GHz network — this device can only use
2.4 GHz. On most routers both bands share a name; move closer and try again.</p>
<label>Network name</label>
<input id=s name=ssid value="%SSID%" required
 autocapitalize=off autocorrect=off autocomplete=off spellcheck=false>
<p class=hint>Case-sensitive. Phone keyboards like to capitalise the first letter.</p>
<label>WiFi password</label>
<input name=pass type=password value="" autocapitalize=off autocorrect=off spellcheck=false>
<p class=hint>Leave blank to keep the saved one.</p>
<label>Server</label><input name=url value="%URL%" autocapitalize=off spellcheck=false>
<button type=submit>Save and connect</button></form></div>)HTML";

bool netStartPortal(const String &errorNote, uint32_t timeoutMs)
{
    WebServer server(80);
    DNSServer dns;
    bool saved = false;

    String apName = "PaddleTracker-" + netDeviceId().substring(4);

    WiFi.mode(WIFI_AP_STA);          // STA side stays up so we can scan
    WiFi.softAP(apName.c_str());
    dns.start(53, "*", WiFi.softAPIP());

    Serial.printf("Portal: join WiFi \"%s\" then open http://%s/\n",
                  apName.c_str(), WiFi.softAPIP().toString().c_str());
    if (errorNote.length()) Serial.printf("Portal: %s\n", errorNote.c_str());

    screen("SETUP - join wifi:", apName.c_str(), "then open",
           WiFi.softAPIP().toString().c_str());

    // Scanned once up front: strongest first, de-duplicated, so a mesh with the
    // same SSID on three channels appears once rather than three times.
    int n = WiFi.scanNetworks();
    String opts;
    for (int i = 0; i < n && i < 20; i++) {
        String ss = WiFi.SSID(i);
        if (!ss.length() || opts.indexOf(">" + ss + " (") >= 0) continue;
        opts += "<option value=\"" + ss + "\">" + ss + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
    }
    WiFi.scanDelete();

    auto renderForm = [&](const String &note) {
        String p = FPSTR(PORTAL_HTML);
        p.replace("%DEVICEID%", netDeviceId());
        p.replace("%SSID%", netcfg.ssid);
        p.replace("%URL%", netcfg.baseUrl);
        p.replace("%OPTIONS%", opts);
        p.replace("%ERROR%", note.length() ? "<p class=err>" + note + "</p>" : "");
        server.send(200, "text/html", p);
    };

    server.on("/", [&]() { renderForm(errorNote); });
    server.on("/save", HTTP_POST, [&]() {
        String ssid = server.arg("ssid");
        String pass = server.arg("pass");
        String url  = server.arg("url");
        if (!ssid.length()) { renderForm("Please choose a network."); return; }
        // Blank password keeps the stored one, so a re-run to fix a typo in the
        // SSID does not force the user to retype the password on a phone.
        netcfgSaveWifi(ssid, pass.length() ? pass : netcfg.pass,
                       url.length() ? url : netcfg.baseUrl);
        server.send(200, "text/html",
            "<meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<body style=\"font:16px/1.5 -apple-system,system-ui,sans-serif;background:#101317;"
            "color:#eef1f5;margin:0\"><div style='max-width:420px;margin:0 auto;padding:32px 20px'>"
            "<h1 style='font-size:20px'>Saved</h1><p style='color:#a4aeba'>The tracker is "
            "restarting and will try to join <b>" + ssid + "</b>.</p>"
            "<p style='color:#a4aeba'>Watch the tracker's screen: it shows whether it worked. "
            "If it can't join, it reopens this setup page and explains why.</p></div>");
        saved = true;
    });
    server.onNotFound([&]() {        // captive-portal probes land here
        server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
        server.send(302, "text/plain", "");
    });
    server.begin();

    uint32_t t0 = millis();
    while (!saved && millis() - t0 < timeoutMs) {
        dns.processNextRequest();
        server.handleClient();
        delay(5);
    }
    delay(500);                      // let the response flush before teardown
    server.stop();
    dns.stop();
    WiFi.softAPdisconnect(true);
    return saved;
}

bool netBringUp()
{
    // No credentials at all: go straight to the portal. Requiring a serial
    // console here would mean the device cannot be set up without a laptop.
    if (!netHasWifi()) {
        screen("No wifi configured", "Starting setup...", "", "");
        if (netStartPortal("Welcome — choose your WiFi network to get started.")) {
            delay(300);
            ESP.restart();
        }
        return false;
    }

    screen("Joining wifi:", netcfg.ssid.c_str(), "", "");
    String why;
    if (netConnect(15000, &why)) {
        screen("WiFi connected", WiFi.localIP().toString().c_str(),
               netIsClaimed() ? "Account: linked" : "Account: not linked",
               netIsClaimed() ? "Syncing..." : "");
        delay(2000);          // long enough to read while walking past
        return true;
    }

    Serial.printf("WiFi: %s\n", why.c_str());

    // Never connected on these credentials => setup has not worked yet, so
    // reopen the portal and say why. But once it HAS worked, a failure just
    // means we are away from home — do not hijack the device into setup mode
    // when it should be out tracking.
    if (!netcfg.everConnected) {
        if (netStartPortal(why)) { delay(300); ESP.restart(); }
    } else {
        screen("WiFi unavailable", netcfg.ssid.c_str(), "Hold BOOT 3s", "for setup");
        delay(3000);
    }
    return false;
}
