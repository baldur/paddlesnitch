#include "board.h"
#include "board_pins.h"
#include <Wire.h>
#include <SPI.h>
#include "SensorPCF8563.hpp"

XPowersAXP2101 PMU;
HardwareSerial SerialGPS(1);          // UART1; pins are assigned in begin()
TinyGPSPlus    gps;
SX1262         radio = new Module(RADIO_CS_PIN, RADIO_DIO1_PIN,
                                  RADIO_RST_PIN, RADIO_BUSY_PIN, SPI);
DisplayDriver  display(U8G2_R0, U8X8_PIN_NONE);
SPIClass       sdSPI(HSPI);
static bool    g_displayOk = false;
static SensorPCF8563 g_rtc;   // on Wire1 (PMU bus); begun lazily in boardRtcSet

// Rail assignment on the Supreme, per LilyGO's LoRaBoards.cpp. These are not
// guesses -- ALDO4/ALDO3 in particular are why a "dead" GPS or radio is almost
// always a power problem rather than a wiring problem.
static bool initPMU()
{
    if (!PMU.begin(Wire1, AXP2101_SLAVE_ADDRESS, I2C1_SDA, I2C1_SCL)) {
        return false;
    }

    PMU.setALDO4Voltage(3300);   // GPS
    PMU.enableALDO4();

    PMU.setALDO3Voltage(3300);   // LoRa radio
    PMU.enableALDO3();

    // On a cold boot LilyGO power-cycles the sensor and SD rails so those chips
    // cannot hold the shared buses low through a reset.
    if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_UNDEFINED) {
        PMU.disableALDO1();
        PMU.disableALDO2();
        PMU.disableBLDO1();
        delay(250);
    }

    PMU.setALDO1Voltage(3300);   // sensors
    PMU.enableALDO1();
    PMU.setALDO2Voltage(3300);
    PMU.enableALDO2();

    PMU.setBLDO1Voltage(3300);   // microSD
    PMU.enableBLDO1();
    PMU.setBLDO2Voltage(3300);
    PMU.enableBLDO2();

    PMU.setDC3Voltage(3300);     // M.2 interface
    PMU.enableDC3();
    PMU.setDC4Voltage(XPOWERS_AXP2101_DCDC4_VOL2_MAX);
    PMU.enableDC4();
    PMU.setDC5Voltage(3300);
    PMU.enableDC5();

    PMU.setChargerConstantCurr(XPOWERS_AXP2101_CHG_CUR_500MA);
    PMU.setChargeTargetVoltage(XPOWERS_AXP2101_CHG_VOL_4V2);
    PMU.enableBattVoltageMeasure();

    return true;
}


// Send a proprietary NMEA command, computing the checksum at runtime rather
// than hardcoding it. `body` excludes the leading '$' and the '*CS' suffix.
void gpsSendNMEA(const char *body)
{
    uint8_t cs = 0;
    for (const char *p = body; *p; ++p) cs ^= (uint8_t)*p;
    SerialGPS.printf("$%s*%02X\r\n", body, cs);
    SerialGPS.flush();
}

// This unit ships with a CASIC AT6558R, which by default emits only GGA and
// RMC -- so there is no satellite count to watch while it is still acquiring.
// PCAS03 turns on GSA and GSV too, which makes "is the antenna working"
// answerable before the first fix arrives.
//
// Must be called only once the module is actually talking: it boots a little
// after its power rail comes up and silently discards anything sent before its
// $GPTXT banner.
// Fields: GGA,GLL,GSA,GSV,RMC,VTG,ZDA,ANT,DHV,LPS,,,UTC,GST
void gpsConfigureOutput()
{
    gpsSendNMEA("PCAS03,1,0,1,1,1,0,0,0,0,0,,,0,0");
}

