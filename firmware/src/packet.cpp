#include "packet.h"
#include <string.h>

uint16_t pktCrc16(const uint8_t *data, size_t len)
{
    uint16_t crc = 0xFFFF;                 // CRC16-CCITT (XModem seed)
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; b++) {
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : (crc << 1);
        }
    }
    return crc;
}

void pktFinalise(PositionPacket &p)
{
    p.magic   = PKT_MAGIC;
    p.version = PKT_VERSION;
    p.crc     = pktCrc16((const uint8_t *)&p, sizeof(p) - sizeof(p.crc));
}

bool pktValidate(const uint8_t *buf, size_t len, PositionPacket &out)
{
    if (len != sizeof(PositionPacket)) return false;

    PositionPacket p;
    memcpy(&p, buf, sizeof(p));
    if (p.magic != PKT_MAGIC || p.version != PKT_VERSION) return false;

    uint16_t want = pktCrc16(buf, sizeof(p) - sizeof(p.crc));
    if (want != p.crc) return false;

    out = p;
    return true;
}

uint32_t pktNodeId()
{
    uint64_t mac = ESP.getEfuseMac();
    return (uint32_t)(mac & 0xFFFFFFFF);
}

bool pktSelfTest()
{
    bool ok = true;
    auto check = [&](const char *what, bool cond) {
        Serial.printf("  selftest %-28s %s\n", what, cond ? "pass" : "FAIL");
        if (!cond) ok = false;
    };

    check("sizeof == 25", sizeof(PositionPacket) == 25);

    PositionPacket p = {};
    p.nodeId = 0xDEADBEEF;
    p.seq    = 4242;
    p.lat    = 641350000;      // 64.135 N, Reykjavik-ish
    p.lon    = -218200000;     // 21.82 W -- negative, so sign survival matters
    p.altM   = -12;            // negative altitude too
    p.sats   = 9;
    p.hdopX10 = 13;
    p.battMv = 3971;
    p.flags  = PKT_FLAG_HAS_FIX;
    pktFinalise(p);

    PositionPacket out;
    check("valid packet accepted", pktValidate((uint8_t *)&p, sizeof(p), out));
    check("nodeId round-trip", out.nodeId == 0xDEADBEEF);
    check("negative lon round-trip", out.lon == -218200000);
    check("negative alt round-trip", out.altM == -12);
    check("battMv round-trip", out.battMv == 3971);

    PositionPacket bad = p;
    bad.lat ^= 0x00000100;                                  // flip one bit
    check("corrupted payload rejected", !pktValidate((uint8_t *)&bad, sizeof(bad), out));

    PositionPacket badver = p;
    badver.version = PKT_VERSION + 1;
    check("version mismatch rejected", !pktValidate((uint8_t *)&badver, sizeof(badver), out));

    check("short buffer rejected", !pktValidate((uint8_t *)&p, sizeof(p) - 1, out));

    Serial.printf("  selftest: %s\n", ok ? "ALL PASS" : "FAILURES PRESENT");
    return ok;
}
