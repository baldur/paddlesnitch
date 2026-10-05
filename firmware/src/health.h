#pragma once
#include <WiFiClientSecure.h>
// Health reports (include/health_report.h; server POST /api/devices/health).
// healthCaptureBoot() runs early in setup(): why we restarted, and after a
// crash the summary the chip saved. healthMaybeSend() runs on the uplink task
// while WiFi is up: the start report once, then a heartbeat every hour.
void healthCaptureBoot();
void healthMaybeSend(WiFiClientSecure &client, int pending, uint32_t stackHeadroom);
