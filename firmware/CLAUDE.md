# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where this sits

Firmware for the paddlesnitch hardware tracker, living at `firmware/` inside the
paddlesnitch monorepo. It is **not** a pnpm workspace package — the workspace
globs are `apps/*` and `packages/*`, and this has no `package.json`. Build it
with PlatformIO from this directory; `pnpm` commands at the repo root do not
touch it and `pnpm test` does not run anything here.

The root `CLAUDE.md` governs the TypeScript apps. Its conventions that still
apply here are the general ones — think before coding, surgical changes, no
speculative abstraction. Its testing rule ("every behaviour change ships with a
test") has no equivalent harness on this side: verification here means flashing
the board and reading the serial bring-up report. Say so plainly rather than
claiming a change is tested when it was only compiled.

Two of the three specs live on the paddlesnitch side because they are contracts
that server code implements — see `docs/README.md`.

## Hardware target

LilyGO **T-Beam S3 Supreme**: ESP32-S3 (8 MB flash / 8 MB PSRAM), Semtech **SX1262**
LoRa radio, u-blox/L76K GNSS, **AXP2101** PMU, SH1106 OLED, microSD + IMU on a
second SPI bus. Single build target; there is no other board to support.

Goal of the project: a GPS tracker that reports position off-device (LoRa now,
phone/server link later).

## Commands

```bash
pio run                     # build
tools/flash.sh              # build + flash  <-- USE THIS, not `pio run -t upload`
pio device monitor          # serial only, 115200
pio run -t clean
pio device list             # S3 native USB enumerates as /dev/cu.usbmodem*
```

There is no test suite and no linter configured. "Does it work" is verified by
flashing and reading the bring-up report on the serial monitor.

### Flashing requires a 1200-baud touch

**`pio run -t upload` fails on this board** with `Failed to connect to ESP32-S3:
No serial data received`. esptool's DTR/RTS auto-reset does not move it into
download mode, because the USB port is the ESP32-S3's *native* USB and the
running firmware's CDC stack ignores that sequence. Pressing BOOT+RST is also
unreliable here — the button marked `RST` is wired to the AXP2101 power key, not
to the ESP32's `EN` line.

What does work, and what `tools/flash.sh` automates: open the port at **1200
baud** and drop DTR. The Arduino core treats that as "reboot to bootloader". The
device then re-enumerates (its USB product name changes from
`LilyGo TBeam_S3_Core` to `USB JTAG/serial debug unit`, and the port name
changes, commonly to `/dev/cu.usbmodem2101`), and esptool connects normally.
Always re-read the port name after the touch instead of reusing the old one.

To reset without reflashing, open the port and toggle `rts` high then low.

## Architecture

Deliberately flat. Two roles share one codebase, selected by PlatformIO
environment via `build_src_filter` — there is no runtime role switch:

- `include/board_pins.h` — the pin map, and nothing else.
- `src/board.cpp` / `board.h` — owns every peripheral handle (`PMU`, `SerialGPS`,
  `gps`, `radio`, `display`) and the single `boardInit()` that brings them up in
  a required order. Application code never touches pins directly.
- `src/packet.{h,cpp}` — the over-the-air format, CRC, and `pktSelfTest()`.
- `src/dutycycle.h` — transmit budget enforcement.
- `src/main_tracker.cpp` — `env:tracker` (default). GNSS -> LoRa.
- `src/main_receiver.cpp` — `env:receiver`. LoRa -> one JSON line per packet.

```bash
tools/flash.sh                 # tracker (default env)
tools/flash.sh -e receiver     # receiver
```

`boardInit()` returns a `BoardStatus` rather than aborting on failure: a dead
OLED must not prevent reading GPS over serial. Add new peripherals to `board.cpp`
and a flag to `BoardStatus`; keep the role files free of hardware setup.

### Packet format

25 bytes, packed, little-endian, CRC16-CCITT over everything preceding the CRC
field. `PKT_VERSION` is checked by the receiver and must be bumped on any layout
change, or two ends will silently misparse each other.

Little-endianness is native to the ESP32-S3 on both ends today. Adding a
big-endian receiver means rewriting the decode field by field, not casting.

Validate changes with `PLATFORMIO_BUILD_FLAGS="-DPACKET_SELFTEST=1" tools/flash.sh`,
which round-trips a packet on-target — including negative latitude/longitude and
altitude, which is where packed-struct bugs usually hide — and confirms that
corrupted and version-mismatched packets are rejected.

### Duty cycle is a legal limit, not a tuning knob

`DutyCycle` (1% by default) forces `airtime * 99` of silence after each
transmission. Measured on hardware: a 25-byte packet at SF9/BW125 is **205 ms**
on air, so the floor between transmissions is ~20.5 s; `TX_INTERVAL_S` is 30.

**Do not raise `DUTY_CYCLE_PERCENT` to get faster updates.** To report more
often, shorten the packet or lower the spreading factor so each transmission
costs less airtime. Likewise `LORA_TX_DBM` is 14 because that is the EU868 ERP
ceiling on the common sub-bands — the SX1262 will happily do 22.

Every radio parameter (`LORA_FREQ_MHZ`, `LORA_SF`, `LORA_BW_KHZ`, `LORA_CR`,
`LORA_SYNCWORD`) must match on both ends or they will not hear each other.
Sync word is `0x12` (private); `0x34` is reserved for LoRaWAN.

### The ordering constraint that matters

**The PMU must be initialised before anything else, and it is not optional.**
On this board the GNSS module and the LoRa radio sit on *switched* AXP2101 rails
and are completely unpowered at boot:

| Rail | Powers |
|---|---|
| ALDO4 | GPS |
| ALDO3 | LoRa (SX1262) |
| ALDO1/ALDO2 | sensors |
| BLDO1/BLDO2 | microSD |
| DCDC3/4/5 | M.2 interface |

A "broken" GPS or radio on this board is almost always an unpowered rail, not
wiring or a bad pin. `initPMU()` also deliberately power-cycles ALDO1/ALDO2/BLDO1
on cold boot so those chips cannot hold the shared I2C/SPI buses low across a
reset — preserve that behaviour when editing.

### Bus layout

Two I2C buses, and mixing them up is a common failure:
- `Wire` (SDA 17 / SCL 18) — OLED and external QWIIC sensors.
- `Wire1` (SDA 42 / SCL 41) — **AXP2101 PMU** and RTC.

Two SPI buses: the SX1262 has its own (SCLK 12 / MISO 13 / MOSI 11 / CS 10);
microSD and the IMU share a second one (35/36/37, CS 47 and 34).

## Verified hardware (read from the board, 2026-09-05)

The bring-up report and I2C scans on the actual unit:

```
PMU [ok]  Display [ok]  GPS [ok]  Radio [ok]
I2C scan (PMU/RTC):    0x34 0x51          AXP2101, PCF8563 RTC
I2C scan (OLED/QWIIC): 0x3C 0x3D 0x77     SH1106 OLED, +0x3D, BMx280 at 0x77
```

`Battery: 0.00 V` with no 18650 fitted is correct, not a fault:
`isBatteryConnect()` returns false and `boardBatteryVoltage()` reports 0.

### The GNSS is a CASIC AT6558R, not a u-blox

The module self-identifies as `IC=AT6558R-5N-52-1C580901`, `SW=URANUS5,V5.3.0.0`.
This matters: **UBX binary commands do not work.** Configuration uses CASIC
`$PCAS` NMEA commands, and LilyGO's own driver probes for u-blox/L76K, so their
GPS configuration code does not apply to this unit.

Two consequences already handled in the code, worth preserving:

- By default it emits **only GGA and RMC**, so there is no satellite count while
  acquiring. `gpsConfigureOutput()` sends `PCAS03` to add GSA and GSV; NMEA
  throughput goes 59 -> 251 B/s and GPS/GLONASS/BeiDou GSV all appear.
- **The module discards commands sent too early.** It boots slightly after its
  power rail comes up, and its `$GPTXT` banner arrives *after* `boardInit()`
  finishes. Configuration is therefore issued from `loop()` once
  `gps.charsProcessed() > 100`, not during init. Moving it back into
  `boardInit()` will silently break it — the symptom is no GSV and an unchanged
  59 B/s.

Use `gpsSendNMEA("PCAS...")` for further configuration; it computes the NMEA
checksum at runtime (validated against a known-good LilyGO line).

Build with `-DGPS_ECHO=1` to mirror raw NMEA to serial:
`PLATFORMIO_BUILD_FLAGS="-DGPS_ECHO=1" tools/flash.sh`

### Motion sensing: QMI8658

Confirmed by reading its ID register (`0x00`=`0x05`, chip id `0x7C`), not
assumed. It sits on the **second SPI bus, shared with the microSD card**
(`IMU_CS` 34, card on `SPI_CS` 47) — probe or configure it before mounting the
card so two chip-selects are not contending.

Verified reading real gravity flat on a desk: `a=(0.01,0.08,1.03)g`, so Z is up
and the scaling is right. Sampled at 50 Hz but logged at 1 Hz: `imuPoll()`
accumulates peak |a| and |g| continuously and `imuSnapshot()` returns them and
resets the window, so a row reports what happened *during* that second rather
than one instantaneous value that misses every bump.

Known and not yet addressed: **the gyro shows a ~9 dps bias at rest.** Treat
`gyro_mag_max_dps` as relative until that is calibrated out; SensorLib ships a
`QMI8658_CalibrationExample`.

### SD logging

`storageInit()` mounts the card (it does **not** open a file — recording is
deliberate); `storageStartSession(stamp)` opens `/track_YYYYMMDD_HHMMSS.csv` from
GPS time at record start (NVS-counter fallback `track_n<NNNNNN>.csv` when time is
unknown), so names are unique and never overwrite a previous session. Powered by
BLDO1, which `initPMU()` already enables.

**Every row is flushed immediately.** This is deliberate: pulling the USB cable
is how this device normally gets switched off, and an unflushed buffer means
losing the session — which is exactly what happened on the first outdoor run.
At 1 Hz the cost is irrelevant. Do not "optimise" it into a buffered write.

Rows are logged whether or not there is a fix, so the acquisition process itself
is recorded and "did it ever see satellites" is answerable afterwards.

**The card must be FAT32.** The ESP32 SD library does not support exFAT, which
is what any card over 32 GB ships with, and `SD.begin()` reports that failure
identically to a missing card. `sdRawProbe()` (called automatically when the
mount fails) distinguishes them by talking raw SD protocol:

- `CMD0=0x01` — card present, powered, wiring and CS correct. Filesystem
  problem: reformat FAT32 / MS-DOS with an MBR scheme.
- `CMD0=0xFF` — nothing responding: wrong CS or bus pins, unpowered rail
  (BLDO1), or card not seated.

Verified on hardware: `CMD0=0x01` with `f_mount failed`, confirming the pin map
in `board_pins.h` is correct for the card slot.

## Uplink to paddlesnitch.com

Server contracts:
[`../../docs/features/device-uplink.md`](../../docs/features/device-uplink.md) — auth and transport.
[`../../docs/features/device-data.md`](../../docs/features/device-data.md) — what the CSV contains and
how far each column can be trusted. **Keep the data spec in step with any change
to the CSV columns or the sensor pipeline** — paddlesnitch makes segmentation and
filtering decisions from it.
**None of those endpoints exist yet** — the firmware reports the HTTP status of
every call so a missing endpoint shows up as `claim HTTP 404`, not silence.

- `src/netcfg.*` — WiFi credentials, server URL and device token in **NVS**
  (its own partition, so reflashing the app does not clear them). SoftAP captive
  portal for first-run setup.
- `src/uplink.*` — the claim handshake and session upload.

Serial commands (tracker env): `STATUS`, `SETUP`, `SCAN`, `SSID <name>`,
`PASS <secret>`, `SYNC`, `FORGET`, `LS`, `CAT <file>`. `SSID`/`PASS` take the
**rest of the line**, not a space-split token — both can contain spaces.

**SSIDs are case-sensitive, and phone keyboards capitalise the first letter.**
`Kruttnet` vs `kruttnet` cost a debugging round trip: the symptom is
`Reason: 201 - NO_AP_FOUND`, which looks like a missing network rather than a
typo. The portal's inputs now carry `autocapitalize=off autocorrect=off`; keep
them. `SCAN` prints visible networks next to the configured SSID in brackets,
which is the fastest way to spot a case or whitespace mismatch.

Also note `NO_AP_FOUND` means the radio never saw the network — a wrong password
reports an auth failure instead. And the ESP32-S3 is **2.4 GHz only**, so a
5 GHz-only network produces the same symptom.

Verified end to end on hardware (2026-09-05): portal → WiFi join → DNS → TLS
against the pinned CA → real HTTP response from paddlesnitch.com (a 404, since
the endpoints do not exist yet).

### Onboarding must never need a laptop

`netBringUp()` owns the boot decision:

- **No credentials** → open the setup portal automatically. Requiring someone to
  type `SETUP` over serial would mean the device cannot be set up without a
  laptop, which is not a reasonable thing to need in a kit bag.
- **Credentials that have never worked** (`everConnected` false in NVS) → reopen
  the portal with the failure reason printed at the top of the form.
- **Credentials that have worked before** → do *not* hijack the device into
  setup mode. It is simply away from home, and it should be tracking.
- **Hold BOOT for 3 s, any time** → portal. This is the escape hatch for a
  changed router password.

### Diagnose the failure, don't just report it

`netConnect(timeout, &reason)` returns a sentence a person can act on, decided by
rescanning: SSID visible → "the password is probably wrong"; not visible →
"names are case-sensitive, and this is 2.4 GHz only".

`ssidVisible()` is deliberately **tri-state** (yes / no / could-not-tell). A scan
started while the radio is still retrying a failed association returns nothing,
which is indistinguishable from "network absent" — the first version of this
reported "can't see it" for a network sitting at −49 dBm and sent the user to fix
a name that was never wrong. When the scan is unusable, say so and list all three
possible causes rather than guessing one.

### States are declared, not inferred

[`docs/device-states-spec.md`](docs/device-states-spec.md) is the contract
(firmware ≥ 0.4.0): after onboarding (`Setup`/`Linking`) the device is **not in a
mode** — it always acquires GPS and always runs the uploader, and the user only
picks a **screen**. Every boot lands on the **`Pick`** chooser (tap = move
highlight, hold = open); a screen's double-tap returns to `Pick`. Screens are
`Track`/`Sync`/`Nerd`, with `DeleteConfirm` a transient overlay on `Sync`.
`uiSplash()` is the boot animation, not a state. `AppState` is resolved in one
place each frame; do not reintroduce per-screen booleans.

- **Recording requires a fix.** A record attempt on `Track` with no fix refuses
  and shows `NEED GPS`. Starting before a fix produces exactly the fix-less rows
  that made all 31 of the first uploads return `422`.
- **Upload runs on core 0** (`uplinkTaskStart()`), because HTTP blocks for
  seconds and a frozen screen reads as a crash. It draws nothing; it publishes
  into a mutex-guarded `UplinkStatus` the UI reads (the Sync screen + Nerd).
- **Both cores must never hold the SD card.** The sync task checks a yield flag
  *between files* — never mid-file — and `toggleRecording()` calls
  `uplinkYieldCard()` before opening a log. If it cannot get the card it refuses
  with `BUSY` rather than racing. Count scans and the manual delete also run on
  the task (core 0) for the same single-owner reason.
- **Sync fires at boot, on recording-stop, on a `sync now` tap, and every 5 min
  — never while recording.** The recording-stop trigger is what makes a finished
  paddle upload promptly instead of waiting for the 5-min tick.
- **No automatic deletion.** The card is 256 GB and sessions are tiny, so files
  accumulate until the user clears confirmed uploads from the Sync screen
  (`hold` → confirm). Deletion removes only server-confirmed files (`200`/`201`/
  `409`); `422` and un-uploaded files are never touched. (This replaced the old
  auto-prune-keeping-newest-5.)

### The UI is in `src/ui.cpp`; tracker logic never touches pixels

`uiDraw(UiState)` picks the screen from `s.state`: onboarding until linked, then
`Pick` / `Track` / `Sync` / `Nerd` / `DeleteConfirm`. `uiSplash()` runs once at
boot (a satellite orbiting a "P").

**One button, three gestures, context-sensitive** — the board has only one free
button (GPIO0; `RST` is the AXP2101 power key and not usable for this):

- **Pick** (shown every boot): **tap** moves the highlight, **hold** opens the
  highlighted screen.
- **Track/Sync/Nerd**: **tap** = the screen's primary action (Track: start/stop
  recording; Sync: sync now); **double-tap** = back to `Pick`; **hold 3 s** =
  `Setup`/re-link, except on `Sync` where it arms the delete-confirm.
