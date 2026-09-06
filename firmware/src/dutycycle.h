#pragma once
#include <Arduino.h>

// Enforces a transmit duty-cycle ceiling.
//
// EU868 is legally capped at 1% on most sub-bands: after transmitting for T ms
// you must stay off air for 99*T ms. This is a regulatory limit, not a
// performance tuning knob -- do not raise DUTY_CYCLE_PERCENT to make the
// tracker report faster. If you need faster updates, shorten the packet or use
// a lower spreading factor so each transmission costs less airtime.
//
// Deliberately conservative: one rolling budget rather than the per-sub-band
// accounting a real LoRaWAN stack does, so it under-transmits rather than over.
class DutyCycle {
public:
    explicit DutyCycle(uint32_t percent) : _percent(percent ? percent : 1) {}

    bool canTransmit() const { return millis() >= _nextAllowedMs; }

    uint32_t waitRemainingMs() const
    {
        uint32_t now = millis();
        return now >= _nextAllowedMs ? 0 : _nextAllowedMs - now;
    }

    // Call immediately after a transmission with its measured airtime.
    void recordTx(uint32_t airtimeMs)
    {
        _lastAirtimeMs = airtimeMs;
        _nextAllowedMs = millis() + airtimeMs * (100 / _percent - 1);
    }

    uint32_t lastAirtimeMs() const { return _lastAirtimeMs; }

private:
    uint32_t _percent;
    uint32_t _nextAllowedMs = 0;
    uint32_t _lastAirtimeMs = 0;
};
