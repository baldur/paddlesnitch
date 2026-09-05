// Receiver / gateway role: listen for position packets and emit one JSON line
// per packet on the serial port.
//
// JSON-per-line is the seam to Milestone 3: a host script can read this port
// and forward to a server or phone without this firmware needing to know
// anything about the network.

#include <Arduino.h>
#include "board.h"
#include "board_pins.h"
#include "packet.h"

static BoardStatus board;
static volatile bool packetWaiting = false;
static uint32_t rxCount = 0, rxBadCount = 0;
static PositionPacket lastPkt;
static float lastRssi = 0, lastSnr = 0;
static bool  haveLast = false;

// Runs in ISR context: set a flag and get out. Doing SPI work here would
// deadlock, since reading the packet itself needs the SPI bus.
ICACHE_RAM_ATTR static void onPacket() { packetWaiting = true; }

static void report(const char *name, bool ok, const char *detail = "")
{
    Serial.printf("  %-8s %s %s\n", name, ok ? "[ ok ]" : "[FAIL]", detail);
}

void setup()
{
    Serial.begin(115200);
    uint32_t t0 = millis();
    while (!Serial && millis() - t0 < 2000) delay(10);

    Serial.println("\n=== T-Beam S3 Supreme receiver ===");
    board = boardInit();

    char radioDetail[32] = "";
    if (!board.radio) snprintf(radioDetail, sizeof(radioDetail), "RadioLib %d", board.radioErr);
    report("PMU",     board.pmu);
    report("Display", board.display);
    report("Radio",   board.radio, radioDetail);
    if (board.radio) radioPrintConfig();

    if (!board.radio) {
        Serial.println("radio down -- nothing to listen with");
        return;
    }

    radio.setPacketReceivedAction(onPacket);
    int16_t st = radio.startReceive();
    if (st != RADIOLIB_ERR_NONE) {
        Serial.printf("startReceive failed: %d\n", st);
        return;
    }
    Serial.println("listening...\n");
}

static void drawStatus()
{
    if (!board.display) return;
    char line[32];

    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    snprintf(line, sizeof(line), "RX %lu  bad %lu",
             (unsigned long)rxCount, (unsigned long)rxBadCount);
    display.drawStr(0, 10, line);

    if (haveLast) {
        snprintf(line, sizeof(line), "node %08lX #%u",
                 (unsigned long)lastPkt.nodeId, lastPkt.seq);
        display.drawStr(0, 24, line);
        if (lastPkt.flags & PKT_FLAG_HAS_FIX) {
            snprintf(line, sizeof(line), "%.5f", lastPkt.lat / 1e7);
            display.drawStr(0, 36, line);
            snprintf(line, sizeof(line), "%.5f", lastPkt.lon / 1e7);
            display.drawStr(0, 48, line);
        } else {
            display.drawStr(0, 42, "sender has no fix");
        }
        snprintf(line, sizeof(line), "RSSI %.0f SNR %.1f", lastRssi, lastSnr);
        display.drawStr(0, 62, line);
    } else {
        display.drawStr(0, 32, "waiting for packet");
    }
    display.sendBuffer();
}

void loop()
{
    if (packetWaiting) {
        packetWaiting = false;

        uint8_t buf[64];
        size_t  len = radio.getPacketLength();
        int16_t st  = radio.readData(buf, len > sizeof(buf) ? sizeof(buf) : len);

        if (st == RADIOLIB_ERR_NONE) {
            PositionPacket p;
            if (pktValidate(buf, len, p)) {
                rxCount++;
                lastPkt  = p;
                lastRssi = radio.getRSSI();
                lastSnr  = radio.getSNR();
                haveLast = true;

                // One JSON object per line -- easy to pipe into anything.
                Serial.printf(
                    "{\"node\":\"%08lX\",\"seq\":%u,\"fix\":%s,"
                    "\"lat\":%.7f,\"lon\":%.7f,\"alt\":%d,"
                    "\"sats\":%u,\"hdop\":%.1f,\"batt_mv\":%u,"
                    "\"rssi\":%.1f,\"snr\":%.1f}\n",
                    (unsigned long)p.nodeId, p.seq,
                    (p.flags & PKT_FLAG_HAS_FIX) ? "true" : "false",
                    p.lat / 1e7, p.lon / 1e7, p.altM,
                    p.sats, p.hdopX10 / 10.0, p.battMv,
                    lastRssi, lastSnr);
            } else {
                // Right sync word, wrong contents: another LoRa user on this
                // frequency, or a version mismatch between the two ends.
                rxBadCount++;
                Serial.printf("rx: %u bytes rejected (magic/version/crc)\n", (unsigned)len);
            }
        } else {
            rxBadCount++;
            Serial.printf("rx: readData failed %d\n", st);
        }

        radio.startReceive();
    }

    static uint32_t lastDraw = 0;
    if (millis() - lastDraw >= 1000) {
        lastDraw = millis();
        drawStatus();
    }
}