- **DeleteConfirm**: **tap** = confirm, **double-tap** = cancel.

Hold fires *while held* so the screen changes under your thumb. A tap is only
confirmed once the 400 ms double-tap window closes — the price of distinguishing
the three gestures on one button.

**Recording is deliberate, not automatic.** `storageInit()` mounts the card but
opens no file; `storageStartSession(stamp)` opens one on a tap. Logging and LoRa
transmission are both gated on it. Before this, every power-on created a file and
the card filled with bench noise — all 31 sessions uploaded in testing contained
no usable track points. If you change this, update `../../docs/features/device-data.md`:
paddlesnitch segments uploads based on what that file promises.

**Session files are named `track_YYYYMMDD_HHMMSS.csv`** from GPS time at record
start (`storageStartSession(stamp)`), with an NVS-counter fallback
(`track_n<NNNNNN>.csv`) when wall-clock time is unavailable. This is load-bearing
for upload: the server dedupes by `deviceId`+filename, so the old reused
`track_NNNN` names collided after a card reformat and the server `409`-dropped
the new paddle. Keep names unique. The PCF8563 RTC (`boardRtcSet()`, best-effort)
is set from GPS on the first fix; the CSV columns are unchanged.

The satellite glyph **blinks while searching and goes solid on a fix** — state
readable from across a boat without counting anything.

