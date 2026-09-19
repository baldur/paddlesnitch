#include "dbg.h"
#include <stdarg.h>

// Fixed-size slots, so the ring is a plain array and an overwrite is free. 96
// bytes of text is enough for the events worth recording and keeps 340 of them
// in 32 KB -- minutes of activity at the rate state changes actually happen.
static const size_t SLOT_TEXT = 96;
static const size_t SLOTS     = 340;

struct Slot {
    uint32_t ms;
    uint8_t  core;
    uint8_t  level;
    char     tag[8];
    char     text[SLOT_TEXT];
};

static Slot             *g_ring = nullptr;
static size_t            g_next = 0;       // next slot to write
static uint32_t          g_kept = 0;       // slots currently holding an entry
static uint32_t          g_lost = 0;       // entries overwritten since boot
static SemaphoreHandle_t g_lock = nullptr;

void dbgInit()
{
    if (g_ring) return;
    g_lock = xSemaphoreCreateMutex();
    // PSRAM deliberately: 32 KB of internal heap is worth more to TLS, and this
    // buffer is never touched from an ISR, so slower PSRAM is free of cost here.
    g_ring = (Slot *)ps_calloc(SLOTS, sizeof(Slot));
    if (!g_ring) g_ring = (Slot *)calloc(SLOTS, sizeof(Slot));   // no PSRAM: still useful
}

void dbgLog(DbgLevel level, const char *tag, const char *fmt, ...)
{
    if (!g_ring) return;

    // Formatted OUTSIDE the lock: a slow caller must not hold up a fast one.
    char text[SLOT_TEXT];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(text, sizeof(text), fmt, ap);
    va_end(ap);

    const uint32_t ms   = millis();
    const uint8_t  core = (uint8_t)xPortGetCoreID();

    if (g_lock && xSemaphoreTake(g_lock, pdMS_TO_TICKS(20)) != pdTRUE) return;  // never block a caller
    Slot &s = g_ring[g_next];
    if (s.ms || s.text[0]) g_lost++; else g_kept++;
    s.ms    = ms;
    s.core  = core;
    s.level = (uint8_t)level;
    snprintf(s.tag, sizeof(s.tag), "%s", tag);
    memcpy(s.text, text, sizeof(text));
    g_next = (g_next + 1) % SLOTS;
    if (g_lock) xSemaphoreGive(g_lock);
}

void dbgDump(Print &out)
{
    if (!g_ring) { out.println("dbg: no buffer"); return; }
    out.println("<<<DBG>>>");
    out.printf("kept=%lu overwritten=%lu slots=%u\n",
               (unsigned long)g_kept, (unsigned long)g_lost, (unsigned)SLOTS);
    // Oldest first. A full ring starts at the write cursor; a partly-filled one
    // starts at zero.
    const size_t start = (g_kept >= SLOTS) ? g_next : 0;
    const size_t count = (g_kept >= SLOTS) ? SLOTS : g_kept;
    for (size_t i = 0; i < count; i++) {
        const Slot &s = g_ring[(start + i) % SLOTS];
        if (!s.tag[0] && !s.text[0]) continue;
        const char lv = s.level == DBG_ERR ? 'E' : s.level == DBG_WARN ? 'W' : 'I';
        // Printed one at a time, not accumulated: the whole ring will not fit in
        // a String on this heap.
        out.printf("%8lu c%u %c %-6s %s\n",
                   (unsigned long)s.ms, s.core, lv, s.tag, s.text);
    }
    out.println("<<<END>>>");
}

void dbgClear()
{
    if (!g_ring) return;
    if (g_lock && xSemaphoreTake(g_lock, pdMS_TO_TICKS(50)) != pdTRUE) return;
    memset(g_ring, 0, SLOTS * sizeof(Slot));
    g_next = 0; g_kept = 0; g_lost = 0;
    if (g_lock) xSemaphoreGive(g_lock);
}

void dbgStats(uint32_t &kept, uint32_t &overwritten, uint32_t &bytesUsed)
{
    kept        = g_kept > SLOTS ? SLOTS : g_kept;
    overwritten = g_lost;
    bytesUsed   = (uint32_t)(SLOTS * sizeof(Slot));
}
