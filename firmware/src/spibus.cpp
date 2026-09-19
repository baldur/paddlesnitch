#include "spibus.h"
#include "dbg.h"

// RECURSIVE, and that is load-bearing rather than lazy. Several card operations
// legitimately nest -- computeCounts() walks the directory holding the bus and
// consults confirmedUploaded() per entry, which opens the index itself. With a
// plain mutex each of those inner calls would block against its own task until
// the timeout and then return a wrong answer. Recursion is safe because the bus
// really is owned by that task for the whole span; what must never happen is
// holding it across a network call, and the chunked uploader is careful to
// release between a chunk read and its POST.
static SemaphoreHandle_t g_bus = nullptr;
static uint32_t          g_skips = 0;
static uint32_t          g_timeouts = 0;

void spiBusInit()
{
    if (!g_bus) g_bus = xSemaphoreCreateRecursiveMutex();
}

bool spiBusTryTake()
{
    // Before init (very early boot) there is only one thread touching the bus,
    // so granting it is correct rather than merely convenient.
    if (!g_bus) return true;
    if (xSemaphoreTakeRecursive(g_bus, 0) == pdTRUE) return true;
    g_skips++;
    // Who actually has it? Rate-limited to once a second so the ring is not
    // flooded. Diagnostic; remove once the answer is known.
    static uint32_t lastWhine = 0;
    if (millis() - lastWhine > 1000) {
        lastWhine = millis();
        TaskHandle_t h = xSemaphoreGetMutexHolder(g_bus);
        DBGW("spibus", "skip; holder=%s skips=%lu",
             h ? pcTaskGetName(h) : "(none)", (unsigned long)g_skips);
    }
    return false;
}

bool spiBusTake(uint32_t timeoutMs)
{
    if (!g_bus) return true;
    if (xSemaphoreTakeRecursive(g_bus, pdMS_TO_TICKS(timeoutMs)) == pdTRUE) return true;
    g_timeouts++;
    return false;
}

void spiBusGive()
{
    if (g_bus) xSemaphoreGiveRecursive(g_bus);
}

uint32_t spiBusSkips()    { return g_skips; }
uint32_t spiBusTimeouts() { return g_timeouts; }
