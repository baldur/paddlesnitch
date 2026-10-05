#pragma once
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// The tracker's health report (POST /api/devices/health; server:
// sanitizeHealth in packages/core/src/devices.ts). Once per start, why it
// restarted -- with the chip's saved crash summary if it crashed -- and hourly
// while on WiFi, a heartbeat. Pure, so the JSON is host-tested.

struct HealthCrash {
    bool     present = false;   // the last restart was a crash (a summary may still be missing)
    char     task[17] = "";     // the task that crashed
    uint32_t pc = 0;
    uint32_t bt[16] = {0};
    uint8_t  depth = 0;
    bool     corrupted = false;
    char     elf[17] = "";      // first 16 hex of the crashing build's ELF sha256
};

struct HealthStats {
    const char *kind = "heartbeat";   // "boot" or "heartbeat"
    const char *resetReason = "";
    uint32_t uptimeS = 0, heapMin = 0, psramFree = 0, stackHeadroom = 0;
    uint16_t battMv = 0;
    bool     onUsb = false;
    int      pending = -1;            // recordings waiting; -1 = not counted yet
};

// Names come from the firmware, but keep the JSON safe whatever they hold.
static inline void healthWord(char *dst, size_t n, const char *src)
{
    size_t j = 0;
    for (size_t i = 0; src && src[i] && j + 1 < n; i++) {
        const char c = src[i];
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '-';
        dst[j++] = ok ? c : '_';
    }
    dst[j] = 0;
}

// Returns the length written, or -1 if `out` was too small.
static inline int healthJson(char *out, size_t n, const HealthStats &s, const HealthCrash *c)
{
    char reason[24]; healthWord(reason, sizeof(reason), s.resetReason);
    char pending[12];
    if (s.pending < 0) snprintf(pending, sizeof(pending), "null"); else snprintf(pending, sizeof(pending), "%d", s.pending);
    int w = snprintf(out, n,
        "{\"kind\":\"%s\",\"resetReason\":\"%s\",\"uptimeS\":%lu,\"heapMin\":%lu,\"psramFree\":%lu,"
        "\"battMv\":%u,\"onUsb\":%s,\"stackHeadroom\":%lu,\"pending\":%s",
        strcmp(s.kind, "boot") == 0 ? "boot" : "heartbeat", reason, (unsigned long)s.uptimeS,
        (unsigned long)s.heapMin, (unsigned long)s.psramFree, (unsigned)s.battMv,
        s.onUsb ? "true" : "false", (unsigned long)s.stackHeadroom, pending);
    if (w < 0 || (size_t)w >= n) return -1;
    if (c && c->present) {
        char task[17]; healthWord(task, sizeof(task), c->task);
        char elf[17];  healthWord(elf, sizeof(elf), c->elf);
        int k = snprintf(out + w, n - w, ",\"crash\":{\"task\":\"%s\",\"pc\":\"0x%08lx\",\"corrupted\":%s,\"elf\":\"%s\",\"bt\":[",
                         task, (unsigned long)c->pc, c->corrupted ? "true" : "false", elf);
        if (k < 0 || (size_t)(w += k) >= n) return -1;
        const uint8_t depth = c->depth > 16 ? 16 : c->depth;
        for (uint8_t i = 0; i < depth; i++) {
            k = snprintf(out + w, n - w, "%s\"0x%08lx\"", i ? "," : "", (unsigned long)c->bt[i]);
            if (k < 0 || (size_t)(w += k) >= n) return -1;
        }
        k = snprintf(out + w, n - w, "]}");
        if (k < 0 || (size_t)(w += k) >= n) return -1;
    }
    if ((size_t)w + 2 > n) return -1;
    out[w++] = '}'; out[w] = 0;
    return w;
}
