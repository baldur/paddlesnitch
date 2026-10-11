#include "loopwatch.h"
#include "dbg.h"
#include <Arduino.h>
#include <esp_task_wdt.h>

extern TaskHandle_t loopTaskHandle;   // Arduino core (main.cpp)

static bool s_started = false;
static int  s_depth   = 0;            // loop task only, so no lock

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
