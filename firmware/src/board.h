#pragma once
#include <Arduino.h>
#include <TinyGPSPlus.h>
#include <U8g2lib.h>
#include <XPowersLib.h>
#include <RadioLib.h>
#include <SPI.h>

// VERIFIED ON HARDWARE: this panel is an SH1106. Driven as an SSD1306 the image
// sits 2 pixels too far left and the leftmost column of text is clipped -- the
// SH1106 has 132 columns and displays its visible 128 starting at column 2.
// Override with -DDISPLAY_SH1106=0 only if a future board revision differs.
#ifndef DISPLAY_SH1106
#define DISPLAY_SH1106 1
#endif

// Shared peripheral handles. Defined in board.cpp.
extern XPowersAXP2101 PMU;
extern HardwareSerial SerialGPS;
extern TinyGPSPlus    gps;
extern SX1262         radio;
// Both SSD1306 and SH1106 init sequences light this panel, so "something
// appears" is not evidence the driver is correct -- only the column alignment
// distinguishes them. See the DISPLAY_SH1106 note above.
#if DISPLAY_SH1106
typedef U8G2_SH1106_128X64_NONAME_F_HW_I2C DisplayDriver;
#else
typedef U8G2_SSD1306_128X64_NONAME_F_HW_I2C DisplayDriver;
#endif
extern DisplayDriver display;

// Which peripherals actually came up. Nothing here aborts on failure -- a dead
// OLED should not stop you reading GPS over the serial monitor.
struct BoardStatus {
    bool pmu     = false;
    bool display = false;
    bool gps     = false;  // module powered + UART open (not "has a fix")
    bool radio   = false;
    bool sdcard  = false;  // set by storageInit(), not boardInit()
    int  radioErr = 0;     // RadioLib status code when radio == false
};

// Brings up PMU rails -> I2C -> display -> GPS -> radio, in that order.
// The PMU must go first: GPS and LoRa are on switched rails and are completely
// unpowered until the AXP2101 is told to turn them on.
BoardStatus boardInit();

void boardScanI2C(TwoWire &bus, const char *label);
void gpsSendNMEA(const char *body);   // adds "$", checksum and CRLF
void gpsConfigureOutput();            // call once NMEA is flowing, not before
float boardBatteryVoltage();   // millivolts -> volts, 0 if unavailable
uint16_t boardBatteryMv();     // 0 if no battery fitted
bool  boardIsCharging();
bool  boardOnUsb();
int   boardBatteryPercent();   // -1 when no battery is fitted
bool  board_display_ok();      // did the OLED actually ack at boot
void  radioPrintConfig();      // logs the active LoRa parameters
void  imuProbe();              // reads ID registers over SPI and logs them
extern SPIClass sdSPI;         // second SPI bus: microSD + IMU

// Sets the on-board PCF8563 RTC (on Wire1, the PMU bus). Best-effort: the RTC
// is a convenience kept in step with GPS time, not a hard dependency -- session
// filenames take their timestamp straight from GPS. No-ops if the RTC does not
// ack. Lazily begins the driver on first call.
void  boardRtcSet(int year, int month, int day, int hour, int minute, int second);
