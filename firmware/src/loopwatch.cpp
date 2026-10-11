#include "loopwatch.h"
#include "dbg.h"
#include <Arduino.h>
#include <esp_task_wdt.h>

extern TaskHandle_t loopTaskHandle;   // Arduino core (main.cpp)

static bool s_started = false;
static int  s_depth   = 0;            // loop task only, so no lock
static volatile TickType_t s_beat = 0;

// Survives the panic restart (not cleared at start), so the next start can say
// what froze. A magic value, because uninitialised RTC memory is random.
static const uint32_t FROZE_LOOP = 0x4C4F4F50;   // "LOOP"
RTC_NOINIT_ATTR static uint32_t s_frozeMark;

void loopWatchBeat() { s_beat = xTaskGetTickCount(); }

bool loopWatchFroze()
{
    const bool froze = s_frozeMark == FROZE_LOOP;
    s_frozeMark = 0;
    return froze;
}

// ESP-IDF calls this from the watchdog interrupt just before it panics (weak in
// the core). Interrupt context: no logging, no locks, just one word to RTC RAM.
extern "C" void esp_task_wdt_isr_user_handler(void)
{
    const TickType_t since = xTaskGetTickCountFromISR() - s_beat;
    s_frozeMark = (s_started && s_depth == 0 && since >= pdMS_TO_TICKS((LOOP_WATCH_TIMEOUT_S - 1) * 1000))
                ? FROZE_LOOP : 0;
}

void loopWatchStart()
{
    esp_task_wdt_init(LOOP_WATCH_TIMEOUT_S, true);   // already up: updates timeout + panic
    enableLoopWDT();
    s_started = true;
    DBGI("wdt", "watching loop(), %us", (unsigned)LOOP_WATCH_TIMEOUT_S);
    Serial.printf("watchdog: loop() watched, %us\n", (unsigned)LOOP_WATCH_TIMEOUT_S);
}

LoopWatchPause::LoopWatchPause()
    : active_(s_started && xTaskGetCurrentTaskHandle() == loopTaskHandle)
{
    if (active_ && s_depth++ == 0) disableLoopWDT();
}

LoopWatchPause::~LoopWatchPause()
{
    if (active_ && --s_depth == 0) enableLoopWDT();
}
