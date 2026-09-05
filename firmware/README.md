# T-Beam Supreme GPS Tracker

Firmware for a LilyGO T-Beam S3 Supreme (ESP32-S3 + SX1262 + GNSS), built with
PlatformIO.

## Quick start

```bash
pio run                        # build (default env: tracker)
tools/flash.sh                 # flash the tracker
tools/flash.sh -e receiver     # flash a second board as receiver
pio device monitor             # watch output
```

Expected output on a healthy board:

```
=== T-Beam S3 Supreme bring-up ===
  PMU      [ ok ]
  Display  [ ok ]
  GPS      [ ok ] UART open, waiting for NMEA
  Radio    [ ok ]
I2C scan (PMU/RTC): 0x34 0x51
I2C scan (OLED/QWIIC): 0x3C 0x3D 0x77
```

Then one line per second. Take it outside — indoors the GNSS will usually never
get a first fix.

## Where things are

See `CLAUDE.md` for architecture, the AXP2101 power-rail map, and the
board-specific gotchas. `include/board_pins.h` is the pin map.

## Status

- [x] Milestone 1 — hardware bring-up, live GPS to OLED + serial *(verified on hardware)*
- [x] Milestone 2 — LoRa position packets *(TX verified on hardware; RX needs a second board)*
- [x] Motion + GNSS logging to microSD (CSV, flushed per row)
- [~] Milestone 3 — upload sessions to paddlesnitch.com over WiFi
      (device side built; server endpoints specced in `../../docs/features/device-uplink.md`, not built)

Logged CSV columns:

```
ms,utc_date,utc_time,fix,lat,lon,alt_m,speed_kmh,course_deg,sats,hdop,batt_mv,tx_seq,
ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,accel_mag_max_g,gyro_mag_max_dps,imu_temp_c,imu_samples
```

The receiver prints one JSON object per packet, which is the intended seam for
Milestone 3:

```json
{"node":"5A43CA48","seq":12,"fix":true,"lat":64.1350000,"lon":-21.8200000,
 "alt":34,"sats":9,"hdop":1.3,"batt_mv":3971,"rssi":-91.5,"snr":9.2}
```

## Region

`LORA_FREQ_MHZ` in `platformio.ini` is set to **868.0 (EU)**. Change it to 915.0
for US/AU before transmitting, and check your local duty-cycle and power limits.
