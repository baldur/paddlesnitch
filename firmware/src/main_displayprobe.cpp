// Display probe: cycles through candidate OLED controllers and addresses,
// showing a large digit for each. Tell the operator which digit appears.
//
// Exists because "the panel acks on I2C" and "the panel renders" are different
// facts: U8g2's begin() returns success unconditionally over I2C, so it cannot
// tell you the controller is right. An SH1106 init sequence on an SSD1306 leaves
// the screen entirely blank -- SSD1306 needs an explicit charge-pump enable that
// the SH1106 sequence never sends.
//
//   tools/flash.sh -e displayprobe

#include <Arduino.h>
#include <Wire.h>
#include "board.h"
#include "board_pins.h"

static U8G2_SSD1306_128X64_NONAME_F_HW_I2C ssd_3c(U8G2_R0, U8X8_PIN_NONE);
static U8G2_SH1106_128X64_NONAME_F_HW_I2C  sh_3c (U8G2_R0, U8X8_PIN_NONE);
static U8G2_SSD1306_128X64_NONAME_F_HW_I2C ssd_3d(U8G2_R0, U8X8_PIN_NONE);
static U8G2_SH1106_128X64_NONAME_F_HW_I2C  sh_3d (U8G2_R0, U8X8_PIN_NONE);

struct Candidate {
    const char *name;
    U8G2       *u8g2;
    uint8_t     addr;
};

static Candidate candidates[] = {
    {"1: SSD1306 @ 0x3C", &ssd_3c, 0x3C},
    {"2: SH1106  @ 0x3C", &sh_3c,  0x3C},
    {"3: SSD1306 @ 0x3D", &ssd_3d, 0x3D},
    {"4: SH1106  @ 0x3D", &sh_3d,  0x3D},
};

void setup()
{
    Serial.begin(115200);
    uint32_t t0 = millis();
    while (!Serial && millis() - t0 < 2000) delay(10);

    Serial.println("\n=== OLED probe ===");
    boardInit();          // rails and buses; its own display attempt is ignored
    boardScanI2C(Wire, "OLED/QWIIC");
    Serial.println("Watch the screen. Report which digit you can read.\n");
}

void loop()
{
    for (auto &c : candidates) {
        Serial.printf("trying %s\n", c.name);

        c.u8g2->setI2CAddress(c.addr << 1);
        c.u8g2->begin();
        c.u8g2->clearBuffer();

        // Large digit, readable at a glance and from an angle.
        c.u8g2->setFont(u8g2_font_logisoso32_tn);
        c.u8g2->drawStr(4, 44, String(c.name[0]).c_str());

        // Plus the detail in small text, and a full border so a partially
        // working panel (wrong column offset) is still obvious.
        c.u8g2->setFont(u8g2_font_6x10_tf);
        c.u8g2->drawStr(44, 28, c.name + 3);
        c.u8g2->drawFrame(0, 0, 128, 64);
        c.u8g2->sendBuffer();

        delay(5000);
    }
}