BoardStatus boardInit()
{
    BoardStatus st;

    Wire1.begin(I2C1_SDA, I2C1_SCL);   // PMU bus first
    st.pmu = initPMU();
    delay(100);                        // let the switched rails settle

    Wire.begin(I2C_SDA, I2C_SCL);      // display / QWIIC bus

    // Verify the panel actually acks before trusting it. U8g2's begin() returns
    // success unconditionally over I2C, so on its own it proves nothing -- this
    // is how the wrong address went unnoticed.
    Wire.beginTransmission(DISPLAY_I2C_ADDR);
    bool panelPresent = (Wire.endTransmission() == 0);

    display.setI2CAddress(DISPLAY_I2C_ADDR << 1);
    st.display = panelPresent && display.begin();
    g_displayOk = st.display;
    if (st.display) {
        // 400 kHz, not the 100 kHz default: a full 1 KB frame takes ~100 ms to
        // shift out at 100 kHz, which caps the refresh rate low enough that
        // anything blinking aliases into looking static.
        display.setBusClock(400000);
        display.setFont(u8g2_font_6x10_tf);
        display.clearBuffer();
        display.drawStr(0, 10, "T-Beam Supreme");
        display.sendBuffer();
    }

    // GPIO0 doubles as the BOOT strapping pin; at runtime it is the user button
    // and reads LOW when pressed.
    pinMode(BUTTON_PIN, INPUT_PULLUP);

    pinMode(GPS_EN_PIN, OUTPUT);
    digitalWrite(GPS_EN_PIN, HIGH);
    delay(50);
    SerialGPS.begin(GPS_BAUD_RATE, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    st.gps = true;

    SPI.begin(RADIO_SCLK_PIN, RADIO_MISO_PIN, RADIO_MOSI_PIN, RADIO_CS_PIN);
    // Bare begin(freq) matches LilyGO's own SX1262 example: RadioLib then uses
    // its defaults of a 1.6 V TCXO and DIO2 driving the RF switch, which is how
    // this module is wired. Error -707/-706 here points at the TCXO voltage.
    st.radioErr = radio.begin(LORA_FREQ_MHZ);
    st.radio    = (st.radioErr == RADIOLIB_ERR_NONE);

    if (st.radio) {
        radio.setSpreadingFactor(LORA_SF);
        radio.setBandwidth(LORA_BW_KHZ);
        radio.setCodingRate(LORA_CR);
        radio.setSyncWord(LORA_SYNCWORD);
        // Regulatory limit, not a performance knob. EU868 allows 14 dBm ERP on
        // the common sub-bands; the SX1262 will happily do 22 and break the law.
        radio.setOutputPower(LORA_TX_DBM);
        radio.setCurrentLimit(140);
    }

    // Second SPI bus, shared by the microSD card and the IMU.
    sdSPI.begin(SDCARD_SCLK, SDCARD_MISO, SDCARD_MOSI, SDCARD_CS);
    pinMode(SDCARD_CS, OUTPUT); digitalWrite(SDCARD_CS, HIGH);
    pinMode(IMU_CS,    OUTPUT); digitalWrite(IMU_CS,    HIGH);

    return st;
}

// Reads the registers that the common 6-axis parts use as their identity, so
// the actual chip can be named rather than guessed. Run before mounting the SD
// card to avoid two chip-selects contending on the shared bus.
//   QMI8658 -> reg 0x00 = 0x05      BMI160  -> reg 0x00 = 0xD1
//   BMA423  -> reg 0x00 = 0x13      LSM6DS3 -> reg 0x0F = 0x69
//   MPU9250 -> reg 0x75 = 0x71
static uint8_t imuReadReg(uint8_t reg)
{
    sdSPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE3));
    digitalWrite(IMU_CS, LOW);
    sdSPI.transfer(reg | 0x80);
    uint8_t v = sdSPI.transfer(0x00);
    digitalWrite(IMU_CS, HIGH);
    sdSPI.endTransaction();
    return v;
}

void imuProbe()
{
    uint8_t r00 = imuReadReg(0x00);
    uint8_t r0F = imuReadReg(0x0F);
    uint8_t r75 = imuReadReg(0x75);
    Serial.printf("IMU probe: 0x00=%02X 0x0F=%02X 0x75=%02X", r00, r0F, r75);

    const char *guess = "unknown";
    if      (r00 == 0x05) guess = "QMI8658";
    else if (r00 == 0xD1) guess = "BMI160";
    else if (r00 == 0x13) guess = "BMA423";
    else if (r0F == 0x69) guess = "LSM6DS3";
    else if (r75 == 0x71) guess = "MPU9250";
    Serial.printf("  -> %s\n", guess);
}

void boardScanI2C(TwoWire &bus, const char *label)
{
    Serial.printf("I2C scan (%s):", label);
    int found = 0;
    for (uint8_t addr = 1; addr < 127; addr++) {
        bus.beginTransmission(addr);
        if (bus.endTransmission() == 0) {
            Serial.printf(" 0x%02X", addr);
            found++;
        }
    }
    Serial.println(found ? "" : " none");
}

bool board_display_ok() { return g_displayOk; }

void radioPrintConfig()
{
    Serial.printf("LoRa: %.1f MHz  SF%d  BW%.0f kHz  CR4/%d  sync 0x%02X  %d dBm\n",
                  (double)LORA_FREQ_MHZ, (int)LORA_SF, (double)LORA_BW_KHZ,
                  (int)LORA_CR, (unsigned)LORA_SYNCWORD, (int)LORA_TX_DBM);
}

uint16_t boardBatteryMv()
{
    if (!PMU.isBatteryConnect()) return 0;
    return PMU.getBattVoltage();
}

bool boardIsCharging() { return PMU.isCharging(); }
bool boardOnUsb()      { return PMU.isVbusIn(); }

int boardBatteryPercent()
{
    if (!PMU.isBatteryConnect()) return -1;
    return PMU.getBatteryPercent();
}

float boardBatteryVoltage()
{
    if (!PMU.isBatteryConnect()) return 0.0f;
    return PMU.getBattVoltage() / 1000.0f;
}

void boardRtcSet(int year, int month, int day, int hour, int minute, int second)
{
    // Begin once, on Wire1 (already brought up in boardInit for the PMU). If the
    // RTC does not ack, give up quietly: it is a convenience, not a dependency.
    static bool begun    = false;
    static bool beginTried = false;
    if (!begun) {
        if (beginTried) return;
        beginTried = true;
        begun = g_rtc.begin(Wire1, I2C1_SDA, I2C1_SCL);
        if (!begun) { Serial.println("RTC: PCF8563 did not ack"); return; }
    }
    g_rtc.setDateTime(RTC_DateTime((uint16_t)year, (uint8_t)month, (uint8_t)day,
                                   (uint8_t)hour, (uint8_t)minute, (uint8_t)second));
}