### Anything the user must act on belongs on the screen, persistently

Boot-time OLED messages are invisible to anyone who looked away for ten seconds.
The tracker's bottom line therefore **alternates every 3 s** while setup is
incomplete (`No wifi-hold BOOT 3s` / `Not linked to acct`) and shows the normal
`TX/SD` counters once nothing needs attention.

**The CSV column names are load-bearing.** `timestamp`, `lat` and `lon` are
exactly what paddlesnitch's existing generic parser
(`packages/timing/src/csv.ts`) looks for, so the server needs no device-specific
parser. Renaming them silently breaks upload — the server would parse zero
points and report an empty track.

Equally load-bearing: **unfixed rows write empty `timestamp`/`lat`/`lon`, not
zeros.** `0.0, 0.0` is a valid coordinate off the coast of Africa, so zeros would
be accepted as real points and corrupt every track.

Other constraints worth keeping:

- **TLS verifies against a pinned root** (`include/root_ca.h`, Amazon Root CA 1,
  fetched not transcribed). Never swap this for `setInsecure()` — the device
  carries a bearer token with write access to a user's account.
- **No secret is compiled into the firmware.** The device is issued its own
  revocable token via the claim flow; a shared key in a binary can be read off
  any device's flash.
- **WiFi runs only at boot**, then the radio is switched off. It is the largest
  power draw on the board and the device is plugged in at home when syncing.
