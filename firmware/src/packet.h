#pragma once
#include <Arduino.h>

// Wire format for position reports. Deliberately small: LoRa airtime is the
// scarce resource, and at SF9/125kHz every extra byte costs ~1.4 ms on air,
// which under a 1% duty cycle costs 140 ms of enforced silence.
//
// Packed and little-endian, which is native on the ESP32-S3 -- so both ends
// must be little-endian, or the decode must be rewritten field by field.
// Bump PKT_VERSION on any layout change; the receiver rejects mismatches.

#define PKT_MAGIC   0x47   // 'G'
#define PKT_VERSION 1

enum : uint8_t {
    PKT_FLAG_HAS_FIX = 1 << 0,
    PKT_FLAG_CHARGING = 1 << 1,
};

struct __attribute__((packed)) PositionPacket {
    uint8_t  magic;
    uint8_t  version;
    uint32_t nodeId;    // low 4 bytes of the efuse MAC
    uint16_t seq;
    int32_t  lat;       // degrees * 1e7
    int32_t  lon;       // degrees * 1e7
    int16_t  altM;
    uint8_t  sats;
    uint8_t  hdopX10;   // saturates at 25.5
    uint16_t battMv;
    uint8_t  flags;
    uint16_t crc;       // CRC16-CCITT over every preceding byte
};

static_assert(sizeof(PositionPacket) == 25, "packet layout changed unexpectedly");

uint16_t pktCrc16(const uint8_t *data, size_t len);
void     pktFinalise(PositionPacket &p);            // stamps magic/version/crc
bool     pktValidate(const uint8_t *buf, size_t len, PositionPacket &out);
uint32_t pktNodeId();

// Round-trips a packet through encode/validate and checks that corruption is
// caught. Runs on the target so it exercises the real struct packing and
// endianness, which a host-side test would not. Returns true if all pass.
bool pktSelfTest();
