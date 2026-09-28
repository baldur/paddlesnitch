#pragma once
// ---------------------------------------------------------------------------
// LilyGO T-Beam S3 Supreme (ESP32-S3 + SX1262) pin map.
//
// Transcribed verbatim from the vendor's own header, T_BEAM_S3_SUPREME block:
//   https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series
//   examples/GPS/TinyGPS_Example/utilities.h
//
// Do not "fix" these from a blog post or a photo of the silkscreen. If a
// peripheral misbehaves, re-check against that file first -- LilyGO ships
// several boards under similar names with different pinouts.
// ---------------------------------------------------------------------------

// I2C bus 0 (Wire): OLED + external QWIIC sensors
#define I2C_SDA         17
#define I2C_SCL         18

// I2C bus 1 (Wire1): AXP2101 PMU, PCF8563 RTC, on-board sensors
#define I2C1_SDA        42
#define I2C1_SCL        41
#define PMU_IRQ         40

// GPS (u-blox or L76K depending on production batch) on UART
#define GPS_RX_PIN      9   // ESP32 receives here  <- GPS TX
#define GPS_TX_PIN      8   // ESP32 transmits here -> GPS RX
#define GPS_EN_PIN      7   // must be driven HIGH to power the GNSS module
#define GPS_PPS_PIN     6
#define GPS_BAUD_RATE   9600

#define BUTTON_PIN      0   // shares the BOOT/strapping pin

// SX1262 radio, on its own SPI bus
#define RADIO_SCLK_PIN  12
#define RADIO_MISO_PIN  13
#define RADIO_MOSI_PIN  11
#define RADIO_CS_PIN    10
#define RADIO_RST_PIN   5
#define RADIO_DIO1_PIN  1
#define RADIO_BUSY_PIN  4
#define RADIO_DIO0_PIN  (-1)  // not connected on SX1262

// Second SPI bus: microSD + IMU
#define SPI_MOSI        35
#define SPI_SCK         36
#define SPI_MISO        37
#define SPI_CS          47   // microSD chip select
#define IMU_CS          34
#define IMU_INT         33

#define SDCARD_MOSI     SPI_MOSI
#define SDCARD_MISO     SPI_MISO
#define SDCARD_SCLK     SPI_SCK
#define SDCARD_CS       SPI_CS

#define RTC_INT         14

// The OLED's I2C address differs between board batches: 0x3D on the first
// tracker (where something else, unidentified, acks at 0x3C), 0x3C on the
// 2026-09 batch. Both verified with `tools/flash.sh -e displayprobe`. The
// firmware probes and picks one at boot; see include/display_addr.h.
#define DISPLAY_I2C_ADDR     0x3D
#define DISPLAY_I2C_ADDR_ALT 0x3C