- The app partition is now **6.25 MB** (`partitions.csv`). The default 1.31 MB
  scheme overflows once WiFi + TLS link in — the build is ~1.09 MB.

## Board-specific gotchas

- **The OLED is at I2C `0x3D`, not `0x3C`.** LilyGO's header implies `0x3C`, and
  a device does ack there — but it is not the panel. Driving `0x3C` gives a
  permanently blank screen with no error. Verified with `tools/flash.sh -e
  displayprobe`, which renders a distinct digit per controller/address candidate.
  What `0x3C` actually is remains unidentified.
- **`U8g2::begin()` returns success unconditionally over I2C.** It cannot tell
  you the panel is there, let alone that the controller matches — this is how the
  wrong address survived a "Display [ok]" report. `boardInit()` now gates it on a
  real I2C ack. Do not go back to trusting `begin()`.
- **The controller is an SH1106** (verified: as SSD1306, text was clipped on the
  left edge). LilyGO's header was right about the controller — the address was
  the actual bug. Both init sequences light the panel, so "something appears"
  does not mean the driver is correct; only column alignment distinguishes them.
  An SH1106 has 132 columns and shows its visible 128 starting at column 2, so
  driving it as an SSD1306 shifts everything 2 px left and clips the first
  character. Override with `-DDISPLAY_SH1106=0`.
