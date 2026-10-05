#include "health.h"
#include "health_report.h"
#include "board.h"
#include "netcfg.h"
#include "dbg.h"
#include <HTTPClient.h>
#include <esp_core_dump.h>

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

static const uint32_t HEARTBEAT_MS = 60UL * 60UL * 1000UL;
static HealthCrash s_crash;
static char        s_reason[16] = "";
static bool        s_bootSent = false;
static uint32_t    s_lastBeat = 0;

void healthCaptureBoot()
{
    snprintf(s_reason, sizeof(s_reason), "%s", resetReasonStr());
    if (!boardLastResetWasCrash()) return;
    s_crash.present = true;
    // The summary the chip wrote to the coredump partition as it crashed. It
    // can be missing (the dump failed, or flash was busy); the reset reason
    // still counts the crash.
    esp_core_dump_summary_t *sum = (esp_core_dump_summary_t *)malloc(sizeof(esp_core_dump_summary_t));
    if (sum && esp_core_dump_get_summary(sum) == ESP_OK) {
        snprintf(s_crash.task, sizeof(s_crash.task), "%s", sum->exc_task);
        s_crash.pc = sum->exc_pc;
        s_crash.depth = sum->exc_bt_info.depth > 16 ? 16 : sum->exc_bt_info.depth;
        for (uint8_t i = 0; i < s_crash.depth; i++) s_crash.bt[i] = sum->exc_bt_info.bt[i];
        s_crash.corrupted = sum->exc_bt_info.corrupted;
        snprintf(s_crash.elf, sizeof(s_crash.elf), "%.16s", (const char *)sum->app_elf_sha256);
        DBGW("health", "crash in %s at 0x%08lx", s_crash.task, (unsigned long)s_crash.pc);
    } else {
        DBGW("health", "crash (%s), no summary saved", s_reason);
    }
    free(sum);
}

static bool post(WiFiClientSecure &client, const char *json)
{
    HTTPClient http;
    if (!http.begin(client, netcfg.baseUrl + "/api/devices/health")) return false;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " + netcfg.token);
    http.addHeader("X-Device-Firmware", FIRMWARE_VERSION);
    http.addHeader("X-Device-Model", "lilygo-tbeam-s3-supreme");
    http.setTimeout(15000);
    const int rc = http.POST((uint8_t *)json, strlen(json));
    http.end();
    return rc == 200;
}

void healthMaybeSend(WiFiClientSecure &client, int pending, uint32_t stackHeadroom)
{
    if (!netIsClaimed()) return;
    const bool boot = !s_bootSent;
    if (!boot && s_lastBeat && millis() - s_lastBeat < HEARTBEAT_MS) return;

    HealthStats st;
    st.kind = boot ? "boot" : "heartbeat";
    st.resetReason = s_reason;
    st.uptimeS = millis() / 1000;
    st.heapMin = ESP.getMinFreeHeap();
    st.psramFree = ESP.getFreePsram();
    st.battMv = boardBatteryMv();
    st.onUsb = boardOnUsb();
    st.stackHeadroom = stackHeadroom;
    st.pending = pending;
    char json[700];
    if (healthJson(json, sizeof(json), st, boot ? &s_crash : nullptr) < 0) return;

    const bool ok = post(client, json);
    DBGI("health", "%s report %s", st.kind, ok ? "sent" : "failed");
    Serial.printf("health: %s report %s\n", st.kind, ok ? "sent" : "not sent (next sync)");
    if (!ok) return;
    s_lastBeat = millis();
    if (boot) {
        s_bootSent = true;
        // The server has it: clear the dump, so the next crash is the one kept.
        if (s_crash.present) esp_core_dump_image_erase();
    }
}