- **GPIO0 is both the user button and the BOOT strapping pin.** Do not drive it,
  and do not hold it at boot unless you want the bootloader.
- **`GPS_EN_PIN` (7) must be driven HIGH** in addition to enabling ALDO4.
- **Radio init uses RadioLib's defaults on purpose.** Bare `radio.begin(freq)`
  selects a 1.6 V TCXO and DIO2-as-RF-switch, which is how this module is wired
  and matches LilyGO's own SX1262 example. RadioLib error `-706`/`-707` at init
  points at TCXO voltage; do not "fix" it by changing pins.
- **`LORA_FREQ_MHZ` is a build flag in `platformio.ini`**, currently 868.0 (EU).
  Transmitting on the wrong band for your region is a legal problem, not just a
  technical one. Never raise output power or disable duty-cycle limiting without
  the user explicitly asking.
- **USB-CDC serial**: `setup()` waits at most 2 s for a host. Never loop forever
  on `!Serial` — the board has to run on battery with nothing attached.
- Flash use is measured against a **1.31 MB** app partition from `default.csv`,
  despite 8 MB of flash. Adding BLE + WiFi + OTA will need a custom partition table.

## Verifying a change on real hardware

`main.cpp` prints a peripheral bring-up table and an I2C scan of both buses at
boot, then one status line per second. When diagnosing GPS: `nmea_chars` stuck at
0 means the UART is silent (rail or pin problem); `nmea_chars` climbing with
`sats=0` means the module is alive and simply has no sky view. A cold first fix
takes 30–90 s outdoors and typically never completes indoors — judge progress by
satellite count, not the fix flag.

## Pin map provenance

`include/board_pins.h` is transcribed from the `T_BEAM_S3_SUPREME` block of
LilyGO's `utilities.h` in
[Xinyuan-LilyGO/LilyGo-LoRa-Series](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series)
(`examples/GPS/TinyGPS_Example/utilities.h`), and the rail configuration from the
matching `LoRaBoards.cpp`. **Check pins against that repo, not against blog posts
or photos of the silkscreen** — LilyGO ships several boards under near-identical
names with different pinouts. `boards/t-beams3-supreme.json` is vendored from the
same repo so builds do not depend on a PlatformIO core install.
